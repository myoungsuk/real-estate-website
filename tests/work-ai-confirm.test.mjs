// 단계 4 계약서 AI 확정(/confirm)·예상 비용 미리 보기(/ai/estimate) 시험(설계서 14.3절, 대장 결정 G18 ~ G21, 확정 서버 시험 기준 C-01 ~ C-24).
// 가짜 D1(node:sqlite)·가짜 R2·가짜 OpenAI만 쓴다. 전역 fetch는 덫으로 바꾸고, 확정·미리 보기는 OpenAI fetcher를 넘기지 않아(부르면 예외) 0번을 확인한다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONFIRM_AMOUNT_FIELDS_BY_TYPE,
  compareContractResults,
  confirmFieldsFor,
  contractValues,
  missingDecisions,
} from "../src/lib/work/contract-compare.mjs";
import { validateContractResult } from "../src/lib/work/contract-extract.mjs";
import { estimateCostMicroUsd } from "../worker/work-ai-config.mjs";
import { estimateContractInputTokens } from "../worker/work-ai-jobs.mjs";
import { AMOUNT_FIELDS_BY_TYPE } from "../worker/work-input.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { completed, created, installNetworkTrap, scriptedOpenAi } from "./openai-fixtures.mjs";
import { AI_MAX_OUTPUT, AI_PRICES, MARK, MODEL_A, MODEL_B, aiEnv, sampleContract, seedCopy, setLimits } from "./work-ai-test-kit.mjs";
import { NOW, ORIGIN, authenticate, createR2, freshDb, nextUuid, rows, signToken, work } from "./work-test-kit.mjs";

const AT = new Date(NOW).toISOString();
const count = (database, table) => rows(database, `SELECT count(*) AS n FROM ${table}`)[0].n;
const audits = (database, action) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events WHERE action = ? ORDER BY seq", action);
const jobRows = (database, groupId) => rows(database, "SELECT run_index, status, result_json, confirmed_at FROM ai_jobs WHERE group_id = ? ORDER BY run_index", groupId);
const dealRow = (database, id) => rows(database, "SELECT * FROM deals WHERE id = ?", id)[0];
const eventRows = (database, dealId) => rows(database, "SELECT id, kind, due_on, title, alarm_offsets, source, done_at, version FROM deal_events WHERE deal_id = ? ORDER BY due_on, kind, id", dealId);
const usageRows = (database) => rows(database, "SELECT * FROM ai_usage_daily ORDER BY day");
// 확정 전후로 그대로여야 하는 것 모두(쓰기 0 확인).
const snapshot = (database) => JSON.stringify({
  deals: rows(database, "SELECT * FROM deals ORDER BY id"),
  events: rows(database, "SELECT * FROM deal_events ORDER BY id"),
  jobs: rows(database, "SELECT * FROM ai_jobs ORDER BY id"),
  confirmAudits: rows(database, "SELECT * FROM audit_events WHERE action = 'ai.confirm'"),
  usage: rows(database, "SELECT * FROM ai_usage_daily ORDER BY day"),
});

const ev = (quote = "", page = 1) => ({ page, quote, box: null });
const payment = (amount, date) => ({ amount: { value: amount, evidence: ev() }, date: { value: date, evidence: ev() } });
// 결과 하나(가상 값). 기본: 계약 2026-11-02, 매매 3억 5천, 중도금 없음, 잔금 2026-12-30.
function contract({ contractDate = "2026-11-02", price = 350_000_000, deposit = null, rent = null, middles = [], balance = "2026-12-30", dealType = "sale" } = {}) {
  return sampleContract({
    deal_type: dealType,
    contract_date: { value: contractDate, evidence: ev(MARK.quote) },
    price_won: { value: price, evidence: ev() },
    deposit_won: { value: deposit, evidence: ev() },
    monthly_rent_won: { value: rent, evidence: ev() },
    middle_payments: middles.map((date, index) => payment(10_000_000 * (index + 1), date)),
    balance: payment(123_456_789, balance),
  });
}

async function makeDeal(env, body = {}) {
  const result = await work(env, "/deals", { method: "POST", body: { title: MARK.title, dealType: "sale", propertyKind: "housing", propertyLabel: "가상단지", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.deal;
}

// 묶음 행을 직접 넣는다(만들기·조회는 work-ai-jobs 시험이 본다). jobs: [{ status, result }] 두 개(1·2회째).
function seedGroup(database, fileIds, jobs, { kind = "contract_schedule", groupId = nextUuid() } = {}) {
  jobs.forEach((job, index) => {
    const checked = job.result ? validateContractResult(job.result) : null;
    if (job.result) assert.equal(checked.ok, true, "시험 결과는 검사를 통과하는 꼴");
    database.prepare(`INSERT INTO ai_jobs (id, group_id, run_index, pair_mode, kind, status, model, reasoning_effort, input_file_ids, result_json, error_code, confirmed_at, created_at, updated_at)
      VALUES (?, ?, ?, 'cross', ?, ?, ?, 'max', ?, ?, ?, ?, ?, ?)`).run(
      nextUuid(), groupId, index + 1, kind, job.status ?? "completed", index === 0 ? MODEL_A : MODEL_B, JSON.stringify(fileIds),
      checked ? JSON.stringify({ maskedCount: 0, result: checked.result }) : null, job.status === "failed" ? "AI_RESULT_INVALID" : null, job.confirmedAt ?? null, AT, AT,
    );
  });
  return groupId;
}

// 흔한 준비: 켜진 env + 한도 + 거래(API로 만듦) + 계약서 사본 2장 + 묶음(두 결과).
async function setup({ deal = {}, results = [contract(), contract()], statuses = ["completed", "completed"], limits = true } = {}) {
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2);
  if (limits) setLimits(database);
  const made = await makeDeal(env, deal);
  const fileIds = [await seedCopy(database, r2, { dealId: made.id }), await seedCopy(database, r2, { dealId: made.id })];
  const groupId = seedGroup(database, fileIds, statuses.map((status, index) => ({ status, result: status === "completed" ? results[index] : null })));
  return { database, db, r2, env, deal: made, fileIds, groupId };
}

const confirm = (ctx, body, options = {}) => work(ctx.env, `/ai/jobs/${options.groupId ?? ctx.groupId}/confirm`, { method: "POST", body, ...options });
const body = (ctx, apply = {}, keep = [], version = ctx.deal.version) => ({ dealVersion: version, apply, keep });

// ── 공용 비교 함수 ──

test("비교 함수: 같음·다름·한쪽만·둘 다 없음을 가리고, 중도금은 순서대로 짝지은 날짜 배열 한 칸이며, 한 작업만 결과가 있으면 모든 칸이 한쪽만이다", () => {
  const a = validateContractResult(contract({ middles: ["2026-11-20", "2026-12-01"], balance: "2026-12-30" })).result;
  const b = validateContractResult(contract({ middles: ["2026-11-20"], price: 360_000_000, balance: "2026-12-30" })).result;
  const compared = compareContractResults(a, b, "sale");
  assert.deepEqual(compared.fields.map((item) => [item.field, item.status]), [
    ["contractDate", "same"], ["middlePayments", "different"], ["balanceDate", "same"], ["priceWon", "different"],
  ]);
  assert.deepEqual(compared.fields[1].first, ["2026-11-20", "2026-12-01"]);
  assert.equal(compareContractResults(b, a, "sale").fields[1].status, "different", "중도금 [1차] 대 [1차, 2차]도 다름(짧은 쪽이 먼저여도)");
  assert.ok(compared.reference.some((item) => item.field === "depositWon" && item.status === "both_empty"), "매매에 맞지 않는 금액은 보기만(참고)");
  assert.ok(compared.reference.some((item) => item.field === "balanceWon"), "잔금 금액은 보기만");
  assert.deepEqual(missingDecisions(compared, {}, []), ["middlePayments", "priceWon"]);
  assert.deepEqual(missingDecisions(compared, { priceWon: 1 }, ["middlePayments"]), []);

  const oneSide = compareContractResults(validateContractResult(contract({ price: null })).result, validateContractResult(contract()).result, "sale");
  assert.equal(oneSide.fields.find((item) => item.field === "priceWon").status, "one_side");
  const single = compareContractResults(a, null, "jeonse");
  assert.deepEqual(single.fields.map((item) => [item.field, item.status]), [["contractDate", "one_side"], ["middlePayments", "one_side"], ["balanceDate", "one_side"], ["depositWon", "one_side"]]);
  assert.equal(compareContractResults(contract({ middles: [] }), contract({ middles: [] }), "sale").fields[1].status, "both_empty");
  assert.deepEqual(confirmFieldsFor("monthly_rent"), ["contractDate", "middlePayments", "balanceDate", "depositWon", "monthlyRentWon"]);
  assert.equal(contractValues(null), null);
});

test("비교 함수의 거래 종류별 금액 칸은 거래 입력 규칙(work-input.mjs)과 같다(원본 대조)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(CONFIRM_AMOUNT_FIELDS_BY_TYPE)), JSON.parse(JSON.stringify(AMOUNT_FIELDS_BY_TYPE)));
});

// ── C-01 · C-02 경로·보호·꺼짐 ──

test("C-01 경로·보호: 다른 방식 405, UUID 아님·없는 묶음·계약서가 아닌 묶음 404, CSRF 없음·다른 출처 403이고 어느 경우도 거래·일정·묶음이 그대로다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const before = snapshot(ctx.database);
  const get = await work(ctx.env, `/ai/jobs/${ctx.groupId}/confirm`);
  assert.deepEqual([get.status, get.response.headers.get("Allow")], [405, "POST"]);
  assert.equal((await confirm(ctx, body(ctx), { groupId: "not-a-uuid" })).status, 404);
  assert.equal((await confirm(ctx, body(ctx), { groupId: nextUuid() })).status, 404);
  const otherKind = seedGroup(ctx.database, ctx.fileIds, [{ result: contract() }, { result: contract() }], { kind: "photo_text" });
  assert.equal((await confirm(ctx, body(ctx), { groupId: otherKind })).status, 404);
  const send = async (headers) => {
    const request = new Request(`${ORIGIN}/api/admin/v1/work/ai/jobs/${ctx.groupId}/confirm`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await signToken(), "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body(ctx)),
    });
    const response = await handleAdminApi(request, ctx.env, { authenticate, work: { now: () => NOW, auditLog: () => {}, randomUUID: nextUuid } });
    return { status: response.status, json: await response.json() };
  };
  const noCsrf = await send({ Origin: ORIGIN });
  assert.deepEqual([noCsrf.status, noCsrf.json.error.code], [403, "CSRF_INVALID"]);
  const otherOrigin = await send({ Origin: "https://example.com" });
  assert.deepEqual([otherOrigin.status, otherOrigin.json.error.code], [403, "ORIGIN_DENIED"]);
  ctx.database.prepare("DELETE FROM ai_jobs WHERE kind = 'photo_text'").run();
  assert.equal(snapshot(ctx.database), before);
  assert.deepEqual(ctx.r2.calls, []);
});

test("C-02 꺼짐: WORK_AI_ENABLED가 없으면 확정·미리 보기 모두 지금처럼 503 AI_DISABLED, 업무 도구가 꺼지면 기존 꺼짐 응답이고 D1 쓰기가 없다", async (t) => {
  installNetworkTrap(t);
  for (const [label, extra, code] of [["AI 꺼짐", { WORK_AI_ENABLED: undefined }, "AI_DISABLED"], ["업무 도구 꺼짐", { WORK_TOOLS_ENABLED: undefined }, null]]) {
    const ctx = await setup();
    const env = { ...ctx.env, ...extra };
    const before = snapshot(ctx.database);
    const auditsBefore = count(ctx.database, "audit_events");
    for (const result of [await work(env, `/ai/jobs/${ctx.groupId}/confirm`, { method: "POST", body: body(ctx) }), await work(env, "/ai/estimate?pages=2")]) {
      if (code) assert.deepEqual([result.status, result.json.error.code], [503, code], label);
      else assert.ok(result.status >= 400 && result.status !== 200, label);
    }
    assert.equal(snapshot(ctx.database), before, label);
    if (code) assert.equal(count(ctx.database, "audit_events"), auditsBefore, `${label}: 거부 기록도 D1에 남기지 않음(다른 AI 경로와 같음)`);
  }
});

// ── C-03 · C-04 · C-07 · C-08 본문과 사람 확인 ──

test("C-03·C-07·C-08 본문 꼴: 모르는 칸·쓰지 않는 칸·형식이 틀린 값·같은 칸 두 곳·거래 종류에 안 맞는 금액은 400 VALIDATION_FAILED(details에 칸 이름)이고 쓰기 0이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const before = snapshot(ctx.database);
  const cases = [
    [{ ...body(ctx), extra: 1 }, ["body"]],
    [{ apply: {}, keep: [] }, ["dealVersion"]],
    [{ ...body(ctx), dealVersion: 1.5 }, ["dealVersion"]],
    [{ ...body(ctx), dealVersion: "1" }, ["dealVersion"]],
    [{ ...body(ctx), apply: [] }, ["apply"]],
    [{ ...body(ctx), keep: "balanceDate" }, ["keep"]],
    [body(ctx, { unknownField: 1 }), ["unknownField"]],
    [body(ctx, { "잔금일": "2026-12-30" }), ["apply"]],
    [body(ctx, { balanceDate: "2026-12-30" }, ["balanceDate"]), ["balanceDate"]],
    [body(ctx, {}, ["balanceDate", "balanceDate"]), ["balanceDate"]],
    [body(ctx, {}, ["unknownKeep"]), ["unknownKeep"]],
    [body(ctx, { balanceDate: "2026-02-30" }), ["balanceDate"]],
    [body(ctx, { contractDate: "20261102" }), ["contractDate"]],
    [body(ctx, { priceWon: -1 }), ["priceWon"]],
    [body(ctx, { priceWon: 1.5 }), ["priceWon"]],
    [body(ctx, { priceWon: 1_000_000_000_000 }), ["priceWon"]],
    [body(ctx, { priceWon: "350000000" }), ["priceWon"]],
    [body(ctx, { middlePayments: "2026-11-20" }), ["middlePayments"]],
    [body(ctx, { middlePayments: [null] }), ["middlePayments"]],
    [body(ctx, { middlePayments: ["2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24"] }), ["middlePayments"]],
    // C-07: 계약금 날짜·금액, 중도금·잔금 금액, 물건 표시, 거래 종류는 거래에 쓰지 않는다.
    [body(ctx, { downPaymentDate: "2026-11-02" }), ["downPaymentDate"]],
    [body(ctx, { downPaymentWon: 35_000_000 }), ["downPaymentWon"]],
    [body(ctx, { middlePaymentWons: [1] }), ["middlePaymentWons"]],
    [body(ctx, { balanceWon: 315_000_000 }), ["balanceWon"]],
    [body(ctx, { propertyText: "가상" }), ["propertyText"]],
    [body(ctx, { dealType: "jeonse" }), ["dealType"]],
    // C-08: 매매 거래에 보증금·월세
    [body(ctx, { depositWon: 10_000_000 }), ["depositWon"]],
    [body(ctx, {}, ["monthlyRentWon"]), ["monthlyRentWon"]],
  ];
  for (const [payload, details] of cases) {
    const result = await confirm(ctx, payload);
    assert.equal(result.status, 400, JSON.stringify(payload));
    assert.equal(result.json.error.code, "VALIDATION_FAILED", JSON.stringify(payload));
    assert.deepEqual(result.json.error.details, details, JSON.stringify(payload));
  }
  assert.equal(snapshot(ctx.database), before);
});

test("C-04 사람 확인을 서버가 다시 본다: 다른 칸·한쪽만 칸이 apply·keep 어디에도 없으면 400(details에 그 칸)이고, 서버 판정이 공용 비교 함수와 같다", async (t) => {
  installNetworkTrap(t);
  const a = contract({ balance: "2026-12-30" });
  const b = contract({ balance: "2026-12-31" });
  const ctx = await setup({ results: [a, b] });
  const before = snapshot(ctx.database);
  const refused = await confirm(ctx, body(ctx));
  assert.deepEqual([refused.status, refused.json.error.details], [400, ["balanceDate"]]);
  const expected = missingDecisions(compareContractResults(validateContractResult(a).result, validateContractResult(b).result, "sale"), {}, []);
  assert.deepEqual(refused.json.error.details, expected, "화면과 같은 함수의 판정");
  assert.equal(snapshot(ctx.database), before);

  const half = await setup({ statuses: ["completed", "failed"] });
  const partial = await confirm(half, body(half, { contractDate: "2026-11-02", balanceDate: "2026-12-30" }, ["middlePayments"]));
  assert.deepEqual([partial.status, partial.json.error.details], [400, ["priceWon"]], "한쪽만 끝나면 칸마다 골라야 함");

  // 일정 계산에 꼭 필요하지 않은 '한쪽만' 칸(중도금)도 고르지 않으면 400이다(계산 오류가 대신 막아 주지 않는 경우).
  const oneSide = await setup({ results: [contract({ middles: ["2026-11-20"] }), contract({ middles: [] })] });
  const oneBefore = snapshot(oneSide.database);
  const unchosen = await confirm(oneSide, body(oneSide, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.deepEqual([unchosen.status, unchosen.json.error.code, unchosen.json.error.details], [400, "VALIDATION_FAILED", ["middlePayments"]], "한쪽만 칸을 사람이 고르지 않음");
  assert.equal(snapshot(oneSide.database), oneBefore);
  const halfMiddle = await setup({ statuses: ["completed", "failed"] });
  const halfRefused = await confirm(halfMiddle, body(halfMiddle, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.deepEqual([halfRefused.status, halfRefused.json.error.details], [400, ["middlePayments"]], "한 작업이 실패하면 빈 중도금 칸도 한쪽만이라 골라야 함");
  assert.equal((await confirm(oneSide, body(oneSide, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }, ["middlePayments"]))).status, 200, "keep으로 고르면 받음");
});

// ── C-05 · C-06 · C-09 쓰는 것 ──

test("C-05·C-06 고른 칸만 덮어쓴다: 잔금일만 apply(두 결과와 다른 직접 입력), 거래금액은 keep이면 잔금일만 바뀌고 나머지·참여자는 그대로, 거래 version +1", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup({
    deal: { priceWon: 300_000_000, contractOn: "2026-11-01" },
    results: [contract({ price: 350_000_000, balance: "2026-12-30", contractDate: "2026-11-01" }), contract({ price: 360_000_000, balance: "2026-12-31", contractDate: "2026-11-01" })],
  });
  const before = dealRow(ctx.database, ctx.deal.id);
  const result = await confirm(ctx, body(ctx, { balanceDate: "2027-01-15" }, ["priceWon"]));
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const after = dealRow(ctx.database, ctx.deal.id);
  assert.equal(after.balance_on, "2027-01-15", "두 결과 어느 쪽과도 다른 값도 받음(직접 입력)");
  assert.equal(after.version, before.version + 1);
  for (const column of ["title", "deal_type", "sale_kind", "property_kind", "property_label", "price_won", "deposit_won", "monthly_rent_won", "contract_on", "middle_payment_on", "status", "regulation"]) {
    assert.deepEqual(after[column], before[column], column);
  }
  assert.equal(result.json.data.deal.balanceOn, "2027-01-15");
  assert.equal(result.json.data.deal.version, after.version);
  const planned = result.json.data.events.filter((event) => event.source === "calculated").length;
  assert.deepEqual(audits(ctx.database, "ai.confirm").map((row) => row.reason), [`kind=contract_schedule;fields=1;events=${planned}`], "fields는 apply 칸 수만(keep은 세지 않음)");
});

test("C-06b 비움: apply에 null을 넣으면(잔금일·월세) 그 거래 칸이 비고 200이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup({
    deal: { contractOn: "2026-11-01", balanceOn: "2026-12-20", priceWon: 300_000_000 },
    results: [contract({ contractDate: "2026-11-01", balance: "2026-12-30" }), contract({ contractDate: "2026-11-01", balance: "2026-12-31" })],
  });
  const result = await confirm(ctx, body(ctx, { balanceDate: null }));
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(dealRow(ctx.database, ctx.deal.id).balance_on, null);
  assert.equal(result.json.data.deal.balanceOn, null);
  assert.equal(result.json.data.events.some((event) => event.kind === "balance"), false, "잔금 일정도 계산에서 빠짐");

  const rent = await setup({
    deal: { dealType: "monthly_rent", propertyKind: "other", contractOn: "2026-11-01", depositWon: 10_000_000, monthlyRentWon: 500_000 },
    results: [contract({ dealType: "monthly_rent", price: null, deposit: 10_000_000, rent: 500_000, contractDate: "2026-11-01" }), contract({ dealType: "monthly_rent", price: null, deposit: 10_000_000, rent: 600_000, contractDate: "2026-11-01" })],
  });
  const cleared = await confirm(rent, body(rent, { monthlyRentWon: null }));
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.deepEqual([dealRow(rent.database, rent.deal.id).monthly_rent_won, dealRow(rent.database, rent.deal.id).deposit_won], [null, 10_000_000], "고른 금액 칸만 비고 보증금은 그대로");
});

test("C-09 중도금: 3개를 넣으면 첫째는 거래 칸, 둘째·셋째는 금액 없는 직접 일정(custom·ai_confirmed)이고, 순서가 틀리거나 잔금보다 늦으면 400이다", async (t) => {
  installNetworkTrap(t);
  const middles = ["2026-11-20", "2026-12-01", "2026-12-10"];
  const ctx = await setup({ results: [contract({ middles }), contract({ middles })] });
  const result = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", middlePayments: middles, balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.equal(dealRow(ctx.database, ctx.deal.id).middle_payment_on, "2026-11-20");
  const custom = eventRows(ctx.database, ctx.deal.id).filter((event) => event.kind === "custom");
  assert.deepEqual(custom.map((event) => [event.due_on, event.title, event.source, event.done_at, event.version]), [
    ["2026-12-01", "2차 중도금(가상단지)", "ai_confirmed", null, 1],
    ["2026-12-10", "3차 중도금(가상단지)", "ai_confirmed", null, 1],
  ]);
  assert.ok(custom.every((event) => JSON.parse(event.alarm_offsets).length === 1), "알림은 자동 일정과 같은 기본값");
  const text = JSON.stringify(eventRows(ctx.database, ctx.deal.id));
  for (const amount of ["10000000", "20000000", "30000000", "123456789", "1,000만", "천만"]) assert.equal(text.includes(amount), false, `일정에 금액 없음: ${amount}`);
  assert.equal(result.json.data.events.filter((event) => event.kind === "custom").length, 2);

  for (const [label, wrong] of [
    ["앞 차보다 빠름", ["2026-11-20", "2026-11-19"]],
    ["계약일보다 빠름", ["2026-11-01"]],
    ["잔금보다 늦음", ["2026-11-20", "2027-01-05"]],
  ]) {
    const bad = await setup({ results: [contract({ middles: wrong }), contract({ middles: wrong })] });
    const before = snapshot(bad.database);
    const refused = await confirm(bad, body(bad, { contractDate: "2026-11-02", middlePayments: wrong, balanceDate: "2026-12-30", priceWon: 350_000_000 }));
    assert.deepEqual([refused.status, refused.json.error.code], [400, "VALIDATION_FAILED"], label);
    assert.ok(refused.json.error.details.includes("middlePayments"), `${label}: ${refused.json.error.details}`);
    assert.equal(snapshot(bad.database), before, label);
  }
});

// ── C-10 · C-11 · C-12 일정 ──

test("C-10 일정은 '다시 계산'과 같다: 확정 뒤 일정·kept·notices가 같은 거래의 events/calculate와 같고 모두 calculated이며, 사람이 고친 일정은 남는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup({ deal: { priceWon: 700_000_000, contractOn: "2026-10-01" } });
  // 확정 전에 계산해 두고 거래신고 날짜를 사람이 고친다(manual).
  const first = await work(ctx.env, `/deals/${ctx.deal.id}/events/calculate`, { method: "POST", body: { replaceCalculated: true } });
  const report = first.json.data.events.find((event) => event.kind === "transaction_report");
  assert.equal((await work(ctx.env, `/events/${report.id}`, { method: "PATCH", body: { version: 1, dueOn: "2026-11-25" } })).status, 200);
  const dealNow = (await work(ctx.env, `/deals/${ctx.deal.id}`)).json.data.deal;
  const confirmed = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 700_000_000 }, [], dealNow.version));
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
  const data = confirmed.json.data;
  assert.ok(data.events.filter((event) => event.kind !== "transaction_report").every((event) => event.source === "calculated"), "AI 확정이 만든 일정은 모두 calculated(G1 ①)");
  assert.deepEqual(data.kept.map((item) => [item.kind, item.keptOn, item.reason]), [["transaction_report", "2026-11-25", "manual"]]);
  const again = await work(ctx.env, `/deals/${ctx.deal.id}/events/calculate`, { method: "POST", body: { replaceCalculated: true } });
  const shape = (events) => events.map((event) => [event.id, event.kind, event.dueOn, event.title, event.source]);
  assert.deepEqual(shape(again.json.data.events), shape(data.events), "다시 계산해도 바뀌는 일정 없음");
  assert.deepEqual(again.json.data.kept, data.kept);
  assert.deepEqual(again.json.data.notices, data.notices);
});

test("C-11 되돌이 막기: 확정한 뒤 거래금액을 고쳐 다시 계산하면 법정 기한이 새 값으로 바뀐다(확정이 기한을 묶어 두지 않음)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const done = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(done.json.data.events.some((event) => event.kind === "funding_plan_to_agent"), false, "3억 5천: 자금조달 없음");
  const patched = await work(ctx.env, `/deals/${ctx.deal.id}`, { method: "PATCH", body: { version: done.json.data.deal.version, priceWon: 700_000_000, contractOn: "2026-11-05" } });
  assert.equal(patched.status, 200);
  const recalculated = (await work(ctx.env, `/deals/${ctx.deal.id}/events/calculate`, { method: "POST", body: { replaceCalculated: true } })).json.data;
  assert.ok(recalculated.events.some((event) => event.kind === "funding_plan_to_agent"), "7억: 자금조달 일정이 새로 생김");
  const before = done.json.data.events.find((event) => event.kind === "transaction_report").dueOn;
  const after = recalculated.events.find((event) => event.kind === "transaction_report").dueOn;
  assert.notEqual(after, before, "계약일을 고치면 거래신고 기한도 바뀜");
  assert.deepEqual(recalculated.kept, []);
});

test("C-12 계산에 필요한 칸이 비면 400이고 거래도 고치지 않는다(한 batch): 신고 대상 매매인데 거래금액 없음", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup({ results: [contract({ price: null }), contract({ price: null })] });
  const before = snapshot(ctx.database);
  const refused = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30" }));
  assert.deepEqual([refused.status, refused.json.error.code, refused.json.error.details], [400, "VALIDATION_FAILED", ["priceWon"]]);
  const noContract = await confirm(ctx, body(ctx, { contractDate: null, balanceDate: "2026-12-30", priceWon: 1 }));
  assert.deepEqual([noContract.status, noContract.json.error.details], [400, ["contractDate"]], "계약일을 비우면 계산할 수 없음");
  assert.equal(snapshot(ctx.database), before);
  assert.ok(jobRows(ctx.database, ctx.groupId).every((row) => row.confirmed_at === null));
});

// ── C-13 ~ C-16 동시 수정 ──

test("C-13 거래 version: 본문 version이 다르거나, 읽은 뒤 batch 전에 다른 화면이 거래를 고치면 409 VERSION_CONFLICT이고 모두 그대로다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const apply = { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 };
  const before = snapshot(ctx.database);
  const stale = await confirm(ctx, body(ctx, apply, [], ctx.deal.version + 1));
  assert.deepEqual([stale.status, stale.json.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal(snapshot(ctx.database), before);

  ctx.db.beforeNextBatch = () => ctx.database.prepare("UPDATE deals SET title = '가상 다른 화면', version = version + 1 WHERE id = ?").run(ctx.deal.id);
  const raced = await confirm(ctx, body(ctx, apply));
  assert.deepEqual([raced.status, raced.json.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal(dealRow(ctx.database, ctx.deal.id).contract_on, null, "거래 칸 그대로");
  assert.equal(count(ctx.database, "deal_events"), 0);
  assert.ok(jobRows(ctx.database, ctx.groupId).every((row) => row.confirmed_at === null));
  assert.equal(audits(ctx.database, "ai.confirm").length, 0);
});

test("C-14 묶음 상태: running·둘 다 실패·취소·이미 확정이면 409 AI_JOB_STATE_CONFLICT이고 쓰기 0이다", async (t) => {
  installNetworkTrap(t);
  for (const [label, statuses, confirmedAt] of [
    ["running", ["in_progress", "completed"], null],
    ["failed", ["failed", "failed"], null],
    ["cancelled", ["cancelled", "cancelled"], null],
    ["confirmed", ["completed", "completed"], AT],
  ]) {
    const ctx = await setup({ statuses });
    if (confirmedAt) ctx.database.prepare("UPDATE ai_jobs SET confirmed_at = ?").run(confirmedAt);
    const before = snapshot(ctx.database);
    const result = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000, middlePayments: [] }));
    assert.deepEqual([result.status, result.json.error.code], [409, "AI_JOB_STATE_CONFLICT"], label);
    assert.equal(snapshot(ctx.database), before, label);
  }
});

test("C-15 취소와 겹침: 확정이 묶음을 읽은 뒤 batch 전에 취소가 끝나면 guard가 막아 409 AI_JOB_STATE_CONFLICT이고 거래·일정 그대로다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  let cancelled;
  ctx.db.beforeNextBatch = async () => {
    cancelled = await work(ctx.env, `/ai/jobs/${ctx.groupId}/cancel`, { method: "POST", body: {} });
  };
  const result = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.equal(cancelled.status, 200);
  assert.deepEqual([result.status, result.json.error.code], [409, "AI_JOB_STATE_CONFLICT"]);
  assert.equal(dealRow(ctx.database, ctx.deal.id).version, ctx.deal.version);
  assert.equal(count(ctx.database, "deal_events"), 0);
  assert.ok(jobRows(ctx.database, ctx.groupId).every((row) => row.status === "cancelled" && row.confirmed_at === null));

  // 한 행만 cancelled가 되고 다른 행은 결과가 남아 있어도 guard가 막는다(취소 상태를 따로 본다).
  const half = await setup();
  half.db.beforeNextBatch = () => half.database.prepare("UPDATE ai_jobs SET status = 'cancelled', result_json = NULL WHERE group_id = ? AND run_index = 2").run(half.groupId);
  const partial = await confirm(half, body(half, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.deepEqual([partial.status, partial.json.error.code], [409, "AI_JOB_STATE_CONFLICT"]);
  assert.equal(count(half.database, "deal_events"), 0);
});

test("C-16 다시 확정: 같은 묶음에 두 번이면 두 번째 409, 동시에 두 번이면 정확히 하나만 200이다", async (t) => {
  installNetworkTrap(t);
  const apply = { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 };
  const ctx = await setup();
  assert.equal((await confirm(ctx, body(ctx, apply))).status, 200);
  const second = await confirm(ctx, body(ctx, apply, [], ctx.deal.version + 1));
  assert.deepEqual([second.status, second.json.error.code], [409, "AI_JOB_STATE_CONFLICT"]);

  const race = await setup();
  let inner;
  race.db.beforeNextBatch = async () => {
    inner = await confirm(race, body(race, apply));
  };
  const outer = await confirm(race, body(race, apply));
  assert.deepEqual([inner.status, outer.status], [200, 409]);
  assert.equal(outer.json.error.code, "AI_JOB_STATE_CONFLICT", "묶음 상태를 거래 version보다 먼저 알림");
  assert.equal(audits(race.database, "ai.confirm").length, 1);
  assert.equal(dealRow(race.database, race.deal.id).version, race.deal.version + 1);
});

// ── C-17 · G21 새 묶음으로 다시 확정 ──

test("C-17·G21 새 묶음으로 다시 확정: 앞 확정의 끝나지 않은 AI 중도금 일정만 바뀌고, 사람이 넣은 일정·완료한 일정·날짜를 고친 일정은 남으며, 알림만 바꾼 일정은 바뀐다", async (t) => {
  installNetworkTrap(t);
  const firstMiddles = ["2026-11-20", "2026-12-01", "2026-12-10", "2026-12-20"];
  const ctx = await setup({ results: [contract({ middles: firstMiddles }), contract({ middles: firstMiddles })] });
  const first = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", middlePayments: firstMiddles, balanceDate: "2026-12-30", priceWon: 350_000_000 }));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const ai = first.json.data.events.filter((event) => event.kind === "custom");
  assert.equal(ai.length, 3);
  const [second, third, fourth] = ai;
  // 2차: 날짜를 사람이 고침 → manual(G21 ⓐ) / 3차: 완료 / 4차: 알림만 바꿈 → ai_confirmed 그대로
  const edited = await work(ctx.env, `/events/${second.id}`, { method: "PATCH", body: { version: 1, dueOn: "2026-12-02" } });
  assert.equal(edited.json.data.event.source, "manual", "AI 일정도 날짜를 고치면 manual");
  assert.equal((await work(ctx.env, `/events/${third.id}`, { method: "PATCH", body: { version: 1, done: true } })).status, 200);
  const alarmOnly = await work(ctx.env, `/events/${fourth.id}`, { method: "PATCH", body: { version: 1, alarmOffsets: ["PT9H"] } });
  assert.equal(alarmOnly.json.data.event.source, "ai_confirmed", "알림만 바꾸면 출처 그대로");
  const manual = await work(ctx.env, `/deals/${ctx.deal.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-12-05", title: "가상 집 보기", alarmOffsets: ["-PT6H"] } });
  assert.equal(manual.status, 201, JSON.stringify(manual.json));

  const newMiddles = ["2026-11-21", "2026-12-15"];
  const nextGroup = seedGroup(ctx.database, ctx.fileIds, [{ result: contract({ middles: newMiddles }) }, { result: contract({ middles: newMiddles }) }]);
  const dealVersion = dealRow(ctx.database, ctx.deal.id).version;
  const again = await confirm(ctx, { dealVersion, apply: { contractDate: "2026-11-02", middlePayments: newMiddles, balanceDate: "2026-12-30", priceWon: 350_000_000 }, keep: [] }, { groupId: nextGroup });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const customs = eventRows(ctx.database, ctx.deal.id).filter((event) => event.kind === "custom").map((event) => [event.id === second.id || event.id === third.id || event.id === manual.json.data.event.id ? "old" : "new", event.due_on, event.source, event.done_at === null ? "open" : "done"]);
  assert.deepEqual(customs, [
    ["old", "2026-12-02", "manual", "open"],
    ["old", "2026-12-05", "manual", "open"],
    ["old", "2026-12-10", "ai_confirmed", "done"],
    ["new", "2026-12-15", "ai_confirmed", "open"],
  ], "사람이 고친 2차·사람이 넣은 일정·완료한 3차는 남고, 알림만 바꾼 4차는 새 2차로 바뀜");
  assert.equal(eventRows(ctx.database, ctx.deal.id).some((event) => event.id === fourth.id), false);
  assert.equal(dealRow(ctx.database, ctx.deal.id).middle_payment_on, "2026-11-21");

  // keep이면 AI 중도금 일정은 건드리지 않는다.
  const third2 = seedGroup(ctx.database, ctx.fileIds, [{ result: contract({ middles: ["2026-11-22"] }) }, { result: contract({ middles: ["2026-11-23"] }) }]);
  const beforeKeep = eventRows(ctx.database, ctx.deal.id).filter((event) => event.kind === "custom");
  const kept = await confirm(ctx, { dealVersion: dealRow(ctx.database, ctx.deal.id).version, apply: {}, keep: ["middlePayments"] }, { groupId: third2 });
  assert.equal(kept.status, 200, JSON.stringify(kept.json));
  assert.deepEqual(eventRows(ctx.database, ctx.deal.id).filter((event) => event.kind === "custom"), beforeKeep);
  assert.equal(dealRow(ctx.database, ctx.deal.id).middle_payment_on, "2026-11-21");
});

test("C-17c 완료한 n차 중도금: 2차를 완료로 표시한 뒤 새 묶음으로 다시 확정하면 2차는 새로 넣지 않고(완료 기록 1개만) notices로 알리며, 사람이 고쳐 manual이 된 완료 일정도 같다", async (t) => {
  installNetworkTrap(t);
  const middles = ["2026-11-20", "2026-12-01", "2026-12-10"];
  const ctx = await setup({ results: [contract({ middles }), contract({ middles })] });
  const apply = (dates) => ({ contractDate: "2026-11-02", middlePayments: dates, balanceDate: "2026-12-30", priceWon: 350_000_000 });
  const first = await confirm(ctx, body(ctx, apply(middles)));
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const [second, third] = first.json.data.events.filter((event) => event.kind === "custom");
  assert.equal((await work(ctx.env, `/events/${second.id}`, { method: "PATCH", body: { version: 1, done: true } })).status, 200);
  // 3차: 사람이 제목을 고친 뒤(manual) 완료
  const renamed = await work(ctx.env, `/events/${third.id}`, { method: "PATCH", body: { version: 1, title: "3차 중도금(가상 고친 제목)" } });
  assert.equal(renamed.json.data.event.source, "manual");
  assert.equal((await work(ctx.env, `/events/${third.id}`, { method: "PATCH", body: { version: 2, done: true } })).status, 200);

  const newMiddles = ["2026-11-21", "2026-12-05", "2026-12-15", "2026-12-20"];
  const nextGroup = seedGroup(ctx.database, ctx.fileIds, [{ result: contract({ middles: newMiddles }) }, { result: contract({ middles: newMiddles }) }]);
  const again = await confirm(ctx, { dealVersion: dealRow(ctx.database, ctx.deal.id).version, apply: apply(newMiddles), keep: [] }, { groupId: nextGroup });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const customs = eventRows(ctx.database, ctx.deal.id).filter((event) => event.kind === "custom").map((event) => [event.title, event.due_on, event.done_at === null ? "open" : "done"]);
  assert.deepEqual(customs, [
    ["2차 중도금(가상단지)", "2026-12-01", "done"],
    ["3차 중도금(가상 고친 제목)", "2026-12-10", "done"],
    ["4차 중도금(가상단지)", "2026-12-20", "open"],
  ], "2차·3차는 완료 기록 하나씩만, 4차만 새로");
  assert.ok(again.json.data.notices.includes("2차 중도금은 이미 완료 표시돼 새로 넣지 않았습니다."), JSON.stringify(again.json.data.notices));
  assert.ok(again.json.data.notices.includes("3차 중도금은 이미 완료 표시돼 새로 넣지 않았습니다."));
  const planned = again.json.data.events.filter((event) => event.source === "calculated").length;
  assert.equal(audits(ctx.database, "ai.confirm")[1].reason, `kind=contract_schedule;fields=4;events=${planned + 1}`, "감사 일정 수도 실제로 넣은 것만");
});

// ── C-18 · C-19 휴지통·끝난 거래 ──

test("C-18 사본 휴지통: 묶음의 계약서 사본 하나를 지우면 확정이 404(쓰기 0)이고, 되살린 뒤에는 200이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const deleted = await work(ctx.env, `/files/${ctx.fileIds[1]}`, { method: "DELETE", body: {} });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  const apply = { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 };
  const before = snapshot(ctx.database);
  const batches = ctx.db.stats.batches.length;
  const refused = await confirm(ctx, body(ctx, apply));
  assert.equal(ctx.db.stats.batches.length, batches, "미리 확인에서 막아 batch를 보내지 않음");
  assert.deepEqual([refused.status, refused.json.error.code], [404, "NOT_FOUND"]);
  assert.equal(snapshot(ctx.database), before);
  const trash = (await work(ctx.env, "/trash")).json.data.items;
  const restored = await work(ctx.env, `/trash/${trash[0].id ?? trash[0].batchId}/restore`, { method: "POST", body: {} });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.equal((await confirm(ctx, body(ctx, apply))).status, 200);
  assert.deepEqual(ctx.r2.calls.filter(([action]) => action === "get"), [], "확정은 R2를 읽지 않음");
});

test("C-19 끝난·취소 거래는 409 DEAL_CLOSED(화면 문장 그대로)이고, 읽은 뒤 batch 전에 닫혀도 guard가 막는다", async (t) => {
  installNetworkTrap(t);
  const apply = { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 };
  for (const status of ["completed", "cancelled"]) {
    const ctx = await setup();
    const closed = await work(ctx.env, `/deals/${ctx.deal.id}`, { method: "PATCH", body: { version: ctx.deal.version, status } });
    assert.equal(closed.status, 200);
    const before = snapshot(ctx.database);
    const batches = ctx.db.stats.batches.length;
    const result = await confirm(ctx, body(ctx, apply, [], closed.json.data.deal.version));
    assert.equal(ctx.db.stats.batches.length, batches, `${status}: 미리 확인에서 막아 batch를 보내지 않음`);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.message], [409, "DEAL_CLOSED", "끝난 거래와 취소한 거래에는 AI 결과를 넣을 수 없습니다."], status);
    assert.equal(snapshot(ctx.database), before, status);
  }
  const race = await setup();
  race.db.beforeNextBatch = () => race.database.prepare("UPDATE deals SET status = 'completed' WHERE id = ?").run(race.deal.id);
  const raced = await confirm(race, body(race, apply));
  assert.deepEqual([raced.status, raced.json.error.code], [409, "DEAL_CLOSED"], "version이 그대로여도 상태 guard가 막음");
  assert.equal(count(race.database, "deal_events"), 0);
});

// ── C-20 ~ C-24 표시·감사·외부·응답 ──

test("C-20·C-21 묶음 표시: 결과가 있던 행만 confirmed_at이 채워지고(실패 행은 빈 채), 묶음은 confirmed·그 뒤 취소는 409·거래별 목록에 confirmedAt이 보인다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup({ statuses: ["completed", "failed"] });
  const result = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }, ["middlePayments"]));
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.deepEqual(jobRows(ctx.database, ctx.groupId).map((row) => [row.status, row.confirmed_at]), [["completed", AT], ["failed", null]]);
  const view = await work(ctx.env, `/ai/jobs/${ctx.groupId}`);
  assert.deepEqual([view.json.data.group.status, view.json.data.group.confirmedAt], ["confirmed", AT]);
  const cancel = await work(ctx.env, `/ai/jobs/${ctx.groupId}/cancel`, { method: "POST", body: {} });
  assert.deepEqual([cancel.status, cancel.json.error.code], [409, "AI_JOB_STATE_CONFLICT"]);
  const list = await work(ctx.env, `/ai/jobs?dealId=${ctx.deal.id}`);
  assert.deepEqual(list.json.data.items.map((item) => [item.groupId, item.status, item.confirmedAt]), [[ctx.groupId, "confirmed", AT]]);
});

test("C-22 감사: 같은 batch에 ai.confirm 한 줄(대상 묶음, 칸 수·일정 수만)이고, 그 문장이 실패하면 거래·일정·묶음이 모두 되돌아간다", async (t) => {
  installNetworkTrap(t);
  const middles = ["2026-11-20", "2026-12-01"];
  const ctx = await setup({ results: [contract({ middles }), contract({ middles })] });
  ctx.database.exec("CREATE TRIGGER zz_block_confirm BEFORE INSERT ON audit_events WHEN NEW.action = 'ai.confirm' BEGIN SELECT RAISE(ABORT, 'ZZAUDIT 막힘'); END");
  const before = snapshot(ctx.database);
  const apply = { contractDate: "2026-11-02", middlePayments: middles, balanceDate: "2026-12-30", priceWon: 350_000_000 };
  const blocked = await confirm(ctx, body(ctx, apply));
  assert.equal(blocked.status, 503);
  assert.equal(snapshot(ctx.database), before, "감사를 못 남기면 아무것도 바뀌지 않음");
  ctx.database.exec("DROP TRIGGER zz_block_confirm");

  const ok = await confirm(ctx, body(ctx, apply));
  assert.equal(ok.status, 200);
  const planned = ok.json.data.events.filter((event) => event.source === "calculated").length;
  assert.deepEqual(audits(ctx.database, "ai.confirm"), [{ action: "ai.confirm", target_type: "ai_job_group", target_id: ctx.groupId, outcome: "ok", reason: `kind=contract_schedule;fields=4;events=${planned + 1}` }]);
  const auditText = JSON.stringify(rows(ctx.database, "SELECT * FROM audit_events"));
  for (const leaked of ["2026-11-20", "2026-12-30", "350000000", MARK.title, MARK.quote, MARK.property, "가상단지"]) assert.equal(auditText.includes(leaked), false, leaked);
  assert.equal(audits(ctx.database, "event.calculate").length + audits(ctx.database, "deal.update").length, 0, "감사는 ai.confirm 한 줄만");
});

test("C-23·C-24 외부·응답: OpenAI 0번·R2 0번·사용량·result_json 그대로, 응답은 { deal, events, notices, kept }이고 결과·ai.view가 없으며 로그에 칸 값이 없다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setup();
  const usageBefore = usageRows(ctx.database);
  const resultBefore = jobRows(ctx.database, ctx.groupId).map((row) => row.result_json);
  const logs = [];
  const refused = await confirm(ctx, body(ctx), { auditLog: (entry) => logs.push(entry) });
  assert.equal(refused.status, 400);
  const result = await confirm(ctx, body(ctx, { contractDate: "2026-11-02", balanceDate: "2026-12-30", priceWon: 350_000_000 }), { auditLog: (entry) => logs.push(entry) });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.json.data), ["deal", "events", "notices", "kept"]);
  const text = JSON.stringify(result.json);
  for (const leaked of [MARK.quote, MARK.property, "result", "evidence", "123456789"]) assert.equal(text.includes(leaked), false, leaked);
  assert.equal(audits(ctx.database, "ai.view").length, 0);
  assert.deepEqual(ctx.r2.calls, []);
  assert.deepEqual(usageRows(ctx.database), usageBefore);
  assert.deepEqual(jobRows(ctx.database, ctx.groupId).map((row) => row.result_json), resultBefore);
  const logText = JSON.stringify(logs);
  for (const leaked of ["2026-11-02", "2026-12-30", "350000000", MARK.title]) assert.equal(logText.includes(leaked), false, leaked);
});

test("만들기 → 조회(ready) → 확정이 이어진다(가짜 OpenAI 두 번 읽기, 확정 자체는 OpenAI를 부르지 않음)", async (t) => {
  installNetworkTrap(t);
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2);
  setLimits(database);
  const deal = await makeDeal(env);
  const fileIds = [await seedCopy(database, r2, { dealId: deal.id })];
  const ai = scriptedOpenAi([
    { kind: "create", respond: created("resp_a1", "in_progress") },
    { kind: "create", respond: created("resp_b1", "in_progress") },
    { kind: "retrieve", respond: completed("resp_a1", contract({ balance: "2026-12-30" })) },
    { kind: "retrieve", respond: completed("resp_b1", contract({ balance: "2026-12-31" })) },
  ]);
  const made = await work(env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds, dealId: deal.id }, openaiFetch: ai.fetcher });
  assert.equal(made.status, 201);
  const ready = await work(env, `/ai/jobs/${made.json.data.groupId}`, { openaiFetch: ai.fetcher });
  assert.equal(ready.json.data.group.status, "ready");
  const [first, second] = ready.json.data.jobs.map((job) => job.result);
  const compared = compareContractResults(first, second, "sale");
  assert.deepEqual(missingDecisions(compared, {}, []), ["balanceDate"], "화면이 조회 결과로 같은 판정을 냄");
  const done = await work(env, `/ai/jobs/${made.json.data.groupId}/confirm`, { method: "POST", body: { dealVersion: deal.version, apply: { contractDate: "2026-11-02", balanceDate: "2026-12-31", priceWon: 350_000_000 }, keep: [] } });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.equal(ai.remaining(), 0);
  assert.deepEqual(ai.violations, []);
});

// ── 예상 비용 미리 보기 ──

test("미리 보기: 장수별 예상 비용이 만들기가 미리 더하는 값과 같고(실제로 만든 뒤 사용량 대조), 남은 한도를 주며 쓰기·감사·R2·OpenAI가 0번이다", async (t) => {
  installNetworkTrap(t);
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2);
  setLimits(database, { daily: 10, monthly: 50_000_000 });
  const expected = (pages) => [1, 2].reduce((sum, runIndex, index) => sum + estimateCostMicroUsd(AI_PRICES[[MODEL_A, MODEL_B][index]], estimateContractInputTokens(runIndex, pages, "high"), AI_MAX_OUTPUT), 0);
  for (const pages of [1, 2, 5]) {
    const result = await work(env, `/ai/estimate?pages=${pages}`);
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.deepEqual(result.json.data, {
      pages, requests: 2, estimatedCostMicroUsd: expected(pages), dailyCreateLimit: 10, todayCreates: 0, remainingCreates: 10,
      monthlyCostLimitMicroUsd: 50_000_000, monthCostMicroUsd: 0, remainingCostMicroUsd: 50_000_000, allowed: true, blockedBy: null,
    });
    assert.equal(/token|price|input|output/iu.test(JSON.stringify(result.json.data)), false, "단가·토큰 수를 싣지 않음");
  }
  assert.equal(count(database, "audit_events") + count(database, "ai_usage_daily") + count(database, "ai_jobs"), 0, "쓰기·감사 0");
  assert.deepEqual(r2.calls, []);

  // 원본 대조: 실제로 2장을 만들면 사용량에 미리 보기 값이 그대로 더해진다.
  const deal = await makeDeal(env);
  const fileIds = [await seedCopy(database, r2, { dealId: deal.id }), await seedCopy(database, r2, { dealId: deal.id })];
  const preview = (await work(env, "/ai/estimate?pages=2")).json.data;
  const ai = scriptedOpenAi([{ kind: "create", respond: created("resp_a1", "in_progress") }, { kind: "create", respond: created("resp_b1", "in_progress") }]);
  assert.equal((await work(env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds, dealId: deal.id }, openaiFetch: ai.fetcher })).status, 201);
  assert.equal(usageRows(database)[0].estimated_cost_micro_usd, preview.estimatedCostMicroUsd);
  const after = (await work(env, "/ai/estimate?pages=2")).json.data;
  assert.deepEqual([after.todayCreates, after.remainingCreates, after.monthCostMicroUsd], [2, 8, preview.estimatedCostMicroUsd]);
});

test("미리 보기: 한도 없음·하루 한도·월 한도는 만들기와 같은 순서로 blockedBy에 알리고, 장수 꼴이 틀리면 400·POST는 405·AI가 꺼지면 503이다", async (t) => {
  installNetworkTrap(t);
  const { database, db } = freshDb();
  const env = aiEnv(db, createR2());
  const missing = (await work(env, "/ai/estimate?pages=1")).json.data;
  assert.deepEqual([missing.allowed, missing.blockedBy, missing.remainingCreates, missing.remainingCostMicroUsd], [false, "limits_missing", null, null]);
  setLimits(database, { daily: 3, monthly: 50_000_000 });
  database.prepare("INSERT INTO ai_usage_daily (day, create_requests, estimated_cost_micro_usd) VALUES ('2026-11-17', 2, 0)").run();
  assert.equal((await work(env, "/ai/estimate?pages=1")).json.data.blockedBy, "daily", "2 + 2 > 3");
  setLimits(database, { daily: 10, monthly: 100_000 });
  assert.equal((await work(env, "/ai/estimate?pages=1")).json.data.blockedBy, "monthly");
  // 경계: 남은 비용이 예상 비용과 같으면 만들기처럼 받는다(만들기는 합계 <= 한도면 통과).
  const cost = (await work(env, "/ai/estimate?pages=1")).json.data.estimatedCostMicroUsd;
  setLimits(database, { daily: 10, monthly: cost });
  const edge = (await work(env, "/ai/estimate?pages=1")).json.data;
  assert.deepEqual([edge.allowed, edge.blockedBy, edge.remainingCostMicroUsd], [true, null, cost], "남은 비용 = 예상 비용");
  setLimits(database, { daily: 10, monthly: cost - 1 });
  assert.equal((await work(env, "/ai/estimate?pages=1")).json.data.blockedBy, "monthly", "1마이크로달러 모자라면 막힘");
  // 한도를 오늘 쓴 횟수(2)보다 낮추면 남은 횟수는 0이다(음수 아님).
  setLimits(database, { daily: 1, monthly: 50_000_000 });
  const lowered = (await work(env, "/ai/estimate?pages=1")).json.data;
  assert.deepEqual([lowered.remainingCreates, lowered.blockedBy], [0, "daily"]);
  for (const query of ["", "?pages=0", "?pages=6", "?pages=10", "?pages=2a", "?pages=02", "?pages=2&x=1", "?page=2", "?pages=2&pages=3"]) {
    const result = await work(env, `/ai/estimate${query}`);
    assert.deepEqual([result.status, result.json.error.details], [400, ["pages"]], query);
  }
  const post = await work(env, "/ai/estimate?pages=1", { method: "POST", body: {} });
  assert.deepEqual([post.status, post.response.headers.get("Allow")], [405, "GET"]);
  const off = await work({ ...env, WORK_AI_ENABLED: undefined }, "/ai/estimate?pages=1");
  assert.deepEqual([off.status, off.json.error.code], [503, "AI_DISABLED"]);
});
