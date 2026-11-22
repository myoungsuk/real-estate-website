// Worker Cron 진입점(설계서 22.7절). worker/index.mjs의 scheduled()가 부르고, controller.cron 문자열로 할 일을 나눈다.
// 지금은 단계 P 실거래가 받기(`*/10 * * * *`) 하나뿐이다. 단계 2·4 Cron은 그 PR에서 이 파일에 더한다.
// 같은 Cron의 한국 시각 03:00 차례에는 실거래가 켜기 값을 보기 **전에** 글 초안 보관 정리(P3, DEC-WT-24)를 먼저 한다(지시서 D-5).
// 조건은 D1이 있고 구조 번호가 4 이상인 것뿐이다(글 초안·실거래가 켜기 값과 상관없이, 꺼 둔 뒤에도 오래된 초안이 지워지게).
// - 맨 바깥에서 모든 예외를 잡아 실행 번호와 고정 코드 RT_INTERNAL만 남긴다. 잡지 못한 예외는 플랫폼이 메시지·스택을
//   기록해 그 안에 요청 주소(인증키 포함)가 섞일 수 있어서다.
// - 로그에는 실행 번호, 받은 달 수, 호출 수, 넣기·고치기·지우기 수, rows_written, 결과 코드만 남긴다(22.12절).
//   요청 주소·인증키·응답 본문·error.message는 남기지 않는다.
import { fetchRealpriceMonth, fetchRealpriceTotalCount, planRealpriceRetry } from "./realprice-fetch.mjs";
import {
  REALPRICE_ABORT_RETRY_MS,
  REALPRICE_COUNT_CHECK_MONTHS,
  REALPRICE_COUNT_CHECK_SETTING,
  REALPRICE_DAILY_READ_HARD,
  REALPRICE_DAILY_READ_SOFT,
  REALPRICE_DAILY_WRITE_BUDGET,
  REALPRICE_HOLD_SETTING,
  REALPRICE_KINDS,
  REALPRICE_LEASE_MS,
  REALPRICE_LEASE_NAME,
  REALPRICE_MONTHS_PER_RUN,
  REALPRICE_RUNS_KEEP_DAYS,
  addUsageStatement,
  applyRealpriceMonth,
  expectedMonths,
  hasMeta,
  kstMonth,
  parseHold,
  pickDueMonths,
  readMonthsStatement,
  readRealpriceSettingsStatement,
  readUsageStatement,
  rowsReadOf,
  rowsWrittenOf,
  seedMonthsStatement,
  upsertSettingStatement,
} from "./realprice-store.mjs";
import { changesOf } from "./work-audit.mjs";
import { WORK_SCHEMA_VERSION, readSchemaVersion } from "./work-api.mjs";
import { getRealpriceConfigState } from "./work-public-tools.mjs";
import { cleanupBlogDrafts } from "./work-blog.mjs";
import { expireTrash } from "./work-trash.mjs";
import { hasD1 } from "./work-security.mjs";

export const REALPRICE_CRON = "*/10 * * * *";
const LOG_EVENT = "realprice_cron";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KST_OFFSET_MS = 9 * HOUR_MS;
const iso = (ms) => new Date(ms).toISOString();
// 실행이 끝날 때 쓰는 문장(실행 기록·사용량·임대 반납 등)의 쓰기 행 추정. 이 batch는 끝난 뒤 다시 잴 수 없어 추정으로 더한다.
const FINAL_BATCH_ROWS = 3;

function defaultLog(entry) {
  try {
    (entry.level === "warn" ? console.warn : console.info)(JSON.stringify(entry));
  } catch {
    // 로그 장애는 무시한다.
  }
}

// 한국 시각 03:00 ~ 03:09에 시작한 실행(하루 1번): 매매 일반 API 건수 대조와 오래된 실행 기록 정리(22.7절).
export function isDailyCheckWindow(nowMs) {
  const kst = new Date(nowMs + KST_OFFSET_MS);
  return kst.getUTCHours() === 3 && kst.getUTCMinutes() < 10;
}

const LEASE_SQL = `INSERT INTO worker_leases (name, holder, lease_until) VALUES (?1, ?2, ?3)
ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, lease_until = excluded.lease_until WHERE worker_leases.lease_until < ?4`;
// 반납: 자기 실행 ID일 때만 바로 끝난 임대로 바꾼다(다른 실행이 이미 넘겨받은 임대를 풀지 않게).
const RELEASE_SQL = "UPDATE worker_leases SET lease_until = ?1 WHERE name = ?2 AND holder = ?3";
// 시작 표시가 남은 달(이전 실행이 끝나지 못함)을 RT_ABORTED로 적고 30분 뒤 차례로 둔다. attempts는 그대로 두어 연속 횟수를 센다.
// 조건(attempts > 0 AND last_error IS NULL)을 다시 걸어, 미리 읽은 뒤 그 실행이 끝냈으면 아무것도 바꾸지 않는다.
const MARK_ABORTED_SQL = `UPDATE rt_fetch_months SET status = 'failed', last_error = 'RT_ABORTED', next_due_at = ?2
WHERE (kind, deal_ymd) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1)) AND attempts > 0 AND last_error IS NULL`;
// 받기 시작 표시(attempts + 1, last_error 비움). 끝나면 반영·실패 문장이 attempts를 0으로 되돌린다.
const START_MONTH_SQL = `UPDATE rt_fetch_months SET attempts = attempts + 1, last_error = NULL
WHERE kind = ?1 AND deal_ymd = ?2 AND next_due_at <= ?3 AND NOT (attempts > 0 AND last_error IS NULL)`;
const FAIL_MONTH_SQL = "UPDATE rt_fetch_months SET status = 'failed', attempts = 0, last_error = ?1, next_due_at = ?2 WHERE kind = ?3 AND deal_ymd = ?4";
// 처리 중 예외: 끊김(RT_ABORTED)과 같은 규칙으로 attempts를 그대로 두어 연속 횟수를 센다. 같은 달이 3번 연속이면 갱신 상태 경고
// RT_INTERNAL이 된다(2026-11-19 PR #76 TR-11 49.3 ③). 다음 실행의 시작 표시가 attempts를 1 더 올리고, 성공·받기 오류로 끝나면 0이 된다.
const INTERNAL_FAIL_MONTH_SQL = "UPDATE rt_fetch_months SET status = 'failed', last_error = 'RT_INTERNAL', next_due_at = ?1 WHERE kind = ?2 AND deal_ymd = ?3";
const FINISH_RUN_SQL = `UPDATE rt_fetch_runs SET finished_at = ?2, months_done = ?3, api_calls = ?4, inserted = ?5, updated = ?6, deleted = ?7,
rows_written = ?8, outcome = ?9, error_code = ?10 WHERE seq = ?1`;
// 사용량 보정(실제 meta − 이미 더한 추정, 아직 더하지 않은 읽기·호출). 쓰기 행은 0 아래로 내려가지 않는다.
const ADJUST_USAGE_SQL = `INSERT INTO rt_daily_usage (day_utc, api_calls, rows_written, rows_read) VALUES (?1, ?2, max(0, ?3), ?4)
ON CONFLICT(day_utc) DO UPDATE SET api_calls = api_calls + excluded.api_calls, rows_written = max(0, rows_written + ?3), rows_read = rows_read + excluded.rows_read`;

// 키·종류 단위 오류 뒤 미룸을 settings 값에 합친다(구조 변경 없이 1행).
function mergeHold(hold, plan, kind) {
  const next = { all: hold.all, kinds: { ...hold.kinds } };
  const entry = { until: plan.retryAt, code: plan.code };
  if (plan.scope === "all") next.all = entry;
  else next.kinds[kind] = entry;
  return next;
}

// 매일 03시: 매매 일반 API(15126469)로 최근 3개월 totalCount만 받아 상세 자료의 받은 건수(저장 + 버림)와 비교한다. 저장하지 않는다.
async function runCountCheck({ env, fetcher, monthRows, nowMs }) {
  const currentYmd = kstMonth(nowMs);
  const recent = expectedMonths("sale", currentYmd).slice(-REALPRICE_COUNT_CHECK_MONTHS).reverse();
  const stored = new Map(monthRows.filter((row) => row.kind === "sale" && row.last_success_at).map((row) => [row.deal_ymd, row]));
  const diffs = [];
  let calls = 0;
  for (const dealYmd of recent) {
    const result = await fetchRealpriceTotalCount({ api: "saleBasic", dealYmd, serviceKey: env.MOLIT_RT_SERVICE_KEY.trim(), fetcher });
    calls += result.calls;
    if (!result.ok) return { checkedAt: iso(nowMs), diffs, error: result.code, calls };
    const row = stored.get(dealYmd);
    if (!row) continue; // 상세 자료를 아직 받지 못한 달은 비교하지 않는다
    const detail = Number(row.row_count) + Number(row.dropped_count);
    if (detail !== result.totalCount) diffs.push({ dealYmd, basic: result.totalCount, detail });
  }
  return { checkedAt: iso(nowMs), diffs, error: null, calls };
}

async function runInner(env, options, state) {
  const db = options.db ?? env?.WORK_DB;
  const log = options.log ?? defaultLog;
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  const nowIso = iso(nowMs);
  const fetcher = options.fetcher ?? fetch;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  // ⓪ 03:00 차례면 글 초안 보관 정리, 휴지통 7일 영구 삭제부터(켜기 값과 상관없이, D-5·T-9). 실패해도 아래로 이어 간다.
  await runBlogCleanup(db, nowMs, log);
  await runTrashExpire(db, nowMs, log, randomUUID, options.files ?? env?.WORK_FILES);

  // ① 켜기 값·설정. 꺼져 있으면 D1·외부 요청 없이 끝(로그도 남기지 않음, 10분마다 쌓이지 않게).
  const config = getRealpriceConfigState(env, db);
  if (config === "disabled") return { outcome: "disabled" };
  if (config !== "enabled") {
    log({ event: LOG_EVENT, level: "warn", code: "REALPRICE_CONFIG_MISSING" });
    return { outcome: "config_missing" };
  }

  // ② 구조 번호. 다르면 경고 로그만 남기고 끝.
  const schemaVersion = await readSchemaVersion(db);
  if (schemaVersion !== WORK_SCHEMA_VERSION) {
    const code = schemaVersion !== null && schemaVersion > WORK_SCHEMA_VERSION ? "WORK_SCHEMA_AHEAD" : "WORK_SCHEMA_OUTDATED";
    log({ event: LOG_EVENT, level: "warn", code });
    return { outcome: "schema_mismatch", code };
  }

  // ③ 받을 차례 고르기(읽기만).
  const monthsRead = await readMonthsStatement(db).all();
  const usageRow = await readUsageStatement(db, nowMs).first();
  const settingsRead = await readRealpriceSettingsStatement(db).all();
  // .first()는 D1에서도 meta를 돌려주지 않아 1행으로 센다(구조 번호·오늘 사용량).
  let pendingRowsRead = 1 + rowsReadOf(monthsRead) + (usageRow ? 1 : 0) + rowsReadOf(settingsRead);
  const usage = { rows_written: Number(usageRow?.rows_written ?? 0), rows_read: Number(usageRow?.rows_read ?? 0) };
  if (usage.rows_read >= REALPRICE_DAILY_READ_HARD) {
    // 끝 상한: 그날은 외부 요청·D1 쓰기 없이 끝(UTC 0시 = 한국 09시에 풀림).
    log({ event: LOG_EVENT, level: "warn", code: "RT_READ_BUDGET", limit: "hard" });
    return { outcome: "read_budget_hard", code: "RT_READ_BUDGET" };
  }
  const settings = Object.fromEntries((settingsRead.results ?? []).map((row) => [row.key, row.value_json]));
  const hold = parseHold(settings[REALPRICE_HOLD_SETTING]);
  const monthRows = monthsRead.results ?? [];
  const currentYmd = kstMonth(nowMs);
  const known = new Set(monthRows.map((row) => `${row.kind}:${row.deal_ymd}`));
  const missing = [];
  for (const kind of REALPRICE_KINDS) {
    for (const dealYmd of expectedMonths(kind, currentYmd)) if (!known.has(`${kind}:${dealYmd}`)) missing.push([kind, dealYmd]);
  }
  // 아직 표에 없는 달(처음 실행, 새 달 시작)은 넣기 전 모양으로 차례 고르기에 함께 넣는다. 실제로 넣는 것은 임대를 얻은 뒤다.
  const virtualRows = missing.map(([kind, dealYmd]) => ({
    kind, deal_ymd: dealYmd, status: "pending", row_count: 0, dropped_count: 0, held_count: null, attempts: 0, last_error: null, last_success_at: null, next_due_at: nowIso,
  }));
  const unmarkedAborted = monthRows.filter((row) => row.attempts > 0 && row.last_error === null);
  const abortedKeys = new Set(unmarkedAborted.map((row) => `${row.kind}:${row.deal_ymd}`));
  const candidates = [...monthRows.filter((row) => !abortedKeys.has(`${row.kind}:${row.deal_ymd}`)), ...virtualRows];
  const writeBudgetExceeded = usage.rows_written >= REALPRICE_DAILY_WRITE_BUDGET;
  const readSoftExceeded = usage.rows_read >= REALPRICE_DAILY_READ_SOFT;
  const { picked, blocked } = pickDueMonths(candidates, { nowMs, hold, writeBudgetExceeded, readSoftExceeded, limit: REALPRICE_MONTHS_PER_RUN });
  const dailyCheck = isDailyCheckWindow(nowMs);
  if (picked.length === 0 && unmarkedAborted.length === 0 && !dailyCheck) {
    // 할 일이 없으면 쓰기 없이 끝(rt_fetch_runs도 남기지 않음). 이때의 읽기는 사용량에 더하지 않는다(쓰기 1행을 아끼려고, 22.7절).
    if (blocked.writeBudget > 0 || blocked.readBudget > 0) {
      log({ event: LOG_EVENT, level: "warn", code: blocked.writeBudget > 0 ? "RT_WRITE_BUDGET" : "RT_READ_BUDGET", months: 0 });
    }
    return { outcome: "idle", blocked };
  }

  // ④ 임대(겹침 방지). 못 얻으면 끝.
  const holder = randomUUID();
  const lease = await db.prepare(LEASE_SQL).bind(REALPRICE_LEASE_NAME, holder, iso(nowMs + REALPRICE_LEASE_MS), nowIso).run();
  if (changesOf(lease) !== 1) {
    log({ event: LOG_EVENT, code: "LEASE_BUSY", months: 0 });
    return { outcome: "lease_busy" };
  }
  state.lease = { holder };
  const metaAvailable = hasMeta(lease);
  let measuredWritten = rowsWrittenOf(lease);
  let estimatedRecorded = 0;
  const seqRow = await db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM rt_fetch_runs").first();
  pendingRowsRead += 1;
  state.seq = Number(seqRow.seq);
  const totals = { months: 0, calls: 0, inserted: 0, updated: 0, deleted: 0 };
  const codes = [];

  // 시작 batch: 끊긴 달 표시, 없는 달 넣기, 받을 달 시작 표시, 실행 기록 시작.
  const startStatements = [];
  if (unmarkedAborted.length > 0) {
    startStatements.push(db.prepare(MARK_ABORTED_SQL).bind(JSON.stringify(unmarkedAborted.map((row) => [row.kind, row.deal_ymd])), iso(nowMs + REALPRICE_ABORT_RETRY_MS)));
    codes.push("RT_ABORTED");
  }
  if (missing.length > 0) startStatements.push(seedMonthsStatement(db, missing, nowMs));
  const startIndex = startStatements.length;
  for (const month of picked) startStatements.push(db.prepare(START_MONTH_SQL).bind(month.kind, month.deal_ymd, nowIso));
  startStatements.push(db.prepare("INSERT INTO rt_fetch_runs (seq, started_at) VALUES (?1, ?2)").bind(state.seq, nowIso));
  const startResults = await db.batch(startStatements);
  measuredWritten += rowsWrittenOf(startResults);
  state.runStarted = true;
  if (blocked.writeBudget > 0) codes.push("RT_WRITE_BUDGET");
  if (blocked.readBudget > 0) codes.push("RT_READ_BUDGET");

  // 매일 03시 건수 대조(키 단위 미룸 중이면 건너뜀).
  let countCheck = null;
  if (dailyCheck && !(hold.all && hold.all.until > nowIso)) {
    countCheck = await runCountCheck({ env, fetcher, monthRows, nowMs });
    totals.calls += countCheck.calls;
  }
  const countCheckCalls = countCheck?.calls ?? 0;

  // ⑤ 차례대로 받아 반영(무료 플랜은 1개월 1종류).
  let fetchFailure = null;
  for (const [offset, month] of picked.entries()) {
    if (changesOf(startResults[startIndex + offset]) !== 1) continue; // 미리 읽은 뒤 다른 실행이 처리한 달
    state.month = month;
    const fetched = await fetchRealpriceMonth({ api: month.kind, dealYmd: month.deal_ymd, serviceKey: env.MOLIT_RT_SERVICE_KEY.trim(), fetcher });
    totals.calls += fetched.calls;
    if (fetched.ok) {
      const applied = await applyRealpriceMonth(db, { month, fetched, nowMs, apiCalls: fetched.calls });
      estimatedRecorded += applied.rowsWrittenEstimate;
      measuredWritten += rowsWrittenOf(applied.results);
      totals.months += 1;
      totals.inserted += applied.inserted;
      totals.updated += applied.updated;
      totals.deleted += applied.deleted;
      if (applied.outcome === "held") codes.push("RT_HELD_DROP");
    } else {
      // 오류 뒤 다음 차례(22.4절 표): 그 달만 / 그 종류 모든 달 / 모든 종류. 앞서 받은 자료는 지우지 않는다.
      const plan = planRealpriceRetry(fetched.code, new Date(nowMs));
      const statements = [db.prepare(FAIL_MONTH_SQL).bind(plan.code, plan.retryAt, month.kind, month.deal_ymd)];
      if (plan.scope === "all" || plan.scope === "kind") statements.push(upsertSettingStatement(db, REALPRICE_HOLD_SETTING, mergeHold(hold, plan, month.kind), nowMs));
      const estimate = statements.length + 1;
      statements.push(addUsageStatement(db, nowMs, { apiCalls: fetched.calls, rowsWritten: estimate }));
      const results = await db.batch(statements);
      estimatedRecorded += estimate;
      measuredWritten += rowsWrittenOf(results);
      fetchFailure = plan.code;
    }
    state.month = null;
  }

  // ⑥ 실행 기록·사용량 보정·임대 반납(한 batch).
  const errorCode = fetchFailure ?? codes[0] ?? countCheck?.error ?? null;
  const outcome = fetchFailure ? "failed" : errorCode ? "partial" : "ok";
  const rowsWritten = (metaAvailable ? measuredWritten : estimatedRecorded) + FINAL_BATCH_ROWS;
  // 끝 시각은 끝 batch를 만들 때 시계를 다시 읽는다(실행 시간을 D1 기록으로 볼 수 있게, 2026-11-19 49.3 ④).
  const finishedIso = iso(typeof options.now === "function" ? options.now() : Date.now());
  const finalStatements = [
    db.prepare(FINISH_RUN_SQL).bind(state.seq, finishedIso, totals.months, totals.calls, totals.inserted, totals.updated, totals.deleted, rowsWritten, outcome, errorCode),
  ];
  if (dailyCheck) {
    if (countCheck) finalStatements.push(upsertSettingStatement(db, REALPRICE_COUNT_CHECK_SETTING, { checkedAt: countCheck.checkedAt, diffs: countCheck.diffs, error: countCheck.error }, nowMs));
    finalStatements.push(db.prepare("DELETE FROM rt_fetch_runs WHERE started_at < ?1").bind(iso(nowMs - REALPRICE_RUNS_KEEP_DAYS * DAY_MS)));
  }
  const writtenDelta = (metaAvailable ? measuredWritten - estimatedRecorded : 0) + FINAL_BATCH_ROWS;
  finalStatements.push(db.prepare(ADJUST_USAGE_SQL).bind(nowIso.slice(0, 10), countCheckCalls, writtenDelta, pendingRowsRead));
  finalStatements.push(db.prepare(RELEASE_SQL).bind(iso(0), REALPRICE_LEASE_NAME, holder));
  await db.batch(finalStatements);
  state.lease = null;

  const summary = { outcome, run: state.seq, months: totals.months, calls: totals.calls, inserted: totals.inserted, updated: totals.updated, deleted: totals.deleted, rowsWritten, code: errorCode };
  log({ event: LOG_EVENT, ...summary, ...(outcome === "ok" ? {} : { level: "warn" }) });
  return summary;
}

// 글 초안 보관 정리(03:00 차례 1번). 실패해도 실거래가 받기에 영향을 주지 않는다. 로그에는 지운 수·닫은 수·결과 코드만.
// 실거래가 실행과 같은 시계 값(nowMs)을 받는다(시계를 따로 읽지 않음).
export async function runBlogCleanup(db, nowMs, log = defaultLog) {
  if (!isDailyCheckWindow(nowMs) || !hasD1(db)) return { outcome: "skipped" };
  try {
    const schemaVersion = await readSchemaVersion(db);
    if (schemaVersion === null || schemaVersion < 4) return { outcome: "skipped" };
    const result = await cleanupBlogDrafts(db, nowMs);
    log({ event: "blog_cleanup", deleted: result.deleted, autoClosed: result.autoClosed });
    return { outcome: "ok", ...result };
  } catch {
    log({ event: "blog_cleanup", level: "warn", code: "BLOG_CLEANUP_FAILED" });
    return { outcome: "failed" };
  }
}

// 휴지통 7일 영구 삭제(03:00 차례 1번, 휴지통 0007, T-9). 업무 도구 켜기 값과 상관없이 돈다(꺼 둔 동안 멈추면 처리방침의 "7일 뒤 영구 삭제"가 깨짐).
// 조건은 D1이 있고 구조 번호가 7 이상인 것뿐이다. 100개씩 최대 10번 지우고, 그래도 남으면 경고 로그만 남기고 다음 날 이어 간다.
// 지울 것이 없으면 로그를 남기지 않는다. 로그에는 지운 묶음 수·결과 코드만(이름·묶음 id·R2 키 없음).
// 사진이 든 묶음은 R2(원본·미리보기)를 먼저 지운다(files: WORK_FILES 바인딩). 바인딩이 없으면 그 묶음은 건너뛰고 TRASH_EXPIRE_NO_STORAGE,
// R2 삭제가 실패한 묶음은 남기고 TRASH_EXPIRE_R2_FAILED 경고(다음 날 다시). 파일 켜기 값과 상관없이 바인딩만 본다(지우는 일이라서).
export async function runTrashExpire(db, nowMs, log = defaultLog, randomUUID = () => crypto.randomUUID(), files = null) {
  if (!isDailyCheckWindow(nowMs) || !hasD1(db)) return { outcome: "skipped" };
  try {
    const schemaVersion = await readSchemaVersion(db);
    if (schemaVersion === null || schemaVersion < 7) return { outcome: "skipped" };
    const result = await expireTrash(db, nowMs, randomUUID, files);
    if (result.r2Failed > 0) log({ event: "trash_expire", level: "warn", code: "TRASH_EXPIRE_R2_FAILED", batches: result.r2Failed });
    if (result.noStorage > 0) log({ event: "trash_expire", level: "warn", code: "TRASH_EXPIRE_NO_STORAGE", batches: result.noStorage });
    if (result.backlog) log({ event: "trash_expire", level: "warn", code: "TRASH_EXPIRE_BACKLOG", expired: result.expired });
    else if (result.expired > 0) log({ event: "trash_expire", expired: result.expired });
    return { outcome: "ok", ...result };
  } catch {
    log({ event: "trash_expire", level: "warn", code: "TRASH_EXPIRE_FAILED" });
    return { outcome: "failed" };
  }
}

// 실거래가 Cron 1번. 예외는 밖으로 내보내지 않는다.
export async function runRealpriceCron(env, options = {}) {
  const log = options.log ?? defaultLog;
  const state = { seq: null, lease: null, month: null, runStarted: false };
  try {
    return await runInner(env, options, state);
  } catch {
    // error.message·스택은 남기지 않는다(요청 주소가 섞일 수 있음).
    log({ event: LOG_EVENT, level: "warn", run: state.seq, code: "RT_INTERNAL" });
    await cleanupAfterInternalError(env, options, state);
    return { outcome: "internal_error", run: state.seq, code: "RT_INTERNAL" };
  }
}

// 예외 뒤 정리(할 수 있는 만큼만): 받던 달은 30분 뒤 차례로(attempts는 그대로 두어 연속 횟수를 셈), 실행 기록은 실패, 임대 반납.
async function cleanupAfterInternalError(env, options, state) {
  if (!state.lease) return;
  try {
    const db = options.db ?? env?.WORK_DB;
    const nowMs = typeof options.now === "function" ? options.now() : Date.now();
    const statements = [];
    if (state.month) statements.push(db.prepare(INTERNAL_FAIL_MONTH_SQL).bind(iso(nowMs + REALPRICE_ABORT_RETRY_MS), state.month.kind, state.month.deal_ymd));
    if (state.runStarted) statements.push(db.prepare("UPDATE rt_fetch_runs SET finished_at = ?2, outcome = 'failed', error_code = 'RT_INTERNAL' WHERE seq = ?1").bind(state.seq, iso(nowMs)));
    statements.push(db.prepare(RELEASE_SQL).bind(iso(0), REALPRICE_LEASE_NAME, state.lease.holder));
    await db.batch(statements);
  } catch {
    // 정리도 실패하면 임대는 5분 뒤 풀리고, 남은 attempts는 다음 실행이 RT_ABORTED로 적는다.
  }
}

// worker/index.mjs의 scheduled()에서 부른다. 모르는 Cron 문자열은 아무것도 하지 않는다.
export async function handleScheduled(controller, env, ctx, options = {}) {
  const log = options.log ?? defaultLog;
  try {
    if (controller?.cron === REALPRICE_CRON) return await runRealpriceCron(env, options);
    log({ event: "cron_unknown", level: "warn" });
    return { outcome: "unknown_cron" };
  } catch {
    log({ event: LOG_EVENT, level: "warn", run: null, code: "RT_INTERNAL" });
    return { outcome: "internal_error", run: null, code: "RT_INTERNAL" };
  }
}
