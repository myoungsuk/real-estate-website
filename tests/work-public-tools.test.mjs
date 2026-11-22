// 단계 P(공개 자료 도구) API 시험: 켜기 값 분리(단계 2와 따로), 설정 빠짐, 구조 번호, Access, 경로 경계, 쓰기 보호, 갱신 상태·지금 다시 받기.
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0003을 적용해 D1처럼 쓰고, Access JWT는 jose로 서명한다. 자료는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import { SignJWT, generateKeyPair, jwtVerify } from "jose";
import { authenticateAccess } from "../worker/access-auth.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createCsrfToken } from "../worker/admin-security.mjs";
import { getRealpriceConfigState, isPublicToolsRoute } from "../worker/work-public-tools.mjs";
import { runRealpriceCron } from "../worker/work-scheduled.mjs";
import { createWorkCsrfToken } from "../worker/work-security.mjs";
import { FAKE_SERVICE_KEY, recordingFetcher } from "./realprice-fixtures.mjs";
import { AUD, NOW, ORIGIN, OWNER, SECRET, TEAM, authenticate, freshDb, nextUuid, rows, signToken, work, workEnv } from "./work-test-kit.mjs";

const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// 단계 P만 켠 환경(단계 2 켜기 값 없음).
const stagePEnv = (db, extra = {}) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY, ...extra });

const auditRows = (database) => rows(database, "SELECT action, outcome, reason FROM audit_events ORDER BY seq");

// Origin·CSRF를 직접 정하는 쓰기 요청.
async function rawWrite(env, path, { origin = ORIGIN, csrf, contentType = "application/json", body = {} } = {}) {
  const headers = { "Cf-Access-Jwt-Assertion": await signToken(), "Content-Type": contentType };
  if (origin) headers.Origin = origin;
  if (csrf !== undefined) headers["X-Admin-CSRF"] = csrf;
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => NOW, auditLog: () => {}, randomUUID: nextUuid } });
  return { status: response.status, json: await response.json() };
}

test("경로 경계: /public-tools·/realprice·/blog와 그 아래만 단계 P로, /realpricex·/blogs·/public-toolsx는 단계 2 쪽에 남음", () => {
  for (const route of ["/public-tools", "/public-tools/session", "/realprice", "/realprice/status", "/realprice/refresh", "/blog", "/blog/drafts"]) assert.equal(isPublicToolsRoute(route), true, route);
  for (const route of ["/realpricex", "/realprice-status", "/blogs", "/public-toolsx", "/session", "/customers", "/"]) assert.equal(isPublicToolsRoute(route), false, route);
});

test("TK-01 단계 P 켜기 값 둘 다 없으면 /work/public-tools/session은 200 { realpriceEnabled: false, blogEnabled: false, csrfToken: null }, D1 호출 0번", async () => {
  for (const extra of [{}, { WORK_BLOG_ENABLED: "TRUE" }, { WORK_BLOG_ENABLED: "1" }]) {
    const { db } = freshDb();
    const env = workEnv(db, { WORK_TOOLS_ENABLED: undefined, ...extra });
    const result = await work(env, "/public-tools/session");
    assert.equal(result.status, 200);
    assert.deepEqual(result.json.data, { realpriceEnabled: false, blogEnabled: false, administrator: "o****@example.com", csrfToken: null, schemaVersion: null });
    assert.equal(db.stats.statements, 0);
  }
  // P3부터: 글 초안 켜기 값은 true인데 OpenAI 설정이 없으면 세션도 503 BLOG_CONFIG_MISSING(실거래가 설정 누락과 같은 규칙), D1 호출 0번.
  const { db } = freshDb();
  const missing = await work(workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_BLOG_ENABLED: "true" }), "/public-tools/session");
  assert.deepEqual([missing.status, missing.json.error.code, db.stats.statements], [503, "BLOG_CONFIG_MISSING", 0]);
});

test("TK-02 WORK_REALPRICE_ENABLED가 없음·TRUE·1·' true'이면 /work/realprice/*는 503 REALPRICE_DISABLED, D1 호출 0번", async () => {
  for (const value of [undefined, "TRUE", "1", " true", "yes"]) {
    for (const path of ["/realprice/status", "/realprice/trades", "/realprice"]) {
      const { db } = freshDb();
      const result = await work(stagePEnv(db, { WORK_REALPRICE_ENABLED: value }), path);
      assert.equal(result.status, 503, `${value} ${path}`);
      assert.equal(result.json.error.code, "REALPRICE_DISABLED");
      assert.equal(db.stats.statements, 0, "꺼진 기능의 거부는 D1에 쓰지 않음");
    }
  }
  const { db } = freshDb();
  const write = await work(stagePEnv(db, { WORK_REALPRICE_ENABLED: undefined }), "/realprice/refresh", { method: "POST", body: {} });
  assert.deepEqual([write.status, write.json.error.code, db.stats.statements], [503, "REALPRICE_DISABLED", 0]);
});

test("TK-03 켜기 값은 true인데 인증키 없음·20자 미만·CSRF Secret 32자 미만·허용 출처 해석 실패·D1 없음이면 503 REALPRICE_CONFIG_MISSING, 응답에 Secret 이름·값 없음", async () => {
  for (const [name, extra] of [
    ["인증키 없음", { MOLIT_RT_SERVICE_KEY: undefined }],
    ["인증키 19자", { MOLIT_RT_SERVICE_KEY: "k".repeat(19) }],
    ["CSRF Secret 31자", { ADMIN_CSRF_SECRET: "s".repeat(31) }],
    ["허용 출처 해석 실패", { ADMIN_ALLOWED_ORIGINS: "http://leaderscityhappy.com" }],
    ["D1 없음", { WORK_DB: undefined }],
  ]) {
    const { db } = freshDb();
    const env = stagePEnv(db, extra);
    for (const path of ["/realprice/status", "/public-tools/session"]) {
      const result = await work(env, path);
      assert.equal(result.status, 503, `${name} ${path}`);
      assert.equal(result.json.error.code, "REALPRICE_CONFIG_MISSING", name);
      const text = JSON.stringify(result.json);
      for (const secretName of ["MOLIT_RT_SERVICE_KEY", "ADMIN_CSRF_SECRET", "WORK_REALPRICE_ENABLED", FAKE_SERVICE_KEY]) assert.equal(text.includes(secretName), false, `${name}: ${secretName}`);
    }
  }
  assert.equal(getRealpriceConfigState(stagePEnv(freshDb().db, { MOLIT_RT_SERVICE_KEY: ` ${"k".repeat(19)} ` })), "config_missing", "앞뒤 공백은 길이에서 뺌");
  assert.equal(getRealpriceConfigState(stagePEnv(freshDb().db, { MOLIT_RT_SERVICE_KEY: "k".repeat(20) })), "enabled");
});

test("TK-04 단계 2만 켜면 /work/session과 단계 2 경로는 지금 그대로, /work/realprice/*·/work/blog/*는 503", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const session = await work(env, "/session");
  assert.equal(session.status, 200);
  assert.deepEqual(Object.keys(session.json.data), ["enabled", "filesEnabled", "aiEnabled", "administrator", "csrfToken", "schemaVersion", "aiWarnings"]);
  assert.deepEqual([session.json.data.enabled, session.json.data.schemaVersion], [true, 6]);
  const customer = await work(env, "/customers", { method: "POST", body: { displayName: "가상 손님" } });
  assert.equal(customer.status, 201, JSON.stringify(customer.json));
  assert.equal((await work(env, "/customers")).status, 200);
  assert.equal((await work(env, "/realprice/status")).json.error.code, "REALPRICE_DISABLED");
  const blog = await work(env, "/blog/drafts");
  assert.deepEqual([blog.status, blog.json.error.code], [503, "BLOG_DISABLED"]);
  const tools = await work(env, "/public-tools/session");
  assert.deepEqual([tools.status, tools.json.data.realpriceEnabled, tools.json.data.csrfToken], [200, false, null]);
  const stage2Unknown = await work(env, "/realpricex");
  assert.deepEqual([stage2Unknown.status, stage2Unknown.json.error.code], [404, "NOT_FOUND"], "/realpricex는 단계 2 쪽 404");
});

test("TK-05 단계 P만 켜면 /work/realprice/* 동작, 단계 2 경로는 503 WORK_DISABLED, /work/session은 200 enabled: false", async () => {
  const { db } = freshDb();
  const env = stagePEnv(db);
  const statusResult = await work(env, "/realprice/status");
  assert.equal(statusResult.status, 200);
  assert.equal((await work(env, "/customers")).json.error.code, "WORK_DISABLED");
  assert.equal((await work(env, "/realpricex")).json.error.code, "WORK_DISABLED", "/realpricex는 단계 2 쪽");
  const session = await work(env, "/session");
  assert.deepEqual([session.status, session.json.data.enabled, session.json.data.csrfToken], [200, false, null]);
  const tools = await work(env, "/public-tools/session");
  assert.equal(tools.status, 200);
  assert.deepEqual([tools.json.data.realpriceEnabled, tools.json.data.blogEnabled, tools.json.data.schemaVersion], [true, false, 6]);
  assert.match(tools.json.data.csrfToken, /^[0-9]+\.[A-Za-z0-9_-]+$/u);
  assert.equal((await work(env, "/blog/drafts")).json.error.code, "BLOG_DISABLED", "글 초안 켜기 값이 없으면 꺼짐");
  for (const path of ["/public-tools", "/public-tools/other", "/realprice", "/realprice/other"]) {
    const result = await work(env, path);
    assert.deepEqual([result.status, result.json.error.code], [404, "NOT_FOUND"], path);
  }
  const wrongMethod = await work(env, "/realprice/refresh");
  assert.deepEqual([wrongMethod.status, wrongMethod.json.error.code, wrongMethod.response.headers.get("Allow")], [405, "METHOD_NOT_ALLOWED", "POST"]);
  const postStatus = await work(env, "/realprice/status", { method: "POST", body: {} });
  assert.deepEqual([postStatus.status, postStatus.response.headers.get("Allow")], [405, "GET"]);
  const sessionPost = await work(env, "/public-tools/session", { method: "POST", body: {} });
  assert.deepEqual([sessionPost.status, sessionPost.response.headers.get("Allow")], [405, "GET"]);

  const both = freshDb();
  const bothEnv = stagePEnv(both.db, { WORK_TOOLS_ENABLED: "true" });
  assert.equal((await work(bothEnv, "/customers")).status, 200, "둘 다 켜면 둘 다 동작");
  assert.equal((await work(bothEnv, "/realprice/status")).status, 200);
});

test("TK-06 지금 다시 받기에 Origin 틀림·CSRF 없음·틀림·콘텐츠 API 토큰이면 403, 신원 있는 거부는 감사 request.denied 1건, 자료 변화 없음", async () => {
  const contentToken = await createCsrfToken(OWNER, SECRET, NOW);
  const workToken = await createWorkCsrfToken(OWNER, SECRET, NOW);
  for (const [name, options, code] of [
    ["Origin 틀림", { origin: "https://evil.example", csrf: workToken }, "ORIGIN_DENIED"],
    ["Origin 없음", { origin: null, csrf: workToken }, "ORIGIN_DENIED"],
    ["CSRF 없음", {}, "CSRF_INVALID"],
    ["CSRF 틀림", { csrf: `${Math.floor(NOW / 1000)}.AAAA` }, "CSRF_INVALID"],
    ["콘텐츠 API 토큰", { csrf: contentToken }, "CSRF_INVALID"],
  ]) {
    const { database, db } = freshDb();
    const result = await rawWrite(stagePEnv(db), "/realprice/refresh", options);
    assert.deepEqual([result.status, result.json.error.code], [403, code], name);
    assert.deepEqual(auditRows(database), [{ action: "request.denied", outcome: "denied", reason: code }], name);
    assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months")[0].n, 0, `${name}: 자료 변화 없음`);
  }
  const { database, db } = freshDb();
  const notJson = await rawWrite(stagePEnv(db), "/realprice/refresh", { csrf: workToken, contentType: "text/plain" });
  assert.deepEqual([notJson.status, notJson.json.error.code, auditRows(database).length], [415, "CONTENT_TYPE_REQUIRED", 0]);
});

test("TK-07 구조 번호 2(0003 적용 전)·3(0004 적용 전)·4(0005 적용 전)·5(0006 적용 전)·7(앞선 코드로 되돌림)이면 단계 P API는 503 WORK_SCHEMA_OUTDATED·AHEAD이고 신원 있는 거부로 남음", async () => {
  for (const [value, code] of [["2", "WORK_SCHEMA_OUTDATED"], ["3", "WORK_SCHEMA_OUTDATED"], ["4", "WORK_SCHEMA_OUTDATED"], ["5", "WORK_SCHEMA_OUTDATED"], ["7", "WORK_SCHEMA_AHEAD"]]) {
    const { database, db } = freshDb();
    database.exec(`UPDATE settings SET value_json = '${value}' WHERE key = 'schema_version'`);
    for (const path of ["/realprice/status", "/public-tools/session"]) {
      const result = await work(stagePEnv(db), path);
      assert.deepEqual([result.status, result.json.error.code], [503, code], `${value} ${path}`);
    }
    const write = await work(stagePEnv(db), "/realprice/refresh", { method: "POST", body: {} });
    assert.deepEqual([write.status, write.json.error.code], [503, code]);
    assert.deepEqual(auditRows(database).map((row) => row.reason), [code, code, code]);
    assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months")[0].n, 0);
  }
});

test("TK-08 Access JWT 없음·깨짐·위조·만료·허용 목록 밖 이메일이면 단계 P 경로도 기존 401·403이고 D1 호출 0번", async () => {
  // 이 시험만의 Access 키(만료 토큰을 직접 서명하려고). 검증은 단계 2와 같은 authenticateAccess()다.
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  const sign = (key, { email = OWNER, expiresIn = "1h" } = {}) => new SignJWT({ email }).setProtectedHeader({ alg: "RS256" }).setIssuer(TEAM).setAudience(AUD).setSubject("subject-1").setIssuedAt().setExpirationTime(expiresIn).sign(key);
  const ownAuthenticate = (request, env) => authenticateAccess(request, env, async (token, { teamDomain, audience }) => (await jwtVerify(token, publicKey, { issuer: teamDomain, audience, algorithms: ["RS256"] })).payload);
  assert.equal((await handleAdminApi(new Request(`${ORIGIN}/api/admin/v1/work/public-tools/session`, { headers: { "Cf-Access-Jwt-Assertion": await sign(privateKey) } }), stagePEnv(freshDb().db), { authenticate: ownAuthenticate, work: { now: () => NOW } })).status, 200, "같은 키의 정상 토큰은 통과");
  for (const [name, token, status] of [
    ["없음", null, 401],
    ["깨짐", "not-a-jwt", 401],
    ["위조", await sign(otherKey), 401],
    ["만료", await sign(privateKey, { expiresIn: "-1m" }), 401],
    ["허용 밖 이메일", await sign(privateKey, { email: "stranger@example.com" }), 403],
  ]) {
    for (const path of ["/realprice/status", "/public-tools/session", "/blog/drafts"]) {
      const { db } = freshDb();
      const headers = token ? { "Cf-Access-Jwt-Assertion": token } : {};
      const response = await handleAdminApi(new Request(`${ORIGIN}/api/admin/v1/work${path}`, { headers }), stagePEnv(db), { authenticate: ownAuthenticate, work: { now: () => NOW } });
      assert.equal(response.status, status, `${name} ${path}`);
      assert.equal(db.stats.statements, 0, `${name} ${path}: D1 호출 0번`);
    }
  }
});

test("갱신 상태는 읽기만(감사·사용량 쓰기 0) 하고 설계서 22.9절 모양, 읽기 끝 상한을 넘은 날에도 200", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES ('2026-11-17', 2600000)").run();
  const result = await work(stagePEnv(db), "/realprice/status");
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.json.data), ["lastSuccessAt", "coveredThrough", "backfill", "recordHighReady", "lastError", "warnings", "today", "unmatchedSaleRows", "runs"]);
  assert.deepEqual(result.json.data.warnings, [{ code: "RT_READ_BUDGET", level: "hard", count: 2600000, months: [] }]);
  assert.equal(db.stats.batches.length, 0);
  assert.deepEqual(auditRows(database), [], "보기 요청은 감사 기록 없음(22.12절)");
  assert.equal(rows(database, "SELECT rows_read FROM rt_daily_usage")[0].rows_read, 2600000, "상태 보기 읽기는 사용량에 더하지 않음");
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
});

test("TK-29 지금 다시 받기: 외부 요청 0번, 최근 4개월 12행이 지금 차례, estimatedMinutes 120(다른 달이 5건 기다려도 최근 달이 먼저라 같음), 감사 realprice.refresh 1건, 다음 Cron부터 1건씩", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  const env = stagePEnv(db);
  // 외부 요청 0번: 다시 받기 요청이 도는 동안 전역 fetch를 가로채 센다(PR #76 TR-11 49.4: 예전 assert는 늘 참이었음).
  const originalFetch = globalThis.fetch;
  const outbound = [];
  globalThis.fetch = async (...args) => {
    outbound.push(String(args[0]?.url ?? args[0]));
    throw new Error("외부 요청 금지");
  };
  let empty;
  try {
    empty = await work(env, "/realprice/refresh", { method: "POST", body: {} });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(outbound, [], "다시 받기 요청은 외부 요청을 보내지 않음");
  assert.equal(empty.status, 200, JSON.stringify(empty.json));
  assert.deepEqual(empty.json.data, { queuedMonths: 12, estimatedMinutes: 120 });
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months WHERE next_due_at = ?", iso(NOW))[0].n, 12);
  assert.deepEqual(auditRows(database), [{ action: "realprice.refresh", outcome: "ok", reason: "queued_months=12" }]);

  for (const ymd of ["202001", "202002", "202003", "202004", "202005"]) {
    database.prepare("INSERT INTO rt_fetch_months (kind, deal_ymd, next_due_at) VALUES ('sale', ?, ?)").run(ymd, iso(NOW - HOUR));
  }
  const later = NOW + HOUR;
  const queued = await work(env, "/realprice/refresh", { method: "POST", body: {}, now: later });
  assert.deepEqual(queued.json.data, { queuedMonths: 12, estimatedMinutes: 120 });
  const bad = await work(env, "/realprice/refresh", { method: "POST", body: { months: 99 }, now: later });
  assert.deepEqual([bad.status, bad.json.error.code], [400, "VALIDATION_FAILED"]);

  const { fetcher, calls } = recordingFetcher(() => new Response("<response><header><resultCode>03</resultCode><resultMsg>NO DATA</resultMsg></header></response>", { status: 200 }));
  await runRealpriceCron(env, { now: () => later + 60_000, fetcher, log: () => {}, randomUUID: nextUuid });
  assert.equal(calls.length, 1, "다음 Cron에서 1건");
  const picked = new URL(calls[0].url).searchParams.get("DEAL_YMD");
  assert.ok(["202611", "202610", "202609", "202608"].includes(picked), `최근 달이 먼저(${picked})`);
});
