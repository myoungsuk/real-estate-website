// 관리자 대시보드 읽기 API 시험(GET /api/admin/v1/work/dashboard, 2026-11-23 A안, 업무 도구 설계서 대시보드 절).
// 진짜 SQLite(node:sqlite)에 migrations/work 전부를 적용하고 가상 자료만 쓴다. NOW = 2026-11-17 14:00 한국 시각(오늘 2026-11-17).
// 칸 넷(할 일·계약 일정·이번 달 돈 = 단계 2, 실거래 = 단계 P)이 켜기 값을 따로 보고, 꺼진 칸은 D1을 읽지 않는지,
// 감사·이름 가림·지난 일정 범위·매출장부 합계와 같은 값인지를 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, freshDb, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const STAMP = new Date(NOW - 40 * DAY).toISOString();
const TODAY = "2026-11-17";
const day = (offset) => new Date(Date.parse(`${TODAY}T00:00:00.000Z`) + offset * DAY).toISOString().slice(0, 10);
const NAMES = ["가상손님매수", "가상손님매도", "가상비밀할일제목", "가상거래제목숲"];
const OFF_ALL = {
  tasks: { ok: false, code: "WORK_DISABLED" },
  events: { ok: false, code: "WORK_DISABLED" },
  money: { ok: false, code: "WORK_DISABLED" },
  realprice: { ok: false, code: "REALPRICE_DISABLED" },
};
const bothOn = (db, extra = {}) => workEnv(db, { WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY, ...extra });
const realpriceOnly = (db, extra = {}) => bothOn(db, { WORK_TOOLS_ENABLED: undefined, ...extra });
const workOnly = (db, extra = {}) => workEnv(db, extra);
const dashboard = (env, options = {}) => work(env, "/dashboard", options);
const audits = (database) => rows(database, "SELECT action, outcome, reason FROM audit_events ORDER BY seq");

// 문장을 모두 적는 D1(어느 표를 읽었는지 보려고).
function spy(db) {
  const seen = [];
  const prepare = db.prepare;
  db.prepare = (sql) => {
    seen.push(sql);
    return prepare(sql);
  };
  return seen;
}

function seedDeal(database, { id, title = "가상거래제목숲", status = "open", balanceOn = null, dealType = "sale" }) {
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, status, balance_on, created_at, updated_at) VALUES (?, ?, ?, 'housing', ?, ?, ?, ?)")
    .run(id, title, dealType, status, balanceOn, STAMP, STAMP);
}
function seedCustomer(database, id, name) {
  database.prepare("INSERT INTO customers (id, display_name, phone_digits, needs, created_at, updated_at) VALUES (?, ?, '01000000000', '', ?, ?)").run(id, name, STAMP, STAMP);
}
function seedEvent(database, { id, dealId, kind = "balance", dueOn, doneAt = null, title = "잔금" }) {
  database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, source, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'calculated', ?, ?, ?)")
    .run(id, dealId, kind, dueOn, title, doneAt, STAMP, STAMP);
}
function seedTask(database, { id, title = "가상비밀할일제목", dueOn = null, doneAt = null, dealId = null, createdAt = STAMP }) {
  database.prepare("INSERT INTO tasks (id, title, deal_id, due_on, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(id, title, dealId, dueOn, doneAt, createdAt, createdAt);
}
function seedLedger(database, { id, kind = "fee", dealId = null, payerRole = null, label = "", entryOn = null, amount, vat = 0, received = 0 }) {
  database.prepare("INSERT INTO ledger_entries (id, kind, deal_id, payer_role, label, entry_on, amount_won, vat_won, received_won, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, kind, dealId, payerRole, label, entryOn, amount, vat, received, STAMP, STAMP);
}
const setSchema = (database, version) => database.prepare("UPDATE settings SET value_json = ? WHERE key = 'schema_version'").run(String(version));

// 할 일·일정·장부 가상 자료 한 벌.
function seedWork(database) {
  seedCustomer(database, "cust-buyer", "가상손님매수");
  seedCustomer(database, "cust-seller", "가상손님매도");
  seedDeal(database, { id: "deal-open", balanceOn: "2026-11-20" });
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('deal-open', 'cust-seller', 'seller'), ('deal-open', 'cust-buyer', 'buyer')").run();
  seedDeal(database, { id: "deal-cancel", title: "가상취소거래", status: "cancelled" });
  seedDeal(database, { id: "deal-alone", title: "가상혼자거래", dealType: "jeonse" });
  // 일정: 30일 전(넣음)·31일 전(뺌)·3일 전(넣음, 지남)·오늘·14일 뒤(넣음)·15일 뒤(뺌)·끝냄(뺌)·취소 거래(뺌)
  seedEvent(database, { id: "ev-30", dealId: "deal-open", kind: "contract", dueOn: day(-30), title: "계약" });
  seedEvent(database, { id: "ev-31", dealId: "deal-open", dueOn: day(-31) });
  seedEvent(database, { id: "ev-3", dealId: "deal-open", kind: "middle_payment", dueOn: day(-3), title: "중도금" });
  seedEvent(database, { id: "ev-0", dealId: "deal-alone", dueOn: day(0) });
  seedEvent(database, { id: "ev+14", dealId: "deal-open", dueOn: day(14) });
  seedEvent(database, { id: "ev+15", dealId: "deal-open", dueOn: day(15) });
  seedEvent(database, { id: "ev-done", dealId: "deal-open", dueOn: day(2), doneAt: STAMP });
  seedEvent(database, { id: "ev-cancel", dealId: "deal-cancel", dueOn: day(1) });
  // 할 일: 지난 1·오늘 1·내일 1·끝냄 1·날짜 없음 1
  seedTask(database, { id: "task-past", dueOn: day(-2), dealId: "deal-open" });
  seedTask(database, { id: "task-today", dueOn: day(0) });
  seedTask(database, { id: "task-tomorrow", dueOn: day(1) });
  seedTask(database, { id: "task-done", dueOn: day(-1), doneAt: STAMP });
  seedTask(database, { id: "task-undated" });
  // 장부: 이번 달 잔금(거래 잔금일 11-20) 2줄, 다른 달 1줄, 잔금일 없는 줄 1줄, 거래 없는 이번 달 기타 수입 1줄, 지출 1줄
  seedLedger(database, { id: "led-1", dealId: "deal-open", payerRole: "buyer", amount: 1_800_000, vat: 180_000, received: 0 });
  seedLedger(database, { id: "led-2", dealId: "deal-open", payerRole: "seller", label: "매도 보수", amount: 1_800_000, vat: 180_000, received: 1_000_000 });
  seedLedger(database, { id: "led-oct", entryOn: "2026-10-05", kind: "other_income", label: "10월 수입", amount: 500_000 });
  seedLedger(database, { id: "led-undated", dealId: "deal-alone", payerRole: "tenant", amount: 700_000 });
  seedLedger(database, { id: "led-nov", entryOn: "2026-11-03", kind: "other_income", label: "11월 기타", amount: 300_000, received: 300_000 });
  seedLedger(database, { id: "led-exp", entryOn: "2026-11-05", kind: "expense", label: "광고비", amount: 90_000 });
}

test("대시보드: 단계 2·단계 P가 모두 꺼져 있으면 200이고 칸 넷 모두 꺼짐 코드, D1 문장은 0개다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const before = db.stats.statements;
  for (const [name, env] of [
    ["둘 다 없음", workEnv(db, { WORK_TOOLS_ENABLED: undefined })],
    ["\"TRUE\"는 켜짐 아님", workEnv(db, { WORK_TOOLS_ENABLED: "TRUE", WORK_REALPRICE_ENABLED: "1" })],
  ]) {
    const result = await dashboard(env);
    assert.equal(result.status, 200, name);
    assert.equal(result.json.ok, true, name);
    assert.deepEqual({ ...result.json.data, today: undefined }, { today: undefined, ...OFF_ALL }, name);
    assert.equal(result.json.data.today, TODAY, name);
  }
  assert.equal(db.stats.statements, before, "구조 번호도 읽지 않음");
  assert.deepEqual(audits(database), []);
});

test("대시보드: 켰는데 설정이 빠지면 그 칸은 *_CONFIG_MISSING이고, D1이 없어도 200이다", async () => {
  const { db } = freshDb();
  const short = await dashboard(bothOn(db, { ADMIN_CSRF_SECRET: "s".repeat(31) }));
  assert.equal(short.status, 200);
  for (const key of ["tasks", "events", "money"]) assert.deepEqual(short.json.data[key], { ok: false, code: "WORK_CONFIG_MISSING" }, key);
  assert.deepEqual(short.json.data.realprice, { ok: false, code: "REALPRICE_CONFIG_MISSING" });
  const noKey = await dashboard(bothOn(db, { MOLIT_RT_SERVICE_KEY: undefined }));
  assert.deepEqual(noKey.json.data.realprice, { ok: false, code: "REALPRICE_CONFIG_MISSING" });
  assert.equal(noKey.json.data.tasks.ok, true, "단계 2 칸은 실거래 인증키와 상관없음");
  const noDb = await dashboard(bothOn(undefined));
  assert.equal(noDb.status, 200);
  assert.equal(noDb.json.data.tasks.code, "WORK_CONFIG_MISSING");
  assert.equal(noDb.json.data.realprice.code, "REALPRICE_CONFIG_MISSING");
});

test("대시보드: 단계 2만 꺼져 있으면 할 일·일정·돈은 WORK_DISABLED이고 손님·거래·할 일·장부 표를 읽지 않으며 감사도 남기지 않는다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const seen = spy(db);
  const result = await dashboard(realpriceOnly(db));
  assert.equal(result.status, 200);
  for (const key of ["tasks", "events", "money"]) assert.deepEqual(result.json.data[key], { ok: false, code: "WORK_DISABLED" }, key);
  assert.equal(result.json.data.realprice.ok, true);
  const touched = seen.filter((sql) => /\b(customers|deals|deal_parties|deal_events|tasks|ledger_entries|notes|files)\b/u.test(sql));
  assert.deepEqual(touched, [], "단계 2 표");
  const text = JSON.stringify(result.json);
  for (const name of NAMES) assert.ok(!text.includes(name), name);
  assert.deepEqual(audits(database).filter((row) => row.action === "dashboard.view"), []);
});

test("대시보드: 단계 P만 꺼져 있으면 실거래 칸만 REALPRICE_DISABLED이고 실거래 표를 읽지 않는다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const seen = spy(db);
  const result = await dashboard(workOnly(db));
  assert.deepEqual(result.json.data.realprice, { ok: false, code: "REALPRICE_DISABLED" });
  for (const key of ["tasks", "events", "money"]) assert.equal(result.json.data[key].ok, true, key);
  assert.deepEqual(seen.filter((sql) => /\brt_/u.test(sql)), [], "rt_ 표");
});

test("대시보드: GET 말고는 405 METHOD_NOT_ALLOWED와 Allow: GET이고 아무것도 쓰지 않는다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const result = await dashboard(bothOn(db), { method, body: {} });
    assert.equal(result.status, 405, method);
    assert.equal(result.json.error.code, "METHOD_NOT_ALLOWED", method);
    assert.equal(result.response.headers.get("Allow"), "GET", method);
  }
  assert.deepEqual(audits(database), []);
});

test("대시보드: 구조 번호가 다르면 켜진 칸만 WORK_SCHEMA_OUTDATED·AHEAD이고 request.denied 한 줄, 꺼진 칸은 꺼짐 코드 그대로다", async () => {
  for (const [version, code] of [[6, "WORK_SCHEMA_OUTDATED"], [8, "WORK_SCHEMA_AHEAD"]]) {
    const { database, db } = freshDb();
    seedWork(database);
    setSchema(database, version);
    const work2 = await dashboard(workOnly(db));
    for (const key of ["tasks", "events", "money"]) assert.deepEqual(work2.json.data[key], { ok: false, code }, `${version} ${key}`);
    assert.deepEqual(work2.json.data.realprice, { ok: false, code: "REALPRICE_DISABLED" }, `${version} 꺼진 실거래`);
    const rp = await dashboard(realpriceOnly(db));
    assert.deepEqual(rp.json.data.realprice, { ok: false, code }, `${version} 실거래`);
    assert.equal(rp.json.data.tasks.code, "WORK_DISABLED", `${version} 꺼진 할 일`);
    assert.deepEqual(audits(database), [
      { action: "request.denied", outcome: "denied", reason: code },
      { action: "request.denied", outcome: "denied", reason: code },
    ], `${version} 감사`);
    for (const name of NAMES) assert.ok(!JSON.stringify([work2.json, rp.json]).includes(name), `${version} ${name}`);
  }
});

test("대시보드 할 일 칸: 오늘까지 열린 할 일만(지난 1·오늘 1), 끝낸·내일·날짜 없는 할 일은 빼고 날짜 차례", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const { tasks } = (await dashboard(workOnly(db))).json.data;
  assert.equal(tasks.ok, true);
  assert.equal(tasks.overdue, 1);
  assert.equal(tasks.dueToday, 1);
  assert.deepEqual(tasks.items.map((item) => [item.id, item.dueOn]), [["task-past", day(-2)], ["task-today", day(0)]]);
  assert.deepEqual(tasks.items[0].deal, { id: "deal-open", title: "가상거래제목숲" });
  assert.equal(tasks.items[1].deal, null);
  assert.equal(tasks.items[0].repeat, "none");
});

test("대시보드 할 일 칸: 6개 넘게 밀려도 목록은 5줄, 수는 전체를 센다", async () => {
  const { database, db } = freshDb();
  for (let index = 0; index < 7; index += 1) seedTask(database, { id: `t-${index}`, dueOn: day(-index) });
  const { tasks } = (await dashboard(workOnly(db))).json.data;
  assert.equal(tasks.items.length, 5);
  assert.equal(tasks.overdue + tasks.dueToday, 7);
  assert.deepEqual(tasks.items.map((item) => item.id), ["t-6", "t-5", "t-4", "t-3", "t-2"]);
});

test("대시보드 일정 칸: 취소한 거래·끝낸 일정·31일 넘게 지난 일정·15일 뒤는 빼고, 손님 여럿이면 매수인 한 명과 참여자 수", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const { events } = (await dashboard(workOnly(db))).json.data;
  assert.equal(events.ok, true);
  assert.equal(events.until, day(14));
  assert.deepEqual(events.items.map((item) => item.id), ["ev-30", "ev-3", "ev-0", "ev+14"]);
  assert.equal(events.total, 4);
  assert.equal(events.overdue, 2, "30일 전·3일 전");
  assert.equal(events.total - events.overdue, 2, "숫자 띠 '14일 안' = 오늘·14일 뒤(앞날만)");
  const open = events.items.find((item) => item.id === "ev-3");
  assert.deepEqual(open.customer, { id: "cust-buyer", displayName: "가상손님매수" }, "매도인보다 매수인 먼저");
  assert.equal(open.partyCount, 2);
  assert.deepEqual(open.deal, { id: "deal-open", title: "가상거래제목숲", dealType: "sale" });
  assert.equal(open.kindLabel.length > 0, true);
  const alone = events.items.find((item) => item.id === "ev-0");
  assert.equal(alone.customer, null, "참여자 없는 거래");
  assert.equal(alone.partyCount, 0);
});

test("대시보드 일정 칸: 임차인·임대인만 있으면 임차인, 같은 역할이면 손님 id 차례", async () => {
  const { database, db } = freshDb();
  seedCustomer(database, "c-b", "가상임대인");
  seedCustomer(database, "c-a2", "가상임차인둘");
  seedCustomer(database, "c-a1", "가상임차인하나");
  seedDeal(database, { id: "d-1", dealType: "jeonse" });
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('d-1', 'c-b', 'landlord'), ('d-1', 'c-a2', 'tenant'), ('d-1', 'c-a1', 'tenant')").run();
  seedEvent(database, { id: "e-1", dealId: "d-1", dueOn: day(1) });
  const { events } = (await dashboard(workOnly(db))).json.data;
  assert.deepEqual(events.items[0].customer, { id: "c-a1", displayName: "가상임차인하나" });
  assert.equal(events.items[0].partyCount, 3);
});

test("대시보드 돈 칸: 받을 금액·입금액·미입금은 매출장부 합계(잔금일 기준) 같은 달 값과 같고, 잔금일 없는 줄 수를 따로 센다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const env = workOnly(db);
  const { money } = (await dashboard(env)).json.data;
  const summary = (await work(env, "/ledger/summary?year=2026&basis=balance")).json.data;
  const november = summary.months.find((line) => line.month === "2026-11");
  assert.equal(money.ok, true);
  assert.equal(money.month, "2026-11");
  assert.equal(money.basis, "balance");
  assert.equal(money.receivableWon, november.receivableWon);
  assert.equal(money.receivedWon, november.receivedWon);
  assert.equal(money.unpaidWon, november.unpaidWon);
  assert.ok(money.receivableWon > 0 && money.unpaidWon > 0, "자료가 실제로 들어감");
  assert.equal(money.undatedCount, summary.undatedCount);
  assert.equal(money.undatedCount, 1);
  assert.equal(money.unpaidCount, 2, "이번 달 미입금 줄(led-1·led-2), 다 받은 줄·지출·10월·날짜 없는 줄 뺌");
  assert.deepEqual(money.items.map((item) => [item.id, item.unpaidWon]), [["led-1", 1_980_000], ["led-2", 980_000]]);
  assert.equal(money.items[0].label, "가상거래제목숲", "빈 이름은 거래 제목");
  assert.equal(money.items[1].label, "매도 보수");
  assert.equal(money.items[0].basisOn, "2026-11-20");
});

test("대시보드 감사: 단계 2 칸을 읽으면 dashboard.view 한 줄(reason result_count=n), 감사·Worker 로그에 이름·제목이 없다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const logs = [];
  const result = await dashboard(bothOn(db), { auditLog: (entry) => logs.push(entry) });
  const { tasks, events, money } = result.json.data;
  const count = tasks.items.length + events.items.length + money.items.length;
  const rowsAfter = audits(database);
  assert.deepEqual(rowsAfter.filter((row) => row.action === "dashboard.view"), [{ action: "dashboard.view", outcome: "ok", reason: `result_count=${count}` }]);
  assert.equal(rowsAfter.length, 1, "실거래 칸은 감사를 남기지 않음");
  const stored = JSON.stringify(rows(database, "SELECT * FROM audit_events")) + JSON.stringify(logs);
  for (const name of NAMES) assert.ok(!stored.includes(name), name);
  assert.ok(JSON.stringify(result.json).includes("가상손님매수"), "이름은 응답 본문에만");
});

test("대시보드 감사: 감사를 쓰지 못하면 단계 2 칸 셋이 AUDIT_UNAVAILABLE이고 이름·제목을 돌려주지 않으며 실거래 칸은 그대로다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const prepare = db.prepare;
  db.prepare = (sql) => {
    const statement = prepare(sql);
    if (!sql.startsWith("INSERT INTO audit_events")) return statement;
    const fail = { ...statement, run: async () => { throw new Error("가상 감사 실패"); } };
    return { ...fail, bind: () => fail };
  };
  const result = await dashboard(bothOn(db));
  assert.equal(result.status, 200);
  for (const key of ["tasks", "events", "money"]) assert.deepEqual(result.json.data[key], { ok: false, code: "AUDIT_UNAVAILABLE" }, key);
  assert.equal(result.json.data.realprice.ok, true);
  const text = JSON.stringify(result.json);
  for (const name of NAMES) assert.ok(!text.includes(name), name);
  assert.deepEqual(audits(database), []);
});

test("대시보드: 한 칸 질의가 실패하면 그 칸만 STORAGE_UNAVAILABLE이고 Worker 로그에는 칸 이름·코드만 남는다", async () => {
  const { database, db } = freshDb();
  seedWork(database);
  const prepare = db.prepare;
  db.prepare = (sql) => {
    if (sql.includes("FROM deal_events e JOIN deals d")) throw new Error("가상 질의 실패 가상손님매수");
    return prepare(sql);
  };
  const logs = [];
  const result = await dashboard(workOnly(db), { auditLog: (entry) => logs.push(entry) });
  assert.deepEqual(result.json.data.events, { ok: false, code: "STORAGE_UNAVAILABLE" });
  assert.equal(result.json.data.tasks.ok, true);
  assert.equal(result.json.data.money.ok, true);
  const failure = logs.filter((entry) => entry.event === "work_request_failed");
  assert.equal(failure.length, 1);
  assert.equal(failure[0].section, "events");
  assert.equal(failure[0].code, "STORAGE_UNAVAILABLE");
  assert.ok(!JSON.stringify(logs).includes("가상손님매수"), "오류 문장을 로그에 싣지 않음");
  const count = result.json.data.tasks.items.length + result.json.data.money.items.length;
  assert.deepEqual(audits(database), [{ action: "dashboard.view", outcome: "ok", reason: `result_count=${count}` }], "읽은 칸만큼 감사");
});

test("대시보드 실거래 칸: 처음 채우기가 아니고 7일 안에 처음 본 거래만 새 거래로 세고, 관심 단지 몫을 따로 센다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  const insert = (key, { aptSeq, isBackfill, seenDaysAgo, ymd = "202611", date = "2026-11-10" }) => database.prepare(
    `INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
      price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at)
      VALUES (?, 'sale', ?, ?, '천동', '1', ?, ?, '가상단지', 8497, 10, 2020, 300000000, NULL, NULL, 'broker', 0, NULL, NULL, NULL, '{}', ?, ?, ?)`,
  ).run(key, ymd, date, aptSeq, aptSeq, isBackfill, new Date(NOW - seenDaysAgo * DAY).toISOString(), new Date(NOW - seenDaysAgo * DAY).toISOString());
  const pad = (n) => String(n).padStart(20, "0");
  insert(`sale:202611:${pad(1)}:1`, { aptSeq: "W1", isBackfill: 0, seenDaysAgo: 1 });
  insert(`sale:202611:${pad(2)}:1`, { aptSeq: "N1", isBackfill: 0, seenDaysAgo: 6 });
  insert(`sale:202611:${pad(3)}:1`, { aptSeq: "N1", isBackfill: 1, seenDaysAgo: 1 });
  insert(`sale:202611:${pad(4)}:1`, { aptSeq: "N1", isBackfill: 0, seenDaysAgo: 8 });
  insert(`sale:202609:${pad(5)}:1`, { aptSeq: "N1", isBackfill: 0, seenDaysAgo: 1, ymd: "202609", date: "2026-09-10" });
  insert(`sale:202608:${pad(6)}:1`, { aptSeq: "N1", isBackfill: 0, seenDaysAgo: 1, ymd: "202608", date: "2026-08-10" });
  database.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, created_at) VALUES ('W1', '가상관심', ?)").run(STAMP);
  const { realprice } = (await dashboard(realpriceOnly(db))).json.data;
  assert.equal(realprice.ok, true);
  assert.equal(realprice.newCount, 3, "이번 달 2 + 9월 1(3개월 안), 처음 채우기·8일 전·8월 뺌");
  assert.equal(realprice.watchNewCount, 1);
  assert.equal(typeof realprice.partial, "boolean");
  assert.ok(realprice.items.length <= 3);
  const usage = rows(database, "SELECT * FROM rt_daily_usage");
  assert.equal(usage.length, 1, "읽은 행 수를 하루 사용량에 더함");
});

// 일정 목록 차례(대장 결정 2026-11-23 17:3x, 사용자 원문 아님): 지난 일정은 오래된 차례로 2줄까지, 나머지는 앞날 차례로 채워 5줄. 앞날이 모자라면 남는 줄을 지난 일정으로 채움.
// 수(total·overdue)는 목록 줄 수와 상관없이 전체를 센다.
async function eventList(past, future) {
  const { database, db } = freshDb();
  seedDeal(database, { id: "d-1" });
  past.forEach((offset, index) => seedEvent(database, { id: `p-${index}`, dealId: "d-1", dueOn: day(offset) }));
  future.forEach((offset, index) => seedEvent(database, { id: `f-${index}`, dealId: "d-1", dueOn: day(offset) }));
  return (await dashboard(workOnly(db))).json.data.events;
}

test("대시보드 일정 칸: 지난 6 + 앞날 3이면 지난 것 오래된 2줄 + 앞날 3줄, 수는 9·지남 6", async () => {
  const events = await eventList([-1, -2, -3, -4, -5, -6], [0, 3, 10]);
  assert.deepEqual(events.items.map((item) => item.dueOn), [day(-6), day(-5), day(0), day(3), day(10)]);
  assert.equal(events.total, 9);
  assert.equal(events.overdue, 6);
});

test("대시보드 일정 칸: 지난 1 + 앞날 6이면 지난 1줄 + 앞날 가까운 4줄", async () => {
  const events = await eventList([-4], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(events.items.map((item) => item.dueOn), [day(-4), day(1), day(2), day(3), day(4)]);
  assert.equal(events.total, 7);
  assert.equal(events.overdue, 1);
});

test("대시보드 일정 칸: 앞날이 모자라면 남는 줄을 지난 일정(오래된 차례)으로 채움 — 지난 6 + 앞날 1 → 4 + 1, 지난 6 + 앞날 0 → 5 + 0", async () => {
  assert.deepEqual((await eventList([-1, -2, -3, -4, -5, -6], [2])).items.map((item) => item.dueOn), [day(-6), day(-5), day(-4), day(-3), day(2)]);
  const pastOnly = await eventList([-1, -2, -3, -4, -5, -6], []);
  assert.deepEqual(pastOnly.items.map((item) => item.dueOn), [day(-6), day(-5), day(-4), day(-3), day(-2)]);
  assert.equal(pastOnly.total, 6);
  assert.equal(pastOnly.overdue, 6);
  assert.deepEqual((await eventList([], [7, 1, 6, 2, 5, 3, 4])).items.map((item) => item.dueOn), [day(1), day(2), day(3), day(4), day(5)], "앞날만 7개면 가까운 5줄");
});
