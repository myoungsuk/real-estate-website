// 단계 4 AI 작업 보조 조회(1분 예약 `* * * * *`, 설계서 14.5절, 2026-11-23 사용자 결정으로 예약 하나를 더함).
// 화면을 닫아도 끝난 결과가 OpenAI 임시 보관(약 10분) 안에 D1로 옮겨지게, 열린 작업(queued·in_progress)을 조회 API와 같은 pollJob()으로 본다.
// - 켜기 값 WORK_AI_ENABLED가 정확히 "true"가 아니면 env.WORK_DB에 손대지 않고 끝낸다(D1·외부 요청·로그 0).
// - 켜져 있으면 열린 행 조회 1번(최대 10행). 없으면 거기서 끝난다. 있을 때만 구조 번호를 읽고 OpenAI를 행마다 1번 조회한다.
// - 정산은 "아직 열린 행일 때만" 바뀌는 guard를 걸어, 화면 조회와 같은 분에 겹쳐도 사용량은 한 번만 바뀐다.
// - 03:00 정리(글 초안·휴지통·감사 기록)는 이 예약에서 하지 않는다(`*/10` 예약의 몫).
// - 모든 예외를 잡아 고정 코드만 남긴다. 로그에는 개수·코드만 넣고 응답 본문·error.message는 넣지 않는다.
import { getWorkAiState } from "./work-ai-config.mjs";
import { OPEN_JOBS_SQL, pollJob } from "./work-ai-jobs.mjs";
import { WORK_SCHEMA_VERSION, readSchemaVersion } from "./work-api.mjs";
import { runBatch } from "./work-audit.mjs";
import { getWorkConfigState } from "./work-security.mjs";

export const AI_POLL_CRON = "* * * * *";
export const AI_POLL_MAX_ROWS = 10;
const LOG_EVENT = "ai_poll_cron";

function defaultLog(entry) {
  try {
    (entry.level === "warn" ? console.warn : console.info)(JSON.stringify(entry));
  } catch {
    // 로그 장애는 무시한다.
  }
}

async function runInner(env, options, log) {
  const db = options.db ?? env.WORK_DB;
  const nowMs = typeof options.now === "function" ? options.now() : Date.now();
  if (getWorkConfigState(env, db) !== "enabled" || getWorkAiState(env, options.files ?? env.WORK_FILES) !== "enabled") {
    // 켰는데 다른 설정이 빠진 상태. 1분마다 쌓이지 않게 매시 정각 차례에만 경고 1줄을 남긴다.
    const scheduledMs = Number.isFinite(options.scheduledTime) ? options.scheduledTime : nowMs;
    if (new Date(scheduledMs).getUTCMinutes() === 0) log({ event: LOG_EVENT, level: "warn", code: "AI_CRON_CONFIG" });
    return { outcome: "config" };
  }
  const { results } = await db.prepare(OPEN_JOBS_SQL).bind(AI_POLL_MAX_ROWS).all();
  const rows = results ?? [];
  if (rows.length === 0) return { outcome: "idle", polled: 0 };
  // 구조 번호가 코드와 다르면(되돌린 배포 등) 업무 API와 같이 자료를 고치지 않는다.
  if ((await readSchemaVersion(db)) !== WORK_SCHEMA_VERSION) {
    log({ event: LOG_EVENT, level: "warn", code: "AI_CRON_SCHEMA" });
    return { outcome: "schema" };
  }
  const context = { db, env, requestId: "cron", now: nowMs, log, openaiFetch: options.openaiFetch ?? ((...args) => fetch(...args)) };
  let changed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const statements = await pollJob(context, row);
      if (statements.length > 0) {
        await runBatch(db, statements);
        changed += 1;
      }
    } catch {
      failed += 1;
    }
  }
  log({ event: LOG_EVENT, polled: rows.length, changed, failed });
  return { outcome: "ok", polled: rows.length, changed, failed };
}

// 1분 예약 1번. 예외는 밖으로 내보내지 않는다.
export async function runAiPollCron(env, options = {}) {
  if (env?.WORK_AI_ENABLED !== "true") return { outcome: "disabled" };
  const log = options.log ?? defaultLog;
  try {
    return await runInner(env, options, log);
  } catch {
    log({ event: LOG_EVENT, level: "warn", code: "AI_CRON_INTERNAL" });
    return { outcome: "internal_error", code: "AI_CRON_INTERNAL" };
  }
}
