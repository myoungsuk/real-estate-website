// 업무 도구 iCalendar(RFC 5545) 문자열 생성 순수 함수(설계서 6.8절).
// 단계 0은 브라우저에서, 단계 3 구독 주소는 Worker에서 같은 함수를 쓴다.
import { addCalendarDays, assertCalendarDate } from "./legal-dates.mjs";
import { cleanMultiLine, cleanSingleLine } from "./work-format.mjs";

const CRLF = "\r\n";
const MAX_LINE_OCTETS = 75;
const UID_DOMAIN = "leaderscityhappy.com";

export const ICS_CALENDAR_NAME = "업무 일정";
export const MAX_ALARMS_PER_EVENT = 2;

// 하루 종일 일정은 그날 00:00 기준 상대 시각으로 알림을 준다.
export const ICS_ALARM_OPTIONS = Object.freeze({
  "day-before-18": Object.freeze({ label: "전날 18:00", trigger: "-PT6H" }),
  "same-day-09": Object.freeze({ label: "당일 09:00", trigger: "PT9H" }),
  "three-days-before-09": Object.freeze({ label: "3일 전 09:00", trigger: "-P2DT15H" }),
});

export class IcsInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IcsInputError";
    this.code = code;
  }
}

export function escapeIcsText(value) {
  return String(value ?? "")
    .replace(/\\/gu, "\\\\")
    .replace(/;/gu, "\\;")
    .replace(/,/gu, "\\,")
    .replace(/\r\n|\r|\n/gu, "\\n");
}

const encoder = new TextEncoder();

// 75옥텟마다 CRLF + 공백 1칸으로 접는다. 이어지는 줄의 공백도 75옥텟에 포함하고,
// UTF-8 멀티바이트 글자는 중간에서 자르지 않는다.
export function foldIcsLine(line) {
  const lines = [];
  let current = "";
  let currentOctets = 0;
  for (const character of line) {
    const octets = encoder.encode(character).length;
    if (currentOctets + octets > MAX_LINE_OCTETS) {
      lines.push(current);
      current = ` ${character}`;
      currentOctets = 1 + octets;
    } else {
      current += character;
      currentOctets += octets;
    }
  }
  lines.push(current);
  return lines.join(CRLF);
}

export function formatIcsDate(value) {
  assertCalendarDate(value);
  return value.replaceAll("-", "");
}

export function formatIcsTimestamp(now) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new IcsInputError("TIMESTAMP_INVALID", "생성 시각이 올바르지 않습니다.");
  return `${now.toISOString().slice(0, 19).replace(/[-:]/gu, "")}Z`;
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 같은 일정 종류·계약일·제목이면 같은 UID가 나와 캘린더 앱이 중복 대신 갱신할 수 있게 한다.
export async function createIcsUid({ kind, contractDate, title }) {
  const data = encoder.encode(JSON.stringify([String(kind), String(contractDate), String(title)]));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return `${toHex(digest).slice(0, 32)}@${UID_DOMAIN}`;
}

/** @param {string[]} [alarmKeys] */
export function validateAlarmKeys(alarmKeys = []) {
  if (!Array.isArray(alarmKeys)) throw new IcsInputError("ALARM_INVALID", "알림 선택값이 올바르지 않습니다.");
  const unique = [...new Set(alarmKeys)];
  if (unique.length > MAX_ALARMS_PER_EVENT) {
    throw new IcsInputError("ALARM_LIMIT", `알림은 일정마다 최대 ${MAX_ALARMS_PER_EVENT}개까지 고를 수 있습니다.`);
  }
  for (const key of unique) {
    if (!Object.hasOwn(ICS_ALARM_OPTIONS, key)) throw new IcsInputError("ALARM_INVALID", "알 수 없는 알림 시점입니다.");
  }
  return unique;
}

export function icsFileName(contractDate) {
  return `work-schedule-${formatIcsDate(contractDate)}.ics`;
}

/**
 * @param {{
 *   events: Array<{ kind: string, date: string, title: string, description?: string }>,
 *   contractDate: string,
 *   alarmKeys?: string[],
 *   now?: Date,
 * }} options
 */
export async function buildIcsCalendar({ events, contractDate, alarmKeys = [], now = new Date() }) {
  assertCalendarDate(contractDate, "계약일");
  if (!Array.isArray(events) || events.length === 0) throw new IcsInputError("EVENTS_EMPTY", "캘린더에 넣을 일정을 하나 이상 골라 주세요.");
  const alarms = validateAlarmKeys(alarmKeys);
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
    assertCalendarDate(event.date, "일정 날짜");
    const title = cleanSingleLine(event.title, 80);
    if (!title) throw new IcsInputError("TITLE_EMPTY", "일정 제목을 입력해 주세요.");
    const description = cleanMultiLine(event.description, 500);
    const uid = await createIcsUid({ kind: event.kind, contractDate, title });
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
      `DTEND;VALUE=DATE:${formatIcsDate(addCalendarDays(event.date, 1))}`,
      `SUMMARY:${escapeIcsText(title)}`,
    );
    if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`);
    lines.push("TRANSP:TRANSPARENT");
    for (const key of alarms) {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcsText(title)}`,
        `TRIGGER:${ICS_ALARM_OPTIONS[key].trigger}`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join(CRLF)}${CRLF}`;
}
