// 업무 도구 단계 4 AI 작업 API (가): 계약서 사본 → 날짜·금액 읽기 작업 만들기·조회·취소·목록(설계서 14.3 ~ 14.5절).
// 2026-11-24 운영자 결정으로 두 번 읽기에서 한 번 읽기로 바꿨다(가상 계약서 5건 × 2회 측정에서 경고 칸을 뺀 날짜·금액·소재지 68칸이 모두 맞고 두 결과가 한 번도 다르지 않음).
// 새 묶음은 작업 행 1개(run_index 1, pair_mode NULL)다. 그 전에 만든 옛 묶음(행 2개, pair_mode 있음)도 조회·목록·취소·확정·30일 정리가 그대로 된다.
// work-api.mjs가 업무 도구·구조 번호·AI 켜기 값(WORK_AI_ENABLED + 파일 기능 + OpenAI 설정)·(쓰기면) Origin·CSRF·본문 읽기를 끝낸 뒤 routeWorkAi()를 부른다.
// 확정(/confirm, 거래·일정 쓰기)과 예상 비용 미리 보기(/ai/estimate)는 2026-11-23 확정 서버 PR에서 넣었다(이 파일 아래 '확정'·'미리 보기'). 비교 규칙은
// 화면과 같은 src/lib/work/contract-compare.mjs 하나를 쓴다.
// - 읽을 사진은 거래에 붙인 계약서 사본뿐이다(files.kind = contract_copy, rrn_masked = 1, 2026-11-23 사용자 결정 "거래에 붙임").
//   조건에 맞지 않는 파일·다른 거래·휴지통에 간 파일·없는 거래는 모두 같은 404다(어느 조건인지 알려 주지 않음).
// - 한 번에 5장·합계 12MB까지(Worker 메모리 128MB, 넘으면 413 AI_INPUT_TOO_LARGE). 사진의 base64 글은 한 번만 만들어 생성 요청 1번에 싣는다
//   (요청 본문 글은 openaiRequest() 안에서만 살아 있다).
// - 한도: 글 초안과 같은 ai_usage_daily·settings 행을 쓴다(2026-11-23 사용자 결정 "같은 프로젝트·한도 하나"). 1회 몫을 미리 더하고,
//   결과를 받으면 실제 값으로 한 번만 바로잡는다.
// - 같은 거래에 진행 중 묶음이 있으면 409 AI_JOB_ACTIVE(details에 그 묶음 ID). 작업 행을 넣는 문장 자체가 조건부라, 동시에 두 요청이 와도
//   한쪽만 행이 들어가고 다른 쪽은 미리 더한 한도를 되돌린 뒤 409다(OpenAI 0회).
// - OpenAI: background + store:false, 생성 재시도 0회. 4xx는 만들어지지 않은 것(failed + 그 몫 되돌림), 5xx·시간 초과·응답 없음은
//   만들어졌는지 모르는 것(unknown, 되돌리지 않음)이다. 글 초안과 같다.
// - 키·요청 본문·응답 본문·계약서 내용·거래 제목·R2 키는 로그·감사·오류에 넣지 않는다. 감사 reason은 종류·장수·읽은 횟수 같은 고정 꼴만 쓴다.
//
// ai_jobs.input_tokens·output_tokens 칸의 뜻(0008 없이 예약 비용을 다루려고 한 칸을 두 뜻으로 쓴다. 이 칸을 읽는 곳은 이 파일의 pollJob()뿐이다):
// - 열린 행(queued·in_progress): **예약값**이다(입력 토큰 추정·출력 상한). 예약 비용 = 이 값 × 그 모델 단가.
// - 결과를 받아 닫힌 행(completed, 결과를 받은 failed): **실제 사용량**이다(사용량을 모르면 NULL).
// - 그 밖의 닫힌 행(unknown·expired·cancelled, 생성 4xx failed): NULL로 비운다(닫힌 행에 예약값이 남지 않게).
// 행을 닫는 문장은 모두 이 칸을 함께 바꾸고, 정산·되돌리기 문장(work-ai-budget.mjs)은 "아직 열린 행일 때만" 바뀌는 guard를 건다.
// 응답 jobs[]에는 토큰 수를 내보내지 않는다.
import { contractInstructions, contractResultSchema, maskContractResult, validateContractResult } from "../src/lib/work/contract-extract.mjs";
import { CONFIRM_AMOUNT_FIELDS, CONFIRM_FIELDS, CONFIRM_MIDDLE_PAYMENTS_MAX, compareGroupResults, confirmFieldsFor, missingDecisions } from "../src/lib/work/contract-compare.mjs";
import { MAX_AMOUNT_WON_EXCLUSIVE, cleanSingleLine } from "../src/lib/work/work-format.mjs";
import { WorkAiError, cancelResponse, createBackgroundResponse, readResponseOutput, retrieveResponse } from "./openai-client.mjs";
import { IMAGE_TOKENS_MAX, estimateCostMicroUsd, readContractAiConfig, readModelPrices } from "./work-ai-config.mjs";
import { kstDay, readAiLimits, readAiUsage, refundJobStatement, refundManyStatement, reserveAiBudgetMany, settleJobUsageStatement } from "./work-ai-budget.mjs";
import { auditStatement, changesOf, runBatch } from "./work-audit.mjs";
import { CLOSED_DEAL_STATUSES, assertDealConsistent, invalid, isCalendarDate, isUuid, maskResidentNumbers } from "./work-input.mjs";
import { dealView, loadDeal, rowToDeal } from "./work-deals.mjs";
import { loadDealEvents, planDealSchedule, scheduleOutcome } from "./work-events.mjs";
import { DEFAULT_ALARM_TRIGGERS } from "./work-calendar.mjs";
import { WorkApiError } from "./work-security.mjs";

export const AI_JOB_KIND = "contract_schedule";
export const AI_MAX_FILES = 5;
export const AI_MAX_TOTAL_BYTES = 12 * 1024 * 1024;
export const AI_RESULT_KEEP_MS = 10 * 60 * 1000; // OpenAI background 결과 임시 보관(약 10분, 14.5절). 지나서 404면 expired
export const AI_LEASE_MS = 60 * 60 * 1000; // 만든 뒤 이 시간이 지나도 끝나지 않은 작업은 unknown으로 닫는다(끝없는 조회 방지)
export const AI_CREATE_TIMEOUT_MS = 120_000; // 사진을 실어 보내는 생성 요청 1번의 시간 제한
export const AI_JOB_LIST_GROUPS = 5;
// 새 묶음이 읽는 횟수(한 번 읽기, 2026-11-24 운영자 결정). 한도 예약·되돌리기·비용 미리 보기가 같은 값을 쓴다.
export const AI_CONTRACT_READS = 1;
const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/webp"]);
const OPEN_STATUSES = new Set(["queued", "in_progress"]);
const BASE64_CHUNK_BYTES = 24_576; // 3의 배수(조각마다 따로 바꿔 이어 붙여도 같은 base64)

const iso = (ms) => new Date(ms).toISOString();
const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const notFound = () => new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);
const methodNotAllowed = (allow) => Object.assign(new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { allow });
const inputTooLarge = () => new WorkApiError("AI_INPUT_TOO_LARGE", `한 번에 사진 ${AI_MAX_FILES}장, 합계 12MB까지 읽을 수 있습니다.`, 413);
const jobActive = (groupId) => new WorkApiError("AI_JOB_ACTIVE", "이 거래의 계약서를 이미 읽고 있습니다. 끝난 뒤 다시 해 주세요.", 409, false, [groupId]);
const jobConflict = () => new WorkApiError("AI_JOB_STATE_CONFLICT", "작업 상태가 바뀌었습니다. 다시 불러와 주세요.", 409);
const fileStorageFailed = () => new WorkApiError("FILE_STORAGE_FAILED", "파일 저장소를 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.", 503, true);
const aiUnavailable = (reason) => (reason === "invalid"
  ? new WorkApiError("AI_CONFIG_INVALID", "AI 설정(키·모델)을 확인해야 합니다.", 503)
  : new WorkApiError("AI_DISABLED", "AI 기능이 아직 켜지지 않았습니다.", 503));

function aiErrorResponse(code) {
  const table = {
    AI_RATE_LIMITED: ["AI 요청이 잠시 많습니다. 잠시 뒤 다시 해 주세요.", 429, true],
    AI_CONFIG_INVALID: ["AI 설정(키·모델)을 확인해야 합니다.", 503, false],
    AI_REQUEST_INVALID: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_NOT_FOUND: ["AI 요청이 받아들여지지 않았습니다.", 502, false],
    AI_STATE_UNKNOWN: ["AI 요청이 만들어졌는지 확인하지 못했습니다. 작업 목록에서 상태를 확인해 주세요.", 502, false],
    AI_UPSTREAM_FAILED: ["AI 서비스가 응답하지 않았습니다.", 502, true],
  };
  const [message, status, retryable] = table[code] ?? table.AI_UPSTREAM_FAILED;
  return new WorkApiError(code in table ? code : "AI_UPSTREAM_FAILED", message, status, retryable);
}

// 로그 칸은 정해진 것뿐이다(요청 ID·몇 회째·모델·추론·상태·코드·토큰 수·걸린 시간). 본문·오류 글은 넣지 않는다.
function logAi(log, entry) {
  try {
    log?.({ event: "ai_openai", ...entry });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

export function isWorkAiRoute(route) {
  return route === "/ai" || route.startsWith("/ai/");
}

// ── 설정 경고(14.2절) ──

// GET /work/session의 aiWarnings. 두 번 읽기 때는 두 모델이 같으면 CONTRACT_CROSS_MODEL_UNSET을 넣었지만, 한 번 읽기(2026-11-24)부터는
// 견줄 둘째 모델이 없어 늘 빈 배열이다(settings.contract_cross_model_required도 읽지 않음). 세션 응답의 칸 모양은 그대로 둔다.
export async function readAiWarnings() {
  return [];
}

// ── OpenAI로 보내는 것 ──

function toBase64(bytes) {
  const parts = [];
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    parts.push(btoa(String.fromCharCode.apply(null, bytes.subarray(start, start + BASE64_CHUNK_BYTES))));
  }
  return parts.join("");
}

// images: data URL 글 배열(쪽 순서, 복사하지 않음). 새 묶음은 runIndex 1만 쓴다(2회째의 칸 순서를 바꾼 스키마·지시문은 옛 두 번 읽기 몫).
export function buildContractRequest(model, detail, runIndex, images) {
  const content = [];
  images.forEach((imageUrl, index) => {
    content.push({ type: "input_text", text: `${index + 1}쪽` }, { type: "input_image", image_url: imageUrl, detail });
  });
  return {
    model: model.model,
    reasoning: { effort: model.effort },
    max_output_tokens: model.maxOutputTokens,
    background: true,
    store: false,
    instructions: contractInstructions(runIndex),
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: AI_JOB_KIND, strict: true, schema: contractResultSchema(runIndex) } },
  };
}

// 입력 토큰 추정(최대 쪽으로). 요청 본문을 글로 만들지 않고 계산한다: 지시문·스키마는 글자 1개 = 토큰 1개, 사진은 세부도별 장당 상한.
export function estimateContractInputTokens(runIndex, pages, detail) {
  return contractInstructions(runIndex).length + JSON.stringify(contractResultSchema(runIndex)).length + pages * (IMAGE_TOKENS_MAX[detail] + 10) + 200;
}

// 한 번 읽기의 예약값(입력 토큰 추정·예약 비용). 만들기와 예상 비용 미리 보기가 같은 함수를 쓴다(두 값이 어긋나지 않게).
export function contractReservation(config, pages) {
  const inputTokens = estimateContractInputTokens(1, pages, config.detail);
  return { inputTokens, reservedTotal: estimateCostMicroUsd(config.a.prices, inputTokens, config.a.maxOutputTokens) };
}

// ── 작업 행 ──

const JOB_COLUMNS = `id, group_id, run_index, pair_mode, kind, status, openai_response_id, lease_until, model, reasoning_effort, input_file_ids,
  result_json, error_code, input_tokens, output_tokens, confirmed_at, created_at, updated_at`;
const GROUP_SQL = `SELECT ${JOB_COLUMNS} FROM ai_jobs WHERE group_id = ?1 AND kind = 'contract_schedule' ORDER BY run_index`;
// 1분 예약이 보는 열린 행(부분 색인 idx_ai_jobs_pending). 오래 손대지 않은 것부터.
export const OPEN_JOBS_SQL = `SELECT ${JOB_COLUMNS} FROM ai_jobs WHERE status IN ('queued','in_progress') AND kind = 'contract_schedule'
  ORDER BY updated_at, id LIMIT ?1`;
// ai_jobs에는 거래 칸이 없어 input_file_ids(파일 ID 배열)와 files.deal_id로 거래를 찾는다(표가 작아 전체를 훑는다).
// 목록은 묶음 5개를 만들려고 행을 5 × 2개까지 읽는다(옛 두 번 읽기 묶음은 행이 2개, 한 번 읽기 묶음은 1개).
const DEAL_OF_JOB = "EXISTS (SELECT 1 FROM json_each(j.input_file_ids) e JOIN files f ON f.id = e.value WHERE f.deal_id = ";
const ACTIVE_GROUP_SQL = `SELECT j.group_id FROM ai_jobs j WHERE j.kind = 'contract_schedule' AND j.status IN ('queued','in_progress')
  AND ${DEAL_OF_JOB}?1) LIMIT 1`;
const LIST_SQL = `SELECT j.id, j.group_id, j.run_index, j.pair_mode, j.status, j.model, j.error_code, j.confirmed_at, j.created_at FROM ai_jobs j
  WHERE j.kind = 'contract_schedule' AND ${DEAL_OF_JOB}?1) ORDER BY j.created_at DESC, j.group_id, j.run_index LIMIT ?2`;
// 거래가 있고, 고른 파일이 모두 그 거래의 가림 확인된 계약서 사본일 때만 장수만큼 돌아온다.
const FILES_SQL = `SELECT f.id, f.r2_key, f.mime_type, f.byte_size FROM files f
  WHERE f.deal_id = ?1 AND f.kind = 'contract_copy' AND f.rrn_masked = 1 AND f.id IN (SELECT value FROM json_each(?2))
    AND EXISTS (SELECT 1 FROM deals d WHERE d.id = ?1)`;
const DEAL_OF_FILES_SQL = "SELECT f.deal_id AS deal_id FROM files f WHERE f.id IN (SELECT value FROM json_each(?1)) AND f.deal_id IS NOT NULL LIMIT 1";
// 조건부로 넣는다: 같은 거래에 (이 묶음이 아닌) 진행 중 묶음이 없고, 파일 조건이 지금도 그대로일 때만. 열린 행의 토큰 칸에는 예약값을 둔다.
const JOB_INSERT_SQL = `INSERT INTO ai_jobs (id, group_id, run_index, pair_mode, kind, status, lease_until, model, reasoning_effort, input_file_ids,
  input_tokens, output_tokens, created_at, updated_at)
SELECT ?1, ?2, ?3, ?4, 'contract_schedule', 'queued', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11
WHERE NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.kind = 'contract_schedule' AND j.status IN ('queued','in_progress') AND j.group_id <> ?2
    AND ${DEAL_OF_JOB}?12))
  AND (SELECT count(*) FROM files f WHERE f.deal_id = ?12 AND f.kind = 'contract_copy' AND f.rrn_masked = 1
    AND f.id IN (SELECT value FROM json_each(?8))) = ?13`;
// 작업 행이 실제로 들어갔을 때만 감사가 남는다(OpenAI를 부르기 전).
const CREATE_AUDIT_SQL = `INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)
SELECT ?1, ?2, 'ai.create', 'ai_job_group', ?3, ?4, 'ok', ?5 WHERE (SELECT count(*) FROM ai_jobs WHERE group_id = ?3) = ${AI_CONTRACT_READS}`;
const CREATED_SQL = "UPDATE ai_jobs SET openai_response_id = ?2, status = ?3, updated_at = ?4 WHERE id = ?1 AND status = 'queued'";
const PROGRESS_SQL = "UPDATE ai_jobs SET status = ?2, updated_at = ?3 WHERE id = ?1 AND status IN ('queued','in_progress')";
// 결과를 받아 닫는다: 토큰 칸을 실제 사용량(모르면 NULL)으로 바꾼다.
const CLOSE_WITH_RESULT_SQL = `UPDATE ai_jobs SET status = ?2, result_json = ?3, error_code = ?4, input_tokens = ?5, output_tokens = ?6, updated_at = ?7
  WHERE id = ?1 AND status IN ('queued','in_progress')`;
// 결과 없이 닫는다(unknown·expired): 토큰 칸의 예약값을 비운다. 미리 더한 한도는 되돌리지 않는다(실제로 비용이 들었을 수 있음).
const CLOSE_NO_RESULT_SQL = `UPDATE ai_jobs SET status = ?2, error_code = ?3, input_tokens = NULL, output_tokens = NULL, updated_at = ?4
  WHERE id = ?1 AND status IN ('queued','in_progress')`;
// 생성 4xx(만들어지지 않음): 같은 batch에서 refundJobStatement() **뒤에** 둔다.
const CLOSE_NOT_CREATED_SQL = `UPDATE ai_jobs SET status = 'failed', error_code = ?2, input_tokens = NULL, output_tokens = NULL, updated_at = ?3
  WHERE id = ?1 AND status = 'queued' AND openai_response_id IS NULL`;
const CANCEL_GUARD_SQL = "SELECT CASE WHEN EXISTS (SELECT 1 FROM ai_jobs WHERE group_id = ?1 AND confirmed_at IS NOT NULL) THEN json('guard') ELSE 1 END AS ok";
// 확정 전 묶음의 행을 모두 cancelled로 바꾸고 결과를 지운다. 열린 행은 토큰 칸의 예약값을 비우고, 이미 닫힌 행의 실제 사용량은 그대로 둔다.
const CANCEL_SQL = `UPDATE ai_jobs SET input_tokens = CASE WHEN status IN ('queued','in_progress') THEN NULL ELSE input_tokens END,
  output_tokens = CASE WHEN status IN ('queued','in_progress') THEN NULL ELSE output_tokens END,
  status = 'cancelled', result_json = NULL, updated_at = ?2
  WHERE group_id = ?1 AND kind = 'contract_schedule' AND confirmed_at IS NULL AND status <> 'cancelled'`;

const parseJson = (text) => {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

async function readGroup(db, groupId) {
  if (!isUuid(groupId)) throw notFound();
  const { results } = await db.prepare(GROUP_SQL).bind(groupId).all();
  if (!results || results.length === 0) throw notFound();
  return results;
}

// 묶음 상태: running(열린 행 있음) → cancelled → confirmed·ready(결과가 하나라도 있음) → failed.
// 한 번 읽기 묶음(행 1개)은 그 작업이 끝나면 ready, 실패하면 failed다. 옛 두 번 읽기 묶음(행 2개)도 같은 규칙이다.
export function groupStatusOf(rows) {
  if (rows.some((row) => OPEN_STATUSES.has(row.status))) return "running";
  if (rows.some((row) => row.status === "cancelled")) return "cancelled";
  if (rows.some((row) => row.status === "completed")) return rows.some((row) => row.confirmed_at) ? "confirmed" : "ready";
  return "failed";
}

const jobSummary = (row) => ({ id: row.id, runIndex: row.run_index, model: row.model, status: row.status, errorCode: row.error_code });

// 결과는 묶음이 다 끝난 뒤(ready·confirmed)에만 싣는다. 진행 중 조회(5초마다)에는 싣지 않아 열람 감사가 쌓이지 않는다.
function groupView(rows, dealId) {
  const status = groupStatusOf(rows);
  const withResult = status === "ready" || status === "confirmed";
  return {
    group: {
      id: rows[0].group_id,
      kind: rows[0].kind,
      dealId,
      status,
      pairMode: rows[0].pair_mode,
      createdAt: rows[0].created_at,
      confirmedAt: rows.find((row) => row.confirmed_at)?.confirmed_at ?? null,
      // 읽은 사본 ID(보낸 순서 = 근거 evidence.page의 쪽 번호). 결과 고르기 화면이 근거 쪽의 사진을 짝짓는 데 쓴다(화면 PR).
      fileIds: parseJson(rows[0].input_file_ids) ?? [],
    },
    jobs: rows.map((row) => {
      const stored = withResult && row.status === "completed" ? parseJson(row.result_json) : null;
      return {
        ...jobSummary(row),
        reasoningEffort: row.reasoning_effort,
        maskedCount: stored ? Number(stored.maskedCount ?? 0) : 0,
        result: stored?.result ?? null,
      };
    }),
  };
}

// ── 만들기 ──

function parseCreateBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !["kind", "fileIds", "dealId"].includes(key))) throw invalid(["body"]);
  if (body.kind !== AI_JOB_KIND) throw invalid(["kind"]);
  if (!isUuid(body.dealId)) throw invalid(["dealId"]);
  if (!Array.isArray(body.fileIds) || body.fileIds.length === 0) throw invalid(["fileIds"]);
  if (body.fileIds.length > AI_MAX_FILES) throw inputTooLarge();
  if (body.fileIds.some((id) => !isUuid(id)) || new Set(body.fileIds).size !== body.fileIds.length) throw invalid(["fileIds"]);
  return { dealId: body.dealId, fileIds: [...body.fileIds] };
}

// R2에서 사진을 한 장씩 읽어 data URL 글로 바꾼다(바이트는 바꾼 뒤 바로 놓는다). 한도를 미리 더하기 전이라 실패해도 되돌릴 것이 없다.
// - R2 예외: 503 FILE_STORAGE_FAILED / 객체 없음(D1 행만 남음): 404 + 경고 로그(고정 코드만, 키·파일 ID 없음)
async function readImages(ctx, fileRows) {
  const images = [];
  let total = 0;
  for (const row of fileRows) {
    let object;
    try {
      object = await ctx.files.get(row.r2_key);
    } catch {
      throw fileStorageFailed();
    }
    if (!object) {
      logAi(ctx.log, { requestId: ctx.requestId, level: "warn", code: "FILE_OBJECT_MISSING" });
      throw notFound();
    }
    let bytes;
    try {
      bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    } catch {
      throw fileStorageFailed();
    }
    total += bytes.byteLength;
    if (total > AI_MAX_TOTAL_BYTES) throw inputTooLarge();
    images.push(`data:${row.mime_type};base64,${toBase64(bytes)}`);
  }
  return images;
}

// 생성 요청 1번(재시도 0회). 요청 본문은 이 함수 안에서만 만들어 쓰고 버린다. 돌려주는 값: { created, code, unknown }.
async function sendCreate(ctx, job, images) {
  const { db, env, requestId, now, log, openaiFetch } = ctx;
  const started = Date.now();
  let created;
  try {
    created = await createBackgroundResponse(buildContractRequest(job.model, job.detail, job.runIndex, images), env, openaiFetch, { timeoutMs: AI_CREATE_TIMEOUT_MS });
  } catch (error) {
    const aiError = error instanceof WorkAiError ? error : new WorkAiError("AI_NETWORK");
    const notCreated = Number.isInteger(aiError.status) && aiError.status >= 400 && aiError.status < 500;
    logAi(log, { requestId, run: job.runIndex, upstreamRequestId: aiError.upstreamRequestId, model: job.model.model, effort: job.model.effort, status: aiError.status, code: aiError.code, upstreamError: aiError.upstreamError ?? undefined, ms: Date.now() - started });
    const code = notCreated ? aiError.code : "AI_STATE_UNKNOWN";
    const statements = notCreated
      ? [refundJobStatement(db, { jobId: job.id, day: job.day, reservedCostMicroUsd: job.reservedCostMicroUsd }), db.prepare(CLOSE_NOT_CREATED_SQL).bind(job.id, code, iso(now))]
      : [db.prepare(CLOSE_NO_RESULT_SQL).bind(job.id, "unknown", code, iso(now))];
    try {
      await runBatch(db, statements);
    } catch {
      // 상태 기록 실패: 행은 queued로 남고 응답 ID가 없어 10분 뒤 조회에서 unknown이 된다.
    }
    return { created: false, code, unknown: !notCreated };
  }
  logAi(log, { requestId, run: job.runIndex, upstreamRequestId: created.upstreamRequestId, model: job.model.model, effort: job.model.effort, status: created.status, ms: Date.now() - started });
  let recorded = 1;
  try {
    const batch = await runBatch(db, [db.prepare(CREATED_SQL).bind(job.id, created.id, created.status === "in_progress" ? "in_progress" : "queued", iso(now))]);
    recorded = changesOf(batch[0]);
  } catch {
    // 응답 ID를 적지 못함: 위와 같이 10분 뒤 unknown이 된다(한도는 되돌리지 않음).
  }
  if (recorded === 0) {
    // 생성 요청을 보내는 사이 묶음이 취소돼 행이 이미 닫혔다. 방금 만들어진 OpenAI 작업이 혼자 돌지 않게 취소한다(실패해도 한도는 예약한 채라 적게 세지 않음).
    try {
      await cancelResponse(created.id, env, openaiFetch);
    } catch {
      // 취소 실패는 그대로 둔다.
    }
  }
  return { created: true, code: null, unknown: false };
}

// POST /work/ai/jobs  { kind: "contract_schedule", fileIds: [1 ~ 5개], dealId }
async function createJobs(ctx) {
  const { db, env, actor, requestId, now, randomUUID } = ctx;
  const { dealId, fileIds } = parseCreateBody(ctx.body);
  const config = readContractAiConfig(env);
  if (config.error) throw aiUnavailable(config.error);

  const fileIdsJson = JSON.stringify(fileIds);
  const { results } = await db.prepare(FILES_SQL).bind(dealId, fileIdsJson).all();
  const byId = new Map((results ?? []).map((row) => [row.id, row]));
  if (byId.size !== fileIds.length || [...byId.values()].some((row) => !IMAGE_MIME_TYPES.has(row.mime_type))) throw notFound();
  const fileRows = fileIds.map((id) => byId.get(id));
  if (fileRows.reduce((sum, row) => sum + Number(row.byte_size), 0) > AI_MAX_TOTAL_BYTES) throw inputTooLarge();

  // 미리 확인(R2·한도에 손대기 전에 흔한 경우를 거른다). 경합은 아래 조건부 INSERT가 막는다.
  const active = await db.prepare(ACTIVE_GROUP_SQL).bind(dealId).first();
  if (active) throw jobActive(active.group_id);

  const images = await readImages(ctx, fileRows);

  const model = config.a;
  const { inputTokens, reservedTotal } = contractReservation(config, images.length);
  const { day } = await reserveAiBudgetMany(db, { nowMs: now, count: AI_CONTRACT_READS, reservedCostMicroUsd: reservedTotal });
  const refundAll = async () => {
    try {
      await refundManyStatement(db, { day, count: AI_CONTRACT_READS, reservedCostMicroUsd: reservedTotal }).run();
    } catch {
      // 되돌리기 실패는 한도를 실제보다 많이 센 쪽이라 그대로 둔다.
    }
  };

  const groupId = randomUUID();
  const jobId = randomUUID();
  const at = iso(now);
  let inserted;
  try {
    const batch = await runBatch(db, [
      // 한 번 읽기 묶음: run_index 1, pair_mode NULL(두 번 읽기의 짝 방식이 없음. 0001의 CHECK가 NULL을 받는다).
      db.prepare(JOB_INSERT_SQL).bind(jobId, groupId, 1, null, iso(now + AI_LEASE_MS), model.model, model.effort,
        fileIdsJson, inputTokens, model.maxOutputTokens, at, dealId, fileIds.length),
      // reason은 고정 꼴만(거래·파일 번호 없음).
      db.prepare(CREATE_AUDIT_SQL).bind(at, actor.email.toLowerCase(), groupId, requestId, `kind=${AI_JOB_KIND};files=${fileIds.length};reads=${AI_CONTRACT_READS}`),
    ]);
    inserted = changesOf(batch[0]);
  } catch (error) {
    await refundAll();
    throw error;
  }
  if (inserted !== 1) {
    // 미리 확인한 뒤 다른 요청이 먼저 넣었거나(409) 그 사이 파일이 지워졌다(404). OpenAI는 부르지 않는다.
    await refundAll();
    const other = await db.prepare(ACTIVE_GROUP_SQL).bind(dealId).first();
    throw other ? jobActive(other.group_id) : notFound();
  }

  const outcome = await sendCreate(ctx, { id: jobId, runIndex: 1, model, detail: config.detail, day, reservedCostMicroUsd: reservedTotal }, images);
  if (!outcome.created) {
    // 만들어지지 않았으면 오류로 답한다. "모름"이면 AI_STATE_UNKNOWN(행은 unknown으로 남아 목록에서 보인다).
    throw aiErrorResponse(outcome.unknown ? "AI_STATE_UNKNOWN" : outcome.code);
  }
  const rows = await readGroup(db, groupId);
  return { status: 201, data: { groupId, pairMode: null, jobs: rows.map(jobSummary) } };
}

// ── 결과 받기(조회 API와 1분 예약이 같이 쓴다) ──

// 열린 작업 행 하나의 OpenAI 상태를 1번 본다. 돌려주는 값: 바뀌었으면 batch 문장들, 아니면 [].
// row는 방금 읽은 열린 행이어야 한다(토큰 칸 = 예약값). 그 사이 다른 쪽이 먼저 닫았으면 guard 때문에 아무것도 바뀌지 않는다.
// context: { db, env, requestId, now, log, openaiFetch }
export async function pollJob(context, row) {
  const { db, env, requestId, now, log, openaiFetch } = context;
  const at = iso(now);
  const age = now - Date.parse(row.created_at);
  const leaseOver = typeof row.lease_until === "string" ? now > Date.parse(row.lease_until) : age > AI_LEASE_MS;
  const closeNoResult = (status, errorCode) => [db.prepare(CLOSE_NO_RESULT_SQL).bind(row.id, status, errorCode, at)];
  const closeWithResult = (status, output, { resultJson = null, errorCode = null } = {}) => {
    const prices = readModelPrices(env, row.model);
    // 열린 행의 토큰 칸 = 예약값. 단가표에서 그 모델이 사라졌으면 비용은 바로잡지 않고 예약한 채로 둔다(많이 센 쪽).
    const reservedCost = prices && Number.isSafeInteger(row.input_tokens) && Number.isSafeInteger(row.output_tokens)
      ? estimateCostMicroUsd(prices, row.input_tokens, row.output_tokens) : 0;
    const actualCost = reservedCost > 0 && output.usageKnown ? estimateCostMicroUsd(prices, output.inputTokens, output.outputTokens) : reservedCost;
    return [
      settleJobUsageStatement(db, { jobId: row.id, day: kstDay(Date.parse(row.created_at)), reservedCostMicroUsd: reservedCost, actualCostMicroUsd: actualCost, inputTokens: output.inputTokens, outputTokens: output.outputTokens }),
      db.prepare(CLOSE_WITH_RESULT_SQL).bind(row.id, status, resultJson, errorCode, output.usageKnown ? output.inputTokens : null, output.usageKnown ? output.outputTokens : null, at),
    ];
  };

  if (!row.openai_response_id) {
    // 생성 요청을 보낸 뒤 응답 ID를 적지 못한 작업(만들어졌는지 모름).
    return age > AI_RESULT_KEEP_MS ? closeNoResult("unknown", "AI_STATE_UNKNOWN") : [];
  }
  const started = Date.now();
  let json;
  try {
    json = await retrieveResponse(row.openai_response_id, env, openaiFetch);
  } catch (error) {
    const code = error instanceof WorkAiError ? error.code : "AI_NETWORK";
    logAi(log, { requestId, run: row.run_index, model: row.model, effort: row.reasoning_effort, code, ms: Date.now() - started });
    if (code === "AI_NOT_FOUND") return age > AI_RESULT_KEEP_MS ? closeNoResult("expired", "AI_RESULT_EXPIRED") : closeNoResult("unknown", "AI_STATE_UNKNOWN");
    // 네트워크·5xx: 그대로 두고 다음 조회에서 다시 본다. 다만 임대 시간이 지났으면 끝없이 보지 않게 닫는다.
    return leaseOver ? closeNoResult("unknown", "AI_LEASE_EXPIRED") : [];
  }
  const output = readResponseOutput(json);
  logAi(log, { requestId, run: row.run_index, model: row.model, effort: row.reasoning_effort, status: output.status, inputTokens: output.inputTokens, outputTokens: output.outputTokens, ms: Date.now() - started });
  if (output.status === "queued" || output.status === "in_progress") {
    if (leaseOver) return closeNoResult("unknown", "AI_LEASE_EXPIRED");
    return output.status !== row.status ? [db.prepare(PROGRESS_SQL).bind(row.id, output.status, at)] : [];
  }
  if (output.status === "completed") {
    const parsed = output.refusal ? null : parseJson(output.text);
    const checked = parsed === null ? { ok: false } : validateContractResult(parsed);
    // 검사를 통과하지 못한 원문은 저장하지 않는다.
    if (!checked.ok) return closeWithResult("failed", output, { errorCode: "AI_RESULT_INVALID" });
    const masked = maskContractResult(checked.result, maskResidentNumbers);
    return closeWithResult("completed", output, { resultJson: JSON.stringify({ maskedCount: masked.count, result: masked.result }) });
  }
  if (output.status === "incomplete") return closeWithResult("failed", output, { errorCode: "AI_RESULT_INCOMPLETE" });
  return closeWithResult("failed", output, { errorCode: "AI_UPSTREAM_FAILED" });
}

// GET /work/ai/jobs/:groupId
async function getGroup(ctx, groupId) {
  const { db, actor, requestId, now } = ctx;
  let rows = await readGroup(db, groupId);
  const open = rows.filter((row) => OPEN_STATUSES.has(row.status));
  if (open.length > 0) {
    for (const row of open) {
      const statements = await pollJob(ctx, row);
      if (statements.length > 0) await runBatch(db, statements);
    }
    rows = await readGroup(db, groupId);
  }
  const dealRow = await db.prepare(DEAL_OF_FILES_SQL).bind(rows[0].input_file_ids).first();
  const view = groupView(rows, dealRow?.deal_id ?? null);
  const results = view.jobs.filter((job) => job.result !== null).length;
  if (results > 0) {
    // 계약서에서 읽은 값이 담긴 응답만 열람 감사를 남기고, 남기지 못하면 돌려주지 않는다(8.8절).
    try {
      await auditStatement(db, { at: iso(now), actorEmail: actor.email, action: "ai.view", targetType: "ai_job_group", targetId: groupId, requestId, outcome: "ok", reason: `kind=${AI_JOB_KIND};results=${results}` }).run();
    } catch {
      throw new WorkApiError("AUDIT_UNAVAILABLE", "작업 기록을 남기지 못해 자료를 보여 드리지 않았습니다.", 503, true);
    }
  }
  return { data: view };
}

// POST /work/ai/jobs/:groupId/cancel  본문은 {}만. 두 번 눌러도 200이다.
async function cancelGroup(ctx, groupId) {
  const { db, env, actor, requestId, now, body, openaiFetch } = ctx;
  if (!isPlainObject(body) || Object.keys(body).length > 0) throw invalid(["body"]);
  const rows = await readGroup(db, groupId);
  if (rows.some((row) => row.confirmed_at)) throw jobConflict();
  if (rows.every((row) => row.status === "cancelled")) return { data: { status: "cancelled" } };
  const open = rows.filter((row) => OPEN_STATUSES.has(row.status));
  for (const row of open) {
    if (!row.openai_response_id) continue;
    try {
      await cancelResponse(row.openai_response_id, env, openaiFetch);
    } catch (error) {
      throw aiErrorResponse(error instanceof WorkAiError && error.code === "AI_RATE_LIMITED" ? "AI_RATE_LIMITED" : "AI_UPSTREAM_FAILED");
    }
  }
  const at = iso(now);
  try {
    await runBatch(db, [
      db.prepare(CANCEL_GUARD_SQL).bind(groupId),
      db.prepare(CANCEL_SQL).bind(groupId, at),
      auditStatement(db, { at, actorEmail: actor.email, action: "ai.cancel", targetType: "ai_job_group", targetId: groupId, requestId, outcome: "ok", reason: `kind=${AI_JOB_KIND};open=${open.length}` }),
    ]);
  } catch (error) {
    const latest = await db.prepare(GROUP_SQL).bind(groupId).all().catch(() => null);
    if (latest?.results?.some((row) => row.confirmed_at)) throw jobConflict();
    throw error;
  }
  return { data: { status: "cancelled" } };
}

// GET /work/ai/jobs?dealId=  그 거래의 최근 묶음(결과 없음, OpenAI 조회 없음). 화면을 닫았다 열었을 때 묶음을 다시 찾는 길이다.
async function listGroups(ctx) {
  const { db, url } = ctx;
  const dealId = url.searchParams.get("dealId");
  if (!isUuid(dealId) || [...url.searchParams.keys()].some((key) => key !== "dealId")) throw invalid(["dealId"]);
  if (!(await db.prepare("SELECT 1 AS n FROM deals WHERE id = ?1").bind(dealId).first())) throw notFound();
  const { results } = await db.prepare(LIST_SQL).bind(dealId, AI_JOB_LIST_GROUPS * 2).all();
  const groups = new Map();
  for (const row of results ?? []) {
    if (!groups.has(row.group_id)) groups.set(row.group_id, []);
    groups.get(row.group_id).push(row);
  }
  return {
    data: {
      items: [...groups.values()].slice(0, AI_JOB_LIST_GROUPS).map((rows) => ({
        groupId: rows[0].group_id,
        status: groupStatusOf(rows),
        pairMode: rows[0].pair_mode,
        createdAt: rows[0].created_at,
        confirmedAt: rows.find((row) => row.confirmed_at)?.confirmed_at ?? null,
        jobs: rows.map(jobSummary),
      })),
    },
  };
}

// ── 예상 비용 미리 보기 ──

// GET /work/ai/estimate?pages=1 ~ 5  만들기 전에 화면이 보여 줄 최대 예상 비용과 남은 한도(2026-11-23 사용자 선택 "넣음").
// 읽기만 한다: D1 쓰기·감사·R2·OpenAI 0번. 계약서 사본 ID는 받지 않고 장수만 받는다(예약 비용은 장수로만 정해지고, 다른 거래의 파일이 있는지 알려 주지 않게).
// 예상 비용은 만들기가 미리 더하는 값과 같은 함수(contractReservation)로 계산하고, 막히는 까닭도 만들기(reserveAiBudgetMany)와 같은 순서로 본다.
// 단가·토큰 수는 싣지 않는다. 비용 단위는 마이크로달러다.
async function estimateCreate(ctx) {
  const { db, env, url, now } = ctx;
  const keys = [...url.searchParams.keys()];
  const raw = url.searchParams.get("pages") ?? "";
  if (keys.length !== 1 || keys[0] !== "pages" || !/^[1-9]$/u.test(raw) || Number(raw) > AI_MAX_FILES) throw invalid(["pages"]);
  const pages = Number(raw);
  const config = readContractAiConfig(env);
  if (config.error) throw aiUnavailable(config.error);
  const { reservedTotal } = contractReservation(config, pages);
  const requests = AI_CONTRACT_READS;
  const limits = await readAiLimits(db);
  const usage = await readAiUsage(db, now);
  const limitsSet = limits.dailyCreateLimit !== null && limits.monthlyCostLimitMicroUsd !== null;
  let blockedBy = null;
  if (!limitsSet) blockedBy = "limits_missing";
  else if (usage.todayCreates + requests > limits.dailyCreateLimit) blockedBy = "daily";
  else if (usage.monthCostMicroUsd + reservedTotal > limits.monthlyCostLimitMicroUsd) blockedBy = "monthly";
  return {
    data: {
      pages,
      requests,
      estimatedCostMicroUsd: reservedTotal,
      dailyCreateLimit: limits.dailyCreateLimit,
      todayCreates: usage.todayCreates,
      remainingCreates: limitsSet ? Math.max(limits.dailyCreateLimit - usage.todayCreates, 0) : null,
      monthlyCostLimitMicroUsd: limits.monthlyCostLimitMicroUsd,
      monthCostMicroUsd: usage.monthCostMicroUsd,
      remainingCostMicroUsd: limitsSet ? Math.max(limits.monthlyCostLimitMicroUsd - usage.monthCostMicroUsd, 0) : null,
      allowed: blockedBy === null,
      blockedBy,
    },
  };
}

// ── 확정 ──
// POST /work/ai/jobs/:groupId/confirm  { dealVersion, apply: { 칸: 값 }, keep: [칸 이름] }(2026-11-23 대장 결정 G18 ~ G21, 사용자 선택 "다섯 다 추천대로")
// - 두 결과가 다르거나 한쪽만 있는 칸은 apply(넣음)·keep(지금 거래 값 그대로) 가운데 정확히 한 곳에 있어야 한다. 같은 칸은 apply에 있을 때만 쓴다.
//   한 번 읽기 묶음(행 1개)은 AI가 읽은 칸(read) 모두가 apply·keep 가운데 한 곳에 있어야 하고, 못 읽은 칸(unread)은 apply에 있을 때만 쓴다.
//   서버가 화면과 같은 비교 함수(contract-compare.mjs compareGroupResults)로 다시 견줘 확인한다.
// - 거래에는 계약일·중도금 날짜·잔금일·거래 종류에 맞는 금액만 쓴다(계약금·중도금·잔금 금액, 물건 표시, 거래 종류는 보기만).
//   첫 중도금은 deals.middle_payment_on, 둘째부터는 직접 일정(kind custom, source ai_confirmed, 금액 없음)으로 넣는다. 다시 확정하면
//   그 거래의 custom·ai_confirmed·끝나지 않은 일정만 바꾼다(사람이 날짜·제목을 고친 것은 manual이라 남음).
//   같은 차 수('n차 중도금'으로 시작하는 직접 일정)를 이미 완료로 표시했으면 그 차는 새로 넣지 않고 notices로 알린다(대장 결정 2026-11-23).
// - 일정은 '다시 계산'과 같은 함수(planDealSchedule)로 같은 batch에서 만든다(모두 source calculated, AI 기한은 쓰지 않음).
// - 한 batch: guard(거래 version·진행 중·묶음 확정 전·결과 있음·사본이 그 거래에 그대로) → 거래 → 일정 → 묶음 confirmed_at → 감사 ai.confirm.
// - 응답은 { deal, events, notices, kept }이고 결과를 다시 싣지 않는다(그래서 ai.view 없음). OpenAI·R2·한도·result_json은 건드리지 않는다.
const CONFIRM_KEYS = Object.freeze(["dealVersion", "apply", "keep"]);
// 확정 칸 → deals 칸(중도금은 따로).
const CONFIRM_COLUMNS = Object.freeze({ contractDate: "contract_on", balanceDate: "balance_on", priceWon: "price_won", depositWon: "deposit_won", monthlyRentWon: "monthly_rent_won" });
// 거래·일정 검사가 돌려주는 칸 이름 → 확정 칸 이름(화면이 그 칸을 짚을 수 있게).
const DEAL_TO_CONFIRM_FIELD = Object.freeze({ contractOn: "contractDate", middlePaymentOn: "middlePayments", balanceOn: "balanceDate" });
const dealClosed = () => new WorkApiError("DEAL_CLOSED", "끝난 거래와 취소한 거래에는 AI 결과를 넣을 수 없습니다.", 409);
const versionConflict = () => new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
// 묶음의 사본이 모두 아직 한 거래에 붙어 있을 때만 그 거래가 나온다(하나라도 휴지통에 갔거나 다른 거래면 n이 장수와 다름).
const CONFIRM_FILES_SQL = `SELECT count(*) AS n, min(f.deal_id) AS lo, max(f.deal_id) AS hi FROM files f
  WHERE f.id IN (SELECT value FROM json_each(?1)) AND f.kind = 'contract_copy' AND f.deal_id IS NOT NULL`;
const CONFIRM_GUARD_SQL = `SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deals WHERE id = ?1 AND version = ?2 AND status NOT IN ('completed', 'cancelled'))
  OR EXISTS (SELECT 1 FROM ai_jobs WHERE group_id = ?3 AND (confirmed_at IS NOT NULL OR status IN ('queued', 'in_progress', 'cancelled')))
  OR NOT EXISTS (SELECT 1 FROM ai_jobs WHERE group_id = ?3 AND status = 'completed' AND result_json IS NOT NULL)
  OR (SELECT count(*) FROM files f WHERE f.deal_id = ?1 AND f.kind = 'contract_copy' AND f.id IN (SELECT value FROM json_each(?4))) <> ?5
  THEN json('guard') ELSE 1 END AS ok`;
const CONFIRM_DEAL_SQL = `UPDATE deals SET contract_on = ?1, middle_payment_on = ?2, balance_on = ?3, price_won = ?4, deposit_won = ?5, monthly_rent_won = ?6,
  version = version + 1, updated_at = ?7 WHERE id = ?8 AND version = ?9`;
const AI_MIDDLE_DELETE_SQL = "DELETE FROM deal_events WHERE deal_id = ?1 AND kind = 'custom' AND source = 'ai_confirmed' AND done_at IS NULL";
const AI_MIDDLE_INSERT_SQL = `INSERT INTO deal_events (id, deal_id, kind, due_on, title, alarm_offsets, source, done_at, version, created_at, updated_at)
  VALUES (?1, ?2, 'custom', ?3, ?4, ?5, 'ai_confirmed', NULL, 1, ?6, ?6)`;
// 결과가 있던 행(completed)만 확정 시각을 적는다. 실패한 행은 비워 둔다.
const CONFIRM_JOBS_SQL = "UPDATE ai_jobs SET confirmed_at = ?2 WHERE group_id = ?1 AND kind = 'contract_schedule' AND status = 'completed' AND confirmed_at IS NULL";

// 칸 이름만 details에 싣는다. 모르는 이름은 짧은 영문 이름일 때만 그대로, 아니면 그 묶음 이름(apply·keep)으로.
const detailName = (name, fallback) => (/^[A-Za-z]{1,40}$/u.test(name) ? name : fallback);

function parseConfirmBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !CONFIRM_KEYS.includes(key))) throw invalid(["body"]);
  if (!Number.isSafeInteger(body.dealVersion) || body.dealVersion < 1) throw invalid(["dealVersion"]);
  if (!isPlainObject(body.apply)) throw invalid(["apply"]);
  if (!Array.isArray(body.keep) || body.keep.some((name) => typeof name !== "string")) throw invalid(["keep"]);
  const wrong = [];
  const apply = {};
  for (const [field, value] of Object.entries(body.apply)) {
    if (!CONFIRM_FIELDS.includes(field)) {
      wrong.push(detailName(field, "apply"));
    } else if (field === "middlePayments") {
      if (!Array.isArray(value) || value.length > CONFIRM_MIDDLE_PAYMENTS_MAX || value.some((date) => !isCalendarDate(date))) wrong.push(field);
      else apply[field] = [...value];
    } else if (CONFIRM_AMOUNT_FIELDS.includes(field)) {
      if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value >= MAX_AMOUNT_WON_EXCLUSIVE)) wrong.push(field);
      else apply[field] = value;
    } else if (value !== null && !isCalendarDate(value)) {
      wrong.push(field);
    } else {
      apply[field] = value;
    }
  }
  const seen = new Set();
  for (const field of body.keep) {
    // 모르는 칸, 두 번 쓴 칸, apply에도 있는 칸
    if (!CONFIRM_FIELDS.includes(field) || seen.has(field) || Object.hasOwn(body.apply, field)) wrong.push(detailName(field, "keep"));
    seen.add(field);
  }
  if (wrong.length > 0) throw invalid([...new Set(wrong)].slice(0, 10));
  return { dealVersion: body.dealVersion, apply, keep: [...seen] };
}

// 저장해 둔 결과를 다시 검사해 꺼낸다(결과가 없거나 꼴이 깨졌으면 null).
function storedResult(row) {
  if (!row || row.status !== "completed") return null;
  const stored = parseJson(row.result_json);
  const checked = stored ? validateContractResult(stored.result) : { ok: false };
  return checked.ok ? checked.result : null;
}

function asConfirmFields(error) {
  if (error instanceof WorkApiError && error.code === "VALIDATION_FAILED" && Array.isArray(error.details)) {
    return invalid([...new Set(error.details.map((name) => DEAL_TO_CONFIRM_FIELD[name] ?? name))]);
  }
  return error;
}

async function confirmGroup(ctx, groupId) {
  const { db, actor, requestId, now, randomUUID } = ctx;
  const input = parseConfirmBody(ctx.body);
  const rows = await readGroup(db, groupId);
  if (groupStatusOf(rows) !== "ready") throw jobConflict();
  const fileIdsJson = rows[0].input_file_ids;
  const fileIds = parseJson(fileIdsJson);
  if (!Array.isArray(fileIds) || fileIds.length === 0) throw notFound();
  const link = await db.prepare(CONFIRM_FILES_SQL).bind(fileIdsJson).first();
  if (!link || Number(link.n) !== fileIds.length || !link.lo || link.lo !== link.hi) throw notFound();
  const dealId = link.lo;
  const deal = await loadDeal(db, dealId);
  if (!deal) throw notFound();
  if (CLOSED_DEAL_STATUSES.includes(deal.status)) throw dealClosed();
  if (deal.version !== input.dealVersion) throw versionConflict();

  // 거래 종류에 맞지 않는 금액 칸은 apply·keep 어디에도 둘 수 없다(G12).
  const allowed = confirmFieldsFor(deal.deal_type);
  const offType = [...Object.keys(input.apply), ...input.keep].filter((field) => !allowed.includes(field));
  if (offType.length > 0) throw invalid(offType);
  // 행은 run_index 순서다(GROUP_SQL). 한 번 읽기 묶음은 결과 1개, 옛 두 번 읽기 묶음은 2개(결과가 없는 작업은 null).
  const results = rows.map(storedResult);
  if (results.every((result) => result === null)) throw jobConflict();
  const missing = missingDecisions(compareGroupResults(results, deal.deal_type), input.apply, input.keep);
  if (missing.length > 0) throw invalid(missing);

  // 새 거래 값(고른 칸만 바꿈).
  const next = { ...deal };
  for (const [field, column] of Object.entries(CONFIRM_COLUMNS)) {
    if (Object.hasOwn(input.apply, field)) next[column] = input.apply[field];
  }
  const middles = Object.hasOwn(input.apply, "middlePayments") ? input.apply.middlePayments : null;
  if (middles) next.middle_payment_on = middles[0] ?? null;
  let plan;
  try {
    assertDealConsistent(rowToDeal(next));
    // 중도금은 앞 차보다 빠르거나, 계약일보다 빠르거나, 잔금일보다 늦으면 안 된다(뒤 차는 거래 칸이 아니라 여기서만 본다).
    if (middles && middles.some((date, index) => (index > 0 && date < middles[index - 1]) || (next.contract_on && date < next.contract_on) || (next.balance_on && date > next.balance_on))) {
      throw invalid(["middlePayments"]);
    }
    plan = planDealSchedule(ctx, dealId, next);
  } catch (error) {
    throw asConfirmFields(error);
  }

  const at = iso(now);
  const alarms = JSON.stringify(DEFAULT_ALARM_TRIGGERS);
  // 제목은 다시 계산의 날짜 일정과 같은 꼴("2차 중도금(물건 표시)"), 금액은 넣지 않는다(캘린더 구독으로 나가므로).
  // 같은 차 수의 중도금 일정을 이미 완료로 표시했으면(사람이 고친 manual 포함) 그 차는 새로 넣지 않고 알린다(대장 결정 2026-11-23, 완료 기록은 그대로).
  const doneEvents = middles && middles.length > 1 ? (await loadDealEvents(db, dealId)).filter((event) => event.kind === "custom" && event.doneAt !== null) : [];
  const skippedMiddles = [];
  const aiEvents = [];
  (middles ?? []).slice(1).forEach((date, index) => {
    const label = `${index + 2}차 중도금`;
    if (doneEvents.some((event) => event.title.startsWith(label))) {
      skippedMiddles.push(label);
      return;
    }
    aiEvents.push({ id: randomUUID(), date, title: cleanSingleLine(next.property_label ? `${label}(${next.property_label})` : label, 80) });
  });
  const statements = [
    db.prepare(CONFIRM_GUARD_SQL).bind(dealId, input.dealVersion, groupId, fileIdsJson, fileIds.length),
    db.prepare(CONFIRM_DEAL_SQL).bind(next.contract_on, next.middle_payment_on, next.balance_on, next.price_won, next.deposit_won, next.monthly_rent_won, at, dealId, input.dealVersion),
    ...plan.statements,
  ];
  if (middles) {
    statements.push(db.prepare(AI_MIDDLE_DELETE_SQL).bind(dealId));
    for (const event of aiEvents) statements.push(db.prepare(AI_MIDDLE_INSERT_SQL).bind(event.id, dealId, event.date, event.title, alarms, at));
  }
  statements.push(
    db.prepare(CONFIRM_JOBS_SQL).bind(groupId, at),
    // reason은 고정 꼴(넣은 칸 수·계산한 일정 수)만. 날짜·금액·계약서 글·거래 제목은 넣지 않는다.
    auditStatement(db, { at, actorEmail: actor.email, action: "ai.confirm", targetType: "ai_job_group", targetId: groupId, requestId, outcome: "ok",
      reason: `kind=${AI_JOB_KIND};fields=${Object.keys(input.apply).length};events=${plan.planned.length + aiEvents.length}` }),
  );
  try {
    await runBatch(db, statements);
  } catch (error) {
    // guard가 되돌렸으면 그사이 바뀐 것을 알려 준다: 묶음 상태(취소·다른 확정) 409, 거래 없음·사본이 빠짐 404, 끝난 거래 409, 다른 화면이 거래를 고침 409.
    const latestRows = await db.prepare(GROUP_SQL).bind(groupId).all().then((result) => result.results ?? [], () => null);
    if (latestRows && latestRows.length > 0 && groupStatusOf(latestRows) !== "ready") throw jobConflict();
    const latest = await loadDeal(db, dealId);
    if (!latest) throw notFound();
    if (CLOSED_DEAL_STATUSES.includes(latest.status)) throw dealClosed();
    if (latest.version !== input.dealVersion) throw versionConflict();
    const latestLink = await db.prepare(CONFIRM_FILES_SQL).bind(fileIdsJson).first().catch(() => null);
    if (latestLink && (Number(latestLink.n) !== fileIds.length || latestLink.lo !== dealId || latestLink.hi !== dealId)) throw notFound();
    throw error;
  }
  const events = await loadDealEvents(db, dealId);
  const outcome = scheduleOutcome(plan.planned, plan.schedule, events);
  outcome.notices.push(...skippedMiddles.map((label) => `${label}은 이미 완료 표시돼 새로 넣지 않았습니다.`));
  return { data: { deal: dealView(await loadDeal(db, dealId)), events, ...outcome } };
}


// ── 경로 ──

// ctx: { db, env, actor, requestId, now, method, route, url, body, randomUUID, files, log, openaiFetch }
// 경로가 /ai가 아니면 null을 돌려준다.
export async function routeWorkAi(ctx) {
  const { method, route } = ctx;
  if (!isWorkAiRoute(route)) return null;
  if (route === "/ai/estimate") {
    if (method !== "GET") throw methodNotAllowed("GET");
    return estimateCreate(ctx);
  }
  if (route === "/ai/jobs") {
    if (method === "GET") return listGroups(ctx);
    if (method !== "POST") throw methodNotAllowed("GET, POST");
    return createJobs(ctx);
  }
  const match = route.match(/^\/ai\/jobs\/([^/]+)(\/cancel|\/confirm)?$/u);
  if (match) {
    const [, groupId, action] = match;
    if (!action) {
      if (method !== "GET") throw methodNotAllowed("GET");
      return getGroup(ctx, groupId);
    }
    if (method !== "POST") throw methodNotAllowed("POST");
    return action === "/cancel" ? cancelGroup(ctx, groupId) : confirmGroup(ctx, groupId);
  }
  throw notFound();
}
