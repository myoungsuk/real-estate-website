// 업무 도구 API(단계 2 첫 PR: Worker 기반) 시험. 진짜 SQLite(node:sqlite)에 migrations/work/0001_init.sql을 적용해 D1처럼 쓰고,
// Access JWT는 jose로 직접 서명한 토큰을 기존 authenticateAccess()에 넣어 확인한다(가짜 자료만 쓴다).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { SignJWT, generateKeyPair, jwtVerify } from "jose";
import { authenticateAccess } from "../worker/access-auth.mjs";
import { getAuditActorId, maskEmail } from "../worker/admin-audit.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createCsrfToken } from "../worker/admin-security.mjs";
import { handleRequest, isAdminApiPath } from "../worker/index.mjs";
import {
  MAX_WORK_JSON_BYTES,
  WORK_SCHEMA_VERSION,
  isWorkApiPath,
  withViewAudit,
  writeBatchWithAudit,
} from "../worker/work-api.mjs";
import { createWorkCsrfToken, getWorkConfigState, verifyWorkCsrfToken } from "../worker/work-security.mjs";

const migrationSql = await readFile(new URL("../migrations/work/0001_init.sql", import.meta.url), "utf8");
const migration0002Sql = await readFile(new URL("../migrations/work/0002_deal_schedule_inputs.sql", import.meta.url), "utf8");
const migration0003Sql = await readFile(new URL("../migrations/work/0003_public_realprice.sql", import.meta.url), "utf8");
const migration0004Sql = await readFile(new URL("../migrations/work/0004_blog_drafts.sql", import.meta.url), "utf8");
const migration0005Sql = await readFile(new URL("../migrations/work/0005_ledger.sql", import.meta.url), "utf8");
const ORIGIN = "https://leaderscityhappy.com";
const TEAM = "https://leaderscityhappy.cloudflareaccess.com";
const AUD = "test-audience";
const SECRET = "s".repeat(32);
const NOW = Date.parse("2026-11-17T05:00:00.000Z");
const OWNER = "owner@example.com";
const BACKUP = "backup@example.com";

// node:sqlite를 D1과 같은 모양(prepare→bind→first/run/all, batch)으로 감싼다.
function createD1(database) {
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => database.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values) }),
    run: async () => database.prepare(sql).run(...values),
    _sql: sql,
    _values: values,
  });
  return {
    prepare: (sql) => wrap(sql),
    batch: async (statements) => {
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => database.prepare(statement._sql).run(...statement._values));
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

// 업무 시험 DB: 지금 코드의 구조 번호(0005까지)와 맞게 마이그레이션을 차례로 적용한다. F 시험은 0001만 따로 본다.
function freshDb({ only0001 = false } = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(migrationSql);
  if (!only0001) {
    database.exec(migration0002Sql);
    database.exec(migration0003Sql);
    database.exec(migration0004Sql);
    database.exec(migration0005Sql);
  }
  return { database, db: createD1(database) };
}

const auditRows = (database) => database.prepare("SELECT actor_email, action, outcome, reason, request_id FROM audit_events ORDER BY seq").all().map((row) => ({ ...row }));

const workEnv = (db, extra = {}) => ({
  CF_ACCESS_TEAM_DOMAIN: TEAM,
  CF_ACCESS_AUD: AUD,
  ADMIN_ALLOWED_EMAILS: `${OWNER},${BACKUP}`,
  WORK_TOOLS_ENABLED: "true",
  WORK_DB: db,
  ADMIN_CSRF_SECRET: SECRET,
  ...extra,
});

const { privateKey, publicKey } = await generateKeyPair("RS256");
async function signToken({ email = OWNER, audience = AUD, issuer = TEAM, expiresIn = "1h", key = privateKey } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: "RS256" }).setIssuer(issuer).setAudience(audience)
    .setSubject("subject-1").setIssuedAt().setExpirationTime(expiresIn).sign(key);
}
const verifyLocal = async (token, { teamDomain, audience }) => (await jwtVerify(token, publicKey, { issuer: teamDomain, audience, algorithms: ["RS256"] })).payload;
const authenticate = (request, env) => authenticateAccess(request, env, verifyLocal);

function workRequest(path, { method = "GET", token, headers = {}, body } = {}) {
  return new Request(`${ORIGIN}/api/admin/v1/work${path}`, {
    method,
    headers: {
      ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}),
      ...headers,
    },
    body,
  });
}

async function call(request, env, extra = {}) {
  const response = await handleAdminApi(request, env, { authenticate, ...extra, work: { now: () => NOW, auditLog: () => {}, ...(extra.work ?? {}) } });
  return { response, json: await response.clone().json().catch(() => null) };
}

async function writeHeaders(email = OWNER, extra = {}) {
  return {
    Origin: ORIGIN,
    "Content-Type": "application/json",
    "X-Admin-CSRF": await createWorkCsrfToken(email, SECRET, NOW),
    ...extra,
  };
}

test("업무 경로 판정은 /api/admin/v1/work와 그 아래만 잡고 Worker가 먼저 처리한다", () => {
  assert.equal(isWorkApiPath("/api/admin/v1/work"), true);
  assert.equal(isWorkApiPath("/api/admin/v1/work/session"), true);
  assert.equal(isWorkApiPath("/api/admin/v1/workx"), false);
  assert.equal(isWorkApiPath("/api/admin/v1/session"), false);
  assert.equal(isAdminApiPath("/api/admin/v1/work/session"), true);
});

test("A. Access JWT가 없거나 틀리면 업무 코드 전에 기존 오류로 거부하고 D1에 쓰지 않으며 경고 로그에는 이유와 Ray ID만 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const cases = [
    { name: "JWT 없음", token: undefined, status: 401, code: "AUTH_REQUIRED" },
    { name: "다른 키로 서명", token: await signToken({ key: (await generateKeyPair("RS256")).privateKey }), status: 401, code: "AUTH_INVALID" },
    { name: "만료", token: await signToken({ expiresIn: "-1m" }), status: 401, code: "AUTH_INVALID" },
    { name: "aud 다름", token: await signToken({ audience: "other" }), status: 401, code: "AUTH_INVALID" },
    { name: "iss 다름", token: await signToken({ issuer: "https://evil.cloudflareaccess.com" }), status: 401, code: "AUTH_INVALID" },
    { name: "허용 목록 밖 이메일", token: await signToken({ email: "stranger@example.com" }), status: 403, code: "AUTH_EMAIL_DENIED" },
  ];
  for (const item of cases) {
    const warnings = [];
    const request = workRequest("/session", { token: item.token, headers: { "cf-ray": "8abc123-ICN", "cf-connecting-ip": "203.0.113.7" } });
    const response = await handleAdminApi(request, env, { authenticate, work: { warnLog: (line) => warnings.push(line) } });
    const json = await response.json();
    assert.equal(response.status, item.status, item.name);
    assert.equal(json.error.code, item.code, item.name);
    assert.equal(warnings.length, 1, item.name);
    const logged = JSON.parse(warnings[0]);
    assert.deepEqual(Object.keys(logged).sort(), ["event", "rayId", "reason", "requestId"], item.name);
    assert.equal(logged.reason, item.code);
    assert.equal(logged.rayId, "8abc123-ICN");
    assert.doesNotMatch(warnings[0], /stranger|203\.0\.113|eyJ/u, `${item.name}: 이메일·IP·JWT 없음`);
  }
  assert.equal(auditRows(database).length, 0, "신원 없는 거부는 D1에 쓰지 않음");
});

test("A. 허용 이메일 2개 모두 업무 세션을 받고, 대문자 섞인 JWT 이메일은 소문자로 맞춰 통과한다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  for (const email of [OWNER, BACKUP, "Owner@Example.COM"]) {
    const { response, json } = await call(workRequest("/session", { token: await signToken({ email }) }), env);
    assert.equal(response.status, 200, email);
    assert.equal(json.data.enabled, true);
    assert.equal(json.data.administrator, maskEmail(email.toLowerCase()));
    assert.equal(await verifyWorkCsrfToken(json.data.csrfToken, email.toLowerCase(), SECRET, NOW), true);
  }
});

test("B. 업무 도구는 정확히 \"true\"일 때만 켜지고, 꺼져 있으면 세션 200 enabled:false·그 밖의 경로 503 WORK_DISABLED", async () => {
  const { db } = freshDb();
  const token = await signToken();
  for (const value of [undefined, "false", "FALSE", "TRUE", " true", "1", "yes"]) {
    const env = workEnv(db, { WORK_TOOLS_ENABLED: value });
    assert.equal(getWorkConfigState(env), "disabled", String(value));
    const session = await call(workRequest("/session", { token }), env);
    assert.equal(session.response.status, 200);
    assert.deepEqual(session.json.data, {
      enabled: false, filesEnabled: false, aiEnabled: false, administrator: maskEmail(OWNER), csrfToken: null, schemaVersion: null, aiWarnings: [],
    });
    const other = await call(workRequest("/dashboard", { token }), env);
    assert.equal(other.response.status, 503);
    assert.equal(other.json.error.code, "WORK_DISABLED");
  }
});

test("B. 켰는데 D1·CSRF Secret(32자)·허용 출처 중 하나라도 없으면 세션까지 503 WORK_CONFIG_MISSING, GitHub 설정은 필요 없다", async () => {
  const { db } = freshDb();
  const token = await signToken();
  for (const [name, env] of [
    ["D1 없음", workEnv(undefined)],
    ["Secret 31자", workEnv(db, { ADMIN_CSRF_SECRET: "s".repeat(31) })],
    ["출처 잘못", workEnv(db, { ADMIN_ALLOWED_ORIGINS: "http://leaderscityhappy.com" })],
  ]) {
    const { response, json } = await call(workRequest("/session", { token }), env);
    assert.equal(response.status, 503, name);
    assert.equal(json.error.code, "WORK_CONFIG_MISSING", name);
  }
  const env = workEnv(db);
  assert.equal(env.GITHUB_CONTENTS_TOKEN, undefined);
  const { response, json } = await call(workRequest("/session", { token }), env);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(json.data).sort(), ["administrator", "aiEnabled", "aiWarnings", "csrfToken", "enabled", "filesEnabled", "schemaVersion"]);
  assert.equal(json.data.schemaVersion, WORK_SCHEMA_VERSION);
  assert.equal(json.data.filesEnabled, false);
  assert.equal(json.data.aiEnabled, false);
});

test("B. 업무를 꺼도 기존 콘텐츠 세션·상태 API는 그대로 동작한다", async () => {
  const token = await signToken();
  const env = workEnv(undefined, { WORK_TOOLS_ENABLED: undefined });
  const response = await handleAdminApi(new Request(`${ORIGIN}/api/admin/v1/session`, { headers: { "Cf-Access-Jwt-Assertion": token } }), env, { authenticate });
  const json = await response.json();
  assert.equal(response.status, 200);
  assert.equal(json.data.authenticated, true);
  assert.equal(json.data.writeEnabled, false);
});

test("C. 스키마 번호가 낮거나 없으면 503 WORK_SCHEMA_OUTDATED, 높으면 읽기·쓰기 모두 503 WORK_SCHEMA_AHEAD, D1 오류는 503 STORAGE_UNAVAILABLE", async () => {
  const token = await signToken();
  for (const [name, setup, code] of [
    ["0", (database) => database.exec("UPDATE settings SET value_json = '0' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["행 없음", (database) => database.exec("DELETE FROM settings WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["값 깨짐(abc)", (database) => database.exec("UPDATE settings SET value_json = 'abc' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["값 깨짐({)", (database) => database.exec("UPDATE settings SET value_json = '{' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["숫자 아님(\"2\")", (database) => database.exec("UPDATE settings SET value_json = '\"2\"' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["1(0002 적용 전)", (database) => database.exec("UPDATE settings SET value_json = '1' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["2(0003 적용 전)", (database) => database.exec("UPDATE settings SET value_json = '2' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["3(0004 적용 전)", (database) => database.exec("UPDATE settings SET value_json = '3' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["4(0005 적용 전)", (database) => database.exec("UPDATE settings SET value_json = '4' WHERE key = 'schema_version'"), "WORK_SCHEMA_OUTDATED"],
    ["6", (database) => database.exec("UPDATE settings SET value_json = '6' WHERE key = 'schema_version'"), "WORK_SCHEMA_AHEAD"],
  ]) {
    const { database, db } = freshDb();
    setup(database);
    const env = workEnv(db);
    const read = await call(workRequest("/session", { token }), env);
    assert.equal(read.response.status, 503, name);
    assert.equal(read.json.error.code, code, name);
    const write = await call(workRequest("/pipeline-check", { method: "POST", token, headers: await writeHeaders(), body: "{}" }), env);
    assert.equal(write.response.status, 503, name);
    assert.equal(write.json.error.code, code, name);
    assert.ok(auditRows(database).every((row) => row.outcome === "denied" && row.reason === code), name);
  }
  const empty = new DatabaseSync(":memory:");
  const notMigrated = await call(workRequest("/session", { token }), workEnv(createD1(empty)));
  assert.equal(notMigrated.response.status, 503, "마이그레이션 전 D1(표 없음)");
  assert.equal(notMigrated.json.error.code, "WORK_SCHEMA_OUTDATED");
  assert.equal(notMigrated.json.error.retryable, false);
  const broken = { prepare: () => { throw new Error("d1 down"); }, batch: async () => { throw new Error("d1 down"); } };
  const { response, json } = await call(workRequest("/session", { token }), workEnv(broken));
  assert.equal(response.status, 503);
  assert.equal(json.error.code, "STORAGE_UNAVAILABLE");
  assert.equal(json.error.retryable, true);
});

test("D. 쓰기는 같은 출처 Origin·JSON·업무 CSRF를 모두 통과해야 하고, 신원 있는 거부는 D1에 denied로 남는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  const valid = await writeHeaders();
  const contentToken = await createCsrfToken(OWNER, SECRET, NOW);
  const cases = [
    ["Origin 없음", { ...valid, Origin: undefined }, 403, "ORIGIN_DENIED"],
    ["Origin 다름", { ...valid, Origin: "https://evil.example" }, 403, "ORIGIN_DENIED"],
    ["JSON 아님", { ...valid, "Content-Type": "text/plain" }, 415, "CONTENT_TYPE_REQUIRED"],
    ["CSRF 없음", { ...valid, "X-Admin-CSRF": undefined }, 403, "CSRF_INVALID"],
    ["CSRF 위조", { ...valid, "X-Admin-CSRF": `${Math.floor(NOW / 1000)}.AAAA` }, 403, "CSRF_INVALID"],
    ["2시간 1초 지남", { ...valid, "X-Admin-CSRF": await createWorkCsrfToken(OWNER, SECRET, NOW - (2 * 60 * 60 + 1) * 1000) }, 403, "CSRF_INVALID"],
    ["발급이 미래", { ...valid, "X-Admin-CSRF": await createWorkCsrfToken(OWNER, SECRET, NOW + 120 * 1000) }, 403, "CSRF_INVALID"],
    ["다른 이메일로 발급", { ...valid, "X-Admin-CSRF": await createWorkCsrfToken(BACKUP, SECRET, NOW) }, 403, "CSRF_INVALID"],
    ["콘텐츠 API 토큰", { ...valid, "X-Admin-CSRF": contentToken }, 403, "CSRF_INVALID"],
  ];
  for (const [name, headers, status, code] of cases) {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== undefined));
    const { response, json } = await call(workRequest("/pipeline-check", { method: "POST", token, headers: clean, body: "{}" }), env);
    assert.equal(response.status, status, name);
    assert.equal(json.error.code, code, name);
  }
  const rows = auditRows(database);
  assert.equal(rows.length, 8, "Origin·CSRF 거부만 기록(JSON 아님 415는 기록하지 않음)");
  assert.ok(rows.every((row) => row.actor_email === OWNER && row.action === "request.denied" && row.outcome === "denied"));
  assert.deepEqual([...new Set(rows.map((row) => row.reason))].sort(), ["CSRF_INVALID", "ORIGIN_DENIED"]);

  // 경계: 1시간 59분 59초 된 토큰은 통과하고, 아직 쓰기 경로가 없으니 404
  const boundary = await call(workRequest("/pipeline-check", { method: "POST", token, headers: { ...valid, "X-Admin-CSRF": await createWorkCsrfToken(OWNER, SECRET, NOW - (2 * 60 * 60 - 1) * 1000) }, body: "{}" }), env);
  assert.equal(boundary.response.status, 404);
  assert.equal(boundary.json.error.code, "NOT_FOUND");
});

test("D. 업무 세션 토큰으로 업무 쓰기 검사를 통과하고, 그 토큰으로 기존 콘텐츠 저장은 할 수 없다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  const session = await call(workRequest("/session", { token }), env);
  const workToken = session.json.data.csrfToken;
  const pass = await call(workRequest("/pipeline-check", { method: "POST", token, headers: { Origin: ORIGIN, "Content-Type": "application/json", "X-Admin-CSRF": workToken }, body: "{}" }), env);
  assert.equal(pass.response.status, 404, "검사 통과 뒤 아직 없는 경로");
  const contentEnv = { ...env, ADMIN_WRITE_ENABLED: "true", GITHUB_CONTENTS_TOKEN: "test-token", GITHUB_REPOSITORY: "owner/repo", GITHUB_BRANCH: "master" };
  const content = await handleAdminApi(new Request(`${ORIGIN}/api/admin/v1/content/validate`, {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": token, Origin: ORIGIN, "Content-Type": "application/json", "X-Admin-CSRF": workToken },
    body: JSON.stringify({ changes: [] }),
  }), contentEnv, { authenticate, auditLog: () => {} });
  assert.equal(content.status, 403);
  assert.equal((await content.json()).error.code, "CSRF_INVALID");
});

test("D. 본문은 256KB까지 받고 넘으면 413, JSON이 아니면 400, GET은 CSRF 없이 되고 세션의 다른 방식은 405", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  const headers = await writeHeaders();
  const exact = `{"a":"${"x".repeat(MAX_WORK_JSON_BYTES - 8)}"}`;
  assert.equal(new TextEncoder().encode(exact).byteLength, MAX_WORK_JSON_BYTES);
  assert.equal((await call(workRequest("/pipeline-check", { method: "POST", token, headers, body: exact }), env)).response.status, 404);
  const over = `{"a":"${"x".repeat(MAX_WORK_JSON_BYTES - 7)}"}`;
  const tooLarge = await call(workRequest("/pipeline-check", { method: "POST", token, headers, body: over }), env);
  assert.equal(tooLarge.response.status, 413);
  assert.equal(tooLarge.json.error.code, "PAYLOAD_TOO_LARGE");
  const notJson = await call(workRequest("/pipeline-check", { method: "POST", token, headers, body: "{" }), env);
  assert.equal(notJson.response.status, 400);
  assert.equal(notJson.json.error.code, "VALIDATION_FAILED");
  for (const method of ["PUT", "DELETE", "PATCH", "POST"]) {
    const response = (await call(workRequest("/session", { method, token, headers, body: "{}" }), env)).response;
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "GET");
  }
  assert.equal((await call(workRequest("/nothing", { token }), env)).response.status, 404);
});

test("D. 경로 접두어가 겹치거나 ..로 빠져나가는 주소는 업무 분기로 가지 않는다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  const at = (path) => handleAdminApi(new Request(`${ORIGIN}${path}`, { headers: { "Cf-Access-Jwt-Assertion": token } }), env, { authenticate });
  const workx = await at("/api/admin/v1/workx");
  assert.notEqual((await workx.json()).data?.enabled, true);
  const root = await at("/api/admin/v1/work");
  assert.equal(root.status, 404);
  assert.equal((await root.json()).error.code, "NOT_FOUND");
  for (const path of ["/api/admin/v1/work/../session", "/api/admin/v1/work/%2e%2e/session"]) {
    const response = await at(path);
    const json = await response.json();
    assert.equal(response.status, 200, path);
    assert.equal(json.data.authenticated, true, `${path}: 기존 관리자 세션`);
    assert.equal("enabled" in json.data, false);
  }
});

test("E. 보기 도우미는 감사 기록이 실패하면 503 AUDIT_UNAVAILABLE로 자료를 돌려주지 않고, 쓰기는 같은 batch로 함께 실패한다", async () => {
  const { database, db } = freshDb();
  let loaded = 0;
  const entry = { at: new Date(NOW).toISOString(), actorEmail: "Owner@Example.com", action: "customer.view", targetType: "customer", targetId: "c-1", requestId: "r-1" };
  const data = await withViewAudit(db, entry, async () => { loaded += 1; return { secret: "가상 손님" }; });
  assert.deepEqual(data, { secret: "가상 손님" });
  assert.deepEqual(auditRows(database).at(-1), { actor_email: "owner@example.com", action: "customer.view", outcome: "ok", reason: null, request_id: "r-1" });

  const failing = { prepare: (sql) => ({ bind: () => ({ run: async () => { throw new Error("audit down"); } }) }), batch: db.batch };
  await assert.rejects(withViewAudit(failing, entry, async () => { loaded += 1; return {}; }), (error) => error.code === "AUDIT_UNAVAILABLE" && error.status === 503);
  assert.equal(loaded, 1, "감사 실패 뒤에는 자료를 읽지 않음");

  const now = new Date(NOW).toISOString();
  const insert = db.prepare("INSERT INTO customers (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind("c-2", "가상 손님", now, now);
  await writeBatchWithAudit(db, [insert], { ...entry, action: "customer.create", targetId: "c-2" });
  assert.equal(database.prepare("SELECT count(*) AS n FROM customers").get().n, 1);
  const badInsert = db.prepare("INSERT INTO customers (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind("c-3", "가상", now, now);
  const badAudit = { ...entry, actorEmail: "", action: "customer.create", targetId: "c-3" };
  await assert.rejects(writeBatchWithAudit(db, [badInsert], badAudit), (error) => error.code === "STORAGE_UNAVAILABLE");
  assert.equal(database.prepare("SELECT count(*) AS n FROM customers WHERE id = 'c-3'").get().n, 0, "감사 기록이 실패하면 쓰기도 되돌림");
});

test("E. 신원 있는 거부 기록이 실패하거나 D1이 없어도 거부 응답은 그대로이고, Worker 로그에는 이메일 원문 없이 HMAC만 남는다", async () => {
  const token = await signToken();
  const logs = [];
  const { db } = freshDb();
  const flaky = { prepare: (sql) => (sql.startsWith("INSERT INTO audit_events") ? { bind: () => ({ run: async () => { throw new Error("audit down"); } }) } : db.prepare(sql)), batch: db.batch };
  const { response, json } = await call(workRequest("/pipeline-check", { method: "POST", token, headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }), workEnv(flaky), { work: { auditLog: (entry) => logs.push(entry) } });
  assert.equal(response.status, 403);
  assert.equal(json.error.code, "ORIGIN_DENIED");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, await getAuditActorId(OWNER, SECRET));
  assert.doesNotMatch(JSON.stringify(logs), /owner@example\.com/u);
  const disabled = await call(workRequest("/pipeline-check", { method: "POST", token, headers: await writeHeaders(), body: "{}" }), workEnv(undefined, { WORK_TOOLS_ENABLED: "false" }));
  assert.equal(disabled.response.status, 503);
  assert.equal(disabled.json.error.code, "WORK_DISABLED");
  // 꺼져 있으면 D1이 있어도 손님 자료 DB에 거부를 쓰지 않고 HMAC 로그만 남긴다.
  const off = freshDb();
  const offLogs = [];
  const offCall = await call(workRequest("/pipeline-check", { method: "POST", token, headers: await writeHeaders(), body: "{}" }), workEnv(off.db, { WORK_TOOLS_ENABLED: "false" }), { work: { auditLog: (entry) => offLogs.push(entry) } });
  assert.equal(offCall.json.error.code, "WORK_DISABLED");
  assert.equal(auditRows(off.database).length, 0);
  assert.deepEqual(offLogs.map((entry) => [entry.event, entry.reason, entry.actorId]), [["work_denied", "WORK_DISABLED", await getAuditActorId(OWNER, SECRET)]]);
});

test("E. 업무 응답은 no-store·noindex·요청 ID를 달고, 오류 본문에 이메일·Secret·스택이 없다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const token = await signToken();
  for (const request of [
    workRequest("/session", { token }),
    workRequest("/nothing", { token }),
    workRequest("/pipeline-check", { method: "POST", token, headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: "{}" }),
  ]) {
    const { response } = await call(request, env);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Robots-Tag"), "noindex, nofollow, noarchive");
    assert.match(response.headers.get("X-Request-Id") ?? "", /^[0-9a-f-]{36}$/u);
    assert.match(response.headers.get("Content-Type") ?? "", /^application\/json/u);
    const text = await response.text();
    if (response.status >= 400) assert.doesNotMatch(text, /owner@example\.com|s{32}|at \w+ \(|Error:/u);
  }
});

test("F. 0001_init.sql은 테이블 12개·색인 14개·구조 번호 1을 만들고 제약·외래 키·감사 칸 규칙을 지킨다", () => {
  const { database } = freshDb({ only0001: true });
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, ["ai_jobs", "ai_usage_daily", "audit_events", "calendar_feeds", "customers", "deal_events", "deal_parties", "deals", "files", "notes", "settings", "worker_leases"]);
  assert.equal(database.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").get().n, 14);
  assert.equal(JSON.parse(database.prepare("SELECT value_json FROM settings WHERE key = 'schema_version'").get().value_json), 1);
  const now = new Date(NOW).toISOString();
  assert.throws(() => database.prepare("INSERT INTO customers (id, display_name, created_at, updated_at) VALUES ('c', '', ?, ?)").run(now, now), /CHECK/u, "이름 비면 거부");
  assert.throws(() => database.prepare("INSERT INTO customers (id, display_name, status, created_at, updated_at) VALUES ('c', '가상', 'vip', ?, ?)").run(now, now), /CHECK/u);
  assert.throws(() => database.prepare("INSERT INTO notes (id, customer_id, body, created_at, updated_at) VALUES ('n', 'missing', '가상 메모', ?, ?)").run(now, now), /FOREIGN KEY/u);
  assert.throws(() => database.prepare("INSERT INTO audit_events (at, actor_email, action, request_id, outcome) VALUES (?, NULL, 'x', 'r', 'denied')").run(now), /NOT NULL/u);
  assert.throws(() => database.prepare("INSERT INTO audit_events (at, actor_email, action, request_id, outcome) VALUES (?, '', 'x', 'r', 'denied')").run(now), /CHECK/u);
  assert.throws(() => database.prepare("INSERT INTO audit_events (at, actor_email, action, request_id, outcome) VALUES (?, 'a@b.c', 'x', 'r', 'maybe')").run(now), /CHECK/u);
  const auditColumns = database.prepare("PRAGMA table_info(audit_events)").all().map((row) => row.name);
  const fileColumns = database.prepare("PRAGMA table_info(files)").all().map((row) => row.name);
  assert.equal(fileColumns.includes("keep_original"), false, "녹음 원본 보관 선택 칸 없음(DEC-WT-10 기본 1년 보관)");
  assert.equal(fileColumns.includes("faces_masked"), false, "얼굴 가림 칸 없음(DEC-WT-09 앱 안 사진은 가리지 않음)");
  assert.ok(fileColumns.includes("retention_until") && fileColumns.includes("rrn_masked"), "정리 안내 기준일·주민번호 가림 확인 칸은 그대로");
  assert.ok(auditColumns.includes("reason"));
  const allColumns = tables.flatMap((table) => database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  assert.equal(allColumns.filter((name) => /rrn_number|resident|jumin|password|passwd|id_card|account_pin/iu.test(name)).length, 0, "주민번호·비밀번호·신분증 칸 없음");
  assert.throws(() => database.exec(migrationSql), /already exists/u, "같은 파일을 두 번 직접 실행하면 멈춤(다시 적용 방지는 wrangler d1_migrations 기록)");
});

test("G. 업무 Worker 코드는 준비된 문장만 쓰고 SQL에 값을 이어 붙이지 않는다", async () => {
  const files = (await readdir(new URL("../worker/", import.meta.url))).filter((name) => (name.startsWith("work-") || name.startsWith("realprice-")) && name.endsWith(".mjs"));
  assert.ok(files.length >= 2);
  for (const name of files) {
    const source = await readFile(new URL(`../worker/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /prepare\(\s*`[^`]*\$\{/u, `${name}: 템플릿 문자열 SQL 금지`);
    assert.doesNotMatch(source, /prepare\([^)]*\+/u, `${name}: 문자열 이어 붙인 SQL 금지`);
  }
});

test("G. maskEmail·getAuditActorId를 옮긴 뒤에도 같은 입력에 같은 결과를 낸다", async () => {
  assert.equal(maskEmail("owner@example.com"), "o****@example.com");
  assert.equal(maskEmail("ab@example.com"), "a***@example.com");
  assert.equal(maskEmail("not-an-email"), "관리자");
  assert.equal(await getAuditActorId("Owner@Example.com", SECRET), await getAuditActorId("owner@example.com", SECRET));
  assert.match(await getAuditActorId("owner@example.com", SECRET), /^[A-Za-z0-9_-]{16}$/u);
});

test("G. 배포 설정은 D1 WORK_DB 하나와 R2 WORK_FILES 하나만 두고 vars를 넣지 않으며 Cron은 단계 P 실거래가 */10 하나만 둔다(켜기 값 덮어쓰기·처리 함수 없는 Cron 방지)", async () => {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gmu, ""));
  assert.deepEqual(config.d1_databases, [{ binding: "WORK_DB", database_name: "leaderscity-work", database_id: config.d1_databases[0].database_id, migrations_dir: "migrations/work" }]);
  assert.match(config.d1_databases[0].database_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
  assert.equal("vars" in config, false, "vars에 켜기 값 기본값을 두면 배포 때마다 다시 쓰임(켜기 값은 Secret으로 등록, 설계서 16.1)");
  assert.deepEqual(config.triggers, { crons: ["*/10 * * * *"] }, "Cron은 처리 함수가 있는 단계 P 실거래가 받기 하나만(단계 2·4 Cron은 그 PR에서 더함)");
  assert.equal("observability" in config, false, "Workers 자동 추적(traces)을 켜지 않음(요청 주소에 인증키가 들어감, TK-34)");
  assert.deepEqual(config.r2_buckets, [{ binding: "WORK_FILES", bucket_name: "leaderscity-work-files" }], "파일 저장소는 이 이름의 버킷 하나만(공개 주소·사용자 도메인 없음은 버킷 설정에서 확인)");
  assert.equal(getWorkConfigState({ WORK_DB: { prepare() {}, batch() {} }, WORK_FILES: { put() {}, get() {}, delete() {} }, ADMIN_CSRF_SECRET: SECRET }), "disabled", "D1·R2 바인딩이 있어도 WORK_TOOLS_ENABLED가 없으면 꺼짐");
});

test("G. 같은 Worker 진입점에서 업무 경로도 관리 API로 넘어간다", async () => {
  const response = await handleRequest(new Request(`${ORIGIN}/api/admin/v1/work/session`), {});
  assert.equal(response.status, 503, "Access 설정 없는 환경은 fail closed");
});
