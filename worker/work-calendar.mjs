// 업무 도구 단계 2 PR-B2: 거래 일정 .ics 만들기(설계서 6.8절, 서버 전용).
// src/lib/work/ics.mjs의 기존 함수(글자 이스케이프·75옥텟 접기·날짜·알림 표)는 가져다 쓰기만 하고 고치지 않는다
// (단계 0 화면·T0 시험 그대로, src/lib 변경이 없어 IndexNow 알림도 없음).
import { addCalendarDays } from "../src/lib/work/legal-dates.mjs";
import { cleanMultiLine, cleanSingleLine } from "../src/lib/work/work-format.mjs";
import {
  ICS_ALARM_OPTIONS,
  ICS_CALENDAR_NAME,
  MAX_ALARMS_PER_EVENT,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsTimestamp,
} from "../src/lib/work/ics.mjs";

const CRLF = "\r\n";
const UID_DOMAIN = "leaderscityhappy.com";

// DB deal_events.alarm_offsets에 넣을 수 있는 값: 단계 0 화면과 같은 세 가지 알림 시점의 TRIGGER 값.
export const ALARM_TRIGGERS = Object.freeze(Object.values(ICS_ALARM_OPTIONS).map((option) => option.trigger));
export const DEFAULT_ALARM_TRIGGERS = Object.freeze([ICS_ALARM_OPTIONS["day-before-18"].trigger]);

export function isAllowedAlarmTriggers(triggers) {
  return Array.isArray(triggers)
    && triggers.length <= MAX_ALARMS_PER_EVENT
    && new Set(triggers).size === triggers.length
    && triggers.every((trigger) => ALARM_TRIGGERS.includes(trigger));
}

// 거래 .ics 파일 이름: 손님 이름·동·호수 없이 계약일(없으면 오늘 한국 날짜)만 쓴다.
export function dealIcsFileName(dateText) {
  return `work-deal-${formatIcsDate(dateText)}.ics`;
}

/**
 * 거래 일정 캘린더. UID는 `${uidKey}@leaderscityhappy.com`이다. uidKey는 부르는 쪽이 정한다(거래 ID-종류 또는 일정 id, work-events.mjs).
 * 같은 일정을 다시 내려받으면 같은 UID가 나와 캘린더 앱이 중복 대신 갱신할 수 있다(앱마다 다름).
 * 일정이 0개면 일정 없는 빈 캘린더를 돌려준다(RFC 5545상 정상, 화면에서 "내려받을 일정이 없습니다"를 안내).
 * @param {{ events: Array<{ uidKey: string, date: string, title: string, description?: string, alarmTriggers?: string[] }>, now: Date }} options
 */
export function buildDealIcsCalendar({ events, now }) {
  const timestamp = formatIcsTimestamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//leaderscityhappy//work-tools//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(ICS_CALENDAR_NAME)}`,
  ];
  for (const event of events) {
    const title = cleanSingleLine(event.title, 80);
    const description = cleanMultiLine(event.description, 500);
    const triggers = isAllowedAlarmTriggers(event.alarmTriggers) ? event.alarmTriggers : [];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.uidKey}@${UID_DOMAIN}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(addCalendarDays(event.date, 1))}`,
      `SUMMARY:${escapeIcsText(title)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push("TRANSP:TRANSPARENT");
    for (const trigger of triggers) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeIcsText(title)}`, `TRIGGER:${trigger}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}
