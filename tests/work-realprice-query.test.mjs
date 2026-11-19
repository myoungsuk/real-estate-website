// 단계 P 실거래가 조회 API 시험(설계서 22.8·22.9절): 목록 trades(신고가·커서·거르기·읽기 예산·isNew), 단지 찾기 complexes, 관심 단지 watch GET·PUT.
// 진짜 SQLite(node:sqlite)에 migrations/work 0001 ~ 0003을 적용해 D1처럼 쓰고, Access JWT는 jose로 서명한다. 자료는 모두 가상이다.
// rows_read는 시험 도구의 흉내 값(돌려준 행 수)이라 실제 읽기 양은 로컬 D1 실측(TK-53)으로 잰다.
import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminApi } from "../worker/admin-api.mjs";
import { createCsrfToken } from "../worker/admin-security.mjs";
import { REALPRICE_COMPLEXES_SQL, REALPRICE_PRIOR_SQL, REALPRICE_TRADES_SQL, decodeTradeCursor, encodeTradeCursor, nextReadBudgetReset, suggestComplexSlug, tradeMonthWindows } from "../worker/realprice-query.mjs";
import { REALPRICE_KINDS, expectedMonths, kstMonth } from "../worker/realprice-store.mjs";
import { createWorkCsrfToken } from "../worker/work-security.mjs";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, ORIGIN, OWNER, SECRET, authenticate, freshDb, nextUuid, rows, signToken, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const CURRENT = kstMonth(NOW); // 202611

const stagePEnv = (db, extra = {}) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY, ...extra });
const auditRows = (database) => rows(database, "SELECT action, outcome, reason FROM audit_events ORDER BY seq");

// 받은 달 기록: 세 종류의 모든 달을 한 번 이상 ok로(신고가 판정 준비 끝).
function markAllMonthsOk(database, nowMs = NOW) {
  const insert = database.prepare("INSERT OR REPLACE INTO rt_fetch_months (kind, deal_ymd, status, row_count, attempts, last_success_at, next_due_at) VALUES (?, ?, 'ok', 0, 0, ?, ?)");
  for (const kind of REALPRICE_KINDS) for (const ymd of expectedMonths(kind, kstMonth(nowMs))) insert.run(kind, ymd, iso(nowMs - DAY), iso(nowMs + DAY));
}

let keyCounter = 0;
// 가상 거래 1건. 거래 ID는 실제 모양({kind}:{YYYYMM}:{20자}:{순번})을 따른다.
function insertTrade(database, {
  kind = "sale", date, aptSeq = "A1", cmpSeq, aptNm = "가상리더스시티5블록", umd = "천동", area = 8497, price = null, deposit = null, rent = null,
  dealing = "broker", cancelled = 0, isBackfill = 1, firstSeenAt = iso(NOW - 30 * DAY), floor = 10,
}) {
  keyCounter += 1;
  const ymd = date.slice(0, 4) + date.slice(5, 7);
  const key = `${kind}:${ymd}:${String(keyCounter).padStart(20, "0")}:1`;
  const won = kind === "rent" ? null : (price ?? 300_000_000);
  database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, ?, 2020, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', ?, ?, ?)`).run(
    key, kind, ymd, date, umd, aptSeq, cmpSeq === undefined ? aptSeq : cmpSeq, aptNm, area, floor,
    won, kind === "rent" ? (deposit ?? 100_000_000) : null, kind === "rent" ? rent : null, kind === "rent" ? null : dealing, cancelled, isBackfill, firstSeenAt, firstSeenAt,
  );
  return key;
}

const trades = (env, query = "", options = {}) => work(env, `/realprice/trades${query}`, options);
const byKey = (json) => Object.fromEntries(json.data.items.map((item) => [item.tradeKey, item]));

// 쓰기 요청(PUT)의 Origin·CSRF를 직접 정한다.
async function rawPut(env, path, { origin = ORIGIN, csrf, body = {} } = {}) {
  const headers = { "Cf-Access-Jwt-Assertion": await signToken(), "Content-Type": "application/json" };
  if (origin) headers.Origin = origin;
  if (csrf !== undefined) headers["X-Admin-CSRF"] = csrf;
  const request = new Request(`${ORIGIN}/api/admin/v1/work${path}`, { method: "PUT", headers, body: JSON.stringify(body) });
  const response = await handleAdminApi(request, env, { authenticate, work: { now: () => NOW, auditLog: () => {}, randomUUID: nextUuid } });
  return { status: response.status, json: await response.json() };
}

test("TK-23 신고가 경계: 앞선 최고가보다 1만 원 높음 true, 같음·낮음 false, 같은 단지·면적의 첫 거래 false, prevMaxWon은 앞선 최고가", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01", area: 8497, price: 490_000_000 });
  insertTrade(database, { date: "2026-09-02", area: 8497, price: 500_000_000 });
  const higher = insertTrade(database, { date: "2026-10-01", area: 8497, price: 500_010_000 });
  insertTrade(database, { date: "2026-09-01", area: 5900, price: 400_000_000 });
  const equal = insertTrade(database, { date: "2026-10-01", area: 5900, price: 400_000_000 });
  insertTrade(database, { date: "2026-09-01", area: 7400, price: 300_000_000 });
  const lower = insertTrade(database, { date: "2026-10-01", area: 7400, price: 299_990_000 });
  const first = insertTrade(database, { date: "2026-10-01", area: 10100, price: 700_000_000 });
  const result = await trades(stagePEnv(db), "?kind=sale");
  assert.equal(result.status, 200);
  assert.equal(result.json.data.recordHighReady, true);
  const items = byKey(result.json);
  assert.deepEqual([items[higher].recordHigh, items[higher].prevMaxWon], [true, 500_000_000]);
  assert.deepEqual([items[equal].recordHigh, items[equal].prevMaxWon], [false, 400_000_000]);
  assert.deepEqual([items[lower].recordHigh, items[lower].prevMaxWon], [false, 300_000_000]);
  assert.deepEqual([items[first].recordHigh, items[first].prevMaxWon], [false, null], "첫 거래는 표시 없음");
  assert.deepEqual(result.json.data.warnings, []);
});

test("TK-24 비교 대상 빼기: 해제·직거래·분양권·다른 면적(8497 대 8496)·다른 단지·같은 계약일은 빠지고 중개 구분 NULL 옛 거래는 들어감", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  const high = 900_000_000;
  insertTrade(database, { date: "2026-09-01", price: high, cancelled: 1 });
  insertTrade(database, { date: "2026-09-02", price: high, dealing: "direct" });
  insertTrade(database, { kind: "presale", date: "2026-09-03", price: high });
  insertTrade(database, { date: "2026-09-04", price: high, area: 8496 });
  insertTrade(database, { date: "2026-09-05", price: high, aptSeq: "A2" });
  insertTrade(database, { date: "2026-10-15", price: high, floor: 3 }); // 같은 계약일
  insertTrade(database, { date: "2008-03-01", price: 450_000_000, dealing: null }); // 중개 구분이 없던 옛 거래
  const target = insertTrade(database, { date: "2026-10-15", price: 500_000_000 });
  const ownCancelled = insertTrade(database, { date: "2026-10-20", price: 999_000_000, cancelled: 1 });
  const ownDirect = insertTrade(database, { date: "2026-10-21", price: 999_000_000, dealing: "direct" });
  const ownPresale = insertTrade(database, { kind: "presale", date: "2026-10-22", price: 999_000_000 });
  const noComplex = insertTrade(database, { date: "2026-10-23", price: 999_000_000, aptSeq: null, cmpSeq: null });
  // 같은 묶음의 더 늦은 거래: 그 사이(10-15 ~ 11-01)의 해제·직거래 9억 9천은 빠지고 10-15의 중개 9억 2건 가운데 최고가 들어감
  const later = insertTrade(database, { date: "2026-11-01", price: 300_000_000 });
  const result = await trades(stagePEnv(db), "?cancelled=include");
  const items = byKey(result.json);
  assert.deepEqual([items[target].recordHigh, items[target].prevMaxWon], [true, 450_000_000], "앞의 여섯 가지는 비교에서 빠짐, NULL 거래는 들어감");
  assert.deepEqual([items[later].recordHigh, items[later].prevMaxWon], [false, 900_000_000], "쪽 안의 앞선 거래도 같은 기준으로 비교");
  for (const [name, key] of [["해제", ownCancelled], ["직거래", ownDirect], ["분양권", ownPresale], ["단지 번호 없음", noComplex]]) {
    assert.deepEqual([items[key].recordHigh, items[key].prevMaxWon], [false, null], `그 거래 자신이 ${name}이면 false`);
  }
});

test("TK-25 앞선 최고가 거래가 나중에 해제되면 다음 조회부터 그다음 최고가로 판정(저장된 판정값 없음)", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  const top = insertTrade(database, { date: "2026-08-01", price: 600_000_000 });
  insertTrade(database, { date: "2026-09-01", price: 550_000_000 });
  const target = insertTrade(database, { date: "2026-10-01", price: 580_000_000 });
  const env = stagePEnv(db);
  const before = byKey((await trades(env)).json)[target];
  assert.deepEqual([before.recordHigh, before.prevMaxWon], [false, 600_000_000]);
  database.prepare("UPDATE rt_trades SET cancelled = 1, cancelled_on = '2026-10-05' WHERE trade_key = ?").run(top);
  const after = byKey((await trades(env)).json)[target];
  assert.deepEqual([after.recordHigh, after.prevMaxWon], [true, 550_000_000]);
});

test("TK-26 매매 2006-01부터 이번 달까지 한 달이라도 받지 못했으면 recordHighReady false, 모든 항목 recordHigh·prevMaxWon null, status에 매매 채우기 진행", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  database.prepare("UPDATE rt_fetch_months SET status = 'pending', last_success_at = NULL WHERE kind = 'sale' AND deal_ymd = '200603'").run();
  insertTrade(database, { date: "2026-09-01", price: 400_000_000 });
  insertTrade(database, { date: "2026-10-01", price: 500_000_000 });
  const env = stagePEnv(db);
  const result = await trades(env);
  assert.equal(result.json.data.recordHighReady, false);
  assert.deepEqual(result.json.data.items.map((item) => [item.recordHigh, item.prevMaxWon]), [[null, null], [null, null]]);
  assert.equal(result.json.data.coverage.saleCoveredThrough, "2006-04", "이번 달부터 거꾸로 빠짐없이 받은 가장 오래된 달");
  const status = await work(env, "/realprice/status");
  const total = expectedMonths("sale", CURRENT).length;
  assert.deepEqual([status.json.data.recordHighReady, status.json.data.backfill.sale], [false, { done: total - 1, total }]);
});

test("TK-27 기간 37개월·limit 101·잘못된 kind·커서·기간 순서·미래 달·면적·가격 거르기는 400 VALIDATION_FAILED(칸 이름만)", async () => {
  const { db } = freshDb();
  const env = stagePEnv(db);
  for (const [query, fields] of [
    ["?from=2023-11&to=2026-11", ["from", "to"]], // 37개월
    ["?limit=101", ["limit"]],
    ["?limit=0", ["limit"]],
    ["?limit=3.5", ["limit"]],
    ["?kind=lease", ["kind"]],
    ["?from=2026-13", ["from"]],
    ["?from=2026-10&to=2026-09", ["from", "to"]],
    ["?to=2026-12", ["from", "to"]], // 이번 달(한국 시각) 뒤
    ["?from=2005-12&to=2006-01", ["from", "to"]], // 2006-01 전
    ["?cursor=not*base64", ["cursor"]],
    [`?cursor=${encodeTradeCursor("2026-10-01", "sale:202610:x:1")}`, ["cursor"]],
    ["?cancelled=only", ["cancelled"]],
    ["?direct=no", ["direct"]],
    ["?watch=true", ["watch"]],
    ["?apt=A1'--", ["apt"]],
    ["?areaMin=84.975", ["areaMin"]],
    ["?areaMin=90&areaMax=80", ["areaMin", "areaMax"]],
    ["?priceMin=-1", ["priceMin"]],
    ["?priceMin=5&priceMax=4", ["priceMin", "priceMax"]],
    [`?umd=${"가".repeat(31)}`, ["umd"]],
  ]) {
    const result = await trades(env, query);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], query);
    assert.equal(JSON.stringify(result.json).includes("base64"), false, "입력값을 되돌려 보이지 않음");
  }
  assert.equal((await trades(env, "?from=2023-12&to=2026-11")).status, 200, "36개월은 됨");
  assert.equal((await trades(env, "?limit=100&unknown=1")).status, 200, "모르는 매개변수는 무시");
  assert.equal((await trades(env, "?kind=&from=&to=&cancelled=&direct=&watch=&apt=&umd=&limit=&cursor=")).status, 200, "빈 값은 기본값");
  assert.deepEqual(decodeTradeCursor(encodeTradeCursor("2026-10-01", `sale:202610:${"a".repeat(20)}:12`)), { dealDate: "2026-10-01", tradeKey: `sale:202610:${"a".repeat(20)}:12` });
});

test("TK-27 기본값은 최근 3개월·해제 빼기, kind=all은 세 종류를 계약일 내림차순으로 합치고 커서로 끝까지 받으면 빠짐·중복 0", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const old = insertTrade(database, { date: "2026-08-31" });
  const cancelled = insertTrade(database, { date: "2026-10-05", cancelled: 1 });
  const expected = [];
  const dates = ["2026-09-01", "2026-09-15", "2026-10-01", "2026-10-01", "2026-11-03", "2026-11-17"];
  for (const [index, date] of dates.entries()) {
    for (const kind of REALPRICE_KINDS) expected.push(insertTrade(database, { kind, date, aptSeq: `B${index % 3}`, price: 100_000_000 + index }));
  }
  const env = stagePEnv(db);
  const first = await trades(env);
  assert.equal(first.status, 200);
  assert.equal(first.response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(first.json.data.coverage, {
    from: "2026-09", to: "2026-11", kinds: ["sale", "presale", "rent"], monthsTotal: 9, monthsDone: 9, pending: [], saleCoveredThrough: "2006-01",
  });
  const keys = first.json.data.items.map((item) => item.tradeKey);
  assert.equal(keys.includes(old), false, "기본 기간은 최근 3개월(2026-09 ~ 2026-11)");
  assert.equal(keys.includes(cancelled), false, "기본은 해제 빼기");
  const order = rows(database, "SELECT trade_key FROM rt_trades WHERE deal_date >= '2026-09-01' AND cancelled = 0 ORDER BY deal_date DESC, trade_key DESC").map((row) => row.trade_key);
  assert.deepEqual(keys, order, "세 종류를 계약일 내림차순(같으면 거래 ID 내림차순)으로 합침");
  assert.deepEqual(new Set(first.json.data.items.map((item) => item.kind)), new Set(REALPRICE_KINDS));

  // 같은 계약일이 여러 건인 경계에서 4건씩 커서로 끝까지 받기.
  const paged = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const result = await trades(env, `?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(result.status, 200);
    assert.ok(result.json.data.items.length <= 4);
    paged.push(...result.json.data.items.map((item) => item.tradeKey));
    cursor = result.json.data.nextCursor;
    if (!cursor) break;
  }
  assert.deepEqual(paged, order, "빠짐·중복 0");
  assert.equal(new Set(paged).size, expected.length);

  const withCancelled = await trades(env, "?from=2026-08&cancelled=include");
  const allKeys = withCancelled.json.data.items.map((item) => item.tradeKey);
  assert.ok(allKeys.includes(old) && allKeys.includes(cancelled));
  assert.equal(withCancelled.json.data.items.find((item) => item.tradeKey === cancelled).cancelled, true);
  const saleOnly = await trades(env, "?kind=sale");
  assert.deepEqual(new Set(saleOnly.json.data.items.map((item) => item.kind)), new Set(["sale"]));
  assert.equal(saleOnly.json.data.coverage.monthsTotal, 3);
});

test("trades 거르기: 단지·법정동·전용면적·금액(전월세는 보증금)·직거래 빼기·관심 단지만, 값은 SQL에 이어 붙이지 않음", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  const a1 = insertTrade(database, { date: "2026-10-01", aptSeq: "A1", umd: "천동", area: 8497, price: 500_000_000 });
  const a2 = insertTrade(database, { date: "2026-10-02", aptSeq: "A2", umd: "신흥동", area: 5900, price: 300_000_000, dealing: "direct" });
  const rent = insertTrade(database, { kind: "rent", date: "2026-10-03", aptSeq: "A2", umd: "신흥동", area: 5900, deposit: 200_000_000, rent: 500_000 });
  const env = stagePEnv(db);
  const keysOf = async (query) => (await trades(env, query)).json.data.items.map((item) => item.tradeKey).sort();
  assert.deepEqual(await keysOf("?apt=A1"), [a1]);
  assert.deepEqual(await keysOf(`?umd=${encodeURIComponent("신흥동")}`), [a2, rent].sort());
  assert.deepEqual(await keysOf(`?umd=${encodeURIComponent("천동' OR 1=1 --")}`), [], "따옴표가 든 값도 값으로만 비교");
  assert.deepEqual(await keysOf("?areaMin=84.97&areaMax=84.97"), [a1], "㎡ 소수 둘째 자리까지");
  assert.deepEqual(await keysOf("?areaMax=60"), [a2, rent].sort());
  assert.deepEqual(await keysOf("?priceMin=200000000&priceMax=300000000"), [a2, rent].sort(), "전월세는 보증금으로 비교");
  assert.deepEqual(await keysOf("?direct=exclude"), [a1, rent].sort(), "직거래 빼기(전월세는 중개 구분 없음)");
  assert.deepEqual(await keysOf("?watch=1"), [], "관심 단지가 없으면 0건");
  database.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('A2', '가상 단지', NULL, 0, ?)").run(iso(NOW));
  assert.deepEqual(await keysOf("?watch=1"), [a2, rent].sort());
  const rentItem = byKey((await trades(env, "?kind=rent")).json)[rent];
  assert.deepEqual([rentItem.priceWon, rentItem.depositWon, rentItem.monthlyRentWon, rentItem.recordHigh, rentItem.areaM2], [null, 200_000_000, 500_000, false, 59]);
});

test("TK-55 isNew: 처음 채우기 행은 최근 달이어도 false, 그 뒤 새 거래는 first_seen_at 7일 안이면 true, 7일이 지나면 false", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  const backfill = insertTrade(database, { date: "2026-11-10", isBackfill: 1, firstSeenAt: iso(NOW - DAY) });
  const fresh = insertTrade(database, { date: "2026-11-11", isBackfill: 0, firstSeenAt: iso(NOW - DAY) });
  const edge = insertTrade(database, { date: "2026-11-12", isBackfill: 0, firstSeenAt: iso(NOW - 7 * DAY) });
  const stale = insertTrade(database, { date: "2026-11-13", isBackfill: 0, firstSeenAt: iso(NOW - 7 * DAY - 1000) });
  const env = stagePEnv(db);
  const items = byKey((await trades(env)).json);
  assert.deepEqual([backfill, fresh, edge, stale].map((key) => items[key].isNew), [false, true, true, false]);
  const later = byKey((await trades(env, "", { now: NOW + 7 * DAY + 1000 })).json);
  assert.equal(later[fresh].isNew, false, "7일이 지나면 false");
});

test("TK-54(API) 읽기 80%는 그대로, 첫 상한은 recordHigh null·warnings soft, 끝 상한은 목록·단지 찾기 429 retryAt(다음 한국 09:00)·갱신 상태·관심 단지 200, UTC 0시 뒤 원래대로", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01", price: 400_000_000 });
  const target = insertTrade(database, { date: "2026-10-01", price: 500_000_000 });
  const env = stagePEnv(db);
  const setRead = (value, day = iso(NOW).slice(0, 10)) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES (?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_read = excluded.rows_read").run(day, value);
  const readNow = () => rows(database, "SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?", iso(NOW).slice(0, 10))[0]?.rows_read ?? 0;

  setRead(1_200_000);
  const near = await trades(env);
  assert.deepEqual([near.status, byKey(near.json)[target].recordHigh, near.json.data.warnings], [200, true, []]);
  // 읽은 양(흉내 값 = 돌려준 행 수)을 더함: 사용량 1 + 받은 달 기록 + 목록 2행 + 신고가 비교 자료 2행(앞선 최고가 1행·사이 거래 1행).
  const monthRows = rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months")[0].n;
  assert.equal(readNow(), 1_200_000 + 1 + monthRows + 2 + 2);

  setRead(1_500_000);
  const soft = await trades(env);
  assert.equal(soft.status, 200);
  assert.deepEqual(soft.json.data.items.map((item) => item.recordHigh), [null, null]);
  assert.equal(soft.json.data.recordHighReady, true, "판정 준비는 끝났지만 읽기 첫 상한이라 계산하지 않음");
  assert.deepEqual(soft.json.data.warnings, [{ code: "RT_READ_BUDGET", level: "soft" }]);

  setRead(2_500_000);
  const auditBefore = auditRows(database).length;
  for (const path of ["/realprice/trades", "/realprice/complexes?q=%EB%A6%AC%EB%8D%94%EC%8A%A4"]) {
    const hard = await work(env, path);
    assert.deepEqual([hard.status, hard.json.error.code, hard.json.error.retryable], [429, "RT_READ_BUDGET", true], path);
    assert.equal(hard.json.error.retryAt, "2026-11-18T00:00:00.000Z", "다음 한국 시각 09:00 = UTC 0시");
    assert.equal(hard.response.headers.get("Retry-After"), String((Date.parse("2026-11-18T00:00:00.000Z") - NOW) / 1000));
    assert.equal(hard.response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(readNow(), 2_500_000, "거절한 조회는 읽기만(사용량 1행) 하고 더하지 않음");
  assert.equal((await work(env, "/realprice/status")).status, 200);
  assert.equal((await work(env, "/realprice/watch")).status, 200);
  assert.equal((await work(env, "/realprice/watch", { method: "PUT", body: { version: 0, items: [] } })).status, 200, "관심 단지 저장도 막지 않음");
  assert.equal(auditRows(database).length, auditBefore + 1, "거절은 감사에 남기지 않음(관심 단지 저장 1건만)");

  const nextDay = Date.parse("2026-11-18T00:00:01.000Z");
  const reset = await trades(env, "", { now: nextDay });
  assert.deepEqual([reset.status, byKey(reset.json)[target].recordHigh], [200, true], "UTC 0시 뒤 새 날짜 행으로 원래대로");
  assert.equal(nextReadBudgetReset(Date.parse("2026-11-17T23:59:59.999Z")), "2026-11-18T00:00:00.000Z");
  assert.equal(nextReadBudgetReset(Date.parse("2026-11-18T00:00:00.000Z")), "2026-11-19T00:00:00.000Z");
});

test("TK-30 보기 요청(trades·status·complexes·watch GET)은 감사 쓰기 0, 응답 Cache-Control: no-store", async () => {
  const { database, db } = freshDb();
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-10-01" });
  const env = stagePEnv(db);
  for (const path of ["/realprice/trades", "/realprice/trades?kind=all&from=2023-12&to=2026-11", "/realprice/status", "/realprice/complexes?q=%EB%A6%AC%EB%8D%94%EC%8A%A4", "/realprice/watch"]) {
    const result = await work(env, path);
    assert.equal(result.status, 200, path);
    assert.equal(result.response.headers.get("Cache-Control"), "no-store", path);
  }
  assert.deepEqual(auditRows(database), []);
});

test("단지 찾기: 띄어쓰기·대소문자 무시, 매매 최근 36개월 범위만, 거래 많은 순, 공개 단지 후보가 하나일 때만 suggestedSlug", async () => {
  const { database, db } = freshDb();
  for (let index = 0; index < 3; index += 1) insertTrade(database, { date: `2026-0${index + 1}-10`, aptSeq: "L5", aptNm: "천동리더스시티5블록" });
  insertTrade(database, { date: "2026-02-10", aptSeq: "L4", aptNm: "천동리더스시티4블록" });
  insertTrade(database, { date: "2026-03-10", aptSeq: "SK", aptNm: "신흥 SK뷰", umd: "신흥동" });
  insertTrade(database, { date: "2026-03-11", aptSeq: "LX", aptNm: "리더스시티" });
  insertTrade(database, { date: "2023-11-30", aptSeq: "OLD", aptNm: "옛리더스시티" }); // 36개월 범위 밖
  insertTrade(database, { kind: "rent", date: "2026-03-12", aptSeq: "RO", aptNm: "전월세리더스" }); // 전월세만 있는 단지는 나오지 않음(설계 선택)
  const env = stagePEnv(db);
  const result = await work(env, `/realprice/complexes?q=${encodeURIComponent(" 리더스 시티 ")}`);
  assert.equal(result.status, 200);
  assert.deepEqual(result.json.data.items.map((item) => [item.aptSeq, item.tradeCount, item.suggestedSlug]), [["L5", 3, "leaders-city-5"], ["L4", 1, "leaders-city-4"], ["LX", 1, null]]);
  assert.deepEqual(result.json.data.items[0], { aptSeq: "L5", aptName: "천동리더스시티5블록", umdName: "천동", tradeCount: 3, lastDealDate: "2026-03-10", suggestedSlug: "leaders-city-5" });
  const sk = await work(env, `/realprice/complexes?q=${encodeURIComponent("sk뷰")}`);
  assert.deepEqual(sk.json.data.items.map((item) => [item.aptSeq, item.suggestedSlug]), [["SK", "sinheung-sk-view"]]);
  for (const query of ["", "?q=", `?q=${encodeURIComponent("   ")}`, `?q=${"가".repeat(31)}`]) {
    const bad = await work(env, `/realprice/complexes${query}`);
    assert.deepEqual([bad.status, bad.json.error.details], [400, ["q"]], query);
  }
  assert.equal(suggestComplexSlug("리더스시티4블록 리더스시티5블록"), null, "후보가 둘이면 고르지 않음");
});

test("TK-28 마이그레이션 직후 첫 관심 단지 PUT(version 0) 성공·감사 같은 batch, 21개·41자·겹침·공개 아닌 단지는 400, 같은 version 두 번째는 409", async () => {
  const { database, db } = freshDb();
  const env = stagePEnv(db);
  assert.deepEqual((await work(env, "/realprice/watch")).json.data, { version: 0, items: [] }, "settings.realprice_watch_version 행이 마이그레이션으로 있음");
  const items = [
    { aptSeq: "L5", displayName: " 리더스시티 5블록 ", complexSlug: "leaders-city-5" },
    { aptSeq: "SK", displayName: "가".repeat(40) },
  ];
  const saved = await work(env, "/realprice/watch", { method: "PUT", body: { version: 0, items } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.json.data, { version: 1, items: [
    { aptSeq: "L5", displayName: "리더스시티 5블록", complexSlug: "leaders-city-5" },
    { aptSeq: "SK", displayName: "가".repeat(40), complexSlug: null },
  ] });
  assert.equal(db.stats.batches.at(-1), 5, "guard·version 올림·지우기·넣기·감사가 한 batch");
  assert.deepEqual(auditRows(database), [{ action: "realprice.watch.update", outcome: "ok", reason: "watch_count=2" }]);

  const snapshot = () => ({ watch: rows(database, "SELECT * FROM rt_watch_complexes ORDER BY sort_order"), version: rows(database, "SELECT value_json FROM settings WHERE key = 'realprice_watch_version'"), audit: auditRows(database).length });
  const before = snapshot();
  for (const [name, body, field] of [
    ["21개", { version: 1, items: Array.from({ length: 21 }, (_, index) => ({ aptSeq: `X${index}`, displayName: "가상" })) }, "items"],
    ["41자", { version: 1, items: [{ aptSeq: "X1", displayName: "가".repeat(41) }] }, "displayName"],
    ["빈 이름", { version: 1, items: [{ aptSeq: "X1", displayName: "  " }] }, "displayName"],
    ["겹침", { version: 1, items: [{ aptSeq: "X1", displayName: "가" }, { aptSeq: "X1", displayName: "나" }] }, "aptSeq"],
    ["공개 아닌 단지", { version: 1, items: [{ aptSeq: "X1", displayName: "가", complexSlug: "draft-complex" }] }, "complexSlug"],
    ["모르는 칸", { version: 1, items: [{ aptSeq: "X1", displayName: "가", memo: "x" }] }, "items"],
    ["version 없음", { items: [] }, "version"],
    ["본문 모르는 키", { version: 1, items: [], extra: 1 }, "body"],
  ]) {
    const result = await work(env, "/realprice/watch", { method: "PUT", body });
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", [field]], name);
  }
  assert.equal((await work(env, "/realprice/watch", { method: "PUT", body: { version: 1, items: Array.from({ length: 20 }, (_, index) => ({ aptSeq: `X${index}`, displayName: "가상" })) } })).status, 200, "20개는 됨");
  const after20 = snapshot();
  assert.notDeepEqual(after20, before);
  const conflict = await work(env, "/realprice/watch", { method: "PUT", body: { version: 1, items: [] } });
  assert.deepEqual([conflict.status, conflict.json.error.code], [409, "VERSION_CONFLICT"], "같은 version(1)으로 두 번째 저장");
  assert.deepEqual(snapshot(), after20, "409는 자료·version·감사 변화 없음");
  const cleared = await work(env, "/realprice/watch", { method: "PUT", body: { version: 2, items: [] } });
  assert.deepEqual([cleared.status, cleared.json.data], [200, { version: 3, items: [] }], "빈 목록으로 저장하면 모두 지움");
  assert.equal(db.stats.batches.at(-1), 4, "넣을 것이 없으면 넣기 문장 없음");
});

test("TK-28 그사이 다른 화면이 먼저 저장하면 guard가 batch 전체를 되돌리고 409", async () => {
  const { database, db } = freshDb();
  const env = stagePEnv(db);
  db.beforeNextBatch = () => database.prepare("UPDATE settings SET value_json = '1' WHERE key = 'realprice_watch_version'").run();
  const result = await work(env, "/realprice/watch", { method: "PUT", body: { version: 0, items: [{ aptSeq: "L5", displayName: "가상" }] } });
  assert.deepEqual([result.status, result.json.error.code], [409, "VERSION_CONFLICT"]);
  assert.deepEqual(rows(database, "SELECT COUNT(*) AS n FROM rt_watch_complexes")[0].n, 0);
  assert.deepEqual(auditRows(database), []);
});

test("TK-06 관심 단지 PUT에 Origin 틀림·CSRF 없음·틀림·콘텐츠 API 토큰이면 403, 신원 있는 거부는 감사 request.denied 1건, 자료 변화 없음", async () => {
  const contentToken = await createCsrfToken(OWNER, SECRET, NOW);
  const workToken = await createWorkCsrfToken(OWNER, SECRET, NOW);
  const body = { version: 0, items: [{ aptSeq: "L5", displayName: "가상" }] };
  for (const [name, options, code] of [
    ["Origin 틀림", { origin: "https://evil.example", csrf: workToken }, "ORIGIN_DENIED"],
    ["Origin 없음", { origin: null, csrf: workToken }, "ORIGIN_DENIED"],
    ["CSRF 없음", {}, "CSRF_INVALID"],
    ["CSRF 틀림", { csrf: `${Math.floor(NOW / 1000)}.AAAA` }, "CSRF_INVALID"],
    ["콘텐츠 API 토큰", { csrf: contentToken }, "CSRF_INVALID"],
  ]) {
    const { database, db } = freshDb();
    const result = await rawPut(stagePEnv(db), "/realprice/watch", { ...options, body });
    assert.deepEqual([result.status, result.json.error.code], [403, code], name);
    assert.deepEqual(auditRows(database), [{ action: "request.denied", outcome: "denied", reason: code }], name);
    assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_watch_complexes")[0].n, 0, `${name}: 자료 변화 없음`);
    assert.equal(rows(database, "SELECT value_json FROM settings WHERE key = 'realprice_watch_version'")[0].value_json, "0", `${name}: version 그대로`);
  }
});

test("조회 경로의 요청 방식: trades·complexes는 GET만, watch는 GET·PUT, 모르는 경로 404", async () => {
  const { db } = freshDb();
  const env = stagePEnv(db);
  for (const [path, method, allow] of [["/realprice/trades", "POST", "GET"], ["/realprice/complexes", "PUT", "GET"], ["/realprice/watch", "DELETE", "GET, PUT"], ["/realprice/watch", "POST", "GET, PUT"]]) {
    const result = await work(env, path, { method, body: {} });
    assert.deepEqual([result.status, result.response.headers.get("Allow")], [405, allow], `${method} ${path}`);
  }
  assert.equal((await work(env, "/realprice/trade")).status, 404);
  const disabled = await work(stagePEnv(db, { WORK_REALPRICE_ENABLED: undefined }), "/realprice/trades");
  assert.deepEqual([disabled.status, disabled.json.error.code], [503, "REALPRICE_DISABLED"]);
});

test("TK-53(달 창) 최근 달부터 1·2·4·8…개월 창으로 읽고 쪽이 차면 멈춤, 커서가 있으면 커서의 달부터", async () => {
  const windows = (query) => tradeMonthWindows({ fromYmd: "202312", toYmd: "202611", cursor: null, ...query });
  assert.deepEqual(windows({}), [["202611", "202611"], ["202609", "202610"], ["202605", "202608"], ["202509", "202604"], ["202405", "202508"], ["202312", "202404"]]);
  assert.deepEqual(windows({ cursor: { dealDate: "2026-10-31", tradeKey: "x" } })[0], ["202610", "202610"]);
  assert.deepEqual(windows({ cursor: { dealDate: "2023-11-30", tradeKey: "x" } }), [], "커서가 기간보다 앞이면 읽지 않음");
  assert.deepEqual(windows({ fromYmd: "202611" }), [["202611", "202611"]]);

  const { database, db } = freshDb();
  markAllMonthsOk(database);
  for (let index = 0; index < 40; index += 1) insertTrade(database, { date: `2026-11-${String(1 + (index % 16)).padStart(2, "0")}` });
  const old = insertTrade(database, { date: "2024-01-05" });
  const env = stagePEnv(db);
  const count = () => db.stats.statements;
  const before = count();
  const recent = await trades(env, "?from=2023-12&to=2026-11");
  assert.equal(recent.json.data.items.length, 30);
  // 구조 번호·사용량 읽기·받은 달 기록·목록 1번(이번 달 창 하나로 쪽이 참)·신고가 비교 자료 1번·사용량 더하기 = 6문장
  assert.equal(count() - before, 6);
  const rentOnly = count();
  await trades(env, "?kind=rent");
  // 전월세 0건: 기본 3개월의 창 2개([11월], [9 ~ 10월])를 다 읽고 비교 자료는 읽지 않음 = 구조 번호·사용량·받은 달·목록 2번·사용량 더하기 6문장
  assert.equal(count() - rentOnly, 6, "판정 대상 매매 행이 없으면 비교 자료를 읽지 않음");
  const sparse = await trades(env, `?from=2023-12&to=2026-11&apt=A1&cursor=${recent.json.data.nextCursor}&limit=100`);
  assert.deepEqual(sparse.json.data.items.at(-1).tradeKey, old, "오래된 창까지 이어 읽음");
  assert.equal(sparse.json.data.items.length, 11);
  assert.equal(sparse.json.data.nextCursor, null);
});

test("TK-53(실행 계획) 목록은 종류별 기본 키 범위 3개로 읽고 표 전체를 훑지 않으며, 신고가 비교 자료는 부분 색인으로 묶음마다 읽음", async () => {
  const { database } = freshDb();
  const params = ["presale:202609:", "presale:202611;", "rent:202609:", "rent:202611;", "sale:202609:", "sale:202611;", 0, 0, null, null, null, null, null, null, 1, null, null, 31];
  const plan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_TRADES_SQL}`, ...params).map((row) => row.detail);
  assert.equal(plan.filter((detail) => detail === "SEARCH rt_trades USING PRIMARY KEY (trade_key>? AND trade_key<?)").length, 3, plan.join("\n"));
  assert.equal(plan.some((detail) => /^SCAN rt_trades\b/u.test(detail)), false, "rt_trades 전체 훑기 없음");
  const priorPlan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_PRIOR_SQL}`, JSON.stringify([["A1", 8497, "2026-10-01", "2026-11-01"]])).map((row) => row.detail);
  assert.ok(priorPlan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=? AND area_x100=? AND deal_date<?)")), priorPlan.join("\n"));
  assert.ok(priorPlan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=? AND area_x100=? AND deal_date>? AND deal_date<?)")), priorPlan.join("\n"));
  assert.equal(priorPlan.some((detail) => /^SCAN (rt_trades|p)\b/u.test(detail)), false, "비교 자료도 표 전체를 훑지 않음");
  const complexPlan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_COMPLEXES_SQL}`, "sale:202312:", "sale:202611;", "리더스", 50).map((row) => row.detail);
  assert.ok(complexPlan.includes("SEARCH rt_trades USING PRIMARY KEY (trade_key>? AND trade_key<?)"), complexPlan.join("\n"));
  assert.equal(complexPlan.some((detail) => /^SCAN rt_trades\b/u.test(detail)), false);
});
