// 업무 도구 API 입력 검사·정규화(순수 함수). 오류 메시지는 고정 문구만 쓰고 입력값을 담지 않는다(설계서 10.1절).
import { WorkApiError } from "./work-security.mjs";

export const CUSTOMER_STATUSES = Object.freeze(["consulting", "contracting", "completed", "on_hold"]);
export const LIST_LIMIT_DEFAULT = 20;
export const LIST_LIMIT_MAX = 50;
export const SEARCH_MIN = 1;
export const SEARCH_MAX = 30;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ISO_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_CURSOR_LENGTH = 200;
// 주민등록번호 형태(설계서 11.2절). NFKC로 맞춘 글에서 찾는다(전각 숫자·전각 하이픈). 구분자는 하이픈·대시류·점 하나와
// 그 앞뒤 공백, 앞뒤가 숫자면 보지 않는다(띄어 쓴 금액 두 개를 잘못 가리지 않게). 13자리 계좌번호처럼 비슷한 숫자도 가려질 수 있지만
// 개인정보 쪽으로 보수적으로 둔다.
const RRN_PATTERN = /(?<!\d)\d{6}\s*[-.\u2010-\u2015\u2212]?\s*[1-8]\d{6}(?!\d)/gu;
const RRN_MASK = "******-*******";

export function invalid(fields) {
  return new WorkApiError("VALIDATION_FAILED", "입력 형식이 올바르지 않습니다.", 400, false, fields);
}

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

// 전각·작은 꼴 글자(전각 숫자·전각 하이픈·전각 공백 등)만 NFKC로 바꿔 찾을 글을 만들고, 찾은 자리를 원래 글의 자리로 되돌려
// 그 부분만 바꾼다. 글 전체를 NFKC로 저장하지 않는다(㎡ → m2, ① → 1, 한글 자모 ㅋ → 조합용 자모처럼 사람이 친 글이 바뀌므로).
// ①·²처럼 NFKC로 숫자가 되는 다른 글자는 숫자로 보지 않는다(그런 글자가 붙어 있어도 앞뒤 숫자 경계 때문에 가림이 빠지지 않게).
const WIDTH_VARIANT = /[\u3000\uFE50-\uFE6F\uFF01-\uFF5E]/u;

export function maskResidentNumbers(text) {
  let normalized = "";
  const starts = [];
  const ends = [];
  let offset = 0;
  for (const char of text) {
    const piece = WIDTH_VARIANT.test(char) ? char.normalize("NFKC") : char;
    for (let index = 0; index < piece.length; index += 1) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    normalized += piece;
    offset += char.length;
  }
  let masked = "";
  let cursor = 0;
  let count = 0;
  for (const match of normalized.matchAll(RRN_PATTERN)) {
    const start = Math.max(starts[match.index], cursor);
    masked += text.slice(cursor, start) + RRN_MASK;
    cursor = ends[match.index + match[0].length - 1];
    count += 1;
  }
  if (count === 0) return { text, count: 0 };
  return { text: masked + text.slice(cursor), count };
}

// 가린 뒤 길이를 다시 본다(구분자 없는 13자리를 14자 가림 문자로 바꾸면 한 글자 늘어 0001의 길이 제약을 넘을 수 있음).
function maskField(value, key, max) {
  const masked = maskResidentNumbers(value);
  if (masked.text.length > max) throw invalid([key]);
  return masked;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw invalid(unknown.slice(0, 5));
}

function readText(body, key, { min, max, required }) {
  if (!(key in body) || body[key] === undefined) {
    if (required) throw invalid([key]);
    return undefined;
  }
  if (typeof body[key] !== "string") throw invalid([key]);
  const value = body[key].trim();
  if (value.length < min || value.length > max) throw invalid([key]);
  return value;
}

// 전화번호: NFKC 뒤 공백·하이픈을 빼고 맨 앞 +는 떼어 숫자 8 ~ 12자리만 받는다(대표번호 8, 국내 9 ~ 11, 82 포함 12).
// 13자리처럼 주민번호 모양의 숫자가 전화번호 칸으로 들어오지 않게 막는다(400).
function readPhone(body) {
  if (!("phoneDigits" in body) || body.phoneDigits === undefined) return undefined;
  if (body.phoneDigits === null || body.phoneDigits === "") return null;
  if (typeof body.phoneDigits !== "string") throw invalid(["phoneDigits"]);
  const digits = body.phoneDigits.normalize("NFKC").replace(/[\s-]/gu, "").replace(/^\+/u, "");
  if (!/^\d{8,12}$/u.test(digits)) throw invalid(["phoneDigits"]);
  return digits;
}

function readStatus(body) {
  if (!("status" in body) || body.status === undefined) return undefined;
  if (!CUSTOMER_STATUSES.includes(body.status)) throw invalid(["status"]);
  return body.status;
}

function readVersion(body) {
  if (!Number.isSafeInteger(body.version) || body.version < 1) throw invalid(["version"]);
  return body.version;
}

function readOptionalId(body, key) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  if (!isUuid(body[key])) throw invalid([key]);
  return body[key];
}

// 손님 만들기: 이름 1 ~ 60자, 찾는 조건 2,000자 이하. 이름·찾는 조건 모두 주민번호 형태를 가린다(11.2절).
export function parseCustomerCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["displayName", "phoneDigits", "needs", "status"]);
  const displayName = maskField(readText(body, "displayName", { min: 1, max: 60, required: true }), "displayName", 60);
  const phoneDigits = readPhone(body) ?? null;
  const needs = maskField(readText(body, "needs", { min: 0, max: 2000, required: false }) ?? "", "needs", 2000);
  const status = readStatus(body) ?? "consulting";
  return { displayName: displayName.text, phoneDigits, needs: needs.text, status, rrnMasked: displayName.count + needs.count };
}

export function parseCustomerPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", "displayName", "phoneDigits", "needs", "status"]);
  const version = readVersion(body);
  const changes = {};
  let rrnMasked = 0;
  const rawName = readText(body, "displayName", { min: 1, max: 60, required: false });
  if (rawName !== undefined) {
    const displayName = maskField(rawName, "displayName", 60);
    changes.displayName = displayName.text;
    rrnMasked += displayName.count;
  }
  const phoneDigits = readPhone(body);
  if (phoneDigits !== undefined) changes.phoneDigits = phoneDigits;
  const rawNeeds = readText(body, "needs", { min: 0, max: 2000, required: false });
  if (rawNeeds !== undefined) {
    const needs = maskField(rawNeeds, "needs", 2000);
    changes.needs = needs.text;
    rrnMasked += needs.count;
  }
  const status = readStatus(body);
  if (status !== undefined) changes.status = status;
  if (Object.keys(changes).length === 0) throw invalid(["body"]);
  return { version, changes, rrnMasked };
}

export function parseConfirmation(body, key) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, [key]);
  if (typeof body[key] !== "string" || body[key].trim() === "" || body[key].length > 200) throw invalid([key]);
  return body[key].trim();
}

// 메모: 본문은 주민번호 형태를 가린 뒤 1 ~ 20,000자. 손님·거래 연결은 선택(둘 다 없으면 메모 창고).
export function parseNoteCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["body", "customerId", "dealId"]);
  const masked = maskField(readText(body, "body", { min: 1, max: 20000, required: true }), "body", 20000);
  return {
    body: masked.text,
    rrnMasked: masked.count,
    customerId: readOptionalId(body, "customerId") ?? null,
    dealId: readOptionalId(body, "dealId") ?? null,
  };
}

export function parseNotePatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", "body", "customerId", "dealId"]);
  const version = readVersion(body);
  const changes = {};
  let rrnMasked = 0;
  const raw = readText(body, "body", { min: 1, max: 20000, required: false });
  if (raw !== undefined) {
    const masked = maskField(raw, "body", 20000);
    changes.body = masked.text;
    rrnMasked = masked.count;
  }
  const customerId = readOptionalId(body, "customerId");
  if (customerId !== undefined) changes.customerId = customerId;
  const dealId = readOptionalId(body, "dealId");
  if (dealId !== undefined) changes.dealId = dealId;
  if (Object.keys(changes).length === 0) throw invalid(["body"]);
  return { version, changes, rrnMasked };
}

// 검색어: 소문자·NFKC 정규화 뒤 1 ~ 30자(8.6절). 전화번호는 검색어가 숫자·공백·하이픈으로만 돼 있고
// 숫자가 3자 이상일 때만 비교한다("101동"·"a1"처럼 글자가 섞인 검색어로 엉뚱한 전화번호가 걸리지 않게). digits가 ""이면 비교하지 않는다.
const PHONE_QUERY_PATTERN = /^[\d\s-]+$/u;
const PHONE_QUERY_MIN_DIGITS = 3;

export function parseSearchQuery(value, { required }) {
  if (value === null || value === undefined || value === "") {
    if (required) throw invalid(["q"]);
    return null;
  }
  const text = value.normalize("NFKC").toLowerCase().trim();
  if (text.length < SEARCH_MIN || text.length > SEARCH_MAX) throw invalid(["q"]);
  const digits = PHONE_QUERY_PATTERN.test(text) ? text.replace(/\D/gu, "") : "";
  return { text, digits: digits.length >= PHONE_QUERY_MIN_DIGITS ? digits : "" };
}

export function parseLimit(value) {
  if (value === null || value === undefined || value === "") return LIST_LIMIT_DEFAULT;
  if (!/^\d{1,3}$/u.test(value)) throw invalid(["limit"]);
  const limit = Number(value);
  if (limit < 1 || limit > LIST_LIMIT_MAX) throw invalid(["limit"]);
  return limit;
}

// 커서: { t: ISO 시각, i: UUID }를 base64url JSON으로 묶는다. 길이·형식이 틀리면 400(대장 조건).
export function encodeCursor(time, id) {
  return btoa(JSON.stringify({ t: time, i: id })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid(["cursor"]);
  let parsed;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    parsed = JSON.parse(atob(padded));
  } catch {
    throw invalid(["cursor"]);
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length !== 2 || !ISO_TIME_PATTERN.test(parsed.t ?? "") || !isUuid(parsed.i)) {
    throw invalid(["cursor"]);
  }
  return { time: parsed.t, id: parsed.i };
}

// 한국 날짜(YYYY-MM-DD)와 정리 안내 기준일(+1년, 8.7절 설계 선택).
export function koreaDate(now) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addOneYear(dateText) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCFullYear(date.getUTCFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
