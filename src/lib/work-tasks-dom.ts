// 할 일 화면과 업무 도구 처음의 '오늘 할 일' 칸이 쓰는 화면 조각. 서버 요청·브라우저 저장·주소 변경을 하지 않는다(서버 요청은 work-tasks-client.ts).
// 할 일 제목·거래 이름은 textContent로만 넣는다(HTML로 해석하지 않음). 지난 할 일·거래 상태는 색만이 아니라 글자로 알린다.
import type { Task } from "./work-tasks-client";
import { element } from "./work-customers-dom";
import { dealStatusText, homeDateText, lateText, repeatText, shiftedNote, taskDateText } from "./work/tasks-view.mjs";

function dealBadge(task: Task, link: boolean) {
  const deal = task.deal;
  if (!deal) return null;
  const box = link ? element("button", "tk-deal") : element("span", "tk-deal tk-deal--plain");
  box.append(element("span", "tk-deal__name", deal.title), element("span", `tk-status tk-status--${deal.status}`, dealStatusText(deal.status)));
  if (box instanceof HTMLButtonElement) {
    box.type = "button";
    box.dataset.tkDeal = deal.id;
    box.setAttribute("aria-label", `이 거래의 할 일만 보기: ${deal.title}, ${dealStatusText(deal.status)}`);
  }
  return box;
}

// 열린 할 일 한 줄: 끝냄 체크 단추 | 제목·날짜·반복·거래 | 고치기
export function taskRow(task: Task, today: string, { fresh = false, dealLink = true } = {}) {
  const item = element("li", `tk-row${fresh ? " tk-row--fresh" : ""}`);
  item.dataset.tkTask = task.id;
  const check = element("button", "tk-check");
  check.type = "button";
  check.dataset.tkDone = task.id;
  check.setAttribute("aria-label", `끝냄: ${task.title}`);
  check.append(element("span"));
  check.firstElementChild?.setAttribute("aria-hidden", "true");
  const body = element("div", "tk-row__body");
  const title = element("p", "tk-row__title", task.title);
  if (fresh) title.append(" ", element("span", "tk-new", "새로 만듦"));
  body.append(title);
  const meta = element("p", "tk-row__meta");
  if (task.dueOn) {
    const late = lateText(task.dueOn, today);
    const date = element("span", `tk-date${late ? " tk-date--late" : ""}`, `${taskDateText(task.dueOn)}${late ? ` · ${late}` : ""}`);
    const shifted = shiftedNote(task);
    if (shifted) date.append(" ", element("small", "", shifted));
    meta.append(date);
  }
  const repeat = repeatText(task);
  if (repeat) meta.append(element("span", "tk-repeat", `↻ ${repeat}`));
  const deal = dealBadge(task, dealLink);
  if (deal) meta.append(deal);
  if (meta.childNodes.length > 0) body.append(meta);
  const edit = element("button", "admin-text-link cu-linkbtn tk-edit", "고치기");
  edit.type = "button";
  edit.dataset.tkEdit = task.id;
  edit.setAttribute("aria-label", `고치기: ${task.title}`);
  item.append(check, body, edit);
  return item;
}

// 끝낸 할 일 한 줄: ✓ | 제목·끝낸 날·날짜·거래 | 다시 열기
export function doneRow(task: Task) {
  const item = element("li", "tk-row tk-row--done");
  item.dataset.tkTask = task.id;
  const mark = element("span", "tk-done-mark", "✓");
  mark.setAttribute("aria-hidden", "true");
  const body = element("div", "tk-row__body");
  body.append(element("p", "tk-row__title", task.title));
  const meta = element("p", "tk-row__meta");
  // doneAt은 저장 시각(UTC)이라 한국 날짜로 바꿔 보인다.
  const doneOn = task.doneAt ? new Date(Date.parse(task.doneAt) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
  if (doneOn) meta.append(element("span", "tk-date", `끝냄 ${taskDateText(doneOn)}`));
  if (task.dueOn) meta.append(element("span", "tk-date tk-date--soft", `날짜 ${taskDateText(task.dueOn)}`));
  const deal = dealBadge(task, false);
  if (deal) meta.append(deal);
  if (meta.childNodes.length > 0) body.append(meta);
  const reopen = element("button", "work-secondary-button tk-reopen", "다시 열기");
  reopen.type = "button";
  reopen.dataset.tkReopen = task.id;
  reopen.setAttribute("aria-label", `다시 열기: ${task.title}`);
  item.append(mark, body, reopen);
  return item;
}

// 업무 도구 처음 '오늘 할 일' 칸 한 줄(읽기만, 누르면 할 일 화면)
export function homeItem(task: Task, today: string) {
  const item = element("li");
  const link = element("a", "tk-home__item");
  link.href = "/admin/work/tasks/";
  const late = lateText(task.dueOn, today);
  link.append(element("span", `tk-home__date${late ? " tk-date--late" : ""}`, homeDateText(task.dueOn, today)), element("span", "tk-home__title", task.title));
  item.append(link);
  return item;
}
