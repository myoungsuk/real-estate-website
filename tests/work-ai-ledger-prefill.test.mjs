import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateBrokerageFee, calculateVatWon } from "../src/lib/work/brokerage-fee.mjs";
import { dealFeeCap, numberText } from "../src/lib/work/ledger-view.mjs";
import {
  aiLedgerButtonText,
  aiLedgerDoneText,
  aiLedgerExistingText,
  aiLedgerFeeCount,
  aiLedgerPartialText,
  aiLedgerPrefill,
  aiLedgerVatFollow,
} from "../src/lib/work/ai-ledger-prefill.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));
const sale = { id: "d1", title: "가상단지 매매", dealType: "sale", propertyKind: "housing", contractOn: "2026-11-02", priceWon: 350_000_000, depositWon: null, monthlyRentWon: null };

test("주택 거래는 손님 카드 '보수 줄 만들기'와 같은 법정 상한·부가세로 낸 쪽마다 채운다", () => {
  const prefill = aiLedgerPrefill(sale, ["buyer"], legalRules);
  const cap = dealFeeCap(sale, legalRules);
  assert.equal(prefill.filled, true);
  assert.equal(cap.maxFeeWon, 1_400_000, "3억5천만 원 매매 0.4%");
  assert.deepEqual(prefill.sides.map(({ role, checked, amountText, vatText }) => [role, checked, amountText, vatText]), [
    ["buyer", true, "1,400,000", "140,000"],
    ["seller", false, "1,400,000", "140,000"],
  ]);
  assert.match(prefill.lead, /법정 상한 1,400,000원 \+ 부가세 140,000원/u);
  assert.match(prefill.lead, /아직 장부에 넣지 않았습니다/u);
  // 새 계산식이 없다: 중개보수 계산 화면의 함수와 같은 값이다.
  const fee = calculateBrokerageFee({ contractDate: sale.contractOn, dealType: "sale", propertyKind: "housing", officetelConditions: {}, priceWon: sale.priceWon, vatDisplay: true }, legalRules);
  assert.equal(fee.maxFeeWon, cap.maxFeeWon);
  assert.equal(fee.vatWon, cap.vatWon);
});

test("고가 구간도 주택이면 법정 상한 요율로 채우고, 쌍방이면 두 쪽 다 고른다", () => {
  const prefill = aiLedgerPrefill({ ...sale, priceWon: 1_600_000_000 }, ["buyer", "seller"], legalRules);
  assert.deepEqual(prefill.sides.map((side) => [side.checked, side.amountText]), [[true, "11,200,000"], [true, "11,200,000"]], "15억 이상 0.7%");
  const lease = aiLedgerPrefill({ ...sale, dealType: "monthly_rent", priceWon: null, depositWon: 10_000_000, monthlyRentWon: 500_000 }, ["tenant"], legalRules);
  assert.equal(lease.filled, true);
  assert.deepEqual(lease.sides.map((side) => side.role), ["tenant", "landlord"]);
});

test("주택 밖·교환·계약일이나 금액이 비면 빈칸으로 두고 까닭을 적는다", () => {
  for (const [patch, pattern] of [
    [{ propertyKind: "other" }, /주택이 아닌 거래/u],
    [{ propertyKind: "land" }, /주택이 아닌 거래/u],
    [{ dealType: "exchange" }, /교환 거래/u],
    [{ contractOn: null }, /계약일이 없어/u],
    [{ priceWon: null }, /금액이 비어/u],
  ]) {
    const prefill = aiLedgerPrefill({ ...sale, ...patch }, ["buyer"], legalRules);
    assert.equal(prefill.filled, false, JSON.stringify(patch));
    assert.match(prefill.lead, pattern);
    assert.match(prefill.lead, /^보수를 미리 채우지 않았습니다\. /u);
    assert.ok(prefill.sides.every((side) => side.amountText === "" && side.vatText === ""));
  }
});

test("보수 줄 수는 보수만 세고, 이미 있으면 채우지 않는다는 글을 낸다", () => {
  assert.equal(aiLedgerFeeCount([{ kind: "fee" }, { kind: "expense" }, { kind: "fee" }, { kind: "other_income" }]), 2);
  assert.equal(aiLedgerFeeCount([]), 0);
  assert.equal(aiLedgerExistingText(2), "이 거래에는 보수 줄이 이미 2줄 있어 새로 채우지 않았습니다. 고칠 것은 손님 카드의 '장부 보기'나 매출장부에서 고쳐 주세요.");
  assert.match(aiLedgerExistingText(50, true), /50줄 이상/u);
});

test("단추·결과 글", () => {
  assert.equal(aiLedgerButtonText(0), "장부에 넣기");
  assert.equal(aiLedgerButtonText(2), "장부에 넣기 (보수 줄 2개)");
  assert.match(aiLedgerDoneText(1, false), /^✓ 보수 줄 1개를 장부에 넣었습니다\. 보수를 받으면/u);
  assert.match(aiLedgerDoneText(2, true), /경고가 있습니다/u);
  assert.match(aiLedgerPartialText(1, "가상 까닭."), /^보수 줄 1개만 넣었습니다\. 나머지는 넣지 못했습니다\. 가상 까닭\. /u);
});

test("공급가액을 고치면 부가세가 10%였을 때만 따라 바뀐다(매출장부 표와 같은 규칙)", () => {
  assert.equal(aiLedgerVatFollow(1_400_000, "140,000", "1,000,000"), "100,000");
  assert.equal(aiLedgerVatFollow(1_400_000, "140,000", "1000005"), numberText(calculateVatWon(1_000_005)), "원 미만 버림");
  assert.equal(aiLedgerVatFollow(1_400_000, "0", "1,000,000"), null, "부가세를 0원으로 고쳤으면 그대로");
  assert.equal(aiLedgerVatFollow(1_400_000, "130,000", "1,000,000"), null, "부가세를 따로 고쳤으면 그대로");
  assert.equal(aiLedgerVatFollow(1_400_000, "140,000", "백만"), null, "숫자가 아니면 그대로");
  assert.equal(aiLedgerVatFollow(1_400_000, "140,000", ""), "", "공급가액을 비우면 부가세도 비움");
  assert.equal(aiLedgerVatFollow(0, "", "900,000"), "90,000", "빈칸에서 처음 넣을 때도 10%");
});
