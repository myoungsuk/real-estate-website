// 손님·메모 화면(단계 2)의 화면 문장·검사 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 칸 이름과 값은 worker/work-customers.mjs·work-input.mjs와 같다(상태 4가지, 이름 1 ~ 60자, 전화 8 ~ 12자리, 찾는 조건 2,000자, 메모 20,000자, 찾는 말 30자).

export const CUSTOMER_NAME_MAX = 60;
export const CUSTOMER_NEEDS_MAX = 2000;
export const NOTE_BODY_MAX = 20000;
export const CUSTOMER_QUERY_MAX = 30;
export const CUSTOMER_PAGE_SIZE = 20;
export const NOTE_PAGE_SIZE = 20;

export const CUSTOMER_STATUS_LABELS = Object.freeze({ consulting: "상담 중", contracting: "계약 진행", on_hold: "보류", completed: "거래 끝" });
// 거르기 단추·고르기 칸 순서(급한 것부터).
export const CUSTOMER_STATUS_ORDER = Object.freeze(["contracting", "consulting", "on_hold", "completed"]);
export const DEAL_TYPE_LABELS = Object.freeze({ sale: "매매", exchange: "교환", jeonse: "전세", monthly_rent: "월세" });
export const DEAL_STATUS_LABELS = Object.freeze({ open: "진행 중", contracted: "계약함", completed: "끝", cancelled: "취소" });
export const PARTY_ROLE_LABELS = Object.freeze({ buyer: "매수인", seller: "매도인", tenant: "임차인", landlord: "임대인", other: "기타" });

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const dayNumber = (date) => {
  const match = DATE_PATTERN.exec(date ?? "");
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
};

// "2026-11-20" → 올해면 "11. 20.", 다른 해면 "2025. 10. 1."
export function dateText(date, today) {
  const match = DATE_PATTERN.exec(date ?? "");
  if (!match) return "";
  const head = today && today.slice(0, 4) === match[1] ? "" : `${match[1]}. `;
  return `${head}${Number(match[2])}. ${Number(match[3])}.`;
}

// 마지막 연락이 며칠 전인지. 미래 날짜(시계 차이)는 "오늘"로 본다.
export function agoText(date, today) {
  const from = dayNumber(date);
  const to = dayNumber(today);
  if (from === null || to === null) return "";
  const days = Math.max(0, to - from);
  if (days === 0) return "오늘";
  if (days === 1) return "어제";
  if (days < 31) return `${days}일 전`;
  if (days < 365) return `${Math.floor(days / 30)}달 전`;
  return `${Math.floor(days / 365)}년 전`;
}

// 일정까지 남은 날
export function dueText(dueOn, today) {
  const due = dayNumber(dueOn);
  const now = dayNumber(today);
  if (due === null || now === null) return "";
  const days = due - now;
  if (days === 0) return "오늘";
  return days > 0 ? `${days}일 남음` : `${-days}일 지남`;
}

// 정리 안내 기준일(retention_until)이 지났는지. 지나도 지우지 않고 정리할지 묻기만 한다(설계서 8.7절).
export const isCleanupDue = (customer, today) => Boolean(customer?.retentionUntil) && customer.retentionUntil < today;

// 숫자만 받은 전화번호를 읽기 쉽게. 모르는 길이는 숫자 그대로.
export function phoneText(digits) {
  if (typeof digits !== "string" || !/^\d+$/u.test(digits)) return "";
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `02-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 9 && digits.startsWith("02")) return `02-${digits.slice(2, 5)}-${digits.slice(5)}`;
  if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return digits;
}

// 메모 시각(ISO, UTC) → 한국 시각 "11. 20. 15:10"
export function noteTimeText(iso, today) {
  const time = Date.parse(iso ?? "");
  if (!Number.isFinite(time)) return "";
  const kst = new Date(time + 9 * 3_600_000);
  const date = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
  return `${dateText(date, today)} ${String(kst.getUTCHours()).padStart(2, "0")}:${String(kst.getUTCMinutes()).padStart(2, "0")}`;
}

// 목록 요청 조건. 찾는 말은 앞뒤 빈칸을 떼고 30자까지(서버 q 상한).
/** @param {{ q?: string, status?: string, cursor?: string | null }} [options] */
export function customerListQuery({ q = "", status = "", cursor = null } = {}) {
  const query = new URLSearchParams();
  const text = cleanQuery(q);
  if (text) query.set("q", text);
  if (CUSTOMER_STATUS_ORDER.includes(status)) query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  query.set("limit", String(CUSTOMER_PAGE_SIZE));
  return query;
}

/** @param {{ q?: string, cursor?: string | null }} [options] */
export function noteListQuery({ q = "", cursor = null } = {}) {
  const query = new URLSearchParams({ inbox: "1" });
  const text = cleanQuery(q);
  if (text) query.set("q", text);
  if (cursor) query.set("cursor", cursor);
  query.set("limit", String(NOTE_PAGE_SIZE));
  return query;
}

export const cleanQuery = (value) => String(value ?? "").trim().slice(0, CUSTOMER_QUERY_MAX);

// 'n명' 줄
/** @param {number} count @param {{ more?: boolean, q?: string, status?: string }} [options] */
export function customerCountText(count, { more = false, q = "", status = "" } = {}) {
  const head = q || status ? "찾은 손님" : "손님";
  return `${head} ${count.toLocaleString("ko-KR")}명${more ? " 이상" : ""} · 최근 고친 순`;
}

// 손님 입력 검사(서버 parseCustomerCreate·Patch와 같은 범위). 칸별 오류 문장을 돌려준다.
/**
 * @typedef {"consulting" | "contracting" | "completed" | "on_hold"} CustomerStatusValue
 * @param {{ displayName?: string, phone?: string, needs?: string, status?: string }} [input]
 * @returns {{ ok: true, value: { displayName: string, phoneDigits: string | null, needs: string, status: CustomerStatusValue }, errors?: undefined }
 *   | { ok: false, errors: Record<string, string>, value?: undefined }}
 */
export function checkCustomerInput({ displayName = "", phone = "", needs = "", status = "consulting" } = {}) {
  /** @type {Record<string, string>} */
  const errors = {};
  const name = String(displayName).trim();
  if (!name) errors.displayName = "이름을 넣어 주세요. '가상 손님 1'처럼 줄여 써도 됩니다.";
  else if (name.length > CUSTOMER_NAME_MAX) errors.displayName = `이름은 ${CUSTOMER_NAME_MAX}자까지 넣을 수 있습니다.`;
  const phoneRaw = String(phone).normalize("NFKC").trim();
  const digits = phoneRaw.replace(/[\s-]/gu, "").replace(/^\+/u, "");
  if (digits && !/^\d{8,12}$/u.test(digits)) errors.phone = "전화번호는 숫자 8 ~ 12자리로 넣어 주세요(빼기 기호는 넣어도 됩니다).";
  const needsText = String(needs).trim();
  if (needsText.length > CUSTOMER_NEEDS_MAX) errors.needs = `찾는 조건은 ${CUSTOMER_NEEDS_MAX.toLocaleString("ko-KR")}자까지 넣을 수 있습니다.`;
  if (!CUSTOMER_STATUS_ORDER.includes(status)) errors.status = "상태를 골라 주세요.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { displayName: name, phoneDigits: digits || null, needs: needsText, status: /** @type {CustomerStatusValue} */ (status) } };
}

// 고치기: 바뀐 칸만 보낸다. 바뀐 것이 없으면 null.
/**
 * @param {{ displayName: string, phoneDigits: string | null, needs: string, status: string }} before
 * @param {{ displayName: string, phoneDigits: string | null, needs: string, status: CustomerStatusValue }} value
 * @returns {{ displayName?: string, phoneDigits?: string | null, needs?: string, status?: CustomerStatusValue } | null}
 */
export function customerChanges(before, value) {
  /** @type {{ displayName?: string, phoneDigits?: string | null, needs?: string, status?: CustomerStatusValue }} */
  const changes = {};
  if (value.displayName !== before.displayName) changes.displayName = value.displayName;
  if ((value.phoneDigits ?? null) !== (before.phoneDigits ?? null)) changes.phoneDigits = value.phoneDigits ?? null;
  if (value.needs !== before.needs) changes.needs = value.needs;
  if (value.status !== before.status) changes.status = value.status;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** @param {unknown} body @returns {{ ok: true, value: string, error?: undefined } | { ok: false, error: string, value?: undefined }} */
export function checkNoteBody(body) {
  const text = String(body ?? "").trim();
  if (!text) return { ok: false, error: "메모 글을 넣어 주세요." };
  if (text.length > NOTE_BODY_MAX) return { ok: false, error: `메모는 ${NOTE_BODY_MAX.toLocaleString("ko-KR")}자까지 넣을 수 있습니다.` };
  return { ok: true, value: text };
}

// 손님 지우기 결과 문장. 남긴 메모가 있으면 그 메모에 지운 손님 정보가 남아 있을 수 있음을 알린다.
// 지운 거래에 이은 장부 줄은 지우지 않고 거래 연결만 끊어 남긴다(2026-11-21 사용자 결정 "나").
export function deleteResultText(result) {
  const { deals = 0, notes = 0 } = result?.deleted ?? {};
  const kept = result?.kept?.notes ?? 0;
  const ledger = result?.kept?.ledger ?? 0;
  const parts = [`손님을 지웠습니다. 함께 지운 것: 이 손님만의 거래 ${deals}건, 메모 ${notes}개.`];
  if (kept > 0) parts.push(`다른 손님과 함께인 거래의 메모 ${kept}개는 그 거래 기록이라 남겼습니다. 그 메모 글에 지운 손님 이름·전화가 있으면 직접 고쳐 주세요.`);
  if (ledger > 0) parts.push(`장부 줄 ${ledger}개는 매출장부에 남습니다(거래 연결만 끊김). 그 줄의 물건 표시·메모에 손님 이름이 있으면 매출장부에서 고쳐 주세요.`);
  return parts.join(" ");
}

// 서버 오류 코드 → 화면 문장
export function customerErrorText(code) {
  const texts = {
    WORK_DISABLED: "손님 자료 저장이 아직 켜지지 않았습니다.",
    WORK_CONFIG_MISSING: "업무 도구 설정이 끝나지 않았습니다. 개발 담당에게 '업무 도구 설정 누락'이라고 알려 주세요.",
    WORK_SCHEMA_OUTDATED: "업무 자료 구조가 아직 준비되지 않았습니다. 개발 담당에게 알려 주세요.",
    WORK_SCHEMA_AHEAD: "업무 자료 구조가 프로그램보다 새것입니다. 잠시 뒤 새로고침해 주세요.",
    STORAGE_UNAVAILABLE: "업무 자료 저장소에 연결하지 못했습니다. 잠시 뒤 다시 해 주세요. 넣던 글은 지워지지 않았습니다.",
    VALIDATION_FAILED: "넣은 값의 형식이 맞지 않습니다. 칸을 다시 확인해 주세요.",
    NOT_FOUND: "찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다.",
    VERSION_CONFLICT: "다른 화면에서 먼저 고쳐서 이번 변경은 저장하지 않았습니다. '다시 불러오기'로 새 내용을 본 뒤 다시 고쳐 주세요.",
    CONFIRMATION_MISMATCH: "넣은 이름이 손님 이름과 다릅니다. 띄어쓰기까지 똑같이 넣어 주세요.",
    FILES_REQUIRE_STORAGE: "이 손님에게 연결된 파일이 있어, 파일 저장소가 켜진 뒤에 지울 수 있습니다.",
    CSRF_INVALID: "보안 확인이 만료되었습니다. 화면을 새로고침한 뒤 다시 해 주세요.",
    ORIGIN_DENIED: "허용되지 않은 주소에서 저장하려고 했습니다. 운영 주소에서 다시 해 주세요.",
    AUTH_REQUIRED: "관리자 로그인이 만료되었습니다. 화면을 새로고침해 다시 로그인해 주세요.",
  };
  return texts[code] ?? "요청을 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.";
}

// 다시 해 볼 만한 오류인지(다시 불러오기 단추를 보일지)
export const isRetryable = (code) => !["AUTH_REQUIRED", "WORK_DISABLED", "WORK_CONFIG_MISSING", "WORK_SCHEMA_OUTDATED", "NOT_FOUND"].includes(code ?? "");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
// 손님 카드 주소의 ?id=. 무작위 UUID만 받는다(이름·전화는 주소에 넣지 않음).
export function customerIdFromSearch(search) {
  const id = new URLSearchParams(search ?? "").get("id") ?? "";
  return UUID_PATTERN.test(id) ? id : null;
}
export const customerHref = (id) => `/admin/work/customers/detail/?id=${encodeURIComponent(id)}`;
