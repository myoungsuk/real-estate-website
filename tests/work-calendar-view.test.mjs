import assert from "node:assert/strict";
import test from "node:test";

import { APPOINTMENT_TAG_KEYS as RULE_TAG_KEYS } from "../src/lib/work/appointment-rules.mjs";
import {
  APPOINTMENT_TAG_FAMILIES,
  APPOINTMENT_TITLE_HELP,
  CALENDAR_FAMILY_KEYS,
  alarmChoices,
  alarmSummaryText,
  appointmentDeleteBody,
  appointmentFormValue,
  appointmentPatchBody,
  cellLabel,
  checkAppointmentInput,
  chipText,
  chipsFor,
  dateLongText,
  dayTitle,
  defaultAlarms,
  filterItems,
  itemGlyph,
  itemMetaText,
  itemStateText,
  itemTimeText,
  itemsByDay,
  keepAllowedAlarms,
  marksFor,
  monthGrid,
  monthShortName,
  monthTitle,
  repeatScopeChoices,
  repeatSummaryText,
  shiftMonth,
  toCalendarItems,
  truncatedText,
} from "../src/lib/work/calendar-view.mjs";
import { TASK_NAME_HELP } from "../src/lib/work/tasks-view.mjs";

const TODAY = "2026-11-26";

test("달력 칸은 일요일 시작이고 그 달이 걸친 주만 그린다(5 ~ 6줄)", () => {
  const november = monthGrid("2026-11", TODAY);
  assert.equal(november.fromOn, "2026-11-01", "11월 1일이 일요일");
  assert.equal(november.toOn, "2026-12-05");
  assert.equal(november.days.length, 35);
  assert.deepEqual(november.days.filter((day) => day.isToday).map((day) => day.on), [TODAY]);
  assert.equal(november.days.filter((day) => day.inMonth).length, 30);
  const may = monthGrid("2026-05", TODAY);
  assert.equal(may.fromOn, "2026-04-26");
  assert.equal(may.days.length, 42, "5월 1일 금요일·31일 일요일이라 6줄");
  const february = monthGrid("2026-02", TODAY);
  assert.equal(february.days.length, 28, "2026년 2월은 일요일 시작·토요일 끝이라 4줄");
  for (const grid of [november, may, february]) assert.ok(grid.days.every((day, index) => day.weekday === index % 7));
  assert.deepEqual(monthGrid("2026-13", TODAY), { fromOn: "", toOn: "", days: [] });
});

test("달 넘기기와 머리 글", () => {
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-1", 1), null);
  assert.deepEqual(monthTitle("2026-11"), { year: "2026년", month: "11월" });
  assert.equal(monthShortName("2026-09"), "9월");
  assert.equal(dayTitle("2026-11-20"), "11월 20일 금요일");
  assert.equal(dateLongText("2026-11-25"), "2026. 11. 25.(수)");
  assert.equal(dayTitle("2026-02-30"), "");
});

const apiItems = [
  { key: "deal-e1", source: "deal", id: "e1", on: "2026-11-20", kind: "balance", title: "잔금", startTime: null, endTime: null, done: false, deal: { id: "d1", title: "가상숲1단지 84㎡ 매매", status: "contracted" }, customer: { id: "c1", displayName: "가상손님매수" } },
  { key: "deal-e2", source: "deal", id: "e2", on: "2026-11-30", kind: "custom", title: "가상 이사 날짜 확인", startTime: null, endTime: null, done: false, deal: { id: "d1", title: "가상숲1단지 84㎡ 매매", status: "contracted" }, customer: null },
  { key: "deal-e3", source: "deal", id: "e3", on: "2026-11-12", kind: "funding_plan_submit", title: "자금조달계획서 제출", done: true, deal: { id: "d1", title: "가상숲1단지 84㎡ 매매" }, customer: null },
  { key: "task-t1", source: "task", id: "t1", on: "2026-11-15", title: "가상 등기부 다시 떼기", done: false, repeat: "none", deal: null, customer: null },
  { key: "task-t2", source: "task", id: "t2", on: "2026-11-20", title: "가상 주간 광고 갱신", done: false, repeat: "weekly", deal: null, customer: null },
  {
    key: "appt-a1-20261120", source: "appointment", id: "a1", on: "2026-11-20", title: "가상 집 보여 주기", startTime: "16:00", endTime: "17:00", done: false, deal: null, customer: null,
    appointment: { id: "a1", tag: "showing", title: "가상 집 보여 주기", startsOn: "2026-11-20", startTime: "16:00", endTime: "17:00", repeatRule: "none", repeatUntil: null, skipDates: [], alarms: ["hour-before"], version: 1 },
  },
  {
    key: "appt-a2-20261116", source: "appointment", id: "a2", on: "2026-11-16", title: "사무소 주간 회의", startTime: "09:30", endTime: null, done: false, deal: null, customer: null,
    appointment: { id: "a2", tag: "routine", title: "사무소 주간 회의", startsOn: "2026-11-02", startTime: "09:30", endTime: null, repeatRule: "weekly", repeatUntil: null, skipDates: [], alarms: [], version: 2 },
  },
  { key: "weird", source: "unknown", on: "2026-11-20" },
  { key: "bad-date", source: "task", id: "x", on: "2026-11-31", title: "날짜가 틀림" },
];

test("업무 API 항목을 화면 항목으로 바꾸고, 지남·흐림은 오늘로 계산한다(서버는 late·past를 주지 않음)", () => {
  const items = toCalendarItems(apiItems, TODAY);
  assert.deepEqual(items.map((item) => item.key), ["deal-e1", "deal-e2", "deal-e3", "task-t1", "task-t2", "appt-a1-20261120", "appt-a2-20261116"], "모르는 source·틀린 날짜는 버림");
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
  assert.deepEqual([byKey["deal-e1"].family, byKey["deal-e1"].label, byKey["deal-e1"].title], ["money", "잔금", "가상숲1단지 84㎡ 매매"], "거래 일정은 종류 + 거래 이름");
  assert.deepEqual([byKey["deal-e2"].family, byKey["deal-e2"].label, byKey["deal-e2"].title], ["due", "거래 일정", "가상 이사 날짜 확인"], "직접 넣은 거래 일정은 그 제목");
  assert.equal(byKey["deal-e1"].late, true, "지난 열린 거래 일정은 지남");
  assert.equal(byKey["deal-e3"].late, false, "끝낸 일정은 지남이 아님");
  assert.equal(byKey["task-t1"].late, true);
  assert.equal(byKey["task-t2"].repeatRule, "weekly");
  assert.deepEqual([byKey["appt-a1-20261120"].family, byKey["appt-a1-20261120"].label], ["meet", "안내"]);
  assert.equal(byKey["appt-a1-20261120"].late, false, "거래 없는 일정은 끝내기가 없어 '지남' 표시도 없음");
  assert.equal(byKey["appt-a1-20261120"].past, true, "지난 것은 흐리게");
  assert.equal(byKey["appt-a2-20261116"].repeatRule, "weekly");
  assert.equal(byKey["appt-a2-20261116"].appointment.startsOn, "2026-11-02", "고치기 칸을 바로 열 수 있게 원래 줄을 싣는다");
  assert.equal(byKey["appt-a2-20261116"].customer, null, "거래 없는 일정에는 손님이 없다");
  assert.deepEqual(toCalendarItems(null, TODAY), []);
});

test("그날 차례·칸 표시: 하루 종일 먼저, 넓은 칸 3개 + 'n개 더', 좁은 칸 3개 또는 2개 + '+'", () => {
  const items = toCalendarItems(apiItems, TODAY);
  const day = itemsByDay(items).get("2026-11-20");
  assert.deepEqual(day.map((item) => item.key), ["deal-e1", "task-t2", "appt-a1-20261120"], "하루 종일(돈 날짜 → 할 일) 다음 시각 있는 일정");
  assert.deepEqual(chipsFor(day), { items: day, more: 0 });
  const many = [...day, ...day];
  assert.equal(chipsFor(many).more, 3);
  assert.equal(chipsFor(many).items.length, 3);
  assert.deepEqual(marksFor(day), { items: day, plus: false });
  assert.deepEqual(marksFor(many).items.length, 2);
  assert.equal(marksFor(many).plus, true);
  assert.equal(cellLabel("2026-11-20", day, TODAY), "11월 20일 금요일, 일정 3개, 지난 일정 2개", "열린 잔금·할 일 둘(거래 없는 일정은 세지 않음)");
  assert.equal(cellLabel(TODAY, [], TODAY), "11월 26일 목요일, 오늘, 일정 없음");
});

test("넓은 칸 글자 띠는 뜻 있는 한 조각만: 종류가 정해진 거래 일정은 그 이름, 그 밖은 적어 둔 제목(사용자 답 2026-11-26 11:22:26)", () => {
  const deal = { id: "d-1", title: "가상숲1단지 84㎡ 매매" };
  const customer = { id: "c-1", displayName: "가상손님" };
  const raw = [
    { key: "k-contract", source: "deal", kind: "contract", title: "계약일", deal, customer },
    { key: "k-middle", source: "deal", kind: "middle_payment", title: "중도금", deal, customer },
    { key: "k-balance", source: "deal", kind: "balance", title: "잔금", deal, customer },
    { key: "k-report", source: "deal", kind: "transaction_report", title: "거래신고", deal, customer },
    { key: "k-funding", source: "deal", kind: "funding_plan_submit", title: "자금조달계획서", deal, customer },
    { key: "k-lease", source: "deal", kind: "lease_report", title: "임대차 신고", deal, customer },
    { key: "k-custom", source: "deal", kind: "custom", title: "가상 이사 날짜 확인", deal, customer },
    { key: "k-custom-empty", source: "deal", kind: "custom", title: "  ", deal, customer },
    { key: "k-unknown", source: "deal", kind: "something_new", title: "가상 새 종류 일정", deal, customer },
    { key: "k-task", source: "task", title: "가상 서류 받기", done: false, repeat: "none" },
    { key: "k-task-empty", source: "task", title: "", done: false, repeat: "none" },
    { key: "k-appt", source: "appointment", title: "가상 전세 상담", appointment: { tag: "consult", repeatRule: "none" } },
    { key: "k-appt-empty", source: "appointment", title: "", appointment: { tag: "routine", repeatRule: "none" } },
  ].map((item) => ({ on: "2026-11-24", id: item.key, ...item }));
  const text = Object.fromEntries(toCalendarItems(raw, TODAY).map((item) => [item.key, chipText(item)]));
  assert.deepEqual(text, {
    "k-contract": "계약일",
    "k-middle": "중도금",
    "k-balance": "잔금",
    "k-report": "거래신고",
    "k-funding": "자금조달계획서",
    "k-lease": "임대차 신고",
    "k-custom": "가상 이사 날짜 확인",
    "k-custom-empty": "거래 일정",
    "k-unknown": "가상 새 종류 일정",
    "k-task": "가상 서류 받기",
    "k-task-empty": "할 일",
    "k-appt": "가상 전세 상담",
    "k-appt-empty": "일상",
  });
  for (const value of Object.values(text)) {
    assert.ok(!value.includes("가상숲") && !value.includes("가상손님"), "손님·거래 이름은 칸에 넣지 않음(그날 목록에서 봄)");
  }
});

test("거르기·모양·줄 글은 색 말고도 기호와 글자로 가른다", () => {
  const items = toCalendarItems(apiItems, TODAY);
  assert.deepEqual(filterItems(items, []).length, items.length, "아무것도 고르지 않으면 전체");
  assert.deepEqual(filterItems(items, ["task"]).map((item) => item.key), ["task-t1", "task-t2"]);
  assert.deepEqual(CALENDAR_FAMILY_KEYS, ["money", "due", "meet", "life", "task"]);
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
  assert.equal(itemGlyph(byKey["deal-e1"]), "◆");
  assert.equal(itemGlyph(byKey["task-t1"]), "☐");
  assert.equal(itemGlyph({ ...byKey["task-t1"], done: true }), "☑");
  assert.equal(itemTimeText(byKey["deal-e1"]), "하루 종일");
  assert.equal(itemTimeText(byKey["appt-a1-20261120"]), "16:00 ~ 17:00");
  assert.equal(itemTimeText(byKey["appt-a2-20261116"]), "09:30");
  assert.equal(itemTimeText(byKey["task-t1"]), "");
  assert.equal(itemMetaText(byKey["deal-e1"]), "손님 가상손님매수 · 거래 일정");
  assert.equal(itemMetaText(byKey["deal-e2"]), "가상숲1단지 84㎡ 매매 · 거래 일정");
  assert.equal(itemMetaText(byKey["appt-a2-20261116"]), "↻ 매주 월요일 · 직접 넣은 일정");
  assert.equal(itemStateText(byKey["deal-e3"]), "✓ 끝남");
  assert.equal(itemStateText(byKey["task-t1"]), "! 지남");
  assert.equal(itemStateText(byKey["appt-a1-20261120"]), "");
});

test("꼬리표 키는 공용 규칙(appointment-rules.mjs)과 같고, 묶음은 비과세·임대차 종료가 기한이다", () => {
  assert.deepEqual(Object.keys(APPOINTMENT_TAG_FAMILIES), [...RULE_TAG_KEYS]);
  assert.equal(APPOINTMENT_TAG_FAMILIES.tax, "due");
  assert.equal(APPOINTMENT_TAG_FAMILIES.lease_end, "due");
  assert.ok(Object.values(APPOINTMENT_TAG_FAMILIES).every((family) => CALENDAR_FAMILY_KEYS.includes(family) && family !== "task" && family !== "money"));
});

test("제목 안내는 할 일과 같은 새 문구(사용자 답 2026-11-26 08:59:51)", () => {
  assert.equal(APPOINTMENT_TITLE_HELP, TASK_NAME_HELP);
  assert.equal(TASK_NAME_HELP, "제목은 휴대폰 캘린더 구독에도 그대로 실립니다. 손님 이름은 적어도 되지만 전화번호·주민등록번호·계좌번호는 적지 않습니다.");
});

test("알림: 하루 종일은 '1시간 전' 없음, 09:00 전 시작은 '당일 09:00' 없음, 시각을 바꾸면 고를 수 없는 것은 풀림", () => {
  assert.deepEqual(alarmChoices(null), ["day-before-18", "same-day-09", "three-days-before-09"]);
  assert.deepEqual(alarmChoices("08:00"), ["day-before-18", "three-days-before-09", "hour-before"]);
  assert.deepEqual(alarmChoices("09:00"), ["day-before-18", "same-day-09", "three-days-before-09", "hour-before"], "같은 시각은 됨");
  assert.deepEqual(defaultAlarms(true), ["day-before-18"]);
  assert.deepEqual(defaultAlarms(false), ["hour-before"]);
  assert.deepEqual(keepAllowedAlarms(["same-day-09", "hour-before"], "08:00"), ["hour-before"]);
  assert.deepEqual(keepAllowedAlarms(["hour-before", "day-before-18"], null), ["day-before-18"]);
  assert.deepEqual(keepAllowedAlarms(["day-before-18", "day-before-18", "three-days-before-09", "hour-before"], "10:00"), ["day-before-18", "three-days-before-09"], "겹침 없이 2개까지");
  assert.equal(alarmSummaryText([]), "알림 없음");
  assert.equal(alarmSummaryText(["day-before-18", "hour-before"]), "전날 18:00 · 1시간 전");
});

const goodInput = {
  tag: "showing", title: "  가상 집   보여 주기 ", startsOn: "2026-12-03", allDay: false, startTime: "16:00", endTime: "17:00",
  repeatRule: "none", untilMode: "none", repeatUntil: "", alarms: ["hour-before"],
};

test("일정 넣기 칸 검사: 끝 시각은 시작보다 늦어야 하고 비워도 됨, 끝나는 날은 시작과 같거나 뒤", () => {
  assert.deepEqual(checkAppointmentInput(goodInput), {
    ok: true,
    value: { tag: "showing", title: "가상 집 보여 주기", startsOn: "2026-12-03", startTime: "16:00", endTime: "17:00", repeatRule: "none", repeatUntil: null, alarms: ["hour-before"] },
  });
  assert.equal(checkAppointmentInput({ ...goodInput, endTime: "" }).value.endTime, null);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, endTime: "16:00" }).errors), ["endTime"], "같은 시각은 안 됨");
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, endTime: "15:00" }).errors), ["endTime"]);
  const allDay = checkAppointmentInput({ ...goodInput, allDay: true, startTime: "16:00", endTime: "17:00", alarms: ["day-before-18"] });
  assert.equal(allDay.value.startTime, null, "하루 종일이면 시각을 버림");
  assert.equal(allDay.value.endTime, null);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, allDay: true, alarms: ["hour-before"] }).errors), ["alarms"]);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, startTime: "08:00", endTime: "", alarms: ["same-day-09"] }).errors), ["alarms"]);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, alarms: ["day-before-18", "same-day-09", "hour-before"] }).errors), ["alarms"], "3개는 안 됨");
  assert.deepEqual(checkAppointmentInput({ ...goodInput, alarms: [] }).value.alarms, [], "알림 없음은 빈 배열");
  const weekly = checkAppointmentInput({ ...goodInput, repeatRule: "weekly", untilMode: "date", repeatUntil: "2027-03-31" });
  assert.equal(weekly.value.repeatUntil, "2027-03-31");
  assert.equal(checkAppointmentInput({ ...goodInput, repeatRule: "weekly", untilMode: "none", repeatUntil: "2027-03-31" }).value.repeatUntil, null);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, repeatRule: "weekly", untilMode: "date", repeatUntil: "2026-12-02" }).errors), ["repeatUntil"]);
  assert.equal(checkAppointmentInput({ ...goodInput, repeatRule: "none", untilMode: "date", repeatUntil: "2027-03-31" }).value.repeatUntil, null, "반복 없음이면 끝나는 날을 보내지 않음(서버 400)");
  const bad = checkAppointmentInput({ ...goodInput, tag: "x", title: " ", startsOn: "2026-02-30", startTime: "25:00", repeatRule: "hourly" });
  assert.deepEqual(Object.keys(bad.errors).sort(), ["repeatRule", "startTime", "startsOn", "tag", "title"]);
  assert.deepEqual(Object.keys(checkAppointmentInput({ ...goodInput, title: "가".repeat(81) }).errors), ["title"]);
});

test("반복 요약은 없는 날 규칙을 알린다", () => {
  assert.equal(repeatSummaryText("none", "2026-12-03"), "");
  assert.equal(repeatSummaryText("weekly", "2026-12-03"), "↻ 매주 목요일");
  assert.equal(repeatSummaryText("monthly", "2026-01-31"), "↻ 매달 31일 · 31일이 없는 달은 그 달 마지막 날에 둡니다.");
  assert.equal(repeatSummaryText("yearly", "2028-02-29"), "↻ 매년 2월 29일 · 평년에는 2월 28일에 둡니다.");
  assert.equal(repeatSummaryText("weekdays", "2026-11-28"), "↻ 평일(월 ~ 금) · 고른 날이 주말이라 다음 월요일부터 들어갑니다.");
});

const weeklyRow = { id: "a2", tag: "routine", title: "사무소 주간 회의", startsOn: "2026-11-02", startTime: "09:30", endTime: null, repeatRule: "weekly", repeatUntil: null, skipDates: [], alarms: ["hour-before"], version: 3 };
const singleRow = { id: "a1", tag: "showing", title: "가상 집 보여 주기", startsOn: "2026-12-03", startTime: "16:00", endTime: "17:00", repeatRule: "none", repeatUntil: null, skipDates: [], alarms: ["hour-before"], version: 1 };

test("고치기 본문: 바뀐 칸만, 반복 줄은 scope·occurrenceOn, '이 날만'은 반복 칸을 보내지 않음(API 판 2 6절)", () => {
  const form = appointmentFormValue(weeklyRow, "2026-11-30");
  assert.equal(form.startsOn, "2026-11-30", "반복 줄의 한 날을 열면 날짜 칸은 그날");
  assert.equal(appointmentPatchBody(weeklyRow, checkAppointmentInput(form).value, { scope: "one", occurrenceOn: "2026-11-30" }), null, "바뀐 것이 없으면 보내지 않음");
  const later = checkAppointmentInput({ ...form, startTime: "10:00", repeatRule: "daily" }).value;
  assert.deepEqual(appointmentPatchBody(weeklyRow, later, { scope: "one", occurrenceOn: "2026-11-30" }), { version: 3, scope: "one", occurrenceOn: "2026-11-30", startTime: "10:00" });
  assert.deepEqual(appointmentPatchBody(weeklyRow, later, { scope: "following", occurrenceOn: "2026-11-30" }), { version: 3, scope: "following", occurrenceOn: "2026-11-30", startTime: "10:00", repeatRule: "daily" });
  assert.equal(appointmentPatchBody(weeklyRow, later, {}), null, "반복 줄은 scope 없이 보내지 않음");
  const allDay = checkAppointmentInput({ ...form, allDay: true, startTime: "", endTime: "", alarms: ["day-before-18"] }).value;
  assert.deepEqual(appointmentPatchBody(weeklyRow, allDay, { scope: "one", occurrenceOn: "2026-11-30" }), { version: 3, scope: "one", occurrenceOn: "2026-11-30", startTime: null, alarms: ["day-before-18"], endTime: null }, "시작 시각을 지우면 끝 시각 null도 함께(서버 400 ['startTime'] 막기)");
  const singleForm = appointmentFormValue(singleRow, "2026-11-30");
  assert.equal(singleForm.startsOn, "2026-12-03", "반복 없는 줄은 원래 날짜");
  const moved = checkAppointmentInput({ ...singleForm, startsOn: "2026-12-04", alarms: ["day-before-18", "hour-before"] }).value;
  assert.deepEqual(appointmentPatchBody(singleRow, moved, { scope: "one", occurrenceOn: "2026-12-03" }), { version: 1, startsOn: "2026-12-04", alarms: ["day-before-18", "hour-before"] }, "반복 없는 줄에는 scope를 싣지 않음(서버 400)");
});

test("지우기 본문: 반복 없는 줄은 본문 없음, 반복 줄은 고른 범위", () => {
  assert.equal(appointmentDeleteBody(singleRow), null);
  assert.deepEqual(appointmentDeleteBody(weeklyRow, { scope: "one", occurrenceOn: "2026-11-30" }), { version: 3, scope: "one", occurrenceOn: "2026-11-30" });
  assert.throws(() => appointmentDeleteBody(weeklyRow, {}));
  assert.deepEqual(repeatScopeChoices("2026-11-30", "delete").map((choice) => [choice.scope, choice.label]), [["one", "이 날만"], ["following", "이 날부터 모두"]]);
  assert.match(repeatScopeChoices("2026-11-30", "edit")[1].help, /11월 30일과 그 뒤 반복을 모두 고칩니다\. 지난 날은 그대로입니다\./u);
});

test("서버가 잘라 보냈으면 한 줄로 알린다", () => {
  assert.equal(truncatedText(false), "");
  assert.match(truncatedText(true), /일부만 보입니다/u);
});
