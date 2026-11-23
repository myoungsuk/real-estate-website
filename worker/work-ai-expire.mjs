// AI 작업 기록 30일 자동 삭제(설계서 8.7절 예외 2 "AI 초안 30일", DEC-WT-04, 14.10절 약점 4). work-scheduled.mjs의 03:00 차례 정리 끝에서 부른다.
// - 지우는 것: 계약서 두 번 읽기 묶음(kind contract_schedule) 가운데 열린 행(queued·in_progress)이 없고, 끝난 때가 30일 이상 지난 묶음의 행 전부.
//   result_json(원문 근거 evidence.quote 포함)만 비우지 않고 행을 지운다(8.7절 "AI 작업 기록(결과 초안 포함) … Cron이 지운다"). 비용 집계는
//   ai_usage_daily에 따로 있어 행을 지워도 하루·월 사용량이 바뀌지 않는다.
// - 끝난 때: 묶음 행들의 updated_at과 confirmed_at 가운데 가장 늦은 시각(확정이면 확정일, 취소·실패·결과만 나옴이면 마지막으로 닫힌 때).
//   거래에 넣지 않고 둔 결과(ready)도 끝난 지 30일이면 지운다(확정·취소를 기다리며 원문 근거가 끝없이 남지 않게).
// - 열린 행이 있는 묶음은 건드리지 않는다(예약 비용·조회 Cron이 그 행을 씀). 끝나면 그때부터 30일을 센다.
// - 묶음 100개씩 최대 10번(하루 1,000묶음 = 2,000행). 그래도 남으면 backlog: true(부르는 쪽이 경고 로그, 다음 날 이어 감).
// - 감사는 지운 묶음마다 1줄(ai.expire, 작업자 system:cron, 요청 번호 cron-<무작위>는 한 번(batch) 공통, reason은 고정 꼴). 감사와 삭제는
//   같은 batch이고 둘 다 조건을 다시 본다(고른 뒤 그사이 확정돼 끝난 때가 바뀐 묶음은 감사도 삭제도 하지 않음).
// - 지울 것이 없으면 읽기 1번으로 끝나고 randomUUID도 부르지 않는다. 묶음 id·계약서 글·거래 제목은 로그에 넣지 않는다.
import { changesOf } from "./work-audit.mjs";

export const AI_JOB_KEEP_DAYS = 30;
export const AI_EXPIRE_PER_ROUND = 100;
export const AI_EXPIRE_MAX_ROUNDS = 10;
export const AI_CRON_ACTOR = "system:cron";
const DAY_MS = 24 * 60 * 60 * 1000;

// 끝난 묶음 조건(GROUP BY group_id의 HAVING): 열린 행 0개 + 끝난 때 ≤ 기준 시각(?).
const FINISHED_AT = "max(max(updated_at), coalesce(max(confirmed_at), ''))";
const CLOSED_BEFORE = `sum(status IN ('queued','in_progress')) = 0 AND ${FINISHED_AT} <= ?`;
const PICK_SQL = `SELECT group_id FROM ai_jobs WHERE kind = 'contract_schedule' GROUP BY group_id HAVING ${CLOSED_BEFORE}
  ORDER BY ${FINISHED_AT}, group_id LIMIT ?`;
// 고른 묶음(JSON 배열) 가운데 지금도 조건에 맞는 것
const STILL_SQL = `SELECT group_id FROM ai_jobs WHERE kind = 'contract_schedule' AND group_id IN (SELECT value FROM json_each(?))
  GROUP BY group_id HAVING ${CLOSED_BEFORE}`;
const AUDIT_SQL = `INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)
  SELECT ?, ?, 'ai.expire', 'ai_job_group', group_id, ?, 'ok', 'kind=contract_schedule;days=${AI_JOB_KEEP_DAYS}' FROM (${STILL_SQL})`;
const DELETE_SQL = `DELETE FROM ai_jobs WHERE group_id IN (${STILL_SQL})`;
const LEFT_SQL = `SELECT 1 AS n FROM ai_jobs WHERE kind = 'contract_schedule' GROUP BY group_id HAVING ${CLOSED_BEFORE} LIMIT 1`;

// 이 시각 이전(같으면 포함)에 끝난 묶음이 30일 지난 것이다.
export function aiJobCutoffIso(nowMs) {
  return new Date(nowMs - AI_JOB_KEEP_DAYS * DAY_MS).toISOString();
}

export async function expireAiJobs(db, nowMs, randomUUID = () => crypto.randomUUID()) {
  const nowIso = new Date(nowMs).toISOString();
  const cutoff = aiJobCutoffIso(nowMs);
  let groups = 0;
  let rowsDeleted = 0;
  for (let round = 1; round <= AI_EXPIRE_MAX_ROUNDS; round += 1) {
    const picked = ((await db.prepare(PICK_SQL).bind(cutoff, AI_EXPIRE_PER_ROUND).all())?.results ?? []).map((row) => row.group_id);
    if (picked.length === 0) return { groups, rows: rowsDeleted, rounds: round - 1, backlog: false };
    const ids = JSON.stringify(picked);
    const results = await db.batch([
      db.prepare(AUDIT_SQL).bind(nowIso, AI_CRON_ACTOR, `cron-${randomUUID()}`, ids, cutoff),
      db.prepare(DELETE_SQL).bind(ids, cutoff),
    ]);
    groups += changesOf(results[0]);
    rowsDeleted += changesOf(results[1]);
    if (picked.length < AI_EXPIRE_PER_ROUND) return { groups, rows: rowsDeleted, rounds: round, backlog: false };
  }
  const left = await db.prepare(LEFT_SQL).bind(cutoff).first();
  return { groups, rows: rowsDeleted, rounds: AI_EXPIRE_MAX_ROUNDS, backlog: Boolean(left) };
}
