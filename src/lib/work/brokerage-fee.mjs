// 업무 도구 단계 0 중개보수 순수 함수(설계서 6.2 ~ 6.5절).
// 금액은 원 단위 정수, 요율은 1만분율(bp) 정수로만 계산하고 1원 미만은 버린다(DEC-WT-15).
import { assertSupportedContractDate } from "./legal-dates.mjs";
import { PAYMENT_TIMING_NOTICE } from "./message-templates.mjs";
import {
  WorkInputError,
  formatKoreanAmount,
  formatKoreanWon,
  formatRateBp,
  formatWon,
  validateWonAmount,
} from "./work-format.mjs";

// 사무소는 일반과세자다(DEC-WT-01). 단계 0은 저장이 없으므로 코드 상수로 둔다.
export const DEFAULT_VAT_DISPLAY = true;
export const DEFAULT_OFFICE_OTHER_RATE_BP = 90;
export const VAT_PERCENT = 10;

export const PROPERTY_KINDS = Object.freeze({
  housing: "주택",
  officetel: "오피스텔",
  mixed: "주택과 다른 용도가 섞인 건축물",
  other: "그 밖의 건축물·토지",
});

export const FEE_DEAL_TYPES = Object.freeze({
  sale: "매매",
  exchange: "교환",
  jeonse: "전세",
  monthly_rent: "월세",
  sale_and_lease: "매매와 임대차 동시",
});

const SALE_GROUP_DEAL_TYPES = new Set(["sale", "exchange", "sale_and_lease"]);

function floorDivide(numerator, denominator) {
  return (numerator - (numerator % denominator)) / denominator;
}

export function calculateRateAmountWon(amountWon, rateBp) {
  return floorDivide(amountWon * rateBp, 10000);
}

export function calculateVatWon(feeWon) {
  return floorDivide(feeWon * VAT_PERCENT, 100);
}

// 계약일이 appliesFrom 이상인 규칙 가운데 가장 최근 것을 고른다(설계서 6.2절).
export function selectBrokerageFeeRule(legalRules, contractDate) {
  assertSupportedContractDate(contractDate, legalRules);
  const candidates = legalRules.brokerageFeeRules
    .filter((rule) => rule.appliesFrom <= contractDate)
    .sort((left, right) => (left.appliesFrom < right.appliesFrom ? 1 : left.appliesFrom > right.appliesFrom ? -1 : 0));
  return candidates[0];
}

function formatShortAmount(amount) {
  return formatKoreanAmount(amount);
}

function formatThreshold(amount) {
  if (amount % 10_000_000 === 0 && amount < 100_000_000) return `${amount / 10_000_000}천만 원`;
  return formatKoreanWon(amount);
}

// 거래금액(시행규칙 제20조 제5항). 화면에 보여 줄 계산 과정 문장도 함께 돌려준다.
export function calculateTransactionAmount(input, rule) {
  const dealType = input.dealType;
  if (dealType === "sale" || dealType === "sale_and_lease") {
    const amountWon = validateWonAmount(input.priceWon, { label: "매매가" });
    return {
      amountWon,
      explanation: dealType === "sale_and_lease"
        ? `같은 물건·같은 당사자 사이의 매매와 임대차를 같은 기회에 계약 → 매매 금액 ${formatKoreanWon(amountWon)}만 적용(시행규칙 제20조 제5항 제3호)`
        : null,
    };
  }
  if (dealType === "exchange") {
    const values = Array.isArray(input.exchangeValuesWon) ? input.exchangeValuesWon : [];
    if (values.length < 2) throw new WorkInputError("AMOUNT_INVALID", "교환 대상 두 물건의 가액을 모두 입력해 주세요.");
    values.forEach((value) => validateWonAmount(value, { label: "교환 대상 가액" }));
    const amountWon = Math.max(...values);
    return {
      amountWon,
      explanation: `교환 대상 가운데 가액이 큰 쪽 ${formatKoreanWon(amountWon)} 적용(시행규칙 제20조 제5항 제2호)`,
    };
  }
  if (dealType === "jeonse") {
    return { amountWon: validateWonAmount(input.depositWon, { label: "보증금" }), explanation: null };
  }
  if (dealType === "monthly_rent") {
    const deposit = validateWonAmount(input.depositWon, { allowZero: true, label: "보증금" });
    const rent = validateWonAmount(input.monthlyRentWon, { label: "월세" });
    const { multiplier, lowMultiplier, lowThresholdWon } = rule.monthlyRentConversion;
    const base = deposit + rent * multiplier;
    const baseText = `${formatShortAmount(deposit)} + ${formatShortAmount(rent)} × ${multiplier} = ${formatKoreanWon(base)}`;
    if (base < lowThresholdWon) {
      const amountWon = deposit + rent * lowMultiplier;
      return {
        amountWon: validateWonAmount(amountWon, { label: "거래금액" }),
        explanation: `${baseText} → ${formatThreshold(lowThresholdWon)} 미만이므로 ${formatShortAmount(deposit)} + ${formatShortAmount(rent)} × ${lowMultiplier} = ${formatKoreanWon(amountWon)}`,
      };
    }
    return {
      amountWon: validateWonAmount(base, { label: "거래금액" }),
      explanation: `${baseText}(${formatThreshold(lowThresholdWon)} 이상이므로 그대로 적용)`,
    };
  }
  throw new WorkInputError("DEAL_TYPE_INVALID", "거래 종류를 골라 주세요.");
}

export function findFeeBracket(brackets, amountWon) {
  return brackets.find((bracket) => bracket.minWon <= amountWon
    && (bracket.maxWonExclusive === null || amountWon < bracket.maxWonExclusive)) ?? null;
}

export function formatBracketLabel(bracket) {
  if (bracket.minWon === 0) return `${formatKoreanWon(bracket.maxWonExclusive)} 미만`;
  if (bracket.maxWonExclusive === null) return `${formatKoreanWon(bracket.minWon)} 이상`;
  return `${formatKoreanWon(bracket.minWon)} 이상 ${formatKoreanWon(bracket.maxWonExclusive)} 미만`;
}

function resolveTableKind(input, rule) {
  const kind = input.propertyKind;
  if (kind === "housing") return "housing";
  if (kind === "mixed") {
    if (typeof input.housingAreaAtLeastHalf !== "boolean") {
      throw new WorkInputError("HOUSING_RATIO_REQUIRED", "주택 면적이 건물 면적의 2분의 1 이상인지 골라 주세요.");
    }
    return input.housingAreaAtLeastHalf ? "housing" : "other";
  }
  if (kind === "officetel") {
    const conditions = input.officetelConditions ?? {};
    return rule.officetel.conditions.every((condition) => conditions[condition] === true) ? "officetel" : "other";
  }
  if (kind === "other") return "other";
  throw new WorkInputError("PROPERTY_KIND_INVALID", "물건 종류를 골라 주세요.");
}

export function validateOfficeOtherRateBp(rateBp, rule) {
  if (!Number.isSafeInteger(rateBp) || rateBp <= 0) {
    throw new WorkInputError("OFFICE_RATE_INVALID", "사무소 게시 상한요율을 0.01% 단위로 입력해 주세요.");
  }
  if (rateBp > rule.otherMaxRateBp) {
    throw new WorkInputError("OFFICE_RATE_INVALID", `사무소 게시 상한요율은 ${formatRateBp(rule.otherMaxRateBp)}를 넘을 수 없습니다.`);
  }
  return rateBp;
}

function resolveFeeTable(input, rule, amountWon) {
  const group = SALE_GROUP_DEAL_TYPES.has(input.dealType) ? "sale" : "lease";
  const tableKind = resolveTableKind(input, rule);
  if (tableKind === "housing") {
    const bracket = findFeeBracket(rule.housing[group], amountWon);
    if (!bracket) throw new WorkInputError("BRACKET_MISSING", "요율 구간을 찾지 못했습니다.");
    return {
      tableKind,
      tableLabel: group === "sale" ? "주택 매매·교환" : "주택 임대차",
      bracket,
      bracketLabel: formatBracketLabel(bracket),
      rateBp: bracket.rateBp,
      capWon: bracket.capWon,
      rateLimitLabel: "법정 상한",
    };
  }
  if (tableKind === "officetel") {
    return {
      tableKind,
      tableLabel: group === "sale" ? "오피스텔(주거용 조건 충족) 매매·교환" : "오피스텔(주거용 조건 충족) 임대차",
      bracket: null,
      bracketLabel: "구간 없음(단일 요율)",
      rateBp: group === "sale" ? rule.officetel.saleRateBp : rule.officetel.leaseRateBp,
      capWon: null,
      rateLimitLabel: "법정 상한",
    };
  }
  const officeRateBp = input.officeOtherRateBp ?? DEFAULT_OFFICE_OTHER_RATE_BP;
  return {
    tableKind,
    tableLabel: "그 밖의 건축물·토지(사무소 게시 상한요율)",
    bracket: null,
    bracketLabel: "구간 없음(사무소 게시 요율)",
    rateBp: validateOfficeOtherRateBp(officeRateBp, rule),
    capWon: null,
    rateLimitLabel: "사무소 게시 상한요율",
  };
}

function buildNotes(input, table) {
  const notes = ["한쪽 의뢰인 기준 금액입니다. 거래 양쪽 의뢰인에게서 각각 받을 수 있는 상한입니다(시행규칙 제20조 제1항)."];
  if (table.tableKind === "housing" || input.propertyKind === "officetel") {
    notes.push("중개사무소 소재지(대전광역시) 조례 기준입니다. 물건이 대전 밖이어도 같은 표를 씁니다(시행규칙 제20조 제3항).");
  }
  if (input.propertyKind === "mixed") {
    notes.push("주택 면적이 2분의 1 이상이면 주택 요율, 미만이면 주택 외 요율을 씁니다(시행규칙 제20조 제6항).");
  }
  if (input.propertyKind === "officetel" && table.tableKind === "other") {
    notes.push("오피스텔 두 조건(전용 85㎡ 이하, 전용 입식 부엌·수세식 화장실·목욕시설)을 모두 갖추지 않아 그 밖의 건축물로 계산했습니다.");
  }
  if (table.tableKind === "other") {
    notes.push("사무소가 요율표에 게시한 상한요율을 넘을 수 없습니다(시행규칙 제20조 제7항).");
  }
  return notes;
}

// 계산 결과를 돌려준다. 입력 오류면 { ok: false, error }이고 화면은 결과를 지우고 문구만 보여 준다.
export function calculateBrokerageFee(input, legalRules) {
  try {
    const rule = selectBrokerageFeeRule(legalRules, input.contractDate);
    const transaction = calculateTransactionAmount(input, rule);
    const table = resolveFeeTable(input, rule, transaction.amountWon);
    const computedWon = calculateRateAmountWon(transaction.amountWon, table.rateBp);
    const maxFeeWon = table.capWon === null ? computedWon : Math.min(computedWon, table.capWon);

    let agreed = null;
    if (input.agreedRateBp !== null && input.agreedRateBp !== undefined) {
      if (!Number.isSafeInteger(input.agreedRateBp) || input.agreedRateBp < 0) {
        throw new WorkInputError("AGREED_RATE_INVALID", "협의 요율을 0.01% 단위로 입력해 주세요.");
      }
      if (input.agreedRateBp > table.rateBp) {
        throw new WorkInputError("AGREED_RATE_EXCEEDS", `${table.rateLimitLabel} ${formatRateBp(table.rateBp)}를 넘을 수 없습니다.`);
      }
      const agreedComputedWon = calculateRateAmountWon(transaction.amountWon, input.agreedRateBp);
      agreed = {
        rateBp: input.agreedRateBp,
        computedWon: agreedComputedWon,
        feeWon: table.capWon === null ? agreedComputedWon : Math.min(agreedComputedWon, table.capWon),
      };
    }

    const feeWon = agreed ? agreed.feeWon : maxFeeWon;
    const vatDisplay = input.vatDisplay ?? DEFAULT_VAT_DISPLAY;
    const vatWon = vatDisplay ? calculateVatWon(feeWon) : null;
    return {
      ok: /** @type {const} */ (true),
      ruleId: rule.id,
      checkedAt: legalRules.checkedAt,
      propertyKind: input.propertyKind,
      dealType: input.dealType,
      amountWon: transaction.amountWon,
      amountExplanation: transaction.explanation,
      ...table,
      computedWon,
      maxFeeWon,
      capApplied: table.capWon !== null && computedWon > table.capWon,
      agreed,
      feeWon,
      vatWon,
      totalWon: vatWon === null ? feeWon : feeWon + vatWon,
      notes: buildNotes(input, table),
    };
  } catch (error) {
    if (error instanceof WorkInputError) {
      return { ok: /** @type {const} */ (false), error: { code: String(error.code), message: error.message } };
    }
    throw error;
  }
}

// 결과 복사 문장(금액·적용 구간·법령 기준 확인일·지급 시기 문구 포함)
export function formatFeeResultText(result) {
  if (!result?.ok) return "";
  const lines = [
    "중개보수 계산 결과(한쪽 의뢰인 기준)",
    `- 물건·거래: ${PROPERTY_KINDS[result.propertyKind] ?? ""} ${FEE_DEAL_TYPES[result.dealType] ?? ""}`.trimEnd(),
    `- 거래금액: ${formatKoreanWon(result.amountWon)}`,
  ];
  if (result.amountExplanation) lines.push(`  (${result.amountExplanation})`);
  lines.push(
    `- 적용 기준: ${result.tableLabel}, ${result.bracketLabel}`,
    `- ${result.rateLimitLabel} 요율: ${formatRateBp(result.rateBp)}${result.capWon === null ? "" : `, 한도액 ${formatWon(result.capWon)}`}`,
    `- 상한 보수: ${formatWon(result.maxFeeWon)}${result.capApplied ? " (한도액 적용)" : ""}`,
  );
  if (result.agreed) lines.push(`- 협의 요율 ${formatRateBp(result.agreed.rateBp)}: ${formatWon(result.agreed.feeWon)}`);
  if (result.vatWon !== null) {
    lines.push(`- 부가세(10%) 별도: ${formatWon(result.vatWon)}`, `- 합계: ${formatWon(result.totalWon)}`);
  }
  lines.push(
    `법령 기준: 국가법령정보센터, 확인일 ${result.checkedAt} (규칙 ${result.ruleId})`,
    PAYMENT_TIMING_NOTICE,
  );
  return lines.join("\n");
}
