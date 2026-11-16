// 업무 도구 단계 0 공용 입력 검사·표시 함수. 브라우저와 Node 시험에서 같은 코드를 쓴다.

export const MAX_AMOUNT_WON_EXCLUSIVE = 1_000_000_000_000;

export class WorkInputError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "WorkInputError";
    this.code = code;
  }
}

export function groupDigits(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

export function validateWonAmount(amount, { allowZero = false, label = "금액" } = {}) {
  if (!Number.isSafeInteger(amount)) {
    throw new WorkInputError("AMOUNT_INVALID", `${label}에는 원 단위 정수만 입력할 수 있습니다.`);
  }
  if (amount < 0 || (!allowZero && amount === 0)) {
    throw new WorkInputError("AMOUNT_INVALID", `${label}에는 0원보다 큰 금액을 입력해 주세요.`);
  }
  if (amount >= MAX_AMOUNT_WON_EXCLUSIVE) {
    throw new WorkInputError("AMOUNT_TOO_LARGE", `${label}에는 1조 원 미만만 입력할 수 있습니다.`);
  }
  return amount;
}

// 화면 입력 문자열(쉼표·공백 허용)을 원 단위 정수로 바꾼다. 빈 값은 null이다.
export function parseWonInput(value, options = {}) {
  const text = String(value ?? "").replace(/[,\s]/gu, "");
  if (text === "") return null;
  if (!/^\d+$/u.test(text)) {
    throw new WorkInputError("AMOUNT_INVALID", `${options.label ?? "금액"}에는 원 단위 숫자만 입력할 수 있습니다.`);
  }
  return validateWonAmount(Number(text), options);
}

const KOREAN_UNITS = Object.freeze([
  [1_000_000_000_000, "조"],
  [100_000_000, "억"],
  [10_000, "만"],
]);

// 180000000 → "1억 8,000만". 끝에 "원"을 붙이지 않는다.
export function formatKoreanAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) return "";
  if (amount === 0) return "0";
  let rest = amount;
  const parts = [];
  for (const [size, unit] of KOREAN_UNITS) {
    const quotient = (rest - (rest % size)) / size;
    if (quotient > 0) {
      parts.push(`${groupDigits(quotient)}${unit}`);
      rest -= quotient * size;
    }
  }
  if (rest > 0) parts.push(groupDigits(rest));
  return parts.join(" ");
}

// 180000000 → "1억 8,000만 원", 182499 → "18만 2,499원"
export function formatKoreanWon(amount) {
  const text = formatKoreanAmount(amount);
  if (text === "") return "";
  return /\d$/u.test(text) ? `${text}원` : `${text} 원`;
}

// 800000 → "800,000원"
export function formatWon(amount) {
  return `${groupDigits(amount)}원`;
}

// 40 → "0.40%"
export function formatRateBp(rateBp) {
  const whole = (rateBp - (rateBp % 100)) / 100;
  return `${whole}.${String(rateBp % 100).padStart(2, "0")}%`;
}

// "0.3" → 30, "0.91" → 91. 0.01% 단위까지만 받는다. 빈 값은 null이다.
export function parseRatePercentInput(value, { label = "요율" } = {}) {
  const text = String(value ?? "").replace(/[%\s]/gu, "");
  if (text === "") return null;
  const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/u.exec(text);
  if (!match) {
    throw new WorkInputError("RATE_INVALID", `${label}에는 0.01% 단위 숫자만 입력할 수 있습니다. 예: 0.40`);
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu;

export function cleanSingleLine(value, maximum) {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum);
}

export function cleanMultiLine(value, maximum) {
  return String(value ?? "")
    .replace(CONTROL_CHARACTERS, "")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+/gu, " ")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()
    .slice(0, maximum);
}
