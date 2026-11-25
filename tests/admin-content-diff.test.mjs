import test from "node:test";
import assert from "node:assert/strict";
import { createAdminContentDiff, isAdminContentEqual } from "../src/lib/admin-content-diff.mjs";

test("관리자 diff는 JSON key 순서만 다른 값을 변경으로 보지 않는다", () => {
  const before = { broker: { headline: "공개 문장", lead: "소개" } };
  const after = { broker: { lead: "소개", headline: "공개 문장" } };
  assert.equal(isAdminContentEqual(before, after), true);
  assert.deepEqual(createAdminContentDiff("home-content", before, after), []);
});

test("관리자 diff는 공개 필드 라벨과 추가·수정·삭제·순서 변경을 구분한다", () => {
  const before = {
    checkedAt: "2026-08-30",
    items: [
      { id: "100", title: "첫 매물", summary: "기존 설명" },
      { id: "200", title: "둘째 매물", summary: "삭제될 설명" },
    ],
  };
  const after = {
    checkedAt: "2026-08-31",
    items: [
      { id: "300", title: "새 매물", summary: "추가 설명" },
      { id: "100", title: "첫 매물", summary: "변경 설명" },
    ],
  };
  const diffs = createAdminContentDiff("naver-listings", before, after);
  assert.ok(diffs.some((diff) => diff.path === "checkedAt" && diff.kind === "changed"));
  assert.ok(diffs.some((diff) => diff.path === "items[200]" && diff.kind === "removed"));
  assert.ok(diffs.some((diff) => diff.path === "items[300]" && diff.kind === "added"));
  assert.ok(diffs.some((diff) => diff.path === "items[100].summary" && diff.kind === "changed"));
  assert.ok(diffs.every((diff) => !diff.label.includes("undefined")));
});

test("관리자 diff는 공개 순서 변경을 별도 표시하고 민감 문자열을 가린다", () => {
  const reordered = createAdminContentDiff("faq", [
    { id: "first", question: "첫 질문", answer: "답" },
    { id: "second", question: "둘째 질문", answer: "답" },
  ], [
    { id: "second", question: "둘째 질문", answer: "답" },
    { id: "first", question: "첫 질문", answer: "답" },
  ]);
  assert.ok(reordered.some((diff) => diff.kind === "reordered"));

  const redacted = createAdminContentDiff("home-content", { broker: { headline: "이전" } }, {
    broker: { headline: "연락처 010-1234-5678 test@example.com" },
    secretToken: "abcdefghijklmnopqrstuvwxyz1234567890",
  });
  assert.match(redacted[0].after, /휴대전화번호 가림/u);
  assert.match(redacted[0].after, /이메일 가림/u);
  assert.equal(redacted.some((diff) => diff.path.includes("secretToken")), false);
});

test("관리자 diff는 거래 완료 소식 한 건을 홈에 보일 한 줄과 공개 여부로 보인다(번호만 보이지 않음)", () => {
  const old = { id: "dn-0000000000000001", status: "published", placeKind: "area", umdName: "판암동", propertyKind: "apartment", dealType: "sale", areaBand: 59 };
  const added = { id: "dn-0000000000000002", status: "published", placeKind: "complex", umdName: "천동", complexName: "가상숲1단지", propertyKind: "apartment", dealType: "jeonse", areaBand: 84 };
  const diffs = createAdminContentDiff("deal-news", [old], [added]);
  assert.deepEqual(diffs.map((diff) => [diff.kind, diff.label, diff.before, diff.after]), [
    ["removed", "거래 완료 소식 · 소식 한 건", "판암동 아파트 · 전용 59㎡대 · 매매 (홈에 공개)", "없음"],
    ["added", "거래 완료 소식 · 소식 한 건", "없음", "가상숲1단지 · 전용 84㎡대 · 전세 (홈에 공개)"],
  ]);
  // 다른 자료는 그대로 번호·제목 요약을 쓴다.
  assert.equal(createAdminContentDiff("external-links", [], [{ id: "x-1", title: "글" }])[0].after, "글 · x-1");
});
