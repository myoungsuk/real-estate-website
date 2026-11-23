// 매출장부 PC 표(1221px 이상)에서 칸을 바로 고치는 규칙(단계 2 D-2a, 설계서 6.12절). 순수 함수만 둔다 — 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 참고용 집계이며 세무 장부가 아니다. 금액은 원 단위 정수, 날짜는 "YYYY-MM-DD" 글자다.
// 칸마다 그 칸만 저장한다(서버 PATCH는 보낸 칸만 고침). 입금액·입금일은 서버가 함께 검사하므로 늘 둘을 같이 보낸다.
import { calculateVatWon } from "./brokerage-fee.mjs";
import { LEDGER_BASIS_LABELS, LEDGER_KIND_LABELS, LEDGER_LABEL_MAX, LEDGER_PAYER_LABELS, isDate, ledgerDateText, numberText, parseWon, wonText } from "./ledger-view.mjs";

// 되돌리기·다시 하기는 이 화면에서 고친 칸을 최근 것부터 이만큼만 기억한다(화면을 떠나면 없어짐).
export const LEDGER_UNDO_LIMIT = 20;

// 표의 칸(왼쪽부터). 첫 칸은 화면 위 '기준일'에서 고른 날짜(잔금일·계약일·입금일)다.
export const LEDGER_GRID_COLUMNS = Object.freeze(["basisOn", "kind", "label", "payerRole", "amountWon", "vatWon", "totalWon", "receivedWon", "receivedOn", "unpaidWon"]);
const HEADS = Object.freeze({ basisOn: "기준일", kind: "종류", label: "물건 표시·내용", payerRole: "낸 쪽", amountWon: "공급가액(원)", vatWon: "부가세(원)", totalWon: "받을 금액", receivedWon: "입금액(원)", receivedOn: "입금일", unpaidWon: "미입금" });
// 칸을 고치는 단추 이름에 쓰는 칸 이름("(원)" 없이).
const NAMES = Object.freeze({ label: "물건 표시·내용", payerRole: "낸 쪽", amountWon: "공급가액", vatWon: "부가세", receivedWon: "입금액", receivedOn: "입금일" });
const basisName = (basis) => LEDGER_BASIS_LABELS[basis] ?? LEDGER_BASIS_LABELS.balance;
/** @param {string} column */
export const gridHeadText = (column) => HEADS[column] ?? "";
// 칸 이름("(원)" 없이). 첫 칸은 '날짜'.
/** @param {string} column */
export const gridColumnName = (column) => (column === "basisOn" ? "날짜" : NAMES[column] ?? "");

// 칸에 넣던 값을 글로("입금액 1,980,000"). 다른 곳에서 먼저 고쳐 저장하지 못했을 때 줄 아래에 남긴다.
/** @param {string} column @param {string} text */
export function typedText(column, text) {
  const raw = String(text ?? "").trim();
  let value = raw || "(비움)";
  if (column === "amountWon" || column === "vatWon" || column === "receivedWon") {
    const won = parseWon(raw);
    value = won === null || Number.isNaN(won) ? value : numberText(won);
  } else if (column === "payerRole") value = LEDGER_PAYER_LABELS[raw] ?? "없음";
  return `${gridColumnName(column)} ${value}`;
}

// 처음부터 거래가 없던 줄(그 줄의 날짜 entryOn이 기준일). 거래에 이은 줄·연결이 끊긴 줄(snap_*)의 날짜는 거래의 날짜라 여기서 고치지 않는다.
const noDealFromStart = (entry) => !entry.dealId && !entry.snapContractOn && !entry.snapBalanceOn;

// 고칠 수 있는 칸인지. 종류는 만든 뒤 바꾸지 않고, '받을 금액'·'미입금'은 계산 값이다.
// 첫 칸(기준일)은 그 날짜가 줄의 날짜(entryOn)일 때만 고친다 — 입금일 기준에서 보수·기타 수입의 첫 칸은 입금일이라 '입금일' 칸에서 고친다.
/** @param {Record<string, any>} entry @param {string} column @param {string} [basis] */
export function gridCellEditable(entry, column, basis = "balance") {
  if (!entry) return false;
  if (column === "label" || column === "amountWon" || column === "vatWon") return true;
  if (column === "payerRole") return entry.kind === "fee";
  if (column === "receivedWon" || column === "receivedOn") return entry.kind !== "expense";
  if (column === "basisOn") return noDealFromStart(entry) && (basis !== "received" || entry.kind === "expense");
  return false;
}

// 칸에 보이는 글. 지출 줄은 받을 돈이 없어 '받을 금액'을 비운다(합계 줄의 '받을 금액'이 보이는 줄의 합과 맞게).
/** @param {Record<string, any>} entry @param {string} column @param {string | number} [year] */
export function gridCellText(entry, column, year) {
  const expense = entry.kind === "expense";
  if (column === "basisOn") return ledgerDateText(entry.basisOn, year) || "기준일 없음";
  if (column === "kind") return LEDGER_KIND_LABELS[entry.kind] ?? "";
  if (column === "label") return entry.label || "(물건 표시 없음)";
  if (column === "payerRole") return LEDGER_PAYER_LABELS[entry.payerRole] ?? "—";
  if (column === "amountWon") return numberText(entry.amountWon);
  if (column === "vatWon") return entry.kind === "fee" || Number(entry.vatWon) > 0 ? numberText(entry.vatWon) : "—";
  if (column === "totalWon") return expense ? "" : numberText(Number(entry.amountWon ?? 0) + Number(entry.vatWon ?? 0));
  if (column === "receivedWon") return expense ? "—" : numberText(entry.receivedWon);
  if (column === "receivedOn") return expense ? "—" : ledgerDateText(entry.receivedOn, year);
  return "";
}

// '미입금' 칸: 금액 칸이 옆에 따로 있어 짧게 쓴다(카드의 "미입금 …원 (일부 입금 …원)"과 달리 숫자만).
/** @param {Record<string, any>} entry @returns {{ state: "none" | "paid" | "due" | "over", text: string }} */
export function gridPayState(entry) {
  if (!entry || entry.kind === "expense") return { state: "none", text: "—" };
  const total = Number(entry.amountWon ?? 0) + Number(entry.vatWon ?? 0);
  const received = Number(entry.receivedWon ?? 0);
  if (received > total) return { state: "over", text: `초과 입금 ${numberText(received - total)}` };
  if (received < total) return { state: "due", text: `미입금 ${numberText(total - received)}` };
  return { state: "paid", text: "입금 끝" };
}

// 고치기 시작할 때 입력칸에 넣는 글(금액은 쉼표, 날짜는 YYYY-MM-DD, 낸 쪽은 코드).
/** @param {Record<string, any>} entry @param {string} column */
export function gridEditText(entry, column) {
  if (column === "basisOn") return entry.entryOn ?? "";
  if (column === "receivedOn") return entry.receivedOn ?? "";
  if (column === "label") return entry.label ?? "";
  if (column === "payerRole") return entry.payerRole ?? "";
  if (column === "amountWon" || column === "vatWon" || column === "receivedWon") return numberText(entry[column]);
  return "";
}

// 칸을 고치는 단추 이름: "11. 20. 가상숲1단지 84㎡ 매매 매도인 입금액 고치기"
/** @param {Record<string, any>} entry @param {string} column @param {string | number} [year] @param {string} [basis] */
export function gridCellLabel(entry, column, year, basis = "balance") {
  const name = gridColumnName(column);
  const parts = [ledgerDateText(entry.basisOn, year) || "기준일 없음", entry.label || LEDGER_KIND_LABELS[entry.kind] || "", LEDGER_PAYER_LABELS[entry.payerRole] ?? "", `${name} 고치기`];
  return parts.filter(Boolean).join(" ") + (column === "basisOn" && basis ? `(${basisName(basis)} 기준)` : "");
}

// 공급가액을 고칠 때 부가세도 함께 바꾸는 줄: 고치기 전 부가세가 공급가액의 10%였던 줄만(사용자 결정 2026-11-23 11:34:13).
// 0원·0원은 10%이기는 하지만 보수 줄만 따른다(지출·기타 수입은 부가세를 따로 넣은 적이 없는 줄).
const vatFollows = (entry) => Number(entry.vatWon) === calculateVatWon(Number(entry.amountWon)) && (Number(entry.vatWon) > 0 || entry.kind === "fee");

export const LEDGER_ASK_DATE_NOTE = "입금일을 확인해 주세요. Enter로 입금액과 함께 저장하고, Esc로 둘 다 그만둡니다.";

// 칸에 넣은 글 → 할 일.
//  none: 바뀐 것 없음 / error: 보내지 않고 줄 아래에 알림 / save: 이 칸(과 함께 가야 하는 칸)만 저장 /
//  ask-date: 입금일이 빈 줄에 입금액을 넣음 — 저장하지 않고 입금일 칸을 오늘로 채워 열어 둔다(입금액은 carry로 들고 감).
// carry: ask-date 뒤 입금일 칸을 확인할 때 들고 온 입금액.
/**
 * @param {Record<string, any>} entry @param {string} column @param {string} text @param {{ carry?: { receivedWon: number } | null }} [options]
 * @returns {{ kind: "none" } | { kind: "error", message: string } | { kind: "save", changes: Record<string, unknown>, note: string } | { kind: "ask-date", carry: { receivedWon: number }, message: string }}
 */
export function planCellEdit(entry, column, text, { carry = null } = {}) {
  const none = /** @type {const} */ ({ kind: "none" });
  const error = (message) => /** @type {const} */ ({ kind: "error", message });
  const save = (changes, note = "") => /** @type {const} */ ({ kind: "save", changes, note });
  const raw = String(text ?? "");
  if (column === "label") {
    const label = raw.trim().replace(/\s+/gu, " ");
    if (label.length > LEDGER_LABEL_MAX) return error(`물건 표시·내용은 ${LEDGER_LABEL_MAX}자까지입니다.`);
    return label === (entry.label ?? "") ? none : save({ label });
  }
  if (column === "payerRole") {
    const payerRole = Object.hasOwn(LEDGER_PAYER_LABELS, raw) ? raw : null;
    return payerRole === (entry.payerRole ?? null) ? none : save({ payerRole });
  }
  if (column === "amountWon") {
    const amountWon = parseWon(raw);
    if (amountWon === null) return error("금액을 넣어 주세요.");
    if (Number.isNaN(amountWon)) return error("금액은 숫자로만 넣어 주세요.");
    if (amountWon === Number(entry.amountWon)) return none;
    const vatWon = calculateVatWon(amountWon);
    if (vatFollows(entry) && vatWon !== Number(entry.vatWon)) return save({ amountWon, vatWon }, `부가세도 ${wonText(vatWon)}으로 함께 바꿨습니다(고치기 전 부가세가 공급가액의 10%였던 줄).`);
    return save({ amountWon });
  }
  if (column === "vatWon") {
    const vatWon = parseWon(raw);
    if (Number.isNaN(vatWon)) return error("부가세는 숫자로만 넣어 주세요.");
    return (vatWon ?? 0) === Number(entry.vatWon) ? none : save({ vatWon: vatWon ?? 0 });
  }
  if (column === "receivedWon") {
    const parsed = parseWon(raw);
    if (Number.isNaN(parsed)) return error("입금액은 숫자로만 넣어 주세요.");
    const receivedWon = parsed ?? 0;
    if (receivedWon === Number(entry.receivedWon)) return none;
    if (receivedWon === 0) return save({ receivedWon: 0, receivedOn: null }, entry.receivedOn ? "입금액이 0원이라 입금일도 함께 비웠습니다." : "");
    if (!entry.receivedOn) return { kind: "ask-date", carry: { receivedWon }, message: LEDGER_ASK_DATE_NOTE };
    return save({ receivedWon, receivedOn: entry.receivedOn });
  }
  if (column === "receivedOn") {
    const receivedOn = raw.trim();
    const receivedWon = carry ? carry.receivedWon : Number(entry.receivedWon);
    if (receivedOn && !isDate(receivedOn)) return error("입금일을 달력에서 골라 주세요.");
    if (!receivedOn && receivedWon > 0) return error("입금액이 있으면 입금일을 넣어 주세요.");
    if (receivedOn && receivedWon === 0) return error("입금액이 0원이면 입금일을 비워 주세요.");
    if (!carry && (receivedOn || null) === (entry.receivedOn ?? null)) return none;
    return save({ receivedWon, receivedOn: receivedOn || null }, carry ? `입금액과 입금일(${receivedOn})을 함께 저장했습니다.` : "");
  }
  if (column === "basisOn") {
    const entryOn = raw.trim();
    if (entryOn && !isDate(entryOn)) return error("날짜를 달력에서 골라 주세요.");
    if (!entryOn && entry.kind !== "fee") return error("거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.");
    return (entryOn || null) === (entry.entryOn ?? null) ? none : save({ entryOn: entryOn || null });
  }
  return none;
}

// 저장한 칸의 고치기 전 값(되돌리기가 다시 보낼 값). changes에 든 칸만 담는다.
/** @param {Record<string, any>} entry @param {Record<string, unknown>} changes */
export function changesBefore(entry, changes) {
  /** @type {Record<string, unknown>} */
  const before = {};
  for (const key of Object.keys(changes)) before[key] = entry[key] ?? null;
  return before;
}

// 되돌리기·다시 하기 묶음. 한 단계 = 한 번의 저장(step: { id, title, before, after }).
// 되돌리기도 앞 값으로 한 번 저장하는 것이라, 서버가 받아 준 뒤에만 단계를 옮긴다(peek → 저장 → done).
// 저장이 409(다른 곳에서 먼저 고침)면 단계를 그대로 두고 멈춘다 — 다음 단계로 건너뛰지 않는다. 줄이 지워졌으면(404) 그 줄의 단계만 버린다(forget).
/** @param {number} [limit] */
export function createLedgerHistory(limit = LEDGER_UNDO_LIMIT) {
  /** @type {Array<{ id: string, title: string, before: Record<string, unknown>, after: Record<string, unknown> }>} */
  let done = [];
  /** @type {typeof done} */
  let undone = [];
  return {
    record(step) {
      done.push(step);
      if (done.length > limit) done = done.slice(done.length - limit);
      undone = [];
    },
    peekUndo: () => done.at(-1) ?? null,
    peekRedo: () => undone.at(-1) ?? null,
    doneUndo() {
      const step = done.pop();
      if (step) undone.push(step);
    },
    doneRedo() {
      const step = undone.pop();
      if (step) done.push(step);
    },
    forget(id) {
      done = done.filter((step) => step.id !== id);
      undone = undone.filter((step) => step.id !== id);
    },
    clear() {
      done = [];
      undone = [];
    },
    counts: () => ({ undo: done.length, redo: undone.length }),
  };
}

// 되돌리기·다시 하기 단추 이름: "되돌리기: 가상숲1단지 84㎡ 매매 입금액" (할 것이 없으면 이름만)
/** @param {"undo" | "redo"} which @param {{ title: string } | null} step */
export const historyButtonLabel = (which, step) => `${which === "undo" ? "되돌리기" : "다시 하기"}${step ? `: ${step.title}` : ""}`;
/** @param {Record<string, any>} entry @param {string} column */
export const historyStepTitle = (entry, column) => `${entry.label || LEDGER_KIND_LABELS[entry.kind] || "장부 줄"} ${gridColumnName(column)}`.trim();

// 저장한 뒤의 기준일. 저장 응답의 basisOn은 늘 잔금일 기준이라(서버 loadEntry), 지금 보는 기준에 맞게 화면이 다시 정한다.
//  입금일 기준: 보수·기타 수입은 입금일, 지출은 잔금일 기준과 같다.
//  잔금일·계약일 기준: 처음부터 거래가 없던 줄은 그 줄의 날짜(entryOn), 거래에 이었던 줄은 거래의 날짜라 이 표에서 바뀌지 않는다(고치기 전 값 그대로).
/** @param {Record<string, any>} before @param {Record<string, any>} saved @param {string} [basis] */
export function basisAfterSave(before, saved, basis = "balance") {
  if (basis === "received" && saved.kind !== "expense") return saved.receivedOn ?? null;
  return noDealFromStart(saved) ? saved.entryOn ?? null : before.basisOn ?? null;
}

// 기준일이 다른 달(또는 다른 해·기준일 없음)이 되면 줄을 그 자리에 두고 붙이는 글. 같은 달이면 "".
/** @param {string | null | undefined} beforeOn @param {string | null | undefined} afterOn */
export function movedNote(beforeOn, afterOn) {
  const from = String(beforeOn ?? "").slice(0, 7);
  const to = String(afterOn ?? "").slice(0, 7);
  if (from === to) return "";
  if (!to) return "기준일 없는 줄로 옮겨짐";
  const month = `${Number(to.slice(5, 7))}월`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${month}로 옮겨짐` : `${to.slice(0, 4)}년 ${month}로 옮겨짐`;
}

// 방향키로 칸 옮기기. cells[row][col]이 true인 칸(고칠 수 있는 칸)만 선다. 갈 곳이 없으면 제자리.
// 위·아래는 같은 칸이 있는 가장 가까운 줄로(그 줄에 그 칸이 없으면 건너뜀), 좌·우는 같은 줄의 다음 칸으로.
/** @param {boolean[][]} cells @param {{ row: number, col: number }} from @param {string} key */
export function moveGridFocus(cells, from, key) {
  const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
  if (!step) return from;
  let { row, col } = from;
  for (;;) {
    row += step[0];
    col += step[1];
    if (row < 0 || row >= cells.length || col < 0 || col >= (cells[row]?.length ?? 0)) return from;
    if (cells[row][col]) return { row, col };
  }
}

// 합계 줄·달 줄(대장 결정 2026-11-23 12:29). 숫자 칸은 '받을 돈' 세 칸만: 받을 금액(보수·기타 수입, 부가세 포함)·입금액·미입금.
// 공급가액·부가세 칸은 비운다(보수·지출·기타 수입이 한 칸에 섞여 더하면 뜻이 없음). 보수·부가세·기타 수입·지출·순수익은 제목 글로 쓴다.
// 모두 서버 달별 합계 그대로이고 화면에서 다시 더하지 않는다(받을 금액도 서버 receivableWon). 0인 것은 쓰지 않는다(순수익은 늘 씀).
/** @param {Record<string, any> | null | undefined} line @param {string} title */
export function ledgerGroupLine(line, title) {
  const won = (key) => Number(line?.[key] ?? 0) || 0;
  const parts = [];
  if (won("feeWon") !== 0 || won("vatWon") !== 0) parts.push(`보수 ${wonText(won("feeWon"))}${won("vatWon") !== 0 ? ` + 부가세 ${wonText(won("vatWon"))}` : ""}`);
  if (won("otherIncomeWon") !== 0) parts.push(`기타 수입 ${wonText(won("otherIncomeWon"))}`);
  if (won("expenseWon") !== 0) parts.push(`지출 ${wonText(won("expenseWon"))}`);
  parts.push(`순수익 ${wonText(won("netWon"))}`);
  const due = won("unpaidWon") > 0;
  // net: 제목 글 끝의 순수익 값(화면이 그 값만 굵게 쓴다). note는 늘 이 값으로 끝난다.
  return { title, note: parts.join(" · "), net: wonText(won("netWon")), receivable: numberText(won("receivableWon")), received: numberText(won("receivedWon")), unpaid: due ? `! ${numberText(won("unpaidWon"))}` : "—", due };
}

// 장부 줄 사이에 넣을 묶음 줄 자리: 맨 위 그해 합계 한 줄, 기준일의 달이 바뀌는 첫 줄 앞마다 그 달 한 줄(장부 줄 id → 묶음 줄).
// 거르기(종류·미입금만·기준일 없는 줄만)를 켰거나 줄이 없으면 넣지 않는다 — 달 합계는 거르지 않은 값이라 보이는 줄과 어긋난다.
// 달 줄은 장부 줄이 있는 달만 나온다(0원뿐인 달 줄 없음).
/** @param {Array<{ id: string, basisOn?: string | null }>} entries @param {{ year?: string | number, months?: Array<Record<string, any>>, total?: Record<string, any> } | null | undefined} summary @param {{ filtered?: boolean }} [options] */
export function ledgerGroupPlan(entries, summary, { filtered = false } = {}) {
  /** @type {Map<string, ReturnType<typeof ledgerGroupLine>>} */
  const groups = new Map();
  if (filtered || !summary || entries.length === 0) return { total: null, groups };
  const byMonth = new Map((summary.months ?? []).map((line) => [String(line.month ?? "").slice(0, 7), line]));
  const seen = new Set();
  for (const entry of entries) {
    const month = String(entry.basisOn ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/u.test(month) || seen.has(month)) continue;
    seen.add(month);
    const line = byMonth.get(month);
    if (line) groups.set(entry.id, ledgerGroupLine(line, `${Number(month.slice(5, 7))}월`));
  }
  return { total: ledgerGroupLine(summary.total, `${summary.year ?? ""}년 합계`), groups };
}
