import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOG_POLL_FAST_FOR_MS,
  BLOG_POLL_FAST_MS,
  BLOG_POLL_SLOW_MS,
  BLOG_RESULT_KEEP_MINUTES,
  BLOG_RETENTION_DAYS,
  apiErrorText,
  CHECKLIST_HEADING,
  blogCopyText,
  checkView,
  decimalFrom,
  draftStatusText,
  failView,
  intFrom,
  isOpenStatus,
  limitsView,
  missingText,
  normalizeHashtags,
  pollDelayMs,
  snsCopyText,
  usdText,
  usdToMicro,
  whereLabel,
} from "../src/lib/work/blog-view.mjs";
import { BLOG_RESULT_KEEP_MS, BLOG_RETENTION_DAYS as SERVER_RETENTION_DAYS } from "../worker/work-blog.mjs";

test("글 초안 화면: 결과 확인 간격은 처음 1분 5초, 그 뒤 15초이고 보관 시간·보관 일수는 서버 값과 같다", () => {
  assert.equal(pollDelayMs(0), BLOG_POLL_FAST_MS);
  assert.equal(pollDelayMs(BLOG_POLL_FAST_FOR_MS - 1), 5_000);
  assert.equal(pollDelayMs(BLOG_POLL_FAST_FOR_MS), BLOG_POLL_SLOW_MS);
  assert.equal(pollDelayMs(10 * 60_000), 15_000);
  assert.equal(BLOG_RESULT_KEEP_MINUTES * 60_000, BLOG_RESULT_KEEP_MS);
  assert.equal(BLOG_RETENTION_DAYS, SERVER_RETENTION_DAYS);
});

test("글 초안 화면: 숫자 칸은 빈 칸 null, 형식 밖 NaN, 쉼표·전각 숫자는 정리해 읽는다", () => {
  assert.equal(intFrom(""), null);
  assert.equal(intFrom("  "), null);
  assert.equal(intFrom("1,250,000"), 1_250_000);
  assert.equal(intFrom("１２"), 12);
  assert.ok(Number.isNaN(intFrom("12층")));
  assert.ok(Number.isNaN(intFrom("1.5")));
  assert.equal(decimalFrom("84.97"), 84.97);
  assert.ok(Number.isNaN(decimalFrom("84.975")));
  assert.equal(decimalFrom("84.975", 3), 84.975);
  assert.equal(decimalFrom(""), null);
  assert.ok(Number.isNaN(decimalFrom("-3")));
});

test("글 초안 화면: 달러 칸은 마이크로달러와 오가며 셋째 자리는 버린다", () => {
  assert.equal(usdToMicro("10"), 10_000_000);
  assert.equal(usdToMicro("10.5"), 10_500_000);
  assert.equal(usdToMicro("$0.05"), 50_000);
  assert.equal(usdToMicro("10.555"), null);
  assert.equal(usdToMicro("열"), null);
  assert.equal(usdToMicro(""), null);
  assert.equal(usdText(10_000_000), "10.00");
  assert.equal(usdText(429_999), "0.42");
  assert.equal(usdText(Number.NaN), "");
});

test("글 초안 화면: 한도가 없거나 오늘 편수·이번 달 비용에 닿으면 만들기를 막는 이유를 준다", () => {
  const base = {
    dailyCreateLimit: 10,
    monthlyCostLimitMicroUsd: 10_000_000,
    usage: { day: "2026-11-20", todayCreates: 3, monthCostMicroUsd: 1_230_000 },
  };
  assert.deepEqual(limitsView(null), { saved: false, line: "", reason: "AI 사용 한도를 불러오지 못했습니다." });
  const unsaved = limitsView({ ...base, dailyCreateLimit: null });
  assert.equal(unsaved.saved, false);
  assert.match(unsaved.reason, /저장하면 만들 수 있습니다/u);
  const ok = limitsView(base);
  assert.deepEqual(ok, { saved: true, line: "오늘 3 / 10편 · 이번 달 1.23 / 10.00달러(추정)", reason: null });
  assert.match(limitsView({ ...base, usage: { ...base.usage, todayCreates: 10 } }).reason, /오늘 10편을 다 써서/u);
  assert.match(limitsView({ ...base, usage: { ...base.usage, monthCostMicroUsd: 10_000_000 } }).reason, /이번 달 비용 상한/u);
});

test("글 초안 화면: 명시사항 빈 칸 이름은 겹치지 않게 한국어 이름으로 잇는다", () => {
  assert.equal(missingText(["location", "area", "location"]), "소재지·면적");
  assert.equal(missingText(["zz_unknown"]), "zz_unknown");
  assert.equal(apiErrorText("DISCLOSURE_INCOMPLETE", ["location", "price"]), "명시사항 빈 칸을 먼저 채워 주세요: 소재지·가격.");
});

test("글 초안 화면: 검사 결과는 같은 자리·같은 종류를 한 줄로 묶고, 막힘이 있을 때만 복사를 막는다", () => {
  assert.equal(whereLabel("title"), "제목");
  assert.equal(whereLabel("sns"), "SNS 짧은 글");
  assert.equal(whereLabel("p2"), "문단 2");
  const view = checkView({
    blocks: [
      { kind: "money", text: "5억", where: "p1" },
      { kind: "money", text: "5억", where: "p1" },
      { kind: "money", text: "6억", where: "p1" },
      { kind: "floor", text: "12층", where: "title" },
    ],
    warnings: [{ kind: "pyeong", text: "34평", where: "sns" }],
  });
  assert.equal(view.canCopy, false);
  assert.deepEqual(view.blocks.map((item) => [item.label, item.whereLabel, item.text]), [
    ["입력과 다른 금액", "문단 1", "'5억', '6억'"],
    ["입력과 다른 층", "제목", "'12층'"],
  ]);
  assert.deepEqual(view.warnings.map((item) => [item.label, item.whereLabel]), [["'평' 표기", "SNS 짧은 글"]]);
  const warnOnly = checkView({ blocks: [], warnings: [{ kind: "hype", text: "무조건", where: "p1" }] });
  assert.equal(warnOnly.canCopy, true, "확인 항목만 있으면 복사할 수 있음");
  assert.deepEqual(checkView(null), { blocks: [], warnings: [], canCopy: true });
});

test("글 초안 화면: 복사 글은 해시태그를 정리하고 맨 끝에 구분선과 명시사항을 붙인다", () => {
  assert.deepEqual(normalizeHashtags("#대전동구 천동, ##천동  #대전동구"), ["#대전동구", "#천동"]);
  assert.deepEqual(normalizeHashtags(""), []);
  const disclosureText = "중개사무소 ZZTEST-7F3A";
  const blog = blogCopyText({ title: " 제목 ", paragraphs: ["첫 문단", "  ", "둘째 문단"], hashtags: ["#천동"], disclosureText });
  assert.equal(blog, "제목\n\n첫 문단\n\n둘째 문단\n\n#천동\n\n──────────\n중개사무소 ZZTEST-7F3A");
  const noTags = blogCopyText({ title: "제목", paragraphs: ["문단"], hashtags: [], disclosureText });
  assert.equal(noTags, "제목\n\n문단\n\n──────────\n중개사무소 ZZTEST-7F3A");
  const sns = snsCopyText({ snsShort: " 짧은 글 ", hashtags: ["#천동", "#대전"], disclosureText });
  assert.equal(sns, "짧은 글\n\n#천동 #대전\n\n──────────\n중개사무소 ZZTEST-7F3A");
  assert.ok(sns.endsWith(disclosureText), "명시사항은 AI 글이 아니라 화면이 맨 끝에 붙임");
});

test("글 초안 화면: 보관 목록 상태 글은 열린 초안·닫힌 초안을 구분하고 닫힌 초안에는 지울 날을 붙인다", () => {
  const createdAt = "2026-11-20T06:51:00.000Z";
  assert.equal(draftStatusText({ status: "in_progress", closed: null, createdAt, closedAt: null }), "만드는 중 · 11. 20. 15:51");
  assert.equal(draftStatusText({ status: "completed", closed: null, createdAt, closedAt: null }), "다 만듦 · 11. 20. 15:51");
  assert.equal(
    draftStatusText({ status: "completed", closed: "confirmed", createdAt, closedAt: "2026-11-20T07:00:00.000Z" }),
    "다 씀 · 11. 20. 15:51 · 12. 20. 지움",
  );
  assert.equal(draftStatusText({ status: "completed", closed: "cancelled", createdAt, closedAt: null }), "버림 · 11. 20. 15:51");
  assert.equal(isOpenStatus("queued"), true);
  assert.equal(isOpenStatus("in_progress"), true);
  assert.equal(isOpenStatus("completed"), false);
  assert.equal(isOpenStatus("unknown"), false);
});

test("글 초안 화면: 실패 판은 오류마다 제목·설명을 주고, 설정·요청 오류에서만 '다시 만들기'를 숨긴다", () => {
  const expired = failView({ status: "expired", errorCode: null });
  assert.match(expired.title, /10분 지남/u);
  assert.match(expired.body, new RegExp(`${BLOG_RESULT_KEEP_MINUTES}분이 지나`, "u"));
  assert.equal(expired.retry, true);
  assert.match(failView({ status: "unknown", errorCode: null }).title, /확인하지 못했습니다/u);
  assert.match(failView({ status: "failed", errorCode: "AI_RATE_LIMITED" }).body, /비용도 들지 않았습니다/u);
  assert.equal(failView({ status: "failed", errorCode: "AI_CONFIG_INVALID" }).retry, false);
  assert.equal(failView({ status: "failed", errorCode: "AI_REQUEST_INVALID" }).retry, false);
  assert.deepEqual(failView({ status: "failed", errorCode: "ZZ_NEW_CODE" }), failView({ status: "failed", errorCode: "AI_UPSTREAM_FAILED" }));
});

test("글 초안 화면: 오류 문구는 한도 초과를 하루·월로 나누고, 모르는 코드는 일반 문구로 보인다", () => {
  assert.match(apiErrorText("AI_BUDGET_EXCEEDED", ["monthly"]), /이번 달 AI 비용 상한/u);
  assert.match(apiErrorText("AI_BUDGET_EXCEEDED", ["daily"]), /오늘 만들 수 있는 편수/u);
  assert.match(apiErrorText("AI_STATE_UNKNOWN"), /비용이 두 번 들 수 있습니다/u);
  assert.match(apiErrorText("BLOG_CONFIG_MISSING"), /글 초안 설정 누락/u);
  assert.match(apiErrorText("REALPRICE_CONFIG_MISSING"), /실거래가 설정 누락/u);
  assert.equal(apiErrorText("ZZ_NEW_CODE"), "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.");
  for (const code of ["PERSONAL_DATA_PATTERN", "VALIDATION_FAILED", "VERSION_CONFLICT"]) {
    assert.doesNotMatch(apiErrorText(code, ["ZZTEST-7F3A"]), /ZZTEST-7F3A/u, "details 값을 문구에 그대로 넣지 않음");
  }
});

test("글 초안 화면(2026-11-23): 블로그 복사 글에 소제목은 '■ 소제목' 줄로 그 문단 앞에, 현장에서 확인할 점은 해시태그 앞에 목록으로 붙고 옛 꼴은 그대로", () => {
  const disclosureText = "중개사무소 ZZTEST-7F3A";
  const blog = blogCopyText({
    title: "제목",
    paragraphs: ["첫 문단", "둘째 문단", " ", "넷째 문단"],
    headings: ["단지 개요", "", "빈 문단 소제목", " 생활 "],
    checklist: [" 등기 확인 ", "", "관리비 고지서"],
    hashtags: ["#천동"],
    disclosureText,
  });
  assert.equal(blog, [
    "제목",
    "■ 단지 개요\n첫 문단",
    "둘째 문단",
    "■ 빈 문단 소제목",
    "■ 생활\n넷째 문단",
    "■ 현장에서 확인할 점\n- 등기 확인\n- 관리비 고지서",
    "#천동",
    "──────────\n중개사무소 ZZTEST-7F3A",
  ].join("\n\n"));
  assert.equal(blogCopyText({ title: "제목", paragraphs: ["문단"], headings: [], checklist: [], hashtags: [], disclosureText }), "제목\n\n문단\n\n──────────\n중개사무소 ZZTEST-7F3A", "소제목·확인할 점이 없으면 옛 글과 같음");
  assert.equal(CHECKLIST_HEADING, "현장에서 확인할 점");
  assert.equal(whereLabel("h3"), "문단 3 소제목");
  assert.equal(whereLabel("check"), "현장에서 확인할 점");
});
