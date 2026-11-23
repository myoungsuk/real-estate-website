// 손님 사진(바로 찍기) 서버 F-a 시험(photo-pr-plan 3.2절 T2-137 ~ T2-137h, 테스트 체크리스트 4.3절 T2-20 ~ T2-33)과 계약서 사본 서버 K-a 시험(파일 끝). 실제 SQLite(node:sqlite)에
// 0001 ~ 0007을 적용하고 가짜 R2(tests/work-test-kit.mjs createR2)와 가상 그림 바이트만 쓴다. 실제 R2·사진은 쓰지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { checkImageBytes } from "../worker/work-files.mjs";
import { runTrashExpire } from "../worker/work-scheduled.mjs";
import { createWorkCsrfToken } from "../worker/work-security.mjs";
import { NOW, ORIGIN, OWNER, SECRET, authenticate, createR2, freshDb, nextUuid, rows, signToken, work, workEnv } from "./work-test-kit.mjs";

const MB10 = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// 7일 만료 시각: 한국 시각 03:01(휴지통 정리 차례), NOW + 7일보다 뒤.
const EXPIRE_AT = Date.parse("2026-11-25T18:01:00.000Z");

// ── 가상 그림 바이트 ─────────────────────────────────────────────────────
const bytesOf = (...parts) => new Uint8Array(Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part)))));
const u16be = (n) => [(n >> 8) & 255, n & 255];
const u32le = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const segment = (marker, payload) => bytesOf([0xff, marker, ...u16be(payload.length + 2)], payload);
const APP0 = segment(0xe0, bytesOf("JFIF\u0000", [1, 1, 0, 0, 1, 0, 1, 0, 0]));
const DQT = segment(0xdb, new Uint8Array(65).fill(1));
const SOS = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
// canvas가 다시 저장한 꼴의 깨끗한 JPEG: SOI · APP0(JFIF) · (더 넣을 조각) · DQT · SOS · 그림 자료 · EOI · (꼬리).
function jpeg({ extra = [], scanBytes = 64, tail = [] } = {}) {
  const scan = new Uint8Array(scanBytes).fill(0x11);
  return bytesOf([0xff, 0xd8], APP0, ...extra, DQT, SOS, scan, [0xff, 0xd9], tail);
}
// 길이를 정확히 맞춘 JPEG(10MB 경계 시험).
function jpegOfSize(size) {
  const fixed = jpeg({ scanBytes: 0 }).length;
  return jpeg({ scanBytes: size - fixed });
}
const EXIF_APP1 = segment(0xe1, bytesOf("Exif\u0000\u0000", "MM\u0000*GPS 가상"));
const XMP_APP1 = segment(0xe1, bytesOf("http://ns.adobe.com/xap/1.0/\u0000", "<x:xmpmeta/>"));
const XMP_EXT_APP1 = segment(0xe1, bytesOf("http://ns.adobe.com/xmp/extension/\u0000", "0123456789abcdef"));
const IPTC_APP13 = segment(0xed, bytesOf("Photoshop 3.0\u0000", "8BIM"));
const BIG_APP2 = segment(0xe2, bytesOf("ICC_PROFILE\u0000", new Uint8Array(65533 - 12).fill(0x20))); // ICC 색 정보(허용). 이 뒤에 오는 조각은 64KB 뒤에 있음

const chunk = (fourcc, payload) => bytesOf(fourcc, u32le(payload.length), payload, payload.length % 2 ? [0] : []);
const vp8x = (flags) => chunk("VP8X", [flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const VP8 = chunk("VP8 ", new Uint8Array(31).fill(0x22)); // 홀수 크기(채움 1바이트까지 훑는지)
function webp(chunks, { riffDelta = 0 } = {}) {
  const body = bytesOf("WEBP", ...chunks);
  return bytesOf("RIFF", u32le(body.length + riffDelta), body);
}
const CLEAN_WEBP = webp([VP8]);
const sha = async (bytes) => Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");

// ── 도우미 ──────────────────────────────────────────────────────────────
function filesSetup({ enabled = true, binding = true } = {}) {
  const fresh = freshDb();
  const r2 = createR2();
  const extra = {};
  if (enabled) extra.WORK_FILES_ENABLED = "true";
  if (binding) extra.WORK_FILES = r2;
  return { ...fresh, r2, env: workEnv(fresh.db, extra) };
}

async function makeCustomer(env, displayName = "가상 손님 사진") {
  const created = await work(env, "/customers", { method: "POST", body: { displayName } });
  assert.equal(created.status, 201);
  return created.json.data.customer.id;
}

// 바이트 본문 요청(올리기·미리보기 올리기). headers의 값이 null이면 그 머리를 빼고 보낸다.
async function raw(env, path, { method = "POST", bytes, headers = {}, now = NOW, logs = [] } = {}) {
  const base = {
    "Cf-Access-Jwt-Assertion": await signToken(),
    Origin: ORIGIN,
    "X-Admin-CSRF": await createWorkCsrfToken(OWNER, SECRET, now),
    "Content-Type": "image/jpeg",
    "Content-Length": String(bytes?.length ?? 0),
    "X-Work-File-Sha256": bytes ? await sha(bytes) : "",
  };
  const merged = { ...base, ...headers };
  for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method, headers: merged, body: bytes });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => now, auditLog: (entry) => logs.push(entry), randomUUID: nextUuid } });
  const type = response.headers.get("Content-Type") ?? "";
  return { response, status: response.status, json: type.startsWith("application/json") ? await response.json() : null };
}

const upload = (env, customerId, bytes, { mime = "image/jpeg", kind = "property_photo", headers = {}, ...rest } = {}) =>
  raw(env, "/files", { bytes, headers: { "Content-Type": mime, "X-Work-File-Kind": kind, "X-Work-Owner": `customer:${customerId}`, ...headers }, ...rest });
const putThumb = (env, fileId, bytes, { headers = {}, ...rest } = {}) =>
  raw(env, `/files/${fileId}/thumb`, { method: "PUT", bytes, headers: { "Content-Type": "image/webp", ...headers }, ...rest });
const fileRows = (database) => rows(database, "SELECT id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, deal_id, caption, retention_until, created_at FROM files ORDER BY id");
const puts = (r2) => r2.calls.filter(([action]) => action === "put").length;
const audit = (database) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const purge = (env, batchId, options = {}) => work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: "영구 삭제" }, ...options });

// ── 시험 ─────────────────────────────────────────────────────────────────

test("T2-137 WORK_FILES_ENABLED 없음·WORK_FILES 바인딩 없음이면 세션 filesEnabled 거짓, 파일 API 6개 모두 503 FILES_DISABLED, R2 호출 0", async () => {
  for (const [name, setup] of [["켜기 값 없음", { enabled: false }], ["바인딩 없음", { binding: false }], ["켜기 값이 true가 아님", { enabled: false }]]) {
    const { env, r2 } = filesSetup(setup);
    if (name === "켜기 값이 true가 아님") Object.assign(env, { WORK_FILES_ENABLED: "1" });
    const session = await work(env, "/session");
    assert.equal(session.json.data.filesEnabled, false, name);
    const customerId = await makeCustomer(env);
    const id = "00000000-0000-4000-8000-0000000000ff";
    const results = [
      await upload(env, customerId, jpeg()),
      await work(env, `/files/${id}/content`),
      await work(env, `/files/${id}/thumb`),
      await putThumb(env, id, CLEAN_WEBP),
      await work(env, `/files/${id}`, { method: "PATCH", body: { caption: "가상" } }),
      await work(env, `/files/${id}`, { method: "DELETE", body: {} }),
    ];
    for (const result of results) {
      assert.equal(result.status, 503, name);
      assert.equal(result.json.error.code, "FILES_DISABLED", name);
    }
    assert.deepEqual(r2.calls, [], `${name}: R2 호출 0`);
  }
  const { env } = filesSetup();
  assert.equal((await work(env, "/session")).json.data.filesEnabled, true, "둘 다 있으면 참");
  const off = filesSetup();
  off.env.WORK_TOOLS_ENABLED = "false";
  const offSession = await work(off.env, "/session");
  assert.deepEqual([offSession.json.data.enabled, offSession.json.data.filesEnabled], [false, false], "업무 도구가 꺼져 있으면 파일도 거짓");
});

test("T2-20·T2-30·T2-31 깨끗한 JPEG·WebP 올리기: 201, R2 키 work/{kind}/{yyyy}/{mm}/{uuid}.{ext}(이름·원래 파일 이름 없음), customMetadata는 sha256·kind만, D1 행·감사 file.upload", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const logs = [];
  const photo = jpeg({ scanBytes: 1024 * 1024 });
  const first = await upload(env, customerId, photo, { logs, headers: { "X-Original-Name": "IMG_20261117_Daejeon.jpg" } });
  assert.equal(first.status, 201, JSON.stringify(first.json));
  const file = first.json.data.file;
  assert.match(file.id, UUID);
  assert.deepEqual(file, { id: file.id, kind: "property_photo", mimeType: "image/jpeg", byteSize: photo.length, caption: "", customerId, dealId: null, createdAt: new Date(NOW).toISOString() });
  const second = await upload(env, customerId, CLEAN_WEBP, { mime: "image/webp", kind: "other" });
  assert.equal(second.status, 201, JSON.stringify(second.json));
  const stored = fileRows(database);
  assert.equal(stored.length, 2);
  for (const row of stored) {
    assert.match(row.r2_key, new RegExp(`^work/${row.kind}/2026/11/${row.id}\\.(jpg|webp)$`, "u"), "키에 UUID만");
    assert.ok(!row.r2_key.includes("IMG") && !row.r2_key.includes("Daejeon") && !row.r2_key.includes("가상"), "원래 파일 이름·손님 이름 없음");
    const object = r2.objects.get(row.r2_key);
    assert.ok(object, "R2 객체 있음");
    assert.deepEqual(object.customMetadata, { sha256: row.sha256_hex, kind: row.kind }, "customMetadata는 sha256·kind만");
    assert.deepEqual(object.httpMetadata, { contentType: row.mime_type });
    assert.equal(row.customer_id, customerId);
    assert.equal(row.deal_id, null);
    assert.equal(row.retention_until, null, "보관은 손님 기록을 따름(Q-4)");
  }
  assert.equal(stored.find((row) => row.id === file.id).sha256_hex, await sha(photo), "브라우저가 보낸 SHA-256을 저장");
  assert.equal(r2.objects.size, 2);
  const uploads = audit(database).filter((entry) => entry.action === "file.upload");
  assert.deepEqual(uploads.map((entry) => entry.target_id).sort(), stored.map((row) => row.id).sort());
  assert.ok(uploads.every((entry) => entry.target_type === "file" && entry.reason === null));
  assert.ok(!JSON.stringify(logs).includes("work/"), "Worker 로그에 R2 키 없음");
});

test("T2-21·T2-22 허용 밖 형식(png·heic·html·svg)과 JPEG라면서 PDF인 본문은 415 UNSUPPORTED_MEDIA_TYPE, R2 put 0", async () => {
  const { env, r2 } = filesSetup();
  const customerId = await makeCustomer(env);
  for (const mime of ["image/png", "image/heic", "text/html", "image/svg+xml", ""]) {
    const result = await upload(env, customerId, jpeg(), { mime });
    assert.equal(result.status, 415, mime);
    assert.equal(result.json.error.code, "UNSUPPORTED_MEDIA_TYPE", mime);
  }
  const pdf = bytesOf("%PDF-1.7 가상", new Uint8Array(32));
  const disguised = await upload(env, customerId, pdf);
  assert.deepEqual([disguised.status, disguised.json.error.code], [415, "UNSUPPORTED_MEDIA_TYPE"]);
  const webpAsJpeg = await upload(env, customerId, CLEAN_WEBP);
  assert.deepEqual([webpAsJpeg.status, webpAsJpeg.json.error.code], [415, "UNSUPPORTED_MEDIA_TYPE"], "머리와 다른 형식");
  const withParams = await upload(env, customerId, jpeg(), { mime: "image/jpeg; charset=binary" });
  assert.equal(withParams.status, 201, "매개변수는 떼고 미디어 형식만 봄");
  assert.equal(puts(r2), 1);
});

test("T2-23·T2-24 Content-Length: 없으면 413, 실제 본문과 다르면 400, 10MB 정확히는 201, 10MB + 1바이트는 본문을 읽지 않고 413. 실패 때 R2 put 0", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const photo = jpeg();
  const missing = await upload(env, customerId, photo, { headers: { "Content-Length": null } });
  assert.deepEqual([missing.status, missing.json.error.code], [413, "PAYLOAD_TOO_LARGE"]);
  for (const length of [photo.length + 1, photo.length - 1]) {
    const mismatch = await upload(env, customerId, photo, { headers: { "Content-Length": String(length) } });
    assert.deepEqual([mismatch.status, mismatch.json.error.code, mismatch.json.error.details], [400, "VALIDATION_FAILED", ["Content-Length"]], String(length));
  }
  for (const text of ["0", "-1", "1e3", "abc"]) {
    const bad = await upload(env, customerId, photo, { headers: { "Content-Length": text } });
    assert.equal(bad.status, 400, text);
  }
  const over = await upload(env, customerId, photo, { headers: { "Content-Length": String(MB10 + 1) } });
  assert.deepEqual([over.status, over.json.error.code], [413, "PAYLOAD_TOO_LARGE"]);
  assert.equal(puts(r2), 0, "여기까지 R2 put 0");
  const exact = await upload(env, customerId, jpegOfSize(MB10));
  assert.equal(exact.status, 201, JSON.stringify(exact.json));
  assert.equal(fileRows(database)[0].byte_size, MB10);
  const tooBig = await upload(env, customerId, jpegOfSize(MB10 + 1));
  assert.deepEqual([tooBig.status, tooBig.json.error.code], [413, "PAYLOAD_TOO_LARGE"]);
  assert.equal(r2.objects.size, 1);
});

test("F-1 파일 종류: property_photo·other·contract_copy(K-a)만 열고, registry·recording·document는 400 FILE_KIND_NOT_READY, 모르는 종류·빈 값은 400 VALIDATION_FAILED", async () => {
  const { env, r2 } = filesSetup();
  const customerId = await makeCustomer(env);
  for (const kind of ["registry", "recording", "document"]) {
    const result = await upload(env, customerId, jpeg(), { kind });
    assert.deepEqual([result.status, result.json.error.code], [400, "FILE_KIND_NOT_READY"], kind);
  }
  for (const kind of ["photo", ""]) {
    const result = await upload(env, customerId, jpeg(), { kind });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", ["X-Work-File-Kind"]], kind);
  }
  assert.equal(puts(r2), 0);
});

test("T2-137a X-Work-Owner가 deal:{uuid}·비움·customer: 꼴 아님은 400, 없는 손님은 404, R2 put 0", async () => {
  const { env, r2 } = filesSetup();
  const deal = await work(env, "/deals", { method: "POST", body: { title: "가상 거래", dealType: "sale", propertyKind: "housing", saleKind: "sale" } });
  const dealId = deal.json.data?.deal?.id ?? "00000000-0000-4000-8000-0000000000aa";
  for (const owner of [`deal:${dealId}`, "", "customer:", "customer:not-a-uuid", null]) {
    const result = await raw(env, "/files", { bytes: jpeg(), headers: { "X-Work-File-Kind": "property_photo", "X-Work-Owner": owner } });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", ["X-Work-Owner"]], String(owner));
  }
  const missing = await upload(env, "00000000-0000-4000-8000-0000000000ee", jpeg());
  assert.deepEqual([missing.status, missing.json.error.code], [404, "NOT_FOUND"]);
  assert.equal(puts(r2), 0);
});

test("T2-137b 메타데이터 검사: JPEG APP1 Exif·XMP·XMP 확장·APP13·EOI 뒤 꼬리·64KB 뒤 APP1, WebP 끝 쪽 EXIF·XMP 조각·VP8X 깃발·허용 밖 조각·RIFF 길이 불일치는 415 IMAGE_METADATA_PRESENT, R2 put 0", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const bad = [
    ["JPEG APP1 Exif", "image/jpeg", jpeg({ extra: [EXIF_APP1] })],
    ["JPEG APP1 Exif(끝 0 하나)", "image/jpeg", jpeg({ extra: [segment(0xe1, bytesOf("Exif\u0000", "GPS"))] })],
    ["JPEG XMP", "image/jpeg", jpeg({ extra: [XMP_APP1] })],
    ["JPEG XMP 확장", "image/jpeg", jpeg({ extra: [XMP_EXT_APP1] })],
    ["JPEG APP13 IPTC", "image/jpeg", jpeg({ extra: [IPTC_APP13] })],
    ["JPEG APP2 MPF(여러 장 그림 정보)", "image/jpeg", jpeg({ extra: [segment(0xe2, bytesOf("MPF\u0000", "MM\u0000*"))] })],
    ["JPEG APP2 ICC 아닌 글", "image/jpeg", jpeg({ extra: [segment(0xe2, bytesOf("가상 정보"))] })],
    ["JPEG APP3", "image/jpeg", jpeg({ extra: [segment(0xe3, bytesOf("META"))] })],
    ["JPEG APP1 모르는 내용", "image/jpeg", jpeg({ extra: [segment(0xe1, bytesOf("가상 GPS"))] })],
    ["JPEG APP14 Adobe 아님", "image/jpeg", jpeg({ extra: [segment(0xee, bytesOf("가상"))] })],
    ["JPEG APP0 JFIF 아님", "image/jpeg", bytesOf([0xff, 0xd8], segment(0xe0, bytesOf("AVI1", [0, 0])), DQT, SOS, [1, 0xff, 0xd9])],
    ["JPEG COM(설명 글)", "image/jpeg", jpeg({ extra: [segment(0xfe, bytesOf("가상 촬영 메모"))] })],
    ["JPEG EOI 뒤 꼬리", "image/jpeg", jpeg({ tail: bytesOf("가상 꼬리 자료 GPS") })],
    ["JPEG EOI 없음", "image/jpeg", jpeg().subarray(0, jpeg().length - 2)],
    ["JPEG 64KB 뒤 APP1 Exif", "image/jpeg", jpeg({ extra: [BIG_APP2, EXIF_APP1] })],
    ["JPEG 조각 길이가 파일을 넘음", "image/jpeg", bytesOf([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0, 0, 0xff, 0xd9])],
    ["JPEG SOS 없음", "image/jpeg", bytesOf([0xff, 0xd8], APP0, [0xff, 0xd9])],
    ["WebP 끝 쪽 EXIF 조각", "image/webp", webp([vp8x(0), VP8, chunk("EXIF", bytesOf("MM\u0000*GPS 가상"))])],
    ["WebP 끝 쪽 XMP 조각", "image/webp", webp([vp8x(0), VP8, chunk("XMP ", bytesOf("<x:xmpmeta/>"))])],
    ["WebP VP8X EXIF 깃발", "image/webp", webp([vp8x(0x08), VP8])],
    ["WebP VP8X XMP 깃발", "image/webp", webp([vp8x(0x04), VP8])],
    ["WebP 허용 밖 조각(ANIM)", "image/webp", webp([vp8x(0), chunk("ANIM", new Uint8Array(6)), VP8])],
    ["WebP 첫 조각이 그림이 아님", "image/webp", webp([chunk("ICCP", new Uint8Array(4)), VP8])],
    ["WebP RIFF 크기가 길이보다 큼", "image/webp", webp([VP8], { riffDelta: 2 })],
    ["WebP RIFF 크기가 길이보다 작음(뒤에 덧붙임)", "image/webp", bytesOf(CLEAN_WEBP, chunk("EXIF", bytesOf("GPS")))],
    ["WebP 조각이 끝을 넘음", "image/webp", webp([bytesOf("VP8 ", u32le(400), new Uint8Array(8))])],
    ["WebP 채움 바이트 없음", "image/webp", webp([bytesOf("VP8 ", u32le(3), [1, 2, 3])])],
  ];
  for (const [name, mime, bytes] of bad) {
    const result = await upload(env, customerId, bytes, { mime });
    assert.equal(result.status, 415, name);
    assert.equal(result.json.error.code, "IMAGE_METADATA_PRESENT", name);
  }
  assert.equal(puts(r2), 0, "검사에 걸리면 R2를 부르지 않음");
  assert.equal(r2.objects.size, 0);
  assert.equal(fileRows(database).length, 0);
  const clean = [
    ["깨끗한 JPEG", "image/jpeg", jpeg()],
    ["APP2(ICC) 큰 조각이 있는 JPEG", "image/jpeg", jpeg({ extra: [BIG_APP2] })],
    ["APP0 JFIF·JFXX + APP2 ICC + APP14 Adobe JPEG", "image/jpeg", jpeg({ extra: [segment(0xe0, bytesOf("JFXX\u0000", [0x10])), segment(0xe2, bytesOf("ICC_PROFILE\u0000", [1, 1, 0, 0])), segment(0xee, bytesOf("Adobe", [0, 100, 0, 0, 0, 0, 1]))] })],
    ["표준 조각 DHT·SOF0·DRI가 있는 JPEG", "image/jpeg", jpeg({ extra: [segment(0xc4, new Uint8Array(20).fill(1)), segment(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), segment(0xdd, [0, 4])] })],
    ["채움 바이트가 있는 JPEG", "image/jpeg", bytesOf([0xff, 0xd8, 0xff], APP0, SOS, [1, 2, 0xff, 0xd9])],
    ["깨끗한 WebP(VP8)", "image/webp", CLEAN_WEBP],
    ["VP8X + ALPH + ICCP WebP(깃발 투명·ICC만)", "image/webp", webp([vp8x(0x30), chunk("ICCP", new Uint8Array(3)), chunk("ALPH", new Uint8Array(5)), VP8])],
    ["VP8L WebP", "image/webp", webp([chunk("VP8L", new Uint8Array(12).fill(0x2f))])],
  ];
  for (const [name, mime, bytes] of clean) {
    const result = await upload(env, customerId, bytes, { mime });
    assert.equal(result.status, 201, `${name}: ${JSON.stringify(result.json)}`);
  }
  assert.equal(r2.objects.size, clean.length);
  assert.throws(() => checkImageBytes(jpeg({ extra: [EXIF_APP1] }), "image/jpeg"), (error) => error.code === "IMAGE_METADATA_PRESENT");
  assert.doesNotThrow(() => checkImageBytes(jpeg(), "image/jpeg"));
});

test("T2-27 SHA-256: 꼴이 틀리면 400, 꼴은 맞는데 R2가 받은 바이트와 다르다고 거부하면 422 CHECKSUM_MISMATCH(R2·D1 모두 남지 않음), 대문자 hex는 소문자로 저장", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  for (const value of [null, "", "abc", "g".repeat(64), "a".repeat(63)]) {
    const result = await upload(env, customerId, jpeg(), { headers: { "X-Work-File-Sha256": value } });
    assert.deepEqual([result.status, result.json.error.details], [400, ["X-Work-File-Sha256"]], String(value));
  }
  const wrong = await upload(env, customerId, jpeg(), { headers: { "X-Work-File-Sha256": "a".repeat(64) } });
  assert.deepEqual([wrong.status, wrong.json.error.code, wrong.json.error.retryable], [422, "CHECKSUM_MISMATCH", true]);
  assert.equal(r2.objects.size, 0);
  assert.equal(fileRows(database).length, 0);
  assert.equal(audit(database).filter((entry) => entry.action === "file.upload").length, 0);
  const photo = jpeg({ scanBytes: 10 });
  const upper = await upload(env, customerId, photo, { headers: { "X-Work-File-Sha256": (await sha(photo)).toUpperCase() } });
  assert.equal(upper.status, 201);
  assert.equal(fileRows(database)[0].sha256_hex, await sha(photo));
});

test("T2-29 R2 저장 뒤 D1 저장이 실패하면 R2 객체를 보상 삭제한다(손님이 그사이 지워짐 404 / 저장소 오류 503)", async () => {
  const { env, r2, db, database } = filesSetup();
  const customerId = await makeCustomer(env);
  db.beforeNextBatch = () => database.prepare("DELETE FROM customers WHERE id = ?").run(customerId);
  const gone = await upload(env, customerId, jpeg());
  assert.deepEqual([gone.status, gone.json.error.code], [404, "NOT_FOUND"]);
  assert.equal(puts(r2), 1, "R2에는 한 번 넣었고");
  assert.equal(r2.objects.size, 0, "보상 삭제로 남지 않음");

  const second = filesSetup();
  const otherCustomer = await makeCustomer(second.env);
  const batch = second.db.batch;
  second.db.batch = async () => {
    throw new Error("가상 D1 장애");
  };
  const failed = await upload(second.env, otherCustomer, jpeg());
  second.db.batch = batch;
  assert.deepEqual([failed.status, failed.json.error.code], [503, "STORAGE_UNAVAILABLE"]);
  assert.equal(second.r2.objects.size, 0);
  assert.equal(fileRows(second.database).length, 0);

  const third = filesSetup();
  const thirdCustomer = await makeCustomer(third.env);
  third.r2.fail.put = true;
  const putFailed = await upload(third.env, thirdCustomer, jpeg());
  assert.deepEqual([putFailed.status, putFailed.json.error.code], [422, "CHECKSUM_MISMATCH"], "R2 put 예외는 422(불일치와 구분하지 못함, 보고서 확신 없는 곳)");
  assert.equal(fileRows(third.database).length, 0);
});

test("T2-32·T2-33 원본 내려받기: 9.4절 헤더, 감사 file.download(파일 id만), 없는 id·UUID 아님·R2에 객체 없음은 404, R2 읽기 실패 503", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const photo = jpeg({ scanBytes: 300 });
  const file = (await upload(env, customerId, photo)).json.data.file;
  const before = audit(database).length;
  const got = await raw(env, `/files/${file.id}/content`, { method: "GET", headers: { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null } });
  assert.equal(got.status, 200);
  const headers = got.response.headers;
  assert.equal(headers.get("Cache-Control"), "no-store");
  assert.equal(headers.get("Content-Type"), "image/jpeg");
  assert.equal(headers.get("Content-Disposition"), "inline");
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Content-Security-Policy"), "default-src 'none'; sandbox");
  assert.equal(headers.get("Content-Length"), String(photo.length));
  assert.deepEqual(new Uint8Array(await got.response.arrayBuffer()), photo);
  const after = audit(database);
  assert.equal(after.length, before + 1);
  assert.deepEqual(after.at(-1), { action: "file.download", target_type: "file", target_id: file.id, outcome: "ok", reason: null });
  for (const path of ["/files/00000000-0000-4000-8000-0000000000ee/content", "/files/not-a-uuid/content", "/files/00000000-0000-4000-8000-0000000000ee/thumb"]) {
    const result = await work(env, path);
    assert.deepEqual([result.status, result.json.error.code], [404, "NOT_FOUND"], path);
  }
  r2.objects.delete(rows(database, "SELECT r2_key FROM files WHERE id = ?", file.id)[0].r2_key);
  const missing = await work(env, `/files/${file.id}/content`);
  assert.deepEqual([missing.status, missing.json.error.code], [404, "NOT_FOUND"], "D1 행은 있는데 R2에 없음");
  r2.fail.get = true;
  const broken = await work(env, `/files/${file.id}/content`);
  assert.deepEqual([broken.status, broken.json.error.code], [503, "FILE_STORAGE_FAILED"]);
  assert.equal(audit(database).filter((entry) => entry.action === "file.download").length, 1, "못 돌려준 내려받기는 감사 기록 없음");
  const wrongMethod = await work(env, `/files/${file.id}/content`, { method: "DELETE", body: {} });
  assert.deepEqual([wrongMethod.status, wrongMethod.response.headers.get("Allow")], [405, "GET"]);
});

test("Q-2 미리보기: PUT 뒤 GET은 감사 없이 저장한 형식(WebP·JPEG)으로, 키는 원본 + .thumb. PNG·256KB 넘음·메타데이터·SHA 불일치는 거부(불일치는 이전 미리보기를 지우지 않음), 원본이 없거나 휴지통이면 404", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const file = (await upload(env, customerId, jpeg())).json.data.file;
  const key = rows(database, "SELECT r2_key FROM files WHERE id = ?", file.id)[0].r2_key;
  const none = await work(env, `/files/${file.id}/thumb`);
  assert.deepEqual([none.status, none.json.error.code], [404, "NOT_FOUND"], "미리보기를 아직 올리지 않음");
  const put = await putThumb(env, file.id, CLEAN_WEBP);
  assert.equal(put.status, 200, JSON.stringify(put.json));
  assert.equal(put.json.data.file.id, file.id);
  assert.ok(r2.objects.has(`${key}.thumb`));
  assert.deepEqual(r2.objects.get(`${key}.thumb`).customMetadata, { sha256: await sha(CLEAN_WEBP), kind: "property_photo" });
  const auditBefore = audit(database).length;
  const thumbResponse = await raw(env, `/files/${file.id}/thumb`, { method: "GET", headers: { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null } });
  assert.equal(thumbResponse.status, 200);
  assert.equal(thumbResponse.response.headers.get("Content-Type"), "image/webp");
  assert.equal(thumbResponse.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(new Uint8Array(await thumbResponse.response.arrayBuffer()), CLEAN_WEBP);
  assert.equal(audit(database).length, auditBefore, "미리보기 내려받기는 감사 기록 없음(손님 카드 열기 customer.view로 갈음)");
  const again = await putThumb(env, file.id, webp([chunk("VP8L", new Uint8Array(4))]));
  assert.equal(again.status, 200, "이미 있으면 덮어씀");
  // iPhone Safari: canvas가 WebP를 만들지 못해 JPEG 미리보기를 보낸다.
  const jpegThumb = jpeg({ scanBytes: 40 });
  const jpegPut = await putThumb(env, file.id, jpegThumb, { headers: { "Content-Type": "image/jpeg" } });
  assert.equal(jpegPut.status, 200, JSON.stringify(jpegPut.json));
  assert.deepEqual(r2.objects.get(`${key}.thumb`).httpMetadata, { contentType: "image/jpeg" });
  const jpegGet = await raw(env, `/files/${file.id}/thumb`, { method: "GET", headers: { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null } });
  assert.equal(jpegGet.status, 200);
  assert.equal(jpegGet.response.headers.get("Content-Type"), "image/jpeg", "저장한 형식 그대로");
  assert.deepEqual(new Uint8Array(await jpegGet.response.arrayBuffer()), jpegThumb);
  assert.deepEqual([...r2.objects.keys()].filter((name) => name.startsWith(key)).sort(), [key, `${key}.thumb`].sort(), "미리보기 키는 하나(형식이 바뀌어도 같은 키)");

  const rejected = [
    ["PNG 미리보기", bytesOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], new Uint8Array(16)), { "Content-Type": "image/png" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["JPEG라면서 WebP", CLEAN_WEBP, { "Content-Type": "image/jpeg" }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["JPEG 미리보기에 Exif", jpeg({ extra: [EXIF_APP1] }), { "Content-Type": "image/jpeg" }, 415, "IMAGE_METADATA_PRESENT"],
    ["256KB + 1바이트", webp([chunk("VP8 ", new Uint8Array(256 * 1024 + 1 - 20))]), {}, 413, "PAYLOAD_TOO_LARGE"],
    ["메타데이터 포함", webp([vp8x(0), VP8, chunk("EXIF", bytesOf("GPS"))]), {}, 415, "IMAGE_METADATA_PRESENT"],
    ["SHA-256 불일치", CLEAN_WEBP, { "X-Work-File-Sha256": "b".repeat(64) }, 422, "CHECKSUM_MISMATCH"],
    ["길이 없음", CLEAN_WEBP, { "Content-Length": null }, 413, "PAYLOAD_TOO_LARGE"],
  ];
  const putsBefore = puts(r2);
  for (const [name, bytes, headers, status, code] of rejected) {
    const result = await putThumb(env, file.id, bytes, { headers });
    assert.deepEqual([result.status, result.json.error.code], [status, code], name);
  }
  assert.equal(puts(r2), putsBefore + 1, "SHA-256 불일치만 R2까지 감");
  assert.deepEqual(r2.objects.get(`${key}.thumb`).bytes, jpegThumb, "덮어쓰기가 실패해도 이전 미리보기는 그대로");
  r2.objects.get(`${key}.thumb`).httpMetadata = { contentType: "image/png" };
  assert.equal((await work(env, `/files/${file.id}/thumb`)).status, 404, "저장된 형식이 WebP·JPEG가 아니면 404");
  const exact = await putThumb(env, file.id, webp([chunk("VP8 ", new Uint8Array(256 * 1024 - 20))]));
  assert.equal(exact.status, 200, "256KB 정확히는 받음");

  assert.equal((await putThumb(env, "00000000-0000-4000-8000-0000000000ee", CLEAN_WEBP)).status, 404, "없는 원본");
  const deleted = await work(env, `/files/${file.id}`, { method: "DELETE", body: {} });
  assert.equal(deleted.status, 200);
  const trashedPut = await putThumb(env, file.id, CLEAN_WEBP);
  assert.deepEqual([trashedPut.status, trashedPut.json.error.code], [404, "NOT_FOUND"], "원본이 휴지통에 있으면 미리보기 올리기 404");
  const trashedGet = await work(env, `/files/${file.id}/thumb`);
  assert.deepEqual([trashedGet.status, trashedGet.json.error.code], [404, "NOT_FOUND"], "원본이 휴지통에 있으면 미리보기 보기 404");
  assert.ok(r2.objects.has(key) && r2.objects.has(`${key}.thumb`), "휴지통 동안 R2 객체는 그대로");
});

test("T2-137h 설명 고치기: 200자는 받고 201자·주민번호 꼴·모르는 칸은 400, 마지막 쓰기가 이김(version 없음), 감사 file.update에 설명 없음", async () => {
  const { env, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const file = (await upload(env, customerId, jpeg())).json.data.file;
  const ok = await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "  가상 거실\n남향  " } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.data.file.caption, "가상 거실 남향", "한 줄로 정리");
  assert.equal((await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "가".repeat(200) } })).status, 200);
  for (const [name, body] of [["201자", { caption: "가".repeat(201) }], ["주민번호 꼴", { caption: "가상 900101-1234567" }], ["모르는 칸", { caption: "가상", customerId }], ["설명 아님", { caption: 3 }], ["빈 본문", {}]]) {
    const result = await work(env, `/files/${file.id}`, { method: "PATCH", body });
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], name);
  }
  // 두 화면이 같은 사진 설명을 차례로 고치면 둘 다 성공하고 나중 값이 남는다(동시 수정을 막지 않음, 3.1절 주의).
  const first = await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "가상 첫 화면" } });
  const second = await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "가상 둘째 화면" } });
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal(fileRows(database)[0].caption, "가상 둘째 화면");
  assert.equal((await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "" } })).json.data.file.caption, "", "비우기");
  assert.equal((await work(env, "/files/00000000-0000-4000-8000-0000000000ee", { method: "PATCH", body: { caption: "가상" } })).status, 404);
  const updates = audit(database).filter((entry) => entry.action === "file.update");
  assert.equal(updates.length, 5, "성공한 고치기 5번만 기록");
  assert.ok(!JSON.stringify(audit(database)).includes("가상"), "감사 기록에 설명·손님 이름 없음");
});

test("T2-137c·T2-137d 손님 삭제(사진 3장): R2 객체 그대로, files 행 0·휴지통 행 3, 주인 없는 사진 0. 되살리면 같은 r2_key로 3행이 돌아오고 다시 내려받을 수 있음", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 셋");
  const other = await makeCustomer(env, "가상 다른 손님");
  for (let index = 0; index < 3; index += 1) assert.equal((await upload(env, customerId, jpeg({ scanBytes: 10 + index }))).status, 201);
  assert.equal((await upload(env, other, jpeg())).status, 201);
  const ids = fileRows(database).filter((row) => row.customer_id === customerId);
  await putThumb(env, ids[0].id, CLEAN_WEBP);
  const before = fileRows(database);
  const objectsBefore = [...r2.objects.keys()].sort();
  const callsBefore = r2.calls.length;
  const deleted = await work(env, `/customers/${customerId}`, { method: "DELETE", body: { confirmName: "가상 손님 셋" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal(deleted.json.data.deleted.files, 3);
  assert.equal(r2.calls.length, callsBefore, "손님 삭제는 R2를 부르지 않음");
  assert.deepEqual([...r2.objects.keys()].sort(), objectsBefore, "R2 객체(미리보기 포함) 그대로");
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id = ?", customerId)[0].n, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id IS NULL AND deal_id IS NULL")[0].n, 0, "T2-137d 주인 없는 사진 0");
  assert.equal(rows(database, "SELECT count(*) AS n FROM files")[0].n, 1, "다른 손님 사진은 그대로");
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows WHERE table_name = 'files' AND op = 'row'")[0].n, 3);
  const listed = await work(env, "/trash");
  assert.equal(listed.json.data.items[0].counts.files, 3);
  const restored = await work(env, `/trash/${deleted.json.data.trash.batchId}/restore`, { method: "POST", body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.data.restored.files, 3);
  assert.deepEqual(fileRows(database), before, "같은 행·같은 r2_key로 돌아옴");
  const content = await raw(env, `/files/${ids[0].id}/content`, { method: "GET", headers: { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null } });
  assert.equal(content.status, 200);
});

test("사진이 있는 손님 삭제는 바인딩만 본다: 켜기 값을 꺼도 바인딩이 있으면 성공(사진은 휴지통으로), 바인딩이 없으면 409 FILES_REQUIRE_STORAGE", async () => {
  const { env, database } = filesSetup();
  const first = await makeCustomer(env, "가상 손님 꺼짐");
  const second = await makeCustomer(env, "가상 손님 바인딩 없음");
  assert.equal((await upload(env, first, jpeg())).status, 201);
  assert.equal((await upload(env, second, jpeg({ scanBytes: 9 }))).status, 201);
  const flagOff = { ...env, WORK_FILES_ENABLED: "false" };
  const allowed = await work(flagOff, `/customers/${first}`, { method: "DELETE", body: { confirmName: "가상 손님 꺼짐" } });
  assert.equal(allowed.status, 200, JSON.stringify(allowed.json));
  assert.equal(allowed.json.data.deleted.files, 1);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id = ?", first)[0].n, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows WHERE batch_id = ? AND table_name = 'files'", allowed.json.data.trash.batchId)[0].n, 1, "사진이 휴지통으로");
  const noBinding = { ...env, WORK_FILES: undefined };
  const blocked = await work(noBinding, `/customers/${second}`, { method: "DELETE", body: { confirmName: "가상 손님 바인딩 없음" } });
  assert.deepEqual([blocked.status, blocked.json.error.code], [409, "FILES_REQUIRE_STORAGE"]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id = ?", second)[0].n, 1, "아무것도 지우지 않음");
});

test("T2-137e 사진 하나 지우기 → 휴지통(이름 '사진 · 11월 17일 14:00 올림'·설명 앞 40자) → 영구 삭제: R2 실패면 503·휴지통 그대로, 성공하면 원본·미리보기 먼저 지운 뒤 휴지통 행 0", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 지우기");
  const plain = (await upload(env, customerId, jpeg())).json.data.file;
  const captioned = (await upload(env, customerId, jpeg({ scanBytes: 5 }))).json.data.file;
  await work(env, `/files/${captioned.id}`, { method: "PATCH", body: { caption: `가상 설명 ${"나".repeat(60)}` } });
  await putThumb(env, plain.id, CLEAN_WEBP);
  const key = rows(database, "SELECT r2_key FROM files WHERE id = ?", plain.id)[0].r2_key;
  const removed = await work(env, `/files/${plain.id}`, { method: "DELETE", body: {} });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.data.deleted, true);
  assert.match(removed.json.data.trash.batchId, UUID);
  assert.equal((await work(env, `/files/${captioned.id}`, { method: "DELETE", body: {} })).status, 200);
  assert.equal((await work(env, `/files/${plain.id}`, { method: "DELETE", body: {} })).status, 404, "이미 지운 사진");
  assert.equal((await work(env, `/files/${captioned.id}`, { method: "DELETE", body: { confirm: "x" } })).status, 400, "본문에 칸이 있으면 400");
  const items = (await work(env, "/trash")).json.data.items;
  const labels = Object.fromEntries(items.map((item) => [item.batchId, item]));
  assert.equal(labels[removed.json.data.trash.batchId].label, "사진 · 11월 17일 14:00 올림", "올린 시각(한국 시각), 월·일 앞 0 없음");
  assert.equal(labels[removed.json.data.trash.batchId].kind, "file");
  assert.equal(labels[removed.json.data.trash.batchId].counts.files, 1);
  assert.equal(items.find((item) => item.batchId !== removed.json.data.trash.batchId).label, `가상 설명 ${"나".repeat(34)}`, "설명 앞 40자");
  assert.ok(r2.objects.has(key) && r2.objects.has(`${key}.thumb`), "지운 뒤에도 R2 그대로");
  const deletes = audit(database).filter((entry) => entry.action === "file.delete");
  assert.deepEqual(deletes.map((entry) => entry.target_id).sort(), [plain.id, captioned.id].sort());

  r2.fail.delete = true;
  const failed = await purge(env, removed.json.data.trash.batchId);
  assert.deepEqual([failed.status, failed.json.error.code, failed.json.error.retryable], [503, "FILE_STORAGE_FAILED", true]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches WHERE id = ?", removed.json.data.trash.batchId)[0].n, 1, "R2 실패면 휴지통 묶음 그대로");
  assert.ok(r2.objects.has(key));
  const noBinding = await purge({ ...env, WORK_FILES: undefined }, removed.json.data.trash.batchId);
  assert.deepEqual([noBinding.status, noBinding.json.error.code], [503, "FILES_DISABLED"], "바인딩이 없으면 지우지 않음");
  r2.fail.delete = false;
  r2.objects.delete(`${key}.thumb`); // R2에 이미 없는 키도 성공으로 봄
  const purged = await purge(env, removed.json.data.trash.batchId);
  assert.equal(purged.status, 200, JSON.stringify(purged.json));
  assert.deepEqual(r2.calls.filter(([action]) => action === "delete").at(-1), ["delete", key, `${key}.thumb`], "원본·미리보기 두 키를 지움");
  assert.ok(!r2.objects.has(key));
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows WHERE batch_id = ?", removed.json.data.trash.batchId)[0].n, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches WHERE id = ?", removed.json.data.trash.batchId)[0].n, 0);
});

test("F-5 휴지통 사진 이름: 한국 날짜로 바꿔 월·일 앞 0 없이, 시:분은 두 자리(UTC 1월 4일 23:05 → '사진 · 1월 5일 08:05 올림')", async () => {
  const { env, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const id = "00000000-0000-4000-8000-0000000000c1";
  database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, created_at) VALUES (?, ?, 'property_photo', 'image/jpeg', 10, ?, ?, ?)")
    .run(id, `work/property_photo/2026/01/${id}.jpg`, "a".repeat(64), customerId, "2026-01-04T23:05:00.000Z");
  const removed = await work(env, `/files/${id}`, { method: "DELETE", body: {} });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(rows(database, "SELECT label FROM trash_batches WHERE id = ?", removed.json.data.trash.batchId)[0].label, "사진 · 1월 5일 08:05 올림");
});

test("T2-137e 7일 만료: R2 실패면 그 묶음만 남기고 TRASH_EXPIRE_R2_FAILED, 바인딩 없으면 TRASH_EXPIRE_NO_STORAGE, 사진 없는 묶음은 그대로 지움. 다음 날 R2가 되면 두 키를 지운 뒤 행 0", async () => {
  const { env, r2, db, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 만료");
  const photo = (await upload(env, customerId, jpeg())).json.data.file;
  await putThumb(env, photo.id, CLEAN_WEBP);
  const key = rows(database, "SELECT r2_key FROM files WHERE id = ?", photo.id)[0].r2_key;
  assert.equal((await work(env, `/files/${photo.id}`, { method: "DELETE", body: {} })).status, 200);
  const note = await work(env, "/notes", { method: "POST", body: { body: "가상 메모" } });
  assert.equal((await work(env, `/notes/${note.json.data.note.id}`, { method: "DELETE", body: {} })).status, 200);
  const batches = () => rows(database, "SELECT kind FROM trash_batches ORDER BY kind").map((row) => row.kind);
  assert.deepEqual(batches(), ["file", "note"]);

  const logs = [];
  const noStorage = await runTrashExpire(db, EXPIRE_AT, (entry) => logs.push(entry), nextUuid, null);
  assert.equal(noStorage.outcome, "ok");
  assert.deepEqual(batches(), ["file"], "바인딩이 없으면 사진 묶음은 남기고 메모 묶음은 지움");
  assert.ok(logs.some((entry) => entry.code === "TRASH_EXPIRE_NO_STORAGE" && entry.level === "warn"));

  r2.fail.delete = true;
  logs.length = 0;
  const failed = await runTrashExpire(db, EXPIRE_AT, (entry) => logs.push(entry), nextUuid, r2);
  assert.deepEqual([failed.outcome, failed.expired, failed.r2Failed], ["ok", 0, 1]);
  assert.deepEqual(batches(), ["file"], "R2 실패면 휴지통 행 그대로");
  assert.ok(r2.objects.has(key));
  assert.deepEqual(logs.map((entry) => [entry.code, entry.level]), [["TRASH_EXPIRE_R2_FAILED", "warn"]]);
  assert.ok(!JSON.stringify(logs).includes("work/"), "로그에 R2 키 없음");

  r2.fail.delete = false;
  const ok = await runTrashExpire(db, EXPIRE_AT, () => {}, nextUuid, r2);
  assert.deepEqual([ok.expired, ok.r2Failed, ok.noStorage], [1, 0, 0]);
  assert.deepEqual(batches(), []);
  assert.ok(!r2.objects.has(key) && !r2.objects.has(`${key}.thumb`), "원본·미리보기 모두 지움");
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows")[0].n, 0);
  assert.equal(audit(database).filter((entry) => entry.action === "trash.expire").length, 2);
});

test("T2-137f 손님 묶음을 되살리기 전에 사진 묶음만 되살리면 customer_missing으로 남고, 손님을 되살린 뒤 다시 누르면 들어감", async () => {
  const { env, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 순서");
  const single = (await upload(env, customerId, jpeg())).json.data.file;
  assert.equal((await upload(env, customerId, jpeg({ scanBytes: 7 }))).status, 201);
  const fileBatch = (await work(env, `/files/${single.id}`, { method: "DELETE", body: {} })).json.data.trash.batchId;
  const customerBatch = (await work(env, `/customers/${customerId}`, { method: "DELETE", body: { confirmName: "가상 손님 순서" } })).json.data.trash.batchId;
  const early = await work(env, `/trash/${fileBatch}/restore`, { method: "POST", body: {} });
  assert.equal(early.status, 200, JSON.stringify(early.json));
  assert.deepEqual(early.json.data.skipped, [{ table: "files", reason: "customer_missing", count: 1 }]);
  assert.deepEqual([early.json.data.restored.files, early.json.data.remaining], [0, 1]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files")[0].n, 0, "주인 없는 사진을 넣지 않음");
  assert.equal((await work(env, `/trash/${customerBatch}/restore`, { method: "POST", body: {} })).json.data.restored.files, 1);
  const late = await work(env, `/trash/${fileBatch}/restore`, { method: "POST", body: {} });
  assert.deepEqual([late.json.data.restored.files, late.json.data.remaining, late.json.data.skipped], [1, 0, []]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id = ?", customerId)[0].n, 2);
  // 같은 id가 이미 있으면 exists로 건너뛰고 휴지통에서 지움.
  const again = (await work(env, `/files/${single.id}`, { method: "DELETE", body: {} })).json.data.trash.batchId;
  database.prepare("INSERT INTO files SELECT json_extract(row_json, '$.id'), json_extract(row_json, '$.r2_key'), json_extract(row_json, '$.kind'), json_extract(row_json, '$.mime_type'),"
    + " json_extract(row_json, '$.byte_size'), json_extract(row_json, '$.sha256_hex'), json_extract(row_json, '$.customer_id'), NULL, 0, '', NULL, NULL, NULL, NULL, json_extract(row_json, '$.created_at') FROM trash_rows WHERE batch_id = ?").run(again);
  const exists = await work(env, `/trash/${again}/restore`, { method: "POST", body: {} });
  assert.deepEqual(exists.json.data.skipped, [{ table: "files", reason: "exists", count: 1 }]);
  assert.equal(exists.json.data.remaining, 0);
});

test("T2-137g 감사·로그: file.upload·file.thumb·file.download·file.update·file.delete에 파일 id만(설명·손님 이름 0), Worker 로그에 R2 키·설명 0", async () => {
  const { env, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 감사");
  const logs = [];
  const file = (await upload(env, customerId, jpeg(), { logs })).json.data.file;
  await putThumb(env, file.id, CLEAN_WEBP, { logs });
  await raw(env, `/files/${file.id}/content`, { method: "GET", logs, headers: { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null } });
  await work(env, `/files/${file.id}`, { method: "PATCH", body: { caption: "가상 비밀 설명" }, auditLog: (entry) => logs.push(entry) });
  await work(env, `/files/${file.id}`, { method: "DELETE", body: {}, auditLog: (entry) => logs.push(entry) });
  await upload(env, customerId, jpeg({ extra: [EXIF_APP1] }), { logs });
  await upload(env, customerId, jpeg(), { logs, headers: { "X-Work-File-Sha256": "c".repeat(64) } });
  const fileAudit = audit(database).filter((entry) => entry.action.startsWith("file."));
  assert.deepEqual(fileAudit.map((entry) => entry.action), ["file.upload", "file.thumb", "file.download", "file.update", "file.delete"]);
  assert.ok(fileAudit.every((entry) => entry.target_type === "file" && entry.target_id === file.id && entry.reason === null));
  const text = JSON.stringify(rows(database, "SELECT * FROM audit_events")) + JSON.stringify(logs);
  assert.ok(!text.includes("가상"), "감사·로그에 손님 이름·설명 없음");
  assert.ok(!text.includes("work/property_photo"), "감사·로그에 R2 키 없음");
});

test("CSRF·Origin: 사진 올리기도 Origin·업무 CSRF가 없으면 403, R2 put 0", async () => {
  const { env, r2 } = filesSetup();
  const customerId = await makeCustomer(env);
  const noCsrf = await upload(env, customerId, jpeg(), { headers: { "X-Admin-CSRF": null } });
  assert.deepEqual([noCsrf.status, noCsrf.json.error.code], [403, "CSRF_INVALID"]);
  const badOrigin = await upload(env, customerId, jpeg(), { headers: { Origin: "https://evil.example" } });
  assert.deepEqual([badOrigin.status, badOrigin.json.error.code], [403, "ORIGIN_DENIED"]);
  const thumbNoCsrf = await putThumb(env, "00000000-0000-4000-8000-0000000000ee", CLEAN_WEBP, { headers: { "X-Admin-CSRF": null } });
  assert.equal(thumbNoCsrf.status, 403);
  assert.equal(puts(r2), 0);
  const listFiles = await work(env, "/files");
  assert.deepEqual([listFiles.status, listFiles.response.headers.get("Allow")], [405, "POST"]);
});

// ── 계약서 사본(단계 4 K-a): 거래에 붙임·가림 확인·10장 상한·미리보기 없음 ─────────────────────

const GET_HEADERS = { Origin: null, "X-Admin-CSRF": null, "Content-Type": null, "Content-Length": null, "X-Work-File-Sha256": null };

async function makeDeal(env, { title = "가상 거래", parties = [] } = {}) {
  const created = await work(env, "/deals", { method: "POST", body: { title, dealType: "sale", propertyKind: "housing", parties } });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  return created.json.data.deal.id;
}

const uploadCopy = (env, dealId, bytes, { headers = {}, ...rest } = {}) =>
  raw(env, "/files", { bytes, headers: { "X-Work-File-Kind": "contract_copy", "X-Work-Owner": `deal:${dealId}`, "X-Work-Masked": "rrn=1", ...headers }, ...rest });
const copyRows = (database) => rows(database, "SELECT id, r2_key, kind, customer_id, deal_id, rrn_masked, retention_until FROM files ORDER BY id");

test("K-a 계약서 사본 올리기: deal:{uuid} + X-Work-Masked rrn=1이면 201, 거래에만 붙고(customer_id NULL) rrn_masked 1, 키는 work/contract_copy/…, 감사 reason은 kind=contract_copy", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 계약");
  const dealId = await makeDeal(env, { title: "가상 계약 거래", parties: [{ customerId, role: "buyer" }] });
  const logs = [];
  const bytes = jpeg({ scanBytes: 2048 });
  const created = await uploadCopy(env, dealId, bytes, { logs });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const file = created.json.data.file;
  assert.deepEqual(file, { id: file.id, kind: "contract_copy", mimeType: "image/jpeg", byteSize: bytes.length, caption: "", customerId: null, dealId, createdAt: new Date(NOW).toISOString() });
  const [row] = copyRows(database);
  assert.deepEqual(row, { id: file.id, r2_key: `work/contract_copy/2026/11/${file.id}.jpg`, kind: "contract_copy", customer_id: null, deal_id: dealId, rrn_masked: 1, retention_until: null });
  assert.deepEqual(r2.objects.get(row.r2_key).customMetadata, { sha256: await sha(bytes), kind: "contract_copy" });
  const uploads = audit(database).filter((entry) => entry.action === "file.upload");
  assert.deepEqual(uploads, [{ action: "file.upload", target_type: "file", target_id: file.id, outcome: "ok", reason: "kind=contract_copy" }]);
  const text = JSON.stringify(rows(database, "SELECT * FROM audit_events WHERE action LIKE 'file.%'")) + JSON.stringify(logs);
  assert.ok(!text.includes(dealId) && !text.includes("가상") && !text.includes("work/contract_copy"), "파일 감사·로그에 거래 번호·이름·R2 키 없음");
  // 손님 사진에 가림 머리가 와도 무시한다(rrn_masked 0).
  const photo = await upload(env, customerId, jpeg({ scanBytes: 3 }), { headers: { "X-Work-Masked": "rrn=1" } });
  assert.equal(photo.status, 201);
  assert.equal(rows(database, "SELECT rrn_masked FROM files WHERE id = ?", photo.json.data.file.id)[0].rrn_masked, 0);
  // 원본 내려받기는 사진과 같다(감사 file.download).
  const content = await raw(env, `/files/${file.id}/content`, { method: "GET", headers: GET_HEADERS });
  assert.deepEqual([content.status, content.response.headers.get("Cache-Control"), content.response.headers.get("Content-Disposition")], [200, "no-store", "inline"]);
  assert.equal(audit(database).filter((entry) => entry.action === "file.download" && entry.target_id === file.id).length, 1);
});

test("K-a 가림 확인·주인 규칙: X-Work-Masked가 없거나 rrn=1이 아니면 400 MASK_CONFIRMATION_REQUIRED, 계약서 사본에 customer:·손님 사진에 deal:은 400, 없는 거래는 404, R2 put 0", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const dealId = await makeDeal(env, { parties: [{ customerId, role: "buyer" }] });
  for (const masked of [null, "", "rrn=0", "1", "true", "rrn=1;x"]) {
    const result = await uploadCopy(env, dealId, jpeg(), { headers: { "X-Work-Masked": masked } });
    assert.deepEqual([result.status, result.json.error.code], [400, "MASK_CONFIRMATION_REQUIRED"], String(masked));
  }
  for (const owner of [`customer:${customerId}`, "", "deal:", "deal:not-a-uuid", null]) {
    const result = await uploadCopy(env, dealId, jpeg(), { headers: { "X-Work-Owner": owner } });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", ["X-Work-Owner"]], String(owner));
  }
  const photoOnDeal = await raw(env, "/files", { bytes: jpeg(), headers: { "X-Work-File-Kind": "other", "X-Work-Owner": `deal:${dealId}`, "X-Work-Masked": "rrn=1" } });
  assert.deepEqual([photoOnDeal.status, photoOnDeal.json.error.details], [400, ["X-Work-Owner"]], "손님 사진은 거래에 붙이지 않음");
  const missing = await uploadCopy(env, "00000000-0000-4000-8000-0000000000ee", jpeg());
  assert.deepEqual([missing.status, missing.json.error.code], [404, "NOT_FOUND"]);
  // 형식·메타데이터 검사는 사진과 같다.
  const exif = await uploadCopy(env, dealId, jpeg({ extra: [EXIF_APP1] }));
  assert.deepEqual([exif.status, exif.json.error.code], [415, "IMAGE_METADATA_PRESENT"]);
  assert.equal(puts(r2), 0);
  assert.equal(copyRows(database).length, 0);
});

test("K-a 한 거래에 계약서 사본 10장까지: 11번째는 본문을 읽지 않고 409 FILE_LIMIT_REACHED, 올리는 사이 10장이 차면 R2 보상 삭제 뒤 409, 거래가 그사이 지워지면 404", async () => {
  const { env, r2, db, database } = filesSetup();
  const customerId = await makeCustomer(env);
  const dealId = await makeDeal(env, { parties: [{ customerId, role: "buyer" }] });
  const otherDeal = await makeDeal(env, { title: "가상 다른 거래" });
  for (let index = 0; index < 9; index += 1) assert.equal((await uploadCopy(env, dealId, jpeg({ scanBytes: 20 + index }))).status, 201, `사본 ${index + 1}`);
  // 미리 확인은 통과(9장)했지만 batch 직전에 다른 화면이 10번째를 넣음 → guard가 되돌리고 R2 객체를 지운다.
  const at = new Date(NOW).toISOString();
  db.beforeNextBatch = () => database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, deal_id, rrn_masked, created_at) VALUES ('race-10', 'work/contract_copy/2026/11/race-10.jpg', 'contract_copy', 'image/jpeg', 10, ?, ?, 1, ?)").run("a".repeat(64), dealId, at);
  const objectsBefore = r2.objects.size;
  const raced = await uploadCopy(env, dealId, jpeg({ scanBytes: 99 }));
  assert.deepEqual([raced.status, raced.json.error.code], [409, "FILE_LIMIT_REACHED"]);
  assert.equal(r2.objects.size, objectsBefore, "보상 삭제로 R2에 남지 않음");
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE deal_id = ?", dealId)[0].n, 10);
  const putsBefore = puts(r2);
  const eleventh = await uploadCopy(env, dealId, jpeg({ scanBytes: 100 }));
  assert.deepEqual([eleventh.status, eleventh.json.error.code], [409, "FILE_LIMIT_REACHED"]);
  assert.equal(puts(r2), putsBefore, "상한에 닿았으면 R2를 부르지 않음");
  assert.equal((await uploadCopy(env, otherDeal, jpeg({ scanBytes: 101 }))).status, 201, "상한은 거래마다");
  // 휴지통으로 옮긴 사본은 세지 않는다.
  const one = rows(database, "SELECT id FROM files WHERE deal_id = ? AND id <> 'race-10' LIMIT 1", dealId)[0].id;
  assert.equal((await work(env, `/files/${one}`, { method: "DELETE", body: {} })).status, 200);
  assert.equal((await uploadCopy(env, dealId, jpeg({ scanBytes: 102 }))).status, 201, "한 장 지우면 다시 한 장");
  // 올리는 사이 거래가 지워짐 → 404, R2에 남지 않음.
  const gone = await makeDeal(env, { title: "가상 사라질 거래" });
  db.beforeNextBatch = () => database.prepare("DELETE FROM deals WHERE id = ?").run(gone);
  const sizeBefore = r2.objects.size;
  const vanished = await uploadCopy(env, gone, jpeg({ scanBytes: 103 }));
  assert.deepEqual([vanished.status, vanished.json.error.code], [404, "NOT_FOUND"]);
  assert.equal(r2.objects.size, sizeBefore);
});

test("K-a 계약서 사본은 미리보기를 만들지 않는다: PUT thumb은 본문을 읽지 않고 400 FILE_THUMB_NOT_ALLOWED, GET thumb은 R2를 부르지 않고 404", async () => {
  const { env, r2 } = filesSetup();
  const dealId = await makeDeal(env);
  const file = (await uploadCopy(env, dealId, jpeg())).json.data.file;
  const callsBefore = r2.calls.length;
  const put = await putThumb(env, file.id, CLEAN_WEBP);
  assert.deepEqual([put.status, put.json.error.code], [400, "FILE_THUMB_NOT_ALLOWED"]);
  const get = await raw(env, `/files/${file.id}/thumb`, { method: "GET", headers: GET_HEADERS });
  assert.deepEqual([get.status, get.json.error.code], [404, "NOT_FOUND"]);
  assert.equal(r2.calls.length, callsBefore, "R2 호출 0");
  assert.equal(r2.objects.size, 1, "원본만");
});

test("K-a 거래 삭제(사본 2장): 사본이 거래와 함께 휴지통으로(주인 없는 사본 0, R2 그대로), 되살리면 같은 행, 영구 삭제하면 R2에서 지움. 바인딩이 없으면 409 FILES_REQUIRE_STORAGE", async () => {
  const { env, r2, database } = filesSetup();
  const customerId = await makeCustomer(env, "가상 손님 거래삭제");
  const dealId = await makeDeal(env, { title: "가상 지울 거래", parties: [{ customerId, role: "buyer" }] });
  const keepDeal = await makeDeal(env, { title: "가상 남는 거래" });
  for (let index = 0; index < 2; index += 1) assert.equal((await uploadCopy(env, dealId, jpeg({ scanBytes: 30 + index }))).status, 201);
  assert.equal((await uploadCopy(env, keepDeal, jpeg({ scanBytes: 40 }))).status, 201);
  const before = copyRows(database);
  const keys = before.filter((row) => row.deal_id === dealId).map((row) => row.r2_key);
  const blocked = await work({ ...env, WORK_FILES: undefined }, `/deals/${dealId}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  assert.deepEqual([blocked.status, blocked.json.error.code], [409, "FILES_REQUIRE_STORAGE"]);
  assert.equal(copyRows(database).length, 3, "바인딩이 없으면 아무것도 지우지 않음");
  const callsBefore = r2.calls.length;
  const deleted = await work(env, `/deals/${dealId}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal(deleted.json.data.deleted.files, 2);
  assert.equal(r2.calls.length, callsBefore, "거래 삭제는 R2를 부르지 않음");
  assert.ok(keys.every((key) => r2.objects.has(key)), "R2 객체 그대로");
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id IS NULL AND deal_id IS NULL")[0].n, 0, "주인 없는 사본 0");
  assert.deepEqual(copyRows(database).map((row) => row.deal_id), [keepDeal], "다른 거래의 사본은 그대로");
  const batchId = deleted.json.data.trash.batchId;
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows WHERE batch_id = ? AND table_name = 'files' AND op = 'row'", batchId)[0].n, 2);
  assert.equal((await work(env, "/trash")).json.data.items.find((item) => item.batchId === batchId).counts.files, 2);
  const restored = await work(env, `/trash/${batchId}/restore`, { method: "POST", body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual([restored.json.data.restored.files, restored.json.data.skipped], [2, []]);
  assert.deepEqual(copyRows(database), before, "같은 행·같은 r2_key·rrn_masked로 돌아옴");
  const again = await work(env, `/deals/${dealId}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  const purged = await purge(env, again.json.data.trash.batchId);
  assert.equal(purged.status, 200, JSON.stringify(purged.json));
  assert.ok(keys.every((key) => !r2.objects.has(key)), "영구 삭제하면 R2에서 지움");
  assert.equal(r2.objects.size, 1, "다른 거래의 사본은 R2에 그대로");
});

test("K-a 손님 삭제: 단독 거래의 계약서 사본은 손님 사진과 함께 휴지통으로, 같이 하는 거래의 사본은 남는다. 되살리면 모두 돌아옴", async () => {
  const { env, database } = filesSetup();
  const x = await makeCustomer(env, "가상 손님 X");
  const y = await makeCustomer(env, "가상 손님 Y");
  const solo = await makeDeal(env, { title: "가상 단독 거래", parties: [{ customerId: x, role: "buyer" }] });
  const shared = await makeDeal(env, { title: "가상 같이 하는 거래", parties: [{ customerId: x, role: "buyer" }, { customerId: y, role: "seller" }] });
  assert.equal((await upload(env, x, jpeg({ scanBytes: 50 }))).status, 201);
  assert.equal((await uploadCopy(env, solo, jpeg({ scanBytes: 51 }))).status, 201);
  assert.equal((await uploadCopy(env, solo, jpeg({ scanBytes: 52 }))).status, 201);
  assert.equal((await uploadCopy(env, shared, jpeg({ scanBytes: 53 }))).status, 201);
  const before = copyRows(database);
  // 손님 카드: 거래마다 files[], 손님 files[]에는 사진만.
  const card = (await work(env, `/customers/${x}`)).json.data;
  assert.deepEqual(card.files.map((file) => file.kind), ["property_photo"]);
  const byTitle = Object.fromEntries(card.deals.map((deal) => [deal.title, deal.files]));
  assert.deepEqual([byTitle["가상 단독 거래"].length, byTitle["가상 같이 하는 거래"].length], [2, 1]);
  assert.ok(byTitle["가상 단독 거래"].every((file) => file.kind === "contract_copy" && file.dealId === solo && !("r2Key" in file)));
  assert.equal((await work(env, `/customers/${y}`)).json.data.deals[0].files.length, 1, "같이 하는 거래의 사본은 참여자 모두의 카드에");
  assert.equal((await work(env, `/deals/${solo}`)).json.data.files.length, 2, "거래 상세에도");
  const blocked = await work({ ...env, WORK_FILES: undefined }, `/customers/${x}`, { method: "DELETE", body: { confirmName: "가상 손님 X" } });
  assert.deepEqual([blocked.status, blocked.json.error.code], [409, "FILES_REQUIRE_STORAGE"]);
  const deleted = await work(env, `/customers/${x}`, { method: "DELETE", body: { confirmName: "가상 손님 X" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual([deleted.json.data.deleted.deals, deleted.json.data.deleted.files], [1, 3], "사진 1 + 단독 거래 사본 2");
  assert.equal(rows(database, "SELECT count(*) AS n FROM files WHERE customer_id IS NULL AND deal_id IS NULL")[0].n, 0, "주인 없는 파일 0");
  assert.deepEqual(copyRows(database).map((row) => row.deal_id), [shared], "같이 하는 거래의 사본만 남음");
  const restored = await work(env, `/trash/${deleted.json.data.trash.batchId}/restore`, { method: "POST", body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal(restored.json.data.restored.files, 3);
  assert.deepEqual(copyRows(database), before);
});

test("K-a 휴지통 이름과 되살리기 순서: 사본 한 장은 '계약서 사본 · 11월 17일 14:00 올림'(설명이 있으면 '계약서 사본 · 설명'), 거래가 없으면 deal_missing으로 남고 거래를 되살린 뒤 들어감", async () => {
  const { env, database } = filesSetup();
  const dealId = await makeDeal(env, { title: "가상 순서 거래" });
  const plain = (await uploadCopy(env, dealId, jpeg())).json.data.file;
  const captioned = (await uploadCopy(env, dealId, jpeg({ scanBytes: 8 }))).json.data.file;
  assert.equal((await work(env, `/files/${captioned.id}`, { method: "PATCH", body: { caption: "가상 특약 쪽" } })).status, 200);
  const plainBatch = (await work(env, `/files/${plain.id}`, { method: "DELETE", body: {} })).json.data.trash.batchId;
  const captionedBatch = (await work(env, `/files/${captioned.id}`, { method: "DELETE", body: {} })).json.data.trash.batchId;
  const labels = Object.fromEntries((await work(env, "/trash")).json.data.items.map((item) => [item.batchId, item.label]));
  assert.equal(labels[plainBatch], "계약서 사본 · 11월 17일 14:00 올림");
  assert.equal(labels[captionedBatch], "계약서 사본 · 가상 특약 쪽");
  const dealBatch = (await work(env, `/deals/${dealId}`, { method: "DELETE", body: { confirmTitle: "가상 순서 거래" } })).json.data.trash.batchId;
  const early = await work(env, `/trash/${plainBatch}/restore`, { method: "POST", body: {} });
  assert.deepEqual([early.json.data.restored.files, early.json.data.remaining, early.json.data.skipped], [0, 1, [{ table: "files", reason: "deal_missing", count: 1 }]]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files")[0].n, 0, "주인 없는 사본을 넣지 않음");
  assert.equal((await work(env, `/trash/${dealBatch}/restore`, { method: "POST", body: {} })).status, 200);
  const late = await work(env, `/trash/${plainBatch}/restore`, { method: "POST", body: {} });
  assert.deepEqual([late.json.data.restored.files, late.json.data.remaining, late.json.data.skipped], [1, 0, []]);
  assert.deepEqual(copyRows(database).map((row) => [row.id, row.deal_id, row.rrn_masked]), [[plain.id, dealId, 1]]);
});
