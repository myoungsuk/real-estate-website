// 업무 도구 시험 공용 도구(시험 파일이 아니라 npm test가 직접 돌리지 않음). 가짜 자료만 쓴다.
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { SignJWT, generateKeyPair, jwtVerify } from "jose";
import { authenticateAccess } from "../worker/access-auth.mjs";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createWorkCsrfToken } from "../worker/work-security.mjs";

export const migrationSql = await readFile(new URL("../migrations/work/0001_init.sql", import.meta.url), "utf8");
// migrations/work의 파일을 이름 순서대로(wrangler d1 migrations apply와 같은 순서) 모두 적용한다.
const migrationDir = new URL("../migrations/work/", import.meta.url);
export const migrationFiles = (await readdir(migrationDir)).filter((name) => /^\d{4}_.+\.sql$/u.test(name)).sort();
export const allMigrationSql = await Promise.all(migrationFiles.map((name) => readFile(new URL(name, migrationDir), "utf8")));
export const ORIGIN = "https://leaderscityhappy.com";
export const TEAM = "https://leaderscityhappy.cloudflareaccess.com";
export const AUD = "test-audience";
export const SECRET = "s".repeat(32);
export const NOW = Date.parse("2026-11-17T05:00:00.000Z");
export const OWNER = "owner@example.com";
export const BACKUP = "backup@example.com";

// node:sqlite를 D1과 같은 모양(prepare→bind→first/run/all, batch)으로 감싼다.
// beforeNextBatch에 함수를 넣으면 다음 batch 직전에 한 번 실행한다(미리 읽은 뒤 다른 관리자가 쓰는 상황 재현용).
export function createD1(database) {
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => database.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: database.prepare(sql).all(...values).map((row) => ({ ...row })) }),
    run: async () => database.prepare(sql).run(...values),
    _sql: sql,
    _values: values,
  });
  const db = {
    beforeNextBatch: null,
    prepare: (sql) => wrap(sql),
    batch: async (statements) => {
      if (db.beforeNextBatch) {
        const interleave = db.beforeNextBatch;
        db.beforeNextBatch = null;
        await interleave();
      }
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
  return db;
}

export function freshDb() {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql) database.exec(sql);
  return { database, db: createD1(database) };
}

export const rows = (database, sql, ...values) => database.prepare(sql).all(...values).map((row) => ({ ...row }));

export const workEnv = (db, extra = {}) => ({
  CF_ACCESS_TEAM_DOMAIN: TEAM,
  CF_ACCESS_AUD: AUD,
  ADMIN_ALLOWED_EMAILS: `${OWNER},${BACKUP}`,
  WORK_TOOLS_ENABLED: "true",
  WORK_DB: db,
  ADMIN_CSRF_SECRET: SECRET,
  ...extra,
});

const { privateKey, publicKey } = await generateKeyPair("RS256");
export async function signToken({ email = OWNER } = {}) {
  return new SignJWT({ email }).setProtectedHeader({ alg: "RS256" }).setIssuer(TEAM).setAudience(AUD)
    .setSubject("subject-1").setIssuedAt().setExpirationTime("1h").sign(privateKey);
}
const verifyLocal = async (token, { teamDomain, audience }) => (await jwtVerify(token, publicKey, { issuer: teamDomain, audience, algorithms: ["RS256"] })).payload;
export const authenticate = (request, env) => authenticateAccess(request, env, verifyLocal);

let uuidCounter = 0;
export function nextUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

// 업무 API를 부르는 도우미. now와 randomUUID를 고정해 결과를 예측할 수 있게 한다.
export async function work(env, path, { method = "GET", body, token, email = OWNER, now = NOW, auditLog = () => {} } = {}) {
  const headers = { "Cf-Access-Jwt-Assertion": token ?? await signToken({ email }) };
  if (!["GET", "HEAD"].includes(method)) {
    headers.Origin = ORIGIN;
    headers["Content-Type"] = "application/json";
    headers["X-Admin-CSRF"] = await createWorkCsrfToken(email, SECRET, now);
  }
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => now, auditLog, randomUUID: nextUuid } });
  return { response, status: response.status, json: await response.json() };
}
