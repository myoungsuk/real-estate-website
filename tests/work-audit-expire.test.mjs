// 감사 로그 3년 자동 삭제(worker/work-scheduled.mjs runAuditExpire, 설계서 8.7절 예외 1, DEC-WT-04, 처리방침 7항 "접근 기록 3년") 시험.
// 진짜 SQLite(node:sqlite)에 migrations/work 전체를 적용하고 감사 기록은 가상 값으로 바로 넣는다. 시각은 now·scheduledTime으로 고정한다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/index.mjs";
import {
  AUDIT_EXPIRE_MAX_ROUNDS,
  AUDIT_EXPIRE_PER_ROUND,
  AUDIT_KEEP_YEARS,
  REALPRICE_CRON,
  auditCutoffIso,
  handleScheduled,
  runAuditExpire,
  runRealpriceCron,
} from "../worker/work-scheduled.mjs";
import { OWNER, createD1, freshDb, nextUuid, rows } from "./work-test-kit.mjs";

const kst = (text) => Date.parse(`${text}+09:00`);
const AT_0305 = kst("2026-11-25T03:05:00"); // 03:00 차례
const AT_1400 = kst("2026-11-25T14:00:00"); // 03:00 차례 밖
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const auditCount = (database) => rows(database, "SELECT count(*) AS n FROM audit_events")[0].n;

// 가상 감사 기록 넣기: [at 시각 ISO 문자열] 하나마다 1줄
function insertAudit(database, times) {
  const insert = database.prepare("INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) VALUES (?, ?, 'customer.view', 'customer', 'c-1', 'r', 'ok', NULL)");
  database.exec("BEGIN");
  for (const at of times) insert.run(at, OWNER);
  database.exec("COMMIT");
}
const many = (count, at) => Array.from({ length: count }, () => at);
const auditLog = (log) => (entry) => entry.event === "audit_expire" && log.push(entry);
// 실거래가는 꺼진 채(켜기 값 없음)로 03:00 차례 Cron 1번
const cron = (db, at, log = []) => runRealpriceCron({ WORK_DB: db }, { db, now: () => at, log: auditLog(log), randomUUID: nextUuid, fetcher: async () => assert.fail("외부 요청 0") });

test("감사 로그 기준 시각은 달력으로 3년 전(UTC), 2월 29일은 3월 1일로(하루 더 남김)", () => {
  assert.equal(AUDIT_KEEP_YEARS, 3);
  assert.equal(auditCutoffIso(Date.parse("2029-11-24T18:05:00.000Z")), "2026-11-24T18:05:00.000Z");
  assert.equal(auditCutoffIso(Date.parse("2028-02-29T18:05:00.000Z")), "2025-03-01T18:05:00.000Z");
  assert.equal(auditCutoffIso(Date.parse("2027-01-01T00:00:00.000Z")), "2024-01-01T00:00:00.000Z");
});

test("03:00 차례 Cron은 켜기 값이 없어도 3년 지난 감사 기록만 지우고, 정확히 3년 된 줄과 그 뒤 줄은 남기며, 로그에는 지운 수와 남았는지만", async () => {
  const { database, db } = freshDb();
  const cutoff = Date.parse(auditCutoffIso(AT_0305));
  insertAudit(database, [iso(cutoff - DAY * 400), iso(cutoff - 1), iso(cutoff), iso(cutoff + 1), iso(AT_0305 - DAY)]);

  const outside = [];
  const statementsBefore = db.stats.statements;
  assert.deepEqual(await cron(db, AT_1400, outside), { outcome: "disabled" });
  assert.deepEqual([auditCount(database), db.stats.statements, outside], [5, statementsBefore, []], "03:00 차례가 아니면 D1 0번");

  const log = [];
  assert.deepEqual(await cron(db, AT_0305, log), { outcome: "disabled" }, "실거래가는 꺼진 그대로(감사 로그 삭제는 켜기 값과 상관없음)");
  assert.deepEqual(rows(database, "SELECT at FROM audit_events ORDER BY seq").map((row) => row.at), [iso(cutoff), iso(cutoff + 1), iso(AT_0305 - DAY)]);
  assert.deepEqual(log, [{ event: "audit_expire", deleted: 2, left: false }]);
  assert.ok(!JSON.stringify(log).includes(OWNER), "로그에 이메일 없음");
  assert.equal(rows(database, "SELECT count(*) AS n FROM audit_events WHERE action LIKE 'audit.%'")[0].n, 0, "지운 일을 감사 로그에 다시 적지 않음");

  const quiet = [];
  await cron(db, AT_0305, quiet);
  assert.deepEqual([quiet, auditCount(database)], [[], 3], "지울 것이 없으면 로그 없음");
});

test("3년 지난 줄이 한도(500줄 × 4번)를 넘으면 2,000줄만 지우고 남았다는 경고 로그, 다음 날 나머지를 이어 지운다", async () => {
  assert.equal(AUDIT_EXPIRE_PER_ROUND * AUDIT_EXPIRE_MAX_ROUNDS, 2000);
  const old = iso(Date.parse(auditCutoffIso(AT_0305)) - DAY);
  const small = freshDb();
  insertAudit(small.database, many(501, old));
  const smallLog = [];
  await cron(small.db, AT_0305, smallLog);
  assert.deepEqual([auditCount(small.database), smallLog], [0, [{ event: "audit_expire", deleted: 501, left: false }]], "501줄은 한 차례에 모두(500 + 1)");

  const exact = freshDb();
  insertAudit(exact.database, many(2000, old));
  const exactLog = [];
  const result = await runAuditExpire(exact.db, AT_0305, auditLog(exactLog));
  assert.deepEqual([result, exactLog], [{ outcome: "ok", deleted: 2000, rounds: 4, backlog: false }, [{ event: "audit_expire", deleted: 2000, left: false }]], "딱 2,000줄이면 남은 것 없음(남았는지 한 번 더 읽음)");

  const big = freshDb();
  insertAudit(big.database, [...many(2005, old), iso(AT_0305)]);
  const bigLog = [];
  await cron(big.db, AT_0305, bigLog);
  assert.deepEqual([auditCount(big.database), bigLog], [6, [{ event: "audit_expire", level: "warn", code: "AUDIT_EXPIRE_BACKLOG", deleted: 2000, left: true }]]);
  const nextLog = [];
  await cron(big.db, AT_0305 + DAY, nextLog);
  assert.deepEqual([auditCount(big.database), nextLog], [1, [{ event: "audit_expire", deleted: 5, left: false }]], "다음 날 나머지 5줄, 최근 줄은 남김");
});

test("감사 로그 삭제가 실패해도 경고 로그만 남기고 Cron은 이어 가며, D1이 없거나 구조 번호를 읽지 못하면 건너뛴다", async () => {
  const { database, db } = freshDb();
  const old = iso(Date.parse(auditCutoffIso(AT_0305)) - DAY);
  insertAudit(database, many(3, old));
  const failing = { ...db, prepare: (sql) => (sql.startsWith("DELETE FROM audit_events") ? { bind: () => ({ run: async () => { throw new Error("D1 down owner@example.com"); } }) } : db.prepare(sql)) };
  const log = [];
  const all = [];
  const result = await runRealpriceCron({ WORK_DB: failing }, { db: failing, now: () => AT_0305, log: (entry) => { all.push(entry); auditLog(log)(entry); }, randomUUID: nextUuid });
  assert.deepEqual(result, { outcome: "disabled" }, "실패해도 아래(실거래가 켜기 값 확인)로 이어 감");
  assert.deepEqual(log, [{ event: "audit_expire", level: "warn", code: "AUDIT_EXPIRE_FAILED" }]);
  assert.ok(!JSON.stringify(all).includes("owner@example.com") && !JSON.stringify(all).includes("D1 down"), "오류 메시지는 로그에 넣지 않음");
  assert.equal(auditCount(database), 3);

  assert.deepEqual(await runAuditExpire(undefined, AT_0305, () => assert.fail("로그 없음")), { outcome: "skipped" });
  const bare = new DatabaseSync(":memory:");
  bare.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL)");
  assert.deepEqual(await runAuditExpire(createD1(bare), AT_0305, () => assert.fail("로그 없음")), { outcome: "skipped" }, "구조 번호 없음");
});

test("Cron 진입점은 controller.scheduledTime으로 03:00 차례를 판정한다(실제 시계와 상관없이)", async () => {
  const { database, db } = freshDb();
  const old = iso(Date.parse(auditCutoffIso(AT_0305)) - DAY);
  insertAudit(database, many(2, old));
  const log = [];
  assert.deepEqual(await handleScheduled({ cron: REALPRICE_CRON, scheduledTime: AT_1400 }, { WORK_DB: db }, {}, { log: auditLog(log), randomUUID: nextUuid }), { outcome: "disabled" });
  assert.deepEqual([auditCount(database), log, db.stats.statements], [2, [], 0], "Cron이 정한 시각이 14:00이면 D1 0번");
  assert.deepEqual(await worker.scheduled({ cron: REALPRICE_CRON, scheduledTime: AT_0305 }, { WORK_DB: db }, {}), { outcome: "disabled" });
  assert.equal(auditCount(database), 0, "Cron이 정한 시각이 03:05면 지움(기본 로그로)");
});
