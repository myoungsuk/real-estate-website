// 단계 P 실거래가: 공공데이터포털(국토교통부 아파트 실거래가 API 4개)에서 한 달치 받기(설계서 22.4·22.7절).
// - 요청 주소는 아래 4개 상수만 쓴다. 그 밖의 주소는 이 파일로 만들 수 없다(TK-32).
// - 요청 1번 15초, 자동 재시도 없음(다음 Cron이 다시 받는다). 쪽 하나라도 실패하면 그 달 전체가 실패다.
// - 인증키는 요청 주소에 들어가므로 결과 객체·오류에는 요청 주소·응답 본문·error.message를 담지 않는다.
//   실패 결과는 { ok: false, code, httpStatus, calls }뿐이다(TK-31).
// - Cron(worker/work-scheduled.mjs)이 부른다. D1 반영은 worker/realprice-store.mjs다(P1-b).

import { parseRealpriceXml, readRealpriceBody, RealpriceResponseError } from "./realprice-parse.mjs";

const API_BASE = "https://apis.data.go.kr/1613000/";

// 설계서 22.4절 표 그대로. kind는 rt_trades.kind 값(매매 일반은 저장하지 않고 건수만 대조하므로 kind가 없다).
export const REALPRICE_APIS = Object.freeze({
  sale: Object.freeze({ dataId: "15126468", kind: "sale", url: `${API_BASE}RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev` }),
  saleBasic: Object.freeze({ dataId: "15126469", kind: null, url: `${API_BASE}RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade` }),
  rent: Object.freeze({ dataId: "15126474", kind: "rent", url: `${API_BASE}RTMSDataSvcAptRent/getRTMSDataSvcAptRent` }),
  presale: Object.freeze({ dataId: "15126471", kind: "presale", url: `${API_BASE}RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade` }),
});
export const REALPRICE_ENDPOINTS = Object.freeze(Object.values(REALPRICE_APIS).map((api) => api.url));

export const REALPRICE_LAWD_CD = "30110"; // 대전 동구(공개 법정동 코드)
export const REALPRICE_PAGE_SIZE = 1000;
export const REALPRICE_REQUEST_TIMEOUT_MS = 15_000;
// 한 달 받기의 쪽 수 상한(설계 선택). numOfRows가 공공데이터포털에서 1,000보다 작게 막혀 있어도 다 받도록 넉넉히 두되,
// 응답이 이상해 쪽 번호를 끝없이 늘리는 일은 막는다. 넘으면 RT_COUNT_MISMATCH다.
export const REALPRICE_MAX_PAGES = 30;

export const RT_UPSTREAM_FAILED = "RT_UPSTREAM_FAILED";
export const RT_RESPONSE_INVALID = "RT_RESPONSE_INVALID";
export const RT_COUNT_MISMATCH = "RT_COUNT_MISMATCH";
export const RT_REQUEST_INVALID = "RT_REQUEST_INVALID";
export const RT_SERVICE_GONE = "RT_SERVICE_GONE";
export const RT_ACCESS_DENIED = "RT_ACCESS_DENIED";
export const RT_KEY_INVALID = "RT_KEY_INVALID";
export const RT_KEY_EXPIRED = "RT_KEY_EXPIRED";
export const RT_DAILY_LIMIT = "RT_DAILY_LIMIT";

// 공공데이터포털 결과·오류 코드(두 자리로 맞춘 값) → 바꾼 코드(설계서 22.4절 표, 2026-11-19 D-6으로 29 보탬).
// "00"은 정상, "03"은 자료 없음(정상 0건). 표에 없는 코드는 RT_UPSTREAM_FAILED.
const RESULT_CODE_TABLE = Object.freeze({
  "01": RT_UPSTREAM_FAILED,
  "02": RT_UPSTREAM_FAILED,
  "04": RT_UPSTREAM_FAILED,
  "05": RT_UPSTREAM_FAILED,
  "99": RT_UPSTREAM_FAILED,
  "23": RT_UPSTREAM_FAILED,
  "10": RT_REQUEST_INVALID,
  "11": RT_REQUEST_INVALID,
  "12": RT_SERVICE_GONE,
  "20": RT_ACCESS_DENIED,
  "21": RT_KEY_INVALID,
  "29": RT_KEY_INVALID,
  "30": RT_KEY_INVALID,
  "32": RT_KEY_INVALID,
  "33": RT_KEY_INVALID,
  "22": RT_DAILY_LIMIT,
  "31": RT_KEY_EXPIRED,
});

// 결과 코드를 두 자리로 맞춘다. 새 형식 "000"과 옛 형식 "00"은 같은 "00"이다(TK-18).
// 세 자리 오류 코드("022" 등)가 올 수 있는지는 확인하지 못해 앞의 0을 지워 같은 표로 읽는다(**추정**).
export function normalizeResultCode(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!/^\d{1,3}$/u.test(value)) return null;
  return String(Number(value)).padStart(2, "0");
}

// 결과 코드 하나를 { outcome: "ok" | "empty" | "error", code? }로 바꾼다.
export function classifyResultCode(raw) {
  const normalized = normalizeResultCode(raw);
  if (normalized === "00") return { outcome: "ok" };
  if (normalized === "03") return { outcome: "empty" };
  return { outcome: "error", code: (normalized && RESULT_CODE_TABLE[normalized]) || RT_UPSTREAM_FAILED };
}

// HTTP 상태(200 밖) → 바꾼 코드(설계서 22.4절 표, D-6으로 "그 밖의 4xx" 보탬).
export function classifyHttpStatus(status) {
  if (status === 401 || status === 403) return RT_KEY_INVALID;
  if (status === 429) return RT_DAILY_LIMIT;
  if (status >= 400 && status < 500) return RT_REQUEST_INVALID;
  return RT_UPSTREAM_FAILED; // 5xx, 3xx(주소 이동은 따라가지 않음), 그 밖
}

// 오류 뒤 다음 차례(설계서 22.4·22.7절). 적용(rt_fetch_months.next_due_at 고치기)은 P1-b다.
// scope: "month"(그 달만) | "kind"(그 종류 모든 달) | "all"(모든 종류). warning: 갱신 상태 warnings[]에 보일 것.
export const REALPRICE_RETRY_POLICY = Object.freeze({
  [RT_UPSTREAM_FAILED]: Object.freeze({ scope: "month", delayMinutes: 30, warning: false }),
  [RT_RESPONSE_INVALID]: Object.freeze({ scope: "month", delayMinutes: 30, warning: false }),
  [RT_COUNT_MISMATCH]: Object.freeze({ scope: "month", delayMinutes: 30, warning: false }),
  [RT_REQUEST_INVALID]: Object.freeze({ scope: "kind", delayMinutes: 6 * 60, warning: true }),
  [RT_SERVICE_GONE]: Object.freeze({ scope: "kind", delayMinutes: 24 * 60, warning: true }),
  [RT_ACCESS_DENIED]: Object.freeze({ scope: "kind", delayMinutes: 60, warning: true }),
  [RT_KEY_INVALID]: Object.freeze({ scope: "all", delayMinutes: 60, warning: false }),
  [RT_KEY_EXPIRED]: Object.freeze({ scope: "all", delayMinutes: 60, warning: false }),
  [RT_DAILY_LIMIT]: Object.freeze({ scope: "all", nextKstTime: "00:10", warning: false }),
});

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 한국 시각 기준 "다음 날 HH:MM"의 UTC 시각.
export function nextKstDayAt(now, hhmm) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const target = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1, hours, minutes);
  return new Date(target - KST_OFFSET_MS);
}

// 오류 코드 → { code, scope, retryAt(ISO), warning }. 표에 없는 코드는 RT_UPSTREAM_FAILED와 같게(그 달만 30분 뒤).
export function planRealpriceRetry(code, now = new Date()) {
  const policy = REALPRICE_RETRY_POLICY[code] ?? REALPRICE_RETRY_POLICY[RT_UPSTREAM_FAILED];
  const retryAt = policy.nextKstTime
    ? nextKstDayAt(now, policy.nextKstTime)
    : new Date(now.getTime() + policy.delayMinutes * 60 * 1000);
  return { code, scope: policy.scope, retryAt: retryAt.toISOString(), warning: policy.warning };
}

function assertDealYmd(dealYmd) {
  const match = typeof dealYmd === "string" ? /^(\d{4})(\d{2})$/u.exec(dealYmd) : null;
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) throw new TypeError("realprice: 계약 연월은 YYYYMM 형식이어야 합니다.");
}

function apiOf(name) {
  if (typeof name !== "string" || !Object.hasOwn(REALPRICE_APIS, name)) throw new TypeError("realprice: 허용하지 않은 API 종류입니다.");
  return REALPRICE_APIS[name];
}

// 요청 주소를 만든다. Decoding 키를 넣어야 URLSearchParams가 한 번만 인코딩한다.
// 오류 메시지에는 키를 넣지 않는다.
export function buildRealpriceRequestUrl({ api, serviceKey, dealYmd, pageNo = 1, numOfRows = REALPRICE_PAGE_SIZE }) {
  const { url } = apiOf(api);
  if (typeof serviceKey !== "string" || serviceKey.trim() === "") throw new TypeError("realprice: 인증키가 없습니다.");
  assertDealYmd(dealYmd);
  if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 9999) throw new TypeError("realprice: 쪽 번호가 올바르지 않습니다.");
  if (!Number.isInteger(numOfRows) || numOfRows < 1 || numOfRows > 9999) throw new TypeError("realprice: 쪽 크기가 올바르지 않습니다.");
  const params = new URLSearchParams({
    serviceKey,
    LAWD_CD: REALPRICE_LAWD_CD,
    DEAL_YMD: dealYmd,
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
  });
  return `${url}?${params.toString()}`;
}

async function discardBody(response) {
  try {
    await response.body?.cancel();
  } catch {
    // 버리는 본문이라 오류는 무시한다.
  }
}

// 한 쪽 받기. { page } 또는 { failure: { code, httpStatus } }. 던지지 않는다.
async function fetchPage(fetcher, requestUrl, timeoutMs) {
  let response;
  try {
    response = await fetcher(requestUrl, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "application/xml" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // 연결 실패·15초 초과. 오류 메시지에는 요청 주소가 들어 있을 수 있어 읽지 않는다.
    return { failure: { code: RT_UPSTREAM_FAILED, httpStatus: null } };
  }
  const httpStatus = Number.isInteger(response?.status) ? response.status : null;
  if (httpStatus === null || httpStatus < 200 || httpStatus > 299) {
    if (response) await discardBody(response);
    return { failure: { code: httpStatus === null ? RT_UPSTREAM_FAILED : classifyHttpStatus(httpStatus), httpStatus } };
  }
  let text;
  try {
    text = await readRealpriceBody(response);
  } catch (error) {
    // 5MB 초과·UTF-8 아님은 형식 오류, 읽는 도중 끊김·시간 초과는 상대 쪽 실패로 본다.
    return { failure: { code: error instanceof RealpriceResponseError ? RT_RESPONSE_INVALID : RT_UPSTREAM_FAILED, httpStatus } };
  }
  try {
    return { page: parseRealpriceXml(text), httpStatus };
  } catch {
    return { failure: { code: RT_RESPONSE_INVALID, httpStatus } };
  }
}

// 읽은 쪽을 { outcome: "ok", totalCount, items } | { outcome: "empty" } | { outcome: "error", code }로 정리한다.
function interpretPage(page) {
  if (page.envelope === "service-error") {
    const result = classifyResultCode(page.reasonCode);
    // 오류 봉투 안에 정상 코드가 오는 일은 설명할 수 없으므로 형식 오류로 본다.
    if (result.outcome === "ok") return { outcome: "error", code: RT_RESPONSE_INVALID };
    return result;
  }
  const result = classifyResultCode(page.resultCode);
  if (result.outcome === "error") return result;
  if (result.outcome === "empty") {
    if (page.items && page.items.length > 0) return { outcome: "error", code: RT_RESPONSE_INVALID };
    return { outcome: "empty" };
  }
  if (page.items === null || page.totalCount === null) return { outcome: "error", code: RT_RESPONSE_INVALID };
  return { outcome: "ok", totalCount: page.totalCount, items: page.items };
}

const failed = (code, httpStatus, calls) => ({ ok: false, code, httpStatus, calls });

// 한 달치를 모두 받는다.
// 성공: { ok: true, api, dealYmd, totalCount, items: [{ 칸 이름: 값|null }], calls }
// 실패: { ok: false, code, httpStatus, calls } — 쪽 하나라도 실패하거나 모은 수가 totalCount와 다르면 실패.
export async function fetchRealpriceMonth({
  api,
  dealYmd,
  serviceKey,
  fetcher = fetch,
  numOfRows = REALPRICE_PAGE_SIZE,
  timeoutMs = REALPRICE_REQUEST_TIMEOUT_MS,
  maxPages = REALPRICE_MAX_PAGES,
}) {
  // 입력 검사를 요청 전에 끝낸다(잘못된 값이면 바깥 요청 없이 던짐).
  buildRealpriceRequestUrl({ api, serviceKey, dealYmd, pageNo: 1, numOfRows });
  let calls = 0;
  let totalCount = null;
  const items = [];
  let firstItems = null;
  let firstItemsText = null;
  for (let pageNo = 1; pageNo <= maxPages; pageNo += 1) {
    const requestUrl = buildRealpriceRequestUrl({ api, serviceKey, dealYmd, pageNo, numOfRows });
    calls += 1;
    const fetched = await fetchPage(fetcher, requestUrl, timeoutMs);
    if (fetched.failure) return failed(fetched.failure.code, fetched.failure.httpStatus, calls);
    const page = interpretPage(fetched.page);
    if (page.outcome === "error") return failed(page.code, fetched.httpStatus, calls);
    // 쪽 번호를 지키지 않는 응답(다른 쪽을 돌려줌, 1쪽을 다시 줌)은 건수가 맞아도 같은 거래가 두 번 들어가므로 버린다(2026-11-19 B-1).
    // 응답에 pageNo가 없으면 이 대조는 건너뛰고 아래 "1쪽과 똑같은 쪽" 대조만 한다.
    if (page.outcome === "ok" && fetched.page.pageNo !== null && fetched.page.pageNo !== pageNo) {
      return failed(RT_RESPONSE_INVALID, fetched.httpStatus, calls);
    }
    if (pageNo === 1) {
      if (page.outcome === "empty") return { ok: true, api, dealYmd, totalCount: 0, items: [], calls };
      totalCount = page.totalCount;
      firstItems = page.items;
      // 요청한 쪽 크기로도 상한 안에 다 받을 수 없으면 더 부르지 않는다.
      if (totalCount > numOfRows * maxPages) return failed(RT_COUNT_MISMATCH, fetched.httpStatus, calls);
    } else if (page.outcome === "ok" && page.totalCount !== totalCount) {
      // 받는 도중 건수가 바뀌면 덜 받거나 겹쳐 받을 수 있다.
      return failed(RT_COUNT_MISMATCH, fetched.httpStatus, calls);
    } else if (page.outcome === "ok" && page.items.length > 0 && page.items.length === firstItems.length) {
      // 2쪽 이상이 1쪽과 똑같으면 쪽 번호를 무시하고 1쪽을 다시 준 것으로 본다(B-1).
      firstItemsText ??= JSON.stringify(firstItems);
      if (JSON.stringify(page.items) === firstItemsText) return failed(RT_RESPONSE_INVALID, fetched.httpStatus, calls);
    }
    // 빈 쪽이면 더 받아도 늘지 않으므로 멈추고 건수를 대조한다.
    if (page.outcome === "empty" || page.items.length === 0) break;
    items.push(...page.items);
    if (items.length >= totalCount) break;
  }
  if (items.length !== totalCount) return failed(RT_COUNT_MISMATCH, null, calls);
  return { ok: true, api, dealYmd, totalCount, items, calls };
}

// 건수만 받는다(매일 03시 매매 일반 API 건수 대조, 설계서 22.7절 DEC-WT-32). numOfRows=1로 1번 부른다.
// 성공: { ok: true, api, dealYmd, totalCount, calls: 1 } / 실패: { ok: false, code, httpStatus, calls: 1 }
export async function fetchRealpriceTotalCount({ api, dealYmd, serviceKey, fetcher = fetch, timeoutMs = REALPRICE_REQUEST_TIMEOUT_MS }) {
  const requestUrl = buildRealpriceRequestUrl({ api, serviceKey, dealYmd, pageNo: 1, numOfRows: 1 });
  const fetched = await fetchPage(fetcher, requestUrl, timeoutMs);
  if (fetched.failure) return failed(fetched.failure.code, fetched.failure.httpStatus, 1);
  const page = interpretPage(fetched.page);
  if (page.outcome === "error") return failed(page.code, fetched.httpStatus, 1);
  return { ok: true, api, dealYmd, totalCount: page.outcome === "empty" ? 0 : page.totalCount, calls: 1 };
}
