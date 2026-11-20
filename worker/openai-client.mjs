// OpenAI Responses API 공통 부품(설계서 14.1·14.5절). SDK 없이 fetch만 쓰고, 시험은 fetcher를 바꿔 끼워 실제 OpenAI를 부르지 않는다.
// - 생성 요청(POST /v1/responses)은 자동 재시도 0회. 응답을 받기 전에 끊기면 실제로 만들어졌는지 모르므로 AI_STATE_UNKNOWN.
// - 조회(GET /v1/responses/{id})는 1회까지 다시 부른다(비용 없음). 취소는 두 번 불러도 안전하다.
// - 키·요청 본문·응답 본문·error.message는 로그와 오류에 넣지 않는다. 오류에는 고정 코드·HTTP 상태·x-request-id만 담는다.
// 단계 4가 이 파일을 그대로 쓴다(P3가 먼저 만듦).

export const OPENAI_API_ROOT = "https://api.openai.com/v1";
const CREATE_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 20_000;
const RESPONSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/u;

export class WorkAiError extends Error {
  constructor(code, { status = null, upstreamRequestId = null } = {}) {
    super(code);
    this.name = "WorkAiError";
    this.code = code;
    this.status = status;
    this.upstreamRequestId = upstreamRequestId;
  }
}

const requestIdOf = (response) => {
  const value = response?.headers?.get?.("x-request-id") ?? null;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(value) ? value : null;
};

function codeForStatus(status) {
  if (status === 429) return "AI_RATE_LIMITED";
  if (status === 401 || status === 403) return "AI_CONFIG_INVALID";
  if (status === 404) return "AI_NOT_FOUND";
  if (status >= 500) return "AI_UPSTREAM_FAILED";
  return "AI_REQUEST_INVALID";
}

// 요청 1번. 성공이면 { json, upstreamRequestId }, 실패면 WorkAiError를 던진다(네트워크·시간 초과는 AI_NETWORK).
export async function openaiRequest(path, { method = "GET", body, timeoutMs } = {}, env, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(`${OPENAI_API_ROOT}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "leaderscityhappy-work-worker",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? (method === "POST" ? CREATE_TIMEOUT_MS : READ_TIMEOUT_MS)),
    });
  } catch {
    throw new WorkAiError("AI_NETWORK");
  }
  const upstreamRequestId = requestIdOf(response);
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // 본문 닫기 실패는 무시한다.
    }
    throw new WorkAiError(codeForStatus(response.status), { status: response.status, upstreamRequestId });
  }
  try {
    return { json: await response.json(), upstreamRequestId };
  } catch {
    throw new WorkAiError("AI_RESPONSE_INVALID", { status: response.status, upstreamRequestId });
  }
}

// background 생성(재시도 0회). 돌려주는 값: { id, status, upstreamRequestId }.
export async function createBackgroundResponse(body, env, fetcher) {
  const { json, upstreamRequestId } = await openaiRequest("/responses", { method: "POST", body }, env, fetcher);
  if (typeof json?.id !== "string" || !RESPONSE_ID_PATTERN.test(json.id)) throw new WorkAiError("AI_RESPONSE_INVALID", { upstreamRequestId });
  return { id: json.id, status: typeof json.status === "string" ? json.status : "queued", upstreamRequestId };
}

// 조회. 네트워크·5xx는 1번만 다시 부른다. 404는 AI_NOT_FOUND(임시 보관이 끝났거나 없는 ID).
export async function retrieveResponse(id, env, fetcher) {
  if (!RESPONSE_ID_PATTERN.test(id)) throw new WorkAiError("AI_NOT_FOUND");
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return (await openaiRequest(`/responses/${id}`, { method: "GET" }, env, fetcher)).json;
    } catch (error) {
      lastError = error;
      if (!(error instanceof WorkAiError) || !["AI_NETWORK", "AI_UPSTREAM_FAILED"].includes(error.code)) throw error;
    }
  }
  throw lastError;
}

// 취소. 이미 끝났거나 없는 작업(404·409·400)은 성공으로 본다.
export async function cancelResponse(id, env, fetcher) {
  if (!RESPONSE_ID_PATTERN.test(id)) return;
  try {
    await openaiRequest(`/responses/${id}/cancel`, { method: "POST" }, env, fetcher);
  } catch (error) {
    if (error instanceof WorkAiError && [400, 404, 409].includes(error.status)) return;
    throw error;
  }
}

// 응답 객체에서 글(output_text)·거절(refusal)·사용량을 꺼낸다. 원문을 다른 곳에 남기지 않는다.
export function readResponseOutput(json) {
  let text = "";
  let refusal = false;
  for (const item of Array.isArray(json?.output) ? json.output : []) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === "output_text" && typeof part.text === "string") text += part.text;
      if (part?.type === "refusal") refusal = true;
    }
  }
  const usage = json?.usage ?? {};
  const tokens = (value) => (Number.isSafeInteger(value) && value >= 0 ? value : 0);
  return {
    status: typeof json?.status === "string" ? json.status : "unknown",
    text,
    refusal,
    inputTokens: tokens(usage.input_tokens),
    outputTokens: tokens(usage.output_tokens),
    incompleteReason: typeof json?.incomplete_details?.reason === "string" ? json.incomplete_details.reason.slice(0, 40) : null,
  };
}
