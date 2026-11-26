// 달력 화면(/admin/work/calendar/)의 화면 조각. 서버 요청·브라우저 저장·주소 변경을 하지 않는다(서버 요청은 work-calendar-client.ts 한 곳).
// 일정 제목·손님 이름은 textContent로만 넣는다(HTML로 해석하지 않음). 색만으로 가르지 않게 칸마다 모양 기호와 글자를 함께 둔다.
import { element } from "./work-customers-dom";
import {
  cellLabel,
  chipText,
  chipsFor,
  itemGlyph,
  itemHref,
  itemMetaText,
  itemStateText,
  itemTimeText,
  marksFor,
  type CalendarItem,
} from "./work/calendar-view.mjs";

interface GridDay { on: string; day: number; inMonth: boolean; isToday: boolean; weekday: number }

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function chip(item: CalendarItem) {
  const node = element("span", `cal-chip is-${item.family}${item.done ? " is-done" : ""}${item.past && !item.late ? " is-past" : ""}`);
  node.append(element("i", "", itemGlyph(item)));
  node.lastElementChild?.setAttribute("aria-hidden", "true");
  if (item.late) node.append(element("b", "cal-chip__late", "!"));
  node.append(element("span", "cal-chip__text", chipText(item)));
  if (item.repeatRule !== "none") {
    const mark = element("em", "", "↻");
    mark.setAttribute("aria-hidden", "true");
    node.append(mark);
  }
  return node;
}

/**
 * 한 달 칸. 칸마다 넓은 화면용 글자 띠(3개 + 'n개 더')와 좁은 화면용 모양 표시(3개 또는 2개 + '+')를 함께 그리고, 어느 쪽을 보일지는 CSS가 정한다.
 * 칸 단추의 이름(aria-label)이 날짜·오늘·개수·지난 일정을 읽어 주므로 띠·표시는 읽지 않게 숨긴다.
 */
export function calendarGrid(days: GridDay[], byDay: Map<string, CalendarItem[]>, { selected, today, label }: { selected: string; today: string; label: string }) {
  const grid = element("div", "cal-grid");
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", label);
  for (const [index, name] of WEEKDAYS.entries()) {
    const head = element("div", `cal-wk${index === 0 ? " is-sun" : ""}`, name);
    head.setAttribute("aria-hidden", "true");
    grid.append(head);
  }
  for (const day of days) {
    const items = byDay.get(day.on) ?? [];
    const cell = element("button", `cal-cell${day.inMonth ? "" : " is-out"}${day.isToday ? " is-today" : ""}${day.weekday === 0 ? " is-sun" : ""}`);
    cell.type = "button";
    cell.dataset.calDay = day.on;
    cell.setAttribute("aria-pressed", String(day.on === selected));
    cell.setAttribute("aria-label", cellLabel(day.on, items, today));
    cell.tabIndex = day.on === selected ? 0 : -1;
    const number = element("span", "cal-num");
    number.append(element("span", "cal-d", String(day.day)));
    if (day.isToday) number.append(element("small", "", "오늘"));
    const chips = element("span", "cal-chips");
    const shown = chipsFor(items);
    chips.append(...shown.items.map(chip));
    if (shown.more) chips.append(element("span", "cal-more", `${shown.more}개 더`));
    const marks = element("span", "cal-marks");
    const shownMarks = marksFor(items);
    marks.append(...shownMarks.items.map((item) => element("i", `is-${item.family}${item.done || (item.past && !item.late) ? " is-dim" : ""}`, itemGlyph(item))));
    if (shownMarks.plus) marks.append(element("i", "is-plus", "+"));
    for (const part of [number, chips, marks]) part.setAttribute("aria-hidden", "true");
    cell.append(number, chips, marks);
    grid.append(cell);
  }
  return grid;
}

/** 그날 목록 한 줄. 거래 일정·할 일은 그 화면으로 가는 고리, 거래 없는 일정은 고치기 창을 여는 단추. */
export function dayRow(item: CalendarItem) {
  const li = element("li");
  const href = itemHref(item);
  const row = href ? element("a", "cal-row") : element("button", "cal-row");
  if (row instanceof HTMLAnchorElement && href) row.href = href;
  if (row instanceof HTMLButtonElement) {
    row.type = "button";
    row.dataset.calEdit = item.key;
  }
  row.classList.toggle("is-done", item.done);
  row.classList.toggle("is-past", item.past && !item.late && !item.done);
  row.append(element("span", "cal-row__time", itemTimeText(item)));
  const body = element("span", "cal-row__body");
  const top = element("span", "cal-row__top");
  const tag = element("span", `cal-tag is-${item.family}`);
  const glyph = element("i", "", itemGlyph(item));
  glyph.setAttribute("aria-hidden", "true");
  tag.append(glyph, item.label);
  top.append(tag);
  const state = itemStateText(item);
  if (state) top.append(element("span", `cal-state${item.late ? " is-late" : ""}`, state));
  body.append(top, element("strong", "", item.title), element("span", "cal-row__meta", itemMetaText(item)));
  const go = element("span", "cal-row__go", href ? "›" : "고치기");
  if (href) go.setAttribute("aria-hidden", "true");
  row.append(body, go);
  li.append(row);
  return li;
}
