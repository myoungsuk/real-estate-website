// 계약서 AI 일정 뽑기 화면의 순수 부품(src/lib/work/contract-ai-view.mjs) 시험(단계 4 화면 PR, 화면 시험 기준 S-01 ~ S-18의 글·규칙 몫).
// 일정 미리 보기는 가짜 D1(node:sqlite)로 실제 확정 서버를 돌려 같은 일정이 나오는지 대조한다. OpenAI·R2 원본은 부르지 않는다(덫).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { validateContractResult } from "../src/lib/work/contract-extract.mjs";
import {
  AI_CONFLICT_TEXT,
  AI_COPY_TRASHED_TEXT,
  AI_DEAL_CLOSED_TEXT,
  AI_DISABLED_TEXT,
  AI_POLL_FAST_MS,
  AI_POLL_SLOW_MS,
  aiCanApply,
  aiConfirmBody,
  aiConfirmErrorText,
  aiCreateErrorText,
  aiDollarText,
  aiElapsedText,
  aiEstimateLines,
  aiEvidenceOf,
  aiHalfText,
  aiInitialChoices,
  aiIntoRows,
  aiJobErrorText,
  aiManualProblem,
  aiPendingFields,
  aiPollDelay,
  aiReviewHref,
  aiReviewParams,
  aiSchedulePreview,
  aiSummary,
  aiValueText,
  compareContractResults,
  dealScheduleInput,
} from "../src/lib/work/contract-ai-view.mjs";
import { installNetworkTrap } from "./openai-fixtures.mjs";
import { MARK, aiEnv, sampleContract, seedCopy, setLimits } from "./work-ai-test-kit.mjs";
import { NOW, createR2, freshDb, nextUuid, work } from "./work-test-kit.mjs";

const AT = new Date(NOW).toISOString();
const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));
const ev = (quote = "", page = 1, box = null) => ({ page, quote, box });
const payment = (amount, date) => ({ amount: { value: amount, evidence: ev() }, date: { value: date, evidence: ev(date ? "중도금 가상 문구" : "") } });
// 결과 하나(가상 값). 검사를 통과한 snake_case 결과를 돌려준다(화면이 조회로 받는 꼴).
function result({ contractDate = "2026-11-02", price = 350_000_000, deposit = null, rent = null, middles = [], balance = "2026-12-30", dealType = "sale" } = {}) {
  const checked = validateContractResult(sampleContract({
    deal_type: dealType,
    contract_date: { value: contractDate, evidence: ev(MARK.quote, 1, [0.1, 0.2, 0.4, 0.25]) },
    price_won: { value: price, evidence: ev(price === null ? "" : "매매대금 가상 문구") },
    deposit_won: { value: deposit, evidence: ev() },
    monthly_rent_won: { value: rent, evidence: ev() },
    middle_payments: middles.map((date, index) => payment(10_000_000 * (index + 1), date)),
    balance: payment(123_456_789, balance),
  }));
  assert.equal(checked.ok, true, "시험 결과는 검사를 통과하는 꼴");
  return checked.result;
}

// ── 글·조회 간격 ──

test("S-02 조회 간격: 지켜보기 1분까지 5초, 그 뒤 15초이고, 지난 시간·달러 글은 정해진 꼴이다", () => {
  assert.equal(aiPollDelay(0), AI_POLL_FAST_MS);
  assert.equal(aiPollDelay(59_999), 5_000);
  assert.equal(aiPollDelay(60_000), AI_POLL_SLOW_MS);
  assert.equal(aiPollDelay(600_000), 15_000);
  assert.deepEqual([aiElapsedText(40_000), aiElapsedText(80_000), aiElapsedText(120_000), aiElapsedText(-5)], ["40초 지남", "1분 20초 지남", "2분 지남", "0초 지남"]);
  assert.deepEqual([aiDollarText(1_400_000), aiDollarText(0), aiDollarText(5_000)], ["1.40달러", "0.00달러", "0.01달러 미만"]);
});

test("S-01 비용 미리 보기: 막힌 까닭(한도 없음·하루·월)마다 한 줄이고 막히지 않으면 까닭이 없다", () => {
  const base = { pages: 2, requests: 2, estimatedCostMicroUsd: 1_400_000, dailyCreateLimit: 10, todayCreates: 1, remainingCreates: 9, monthlyCostLimitMicroUsd: 10_000_000, monthCostMicroUsd: 0, remainingCostMicroUsd: 10_000_000, allowed: true, blockedBy: null };
  assert.deepEqual(aiEstimateLines(base), { cost: "최대 약 1.40달러", limit: "이번 달 10.00달러 · 오늘 9회(이번에 2회 씀)", blocked: null });
  assert.match(aiEstimateLines({ ...base, remainingCostMicroUsd: null, allowed: false, blockedBy: "limits_missing" }).blocked, /한도.*정하지 않아/u);
  assert.equal(aiEstimateLines({ ...base, remainingCostMicroUsd: null, blockedBy: "limits_missing" }).limit, "한도를 아직 정하지 않았습니다");
  assert.match(aiEstimateLines({ ...base, remainingCreates: 1, allowed: false, blockedBy: "daily" }).blocked, /남은 1회, 이번에 2회 필요/u);
  assert.match(aiEstimateLines({ ...base, remainingCostMicroUsd: 1_000_000, allowed: false, blockedBy: "monthly" }).blocked, /남은 1\.00달러/u);
});

test("S-01·S-12 오류 글: AI 꺼짐은 정해진 한 줄, 모르는 코드는 손님 화면 공통 문장, 결과를 못 받은 실패는 새 비용을 밝힌다", () => {
  assert.equal(AI_DISABLED_TEXT, "AI 일정 뽑기가 아직 켜지지 않았습니다.");
  assert.equal(aiCreateErrorText("AI_DISABLED"), AI_DISABLED_TEXT);
  assert.equal(aiConfirmErrorText("AI_DISABLED", []), AI_DISABLED_TEXT, "확정 중에 꺼져도 같은 문장");
  assert.match(aiCreateErrorText("AI_INPUT_TOO_LARGE"), /5장, 합계 12MB/u);
  assert.match(aiCreateErrorText("AI_STATE_UNKNOWN"), /비용이 들었을 수 있으니/u);
  assert.equal(aiCreateErrorText("SOMETHING_NEW", (code) => `공통:${code}`), "공통:SOMETHING_NEW");
  for (const code of ["AI_RESULT_INCOMPLETE", "AI_RESULT_EXPIRED"]) assert.match(aiJobErrorText(code), /다시 실행하면 새 비용이 듭니다/u, code);
  const texts = ["AI_RESULT_INVALID", "AI_RESULT_INCOMPLETE", "AI_RESULT_EXPIRED", "AI_STATE_UNKNOWN", "AI_LEASE_EXPIRED"].map(aiJobErrorText);
  assert.equal(new Set(texts).size, 5, "다섯 까닭은 서로 다른 문장");
  assert.match(aiJobErrorText(null), /결과를 받지 못했습니다/u);
});

test("S-14 ~ S-16·G20 확정 실패 글: 충돌 두 코드는 같은 한 줄, 사본 휴지통·끝난 거래는 정해진 문장, 400은 칸 이름을 든다", () => {
  assert.equal(aiConfirmErrorText("VERSION_CONFLICT", []), "다른 곳에서 바뀌었습니다. 다시 불러와 주세요.");
  assert.equal(aiConfirmErrorText("AI_JOB_STATE_CONFLICT", []), AI_CONFLICT_TEXT);
  assert.equal(aiConfirmErrorText("NOT_FOUND", []), AI_COPY_TRASHED_TEXT);
  assert.equal(AI_DEAL_CLOSED_TEXT, "끝난 거래와 취소한 거래에는 AI 결과를 넣을 수 없습니다.", "G20 문장(대장 결정) 그대로");
  assert.equal(aiConfirmErrorText("DEAL_CLOSED", []), AI_DEAL_CLOSED_TEXT);
  assert.match(aiConfirmErrorText("VALIDATION_FAILED", ["middlePayments", "balanceDate"]), /중도금일, 잔금일/u);
  assert.equal(aiConfirmErrorText("VALIDATION_FAILED", []), "넣을 값이 맞지 않습니다. 칸을 다시 확인해 주세요.");
  assert.equal(aiConfirmErrorText("UNKNOWN", [], () => "공통"), "공통");
});

// ── 비교·고르기 ──

test("S-05 모두 같음: 같은 칸은 처음부터 넣을 값으로 정해지고 고를 칸이 없으며 확정 본문은 apply만 있다", () => {
  const a = result({ middles: ["2026-11-20"] });
  const comparison = compareContractResults(a, result({ middles: ["2026-11-20"] }), "sale");
  const choices = aiInitialChoices(comparison);
  assert.deepEqual(aiPendingFields(comparison, choices), []);
  assert.deepEqual(aiSummary(comparison).different + aiSummary(comparison).oneSide, 0);
  assert.deepEqual(aiConfirmBody(comparison, choices, 3), {
    dealVersion: 3, apply: { contractDate: "2026-11-02", middlePayments: ["2026-11-20"], balanceDate: "2026-12-30", priceWon: 350_000_000 }, keep: [],
  });
});

test("S-06 다름: 고르기 전에는 그 칸이 남고, 1회·2회·지금 값 그대로·직접 넣기 가운데 하나를 고르면 본문에 들어간다", () => {
  const comparison = compareContractResults(result({ balance: "2026-12-30" }), result({ balance: "2026-12-31" }), "sale");
  const choices = aiInitialChoices(comparison);
  assert.deepEqual(aiPendingFields(comparison, choices), ["balanceDate"]);
  assert.equal(choices.balanceDate, undefined);
  for (const [choice, expected] of [
    [{ kind: "first", value: "2026-12-30" }, { apply: "2026-12-30" }],
    [{ kind: "second", value: "2026-12-31" }, { apply: "2026-12-31" }],
    [{ kind: "keep", value: null }, { keep: true }],
    [{ kind: "manual", value: "2026-12-29" }, { apply: "2026-12-29" }],
  ]) {
    const next = { ...choices, balanceDate: choice };
    assert.deepEqual(aiPendingFields(comparison, next), [], choice.kind);
    const body = aiConfirmBody(comparison, next, 1);
    if (expected.keep) assert.deepEqual([body.keep, Object.hasOwn(body.apply, "balanceDate")], [["balanceDate"], false]);
    else assert.equal(body.apply.balanceDate, expected.apply);
  }
  assert.deepEqual(aiPendingFields(comparison, { ...choices, balanceDate: { kind: "manual", value: "" } }), ["balanceDate"], "빈 직접 넣기는 고른 것이 아님");
});

test("S-07 한쪽만: 한쪽만 읽은 중도금도, 한 작업이 실패해 모든 칸이 한쪽만인 경우도 사람이 골라야 하고 위 알림이 붙는다", () => {
  const comparison = compareContractResults(result({ middles: ["2026-11-20"] }), result(), "sale");
  assert.equal(comparison.fields.find((item) => item.field === "middlePayments").status, "one_side");
  assert.deepEqual(aiPendingFields(comparison, aiInitialChoices(comparison)), ["middlePayments"]);
  const half = compareContractResults(result(), null, "sale");
  assert.deepEqual(aiPendingFields(half, aiInitialChoices(half)), ["contractDate", "middlePayments", "balanceDate", "priceWon"], "한쪽 결과만 있으면 빈 중도금도 한쪽만");
  assert.equal(aiHalfText([{ runIndex: 1, result: {} }, { runIndex: 2, result: null }]), "2회째가 실패해 1회째 결과만 있습니다. 모든 칸을 직접 골라 주세요.");
  assert.equal(aiHalfText([{ runIndex: 1, result: {} }, { runIndex: 2, result: {} }]), null);
});

test("고르기 규칙: 못 읽은 차가 있는 중도금은 그대로 넣을 수 없고, 직접 넣기 값은 날짜·원 단위 정수·1 ~ 4차만 받는다", () => {
  assert.equal(aiCanApply("middlePayments", ["2026-11-20", null]), false);
  assert.equal(aiCanApply("middlePayments", ["2026-11-20"]), true);
  assert.equal(aiCanApply("middlePayments", Array(5).fill("2026-11-20")), false);
  assert.equal(aiCanApply("priceWon", null), false);
  assert.equal(aiManualProblem("contractDate", "2026-11-02"), null);
  assert.equal(aiManualProblem("contractDate", "11/02"), "날짜를 골라 주세요.");
  assert.equal(aiManualProblem("priceWon", 1.5), "금액을 원 단위 숫자로 넣어 주세요.");
  assert.equal(aiManualProblem("priceWon", -1), "금액을 원 단위 숫자로 넣어 주세요.");
  assert.equal(aiManualProblem("middlePayments", []), "중도금 날짜를 1 ~ 4개 넣어 주세요.");
  assert.equal(aiManualProblem("middlePayments", ["2026-11-20", ""]), "중도금 날짜 칸이 비었거나 형식이 맞지 않습니다.");
});

test("S-08 근거·값 글: 원문 글이 있는 칸만 근거를 돌려주고, 날짜에는 요일, 중도금은 차 수, 금액은 원 글을 붙인다", () => {
  const a = result({ middles: ["2026-11-20", "2026-12-01"] });
  assert.deepEqual(aiEvidenceOf(a, "contractDate"), { page: 1, quote: MARK.quote, box: [0.1, 0.2, 0.4, 0.25] });
  assert.equal(aiEvidenceOf(a, "depositWon"), null, "값이 없으면 근거 없음");
  assert.equal(aiEvidenceOf(null, "contractDate"), null);
  assert.equal(aiValueText("contractDate", "2026-11-02"), "2026-11-02 (월)");
  assert.equal(aiValueText("middlePayments", ["2026-11-20", null]), "1차 2026-11-20 (금) · 2차 못 읽음");
  assert.equal(aiValueText("priceWon", null), null);
  assert.equal(aiValueText("documentKind", "sale_contract"), "매매 계약서");
});

test("확정 전 확인: 지금 거래 값 → 넣을 값을 그대로·새로·덮어씀으로 가리고, 중도금은 첫째 차만 거래 칸과 견준다", () => {
  const deal = { contractOn: "2026-11-02", middlePaymentOn: null, balanceOn: "2026-12-20", priceWon: 350_000_000 };
  const rows = aiIntoRows(deal, { dealVersion: 1, apply: { contractDate: "2026-11-02", middlePayments: ["2026-11-20", "2026-12-01"], balanceDate: "2026-12-30" }, keep: ["priceWon"] });
  assert.deepEqual(rows, [
    { field: "contractDate", before: "2026-11-02", after: "2026-11-02", change: "same" },
    { field: "middlePayments", before: null, after: "2026-11-20", change: "new" },
    { field: "balanceDate", before: "2026-12-20", after: "2026-12-30", change: "overwrite" },
  ]);
});

// ── S-17 주소 ──

test("S-17 결과 고르기 주소: 설계 경로 /admin/work/ai/review/에 묶음 UUID와 돌아갈 손님 UUID만 싣고, UUID가 아닌 값은 버린다", () => {
  const group = "00000000-0000-4000-8000-000000000123";
  const customer = "00000000-0000-4000-8000-000000000001";
  assert.equal(aiReviewHref(group, customer), `/admin/work/ai/review/?id=${group}&from=${customer}`);
  assert.equal(aiReviewHref(group, "가상 손님"), `/admin/work/ai/review/?id=${group}`);
  assert.deepEqual(aiReviewParams(`?id=${group}&from=${customer}&q=x`), { id: group, from: customer });
  assert.deepEqual(aiReviewParams("?id=../x&from=010"), { id: null, from: null });
});

// ── 일정 미리 보기 ↔ 확정 서버 ──

// 서버 scheduleInput(내보내지 않음)을 원본 글에서 꺼내 그대로 돌린다. 행(snake_case)만 받는 함수라 따로 떼어도 같은 값이 나온다.
const eventsSource = readFileSync(new URL("../worker/work-events.mjs", import.meta.url), "utf8");
const scheduleInputSource = eventsSource.slice(eventsSource.indexOf("function scheduleInput(row)"), eventsSource.indexOf("// 계산 전에 비어 있으면 안 되는 거래 칸"));
const serverScheduleInput = new Function(`return ${scheduleInputSource}`)();

test("거래 칸 → 일정 계산 입력은 서버 scheduleInput과 같은 칸 이름·같은 순서다(원본 대조)", () => {
  const serverKeys = [...scheduleInputSource.matchAll(/^ {4}(\w+):/gmu)].map((match) => match[1]);
  const deal = { dealType: "sale", saleKind: null, propertyKind: "housing", scheduleTarget: null, regulation: "none" };
  assert.ok(serverKeys.length >= 17, "서버 칸을 읽음");
  assert.deepEqual(Object.keys(dealScheduleInput(deal)), serverKeys);
});

async function serverCase(t, { deal, results, events: prepare, edit }) {
  installNetworkTrap(t);
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2);
  setLimits(database);
  const made = await work(env, "/deals", { method: "POST", body: { title: MARK.title, propertyKind: "housing", propertyLabel: "가상단지", ...deal } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const dealId = made.json.data.deal.id;
  const fileIds = [await seedCopy(database, r2, { dealId }), await seedCopy(database, r2, { dealId })];
  const groupId = insertGroup(database, fileIds, results);
  if (prepare) await prepare(env, dealId, { database, fileIds });
  return confirmGroup(env, database, dealId, groupId, edit);
}

// 끝난 묶음 하나(두 작업)를 가짜 D1에 넣는다.
function insertGroup(database, fileIds, results) {
  const groupId = nextUuid();
  results.forEach((item, index) => {
    database.prepare(`INSERT INTO ai_jobs (id, group_id, run_index, pair_mode, kind, status, model, reasoning_effort, input_file_ids, result_json, error_code, confirmed_at, created_at, updated_at)
      VALUES (?, ?, ?, 'cross', 'contract_schedule', 'completed', ?, 'max', ?, ?, NULL, NULL, ?, ?)`).run(
      nextUuid(), groupId, index + 1, `gpt-test-contract-${index === 0 ? "a" : "b"}`, JSON.stringify(fileIds), JSON.stringify({ maskedCount: 0, result: item }), AT, AT,
    );
  });
  return groupId;
}

// 화면과 같은 순서로 확정한다(edit로 본문을 바꿔 볼 수 있음).
async function confirmGroup(env, database, dealId, groupId, edit = (body) => body) {
  // 화면이 받는 그대로: 거래 하나(GET /deals/:id)와 묶음 조회의 결과
  const detail = (await work(env, `/deals/${dealId}`)).json.data;
  const row = database.prepare("SELECT * FROM deals WHERE id = ?").get(dealId);
  assert.deepEqual(dealScheduleInput(detail.deal), serverScheduleInput({ ...row }), "거래 응답(camelCase)으로 만든 계산 입력 = 서버가 행으로 만든 입력");
  const view = (await work(env, `/ai/jobs/${groupId}`)).json.data;
  const comparison = compareContractResults(view.jobs[0].result, view.jobs[1].result, detail.deal.dealType);
  const body = edit(aiConfirmBody(comparison, aiInitialChoices(comparison), detail.deal.version));
  const preview = aiSchedulePreview(detail.deal, body, detail.events, legalRules);
  const confirmed = await work(env, `/ai/jobs/${groupId}/confirm`, { method: "POST", body });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  return { preview, data: confirmed.json.data };
}

// 미리 보기와 확정 응답을 같은 꼴로 줄인다: 남길 일정(kept)은 남는 날짜로, AI가 넣은 중도금은 제목 그대로.
const previewRows = (preview) => preview.events.map((event) => [event.kind, event.kept ?? event.date, event.source === "ai" ? event.title : event.kind]).sort();
const serverRows = (data) => data.events.filter((event) => event.source !== "ai_confirmed" || event.doneAt === null)
  .map((event) => [event.kind, event.dueOn, event.kind === "custom" ? event.title : event.kind]).sort();

for (const [label, input] of [
  ["매매 주택(규제 없음)", { deal: { dealType: "sale", priceWon: 350_000_000 }, results: [result(), result()] }],
  ["매매 주택 조정 지역·법인·토지거래허가·수도권 + 중도금 3차", {
    deal: { dealType: "sale", regulation: "adjusted", buyerIsCorporation: true, landPermitArea: true, metroArea: true },
    results: [result({ middles: ["2026-11-20", "2026-12-01", "2026-12-10"] }), result({ middles: ["2026-11-20", "2026-12-01", "2026-12-10"] })],
  }],
  ["법인 매수 주택(그 밖 조건 없음, 1억)", { deal: { dealType: "sale", buyerIsCorporation: true }, results: [result({ price: 100_000_000 }), result({ price: 100_000_000 })] }],
  ["분양권 매매(투기과열)", { deal: { dealType: "sale", saleKind: "status_sale", regulation: "overheated" }, results: [result(), result()] }],
  ["전세 신고 지역", { deal: { dealType: "jeonse", leaseReportingRegion: true }, results: [result({ dealType: "jeonse", price: null, deposit: 300_000_000 }), result({ dealType: "jeonse", price: null, deposit: 300_000_000 })] }],
  ["월세 신고 지역", { deal: { dealType: "monthly_rent", leaseReportingRegion: true }, results: [result({ dealType: "monthly_rent", price: null, deposit: 10_000_000, rent: 700_000 }), result({ dealType: "monthly_rent", price: null, deposit: 10_000_000, rent: 700_000 })] }],
  ["오피스텔(일정 판정 그 밖)", { deal: { dealType: "sale", propertyKind: "officetel", scheduleTarget: "other" }, results: [result(), result()] }],
  ["토지 매매", { deal: { dealType: "sale", propertyKind: "land" }, results: [result(), result()] }],
]) {
  test(`일정 미리 보기 = 확정 서버 결과: ${label}`, async (t) => {
    const { preview, data } = await serverCase(t, input);
    assert.equal(preview.ok, true);
    assert.deepEqual(previewRows(preview), serverRows(data));
    assert.deepEqual(preview.events.filter((event) => event.kept !== null).map((event) => event.kind), data.kept.map((item) => item.kind));
  });
}

test("일정 미리 보기 = 확정 서버 결과: 완료한 자동 일정·사람이 고친 일정은 남는 날짜로, 완료한 2차 중도금은 넣지 않는다", async (t) => {
  const middles = ["2026-11-20", "2026-12-01", "2026-12-10"];
  const { preview, data } = await serverCase(t, {
    deal: { dealType: "sale", priceWon: 340_000_000, contractOn: "2026-11-01", balanceOn: "2026-12-29" },
    results: [result({ middles }), result({ middles })],
    events: async (env, dealId) => {
      const calculated = await work(env, `/deals/${dealId}/events/calculate`, { method: "POST", body: { replaceCalculated: true } });
      assert.equal(calculated.status, 200, JSON.stringify(calculated.json));
      const [contract, balance] = ["contract", "balance"].map((kind) => calculated.json.data.events.find((event) => event.kind === kind));
      assert.equal((await work(env, `/events/${contract.id}`, { method: "PATCH", body: { version: contract.version, done: true } })).status, 200);
      assert.equal((await work(env, `/events/${balance.id}`, { method: "PATCH", body: { version: balance.version, dueOn: "2026-12-28" } })).status, 200);
      const custom = await work(env, `/deals/${dealId}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-01", title: "2차 중도금(가상단지)", alarmOffsets: [] } });
      assert.equal(custom.status, 201, JSON.stringify(custom.json));
      assert.equal((await work(env, `/events/${custom.json.data.event.id}`, { method: "PATCH", body: { version: 1, done: true } })).status, 200);
    },
  });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.events.filter((event) => event.source === "ai").map((event) => event.title), ["3차 중도금(가상단지)"], "완료한 2차는 미리 보기에도 없음");
  assert.deepEqual(preview.previous, [], "직접 넣은 일정(manual)은 앞 AI 결과 줄에 넣지 않음");
  assert.deepEqual(preview.twins, [], "완료한 직접 2차는 서버가 AI 2차를 건너뛰므로 두 줄 경고도 없음");
  assert.ok(data.notices.includes("2차 중도금은 이미 완료 표시돼 새로 넣지 않았습니다."));
  assert.deepEqual(previewRows(preview).filter((row) => row[0] !== "custom"), serverRows(data).filter((row) => row[0] !== "custom"));
  assert.deepEqual(previewRows(preview).filter((row) => row[0] === "custom"), data.events.filter((event) => event.source === "ai_confirmed").map((event) => ["custom", event.dueOn, event.title]));
  assert.deepEqual(preview.events.filter((event) => event.kept !== null).map((event) => [event.kind, event.kept, event.keptReason]).sort(), data.kept.map((item) => [item.kind, item.keptOn, item.reason]).sort(), "남는 날짜·까닭(완료·직접 고침)이 서버와 같음");
});

// 다시 확정: 앞 확정이 넣은 2·3차 중도금(custom·ai_confirmed)이 미리 보기 previous에 서버와 같은 판정으로 나온다.
// 확정 뒤 서버의 ai_confirmed 일정 = previous의 '그대로'(done·kept) + 미리 보기의 새 AI 중도금이어야 한다.
const aiRows = (data) => data.events.filter((event) => event.source === "ai_confirmed").map((event) => [event.dueOn, event.title, event.doneAt !== null]).sort();
const predictedAiRows = (preview) => [
  ...preview.previous.filter((item) => item.status === "done" || item.status === "kept").map((item) => [item.date, item.title, item.status === "done"]),
  ...preview.events.filter((event) => event.source === "ai").map((event) => [event.date, event.title, false]),
].sort();
const FIRST_MIDDLES = ["2026-11-20", "2026-12-01", "2026-12-10"];
const reconfirmDeal = { dealType: "sale", priceWon: 340_000_000, contractOn: "2026-11-01", balanceOn: "2026-12-29" };
// 첫 묶음(중도금 3차)을 확정해 2·3차를 ai_confirmed로 넣고, 그 뒤 새 묶음 결과를 넣는다.
const confirmFirst = (after) => async (env, dealId, { database, fileIds }) => {
  const first = await confirmGroup(env, database, dealId, insertGroup(database, fileIds, [result({ middles: FIRST_MIDDLES }), result({ middles: FIRST_MIDDLES })]));
  assert.deepEqual(first.data.events.filter((event) => event.source === "ai_confirmed").map((event) => event.title).sort(), ["2차 중도금(가상단지)", "3차 중도금(가상단지)"]);
  if (after) await after(env, first.data, dealId);
};

test("다시 확정 = 확정 서버 결과: 앞 확정 2·3차 → 새 결과 중도금 1개면 2·3차 모두 '지움'이고 서버에도 AI 중도금이 남지 않는다", async (t) => {
  const { preview, data } = await serverCase(t, { deal: reconfirmDeal, results: [result({ middles: ["2026-11-25"] }), result({ middles: ["2026-11-25"] })], events: confirmFirst() });
  assert.equal(preview.ok, true);
  assert.deepEqual(preview.previous.map((item) => [item.date, item.title, item.status, item.next]), [
    ["2026-12-01", "2차 중도금(가상단지)", "removed", null],
    ["2026-12-10", "3차 중도금(가상단지)", "removed", null],
  ]);
  assert.deepEqual(aiRows(data), [], "서버도 끝나지 않은 앞 AI 중도금을 지웠음");
  assert.deepEqual(predictedAiRows(preview), aiRows(data));
  assert.deepEqual(previewRows(preview), serverRows(data));
});

test("다시 확정 = 확정 서버 결과: 새 결과 2차까지면 2차 '바뀜'(새 날짜), 완료로 표시한 3차는 '그대로, 완료'", async (t) => {
  const middles = ["2026-11-22", "2026-12-05"];
  const { preview, data } = await serverCase(t, {
    deal: reconfirmDeal,
    results: [result({ middles }), result({ middles })],
    events: confirmFirst(async (env, first, dealId) => {
      const third = first.events.find((event) => event.title === "3차 중도금(가상단지)");
      assert.equal((await work(env, `/events/${third.id}`, { method: "PATCH", body: { version: third.version, done: true } })).status, 200);
      // 직접 넣은 일정은 앞 AI 결과 줄에도 없고 서버도 지우지 않는다.
      const own = await work(env, `/deals/${dealId}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-15", title: "가상 점검 일정", alarmOffsets: [] } });
      assert.equal(own.status, 201, JSON.stringify(own.json));
    }),
  });
  assert.deepEqual(preview.previous.map((item) => [item.date, item.status, item.next]), [["2026-12-01", "changed", "2026-12-05"], ["2026-12-10", "done", null]]);
  assert.deepEqual(aiRows(data), [["2026-12-05", "2차 중도금(가상단지)", false], ["2026-12-10", "3차 중도금(가상단지)", true]]);
  assert.ok(data.events.some((event) => event.title === "가상 점검 일정" && event.source === "manual"), "직접 넣은 일정은 남음");
  assert.deepEqual(predictedAiRows(preview), aiRows(data));
});

test("다시 확정 = 확정 서버 결과: 새 결과의 중도금을 '지금 값 그대로'로 두면 앞 AI 중도금은 '그대로 둠'이고 서버도 지우지 않는다", async (t) => {
  const middles = ["2026-11-22", "2026-12-05"];
  const { preview, data } = await serverCase(t, {
    deal: reconfirmDeal,
    results: [result({ middles, balance: "2026-12-28" }), result({ middles, balance: "2026-12-28" })],
    events: confirmFirst(),
    edit: (body) => {
      const { middlePayments, ...apply } = body.apply;
      assert.ok(middlePayments, "새 결과에 중도금이 있음");
      return { ...body, apply, keep: [...body.keep, "middlePayments"] };
    },
  });
  assert.deepEqual(preview.previous.map((item) => [item.date, item.status]), [["2026-12-01", "kept"], ["2026-12-10", "kept"]]);
  assert.deepEqual(aiRows(data), [["2026-12-01", "2차 중도금(가상단지)", false], ["2026-12-10", "3차 중도금(가상단지)", false]]);
  assert.deepEqual(predictedAiRows(preview), aiRows(data));
});

test("다시 확정 = 확정 서버 결과: 앞 2·3차 → 새 결과도 2·3차면 둘 다 '바뀜'이고 새 날짜가 서버에 들어간 날짜와 짝이 맞는다", async (t) => {
  const middles = ["2026-11-20", "2026-12-03", "2026-12-12"];
  const { preview, data } = await serverCase(t, { deal: reconfirmDeal, results: [result({ middles }), result({ middles })], events: confirmFirst() });
  assert.deepEqual(preview.previous.map((item) => [item.title, item.date, item.status, item.next]), [
    ["2차 중도금(가상단지)", "2026-12-01", "changed", "2026-12-03"],
    ["3차 중도금(가상단지)", "2026-12-10", "changed", "2026-12-12"],
  ]);
  assert.deepEqual(aiRows(data), [["2026-12-03", "2차 중도금(가상단지)", false], ["2026-12-12", "3차 중도금(가상단지)", false]]);
  // 바뀜 줄의 새 날짜 = 서버가 같은 차 제목으로 넣은 날짜(차 수끼리 짝).
  for (const item of preview.previous) {
    assert.equal(data.events.find((event) => event.source === "ai_confirmed" && event.title === item.title)?.dueOn, item.next);
  }
  assert.deepEqual(predictedAiRows(preview), aiRows(data));
  assert.deepEqual(preview.twins, []);
});

test("일정 미리 보기 = 확정 서버 결과: 끝나지 않은 직접 '2차 중도금'이 있으면 '그대로 둠'(twins)이고 서버도 남겨 같은 차가 두 줄이 된다", async (t) => {
  const middles = ["2026-11-20", "2026-12-05", "2026-12-10"];
  const { preview, data } = await serverCase(t, {
    deal: reconfirmDeal,
    results: [result({ middles }), result({ middles })],
    events: async (env, dealId) => {
      for (const [dueOn, title] of [["2026-12-01", "2차 중도금(가상단지)"], ["2026-12-15", "가상 점검 일정"]]) {
        const made = await work(env, `/deals/${dealId}/events`, { method: "POST", body: { kind: "custom", dueOn, title, alarmOffsets: [] } });
        assert.equal(made.status, 201, JSON.stringify(made.json));
      }
    },
  });
  assert.deepEqual(preview.twins, [{ date: "2026-12-01", title: "2차 중도금(가상단지)", aiDate: "2026-12-05" }], "같은 차 직접 일정만, 다른 직접 일정은 아님");
  assert.deepEqual(preview.previous, []);
  const second = data.events.filter((event) => event.kind === "custom" && event.title.startsWith("2차 중도금")).map((event) => [event.dueOn, event.source]).sort();
  assert.deepEqual(second, [["2026-12-01", "manual"], ["2026-12-05", "ai_confirmed"]], "서버도 직접 2차를 남기고 AI 2차를 넣어 두 줄");
  // 서버의 2차 줄 = 미리 보기의 twins(직접) + 새 AI 2차
  assert.deepEqual(second, [...preview.twins.map((item) => [item.date, "manual"]), ...preview.events.filter((event) => event.source === "ai" && event.title.startsWith("2차 중도금")).map((event) => [event.date, "ai_confirmed"])].sort());
  assert.deepEqual(predictedAiRows(preview), aiRows(data));
});

test("일정 미리 보기: 계약일이 없으면 계산하지 않고(ok false) 계산 함수가 거절해도 ok false다", () => {
  const deal = { dealType: "sale", saleKind: null, propertyKind: "housing", scheduleTarget: null, regulation: "none", contractOn: null, priceWon: 1 };
  assert.deepEqual(aiSchedulePreview(deal, { dealVersion: 1, apply: {}, keep: [] }, [], legalRules), { ok: false });
  assert.equal(aiSchedulePreview({ ...deal, contractOn: "2026-11-02", balanceOn: "2026-11-01" }, { dealVersion: 1, apply: {}, keep: [] }, [], legalRules).ok, false);
});
