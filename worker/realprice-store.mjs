// 단계 P 실거래가: rt_* 표 읽기·쓰기와 받을 차례 계산(설계서 22.5 ~ 22.7절, 22.9절 status·refresh).
// - 한 달 반영은 그 달 저장 행(기본 키 범위)과 새로 받은 행을 거래 ID로 비교해 넣기·고치기·지우기를 한 D1 batch로 한다.
//   여러 행은 행마다 문장을 만들지 않고 종류마다 json_each(?1) 한 문장에 1,000행까지 담는다(TK-58).
// - 같은 batch에서 rt_fetch_months(상태·건수·다음 차례)와 rt_daily_usage(호출·쓰기 추정·읽기)를 함께 고친다.
// - 요청 주소·인증키·응답 본문은 이 파일에 들어오지 않는다(받기 결과의 항목만 받는다).
import { buildTradeRows } from "./realprice-rows.mjs";

export const REALPRICE_KINDS = Object.freeze(["sale", "presale", "rent"]); // 과거 채우기 순서(신고가에 매매가 먼저 필요, 22.7절 순서 2)
export const REALPRICE_START_MONTHS = Object.freeze({ sale: "200601", presale: "200706", rent: "201101" });
export const REALPRICE_MONTHS_PER_RUN = 1; // 무료 플랜 Cron CPU 10ms 때문에 1회 1개월 1종류(Workers Paid 뒤 12로 올리는 작은 PR, DEC-WT-31)
export const REALPRICE_CRON_MINUTES = 10;
export const REALPRICE_DAILY_WRITE_BUDGET = 40_000;
export const REALPRICE_DAILY_READ_SOFT = 1_500_000;
export const REALPRICE_DAILY_READ_HARD = 2_500_000;
export const REALPRICE_READ_WARN_RATIO = 0.8;
export const REALPRICE_LEASE_NAME = "realprice-fetch";
export const REALPRICE_LEASE_MS = 5 * 60 * 1000;
export const REALPRICE_JSON_CHUNK = 1000;
export const REALPRICE_HOLD_MIN_STORED = 20; // 저장 건수가 이 이상인데 새로 받은 건수가 절반보다 적으면 보류(22.6절 5)
export const REALPRICE_DROP_WARN_RATIO = 0.05; // 버린 수가 받은 건수의 5%를 넘으면 경고(2026-11-19 B-2)
export const REALPRICE_ABORT_WARN_ATTEMPTS = 3; // 같은 달이 3번 연속 끊기면 경고(22.6절 6)
export const REALPRICE_ABORT_RETRY_MS = 30 * 60 * 1000;
export const REALPRICE_RUNS_KEEP_DAYS = 30;
export const REALPRICE_RECENT_MONTHS = 4; // 이번 달과 직전 3개월
export const REALPRICE_COUNT_CHECK_MONTHS = 3; // 매일 03시 매매 일반 API 건수 대조(DEC-WT-32)
export const REALPRICE_NEVER = "9999-12-31T23:59:59.999Z"; // 37번째 달보다 오래된 달: 다시 받지 않음
// settings 행(구조 변경 없이 키·값으로 둠): 키·종류 단위 오류 뒤 미룸, 매일 건수 대조 결과.
export const REALPRICE_HOLD_SETTING = "realprice_fetch_hold";
export const REALPRICE_COUNT_CHECK_SETTING = "realprice_count_check";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const pad2 = (value) => String(value).padStart(2, "0");
const iso = (ms) => new Date(ms).toISOString();

// ── 달 계산 ──

// 한국 시각 기준 이번 달(YYYYMM).
export function kstMonth(nowMs) {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}${pad2(kst.getUTCMonth() + 1)}`;
}

export function utcDay(nowMs) {
  return iso(nowMs).slice(0, 10);
}

const monthIndex = (ymd) => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(4, 6)) - 1;
const monthFromIndex = (index) => `${Math.floor(index / 12)}${pad2((index % 12) + 1)}`;

// 이번 달과의 차이(0 = 이번 달).
export function monthAge(currentYmd, dealYmd) {
  return monthIndex(currentYmd) - monthIndex(dealYmd);
}

// 받을 달 목록(시작 달 ~ 이번 달, 오래된 달부터).
export function expectedMonths(kind, currentYmd) {
  const start = monthIndex(REALPRICE_START_MONTHS[kind]);
  const end = monthIndex(currentYmd);
  const months = [];
  for (let index = start; index <= end; index += 1) months.push(monthFromIndex(index));
  return months;
}

// 다시 받는 주기(22.7절 표). 이번 달을 1번째로 세는 서수로 읽는다:
// 1 ~ 4번째 달(나이 0 ~ 3) 6시간, 5 ~ 12번째(4 ~ 11) 7일, 13 ~ 36번째(12 ~ 35) 30일, 그보다 오래된 달은 다시 받지 않음.
export function refreshTier(age) {
  if (age < REALPRICE_RECENT_MONTHS) return 1;
  if (age <= 11) return 3;
  if (age <= 35) return 4;
  return null;
}

export function nextDueAfterSuccess(age, nowMs) {
  const tier = refreshTier(age);
  if (tier === 1) return iso(nowMs + 6 * HOUR_MS);
  if (tier === 3) return iso(nowMs + 7 * DAY_MS);
  if (tier === 4) return iso(nowMs + 30 * DAY_MS);
  return REALPRICE_NEVER;
}

// 키·종류 단위 미룸(settings 값). { all: { until, code } | null, kinds: { sale?: { until, code } } }
export function parseHold(valueJson) {
  const empty = { all: null, kinds: {} };
  if (typeof valueJson !== "string") return empty;
  let value;
  try {
    value = JSON.parse(valueJson);
  } catch {
    return empty;
  }
  const entry = (raw) => (raw && typeof raw.until === "string" && typeof raw.code === "string" ? { until: raw.until, code: raw.code } : null);
  const kinds = {};
  for (const kind of REALPRICE_KINDS) {
    const held = entry(value?.kinds?.[kind]);
    if (held) kinds[kind] = held;
  }
  return { all: entry(value?.all), kinds };
}

function isHeld(hold, kind, nowIso) {
  return Boolean((hold.all && hold.all.until > nowIso) || (hold.kinds[kind] && hold.kinds[kind].until > nowIso));
}

// 받을 차례 고르기(읽기만, 22.7절 표의 순서). months: rt_fetch_months 행(아직 없는 달은 넣기 전 모양으로 함께 줌).
// 쓰기 예산을 넘으면 최근 4개월만, 읽기 첫 상한을 넘으면 과거 채우기(한 번도 받지 못한 달)를 뺀다.
export function pickDueMonths(months, { nowMs, hold = { all: null, kinds: {} }, writeBudgetExceeded = false, readSoftExceeded = false, limit = REALPRICE_MONTHS_PER_RUN }) {
  const nowIso = iso(nowMs);
  const currentYmd = kstMonth(nowMs);
  const kindOrder = (kind) => REALPRICE_KINDS.indexOf(kind);
  const candidates = [];
  const blocked = { writeBudget: 0, readBudget: 0 };
  for (const month of months) {
    if (month.next_due_at > nowIso || isHeld(hold, month.kind, nowIso)) continue;
    const age = monthAge(currentYmd, month.deal_ymd);
    let order;
    if (age < REALPRICE_RECENT_MONTHS) order = 1;
    else if (month.last_success_at === null || month.last_success_at === undefined) order = 2;
    else {
      const tier = refreshTier(age);
      if (tier === null) continue; // 37번째 달보다 오래된 달은 다시 받지 않음
      order = tier;
    }
    if (order > 1 && writeBudgetExceeded) {
      blocked.writeBudget += 1;
      continue;
    }
    if (order === 2 && readSoftExceeded) {
      blocked.readBudget += 1;
      continue;
    }
    candidates.push({ month, order });
  }
  candidates.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    if (a.order === 2) {
      // 과거 채우기: 매매 → 분양권 → 전월세, 종류 안에서는 최근 달부터.
      return kindOrder(a.month.kind) - kindOrder(b.month.kind) || (a.month.deal_ymd < b.month.deal_ymd ? 1 : -1);
    }
    if (a.month.next_due_at !== b.month.next_due_at) return a.month.next_due_at < b.month.next_due_at ? -1 : 1;
    return kindOrder(a.month.kind) - kindOrder(b.month.kind) || (a.month.deal_ymd < b.month.deal_ymd ? 1 : -1);
  });
  return { picked: candidates.slice(0, limit).map((candidate) => candidate.month), blocked, dueCount: candidates.length };
}

// ── 문장 ──

const READ_MONTHS_SQL = "SELECT kind, deal_ymd, status, row_count, dropped_count, held_count, attempts, last_error, last_success_at, next_due_at FROM rt_fetch_months";

export function readMonthsStatement(db) {
  return db.prepare(READ_MONTHS_SQL);
}

export function readUsageStatement(db, nowMs) {
  return db.prepare("SELECT day_utc, api_calls, rows_written, rows_read FROM rt_daily_usage WHERE day_utc = ?1").bind(utcDay(nowMs));
}

export function readRealpriceSettingsStatement(db) {
  return db.prepare("SELECT key, value_json FROM settings WHERE key IN (?1, ?2)").bind(REALPRICE_HOLD_SETTING, REALPRICE_COUNT_CHECK_SETTING);
}

// 아직 없는 달을 넣는다(INSERT OR IGNORE, 처음 실행은 약 700행을 한 문장에). pairs: [[kind, deal_ymd], …]
export function seedMonthsStatement(db, pairs, nowMs) {
  return db.prepare("INSERT OR IGNORE INTO rt_fetch_months (kind, deal_ymd, next_due_at) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2 FROM json_each(?1)")
    .bind(JSON.stringify(pairs), iso(nowMs));
}

// 하루 사용량 더하기(UTC 날짜 행). rows_written은 batch 전에 세는 추정값이고, 실행 끝에 D1 meta 값으로 맞춘다(work-scheduled.mjs).
const ADD_USAGE_SQL = `INSERT INTO rt_daily_usage (day_utc, api_calls, rows_written, rows_read) VALUES (?1, ?2, ?3, ?4)
ON CONFLICT(day_utc) DO UPDATE SET api_calls = api_calls + excluded.api_calls, rows_written = rows_written + excluded.rows_written, rows_read = rows_read + excluded.rows_read`;
export function addUsageStatement(db, nowMs, { apiCalls = 0, rowsWritten = 0, rowsRead = 0 }) {
  return db.prepare(ADD_USAGE_SQL)
    .bind(utcDay(nowMs), apiCalls, Math.max(0, rowsWritten), Math.max(0, rowsRead));
}

export function upsertSettingStatement(db, key, value, nowMs) {
  return db.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), iso(nowMs));
}

// ── 한 달 반영(22.6절) ──

// rt_trades에 받은 그대로 넣는 칸(trade_key ~ extra_json)과 바뀔 수 있는 칸(서명에 넣지 않은 칸).
const TRADE_COLUMNS = Object.freeze([
  "trade_key", "kind", "deal_ymd", "deal_date", "umd_nm", "jibun", "apt_seq", "apt_nm", "area_x100", "floor", "build_year",
  "price_won", "deposit_won", "monthly_rent_won", "dealing_gbn", "cancelled", "cancelled_on", "registered_on", "apt_dong", "extra_json",
]);
export const REALPRICE_VARIABLE_COLUMNS = Object.freeze([
  "umd_nm", "jibun", "apt_nm", "build_year", "dealing_gbn", "cancelled", "cancelled_on", "registered_on", "apt_dong", "extra_json",
]);
const INSERT_COLUMNS = Object.freeze([...TRADE_COLUMNS, "cmp_seq"]);
const UPDATE_COLUMNS = Object.freeze(["trade_key", ...REALPRICE_VARIABLE_COLUMNS]);
const extract = (columns) => columns.map((column, index) => `json_extract(value, '$[${index}]') AS ${column}`).join(", ");

const INSERT_TRADES_SQL = `INSERT INTO rt_trades (${INSERT_COLUMNS.join(", ")}, is_backfill, first_seen_at, updated_at)
SELECT ${extract(INSERT_COLUMNS)}, ?2, ?3, ?3 FROM json_each(?1)`;
const UPDATE_TRADES_SQL = `UPDATE rt_trades SET ${REALPRICE_VARIABLE_COLUMNS.map((column) => `${column} = n.${column}`).join(", ")}, updated_at = ?2
FROM (SELECT ${extract(UPDATE_COLUMNS)} FROM json_each(?1)) AS n WHERE rt_trades.trade_key = n.trade_key`;
const DELETE_TRADES_SQL = "DELETE FROM rt_trades WHERE trade_key IN (SELECT value FROM json_each(?1))";
const READ_MONTH_TRADES_SQL = `SELECT ${UPDATE_COLUMNS.join(", ")} FROM rt_trades WHERE trade_key >= ?1 AND trade_key < ?2`;

// 신고가 비교용 단지 번호(22.5절). TK-43(2026-11-19)에서 옛 매매의 aptSeq 빈 값이 0건이라 rt_complex_keys 없이 apt_seq를 그대로 쓴다(D-4).
export function cmpSeqFor(row) {
  return row.apt_seq ?? null;
}

// 그 달의 기본 키 범위: 'sale:202610:' 이상 'sale:202610;' 미만(';'는 ':' 다음 글자).
export function monthKeyRange(kind, dealYmd) {
  return [`${kind}:${dealYmd}:`, `${kind}:${dealYmd};`];
}

function chunk(list, size = REALPRICE_JSON_CHUNK) {
  const parts = [];
  for (let start = 0; start < list.length; start += size) parts.push(list.slice(start, start + size));
  return parts;
}

const sameValue = (a, b) => (a ?? null) === (b ?? null);

// 저장 행과 새 행을 거래 ID로 비교한다. { inserts, updates, deletes } (행 목록과 ID 목록).
export function diffMonthRows(existingRows, newRows) {
  const existing = new Map(existingRows.map((row) => [row.trade_key, row]));
  const inserts = [];
  const updates = [];
  const seen = new Set();
  for (const row of newRows) {
    seen.add(row.trade_key);
    const stored = existing.get(row.trade_key);
    if (!stored) inserts.push(row);
    else if (REALPRICE_VARIABLE_COLUMNS.some((column) => !sameValue(stored[column], row[column]))) updates.push(row);
  }
  const deletes = existingRows.filter((row) => !seen.has(row.trade_key)).map((row) => row.trade_key);
  return { inserts, updates, deletes };
}

// 쓰기 행 추정(batch 전에 하루 예산에 넣는 값). 매매는 부분 색인 때문에 넣기·지우기 1건이 약 2행(22.5절 추정, TK-11 실측으로 확인).
export function estimateRowsWritten(kind, { inserted = 0, updated = 0, deleted = 0, extra = 0 }) {
  const perRow = kind === "sale" ? 2 : 1;
  return inserted * perRow + updated + deleted * perRow + extra;
}

export function rowsWrittenOf(results) {
  return (Array.isArray(results) ? results : [results]).reduce((sum, result) => sum + Number(result?.meta?.rows_written ?? 0), 0);
}

export function rowsReadOf(result) {
  return Number(result?.meta?.rows_read ?? 0);
}

export function hasMeta(results) {
  return (Array.isArray(results) ? results : [results]).every((result) => typeof result?.meta?.rows_written === "number");
}

// 받은 한 달을 반영한다. month: rt_fetch_months 행(받기 전 상태). fetched: fetchRealpriceMonth 성공 결과.
// 돌려주는 값: { outcome: "ok" | "held", inserted, updated, deleted, droppedCount, cleared, rowsRead, rowsWrittenEstimate, results, statements }
export async function applyRealpriceMonth(db, { month, fetched, nowMs, apiCalls }) {
  const { kind, deal_ymd: dealYmd } = month;
  const built = await buildTradeRows({ kind, dealYmd, items: fetched.items });
  const [from, to] = monthKeyRange(kind, dealYmd);
  const read = await db.prepare(READ_MONTH_TRADES_SQL).bind(from, to).all();
  const existingRows = read.results ?? [];
  const rowsRead = rowsReadOf(read);
  const nowIso = iso(nowMs);
  const newCount = built.rows.length;
  const storedCount = existingRows.length;

  // 덜 온 응답 막기(22.6절 5): 저장 20건 이상인데 절반보다 적게 오면 보류. 다음 받기에 같은 건수가 다시 오면 그때 반영.
  const sharpDrop = storedCount >= REALPRICE_HOLD_MIN_STORED && newCount * 2 < storedCount;
  const confirmed = month.status === "held" && month.held_count === newCount;
  const age = monthAge(kstMonth(nowMs), dealYmd);
  const nextDueAt = nextDueAfterSuccess(age, nowMs);
  if (sharpDrop && !confirmed) {
    const statements = [
      db.prepare("UPDATE rt_fetch_months SET status = 'held', held_count = ?1, attempts = 0, last_error = 'RT_HELD_DROP', next_due_at = ?2 WHERE kind = ?3 AND deal_ymd = ?4")
        .bind(newCount, nextDueAt, kind, dealYmd),
    ];
    const rowsWrittenEstimate = estimateRowsWritten(kind, { extra: 2 });
    statements.push(addUsageStatement(db, nowMs, { apiCalls, rowsWritten: rowsWrittenEstimate, rowsRead }));
    const results = await db.batch(statements);
    return { outcome: "held", inserted: 0, updated: 0, deleted: 0, droppedCount: built.droppedCount, cleared: built.cleared, heldCount: newCount, rowsRead, rowsWrittenEstimate, results, statements: statements.length };
  }

  const { inserts, updates, deletes } = diffMonthRows(existingRows, built.rows);
  // 그 달을 한 번도 받지 못한 상태에서 들어온 행은 최근 달이어도 처음 채우기로 표시한다(22.6절 7).
  const isBackfill = month.last_success_at ? 0 : 1;
  const statements = [];
  for (const part of chunk(inserts)) {
    const values = part.map((row) => INSERT_COLUMNS.map((column) => (column === "cmp_seq" ? cmpSeqFor(row) : row[column])));
    statements.push(db.prepare(INSERT_TRADES_SQL).bind(JSON.stringify(values), isBackfill, nowIso));
  }
  for (const part of chunk(updates)) {
    const values = part.map((row) => UPDATE_COLUMNS.map((column) => row[column]));
    statements.push(db.prepare(UPDATE_TRADES_SQL).bind(JSON.stringify(values), nowIso));
  }
  for (const part of chunk(deletes)) statements.push(db.prepare(DELETE_TRADES_SQL).bind(JSON.stringify(part)));
  statements.push(db.prepare("UPDATE rt_fetch_months SET status = 'ok', row_count = ?1, dropped_count = ?2, held_count = NULL, attempts = 0, last_error = NULL, last_success_at = ?3, next_due_at = ?4 WHERE kind = ?5 AND deal_ymd = ?6")
    .bind(newCount, built.droppedCount, nowIso, nextDueAt, kind, dealYmd));
  const rowsWrittenEstimate = estimateRowsWritten(kind, { inserted: inserts.length, updated: updates.length, deleted: deletes.length, extra: 2 });
  statements.push(addUsageStatement(db, nowMs, { apiCalls, rowsWritten: rowsWrittenEstimate, rowsRead }));
  const results = await db.batch(statements);
  return {
    outcome: "ok",
    inserted: inserts.length,
    updated: updates.length,
    deleted: deletes.length,
    droppedCount: built.droppedCount,
    cleared: built.cleared,
    rowsRead,
    rowsWrittenEstimate,
    results,
    statements: statements.length,
  };
}

// ── 갱신 상태(GET /work/realprice/status, 22.9절) ──

const warningMonths = (rows) => rows.slice(0, 12).map((row) => `${row.kind}:${row.deal_ymd}`);

// 매매 자료가 이번 달부터 거꾸로 빠짐없이 받아진 가장 오래된 달(YYYY-MM). 이번 달도 아직이면 null.
export function saleCoveredThrough(monthRows, currentYmd) {
  const done = new Set(monthRows.filter((row) => row.kind === "sale" && row.last_success_at).map((row) => row.deal_ymd));
  let covered = null;
  for (const dealYmd of expectedMonths("sale", currentYmd).reverse()) {
    if (!done.has(dealYmd)) break;
    covered = dealYmd;
  }
  return covered ? `${covered.slice(0, 4)}-${covered.slice(4, 6)}` : null;
}

export function buildRealpriceWarnings({ monthRows, usage, hold, countCheck, nowMs, retryPolicy }) {
  const nowIso = iso(nowMs);
  const warnings = [];
  const aborted = monthRows.filter((row) => row.attempts >= REALPRICE_ABORT_WARN_ATTEMPTS);
  if (aborted.length > 0) warnings.push({ code: "RT_ABORTED", count: aborted.length, months: warningMonths(aborted) });
  const held = monthRows.filter((row) => row.status === "held");
  if (held.length > 0) warnings.push({ code: "RT_HELD_DROP", count: held.length, months: warningMonths(held) });
  // B-2: 버린 수가 받은 건수(버리기 전 = 저장 + 버림)의 5%를 넘는 달.
  const dropped = monthRows.filter((row) => row.dropped_count > 0 && row.dropped_count > (row.row_count + row.dropped_count) * REALPRICE_DROP_WARN_RATIO);
  if (dropped.length > 0) warnings.push({ code: "RT_DROPPED_ROWS", count: dropped.length, months: warningMonths(dropped) });
  if (usage.rows_written >= REALPRICE_DAILY_WRITE_BUDGET) warnings.push({ code: "RT_WRITE_BUDGET", count: usage.rows_written, months: [] });
  if (usage.rows_read >= REALPRICE_DAILY_READ_HARD) warnings.push({ code: "RT_READ_BUDGET", level: "hard", count: usage.rows_read, months: [] });
  else if (usage.rows_read >= REALPRICE_DAILY_READ_SOFT) warnings.push({ code: "RT_READ_BUDGET", level: "soft", count: usage.rows_read, months: [] });
  else if (usage.rows_read >= REALPRICE_DAILY_READ_SOFT * REALPRICE_READ_WARN_RATIO) warnings.push({ code: "RT_READ_BUDGET_NEAR", count: usage.rows_read, months: [] });
  // 종류 단위 오류 뒤 미룸(활용 신청·서비스 폐기·요청 값 오류): 오류표에서 경고로 정한 것만.
  const holds = [];
  if (hold.all && hold.all.until > nowIso) holds.push({ scope: "all", kind: null, ...hold.all });
  for (const kind of REALPRICE_KINDS) if (hold.kinds[kind] && hold.kinds[kind].until > nowIso) holds.push({ scope: "kind", kind, ...hold.kinds[kind] });
  for (const entry of holds) {
    if (retryPolicy[entry.code]?.warning) warnings.push({ code: entry.code, count: 1, months: [], kind: entry.kind, until: entry.until });
  }
  const diffs = Array.isArray(countCheck?.diffs) ? countCheck.diffs : [];
  if (diffs.length > 0) warnings.push({ code: "RT_COUNT_DIFF", count: diffs.length, months: diffs.slice(0, 12).map((diff) => `sale:${diff.dealYmd}`), checkedAt: countCheck.checkedAt ?? null });
  return warnings;
}

// 상태를 읽는다(쓰기 없음, 감사 기록 없음). retryPolicy: realprice-fetch.mjs의 REALPRICE_RETRY_POLICY.
export async function readRealpriceStatus(db, { nowMs, retryPolicy }) {
  const [monthsResult, usageRow, runsResult, unmatchedRow, settingsResult] = [
    await readMonthsStatement(db).all(),
    await readUsageStatement(db, nowMs).first(),
    await db.prepare("SELECT seq, started_at, finished_at, months_done, api_calls, inserted, updated, deleted, rows_written, outcome, error_code FROM rt_fetch_runs ORDER BY seq DESC LIMIT 10").all(),
    await db.prepare("SELECT COUNT(*) AS n FROM rt_trades WHERE kind = 'sale' AND cmp_seq IS NULL").first(),
    await readRealpriceSettingsStatement(db).all(),
  ];
  const monthRows = monthsResult.results ?? [];
  const usage = { api_calls: Number(usageRow?.api_calls ?? 0), rows_written: Number(usageRow?.rows_written ?? 0), rows_read: Number(usageRow?.rows_read ?? 0) };
  const settings = Object.fromEntries((settingsResult.results ?? []).map((row) => [row.key, row.value_json]));
  const hold = parseHold(settings[REALPRICE_HOLD_SETTING]);
  let countCheck = null;
  try {
    countCheck = settings[REALPRICE_COUNT_CHECK_SETTING] ? JSON.parse(settings[REALPRICE_COUNT_CHECK_SETTING]) : null;
  } catch {
    countCheck = null;
  }
  const currentYmd = kstMonth(nowMs);
  const backfill = {};
  for (const kind of ["sale", "rent", "presale"]) {
    const expected = new Set(expectedMonths(kind, currentYmd));
    backfill[kind] = { done: monthRows.filter((row) => row.kind === kind && row.last_success_at && expected.has(row.deal_ymd)).length, total: expected.size };
  }
  const lastSuccessAt = monthRows.reduce((latest, row) => (row.last_success_at && (!latest || row.last_success_at > latest) ? row.last_success_at : latest), null);
  const runs = (runsResult.results ?? []).map((row) => ({
    seq: row.seq,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    monthsDone: row.months_done,
    apiCalls: row.api_calls,
    inserted: row.inserted,
    updated: row.updated,
    deleted: row.deleted,
    rowsWritten: row.rows_written,
    outcome: row.outcome,
    errorCode: row.error_code,
  }));
  const lastErrorRun = runs.find((run) => run.errorCode);
  return {
    lastSuccessAt,
    coveredThrough: saleCoveredThrough(monthRows, currentYmd),
    backfill,
    recordHighReady: backfill.sale.done === backfill.sale.total,
    lastError: lastErrorRun ? { code: lastErrorRun.errorCode, at: lastErrorRun.finishedAt ?? lastErrorRun.startedAt } : null,
    warnings: buildRealpriceWarnings({ monthRows, usage, hold, countCheck, nowMs, retryPolicy }),
    today: {
      apiCalls: usage.api_calls,
      rowsWritten: usage.rows_written,
      rowsRead: usage.rows_read,
      writeBudget: REALPRICE_DAILY_WRITE_BUDGET,
      readSoftLimit: REALPRICE_DAILY_READ_SOFT,
      readHardLimit: REALPRICE_DAILY_READ_HARD,
    },
    unmatchedSaleRows: Number(unmatchedRow?.n ?? 0),
    runs,
  };
}

// ── 지금 다시 받기(POST /work/realprice/refresh, 22.7절) ──

// WHERE true: INSERT … SELECT 뒤의 ON CONFLICT를 SQLite가 조인 문법으로 읽지 않게 한다.
const REFRESH_MONTHS_SQL = `INSERT INTO rt_fetch_months (kind, deal_ymd, next_due_at) SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), ?2 FROM json_each(?1) WHERE true
ON CONFLICT(kind, deal_ymd) DO UPDATE SET next_due_at = excluded.next_due_at`;

// 최근 4개월 3종류(12건)의 next_due_at을 지금으로 바꾸고(아직 없는 달은 넣음), 키·종류 단위 미룸을 푼다. 외부 요청은 보내지 않는다.
export function refreshStatements(db, nowMs) {
  const currentYmd = kstMonth(nowMs);
  const pairs = [];
  for (const kind of REALPRICE_KINDS) {
    for (let age = 0; age < REALPRICE_RECENT_MONTHS; age += 1) pairs.push([kind, monthFromIndex(monthIndex(currentYmd) - age)]);
  }
  return {
    queuedMonths: pairs.length,
    // 최근 달은 차례의 맨 앞(순서 1)이라 다른 달이 기다리고 있어도 이 12건이 먼저 받아진다. Cron 1번에 REALPRICE_MONTHS_PER_RUN건.
    estimatedMinutes: Math.ceil(pairs.length / REALPRICE_MONTHS_PER_RUN) * REALPRICE_CRON_MINUTES,
    statements: [
      db.prepare(REFRESH_MONTHS_SQL).bind(JSON.stringify(pairs), iso(nowMs)),
      db.prepare("DELETE FROM settings WHERE key = ?1").bind(REALPRICE_HOLD_SETTING),
    ],
  };
}
