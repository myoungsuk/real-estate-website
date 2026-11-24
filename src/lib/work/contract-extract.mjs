// 계약서 사진 → 날짜·금액 읽기(단계 4, 설계서 14.3·14.4절)의 순수 부품. 서버(worker/work-ai-jobs.mjs)가 쓰고, 비교·확정(다음 PR)과 화면이 같이 쓴다.
// - contractResultSchema(runIndex): OpenAI 구조화 출력(strict)에 보내는 스키마. 모양만 정한다($defs·$ref, 글·정수의 null 합집합, anyOf).
//   2026-11-24 운영에서 OpenAI가 invalid_json_schema(text.format.schema)로 거절해, 값 조건(pattern·minimum·maximum·minItems·maxItems·maxLength)은
//   보내지 않고 아래 재검사에서만 보며, null이 될 수 있는 배열(box)은 type 배열 대신 anyOf로 쓴다.
// - 두 번 읽기의 2회째(runIndex 2)는 칸 순서를 바꾼 스키마·지시문을 쓴다(같은 식으로 같이 틀릴 가능성을 줄이려는 것, DEC-WT-17).
//   2026-11-24부터 새 묶음은 한 번 읽기라 runIndex 1만 보낸다. 2회째 꼴은 옛 묶음 기록과 시험을 위해 순수 함수로만 남긴다.
// - validateContractResult(value): OpenAI strict에만 기대지 않고 14.4절 전체(실제 날짜·금액 범위·쪽 번호·자리 값 포함)를 다시 검사한다. 중도금이 4회를 넘으면 거절하지 않고 4자리를 못 읽은 값으로 비운다.
//   통과하지 못하면 { ok: false }(부르는 쪽이 AI_RESULT_INVALID로 적고 원문은 저장하지 않는다).
//   2026-11-24부터 글자 칸(근거 문구·물건 표시·경고)의 글자 수와 경고 개수는 거절하지 않고 잘라 받는다(빈 경고는 버림).
// - 사람 이름은 스키마에 없다(일정에 필요 없음).
import { MAX_AMOUNT_WON_EXCLUSIVE } from "./work-format.mjs";

export const CONTRACT_DOCUMENT_KINDS = Object.freeze(["sale_contract", "lease_contract", "unknown"]);
export const CONTRACT_DEAL_TYPES = Object.freeze(["sale", "exchange", "jeonse", "monthly_rent"]);
export const CONTRACT_QUOTE_MAX = 120;
export const CONTRACT_TEXT_MAX = 120;
export const CONTRACT_WARNING_MAX = 200;
export const CONTRACT_WARNINGS_MAX_ITEMS = 10;
export const CONTRACT_MIDDLE_PAYMENTS_MAX = 4;
export const CONTRACT_PAGE_MAX = 100;

// 저장·비교에 쓰는 칸 순서(1회째 스키마 순서와 같다).
export const CONTRACT_FIELD_ORDER = Object.freeze([
  "document_kind", "deal_type", "contract_date", "price_won", "deposit_won", "monthly_rent_won",
  "down_payment", "middle_payments", "balance", "property_text", "warnings",
]);
// 2회째: warnings만 끝에 두고 나머지를 거꾸로.
const SECOND_FIELD_ORDER = Object.freeze([...CONTRACT_FIELD_ORDER.slice(0, -1)].reverse().concat("warnings"));

export function contractFieldOrder(runIndex) {
  return runIndex === 2 ? SECOND_FIELD_ORDER : CONTRACT_FIELD_ORDER;
}

const field = (value) => ({
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: { value, evidence: { $ref: "#/$defs/evidence" } },
});
const SCHEMA_DEFS = Object.freeze({
  evidence: {
    type: "object",
    additionalProperties: false,
    required: ["page", "quote", "box"],
    properties: {
      page: { type: "integer" },
      quote: { type: "string" },
      box: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] },
    },
  },
  dateField: field({ type: ["string", "null"] }),
  moneyField: field({ type: ["integer", "null"] }),
  textField: field({ type: ["string", "null"] }),
  payment: {
    type: "object",
    additionalProperties: false,
    required: ["amount", "date"],
    properties: { amount: { $ref: "#/$defs/moneyField" }, date: { $ref: "#/$defs/dateField" } },
  },
});
const SCHEMA_PROPERTIES = Object.freeze({
  document_kind: { type: "string", enum: [...CONTRACT_DOCUMENT_KINDS] },
  // 공식 문서 예시는 null 합집합의 enum에 null을 넣지 않는다. 어느 쪽 해석에서도 맞게 anyOf로 쓴다.
  deal_type: { anyOf: [{ type: "string", enum: [...CONTRACT_DEAL_TYPES] }, { type: "null" }] },
  contract_date: { $ref: "#/$defs/dateField" },
  price_won: { $ref: "#/$defs/moneyField" },
  deposit_won: { $ref: "#/$defs/moneyField" },
  monthly_rent_won: { $ref: "#/$defs/moneyField" },
  down_payment: { $ref: "#/$defs/payment" },
  middle_payments: { type: "array", items: { $ref: "#/$defs/payment" } },
  balance: { $ref: "#/$defs/payment" },
  property_text: { $ref: "#/$defs/textField" },
  warnings: { type: "array", items: { type: "string" } },
});

// 구조화 출력은 스키마의 키 순서대로 만들어지므로(공식 문서) 2회째는 properties 순서도 바꾼다.
export function contractResultSchema(runIndex) {
  const order = contractFieldOrder(runIndex);
  return {
    type: "object",
    additionalProperties: false,
    required: [...order],
    properties: Object.fromEntries(order.map((key) => [key, SCHEMA_PROPERTIES[key]])),
    $defs: SCHEMA_DEFS,
  };
}

// 2026-11-24 사용자 결정("AI 호출할 때 제약을 많이 걸수록 성능이 나빠진다", "어 그렇게 해"): 지시문은 할 일과 꼭 지킬 뜻만 4줄로 둔다.
// 칸별 안내·글자 수·개수 상한은 뺐다. 글자 수·경고 개수는 validateContractResult()가 잘라 받고, 중도금 5회 이상은 못 읽은 값으로 비우고 경고를 붙이며, 날짜·금액·쪽 번호·자리 값은 거절한다.
// 남긴 것: 날짜·금액 꼴과 값이 null일 때의 근거 꼴(어기면 묶음 전체가 AI_RESULT_INVALID라 비용만 씀),
// 이름·전화번호·계좌번호(코드는 주민등록번호 꼴만 가림), 한글 금액 우선(코드가 알 수 없음).
// 칸 안내를 뺐으므로 runIndex와 상관없이 같은 글이다(2회째의 다른 순서는 스키마에만 남음).
export function contractInstructions(_runIndex) {
  return [
    "너는 한국 부동산 계약서 사진에서 거래 날짜·금액 칸을 읽어 스키마대로 옮기는 도우미다. 결과는 사람이 사진과 대조해 고른 뒤에만 쓰인다.",
    "사진에 적힌 것만 옮기고, 안 보이거나 확실하지 않은 칸은 추측하거나 계산하지 말고 value를 null로 둔다. 날짜는 YYYY-MM-DD, 금액은 원 단위 정수다.",
    "evidence에는 그 값을 읽은 쪽 번호(page, 1부터)·그 자리의 글자(quote)·자리(box, [왼쪽, 위, 오른쪽, 아래] 0 ~ 1 비율, 모르면 null)를 적고, value가 null이면 page 1·빈 quote·box null로 둔다.",
    "사람 이름·주민등록번호·전화번호·계좌번호는 어디에도 쓰지 않는다. 한글 금액과 숫자 금액이 다르면 한글 금액을 쓰고, 그런 점과 흐림·가림·고친 흔적처럼 사람이 다시 볼 점은 warnings에 적는다.",
  ].join("\n");
}

// ── 재검사 ──

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = () => {
  throw new Error("contract result invalid");
};
function exactKeys(value, keys) {
  if (!isPlainObject(value)) fail();
  const own = Object.keys(value);
  if (own.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) fail();
}
// 줄바꿈·제어 문자는 빈칸으로 바꾼다(한 줄 글로 저장).
const oneLine = (value) => value.replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
// 글자 칸(근거 문구·물건 표시·경고)은 상한을 넘으면 거절하지 않고 상한에서 자른다(2026-11-24, 이모지 같은 두 칸 글자를 반으로 가르지 않음).
// 일정 계산에 쓰는 날짜·금액 값은 자르지 않고 아래에서 그대로 거절한다.
function text(value, max) {
  if (typeof value !== "string") fail();
  const line = oneLine(value);
  if (line.length <= max) return line;
  const code = line.charCodeAt(max - 1);
  return line.slice(0, code >= 0xd800 && code <= 0xdbff ? max - 1 : max).trim();
}

export function isRealDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2200) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function evidence(value) {
  exactKeys(value, ["page", "quote", "box"]);
  if (!Number.isSafeInteger(value.page) || value.page < 1 || value.page > CONTRACT_PAGE_MAX) fail();
  let box = null;
  if (value.box !== null) {
    if (!Array.isArray(value.box) || value.box.length !== 4 || value.box.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1)) fail();
    box = [...value.box];
  }
  return { page: value.page, quote: text(value.quote, CONTRACT_QUOTE_MAX), box };
}
function dateField(value) {
  exactKeys(value, ["value", "evidence"]);
  if (value.value !== null && !isRealDate(value.value)) fail();
  return { value: value.value, evidence: evidence(value.evidence) };
}
function moneyField(value) {
  exactKeys(value, ["value", "evidence"]);
  if (value.value !== null && (!Number.isSafeInteger(value.value) || value.value < 0 || value.value >= MAX_AMOUNT_WON_EXCLUSIVE)) fail();
  return { value: value.value, evidence: evidence(value.evidence) };
}
function textField(value) {
  exactKeys(value, ["value", "evidence"]);
  return { value: value.value === null ? null : text(value.value, CONTRACT_TEXT_MAX), evidence: evidence(value.evidence) };
}
function payment(value) {
  exactKeys(value, ["amount", "date"]);
  return { amount: moneyField(value.amount), date: dateField(value.date) };
}

// 중도금이 CONTRACT_MIDDLE_PAYMENTS_MAX(4)회를 넘게 적힌 계약서(분양권 공급계약은 6회도 흔함, 2026-11-24 날개-2 검수):
// 결과 전체를 버리지 않고 중도금 자리 4개를 남기되 그 날짜·금액을 모두 못 읽은 값(null, 근거 page 1·빈 quote·box null)으로 바꾸고
// 경고 맨 앞에 까닭 한 문장을 둔다. 그러면 결과 고르기 화면은 '못 읽은 차가 있는 중도금'으로 보여 AI 값으로 넣을 수 없고(aiCanApply가 거짓),
// 사람이 사진을 보고 직접 넣는다. 빈 배열 []로 두면 '중도금 없음'으로 넣힐 수 있어 쓰지 않는다. 넘친 차들은 모양(amount·date 칸)만 본다.
export const contractMiddleOverflowWarning = (count) =>
  `중도금이 ${count}회 적혀 있어 거래에 다 넣을 수 없습니다(${CONTRACT_MIDDLE_PAYMENTS_MAX}회까지). 중도금은 사진을 보고 직접 넣어 주세요.`;
const unread = () => ({ value: null, evidence: { page: 1, quote: "", box: null } });
function middlePayments(list) {
  if (list.length <= CONTRACT_MIDDLE_PAYMENTS_MAX) return { payments: list.map(payment), warning: null };
  for (const item of list) {
    exactKeys(item, ["amount", "date"]);
    if (!isPlainObject(item.amount) || !isPlainObject(item.date)) fail();
  }
  return {
    payments: Array.from({ length: CONTRACT_MIDDLE_PAYMENTS_MAX }, () => ({ amount: unread(), date: unread() })),
    warning: contractMiddleOverflowWarning(list.length),
  };
}

// 돌려주는 값: { ok: true, result }(칸 순서를 CONTRACT_FIELD_ORDER로 맞춘 새 객체) 또는 { ok: false }.
export function validateContractResult(value) {
  try {
    exactKeys(value, CONTRACT_FIELD_ORDER);
    if (!CONTRACT_DOCUMENT_KINDS.includes(value.document_kind)) fail();
    if (value.deal_type !== null && !CONTRACT_DEAL_TYPES.includes(value.deal_type)) fail();
    if (!Array.isArray(value.middle_payments) || !Array.isArray(value.warnings)) fail();
    const middles = middlePayments(value.middle_payments);
    const warnings = value.warnings.map((item) => text(item, CONTRACT_WARNING_MAX)).filter(Boolean);
    return {
      ok: true,
      result: {
        document_kind: value.document_kind,
        deal_type: value.deal_type,
        contract_date: dateField(value.contract_date),
        price_won: moneyField(value.price_won),
        deposit_won: moneyField(value.deposit_won),
        monthly_rent_won: moneyField(value.monthly_rent_won),
        down_payment: payment(value.down_payment),
        middle_payments: middles.payments,
        balance: payment(value.balance),
        property_text: textField(value.property_text),
        warnings: [...(middles.warning ? [middles.warning] : []), ...warnings].slice(0, CONTRACT_WARNINGS_MAX_ITEMS),
      },
    };
  } catch {
    return { ok: false };
  }
}

// 재검사를 통과한 결과의 글자 칸(원문 문구·물건 표시·경고)에 가림 함수를 적용한다. mask(text) → { text, count }.
// 가린 뒤 길어지면(구분자 없는 13자리 → 14자) 상한에 맞춰 자른다. 돌려주는 값: { result, count }.
export function maskContractResult(result, mask) {
  let count = 0;
  const apply = (value, max) => {
    const masked = mask(value);
    count += masked.count;
    return masked.text.slice(0, max);
  };
  const ev = (value) => ({ ...value, quote: apply(value.quote, CONTRACT_QUOTE_MAX) });
  const withEvidence = (value) => ({ ...value, evidence: ev(value.evidence) });
  const pay = (value) => ({ amount: withEvidence(value.amount), date: withEvidence(value.date) });
  return {
    result: {
      ...result,
      contract_date: withEvidence(result.contract_date),
      price_won: withEvidence(result.price_won),
      deposit_won: withEvidence(result.deposit_won),
      monthly_rent_won: withEvidence(result.monthly_rent_won),
      down_payment: pay(result.down_payment),
      middle_payments: result.middle_payments.map(pay),
      balance: pay(result.balance),
      property_text: {
        value: result.property_text.value === null ? null : apply(result.property_text.value, CONTRACT_TEXT_MAX),
        evidence: ev(result.property_text.evidence),
      },
      warnings: result.warnings.map((item) => apply(item, CONTRACT_WARNING_MAX)),
    },
    count,
  };
}
