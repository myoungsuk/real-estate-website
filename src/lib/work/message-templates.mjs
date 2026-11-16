// 업무 도구 단계 0 안내 문자 틀(설계서 6.9절). 문구는 이 사무소용으로 새로 쓴 것이다.
// 손님 이름·전화번호·주민등록번호·계좌 비밀번호 변수는 두지 않는다.
import { describeCalendarDate, parseCalendarDate } from "./legal-dates.mjs";
import { cleanMultiLine, cleanSingleLine, formatKoreanWon } from "./work-format.mjs";

export const PAYMENT_TIMING_NOTICE = "중개보수 지급 시기는 약정에 따르며, 약정이 없으면 거래대금 지급이 완료된 날입니다(공인중개사법 시행령 제27조의2).";

export const MESSAGE_TEMPLATES = Object.freeze({
  provisional: { label: "가계약 안내", depositLabel: "가계약금", depositPlaceholder: "[가계약금]", usesAccount: true },
  agreedDeposit: { label: "약정금(계약금 일부) 입금 안내", depositLabel: "약정금", depositPlaceholder: "[약정금]", usesAccount: true },
  contractDay: { label: "계약일 안내", depositLabel: null, depositPlaceholder: null, usesAccount: false },
});

export const MESSAGE_VARIANTS = Object.freeze({ basic: "기본형", short: "짧은 형" });

export const MESSAGE_DEAL_TYPES = Object.freeze({ sale: "매매", jeonse: "전세", monthly_rent: "월세" });

// 화면에서 받는 변수 목록(설계서 6.9절 표). 시험이 이 목록에 개인 식별 변수가 없는지 확인한다.
export const MESSAGE_VARIABLES = Object.freeze([
  "property",
  "dealType",
  "amountWon",
  "monthlyRentWon",
  "depositAmountWon",
  "depositDeadline",
  "bank",
  "accountNumber",
  "accountHolder",
  "contractDate",
  "specialMemo",
]);

export const PLACEHOLDERS = Object.freeze({
  property: "[물건 표시]",
  dealType: "[거래 종류]",
  amount: "[거래 금액]",
  depositDeadline: "[입금 기한]",
  account: "[입금 계좌]",
  bank: "[은행]",
  accountNumber: "[계좌번호]",
  accountHolder: "[예금주]",
  contractDate: "[계약 예정일]",
  refundCondition: "[반환 조건 확인]",
});

function positiveAmount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function formatDealAmount(values) {
  const amount = positiveAmount(values.amountWon);
  if (values.dealType === "monthly_rent") {
    const rent = positiveAmount(values.monthlyRentWon);
    if (amount === null && rent === null) return PLACEHOLDERS.amount;
    return `보증금 ${amount === null ? "[보증금]" : formatKoreanWon(amount)} / 월세 ${rent === null ? "[월세]" : formatKoreanWon(rent)}`;
  }
  if (amount === null) return PLACEHOLDERS.amount;
  return values.dealType === "jeonse" ? `보증금 ${formatKoreanWon(amount)}` : formatKoreanWon(amount);
}

function formatContractDate(value) {
  if (!parseCalendarDate(value)) return PLACEHOLDERS.contractDate;
  const { label } = describeCalendarDate(value);
  return label;
}

function formatAccount(values) {
  const bank = cleanSingleLine(values.bank, 20);
  const accountNumber = cleanSingleLine(values.accountNumber, 30).replace(/[^\d-]/gu, "");
  const holder = cleanSingleLine(values.accountHolder, 20);
  if (!bank && !accountNumber && !holder) return PLACEHOLDERS.account;
  return `${bank || PLACEHOLDERS.bank} ${accountNumber || PLACEHOLDERS.accountNumber} (예금주 ${holder || PLACEHOLDERS.accountHolder})`;
}

function readValues(values, template, office) {
  const deposit = positiveAmount(values.depositAmountWon);
  return {
    office: cleanSingleLine(office?.brandName, 40),
    officePhone: cleanSingleLine(office?.mobile, 20),
    property: cleanSingleLine(values.property, 40) || PLACEHOLDERS.property,
    dealType: MESSAGE_DEAL_TYPES[values.dealType] ?? PLACEHOLDERS.dealType,
    amount: formatDealAmount(values),
    deposit: deposit === null ? template.depositPlaceholder : formatKoreanWon(deposit),
    depositDeadline: cleanSingleLine(values.depositDeadline, 40) || PLACEHOLDERS.depositDeadline,
    account: formatAccount(values),
    contractDate: formatContractDate(values.contractDate),
    memo: cleanMultiLine(values.specialMemo, 300),
  };
}

function memoLines(memo, prefix) {
  if (!memo) return [];
  const [first, ...rest] = memo.split("\n");
  return [`${prefix}${first}`, ...rest.map((line) => `  ${line}`)];
}

function buildProvisional(v, variant) {
  if (variant === "short") {
    return [
      `[${v.office}] ${v.property} ${v.dealType} 가계약 안내(거래 금액 ${v.amount})`,
      `가계약금 ${v.deposit}, ${v.depositDeadline}까지 ${v.account}로 입금 부탁드립니다.`,
      `본계약 예정일 ${v.contractDate} / 반환 조건 ${PLACEHOLDERS.refundCondition}`,
      ...memoLines(v.memo, "메모: "),
      `입금 전 예금주가 등기사항증명서의 소유자와 같은지 확인해 주세요. 문의 ${v.officePhone}`,
    ];
  }
  return [
    `안녕하세요, ${v.office}입니다.`,
    `${v.property} ${v.dealType} 가계약 관련 안내드립니다.`,
    "",
    `- 거래 금액: ${v.amount}`,
    `- 가계약금: ${v.deposit} (${v.depositDeadline}까지)`,
    `- 입금 계좌: ${v.account}`,
    `- 본계약 예정일: ${v.contractDate}`,
    `- 가계약금 반환 조건: ${PLACEHOLDERS.refundCondition}`,
    ...memoLines(v.memo, "- 특약 메모: "),
    "",
    "입금 전에 예금주가 등기사항증명서의 소유자와 같은지 한 번 더 확인해 주세요.",
    `문의: ${v.officePhone}`,
  ];
}

function buildAgreedDeposit(v, variant) {
  if (variant === "short") {
    return [
      `[${v.office}] ${v.property} ${v.dealType} 약정금 입금 안내(거래 금액 ${v.amount})`,
      `약정금 ${v.deposit}, ${v.depositDeadline}까지 ${v.account}로 입금 부탁드립니다.`,
      `계약 예정일 ${v.contractDate} / 반환 조건 ${PLACEHOLDERS.refundCondition}`,
      ...memoLines(v.memo, "메모: "),
      `입금 뒤 알려 주시면 확인해 드립니다. 문의 ${v.officePhone}`,
    ];
  }
  return [
    `안녕하세요, ${v.office}입니다.`,
    `${v.property} ${v.dealType} 계약금 가운데 약정금 입금을 안내드립니다.`,
    "",
    `- 거래 금액: ${v.amount}`,
    `- 약정금: ${v.deposit} (${v.depositDeadline}까지)`,
    `- 입금 계좌: ${v.account}`,
    `- 계약 예정일: ${v.contractDate}`,
    `- 약정금 반환 조건: ${PLACEHOLDERS.refundCondition}`,
    ...memoLines(v.memo, "- 특약 메모: "),
    "",
    "입금 전에 예금주가 등기사항증명서의 소유자와 같은지 한 번 더 확인해 주세요.",
    "입금하신 뒤 알려 주시면 확인해 드리겠습니다.",
    `문의: ${v.officePhone}`,
  ];
}

function buildContractDay(v, variant) {
  if (variant === "short") {
    return [
      `[${v.office}] ${v.property} ${v.dealType} 계약일 안내`,
      `계약 예정일 ${v.contractDate} / 거래 금액 ${v.amount}`,
      ...memoLines(v.memo, "메모: "),
      `신분증을 챙겨 주세요. 일정 변경은 미리 연락 부탁드립니다. 문의 ${v.officePhone}`,
    ];
  }
  return [
    `안녕하세요, ${v.office}입니다.`,
    `${v.property} ${v.dealType} 계약 일정을 안내드립니다.`,
    "",
    `- 계약 예정일: ${v.contractDate}`,
    `- 거래 금액: ${v.amount}`,
    "- 준비물: 신분증, [그 밖의 준비물 확인]",
    ...memoLines(v.memo, "- 특약 메모: "),
    "",
    "계약 당일 등기사항증명서로 권리관계를 다시 확인해 드립니다.",
    "일정 변경이 필요하시면 미리 연락 부탁드립니다.",
    `문의: ${v.officePhone}`,
  ];
}

const BUILDERS = Object.freeze({
  provisional: buildProvisional,
  agreedDeposit: buildAgreedDeposit,
  contractDay: buildContractDay,
});

// 한글 등 ASCII 밖 글자를 2바이트로 셈한 대략값. 통신사 기준이 달라 표시만 하고 막지 않는다.
export function estimateMessageBytes(text) {
  let bytes = 0;
  for (const character of text) bytes += character.codePointAt(0) <= 0x7f ? 1 : 2;
  return bytes;
}

export function countMessageCharacters(text) {
  return [...text].length;
}

/**
 * @param {{
 *   templateId: string,
 *   variant?: string,
 *   values?: Record<string, unknown>,
 *   office?: { brandName?: string, mobile?: string } | null,
 * }} options
 */
export function buildWorkMessage({ templateId, variant = "basic", values = {}, office = null }) {
  const template = MESSAGE_TEMPLATES[templateId];
  const build = BUILDERS[templateId];
  if (!template || !build) throw new Error(`알 수 없는 문자 틀입니다: ${templateId}`);
  if (!Object.hasOwn(MESSAGE_VARIANTS, variant)) throw new Error(`알 수 없는 문자 형태입니다: ${variant}`);
  const text = build(readValues(values, template, office), variant).join("\n");
  return {
    text,
    characterCount: countMessageCharacters(text),
    byteEstimate: estimateMessageBytes(text),
  };
}

// 받는 사람은 비워 둔다. iPhone은 "&body=" 형식을 요구하는 경우가 있어 두 형식을 만든다(실기기 확인 필요).
export function buildSmsHref(text, style = "query") {
  const body = encodeURIComponent(text);
  return style === "ampersand" ? `sms:&body=${body}` : `sms:?body=${body}`;
}
