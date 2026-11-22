// 업무 도구 단계 2 PR-A: 손님·메모·검색 API 시험. 진짜 SQLite(node:sqlite)에 0001을 적용하고 가짜 자료만 쓴다.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { maskResidentNumbers, decodeCursor, encodeCursor, koreaDate, addOneYear } from "../worker/work-input.mjs";
import { BACKUP, NOW, OWNER, expectedTrash, freshDb, migrationSql, nextUuid, rows, work, workEnv } from "./work-test-kit.mjs";

const audit = (database) => rows(database, "SELECT actor_email, action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");

async function makeCustomer(env, body) {
  const result = await work(env, "/customers", { method: "POST", body });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.customer;
}

test("0001은 원격 D1에 이미 적용됐으니 고치지 말고 0002 새 파일로 만드세요(0001 지문 고정)", async () => {
  const lf = migrationSql.replace(/\r\n/gu, "\n");
  const digest = createHash("sha256").update(lf, "utf8").digest("hex");
  assert.equal(digest, "7ba0f35651a81874a9320214f49154bb6983e67f4701ccf342749204dd3035d2",
    "migrations/work/0001_init.sql이 바뀌었습니다. 0001은 2026-11-17 원격 D1에 적용됐으므로 되돌리고, 구조를 바꾸려면 0002_*.sql을 새로 만드세요.");
  const files = (await import("node:fs/promises")).readdir;
  const names = await files(new URL("../migrations/work/", import.meta.url));
  assert.ok(names.includes("0001_init.sql"));
});

test("0002는 원격 D1에 이미 적용됐으니 고치지 말고 0003 새 파일로 만드세요(0002 지문 고정)", async () => {
  const sql = await readFile(new URL("../migrations/work/0002_deal_schedule_inputs.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(sql.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  assert.equal(digest, "9adbf0997bb201212c71fc9bf9170c35557f6a1d9e2d05155279000622accd51",
    "migrations/work/0002_deal_schedule_inputs.sql이 바뀌었습니다. 0002는 2026-11-17 원격 D1에 적용됐으므로 되돌리고, 구조를 바꾸려면 0003_*.sql을 새로 만드세요.");
});

test("0003은 원격 D1에 이미 적용됐으니 고치지 말고 0004 새 파일로 만드세요(0003 지문 고정)", async () => {
  const sql = await readFile(new URL("../migrations/work/0003_public_realprice.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(sql.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  assert.equal(digest, "8dcbf692b4a33a4ac252934d6c9098d74b94de9fca7e467cdafb5fcc957ca468",
    "migrations/work/0003_public_realprice.sql이 바뀌었습니다. 0003은 원격에 적용됐으니 0004로 만드세요(2026-11-19 원격 D1 적용).");
});

test("0004는 원격 D1에 이미 적용됐으니 고치지 말고 0005 새 파일로 만드세요(0004 지문 고정)", async () => {
  const sql = await readFile(new URL("../migrations/work/0004_blog_drafts.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(sql.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  assert.equal(digest, "94304bd41036bdcc9bc71d3718d364e021f00bfbc997ff05198190d20606bc51",
    "migrations/work/0004_blog_drafts.sql이 바뀌었습니다. 0004는 원격에 적용됐으니 0005로 만드세요(2026-11-20 원격 D1 적용).");
});

test("0005는 원격 D1에 이미 적용됐으니 고치지 말고 0006 새 파일로 만드세요(0005 지문 고정)", async () => {
  const sql = await readFile(new URL("../migrations/work/0005_ledger.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(sql.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  assert.equal(digest, "e05cda1dcc48b5dce418b797997968e0751787fd607304297c8c435c168e49eb",
    "migrations/work/0005_ledger.sql이 바뀌었습니다. 0005는 원격에 적용됐으니 0006 뒤 새 번호로 만드세요(2026-11-21 원격 D1 적용).");
});

test("0006은 원격 D1에 이미 적용됐으니 고치지 말고 0007 뒤 새 파일로 만드세요(0006 지문 고정)", async () => {
  const sql = await readFile(new URL("../migrations/work/0006_tasks.sql", import.meta.url), "utf8");
  const digest = createHash("sha256").update(sql.replace(/\r\n/gu, "\n"), "utf8").digest("hex");
  assert.equal(digest, "8ee2a701457ff2e8a9fd88949a86cb5ff70c57131f156eea0ea8e905afc7e180",
    "migrations/work/0006_tasks.sql이 바뀌었습니다. 0006은 원격에 적용됐으니 0007 뒤 새 번호로 만드세요(2026-11-22 원격 D1 적용).");
});

test("동시 작업: 손님·메모를 고치는 사이 다른 관리자가 같은 밀리초에 먼저 고쳐도(같은 version·같은 시각) 내 수정은 409이고 감사 행이 남지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = (await work(env, "/customers", { method: "POST", body: { displayName: "가상 손님 동시" } })).json.data.customer;
  const note = (await work(env, "/notes", { method: "POST", body: { body: "가상 메모 동시", customerId: customer.id } })).json.data.note;
  const auditCount = () => rows(database, "SELECT count(*) AS n FROM audit_events")[0].n;

  // 다른 관리자의 수정을 updated_at은 그대로(= 이 요청과 같은 NOW) 두고 version만 올려 흉내 낸다. 예전 조건부 감사는 이 겹침에서 실패한 수정의 감사 행을 남겼다.
  const beforeCustomer = auditCount();
  db.beforeNextBatch = () => database.prepare("UPDATE customers SET display_name = '가상 먼저 고침', version = version + 1 WHERE id = ?").run(customer.id);
  const customerResult = await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 1, displayName: "가상 늦게 고침" } });
  assert.equal(customerResult.status, 409);
  assert.equal(customerResult.json.error.code, "VERSION_CONFLICT");
  assert.equal(rows(database, "SELECT display_name FROM customers")[0].display_name, "가상 먼저 고침");
  assert.equal(auditCount(), beforeCustomer, "실패한 손님 수정의 감사 행 없음");

  const beforeNote = auditCount();
  db.beforeNextBatch = () => database.prepare("UPDATE notes SET body = '가상 먼저 고친 메모', version = version + 1 WHERE id = ?").run(note.id);
  const noteResult = await work(env, `/notes/${note.id}`, { method: "PATCH", body: { version: 1, body: "가상 늦게 고친 메모" } });
  assert.equal(noteResult.status, 409);
  assert.equal(rows(database, "SELECT body FROM notes")[0].body, "가상 먼저 고친 메모");
  assert.equal(auditCount(), beforeNote, "실패한 메모 수정의 감사 행 없음");

  const ok = await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 2, status: "on_hold" } });
  assert.equal(ok.status, 200, "맞는 version이면 그대로 고쳐짐");
  assert.equal(rows(database, "SELECT action FROM audit_events ORDER BY seq DESC LIMIT 1")[0].action, "customer.update");
});

test("손님 만들기: 201, 마지막 연락일은 오늘(한국 날짜)·정리 안내 기준일은 +1년, 찾는 조건의 주민번호 형태는 가리고 횟수만 감사에 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "  가상 손님 A  ", phoneDigits: "010-0000-1234", needs: "84㎡ 매수, 메모 900101-1234567 확인", status: "consulting" });
  assert.equal(customer.displayName, "가상 손님 A");
  assert.equal(customer.phoneDigits, "01000001234");
  assert.equal(customer.needs, "84㎡ 매수, 메모 ******-******* 확인");
  assert.equal(customer.version, 1);
  assert.equal(customer.lastContactOn, koreaDate(NOW));
  assert.equal(customer.retentionUntil, addOneYear(koreaDate(NOW)));
  assert.equal(koreaDate(Date.parse("2026-11-17T15:30:00.000Z")), "2026-11-18", "한국 날짜는 UTC+9");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "customer.create", target_type: "customer", target_id: customer.id, outcome: "ok", reason: "rrn_masked=1" });
  assert.doesNotMatch(JSON.stringify(audit(database)), /가상 손님|0100000|900101/u, "감사에 이름·전화·본문 없음");
});

test("손님 입력 검사: 칸 이름만 알려 주고 입력값은 돌려주지 않는다", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  for (const [body, field] of [
    [{}, "displayName"],
    [{ displayName: "" }, "displayName"],
    [{ displayName: "가".repeat(61) }, "displayName"],
    [{ displayName: "가상", status: "vip" }, "status"],
    [{ displayName: "가상", phoneDigits: "010-abcd" }, "phoneDigits"],
    [{ displayName: "가상", phoneDigits: "9001011234567" }, "phoneDigits"],
    [{ displayName: "가상", phoneDigits: "1234567" }, "phoneDigits"],
    [{ displayName: `${"가".repeat(47)}9001011234567` }, "displayName"],
    [{ displayName: "가상", needs: "가".repeat(2001) }, "needs"],
    [{ displayName: "가상", secret: "x" }, "secret"],
  ]) {
    const result = await work(env, "/customers", { method: "POST", body });
    assert.equal(result.status, 400, JSON.stringify(body).slice(0, 40));
    assert.equal(result.json.error.code, "VALIDATION_FAILED");
    assert.deepEqual(result.json.error.details, [field]);
    // requestId는 무작위 UUID라 abcd 같은 글자가 우연히 들어갈 수 있어 빼고 본다.
    assert.doesNotMatch(JSON.stringify({ ...result.json, requestId: undefined }), /가가가|abcd|"x"/u);
  }
});

test("손님 한 건 보기: 거래·메모·파일을 함께 주고 보기 감사를 남긴다. 없는 손님·이상한 ID는 404이고 감사가 남지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 B" });
  const at = new Date(NOW).toISOString();
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES ('d-1', '가상 거래', 'sale', 'housing', ?, ?)").run(at, at);
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('d-1', ?, 'buyer')").run(customer.id);
  await work(env, "/notes", { method: "POST", body: { body: "가상 메모", customerId: customer.id } });
  const before = audit(database).length;
  const detail = await work(env, `/customers/${customer.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.data.customer.id, customer.id);
  assert.deepEqual(detail.json.data.deals.map((deal) => [deal.id, deal.role]), [["d-1", "buyer"]]);
  assert.equal(detail.json.data.notes.length, 1);
  assert.deepEqual(detail.json.data.files, []);
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "customer.view", target_type: "customer", target_id: customer.id, outcome: "ok", reason: null });
  const missing = await work(env, `/customers/${nextUuid()}`);
  assert.equal(missing.status, 404);
  assert.equal((await work(env, "/customers/not-a-uuid")).status, 404);
  assert.equal(audit(database).length, before + 1, "없는 대상은 감사 기록 없음");
});

test("손님 한 건 보기: 거래마다 그 거래의 일정(마감일 순)을 함께 싣고, 다른 손님만의 거래 일정은 넣지 않으며, 감사는 customer.view 1줄 그대로다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 일정" });
  const other = await makeCustomer(env, { displayName: "가상 손님 다른" });
  const at = new Date(NOW).toISOString();
  const [dA, dB, dX] = [nextUuid(), nextUuid(), nextUuid()];
  const insertDeal = database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES (?, ?, 'jeonse', 'housing', ?, ?)");
  insertDeal.run(dA, "가상 거래 가", at, at);
  insertDeal.run(dB, "가상 거래 나", at, at);
  insertDeal.run(dX, "가상 남의 거래", at, at);
  const party = database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES (?, ?, ?)");
  party.run(dA, customer.id, "tenant");
  party.run(dA, customer.id, "other"); // 같은 거래에 역할 둘: 일정은 두 번 나오지 않아야 한다
  party.run(dB, customer.id, "buyer");
  party.run(dB, other.id, "seller"); // 함께인 거래의 일정은 이 손님 카드에도 보인다
  party.run(dX, other.id, "buyer");
  const event = database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, source, done_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'calculated', ?, ?, ?)");
  event.run("e-a2", dA, "balance", "2026-12-26", "잔금", null, at, at);
  event.run("e-a1", dA, "contract", "2026-11-20", "계약", "2026-11-20T06:00:00.000Z", at, at);
  event.run("e-b1", dB, "middle_payment", "2026-12-01", "중도금", null, at, at);
  event.run("e-x1", dX, "balance", "2026-12-02", "가상 남의 잔금", null, at, at);
  const before = audit(database).length;

  const detail = await work(env, `/customers/${customer.id}`);
  assert.equal(detail.status, 200);
  const byDeal = Object.fromEntries(detail.json.data.deals.map((deal) => [`${deal.id}:${deal.role}`, deal.events.map((item) => item.id)]));
  assert.deepEqual(byDeal, { [`${dA}:tenant`]: ["e-a1", "e-a2"], [`${dA}:other`]: ["e-a1", "e-a2"], [`${dB}:buyer`]: ["e-b1"] }, "거래마다 마감일 순, 남의 거래 일정 없음");
  const balance = detail.json.data.deals.find((deal) => deal.id === dA).events[1];
  assert.deepEqual(balance, { id: "e-a2", dealId: dA, kind: "balance", dueOn: "2026-12-26", title: "잔금", alarmOffsets: ["-PT6H"], source: "calculated", doneAt: null, version: 1, createdAt: at, updatedAt: at }, "거래 상세의 일정과 같은 모양");
  const dealDetail = await work(env, `/deals/${dA}`);
  assert.deepEqual(dealDetail.json.data.events, detail.json.data.deals.find((deal) => deal.id === dA).events, "거래 상세 GET /deals/:id와 같은 값");

  const viewAudits = audit(database).slice(before).filter((row) => row.action.endsWith(".view"));
  assert.deepEqual(viewAudits.slice(0, 1), [{ actor_email: OWNER, action: "customer.view", target_type: "customer", target_id: customer.id, outcome: "ok", reason: null }], "손님 보기는 customer.view 1줄(거래마다 deal.view를 남기지 않음)");
  assert.equal(viewAudits.filter((row) => row.action === "deal.view").length, 1, "deal.view는 위에서 거래 상세를 직접 부른 1번뿐");

  const empty = await work(env, `/customers/${other.id}`);
  assert.deepEqual(empty.json.data.deals.find((deal) => deal.id === dX).events.map((item) => item.id), ["e-x1"]);
  const lonely = await makeCustomer(env, { displayName: "가상 손님 거래 없음" });
  assert.deepEqual((await work(env, `/customers/${lonely.id}`)).json.data.deals, [], "거래가 없으면 빈 목록");
});

test("손님 고치기: version이 맞으면 +1, 다른 화면이 먼저 고쳤으면 409, 없으면 404. 실패한 수정은 감사가 남지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 C", phoneDigits: "01011112222" });
  const ok = await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 1, status: "contracting", phoneDigits: null }, now: NOW + 1000 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.customer.version, 2);
  assert.equal(ok.json.data.customer.status, "contracting");
  assert.equal(ok.json.data.customer.phoneDigits, null, "null이면 전화번호를 지움");
  assert.equal(ok.json.data.customer.displayName, "가상 손님 C", "보내지 않은 칸은 그대로");
  const auditCount = audit(database).length;
  const stale = await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 1, needs: "늦은 수정" }, now: NOW + 2000 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "VERSION_CONFLICT");
  assert.equal(audit(database).length, auditCount, "409는 감사 기록 없음");
  assert.equal(rows(database, "SELECT needs FROM customers WHERE id = ?", customer.id)[0].needs, "", "409 때 값이 바뀌지 않음");
  assert.equal((await work(env, `/customers/${nextUuid()}`, { method: "PATCH", body: { version: 1, status: "on_hold" } })).status, 404);
  assert.equal((await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 2 } })).status, 400, "바꿀 칸이 없으면 400");
  assert.equal(audit(database).filter((row) => row.action === "customer.update").length, 1);
});

test("손님 목록: 커서로 끝까지 빠짐없이 넘기고, 상태·검색(대문자로 저장 → 소문자로 검색, 전화번호 뒷자리)으로 거르며, 감사에는 결과 개수만 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const ids = [];
  for (let index = 0; index < 5; index += 1) {
    const customer = await work(env, "/customers", { method: "POST", body: { displayName: `가상 ${index} ABC`, phoneDigits: `0100000${String(index).padStart(4, "0")}`, status: index % 2 ? "on_hold" : "consulting" }, now: NOW + index * 1000 });
    ids.push(customer.json.data.customer.id);
  }
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 5; page += 1) {
    const result = await work(env, `/customers?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(result.status, 200);
    seen.push(...result.json.data.items.map((item) => item.id));
    cursor = result.json.data.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(seen, [...ids].reverse(), "최근 고친 순서로 빠짐없이·겹침 없이");
  assert.equal((await work(env, "/customers?status=on_hold")).json.data.items.length, 2);
  assert.equal((await work(env, "/customers?q=abc")).json.data.items.length, 5, "대문자로 저장된 ABC를 소문자 abc로 찾음");
  assert.equal((await work(env, "/customers?q=%EF%BC%A1%EF%BC%A2%EF%BC%A3")).json.data.items.length, 5, "검색어 전각 ＡＢＣ는 NFKC로 abc가 됨");
  assert.deepEqual((await work(env, "/customers?q=0003")).json.data.items.map((item) => item.id), [ids[3]], "전화번호 뒷자리");
  assert.equal((await work(env, "/customers?q=가상%203")).json.data.items.length, 1);
  const listAudits = audit(database).filter((row) => row.action === "customer.list");
  assert.ok(listAudits.every((row) => /^result_count=\d+$/u.test(row.reason) && row.target_id === null));
  assert.doesNotMatch(JSON.stringify(audit(database)), /abc|0003|가상/iu, "감사에 검색어·이름 없음");
});

test("전화번호 검색은 검색어가 숫자·공백·하이픈으로만 돼 있고 숫자가 3자 이상일 때만 한다(8.6절)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const p = await makeCustomer(env, { displayName: "가상 손님 P", phoneDigits: "010-1234-5678" });
  await makeCustomer(env, { displayName: "가상 손님 Q", phoneDigits: "010-9101-0000" });
  const found = async (q) => (await work(env, `/customers?q=${encodeURIComponent(q)}`)).json.data.items.map((item) => item.id);
  assert.deepEqual(await found("101동"), [], "글자가 섞이면 숫자 101로 전화번호를 비교하지 않음");
  assert.deepEqual(await found("a1"), [], "글자가 섞이면 숫자 1로 전화번호를 비교하지 않음");
  assert.deepEqual(await found("12"), [], "숫자 2자는 전화번호로 비교하지 않음");
  assert.deepEqual(await found("010-1234"), [p.id], "하이픈이 있어도 숫자만 뽑아 어디든 포함으로 찾음");
  assert.deepEqual(await found("5678"), [p.id], "뒷자리로 찾음");
  assert.deepEqual(await found("１２３４ ５６７８"), [p.id], "전각 숫자·공백도 NFKC 뒤 숫자로 찾음");
  const search = await work(env, `/search?q=${encodeURIComponent("5678")}`);
  assert.deepEqual(search.json.data.customers.map((item) => item.id), [p.id], "통합 검색도 같은 규칙");
});

test("목록 커서·개수는 엄격히 검사한다(형식·길이·시각·ID가 틀리면 400)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const good = encodeCursor("2026-11-17T05:00:00.000Z", nextUuid());
  assert.deepEqual(decodeCursor(good).time, "2026-11-17T05:00:00.000Z");
  const badCursors = [
    "!!!",
    "a".repeat(201),
    btoa(JSON.stringify({ t: "2026-11-17", i: nextUuid() })).replace(/=+$/u, ""),
    btoa(JSON.stringify({ t: "2026-11-17T05:00:00.000Z", i: "x" })).replace(/=+$/u, ""),
    btoa(JSON.stringify({ t: "2026-11-17T05:00:00.000Z", i: nextUuid(), extra: 1 })).replace(/=+$/u, ""),
    btoa("not json"),
  ];
  for (const cursor of badCursors) {
    const result = await work(env, `/customers?cursor=${encodeURIComponent(cursor)}`);
    assert.equal(result.status, 400, cursor.slice(0, 20));
    assert.deepEqual(result.json.error.details, ["cursor"]);
  }
  for (const limit of ["0", "51", "abc", "-1", "1.5"]) {
    assert.equal((await work(env, `/customers?limit=${limit}`)).status, 400, limit);
  }
  for (const q of ["", " ", "가".repeat(31)]) {
    const result = await work(env, `/search?q=${encodeURIComponent(q)}`);
    assert.equal(result.status, 400, `검색어 "${q.slice(0, 3)}"`);
  }
});

test("메모: 만들기·메모 창고·검색·고치기·지우기. 손님 메모를 쓰면 그 손님의 마지막 연락일만 오늘로 바뀌고 version은 그대로다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 D" });
  database.prepare("UPDATE customers SET last_contact_on = '2025-01-01', retention_until = '2026-01-01' WHERE id = ?").run(customer.id);
  const later = NOW + 24 * 60 * 60 * 1000;
  const linked = await work(env, "/notes", { method: "POST", body: { body: "통화함. Lease 조건 900101 1234567", customerId: customer.id }, now: later });
  assert.equal(linked.status, 201);
  assert.equal(linked.json.data.note.body, "통화함. Lease 조건 ******-*******");
  const after = rows(database, "SELECT last_contact_on, retention_until, version FROM customers WHERE id = ?", customer.id)[0];
  assert.deepEqual(after, { last_contact_on: koreaDate(later), retention_until: addOneYear(koreaDate(later)), version: 1 });
  const inbox = await work(env, "/notes", { method: "POST", body: { body: "메모 창고 가상 메모" } });
  assert.equal(inbox.status, 201);
  assert.equal(inbox.json.data.note.customerId, null);
  assert.deepEqual((await work(env, "/notes?inbox=1")).json.data.items.map((note) => note.id), [inbox.json.data.note.id]);
  assert.equal((await work(env, "/notes?q=lease")).json.data.items.length, 1, "대문자로 저장된 Lease를 소문자로 찾음");
  const missingLink = await work(env, "/notes", { method: "POST", body: { body: "가상", customerId: nextUuid() } });
  assert.equal(missingLink.status, 400);
  assert.deepEqual(missingLink.json.error.details, ["customerId"]);
  const moved = await work(env, `/notes/${inbox.json.data.note.id}`, { method: "PATCH", body: { version: 1, customerId: customer.id, body: "옮긴 메모" } });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.data.note.customerId, customer.id);
  assert.equal(moved.json.data.note.version, 2);
  assert.equal((await work(env, `/notes/${inbox.json.data.note.id}`, { method: "PATCH", body: { version: 1, body: "늦음" } })).status, 409);
  const removed = await work(env, `/notes/${linked.json.data.note.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.json.data, { deleted: true, trash: expectedTrash(removed.json.data) });
  assert.equal((await work(env, `/notes/${linked.json.data.note.id}`, { method: "DELETE" })).status, 404);
  assert.equal((await work(env, `/notes/${inbox.json.data.note.id}`)).status, 405);
  const actions = audit(database).map((row) => row.action);
  for (const action of ["note.create", "notes.list", "note.update", "note.delete"]) assert.ok(actions.includes(action), action);
  assert.ok(audit(database).some((row) => row.action === "note.create" && row.reason === "rrn_masked=1"));
});

test("검색: 손님과 메모를 함께 찾고 파일은 빈 목록, 감사에는 결과 개수만 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  await makeCustomer(env, { displayName: "가상 Park", needs: "리더스시티" });
  await work(env, "/notes", { method: "POST", body: { body: "park 단지 문의" } });
  const result = await work(env, "/search?q=PARK");
  assert.equal(result.status, 200);
  assert.equal(result.json.data.customers.length, 1);
  assert.equal(result.json.data.notes.length, 1);
  assert.deepEqual(result.json.data.files, []);
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "search.run", target_type: null, target_id: null, outcome: "ok", reason: "result_count=2" });
});

test("손님 지우기: 이름을 다시 입력해야 하고, 그 손님 전용 거래·일정·메모는 함께 지우며 다른 손님과 함께인 거래는 남긴다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const target = await makeCustomer(env, { displayName: "가상 손님 E" });
  const other = await makeCustomer(env, { displayName: "가상 손님 F" });
  const at = new Date(NOW).toISOString();
  for (const id of ["solo", "shared"]) {
    database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES (?, ?, 'sale', 'housing', ?, ?)").run(id, `가상 ${id}`, at, at);
  }
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('solo', ?, 'buyer'), ('shared', ?, 'buyer'), ('shared', ?, 'seller')").run(target.id, target.id, other.id);
  database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, created_at, updated_at) VALUES ('e-1', 'solo', 'contract', '2026-12-01', '가상 계약', ?, ?)").run(at, at);
  await work(env, "/notes", { method: "POST", body: { body: "손님 메모", customerId: target.id } });
  await work(env, "/notes", { method: "POST", body: { body: "전용 거래 메모", dealId: "solo" } }).catch(() => null);
  database.prepare("INSERT INTO notes (id, customer_id, deal_id, body, created_at, updated_at) VALUES ('n-solo', NULL, 'solo', '전용 거래 메모', ?, ?), ('n-shared', NULL, 'shared', '함께 거래 메모', ?, ?), ('n-both', ?, 'shared', '손님이 쓴 함께 거래 메모', ?, ?), ('n-other', ?, 'solo', '다른 손님이 단독 거래에 건 메모', ?, ?)").run(at, at, at, at, target.id, at, at, other.id, at, at);

  const mismatch = await work(env, `/customers/${target.id}`, { method: "DELETE", body: { confirmName: "가상 손님" } });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.json.error.code, "CONFIRMATION_MISMATCH");

  const deleted = await work(env, `/customers/${target.id}`, { method: "DELETE", body: { confirmName: "가상 손님 E" } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data.deleted, { customers: 1, deals: 1, notes: 2, files: 0, tasks: 0 });
  assert.deepEqual(deleted.json.data.kept, { notes: 2, ledger: 0 }, "연결만 끊고 남긴 메모 수(함께인 거래의 이 손님 메모 1 + 단독 거래의 다른 손님 메모 1, 화면 경고용)");
  assert.deepEqual(deleted.json.data.trash, expectedTrash(deleted.json.data), "휴지통 묶음(0007)");
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches")[0].n, 1, "휴지통 묶음 1개로 옮겨지고 원래 표에서는 빠짐(T2-58)");
  assert.equal(rows(database, "SELECT count(*) AS n FROM customers WHERE id = ?", target.id)[0].n, 0);
  assert.deepEqual(rows(database, "SELECT id FROM deals ORDER BY id").map((row) => row.id), ["shared"]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM deal_events")[0].n, 0);
  assert.deepEqual(rows(database, "SELECT customer_id FROM deal_parties").map((row) => row.customer_id), [other.id]);
  assert.deepEqual(rows(database, "SELECT id, customer_id, deal_id FROM notes ORDER BY id"), [
    { id: "n-both", customer_id: null, deal_id: "shared" },
    { id: "n-other", customer_id: other.id, deal_id: null },
    { id: "n-shared", customer_id: null, deal_id: "shared" },
  ], "함께인 거래에 걸린 이 손님 메모는 손님 연결만 끊고, 지운 단독 거래에 걸린 다른 손님 메모는 거래 연결만 끊어 그 손님 메모로 남김");
  assert.deepEqual(audit(database).at(-1), { actor_email: OWNER, action: "customer.delete", target_type: "customer", target_id: target.id, outcome: "ok", reason: "notes_kept=2" });
});

test("손님 지우기: 연결 끊기·메모 삭제·거래 정리·감사 기록은 한 batch라, 감사 기록이 실패하면 아무것도 지워지지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 K" });
  await work(env, "/notes", { method: "POST", body: { body: "가상 메모", customerId: customer.id } });
  // 감사 기록 문장만 없는 표에 쓰게 바꿔 batch 안에서 실패하게 한다.
  const failingAudit = { ...db, prepare: (sql) => db.prepare(sql.startsWith("INSERT INTO audit_events") ? sql.replace("audit_events", "audit_events_missing") : sql) };
  const logs = [];
  const result = await work(workEnv(failingAudit), `/customers/${customer.id}`, { method: "DELETE", body: { confirmName: "가상 손님 K" }, auditLog: (entry) => logs.push(entry) });
  assert.equal(result.status, 503);
  assert.equal(result.json.error.code, "STORAGE_UNAVAILABLE");
  assert.equal(rows(database, "SELECT count(*) AS n FROM customers")[0].n, 1, "손님 그대로");
  assert.equal(rows(database, "SELECT count(*) AS n FROM notes")[0].n, 1, "메모 그대로");
  assert.deepEqual(logs, [{ event: "work_request_failed", requestId: result.json.requestId, status: 503, code: "STORAGE_UNAVAILABLE" }], "실패는 Worker 로그에 코드·요청 ID만");
});

test("업무 자료 처리 중 예상 못 한 오류는 503으로 끝내고, Worker 로그에는 오류 종류 이름만 남기며 오류 문구·검색어는 남기지 않는다(11.7절)", async () => {
  const { db } = freshDb();
  const broken = { ...db, prepare: (sql) => (sql.startsWith("SELECT id, display_name") ? (() => { throw new TypeError("가상 손님 비밀 문구"); })() : db.prepare(sql)) };
  const logs = [];
  const result = await work(workEnv(broken), "/customers?q=가상검색어", { auditLog: (entry) => logs.push(entry) });
  assert.equal(result.status, 503);
  assert.equal(result.json.error.code, "STORAGE_UNAVAILABLE");
  assert.deepEqual(logs, [{ event: "work_request_failed", requestId: result.json.requestId, status: 503, code: "STORAGE_UNAVAILABLE", errorName: "TypeError" }]);
  const text = JSON.stringify(logs) + JSON.stringify(result.json);
  assert.ok(!text.includes("비밀 문구") && !text.includes("가상검색어"), "오류 문구·검색어가 로그·응답에 없음");
});

test("손님 지우기: 연결된 파일 행이 있으면 파일 저장소가 연결된 뒤에 지울 수 있게 409로 막고 아무것도 지우지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 손님 G" });
  database.prepare("INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, created_at) VALUES ('f-1', 'work/other/2026/11/f-1.png', 'other', 'image/png', 10, ?, ?, ?)").run("a".repeat(64), customer.id, new Date(NOW).toISOString());
  const blocked = await work(env, `/customers/${customer.id}`, { method: "DELETE", body: { confirmName: "가상 손님 G" } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, "FILES_REQUIRE_STORAGE");
  assert.equal(rows(database, "SELECT count(*) AS n FROM customers")[0].n, 1);
  assert.equal(rows(database, "SELECT count(*) AS n FROM files")[0].n, 1);
});

test("감사 기록: 거부 행은 action(request.denied)·outcome(denied)으로 구분하고, reason이 있는 정상 행과 섞이지 않는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  await makeCustomer(env, { displayName: "가상 손님 H", needs: "900101-1234567" });
  await work(env, "/customers");
  const request = new Request("https://leaderscityhappy.com/api/admin/v1/work/customers", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const { handleAdminApi } = await import("../worker/admin-api.mjs");
  const { authenticate, signToken } = await import("./work-test-kit.mjs");
  request.headers.set("Cf-Access-Jwt-Assertion", await signToken());
  await handleAdminApi(request, env, { authenticate, work: { now: () => NOW, auditLog: () => {} } });
  const withReason = rows(database, "SELECT count(*) AS n FROM audit_events WHERE reason IS NOT NULL")[0].n;
  const denied = rows(database, "SELECT count(*) AS n FROM audit_events WHERE action = 'request.denied' AND outcome = 'denied'")[0].n;
  assert.equal(denied, 1, "Origin 없는 쓰기 1건");
  assert.ok(withReason > denied, "rrn_masked·result_count처럼 정상 행에도 reason이 있음 → 거부 집계는 reason IS NOT NULL로 하면 틀림");
  assert.equal(rows(database, "SELECT count(*) AS n FROM audit_events WHERE outcome = 'ok' AND action = 'request.denied'")[0].n, 0);
});

test("손님·메모 경로는 정해진 방식만 받는다(405 + Allow)", async () => {
  const { db } = freshDb();
  const env = workEnv(db);
  const put = await work(env, "/customers", { method: "PUT", body: {} });
  assert.equal(put.status, 405);
  assert.equal(put.response.headers.get("Allow"), "GET, POST");
  const customer = await makeCustomer(env, { displayName: "가상 손님 I" });
  assert.equal((await work(env, `/customers/${customer.id}`, { method: "POST", body: {} })).response.headers.get("Allow"), "GET, PATCH, DELETE");
  assert.equal((await work(env, "/search", { method: "DELETE", body: {} })).status, 405);
});

test("주민번호 가림 함수: 하이픈·띄어쓰기·붙여 쓴 형태를 모두 가리고 횟수를 센다", () => {
  assert.deepEqual(maskResidentNumbers("A 900101-1234567 B 900101 2234567 C 9001013234567 D 010-1234-5678"), {
    text: "A ******-******* B ******-******* C ******-******* D 010-1234-5678",
    count: 3,
  });
  assert.deepEqual(maskResidentNumbers("없음"), { text: "없음", count: 0 });
});

test("주민번호 가림 함수: 띄운 하이픈·전각·대시·점도 가리고, 원래 글의 다른 글자는 그대로 둔다(11.2절)", () => {
  const masks = [
    ["띄운 하이픈 900101 - 1234567 끝", "띄운 하이픈 ******-******* 끝"],
    ["전각 ９００１０１－１２３４５６７ 끝", "전각 ******-******* 끝"],
    ["긴 대시 900101–1234567 / 900101—1234567", "긴 대시 ******-******* / ******-*******"],
    ["점 900101.1234567", "점 ******-*******"],
    ["원문자 붙음 ①900101-1234567", "원문자 붙음 ①******-*******"],
    ["계좌 1234561234567", "계좌 ******-*******"],
  ];
  for (const [input, expected] of masks) {
    assert.deepEqual(maskResidentNumbers(input), { text: expected, count: expected.split("******-*******").length - 1 }, input);
  }
  const keeps = [
    "전화 010-1234-5678",
    "날짜 2026.11.17 1234567",
    "사업자번호 805-05-02602, 1234567890",
    "매매가 650000000 2000000 협의",
    "84㎡ 매수, 전용 ２５평 ①",
    "앞뒤에 숫자가 붙으면 보지 않음 19001011234567",
  ];
  for (const input of keeps) {
    assert.deepEqual(maskResidentNumbers(input), { text: input, count: 0 }, input);
  }
});

test("주민번호 가림: 손님 이름·찾는 조건·메모 모두 가리고 횟수만 감사에 남기며, 전화번호 칸은 8 ~ 12자리만 받는다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const customer = await makeCustomer(env, { displayName: "가상 900101 - 1234567", phoneDigits: "+82 10-1234-5678", needs: "84㎡ 매수, 전용 ２５평, ９００１０１－１２３４５６７" });
  assert.equal(customer.displayName, "가상 ******-*******");
  assert.equal(customer.needs, "84㎡ 매수, 전용 ２５평, ******-*******", "가린 부분 말고는 사람이 친 글 그대로");
  assert.equal(customer.phoneDigits, "821012345678");
  assert.equal(audit(database).at(-1).reason, "rrn_masked=2");
  const patched = await work(env, `/customers/${customer.id}`, { method: "PATCH", body: { version: 1, displayName: "가상 900101.1234567", phoneDigits: "０１０－１２３４－５６７８" } });
  assert.equal(patched.status, 200, JSON.stringify(patched.json));
  assert.equal(patched.json.data.customer.displayName, "가상 ******-*******");
  assert.equal(patched.json.data.customer.phoneDigits, "01012345678");
  const note = await work(env, "/notes", { method: "POST", body: { body: "통화 900101—1234567, 다른 번호 010-1234-5678", customerId: customer.id } });
  assert.equal(note.json.data.note.body, "통화 ******-*******, 다른 번호 010-1234-5678");
  assert.doesNotMatch(JSON.stringify(rows(database, "SELECT display_name, needs FROM customers")) + JSON.stringify(rows(database, "SELECT body FROM notes")), /1234567|１２３４５６７/u, "저장값에 뒷자리 원문 없음");
  assert.doesNotMatch(JSON.stringify(audit(database)), /900101|1234567/u, "감사에는 횟수만");
});

test("외래 키: 없는 손님을 가리키는 거래 참여자는 넣을 수 없고, 손님을 지우면 참여 행도 함께 지워진다", () => {
  const { database } = freshDb();
  const at = new Date(NOW).toISOString();
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES ('d', '가상', 'sale', 'housing', ?, ?)").run(at, at);
  assert.throws(() => database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('d', 'missing', 'buyer')").run(), /FOREIGN KEY/u);
  database.prepare("INSERT INTO customers (id, display_name, created_at, updated_at) VALUES ('c', '가상', ?, ?)").run(at, at);
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('d', 'c', 'buyer')").run();
  database.prepare("DELETE FROM customers WHERE id = 'c'").run();
  assert.equal(database.prepare("SELECT count(*) AS n FROM deal_parties").get().n, 0, "ON DELETE CASCADE(D1 기본 검사 여부는 추가 확인 필요라 코드는 직접 지움)");
});

test("두 허용 이메일 모두 손님 자료를 쓰고, 감사 작업자는 각자의 이메일이다", async () => {
  const { database, db } = freshDb();
  const env = workEnv(db);
  const first = await makeCustomer(env, { displayName: "가상 손님 J" });
  const second = await work(env, `/customers/${first.id}`, { method: "PATCH", body: { version: 1, status: "completed" }, email: BACKUP });
  assert.equal(second.status, 200);
  assert.deepEqual(audit(database).filter((row) => row.action.startsWith("customer.")).map((row) => row.actor_email), [OWNER, BACKUP]);
});

test("새 업무 코드 파일도 준비된 문장만 쓴다(문자열 SQL 금지 검사 범위)", async () => {
  for (const name of ["work-customers.mjs", "work-audit.mjs", "work-input.mjs"]) {
    const source = await readFile(new URL(`../worker/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /prepare\(\s*`[^`]*\$\{/u, `${name}: 템플릿 문자열 SQL 금지`);
    assert.doesNotMatch(source, /prepare\([^)]*\+/u, `${name}: 문자열 이어 붙인 SQL 금지`);
  }
});
