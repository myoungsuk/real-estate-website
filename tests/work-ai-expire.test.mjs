// AI 작업 기록 30일 자동 삭제(worker/work-ai-expire.mjs, work-scheduled.mjs runAiJobExpire)와 휴지통 영구 삭제 때 그 파일을 읽은 AI 결과 지우기
// (worker/work-trash.mjs purgeAiJobs·expireAiJobs) 시험. 설계서 8.7절 예외 2 "AI 초안 30일", 14.10절 약점 4.
// 진짜 SQLite(node:sqlite)에 migrations/work 전체를 적용하고 ai_jobs는 가상 값으로 바로 넣는다. OpenAI·원격 D1은 부르지 않는다(외부 요청 덫).
import test from "node:test";
import assert from "node:assert/strict";
import { AI_CRON_ACTOR, AI_EXPIRE_MAX_ROUNDS, AI_EXPIRE_PER_ROUND, AI_JOB_KEEP_DAYS, aiJobCutoffIso } from "../worker/work-ai-expire.mjs";
import { runAiJobExpire, runRealpriceCron } from "../worker/work-scheduled.mjs";
import { aiEnv, seedCopy } from "./work-ai-test-kit.mjs";
import { NOW, OWNER, createR2, freshDb, nextUuid, rows, work } from "./work-test-kit.mjs";

const kst = (text) => Date.parse(`${text}+09:00`);
const AT_0305 = kst("2026-11-25T03:05:00"); // 03:00 차례
const AT_1400 = kst("2026-11-25T14:00:00"); // 03:00 차례 밖
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const MARK_QUOTE = "ZZQUOTE-가상문구";

// 가상 AI 묶음 하나를 넣는다. rows: [{ status, updatedAt, confirmedAt }] 두 개면 옛 두 번 읽기 묶음(pair_mode cross),
// 한 개면 2026-11-24부터의 한 번 읽기 묶음(pair_mode 없음). 돌려주는 값: 묶음 ID.
function insertGroup(database, { rows: list, fileIds = [], kind = "contract_schedule", groupId = nextUuid() }) {
  const insert = database.prepare(`INSERT INTO ai_jobs (id, group_id, run_index, pair_mode, kind, status, model, reasoning_effort, input_file_ids, result_json, error_code,
    confirmed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'gpt-test', 'max', ?, ?, NULL, ?, ?, ?)`);
  list.forEach((row, index) => {
    const result = row.status === "completed" ? JSON.stringify({ maskedCount: 0, result: { quote: MARK_QUOTE } }) : null;
    insert.run(nextUuid(), groupId, index + 1, list.length === 1 ? null : "cross", kind, row.status, JSON.stringify(fileIds), result, row.confirmedAt ?? null, iso(NOW), row.updatedAt);
  });
  return groupId;
}
const closedAt = (at, status = "completed") => [{ status, updatedAt: at }, { status, updatedAt: at }];
const groupsLeft = (database) => rows(database, "SELECT DISTINCT group_id FROM ai_jobs ORDER BY group_id").map((row) => row.group_id);
const aiAudit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, request_id, outcome, reason FROM audit_events WHERE action = 'ai.expire' ORDER BY seq");
const aiLog = (log) => (entry) => entry.event === "ai_expire" && log.push(entry);
// 실거래가·AI는 꺼진 채(켜기 값 없음)로 Cron 1번
const cron = (db, at, log = [], extra = {}) => runRealpriceCron({ WORK_DB: db }, { db, now: () => at, log: aiLog(log), randomUUID: nextUuid, fetcher: async () => assert.fail("외부 요청 0"), ...extra });

test("기준 시각은 정확히 30일 전이고, 그 시각에 끝난 묶음까지 지운다", () => {
  assert.equal(AI_JOB_KEEP_DAYS, 30);
  assert.equal(aiJobCutoffIso(Date.parse("2026-12-25T18:05:00.000Z")), "2026-11-25T18:05:00.000Z");
});

test("30일 경계: 29일 23시간 전에 끝난 묶음은 남고 30일 정각·31일 전은 지우며, 확정 묶음은 확정일로 세고 감사는 지운 묶음마다 system:cron 1줄", async () => {
  const { database, db } = freshDb();
  const cutoff = AT_0305 - 30 * DAY;
  const keep = insertGroup(database, { rows: closedAt(iso(cutoff + HOUR)) }); // 29일 23시간 전
  const exact = insertGroup(database, { rows: closedAt(iso(cutoff), "cancelled") }); // 30일 정각
  const old = insertGroup(database, { rows: closedAt(iso(AT_0305 - 31 * DAY), "failed") }); // 31일 전
  // 결과는 40일 전에 나왔지만 29일 23시간 전에 확정: 확정일로 세어 남김
  const confirmedLate = insertGroup(database, { rows: [
    { status: "completed", updatedAt: iso(AT_0305 - 40 * DAY), confirmedAt: iso(cutoff + HOUR) },
    { status: "completed", updatedAt: iso(AT_0305 - 40 * DAY), confirmedAt: iso(cutoff + HOUR) },
  ] });
  // 40일 전 결과·31일 전 확정: 지움
  const confirmedOld = insertGroup(database, { rows: [
    { status: "completed", updatedAt: iso(AT_0305 - 40 * DAY), confirmedAt: iso(AT_0305 - 31 * DAY) },
    { status: "failed", updatedAt: iso(AT_0305 - 40 * DAY) },
  ] });
  const usageBefore = rows(database, "SELECT * FROM ai_usage_daily");

  const log = [];
  assert.deepEqual(await cron(db, AT_0305, log), { outcome: "disabled" }, "AI·실거래가 켜기 값이 없어도 03:00 정리는 돔");
  assert.deepEqual(groupsLeft(database), [keep, confirmedLate].sort());
  assert.deepEqual(log, [{ event: "ai_expire", groups: 3, rows: 6 }]);
  const lines = aiAudit(database);
  assert.deepEqual(lines.map((line) => line.target_id).sort(), [exact, old, confirmedOld].sort(), "지운 묶음마다 1줄");
  for (const line of lines) {
    assert.deepEqual({ ...line, target_id: null, request_id: line.request_id.startsWith("cron-") },
      { actor_email: AI_CRON_ACTOR, action: "ai.expire", target_type: "ai_job_group", target_id: null, request_id: true, outcome: "ok", reason: "kind=contract_schedule;days=30" });
  }
  assert.equal(new Set(lines.map((line) => line.request_id)).size, 1, "한 번(batch)의 요청 번호 하나");
  assert.deepEqual(rows(database, "SELECT * FROM ai_usage_daily"), usageBefore, "비용 집계는 그대로");
  assert.ok(!JSON.stringify(log).includes(exact) && !JSON.stringify(log).includes(MARK_QUOTE), "로그에 묶음 id·계약서 글 없음");

  const quiet = [];
  await cron(db, AT_0305, quiet);
  assert.deepEqual([quiet, aiAudit(database).length], [[], 3], "지울 것이 없으면 로그·감사 없음");
  await cron(db, AT_0305 + HOUR * 24 * 1, quiet);
  assert.deepEqual(groupsLeft(database), [], "다음 날에는 하루 지난 두 묶음도 30일이 지나 지움");
});

test("한 번 읽기 묶음(행 1개)도 같은 30일 규칙: 30일 지난 끝난 묶음은 지우고, 29일 23시간 전에 확정한 것·진행 중인 것은 남기며 옛 두 번 읽기 묶음과 함께 센다", async () => {
  const { database, db } = freshDb();
  const cutoff = AT_0305 - 30 * DAY;
  const oldSingle = insertGroup(database, { rows: [{ status: "completed", updatedAt: iso(cutoff) }] });
  const failedSingle = insertGroup(database, { rows: [{ status: "failed", updatedAt: iso(AT_0305 - 31 * DAY) }] });
  const confirmedSingle = insertGroup(database, { rows: [{ status: "completed", updatedAt: iso(AT_0305 - 40 * DAY), confirmedAt: iso(cutoff + HOUR) }] });
  const runningSingle = insertGroup(database, { rows: [{ status: "in_progress", updatedAt: iso(AT_0305 - 90 * DAY) }] });
  const oldPair = insertGroup(database, { rows: closedAt(iso(AT_0305 - 31 * DAY), "cancelled") });
  assert.deepEqual(rows(database, "SELECT pair_mode, count(*) AS n FROM ai_jobs WHERE group_id = ?", oldSingle), [{ pair_mode: null, n: 1 }]);
  const log = [];
  await cron(db, AT_0305, log);
  assert.deepEqual(groupsLeft(database), [confirmedSingle, runningSingle].sort());
  assert.deepEqual(log, [{ event: "ai_expire", groups: 3, rows: 4 }], "한 번 읽기 2묶음(행 1개씩) + 옛 1묶음(행 2개)");
  assert.deepEqual(aiAudit(database).map((line) => line.target_id).sort(), [oldSingle, failedSingle, oldPair].sort());
});

test("진행 중(queued·in_progress) 행이 하나라도 있는 묶음은 오래돼도 남기고, 계약서 밖 종류도 건드리지 않으며, 결과 없이 닫힌 묶음(unknown·expired)은 지운다", async () => {
  const { database, db } = freshDb();
  const long = iso(AT_0305 - 90 * DAY);
  const running = insertGroup(database, { rows: [{ status: "completed", updatedAt: long }, { status: "in_progress", updatedAt: long }] });
  const queued = insertGroup(database, { rows: [{ status: "queued", updatedAt: long }, { status: "queued", updatedAt: long }] });
  const other = insertGroup(database, { kind: "transcription", rows: closedAt(long) });
  insertGroup(database, { rows: [{ status: "unknown", updatedAt: long }, { status: "expired", updatedAt: long }] });
  await cron(db, AT_0305);
  assert.deepEqual(groupsLeft(database), [running, queued, other].sort());
  assert.equal(rows(database, "SELECT count(*) AS n FROM ai_jobs WHERE group_id = ?", running)[0].n, 2, "열린 묶음의 끝난 행도 남김");
});

test("03:00 차례가 아니면 D1 0번, 구조 번호가 7보다 낮으면 건너뛰고, D1이 없어도 건너뛴다", async () => {
  const { database, db } = freshDb();
  insertGroup(database, { rows: closedAt(iso(AT_0305 - 40 * DAY)) });
  const before = db.stats.statements;
  const outside = [];
  assert.deepEqual(await cron(db, AT_1400, outside), { outcome: "disabled" });
  assert.deepEqual([groupsLeft(database).length, db.stats.statements, outside], [1, before, []], "03:00 차례 밖은 D1 0번");
  assert.deepEqual(await runAiJobExpire(db, AT_1400, () => assert.fail("로그 없음")), { outcome: "skipped" });

  database.prepare("UPDATE settings SET value_json = '6' WHERE key = 'schema_version'").run();
  assert.deepEqual(await runAiJobExpire(db, AT_0305, () => assert.fail("로그 없음"), nextUuid), { outcome: "skipped" }, "구조 번호 6");
  assert.equal(groupsLeft(database).length, 1);
  assert.deepEqual(await runAiJobExpire(undefined, AT_0305, () => assert.fail("로그 없음")), { outcome: "skipped" });
});

test("상한: 101묶음은 한 차례에 모두(100 + 1), 1,001묶음이면 1,000묶음만 지우고 경고 로그, 다음 날 나머지를 지운다", async () => {
  assert.equal(AI_EXPIRE_PER_ROUND * AI_EXPIRE_MAX_ROUNDS, 1000);
  const old = iso(AT_0305 - 40 * DAY);
  const fill = (database, count) => {
    database.exec("BEGIN");
    for (let index = 0; index < count; index += 1) insertGroup(database, { rows: closedAt(old) });
    database.exec("COMMIT");
  };
  const small = freshDb();
  fill(small.database, 101);
  const smallLog = [];
  const smallResult = await runAiJobExpire(small.db, AT_0305, aiLog(smallLog), nextUuid);
  assert.deepEqual([smallResult, groupsLeft(small.database).length, smallLog],
    [{ outcome: "ok", groups: 101, rows: 202, rounds: 2, backlog: false }, 0, [{ event: "ai_expire", groups: 101, rows: 202 }]]);
  assert.equal(new Set(aiAudit(small.database).map((line) => line.request_id)).size, 2, "100개씩 2번 = 요청 번호 2개");

  const big = freshDb();
  fill(big.database, 1001);
  const keep = insertGroup(big.database, { rows: closedAt(iso(AT_0305 - DAY)) });
  const bigLog = [];
  await cron(big.db, AT_0305, bigLog);
  assert.deepEqual([groupsLeft(big.database).length, bigLog], [2, [{ event: "ai_expire", level: "warn", code: "AI_EXPIRE_BACKLOG", groups: 1000, rows: 2000 }]]);
  const nextLog = [];
  await cron(big.db, AT_0305 + DAY, nextLog);
  assert.deepEqual([groupsLeft(big.database), nextLog], [[keep], [{ event: "ai_expire", groups: 1, rows: 2 }]], "다음 날 나머지 1묶음, 최근 묶음은 남김");
});

test("고른 뒤 지우기 전에 그 묶음이 확정되면(끝난 때가 바뀜) 감사도 삭제도 하지 않고, 같이 고른 다른 묶음만 지운다(날개-2 깨 보기 E08)", async () => {
  const { database, db } = freshDb();
  const old = iso(AT_0305 - 40 * DAY);
  const late = insertGroup(database, { rows: closedAt(old) });
  const plain = insertGroup(database, { rows: closedAt(old) });
  // 고르기(읽기)와 지우기(batch) 사이에 다른 요청이 그 묶음을 거래에 넣는다
  db.beforeNextBatch = () => { database.prepare("UPDATE ai_jobs SET confirmed_at = ? WHERE group_id = ?").run(iso(AT_0305), late); };
  const result = await runAiJobExpire(db, AT_0305, () => {}, nextUuid);
  assert.deepEqual([result.groups, result.rows], [1, 2]);
  assert.deepEqual(groupsLeft(database), [late]);
  assert.deepEqual(aiAudit(database).map((line) => line.target_id), [plain], "감사도 실제로 지운 묶음만");
});

test("정리가 실패해도 경고 로그만 남기고 Cron은 이어 가며, 오류 글은 로그에 넣지 않는다", async () => {
  const { database, db } = freshDb();
  insertGroup(database, { rows: closedAt(iso(AT_0305 - 40 * DAY)) });
  const failing = { ...db, batch: async () => { throw new Error("D1 down owner@example.com"); } };
  const log = [];
  const all = [];
  const result = await runRealpriceCron({ WORK_DB: failing }, { db: failing, now: () => AT_0305, log: (entry) => { all.push(entry); aiLog(log)(entry); }, randomUUID: nextUuid });
  assert.deepEqual(result, { outcome: "disabled" }, "실패해도 아래로 이어 감");
  assert.deepEqual(log, [{ event: "ai_expire", level: "warn", code: "AI_EXPIRE_FAILED" }]);
  assert.ok(!JSON.stringify(all).includes("owner@example.com") && !JSON.stringify(all).includes("D1 down"));
  assert.equal(groupsLeft(database).length, 1);
});

// ── 휴지통 영구 삭제 때 AI 결과 지우기 ──

// 거래 둘(지울 거래 + 다른 거래)과 계약서 사본, AI 묶음 셋(지울 거래의 끝난 묶음·진행 중 묶음, 다른 거래의 끝난 묶음)
async function dealWithAi() {
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2);
  const made = await work(env, "/deals", { method: "POST", body: { title: "가상 지울 거래", dealType: "sale", propertyKind: "housing" } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const dealId = made.json.data.deal.id;
  const other = (await work(env, "/deals", { method: "POST", body: { title: "가상 남는 거래", dealType: "sale", propertyKind: "housing" } })).json.data.deal.id;
  const copies = [await seedCopy(database, r2, { dealId }), await seedCopy(database, r2, { dealId })];
  const otherCopy = await seedCopy(database, r2, { dealId: other });
  const at = iso(NOW);
  const groups = {
    done: insertGroup(database, { rows: closedAt(at), fileIds: copies }),
    running: insertGroup(database, { rows: [{ status: "completed", updatedAt: at }, { status: "in_progress", updatedAt: at }], fileIds: [copies[1]] }),
    // queued만 있는 묶음(만든 직후 OpenAI 요청 전)도 열린 묶음으로 남겨야 한다(날개-2 깨 보기 E20).
    queued: insertGroup(database, { rows: [{ status: "queued", updatedAt: at }, { status: "queued", updatedAt: at }], fileIds: [copies[0]] }),
    other: insertGroup(database, { rows: closedAt(at), fileIds: [otherCopy] }),
  };
  const removed = await work(env, `/deals/${dealId}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  const batchId = removed.json.data.trash.batchId;
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_rows WHERE batch_id = ? AND table_name = 'files'", batchId)[0].n, 2, "거래를 지운 묶음에 그 거래의 사본 행이 들어 있음");
  return { database, db, env, r2, batchId, groups };
}

test("거래를 휴지통으로 옮기기만 하면 AI 결과는 그대로(되살릴 수 있음), 영구 삭제하면 같은 batch에서 그 거래 사본을 읽은 끝난 AI 묶음을 지운다", async () => {
  const { database, db, env, batchId, groups } = await dealWithAi();
  assert.deepEqual(groupsLeft(database), Object.values(groups).sort(), "휴지통으로 옮긴 것만으로는 지우지 않음");
  const batches = [];
  const original = db.batch;
  db.batch = async (statements) => {
    batches.push(statements.map((statement) => statement._sql));
    return original(statements);
  };
  const purged = await work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: "영구 삭제" } });
  assert.equal(purged.status, 200, JSON.stringify(purged.json));
  assert.deepEqual(groupsLeft(database), [groups.running, groups.queued, groups.other].sort(), "끝난 묶음만 지우고, 진행 중(in_progress·queued) 묶음·다른 거래 묶음은 남김");
  const purgeBatch = batches.find((list) => list.some((sql) => sql.startsWith("DELETE FROM trash_batches")));
  assert.ok(purgeBatch, "영구 삭제 batch가 있음");
  const aiIndex = purgeBatch.findIndex((sql) => sql.startsWith("DELETE FROM ai_jobs"));
  const rowsIndex = purgeBatch.findIndex((sql) => sql.startsWith("DELETE FROM trash_rows"));
  assert.ok(aiIndex > 0 && aiIndex < rowsIndex, "AI 결과 지우기는 같은 batch 안, 휴지통 행을 지우기 전(파일 ID를 거기서 읽음)");
  assert.equal(rows(database, "SELECT count(*) AS n FROM audit_events WHERE action = 'trash.purge' AND target_id = ?", batchId)[0].n, 1, "감사는 trash.purge 1줄 그대로");
});

test("7일 지난 휴지통을 Cron이 영구 삭제할 때도 그 거래 사본을 읽은 끝난 AI 묶음을 같은 batch에서 지운다(30일 전이라도)", async () => {
  const { database, db, r2, groups } = await dealWithAi();
  const at = Date.parse("2026-11-24T18:05:00.000Z"); // 한국 11-25 03:05, 지운 지 7일 넘음, AI 묶음은 끝난 지 8일
  await runRealpriceCron({ WORK_DB: db }, { db, now: () => at, log: () => {}, randomUUID: nextUuid, files: r2 });
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches")[0].n, 0, "휴지통 묶음 영구 삭제됨");
  assert.deepEqual(groupsLeft(database), [groups.running, groups.queued, groups.other].sort());
  assert.equal(aiAudit(database).length, 0, "30일 정리가 아니라 휴지통 영구 삭제로 지움(ai.expire 없음)");
});

test("영구 삭제가 실패하면(R2 실패) 휴지통도 AI 결과도 그대로 남는다", async () => {
  const { database, env, r2, batchId, groups } = await dealWithAi();
  r2.fail.delete = true;
  const purged = await work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: "영구 삭제" } });
  assert.equal(purged.status, 503);
  assert.deepEqual(groupsLeft(database), Object.values(groups).sort());
});
