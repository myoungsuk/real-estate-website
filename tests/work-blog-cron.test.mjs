// 글 초안(P3) 화면을 닫아도 받기 시험(설계서 22.11절 4번, DEC-WT-36, 2026-11-25 사용자 결정 "추천대로").
// 1분 예약(`* * * * *`)이 열린 글 초안을 화면 조회와 같은 pollDraft()로 받아 D1에 옮기는지 본다.
// 진짜 SQLite(node:sqlite)에 migrations/work 전부를 적용하고, OpenAI는 tests/openai-fixtures.mjs의 가짜 fetch로만 부른다(실제 호출 0번).
import test from "node:test";
import assert from "node:assert/strict";
import { AI_POLL_CRON } from "../worker/work-ai-cron.mjs";
import { BLOG_POLL_LOOKBACK_MS, BLOG_POLL_MAX_ROWS, BLOG_RESULT_KEEP_MS, BLOG_WAIT_MAX_MS, OPEN_DRAFTS_SQL } from "../worker/work-blog.mjs";
import { runBlogPollCron } from "../worker/work-blog-cron.mjs";
import { REALPRICE_CRON, handleScheduled } from "../worker/work-scheduled.mjs";
import { FAKE_PRICES, blogEnv, completed, created, httpError, installNetworkTrap, networkError, pending, sampleResult, scriptedOpenAi } from "./openai-fixtures.mjs";
import { AI_PRICES, aiEnv } from "./work-ai-test-kit.mjs";
import { NOW, createR2, freshDb, rows, work } from "./work-test-kit.mjs";

const MINUTE = 60_000;
const COMPLEX = { type: "complex", id: "leaders-city-5" };
const ACTUAL_4000_5000 = Math.ceil((4000 * 2_000_000 + 5000 * 10_000_000) / 1_000_000); // 58,000 마이크로달러
const AT_0500_UTC = Date.parse("2026-11-17T05:00:00.000Z"); // 매시 정각(설정 경고를 남기는 차례)
const AT_0507_UTC = Date.parse("2026-11-17T05:07:00.000Z");

const usageRows = (database) => rows(database, "SELECT day, create_requests, estimated_cost_micro_usd, input_tokens, output_tokens FROM ai_usage_daily ORDER BY day");
const draftRows = (database) => rows(database, "SELECT * FROM blog_drafts ORDER BY created_at, id");
const statusOf = (database) => draftRows(database).map((row) => [row.status, row.error_code]);

function collect() {
  const entries = [];
  return { entries, log: (entry) => entries.push(entry) };
}

async function setLimits(env, { daily = 20, monthly = 10_000_000 } = {}) {
  const result = await work(env, "/blog/limits", { method: "PUT", body: { version: 0, dailyCreateLimit: daily, monthlyCostLimitMicroUsd: monthly } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
}

// 글 초안만 켠 D1과 env. 초안 하나를 만든 뒤(queued) 그 ID와 미리 더한 비용을 돌려준다.
async function blogSetup({ drafts = 1 } = {}) {
  const { database, db } = freshDb();
  const env = blogEnv(db);
  await setLimits(env);
  const ids = [];
  for (let index = 0; index < drafts; index += 1) {
    const openai = scriptedOpenAi([{ kind: "create", respond: created(`resp_wait_${index}`) }]);
    const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher, now: NOW + index });
    assert.equal(made.status, 201, JSON.stringify(made.json));
    ids.push(made.json.data.draft.id);
  }
  const reserved = draftRows(database)[0]?.reserved_cost_micro_usd ?? 0;
  return { database, db, env, ids, id: ids[0], reserved };
}

const cron = (env, now, openai, log = () => {}) => handleScheduled({ cron: AI_POLL_CRON, scheduledTime: now }, env, {}, { log, now: () => now, openaiFetch: openai.fetcher });

test("TK-155 1분 예약의 켜기 값 조합 4가지: 둘 다 꺼짐은 D1·외부 요청·로그 0, 글 초안만 켜면 글 초안만, 계약서 AI만 켜면 글 초안은 보지 않음, 둘 다 켜면 둘 다", async (t) => {
  installNetworkTrap(t);
  // ① 둘 다 꺼짐: env.WORK_DB에 손도 대지 않는다.
  for (const flag of [undefined, "false", "TRUE", "1", ""]) {
    let touched = 0;
    const trap = { prepare() { touched += 1; throw new Error("D1에 손댐"); }, batch() { touched += 1; throw new Error("D1에 손댐"); } };
    const env = { WORK_TOOLS_ENABLED: "true", WORK_AI_ENABLED: undefined, WORK_BLOG_ENABLED: flag, get WORK_DB() { touched += 1; return trap; }, get WORK_FILES() { touched += 1; return null; } };
    const { entries, log } = collect();
    assert.deepEqual(await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_0500_UTC }, env, {}, { log }), { outcome: "disabled" });
    assert.deepEqual(await runBlogPollCron(env, { log }), { outcome: "disabled" });
    assert.equal(touched, 0, `켜기 값 ${String(flag)}: WORK_DB·WORK_FILES 접근 0번`);
    assert.deepEqual(entries, []);
  }

  // ② 글 초안만 켬: 계약서 AI 쪽은 disabled 그대로, 글 초안만 조회한다(WORK_FILES는 건드리지 않음).
  const only = await blogSetup();
  let filesTouched = 0;
  const blogOnlyEnv = { ...only.env, get WORK_FILES() { filesTouched += 1; return null; } };
  const first = scriptedOpenAi([{ kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) }]);
  assert.deepEqual(await cron(blogOnlyEnv, NOW + MINUTE, first), { outcome: "disabled", blog: { outcome: "ok", polled: 1, changed: 1, failed: 0 } });
  assert.equal(filesTouched, 0);
  assert.deepEqual(statusOf(only.database), [["completed", null]]);
  assert.deepEqual(first.violations, []);

  // ③ 계약서 AI만 켬: 열린 글 초안이 있어도 보지 않는다(돌려주는 값도 이전 그대로).
  const aiOnly = await blogSetup();
  const r2 = createR2();
  const aiOnlyEnv = aiEnv(aiOnly.db, r2);
  const none = scriptedOpenAi();
  assert.deepEqual(await cron(aiOnlyEnv, NOW + MINUTE, none), { outcome: "idle", polled: 0 });
  assert.equal(none.calls.length, 0);
  assert.deepEqual(statusOf(aiOnly.database), [["queued", null]]);

  // ④ 둘 다 켬: 계약서 AI는 열린 작업이 없어 idle, 글 초안은 받는다. 실거래가 예약(*/10)에서는 글 초안을 보지 않는다.
  const both = await blogSetup();
  const bothEnv = aiEnv(both.db, createR2(), { WORK_BLOG_ENABLED: "true", OPENAI_MODEL_BLOG: "gpt-test-blog", OPENAI_REASONING_EFFORT: "xhigh", OPENAI_PRICES_JSON: JSON.stringify({ ...AI_PRICES, ...FAKE_PRICES }) });
  const untouched = scriptedOpenAi();
  await handleScheduled({ cron: REALPRICE_CRON, scheduledTime: AT_0507_UTC }, bothEnv, {}, { log: () => {}, now: () => AT_0507_UTC, openaiFetch: untouched.fetcher });
  assert.equal(untouched.calls.length, 0, "*/10 예약은 글 초안을 조회하지 않음");
  assert.deepEqual(statusOf(both.database), [["queued", null]]);
  const second = scriptedOpenAi([{ kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) }]);
  assert.deepEqual(await cron(bothEnv, NOW + MINUTE, second), { outcome: "idle", polled: 0, blog: { outcome: "ok", polled: 1, changed: 1, failed: 0 } });
  assert.deepEqual(statusOf(both.database), [["completed", null]]);
  assert.deepEqual(usageRows(both.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd]), [[1, ACTUAL_4000_5000]]);
});

test("TK-156 화면을 닫아도 받음: 예약이 진행 상태를 옮기고, 끝나면 화면 조회와 같은 검사·같은 값으로 결과·실제 비용을 저장하며, 그 뒤에는 OpenAI를 다시 부르지 않음", async (t) => {
  installNetworkTrap(t);
  const viaCron = await blogSetup();
  const { entries, log } = collect();
  const openai = scriptedOpenAi([
    { kind: "retrieve", respond: pending("resp_wait_0") },
    { kind: "retrieve", respond: pending("resp_wait_0") },
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) },
  ]);
  assert.deepEqual((await cron(viaCron.env, NOW + MINUTE, openai, log)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 }, "queued → in_progress");
  assert.deepEqual(statusOf(viaCron.database), [["in_progress", null]]);
  assert.equal(usageRows(viaCron.database)[0].estimated_cost_micro_usd, viaCron.reserved, "끝나기 전에는 미리 더한 값 그대로");
  assert.deepEqual((await cron(viaCron.env, NOW + 2 * MINUTE, openai, log)).blog, { outcome: "ok", polled: 1, changed: 0, failed: 0 }, "같은 상태면 쓰지 않음");
  assert.deepEqual((await cron(viaCron.env, NOW + 3 * MINUTE, openai, log)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  const settled = usageRows(viaCron.database);
  assert.deepEqual(settled.map((row) => [row.create_requests, row.estimated_cost_micro_usd, row.input_tokens, row.output_tokens]), [[1, ACTUAL_4000_5000, 4000, 5000]]);
  // 다 받은 뒤: 열린 초안이 없어 OpenAI를 부르지 않고 사용량도 그대로다.
  assert.deepEqual((await cron(viaCron.env, NOW + 4 * MINUTE, openai, log)).blog, { outcome: "idle", polled: 0 });
  assert.deepEqual(usageRows(viaCron.database), settled);
  assert.equal(openai.remaining(), 0);
  assert.deepEqual(openai.violations, []);
  assert.ok(openai.calls.every((call) => call.kind === "retrieve" && call.authIsFakeKey && call.hasSignal));

  // 화면이 직접 받은 것과 같은 값(같은 함수)인지 나란히 본다.
  const viaScreen = await blogSetup();
  const screenAi = scriptedOpenAi([{ kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) }]);
  await work(viaScreen.env, `/blog/drafts/${viaScreen.id}`, { openaiFetch: screenAi.fetcher, now: NOW + 3 * MINUTE });
  const pick = (database) => draftRows(database).map((row) => [row.status, row.result_json, row.check_json, row.error_code, row.actual_cost_micro_usd, row.input_tokens, row.output_tokens, row.updated_at]);
  assert.deepEqual(pick(viaCron.database), pick(viaScreen.database));
  assert.deepEqual(JSON.parse(draftRows(viaCron.database)[0].result_json).title, sampleResult().title);

  // 다시 연 화면: 서버가 이미 받아 둔 글을 OpenAI 없이 그대로 준다(목록에도 다 만듦).
  const reopened = await work(viaCron.env, `/blog/drafts/${viaCron.id}`, { now: NOW + 20 * MINUTE });
  assert.deepEqual([reopened.json.data.draft.status, reopened.json.data.draft.result.title], ["completed", sampleResult().title]);
  const list = await work(viaCron.env, "/blog/drafts", { now: NOW + 20 * MINUTE });
  assert.deepEqual(list.json.data.items.map((item) => [item.id, item.status, item.closed]), [[viaCron.id, "completed", null]]);

  // 로그에는 개수·상태·토큰 수만 있고 글은 없다.
  assert.deepEqual(entries.filter((entry) => entry.event === "blog_poll_cron"), [
    { event: "blog_poll_cron", polled: 1, changed: 1, failed: 0 },
    { event: "blog_poll_cron", polled: 1, changed: 0, failed: 0 },
    { event: "blog_poll_cron", polled: 1, changed: 1, failed: 0 },
  ]);
  assert.doesNotMatch(JSON.stringify(entries), /리더스시티|단지 소개/u);
});

test("TK-157 화면 조회와 예약이 같은 초안을 같은 때 끝내도 결과 저장·비용 바로잡기는 1번만(어느 쪽이 먼저든)", async (t) => {
  installNetworkTrap(t);
  const actualBig = Math.ceil((9000 * 2_000_000 + 9000 * 10_000_000) / 1_000_000);
  // ① 예약이 결과를 받아 저장하기 직전에 화면 조회가 먼저 저장한다.
  const a = await blogSetup();
  const aiA = scriptedOpenAi([
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) },
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult({ title: "화면이 먼저 받은 글" }), { input_tokens: 9000, output_tokens: 9000 }) },
  ]);
  let screen;
  a.db.beforeNextBatch = async () => {
    screen = await work(a.env, `/blog/drafts/${a.id}`, { openaiFetch: aiA.fetcher, now: NOW + MINUTE });
  };
  await cron(a.env, NOW + MINUTE, aiA);
  assert.equal(screen.json.data.draft.status, "completed");
  assert.deepEqual(usageRows(a.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd, row.input_tokens, row.output_tokens]), [[1, actualBig, 9000, 9000]], "먼저 저장한 화면 쪽 1번만");
  assert.deepEqual(draftRows(a.database).map((row) => [row.status, row.actual_cost_micro_usd, JSON.parse(row.result_json).title]), [["completed", actualBig, "화면이 먼저 받은 글"]]);

  // ② 화면 조회가 저장하기 직전에 예약이 먼저 저장한다.
  const b = await blogSetup();
  const aiB = scriptedOpenAi([
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult({ title: "화면이 늦게 받은 글" }), { input_tokens: 9000, output_tokens: 9000 }) },
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) },
  ]);
  let cronResult;
  b.db.beforeNextBatch = async () => {
    cronResult = await cron(b.env, NOW + MINUTE, aiB);
  };
  const late = await work(b.env, `/blog/drafts/${b.id}`, { openaiFetch: aiB.fetcher, now: NOW + MINUTE });
  assert.equal(cronResult.blog.outcome, "ok");
  assert.deepEqual([late.json.data.draft.status, late.json.data.draft.result.title], ["completed", sampleResult().title], "화면은 예약이 저장한 글을 받음");
  assert.deepEqual(usageRows(b.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd, row.input_tokens, row.output_tokens]), [[1, ACTUAL_4000_5000, 4000, 5000]], "먼저 저장한 예약 쪽 1번만");
  assert.deepEqual([aiA.violations, aiB.violations], [[], []]);
});

test("TK-158 기다리는 끝 30분: 그 전에는 그대로, 30분이 지나도 끝나지 않았거나 조회가 계속 실패하면 실패(AI_WAIT_TIMEOUT)로 닫고 미리 더한 비용을 실제 비용으로 남기며, 그 뒤에는 다시 보지 않음", async (t) => {
  installNetworkTrap(t);
  assert.equal(BLOG_WAIT_MAX_MS, 30 * MINUTE);
  assert.ok(BLOG_WAIT_MAX_MS > BLOG_RESULT_KEEP_MS && BLOG_POLL_LOOKBACK_MS > BLOG_WAIT_MAX_MS);

  // ① OpenAI가 계속 만드는 중이라고 답함.
  const slow = await blogSetup();
  const openai = scriptedOpenAi([
    { kind: "retrieve", respond: pending("resp_wait_0", "queued") },
    { kind: "retrieve", respond: pending("resp_wait_0", "queued") },
  ]);
  assert.deepEqual((await cron(slow.env, NOW + BLOG_WAIT_MAX_MS, openai)).blog, { outcome: "ok", polled: 1, changed: 0, failed: 0 }, "딱 30분은 아직 기다림");
  assert.deepEqual(statusOf(slow.database), [["queued", null]]);
  assert.deepEqual((await cron(slow.env, NOW + BLOG_WAIT_MAX_MS + MINUTE, openai)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  assert.deepEqual(draftRows(slow.database).map((row) => [row.status, row.error_code, row.result_json, row.actual_cost_micro_usd, row.input_tokens, row.output_tokens]), [["failed", "AI_WAIT_TIMEOUT", null, slow.reserved, 0, 0]]);
  assert.deepEqual(usageRows(slow.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd, row.input_tokens, row.output_tokens]), [[1, slow.reserved, 0, 0]], "횟수 1번·미리 더한 비용 그대로(적게 세지 않음)");
  const after = scriptedOpenAi();
  assert.deepEqual((await cron(slow.env, NOW + BLOG_WAIT_MAX_MS + 2 * MINUTE, after)).blog, { outcome: "idle", polled: 0 });
  assert.equal(after.calls.length, 0, "닫은 초안은 다시 조회하지 않음");
  assert.deepEqual(openai.calls.map((call) => call.kind), ["retrieve", "retrieve"], "OpenAI 쪽 요청은 취소하지 않음");

  // ② 조회가 네트워크 오류로 계속 실패함(1번 다시 하므로 한 차례에 2번 부름).
  const down = await blogSetup();
  const broken = scriptedOpenAi(Array.from({ length: 4 }, () => ({ kind: "retrieve", respond: networkError() })));
  assert.deepEqual((await cron(down.env, NOW + 29 * MINUTE, broken)).blog, { outcome: "ok", polled: 1, changed: 0, failed: 0 });
  assert.deepEqual(statusOf(down.database), [["queued", null]]);
  assert.deepEqual((await cron(down.env, NOW + 31 * MINUTE, broken)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  assert.deepEqual(draftRows(down.database).map((row) => [row.status, row.error_code, row.actual_cost_micro_usd]), [["failed", "AI_WAIT_TIMEOUT", down.reserved]]);
  assert.equal(usageRows(down.database)[0].estimated_cost_micro_usd, down.reserved);

  // ③ 화면 조회도 같은 끝을 쓴다(같은 함수).
  const screen = await blogSetup();
  const viaScreen = await work(screen.env, `/blog/drafts/${screen.id}`, { openaiFetch: scriptedOpenAi([{ kind: "retrieve", respond: pending("resp_wait_0") }]).fetcher, now: NOW + BLOG_WAIT_MAX_MS + 1_000 });
  assert.deepEqual([viaScreen.json.data.draft.status, viaScreen.json.data.draft.errorCode, viaScreen.json.data.draft.actualCostMicroUsd], ["failed", "AI_WAIT_TIMEOUT", screen.reserved]);

  // ④ 30분이 지난 뒤라도 OpenAI가 다 만들었다고 답하면 글을 받는다(끝은 '아직 안 끝난 초안'에만 건다).
  const lucky = await blogSetup();
  const done = scriptedOpenAi([{ kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) }]);
  await cron(lucky.env, NOW + BLOG_WAIT_MAX_MS + MINUTE, done);
  assert.deepEqual(statusOf(lucky.database), [["completed", null]]);
});

test("TK-159 조회 실패 뒤 다음 분에 다시 봄: OpenAI 5xx·네트워크 오류는 그대로 두었다가 다음 차례에 받고, D1 쓰기가 실패한 초안은 failed로 세고 다른 초안은 계속 받으며, 404는 10분 전후로 unknown·expired", async (t) => {
  installNetworkTrap(t);
  const one = await blogSetup();
  const flaky = scriptedOpenAi([
    { kind: "retrieve", respond: httpError(503) },
    { kind: "retrieve", respond: networkError() },
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) },
  ]);
  assert.deepEqual((await cron(one.env, NOW + MINUTE, flaky)).blog, { outcome: "ok", polled: 1, changed: 0, failed: 0 });
  assert.deepEqual(statusOf(one.database), [["queued", null]]);
  assert.equal(usageRows(one.database)[0].estimated_cost_micro_usd, one.reserved);
  assert.deepEqual((await cron(one.env, NOW + 2 * MINUTE, flaky)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  assert.deepEqual(statusOf(one.database), [["completed", null]]);

  // D1 쓰기 실패: 첫 초안의 batch만 한 번 실패시킨다.
  const two = await blogSetup({ drafts: 2 });
  const steps = () => [
    { kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) },
    { kind: "retrieve", respond: completed("resp_wait_1", sampleResult()) },
  ];
  const realBatch = two.db.batch;
  let failNext = true;
  two.db.batch = async (statements) => {
    if (failNext) {
      failNext = false;
      throw new Error("가짜 D1 장애");
    }
    return realBatch(statements);
  };
  const { entries, log } = collect();
  const run1 = scriptedOpenAi(steps());
  assert.deepEqual((await cron(two.env, NOW + MINUTE, run1, log)).blog, { outcome: "ok", polled: 2, changed: 1, failed: 1 });
  assert.deepEqual(run1.calls.map((call) => call.path), ["/responses/resp_wait_0", "/responses/resp_wait_1"], "만든 지 오래된 것부터");
  assert.deepEqual(statusOf(two.database), [["queued", null], ["completed", null]]);
  assert.doesNotMatch(JSON.stringify(entries), /가짜 D1 장애/u, "로그에 error.message 없음");
  const run2 = scriptedOpenAi([steps()[0]]);
  assert.deepEqual((await cron(two.env, NOW + 2 * MINUTE, run2)).blog, { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  assert.deepEqual(statusOf(two.database), [["completed", null], ["completed", null]]);
  assert.deepEqual(usageRows(two.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd]), [[2, 2 * ACTUAL_4000_5000]]);

  // 404: 10분 전이면 unknown, 지났으면 expired(화면 조회와 같은 규칙, 미리 더한 비용 그대로).
  const early = await blogSetup();
  await cron(early.env, NOW + 9 * MINUTE, scriptedOpenAi([{ kind: "retrieve", respond: httpError(404) }]));
  assert.deepEqual(statusOf(early.database), [["unknown", "AI_STATE_UNKNOWN"]]);
  const late = await blogSetup();
  await cron(late.env, NOW + 11 * MINUTE, scriptedOpenAi([{ kind: "retrieve", respond: httpError(404) }]));
  assert.deepEqual(statusOf(late.database), [["expired", "AI_RESULT_EXPIRED"]]);
  assert.equal(usageRows(late.database)[0].estimated_cost_micro_usd, late.reserved);
});

test("TK-160 열린 초안이 없으면 D1 조회 1번(색인으로 최근 24시간 범위만)으로 끝나고 쓰기·OpenAI·로그 0, 취소한 초안·24시간 넘은 초안은 보지 않으며 한 번에 10행까지", async (t) => {
  installNetworkTrap(t);
  const empty = freshDb();
  const emptyEnv = blogEnv(empty.db);
  const { entries, log } = collect();
  const none = scriptedOpenAi();
  const before = empty.db.stats.statements;
  assert.deepEqual(await cron(emptyEnv, AT_0500_UTC, none, log), { outcome: "disabled", blog: { outcome: "idle", polled: 0 } });
  assert.equal(empty.db.stats.statements - before, 1, "D1 조회 1번");
  assert.deepEqual(empty.db.stats.batches, [], "쓰기 0");
  assert.deepEqual(entries, [], "할 일이 없으면 로그도 없음");
  assert.equal(none.calls.length, 0);
  // 표를 다 훑지 않고 created_at 색인으로 범위만 읽는다(읽는 행 수 = 최근 24시간에 만든 초안 수).
  const plan = rows(empty.database, `EXPLAIN QUERY PLAN ${OPEN_DRAFTS_SQL}`, new Date(NOW - BLOG_POLL_LOOKBACK_MS).toISOString(), BLOG_POLL_MAX_ROWS).map((row) => row.detail).join(" | ");
  assert.match(plan, /SEARCH blog_drafts USING INDEX idx_blog_drafts_created \(created_at>\?\)/u, plan);
  assert.doesNotMatch(plan, /SCAN blog_drafts/u, plan);

  // 끝난 초안·취소한 초안만 있으면 여전히 조회 1번으로 끝난다.
  const closed = await blogSetup({ drafts: 2 });
  await cron(closed.env, NOW + MINUTE, scriptedOpenAi([{ kind: "retrieve", respond: completed("resp_wait_0", sampleResult()) }, { kind: "retrieve", respond: pending("resp_wait_1") }]));
  const cancel = await work(closed.env, `/blog/drafts/${closed.ids[1]}/cancel`, { method: "POST", body: {}, openaiFetch: scriptedOpenAi([{ kind: "cancel", respond: httpError(404) }]).fetcher, now: NOW + 2 * MINUTE });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.json));
  assert.deepEqual(draftRows(closed.database).map((row) => [row.status, row.closed]), [["completed", null], ["in_progress", "cancelled"]]);
  const mark = closed.db.stats.statements;
  assert.deepEqual((await cron(closed.env, NOW + 3 * MINUTE, none)).blog, { outcome: "idle", polled: 0 });
  assert.equal(closed.db.stats.statements - mark, 1);

  // 24시간 넘게 열려 있던 초안은 예약이 보지 않는다(화면에서 열면 그때 닫힘).
  const stale = await blogSetup();
  assert.deepEqual((await cron(stale.env, NOW + BLOG_POLL_LOOKBACK_MS + MINUTE, none)).blog, { outcome: "idle", polled: 0 });
  assert.deepEqual(statusOf(stale.database), [["queued", null]]);
  const opened = await work(stale.env, `/blog/drafts/${stale.id}`, { openaiFetch: scriptedOpenAi([{ kind: "retrieve", respond: httpError(404) }]).fetcher, now: NOW + BLOG_POLL_LOOKBACK_MS + MINUTE });
  assert.equal(opened.json.data.draft.status, "expired");

  // 한 번에 10행까지, 만든 지 오래된 것부터.
  const many = await blogSetup({ drafts: BLOG_POLL_MAX_ROWS + 2 });
  const batchAi = scriptedOpenAi(Array.from({ length: BLOG_POLL_MAX_ROWS }, (_, index) => ({ kind: "retrieve", respond: pending(`resp_wait_${index}`, "queued") })));
  assert.deepEqual((await cron(many.env, NOW + MINUTE, batchAi)).blog, { outcome: "ok", polled: BLOG_POLL_MAX_ROWS, changed: 0, failed: 0 });
  assert.deepEqual(batchAi.calls.map((call) => call.path), Array.from({ length: BLOG_POLL_MAX_ROWS }, (_, index) => `/responses/resp_wait_${index}`));
  assert.equal(none.calls.length, 0);
});

test("TK-161 켰는데 설정이 빠졌으면 D1·OpenAI 없이 매시 정각에만 경고 1줄, 구조 번호가 코드와 다르면 자료를 고치지 않음, 안에서 난 예외는 고정 코드만 남김", async (t) => {
  installNetworkTrap(t);
  const missing = await blogSetup();
  const noKeyEnv = { ...missing.env, OPENAI_API_KEY: undefined };
  const none = scriptedOpenAi();
  {
    const { entries, log } = collect();
    const mark = missing.db.stats.statements;
    assert.deepEqual((await cron(noKeyEnv, AT_0507_UTC, none, log)).blog, { outcome: "config" });
    assert.deepEqual(entries, []);
    assert.deepEqual((await cron(noKeyEnv, AT_0500_UTC, none, log)).blog, { outcome: "config" });
    assert.deepEqual(entries, [{ event: "blog_poll_cron", level: "warn", code: "BLOG_CRON_CONFIG" }]);
    assert.equal(missing.db.stats.statements - mark, 0, "D1 0번");
  }
  {
    const behind = await blogSetup();
    behind.database.exec("UPDATE settings SET value_json = '6' WHERE key = 'schema_version'");
    const before = draftRows(behind.database);
    const { entries, log } = collect();
    assert.deepEqual((await cron(behind.env, NOW + MINUTE, none, log)).blog, { outcome: "schema" });
    assert.deepEqual(draftRows(behind.database), before);
    assert.deepEqual(entries, [{ event: "blog_poll_cron", level: "warn", code: "BLOG_CRON_SCHEMA" }]);
  }
  {
    const broken = await blogSetup();
    broken.db.prepare = () => {
      throw new Error("가짜 D1 장애 ZZSECRET");
    };
    const { entries, log } = collect();
    assert.deepEqual((await cron(broken.env, NOW + MINUTE, none, log)).blog, { outcome: "internal_error", code: "BLOG_CRON_INTERNAL" });
    assert.deepEqual(entries, [{ event: "blog_poll_cron", level: "warn", code: "BLOG_CRON_INTERNAL" }]);
  }
  assert.equal(none.calls.length, 0);
});
