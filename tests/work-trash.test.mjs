// 휴지통 7일(0007, 기획서 WT-2-13, 설계서 8.7절) 시험. 실제 SQLite(node:sqlite)에 0001 ~ 0007을 적용하고 가짜 자료만 쓴다.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { runRealpriceCron } from "../worker/work-scheduled.mjs";
import { TRASH_COLUMNS, trashDaysLeft } from "../worker/work-trash.mjs";
import { NOW, OWNER, allMigrationSql, createD1, createR2, expectedTrash, freshDb, migrationFiles, nextUuid, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const AT = iso(NOW - DAY);
const A = "11111111-1111-4111-8111-00000000000a";
const B = "11111111-1111-4111-8111-00000000000b";
const SOLO = "22222222-2222-4222-8222-000000000001"; // A만 참여(손님 A를 지우면 함께 지워짐)
const SHARED = "22222222-2222-4222-8222-000000000002"; // A·B 함께
const BONLY = "22222222-2222-4222-8222-000000000003"; // B만
// 일정 3333…·메모 4444…·할 일 5555…·장부 줄 6666…(업무 API 경로가 UUID만 받음). 끝 번호: 일정 1 단독·2 함께, 메모 1 손님 A·2 단독 거래·3 함께 거래·4 A가 쓴 함께 거래·5 B가 단독 거래에 건 것,
// 할 일 1 단독 거래·2 거래 없음, 장부 줄 1 단독 거래(이름 없음)·2 함께 거래·3 거래 없음.
const TABLES = ["customers", "deals", "files", "deal_parties", "deal_events", "notes", "tasks", "ledger_entries"];
const ORDER = { deal_parties: "deal_id, customer_id, role" };

// 손님 A·B, 거래 3개, 참여자 4줄, 일정 2개, 메모 5개, 할 일 2개, 장부 줄 3개.
function seed(database) {
  const run = (sql, ...values) => database.prepare(sql).run(...values);
  run("INSERT INTO customers (id, display_name, phone_digits, needs, status, created_at, updated_at) VALUES (?, '가상 손님 A', '01000000001', '가상 조건 A', 'consulting', ?, ?)", A, AT, AT);
  run("INSERT INTO customers (id, display_name, phone_digits, needs, status, created_at, updated_at) VALUES (?, '가상 손님 B', NULL, '', 'on_hold', ?, ?)", B, AT, AT);
  run("INSERT INTO deals (id, title, deal_type, property_kind, price_won, contract_on, balance_on, sale_kind, created_at, updated_at) VALUES (?, '가상 단독 거래', 'sale', 'housing', 300000000, '2026-12-01', '2027-01-15', 'sale', ?, ?)", SOLO, AT, AT);
  run("INSERT INTO deals (id, title, deal_type, property_kind, deposit_won, contract_on, created_at, updated_at) VALUES (?, '가상 함께 거래', 'jeonse', 'housing', 200000000, '2026-12-10', ?, ?)", SHARED, AT, AT);
  run("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES (?, '가상 B 거래', 'sale', 'land', ?, ?)", BONLY, AT, AT);
  run("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES (?, ?, 'buyer'), (?, ?, 'tenant'), (?, ?, 'landlord'), (?, ?, 'seller')", SOLO, A, SHARED, A, SHARED, B, BONLY, B);
  run("INSERT INTO deal_events (id, deal_id, kind, due_on, title, alarm_offsets, created_at, updated_at) VALUES ('33333333-3333-4333-8333-000000000001', ?, 'contract', '2026-12-01', '가상 단독 계약', '[\"-PT6H\"]', ?, ?), ('33333333-3333-4333-8333-000000000002', ?, 'contract', '2026-12-10', '가상 함께 계약', '[]', ?, ?)", SOLO, AT, AT, SHARED, AT, AT);
  run("INSERT INTO notes (id, customer_id, deal_id, body, created_at, updated_at) VALUES ('44444444-4444-4444-8444-000000000001', ?, NULL, '가상 손님 메모', ?, ?), ('44444444-4444-4444-8444-000000000002', NULL, ?, '가상 단독 거래 메모', ?, ?), ('44444444-4444-4444-8444-000000000003', NULL, ?, '가상 함께 거래 메모', ?, ?), ('44444444-4444-4444-8444-000000000004', ?, ?, '가상 A가 쓴 함께 거래 메모', ?, ?), ('44444444-4444-4444-8444-000000000005', ?, ?, '가상 B가 단독 거래에 건 메모', ?, ?)",
    A, AT, AT, SOLO, AT, AT, SHARED, AT, AT, A, SHARED, AT, AT, B, SOLO, AT, AT);
  run("INSERT INTO tasks (id, title, deal_id, due_on, repeat_rule, repeat_day, created_at, updated_at) VALUES ('55555555-5555-4555-8555-000000000001', '가상 단독 할 일', ?, '2026-12-05', 'monthly', 5, ?, ?), ('55555555-5555-4555-8555-000000000002', '가상 할 일', NULL, NULL, 'none', NULL, ?, ?)", SOLO, AT, AT, AT, AT);
  run("INSERT INTO ledger_entries (id, kind, deal_id, payer_role, label, amount_won, vat_won, received_won, memo, created_at, updated_at) VALUES ('66666666-6666-4666-8666-000000000001', 'fee', ?, 'buyer', '', 1000000, 100000, 0, '가상 장부 메모', ?, ?), ('66666666-6666-4666-8666-000000000002', 'fee', ?, 'tenant', '가상 함께 보수', 500000, 0, 500000, '', ?, ?)", SOLO, AT, AT, SHARED, AT, AT);
  run("INSERT INTO ledger_entries (id, kind, deal_id, label, entry_on, amount_won, created_at, updated_at) VALUES ('66666666-6666-4666-8666-000000000003', 'expense', NULL, '', '2026-11-02', 30000, ?, ?)", AT, AT);
}

function seeded() {
  const fresh = freshDb();
  seed(fresh.database);
  return { ...fresh, env: workEnv(fresh.db) };
}

const snapshot = (database) => Object.fromEntries(TABLES.map((table) => [table, rows(database, `SELECT * FROM ${table} ORDER BY ${ORDER[table] ?? "id"}`)]));
const counts = (database) => Object.fromEntries(TABLES.map((table) => [table, rows(database, `SELECT count(*) AS n FROM ${table}`)[0].n]));
const trashCount = (database) => ({ batches: rows(database, "SELECT count(*) AS n FROM trash_batches")[0].n, rows: rows(database, "SELECT count(*) AS n FROM trash_rows")[0].n });
const audit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, request_id, outcome, reason FROM audit_events ORDER BY seq");
// 장부 줄은 끊고(+1) 다시 붙이면(+1) version·updated_at만 달라진다. 그 둘을 뺀 나머지를 비교한다.
const withoutLedgerVersion = (snap) => ({ ...snap, ledger_entries: snap.ledger_entries.map(({ version, updated_at, ...rest }) => rest) });

const deleteCustomerA = (env, options = {}) => work(env, `/customers/${A}`, { method: "DELETE", body: { confirmName: "가상 손님 A" }, ...options });
const deleteShared = (env, options = {}) => work(env, `/deals/${SHARED}`, { method: "DELETE", body: { confirmTitle: "가상 함께 거래" }, ...options });
const restore = (env, batchId, options = {}) => work(env, `/trash/${batchId}/restore`, { method: "POST", body: {}, ...options });
const list = async (env, query = "", options = {}) => work(env, `/trash${query}`, options);

test("0007은 0001 ~ 0006 위에 trash_batches·trash_rows 두 표와 색인 2개만 더하고 구조 번호를 7로 올리며, CHECK가 모르는 종류·표·연결·깨진 JSON·빈 이름을 막는다", () => {
  assert.equal(migrationFiles[6], "0007_trash.sql");
  assert.equal(migrationFiles.length, 8, "그 뒤는 0008(대전 5개 구)만");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 6)) database.exec(sql);
  const tables = () => rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  const before = tables();
  database.exec(allMigrationSql[6]);
  assert.deepEqual(tables().filter((name) => !before.includes(name)), ["trash_batches", "trash_rows"]);
  assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "7");
  assert.deepEqual(rows(database, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'trash_%' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name),
    ["idx_trash_batches_deleted", "idx_trash_batches_purge"]);
  const batch = database.prepare("INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after) VALUES (?, ?, 't', ?, 7, ?, ?, 'r', ?)");
  batch.run("b-ok", "file", "가상", AT, OWNER, AT);
  for (const [name, values] of [["모르는 종류", ["b-1", "folder", "가상", AT, OWNER, AT]], ["빈 이름", ["b-2", "note", "", AT, OWNER, AT]], ["81자 이름", ["b-3", "note", "가".repeat(81), AT, OWNER, AT]], ["빈 작업자", ["b-4", "note", "가상", AT, "", AT]]]) {
    assert.throws(() => batch.run(...values), /CHECK constraint failed/u, name);
  }
  const row = database.prepare("INSERT INTO trash_rows (batch_id, table_name, op, row_id, row_json) VALUES (?, ?, ?, ?, ?)");
  row.run("b-ok", "files", "row", "f-1", "{}");
  for (const [name, values, pattern] of [
    ["모르는 표", ["b-ok", "settings", "row", "x", "{}"], /CHECK/u],
    ["모르는 연결", ["b-ok", "notes", "note_file", "x", "{}"], /CHECK/u],
    ["깨진 JSON", ["b-ok", "notes", "row", "x", "{"], /CHECK/u],
    ["같은 기본 키", ["b-ok", "files", "row", "f-1", "{}"], /UNIQUE/u],
    ["없는 묶음", ["b-none", "notes", "row", "x", "{}"], /FOREIGN KEY/u],
  ]) {
    assert.throws(() => row.run(...values), pattern, name);
  }
});

test("T2-92c 휴지통 칸 목록(TRASH_COLUMNS)은 지금 구조의 PRAGMA table_info와 같다(새 마이그레이션이 칸을 보태면 깨져 함께 고치게 함)", () => {
  const { database } = freshDb();
  for (const [table, columns] of Object.entries(TRASH_COLUMNS)) {
    assert.deepEqual(rows(database, `PRAGMA table_info(${table})`).map((column) => column.name), [...columns], table);
  }
  assert.deepEqual(Object.keys(TRASH_COLUMNS).sort(), [...TABLES].sort());
});

test("T2-83·T2-92f 손님 삭제 → 휴지통 목록 1줄(남은 날 7·함께 든 것 수·되살리기 가능), 응답 deleted·kept는 휴지통 전과 같고 원래 표 어디에도 A가 없음", async () => {
  const { database, env } = seeded();
  const deleted = await deleteCustomerA(env);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, {
    deleted: { customers: 1, deals: 1, notes: 2, files: 0, tasks: 1 },
    kept: { notes: 2, ledger: 1 },
    trash: expectedTrash(deleted.json.data),
  });
  for (const [table, column] of [["customers", "id"], ["deal_parties", "customer_id"], ["notes", "customer_id"]]) {
    assert.equal(rows(database, `SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`, A)[0].n, 0, table);
  }
  const listed = await list(env);
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.data, {
    items: [{
      batchId: deleted.json.data.trash.batchId,
      kind: "customer",
      label: "가상 손님 A",
      deletedAt: iso(NOW),
      purgeAfter: iso(NOW + 7 * DAY),
      daysLeft: 7,
      restorable: true,
      counts: { customers: 1, deals: 1, files: 0, parties: 2, events: 1, notes: 2, tasks: 1, ledger: 0, links: 3 },
    }],
    nextCursor: null,
  });
  const batchRow = rows(database, "SELECT kind, target_id, schema_version, deleted_by, request_id FROM trash_batches")[0];
  assert.deepEqual([batchRow.kind, batchRow.target_id, batchRow.schema_version, batchRow.deleted_by], ["customer", A, 8, OWNER]);
  const deleteAudit = audit(database).find((entry) => entry.action === "customer.delete");
  assert.equal(deleteAudit.request_id, batchRow.request_id, "묶음과 감사 기록이 같은 요청 번호");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "trash.list", target_type: null, target_id: null, request_id: listed.json.requestId, outcome: "ok", reason: "result_count=1" });
  const auditText = JSON.stringify(audit(database));
  assert.ok(!auditText.includes("가상"), "감사 기록에 이름·제목·메모 내용이 없음");
});

test("T2-92b 손님·거래 삭제에서 원래 표마다 사라진 행 수 = 휴지통 'row' 행 수(0001 ON DELETE CASCADE로 휴지통을 거치지 않고 사라지는 행이 없음)", async () => {
  const check = (database, before, name) => {
    const after = counts(database);
    const trashed = Object.fromEntries(TABLES.map((table) => [table, rows(database, "SELECT count(*) AS n FROM trash_rows WHERE op = 'row' AND table_name = ?", table)[0].n]));
    assert.deepEqual(Object.fromEntries(TABLES.map((table) => [table, before[table] - after[table]])), trashed, name);
    return trashed;
  };
  const customerCase = seeded();
  // 사진(F-a): 손님 A의 사진 2장, B의 사진 1장. files.customer_id는 ON DELETE SET NULL이라 휴지통 문장이 빠지면 행이 남거나 주인 없이 남는다.
  for (const [id, owner] of [["77777777-7777-4777-8777-000000000001", A], ["77777777-7777-4777-8777-000000000002", A], ["77777777-7777-4777-8777-000000000003", B]]) {
    customerCase.database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, created_at) VALUES (?, ?, 'property_photo', 'image/jpeg', 10, ?, ?, ?)")
      .run(id, `work/property_photo/2026/11/${id}.jpg`, "a".repeat(64), owner, AT);
  }
  const filesEnv = { ...customerCase.env, WORK_FILES_ENABLED: "true", WORK_FILES: createR2() };
  const beforeCustomer = counts(customerCase.database);
  const customerDeleted = await deleteCustomerA(filesEnv);
  assert.equal(customerDeleted.status, 200, JSON.stringify(customerDeleted.json));
  assert.equal(customerDeleted.json.data.deleted.files, 2);
  assert.deepEqual(check(customerCase.database, beforeCustomer, "손님 삭제"), { customers: 1, deals: 1, files: 2, deal_parties: 2, deal_events: 1, notes: 2, tasks: 1, ledger_entries: 0 },
    "단독 거래의 참여자 줄(연쇄 삭제)과 이 손님의 함께 거래 참여자 줄, 손님 사진이 모두 옮겨짐");
  assert.equal(rows(customerCase.database, "SELECT count(*) AS n FROM files WHERE customer_id IS NULL AND deal_id IS NULL")[0].n, 0, "주인 없는 사진 0(T2-137d)");
  assert.deepEqual(filesEnv.WORK_FILES.calls, [], "손님 삭제는 R2를 부르지 않음");

  const dealCase = seeded();
  const beforeDeal = counts(dealCase.database);
  assert.equal((await deleteShared(dealCase.env)).status, 200);
  assert.deepEqual(check(dealCase.database, beforeDeal, "거래 삭제"), { customers: 0, deals: 1, files: 0, deal_parties: 2, deal_events: 1, notes: 1, tasks: 0, ledger_entries: 0 });
  assert.deepEqual(rows(dealCase.database, "SELECT table_name, op, row_id FROM trash_rows WHERE op <> 'row' ORDER BY row_id"), [
    { table_name: "notes", op: "note_deal", row_id: "44444444-4444-4444-8444-000000000004" },
    { table_name: "ledger_entries", op: "ledger_deal", row_id: "66666666-6666-4666-8666-000000000002" },
  ]);
});

test("T2-84 손님 삭제 뒤 되살리기: 지우기 전 상태와 칸마다 같고(연결·장부 날짜·이름 포함) 휴지통 묶음은 남지 않음", async () => {
  const { database, env } = seeded();
  const before = snapshot(database);
  const deleted = await deleteCustomerA(env);
  const ledgerDetached = rows(database, "SELECT deal_id, snap_contract_on, snap_balance_on, label, version FROM ledger_entries WHERE id = '66666666-6666-4666-8666-000000000001'")[0];
  assert.deepEqual(ledgerDetached, { deal_id: null, snap_contract_on: "2026-12-01", snap_balance_on: "2027-01-15", label: "가상 단독 거래", version: 2 }, "끊을 때 거래 날짜·제목이 옮겨짐");
  const restored = await restore(env, deleted.json.data.trash.batchId, { now: NOW + 60_000 });
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual(restored.json.data, {
    restored: { customers: 1, deals: 1, files: 0, parties: 2, events: 1, notes: 2, tasks: 1, ledger: 0, links: 3, notesUnlinked: 0 },
    skipped: [],
    remaining: 0,
  });
  const after = snapshot(database);
  assert.deepEqual(withoutLedgerVersion(after), withoutLedgerVersion(before));
  const ledger = rows(database, "SELECT deal_id, snap_contract_on, snap_balance_on, label, version, updated_at FROM ledger_entries WHERE id = '66666666-6666-4666-8666-000000000001'")[0];
  assert.deepEqual(ledger, { deal_id: SOLO, snap_contract_on: null, snap_balance_on: null, label: "", version: 3, updated_at: iso(NOW + 60_000) }, "장부 줄은 끊기 전 값으로, version은 +1 더");
  assert.deepEqual(after.ledger_entries.filter((entry) => entry.id !== "66666666-6666-4666-8666-000000000001"), before.ledger_entries.filter((entry) => entry.id !== "66666666-6666-4666-8666-000000000001"));
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "trash.restore", target_type: "trash", target_id: deleted.json.data.trash.batchId, request_id: restored.json.requestId, outcome: "ok", reason: "skipped=0" });
  assert.deepEqual((await list(env)).json.data.items, []);
  assert.equal((await restore(env, deleted.json.data.trash.batchId)).json.error.code, "NOT_FOUND", "다 되살린 묶음은 없음");
});

test("T2-84 거래 삭제 뒤 되살리기도 지우기 전 상태와 같음", async () => {
  const { database, env } = seeded();
  const before = snapshot(database);
  const deleted = await deleteShared(env);
  assert.deepEqual(deleted.json.data, { deleted: { deals: 1, events: 1, notes: 1, files: 0, tasks: 0 }, kept: { notes: 1, ledger: 1 }, trash: expectedTrash(deleted.json.data) });
  const restored = await restore(env, deleted.json.data.trash.batchId);
  assert.deepEqual(restored.json.data.restored, { customers: 0, deals: 1, files: 0, parties: 2, events: 1, notes: 1, tasks: 0, ledger: 0, links: 2, notesUnlinked: 0 });
  assert.deepEqual(withoutLedgerVersion(snapshot(database)), withoutLedgerVersion(before));
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
});

test("T2-85 그사이 다시 붙인 메모(relinked)와 그사이 고친 장부 줄(changed)은 건너뛰고 휴지통에서 지우며, 지금 값을 덮어쓰지 않음", async () => {
  const { database, env } = seeded();
  const deleted = await deleteCustomerA(env);
  // 지운 뒤: 44444444-4444-4444-8444-000000000004를 B에게 붙이고, 끊긴 장부 줄 66666666-6666-4666-8666-000000000001에 날짜를 넣어 고친다.
  database.prepare("UPDATE notes SET customer_id = ? WHERE id = '44444444-4444-4444-8444-000000000004'").run(B);
  database.prepare("UPDATE ledger_entries SET entry_on = '2026-11-30', version = version + 1 WHERE id = '66666666-6666-4666-8666-000000000001'").run();
  const restored = await restore(env, deleted.json.data.trash.batchId);
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual(restored.json.data.skipped, [{ table: "noteCustomer", reason: "relinked", count: 1 }, { table: "ledgerDeal", reason: "changed", count: 1 }]);
  assert.deepEqual([restored.json.data.restored.links, restored.json.data.remaining], [1, 0]);
  assert.deepEqual(rows(database, "SELECT customer_id, deal_id FROM notes WHERE id = '44444444-4444-4444-8444-000000000004'")[0], { customer_id: B, deal_id: SHARED });
  assert.deepEqual(rows(database, "SELECT deal_id, entry_on, version FROM ledger_entries WHERE id = '66666666-6666-4666-8666-000000000001'")[0], { deal_id: null, entry_on: "2026-11-30", version: 3 });
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
  assert.equal(audit(database).at(-1).reason, "skipped=2");
});

test("T2-86 거래(D)를 먼저 지우고 손님(A)을 지운 뒤 D부터 되살리면 없는 손님·메모 몫만 남고 counts가 줄며, A → D 다시 순으로 원래대로 돌아옴. 거꾸로(A → D)도 같은 결과", async () => {
  const forward = seeded();
  const before = snapshot(forward.database);
  const dealBatch = (await deleteShared(forward.env)).json.data.trash.batchId;
  const customerBatch = (await deleteCustomerA(forward.env, { now: NOW + 1000 })).json.data.trash.batchId;
  const listedBefore = (await list(forward.env)).json.data.items;
  assert.deepEqual(listedBefore.map((item) => [item.batchId, item.kind]), [[customerBatch, "customer"], [dealBatch, "deal"]], "최근 지운 것이 위");
  assert.deepEqual(listedBefore[1].counts, { customers: 0, deals: 1, files: 0, parties: 2, events: 1, notes: 1, tasks: 0, ledger: 0, links: 2 });

  const first = await restore(forward.env, dealBatch);
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.deepEqual(first.json.data.skipped, [{ table: "parties", reason: "customer_missing", count: 1 }, { table: "noteDeal", reason: "note_missing", count: 1 }]);
  assert.deepEqual([first.json.data.restored.parties, first.json.data.restored.links, first.json.data.remaining], [1, 1, 2]);
  const partial = (await list(forward.env)).json.data.items.find((item) => item.batchId === dealBatch);
  assert.deepEqual(partial.counts, { customers: 0, deals: 0, files: 0, parties: 1, events: 0, notes: 0, tasks: 0, ledger: 0, links: 1 }, "일부 되살린 뒤 counts는 남은 행만");
  assert.equal(rows(forward.database, "SELECT count(*) AS n FROM trash_rows WHERE row_json LIKE '%_skip%'")[0].n, 0, "건너뜀 표시는 batch 밖에 남지 않음");

  assert.deepEqual((await restore(forward.env, customerBatch)).json.data.remaining, 0);
  const again = await restore(forward.env, dealBatch);
  assert.deepEqual([again.json.data.restored.parties, again.json.data.restored.links, again.json.data.skipped, again.json.data.remaining], [1, 1, [], 0]);
  assert.deepEqual(withoutLedgerVersion(snapshot(forward.database)), withoutLedgerVersion(before));
  assert.deepEqual(trashCount(forward.database), { batches: 0, rows: 0 });

  const backward = seeded();
  const dealBatch2 = (await deleteShared(backward.env)).json.data.trash.batchId;
  const customerBatch2 = (await deleteCustomerA(backward.env, { now: NOW + 1000 })).json.data.trash.batchId;
  assert.deepEqual((await restore(backward.env, customerBatch2)).json.data.remaining, 0);
  const second = await restore(backward.env, dealBatch2);
  assert.deepEqual([second.json.data.skipped, second.json.data.remaining], [[], 0]);
  assert.deepEqual(withoutLedgerVersion(snapshot(backward.database)), withoutLedgerVersion(before));
  assert.deepEqual(trashCount(backward.database), { batches: 0, rows: 0 });
});

test("T2-92d 한 건 삭제(메모·일정·장부 줄·할 일)는 묶음 1개·행 1개, 이름은 메모 앞 40자·장부 이름 없으면 금액, 되살리면 그대로", async () => {
  const { database, env } = seeded();
  database.prepare("UPDATE notes SET body = ? WHERE id = '44444444-4444-4444-8444-000000000001'").run(`첫 줄\r\n둘째\t줄 ${"가".repeat(60)}`);
  const before = snapshot(database);
  const results = [];
  for (const [path, body] of [["/notes/44444444-4444-4444-8444-000000000001", undefined], ["/events/33333333-3333-4333-8333-000000000002", {}], ["/ledger/66666666-6666-4666-8666-000000000003", undefined], ["/tasks/55555555-5555-4555-8555-000000000002", undefined]]) {
    const removed = await work(env, path, { method: "DELETE", body, now: NOW + results.length * 1000 });
    assert.deepEqual([removed.status, removed.json.data], [200, { deleted: true, trash: expectedTrash(removed.json.data, NOW + results.length * 1000) }], path);
    results.push(removed.json.data.trash.batchId);
  }
  const items = (await list(env)).json.data.items;
  assert.deepEqual(items.map((item) => [item.kind, item.label]), [
    ["task", "가상 할 일"],
    ["ledger", "장부 줄 30000원"],
    ["event", "가상 함께 계약"],
    ["note", `첫 줄  둘째 줄 ${"가".repeat(30)}`],
  ]);
  assert.deepEqual(trashCount(database), { batches: 4, rows: 4 });
  for (const batchId of results) {
    const restored = await restore(env, batchId);
    assert.deepEqual([restored.status, restored.json.data.remaining, restored.json.data.skipped], [200, 0, []]);
  }
  assert.deepEqual(snapshot(database), before);
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
});

test("T2-92d 할 일·장부 줄을 지운 뒤 그 거래가 지워졌으면 거래 연결 없이 되살리고, 장부 줄은 지울 때 거래 날짜·제목으로 채우며, 일정은 거래 없음으로 남김", async () => {
  const { database, env } = seeded();
  const task = (await work(env, "/tasks/55555555-5555-4555-8555-000000000001", { method: "DELETE" })).json.data.trash.batchId;
  const entry = (await work(env, "/ledger/66666666-6666-4666-8666-000000000001", { method: "DELETE" })).json.data.trash.batchId;
  const event = (await work(env, "/events/33333333-3333-4333-8333-000000000001", { method: "DELETE", body: {} })).json.data.trash.batchId;
  assert.equal((await work(env, `/deals/${SOLO}`, { method: "DELETE", body: { confirmTitle: "가상 단독 거래" } })).status, 200);
  const taskRestored = await restore(env, task);
  assert.deepEqual([taskRestored.json.data.restored.tasks, taskRestored.json.data.remaining], [1, 0]);
  assert.deepEqual(rows(database, "SELECT deal_id, due_on, repeat_rule, repeat_day FROM tasks WHERE id = '55555555-5555-4555-8555-000000000001'")[0], { deal_id: null, due_on: "2026-12-05", repeat_rule: "monthly", repeat_day: 5 });
  const entryRestored = await restore(env, entry);
  assert.deepEqual([entryRestored.json.data.restored.ledger, entryRestored.json.data.remaining], [1, 0]);
  assert.deepEqual(rows(database, "SELECT deal_id, snap_contract_on, snap_balance_on, label, amount_won, version FROM ledger_entries WHERE id = '66666666-6666-4666-8666-000000000001'")[0],
    { deal_id: null, snap_contract_on: "2026-12-01", snap_balance_on: "2027-01-15", label: "가상 단독 거래", amount_won: 1000000, version: 1 }, "거래 삭제의 연결 끊기와 같은 값");
  const eventRestored = await restore(env, event);
  assert.deepEqual([eventRestored.json.data.restored.events, eventRestored.json.data.skipped, eventRestored.json.data.remaining], [0, [{ table: "events", reason: "deal_missing", count: 1 }], 1]);
  assert.deepEqual(trashCount(database), { batches: 2, rows: 5 }, "일정 묶음(거래 없음 1행)과 거래 묶음(거래·참여자·메모·메모 연결 4행)이 남음");
});

test("되살린 메모의 연결이 맞지 않으면(참여자가 빠짐) 맞지 않는 칸만 비우고 넣어 notesUnlinked로 셈", async () => {
  const { database, env } = seeded();
  const batchId = (await work(env, "/notes/44444444-4444-4444-8444-000000000004", { method: "DELETE" })).json.data.trash.batchId;
  database.prepare("DELETE FROM deal_parties WHERE deal_id = ? AND customer_id = ?").run(SHARED, A);
  const restored = await restore(env, batchId);
  assert.deepEqual(restored.json.data.restored, { customers: 0, deals: 0, files: 0, parties: 0, events: 0, notes: 1, tasks: 0, ledger: 0, links: 0, notesUnlinked: 1 });
  assert.deepEqual(rows(database, "SELECT customer_id, deal_id, body FROM notes WHERE id = '44444444-4444-4444-8444-000000000004'")[0], { customer_id: A, deal_id: null, body: "가상 A가 쓴 함께 거래 메모" });
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
});

test("T2-88 영구 삭제는 확인 글자 '영구 삭제'가 있어야 하고, 지우면 휴지통에서만 사라지며 감사 trash.purge를 남김", async () => {
  const { database, env } = seeded();
  const batchId = (await deleteCustomerA(env)).json.data.trash.batchId;
  for (const [name, body, code] of [["확인 없음", {}, "CONFIRMATION_MISMATCH"], ["틀린 확인", { confirm: "영구삭제" }, "CONFIRMATION_MISMATCH"], ["모르는 칸", { confirm: "영구 삭제", x: 1 }, "VALIDATION_FAILED"], ["배열", ["영구 삭제"], "VALIDATION_FAILED"]]) {
    const result = await work(env, `/trash/${batchId}`, { method: "DELETE", body });
    assert.deepEqual([result.status, result.json.error.code], [400, code], name);
  }
  assert.deepEqual(trashCount(database).batches, 1);
  const before = snapshot(database);
  const purged = await work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: " 영구 삭제 " } });
  assert.deepEqual([purged.status, purged.json.data], [200, { purged: true }]);
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
  assert.deepEqual(snapshot(database), before, "원래 표는 그대로");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "trash.purge", target_type: "trash", target_id: batchId, request_id: purged.json.requestId, outcome: "ok", reason: null });
  assert.deepEqual([(await work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: "영구 삭제" } })).json.error.code, (await restore(env, batchId)).json.error.code], ["NOT_FOUND", "NOT_FOUND"]);
});

test("T2-89 지운 뒤 구조 번호가 바뀐 묶음은 목록에 restorable false, 되살리기 409 TRASH_SCHEMA_CHANGED(아무것도 바뀌지 않음), 영구 삭제는 됨", async () => {
  const { database, env } = seeded();
  const batchId = (await deleteCustomerA(env)).json.data.trash.batchId;
  database.prepare("UPDATE trash_batches SET schema_version = 6").run();
  assert.equal((await list(env)).json.data.items[0].restorable, false);
  const before = { snap: snapshot(database), trash: trashCount(database) };
  const blocked = await restore(env, batchId);
  assert.deepEqual([blocked.status, blocked.json.error.code], [409, "TRASH_SCHEMA_CHANGED"]);
  assert.deepEqual({ snap: snapshot(database), trash: trashCount(database) }, before);
  assert.equal((await work(env, `/trash/${batchId}`, { method: "DELETE", body: { confirm: "영구 삭제" } })).status, 200);
});

test("T2-92 지우기·되살리기 batch 중간 문장이 실패하면 원래 표·휴지통·감사 기록 모두 그대로", async () => {
  const { database, db, env } = seeded();
  const before = { snap: snapshot(database), trash: trashCount(database), audit: audit(database).length };
  // 단독 거래 참여자 줄 복사(연쇄 삭제 몫)만 없는 표에 쓰게 해 batch 가운데서 실패시킨다.
  const failing = (match) => ({ ...db, prepare: (sql) => db.prepare(match(sql) ? sql.replace("INSERT INTO trash_rows", "INSERT INTO trash_rows_missing") : sql) });
  const brokenDelete = await deleteCustomerA(workEnv(failing((sql) => sql.startsWith("INSERT INTO trash_rows") && sql.includes("'deal_parties'") && sql.includes("NOT EXISTS"))));
  assert.deepEqual([brokenDelete.status, brokenDelete.json.error.code], [503, "STORAGE_UNAVAILABLE"]);
  assert.deepEqual({ snap: snapshot(database), trash: trashCount(database), audit: audit(database).length }, before);

  const batchId = (await deleteCustomerA(env)).json.data.trash.batchId;
  const afterDelete = { snap: snapshot(database), trash: trashCount(database), audit: audit(database).length };
  const failRestore = { ...db, prepare: (sql) => db.prepare(sql.includes("'trash.restore'") ? sql.replace("INSERT INTO audit_events", "INSERT INTO audit_events_missing") : sql) };
  const brokenRestore = await restore(workEnv(failRestore), batchId);
  assert.deepEqual([brokenRestore.status, brokenRestore.json.error.code], [503, "STORAGE_UNAVAILABLE"]);
  assert.deepEqual({ snap: snapshot(database), trash: trashCount(database), audit: audit(database).length }, afterDelete);
});

test("T2-92e 같은 메모를 두 화면에서 동시에 지우면 뒤 요청은 404이고 휴지통 묶음은 1개", async () => {
  const { database, db, env } = seeded();
  let inner;
  db.beforeNextBatch = async () => {
    inner = await work(env, "/notes/44444444-4444-4444-8444-000000000001", { method: "DELETE" });
  };
  const outer = await work(env, "/notes/44444444-4444-4444-8444-000000000001", { method: "DELETE" });
  assert.equal(inner.status, 200);
  assert.deepEqual([outer.status, outer.json.error.code], [404, "NOT_FOUND"]);
  assert.deepEqual(trashCount(database), { batches: 1, rows: 1 });
  assert.equal(audit(database).filter((entry) => entry.action === "note.delete").length, 1);
});

test("T2-87·T2-92a 03:00 차례 Cron은 켜기 값이 없어도 7일 지난 묶음을 지우고 묶음마다 system:cron 감사 1줄, 7일이 안 됐거나 다른 시각이면 그대로", async () => {
  const { database, db, env } = seeded();
  const batchId = (await deleteCustomerA(env)).json.data.trash.batchId;
  // 같은 03시 차례의 글 초안 정리 로그(blog_cleanup)는 보지 않는다.
  const cron = async (at, log = []) => runRealpriceCron({ WORK_DB: db }, { db, now: () => at, log: (entry) => entry.event === "trash_expire" && log.push(entry), randomUUID: nextUuid, fetcher: async () => assert.fail("외부 요청 0") });
  const kst = (text) => Date.parse(`${text}+09:00`);

  const early = [];
  assert.deepEqual(await cron(kst("2026-11-24T03:05:00"), early), { outcome: "disabled" }, "실거래가는 꺼진 그대로");
  assert.deepEqual([trashCount(database).batches, early], [1, []], "지운 지 7일이 안 됨(11-24 14:00에 7일)");
  const statementsBefore = db.stats.statements;
  await cron(kst("2026-11-25T04:00:00"));
  assert.deepEqual([trashCount(database).batches, db.stats.statements], [1, statementsBefore], "03시 차례가 아니면 D1 0");

  const log = [];
  await cron(kst("2026-11-25T03:05:00"), log);
  assert.deepEqual(trashCount(database), { batches: 0, rows: 0 });
  assert.deepEqual(log, [{ event: "trash_expire", expired: 1 }]);
  const expired = audit(database).at(-1);
  assert.deepEqual({ ...expired, request_id: expired.request_id.startsWith("cron-") }, { actor_email: "system:cron", action: "trash.expire", target_type: "trash", target_id: batchId, request_id: true, outcome: "ok", reason: null });
  assert.equal(rows(database, "SELECT count(*) AS n FROM customers WHERE id = ?", A)[0].n, 0, "되살릴 수 없게 됨");
});

function insertExpired(database, count, purgeAfter) {
  const batch = database.prepare("INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after) VALUES (?, 'task', ?, '가상 할 일', 7, ?, ?, 'r', ?)");
  const row = database.prepare("INSERT INTO trash_rows (batch_id, table_name, op, row_id, row_json) VALUES (?, 'tasks', 'row', ?, '{}')");
  database.exec("BEGIN");
  for (let index = 0; index < count; index += 1) {
    const id = `b-${String(index).padStart(5, "0")}`;
    batch.run(id, `t-${index}`, AT, OWNER, purgeAfter);
    row.run(id, `t-${index}`);
  }
  database.exec("COMMIT");
}

test("T2-87 7일 지난 묶음이 101개면 한 번의 03시 차례에 모두 지움(100개씩 2번), 1,000개를 넘으면 1,000개만 지우고 경고 로그 뒤 다음 날 이어 감", async () => {
  const at = Date.parse("2026-11-24T18:05:00.000Z"); // 한국 11-25 03:05
  const small = freshDb();
  insertExpired(small.database, 101, iso(at - DAY));
  const smallLog = [];
  await runRealpriceCron({ WORK_DB: small.db }, { db: small.db, now: () => at, log: (entry) => entry.event === "trash_expire" && smallLog.push(entry), randomUUID: nextUuid });
  assert.deepEqual(trashCount(small.database), { batches: 0, rows: 0 });
  assert.deepEqual(smallLog, [{ event: "trash_expire", expired: 101 }]);
  const expireAudit = rows(small.database, "SELECT request_id FROM audit_events WHERE action = 'trash.expire'");
  assert.equal(expireAudit.length, 101, "묶음마다 1줄");
  assert.equal(new Set(expireAudit.map((entry) => entry.request_id)).size, 2, "100개씩 2번 = 요청 번호 2개");
  // 한 번(batch) = 감사 · AI 작업 묶음 지우기(파일 행이 없으면 0행) · 휴지통 행 · 묶음 = 문장 4개(AI 작업 지우기는 14.10절 약점 4로 더함)
  assert.deepEqual(small.db.stats.batches.filter((size) => size === 4).length, 2);

  const big = freshDb();
  insertExpired(big.database, 1005, iso(at - DAY));
  big.database.prepare("INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after) VALUES ('later', 'task', 't', '가상', 7, ?, ?, 'r', ?)").run(AT, OWNER, iso(at + DAY));
  const bigLog = [];
  await runRealpriceCron({ WORK_DB: big.db }, { db: big.db, now: () => at, log: (entry) => entry.event === "trash_expire" && bigLog.push(entry), randomUUID: nextUuid });
  assert.deepEqual(bigLog, [{ event: "trash_expire", level: "warn", code: "TRASH_EXPIRE_BACKLOG", expired: 1000 }]);
  assert.deepEqual(trashCount(big.database), { batches: 6, rows: 5 }, "기한 지난 5개와 아직 기한 전 1개가 남음");
  const nextLog = [];
  await runRealpriceCron({ WORK_DB: big.db }, { db: big.db, now: () => at + DAY, log: (entry) => entry.event === "trash_expire" && nextLog.push(entry), randomUUID: nextUuid });
  assert.deepEqual(nextLog, [{ event: "trash_expire", expired: 6 }], "다음 날 나머지(그날 기한이 된 1개 포함)");

  const old = new DatabaseSync(":memory:");
  for (const sql of allMigrationSql.slice(0, 6)) old.exec(sql);
  const oldDb = createD1(old);
  const oldLog = [];
  await runRealpriceCron({ WORK_DB: oldDb }, { db: oldDb, now: () => at, log: (entry) => entry.event === "trash_expire" && oldLog.push(entry) });
  assert.deepEqual(oldLog, [], "구조 6(0007 전)이면 건너뜀");
});

test("휴지통 목록: 지운 순서(최근 위)·limit·cursor, 남은 날은 한국 날짜로 0 아래로 내려가지 않음", async () => {
  const { database, env } = seeded();
  for (const [index, path] of ["/tasks/55555555-5555-4555-8555-000000000002", "/ledger/66666666-6666-4666-8666-000000000003", "/notes/44444444-4444-4444-8444-000000000001"].entries()) {
    await work(env, path, { method: "DELETE", now: NOW + index * 1000 });
  }
  const page1 = await list(env, "?limit=2");
  assert.deepEqual(page1.json.data.items.map((item) => item.kind), ["note", "ledger"]);
  assert.ok(page1.json.data.nextCursor);
  const page2 = await list(env, `?limit=2&cursor=${encodeURIComponent(page1.json.data.nextCursor)}`);
  assert.deepEqual([page2.json.data.items.map((item) => item.kind), page2.json.data.nextCursor], [["task"], null]);
  for (const [name, query] of [["limit 0", "?limit=0"], ["limit 글자", "?limit=x"], ["깨진 cursor", "?cursor=abc"], ["모르는 칸", "?kind=note"]]) {
    const result = await list(env, query);
    assert.equal(result.status, name === "모르는 칸" ? 200 : 400, `${name}: ${JSON.stringify(result.json)}`);
  }
  assert.equal(trashDaysLeft(iso(NOW + 7 * DAY), NOW), 7);
  assert.equal(trashDaysLeft(iso(NOW + 7 * DAY), NOW + 6 * DAY + 13 * 60 * 60 * 1000), 0, "한국 11-24 03:00(같은 날)");
  assert.equal(trashDaysLeft(iso(NOW + 7 * DAY), NOW + 9 * DAY), 0);
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches")[0].n, 3);
});

test("휴지통 경로: 없는 묶음·UUID 아닌 id는 404 NOT_FOUND, 허용하지 않는 방식은 405, 되살리기 본문에 칸이 있으면 400", async () => {
  const { env } = seeded();
  const missing = nextUuid();
  for (const [path, options] of [[`/trash/${missing}/restore`, { method: "POST", body: {} }], [`/trash/${missing}`, { method: "DELETE", body: { confirm: "영구 삭제" } }], ["/trash/not-a-uuid/restore", { method: "POST", body: {} }], ["/trash/not-a-uuid", { method: "DELETE", body: { confirm: "영구 삭제" } }]]) {
    const result = await work(env, path, options);
    assert.deepEqual([result.status, result.json.error.code], [404, "NOT_FOUND"], path);
  }
  for (const [path, method, allow] of [["/trash", "POST", "GET"], [`/trash/${missing}`, "GET", "DELETE"], [`/trash/${missing}/restore`, "GET", "POST"]]) {
    const result = await work(env, path, { method, body: method === "GET" ? undefined : {} });
    assert.deepEqual([result.status, result.json.error.code, result.response.headers.get("Allow")], [405, "METHOD_NOT_ALLOWED", allow], `${method} ${path}`);
  }
  const batchId = (await work(env, "/tasks/55555555-5555-4555-8555-000000000002", { method: "DELETE" })).json.data.trash.batchId;
  const withBody = await restore(env, batchId, { body: { all: true } });
  assert.deepEqual([withBody.status, withBody.json.error.code], [400, "VALIDATION_FAILED"]);
});

test("업무 도구가 꺼져 있으면 503 WORK_DISABLED, 구조 6(0007 적용 전)이면 503 WORK_SCHEMA_OUTDATED", async () => {
  const { db } = seeded();
  const disabled = await work(workEnv(db, { WORK_TOOLS_ENABLED: undefined }), "/trash");
  assert.deepEqual([disabled.status, disabled.json.error.code], [503, "WORK_DISABLED"]);
  const old = new DatabaseSync(":memory:");
  for (const sql of allMigrationSql.slice(0, 6)) old.exec(sql);
  const outdated = await work(workEnv(createD1(old)), "/trash");
  assert.deepEqual([outdated.status, outdated.json.error.code], [503, "WORK_SCHEMA_OUTDATED"]);
});
