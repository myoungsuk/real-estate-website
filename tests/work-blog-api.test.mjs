// 업무 도구 단계 P3 AI 블로그 글 초안 API 시험(설계서 22.9·22.11·22.15절, 지시서 D-1 ~ D-7, 날개-2 결과 56.4 ~ 56.9절).
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0004를 적용하고, OpenAI는 tests/openai-fixtures.mjs의 가짜 fetch로만 부른다(실제 호출 0번).
// 가짜 표식: OpenAI 키 ZZOPENAI-7F3A-…, 소재지 ZZTEST-7F3A(실제 고객·주소가 아님).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { BLOG_STYLES, EMPHASIS_MAX, checkBlogDraft } from "../src/lib/work/blog-checks.mjs";
import { findBlogSource } from "../src/lib/work/blog-sources.mjs";
import { formatKoreanWon } from "../src/lib/work/work-format.mjs";
import { blogSources, buildBlogPromptPayload, buildOpenAiRequest, emphasisNumbersOf, estimateInputTokens } from "../worker/work-blog.mjs";
import { runRealpriceCron } from "../worker/work-scheduled.mjs";
import {
  FAKE_MAX_OUTPUT,
  FAKE_MODEL,
  blogEnv,
  completed,
  created,
  failedResponse,
  httpError,
  incomplete,
  installNetworkTrap,
  networkError,
  pending,
  refusal,
  sampleResult,
  scriptedOpenAi,
  timeoutError,
} from "./openai-fixtures.mjs";
import { NOW, ORIGIN, SECRET, allMigrationSql, createD1, freshDb, migrationFiles, rows, signToken, work } from "./work-test-kit.mjs";

const LOCATION = "대전 동구 ZZTEST-7F3A동 999-9";
const OFFICE_PHONE = "010-2790-8675";
// 네이버 매물은 매일 부동산뱅크 동기화로 바뀐다. 이 API는 번들 공개 자료(work-blog.mjs 모듈 상수)만 읽어 가상 매물을 넣을 수 없으므로,
// 번호를 박지 않고 지금 공개 자료에서 조건(아파트 매매·고를 수 있음·가격·전용면적·숫자 층·총 층수·방향)으로 고르고 기대값도 그 매물에서 만든다.
// 제목 끝에 동 번호가 있는 매물을 먼저 고른다(OpenAI 요청에서 동 번호를 빼는지 보려고). 아파트 매매는 사무소의 주된 매물이라
// 못 찾으면 건너뛰지 않고 이 파일 전체를 실패로 멈춘다. 순수 함수 시험(work-blog-checks)은 가상 매물로 같은 읽기·잠금을 지킨다.
const DONG_SUFFIX = /\s*(\d{1,4})\s*동$/u; // 서버 work-blog.mjs stripDong과 같은 꼴
const LISTING_SOURCE = (() => {
  const fit = blogSources().filter((item) => item.type === "naver_listing" && !item.blockedReason && item.facts.propertyType === "아파트" && item.facts.tradeType === "sale"
    && item.facts.priceWon && item.facts.exclusiveM2 && Number.isInteger(item.facts.floor) && item.facts.totalFloors && item.facts.direction);
  const picked = fit.find((item) => DONG_SUFFIX.test(item.title)) ?? fit[0];
  if (!picked) throw new Error("공개 매물에 시험할 아파트 매매(가격·전용면적·숫자 층·총 층수·방향이 있는 것)가 없습니다. 고르는 조건을 다시 보세요.");
  return picked;
})();
const LISTING = { type: "naver_listing", id: LISTING_SOURCE.id };
const LISTING_NAME = LISTING_SOURCE.title.replace(DONG_SUFFIX, "").trim(); // OpenAI에 보내는 단지 이름(동 번호 뺌)
const LISTING_DONG = DONG_SUFFIX.exec(LISTING_SOURCE.title)?.[1] ?? null; // 제목 끝 동 번호(없으면 null)
const LISTING_PRICE = formatKoreanWon(LISTING_SOURCE.facts.priceWon); // 예: "2억 6,000만 원"
const { exclusiveM2: LISTING_M2, floor: LISTING_FLOOR, totalFloors: LISTING_TOTAL, direction: LISTING_DIRECTION } = LISTING_SOURCE.facts;
const COMPLEX = { type: "complex", id: "leaders-city-5" };
// 분양권 매물은 매일 부동산뱅크 동기화로 바뀌므로 번호를 박지 않고 지금 공개 자료에서 고른다(없으면 그 줄만 건너뜀).
const PRESALE_ID = blogSources().find((item) => item.type === "naver_listing" && item.facts.propertyType === "아파트분양권")?.id;
const FULL_FEE_ITEMS = { general: 50000, electricity: 30000, water: 10000, gas: 10000, heating: 20000, internet: 10000, tv: 10000, other: 10000 };
const listingInputs = (extra = {}) => ({
  location: LOCATION,
  kind: "아파트",
  violation: "none",
  moveIn: { type: "now" },
  rooms: 3,
  bathrooms: 2,
  approvalDate: "2016-06-30",
  parking: { basis: "perHousehold", value: 1.2 },
  managementFee: { type: "fixed", monthlyWon: 150000, items: FULL_FEE_ITEMS },
  directionBasis: "거실",
  ...extra,
});
const listingResult = (overrides = {}) => sampleResult({
  title: `${LISTING_NAME} ${LISTING_DIRECTION} 매매`,
  paragraphs: [`매매 ${LISTING_PRICE}, 전용 ${LISTING_M2}㎡, ${LISTING_FLOOR}층 ${LISTING_DIRECTION}입니다.`, "관리비는 월 15만 원입니다."],
  snsShort: `${LISTING_NAME} 매매 ${LISTING_PRICE}`,
  factsUsed: [`매매 ${LISTING_PRICE}`, `전용 ${LISTING_M2}㎡`],
  ...overrides,
});
// 지금 설정의 최대 예상 비용(입력 추정 + 출력 상한 × 단가). 화면·문서의 "1편 약 0.21달러"와 같은 크기.
const reservedFor = (call) => Math.ceil((estimateInputTokens(call.body) * 2_000_000 + FAKE_MAX_OUTPUT * 10_000_000) / 1_000_000);
const ACTUAL_4000_5000 = Math.ceil((4000 * 2_000_000 + 5000 * 10_000_000) / 1_000_000); // 58,000 마이크로달러

const usageRows = (database) => rows(database, "SELECT day, create_requests, estimated_cost_micro_usd, input_tokens, output_tokens FROM ai_usage_daily ORDER BY day");
const draftRows = (database) => rows(database, "SELECT * FROM blog_drafts ORDER BY created_at, id");
const auditRows = (database) => rows(database, "SELECT action, outcome, target_type, reason FROM audit_events ORDER BY seq");
const dumpAll = (database) => JSON.stringify(["blog_drafts", "audit_events", "settings", "ai_usage_daily"].map((table) => rows(database, `SELECT * FROM ${table}`)));

async function setLimits(env, { daily = 10, monthly = 10_000_000, version = 0 } = {}) {
  const result = await work(env, "/blog/limits", { method: "PUT", body: { version, dailyCreateLimit: daily, monthlyCostLimitMicroUsd: monthly } });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  return result.json.data;
}

function blogDb(options) {
  const fresh = freshDb(options);
  return { ...fresh, env: blogEnv(fresh.db) };
}

test("TK-59 0004는 0001 ~ 0003 위에 blog_drafts를 더하고 구조 번호 4·ai_limits_version 0만 넣으며, 한도 행은 넣지 않고 앞 파일은 바뀌지 않음", async () => {
  // 원격에 적용한 0001 ~ 0006은 고치지 않는다(LF 기준 SHA-256 고정, 0001 ~ 0003은 f7dc990과 같음, 0004는 2026-11-20 원격 적용, 0005는 2026-11-21 원격 적용(매출장부), 0006은 2026-11-22 원격 적용(할 일)).
  const fixed = {
    "0001_init.sql": "7ba0f35651a81874a9320214f49154bb6983e67f4701ccf342749204dd3035d2",
    "0002_deal_schedule_inputs.sql": "9adbf0997bb201212c71fc9bf9170c35557f6a1d9e2d05155279000622accd51",
    "0003_public_realprice.sql": "8dcbf692b4a33a4ac252934d6c9098d74b94de9fca7e467cdafb5fcc957ca468",
    "0004_blog_drafts.sql": "94304bd41036bdcc9bc71d3718d364e021f00bfbc997ff05198190d20606bc51", // 2026-11-20 원격 적용
    "0005_ledger.sql": "e05cda1dcc48b5dce418b797997968e0751787fd607304297c8c435c168e49eb", // 2026-11-21 원격 적용(매출장부)
    "0006_tasks.sql": "8ee2a701457ff2e8a9fd88949a86cb5ff70c57131f156eea0ea8e905afc7e180", // 2026-11-22 원격 적용(할 일)
  };
  for (const [name, hash] of Object.entries(fixed)) {
    const text = (await readFile(new URL(`../migrations/work/${name}`, import.meta.url), "utf8")).replace(/\r\n/gu, "\n");
    assert.equal(createHash("sha256").update(text).digest("hex"), hash, name);
  }
  assert.deepEqual(migrationFiles, [...Object.keys(fixed), "0007_trash.sql"]);

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 3)) database.exec(sql);
  database.exec("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('30110-0001', '가상 단지', NULL, 0, '2026-11-20T00:00:00.000Z')");
  const before = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  database.exec(allMigrationSql[3]);
  const after = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  assert.deepEqual(after.filter((name) => !before.includes(name)), ["blog_drafts"]);
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "4");
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'ai_limits_version'")[0].value_json, "0");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM settings WHERE key IN ('ai_daily_create_limit','ai_monthly_cost_limit_micro_usd')")[0].n, 0, "한도 행 없음(fail closed)");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_watch_complexes")[0].n, 1, "다른 표 자료 그대로");
  const insert = (status, closed = null, disclosure = "{}") => database.prepare(`INSERT INTO blog_drafts (id, source_type, source_id, source_title, status, closed, model, reasoning_effort, disclosure_json, usage_day, reserved_cost_micro_usd, created_at, updated_at)
    VALUES (?, 'complex', 'leaders-city-5', '리더스시티 5블록', ?, ?, 'm', 'xhigh', ?, '2026-11-20', 0, 'x', 'x')`).run(`id-${status}-${closed}-${disclosure.length}`, status, closed, disclosure);
  insert("queued");
  assert.throws(() => insert("done"), /CHECK/u, "상태 목록 밖");
  assert.throws(() => insert("queued", "kept"), /CHECK/u, "닫음 목록 밖");
  assert.throws(() => insert("queued", null, "not json"), /CHECK/u, "명시사항 JSON 아님");
  assert.throws(() => insert("queued", null, JSON.stringify({ a: "x".repeat(4001) })), /CHECK/u, "명시사항 4,000자 넘음");
  assert.throws(() => database.exec(allMigrationSql[3]), /already exists/u, "두 번 적용하면 멈춤");
});

test("TK-44 글 초안 켜기 값·OpenAI 설정: 정확히 true가 아니면 503 BLOG_DISABLED(D1 0), 설정이 빠지면 503 BLOG_CONFIG_MISSING(D1 0), 실거래가·단계 2와 따로 켬", async () => {
  for (const value of [undefined, "TRUE", "1", " true"]) {
    const { db } = freshDb();
    const result = await work(blogEnv(db, { WORK_BLOG_ENABLED: value }), "/blog/sources");
    assert.deepEqual([result.status, result.json.error.code, db.stats.statements], [503, "BLOG_DISABLED", 0], String(value));
  }
  const missing = [
    { OPENAI_API_KEY: undefined },
    { OPENAI_API_KEY: "short" },
    { OPENAI_MODEL: undefined },
    { OPENAI_MODEL: "bad model" },
    { OPENAI_REASONING_EFFORT: undefined },
    { OPENAI_MAX_OUTPUT_TOKENS: "999" },
    { OPENAI_MAX_OUTPUT_TOKENS: "abc" },
    { OPENAI_PRICES_JSON: undefined },
    { OPENAI_PRICES_JSON: "{" },
    { OPENAI_PRICES_JSON: JSON.stringify({ other: { input: 1, output: 1 } }) },
    { OPENAI_PRICES_JSON: JSON.stringify({ [FAKE_MODEL]: { input: 1.5, output: 1 } }) },
    { ADMIN_CSRF_SECRET: "short" },
    { ADMIN_ALLOWED_ORIGINS: "not a url" },
  ];
  for (const extra of missing) {
    const { db } = freshDb();
    for (const path of ["/blog/sources", "/public-tools/session"]) {
      const result = await work(blogEnv(db, extra), path);
      assert.deepEqual([result.status, result.json.error.code], [503, "BLOG_CONFIG_MISSING"], `${JSON.stringify(extra)} ${path}`);
      assert.doesNotMatch(JSON.stringify(result.json), /OPENAI|ZZOPENAI/u, "응답에 Secret 이름·값 없음");
    }
    assert.equal(db.stats.statements, 0);
  }
  // 작업별 모델이 있으면 그것을, 비면 OPENAI_MODEL을 쓴다.
  const { db } = freshDb();
  const prices = JSON.stringify({ "gpt-blog-only": { input: 2_000_000, output: 10_000_000 } });
  assert.equal((await work(blogEnv(db, { OPENAI_MODEL_BLOG: "gpt-blog-only", OPENAI_PRICES_JSON: prices }), "/blog/sources")).status, 200);

  // 글 초안만 켬: 세션 blogEnabled true·realpriceEnabled false·업무 CSRF 토큰, 실거래가·단계 2 경로는 꺼진 그대로.
  const session = await work(blogEnv(db), "/public-tools/session");
  assert.equal(session.status, 200);
  assert.deepEqual([session.json.data.realpriceEnabled, session.json.data.blogEnabled, session.json.data.schemaVersion], [false, true, 7]);
  assert.match(session.json.data.csrfToken, /^\d+\.[A-Za-z0-9_-]+$/u);
  assert.equal((await work(blogEnv(db), "/realprice/status")).json.error.code, "REALPRICE_DISABLED");
  assert.equal((await work(blogEnv(db), "/session")).json.data.enabled, false);
  assert.equal((await work(blogEnv(db), "/customers")).json.error.code, "WORK_DISABLED");
});

test("TK-60 GET /blog/sources는 번들 공개 자료만 주고, 분양권은 고를 수 없는 이유를 붙이며, 종류·찾기 값을 검사한다(D1 쓰기·감사 0)", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  const all = await work(env, "/blog/sources");
  assert.equal(all.status, 200);
  const items = all.json.data.items;
  assert.ok(items.some((item) => item.type === "naver_listing" && item.id === LISTING.id));
  assert.deepEqual(items.filter((item) => item.type === "complex").map((item) => item.id), ["leaders-city-4", "leaders-city-5", "sinheung-sk-view"]);
  assert.ok(items.filter((item) => item.facts.propertyType === "아파트분양권").every((item) => item.blockedReason && item.category === null));
  assert.deepEqual(all.json.data.styles.map((style) => style.id), BLOG_STYLES.map((style) => style.id));
  const complexOnly = await work(env, "/blog/sources?type=complex");
  assert.ok(complexOnly.json.data.items.every((item) => item.type === "complex"));
  // 찾기 말은 단지 이름 가운데에 띄어쓰기를 넣은 것(예: "휴먼 시아2단지"). 서버 matchesBlogSourceQuery처럼 NFKC·소문자·띄어쓰기 무시로 대조한다.
  const fold = (text) => String(text).normalize("NFKC").replace(/\s/gu, "").toLowerCase();
  const compactName = LISTING_NAME.replace(/\s/gu, "");
  const query = await work(env, `/blog/sources?q=${encodeURIComponent(`${compactName.slice(0, 2)} ${compactName.slice(2)}`)}`);
  assert.ok(query.json.data.items.some((item) => item.id === LISTING.id), "고른 매물이 찾아짐");
  assert.ok(query.json.data.items.every((item) => fold(item.title).includes(fold(compactName))));
  for (const bad of ["?type=customer", `?q=${"가".repeat(31)}`]) {
    const result = await work(env, `/blog/sources${bad}`);
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], bad);
  }
  assert.equal((await work(env, "/blog/sources", { method: "POST", body: {} })).status, 405);
  assert.equal(auditRows(database).length, 0);
});

test("TK-57 한도: 처음엔 행 없음(null)·기본값 하루 10편·월 10달러·오늘 사용량을 주고, 저장은 version guard·감사 settings.update, 낡은 version은 409, 범위 밖은 400", async () => {
  const { database, env } = blogDb();
  const first = await work(env, "/blog/limits");
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.data, {
    version: 0,
    dailyCreateLimit: null,
    monthlyCostLimitMicroUsd: null,
    defaults: { dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 },
    ranges: { daily: [1, 100], monthly: [100_000, 200_000_000] },
    usage: { day: "2026-11-17", todayCreates: 0, monthCostMicroUsd: 0 },
  });
  const saved = await setLimits(env);
  assert.deepEqual([saved.version, saved.dailyCreateLimit, saved.monthlyCostLimitMicroUsd], [1, 10, 10_000_000]);
  assert.deepEqual(auditRows(database), [{ action: "settings.update", outcome: "ok", target_type: "settings", reason: "daily=10;monthly_micro_usd=10000000" }]);
  const stale = await work(env, "/blog/limits", { method: "PUT", body: { version: 0, dailyCreateLimit: 5, monthlyCostLimitMicroUsd: 5_000_000 } });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "VERSION_CONFLICT"]);
  for (const [body, field] of [
    [{ version: 1, dailyCreateLimit: 0, monthlyCostLimitMicroUsd: 10_000_000 }, "dailyCreateLimit"],
    [{ version: 1, dailyCreateLimit: 101, monthlyCostLimitMicroUsd: 10_000_000 }, "dailyCreateLimit"],
    [{ version: 1, dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 99_999 }, "monthlyCostLimitMicroUsd"],
    [{ version: 1, dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 200_000_001 }, "monthlyCostLimitMicroUsd"],
    [{ version: 1, dailyCreateLimit: 10.5, monthlyCostLimitMicroUsd: 10_000_000 }, "dailyCreateLimit"],
    [{ version: 1, dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000, extra: 1 }, "extra"],
  ]) {
    const result = await work(env, "/blog/limits", { method: "PUT", body });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details.includes(field)], [400, "VALIDATION_FAILED", true], JSON.stringify(body));
  }
  assert.equal(auditRows(database).length, 1);
});

test("TK-57 한도 행이 없으면 만들기는 409 AI_LIMITS_MISSING이고 OpenAI·초안·사용량·감사 0", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  const openai = scriptedOpenAi();
  const result = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
  assert.deepEqual([result.status, result.json.error.code], [409, "AI_LIMITS_MISSING"]);
  assert.deepEqual([openai.calls.length, draftRows(database).length, usageRows(database).length, auditRows(database).length], [0, 0, 0, 0]);
});

test("TK-46·TK-50·TK-61 단지 소개 글: 최대 예상 비용을 미리 더하고 감사 blog.create 뒤 OpenAI background·store:false로 1번 보내며, 결과를 받으면 실제 비용으로 한 번만 바로잡음", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_1") },
    { kind: "retrieve", respond: pending("resp_fake_1") },
    { kind: "retrieve", respond: completed("resp_fake_1", sampleResult()) },
  ]);
  const logs = [];
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "live", emphasis: "단지 앞 산책길" }, openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const draft = made.json.data.draft;
  assert.deepEqual([draft.status, draft.source.id, draft.needsLocation, draft.closed], ["queued", "leaders-city-5", false, null]);

  const [call] = openai.calls;
  assert.equal(call.authIsFakeKey, true);
  assert.equal(call.hasSignal, true, "시간 제한 신호를 붙임");
  assert.deepEqual([call.body.model, call.body.reasoning, call.body.max_output_tokens, call.body.background, call.body.store], [FAKE_MODEL, { effort: "xhigh" }, FAKE_MAX_OUTPUT, true, false]);
  assert.deepEqual([call.body.text.format.type, call.body.text.format.strict, call.body.text.format.schema.required], ["json_schema", true, ["title", "sections", "checklist", "hashtags", "snsShort", "factsUsed"]]);
  const payload = JSON.parse(call.body.input[0].content[0].text);
  assert.equal(payload.kind, "complex");
  assert.equal(payload.style.instruction, BLOG_STYLES.find((style) => style.id === "live").instruction);
  assert.equal(BLOG_STYLES.filter((style) => call.body.input[0].content[0].text.includes(style.instruction)).length, 1, "성격 지시는 정확히 1개");
  assert.equal(payload.emphasis, "단지 앞 산책길");
  assert.doesNotMatch(JSON.stringify(call.body), new RegExp(`${OFFICE_PHONE}|30110-2023-00028`, "u"), "사무소 연락처·등록번호는 보내지 않음(코드가 붙임)");

  const reserved = reservedFor(call);
  assert.ok(reserved > 200_000 && reserved < 220_000, `1편 최대 예상 약 0.2달러(단지 자료 7개 항목을 함께 보내 입력이 늘어남): ${reserved}`);
  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 1, estimated_cost_micro_usd: reserved, input_tokens: 0, output_tokens: 0 }]);
  assert.deepEqual(auditRows(database).map((row) => row.action), ["settings.update", "blog.create"]);
  const [row] = draftRows(database);
  assert.deepEqual([row.openai_response_id, row.reserved_cost_micro_usd, row.usage_day, row.model, row.reasoning_effort], ["resp_fake_1", reserved, "2026-11-17", FAKE_MODEL, "xhigh"]);
  assert.doesNotMatch(row.disclosure_json, /산책길/u, "강조점 글은 저장하지 않음");

  const stillRunning = await work(env, `/blog/drafts/${draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
  assert.equal(stillRunning.json.data.draft.status, "in_progress");
  const done = await work(env, `/blog/drafts/${draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 10_000 });
  assert.equal(done.status, 200);
  const finished = done.json.data.draft;
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.result.hashtags, ["#대전동구", "#리더스시티"]);
  assert.deepEqual(finished.checks, { blocks: [], warnings: [] });
  assert.equal(finished.actualCostMicroUsd, ACTUAL_4000_5000);
  assert.deepEqual(usageRows(database), [{ day: "2026-11-17", create_requests: 1, estimated_cost_micro_usd: ACTUAL_4000_5000, input_tokens: 4000, output_tokens: 5000 }]);

  // 다 받은 뒤 다시 열면 OpenAI를 부르지 않고 같은 값.
  const again = await work(env, `/blog/drafts/${draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 20_000 });
  assert.deepEqual(again.json.data.draft.result, finished.result);
  assert.deepEqual([openai.calls.length, openai.remaining(), openai.violations], [3, 0, []]);
  assert.equal(usageRows(database)[0].estimated_cost_micro_usd, ACTUAL_4000_5000);

  // 로그: 요청 ID·모델·추론·상태·토큰·걸린 시간만(글·키·본문 없음).
  const blogLogs = logs.filter((entry) => entry.event === "blog_openai");
  assert.ok(blogLogs.length >= 1);
  for (const entry of blogLogs) assert.deepEqual(Object.keys(entry).filter((key) => !["event", "requestId", "upstreamRequestId", "model", "effort", "status", "code", "inputTokens", "outputTokens", "ms"].includes(key)), []);
  assert.doesNotMatch(JSON.stringify(logs), /ZZOPENAI|리더스시티 5블록 단지를 소개|산책길/u);
});

test("TK-49·TK-67 운영자 결정 ②: 소재지는 명시사항이 다 찼는지만 보고 D1·OpenAI·로그에 넣지 않으며, 지번·동 번호·관리비 비목도 OpenAI로 보내지 않음", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_2") },
    { kind: "retrieve", respond: completed("resp_fake_2", listingResult()) },
  ]);
  const logs = [];
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: LISTING, style: "urgent", inputs: listingInputs(), emphasis: `급매 ${LISTING_PRICE}` }, openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry) });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const body = JSON.stringify(openai.calls[0].body);
  assert.doesNotMatch(body, /ZZTEST|999-9/u, "소재지 0");
  if (LISTING_DONG) assert.doesNotMatch(body, new RegExp(`(?<!\\d)${LISTING_DONG}\\s*동`, "u"), "동 번호 0");
  // 고른 공개 매물에 동 번호가 없어도 빼는 규칙은 가상 제목으로 늘 본다.
  assert.equal(buildBlogPromptPayload({ source: { ...LISTING_SOURCE, title: "가상단지 101동" }, inputs: listingInputs(), emphasis: "", style: "plain" }).listing.title, "가상단지");
  assert.doesNotMatch(body, /electricity|heating|"general"|(?<!\d)50000(?!\d)/u, "관리비 비목 0");
  const payload = JSON.parse(openai.calls[0].body.input[0].content[0].text);
  assert.deepEqual([payload.listing.title, payload.listing.priceWon, payload.listing.exclusiveM2, payload.listing.floor, payload.listing.totalFloors, payload.listing.managementFee],
    [LISTING_NAME, LISTING_SOURCE.facts.priceWon, LISTING_M2, LISTING_FLOOR, LISTING_TOTAL, { type: "fixed", monthlyWon: 150000 }]);

  const done = await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
  const draft = done.json.data.draft;
  assert.equal(draft.status, "completed");
  assert.equal(draft.needsLocation, true, "다시 열면 소재지를 다시 넣어야 함");
  assert.equal(draft.inputs.location, undefined);
  assert.deepEqual(draft.inputs.managementFee.items, FULL_FEE_ITEMS, "비목 금액은 명시사항용으로 D1에만 둠");
  assert.equal(draft.emphasisNumbers, LISTING_PRICE);
  assert.deepEqual(draft.checks.blocks, []);
  // requestId(감사 기록의 request_id)는 무작위 UUID라 999-9 같은 글자가 우연히 들어갈 수 있어 빼고 본다.
  assert.doesNotMatch(dumpAll(database).replace(/"request_id":"[^"]*"/gu, ""), /ZZTEST|999-9/u, "D1 어디에도 소재지 0");
  assert.doesNotMatch(JSON.stringify(logs.map((entry) => ({ ...entry, requestId: undefined }))), /ZZTEST|999-9/u);
  assert.doesNotMatch(JSON.stringify(done.json), /ZZTEST/u);
});

test("TK-48·TK-49 만들기 전에 막기: 명시사항 빈 칸은 400 DISCLOSURE_INCOMPLETE(빈 칸 이름), 개인정보 형식은 400 PERSONAL_DATA_PATTERN, 형식 밖은 400 — 모두 D1·감사·사용량·OpenAI 0", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const before = dumpAll(database);
  const openai = scriptedOpenAi();
  const post = (body) => work(env, "/blog/drafts", { method: "POST", body, openaiFetch: openai.fetcher });
  const noLocation = await post({ source: LISTING, style: "plain", inputs: listingInputs({ location: undefined }) });
  assert.deepEqual([noLocation.status, noLocation.json.error.code, noLocation.json.error.details], [400, "DISCLOSURE_INCOMPLETE", ["location"]]);
  const many = await post({ source: LISTING, style: "plain", inputs: { location: LOCATION } });
  assert.equal(many.json.error.code, "DISCLOSURE_INCOMPLETE");
  assert.deepEqual(many.json.error.details.sort(), ["approvalDate", "bathrooms", "directionBasis", "kind", "managementFee", "moveIn", "parking", "rooms"].sort());
  // 정액 월 10만 원 이상인데 비목도 "확인 불가"도 없으면 관리비 빈 칸.
  const feeOnly = await post({ source: LISTING, style: "plain", inputs: listingInputs({ managementFee: { type: "fixed", monthlyWon: 150000 } }) });
  assert.deepEqual(feeOnly.json.error.details, ["managementFee"]);
  for (const [extra, field] of [
    [{ emphasis: "문의 010-1234-5678" }, "emphasis"],
    [{ emphasis: "메일 someone@example.com" }, "emphasis"],
    [{ emphasis: "주민 900101-1234567" }, "emphasis"],
    [{ inputs: listingInputs({ location: "대전 동구 ZZTEST 101호" }) }, "location"],
  ]) {
    const result = await post({ source: LISTING, style: "plain", inputs: listingInputs(), ...extra });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "PERSONAL_DATA_PATTERN", [field]], JSON.stringify(extra));
    // requestId는 무작위 UUID라 1234 같은 글자가 우연히 들어갈 수 있어 빼고 본다.
    assert.doesNotMatch(JSON.stringify({ ...result.json, requestId: undefined }), /1234|someone|101호|ZZTEST/u, "응답에 입력값 없음");
  }
  for (const [body, field] of [
    [{ source: LISTING, style: "monthly", inputs: listingInputs() }, "style"], // 매매에 월세 성격
    [{ source: LISTING, style: "boast", inputs: listingInputs() }, "style"],
    [{ source: LISTING, inputs: listingInputs() }, "style"],
    [{ source: LISTING, style: "plain", inputs: listingInputs({ rooms: 21 }) }, "rooms"],
    [{ source: LISTING, style: "plain", inputs: listingInputs({ approvalDate: "2016-02-30" }) }, "approvalDate"],
    [{ source: LISTING, style: "plain", inputs: listingInputs({ unit: "101" }) }, "unit"],
    [{ source: LISTING, style: "plain", inputs: listingInputs(), emphasis: "가".repeat(501) }, "emphasis"], // 대표 현장 메모 500자 초과
    ...(PRESALE_ID ? [[{ source: { type: "naver_listing", id: PRESALE_ID }, style: "plain" }, "source"]] : []), // 분양권
    [{ source: { type: "customer", id: "x" }, style: "plain" }, "source"],
    [{ source: COMPLEX, style: "urgent" }, "style"], // 단지 소개 글에 급매
  ]) {
    const result = await post(body);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details.includes(field)], [400, "VALIDATION_FAILED", true], JSON.stringify(body).slice(0, 80));
  }
  const gone = await post({ source: { type: "naver_listing", id: "9999999999" }, style: "plain" });
  assert.deepEqual([gone.status, gone.json.error.code], [409, "SOURCE_NOT_PUBLIC"]);
  assert.equal(dumpAll(database), before, "D1 변화 0");
  assert.equal(openai.calls.length, 0);

  // 사무소 확정 번호는 개인정보로 막지 않는다(보내면 그대로 201).
  const officeOpenAi = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_office") }]);
  const office = await work(env, "/blog/drafts", { method: "POST", body: { source: LISTING, style: "plain", inputs: listingInputs(), emphasis: `사무소 ${OFFICE_PHONE}` }, openaiFetch: officeOpenAi.fetcher });
  assert.equal(office.status, 201, JSON.stringify(office.json));
});

test("TK-62 예산: 하루 횟수를 다 쓰거나 월 상한을 넘으면 429 AI_BUDGET_EXCEEDED(daily·monthly), OpenAI·초안 0, 한국 날짜가 바뀌면 다시 셈, 남은 1회에 여러 번 보내도 1번만", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env, { daily: 1 });
  const openai = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_3") }, { kind: "create", respond: created("resp_fake_4") }]);
  const post = (now) => work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher, now });
  const lastMinute = Date.parse("2026-11-17T14:59:59.000Z"); // 한국 11-17 23:59:59
  assert.equal((await post(lastMinute)).status, 201);
  for (let index = 0; index < 4; index += 1) {
    const over = await post(lastMinute);
    assert.deepEqual([over.status, over.json.error.code, over.json.error.details], [429, "AI_BUDGET_EXCEEDED", ["daily"]]);
  }
  assert.equal(openai.calls.length, 1, "남은 1회에 5번 보내도 생성 1번");
  assert.equal((await post(Date.parse("2026-11-17T15:00:00.000Z"))).status, 201, "한국 11-18 00:00부터 다시 1회");
  assert.deepEqual(usageRows(database).map((row) => [row.day, row.create_requests]), [["2026-11-17", 1], ["2026-11-18", 1]]);

  // 월 상한: 이번 달 예상 합계 + 최대 예상 비용이 넘으면 막음(단계 4 사용량도 같은 행에서 셈).
  const month = blogDb();
  await setLimits(month.env, { daily: 10, monthly: 300_000 });
  month.database.exec("INSERT INTO ai_usage_daily (day, create_requests, estimated_cost_micro_usd) VALUES ('2026-11-01', 3, 150000)");
  const monthOpenAi = scriptedOpenAi();
  const over = await work(month.env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: monthOpenAi.fetcher });
  assert.deepEqual([over.status, over.json.error.code, over.json.error.details], [429, "AI_BUDGET_EXCEEDED", ["monthly"]]);
  assert.deepEqual([monthOpenAi.calls.length, draftRows(month.database).length], [0, 0]);
  assert.deepEqual(usageRows(month.database).map((row) => [row.day, row.create_requests, row.estimated_cost_micro_usd]), [["2026-11-01", 3, 150000]], "늘리지 않음");
  // 지난달 사용량은 이번 달 합계에 들어가지 않는다.
  const nextMonth = await work(month.env, "/blog/limits", { now: Date.parse("2026-12-01T00:00:00.000Z") });
  assert.deepEqual(nextMonth.json.data.usage, { day: "2026-12-01", todayCreates: 0, monthCostMicroUsd: 0 });
});

test("TK-63 생성 요청 실패: 4xx(429·401·400)는 만들어지지 않은 것이라 예약을 되돌리고 failed, 5xx·끊김·시간 초과는 만들어졌는지 몰라 예약을 두고 unknown — 모두 생성 1번만", async (t) => {
  installNetworkTrap(t);
  const cases = [
    [httpError(429, { "retry-after": "20" }), 429, "AI_RATE_LIMITED", "failed", true],
    [httpError(401), 503, "AI_CONFIG_INVALID", "failed", true],
    [httpError(400), 502, "AI_REQUEST_INVALID", "failed", true],
    [httpError(500), 502, "AI_STATE_UNKNOWN", "unknown", false],
    [httpError(503), 502, "AI_STATE_UNKNOWN", "unknown", false],
    [networkError(), 502, "AI_STATE_UNKNOWN", "unknown", false],
    [timeoutError(), 502, "AI_STATE_UNKNOWN", "unknown", false],
  ];
  for (const [respond, status, code, draftStatus, refunded] of cases) {
    const { database, env } = blogDb();
    await setLimits(env);
    const openai = scriptedOpenAi([{ kind: "create", respond }]);
    const logs = [];
    const result = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry) });
    assert.deepEqual([result.status, result.json.error.code], [status, code], code);
    assert.equal(openai.calls.length, 1, `${code}: 생성 재시도 0회`);
    const [draft] = draftRows(database);
    assert.deepEqual([draft.status, draft.error_code], [draftStatus, code]);
    const [usage] = usageRows(database);
    assert.deepEqual([usage.create_requests, usage.estimated_cost_micro_usd === 0], refunded ? [0, true] : [1, false], `${code}: 되돌림 ${refunded}`);
    assert.doesNotMatch(JSON.stringify([result.json, logs]), /fake upstream error|ZZOPENAI/u, "error.message·키 없음");
  }
});

test("TK-51 결과 받기: 조회 5xx는 1번 다시, 두 번 연속이면 그대로 진행 중, 결과 모양이 틀리거나 거절·잘림·실패면 failed(원문 저장 안 함, 실제 비용으로 바로잡음)", async (t) => {
  installNetworkTrap(t);
  const runCase = async (steps) => {
    const { database, env } = blogDb();
    await setLimits(env);
    const openai = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_5") }, ...steps]);
    const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
    const polled = await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
    return { database, openai, polled, draft: polled.json.data.draft };
  };
  const retried = await runCase([{ kind: "retrieve", respond: httpError(503) }, { kind: "retrieve", respond: completed("resp_fake_5", sampleResult()) }]);
  assert.deepEqual([retried.polled.status, retried.draft.status, retried.openai.calls.length], [200, "completed", 3]);
  const twice = await runCase([{ kind: "retrieve", respond: httpError(503) }, { kind: "retrieve", respond: networkError() }]);
  assert.deepEqual([twice.polled.status, twice.draft.status, twice.draft.errorCode], [200, "queued", null], "다음 조회에서 다시 봄");

  const invalidResults = [
    sampleResult({ title: "가".repeat(61) }),
    sampleResult({ paragraphs: Array.from({ length: 13 }, () => "문단") }),
    sampleResult({ paragraphs: ["가".repeat(601)] }),
    sampleResult({ hashtags: Array.from({ length: 11 }, (_, index) => `태그${index}`) }),
    sampleResult({ snsShort: "가".repeat(201) }),
    { ...sampleResult(), extra: "x" },
    (() => {
      const result = sampleResult();
      delete result.factsUsed;
      return result;
    })(),
    "이건 JSON이 아닙니다",
    "```json\n{}\n```",
  ];
  for (const result of invalidResults) {
    const bad = await runCase([{ kind: "retrieve", respond: completed("resp_fake_5", result) }]);
    assert.deepEqual([bad.draft.status, bad.draft.errorCode, bad.draft.result], ["failed", "AI_RESULT_INVALID", null], JSON.stringify(result).slice(0, 60));
    assert.equal(usageRows(bad.database)[0].estimated_cost_micro_usd, ACTUAL_4000_5000, "실제 비용으로 바로잡음");
  }
  const edge = await runCase([{ kind: "retrieve", respond: completed("resp_fake_5", sampleResult({ title: "가".repeat(60), snsShort: "나".repeat(200), paragraphs: Array.from({ length: 12 }, () => "다".repeat(600)), hashtags: Array.from({ length: 10 }, (_, index) => `태그${index}`) })) }]);
  assert.equal(edge.draft.status, "completed", "경계값(60·200·12×600·10)은 통과");
  for (const [respond, code] of [[refusal("resp_fake_5"), "AI_RESULT_INVALID"], [incomplete("resp_fake_5"), "AI_RESULT_INCOMPLETE"], [failedResponse("resp_fake_5"), "AI_UPSTREAM_FAILED"]]) {
    const result = await runCase([{ kind: "retrieve", respond }]);
    assert.deepEqual([result.draft.status, result.draft.errorCode, result.draft.result], ["failed", code, null], code);
    assert.doesNotMatch(dumpAll(result.database), /fake refusal/u);
  }
});

test("TK-51 시간: 응답 ID 없이 남은 초안과 조회 404는 10분이 지나면 expired·unknown으로 두고 예약은 그대로(D-3), 10분 전 404는 unknown", async (t) => {
  installNetworkTrap(t);
  const setup = async () => {
    const { database, env } = blogDb();
    await setLimits(env);
    const openai = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_6") }]);
    const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
    return { database, env, id: made.json.data.draft.id, reserved: usageRows(database)[0].estimated_cost_micro_usd };
  };
  const late = await setup();
  const lateResult = await work(late.env, `/blog/drafts/${late.id}`, { openaiFetch: scriptedOpenAi([{ kind: "retrieve", respond: httpError(404) }]).fetcher, now: NOW + 10 * 60_000 + 1_000 });
  assert.deepEqual([lateResult.json.data.draft.status, lateResult.json.data.draft.errorCode], ["expired", "AI_RESULT_EXPIRED"]);
  assert.equal(usageRows(late.database)[0].estimated_cost_micro_usd, late.reserved, "expired는 미리 더한 값을 그대로 둠");
  const early = await setup();
  const earlyResult = await work(early.env, `/blog/drafts/${early.id}`, { openaiFetch: scriptedOpenAi([{ kind: "retrieve", respond: httpError(404) }]).fetcher, now: NOW + 9 * 60_000 + 59_000 });
  assert.deepEqual([earlyResult.json.data.draft.status, earlyResult.json.data.draft.errorCode], ["unknown", "AI_STATE_UNKNOWN"]);

  const orphan = await setup();
  orphan.database.exec(`UPDATE blog_drafts SET openai_response_id = NULL, status = 'queued' WHERE id = '${orphan.id}'`);
  const noCall = scriptedOpenAi();
  assert.equal((await work(orphan.env, `/blog/drafts/${orphan.id}`, { openaiFetch: noCall.fetcher, now: NOW + 60_000 })).json.data.draft.status, "queued");
  assert.equal((await work(orphan.env, `/blog/drafts/${orphan.id}`, { openaiFetch: noCall.fetcher, now: NOW + 11 * 60_000 })).json.data.draft.status, "unknown");
  assert.equal(noCall.calls.length, 0, "응답 ID가 없으면 OpenAI를 부르지 않음");
});

test("TK-64 두 창이 같은 초안을 동시에 받아도 결과 저장·비용 바로잡기는 1번만", async (t) => {
  installNetworkTrap(t);
  const { database, db, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_7") },
    { kind: "retrieve", respond: completed("resp_fake_7", sampleResult()) },
    { kind: "retrieve", respond: completed("resp_fake_7", sampleResult(), { input_tokens: 9000, output_tokens: 9000 }) },
  ]);
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
  const id = made.json.data.draft.id;
  let inner;
  // 첫 창이 결과를 받아 저장하기 직전에 둘째 창이 먼저 받아 저장한다.
  db.beforeNextBatch = async () => {
    inner = await work(env, `/blog/drafts/${id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
  };
  const outer = await work(env, `/blog/drafts/${id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
  assert.deepEqual([inner.json.data.draft.status, outer.json.data.draft.status], ["completed", "completed"]);
  const actual = Math.ceil((9000 * 2_000_000 + 9000 * 10_000_000) / 1_000_000);
  assert.deepEqual(usageRows(database).map((row) => [row.create_requests, row.estimated_cost_micro_usd, row.input_tokens, row.output_tokens]), [[1, actual, 9000, 9000]], "먼저 저장한 쪽 1번만");
  assert.equal(draftRows(database)[0].actual_cost_micro_usd, actual);
});

test("TK-65 확정·취소: 완료 전 확정은 409, 확정은 감사 blog.confirm, 두 번 닫으면 409, 진행 중 취소는 OpenAI 취소 1번(이미 끝난 작업 404도 성공), 닫힌 초안은 다시 조회하지 않음", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_8") },
    { kind: "retrieve", respond: completed("resp_fake_8", sampleResult()) },
    { kind: "create", respond: created("resp_fake_9") },
    { kind: "cancel", respond: httpError(404) },
  ]);
  const first = (await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher })).json.data.draft;
  const early = await work(env, `/blog/drafts/${first.id}/confirm`, { method: "POST", body: {}, openaiFetch: openai.fetcher });
  assert.deepEqual([early.status, early.json.error.code], [409, "DRAFT_STATE_CONFLICT"]);
  await work(env, `/blog/drafts/${first.id}`, { openaiFetch: openai.fetcher, now: NOW + 5_000 });
  const confirmed = await work(env, `/blog/drafts/${first.id}/confirm`, { method: "POST", body: {}, openaiFetch: openai.fetcher, now: NOW + 6_000 });
  assert.deepEqual([confirmed.status, confirmed.json.data.draft.closed, confirmed.json.data.draft.closedAt], [200, "confirmed", new Date(NOW + 6_000).toISOString()]);
  assert.equal((await work(env, `/blog/drafts/${first.id}/confirm`, { method: "POST", body: {}, openaiFetch: openai.fetcher })).status, 409);
  assert.equal((await work(env, `/blog/drafts/${first.id}/cancel`, { method: "POST", body: {}, openaiFetch: openai.fetcher })).status, 409);
  assert.equal((await work(env, `/blog/drafts/${first.id}/confirm`, { method: "POST", body: { force: true }, openaiFetch: openai.fetcher })).status, 400);

  const second = (await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher })).json.data.draft;
  const cancelled = await work(env, `/blog/drafts/${second.id}/cancel`, { method: "POST", body: {}, openaiFetch: openai.fetcher });
  assert.deepEqual([cancelled.status, cancelled.json.data.draft.closed], [200, "cancelled"]);
  const reopened = await work(env, `/blog/drafts/${second.id}`, { openaiFetch: openai.fetcher });
  assert.equal(reopened.json.data.draft.status, "queued", "닫힌 초안은 OpenAI를 다시 부르지 않음");
  assert.deepEqual([openai.calls.map((call) => call.kind), openai.violations], [["create", "retrieve", "create", "cancel"], []]);
  assert.deepEqual(auditRows(database).map((row) => row.action), ["settings.update", "blog.create", "blog.confirm", "blog.create", "blog.cancel"]);

  const list = await work(env, "/blog/drafts");
  assert.deepEqual(list.json.data.items.map((item) => [item.id, item.closed]), [[second.id, "cancelled"], [first.id, "confirmed"]]);
  assert.equal(list.json.data.items[1].title, "리더스시티 5블록 단지 소개");
  assert.equal((await work(env, "/blog/drafts/not-a-uuid")).status, 404);
  assert.equal((await work(env, "/blog/drafts/00000000-0000-4000-8000-999999999999")).status, 404);
});

test("TK-66 글 초안 쓰기의 Origin·CSRF 틀림은 403이고 신원 있는 거부로 남으며 초안·사용량·OpenAI 0", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi();
  const raw = async (headers) => {
    const request = new Request(`${ORIGIN}/api/admin/v1/work/blog/drafts`, { method: "POST", headers: { "Cf-Access-Jwt-Assertion": await signToken(), "Content-Type": "application/json", ...headers }, body: JSON.stringify({ source: COMPLEX, style: "plain" }) });
    const { handleAdminApi } = await import("../worker/admin-api.mjs");
    const { authenticate } = await import("./work-test-kit.mjs");
    const response = await handleAdminApi(request, env, { authenticate, work: { now: () => NOW, openaiFetch: openai.fetcher } });
    return { status: response.status, json: await response.json() };
  };
  const { createWorkCsrfToken } = await import("../worker/work-security.mjs");
  const token = await createWorkCsrfToken("owner@example.com", SECRET, NOW);
  assert.deepEqual([(await raw({ Origin: "https://evil.example", "X-Admin-CSRF": token })).json.error.code], ["ORIGIN_DENIED"]);
  assert.deepEqual([(await raw({ Origin: ORIGIN })).json.error.code], ["CSRF_INVALID"]);
  assert.deepEqual(auditRows(database).slice(1).map((row) => [row.action, row.outcome, row.reason]), [["request.denied", "denied", "ORIGIN_DENIED"], ["request.denied", "denied", "CSRF_INVALID"]]);
  assert.deepEqual([openai.calls.length, draftRows(database).length, usageRows(database).length], [0, 0, 0]);
});

test("TK-50·D-5 03:00 보관 정리: 실거래가 꺼져 있어도 다 씀·취소 30일 지난 초안은 지우고, 닫지 않은 30일 초안은 auto로 닫고, auto 30일 뒤 지움 — 다른 시각·구조 3이면 하지 않음", async () => {
  const at = Date.parse("2026-11-17T18:05:00.000Z"); // 한국 11-18 03:05
  const day = 24 * 60 * 60 * 1000;
  const iso = (ms) => new Date(ms).toISOString();
  const seed = (database) => {
    const insert = database.prepare(`INSERT INTO blog_drafts (id, source_type, source_id, source_title, status, closed, model, reasoning_effort, disclosure_json, usage_day, reserved_cost_micro_usd, created_at, updated_at, closed_at)
      VALUES (?, 'complex', 'leaders-city-5', '리더스시티 5블록', 'completed', ?, 'm', 'xhigh', '{}', '2026-10-01', 0, ?, ?, ?)`);
    insert.run("confirmed-old", "confirmed", iso(at - 40 * day), iso(at - 40 * day), iso(at - 31 * day));
    insert.run("cancelled-new", "cancelled", iso(at - 40 * day), iso(at - 40 * day), iso(at - 29 * day));
    insert.run("open-old", null, iso(at - 31 * day), iso(at - 31 * day), null);
    insert.run("open-new", null, iso(at - 29 * day), iso(at - 29 * day), null);
    insert.run("auto-old", "auto", iso(at - 70 * day), iso(at - 70 * day), iso(at - 31 * day));
  };
  const { database, db } = freshDb();
  seed(database);
  const log = [];
  const result = await runRealpriceCron({ WORK_DB: db }, { db, now: () => at, log: (entry) => log.push(entry), fetcher: async () => assert.fail("외부 요청 0") });
  assert.equal(result.outcome, "disabled", "실거래가는 꺼진 그대로");
  assert.deepEqual(rows(database, "SELECT id, closed FROM blog_drafts ORDER BY id").map((row) => [row.id, row.closed]), [["cancelled-new", "cancelled"], ["open-new", null], ["open-old", "auto"]]);
  assert.deepEqual(log, [{ event: "blog_cleanup", deleted: 2, autoClosed: 1 }]);

  const other = freshDb();
  seed(other.database);
  await runRealpriceCron({ WORK_DB: other.db }, { db: other.db, now: () => at + 10 * 60_000, log: () => {} });
  assert.equal(rows(other.database, "SELECT COUNT(*) AS n FROM blog_drafts")[0].n, 5, "03:10 이후는 하지 않음");
  assert.equal(other.db.stats.statements, 0, "켜기 값이 없고 03시 차례가 아니면 D1 0");

  const old = new DatabaseSync(":memory:");
  for (const sql of allMigrationSql.slice(0, 3)) old.exec(sql);
  const oldDb = createD1(old);
  assert.deepEqual(await runRealpriceCron({ WORK_DB: oldDb }, { db: oldDb, now: () => at, log: () => {} }), { outcome: "disabled" }, "구조 3(0004 전)이면 건너뜀");
});

test("TK-68 가짜 키 표식은 OpenAI 요청 머리줄에만 쓰이고 응답·로그·D1에 0, 시험 파일은 실제 OpenAI 환경값을 읽지 않으며 CSP에 OpenAI 주소 없음", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_10") }, { kind: "retrieve", respond: completed("resp_fake_10", sampleResult()) }]);
  const logs = [];
  const responses = [];
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry) });
  responses.push(made.json);
  responses.push((await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, auditLog: (entry) => logs.push(entry), now: NOW + 5_000 })).json);
  responses.push((await work(env, "/public-tools/session")).json);
  responses.push((await work(env, "/blog/limits")).json);
  assert.ok(openai.calls.every((call) => call.authIsFakeKey));
  assert.doesNotMatch(JSON.stringify([responses, logs, dumpAll(database)]), /ZZOPENAI/u);
  for (const name of (await readdir(new URL("./", import.meta.url))).filter((file) => /blog|openai/u.test(file) && file.endsWith(".mjs"))) {
    const source = await readFile(new URL(`./${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, new RegExp(["process", "env", "OPENAI"].join("\\.\\s*"), "u"), `${name}: 실제 환경값을 읽지 않음`);
  }
  const headers = await readFile(new URL("../public/_headers", import.meta.url), "utf8");
  assert.doesNotMatch(headers, /api\.openai\.com/u);
});

test("buildOpenAiRequest는 설정의 모델·추론 수준·출력 상한만 쓰고 모델 이름을 코드에 박지 않음", () => {
  const body = buildOpenAiRequest({ model: "any-model-name", effort: "high", maxOutputTokens: 1234 }, { kind: "complex" });
  assert.deepEqual([body.model, body.reasoning.effort, body.max_output_tokens, body.store, body.background], ["any-model-name", "high", 1234, false, true]);
});

test("OpenAI 응답 읽기 보강(TR-11 #87): 사용량이 없으면 usageKnown false(예약 최대 비용을 그대로 남김), Secret 끝 줄바꿈은 지우고 보냄", async () => {
  const { openaiRequest, readResponseOutput } = await import("../worker/openai-client.mjs");
  assert.equal(readResponseOutput({ status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5 } }).usageKnown, true);
  for (const usage of [undefined, {}, { input_tokens: 10 }, { input_tokens: -1, output_tokens: 5 }, { input_tokens: "10", output_tokens: 5 }]) {
    assert.equal(readResponseOutput({ status: "completed", output: [], usage }).usageKnown, false, JSON.stringify(usage));
  }
  let sent = null;
  const fetcher = async (url, init) => {
    sent = init.headers.Authorization;
    return new Response(JSON.stringify({ id: "resp_x", status: "queued" }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  await openaiRequest("/responses/resp_x", {}, { OPENAI_API_KEY: "sk-test-fake-key\n" }, fetcher);
  assert.equal(sent, "Bearer sk-test-fake-key");
});

test("2026-11-23 글 초안 개선: 단지 글은 단지 자료 7개 항목을 함께 보내고 길이·구성 지시를 붙이며, 새 꼴 결과는 소제목·확인할 점과 함께 저장하고 그 칸도 검사함", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const sectioned = {
    title: "리더스시티 5블록 단지 소개",
    sections: [
      { heading: "단지 개요", paragraphs: ["16개동 2,135세대 단지입니다.", "분양 1,423세대와 10년 공공임대 712세대가 함께 있습니다."] },
      { heading: "면적 구성", paragraphs: ["전용 51.89㎡는 126세대입니다."] },
      { heading: "교육", paragraphs: ["천동중학교는 2027년 3월 개교 예정입니다."] },
      { heading: "3억 원대 시세", paragraphs: ["가격은 현장에서 확인합니다."] },
    ],
    checklist: ["- 동·층·방향을 낮과 저녁에 확인", "실제 배정학교는 교육청 자료로 확인"],
    hashtags: ["대전동구"],
    snsShort: "리더스시티 5블록 단지 소개 글입니다.",
    factsUsed: ["16개동 · 2,135세대"],
  };
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_long") },
    { kind: "retrieve", respond: completed("resp_fake_long", sectioned) },
  ]);
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const [call] = openai.calls;
  const payload = JSON.parse(call.body.input[0].content[0].text);
  const expected = findBlogSource(blogSources(), "complex", "leaders-city-5").facts.details;
  assert.deepEqual(payload.complex.details, expected, "보내는 단지 자료 = 숫자 검사가 보는 자료");
  assert.deepEqual(Object.keys(payload.complex.details), ["highlights", "unitGroups", "supplySummary", "livingSections", "amenityGroups", "checkpoints", "faqs"]);
  assert.doesNotMatch(call.body.input[0].content[0].text, /"seo"|"sources"|"image"|"aliases"|relatedContentIds|\.webp/u, "출처·검색 설정·사진·별칭·관련 콘텐츠는 보내지 않음");
  for (const phrase of ["소제목(heading) 4 ~ 6개", "1,200 ~ 2,000자", "억지로 늘리지 않는다", "현장에서 확인할 점", "현장 메모"]) assert.ok(call.body.instructions.includes(phrase), phrase);
  assert.deepEqual(call.body.text.format.schema.properties.sections.items.required, ["heading", "paragraphs"]);

  const done = await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 10_000 });
  const finished = done.json.data.draft;
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.result.headings, ["단지 개요", "", "면적 구성", "교육", "3억 원대 시세"]);
  assert.equal(finished.result.paragraphs.length, 5);
  assert.deepEqual(finished.result.checklist, ["동·층·방향을 낮과 저녁에 확인", "실제 배정학교는 교육청 자료로 확인"]);
  assert.deepEqual(finished.checks.blocks.map((item) => [item.kind, item.where]), [["complex_number", "h5"]], "자료에 있는 면적·날짜는 통과, 소제목의 금액은 막음");
  const [row] = draftRows(database);
  assert.ok(row.result_json.length < 60000);

  // 같은 화면이 다시 계산해도 서버 검사와 같음(화면은 currentSource로 같은 함수를 부름).
  assert.deepEqual(checkBlogDraft(finished.result, { source: finished.currentSource, inputs: finished.inputs, emphasis: finished.emphasisNumbers }), finished.checks);
});

test("2026-11-23 옛 꼴 초안(소제목 없음)은 D1에 있던 그대로 열리고 검사도 그대로", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([
    { kind: "create", respond: created("resp_fake_old") },
    { kind: "retrieve", respond: completed("resp_fake_old", sampleResult()) },
  ]);
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: COMPLEX, style: "plain" }, openaiFetch: openai.fetcher });
  const done = await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 10_000 });
  const result = done.json.data.draft.result;
  assert.deepEqual(Object.keys(result), ["title", "paragraphs", "hashtags", "snsShort", "factsUsed"]);
  assert.equal(result.headings, undefined);
  const reopened = await work(env, `/blog/drafts/${made.json.data.draft.id}`, { openaiFetch: openai.fetcher, now: NOW + 20_000 });
  assert.deepEqual(reopened.json.data.draft.result, result);
  assert.equal(openai.calls.length, 2, "완료된 초안을 다시 열어도 OpenAI를 다시 부르지 않음");
  assert.equal(draftRows(database).length, 1);
});

test("2026-11-23 대표 현장 메모: 500자까지 받고 숫자 표기만 남기는 규칙은 그대로(글은 저장하지 않음)", async (t) => {
  installNetworkTrap(t);
  const { database, env } = blogDb();
  await setLimits(env);
  const openai = scriptedOpenAi([{ kind: "create", respond: created("resp_fake_memo") }]);
  const memo = `2024년 욕실 수리, 남향 거실, 앞 동 없이 트인 전망 ${"가".repeat(500 - 31)}`.slice(0, 500);
  assert.equal(memo.length, 500);
  const made = await work(env, "/blog/drafts", { method: "POST", body: { source: LISTING, style: "plain", inputs: listingInputs(), emphasis: memo }, openaiFetch: openai.fetcher });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(JSON.parse(openai.calls[0].body.input[0].content[0].text).emphasis, memo);
  const [row] = draftRows(database);
  assert.doesNotMatch(row.disclosure_json, /욕실|트인 전망/u, "메모 글은 저장하지 않음");
  assert.equal(JSON.parse(row.disclosure_json).emphasisNumbers, "", "날짜·금액·면적·층 표기가 없으면 빈 글자('2024년'만은 날짜 표기가 아님)");
  assert.equal(emphasisNumbersOf(`${"2억 6,000만 원 ".repeat(60)}`).length, EMPHASIS_MAX, "숫자 표기 모음도 500자까지");
});
