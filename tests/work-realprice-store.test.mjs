// 단계 P 실거래가 저장(worker/realprice-store.mjs) 시험: 받을 차례 고르기, 한 달 차이 반영 batch, 덜 온 응답 보류, 처음 받은 행 표시, 갱신 상태.
// 진짜 SQLite(node:sqlite)에 migrations/work를 모두(0008까지) 적용해 D1처럼 쓴다. 자료는 모두 가상이다.
// 0008부터 달 상태·거래 행에 구 코드(lawd_cd)가 있다. 따로 적지 않은 시험은 동구(30110) 한 곳만 쓴다.
// rows_written은 시험 도구의 흉내 값(바뀐 행 수, 색인 쓰기 못 셈)이라 실제 D1 쓰기량 판정에 쓰지 않는다(TK-11 실측은 로컬·원격 D1).
import test from "node:test";
import assert from "node:assert/strict";
import { REALPRICE_RETRY_POLICY } from "../worker/realprice-fetch.mjs";
import { parseRealpriceXml } from "../worker/realprice-parse.mjs";
import {
  REALPRICE_DAILY_CALL_BUDGET,
  REALPRICE_LAWDS,
  REALPRICE_MONTHS_PER_RUN,
  REALPRICE_NEVER,
  REALPRICE_START_MONTHS,
  applyRealpriceMonth,
  buildRealpriceWarnings,
  expectedMonths,
  kstMonth,
  monthAge,
  nextDueAfterSuccess,
  parseHold,
  pickDueMonths,
  readRealpriceStatus,
  recordHighReadyLawds,
  refreshStatements,
  refreshTier,
  saleCoveredThrough,
  seedMonthsStatement,
} from "../worker/realprice-store.mjs";
import { realpriceXml, saleDetailItem } from "./realprice-fixtures.mjs";
import { freshDb, rows } from "./work-test-kit.mjs";

const NOW = Date.parse("2026-11-17T05:00:00.000Z"); // 한국 시각 11-17 14:00, 이번 달 202611
const HOUR = 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// 파서를 거친 항목(받기 결과와 같은 모양).
function fetchedOf(items, { dealYmd = "202610", lawdCd = "30110" } = {}) {
  const parsed = parseRealpriceXml(realpriceXml({ items }));
  return { ok: true, api: "sale", lawdCd, dealYmd, totalCount: parsed.totalCount, items: parsed.items, calls: 1 };
}

const saleItems = (count, start = 0) => Array.from({ length: count }, (_, index) => saleDetailItem(start + index));

async function seedMonth(db, kind = "sale", dealYmd = "202610", lawdCd = "30110") {
  await seedMonthsStatement(db, [[lawdCd, kind, dealYmd]], NOW).run();
}

const monthRow = (database, kind = "sale", dealYmd = "202610", lawdCd = "30110") =>
  rows(database, "SELECT * FROM rt_fetch_months WHERE lawd_cd = ? AND kind = ? AND deal_ymd = ?", lawdCd, kind, dealYmd)[0];

async function apply(db, database, items, { nowMs = NOW, kind = "sale", dealYmd = "202610", lawdCd = "30110" } = {}) {
  return applyRealpriceMonth(db, { month: monthRow(database, kind, dealYmd, lawdCd), fetched: fetchedOf(items, { dealYmd, lawdCd }), nowMs, apiCalls: 1 });
}

test("달 계산: 한국 시각 기준 이번 달, 시작 달부터 이번 달까지, 다시 받는 주기 경계(6시간·7일·30일·다시 받지 않음)", () => {
  assert.equal(kstMonth(Date.parse("2026-11-30T14:59:59.999Z")), "202611");
  assert.equal(kstMonth(Date.parse("2026-11-30T15:00:00.000Z")), "202612", "한국 시각 12-01 00:00");
  assert.deepEqual(REALPRICE_START_MONTHS, { sale: "200601", presale: "200706", rent: "201101" });
  assert.equal(expectedMonths("sale", "202611").length, 251);
  assert.equal(expectedMonths("presale", "202611").length, 234);
  assert.equal(expectedMonths("rent", "202611").length, 191);
  assert.equal(expectedMonths("rent", "202611")[0], "201101");
  assert.equal(monthAge("202611", "202512"), 11);
  const cases = [[0, NOW + 6 * HOUR], [3, NOW + 6 * HOUR], [4, NOW + 7 * 24 * HOUR], [11, NOW + 7 * 24 * HOUR], [12, NOW + 30 * 24 * HOUR], [35, NOW + 30 * 24 * HOUR]];
  for (const [age, due] of cases) assert.equal(nextDueAfterSuccess(age, NOW), iso(due), `나이 ${age}`);
  assert.equal(nextDueAfterSuccess(36, NOW), REALPRICE_NEVER, "37번째 달부터는 다시 받지 않음");
  assert.equal(refreshTier(36), null);
});

test("TK-19 받을 차례: 최근 4개월 → 처음 채우기(매매 → 분양권 → 전월세, 종류 안에서 최근 달부터) → 5 ~ 12개월(7일) → 13 ~ 36개월(30일), 37개월보다 오래된 달은 다시 받지 않음", () => {
  const done = iso(NOW - 40 * 24 * HOUR);
  const due = iso(NOW - 1000);
  const row = (kind, dealYmd, { success = done, nextDue = due, attempts = 0, lawd = "30110" } = {}) => ({ lawd_cd: lawd, kind, deal_ymd: dealYmd, status: "ok", row_count: 1, dropped_count: 0, held_count: null, attempts, last_error: null, last_success_at: success, next_due_at: nextDue });
  const months = [
    row("rent", "202508"), // 나이 15(13 ~ 36개월) 30일
    row("sale", "202606"), // 나이 5(5 ~ 12개월) 7일
    row("sale", "202307"), // 나이 40: 다시 받지 않음
    row("presale", "202401", { success: null }), // 처음 채우기(분양권)
    row("sale", "200601", { success: null }), // 처음 채우기(매매, 오래된 달)
    row("sale", "202001", { success: null }), // 처음 채우기(매매, 최근 쪽)
    row("rent", "202611"), // 최근 4개월
    row("sale", "202608"), // 최근 4개월(나이 3)
    row("sale", "202609", { nextDue: iso(NOW + 1000) }), // 아직 차례 아님
    row("rent", "201101", { success: null }), // 처음 채우기(전월세)
  ];
  const { picked } = pickDueMonths(months, { nowMs: NOW, limit: 100 });
  assert.deepEqual(picked.map((month) => `${month.kind}:${month.deal_ymd}`), [
    "sale:202608", "rent:202611",
    "sale:202001", "sale:200601", "presale:202401", "rent:201101",
    "sale:202606",
    "rent:202508",
  ]);
  assert.equal(REALPRICE_MONTHS_PER_RUN, 12);
  assert.equal(pickDueMonths(months, { nowMs: NOW }).picked.length, 8, "1회 12달까지(유료 플랜, 2026-11-25 대전 5개 구)");
  assert.equal(pickDueMonths(months, { nowMs: NOW, limit: 3 }).picked.length, 3);
  // TK-20 쓰기 예산을 넘으면 최근 4개월만, TK-54 읽기 첫 상한을 넘으면 처음 채우기만 뺌.
  const writeLimited = pickDueMonths(months, { nowMs: NOW, limit: 100, writeBudgetExceeded: true });
  assert.deepEqual(writeLimited.picked.map((month) => `${month.kind}:${month.deal_ymd}`), ["sale:202608", "rent:202611"]);
  assert.equal(writeLimited.blocked.writeBudget, 6);
  // 하루 호출 예산(8,000번, 공공데이터포털 API마다 하루 10,000번 아래)을 넘어도 최근 4개월만.
  const callLimited = pickDueMonths(months, { nowMs: NOW, limit: 100, callBudgetExceeded: true });
  assert.deepEqual(callLimited.picked.map((month) => `${month.kind}:${month.deal_ymd}`), ["sale:202608", "rent:202611"]);
  assert.equal(callLimited.blocked.callBudget, 6);
  const readLimited = pickDueMonths(months, { nowMs: NOW, limit: 100, readSoftExceeded: true });
  assert.deepEqual(readLimited.picked.map((month) => `${month.kind}:${month.deal_ymd}`), ["sale:202608", "rent:202611", "sale:202606", "rent:202508"]);
  assert.equal(readLimited.blocked.readBudget, 4);
  // 키·종류 단위 미룸
  const kindHold = parseHold(JSON.stringify({ kinds: { sale: { until: iso(NOW + HOUR), code: "RT_ACCESS_DENIED" } } }));
  assert.ok(pickDueMonths(months, { nowMs: NOW, limit: 100, hold: kindHold }).picked.every((month) => month.kind !== "sale"));
  const allHold = parseHold(JSON.stringify({ all: { until: iso(NOW + HOUR), code: "RT_KEY_INVALID" } }));
  assert.equal(pickDueMonths(months, { nowMs: NOW, limit: 100, hold: allHold }).picked.length, 0);
  const expired = parseHold(JSON.stringify({ all: { until: iso(NOW - 1), code: "RT_KEY_INVALID" } }));
  assert.equal(pickDueMonths(months, { nowMs: NOW, limit: 100, hold: expired }).picked.length, 8, "미룸 시각이 지나면 다시 받음");
  assert.deepEqual(parseHold("{"), { all: null, kinds: {} }, "깨진 값은 미룸 없음으로 읽음");
});

test("TK-58·TK-55 한 달 2,350건 처음 반영: json_each 문장 3개(1,000행씩)와 상태·사용량을 한 batch 5문장에, 처음 받은 행은 is_backfill 1", async (t) => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  const before = db.stats.statements;
  const result = await apply(db, database, saleItems(2350));
  assert.equal(result.outcome, "ok");
  assert.deepEqual([result.inserted, result.updated, result.deleted], [2350, 0, 0]);
  assert.equal(db.stats.batches.at(-1), 5, "넣기 3 + 달 상태 1 + 하루 사용량 1");
  assert.equal(db.stats.statements - before, 6, "그 달 저장 행 읽기 1 + batch 5");
  t.diagnostic(`TK-58 처음 반영 2,350건: batch 문장 ${db.stats.batches.at(-1)}개, 전체 문장 ${db.stats.statements - before}개`);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 2350);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE is_backfill = 1")[0].n, 2350, "그 달을 처음 받으면 최근 달이어도 처음 채우기");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE cmp_seq IS NULL OR cmp_seq <> apt_seq")[0].n, 0, "cmp_seq = apt_seq(D-4)");
  const month = monthRow(database);
  assert.deepEqual([month.status, month.row_count, month.dropped_count, month.attempts, month.last_error], ["ok", 2350, 0, 0, null]);
  assert.equal(month.last_success_at, iso(NOW));
  assert.equal(month.next_due_at, iso(NOW + 6 * HOUR), "최근 4개월은 6시간 뒤");
  const usage = rows(database, "SELECT * FROM rt_daily_usage")[0];
  assert.equal(usage.day_utc, "2026-11-17");
  assert.equal(usage.api_calls, 1);
  assert.equal(usage.rows_written, 2350 * 2 + 2, "매매는 부분 색인 때문에 1건 약 2행으로 추정(22.5절)");
});

test("TK-11 같은 XML로 다시 받으면 거래 쓰기 0(상태 표만), 새 거래 1건만 더하면 넣기 1이고 그 행은 처음 채우기가 아님(TK-55)", async (t) => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  await apply(db, database, saleItems(300));
  const firstSeen = rows(database, "SELECT trade_key, first_seen_at, updated_at FROM rt_trades ORDER BY trade_key");
  const later = NOW + 6 * HOUR;
  const again = await apply(db, database, saleItems(300), { nowMs: later });
  assert.deepEqual([again.inserted, again.updated, again.deleted], [0, 0, 0]);
  assert.equal(db.stats.batches.at(-1), 2, "거래 문장 없음: 달 상태 1 + 사용량 1");
  assert.deepEqual(rows(database, "SELECT trade_key, first_seen_at, updated_at FROM rt_trades ORDER BY trade_key"), firstSeen, "거래 행은 하나도 바뀌지 않음");
  t.diagnostic(`TK-11 다시 받기: batch 문장 ${db.stats.batches.at(-1)}개, 흉내 rows_written ${again.results.reduce((sum, r) => sum + r.meta.rows_written, 0)}(달 상태·사용량 행)`);
  const plusOne = await apply(db, database, [...saleItems(300), saleDetailItem(5000)], { nowMs: later + HOUR });
  assert.deepEqual([plusOne.inserted, plusOne.updated, plusOne.deleted], [1, 0, 0]);
  assert.equal(db.stats.batches.at(-1), 3);
  t.diagnostic(`TK-11 새 거래 1건: 흉내 rows_written ${plusOne.results.reduce((sum, r) => sum + r.meta.rows_written, 0)}(색인 쓰기는 세지 못함, 실측은 로컬·원격 D1)`);
  const fresh = rows(database, "SELECT is_backfill, first_seen_at FROM rt_trades WHERE first_seen_at = ?", iso(later + HOUR));
  assert.deepEqual(fresh, [{ is_backfill: 0, first_seen_at: iso(later + HOUR) }], "그 달을 한 번 받은 뒤에 들어온 거래만 새로 들어옴");
});

test("TK-12 해제 표시·해제일·등기일·동이 새로 붙으면 그 행의 바뀌는 칸만 고치고 거래 ID·first_seen_at은 그대로", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  const items = saleItems(5);
  await apply(db, database, items);
  const target = rows(database, "SELECT trade_key, first_seen_at FROM rt_trades WHERE price_won = ?", 200_020_000)[0];
  const changed = items.map((item, index) => (index === 2 ? { ...item, cdealType: "O", cdealDay: "26.11.02", rgstDate: "26.11.05", aptDong: "305" } : item));
  const later = NOW + HOUR;
  const result = await apply(db, database, changed, { nowMs: later });
  assert.deepEqual([result.inserted, result.updated, result.deleted], [0, 1, 0]);
  const after = rows(database, "SELECT trade_key, first_seen_at, updated_at, cancelled, cancelled_on, registered_on, apt_dong FROM rt_trades WHERE price_won = ?", 200_020_000)[0];
  assert.equal(after.trade_key, target.trade_key);
  assert.equal(after.first_seen_at, target.first_seen_at);
  assert.equal(after.updated_at, iso(later));
  assert.deepEqual([after.cancelled, after.cancelled_on, after.registered_on, after.apt_dong], [1, "2026-11-02", "2026-11-05", "305"]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE updated_at = ?", iso(later))[0].n, 1, "다른 행은 그대로");
});

test("TK-13 똑같은 2건은 순번 0·1, 다시 받으면 쓰기 0, 1건이 사라지면 1행만 지움", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  const twin = saleDetailItem(1);
  await apply(db, database, [twin, { ...twin }, saleDetailItem(2)]);
  const keys = rows(database, "SELECT trade_key FROM rt_trades WHERE price_won = ? ORDER BY trade_key", 200_010_000).map((row) => row.trade_key);
  assert.equal(keys.length, 2);
  assert.deepEqual(keys.map((key) => key.split(":").at(-1)), ["0", "1"]);
  const again = await apply(db, database, [twin, { ...twin }, saleDetailItem(2)], { nowMs: NOW + HOUR });
  assert.deepEqual([again.inserted, again.updated, again.deleted], [0, 0, 0]);
  const gone = await apply(db, database, [twin, saleDetailItem(2)], { nowMs: NOW + 2 * HOUR });
  assert.deepEqual([gone.inserted, gone.updated, gone.deleted], [0, 0, 1]);
  assert.deepEqual(rows(database, "SELECT trade_key FROM rt_trades WHERE price_won = ?", 200_010_000).map((row) => row.trade_key), [keys[0]]);
});

test("TK-14 금액이 정정되면 옛 ID 1행을 지우고 새 ID 1행을 넣으며 다른 행은 그대로", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  const items = saleItems(4);
  await apply(db, database, items);
  const before = rows(database, "SELECT trade_key FROM rt_trades ORDER BY trade_key").map((row) => row.trade_key);
  const corrected = items.map((item, index) => (index === 1 ? { ...item, dealAmount: "19,999" } : item));
  const result = await apply(db, database, corrected, { nowMs: NOW + HOUR });
  assert.deepEqual([result.inserted, result.updated, result.deleted], [1, 0, 1]);
  const after = rows(database, "SELECT trade_key FROM rt_trades ORDER BY trade_key").map((row) => row.trade_key);
  assert.equal(after.filter((key) => before.includes(key)).length, 3);
});

test("TK-16 저장 40건인 달에 15건만 오면 보류(held_count 15, 거래 쓰기 0, RT_HELD_DROP), 다음에 다시 15건이면 반영(25행 지움), 저장 19건 이하는 보류 없이 반영", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  await apply(db, database, saleItems(40));
  const held = await apply(db, database, saleItems(15), { nowMs: NOW + HOUR });
  assert.equal(held.outcome, "held");
  assert.equal(db.stats.batches.at(-1), 2);
  let month = monthRow(database);
  assert.deepEqual([month.status, month.held_count, month.row_count, month.last_error, month.attempts], ["held", 15, 40, "RT_HELD_DROP", 0]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 40);
  const confirmed = await apply(db, database, saleItems(15), { nowMs: NOW + 2 * HOUR });
  assert.equal(confirmed.outcome, "ok");
  assert.equal(confirmed.deleted, 25);
  month = monthRow(database);
  assert.deepEqual([month.status, month.held_count, month.row_count, month.last_error], ["ok", null, 15, null]);

  const changing = freshDb({ d1Meta: true });
  await seedMonth(changing.db);
  await apply(changing.db, changing.database, saleItems(40));
  await apply(changing.db, changing.database, saleItems(15), { nowMs: NOW + HOUR });
  const other = await apply(changing.db, changing.database, saleItems(16), { nowMs: NOW + 2 * HOUR });
  assert.equal(other.outcome, "held", "다음 건수가 다르면 다시 보류");
  assert.equal(monthRow(changing.database).held_count, 16);

  const small = freshDb({ d1Meta: true });
  await seedMonth(small.db);
  await apply(small.db, small.database, saleItems(19));
  const shrink = await apply(small.db, small.database, saleItems(5), { nowMs: NOW + HOUR });
  assert.equal(shrink.outcome, "ok");
  assert.equal(shrink.deleted, 14);
});

test("TK-16·TK-55 저장이 1건 이상인 달에 0건이 오면 건수와 상관없이 한 번 보류, 0건이 다시 오면 그때 지움, 그사이 원래 건수가 다시 오면 옛 거래는 처음 채우기 표시 그대로", async () => {
  for (const stored of [1, 10, 19, 40]) {
    const { database, db } = freshDb({ d1Meta: true });
    await seedMonth(db);
    await apply(db, database, saleItems(stored));
    const firstSeen = rows(database, "SELECT first_seen_at FROM rt_trades LIMIT 1")[0].first_seen_at;
    const held = await apply(db, database, [], { nowMs: NOW + HOUR });
    assert.equal(held.outcome, "held", `저장 ${stored}건`);
    let month = monthRow(database);
    assert.deepEqual([month.status, month.held_count, month.row_count, month.last_error], ["held", 0, stored, "RT_HELD_DROP"], `저장 ${stored}건`);
    assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, stored, "보류 중에는 지우지 않음");

    // 일시적인 0건 뒤 원래 자료가 다시 오면: 보류가 풀리고 옛 거래는 그대로(새로 들어옴이 되지 않음).
    const back = await apply(db, database, saleItems(stored), { nowMs: NOW + 2 * HOUR });
    assert.deepEqual([back.outcome, back.inserted, back.deleted], ["ok", 0, 0], `저장 ${stored}건`);
    assert.deepEqual(rows(database, "SELECT DISTINCT is_backfill, first_seen_at FROM rt_trades"), [{ is_backfill: 1, first_seen_at: firstSeen }]);

    // 0건이 두 번 이어서 오면 그때 반영(모두 지움).
    await apply(db, database, [], { nowMs: NOW + 3 * HOUR });
    const confirmed = await apply(db, database, [], { nowMs: NOW + 4 * HOUR });
    assert.deepEqual([confirmed.outcome, confirmed.deleted], ["ok", stored], `저장 ${stored}건`);
    month = monthRow(database);
    assert.deepEqual([month.status, month.row_count, month.held_count], ["ok", 0, null]);
  }
  // 저장이 0건인 달에 0건이 오면 보류 없이 ok(처음 받기·원래 없는 달).
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  assert.equal((await apply(db, database, [])).outcome, "ok");
  assert.equal((await apply(db, database, [], { nowMs: NOW + HOUR })).outcome, "ok");
});

test("빈 면적·빈 단지명 행은 버리고 dropped_count에 세며, 버린 비율이 5%를 넘을 때만 갱신 상태 경고(B-2)", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db);
  const items = [...saleItems(94), ...Array.from({ length: 6 }, (_, index) => saleDetailItem(500 + index, { excluUseAr: " " }))];
  await apply(db, database, items);
  assert.deepEqual([monthRow(database).row_count, monthRow(database).dropped_count], [94, 6]);
  const status = await readRealpriceStatus(db, { nowMs: NOW, retryPolicy: REALPRICE_RETRY_POLICY });
  assert.deepEqual(status.warnings.find((warning) => warning.code === "RT_DROPPED_ROWS"), { code: "RT_DROPPED_ROWS", count: 1, months: ["30110:sale:202610"] });
  const edge = [{ lawd_cd: "30110", kind: "sale", deal_ymd: "202610", status: "ok", row_count: 95, dropped_count: 5, attempts: 0 }];
  const usage = { rows_written: 0, rows_read: 0 };
  assert.equal(buildRealpriceWarnings({ monthRows: edge, usage, hold: parseHold(null), countCheck: null, nowMs: NOW, retryPolicy: REALPRICE_RETRY_POLICY }).length, 0, "정확히 5%는 경고 없음");
});

test("갱신 상태: 받은 범위·처음 채우기 진행·신고가 준비·오늘 사용량·경고(읽기 80%·첫 상한·끝 상한·쓰기 예산·3번 끊김·종류 단위 미룸)를 읽기만으로 돌려줌", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  const status0 = await readRealpriceStatus(db, { nowMs: NOW, retryPolicy: REALPRICE_RETRY_POLICY });
  assert.deepEqual(Object.keys(status0), ["lastSuccessAt", "coveredThrough", "backfill", "backfillRegions", "recordHighReady", "recordHighLawds", "lastError", "warnings", "today", "unmatchedSaleRows", "runs"]);
  assert.deepEqual(status0.backfill, { sale: { done: 0, total: 251 * 5 }, rent: { done: 0, total: 191 * 5 }, presale: { done: 0, total: 234 * 5 } }, "5개 구 합계");
  assert.deepEqual(status0.backfillRegions.map((region) => region.lawdCd), [...REALPRICE_LAWDS]);
  assert.deepEqual(status0.backfillRegions[2], { lawdCd: "30170", sale: { done: 0, total: 251 }, presale: { done: 0, total: 234 }, rent: { done: 0, total: 191 }, recordHighReady: false });
  assert.deepEqual([status0.lastSuccessAt, status0.coveredThrough, status0.recordHighReady, status0.recordHighLawds, status0.lastError, status0.unmatchedSaleRows], [null, null, false, [], null, 0]);
  assert.deepEqual(status0.today, { apiCalls: 0, rowsWritten: 0, rowsRead: 0, writeBudget: 300000, readSoftLimit: 6000000, readHardLimit: 10000000, callBudget: REALPRICE_DAILY_CALL_BUDGET });
  assert.equal(REALPRICE_DAILY_CALL_BUDGET, 8000);
  const auditBefore = rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n;
  assert.equal(db.stats.batches.length, 0, "상태 보기는 쓰지 않음");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM audit_events")[0].n, auditBefore);

  const months = [
    { lawd_cd: "30110", kind: "sale", deal_ymd: "202611", status: "ok", row_count: 3, dropped_count: 0, attempts: 0, last_success_at: iso(NOW) },
    { lawd_cd: "30110", kind: "sale", deal_ymd: "202610", status: "ok", row_count: 3, dropped_count: 0, attempts: 0, last_success_at: iso(NOW) },
    { lawd_cd: "30110", kind: "sale", deal_ymd: "202608", status: "failed", row_count: 0, dropped_count: 0, attempts: 3, last_success_at: iso(NOW) },
  ];
  assert.equal(saleCoveredThrough(months, "202611", ["30110"]), "2026-10", "빠진 달(202609) 앞까지");
  assert.equal(saleCoveredThrough(months, "202611"), null, "5개 구가 모두 받은 달까지만 셈(다른 구는 이번 달도 아직)");
  const warn = (usage, hold = parseHold(null), countCheck = null) => buildRealpriceWarnings({ monthRows: months, usage, hold, countCheck, nowMs: NOW, retryPolicy: REALPRICE_RETRY_POLICY }).map((w) => w.code + (w.level ? `:${w.level}` : ""));
  assert.deepEqual(warn({ rows_written: 0, rows_read: 0 }), ["RT_ABORTED"]);
  assert.deepEqual(warn({ rows_written: 300_000, rows_read: 4_800_000 }), ["RT_ABORTED", "RT_WRITE_BUDGET", "RT_READ_BUDGET_NEAR"]);
  assert.deepEqual(warn({ rows_written: 299_999, rows_read: 4_799_999 }), ["RT_ABORTED"]);
  assert.deepEqual(warn({ rows_written: 0, rows_read: 6_000_000 }), ["RT_ABORTED", "RT_READ_BUDGET:soft"]);
  assert.deepEqual(warn({ rows_written: 0, rows_read: 10_000_000 }), ["RT_ABORTED", "RT_READ_BUDGET:hard"]);
  const holds = parseHold(JSON.stringify({ all: { until: iso(NOW + HOUR), code: "RT_KEY_INVALID" }, kinds: { presale: { until: iso(NOW + HOUR), code: "RT_ACCESS_DENIED" }, rent: { until: iso(NOW - 1), code: "RT_SERVICE_GONE" } } }));
  assert.deepEqual(warn({ rows_written: 0, rows_read: 0 }, holds), ["RT_ABORTED", "RT_ACCESS_DENIED"], "키 단위는 경고 아님(22.4절 표), 지난 미룸은 보이지 않음");
  assert.deepEqual(warn({ rows_written: 0, rows_read: 0 }, parseHold(null), { checkedAt: iso(NOW), diffs: [{ dealYmd: "202610", basic: 4, detail: 3 }] }), ["RT_ABORTED", "RT_COUNT_DIFF"]);
  const countWarning = (diffs) => buildRealpriceWarnings({ monthRows: [], usage: { rows_written: 0, rows_read: 0 }, hold: parseHold(null), countCheck: { checkedAt: iso(NOW), diffs }, nowMs: NOW, retryPolicy: REALPRICE_RETRY_POLICY })[0].months;
  assert.deepEqual(countWarning([{ dealYmd: "202610", basic: 4, detail: 3 }, { lawdCd: "30170", dealYmd: "202609", basic: 2, detail: 1 }]), ["30110:sale:202610", "30170:sale:202609"], "0008 전 대조 결과(구 없음)는 동구로 읽음");
});

test("TK-29 지금 다시 받기 문장: 최근 4개월 3종류 5개 구 60행을 지금 차례로(없는 달은 넣음) 바꾸고 미룸을 풀며, 예상 시간은 60 ÷ 12 × 10분", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonthsStatement(db, [["30110", "sale", "202611"], ["30110", "sale", "202001"]], NOW).run();
  database.prepare("UPDATE rt_fetch_months SET next_due_at = ? ").run(iso(NOW + 5 * HOUR));
  database.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('realprice_fetch_hold', ?, ?)").run(JSON.stringify({ all: { until: iso(NOW + HOUR), code: "RT_KEY_INVALID" } }), iso(NOW));
  const later = NOW + HOUR;
  const refresh = refreshStatements(db, later);
  assert.deepEqual([refresh.queuedMonths, refresh.estimatedMinutes, refresh.statements.length], [60, 50, 2]);
  await db.batch(refresh.statements);
  const due = rows(database, "SELECT lawd_cd, kind, deal_ymd FROM rt_fetch_months WHERE next_due_at = ? ORDER BY lawd_cd, kind, deal_ymd", iso(later));
  assert.equal(due.length, 60);
  assert.deepEqual(due.filter((row) => row.lawd_cd === "30110").map((row) => `${row.kind}:${row.deal_ymd}`), ["presale:202608", "presale:202609", "presale:202610", "presale:202611", "rent:202608", "rent:202609", "rent:202610", "rent:202611", "sale:202608", "sale:202609", "sale:202610", "sale:202611"]);
  for (const lawd of REALPRICE_LAWDS) assert.equal(due.filter((row) => row.lawd_cd === lawd).length, 12, lawd);
  assert.equal(monthRow(database, "sale", "202001").next_due_at, iso(NOW + 5 * HOUR), "오래된 달은 그대로");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM settings WHERE key = 'realprice_fetch_hold'")[0].n, 0);
});

// ── 대전 5개 구(0008, 2026-11-25 사용자 결정 "대전만 하면 될 것 같아") ──

test("TK-132: 한 구의 달을 반영해도 같은 종류·같은 달의 다른 구 거래는 읽지도 지우지도 않는다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db, "sale", "202610", "30110");
  await seedMonth(db, "sale", "202610", "30170");
  const seoItems = (count) => saleItems(count).map((item) => ({ ...item, sggCd: "30170", aptSeq: item.aptSeq.replace("30110", "30170") }));
  await apply(db, database, saleItems(30));
  await apply(db, database, seoItems(25), { lawdCd: "30170" });
  const count = (lawd) => rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE lawd_cd = ?", lawd)[0].n;
  assert.deepEqual([count("30110"), count("30170")], [30, 25]);
  // 서구 같은 달에 0건이 두 번 오면 서구 거래만 모두 지움(보류 뒤 확정). 동구 30건은 그대로.
  await apply(db, database, [], { lawdCd: "30170", nowMs: NOW + HOUR });
  const cleared = await apply(db, database, [], { lawdCd: "30170", nowMs: NOW + 2 * HOUR });
  assert.deepEqual([cleared.outcome, cleared.deleted], ["ok", 25]);
  assert.deepEqual([count("30110"), count("30170")], [30, 0]);
  // 동구를 다시 받아도 서구 줄은 건드리지 않음(다시 넣은 서구 1건이 남음).
  await apply(db, database, seoItems(1), { lawdCd: "30170", nowMs: NOW + 3 * HOUR });
  const again = await apply(db, database, saleItems(30), { nowMs: NOW + 4 * HOUR });
  assert.deepEqual([again.inserted, again.updated, again.deleted], [0, 0, 0]);
  assert.deepEqual([count("30110"), count("30170")], [30, 1]);
  assert.deepEqual([monthRow(database).row_count, monthRow(database, "sale", "202610", "30170").row_count], [30, 1]);
});

test("TK-16·TK-132(보류의 구 조건): 한 구의 달을 보류해도 같은 종류·같은 달의 다른 구 줄은 한 칸도 바뀌지 않고, 그 구는 뒤에 같은 건수를 받아도 처음 보류부터 거친다", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedMonth(db, "sale", "202610", "30110");
  await seedMonth(db, "sale", "202610", "30170");
  await seedMonth(db, "sale", "202610", "30140");
  const seoItems = (count) => saleItems(count).map((item) => ({ ...item, sggCd: "30170", aptSeq: item.aptSeq.replace("30110", "30170") }));
  await apply(db, database, saleItems(40));
  await apply(db, database, seoItems(40), { lawdCd: "30170" });
  const count = (lawd) => rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE lawd_cd = ?", lawd)[0].n;
  const seoBefore = monthRow(database, "sale", "202610", "30170");
  const jungBefore = monthRow(database, "sale", "202610", "30140");
  assert.deepEqual([seoBefore.status, seoBefore.held_count, seoBefore.row_count, jungBefore.status], ["ok", null, 40, "pending"]);

  // 동구에 15건만 오면 동구 줄만 보류. 서구(받은 달)·중구(아직 안 받은 달) 줄은 그대로.
  const held = await apply(db, database, saleItems(15), { nowMs: NOW + HOUR });
  assert.equal(held.outcome, "held");
  const east = monthRow(database);
  assert.deepEqual([east.status, east.held_count, east.row_count, east.last_error], ["held", 15, 40, "RT_HELD_DROP"]);
  assert.deepEqual(monthRow(database, "sale", "202610", "30170"), seoBefore, "서구 줄 그대로");
  assert.deepEqual(monthRow(database, "sale", "202610", "30140"), jungBefore, "중구 줄 그대로");

  // 서구가 뒤에 우연히 같은 15건을 받아도 '확인된 보류'로 보지 않는다(바로 지우지 않고 서구도 처음 보류).
  const seoHeld = await apply(db, database, seoItems(15), { lawdCd: "30170", nowMs: NOW + 2 * HOUR });
  assert.deepEqual([seoHeld.outcome, seoHeld.deleted], ["held", 0]);
  assert.deepEqual([count("30110"), count("30170")], [40, 40]);
});

test("TK-133: 차례 고르기는 같은 순서·같은 달이면 동구 → 중구 → 서구 → 유성구 → 대덕구, 신고가 준비는 구마다 따로 본다", () => {
  const due = iso(NOW - 1000);
  const months = [...REALPRICE_LAWDS].reverse().map((lawd) => ({ lawd_cd: lawd, kind: "sale", deal_ymd: "202001", status: "pending", row_count: 0, dropped_count: 0, held_count: null, attempts: 0, last_error: null, last_success_at: null, next_due_at: due }));
  assert.deepEqual(pickDueMonths(months, { nowMs: NOW }).picked.map((month) => month.lawd_cd), ["30110", "30140", "30170", "30200", "30230"]);
  const done = iso(NOW - HOUR);
  const saleMonths = (lawd) => expectedMonths("sale", "202611").map((dealYmd) => ({ lawd_cd: lawd, kind: "sale", deal_ymd: dealYmd, last_success_at: done }));
  assert.deepEqual(recordHighReadyLawds(saleMonths("30110"), "202611"), ["30110"], "동구만 다 받음");
  const partial = [...saleMonths("30110"), ...saleMonths("30170").slice(1)];
  assert.deepEqual(recordHighReadyLawds(partial, "202611"), ["30110"], "서구는 한 달 빠짐");
  assert.deepEqual(recordHighReadyLawds(REALPRICE_LAWDS.flatMap(saleMonths), "202611"), [...REALPRICE_LAWDS]);
  assert.equal(saleCoveredThrough(REALPRICE_LAWDS.flatMap(saleMonths), "202611"), "2006-01");
});
