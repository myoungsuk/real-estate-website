// 손님 카드 '사진' 칸(단계 2 바로 찍기, F-b)의 순수 함수. 사진·설명은 모두 지어낸 값이다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  PHOTO_CAPTION_MAX,
  PHOTO_GO_LABEL,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_PICK_MAX,
  THUMB_MAX_BYTES,
  THUMB_MAX_EDGE,
  captionCountText,
  checkCaption,
  checkPickCount,
  fitSize,
  groupByDay,
  isUploadRetryable,
  photoAtText,
  photoButtonLabel,
  photoDayText,
  photoMetaText,
  photoShownText,
  photoSizeText,
  photoTimeText,
  photosOffText,
  prepareErrorText,
  uploadFailText,
  uploadTitleText,
  uploadedText,
} from "../src/lib/work/photo-view.mjs";

test("T2-138 한도는 사용자 결정·서버와 같다(긴 변 4096px·10MB, 미리보기 480px·256KB, 한 번에 10장, 설명 200자)", () => {
  assert.equal(PHOTO_MAX_EDGE, 4096);
  assert.equal(PHOTO_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(THUMB_MAX_EDGE, 480);
  assert.equal(THUMB_MAX_BYTES, 256 * 1024);
  assert.equal(PHOTO_PICK_MAX, 10);
  assert.equal(PHOTO_CAPTION_MAX, 200);
  assert.equal(PHOTO_GO_LABEL, "신분증·주민번호 없음 확인, 올리기", "Q-3 단추 이름(2026-11-22 15:23:20)");
});

test("줄일 크기: 긴 변만 맞추고 늘리지 않는다", () => {
  assert.deepEqual(fitSize(8064, 6048, 4096), { width: 4096, height: 3072 }, "48MP 가로");
  assert.deepEqual(fitSize(3024, 4032, 4096), { width: 3024, height: 4032 }, "12MP 세로는 그대로");
  assert.deepEqual(fitSize(6000, 9000, 480), { width: 320, height: 480 });
  assert.deepEqual(fitSize(10000, 1, 480), { width: 480, height: 1 }, "1px 밑으로 줄지 않음");
  assert.equal(fitSize(0, 100, 480), null);
  assert.equal(fitSize(Number.NaN, 100, 480), null);
});

test("한국 시각으로 날짜 묶음·시각을 쓴다(UTC 15시 이후는 다음 날)", () => {
  assert.equal(photoDayText("2026-11-22T05:05:00.000Z"), "11월 22일(일)");
  assert.equal(photoTimeText("2026-11-22T05:05:00.000Z"), "14:05");
  assert.equal(photoDayText("2026-11-21T15:30:00.000Z"), "11월 22일(일)");
  assert.equal(photoAtText("2026-11-22T05:05:00.000Z"), "11월 22일(일) 14:05");
  assert.equal(photoDayText("아님"), "날짜 모름");
  assert.equal(photoTimeText("아님"), "");
  const files = [
    { id: "a", createdAt: "2026-11-22T05:05:00.000Z" },
    { id: "b", createdAt: "2026-11-22T00:10:00.000Z" },
    { id: "c", createdAt: "2026-11-21T07:40:00.000Z" },
    { id: "d", createdAt: "2026-11-21T15:01:00.000Z" },
  ];
  assert.deepEqual(groupByDay(files).map((group) => [group.day, group.items.map((file) => file.id)]), [
    ["11월 22일(일)", ["a", "b"]],
    ["11월 21일(토)", ["c"]],
    ["11월 22일(일)", ["d"]],
  ], "받은 순서(최근 순)를 바꾸지 않고 이웃한 같은 날만 묶음");
  assert.deepEqual(groupByDay([]), []);
});

test("크기·장수·설명 검사(서버 요청 전)", () => {
  assert.equal(photoSizeText(2.84 * 1024 * 1024), "2.8MB");
  assert.equal(photoSizeText(200 * 1024), "200KB");
  assert.equal(photoSizeText(0), "");
  assert.deepEqual(checkPickCount(0), { ok: false, error: "" }, "고르기 창을 그냥 닫음");
  assert.equal(checkPickCount(10).ok, true);
  assert.equal(checkPickCount(12).error, "한 번에 10장까지 올릴 수 있습니다. 12장을 골랐으니 10장 이하로 다시 골라 주세요.");
  assert.deepEqual(checkCaption("  거실   창 쪽\n누수  "), { ok: true, value: "거실 창 쪽 누수" }, "서버와 같게 한 줄로 정리");
  assert.deepEqual(checkCaption(""), { ok: true, value: "" }, "빈 설명(지우기)은 받음");
  assert.equal(checkCaption("가".repeat(200)).ok, true);
  assert.equal(checkCaption("가".repeat(201)).error, "설명은 200자까지 넣을 수 있습니다.");
  for (const text of ["900101-1234567", "900101 1234567", "9001011234567", "９００１０１－１２３４５６７"]) {
    assert.equal(checkCaption(`집주인 ${text}`).error, "주민등록번호처럼 보이는 숫자는 사진 설명에 넣을 수 없습니다.", text);
  }
  assert.equal(checkCaption("관리비 12345678901234").ok, true, "앞뒤에 숫자가 더 붙으면 주민번호 꼴이 아님");
  assert.equal(captionCountText("거실"), "2/200");
});

test("사진 칸 글: 단추 이름·크게 보기 줄·더 보기·꺼짐", () => {
  const file = { id: "a", kind: "property_photo", createdAt: "2026-11-22T05:05:00.000Z", caption: "거실 창 쪽 누수" };
  assert.equal(photoButtonLabel(file), "사진 크게 보기 · 11월 22일(일) 14:05 · 거실 창 쪽 누수");
  assert.equal(photoButtonLabel({ ...file, caption: "" }), "사진 크게 보기 · 11월 22일(일) 14:05");
  assert.equal(photoMetaText(file, 0, 3), "현장 사진 · 11월 22일(일) 14:05 올림 · 3장 중 1번째");
  assert.equal(photoMetaText({ ...file, kind: "other" }, 2, 3), "기타 사진 · 11월 22일(일) 14:05 올림 · 3장 중 3번째");
  assert.equal(photoShownText(20, 24), "20장 보는 중 · 모두 24장");
  assert.equal(photoShownText(24, 24), "");
  assert.equal(photosOffText(0), "파일 저장소가 아직 켜지지 않았습니다. 켜지면 여기서 현장 사진을 바로 찍어 올릴 수 있습니다.");
  assert.equal(photosOffText(3), "파일 저장소가 아직 켜지지 않았습니다. 올려 둔 사진 3장은 저장소를 다시 켜면 보입니다.");
});

test("올리기 칸 제목·끝 알림(시안 2026-11-22 15:39:08)", () => {
  assert.deepEqual(uploadTitleText({ source: "camera", total: 1, done: 0, failed: 0, busy: false }), { title: "찍은 사진 확인", count: "" });
  assert.deepEqual(uploadTitleText({ source: "album", total: 3, done: 0, failed: 0, busy: false }), { title: "고른 사진 3장 확인", count: "" });
  assert.deepEqual(uploadTitleText({ source: "album", total: 1, done: 0, failed: 0, busy: false }), { title: "고른 사진 확인", count: "" });
  assert.deepEqual(uploadTitleText({ source: "album", total: 3, done: 1, failed: 0, busy: true }), { title: "올리는 중…", count: "3장 중 1장 올림" });
  assert.deepEqual(uploadTitleText({ source: "album", total: 3, done: 2, failed: 1, busy: false }), { title: "! 사진 1장을 올리지 못했습니다", count: "" });
  assert.equal(uploadedText(3), "✓ 사진 3장을 올렸습니다.");
});

test("T2-139a·T2-139b 못 올린 까닭과 '다시 올리기'를 보일지", () => {
  const fallback = (code) => `손님 화면 문장(${code})`;
  assert.equal(uploadFailText(null, fallback), "인터넷이 끊겼거나 서버가 잠시 답하지 않았습니다.");
  assert.match(uploadFailText("CHECKSUM_MISMATCH", fallback), /'다시 올리기'/u);
  assert.equal(uploadFailText("STORAGE_UNAVAILABLE", fallback), "손님 화면 문장(STORAGE_UNAVAILABLE)");
  // 로그인·보안 확인 만료: 새로고침하면 못 올린 사진이 없어지므로 새로고침하라고 하지 않고 '다시 올리기'를 남긴다(날개-2 검토 11-22)
  assert.equal(uploadFailText("AUTH_REQUIRED", fallback), "관리자 로그인이 만료되었습니다. 새 탭에서 관리자 화면을 열어 다시 로그인한 뒤 '다시 올리기'를 누르세요.");
  assert.match(uploadFailText("CSRF_INVALID", fallback), /새로고침하지 말고 '다시 올리기'/u);
  for (const code of [null, undefined, "CHECKSUM_MISMATCH", "FILE_STORAGE_FAILED", "STORAGE_UNAVAILABLE", "CSRF_INVALID", "AUTH_REQUIRED"]) assert.equal(isUploadRetryable(code), true, String(code));
  for (const code of ["FILES_DISABLED", "PAYLOAD_TOO_LARGE", "IMAGE_METADATA_PRESENT", "UNSUPPORTED_MEDIA_TYPE", "NOT_FOUND", "WORK_SCHEMA_OUTDATED"]) assert.equal(isUploadRetryable(code), false, code);
  assert.match(prepareErrorText("TOO_LARGE"), /10MB가 넘어/u);
  assert.match(prepareErrorText("DECODE_FAILED", 2), /^2장: 이 파일은 사진으로 읽을 수 없습니다/u);
  assert.equal(prepareErrorText("모름"), prepareErrorText("ENCODE_FAILED"));
});
