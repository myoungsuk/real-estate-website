// 달력 화면의 '1년 넘게 지난 날짜' 막기(src/lib/work/calendar-view.mjs appointmentSaveExpired)가 서버(worker/work-appointments.mjs)와
// 같은 판정을 하는지, 같은 입력을 화면 함수와 진짜 업무 API에 함께 넣어 견준다. 이름·제목은 모두 가상 값이고 메모리 DB만 쓴다.
import assert from "node:assert/strict";
import test from "node:test";
import { APPOINTMENT_DATE_EXPIRED_MESSAGE, appointmentCutoffDate } from "../src/lib/work/appointment-rules.mjs";
import {
  appointmentExpiredErrors,
  appointmentFormValue,
  appointmentPatchBody,
  appointmentSaveExpired,
  calendarErrorText,
  checkAppointmentInput,
} from "../src/lib/work/calendar-view.mjs";
import { NOW, freshDb, work, workEnv } from "./work-test-kit.mjs";

const EARLY = Date.parse("2025-06-01T03:00:00.000Z"); // 옛 줄을 만들 때(그때 기준일 2024-06-01)
const CUTOFF = appointmentCutoffDate(NOW); // NOW = 한국 2026-11-17 → 2025-11-17
const BASE = { tag: "showing", title: "가상 안내", allDay: true, startTime: "", endTime: "", repeatRule: "none", untilMode: "none", repeatUntil: "", alarms: ["day-before-18"] };

const form = (extra) => {
  const checked = checkAppointmentInput({ ...BASE, ...extra });
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  return checked.value;
};
const serverFields = (result) => (result.status === 400 && result.json.error.code === "APPOINTMENT_DATE_EXPIRED" ? result.json.error.details : null);

test("기준일은 서버와 같은 함수이고, 막힌 칸 글·오류 글은 서버 문장 그대로다", () => {
  assert.equal(CUTOFF, "2025-11-17");
  assert.deepEqual(appointmentExpiredErrors(["repeatUntil"]), { repeatUntil: APPOINTMENT_DATE_EXPIRED_MESSAGE });
  assert.deepEqual(appointmentExpiredErrors(["title"]), {}, "날짜 칸 말고는 이 글을 붙이지 않음");
  assert.equal(calendarErrorText("APPOINTMENT_DATE_EXPIRED", "다른 글"), APPOINTMENT_DATE_EXPIRED_MESSAGE);
});

test("새 일정: 화면 판정과 진짜 서버 판정이 같다(기준일 당일까지 막고 다음 날은 통과, 끝 없는 옛 반복은 통과)", async () => {
  const env = workEnv(freshDb().db);
  const seen = [];
  for (const extra of [
    { startsOn: "2025-11-16" },
    { startsOn: "2025-11-17" },
    { startsOn: "2025-11-18" },
    { startsOn: "2025-01-07", repeatRule: "weekly", untilMode: "date", repeatUntil: "2025-11-17" },
    { startsOn: "2025-01-07", repeatRule: "weekly", untilMode: "date", repeatUntil: "2025-11-18" },
    { startsOn: "2024-01-02", repeatRule: "weekly" },
    { startsOn: "2025-01-07", repeatRule: "weekly", untilMode: "none", repeatUntil: "2025-11-01" }, // 끝나는 날 칸을 껐으면 보지 않음
  ]) {
    const value = form(extra);
    const screen = appointmentSaveExpired(null, value, CUTOFF);
    const server = serverFields(await work(env, "/appointments", { method: "POST", body: value }));
    assert.deepEqual(screen, server, JSON.stringify(extra));
    seen.push(screen === null ? "통과" : screen.join());
  }
  assert.deepEqual(seen, ["startsOn", "startsOn", "통과", "repeatUntil", "통과", "통과", "통과"]);
});

test("고치기: 반복 없는 줄·'이 날만'·'이 날부터 모두'(나누기·처음 보이는 날)에서 화면 판정과 진짜 서버 판정이 같다", async () => {
  // [옛 줄, 연 날, 고칠 값, 범위]. 옛 줄은 EARLY에 만들고, 고치기는 NOW에 한다. 경우마다 새 DB.
  const cases = [
    [{ startsOn: "2025-06-10" }, null, { title: "가상 제목만" }, null], // 날짜를 안 바꾸면 옛 줄이어도 통과
    [{ startsOn: "2025-06-10" }, null, { startsOn: "2025-11-16" }, null],
    [{ startsOn: "2025-06-10" }, null, { startsOn: "2025-11-18" }, null],
    [{ startsOn: "2025-06-10" }, null, { repeatRule: "weekly", untilMode: "date", repeatUntil: "2025-11-10" }, null],
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-11", { title: "가상 하루" }, "one"],
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-11", { startsOn: "2025-12-01" }, "one"],
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-18", { title: "가상 하루" }, "one"],
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-11", { title: "가상 뒤" }, "following"], // 나누기, 새 줄은 끝 없음
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-11", { untilMode: "date", repeatUntil: "2025-11-17" }, "following"],
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2025-11-11", { repeatRule: "none" }, "following"], // 새 줄이 반복 없음 → 시작일을 봄
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2024-11-05", { title: "가상 앞" }, "following"], // 처음 보이는 날 = 그 자리 고치기
    [{ startsOn: "2024-11-05", repeatRule: "weekly" }, "2024-11-05", { untilMode: "date", repeatUntil: "2025-11-01" }, "following"],
    [{ startsOn: "2025-06-03", repeatRule: "weekly", untilMode: "date", repeatUntil: "2025-11-11" }, "2025-11-04", { title: "가상 뒤" }, "following"], // 나눈 새 줄이 옛 끝나는 날을 이어받음
    [{ startsOn: "2025-06-03", repeatRule: "weekly", untilMode: "date", repeatUntil: "2025-11-11" }, "2025-06-03", { title: "가상 앞" }, "following"],
  ];
  const seen = [];
  for (const [made, on, changes, scope] of cases) {
    const env = workEnv(freshDb().db);
    const created = await work(env, "/appointments", { method: "POST", body: form(made), now: EARLY });
    assert.equal(created.status, 201, JSON.stringify(made));
    const original = created.json.data.appointment;
    const value = form({ ...appointmentFormValue(original, on ?? undefined), ...changes });
    const body = appointmentPatchBody(original, value, scope ? { scope, occurrenceOn: on } : {});
    assert.ok(body, `보낼 것이 있어야 함 ${JSON.stringify(changes)}`);
    const screen = appointmentSaveExpired(original, body, CUTOFF);
    const result = await work(env, `/appointments/${original.id}`, { method: "PATCH", body });
    assert.ok([200, 201, 400].includes(result.status), `${result.status} ${JSON.stringify(result.json)}`);
    if (result.status === 400) assert.equal(result.json.error.code, "APPOINTMENT_DATE_EXPIRED", JSON.stringify(result.json.error));
    assert.deepEqual(screen, serverFields(result), JSON.stringify([made, on, changes, scope]));
    seen.push(screen === null ? "통과" : screen.join());
  }
  assert.deepEqual(seen, ["통과", "startsOn", "통과", "repeatUntil", "startsOn", "통과", "통과", "통과", "repeatUntil", "startsOn", "통과", "repeatUntil", "repeatUntil", "통과"]);
});
