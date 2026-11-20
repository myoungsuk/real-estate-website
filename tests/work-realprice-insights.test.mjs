// 단계 P 실거래가 거래 흐름 API 시험(보드 63번): GET /work/realprice/insights?ids= 의 흐름선(12개월 월별 가운데 값)·직전 거래·앞선 최고·최고가 대비·3개월 건수·세대수.
// 진짜 SQLite(node:sqlite)에 migrations/work를 적용해 D1처럼 쓴다. 단지 이름·숫자는 모두 가상이다.
// rows_read는 시험 도구의 흉내 값(돌려준 행 수)이라 실제 읽기 양은 로컬 D1 실측으로 잰다.
import test from "node:test";
import assert from "node:assert/strict";
import { REALPRICE_INSIGHTS_SQL, insightGroups, medianWon, ratioPct } from "../worker/realprice-insights.mjs";
import { REALPRICE_COMPARABLE_WHERE, REALPRICE_PRIOR_SQL } from "../worker/realprice-query.mjs";
import { REALPRICE_KINDS, expectedMonths, kstMonth } from "../worker/realprice-store.mjs";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, freshDb, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const stagePEnv = (db) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY });
const auditCount = (database) => rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n;
const today = iso(NOW).slice(0, 10);
const readNow = (database) => rows(database, "SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?", today)[0]?.rows_read ?? 0;
const setRead = (database, value) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES (?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_read = excluded.rows_read").run(today, value);

function markAllMonthsOk(database) {
  const insert = database.prepare("INSERT OR REPLACE INTO rt_fetch_months (kind, deal_ymd, status, row_count, attempts, last_success_at, next_due_at) VALUES (?, ?, 'ok', 0, 0, ?, ?)");
  for (const kind of REALPRICE_KINDS) for (const ymd of expectedMonths(kind, kstMonth(NOW))) insert.run(kind, ymd, iso(NOW - DAY), iso(NOW + DAY));
}

let keyCounter = 0;
function insertTrade(database, { kind = "sale", date, aptSeq = "A1", cmpSeq, area = 8497, price = 300_000_000, dealing = "broker", cancelled = 0, floor = 10 }) {
  keyCounter += 1;
  const ymd = date.slice(0, 4) + date.slice(5, 7);
  const key = `${kind}:${ymd}:${String(keyCounter).padStart(20, "0")}:1`;
  database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at)
    VALUES (?, ?, ?, ?, '가상동', '1', ?, ?, '가상숲1단지', ?, ?, 2020, ?, ?, NULL, ?, ?, NULL, NULL, NULL, '{}', 1, ?, ?)`).run(
    key, kind, ymd, date, aptSeq, cmpSeq === undefined ? aptSeq : cmpSeq, area, floor,
    kind === "rent" ? null : price, kind === "rent" ? 100_000_000 : null, kind === "rent" ? null : dealing, cancelled, iso(NOW - 30 * DAY), iso(NOW - 30 * DAY),
  );
  return key;
}

const insights = (env, ids, options) => work(env, `/realprice/insights?ids=${ids.join(",")}`, options);
const itemOf = (json, key) => json.data.items.find((item) => item.tradeKey === key);

test("63 거래 흐름: 12개월 월별 가운데 값(빈 달 null·짝수는 만 원 내림)·직전 거래·앞선 최고·최고가 대비·3개월 건수", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2024-03-10", price: 520_000_000 }); // 창 밖 옛 최고
  insertTrade(database, { date: "2025-12-05", price: 450_000_000 }); // 창 앞(2025-12-01 시작 전이 아님: 창 안 첫 달)
  insertTrade(database, { date: "2026-02-03", price: 470_000_000 });
  insertTrade(database, { date: "2026-02-20", price: 480_015_000 }); // 짝수: (470,000,000 + 480,015,000) / 2 = 475,007,500 → 475,000,000
  insertTrade(database, { date: "2026-09-01", price: 490_000_000, floor: 7 });
  insertTrade(database, { date: "2026-10-01", price: 500_000_000, floor: 12 });
  const target = insertTrade(database, { date: "2026-11-10", price: 528_840_000, floor: 15 });
  insertTrade(database, { date: "2026-11-10", price: 600_000_000 }); // 같은 날: 앞선 최고·직전에 넣지 않지만 그 달 흐름·3개월에는 넣음
  insertTrade(database, { date: "2026-11-12", price: 700_000_000 }); // 계약일 뒤: 아무 데도 넣지 않음
  const { status, json } = await insights(stagePEnv(db), [target]);
  assert.equal(status, 200);
  const item = itemOf(json, target);
  assert.equal(item.available, true);
  assert.equal(item.series.length, 12);
  assert.deepEqual(item.series[0], { ym: "2025-12", medianWon: 450_000_000, count: 1 });
  assert.deepEqual(item.series[2], { ym: "2026-02", medianWon: 475_000_000, count: 2 });
  assert.deepEqual(item.series[5], { ym: "2026-05", medianWon: null, count: 0 }, "빈 달은 null");
  assert.deepEqual(item.series[11], { ym: "2026-11", medianWon: (528_840_000 + 600_000_000) / 2, count: 2 });
  assert.deepEqual(item.prev, { dealDate: "2026-10-01", floor: 12, priceWon: 500_000_000 });
  assert.equal(item.prevMaxWon, 520_000_000, "창 밖 옛 거래도 앞선 최고에 들어감");
  assert.equal(item.ratioPct, 101.7);
  assert.equal(item.recent3m, 4, "9·10·11월(계약일까지, 자기 포함)");
  assert.equal(item.households, null, "연결한 단지가 없으면 세대수 없음");
  assert.deepEqual(json.data.basis, { months: 12, recentMonths: 3 });
  assert.deepEqual([json.data.missing, json.data.recordHighReady, json.data.warnings], [[], true, []]);
});

test("63 앞선 최고는 신고가(trades?ids=)의 prevMaxWon과 같다: 같은 조건 문자열·같은 계산 함수, 해제·직거래·다른 면적·다른 단지 빼고 중개 구분 NULL은 넣음", async () => {
  assert.ok(REALPRICE_PRIOR_SQL.includes(REALPRICE_COMPARABLE_WHERE));
  assert.equal(REALPRICE_INSIGHTS_SQL.split(REALPRICE_COMPARABLE_WHERE).length - 1, 3, "흐름 SQL의 세 부분이 모두 같은 조건");
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2020-01-10", price: 300_000_000, dealing: null }); // 중개 구분 없던 옛 자료: 넣음
  insertTrade(database, { date: "2026-06-01", price: 900_000_000, cancelled: 1 });
  insertTrade(database, { date: "2026-06-02", price: 880_000_000, dealing: "direct" });
  insertTrade(database, { date: "2026-06-03", price: 870_000_000, area: 8498 }); // 84.98㎡는 따로
  insertTrade(database, { date: "2026-06-04", price: 860_000_000, aptSeq: "B2" });
  insertTrade(database, { date: "2026-06-05", price: 860_000_000, cmpSeq: "*" });
  const keys = [
    insertTrade(database, { date: "2026-07-01", price: 410_000_000 }),
    insertTrade(database, { date: "2026-08-01", price: 400_000_000 }),
    insertTrade(database, { date: "2026-11-01", price: 420_000_000 }),
    insertTrade(database, { date: "2026-11-01", price: 430_000_000, area: 8498 }),
  ];
  const env = stagePEnv(db);
  const trades = await work(env, `/realprice/trades?ids=${keys.join(",")}`);
  const flow = await insights(env, keys);
  for (const key of keys) {
    const trade = trades.json.data.items.find((item) => item.tradeKey === key);
    assert.equal(itemOf(flow.json, key).prevMaxWon, trade.prevMaxWon, key);
  }
  assert.deepEqual(keys.map((key) => itemOf(flow.json, key).prevMaxWon), [300_000_000, 410_000_000, 410_000_000, 870_000_000]);
  assert.equal(itemOf(flow.json, keys[0]).prev.dealDate, "2020-01-10", "12개월보다 오래된 직전 거래도 찾음");
});

test("63 첫 거래·판정하지 않는 거래: 첫 거래는 prev·prevMaxWon·ratioPct null, 전월세·분양권·해제·직거래·단지 번호 없음은 available false와 까닭", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const first = insertTrade(database, { date: "2026-10-01", price: 400_000_000, area: 10100 });
  const rent = insertTrade(database, { kind: "rent", date: "2026-10-02" });
  const presale = insertTrade(database, { kind: "presale", date: "2026-10-03" });
  const cancelled = insertTrade(database, { date: "2026-10-04", cancelled: 1 });
  const direct = insertTrade(database, { date: "2026-10-05", dealing: "direct" });
  const noComplex = insertTrade(database, { date: "2026-10-06", cmpSeq: null });
  const unknown = "sale:202610:ffffffffffffffffffff:1";
  const { json } = await insights(stagePEnv(db), [first, rent, presale, cancelled, direct, noComplex, unknown]);
  const firstItem = itemOf(json, first);
  assert.deepEqual([firstItem.prev, firstItem.prevMaxWon, firstItem.ratioPct, firstItem.recent3m], [null, null, null, 1]);
  assert.equal(firstItem.series.filter((month) => month.count > 0).length, 1);
  assert.deepEqual(
    [rent, presale, cancelled, direct, noComplex].map((key) => [itemOf(json, key).available, itemOf(json, key).reason]),
    [[false, "not_sale"], [false, "not_sale"], [false, "cancelled"], [false, "direct"], [false, "no_complex"]],
  );
  assert.deepEqual(json.data.missing, [unknown]);
});

test("63 세대수: 관심 단지에서 운영자가 홈페이지 단지와 연결한 단지만 '규모'의 세대수, 연결이 없으면 null", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  database.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('A1', '가상 단지', 'leaders-city-5', 0, ?)").run(iso(NOW));
  database.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('B2', '가상 단지 2', NULL, 1, ?)").run(iso(NOW));
  const linked = insertTrade(database, { date: "2026-10-01", aptSeq: "A1" });
  const unlinked = insertTrade(database, { date: "2026-10-01", aptSeq: "B2" });
  const notWatched = insertTrade(database, { date: "2026-10-01", aptSeq: "C3" });
  const { json } = await insights(stagePEnv(db), [linked, unlinked, notWatched]);
  assert.deepEqual([linked, unlinked, notWatched].map((key) => itemOf(json, key).households), [2135, null, null]);
});

test("63 읽기 한도: 사용량은 rt_daily_usage에 더하고 감사 0, 첫 상한·판정 준비 전은 200 + available false(budget·pending), 끝 상한 429", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01", price: 400_000_000 });
  const key = insertTrade(database, { date: "2026-10-01", price: 410_000_000 });
  const env = stagePEnv(db);
  const auditBefore = auditCount(database);
  setRead(database, 1_000);
  const ok = await insights(env, [key]);
  assert.equal(ok.json.data.items[0].available, true);
  assert.ok(readNow(database) > 1_000, "읽은 행을 더함");
  assert.equal(auditCount(database), auditBefore, "보기 요청은 감사 0");
  assert.equal(ok.response.headers.get("Cache-Control"), "no-store");

  setRead(database, 1_500_000);
  const soft = await insights(env, [key]);
  assert.deepEqual([soft.status, soft.json.data.items[0], soft.json.data.warnings], [200, { tradeKey: key, available: false, reason: "budget" }, [{ code: "RT_READ_BUDGET", level: "soft" }]]);

  setRead(database, 2_500_000);
  const hard = await insights(env, [key]);
  assert.deepEqual([hard.status, hard.json.error.code], [429, "RT_READ_BUDGET"]);
  assert.equal(readNow(database), 2_500_000, "거절한 조회는 더하지 않음");

  setRead(database, 0);
  database.prepare("DELETE FROM rt_fetch_months WHERE kind = 'sale' AND deal_ymd = '200601'").run();
  const pending = await insights(env, [key]);
  assert.deepEqual([pending.status, pending.json.data.items[0].reason, pending.json.data.recordHighReady], [200, "pending", false]);
});

test("63 ids 검사: 빈 값·형식 틀림·31개·ids 두 번·다른 매개변수는 400 VALIDATION_FAILED(칸 이름만), GET만", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  const key = "sale:202610:00000000000000000001:1";
  const many = Array.from({ length: 31 }, (_, index) => `sale:202610:${String(index).padStart(20, "0")}:1`).join(",");
  for (const query of ["", "?ids=", "?ids=zz", `?ids=${key},`, `?ids=${many}`, `?ids=${key}&ids=${key}`, `?ids=${key}&kind=sale`, "?kind=sale"]) {
    const result = await work(env, `/realprice/insights${query}`);
    assert.deepEqual([result.status, result.json.error.code], [400, "VALIDATION_FAILED"], query);
    assert.doesNotMatch(JSON.stringify(result.json), /zz|00000000000000000001/u, "값을 돌려주지 않음");
  }
  const thirty = await work(env, `/realprice/insights?ids=${many.split(",").slice(0, 30).join(",")}`);
  assert.deepEqual([thirty.status, thirty.json.data.missing.length], [200, 30]);
  const post = await work(env, `/realprice/insights?ids=${key}`, { method: "POST", body: {} });
  assert.equal(post.status, 405);
});

test("63 흐름 SQL은 부분 색인으로 묶음마다 읽고 표 전체를 훑지 않으며, 묶음은 단지·면적마다 가장 이른 창 시작과 가장 늦은 계약일", () => {
  const { database } = freshDb();
  const plan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_INSIGHTS_SQL}`, JSON.stringify([["A1", 8497, "2025-12-01", "2026-11-10"]])).map((row) => row.detail);
  assert.ok(plan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=? AND area_x100=? AND deal_date<?)")), plan.join("\n"));
  assert.ok(plan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=? AND area_x100=? AND deal_date>? AND deal_date<?)")), plan.join("\n"));
  assert.equal(plan.some((detail) => /^SCAN (rt_trades|p|t)\b/u.test(detail)), false, plan.join("\n"));
  const groups = insightGroups([
    { cmp_seq: "A1", area_x100: 8497, deal_date: "2026-11-10" },
    { cmp_seq: "A1", area_x100: 8497, deal_date: "2026-03-02" },
    { cmp_seq: "A1", area_x100: 8498, deal_date: "2026-01-31" },
  ]);
  assert.deepEqual(groups, [["A1", 8497, "2025-04-01", "2026-11-10"], ["A1", 8498, "2025-02-01", "2026-01-31"]]);
});

test("63 가운데 값·최고가 대비 계산", () => {
  assert.equal(medianWon([]), null);
  assert.equal(medianWon([3, 1, 2]), 2);
  assert.equal(medianWon([400_000_000, 410_005_000]), 405_000_000);
  assert.equal(ratioPct(528_840_000, 520_000_000), 101.7);
  assert.equal(ratioPct(500_000_000, 500_000_000), 100);
  assert.equal(ratioPct(500_000_000, null), null);
});
