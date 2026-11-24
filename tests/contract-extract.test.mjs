// 계약서 읽기 순수 부품(src/lib/work/contract-extract.mjs) 시험. 가짜 자료만 쓴다.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTRACT_FIELD_ORDER,
  CONTRACT_QUOTE_MAX,
  CONTRACT_TEXT_MAX,
  CONTRACT_WARNING_MAX,
  CONTRACT_WARNINGS_MAX_ITEMS,
  CONTRACT_MIDDLE_PAYMENTS_MAX,
  contractFieldOrder,
  contractMiddleOverflowWarning,
  contractInstructions,
  contractResultSchema,
  isRealDate,
  maskContractResult,
  validateContractResult,
} from "../src/lib/work/contract-extract.mjs";
import { maskResidentNumbers } from "../worker/work-input.mjs";
import { compareGroupResults } from "../src/lib/work/contract-compare.mjs";
import { aiCanApply, aiInitialChoices, aiManualProblem, aiPendingFields, aiValueText } from "../src/lib/work/contract-ai-view.mjs";
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
  for (const schema of [first, second]) {
    const json = JSON.stringify(schema);
    for (const keyword of ["maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems"]) {
      assert.equal(json.includes(`"${keyword}"`), false, `값 조건 ${keyword}는 보내지 않음(2026-11-24 운영 invalid_json_schema, 재검사에서만 봄)`);
    }
    assert.equal(json.includes('"type":["array"'), false, "null이 될 수 있는 배열은 type 배열이 아니라 anyOf");
    assert.deepEqual(schema.$defs.evidence.properties.box, { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] });
  }
  assert.equal(JSON.stringify(first).includes("name"), false, "사람 이름 칸 없음");
});

test("지시문(2026-11-24 줄임): 4줄 이하, 이름·주민번호 금지·null·날짜와 금액 꼴·근거·한글 금액은 남기고 칸별 안내·글자 수·개수 상한은 없음", () => {
  const first = contractInstructions(1);
  assert.equal(contractInstructions(2), first, "칸 안내를 뺐으므로 2회째도 같은 글(순서 차이는 스키마에만)");
  assert.ok(first.split("\n").length <= 4, "4줄 이하");
  for (const phrase of ["사람 이름·주민등록번호·전화번호·계좌번호는 어디에도 쓰지 않는다", "추측하거나 계산하지 말고 value를 null", "YYYY-MM-DD", "원 단위 정수", "page", "box", "한글 금액", "warnings"]) {
    assert.ok(first.includes(phrase), phrase);
  }
  for (const phrase of ["120자", "200자", "최대 4개", "최대 10개", "contract_date:", "balance:"]) assert.equal(first.includes(phrase), false, `지시문에 '${phrase}' 없음`);
});

test("재검사: 정상 결과는 통과하고 칸 순서를 1회째 순서로 맞춘 새 객체를 돌려준다", () => {
  const reversed = Object.fromEntries(Object.entries(sampleContract()).reverse());
  const checked = validateContractResult(reversed);
  assert.equal(checked.ok, true);
  assert.deepEqual(Object.keys(checked.result), [...CONTRACT_FIELD_ORDER]);
  assert.deepEqual(checked.result, sampleContract());
});

test("중도금 5회 이상(2026-11-24): 거절하지 않고 자리 4개를 모두 못 읽은 값으로 비우며 경고 맨 앞에 까닭을 두고, 고르기 화면은 AI 값으로 넣지 못함", () => {
  const six = Array.from({ length: 6 }, (_, index) => ({
    amount: { value: 10_000_000 * (index + 1), evidence: { page: 1, quote: `${index + 1}차 중도금`, box: null } },
    date: { value: `2027-0${index + 1}-10`, evidence: { page: 1, quote: `${index + 1}차 날짜`, box: [0.1, 0.1, 0.2, 0.2] } },
  }));
  const checked = validateContractResult(sampleContract({ middle_payments: six, warnings: Array.from({ length: CONTRACT_WARNINGS_MAX_ITEMS }, (_, index) => `경고${index + 1}`) }));
  assert.equal(checked.ok, true, "결과 전체를 버리지 않음");
  const unread = { value: null, evidence: { page: 1, quote: "", box: null } };
  assert.deepEqual(checked.result.middle_payments, Array.from({ length: CONTRACT_MIDDLE_PAYMENTS_MAX }, () => ({ amount: unread, date: unread })), "자리 4개, 날짜·금액·근거 모두 비움([] 아님)");
  assert.equal(checked.result.warnings[0], contractMiddleOverflowWarning(6));
  assert.match(checked.result.warnings[0], /^중도금이 6회 적혀 있어 거래에 다 넣을 수 없습니다\(4회까지\)\. 중도금은 사진을 보고 직접 넣어 주세요\.$/u);
  assert.equal(checked.result.warnings.length, CONTRACT_WARNINGS_MAX_ITEMS, "경고 상한 10 안에서(원래 경고는 뒤에서 하나 빠짐)");
  assert.deepEqual(checked.result.balance, sampleContract().balance, "다른 칸은 그대로");
  assert.equal(checked.result.contract_date.value, sampleContract().contract_date.value);
  assert.equal(validateContractResult(sampleContract({ middle_payments: six.slice(0, 4) })).result.middle_payments[3].date.value, "2027-04-10", "4회까지는 이전과 같음");

  // 결과 고르기: 중도금은 '읽음' 칸이지만 모든 차가 못 읽음이라 AI 값으로 넣을 수 없고 사람이 골라야 한다.
  const comparison = compareGroupResults([checked.result], "sale");
  const middle = comparison.fields.find((item) => item.field === "middlePayments");
  assert.deepEqual([middle.status, middle.first], ["read", [null, null, null, null]], "빈 배열('중도금 없음')이 아님");
  assert.equal(aiCanApply("middlePayments", middle.first), false, "'모두 AI 값으로'가 거르는 판정(aiCanApply)이 거짓");
  assert.equal(Object.hasOwn(aiInitialChoices(comparison), "middlePayments"), false, "처음 고르기에 넣지 않음");
  assert.ok(aiPendingFields(comparison, {}).includes("middlePayments"), "고르지 않으면 넣기 전에 남은 칸");
  assert.notEqual(aiManualProblem("middlePayments", middle.first), null, "못 읽은 값을 직접 넣기로 그대로 넘겨도 막힘");
  assert.equal(aiValueText("middlePayments", middle.first), "1차 못 읽음 · 2차 못 읽음 · 3차 못 읽음 · 4차 못 읽음");
  const balance = comparison.fields.find((item) => item.field === "balanceDate");
  assert.equal(aiCanApply("balanceDate", balance.first), true, "다른 칸은 AI 값으로 넣을 수 있음");
});

test("재검사(2026-11-24): 글자 칸은 상한에서 자르고 경고는 빈 것을 버린 뒤 앞 10개만, 날짜·금액 값은 자르지 않음", () => {
  const ev = (quote) => ({ page: 1, quote, box: null });
  const checked = validateContractResult(sampleContract({
    contract_date: { value: "2026-11-02", evidence: ev("가".repeat(CONTRACT_QUOTE_MAX + 5)) },
    property_text: { value: "나".repeat(CONTRACT_TEXT_MAX + 1), evidence: ev("") },
    warnings: ["", " ", ...Array.from({ length: CONTRACT_WARNINGS_MAX_ITEMS + 2 }, (_, index) => `경고${index + 1}`), "다".repeat(CONTRACT_WARNING_MAX + 1)],
  }));
  assert.equal(checked.ok, true);
  assert.equal(checked.result.contract_date.evidence.quote.length, CONTRACT_QUOTE_MAX);
  assert.equal(checked.result.contract_date.value, "2026-11-02");
  assert.equal(checked.result.property_text.value.length, CONTRACT_TEXT_MAX);
  assert.deepEqual(checked.result.warnings, Array.from({ length: CONTRACT_WARNINGS_MAX_ITEMS }, (_, index) => `경고${index + 1}`), "빈 경고를 버린 뒤 앞 10개");
  const long = validateContractResult(sampleContract({ warnings: ["다".repeat(CONTRACT_WARNING_MAX + 1)] }));
  assert.equal(long.result.warnings[0].length, CONTRACT_WARNING_MAX);
  const emoji = validateContractResult(sampleContract({ property_text: { value: `${"가".repeat(CONTRACT_TEXT_MAX - 1)}😀`, evidence: ev("") } }));
  assert.equal(emoji.result.property_text.value, "가".repeat(CONTRACT_TEXT_MAX - 1), "두 칸 글자를 반으로 가르지 않음");
});

test("재검사: 칸 누락·추가 칸·없는 날짜·음수·너무 큰 금액·중도금 5개·틀린 종류·글자 칸이 글자 아님은 모두 통과하지 못한다", () => {
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
    "넘친 중도금 모양 틀림": sampleContract({ middle_payments: [...Array.from({ length: 4 }, () => sampleContract().balance), { amount: 1, date: null }] }),
    "넘친 중도금 칸 이름 틀림": sampleContract({ middle_payments: [...Array.from({ length: 4 }, () => sampleContract().balance), { won: sampleContract().balance.amount }] }),
    "경고가 글자 아님": sampleContract({ warnings: [1] }),
    "경고가 배열 아님": sampleContract({ warnings: "가상 경고" }),
    "원문 문구가 글자 아님": sampleContract({ contract_date: { value: "2026-11-02", evidence: { page: 1, quote: null, box: null } } }),
    "물건 표시가 숫자": sampleContract({ property_text: { value: 1, evidence: { page: 1, quote: "", box: null } } }),
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
