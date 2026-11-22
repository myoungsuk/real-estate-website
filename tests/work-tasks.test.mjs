// 업무 도구 단계 2 할 일·반복 할 일 API·0006 구조 시험(지시서 task-pr-plan.md 2.5 T2-121 ~ T2-128, 설계 task-design.md 3 ~ 6·8절).
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0006을 적용하고 가상 자료만 쓴다. 날짜는 now를 넣어 고정한다
// (한국 날짜가 바뀌는 UTC 15시 앞뒤 경계 포함). 할 일 제목은 감사 기록에 남지 않아야 한다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { TASK_REPEAT_RULES, nextTaskDueOn } from "../src/lib/work/task-repeat.mjs";
import { koreaDate } from "../worker/work-input.mjs";
import { allMigrationSql, createD1, freshDb, migrationFiles, nextUuid, rows, work, workEnv, NOW } from "./work-test-kit.mjs";

const at = (time = NOW) => new Date(time).toISOString();
const audit = (database) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const taskRows = (database) => rows(database, "SELECT id, title, deal_id, due_on, repeat_rule, repeat_day, done_at, version FROM tasks ORDER BY id");
// 2026-11-21 12:00(한국 시각). 설계 4절 예: 매주, 기한 11-01, 11-21에 끝냄 → 11-22.
const NOV21 = Date.parse("2026-11-21T03:00:00.000Z");

async function makeDeal(env, body = {}) {
  const result = await work(env, "/deals", { method: "POST", body: { title: "가상 거래", dealType: "sale", propertyKind: "housing", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.deal;
}

async function makeCustomer(env, displayName) {
  const result = await work(env, "/customers", { method: "POST", body: { displayName } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.customer;
}

async function makeTask(env, body, options = {}) {
  const result = await work(env, "/tasks", { method: "POST", body, ...options });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.task;
}

async function patchTask(env, id, body, options = {}) {
  return work(env, `/tasks/${id}`, { method: "PATCH", body, ...options });
}

test("T2-121 0006은 0001 ~ 0005 위에 tasks 하나만 더하고 구조 번호를 6으로 올리며, CHECK 3개(반복인데 날짜 없음·매월인데 기준일 없음·끝낸 줄에 반복)가 막는다", () => {
  assert.equal(migrationFiles.at(-1), "0006_tasks.sql");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 5)) database.exec(sql);
  const tables = () => rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  const before = tables();
  database.exec(allMigrationSql[5]);
  assert.deepEqual(tables().filter((name) => !before.includes(name)), ["tasks"], "휴지통 표(trash_*)는 넣지 않음");
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "6");
  assert.deepEqual(rows(database, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'tasks' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name),
    ["idx_tasks_deal", "idx_tasks_open_due"]);
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES ('d-1', '가상', 'sale', 'housing', ?, ?)").run(at(), at());
  let n = 0;
  const insert = (extra = {}) => database.prepare("INSERT INTO tasks (id, title, deal_id, due_on, repeat_rule, repeat_day, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(`t-${n += 1}`, extra.title ?? "가상 할 일", extra.dealId ?? null, extra.dueOn ?? null, extra.rule ?? "none", extra.day ?? null, extra.doneAt ?? null, at(), at());
  insert(); // 날짜·거래 없는 할 일
  insert({ dealId: "d-1", dueOn: "2026-11-30", rule: "weekly" });
  insert({ dueOn: "2027-01-31", rule: "monthly", day: 31 });
  insert({ dueOn: "2026-11-01", doneAt: at() });
  assert.throws(() => insert({ rule: "weekly" }), /CHECK/u, "반복인데 날짜 없음");
  assert.throws(() => insert({ dueOn: "2026-11-30", rule: "monthly" }), /CHECK/u, "매월인데 기준일 없음");
  assert.throws(() => insert({ dueOn: "2026-11-30", rule: "weekly", day: 30 }), /CHECK/u, "매월이 아닌데 기준일");
  assert.throws(() => insert({ dueOn: "2026-11-30", rule: "weekly", doneAt: at() }), /CHECK/u, "끝낸 줄에 반복(다음 줄을 두 번 만들지 않게)");
  assert.throws(() => insert({ dueOn: "2026-11-30", rule: "daily" }), /CHECK/u, "반복 목록 밖");
  assert.throws(() => insert({ dueOn: "2026-11-30", rule: "monthly", day: 32 }), /CHECK/u, "기준일 1 ~ 31");
  assert.throws(() => insert({ title: "" }), /CHECK/u);
  assert.throws(() => insert({ title: "가".repeat(81) }), /CHECK/u);
  assert.throws(() => insert({ dealId: "없는 거래" }), /FOREIGN KEY/u);
  // next_task_id는 REFERENCES 없음: 없는 줄을 가리켜도, 열린 줄이 가져도 막지 않는다(다음 줄 삭제·다시 열기가 막히지 않게).
  database.exec("UPDATE tasks SET next_task_id = '없는 줄' WHERE id = 't-4'");
  database.exec("UPDATE tasks SET done_at = NULL WHERE id = 't-4'");
  assert.equal(rows(database, "SELECT next_task_id FROM tasks WHERE id = 't-4'")[0].next_task_id, "없는 줄");
  assert.deepEqual(rows(database, "PRAGMA foreign_key_list(tasks)").map((row) => [row.from, row.table]), [["deal_id", "deals"]]);
  assert.throws(() => database.exec("UPDATE tasks SET done_at = 'x' WHERE id = 't-2'"), /CHECK/u, "반복 줄을 반복 그대로 끝낼 수 없음");
  assert.throws(() => database.exec("DELETE FROM deals WHERE id = 'd-1'"), /FOREIGN KEY/u, "ON DELETE CASCADE 없음: 할 일을 먼저 지워야 거래를 지울 수 있음");
  assert.throws(() => database.exec(allMigrationSql[5]), /already exists/u, "두 번 적용하면 멈춤");
});

test("T2-122 POST /work/tasks 입력: 제목 0·81자, 날짜 형식·없는 날, 반복 목록 밖, 반복인데 날짜 없음, 없는 거래, 모르는 칸은 400과 칸 이름이고 감사·할 일 0줄", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  for (const [body, fields] of [
    [{}, ["title"]],
    [{ title: "" }, ["title"]],
    [{ title: " \t " }, ["title"]],
    [{ title: "가".repeat(81) }, ["title"]],
    [{ title: 123 }, ["title"]],
    [{ title: "가상", dueOn: "2026-02-30" }, ["dueOn"]],
    [{ title: "가상", dueOn: "2026/11/01" }, ["dueOn"]],
    [{ title: "가상", dueOn: "2026-11-01", repeat: "daily" }, ["repeat"]],
    [{ title: "가상", repeat: "weekly" }, ["dueOn"]],
    [{ title: "가상", dueOn: null, repeat: "monthly" }, ["dueOn"]],
    [{ title: "가상", dealId: "deal-1" }, ["dealId"]],
    [{ title: "가상", dealId: "00000000-0000-4000-8000-999999999999" }, ["dealId"]],
    [{ title: "가상", dueOn: "2026-11-01", repeat: "monthly", repeatDay: 31 }, ["repeatDay"]],
    [{ title: "가상", done: true }, ["done"]],
  ]) {
    const result = await work(env, "/tasks", { method: "POST", body });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], JSON.stringify(body));
  }
  const notObject = await work(env, "/tasks", { method: "POST", body: ["가상"] });
  assert.deepEqual([notObject.status, notObject.json.error.details], [400, ["body"]]);
  assert.deepEqual([taskRows(database).length, audit(database).length], [0, 0]);

  // 제목은 한 줄로 정리(공백 모음) 뒤 80자까지, 매월 기준일은 날짜의 '일'로 서버가 정함, 주민번호 형태는 가림.
  const deal = await makeDeal(env, { title: "가상 계약 거래" });
  const monthly = await makeTask(env, { title: `  가상\n  관리비   확인 ${"가".repeat(60)}`, dueOn: "2027-01-31", repeat: "monthly", dealId: deal.id });
  assert.deepEqual(monthly, {
    id: monthly.id, title: `가상 관리비 확인 ${"가".repeat(60)}`, dueOn: "2027-01-31", repeat: "monthly", repeatDay: 31, doneAt: null, version: 1,
    deal: { id: deal.id, title: "가상 계약 거래", status: "open" },
  });
  const plain = await makeTask(env, { title: "가".repeat(80) });
  assert.deepEqual([plain.dueOn, plain.repeat, plain.repeatDay, plain.deal], [null, "none", null, null]);
  const masked = await makeTask(env, { title: "가상 900101-1234567 서류", dueOn: "", repeat: "none" });
  assert.equal(masked.title, "가상 ******-******* 서류");
  assert.deepEqual(audit(database).filter((row) => row.action === "task.create").map((row) => [row.target_type, row.target_id, row.reason]),
    [["task", monthly.id, null], ["task", plain.id, null], ["task", masked.id, "rrn_masked=1"]]);
  assert.ok(rows(database, "SELECT reason FROM audit_events").every((row) => !/가상|관리비|900101/u.test(row.reason ?? "")), "감사에 제목 없음");
});

test("T2-123 GET /work/tasks: 열린 목록은 날짜 빠른 순·날짜 없는 줄 맨 뒤·같은 날은 만든 순, until·dealId로 거르고, 커서 2쪽은 빠짐·겹침 0, 끝낸 목록은 끝낸 때 최근 순, 감사는 결과 수만", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { title: "가상 거른 거래", status: "contracted" });
  const a = await makeTask(env, { title: "가상 A", dueOn: "2026-11-20" });
  const b = await makeTask(env, { title: "가상 B 날짜 없음" });
  const c = await makeTask(env, { title: "가상 C", dueOn: "2026-11-18" });
  const d = await makeTask(env, { title: "가상 D 같은 날 나중", dueOn: "2026-11-20" }, { now: NOW + 1000 });
  const e = await makeTask(env, { title: "가상 E 지난 날", dueOn: "2026-11-10" });
  const f = await makeTask(env, { title: "가상 F 거래", dueOn: "2026-11-25", dealId: deal.id });
  const open = await work(env, "/tasks");
  assert.equal(open.status, 200, JSON.stringify(open.json));
  assert.deepEqual(open.json.data.items.map((item) => item.id), [e.id, c.id, a.id, d.id, f.id, b.id]);
  assert.equal(open.json.data.nextCursor, null);
  assert.deepEqual(Object.keys(open.json.data), ["items", "nextCursor"]);
  assert.deepEqual(open.json.data.items[4].deal, { id: deal.id, title: "가상 거른 거래", status: "contracted" }, "거래는 id·제목·상태만");

  const until = await work(env, "/tasks?until=2026-11-20");
  assert.deepEqual(until.json.data.items.map((item) => item.id), [e.id, c.id, a.id, d.id], "그날까지(지난 것 포함), 날짜 없는 줄 빠짐");
  const byDeal = await work(env, `/tasks?dealId=${deal.id}`);
  assert.deepEqual(byDeal.json.data.items.map((item) => item.id), [f.id]);
  assert.deepEqual((await work(env, "/tasks?dealId=00000000-0000-4000-8000-999999999999")).json.data.items, []);

  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const page = await work(env, `/tasks?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200, JSON.stringify(page.json));
    assert.ok(page.json.data.items.length <= 2);
    seen.push(...page.json.data.items.map((item) => item.id));
    cursor = page.json.data.nextCursor;
    pages += 1;
  } while (cursor);
  assert.deepEqual([pages, seen], [3, [e.id, c.id, a.id, d.id, f.id, b.id]], "날짜 없는 줄이 낀 쪽 경계에서도 빠짐·겹침 0");

  await patchTask(env, e.id, { version: 1, done: true }, { now: NOW + 3000 });
  await patchTask(env, c.id, { version: 1, done: true }, { now: NOW + 5000 });
  const done = await work(env, "/tasks?status=done");
  assert.deepEqual(done.json.data.items.map((item) => [item.id, item.doneAt]), [[c.id, at(NOW + 5000)], [e.id, at(NOW + 3000)]]);
  const donePage = await work(env, "/tasks?status=done&limit=1");
  const donePage2 = await work(env, `/tasks?status=done&limit=1&cursor=${donePage.json.data.nextCursor}`);
  assert.deepEqual([donePage.json.data.items[0].id, donePage2.json.data.items[0].id, donePage2.json.data.nextCursor], [c.id, e.id, null]);
  assert.deepEqual((await work(env, "/tasks")).json.data.items.map((item) => item.id), [a.id, d.id, f.id, b.id], "끝낸 줄은 열린 목록에서 빠짐");

  const lists = audit(database).filter((row) => row.action === "task.list");
  assert.ok(lists.every((row) => row.target_type === null && row.target_id === null && /^result_count=\d+$/u.test(row.reason)));
  assert.deepEqual(lists.slice(0, 3).map((row) => row.reason), ["result_count=6", "result_count=4", "result_count=1"]);

  for (const [query, fields] of [
    ["status=all", ["status"]],
    ["status=done&until=2026-11-20", ["until"]],
    ["until=2026-11-31", ["until"]],
    ["dealId=deal-1", ["dealId"]],
    ["cursor=bad!", ["cursor"]],
    [`cursor=${btoa(JSON.stringify({ k: "2026-11-20", i: a.id }))}`, ["cursor"]],
    ["limit=51", ["limit"]],
    ["limit=0", ["limit"]],
  ]) {
    const result = await work(env, `/tasks?${query}`);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], query);
  }
  const openCursorOnDone = await work(env, `/tasks?status=done&cursor=${(await work(env, "/tasks?limit=1")).json.data.nextCursor}`);
  assert.deepEqual([openCursorOnDone.status, openCursorOnDone.json.error.details], [400, ["cursor"]], "열린 목록 커서를 끝낸 목록에 쓰면 400");
});

test("T2-123a 기본 limit은 50(최대 50)이고 51번째 줄은 다음 쪽으로 넘어간다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const insert = database.prepare("INSERT INTO tasks (id, title, due_on, created_at, updated_at) VALUES (?, '가상', ?, ?, ?)");
  for (let index = 0; index < 51; index += 1) insert.run(nextUuid(), `2026-12-${String((index % 28) + 1).padStart(2, "0")}`, at(), at());
  const first = await work(env, "/tasks");
  assert.equal(first.json.data.items.length, 50);
  const second = await work(env, `/tasks?cursor=${first.json.data.nextCursor}`);
  assert.deepEqual([second.json.data.items.length, second.json.data.nextCursor], [1, null]);
});

test("T2-124 PATCH: 버전 409, 날짜 지우기, 거래 떼기·바꾸기, 끝낸 줄에 반복 400, 반복인데 날짜 지우기 400, 매월 날짜를 고치면 기준일도 바뀜, 감사에 제목 없음, 지우기", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { title: "가상 거래 1" });
  const other = await makeDeal(env, { title: "가상 거래 2", status: "completed" });
  const task = await makeTask(env, { title: "가상 서류 받기", dueOn: "2026-11-20", dealId: deal.id });

  const stale = await patchTask(env, task.id, { version: 2, title: "가상 바뀜" });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "VERSION_CONFLICT"]);
  const cleared = await patchTask(env, task.id, { version: 1, dueOn: null, dealId: null, title: "가상 서류 받기 고침" });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.deepEqual(cleared.json.data, { task: { id: task.id, title: "가상 서류 받기 고침", dueOn: null, repeat: "none", repeatDay: null, doneAt: null, version: 2, deal: null }, next: null });
  const moved = await patchTask(env, task.id, { version: 2, dealId: other.id });
  assert.deepEqual(moved.json.data.task.deal, { id: other.id, title: "가상 거래 2", status: "completed" });
  for (const [body, fields] of [
    [{ version: 3, dealId: "00000000-0000-4000-8000-999999999999" }, ["dealId"]],
    [{ version: 3, repeat: "weekly" }, ["dueOn"]],
    [{ version: 3 }, ["body"]],
    [{ version: 3, title: "" }, ["title"]],
    [{ version: 3, done: "yes" }, ["done"]],
    [{ version: 3, repeatDay: 5 }, ["repeatDay"]],
    [{ title: "가상" }, ["version"]],
  ]) {
    const result = await patchTask(env, task.id, body);
    assert.deepEqual([result.status, result.json.error.details], [400, fields], JSON.stringify(body));
  }

  const monthly = await makeTask(env, { title: "가상 매월", dueOn: "2027-01-31", repeat: "monthly" });
  const redated = await patchTask(env, monthly.id, { version: 1, dueOn: "2027-03-15" });
  assert.deepEqual([redated.json.data.task.dueOn, redated.json.data.task.repeatDay], ["2027-03-15", 15], "날짜를 고치면 기준일은 새 날짜의 '일'(T-6)");
  const noDate = await patchTask(env, monthly.id, { version: 2, dueOn: null });
  assert.deepEqual([noDate.status, noDate.json.error.details], [400, ["dueOn"]], "반복이 있는데 날짜를 지우면 400");
  const toWeekly = await patchTask(env, monthly.id, { version: 2, repeat: "weekly" });
  assert.deepEqual([toWeekly.json.data.task.repeat, toWeekly.json.data.task.repeatDay], ["weekly", null]);
  const stopped = await patchTask(env, monthly.id, { version: 3, repeat: "none", dueOn: null });
  assert.deepEqual([stopped.json.data.task.repeat, stopped.json.data.task.dueOn], ["none", null]);

  const finished = await patchTask(env, task.id, { version: 3, done: true });
  assert.equal(finished.json.data.next, null, "반복 없는 할 일은 다음 줄 없음");
  const repeatOnDone = await patchTask(env, task.id, { version: 4, dueOn: "2026-12-01", repeat: "weekly" });
  assert.deepEqual([repeatOnDone.status, repeatOnDone.json.error.details], [400, ["repeat"]], "끝낸 채로 남는 줄에 반복");
  const editDone = await patchTask(env, task.id, { version: 4, title: "가상 끝낸 줄 제목 고침", repeat: "none" });
  assert.deepEqual([editDone.status, editDone.json.data.task.doneAt, editDone.json.data.task.title], [200, finished.json.data.task.doneAt, "가상 끝낸 줄 제목 고침"], "끝낸 줄의 제목은 고칠 수 있고 끝낸 시각은 그대로");

  const missing = await patchTask(env, "00000000-0000-4000-8000-999999999999", { version: 1, title: "가상" });
  assert.equal(missing.status, 404);
  assert.equal((await patchTask(env, "not-a-uuid", { version: 1, title: "가상" })).status, 404);

  const withBody = await work(env, `/tasks/${task.id}`, { method: "DELETE", body: { confirm: true } });
  assert.deepEqual([withBody.status, withBody.json.error.details], [400, ["confirm"]]);
  const removed = await work(env, `/tasks/${task.id}`, { method: "DELETE" });
  assert.deepEqual([removed.status, removed.json.data], [200, { deleted: true }]);
  assert.equal((await work(env, `/tasks/${task.id}`, { method: "DELETE" })).status, 404);

  const updates = audit(database).filter((row) => row.action === "task.update");
  assert.deepEqual(updates.filter((row) => row.target_id === task.id).map((row) => row.reason), [null, null, "done", null]);
  assert.deepEqual(audit(database).filter((row) => row.action === "task.delete").map((row) => [row.target_type, row.target_id, row.reason]), [["task", task.id, null]]);
  assert.ok(rows(database, "SELECT reason FROM audit_events").every((row) => row.reason === null || /^(done( repeat_next)?|rrn_masked=\d+|result_count=\d+)( rrn_masked=\d+)?$/u.test(row.reason)), "감사에 제목 없음");
});

test("T2-125 끝내기 + 매주: 다음 줄 하나(같은 제목·거래), 끝낸 줄은 반복 '없음', 늦게 끝내면 오늘 이후 첫 날, 같은 요청 두 번은 409, 다시 열고 다시 끝내도 새 줄 안 생김", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { title: "가상 광고 거래" });
  const weekly = await makeTask(env, { title: "가상 광고 올리기", dueOn: "2026-11-01", repeat: "weekly", dealId: deal.id });
  const done = await patchTask(env, weekly.id, { version: 1, done: true }, { now: NOV21 });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  assert.deepEqual(done.json.data.task, { id: weekly.id, title: "가상 광고 올리기", dueOn: "2026-11-01", repeat: "none", repeatDay: null, doneAt: at(NOV21), version: 2, deal: { id: deal.id, title: "가상 광고 거래", status: "open" } });
  const next = done.json.data.next;
  assert.deepEqual(next, { id: next.id, title: "가상 광고 올리기", dueOn: "2026-11-22", repeat: "weekly", repeatDay: null, doneAt: null, version: 1, deal: { id: deal.id, title: "가상 광고 거래", status: "open" } },
    "11-08·11-15는 건너뛰고 11-21(한국 날짜) 이후 첫 날");
  assert.equal(taskRows(database).length, 2);

  const again = await patchTask(env, weekly.id, { version: 1, done: true }, { now: NOV21 + 1000 });
  assert.deepEqual([again.status, again.json.error.code], [409, "VERSION_CONFLICT"], "두 번 누름·다시 보내기");
  assert.equal(taskRows(database).length, 2, "다음 줄이 두 번 생기지 않음");

  const reopened = await patchTask(env, weekly.id, { version: 2, done: false });
  assert.deepEqual([reopened.json.data.task.doneAt, reopened.json.data.task.repeat], [null, "none"], "다시 열어도 반복은 되살리지 않음");
  assert.deepEqual(reopened.json.data.next, next, "다시 열면 전에 만든 다음 줄을 next로 알림(따로 남아 있음)");
  const redone = await patchTask(env, weekly.id, { version: 3, done: true }, { now: NOV21 + 2000 });
  assert.equal(redone.json.data.next, null);
  assert.equal(taskRows(database).length, 2, "다시 끝내도 새 줄 없음");
  assert.deepEqual(audit(database).filter((row) => row.action === "task.update" && row.target_id === weekly.id).map((row) => row.reason), ["done repeat_next", null, "done"]);

  // 일찍 끝내면 원래 날짜 + 한 주기. 다음 줄을 끝내면 그 다음 줄이 이어서 생긴다.
  const early = await patchTask(env, next.id, { version: 1, done: true }, { now: NOV21 });
  assert.equal(early.json.data.next.dueOn, "2026-11-29");
  // 같은 요청에서 날짜·반복을 함께 고치며 끝내면 합친 최종 값으로 다음 줄을 만든다(매월 31일 → 2월 말일 → 3월 31일).
  const plain = await makeTask(env, { title: "가상 관리비 확인" });
  const combined = await patchTask(env, plain.id, { version: 1, done: true, dueOn: "2027-01-31", repeat: "monthly" }, { now: NOV21 });
  assert.deepEqual([combined.json.data.task.repeat, combined.json.data.next.dueOn, combined.json.data.next.repeat, combined.json.data.next.repeatDay], ["none", "2027-02-28", "monthly", 31]);
  const february = await patchTask(env, combined.json.data.next.id, { version: 1, done: true }, { now: Date.parse("2027-02-28T03:00:00.000Z") });
  assert.deepEqual([february.json.data.next.dueOn, february.json.data.next.repeatDay], ["2027-03-31", 31], "2월 28일로 당겨진 뒤 3월에는 원래 31일");
  // 다시 열면서 반복을 주면 열린 뒤 값으로 받는다.
  const reopenRepeat = await patchTask(env, plain.id, { version: 2, done: false, repeat: "weekly" });
  assert.deepEqual([reopenRepeat.status, reopenRepeat.json.data.task.repeat, reopenRepeat.json.data.task.doneAt], [200, "weekly", null]);
  // 남은 줄 모두 CHECK를 지킴: 끝낸 줄은 반복 없음.
  assert.ok(taskRows(database).every((row) => row.done_at === null || (row.repeat_rule === "none" && row.repeat_day === null)));
});

test("T2-125b 끝낸 줄은 만든 다음 줄 id(next_task_id)를 기억해 다시 열 때 next로 알리고, 다음 줄을 지웠으면 null, 같은 거래 삭제 batch에서 끝낸 줄·다음 줄이 함께 지워져도 오류 없음", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { title: "가상 반복 거래" });
  const weekly = await makeTask(env, { title: "가상 매주 확인", dueOn: "2026-11-18", repeat: "weekly", dealId: deal.id });
  const nextIdOf = (id) => rows(database, "SELECT next_task_id FROM tasks WHERE id = ?", id)[0].next_task_id;
  assert.equal(nextIdOf(weekly.id), null, "만들 때는 비어 있음");
  const done = await patchTask(env, weekly.id, { version: 1, done: true }, { now: NOV21 });
  const next = done.json.data.next;
  assert.equal(next.dueOn, "2026-11-25");
  assert.equal(nextIdOf(weekly.id), next.id, "끝낼 때 같은 batch에서 다음 줄 id를 적음");
  assert.equal(nextIdOf(next.id), null);
  assert.equal("nextTaskId" in done.json.data.task, false, "taskView에는 내보내지 않음");

  const reopened = await patchTask(env, weekly.id, { version: 2, done: false });
  assert.deepEqual(reopened.json.data.next, next, "다시 열기 → next 있음");
  assert.equal(nextIdOf(weekly.id), next.id, "다시 열어도 칸은 그대로");
  const retitled = await patchTask(env, weekly.id, { version: 3, title: "가상 매주 확인 고침" });
  assert.equal(retitled.json.data.next, null, "다시 열기가 아닌 고치기는 next 없음");
  const redone = await patchTask(env, weekly.id, { version: 4, done: true });
  assert.deepEqual([redone.json.data.next, nextIdOf(weekly.id)], [null, next.id], "반복 없이 다시 끝내도 칸은 그대로, 새 줄 없음");

  assert.equal((await work(env, `/tasks/${next.id}`, { method: "DELETE" })).status, 200);
  const reopenedAfterDelete = await patchTask(env, weekly.id, { version: 5, done: false });
  assert.equal(reopenedAfterDelete.status, 200, JSON.stringify(reopenedAfterDelete.json));
  assert.equal(reopenedAfterDelete.json.data.next, null, "다음 줄을 지운 뒤 다시 열기 → next null");

  // 반복으로 다시 끝내면 새 다음 줄 id로 바뀐다.
  const again = await patchTask(env, weekly.id, { version: 6, done: true, dueOn: "2026-11-28", repeat: "weekly" }, { now: NOV21 });
  assert.equal(nextIdOf(weekly.id), again.json.data.next.id);
  // 같은 거래의 끝낸 줄(weekly)·그 다음 줄 + 또 다른 끝낸 반복 줄과 그 다음 줄을 거래 삭제 batch가 함께 지운다.
  const second = await makeTask(env, { title: "가상 두 번째", dueOn: "2026-11-21", repeat: "monthly", dealId: deal.id });
  await patchTask(env, second.id, { version: 1, done: true }, { now: NOV21 });
  assert.equal(taskRows(database).length, 4);
  const deleted = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 반복 거래" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.equal(deleted.json.data.deleted.tasks, 4);
  assert.equal(taskRows(database).length, 0);
});

test("T2-125a 끝내는 사이 다른 화면이 그 거래를 지우면(할 일도 함께 지워짐) 404이고 다음 줄은 생기지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { title: "가상 지울 거래" });
  const weekly = await makeTask(env, { title: "가상 매주", dueOn: "2026-11-20", repeat: "weekly", dealId: deal.id });
  db.beforeNextBatch = () => {
    database.prepare("DELETE FROM tasks WHERE deal_id = ?").run(deal.id);
    database.prepare("DELETE FROM deal_parties WHERE deal_id = ?").run(deal.id);
    database.prepare("DELETE FROM deals WHERE id = ?").run(deal.id);
  };
  const result = await patchTask(env, weekly.id, { version: 1, done: true });
  assert.equal(result.status, 404);
  assert.equal(taskRows(database).length, 0);
  assert.equal(audit(database).filter((row) => row.action === "task.update").length, 0, "되돌린 batch의 감사는 남지 않음");

  const kept = await makeDeal(env, { title: "가상 남는 거래" });
  const gone = await makeDeal(env, { title: "가상 붙일 거래" });
  const task = await makeTask(env, { title: "가상 붙이기", dealId: kept.id });
  db.beforeNextBatch = () => database.prepare("DELETE FROM deals WHERE id = ?").run(gone.id);
  const attach = await patchTask(env, task.id, { version: 1, dealId: gone.id });
  assert.deepEqual([attach.status, attach.json.error.code], [409, "VERSION_CONFLICT"], "붙일 거래가 그사이 지워짐");
  assert.equal(taskRows(database)[0].deal_id, kept.id);
  const lateDeal = await makeDeal(env, { title: "가상 만들 때 지울 거래" });
  db.beforeNextBatch = () => database.prepare("DELETE FROM deals WHERE id = ?").run(lateDeal.id);
  const create = await work(env, "/tasks", { method: "POST", body: { title: "가상", dealId: lateDeal.id } });
  assert.deepEqual([create.status, create.json.error.code, taskRows(database).length], [409, "VERSION_CONFLICT", 1]);
});

test("T2-126 nextTaskDueOn: 매월 31일(1/31 → 2/28 → 3/31), 윤년 2/29, 30일, 12월 → 다음 해 1월, 늦게 끝냄, 매주, 한국 날짜 경계(UTC 15시)", async () => {
  assert.deepEqual(TASK_REPEAT_RULES, ["none", "weekly", "monthly"]);
  const monthly = (dueOn, day, today) => nextTaskDueOn({ dueOn, rule: "monthly", day, today });
  const weekly = (dueOn, today) => nextTaskDueOn({ dueOn, rule: "weekly", today });
  assert.equal(monthly("2027-01-31", 31, "2027-01-20"), "2027-02-28");
  assert.equal(monthly("2027-02-28", 31, "2027-02-28"), "2027-03-31");
  assert.equal(monthly("2027-03-31", 31, "2027-03-31"), "2027-04-30");
  assert.equal(monthly("2028-01-31", 31, "2028-01-31"), "2028-02-29", "윤년");
  assert.equal(monthly("2028-01-30", 30, "2028-01-01"), "2028-02-29", "설계 4절 예");
  assert.equal(monthly("2027-01-29", 29, "2027-01-29"), "2027-02-28");
  assert.equal(monthly("2026-12-15", 15, "2026-12-01"), "2027-01-15", "12월 → 다음 해 1월");
  assert.equal(monthly("2026-12-31", 31, "2026-12-31"), "2027-01-31");
  assert.equal(monthly("2026-01-31", 31, "2026-11-21"), "2026-11-30", "늦게 끝냄: 오늘이 있는 달의 말일");
  assert.equal(monthly("2026-08-15", 15, "2026-11-21"), "2026-12-15", "이번 달 기준일이 지났으면 다음 달");
  assert.equal(monthly("2026-08-15", 15, "2026-11-15"), "2026-11-15", "오늘 포함");
  assert.equal(monthly("2026-10-31", 31, "2027-02-10"), "2027-02-28");
  assert.equal(weekly("2026-11-01", "2026-11-21"), "2026-11-22", "설계 4절 예");
  assert.equal(weekly("2026-11-14", "2026-11-21"), "2026-11-21", "오늘 포함");
  assert.equal(weekly("2026-11-30", "2026-11-21"), "2026-12-07", "일찍 끝내면 한 주기 뒤");
  assert.equal(weekly("2026-12-29", "2026-12-29"), "2027-01-05");
  assert.equal(weekly("2028-02-26", "2028-02-26"), "2028-03-04");
  assert.equal(nextTaskDueOn({ dueOn: "2026-11-01", rule: "none", today: "2026-11-21" }), null);
  for (const input of [
    { dueOn: "2026-02-30", rule: "weekly", today: "2026-11-21" },
    { dueOn: "2026-11-01", rule: "weekly", today: "2026/11/21" },
    { dueOn: "2026-11-01", rule: "daily", today: "2026-11-21" },
    { dueOn: "2026-11-01", rule: "monthly", day: 0, today: "2026-11-21" },
    { dueOn: "2026-11-01", rule: "monthly", day: 32, today: "2026-11-21" },
    { dueOn: "2026-11-01", rule: "monthly", today: "2026-11-21" },
    { dueOn: "9999-12-31", rule: "weekly", today: "9999-12-31" },
  ]) assert.equal(nextTaskDueOn(input), null, JSON.stringify(input));

  // 서버 '오늘'은 한국 날짜: UTC 14:59:59.999는 11-20, 15:00은 11-21.
  const before = Date.parse("2026-11-20T14:59:59.999Z");
  const after = Date.parse("2026-11-20T15:00:00.000Z");
  assert.deepEqual([koreaDate(before), koreaDate(after)], ["2026-11-20", "2026-11-21"]);
  const { db } = freshDb();
  const env = workEnv(db);
  const one = await makeTask(env, { title: "가상 경계 1", dueOn: "2026-11-13", repeat: "weekly" });
  const two = await makeTask(env, { title: "가상 경계 2", dueOn: "2026-11-13", repeat: "weekly" });
  assert.equal((await patchTask(env, one.id, { version: 1, done: true }, { now: before })).json.data.next.dueOn, "2026-11-20");
  assert.equal((await patchTask(env, two.id, { version: 1, done: true }, { now: after })).json.data.next.dueOn, "2026-11-27");
});

test("T2-127 거래 삭제는 그 거래 할 일만 지우고 deleted.tasks에 수를, 손님 삭제는 단독 거래 할 일만 지우고 공동 거래 할 일은 남긴다(batch 자리 번호가 밀리지 않게 수 값 확인)", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const dealA = await makeDeal(env, { title: "가상 지울 거래", contractOn: "2026-10-01", balanceOn: "2026-11-20", priceWon: 300_000_000 });
  const dealB = await makeDeal(env, { title: "가상 남을 거래" });
  for (const title of ["가상 A1", "가상 A2"]) await makeTask(env, { title, dealId: dealA.id });
  const bTask = await makeTask(env, { title: "가상 B1", dealId: dealB.id });
  const loose = await makeTask(env, { title: "가상 거래 없음" });
  assert.equal((await work(env, `/deals/${dealA.id}/events`, { method: "POST", body: { kind: "custom", dueOn: "2026-11-25", title: "가상 일정" } })).status, 201);
  assert.equal((await work(env, "/notes", { method: "POST", body: { body: "가상 거래 메모", dealId: dealA.id } })).status, 201);
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await work(env, "/ledger", { method: "POST", body: { kind: "expense", dealId: dealA.id, amountWon: 1000 + index } })).status, 201);
  }
  const deleted = await work(env, `/deals/${dealA.id}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: { deals: 1, events: 1, notes: 1, files: 0, tasks: 2 }, kept: { notes: 0, ledger: 3 } });
  assert.deepEqual(taskRows(database).map((row) => row.id).sort(), [bTask.id, loose.id].sort(), "다른 거래·거래 없는 할 일은 그대로");

  // 손님 X: 단독 거래 E(할 일 3개·장부 2줄) + Y와 함께인 거래 S(할 일 1개).
  const x = await makeCustomer(env, "가상 손님 X");
  const y = await makeCustomer(env, "가상 손님 Y");
  const exclusive = await makeDeal(env, { title: "가상 X 단독", parties: [{ customerId: x.id, role: "buyer" }] });
  const shared = await makeDeal(env, { title: "가상 함께", parties: [{ customerId: x.id, role: "buyer" }, { customerId: y.id, role: "seller" }] });
  for (const title of ["가상 E1", "가상 E2", "가상 E3"]) await makeTask(env, { title, dealId: exclusive.id });
  const sharedTask = await makeTask(env, { title: "가상 S1", dealId: shared.id });
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await work(env, "/ledger", { method: "POST", body: { kind: "expense", dealId: exclusive.id, amountWon: 500 + index } })).status, 201);
  }
  const removed = await work(env, `/customers/${x.id}`, { method: "DELETE", body: { confirmName: "가상 손님 X" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.deepEqual(removed.json.data, { deleted: { customers: 1, deals: 1, notes: 0, files: 0, tasks: 3 }, kept: { notes: 0, ledger: 2 } });
  assert.deepEqual(taskRows(database).map((row) => row.id).sort(), [bTask.id, loose.id, sharedTask.id].sort());
  assert.deepEqual(rows(database, "SELECT id FROM deals").map((row) => row.id).sort(), [dealB.id, shared.id].sort(), "X 단독 거래만 지워짐");
  assert.equal(rows(database, "SELECT count(*) AS n FROM ledger_entries WHERE deal_id IS NULL")[0].n, 5, "장부 줄은 연결만 끊겨 남음");

  // 할 일이 없는 거래·손님 삭제는 tasks: 0.
  const bare = await makeDeal(env, { title: "가상 할 일 없음" });
  const bareDeleted = await work(env, `/deals/${bare.id}`, { method: "DELETE", body: { confirmTitle: "가상 할 일 없음" } });
  assert.equal(bareDeleted.json.data.deleted.tasks, 0);
});

test("T2-128 업무 도구가 꺼져 있으면 503 WORK_DISABLED(D1 0번), 구조 번호 5인 D1이면 503 WORK_SCHEMA_OUTDATED와 request.denied, 정해진 방식 밖은 405", async () => {
  const paths = [["/tasks", "GET"], ["/tasks", "POST"], ["/tasks/00000000-0000-4000-8000-000000000001", "PATCH"], ["/tasks/00000000-0000-4000-8000-000000000001", "DELETE"]];
  const bodyOf = (method) => (method === "POST" ? { title: "가상" } : method === "PATCH" ? { version: 1, title: "가상" } : undefined);
  const off = freshDb();
  for (const [path, method] of paths) {
    const result = await work(workEnv(off.db, { WORK_TOOLS_ENABLED: undefined }), path, { method, body: bodyOf(method) });
    assert.deepEqual([result.status, result.json.error.code], [503, "WORK_DISABLED"], `${method} ${path}`);
  }
  assert.deepEqual([off.db.stats.statements, rows(off.database, "SELECT count(*) AS n FROM audit_events")[0].n], [0, 0]);

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 5)) database.exec(sql);
  const db = createD1(database);
  for (const [path, method] of paths) {
    const result = await work(workEnv(db), path, { method, body: bodyOf(method) });
    assert.deepEqual([result.status, result.json.error.code], [503, "WORK_SCHEMA_OUTDATED"], `${method} ${path}`);
  }
  assert.deepEqual(audit(database).map((row) => [row.action, row.outcome, row.reason]), paths.map(() => ["request.denied", "denied", "WORK_SCHEMA_OUTDATED"]));
  assert.equal(db.stats.batches.length, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'tasks'")[0].n, 0);

  const fresh = freshDb();
  const env = workEnv(fresh.db);
  const put = await work(env, "/tasks", { method: "PUT", body: {} });
  assert.deepEqual([put.status, put.response.headers.get("Allow")], [405, "GET, POST"]);
  const getOne = await work(env, "/tasks/00000000-0000-4000-8000-000000000001");
  assert.deepEqual([getOne.status, getOne.response.headers.get("Allow")], [405, "PATCH, DELETE"]);
  assert.equal((await work(env, "/tasks/00000000-0000-4000-8000-000000000001/extra")).status, 404);
  assert.equal((await work(env, "/tasks/not-a-uuid", { method: "DELETE" })).status, 404);
});
