// 거래 없는 일정 API(worker/work-appointments.mjs, 0009)·달력 한 달 읽기·휴지통 되살리기·1년 자동 삭제·1년 넘게 지난 날짜 막기 시험(설계서 6.15절).
// 이름·제목은 모두 가상 값이다. 실제 원격 D1·외부 요청을 부르지 않는다.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  APPOINTMENT_ALARM_KEYS, APPOINTMENT_TAG_KEYS, DEFAULT_APPOINTMENT_ALARMS, appointmentAlarmAllowed, appointmentAlarmChoices, appointmentAlarmTrigger,
  appointmentCutoffDate as rulesCutoffDate, appointmentDateExpired,
} from "../src/lib/work/appointment-rules.mjs";
import { appointmentOccurrences, seriesEndBefore } from "../src/lib/work/appointment-repeat.mjs";
import { APPOINTMENT_SKIP_MAX, CALENDAR_ITEM_LIMIT, CALENDAR_ROW_LIMIT, appointmentCutoffDate } from "../worker/work-appointments.mjs";
import { runAppointmentExpire, runRealpriceCron } from "../worker/work-scheduled.mjs";
import { trashBatchFor, trashRowsSql } from "../worker/work-trash.mjs";
import { NOW, OWNER, allMigrationSql, createD1, expectedTrash, freshDb, migrationFiles, nextUuid, rows, work, workEnv } from "./work-test-kit.mjs";

const STAMP = new Date(NOW).toISOString();
const DAY = 24 * 60 * 60 * 1000;
const TITLE = "가상손님 안내";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

const setup = () => {
  const { database, db } = freshDb();
  return { database, db, env: workEnv(db) };
};
const create = (env, body) => work(env, "/appointments", { method: "POST", body: { tag: "showing", title: TITLE, startsOn: "2026-12-01", ...body } });
const patch = (env, id, body) => work(env, `/appointments/${id}`, { method: "PATCH", body });
const remove = (env, id, body) => work(env, `/appointments/${id}`, { method: "DELETE", body: body ?? {} });
const restore = (env, batchId) => work(env, `/trash/${batchId}/restore`, { method: "POST", body: {} });
const calendar = (env, from, to) => work(env, `/calendar?from=${from}&to=${to}`);
const apptRow = (database, id) => rows(database, "SELECT * FROM appointments WHERE id = ?", id)[0];
const audits = (database) => rows(database, "SELECT action, target_type, target_id, outcome, reason FROM audit_events ORDER BY seq");
const days = (appt, from = "2026-11-01", to = "2027-02-28") => appointmentOccurrences(appt, from, to);
const weekly = (env, extra = {}) => create(env, { repeatRule: "weekly", repeatUntil: "2026-12-29", ...extra }); // 12-01 ~ 12-29 화요일 5번

// ── 순수 함수 ──────────────────────────────────────────────────────────

test("알림 판정: 하루 종일은 세 가지(그날 00:00 기준 trigger 그대로), 시각 있으면 시작에서 거꾸로 세고 시작보다 늦게 울리는 알림·하루 종일의 1시간 전은 고를 수 없다", () => {
  assert.deepEqual(APPOINTMENT_TAG_KEYS, ["showing", "consult", "routine", "tax", "lease_end", "other"]);
  assert.deepEqual(APPOINTMENT_ALARM_KEYS, ["day-before-18", "same-day-09", "three-days-before-09", "hour-before"]);
  assert.deepEqual(DEFAULT_APPOINTMENT_ALARMS, ["day-before-18"]);
  for (const [alarm, start, trigger] of [
    ["day-before-18", null, "-PT6H"], ["same-day-09", null, "PT9H"], ["three-days-before-09", null, "-P2DT15H"], ["hour-before", null, null],
    ["day-before-18", "16:00", "-PT22H"], ["same-day-09", "10:30", "-PT1H30M"], ["same-day-09", "09:00", "PT0S"], ["same-day-09", "08:00", null],
    ["three-days-before-09", "16:00", "-PT79H"], ["hour-before", "00:30", "-PT1H"], ["모름", null, null],
  ]) {
    assert.equal(appointmentAlarmTrigger(alarm, start), trigger, `${alarm} ${start}`);
    assert.equal(appointmentAlarmAllowed(alarm, start), trigger !== null, `${alarm} ${start}`);
  }
  assert.deepEqual(appointmentAlarmChoices(null), ["day-before-18", "same-day-09", "three-days-before-09"]);
  assert.deepEqual(appointmentAlarmChoices("08:00"), ["day-before-18", "three-days-before-09", "hour-before"]);
});

test("반복 펼치기: 끝나는 날·뺀 날을 지키고, seriesEndBefore는 첫날 이전이면 null·아니면 전날", () => {
  const appt = { startsOn: "2026-12-01", repeatRule: "weekly", repeatUntil: "2026-12-29", skipDates: ["2026-12-15"] };
  assert.deepEqual(days(appt), ["2026-12-01", "2026-12-08", "2026-12-22", "2026-12-29"]);
  assert.deepEqual(days({ ...appt, repeatRule: "none", repeatUntil: null, skipDates: [] }), ["2026-12-01"]);
  assert.equal(seriesEndBefore("2026-12-01", "2026-12-01"), null);
  assert.equal(seriesEndBefore("2026-12-01", "2026-11-20"), null);
  assert.equal(seriesEndBefore("2026-12-01", "2026-12-15"), "2026-12-14");
});

// ── 만들기·읽기 ────────────────────────────────────────────────────────

test("만들기: 201, 알림을 보내지 않으면 전날 18:00 하나, 감사 appointment.create의 reason은 반복 규칙뿐(제목 없음), 읽기는 appointment.view", async () => {
  const { database, env } = setup();
  const made = await create(env, { startTime: "14:00", endTime: "15:00" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const appointment = made.json.data.appointment;
  assert.match(appointment.id, UUID);
  assert.deepEqual({ ...appointment, id: "-" }, {
    id: "-", tag: "showing", title: TITLE, startsOn: "2026-12-01", startTime: "14:00", endTime: "15:00", repeatRule: "none", repeatUntil: null,
    skipDates: [], alarms: ["day-before-18"], seriesId: null, seriesOn: null, version: 1, createdAt: STAMP, updatedAt: STAMP,
  });
  const read = await work(env, `/appointments/${appointment.id}`);
  assert.deepEqual([read.status, read.json.data.appointment], [200, appointment]);
  assert.deepEqual(audits(database), [
    { action: "appointment.create", target_type: "appointment", target_id: appointment.id, outcome: "ok", reason: "repeat=none" },
    { action: "appointment.view", target_type: "appointment", target_id: appointment.id, outcome: "ok", reason: null },
  ]);
  assert.equal((await work(env, `/appointments/${nextUuid()}`)).status, 404);
  assert.equal((await work(env, "/appointments/not-a-uuid")).status, 404);
  assert.equal((await work(env, "/appointments")).status, 405);
  // 제목의 주민등록번호 꼴은 가리고, 감사에는 가린 수만.
  const masked = await create(env, { title: "가상 900101-1234567 확인" });
  assert.equal(masked.json.data.appointment.title.includes("1234567"), false);
  assert.equal(audits(database).at(-1).reason, "repeat=none rrn_masked=1");
});

test("만들기 검사: 빠진 칸·모르는 칸·모르는 꼬리표·끝 시각이 시작보다 이르거나 같음·시작 없는 끝·반복 없는데 끝나는 날·하루 종일에 1시간 전·알림 3개·겹침은 400 칸 이름", async () => {
  const { database, env } = setup();
  for (const [name, body, fields] of [
    ["빠진 칸", { tag: undefined, title: undefined }, ["tag", "title"]],
    ["모르는 칸", { customerId: "x" }, null],
    ["모르는 꼬리표", { tag: "party" }, ["tag"]],
    ["빈 제목", { title: "   " }, ["title"]],
    ["날짜 꼴", { startsOn: "2026-13-01" }, ["startsOn"]],
    ["시각 꼴", { startTime: "24:00" }, ["startTime"]],
    ["끝 = 시작", { startTime: "10:00", endTime: "10:00" }, ["endTime"]],
    ["끝 < 시작", { startTime: "10:00", endTime: "09:59" }, ["endTime"]],
    ["시작 없는 끝", { endTime: "10:00" }, ["startTime"]],
    ["반복 없는 끝나는 날", { repeatUntil: "2026-12-31" }, ["repeatUntil"]],
    ["끝나는 날 < 시작", { repeatRule: "daily", repeatUntil: "2026-11-30" }, ["repeatUntil"]],
    ["모르는 반복", { repeatRule: "hourly" }, ["repeatRule"]],
    ["하루 종일 1시간 전", { alarms: ["hour-before"] }, ["alarms"]],
    ["시작보다 늦은 알림", { startTime: "08:00", alarms: ["same-day-09"] }, ["alarms"]],
    ["알림 3개", { alarms: ["day-before-18", "same-day-09", "three-days-before-09"] }, ["alarms"]],
    ["알림 겹침", { alarms: ["day-before-18", "day-before-18"] }, ["alarms"]],
  ]) {
    const result = await create(env, body);
    assert.equal(result.status, 400, name);
    assert.equal(result.json.error.code, "VALIDATION_FAILED", name);
    if (fields) assert.deepEqual(result.json.error.details, fields, name);
  }
  assert.equal(rows(database, "SELECT count(*) AS n FROM appointments")[0].n, 0);
  // 알림 0개, 시각 있는 일정의 1시간 전 + 전날 18:00은 된다.
  assert.equal((await create(env, { alarms: [] })).status, 201);
  assert.equal((await create(env, { startTime: "10:00", alarms: ["hour-before", "day-before-18"] })).status, 201);
});

// ── 고치기 ────────────────────────────────────────────────────────────

test("반복 없는 줄 고치기: version이 다르면 409, scope를 보내면 400, 바꿀 칸이 없으면 400, 시각을 지우면서 끝 시각을 남기면 400", async () => {
  const { database, env } = setup();
  const { id } = (await create(env, { startTime: "10:00", endTime: "11:00" })).json.data.appointment;
  assert.deepEqual([(await patch(env, id, { version: 2, title: "가상 바꿈" })).json.error.code], ["VERSION_CONFLICT"]);
  assert.deepEqual((await patch(env, id, { version: 1, scope: "one", occurrenceOn: "2026-12-01", title: "가상" })).json.error.details, ["scope"]);
  assert.deepEqual((await patch(env, id, { version: 1 })).json.error.details, ["body"]);
  assert.deepEqual((await patch(env, id, { version: 1, startTime: null })).json.error.details, ["startTime"]);
  const ok = await patch(env, id, { version: 1, startTime: null, endTime: null, tag: "consult" });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.data.appointment.startTime, ok.json.data.appointment.endTime, ok.json.data.appointment.tag, ok.json.data.appointment.version], [null, null, "consult", 2]);
  // 반복으로 바꿨다가 반복 없음으로 되돌리면 끝나는 날·뺀 날을 함께 비운다.
  await patch(env, id, { version: 2, repeatRule: "daily", repeatUntil: "2026-12-05" });
  const back = await patch(env, id, { version: 3, scope: "following", occurrenceOn: "2026-12-01", repeatRule: "none" });
  assert.equal(back.status, 200, JSON.stringify(back.json));
  assert.deepEqual([back.json.data.appointment.repeatRule, back.json.data.appointment.repeatUntil, back.json.data.appointment.skipDates], ["none", null, []]);
  assert.deepEqual(audits(database).filter((entry) => entry.action === "appointment.update").map((entry) => entry.reason), ["scope=none", "scope=none", "scope=all"]);
});

test("반복 줄 '이 날만' 고치기: 원래 줄에 그날을 빼고 반복 없는 새 줄(series_id·series_on)을 201로 만든다. scope 없음·그날이 반복에 없음·반복 칸을 보냄은 400", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  assert.deepEqual((await patch(env, series.id, { version: 1, title: "가상" })).json.error.details, ["scope"]);
  assert.deepEqual((await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-09", title: "가상" })).json.error.details, ["occurrenceOn"]);
  assert.deepEqual((await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", repeatRule: "daily" })).json.error.details, ["repeatRule"]);
  const one = await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", startTime: "15:00", title: "가상 시간 바꿈" });
  assert.equal(one.status, 201, JSON.stringify(one.json));
  assert.deepEqual([one.json.data.series.skipDates, one.json.data.series.version], [["2026-12-08"], 2]);
  const single = one.json.data.appointment;
  assert.deepEqual([single.startsOn, single.startTime, single.repeatRule, single.seriesId, single.seriesOn, single.tag], ["2026-12-08", "15:00", "none", series.id, "2026-12-08", "showing"]);
  // 같은 날을 다시 '이 날만' 고치면 이미 뺀 날이라 400.
  assert.deepEqual((await patch(env, series.id, { version: 2, scope: "one", occurrenceOn: "2026-12-08", title: "가상" })).json.error.details, ["occurrenceOn"]);
  // 날짜를 다른 날로 옮길 수도 있다.
  const moved = await patch(env, series.id, { version: 2, scope: "one", occurrenceOn: "2026-12-15", startsOn: "2026-12-16" });
  assert.deepEqual([moved.json.data.appointment.startsOn, moved.json.data.appointment.seriesOn], ["2026-12-16", "2026-12-15"]);
  assert.equal(audits(database).filter((entry) => entry.reason === "scope=one").length, 2);
  // 뺀 날이 366개면 더 뺄 수 없다(409).
  database.prepare("UPDATE appointments SET skip_dates = ?, repeat_until = NULL WHERE id = ?")
    .run(JSON.stringify(Array.from({ length: APPOINTMENT_SKIP_MAX }, (_, index) => new Date(Date.parse("2027-01-05T00:00:00Z") + index * 7 * DAY).toISOString().slice(0, 10))), series.id);
  const full = await patch(env, series.id, { version: 3, scope: "one", occurrenceOn: "2026-12-22", title: "가상" });
  assert.deepEqual([full.status, full.json.error.code], [409, "SKIP_LIMIT_REACHED"]);
});

test("반복 줄 '이 날부터 모두' 고치기: 원래 줄은 전날에 끝나고 새 반복 줄이 그날부터, 그날 뒤 '이 날만 고친' 줄과 뺀 날은 새 줄로 옮긴다. 첫날이면 원래 줄을 그 자리에서 고친다", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  const early = (await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", title: "가상 앞" })).json.data.appointment;
  const late = (await patch(env, series.id, { version: 2, scope: "one", occurrenceOn: "2026-12-22", title: "가상 뒤" })).json.data.appointment;
  const split = await patch(env, series.id, { version: 3, scope: "following", occurrenceOn: "2026-12-15", startTime: "18:00", alarms: ["hour-before"] });
  assert.equal(split.status, 201, JSON.stringify(split.json));
  const next = split.json.data.appointment;
  assert.deepEqual([split.json.data.series.repeatUntil, split.json.data.series.skipDates], ["2026-12-14", ["2026-12-08"]]);
  assert.deepEqual([next.startsOn, next.repeatRule, next.repeatUntil, next.skipDates, next.startTime, next.alarms], ["2026-12-15", "weekly", "2026-12-29", ["2026-12-22"], "18:00", ["hour-before"]]);
  assert.equal(apptRow(database, early.id).series_id, series.id, "그날 앞의 고친 줄은 원래 줄에");
  assert.equal(apptRow(database, late.id).series_id, next.id, "그날 뒤의 고친 줄은 새 줄로");
  assert.deepEqual(days(split.json.data.series), ["2026-12-01"]);
  assert.deepEqual(days(next), ["2026-12-15", "2026-12-29"]);
  // 새 줄의 첫날에 '이 날부터 모두'는 줄을 나누지 않고 그 자리에서(200).
  const inPlace = await patch(env, next.id, { version: 1, scope: "following", occurrenceOn: "2026-12-15", title: "가상 전체" });
  assert.deepEqual([inPlace.status, inPlace.json.data.appointment.id, inPlace.json.data.appointment.title], [200, next.id, "가상 전체"]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM appointments")[0].n, 4);
  assert.deepEqual(audits(database).filter((entry) => entry.action === "appointment.update").map((entry) => entry.reason), ["scope=one", "scope=one", "scope=following", "scope=all"]);
  // 앞쪽 날이 모두 빠진 반복(12-01을 뺀 뒤 12-08에서 나눔)도 '처음 보이는 날'이라 그 자리에서.
  const other = (await weekly(env)).json.data.appointment;
  await remove(env, other.id, { version: 1, scope: "one", occurrenceOn: "2026-12-01" });
  const firstVisible = await patch(env, other.id, { version: 2, scope: "following", occurrenceOn: "2026-12-08", title: "가상 다음" });
  assert.deepEqual([firstVisible.status, firstVisible.json.data.appointment.id], [200, other.id]);
});

// ── 지우기 → 휴지통 → 되살리기 ─────────────────────────────────────────

test("반복 없는 줄 지우기: 본문 {}(공용 클라이언트)·없음 모두 받고, 휴지통 종류 '일정'·이름은 제목, 되살리면 칸마다 같음", async () => {
  const { database, env } = setup();
  const { id } = (await create(env, { startTime: "10:00" })).json.data.appointment;
  const before = apptRow(database, id);
  assert.deepEqual((await remove(env, id, { version: 1, scope: "one", occurrenceOn: "2026-12-01" })).json.error.details, ["scope"]);
  const deleted = await remove(env, id);
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(deleted.json.data, { deleted: true, trash: expectedTrash(deleted.json.data) });
  assert.equal(apptRow(database, id), undefined);
  const listed = (await work(env, "/trash")).json.data.items[0];
  assert.deepEqual([listed.kind, listed.label, listed.counts.events, listed.counts.appointments], ["event", TITLE, 1, 1]);
  const restored = await restore(env, deleted.json.data.trash.batchId);
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual([restored.json.data.restored.events, restored.json.data.restored.appointments, restored.json.data.remaining], [1, 1, 0]);
  assert.deepEqual(apptRow(database, id), before);
  assert.equal(audits(database).find((entry) => entry.action === "appointment.delete").reason, "scope=none");
});

test("반복 줄 '이 날만' 지우기: 뺀 날만 더하고 휴지통 이름은 '제목 · 12월 8일', 되살리면 뺀 날이 돌아가고 version이 오름. 그사이 고쳤으면 건너뜀(changed)", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  assert.deepEqual((await remove(env, series.id)).json.error.details, ["scope"], "반복 줄은 본문이 있어야 함");
  assert.equal((await remove(env, series.id, { version: 9, scope: "one", occurrenceOn: "2026-12-08" })).json.error.code, "VERSION_CONFLICT");
  const deleted = await remove(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual([JSON.parse(apptRow(database, series.id).skip_dates), apptRow(database, series.id).version], [["2026-12-08"], 2]);
  const listed = (await work(env, "/trash")).json.data.items[0];
  assert.deepEqual([listed.label, listed.counts.events, listed.counts.appointments, listed.counts.links], [`${TITLE} · 12월 8일`, 1, 1, 0]);
  const restored = await restore(env, deleted.json.data.trash.batchId);
  assert.deepEqual([restored.json.data.restored.events, restored.json.data.restored.appointments, restored.json.data.remaining], [1, 1, 0]);
  assert.deepEqual([JSON.parse(apptRow(database, series.id).skip_dates), apptRow(database, series.id).version], [[], 3]);

  // 지운 뒤 다시 고쳤으면 그 줄은 되살리지 않고(지금 값 보존), 장부 연결 'changed'와 같이 다 된 것으로 보아 휴지통에서 지운다(R-2).
  const again = await remove(env, series.id, { version: 3, scope: "one", occurrenceOn: "2026-12-15" });
  await patch(env, series.id, { version: 4, scope: "following", occurrenceOn: "2026-12-01", title: "가상 바꿈" });
  const blocked = await restore(env, again.json.data.trash.batchId);
  assert.equal(blocked.status, 200, JSON.stringify(blocked.json));
  assert.deepEqual(blocked.json.data.skipped, [{ table: "appointmentSeries", reason: "changed", count: 1 }]);
  assert.deepEqual([blocked.json.data.remaining, JSON.parse(apptRow(database, series.id).skip_dates)], [0, ["2026-12-15"]]);
  assert.equal(rows(database, "SELECT count(*) AS n FROM trash_batches WHERE id = ?", again.json.data.trash.batchId)[0].n, 0);
  assert.equal(audits(database).filter((entry) => entry.action === "appointment.delete").every((entry) => entry.reason === "scope=one"), true);
});

test("반복 줄 '이 날부터 모두' 지우기: 전날에 끝내고 그날 뒤 고친 줄도 휴지통으로, 되살리면 둘 다 돌아옴. 끝나는 날 있는 반복의 마지막 날만 지우면 줄 전체를 지움", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  const late = (await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-22", title: "가상 뒤" })).json.data.appointment;
  const before = { series: apptRow(database, series.id), late: apptRow(database, late.id) };
  const deleted = await remove(env, series.id, { version: 2, scope: "following", occurrenceOn: "2026-12-15" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual([apptRow(database, series.id).repeat_until, JSON.parse(apptRow(database, series.id).skip_dates), apptRow(database, late.id)], ["2026-12-14", [], undefined]);
  const listed = (await work(env, "/trash")).json.data.items[0];
  assert.deepEqual([listed.label, listed.counts.events, listed.counts.appointments], [`${TITLE} · 12월 15일부터`, 2, 2]);
  const restored = await restore(env, deleted.json.data.trash.batchId);
  assert.deepEqual([restored.json.data.restored.appointments, restored.json.data.remaining], [2, 0]);
  assert.deepEqual(apptRow(database, late.id), before.late);
  const back = apptRow(database, series.id);
  assert.deepEqual([back.repeat_until, back.skip_dates, back.version], [before.series.repeat_until, before.series.skip_dates, before.series.version + 2]);
  assert.equal(audits(database).find((entry) => entry.action === "appointment.delete").reason, "scope=following");

  // 2번 남은 반복(12-01·12-08)에서 12-08만 지우면 12-01이 남아 '이 날만', 그다음 12-01을 지우면 보이는 날이 없어 줄 전체.
  const short = (await create(env, { repeatRule: "weekly", repeatUntil: "2026-12-08" })).json.data.appointment;
  await remove(env, short.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08" });
  const last = await remove(env, short.id, { version: 2, scope: "one", occurrenceOn: "2026-12-01" });
  assert.equal(last.status, 200, JSON.stringify(last.json));
  assert.equal(apptRow(database, short.id), undefined);
  assert.deepEqual(audits(database).filter((entry) => entry.target_id === short.id && entry.action === "appointment.delete").map((entry) => entry.reason), ["scope=one", "scope=all"]);
});

test("반복 줄 첫날에서 '이 날부터 모두' 지우기: 원래 줄과 그 반복의 고친 줄을 모두 한 묶음으로, 되살리면 모두 같음", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  const early = (await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", title: "가상 앞" })).json.data.appointment;
  const snapshot = () => rows(database, "SELECT * FROM appointments ORDER BY id");
  const before = snapshot();
  const deleted = await remove(env, series.id, { version: 2, scope: "following", occurrenceOn: "2026-12-01" });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.json));
  assert.deepEqual(snapshot(), []);
  const listed = (await work(env, "/trash")).json.data.items[0];
  assert.deepEqual([listed.label, listed.counts.events, listed.counts.appointments], [TITLE, 2, 2]);
  assert.equal((await restore(env, deleted.json.data.trash.batchId)).json.data.remaining, 0);
  assert.deepEqual(snapshot(), before);
  assert.equal(apptRow(database, early.id).series_id, series.id);
  assert.equal(audits(database).find((entry) => entry.action === "appointment.delete").reason, "scope=all");
});

test("고친 줄('이 날만')만 지우면 그 줄만 지우고 원래 반복의 뺀 날은 그대로라 그날은 비어 보인다", async () => {
  const { database, env } = setup();
  const series = (await weekly(env)).json.data.appointment;
  const single = (await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", title: "가상 앞" })).json.data.appointment;
  assert.equal((await remove(env, single.id)).status, 200);
  assert.deepEqual([apptRow(database, single.id), JSON.parse(apptRow(database, series.id).skip_dates)], [undefined, ["2026-12-08"]]);
});

// ── 달력 한 달 읽기 ────────────────────────────────────────────────────

function seedCalendar(database) {
  const customer = database.prepare("INSERT INTO customers (id, display_name, phone_digits, needs, created_at, updated_at) VALUES (?, ?, '01000000000', '', ?, ?)");
  customer.run("cust-buyer", "가상매수", STAMP, STAMP);
  customer.run("cust-seller", "가상매도", STAMP, STAMP);
  const deal = database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, status, created_at, updated_at) VALUES (?, ?, 'sale', 'housing', ?, ?, ?)");
  deal.run("deal-open", "가상거래", "open", STAMP, STAMP);
  deal.run("deal-done", "가상끝거래", "completed", STAMP, STAMP);
  deal.run("deal-cancel", "가상취소거래", "cancelled", STAMP, STAMP);
  database.prepare("INSERT INTO deal_parties (deal_id, customer_id, role) VALUES ('deal-open', 'cust-seller', 'seller'), ('deal-open', 'cust-buyer', 'buyer')").run();
  const event = database.prepare("INSERT INTO deal_events (id, deal_id, kind, due_on, title, source, done_at, created_at, updated_at) VALUES (?, ?, 'balance', ?, '잔금', 'calculated', ?, ?, ?)");
  event.run("ev-open", "deal-open", "2026-12-10", null, STAMP, STAMP);
  event.run("ev-done", "deal-done", "2026-12-03", STAMP, STAMP, STAMP);
  event.run("ev-cancel", "deal-cancel", "2026-12-04", null, STAMP, STAMP);
  event.run("ev-out", "deal-open", "2027-01-20", null, STAMP, STAMP);
  const task = database.prepare("INSERT INTO tasks (id, title, deal_id, due_on, done_at, created_at, updated_at) VALUES (?, '가상할일', ?, ?, NULL, ?, ?)");
  task.run("task-cancel-deal", "deal-cancel", "2026-12-10", STAMP, STAMP);
  task.run("task-alone", null, "2026-12-02", STAMP, STAMP);
  task.run("task-undated", null, null, STAMP, STAMP);
}

test("달력: 범위 안 거래 일정(취소 거래 빼고 끝난 것 넣음)·할 일(취소 거래 것 넣음)·거래 없는 일정 펼침, 손님은 매수인 먼저, 정렬은 날짜 → 하루 종일 → 시각 → key, 감사 reason은 개수", async () => {
  const { database, env } = setup();
  seedCalendar(database);
  const series = (await weekly(env, { startTime: "10:00" })).json.data.appointment;
  await patch(env, series.id, { version: 1, scope: "one", occurrenceOn: "2026-12-08", startTime: "09:00" });
  const allDay = (await create(env, { startsOn: "2026-12-10", tag: "tax", title: "가상 비과세" })).json.data.appointment;
  const result = await calendar(env, "2026-11-30", "2026-12-13");
  assert.equal(result.status, 200, JSON.stringify(result.json));
  const { items, truncated, from, to, today } = result.json.data;
  assert.deepEqual([from, to, truncated, today], ["2026-11-30", "2026-12-13", false, "2026-11-17"]);
  assert.deepEqual(items.map((item) => [item.on, item.source, item.startTime]), [
    ["2026-12-01", "appointment", "10:00"],
    ["2026-12-02", "task", null],
    ["2026-12-03", "deal", null],
    ["2026-12-08", "appointment", "09:00"],
    ["2026-12-10", "appointment", null],
    ["2026-12-10", "deal", null],
    ["2026-12-10", "task", null],
  ]);
  assert.equal(items[0].key, `appt-${series.id}-20261201`);
  assert.equal(items[4].key, `appt-${allDay.id}-20261210`);
  const deal = items.find((item) => item.key === "deal-ev-open");
  assert.deepEqual([deal.customer, deal.deal, deal.done], [{ id: "cust-buyer", displayName: "가상매수" }, { id: "deal-open", title: "가상거래", status: "open" }, false]);
  assert.equal(items.find((item) => item.key === "deal-ev-done").done, true);
  assert.deepEqual(items.find((item) => item.key === "task-task-cancel-deal").deal.status, "cancelled");
  assert.deepEqual([items[0].customer, items[0].deal, items[0].appointment.id], [null, null, series.id]);
  assert.deepEqual(audits(database).at(-1), { action: "calendar.view", target_type: null, target_id: null, outcome: "ok", reason: "result_count=7" });
  assert.equal(JSON.stringify(audits(database)).includes("가상"), false, "감사 기록에 제목·이름 없음");
});

test("달력 범위 검사와 상한: from·to 필수, to < from·43일은 400, 표마다 500줄을 넘으면 truncated(앞 날짜부터 남김)", async () => {
  const { database, env } = setup();
  for (const query of ["", "?from=2026-12-01", "?from=2026-12-02&to=2026-12-01", "?from=2026-12-01&to=2027-01-12", "?from=2026-12-1&to=2026-12-31"]) {
    assert.equal((await work(env, `/calendar${query}`)).status, 400, query);
  }
  assert.equal((await calendar(env, "2026-12-01", "2027-01-11")).status, 200, "42일은 됨");
  assert.equal((await work(env, "/calendar?from=2026-12-01&to=2026-12-02", { method: "POST", body: {} })).status, 405);
  const task = database.prepare("INSERT INTO tasks (id, title, due_on, created_at, updated_at) VALUES (?, '가상', ?, ?, ?)");
  for (let index = 0; index <= CALENDAR_ROW_LIMIT; index += 1) task.run(`t-${String(index).padStart(4, "0")}`, index === CALENDAR_ROW_LIMIT ? "2026-12-31" : "2026-12-01", STAMP, STAMP);
  const cut = await calendar(env, "2026-12-01", "2026-12-31");
  assert.deepEqual([cut.json.data.truncated, cut.json.data.items.length, cut.json.data.items.some((item) => item.on === "2026-12-31")], [true, CALENDAR_ROW_LIMIT, false]);
  assert.equal(CALENDAR_ITEM_LIMIT, 1500);
});

// ── 구조 번호 9(0009) 마이그레이션 ─────────────────────────────────────

test("0009: 0008 위에 appointments 표만 더하고 trash_rows를 옮긴다. 적용 전에 지운 휴지통 묶음은 줄 수·내용이 같고 번호가 9로 옮겨져 되살아난다", async () => {
  assert.deepEqual(migrationFiles.slice(-1), ["0009_appointments.sql"]);
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON;");
  for (const sql of allMigrationSql.slice(0, 8)) database.exec(sql);
  const db = createD1(database);
  // 0008 때 코드와 같은 문장으로 할 일 하나를 휴지통에 넣는다(묶음 번호는 그 순간 settings 값 8).
  database.prepare("INSERT INTO tasks (id, title, due_on, created_at, updated_at) VALUES ('t-old', '가상 옛 할 일', '2026-11-20', ?, ?)").run(STAMP, STAMP);
  const ctx = { db, now: NOW, randomUUID: nextUuid, actor: { email: OWNER }, requestId: "req-old" };
  const trash = trashBatchFor(ctx, "task", "t-old");
  await db.batch([trash.statement, db.prepare(trashRowsSql("tasks", "id = ?")).bind(trash.batchId, "t-old"), db.prepare("DELETE FROM tasks WHERE id = 't-old'")]);
  const trashBefore = rows(database, "SELECT * FROM trash_rows ORDER BY batch_id, table_name, op, row_id");
  assert.equal(rows(database, "SELECT schema_version FROM trash_batches")[0].schema_version, 8);
  const tables = () => rows(database, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name);
  const tablesBefore = tables();

  database.exec(allMigrationSql[8]);
  assert.deepEqual(tables().filter((name) => !tablesBefore.includes(name)), ["appointments"]);
  assert.deepEqual(tablesBefore.filter((name) => !tables().includes(name)), []);
  assert.deepEqual(rows(database, "SELECT * FROM trash_rows ORDER BY batch_id, table_name, op, row_id"), trashBefore, "휴지통 줄 수·내용 그대로");
  assert.deepEqual(rows(database, "SELECT value_json FROM settings WHERE key = 'schema_version'")[0].value_json, "9");
  assert.equal(rows(database, "SELECT schema_version FROM trash_batches")[0].schema_version, 9);
  assert.deepEqual(rows(database, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'appointments' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((row) => row.name),
    ["idx_appointments_series", "idx_appointments_starts"]);
  assert.deepEqual(rows(database, "PRAGMA foreign_key_check"), []);
  assert.equal(rows(database, "PRAGMA integrity_check")[0].integrity_check, "ok");

  const restored = await restore(workEnv(db), trash.batchId);
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  assert.deepEqual([restored.json.data.restored.tasks, restored.json.data.remaining, "appointments" in restored.json.data.restored], [1, 0, false]);
  assert.equal(rows(database, "SELECT title FROM tasks WHERE id = 't-old'")[0].title, "가상 옛 할 일");

  // 새 CHECK: 새 표·새 연결 이름만 늘었고 모르는 것은 여전히 막는다. 일정 표의 칸 사이 규칙도 DB가 막는다.
  const row = database.prepare("INSERT INTO trash_rows (batch_id, table_name, op, row_id, row_json) VALUES ('b', ?, ?, 'x', '{}')");
  database.prepare("INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after) VALUES ('b', 'event', 't', '가상', 9, ?, ?, 'r', ?)").run(STAMP, OWNER, STAMP);
  row.run("appointments", "row");
  row.run("appointments", "appt_series");
  assert.throws(() => row.run("settings", "row"), /CHECK/u);
  assert.throws(() => row.run("appointments", "appt_other"), /CHECK/u);
  const appt = database.prepare("INSERT INTO appointments (id, tag, title, starts_on, start_time, end_time, repeat_rule, repeat_until, skip_dates, series_id, series_on, created_at, updated_at) VALUES (?, 'other', '가상', '2026-12-01', ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const [name, values] of [
    ["끝 = 시작", ["10:00", "10:00", "none", null, "[]", null, null]],
    ["시작 없는 끝", [null, "10:00", "none", null, "[]", null, null]],
    ["반복 없는 끝나는 날", [null, null, "none", "2026-12-31", "[]", null, null]],
    ["반복 없는 뺀 날", [null, null, "none", null, "[\"2026-12-01\"]", null, null]],
    ["뺀 날이 배열 아님", [null, null, "daily", null, "{}", null, null]],
    ["series_on만", [null, null, "none", null, "[]", null, "2026-12-01"]],
    ["반복인 고친 줄", [null, null, "daily", null, "[]", "s", "2026-12-01"]],
  ]) {
    assert.throws(() => appt.run(`a-${name}`, ...values, STAMP, STAMP), /CHECK/u, name);
  }
});

// ── 1년 지난 일정 자동 삭제(03:00) ─────────────────────────────────────

const AT_0305 = Date.parse("2026-11-25T18:05:00.000Z"); // 한국 2026-11-26 03:05 → 기준일 2025-11-26
const AT_1400 = Date.parse("2026-11-26T05:00:00.000Z");
function seedExpire(database) {
  const insert = database.prepare("INSERT INTO appointments (id, tag, title, starts_on, repeat_rule, repeat_until, series_id, series_on, created_at, updated_at) VALUES (?, 'other', '가상', ?, ?, ?, ?, ?, ?, ?)");
  insert.run("old-none", "2025-11-25", "none", null, null, null, STAMP, STAMP); // 지움(1년 + 하루)
  insert.run("edge-none", "2025-11-26", "none", null, null, null, STAMP, STAMP); // 남김(딱 1년)
  insert.run("old-ended", "2024-01-01", "weekly", "2025-11-25", null, null, STAMP, STAMP); // 지움(반복 끝 1년 지남)
  insert.run("edge-ended", "2024-01-01", "weekly", "2025-11-26", null, null, STAMP, STAMP); // 남김
  insert.run("endless", "2020-01-01", "yearly", null, null, null, STAMP, STAMP); // 남김(끝 없는 반복)
  insert.run("old-exception", "2025-01-07", "none", null, "endless", "2025-01-01", STAMP, STAMP); // 지움(고친 줄은 자기 날짜로)
}
const ids = (database) => rows(database, "SELECT id FROM appointments ORDER BY id").map((row) => row.id);

test("1년 자동 삭제: 03:00 차례에 날짜가 1년 지난 반복 없는 일정·반복이 끝난 지 1년 지난 일정·고친 줄을 휴지통 없이 지우고, 끝 없는 반복은 남긴다. 감사 기록 없음, 로그는 지운 수만", async () => {
  const { database, db } = freshDb();
  seedExpire(database);
  const log = [];
  assert.deepEqual(await runAppointmentExpire(db, AT_1400, () => assert.fail("로그 없음")), { outcome: "skipped" }, "03:00 차례가 아님");
  const result = await runAppointmentExpire(db, AT_0305, (entry) => log.push(entry));
  assert.deepEqual(result, { outcome: "ok", deleted: 3, rounds: 1, backlog: false });
  assert.deepEqual(ids(database), ["edge-ended", "edge-none", "endless"]);
  assert.deepEqual(log, [{ event: "appointment_expire", deleted: 3, left: false }]);
  assert.deepEqual([rows(database, "SELECT count(*) AS n FROM trash_batches")[0].n, rows(database, "SELECT count(*) AS n FROM audit_events")[0].n], [0, 0]);
  assert.deepEqual(await runAppointmentExpire(db, AT_0305, () => assert.fail("지울 것이 없으면 로그 없음")), { outcome: "ok", deleted: 0, rounds: 1, backlog: false });
  assert.deepEqual(await runAppointmentExpire(undefined, AT_0305, () => assert.fail("로그 없음")), { outcome: "skipped" });
  database.prepare("UPDATE settings SET value_json = '8' WHERE key = 'schema_version'").run();
  assert.deepEqual(await runAppointmentExpire(db, AT_0305, () => assert.fail("로그 없음")), { outcome: "skipped" }, "구조 번호 8");
});

test("1년 자동 삭제: 기준일은 한국 날짜에서 해만 1 뺌(2월 29일은 02-28까지 지움), 500줄씩 4번 뒤 남으면 BACKLOG 경고, 실거래가 Cron 03:00 차례가 켜기 값 없이도 부른다", async () => {
  assert.equal(appointmentCutoffDate(AT_0305), "2025-11-26");
  assert.equal(appointmentCutoffDate(Date.parse("2028-02-28T15:00:00.000Z")), "2027-02-29");
  assert.equal("2027-02-28" < appointmentCutoffDate(Date.parse("2028-02-28T15:00:00.000Z")), true);
  assert.equal("2027-03-01" < appointmentCutoffDate(Date.parse("2028-02-28T15:00:00.000Z")), false);

  const { database, db } = freshDb();
  const insert = database.prepare("INSERT INTO appointments (id, tag, title, starts_on, created_at, updated_at) VALUES (?, 'other', '가상', '2024-05-01', ?, ?)");
  for (let index = 0; index < 2001; index += 1) insert.run(`a-${String(index).padStart(5, "0")}`, STAMP, STAMP);
  const log = [];
  assert.deepEqual(await runAppointmentExpire(db, AT_0305, (entry) => log.push(entry)), { outcome: "ok", deleted: 2000, rounds: 4, backlog: true });
  assert.deepEqual(log, [{ event: "appointment_expire", level: "warn", code: "APPOINTMENT_EXPIRE_BACKLOG", deleted: 2000, left: true }]);

  const cronLog = [];
  const outcome = await runRealpriceCron({ WORK_DB: db }, { now: () => AT_0305, log: (entry) => cronLog.push(entry) });
  assert.equal(outcome.outcome, "disabled");
  assert.deepEqual([ids(database), cronLog.filter((entry) => entry.event === "appointment_expire")], [[], [{ event: "appointment_expire", deleted: 1, left: false }]]);
});

// ── 1년 넘게 지난 날짜 막기(2026-11-26 09:52:45 사용자 답 "막고 까닭을 알림") ──────────────────────
const EXPIRED_MESSAGE = "1년 넘게 지난 날짜는 자동으로 지워져 넣을 수 없습니다. 날짜를 확인해 주세요.";
const LATER = Date.parse("2026-11-25T05:00:00.000Z"); // 한국 2026-11-25 14:00, 기준일 2025-11-25
const expiredOf = (result) => [result.status, result.json.error?.code, result.json.error?.message, result.json.error?.retryable, result.json.error?.details];

test("1년 막기 순수 함수: 반복 없음은 시작일, 끝 있는 반복은 끝나는 날을 기준일과 견주고(같은 날은 통과), 끝 없는 반복은 늘 통과. 서버는 화면과 같은 기준일 함수를 다시 내보낸다", () => {
  assert.equal(rulesCutoffDate, appointmentCutoffDate);
  assert.equal(rulesCutoffDate(NOW), "2025-11-17");
  for (const [state, expected] of [
    [{ startsOn: "2025-11-16", repeatRule: "none", repeatUntil: null }, ["startsOn"]],
    [{ startsOn: "2025-11-17", repeatRule: "none", repeatUntil: null }, null],
    [{ startsOn: "2025-01-07", repeatRule: "weekly", repeatUntil: "2025-11-16" }, ["repeatUntil"]],
    [{ startsOn: "2025-01-07", repeatRule: "weekly", repeatUntil: "2025-11-17" }, null],
    [{ startsOn: "2020-01-01", repeatRule: "yearly", repeatUntil: null }, null],
    [{ startsOn: "2020-01-01", repeatRule: "monthly" }, null],
  ]) assert.deepEqual(appointmentDateExpired(state, "2025-11-17"), expected, JSON.stringify(state));
});

test("1년 막기 만들기: 기준일 앞 시작일·끝나는 날은 400 APPOINTMENT_DATE_EXPIRED(칸 이름, 다시 시도 안 함), 기준일 당일·끝 없는 옛 반복은 201. 형식 오류가 먼저, 막힌 줄은 저장·감사 없음", async () => {
  const { database, env } = setup();
  assert.deepEqual(expiredOf(await create(env, { startsOn: "2025-11-16" })), [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["startsOn"]]);
  assert.deepEqual(expiredOf(await create(env, { startsOn: "2025-01-07", repeatRule: "weekly", repeatUntil: "2025-11-16" })),
    [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["repeatUntil"]]);
  const wrong = await create(env, { startsOn: "2025-11-16", endTime: "10:00" });
  assert.deepEqual([wrong.status, wrong.json.error.code, wrong.json.error.details], [400, "VALIDATION_FAILED", ["startTime"]]);
  assert.equal(rows(database, "SELECT COUNT(*) AS n FROM appointments")[0].n, 0);
  for (const body of [{ startsOn: "2025-11-17" }, { startsOn: "2025-01-07", repeatRule: "weekly", repeatUntil: "2025-11-17" }, { startsOn: "2024-01-02", repeatRule: "weekly" }]) {
    assert.equal((await create(env, body)).status, 201, JSON.stringify(body));
  }
  assert.deepEqual(audits(database).map((row) => row.action), ["appointment.create", "appointment.create", "appointment.create"]);
});

test("1년 막기 고치기: 날짜·반복을 바꿀 때와 '이 날만'·'이 날부터 모두'로 새로 생기는 줄만 보고, 제목만 고치기·지우기는 옛 줄이어도 막지 않는다. 막히면 원래 줄은 그대로", async () => {
  const { database, env } = setup();
  const later = (id, body, method = "PATCH") => work(env, `/appointments/${id}`, { method, body, now: LATER });
  const single = (await create(env, { startsOn: "2025-11-20" })).json.data.appointment;
  assert.equal((await later(single.id, { version: 1, title: "가상 제목만" })).status, 200);
  assert.deepEqual(expiredOf(await later(single.id, { version: 2, startsOn: "2025-11-21" })), [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["startsOn"]]);
  assert.equal(apptRow(database, single.id).version, 2);
  assert.equal((await later(single.id, { version: 2, startsOn: "2025-11-25" })).status, 200);

  const series = (await create(env, { startsOn: "2025-11-04", repeatRule: "weekly" })).json.data.appointment; // 끝 없는 매주
  assert.deepEqual(expiredOf(await later(series.id, { version: 1, scope: "one", occurrenceOn: "2025-11-11", title: "가상 하루" })),
    [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["startsOn"]]);
  assert.deepEqual([apptRow(database, series.id).version, apptRow(database, series.id).skip_dates], [1, "[]"]);
  const moved = await later(series.id, { version: 1, scope: "one", occurrenceOn: "2025-11-11", startsOn: "2025-12-01" });
  assert.deepEqual([moved.status, moved.json.data.appointment.startsOn], [201, "2025-12-01"]);
  assert.deepEqual(expiredOf(await later(series.id, { version: 2, scope: "following", occurrenceOn: "2025-11-18", repeatUntil: "2025-11-24" })),
    [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["repeatUntil"]]);
  const split = await later(series.id, { version: 2, scope: "following", occurrenceOn: "2025-11-18", title: "가상 뒤" });
  assert.deepEqual([split.status, split.json.data.series.repeatUntil, split.json.data.appointment.repeatUntil], [201, "2025-11-17", null]);
  // 원래 줄은 이제 2025-11-17에 끝나 1년이 지났다. 첫날 그 자리 고치기에서 제목만이면 통과, 끝나는 날을 바꾸면 막는다.
  assert.equal((await later(series.id, { version: 3, scope: "following", occurrenceOn: "2025-11-04", title: "가상 앞" })).status, 200);
  assert.deepEqual(expiredOf(await later(series.id, { version: 4, scope: "following", occurrenceOn: "2025-11-04", repeatRule: "monthly" })),
    [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["repeatUntil"]]);
  assert.deepEqual(expiredOf(await later(series.id, { version: 4, scope: "following", occurrenceOn: "2025-11-04", repeatUntil: "2025-11-10" })),
    [400, "APPOINTMENT_DATE_EXPIRED", EXPIRED_MESSAGE, false, ["repeatUntil"]]);
  assert.equal(apptRow(database, series.id).repeat_until, "2025-11-17");
  assert.equal((await later(single.id, {}, "DELETE")).status, 200);
  assert.equal((await later(series.id, { version: 4, scope: "following", occurrenceOn: "2025-11-04" }, "DELETE")).status, 200);
});
