// 업무 도구 단계 2 사진(바로 찍기, photo-pr-plan F-a, 설계서 9장). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// - 이 PR은 손님에게만 붙인다(X-Work-Owner는 customer:{uuid}만, F-1·1절 3번). 그래서 files.deal_id는 늘 NULL이다.
// - 올리기: Content-Length를 먼저 보고(없거나 한도를 넘으면 본문을 읽지 않고 413) → 본문을 다 받아 길이 대조(다르면 400) →
//   매직 넘버·메타데이터 검사(JPEG APP 조각·끝 EOI, WebP RIFF 조각 끝까지) → 통과한 뒤에만 R2 put(sha256은 R2가 대조, Worker는 다시 계산하지 않음)
//   → D1 행(실패하면 R2 보상 삭제). 검사에 걸리면 R2를 부르지 않으므로 남는 객체가 없다(대장 2026-11-22: 흘려 보내기 대신 다 받아 검사).
// - R2 키에는 UUID만 쓴다(손님 이름·전화번호·동·호수·원래 파일 이름 없음, 9.2절). customMetadata는 sha256·kind만.
// - 감사 기록에는 파일 id만 남기고 설명·손님 이름은 남기지 않는다. Worker 로그에 R2 키·설명을 남기지 않는다.
// - 미리보기 사본(Q-2): 원본 키 + ".thumb"(WebP·JPEG, 형식은 httpMetadata.contentType), D1 칸 없음. 내려받기에 감사 기록을 남기지 않는다(손님 카드 열기 customer.view로 갈음).
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, runBatch } from "./work-audit.mjs";
import { FILE_THUMB_SUFFIX, trashBatchFor, trashRowsSql } from "./work-trash.mjs";
import { FILE_THUMB_MIME_TYPES as THUMB_MIME_TYPES, invalid, isUuid, koreaDate, parseFilePatch, parseFileUploadHeaders, parseThumbUploadHeaders } from "./work-input.mjs";

const FILE_COLUMNS = "id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, deal_id, caption, created_at";
const SQL = Object.freeze({
  customerExists: "SELECT id FROM customers WHERE id = ?",
  fileById: "SELECT " + FILE_COLUMNS + " FROM files WHERE id = ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(8.5절).
  customerGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  fileGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM files WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  // retention_until은 비워 둔다: 사진 보관은 손님 기록을 따른다(Q-4, 손님이 지워질 때 함께 휴지통으로).
  fileInsert:
    "INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, deal_id, rrn_masked, caption, retention_until, created_at)"
    + " VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, '', NULL, ?)",
  // 설명 고치기: files에 version 칸이 없어 마지막 쓰기가 이긴다(동시 수정을 막지 않음, 3.1절 주의, T2-137h).
  captionUpdate: "UPDATE files SET caption = ? WHERE id = ?",
  fileDelete: "DELETE FROM files WHERE id = ?",
  trashFile: trashRowsSql("files", "id = ?"),
});

const FILE_EXT = Object.freeze({ "image/jpeg": "jpg", "image/webp": "webp" });

function notFound() {
  return new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);
}

function methodNotAllowed(allow) {
  const error = new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405);
  error.allow = allow;
  return error;
}

function unsupportedMedia() {
  return new WorkApiError("UNSUPPORTED_MEDIA_TYPE", "허용하지 않는 파일 형식입니다.", 415);
}

function metadataPresent() {
  return new WorkApiError("IMAGE_METADATA_PRESENT", "사진에 촬영 정보(위치 등)가 남아 있거나 형식이 올바르지 않습니다. 화면에서 다시 저장한 사진만 올릴 수 있습니다.", 415);
}

function checksumMismatch() {
  return new WorkApiError("CHECKSUM_MISMATCH", "받은 파일이 보낸 파일과 다릅니다. 다시 올려 주세요.", 422, true);
}

function fileStorageFailed() {
  return new WorkApiError("FILE_STORAGE_FAILED", "파일 저장소를 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.", 503, true);
}

function auditBase(ctx, action, fileId) {
  return { at: new Date(ctx.now).toISOString(), actorEmail: ctx.actor.email, action, targetType: "file", targetId: fileId, requestId: ctx.requestId };
}

function logFile(ctx, entry) {
  try {
    ctx.log?.({ event: "work_file", requestId: ctx.requestId, ...entry });
  } catch {
    // 로그 장애는 무시한다.
  }
}

// ── 그림 검사(순수 함수, 1절 5번·F-3 대장 고침) ─────────────────────────────

const ascii = (bytes, start, end) => String.fromCharCode(...bytes.subarray(start, end));
const startsWithText = (bytes, start, end, text) => end - start >= text.length && ascii(bytes, start, start + text.length) === text;
const u32le = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
const JPEG_SOS = 0xda;
const JPEG_COM = 0xfe;
// SOS 전 APPn은 허용 목록만(대장 2026-11-22, WebP 조각 허용 목록과 같은 방식): APP0 JFIF·JFXX, APP2 ICC 색 정보, APP14 Adobe.
// 그 밖의 APPn(APP1 Exif·XMP, APP2 MPF, APP13 IPTC 등)과 COM(설명 글)은 거부한다. APP가 아닌 표준 조각(DQT·DHT·SOFn·DRI 등)은 통과.
const JPEG_APP_ALLOWED = Object.freeze({ 0xe0: ["JFIF\u0000", "JFXX\u0000"], 0xe2: ["ICC_PROFILE\u0000"], 0xee: ["Adobe"] });

// JPEG: SOI(FF D8 FF)로 시작, 끝 두 바이트 EOI(FF D9)(EOI 뒤 꼬리 자료 막기). SOI부터 SOS(FF DA) 전까지 조각을 모두 훑어
// 허용 목록 밖의 APPn과 COM이 있으면 거부. 조각 길이가 파일을 넘거나 SOS가 없으면 형식이 깨진 것으로 거부.
function checkJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw unsupportedMedia();
  if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw metadataPresent();
  let index = 2;
  for (;;) {
    if (index >= bytes.length || bytes[index] !== 0xff) throw metadataPresent();
    while (index < bytes.length && bytes[index] === 0xff) index += 1; // 채움 바이트
    if (index >= bytes.length) throw metadataPresent();
    const marker = bytes[index];
    index += 1;
    if (marker === JPEG_SOS) return;
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) throw metadataPresent();
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // 길이 없는 표시
    if (index + 2 > bytes.length) throw metadataPresent();
    const length = (bytes[index] << 8) | bytes[index + 1];
    const end = index + length;
    if (length < 2 || end > bytes.length) throw metadataPresent();
    const start = index + 2;
    if (marker === JPEG_COM) throw metadataPresent();
    if (marker >= 0xe0 && marker <= 0xef && !(JPEG_APP_ALLOWED[marker] ?? []).some((prefix) => startsWithText(bytes, start, end, prefix))) throw metadataPresent();
    index = end;
  }
}

// WebP: "RIFF" 크기 "WEBP". RIFF 크기 + 8 = 받은 길이. 조각을 파일 끝까지 훑어(머리 8바이트만 읽고 본문은 건너뜀, 홀수 크기는 채움 1바이트)
// 허용 조각은 VP8·VP8L·VP8X·ALPH·ICCP만(EXIF·XMP·ANIM 등 그 밖은 거부). 첫 조각은 VP8·VP8L·VP8X. VP8X 깃발 EXIF(0x08)·XMP(0x04)도 거부.
const WEBP_ALLOWED = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"]);
const WEBP_FIRST = new Set(["VP8 ", "VP8L", "VP8X"]);
const VP8X_EXIF_XMP = 0x08 | 0x04;

function checkWebp(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") throw unsupportedMedia();
  if (u32le(bytes, 4) + 8 !== bytes.length) throw metadataPresent();
  let index = 12;
  let chunks = 0;
  while (index < bytes.length) {
    if (index + 8 > bytes.length) throw metadataPresent();
    const fourcc = ascii(bytes, index, index + 4);
    const size = u32le(bytes, index + 4);
    if (!WEBP_ALLOWED.has(fourcc) || (chunks === 0 && !WEBP_FIRST.has(fourcc))) throw metadataPresent();
    const start = index + 8;
    const end = start + size;
    if (end > bytes.length) throw metadataPresent();
    if (fourcc === "VP8X" && (size < 10 || (bytes[start] & VP8X_EXIF_XMP) !== 0)) throw metadataPresent();
    index = end + (size & 1);
    chunks += 1;
  }
  if (chunks === 0 || index !== bytes.length) throw metadataPresent();
}

// 매직 넘버가 다르면 415 UNSUPPORTED_MEDIA_TYPE, 메타데이터·형식 문제는 415 IMAGE_METADATA_PRESENT.
export function checkImageBytes(bytes, mimeType) {
  if (mimeType === "image/jpeg") return checkJpeg(bytes);
  if (mimeType === "image/webp") return checkWebp(bytes);
  throw unsupportedMedia();
}

// ── R2·본문 도우미 ────────────────────────────────────────────────────────

// 본문을 다 받는다(한도는 Content-Length로 이미 확인함). 받은 길이가 Content-Length와 다르면 400(더 많이 오면 그 자리에서 멈춤).
async function readBodyExactly(request, length) {
  if (!request.body) throw invalid(["Content-Length"]);
  const reader = request.body.getReader();
  const bytes = new Uint8Array(length);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > length) {
      try {
        await reader.cancel();
      } catch {
        // 이미 끝난 스트림이면 무시한다.
      }
      throw invalid(["Content-Length"]);
    }
    bytes.set(value, received);
    received += value.byteLength;
  }
  if (received !== length) throw invalid(["Content-Length"]);
  return bytes;
}

// work/{kind}/{yyyy}/{mm}/{uuid}.{ext}(9.2절). 연·월은 한국 날짜.
export function fileObjectKey(kind, mimeType, id, nowMs) {
  const [year, month] = koreaDate(nowMs).split("-");
  return `work/${kind}/${year}/${month}/${id}.${FILE_EXT[mimeType]}`;
}

async function deleteQuietly(ctx, keys, code) {
  try {
    await ctx.files.delete(keys);
  } catch {
    // 보상 삭제도 실패하면 R2에 객체가 남는다. 키는 남기지 않고 코드만 남긴다.
    logFile(ctx, { level: "warn", code });
  }
}

// R2 put: sha256 옵션으로 R2가 받은 내용과 대조한다. 불일치 때 예외를 던지는지 null을 주는지 확인하지 못해 두 경우 모두 422로 본다(대장 2026-11-22, 실제 런타임은 T2-28).
// 혹시 객체가 생겼으면 지운다(compensate). 미리보기 덮어쓰기는 지우지 않는다(실패한 put은 이전 미리보기를 바꾸지 않으므로, 지우면 멀쩡한 미리보기를 잃음).
async function putChecked(ctx, key, bytes, { sha256, contentType, kind, compensate = true }) {
  let stored;
  try {
    stored = await ctx.files.put(key, bytes, { sha256, httpMetadata: { contentType }, customMetadata: { sha256, kind } });
  } catch (error) {
    logFile(ctx, { level: "warn", code: "FILE_PUT_REJECTED", errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error" });
    if (compensate) await deleteQuietly(ctx, [key], "FILE_COMPENSATE_FAILED");
    throw checksumMismatch();
  }
  if (!stored) {
    if (compensate) await deleteQuietly(ctx, [key], "FILE_COMPENSATE_FAILED");
    throw checksumMismatch();
  }
}

function fileView(row) {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    caption: row.caption,
    customerId: row.customer_id,
    dealId: row.deal_id,
    createdAt: row.created_at,
  };
}

async function loadFile(db, id) {
  return (await db.prepare(SQL.fileById).bind(id).first()) ?? null;
}

// 사진 응답(9.4절 헤더). 사진만 받으므로 inline. 파일 이름은 주지 않는다.
function fileContentResponse(object, contentType, requestId) {
  const headers = {
    "Cache-Control": "no-store",
    "Content-Type": contentType,
    "Content-Disposition": "inline",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Request-Id": requestId,
  };
  if (Number.isSafeInteger(object.size)) headers["Content-Length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
}

// ── 경로 ─────────────────────────────────────────────────────────────────

async function uploadFile(ctx) {
  const input = parseFileUploadHeaders(ctx.request.headers);
  // 손님이 없으면 본문을 읽지 않고 404(R2 부르지 않음).
  if (!(await ctx.db.prepare(SQL.customerExists).bind(input.customerId).first())) throw notFound();
  const bytes = await readBodyExactly(ctx.request, input.length);
  checkImageBytes(bytes, input.mimeType);
  const id = ctx.randomUUID();
  const key = fileObjectKey(input.kind, input.mimeType, id, ctx.now);
  const at = new Date(ctx.now).toISOString();
  await putChecked(ctx, key, bytes, { sha256: input.sha256, contentType: input.mimeType, kind: input.kind });
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.customerGuard).bind(input.customerId),
      ctx.db.prepare(SQL.fileInsert).bind(id, key, input.kind, input.mimeType, input.length, input.sha256, input.customerId, at),
      auditStatement(ctx.db, { ...auditBase(ctx, "file.upload", id), outcome: "ok" }),
    ]);
  } catch (error) {
    // D1 저장 실패: 방금 만든 R2 객체를 지운다(보상, 9.3절). 그사이 손님이 지워졌으면 404.
    await deleteQuietly(ctx, [key], "FILE_COMPENSATE_FAILED");
    if (!(await ctx.db.prepare(SQL.customerExists).bind(input.customerId).first())) throw notFound();
    throw error;
  }
  return { status: 201, data: { file: fileView(await loadFile(ctx.db, id)) } };
}

// 원본(감사 file.download) 또는 미리보기(감사 없음). 파일 행이 없거나(휴지통 포함) R2에 객체가 없으면 404.
async function getFileContent(ctx, id, { thumb }) {
  const row = await loadFile(ctx.db, id);
  if (!row) throw notFound();
  let object;
  try {
    object = await ctx.files.get(thumb ? row.r2_key + FILE_THUMB_SUFFIX : row.r2_key);
  } catch {
    throw fileStorageFailed();
  }
  if (!object) {
    if (!thumb) logFile(ctx, { level: "warn", code: "FILE_OBJECT_MISSING" });
    throw notFound();
  }
  if (!thumb) {
    // 감사 기록이 남아야 돌려준다(8.8절). 실패하면 받은 스트림을 닫고 503.
    try {
      await auditStatement(ctx.db, { ...auditBase(ctx, "file.download", id), outcome: "ok" }).run();
    } catch {
      try {
        await object.body?.cancel?.();
      } catch {
        // 무시한다.
      }
      throw new WorkApiError("AUDIT_UNAVAILABLE", "작업 기록을 남기지 못해 자료를 보여 드리지 않았습니다.", 503, true);
    }
  }
  // 미리보기는 저장할 때 넣은 형식(WebP·JPEG)으로 돌려준다. 그 밖의 형식이면 404(화면은 글자 자리표).
  const contentType = thumb ? object.httpMetadata?.contentType : row.mime_type;
  if (thumb && !THUMB_MIME_TYPES.includes(contentType)) {
    try {
      await object.body?.cancel?.();
    } catch {
      // 무시한다.
    }
    throw notFound();
  }
  return { response: fileContentResponse(object, contentType, ctx.requestId) };
}

// 미리보기 올리기(Q-2): 원본 201 뒤에 보낸다(WebP·JPEG). 이미 있으면 덮어쓴다. 원본이 없거나 휴지통에 있으면 404.
async function putThumb(ctx, id) {
  const input = parseThumbUploadHeaders(ctx.request.headers);
  const row = await loadFile(ctx.db, id);
  if (!row) throw notFound();
  const bytes = await readBodyExactly(ctx.request, input.length);
  checkImageBytes(bytes, input.mimeType);
  const key = row.r2_key + FILE_THUMB_SUFFIX;
  await putChecked(ctx, key, bytes, { sha256: input.sha256, contentType: input.mimeType, kind: row.kind, compensate: false });
  try {
    // 올리는 사이 원본이 지워졌으면 guard가 되돌린다(미리보기만 남지 않게 지움).
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.fileGuard).bind(id),
      auditStatement(ctx.db, { ...auditBase(ctx, "file.thumb", id), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await loadFile(ctx.db, id))) {
      await deleteQuietly(ctx, [key], "FILE_COMPENSATE_FAILED");
      throw notFound();
    }
    throw error;
  }
  return { data: { file: fileView(row) } };
}

async function updateFile(ctx, id) {
  const input = parseFilePatch(ctx.body);
  if (!(await loadFile(ctx.db, id))) throw notFound();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.fileGuard).bind(id),
      ctx.db.prepare(SQL.captionUpdate).bind(input.caption, id),
      auditStatement(ctx.db, { ...auditBase(ctx, "file.update", id), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await loadFile(ctx.db, id))) throw notFound();
    throw error;
  }
  return { data: { file: fileView(await loadFile(ctx.db, id)) } };
}

// 사진 지우기: 휴지통 묶음(kind file)으로 옮기고 D1 행만 지운다. R2 객체는 영구 삭제·7일 만료 때 지운다(DEC-WT-37).
async function deleteFile(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  if (!(await loadFile(ctx.db, id))) throw notFound();
  const trash = trashBatchFor(ctx, "file", id);
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.fileGuard).bind(id),
      auditStatement(ctx.db, { ...auditBase(ctx, "file.delete", id), outcome: "ok" }),
      trash.statement,
      ctx.db.prepare(SQL.trashFile).bind(trash.batchId, id),
      ctx.db.prepare(SQL.fileDelete).bind(id),
    ]);
  } catch (error) {
    if (!(await loadFile(ctx.db, id))) throw notFound();
    throw error;
  }
  return { data: { deleted: true, trash: trash.trash } };
}

export function isWorkFilesRoute(route) {
  return route === "/files" || route.startsWith("/files/");
}

// 바이트를 그대로 받는 쓰기(JSON이 아님): 사진 올리기, 미리보기 올리기. work-api.mjs가 JSON 검사 대신 Origin·CSRF만 본다.
export function isWorkFileUpload(route, method) {
  if (method === "POST" && route === "/files") return true;
  const [collection, id, extra, more] = route.split("/").filter(Boolean);
  return method === "PUT" && collection === "files" && id !== undefined && extra === "thumb" && more === undefined;
}

// 경로가 파일(/files, /files/:id, /files/:id/content, /files/:id/thumb)이면 { status?, data } 또는 { response }를, 아니면 null을 돌려준다.
// 켜기 값(FILES_DISABLED)은 work-api.mjs가 먼저 본다.
export async function routeWorkFiles(ctx) {
  const [collection, id, extra, more] = ctx.route.split("/").filter(Boolean);
  if (collection !== "files" || more !== undefined) return null;
  if (id === undefined) {
    if (ctx.method === "POST") return uploadFile(ctx);
    throw methodNotAllowed("POST");
  }
  if (extra !== undefined && extra !== "content" && extra !== "thumb") return null;
  if (!isUuid(id)) throw notFound();
  if (extra === "content") {
    if (ctx.method === "GET") return getFileContent(ctx, id, { thumb: false });
    throw methodNotAllowed("GET");
  }
  if (extra === "thumb") {
    if (ctx.method === "GET") return getFileContent(ctx, id, { thumb: true });
    if (ctx.method === "PUT") return putThumb(ctx, id);
    throw methodNotAllowed("GET, PUT");
  }
  if (ctx.method === "PATCH") return updateFile(ctx, id);
  if (ctx.method === "DELETE") return deleteFile(ctx, id);
  throw methodNotAllowed("PATCH, DELETE");
}
