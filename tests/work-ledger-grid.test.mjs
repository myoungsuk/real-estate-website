// 매출장부 PC 표에서 칸을 바로 고치는 규칙(src/lib/work/ledger-grid.mjs)을 본다. 금액·이름은 모두 지어낸 값이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LEDGER_ASK_DATE_NOTE,
  LEDGER_GRID_COLUMNS,
  LEDGER_UNDO_LIMIT,
  basisAfterSave,
  changesBefore,
  createLedgerHistory,
  gridCellEditable,
  gridCellLabel,
  gridCellText,
  gridColumnName,
  gridEditText,
  gridHeadText,
  gridPayState,
  historyButtonLabel,
  historyStepTitle,
  ledgerGroupLine,
  ledgerGroupPlan,
  moveGridFocus,
  movedNote,
  planCellEdit,
  typedText,
} from "../src/lib/work/ledger-grid.mjs";

const entry = (patch = {}) => ({
  id: "a", kind: "fee", dealId: "d1", payerRole: "seller", label: "가상숲1단지 84㎡ 매매", entryOn: null, amountWon: 1_800_000, vatWon: 180_000,
  receivedWon: 0, receivedOn: null, snapContractOn: null, snapBalanceOn: null, memo: "", version: 3, basisOn: "2026-11-20", unpaidWon: 1_980_000, ...patch,
});
const expense = (patch = {}) => entry({ id: "e", kind: "expense", dealId: null, payerRole: null, label: "가상 전단 인쇄", entryOn: "2026-11-02", basisOn: "2026-11-02", amountWon: 50_000, vatWon: 0, unpaidWon: 0, ...patch });
const other = (patch = {}) => entry({ id: "o", kind: "other_income", dealId: null, payerRole: null, label: "가상 강의료", entryOn: "2026-10-15", basisOn: "2026-10-15", amountWon: 300_000, vatWon: 0, receivedWon: 300_000, receivedOn: "2026-10-16", unpaidWon: 0, ...patch });

test("표 칸은 10개이고 머리글은 기준과 상관없이 같다", () => {
  assert.deepEqual([...LEDGER_GRID_COLUMNS], ["basisOn", "kind", "label", "payerRole", "amountWon", "vatWon", "totalWon", "receivedWon", "receivedOn", "unpaidWon"]);
  assert.deepEqual(LEDGER_GRID_COLUMNS.map((column) => gridHeadText(column)), ["기준일", "종류", "물건 표시·내용", "낸 쪽", "공급가액(원)", "부가세(원)", "받을 금액", "입금액(원)", "입금일", "미입금"]);
  assert.equal(LEDGER_UNDO_LIMIT, 20);
});

test("고칠 수 있는 칸: 종류·받을 금액·미입금은 못 고치고, 낸 쪽은 보수만, 입금 칸은 지출이 아닐 때만, 날짜는 처음부터 거래가 없던 줄만", () => {
  const editable = (item, basis) => LEDGER_GRID_COLUMNS.filter((column) => gridCellEditable(item, column, basis));
  assert.deepEqual(editable(entry()), ["label", "payerRole", "amountWon", "vatWon", "receivedWon", "receivedOn"], "거래에 이은 보수 줄의 날짜는 거래의 날짜");
  assert.deepEqual(editable(expense()), ["basisOn", "label", "amountWon", "vatWon"]);
  assert.deepEqual(editable(other()), ["basisOn", "label", "amountWon", "vatWon", "receivedWon", "receivedOn"]);
  assert.deepEqual(editable(other(), "received"), ["label", "amountWon", "vatWon", "receivedWon", "receivedOn"], "입금일 기준의 첫 칸은 입금일이라 '입금일' 칸에서 고침");
  assert.deepEqual(editable(expense(), "received"), ["basisOn", "label", "amountWon", "vatWon"], "지출은 입금일 기준에서도 줄의 날짜");
  assert.equal(gridCellEditable(entry({ dealId: null, snapBalanceOn: "2026-11-20" }), "basisOn"), false, "거래 연결이 끊긴 줄의 날짜는 옮겨 둔 거래 날짜");
  assert.equal(gridCellEditable(entry({ dealId: null }), "basisOn"), true, "거래 없는 보수 줄");
  assert.equal(gridCellEditable(null, "label"), false);
});

test("칸에 보이는 글·고치기 시작 글·단추 이름", () => {
  const fee = entry({ receivedWon: 1_980_000, receivedOn: "2026-11-20" });
  assert.deepEqual(LEDGER_GRID_COLUMNS.slice(0, 9).map((column) => gridCellText(fee, column, 2026)), ["11. 20.", "보수", "가상숲1단지 84㎡ 매매", "매도인", "1,800,000", "180,000", "1,980,000", "1,980,000", "11. 20."]);
  assert.deepEqual(LEDGER_GRID_COLUMNS.slice(0, 9).map((column) => gridCellText(expense(), column, 2026)), ["11. 2.", "지출", "가상 전단 인쇄", "—", "50,000", "—", "", "—", "—"], "지출은 받을 금액을 비움");
  assert.equal(gridCellText(entry({ basisOn: null, label: "" }), "basisOn", 2026), "기준일 없음");
  assert.equal(gridCellText(entry({ label: "" }), "label", 2026), "(물건 표시 없음)");
  assert.equal(gridCellText(entry({ vatWon: 0 }), "vatWon", 2026), "0", "보수 줄의 부가세 0은 숫자로");
  assert.deepEqual(["basisOn", "label", "payerRole", "amountWon", "vatWon", "receivedWon", "receivedOn"].map((column) => gridEditText(other(), column)), ["2026-10-15", "가상 강의료", "", "300,000", "0", "300,000", "2026-10-16"]);
  assert.equal(gridCellLabel(entry(), "receivedWon", 2026), "11. 20. 가상숲1단지 84㎡ 매매 매도인 입금액 고치기");
  assert.equal(gridCellLabel(expense({ label: "" }), "basisOn", 2026, "balance"), "11. 2. 지출 날짜 고치기(잔금일 기준)");
});

test("공급가액: 고치기 전 부가세가 10%였던 줄만 부가세를 함께 바꾸고, 따로 넣은 부가세는 건드리지 않는다", () => {
  assert.deepEqual(planCellEdit(entry(), "amountWon", "1,500,000"), { kind: "save", changes: { amountWon: 1_500_000, vatWon: 150_000 }, note: "부가세도 150,000원으로 함께 바꿨습니다(고치기 전 부가세가 공급가액의 10%였던 줄)." });
  assert.deepEqual(planCellEdit(entry({ vatWon: 100_000 }), "amountWon", "1500000"), { kind: "save", changes: { amountWon: 1_500_000 }, note: "" }, "따로 넣은 부가세");
  assert.deepEqual(planCellEdit(expense(), "amountWon", "60000원"), { kind: "save", changes: { amountWon: 60_000 }, note: "" }, "부가세 0원인 지출 줄");
  assert.deepEqual(planCellEdit(expense({ amountWon: 0 }), "amountWon", "60000"), { kind: "save", changes: { amountWon: 60_000 }, note: "" }, "0원·0원 지출 줄은 따르지 않음");
  assert.deepEqual(planCellEdit(entry({ amountWon: 0, vatWon: 0 }), "amountWon", "1000000").changes, { amountWon: 1_000_000, vatWon: 100_000 }, "0원·0원 보수 줄은 따름");
  assert.deepEqual(planCellEdit(expense({ amountWon: 50_000, vatWon: 5_000 }), "amountWon", "70000").changes, { amountWon: 70_000, vatWon: 7_000 }, "10%를 넣어 둔 지출 줄");
  assert.deepEqual(planCellEdit(entry(), "amountWon", "1,800,000"), { kind: "none" });
  assert.deepEqual(planCellEdit(entry(), "amountWon", ""), { kind: "error", message: "금액을 넣어 주세요." });
  assert.deepEqual(planCellEdit(entry(), "amountWon", "-5"), { kind: "error", message: "금액은 숫자로만 넣어 주세요." });
  assert.deepEqual(planCellEdit(entry(), "amountWon", "백만"), { kind: "error", message: "금액은 숫자로만 넣어 주세요." });
});

test("부가세·물건 표시·낸 쪽: 그 칸만 보내고 같은 값이면 보내지 않는다", () => {
  assert.deepEqual(planCellEdit(entry(), "vatWon", ""), { kind: "save", changes: { vatWon: 0 }, note: "" }, "비우면 0원");
  assert.deepEqual(planCellEdit(entry(), "vatWon", "180,000"), { kind: "none" });
  assert.deepEqual(planCellEdit(entry(), "vatWon", "1.5"), { kind: "error", message: "부가세는 숫자로만 넣어 주세요." });
  assert.deepEqual(planCellEdit(entry(), "label", "  가상숲2단지   59㎡  전세 "), { kind: "save", changes: { label: "가상숲2단지 59㎡ 전세" }, note: "" });
  assert.deepEqual(planCellEdit(entry(), "label", " 가상숲1단지  84㎡ 매매 "), { kind: "none" }, "빈칸만 다르면 같은 값");
  assert.equal(planCellEdit(entry(), "label", "가".repeat(121)).kind, "error");
  assert.deepEqual(planCellEdit(entry(), "payerRole", "buyer"), { kind: "save", changes: { payerRole: "buyer" }, note: "" });
  assert.deepEqual(planCellEdit(entry(), "payerRole", ""), { kind: "save", changes: { payerRole: null }, note: "" });
  assert.deepEqual(planCellEdit(entry(), "payerRole", "seller"), { kind: "none" });
  assert.deepEqual(planCellEdit(entry(), "kind", "expense"), { kind: "none" }, "종류는 고치지 않음");
});

test("입금액·입금일은 늘 함께 보낸다: 입금일이 빈 줄에 입금액을 넣으면 저장하지 않고 입금일을 묻는다", () => {
  assert.deepEqual(planCellEdit(entry(), "receivedWon", "1,980,000"), { kind: "ask-date", carry: { receivedWon: 1_980_000 }, message: LEDGER_ASK_DATE_NOTE });
  assert.deepEqual(planCellEdit(entry(), "receivedOn", "2026-11-23", { carry: { receivedWon: 1_980_000 } }), { kind: "save", changes: { receivedWon: 1_980_000, receivedOn: "2026-11-23" }, note: "입금액과 입금일(2026-11-23)을 함께 저장했습니다." });
  assert.deepEqual(planCellEdit(entry(), "receivedOn", "", { carry: { receivedWon: 1_980_000 } }), { kind: "error", message: "입금액이 있으면 입금일을 넣어 주세요." });
  const paid = entry({ receivedWon: 1_000_000, receivedOn: "2026-11-20" });
  assert.deepEqual(planCellEdit(paid, "receivedWon", "1,980,000"), { kind: "save", changes: { receivedWon: 1_980_000, receivedOn: "2026-11-20" }, note: "" }, "입금일이 있으면 바로 저장");
  assert.deepEqual(planCellEdit(paid, "receivedWon", "0"), { kind: "save", changes: { receivedWon: 0, receivedOn: null }, note: "입금액이 0원이라 입금일도 함께 비웠습니다." });
  assert.deepEqual(planCellEdit(paid, "receivedWon", ""), { kind: "save", changes: { receivedWon: 0, receivedOn: null }, note: "입금액이 0원이라 입금일도 함께 비웠습니다." });
  assert.deepEqual(planCellEdit(paid, "receivedWon", "1,000,000"), { kind: "none" });
  assert.deepEqual(planCellEdit(paid, "receivedOn", "2026-11-21"), { kind: "save", changes: { receivedWon: 1_000_000, receivedOn: "2026-11-21" }, note: "" });
  assert.deepEqual(planCellEdit(paid, "receivedOn", "2026-11-20"), { kind: "none" });
  assert.deepEqual(planCellEdit(paid, "receivedOn", ""), { kind: "error", message: "입금액이 있으면 입금일을 넣어 주세요." });
  assert.deepEqual(planCellEdit(paid, "receivedOn", "2026-02-30"), { kind: "error", message: "입금일을 달력에서 골라 주세요." });
  assert.deepEqual(planCellEdit(entry(), "receivedOn", "2026-11-20"), { kind: "error", message: "입금액이 0원이면 입금일을 비워 주세요." });
  assert.deepEqual(planCellEdit(entry(), "receivedWon", "12a"), { kind: "error", message: "입금액은 숫자로만 넣어 주세요." });
});

test("날짜(거래 없는 줄): 지출·기타 수입은 비울 수 없고 보수는 비울 수 있다", () => {
  assert.deepEqual(planCellEdit(expense(), "basisOn", "2026-10-30"), { kind: "save", changes: { entryOn: "2026-10-30" }, note: "" });
  assert.deepEqual(planCellEdit(expense(), "basisOn", "2026-11-02"), { kind: "none" });
  assert.deepEqual(planCellEdit(expense(), "basisOn", ""), { kind: "error", message: "거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다." });
  assert.deepEqual(planCellEdit(expense(), "basisOn", "2026-13-01"), { kind: "error", message: "날짜를 달력에서 골라 주세요." });
  assert.deepEqual(planCellEdit(entry({ dealId: null, entryOn: "2026-11-01" }), "basisOn", ""), { kind: "save", changes: { entryOn: null }, note: "" });
});

test("되돌리기 묶음: 서버가 받아 준 뒤에만 단계를 옮기고, 20단계를 넘으면 오래된 것부터 버리며, 새로 고치면 다시 하기는 비운다", () => {
  assert.deepEqual(changesBefore(entry(), { amountWon: 1_500_000, vatWon: 150_000 }), { amountWon: 1_800_000, vatWon: 180_000 });
  assert.deepEqual(changesBefore(entry(), { receivedWon: 5, receivedOn: "2026-11-23" }), { receivedWon: 0, receivedOn: null });
  const history = createLedgerHistory();
  assert.equal(history.peekUndo(), null);
  assert.deepEqual(history.counts(), { undo: 0, redo: 0 });
  const step = (n, id = "a") => ({ id, title: `줄 ${n}`, before: { amountWon: n }, after: { amountWon: n + 1 } });
  history.record(step(1));
  history.record(step(2, "b"));
  assert.equal(history.peekUndo().title, "줄 2");
  assert.deepEqual(history.counts(), { undo: 2, redo: 0 }, "peek은 단계를 옮기지 않음(저장이 실패하면 그대로 남음)");
  history.doneUndo();
  assert.deepEqual(history.counts(), { undo: 1, redo: 1 });
  assert.equal(history.peekRedo().title, "줄 2");
  assert.equal(history.peekUndo().title, "줄 1");
  history.doneRedo();
  assert.deepEqual(history.counts(), { undo: 2, redo: 0 });
  history.doneUndo();
  history.record(step(3));
  assert.deepEqual(history.counts(), { undo: 2, redo: 0 }, "새로 고치면 다시 하기는 비움");
  history.doneUndo();
  history.forget("a");
  assert.deepEqual(history.counts(), { undo: 0, redo: 0 }, "지워진 줄의 단계는 양쪽에서 버림");
  for (let n = 1; n <= 25; n += 1) history.record(step(n));
  assert.deepEqual(history.counts(), { undo: 20, redo: 0 });
  for (let n = 0; n < 19; n += 1) history.doneUndo();
  assert.equal(history.peekUndo().title, "줄 6", "가장 오래 남은 것은 6번째");
  history.clear();
  assert.deepEqual(history.counts(), { undo: 0, redo: 0 });
  assert.equal(historyStepTitle(entry(), "receivedWon"), "가상숲1단지 84㎡ 매매 입금액");
  assert.equal(historyStepTitle(expense({ label: "" }), "basisOn"), "지출 날짜");
  assert.equal(historyButtonLabel("undo", { title: "가상 강의료 공급가액" }), "되돌리기: 가상 강의료 공급가액");
  assert.equal(historyButtonLabel("redo", null), "다시 하기");
});

test("기준일이 다른 달이 되면 '몇 월로 옮겨짐'을 붙이고, 같은 달이면 붙이지 않는다", () => {
  assert.equal(movedNote("2026-11-02", "2026-11-28"), "");
  assert.equal(movedNote("2026-11-02", "2026-10-30"), "10월로 옮겨짐");
  assert.equal(movedNote("2026-11-02", "2025-12-30"), "2025년 12월로 옮겨짐");
  assert.equal(movedNote("2026-11-02", null), "기준일 없는 줄로 옮겨짐");
  assert.equal(movedNote(null, "2026-11-02"), "2026년 11월로 옮겨짐");
  assert.equal(movedNote(null, null), "");
});

test("방향키: 고칠 수 있는 칸만 서고, 위·아래는 그 칸이 없는 줄을 건너뛰며, 갈 곳이 없으면 제자리", () => {
  const cells = [
    [false, false, true, true, true],
    [true, false, true, false, true],
    [false, false, true, true, false],
  ];
  assert.deepEqual(moveGridFocus(cells, { row: 0, col: 2 }, "ArrowRight"), { row: 0, col: 3 });
  assert.deepEqual(moveGridFocus(cells, { row: 1, col: 2 }, "ArrowRight"), { row: 1, col: 4 }, "못 고치는 칸은 건너뜀");
  assert.deepEqual(moveGridFocus(cells, { row: 1, col: 2 }, "ArrowLeft"), { row: 1, col: 0 });
  assert.deepEqual(moveGridFocus(cells, { row: 0, col: 2 }, "ArrowLeft"), { row: 0, col: 2 }, "왼쪽 끝");
  assert.deepEqual(moveGridFocus(cells, { row: 0, col: 3 }, "ArrowDown"), { row: 2, col: 3 }, "그 칸이 없는 줄은 건너뜀");
  assert.deepEqual(moveGridFocus(cells, { row: 2, col: 2 }, "ArrowDown"), { row: 2, col: 2 }, "아래 끝");
  assert.deepEqual(moveGridFocus(cells, { row: 1, col: 4 }, "ArrowUp"), { row: 0, col: 4 });
  assert.deepEqual(moveGridFocus(cells, { row: 1, col: 4 }, "Enter"), { row: 1, col: 4 });
});

test("합계 줄·달 줄: 숫자는 받을 금액·입금액·미입금만(서버 달별 합계 그대로), 보수·부가세·기타 수입·지출·순수익은 제목 글로, 0인 것은 쓰지 않는다", () => {
  const november = { month: "2026-11", feeWon: 3_600_000, vatWon: 360_000, feeWithVatWon: 3_960_000, receivedWon: 1_980_000, unpaidWon: 1_980_000, expenseWon: 50_000, otherIncomeWon: 0, netWon: 3_550_000, receivableWon: 3_960_000 };
  assert.deepEqual(ledgerGroupLine(november, "11월"), {
    title: "11월", note: "보수 3,600,000원 + 부가세 360,000원 · 지출 50,000원 · 순수익 3,550,000원", net: "3,550,000원", receivable: "3,960,000", received: "1,980,000", unpaid: "! 1,980,000", due: true,
  });
  const october = { month: "2026-10", feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 300_000, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 300_000, netWon: 300_000, receivableWon: 300_000 };
  assert.deepEqual(ledgerGroupLine(october, "10월"), { title: "10월", note: "기타 수입 300,000원 · 순수익 300,000원", net: "300,000원", receivable: "300,000", received: "300,000", unpaid: "—", due: false }, "'보수 0원'은 쓰지 않음");
  assert.deepEqual(ledgerGroupLine(undefined, "2026년 합계"), { title: "2026년 합계", note: "순수익 0원", net: "0원", receivable: "0", received: "0", unpaid: "—", due: false }, "값이 없어도 깨지지 않음");
  assert.equal(ledgerGroupLine({ feeWon: 1_000_000, vatWon: 0, netWon: 1_000_000 }, "9월").note, "보수 1,000,000원 · 순수익 1,000,000원", "부가세 0원도 쓰지 않음");
  // 기타 수입 1,000,000 + 부가세 100,000, 입금 0: 받을 금액은 서버 receivableWon(부가세 포함) 그대로 — 미입금과 같은 1,100,000
  const otherWithVat = { month: "2026-08", feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 1_100_000, expenseWon: 0, otherIncomeWon: 1_000_000, netWon: 1_000_000, receivableWon: 1_100_000 };
  assert.deepEqual(ledgerGroupLine(otherWithVat, "8월"), { title: "8월", note: "기타 수입 1,000,000원 · 순수익 1,000,000원", net: "1,000,000원", receivable: "1,100,000", received: "0", unpaid: "! 1,100,000", due: true });
  assert.equal(ledgerGroupLine({ feeWithVatWon: 500, otherIncomeWon: 700, receivableWon: 999 }, "7월").receivable, "999", "화면에서 다시 더하지 않음(서버 값만)");
});

test("묶음 줄 자리: 맨 위 그해 합계, 달마다 그 달 첫 줄 앞에 하나 — 거르기를 켰거나 줄이 없으면 넣지 않고, 장부 줄이 없는 달은 나오지 않는다", () => {
  const line = (month, netWon) => ({ month, feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 0, netWon, receivableWon: 0 });
  const summary = { year: "2026", months: [line("2026-08", 8), line("2026-10", 10), line("2026-11", 11)], total: line(undefined, 21), undatedCount: 0 };
  const entries = [
    { id: "a", basisOn: "2026-11-20" },
    { id: "b", basisOn: "2026-11-02" },
    { id: "c", basisOn: "2026-10-15" },
    { id: "d", basisOn: null },
    { id: "e", basisOn: "2026-09-30" },
    { id: "f", basisOn: "2026-11-01" },
  ];
  const plan = ledgerGroupPlan(entries, summary);
  assert.equal(plan.total?.title, "2026년 합계");
  assert.equal(plan.total?.note, "순수익 21원");
  assert.deepEqual([...plan.groups.keys()], ["a", "c"], "달의 첫 줄에만. 기준일 없는 줄·합계에 없는 달(9월)·자리를 지킨 같은 달 줄(f)에는 없고, 줄이 없는 8월도 없음");
  assert.equal(plan.groups.get("a")?.title, "11월");
  assert.equal(plan.groups.get("c")?.note, "순수익 10원");
  for (const [name, args] of [["거르기 켬", [entries, summary, { filtered: true }]], ["합계 없음", [entries, null]], ["줄 없음", [[], summary]]]) {
    const none = ledgerGroupPlan(...args);
    assert.equal(none.total, null, name);
    assert.equal(none.groups.size, 0, name);
  }
});

test("저장한 뒤의 기준일: 저장 응답은 늘 잔금일 기준이라 지금 보는 기준에 맞게 다시 정한다", () => {
  // 입금일 기준: 보수·기타 수입은 입금일(비우면 기준일 없음), 지출은 그 줄의 날짜
  assert.equal(basisAfterSave(entry({ basisOn: null }), entry({ receivedWon: 1_980_000, receivedOn: "2026-12-01", basisOn: "2026-11-20" }), "received"), "2026-12-01");
  assert.equal(basisAfterSave(other(), other({ receivedWon: 0, receivedOn: null }), "received"), null);
  assert.equal(basisAfterSave(expense(), expense({ entryOn: "2026-10-30", basisOn: "2026-10-30" }), "received"), "2026-10-30");
  // 잔금일·계약일 기준: 거래에 이은 줄·연결이 끊긴 줄은 거래의 날짜라 그대로(계약일 기준에서 응답의 잔금일로 바뀌면 안 됨)
  assert.equal(basisAfterSave(entry({ basisOn: "2026-10-05" }), entry({ label: "새 글", basisOn: "2026-11-20" }), "contract"), "2026-10-05");
  assert.equal(basisAfterSave(entry({ dealId: null, snapContractOn: "2026-09-01", snapBalanceOn: "2026-09-30", basisOn: "2026-09-01" }), entry({ dealId: null, snapContractOn: "2026-09-01", snapBalanceOn: "2026-09-30", basisOn: "2026-09-30" }), "contract"), "2026-09-01");
  // 처음부터 거래가 없던 줄은 그 줄의 날짜
  assert.equal(basisAfterSave(other(), other({ entryOn: "2026-09-15" }), "balance"), "2026-09-15");
  assert.equal(basisAfterSave(entry({ dealId: null, entryOn: "2026-11-01", basisOn: "2026-11-01" }), entry({ dealId: null, entryOn: null }), "contract"), null);
});

test("미입금 칸: 숫자만 짧게 — 미입금·입금 끝·초과 입금, 지출은 줄표", () => {
  assert.deepEqual(gridPayState(entry()), { state: "due", text: "미입금 1,980,000" });
  assert.deepEqual(gridPayState(entry({ receivedWon: 500_000, receivedOn: "2026-11-21" })), { state: "due", text: "미입금 1,480,000" });
  assert.deepEqual(gridPayState(entry({ receivedWon: 1_980_000, receivedOn: "2026-11-21" })), { state: "paid", text: "입금 끝" });
  assert.deepEqual(gridPayState(entry({ receivedWon: 2_000_000, receivedOn: "2026-11-21" })), { state: "over", text: "초과 입금 20,000" });
  assert.deepEqual(gridPayState(expense()), { state: "none", text: "—" });
});

test("넣던 값 글: 금액은 쉼표, 낸 쪽은 이름, 빈 값은 '(비움)'", () => {
  assert.equal(gridColumnName("basisOn"), "날짜");
  assert.equal(gridColumnName("amountWon"), "공급가액");
  assert.equal(typedText("receivedWon", "1980000"), "입금액 1,980,000");
  assert.equal(typedText("label", "  가상숲2단지 59㎡ 전세 "), "물건 표시·내용 가상숲2단지 59㎡ 전세");
  assert.equal(typedText("payerRole", "buyer"), "낸 쪽 매수인");
  assert.equal(typedText("payerRole", ""), "낸 쪽 없음");
  assert.equal(typedText("receivedOn", ""), "입금일 (비움)");
  assert.equal(typedText("basisOn", "2026-11-02"), "날짜 2026-11-02");
});

test("이 모듈은 서버·브라우저를 건드리지 않는 순수 함수만 둔다", async () => {
  const source = await readFile(new URL("../src/lib/work/ledger-grid.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(?:fetch|localStorage|sessionStorage|document|window|location|navigator)\b/u);
  assert.doesNotMatch(source, /Date\.now|new Date\(/u, "오늘 날짜도 받지 않음(화면이 넘김)");
});

test("표 칸 CSS: 표 부품은 1221px 이상에서만 보이고, 36px·13px은 '1221px 이상 + 마우스' 덩어리 안에만 있으며, 색은 변수만 쓴다", async () => {
  const styles = await readFile(new URL("../src/styles/admin.css", import.meta.url), "utf8");
  const gridAt = styles.indexOf("/* 매출장부 PC 표에서 칸을 바로 고치기(D-2a");
  assert.ok(gridAt > 0, "표 칸 CSS 덩어리");
  const grid = styles.slice(gridAt);
  const wideHead = "@media (min-width: 1221px) {";
  const denseHead = "@media (min-width: 1221px) and (hover: hover) and (pointer: fine) {";
  assert.equal(grid.split(wideHead).length - 1, 1, "1221px 이상 덩어리 하나");
  assert.equal(grid.split(denseHead).length - 1, 1, "조밀한 PC 덩어리 하나");
  const base = grid.slice(0, grid.indexOf(wideHead));
  const wide = grid.slice(grid.indexOf(wideHead), grid.indexOf(denseHead));
  const dense = grid.slice(grid.indexOf(denseHead));
  // 1220px 이하(휴대폰·좁은 PC)는 카드와 입력 화면 그대로: 되돌리기 단추·키 안내를 숨긴다
  assert.match(base, /\.lg-history,\r?\n\.lg-keys \{ display: none; \}/u);
  assert.doesNotMatch(base, /\.lg-sum|\.lg-cell/u, "1221px 미만에는 표 칸 규칙을 걸지 않음");
  assert.match(wide, /\.lg-sum \{ display: none; \}/u, "합계 칸·달별 표는 표가 보일 때만 숨김");
  // 손가락으로 쓰는 넓은 화면은 44px·16px 그대로(사용자 승인 2026-11-23 11:34:13: 36px은 PC에서만)
  assert.match(wide, /\.lg-table \{ --lg-cell-y: 10px; --lg-cell-x: 8px; --lg-cell-min: 44px; \}/u);
  assert.doesNotMatch(wide, /--lg-cell-min: 36px|height: 36px|font-size: 0\.8125rem|font-size: 0\.75rem/u, "36px·13px은 조밀한 PC 덩어리 안에만");
  assert.match(dense, /\.lg-table \{ --lg-cell-y: 4px; --lg-cell-x: 10px; --lg-cell-min: 36px; \}/u);
  assert.doesNotMatch(dense, /font-size: 0\.(?:[0-7]\d*|80\d*|8)rem/u, "조밀한 PC에서도 13px보다 작은 글자는 두지 않음");
  // 고치는 동안 칸 단추는 자리를 지킨 채 숨긴다(줄 높이·칸 폭이 흔들리지 않게)
  assert.match(wide, /\.lg-cell\[hidden\] \{ display: block; visibility: hidden; \}/u);
  assert.doesNotMatch(grid, /#[0-9a-fA-F]{3,8}\b/u, "색은 변수만");
});
