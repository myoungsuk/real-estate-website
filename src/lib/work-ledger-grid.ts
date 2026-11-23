// 매출장부 PC 표(1221px 이상)에서 칸을 바로 고치는 화면 조각(단계 2 D-2a, 설계서 6.12절).
// 서버 요청은 host가 넘긴 함수로만 한다(work-ledger-client.ts 한 곳). 넣던 값·되돌리기 단계는 화면 메모리에만 두고 주소·브라우저 저장소에 넣지 않는다.
// 물건 표시 글은 textContent·value로만 넣는다. 저장 상태·실패는 색만이 아니라 글로 알린다.
// 칸 단추는 줄이 사는 동안 바꾸지 않는다 — 고치던 칸을 떠나며(blur) 저장할 때 줄을 다시 그리면, 방금 누른 다른 칸의 단추가 사라져 누름이 먹히지 않는다.
import type { LedgerBasis, LedgerEntry, LedgerSaved } from "./work-ledger-client";
import { WorkApiError } from "./work-ledger-client";
import { element } from "./work-customers-dom";
import { editButton, kindBadge, warnList } from "./work-ledger-dom";
import { LEDGER_KIND_LABELS, LEDGER_PAYER_LABELS, numberText } from "./work/ledger-view.mjs";
import { TRASH_MOVE_NOTICE } from "./work/trash-view.mjs";
import {
  LEDGER_ASK_DATE_NOTE,
  LEDGER_GRID_COLUMNS,
  LEDGER_NEW_COLUMNS,
  LEDGER_NEW_KINDS,
  LEDGER_NEW_START,
  basisAfterSave,
  deleteAskText,
  changesBefore,
  createLedgerHistory,
  gridCellEditable,
  gridCellLabel,
  gridCellText,
  gridEditText,
  gridPayState,
  historyButtonLabel,
  historyStepTitle,
  moveGridFocus,
  movedNote,
  newRowHasInput,
  newRowNote,
  newRowSavedText,
  newRowTotalText,
  newRowVatText,
  planCellEdit,
  planNewRow,
  typedText,
} from "./work/ledger-grid.mjs";

type Column = (typeof LEDGER_GRID_COLUMNS)[number];
type NewColumn = (typeof LEDGER_NEW_COLUMNS)[number];
type GroupLine = { title: string; note: string; net: string; receivable: string; received: string; unpaid: string; due: boolean };
export interface LedgerGroupPlan { total: GroupLine | null; groups: Map<string, GroupLine> }

export interface LedgerGridHost {
  tbody: HTMLTableSectionElement;
  year(): string | number;
  basis(): LedgerBasis;
  today(): string;
  save(id: string, changes: Record<string, unknown>, version: number): Promise<LedgerSaved>;
  // 같은 조건으로 목록을 다시 읽어 그 줄만 돌려준다. 목록에 없으면 null.
  reloadRow(id: string): Promise<LedgerEntry | null>;
  errorText(code: string | null): string;
  // 줄이 바뀜(저장·다시 읽기). 화면이 들고 있는 목록을 맞춘다.
  entryChanged(entry: LedgerEntry): void;
  // 서버 값이 바뀜(저장·다시 읽기). 합계 줄·달 줄을 서버 합계로 다시 그린다.
  totalsChanged(): void;
  // 되돌리기·다시 하기 단추 이름(할 것이 없으면 can이 false).
  historyChanged(labels: { canUndo: boolean; canRedo: boolean; undoName: string; redoName: string }): void;
  // 기다리던 저장이 모두 끝나 표에 남은 것이 없음(저장 중에 막아 둔 동작이 있으면 화면이 이어서 한다).
  settled(): void;
  // 막아 둔 동작을 버린다. failed가 true면 저장이 실패했거나 다른 곳에서 먼저 고친 것(화면이 하지 않았다고 알림),
  // false면 사용자가 다음 동작(다른 칸 고치기·되돌리기·'다시 저장' 등)을 시작한 것(그 알림을 지움).
  interrupted(failed: boolean): void;
  // 알릴 한 줄. visible이면 표 위에도 글로 보인다(되돌리기를 못 했을 때처럼 줄 아래에 쓸 자리가 없는 알림).
  announce(text: string, visible?: boolean): void;
  // 빈 새 줄을 보일지(거르기·'그 줄만 보기'를 켜면 숨김 — 합계 줄·달 줄과 같은 규칙).
  newRowAllowed(): boolean;
  // 새 줄 저장(POST 한 번) → 화면이 목록·합계를 다시 읽는다. shown: 다시 읽은 목록에 그 줄이 있는지.
  create(body: Record<string, unknown>): Promise<{ entry: LedgerEntry; shown: boolean }>;
  // 줄 지우기(휴지통으로) → 화면이 지운 뒤 알림을 보이고 목록·합계를 다시 읽는다.
  remove(id: string): Promise<void>;
  // 지운 뒤 포커스를 둘 줄도 새 줄도 없을 때(거르기 중 마지막 줄을 지움) 표 밖의 갈 곳.
  focusFallback(): void;
}

interface Job { changes: Record<string, unknown>; note: string; history: "record" | "undo" | "redo"; title: string; typed: string }
interface Cell { td: HTMLTableCellElement; button: HTMLButtonElement | null }
interface RowState {
  entry: LedgerEntry;
  // 목록을 그릴 때의 기준일. 고쳐서 다른 달이 돼도 줄은 이 자리(이 달 줄 아래)에 둔다.
  placedOn: string | null;
  row: HTMLTableRowElement;
  noteRow: HTMLTableRowElement | null;
  cells: Map<Column, Cell>;
  status: HTMLElement;
  warn: HTMLElement;
  trash: HTMLButtonElement;
  queue: Job[];
  running: boolean;
  failed: string | null;
  locked: boolean;
  gone: boolean;
  statusText: string;
  note: { text: string; bad: boolean } | null;
  carry: { receivedWon: number } | null;
  saved: boolean;
}
interface Editor { state: RowState; column: Column; input: HTMLInputElement | HTMLSelectElement; carry: { receivedWon: number } | null; closed: boolean; fresh: boolean }

const COLUMN_COUNT = LEDGER_GRID_COLUMNS.length + 1; // 끝에 줄 상태·'고치기' 칸
const NUMERIC = new Set<Column>(["amountWon", "vatWon", "totalWon", "receivedWon", "unpaidWon"]);
const MONEY = new Set<Column>(["amountWon", "vatWon", "receivedWon"]);
// 서버 칸 이름 → 표의 칸(줄의 날짜 entryOn은 첫 칸에서 고친다)
const columnOf = (key: string) => (key === "entryOn" ? "basisOn" : key) as Column;
const payerLabels = LEDGER_PAYER_LABELS as Record<string, string>;
const kindLabels = LEDGER_KIND_LABELS as Record<string, string>;
const fromDeal = (entry: LedgerEntry) => Boolean(entry.dealId || entry.snapContractOn || entry.snapBalanceOn);

// 합계 줄·달 줄. 장부 줄이 아니므로 data-lg-entry를 두지 않는다. 숫자는 '받을 금액'·'입금액'·'미입금' 세 칸만 채운다.
export function ledgerGroupRow(line: GroupLine, total = false) {
  const row = element("tr", `lg-group${total ? " lg-group--total" : ""}`);
  const head = element("th");
  head.scope = "row";
  head.colSpan = 6;
  // 순수익 값만 굵게·본문색으로(PC에서는 합계 칸을 숨겨 순수익이 보이는 곳이 이 줄뿐이다)
  const note = element("small", "", line.note.endsWith(line.net) ? line.note.slice(0, line.note.length - line.net.length) : line.note);
  if (line.note.endsWith(line.net)) note.append(element("b", "lg-net", line.net));
  head.append(element("strong", "", line.title), note);
  row.append(head, element("td", "num", line.receivable), element("td", "num", line.received), element("td"), element("td", `num${line.due ? " is-due" : ""}`, line.unpaid), element("td"));
  return row;
}

// 줄 끝 휴지통 단추(D-2b). 이름은 읽기 프로그램용(물건 표시·종류 + "장부 줄 지우기"), 마우스를 올리면 "이 줄 지우기".
const SVG_NS = "http://www.w3.org/2000/svg";
function trashIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [name, value] of [["viewBox", "0 0 24 24"], ["width", "20"], ["height", "20"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.8"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["focusable", "false"]]) svg.setAttribute(name, value);
  for (const d of ["M4.5 7h15", "M9.5 7V5h5v2", "M6.5 7l1 12.5h9l1-12.5", "M10.5 11v5M13.5 11v5"]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
function trashButton(entry: LedgerEntry) {
  const button = element("button", "lg-trash");
  button.type = "button";
  button.dataset.lgTrash = entry.id;
  button.setAttribute("aria-label", `${entry.label || "(물건 표시 없음)"} ${kindLabels[entry.kind] ?? ""} 장부 줄 지우기`);
  button.title = "이 줄 지우기";
  button.append(trashIcon());
  return button;
}
const BUSY_TEXT = "다른 줄을 저장하는 중이거나 저장하지 못한 칸이 있습니다. 그 줄을 끝낸 뒤 다시 눌러 주세요.";

export function createLedgerGrid(host: LedgerGridHost) {
  const { tbody } = host;
  const rows = new Map<string, RowState>();
  const history = createLedgerHistory();
  let editor: Editor | null = null;
  const rowsDirty = () => [...rows.values()].some((state) => state.queue.length > 0 || state.failed !== null || state.carry !== null);
  // 새 줄 저장·줄 지우기 중에도 목록을 바꾸지 않는다(끝나면 화면이 목록을 다시 그리고 settled로 막아 둔 동작을 이어서 함).
  let creating = false;
  let removing = false;
  const isDirty = () => creating || removing || rowsDirty();

  const notifyHistory = () => {
    const undo = history.peekUndo();
    const redo = history.peekRedo();
    host.historyChanged({ canUndo: Boolean(undo), canRedo: Boolean(redo), undoName: historyButtonLabel("undo", undo), redoName: historyButtonLabel("redo", redo) });
  };

  // 저장을 기다리는 값까지 얹은 줄(칸에 보이는 값). 입금일을 묻는 동안의 입금액(carry)도 얹는다.
  function shownEntry(state: RowState, { withCarry = true } = {}): LedgerEntry {
    let shown = { ...state.entry } as LedgerEntry & Record<string, unknown>;
    for (const job of state.queue) shown = { ...shown, ...job.changes };
    if (withCarry && state.carry) shown.receivedWon = state.carry.receivedWon;
    shown.basisOn = basisAfterSave(state.entry, shown, host.basis());
    return shown;
  }
  const waitingColumns = (state: RowState) => new Set(state.queue.flatMap((job) => Object.keys(job.changes).map(columnOf)));

  function syncNote(state: RowState) {
    const failed = state.failed !== null;
    if (!state.note && !failed) {
      state.noteRow?.remove();
      state.noteRow = null;
      return;
    }
    const row = state.noteRow ?? element("tr", "lg-noterow");
    const cell = element("td");
    cell.colSpan = COLUMN_COUNT;
    const bad = failed || Boolean(state.note?.bad);
    row.className = `lg-noterow${bad ? " is-bad" : ""}`;
    cell.append(element("p", "", `${bad ? "! " : ""}${failed ? `저장하지 못했습니다. ${state.failed} 넣은 값은 칸에 그대로 있습니다.` : state.note?.text ?? ""}`));
    if (failed) {
      const retry = element("button", "work-secondary-button", "다시 저장");
      retry.type = "button";
      retry.dataset.lgRetry = state.entry.id;
      const revert = element("button", "work-secondary-button", "고치기 전 값으로");
      revert.type = "button";
      revert.dataset.lgRevert = state.entry.id;
      const actions = element("span", "lg-noterow__actions");
      actions.append(retry, revert);
      cell.append(actions);
    }
    row.replaceChildren(cell);
    if (!state.noteRow) state.row.after(row);
    state.noteRow = row;
  }

  // 줄의 칸 글·상태를 지금 값으로 맞춘다. 칸 단추·입력칸은 바꾸지 않는다.
  function syncRow(state: RowState) {
    const shown = shownEntry(state);
    const year = host.year();
    const basis = host.basis();
    const waiting = waitingColumns(state);
    const failedColumns = state.failed !== null && state.queue[0] ? new Set(Object.keys(state.queue[0].changes).map(columnOf)) : new Set<Column>();
    for (const [column, cell] of state.cells) {
      if (column === "kind") continue;
      if (column === "unpaidWon") {
        const pay = gridPayState(shown);
        if (pay.state === "none") cell.td.textContent = pay.text;
        else cell.td.replaceChildren(element("span", `lg-pay lg-pay--${pay.state}`, pay.text));
        continue;
      }
      const text = gridCellText(shown, column, year);
      if (!cell.button) {
        const target = cell.td.querySelector<HTMLElement>(".lg-celltext") ?? cell.td;
        target.textContent = text;
        continue;
      }
      cell.button.textContent = text;
      cell.button.setAttribute("aria-label", gridCellLabel(shown, column, year, basis));
      cell.button.disabled = state.locked || state.gone;
      cell.button.classList.toggle("is-waiting", waiting.has(column) || (column === "receivedWon" && state.carry !== null));
      cell.button.classList.toggle("is-failed", failedColumns.has(column));
      cell.button.classList.toggle("is-empty", !text);
    }
    const warn = state.queue.length === 0 ? warnList(state.entry) : null;
    state.warn.replaceChildren(...(warn ? [warn] : []));
    state.trash.disabled = state.locked || state.gone;
    state.status.textContent = state.statusText;
    state.status.classList.toggle("is-bad", state.failed !== null);
    state.row.classList.toggle("is-saved", state.saved);
    state.row.classList.toggle("is-gone", state.gone);
    syncNote(state);
  }

  function buildRow(entry: LedgerEntry, saved: boolean): RowState {
    const row = element("tr");
    row.dataset.lgEntry = entry.id;
    const cells = new Map<Column, Cell>();
    const warn = element("div", "lg-cellwarn");
    const basis = host.basis();
    for (const column of LEDGER_GRID_COLUMNS) {
      const td = element("td", NUMERIC.has(column) ? "num" : "");
      td.dataset.lgCol = column;
      let button: HTMLButtonElement | null = null;
      if (column === "kind") td.append(kindBadge(entry.kind));
      else if (column === "totalWon") td.classList.add("lg-auto");
      else if (gridCellEditable(entry, column, basis)) {
        button = element("button", "lg-cell");
        button.type = "button";
        button.dataset.lgCell = column;
        td.append(button);
      } else if (column === "basisOn" && fromDeal(entry) && (basis !== "received" || entry.kind === "expense")) {
        // 거래에 이은 줄의 날짜는 거래의 날짜라 여기서 고치지 않는다(글로도 알림)
        td.classList.add("lg-fixed");
        td.title = "거래의 날짜입니다. 손님 카드의 거래에서 고칩니다.";
        td.append(element("span", "lg-celltext"), element("span", "sr-only", " (거래의 날짜, 여기서 고치지 않음)"));
      }
      if (column === "label") td.append(warn);
      cells.set(column, { td, button });
      row.append(td);
    }
    const action = element("td", "lg-rowend");
    const status = element("span", "lg-rowstate");
    action.append(status, editButton(entry), trashButton(entry));
    row.append(action);
    const trash = action.querySelector<HTMLButtonElement>("button[data-lg-trash]")!;
    return { entry, placedOn: entry.basisOn, row, noteRow: null, cells, status, warn, trash, queue: [], running: false, failed: null, locked: false, gone: false, statusText: "", note: null, carry: null, saved };
  }

  // 줄을 처음부터 다시 만든다(다른 곳에서 고친 줄을 다시 읽었을 때 — 고칠 수 있는 칸이 달라졌을 수 있다).
  function rebuildRow(state: RowState, entry: LedgerEntry) {
    const next = buildRow(entry, false);
    state.row.replaceWith(next.row);
    state.entry = entry;
    state.row = next.row;
    state.cells = next.cells;
    state.status = next.status;
    state.warn = next.warn;
    state.trash = next.trash;
    if (state.noteRow) state.row.after(state.noteRow);
  }

  const rowStates = () => [...tbody.querySelectorAll<HTMLTableRowElement>("tr[data-lg-entry]")].map((row) => rows.get(row.dataset.lgEntry ?? "")).filter((state): state is RowState => Boolean(state));

  function focusCell(state: RowState | undefined, column: Column | undefined) {
    const button = state && column ? state.cells.get(column)?.button : null;
    if (!button || button.disabled) return false;
    button.focus();
    return true;
  }
  // 고칠 수 있는 칸만 선다. Tab·Shift+Tab은 줄 끝·줄 머리에서 다음·앞 줄로 넘어간다.
  function moveFocus(state: RowState, column: Column, key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight", wrap = false) {
    const states = rowStates();
    const cells = states.map((one) => LEDGER_GRID_COLUMNS.map((name) => Boolean(one.cells.get(name)?.button) && !one.locked && !one.gone));
    const from = { row: states.indexOf(state), col: LEDGER_GRID_COLUMNS.indexOf(column) };
    if (from.row < 0) return false;
    let to = moveGridFocus(cells, from, key);
    if (wrap && to.row === from.row && to.col === from.col) {
      const step = key === "ArrowRight" ? 1 : -1;
      for (let row = from.row + step; row >= 0 && row < cells.length; row += step) {
        const col = step > 0 ? cells[row].indexOf(true) : cells[row].lastIndexOf(true);
        if (col >= 0) {
          to = { row, col };
          break;
        }
      }
    }
    if (to.row === from.row && to.col === from.col) return false;
    return focusCell(states[to.row], LEDGER_GRID_COLUMNS[to.col]);
  }

  function closeEditor() {
    if (!editor) return;
    const { state, column, input } = editor;
    editor.closed = true;
    editor = null;
    input.remove();
    const button = state.cells.get(column)?.button;
    if (button) button.hidden = false;
  }

  function cancelEditor({ focus = true } = {}) {
    if (!editor) return;
    const { state, column } = editor;
    closeEditor();
    state.carry = null;
    state.note = null;
    syncRow(state);
    if (focus) focusCell(state, column);
  }

  function enqueue(state: RowState, job: Job) {
    state.queue.push(job);
    state.note = null;
    syncRow(state);
    void pump(state);
  }

  function commitEditor(how: "down" | "right" | "left" | "stay") {
    if (!editor || editor.closed) return;
    const current = editor;
    const { state, column, input } = current;
    // 날짜를 넣다 만 칸은 브라우저가 값을 빈 글자로 준다. 날짜를 비우는 것으로 읽어 저장하지 않는다.
    const partialDate = input instanceof HTMLInputElement && input.type === "date" && input.validity.badInput;
    const plan = partialDate ? ({ kind: "error", message: "날짜를 연·월·일 모두 넣어 주세요." } as const) : planCellEdit(shownEntry(state, { withCarry: false }), column, input.value, { carry: current.carry });
    if (plan.kind === "error") {
      input.setAttribute("aria-invalid", "true");
      state.note = { text: plan.message, bad: true };
      syncNote(state);
      host.announce(plan.message);
      return;
    }
    closeEditor();
    if (plan.kind === "ask-date") {
      // 입금일이 빈 줄에 입금액을 넣음: 저장하지 않고 입금일 칸을 오늘로 채워 열어 둔다(Enter·칸 떠나기 = 두 칸 함께 저장, Esc = 둘 다 그만둠).
      state.carry = plan.carry;
      state.note = { text: plan.message, bad: false };
      syncRow(state);
      host.announce(plan.message);
      openEditor(state, "receivedOn", { text: host.today(), carry: plan.carry });
      return;
    }
    const typed = current.carry ? `${typedText("receivedWon", String(current.carry.receivedWon))}, ${typedText(column, input.value)}` : typedText(column, input.value);
    state.carry = null;
    if (plan.kind === "none") {
      state.note = null;
      syncRow(state);
    } else {
      enqueue(state, { changes: plan.changes, note: plan.note, history: "record", title: historyStepTitle(state.entry, current.carry ? "receivedWon" : column), typed });
    }
    if (how === "stay") return;
    // 갈 곳이 없으면(표 끝) 고친 칸에 남는다
    const moved = how === "down" ? moveFocus(state, column, "ArrowDown") : moveFocus(state, column, how === "right" ? "ArrowRight" : "ArrowLeft", true);
    if (!moved) focusCell(state, column);
  }

  function openEditor(state: RowState, column: Column, { text, carry = null }: { text?: string; carry?: { receivedWon: number } | null } = {}) {
    if (editor) {
      if (editor.state === state && editor.column === column) return;
      if (editor.carry) {
        // 입금일을 묻는 중: 다른 칸을 눌러도 넘어가지 않는다(Enter로 함께 저장하거나 Esc로 둘 다 그만둔 뒤에 옮김)
        editor.input.focus();
        host.announce(LEDGER_ASK_DATE_NOTE);
        return;
      }
      // 잘못된 값이라 열려 있던 칸은 그만둔다(보내지 않은 값)
      cancelEditor({ focus: false });
    }
    const cell = state.cells.get(column);
    if (!cell?.button || state.locked || state.gone) return;
    closeConfirm(false);
    host.interrupted(false);
    const shown = shownEntry(state);
    const label = gridCellLabel(shown, column, host.year(), host.basis());
    let input: HTMLInputElement | HTMLSelectElement;
    if (column === "payerRole") {
      const select = element("select", "lg-cellinput");
      select.append(new Option("없음", ""), ...Object.entries(payerLabels).map(([value, name]) => new Option(name, value)));
      select.value = gridEditText(shown, column);
      input = select;
    } else {
      const field = element("input", "lg-cellinput");
      const date = column === "basisOn" || column === "receivedOn";
      field.type = date ? "date" : "text";
      field.autocomplete = "off";
      if (MONEY.has(column)) field.inputMode = "numeric";
      if (column === "label") field.maxLength = 200;
      field.value = text ?? gridEditText(shown, column);
      input = field;
    }
    input.setAttribute("aria-label", label);
    input.dataset.lgInput = column;
    const current: Editor = { state, column, input, carry, closed: false, fresh: carry !== null };
    editor = current;
    cell.button.hidden = true;
    cell.td.prepend(input);
    input.focus();
    if (input instanceof HTMLInputElement && input.type === "text") {
      if (text === undefined) input.select();
      else input.setSelectionRange(input.value.length, input.value.length);
    }
    // 입금액 칸을 떠나며(다른 곳을 눌러) 막 열린 입금일 칸은, 그 누름에 바로 닫혀 저장되지 않게 한 박자 지킨다.
    // Chromium에서는 이 지킴이 없어도 결과가 같다(blur 처리 중 focus가 바뀌면 그 누름의 focus 옮김을 그만둠). Firefox·Safari는 확인하지 못해 방어로 둔다.
    if (current.fresh) window.setTimeout(() => {
      current.fresh = false;
    }, 0);
    input.addEventListener("keydown", (event) => {
      // 한글을 조합하는 중의 Enter·Tab·Esc는 입력기 몫이다(조합 중 저장하면 마지막 글자가 빠지거나 다음 칸에 남는다).
      if ((event as KeyboardEvent).isComposing || (event as KeyboardEvent).keyCode === 229) return;
      const key = (event as KeyboardEvent).key;
      if (key === "Escape") {
        event.preventDefault();
        cancelEditor();
      } else if (key === "Enter") {
        event.preventDefault();
        commitEditor("down");
      } else if (key === "Tab") {
        event.preventDefault();
        commitEditor((event as KeyboardEvent).shiftKey ? "left" : "right");
      }
    });
    if (MONEY.has(column)) input.addEventListener("input", () => {
      // 금액 칸은 숫자만 받고 쉼표를 붙인다
      const digits = input.value.replace(/\D/gu, "").slice(0, 15);
      input.value = digits ? numberText(Number(digits)) : "";
    });
    input.addEventListener("blur", () => {
      if (editor !== current || current.closed) return;
      if (current.fresh) {
        window.setTimeout(() => {
          if (editor === current && !current.closed) input.focus();
        }, 0);
        return;
      }
      commitEditor("stay");
    });
  }

  // 다른 곳에서 먼저 고쳤거나(409) 줄이 없어짐(404): 덮어쓰지 않고 멈춘다. 기다리던 저장은 버리고 넣던 값은 글로 남긴다.
  async function stopForConflict(state: RowState, code: string) {
    const typed = state.queue.filter((job) => job.history === "record").map((job) => job.typed);
    const kept = typed.length > 0 ? ` 넣던 값: ${typed.join(", ")}` : "";
    const fromHistory = Boolean(state.queue[0]) && state.queue[0].history !== "record";
    host.interrupted(true);
    if (editor?.state === state) closeEditor();
    state.queue = [];
    state.failed = null;
    state.carry = null;
    state.locked = true;
    state.statusText = code === "VERSION_CONFLICT" ? "다시 읽는 중…" : "";
    state.note = null;
    syncRow(state);
    let fresh: LedgerEntry | null = null;
    let unread = false;
    if (code === "VERSION_CONFLICT") {
      try {
        fresh = await host.reloadRow(state.entry.id);
      } catch {
        unread = true;
      }
    }
    if (rows.get(state.entry.id) !== state) return;
    state.statusText = "";
    if (fresh) {
      rebuildRow(state, fresh);
      state.locked = false;
      state.note = { text: `다른 곳에서 먼저 고쳐 저장하지 않았습니다. 저장된 값을 다시 읽었습니다.${kept}${fromHistory ? " 되돌리기·다시 하기는 멈췄습니다. 값을 확인한 뒤 다시 눌러 주세요." : ""}`, bad: true };
      host.entryChanged(fresh);
    } else if (unread) {
      state.note = { text: `다른 곳에서 먼저 고쳐 저장하지 않았습니다. 이 줄을 다시 읽지 못했습니다. 화면을 새로 고쳐 주세요.${kept}`, bad: true };
    } else {
      state.gone = true;
      history.forget(state.entry.id);
      notifyHistory();
      state.note = { text: `${code === "NOT_FOUND" ? "이 장부 줄을 찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다." : "이 줄이 지금 목록에 없습니다. 지워졌거나, 날짜·입금이 바뀌어 다른 연도나 거르기 밖으로 옮겨졌습니다."}${kept}`, bad: true };
    }
    syncRow(state);
    host.totalsChanged();
    host.announce(state.note?.text ?? "");
  }

  // 한 줄의 저장은 차례로 하나씩만 보낸다(앞 저장이 끝나야 다음 칸을 보냄).
  async function pump(state: RowState) {
    if (state.running || state.failed !== null || state.locked || state.gone) return;
    const job = state.queue[0];
    if (!job) return;
    state.running = true;
    state.statusText = job.history === "undo" ? "되돌리는 중…" : job.history === "redo" ? "다시 하는 중…" : "저장 중…";
    syncRow(state);
    const before = changesBefore(state.entry, job.changes);
    const beforeBasis = state.entry.basisOn;
    try {
      const saved = await host.save(state.entry.id, job.changes, state.entry.version);
      if (rows.get(state.entry.id) !== state) return;
      const entry: LedgerEntry = { ...saved.entry, warnings: saved.warnings, basisOn: basisAfterSave(state.entry, saved.entry, host.basis()) };
      state.entry = entry;
      state.queue.shift();
      state.running = false;
      state.statusText = "저장함";
      if (job.history === "record") history.record({ id: entry.id, title: job.title, before, after: job.changes });
      else if (job.history === "undo") history.doneUndo();
      else history.doneRedo();
      const notes = [job.note, movedNote(beforeBasis, entry.basisOn)].filter(Boolean);
      state.note = notes.length > 0 ? { text: notes.join(" "), bad: false } : null;
      syncRow(state);
      notifyHistory();
      host.entryChanged(entry);
      host.totalsChanged();
      host.announce(`저장했습니다. ${job.title}${notes.length > 0 ? `. ${notes.join(" ")}` : ""}`);
      void pump(state);
      if (!isDirty()) host.settled();
    } catch (error) {
      if (rows.get(state.entry.id) !== state) return;
      state.running = false;
      const code = error instanceof WorkApiError ? error.code : null;
      if (code === "VERSION_CONFLICT" || code === "NOT_FOUND") {
        await stopForConflict(state, code);
        return;
      }
      host.interrupted(true);
      if (job.history !== "record") {
        // 되돌리기·다시 하기를 못 함: 단계는 그대로 두고 칸도 건드리지 않는다
        state.queue.shift();
        state.statusText = "";
        state.note = { text: `${job.history === "undo" ? "되돌리지" : "다시 하지"} 못했습니다. ${host.errorText(code)}`, bad: true };
      } else {
        state.failed = host.errorText(code);
        state.statusText = "저장 못 함";
      }
      syncRow(state);
      host.announce(state.failed !== null ? `저장하지 못했습니다. ${state.failed}` : state.note?.text ?? "");
    }
  }

  function runHistory(which: "undo" | "redo") {
    const step = which === "undo" ? history.peekUndo() : history.peekRedo();
    if (!step) return;
    const state = rows.get(step.id);
    if (!state || state.gone) {
      host.announce("그 줄이 지금 목록에 없어 하지 못했습니다. 그 줄이 보이는 연도·거르기로 바꾼 뒤 다시 눌러 주세요.", true);
      return;
    }
    if (state.running || state.queue.length > 0 || state.failed !== null || state.locked) {
      host.announce("그 줄을 저장하고 있거나 저장하지 못한 칸이 있습니다. 끝난 뒤 다시 눌러 주세요.", true);
      return;
    }
    if (editor) cancelEditor({ focus: false });
    host.interrupted(false);
    host.announce("", true);
    enqueue(state, { changes: which === "undo" ? step.before : step.after, note: `${which === "undo" ? "되돌렸습니다" : "다시 했습니다"}: ${step.title}`, history: which, title: step.title, typed: "" });
  }

  tbody.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const trash = target?.closest<HTMLButtonElement>("button[data-lg-trash]");
    if (trash) {
      const state = rows.get(trash.dataset.lgTrash ?? "");
      if (state) openConfirm(state);
      return;
    }
    if (target?.closest("[data-lg-trash-go]")) {
      void removeConfirmed();
      return;
    }
    if (target?.closest("[data-lg-trash-cancel]")) {
      closeConfirm(true);
      return;
    }
    const cellButton = target?.closest<HTMLButtonElement>("button[data-lg-cell]");
    const id = target?.closest<HTMLTableRowElement>("tr[data-lg-entry]")?.dataset.lgEntry;
    if (cellButton && id) {
      const state = rows.get(id);
      if (state) openEditor(state, cellButton.dataset.lgCell as Column);
      return;
    }
    const retry = target?.closest<HTMLElement>("[data-lg-retry]");
    const revert = target?.closest<HTMLElement>("[data-lg-revert]");
    const state = rows.get(retry?.dataset.lgRetry ?? revert?.dataset.lgRevert ?? "");
    if (!state || state.failed === null) return;
    host.interrupted(false);
    state.failed = null;
    if (revert) {
      state.queue.shift();
      state.statusText = "";
    }
    syncRow(state);
    void pump(state);
    focusCell(state, [...state.cells].find(([, cell]) => cell.button && !cell.button.disabled)?.[0]);
  });

  tbody.addEventListener("keydown", (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target) return;
    const typing = target.matches("input, select, textarea");
    const key = event.key;
    if (!typing && (event.ctrlKey || event.metaKey) && !event.altKey) {
      // 입력칸 안의 Ctrl+Z는 브라우저가 그 칸의 글자를 되돌린다
      const lower = key.toLowerCase();
      if (lower === "z" || lower === "y") {
        event.preventDefault();
        runHistory(lower === "y" || event.shiftKey ? "redo" : "undo");
      }
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-lg-cell]");
    const state = rows.get(target.closest<HTMLTableRowElement>("tr[data-lg-entry]")?.dataset.lgEntry ?? "");
    if (!button || !state || typing) return;
    const column = button.dataset.lgCell as Column;
    if (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault();
      moveFocus(state, column, key);
    } else if (key === "F2") {
      event.preventDefault();
      openEditor(state, column);
    } else if (key.length === 1 && key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && (column === "label" || (MONEY.has(column) && /\d/u.test(key)))) {
      // 글자를 치면 그 글자로 고치기 시작
      event.preventDefault();
      openEditor(state, column, { text: key });
    }
  });

  // ── 빈 새 줄(D-2b, 11:34:13 시안): 합계 줄 바로 아래. 누르면 그 자리에서 거래 없는 장부 줄을 적고 Enter로 POST 한 번, Esc로 버린다 ──
  // 줄은 한 번만 만들어 목록을 다시 그려도 넣던 값을 지킨다(거르기를 켜면 표에서 빼 두었다가 끄면 다시 넣음).
  // 칸에 이미 들어 있는 입력칸은 다시 넣지 않는다(다시 넣으면 치던 칸의 포커스가 빠짐).
  const put = (td: HTMLElement, node: Node) => {
    if (td.childNodes.length !== 1 || td.firstChild !== node) td.replaceChildren(node);
  };
  const newRow = buildNewRow();

  function moneyInput(name: string) {
    const input = element("input", "lg-newinput");
    input.type = "text";
    input.inputMode = "numeric";
    input.autocomplete = "off";
    input.setAttribute("aria-label", name);
    return input;
  }
  function buildNewRow() {
    const row = element("tr", "lg-newrow");
    row.dataset.lgNewrow = "";
    const cells = new Map<Column, HTMLTableCellElement>();
    for (const column of LEDGER_GRID_COLUMNS) {
      const td = element("td", NUMERIC.has(column) ? "num" : "");
      td.dataset.lgCol = column;
      if (column === "totalWon") td.classList.add("lg-auto");
      cells.set(column, td);
      row.append(td);
    }
    const rowend = element("td", "lg-rowend");
    const status = element("span", "lg-rowstate");
    rowend.append(status);
    row.append(rowend);
    // 처음 모양: '+' · '종류 ▾' · '새 장부 줄'(누르는 곳은 '새 장부 줄' 단추 하나, 마우스는 줄 어디를 눌러도 됨)
    const sign = element("span", "lg-newsign", "+");
    sign.setAttribute("aria-hidden", "true");
    const hint = element("span", "lg-newhint", "종류 ▾");
    hint.setAttribute("aria-hidden", "true");
    const start = element("button", "lg-cell lg-newstart", LEDGER_NEW_START);
    start.type = "button";
    start.dataset.lgNewrowStart = "";
    start.setAttribute("aria-label", "새 장부 줄 적기");
    const date = element("input", "lg-newinput");
    date.type = "date";
    date.setAttribute("aria-label", "새 줄 날짜");
    const kind = element("select", "lg-newinput");
    for (const value of LEDGER_NEW_KINDS) kind.append(new Option(kindLabels[value] ?? value, value));
    kind.setAttribute("aria-label", "새 줄 종류");
    const label = element("input", "lg-newinput");
    label.type = "text";
    label.maxLength = 200;
    label.autocomplete = "off";
    label.setAttribute("aria-label", "새 줄 물건 표시·내용");
    const payer = element("select", "lg-newinput");
    payer.append(new Option("없음", ""), ...Object.entries(payerLabels).map(([value, name]) => new Option(name, value)));
    payer.setAttribute("aria-label", "새 줄 낸 쪽");
    const inputs: Record<NewColumn, HTMLInputElement | HTMLSelectElement> = {
      basisOn: date, kind, label, payerRole: payer, amountWon: moneyInput("새 줄 공급가액(원)"), vatWon: moneyInput("새 줄 부가세(원)"),
    };
    for (const [column, input] of Object.entries(inputs)) input.dataset.lgNewrowInput = column;
    const note = element("tr", "lg-noterow lg-newnote");
    const noteCell = element("td");
    noteCell.colSpan = COLUMN_COUNT;
    const noteText = element("p");
    const save = element("button", "work-secondary-button", "저장");
    save.type = "button";
    save.dataset.lgNewrowSave = "";
    const cancel = element("button", "work-secondary-button", "그만두기");
    cancel.type = "button";
    cancel.dataset.lgNewrowCancel = "";
    const actions = element("span", "lg-noterow__actions");
    actions.append(save, cancel);
    noteCell.append(noteText, actions);
    note.append(noteCell);
    return { row, note, noteText, save, cancel, cells, status, sign, hint, start, inputs, active: false, vatTouched: false, error: null as { column: string; message: string } | null };
  }

  const newValues = () => {
    const inputs = newRow.inputs;
    return { kind: inputs.kind.value, entryOn: inputs.basisOn.value, label: inputs.label.value, payerRole: inputs.payerRole.value, amount: inputs.amountWon.value, vat: inputs.vatWon.value };
  };
  const syncNewTotal = () => {
    const { inputs } = newRow;
    newRow.cells.get("totalWon")!.textContent = inputs.kind.value === "expense" ? "—" : newRowTotalText(inputs.kind.value, inputs.amountWon.value, inputs.vatWon.value);
  };

  // 칸 모양을 지금 상태(처음·적는 중·저장 중, 종류)에 맞춘다.
  function syncNewRow() {
    const { cells, inputs } = newRow;
    newRow.row.classList.toggle("is-active", newRow.active);
    if (!newRow.active) {
      for (const td of cells.values()) td.replaceChildren();
      cells.get("basisOn")!.append(newRow.sign);
      cells.get("kind")!.append(newRow.hint);
      cells.get("label")!.append(newRow.start);
      newRow.status.textContent = "";
      newRow.note.remove();
      return;
    }
    const kind = inputs.kind.value;
    for (const column of LEDGER_GRID_COLUMNS) {
      const td = cells.get(column)!;
      if ((LEDGER_NEW_COLUMNS as readonly string[]).includes(column)) {
        if (newRowHasInput(kind, column)) put(td, inputs[column as NewColumn]);
        else td.replaceChildren(element("span", "lg-newdash", "—"));
      } else if (column === "receivedWon") td.textContent = "—";
      else if (column !== "totalWon") td.replaceChildren();
    }
    syncNewTotal();
    // 저장 중에는 줄을 잠근다(Enter를 빨리 두 번 눌러도 POST는 한 번). 글 칸은 읽기 전용으로 두어 포커스가 빠지지 않게 한다.
    for (const [column, input] of Object.entries(inputs)) {
      if (newRow.error?.column === column) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
      if (input instanceof HTMLSelectElement) input.disabled = creating;
      else input.readOnly = creating;
    }
    newRow.row.classList.toggle("is-locked", creating);
    newRow.save.disabled = creating;
    newRow.cancel.disabled = creating;
    newRow.status.textContent = creating ? "저장 중…" : "새 줄";
    newRow.note.classList.toggle("is-bad", Boolean(newRow.error));
    newRow.noteText.textContent = newRow.error ? `! ${newRow.error.message}` : newRowNote(kind, host.basis());
    if (newRow.row.isConnected && newRow.row.nextElementSibling !== newRow.note) newRow.row.after(newRow.note);
  }

  // 합계 줄 바로 아래(합계 줄이 없으면 맨 위). 이미 그 자리면 옮기지 않는다(옮기면 치던 칸의 포커스가 빠짐).
  function placeNewRow() {
    if (!host.newRowAllowed()) {
      newRow.row.remove();
      newRow.note.remove();
      return;
    }
    const total = tbody.querySelector("tr.lg-group--total");
    const inPlace = total ? total.nextElementSibling === newRow.row : tbody.firstElementChild === newRow.row;
    if (!inPlace) {
      if (total) total.after(newRow.row);
      else tbody.prepend(newRow.row);
    }
    if (newRow.active) {
      if (newRow.row.nextElementSibling !== newRow.note) newRow.row.after(newRow.note);
    } else newRow.note.remove();
  }

  function activateNewRow(column: string) {
    if (creating) return;
    if (!newRow.active) {
      const { inputs } = newRow;
      newRow.active = true;
      newRow.vatTouched = false;
      newRow.error = null;
      inputs.basisOn.value = host.today();
      inputs.kind.value = LEDGER_NEW_KINDS[0];
      for (const input of [inputs.label, inputs.payerRole, inputs.amountWon, inputs.vatWon]) input.value = "";
      host.interrupted(false);
      syncNewRow();
      placeNewRow();
    }
    const kind = newRow.inputs.kind.value;
    const target = (LEDGER_NEW_COLUMNS as readonly string[]).includes(column) && newRowHasInput(kind, column) ? newRow.inputs[column as NewColumn] : newRow.inputs.label;
    target.focus();
  }
  function resetNewRow() {
    newRow.active = false;
    newRow.error = null;
    syncNewRow();
    placeNewRow();
  }
  function cancelNewRow() {
    if (creating) return;
    resetNewRow();
    if (newRow.start.isConnected) newRow.start.focus();
  }
  function showNewError(column: string, message: string) {
    newRow.error = { column, message };
    syncNewRow();
    host.announce(message);
    const input = (LEDGER_NEW_COLUMNS as readonly string[]).includes(column) && newRowHasInput(newRow.inputs.kind.value, column) ? newRow.inputs[column as NewColumn] : null;
    (input ?? newRow.inputs.label).focus();
  }

  async function submitNewRow() {
    if (!newRow.active || creating) return;
    if (removing || rowsDirty()) {
      newRow.error = { column: "", message: BUSY_TEXT };
      syncNewRow();
      host.announce(BUSY_TEXT);
      return;
    }
    if (editor) cancelEditor({ focus: false });
    const plan = planNewRow(newValues());
    if (!plan.ok) {
      showNewError(plan.column, plan.message);
      return;
    }
    creating = true;
    newRow.error = null;
    syncNewRow();
    try {
      await host.create(plan.body);
      creating = false;
      resetNewRow();
      if (newRow.start.isConnected) newRow.start.focus();
      else host.focusFallback();
      if (!isDirty()) host.settled();
    } catch (error) {
      creating = false;
      const code = error instanceof WorkApiError ? error.code : null;
      host.interrupted(true);
      showNewError("", `저장하지 못했습니다. ${host.errorText(code)} 넣은 값은 칸에 그대로 있습니다.`);
    }
  }

  const formatMoney = (input: HTMLInputElement | HTMLSelectElement) => {
    const digits = input.value.replace(/\D/gu, "").slice(0, 15);
    input.value = digits ? numberText(Number(digits)) : "";
  };
  newRow.row.addEventListener("click", (event) => {
    if (newRow.active) return;
    const td = event.target instanceof Element ? event.target.closest<HTMLElement>("td[data-lg-col]") : null;
    activateNewRow(td?.dataset.lgCol ?? "label");
  });
  for (const part of [newRow.row, newRow.note]) part.addEventListener("keydown", (event) => {
    if (!newRow.active) return;
    // 한글을 조합하는 중의 Enter·Esc는 입력기 몫이다(조합 중 Enter로 저장하면 마지막 글자가 빠지거나 저장 뒤 비운 칸에 남는다).
    if (event.isComposing || event.keyCode === 229) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (event.key === "Escape") {
      event.preventDefault();
      cancelNewRow();
    } else if (event.key === "Enter" && target?.matches("input, select")) {
      event.preventDefault();
      void submitNewRow();
    }
  });
  newRow.inputs.kind.addEventListener("change", () => {
    const { inputs } = newRow;
    if (!newRow.vatTouched) inputs.vatWon.value = newRowVatText(inputs.kind.value, inputs.amountWon.value) ?? "";
    if (newRow.error && !newRowHasInput(inputs.kind.value, newRow.error.column)) newRow.error = null;
    syncNewRow();
  });
  newRow.inputs.amountWon.addEventListener("input", () => {
    const { inputs } = newRow;
    formatMoney(inputs.amountWon);
    // 보수 줄은 부가세를 직접 고치기 전까지 공급가액의 10%로 채운다(입력 화면의 '10%로 채우기'와 같은 값)
    const vat = newRowVatText(inputs.kind.value, inputs.amountWon.value);
    if (!newRow.vatTouched && vat !== null) inputs.vatWon.value = vat;
    syncNewTotal();
  });
  newRow.inputs.vatWon.addEventListener("input", () => {
    formatMoney(newRow.inputs.vatWon);
    newRow.vatTouched = true;
    syncNewTotal();
  });
  for (const [column, input] of Object.entries(newRow.inputs)) input.addEventListener("input", () => {
    if (newRow.error?.column !== column) return;
    newRow.error = null;
    syncNewRow();
  });
  newRow.save.addEventListener("click", () => void submitNewRow());
  newRow.cancel.addEventListener("click", cancelNewRow);
  syncNewRow();

  // ── 줄 끝 지우기(D-2b): 줄 아래에 묻고(확인 창 없음) '휴지통으로 옮기기'를 누르면 지운다. 다른 지우기 화면과 같은 휴지통 규칙 ──
  let confirm: { state: RowState; row: HTMLTableRowElement; text: HTMLElement; go: HTMLButtonElement; cancel: HTMLButtonElement } | null = null;

  function openConfirm(state: RowState) {
    if (state.locked || state.gone || removing) return;
    if (isDirty()) {
      host.announce(BUSY_TEXT, true);
      return;
    }
    if (editor) cancelEditor({ focus: false });
    closeConfirm(false);
    host.interrupted(false);
    const row = element("tr", "lg-noterow lg-confirmrow");
    const cell = element("td");
    cell.colSpan = COLUMN_COUNT;
    const text = element("p", "", deleteAskText(state.entry, TRASH_MOVE_NOTICE));
    const go = element("button", "work-secondary-button lg-trash-go", "휴지통으로 옮기기");
    go.type = "button";
    go.dataset.lgTrashGo = state.entry.id;
    const cancel = element("button", "work-secondary-button", "그만두기");
    cancel.type = "button";
    cancel.dataset.lgTrashCancel = state.entry.id;
    const actions = element("span", "lg-noterow__actions");
    actions.append(go, cancel);
    cell.append(text, actions);
    row.append(cell);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeConfirm(true);
    });
    (state.noteRow ?? state.row).after(row);
    confirm = { state, row, text, go, cancel };
    go.focus();
  }
  function closeConfirm(focus: boolean) {
    const current = confirm;
    if (!current || removing) return;
    confirm = null;
    current.row.remove();
    if (focus && current.state.trash.isConnected) current.state.trash.focus();
  }

  async function removeConfirmed() {
    const current = confirm;
    if (!current || removing) return;
    if (creating || rowsDirty()) {
      current.text.textContent = `! ${BUSY_TEXT}`;
      current.row.classList.add("is-bad");
      return;
    }
    const { state } = current;
    const states = rowStates();
    // 지운 뒤 포커스: 다음 줄의 지우기 단추, 없으면 빈 새 줄, 그것도 없으면 화면이 정한 곳
    const nextId = states.slice(states.indexOf(state) + 1).find((one) => !one.gone)?.entry.id ?? null;
    removing = true;
    state.locked = true;
    state.statusText = "지우는 중…";
    current.go.disabled = true;
    current.cancel.disabled = true;
    syncRow(state);
    try {
      await host.remove(state.entry.id);
      removing = false;
      history.forget(state.entry.id);
      notifyHistory();
      if (confirm === current) confirm = null;
      current.row.remove();
      if (state.row.isConnected) {
        // 지웠지만 목록을 다시 그리지 못함: 줄을 흐리게 남기고 글로 알린다
        state.gone = true;
        state.statusText = "";
        state.note = { text: "휴지통으로 옮겼습니다. 목록을 다시 읽지 못했습니다. 화면을 새로 고쳐 주세요.", bad: true };
        syncRow(state);
      }
      const next = nextId ? rows.get(nextId) : undefined;
      if (next && next.row.isConnected && !next.trash.disabled) next.trash.focus();
      else if (newRow.start.isConnected) newRow.start.focus();
      else host.focusFallback();
      if (!isDirty()) host.settled();
    } catch (error) {
      removing = false;
      const code = error instanceof WorkApiError ? error.code : null;
      host.interrupted(true);
      state.locked = false;
      state.statusText = "";
      syncRow(state);
      current.go.disabled = false;
      current.cancel.disabled = false;
      current.text.textContent = `! 지우지 못했습니다. ${host.errorText(code)}`;
      current.row.classList.add("is-bad");
      host.announce(current.text.textContent);
      current.go.focus();
    }
  }

  function renderGroups(plan: LedgerGroupPlan) {
    for (const row of tbody.querySelectorAll("tr.lg-group")) row.remove();
    if (plan.total) tbody.prepend(ledgerGroupRow(plan.total, true));
    for (const [id, line] of plan.groups) rows.get(id)?.row.before(ledgerGroupRow(line));
    placeNewRow();
  }

  return {
    // 목록을 새로 그린다(연도·기준·거르기가 바뀌었거나 입력 화면에서 저장함). 기다리던 저장의 응답은 버린다.
    render(entries: LedgerEntry[], plan: LedgerGroupPlan, savedId: string | null = null) {
      editor = null;
      confirm = null;
      rows.clear();
      const nodes: HTMLTableRowElement[] = [];
      for (const entry of entries) {
        const state = buildRow(entry, entry.id === savedId);
        rows.set(entry.id, state);
        nodes.push(state.row);
      }
      tbody.replaceChildren(...nodes);
      for (const state of rows.values()) syncRow(state);
      renderGroups(plan);
      notifyHistory();
    },
    renderGroups,
    // 묶음 줄 자리를 정할 때 쓰는 줄 목록: 줄은 목록을 그릴 때의 달에 그대로 있다(고쳐서 다른 달이 돼도 자리를 옮기지 않음).
    placed: () => rowStates().map((state) => ({ id: state.entry.id, basisOn: state.placedOn })),
    undo: () => runHistory("undo"),
    redo: () => runHistory("redo"),
    // 저장 중이거나 저장하지 못한 칸, 입금일을 묻는 중인 칸이 있는지(화면을 떠나거나 목록을 바꾸기 전에 묻는다).
    dirty: isDirty,
    // 저장 중일 뿐인지(저장하지 못한 칸·입금일을 묻는 칸이 없음). 이때 막은 동작은 저장이 끝나면 이어서 할 수 있다.
    saving: () => isDirty() && ![...rows.values()].some((state) => state.failed !== null || state.carry !== null),
    // 화면을 처음부터 다시 열 때(뒤로 가기 복원) 되돌리기 단계를 비운다.
    forgetAll() {
      history.clear();
      notifyHistory();
      resetNewRow();
    },
    // 새 줄에 글자·금액을 넣다 만 채로 있는지(화면을 떠나기 전에 묻는다. 날짜·종류 처음 값은 넣은 것으로 치지 않음).
    newRowTyped: () => newRow.active && [newRow.inputs.label, newRow.inputs.amountWon, newRow.inputs.vatWon].some((input) => input.value.trim() !== ""),
  };
}
