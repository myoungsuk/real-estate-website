// 업무 도구 단계 3 캘린더 구독 주소 시험(테스트 체크리스트 T3-01 ~ T3-07·T3-05a·T3-09·T3-23 ~ T3-26, 설계서 12.3절·DEC-WT-42).
// 진짜 SQLite(node:sqlite)에 migrations/work 전부를 적용하고 가상 자료만 쓴다. 날짜는 now를 넣어 고정한다
// (NOW = 2026-11-17 14:00 한국 시각, 한국 날짜가 바뀌는 UTC 15시 앞뒤 경계 포함). 토큰 해시 키(pepper)도 가상 값이다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleRequest } from "../worker/index.mjs";
import {
  FEED_TOKEN_BYTES,
  createFeedToken,
  feedTokenHash,
  handleCalendarFeedRequest,
} from "../worker/work-calendar-feeds.mjs";
import { freshDb, rows, work, workEnv, NOW, ORIGIN } from "./work-test-kit.mjs";

const PEPPER = "p".repeat(40);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (time = NOW) => new Date(time).toISOString();
const FEED_URL = /^https:\/\/leaderscityhappy\.com\/api\/calendar\/([A-Za-z0-9_-]{43})\.ics$/u;

function setup(extra = {}) {
  const { database, db } = freshDb();
  const writes = [];
  // last_used_at 쓰기를 센다(하루 1번, T3-07).
  const prepare = db.prepare;
  db.prepare = (sql) => {
    if (/^UPDATE calendar_feeds SET last_used_at/u.test(sql)) writes.push(sql);
    return prepare(sql);
  };
  return { database, db, writes, env: workEnv(db, { WORK_FEED_TOKEN_PEPPER: PEPPER, ...extra }) };
}

async function createFeed(env, body = { label: "사무소 휴대폰" }, options = {}) {
  const result = await work(env, "/calendar-feeds", { method: "POST", body, ...options });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  const token = FEED_URL.exec(result.json.data.subscribeUrl)?.[1];
  assert.ok(token, `구독 주소 꼴: ${result.json.data.subscribeUrl}`);
  return { ...result.json.data, token };
}

async function fetchFeed(env, path, { now = NOW, method = "GET", log } = {}) {
  const logs = [];
  const response = await handleCalendarFeedRequest(new Request(`${ORIGIN}${path}`, { method }), env, { now: () => now, log: log ?? ((entry) => logs.push(entry)) });
  const headers = Object.fromEntries(response.headers);
  return { response, status: response.status, headers, text: await response.text(), logs };
}

const feedPath = (token) => `/api/calendar/${token}.ics`;
const audit = (database) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events WHERE action LIKE 'feed.%' ORDER BY seq");
const unfold = (text) => text.replace(/\r\n[ \t]/gu, "");
function vevents(text) {
  return unfold(text).split("BEGIN:VEVENT").slice(1).map((chunk) => {
    const lines = chunk.split("\r\n");
    const value = (name) => lines.find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`))?.replace(/^[^:]*:/u, "") ?? null;
    return {
      uid: value("UID"),
      date: value("DTSTART"),
      summary: value("SUMMARY"),
      description: value("DESCRIPTION"),
      triggers: lines.filter((line) => line.startsWith("TRIGGER:")).map((line) => line.slice(8)),
    };
  });
}

test("T3-01·T3-02 구독 주소는 만들 때 한 번만 돌려주고, D1에는 토큰 원문 없이 HMAC-SHA256 해시(16진 64자)만 두며, 토큰은 32바이트 무작위 base64url 43자다", async () => {
  const { database, env } = setup();
  const created = await createFeed(env);
  assert.deepEqual(Object.keys(created.feed).sort(), ["createdAt", "id", "label", "lastUsedAt", "revokedAt"]);
  assert.equal(created.feed.label, "사무소 휴대폰");
  const stored = rows(database, "SELECT * FROM calendar_feeds");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].token_hash, await feedTokenHash(created.token, PEPPER));
  assert.match(stored[0].token_hash, /^[0-9a-f]{64}$/u);
  assert.equal(stored[0].last_used_at, null);
  assert.equal(stored[0].revoked_at, null);
  const everything = JSON.stringify(rows(database, "SELECT * FROM calendar_feeds")) + JSON.stringify(rows(database, "SELECT * FROM audit_events"));
  assert.equal(everything.includes(created.token), false, "D1 어디에도 토큰 원문이 없음");
  assert.deepEqual(audit(database), [{ action: "feed.create", target_type: "calendar_feed", target_id: created.feed.id, outcome: "ok", reason: null }]);

  // 목록은 주소·해시를 다시 보여 주지 않는다(한 번만 보여 줌).
  const list = await work(env, "/calendar-feeds");
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.data.feeds, [created.feed]);
  assert.equal(JSON.stringify(list.json).includes(created.token), false);
  assert.equal(JSON.stringify(list.json).includes(stored[0].token_hash), false);

  // 토큰 꼴: 32바이트 → base64url 43자, 되돌리면 같은 32바이트.
  const bytes = Uint8Array.from({ length: FEED_TOKEN_BYTES }, (_, index) => (index * 37 + 251) % 256);
  const fixed = createFeedToken(() => bytes);
  assert.match(fixed, /^[A-Za-z0-9_-]{43}$/u);
  assert.deepEqual(Uint8Array.from(Buffer.from(fixed, "base64url")), bytes);
  const many = new Set(Array.from({ length: 50 }, () => createFeedToken()));
  assert.equal(many.size, 50, "실제 무작위(crypto.getRandomValues)");
  for (const token of many) assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(await feedTokenHash(fixed, PEPPER), await feedTokenHash(fixed, "q".repeat(40)), "키가 다르면 해시도 다름");
});

test("이름은 40자까지(넘으면 400, 다른 칸 400), 이름 없이도 만들고, 해시 키(WORK_FEED_TOKEN_PEPPER)가 없거나 32자 미만이면 503이고 아무것도 쓰지 않는다", async () => {
  const { database, env } = setup();
  assert.equal((await work(env, "/calendar-feeds", { method: "POST", body: { label: "가".repeat(41) } })).status, 400);
  const extraField = await work(env, "/calendar-feeds", { method: "POST", body: { label: "a", token: "x" } });
  assert.equal(extraField.status, 400);
  assert.equal(extraField.json.error.code, "VALIDATION_FAILED");
  assert.equal((await work(env, "/calendar-feeds", { method: "POST", body: { label: 3 } })).status, 400);
  const plain = await createFeed(env, {});
  assert.equal(plain.feed.label, "");
  const forty = await createFeed(env, { label: `  ${"가".repeat(40)}  ` });
  assert.equal(forty.feed.label, "가".repeat(40));

  for (const pepper of [undefined, "short"]) {
    const missing = setup({ WORK_FEED_TOKEN_PEPPER: pepper });
    const result = await work(missing.env, "/calendar-feeds", { method: "POST", body: {} });
    assert.equal(result.status, 503);
    assert.equal(result.json.error.code, "WORK_CONFIG_MISSING");
    assert.deepEqual(rows(missing.database, "SELECT id FROM calendar_feeds"), []);
    assert.deepEqual(audit(missing.database), []);
  }
  assert.equal(rows(database, "SELECT id FROM calendar_feeds WHERE revoked_at IS NULL").length, 1);
});

test("T3-03 취소한 토큰·없는 토큰·형식이 틀린 토큰·업무 도구 꺼짐·해시 키 없음·구조 번호 불일치가 모두 같은 404(상태·헤더·본문이 같음)이고 D1에 쓰지 않는다", async () => {
  const { database, env, writes } = setup();
  const live = await createFeed(env);
  const revoked = await createFeed(env); // live가 새 주소로 바뀌기 전 것을 취소하려고 하나 더 만든 뒤 지움
  assert.equal((await work(env, `/calendar-feeds/${revoked.feed.id}`, { method: "DELETE" })).status, 200);
  const other = createFeedToken();
  const cases = [
    ["취소한 토큰", env, feedPath(revoked.token)],
    ["자동 취소된 토큰", env, feedPath(live.token)],
    ["없는 토큰", env, feedPath(other)],
    ["42자", env, `/api/calendar/${other.slice(1)}.ics`],
    ["44자", env, `/api/calendar/${other}A.ics`],
    ["허용되지 않은 글자", env, `/api/calendar/${other.slice(1)}=.ics`],
    ["확장자 없음", env, `/api/calendar/${other}`],
    ["다른 확장자", env, `/api/calendar/${other}.json`],
    ["한 단계 더", env, `/api/calendar/x/${other}.ics`],
    ["빈 토큰", env, "/api/calendar/.ics"],
    ["업무 도구 꺼짐", { ...env, WORK_TOOLS_ENABLED: undefined }, feedPath(other)],
    ["해시 키 없음", { ...env, WORK_FEED_TOKEN_PEPPER: undefined }, feedPath(other)],
  ];
  const seen = [];
  for (const [name, caseEnv, path] of cases) {
    const result = await fetchFeed(caseEnv, path);
    assert.equal(result.status, 404, name);
    seen.push({ headers: result.headers, text: result.text });
  }
  for (const item of seen) assert.deepEqual(item, seen[0], "응답이 서로 구분되지 않음");
  assert.deepEqual(seen[0].headers, {
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive",
  });

  // 구조 번호가 프로그램과 다르면(뒤처짐·앞섬) 살아 있는 주소도 같은 404.
  const current = await createFeed(env);
  assert.equal((await fetchFeed(env, feedPath(current.token))).status, 200);
  const usedAt = rows(database, "SELECT last_used_at FROM calendar_feeds WHERE id = ?", current.feed.id)[0].last_used_at;
  for (const version of ["8", "10"]) {
    database.prepare("UPDATE settings SET value_json = ? WHERE key = 'schema_version'").run(version);
    const result = await fetchFeed(env, feedPath(current.token), { now: NOW + 2 * DAY });
    assert.deepEqual({ status: result.status, headers: result.headers, text: result.text }, { status: 404, ...seen[0] }, `구조 번호 ${version}`);
  }
  database.prepare("UPDATE settings SET value_json = '9' WHERE key = 'schema_version'").run();
  assert.equal(rows(database, "SELECT last_used_at FROM calendar_feeds WHERE id = ?", current.feed.id)[0].last_used_at, usedAt, "404 때는 받은 날짜를 쓰지 않음");
  assert.equal(writes.length, 1, "D1 쓰기는 200 한 번뿐");
});

test("T3-04 새 주소를 만들면 이전 주소는 자동 취소(404)되어 취소되지 않은 주소는 늘 1개이고, 취소는 감사 feed.revoke로 남는다. 지우기(DELETE)도 같은 404를 만들고 두 번 눌러도 기록은 1줄이다", async () => {
  const { database, env } = setup();
  const first = await createFeed(env, { label: "처음" });
  assert.equal((await fetchFeed(env, feedPath(first.token))).status, 200);
  const second = await createFeed(env, { label: "다시" }, { now: NOW + HOUR });
  assert.equal((await fetchFeed(env, feedPath(first.token))).status, 404, "이전 주소는 취소");
  assert.equal((await fetchFeed(env, feedPath(second.token))).status, 200);
  assert.deepEqual(rows(database, "SELECT id, revoked_at FROM calendar_feeds ORDER BY created_at"), [
    { id: first.feed.id, revoked_at: at(NOW + HOUR) },
    { id: second.feed.id, revoked_at: null },
  ]);
  const list = await work(env, "/calendar-feeds");
  assert.deepEqual(list.json.data.feeds.map((feed) => feed.id), [second.feed.id], "목록은 살아 있는 주소 1개만");

  const revoke = await work(env, `/calendar-feeds/${second.feed.id}`, { method: "DELETE", now: NOW + 2 * HOUR });
  assert.equal(revoke.status, 200);
  assert.deepEqual(revoke.json.data, { revoked: true });
  assert.equal((await fetchFeed(env, feedPath(second.token))).status, 404);
  const again = await work(env, `/calendar-feeds/${second.feed.id}`, { method: "DELETE", now: NOW + 3 * HOUR });
  assert.deepEqual(again.json.data, { revoked: true }, "이미 취소된 주소도 같은 답");
  assert.equal(rows(database, "SELECT revoked_at FROM calendar_feeds WHERE id = ?", second.feed.id)[0].revoked_at, at(NOW + 2 * HOUR), "처음 취소 시각 그대로");
  assert.deepEqual(audit(database), [
    { action: "feed.create", target_type: "calendar_feed", target_id: first.feed.id, outcome: "ok", reason: null },
    { action: "feed.revoke", target_type: "calendar_feed", target_id: first.feed.id, outcome: "ok", reason: "replaced" },
    { action: "feed.create", target_type: "calendar_feed", target_id: second.feed.id, outcome: "ok", reason: null },
    { action: "feed.revoke", target_type: "calendar_feed", target_id: second.feed.id, outcome: "ok", reason: null },
  ]);
  assert.deepEqual(rows(database, "SELECT id FROM calendar_feeds WHERE revoked_at IS NULL"), []);

  assert.equal((await work(env, "/calendar-feeds/00000000-0000-4000-8000-999999999999", { method: "DELETE" })).status, 404);
  assert.equal((await work(env, "/calendar-feeds/not-a-uuid", { method: "DELETE" })).status, 404);
  assert.equal((await work(env, `/calendar-feeds/${first.feed.id}`, { method: "DELETE", body: { x: 1 } })).status, 400);
  const wrongMethod = await work(env, `/calendar-feeds/${first.feed.id}`, { method: "PATCH", body: {} });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.response.headers.get("Allow"), "DELETE");
  assert.equal((await work(env, "/calendar-feeds", { method: "PUT", body: {} })).status, 405);
});

function seedSchedule(database) {
  const stamp = at();
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES (?, ?, 'sale', 'housing', ?, ?)").run("deal-1", "가상숲 5블록 매매", stamp, stamp);
  database.prepare("INSERT INTO customers (id, display_name, phone_digits, needs, created_at, updated_at) VALUES ('cust-1', '가상손님홍길', '01098765432', '가상 조건 84㎡', ?, ?)").run(stamp, stamp);
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('deal-1', 'cust-1', 'buyer')").run();
  database.prepare("INSERT INTO notes (id, customer_id, deal_id, body, created_at, updated_at) VALUES ('note-1', 'cust-1', 'deal-1', '가상 비밀 메모 문구', ?, ?)").run(stamp, stamp);
  const event = (id, kind, dueOn, title, { doneAt = null, alarms = '["-PT6H"]' } = {}) => database.prepare(
    "INSERT INTO deal_events (id, deal_id, kind, due_on, title, alarm_offsets, source, done_at, created_at, updated_at) VALUES (?, 'deal-1', ?, ?, ?, ?, 'calculated', ?, ?, ?)",
  ).run(id, kind, dueOn, title, alarms, doneAt, stamp, stamp);
  event("ev-balance", "balance", "2026-11-30", "잔금일");
  event("ev-report", "transaction_report", "2026-12-16", "부동산 거래신고 기한");
  event("ev-contract", "contract", "2026-11-01", "계약일", { doneAt: at(NOW - 16 * DAY) });
  event("ev-old-done", "middle_payment", "2026-09-01", "중도금일", { doneAt: at(NOW - 70 * DAY) });
  event("ev-custom", "custom", "2026-08-01", "가상 현장 확인");
  event("ev-two-alarms", "custom", "2026-12-01", "가상 이사 확인", { alarms: '["-PT6H","PT9H"]' });
  event("ev-no-alarm", "custom", "2026-12-02", "가상 알림 없음", { alarms: "[]" });
  event("ev-edge", "custom", "2026-10-18", "가상 30일째", { doneAt: at(NOW - 30 * DAY) });
  event("ev-edge-out", "custom", "2026-10-17", "가상 31일째", { doneAt: at(NOW - 31 * DAY) });
  const task = (id, title, dueOn, doneAt = null) => database.prepare(
    "INSERT INTO tasks (id, title, deal_id, due_on, done_at, created_at, updated_at) VALUES (?, ?, 'deal-1', ?, ?, ?, ?)",
  ).run(id, title, dueOn, doneAt, stamp, stamp);
  task("task-open", "가상 등기 서류 챙기기", "2026-11-20");
  task("task-nodate", "가상 날짜 없는 할 일", null);
  task("task-old-done", "가상 오래전 끝낸 할 일", "2026-09-10", at(NOW - 60 * DAY));
  task("task-done", "가상 지난주 끝낸 할 일", "2026-11-10", at(NOW - 7 * DAY));
}

test("T3-05·T3-05a 구독 내용은 끝나지 않은 일정(날짜와 상관없이) + 지난 30일 일정·날짜 있는 할 일이고, 일정 이름은 '일정 종류 · 거래 제목'·할 일 제목, 알림은 전날 18:00(-PT6H), 손님 이름·전화번호·메모는 없다", async () => {
  const { database, env } = setup();
  seedSchedule(database);
  const created = await createFeed(env);
  const result = await fetchFeed(env, feedPath(created.token));
  assert.equal(result.status, 200);
  for (const secret of ["가상손님홍길", "01098765432", "010-9876-5432", "가상 비밀 메모 문구", "가상 조건 84㎡", created.token]) {
    assert.equal(unfold(result.text).includes(secret), false, `구독 내용에 '${secret}' 없음`);
  }
  assert.match(result.text, /^BEGIN:VCALENDAR\r\n/u);
  assert.match(result.text, /\r\nX-WR-CALNAME:업무 일정\r\n/u);
  assert.match(result.text, /END:VCALENDAR\r\n$/u);
  const items = vevents(result.text);
  assert.deepEqual(items.map(({ date, summary, triggers }) => ({ date, summary, triggers })), [
    { date: "20260801", summary: "가상 현장 확인 · 가상숲 5블록 매매", triggers: ["-PT6H"] },
    { date: "20261018", summary: "완료 · 가상 30일째 · 가상숲 5블록 매매", triggers: [] },
    { date: "20261101", summary: "완료 · 계약일 · 가상숲 5블록 매매", triggers: [] },
    { date: "20261110", summary: "완료 · 가상 지난주 끝낸 할 일", triggers: [] },
    { date: "20261120", summary: "가상 등기 서류 챙기기", triggers: ["-PT6H"] },
    { date: "20261130", summary: "잔금 · 가상숲 5블록 매매", triggers: ["-PT6H"] },
    { date: "20261201", summary: "가상 이사 확인 · 가상숲 5블록 매매", triggers: ["-PT6H", "PT9H"] },
    { date: "20261202", summary: "가상 알림 없음 · 가상숲 5블록 매매", triggers: [] },
    { date: "20261216", summary: "거래신고 · 가상숲 5블록 매매", triggers: ["-PT6H"] },
  ]);
  const byUid = Object.fromEntries(items.map((item) => [item.uid, item]));
  assert.equal(byUid["event-ev-balance@leaderscityhappy.com"].description, "잔금");
  assert.equal(byUid["task-task-open@leaderscityhappy.com"].description, "할 일");
  assert.match(byUid["event-ev-report@leaderscityhappy.com"].description, /^거래신고\\n.+/u, "신고 기한은 종류 + 법정 문구");
  assert.equal(byUid["event-ev-custom@leaderscityhappy.com"].description, "직접 넣은 일정");
  assert.equal(items.some((item) => /31일째|오래전|날짜 없는|중도금/u.test(item.summary)), false, "지난 30일 밖의 끝낸 것·날짜 없는 할 일은 없음");

  // 끝낸 표시를 풀거나 지우면 다음 받기에 그대로 반영된다(캘린더 앱은 받을 때마다 전체를 새로 맞춤).
  database.prepare("UPDATE deal_events SET done_at = NULL WHERE id = 'ev-old-done'").run();
  database.prepare("DELETE FROM deal_events WHERE id = 'ev-balance'").run();
  const next = vevents((await fetchFeed(env, feedPath(created.token), { now: NOW + HOUR })).text).map((item) => item.summary);
  assert.ok(next.includes("중도금 · 가상숲 5블록 매매"));
  assert.equal(next.includes("잔금 · 가상숲 5블록 매매"), false);
});

test("T3-06 구독 응답 헤더는 Worker가 붙인다: text/calendar; charset=utf-8, no-store, X-Robots-Tag noindex, Referrer-Policy no-referrer. GET·HEAD가 아니면 405(D1을 읽지 않음)", async () => {
  const { env } = setup();
  const created = await createFeed(env);
  const result = await fetchFeed(env, feedPath(created.token));
  assert.equal(result.status, 200);
  assert.deepEqual(result.headers, {
    "cache-control": "no-store",
    "content-type": "text/calendar; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow, noarchive",
  });
  assert.equal("content-disposition" in result.headers, false, "구독은 내려받기 파일이 아님");
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const other = await fetchFeed({ ...env, WORK_DB: null }, feedPath(created.token), { method });
    assert.equal(other.status, 405, method);
    assert.equal(other.headers.allow, "GET, HEAD");
  }
});

test("HEAD는 GET과 같은 상태·헤더를 본문 없이 돌려주고 last_used_at을 쓰지 않는다(없는 주소는 같은 404)", async () => {
  const { database, env, writes } = setup();
  const created = await createFeed(env);
  const head = await fetchFeed(env, feedPath(created.token), { method: "HEAD" });
  const get = await fetchFeed(env, feedPath(created.token), { now: NOW + HOUR });
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
  assert.deepEqual(head.headers, get.headers);
  assert.equal(writes.length, 1, "UPDATE는 GET 한 번뿐");
  assert.equal(rows(database, "SELECT last_used_at FROM calendar_feeds")[0].last_used_at, at(NOW + HOUR));
  const missing = await fetchFeed(env, feedPath("A".repeat(43)), { method: "HEAD" });
  const missingGet = await fetchFeed(env, feedPath("A".repeat(43)));
  assert.equal(missing.status, 404);
  assert.equal(missing.text, "");
  assert.deepEqual(missing.headers, missingGet.headers);
});

test("취소한 거래(status cancelled)의 일정은 끝나지 않았어도 구독에 넣지 않고, 거래를 다시 열면 돌아온다. 그 거래에 걸린 날짜 있는 할 일은 그대로 넣는다", async () => {
  const { database, env } = setup();
  seedSchedule(database);
  const created = await createFeed(env);
  const summaries = async (now) => vevents((await fetchFeed(env, feedPath(created.token), { now })).text).map((item) => item.summary);
  assert.ok((await summaries(NOW)).includes("잔금 · 가상숲 5블록 매매"));
  database.prepare("UPDATE deals SET status = 'cancelled' WHERE id = 'deal-1'").run();
  const cancelled = await summaries(NOW + HOUR);
  assert.equal(cancelled.some((summary) => summary.endsWith("· 가상숲 5블록 매매")), false, "취소한 거래의 일정은 없음");
  assert.ok(cancelled.includes("가상 등기 서류 챙기기"), "할 일은 할 일 화면에서 따로 끝내므로 그대로");
  database.prepare("UPDATE deals SET status = 'contracted' WHERE id = 'deal-1'").run();
  assert.ok((await summaries(NOW + 2 * HOUR)).includes("잔금 · 가상숲 5블록 매매"));
});

test("T3-07 last_used_at은 한국 날짜가 바뀐 뒤 처음 받을 때만 쓴다: 같은 날 몇 분마다 받아도 쓰기 0번(UPDATE 문장도 보내지 않음), 15:00 UTC(한국 자정)를 넘으면 1번", async () => {
  const { database, env, writes } = setup();
  const created = await createFeed(env);
  const usedAt = () => rows(database, "SELECT last_used_at FROM calendar_feeds WHERE id = ?", created.feed.id)[0].last_used_at;
  assert.equal((await fetchFeed(env, feedPath(created.token))).status, 200);
  assert.equal(usedAt(), at(NOW));
  assert.equal(writes.length, 1);
  // 같은 한국 날짜(11-17 14:00 ~ 23:59)에 5분마다 120번
  for (let minute = 5; minute <= 599; minute += 5) {
    assert.equal((await fetchFeed(env, feedPath(created.token), { now: NOW + minute * 60 * 1000 })).status, 200);
  }
  assert.equal(usedAt(), at(NOW), "같은 날은 그대로");
  assert.equal(writes.length, 1, "같은 날은 UPDATE를 보내지 않음");
  const midnight = Date.parse("2026-11-17T15:00:00.000Z"); // 11-18 00:00 한국 시각
  await fetchFeed(env, feedPath(created.token), { now: midnight - 1 });
  assert.equal(writes.length, 1);
  await fetchFeed(env, feedPath(created.token), { now: midnight });
  assert.equal(usedAt(), at(midnight));
  assert.equal(writes.length, 2);
  await fetchFeed(env, feedPath(created.token), { now: midnight + 8 * HOUR });
  assert.equal(writes.length, 2);

  // 다른 요청이 먼저 적었으면(동시에 받음) 조건 UPDATE가 0줄이라 두 번 쓰지 않는다.
  const nextDay = midnight + DAY;
  database.prepare("UPDATE calendar_feeds SET last_used_at = ? WHERE id = ?").run(at(nextDay + 1000), created.feed.id);
  const sql = "UPDATE calendar_feeds SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at < ?)";
  const changes = database.prepare(sql).run(at(nextDay + 2000), created.feed.id, at(nextDay)).changes;
  assert.equal(Number(changes), 0);

  // 받은 날짜를 적지 못해도(쓰기 한도 등) 일정은 보낸다. 로그에는 토큰·주소가 없다.
  const failing = setup();
  const feed = await createFeed(failing.env);
  const prepare = failing.db.prepare;
  failing.db.prepare = (text) => {
    const statement = prepare(text);
    if (!/^UPDATE calendar_feeds SET last_used_at/u.test(text)) return statement;
    return { ...statement, bind: () => ({ run: async () => { throw new Error(`D1 write limit ${feed.token}`); } }) };
  };
  const result = await fetchFeed(failing.env, feedPath(feed.token));
  assert.equal(result.status, 200);
  assert.deepEqual(result.logs, [{ event: "calendar_feed", outcome: "touch_failed", errorName: "Error" }]);
});

test("구독을 읽다 D1이 실패하면 503(Retry-After, 같은 보안 헤더)이고, 로그에는 오류 종류 이름만 남고 토큰·주소·오류 글은 없다", async () => {
  const { env } = setup();
  const created = await createFeed(env);
  const broken = { ...env, WORK_DB: { prepare: () => ({ bind: () => ({ first: async () => { throw new TypeError(`no such column ${created.token}`); } }), first: async () => ({ value_json: "7" }) }), batch: async () => [] } };
  const result = await fetchFeed(broken, feedPath(created.token));
  assert.equal(result.status, 503);
  assert.equal(result.headers["retry-after"], "300");
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.text.includes(created.token), false);
  assert.deepEqual(result.logs, [{ event: "calendar_feed", outcome: "unavailable", errorName: "TypeError" }]);
});

test("T3-09 run_worker_first는 /api/admin·/api/admin/*·/api/calendar/* 세 개뿐이고, Worker는 /api/calendar/ 아래만 구독 처리로 보내며 나머지 공개 경로는 ASSETS가 준다", async () => {
  const raw = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gmu, ""));
  assert.deepEqual(config.assets.run_worker_first, ["/api/admin", "/api/admin/*", "/api/calendar/*"]);
  assert.equal(config.assets.not_found_handling, "404-page", "다른 경로는 정적 404가 주고 Worker로 오지 않음");

  const { env } = setup();
  const created = await createFeed(env);
  const assetCalls = [];
  const withAssets = { ...env, ASSETS: { fetch: async (request) => { assetCalls.push(new URL(request.url).pathname); return new Response("asset"); } } };
  const feed = await handleRequest(new Request(`${ORIGIN}${feedPath(created.token)}`), withAssets);
  assert.equal(feed.status, 200);
  assert.equal(feed.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assert.equal((await handleRequest(new Request(`${ORIGIN}/api/calendar/nothing.ics`), withAssets)).status, 404);
  for (const path of ["/api/calendar", "/api/calendarx/a.ics", "/properties/", "/calendar/a.ics"]) {
    const response = await handleRequest(new Request(`${ORIGIN}${path}`), withAssets);
    assert.equal(await response.text(), "asset", path);
  }
  assert.deepEqual(assetCalls, ["/api/calendar", "/api/calendarx/a.ics", "/properties/", "/calendar/a.ics"]);
});

// ── 거래 없는 일정(0009)을 구독에 싣기(설계서 6.15·12.3절, 테스트 체크리스트 T3-23 ~ T3-27) ─────────────────
// NOW = 2026-11-17 14:00 한국 시각 → 넣는 범위는 2026-10-18(오늘 −30일) ~ 2027-05-16(오늘 +180일).

const appt = async (env, body) => {
  const result = await work(env, "/appointments", { method: "POST", body: { tag: "showing", title: "가상 집 보여 주기", startsOn: "2026-11-20", ...body } });
  assert.equal(result.status, 201, JSON.stringify(result.json));
  return result.json.data.appointment;
};
function veventBlocks(text) {
  return unfold(text).split("BEGIN:VEVENT").slice(1).map((chunk) => {
    const lines = chunk.split("\r\n");
    const value = (name) => lines.find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`)) ?? null;
    return {
      uid: value("UID")?.slice(4) ?? null,
      start: value("DTSTART"),
      end: value("DTEND"),
      summary: value("SUMMARY")?.slice(8) ?? null,
      description: value("DESCRIPTION")?.slice(12) ?? null,
      triggers: lines.filter((line) => line.startsWith("TRIGGER:")).map((line) => line.slice(8)),
    };
  });
}

test("T3-23 거래 없는 일정은 '꼬리표 · 제목', 설명 '직접 넣은 일정', UID appt-<id>-<날짜>로 실리고, 시각 있으면 UTC DTSTART·DTEND와 시작 기준 알림, 하루 종일은 거래 일정과 같은 꼴이다", async () => {
  const { database, env } = setup();
  seedSchedule(database);
  const allDay = await appt(env, {});
  const timed = await appt(env, { tag: "consult", title: "가상 상담 약속", startsOn: "2026-11-18", startTime: "16:00", endTime: "17:00", alarms: ["day-before-18", "hour-before"] });
  const open = await appt(env, { tag: "routine", title: "가상 은행 들르기", startsOn: "2026-11-19", startTime: "10:30", alarms: ["same-day-09"] });
  const early = await appt(env, { tag: "other", title: "가상 이른 약속", startsOn: "2026-11-18", startTime: "08:00", alarms: [] });
  const created = await createFeed(env);
  const result = await fetchFeed(env, feedPath(created.token));
  assert.equal(result.status, 200);
  const byUid = Object.fromEntries(veventBlocks(result.text).map((item) => [item.uid, item]));
  assert.deepEqual(byUid[`appt-${allDay.id}-20261120@leaderscityhappy.com`], {
    uid: `appt-${allDay.id}-20261120@leaderscityhappy.com`, start: "DTSTART;VALUE=DATE:20261120", end: "DTEND;VALUE=DATE:20261121",
    summary: "안내 · 가상 집 보여 주기", description: "직접 넣은 일정", triggers: ["-PT6H"],
  });
  assert.deepEqual(byUid[`appt-${timed.id}-20261118@leaderscityhappy.com`], {
    uid: `appt-${timed.id}-20261118@leaderscityhappy.com`, start: "DTSTART:20261118T070000Z", end: "DTEND:20261118T080000Z",
    summary: "상담 · 가상 상담 약속", description: "직접 넣은 일정", triggers: ["-PT22H", "-PT1H"],
  });
  const openItem = byUid[`appt-${open.id}-20261119@leaderscityhappy.com`];
  assert.deepEqual([openItem.start, openItem.end, openItem.triggers], ["DTSTART:20261119T013000Z", null, ["-PT1H30M"]], "끝 시각이 없으면 DTEND 없음");
  // 08:00 한국 시각은 UTC로 전날 23:00(날짜가 바뀌는 경계)
  assert.equal(byUid[`appt-${early.id}-20261118@leaderscityhappy.com`].start, "DTSTART:20261117T230000Z");
  // 거래 일정·할 일은 예전 그대로(9개), 전체는 날짜 순
  assert.equal(veventBlocks(result.text).filter((item) => !item.uid.startsWith("appt-")).length, 9);
  const dates = veventBlocks(result.text).map((item) => item.start.replace(/^.*:/u, "").slice(0, 8));
  assert.deepEqual(dates, [...dates].sort());
  // 손님 정보는 여전히 없음
  for (const secret of ["가상손님홍길", "01098765432", "가상 비밀 메모 문구"]) assert.equal(unfold(result.text).includes(secret), false);
});

test("T3-24 반복 일정은 오늘 −30일 ~ +180일 안의 날짜마다 실리고(뺀 날·범위 밖 없음), 오늘 전 날에는 알림을 넣지 않으며, 범위 밖 한 번짜리 일정은 없다", async () => {
  const { env } = setup();
  const weekly = await appt(env, { title: "가상 주간 회의", startsOn: "2026-10-01", repeatRule: "weekly" }); // 목요일마다, 끝 없음
  await appt(env, { title: "가상 너무 옛날", startsOn: "2026-10-17" });
  await appt(env, { title: "가상 첫날", startsOn: "2026-10-18" });
  await appt(env, { title: "가상 마지막 날", startsOn: "2027-05-16" });
  await appt(env, { title: "가상 너무 먼 날", startsOn: "2027-05-17" });
  const today = await appt(env, { title: "가상 오늘 약속", startsOn: "2026-11-17", startTime: "16:00", alarms: ["hour-before"] });
  const skipped = await work(env, `/appointments/${weekly.id}`, { method: "DELETE", body: { version: 1, scope: "one", occurrenceOn: "2026-11-26" } });
  assert.equal(skipped.status, 200, JSON.stringify(skipped.json));
  const created = await createFeed(env);
  const items = veventBlocks((await fetchFeed(env, feedPath(created.token))).text);
  const weeklyItems = items.filter((item) => item.uid.startsWith(`appt-${weekly.id}-`));
  const weeklyDates = weeklyItems.map((item) => item.start.slice(-8));
  assert.equal(weeklyDates[0], "20261022", "10-18 뒤 첫 목요일");
  assert.equal(weeklyDates.at(-1), "20270513", "05-16 앞 마지막 목요일");
  assert.equal(weeklyDates.includes("20261126"), false, "'이 날만' 지운 날은 없음");
  assert.equal(weeklyDates.length, 29, "목요일 30번 - 지운 1번");
  for (const item of weeklyItems) {
    assert.deepEqual(item.triggers, item.start.slice(-8) < "20261117" ? [] : ["-PT6H"], item.start);
  }
  // 오늘 날짜(오늘 전 날이 아님)는 알림을 넣는다
  assert.deepEqual(items.find((item) => item.uid.startsWith(`appt-${today.id}-20261117`)).triggers, ["-PT1H"]);
  const titles = items.map((item) => item.summary);
  assert.deepEqual(titles.filter((title) => /너무|첫날|마지막 날/u.test(title)), ["안내 · 가상 첫날", "안내 · 가상 마지막 날"]);
});

test("T3-25 거래 없는 일정은 펼친 뒤 500개까지만(넘으면 먼 미래부터 뺌) 싣고, 거래 일정·할 일 몫(각 500)에는 영향이 없다", async () => {
  const { database, env } = setup();
  seedSchedule(database);
  for (const title of ["가상 매일 하나", "가상 매일 둘", "가상 매일 셋"]) await appt(env, { title, startsOn: "2026-10-01", repeatRule: "daily" }); // 211일 × 3 = 633
  const created = await createFeed(env);
  const items = veventBlocks((await fetchFeed(env, feedPath(created.token))).text);
  const appointments = items.filter((item) => item.uid.startsWith("appt-"));
  assert.equal(appointments.length, 500);
  const dates = appointments.map((item) => item.start.slice(-8));
  assert.equal(dates[0], "20261018");
  assert.ok(dates.at(-1) < "20270516", `먼 미래부터 빠짐: 마지막 ${dates.at(-1)}`);
  assert.equal(items.length - appointments.length, 9, "거래 일정·할 일은 그대로");
});

test("T3-26 시각 일정 .ics 만들기: 시작 기준 알림만(양수·하루 기준 세 값 밖의 글자는 버림), 하루 종일 일정은 예전 세 값 그대로, 시각 꼴이 틀리면 만들지 않는다", async () => {
  const { buildDealIcsCalendar, isAllowedTimedAlarmTriggers, koreaDateTimeToIcs } = await import("../worker/work-calendar.mjs");
  assert.equal(isAllowedTimedAlarmTriggers(["-PT22H", "-PT1H30M"]), true);
  assert.equal(isAllowedTimedAlarmTriggers(["PT0S"]), true, "시작 그때");
  for (const bad of [["PT9H"], ["-PT"], ["-P2DT15H"], ["-PT1H", "-PT1H"], ["-PT1H", "-PT2H", "-PT3H"], [1], "x"]) {
    assert.equal(isAllowedTimedAlarmTriggers(bad), false, JSON.stringify(bad));
  }
  assert.equal(koreaDateTimeToIcs("2026-12-31", "23:30"), "20261231T143000Z");
  assert.equal(koreaDateTimeToIcs("2027-01-01", "00:10"), "20261231T151000Z", "한국 새해 00:10 = UTC 전날");
  assert.throws(() => koreaDateTimeToIcs("2026-11-18", "24:00"));
  const now = new Date(NOW);
  const timedBad = buildDealIcsCalendar({ now, events: [{ uidKey: "appt-a-20261118", date: "2026-11-18", title: "가상", startTime: "16:00", endTime: null, alarmTriggers: ["PT9H"] }] });
  assert.equal(timedBad.includes("BEGIN:VALARM"), false, "시각 일정의 양수 알림은 버림");
  assert.match(timedBad, /\r\nDTSTART:20261118T070000Z\r\nSUMMARY:/u, "끝 시각 null이면 DTEND 없음");
  const allDayTimedTrigger = buildDealIcsCalendar({ now, events: [{ uidKey: "x", date: "2026-11-18", title: "가상", alarmTriggers: ["-PT22H"] }] });
  assert.equal(allDayTimedTrigger.includes("BEGIN:VALARM"), false, "하루 종일 일정은 예전 세 값만");
  assert.throws(() => buildDealIcsCalendar({ now, events: [{ uidKey: "x", date: "2026-11-18", title: "가상", startTime: "4pm" }] }));
});
