// 실거래가 화면(P1-d)의 업무 API 호출. 응답 봉투 해석은 관리자 콘텐츠 API(admin-content-client.ts)와 같은 방식이다.
// 업무 API 요청은 모두(이 파일·work-customers-client.ts·work-files-client.ts) redirect: "manual"로 보낸다. 로그인이 만료되면 Access가
// 다른 주소(팀 로그인 화면)로 보내는데(**추정**: 실제 만료 응답은 운영에서 확인 전), 따라가면 CORS에 막혀 fetch가 TypeError를 던져
// 로그인 만료인지 알 수 없다. 따라가지 않으면 응답이 opaqueredirect(status 0)로 와서 readEnvelope가 AUTH_REQUIRED로 본다.
// 업무 API(Worker)는 이동 응답을 보내지 않으므로 이동은 모두 Access 쪽이다.
// 쓰기(관심 단지 저장·다시 받기)는 업무 세션의 보안 토큰을 X-Admin-CSRF로 보내고, 토큰이 만료됐으면 세션을 한 번 새로 받아 다시 보낸다.
// 입력값·응답을 브라우저 저장소나 주소에 남기지 않는다.

const WORK_API_ROOT = "/api/admin/v1/work";

export class WorkApiError extends Error {
  code: string | null;
  status: number;
  retryAt: string | null;
  // 오류가 난 칸 이름(VALIDATION_FAILED·DISCLOSURE_INCOMPLETE 등). 입력값은 담기지 않는다(글 초안 P3에서 더함).
  details: string[];

  constructor(message: string, { code = null, status = 0, retryAt = null, details = [] }: { code?: string | null; status?: number; retryAt?: string | null; details?: string[] } = {}) {
    super(message);
    this.name = "WorkApiError";
    this.code = code;
    this.status = status;
    this.retryAt = retryAt;
    this.details = details;
  }
}

export interface WorkSession {
  realpriceEnabled: boolean;
  blogEnabled: boolean;
  administrator: string;
  csrfToken: string | null;
  schemaVersion: number | null;
}

interface WorkEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; retryAt?: string; details?: unknown };
}

// 손님 화면(단계 2, work-customers-client.ts)도 같은 봉투 해석을 쓴다.
export async function readEnvelope<T>(response: Response): Promise<T> {
  if (response.type === "opaqueredirect") {
    // redirect: "manual"로 막은 이동(위 설명). 요청은 Worker까지 가지 않았다.
    throw new WorkApiError("관리자 로그인이 만료되었습니다.", { code: "AUTH_REQUIRED", status: 0 });
  }
  const type = (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") {
    // Access 로그인 만료는 JSON이 아닌 응답(로그인 화면으로 이동)으로 온다.
    throw new WorkApiError("관리자 로그인이 만료되었습니다.", { code: response.redirected || [401, 403].includes(response.status) ? "AUTH_REQUIRED" : null, status: response.status });
  }
  let body: WorkEnvelope<T>;
  try {
    body = await response.json() as WorkEnvelope<T>;
  } catch {
    throw new WorkApiError("업무 API 응답을 읽지 못했습니다.", { status: response.status });
  }
  if (!response.ok || !body.ok || body.data === undefined) {
    throw new WorkApiError(body.error?.message ?? "요청을 처리하지 못했습니다.", {
      code: body.error?.code ?? null,
      status: response.status,
      retryAt: typeof body.error?.retryAt === "string" ? body.error.retryAt : null,
      details: Array.isArray(body.error?.details) ? body.error.details.filter((item): item is string => typeof item === "string") : [],
    });
  }
  return body.data;
}

let sessionPromise: Promise<WorkSession> | null = null;

export function getWorkSession({ refresh = false } = {}) {
  if (refresh || !sessionPromise) {
    const next = fetch(`${WORK_API_ROOT}/public-tools/session`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store", redirect: "manual" })
      .then((response) => readEnvelope<WorkSession>(response));
    sessionPromise = next;
    void next.catch(() => {
      if (sessionPromise === next) sessionPromise = null;
    });
  }
  return sessionPromise;
}

export async function readWork<T>(path: string, query = "", signal?: AbortSignal) {
  const response = await fetch(`${WORK_API_ROOT}${path}${query ? `?${query}` : ""}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
    cache: "no-store",
    redirect: "manual",
    signal,
  });
  return readEnvelope<T>(response);
}

export async function writeWork<T>(path: string, method: "PUT" | "POST", body: unknown) {
  let session = await getWorkSession();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!session.csrfToken) throw new WorkApiError("보안 확인 값이 없습니다.", { code: "CSRF_INVALID" });
    const response = await fetch(`${WORK_API_ROOT}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Admin-CSRF": session.csrfToken },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      body: JSON.stringify(body),
    });
    try {
      return await readEnvelope<T>(response);
    } catch (error) {
      if (!(error instanceof WorkApiError) || error.code !== "CSRF_INVALID" || attempt > 0) throw error;
      session = await getWorkSession({ refresh: true });
    }
  }
  throw new WorkApiError("요청을 처리하지 못했습니다.");
}
