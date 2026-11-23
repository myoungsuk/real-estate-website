// 단계 4 AI 작업 API (가) 시험: 계약서 두 번 읽기 작업 만들기·조회·취소·목록, 한도, 켜기 값(설계서 14.3 ~ 14.5절).
// 실제 OpenAI·R2·D1은 부르지 않는다(가짜 fetcher·가짜 R2·node:sqlite). 전역 fetch는 덫으로 바꿔 실제 외부 요청 0번을 확인한다.
import assert from "node:assert/strict";
import test from "node:test";
import { CONTRACT_FIELD_ORDER, contractFieldOrder, contractInstructions } from "../src/lib/work/contract-extract.mjs";
import { estimateCostMicroUsd } from "../worker/work-ai-config.mjs";
import { runAiPollCron } from "../worker/work-ai-cron.mjs";
import { AI_MAX_FILES, AI_MAX_TOTAL_BYTES, estimateContractInputTokens } from "../worker/work-ai-jobs.mjs";
import {
  FAKE_OPENAI_KEY,
  completed,
  created,
  failedResponse,
  httpError,
  incomplete,
  installNetworkTrap,
  networkError,
  pending,
  refusal,
  scriptedOpenAi,
  timeoutError,
} from "./openai-fixtures.mjs";
import { AI_MAX_OUTPUT, AI_PRICES, MARK, MODEL_A, MODEL_B, fakeImage, sampleContract, seedCopy, seedDeal, setupAi } from "./work-ai-test-kit.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { NOW, ORIGIN, authenticate, nextUuid, rows, signToken, work } from "./work-test-kit.mjs";

const DAY = "2026-11-17"; // NOW의 한국 날짜
const MINUTE = 60_000;
const usageRows = (database) => rows(database, "SELECT day, create_requests, estimated_cost_micro_usd, input_tokens, output_tokens FROM ai_usage_daily ORDER BY day");
const jobRows = (database) => rows(database, "SELECT * FROM ai_jobs ORDER BY created_at, group_id, run_index");
const audits = (database, action) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events WHERE action = ? ORDER BY seq", action);
const count = (database, table) => rows(database, `SELECT count(*) AS n FROM ${table}`)[0].n;
// 두 요청의 예약 비용(1회째 모델 A, 2회째 모델 B).
const reservedFor = (pages, detail = "high", models = [MODEL_A, MODEL_B]) => [1, 2].map((runIndex, index) => estimateCostMicroUsd(AI_PRICES[models[index]], estimateContractInputTokens(runIndex, pages, detail), AI_MAX_OUTPUT));
const reservedTokens = (pages, detail = "high") => [1, 2].map((runIndex) => estimateContractInputTokens(runIndex, pages, detail));
const post = (ctx, ai, options = {}) => work(ctx.env, "/ai/jobs", { method: "POST", body: ctx.body, openaiFetch: ai?.fetcher, ...options });
const getGroup = (ctx, groupId, ai, options = {}) => work(ctx.env, `/ai/jobs/${groupId}`, { openaiFetch: ai?.fetcher, ...options });
const cancel = (ctx, groupId, ai, options = {}) => work(ctx.env, `/ai/jobs/${groupId}/cancel`, { method: "POST", body: {}, openaiFetch: ai?.fetcher, ...options });
const twoCreated = () => scriptedOpenAi([{ kind: "create", respond: created("resp_a1", "in_progress") }, { kind: "create", respond: created("resp_b1", "in_progress") }]);
// 만든 뒤 조회 차례를 이어 붙인 가짜 OpenAI.
const script = (steps) => scriptedOpenAi([{ kind: "create", respond: created("resp_a1", "in_progress") }, { kind: "create", respond: created("resp_b1", "in_progress") }, ...steps]);
const USAGE_A = { input_tokens: 9_000, output_tokens: 3_000 };
const USAGE_B = { input_tokens: 9_100, output_tokens: 3_100 };
const ACTUAL_A = estimateCostMicroUsd(AI_PRICES[MODEL_A], 9_000, 3_000);
const ACTUAL_B = estimateCostMicroUsd(AI_PRICES[MODEL_B], 9_100, 3_100);
const noTokens = (value) => assert.equal(/token/iu.test(JSON.stringify(value)), false, "응답에 토큰 수를 내보내지 않음");

// ── 켜기 값·설정 ──

test("AI 켜기 값·키·파일 기능·사진 세부도 가운데 하나라도 없으면 /ai/*는 503 AI_DISABLED이고 D1 쓰기·R2·OpenAI가 0번이다", async (t) => {
  installNetworkTrap(t);
  const variants = {
    "켜기 값 없음": { WORK_AI_ENABLED: undefined },
    "켜기 값 false": { WORK_AI_ENABLED: "false" },
    "켜기 값 TRUE(대문자)": { WORK_AI_ENABLED: "TRUE" },
    "키 없음": { OPENAI_API_KEY: undefined },
    "파일 기능 꺼짐": { WORK_FILES_ENABLED: undefined },
    "기본 모델 없음": { OPENAI_MODEL: undefined },
    "추론 없음": { OPENAI_REASONING_EFFORT: undefined },
    "출력 상한 없음": { OPENAI_MAX_OUTPUT_TOKENS: undefined },
    "사진 세부도 없음": { OPENAI_IMAGE_DETAIL: undefined },
    "사진 세부도 low": { OPENAI_IMAGE_DETAIL: "low" },
    "사진 세부도 auto": { OPENAI_IMAGE_DETAIL: "auto" },
  };
  for (const [label, extra] of Object.entries(variants)) {
    const ctx = await setupAi({ env: extra });
    const groupId = nextUuid();
    const calls = [
      await post(ctx),
      await work(ctx.env, `/ai/jobs?dealId=${ctx.dealId}`),
      await getGroup(ctx, groupId),
      await cancel(ctx, groupId),
    ];
    for (const { status, json } of calls) {
      assert.equal(status, 503, label);
      assert.equal(json.error.code, "AI_DISABLED", label);
    }
    assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "audit_events") + count(ctx.database, "ai_usage_daily"), 0, `${label}: D1 쓰기 0`);
    assert.deepEqual(ctx.r2.calls, [], `${label}: R2 0번`);
    const session = await work(ctx.env, "/session");
    assert.equal(session.json.data.aiEnabled, false, label);
    assert.deepEqual(session.json.data.aiWarnings, [], label);
  }
});

test("설정 모델이 단가표에 없으면 503 AI_CONFIG_INVALID이고 세션 aiEnabled는 거짓이다(비용을 계산하지 못한 채 보내지 않음)", async (t) => {
  installNetworkTrap(t);
  for (const extra of [{ OPENAI_MODEL_CONTRACT_B: "gpt-test-missing" }, { OPENAI_MODEL_CONTRACT_A: "gpt-test-missing" }, { OPENAI_PRICES_JSON: "{" }]) {
    const ctx = await setupAi({ env: extra });
    const { status, json } = await post(ctx);
    assert.equal(status, 503);
    assert.equal(json.error.code, "AI_CONFIG_INVALID");
    assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "audit_events"), 0);
    assert.deepEqual(ctx.r2.calls, []);
    assert.equal((await work(ctx.env, "/session")).json.data.aiEnabled, false);
  }
});

test("세션: 모두 설정되면 aiEnabled가 참이고, 교차 모델이 설정돼 있으면 aiWarnings는 비어 있다", async () => {
  const ctx = await setupAi();
  const { json } = await work(ctx.env, "/session");
  assert.equal(json.data.aiEnabled, true);
  assert.deepEqual(json.data.aiWarnings, []);
  assert.deepEqual(Object.keys(json.data), ["enabled", "filesEnabled", "aiEnabled", "administrator", "csrfToken", "schemaVersion", "aiWarnings"]);
});

// ── 만들기 ──

test("만들기: 201, 두 요청은 background·store:false·strict 스키마·사진 data URL이고 2회째는 칸 순서가 다르며, ai.create 감사가 OpenAI 호출보다 먼저 적힌다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi({ pages: 0 });
  // 조각 경계(24,576바이트)를 넘는 사진과 작은 사진.
  const images = [fakeImage(60_001, 1), fakeImage(301, 2)];
  const fileIds = [await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, bytes: images[0] }), await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, bytes: images[1], mime: "image/webp" })];
  // 쪽 순서는 요청한 순서(뒤에 올린 것을 1쪽으로).
  const body = { kind: "contract_schedule", fileIds: [fileIds[1], fileIds[0]], dealId: ctx.dealId };
  const seenAudits = [];
  const seenJobs = [];
  const respond = (id) => () => {
    seenAudits.push(audits(ctx.database, "ai.create").length);
    seenJobs.push(count(ctx.database, "ai_jobs"));
    return created(id)();
  };
  const ai = scriptedOpenAi([{ kind: "create", respond: respond("resp_a1") }, { kind: "create", respond: respond("resp_b1") }]);
  const { status, json } = await work(ctx.env, "/ai/jobs", { method: "POST", body, openaiFetch: ai.fetcher });
  assert.equal(status, 201);
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(seenAudits, [1, 1], "감사는 첫 OpenAI 호출 전에 이미 있음");
  assert.deepEqual(seenJobs, [2, 2], "작업 2행도 OpenAI 호출 전에 있음");

  const [first, second] = ai.calls;
  for (const [index, call] of [first, second].entries()) {
    assert.equal(call.kind, "create");
    assert.equal(call.authIsFakeKey, true);
    assert.equal(call.hasSignal, true, "시간 제한 신호");
    assert.equal(call.body.background, true);
    assert.equal(call.body.store, false);
    assert.equal(call.body.model, [MODEL_A, MODEL_B][index]);
    assert.deepEqual(call.body.reasoning, { effort: "max" });
    assert.equal(call.body.max_output_tokens, AI_MAX_OUTPUT);
    assert.equal(call.body.instructions, contractInstructions(index + 1));
    assert.equal(call.body.text.format.type, "json_schema");
    assert.equal(call.body.text.format.name, "contract_schedule");
    assert.equal(call.body.text.format.strict, true);
    assert.deepEqual(Object.keys(call.body.text.format.schema.properties), [...contractFieldOrder(index + 1)]);
    assert.deepEqual(call.body.input, [{
      role: "user",
      content: [
        { type: "input_text", text: "1쪽" },
        { type: "input_image", image_url: `data:image/webp;base64,${Buffer.from(images[1]).toString("base64")}`, detail: "high" },
        { type: "input_text", text: "2쪽" },
        { type: "input_image", image_url: `data:image/jpeg;base64,${Buffer.from(images[0]).toString("base64")}`, detail: "high" },
      ],
    }]);
    assert.deepEqual(Object.keys(call.body).sort(), ["background", "input", "instructions", "max_output_tokens", "model", "reasoning", "store", "text"]);
  }
  assert.notDeepEqual(Object.keys(first.body.text.format.schema.properties), Object.keys(second.body.text.format.schema.properties), "2회째는 칸 순서가 다른 스키마");
  assert.notEqual(first.body.instructions, second.body.instructions, "2회째는 칸 순서가 다른 지시문");
  assert.deepEqual(ctx.r2.calls.map(([action]) => action), ["get", "get"], "사진은 한 번씩만 읽음(두 요청이 같은 글을 씀)");

  const jobs = jobRows(ctx.database);
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].group_id, jobs[1].group_id);
  assert.deepEqual(jobs.map((row) => [row.run_index, row.pair_mode, row.kind, row.status, row.openai_response_id, row.model, row.reasoning_effort]), [
    [1, "cross", "contract_schedule", "queued", "resp_a1", MODEL_A, "max"],
    [2, "cross", "contract_schedule", "queued", "resp_b1", MODEL_B, "max"],
  ]);
  for (const row of jobs) {
    assert.equal(row.input_file_ids, JSON.stringify(body.fileIds));
    assert.equal(row.lease_until, new Date(NOW + 60 * MINUTE).toISOString());
    assert.equal(row.result_json, null);
    assert.equal(row.confirmed_at, null);
  }
  const tokens = reservedTokens(2);
  assert.deepEqual(jobs.map((row) => [row.input_tokens, row.output_tokens]), [[tokens[0], AI_MAX_OUTPUT], [tokens[1], AI_MAX_OUTPUT]], "열린 행의 토큰 칸 = 예약값");
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }]);

  assert.deepEqual(json.data, {
    groupId: jobs[0].group_id,
    pairMode: "cross",
    jobs: [
      { id: jobs[0].id, runIndex: 1, model: MODEL_A, status: "queued", errorCode: null },
      { id: jobs[1].id, runIndex: 2, model: MODEL_B, status: "queued", errorCode: null },
    ],
  });
  noTokens(json.data);
  assert.deepEqual(audits(ctx.database, "ai.create"), [{ action: "ai.create", target_type: "ai_job_group", target_id: jobs[0].group_id, outcome: "ok", reason: "kind=contract_schedule;files=2;pair=cross" }]);
});

test("만들기: 가림 확인 없는 파일·다른 종류·다른 거래 파일·없는 파일·없는 거래는 모두 같은 404이고 R2·OpenAI·한도에 손대지 않는다", async (t) => {
  installNetworkTrap(t);
  const cases = {
    "가림 확인 없음": async (ctx) => ({ ...ctx.body, fileIds: [ctx.fileIds[0], await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, rrnMasked: 0 })] }),
    "계약서 사본이 아닌 종류": async (ctx) => ({ ...ctx.body, fileIds: [await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, kind: "other" })] }),
    "다른 거래의 파일": async (ctx) => ({ ...ctx.body, fileIds: [ctx.fileIds[0], await seedCopy(ctx.database, ctx.r2, { dealId: seedDeal(ctx.database) })] }),
    "없는 파일(휴지통에 간 파일도 행이 없어 같음)": async (ctx) => ({ ...ctx.body, fileIds: [ctx.fileIds[0], nextUuid()] }),
    "없는 거래": async (ctx) => ({ ...ctx.body, dealId: nextUuid() }),
    "거래는 있지만 파일이 그 거래 것이 아님": async (ctx) => ({ ...ctx.body, dealId: seedDeal(ctx.database) }),
  };
  const bodies = [];
  for (const [label, makeBody] of Object.entries(cases)) {
    const ctx = await setupAi();
    const { status, json } = await work(ctx.env, "/ai/jobs", { method: "POST", body: await makeBody(ctx) });
    assert.equal(status, 404, label);
    assert.equal(json.error.code, "NOT_FOUND", label);
    bodies.push(JSON.stringify({ ...json, requestId: null }));
    assert.deepEqual(ctx.r2.calls, [], `${label}: R2 0번`);
    assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily") + count(ctx.database, "audit_events"), 0, label);
  }
  assert.equal(new Set(bodies).size, 1, "어느 조건인지 응답으로 구분할 수 없음");
});

test("만들기: R2에 객체가 없으면 404 + 고정 코드 경고 로그, R2가 실패하면 503 FILE_STORAGE_FAILED이고 한도·작업·OpenAI는 0이다", async (t) => {
  installNetworkTrap(t);
  const missing = await setupAi({ pages: 1 });
  missing.body.fileIds.push(await seedCopy(missing.database, missing.r2, { dealId: missing.dealId, putObject: false }));
  const logs = [];
  const gone = await post(missing, null, { auditLog: (entry) => logs.push(entry) });
  assert.equal(gone.status, 404);
  assert.equal(gone.json.error.code, "NOT_FOUND");
  assert.equal(JSON.stringify(gone.json).includes(MARK.key), false, "오류 응답에 R2 키 없음");
  const warn = logs.filter((entry) => entry.code === "FILE_OBJECT_MISSING");
  assert.equal(warn.length, 1);
  assert.deepEqual(Object.keys(warn[0]).sort(), ["code", "event", "level", "requestId"], "키·파일 번호 없이 고정 코드만");
  assert.equal(JSON.stringify(logs).includes(MARK.key), false);
  assert.equal(count(missing.database, "ai_jobs") + count(missing.database, "ai_usage_daily"), 0, "예약 전이라 되돌릴 것이 없음");

  const broken = await setupAi();
  broken.r2.fail.get = true;
  const failed = await post(broken);
  assert.equal(failed.status, 503);
  assert.equal(failed.json.error.code, "FILE_STORAGE_FAILED");
  assert.equal(JSON.stringify(failed.json).includes(MARK.key), false, "오류 응답에 R2 키 없음");
  assert.equal(count(broken.database, "ai_jobs") + count(broken.database, "ai_usage_daily"), 0);
});

test("만들기: 6장이거나 합계 12MB를 넘으면 413 AI_INPUT_TOO_LARGE이고 R2·OpenAI를 부르지 않는다", async (t) => {
  installNetworkTrap(t);
  const many = await setupAi({ pages: AI_MAX_FILES + 1 });
  const sixth = await post(many);
  assert.equal(sixth.status, 413);
  assert.equal(sixth.json.error.code, "AI_INPUT_TOO_LARGE");
  assert.deepEqual(many.r2.calls, []);

  const heavy = await setupAi({ pages: 0 });
  const half = AI_MAX_TOTAL_BYTES / 2;
  heavy.body.fileIds.push(await seedCopy(heavy.database, heavy.r2, { dealId: heavy.dealId, byteSize: half }), await seedCopy(heavy.database, heavy.r2, { dealId: heavy.dealId, byteSize: half + 1 }));
  const over = await post(heavy);
  assert.equal(over.status, 413);
  assert.equal(over.json.error.code, "AI_INPUT_TOO_LARGE");
  assert.deepEqual(heavy.r2.calls, []);
  assert.equal(count(heavy.database, "ai_jobs") + count(heavy.database, "ai_usage_daily"), 0);

  const five = await setupAi({ pages: AI_MAX_FILES });
  assert.equal((await post(five, twoCreated())).status, 201, "5장은 받음");
});

test("만들기: 본문 꼴이 틀리면 400이고 D1·R2·OpenAI를 부르지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const bad = {
    kind: { ...ctx.body, kind: "registry_message" },
    fileIds: { ...ctx.body, fileIds: [] },
    "fileIds ": { ...ctx.body, fileIds: [ctx.fileIds[0], ctx.fileIds[0]] },
    "fileIds  ": { ...ctx.body, fileIds: ["not-a-uuid"] },
    "fileIds   ": { ...ctx.body, fileIds: ctx.fileIds[0] },
    dealId: { kind: ctx.body.kind, fileIds: ctx.fileIds },
    body: { ...ctx.body, options: { detail: "low" } },
  };
  for (const [field, body] of Object.entries(bad)) {
    const { status, json } = await work(ctx.env, "/ai/jobs", { method: "POST", body });
    assert.equal(status, 400, field);
    assert.equal(json.error.code, "VALIDATION_FAILED");
    assert.deepEqual(json.error.details, [field.trim()]);
  }
  assert.deepEqual(ctx.r2.calls, []);
  assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily"), 0);
});

test("만들기: 같은 거래에 진행 중 묶음이 있으면 409 AI_JOB_ACTIVE(details에 그 묶음)이고 R2·OpenAI·한도에 손대지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = twoCreated();
  const first = await post(ctx, ai);
  assert.equal(first.status, 201);
  const usage = usageRows(ctx.database);
  ctx.r2.calls.length = 0;
  const second = await post(ctx, ai);
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "AI_JOB_ACTIVE");
  assert.deepEqual(second.json.error.details, [first.json.data.groupId]);
  assert.equal(ai.calls.length, 2, "둘째 요청은 OpenAI 0번");
  assert.deepEqual(ctx.r2.calls, []);
  assert.deepEqual(usageRows(ctx.database), usage);
  assert.equal(count(ctx.database, "ai_jobs"), 2);

  // 다른 거래는 막지 않는다.
  const otherDeal = seedDeal(ctx.database);
  const otherFile = await seedCopy(ctx.database, ctx.r2, { dealId: otherDeal });
  const other = await work(ctx.env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds: [otherFile], dealId: otherDeal }, openaiFetch: twoCreated().fetcher });
  assert.equal(other.status, 201);
});

test("만들기 경합: 미리 확인을 둘 다 지난 동시 2건 가운데 1건만 201이고, 진 쪽은 한도를 되돌린 뒤 409이며 OpenAI는 모두 2번뿐이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = twoCreated();
  let winner;
  // 첫 요청이 작업 행을 넣기(batch) 직전에 둘째 요청이 끝까지 지나간다(둘 다 "진행 중 없음"을 본 뒤).
  ctx.db.beforeNextBatch = async () => {
    winner = await post(ctx, ai);
  };
  const loser = await post(ctx, ai);
  assert.equal(winner.status, 201);
  assert.equal(loser.status, 409);
  assert.equal(loser.json.error.code, "AI_JOB_ACTIVE");
  assert.deepEqual(loser.json.error.details, [winner.json.data.groupId]);
  assert.equal(ai.calls.length, 2, "가짜 fetcher 호출 2번(이긴 쪽의 두 요청뿐)");
  assert.deepEqual(ai.violations, []);
  const jobs = jobRows(ctx.database);
  assert.equal(jobs.length, 2);
  assert.ok(jobs.every((row) => row.group_id === winner.json.data.groupId));
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }], "사용량은 한 묶음 몫만");
  assert.equal(audits(ctx.database, "ai.create").length, 1, "진 쪽은 감사도 남지 않음");
});

test("만들기 경합: 미리 확인한 뒤 파일이 지워지면 행을 넣지 않고 한도를 되돌린 뒤 404다(OpenAI 0번)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  ctx.db.beforeNextBatch = () => ctx.database.prepare("DELETE FROM files WHERE id = ?").run(ctx.fileIds[1]);
  const { status, json } = await post(ctx);
  assert.equal(status, 404);
  assert.equal(json.error.code, "NOT_FOUND");
  assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "audit_events"), 0);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 0, estimated_cost_micro_usd: 0, input_tokens: 0, output_tokens: 0 }]);
});

// ── 한도 ──

test("한도: 한도 행이 없으면 409 AI_LIMITS_MISSING이고 OpenAI 0번, 작업 0행이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi({ limits: null });
  const { status, json } = await post(ctx);
  assert.equal(status, 409);
  assert.equal(json.error.code, "AI_LIMITS_MISSING");
  assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily"), 0);
});

test("한도: 2회 몫이 모두 들어갈 때만 통과한다(하루 한도 3에서 1건 뒤 1건 더는 429 daily, 사용량 그대로, OpenAI 0번)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi({ limits: { daily: 3 } });
  assert.equal((await post(ctx, twoCreated())).status, 201);
  const usage = usageRows(ctx.database);
  assert.equal(usage[0].create_requests, 2);
  const otherDeal = seedDeal(ctx.database);
  const otherFile = await seedCopy(ctx.database, ctx.r2, { dealId: otherDeal });
  const second = await work(ctx.env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds: [otherFile], dealId: otherDeal } });
  assert.equal(second.status, 429);
  assert.equal(second.json.error.code, "AI_BUDGET_EXCEEDED");
  assert.deepEqual(second.json.error.details, ["daily"]);
  assert.deepEqual(usageRows(ctx.database), usage, "1회 몫만 들어가는 일은 없음");
  assert.equal(count(ctx.database, "ai_jobs"), 2);

  const one = await setupAi({ limits: { daily: 1 } });
  const first = await post(one);
  assert.equal(first.status, 429, "하루 한도 1이면 두 번 읽기는 처음부터 막힘");
  assert.deepEqual(usageRows(one.database), []);
});

test("한도: 이번 달 비용 + 두 요청의 최대 예상 비용이 월 한도를 넘으면 429 monthly다", async (t) => {
  installNetworkTrap(t);
  const reserved = reservedFor(2);
  const ctx = await setupAi({ limits: { monthly: reserved[0] + reserved[1] - 1 } });
  const { status, json } = await post(ctx);
  assert.equal(status, 429);
  assert.deepEqual(json.error.details, ["monthly"]);
  assert.deepEqual(usageRows(ctx.database), []);
  const exact = await setupAi({ limits: { monthly: reserved[0] + reserved[1] } });
  assert.equal((await post(exact, twoCreated())).status, 201, "딱 맞으면 통과");
});

test("한도: 글 초안과 같은 행에 쌓이고(1편 + 계약서 1건 = 3회), 한국 날짜 23:59와 00:00은 다른 날로 센다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  ctx.database.prepare("INSERT INTO ai_usage_daily (day, create_requests, estimated_cost_micro_usd) VALUES (?, 1, 500000)").run(DAY);
  assert.equal((await post(ctx, twoCreated())).status, 201);
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 3, estimated_cost_micro_usd: 500_000 + reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }]);

  const edge = await setupAi();
  const beforeMidnight = Date.parse("2026-11-17T14:59:59.000Z"); // 한국 23:59:59
  const afterMidnight = Date.parse("2026-11-17T15:00:00.000Z"); // 한국 다음 날 00:00:00
  assert.equal((await post(edge, twoCreated(), { now: beforeMidnight })).status, 201);
  const otherDeal = seedDeal(edge.database);
  const otherFile = await seedCopy(edge.database, edge.r2, { dealId: otherDeal });
  const next = await work(edge.env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds: [otherFile], dealId: otherDeal }, openaiFetch: twoCreated().fetcher, now: afterMidnight });
  assert.equal(next.status, 201);
  assert.deepEqual(usageRows(edge.database).map((row) => [row.day, row.create_requests]), [["2026-11-17", 2], ["2026-11-18", 2]]);
});

// ── 교차 모델(14.2절) ──

test("교차 모델: B가 비면 두 행이 same_unset이고 세션에 CONTRACT_CROSS_MODEL_UNSET, 운영자가 고른 뒤(false)면 same_chosen이고 경고가 없다", async (t) => {
  installNetworkTrap(t);
  const unset = await setupAi({ env: { OPENAI_MODEL_CONTRACT_B: undefined } });
  assert.deepEqual((await work(unset.env, "/session")).json.data.aiWarnings, ["CONTRACT_CROSS_MODEL_UNSET"]);
  const ai = twoCreated();
  const made = await post(unset, ai);
  assert.equal(made.json.data.pairMode, "same_unset");
  assert.deepEqual(jobRows(unset.database).map((row) => [row.pair_mode, row.model]), [["same_unset", MODEL_A], ["same_unset", MODEL_A]]);
  assert.deepEqual(ai.calls.map((call) => call.body.model), [MODEL_A, MODEL_A]);
  assert.notEqual(ai.calls[0].body.instructions, ai.calls[1].body.instructions, "같은 모델이어도 2회째는 칸 순서가 다름");
  assert.equal(audits(unset.database, "ai.create")[0].reason, "kind=contract_schedule;files=2;pair=same_unset");

  const chosen = await setupAi({ env: { OPENAI_MODEL_CONTRACT_B: "" } });
  chosen.database.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('contract_cross_model_required', 'false', ?)").run(new Date(NOW).toISOString());
  assert.deepEqual((await work(chosen.env, "/session")).json.data.aiWarnings, []);
  assert.equal((await post(chosen, twoCreated())).json.data.pairMode, "same_chosen");

  // 행이 있어도 정확히 false가 아니면 고른 것으로 보지 않는다.
  const notFalse = await setupAi({ env: { OPENAI_MODEL_CONTRACT_B: undefined } });
  notFalse.database.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('contract_cross_model_required', '0', ?)").run(new Date(NOW).toISOString());
  assert.deepEqual((await work(notFalse.env, "/session")).json.data.aiWarnings, ["CONTRACT_CROSS_MODEL_UNSET"]);
});

// ── 한쪽만 성공 ──

test("한쪽만: 1회째가 만들어지고 2회째가 429면 201이고, 2회째는 failed로 그 몫만 되돌린다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = scriptedOpenAi([{ kind: "create", respond: created("resp_a1") }, { kind: "create", respond: httpError(429) }]);
  const { status, json } = await post(ctx, ai);
  assert.equal(status, 201);
  assert.deepEqual(json.data.jobs.map((job) => [job.runIndex, job.status, job.errorCode]), [[1, "queued", null], [2, "failed", "AI_RATE_LIMITED"]]);
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 1, estimated_cost_micro_usd: reserved[0], input_tokens: 0, output_tokens: 0 }]);
  const jobs = jobRows(ctx.database);
  assert.deepEqual([jobs[1].input_tokens, jobs[1].output_tokens], [null, null], "닫힌 행에 예약값이 남지 않음");
  assert.equal(jobs[0].input_tokens, reservedTokens(2)[0]);
});

test("한쪽만: 1회째가 401로 거절돼도 2회째를 보내고, 만들어진 쪽만 진행한다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = scriptedOpenAi([{ kind: "create", respond: httpError(401) }, { kind: "create", respond: created("resp_b1") }]);
  const { status, json } = await post(ctx, ai);
  assert.equal(status, 201);
  assert.deepEqual(json.data.jobs.map((job) => [job.status, job.errorCode]), [["failed", "AI_CONFIG_INVALID"], ["queued", null]]);
  assert.deepEqual(usageRows(ctx.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd]), [[1, reservedFor(2)[1]]]);
});

test("둘 다 429면 429 AI_RATE_LIMITED이고 호출은 정확히 2번(재시도 0회), 한도는 모두 되돌린다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = scriptedOpenAi([{ kind: "create", respond: httpError(429) }, { kind: "create", respond: httpError(429) }]);
  const { status, json } = await post(ctx, ai);
  assert.equal(status, 429);
  assert.equal(json.error.code, "AI_RATE_LIMITED");
  assert.equal(ai.calls.length, 2);
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 0, estimated_cost_micro_usd: 0, input_tokens: 0, output_tokens: 0 }]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.error_code, row.input_tokens]), [["failed", "AI_RATE_LIMITED", null], ["failed", "AI_RATE_LIMITED", null]]);
  // 진행 중이 아니므로 다시 만들 수 있다.
  assert.equal((await post(ctx, twoCreated())).status, 201);
});

test("시간 초과·5xx·네트워크 오류는 만들어졌는지 모르는 것: unknown으로 닫고 한도를 되돌리지 않으며 502 AI_STATE_UNKNOWN이다", async (t) => {
  installNetworkTrap(t);
  for (const [one, two] of [[timeoutError(), httpError(500)], [networkError(), networkError()], [httpError(429), httpError(503)]]) {
    const ctx = await setupAi();
    const ai = scriptedOpenAi([{ kind: "create", respond: one }, { kind: "create", respond: two }]);
    const { status, json } = await post(ctx, ai);
    assert.equal(status, 502);
    assert.equal(json.error.code, "AI_STATE_UNKNOWN");
    assert.equal(ai.calls.length, 2, "다시 보내지 않음");
    const jobs = jobRows(ctx.database);
    assert.equal(jobs[1].status, "unknown");
    assert.equal(jobs[1].error_code, "AI_STATE_UNKNOWN");
    assert.deepEqual(jobs.map((row) => [row.input_tokens, row.output_tokens]), [[null, null], [null, null]], "unknown 행의 토큰 칸은 비움");
    const reserved = reservedFor(2);
    const kept = jobs.reduce((sum, row, index) => sum + (row.status === "unknown" ? reserved[index] : 0), 0);
    assert.deepEqual(usageRows(ctx.database).map((row) => [row.create_requests, row.estimated_cost_micro_usd]), [[jobs.filter((row) => row.status === "unknown").length, kept]], "unknown 몫은 되돌리지 않음");
  }
});

// ── 결과 ──

test("조회: 진행 중이면 running이고 결과·열람 감사가 없으며, 둘 다 끝나면 ready로 결과를 주고 실제 토큰으로 한 번만 정산한다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([
    { kind: "retrieve", respond: pending("resp_a1", "in_progress") },
    { kind: "retrieve", respond: pending("resp_b1", "queued") },
    { kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) },
    { kind: "retrieve", respond: completed("resp_b1", Object.fromEntries(contractFieldOrder(2).map((key) => [key, sampleContract()[key]])), USAGE_B) },
  ]);
  const made = await post(ctx, ai);
  const { groupId } = made.json.data;

  const running = await getGroup(ctx, groupId, ai);
  assert.equal(running.status, 200);
  assert.equal(running.json.data.group.status, "running");
  assert.deepEqual(running.json.data.jobs.map((job) => [job.status, job.result]), [["in_progress", null], ["queued", null]]);
  assert.deepEqual(audits(ctx.database, "ai.view"), [], "결과가 없는 응답은 열람 감사를 남기지 않음");
  const reserved = reservedFor(2);
  assert.equal(usageRows(ctx.database)[0].estimated_cost_micro_usd, reserved[0] + reserved[1], "진행 중에는 예약 그대로");

  const ready = await getGroup(ctx, groupId, ai, { now: NOW + MINUTE });
  assert.equal(ready.json.data.group.status, "ready");
  assert.deepEqual(ready.json.data.group, { id: groupId, kind: "contract_schedule", dealId: ctx.dealId, status: "ready", pairMode: "cross", createdAt: new Date(NOW).toISOString(), confirmedAt: null });
  assert.deepEqual(ready.json.data.jobs.map((job) => [job.runIndex, job.model, job.reasoningEffort, job.status, job.errorCode, job.maskedCount]), [
    [1, MODEL_A, "max", "completed", null, 0],
    [2, MODEL_B, "max", "completed", null, 0],
  ]);
  for (const job of ready.json.data.jobs) {
    assert.deepEqual(job.result, sampleContract());
    assert.deepEqual(Object.keys(job.result), [...CONTRACT_FIELD_ORDER], "2회째도 저장할 때 칸 순서를 맞춤");
  }
  noTokens(ready.json.data.jobs.map(({ result: _result, ...rest }) => rest));
  const settled = [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: ACTUAL_A + ACTUAL_B, input_tokens: 18_100, output_tokens: 6_100 }];
  assert.deepEqual(usageRows(ctx.database), settled);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.input_tokens, row.output_tokens]), [[9_000, 3_000], [9_100, 3_100]], "닫힌 행의 토큰 칸 = 실제 사용량");
  assert.deepEqual(JSON.parse(jobRows(ctx.database)[0].result_json), { maskedCount: 0, result: sampleContract() });

  // 다시 조회: OpenAI 0번, 사용량 그대로, 결과가 담긴 응답마다 열람 감사 1줄.
  const again = await getGroup(ctx, groupId, ai, { now: NOW + 2 * MINUTE });
  assert.equal(again.json.data.group.status, "ready");
  assert.equal(ai.remaining(), 0);
  assert.equal(ai.calls.length, 6);
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(usageRows(ctx.database), settled, "두 번 조회해도 한 번만 정산");
  assert.deepEqual(audits(ctx.database, "ai.view"), Array.from({ length: 2 }, () => ({ action: "ai.view", target_type: "ai_job_group", target_id: groupId, outcome: "ok", reason: "kind=contract_schedule;results=2" })));
});

test("조회: 한쪽이 끝나도 다른 쪽이 진행 중이면 결과를 싣지 않고, 한쪽 completed·한쪽 failed면 ready로 한쪽 결과만 준다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([
    { kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) },
    { kind: "retrieve", respond: pending("resp_b1") },
    { kind: "retrieve", respond: incomplete("resp_b1") },
  ]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const half = await getGroup(ctx, groupId, ai);
  assert.equal(half.json.data.group.status, "running");
  assert.deepEqual(half.json.data.jobs.map((job) => [job.status, job.result]), [["completed", null], ["in_progress", null]]);
  assert.deepEqual(audits(ctx.database, "ai.view"), []);

  const done = await getGroup(ctx, groupId, ai);
  assert.equal(done.json.data.group.status, "ready");
  assert.deepEqual(done.json.data.jobs.map((job) => [job.status, job.errorCode, job.result === null]), [["completed", null, false], ["failed", "AI_RESULT_INCOMPLETE", true]]);
  assert.equal(audits(ctx.database, "ai.view")[0].reason, "kind=contract_schedule;results=1");
});

test("정산은 갈래마다 한 번: 화면 조회와 1분 예약이 같은 결과를 동시에 받아도 사용량은 한 번만 바뀐다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([
    // 화면 조회가 1회째를 받고 → (적기 직전) 예약이 둘 다 받아 먼저 적고 → 화면 조회가 2회째를 받는다.
    { kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) },
    { kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) },
    { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) },
    { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) },
  ]);
  const { groupId } = (await post(ctx, ai)).json.data;
  let cron;
  ctx.db.beforeNextBatch = async () => {
    cron = await runAiPollCron(ctx.env, { now: () => NOW + MINUTE, openaiFetch: ai.fetcher, log: () => {} });
  };
  const view = await getGroup(ctx, groupId, ai, { now: NOW + MINUTE });
  assert.deepEqual(cron, { outcome: "ok", polled: 2, changed: 2, failed: 0 });
  assert.equal(view.json.data.group.status, "ready");
  assert.equal(ai.remaining(), 0);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: ACTUAL_A + ACTUAL_B, input_tokens: 18_100, output_tokens: 6_100 }]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.input_tokens, row.output_tokens]), [["completed", 9_000, 3_000], ["completed", 9_100, 3_100]]);
});

test("결과 검사: 칸 누락·추가 칸·없는 날짜·음수 금액·거절·JSON 아님은 AI_RESULT_INVALID이고 원문을 저장하지 않으며 실제 토큰으로 정산한다", async (t) => {
  installNetworkTrap(t);
  const { balance: _balance, ...missing } = sampleContract();
  const bad = {
    "칸 누락": completed("resp_a1", missing, USAGE_A),
    "추가 칸": completed("resp_a1", { ...sampleContract(), buyer_name: "ZZNAME" }, USAGE_A),
    "없는 날짜": completed("resp_a1", sampleContract({ contract_date: { value: "2026-02-30", evidence: { page: 1, quote: "", box: null } } }), USAGE_A),
    "음수 금액": completed("resp_a1", sampleContract({ price_won: { value: -1, evidence: { page: 1, quote: "", box: null } } }), USAGE_A),
    "JSON 아님": completed("resp_a1", "ZZRAW 계약서 원문처럼 보이는 글", USAGE_A),
    거절: refusal("resp_a1"),
  };
  for (const [label, respond] of Object.entries(bad)) {
    const ctx = await setupAi();
    const ai = script([{ kind: "retrieve", respond }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
    const { groupId } = (await post(ctx, ai)).json.data;
    const { json } = await getGroup(ctx, groupId, ai);
    assert.equal(json.data.group.status, "ready", label);
    assert.deepEqual(json.data.jobs.map((job) => [job.status, job.errorCode, job.result === null]), [["failed", "AI_RESULT_INVALID", true], ["completed", null, false]], label);
    const jobs = jobRows(ctx.database);
    assert.equal(jobs[0].result_json, null, `${label}: 원문 저장 없음`);
    assert.equal(JSON.stringify(jobs).includes("ZZRAW") || JSON.stringify(jobs).includes("ZZNAME"), false, label);
    assert.equal(usageRows(ctx.database)[0].create_requests, 2, label);
    if (label !== "거절") assert.equal(usageRows(ctx.database)[0].estimated_cost_micro_usd, ACTUAL_A + ACTUAL_B, `${label}: 실패한 결과도 실제 비용으로 정산`);
  }
});

test("결과: incomplete는 AI_RESULT_INCOMPLETE, OpenAI failed는 AI_UPSTREAM_FAILED이고 둘 다 failed면 묶음은 failed다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "retrieve", respond: incomplete("resp_a1") }, { kind: "retrieve", respond: failedResponse("resp_b1") }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const { json } = await getGroup(ctx, groupId, ai);
  assert.equal(json.data.group.status, "failed");
  assert.deepEqual(json.data.jobs.map((job) => [job.status, job.errorCode]), [["failed", "AI_RESULT_INCOMPLETE"], ["failed", "AI_UPSTREAM_FAILED"]]);
  assert.deepEqual(audits(ctx.database, "ai.view"), []);
});

test("결과: 주민번호 꼴은 가려서 저장하고 maskedCount로 알린다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const leaked = sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "가상 900101-1234567 작성", box: null } }, warnings: ["가상 8002022345678"] });
  const ai = script([{ kind: "retrieve", respond: completed("resp_a1", leaked, USAGE_A) }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const { json } = await getGroup(ctx, groupId, ai);
  assert.deepEqual(json.data.jobs.map((job) => job.maskedCount), [2, 0]);
  const stored = JSON.stringify(jobRows(ctx.database)) + JSON.stringify(json);
  for (const raw of ["900101-1234567", "8002022345678"]) assert.equal(stored.includes(raw), false, raw);
});

test("결과: 사용량이 없는 응답은 예약한 비용을 그대로 두고 행의 토큰 칸을 비운다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const noUsage = () => new Response(JSON.stringify({ id: "resp_a1", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(sampleContract()) }] }] }), { status: 200, headers: { "Content-Type": "application/json" } });
  const ai = script([{ kind: "retrieve", respond: noUsage }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  await getGroup(ctx, groupId, ai);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reservedFor(2)[0] + ACTUAL_B, input_tokens: 9_100, output_tokens: 3_100 }]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.input_tokens, row.output_tokens]), [["completed", null, null], ["completed", 9_100, 3_100]]);
});

// ── 만료·취소 ──

test("만료: 10분 지난 뒤 OpenAI가 404면 expired(AI_RESULT_EXPIRED), 10분 안의 404는 unknown이고 둘 다 한도를 되돌리지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "retrieve", respond: httpError(404) }, { kind: "retrieve", respond: pending("resp_b1") }, { kind: "retrieve", respond: httpError(404) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const early = await getGroup(ctx, groupId, ai, { now: NOW + 5 * MINUTE });
  assert.deepEqual(early.json.data.jobs.map((job) => [job.status, job.errorCode]), [["unknown", "AI_STATE_UNKNOWN"], ["in_progress", null]]);
  const late = await getGroup(ctx, groupId, ai, { now: NOW + 11 * MINUTE });
  assert.deepEqual(late.json.data.jobs.map((job) => [job.status, job.errorCode]), [["unknown", "AI_STATE_UNKNOWN"], ["expired", "AI_RESULT_EXPIRED"]]);
  assert.equal(late.json.data.group.status, "failed");
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.input_tokens, row.output_tokens]), [[null, null], [null, null]]);
});

test("만료: 응답 ID를 적지 못한 행은 10분 동안 그대로 두고(OpenAI 0번), 10분이 지나면 unknown으로 닫는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = twoCreated();
  const { groupId } = (await post(ctx, ai)).json.data;
  ctx.database.prepare("UPDATE ai_jobs SET openai_response_id = NULL, status = 'queued'").run();
  const early = await getGroup(ctx, groupId, ai, { now: NOW + 9 * MINUTE });
  assert.equal(early.json.data.group.status, "running");
  const late = await getGroup(ctx, groupId, ai, { now: NOW + 10 * MINUTE + 1 });
  assert.deepEqual(late.json.data.jobs.map((job) => [job.status, job.errorCode]), [["unknown", "AI_STATE_UNKNOWN"], ["unknown", "AI_STATE_UNKNOWN"]]);
  assert.equal(ai.calls.length, 2, "조회는 OpenAI를 부르지 않음");
});

test("만료: 60분이 지나도 끝나지 않은 작업은 unknown(AI_LEASE_EXPIRED)으로 닫아 끝없이 조회하지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([
    { kind: "retrieve", respond: pending("resp_a1") }, { kind: "retrieve", respond: pending("resp_b1") },
    { kind: "retrieve", respond: pending("resp_a1") }, { kind: "retrieve", respond: httpError(500) }, { kind: "retrieve", respond: httpError(500) },
  ]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const before = await getGroup(ctx, groupId, ai, { now: NOW + 60 * MINUTE });
  assert.equal(before.json.data.group.status, "running");
  const after = await getGroup(ctx, groupId, ai, { now: NOW + 60 * MINUTE + 1 });
  assert.deepEqual(after.json.data.jobs.map((job) => [job.status, job.errorCode]), [["unknown", "AI_LEASE_EXPIRED"], ["unknown", "AI_LEASE_EXPIRED"]]);
  assert.equal(ai.remaining(), 0);
});

test("취소: 열린 행은 OpenAI 취소 뒤 cancelled, 두 번 눌러도 200이고 OpenAI 취소가 404·409여도 성공한다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "cancel", respond: httpError(404) }, { kind: "cancel", respond: httpError(409) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const first = await cancel(ctx, groupId, ai);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.data, { status: "cancelled" });
  assert.deepEqual(ai.calls.slice(2).map((call) => call.path), ["/responses/resp_a1/cancel", "/responses/resp_b1/cancel"]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.result_json, row.input_tokens, row.output_tokens]), [["cancelled", null, null, null], ["cancelled", null, null, null]]);
  assert.deepEqual(audits(ctx.database, "ai.cancel"), [{ action: "ai.cancel", target_type: "ai_job_group", target_id: groupId, outcome: "ok", reason: "kind=contract_schedule;open=2" }]);
  const reserved = reservedFor(2);
  assert.equal(usageRows(ctx.database)[0].estimated_cost_micro_usd, reserved[0] + reserved[1], "취소한 몫은 되돌리지 않음(이미 비용이 들었을 수 있음)");

  const second = await cancel(ctx, groupId, ai);
  assert.equal(second.status, 200);
  assert.deepEqual(second.json.data, { status: "cancelled" });
  assert.equal(ai.remaining(), 0);
  assert.equal(audits(ctx.database, "ai.cancel").length, 1, "두 번째는 감사도 남기지 않음");
  assert.equal((await getGroup(ctx, groupId, ai)).json.data.group.status, "cancelled");
  // 취소한 뒤에는 같은 거래로 다시 만들 수 있다.
  assert.equal((await post(ctx, twoCreated())).status, 201);
});

test("취소가 생성 요청과 겹치면: 방금 만들어진 OpenAI 작업을 취소하고, 4xx여도 닫힌 행의 몫은 되돌리지 않는다(되돌리기는 열린 행에 한 번만)", async (t) => {
  installNetworkTrap(t);
  const reserved = reservedFor(2);
  const kept = [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }];

  // 1회째 생성 요청이 가는 동안 다른 창에서 취소 → 두 요청 모두 만들어진 뒤 바로 취소된다.
  const ctx = await setupAi();
  let cancelled;
  const ai = scriptedOpenAi([
    { kind: "create", respond: async () => { cancelled = await cancel(ctx, jobRows(ctx.database)[0].group_id); return created("resp_a1")(); } },
    { kind: "cancel", respond: created("resp_a1", "cancelled") },
    { kind: "create", respond: created("resp_b1") },
    { kind: "cancel", respond: created("resp_b1", "cancelled") },
  ]);
  const made = await post(ctx, ai);
  assert.equal(cancelled.status, 200);
  assert.equal(made.status, 201);
  assert.deepEqual(made.json.data.jobs.map((job) => job.status), ["cancelled", "cancelled"]);
  assert.equal(ai.remaining(), 0);
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(ai.calls.map((call) => call.path), ["/responses", "/responses/resp_a1/cancel", "/responses", "/responses/resp_b1/cancel"]);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.openai_response_id, row.input_tokens]), [["cancelled", null, null], ["cancelled", null, null]]);
  assert.deepEqual(usageRows(ctx.database), kept);

  // 같은 겹침에서 OpenAI가 429로 거절: 행이 이미 닫혀 있어 되돌리지 않는다(많이 센 쪽으로 남김).
  const other = await setupAi();
  const refused = scriptedOpenAi([
    { kind: "create", respond: async () => { await cancel(other, jobRows(other.database)[0].group_id); return httpError(429)(); } },
    { kind: "create", respond: httpError(429) },
  ]);
  assert.equal((await post(other, refused)).status, 429);
  assert.deepEqual(jobRows(other.database).map((row) => [row.status, row.error_code]), [["cancelled", null], ["cancelled", null]]);
  assert.deepEqual(usageRows(other.database), kept);
});

test("취소: 끝났지만 확정 전인 묶음은 결과를 지우고(실제 토큰 칸은 그대로), 확정된 묶음은 409 AI_JOB_STATE_CONFLICT다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  await getGroup(ctx, groupId, ai);
  const usage = usageRows(ctx.database);
  const done = await cancel(ctx, groupId, ai);
  assert.equal(done.status, 200);
  assert.equal(ai.remaining(), 0, "끝난 작업은 OpenAI 취소를 부르지 않음");
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.result_json, row.input_tokens]), [["cancelled", null, 9_000], ["cancelled", null, 9_100]]);
  assert.deepEqual(usageRows(ctx.database), usage);
  const view = await getGroup(ctx, groupId, ai);
  assert.deepEqual(view.json.data.jobs.map((job) => job.result), [null, null]);

  const confirmed = await setupAi();
  const ai2 = script([{ kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
  const made = (await post(confirmed, ai2)).json.data;
  await getGroup(confirmed, made.groupId, ai2);
  confirmed.database.prepare("UPDATE ai_jobs SET confirmed_at = ?").run(new Date(NOW).toISOString());
  const refused = await cancel(confirmed, made.groupId, ai2);
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error.code, "AI_JOB_STATE_CONFLICT");
  assert.equal((await getGroup(confirmed, made.groupId, ai2)).json.data.group.status, "confirmed");
  assert.ok(jobRows(confirmed.database).every((row) => row.result_json !== null), "확정된 결과는 그대로");
});

test("취소: 본문이 {}가 아니면 400, OpenAI 취소가 429면 429이고 행은 그대로다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "cancel", respond: httpError(429) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  const bad = await work(ctx.env, `/ai/jobs/${groupId}/cancel`, { method: "POST", body: { force: true }, openaiFetch: ai.fetcher });
  assert.equal(bad.status, 400);
  const limited = await cancel(ctx, groupId, ai);
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, "AI_RATE_LIMITED");
  assert.deepEqual(jobRows(ctx.database).map((row) => row.status), ["in_progress", "in_progress"]);
  assert.deepEqual(audits(ctx.database, "ai.cancel"), []);
});

// ── 목록·경로 ──

test("목록: 그 거래의 최근 묶음 5개를 결과·토큰 없이 주고 OpenAI·감사를 쓰지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi({ limits: { daily: 20 } });
  const groupIds = [];
  for (let index = 0; index < 6; index += 1) {
    const ai = script([{ kind: "cancel", respond: httpError(404) }, { kind: "cancel", respond: httpError(404) }]);
    const now = NOW + index * MINUTE;
    const { groupId } = (await post(ctx, ai, { now })).json.data;
    groupIds.push(groupId);
    if (index < 5) await cancel(ctx, groupId, ai, { now });
  }
  const otherDeal = seedDeal(ctx.database);
  const otherFile = await seedCopy(ctx.database, ctx.r2, { dealId: otherDeal });
  await work(ctx.env, "/ai/jobs", { method: "POST", body: { kind: "contract_schedule", fileIds: [otherFile], dealId: otherDeal }, openaiFetch: twoCreated().fetcher });
  const auditsBefore = count(ctx.database, "audit_events");

  const { status, json } = await work(ctx.env, `/ai/jobs?dealId=${ctx.dealId}`);
  assert.equal(status, 200);
  assert.deepEqual(json.data.items.map((item) => [item.groupId, item.status]), groupIds.slice(1).reverse().map((id, index) => [id, index === 0 ? "running" : "cancelled"]));
  assert.deepEqual(Object.keys(json.data.items[0]), ["groupId", "status", "pairMode", "createdAt", "confirmedAt", "jobs"]);
  assert.deepEqual(Object.keys(json.data.items[0].jobs[0]), ["id", "runIndex", "model", "status", "errorCode"]);
  noTokens(json.data);
  assert.equal(count(ctx.database, "audit_events"), auditsBefore, "목록은 감사를 남기지 않음(결과 없음)");

  assert.equal((await work(ctx.env, "/ai/jobs")).status, 400);
  assert.equal((await work(ctx.env, "/ai/jobs?dealId=abc")).status, 400);
  assert.equal((await work(ctx.env, `/ai/jobs?dealId=${ctx.dealId}&x=1`)).status, 400);
  assert.equal((await work(ctx.env, `/ai/jobs?dealId=${nextUuid()}`)).status, 404);
  assert.deepEqual((await work(ctx.env, `/ai/jobs?dealId=${seedDeal(ctx.database)}`)).json.data, { items: [] });
});

test("경로: 없는 묶음·UUID가 아닌 값·확정 경로(/confirm, 다음 PR)는 404, 허용하지 않는 방식은 405다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  assert.equal((await getGroup(ctx, nextUuid())).status, 404);
  assert.equal((await getGroup(ctx, "not-a-uuid")).status, 404);
  assert.equal((await cancel(ctx, nextUuid())).status, 404);
  const confirm = await work(ctx.env, `/ai/jobs/${nextUuid()}/confirm`, { method: "POST", body: {} });
  assert.equal(confirm.status, 404);
  assert.equal((await work(ctx.env, "/ai/transcriptions", { method: "POST", body: {} })).status, 404);
  const put = await work(ctx.env, "/ai/jobs", { method: "PUT", body: {} });
  assert.equal(put.status, 405);
  assert.equal(put.response.headers.get("Allow"), "GET, POST");
  assert.equal((await work(ctx.env, `/ai/jobs/${nextUuid()}`, { method: "DELETE" })).status, 405);
  assert.equal((await work(ctx.env, `/ai/jobs/${nextUuid()}/cancel`)).status, 405);
  assert.equal(count(ctx.database, "ai_jobs"), 0);
});

test("쓰기 보호: 업무 CSRF 토큰이 없거나 출처가 다르면 만들기·취소가 403이고 작업·한도·R2·OpenAI에 손대지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const send = async (path, headers) => {
    const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await signToken(), "Content-Type": "application/json", ...headers },
      body: JSON.stringify(path.endsWith("/cancel") ? {} : ctx.body),
    });
    const response = await handleAdminApi(request, ctx.env, { authenticate, work: { now: () => NOW, auditLog: () => {}, randomUUID: nextUuid } });
    return { status: response.status, json: await response.json() };
  };
  for (const path of ["/ai/jobs", `/ai/jobs/${nextUuid()}/cancel`]) {
    const noCsrf = await send(path, { Origin: ORIGIN });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json.error.code, "CSRF_INVALID");
    const otherOrigin = await send(path, { Origin: "https://example.com" });
    assert.equal(otherOrigin.status, 403);
    assert.equal(otherOrigin.json.error.code, "ORIGIN_DENIED");
  }
  assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily"), 0);
  assert.deepEqual(ctx.r2.calls, []);
});

// ── 감사·로그에 내용 없음 ──

test("감사·로그: 계약서 표식 글자·거래 제목·R2 키·거래 번호·파일 번호·키·응답 본문이 없고, 로그 칸은 정해진 것뿐이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const logs = [];
  const auditLog = (entry) => logs.push(entry);
  const ai = script([
    { kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) },
    { kind: "retrieve", respond: httpError(500) },
    { kind: "retrieve", respond: httpError(500) },
    { kind: "retrieve", respond: completed("resp_b1", sampleContract({ warnings: ["가상 900101-1234567"] }), USAGE_B) },
  ]);
  const { groupId } = (await post(ctx, ai, { auditLog })).json.data;
  await getGroup(ctx, groupId, ai, { auditLog });
  const ready = await getGroup(ctx, groupId, ai, { auditLog });
  assert.equal(ready.json.data.group.status, "ready");
  await cancel(ctx, groupId, ai, { auditLog });

  const auditText = JSON.stringify(rows(ctx.database, "SELECT at, actor_email, action, target_type, target_id, request_id, outcome, reason FROM audit_events"));
  const logText = JSON.stringify(logs);
  const secrets = [MARK.title, MARK.key, MARK.property, MARK.quote, FAKE_OPENAI_KEY, "900101-1234567", "삼억오천만원", ctx.dealId, ...ctx.fileIds, "350000000", "2026-12-30", "data:image", "resp_a1"];
  for (const secret of secrets) {
    assert.equal(auditText.includes(secret), false, `감사에 없음: ${secret}`);
    assert.equal(logText.includes(secret), false, `로그에 없음: ${secret}`);
  }
  const openAiLogs = logs.filter((entry) => entry.event === "ai_openai");
  assert.equal(openAiLogs.length, 5, "생성 2 + 조회 3(5xx는 한 번 다시 부른 뒤 1줄)");
  const allowed = new Set(["event", "requestId", "run", "upstreamRequestId", "model", "effort", "status", "code", "inputTokens", "outputTokens", "ms"]);
  for (const entry of openAiLogs) assert.deepEqual(Object.keys(entry).filter((key) => !allowed.has(key)), []);
  for (const { reason } of rows(ctx.database, "SELECT reason FROM audit_events")) assert.match(reason, /^kind=contract_schedule;(files=2;pair=cross|results=2|open=0)$/u);
});

// ── 보탠 시험(가드를 빼도 통과하던 자리, 2026-11-23 대장 지시) ──

test("조회: 결과 열람 감사(ai.view)를 남기지 못하면 결과를 주지 않고 503 AUDIT_UNAVAILABLE이다(감사가 다시 되면 준다)", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([{ kind: "retrieve", respond: completed("resp_a1", sampleContract(), USAGE_A) }, { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) }]);
  const { groupId } = (await post(ctx, ai)).json.data;
  // ai.view 감사 넣기만 실패하게 한다(다른 감사·정산은 그대로).
  ctx.database.exec("CREATE TRIGGER zz_block_ai_view BEFORE INSERT ON audit_events WHEN NEW.action = 'ai.view' BEGIN SELECT RAISE(ABORT, 'ZZAUDIT 막힘'); END");
  const blocked = await getGroup(ctx, groupId, ai);
  assert.equal(blocked.status, 503);
  assert.equal(blocked.json.error.code, "AUDIT_UNAVAILABLE");
  assert.equal(blocked.json.error.retryable, true);
  assert.equal(blocked.json.data, undefined, "결과가 담긴 본문을 주지 않음");
  const text = JSON.stringify(blocked.json);
  for (const leaked of [MARK.property, MARK.quote, "ZZAUDIT", "contract_date", "price_won"]) assert.equal(text.includes(leaked), false, leaked);
  assert.deepEqual(audits(ctx.database, "ai.view"), []);
  // 결과는 D1에 저장돼 있고 정산도 끝났다. 감사가 다시 되면 OpenAI를 더 부르지 않고 결과를 준다.
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.result_json !== null]), [["completed", true], ["completed", true]]);
  assert.equal(usageRows(ctx.database)[0].estimated_cost_micro_usd, ACTUAL_A + ACTUAL_B);
  ctx.database.exec("DROP TRIGGER zz_block_ai_view");
  const ok = await getGroup(ctx, groupId, ai);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.data.jobs.map((job) => job.result), [sampleContract(), sampleContract()]);
  assert.equal(audits(ctx.database, "ai.view").length, 1);
  assert.equal(ai.remaining(), 0);
});

test("취소된 행은 덮어쓰지 않는다: 조회가 OpenAI 상태·결과를 받는 사이 취소되면 진행 상태도 결과도 적지 않고 정산도 하지 않는다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi();
  const ai = script([
    // 조회가 1회째(queued로 바뀜)를 받고 → 적기 직전에 다른 창이 취소 → 조회가 (이미 읽어 둔) 2회째의 완료 결과를 받는다.
    { kind: "retrieve", respond: pending("resp_a1", "queued") },
    { kind: "cancel", respond: pending("resp_a1", "cancelled") },
    { kind: "cancel", respond: pending("resp_b1", "cancelled") },
    { kind: "retrieve", respond: completed("resp_b1", sampleContract(), USAGE_B) },
  ]);
  const { groupId } = (await post(ctx, ai)).json.data;
  let cancelled;
  ctx.db.beforeNextBatch = async () => {
    cancelled = await cancel(ctx, groupId, ai);
  };
  const view = await getGroup(ctx, groupId, ai, { now: NOW + MINUTE });
  assert.equal(cancelled.status, 200);
  assert.equal(ai.remaining(), 0, "조회는 두 행 모두 OpenAI에서 받았음(덮어쓸 기회가 실제로 있었음)");
  assert.deepEqual(ai.violations, []);
  assert.deepEqual(jobRows(ctx.database).map((row) => [row.run_index, row.status, row.result_json, row.error_code, row.input_tokens, row.output_tokens]), [
    [1, "cancelled", null, null, null, null],
    [2, "cancelled", null, null, null, null],
  ], "1회째를 queued로, 2회째를 completed로 되살리지 않음");
  const reserved = reservedFor(2);
  assert.deepEqual(usageRows(ctx.database), [{ day: DAY, create_requests: 2, estimated_cost_micro_usd: reserved[0] + reserved[1], input_tokens: 0, output_tokens: 0 }], "닫힌 행은 정산하지 않음");
  assert.equal(view.status, 200);
  assert.equal(view.json.data.group.status, "cancelled");
  assert.deepEqual(view.json.data.jobs.map((job) => [job.status, job.result]), [["cancelled", null], ["cancelled", null]]);
  assert.deepEqual(audits(ctx.database, "ai.view"), []);
  assert.equal(JSON.stringify(jobRows(ctx.database)).includes(MARK.property), false, "취소 뒤에 온 결과는 저장하지 않음");
});

test("만들기: 사진이 아닌 종류(mime이 image/jpeg·image/webp가 아닌 파일)는 404이고 R2·OpenAI·한도에 손대지 않는다", async (t) => {
  installNetworkTrap(t);
  for (const mime of ["application/pdf", "image/png", "image/svg+xml", "text/html", "image/jpeg; charset=x", ""]) {
    const ctx = await setupAi();
    // 종류·가림 확인·거래는 모두 맞고 mime만 사진이 아닌 행(올리기 API는 이런 행을 만들지 않지만 D1에 있으면 보내지 않아야 한다).
    const odd = await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, mime });
    for (const fileIds of [[odd], [ctx.fileIds[0], odd]]) {
      const { status, json } = await work(ctx.env, "/ai/jobs", { method: "POST", body: { ...ctx.body, fileIds } });
      assert.equal(status, 404, mime);
      assert.equal(json.error.code, "NOT_FOUND", mime);
    }
    assert.deepEqual(ctx.r2.calls, [], `${mime}: R2 0번`);
    assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily") + count(ctx.database, "audit_events"), 0, mime);
  }
});

test("만들기: D1에 적힌 크기가 작아도 실제로 읽은 바이트 합계가 12MB를 넘으면 413 AI_INPUT_TOO_LARGE이고 한도·작업·OpenAI는 0이다", async (t) => {
  installNetworkTrap(t);
  const ctx = await setupAi({ pages: 0 });
  const big = () => {
    const bytes = new Uint8Array(AI_MAX_TOTAL_BYTES / 2 + 1);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    return bytes;
  };
  // 행의 byte_size는 1,000바이트라 미리 보는 합계 검사는 지나간다. R2에는 6MB + 1바이트가 두 장.
  ctx.body.fileIds.push(await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, bytes: big(), byteSize: 1_000 }), await seedCopy(ctx.database, ctx.r2, { dealId: ctx.dealId, bytes: big(), byteSize: 1_000 }));
  const { status, json } = await post(ctx);
  assert.equal(status, 413);
  assert.equal(json.error.code, "AI_INPUT_TOO_LARGE");
  assert.deepEqual(ctx.r2.calls.map(([action]) => action), ["get", "get"], "두 장을 실제로 읽은 뒤에 막음");
  assert.equal(count(ctx.database, "ai_jobs") + count(ctx.database, "ai_usage_daily") + count(ctx.database, "audit_events"), 0, "한도를 미리 더하기 전이라 되돌릴 것이 없음");
});

test("취소: OpenAI 취소가 5xx이거나 응답이 없으면 성공으로 보지 않는다(502, 행·감사 그대로, 다시 부르지 않음)", async (t) => {
  installNetworkTrap(t);
  for (const [label, respond] of [["500", httpError(500)], ["503", httpError(503)], ["네트워크 오류", networkError()], ["시간 초과", timeoutError()]]) {
    const ctx = await setupAi();
    const ai = script([{ kind: "cancel", respond }]);
    const { groupId } = (await post(ctx, ai)).json.data;
    const failed = await cancel(ctx, groupId, ai);
    assert.equal(failed.status, 502, label);
    assert.equal(failed.json.error.code, "AI_UPSTREAM_FAILED", label);
    assert.equal(failed.json.data, undefined, label);
    assert.equal(ai.calls.length, 3, `${label}: 취소 요청은 1번(다시 부르지 않고 둘째 행도 부르지 않음)`);
    assert.deepEqual(ai.violations, [], label);
    assert.deepEqual(jobRows(ctx.database).map((row) => [row.status, row.openai_response_id]), [["in_progress", "resp_a1"], ["in_progress", "resp_b1"]], `${label}: 행 그대로`);
    assert.deepEqual(audits(ctx.database, "ai.cancel"), [], `${label}: 취소 감사 없음`);
    // 아직 진행 중이라 같은 거래로 새로 만들 수 없고, 다시 누르면 취소된다.
    assert.equal((await post(ctx)).json.error.code, "AI_JOB_ACTIVE", label);
    const retry = scriptedOpenAi([{ kind: "cancel", respond: pending("resp_a1", "cancelled") }, { kind: "cancel", respond: pending("resp_b1", "cancelled") }]);
    assert.equal((await cancel(ctx, groupId, retry)).status, 200, label);
    assert.deepEqual(jobRows(ctx.database).map((row) => row.status), ["cancelled", "cancelled"], label);
  }
});
