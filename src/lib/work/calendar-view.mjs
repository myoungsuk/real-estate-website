// 달력 화면(/admin/work/calendar/)이 쓰는 순수 함수. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 사용자 승인 2026-11-25(대장 질문 도구 답 23:32·11-26 08:59): C 새 '달력' 화면 + 일정 넣기 칸 판 2.
// - 한 달 칸에는 거래 일정(deal_events)·날짜 있는 할 일(tasks)·거래 없는 일정(appointments, 반복은 펼친 날짜)을 함께 놓는다.
// - 묶음 5가지는 색 + 모양 + 글자로 가른다(색만으로 가르지 않음): ◆ 돈 날짜 · ▲ 기한 · ● 안내·상담 · ■ 일상 · ☐ 할 일. ↻는 반복.
// - 날짜는 한국 날짜 YYYY-MM-DD, 시각은 HH:MM 글자다. 일정 제목은 화면에만 보이고 주소·브라우저 저장소·문서 제목에 넣지 않는다.
import { APPOINTMENT_REPEAT_RULES, appointmentOccurrences, isAppointmentDate, seriesEndBefore } from "./appointment-repeat.mjs";
import {
  APPOINTMENT_ALARMS,
  APPOINTMENT_DATE_EXPIRED_MESSAGE,
  APPOINTMENT_MAX_ALARMS,
  APPOINTMENT_TAGS,
  APPOINTMENT_TAG_KEYS,
  appointmentAlarmChoices,
  appointmentAlarmsValid,
  appointmentDateExpired,
  isClockTime,
} from "./appointment-rules.mjs";
import { TASK_NAME_HELP } from "./tasks-view.mjs";

export const APPOINTMENT_TITLE_MAX = 80; // 할 일 제목과 같음
// 제목 칸 안내(사용자 답 11-26 08:59 "일정·할 일 둘 다 새 문구"). 할 일 화면과 같은 글을 쓴다.
export const APPOINTMENT_TITLE_HELP = TASK_NAME_HELP;
// 보유 안내(사용자 답 2026-11-26 09:30:29 "이 문구로 두 곳에 넣음": 일정 넣기 창 저장 줄 위 + 사용법 상자. 글자를 바꾸지 않는다).
export const APPOINTMENT_KEEP_NOTICE = "지난 지 1년이 된 일정은 자동으로 지워집니다. 반복 일정은 끝나는 날로부터 1년 뒤에 지워지고, 끝나는 날이 없으면 직접 지울 때까지 남습니다.";
export const CALENDAR_CHIPS_SHOWN = 3; // 넓은 칸 글자 띠 수(넘치면 'n개 더')
export const CALENDAR_MARKS_SHOWN = 3; // 좁은 칸 모양 표시 수(넘치면 2개 + '+')

export const CALENDAR_FAMILIES = Object.freeze({
  money: Object.freeze({ name: "돈 날짜", glyph: "◆" }),
  due: Object.freeze({ name: "기한", glyph: "▲" }),
  meet: Object.freeze({ name: "안내·상담", glyph: "●" }),
  life: Object.freeze({ name: "일상", glyph: "■" }),
  task: Object.freeze({ name: "할 일", glyph: "☐" }),
});
export const CALENDAR_FAMILY_KEYS = Object.freeze(Object.keys(CALENDAR_FAMILIES));
const FAMILY_ORDER = Object.fromEntries(CALENDAR_FAMILY_KEYS.map((key, index) => [key, index]));

// 거래 없는 일정의 꼬리표 키·이름은 공용 규칙(appointment-rules.mjs, 서버와 같은 목록)이고, 여기서는 달력 묶음만 정한다.
// 비과세·임대차 종료는 계산 없이 날짜만 넣는 기한(사용자 답 11-26 08:59:51).
export const APPOINTMENT_TAG_FAMILIES = Object.freeze({
  showing: "meet",
  consult: "meet",
  routine: "life",
  tax: "due",
  lease_end: "due",
  other: "life",
});
export { APPOINTMENT_ALARMS, APPOINTMENT_MAX_ALARMS, APPOINTMENT_TAGS, APPOINTMENT_TAG_KEYS, isClockTime };
/** 꼬리표 이름과 묶음(모르는 키는 기타). @param {string} tag */
export const appointmentTag = (tag) => (APPOINTMENT_TAG_KEYS.includes(tag) ? { label: APPOINTMENT_TAGS[tag], family: APPOINTMENT_TAG_FAMILIES[tag] } : { label: APPOINTMENT_TAGS.other, family: APPOINTMENT_TAG_FAMILIES.other });

// 거래 일정 종류 → 묶음과 칸 글자(짧게). 'custom'(직접 넣은 일정, 둘째 이후 중도금 등)은 기한으로 본다.
export const DEAL_EVENT_FAMILIES = Object.freeze({
  contract: Object.freeze({ family: "money", label: "계약일" }),
  middle_payment: Object.freeze({ family: "money", label: "중도금" }),
  balance: Object.freeze({ family: "money", label: "잔금" }),
  transaction_report: Object.freeze({ family: "due", label: "거래신고" }),
  funding_plan_to_agent: Object.freeze({ family: "due", label: "자금조달계획서" }),
  funding_plan_submit: Object.freeze({ family: "due", label: "자금조달계획서" }),
  lease_report: Object.freeze({ family: "due", label: "임대차 신고" }),
  custom: Object.freeze({ family: "due", label: "거래 일정" }),
});

export const APPOINTMENT_REPEAT_LABELS = Object.freeze({
  none: "안 함",
  daily: "매일",
  weekdays: "평일(월 ~ 금)",
  weekly: "매주",
  monthly: "매달",
  yearly: "매년",
});

// 휴대폰 캘린더 알림(사용자 답 11-25 23:32:21 "지금 3가지 + '1시간 전'"). 거래 일정과 같은 규칙으로 일정마다 0 ~ 2개를 체크칸으로 고른다
// (날개-2 API 판 2). 선택지·판정은 공용 규칙(appointment-rules.mjs)의 것을 그대로 쓴다.
/**
 * 처음 체크해 둘 알림(사용자 답 2026-11-26 09:18:41 "종일 '전날 18:00', 시각 있음 '1시간 전'"). 하루 종일은 서버 기본값과 같다.
 * @param {boolean} allDay
 */
export const defaultAlarms = (allDay) => (allDay ? ["day-before-18"] : ["hour-before"]);
/** 고를 수 있는 알림 키(하루 종일이면 '1시간 전' 없음, 09:00 전 시작이면 '당일 09:00' 없음). @param {string | null} startTime null이면 하루 종일 */
export const alarmChoices = (startTime) => appointmentAlarmChoices(startTime);
/** 시각을 바꾼 뒤에도 고를 수 있는 것만 남긴다(체크칸 순서대로, 2개까지). @param {string[]} alarms @param {string | null} startTime */
export function keepAllowedAlarms(alarms, startTime) {
  const allowed = new Set(alarmChoices(startTime));
  return [...new Set(alarms)].filter((alarm) => allowed.has(alarm)).slice(0, APPOINTMENT_MAX_ALARMS);
}
/** 알림 한 줄 요약 "전날 18:00 · 1시간 전" · "알림 없음" @param {string[]} alarms */
export const alarmSummaryText = (alarms) => (alarms.length ? alarms.map((alarm) => APPOINTMENT_ALARMS[alarm]?.label ?? "").filter(Boolean).join(" · ") : "알림 없음");

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} value */
function dateTime(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
const isoOf = (/** @type {number} */ time) => new Date(time).toISOString().slice(0, 10);
/** @param {string} value YYYY-MM */
export const isCalendarMonth = (value) => typeof value === "string" && MONTH_PATTERN.test(value);
/** @param {string} on YYYY-MM-DD */
export const monthOf = (on) => on.slice(0, 7);

/** 다른 달 "YYYY-MM"(step: -1 앞 달, +1 다음 달). @param {string} month @param {number} step */
export function shiftMonth(month, step) {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return null;
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 + step;
  const year = Math.floor(index / 12);
  if (year < 1000 || year > 9999) return null;
  return `${year}-${String(index - year * 12 + 1).padStart(2, "0")}`;
}

/** "2026년 11월" 머리 @param {string} month */
export function monthTitle(month) {
  const match = MONTH_PATTERN.exec(month);
  return match ? { year: `${Number(match[1])}년`, month: `${Number(match[2])}월` } : { year: "", month: "" };
}
/** 앞·뒤 달 단추 이름 "10월" @param {string} month */
export const monthShortName = (month) => (MONTH_PATTERN.test(month) ? `${Number(month.slice(5, 7))}월` : "");

/**
 * 달력 칸(일요일 시작, 그 달이 걸친 주만 5 ~ 6줄). 칸마다 날짜·그 달 여부·오늘·요일.
 * @param {string} month YYYY-MM
 * @param {string} today YYYY-MM-DD
 */
export function monthGrid(month, today) {
  const match = MONTH_PATTERN.exec(month);
  if (!match) return { fromOn: "", toOn: "", days: [] };
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  const first = Date.UTC(year, index, 1);
  const last = Date.UTC(year, index + 1, 0);
  const start = first - new Date(first).getUTCDay() * DAY_MS;
  const end = last + (6 - new Date(last).getUTCDay()) * DAY_MS;
  const days = [];
  for (let time = start; time <= end; time += DAY_MS) {
    const on = isoOf(time);
    days.push({ on, day: new Date(time).getUTCDate(), inMonth: time >= first && time <= last, isToday: on === today, weekday: new Date(time).getUTCDay() });
  }
  return { fromOn: isoOf(start), toOn: isoOf(end), days };
}

/** "11월 20일 금요일" @param {string} on */
export function dayTitle(on) {
  const time = dateTime(on);
  if (time === null) return "";
  return `${Number(on.slice(5, 7))}월 ${Number(on.slice(8, 10))}일 ${WEEKDAYS[new Date(time).getUTCDay()]}요일`;
}
/** "11월 20일" @param {string} on */
export const dayShortTitle = (on) => (dateTime(on) === null ? "" : `${Number(on.slice(5, 7))}월 ${Number(on.slice(8, 10))}일`);
/** 날짜 칸 옆 "2026. 11. 25.(수)" @param {string} on */
export function dateLongText(on) {
  const time = dateTime(on);
  if (time === null) return "";
  return `${on.slice(0, 4)}. ${Number(on.slice(5, 7))}. ${Number(on.slice(8, 10))}.(${WEEKDAYS[new Date(time).getUTCDay()]})`;
}

/**
 * @typedef {{
 *   key: string, source: "deal" | "task" | "appointment", id: string, on: string,
 *   startTime: string | null, endTime: string | null, family: string, label: string, title: string,
 *   done: boolean, late: boolean, past: boolean, repeatRule: string,
 *   deal: { id: string, title: string } | null, customer: { id: string, displayName: string } | null,
 *   appointment: Record<string, any> | null,
 * }} CalendarItem
 */

const TASK_REPEAT_RULES = Object.freeze({ weekly: "weekly", monthly: "monthly" });

/**
 * 업무 API `calendar` 응답 항목 → 화면 항목. 서버는 late·past를 주지 않으므로 today로 계산한다(날개-2 API 판 1 3절).
 * 거래 일정 칸 글자는 '종류 + 거래 이름'(직접 넣은 거래 일정은 '거래 일정 + 그 제목'), 할 일·거래 없는 일정은 제목이다.
 * (그날 목록 줄은 이 둘을 쓰고, 넓은 칸 글자 띠는 `chipText`의 한 조각만 쓴다.)
 * 모르는 source·날짜 꼴이 틀린 항목은 버린다(화면이 깨지지 않게).
 * @param {any[]} apiItems @param {string} today YYYY-MM-DD
 * @returns {CalendarItem[]}
 */
export function toCalendarItems(apiItems, today) {
  /** @type {CalendarItem[]} */
  const items = [];
  for (const raw of Array.isArray(apiItems) ? apiItems : []) {
    if (!raw || typeof raw !== "object" || dateTime(raw.on) === null || typeof raw.key !== "string") continue;
    const deal = raw.deal && typeof raw.deal.id === "string" ? { id: raw.deal.id, title: String(raw.deal.title ?? "") } : null;
    const customer = raw.customer && typeof raw.customer.id === "string" ? { id: raw.customer.id, displayName: String(raw.customer.displayName ?? "") } : null;
    const done = raw.done === true;
    const past = raw.on < today;
    const base = { key: raw.key, id: String(raw.id ?? ""), on: raw.on, done, past, deal, customer, appointment: null };
    if (raw.source === "deal") {
      const kind = DEAL_EVENT_FAMILIES[raw.kind] ?? DEAL_EVENT_FAMILIES.custom;
      const custom = raw.kind === "custom" || !DEAL_EVENT_FAMILIES[raw.kind];
      items.push({
        ...base, source: "deal", startTime: null, endTime: null, family: kind.family, label: kind.label,
        title: custom ? String(raw.title ?? "") : deal?.title || String(raw.title ?? ""),
        late: !done && past, repeatRule: "none",
      });
    } else if (raw.source === "task") {
      items.push({
        ...base, source: "task", startTime: null, endTime: null, family: "task", label: CALENDAR_FAMILIES.task.name,
        title: String(raw.title ?? ""), late: !done && past, repeatRule: TASK_REPEAT_RULES[raw.repeat] ?? "none",
      });
    } else if (raw.source === "appointment") {
      const appointment = raw.appointment ?? {};
      const tag = appointmentTag(appointment.tag);
      items.push({
        ...base, source: "appointment", deal: null, customer: null, appointment: { ...appointment },
        startTime: isClockTime(raw.startTime) ? raw.startTime : null, endTime: isClockTime(raw.endTime) ? raw.endTime : null,
        family: tag.family, label: tag.label, title: String(raw.title ?? ""),
        // 거래 없는 일정은 끝내기가 없다(서버 done 늘 false). 지난 것은 흐리게만 하고 '지남' 표시는 하지 않는다.
        done: false, late: false, repeatRule: APPOINTMENT_REPEAT_RULES.includes(appointment.repeatRule) ? appointment.repeatRule : "none",
      });
    }
  }
  return items;
}

/** 시각 줄 "하루 종일" · "16:00" · "16:00 ~ 17:00"(할 일은 빈 글자) @param {CalendarItem} item */
export function itemTimeText(item) {
  if (item.source === "task") return "";
  if (!item.startTime) return "하루 종일";
  return item.endTime ? `${item.startTime} ~ ${item.endTime}` : item.startTime;
}

/** 그날 차례: 하루 종일 먼저(묶음 차례), 그다음 시작 시각, 같으면 묶음·제목. @param {CalendarItem[]} items */
export function sortDayItems(items) {
  return [...items].sort((a, b) => {
    const at = a.startTime ?? "";
    const bt = b.startTime ?? "";
    if (at !== bt) return at.localeCompare(bt);
    const af = FAMILY_ORDER[a.family] ?? 9;
    const bf = FAMILY_ORDER[b.family] ?? 9;
    if (af !== bf) return af - bf;
    return a.title.localeCompare(b.title, "ko");
  });
}

/** 날짜별로 묶고 그날 차례로 늘어놓은 Map. @param {CalendarItem[]} items */
export function itemsByDay(items) {
  /** @type {Map<string, CalendarItem[]>} */
  const map = new Map();
  for (const item of items) {
    const list = map.get(item.on);
    if (list) list.push(item);
    else map.set(item.on, [item]);
  }
  for (const [on, list] of map) map.set(on, sortDayItems(list));
  return map;
}

/** 고른 묶음만(비었으면 전체). @param {CalendarItem[]} items @param {Iterable<string>} families */
export function filterItems(items, families) {
  const chosen = new Set(families);
  return chosen.size === 0 ? items : items.filter((item) => chosen.has(item.family));
}

/** 넓은 칸의 글자 띠: 3개까지, 넘치면 남은 수. @param {CalendarItem[]} dayItems */
export function chipsFor(dayItems, shown = CALENDAR_CHIPS_SHOWN) {
  return dayItems.length > shown ? { items: dayItems.slice(0, shown), more: dayItems.length - shown } : { items: dayItems, more: 0 };
}
/**
 * 넓은 칸 글자 띠에 보일 한 조각(사용자 답 2026-11-26 11:22:26 "뜻 있는 한 조각"). 종류가 정해진 거래 일정(계약일·중도금·잔금·
 * 거래신고·자금조달계획서·임대차 신고)은 그 이름, 할 일·거래 없는 일정·이름 붙인 거래 일정('거래 일정')은 적어 둔 제목이고,
 * 제목이 비면 이름이다. 손님·거래 이름은 칸에 넣지 않고 그날 목록에서 본다.
 * @param {CalendarItem} item
 */
export function chipText(item) {
  const fixedDealKind = item.source === "deal" && item.label !== DEAL_EVENT_FAMILIES.custom.label;
  if (fixedDealKind) return item.label;
  return item.title.trim() || item.label;
}
/** 좁은 칸의 모양 표시: 3개까지, 4개 이상이면 2개 + '+'. @param {CalendarItem[]} dayItems */
export function marksFor(dayItems, shown = CALENDAR_MARKS_SHOWN) {
  return dayItems.length > shown ? { items: dayItems.slice(0, shown - 1), plus: true } : { items: dayItems, plus: false };
}
/** 모양 기호(끝낸 할 일은 ☑). @param {CalendarItem} item */
export const itemGlyph = (item) => (item.family === "task" && item.done ? "☑" : CALENDAR_FAMILIES[item.family]?.glyph ?? "■");

/** 칸 단추가 읽어 줄 이름 "11월 20일 금요일, 오늘, 일정 4개" @param {string} on @param {CalendarItem[]} dayItems @param {string} today */
export function cellLabel(on, dayItems, today) {
  const parts = [dayTitle(on)];
  if (on === today) parts.push("오늘");
  parts.push(dayItems.length ? `일정 ${dayItems.length}개` : "일정 없음");
  const late = dayItems.filter((item) => item.late).length;
  if (late) parts.push(`지난 일정 ${late}개`);
  return parts.join(", ");
}

/** 그날 목록 줄 아래 글(손님·거래·반복·출처). @param {CalendarItem} item */
export function itemMetaText(item) {
  const parts = [];
  if (item.customer) parts.push(`손님 ${item.customer.displayName}`);
  if (item.deal && item.deal.title !== item.title) parts.push(item.deal.title);
  if (item.repeatRule && item.repeatRule !== "none") parts.push(`↻ ${repeatShortText(item.repeatRule, item.appointment?.startsOn ?? item.on)}`); // 매달 31일이 30일에 놓여도 '매달 31일'
  parts.push(item.source === "appointment" ? "직접 넣은 일정" : item.source === "task" ? "할 일" : "거래 일정");
  return parts.join(" · ");
}
/** 줄 오른쪽 상태 글: '✓ 끝남' · '! 지남' · '' @param {CalendarItem} item */
export const itemStateText = (item) => (item.done ? "✓ 끝남" : item.late ? "! 지남" : "");

/** "매달 25일" · "매주 수요일" · "매년 11월 25일" · "매일" · "평일(월 ~ 금)" @param {string} rule @param {string} startsOn */
export function repeatShortText(rule, startsOn) {
  const time = dateTime(startsOn);
  if (rule === "daily") return "매일";
  if (rule === "weekdays") return "평일(월 ~ 금)";
  if (time === null) return APPOINTMENT_REPEAT_LABELS[rule] ?? "";
  const day = Number(startsOn.slice(8, 10));
  if (rule === "weekly") return `매주 ${WEEKDAYS[new Date(time).getUTCDay()]}요일`;
  if (rule === "monthly") return `매달 ${day}일`;
  if (rule === "yearly") return `매년 ${Number(startsOn.slice(5, 7))}월 ${day}일`;
  return "";
}
/** 반복 칸 아래 요약 한 줄(반복 없음이면 빈 글자). @param {string} rule @param {string} startsOn */
export function repeatSummaryText(rule, startsOn) {
  if (!rule || rule === "none" || dateTime(startsOn) === null) return "";
  const base = `↻ ${repeatShortText(rule, startsOn)}`;
  const day = Number(startsOn.slice(8, 10));
  if (rule === "monthly" && day >= 29) return `${base} · ${day}일이 없는 달은 그 달 마지막 날에 둡니다.`;
  if (rule === "yearly" && startsOn.slice(5) === "02-29") return `${base} · 평년에는 2월 28일에 둡니다.`;
  if (rule === "weekdays") {
    const weekday = new Date(dateTime(startsOn) ?? 0).getUTCDay();
    if (weekday === 0 || weekday === 6) return `${base} · 고른 날이 주말이라 다음 월요일부터 들어갑니다.`;
  }
  return base;
}

/**
 * 일정 넣기 칸 검사. 고친 값(value) 또는 칸별 오류(errors).
 * @param {{ tag: string, title: string, startsOn: string, allDay: boolean, startTime: string, endTime: string, repeatRule: string, untilMode: "none" | "date", repeatUntil: string, alarms: string[] }} input
 */
export function checkAppointmentInput(input) {
  /** @type {Record<string, string>} */
  const errors = {};
  const title = String(input.title ?? "").replace(/\s+/gu, " ").trim();
  if (!APPOINTMENT_TAG_KEYS.includes(input.tag)) errors.tag = "종류를 골라 주세요.";
  if (!title) errors.title = "제목을 적어 주세요.";
  else if ([...title].length > APPOINTMENT_TITLE_MAX) errors.title = `제목은 ${APPOINTMENT_TITLE_MAX}자까지입니다.`;
  if (!isAppointmentDate(input.startsOn)) errors.startsOn = "날짜를 골라 주세요.";
  const allDay = Boolean(input.allDay);
  let startTime = null;
  let endTime = null;
  if (!allDay) {
    if (!isClockTime(input.startTime)) errors.startTime = "시작 시각을 넣거나 '하루 종일'을 켜 주세요.";
    else startTime = input.startTime;
    if (input.endTime) {
      if (!isClockTime(input.endTime)) errors.endTime = "끝 시각이 올바르지 않습니다.";
      else if (startTime && input.endTime <= startTime) errors.endTime = "끝 시각은 시작 시각보다 늦어야 합니다.";
      else endTime = input.endTime;
    }
  }
  const repeatRule = APPOINTMENT_REPEAT_RULES.includes(input.repeatRule) ? input.repeatRule : null;
  if (!repeatRule) errors.repeatRule = "반복을 골라 주세요.";
  let repeatUntil = null;
  if (repeatRule && repeatRule !== "none" && input.untilMode === "date") {
    if (!isAppointmentDate(input.repeatUntil)) errors.repeatUntil = "끝나는 날을 골라 주세요.";
    else if (isAppointmentDate(input.startsOn) && input.repeatUntil < input.startsOn) errors.repeatUntil = "끝나는 날은 시작 날짜와 같거나 뒤여야 합니다.";
    else repeatUntil = input.repeatUntil;
  }
  const alarms = Array.isArray(input.alarms) ? input.alarms : [];
  if (alarms.length > APPOINTMENT_MAX_ALARMS) errors.alarms = `알림은 일정마다 ${APPOINTMENT_MAX_ALARMS}개까지입니다.`;
  else if (!errors.startTime && !appointmentAlarmsValid(alarms, startTime)) {
    errors.alarms = allDay && alarms.includes("hour-before") ? "'1시간 전'은 시각 있는 일정에만 고를 수 있습니다." : "시작 시각보다 늦게 울리는 알림은 고를 수 없습니다.";
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: { tag: input.tag, title, startsOn: input.startsOn, startTime, endTime, repeatRule, repeatUntil, alarms: [...alarms] },
  };
}

/** 반복 줄인지('이 날만 고친' 줄은 반복 없는 줄로 다룬다, API 판 2 6절). @param {Record<string, any> | null} appointment */
export const isRepeatingAppointment = (appointment) => Boolean(appointment && appointment.repeatRule && appointment.repeatRule !== "none");

/**
 * 고치기 칸을 열 때의 값. 반복 줄의 한 날을 열면 날짜 칸은 그날이다.
 * @param {Record<string, any>} appointment @param {string} [occurrenceOn]
 */
export function appointmentFormValue(appointment, occurrenceOn) {
  const repeating = isRepeatingAppointment(appointment);
  return {
    tag: appointment.tag,
    title: String(appointment.title ?? ""),
    startsOn: repeating && occurrenceOn ? occurrenceOn : appointment.startsOn,
    allDay: !appointment.startTime,
    startTime: appointment.startTime ?? "",
    endTime: appointment.endTime ?? "",
    repeatRule: appointment.repeatRule ?? "none",
    untilMode: appointment.repeatUntil ? "date" : "none",
    repeatUntil: appointment.repeatUntil ?? "",
    alarms: Array.isArray(appointment.alarms) ? [...appointment.alarms] : [],
  };
}

const PATCH_FIELDS = ["tag", "title", "startsOn", "startTime", "endTime", "repeatRule", "repeatUntil", "alarms"];
const sameValue = (a, b) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : (a ?? null) === (b ?? null));

/**
 * 고치기 PATCH 본문(바뀐 칸만). 반복 줄은 scope·occurrenceOn을 싣고, '이 날만'(one)은 반복·끝나는 날 칸을 보내지 않는다(서버 400).
 * 날짜 칸은 반복 줄의 한 날이면 그날과, 아니면 원래 시작 날짜와 견준다. 바뀐 칸이 없으면 null.
 * @param {Record<string, any>} original 서버가 준 줄
 * @param {Record<string, any>} value checkAppointmentInput의 value
 * @param {{ scope?: "one" | "following", occurrenceOn?: string }} [where]
 */
export function appointmentPatchBody(original, value, where = {}) {
  const repeating = isRepeatingAppointment(original);
  const scope = repeating ? where.scope : undefined;
  if (repeating && scope !== "one" && scope !== "following") return null;
  if (repeating && !isAppointmentDate(where.occurrenceOn)) return null;
  const base = { ...original, startsOn: repeating ? where.occurrenceOn : original.startsOn };
  /** @type {Record<string, any>} */
  const body = { version: original.version };
  if (repeating) Object.assign(body, { scope, occurrenceOn: where.occurrenceOn });
  let changed = 0;
  for (const field of PATCH_FIELDS) {
    if (scope === "one" && (field === "repeatRule" || field === "repeatUntil")) continue;
    if (sameValue(value[field], base[field])) continue;
    body[field] = Array.isArray(value[field]) ? [...value[field]] : value[field];
    changed += 1;
  }
  // 시작 시각을 지우면(하루 종일) 끝 시각도 함께 null로 보낸다(서버는 startTime만 null이면 400 ["startTime"], 날개-2 11-26 09:33).
  if (body.startTime === null && !("endTime" in body)) body.endTime = null;
  return changed ? body : null;
}

// ── 1년 넘게 지난 날짜 막기(2026-11-26 사용자 답 "막고 까닭을 알림"·"딱 1년 전도 막음") ──
// 서버(worker/work-appointments.mjs 만들기·고치기)가 보는 '새로 저장될 줄'을 화면에서 같은 순서로 만들어 같은 함수(appointmentDateExpired)로 본다.
// 서버가 마지막 판정이다(휴대폰 시계가 하루 어긋날 수 있음). 서버 400 APPOINTMENT_DATE_EXPIRED도 같은 글로 받는다.
const PATCH_META = ["version", "scope", "occurrenceOn"];
const withoutRepeat = (state) => (state.repeatRule === "none" ? { ...state, repeatUntil: null } : state);

// 서버 trimmedBefore와 같음: 그날 전날로 줄였을 때 보이는 날이 남으면 '나누기', 아니면(처음 보이는 날) null = 원래 줄 그 자리 고치기.
function splitsSeries(original, occurrenceOn) {
  const until = seriesEndBefore(original.startsOn, occurrenceOn);
  if (until === null) return false;
  const skipDates = (original.skipDates ?? []).filter((date) => date < occurrenceOn);
  return appointmentOccurrences({ startsOn: original.startsOn, repeatRule: original.repeatRule, repeatUntil: until, skipDates }, original.startsOn, until, { limit: 1 }).length > 0;
}

/**
 * 저장하면 다음 03:00 정리에 지워질 줄이면 막을 칸 이름 배열(["startsOn"] 또는 ["repeatUntil"]), 아니면 null.
 * - 새 일정: 넣을 값 그대로. - '이 날만': 새로 생기는 반복 없는 줄(날짜 = 보낸 날짜 또는 그날).
 * - '이 날부터 모두'로 나눌 때: 새로 생기는 반복 줄(줄어드는 원래 줄은 보지 않음).
 * - 그 자리 고치기: 날짜·반복·끝나는 날이 바뀔 때만. 지우기는 막지 않는다(이 함수를 부르지 않음).
 * @param {Record<string, any> | null} original 고칠 때 서버가 준 줄(새 일정이면 null)
 * @param {Record<string, any>} body 새 일정이면 checkAppointmentInput의 value, 고치기면 appointmentPatchBody 결과
 * @param {string} cutoff appointment-rules.mjs appointmentCutoffDate 값
 */
export function appointmentSaveExpired(original, body, cutoff) {
  if (!original) return appointmentDateExpired(withoutRepeat(body), cutoff);
  /** @type {Record<string, any>} */
  const changes = {};
  for (const [key, value] of Object.entries(body)) if (!PATCH_META.includes(key)) changes[key] = value;
  const merged = { ...original, ...changes };
  if (body.scope === "one") {
    return appointmentDateExpired({ ...merged, startsOn: changes.startsOn ?? body.occurrenceOn, repeatRule: "none", repeatUntil: null }, cutoff);
  }
  if (body.scope === "following" && splitsSeries(original, body.occurrenceOn)) {
    return appointmentDateExpired(withoutRepeat({ ...merged, startsOn: changes.startsOn ?? body.occurrenceOn }), cutoff);
  }
  const state = withoutRepeat(merged);
  const dateChanged = state.startsOn !== original.startsOn || state.repeatRule !== original.repeatRule || (state.repeatUntil ?? null) !== (original.repeatUntil ?? null);
  return dateChanged ? appointmentDateExpired(state, cutoff) : null;
}

/** 막힌 칸(서버 400 details 또는 appointmentSaveExpired) → 칸 아래 글. @param {string[] | null | undefined} fields */
export function appointmentExpiredErrors(fields) {
  /** @type {Record<string, string>} */
  const errors = {};
  for (const field of fields ?? []) if (field === "startsOn" || field === "repeatUntil") errors[field] = APPOINTMENT_DATE_EXPIRED_MESSAGE;
  return errors;
}

/**
 * 지우기 DELETE 본문. 반복 없는 줄은 본문 없음(null, 할 일과 같음), 반복 줄은 version·scope·occurrenceOn.
 * @param {Record<string, any>} original @param {{ scope?: "one" | "following", occurrenceOn?: string }} [where]
 */
export function appointmentDeleteBody(original, where = {}) {
  if (!isRepeatingAppointment(original)) return null;
  if ((where.scope !== "one" && where.scope !== "following") || !isAppointmentDate(where.occurrenceOn)) throw new Error("반복 일정은 '이 날만' 또는 '이 날부터 모두'를 골라야 합니다.");
  return { version: original.version, scope: where.scope, occurrenceOn: where.occurrenceOn };
}

/** 반복 고치기·지우기 물음의 고르기 두 줄. @param {string} occurrenceOn @param {"edit" | "delete"} action */
export function repeatScopeChoices(occurrenceOn, action) {
  const day = dayShortTitle(occurrenceOn);
  const verb = action === "delete" ? "지웁니다" : "고칩니다";
  return [
    { scope: "one", label: "이 날만", help: `${day} 하루만 ${verb}. 다른 날은 그대로입니다.` },
    { scope: "following", label: "이 날부터 모두", help: `${day}과 그 뒤 반복을 모두 ${verb}. 지난 날은 그대로입니다.` },
  ];
}

/** 서버 '일부만 보입니다' 한 줄(truncated). @param {boolean} truncated */
export const truncatedText = (truncated) => (truncated ? "일정이 너무 많아 이 달은 일부만 보입니다. 거르기로 좁혀 보세요." : "");

/** 서버 400 details(칸 이름) → 칸 아래 글. @param {string[] | undefined} fields */
export function appointmentFieldErrors(fields) {
  /** @type {Record<string, string>} */
  const texts = {
    tag: "종류를 다시 골라 주세요.",
    title: `제목은 1 ~ ${APPOINTMENT_TITLE_MAX}자로 넣어 주세요.`,
    startsOn: "날짜를 확인해 주세요.",
    startTime: "시작 시각을 확인해 주세요.",
    endTime: "끝 시각은 시작 시각보다 늦어야 합니다.",
    repeatRule: "반복을 다시 골라 주세요.",
    repeatUntil: "끝나는 날은 시작 날짜와 같거나 뒤여야 합니다.",
    alarms: `알림은 일정마다 ${APPOINTMENT_MAX_ALARMS}개까지, 시작 시각보다 늦지 않게 골라 주세요.`,
    occurrenceOn: "고친 날이 이 반복에 없습니다. 달력을 새로 불러온 뒤 다시 해 주세요.",
    scope: "고칠 범위를 다시 골라 주세요.",
  };
  /** @type {Record<string, string>} */
  const errors = {};
  for (const field of fields ?? []) if (texts[field]) errors[field] = texts[field];
  return errors;
}

export const CALENDAR_SCHEMA_VERSION = 9;
/** 달력 전용 오류 글(나머지는 손님 화면 문장 fallback) @param {string | null} code @param {string} fallback */
export function calendarErrorText(code, fallback) {
  /** @type {Record<string, string>} */
  const texts = {
    WORK_DISABLED: "업무 자료 저장이 아직 켜지지 않았습니다.",
    WORK_SCHEMA_OUTDATED: `업무 자료 구조(${CALENDAR_SCHEMA_VERSION}번)가 아직 적용되지 않았습니다. 배포 담당에게 '달력 일정 구조 적용'을 확인해 달라고 알려 주세요.`,
    VERSION_CONFLICT: "다른 곳에서 먼저 고쳤거나 지워져 저장하지 않았습니다. 넣던 값은 그대로 있습니다. '새 값 보기'로 저장된 값을 본 뒤 다시 고쳐 주세요.",
    NOT_FOUND: "이 일정을 찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다.",
    SKIP_LIMIT_REACHED: "이 반복에서 '이 날만'으로 뺀 날이 너무 많습니다. '이 날부터 모두'로 나눠 주세요.",
    APPOINTMENT_DATE_EXPIRED: APPOINTMENT_DATE_EXPIRED_MESSAGE,
  };
  return (code && texts[code]) || fallback;
}

/** 그날 목록 줄을 눌렀을 때 갈 곳(거래 일정은 손님 카드, 없으면 손님 목록 / 할 일은 할 일 화면). 거래 없는 일정은 null(고치기 칸). @param {CalendarItem} item */
export function itemHref(item) {
  if (item.source === "deal") return item.customer ? `/admin/work/customers/detail/?id=${encodeURIComponent(item.customer.id)}` : "/admin/work/customers/";
  if (item.source === "task") return "/admin/work/tasks/";
  return null;
}

/** 머리 줄 '이 달 n개 · 지난 일정 n건'(거르기 뒤 개수) @param {CalendarItem[]} items @param {string} month */
export function monthCountText(items, month) {
  const inMonth = items.filter((item) => monthOf(item.on) === month);
  const late = inMonth.filter((item) => item.late).length;
  return `이 달 ${inMonth.length}개${late ? ` · 지난 일정 ${late}건` : ""}`;
}
