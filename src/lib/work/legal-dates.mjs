// 업무 도구 단계 0 법정 기한·일정 대상 판정 순수 함수(설계서 6.6 ~ 6.7절).
// 날짜는 YYYY-MM-DD 달력 날짜로만 다루고 Date.UTC로 계산해 브라우저 시간대의 영향을 받지 않는다.
import { WorkInputError, cleanSingleLine, formatKoreanWon, validateWonAmount } from "./work-format.mjs";

export const HOLIDAY_NOTICE = "공휴일 여부는 직접 확인하세요.";
export const WEEKEND_NOTICE = "주말이어도 기한을 미루지 않았습니다.";
export const CURRENT_RULES_NOTICE = "기한·대상 판정은 확인일 기준 현행 법령입니다. 과거 계약은 당시 기준과 다를 수 있습니다.";
export const LEASE_MOVE_IN_NOTICE = "임차인이 전입신고를 하면 임대차 신고를 한 것으로 봅니다(법 제6조의5①).";
export const EXCHANGE_REPORT_NOTICE = "교환계약은 법 제3조① 신고 대상 계약 목록에 없습니다. 필요하면 관할 신고관청에 확인하세요.";

const WEEKDAY_SHORT = Object.freeze(["일", "월", "화", "수", "목", "금", "토"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function assertCalendarDate(value, label = "날짜") {
  if (!parseCalendarDate(value)) {
    throw new WorkInputError("DATE_INVALID", `${label} 입력이 올바르지 않습니다. 실제 있는 날짜를 YYYY-MM-DD 형식으로 입력해 주세요.`);
  }
  return value;
}

function toUtcTime(value) {
  const { year, month, day } = parseCalendarDate(value);
  return Date.UTC(year, month - 1, day);
}

function fromUtcTime(time) {
  return new Date(time).toISOString().slice(0, 10);
}

export function addCalendarDays(value, days) {
  assertCalendarDate(value);
  if (!Number.isSafeInteger(days)) throw new WorkInputError("DAYS_INVALID", "일수는 정수여야 합니다.");
  return fromUtcTime(toUtcTime(value) + days * DAY_MS);
}

// 첫날(계약일) 포함: N일 기한의 마지막 날 = 계약일 + (N - 1)일(설계서 6.6절)
export function deadlineFromContractDate(contractDate, days) {
  if (!Number.isSafeInteger(days) || days < 1) throw new WorkInputError("DAYS_INVALID", "기한 일수는 1 이상이어야 합니다.");
  return addCalendarDays(contractDate, days - 1);
}

export function describeCalendarDate(value) {
  assertCalendarDate(value);
  const weekday = new Date(toUtcTime(value)).getUTCDay();
  const weekend = weekday === 0 || weekday === 6;
  return {
    date: value,
    weekday: WEEKDAY_SHORT[weekday],
    weekend,
    label: weekend ? `${value}(${WEEKDAY_SHORT[weekday]}요일)` : `${value}(${WEEKDAY_SHORT[weekday]})`,
  };
}

export function formatDeadlineLine(value) {
  return `늦어도 ${describeCalendarDate(value).label}까지`;
}

// 사용자 기기 시계를 한국 날짜로 바꾼다. 계약일 입력의 기본값으로만 쓴다.
export function todayInKorea(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getSupportedFromDate(legalRules) {
  const dates = (legalRules?.brokerageFeeRules ?? []).map((rule) => rule.appliesFrom).filter((date) => parseCalendarDate(date));
  if (dates.length === 0) throw new WorkInputError("RULES_MISSING", "법령 기준 데이터가 없습니다.");
  return dates.sort()[0];
}

export function assertSupportedContractDate(contractDate, legalRules) {
  assertCalendarDate(contractDate, "계약일");
  const supportedFrom = getSupportedFromDate(legalRules);
  if (contractDate < supportedFrom) {
    throw new WorkInputError("DATE_UNSUPPORTED", `이 계산기는 ${supportedFrom} 이후 계약만 지원합니다.`);
  }
  return contractDate;
}

export const SCHEDULE_DEAL_KINDS = Object.freeze({
  sale: "매매",
  supply: "분양 공급계약",
  status_sale: "분양권·입주권 매매",
  exchange: "교환",
  jeonse: "전세",
  monthly_rent: "월세",
});
const REPORTABLE_DEAL_KINDS = new Set(["sale", "supply", "status_sale"]);
const LEASE_DEAL_KINDS = new Set(["jeonse", "monthly_rent"]);
const PROPERTY_TARGETS = new Set(["housing", "land", "other"]);
const REGULATIONS = new Set(["none", "adjusted", "overheated"]);

function findDeadlineRule(legalRules, kind) {
  const rule = (legalRules?.deadlineRules ?? []).find((item) => item.kind === kind);
  if (!rule) throw new WorkInputError("RULES_MISSING", `법령 기준 데이터에 ${kind} 규칙이 없습니다.`);
  return rule;
}

// 자금조달·토지이용계획서 대상 판정(시행령 별표 1, 설계서 6.7절)
export function screenFundingPlan(input, legalRules) {
  const criteria = legalRules.screeningRules.fundingPlan;
  if (!REPORTABLE_DEAL_KINDS.has(input.dealKind)) return { applies: false, planName: null, reasons: [], notes: [] };
  const target = input.target ?? "housing";
  if (target !== "housing" && target !== "land") return { applies: false, planName: null, reasons: [], notes: [] };
  const price = validateWonAmount(input.priceWon, { label: "실제 거래가격" });
  const reasons = [];
  const notes = [];

  if (target === "housing") {
    if (input.buyerType === "corporation") {
      reasons.push("매수인이 법인인 주택 거래(금액 무관)");
      notes.push("법인 주택 거래계약 신고서도 함께 제출합니다.");
    }
    if (input.landPermitArea === true) {
      reasons.push("토지거래허가구역 주택 매수");
      notes.push("증빙 서류를 함께 제출합니다.");
    }
    if (input.regulation === "adjusted" || input.regulation === "overheated") {
      reasons.push(input.regulation === "overheated" ? "투기과열지구 주택" : "조정대상지역 주택");
      if (input.regulation === "overheated") notes.push("투기과열지구는 증빙 서류를 함께 제출합니다.");
    }
    if (price >= criteria.housingPriceAtLeastWon) {
      reasons.push(`주택 실제 거래가격 ${formatKoreanWon(criteria.housingPriceAtLeastWon)} 이상`);
    }
    return {
      applies: reasons.length > 0,
      planName: "주택취득자금 조달 및 입주계획서",
      reasons,
      notes: [...new Set(notes)],
    };
  }

  if (target === "land") {
    const capitalArea = input.capitalAreaEtc !== false;
    if (input.landShare === true) {
      if (capitalArea) reasons.push("수도권등 토지 지분 매수(금액 무관)");
      else if (price >= criteria.landShareOtherAtLeastWon) {
        reasons.push(`수도권등 밖 토지 지분 매수 ${formatKoreanWon(criteria.landShareOtherAtLeastWon)} 이상`);
      }
    } else if (capitalArea && price >= criteria.landCapitalAreaAtLeastWon) {
      reasons.push(`수도권등 토지 매수 ${formatKoreanWon(criteria.landCapitalAreaAtLeastWon)} 이상`);
    } else if (!capitalArea && price >= criteria.landOtherAtLeastWon) {
      reasons.push(`수도권등 밖 토지 매수 ${formatKoreanWon(criteria.landOtherAtLeastWon)} 이상`);
    }
    return { applies: reasons.length > 0, planName: "토지취득자금 조달 및 토지이용계획서", reasons, notes };
  }

  return { applies: false, planName: null, reasons: [], notes: [] };
}

// 주택 임대차 신고 대상 판정(법 제6조의2, 시행령 제4조의3)
export function screenLeaseReport(input, legalRules) {
  const criteria = legalRules.screeningRules.leaseReport;
  if (!LEASE_DEAL_KINDS.has(input.dealKind)) return { applies: false, reason: null };
  if ((input.target ?? "housing") !== "housing") return { applies: false, reason: "주택 임대차만 신고 대상입니다." };
  if (input.reportingRegion === false) return { applies: false, reason: "신고 대상 지역이 아닙니다." };
  if (input.renewalWithoutChange === true) {
    return { applies: false, reason: "보증금·차임 변동 없이 기간만 연장하는 갱신은 신고 대상이 아닙니다." };
  }
  const deposit = validateWonAmount(input.depositWon, { allowZero: input.dealKind === "monthly_rent", label: "보증금" });
  const monthlyRent = input.dealKind === "monthly_rent"
    ? validateWonAmount(input.monthlyRentWon, { label: "월세" })
    : 0;
  if (deposit > criteria.depositOverWon || monthlyRent > criteria.monthlyRentOverWon) {
    return { applies: true, reason: `보증금 ${formatKoreanWon(criteria.depositOverWon)} 초과 또는 월 차임 ${formatKoreanWon(criteria.monthlyRentOverWon)} 초과` };
  }
  return {
    applies: false,
    reason: `보증금 ${formatKoreanWon(criteria.depositOverWon)} 이하이고 월 차임 ${formatKoreanWon(criteria.monthlyRentOverWon)} 이하라 신고 대상이 아닙니다.`,
  };
}

function eventTitle(baseTitle, propertyLabel) {
  return propertyLabel ? `${baseTitle}(${propertyLabel})` : baseTitle;
}

function deadlineEvent(rule, contractDate, propertyLabel) {
  const date = deadlineFromContractDate(contractDate, rule.days);
  const info = describeCalendarDate(date);
  return {
    kind: rule.kind,
    ruleId: rule.id,
    date,
    label: rule.label,
    dateLine: formatDeadlineLine(date),
    legalText: rule.legalText,
    weekend: info.weekend,
    title: eventTitle(rule.calendarTitle, propertyLabel),
  };
}

function plainEvent(kind, label, date, propertyLabel) {
  const info = describeCalendarDate(date);
  return {
    kind,
    ruleId: null,
    date,
    label,
    dateLine: info.label,
    legalText: null,
    weekend: info.weekend,
    title: eventTitle(label, propertyLabel),
  };
}

// 계약 일정 목록을 만든다. 성공하면 { ok: true, ... }, 입력 오류면 { ok: false, error }를 돌려준다.
export function buildContractSchedule(input, legalRules) {
  try {
    if (!Object.hasOwn(SCHEDULE_DEAL_KINDS, input.dealKind)) {
      throw new WorkInputError("DEAL_TYPE_INVALID", "거래 종류를 골라 주세요.");
    }
    const target = input.target ?? "housing";
    if (!PROPERTY_TARGETS.has(target)) throw new WorkInputError("PROPERTY_KIND_INVALID", "물건 종류를 골라 주세요.");
    const regulation = input.regulation ?? "none";
    if (!REGULATIONS.has(regulation)) throw new WorkInputError("REGULATION_INVALID", "규제지역 여부를 골라 주세요.");
    const contractDate = assertSupportedContractDate(input.contractDate, legalRules);
    const propertyLabel = cleanSingleLine(input.propertyLabel, 40);
    const events = [plainEvent("contract", "계약일", contractDate, propertyLabel)];
    const notices = [];

    for (const [kind, label, date] of [
      ["middlePayment", "중도금", input.middlePaymentDate],
      ["balance", "잔금", input.balanceDate],
    ]) {
      if (date === null || date === undefined || date === "") continue;
      assertCalendarDate(date, `${label}일`);
      if (date < contractDate) throw new WorkInputError("DATE_ORDER_INVALID", `${label}일이 계약일보다 빠릅니다.`);
      events.push(plainEvent(kind, label, date, propertyLabel));
    }

    const screening = { transactionReport: false, fundingPlan: null, leaseReport: null };
    const normalized = { ...input, target, regulation };

    if (REPORTABLE_DEAL_KINDS.has(input.dealKind)) {
      screening.transactionReport = true;
      events.push(deadlineEvent(findDeadlineRule(legalRules, "transactionReport"), contractDate, propertyLabel));
      const funding = screenFundingPlan(normalized, legalRules);
      screening.fundingPlan = funding;
      if (funding.applies) {
        events.push(deadlineEvent(findDeadlineRule(legalRules, "fundingPlanDelivery"), contractDate, propertyLabel));
        if (input.separateFundingSubmission === true) {
          events.push(deadlineEvent(findDeadlineRule(legalRules, "fundingPlanSeparate"), contractDate, propertyLabel));
        }
        notices.push(`${funding.planName} 대상: ${funding.reasons.join(", ")}`, ...funding.notes);
      } else if (funding.planName) {
        notices.push(`${funding.planName} 대상이 아닙니다(입력한 조건 기준).`);
      }
    } else if (input.dealKind === "exchange") {
      notices.push(EXCHANGE_REPORT_NOTICE);
    } else if (LEASE_DEAL_KINDS.has(input.dealKind)) {
      const lease = screenLeaseReport(normalized, legalRules);
      screening.leaseReport = lease;
      if (lease.applies) {
        events.push(deadlineEvent(findDeadlineRule(legalRules, "leaseReport"), contractDate, propertyLabel));
        notices.push(`주택 임대차 신고 대상: ${lease.reason}`);
      } else if (lease.reason) {
        notices.push(lease.reason);
      }
      if (target === "housing") notices.push(LEASE_MOVE_IN_NOTICE);
    }

    if (events.some((event) => event.weekend && event.ruleId)) notices.push(WEEKEND_NOTICE);
    notices.push(HOLIDAY_NOTICE, CURRENT_RULES_NOTICE);
    events.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
    return { ok: /** @type {const} */ (true), contractDate, events, notices: [...new Set(notices)], screening };
  } catch (error) {
    if (error instanceof WorkInputError) {
      return { ok: /** @type {const} */ (false), error: { code: String(error.code), message: error.message } };
    }
    throw error;
  }
}
