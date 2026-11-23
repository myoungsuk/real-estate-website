// 단계 4 계약서 AI 결과 비교·확정 규칙(설계서 14.3절, 2026-11-23 대장 결정 G11·G12·G18). 화면(비교표)과 서버(/confirm)가 이 파일 하나를 같이 쓴다.
// - 거래에 넣을 수 있는 칸은 계약일·중도금 날짜들·잔금일과 거래 종류에 맞는 금액뿐이다(계약금·중도금·잔금 금액, 물건 표시, 거래 종류는 보기만).
// - 칸 상태: same(두 결과가 같은 값) · different(둘 다 값이 있는데 다름) · one_side(한쪽만 값, 또는 한 작업만 결과가 있음) · both_empty(둘 다 없음).
//   different·one_side 칸은 사람이 apply(넣음) 또는 keep(지금 거래 값 그대로) 가운데 하나를 골라야 확정된다.
// - 중도금은 날짜 배열 하나를 한 칸으로 다룬다. 두 결과의 길이가 다르면 순서대로 짝짓고(G11), 짝이 없는 차는 그 칸을 다름으로 본다.
// 결과(result)는 contract-extract.mjs validateContractResult()를 통과한 snake_case 객체이거나, 결과가 없는 작업이면 null이다.

export const CONFIRM_DATE_FIELDS = Object.freeze(["contractDate", "middlePayments", "balanceDate"]);
export const CONFIRM_AMOUNT_FIELDS = Object.freeze(["priceWon", "depositWon", "monthlyRentWon"]);
export const CONFIRM_FIELDS = Object.freeze([...CONFIRM_DATE_FIELDS, ...CONFIRM_AMOUNT_FIELDS]);
// 거래 종류마다 넣을 수 있는 금액 칸(worker/work-input.mjs의 거래 입력 규칙과 같아야 한다. 시험이 대조한다).
export const CONFIRM_AMOUNT_FIELDS_BY_TYPE = Object.freeze({
  sale: Object.freeze(["priceWon"]),
  exchange: Object.freeze(["priceWon"]),
  jeonse: Object.freeze(["depositWon"]),
  monthly_rent: Object.freeze(["depositWon", "monthlyRentWon"]),
});
// 화면에 보여 주기만 하는 칸(거래에 쓰지 않음).
export const REFERENCE_FIELDS = Object.freeze(["documentKind", "dealType", "downPaymentDate", "downPaymentWon", "middlePaymentWons", "balanceWon", "propertyText"]);
export const CONFIRM_MIDDLE_PAYMENTS_MAX = 4;
export const NEEDS_DECISION = Object.freeze(["different", "one_side"]);

// 거래 종류에 맞는 확정 칸(순서 고정). 모르는 종류면 날짜 칸만.
export function confirmFieldsFor(dealType) {
  return [...CONFIRM_DATE_FIELDS, ...(CONFIRM_AMOUNT_FIELDS_BY_TYPE[dealType] ?? [])];
}

// 결과 하나 → 비교할 값(camelCase). 중도금은 날짜 배열(값이 없는 차는 null로 둔다).
export function contractValues(result) {
  if (!result) return null;
  return {
    contractDate: result.contract_date.value,
    middlePayments: result.middle_payments.map((payment) => payment.date.value),
    balanceDate: result.balance.date.value,
    priceWon: result.price_won.value,
    depositWon: result.deposit_won.value,
    monthlyRentWon: result.monthly_rent_won.value,
    documentKind: result.document_kind,
    dealType: result.deal_type,
    downPaymentDate: result.down_payment.date.value,
    downPaymentWon: result.down_payment.amount.value,
    middlePaymentWons: result.middle_payments.map((payment) => payment.amount.value),
    balanceWon: result.balance.amount.value,
    propertyText: result.property_text.value,
  };
}

const isEmpty = (value) => value === null || value === undefined || (Array.isArray(value) && value.length === 0);

export function sameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => item === b[index]);
  }
  return a === b;
}

// 한 칸의 상태. 한 작업만 결과가 있으면(firstValues·secondValues 가운데 null) 값이 있든 없든 one_side다(사람이 봐야 함).
function fieldStatus(field, firstValues, secondValues) {
  if (!firstValues || !secondValues) return "one_side";
  const a = firstValues[field];
  const b = secondValues[field];
  if (isEmpty(a) && isEmpty(b)) return "both_empty";
  if (isEmpty(a) || isEmpty(b)) return "one_side";
  return sameValue(a, b) ? "same" : "different";
}

// 두 결과를 견준다. first·second: 1·2회째 결과(없으면 null, 둘 다 null이면 비교할 것이 없음).
// 돌려주는 값: { fields: [{ field, status, first, second }](확정 칸, 거래 종류 순서), reference: [같은 꼴](보기만, 거래 종류에 안 맞는 금액 포함) }
export function compareContractResults(first, second, dealType) {
  const firstValues = contractValues(first);
  const secondValues = contractValues(second);
  const row = (field) => ({
    field,
    status: fieldStatus(field, firstValues, secondValues),
    first: firstValues ? firstValues[field] : null,
    second: secondValues ? secondValues[field] : null,
  });
  const fields = confirmFieldsFor(dealType);
  const otherAmounts = CONFIRM_AMOUNT_FIELDS.filter((field) => !fields.includes(field));
  return { fields: fields.map(row), reference: [...REFERENCE_FIELDS, ...otherAmounts].map(row) };
}

// 사람이 고르지 않은 칸(different·one_side인데 apply에도 keep에도 없음)의 이름. apply: { 칸: 값 }, keep: [칸 이름].
export function missingDecisions(comparison, apply, keep) {
  const chosen = new Set([...Object.keys(apply ?? {}), ...(keep ?? [])]);
  return comparison.fields.filter((item) => NEEDS_DECISION.includes(item.status) && !chosen.has(item.field)).map((item) => item.field);
}
