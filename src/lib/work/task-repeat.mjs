// 반복 할 일의 다음 날짜(설계서 6.13절 후보, 기획서 WT-2-12, 2026-11-21 사용자 결정 11:15:11 U-1 ~ U-3). 순수 함수.
// 서버(끝낼 때 다음 줄 만들기)와 화면(“끝내면 다음: 12월 31일” 미리 보기)이 같은 함수를 쓴다. 날짜는 모두 YYYY-MM-DD 글자다.
// - 반복은 없음·매주·매월만. 매일·격주·매년·끝나는 날·횟수는 두지 않는다.
// - 매월은 기준일(day, 1 ~ 31)을 따로 받는다. 그 날짜가 없는 달은 그 달 마지막 날로 당기고, 다음 달은 다시 기준일로 돌아간다
//   (기준일 31: 1/31 → 2/28 → 3/31, 윤년 2월은 29일).
// - 늦게 끝내면 원래 날짜에서 한 주기씩 더해 오늘(today, 한국 날짜) 이후(오늘 포함)가 되는 첫 날. 일찍 끝내면 원래 날짜 + 한 주기.
export const TASK_REPEAT_RULES = Object.freeze(["none", "weekly", "monthly"]);

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(time);
  if (Number.isNaN(time) || date.toISOString().slice(0, 10) !== value) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]), time };
}

// 네 자리 해(0000 ~ 9999) 밖으로 넘어가면 null(저장 칸이 YYYY-MM-DD 글자이므로).
function formatTime(time) {
  const text = new Date(time).toISOString();
  return /^\d{4}-/u.test(text) ? text.slice(0, 10) : null;
}

const lastDayOf = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// 달 번호(해 × 12 + 달)의 기준일 날짜. 그 달에 기준일이 없으면 그 달 마지막 날.
function monthlyTime(index, day) {
  const year = Math.floor(index / 12);
  const month = index - year * 12;
  return Date.UTC(year, month, Math.min(day, lastDayOf(year, month)));
}

// 다음 날짜(YYYY-MM-DD) 또는 null(반복 없음·입력이 맞지 않음·네 자리 해를 넘음).
export function nextTaskDueOn({ dueOn, rule, day, today }) {
  if (rule !== "weekly" && rule !== "monthly") return null;
  const due = parseDate(dueOn);
  const now = parseDate(today);
  if (!due || !now) return null;
  if (rule === "weekly") {
    // 한 주기 뒤가 오늘보다 앞이면 오늘 이후 첫 날까지 주 단위로 건너뛴다.
    const behind = Math.max(1, Math.ceil((now.time - due.time) / (7 * DAY_MS)));
    return formatTime(due.time + behind * 7 * DAY_MS);
  }
  if (!Number.isSafeInteger(day) || day < 1 || day > 31) return null;
  let index = due.year * 12 + due.month + 1;
  // 오늘이 있는 달 앞까지는 한 번에 건너뛰고, 그 달의 날짜가 오늘보다 앞이면 한 달 더.
  index = Math.max(index, now.year * 12 + now.month);
  while (monthlyTime(index, day) < now.time) index += 1;
  return formatTime(monthlyTime(index, day));
}
