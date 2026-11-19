// TK-53 실측 도구: 실제 규모 가상 실거래 자료(매매 6만·전월세 3만·분양권 1만 행, 한 단지·면적에 600건)를 로컬 D1에 넣고
// 실거래가 조회(trades·complexes·watch)의 meta.rows_read를 잰다. npm test에는 들어가지 않는다(파일 이름이 .test.mjs가 아님).
//   실행: node tests/realprice-read-measure.mjs
// - wrangler getPlatformProxy의 로컬 D1(miniflare)을 persist: false로 쓴다. 원격 D1·공공데이터포털은 부르지 않는다.
// - 자료는 모두 가상이다(단지 번호 S000 ~ S149·HEAVY, 법정동 '가상동'). 결과는 JSON으로 화면에만 찍는다.
import { readFileSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import { listRealpriceTrades, readRealpriceWatch, searchRealpriceComplexes } from "../worker/realprice-query.mjs";
import { REALPRICE_KINDS, expectedMonths, seedMonthsStatement } from "../worker/realprice-store.mjs";

const NOW = Date.parse("2026-11-17T05:00:00.000Z");
const CURRENT = "202611";
const iso = (ms) => new Date(ms).toISOString();
const proxy = await getPlatformProxy({ persist: false, remoteBindings: false });
const raw = proxy.env.WORK_DB;
for (const name of ["0001_init.sql", "0002_deal_schedule_inputs.sql", "0003_public_realprice.sql"]) {
  const sql = readFileSync(new URL(`../migrations/work/${name}`, import.meta.url), "utf8");
  await raw.exec(sql.replace(/--[^\n]*\n/gu, "\n").replace(/\r?\n/gu, " ").replace(/\s+/gu, " "));
}

// 재현할 수 있는 가짜 난수
let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (list) => list[Math.floor(rand() * list.length)];
const monthsFrom = (start) => {
  const out = [];
  let year = Number(start.slice(0, 4));
  let month = Number(start.slice(4));
  while (year * 100 + month <= Number(CURRENT)) {
    out.push(`${year}${String(month).padStart(2, "0")}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return out;
};
const AREAS = [5900, 7400, 8497, 10100];
const HEAVY = { apt: "HEAVY", area: 8497, name: "가상리더스시티5블록" };
const complexes = Array.from({ length: 150 }, (_, index) => ({ apt: `S${String(index).padStart(3, "0")}`, name: `가상단지${index}` }));
const rows = [];
function add(kind, ymd, { apt, area, name }, price) {
  const day = String(1 + Math.floor(rand() * 28)).padStart(2, "0");
  const key = `${kind}:${ymd}:${(rows.length + 1).toString(16).padStart(20, "0")}:1`;
  const dealing = kind === "rent" ? null : (Number(ymd) < 202111 ? null : (rand() < 0.07 ? "direct" : "broker"));
  rows.push([key, kind, ymd, `${ymd.slice(0, 4)}-${ymd.slice(4)}-${day}`, "가상동", "1", apt, apt, name, area, 10, 2010,
    kind === "rent" ? null : price, kind === "rent" ? Math.floor(price / 2) : null, kind === "rent" && rand() < 0.4 ? 500_000 : null,
    dealing, rand() < 0.03 ? 1 : 0, Number(ymd) < 202608 ? 1 : (rand() < 0.5 ? 1 : 0), iso(NOW - Math.floor(rand() * 20) * 86_400_000)]);
}
// 매매 6만(2006-01 ~). 무거운 단지·면적(HEAVY 84.97㎡)은 600건이고 그중 60건이 최근 3개월에 몰림.
const saleMonths = monthsFrom("200601");
for (let index = 0; index < 540; index += 1) add("sale", saleMonths[Math.floor((index / 540) * (saleMonths.length - 3))], HEAVY, 200_000_000 + index * 500_000);
for (let index = 0; index < 60; index += 1) add("sale", saleMonths[saleMonths.length - 3 + (index % 3)], HEAVY, 400_000_000 + index * 1_000_000);
while (rows.length < 60_000) add("sale", pick(saleMonths), { ...pick(complexes), area: pick(AREAS) }, 100_000_000 + Math.floor(rand() * 500) * 1_000_000);
const rentMonths = monthsFrom("201101");
while (rows.length < 90_000) add("rent", pick(rentMonths), { ...pick(complexes), area: pick(AREAS) }, 100_000_000 + Math.floor(rand() * 300) * 1_000_000);
const presaleMonths = monthsFrom("200706");
while (rows.length < 100_000) add("presale", pick(presaleMonths), { ...pick(complexes), area: pick(AREAS) }, 200_000_000 + Math.floor(rand() * 300) * 1_000_000);

const INSERT_SQL = `INSERT INTO rt_trades (trade_key, kind, deal_ymd, deal_date, umd_nm, jibun, apt_seq, cmp_seq, apt_nm, area_x100, floor, build_year,
  price_won, deposit_won, monthly_rent_won, dealing_gbn, cancelled, is_backfill, first_seen_at, updated_at)
SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), json_extract(value, '$[4]'),
  json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]'), json_extract(value, '$[8]'), json_extract(value, '$[9]'),
  json_extract(value, '$[10]'), json_extract(value, '$[11]'), json_extract(value, '$[12]'), json_extract(value, '$[13]'), json_extract(value, '$[14]'),
  json_extract(value, '$[15]'), json_extract(value, '$[16]'), json_extract(value, '$[17]'), json_extract(value, '$[18]'), json_extract(value, '$[18]')
FROM json_each(?1)`;
for (let index = 0; index < rows.length; index += 1000) await raw.prepare(INSERT_SQL).bind(JSON.stringify(rows.slice(index, index + 1000))).run();
await seedMonthsStatement(raw, REALPRICE_KINDS.flatMap((kind) => expectedMonths(kind, CURRENT).map((ymd) => [kind, ymd])), NOW).run();
await raw.prepare("UPDATE rt_fetch_months SET status = 'ok', last_success_at = ?1").bind(iso(NOW - 3_600_000)).run();
await raw.prepare("INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at) VALUES ('HEAVY', '가상 무거운 단지', NULL, 0, ?1), ('S001', '가상1', NULL, 1, ?1), ('S002', '가상2', NULL, 2, ?1)").bind(iso(NOW)).run();

// 문장마다 rows_read를 적는 감싸개(조회 코드는 그대로 부른다)
let log = [];
const wrap = (statement, sql) => ({
  bind: (...values) => wrap(statement.bind(...values), sql),
  first: () => statement.first(),
  run: () => statement.run(),
  all: async () => {
    const result = await statement.all();
    log.push({ head: sql.slice(0, 18).replace(/\s+/gu, " "), rowsRead: result.meta.rows_read });
    return result;
  },
});
const db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (statements) => raw.batch(statements) };
const usage = async () => Number((await raw.prepare("SELECT rows_read FROM rt_daily_usage WHERE day_utc = ?1").bind(iso(NOW).slice(0, 10)).first())?.rows_read ?? 0);
const count = async (sql, ...values) => (await raw.prepare(sql).bind(...values).first()).n;
const out = {
  rows: Object.fromEntries((await raw.prepare("SELECT kind, COUNT(*) AS n FROM rt_trades GROUP BY kind").all()).results.map((row) => [row.kind, row.n])),
  rangeRows3Months: await count("SELECT COUNT(*) AS n FROM rt_trades WHERE deal_ymd >= '202609'"),
  rangeRows36Months: await count("SELECT COUNT(*) AS n FROM rt_trades WHERE deal_ymd >= '202312'"),
  heavyGroupRows: await count("SELECT COUNT(*) AS n FROM rt_trades WHERE kind = 'sale' AND cmp_seq = 'HEAVY' AND area_x100 = 8497"),
  measured: {},
};
async function measure(label, run) {
  log = [];
  const before = await usage();
  const data = await run();
  out.measured[label] = {
    items: data.items.length,
    saleItems: data.items.filter((item) => item.kind === "sale").length,
    statements: log.map((entry) => `${entry.head}… ${entry.rowsRead}`),
    usageAdded: (await usage()) - before, // 사용량 행 1 + 받은 달 기록 + 목록 문장들의 rows_read
  };
  return data;
}
const query = (text) => new URLSearchParams(text);
await measure("기본(최근 3개월·30건)", () => listRealpriceTrades(db, query(""), { nowMs: NOW }));
await measure("kind=sale 36개월", () => listRealpriceTrades(db, query("kind=sale&from=2023-12&to=2026-11"), { nowMs: NOW }));
const first = await measure("kind=all 36개월 첫 쪽", () => listRealpriceTrades(db, query("kind=all&from=2023-12&to=2026-11"), { nowMs: NOW }));
await measure("kind=all 36개월 다음 쪽", () => listRealpriceTrades(db, query(`kind=all&from=2023-12&to=2026-11&cursor=${first.nextCursor}`), { nowMs: NOW }));
await measure("kind=all 36개월 100건", () => listRealpriceTrades(db, query("kind=all&from=2023-12&to=2026-11&limit=100"), { nowMs: NOW }));
await measure("관심 단지(watch=1, 최근 3개월)", () => listRealpriceTrades(db, query("watch=1"), { nowMs: NOW }));
await measure("무거운 단지만(apt=HEAVY, 매매 36개월)", () => listRealpriceTrades(db, query("apt=HEAVY&kind=sale&from=2023-12&to=2026-11"), { nowMs: NOW }));
await measure("단지 찾기(q=리더스)", () => searchRealpriceComplexes(db, query("q=리더스"), { nowMs: NOW }));
await measure("관심 단지 보기", () => readRealpriceWatch(db));
await proxy.dispose();
console.log(JSON.stringify(out, null, 1));
