// 단계 P 실거래가: 거래 완료 소식의 단지 찾기 GET /work/realprice/deal-complexes?q= 시험(매매·전세·월세 자료를 함께 찾음).
// 진짜 SQLite(node:sqlite)에 migrations/work를 적용해 D1처럼 쓴다. 단지 이름·숫자는 모두 가상이고 외부 서비스를 부르지 않는다.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAL_COMPLEX_GROUP_MAX,
  DEAL_COMPLEX_RESULT_MAX,
  REALPRICE_DEAL_COMPLEXES_SQL,
  dealNewsSearchRanges,
  groupDealComplexRows,
} from "../worker/realprice-deal-count.mjs";
import { REALPRICE_KINDS, REALPRICE_LAWDS, expectedMonths, kstMonth } from "../worker/realprice-store.mjs";
import { dealNewsCountWindow } from "../src/lib/admin-deal-news.mjs";
import { FAKE_SERVICE_KEY } from "./realprice-fixtures.mjs";
import { NOW, freshDb, rows, work, workEnv } from "./work-test-kit.mjs";

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const stagePEnv = (db) => workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY });
const auditCount = (database) => rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n;
const utcToday = iso(NOW).slice(0, 10);
const readNow = (database) => rows(database, "SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?", utcToday)[0]?.rows_read ?? 0;
const setRead = (database, value) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_read) VALUES (?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_read = excluded.rows_read").run(utcToday, value);
// 시험 시각 NOW = 한국 시각 2026-11-17 14:00 → 찾는 구간은 2026-05-17 ~ 2026-11-17(건수 구간과 같음).
const TODAY = "2026-11-17";
const FROM = "2026-05-17";

function markAllMonthsOk(database) {
  const insert = database.prepare("INSERT OR REPLACE INTO rt_fetch_months (lawd_cd, kind, deal_ymd, status, row_count, attempts, last_success_at, next_due_at) VALUES (?, ?, ?, 'ok', 0, 0, ?, ?)");
  for (const lawd of REALPRICE_LAWDS) for (const kind of REALPRICE_KINDS) for (const ymd of expectedMonths(kind, kstMonth(NOW))) insert.run(lawd, kind, ymd, iso(NOW - DAY), iso(NOW + DAY));
}

let keyCounter = 0;
function insertTrade(database, { kind = "sale", date, aptSeq = "30110-101", name = "가상숲1단지", umd = "가상동", area = 8497, cancelled = 0, monthly = 0, lawd = "30110" }) {
  keyCounter += 1;
  const ymd = date.slice(0, 4) + date.slice(5, 7);
  const key = `${kind}:${ymd}:${String(keyCounter).padStart(20, "0")}:1`;
  const rent = kind === "rent";
  database.prepare(`INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
    price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, updated_at, lawd_cd)
    VALUES (?, ?, ?, ?, ?, '1', ?, ?, ?, ?, 10, 2020, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', 1, ?, ?, ?)`).run(
    key, kind, ymd, date, umd, aptSeq, aptSeq, name, area, rent ? null : 300_000_000, rent ? 100_000_000 : null, rent ? monthly : null, rent ? null : "broker", cancelled,
    iso(NOW - 30 * DAY), iso(NOW - 30 * DAY), lawd,
  );
}

const find = (env, query, options) => work(env, `/realprice/deal-complexes?${query}`, options);

test("단지 찾기: 매매·전세·월세 자료를 함께 찾고, 거래 종류마다 면적대 목록만 돌려준다(건수·금액·동·층·거래 ID 없음)", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-07-01", area: 8497 });
  insertTrade(database, { date: "2026-08-01", area: 8400 }); // 같은 84㎡대: 한 번만
  insertTrade(database, { date: "2026-08-02", area: 5999 });
  insertTrade(database, { kind: "rent", date: "2026-09-01", area: 5912 }); // 전세 59
  insertTrade(database, { kind: "rent", date: "2026-09-02", area: 7400, monthly: 500_000 }); // 월세 74
  insertTrade(database, { date: "2026-09-03", area: 11400, cancelled: 1 }); // 해제: 빼고
  insertTrade(database, { kind: "presale", date: "2026-09-04", area: 10100 }); // 분양권: 빼고
  insertTrade(database, { date: "2026-05-16", area: 13500 }); // 구간 하루 밖: 빼고
  // 전월세만 있는 단지(매매 없음)도 찾는다. 이름은 가장 최근 계약의 값.
  insertTrade(database, { kind: "rent", date: "2026-06-01", aptSeq: "30110-202", name: "가상숲2단지(옛 이름)", umd: "나무동", area: 4500 });
  insertTrade(database, { kind: "rent", date: "2026-10-01", aptSeq: "30110-202", name: "가상숲 2단지(123-4)", umd: "나무동", area: 4510, monthly: 300_000 });
  // 동구가 아닌 단지·이름이 다른 단지는 빼고
  insertTrade(database, { date: "2026-09-05", aptSeq: "30170-303", name: "가상숲3단지", lawd: "30170" });
  insertTrade(database, { date: "2026-09-06", aptSeq: "30110-404", name: "다른마을" });
  const env = stagePEnv(db);
  const auditBefore = auditCount(database);
  const { status, json, response } = await find(env, `q=${encodeURIComponent("가상 숲")}`);
  assert.equal(status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(json.data, {
    available: true,
    items: [
      { aptSeq: "30110-202", aptName: "가상숲 2단지(123-4)", umdName: "나무동", bands: { sale: [], jeonse: [45], "monthly-rent": [45] } },
      { aptSeq: "30110-101", aptName: "가상숲1단지", umdName: "가상동", bands: { sale: [59, 84], jeonse: [59], "monthly-rent": [74] } },
    ],
    basis: { from: FROM, to: TODAY },
    warnings: [],
  });
  assert.doesNotMatch(JSON.stringify(json.data), /300000000|100000000|count|tradeKey|floor|price|deposit|sale:2026|rent:2026/u);
  assert.equal(auditCount(database), auditBefore, "보기 요청은 감사 0");
  assert.ok(readNow(database) > 0, "읽은 행을 더함");
  assert.deepEqual((await find(env, "q=없는이름")).json.data.items, []);
});

test("단지 찾기 범위는 한 곳(dealNewsSearchRanges): 건수 구간의 달을 매매·전월세 기본 키 범위로 읽는다", () => {
  const window = dealNewsCountWindow(TODAY);
  assert.deepEqual(dealNewsSearchRanges(window), {
    from: FROM,
    to: TODAY,
    ranges: [["sale:202605:", "sale:202611;"], ["rent:202605:", "rent:202611;"]],
  });
  const { database } = freshDb();
  const plan = rows(database, `EXPLAIN QUERY PLAN ${REALPRICE_DEAL_COMPLEXES_SQL}`, "sale:202605:", "sale:202611;", "rent:202605:", "rent:202611;", "30110", FROM, TODAY, "가상", 400).map((row) => row.detail);
  assert.equal(plan.some((detail) => /^SCAN rt_trades\b/u.test(detail)), false, plan.join("\n"));
  assert.ok(plan.some((detail) => /USING (PRIMARY KEY|INDEX)/u.test(detail)), plan.join("\n"));
  assert.doesNotMatch(REALPRICE_DEAL_COMPLEXES_SQL, /\$\{|price_won|deposit_won|floor|trade_key AS|COUNT\(/u, "금액·층·거래 ID·건수를 고르지 않고 입력은 bind 자리로만");
  assert.match(REALPRICE_DEAL_COMPLEXES_SQL, /cancelled = 0/u);
  assert.match(REALPRICE_DEAL_COMPLEXES_SQL, /lawd_cd = \?5/u);
});

test("단지 찾기 묶기: 면적대 10 ~ 400만(남는 면적대가 없는 단지는 뺌), 최근 계약이 늦은 단지부터, 30곳을 넘거나 묶음 상한이면 RT_DEAL_COMPLEXES_PARTIAL", async () => {
  const grouped = groupDealComplexRows([
    { apt_seq: "30110-1", apt_nm: "가", umd_nm: "천동", deal: "sale", band: 9, last_deal_date: "2026-10-01" },
    { apt_seq: "30110-1", apt_nm: "가", umd_nm: "천동", deal: "sale", band: 401, last_deal_date: "2026-10-01" },
    { apt_seq: "30110-1", apt_nm: "가", umd_nm: "천동", deal: "presale", band: 84, last_deal_date: "2026-10-01" },
    { apt_seq: "30110-2", apt_nm: "나", umd_nm: "천동", deal: "jeonse", band: 84, last_deal_date: "2026-09-01" },
  ]);
  // 쓸 수 있는 면적대가 하나도 없는 단지(30110-1)는 목록에 넣지 않는다.
  assert.deepEqual(grouped.map((entry) => [entry.aptSeq, entry.bands]), [["30110-2", { sale: [], jeonse: [84], "monthly-rent": [] }]]);
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  for (let index = 0; index <= DEAL_COMPLEX_RESULT_MAX; index += 1) insertTrade(database, { date: "2026-09-01", aptSeq: `30110-${500 + index}`, name: `가상마을${index}단지` });
  const data = (await find(stagePEnv(db), "q=가상마을")).json.data;
  assert.equal(data.items.length, DEAL_COMPLEX_RESULT_MAX);
  assert.deepEqual(data.warnings, [{ code: "RT_DEAL_COMPLEXES_PARTIAL" }]);
  assert.ok(DEAL_COMPLEX_GROUP_MAX >= DEAL_COMPLEX_RESULT_MAX * 3);
});

test("단지 찾기 입력·한도: q만(1 ~ 30자, 두 번·다른 매개변수 400), GET만, 첫 상한이면 200 + available false, 끝 상한이면 429, 켜기 값이 없으면 503", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  markAllMonthsOk(database);
  insertTrade(database, { date: "2026-09-01" });
  const env = stagePEnv(db);
  for (const [query, fields] of [["", ["q"]], ["q=", ["q"]], [`q=${"가".repeat(31)}`, ["q"]], ["q=가&q=나", ["q"]], ["q=가&from=2020-01-01", ["from"]], ["q=가&deal=sale", ["deal"]]]) {
    const result = await find(env, query);
    assert.deepEqual([result.status, result.json.error.code, result.json.error.details], [400, "VALIDATION_FAILED", fields], query);
  }
  for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await find(env, "q=가상", { method, body: {} })).status, 405, method);

  setRead(database, 6_000_000);
  const soft = await find(env, "q=가상");
  assert.deepEqual([soft.status, soft.json.data.available, soft.json.data.reason, soft.json.data.items], [200, false, "budget", []]);
  setRead(database, 10_000_000);
  const hard = await find(env, "q=가상");
  assert.deepEqual([hard.status, hard.json.error.code], [429, "RT_READ_BUDGET"]);
  assert.equal(readNow(database), 10_000_000, "거절한 조회는 더하지 않음");

  const off = await find(workEnv(db, { WORK_TOOLS_ENABLED: undefined, WORK_REALPRICE_ENABLED: undefined }), "q=가상");
  assert.equal(off.status, 503);
});
