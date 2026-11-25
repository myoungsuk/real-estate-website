// 글 초안 카드 배경 그림 3장 API 시험(설계서 22.22절, 2026-11-25 대장 지시 범위 1).
// 진짜 SQLite(node:sqlite)에 migrations/work 전부를 적용하고, OpenAI Images API는 이 파일의 가짜 fetch로만 부른다(실제 호출 0번).
// 가짜 표식: 그림 설명 ZZDESC-7F3A(실제 장소가 아님).
import test from "node:test";
import assert from "node:assert/strict";
import {
  BLOG_IMAGE_DEFAULT_DESCRIPTION,
  BLOG_IMAGE_FIXED_TEXT,
  BLOG_IMAGE_MODEL,
  BLOG_IMAGE_OUTPUT_TOKENS_MAX,
  BLOG_IMAGE_STYLES,
  buildImagePrompt,
  checkGeneratedImages,
  readImageConfig,
  readJpegSize,
} from "../worker/work-blog-backgrounds.mjs";
import { blogEnv, installNetworkTrap } from "./openai-fixtures.mjs";
import { freshDb, rows, work } from "./work-test-kit.mjs";

const API = "https://api.openai.com/v1";
const DESC = "ZZDESC-7F3A 벚꽃길 산책로와 맑은 하늘";

// 가로·세로를 담은 가짜 JPEG(SOI → APP0 → SOF0 → SOS → 자료 → EOI).
function fakeJpeg(width = 1024, height = 1280) {
  const bytes = [0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x12, 0x34, 0x56, 0x78,
    0xff, 0xd9];
  return Buffer.from(bytes).toString("base64");
}
const fakePng = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

const USAGE = { input_tokens: 60, input_tokens_details: { text_tokens: 60, image_tokens: 0 }, output_tokens: 3 * 1_500, total_tokens: 4_560 };
// 실제 비용: 글자 입력 60 × 5달러 + 그림 출력 4,500 × 30달러(100만 토큰당) = 135,300 마이크로달러.
const ACTUAL = Math.ceil((60 * 5_000_000 + 4_500 * 30_000_000) / 1_000_000);

const jsonReply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "x-request-id": "req_fake_img_0001" } });
const okImages = ({ count = 3, image = fakeJpeg, usage = USAGE, format = "jpeg" } = {}) => () => jsonReply(200, {
  created: 1_790_000_000,
  data: Array.from({ length: count }, () => ({ b64_json: image() })),
  output_format: format,
  quality: "high",
  size: "1024x1280",
  ...(usage ? { usage } : {}),
});

// 정해 둔 응답을 차례로 돌려주는 가짜 Images API. 그 밖의 경로는 실패로 기록한다.
function fakeImagesApi(replies = []) {
  const queue = [...replies];
  const calls = [];
  const violations = [];
  const fetcher = async (url, init = {}) => {
    const href = String(url);
    const path = href.startsWith(API) ? href.slice(API.length) : href;
    const call = { method: init.method, path, body: typeof init.body === "string" ? JSON.parse(init.body) : null, hasSignal: Boolean(init.signal) };
    calls.push(call);
    if (init.method !== "POST" || path !== "/images/generations") {
      violations.push(`허용하지 않은 경로 ${init.method} ${path}`);
      throw new Error("허용하지 않은 OpenAI 경로");
    }
    const reply = queue.shift();
    if (!reply) {
      violations.push("정하지 않은 호출");
      throw new Error("정하지 않은 OpenAI 호출");
    }
    return reply(call);
  };
  return { fetcher, calls, violations };
}

const usageRows = (database) => rows(database, "SELECT day, create_requests, estimated_cost_micro_usd, input_tokens, output_tokens FROM ai_usage_daily ORDER BY day");
const auditRows = (database) => rows(database, "SELECT action, outcome, target_type, reason FROM audit_events ORDER BY seq");
const dumpAll = (database) => JSON.stringify(["blog_drafts", "audit_events", "settings", "ai_usage_daily"].map((table) => rows(database, `SELECT * FROM ${table}`)));

function imageDb(extra = {}) {
  const fresh = freshDb();
  return { ...fresh, env: blogEnv(fresh.db, extra) };
}

async function setLimits(env, { daily = 10, monthly = 10_000_000 } = {}) {
  const result = await work(env, "/blog/limits", { method: "PUT", body: { version: 0, dailyCreateLimit: daily, monthlyCostLimitMicroUsd: monthly } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
}

const reservedFor = (prompt, quality) => Math.ceil(((prompt.length + 200) * 5_000_000 + BLOG_IMAGE_OUTPUT_TOKENS_MAX[quality] * 3 * 30_000_000) / 1_000_000);
const make = (env, body, openai, logs = []) => work(env, "/blog/backgrounds", { method: "POST", body, openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry) });

test("배경 그림: 3장을 받아 그대로 돌려주고, 하루 1편·실제 비용으로 바로잡고, 설명은 D1·감사·로그에 남지 않는다", async (t) => {
  installNetworkTrap(t);
  const { database, env } = imageDb();
  await setLimits(env);
  const openai = fakeImagesApi([okImages()]);
  const logs = [];
  const result = await make(env, { description: DESC, style: "watercolor", quality: "high" }, openai, logs);
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.deepEqual(openai.violations, []);

  const [call] = openai.calls;
  assert.equal(call.hasSignal, true);
  const expectedPrompt = `${DESC}. ${BLOG_IMAGE_STYLES.watercolor} ${BLOG_IMAGE_FIXED_TEXT}`;
  assert.deepEqual(call.body, { model: BLOG_IMAGE_MODEL, prompt: expectedPrompt, n: 3, size: "1024x1280", quality: "high", output_format: "jpeg", output_compression: 90 });
  assert.ok(call.body.prompt.endsWith(BLOG_IMAGE_FIXED_TEXT), "고정 문장이 끝에 붙음");

  const { data } = result.json;
  assert.equal(data.images.length, 3);
  for (const image of data.images) assert.deepEqual(image, { format: "jpeg", width: 1024, height: 1280, base64: fakeJpeg() });
  assert.equal(data.model, BLOG_IMAGE_MODEL);
  assert.equal(data.defaultDescriptionUsed, false);
  assert.equal(data.costMicroUsd, ACTUAL);
  assert.equal(data.costIsEstimate, false);
  assert.deepEqual(data.usage, { inputTokens: 60, outputTokens: 4_500 });

  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 1, estimated_cost_micro_usd: ACTUAL, input_tokens: 60, output_tokens: 4_500 }]);
  assert.deepEqual(auditRows(database).filter((row) => row.action !== "settings.update"), [
    { action: "blog.background.create", outcome: "ok", target_type: "blog_background", reason: "style=watercolor;quality=high" },
  ]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM blog_drafts")[0].n, 0, "초안 행을 만들지 않음");
  assert.doesNotMatch(dumpAll(database), /ZZDESC|벚꽃/u, "D1 어디에도 설명 0");
  const logText = JSON.stringify(logs);
  assert.doesNotMatch(logText, /ZZDESC|벚꽃|b64|\/9j\//u, "로그에 설명·그림 0");
  const openaiLog = logs.find((entry) => entry.event === "blog_image_openai");
  assert.equal(openaiLog.status, 200);
  assert.equal(openaiLog.outputTokens, 4_500);
});

test("배경 그림: 설명이 비거나 없으면 기본안을 쓰고, 그림체·품질이 요청에 그대로 실린다", async (t) => {
  installNetworkTrap(t);
  const { database, env } = imageDb();
  await setLimits(env);
  const openai = fakeImagesApi([okImages(), okImages()]);
  const blank = await make(env, { description: "   ", style: "photo", quality: "medium" }, openai);
  const missing = await make(env, { style: "pencil", quality: "high" }, openai);
  assert.equal(blank.status, 200, JSON.stringify(blank.json));
  assert.equal(missing.status, 200, JSON.stringify(missing.json));
  assert.equal(blank.json.data.defaultDescriptionUsed, true);
  assert.equal(missing.json.data.defaultDescriptionUsed, true);
  assert.equal(openai.calls[0].body.prompt, `${BLOG_IMAGE_DEFAULT_DESCRIPTION}. ${BLOG_IMAGE_STYLES.photo} ${BLOG_IMAGE_FIXED_TEXT}`);
  assert.equal(openai.calls[0].body.quality, "medium");
  assert.equal(openai.calls[1].body.prompt, `${BLOG_IMAGE_DEFAULT_DESCRIPTION}. ${BLOG_IMAGE_STYLES.pencil} ${BLOG_IMAGE_FIXED_TEXT}`);
  assert.equal(usageRows(database)[0].create_requests, 2, "품질과 상관없이 한 번 = 1편");
});

test("배경 그림: 본문이 틀리거나 개인정보 꼴이면 D1·감사·OpenAI 0번", async (t) => {
  installNetworkTrap(t);
  const { database, env } = imageDb();
  await setLimits(env);
  const before = dumpAll(database);
  const openai = fakeImagesApi([]);
  const cases = [
    [{ style: "watercolor", quality: "high", extra: 1 }, "VALIDATION_FAILED", ["body"]],
    [{ style: "oil", quality: "high" }, "VALIDATION_FAILED", ["style"]],
    [{ style: "pastel", quality: "low" }, "VALIDATION_FAILED", ["quality"]],
    [{ style: "pastel", quality: "medium", description: "가".repeat(201) }, "VALIDATION_FAILED", ["description"]],
    [{ style: "pastel", quality: "medium", description: "줄\n바꿈" }, "VALIDATION_FAILED", ["description"]],
    [{ style: "pastel", quality: "medium", description: 7 }, "VALIDATION_FAILED", ["description"]],
    [{ style: "pastel", quality: "medium", description: "공원 010-1234-5678" }, "PERSONAL_DATA_PATTERN", ["description"]],
    [{ style: "pastel", quality: "medium", description: "101동 1203호 앞 공원" }, "PERSONAL_DATA_PATTERN", ["description"]],
  ];
  for (const [body, code, details] of cases) {
    const result = await make(env, body, openai);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.json.error.code, code, JSON.stringify(body));
    assert.deepEqual(result.json.error.details, details, JSON.stringify(body));
  }
  assert.equal(openai.calls.length, 0);
  assert.equal(dumpAll(database), before);
  const ok = await make(env, { style: "pastel", quality: "medium", description: "가".repeat(200) }, fakeImagesApi([okImages()]));
  assert.equal(ok.status, 200, "200자는 받음");
});

test("배경 그림: 한도 행이 없거나 하루·월 한도를 넘으면 OpenAI를 부르지 않는다", async (t) => {
  installNetworkTrap(t);
  const noLimits = imageDb();
  const none = await make(noLimits.env, { style: "watercolor", quality: "high" }, fakeImagesApi([]));
  assert.equal(none.status, 409);
  assert.equal(none.json.error.code, "AI_LIMITS_MISSING");
  assert.deepEqual(usageRows(noLimits.database), []);

  const daily = imageDb();
  await setLimits(daily.env, { daily: 1 });
  const openai = fakeImagesApi([okImages()]);
  assert.equal((await make(daily.env, { style: "watercolor", quality: "medium" }, openai)).status, 200);
  const second = await make(daily.env, { style: "watercolor", quality: "medium" }, openai);
  assert.equal(second.status, 429);
  assert.deepEqual([second.json.error.code, second.json.error.details], ["AI_BUDGET_EXCEEDED", ["daily"]]);
  assert.equal(openai.calls.length, 1);

  const monthly = imageDb();
  await setLimits(monthly.env, { monthly: 100_000 }); // 가장 낮은 월 한도(0.1달러) < 높음 예약(약 0.72달러)
  const blocked = fakeImagesApi([]);
  const over = await make(monthly.env, { style: "watercolor", quality: "high" }, blocked);
  assert.equal(over.status, 429);
  assert.deepEqual(over.json.error.details, ["monthly"]);
  assert.equal(blocked.calls.length, 0);
  assert.deepEqual(usageRows(monthly.database), []);
});

test("배경 그림: 단가를 모르는 모델이면 만들지 않고(503), OPENAI_PRICES_JSON 항목이 있으면 그 단가를 쓴다", async (t) => {
  installNetworkTrap(t);
  const unknown = imageDb({ OPENAI_MODEL_IMAGE: "gpt-image-zz-test" });
  await setLimits(unknown.env);
  const before = usageRows(unknown.database);
  const openai = fakeImagesApi([]);
  const result = await make(unknown.env, { style: "watercolor", quality: "high" }, openai);
  assert.equal(result.status, 503);
  assert.equal(result.json.error.code, "IMAGE_CONFIG_MISSING");
  assert.equal(openai.calls.length, 0);
  assert.deepEqual(usageRows(unknown.database), before);
  assert.equal(readImageConfig({ OPENAI_MODEL_IMAGE: "bad model!" }), null, "꼴이 틀린 모델 이름도 막음");

  const priced = imageDb({
    OPENAI_MODEL_IMAGE: "gpt-image-zz-test",
    OPENAI_PRICES_JSON: JSON.stringify({ "gpt-test-blog": { input: 2_000_000, output: 10_000_000 }, "gpt-image-zz-test": { input: 1_000_000, output: 10_000_000 } }),
  });
  await setLimits(priced.env);
  const pricedOpenAi = fakeImagesApi([okImages()]);
  const made = await make(priced.env, { style: "watercolor", quality: "high" }, pricedOpenAi);
  assert.equal(made.status, 200, JSON.stringify(made.json));
  assert.equal(pricedOpenAi.calls[0].body.model, "gpt-image-zz-test");
  assert.equal(made.json.data.costMicroUsd, Math.ceil((60 * 1_000_000 + 4_500 * 10_000_000) / 1_000_000));
});

test("배경 그림: OpenAI 4xx(안전 기준 거절 포함)는 되돌리고, 5xx·끊김은 만든 것으로 센다", async (t) => {
  installNetworkTrap(t);
  const { database, env } = imageDb();
  await setLimits(env);
  const prompt = buildImagePrompt({ description: BLOG_IMAGE_DEFAULT_DESCRIPTION, style: "watercolor" });
  const openai = fakeImagesApi([
    () => jsonReply(400, { error: { message: "fake", type: "image_generation_user_error", code: "moderation_blocked" } }),
    () => jsonReply(400, { error: { message: "fake", type: "invalid_request_error", code: "invalid_value", param: "size" } }),
    () => jsonReply(429, { error: { message: "fake" } }),
    () => jsonReply(500, { error: { message: "fake" } }),
    () => {
      throw new TypeError("fetch failed");
    },
  ]);
  const logs = [];
  const refused = await make(env, { style: "watercolor", quality: "high" }, openai, logs);
  assert.deepEqual([refused.status, refused.json.error.code], [422, "AI_IMAGE_REFUSED"]);
  const badSize = await make(env, { style: "watercolor", quality: "high" }, openai, logs);
  assert.deepEqual([badSize.status, badSize.json.error.code], [502, "AI_REQUEST_INVALID"]);
  const limited = await make(env, { style: "watercolor", quality: "high" }, openai, logs);
  assert.deepEqual([limited.status, limited.json.error.code], [429, "AI_RATE_LIMITED"]);
  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 0, estimated_cost_micro_usd: 0, input_tokens: 0, output_tokens: 0 }], "4xx 세 번은 모두 되돌림");

  const upstream = await make(env, { style: "watercolor", quality: "high" }, openai, logs);
  assert.deepEqual([upstream.status, upstream.json.error.code], [502, "AI_STATE_UNKNOWN"]);
  const network = await make(env, { style: "watercolor", quality: "high" }, openai, logs);
  assert.deepEqual([network.status, network.json.error.code], [502, "AI_STATE_UNKNOWN"]);
  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 2, estimated_cost_micro_usd: 2 * reservedFor(prompt, "high"), input_tokens: 0, output_tokens: 0 }], "5xx·끊김은 예약 그대로");
  assert.equal(auditRows(database).filter((row) => row.action === "blog.background.create").length, 5, "감사는 시도마다 한 번");
  const failedLogs = logs.filter((entry) => entry.event === "blog_image_openai");
  assert.deepEqual(failedLogs.map((entry) => entry.status), [400, 400, 429, 500, null]);
  assert.deepEqual(failedLogs[1].upstreamError, { type: "invalid_request_error", code: "invalid_value", param: "size" });
});

test("배경 그림: 장수·꼴·크기가 다르면 보이지 않고(AI_RESULT_INVALID) 비용은 실제로 센다, usage가 없으면 예약 값을 둔다", async (t) => {
  installNetworkTrap(t);
  const { database, env } = imageDb();
  await setLimits(env, { daily: 20 });
  const bad = [
    okImages({ count: 2 }),
    okImages({ image: () => fakeJpeg(1024, 1024) }),
    okImages({ image: fakePng }),
    okImages({ format: "png" }),
    okImages({ image: () => "not base64!" }),
    okImages({ image: () => fakeJpeg().slice(0, -4) + "AAAA" }),
  ];
  for (const reply of bad) {
    const result = await make(env, { style: "pastel", quality: "medium" }, fakeImagesApi([reply]));
    assert.deepEqual([result.status, result.json.error.code], [502, "AI_RESULT_INVALID"]);
  }
  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 6, estimated_cost_micro_usd: 6 * ACTUAL, input_tokens: 6 * 60, output_tokens: 6 * 4_500 }]);

  const prompt = buildImagePrompt({ description: BLOG_IMAGE_DEFAULT_DESCRIPTION, style: "pastel" });
  const noUsage = await make(env, { style: "pastel", quality: "medium" }, fakeImagesApi([okImages({ usage: null })]));
  assert.equal(noUsage.status, 200);
  assert.equal(noUsage.json.data.costIsEstimate, true);
  assert.equal(noUsage.json.data.costMicroUsd, reservedFor(prompt, "medium"));
  assert.equal(usageRows(database)[0].estimated_cost_micro_usd, 6 * ACTUAL + reservedFor(prompt, "medium"));
});

test("배경 그림: 다른 방식은 405, 그림 검사 부품", async (t) => {
  installNetworkTrap(t);
  const { env } = imageDb();
  const get = await work(env, "/blog/backgrounds");
  assert.equal(get.status, 405);
  assert.equal(get.response.headers.get("Allow"), "POST");
  assert.deepEqual(readJpegSize(Buffer.from(fakeJpeg(), "base64")), { width: 1024, height: 1280 });
  assert.equal(readJpegSize(Buffer.from(fakePng(), "base64")), null);
  assert.equal(checkGeneratedImages({ data: [] }), null);
  assert.equal(checkGeneratedImages(null), null);
});
