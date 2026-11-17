// 업무 도구 단계 2 PR-B1: 거래·참여자 API와 0002 구조 시험. 진짜 SQLite(node:sqlite)에 0001·0002를 적용하고 가짜 자료만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { NOW, OWNER, freshDb, migrationFiles, migrationSql, rows, work, workEnv } from "./work-test-kit.mjs";

const migration0002 = await readFile(new URL("../migrations/work/0002_deal_schedule_inputs.sql", import.meta.url), "utf8");
const audit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const at = new Date(NOW).toISOString();

async function makeCustomer(env, displayName) {
  const result = await work(env, "/customers", { method: "POST", body: { displayName } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.customer;
}

async function makeDeal(env, body) {
  const result = await work(env, "/deals", { method: "POST", body: { title: "가상 거래", dealType: "sale", propertyKind: "housing", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data;
}

test("0002는 0001 위에 거래 일정 입력 칸 7개를 더하고 구조 번호를 2로 올리며, 규제 단계·매매 세부 종류·오피스텔 판정을 칸끼리 묶는다", () => {
  assert.deepEqual(migrationFiles, ["0001_init.sql", "0002_deal_schedule_inputs.sql"], "0001은 그대로 두고 0002를 새 파일로");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(migrationSql);
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES ('before', '가상 기존 거래', 'sale', 'housing', ?, ?)").run(at, at);
  database.exec(migration0002);
  assert.equal(JSON.parse(database.prepare("SELECT value_json FROM settings WHERE key = 'schema_version'").get().value_json), 2);
  const columns = database.prepare("PRAGMA table_info(deals)").all().map((row) => row.name);
  for (const name of ["sale_kind", "regulation", "schedule_target", "land_share", "separate_funding_submission", "lease_reporting_region", "lease_renewal_without_change"]) {
    assert.ok(columns.includes(name), name);
  }
  assert.deepEqual({ ...database.prepare("SELECT regulation, regulated_area, sale_kind, lease_reporting_region FROM deals WHERE id = 'before'").get() },
    { regulation: "none", regulated_area: 0, sale_kind: null, lease_reporting_region: 1 }, "기존 행은 기본값");
  const insert = (id, extra) => database.prepare(`INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at${extra.columns}) VALUES (?, '가상', ?, ?, ?, ?${extra.values})`)
    .run(id, extra.dealType ?? "sale", extra.propertyKind ?? "housing", at, at, ...(extra.args ?? []));
  assert.throws(() => insert("r1", { columns: ", regulation, regulated_area", values: ", ?, ?", args: ["adjusted", 0] }), /CHECK/u, "조정지역인데 regulated_area 0");
  assert.throws(() => insert("r2", { columns: ", regulation, regulated_area", values: ", ?, ?", args: ["none", 1] }), /CHECK/u, "비규제인데 regulated_area 1");
  assert.throws(() => database.exec("UPDATE deals SET regulated_area = 1 WHERE id = 'before'"), /CHECK/u, "regulated_area만 따로 못 바꿈");
  insert("r3", { columns: ", regulation, regulated_area", values: ", ?, ?", args: ["overheated", 1] });
  assert.throws(() => insert("s1", { dealType: "jeonse", columns: ", sale_kind", values: ", ?", args: ["supply"] }), /CHECK/u, "매매가 아닌데 세부 종류");
  insert("s2", { columns: ", sale_kind", values: ", ?", args: ["status_sale"] });
  assert.throws(() => insert("o1", { propertyKind: "housing", columns: ", schedule_target", values: ", ?", args: ["housing"] }), /CHECK/u, "오피스텔이 아닌데 일정 판정 선택");
  assert.throws(() => insert("o2", { propertyKind: "officetel", columns: ", schedule_target", values: ", ?", args: ["land"] }), /CHECK/u, "오피스텔은 주택·그 밖만");
  insert("o3", { propertyKind: "officetel", columns: ", schedule_target", values: ", ?", args: ["housing"] });
  assert.throws(() => insert("f1", { columns: ", land_share", values: ", ?", args: [2] }), /CHECK/u);

  const stale = new DatabaseSync(":memory:");
  stale.exec(migrationSql);
  stale.prepare("INSERT INTO deals (id, title, deal_type, property_kind, regulated_area, created_at, updated_at) VALUES ('x', '가상', 'sale', 'housing', 1, ?, ?)").run(at, at);
  assert.throws(() => stale.exec(migration0002), /CHECK/u, "regulated_area 1인 기존 행이 있으면 0002가 멈춤(운영 D1은 빈 표)");
});

test("거래 만들기: 201, 기본값(일반 매매·비규제·수도권등·임대차 신고 지역), regulated_area는 규제 단계에서만 만들고, 참여자와 감사가 함께 들어간다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const buyer = await makeCustomer(env, "가상 손님 매수");
  const seller = await makeCustomer(env, "가상 손님 매도");
  const created = await makeDeal(env, { title: "가상단지 101동 900101-1234567", priceWon: 450_000_000, contractOn: "2026-11-20", regulation: "overheated", parties: [{ customerId: buyer.id, role: "buyer" }, { customerId: seller.id, role: "seller" }] });
  assert.equal(created.deal.title, "가상단지 101동 ******-*******", "제목의 주민번호 형태는 가림");
  assert.equal(created.deal.saleKind, "sale");
  assert.equal(created.deal.regulation, "overheated");
  assert.equal(created.deal.metroArea, true);
  assert.equal(created.deal.leaseReportingRegion, true);
  assert.equal(created.deal.status, "open");
  assert.equal(created.deal.closedOn, null);
  assert.equal(created.deal.version, 1);
  assert.deepEqual(created.parties.map((party) => [party.role, party.displayName]).sort(), [["buyer", "가상 손님 매수"], ["seller", "가상 손님 매도"]]);
  assert.equal(rows(database, "SELECT regulated_area FROM deals")[0].regulated_area, 1, "투기과열 → 1");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "deal.create", target_type: "deal", target_id: created.deal.id, outcome: "ok", reason: "rrn_masked=1" });

  const done = await makeDeal(env, { title: "가상 완료 거래", dealType: "jeonse", depositWon: 200_000_000, status: "completed" });
  assert.equal(done.deal.saleKind, null);
  assert.equal(done.deal.closedOn, "2026-11-17", "만들 때 완료면 오늘(한국 날짜)");
  assert.equal(done.deal.retentionUntil, "2027-11-17");
  const officetel = await makeDeal(env, { title: "가상 오피스텔", dealType: "monthly_rent", propertyKind: "officetel", scheduleTarget: "housing", depositWon: 10_000_000, monthlyRentWon: 500_000 });
  assert.equal(officetel.deal.scheduleTarget, "housing");
});

test("거래 입력 검사: 칸 이름만 알려 주고, 거래 종류에 없는 금액·세부 종류, 오피스텔 일정 판정, 날짜 앞뒤, 참여자 모양을 막는다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, "가상 손님");
  const base = { title: "가상 거래", dealType: "sale", propertyKind: "housing" };
  for (const [body, fields] of [
    [{ dealType: "sale", propertyKind: "housing" }, ["title"]],
    [{ title: "가상", propertyKind: "housing" }, ["dealType"]],
    [{ ...base, dealType: "lease" }, ["dealType"]],
    [{ ...base, title: "가".repeat(81) }, ["title"]],
    [{ ...base, dealType: "jeonse", priceWon: 1 }, ["priceWon"]],
    [{ ...base, depositWon: 1 }, ["depositWon"]],
    [{ ...base, dealType: "jeonse", saleKind: "supply" }, ["saleKind"]],
    [{ ...base, propertyKind: "officetel" }, ["scheduleTarget"]],
    [{ ...base, scheduleTarget: "housing" }, ["scheduleTarget"]],
    [{ ...base, propertyKind: "officetel", scheduleTarget: "land" }, ["scheduleTarget"]],
    [{ ...base, contractOn: "2026-02-30" }, ["contractOn"]],
    [{ ...base, contractOn: "2026-11-20", balanceOn: "2026-11-19" }, ["balanceOn"]],
    [{ ...base, priceWon: -1 }, ["priceWon"]],
    [{ ...base, priceWon: 1.5 }, ["priceWon"]],
    [{ ...base, landShare: "yes" }, ["landShare"]],
    [{ ...base, regulation: "high" }, ["regulation"]],
    [{ ...base, regulatedArea: true }, ["regulatedArea"]],
    [{ ...base, parties: [{ customerId: customer.id, role: "boss" }] }, ["parties"]],
    [{ ...base, parties: [{ customerId: customer.id, role: "buyer" }, { customerId: customer.id, role: "buyer" }] }, ["parties"]],
    [{ ...base, parties: Array.from({ length: 11 }, (_, index) => ({ customerId: customer.id, role: ["buyer", "seller", "tenant", "landlord", "other"][index % 5] })) }, ["parties"]],
    [{ ...base, parties: [{ customerId: "00000000-0000-4000-8000-999999999999", role: "buyer" }] }, ["parties"]],
  ]) {
    const result = await work(env, "/deals", { method: "POST", body });
    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 80));
    assert.equal(result.json.error.code, "VALIDATION_FAILED");
    assert.deepEqual(result.json.error.details, fields, JSON.stringify(body).slice(0, 80));
  }
});

test("거래 보기: 거래·참여자·일정·메모·파일을 주고 deal.view 감사를 남긴다. 없는 거래·이상한 ID는 404이고 감사가 없다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, "가상 손님");
  const { deal } = await makeDeal(env, { parties: [{ customerId: customer.id, role: "buyer" }] });
  await work(env, "/notes", { method: "POST", body: { body: "가상 거래 메모", customerId: customer.id, dealId: deal.id } });
  const view = await work(env, `/deals/${deal.id}`);
  assert.equal(view.status, 200);
  assert.deepEqual(Object.keys(view.json.data), ["deal", "parties", "events", "notes", "files"]);
  assert.equal(view.json.data.notes.length, 1);
  assert.deepEqual(view.json.data.events, []);
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "deal.view", target_type: "deal", target_id: deal.id, outcome: "ok", reason: null });
  const before = audit(database).length;
  assert.equal((await work(env, "/deals/00000000-0000-4000-8000-999999999999")).status, 404);
  assert.equal((await work(env, "/deals/not-a-uuid")).status, 404);
  assert.equal(audit(database).length, before);
});

test("거래 고치기: version이 맞을 때만, 완료·취소면 닫은 날·정리 안내 기준일, 종류를 바꾸면 딸린 칸을 맞추고, 참여자는 통째로 바꾼다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const a = await makeCustomer(env, "가상 손님 A");
  const b = await makeCustomer(env, "가상 손님 B");
  const { deal } = await makeDeal(env, { priceWon: 300_000_000, parties: [{ customerId: a.id, role: "buyer" }] });
  const patch = (body, now = NOW + 1000) => work(env, `/deals/${deal.id}`, { method: "PATCH", body, now });

  const closed = await patch({ version: 1, status: "completed", regulation: "adjusted", parties: [{ customerId: b.id, role: "seller" }] });
  assert.equal(closed.status, 200, JSON.stringify(closed.json));
  assert.equal(closed.json.data.deal.version, 2);
  assert.equal(closed.json.data.deal.closedOn, "2026-11-17");
  assert.equal(closed.json.data.deal.retentionUntil, "2027-11-17");
  assert.deepEqual(closed.json.data.parties.map((party) => [party.customerId, party.role]), [[b.id, "seller"]]);
  assert.equal(rows(database, "SELECT regulated_area FROM deals")[0].regulated_area, 1);

  const later = Date.parse("2026-12-01T03:00:00.000Z");
  const cancelled = await patch({ version: 2, status: "cancelled" }, later);
  assert.equal(cancelled.json.data.deal.closedOn, "2026-11-17", "이미 닫힌 거래는 처음 닫은 날 유지");
  const reopened = await patch({ version: 3, status: "open" }, later);
  assert.equal(reopened.json.data.deal.closedOn, null);
  assert.equal(reopened.json.data.deal.retentionUntil, null);

  const wrongType = await patch({ version: 4, dealType: "jeonse" });
  assert.equal(wrongType.status, 400, "매매가가 남아 있으면 전세로 못 바꿈");
  assert.deepEqual(wrongType.json.error.details, ["priceWon"]);
  const toJeonse = await patch({ version: 4, dealType: "jeonse", priceWon: null, depositWon: 150_000_000 });
  assert.equal(toJeonse.status, 200, JSON.stringify(toJeonse.json));
  assert.equal(toJeonse.json.data.deal.saleKind, null, "매매가 아니면 세부 종류를 지움");
  const toOfficetel = await patch({ version: 5, propertyKind: "officetel" });
  assert.deepEqual(toOfficetel.json.error.details, ["scheduleTarget"], "오피스텔로 바꾸면 일정 판정을 골라야 함");
  const officetel = await patch({ version: 5, propertyKind: "officetel", scheduleTarget: "other" });
  assert.equal(officetel.json.data.deal.scheduleTarget, "other");
  const backToHousing = await patch({ version: 6, propertyKind: "housing" });
  assert.equal(backToHousing.json.data.deal.scheduleTarget, null);

  const auditCount = audit(database).length;
  const conflict = await patch({ version: 1, title: "가상 늦은 수정" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "VERSION_CONFLICT");
  assert.equal(audit(database).length, auditCount, "409는 감사 없음");
  assert.equal((await work(env, "/deals/00000000-0000-4000-8000-999999999999", { method: "PATCH", body: { version: 1, title: "x" } })).status, 404);
  assert.equal((await patch({ version: 7 })).status, 400, "바꿀 칸 없음");
});

test("거래 지우기: 제목을 다시 입력해야 하고, 일정·참여자·손님 없는 메모는 지우며 손님 메모는 거래 연결만 끊어 남긴다. 파일 행이 있으면 409", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, "가상 손님");
  const { deal } = await makeDeal(env, { title: "가상 지울 거래", parties: [{ customerId: customer.id, role: "buyer" }] });
  const kept = await work(env, "/notes", { method: "POST", body: { body: "가상 손님 거래 메모", customerId: customer.id, dealId: deal.id } });
  await work(env, "/notes", { method: "POST", body: { body: "가상 거래만 메모", dealId: deal.id } });
  database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, created_at, updated_at) VALUES ('e-1', ?, 'contract', '2026-12-01', '가상 계약', ?, ?)").run(deal.id, at, at);

  const mismatch = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상" } });
  assert.equal(mismatch.json.error.code, "CONFIRMATION_MISMATCH");
  database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, deal_id, created_at) VALUES ('f-1', 'work/other/2026/11/f-1.png', 'other', 'image/png', 10, ?, ?, ?)").run("a".repeat(64), deal.id, at);
  assert.equal((await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } })).json.error.code, "FILES_REQUIRE_STORAGE");
  database.exec("DELETE FROM files");

  const deleted = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 지울 거래" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: { deals: 1, events: 1, notes: 1, files: 0 }, kept: { notes: 1 } });
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM deal_parties")[0].n, 0);
  assert.deepEqual(rows(database, "SELECT id, customer_id, deal_id FROM notes"), [{ id: kept.json.data.note.id, customer_id: customer.id, deal_id: null }]);
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "deal.delete", target_type: "deal", target_id: deal.id, outcome: "ok", reason: "notes_kept=1" });
});

test("메모의 손님·거래 연결: 둘 다 주면 그 손님이 그 거래 참여자여야 한다(만들기·고치기)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const member = await makeCustomer(env, "가상 참여 손님");
  const outsider = await makeCustomer(env, "가상 다른 손님");
  const { deal } = await makeDeal(env, { parties: [{ customerId: member.id, role: "buyer" }] });
  const refused = await work(env, "/notes", { method: "POST", body: { body: "가상", customerId: outsider.id, dealId: deal.id } });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.json.error.details, ["dealId"]);
  assert.equal((await work(env, "/notes", { method: "POST", body: { body: "가상", customerId: member.id, dealId: deal.id } })).status, 201);
  const outsiderNote = (await work(env, "/notes", { method: "POST", body: { body: "가상", customerId: outsider.id } })).json.data.note;
  const relink = await work(env, `/notes/${outsiderNote.id}`, { method: "PATCH", body: { version: 1, dealId: deal.id } });
  assert.equal(relink.status, 400, "지금 손님(outsider) + 새 거래 = 참여자 아님");
  assert.deepEqual(relink.json.error.details, ["dealId"]);
  const moved = await work(env, `/notes/${outsiderNote.id}`, { method: "PATCH", body: { version: 1, customerId: member.id, dealId: deal.id } });
  assert.equal(moved.status, 200, JSON.stringify(moved.json));
});

test("동시 작업 ①: 손님 X를 지우는 사이 다른 관리자가 X 단독 거래에 손님 Y를 더하면, 그 거래는 남고 X 메모는 손님 연결만 끊긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const x = await makeCustomer(env, "가상 손님 X");
  const y = await makeCustomer(env, "가상 손님 Y");
  const { deal } = await makeDeal(env, { parties: [{ customerId: x.id, role: "buyer" }] });
  await work(env, "/notes", { method: "POST", body: { body: "가상 X 거래 메모", customerId: x.id, dealId: deal.id } });
  db.beforeNextBatch = () => database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES (?, ?, 'seller')").run(deal.id, y.id);
  const deleted = await work(env, `/customers/${x.id}`, { method: "DELETE", body: { confirmName: "가상 손님 X" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: { customers: 1, deals: 0, notes: 0, files: 0 }, kept: { notes: 1 } }, "개수는 batch 결과로 셈");
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 1, "Y가 들어온 거래는 남음");
  assert.deepEqual(rows(database, "SELECT customer_id, role FROM deal_parties"), [{ customer_id: y.id, role: "seller" }]);
  assert.deepEqual(rows(database, "SELECT customer_id, deal_id FROM notes"), [{ customer_id: null, deal_id: deal.id }]);
  assert.equal(audit(database).at(-1).reason, "notes_kept=1", "감사의 남긴 메모 수도 batch 안에서 셈");
});

test("동시 작업 ②: 손님을 지우는 사이 파일 행이 생기면 batch 전체가 되돌려져 아무것도 지우지 않고 409", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const x = await makeCustomer(env, "가상 손님 X");
  const { deal } = await makeDeal(env, { parties: [{ customerId: x.id, role: "buyer" }] });
  await work(env, "/notes", { method: "POST", body: { body: "가상 메모", customerId: x.id } });
  const auditCount = audit(database).length;
  db.beforeNextBatch = () => database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, deal_id, created_at) VALUES ('f-1', 'work/other/2026/11/f-1.png', 'other', 'image/png', 10, ?, ?, ?)").run("a".repeat(64), deal.id, at);
  const result = await work(env, `/customers/${x.id}`, { method: "DELETE", body: { confirmName: "가상 손님 X" } });
  assert.equal(result.status, 409);
  assert.equal(result.json.error.code, "FILES_REQUIRE_STORAGE");
  assert.equal(rows(database, "SELECT count(*) AS n FROM customers")[0].n, 1);
  assert.equal(rows(database, "SELECT count(*) AS n FROM notes")[0].n, 1);
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 1);
  assert.equal(audit(database).length, auditCount, "감사 기록도 되돌려짐");
});

test("동시 작업 ③: 같은 version으로 거래를 고치는 사이 다른 관리자가 먼저 고치면 409이고 참여자·감사는 그대로", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const a = await makeCustomer(env, "가상 손님 A");
  const b = await makeCustomer(env, "가상 손님 B");
  const { deal } = await makeDeal(env, { parties: [{ customerId: a.id, role: "buyer" }] });
  const auditCount = audit(database).length;
  db.beforeNextBatch = () => database.prepare("UPDATE deals SET title = '가상 먼저 고침', version = version + 1 WHERE id = ?").run(deal.id);
  const result = await work(env, `/deals/${deal.id}`, { method: "PATCH", body: { version: 1, title: "가상 늦게 고침", parties: [{ customerId: b.id, role: "seller" }] } });
  assert.equal(result.status, 409);
  assert.equal(rows(database, "SELECT title FROM deals")[0].title, "가상 먼저 고침");
  assert.deepEqual(rows(database, "SELECT customer_id FROM deal_parties"), [{ customer_id: a.id }], "참여자 안 바뀜");
  assert.equal(audit(database).length, auditCount);
});

test("동시 작업 ④: 메모를 쓰는 사이 그 손님이 거래 참여자에서 빠지면 메모가 생기지 않고 마지막 연락일·감사도 그대로(409)", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, "가상 손님");
  const { deal } = await makeDeal(env, { parties: [{ customerId: customer.id, role: "buyer" }] });
  database.exec("UPDATE customers SET last_contact_on = '2026-01-01'");
  const auditCount = audit(database).length;
  db.beforeNextBatch = () => database.prepare("DELETE FROM deal_parties WHERE deal_id = ?").run(deal.id);
  const result = await work(env, "/notes", { method: "POST", body: { body: "가상 메모", customerId: customer.id, dealId: deal.id } });
  assert.equal(result.status, 409);
  assert.equal(rows(database, "SELECT count(*) AS n FROM notes")[0].n, 0);
  assert.equal(rows(database, "SELECT last_contact_on FROM customers")[0].last_contact_on, "2026-01-01");
  assert.equal(audit(database).length, auditCount);
});

test("동시 작업 ⑤·⑥: 거래를 지우는 사이 제목이 바뀌면 되돌리고 400, 거래를 만드는 사이 참여자 손님이 지워지면 되돌리고 400", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, "가상 손님");
  const { deal } = await makeDeal(env, { title: "가상 거래 제목" });
  db.beforeNextBatch = () => database.prepare("UPDATE deals SET title = '가상 바뀐 제목' WHERE id = ?").run(deal.id);
  const removed = await work(env, `/deals/${deal.id}`, { method: "DELETE", body: { confirmTitle: "가상 거래 제목" } });
  assert.equal(removed.status, 400);
  assert.equal(removed.json.error.code, "CONFIRMATION_MISMATCH");
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 1);

  db.beforeNextBatch = () => database.prepare("DELETE FROM customers WHERE id = ?").run(customer.id);
  const created = await work(env, "/deals", { method: "POST", body: { title: "가상 새 거래", dealType: "sale", propertyKind: "housing", parties: [{ customerId: customer.id, role: "buyer" }] } });
  assert.equal(created.status, 400);
  assert.deepEqual(created.json.error.details, ["parties"]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM deals")[0].n, 1, "새 거래 안 생김");
});

test("거래 경로는 정해진 방식만 받고, 일정 경로(/deals/:id/events)는 아직 없다(PR-B2)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const list = await work(env, "/deals");
  assert.equal(list.status, 405);
  assert.equal(list.response.headers.get("Allow"), "POST");
  const { deal } = await makeDeal(env, {});
  const put = await work(env, `/deals/${deal.id}`, { method: "PUT", body: {} });
  assert.equal(put.status, 405);
  assert.equal(put.response.headers.get("Allow"), "GET, PATCH, DELETE");
  assert.equal((await work(env, `/deals/${deal.id}/events`)).status, 404);
});
