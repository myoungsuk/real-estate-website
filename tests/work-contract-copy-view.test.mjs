// 손님 카드 거래 칸 '계약서 사본'(단계 4 K-b)의 화면 문장·크기 계산과, 화면 원본이 지켜야 할 약속(가리기 전 사진·미리보기를 보내지 않음, 저장소·blob: 주소를 쓰지 않음).
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  COPY_ERROR_TEXTS,
  COPY_FULL_TEXT,
  COPY_KIND,
  COPY_MAX_PER_DEAL,
  COPY_ZOOM_TIMES,
  copyCheckText,
  copyErrorText,
  copyFailText,
  copyFilesOf,
  copyHeadText,
  copyOffText,
  copyRowText,
  copyToggleText,
  copyZoom,
  copyZoomStart,
  copyZoomText,
  isCopyFull,
  isCopyRetryable,
} from "../src/lib/work/contract-copy-view.mjs";
import { photoShortAtText } from "../src/lib/work/photo-view.mjs";
import { FILE_CONTRACT_COPY_MAX_PER_DEAL, FILE_KINDS_DEAL_OWNED, FILE_MASK_CONFIRMED } from "../worker/work-input.mjs";

// Windows에서 받은 원본은 줄 끝이 CRLF라, 줄바꿈을 보는 정규식이 같게 돌도록 LF로 맞춘다.
const readSource = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/gu, "\n");
const fallback = (code) => `손님 화면 문장(${code})`;

test("종류·장수 한도·가림 확인 표시는 서버 값과 같다", async () => {
  assert.deepEqual(FILE_KINDS_DEAL_OWNED, [COPY_KIND]);
  assert.equal(COPY_MAX_PER_DEAL, FILE_CONTRACT_COPY_MAX_PER_DEAL);
  const client = await readSource("src/lib/work-files-client.ts");
  assert.ok(client.includes(`"X-Work-File-Kind": "${COPY_KIND}"`), "올리기 종류");
  assert.ok(client.includes(`"X-Work-Masked": "${FILE_MASK_CONFIRMED}"`), "가림 확인 표시");
  assert.ok(client.includes("\"X-Work-Owner\": `deal:${input.dealId}`"), "주인은 거래");
});

test("거래의 파일 가운데 계약서 사본만 받은 순서대로 고른다(옛 응답처럼 files가 없어도 빈 목록)", () => {
  const files = [{ id: "a", kind: "contract_copy" }, { id: "b", kind: "other" }, { id: "c", kind: "contract_copy" }];
  assert.deepEqual(copyFilesOf({ files }).map((file) => file.id), ["a", "c"]);
  assert.deepEqual(copyFilesOf({}), []);
  assert.deepEqual(copyFilesOf(null), []);
});

test("접어 둔 단추·펼친 제목·목록 줄·한도 글", () => {
  assert.equal(copyToggleText(0, false), "계약서 사본 0장");
  assert.equal(copyToggleText(2, false), "계약서 사본 2장");
  assert.equal(copyToggleText(2, true), "계약서 사본 접기");
  assert.equal(copyHeadText(0), "아직 없음 · 10장까지");
  assert.equal(copyHeadText(2), "2장 · 10장까지");
  assert.equal(photoShortAtText("2026-11-23T01:40:00.000Z"), "11월 23일 10:40", "한국 시각, 요일 없음");
  assert.equal(photoShortAtText("2026-11-23T15:05:00.000Z"), "11월 24일 00:05", "UTC 15시 이후는 다음 날");
  assert.equal(photoShortAtText("없음"), "");
  assert.equal(copyRowText({ createdAt: "2026-11-23T01:40:00.000Z" }), "계약서 사본 · 11월 23일 10:40 올림", "휴지통 묶음 이름과 같은 꼴");
  assert.equal(copyRowText({ createdAt: "" }), "계약서 사본");
  assert.equal(isCopyFull(9), false);
  assert.equal(isCopyFull(10), true);
  assert.match(COPY_FULL_TEXT, /^10장을 다 채웠습니다/u);
  assert.match(copyOffText(0), /파일 저장소가 아직 켜지지 않았습니다/u);
  assert.match(copyOffText(3), /계약서 사본 3장/u);
});

test("확대 확인의 폭: 사진 자리 폭의 4배와 사진 폭 가운데 작은 쪽(실제 크기보다 크게 늘리지 않음)", () => {
  assert.equal(COPY_ZOOM_TIMES, 4);
  assert.deepEqual(copyZoom(3024, 336), { width: 1344, natural: false }, "휴대폰 사진 + 360px 화면: 4배");
  assert.deepEqual(copyZoom(4032, 896), { width: 3584, natural: false });
  assert.deepEqual(copyZoom(3024, 896), { width: 3024, natural: true }, "PC: 4배가 사진 폭보다 크면 실제 크기");
  assert.deepEqual(copyZoom(1200, 336), { width: 1200, natural: true });
  assert.deepEqual(copyZoom(200, 336), { width: 200, natural: true }, "작은 그림도 늘리지 않음");
  for (const bad of [[0, 336], [3024, 0], [Number.NaN, 336], [3024, Number.POSITIVE_INFINITY], [-1, 336]]) assert.equal(copyZoom(...bad), null, String(bad));
  assert.equal(copyZoomText({ width: 1344, natural: false }), "화면 폭의 4배로 보는 중");
  assert.equal(copyZoomText({ width: 1200, natural: true }), "실제 크기로 보는 중");
  assert.equal(copyZoomText(null), "");
  assert.equal(copyCheckText(2, { width: 1344, natural: false }), "2곳 가림 · 화면 폭의 4배로 보는 중");
  assert.equal(copyCheckText(1, null), "1곳 가림");
  // 숫자 높이 어림(주석의 까닭): 3024px 폭 사진의 43px 숫자가 360px 화면에서 2배면 10px 아래, 4배면 16px(본문 글자) 위
  const digit = 43;
  assert.ok(digit * ((336 * 2) / 3024) < 10);
  assert.ok(digit * (copyZoom(3024, 336).width / 3024) > 16);
});

test("확대 확인을 열면 첫 네모가 가운데 오고, 사진 밖으로는 옮기지 않는다", () => {
  assert.deepEqual(copyZoomStart({ x: 620, y: 1000, w: 420, h: 70 }, 1, { width: 336, height: 400 }), { left: 662, top: 835 });
  assert.deepEqual(copyZoomStart({ x: 0, y: 0, w: 40, h: 40 }, 0.5, { width: 336, height: 400 }), { left: 0, top: 0 });
  assert.deepEqual(copyZoomStart(undefined, 1, { width: 336, height: 400 }), { left: 0, top: 0 });
  assert.deepEqual(copyZoomStart({ x: 10, y: 10, w: 10, h: 10 }, 0, { width: 336, height: 400 }), { left: 0, top: 0 });
});

test("서버의 새 오류 코드 3개와 올리기 오류는 화면 글이 있고, 다시 올릴 만한 것만 '다시 올리기'를 남긴다", () => {
  for (const code of ["FILE_LIMIT_REACHED", "MASK_CONFIRMATION_REQUIRED", "FILE_THUMB_NOT_ALLOWED"]) {
    assert.ok(COPY_ERROR_TEXTS[code].length > 10, code);
    assert.equal(copyFailText(code, fallback), COPY_ERROR_TEXTS[code]);
    assert.equal(copyErrorText(code, fallback), COPY_ERROR_TEXTS[code]);
  }
  assert.match(copyFailText("FILE_LIMIT_REACHED", fallback), /10장까지/u);
  assert.match(copyFailText("NOT_FOUND", fallback), /거래나 사본/u, "손님 사진 문장(손님이나 사진) 대신");
  assert.match(copyFailText(null, fallback), /인터넷이 끊겼거나/u);
  assert.match(copyFailText("AUTH_REQUIRED", fallback), /새 탭에서 관리자 화면을 열어 다시 로그인한 뒤 '다시 올리기'/u, "새로고침하라고 하지 않음(가린 사본이 없어짐)");
  assert.match(copyFailText("FILE_STORAGE_FAILED", fallback), /'다시 올리기'/u);
  assert.equal(copyFailText("STORAGE_UNAVAILABLE", fallback), "손님 화면 문장(STORAGE_UNAVAILABLE)");
  assert.equal(copyErrorText(null, fallback), "손님 화면 문장()");
  for (const code of [null, "AUTH_REQUIRED", "CSRF_INVALID", "FILE_STORAGE_FAILED", "CHECKSUM_MISMATCH", "FILE_LIMIT_REACHED"]) assert.equal(isCopyRetryable(code), true, String(code));
  for (const code of ["MASK_CONFIRMATION_REQUIRED", "FILE_THUMB_NOT_ALLOWED", "FILES_DISABLED", "NOT_FOUND", "IMAGE_METADATA_PRESENT", "PAYLOAD_TOO_LARGE"]) assert.equal(isCopyRetryable(code), false, code);
});

test("화면 원본: 가린 사본 하나만 올리고, 미리보기·브라우저 저장소·blob: 주소·주소 변경을 쓰지 않으며 한 번에 한 장만 고른다", async () => {
  const [section, page, view] = await Promise.all([
    readSource("src/lib/work-contract-copy-section.ts"),
    readSource("src/pages/admin/work/customers/detail.astro"),
    readSource("src/lib/work/contract-copy-view.mjs"),
  ]);
  for (const banned of ["localStorage", "sessionStorage", "indexedDB", "createObjectURL", "history.", "location.", "uploadThumb", "uploadPhoto", "fetch(", "toDataURL"]) {
    assert.ok(!section.includes(banned), `부품에 ${banned} 없음`);
    assert.ok(!view.includes(banned), `문장 함수에 ${banned} 없음`);
  }
  assert.equal(section.split("uploadContractCopy(").length - 1, 1, "서버로 올리는 곳은 한 곳");
  assert.match(section, /paint: paintBlack/u, "검은 칠");
  assert.match(section, /exportJpeg\(\{ quality, allowEmpty \}\)/u);
  assert.match(section, /const allowEmpty = step === "ask";/u, "가린 곳 0개는 한 번 더 물은 길에서만 내보냄");
  assert.match(section, /uploading = true;\n[^\n]*\n\s*source\.setLocked\(true\);/u, "올리기를 시작하면 바로 편집기를 잠금(끌던 네모는 버림)");
  assert.match(section, /current\.ready\.state !== state\) current\.ready = /u, "칠한 상태가 달라진 사본은 다시 쓰지 않음");
  assert.equal(section.split("job.ready = ").length - 1, 0, "올릴 사본을 버리는 곳은 upload의 대조 한 곳");
  assert.match(section, /source = await decodeScaled\(file\);\n[^\n]*\n\s*if \(current !== sequence\) return;\n\s*const opened = await openMaskEditor\(/u, "그만둔 사진은 편집기를 열지 않음");
  assert.match(section, /cancelled: \(\) => current !== sequence,/u);
  const album = /<input[^>]*data-kc-album-input[^>]*>/u.exec(page)?.[0] ?? "";
  const camera = /<input[^>]*data-kc-camera-input[^>]*>/u.exec(page)?.[0] ?? "";
  assert.ok(album && !/\bmultiple\b/u.test(album), "사진첩은 한 장만");
  assert.match(camera, /capture="environment"/u);
  assert.match(page, /article\.append\(copies\.block\(deal\)\);/u, "거래 칸마다 사본 칸");
  assert.match(page, /!photos\.hasPending\(\) && !copies\.hasPending\(\)/u, "칠하던 사본이 있으면 떠날 때 물음");
});
