import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEDGER_CSV_HEAD,
  basisNote,
  checkLedgerInput,
  csvCell,
  dealFeeCap,
  ledgerChanges,
  ledgerCountText,
  ledgerCsv,
  ledgerCsvFileName,
  ledgerDateText,
  ledgerErrorText,
  ledgerListQuery,
  monthRangesText,
  parseWon,
  payStateText,
  payerSides,
  summaryView,
  undatedText,
  warningTexts,
} from "../src/lib/work/ledger-view.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));

// 가상 장부 줄(실제 손님·물건이 아님)
const entry = (patch = {}) => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "fee",
  dealId: null,
  payerRole: "buyer",
  label: "가상숲1단지 84㎡ 매매",
  entryOn: null,
  amountWon: 1_800_000,
  vatWon: 180_000,
  receivedWon: 0,
  receivedOn: null,
  snapContractOn: null,
  snapBalanceOn: null,
  memo: "",
  version: 1,
  unpaidWon: 1_980_000,
  basisOn: "2026-11-20",
  warnings: [],
  ...patch,
});

test("T2-96 CSV 칸은 =·+·-·@·탭·CR로 시작하면 앞에 '를 붙여 엑셀 수식으로 읽히지 않는다", () => {
  for (const text of ["=1+1", "+82", "-3", "@SUM(A1)", "\tx", "\rx", "=HYPERLINK(\"http://x\")"]) {
    const cell = csvCell(text);
    assert.ok(cell.startsWith("'") || cell.startsWith("\"'"), `${JSON.stringify(text)} → ${cell}`);
  }
  assert.equal(csvCell("=1+1"), "'=1+1");
  assert.equal(csvCell("=HYPERLINK(\"http://x\")"), "\"'=HYPERLINK(\"\"http://x\"\")\"");
  // 보통 글자·숫자는 그대로, 쉼표·따옴표·줄바꿈은 따옴표로 감싼다
  assert.equal(csvCell("가상숲 84㎡"), "가상숲 84㎡");
  assert.equal(csvCell("a,b"), "\"a,b\"");
  assert.equal(csvCell("한 줄\n두 줄"), "\"한 줄\n두 줄\"");
  // 금액 칸(숫자)은 음수가 아니어도 숫자 그대로 둔다. 숫자가 아니면 빈칸
  assert.equal(csvCell(1_980_000), "1980000");
  assert.equal(csvCell(Number.NaN), "");
  assert.equal(csvCell(null), "");
});

test("T2-96 CSV 파일은 UTF-8 BOM + CRLF이고, 물건 표시·메모의 수식 글자를 막는다", () => {
  const csv = ledgerCsv([
    entry({ label: "=cmd|' /C calc'!A0", memo: "@메모", receivedWon: 1_980_000, receivedOn: "2026-11-21", unpaidWon: 0, warnings: ["VAT_DIFFERS"], vatWon: 100_000 }),
    entry({ kind: "expense", payerRole: null, label: "광고비", amountWon: 50_000, vatWon: 0, unpaidWon: 0, basisOn: "2026-11-02" }),
  ]);
  assert.ok(csv.startsWith("﻿"), "BOM");
  assert.ok(csv.endsWith("\r\n"));
  const lines = csv.slice(1).split("\r\n");
  assert.equal(lines.length, 4, "머리 + 2줄 + 끝 빈 줄");
  assert.equal(lines[0], LEDGER_CSV_HEAD.join(","));
  assert.match(lines[1], /^2026-11-20,보수,매수인,'=cmd\|' \/C calc'!A0,1800000,100000,1900000,1980000,2026-11-21,0,"부가세가 10%와 다릅니다\(10%면 180,000원\)",/u);
  assert.ok(lines[1].endsWith(",'@메모"), lines[1]);
  assert.equal(lines[2], "2026-11-02,지출,,광고비,50000,0,50000,0,,0,,");
  assert.equal(ledgerCsvFileName(2026, "received"), "매출장부-2026-입금일기준.csv");
  assert.equal(ledgerCsvFileName(2026, "모름"), "매출장부-2026-잔금일기준.csv");
});

test("받을 돈 상태는 미입금·일부 입금·초과 입금·입금 끝·지출을 글자로 알린다", () => {
  assert.deepEqual(payStateText(entry(), 2026), { state: "due", text: "미입금 1,980,000원" });
  assert.equal(payStateText(entry({ receivedWon: 980_000, receivedOn: "2026-11-21" }), 2026).text, "미입금 1,000,000원 (일부 입금 980,000원)");
  assert.deepEqual(payStateText(entry({ receivedWon: 2_000_000, receivedOn: "2026-11-21" }), 2026), { state: "over", text: "초과 입금 20,000원" });
  assert.deepEqual(payStateText(entry({ receivedWon: 1_980_000, receivedOn: "2026-11-21" }), 2026), { state: "paid", text: "입금 끝 11. 21." });
  assert.equal(payStateText(entry({ receivedWon: 1_980_000, receivedOn: "2025-12-30" }), 2026).text, "입금 끝 2025. 12. 30.");
  assert.equal(payStateText(entry({ kind: "expense" }), 2026).state, "none");
  assert.equal(ledgerDateText("", 2026), "");
});

test("서버 경고 코드는 굵게 보일 문장으로 바뀌고, 부가세는 10%면 얼마인지 함께 적는다", () => {
  assert.deepEqual(warningTexts(entry()), []);
  const texts = warningTexts(entry({ amountWon: 1_000_000, vatWon: 0, warnings: ["FEE_OVER_CAP", "VAT_DIFFERS", "모르는 코드"] }));
  assert.equal(texts.length, 2);
  assert.match(texts[0], /법정 상한보다 큽니다/u);
  assert.match(texts[1], /10%면 100,000원/u);
});

test("기준일 안내와 기준일 없는 줄 알림은 기준마다 글이 다르다(⑤ 문구 가)", () => {
  assert.equal(basisNote("received"), "입금일 기준 · 지출은 잔금일(거래 없는 지출은 지출일)로 셈");
  assert.equal(basisNote("balance"), "잔금일 기준");
  assert.equal(basisNote("contract"), "계약일 기준");
  assert.equal(undatedText("balance", 0), "");
  assert.equal(undatedText("contract", 2), "계약일이 없는 장부 줄 2건은 합계에 없습니다.");
  assert.match(undatedText("received", 3), /입금일이 없는 장부 줄 3건\(아직 입금 전 포함\)/u);
});

test("빈 달은 '1 ~ 8월, 12월'처럼 줄여 적는다", () => {
  assert.equal(monthRangesText([1, 2, 3, 4, 5, 6, 7, 8, 12]), "1 ~ 8월, 12월");
  assert.equal(monthRangesText([3, 4, 9]), "3월, 4월, 9월");
  assert.equal(monthRangesText([5]), "5월");
  assert.equal(monthRangesText([]), "");
});

test("합계 칸은 같은 응답으로 부가세 빼고·넣고만 바꾸고, 휴대폰 표는 값 있는 달만 최근 달부터 보인다", () => {
  const line = (month, patch = {}) => ({ month, feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 0, netWon: 0, ...patch });
  const months = Array.from({ length: 12 }, (_, index) => line(`2026-${String(index + 1).padStart(2, "0")}`));
  months[9] = line("2026-10", { feeWon: 1_000_000, vatWon: 100_000, feeWithVatWon: 1_100_000, receivedWon: 1_100_000, netWon: 1_000_000 });
  months[10] = line("2026-11", { feeWon: 1_800_000, vatWon: 180_000, feeWithVatWon: 1_980_000, unpaidWon: 1_980_000, expenseWon: 50_000, netWon: 1_750_000 });
  const total = line(undefined, { feeWon: 2_800_000, vatWon: 280_000, feeWithVatWon: 3_080_000, receivedWon: 1_100_000, unpaidWon: 1_980_000, expenseWon: 50_000, netWon: 2_750_000 });
  const summary = { year: "2026", months, total, undatedCount: 0 };
  const plain = summaryView(summary);
  assert.equal(plain.tiles[0].value, "2,800,000원");
  assert.equal(plain.tiles[0].note, "부가세 280,000원 따로");
  assert.equal(plain.tiles[2].due, true);
  // 입금·미입금은 부가세 빼고에서도 부가세 포함임을 밝힌다
  assert.equal(plain.tiles[1].note, "부가세 포함 · 보수와 기타 수입");
  assert.equal(plain.tiles[2].note, "부가세 포함 · 보수와 기타 수입");
  assert.deepEqual(plain.wideHead.slice(3, 5), ["입금(부가세 포함)", "미입금(부가세 포함)"]);
  assert.deepEqual(plain.narrowRows.map((row) => row.month), ["11월", "10월"]);
  assert.equal(plain.emptyText, "1 ~ 9월, 12월은 장부 줄이 없습니다.");
  assert.equal(plain.wideRows.length, 12);
  assert.equal(plain.wideHead.length, plain.wideRows[0].cells.length + 1);
  assert.equal(plain.isEmpty, false);
  const withVat = summaryView(summary, { vat: true });
  assert.equal(withVat.tiles[0].value, "3,080,000원");
  assert.equal(withVat.narrowRows[0].fee, "1,980,000");
  assert.equal(withVat.wideHead.length, plain.wideHead.length - 1, "부가세 넣고면 부가세 칸이 빠짐");
  assert.equal(withVat.wideTotal.length, withVat.wideRows[0].cells.length);
  const empty = summaryView({ year: "2026", months: months.map((item) => line(item.month)), total: line(undefined), undatedCount: 0 });
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.emptyText, "이 해에는 합계에 들어간 장부 줄이 없습니다.");
});

test("목록 요청 조건은 연도·기준·종류·미입금·거래·다음 쪽만 넣고, 모르는 기준은 잔금일로 둔다", () => {
  assert.equal(ledgerListQuery({ year: 2026 }).toString(), "year=2026&basis=balance&limit=50");
  assert.equal(ledgerListQuery({ year: 2026, basis: "received", kind: "fee", unpaid: true, cursor: "c1" }).toString(), "basis=received&kind=fee&unpaid=1&cursor=c1&limit=50");
  assert.equal(ledgerListQuery({ year: 2026, basis: "x", all: true, dealId: "d1", limit: 20 }).toString(), "basis=balance&dealId=d1&limit=20");
  // 입금일 기준 + 미입금만은 연도 없이(아직 입금일이 없는 줄이 빠지지 않게), 다른 기준의 미입금만은 연도로 거름
  assert.equal(ledgerListQuery({ year: 2026, basis: "received", unpaid: true }).toString(), "basis=received&unpaid=1&limit=50");
  assert.equal(ledgerListQuery({ year: 2026, basis: "contract", unpaid: true }).toString(), "year=2026&basis=contract&unpaid=1&limit=50");
  assert.equal(ledgerListQuery({ year: 2026, basis: "received" }).toString(), "year=2026&basis=received&limit=50");
  assert.equal(ledgerCountText(3), "장부 줄 3개 · 기준일 최근 순");
  assert.equal(ledgerCountText(50, { more: true, unpaid: true }), "장부 줄 50개 이상 · 미입금 큰 순");
  assert.equal(ledgerCountText(2, { undated: true, basis: "contract" }), "계약일이 없는 장부 줄 2개");
});

test("금액 칸은 쉼표·원·띄어쓰기를 지우고 정수만 받는다", () => {
  assert.equal(parseWon("1,800,000"), 1_800_000);
  assert.equal(parseWon(" 180 000원 "), 180_000);
  assert.equal(parseWon(""), null);
  assert.ok(Number.isNaN(parseWon("1.5")));
  assert.ok(Number.isNaN(parseWon("-1")));
  assert.ok(Number.isNaN(parseWon("9".repeat(16))));
});

test("입력 검사는 서버 규칙(assertLedgerState)과 같다: 입금액과 입금일은 함께, 지출은 입금 없음, 거래 없는 지출·기타 수입은 날짜 필수", () => {
  const ok = checkLedgerInput({ amount: "1,800,000", vat: "180,000", received: "1,980,000", receivedOn: "2026-11-21", entryOn: "", label: "  가상숲   1단지 ", memo: "메모\r\n둘째 줄", payerRole: "seller" }, { kind: "fee" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_980_000, receivedOn: "2026-11-21", entryOn: null, label: "가상숲 1단지", memo: "메모\n둘째 줄", payerRole: "seller" });
  assert.deepEqual(checkLedgerInput({ amount: "", received: "100", receivedOn: "" }, { kind: "fee" }).errors, { amount: "금액을 넣어 주세요.", receivedOn: "입금액이 있으면 입금일을 넣어 주세요." });
  assert.equal(checkLedgerInput({ amount: "1", received: "0", receivedOn: "2026-11-21" }, { kind: "fee" }).errors.receivedOn, "입금액이 0원이면 입금일을 비워 주세요.");
  assert.equal(checkLedgerInput({ amount: "1", receivedOn: "2026-02-30" }, { kind: "other_income" }).errors.receivedOn, "입금일을 달력에서 골라 주세요.");
  // 지출: 입금 칸은 무시하고 0·없음으로 보낸다. 낸 쪽은 보수 줄만
  const expense = checkLedgerInput({ amount: "50000", received: "999", receivedOn: "2026-11-21", entryOn: "2026-11-02", payerRole: "buyer" }, { kind: "expense", needsEntryOn: true });
  assert.equal(expense.ok, true);
  assert.equal(expense.value.receivedWon, 0);
  assert.equal(expense.value.receivedOn, null);
  assert.equal("payerRole" in expense.value, false);
  assert.equal(checkLedgerInput({ amount: "50000" }, { kind: "expense", needsEntryOn: true }).errors.entryOn, "거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.");
  // 거래에 이은 줄은 날짜를 보내지 않는다
  assert.equal("entryOn" in checkLedgerInput({ amount: "1", entryOn: "2026-11-02" }, { kind: "fee", hasDeal: true }).value, false);
  assert.equal(checkLedgerInput({ amount: "1", label: "가".repeat(121) }, { kind: "fee" }).errors.label, "물건 표시·내용은 120자까지입니다.");
  assert.equal(checkLedgerInput({ amount: "1", memo: "가".repeat(501) }, { kind: "fee" }).errors.memo, "메모는 500자까지입니다.");
  assert.equal(checkLedgerInput({ amount: "1" }, { kind: "모름" }).ok, false);
  assert.equal(checkLedgerInput({ amount: "1", payerRole: "owner" }, { kind: "fee" }).value.payerRole, null);
});

test("고치기는 바뀐 칸만 보내고, 입금액·입금일은 하나만 바뀌어도 둘 다 보낸다", () => {
  const before = entry({ receivedWon: 0, receivedOn: null, memo: "" });
  assert.deepEqual(ledgerChanges(before, { amountWon: 1_800_000, vatWon: 180_000, receivedWon: 0, receivedOn: null, label: before.label, memo: "", payerRole: "buyer" }), {});
  assert.deepEqual(ledgerChanges(before, { amountWon: 1_800_000, receivedWon: 1_980_000, receivedOn: "2026-11-21" }), { receivedWon: 1_980_000, receivedOn: "2026-11-21" });
  const paid = entry({ receivedWon: 1_980_000, receivedOn: "2026-11-21" });
  assert.deepEqual(ledgerChanges(paid, { receivedWon: 1_980_000, receivedOn: "2026-11-22" }), { receivedWon: 1_980_000, receivedOn: "2026-11-22" });
  assert.deepEqual(ledgerChanges(paid, { memo: "새 메모" }), { memo: "새 메모" });
});

test("법정 상한 채우기는 주택 거래만 하고, 그 밖에는 까닭만 알린다", () => {
  const deal = { dealType: "sale", propertyKind: "housing", contractOn: "2026-11-01", priceWon: 450_000_000, depositWon: null, monthlyRentWon: null };
  const cap = dealFeeCap(deal, legalRules);
  assert.equal(cap.ok, true);
  assert.equal(cap.maxFeeWon, 1_800_000);
  assert.equal(cap.vatWon, 180_000);
  assert.equal(cap.text, "법정 상한 1,800,000원 + 부가세 180,000원");
  for (const [patch, pattern] of [
    [{ propertyKind: "officetel" }, /주택이 아닌 거래/u],
    [{ propertyKind: "land" }, /주택이 아닌 거래/u],
    [{ dealType: "exchange" }, /교환 거래/u],
    [{ contractOn: null }, /계약일이 없어/u],
    [{ contractOn: "1990-01-01" }, /법령 자료 범위 밖/u],
    [{ priceWon: null }, /거래 금액이 비어/u],
  ]) {
    const result = dealFeeCap({ ...deal, ...patch }, legalRules);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.match(result.reason, pattern);
  }
  assert.equal(dealFeeCap(null, legalRules).ok, false);
});

test("보수 줄 만들기의 낸 쪽은 거래에 손님으로 붙은 쪽을 미리 고르고, 둘 다면 쌍방이다", () => {
  const checked = (sides) => sides.filter((side) => side.checked).map((side) => side.role);
  assert.deepEqual(payerSides("sale", ["seller"]).map((side) => side.role), ["buyer", "seller"]);
  assert.deepEqual(checked(payerSides("sale", ["seller"])), ["seller"]);
  assert.deepEqual(checked(payerSides("sale", ["buyer", "seller"])), ["buyer", "seller"]);
  assert.deepEqual(checked(payerSides("jeonse", [])), ["tenant"]);
  assert.deepEqual(checked(payerSides("monthly_rent", ["landlord", "other"])), ["landlord"]);
  assert.deepEqual(payerSides("모름", []).map((side) => side.label), ["매수인", "매도인"]);
});

test("장부 오류 문장은 장부 전용 문장이 있는 코드만 바꾸고 나머지는 받은 문장을 쓴다", () => {
  assert.match(ledgerErrorText("WORK_SCHEMA_OUTDATED"), /구조\(5번\)/u);
  assert.match(ledgerErrorText("VERSION_CONFLICT"), /'새 값 보기'/u);
  assert.equal(ledgerErrorText("STORAGE_UNAVAILABLE", "손님 문장"), "손님 문장");
});
