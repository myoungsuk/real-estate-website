// 업무 도구 API 입력 검사·정규화(순수 함수). 오류 메시지는 고정 문구만 쓰고 입력값을 담지 않는다(설계서 10.1절).
import { WorkApiError } from "./work-security.mjs";
import { DEFAULT_ALARM_TRIGGERS, isAllowedAlarmTriggers } from "./work-calendar.mjs";
import { cleanMultiLine, cleanSingleLine } from "../src/lib/work/work-format.mjs";
import { TASK_REPEAT_RULES } from "../src/lib/work/task-repeat.mjs";
import { APPOINTMENT_REPEAT_RULES } from "../src/lib/work/appointment-repeat.mjs";
import { APPOINTMENT_TAG_KEYS, DEFAULT_APPOINTMENT_ALARMS, appointmentAlarmsValid, isClockTime } from "../src/lib/work/appointment-rules.mjs";

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

// 거래(설계서 8.2·10.2절). 0001 칸 + 0002 일정 계산 입력 칸. regulated_area(0/1)는 입력으로 받지 않고
// regulation에서만 만든다(dealRegulatedArea, DB CHECK로도 묶음).
export const DEAL_TYPES = Object.freeze(["sale", "exchange", "jeonse", "monthly_rent"]);
export const PROPERTY_KINDS = Object.freeze(["housing", "officetel", "other", "land"]);
export const DEAL_STATUSES = Object.freeze(["open", "contracted", "completed", "cancelled"]);
export const CLOSED_DEAL_STATUSES = Object.freeze(["completed", "cancelled"]);
export const PARTY_ROLES = Object.freeze(["buyer", "seller", "tenant", "landlord", "other"]);
export const SALE_KINDS = Object.freeze(["sale", "supply", "status_sale"]);
export const REGULATIONS = Object.freeze(["none", "adjusted", "overheated"]);
export const OFFICETEL_SCHEDULE_TARGETS = Object.freeze(["housing", "other"]);
export const MAX_DEAL_PARTIES = 10;
const DEAL_FIELDS = Object.freeze([
  "title", "dealType", "saleKind", "propertyKind", "scheduleTarget", "propertyLabel", "priceWon", "depositWon", "monthlyRentWon",
  "contractOn", "middlePaymentOn", "balanceOn", "buyerIsCorporation", "regulation", "landPermitArea", "metroArea",
  "landShare", "separateFundingSubmission", "leaseReportingRegion", "leaseRenewalWithoutChange", "status",
]);
const DEAL_FLAG_FIELDS = Object.freeze([
  "buyerIsCorporation", "landPermitArea", "metroArea", "landShare", "separateFundingSubmission", "leaseReportingRegion", "leaseRenewalWithoutChange",
]);

// regulated_area는 이 함수 한 곳에서만 만든다(비규제 0, 조정·투기과열 1).
export function dealRegulatedArea(regulation) {
  return regulation === "none" ? 0 : 1;
}
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
// 거래 종류마다 받는 금액 칸(공개 매물과 같은 규칙: 매매·교환은 거래가, 전세는 보증금, 월세는 보증금·월세).
export const AMOUNT_FIELDS_BY_TYPE = Object.freeze({
  sale: ["priceWon"],
  exchange: ["priceWon"],
  jeonse: ["depositWon"],
  monthly_rent: ["depositWon", "monthlyRentWon"],
});
const AMOUNT_FIELDS = Object.freeze(["priceWon", "depositWon", "monthlyRentWon"]);

export function isCalendarDate(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function readEnum(body, key, allowed, { nullable = false } = {}) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (nullable && body[key] === null) return null;
  if (!allowed.includes(body[key])) throw invalid([key]);
  return body[key];
}

function readFlag(body, key) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (typeof body[key] !== "boolean") throw invalid([key]);
  return body[key] ? 1 : 0;
}

function readAmount(body, key) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null) return null;
  if (!Number.isSafeInteger(body[key]) || body[key] < 0) throw invalid([key]);
  return body[key];
}

function readDate(body, key) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null || body[key] === "") return null;
  if (!isCalendarDate(body[key])) throw invalid([key]);
  return body[key];
}

// 참여자: [{ customerId, role }] 최대 10개. 같은 손님·역할 묶음은 한 번만.
export function parseParties(value) {
  if (!Array.isArray(value) || value.length > MAX_DEAL_PARTIES) throw invalid(["parties"]);
  const seen = new Set();
  return value.map((party) => {
    if (!isPlainObject(party) || Object.keys(party).some((key) => key !== "customerId" && key !== "role")) throw invalid(["parties"]);
    if (!isUuid(party.customerId) || !PARTY_ROLES.includes(party.role)) throw invalid(["parties"]);
    const key = `${party.customerId}:${party.role}`;
    if (seen.has(key)) throw invalid(["parties"]);
    seen.add(key);
    return { customerId: party.customerId, role: party.role };
  });
}

// 거래 칸을 읽어 바뀐 값만 돌려준다(없는 칸은 undefined). 제목·물건 표시는 주민번호 형태를 가린다.
function readDealFields(body) {
  const fields = {};
  let rrnMasked = 0;
  const title = readText(body, "title", { min: 1, max: 80, required: false });
  if (title !== undefined) {
    const masked = maskField(title, "title", 80);
    fields.title = masked.text;
    rrnMasked += masked.count;
  }
  const propertyLabel = readText(body, "propertyLabel", { min: 0, max: 120, required: false });
  if (propertyLabel !== undefined) {
    const masked = maskField(propertyLabel, "propertyLabel", 120);
    fields.propertyLabel = masked.text;
    rrnMasked += masked.count;
  }
  const dealType = readEnum(body, "dealType", DEAL_TYPES);
  if (dealType !== undefined) fields.dealType = dealType;
  const saleKind = readEnum(body, "saleKind", SALE_KINDS, { nullable: true });
  if (saleKind !== undefined) fields.saleKind = saleKind;
  const propertyKind = readEnum(body, "propertyKind", PROPERTY_KINDS);
  if (propertyKind !== undefined) fields.propertyKind = propertyKind;
  const scheduleTarget = readEnum(body, "scheduleTarget", OFFICETEL_SCHEDULE_TARGETS, { nullable: true });
  if (scheduleTarget !== undefined) fields.scheduleTarget = scheduleTarget;
  const regulation = readEnum(body, "regulation", REGULATIONS);
  if (regulation !== undefined) fields.regulation = regulation;
  const status = readEnum(body, "status", DEAL_STATUSES);
  if (status !== undefined) fields.status = status;
  for (const key of AMOUNT_FIELDS) {
    const amount = readAmount(body, key);
    if (amount !== undefined) fields[key] = amount;
  }
  for (const key of ["contractOn", "middlePaymentOn", "balanceOn"]) {
    const date = readDate(body, key);
    if (date !== undefined) fields[key] = date;
  }
  for (const key of DEAL_FLAG_FIELDS) {
    const flag = readFlag(body, key);
    if (flag !== undefined) fields[key] = flag;
  }
  return { fields, rrnMasked };
}

// 합친 거래 값의 앞뒤를 본다(단계 0 일정 계산과 같은 규칙).
// 거래 종류에 없는 금액 칸, 매매가 아닌데 매매 세부 종류, 오피스텔인데 일정 판정 미선택·오피스텔이 아닌데 선택, 계약일보다 빠른 중도금·잔금일.
export function assertDealConsistent(deal) {
  const allowed = AMOUNT_FIELDS_BY_TYPE[deal.dealType] ?? [];
  const wrong = AMOUNT_FIELDS.filter((key) => !allowed.includes(key) && deal[key] !== null && deal[key] !== undefined);
  if (deal.dealType !== "sale" && deal.saleKind !== null) wrong.push("saleKind");
  if (deal.propertyKind === "officetel" ? deal.scheduleTarget === null : deal.scheduleTarget !== null) wrong.push("scheduleTarget");
  wrong.push(...["middlePaymentOn", "balanceOn"].filter((key) => deal[key] && deal.contractOn && deal[key] < deal.contractOn));
  if (wrong.length > 0) throw invalid(wrong);
}

export const DEAL_DEFAULTS = Object.freeze({
  saleKind: null,
  scheduleTarget: null,
  propertyLabel: "",
  priceWon: null,
  depositWon: null,
  monthlyRentWon: null,
  contractOn: null,
  middlePaymentOn: null,
  balanceOn: null,
  buyerIsCorporation: 0,
  regulation: "none",
  landPermitArea: 0,
  metroArea: 1,
  landShare: 0,
  separateFundingSubmission: 0,
  leaseReportingRegion: 1,
  leaseRenewalWithoutChange: 0,
  status: "open",
});

export function parseDealCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, [...DEAL_FIELDS, "parties"]);
  for (const key of ["title", "dealType", "propertyKind"]) {
    if (!(key in body) || body[key] === undefined) throw invalid([key]);
  }
  const { fields, rrnMasked } = readDealFields(body);
  const deal = { ...DEAL_DEFAULTS, ...fields };
  // 매매인데 세부 종류를 안 주면 일반 매매로 둔다.
  if (deal.dealType === "sale" && deal.saleKind === null && !("saleKind" in fields)) deal.saleKind = "sale";
  assertDealConsistent(deal);
  const parties = body.parties === undefined ? [] : parseParties(body.parties);
  return { deal, parties, rrnMasked };
}

export function parseDealPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", ...DEAL_FIELDS, "parties"]);
  const version = readVersion(body);
  const { fields, rrnMasked } = readDealFields(body);
  const parties = body.parties === undefined ? undefined : parseParties(body.parties);
  if (Object.keys(fields).length === 0 && parties === undefined) throw invalid(["body"]);
  return { version, changes: fields, parties, rrnMasked };
}

// 일정(설계서 8.2 deal_events·10.2절, PR-B2). 직접 넣는 일정은 kind "custom"만 받는다(법정 기한 일정은 다시 계산으로만 만든다).
// 제목은 주민번호 형태를 가리고 1 ~ 80자, 알림은 단계 0과 같은 세 시점 중 최대 2개(기본 전날 18:00).
function readAlarms(body, { required }) {
  if (!("alarmOffsets" in body) || body.alarmOffsets === undefined) return required ? [...DEFAULT_ALARM_TRIGGERS] : undefined;
  if (!isAllowedAlarmTriggers(body.alarmOffsets)) throw invalid(["alarmOffsets"]);
  return [...body.alarmOffsets];
}

export function parseEventCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["kind", "dueOn", "title", "alarmOffsets"]);
  if (body.kind !== "custom") throw invalid(["kind"]);
  if (!isCalendarDate(body.dueOn)) throw invalid(["dueOn"]);
  const title = maskField(readText(body, "title", { min: 1, max: 80, required: true }), "title", 80);
  return { dueOn: body.dueOn, title: title.text, alarmOffsets: readAlarms(body, { required: true }), rrnMasked: title.count };
}

export function parseEventPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", "dueOn", "title", "done", "alarmOffsets"]);
  const version = readVersion(body);
  const changes = {};
  let rrnMasked = 0;
  if ("dueOn" in body && body.dueOn !== undefined) {
    if (!isCalendarDate(body.dueOn)) throw invalid(["dueOn"]);
    changes.dueOn = body.dueOn;
  }
  const rawTitle = readText(body, "title", { min: 1, max: 80, required: false });
  if (rawTitle !== undefined) {
    const title = maskField(rawTitle, "title", 80);
    changes.title = title.text;
    rrnMasked = title.count;
  }
  if ("done" in body && body.done !== undefined) {
    if (typeof body.done !== "boolean") throw invalid(["done"]);
    changes.done = body.done;
  }
  const alarms = readAlarms(body, { required: false });
  if (alarms !== undefined) changes.alarmOffsets = alarms;
  if (Object.keys(changes).length === 0) throw invalid(["body"]);
  return { version, changes, rrnMasked };
}

// 다시 계산 요청: { replaceCalculated: true }만 받는다(자동 계산 일정만 바꾼다는 뜻을 분명히, 설계서 10.2).
export function parseCalculate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["replaceCalculated"]);
  if (body.replaceCalculated !== true) throw invalid(["replaceCalculated"]);
  return { replaceCalculated: true };
}

// 정렬 칸이 날짜(YYYY-MM-DD)나 0 이상 정수인 목록의 커서: { k: 값, i: UUID }를 base64url JSON으로 묶는다(시각 커서 encodeCursor와 같은 꼴).
// 길이·형식이 틀리면 400. type은 "date" 또는 "int".
export function encodeKeyCursor(key, id) {
  return btoa(JSON.stringify({ k: key, i: id })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeKeyCursor(value, type) {
  if (value === null || value === undefined || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid(["cursor"]);
  let parsed;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    parsed = JSON.parse(atob(padded));
  } catch {
    throw invalid(["cursor"]);
  }
  const keyOk = type === "date" ? isCalendarDate(parsed?.k) : Number.isSafeInteger(parsed?.k) && parsed.k >= 0;
  if (!isPlainObject(parsed) || Object.keys(parsed).length !== 2 || !keyOk || !isUuid(parsed.i)) throw invalid(["cursor"]);
  return { key: parsed.k, id: parsed.i };
}

// 매출장부(설계서 6.12·10.2절, 단계 2). 줄 종류·낸 쪽 역할·합계 기준일.
export const LEDGER_KINDS = Object.freeze(["fee", "expense", "other_income"]);
export const LEDGER_BASES = Object.freeze(["balance", "contract", "received"]);
export const DEAL_LIST_BASES = Object.freeze(["balance", "contract"]);
const LEDGER_FIELDS = Object.freeze(["payerRole", "label", "entryOn", "amountWon", "vatWon", "receivedWon", "receivedOn", "memo"]);
const YEAR_PATTERN = /^\d{4}$/u;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const yearInRange = (text) => Number(text) >= YEAR_MIN && Number(text) <= YEAR_MAX;

function parseYear(value, { required }) {
  if (value === null || value === undefined || value === "") {
    if (required) throw invalid(["year"]);
    return null;
  }
  if (!YEAR_PATTERN.test(value) || !yearInRange(value)) throw invalid(["year"]);
  return value;
}

function parseBasis(value, allowed) {
  if (value === null || value === undefined || value === "") return "balance";
  if (!allowed.includes(value)) throw invalid(["basis"]);
  return value;
}

// label(한 줄 120자)·memo(여러 줄 500자): 기존 정리 함수로 제어 문자·공백을 고른 뒤 주민번호 형태를 가린다(가린 뒤 길이도 다시 봄).
function readLedgerText(body, key, max, clean) {
  const raw = readText(body, key, { min: 0, max, required: false });
  if (raw === undefined) return undefined;
  return maskField(clean(raw, max), key, max);
}

function readRequiredAmount(body, key) {
  const amount = readAmount(body, key);
  if (amount === null) throw invalid([key]);
  return amount;
}

// 장부 칸을 읽어 보낸 칸만 돌려준다(없는 칸은 undefined). 금액은 0 이상 안전한 정수(거래 금액 칸과 같은 검사), 날짜는 달력 날짜.
function readLedgerFields(body) {
  const fields = {};
  let rrnMasked = 0;
  const payerRole = readEnum(body, "payerRole", PARTY_ROLES, { nullable: true });
  if (payerRole !== undefined) fields.payerRole = payerRole;
  for (const [key, max, clean] of [["label", 120, cleanSingleLine], ["memo", 500, cleanMultiLine]]) {
    const masked = readLedgerText(body, key, max, clean);
    if (masked !== undefined) {
      fields[key] = masked.text;
      rrnMasked += masked.count;
    }
  }
  for (const key of ["amountWon", "vatWon", "receivedWon"]) {
    const amount = readRequiredAmount(body, key);
    if (amount !== undefined) fields[key] = amount;
  }
  for (const key of ["entryOn", "receivedOn"]) {
    const date = readDate(body, key);
    if (date !== undefined) fields[key] = date;
  }
  return { fields, rrnMasked };
}

// 장부 줄의 최종 상태(만들기 값, 또는 고치기의 저장된 줄 + 고칠 값)를 본다. 0005 CHECK에 걸릴 조합을 미리 400으로 돌려
// CHECK 위반이 500으로 나가지 않게 한다. requireEntryOn: 거래도 옮겨 둔 날짜(snap_*)도 없는 지출·기타 수입에 날짜를 요구할지
// (만들기는 늘, 고치기는 entryOn을 보냈을 때만. 거래 삭제로 날짜 없이 남은 줄의 다른 칸을 고치는 것은 막지 않는다).
export function assertLedgerState(state, { requireEntryOn }) {
  const wrong = [];
  if (state.payerRole !== null && state.kind !== "fee") wrong.push("payerRole");
  if (state.kind === "expense" && state.receivedWon > 0) wrong.push("receivedWon");
  // 입금일: 지출은 받지 않는다(입금일 기준에서도 잔금일 기준 날짜를 씀). 보수·기타 수입은 입금액이 있으면 입금일이 있어야 하고,
  // 입금액이 0이면 입금일이 비어 있어야 한다(입금하지 않은 줄이 입금일 기준 합계에 들어가지 않게, 2026-11-21 대장 지시).
  if (state.kind === "expense" ? state.receivedOn !== null : (state.receivedWon > 0) !== (state.receivedOn !== null)) wrong.push("receivedOn");
  if (state.dealId !== null && state.entryOn !== null) wrong.push("entryOn");
  else if (requireEntryOn && state.dealId === null && state.kind !== "fee" && state.entryOn === null
    && state.snapContractOn === null && state.snapBalanceOn === null) wrong.push("entryOn");
  if (wrong.length > 0) throw invalid(wrong);
}

export const LEDGER_DEFAULTS = Object.freeze({
  dealId: null,
  payerRole: null,
  label: "",
  entryOn: null,
  vatWon: 0,
  receivedWon: 0,
  receivedOn: null,
  memo: "",
  snapContractOn: null,
  snapBalanceOn: null,
});

export function parseLedgerCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["kind", "dealId", ...LEDGER_FIELDS]);
  if (!LEDGER_KINDS.includes(body.kind)) throw invalid(["kind"]);
  if (!("amountWon" in body) || body.amountWon === undefined) throw invalid(["amountWon"]);
  const dealId = readOptionalId(body, "dealId") ?? null;
  const { fields, rrnMasked } = readLedgerFields(body);
  const entry = { ...LEDGER_DEFAULTS, ...fields, kind: body.kind, dealId };
  assertLedgerState(entry, { requireEntryOn: true });
  return { entry, rrnMasked };
}

// 고치기: 거래(dealId)와 종류(kind)는 바꾸지 않는다(D-6, 보내면 400). 최종 상태 검사는 저장된 줄과 합친 뒤 assertLedgerState로 한다.
export function parseLedgerPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", ...LEDGER_FIELDS]);
  const version = readVersion(body);
  const { fields, rrnMasked } = readLedgerFields(body);
  if (Object.keys(fields).length === 0) throw invalid(["body"]);
  return { version, changes: fields, rrnMasked };
}

// 장부 목록: ?year=&basis=&unpaid=1&kind=&dealId=&cursor=&limit=. 커서 꼴은 정렬에 따라 다르다
// (미입금 보기: 미입금액, 연도: 기준일, 그 밖: 고친 시각).
export function parseLedgerQuery(params) {
  const year = parseYear(params.get("year"), { required: false });
  const basis = parseBasis(params.get("basis"), LEDGER_BASES);
  const unpaidText = params.get("unpaid");
  if (unpaidText !== null && unpaidText !== "" && unpaidText !== "1" && unpaidText !== "0") throw invalid(["unpaid"]);
  const unpaid = unpaidText === "1";
  const kindText = params.get("kind");
  if (kindText !== null && kindText !== "" && !LEDGER_KINDS.includes(kindText)) throw invalid(["kind"]);
  const dealText = params.get("dealId");
  if (dealText !== null && dealText !== "" && !isUuid(dealText)) throw invalid(["dealId"]);
  const order = unpaid ? "unpaid" : year ? "basis" : "updated";
  const cursorText = params.get("cursor");
  const cursor = order === "updated" ? decodeCursor(cursorText) : decodeKeyCursor(cursorText, order === "unpaid" ? "int" : "date");
  return {
    year, basis, unpaid, order,
    kind: kindText ? kindText : null,
    dealId: dealText ? dealText : null,
    cursor: cursor && order === "updated" ? { key: cursor.time, id: cursor.id } : cursor,
    limit: parseLimit(params.get("limit")),
  };
}

export function parseLedgerSummaryQuery(params) {
  return { year: parseYear(params.get("year"), { required: true }), basis: parseBasis(params.get("basis"), LEDGER_BASES) };
}

// CSV 내려받기 감사(POST /work/ledger/export): { year, basis, count }. 장부 자료는 받지 않고, 감사 reason에 줄 수만 남긴다.
// year는 장부 목록·합계와 같은 검사(숫자 2026 또는 글자 "2026"), basis는 세 값 중 하나(빠지면 400), count는 0 이상 정수.
export const LEDGER_EXPORT_COUNT_MAX = 100_000;
export function parseLedgerExport(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["year", "basis", "count"]);
  const wrong = [];
  const yearText = Number.isInteger(body.year) ? String(body.year) : typeof body.year === "string" ? body.year : "";
  let year = null;
  try {
    year = parseYear(yearText, { required: true });
  } catch {
    wrong.push("year");
  }
  if (!LEDGER_BASES.includes(body.basis)) wrong.push("basis");
  if (!Number.isSafeInteger(body.count) || body.count < 0 || body.count > LEDGER_EXPORT_COUNT_MAX) wrong.push("count");
  if (wrong.length > 0) throw invalid(wrong);
  return { year, basis: body.basis, count: body.count };
}

// 거래 목록: ?status=a,b&basis=balance|contract&month=YYYY-MM|year=YYYY&q=&cursor=&limit=. 상태는 쉼표로 여러 값.
// 기간(month 또는 year)을 주면 고른 기준일로 거르고 기준일·id 내림차순, 주지 않으면 고친 시각·id 내림차순.
export function parseDealListQuery(params) {
  const statusText = params.get("status");
  let statuses = null;
  if (statusText !== null && statusText !== "") {
    const values = statusText.split(",");
    if (values.length > DEAL_STATUSES.length || values.some((value) => !DEAL_STATUSES.includes(value))) throw invalid(["status"]);
    statuses = [...new Set(values)];
  }
  const basis = parseBasis(params.get("basis"), DEAL_LIST_BASES);
  const monthText = params.get("month");
  const yearText = params.get("year");
  const hasMonth = monthText !== null && monthText !== "";
  const hasYear = yearText !== null && yearText !== "";
  if (hasMonth && hasYear) throw invalid(["month", "year"]);
  let period = null;
  if (hasMonth) {
    const match = MONTH_PATTERN.exec(monthText);
    if (!match || !yearInRange(match[1])) throw invalid(["month"]);
    period = monthText;
  } else if (hasYear) {
    period = parseYear(yearText, { required: true });
  }
  const query = parseSearchQuery(params.get("q"), { required: false });
  const cursorText = params.get("cursor");
  const cursor = period ? decodeKeyCursor(cursorText, "date") : decodeCursor(cursorText);
  return {
    statuses, basis, period, query,
    cursor: cursor && !period ? { key: cursor.time, id: cursor.id } : cursor,
    limit: parseLimit(params.get("limit")),
  };
}

// 할 일(설계서 6.13·10.2절 후보, 단계 2, 0006 tasks). 제목은 한 줄 정리(cleanSingleLine) 뒤 1 ~ 80자이고 주민번호 형태를 가린다.
// 반복은 없음·매주·매월만(TASK_REPEAT_RULES). 매월 기준일(repeatDay)은 입력으로 받지 않고 날짜의 '일'로 정한다(T-6).
export const TASK_STATUSES = Object.freeze(["open", "done"]);
export const TASK_LIST_LIMIT_DEFAULT = 50;
const TASK_CREATE_FIELDS = Object.freeze(["title", "dueOn", "dealId", "repeat"]);

function readTaskTitle(body, { required }) {
  if (!("title" in body) || body.title === undefined) {
    if (required) throw invalid(["title"]);
    return undefined;
  }
  if (typeof body.title !== "string") throw invalid(["title"]);
  const cleaned = cleanSingleLine(body.title, body.title.length);
  if (cleaned.length < 1 || cleaned.length > 80) throw invalid(["title"]);
  return maskField(cleaned, "title", 80);
}

// 매월 기준일: 날짜(YYYY-MM-DD)의 '일'. 매월이 아니면 null(0006 CHECK: 매월만 기준일을 가짐).
export function taskRepeatDay(repeat, dueOn) {
  return repeat === "monthly" && dueOn ? Number(dueOn.slice(8, 10)) : null;
}

export function parseTaskCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, TASK_CREATE_FIELDS);
  const title = readTaskTitle(body, { required: true });
  const dueOn = readDate(body, "dueOn") ?? null;
  const dealId = readOptionalId(body, "dealId") ?? null;
  const repeat = readEnum(body, "repeat", TASK_REPEAT_RULES) ?? "none";
  if (repeat !== "none" && dueOn === null) throw invalid(["dueOn"]);
  return { task: { title: title.text, dueOn, dealId, repeat, repeatDay: taskRepeatDay(repeat, dueOn) }, rrnMasked: title.count };
}

// 고치기: 보낸 칸만 돌려준다. dueOn·dealId는 null이면 지움·뗌. done은 true(끝냄)·false(다시 열기).
// 최종 상태(저장된 줄 + 고칠 값)의 앞뒤는 work-tasks.mjs가 본다(반복인데 날짜 없음, 끝낸 채로 남는 줄에 반복).
export function parseTaskPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", ...TASK_CREATE_FIELDS, "done"]);
  const version = readVersion(body);
  const changes = {};
  let rrnMasked = 0;
  const title = readTaskTitle(body, { required: false });
  if (title !== undefined) {
    changes.title = title.text;
    rrnMasked = title.count;
  }
  const dueOn = readDate(body, "dueOn");
  if (dueOn !== undefined) changes.dueOn = dueOn;
  const dealId = readOptionalId(body, "dealId");
  if (dealId !== undefined) changes.dealId = dealId;
  const repeat = readEnum(body, "repeat", TASK_REPEAT_RULES);
  if (repeat !== undefined) changes.repeat = repeat;
  if ("done" in body && body.done !== undefined) {
    if (typeof body.done !== "boolean") throw invalid(["done"]);
    changes.done = body.done;
  }
  if (Object.keys(changes).length === 0) throw invalid(["body"]);
  return { version, changes, rrnMasked };
}

// 열린 할 일 목록의 커서: { d: 날짜 또는 null, t: 만든 시각, i: UUID }를 base64url JSON으로 묶는다(정렬이 날짜 없음 여부·날짜·만든 시각·id라
// 값 하나짜리 encodeKeyCursor로는 담을 수 없음). 길이·형식이 틀리면 400. 끝낸 목록은 (끝낸 시각, id)라 encodeCursor를 쓴다.
export function encodeTaskCursor(dueOn, createdAt, id) {
  return btoa(JSON.stringify({ d: dueOn, t: createdAt, i: id })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeTaskCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid(["cursor"]);
  let parsed;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    parsed = JSON.parse(atob(padded));
  } catch {
    throw invalid(["cursor"]);
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length !== 3 || !(parsed.d === null || isCalendarDate(parsed.d))
    || !ISO_TIME_PATTERN.test(parsed.t ?? "") || !isUuid(parsed.i)) throw invalid(["cursor"]);
  return { dueOn: parsed.d, createdAt: parsed.t, id: parsed.i };
}

// 할 일 목록: ?status=open|done(기본 open)&until=YYYY-MM-DD(열린 목록만, 그날까지·날짜 없는 줄 빠짐)&dealId=&cursor=&limit=(기본 50, 최대 50).
export function parseTaskQuery(params) {
  const statusText = params.get("status");
  if (statusText !== null && statusText !== "" && !TASK_STATUSES.includes(statusText)) throw invalid(["status"]);
  const status = statusText ? statusText : "open";
  const untilText = params.get("until");
  let until = null;
  if (untilText !== null && untilText !== "") {
    if (status !== "open" || !isCalendarDate(untilText)) throw invalid(["until"]);
    until = untilText;
  }
  const dealText = params.get("dealId");
  if (dealText !== null && dealText !== "" && !isUuid(dealText)) throw invalid(["dealId"]);
  const limitText = params.get("limit");
  const cursorText = params.get("cursor");
  return {
    status, until,
    dealId: dealText ? dealText : null,
    cursor: status === "open" ? decodeTaskCursor(cursorText) : decodeCursor(cursorText),
    limit: limitText === null || limitText === "" ? TASK_LIST_LIMIT_DEFAULT : parseLimit(limitText),
  };
}

// 거래 없는 일정(설계서 6.15절, 0009 appointments). 제목은 할 일과 같은 규칙(한 줄 정리 뒤 1 ~ 80자, 주민번호 형태 가림).
// 꼬리표·반복·알림 목록은 DB CHECK 없이 여기서 검사한다(appointment-rules.mjs·appointment-repeat.mjs, 사용자 답 "코드가 검사").
// 칸 하나하나의 꼴은 parse*가, 칸 사이 규칙(끝 시각·끝나는 날·알림)은 저장할 최종 상태로 appointmentStateErrors가 본다.
const APPOINTMENT_FIELDS = Object.freeze(["tag", "title", "startsOn", "startTime", "endTime", "repeatRule", "repeatUntil", "alarms"]);
export const APPOINTMENT_SCOPES = Object.freeze(["one", "following"]);
export const CALENDAR_RANGE_MAX_DAYS = 42; // 달력 6주

function readClock(body, key) {
  if (!(key in body) || body[key] === undefined) return undefined;
  if (body[key] === null || body[key] === "") return null;
  if (!isClockTime(body[key])) throw invalid([key]);
  return body[key];
}

function readAppointmentFields(body) {
  const fields = {};
  let rrnMasked = 0;
  const tag = readEnum(body, "tag", APPOINTMENT_TAG_KEYS);
  if (tag !== undefined) fields.tag = tag;
  const title = readTaskTitle(body, { required: false });
  if (title !== undefined) {
    fields.title = title.text;
    rrnMasked = title.count;
  }
  if ("startsOn" in body && body.startsOn !== undefined) {
    if (!isCalendarDate(body.startsOn)) throw invalid(["startsOn"]);
    fields.startsOn = body.startsOn;
  }
  const startTime = readClock(body, "startTime");
  if (startTime !== undefined) fields.startTime = startTime;
  const endTime = readClock(body, "endTime");
  if (endTime !== undefined) fields.endTime = endTime;
  const repeatRule = readEnum(body, "repeatRule", APPOINTMENT_REPEAT_RULES);
  if (repeatRule !== undefined) fields.repeatRule = repeatRule;
  const repeatUntil = readDate(body, "repeatUntil");
  if (repeatUntil !== undefined) fields.repeatUntil = repeatUntil;
  if ("alarms" in body && body.alarms !== undefined) {
    if (!Array.isArray(body.alarms) || !body.alarms.every((alarm) => typeof alarm === "string")) throw invalid(["alarms"]);
    fields.alarms = [...body.alarms];
  }
  return { fields, rrnMasked };
}

// 저장할 최종 상태의 칸 사이 규칙. 어긴 칸 이름 배열(없으면 []).
// 끝 시각은 시작 시각이 있어야 하고 더 늦어야 한다(같으면 안 됨, 사용자 답 11-25 23:32:21). 끝나는 날은 반복일 때만, 시작일 이후.
// 알림은 0 ~ 2개·겹침 없음·고를 수 있는 것만(하루 종일에 '1시간 전', 시작보다 늦게 울리는 알림은 안 됨).
export function appointmentStateErrors(state) {
  const wrong = [];
  if (state.endTime !== null && state.startTime === null) wrong.push("startTime");
  else if (state.endTime !== null && state.endTime <= state.startTime) wrong.push("endTime");
  if (state.repeatUntil !== null && (state.repeatRule === "none" || state.repeatUntil < state.startsOn)) wrong.push("repeatUntil");
  if (!appointmentAlarmsValid(state.alarms, state.startTime)) wrong.push("alarms");
  return wrong;
}

export function parseAppointmentCreate(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, APPOINTMENT_FIELDS);
  const missing = ["tag", "title", "startsOn"].filter((key) => !(key in body) || body[key] === undefined);
  if (missing.length > 0) throw invalid(missing);
  const { fields, rrnMasked } = readAppointmentFields(body);
  const appointment = {
    tag: fields.tag,
    title: fields.title,
    startsOn: fields.startsOn,
    startTime: fields.startTime ?? null,
    endTime: fields.endTime ?? null,
    repeatRule: fields.repeatRule ?? "none",
    repeatUntil: fields.repeatUntil ?? null,
    alarms: fields.alarms ?? [...DEFAULT_APPOINTMENT_ALARMS],
  };
  const wrong = appointmentStateErrors(appointment);
  if (wrong.length > 0) throw invalid(wrong);
  return { appointment, rrnMasked };
}

// 반복 줄의 어느 날인지(scope·occurrenceOn). 둘은 함께 오거나 함께 없어야 한다. 반복 줄인지는 work-appointments.mjs가 저장된 줄로 본다.
function readScope(body) {
  const hasScope = "scope" in body && body.scope !== undefined;
  const hasOn = "occurrenceOn" in body && body.occurrenceOn !== undefined;
  if (!hasScope && !hasOn) return { scope: null, occurrenceOn: null };
  if (!hasScope || !APPOINTMENT_SCOPES.includes(body.scope)) throw invalid(["scope"]);
  if (!hasOn || !isCalendarDate(body.occurrenceOn)) throw invalid(["occurrenceOn"]);
  return { scope: body.scope, occurrenceOn: body.occurrenceOn };
}

// 고치기: 보낸 칸만 돌려준다(startTime·endTime·repeatUntil은 null이면 지움). 바꿀 칸이 하나도 없으면 400.
export function parseAppointmentPatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", "scope", "occurrenceOn", ...APPOINTMENT_FIELDS]);
  const version = readVersion(body);
  const { scope, occurrenceOn } = readScope(body);
  const { fields, rrnMasked } = readAppointmentFields(body);
  if (Object.keys(fields).length === 0) throw invalid(["body"]);
  return { version, scope, occurrenceOn, changes: fields, rrnMasked };
}

// 지우기: 반복 없는 줄은 본문 없음(null), 반복 줄은 { version, scope, occurrenceOn } 셋 다.
export function parseAppointmentDelete(body) {
  if (body === null || body === undefined || (isPlainObject(body) && Object.keys(body).length === 0)) return null;
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["version", "scope", "occurrenceOn"]);
  const version = readVersion(body);
  const { scope, occurrenceOn } = readScope(body);
  if (scope === null) throw invalid(["scope"]);
  return { version, scope, occurrenceOn };
}

// 달력 읽기: ?from=YYYY-MM-DD&to=YYYY-MM-DD(둘 다 필수, from ≤ to, 1 ~ 42일).
export function parseCalendarQuery(params) {
  const from = params.get("from");
  const to = params.get("to");
  if (!isCalendarDate(from)) throw invalid(["from"]);
  if (!isCalendarDate(to) || to < from) throw invalid(["to"]);
  const days = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000 + 1;
  if (days > CALENDAR_RANGE_MAX_DAYS) throw invalid(["to"]);
  return { from, to };
}

// 휴지통(설계서 8.7절, 0007). 목록: ?cursor=&limit=(기본 50, 최대 50). 커서는 (지운 시각, 묶음 id).
export const TRASH_LIST_LIMIT_DEFAULT = 50;
export const TRASH_PURGE_CONFIRM = "영구 삭제";

export function parseTrashQuery(params) {
  const limitText = params.get("limit");
  return {
    cursor: decodeCursor(params.get("cursor")),
    limit: limitText === null || limitText === "" ? TRASH_LIST_LIMIT_DEFAULT : parseLimit(limitText),
  };
}

// 즉시 영구 삭제 확인: 본문은 { confirm: "영구 삭제" } 하나. 모르는 칸은 400 VALIDATION_FAILED, 글자가 없거나 다르면 400 CONFIRMATION_MISMATCH.
export function parseTrashPurge(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["confirm"]);
  if (typeof body.confirm !== "string" || body.confirm.trim() !== TRASH_PURGE_CONFIRM) {
    throw new WorkApiError("CONFIRMATION_MISMATCH", "확인 글자가 '영구 삭제'와 다릅니다.", 400);
  }
}

// 파일(사진, 단계 2 바로 찍기 F-a). 손님 사진(property_photo·other)과 계약서 사본(contract_copy, 단계 4 K-a)을 연다.
// 나머지 종류는 그 기능 PR에서 연다(0001 CHECK는 그대로).
export const FILE_KINDS_OPEN = Object.freeze(["property_photo", "other", "contract_copy"]);
export const FILE_KINDS_NOT_READY = Object.freeze(["registry", "recording", "document"]);
// 주인 규칙(사용자 2026-11-23 09:37:40 "거래에 붙임"): 계약서 사본은 거래에만, 손님 사진은 손님에게만 붙인다.
export const FILE_KINDS_DEAL_OWNED = Object.freeze(["contract_copy"]);
// 한 거래에 붙이는 계약서 사본 장수(본문 + 특약 + 확인설명서, 대장 2026-11-23).
export const FILE_CONTRACT_COPY_MAX_PER_DEAL = 10;
// 가림 확인(설계서 9.3절): 사람이 주민등록번호를 가렸다고 확인한 올리기만 받는다. 값은 정확히 "rrn=1".
export const FILE_MASK_CONFIRMED = "rrn=1";
export const FILE_PHOTO_MIME_TYPES = Object.freeze(["image/jpeg", "image/webp"]);
// 미리보기는 WebP·JPEG 둘 다 받는다(iPhone Safari canvas는 WebP를 만들지 못해 JPEG로 보냄, 대장 2026-11-22 날개-4 지적).
export const FILE_THUMB_MIME_TYPES = Object.freeze(["image/webp", "image/jpeg"]);
export const FILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024; // Q-1(사용자 2026-11-22 15:23:20): 긴 변 4096px로 다시 저장, 한 장 10MB까지
export const FILE_THUMB_MAX_BYTES = 256 * 1024; // Q-2 미리보기 사본(긴 변 480px)
export const FILE_CAPTION_MAX = 200;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/iu;
const CONTENT_LENGTH_PATTERN = /^\d{1,12}$/u;

export function fileMediaType(headers) {
  return (headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function unsupportedMedia() {
  return new WorkApiError("UNSUPPORTED_MEDIA_TYPE", "허용하지 않는 파일 형식입니다.", 415);
}

function tooLarge() {
  return new WorkApiError("PAYLOAD_TOO_LARGE", "파일이 너무 크거나 크기를 알 수 없습니다.", 413);
}

// Content-Length: 없으면 본문을 읽지 않고 413(한도를 미리 알 수 없음, 대장 2026-11-22), 한도를 넘어도 413, 0·숫자 아님은 400.
function readContentLength(headers, max) {
  const text = headers.get("Content-Length");
  if (text === null || text.trim() === "") throw tooLarge();
  if (!CONTENT_LENGTH_PATTERN.test(text.trim())) throw invalid(["Content-Length"]);
  const length = Number(text.trim());
  if (length > max) throw tooLarge();
  if (length < 1) throw invalid(["Content-Length"]);
  return length;
}

function readSha256(headers) {
  const text = (headers.get("X-Work-File-Sha256") ?? "").trim();
  if (!SHA256_HEX_PATTERN.test(text)) throw invalid(["X-Work-File-Sha256"]);
  return text.toLowerCase();
}

// 사진 올리기 헤더(설계서 9.3절). 순서: 본문 종류(415) → 파일 종류(400) → 길이(413·400) → SHA-256 → 주인 → 가림 확인.
// 주인: 손님 사진은 customer:{uuid}만, 계약서 사본은 deal:{uuid}만(종류와 주인이 어긋나면 400).
// 가림 확인: 계약서 사본은 X-Work-Masked: rrn=1이 없으면 400 MASK_CONFIRMATION_REQUIRED. 손님 사진에 이 헤더가 오면 무시한다.
// 원래 파일 이름은 받지 않는다(헤더·본문 어디에도 없음).
export function parseFileUploadHeaders(headers) {
  const mimeType = fileMediaType(headers);
  if (!FILE_PHOTO_MIME_TYPES.includes(mimeType)) throw unsupportedMedia();
  const kind = (headers.get("X-Work-File-Kind") ?? "").trim();
  if (FILE_KINDS_NOT_READY.includes(kind)) {
    throw new WorkApiError("FILE_KIND_NOT_READY", "이 종류의 파일은 아직 올릴 수 없습니다.", 400);
  }
  if (!FILE_KINDS_OPEN.includes(kind)) throw invalid(["X-Work-File-Kind"]);
  const length = readContentLength(headers, FILE_PHOTO_MAX_BYTES);
  const sha256 = readSha256(headers);
  const owner = (headers.get("X-Work-Owner") ?? "").trim();
  const dealOwned = FILE_KINDS_DEAL_OWNED.includes(kind);
  const prefix = dealOwned ? "deal:" : "customer:";
  const ownerId = owner.startsWith(prefix) ? owner.slice(prefix.length) : null;
  if (!isUuid(ownerId)) throw invalid(["X-Work-Owner"]);
  if (dealOwned && (headers.get("X-Work-Masked") ?? "").trim() !== FILE_MASK_CONFIRMED) {
    throw new WorkApiError("MASK_CONFIRMATION_REQUIRED", "주민등록번호를 가렸는지 확인한 뒤에 올릴 수 있습니다.", 400);
  }
  return { mimeType, kind, length, sha256, customerId: dealOwned ? null : ownerId, dealId: dealOwned ? ownerId : null, rrnMasked: dealOwned ? 1 : 0 };
}

// 미리보기 올리기 헤더(Q-2): WebP·JPEG, 256KB 이하, SHA-256.
export function parseThumbUploadHeaders(headers) {
  const mimeType = fileMediaType(headers);
  if (!FILE_THUMB_MIME_TYPES.includes(mimeType)) throw unsupportedMedia();
  const length = readContentLength(headers, FILE_THUMB_MAX_BYTES);
  return { mimeType, length, sha256: readSha256(headers) };
}

// 설명 고치기: 본문은 { caption } 하나(0 ~ 200자, 한 줄로 정리). 주민번호 꼴이 있으면 가리지 않고 400(사진 설명에는 받지 않음, T2-137h).
// 주민번호 찾기는 메모와 같은 함수(maskResidentNumbers)를 쓴다.
export function parseFilePatch(body) {
  if (!isPlainObject(body)) throw invalid(["body"]);
  rejectUnknown(body, ["caption"]);
  if (typeof body.caption !== "string") throw invalid(["caption"]);
  const caption = cleanSingleLine(body.caption, Number.POSITIVE_INFINITY);
  if (caption.length > FILE_CAPTION_MAX) throw invalid(["caption"]);
  if (maskResidentNumbers(caption).count > 0) throw invalid(["caption"]);
  return { caption };
}
