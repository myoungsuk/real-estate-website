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
