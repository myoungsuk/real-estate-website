import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_OFFICE_OTHER_RATE_BP,
  DEFAULT_VAT_DISPLAY,
  calculateBrokerageFee,
  calculateVatWon,
  formatFeeResultText,
  selectBrokerageFeeRule,
} from "../src/lib/work/brokerage-fee.mjs";
import { PAYMENT_TIMING_NOTICE } from "../src/lib/work/message-templates.mjs";
import { formatKoreanWon, parseRatePercentInput, parseWonInput } from "../src/lib/work/work-format.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));
const CONTRACT_DATE = "2026-11-16";

const fee = (input) => calculateBrokerageFee({ contractDate: CONTRACT_DATE, vatDisplay: false, ...input }, legalRules);
const okFee = (input) => {
  const result = fee(input);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

test("T0-01 ~ T0-13 주택 매매 요율 경계와 한도액", () => {
  const cases = [
    ["T0-01", 49_999_999, 250_000],
    ["T0-02", 50_000_000, 250_000],
    ["T0-03", 160_000_000, 800_000],
    ["T0-04", 180_000_000, 800_000],
    ["T0-05", 199_999_999, 800_000],
    ["T0-06", 200_000_000, 800_000],
    ["T0-07", 300_000_000, 1_200_000],
    ["T0-08", 899_999_999, 3_599_999],
    ["T0-09", 900_000_000, 4_500_000],
    ["T0-10", 1_199_999_999, 5_999_999],
    ["T0-11", 1_200_000_000, 7_200_000],
    ["T0-12", 1_499_999_999, 8_999_999],
    ["T0-13", 1_500_000_000, 10_500_000],
  ];
  for (const [id, priceWon, expected] of cases) {
    assert.equal(okFee({ propertyKind: "housing", dealType: "sale", priceWon }).maxFeeWon, expected, id);
  }
  const capped = okFee({ propertyKind: "housing", dealType: "sale", priceWon: 180_000_000 });
  assert.equal(capped.computedWon, 900_000);
  assert.equal(capped.capApplied, true);
  assert.equal(okFee({ propertyKind: "housing", dealType: "sale", priceWon: 160_000_000 }).capApplied, false);
});

test("T0-14 ~ T0-23 주택 임대차 요율 경계와 한도액", () => {
  const cases = [
    ["T0-14", 49_999_999, 200_000],
    ["T0-15", 50_000_000, 200_000],
    ["T0-16", 99_999_999, 300_000],
    ["T0-17", 100_000_000, 300_000],
    ["T0-18", 599_999_999, 1_799_999],
    ["T0-19", 600_000_000, 2_400_000],
    ["T0-20", 1_199_999_999, 4_799_999],
    ["T0-21", 1_200_000_000, 6_000_000],
    ["T0-22", 1_499_999_999, 7_499_999],
    ["T0-23", 1_500_000_000, 9_000_000],
  ];
  for (const [id, depositWon, expected] of cases) {
    assert.equal(okFee({ propertyKind: "housing", dealType: "jeonse", depositWon }).maxFeeWon, expected, id);
  }
});

test("T0-24 ~ T0-30 월세 거래금액 환산(× 100, 5천만 원 미만이면 × 70)", () => {
  const cases = [
    ["T0-24", 5_000_000, 300_000, 26_000_000, 130_000],
    ["T0-25", 5_000_000, 450_000, 50_000_000, 200_000],
    ["T0-26", 4_999_999, 450_000, 36_499_999, 182_499],
    ["T0-27", 0, 500_000, 50_000_000, 200_000],
    ["T0-28", 0, 499_999, 34_999_930, 174_999],
    ["T0-29", 10_000_000, 400_000, 50_000_000, 200_000],
  ];
  for (const [id, depositWon, monthlyRentWon, amountWon, maxFeeWon] of cases) {
    const result = okFee({ propertyKind: "housing", dealType: "monthly_rent", depositWon, monthlyRentWon });
    assert.equal(result.amountWon, amountWon, id);
    assert.equal(result.maxFeeWon, maxFeeWon, id);
  }
  const explained = okFee({ propertyKind: "housing", dealType: "monthly_rent", depositWon: 5_000_000, monthlyRentWon: 300_000 });
  assert.equal(
    explained.amountExplanation,
    "500만 + 30만 × 100 = 3,500만 원 → 5천만 원 미만이므로 500만 + 30만 × 70 = 2,600만 원",
    "T0-30",
  );
});

test("T0-31 ~ T0-35 교환·동시 거래·주택 면적 비율·한쪽 의뢰인 문구", () => {
  const exchange = okFee({ propertyKind: "housing", dealType: "exchange", exchangeValuesWon: [300_000_000, 350_000_000] });
  assert.equal(exchange.amountWon, 350_000_000, "T0-31");
  assert.equal(exchange.maxFeeWon, 1_400_000, "T0-31");

  const combined = okFee({ propertyKind: "housing", dealType: "sale_and_lease", priceWon: 300_000_000, depositWon: 100_000_000 });
  assert.equal(combined.amountWon, 300_000_000, "T0-32");
  assert.equal(combined.tableLabel, "주택 매매·교환", "T0-32");
  assert.match(combined.amountExplanation, /매매 금액 3억 원만 적용/u, "T0-32");

  const mostlyHousing = okFee({ propertyKind: "mixed", housingAreaAtLeastHalf: true, dealType: "sale", priceWon: 300_000_000 });
  assert.equal(mostlyHousing.tableKind, "housing", "T0-33");
  assert.equal(mostlyHousing.maxFeeWon, 1_200_000, "T0-33");
  const mostlyOther = okFee({ propertyKind: "mixed", housingAreaAtLeastHalf: false, dealType: "sale", priceWon: 300_000_000 });
  assert.equal(mostlyOther.tableKind, "other", "T0-34");
  assert.equal(mostlyOther.maxFeeWon, 2_700_000, "T0-34");
  assert.equal(fee({ propertyKind: "mixed", dealType: "sale", priceWon: 300_000_000 }).ok, false);

  assert.match(mostlyHousing.notes.join("\n"), /한쪽 의뢰인 기준/u, "T0-35");
  assert.match(formatFeeResultText(mostlyHousing), /한쪽 의뢰인 기준/u, "T0-35");
});

test("T0-36 ~ T0-43 오피스텔 조건 4조합과 그 밖의 건축물 게시 요율", () => {
  const both = { exclusiveAreaAtMost85: true, kitchenToiletBath: true };
  const officetelSale = okFee({ propertyKind: "officetel", officetelConditions: both, dealType: "sale", priceWon: 300_000_000 });
  assert.equal(officetelSale.maxFeeWon, 1_500_000, "T0-36");
  assert.equal(officetelSale.capWon, null, "T0-36");
  assert.equal(okFee({ propertyKind: "officetel", officetelConditions: both, dealType: "jeonse", depositWon: 100_000_000 }).maxFeeWon, 400_000, "T0-37");

  const otherCombos = [
    ["T0-38", { exclusiveAreaAtMost85: false, kitchenToiletBath: true }],
    ["T0-39", { exclusiveAreaAtMost85: true, kitchenToiletBath: false }],
    ["T0-40", { exclusiveAreaAtMost85: false, kitchenToiletBath: false }],
  ];
  for (const [id, officetelConditions] of otherCombos) {
    const result = okFee({ propertyKind: "officetel", officetelConditions, dealType: "sale", priceWon: 300_000_000 });
    assert.equal(result.tableKind, "other", id);
    assert.equal(result.maxFeeWon, 2_700_000, id);
  }

  assert.equal(DEFAULT_OFFICE_OTHER_RATE_BP, 90);
  assert.equal(okFee({ propertyKind: "other", dealType: "sale", priceWon: 100_000_000 }).maxFeeWon, 900_000, "T0-41");
  const tooHigh = fee({ propertyKind: "other", dealType: "sale", priceWon: 100_000_000, officeOtherRateBp: parseRatePercentInput("0.91") });
  assert.equal(tooHigh.ok, false, "T0-42");
  assert.equal(tooHigh.error.code, "OFFICE_RATE_INVALID", "T0-42");
  assert.equal(okFee({ propertyKind: "other", dealType: "sale", priceWon: 100_000_000, officeOtherRateBp: 60 }).maxFeeWon, 600_000, "T0-43");
});

test("T0-44 ~ T0-51 협의 요율·부가세·끝수·복사 문장", () => {
  assert.equal(okFee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, agreedRateBp: 30 }).feeWon, 900_000, "T0-44");

  const exceeded = fee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, agreedRateBp: 41 });
  assert.equal(exceeded.ok, false, "T0-45");
  assert.equal(exceeded.error.message, "법정 상한 0.40%를 넘을 수 없습니다.", "T0-45");

  const cappedAgreed = okFee({ propertyKind: "housing", dealType: "sale", priceWon: 180_000_000, agreedRateBp: 50 });
  assert.equal(cappedAgreed.agreed.computedWon, 900_000, "T0-46");
  assert.equal(cappedAgreed.feeWon, 800_000, "T0-46");

  const withVat = okFee({ propertyKind: "housing", dealType: "sale", priceWon: 180_000_000, vatDisplay: true });
  assert.equal(withVat.vatWon, 80_000, "T0-47");
  assert.equal(withVat.totalWon, 880_000, "T0-47");
  assert.match(formatFeeResultText(withVat), /부가세\(10%\) 별도: 80,000원/u, "T0-47");
  assert.match(formatFeeResultText(withVat), /합계: 880,000원/u, "T0-47");

  const withoutVat = okFee({ propertyKind: "housing", dealType: "sale", priceWon: 180_000_000, vatDisplay: false });
  assert.equal(withoutVat.vatWon, null, "T0-48");
  assert.doesNotMatch(formatFeeResultText(withoutVat), /부가세/u, "T0-48");

  assert.equal(DEFAULT_VAT_DISPLAY, true, "T0-49");
  const defaultVat = calculateBrokerageFee({ contractDate: CONTRACT_DATE, propertyKind: "housing", dealType: "sale", priceWon: 180_000_000 }, legalRules);
  assert.equal(defaultVat.vatWon, 80_000, "T0-49");

  assert.equal(calculateVatWon(133_333), 13_333, "T0-50");

  const text = formatFeeResultText(withVat);
  assert.match(text, /거래금액: 1억 8,000만 원/u, "T0-51");
  assert.match(text, /적용 기준: 주택 매매·교환, 5,000만 원 이상 2억 원 미만/u, "T0-51");
  assert.match(text, /확인일 2026-11-16/u, "T0-51");
  assert.ok(text.endsWith(PAYMENT_TIMING_NOTICE), "T0-51");
  assert.match(PAYMENT_TIMING_NOTICE, /시행령 제27조의2/u, "T0-51");
});

test("T0-52 ~ T0-61 금액·날짜 입력 검증과 한글 단위 표시", () => {
  const sale = (priceWon) => fee({ propertyKind: "housing", dealType: "sale", priceWon });
  assert.equal(sale(0).ok, false, "T0-52");
  assert.equal(sale(-1).ok, false, "T0-53");
  assert.equal(sale(1000.5).ok, false, "T0-54");
  assert.throws(() => parseWonInput("1,000.5"), /원 단위 숫자/u, "T0-54");
  assert.throws(() => parseWonInput("-1000"), /원 단위 숫자/u, "T0-53");
  assert.throws(() => parseWonInput("0"), /0원보다 큰/u, "T0-52");
  const trillion = sale(1_000_000_000_000);
  assert.equal(trillion.ok, false, "T0-55");
  assert.equal(trillion.error.code, "AMOUNT_TOO_LARGE", "T0-55");
  const largest = okFee({ propertyKind: "housing", dealType: "sale", priceWon: 999_999_999_999 });
  assert.equal(largest.maxFeeWon, 6_999_999_999, "T0-56");
  assert.ok(Number.isSafeInteger(largest.maxFeeWon), "T0-56");

  const tooEarly = fee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, contractDate: "2022-05-15" });
  assert.equal(tooEarly.ok, false, "T0-57");
  assert.equal(tooEarly.error.message, "이 계산기는 2022-05-16 이후 계약만 지원합니다.", "T0-57");
  assert.equal(okFee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, contractDate: "2022-05-16" }).maxFeeWon, 1_200_000, "T0-58");
  assert.equal(fee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, contractDate: "2027-02-29" }).error.code, "DATE_INVALID", "T0-59");
  assert.equal(fee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, contractDate: "2026/11/16" }).error.code, "DATE_INVALID", "T0-60");
  assert.equal(formatKoreanWon(parseWonInput("180000000")), "1억 8,000만 원", "T0-61");
  assert.equal(formatKoreanWon(182_499), "18만 2,499원");
  assert.equal(formatKoreanWon(999_999_999_999), "9,999억 9,999만 9,999원");
});

test("T0-57a·T0-124 계약일 기준으로 appliesFrom 이상 규칙 가운데 가장 최근 것을 고른다", () => {
  assert.equal(selectBrokerageFeeRule(legalRules, CONTRACT_DATE).id, "kr-housing-2021-10-19-daejeon-2022-05-16");
  const base = legalRules.brokerageFeeRules[0];
  const withFuture = {
    ...legalRules,
    brokerageFeeRules: [
      { ...base, id: "virtual-future-rule-2030-01-01", appliesFrom: "2030-01-01" },
      base,
    ],
  };
  assert.equal(selectBrokerageFeeRule(withFuture, "2029-12-31").id, base.id);
  assert.equal(selectBrokerageFeeRule(withFuture, "2030-01-01").id, "virtual-future-rule-2030-01-01");
  assert.equal(selectBrokerageFeeRule(withFuture, "2031-06-30").id, "virtual-future-rule-2030-01-01");
  assert.equal(okFee({ propertyKind: "housing", dealType: "sale", priceWon: 300_000_000 }).ruleId, base.id);
});

test("요율 입력은 0.01% 단위만 받는다", () => {
  assert.equal(parseRatePercentInput("0.3"), 30);
  assert.equal(parseRatePercentInput("0.30"), 30);
  assert.equal(parseRatePercentInput("0.91"), 91);
  assert.equal(parseRatePercentInput(""), null);
  assert.throws(() => parseRatePercentInput("0.305"), /0\.01% 단위/u);
  assert.throws(() => parseRatePercentInput("abc"), /0\.01% 단위/u);
});
