// 계약서 AI 일정 뽑기(단계 4 화면, 사용자 선택 2026-11-23 "B안 별도 화면"·"다섯 다 추천대로"·비용 표시 "넣음")를 가짜 업무 API로 본다.
// 손님 카드 거래 칸의 'AI로 일정 뽑기' 상자와 결과 고르기 화면(/admin/work/ai/review/?id=)이고, 시험 기준은 화면 시험 S-01 ~ S-18과 G20 문장이다.
// 2026-11-24부터 새 묶음은 AI가 한 번 읽는다(작업 1개, pairMode null). 그 전에 만든 두 번 읽기 묶음(작업 2개)도 비교표로 그대로 열려야 해서
// 결과 고르기 화면 시험은 한 번 읽기('한 번 읽기 …')와 옛 묶음(groupView 기본값) 둘 다 본다.
// 계약서 결과는 모두 가상 값이고 실제 서버·D1·R2·OpenAI는 부르지 않는다.
import { contractSumWarning, validateContractResult } from "../src/lib/work/contract-extract.mjs";
import { expect, test } from "@playwright/test";
import {
  NOW,
  uuid,
  CUSTOMER_ID,
  DEAL_A,
  DEAL_B,
  GROUP,
  OTHER_GROUP,
  DETAIL,
  REVIEW,
  MODEL_A,
  MODEL_B,
  QUOTE,
  PROPERTY,
  AI_DISABLED_TEXT,
  AI_CONFLICT_TEXT,
  AI_COPY_TRASHED_TEXT,
  AI_DEAL_CLOSED_TEXT,
  NEW_COST_TEXT,
  envelope,
  failure,
  PNG,
  ev,
  pay,
  result,
  job,
  copy,
  FILE_IDS,
  reviewDeal,
  groupView,
  singleView,
  listItem,
  estimateOf,
  confirmed,
  setup,
  collectErrors,
  overflowOf,
  aiCalls,
  aiWrites,
  shot,
  settle,
  axDelayCount,
  expectStyledButtons,
  box,
  openCopies,
  expectNoTrace,
} from "./support/ai-review-mock.mjs";

test("AI 꺼짐(503 AI_DISABLED, 켜기 값 없음): 사본 칸을 펼쳐도 AI 상자가 없고 AI 업무 API를 한 번도 부르지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { aiEnabled: false });
  await openCopies(page);
  await expect(page.locator(`[data-kc-panel="${DEAL_A}"] li`).first()).toBeVisible();
  await expect(box(page)).toBeHidden();
  await expect(page.getByText("AI로 일정 뽑기")).toHaveCount(0);
  expect(aiCalls(calls)).toEqual([]);
  done();
});

test("S-01 시작: 사본 6장이면 최근 5장만 골라 두고 6장째는 막으며, 비용·한도를 본 뒤 '일정 뽑기'가 { kind, fileIds, dealId }로 한 번만 간다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { copiesA: 6 });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("h4")).toContainText("AI로 일정 뽑기");
  const picks = ax.locator("[data-ax-pick]");
  await expect(picks).toHaveCount(6);
  await expect(ax.locator("[data-ax-pick]:checked")).toHaveCount(5);
  await expect(picks.nth(5)).toBeDisabled();
  await expect(ax).toContainText("한 번에 5장까지 고를 수 있습니다.");
  await expect(ax).toContainText("최대 약 3.50달러를 먼저 잡아 둠");
  await expect(ax).toContainText("이번 달 10.00달러 · 오늘 10회(이번에 1회 씀)");
  await expect(ax).toContainText("한 번 읽고 사람이 확인");
  await expect(ax).not.toContainText("두 번 읽");
  await expect(ax).toContainText("OpenAI(미국)");
  await picks.nth(4).uncheck();
  await expect(ax.locator("[data-ax-go]")).toHaveText("사본 4장으로 일정 뽑기");
  await expect(ax.locator("[data-ax-go]")).toBeEnabled();
  expect(calls.all.filter((line) => line.startsWith("GET /ai/estimate"))).toEqual(["GET /ai/estimate?pages=5", "GET /ai/estimate?pages=4"]);
  await ax.locator("[data-ax-go]").click();
  await expect(ax.locator("h4")).toContainText("읽는 중");
  const posts = aiWrites(calls, "/ai/jobs");
  expect(posts).toHaveLength(1);
  expect(posts[0].body).toEqual({ kind: "contract_schedule", fileIds: [uuid(401), uuid(402), uuid(403), uuid(404)], dealId: DEAL_A });
  done();
});

test("S-01 막힘·실패: 하루 한도가 모자라면 단추가 꺼지고, 만들기가 AI_DISABLED·한도 초과·413이면 까닭 한 줄만 보이고 새로 만들지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  let daily = true;
  const answers = [failure(503, "AI_DISABLED"), failure(409, "AI_BUDGET_EXCEEDED"), failure(413, "AI_INPUT_TOO_LARGE")];
  const calls = await setup(page, { ai: { estimate: (pages) => estimateOf(pages, daily ? { remainingCreates: 0, allowed: false, blockedBy: "daily" } : {}), create: () => answers.shift() } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax).toContainText("오늘 쓸 수 있는 횟수가 모자랍니다(남은 0회, 이번에 1회 필요). 보내지 않았습니다.");
  await expect(ax.locator("[data-ax-go]")).toBeDisabled();
  daily = false;
  // 고른 장수를 바꾸면 그 장수의 비용을 새로 읽는다(한도가 풀린 값).
  await ax.locator("[data-ax-pick]").first().uncheck();
  for (const expected of [AI_DISABLED_TEXT, "AI 사용 한도에 닿아 보내지 않았습니다.", "한 번에 사진 5장, 합계 12MB까지 읽을 수 있습니다."]) {
    // 실패 뒤에는 한도가 바뀌었을 수 있어 비용을 다시 읽은 뒤에야 단추가 켜진다.
    await expect(ax.locator("[data-ax-go]")).toBeEnabled();
    await ax.locator("[data-ax-go]").click();
    await expect(ax.locator("[data-ax-status]")).toContainText(`보내지 않았습니다. ${expected}`);
  }
  expect(aiWrites(calls, "/ai/jobs")).toHaveLength(3);
  expect(calls.all.filter((line) => line.startsWith("GET /ai/estimate")), "실패마다 비용을 다시 읽음").toEqual(["GET /ai/estimate?pages=2", "GET /ai/estimate?pages=1", "GET /ai/estimate?pages=1", "GET /ai/estimate?pages=1", "GET /ai/estimate?pages=1"]);
  expect(calls.gets, "실패한 만들기 뒤에는 조회하지 않음").toEqual([]);
  done();
});

test("S-01 이미 읽는 중(409 AI_JOB_ACTIVE): 새로 만들지 않고 그 묶음을 곧바로 이어서 본다", async ({ page }) => {
  const done = collectErrors(page);
  const running = groupView({ id: OTHER_GROUP, status: "running", jobs: [job(1, { status: "in_progress" }), job(2, { status: "queued" })] });
  const calls = await setup(page, { ai: { create: () => failure(409, "AI_JOB_ACTIVE", [OTHER_GROUP]), groups: new Map([[OTHER_GROUP, [running]]]) } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("[data-ax-go]")).toBeEnabled();
  await ax.locator("[data-ax-go]").click();
  await expect(ax.locator("h4")).toContainText("읽는 중");
  await expect.poll(() => calls.gets).toEqual([OTHER_GROUP]);
  await expect(ax).toContainText("읽는 중");
  expect(aiWrites(calls, "/ai/jobs")).toHaveLength(1);
  done();
});

test("S-02·S-03 조회: 만든 뒤 처음 1분은 5초, 그 뒤 15초 간격이고 결과가 나오면 조회를 멈춘다(그 뒤 GET 0번), 진행 중에는 결과 칸을 그리지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const running = singleView({ status: "running", jobs: [job(1, { status: "in_progress" })] });
  const ready = singleView();
  const answers = [...Array(13).fill(running), ready];
  const calls = await setup(page, { ai: { groups: new Map([[GROUP, answers]]) } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("[data-ax-go]")).toBeEnabled();
  await ax.locator("[data-ax-go]").click();
  await expect(ax.locator("h4")).toContainText("읽는 중");
  const delays = () => page.evaluate(() => window.__axDelays.slice());
  for (let n = 1; n <= answers.length; n += 1) {
    await expect.poll(async () => (await delays()).length, `${n}번째 조회 예약`).toBe(n);
    const delay = (await delays())[n - 1];
    expect(ax.locator("[data-ax-review]"), "진행 중에는 결과 고리 없음").toHaveCount(0);
    await page.clock.runFor(delay);
    await expect.poll(() => calls.gets.length, `${n}번째 조회`).toBe(n);
  }
  expect(await delays()).toEqual([...Array(12).fill(5_000), 15_000, 15_000]);
  await expect(ax.locator("h4")).toContainText("결과 나옴");
  // 한 번 읽기: 계약일·잔금·거래금액을 읽었고 중도금은 못 읽음. 읽은 칸은 모두 사람이 고른다.
  await expect(ax.locator(".ax-sum")).toContainText("읽은 칸 3");
  await expect(ax.locator(".ax-sum")).toContainText("– 못 읽음 1");
  await expect(ax.locator(".ax-sum")).not.toContainText("같음");
  await expect(ax).toContainText("고를 칸 3개");
  await expect(ax.locator("[data-ax-review]")).toHaveAttribute("href", REVIEW);
  await page.clock.runFor(300_000);
  await settle();
  expect(calls.gets, "끝난 뒤에는 다시 조회하지 않음(ai.view가 쌓이지 않음, G17)").toHaveLength(answers.length);
  expect(await delays()).toHaveLength(answers.length);
  done();
});

test("S-03·S-04 다시 들어옴·떠남: 최근 묶음이 진행 중이면 만들기 없이 곧바로 이어 보고, 화면을 떠나면(pagehide) 조회 타이머를 푼다", async ({ page }) => {
  const done = collectErrors(page);
  const running = singleView({ status: "running", jobs: [job(1, { status: "in_progress" })] });
  const calls = await setup(page, { ai: { list: () => [listItem(running)], groups: new Map([[GROUP, [running]]]) } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("h4")).toContainText("읽는 중");
  await expect.poll(() => calls.gets).toEqual([GROUP]);
  await expect(ax.locator("[data-ax-quit]")).toBeVisible();
  // 한 번 읽기 묶음의 작업 줄은 'n회' 없이 모델 이름만
  await expect(ax.locator(".ax-run li")).toHaveCount(1);
  await expect(ax.locator(".ax-run li")).toContainText(`AI ${MODEL_A}`);
  await expect(ax.locator(".ax-run")).not.toContainText("1회");
  expect(calls.all.filter((line) => line.startsWith("GET /ai/jobs?"))).toEqual([`GET /ai/jobs?dealId=${DEAL_A}`]);
  await expect.poll(() => page.evaluate(() => window.__axDelays.length)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await page.clock.runFor(120_000);
  await settle();
  expect(calls.gets, "떠난 뒤 조회 0번").toEqual([GROUP]);
  expect(await axDelayCount(page), "떠난 뒤 새 조회 타이머 0개").toBe(1);
  expect(aiWrites(calls, "/ai/jobs")).toEqual([]);
  done();
});

test("S-03 조회 오류: 묶음 조회가 500이면 자동으로 다시 묻지 않고 '다시 확인'을 보이며, 누를 때만 한 번 더 조회한다", async ({ page }) => {
  const done = collectErrors(page);
  const running = singleView({ status: "running", jobs: [job(1, { status: "in_progress" })] });
  const calls = await setup(page, { ai: { list: () => [listItem(running)], groups: new Map([[GROUP, [failure(500, "INTERNAL_ERROR"), running]]]) } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax).toContainText("결과를 확인하지 못했습니다.");
  const again = ax.locator("[data-ax-key='repoll']");
  await expect(again).toHaveText("다시 확인");
  expect(calls.gets).toEqual([GROUP]);
  await page.clock.runFor(120_000);
  await settle();
  expect(calls.gets, "오류 뒤 자동 조회 0번(요청이 쌓이지 않음)").toEqual([GROUP]);
  expect(await axDelayCount(page), "오류 뒤 조회 타이머 0개").toBe(0);
  await again.click();
  await expect.poll(() => calls.gets).toEqual([GROUP, GROUP]);
  await expect(ax.locator("[data-ax-key='repoll']"), "다시 읽으면 '다시 확인'이 사라짐").toHaveCount(0);
  await expect.poll(() => axDelayCount(page), "다시 진행 중이면 조회 간격대로 이어 감").toBe(1);
  done();
});

test("S-11 취소: 진행 중 '그만두기'는 POST …/cancel {} 한 번, 끝났지만 넣기 전 결과는 '결과 버리기'를 한 번 물은 뒤 버리고, 거래에 넣은 묶음에는 취소 단추가 없다", async ({ page }) => {
  const done = collectErrors(page);
  const running = singleView({ status: "running", jobs: [job(1, { status: "in_progress" })] });
  let latest = running;
  const calls = await setup(page, { ai: { list: () => [listItem(latest)], groups: new Map([[GROUP, [running]]]) } });
  await openCopies(page);
  const ax = box(page);
  await ax.locator("[data-ax-quit]").click();
  await expect(ax.locator("[data-ax-status]")).toHaveText("AI 작업을 그만뒀습니다.");
  await expect(ax.locator("[data-ax-go]")).toBeVisible();
  expect(aiWrites(calls, "/cancel")).toEqual([{ method: "POST", path: `/ai/jobs/${GROUP}/cancel`, body: {} }]);

  latest = singleView();
  await page.reload();
  await page.locator(`[data-kc-toggle="${DEAL_A}"]`).click();
  await expect(ax.locator("h4")).toContainText("결과 나옴");
  await expect(ax.locator(".ax-sum"), "목록 응답에는 결과가 없어 개수를 그리지 않음(결과를 다시 부르지 않음)").toHaveCount(0);
  await ax.getByRole("button", { name: "결과 버리기" }).click();
  await expect(ax).toContainText("결과를 버릴까요?");
  await expect(ax.locator("[data-ax-key='discard-yes']")).toBeFocused();
  await ax.locator("[data-ax-key='discard-yes']").click();
  await expect(ax.locator("[data-ax-status]")).toHaveText("결과를 버렸습니다.");
  expect(aiWrites(calls, "/cancel")).toHaveLength(2);

  latest = singleView({ status: "confirmed", confirmedAt: "2026-11-23T04:58:00.000Z" });
  const readsBefore = calls.gets.length;
  await page.reload();
  await page.locator(`[data-kc-toggle="${DEAL_A}"]`).click();
  await expect(ax.locator("h4")).toContainText("거래에 넣음");
  await expect(ax.locator("[data-ax-quit]")).toHaveCount(0);
  await expect(ax.getByRole("button", { name: "결과 버리기" })).toHaveCount(0);
  await expect(ax.getByRole("button", { name: "다시 뽑기" })).toBeVisible();
  expect(calls.gets.length, "끝난 묶음은 목록만 읽고 묶음 조회(결과·ai.view)는 하지 않음").toBe(readsBefore);
  done();
});

test("S-12 실패 표시(한 번 읽기): 작업이 실패하면 'n회' 없이 까닭 한 줄이고 '두 번 다'라고 하지 않으며, 자동으로 다시 실행하지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const failed = singleView({ status: "failed", jobs: [job(1, { status: "incomplete", errorCode: "AI_RESULT_INCOMPLETE" })] });
  const calls = await setup(page, { ai: { list: () => [listItem(failed)] } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("h4")).toContainText("✕ 실패");
  await expect(ax.locator(".ax-fail h5")).toHaveText("결과를 받지 못했습니다");
  await expect(ax.locator(".ax-fail p")).toHaveText(["출력 상한에 걸려 결과를 다 받지 못했습니다. 다시 실행하면 새 비용이 듭니다."]);
  await expect(ax).not.toContainText("1회");
  await page.clock.runFor(120_000);
  await settle();
  expect(aiWrites(calls, "/ai/jobs")).toEqual([]);
  expect(calls.gets).toEqual([]);
  done();
});

test("S-12 실패 표시(옛 두 번 읽기 묶음): 두 작업이 다 실패하면 까닭마다 정해진 문장(INCOMPLETE·EXPIRED는 새 비용)이고 자동으로 다시 실행하지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const failed = groupView({ status: "failed", jobs: [job(1, { status: "incomplete", errorCode: "AI_RESULT_INCOMPLETE" }), job(2, { status: "failed", errorCode: "AI_RESULT_EXPIRED" })] });
  const calls = await setup(page, { ai: { list: () => [listItem(failed)] } });
  await openCopies(page);
  const ax = box(page);
  await expect(ax.locator("h4")).toContainText("✕ 실패");
  await expect(ax).toContainText("1회: 출력 상한에 걸려 결과를 다 받지 못했습니다. 다시 실행하면 새 비용이 듭니다.");
  await expect(ax).toContainText("2회: 결과를 받을 수 있는 시간이 지나 받지 못했습니다. 다시 실행하면 새 비용이 듭니다.");
  await page.clock.runFor(120_000);
  await settle();
  expect(aiWrites(calls, "/ai/jobs")).toEqual([]);
  expect(calls.gets).toEqual([]);
  expect(await axDelayCount(page), "실패한 묶음에는 조회 타이머 0개").toBe(0);
  await ax.getByRole("button", { name: "다시 뽑기" }).click();
  await expect(ax.locator("[data-ax-go]")).toBeVisible();
  expect(aiWrites(calls, "/ai/jobs"), "다시 뽑기는 시작 칸만 다시 보임(누르기 전 생성 0)").toEqual([]);
  done();
});

test("끝난 거래: 사본 칸의 AI 상자는 한 줄 안내만 보이고 AI 업무 API를 부르지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { dealStatus: "completed" });
  await openCopies(page);
  await expect(box(page)).toContainText("끝난 거래라 일정을 뽑지 않습니다.");
  expect(aiCalls(calls)).toEqual([]);
  done();
});

// ── 결과 고르기 화면 ──
// '한 번 읽기 …' 시험은 2026-11-24부터 만든 묶음, 그 밖의 시험은 옛 두 번 읽기 묶음(비교표)이 그대로 열리는지 본다.

async function openReview(page, { expectMain = true } = {}) {
  await page.goto(REVIEW);
  if (expectMain) await expect(page.locator("[data-axr-main]")).toBeVisible();
}
const foot = (page) => ({ text: page.locator("[data-axr-foot-text]"), next: page.locator("[data-axr-next]"), back: page.locator("[data-axr-back-step]") });

test("한 번 읽기(1280px 표): 칸마다 AI 값 하나이고 같음·다름·한쪽만·교차 아님이 없으며, 미리 골라 둔 칸 없이 AI 값·직접 넣기·지금 값 그대로를 고른 뒤 '거래에 넣기'가 한 번 간다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 1280, ai: { groups: new Map([[GROUP, [singleView()]]]) } });
  await openReview(page);
  await expect(page.locator("[data-axr-title]")).toHaveText("AI로 뽑은 값 맞춰 보기");
  const table = page.locator("table.ax-cmp");
  await expect(table).toBeVisible();
  await expect(table.locator("thead th")).toHaveText(["칸", `AI 읽음${MODEL_A}`, "거래에 넣을 값"]);
  await expect(table).not.toContainText("1회");
  await expect(table).not.toContainText("맞춰 봄");
  for (const word of ["✓ 같음", "≠ 다름", "◐ 한쪽만", "둘 다 없음"]) await expect(page.locator("[data-axr-body]")).not.toContainText(word);
  await expect(page.locator("[data-axr-cross]")).toHaveCount(0);
  await expect(page.locator("[data-axr-single]")).toContainText(`AI(${MODEL_A})가 계약서를 한 번 읽은 값입니다.`);
  await expect(page.locator(".ax-sum")).toContainText("확인할 칸 3");
  await expect(page.locator(".ax-sum")).toContainText("– 못 읽음 1");
  // 못 읽은 중도금은 고를 칸이 아니고 '지금 값 그대로'로 둔다.
  await expect(page.locator("[data-axr-row='middlePayments']")).toContainText("— 못 읽음");
  await expect(page.locator("[data-axr-row='middlePayments']")).toContainText("넣지 않음(지금 값 그대로)");
  await expect(page.locator("[data-axr-row='middlePayments'] [data-axr-chip]")).toHaveCount(0);
  const { text, next, back } = foot(page);
  await expect(text).toHaveText("고를 칸 3개 남음 — 계약일, 잔금 날짜, 거래금액");
  await expect(next).toBeDisabled();
  await expect(page.locator("[data-axr-chip$=':second']"), "2회 값 단추 없음").toHaveCount(0);
  await expect(page.locator("[data-axr-chip='contractDate:first']")).toHaveText("2026-11-02 (AI)");
  await expect(page.locator("[data-axr-chip='contractDate:first']")).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("[data-axr-row='contractDate'] .ax-quote")).toContainText(`근거(${MODEL_A}): 1쪽 “${QUOTE}”`);
  await expect(page.locator("tr.is-diff")).toHaveCount(3);
  await page.locator("[data-axr-chip='contractDate:first']").click();
  await expect(page.locator("tr.is-diff"), "고른 칸은 표시를 거둠").toHaveCount(2);
  await page.locator("[data-axr-chip='balanceDate:manual']").click();
  await page.locator("[data-ax-key='manual-balanceDate']").fill("2026-12-29");
  await page.locator("[data-axr-chip='priceWon:keep']").click();
  await expect(text).toHaveText("모두 골랐습니다");
  await shot(page, "ai-review-single-1280-compare.png");
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  await expect(back).toHaveText("값 고르기로 돌아가기");
  await expect(page.locator("[data-axr-into='balanceDate'] .ax-nw b")).toHaveText("2026-12-29 (화)");
  await expect(page.getByText("지금 값 그대로 둔 칸: 거래금액")).toBeVisible();
  await back.click();
  await expect(page.locator("[data-axr-chip='contractDate:first']"), "돌아가도 고른 값이 남음").toHaveAttribute("aria-checked", "true");
  await next.click();
  await expectNoTrace(page);
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
  expect(aiWrites(calls, "/confirm")).toEqual([{ method: "POST", path: `/ai/jobs/${GROUP}/confirm`, body: { dealVersion: 2, apply: { contractDate: "2026-11-02", balanceDate: "2026-12-29" }, keep: ["priceWon"] } }]);
  expect(calls.gets, "묶음 조회는 한 번만").toEqual([GROUP]);
  await expectNoTrace(page);
  done();
});

test("한 번 읽기(390px 카드·키보드): 카드마다 AI 값 하나와 모델이 보이고 상태 꼬리표가 없으며, 키보드로 AI 값을 골라 넘어가고 가로 넘침이 없다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [singleView({ jobs: [job(1, { value: result({ middles: ["2026-11-20"] }) })] })]]]) } });
  await openReview(page);
  await expect(page.locator("ul.ax-cards").first()).toBeVisible();
  const card = page.locator("[data-axr-row='balanceDate']");
  await expect(card.locator(".ax-card__one")).toContainText("2026-12-30");
  await expect(card.locator(".ax-card__one")).toContainText(`AI 읽음 · ${MODEL_A}`);
  await expect(card.locator(".ax-card__head .ax-tag"), "카드 머리에 상태 꼬리표 없음").toHaveCount(0);
  await expect(card).toHaveClass(/is-diff/u);
  for (const word of ["✓ 같음", "≠ 다름", "◐ 한쪽만", "1회", "2회"]) await expect(page.locator("ul.ax-cards").first()).not.toContainText(word);
  const { text, next } = foot(page);
  await expect(text).toHaveText("고를 칸 4개 남음 — 계약일, 중도금 날짜, 잔금 날짜, 거래금액");
  expect(await overflowOf(page), "가로 넘침").toBe(0);
  await shot(page, "ai-review-single-390-compare.png");
  for (const field of ["contractDate", "middlePayments", "balanceDate", "priceWon"]) {
    const chip = page.locator(`[data-axr-chip='${field}:first']`);
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`[data-axr-chip='${field}:first']`)).toHaveAttribute("aria-checked", "true");
    await expect(page.locator(`[data-axr-chip='${field}:first']`), "다시 그린 뒤에도 포커스가 같은 칩").toBeFocused();
  }
  await expect(card, "고른 카드는 표시를 거둠").not.toHaveClass(/is-diff/u);
  await expect(text).toHaveText("모두 골랐습니다");
  expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  expect(await overflowOf(page), "확인 화면 가로 넘침").toBe(0);
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
  expect(aiWrites(calls, "/confirm")[0].body).toEqual({ dealVersion: 2, apply: { contractDate: "2026-11-02", middlePayments: ["2026-11-20"], balanceDate: "2026-12-30", priceWon: 350_000_000 }, keep: [] });
  expect(await overflowOf(page), "넣은 뒤 가로 넘침").toBe(0);
  done();
});

test("한 번 읽기 '모두 AI 값으로'(360px 카드): 단추 하나로 그대로 넣을 수 있는 칸만 AI 값이 되고, 한 칸을 '직접 넣기'로 고쳐 넘어가면 지금 값 → 넣을 값에 그대로 나오며 apply·keep이 맞다", async ({ page }) => {
  const done = collectErrors(page);
  // 거래금액은 못 읽음, 중도금은 2차 날짜를 못 읽어 AI 값을 그대로 넣을 수 없는 칸이다.
  const value = result({ price: null, middles: ["2026-11-20", null] });
  const calls = await setup(page, { width: 360, ai: { groups: new Map([[GROUP, [singleView({ jobs: [job(1, { value })] })]]]) } });
  await openReview(page);
  const { text, next } = foot(page);
  const pickAll = page.locator("[data-axr-pick-all]");
  const pickStatus = page.locator("[data-axr-pick-all-status]");
  await expect(pickAll).toHaveText("모두 AI 값으로");
  await expect(pickStatus).toBeHidden();
  await expect(text).toHaveText("고를 칸 3개 남음 — 계약일, 중도금 날짜, 잔금 날짜");
  const pickBox = await pickAll.boundingBox();
  expect(pickBox.height, "단추 44px 이상").toBeGreaterThanOrEqual(44);
  expect(pickBox.height, "단추 이름이 두 줄로 꺾이지 않음").toBeLessThan(60);
  // 누르기 전에 직접 넣던 값은 단추가 덮어도 '직접 넣기'를 다시 누르면 돌아온다.
  await page.locator("[data-axr-chip='balanceDate:manual']").click();
  await page.locator("[data-ax-key='manual-balanceDate']").fill("2026-12-28");
  await pickAll.click();
  await expect(pickAll, "누른 뒤에도 포커스가 단추에 남음").toBeFocused();
  await expect(pickStatus).toHaveText("2칸을 AI 값으로 골랐습니다. 사진과 다른 칸만 고쳐 주세요. 남은 1칸은 AI 값을 그대로 넣을 수 없어 직접 골라 주세요. 직접 넣던 값은 '직접 넣기'를 다시 누르면 돌아옵니다.");
  await expect(pickStatus).toHaveAttribute("aria-live", "polite");
  for (const field of ["contractDate", "balanceDate"]) await expect(page.locator(`[data-axr-chip='${field}:first']`)).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-ax-key='manual-balanceDate']"), "AI 값으로 바뀌어 직접 넣기 칸이 닫힘").toHaveCount(0);
  await expect(page.locator("[data-axr-chip='middlePayments:first']"), "못 읽은 차가 있는 중도금은 AI 값 단추 없음").toHaveCount(0);
  await expect(page.locator("[data-axr-chip^='middlePayments:'][aria-checked='true']"), "중도금은 고르지 않은 채 둠").toHaveCount(0);
  await expect(page.locator("[data-axr-row='priceWon'] [data-axr-chip]"), "못 읽은 거래금액은 고를 칸이 아님").toHaveCount(0);
  await expect(page.locator("[data-axr-title]"), "다음 단계로 저절로 넘어가지 않음").toHaveText("AI로 뽑은 값 맞춰 보기");
  await expect(text).toHaveText("고를 칸 1개 남음 — 중도금 날짜");
  await expect(next).toBeDisabled();
  expect(await overflowOf(page), "알림 줄이 붙은 뒤 가로 넘침").toBe(0);
  await shot(page, "ai-review-single-360-pick-all.png");
  // 사진과 다른 한 칸만 직접 넣기로 고친다.
  await page.locator("[data-axr-chip='balanceDate:manual']").click();
  const manual = page.locator("[data-ax-key='manual-balanceDate']");
  await expect(manual, "덮기 전 직접 넣던 값이 돌아옴").toHaveValue("2026-12-28");
  await manual.fill("2026-12-29");
  await page.locator("[data-axr-chip='middlePayments:keep']").click();
  await expect(text).toHaveText("모두 골랐습니다");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  await expect(page.locator("[data-axr-into]")).toHaveCount(2);
  await expect(page.locator("[data-axr-into='contractDate'] b")).toHaveText("2026-11-02 (월)");
  await expect(page.locator("[data-axr-into='balanceDate'] s")).toHaveText("2026-12-20 (일)");
  await expect(page.locator("[data-axr-into='balanceDate'] .ax-nw b")).toHaveText("2026-12-29 (화)");
  await expect(page.getByText("지금 값 그대로 둔 칸: 중도금일")).toBeVisible();
  expect(await overflowOf(page), "확인 화면 가로 넘침").toBe(0);
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
  expect(aiWrites(calls, "/confirm")).toEqual([{ method: "POST", path: `/ai/jobs/${GROUP}/confirm`, body: { dealVersion: 2, apply: { contractDate: "2026-11-02", balanceDate: "2026-12-29" }, keep: ["middlePayments"] } }]);
  expect(calls.all.filter((line) => line.startsWith("POST ")), "쓰기는 거래에 넣기 한 번뿐").toEqual([`POST /ai/jobs/${GROUP}/confirm`]);
  await expectNoTrace(page);
  done();
});

test("옛 두 번 읽기 묶음에는 '모두 AI 값으로'가 없다(AI 값이 하나가 아님)", async ({ page }) => {
  const done = collectErrors(page);
  await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView({ jobs: [job(1), job(2, { value: result({ balance: "2026-12-31" }) })] })]]]) } });
  await openReview(page);
  await expect(page.locator("[data-axr-chip='balanceDate:second']")).toBeVisible();
  await expect(page.locator("[data-axr-pick-all]")).toHaveCount(0);
  done();
});

test("한 번 읽기 실패 묶음: 결과 고르기 화면은 'n회' 없이 까닭 한 줄로 막는다", async ({ page }) => {
  const done = collectErrors(page);
  await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [singleView({ status: "failed", jobs: [job(1, { status: "failed", errorCode: "AI_RESULT_INVALID" })] })]]]) } });
  await openReview(page, { expectMain: false });
  await expect(page.locator("[data-axr-state-title]")).toHaveText("결과를 받지 못했습니다");
  await expect(page.locator("[data-axr-state-body]")).toHaveText("읽은 결과가 정해진 꼴이 아니라 쓰지 않았습니다.");
  done();
});

test("S-05·S-13·S-17 모두 같음(1280px 표): 넣을 값이 다 정해져 확인으로 넘어가고, 지금 값 → 넣을 값과 일정을 본 뒤 '거래에 넣기'가 { dealVersion, apply, keep }로 한 번 간다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 1280, ai: { groups: new Map([[GROUP, [groupView()]]]) } });
  await openReview(page);
  await expect(page.locator("[data-axr-title]")).toHaveText("AI로 뽑은 값 맞춰 보기");
  await expect(page.locator("table.ax-cmp")).toBeVisible();
  await expect(page.locator(".ax-sum")).toContainText("✓ 같음 3");
  await expect(page.locator("[data-axr-back]")).toHaveAttribute("href", DETAIL);
  await expect(page.locator("[data-axr-back-text]")).toHaveText("가상 손님 1 손님 카드");
  const { text, next, back } = foot(page);
  await expect(text).toHaveText("모두 골랐습니다");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  await expect(page.locator("[data-axr-into='contractDate']")).toContainText("그대로");
  await expect(page.locator("[data-axr-into='balanceDate']")).toContainText("↺ 덮어씀");
  await expect(page.locator("[data-axr-into='balanceDate'] s")).toHaveText("2026-12-20 (일)");
  await expect(page.getByText("덮어쓴 값은 되돌릴 수 없습니다.")).toBeVisible();
  await expect(page.locator(".ax-evts li").first()).toBeVisible();
  const events = await page.locator(".ax-evts li").count();
  await expect(next).toHaveText(`거래에 넣기 (칸 1개 · 일정 ${events}개)`);
  await expect(back).toBeVisible();
  await expectNoTrace(page);
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
  const posts = aiWrites(calls, "/confirm");
  expect(posts).toEqual([{ method: "POST", path: `/ai/jobs/${GROUP}/confirm`, body: { dealVersion: 2, apply: { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }, keep: [] } }]);
  await expect(page.getByText("가상 안내: 거래신고는 계약일부터 30일 안에 합니다.")).toBeVisible();
  await expect(page.getByText("이 거래의 일정 3개")).toBeVisible();
  expect(new URL(await page.locator(".axr-done-go").getAttribute("href"), page.url()).pathname + new URL(await page.locator(".axr-done-go").getAttribute("href"), page.url()).search).toBe(DETAIL);
  expect(calls.gets, "묶음 조회는 한 번만(ai.view 한 번, G17)").toEqual([GROUP]);
  await expectNoTrace(page);
  expect(new URL(page.url()).search).toBe(`?id=${GROUP}&from=${CUSTOMER_ID}`);
  done();
});

test("다시 확정 미리 보기(390px): 앞 AI 결과로 넣은 2·3차 중도금이 '바뀜'·'그대로, 완료'로 보이고, 새 2차는 'AI로 넣음', 끝나지 않은 직접 2차는 두 줄 경고와 '그대로 둠', 넣은 뒤 목록도 'AI로 넣음'이다", async ({ page }) => {
  const done = collectErrors(page);
  const event = (n, kind, dueOn, title, source, doneAt = null) => ({ id: uuid(950 + n), dealId: DEAL_A, kind, dueOn, title, alarmOffsets: [], source, doneAt, version: 1, createdAt: "", updatedAt: "" });
  const before = [
    event(1, "custom", "2026-12-01", "2차 중도금(가상단지)", "ai_confirmed"),
    event(2, "custom", "2026-12-10", "3차 중도금(가상단지)", "ai_confirmed", "2026-12-10T01:00:00.000Z"),
    event(3, "custom", "2026-12-15", "가상 점검 일정", "manual"),
    event(5, "custom", "2026-11-28", "2차 중도금(직접)", "manual"),
  ];
  const middles = ["2026-11-20", "2026-12-05"];
  const ready = groupView({ jobs: [job(1, { value: result({ middles }) }), job(2, { value: result({ middles }) })] });
  const calls = await setup(page, {
    width: 390,
    ai: {
      groups: new Map([[GROUP, [ready]]]),
      deal: () => envelope({ deal: reviewDeal({ middlePaymentOn: "2026-11-21" }), parties: [{ customerId: CUSTOMER_ID, role: "buyer", displayName: "가상 손님 1" }], events: before }),
      confirm: (body) => {
        const data = confirmed(body);
        return envelope({ ...data, events: [...data.events, event(4, "custom", "2026-12-05", "2차 중도금(가상단지)", "ai_confirmed"), before[1], before[2]] });
      },
    },
  });
  await openReview(page);
  await foot(page).next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  const fresh = page.locator(".ax-evts:not([data-axr-prev]):not([data-axr-twin]) li", { hasText: "2차 중도금" });
  await expect(fresh).toContainText("12월 5일");
  await expect(fresh.locator(".ax-tag")).toHaveText("AI로 넣음");
  await expect(page.locator(".ax-sub", { hasText: "앞 AI 결과로 넣은 일정" })).toBeVisible();
  const prev = page.locator("[data-axr-prev] li");
  await expect(prev).toHaveCount(2);
  await expect(prev.nth(0)).toContainText("2차 중도금(가상단지)");
  await expect(prev.nth(0)).toContainText("12월 5일 (토)로 다시 넣음");
  await expect(prev.nth(0).locator(".ax-tag")).toHaveText("바뀜");
  await expect(prev.nth(1).locator(".ax-tag")).toHaveText("그대로, 완료");
  await expect(page.locator("[data-axr-prev]"), "직접 넣은 일정은 앞 AI 결과 줄에 없음").not.toContainText("가상 점검 일정");
  await expect(page.locator(".ax-out")).toContainText("이 거래에 직접 넣거나 고친 일정(계산·AI로 넣은 일정을 손으로 고친 것 포함)은 그대로 둡니다.");
  await expect(page.getByText("직접 일정", { exact: false })).toHaveCount(0);
  // 끝나지 않은 직접 2차는 같은 차 AI 일정과 두 줄이 된다고 경고와 함께 보인다(서버는 둘 다 남김).
  const twin = page.locator("[data-axr-twin] li");
  await expect(twin).toHaveCount(1);
  await expect(twin).toContainText("2차 중도금(직접)");
  await expect(twin).toContainText("같은 차 AI 일정: 12월 5일 (토)");
  await expect(twin.locator(".ax-tag")).toHaveText("그대로 둠");
  await expect(page.locator(".ax-note--warn", { hasText: "같은 차수 AI 일정과 두 줄이 됩니다." })).toBeVisible();
  await expect(page.locator("[data-axr-twin]"), "다른 직접 일정은 두 줄 경고에 없음").not.toContainText("가상 점검 일정");
  await page.locator("[data-axr-twin]").evaluate((node) => node.scrollIntoView({ block: "center", behavior: "instant" }));
  await shot(page, "reconfirm-preview-390.png");
  await foot(page).next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
  expect(aiWrites(calls, "/confirm")[0].body.apply.middlePayments).toEqual(middles);
  const doneRow = page.locator(".ax-evts li", { hasText: "2차 중도금" });
  await expect(doneRow.locator(".ax-tag")).toHaveText("AI로 넣음");
  await expect(page.locator(".ax-evts li", { hasText: "가상 점검 일정" }).locator(".ax-tag")).toHaveText("직접");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  done();
});

test("S-06·S-18 다름(390px 카드·키보드): 잔금 날짜만 다르면 그 칸만 '≠ 다름'(글자 + 기호)이고 고르기 전 넘어가기가 꺼지며, 키보드로 2회 값을 골라 넘어간다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView({ jobs: [job(1), job(2, { value: result({ balance: "2026-12-31" }) })] })]]]) } });
  await openReview(page);
  await expect(page.locator("ul.ax-cards").first()).toBeVisible();
  await expect(page.locator("[data-axr-row='balanceDate'] .ax-tag")).toHaveText("≠ 다름");
  await expect(page.locator("[data-axr-row='contractDate'] .ax-tag")).toHaveCount(0);
  const { text, next } = foot(page);
  await expect(text).toHaveText("고를 칸 1개 남음 — 잔금 날짜");
  await expect(next).toBeDisabled();
  const chip = page.locator("[data-axr-chip='balanceDate:second']");
  await expect(chip).toHaveAttribute("aria-checked", "false");
  await chip.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-axr-chip='balanceDate:second']")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("[data-axr-chip='balanceDate:second']"), "다시 그린 뒤에도 포커스가 같은 칩").toBeFocused();
  await expect(text).toHaveText("모두 골랐습니다");
  await next.focus();
  // 포커스가 아래 막대·아래 탭에 가려지지 않음
  const covered = await next.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return !(hit === node || node.contains(hit));
  });
  expect(covered).toBe(false);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  await expect(page.locator("[data-axr-into='balanceDate'] .ax-nw b")).toHaveText("2026-12-31 (목)");
  await page.locator("[data-axr-next]").click();
  expect(aiWrites(calls, "/confirm")[0].body.apply.balanceDate).toBe("2026-12-31");
  done();
});

test("S-06 직접 넣기·지금 값 그대로: 직접 넣은 날짜가 비면 넘어가지 못하고, '지금 값 그대로'는 keep으로 간다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView({ jobs: [job(1, { value: result({ price: 340_000_000 }) }), job(2, { value: result({ balance: "2026-12-31" }) })] })]]]) } });
  await openReview(page);
  const { text, next } = foot(page);
  await expect(text).toHaveText("고를 칸 2개 남음 — 잔금 날짜, 거래금액");
  await page.locator("[data-axr-chip='balanceDate:manual']").click();
  const input = page.locator("[data-ax-key='manual-balanceDate']");
  await input.fill("");
  await expect(page.locator("[data-axr-problem='balanceDate']")).toHaveText("날짜를 골라 주세요.");
  await page.locator("[data-axr-chip='priceWon:keep']").click();
  await expect(next).toBeDisabled();
  await page.locator("[data-ax-key='manual-balanceDate']").fill("2026-12-29");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.getByText("지금 값 그대로 둔 칸: 거래금액")).toBeVisible();
  await page.locator("[data-axr-next]").click();
  const body = aiWrites(calls, "/confirm")[0].body;
  expect(body.apply).toEqual({ contractDate: "2026-11-02", balanceDate: "2026-12-29" });
  expect(body.keep).toEqual(["priceWon"]);
  done();
});

test("S-07 한쪽만: 한 작업이 실패하면 모든 칸이 '◐ 한쪽만'이고 위 알림과 실패 까닭이 보이며, 다 골라야 넘어간다", async ({ page }) => {
  const done = collectErrors(page);
  await setup(page, { width: 1280, ai: { groups: new Map([[GROUP, [groupView({ jobs: [job(1, { value: result({ middles: ["2026-11-20"] }) }), job(2, { status: "failed", errorCode: "AI_RESULT_INVALID" })] })]]]) } });
  await openReview(page);
  await expect(page.getByText("2회째가 실패해 1회째 결과만 있습니다. 모든 칸을 직접 골라 주세요.")).toBeVisible();
  await expect(page.getByText("2회: 읽은 결과가 정해진 꼴이 아니라 쓰지 않았습니다.")).toBeVisible();
  for (const field of ["contractDate", "middlePayments", "balanceDate", "priceWon"]) await expect(page.locator(`[data-axr-row='${field}'] .ax-tag`)).toHaveText("◐ 한쪽만");
  const { text, next } = foot(page);
  await expect(text).toHaveText("고를 칸 4개 남음 — 계약일, 중도금 날짜, 잔금 날짜, 거래금액");
  for (const field of ["contractDate", "middlePayments", "balanceDate", "priceWon"]) await page.locator(`[data-axr-chip='${field}:first']`).click();
  await expect(next).toBeEnabled();
  done();
});

test("코드 경고(합계 다름)는 'AI가 남긴 말'에 섞지 않고 '⚠ 금액 확인' 줄로 따로 보인다(2026-11-24 \"같이 넣어\")", async ({ page }) => {
  const done = collectErrors(page);
  // 매매대금 4억 8,500만인데 계약금 3,500만 + 잔금 3억 1,500만 = 3억 5,000만(합계 다름). 서버 재검사처럼 코드 경고를 맨 앞에 둔다.
  const raw = { ...result({ price: 485_000_000, warnings: ["가상 경고 한 줄"] }), warnings: [] };
  const sum = contractSumWarning(validateContractResult(raw).result);
  const jobs = [job(1, { value: result({ price: 485_000_000, warnings: [sum, "가상 경고 한 줄"] }) })];
  await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [singleView({ jobs })]]]) } });
  await openReview(page);
  const check = page.locator("[data-axr-check='sum']");
  await expect(check).toHaveCount(1);
  await expect(check).toHaveClass(/ax-note--warn/u);
  await expect(check).toContainText("금액 확인: 계약금·잔금을 더하면 3억 5,000만 원인데 매매대금은 4억 8,500만 원입니다(1억 3,500만 원 차이).");
  const said = page.locator(".ax-note", { hasText: "AI가 남긴 말" });
  await expect(said).toContainText("“가상 경고 한 줄”");
  await expect(said, "코드 경고는 AI 말에 없음").not.toContainText("더하면");
  done();
});

test("S-08·S-09·S-10 근거·교차 아님·가린 항목(1280px): 원문 글과 모델이 먼저 보이고 '사진에서 보기'는 그 쪽 사진 위에 참고 상자를 그린다", async ({ page }) => {
  const done = collectErrors(page);
  const jobs = [job(1, { model: MODEL_A, maskedCount: 1 }), job(2, { model: MODEL_A, maskedCount: 1, value: result({ warnings: ["가상 경고 한 줄"] }) })];
  const calls = await setup(page, { width: 1280, ai: { groups: new Map([[GROUP, [groupView({ pairMode: "same_unset", jobs })]]]) } });
  await openReview(page);
  await expect(page.locator("[data-axr-cross]")).toContainText("교차 아님");
  await expect(page.locator("[data-axr-cross]")).toContainText(`같은 모델(${MODEL_A})`);
  await expect(page.locator("[data-axr-masked='2']")).toContainText("가린 항목 2개");
  await expect(page.locator("[data-axr-masked='2']")).toContainText("“가상 경고 한 줄”");
  const row = page.locator("[data-axr-row='contractDate']");
  await expect(row.locator(".ax-quote")).toContainText(`근거(1회 · ${MODEL_A}): 1쪽 “${QUOTE}”`);
  // 980px 이상은 사진이 바로 보인다(1쪽).
  await expect(page.locator(".axr-frame img")).toHaveAttribute("src", `/api/admin/v1/work/files/${FILE_IDS[0]}/content`);
  await page.locator("[data-axr-row='balanceDate'] .axr-see").click();
  await expect(page.locator(".axw__pages [aria-pressed='true']")).toHaveText("2쪽");
  await expect(page.locator(".axr-frame img")).toHaveAttribute("src", `/api/admin/v1/work/files/${FILE_IDS[1]}/content`);
  await expect(page.locator(".axw__box")).toBeVisible();
  await expect(page.locator(".axw__boxtag")).toHaveText("잔금 날짜 근거(참고)");
  await page.locator(".axw__pages button", { hasText: "1쪽" }).click();
  await expect(page.locator(".axw__box"), "다른 쪽에서는 상자 없음").toHaveCount(0);
  await page.locator(".axw__pages button", { hasText: "2쪽" }).click();
  expect(calls.all.filter((line) => line.endsWith("/content")), "한 번 받은 쪽은 다시 받지 않음").toHaveLength(2);
  done();
});

for (const [mode, expected] of [["same_chosen", "운영자가 고른 방식"], ["cross", null]]) {
  test(`S-09 묶음 방식 ${mode}: '교차 아님' 경고가 없다`, async ({ page }) => {
    const done = collectErrors(page);
    await setup(page, { width: 1280, ai: { groups: new Map([[GROUP, [groupView({ pairMode: mode })]]]) } });
    await openReview(page);
    await expect(page.locator("[data-axr-cross]")).toHaveCount(0);
    if (expected) await expect(page.getByText(expected)).toBeVisible();
    else await expect(page.locator(".ax-note")).toHaveCount(0);
    done();
  });
}

test("휴대폰(390px) 사진: 근거 사진은 '사진 펼치기'를 누르기 전에는 받지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView()]]]) } });
  await openReview(page);
  await expect(page.locator("[data-axr-photo-toggle]")).toHaveText("사진 펼치기");
  await page.clock.runFor(2_000);
  await settle();
  expect(calls.all.filter((line) => line.endsWith("/content"))).toEqual([]);
  await page.locator("[data-axr-photo-toggle]").click();
  await expect(page.locator(".axr-frame img")).toBeVisible();
  expect(calls.all.filter((line) => line.endsWith("/content"))).toHaveLength(1);
  done();
});

for (const code of ["VERSION_CONFLICT", "AI_JOB_STATE_CONFLICT"]) {
  test(`S-14 확정 충돌(409 ${code}): 한 줄만 보이고 자동으로 다시 보내지 않으며, '다시 불러오기' 뒤에도 고른 값이 남아 새 판으로 넣는다`, async ({ page }) => {
    const done = collectErrors(page);
    const answers = [failure(409, code)];
    let version = 2;
    const ready = groupView({ jobs: [job(1), job(2, { value: result({ balance: "2026-12-31" }) })] });
    const calls = await setup(page, {
      width: 390,
      ai: {
        groups: new Map([[GROUP, [ready]]]),
        confirm: (body) => answers.shift() ?? envelope(confirmed(body)),
        deal: () => envelope({ deal: reviewDeal({ version }), parties: [{ customerId: CUSTOMER_ID, role: "buyer", displayName: "가상 손님 1" }], events: [] }),
      },
    });
    await openReview(page);
    await page.locator("[data-axr-chip='balanceDate:second']").click();
    await page.locator("[data-axr-next]").click();
    await page.locator("[data-axr-next]").click();
    await expect(page.locator("[data-axr-status]")).toHaveText(AI_CONFLICT_TEXT);
    await expect(page.locator("[data-axr-reload]")).toBeVisible();
    await page.clock.runFor(60_000);
    await settle();
    expect(aiWrites(calls, "/confirm"), "자동 재시도 없음").toHaveLength(1);
    version = 3;
    await page.locator("[data-axr-reload]").click();
    await expect(page.locator("[data-axr-status]")).toContainText("고른 값은 그대로이니");
    await expect(page.locator("[data-axr-reload]")).toBeHidden();
    await page.locator("[data-axr-back-step]").click();
    await expect(page.locator("[data-axr-chip='balanceDate:second']")).toHaveAttribute("aria-checked", "true");
    await page.locator("[data-axr-next]").click();
    await page.locator("[data-axr-next]").click();
    await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
    const posts = aiWrites(calls, "/confirm");
    expect(posts.map((item) => item.body.dealVersion)).toEqual([2, 3]);
    expect(posts[1].body.apply.balanceDate).toBe("2026-12-31");
    done();
  });
}

test("S-15 확정 400(VALIDATION_FAILED): 서버가 든 칸을 확인 목록에 표시하고 거래·일정은 그대로(다른 쓰기 없음)", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView()]]]), confirm: () => failure(400, "VALIDATION_FAILED", ["balanceDate"]) } });
  await openReview(page);
  await page.locator("[data-axr-next]").click();
  await page.locator("[data-axr-next]").click();
  await expect(page.locator("[data-axr-status]")).toContainText("넣을 값이 맞지 않습니다: 잔금일.");
  await expect(page.locator("[data-axr-into='balanceDate']")).toHaveClass(/is-bad/u);
  await expect(page.locator("[data-axr-into='balanceDate']")).toContainText("이 칸을 확인해 주세요");
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  expect(calls.writes.map((item) => item.path)).toEqual([`/ai/jobs/${GROUP}/confirm`]);
  done();
});

test("S-16 사본 휴지통: 조회 dealId가 null이면 거래를 읽지 않고 한 줄로 막고, 확정이 404이면 같은 문장으로 넣기 단추를 끈다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView({ dealId: null })]]]), confirm: () => failure(404, "NOT_FOUND") } });
  await openReview(page, { expectMain: false });
  await expect(page.locator("[data-axr-state-title]")).toHaveText("거래에 넣을 수 없습니다");
  await expect(page.locator("[data-axr-state-body]")).toHaveText(AI_COPY_TRASHED_TEXT);
  expect(calls.all.filter((line) => line.startsWith("GET /deals/"))).toEqual([]);

  const page2 = await page.context().newPage();
  const calls2 = await setup(page2, { width: 390, ai: { groups: new Map([[GROUP, [groupView()]]]), confirm: () => failure(404, "NOT_FOUND") } });
  await openReview(page2);
  await page2.locator("[data-axr-next]").click();
  await page2.locator("[data-axr-next]").click();
  await expect(page2.locator("[data-axr-status]")).toHaveText(AI_COPY_TRASHED_TEXT);
  await expect(page2.locator("[data-axr-next]")).toBeDisabled();
  expect(aiWrites(calls2, "/confirm")).toHaveLength(1);
  await page2.close();
  done();
});

test("G20 끝난·취소 거래: 거래가 끝났으면 화면이 막고, 확정이 409 DEAL_CLOSED이면 정해진 문장으로 넣기 단추를 끈다", async ({ page }) => {
  const done = collectErrors(page);
  for (const status of ["completed", "cancelled"]) {
    const one = await page.context().newPage();
    const calls = await setup(one, { width: 390, dealStatus: status, ai: { groups: new Map([[GROUP, [groupView()]]]) } });
    await openReview(one, { expectMain: false });
    await expect(one.locator("[data-axr-state-title]")).toHaveText("거래에 넣을 수 없습니다");
    await expect(one.locator("[data-axr-state-body]")).toHaveText(AI_DEAL_CLOSED_TEXT);
    expect(aiWrites(calls, "/confirm")).toEqual([]);
    await one.close();
  }
  const page2 = await page.context().newPage();
  const calls = await setup(page2, { width: 390, ai: { groups: new Map([[GROUP, [groupView()]]]), confirm: () => failure(409, "DEAL_CLOSED") } });
  await openReview(page2);
  await page2.locator("[data-axr-next]").click();
  await page2.locator("[data-axr-next]").click();
  await expect(page2.locator("[data-axr-status]")).toHaveText(AI_DEAL_CLOSED_TEXT);
  await expect(page2.locator("[data-axr-next]")).toBeDisabled();
  await expect(page2.locator("[data-axr-reload]")).toBeHidden();
  expect(aiWrites(calls, "/confirm")).toHaveLength(1);
  await page2.close();
  done();
});

test("AI 꺼짐(503 AI_DISABLED): 세션이 꺼져 있으면 AI 업무 API를 부르지 않고, 조회가 503 AI_DISABLED여도 같은 문장으로 막는다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, aiEnabled: false, ai: { groups: new Map([[GROUP, [groupView()]]]) } });
  await openReview(page, { expectMain: false });
  await expect(page.locator("[data-axr-state-title]")).toHaveText("AI 일정 뽑기가 꺼져 있습니다");
  await expect(page.locator("[data-axr-state-body]")).toContainText(AI_DISABLED_TEXT);
  expect(aiCalls(calls)).toEqual([]);

  const page2 = await page.context().newPage();
  await setup(page2, { width: 390, ai: { groups: new Map([[GROUP, [failure(503, "AI_DISABLED")]]]) } });
  await openReview(page2, { expectMain: false });
  await expect(page2.locator("[data-axr-state-body]")).toContainText(AI_DISABLED_TEXT);
  await page2.close();
  done();
});

test("주소·상태: UUID가 아닌 주소는 서버를 부르지 않고, 아직 읽는 중·이미 넣은 묶음은 한 줄로 안내한다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: new Map([[GROUP, [groupView({ status: "running" }), groupView({ status: "confirmed", confirmedAt: "2026-11-23T04:58:00.000Z" })]]]) } });
  await page.goto("/admin/work/ai/review/?id=../x");
  await expect(page.locator("[data-axr-state-title]")).toHaveText("주소가 맞지 않습니다");
  expect(aiCalls(calls)).toEqual([]);
  await openReview(page, { expectMain: false });
  await expect(page.locator("[data-axr-state-title]")).toHaveText("아직 읽는 중입니다");
  await openReview(page, { expectMain: false });
  await expect(page.locator("[data-axr-state-title]")).toHaveText("이미 거래에 넣은 결과입니다");
  done();
});

for (const width of [360, 390, 1280]) {
  test(`S-18 폭 ${width}px: 비교·확인·넣은 뒤 화면 모두 가로 넘침 0, 넘어가기·넣기 단추 44px 이상, 아래 막대가 아래 탭 위에 있다`, async ({ page }) => {
    const done = collectErrors(page);
    await setup(page, { width, ai: { groups: new Map([[GROUP, [groupView({ pairMode: "same_unset", jobs: [job(1, { model: MODEL_A, maskedCount: 1 }), job(2, { model: MODEL_A, value: result({ balance: "2026-12-31", middles: [] }) })] })]]]) } });
    await openReview(page);
    const { next } = foot(page);
    expect(await overflowOf(page), "비교 화면 가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "비교 화면");
    await shot(page, `ai-review-${width}-compare.png`);
    await page.locator("[data-axr-chip='balanceDate:second']").click();
    const chipHeight = (await page.locator("[data-axr-chip='balanceDate:second']").boundingBox()).height;
    // 옛 두 번 읽기 묶음(교차 아님)이다. 한 번 읽기 묶음은 아래 'S-18 한 번 읽기' 시험이 같은 폭으로 본다.
    expect(chipHeight).toBeGreaterThanOrEqual(width >= 1221 ? 36 : 44);
    expect((await next.boundingBox()).height, "넘어가기 단추(주 단추)는 마우스 PC에서도 44px").toBeGreaterThanOrEqual(44);
    if (width < 980) {
      const tabTop = (await page.locator(".admin-tabbar").boundingBox()).y;
      const nextBox = await next.boundingBox();
      expect(nextBox.y + nextBox.height, "아래 막대가 아래 탭에 가려지지 않음").toBeLessThanOrEqual(tabTop + 1);
    }
    await next.click();
    await expect(page.locator("[data-axr-title]"), "단계를 넘기면 제목으로 포커스").toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.className ?? ""), "건너뛰기 고리가 아님").not.toContain("skip-link");
    expect(await overflowOf(page), "확인 화면 가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "확인 화면");
    expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await shot(page, `ai-review-${width}-confirm.png`);
    // 맨 아래까지 내리면 '넣지 않는 것' 마지막 줄이 아래 고정 막대 위로 다 보인다.
    // 글꼴·레이아웃이 자리 잡는 동안 높이가 바뀔 수 있어 맨 아래에 닿을 때까지 다시 내린다.
    await expect.poll(() => page.evaluate(() => {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" });
      return Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
    }), "맨 아래까지 내려감").toBe(true);
    const lastLine = await page.locator(".ax-out li").last().boundingBox();
    const barTop = (await page.locator("[data-axr-foot]").boundingBox()).y;
    expect(lastLine.y + lastLine.height, "마지막 줄이 막대에 가려지지 않음").toBeLessThanOrEqual(barTop);
    await shot(page, `ai-review-${width}-confirm-bottom.png`);
    await next.click();
    await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
    expect(await overflowOf(page), "넣은 뒤 가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "넣은 뒤");
    await shot(page, `ai-review-${width}-done.png`);
    done();
  });
}

for (const width of [360, 390, 1280]) {
  test(`S-18 한 번 읽기 폭 ${width}px: 값 고르기·확인 화면 가로 넘침 0, 고르기 단추 44px(마우스 PC 36px) 이상, 아래 막대가 아래 탭 위에 있다`, async ({ page }) => {
    const done = collectErrors(page);
    await setup(page, { width, ai: { groups: new Map([[GROUP, [singleView({ jobs: [job(1, { maskedCount: 1 })] })]]]) } });
    await openReview(page);
    const { next } = foot(page);
    expect(await overflowOf(page), "값 고르기 화면 가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "값 고르기 화면");
    await shot(page, `ai-review-single-${width}-compare.png`);
    for (const field of ["contractDate", "balanceDate", "priceWon"]) await page.locator(`[data-axr-chip='${field}:first']`).click();
    const chipHeight = (await page.locator("[data-axr-chip='balanceDate:first']").boundingBox()).height;
    expect(chipHeight).toBeGreaterThanOrEqual(width >= 1221 ? 36 : 44);
    expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(44);
    if (width < 980) {
      const tabTop = (await page.locator(".admin-tabbar").boundingBox()).y;
      const nextBox = await next.boundingBox();
      expect(nextBox.y + nextBox.height, "아래 막대가 아래 탭에 가려지지 않음").toBeLessThanOrEqual(tabTop + 1);
    }
    await next.click();
    await expect(page.locator("[data-axr-title]")).toBeFocused();
    expect(await overflowOf(page), "확인 화면 가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "확인 화면");
    await shot(page, `ai-review-single-${width}-confirm.png`);
    done();
  });
}

for (const width of [360, 390, 1280]) {
  test(`S-18 손님 카드 AI 상자 폭 ${width}px: 시작·읽는 중·결과 나옴 모두 가로 넘침 0이고 단추 44px(마우스 PC 36px, 주 단추 44px) 이상`, async ({ page }) => {
    const done = collectErrors(page);
    const running = singleView({ status: "running", jobs: [job(1, { status: "in_progress" })] });
    const ready = singleView();
    await setup(page, { width, ai: { groups: new Map([[GROUP, [running, ready]]]) } });
    await openCopies(page);
    const ax = box(page);
    await expect(ax.locator("[data-ax-go]")).toBeEnabled();
    expect(await overflowOf(page)).toBe(0);
    expect((await ax.locator("[data-ax-go]").boundingBox()).height).toBeGreaterThanOrEqual(44);
    await ax.scrollIntoViewIfNeeded();
    await expectStyledButtons(ax, "시작 칸");
    await shot(page, `ai-box-${width}-start.png`);
    await ax.locator("[data-ax-go]").click();
    await expect(ax.locator("h4")).toContainText("읽는 중");
    expect(await overflowOf(page)).toBe(0);
    expect((await ax.locator("[data-ax-quit]").boundingBox()).height).toBeGreaterThanOrEqual(width >= 1221 ? 36 : 44);
    await expectStyledButtons(ax, "읽는 중");
    await shot(page, `ai-box-${width}-running.png`);
    await expect.poll(() => page.evaluate(() => window.__axDelays.length)).toBe(1);
    await page.clock.runFor(5_000);
    await expect.poll(() => page.evaluate(() => window.__axDelays.length)).toBe(2);
    await page.clock.runFor(5_000);
    await expect(ax.locator("h4")).toContainText("결과 나옴");
    expect(await overflowOf(page)).toBe(0);
    expect((await ax.locator("[data-ax-review]").boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expectStyledButtons(ax, "결과 나옴");
    await shot(page, `ai-box-${width}-ready.png`);
    done();
  });
}
