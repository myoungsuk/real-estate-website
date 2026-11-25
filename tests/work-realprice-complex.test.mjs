// 단계 P 실거래가 단지 상세 칸 API 시험: GET /work/realprice/complex?apt=&area= 의 면적 목록·최근 거래·직전·앞선 최고·최고가 대비·3개월 건수·
// 36개월 흐름·이 면적 최고·㎡대 최고·최근 거래 목록·세대수·준공 연도·읽기 한도·입력 검사.
// 진짜 SQLite(node:sqlite)에 migrations/work를 적용해 D1처럼 쓴다. 단지 이름·숫자는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REALPRICE_COMPLEX_AREAS_SQL,
  REALPRICE_COMPLEX_ROWS_SQL,
  bandMaxOf,
  pickArea,
  typeMaxOf,
} from "../worker/realprice-complex.mjs";
import { REALPRICE_COMPARABLE_WHERE } from "../worker/realprice-query.mjs";
import { REALPRICE_KINDS, REALPRICE_LAWDS, expectedMonths, kstMonth } from "../worker/realprice-store.mjs";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, freshDb, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const stagePEnv = (db) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY });
const auditCount = (database) => rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n;
const today = iso(NOW).slice(0, 10);
const readNow = (database) => rows(database, "SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?", today)[0]?.rows_read ?? 0;
const setRead = (database, value) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES (?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_read = excluded.rows_read").run(today, value);
const kstToday = new Date(NOW + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const kstYm = kstToday.slice(0, 7);

function markAllMonthsOk(database) {
  const insert = database.prepare("INSERT OR REPLACE INTO rt_fetch_months (lawd_cd, kind, deal_ymd, status, row_count, attempts, last_success_at, next_due_at) VALUES (?, ?, ?, 'ok', 0, 0, ?, ?)");
  for (const lawd of REALPRICE_LAWDS) for (const kind of REALPRICE_KINDS) for (const ymd of expectedMonths(kind, kstMonth(NOW))) insert.run(lawd, kind, ymd, iso(NOW - DAY), iso(NOW + DAY));
}

let keyCounter = 0;
function insertTrade(database, { kind = "sale", date, aptSeq = "A1", cmpSeq, area = 8497, price = 300_000_000, dealing = "broker", cancelled = 0, floor = 10, buildYear = 2020, lawd = "30110" }) {
  keyCounter += 1;
  const ymd = date.slice(0, 4) + date.slice(5, 7);
  const key = `${kind}:${ymd}:${String(keyCounter).padStart(20, "0")}:1`;
  database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at, lawd_cd)
    VALUES (?, ?, ?, ?, '가상동', '1', ?, ?, '가상숲1단지', ?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL, '{}', 1, ?, ?, ?)`).run(
    key, kind, ymd, date, aptSeq, cmpSeq === undefined ? aptSeq : cmpSeq, area, floor, buildYear,
    kind === "rent" ? null : price, kind === "rent" ? 100_000_000 : null, kind === "rent" ? null : dealing, cancelled, iso(NOW - 30 * DAY), iso(NOW - 30 * DAY), lawd,
  );
  return key;
}

const detail = (env, query, options) => work(env, `/realprice/complex?${query}`, options);
const monthsAgo = (count) => {
  const [year, month] = kstYm.split("-").map(Number);
  const index = year * 12 + month - 1 - count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
};

test("단지 상세: 면적 목록(넓이 순)·고른 면적의 최근 거래·직전·앞선 최고·최고가 대비·3개월 건수·36개월 흐름·이 면적 최고·㎡대 최고", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2020-03-10", price: 520_000_000 }); // 36개월 밖 옛 최고: 앞선 최고·이 면적 최고에는 들어감
  insertTrade(database, { date: `${monthsAgo(5)}-03`, price: 470_000_000 });
  insertTrade(database, { date: `${monthsAgo(5)}-20`, price: 480_015_000 }); // 짝수 가운데 값 475,000,000(만 원 내림)
  insertTrade(database, { date: `${monthsAgo(1)}-01`, price: 500_000_000, floor: 12 });
  const latest = insertTrade(database, { date: `${kstYm}-01`, price: 528_840_000, floor: 15 });
  insertTrade(database, { date: `${kstYm}-01`, price: 900_000_000, cancelled: 1 }); // 해제: 최근 목록에만(표시), 최고·흐름 빼고
  insertTrade(database, { date: `${monthsAgo(2)}-05`, price: 880_000_000, dealing: "direct" }); // 직거래: 최근 목록에만
  insertTrade(database, { date: `${monthsAgo(3)}-05`, price: 610_000_000, area: 8498 }); // 84.98㎡: 따로(같은 84㎡대 최고에만)
  insertTrade(database, { date: `${monthsAgo(9)}-05`, price: 700_000_000, area: 5992 });
  insertTrade(database, { date: `${monthsAgo(9)}-06`, price: 999_000_000, aptSeq: "B2" }); // 다른 단지
  insertTrade(database, { kind: "rent", date: `${monthsAgo(1)}-06` }); // 전월세는 보지 않음
  const { status, json, response } = await detail(stagePEnv(db), "apt=A1&area=84.97");
  assert.equal(status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const data = json.data;
  assert.equal(data.available, true);
  assert.deepEqual(data.complex, { aptSeq: "A1", aptName: "가상숲1단지", umdName: "가상동", lawdCd: null, buildYear: 2020, households: null }, "고유번호가 구 코드로 시작하지 않으면 구를 모름(0008)");
  assert.deepEqual(data.areas.map((area) => [area.areaM2, area.tradeCount]), [[59.92, 1], [84.97, 6], [84.98, 1]], "해제는 세지 않고 직거래는 셈");
  const area = data.area;
  assert.equal(area.areaM2, 84.97);
  assert.deepEqual(area.latest, { tradeKey: latest, dealDate: `${kstYm}-01`, floor: 15, priceWon: 528_840_000, dealingGbn: "broker", recordHigh: true });
  assert.deepEqual(area.prev, { dealDate: `${monthsAgo(1)}-01`, floor: 12, priceWon: 500_000_000 });
  assert.equal(area.prevMaxWon, 520_000_000);
  assert.equal(area.ratioPct, 101.7);
  assert.equal(area.ratioSkip, null);
  assert.equal(area.recent3m, 2, "이번 달·지난 두 달의 비교 대상(해제·직거래 빼고)");
  assert.deepEqual([area.typeMaxWon, area.typeMaxDate], [528_840_000, `${kstYm}-01`]);
  assert.deepEqual([area.bandM2, area.bandMaxWon, area.bandTypes], [84, 610_000_000, 2]);
  assert.equal(area.series.length, 36);
  assert.equal(area.series[35].ym, kstYm);
  assert.deepEqual(area.series[30], { ym: monthsAgo(5), medianWon: 475_000_000, count: 2 });
  assert.equal(area.series[33].count, 0, "직거래 달은 흐름에 넣지 않음");
  assert.equal(area.recent.length, 7, "해제·직거래도 목록에");
  assert.deepEqual(area.recent.slice(0, 2).map((item) => item.cancelled).sort(), [false, true]);
  assert.equal(area.recent.find((item) => item.dealingGbn === "direct").recordHigh, false, "직거래는 신고가 판정 안 함");
  assert.deepEqual(data.basis, { months: 36, recentMonths: 3, recentMax: 20 });
  assert.deepEqual([data.recordHighReady, data.warnings], [true, []]);
});

test("단지 상세: 면적을 넣지 않거나 없는 면적이면 가장 늦게 거래된 면적, 매매 자료가 없으면 areas 빈 목록·area null", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-05-01", area: 5992 });
  insertTrade(database, { date: "2026-09-01", area: 8497 });
  const env = stagePEnv(db);
  assert.equal((await detail(env, "apt=A1")).json.data.area.areaM2, 84.97);
  assert.equal((await detail(env, "apt=A1&area=101.5")).json.data.area.areaM2, 84.97);
  assert.equal((await detail(env, "apt=A1&area=59.92")).json.data.area.areaM2, 59.92);
  const none = (await detail(env, "apt=Z9")).json.data;
  assert.deepEqual([none.available, none.complex, none.areas, none.area], [true, null, [], null]);
});

test("단지 상세: 최근 거래가 직거래면 최고가 대비를 내지 않고 까닭 direct, 해제 거래는 최근 거래로 고르지 않음", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-01-01", price: 400_000_000 });
  insertTrade(database, { date: "2026-10-01", price: 450_000_000, dealing: "direct" });
  insertTrade(database, { date: "2026-10-20", price: 999_000_000, cancelled: 1 });
  const area = (await detail(stagePEnv(db), "apt=A1")).json.data.area;
  assert.equal(area.latest.dealDate, "2026-10-01");
  assert.deepEqual([area.prevMaxWon, area.ratioPct, area.ratioSkip, area.latest.recordHigh], [null, null, "direct", false]);
  assert.equal(area.prev.dealDate, "2026-01-01");
});

test("단지 상세: 최근 거래의 앞선 최고는 trades?ids=의 prevMaxWon과 같다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2019-01-10", price: 300_000_000, dealing: null });
  insertTrade(database, { date: "2026-06-01", price: 410_000_000 });
  insertTrade(database, { date: "2026-08-01", price: 400_000_000 });
  const key = insertTrade(database, { date: "2026-08-01", price: 420_000_000 }); // 같은 날 400,000,000은 앞선 최고에 넣지 않음
  const env = stagePEnv(db);
  const trades = await work(env, `/realprice/trades?ids=${key}`);
  const area = (await detail(env, "apt=A1")).json.data.area;
  assert.equal(area.latest.tradeKey, key);
  assert.equal(area.prevMaxWon, trades.json.data.items[0].prevMaxWon);
  assert.equal(area.prevMaxWon, 410_000_000);
});

test("단지 상세: 세대수는 운영자가 홈페이지 단지와 연결한 관심 단지만, 준공 연도가 없으면 null", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  database.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('A1', '가상 단지', 'leaders-city-5', 0, ?)").run(iso(NOW));
  insertTrade(database, { date: "2026-10-01", aptSeq: "A1" });
  insertTrade(database, { date: "2026-10-01", aptSeq: "B2", buildYear: null });
  const env = stagePEnv(db);
  assert.deepEqual([(await detail(env, "apt=A1")).json.data.complex.households, (await detail(env, "apt=A1")).json.data.complex.buildYear], [2135, 2020]);
  assert.deepEqual([(await detail(env, "apt=B2")).json.data.complex.households, (await detail(env, "apt=B2")).json.data.complex.buildYear], [null, null]);
});

test("단지 상세 읽기 한도: 사용량을 더하고 감사 0, 첫 상한·판정 준비 전은 200 + available false(budget·pending), 끝 상한 429", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01" });
  const env = stagePEnv(db);
  const auditBefore = auditCount(database);
  setRead(database, 1_000);
  assert.equal((await detail(env, "apt=A1")).json.data.available, true);
  assert.ok(readNow(database) > 1_000);
  assert.equal(auditCount(database), auditBefore, "보기 요청은 감사 0");

  setRead(database, 6_000_000);
  const soft = await detail(env, "apt=A1");
  assert.deepEqual([soft.status, soft.json.data.available, soft.json.data.reason, soft.json.data.warnings], [200, false, "budget", [{ code: "RT_READ_BUDGET", level: "soft" }]]);
  assert.equal(soft.json.data.area, undefined, "막히면 자료를 읽지 않음");

  setRead(database, 10_000_000);
  const hard = await detail(env, "apt=A1");
  assert.deepEqual([hard.status, hard.json.error.code], [429, "RT_READ_BUDGET"]);
  assert.equal(readNow(database), 10_000_000, "거절한 조회는 더하지 않음");

  setRead(database, 0);
  database.prepare("DELETE FROM rt_fetch_months WHERE lawd_cd = '30110' AND kind = 'sale' AND deal_ymd = '200601'").run();
  const pending = await detail(env, "apt=A1");
  assert.deepEqual([pending.status, pending.json.data.reason, pending.json.data.recordHighReady], [200, "pending", false]);
});

test("단지 상세 입력 검사: apt 없음·형식 틀림·'*'·두 번·area 형식 틀림·다른 매개변수는 400(칸 이름만), GET만, 켜기 값이 없으면 503", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  for (const query of ["", "apt=", "apt=가나", "apt=*", "apt=A1&apt=A2", "apt=A1&area=84.975", "apt=A1&area=0", "apt=A1&area=xyz", "apt=A1&area=84&area=59", "apt=A1&ids=x", "apt=zzzzzzzzzzzzzzzzzzzzzz"]) {
    const result = await detail(env, query);
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], query);
    // 응답의 요청 ID는 무작위 UUID(0-9·a-f·줄표)라, 대조 글자는 UUID에 나올 수 없는 것만 쓴다('abc'는 우연히 들어갈 수 있었음).
    assert.doesNotMatch(JSON.stringify(result.json), /가나|zzzzzzzz|xyz/u, "값을 돌려주지 않음");
  }
  assert.equal((await detail(env, "apt=A1", { method: "POST", body: {} })).status, 405);
  const off = await detail(workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: undefined }), "apt=A1");
  assert.deepEqual([off.status, off.json.error.code], [503, "REALPRICE_DISABLED"]);
});

test("단지 상세 SQL은 부분 색인으로 읽고 표 전체를 훑지 않으며, 면적 목록의 최고가는 신고가와 같은 비교 대상 조건", () => {
  const { database } = freshDb();
  assert.ok(REALPRICE_COMPLEX_AREAS_SQL.includes(REALPRICE_COMPARABLE_WHERE));
  for (const [sql, params] of [[REALPRICE_COMPLEX_AREAS_SQL, ["A1"]], [REALPRICE_COMPLEX_ROWS_SQL, ["A1", 8497, 3001]]]) {
    const plan = rows(database, `EXPLAIN QUERY PLAN ${sql}`, ...params).map((row) => row.detail);
    assert.ok(plan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=?")), plan.join("\n"));
    assert.equal(plan.some((detail) => /^SCAN (rt_trades|p)\b/u.test(detail)), false, plan.join("\n"));
  }
});

test("단지 상세 순수 함수: 고를 면적·이 면적 최고(같은 값이면 늦은 날)·㎡대 최고", () => {
  const areaRows = [
    { area_x100: 5992, trade_count: 3, last_date: "2026-09-01", max_won: 300 },
    { area_x100: 8497, trade_count: 5, last_date: "2026-09-01", max_won: 500 },
    { area_x100: 8498, trade_count: 1, last_date: "2026-01-01", max_won: 700 },
  ];
  assert.equal(pickArea([], null), null);
  assert.equal(pickArea(areaRows, 8498), 8498);
  assert.equal(pickArea(areaRows, null), 8497, "같은 날이면 거래가 많은 쪽");
  assert.deepEqual(typeMaxOf([{ price_won: 5, deal_date: "2026-01-01" }, { price_won: 5, deal_date: "2026-03-01" }, { price_won: null, deal_date: "2026-04-01" }]), { priceWon: 5, dealDate: "2026-03-01" });
  assert.equal(typeMaxOf([]), null);
  assert.deepEqual(bandMaxOf(areaRows, 8497), { bandM2: 84, bandMaxWon: 700, bandTypes: 2 });
  assert.deepEqual(bandMaxOf([{ area_x100: 5992, max_won: null }], 5992), { bandM2: 59, bandMaxWon: null, bandTypes: 1 });
});

test("TK-139 단지 상세의 구는 단지 고유번호 앞 5자리: 서구 단지는 lawdCd 30170, 판정 준비는 그 구만 본다(서구 매매 한 달이 빠지면 서구 단지만 pending)", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: `${monthsAgo(1)}-01`, aptSeq: "30170-77", price: 500_000_000, lawd: "30170" });
  insertTrade(database, { date: `${monthsAgo(1)}-01`, aptSeq: "30110-77", price: 500_000_000 });
  const env = stagePEnv(db);
  const west = await detail(env, "apt=30170-77");
  assert.deepEqual([west.json.data.available, west.json.data.complex.lawdCd, west.json.data.recordHighReady], [true, "30170", true]);
  database.prepare("UPDATE rt_fetch_months SET status = 'pending', last_success_at = NULL WHERE lawd_cd = '30170' AND kind = 'sale' AND deal_ymd = '201005'").run();
  const pending = await detail(env, "apt=30170-77");
  assert.deepEqual([pending.json.data.available, pending.json.data.reason, pending.json.data.recordHighReady], [false, "pending", false]);
  const east = await detail(env, "apt=30110-77");
  assert.deepEqual([east.json.data.available, east.json.data.complex.lawdCd, east.json.data.recordHighReady], [true, "30110", true], "동구 단지는 서구 빠짐과 상관없음");
});
