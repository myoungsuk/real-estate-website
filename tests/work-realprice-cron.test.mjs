// 단계 P 실거래가 Cron(worker/work-scheduled.mjs) 시험: 켜기 값·구조 번호, 받을 차례, 오류 뒤 다음 차례, 쓰기·읽기 예산, 임대·중단,
// 매일 03시 건수 대조, 인증키 표식 0건(로그·D1·결과), 예외 처리. 공공데이터포털 대신 요청을 기록하는 가짜 fetcher를 쓴다. 자료는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/index.mjs";
import { REALPRICE_RETRY_POLICY } from "../worker/realprice-fetch.mjs";
import { REALPRICE_KINDS, REALPRICE_NEVER, expectedMonths, kstMonth, readRealpriceStatus, seedMonthsStatement } from "../worker/realprice-store.mjs";
import { REALPRICE_CRON, handleScheduled, isDailyCheckWindow, runRealpriceCron } from "../worker/work-scheduled.mjs";
import { FAKE_SERVICE_KEY, realpriceHeaderOnlyXml, realpriceXml, recordingFetcher, saleDetailItem, xmlResponse } from "./realprice-fixtures.mjs";
import { SECRET, allMigrationSql, createD1, freshDb, nextUuid, rows } from "./work-test-kit.mjs";

const NOW = Date.parse("2026-11-17T05:00:00.000Z"); // 한국 시각 11-17 14:00, 이번 달 202611
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const TOTAL_MONTHS = 251 + 234 + 191;

const cronEnv = (db, extra = {}) => ({ WORK_REALPRICE_ENABLED: "true", MOLIT_RT_SERVICE_KEY: FAKE_SERVICE_KEY, ADMIN_CSRF_SECRET: SECRET, WORK_DB: db, ...extra });

const kindOfUrl = (url) => (url.includes("/RTMSDataSvcAptTradeDev/") ? "sale" : url.includes("/RTMSDataSvcAptRent/") ? "rent" : url.includes("/RTMSDataSvcSilvTrade/") ? "presale" : url.includes("/RTMSDataSvcAptTrade/") ? "saleBasic" : null);

// 그 달 매매 항목(계약 연월을 그 달로 맞춤).
const saleMonthItems = (dealYmd, count, start = 0) => Array.from({ length: count }, (_, index) => saleDetailItem(start + index, { dealYear: dealYmd.slice(0, 4), dealMonth: String(Number(dealYmd.slice(4))) }));

// 가짜 공공데이터포털. data: { "sale:202611": 항목[] }(매매 일반 건수는 따로 없으면 매매 상세와 같게), special(kind, ymd, pageNo)이 값을 주면 그것으로 응답.
function portal(data = {}, special = () => undefined) {
  const urls = [];
  const { fetcher, calls } = recordingFetcher(async (url, { pageNo }) => {
    const parsed = new URL(url);
    const kind = kindOfUrl(url);
    const ymd = parsed.searchParams.get("DEAL_YMD");
    const result = await special(kind, ymd, pageNo, parsed);
    if (result instanceof Error) throw result;
    if (result) return result;
    const all = data[`${kind}:${ymd}`] ?? (kind === "saleBasic" ? data[`sale:${ymd}`] : undefined) ?? [];
    const size = Number(parsed.searchParams.get("numOfRows"));
    return xmlResponse(realpriceXml({ items: all.slice((pageNo - 1) * size, pageNo * size), totalCount: all.length, pageNo, numOfRows: size }));
  }, urls);
  const picked = () => calls.map((call) => `${kindOfUrl(call.url)}:${new URL(call.url).searchParams.get("DEAL_YMD")}`);
  return { fetcher, calls, urls, picked };
}

async function cron(env, { now = NOW, fetcher, log = [] } = {}) {
  return runRealpriceCron(env, { now: () => now, fetcher, log: (entry) => log.push(entry), randomUUID: nextUuid });
}

// 모든 달을 이미 받은 상태(다시 받지 않음)로 둔다. 차례는 시험마다 makeDue로 연다.
async function seedAllDone(db, database, nowMs = NOW) {
  const pairs = REALPRICE_KINDS.flatMap((kind) => expectedMonths(kind, kstMonth(nowMs)).map((ymd) => [kind, ymd]));
  await seedMonthsStatement(db, pairs, nowMs).run();
  database.prepare("UPDATE rt_fetch_months SET status = 'ok', last_success_at = ?, next_due_at = ?").run(iso(nowMs - DAY), REALPRICE_NEVER);
}
const makeDue = (database, kind, ymd, { at = NOW - MINUTE, neverFetched = false } = {}) => {
  database.prepare("UPDATE rt_fetch_months SET next_due_at = ? WHERE kind = ? AND deal_ymd = ?").run(iso(at), kind, ymd);
  if (neverFetched) database.prepare("UPDATE rt_fetch_months SET last_success_at = NULL, status = 'pending' WHERE kind = ? AND deal_ymd = ?").run(kind, ymd);
};
const monthRow = (database, kind, ymd) => rows(database, "SELECT * FROM rt_fetch_months WHERE kind = ? AND deal_ymd = ?", kind, ymd)[0];
const setUsage = (database, day, { written = 0, read = 0 } = {}) => database.prepare("INSERT INTO rt_daily_usage (day_utc, rows_written, rows_read) VALUES (?, ?, ?) ON CONFLICT(day_utc) DO UPDATE SET rows_written = excluded.rows_written, rows_read = excluded.rows_read").run(day, written, read);
const status = (db, nowMs = NOW) => readRealpriceStatus(db, { nowMs, retryPolicy: REALPRICE_RETRY_POLICY });

test("TK-22 켜기 값이 꺼짐(없음·TRUE·1·' true')이면 D1·외부 요청 0번·로그 없음, 설정이 빠지면 경고 로그만", async () => {
  for (const value of [undefined, "TRUE", "1", " true", "false"]) {
    const { db } = freshDb();
    const { fetcher, calls } = portal();
    const log = [];
    const result = await cron(cronEnv(db, { WORK_REALPRICE_ENABLED: value }), { fetcher, log });
    assert.equal(result.outcome, "disabled", String(value));
    assert.equal(db.stats.statements, 0, "D1 호출 0번");
    assert.equal(calls.length, 0);
    assert.deepEqual(log, []);
  }
  for (const [name, extra] of [
    ["인증키 없음", { MOLIT_RT_SERVICE_KEY: undefined }],
    ["인증키 19자", { MOLIT_RT_SERVICE_KEY: "k".repeat(19) }],
    ["인증키 공백만", { MOLIT_RT_SERVICE_KEY: " ".repeat(30) }],
    ["CSRF Secret 31자", { ADMIN_CSRF_SECRET: "s".repeat(31) }],
    ["허용 출처 해석 실패", { ADMIN_ALLOWED_ORIGINS: "http://leaderscityhappy.com" }],
  ]) {
    const { db } = freshDb();
    const { fetcher, calls } = portal();
    const log = [];
    const result = await cron(cronEnv(db, extra), { fetcher, log });
    assert.equal(result.outcome, "config_missing", name);
    assert.equal(db.stats.statements, 0, name);
    assert.equal(calls.length, 0, name);
    assert.deepEqual(log, [{ event: "realprice_cron", level: "warn", code: "REALPRICE_CONFIG_MISSING" }], name);
  }
  const { fetcher, calls } = portal();
  assert.equal((await cron(cronEnv(undefined), { fetcher })).outcome, "config_missing", "D1 바인딩 없음");
  assert.equal(calls.length, 0);
});

test("TK-07·TK-22 구조 번호 2(0003 적용 전 D1)·5(앞선 코드로 되돌림)이면 공공데이터포털 호출 0번·D1 쓰기 0·경고 로그만", async () => {
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 2)) database.exec(sql);
  const before0003 = createD1(database);
  const { fetcher, calls } = portal();
  const log = [];
  const result = await cron(cronEnv(before0003), { fetcher, log });
  assert.deepEqual(result, { outcome: "schema_mismatch", code: "WORK_SCHEMA_OUTDATED" });
  assert.deepEqual([before0003.stats.statements, before0003.stats.batches.length, calls.length], [1, 0, 0]);
  assert.deepEqual(log, [{ event: "realprice_cron", level: "warn", code: "WORK_SCHEMA_OUTDATED" }]);

  const ahead = freshDb();
  ahead.database.exec("UPDATE settings SET value_json = '5' WHERE key = 'schema_version'");
  assert.equal((await cron(cronEnv(ahead.db), { fetcher })).code, "WORK_SCHEMA_AHEAD");
  assert.equal(calls.length, 0);
  assert.equal(ahead.db.stats.batches.length, 0);
});

test("TK-19·TK-58 처음 실행: 받을 달 676행을 한 문장으로 넣고 이번 달 매매 1개월만 받으며, 실행 기록·임대 반납·사용량을 남기고 실행 1번 문장 수가 50 안", async (t) => {
  const { database, db } = freshDb({ d1Meta: true });
  const { fetcher, calls } = portal({ "sale:202611": saleMonthItems("202611", 5) });
  const log = [];
  const result = await cron(cronEnv(db), { fetcher, log });
  assert.equal(result.outcome, "ok");
  assert.deepEqual([result.run, result.months, result.calls, result.inserted, result.updated, result.deleted, result.code], [1, 1, 1, 5, 0, 0, null]);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("DEAL_YMD"), "202611");
  assert.equal(kindOfUrl(calls[0].url), "sale");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months")[0].n, TOTAL_MONTHS);
  assert.equal(db.stats.batches[0], 3, "시작 batch: 달 넣기 1문장(676행) + 시작 표시 1 + 실행 기록 1");
  assert.ok(db.stats.statements < 50, `실행 1번 문장 ${db.stats.statements}개`);
  t.diagnostic(`TK-58 처음 실행: 문장 ${db.stats.statements}개, batch별 ${JSON.stringify(db.stats.batches)}`);
  const month = monthRow(database, "sale", "202611");
  assert.deepEqual([month.status, month.row_count, month.attempts, month.last_error], ["ok", 5, 0, null]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades WHERE is_backfill = 1")[0].n, 5, "TK-55 처음 받은 달");
  const [run] = rows(database, "SELECT * FROM rt_fetch_runs");
  assert.deepEqual([run.seq, run.outcome, run.months_done, run.api_calls, run.inserted, run.error_code, run.finished_at], [1, "ok", 1, 1, 5, null, iso(NOW)]);
  assert.deepEqual(rows(database, "SELECT name, lease_until FROM worker_leases"), [{ name: "realprice-fetch", lease_until: iso(0) }], "임대 반납");
  const [usage] = rows(database, "SELECT * FROM rt_daily_usage");
  assert.equal(usage.api_calls, 1);
  assert.equal(usage.rows_written, run.rows_written, "하루 사용량 쓰기 = 실행 기록 쓰기(meta로 보정)");
  assert.ok(usage.rows_read > 0);
  assert.deepEqual(log, [{ event: "realprice_cron", outcome: "ok", run: 1, months: 1, calls: 1, inserted: 5, updated: 0, deleted: 0, rowsWritten: run.rows_written, code: null }]);
});

test("TK-19 차례 진행: 최근 4개월 12번 → 처음 채우기 매매 최근 달부터, 0건 달도 ok, 새 달이 되면 그 달 3행을 INSERT OR IGNORE로 넣음", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  const { fetcher, picked } = portal();
  for (let index = 0; index < 14; index += 1) await cron(cronEnv(db), { now: NOW + index * 10 * MINUTE, fetcher });
  assert.deepEqual(picked(), [
    "sale:202611", "sale:202610", "sale:202609", "sale:202608",
    "presale:202611", "presale:202610", "presale:202609", "presale:202608",
    "rent:202611", "rent:202610", "rent:202609", "rent:202608",
    "sale:202607", "sale:202606",
  ]);
  const zero = monthRow(database, "rent", "202608");
  assert.deepEqual([zero.status, zero.row_count, zero.last_error], ["ok", 0, null], "0건 달도 받은 달로 기록");
  assert.equal(monthRow(database, "sale", "202607").next_due_at, iso(NOW + 12 * 10 * MINUTE + 7 * DAY), "5 ~ 12개월 전은 7일 뒤");
  const december = Date.parse("2026-11-30T15:05:00.000Z"); // 한국 시각 12-01 00:05
  await cron(cronEnv(db), { now: december, fetcher });
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_months")[0].n, TOTAL_MONTHS + 3);
  assert.deepEqual(rows(database, "SELECT kind FROM rt_fetch_months WHERE deal_ymd = '202612' ORDER BY kind").map((row) => row.kind), ["presale", "rent", "sale"]);
  assert.ok(["202612", "202611", "202610", "202609"].includes(picked().at(-1).split(":")[1]), "새 달에도 최근 4개월이 먼저");
});

test("TK-10 2,350건을 3쪽으로 받아 반영, 2쪽이 5xx면 그 달 거래 쓰기 0행·RT_UPSTREAM_FAILED·그 달만 30분 뒤 차례", async () => {
  const items = saleMonthItems("202611", 2350);
  const ok = freshDb({ d1Meta: true });
  const normal = portal({ "sale:202611": items });
  const result = await cron(cronEnv(ok.db), { fetcher: normal.fetcher });
  assert.deepEqual([result.calls, result.inserted], [3, 2350]);
  assert.deepEqual(normal.calls.map((call) => call.pageNo), [1, 2, 3]);
  assert.equal(rows(ok.database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 2350);

  const { database, db } = freshDb({ d1Meta: true });
  const broken = portal({ "sale:202611": items }, (kind, ymd, pageNo) => (pageNo === 2 ? new Response("upstream", { status: 502 }) : undefined));
  const failed = await cron(cronEnv(db), { fetcher: broken.fetcher });
  assert.deepEqual([failed.outcome, failed.code, failed.calls, failed.inserted], ["failed", "RT_UPSTREAM_FAILED", 2, 0]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 0, "그 달 거래 쓰기 0행");
  const month = monthRow(database, "sale", "202611");
  assert.deepEqual([month.status, month.last_error, month.attempts, month.next_due_at], ["failed", "RT_UPSTREAM_FAILED", 0, iso(NOW + 30 * MINUTE)]);
  assert.equal(monthRow(database, "sale", "202610").next_due_at, iso(NOW), "다른 달은 그대로");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM settings WHERE key = 'realprice_fetch_hold'")[0].n, 0, "그 달만 미룸");
  assert.equal(rows(database, "SELECT api_calls FROM rt_daily_usage")[0].api_calls, 2);
  await cron(cronEnv(db), { now: NOW + 10 * MINUTE, fetcher: broken.fetcher });
  assert.equal(broken.picked().at(-1), "sale:202610", "30분 안에는 다음 달로");
});

test("TK-15 모은 수가 totalCount와 다르면 그 달 쓰기 0행(앞서 받은 자료 그대로)·RT_COUNT_MISMATCH", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  let short = false;
  const { fetcher } = portal({ "sale:202611": saleMonthItems("202611", 4) }, (kind, ymd, pageNo) => {
    if (!short || kind !== "sale") return undefined;
    return xmlResponse(realpriceXml({ items: pageNo === 1 ? saleMonthItems("202611", 3) : [], totalCount: 5, pageNo }));
  });
  await cron(cronEnv(db), { fetcher });
  const before = rows(database, "SELECT * FROM rt_trades ORDER BY trade_key");
  makeDue(database, "sale", "202611", { at: NOW });
  short = true;
  const result = await cron(cronEnv(db), { now: NOW + 10 * MINUTE, fetcher });
  assert.deepEqual([result.outcome, result.code], ["failed", "RT_COUNT_MISMATCH"]);
  assert.deepEqual(rows(database, "SELECT * FROM rt_trades ORDER BY trade_key"), before);
  assert.equal(monthRow(database, "sale", "202611").next_due_at, iso(NOW + 40 * MINUTE));
});

test("TK-17 오류 뒤 다음 차례: 키 단위는 모든 종류, 종류 단위는 그 종류만, 그 밖은 그 달만 미루고 앞서 받은 자료는 그대로, 종류 단위 오류만 갱신 상태 warnings[]", async () => {
  const cases = [
    ["결과 코드 22", () => xmlResponse(realpriceHeaderOnlyXml("22")), "RT_DAILY_LIMIT", "all", () => "2026-11-17T15:10:00.000Z"],
    ["결과 코드 30", () => xmlResponse(realpriceHeaderOnlyXml("30")), "RT_KEY_INVALID", "all", (t) => iso(t + HOUR)],
    ["결과 코드 31", () => xmlResponse(realpriceHeaderOnlyXml("31")), "RT_KEY_EXPIRED", "all", (t) => iso(t + HOUR)],
    ["HTTP 401", () => new Response("", { status: 401 }), "RT_KEY_INVALID", "all", (t) => iso(t + HOUR)],
    ["결과 코드 20", () => xmlResponse(realpriceHeaderOnlyXml("20")), "RT_ACCESS_DENIED", "kind", (t) => iso(t + HOUR)],
    ["결과 코드 12", () => xmlResponse(realpriceHeaderOnlyXml("12")), "RT_SERVICE_GONE", "kind", (t) => iso(t + DAY)],
    ["HTTP 404", () => new Response("", { status: 404 }), "RT_REQUEST_INVALID", "kind", (t) => iso(t + 6 * HOUR)],
    ["결과 코드 23", () => xmlResponse(realpriceHeaderOnlyXml("23")), "RT_UPSTREAM_FAILED", "month", (t) => iso(t + 30 * MINUTE)],
    ["표에 없는 코드 77", () => xmlResponse(realpriceHeaderOnlyXml("77")), "RT_UPSTREAM_FAILED", "month", (t) => iso(t + 30 * MINUTE)],
  ];
  for (const [name, respond, code, scope, retryAt] of cases) {
    const failAt = NOW + MINUTE;
    const { database, db } = freshDb({ d1Meta: true });
    let failing = false;
    const portalState = portal({ "sale:202611": saleMonthItems("202611", 3) }, (kind) => (failing && kind === "sale" ? respond() : undefined));
    await cron(cronEnv(db), { fetcher: portalState.fetcher });
    const kept = rows(database, "SELECT trade_key FROM rt_trades ORDER BY trade_key");
    makeDue(database, "sale", "202611", { at: NOW });
    failing = true;
    const result = await cron(cronEnv(db), { now: failAt, fetcher: portalState.fetcher });
    assert.deepEqual([result.outcome, result.code], ["failed", code], name);
    const month = monthRow(database, "sale", "202611");
    assert.deepEqual([month.last_error, month.next_due_at, month.attempts], [code, retryAt(failAt), 0], name);
    assert.deepEqual(rows(database, "SELECT trade_key FROM rt_trades ORDER BY trade_key"), kept, `${name}: 앞서 받은 자료 그대로`);
    const holdRow = rows(database, "SELECT value_json FROM settings WHERE key = 'realprice_fetch_hold'")[0];
    const hold = holdRow ? JSON.parse(holdRow.value_json) : null;
    if (scope === "all") assert.equal(hold.all.code, code, name);
    else if (scope === "kind") assert.equal(hold.kinds.sale.code, code, name);
    else assert.equal(hold, null, name);
    const next = await cron(cronEnv(db), { now: NOW + 11 * MINUTE, fetcher: portalState.fetcher });
    const nextPick = next.outcome === "idle" ? null : portalState.picked().at(-1);
    assert.equal(nextPick, { all: null, kind: "presale:202611", month: "sale:202610" }[scope], `${name}: 다음 차례`);
    const warnings = (await status(db, NOW + 11 * MINUTE)).warnings.map((warning) => warning.code);
    assert.equal(warnings.includes(code), scope === "kind", `${name}: 갱신 상태 경고`);
  }
});

test("TK-20 그날 쓰기가 4만 행을 넘으면 과거 채우기·5개월 이상 달은 받지 않고 최근 4개월만(RT_WRITE_BUDGET), UTC 0시 뒤 다시 과거 채우기", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database);
  makeDue(database, "sale", "202001", { neverFetched: true });
  makeDue(database, "sale", "202606");
  makeDue(database, "sale", "202611");
  setUsage(database, "2026-11-17", { written: 40_000 });
  const { fetcher, picked } = portal();
  const log = [];
  const first = await cron(cronEnv(db), { fetcher, log });
  assert.deepEqual([first.outcome, first.code], ["partial", "RT_WRITE_BUDGET"]);
  assert.deepEqual(picked(), ["sale:202611"]);
  const second = await cron(cronEnv(db), { now: NOW + 10 * MINUTE, fetcher, log });
  assert.equal(second.outcome, "idle");
  assert.deepEqual(picked(), ["sale:202611"], "과거 채우기·5개월 전 달은 받지 않음");
  assert.equal(log.at(-1).code, "RT_WRITE_BUDGET");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_runs")[0].n, 1, "할 일 없는 실행은 기록하지 않음");
  const nextDay = Date.parse("2026-11-18T00:05:00.000Z");
  await cron(cronEnv(db), { now: nextDay, fetcher });
  await cron(cronEnv(db), { now: nextDay + 10 * MINUTE, fetcher });
  assert.ok(picked().includes("sale:202001"), "UTC 0시 뒤 다시 과거 채우기");
});

test("TK-54(Cron) 읽기 80%는 경고, 첫 상한은 과거 채우기만 멈춤(RT_READ_BUDGET), 끝 상한은 외부 요청·D1 쓰기 없이 끝, UTC 0시 뒤 원래대로", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database);
  const { fetcher, picked, calls } = portal();
  makeDue(database, "sale", "202001", { neverFetched: true });
  setUsage(database, "2026-11-17", { read: 1_200_000 });
  assert.ok((await status(db)).warnings.some((warning) => warning.code === "RT_READ_BUDGET_NEAR"));
  await cron(cronEnv(db), { fetcher });
  assert.deepEqual(picked(), ["sale:202001"], "80%에서는 과거 채우기 계속");

  makeDue(database, "sale", "202002", { neverFetched: true, at: NOW + 5 * MINUTE });
  makeDue(database, "sale", "202606", { at: NOW + 5 * MINUTE });
  setUsage(database, "2026-11-17", { read: 1_500_000 });
  const soft = await cron(cronEnv(db), { now: NOW + 10 * MINUTE, fetcher });
  assert.deepEqual([soft.outcome, soft.code], ["partial", "RT_READ_BUDGET"]);
  assert.equal(picked().at(-1), "sale:202606", "첫 상한: 과거 채우기만 멈춤");

  setUsage(database, "2026-11-17", { read: 2_500_000 });
  const statementsBefore = db.stats.statements;
  const batchesBefore = db.stats.batches.length;
  const callsBefore = calls.length;
  const log = [];
  const hard = await cron(cronEnv(db), { now: NOW + 20 * MINUTE, fetcher, log });
  assert.deepEqual(hard, { outcome: "read_budget_hard", code: "RT_READ_BUDGET" });
  assert.equal(calls.length, callsBefore, "외부 요청 0번");
  assert.equal(db.stats.batches.length, batchesBefore, "D1 쓰기 0");
  assert.equal(db.stats.statements - statementsBefore, 4, "구조 번호·달·사용량·설정 읽기만");
  assert.deepEqual(log, [{ event: "realprice_cron", level: "warn", code: "RT_READ_BUDGET", limit: "hard" }]);
  assert.equal((await status(db, NOW + 20 * MINUTE)).warnings.find((warning) => warning.code === "RT_READ_BUDGET").level, "hard");

  await cron(cronEnv(db), { now: Date.parse("2026-11-18T00:05:00.000Z"), fetcher });
  assert.equal(picked().at(-1), "sale:202002", "UTC 0시 뒤 과거 채우기 다시");
});

test("TK-21 임대가 살아 있으면 두 번째 실행은 받기 0번, 끊긴 달은 RT_ABORTED로 적고 30분 뒤 다시, 같은 달이 3번 연속 끊기면 갱신 상태 경고", async () => {
  const busy = freshDb({ d1Meta: true });
  await seedAllDone(busy.db, busy.database);
  makeDue(busy.database, "sale", "202611");
  busy.database.prepare("INSERT INTO worker_leases (name, holder, lease_until) VALUES ('realprice-fetch', 'other-run', ?)").run(iso(NOW + 3 * MINUTE));
  const quiet = portal();
  assert.equal((await cron(cronEnv(busy.db), { fetcher: quiet.fetcher })).outcome, "lease_busy");
  assert.equal(quiet.calls.length, 0);
  assert.equal(monthRow(busy.database, "sale", "202611").attempts, 0, "임대를 못 얻으면 아무것도 쓰지 않음");

  // 실행이 받는 도중 끊기는 상황: 가짜 fetcher가 끝나지 않으면 그 실행은 시작 표시(attempts)만 남긴다.
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database);
  makeDue(database, "sale", "202611");
  const hanging = portal({}, (kind, ymd) => (kind === "sale" && ymd === "202611" ? new Promise(() => {}) : undefined));
  let at = NOW;
  for (let round = 1; round <= 3; round += 1) {
    void cron(cronEnv(db), { now: at, fetcher: hanging.fetcher }); // 끝나지 않음
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(monthRow(database, "sale", "202611").attempts, round, `${round}번째 시작 표시`);
    at += 6 * MINUTE; // 임대 5분이 지난 뒤
    const marked = await cron(cronEnv(db), { now: at, fetcher: hanging.fetcher });
    assert.deepEqual([marked.outcome, marked.code, marked.months], ["partial", "RT_ABORTED", 0], `${round}번째 끊김 기록`);
    const month = monthRow(database, "sale", "202611");
    assert.deepEqual([month.status, month.last_error, month.attempts, month.next_due_at], ["failed", "RT_ABORTED", round, iso(at + 30 * MINUTE)]);
    const warning = (await status(db, at)).warnings.find((item) => item.code === "RT_ABORTED");
    assert.equal(Boolean(warning), round === 3, `${round}번째: 3번 연속일 때만 경고`);
    at += 31 * MINUTE;
  }
});

test("매일 03시 건수 대조: 매매 일반 API로 최근 3개월 totalCount만 받아(3번, numOfRows=1, 저장 안 함) 다르면 경고, 30일 지난 실행 기록 정리", async () => {
  assert.equal(isDailyCheckWindow(Date.parse("2026-11-17T18:00:00.000Z")), true, "한국 시각 03:00");
  assert.equal(isDailyCheckWindow(Date.parse("2026-11-17T18:09:59.000Z")), true);
  assert.equal(isDailyCheckWindow(Date.parse("2026-11-17T18:10:00.000Z")), false);
  const at = Date.parse("2026-11-17T18:00:00.000Z");
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database, at);
  database.prepare("UPDATE rt_fetch_months SET row_count = 5 WHERE kind = 'sale' AND deal_ymd = '202611'").run();
  database.prepare("UPDATE rt_fetch_months SET row_count = 7, dropped_count = 1 WHERE kind = 'sale' AND deal_ymd = '202610'").run();
  database.prepare("UPDATE rt_fetch_months SET row_count = 3 WHERE kind = 'sale' AND deal_ymd = '202609'").run();
  database.prepare("INSERT INTO rt_fetch_runs (seq, started_at, finished_at, outcome) VALUES (1, ?, ?, 'ok'), (2, ?, ?, 'ok')").run(iso(at - 31 * DAY), iso(at - 31 * DAY), iso(at - DAY), iso(at - DAY));
  const { fetcher, calls } = portal({ "saleBasic:202611": saleMonthItems("202611", 5), "saleBasic:202610": saleMonthItems("202610", 9), "saleBasic:202609": saleMonthItems("202609", 3) });
  const result = await cron(cronEnv(db), { now: at, fetcher });
  assert.deepEqual([result.outcome, result.calls, result.months], ["ok", 3, 0]);
  assert.deepEqual(calls.map((call) => [kindOfUrl(call.url), new URL(call.url).searchParams.get("DEAL_YMD"), new URL(call.url).searchParams.get("numOfRows")]), [
    ["saleBasic", "202611", "1"], ["saleBasic", "202610", "1"], ["saleBasic", "202609", "1"],
  ]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 0, "일반 자료는 저장하지 않음");
  const check = JSON.parse(rows(database, "SELECT value_json FROM settings WHERE key = 'realprice_count_check'")[0].value_json);
  assert.deepEqual(check, { checkedAt: iso(at), diffs: [{ dealYmd: "202610", basic: 9, detail: 8 }], error: null });
  assert.deepEqual(rows(database, "SELECT seq FROM rt_fetch_runs ORDER BY seq").map((row) => row.seq), [2, 3], "30일 지난 실행 기록만 지움");
  assert.equal(rows(database, "SELECT api_calls FROM rt_daily_usage")[0].api_calls, 3);
  const countWarning = (await status(db, at)).warnings.find((warning) => warning.code === "RT_COUNT_DIFF");
  assert.deepEqual(countWarning, { code: "RT_COUNT_DIFF", count: 1, months: ["sale:202610"], checkedAt: iso(at) });
  const quiet = await cron(cronEnv(db), { now: at + 10 * MINUTE, fetcher });
  assert.equal(quiet.outcome, "idle", "03:10 실행은 대조하지 않음");
  assert.equal(calls.length, 3);
});

test("TK-31 성공·실패·처리 중 예외 Cron 뒤 Worker 로그·실행 결과·갱신 상태·D1 모든 표에 키 표식과 serviceKey= 0건, 예외는 scheduled() 밖으로 나가지 않고 RT_INTERNAL만", async () => {
  const leaked = (text) => text.includes(FAKE_SERVICE_KEY) || /serviceKey=/iu.test(text);
  const consoleLines = [];
  const original = { info: console.info, warn: console.warn, log: console.log, error: console.error };
  for (const name of Object.keys(original)) console[name] = (...args) => consoleLines.push(args.map(String).join(" "));
  const outputs = [];
  try {
    const { database, db } = freshDb({ d1Meta: true });
    await seedAllDone(db, database); // 매번 sale:202611 한 달만 차례에 둔다
    let mode = "ok";
    const echo = (url) => `${url} serviceKey=${FAKE_SERVICE_KEY}`;
    const respond = (kind, ymd, pageNo, parsed) => {
      if (mode === "ok") return undefined;
      if (mode === "5xx") return new Response(echo(parsed.href), { status: 500 });
      if (mode === "resultMsg") return xmlResponse(realpriceHeaderOnlyXml("30", echo(parsed.href).replace(/&/gu, "&amp;")));
      if (mode === "redirect") return new Response("", { status: 302, headers: { Location: echo(parsed.href) } });
      if (mode === "throw") return new Error(echo(parsed.href));
      if (mode === "page2") return pageNo === 2 ? new Response(echo(parsed.href), { status: 503 }) : undefined;
      return undefined;
    };
    const { fetcher } = portal({ "sale:202611": saleMonthItems("202611", 1200) }, respond);
    const log = [];
    let at = NOW;
    for (const next of ["ok", "5xx", "resultMsg", "redirect", "throw", "page2"]) {
      mode = next;
      database.prepare("DELETE FROM settings WHERE key = 'realprice_fetch_hold'").run();
      database.prepare("UPDATE rt_fetch_months SET next_due_at = ? WHERE kind = 'sale' AND deal_ymd = '202611'").run(iso(at));
      outputs.push(await cron(cronEnv(db), { now: at, fetcher, log }));
      at += 10 * MINUTE;
    }
    // 처리 중 예외: D1 batch가 요청 주소를 담은 오류를 던짐.
    const exploding = { ...db, prepare: db.prepare, batch: async (statements) => {
      if (statements.length > 3) throw new Error(`https://apis.data.go.kr/x?serviceKey=${FAKE_SERVICE_KEY}`);
      return db.batch(statements);
    } };
    mode = "ok";
    database.prepare("DELETE FROM rt_trades").run(); // 넣기 문장이 생기게(반영 batch 4문장)
    database.prepare("DELETE FROM settings WHERE key = 'realprice_fetch_hold'").run();
    database.prepare("UPDATE rt_fetch_months SET next_due_at = ? WHERE kind = 'sale' AND deal_ymd = '202611'").run(iso(at));
    const internal = await cron(cronEnv(exploding), { now: at, fetcher, log });
    assert.equal(internal.outcome, "internal_error");
    assert.equal(internal.code, "RT_INTERNAL");
    outputs.push(internal);
    assert.deepEqual(log.at(-1), { event: "realprice_cron", level: "warn", run: internal.run, code: "RT_INTERNAL" });
    const month = monthRow(database, "sale", "202611");
    assert.deepEqual([month.last_error, month.attempts, month.next_due_at], ["RT_INTERNAL", 1, iso(at + 30 * MINUTE)], "예외 뒤 정리: 그 달은 30분 뒤, attempts는 그대로(연속 횟수로 셈, 49.3 ③)");
    assert.deepEqual(rows(database, "SELECT outcome, error_code FROM rt_fetch_runs WHERE seq = ?", internal.run), [{ outcome: "failed", error_code: "RT_INTERNAL" }]);
    assert.equal(rows(database, "SELECT lease_until FROM worker_leases")[0].lease_until, iso(0), "임대 반납");
    assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_trades")[0].n, 0, "실패한 batch는 아무것도 남기지 않음");
    // 진입점: 기본 로그(console)로, D1 읽기가 요청 주소를 담은 오류를 던짐.
    const throwingDb = { prepare() { throw new Error(`https://apis.data.go.kr/y?serviceKey=${FAKE_SERVICE_KEY}`); }, batch() {} };
    const viaEntry = await worker.scheduled({ cron: REALPRICE_CRON, scheduledTime: NOW }, cronEnv(throwingDb), {});
    assert.deepEqual(viaEntry, { outcome: "internal_error", run: null, code: "RT_INTERNAL" });
    outputs.push(viaEntry);
    const viaHandler = await handleScheduled({ cron: REALPRICE_CRON }, { get WORK_REALPRICE_ENABLED() { throw new Error(FAKE_SERVICE_KEY); } }, {});
    assert.equal(viaHandler.code, "RT_INTERNAL");

    const codes = outputs.map((output) => output.code);
    assert.deepEqual(codes, [null, "RT_UPSTREAM_FAILED", "RT_KEY_INVALID", "RT_UPSTREAM_FAILED", "RT_UPSTREAM_FAILED", "RT_UPSTREAM_FAILED", "RT_INTERNAL", "RT_INTERNAL"]);
    const tables = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) => row.name);
    const dump = JSON.stringify(tables.map((name) => rows(database, `SELECT * FROM ${name}`)));
    assert.equal(leaked(dump), false, "D1 모든 표");
    assert.equal(leaked(JSON.stringify(log)), false, "Worker 로그(주입)");
    assert.equal(leaked(consoleLines.join("\n")), false, "Worker 로그(console)");
    assert.ok(consoleLines.some((line) => line.includes("RT_INTERNAL")), "기본 로그도 고정 코드는 남김");
    assert.equal(leaked(JSON.stringify(outputs)), false, "실행 결과");
    assert.equal(leaked(JSON.stringify(await status(db, at))), false, "갱신 상태 응답");
  } finally {
    Object.assign(console, original);
  }
});

test("Cron 문자열로 나눔: 모르는 Cron은 D1을 부르지 않고, 진입점 scheduled()는 켜기 값이 없으면 아무것도 하지 않음", async () => {
  const { db } = freshDb();
  const log = [];
  assert.deepEqual(await handleScheduled({ cron: "17 18 * * *" }, cronEnv(db), {}, { log: (entry) => log.push(entry) }), { outcome: "unknown_cron" });
  assert.deepEqual(log, [{ event: "cron_unknown", level: "warn" }]);
  assert.deepEqual(await worker.scheduled({ cron: REALPRICE_CRON }, { WORK_DB: db }, {}), { outcome: "disabled" });
  assert.equal(db.stats.statements, 0);
});

test("D1 meta가 없는 결과(흉내 끔)여도 하루 사용량은 추정 쓰기 행으로 같은 값을 남김", async () => {
  const { database, db } = freshDb();
  const { fetcher } = portal({ "sale:202611": saleMonthItems("202611", 10) });
  const result = await cron(cronEnv(db), { fetcher });
  const [usage] = rows(database, "SELECT * FROM rt_daily_usage");
  assert.equal(usage.rows_written, result.rowsWritten);
  assert.equal(result.rowsWritten, 10 * 2 + 2 + 3, "넣기 10건 × 2 + 달 상태·사용량 2 + 끝 batch 3");
});

test("TK-22 받을 차례가 없으면 읽기만 하고 D1 쓰기 0행(batch 0번, 바뀐 행 0), rt_fetch_runs 기록 없음, 외부 요청 0번", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database);
  const tables = rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => row.name);
  const dump = () => JSON.stringify(tables.map((name) => rows(database, `SELECT * FROM ${name}`)));
  const before = dump();
  const changesBefore = rows(database, "SELECT total_changes() AS n")[0].n;
  const statementsBefore = db.stats.statements;
  const { fetcher, calls } = portal();
  const log = [];
  const result = await cron(cronEnv(db), { fetcher, log });
  assert.equal(result.outcome, "idle");
  assert.equal(calls.length, 0, "외부 요청 0번");
  assert.deepEqual(db.stats.batches, [], "batch 0번");
  assert.equal(rows(database, "SELECT total_changes() AS n")[0].n, changesBefore, "바뀐 행 0(넣기·고치기·지우기 없음)");
  assert.equal(dump(), before, "모든 표 그대로(사용량·임대·실행 기록 포함)");
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM rt_fetch_runs")[0].n, 0);
  assert.equal(db.stats.statements - statementsBefore, 4, "읽기 4문장(구조 번호·달·오늘 사용량·설정)");
  assert.deepEqual(log, [], "할 일이 없으면 로그도 없음");
});

test("처리 중 예외(RT_INTERNAL)도 끊김처럼 attempts를 세어 같은 달이 3번 연속이면 갱신 상태 경고 RT_INTERNAL(달 단위), 성공하면 0으로 돌아감", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  await seedAllDone(db, database);
  database.prepare("DELETE FROM rt_trades").run();
  const { fetcher } = portal({ "sale:202611": saleMonthItems("202611", 1200) });
  // 반영 batch(넣기 2문장 + 상태·사용량 2문장)만 실패시킨다. 시작·정리 batch는 3문장 이하라 그대로 된다.
  const exploding = { ...db, prepare: db.prepare, batch: async (statements) => {
    if (statements.length > 3) throw new Error("batch failed");
    return db.batch(statements);
  } };
  let at = NOW;
  for (let round = 1; round <= 3; round += 1) {
    makeDue(database, "sale", "202611", { at });
    const result = await cron(cronEnv(exploding), { now: at, fetcher });
    assert.deepEqual([result.outcome, result.code], ["internal_error", "RT_INTERNAL"], `${round}번째`);
    const month = monthRow(database, "sale", "202611");
    assert.deepEqual([month.status, month.last_error, month.attempts, month.next_due_at], ["failed", "RT_INTERNAL", round, iso(at + 30 * MINUTE)], `${round}번째`);
    const warnings = (await status(db, at)).warnings;
    const internal = warnings.find((item) => item.code === "RT_INTERNAL");
    assert.deepEqual(internal, round === 3 ? { code: "RT_INTERNAL", count: 1, months: ["sale:202611"] } : undefined, `${round}번째: 3번 연속일 때만 경고`);
    assert.equal(warnings.some((item) => item.code === "RT_ABORTED"), false, "끊김 경고와 따로 셈");
    at += 31 * MINUTE;
  }
  const ok = await cron(cronEnv(db), { now: at, fetcher });
  assert.equal(ok.outcome, "ok");
  const month = monthRow(database, "sale", "202611");
  assert.deepEqual([month.status, month.attempts, month.last_error], ["ok", 0, null]);
  assert.equal((await status(db, at)).warnings.some((item) => item.code === "RT_INTERNAL"), false);
});

test("실행 기록의 끝 시각은 끝 batch를 만들 때 시계를 다시 읽은 값(시작 시각과 다름)", async () => {
  const { database, db } = freshDb({ d1Meta: true });
  const { fetcher } = portal({ "sale:202611": saleMonthItems("202611", 3) });
  let clock = NOW;
  const result = await runRealpriceCron(cronEnv(db), { now: () => (clock += 1500), fetcher, log: () => {}, randomUUID: nextUuid });
  assert.equal(result.outcome, "ok");
  const [run] = rows(database, "SELECT started_at, finished_at FROM rt_fetch_runs");
  assert.equal(run.started_at, iso(NOW + 1500), "시작 시각은 실행 첫 시계");
  assert.ok(run.finished_at > run.started_at, `끝 ${run.finished_at} > 시작 ${run.started_at}`);
});
