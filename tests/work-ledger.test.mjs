// 업무 도구 단계 2 매출장부 API·0005 구조 시험(지시서 2.6 T2-93 ~ 105, 설계서 6.12·8.7·10.2절, DEC-WT-38·39).
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0005를 적용하고 가상 자료만 쓴다. 요청 번호(requestId)는 무작위 UUID라
// 응답 전체에서 입력값을 찾는 검사는 요청 번호를 빼고 본다(PR #96 방식). T2-105는 고약한 요청 번호 3가지로 같은 흐름을 다시 돈다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import legalRules from "../src/data/work/legal-rules.json" with { type: "json" };
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createWorkCsrfToken } from "../worker/work-security.mjs";
import { BACKUP, NOW, ORIGIN, OWNER, SECRET, allMigrationSql, authenticate, createD1, freshDb, migrationFiles, nextUuid, rows, signToken, work, workEnv } from "./work-test-kit.mjs";

const at = new Date(NOW).toISOString();
const audit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const ledgerRows = (database) => rows(database, "SELECT id, kind, deal_id, payer_role, label, entry_on, amount_won, vat_won, received_won, received_on, snap_contract_on, snap_balance_on, memo, version FROM ledger_entries ORDER BY id");
const withoutRequestId = (json) => JSON.stringify({ ...json, requestId: undefined });
const SALE = { dealType: "sale", propertyKind: "housing", priceWon: 450_000_000, contractOn: "2026-10-01", balanceOn: "2026-11-20" };

async function makeCustomer(env, displayName) {
  const result = await work(env, "/customers", { method: "POST", body: { displayName } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.customer;
}

async function makeDeal(env, body) {
  const result = await work(env, "/deals", { method: "POST", body: { title: "가상 거래", dealType: "sale", propertyKind: "housing", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.deal;
}

async function makeEntry(env, body) {
  const result = await work(env, "/ledger", { method: "POST", body });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data;
}

// 법령 데이터를 바꿔 서버를 부르는 도우미(T2-95). work-test-kit의 work()와 같고 legalRules만 넘긴다.
async function workWithRules(env, path, { method = "GET", body, now = NOW, rules } = {}) {
  const headers = { "Cf-Access-Jwt-Assertion": await signToken({ email: OWNER }) };
  if (method !== "GET") {
    headers.Origin = ORIGIN;
    headers["Content-Type"] = "application/json";
    headers["X-Admin-CSRF"] = await createWorkCsrfToken(OWNER, SECRET, now);
  }
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => now, auditLog: () => {}, randomUUID: nextUuid, legalRules: rules } });
  return { status: response.status, json: await response.json() };
}

const zeroLine = { feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 0, netWon: 0 };

test("0005는 0001 ~ 0004 위에 ledger_entries 하나만 더하고 구조 번호를 5로 올리며, 날짜 없는 줄은 막지 않고 종류·거래 칸끼리만 묶는다", () => {
  assert.equal(migrationFiles.at(-1), "0005_ledger.sql");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 4)) database.exec(sql);
  const before = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  database.exec(allMigrationSql[4]);
  const after = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  assert.deepEqual(after.filter((name) => !before.includes(name)), ["ledger_entries"], "휴지통 표(trash_*)는 넣지 않음");
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "5");
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES ('d-1', '가상', 'sale', 'housing', ?, ?)").run(at, at);
  let n = 0;
  const insert = (kind, extra = {}) => database.prepare(`INSERT INTO ledger_entries (id, kind, deal_id, payer_role, entry_on, amount_won, received_won, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(`l-${n += 1}`, kind, extra.dealId ?? null, extra.payerRole ?? null, extra.entryOn ?? null, extra.amount ?? 0, extra.received ?? 0, at, at);
  insert("expense"); // 거래·날짜 없는 지출도 표는 받는다(날짜 필수는 서버 입력 검사, 거래 삭제의 연결 끊기가 막히지 않게)
  insert("fee", { dealId: "d-1", payerRole: "buyer" });
  assert.throws(() => insert("refund"), /CHECK/u, "종류 목록 밖");
  assert.throws(() => insert("expense", { payerRole: "buyer" }), /CHECK/u, "낸 쪽 역할은 보수만");
  assert.throws(() => insert("fee", { payerRole: "boss" }), /CHECK/u);
  assert.throws(() => insert("fee", { dealId: "d-1", entryOn: "2026-11-01" }), /CHECK/u, "거래 줄은 entry_on을 쓰지 않음");
  assert.throws(() => insert("expense", { received: 1 }), /CHECK/u, "지출은 입금 0만");
  assert.throws(() => insert("fee", { amount: -1 }), /CHECK/u);
  assert.throws(() => database.exec(allMigrationSql[4]), /already exists/u, "두 번 적용하면 멈춤");
});

test("T2-93 GET /work/deals: 상태 여러 값·잔금일 달로 거르고 기준일·id 내림차순, limit=2 커서로 이어 받으면 빠짐·겹침 0, 잔금일 빈 거래는 undatedCount", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const base = { dealType: "sale", propertyKind: "housing", contractOn: "2026-10-01" };
  const a = await makeDeal(env, { ...base, title: "가상 A", status: "contracted", balanceOn: "2026-11-20", priceWon: 450_000_000 });
  const b = await makeDeal(env, { ...base, title: "가상 B", status: "completed", balanceOn: "2026-11-05" });
  const c = await makeDeal(env, { ...base, title: "가상 C", status: "contracted", balanceOn: "2026-11-20" });
  await makeDeal(env, { ...base, title: "가상 D 진행", status: "open", balanceOn: "2026-11-10" });
  await makeDeal(env, { ...base, title: "가상 E 12월", status: "completed", balanceOn: "2026-12-01" });
  await makeDeal(env, { ...base, title: "가상 F 잔금일 없음", status: "contracted" });
  await makeDeal(env, { ...base, title: "가상 G 취소", status: "cancelled" });
  await makeEntry(env, { kind: "fee", dealId: a.id, payerRole: "seller", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_000_000, receivedOn: "2026-11-20" });
  await makeEntry(env, { kind: "fee", dealId: a.id, payerRole: "buyer", amountWon: 1_500_000, vatWon: 150_000 });

  const path = "/deals?status=contracted,completed&basis=balance&month=2026-11&limit=2";
  const first = await work(env, path);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual(first.json.data.items.map((item) => item.id), [c.id, a.id], "같은 잔금일이면 id 내림차순");
  assert.equal(first.json.data.undatedCount, 1, "잔금일 빈 F만(취소 G는 상태로 빠짐)");
  assert.ok(first.json.data.nextCursor);
  assert.deepEqual(first.json.data.items[1], {
    id: a.id, title: "가상 A", dealType: "sale", propertyKind: "housing", propertyLabel: "", status: "contracted", contractOn: "2026-10-01", balanceOn: "2026-11-20",
    priceWon: 450_000_000, depositWon: null, monthlyRentWon: null, version: 1, updatedAt: at,
    ledger: { feeWon: 3_300_000, vatWon: 330_000, receivedWon: 1_000_000, unpaidWon: 980_000 + 1_650_000, entryCount: 2 },
  });
  const second = await work(env, `${path}&cursor=${first.json.data.nextCursor}`);
  assert.deepEqual(second.json.data.items.map((item) => item.id), [b.id]);
  assert.equal(second.json.data.nextCursor, null);
  assert.deepEqual(second.json.data.items[0].ledger, { feeWon: 0, vatWon: 0, receivedWon: 0, unpaidWon: 0, entryCount: 0 });
  assert.deepEqual(audit(database).filter((row) => row.action === "deal.list").map((row) => [row.target_type, row.target_id, row.reason]),
    [[null, null, "result_count=2"], [null, null, "result_count=1"]]);

  const byYear = await work(env, "/deals?status=completed&basis=contract&year=2026");
  assert.equal(byYear.json.data.items.length, 2, "계약일 기준 2026년 완료 거래(B·E)");
  const search = await work(env, "/deals?q=%EA%B0%80%EC%83%81%20f");
  assert.deepEqual(search.json.data.items.map((item) => item.title), ["가상 F 잔금일 없음"], "제목 찾기(소문자·NFKC)");
  assert.equal(search.json.data.undatedCount, 0, "기간이 없으면 빠진 거래 없음");
  const all = await work(env, "/deals");
  assert.equal(all.json.data.items.length, 7);
  for (const [query, fields] of [
    ["status=done", ["status"]],
    ["status=open,", ["status"]],
    ["month=2026-11&year=2026", ["month", "year"]],
    ["month=2026-13", ["month"]],
    ["year=26", ["year"]],
    ["basis=received&year=2026", ["basis"]],
    ["year=2026&cursor=bad!", ["cursor"]],
    ["limit=51", ["limit"]],
  ]) {
    const result = await work(env, `/deals?${query}`);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], query);
  }
});

test("T2-94 쌍방 보수 2줄 + 지출 + 기타 수입 → 달별 합계가 손 계산과 같고, 부가세는 순수익에 없으며 12달이 모두 있다(잔금일·입금일·계약일 기준)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 쌍방 거래" });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "seller", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_980_000, receivedOn: "2026-11-20" });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "buyer", amountWon: 1_500_000, vatWon: 150_000, receivedWon: 1_000_000, receivedOn: "2026-12-02" });
  await makeEntry(env, { kind: "expense", entryOn: "2026-11-03", label: "가상 광고비", amountWon: 300_000, vatWon: 30_000 });
  await makeEntry(env, { kind: "other_income", entryOn: "2026-02-14", label: "가상 기타 수입", amountWon: 200_000, vatWon: 20_000, receivedWon: 220_000, receivedOn: "2026-02-14" });

  const balance = await work(env, "/ledger/summary?year=2026&basis=balance");
  assert.equal(balance.status, 200, JSON.stringify(balance.json));
  const data = balance.json.data;
  assert.deepEqual(Object.keys(data), ["year", "months", "total", "undatedCount"]);
  assert.equal(data.months.length, 12);
  assert.deepEqual(data.months.map((line) => line.month), Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(data.months[10], { month: "2026-11", feeWon: 3_300_000, vatWon: 330_000, feeWithVatWon: 3_630_000, receivedWon: 2_980_000, unpaidWon: 650_000, expenseWon: 300_000, otherIncomeWon: 0, netWon: 3_000_000 });
  assert.deepEqual(data.months[1], { month: "2026-02", ...zeroLine, receivedWon: 220_000, otherIncomeWon: 200_000, netWon: 200_000 });
  for (const index of [0, 2, 3, 4, 5, 6, 7, 8, 9, 11]) assert.deepEqual(data.months[index], { month: data.months[index].month, ...zeroLine });
  assert.deepEqual(data.total, { feeWon: 3_300_000, vatWon: 330_000, feeWithVatWon: 3_630_000, receivedWon: 3_200_000, unpaidWon: 650_000, expenseWon: 300_000, otherIncomeWon: 200_000, netWon: 3_200_000 });
  assert.equal(data.undatedCount, 0);

  const received = (await work(env, "/ledger/summary?year=2026&basis=received")).json.data;
  // 입금일 기준: 보수·기타 수입은 입금일, 지출은 잔금일 기준과 같은 날짜(거래 없는 지출이면 그 줄의 날짜 11-03)로 들어간다.
  assert.deepEqual(received.months[10], { month: "2026-11", ...zeroLine, feeWon: 1_800_000, vatWon: 180_000, feeWithVatWon: 1_980_000, receivedWon: 1_980_000, expenseWon: 300_000, netWon: 1_500_000 });
  assert.deepEqual(received.months[11], { month: "2026-12", ...zeroLine, feeWon: 1_500_000, vatWon: 150_000, feeWithVatWon: 1_650_000, receivedWon: 1_000_000, unpaidWon: 650_000, netWon: 1_500_000 });
  assert.equal(received.undatedCount, 0, "지출도 기준일이 있음");
  assert.equal(received.total.netWon, data.total.netWon, "입금일 기준 순수익도 같은 해 안이면 잔금일 기준과 같음");
  const contract = (await work(env, "/ledger/summary?year=2026&basis=contract")).json.data;
  assert.equal(contract.months[9].feeWon, 3_300_000, "계약일(10월) 기준");
  assert.equal(contract.months[10].expenseWon, 300_000, "거래 없는 줄은 그 줄의 날짜");
  assert.equal((await work(env, "/ledger/summary?year=2025")).json.data.total.feeWon, 0);
  for (const query of ["", "?year=abcd", "?year=2026&basis=paid"]) {
    const result = await work(env, `/ledger/summary${query}`);
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], query);
  }
});

test("T2-94a 입금일 기준: 지출은 잔금일 기준과 같은 날짜(거래 잔금일 → 옮겨 둔 잔금일 → 거래 없는 줄의 날짜)로 들어가고, 입금 전 보수와 날짜가 하나도 없는 지출만 undatedCount", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 지출 거래" }); // 잔금일 2026-11-20
  const gone = await makeDeal(env, { ...SALE, title: "가상 지울 지출 거래", balanceOn: "2026-12-05" });
  const bare = await makeDeal(env, { title: "가상 날짜 없는 지출 거래", dealType: "sale", propertyKind: "housing" });
  const attached = (await makeEntry(env, { kind: "expense", dealId: deal.id, amountWon: 10_000 })).entry;
  const detached = (await makeEntry(env, { kind: "expense", dealId: gone.id, amountWon: 20_000 })).entry;
  const loose = (await makeEntry(env, { kind: "expense", entryOn: "2026-03-03", amountWon: 40_000 })).entry;
  await makeEntry(env, { kind: "expense", dealId: bare.id, amountWon: 5_000 });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "seller", amountWon: 1_000_000, vatWon: 100_000, receivedWon: 1_100_000, receivedOn: "2026-12-10" });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "buyer", amountWon: 800_000, vatWon: 80_000 }); // 입금 전
  await work(env, `/deals/${gone.id}`, { method: "DELETE", body: { confirmTitle: "가상 지울 지출 거래" } });
  await work(env, `/deals/${bare.id}`, { method: "DELETE", body: { confirmTitle: "가상 날짜 없는 지출 거래" } });
  const received = (await work(env, "/ledger/summary?year=2026&basis=received")).json.data;
  assert.deepEqual([received.months[10].expenseWon, received.months[11].expenseWon, received.months[2].expenseWon], [10_000, 20_000, 40_000],
    "거래 잔금일 11월·옮겨 둔 잔금일 12월·그 줄의 날짜 3월");
  assert.deepEqual([received.months[11].feeWon, received.months[10].feeWon], [1_000_000, 0], "입금된 보수는 입금일 달, 입금 전 보수는 빠짐");
  assert.deepEqual([received.undatedCount, received.total.expenseWon, received.total.netWon], [2, 70_000, 1_000_000 - 70_000], "입금 전 보수 1 + 날짜 없는 지출 1");
  const list = (await work(env, "/ledger?year=2026&basis=received")).json.data;
  assert.deepEqual(list.items.filter((item) => item.kind === "expense").map((item) => [item.id, item.basisOn]), [[detached.id, "2026-12-05"], [attached.id, "2026-11-20"], [loose.id, "2026-03-03"]]);
  assert.equal(list.undatedCount, 2);
});

test("T2-95 요율표를 바꾼 가짜 규칙으로 서버를 띄워도 지난 장부 금액은 그대로이고, 상한 경고만 새 요율표를 따른다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 요율 거래" });
  const made = await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "buyer", amountWon: 1_800_000, vatWon: 180_000 });
  assert.deepEqual(made.warnings, [], "지금 요율 0.4% 상한 1,800,000원과 같음");
  const stored = ledgerRows(database);
  const before = (await work(env, "/ledger/summary?year=2026")).json.data;

  const fake = structuredClone(legalRules);
  fake.brokerageFeeRules[0].housing.sale = fake.brokerageFeeRules[0].housing.sale.map((bracket) => ({ ...bracket, rateBp: 10 }));
  const summary = await workWithRules(env, "/ledger/summary?year=2026", { rules: fake });
  assert.deepEqual(summary.json.data, before, "합계는 저장값 그대로");
  const list = await workWithRules(env, "/ledger?year=2026", { rules: fake });
  assert.equal(list.json.data.items[0].amountWon, 1_800_000);
  assert.deepEqual(list.json.data.items[0].warnings, ["FEE_OVER_CAP"], "목록 경고는 지금 법령 데이터로 다시 계산");
  assert.deepEqual((await work(env, "/ledger?year=2026")).json.data.items[0].warnings, [], "진짜 요율표면 경고 없음");
  const patched = await workWithRules(env, `/ledger/${made.entry.id}`, { method: "PATCH", body: { version: 1, memo: "가상 메모만 고침" }, now: NOW + 1000, rules: fake });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.deepEqual(patched.json.data.warnings, ["FEE_OVER_CAP"], "가짜 요율 0.1%면 상한 450,000원보다 큼");
  assert.deepEqual(ledgerRows(database).map(({ amount_won, vat_won }) => [amount_won, vat_won]), stored.map(({ amount_won, vat_won }) => [amount_won, vat_won]), "다시 계산해 바꾸지 않음");
});

test("T2-97 장부 줄 2개가 있는 거래를 지우면 거래는 지워지고 장부 줄은 연결만 끊겨(snap_*·빈 label에 거래 제목) 합계가 그대로다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 지울 거래" });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "seller", amountWon: 1_800_000, vatWon: 180_000 });
  await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "buyer", label: "가상 물건 표시", amountWon: 1_500_000, vatWon: 150_000 });
  const before = {};
  for (const basis of ["balance", "contract", "received"]) before[basis] = (await work(env, `/ledger/summary?year=2026&basis=${basis}`)).json.data;

  const deleted = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" }, now: NOW + 1000 });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: { deals: 1, events: 0, notes: 0, files: 0 }, kept: { notes: 0, ledger: 2 } });
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 0);
  assert.deepEqual(ledgerRows(database).map(({ deal_id, label, entry_on, snap_contract_on, snap_balance_on, version }) => ({ deal_id, label, entry_on, snap_contract_on, snap_balance_on, version })), [
    { deal_id: null, label: "가상 지울 거래", entry_on: null, snap_contract_on: "2026-10-01", snap_balance_on: "2026-11-20", version: 2 },
    { deal_id: null, label: "가상 물건 표시", entry_on: null, snap_contract_on: "2026-10-01", snap_balance_on: "2026-11-20", version: 2 },
  ]);
  for (const basis of ["balance", "contract", "received"]) {
    assert.deepEqual((await work(env, `/ledger/summary?year=2026&basis=${basis}`)).json.data, before[basis], basis);
  }
  assert.deepEqual(audit(database).filter((row) => row.action === "deal.delete").map((row) => row.reason), [null], "감사 reason 꼴(notes_kept=)은 그대로");
});

test("T2-97a 손님 A를 지우면 A 단독 거래의 장부 줄은 연결만 끊기고(snap_* 채움), 다른 손님과 함께인 거래의 장부 줄은 그대로다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const a = await makeCustomer(env, "가상 손님 A");
  const b = await makeCustomer(env, "가상 손님 B");
  const solo = await makeDeal(env, { ...SALE, title: "가상 A 단독 거래", parties: [{ customerId: a.id, role: "buyer" }] });
  const shared = await makeDeal(env, { ...SALE, title: "가상 함께 거래", balanceOn: "2026-12-10", parties: [{ customerId: a.id, role: "buyer" }, { customerId: b.id, role: "seller" }] });
  const soloEntry = await makeEntry(env, { kind: "fee", dealId: solo.id, payerRole: "buyer", amountWon: 1_000_000, vatWon: 100_000 });
  const sharedEntry = await makeEntry(env, { kind: "fee", dealId: shared.id, payerRole: "seller", amountWon: 900_000, vatWon: 90_000 });
  const deleted = await work(env, `/customers/${a.id}`, { method: "DELETE", body: { confirmName: "가상 손님 A" }, now: NOW + 1000 });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: { customers: 1, deals: 1, notes: 0, files: 0 }, kept: { notes: 0, ledger: 1 } }, "공동 거래 장부 줄은 세지 않음");
  assert.deepEqual(audit(database).filter((row) => row.action === "customer.delete").map((row) => row.reason), [null], "감사 reason 꼴 그대로");
  const byId = Object.fromEntries(ledgerRows(database).map((row) => [row.id, row]));
  assert.deepEqual([byId[soloEntry.entry.id].deal_id, byId[soloEntry.entry.id].snap_contract_on, byId[soloEntry.entry.id].snap_balance_on, byId[soloEntry.entry.id].label, byId[soloEntry.entry.id].version],
    [null, "2026-10-01", "2026-11-20", "가상 A 단독 거래", 2]);
  assert.deepEqual([byId[sharedEntry.entry.id].deal_id, byId[sharedEntry.entry.id].snap_balance_on, byId[sharedEntry.entry.id].version], [shared.id, null, 1]);
  const nov = (await work(env, "/ledger/summary?year=2026")).json.data.months[10];
  assert.equal(nov.feeWon, 1_000_000, "끊긴 줄은 옮겨 둔 잔금일로 그대로 집계");
});

test("T2-97b 계약일·잔금일이 모두 빈 거래에 보수·지출·기타 수입 줄을 붙인 뒤 거래를 지우거나 그 거래의 단독 손님을 지워도 200이고, 줄은 날짜 없이 남아 undatedCount로 센다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const attachThree = async (dealId) => {
    await makeEntry(env, { kind: "fee", dealId, payerRole: "buyer", amountWon: 500_000, vatWon: 50_000 });
    await makeEntry(env, { kind: "expense", dealId, amountWon: 100_000 });
    await makeEntry(env, { kind: "other_income", dealId, amountWon: 70_000, vatWon: 7_000 });
  };
  const undated = { dealType: "sale", propertyKind: "housing" };
  const deal = await makeDeal(env, { ...undated, title: "가상 날짜 없는 거래" });
  await attachThree(deal.id);
  const removed = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 날짜 없는 거래" } });
  assert.equal(removed.status, 200, JSON.stringify(removed.json));
  assert.equal(removed.json.data.kept.ledger, 3);

  const customer = await makeCustomer(env, "가상 단독 손님");
  const soloDeal = await makeDeal(env, { ...undated, title: "가상 손님 날짜 없는 거래", parties: [{ customerId: customer.id, role: "buyer" }] });
  await attachThree(soloDeal.id);
  const customerRemoved = await work(env, `/customers/${customer.id}`, { method: "DELETE", body: { confirmName: "가상 단독 손님" } });
  assert.equal(customerRemoved.status, 200, JSON.stringify(customerRemoved.json));
  assert.equal(customerRemoved.json.data.deleted.deals, 1);
  assert.equal(customerRemoved.json.data.kept.ledger, 3);

  const left = ledgerRows(database);
  assert.equal(left.length, 6);
  for (const row of left) assert.deepEqual([row.deal_id, row.snap_contract_on, row.snap_balance_on, row.entry_on], [null, null, null, null], row.kind);
  assert.deepEqual(left.map((row) => row.label).sort(), ["가상 날짜 없는 거래", "가상 날짜 없는 거래", "가상 날짜 없는 거래", "가상 손님 날짜 없는 거래", "가상 손님 날짜 없는 거래", "가상 손님 날짜 없는 거래"]);
  for (const basis of ["balance", "contract", "received"]) {
    const summary = (await work(env, `/ledger/summary?year=2026&basis=${basis}`)).json.data;
    assert.equal(summary.undatedCount, 6, `합계 ${basis}`);
    assert.deepEqual(summary.total, zeroLine, `날짜 없는 줄은 합계에 없음 ${basis}`);
    const list = (await work(env, `/ledger?year=2026&basis=${basis}`)).json.data;
    assert.deepEqual([list.items.length, list.undatedCount], [0, 6], `목록 ${basis}`);
  }
  assert.equal((await work(env, "/ledger")).json.data.items.length, 6, "연도 없이 보면 날짜 없는 줄도 보임");
});

test("T2-98 장부 label·memo의 주민등록번호 형식은 가려서 저장하고 감사 reason에는 rrn_masked=<수>만 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const made = await work(env, "/ledger", { method: "POST", body: { kind: "expense", entryOn: "2026-11-02", label: "가상 900101-1234567 표시", memo: "가상 메모\r\n9001011234567 끝", amountWon: 10_000 } });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.data.entry.label, "가상 ******-******* 표시");
  assert.equal(made.json.data.entry.memo, "가상 메모\n******-******* 끝", "여러 줄 정리(CRLF → LF) 뒤 가림");
  assert.doesNotMatch(withoutRequestId(made.json), /1234567/u, "응답에 원문 없음");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "ledger.create", target_type: "ledger", target_id: made.json.data.entry.id, outcome: "ok", reason: "rrn_masked=2" });
  const patched = await work(env, `/ledger/${made.json.data.entry.id}`, { method: "PATCH", body: { version: 1, memo: "가상 다시 900101 1234567" } });
  assert.equal(patched.json.data.entry.memo, "가상 다시 ******-*******");
  assert.equal(audit(database).at(-1).reason, "rrn_masked=1");
  assert.doesNotMatch(JSON.stringify(rows(database, "SELECT label, memo FROM ledger_entries")), /1234567/u, "저장값에 원문 없음");
  const tooLong = await work(env, "/ledger", { method: "POST", body: { kind: "expense", entryOn: "2026-11-02", label: `${"가".repeat(107)}9001011234567`, amountWon: 1 } });
  assert.deepEqual([tooLong.status, tooLong.json.error.details], [400, ["label"]], "가린 뒤 121자면 400");
});

test("T2-99 법정 상한보다 큰 보수·10%와 다른 부가세는 저장하고 warnings로 알린다. 거래 없는 줄·지원 범위 밖 계약일·금액 빈 거래는 상한을 비교하지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const sale = await makeDeal(env, { ...SALE, title: "가상 매매 4억 5천" }); // 0.4% → 상한 1,800,000원
  const rent = await makeDeal(env, { title: "가상 월세", dealType: "monthly_rent", propertyKind: "housing", depositWon: 10_000_000, monthlyRentWon: 500_000, contractOn: "2026-10-01" }); // 6천만 × 0.4%, 한도 30만 → 240,000원
  const old = await makeDeal(env, { ...SALE, title: "가상 옛 계약", contractOn: "2020-01-01", balanceOn: "2020-02-01" });
  const noPrice = await makeDeal(env, { title: "가상 금액 없음", dealType: "sale", propertyKind: "housing", contractOn: "2026-10-01" });
  const officetel = await makeDeal(env, { title: "가상 오피스텔", dealType: "sale", propertyKind: "officetel", scheduleTarget: "housing", priceWon: 200_000_000, contractOn: "2026-10-01" });
  const cases = [
    [{ kind: "fee", dealId: sale.id, amountWon: 1_800_001, vatWon: 180_000 }, ["FEE_OVER_CAP"]],
    [{ kind: "fee", dealId: sale.id, amountWon: 1_800_000, vatWon: 100_000 }, ["VAT_DIFFERS"]],
    [{ kind: "fee", dealId: sale.id, amountWon: 2_000_000, vatWon: 0 }, ["VAT_DIFFERS", "FEE_OVER_CAP"]],
    [{ kind: "fee", dealId: rent.id, amountWon: 250_000, vatWon: 25_000 }, ["FEE_OVER_CAP"]],
    [{ kind: "fee", dealId: rent.id, amountWon: 240_000, vatWon: 24_000 }, []],
    [{ kind: "fee", amountWon: 99_000_000, vatWon: 9_900_000 }, []],
    [{ kind: "fee", dealId: old.id, amountWon: 99_000_000, vatWon: 9_900_000 }, []],
    [{ kind: "fee", dealId: noPrice.id, amountWon: 99_000_000, vatWon: 9_900_000 }, []],
    // 오피스텔은 주거용 조건을 모르므로 가장 높은 상한(그 밖의 건축물 0.9%, 1,800,000원)으로 비교한다.
    [{ kind: "fee", dealId: officetel.id, amountWon: 1_000_001, vatWon: 100_000 }, []],
    [{ kind: "fee", dealId: officetel.id, amountWon: 1_800_001, vatWon: 180_000 }, ["FEE_OVER_CAP"]],
    [{ kind: "other_income", entryOn: "2026-11-01", amountWon: 10_000, vatWon: 0 }, []], // 부가세 경고는 보수 줄만
    [{ kind: "expense", entryOn: "2026-11-01", amountWon: 10_000, vatWon: 3 }, []],
  ];
  for (const [body, warnings] of cases) {
    const result = await work(env, "/ledger", { method: "POST", body });
    assert.equal(result.status, 201, JSON.stringify(result.json));
    assert.deepEqual(result.json.data.warnings, warnings, JSON.stringify(body));
    assert.deepEqual([result.json.data.entry.amountWon, result.json.data.entry.vatWon], [body.amountWon, body.vatWon], "저장값 그대로");
  }
  assert.equal(ledgerRows(database).length, cases.length);
});

test("T2-99a 경고가 있는 줄을 저장한 뒤 GET /work/ledger로 다시 읽으면 줄마다 warnings[]가 저장 응답과 같고, 경고 없는 줄은 빈 배열이다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const sale = await makeDeal(env, { ...SALE, title: "가상 경고 거래" }); // 상한 1,800,000원
  const saved = [];
  for (const body of [
    { kind: "fee", dealId: sale.id, amountWon: 1_800_001, vatWon: 180_000 },
    { kind: "fee", dealId: sale.id, amountWon: 1_800_000, vatWon: 100_000 },
    { kind: "fee", dealId: sale.id, amountWon: 2_000_000, vatWon: 0 },
    { kind: "fee", dealId: sale.id, amountWon: 1_000_000, vatWon: 100_000 },
    { kind: "other_income", entryOn: "2026-11-01", amountWon: 10_000, vatWon: 0 },
    { kind: "expense", entryOn: "2026-11-01", amountWon: 10_000, vatWon: 3 },
  ]) saved.push((await makeEntry(env, body)).warnings);
  assert.deepEqual(saved, [["FEE_OVER_CAP"], ["VAT_DIFFERS"], ["VAT_DIFFERS", "FEE_OVER_CAP"], [], [], []]);
  const listed = (await work(env, "/ledger?limit=50")).json.data.items; // 같은 시각이라 id 내림차순
  assert.deepEqual(listed.map((item) => item.warnings).reverse(), saved);
  // 거래를 지워 연결이 끊긴 줄은 상한을 비교하지 않는다(거래 없음). 부가세 경고는 그대로.
  await work(env, `/deals/${sale.id}`, { method: "DELETE", body: { confirmTitle: "가상 경고 거래" } });
  const afterDelete = (await work(env, "/ledger?limit=50")).json.data.items.reverse().slice(0, 4).map((item) => item.warnings);
  assert.deepEqual(afterDelete, [[], ["VAT_DIFFERS"], ["VAT_DIFFERS"], []]);
});

test("T2-100 만들기 입력 검사: 칸 이름만 400으로 알리고 표·감사는 그대로다. 거래 없는 보수 줄은 날짜 없이도 만든다(D-5)", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE });
  const expense = { kind: "expense", entryOn: "2026-11-01", amountWon: 10_000 };
  for (const [body, fields] of [
    [{ ...expense, payerRole: "buyer" }, ["payerRole"]],
    [{ ...expense, receivedWon: 1 }, ["receivedWon"]],
    [{ kind: "fee", dealId: deal.id, entryOn: "2026-11-01", amountWon: 1 }, ["entryOn"]],
    [{ kind: "expense", amountWon: 1 }, ["entryOn"]],
    [{ kind: "other_income", amountWon: 1 }, ["entryOn"]],
    [{ ...expense, amountWon: -1 }, ["amountWon"]],
    [{ ...expense, amountWon: 1.5 }, ["amountWon"]],
    [{ ...expense, amountWon: "100" }, ["amountWon"]],
    [{ ...expense, amountWon: null }, ["amountWon"]],
    [{ kind: "expense", entryOn: "2026-11-01" }, ["amountWon"]],
    [{ ...expense, vatWon: -1 }, ["vatWon"]],
    [{ ...expense, receivedWon: 0.5 }, ["receivedWon"]],
    [{ kind: "fee", dealId: "00000000-0000-4000-8000-999999999999", amountWon: 1 }, ["dealId"]],
    [{ kind: "fee", dealId: "abc", amountWon: 1 }, ["dealId"]],
    [{ ...expense, kind: "refund" }, ["kind"]],
    [{ amountWon: 1 }, ["kind"]],
    [{ ...expense, extra: 1 }, ["extra"]],
    [{ ...expense, entryOn: "2026-02-30" }, ["entryOn"]],
    [{ ...expense, receivedOn: "2026/11/01" }, ["receivedOn"]],
    [{ ...expense, label: "가".repeat(121) }, ["label"]],
    [{ ...expense, memo: "가".repeat(501) }, ["memo"]],
    [{ ...expense, memo: 5 }, ["memo"]],
    [{ kind: "fee", payerRole: "boss", amountWon: 1 }, ["payerRole"]],
  ]) {
    const result = await work(env, "/ledger", { method: "POST", body });
    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(result.json.error.code, "VALIDATION_FAILED");
    assert.deepEqual(result.json.error.details, fields, JSON.stringify(body).slice(0, 80));
  }
  assert.equal(ledgerRows(database).length, 0, "표 그대로");
  assert.equal(audit(database).filter((row) => row.action === "ledger.create").length, 0);
  const undatedFee = await work(env, "/ledger", { method: "POST", body: { kind: "fee", amountWon: 300_000, vatWon: 30_000 } });
  assert.equal(undatedFee.status, 201, "거래·날짜 없는 보수 줄 허용(D-5)");
  assert.deepEqual([undatedFee.json.data.entry.basisOn, undatedFee.json.data.entry.unpaidWon], [null, 330_000]);
  assert.equal((await work(env, "/ledger/summary?year=2026")).json.data.undatedCount, 1);
});

test("T2-100a 고치기 입력 검사는 저장된 줄 + 고칠 값의 최종 상태로 한다: kind·dealId는 받지 않고, CHECK에 걸릴 조합은 모두 400이며 500이 없다. 날짜 없이 끊긴 줄에는 entryOn을 줄 수 있다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 고칠 거래" });
  const other = await makeDeal(env, { ...SALE, title: "가상 다른 거래" });
  const fee = (await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "buyer", amountWon: 1_000_000, vatWon: 100_000 })).entry;
  const expense = (await makeEntry(env, { kind: "expense", entryOn: "2026-11-01", amountWon: 50_000 })).entry;
  const statuses = [];
  for (const [id, body, fields] of [
    [fee.id, { version: 1, kind: "expense" }, ["kind"]],
    [fee.id, { version: 1, kind: "expense", payerRole: null }, ["kind"]],
    [fee.id, { version: 1, dealId: other.id }, ["dealId"]],
    [fee.id, { version: 1, dealId: null }, ["dealId"]],
    [fee.id, { version: 1, entryOn: "2026-11-01" }, ["entryOn"]],
    [expense.id, { version: 1, receivedWon: 5 }, ["receivedWon"]],
    [expense.id, { version: 1, payerRole: "buyer" }, ["payerRole"]],
    [expense.id, { version: 1, entryOn: null }, ["entryOn"]],
    [expense.id, { version: 1, amountWon: -5 }, ["amountWon"]],
    [expense.id, { version: 1 }, ["body"]],
    [expense.id, { version: 0, memo: "x" }, ["version"]],
  ]) {
    const result = await work(env, `/ledger/${id}`, { method: "PATCH", body });
    statuses.push(result.status);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.json.error.details, fields, JSON.stringify(body));
  }
  assert.ok(statuses.every((status) => status < 500));
  assert.deepEqual(ledgerRows(database).map((row) => row.version), [1, 1], "표 그대로");
  assert.equal(audit(database).filter((row) => row.action === "ledger.update").length, 0);

  const cleared = await work(env, `/ledger/${fee.id}`, { method: "PATCH", body: { version: 1, payerRole: null, receivedWon: 1_100_000, receivedOn: "2026-11-21" } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.json));
  assert.deepEqual([cleared.json.data.entry.payerRole, cleared.json.data.entry.unpaidWon, cleared.json.data.entry.dealId, cleared.json.data.entry.kind], [null, 0, deal.id, "fee"]);

  // 날짜 없는 거래를 지워 snap_*가 빈 채 끊긴 지출 줄에는 날짜를 줄 수 있고, 그 날짜로 합계에 들어간다.
  const bare = await makeDeal(env, { title: "가상 날짜 없음", dealType: "sale", propertyKind: "housing" });
  const loose = (await makeEntry(env, { kind: "expense", dealId: bare.id, amountWon: 40_000 })).entry;
  await work(env, `/deals/${bare.id}`, { method: "DELETE", body: { confirmTitle: "가상 날짜 없음" } });
  assert.equal((await work(env, "/ledger/summary?year=2026")).json.data.undatedCount, 1);
  const memoOnly = await work(env, `/ledger/${loose.id}`, { method: "PATCH", body: { version: 2, memo: "가상 날짜 없이 메모만" } });
  assert.equal(memoOnly.status, 200, "날짜 없이 끊긴 줄의 다른 칸은 고칠 수 있음");
  const dated = await work(env, `/ledger/${loose.id}`, { method: "PATCH", body: { version: 3, entryOn: "2026-11-15" } });
  assert.equal(dated.status, 200, JSON.stringify(dated.json));
  assert.equal(dated.json.data.entry.basisOn, "2026-11-15");
  const summary = (await work(env, "/ledger/summary?year=2026")).json.data;
  assert.deepEqual([summary.undatedCount, summary.months[10].expenseWon], [0, 90_000]);
});

test("T2-100b receivedOn 검사(만들기·고치기 최종 상태): 입금액이 있는데 입금일 없음, 입금액 0인데 입금일 있음, 지출 줄의 입금일은 모두 400 [\"receivedOn\"]이고 500이 없다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE });
  for (const body of [
    { kind: "fee", dealId: deal.id, amountWon: 1_000, receivedWon: 1_000 },
    { kind: "fee", dealId: deal.id, amountWon: 1_000, receivedOn: "2026-11-20" },
    { kind: "fee", dealId: deal.id, amountWon: 1_000, receivedWon: 0, receivedOn: "2026-11-20" },
    { kind: "other_income", entryOn: "2026-11-01", amountWon: 1_000, receivedWon: 500 },
    { kind: "other_income", entryOn: "2026-11-01", amountWon: 1_000, receivedOn: "2026-11-02" },
    { kind: "expense", entryOn: "2026-11-01", amountWon: 1_000, receivedOn: "2026-11-02" },
  ]) {
    const result = await work(env, "/ledger", { method: "POST", body });
    assert.deepEqual([result.status, result.json.error?.code, result.json.error?.details], [400, "VALIDATION_FAILED", ["receivedOn"]], JSON.stringify(body));
  }
  assert.equal(ledgerRows(database).length, 0);

  const fee = (await makeEntry(env, { kind: "fee", dealId: deal.id, amountWon: 1_000, receivedWon: 1_000, receivedOn: "2026-11-20" })).entry;
  const unpaid = (await makeEntry(env, { kind: "fee", dealId: deal.id, amountWon: 2_000 })).entry;
  const expense = (await makeEntry(env, { kind: "expense", entryOn: "2026-11-01", amountWon: 1_000 })).entry;
  for (const [id, body] of [
    [fee.id, { version: 1, receivedWon: 0 }], // 저장된 입금일이 남음
    [fee.id, { version: 1, receivedOn: null }], // 저장된 입금액이 남음
    [unpaid.id, { version: 1, receivedWon: 500 }],
    [unpaid.id, { version: 1, receivedOn: "2026-11-21" }],
    [expense.id, { version: 1, receivedOn: "2026-11-02" }],
  ]) {
    const result = await work(env, `/ledger/${id}`, { method: "PATCH", body });
    assert.deepEqual([result.status, result.json.error?.details], [400, ["receivedOn"]], JSON.stringify(body));
  }
  assert.deepEqual(ledgerRows(database).map((row) => row.version), [1, 1, 1], "표 그대로");
  const both = await work(env, `/ledger/${fee.id}`, { method: "PATCH", body: { version: 1, receivedWon: 0, receivedOn: null } });
  assert.equal(both.status, 200, "입금액·입금일을 함께 비우면 됨");
  const paid = await work(env, `/ledger/${unpaid.id}`, { method: "PATCH", body: { version: 1, receivedWon: 500, receivedOn: "2026-11-21" } });
  assert.equal(paid.status, 200, "입금액·입금일을 함께 넣으면 됨");
});

test("T2-101 같은 줄을 두 관리자가 같은 version으로 고치면 하나만 200, 다른 하나는 409이고 감사는 성공 1건만 남는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const entry = (await makeEntry(env, { kind: "expense", entryOn: "2026-11-01", amountWon: 50_000 })).entry;
  const firstEdit = await work(env, `/ledger/${entry.id}`, { method: "PATCH", body: { version: 1, amountWon: 60_000 }, email: OWNER, now: NOW + 1000 });
  const secondEdit = await work(env, `/ledger/${entry.id}`, { method: "PATCH", body: { version: 1, amountWon: 70_000 }, email: BACKUP, now: NOW + 1000 });
  assert.deepEqual([firstEdit.status, secondEdit.status, secondEdit.json.error.code], [200, 409, "VERSION_CONFLICT"]);
  // 미리 읽은 뒤 batch 전에 다른 관리자가 먼저 고친 경우도 guard가 되돌린다.
  db.beforeNextBatch = () => database.prepare("UPDATE ledger_entries SET amount_won = 80000, version = version + 1 WHERE id = ?").run(entry.id);
  const raced = await work(env, `/ledger/${entry.id}`, { method: "PATCH", body: { version: 2, amountWon: 90_000 }, email: BACKUP, now: NOW + 2000 });
  assert.deepEqual([raced.status, raced.json.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal(ledgerRows(database)[0].amount_won, 80_000);
  assert.deepEqual(audit(database).filter((row) => row.action === "ledger.update").map((row) => row.actor_email), [OWNER]);
  // 지우기: 있으면 200, 다시 지우면 404. 본문이 있으면 400.
  assert.deepEqual((await work(env, `/ledger/${entry.id}`, { method: "DELETE", body: { confirm: "x" } })).json.error.details, ["confirm"]);
  const removed = await work(env, `/ledger/${entry.id}`, { method: "DELETE" });
  assert.deepEqual([removed.status, removed.json.data], [200, { deleted: true }]);
  assert.equal((await work(env, `/ledger/${entry.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await work(env, `/ledger/${entry.id}`, { method: "PATCH", body: { version: 3, memo: "x" } })).status, 404);
});

test("T2-102 장부 줄을 만드는 사이 그 거래가 지워지면 줄이 생기지 않고 409이며, 거래 없는 deal_id가 남지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 사라질 거래" });
  db.beforeNextBatch = () => database.prepare("DELETE FROM deals WHERE id = ?").run(deal.id);
  const result = await work(env, "/ledger", { method: "POST", body: { kind: "fee", dealId: deal.id, amountWon: 1_000 } });
  assert.deepEqual([result.status, result.json.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal(ledgerRows(database).length, 0);
  assert.equal(audit(database).filter((row) => row.action === "ledger.create").length, 0);

  // 반대 순서(줄을 만든 뒤 거래 삭제)는 연결이 끊긴 상태로 남는다(T2-97).
  const next = await makeDeal(env, { ...SALE, title: "가상 뒤에 지울 거래" });
  await makeEntry(env, { kind: "fee", dealId: next.id, amountWon: 1_000 });
  await work(env, `/deals/${next.id}`, { method: "DELETE", body: { confirmTitle: "가상 뒤에 지울 거래" } });
  assert.equal(rows(database, "SELECT count(*) AS n FROM ledger_entries WHERE deal_id IS NOT NULL AND deal_id NOT IN (SELECT id FROM deals)")[0].n, 0);
  assert.equal(ledgerRows(database).length, 1);
});

test("T2-103 감사 기록: ledger.create·update·delete·list·view와 deal.list가 남고, reason에는 금액·메모·이름 원문이 없다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE, title: "가상 감사 거래" });
  const entry = (await makeEntry(env, { kind: "fee", dealId: deal.id, payerRole: "seller", label: "가상 감사 물건", memo: "가상 감사 메모", amountWon: 1_234_000, vatWon: 123_400 })).entry;
  const edited = await work(env, `/ledger/${entry.id}`, { method: "PATCH", body: { version: 1, receivedWon: 1_357_400, receivedOn: "2026-11-21", memo: "가상 감사 메모 고침" } });
  assert.equal(edited.status, 200, JSON.stringify(edited.json));
  await work(env, "/ledger?year=2026");
  await work(env, `/ledger?dealId=${deal.id}`);
  await work(env, "/ledger/summary?year=2026");
  await work(env, "/deals?status=open");
  await work(env, `/ledger/${entry.id}`, { method: "DELETE" });
  const rowsOf = audit(database).filter((row) => row.action.startsWith("ledger.") || row.action === "deal.list");
  assert.deepEqual(rowsOf.map((row) => [row.action, row.target_type, row.target_id, row.reason]), [
    ["ledger.create", "ledger", entry.id, null],
    ["ledger.update", "ledger", entry.id, null],
    ["ledger.list", null, null, "result_count=1"],
    ["ledger.list", null, null, "result_count=1"],
    ["ledger.view", null, null, null],
    ["deal.list", null, null, "result_count=1"],
    ["ledger.delete", "ledger", entry.id, null],
  ]);
  assert.doesNotMatch(JSON.stringify(audit(database)), /1234000|1,234,000|123400|1357400|가상 감사 메모|가상 감사 물건|가상 감사 거래/u);
  // 실패한 요청(400·404)은 장부 감사를 남기지 않는다.
  const count = audit(database).length;
  await work(env, "/ledger", { method: "POST", body: { kind: "expense", amountWon: 1 } });
  await work(env, "/ledger/00000000-0000-4000-8000-999999999999", { method: "PATCH", body: { version: 1, memo: "x" } });
  assert.equal(audit(database).length, count);
});

test("장부 목록: 연도·기준일·종류·거래·미입금으로 거르고, 정렬마다 커서로 이어 받으면 빠짐·겹침 0이며, 경로는 정해진 방식만 받는다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const deal = await makeDeal(env, { ...SALE });
  const ids = [];
  for (const [body] of [
    [{ kind: "fee", dealId: deal.id, payerRole: "seller", amountWon: 1_000_000, vatWon: 100_000, receivedWon: 1_100_000, receivedOn: "2026-11-20" }],
    [{ kind: "fee", dealId: deal.id, payerRole: "buyer", amountWon: 900_000, vatWon: 90_000, receivedWon: 90_000, receivedOn: "2026-11-20" }],
    [{ kind: "expense", entryOn: "2026-11-25", amountWon: 30_000 }],
    [{ kind: "other_income", entryOn: "2026-03-01", amountWon: 50_000, vatWon: 5_000 }],
    [{ kind: "expense", entryOn: "2025-12-31", amountWon: 20_000 }],
  ]) ids.push((await makeEntry(env, body)).entry.id);

  const collect = async (query) => {
    const seen = [];
    let cursor = null;
    for (let guard = 0; guard < 10; guard += 1) {
      const result = await work(env, `/ledger?${query}&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      assert.equal(result.status, 200, JSON.stringify(result.json));
      seen.push(...result.json.data.items);
      cursor = result.json.data.nextCursor;
      if (!cursor) break;
    }
    return seen;
  };
  const byBasis = await collect("year=2026&basis=balance");
  assert.deepEqual(byBasis.map((item) => [item.id, item.basisOn]), [[ids[2], "2026-11-25"], [ids[1], "2026-11-20"], [ids[0], "2026-11-20"], [ids[3], "2026-03-01"]]);
  const unpaid = await collect("unpaid=1");
  assert.deepEqual(unpaid.map((item) => [item.id, item.unpaidWon]), [[ids[1], 900_000], [ids[3], 55_000]], "미입금액 큰 순, 지출·다 받은 줄 없음");
  const updated = await collect("kind=expense");
  assert.deepEqual(updated.map((item) => item.id), [ids[4], ids[2]], "연도 없으면 고친 시각·id 내림차순");
  const forDeal = (await work(env, `/ledger?dealId=${deal.id}`)).json.data;
  assert.deepEqual(forDeal.items.map((item) => item.id), [ids[1], ids[0]]);
  assert.deepEqual(Object.keys(forDeal.items[0]), ["id", "kind", "dealId", "payerRole", "label", "entryOn", "amountWon", "vatWon", "receivedWon", "receivedOn", "snapContractOn", "snapBalanceOn", "memo", "version", "createdAt", "updatedAt", "unpaidWon", "basisOn", "warnings"]);
  for (const query of ["year=1999", "basis=paid", "unpaid=yes", "kind=fees", "dealId=abc", "year=2026&cursor=bad!", "unpaid=1&cursor=" + Buffer.from(JSON.stringify({ k: "2026-11-01", i: ids[0] })).toString("base64url")]) {
    const result = await work(env, `/ledger?${query}`);
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], query);
  }
  for (const [path, method, allow] of [["/ledger", "PUT", "GET, POST"], ["/ledger/summary", "POST", "GET"], [`/ledger/${ids[0]}`, "GET", "PATCH, DELETE"]]) {
    const result = await work(env, path, { method, body: method === "GET" ? undefined : {} });
    assert.equal(result.status, 405, path);
    assert.equal(result.response.headers.get("Allow"), allow, path);
  }
  assert.equal((await work(env, "/ledger/not-a-uuid", { method: "PATCH", body: { version: 1, memo: "x" } })).status, 404);
  assert.equal((await work(env, "/ledger/summary/x")).status, 404);
});

test("T2-96a POST /work/ledger/export: CSV 내려받기 전 감사 export.ledger 한 줄(reason result_count만)을 남기고 자료는 돌려주지 않으며, 잘못된 본문은 400, 꺼짐·구조 번호 4는 503", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  await makeEntry(env, { kind: "expense", entryOn: "2026-11-05", label: "가상 내려받기 지출", amountWon: 33_000 });
  const before = audit(database).length;
  const ok = await work(env, "/ledger/export", { method: "POST", body: { year: 2026, basis: "received", count: 1 } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.data, { recorded: true });
  const added = audit(database).slice(before);
  assert.deepEqual(added.map((row) => [row.action, row.target_type, row.target_id, row.outcome, row.reason]), [["export.ledger", null, null, "ok", "result_count=1"]]);
  assert.doesNotMatch(JSON.stringify(added), /2026|received|가상 내려받기|33000/u, "감사에는 줄 수만");
  assert.equal((await work(env, "/ledger/export", { method: "POST", body: { year: "2026", basis: "balance", count: 0 } })).status, 200, "글자 연도·0줄도 받음");

  for (const [body, fields] of [
    [{ basis: "balance", count: 1 }, ["year"]],
    [{ year: 1999, basis: "balance", count: 1 }, ["year"]],
    [{ year: 2026.5, basis: "balance", count: 1 }, ["year"]],
    [{ year: 2026, count: 1 }, ["basis"]],
    [{ year: 2026, basis: "paid", count: 1 }, ["basis"]],
    [{ year: 2026, basis: "balance", count: -1 }, ["count"]],
    [{ year: 2026, basis: "balance", count: 1.5 }, ["count"]],
    [{ year: 2026, basis: "balance", count: "3" }, ["count"]],
    [{ year: 2026, basis: "balance", count: 100_001 }, ["count"]],
    [{ year: 2026, basis: "balance", count: 1, rows: [] }, ["rows"]],
  ]) {
    const result = await work(env, "/ledger/export", { method: "POST", body });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], JSON.stringify(body));
  }
  const wrongMethod = await work(env, "/ledger/export");
  assert.deepEqual([wrongMethod.status, wrongMethod.response.headers.get("Allow")], [405, "POST"]);
  assert.equal(audit(database).filter((row) => row.action === "export.ledger").length, 2, "실패한 요청은 감사를 남기지 않음");

  const off = freshDb();
  const disabled = await work(workEnv(off.db, { WORK_TOOLS_ENABLED: undefined }), "/ledger/export", { method: "POST", body: { year: 2026, basis: "balance", count: 1 } });
  assert.deepEqual([disabled.status, disabled.json.error.code], [503, "WORK_DISABLED"]);
  assert.equal(off.db.stats.statements, 0);
  const old = new DatabaseSync(":memory:");
  old.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 4)) old.exec(sql);
  const outdated = await work(workEnv(createD1(old)), "/ledger/export", { method: "POST", body: { year: 2026, basis: "balance", count: 1 } });
  assert.deepEqual([outdated.status, outdated.json.error.code], [503, "WORK_SCHEMA_OUTDATED"]);
  assert.deepEqual(audit(old).map((row) => [row.action, row.outcome]), [["request.denied", "denied"]]);
});

test("T2-104 업무 도구가 꺼져 있으면 장부·거래 목록 모두 503 WORK_DISABLED(D1 0), 구조 번호 4인 D1이면 503 WORK_SCHEMA_OUTDATED(거부 기록 외 쓰기 0)", async () => {
  const paths = [["/ledger?year=2026", "GET"], ["/ledger/summary?year=2026", "GET"], ["/deals", "GET"], ["/ledger", "POST"]];
  const off = freshDb();
  for (const [path, method] of paths) {
    const result = await work(workEnv(off.db, { WORK_TOOLS_ENABLED: undefined }), path, { method, body: method === "POST" ? { kind: "fee", amountWon: 1 } : undefined });
    assert.deepEqual([result.status, result.json.error.code], [503, "WORK_DISABLED"], path);
  }
  assert.deepEqual([off.db.stats.statements, rows(off.database, "SELECT count(*) AS n FROM audit_events")[0].n], [0, 0]);

  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 4)) database.exec(sql);
  const db = createD1(database);
  for (const [path, method] of paths) {
    const result = await work(workEnv(db), path, { method, body: method === "POST" ? { kind: "fee", amountWon: 1 } : undefined });
    assert.deepEqual([result.status, result.json.error.code], [503, "WORK_SCHEMA_OUTDATED"], path);
  }
  assert.deepEqual(audit(database).map((row) => [row.action, row.outcome, row.reason]), paths.map(() => ["request.denied", "denied", "WORK_SCHEMA_OUTDATED"]));
  assert.equal(db.stats.batches.length, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM sqlite_master WHERE name = 'ledger_entries'")[0].n, 0);
});

test("T2-105 고약한 요청 번호(UUID) 3가지에서도 만들기·고치기·목록·합계·지우기와 입력값 없음 검사가 흔들리지 않는다(PR #96 방식)", async (t) => {
  const NASTY = [
    "12345678-1234-4567-8901-123456789012", // 금액·주민번호 조각처럼 보이는 숫자
    "abcdabcd-abcd-4bcd-abcd-abcdabcdabcd",
    "90010112-3456-4789-8000-001234567000",
  ];
  for (const requestId of NASTY) {
    t.mock.method(globalThis.crypto, "randomUUID", () => requestId);
    const { database, db } = freshDb();
    const env = workEnv(db);
    const made = await work(env, "/ledger", { method: "POST", body: { kind: "expense", entryOn: "2026-11-02", memo: "가상 900101-1234567", amountWon: 12_345_678 } });
    assert.equal(made.status, 201, requestId);
    assert.equal(made.json.requestId, requestId, "모의 요청 번호가 실제로 쓰임");
    assert.doesNotMatch(withoutRequestId(made.json), /1234567(?!8)/u, requestId);
    const bad = await work(env, "/ledger", { method: "POST", body: { kind: "expense", entryOn: "2026-11-02", memo: 1234567, amountWon: 1 } });
    assert.deepEqual([bad.status, bad.json.error.details], [400, ["memo"]], requestId);
    assert.doesNotMatch(withoutRequestId(bad.json), /1234567/u, "오류 응답에 입력값 없음");
    const patched = await work(env, `/ledger/${made.json.data.entry.id}`, { method: "PATCH", body: { version: 1, amountWon: 1 } });
    assert.equal(patched.status, 200, requestId);
    assert.equal((await work(env, "/ledger?year=2026")).json.data.items.length, 1);
    assert.equal((await work(env, "/ledger/summary?year=2026")).json.data.total.expenseWon, 1);
    assert.equal((await work(env, `/ledger/${made.json.data.entry.id}`, { method: "DELETE" })).status, 200);
    assert.ok(rows(database, "SELECT request_id FROM audit_events").every((row) => row.request_id === requestId));
    assert.ok(rows(database, "SELECT reason FROM audit_events").every((row) => row.reason === null || /^(rrn_masked|result_count)=\d+$/u.test(row.reason)));
    t.mock.restoreAll();
  }
});
