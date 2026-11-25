// 단계 P 실거래가 건수 API 시험: GET /work/realprice/deal-count?apt=&band=&deal= (거래 완료 소식에 단지 이름을 쓸 수 있는지 볼 건수).
// 진짜 SQLite(node:sqlite)에 migrations/work를 적용해 D1처럼 쓴다. 단지 이름·숫자는 모두 가상이고 외부 서비스를 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  REALPRICE_DEAL_COUNT_RENT_SQL,
  REALPRICE_DEAL_COUNT_SALE_SQL,
  dealCountCoveredFrom,
  dealCountWindowMonths,
  parseDealCountQuery,
} from "../worker/realprice-deal-count.mjs";
import { REALPRICE_KINDS, REALPRICE_LAWDS, expectedMonths, kstMonth, saleCoveredThrough } from "../worker/realprice-store.mjs";
import { DEAL_NEWS_MIN_COUNT, dealNewsCountWindow, judgeDealNewsName } from "../src/lib/admin-deal-news.mjs";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, freshDb, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const stagePEnv = (db) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY });
const auditCount = (database) => rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n;
const utcToday = iso(NOW).slice(0, 10);
const readNow = (database) => rows(database, "SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?", utcToday)[0]?.rows_read ?? 0;
const setRead = (database, value) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES (?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_read = excluded.rows_read").run(utcToday, value);
// 시험 시각 NOW = 한국 시각 2026-11-17 14:00 → 세는 구간은 2026-05-17 ~ 2026-11-17(양 끝 포함).
const TODAY = "2026-11-17";
const FROM = "2026-05-17";
const APT = "30110-101"; // 동구 단지(가상)

function markAllMonthsOk(database) {
  const insert = database.prepare("INSERT OR REPLACE INTO rt_fetch_months (lawd_cd, kind, deal_ymd, status, row_count, attempts, last_success_at, next_due_at) VALUES (?, ?, ?, 'ok', 0, 0, ?, ?)");
  for (const lawd of REALPRICE_LAWDS) for (const kind of REALPRICE_KINDS) for (const ymd of expectedMonths(kind, kstMonth(NOW))) insert.run(lawd, kind, ymd, iso(NOW - DAY), iso(NOW + DAY));
}

let keyCounter = 0;
// monthly: 전월세의 월 임대료(0 = 전세). 매매는 쓰지 않는다.
function insertTrade(database, { kind = "sale", date, aptSeq = APT, area = 8497, dealing = "broker", cancelled = 0, monthly = 0, lawd = "30110" }) {
  keyCounter += 1;
  const ymd = date.slice(0, 4) + date.slice(5, 7);
  const key = `${kind}:${ymd}:${String(keyCounter).padStart(20, "0")}:1`;
  const rent = kind === "rent";
  database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at, lawd_cd)
    VALUES (?, ?, ?, ?, '가상동', '1', ?, ?, '가상숲1단지', ?, 10, 2020, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', 1, ?, ?, ?)`).run(
    key, kind, ymd, date, aptSeq, aptSeq, area, rent ? null : 300_000_000, rent ? 100_000_000 : null, rent ? monthly : null, rent ? null : dealing, cancelled,
    iso(NOW - 30 * DAY), iso(NOW - 30 * DAY), lawd,
  );
  return key;
}

const count = (env, query, options) => work(env, `/realprice/deal-count?${query}`, options);
const sale = (env, apt = APT, band = 84) => count(env, `apt=${apt}&band=${band}&deal=sale`);

test("건수(매매): 같은 단지·같은 전용면적대·해제 아닌 매매만 세고 건수 하나만 돌려준다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-07-01" });
  insertTrade(database, { date: "2026-08-15", area: 8400 }); // 84.00㎡: 같은 84㎡대
  insertTrade(database, { date: "2026-09-20", area: 8499 }); // 84.99㎡: 같은 84㎡대
  insertTrade(database, { date: "2026-10-05", dealing: "direct" }); // 직거래도 셈
  insertTrade(database, { date: "2026-10-06", cancelled: 1 }); // 해제: 빼고
  insertTrade(database, { date: "2026-10-07", area: 8399 }); // 83.99㎡: 다른 면적대
  insertTrade(database, { date: "2026-10-08", area: 8500 }); // 85.00㎡: 다른 면적대
  insertTrade(database, { date: "2026-10-09", aptSeq: "30110-102" }); // 다른 단지
  insertTrade(database, { kind: "rent", date: "2026-10-10" }); // 전세: 매매 건수에 섞이지 않음
  insertTrade(database, { kind: "rent", date: "2026-10-11", monthly: 500_000 }); // 월세
  insertTrade(database, { kind: "presale", date: "2026-10-12" }); // 분양권
  const env = stagePEnv(db);
  const auditBefore = auditCount(database);
  const { status, json, response } = await sale(env);
  assert.equal(status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(json.data, {
    available: true,
    count: 4,
    today: TODAY,
    basis: { months: 6, minCount: 3, from: FROM, to: TODAY },
    coverage: { kind: "sale", complete: true, missingMonths: [], sale: { coveredFrom: "2006-01" }, rent: { coveredFrom: "2011-01" } },
    warnings: [],
  });
  assert.doesNotMatch(JSON.stringify(json.data), /300000000|가상숲|가상동|sale:2026|tradeKey|floor|price/u, "금액·단지 이름·동네·거래 ID·층은 돌려주지 않음");
  assert.equal((await sale(env, APT, 83)).json.data.count, 1);
  assert.equal((await sale(env, APT, 85)).json.data.count, 1);
  assert.equal((await sale(env, APT, 59)).json.data.count, 0);
  assert.equal((await sale(env, "30110-102")).json.data.count, 1);
  assert.equal((await sale(env, "30110-999")).json.data.count, 0, "없는 단지는 0건(오류 아님)");
  assert.equal(auditCount(database), auditBefore, "보기 요청은 감사 0");
});

test("건수 구간 경계: 6개월 전 그날과 오늘은 세고, 6개월 하루 밖과 내일 날짜는 세지 않는다(최근 60일을 빼지 않음)", async () => {
  assert.deepEqual(dealNewsCountWindow(TODAY), { from: FROM, to: TODAY });
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  insertTrade(database, { date: "2026-05-16" }); // 6개월 하루 밖
  insertTrade(database, { date: "2026-11-18" }); // 내일 날짜(자료가 잘못 들어온 경우)
  assert.equal((await sale(env)).json.data.count, 0);
  insertTrade(database, { date: FROM }); // 6개월 전 그날: 셈
  assert.equal((await sale(env)).json.data.count, 1);
  insertTrade(database, { date: TODAY }); // 오늘: 셈
  assert.equal((await sale(env)).json.data.count, 2);
  // 6개월 안 3건, 그중 2건이 최근 60일(오늘·40일 전)이어도 3건으로 세어 단지 이름을 쓸 수 있다.
  insertTrade(database, { date: "2026-10-08" });
  const three = (await sale(env)).json.data.count;
  assert.equal(three, DEAL_NEWS_MIN_COUNT);
  assert.equal(judgeDealNewsName({ propertyKind: "apartment", recentCount: three }).canUse, true);
  assert.equal(judgeDealNewsName({ propertyKind: "apartment", recentCount: three - 1 }).canUse, false);
});

test("건수의 오늘은 서버 시계(한국 날짜)로만 정한다: 한국 시각 자정을 넘으면 구간이 하루 옮겨 간다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  insertTrade(database, { date: FROM });
  const beforeMidnight = Date.parse("2026-11-17T14:59:59.000Z"); // 한국 시각 11월 17일 23:59:59
  const afterMidnight = Date.parse("2026-11-17T15:00:00.000Z"); // 한국 시각 11월 18일 00:00:00
  const first = (await count(env, `apt=${APT}&band=84&deal=sale`, { now: beforeMidnight })).json.data;
  const second = (await count(env, `apt=${APT}&band=84&deal=sale`, { now: afterMidnight })).json.data;
  assert.deepEqual([first.today, first.basis.from, first.count], [TODAY, FROM, 1]);
  assert.deepEqual([second.today, second.basis.from, second.basis.to, second.count], ["2026-11-18", "2026-05-18", "2026-11-18", 0]);
  // 기준 날짜를 보내는 입력은 없다(어떤 이름으로 보내도 400).
  for (const extra of ["today=2026-01-01", "date=2026-01-01", "from=2020-01-01", "to=2030-01-01", "months=120", "now=0"]) {
    const result = await count(env, `apt=${APT}&band=84&deal=sale&${extra}`);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", [extra.split("=")[0]]], extra);
  }
});

test("건수(전세·월세): 전세와 월세를 따로 세고 매매·다른 면적대·다른 단지·구간 밖은 섞이지 않는다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  insertTrade(database, { kind: "rent", date: FROM }); // 전세, 경계 그날
  insertTrade(database, { kind: "rent", date: "2026-08-01" });
  insertTrade(database, { kind: "rent", date: TODAY, area: 8412 });
  insertTrade(database, { kind: "rent", date: "2026-05-16" }); // 6개월 하루 밖(같은 달)
  insertTrade(database, { kind: "rent", date: "2026-04-30" }); // 구간 밖 달
  insertTrade(database, { kind: "rent", date: "2026-09-01", monthly: 700_000 }); // 월세
  insertTrade(database, { kind: "rent", date: "2026-09-02", monthly: 10_000 }); // 월세(적은 월 임대료도 월세)
  insertTrade(database, { kind: "rent", date: "2026-09-03", area: 5984, monthly: 700_000 }); // 다른 면적대
  insertTrade(database, { kind: "rent", date: "2026-09-04", aptSeq: "30110-102" }); // 다른 단지
  insertTrade(database, { kind: "rent", date: "2026-09-05", cancelled: 1 }); // 해제 표시가 붙은 행
  insertTrade(database, { date: "2026-09-06" }); // 매매
  const jeonse = (await count(env, `apt=${APT}&band=84&deal=jeonse`)).json.data;
  const monthly = (await count(env, `apt=${APT}&band=84&deal=monthly-rent`)).json.data;
  assert.deepEqual([jeonse.count, jeonse.coverage.kind, jeonse.coverage.complete], [3, "rent", true]);
  assert.deepEqual([monthly.count, monthly.coverage.kind], [2, "rent"]);
  assert.equal((await count(env, `apt=${APT}&band=59&deal=monthly-rent`)).json.data.count, 1);
  assert.equal((await count(env, `apt=${APT}&band=59&deal=jeonse`)).json.data.count, 0);
  assert.equal((await sale(env)).json.data.count, 1);
});

test("건수는 대전 동구 단지만: 다른 구·구를 모르는 단지 번호는 400 RT_REGION_NOT_ALLOWED이고 거래를 읽지 않는다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  insertTrade(database, { date: "2026-09-01", aptSeq: "30170-55", lawd: "30170" }); // 서구 단지
  insertTrade(database, { date: "2026-09-01", aptSeq: "A1" }); // 구 코드로 시작하지 않는 번호
  setRead(database, 0);
  for (const apt of ["30170-55", "30140-1", "30200-1", "30230-1", "A1", "11110-1", "301101", "3011-0101"]) {
    const result = await count(env, `apt=${apt}&band=84&deal=sale`);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "RT_REGION_NOT_ALLOWED", ["apt"]], apt);
    assert.match(result.json.error.message, /대전 동구 단지만/u);
  }
  assert.equal(readNow(database), 0, "거절한 조회는 읽은 행을 더하지 않음");
  // SQL에도 구 조건이 있다: 번호는 동구 꼴인데 행의 구가 다르면 세지 않는다.
  insertTrade(database, { date: "2026-09-02", aptSeq: "30110-777", lawd: "30170" });
  insertTrade(database, { kind: "rent", date: "2026-09-02", aptSeq: "30110-777", lawd: "30170" });
  assert.equal((await sale(env, "30110-777")).json.data.count, 0);
  assert.equal((await count(env, "apt=30110-777&band=84&deal=jeonse")).json.data.count, 0);
});

test("건수 입력 검사: 빠진 값·형식 틀림·범위 밖·두 번 온 값·다른 매개변수는 400(칸 이름만), GET만, 켜기 값이 없으면 503", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  const cases = [
    ["", ["apt"]],
    ["apt=30110-101", ["band"]],
    ["apt=30110-101&band=84", ["deal"]],
    ["band=84&deal=sale", ["apt"]],
    ["apt=&band=84&deal=sale", ["apt"]],
    ["apt=가나&band=84&deal=sale", ["apt"]],
    ["apt=30110-101'%20OR%201=1&band=84&deal=sale", ["apt"]],
    ["apt=30110-zzzzzzzzzzzzzzzzzzzz&band=84&deal=sale", ["apt"]],
    ["apt=30110-101&band=9&deal=sale", ["band"]],
    ["apt=30110-101&band=401&deal=sale", ["band"]],
    ["apt=30110-101&band=84.97&deal=sale", ["band"]],
    ["apt=30110-101&band=084&deal=sale", ["band"]],
    ["apt=30110-101&band=-84&deal=sale", ["band"]],
    ["apt=30110-101&band=xyz&deal=sale", ["band"]],
    ["apt=30110-101&band=84&deal=rent", ["deal"]],
    ["apt=30110-101&band=84&deal=presale", ["deal"]],
    ["apt=30110-101&band=84&deal=매매", ["deal"]],
    ["apt=30110-101&band=xyz&deal=xyz", ["band", "deal"]],
    ["apt=30110-101&apt=30110-102&band=84&deal=sale", ["apt"]],
    ["apt=30110-101&band=84&band=59&deal=sale", ["band"]],
    ["apt=30110-101&band=84&deal=sale&deal=jeonse", ["deal"]],
    ["apt=30110-101&band=84&deal=sale&area=84.97", ["area"]],
    ["apt=30110-101&band=84&deal=sale&lawd=30170", ["lawd"]],
  ];
  for (const [query, fields] of cases) {
    const result = await count(env, query);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], query);
    assert.doesNotMatch(JSON.stringify(result.json), /가나|zzzzzzzz|xyz|OR 1=1/u, "값을 돌려주지 않음");
  }
  assert.equal((await count(env, `apt=${APT}&band=10&deal=sale`)).status, 200);
  assert.equal((await count(env, `apt=${APT}&band=400&deal=sale`)).status, 200);
  for (const method of ["POST", "PUT", "DELETE"]) {
    assert.equal((await count(env, `apt=${APT}&band=84&deal=sale`, { method, body: {} })).status, 405, method);
  }
  const off = await count(workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: undefined }), `apt=${APT}&band=84&deal=sale`);
  assert.deepEqual([off.status, off.json.error.code], [503, "REALPRICE_DISABLED"]);
  assert.deepEqual(parseDealCountQuery(new URLSearchParams(`apt=${APT}&band=84&deal=monthly-rent`)), { apt: APT, band: 84, deal: "monthly-rent", kind: "rent" });
});

test("건수 읽기 한도: 사용량을 더하고, 첫 상한이면 200 + available false(건수 null, 거래를 읽지 않음), 끝 상한이면 429", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01" });
  const env = stagePEnv(db);
  setRead(database, 1_000);
  assert.equal((await sale(env)).json.data.count, 1);
  assert.ok(readNow(database) > 1_000, "읽은 행을 더함");

  setRead(database, 6_000_000);
  const soft = await sale(env);
  assert.deepEqual([soft.status, soft.json.data.available, soft.json.data.reason, soft.json.data.count, soft.json.data.warnings], [200, false, "budget", null, [{ code: "RT_READ_BUDGET", level: "soft" }]]);
  assert.equal(soft.json.data.basis.from, FROM, "막혀도 구간·덮는 범위는 알려 줌");

  setRead(database, 10_000_000);
  const hard = await sale(env);
  assert.deepEqual([hard.status, hard.json.error.code], [429, "RT_READ_BUDGET"]);
  assert.equal(readNow(database), 10_000_000, "거절한 조회는 더하지 않음");
});

test("건수의 덮는 범위: 구간의 달을 못 받았으면 complete false와 빠진 달, 시작 달은 매매·전월세 따로(동구만 봄)", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  const env = stagePEnv(db);
  // 동구 전월세 8월을 아직 못 받음 + 동구 매매 2019년 3월이 빠짐 + 서구 매매 9월이 빠짐(동구 건수와 무관)
  database.prepare("UPDATE rt_fetch_months SET last_success_at = NULL, status = 'pending' WHERE lawd_cd = '30110' AND kind = 'rent' AND deal_ymd = '202608'").run();
  database.prepare("DELETE FROM rt_fetch_months WHERE lawd_cd = '30110' AND kind = 'sale' AND deal_ymd = '201903'").run();
  database.prepare("DELETE FROM rt_fetch_months WHERE lawd_cd = '30170' AND kind = 'sale' AND deal_ymd = '202609'").run();
  const jeonse = (await count(env, `apt=${APT}&band=84&deal=jeonse`)).json.data;
  assert.deepEqual(jeonse.coverage, { kind: "rent", complete: false, missingMonths: ["2026-08"], sale: { coveredFrom: "2019-04" }, rent: { coveredFrom: "2026-09" } });
  assert.equal(jeonse.available, true, "빠진 달이 있어도 건수는 준다(실제보다 적을 수 있음을 complete로 알림)");
  const saleData = (await sale(env)).json.data;
  assert.deepEqual(saleData.coverage, { kind: "sale", complete: true, missingMonths: [], sale: { coveredFrom: "2019-04" }, rent: { coveredFrom: "2026-09" } });

  // 순수 함수: 매매 시작 달은 기존 saleCoveredThrough(동구만)와 같은 값, 이번 달을 못 받았으면 null
  const monthRows = rows(database, "SELECT lawd_cd, kind, deal_ymd, last_success_at FROM rt_fetch_months");
  assert.equal(dealCountCoveredFrom(monthRows, "sale", "202611"), saleCoveredThrough(monthRows, "202611", ["30110"]));
  assert.equal(dealCountCoveredFrom(monthRows.filter((row) => row.deal_ymd !== "202611"), "rent", "202611"), null);
  assert.deepEqual(dealCountWindowMonths(monthRows, "rent", { from: FROM, to: TODAY }), {
    months: ["202605", "202606", "202607", "202608", "202609", "202610", "202611"],
    missing: ["202608"],
  });
});

test("건수 SQL: 매매는 부분 색인, 전월세는 기본 키 범위로 읽고(표 전체를 훑지 않음) 입력은 모두 bind 자리로만 들어간다", () => {
  const { database } = freshDb();
  const salePlan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_DEAL_COUNT_SALE_SQL}`, APT, 8400, 8500, FROM, TODAY, "30110").map((row) => row.detail);
  assert.ok(salePlan.some((detail) => detail.startsWith("SEARCH p USING INDEX idx_rt_trades_sale_group (cmp_seq=? AND area_x100>? AND area_x100<?")), salePlan.join("\n"));
  const rentPlan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_DEAL_COUNT_RENT_SQL}`, "rent:202605:", "rent:202611;", APT, 8400, 8500, FROM, TODAY, "30110", 0).map((row) => row.detail);
  assert.ok(rentPlan.some((detail) => detail.startsWith("SEARCH p USING PRIMARY KEY (trade_key>? AND trade_key<?")), rentPlan.join("\n"));
  for (const plan of [salePlan, rentPlan]) assert.equal(plan.some((detail) => /^SCAN (rt_trades|p)\b/u.test(detail)), false, plan.join("\n"));
  // SQL 글자에는 입력값이 들어갈 자리가 ?n뿐이다(문자열 이어 붙이기 없음). 고정 글자는 kind 둘뿐.
  for (const sql of [REALPRICE_DEAL_COUNT_SALE_SQL, REALPRICE_DEAL_COUNT_RENT_SQL]) {
    assert.deepEqual(sql.match(/'[^']*'/gu), [sql === REALPRICE_DEAL_COUNT_SALE_SQL ? "'sale'" : "'rent'"]);
    assert.doesNotMatch(sql, /\$\{/u);
    assert.match(sql, /p\.cancelled = 0/u);
    assert.match(sql, /p\.lawd_cd = \?/u);
    assert.match(sql, /^SELECT COUNT\(\*\) AS n FROM rt_trades p/u, "건수만 읽음(금액·동·층 칸을 고르지 않음)");
  }
});
