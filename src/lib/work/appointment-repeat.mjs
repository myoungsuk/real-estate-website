// 거래 없는 일정(appointments)의 반복을 날짜로 펼치는 순수 함수(2026-11-25 사용자 답: 반복은 중개날개와 같게 매일·평일·매주·매달·매년 + 끝나는 날 + 31일 규칙).
// 반복은 저장하지 않고 읽을 때 펼친다. 서버(월 읽기·캘린더 구독)와 화면(달력·반복 미리 보기)이 같은 함수를 써서 같은 날짜를 낸다.
// 날짜는 모두 한국 날짜 YYYY-MM-DD 글자다.
// - 매달은 시작일의 '일'을 따른다. 그 날짜가 없는 달은 그 달 마지막 날로 당기고, 다음 달은 다시 시작일의 '일'로 돌아간다
//   (31일 시작: 1/31 → 2/28 → 3/31, 윤년 2월은 29일). 할 일 반복(task-repeat.mjs)과 같은 규칙이다.
// - 매년은 시작일의 달·일을 따르고, 2월 29일 시작은 평년에 2월 28일이다.
// - 평일은 월 ~ 금이다. 시작일이 토·일이면 시작일은 들어가지 않고 다음 월요일부터다.
// - 끝나는 날(repeatUntil)은 그 날을 넣는다. 뺀 날(skipDates)은 '이 날만 지우기·고치기'로 뺀 날짜다.
export const APPOINTMENT_REPEAT_RULES = Object.freeze(["none", "daily", "weekdays", "weekly", "monthly", "yearly"]);
// 한 번에 펼치는 날짜 수 상한(달력 6주는 매일 반복이어도 42개).
export const APPOINTMENT_OCCURRENCE_LIMIT = 400;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {unknown} value */
function parseTime(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

/** @param {number} time */
function formatTime(time) {
  const text = new Date(time).toISOString();
  return /^\d{4}-/u.test(text) ? text.slice(0, 10) : null;
}

const lastDayOf = (/** @type {number} */ year, /** @type {number} */ month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** @param {string} value YYYY-MM-DD */
export const isAppointmentDate = (value) => parseTime(value) !== null;

/**
 * 일정이 [fromOn, toOn] 안에서 생기는 날짜(오름차순). 입력이 맞지 않으면 빈 배열.
 * @param {{ startsOn: string, repeatRule?: string, repeatUntil?: string | null, skipDates?: Iterable<string> }} appointment
 * @param {string} fromOn
 * @param {string} toOn
 * @param {{ limit?: number }} [options]
 * @returns {string[]}
 */
export function appointmentOccurrences(appointment, fromOn, toOn, { limit = APPOINTMENT_OCCURRENCE_LIMIT } = {}) {
  const rule = appointment?.repeatRule ?? "none";
  if (!APPOINTMENT_REPEAT_RULES.includes(rule)) return [];
  const start = parseTime(appointment?.startsOn);
  const from = parseTime(fromOn);
  const to = parseTime(toOn);
  if (start === null || from === null || to === null || from > to) return [];
  let end = to;
  if (rule !== "none" && appointment.repeatUntil != null) {
    const until = parseTime(appointment.repeatUntil);
    if (until === null || until < start) return [];
    end = Math.min(end, until);
  }
  const skips = new Set(appointment.skipDates ?? []);
  const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : APPOINTMENT_OCCURRENCE_LIMIT;
  /** @type {string[]} */
  const dates = [];
  const push = (/** @type {number} */ time) => {
    if (time < from || time > end || time < start) return;
    const text = formatTime(time);
    if (text && !skips.has(text)) dates.push(text);
  };

  if (rule === "none") {
    push(start);
    return dates;
  }
  if (rule === "daily" || rule === "weekdays" || rule === "weekly") {
    const step = rule === "weekly" ? 7 : 1;
    // 앞 범위는 한 번에 건너뛴다(주기의 배수만큼).
    const skipSteps = from > start ? Math.ceil((from - start) / (step * DAY_MS)) : 0;
    for (let time = start + skipSteps * step * DAY_MS; time <= end && dates.length < cap; time += step * DAY_MS) {
      if (rule === "weekdays") {
        const weekday = new Date(time).getUTCDay();
        if (weekday === 0 || weekday === 6) continue;
      }
      push(time);
    }
    return dates;
  }
  const startDate = new Date(start);
  const day = startDate.getUTCDate();
  if (rule === "monthly") {
    const fromDate = new Date(from);
    let index = Math.max(startDate.getUTCFullYear() * 12 + startDate.getUTCMonth(), fromDate.getUTCFullYear() * 12 + fromDate.getUTCMonth());
    for (; dates.length < cap; index += 1) {
      const year = Math.floor(index / 12);
      const month = index - year * 12;
      const time = Date.UTC(year, month, Math.min(day, lastDayOf(year, month)));
      if (time > end) break;
      push(time);
    }
    return dates;
  }
  // yearly
  const month = startDate.getUTCMonth();
  for (let year = Math.max(startDate.getUTCFullYear(), new Date(from).getUTCFullYear()); dates.length < cap; year += 1) {
    const time = Date.UTC(year, month, Math.min(day, lastDayOf(year, month)));
    if (time > end) break;
    push(time);
  }
  return dates;
}

/**
 * 시작일 다음부터 count개의 날짜(반복 미리 보기용). 반복 없음이면 빈 배열.
 * @param {{ startsOn: string, repeatRule?: string, repeatUntil?: string | null }} appointment
 * @param {number} count
 */
export function upcomingOccurrences(appointment, count = 3) {
  if ((appointment?.repeatRule ?? "none") === "none") return [];
  const start = parseTime(appointment.startsOn);
  if (start === null) return [];
  // 매년 반복도 count개가 들어가게 넉넉히(해 count + 1개) 본다.
  const horizon = formatTime(start + (appointment.repeatRule === "yearly" ? (count + 1) * 366 : (count + 1) * 31) * DAY_MS);
  if (!horizon) return [];
  return appointmentOccurrences({ ...appointment, skipDates: [] }, appointment.startsOn, horizon, { limit: count + 1 })
    .filter((on) => on !== appointment.startsOn)
    .slice(0, count);
}

/**
 * '이 날부터 모두' 고치기·지우기 때 옛 반복을 끝낼 날(그 날의 전날). 그 날이 첫날이면 null(옛 반복 전체가 바뀜).
 * @param {string} startsOn
 * @param {string} occurrenceOn
 */
export function seriesEndBefore(startsOn, occurrenceOn) {
  const start = parseTime(startsOn);
  const at = parseTime(occurrenceOn);
  if (start === null || at === null || at <= start) return null;
  return formatTime(at - DAY_MS);
}
