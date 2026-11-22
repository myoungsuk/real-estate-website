// 할 일 화면(단계 2, /admin/work/tasks/)과 업무 도구 처음의 '오늘 할 일' 칸이 쓰는 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 시안 2026-11-22 13:22:11 "이 시안대로"(메뉴 A안). 묶음은 지난 할 일·오늘·이번 주(오늘 다음 날 ~ 이번 주 일요일)·나중·날짜 없음.
// 날짜는 모두 한국 날짜 YYYY-MM-DD 글자다. 할 일 제목은 화면에만 보이고 주소·브라우저 저장소·로그에 넣지 않는다.
import { nextTaskDueOn } from "./task-repeat.mjs";
import { DEAL_STATUS_LABELS } from "./customers-view.mjs";

export const TASK_TITLE_MAX = 80; // 서버(work-input.mjs readTaskTitle)와 같음
export const TASK_DEAL_QUERY_MAX = 30; // 거래 찾기(매출장부와 같음)
export const TASK_PAGE_SIZE = 50; // 서버 기본·최대
export const TASK_HOME_SHOWN = 5; // 첫 화면 칸에 보이는 수
export const TASK_REPEAT_LABELS = Object.freeze({ none: "없음", weekly: "매주", monthly: "매월" });
export const TASK_NAME_HELP = "손님 이름은 제목에 넣지 않는 것이 좋습니다(캘린더 구독에 보일 수 있음).";
export { DEAL_STATUS_LABELS };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} value */
function dateTime(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
/** @param {string} value YYYY-MM-DD */
export const isTaskDate = (value) => dateTime(value) !== null;
/** @param {string} date */
const weekdayOf = (date) => WEEKDAYS[new Date(dateTime(date) ?? 0).getUTCDay()];

/** 목록 날짜 "11. 14.(토)" @param {string | null} date */
export function taskDateText(date) {
  if (!date || dateTime(date) === null) return "";
  return `${Number(date.slice(5, 7))}. ${Number(date.slice(8, 10))}.(${weekdayOf(date)})`;
}
/** 알림 날짜 "11월 25일(수)" @param {string | null} date */
export function taskLongDateText(date) {
  if (!date || dateTime(date) === null) return "";
  return `${Number(date.slice(5, 7))}월 ${Number(date.slice(8, 10))}일(${weekdayOf(date)})`;
}
/** 오늘보다 며칠 앞인지(지난 날 수, 오늘·앞날은 0) @param {string | null} dueOn @param {string} today */
export function lateDays(dueOn, today) {
  const due = dateTime(dueOn);
  const now = dateTime(today);
  if (due === null || now === null) return 0;
  return Math.max(0, Math.round((now - due) / DAY_MS));
}
/** 이번 주 일요일(오늘이 일요일이면 오늘) @param {string} today */
export function weekEndOf(today) {
  const now = dateTime(today);
  if (now === null) return today;
  const day = new Date(now).getUTCDay();
  return new Date(now + ((7 - day) % 7) * DAY_MS).toISOString().slice(0, 10);
}

/** @param {{ dueOn: string | null }} task @param {string} today */
export function taskGroupOf(task, today) {
  if (!task.dueOn) return "none";
  if (task.dueOn < today) return "past";
  if (task.dueOn === today) return "today";
  if (task.dueOn <= weekEndOf(today)) return "week";
  return "later";
}
export const TASK_GROUPS = Object.freeze(["past", "today", "week", "later", "none"]);
/** 묶음 제목(색만이 아니라 글자로) @param {string} key @param {string} today */
export function taskGroupTitle(key, today) {
  if (key === "past") return "! 지난 할 일";
  if (key === "today") return `오늘 · ${taskLongDateText(today)}`;
  if (key === "week") return `이번 주 · ${taskLongDateText(weekEndOf(today))}까지`;
  if (key === "later") return "나중";
  return "날짜 없음";
}
/**
 * 열린 할 일을 묶음으로 나눈다(서버 정렬 순서를 그대로 둔다). 빈 묶음은 뺀다.
 * @template {{ dueOn: string | null }} T
 * @param {T[]} items @param {string} today
 * @returns {{ key: string, title: string, items: T[] }[]}
 */
export function groupTasks(items, today) {
  return TASK_GROUPS.map((key) => ({ key, title: taskGroupTitle(key, today), items: items.filter((task) => taskGroupOf(task, today) === key) }))
    .filter((group) => group.items.length > 0);
}

/** 반복 표시 "매주 수요일"·"매월 31일"(없으면 빈 글) @param {{ repeat: string, repeatDay?: number | null, dueOn: string | null }} task */
export function repeatText(task) {
  if (task.repeat === "weekly" && task.dueOn) return `매주 ${weekdayOf(task.dueOn)}요일`;
  if (task.repeat === "monthly" && task.repeatDay) return `매월 ${task.repeatDay}일`;
  return "";
}
/** 매월 기준일이 없는 달이라 말일로 당겨진 줄이면 안내 @param {{ repeat: string, repeatDay?: number | null, dueOn: string | null }} task */
export function shiftedNote(task) {
  if (task.repeat !== "monthly" || !task.repeatDay || !task.dueOn) return "";
  return Number(task.dueOn.slice(8, 10)) !== task.repeatDay ? `(${task.repeatDay}일이 없는 달이라 말일)` : "";
}
/** 날짜 옆 "· 4일 지남" @param {string | null} dueOn @param {string} today */
export function lateText(dueOn, today) {
  const days = lateDays(dueOn, today);
  return days > 0 ? `${days}일 지남` : "";
}
/** 거래 상태 이름 @param {string} status */
export const dealStatusText = (status) => /** @type {Record<string, string>} */ (DEAL_STATUS_LABELS)[status] ?? status;

/** 만들기·고치기 칸의 반복 도움말 @param {string} repeat @param {string} dueOn */
export function repeatHelpText(repeat, dueOn) {
  if (!dueOn || !isTaskDate(dueOn)) return "날짜를 넣으면 고를 수 있습니다.";
  if (repeat === "weekly") return `매주 ${weekdayOf(dueOn)}요일.`;
  if (repeat === "monthly") {
    const day = Number(dueOn.slice(8, 10));
    return day >= 29 ? `매월 ${day}일. 그 날짜가 없는 달은 그 달 마지막 날에 합니다.` : `매월 ${day}일.`;
  }
  return "";
}
/**
 * 끝내면 생길 다음 할 일 미리 보기(서버와 같은 nextTaskDueOn). 반복이 없거나 날짜가 맞지 않으면 빈 글.
 * @param {{ dueOn: string, repeat: string, repeatDay?: number | null, today: string }} input
 */
export function nextPreviewText({ dueOn, repeat, repeatDay = null, today }) {
  if (repeat !== "weekly" && repeat !== "monthly") return "";
  if (!isTaskDate(dueOn)) return "";
  const day = repeat === "monthly" ? (repeatDay ?? Number(dueOn.slice(8, 10))) : undefined;
  const next = nextTaskDueOn({ dueOn, rule: repeat, day, today });
  if (!next) return "";
  let text = `끝내면 다음 할 일: ${taskLongDateText(next)}`;
  if (repeat === "monthly" && day && Number(next.slice(8, 10)) !== day) {
    const after = nextTaskDueOn({ dueOn: next, rule: repeat, day, today: next });
    if (after) text += ` (그다음은 ${Number(after.slice(5, 7))}월 ${Number(after.slice(8, 10))}일)`;
  }
  return text;
}

/**
 * 만들기·고치기 칸 검사. 제목은 앞뒤 빈칸을 빼고 1 ~ 80자(서버와 같은 셈), 반복은 날짜가 있어야 한다.
 * @param {{ title: string, dueOn: string, repeat: string }} values
 * @returns {{ ok: true, value: { title: string, dueOn: string | null, repeat: string } } | { ok: false, errors: Record<string, string> }}
 */
export function checkTaskInput(values) {
  const title = String(values.title ?? "").replace(/\s+/gu, " ").trim();
  const dueOn = String(values.dueOn ?? "").trim();
  const repeat = ["weekly", "monthly"].includes(values.repeat) ? values.repeat : "none";
  /** @type {Record<string, string>} */
  const errors = {};
  if (title.length === 0) errors.title = "제목을 넣어 주세요.";
  else if (title.length > TASK_TITLE_MAX) errors.title = `제목은 ${TASK_TITLE_MAX}자까지 넣을 수 있습니다(지금 ${title.length}자).`;
  if (dueOn && !isTaskDate(dueOn)) errors.dueOn = "날짜를 달력에서 골라 주세요.";
  else if (repeat !== "none" && !dueOn) errors.dueOn = "반복하려면 날짜를 넣어 주세요.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { title, dueOn: dueOn || null, repeat } };
}
/**
 * 고치기: 바뀐 칸만(PATCH). 거래는 dealId(null이면 뗌)로.
 * @param {{ title: string, dueOn: string | null, repeat: string, deal: { id: string } | null }} task
 * @param {{ title: string, dueOn: string | null, repeat: string }} value
 * @param {string | null} dealId
 */
export function taskChanges(task, value, dealId) {
  /** @type {Record<string, unknown>} */
  const body = {};
  if (value.title !== task.title) body.title = value.title;
  if (value.dueOn !== task.dueOn) body.dueOn = value.dueOn;
  if (value.repeat !== task.repeat) body.repeat = value.repeat;
  if (dealId !== (task.deal?.id ?? null)) body.dealId = dealId;
  return body;
}
/** 서버가 돌려준 잘못된 칸 이름(VALIDATION_FAILED details) → 칸별 글 @param {string[]} fields */
export function taskFieldErrors(fields) {
  /** @type {Record<string, string>} */
  const texts = {
    title: `제목은 1 ~ ${TASK_TITLE_MAX}자로 넣어 주세요.`,
    dueOn: "날짜를 확인해 주세요. 반복하려면 날짜가 있어야 합니다.",
    repeat: "반복을 다시 골라 주세요.",
    dealId: "고른 거래를 찾지 못했습니다. 다시 찾아 주세요.",
  };
  /** @type {Record<string, string>} */
  const errors = {};
  for (const field of fields ?? []) if (texts[field]) errors[field] = texts[field];
  return errors;
}

/** 목록 요청 주소 값 @param {{ status?: string, dealId?: string | null, cursor?: string | null, until?: string | null, limit?: number }} input */
export function taskListQuery({ status = "open", dealId = null, cursor = null, until = null, limit = TASK_PAGE_SIZE } = {}) {
  const query = new URLSearchParams();
  if (status === "done") query.set("status", "done");
  if (until) query.set("until", until);
  if (dealId) query.set("dealId", dealId);
  if (cursor) query.set("cursor", cursor);
  query.set("limit", String(limit));
  return query;
}
/** 줄 수 'n개 보는 중' @param {number} count @param {{ more?: boolean, done?: boolean }} options */
export function taskCountText(count, { more = false, done = false } = {}) {
  const head = done ? "끝낸 할 일" : "열린 할 일";
  const order = done ? "끝낸 때 최근 순" : "날짜 빠른 순";
  return `${head} ${count}개${more ? " 보는 중 · 더 있음" : " 보는 중"} · ${order}`;
}
/** @param {{ title: string }} task @param {{ dueOn: string | null } | null} next */
export function doneText(task, next) {
  return `✓ '${task.title}'을(를) 끝냈습니다.${next?.dueOn ? ` 다음 할 일을 만들었습니다(${taskLongDateText(next.dueOn)}).` : ""}`;
}
/** 다시 열기: 그때 만든 다음 할 일이 남아 있을 때만 알린다(서버 응답 next) @param {{ title: string }} task @param {{ dueOn: string | null } | null} next */
export function reopenText(task, next) {
  return `✓ '${task.title}'을(를) 다시 열었습니다.${next ? ` 열린 할 일로 옮겼습니다. 다음 할 일${next.dueOn ? `(${taskLongDateText(next.dueOn)})` : ""}은 따로 남아 있습니다.` : " 열린 할 일로 옮겼습니다."}`;
}
/** 첫 화면 칸 날짜 표시 "! 4일 지남"·"오늘" @param {string | null} dueOn @param {string} today */
export function homeDateText(dueOn, today) {
  const days = lateDays(dueOn, today);
  return days > 0 ? `! ${days}일 지남` : "오늘";
}
/** 첫 화면 칸 아래 링크 @param {number} count @param {boolean} more */
export function homeLinkText(count, more) {
  if (count === 0) return "할 일 만들기";
  if (more) return `할 일 ${count}개 넘게 · 모두 보기`;
  return count > TASK_HOME_SHOWN ? `할 일 ${count}개 모두 보기` : "할 일 화면으로";
}
/** 첫 화면 칸 한 줄 상태(꺼짐·구조 옛날·실패) @param {string | null} code */
export function homeStateText(code) {
  if (code === "WORK_DISABLED") return "업무 도구가 켜지면 할 일을 볼 수 있습니다.";
  if (code === "WORK_SCHEMA_OUTDATED") return "자료 구조 갱신 전이라 할 일을 볼 수 없습니다.";
  return "할 일을 불러오지 못했습니다.";
}

/** 서버 오류 코드 → 화면 문장(할 일 전용만, 나머지는 손님 화면 문장) @param {string | null} code @param {string} fallback */
export function taskErrorText(code, fallback) {
  /** @type {Record<string, string>} */
  const texts = {
    WORK_DISABLED: "업무 자료 저장이 아직 켜지지 않았습니다.",
    WORK_SCHEMA_OUTDATED: "업무 자료 구조(6번)가 아직 적용되지 않았습니다. 배포 담당에게 '할 일 구조 적용'을 확인해 달라고 알려 주세요.",
    VERSION_CONFLICT: "다른 곳에서 먼저 고쳤거나 지워져 저장하지 않았습니다. 넣던 값은 그대로 있습니다. '새 값 보기'로 저장된 값을 본 뒤 다시 고쳐 주세요.",
    NOT_FOUND: "이 할 일을 찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다.",
  };
  return (code && texts[code]) || fallback;
}
