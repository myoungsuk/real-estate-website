// 단계 4 AI 작업 보조 조회(1분 예약) 시험. 실제 OpenAI·R2·D1은 부르지 않는다(가짜 fetcher·가짜 R2·node:sqlite).
// 2026-11-24부터 새 묶음은 한 번 읽기(작업 1개)다. 예약은 묶음이 아니라 열린 행을 하나씩 보므로 옛 두 번 읽기 묶음의 행도 같은 길로 받는다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { estimateCostMicroUsd } from "../worker/work-ai-config.mjs";
import { AI_POLL_CRON, AI_POLL_MAX_ROWS, runAiPollCron } from "../worker/work-ai-cron.mjs";
import { REALPRICE_CRON, handleScheduled } from "../worker/work-scheduled.mjs";
import { completed, created, httpError, installNetworkTrap, pending, scriptedOpenAi } from "./openai-fixtures.mjs";
import { AI_PRICES, MARK, MODEL_A, sampleContract, seedCopy, seedDeal, setupAi } from "./work-ai-test-kit.mjs";
import { NOW, nextUuid, rows, work } from "./work-test-kit.mjs";

const MINUTE = 60_000;
const AT_0300_KST = Date.parse("2026-11-17T18:00:00.000Z"); // 한국 시각 03:00 정각(정리 차례)
const AT_1407_KST = Date.parse("2026-11-17T05:07:00.000Z");
const jobRows = (database) => rows(database, "SELECT * FROM ai_jobs ORDER BY created_at, group_id, run_index");
const usageRows = (database) => rows(database, "SELECT day, create_requests, estimated_cost_micro_usd, input_tokens, output_tokens FROM ai_usage_daily ORDER BY day");
const collect = () => {
  const entries = [];
  return { entries, log: (entry) => entries.push(entry) };
};
const createStarted = async (ctx, ai) => (await work(ctx.env, "/ai/jobs", { method: "POST", body: ctx.body, openaiFetch: ai.fetcher })).json.data;
const oneCreate = (more = []) => scriptedOpenAi([{ kind: "create", respond: created("resp_a1", "in_progress") }, ...more]);
// 다른 거래에 계약서 사본 1장을 붙여 묶음을 하나 더 만든다(한 번 읽기 묶음은 거래마다 하나씩만 진행 중일 수 있음).
async function createOther(ctx, ai) {
  const dealId = seedDeal(ctx.database);
  const fileIds = [await seedCopy(ctx.database, ctx.r2, { dealId })];
  return (await work(ctx.env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds, dealId }, openaiFetch: ai.fetcher })).json.data;
}

test("wrangler.jsonc의 예약 문자열은 코드 상수와 글자까지 같다(controller.cron은 설정 문자열 그대로 온다)", async () => {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gmu, ""));
  assert.deepEqual(config.triggers.crons, [REALPRICE_CRON, AI_POLL_CRON]);
  assert.equal(AI_POLL_CRON, "* * * * *");
  assert.notEqual(AI_POLL_CRON, REALPRICE_CRON);
});

test("켜기 값이 없으면 env.WORK_DB에 손도 대지 않고 끝난다(03:00 정각에도 D1 0번·외부 요청 0번·로그 0줄)", async (t) => {
  installNetworkTrap(t);
  for (const flag of [undefined, "false", "TRUE", "1", ""]) {
    let touched = 0;
    const trap = { prepare() { touched += 1; throw new Error("D1에 손댐"); }, batch() { touched += 1; throw new Error("D1에 손댐"); } };
    const env = {
      WORK_TOOLS_ENABLED: "true",
      WORK_AI_ENABLED: flag,
      get WORK_DB() { touched += 1; return trap; },
      get WORK_FILES() { touched += 1; return null; },
    };
    const { entries, log } = collect();
    for (const scheduledTime of [AT_0300_KST, AT_1407_KST]) {
      assert.deepEqual(await handleScheduled({ cron: AI_POLL_CRON, scheduledTime }, env, {}, { log }), { outcome: "disabled" });
    }
    assert.deepEqual(await runAiPollCron(env, { log }), { outcome: "disabled" });
    assert.equal(touched, 0, `켜기 값 ${String(flag)}: WORK_DB·WORK_FILES 접근 0번`);
    assert.deepEqual(entries, []);
  }
});

test("켜져 있고 열린 작업이 없으면 D1 조회 1번으로 끝난다(03:00 정각에도 정리 코드는 이 예약에서 돌지 않음)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  // 3년 넘은 감사 기록: `*/10` 예약의 03:00 차례라면 지워질 행이다.
  ctx.database.prepare("INSERT INTO audit_events (at, actor_email, action, request_id, outcome) VALUES ('2020-01-01T00:00:00.000Z', 'owner@example.com', 'customer.view', 'old', 'ok')").run();
  const { entries, log } = collect();
  const before = ctx.db.stats.statements;
  const result = await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_0300_KST }, ctx.env, {}, { log, now: () => AT_0300_KST });
  assert.deepEqual(result, { outcome: "idle", polled: 0 });
  assert.equal(ctx.db.stats.statements - before, 1, "열린 행 조회 1번뿐(구조 번호·정리 문장 없음)");
  assert.deepEqual(ctx.db.stats.batches, [], "쓰기 0");
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM audit_events WHERE request_id = 'old'")[0].n, 1, "감사 3년 삭제는 이 예약의 몫이 아님");
  assert.deepEqual(entries, [], "할 일이 없으면 로그도 없음");
  assert.deepEqual(ctx.r2.calls, []);
});

test("화면을 닫아도 1분 예약이 끝난 결과를 D1에 옮기고 한 번만 정산한다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = oneCreate([
    { kind: "retrieve", respond: pending("resp_a1") },
    { kind: "retrieve", respond: completed("resp_a1", sampleContract({ warnings: ["가상 900101-1234567"] }), { input_tokens: 9_000, output_tokens: 3_000 }) },
  ]);
  const { groupId } = await createStarted(ctx, ai);
  const { entries, log } = collect();
  const run = (now) => handleScheduled({ cron: AI_POLL_CRON, scheduledTime: now }, ctx.env, {}, { log, now: () => now, openaiFetch: ai.fetcher });

  assert.deepEqual(await run(NOW + MINUTE), { outcome: "ok", polled: 1, changed: 0, failed: 0 });
  assert.deepEqual(jobRows(ctx.database).map((row) => row.status), ["in_progress"]);
  assert.deepEqual(await run(NOW + 2 * MINUTE), { outcome: "ok", polled: 1, changed: 1, failed: 0 });
  const jobs = jobRows(ctx.database);
  assert.deepEqual(jobs.map((row) => [row.status, row.input_tokens, row.output_tokens, row.updated_at]), [
    ["completed", 9_000, 3_000, new Date(NOW + 2 * MINUTE).toISOString()],
  ]);
  assert.deepEqual(JSON.parse(jobs[0].result_json).result.contract_date, sampleContract().contract_date);
  assert.equal(JSON.parse(jobs[0].result_json).maskedCount, 1);
  assert.equal(jobs[0].result_json.includes("900101-1234567"), false, "예약이 받은 결과도 주민번호 꼴을 가려 저장");
  const actual = estimateCostMicroUsd(AI_PRICES[MODEL_A], 9_000, 3_000);
  const settled = [{ day: "2026-11-17", create_requests: 1, estimated_cost_micro_usd: actual, input_tokens: 9_000, output_tokens: 3_000 }];
  assert.deepEqual(usageRows(ctx.database), settled);

  assert.deepEqual(await run(NOW + 3 * MINUTE), { outcome: "idle", polled: 0 });
  assert.deepEqual(usageRows(ctx.database), settled);
  assert.equal(ai.remaining(), 0);
  assert.deepEqual(ai.violations, []);
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM audit_events WHERE action = 'ai.view'")[0].n, 0, "예약은 열람이 아니라 감사를 남기지 않음");

  // 로그: 개수·코드만. 계약서 내용·키·응답 ID 없음.
  const summary = entries.filter((entry) => entry.event === "ai_poll_cron");
  assert.deepEqual(summary, [{ event: "ai_poll_cron", polled: 1, changed: 0, failed: 0 }, { event: "ai_poll_cron", polled: 1, changed: 1, failed: 0 }]);
  const logText = JSON.stringify(entries);
  for (const secret of [MARK.title, MARK.key, MARK.property, MARK.quote, "resp_a1", "900101-1234567", ctx.dealId, groupId]) assert.equal(logText.includes(secret), false, secret);

  // 그 뒤 화면을 열면 OpenAI를 다시 부르지 않고 저장된 결과를 받는다.
  const view = await work(ctx.env, `/ai/jobs/${groupId}`, { now: NOW + 30 * MINUTE });
  assert.equal(view.json.data.group.status, "ready");
  assert.deepEqual(view.json.data.jobs.map((job) => job.maskedCount), [1]);
});

test("1분 예약도 10분 지난 404는 expired, 응답 ID 없는 행은 unknown으로 닫는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  // 첫 묶음은 OpenAI가 404, 다른 거래의 둘째 묶음은 응답 ID를 적지 못한 행.
  const ai = scriptedOpenAi([
    { kind: "create", respond: created("resp_a1", "in_progress") },
    { kind: "create", respond: created("resp_c1", "in_progress") },
    { kind: "retrieve", respond: httpError(404) },
  ]);
  const first = await createStarted(ctx, ai);
  const second = await createOther(ctx, ai);
  ctx.database.prepare("UPDATE ai_jobs SET openai_response_id = NULL, status = 'queued' WHERE group_id = ?").run(second.groupId);
  const result = await runAiPollCron(ctx.env, { now: () => NOW + 11 * MINUTE, openaiFetch: ai.fetcher, log: () => {} });
  assert.deepEqual(result, { outcome: "ok", polled: 2, changed: 2, failed: 0 });
  const byGroup = (groupId) => jobRows(ctx.database).filter((row) => row.group_id === groupId).map((row) => [row.status, row.error_code, row.input_tokens]);
  assert.deepEqual(byGroup(first.groupId), [["expired", "AI_RESULT_EXPIRED", null]]);
  assert.deepEqual(byGroup(second.groupId), [["unknown", "AI_STATE_UNKNOWN", null]]);
  assert.equal(ai.remaining(), 0);
  assert.equal(usageRows(ctx.database)[0].create_requests, 2, "되돌리지 않음(묶음 2개 × 1회)");
});

test("`*/10` 예약은 AI 작업을 건드리지 않고, 1분 예약은 실거래가 받기를 부르지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = oneCreate();
  await createStarted(ctx, ai);
  const before = jobRows(ctx.database);
  const { entries, log } = collect();
  // 실거래가 켜기 값이 없는 `*/10` 차례(03:00이 아닌 때): AI가 켜져 있고 열린 작업이 있어도 그대로다.
  assert.deepEqual(await handleScheduled({ cron: REALPRICE_CRON, scheduledTime: AT_1407_KST }, ctx.env, {}, { log, now: () => NOW + 20 * MINUTE, openaiFetch: ai.fetcher }), { outcome: "disabled" });
  assert.deepEqual(jobRows(ctx.database), before);
  assert.equal(ai.calls.length, 1, "조회 0번");

  // 실거래가를 켜 둔 env로 1분 예약을 돌려도 rt_* 표·실행 기록에 손대지 않는다.
  const realpriceEnv = { ...ctx.env, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: "ZZMOLIT-0000000000000000" };
  const done = scriptedOpenAi([{ kind: "retrieve", respond: pending("resp_a1") }]);
  const result = await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_1407_KST }, realpriceEnv, {}, { log, now: () => NOW + MINUTE, openaiFetch: done.fetcher });
  assert.deepEqual(result, { outcome: "ok", polled: 1, changed: 0, failed: 0 });
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM rt_fetch_runs")[0].n, 0);
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM rt_fetch_months")[0].n, 0);
  assert.equal(entries.some((entry) => entry.event === "realprice_cron"), false);
  assert.deepEqual(await handleScheduled({ cron: "*/1 * * * *", scheduledTime: AT_1407_KST }, ctx.env, {}, { log }), { outcome: "unknown_cron" }, "글자가 다른 예약은 모르는 예약");
});

test("켰지만 다른 설정이 빠지면 D1 문장 없이 끝나고, 경고는 매시 정각 차례에만 1줄 남긴다", async (t) => {
  installNetworkTrap(t);
  for (const extra of [{ OPENAI_API_KEY: undefined }, { OPENAI_IMAGE_DETAIL: undefined }, { WORK_FILES_ENABLED: undefined }, { WORK_TOOLS_ENABLED: undefined }, { OPENAI_PRICES_JSON: "{}" }]) {
    const ctx = await setupAi({ env: extra });
    const { entries, log } = collect();
    const before = ctx.db.stats.statements;
    assert.deepEqual(await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_1407_KST }, ctx.env, {}, { log }), { outcome: "config" });
    assert.deepEqual(entries, []);
    assert.deepEqual(await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_0300_KST }, ctx.env, {}, { log }), { outcome: "config" });
    assert.deepEqual(entries, [{ event: "ai_poll_cron", level: "warn", code: "AI_CRON_CONFIG" }]);
    assert.equal(ctx.db.stats.statements, before, "D1 문장 0");
  }
});

test("구조 번호가 코드와 다르면 열린 작업이 있어도 OpenAI를 부르지 않고 행을 고치지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = oneCreate();
  await createStarted(ctx, ai);
  const before = jobRows(ctx.database);
  ctx.database.prepare("UPDATE settings SET value_json = '10' WHERE key = 'schema_version'").run();
  const { entries, log } = collect();
  assert.deepEqual(await runAiPollCron(ctx.env, { now: () => NOW + MINUTE, openaiFetch: ai.fetcher, log }), { outcome: "schema" });
  assert.deepEqual(jobRows(ctx.database), before);
  assert.equal(ai.calls.length, 1);
  assert.deepEqual(entries, [{ event: "ai_poll_cron", level: "warn", code: "AI_CRON_SCHEMA" }]);
});

test("한 차례에 열린 행을 10개까지만 보고, 한 행의 OpenAI 오류가 다른 행을 막지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const at = new Date(NOW).toISOString();
  const insert = ctx.database.prepare(`INSERT INTO ai_jobs (id, group_id, run_index, pair_mode, kind, status, openai_response_id, lease_until, model, reasoning_effort, input_file_ids,
    input_tokens, output_tokens, created_at, updated_at) VALUES (?, ?, 1, 'cross', 'contract_schedule', 'in_progress', ?, ?, ?, 'max', '[]', 1000, 20000, ?, ?)`);
  for (let index = 0; index < AI_POLL_MAX_ROWS + 2; index += 1) {
    insert.run(nextUuid(), nextUuid(), `resp_x${index}`, new Date(NOW + 60 * MINUTE).toISOString(), MODEL_A, at, new Date(NOW + index).toISOString());
  }
  // 첫 행은 5xx(한 번 다시 부름), 나머지 9행은 queued로 바뀜.
  const steps = [{ kind: "retrieve", respond: httpError(500) }, { kind: "retrieve", respond: httpError(500) }];
  for (let index = 1; index < AI_POLL_MAX_ROWS; index += 1) steps.push({ kind: "retrieve", respond: pending(`resp_x${index}`, "queued") });
  const ai = scriptedOpenAi(steps);
  const result = await runAiPollCron(ctx.env, { now: () => NOW + MINUTE, openaiFetch: ai.fetcher, log: () => {} });
  assert.deepEqual(result, { outcome: "ok", polled: AI_POLL_MAX_ROWS, changed: AI_POLL_MAX_ROWS - 1, failed: 0 });
  assert.equal(ai.remaining(), 0);
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(ai.calls.map((call) => call.path), ["/responses/resp_x0", "/responses/resp_x0", ...Array.from({ length: AI_POLL_MAX_ROWS - 1 }, (_, index) => `/responses/resp_x${index + 1}`)], "오래 손대지 않은 행부터");
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM ai_jobs WHERE status = 'queued'")[0].n, AI_POLL_MAX_ROWS - 1);
  assert.equal(rows(ctx.database, "SELECT count(*) AS n FROM ai_jobs WHERE status = 'in_progress'")[0].n, 3, "5xx 행 1개 + 이번 차례에 보지 않은 2개");
});

test("내부 예외는 밖으로 나가지 않고 고정 코드만 남긴다(오류 글·D1 내용 없음)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const broken = { ...ctx.db, prepare() { throw new Error(`ZZSECRET ${MARK.title}`); } };
  const { entries, log } = collect();
  const result = await handleScheduled({ cron: AI_POLL_CRON, scheduledTime: AT_1407_KST }, { ...ctx.env, WORK_DB: broken }, {}, { log });
  assert.deepEqual(result, { outcome: "internal_error", code: "AI_CRON_INTERNAL" });
  assert.deepEqual(entries, [{ event: "ai_poll_cron", level: "warn", code: "AI_CRON_INTERNAL" }]);

  // 한 행의 적기(batch)가 실패해도 예약은 끝까지 돌고 failed로만 센다(거래 2개에 한 번 읽기 묶음 하나씩).
  const ai = scriptedOpenAi([
    { kind: "create", respond: created("resp_a1", "in_progress") },
    { kind: "create", respond: created("resp_c1", "in_progress") },
    { kind: "retrieve", respond: completed("resp_a1", sampleContract()) },
    { kind: "retrieve", respond: completed("resp_c1", sampleContract()) },
  ]);
  await createStarted(ctx, ai);
  await createOther(ctx, ai);
  let batches = 0;
  const flaky = { ...ctx.db, batch: async (statements) => { batches += 1; if (batches === 1) throw new Error("ZZSECRET D1 실패"); return ctx.db.batch(statements); } };
  const second = collect();
  const partial = await runAiPollCron({ ...ctx.env, WORK_DB: flaky }, { now: () => NOW + MINUTE, openaiFetch: ai.fetcher, log: second.log });
  assert.deepEqual(partial, { outcome: "ok", polled: 2, changed: 1, failed: 1 });
  assert.deepEqual(jobRows(ctx.database).map((row) => row.status), ["in_progress", "completed"]);
  assert.equal(JSON.stringify(second.entries).includes("ZZSECRET"), false);
});
