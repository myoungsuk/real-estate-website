// 계약서 읽기 순수 부품(src/lib/work/contract-extract.mjs) 시험. 가짜 자료만 쓴다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_FIELD_ORDER,
  CONTRACT_QUOTE_MAX,
  contractFieldOrder,
  contractInstructions,
  contractResultSchema,
  isRealDate,
  maskContractResult,
  validateContractResult,
} from "../src/lib/work/contract-extract.mjs";
import { maskResidentNumbers } from "../worker/work-input.mjs";
import { sampleContract } from "./work-ai-test-kit.mjs";

test("스키마: 1회째와 2회째는 칸이 같고 순서만 다르며, 둘 다 모든 칸을 required로 두고 추가 칸을 막는다", () => {
  const first = contractResultSchema(1);
  const second = contractResultSchema(2);
  assert.deepEqual(Object.keys(first.properties), [...CONTRACT_FIELD_ORDER]);
  assert.deepEqual(Object.keys(second.properties), [...contractFieldOrder(2)]);
  assert.notDeepEqual(Object.keys(first.properties), Object.keys(second.properties), "2회째는 칸 순서가 다름");
  assert.deepEqual([...Object.keys(second.properties)].sort(), [...Object.keys(first.properties)].sort(), "칸 이름은 같음");
  assert.equal(Object.keys(second.properties).at(-1), "warnings", "경고 칸은 늘 끝");
  for (const schema of [first, second]) {
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
    for (const def of Object.values(schema.$defs)) {
      assert.equal(def.additionalProperties, false);
      assert.deepEqual(def.required, Object.keys(def.properties), "strict 모드는 모든 칸이 required여야 함");
    }
  }
  assert.equal(JSON.stringify(first).includes("maxLength"), false, "지원 목록에 없는 maxLength는 보내지 않음(재검사에서만 봄)");
  assert.equal(JSON.stringify(first).includes("name"), false, "사람 이름 칸 없음");
});

test("지시문: 2회째는 칸 안내 순서가 다르고, 둘 다 이름·주민번호를 쓰지 말라고 적는다", () => {
  const first = contractInstructions(1);
  const second = contractInstructions(2);
  assert.notEqual(first, second);
  assert.ok(first.indexOf("contract_date:") < first.indexOf("balance:"));
  assert.ok(second.indexOf("contract_date:") > second.indexOf("balance:"));
  for (const text of [first, second]) {
    assert.ok(text.includes("사람 이름·주민등록번호·전화번호·계좌번호는 어디에도 쓰지 않는다"));
    assert.ok(text.includes("추측하거나 계산해서 채우지 않는다"));
  }
});

test("재검사: 정상 결과는 통과하고 칸 순서를 1회째 순서로 맞춘 새 객체를 돌려준다", () => {
  const reversed = Object.fromEntries(Object.entries(sampleContract()).reverse());
  const checked = validateContractResult(reversed);
  assert.equal(checked.ok, true);
  assert.deepEqual(Object.keys(checked.result), [...CONTRACT_FIELD_ORDER]);
  assert.deepEqual(checked.result, sampleContract());
});

test("재검사: 칸 누락·추가 칸·없는 날짜·음수·너무 큰 금액·너무 긴 글·틀린 종류는 모두 통과하지 못한다", () => {
  const without = (key) => {
    const { [key]: _removed, ...rest } = sampleContract();
    return rest;
  };
  const date = (value) => sampleContract({ contract_date: { value, evidence: { page: 1, quote: "", box: null } } });
  const price = (value) => sampleContract({ price_won: { value, evidence: { page: 1, quote: "", box: null } } });
  const cases = {
    "칸 누락": without("balance"),
    "추가 칸": { ...sampleContract(), buyer_name: "가상 이름" },
    "없는 날짜": date("2026-02-30"),
    "날짜 꼴 아님": date("2026.11.02"),
    "음수 금액": price(-1),
    "소수 금액": price(1.5),
    "1조 이상": price(1_000_000_000_000),
    "문자 금액": price("350000000"),
    "틀린 문서 종류": sampleContract({ document_kind: "deed" }),
    "틀린 거래 종류": sampleContract({ deal_type: "lease" }),
    "중도금 5개": sampleContract({ middle_payments: Array.from({ length: 5 }, () => sampleContract().balance) }),
    "경고 11개": sampleContract({ warnings: Array.from({ length: 11 }, () => "가상 경고") }),
    "너무 긴 원문 문구": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "가".repeat(CONTRACT_QUOTE_MAX + 1), box: null } } }),
    "쪽 번호 0": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 0, quote: "", box: null } } }),
    "자리 값 5개": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "", box: [0, 0, 1, 1, 1] } } }),
    "자리 값 범위 밖": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "", box: [0, 0, 1.2, 1] } } }),
    "근거 추가 칸": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "", box: null, name: "가상" } } }),
    "배열": [sampleContract()],
    "null": null,
    "글자": "{}",
  };
  for (const [label, value] of Object.entries(cases)) assert.deepEqual(validateContractResult(value), { ok: false }, label);
});

test("재검사: 줄바꿈·제어 문자는 빈칸으로 바꿔 한 줄로 저장한다", () => {
  const checked = validateContractResult(sampleContract({ warnings: ["첫 줄\n둘째 줄\u0000"] }));
  assert.deepEqual(checked.result.warnings, ["첫 줄 둘째 줄"]);
});

test("isRealDate: 실제 달력 날짜만 참이다", () => {
  assert.equal(isRealDate("2028-02-29"), true);
  assert.equal(isRealDate("2026-02-29"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("1899-12-31"), false);
  assert.equal(isRealDate(20261102), false);
});

test("가림: 원문 문구·물건 표시·경고의 주민번호 꼴을 가리고 개수를 세며, 날짜·금액 값은 그대로 둔다", () => {
  const source = validateContractResult(sampleContract({
    contract_date: { value: "2026-11-02", evidence: { page: 1, quote: "가상 900101-1234567 작성", box: null } },
    property_text: { value: "가상시 가상동 1번지 800202-2345678", evidence: { page: 1, quote: "소재지", box: null } },
    warnings: ["가상 경고 7001011234567"],
  })).result;
  const masked = maskContractResult(source, maskResidentNumbers);
  assert.equal(masked.count, 3);
  const text = JSON.stringify(masked.result);
  for (const raw of ["900101-1234567", "800202-2345678", "7001011234567"]) assert.equal(text.includes(raw), false, raw);
  assert.equal(masked.result.contract_date.value, "2026-11-02");
  assert.equal(masked.result.price_won.value, 350_000_000);
  assert.ok(masked.result.contract_date.evidence.quote.length <= CONTRACT_QUOTE_MAX);
  assert.deepEqual(maskContractResult(validateContractResult(sampleContract()).result, maskResidentNumbers).count, 0);
});

test("가림: 계약금·중도금·잔금의 금액·날짜 원문 문구와 매매대금·보증금·월 차임·물건 표시의 원문 문구도 모두 가린다", () => {
  // 자리마다 다른 주민번호 꼴(가상)을 넣어 어느 자리가 빠졌는지 알 수 있게 한다.
  const rrn = (index) => `9001${10 + index}-12345${10 + index}`;
  const ev = (index) => ({ page: 1, quote: `가상 문구 ${rrn(index)} 끝`, box: null });
  const pay = (index, amount, date) => ({ amount: { value: amount, evidence: ev(index) }, date: { value: date, evidence: ev(index + 1) } });
  const source = validateContractResult(sampleContract({
    price_won: { value: 350_000_000, evidence: ev(0) },
    deposit_won: { value: null, evidence: ev(1) },
    monthly_rent_won: { value: null, evidence: ev(2) },
    down_payment: pay(3, 35_000_000, "2026-11-02"),
    middle_payments: [pay(5, 100_000_000, "2026-11-20"), pay(7, 50_000_000, "2026-12-10")],
    balance: pay(9, 165_000_000, "2026-12-30"),
    property_text: { value: "가상시 가상동 1번지", evidence: ev(11) },
  }));
  assert.equal(source.ok, true);
  const masked = maskContractResult(source.result, maskResidentNumbers);
  assert.equal(masked.count, 12, "원문 문구 12자리 모두");
  const where = {
    "매매대금": masked.result.price_won.evidence.quote,
    "보증금": masked.result.deposit_won.evidence.quote,
    "월 차임": masked.result.monthly_rent_won.evidence.quote,
    "계약금 금액": masked.result.down_payment.amount.evidence.quote,
    "계약금 날짜": masked.result.down_payment.date.evidence.quote,
    "중도금 1차 금액": masked.result.middle_payments[0].amount.evidence.quote,
    "중도금 1차 날짜": masked.result.middle_payments[0].date.evidence.quote,
    "중도금 2차 금액": masked.result.middle_payments[1].amount.evidence.quote,
    "중도금 2차 날짜": masked.result.middle_payments[1].date.evidence.quote,
    "잔금 금액": masked.result.balance.amount.evidence.quote,
    "잔금 날짜": masked.result.balance.date.evidence.quote,
    "물건 표시 근거": masked.result.property_text.evidence.quote,
  };
  Object.entries(where).forEach(([label, quote], index) => {
    assert.equal(quote.includes(rrn(index)), false, `${label}: 주민번호 꼴이 남음`);
    assert.equal(/\d{6}-?\d{7}/u.test(quote), false, `${label}: 13자리 숫자가 남음`);
    assert.ok(quote.startsWith("가상 문구 ") && quote.endsWith(" 끝"), `${label}: 앞뒤 글은 그대로`);
    assert.ok(quote.length <= CONTRACT_QUOTE_MAX, label);
  });
  // 값(금액·날짜)과 쪽 번호는 바뀌지 않는다.
  assert.deepEqual(masked.result.middle_payments.map((item) => [item.amount.value, item.date.value]), [[100_000_000, "2026-11-20"], [50_000_000, "2026-12-10"]]);
  assert.deepEqual([masked.result.balance.amount.value, masked.result.balance.date.value, masked.result.balance.date.evidence.page], [165_000_000, "2026-12-30", 1]);
  assert.deepEqual([masked.result.down_payment.amount.value, masked.result.down_payment.date.value], [35_000_000, "2026-11-02"]);
});
