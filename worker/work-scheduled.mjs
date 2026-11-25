// Worker Cron 진입점(설계서 22.7절). worker/index.mjs의 scheduled()가 부르고, controller.cron 문자열로 할 일을 나눈다.
// 단계 P 실거래가 받기(`*/10 * * * *`)와 1분 예약(`* * * * *`) 둘이다. 1분 예약은 단계 4 AI 작업 보조 조회(work-ai-cron.mjs)와
// 글 초안 보조 조회(work-blog-cron.mjs, 2026-11-25)를 차례로 하고, 둘은 켜기 값을 따로 본다. 아래 03:00 정리는 `*/10` 차례에서만 한다.
// 같은 Cron의 한국 시각 03:00 차례에는 실거래가 켜기 값을 보기 **전에** 글 초안 보관 정리(P3, DEC-WT-24)를 먼저 한다(지시서 D-5).
// 조건은 D1이 있고 구조 번호가 4 이상인 것뿐이다(글 초안·실거래가 켜기 값과 상관없이, 꺼 둔 뒤에도 오래된 초안이 지워지게).
// 같은 차례에 휴지통 7일 영구 삭제(runTrashExpire)와 감사 로그 3년 삭제(runAuditExpire), AI 작업 기록 30일 삭제(runAiJobExpire)도 켜기 값과 상관없이 한다.
// 시각은 Cron이 정한 시각(controller.scheduledTime)을 쓴다. 실행이 몇 초 늦게 시작해도 03:00 차례를 그 시각으로 판정한다.
// - 맨 바깥에서 모든 예외를 잡아 실행 번호와 고정 코드 RT_INTERNAL만 남긴다. 잡지 못한 예외는 플랫폼이 메시지·스택을
//   기록해 그 안에 요청 주소(인증키 포함)가 섞일 수 있어서다.
// - 로그에는 실행 번호, 받은 달 수, 호출 수, 넣기·고치기·지우기 수, rows_written, 결과 코드만 남긴다(22.12절).
//   요청 주소·인증키·응답 본문·error.message는 남기지 않는다.
import { fetchRealpriceMonth, fetchRealpriceTotalCount, planRealpriceRetry } from "./realprice-fetch.mjs";
import {
  REALPRICE_ABORT_RETRY_MS,
  REALPRICE_COUNT_CHECK_MONTHS,
  REALPRICE_COUNT_CHECK_SETTING,
  REALPRICE_DAILY_CALL_BUDGET,
  REALPRICE_DAILY_READ_HARD,
  REALPRICE_DAILY_READ_SOFT,
  REALPRICE_DAILY_WRITE_BUDGET,
  REALPRICE_HOLD_SETTING,
  REALPRICE_KINDS,
  REALPRICE_LAWDS,
  REALPRICE_LEASE_MS,
  REALPRICE_LEASE_NAME,
  REALPRICE_MONTHS_PER_RUN,
  REALPRICE_RECENT_MONTHS,
  REALPRICE_RUN_TIME_BUDGET_MS,
  REALPRICE_RUNS_KEEP_DAYS,
  addUsageStatement,
  applyRealpriceMonth,
  expectedMonths,
  hasMeta,
  kstMonth,
  monthAge,
  monthId,
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
import { expireAiJobs } from "./work-ai-expire.mjs";
import { hasD1 } from "./work-security.mjs";
import { AI_POLL_CRON, runAiPollCron } from "./work-ai-cron.mjs";
import { runBlogPollCron } from "./work-blog-cron.mjs";

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
WHERE (lawd_cd, kind, deal_ymd) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]') FROM json_each(?1)) AND attempts > 0 AND last_error IS NULL`;
// 받기 시작 표시(attempts + 1, last_error 비움). 끝나면 반영·실패 문장이 attempts를 0으로 되돌린다.
// 0008부터 한 실행이 여러 달을 받으므로 달마다 받기 바로 전에 표시한다(시간·예산 때문에 받지 않고 넘긴 달에 시작 표시가 남지 않게).
const START_MONTH_SQL = `UPDATE rt_fetch_months SET attempts = attempts + 1, last_error = NULL
WHERE lawd_cd = ?4 AND kind = ?1 AND deal_ymd = ?2 AND next_due_at <= ?3 AND NOT (attempts > 0 AND last_error IS NULL)`;
const FAIL_MONTH_SQL = "UPDATE rt_fetch_months SET status = 'failed', attempts = 0, last_error = ?1, next_due_at = ?2 WHERE lawd_cd = ?5 AND kind = ?3 AND deal_ymd = ?4";
// 처리 중 예외: 끊김(RT_ABORTED)과 같은 규칙으로 attempts를 그대로 두어 연속 횟수를 센다. 같은 달이 3번 연속이면 갱신 상태 경고
// RT_INTERNAL이 된다(2026-11-19 PR #76 TR-11 49.3 ③). 다음 실행의 시작 표시가 attempts를 1 더 올리고, 성공·받기 오류로 끝나면 0이 된다.
const INTERNAL_FAIL_MONTH_SQL = "UPDATE rt_fetch_months SET status = 'failed', last_error = 'RT_INTERNAL', next_due_at = ?1 WHERE lawd_cd = ?4 AND kind = ?2 AND deal_ymd = ?3";
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

// 매일 03시: 매매 일반 API(15126469)로 구마다 최근 3개월 totalCount만 받아(5개 구 15번) 상세 자료의 받은 건수(저장 + 버림)와 비교한다. 저장하지 않는다.
async function runCountCheck({ env, fetcher, monthRows, nowMs }) {
  const currentYmd = kstMonth(nowMs);
  const recent = expectedMonths("sale", currentYmd).slice(-REALPRICE_COUNT_CHECK_MONTHS).reverse();
  const stored = new Map(monthRows.filter((row) => row.kind === "sale" && row.last_success_at).map((row) => [monthId(row), row]));
  const diffs = [];
  let calls = 0;
  for (const lawdCd of REALPRICE_LAWDS) {
    for (const dealYmd of recent) {
      const result = await fetchRealpriceTotalCount({ api: "saleBasic", lawdCd, dealYmd, serviceKey: env.MOLIT_RT_SERVICE_KEY.trim(), fetcher });
      calls += result.calls;
      if (!result.ok) return { checkedAt: iso(nowMs), diffs, error: result.code, calls };
      const row = stored.get(`${lawdCd}:sale:${dealYmd}`);
      if (!row) continue; // 상세 자료를 아직 받지 못한 달은 비교하지 않는다
      const detail = Number(row.row_count) + Number(row.dropped_count);
      if (detail !== result.totalCount) diffs.push({ lawdCd, dealYmd, basic: result.totalCount, detail });
    }
  }
  return { checkedAt: iso(nowMs), diffs, error: null, calls };
}

async function runInner(env, options, state) {
  const db = options.db ?? env?.WORK_DB;
  const log = options.log ?? defaultLog;
  // 시작 시각: 시험이 넣은 now → Cron이 정한 시각(scheduledTime) → 지금. 끝 시각(finishedIso)은 아래에서 시계를 다시 읽는다.
  const nowMs = typeof options.now === "function" ? options.now() : Number.isFinite(options.scheduledTime) ? options.scheduledTime : Date.now();
  const nowIso = iso(nowMs);
  // 실행 시간 한도(REALPRICE_RUN_TIME_BUDGET_MS)를 재는 시계. 시험이 넣은 now가 있으면 그것을 쓴다.
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const startedClock = clock();
  const fetcher = options.fetcher ?? fetch;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());

  // ⓪ 03:00 차례면 글 초안 보관 정리, 휴지통 7일 영구 삭제, 감사 로그 3년 삭제, AI 작업 기록 30일 삭제부터(켜기 값과 상관없이, D-5·T-9·8.7절). 실패해도 아래로 이어 간다.
  await runBlogCleanup(db, nowMs, log);
  await runTrashExpire(db, nowMs, log, randomUUID, options.files ?? env?.WORK_FILES);
  await runAuditExpire(db, nowMs, log);
  await runAiJobExpire(db, nowMs, log, randomUUID);

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
  const usage = { api_calls: Number(usageRow?.api_calls ?? 0), rows_written: Number(usageRow?.rows_written ?? 0), rows_read: Number(usageRow?.rows_read ?? 0) };
  if (usage.rows_read >= REALPRICE_DAILY_READ_HARD) {
    // 끝 상한: 그날은 외부 요청·D1 쓰기 없이 끝(UTC 0시 = 한국 09시에 풀림).
    log({ event: LOG_EVENT, level: "warn", code: "RT_READ_BUDGET", limit: "hard" });
    return { outcome: "read_budget_hard", code: "RT_READ_BUDGET" };
  }
  const settings = Object.fromEntries((settingsRead.results ?? []).map((row) => [row.key, row.value_json]));
  const hold = parseHold(settings[REALPRICE_HOLD_SETTING]);
  const monthRows = monthsRead.results ?? [];
  const currentYmd = kstMonth(nowMs);
  const known = new Set(monthRows.map(monthId));
  const missing = [];
  for (const lawdCd of REALPRICE_LAWDS) {
    for (const kind of REALPRICE_KINDS) {
      for (const dealYmd of expectedMonths(kind, currentYmd)) if (!known.has(`${lawdCd}:${kind}:${dealYmd}`)) missing.push([lawdCd, kind, dealYmd]);
    }
  }
  // 아직 표에 없는 달(처음 실행, 새 달 시작, 0008 뒤 새 구)은 넣기 전 모양으로 차례 고르기에 함께 넣는다. 실제로 넣는 것은 임대를 얻은 뒤다.
  const virtualRows = missing.map(([lawdCd, kind, dealYmd]) => ({
    lawd_cd: lawdCd, kind, deal_ymd: dealYmd, status: "pending", row_count: 0, dropped_count: 0, held_count: null, attempts: 0, last_error: null, last_success_at: null, next_due_at: nowIso,
  }));
  const unmarkedAborted = monthRows.filter((row) => row.attempts > 0 && row.last_error === null);
  const abortedKeys = new Set(unmarkedAborted.map(monthId));
  const candidates = [...monthRows.filter((row) => !abortedKeys.has(monthId(row))), ...virtualRows];
  const writeBudgetExceeded = usage.rows_written >= REALPRICE_DAILY_WRITE_BUDGET;
  const callBudgetExceeded = usage.api_calls >= REALPRICE_DAILY_CALL_BUDGET;
  const readSoftExceeded = usage.rows_read >= REALPRICE_DAILY_READ_SOFT;
  const { picked, blocked } = pickDueMonths(candidates, { nowMs, hold, writeBudgetExceeded, callBudgetExceeded, readSoftExceeded, limit: REALPRICE_MONTHS_PER_RUN });
  const dailyCheck = isDailyCheckWindow(nowMs);
  if (picked.length === 0 && unmarkedAborted.length === 0 && !dailyCheck) {
    // 할 일이 없으면 쓰기 없이 끝(rt_fetch_runs도 남기지 않음). 이때의 읽기는 사용량에 더하지 않는다(쓰기 1행을 아끼려고, 22.7절).
    if (blocked.writeBudget > 0 || blocked.readBudget > 0 || blocked.callBudget > 0) {
      const code = blocked.writeBudget > 0 ? "RT_WRITE_BUDGET" : blocked.callBudget > 0 ? "RT_CALL_BUDGET" : "RT_READ_BUDGET";
      log({ event: LOG_EVENT, level: "warn", code, months: 0 });
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

  // 시작 batch: 끊긴 달 표시, 없는 달 넣기, 실행 기록 시작. 받을 달의 시작 표시는 달마다 받기 바로 전에 한다(⑤).
  const startStatements = [];
  if (unmarkedAborted.length > 0) {
    startStatements.push(db.prepare(MARK_ABORTED_SQL).bind(JSON.stringify(unmarkedAborted.map((row) => [row.lawd_cd, row.kind, row.deal_ymd])), iso(nowMs + REALPRICE_ABORT_RETRY_MS)));
    codes.push("RT_ABORTED");
  }
  if (missing.length > 0) startStatements.push(seedMonthsStatement(db, missing, nowMs));
  startStatements.push(db.prepare("INSERT INTO rt_fetch_runs (seq, started_at) VALUES (?1, ?2)").bind(state.seq, nowIso));
  const startResults = await db.batch(startStatements);
  measuredWritten += rowsWrittenOf(startResults);
  state.runStarted = true;
  if (blocked.writeBudget > 0) codes.push("RT_WRITE_BUDGET");
  if (blocked.callBudget > 0) codes.push("RT_CALL_BUDGET");
  if (blocked.readBudget > 0) codes.push("RT_READ_BUDGET");

  // 매일 03시 건수 대조(키 단위 미룸 중이면 건너뜀).
  let countCheck = null;
  if (dailyCheck && !(hold.all && hold.all.until > nowIso)) {
    countCheck = await runCountCheck({ env, fetcher, monthRows, nowMs });
    totals.calls += countCheck.calls;
  }
  const countCheckCalls = countCheck?.calls ?? 0;

  // ⑤ 차례대로 받아 반영(한 번에 REALPRICE_MONTHS_PER_RUN건까지). 차례는 최근 4개월이 앞이다.
  // 새 달을 시작하기 전에 실행 시간 한도와 하루 쓰기·호출 예산을 다시 본다. 최근 4개월은 예산과 상관없이 받고(22.7절 순서 1), 그 밖의 달은
  // 예산에 닿으면 이 실행에서 더 받지 않는다(받지 않은 달은 시작 표시가 없어 다음 차례에 그대로 남음).
  let fetchFailure = null;
  let budgetStop = null;
  for (const month of picked) {
    if (clock() - startedClock >= REALPRICE_RUN_TIME_BUDGET_MS) break;
    if (monthAge(currentYmd, month.deal_ymd) >= REALPRICE_RECENT_MONTHS) {
      if (usage.rows_written + estimatedRecorded >= REALPRICE_DAILY_WRITE_BUDGET) budgetStop = "RT_WRITE_BUDGET";
      else if (usage.api_calls + totals.calls >= REALPRICE_DAILY_CALL_BUDGET) budgetStop = "RT_CALL_BUDGET";
      if (budgetStop) break;
    }
    const started = await db.prepare(START_MONTH_SQL).bind(month.kind, month.deal_ymd, nowIso, month.lawd_cd).run();
    measuredWritten += rowsWrittenOf(started);
    if (changesOf(started) !== 1) continue; // 미리 읽은 뒤 다른 실행이 처리한 달
    state.month = month;
    const fetched = await fetchRealpriceMonth({ api: month.kind, lawdCd: month.lawd_cd, dealYmd: month.deal_ymd, serviceKey: env.MOLIT_RT_SERVICE_KEY.trim(), fetcher });
    totals.calls += fetched.calls;
    let failureCode = fetched.ok ? null : fetched.code;
    if (fetched.ok) {
      const applied = await applyRealpriceMonth(db, { month, fetched, nowMs, apiCalls: fetched.calls });
      if (applied.outcome === "region_mismatch") {
        // 구 코드가 다른 응답(0008): 거래 표·보류 상태를 건드리지 않고 받기 오류와 같은 길(그 종류 6시간 미룸)로 적는다.
        failureCode = applied.code;
      } else {
        estimatedRecorded += applied.rowsWrittenEstimate;
        measuredWritten += rowsWrittenOf(applied.results);
        totals.months += 1;
        totals.inserted += applied.inserted;
        totals.updated += applied.updated;
        totals.deleted += applied.deleted;
        if (applied.outcome === "held") codes.push("RT_HELD_DROP");
      }
    }
    if (failureCode) {
      // 오류 뒤 다음 차례(22.4절 표): 그 달만 / 그 종류 모든 달 / 모든 종류. 앞서 받은 자료는 지우지 않는다.
      const plan = planRealpriceRetry(failureCode, new Date(nowMs));
      const statements = [db.prepare(FAIL_MONTH_SQL).bind(plan.code, plan.retryAt, month.kind, month.deal_ymd, month.lawd_cd)];
      if (plan.scope === "all" || plan.scope === "kind") statements.push(upsertSettingStatement(db, REALPRICE_HOLD_SETTING, mergeHold(hold, plan, month.kind), nowMs));
      const estimate = statements.length + 1;
      statements.push(addUsageStatement(db, nowMs, { apiCalls: fetched.calls, rowsWritten: estimate }));
      const results = await db.batch(statements);
      estimatedRecorded += estimate;
      measuredWritten += rowsWrittenOf(results);
      fetchFailure = plan.code;
    }
    state.month = null;
    // 키·종류 단위 오류(활용 신청·키 만료 등)면 같은 실행에서 다른 구·달을 더 부르지 않는다(같은 오류가 반복될 뿐).
    if (fetchFailure && planRealpriceRetry(fetchFailure, new Date(nowMs)).scope !== "month") break;
  }
  if (budgetStop) codes.push(budgetStop);

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

// 감사 로그 3년 자동 삭제(설계서 8.7절 예외 1, DEC-WT-04, 처리방침 7항 "접근 기록 3년"). 기준은 기록일(at)이다.
// - 03:00 차례 1번, 업무 도구 켜기 값과 상관없이 돈다(꺼 둔 동안 멈추면 처리방침 약속이 깨짐). 조건은 D1이 있고 구조 번호를 읽을 수 있는 것뿐
//   (audit_events는 0001부터 있음). 기록을 고치거나 지우는 API는 여전히 없고, 이 Cron만 지운다(8.8절).
// - 3년은 달력 기준(UTC 날짜에서 해만 3 뺌). 2월 29일은 3월 1일이 되어 하루 더 남긴다(덜 지우는 쪽).
// - 한 번에 500줄씩 최대 4번(하루 2,000줄, 하루 쓰기 추정 200줄의 10배). 그래도 남으면 경고 로그만 남기고 다음 날 이어 간다.
// - 지울 것이 없으면 로그를 남기지 않는다. 로그에는 지운 줄 수와 남았는지만(이메일·동작·대상 ID 없음). 지운 일을 감사 로그에 다시 적지 않는다.
export const AUDIT_KEEP_YEARS = 3;
export const AUDIT_EXPIRE_PER_ROUND = 500;
export const AUDIT_EXPIRE_MAX_ROUNDS = 4;
const AUDIT_EXPIRE_SQL = "DELETE FROM audit_events WHERE seq IN (SELECT seq FROM audit_events WHERE at < ?1 ORDER BY at, seq LIMIT ?2)";
const AUDIT_LEFT_SQL = "SELECT 1 AS n FROM audit_events WHERE at < ?1 LIMIT 1";

// 이 시각보다 앞에 적힌 감사 기록이 3년 지난 것이다.
export function auditCutoffIso(nowMs) {
  const cutoff = new Date(nowMs);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - AUDIT_KEEP_YEARS);
  return cutoff.toISOString();
}

export async function expireAuditEvents(db, nowMs) {
  const cutoff = auditCutoffIso(nowMs);
  let deleted = 0;
  for (let round = 1; round <= AUDIT_EXPIRE_MAX_ROUNDS; round += 1) {
    const changes = changesOf(await db.prepare(AUDIT_EXPIRE_SQL).bind(cutoff, AUDIT_EXPIRE_PER_ROUND).run());
    deleted += changes;
    if (changes < AUDIT_EXPIRE_PER_ROUND) return { deleted, rounds: round, backlog: false };
  }
  const left = await db.prepare(AUDIT_LEFT_SQL).bind(cutoff).first();
  return { deleted, rounds: AUDIT_EXPIRE_MAX_ROUNDS, backlog: Boolean(left) };
}

export async function runAuditExpire(db, nowMs, log = defaultLog) {
  if (!isDailyCheckWindow(nowMs) || !hasD1(db)) return { outcome: "skipped" };
  try {
    const schemaVersion = await readSchemaVersion(db);
    if (schemaVersion === null) return { outcome: "skipped" };
    const result = await expireAuditEvents(db, nowMs);
    if (result.backlog) log({ event: "audit_expire", level: "warn", code: "AUDIT_EXPIRE_BACKLOG", deleted: result.deleted, left: true });
    else if (result.deleted > 0) log({ event: "audit_expire", deleted: result.deleted, left: false });
    return { outcome: "ok", ...result };
  } catch {
    log({ event: "audit_expire", level: "warn", code: "AUDIT_EXPIRE_FAILED" });
    return { outcome: "failed" };
  }
}

// AI 작업 기록 30일 자동 삭제(설계서 8.7절 예외 2, 14.10절 약점 4, work-ai-expire.mjs). 03:00 차례 1번, AI 켜기 값과 상관없이 돈다(꺼 둔 뒤에도
// 남은 결과의 원문 근거가 지워지게). 조건은 D1이 있고 구조 번호가 7 이상인 것뿐(휴지통 정리와 같은 문턱). 지울 것이 없으면 로그를 남기지 않는다.
// 로그에는 지운 묶음·행 수와 결과 코드만(묶음 id·계약서 글 없음). 실패는 AI_EXPIRE_FAILED만 남기고 Cron은 이어 간다.
export async function runAiJobExpire(db, nowMs, log = defaultLog, randomUUID = () => crypto.randomUUID()) {
  if (!isDailyCheckWindow(nowMs) || !hasD1(db)) return { outcome: "skipped" };
  try {
    const schemaVersion = await readSchemaVersion(db);
    if (schemaVersion === null || schemaVersion < 7) return { outcome: "skipped" };
    const result = await expireAiJobs(db, nowMs, randomUUID);
    if (result.backlog) log({ event: "ai_expire", level: "warn", code: "AI_EXPIRE_BACKLOG", groups: result.groups, rows: result.rows });
    else if (result.groups > 0) log({ event: "ai_expire", groups: result.groups, rows: result.rows });
    return { outcome: "ok", ...result };
  } catch {
    log({ event: "ai_expire", level: "warn", code: "AI_EXPIRE_FAILED" });
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
    if (state.month) statements.push(db.prepare(INTERNAL_FAIL_MONTH_SQL).bind(iso(nowMs + REALPRICE_ABORT_RETRY_MS), state.month.kind, state.month.deal_ymd, state.month.lawd_cd));
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
    if (controller?.cron === REALPRICE_CRON) return await runRealpriceCron(env, { scheduledTime: controller.scheduledTime, ...options });
    if (controller?.cron === AI_POLL_CRON) {
      // 둘 다 스스로 예외를 잡는다. 글 초안이 꺼져 있으면 돌려주는 값은 이전과 같다(계약서 AI 결과만).
      const ai = await runAiPollCron(env, { scheduledTime: controller.scheduledTime, ...options });
      const blog = await runBlogPollCron(env, { scheduledTime: controller.scheduledTime, ...options });
      return blog.outcome === "disabled" ? ai : { ...ai, blog };
    }
    log({ event: "cron_unknown", level: "warn" });
    return { outcome: "unknown_cron" };
  } catch {
    log({ event: LOG_EVENT, level: "warn", run: null, code: "RT_INTERNAL" });
    return { outcome: "internal_error", run: null, code: "RT_INTERNAL" };
  }
}
