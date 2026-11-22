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
// 단계 P 시험용 선택 기능(기존 시험의 반환 모양은 그대로, 2026-11-19 P1-b):
// - d1Meta: true면 run·batch 결과와 all 결과에 D1 모양 meta({ changes, rows_written, rows_read })를 붙인다.
//   흉내 값이다. rows_written은 바뀐 행 수(색인 쓰기는 세지 못함), rows_read는 돌려준 행 수다. 실제 양은 로컬·원격 D1로 잰다.
// - db.stats: 실행한 문장 수(statements)와 batch마다 담긴 문장 수(batches)를 센다(TK-58).
export function createD1(database, { d1Meta = false } = {}) {
  const stats = { statements: 0, batches: [] };
  const metaOf = (result, rowsRead = 0) => ({ changes: Number(result?.changes ?? 0), rows_written: Number(result?.changes ?? 0), rows_read: rowsRead });
  const runOne = (sql, values) => {
    const result = database.prepare(sql).run(...values);
    return d1Meta ? { ...result, meta: metaOf(result) } : result;
  };
  const wrap = (sql, values = []) => ({
    bind: (...next) => wrap(sql, next),
    first: async () => {
      stats.statements += 1;
      return database.prepare(sql).get(...values) ?? null;
    },
    all: async () => {
      stats.statements += 1;
      const results = database.prepare(sql).all(...values).map((row) => ({ ...row }));
      return d1Meta ? { results, meta: metaOf(null, results.length) } : { results };
    },
    run: async () => {
      stats.statements += 1;
      return runOne(sql, values);
    },
    _sql: sql,
    _values: values,
  });
  const db = {
    beforeNextBatch: null,
    stats,
    prepare: (sql) => wrap(sql),
    batch: async (statements) => {
      if (db.beforeNextBatch) {
        const interleave = db.beforeNextBatch;
        db.beforeNextBatch = null;
        await interleave();
      }
      stats.statements += statements.length;
      stats.batches.push(statements.length);
      database.exec("BEGIN");
      try {
        const results = statements.map((statement) => runOne(statement._sql, statement._values));
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

export function freshDb(options = {}) {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql) database.exec(sql);
  return { database, db: createD1(database, options) };
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

// 휴지통(0007) 삭제 응답의 trash 기대값: 묶음 id는 무작위라 UUID 꼴만 보고(꼴이 아니면 다른 글자를 돌려 deepEqual이 깨짐),
// purgeAfter는 now + 7일 고정값이다.
export function expectedTrash(data, now = NOW) {
  const batchId = data?.trash?.batchId;
  return {
    batchId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(batchId ?? "") ? batchId : "UUID 꼴이 아님",
    purgeAfter: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

let uuidCounter = 0;
export function nextUuid() {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

// 업무 API를 부르는 도우미. now와 randomUUID를 고정해 결과를 예측할 수 있게 한다.
// openaiFetch: 글 초안(P3) 시험의 가짜 OpenAI(tests/openai-fixtures.mjs). 넣지 않으면 부르는 순간 실패하는 함수를 넘긴다(실제 OpenAI 0번).
export async function work(env, path, { method = "GET", body, token, email = OWNER, now = NOW, auditLog = () => {}, openaiFetch } = {}) {
  const headers = { "Cf-Access-Jwt-Assertion": token ?? await signToken({ email }) };
  if (!["GET", "HEAD"].includes(method)) {
    headers.Origin = ORIGIN;
    headers["Content-Type"] = "application/json";
    headers["X-Admin-CSRF"] = await createWorkCsrfToken(email, SECRET, now);
  }
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const noOpenAi = async () => {
    throw new Error("이 시험은 OpenAI를 부르지 않아야 함");
  };
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => now, auditLog, randomUUID: nextUuid, openaiFetch: openaiFetch ?? noOpenAi } });
  return { response, status: response.status, json: await response.json() };
}
