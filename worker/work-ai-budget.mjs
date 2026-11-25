// AI 사용 한도(설계서 14.9절, DEC-WT-35, 지시서 D-3·D-4). 단계 4와 같은 ai_usage_daily·settings 행을 쓴다.
// - 날은 한국 날짜(KST, YYYY-MM-DD), 달은 그 날의 YYYY-MM.
// - 만들기 전에 한 문장으로 "오늘 횟수 + 1 ≤ 하루 한도"와 "이번 달 예상 비용 + 최대 예상 비용 ≤ 월 한도"를 확인하고 늘린다
//   (조건이 맞지 않으면 아무 행도 바뀌지 않음 → AI_BUDGET_EXCEEDED). 최대 예상 비용을 미리 더하고(D-3) 결과를 받으면 실제 값으로 한 번 바로잡는다.
// - 한도 행이 없으면 보내지 않는다(fail closed).
import { WorkApiError } from "./work-security.mjs";

export const AI_DAILY_LIMIT_KEY = "ai_daily_create_limit";
export const AI_MONTHLY_LIMIT_KEY = "ai_monthly_cost_limit_micro_usd";
export const AI_LIMITS_VERSION_KEY = "ai_limits_version";
// 화면이 처음 보여 줄 값(운영자 결정 2026-11-20 "하루 10편 · 월 10달러"). 저장하기 전에는 쓰지 않는다.
export const AI_LIMIT_DEFAULTS = Object.freeze({ dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 });
export const AI_LIMIT_RANGES = Object.freeze({ daily: [1, 100], monthly: [100_000, 200_000_000] });
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstDay(nowMs) {
  return new Date(nowMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function monthRange(day) {
  const month = day.slice(0, 7);
  return { month, first: `${month}-01`, last: `${month}-31` };
}

const readLimitsSql = "SELECT key, value_json FROM settings WHERE key IN (?1, ?2, ?3)";

export async function readAiLimits(db) {
  const { results } = await db.prepare(readLimitsSql).bind(AI_DAILY_LIMIT_KEY, AI_MONTHLY_LIMIT_KEY, AI_LIMITS_VERSION_KEY).all();
  const map = Object.fromEntries((results ?? []).map((row) => [row.key, row.value_json]));
  const num = (key) => {
    if (map[key] === undefined) return null;
    try {
      const value = JSON.parse(map[key]);
      return Number.isSafeInteger(value) ? value : null;
    } catch {
      return null;
    }
  };
  return { version: num(AI_LIMITS_VERSION_KEY) ?? 0, dailyCreateLimit: num(AI_DAILY_LIMIT_KEY), monthlyCostLimitMicroUsd: num(AI_MONTHLY_LIMIT_KEY) };
}

export async function readAiUsage(db, nowMs) {
  const day = kstDay(nowMs);
  const { first, last } = monthRange(day);
  const today = await db.prepare("SELECT create_requests FROM ai_usage_daily WHERE day = ?1").bind(day).first();
  const month = await db.prepare("SELECT COALESCE(SUM(estimated_cost_micro_usd), 0) AS cost FROM ai_usage_daily WHERE day >= ?1 AND day <= ?2").bind(first, last).first();
  return { day, todayCreates: Number(today?.create_requests ?? 0), monthCostMicroUsd: Number(month?.cost ?? 0) };
}

// 한 문장으로 확인 + 늘리기. 바뀐 행이 없으면 한도 초과.
const RESERVE_SQL = `INSERT INTO ai_usage_daily (day, create_requests, estimated_cost_micro_usd)
SELECT ?1, 1, ?2 WHERE ?3 >= 1
  AND (SELECT COALESCE(SUM(estimated_cost_micro_usd), 0) FROM ai_usage_daily WHERE day >= ?4 AND day <= ?5) + ?2 <= ?6
ON CONFLICT(day) DO UPDATE SET create_requests = ai_usage_daily.create_requests + 1,
  estimated_cost_micro_usd = ai_usage_daily.estimated_cost_micro_usd + excluded.estimated_cost_micro_usd
WHERE ai_usage_daily.create_requests + 1 <= ?3
RETURNING create_requests`;

// 돌려주는 값: { day }. 한도 행이 없으면 409 AI_LIMITS_MISSING, 넘으면 429 AI_BUDGET_EXCEEDED(details: daily·monthly).
export async function reserveAiBudget(db, { nowMs, reservedCostMicroUsd }) {
  const limits = await readAiLimits(db);
  if (limits.dailyCreateLimit === null || limits.monthlyCostLimitMicroUsd === null) {
    throw new WorkApiError("AI_LIMITS_MISSING", "AI 사용 한도를 먼저 저장해 주세요.", 409);
  }
  const day = kstDay(nowMs);
  const { first, last } = monthRange(day);
  const row = await db.prepare(RESERVE_SQL).bind(day, reservedCostMicroUsd, limits.dailyCreateLimit, first, last, limits.monthlyCostLimitMicroUsd).first();
  if (row) return { day };
  const usage = await readAiUsage(db, nowMs);
  const which = usage.todayCreates + 1 > limits.dailyCreateLimit ? "daily" : "monthly";
  throw new WorkApiError("AI_BUDGET_EXCEEDED", which === "daily" ? "오늘 만들 수 있는 횟수를 다 썼습니다." : "이번 달 AI 비용 한도에 닿았습니다.", 429, false, [which]);
}

// 생성 요청이 확실히 만들어지지 않았을 때(OpenAI 4xx) 미리 더한 것을 되돌린다. 초안이 아직 queued이고 OpenAI 작업 ID가 없을 때만(한 번만) 바뀐다.
// 같은 batch에서 초안을 failed로 바꾸는 문장보다 **먼저** 둔다.
const REFUND_SQL = `UPDATE ai_usage_daily SET create_requests = MAX(create_requests - 1, 0),
  estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2, 0)
  WHERE day = ?1 AND EXISTS (SELECT 1 FROM blog_drafts WHERE id = ?3 AND status = 'queued' AND openai_response_id IS NULL)`;
// 초안 행을 넣지 못했을 때(OpenAI를 부르기 전) 쓰는 조건 없는 되돌리기.
export const REFUND_UNCONDITIONAL_SQL = `UPDATE ai_usage_daily SET create_requests = MAX(create_requests - 1, 0),
  estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2, 0) WHERE day = ?1`;
export function refundStatement(db, { draftId, day, reservedCostMicroUsd }) {
  return db.prepare(REFUND_SQL).bind(day, reservedCostMicroUsd, draftId);
}

// 결과를 받았을 때 미리 더한 최대 예상 비용을 실제 값으로 바꾼다. 초안이 아직 진행 중일 때만(두 번 받아도 한 번만) 바뀐다.
// 같은 batch에서 초안 상태를 바꾸는 문장보다 **먼저** 둔다.
const SETTLE_SQL = `UPDATE ai_usage_daily SET estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2 + ?3, 0),
  input_tokens = input_tokens + ?4, output_tokens = output_tokens + ?5
  WHERE day = ?1 AND EXISTS (SELECT 1 FROM blog_drafts WHERE id = ?6 AND status IN ('queued','in_progress') AND actual_cost_micro_usd IS NULL)`;
export function settleUsageStatement(db, { draftId, day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens }) {
  return db.prepare(SETTLE_SQL).bind(day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens, draftId);
}

// 글 초안 카드 배경 그림(설계서 22.22절)처럼 행을 남기지 않는 동기 요청의 바로잡기. 한 요청에서 한 번만 부른다(조건 없음).
const SETTLE_UNCONDITIONAL_SQL = `UPDATE ai_usage_daily SET estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2 + ?3, 0),
  input_tokens = input_tokens + ?4, output_tokens = output_tokens + ?5 WHERE day = ?1`;
export function settleUnconditionalStatement(db, { day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens }) {
  return db.prepare(SETTLE_UNCONDITIONAL_SQL).bind(day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens);
}

const LIMITS_GUARD_SQL = "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key = ?1 AND value_json = ?2) THEN json('guard') ELSE 1 END AS ok";
const UPSERT_SETTING_SQL = `INSERT INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)
ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`;

export function parseLimitsBody(body) {
  const fields = [];
  if (!body || typeof body !== "object" || Array.isArray(body)) return { fields: ["body"] };
  for (const key of Object.keys(body)) if (!["version", "dailyCreateLimit", "monthlyCostLimitMicroUsd"].includes(key)) fields.push(key);
  const inRange = (value, [min, max]) => Number.isSafeInteger(value) && value >= min && value <= max;
  if (!Number.isSafeInteger(body.version) || body.version < 0) fields.push("version");
  if (!inRange(body.dailyCreateLimit, AI_LIMIT_RANGES.daily)) fields.push("dailyCreateLimit");
  if (!inRange(body.monthlyCostLimitMicroUsd, AI_LIMIT_RANGES.monthly)) fields.push("monthlyCostLimitMicroUsd");
  return fields.length ? { fields } : { value: { version: body.version, dailyCreateLimit: body.dailyCreateLimit, monthlyCostLimitMicroUsd: body.monthlyCostLimitMicroUsd } };
}

// 저장 문장들(version guard → 한도 2개 → version + 1). 감사는 부르는 쪽이 같은 batch에 넣는다.
export function saveLimitsStatements(db, value, nowIso) {
  return [
    db.prepare(LIMITS_GUARD_SQL).bind(AI_LIMITS_VERSION_KEY, JSON.stringify(value.version)),
    db.prepare(UPSERT_SETTING_SQL).bind(AI_DAILY_LIMIT_KEY, JSON.stringify(value.dailyCreateLimit), nowIso),
    db.prepare(UPSERT_SETTING_SQL).bind(AI_MONTHLY_LIMIT_KEY, JSON.stringify(value.monthlyCostLimitMicroUsd), nowIso),
    db.prepare(UPSERT_SETTING_SQL).bind(AI_LIMITS_VERSION_KEY, JSON.stringify(value.version + 1), nowIso),
  ];
}

// ── 단계 4 AI 작업(ai_jobs)용. 글 초안과 같은 한도 행·사용량 행을 쓴다(2026-11-23 사용자 결정 "같은 프로젝트·한도 하나"). 위 글 초안 문장은 그대로 둔다. ──

// 여러 번(옛 계약서 두 번 읽기 = 2회, 2026-11-24부터 한 번 읽기 = 1회)을 한 문장으로 확인 + 늘리기. 전부 들어가거나 하나도 안 들어간다(?7 = 횟수, ?2 = 합계 최대 예상 비용).
const RESERVE_MANY_SQL = `INSERT INTO ai_usage_daily (day, create_requests, estimated_cost_micro_usd)
SELECT ?1, ?7, ?2 WHERE ?3 >= ?7
  AND (SELECT COALESCE(SUM(estimated_cost_micro_usd), 0) FROM ai_usage_daily WHERE day >= ?4 AND day <= ?5) + ?2 <= ?6
ON CONFLICT(day) DO UPDATE SET create_requests = ai_usage_daily.create_requests + excluded.create_requests,
  estimated_cost_micro_usd = ai_usage_daily.estimated_cost_micro_usd + excluded.estimated_cost_micro_usd
WHERE ai_usage_daily.create_requests + excluded.create_requests <= ?3
RETURNING create_requests`;

// 돌려주는 값: { day }. 한도 행이 없으면 409 AI_LIMITS_MISSING, 넘으면 429 AI_BUDGET_EXCEEDED(details: daily·monthly). 넘으면 아무 행도 바뀌지 않는다.
export async function reserveAiBudgetMany(db, { nowMs, count, reservedCostMicroUsd }) {
  const limits = await readAiLimits(db);
  if (limits.dailyCreateLimit === null || limits.monthlyCostLimitMicroUsd === null) {
    throw new WorkApiError("AI_LIMITS_MISSING", "AI 사용 한도를 먼저 저장해 주세요.", 409);
  }
  const day = kstDay(nowMs);
  const { first, last } = monthRange(day);
  const row = await db.prepare(RESERVE_MANY_SQL).bind(day, reservedCostMicroUsd, limits.dailyCreateLimit, first, last, limits.monthlyCostLimitMicroUsd, count).first();
  if (row) return { day };
  const usage = await readAiUsage(db, nowMs);
  const which = usage.todayCreates + count > limits.dailyCreateLimit ? "daily" : "monthly";
  throw new WorkApiError("AI_BUDGET_EXCEEDED", which === "daily" ? "오늘 만들 수 있는 횟수를 다 썼습니다." : "이번 달 AI 비용 한도에 닿았습니다.", 429, false, [which]);
}

// 작업 행을 넣지 못했을 때(OpenAI를 부르기 전) 예약 전체를 되돌린다(행이 없으므로 조건 없이 1번).
const REFUND_MANY_SQL = `UPDATE ai_usage_daily SET create_requests = MAX(create_requests - ?3, 0),
  estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2, 0) WHERE day = ?1`;
export function refundManyStatement(db, { day, count, reservedCostMicroUsd }) {
  return db.prepare(REFUND_MANY_SQL).bind(day, reservedCostMicroUsd, count);
}

// 생성 요청이 확실히 만들어지지 않았을 때(OpenAI 4xx) 그 작업 1회 몫을 되돌린다. 작업이 아직 queued이고 OpenAI 응답 ID가 없을 때만(한 번만) 바뀐다.
// 같은 batch에서 작업을 failed로 바꾸는 문장보다 **먼저** 둔다.
const REFUND_JOB_SQL = `UPDATE ai_usage_daily SET create_requests = MAX(create_requests - 1, 0),
  estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2, 0)
  WHERE day = ?1 AND EXISTS (SELECT 1 FROM ai_jobs WHERE id = ?3 AND status = 'queued' AND openai_response_id IS NULL)`;
export function refundJobStatement(db, { jobId, day, reservedCostMicroUsd }) {
  return db.prepare(REFUND_JOB_SQL).bind(day, reservedCostMicroUsd, jobId);
}

// 결과를 받았을 때 예약한 최대 예상 비용을 실제 값으로 바꾼다. 작업이 아직 열려 있을 때만(queued·in_progress, 두 번 받아도 한 번만) 바뀐다.
// reservedCostMicroUsd는 열린 행의 토큰 칸(예약값)으로 계산한 값이어야 한다. 이 guard가 "열린 행일 때만 그 칸을 예약값으로 읽는다"를 지킨다
// (행이 닫히는 문장은 토큰 칸을 실제 값이나 NULL로 함께 바꾼다). 같은 batch에서 작업 상태를 바꾸는 문장보다 **먼저** 둔다.
const SETTLE_JOB_SQL = `UPDATE ai_usage_daily SET estimated_cost_micro_usd = MAX(estimated_cost_micro_usd - ?2 + ?3, 0),
  input_tokens = input_tokens + ?4, output_tokens = output_tokens + ?5
  WHERE day = ?1 AND EXISTS (SELECT 1 FROM ai_jobs WHERE id = ?6 AND status IN ('queued','in_progress'))`;
export function settleJobUsageStatement(db, { jobId, day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens }) {
  return db.prepare(SETTLE_JOB_SQL).bind(day, reservedCostMicroUsd, actualCostMicroUsd, inputTokens, outputTokens, jobId);
}
