// 계약서 사진 → 날짜·금액 읽기(단계 4, 설계서 14.3·14.4절)의 순수 부품. 서버(worker/work-ai-jobs.mjs)가 쓰고, 비교·확정(다음 PR)과 화면이 같이 쓴다.
// - contractResultSchema(runIndex): OpenAI 구조화 출력(strict)에 보내는 스키마. 모양만 정한다($defs·$ref, 글·정수의 null 합집합, anyOf).
//   2026-11-24 운영에서 OpenAI가 invalid_json_schema(text.format.schema)로 거절해, 값 조건(pattern·minimum·maximum·minItems·maxItems·maxLength)은
//   보내지 않고 아래 재검사에서만 보며, null이 될 수 있는 배열(box)은 type 배열 대신 anyOf로 쓴다.
// - 두 번 읽기의 2회째(runIndex 2)는 칸 순서를 바꾼 스키마·지시문을 쓴다(같은 식으로 같이 틀릴 가능성을 줄이려는 것, DEC-WT-17).
// - validateContractResult(value): OpenAI strict에만 기대지 않고 14.4절 전체(글자 수·실제 날짜·금액 범위 포함)를 다시 검사한다.
//   통과하지 못하면 { ok: false }(부르는 쪽이 AI_RESULT_INVALID로 적고 원문은 저장하지 않는다).
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

const FIELD_GUIDE = Object.freeze({
  document_kind: "document_kind: 매매 계약서는 sale_contract, 임대차(전세·월세) 계약서는 lease_contract, 그 밖이거나 알 수 없으면 unknown.",
  deal_type: "deal_type: sale(매매)·exchange(교환)·jeonse(전세)·monthly_rent(월세). 알 수 없으면 null.",
  contract_date: "contract_date: 계약을 맺은 날(계약서 끝의 작성일).",
  price_won: "price_won: 매매대금. 임대차 계약서면 null.",
  deposit_won: "deposit_won: 보증금. 매매 계약서면 null.",
  monthly_rent_won: "monthly_rent_won: 월 차임. 월세가 아니면 null.",
  down_payment: "down_payment: 계약금의 금액(amount)과 치르는 날(date).",
  middle_payments: "middle_payments: 중도금을 차수 순서대로 최대 4개. 없으면 빈 배열.",
  balance: "balance: 잔금의 금액(amount)과 치르는 날(date).",
  property_text: "property_text: 계약서의 부동산 표시(소재지)를 적힌 대로 120자 안으로.",
  warnings: "warnings: 사람이 꼭 다시 봐야 할 점만 짧게(각 200자 이하, 최대 10개). 흐림·가림·고친 흔적·한글 금액과 숫자 금액이 다름 등.",
});

export function contractInstructions(runIndex) {
  const order = contractFieldOrder(runIndex);
  return [
    "너는 한국 부동산 계약서 사진에서 날짜와 금액만 뽑는 도우미다. 결과는 사람이 사진과 대조해 확인한 뒤에만 저장한다.",
    "사진에 적힌 글자만 옮긴다. 보이지 않거나 읽을 수 없으면 value를 null로 둔다. 추측하거나 계산해서 채우지 않는다. 신고 기한 같은 날짜를 만들어 내지 않는다.",
    "사람 이름·주민등록번호·전화번호·계좌번호는 어디에도 쓰지 않는다.",
    "날짜는 YYYY-MM-DD, 금액은 원 단위 정수로 쓴다(예: 금 삼억오천만원정 → 350000000). 한글 금액과 숫자 금액이 다르면 한글 금액을 쓰고 warnings에 적는다.",
    "evidence.quote에는 그 값을 읽은 자리의 글자를 120자 안으로 옮긴다. evidence.page는 그 사진의 쪽 번호(1부터), box는 그 자리의 [왼쪽, 위, 오른쪽, 아래] 비율(0 ~ 1)이고 모르면 null이다. value가 null이면 quote는 빈 글자, page는 1, box는 null로 둔다.",
    "아래 순서대로 칸을 채운다.",
    ...order.map((key, index) => `${index + 1}. ${FIELD_GUIDE[key]}`),
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
function text(value, max) {
  if (typeof value !== "string" || value.length > max) fail();
  return oneLine(value);
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

// 돌려주는 값: { ok: true, result }(칸 순서를 CONTRACT_FIELD_ORDER로 맞춘 새 객체) 또는 { ok: false }.
export function validateContractResult(value) {
  try {
    exactKeys(value, CONTRACT_FIELD_ORDER);
    if (!CONTRACT_DOCUMENT_KINDS.includes(value.document_kind)) fail();
    if (value.deal_type !== null && !CONTRACT_DEAL_TYPES.includes(value.deal_type)) fail();
    if (!Array.isArray(value.middle_payments) || value.middle_payments.length > CONTRACT_MIDDLE_PAYMENTS_MAX) fail();
    if (!Array.isArray(value.warnings) || value.warnings.length > CONTRACT_WARNINGS_MAX_ITEMS) fail();
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
        middle_payments: value.middle_payments.map(payment),
        balance: payment(value.balance),
        property_text: textField(value.property_text),
        warnings: value.warnings.map((item) => text(item, CONTRACT_WARNING_MAX)),
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
