// 업무 도구 단계 0 보강: 중개보수 영수증(보드 45번 A, 운영자 결정 2026-11-20 "계산기·문자 보강", "늘 넣기").
// 중개보수 계산 결과와 화면 입력(받는 분·발급일·물건 표시)으로 문자 글·그림·A4가 함께 쓰는 항목 목록을 만든다.
// 입력값은 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다(화면 메모리만). 받는 분은 비워 두면 손으로 적을 빈칸으로 남긴다.
import { FEE_DEAL_TYPES, PROPERTY_KINDS } from "./brokerage-fee.mjs";
import { parseCalendarDate } from "./legal-dates.mjs";
import { cleanSingleLine, formatKoreanWon, formatRateBp, formatWon } from "./work-format.mjs";

export const RECEIPT_TITLE = "중개보수 영수증";
export const RECEIPT_NOT_TAX_NOTICE = "이 영수증은 세금계산서·현금영수증이 아닙니다.";
export const RECEIPT_RECEIVED_SENTENCE = "위 금액을 중개보수로 받았습니다.";
export const RECEIPT_PAYER_PLACEHOLDER = "[받는 분]";
export const RECEIPT_LIMITS = Object.freeze({ payer: 30, property: 60 });

// 영수증에 필요 없는 개인 식별 번호. 받는 분·물건 표시 칸에 들어오면 만들지 않는다.
const RESIDENT_NUMBER = /\d{6}\s*-?\s*[1-8]\d{6}/u;
const MOBILE_NUMBER = /01[016789]\s*-?\s*\d{3,4}\s*-?\s*\d{4}/u;
// 호수(scripts/content-validation.mjs와 같은 꼴). 저장하지 않아도 단계 0 규칙("손님 이름·호수는 넣지 마세요")을 따른다.
const UNIT_NUMBER = /(?<!\d)\d{1,4}\s*호(?!선|점|기|차)/u;

function receiptError(code, message) {
  return { ok: /** @type {const} */ (false), error: { code, message } };
}

function formatIssuedOn(value) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

// 돌려주는 값: { ok: true, receipt } 또는 { ok: false, error }.
// receipt.rows는 그림·A4가 그대로 쓰는 [라벨, 값] 목록이고, receipt.text는 문자로 보낼 글이다.
export function buildFeeReceipt(result, input, office) {
  if (!result?.ok) return receiptError("RESULT_MISSING", "먼저 중개보수를 계산해 주세요.");
  const payer = cleanSingleLine(input?.payer, RECEIPT_LIMITS.payer);
  const property = cleanSingleLine(input?.property, RECEIPT_LIMITS.property);
  const issuedOn = typeof input?.issuedOn === "string" ? input.issuedOn : "";
  if (!parseCalendarDate(issuedOn)) return receiptError("ISSUED_ON_INVALID", "발급일을 골라 주세요.");
  for (const [label, value] of [["받는 분", payer], ["물건 표시", property]]) {
    if (RESIDENT_NUMBER.test(value) || MOBILE_NUMBER.test(value) || UNIT_NUMBER.test(value)) {
      return receiptError("PERSONAL_NUMBER", `${label} 칸에는 주민등록번호·휴대폰 번호·호수를 넣지 않습니다.`);
    }
  }

  const dealLabel = `${PROPERTY_KINDS[result.propertyKind] ?? ""} ${FEE_DEAL_TYPES[result.dealType] ?? ""}`.trim();
  const feeLabel = result.agreed ? `${formatWon(result.feeWon)} (협의 요율 ${formatRateBp(result.agreed.rateBp)})` : formatWon(result.feeWon);
  /** @type {[string, string][]} */
  const rows = [
    ["받는 분", payer],
    ["발급일", formatIssuedOn(issuedOn)],
    ["물건", property ? `${property} (${dealLabel})` : dealLabel],
    ["거래금액", formatKoreanWon(result.amountWon)],
    ["중개보수", feeLabel],
  ];
  if (result.vatWon !== null) rows.push(["부가세(10%)", formatWon(result.vatWon)]);
  rows.push(["합계", formatWon(result.totalWon)]);

  /** @type {[string, string][]} */
  const officeRows = [
    ["상호", office.legalName],
    ["대표", office.representative],
    ["주소", office.address],
    ["중개사무소 등록번호", office.registrationNumber],
    ["사업자등록번호", office.businessNumber],
    ["연락처", office.mobile],
  ];

  const text = [
    `[${RECEIPT_TITLE}]`,
    ...rows.map(([label, value]) => `- ${label}: ${label === "받는 분" && !value ? RECEIPT_PAYER_PLACEHOLDER : value}`),
    RECEIPT_RECEIVED_SENTENCE,
    "",
    ...officeRows.map(([label, value]) => `${label}: ${value}`),
    "",
    RECEIPT_NOT_TAX_NOTICE,
  ].join("\n");

  return {
    ok: /** @type {const} */ (true),
    receipt: { title: RECEIPT_TITLE, rows, officeRows, received: RECEIPT_RECEIVED_SENTENCE, notice: RECEIPT_NOT_TAX_NOTICE, text },
  };
}
