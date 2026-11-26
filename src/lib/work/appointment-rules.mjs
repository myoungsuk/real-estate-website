// 거래 없는 일정(appointments)의 꼬리표·알림 규칙 순수 함수. 서버(입력 검사·구독 .ics)와 화면(달력·일정 넣기)이 같은 목록·같은 판정을 쓴다.
// - 꼬리표(2026-11-25 사용자 답 "다섯 + 기타, 코드가 검사"): DB CHECK 없이 이 목록으로만 검사한다. 비과세·임대차 종료는 계산 없이 날짜만 넣는다.
// - 알림(2026-11-25 23:32:21 사용자 답 "지금 3가지 + '1시간 전'"): 지금 거래 일정과 같은 세 선택지(ics.mjs ICS_ALARM_OPTIONS)에
//   시각 있는 일정에만 '1시간 전'을 더한다. 일정마다 최대 2개(거래 일정과 같음, MAX_ALARMS_PER_EVENT).
// - 시각은 한국 시각 HH:MM 글자다. 시각이 없으면(null) 하루 종일 일정이다.
import { ICS_ALARM_OPTIONS, MAX_ALARMS_PER_EVENT } from "./ics.mjs";

export const APPOINTMENT_TAGS = Object.freeze({
  showing: "안내",
  consult: "상담",
  routine: "일상",
  tax: "비과세",
  lease_end: "임대차 종료",
  other: "기타",
});
export const APPOINTMENT_TAG_KEYS = Object.freeze(Object.keys(APPOINTMENT_TAGS));

export const APPOINTMENT_ALARMS = Object.freeze({
  ...Object.fromEntries(Object.entries(ICS_ALARM_OPTIONS).map(([key, option]) => [key, Object.freeze({ label: option.label, timedOnly: false })])),
  "hour-before": Object.freeze({ label: "1시간 전", timedOnly: true }),
});
export const APPOINTMENT_ALARM_KEYS = Object.freeze(Object.keys(APPOINTMENT_ALARMS));
export const APPOINTMENT_MAX_ALARMS = MAX_ALARMS_PER_EVENT;
// 알림을 보내지 않았을 때 서버가 넣는 값: 지금 거래 일정 기본값과 같은 전날 18:00 하나.
export const DEFAULT_APPOINTMENT_ALARMS = Object.freeze(["day-before-18"]);

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/u;

/** 한국 시각 HH:MM(00:00 ~ 23:59) @param {unknown} value */
export const isClockTime = (value) => typeof value === "string" && TIME_PATTERN.test(value);

const minutesOf = (/** @type {string} */ time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

// 시각 있는 일정: 알림 시각을 '그날 00:00부터 몇 분'으로(앞날은 음수).
const ALARM_DAY_MINUTES = Object.freeze({
  "day-before-18": -6 * 60, // 전날 18:00
  "same-day-09": 9 * 60, // 당일 09:00
  "three-days-before-09": -3 * 24 * 60 + 9 * 60, // 3일 전 09:00
});

/**
 * 알림이 시작 시각보다 몇 분 앞인지(앞이면 음수, 시작과 같으면 0). 고를 수 없는 알림이면 null.
 * 시각 있는 일정에서 시작보다 늦게 울리는 알림(예: 08:00 시작에 당일 09:00)은 고를 수 없다. 시작과 같은 시각(09:00 시작에 당일 09:00)은 고를 수 있다.
 * @param {string} alarm @param {string | null} startTime null이면 하루 종일
 */
export function appointmentAlarmOffset(alarm, startTime) {
  const option = APPOINTMENT_ALARMS[alarm];
  if (!option) return null;
  if (startTime === null || startTime === undefined) return option.timedOnly ? null : 0;
  if (!isClockTime(startTime)) return null;
  const start = minutesOf(startTime);
  const offset = alarm === "hour-before" ? -60 : ALARM_DAY_MINUTES[alarm] - start;
  return offset <= 0 ? offset : null;
}

/** 이 일정에 이 알림을 고를 수 있는지 @param {string} alarm @param {string | null} startTime */
export const appointmentAlarmAllowed = (alarm, startTime) => appointmentAlarmOffset(alarm, startTime) !== null;

/** 이 일정에 고를 수 있는 알림 키(목록 순서) @param {string | null} startTime */
export const appointmentAlarmChoices = (startTime) => APPOINTMENT_ALARM_KEYS.filter((key) => appointmentAlarmAllowed(key, startTime));

/**
 * 알림 목록 검사: 배열, 0 ~ 2개, 겹침 없음, 모두 고를 수 있는 알림.
 * @param {unknown} alarms @param {string | null} startTime
 */
export function appointmentAlarmsValid(alarms, startTime) {
  return Array.isArray(alarms)
    && alarms.length <= APPOINTMENT_MAX_ALARMS
    && new Set(alarms).size === alarms.length
    && alarms.every((alarm) => typeof alarm === "string" && appointmentAlarmAllowed(alarm, startTime));
}

function formatDuration(minutes) {
  if (minutes === 0) return "PT0S";
  const sign = minutes < 0 ? "-" : "";
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${sign}PT${hours > 0 ? `${hours}H` : ""}${rest > 0 ? `${rest}M` : ""}`;
}

/**
 * .ics VALARM TRIGGER 값(DTSTART 기준). 하루 종일은 지금 거래 일정과 같은 값(그날 00:00 기준), 시각 있으면 시작 시각에서 거꾸로 센다.
 * 예: 16:00 시작 전날 18:00 → -PT22H, 10:30 시작 당일 09:00 → -PT1H30M, 1시간 전 → -PT1H. 고를 수 없는 알림이면 null.
 * @param {string} alarm @param {string | null} startTime
 */
export function appointmentAlarmTrigger(alarm, startTime) {
  if (!appointmentAlarmAllowed(alarm, startTime)) return null;
  if (startTime === null || startTime === undefined) return ICS_ALARM_OPTIONS[alarm].trigger;
  return formatDuration(appointmentAlarmOffset(alarm, startTime));
}
