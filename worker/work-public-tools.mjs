// 업무 도구 단계 P(공개 자료 도구) API. work-api.mjs의 handleWorkApi()가 단계 2 켜기 값 확인 **전에** 이 파일로 넘긴다(설계서 22.2절).
// - 경로: /work/public-tools/session, /work/realprice/*(status·refresh·trades·insights·complexes·watch), /work/blog/*(sources·drafts·limits, P3 글 초안, 처리는 work-blog.mjs).
// - 순서: 단계 P 켜기 값 → 구조 번호 → (쓰기) Origin·CSRF → 입력 → 처리 → 감사(쓰기인 realprice.refresh·realprice.watch.update, blog.create·confirm·cancel·settings.update).
// - 꺼진 기능의 거부는 D1에 쓰지 않고 Worker 로그에 HMAC 작업자 ID만 남긴다(단계 2와 같음).
// - work-api.mjs와 서로 import한다. 서로의 내보내기는 요청을 처리할 때만 쓰므로(모듈을 읽을 때 쓰지 않음) 순환 import가 문제되지 않는다.
import { parseAdminAllowedOrigins } from "./admin-security.mjs";
import { maskEmail } from "./admin-audit.mjs";
import { jsonResponse } from "./http.mjs";
import { REALPRICE_RETRY_POLICY } from "./realprice-fetch.mjs";
import { listRealpriceTrades, readRealpriceWatch, saveRealpriceWatch, searchRealpriceComplexes } from "./realprice-query.mjs";
import { readRealpriceInsights } from "./realprice-insights.mjs";
import { readRealpriceStatus, refreshStatements } from "./realprice-store.mjs";
import { WorkApiError, createWorkCsrfToken, hasD1, validateWorkJsonWrite } from "./work-security.mjs";
import { writeBatchWithAudit } from "./work-audit.mjs";
import { hasOpenAiConfig } from "./work-ai-config.mjs";
import { routeBlog } from "./work-blog.mjs";
import { WORK_SCHEMA_VERSION, readSchemaVersion, readWorkJsonBody, recordDenied, workError, workSuccess } from "./work-api.mjs";

const REALPRICE_KEY_MIN_LENGTH = 20;
const WRITE_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const matches = (route, prefix) => route === prefix || route.startsWith(`${prefix}/`);

// 단계 P 경로인지(`/realpricex`·`/blogs` 같은 경로는 단계 2 쪽으로 남는다).
export function isPublicToolsRoute(route) {
  return matches(route, "/public-tools") || matches(route, "/realprice") || matches(route, "/blog");
}

// 실거래가 켜기 값과 설정(22.2절 의사 코드). 값 자체는 돌려주지 않는다.
export function getRealpriceConfigState(env, db = env?.WORK_DB) {
  if (env?.WORK_REALPRICE_ENABLED !== "true") return "disabled";
  if (!hasD1(db) || typeof env?.ADMIN_CSRF_SECRET !== "string" || env.ADMIN_CSRF_SECRET.length < 32) return "config_missing";
  try {
    parseAdminAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS);
  } catch {
    return "config_missing";
  }
  if (typeof env.MOLIT_RT_SERVICE_KEY !== "string" || env.MOLIT_RT_SERVICE_KEY.trim().length < REALPRICE_KEY_MIN_LENGTH) return "config_missing";
  return "enabled";
}

// 글 초안 켜기 값과 설정(22.2절 의사 코드). OpenAI 키·모델·추론 수준·출력 상한·단가표(14.2절)가 하나라도 빠지면 config_missing.
export function getBlogConfigState(env, db = env?.WORK_DB) {
  if (env?.WORK_BLOG_ENABLED !== "true") return "disabled";
  if (!hasD1(db) || typeof env?.ADMIN_CSRF_SECRET !== "string" || env.ADMIN_CSRF_SECRET.length < 32) return "config_missing";
  try {
    parseAdminAllowedOrigins(env.ADMIN_ALLOWED_ORIGINS);
  } catch {
    return "config_missing";
  }
  return hasOpenAiConfig(env, "blog") ? "enabled" : "config_missing";
}

const disabledError = () => new WorkApiError("REALPRICE_DISABLED", "실거래가 도구가 아직 켜지지 않았습니다.", 503);
const configMissingError = () => new WorkApiError("REALPRICE_CONFIG_MISSING", "실거래가 도구 설정이 완료되지 않았습니다.", 503);
const blogConfigMissingError = () => new WorkApiError("BLOG_CONFIG_MISSING", "글 초안 도구 설정이 완료되지 않았습니다.", 503);
const methodNotAllowed = (allow) => Object.assign(new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { allow });
const notFound = () => new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);

// 하루 읽기 끝 상한(429 RT_READ_BUDGET): 공통 오류 봉투에 retryAt(다음 한국 시각 09:00)을 더하고 Retry-After 머리줄을 단다(22.9절).
function readBudgetResponse(requestId, error, now) {
  const seconds = Math.max(1, Math.ceil((Date.parse(error.retryAt) - now) / 1000));
  return jsonResponse(
    { ok: false, error: { code: error.code, message: error.message, retryable: true, retryAt: error.retryAt }, requestId },
    { status: 429, headers: { "X-Request-Id": requestId, "Retry-After": String(seconds) } },
  );
}

// 구조 번호 확인(8.4절과 같은 규칙). 맞으면 null, 아니면 오류 응답.
async function checkSchema(context) {
  const { db, actor, env, request, requestId, now, auditLog } = context;
  let schemaVersion;
  try {
    schemaVersion = await readSchemaVersion(db);
  } catch {
    return { response: workError(requestId, new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료 저장소에 연결하지 못했습니다.", 503, true)) };
  }
  if (schemaVersion === null || schemaVersion < WORK_SCHEMA_VERSION) {
    await recordDenied(db, actor, env, request, requestId, now, "WORK_SCHEMA_OUTDATED", auditLog);
    return { response: workError(requestId, new WorkApiError("WORK_SCHEMA_OUTDATED", "업무 자료 구조가 아직 준비되지 않았습니다.", 503)) };
  }
  if (schemaVersion > WORK_SCHEMA_VERSION) {
    await recordDenied(db, actor, env, request, requestId, now, "WORK_SCHEMA_AHEAD", auditLog);
    return { response: workError(requestId, new WorkApiError("WORK_SCHEMA_AHEAD", "업무 자료 구조가 프로그램보다 새것입니다.", 503)) };
  }
  return { schemaVersion };
}

async function handleSession(context) {
  const { env, db, actor, requestId, now, method } = context;
  if (method !== "GET") return workError(requestId, methodNotAllowed("GET"), { Allow: "GET" });
  const realprice = getRealpriceConfigState(env, db);
  if (realprice === "config_missing") return workError(requestId, configMissingError());
  const blog = getBlogConfigState(env, db);
  if (blog === "config_missing") return workError(requestId, blogConfigMissingError());
  // 둘 다 꺼져 있으면 D1을 읽지 않는다. 하나라도 켜져 있으면 같은 업무 CSRF 토큰을 준다(22.2절).
  if (realprice === "disabled" && blog === "disabled") {
    return workSuccess({ realpriceEnabled: false, blogEnabled: false, administrator: maskEmail(actor.email), csrfToken: null, schemaVersion: null }, requestId);
  }
  const schema = await checkSchema(context);
  if (schema.response) return schema.response;
  return workSuccess({
    realpriceEnabled: realprice === "enabled",
    blogEnabled: blog === "enabled",
    administrator: maskEmail(actor.email),
    csrfToken: await createWorkCsrfToken(actor.email, env.ADMIN_CSRF_SECRET, now),
    schemaVersion: schema.schemaVersion,
  }, requestId);
}

async function handleRealprice(context) {
  const { env, db, actor, request, requestId, now, method, route, auditLog } = context;
  const state = getRealpriceConfigState(env, db);
  if (state === "config_missing") return workError(requestId, configMissingError());
  if (state === "disabled") {
    await recordDenied(db, actor, env, request, requestId, now, "REALPRICE_DISABLED", auditLog, { storeInD1: false });
    return workError(requestId, disabledError());
  }
  const schema = await checkSchema(context);
  if (schema.response) return schema.response;

  let body = null;
  if (WRITE_METHODS.has(method)) {
    try {
      await validateWorkJsonWrite(request, actor, env, now);
    } catch (error) {
      if (error instanceof WorkApiError) {
        if (error.code === "ORIGIN_DENIED" || error.code === "CSRF_INVALID") {
          await recordDenied(db, actor, env, request, requestId, now, error.code, auditLog);
        }
        return workError(requestId, error);
      }
      return workError(requestId, configMissingError());
    }
    try {
      body = await readWorkJsonBody(request);
    } catch (error) {
      return workError(requestId, error);
    }
  } else if (method !== "GET") {
    return workError(requestId, methodNotAllowed("GET"), { Allow: "GET" });
  }

  try {
    if (route === "/realprice/status") {
      if (method !== "GET") throw methodNotAllowed("GET");
      // 보기 요청은 감사·사용량을 쓰지 않는다(22.12절). 한 번에 1천 행 안팎만 읽어 읽기 끝 상한을 넘은 날에도 200이다(22.7절).
      return workSuccess(await readRealpriceStatus(db, { nowMs: now, retryPolicy: REALPRICE_RETRY_POLICY }), requestId);
    }
    if (route === "/realprice/refresh") {
      if (method !== "POST") throw methodNotAllowed("POST");
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length > 0) {
        throw new WorkApiError("VALIDATION_FAILED", "요청 형식이 올바르지 않습니다.", 400);
      }
      // 외부 요청은 보내지 않는다. 최근 4개월 3종류의 다음 차례를 지금으로 바꾸고 감사 기록을 같은 batch에 넣는다.
      const refresh = refreshStatements(db, now);
      await writeBatchWithAudit(db, refresh.statements, {
        at: new Date(now).toISOString(),
        actorEmail: actor.email,
        action: "realprice.refresh",
        requestId,
        reason: `queued_months=${refresh.queuedMonths}`,
      });
      return workSuccess({ queuedMonths: refresh.queuedMonths, estimatedMinutes: refresh.estimatedMinutes }, requestId);
    }
    // 목록·단지 찾기는 읽은 행 수를 rt_daily_usage에 더하고, 하루 읽기 끝 상한을 넘으면 429로 거절한다(22.7절). 감사는 쓰지 않는다.
    if (route === "/realprice/trades") {
      if (method !== "GET") throw methodNotAllowed("GET");
      return workSuccess(await listRealpriceTrades(db, new URL(request.url).searchParams, { nowMs: now }), requestId);
    }
    if (route === "/realprice/insights") {
      if (method !== "GET") throw methodNotAllowed("GET");
      return workSuccess(await readRealpriceInsights(db, new URL(request.url).searchParams, { nowMs: now }), requestId);
    }
    if (route === "/realprice/complexes") {
      if (method !== "GET") throw methodNotAllowed("GET");
      return workSuccess(await searchRealpriceComplexes(db, new URL(request.url).searchParams, { nowMs: now }), requestId);
    }
    if (route === "/realprice/watch") {
      // 보기는 20행 이하만 읽어 사용량에 더하지 않고 끝 상한 날에도 200이다. 저장은 version guard와 감사를 같은 batch에 넣는다.
      if (method === "GET") return workSuccess(await readRealpriceWatch(db), requestId);
      if (method !== "PUT") throw methodNotAllowed("GET, PUT");
      return workSuccess(await saveRealpriceWatch(db, body, { nowMs: now, actorEmail: actor.email, requestId }), requestId);
    }
    throw notFound();
  } catch (error) {
    if (error instanceof WorkApiError) {
      if (error.code === "RT_READ_BUDGET" && error.retryAt) return readBudgetResponse(requestId, error, now);
      return workError(requestId, error, error.status === 405 ? { Allow: error.allow ?? "GET" } : {});
    }
    return workError(requestId, new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료를 처리하지 못했습니다.", 503, true));
  }
}

// 글 초안(P3). 실거래가 켜기 값과 따로 켠다(WORK_BLOG_ENABLED). 순서는 실거래가와 같다.
async function handleBlog(context) {
  const { env, db, actor, request, requestId, now, method, auditLog } = context;
  const state = getBlogConfigState(env, db);
  if (state === "config_missing") return workError(requestId, blogConfigMissingError());
  if (state === "disabled") {
    await recordDenied(db, actor, env, request, requestId, now, "BLOG_DISABLED", auditLog, { storeInD1: false });
    return workError(requestId, new WorkApiError("BLOG_DISABLED", "글 초안 도구가 아직 켜지지 않았습니다.", 503));
  }
  const schema = await checkSchema(context);
  if (schema.response) return schema.response;

  let body = null;
  if (WRITE_METHODS.has(method)) {
    try {
      await validateWorkJsonWrite(request, actor, env, now);
    } catch (error) {
      if (error instanceof WorkApiError) {
        if (error.code === "ORIGIN_DENIED" || error.code === "CSRF_INVALID") {
          await recordDenied(db, actor, env, request, requestId, now, error.code, auditLog);
        }
        return workError(requestId, error);
      }
      return workError(requestId, blogConfigMissingError());
    }
    try {
      body = await readWorkJsonBody(request);
    } catch (error) {
      return workError(requestId, error);
    }
  } else if (method !== "GET") {
    return workError(requestId, methodNotAllowed("GET"), { Allow: "GET" });
  }

  try {
    const handled = await routeBlog({ ...context, url: new URL(request.url), body });
    return jsonResponse({ ok: true, data: handled.data, requestId }, { status: handled.status ?? 200, headers: { "X-Request-Id": requestId } });
  } catch (error) {
    if (error instanceof WorkApiError) return workError(requestId, error, error.status === 405 ? { Allow: error.allow ?? "GET" } : {});
    try {
      auditLog({ event: "work_request_failed", requestId, status: 503, code: "STORAGE_UNAVAILABLE", errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error" });
    } catch {
      // Worker 로그 장애는 무시한다.
    }
    return workError(requestId, new WorkApiError("STORAGE_UNAVAILABLE", "업무 자료를 처리하지 못했습니다.", 503, true));
  }
}

// context: { db, actor, requestId, now, auditLog, method, route, randomUUID, openaiFetch }
export async function handlePublicToolsApi(request, env, context) {
  const full = { ...context, request, env };
  const { route, requestId } = full;
  if (route === "/public-tools/session") return handleSession(full);
  if (matches(route, "/public-tools")) return workError(requestId, notFound());
  if (matches(route, "/blog")) return handleBlog(full);
  return handleRealprice(full);
}
