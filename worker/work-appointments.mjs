// 업무 도구 거래 없는 일정 API와 달력 한 달 읽기(설계서 6.15절, 0009 appointments). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// - 반복은 저장하지 않고 읽을 때 펼친다(src/lib/work/appointment-repeat.mjs, 화면과 같은 함수).
// - 반복 줄 하루 고치기·지우기(2026-11-25 사용자 답 23:32:21 "이 날만 / 이 날부터 모두", 지난 날은 건드리지 않음):
//   '이 날만'은 원래 줄의 뺀 날(skip_dates)에 그날을 더하고, 고치기면 반복 없는 새 줄(series_id·series_on)을 만든다.
//   '이 날부터 모두'는 원래 줄을 그 전날에 끝내고(끝나는 날 줄이기), 고치기면 그날부터 새 반복 줄을 만든다.
//   줄인 뒤 원래 줄에 보이는 날이 하나도 남지 않으면(그날이 처음 보이는 날) 원래 줄 전체를 고치거나 지운다.
// - 지우기는 모두 휴지통(0007·0009)으로 옮긴다. 반복 줄을 줄일 때는 줄이기 전 끝나는 날·뺀 날을 'appt_series'로 적어 되살릴 수 있게 한다.
// - 일정 제목에는 손님 이름이 들어갈 수 있다. 감사 reason·로그·주소에 넣지 않는다(reason은 처리 코드만).
import { appointmentOccurrences } from "../src/lib/work/appointment-repeat.mjs";
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, changesOf, loadThenAudit, runBatch } from "./work-audit.mjs";
import {
  appointmentStateErrors, invalid, isUuid, koreaDate, parseAppointmentCreate, parseAppointmentDelete, parseAppointmentPatch, parseCalendarQuery,
} from "./work-input.mjs";
import { all, auditBase, maskReason, methodNotAllowed, notFound } from "./work-customers.mjs";
import { trashAppointmentBatchFor, trashLinksSql, trashRowsSql } from "./work-trash.mjs";

export const APPOINTMENT_SKIP_MAX = 366; // 한 반복 줄의 뺀 날 상한
// 달력 한 달 읽기 상한: 표마다 읽는 줄 수, 펼친 항목 합계. 넘으면 앞(날짜 이른 쪽)부터 남기고 truncated.
export const CALENDAR_ROW_LIMIT = 500;
export const CALENDAR_ITEM_LIMIT = 1500;
const FAR_DATE = "9999-12-31";

const COLUMNS = "id, tag, title, starts_on, start_time, end_time, repeat_rule, repeat_until, skip_dates, alarms, series_id, series_on, version, created_at, updated_at";
// 거래의 손님 한 명: 대시보드(work-dashboard.mjs events)와 같은 차례(매수인 → 임차인 → 매도인 → 임대인 → 그 밖, 같은 역할이면 손님 id 차례).
const DEAL_CUSTOMER = (dealColumn) => "(SELECT p.customer_id FROM deal_parties p WHERE p.deal_id = " + dealColumn
  + " ORDER BY CASE p.role WHEN 'buyer' THEN 0 WHEN 'tenant' THEN 1 WHEN 'seller' THEN 2 WHEN 'landlord' THEN 3 ELSE 4 END, p.customer_id LIMIT 1)";

const SQL = Object.freeze({
  byId: "SELECT " + COLUMNS + " FROM appointments WHERE id = ?",
  insert:
    "INSERT INTO appointments (id, tag, title, starts_on, start_time, end_time, repeat_rule, repeat_until, skip_dates, alarms, series_id, series_on, version,"
    + " created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  // 고치기는 합친 최종 상태를 통째로 쓴다(series_id·series_on은 바꾸지 않음).
  update:
    "UPDATE appointments SET tag = ?, title = ?, starts_on = ?, start_time = ?, end_time = ?, repeat_rule = ?, repeat_until = ?, skip_dates = ?, alarms = ?,"
    + " version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  // 반복 줄 줄이기('이 날만' 뺀 날 더하기, '이 날부터 모두' 끝나는 날 줄이기).
  trim: "UPDATE appointments SET repeat_until = ?, skip_dates = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(설계서 8.5절).
  versionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM appointments WHERE id = ? AND version = ?) THEN json('guard') ELSE 1 END AS ok",
  existsGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM appointments WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  // '이 날부터 모두' 고치기: 그날 이후의 '이 날만 고친' 줄을 새 반복 줄에 붙인다.
  moveExceptions: "UPDATE appointments SET series_id = ?, version = version + 1, updated_at = ? WHERE series_id = ? AND series_on >= ?",
  delete: "DELETE FROM appointments WHERE id = ?",
  deleteExceptions: "DELETE FROM appointments WHERE series_id = ?",
  deleteExceptionsFrom: "DELETE FROM appointments WHERE series_id = ? AND series_on >= ?",
  // 휴지통: 지우는 문장마다 바로 앞에 같은 WHERE의 복사 문장(첫 ?는 묶음 id).
  trashOne: trashRowsSql("appointments", "id = ?"),
  trashExceptions: trashRowsSql("appointments", "series_id = ?"),
  trashExceptionsFrom: trashRowsSql("appointments", "series_id = ? AND series_on >= ?"),
  trashSeries: trashLinksSql("appt_series", "id = ?"),
  // 달력 한 달 읽기. 거래 일정: 취소한 거래는 빼고 끝낸 일정은 넣는다.
  calendarEvents:
    "SELECT x.*, c.display_name AS customer_name FROM ("
    + "SELECT e.id, e.kind, e.title, e.due_on, e.done_at, e.deal_id, d.title AS deal_title, d.status AS deal_status, " + DEAL_CUSTOMER("e.deal_id") + " AS customer_id"
    + " FROM deal_events e JOIN deals d ON d.id = e.deal_id WHERE d.status <> 'cancelled' AND e.due_on >= ? AND e.due_on <= ? ORDER BY e.due_on, e.id LIMIT ?"
    + ") x LEFT JOIN customers c ON c.id = x.customer_id ORDER BY x.due_on, x.id",
  // 할 일: 날짜가 범위 안인 것(열린 것·끝낸 것 모두). 반복 할 일은 다음 줄 하나만 있으므로 펼치지 않는다.
  calendarTasks:
    "SELECT x.*, c.display_name AS customer_name FROM ("
    + "SELECT t.id, t.title, t.due_on, t.done_at, t.repeat_rule, t.deal_id, d.title AS deal_title, d.status AS deal_status, "
    + "CASE WHEN t.deal_id IS NULL THEN NULL ELSE " + DEAL_CUSTOMER("t.deal_id") + " END AS customer_id"
    + " FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id WHERE t.due_on >= ? AND t.due_on <= ? ORDER BY t.due_on, t.id LIMIT ?"
    + ") x LEFT JOIN customers c ON c.id = x.customer_id ORDER BY x.due_on, x.id",
  // 거래 없는 일정: 범위 안에 날이 생길 수 있는 줄(반복 없음은 시작일이 범위 안, 반복은 시작일 ≤ 끝 날이고 끝나는 날이 없거나 ≥ 첫 날).
  calendarAppointments:
    "SELECT " + COLUMNS + " FROM appointments WHERE starts_on <= ?"
    + " AND ((repeat_rule = 'none' AND starts_on >= ?) OR (repeat_rule <> 'none' AND (repeat_until IS NULL OR repeat_until >= ?)))"
    + " ORDER BY starts_on, id LIMIT ?",
});

function parseList(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function appointmentView(row) {
  return {
    id: row.id,
    tag: row.tag,
    title: row.title,
    startsOn: row.starts_on,
    startTime: row.start_time,
    endTime: row.end_time,
    repeatRule: row.repeat_rule,
    repeatUntil: row.repeat_until,
    skipDates: parseList(row.skip_dates),
    alarms: parseList(row.alarms),
    seriesId: row.series_id,
    seriesOn: row.series_on,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 저장된 줄 → 반복을 펼칠 때 쓰는 모양(appointmentOccurrences 입력)
const repeatOf = (view) => ({ startsOn: view.startsOn, repeatRule: view.repeatRule, repeatUntil: view.repeatUntil, skipDates: view.skipDates });

async function loadAppointment(db, id) {
  const row = await db.prepare(SQL.byId).bind(id).first();
  return row ? appointmentView(row) : null;
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

function skipLimitReached() {
  return new WorkApiError("SKIP_LIMIT_REACHED", "이 반복은 뺀 날이 너무 많습니다. '이 날부터 모두'로 나눠 주세요.", 409);
}

const reasonOf = (parts) => {
  const reason = parts.filter(Boolean).join(" ");
  return reason === "" ? null : reason;
};

// 반복을 '없음'으로 바꾸면 끝나는 날·뺀 날을 함께 비운다(0009 CHECK, 반복 없는 줄은 둘 다 없음).
function normalize(state) {
  return state.repeatRule === "none" ? { ...state, repeatUntil: null, skipDates: [] } : state;
}

function assertState(state) {
  const wrong = appointmentStateErrors(state);
  if (wrong.length > 0) throw invalid(wrong);
}

const sortDates = (dates) => [...new Set(dates)].sort();
// 보이는 날이 하나라도 있는지(끝나는 날이 없으면 늘 있음으로 본다: 끝 없는 반복은 뺀 날 366개로 다 막을 수 없음).
const hasVisibleDay = (view) => view.repeatUntil === null || appointmentOccurrences(repeatOf(view), view.startsOn, view.repeatUntil, { limit: 1 }).length > 0;
// 반복 줄을 그날 전날로 줄인 모양. 그날이 시작일이거나 줄인 뒤 보이는 날이 없으면 null(원래 줄 전체가 대상).
function trimmedBefore(view, on) {
  if (on <= view.startsOn) return null;
  const until = new Date(Date.parse(`${on}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const trimmed = { ...view, repeatUntil: until, skipDates: view.skipDates.filter((date) => date < on) };
  return hasVisibleDay(trimmed) ? trimmed : null;
}

function updateStatement(db, id, version, state, at) {
  return db.prepare(SQL.update).bind(
    state.tag, state.title, state.startsOn, state.startTime, state.endTime, state.repeatRule, state.repeatUntil,
    JSON.stringify(state.skipDates), JSON.stringify(state.alarms), at, id, version,
  );
}

function insertStatement(db, id, state, at, series = null) {
  return db.prepare(SQL.insert).bind(
    id, state.tag, state.title, state.startsOn, state.startTime, state.endTime, state.repeatRule, state.repeatUntil,
    JSON.stringify(state.skipDates), JSON.stringify(state.alarms), series?.id ?? null, series?.on ?? null, at, at,
  );
}

// batch를 돌리고, 되돌려졌으면 까닭을 다시 읽어 404·409로 바꾼다.
async function runGuarded(ctx, id, version, statements) {
  try {
    await runBatch(ctx.db, statements);
  } catch (error) {
    const latest = await loadAppointment(ctx.db, id);
    if (!latest) throw notFound();
    if (version !== null && latest.version !== version) throw versionConflict();
    throw error;
  }
}

async function createAppointment(ctx) {
  const { appointment, rrnMasked } = parseAppointmentCreate(ctx.body);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  await runBatch(ctx.db, [
    insertStatement(ctx.db, id, { ...appointment, skipDates: [] }, at),
    auditStatement(ctx.db, { ...auditBase(ctx, "appointment.create", {
      targetType: "appointment", targetId: id, reason: reasonOf([`repeat=${appointment.repeatRule}`, maskReason(rrnMasked)]),
    }), outcome: "ok" }),
  ]);
  return { status: 201, data: { appointment: await loadAppointment(ctx.db, id) } };
}

// 반복 줄의 그날 확인: 범위·뺀 날까지 본 실제로 보이는 날이어야 한다.
function assertOccurrence(view, on) {
  if (appointmentOccurrences(repeatOf(view), on, on).length !== 1) throw invalid(["occurrenceOn"]);
}

async function updateAppointment(ctx, id) {
  const input = parseAppointmentPatch(ctx.body);
  const current = await loadAppointment(ctx.db, id);
  if (!current) throw notFound();
  if (current.version !== input.version) throw versionConflict();
  const repeating = current.repeatRule !== "none";
  if (!repeating && input.scope !== null) throw invalid(["scope"]);
  if (repeating && input.scope === null) throw invalid(["scope"]);
  const at = new Date(ctx.now).toISOString();
  const merged = { ...current, ...input.changes };
  const audit = (scope) => auditStatement(ctx.db, { ...auditBase(ctx, "appointment.update", {
    targetType: "appointment", targetId: id, reason: reasonOf([`scope=${scope}`, maskReason(input.rrnMasked)]),
  }), outcome: "ok" });

  // 이 날만: 원래 줄에 그날을 빼고, 반복 없는 새 줄을 그날(또는 보낸 날짜)에 만든다.
  if (input.scope === "one") {
    assertOccurrence(current, input.occurrenceOn);
    const wrongScope = ["repeatRule", "repeatUntil"].filter((key) => key in input.changes);
    if (wrongScope.length > 0) throw invalid(wrongScope);
    const single = { ...merged, startsOn: input.changes.startsOn ?? input.occurrenceOn, repeatRule: "none", repeatUntil: null, skipDates: [] };
    assertState(single);
    if (current.skipDates.length >= APPOINTMENT_SKIP_MAX) throw skipLimitReached();
    const newId = ctx.randomUUID();
    await runGuarded(ctx, id, input.version, [
      ctx.db.prepare(SQL.versionGuard).bind(id, input.version),
      ctx.db.prepare(SQL.trim).bind(current.repeatUntil, JSON.stringify(sortDates([...current.skipDates, input.occurrenceOn])), at, id, input.version),
      insertStatement(ctx.db, newId, single, at, { id, on: input.occurrenceOn }),
      audit("one"),
    ]);
    return { status: 201, data: { appointment: await loadAppointment(ctx.db, newId), series: await loadAppointment(ctx.db, id) } };
  }

  // 이 날부터 모두: 그날 전날로 줄이고 새 반복 줄을 만든다. 줄일 것이 없으면(처음 보이는 날) 원래 줄 전체를 고친다.
  if (input.scope === "following") {
    assertOccurrence(current, input.occurrenceOn);
    const trimmed = trimmedBefore(current, input.occurrenceOn);
    if (trimmed !== null) {
      const next = normalize({
        ...merged,
        startsOn: input.changes.startsOn ?? input.occurrenceOn,
        skipDates: current.skipDates.filter((date) => date >= input.occurrenceOn),
      });
      assertState(next);
      const newId = ctx.randomUUID();
      await runGuarded(ctx, id, input.version, [
        ctx.db.prepare(SQL.versionGuard).bind(id, input.version),
        ctx.db.prepare(SQL.trim).bind(trimmed.repeatUntil, JSON.stringify(trimmed.skipDates), at, id, input.version),
        insertStatement(ctx.db, newId, next, at),
        ctx.db.prepare(SQL.moveExceptions).bind(newId, at, id, input.occurrenceOn),
        audit("following"),
      ]);
      return { status: 201, data: { appointment: await loadAppointment(ctx.db, newId), series: await loadAppointment(ctx.db, id) } };
    }
  }

  // 반복 없는 줄 고치기, 또는 반복 줄 전체 고치기.
  const state = normalize(merged);
  if (current.seriesId !== null && state.repeatRule !== "none") throw invalid(["repeatRule"]); // '이 날만 고친' 줄은 반복이 될 수 없음(0009 CHECK)
  assertState(state);
  await runGuarded(ctx, id, input.version, [
    ctx.db.prepare(SQL.versionGuard).bind(id, input.version),
    updateStatement(ctx.db, id, input.version, state, at),
    audit(repeating ? "all" : "none"),
  ]);
  return { data: { appointment: await loadAppointment(ctx.db, id) } };
}

// 휴지통 묶음 이름의 날짜 꼬리(" · 12월 10일"). 한국 날짜 글자를 그대로 읽는다.
const dateTail = (on) => ` · ${Number(on.slice(5, 7))}월 ${Number(on.slice(8, 10))}일`;

async function deleteAppointment(ctx, id) {
  const input = parseAppointmentDelete(ctx.body);
  const current = await loadAppointment(ctx.db, id);
  if (!current) throw notFound();
  const repeating = current.repeatRule !== "none";
  if (!repeating && input !== null) throw invalid(["scope"]);
  if (repeating && input === null) throw invalid(["scope"]);
  if (input !== null && current.version !== input.version) throw versionConflict();
  const at = new Date(ctx.now).toISOString();
  const audit = (scope) => auditStatement(ctx.db, { ...auditBase(ctx, "appointment.delete", {
    targetType: "appointment", targetId: id, reason: `scope=${scope}`,
  }), outcome: "ok" });

  let scope = repeating ? "all" : "none";
  let trimmed = null;
  if (input !== null) {
    assertOccurrence(current, input.occurrenceOn);
    if (input.scope === "one") {
      const skipped = { ...current, skipDates: sortDates([...current.skipDates, input.occurrenceOn]) };
      // 끝나는 날이 있는 반복에서 마지막 보이는 날을 빼면 원래 줄 전체를 지운다(보이지 않는 줄을 남기지 않음).
      if (hasVisibleDay(skipped)) {
        if (current.skipDates.length >= APPOINTMENT_SKIP_MAX) throw skipLimitReached();
        trimmed = skipped;
        scope = "one";
      }
    } else {
      trimmed = trimmedBefore(current, input.occurrenceOn);
      if (trimmed !== null) scope = "following";
    }
  }

  // 반복 줄의 하루·그날부터: 줄이기 전 값을 적고(appt_series) 줄인다. '이 날부터 모두'는 그날 이후 '이 날만 고친' 줄도 지운다.
  if (trimmed !== null) {
    const trash = trashAppointmentBatchFor(ctx, id, dateTail(input.occurrenceOn) + (scope === "one" ? "" : "부터"));
    const statements = [
      ctx.db.prepare(SQL.versionGuard).bind(id, input.version),
      audit(scope),
      trash.statement,
      ctx.db.prepare(SQL.trashSeries).bind(trash.batchId, id),
      ctx.db.prepare(SQL.trim).bind(trimmed.repeatUntil, JSON.stringify(trimmed.skipDates), at, id, input.version),
    ];
    if (scope === "following") {
      statements.push(
        ctx.db.prepare(SQL.trashExceptionsFrom).bind(trash.batchId, id, input.occurrenceOn),
        ctx.db.prepare(SQL.deleteExceptionsFrom).bind(id, input.occurrenceOn),
      );
    }
    await runGuarded(ctx, id, input.version, statements);
    return { data: { deleted: true, trash: trash.trash } };
  }

  // 줄 전체: 반복 줄이면 그 반복의 '이 날만 고친' 줄도 모두 함께 지운다. 반복 없는 줄(고친 줄 포함)은 자기만 지운다
  // (고친 줄을 지우면 원래 반복의 뺀 날은 그대로라 그날은 비어 보인다).
  const version = input?.version ?? null;
  const trash = trashAppointmentBatchFor(ctx, id, "");
  const statements = [
    version === null ? ctx.db.prepare(SQL.existsGuard).bind(id) : ctx.db.prepare(SQL.versionGuard).bind(id, version),
    audit(scope),
    trash.statement,
    ctx.db.prepare(SQL.trashOne).bind(trash.batchId, id),
  ];
  if (repeating) {
    statements.push(
      ctx.db.prepare(SQL.trashExceptions).bind(trash.batchId, id),
      ctx.db.prepare(SQL.deleteExceptions).bind(id),
    );
  }
  statements.push(ctx.db.prepare(SQL.delete).bind(id));
  await runGuarded(ctx, id, version, statements);
  return { data: { deleted: true, trash: trash.trash } };
}

// ── 달력 한 달 읽기 ──────────────────────────────────────────────────────

const customerOf = (row) => (row.customer_id === null || row.customer_id === undefined ? null : { id: row.customer_id, displayName: row.customer_name ?? "" });
// 정렬: 날짜 → 하루 종일(시각 없음) 먼저 → 시작 시각 → key.
function compareItems(left, right) {
  if (left.on !== right.on) return left.on < right.on ? -1 : 1;
  const leftTime = left.startTime ?? "";
  const rightTime = right.startTime ?? "";
  if (leftTime !== rightTime) return leftTime < rightTime ? -1 : 1;
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

export async function loadCalendarRange(db, from, to) {
  const [events, tasks, appointments] = await Promise.all([
    all(db.prepare(SQL.calendarEvents).bind(from, to, CALENDAR_ROW_LIMIT + 1)),
    all(db.prepare(SQL.calendarTasks).bind(from, to, CALENDAR_ROW_LIMIT + 1)),
    all(db.prepare(SQL.calendarAppointments).bind(to, from, from, CALENDAR_ROW_LIMIT + 1)),
  ]);
  let truncated = events.length > CALENDAR_ROW_LIMIT || tasks.length > CALENDAR_ROW_LIMIT || appointments.length > CALENDAR_ROW_LIMIT;
  const items = [];
  for (const row of events.slice(0, CALENDAR_ROW_LIMIT)) {
    items.push({
      key: `deal-${row.id}`, source: "deal", id: row.id, on: row.due_on, kind: row.kind, title: row.title,
      startTime: null, endTime: null, done: row.done_at !== null,
      deal: { id: row.deal_id, title: row.deal_title, status: row.deal_status }, customer: customerOf(row),
    });
  }
  for (const row of tasks.slice(0, CALENDAR_ROW_LIMIT)) {
    items.push({
      key: `task-${row.id}`, source: "task", id: row.id, on: row.due_on, title: row.title, repeat: row.repeat_rule,
      startTime: null, endTime: null, done: row.done_at !== null,
      deal: row.deal_id === null ? null : { id: row.deal_id, title: row.deal_title, status: row.deal_status }, customer: customerOf(row),
    });
  }
  for (const row of appointments.slice(0, CALENDAR_ROW_LIMIT)) {
    const view = appointmentView(row);
    for (const on of appointmentOccurrences(repeatOf(view), from, to)) {
      items.push({
        key: `appt-${view.id}-${on.replaceAll("-", "")}`, source: "appointment", id: view.id, on, title: view.title,
        startTime: view.startTime, endTime: view.endTime, done: false, deal: null, customer: null, appointment: view,
      });
    }
  }
  items.sort(compareItems);
  if (items.length > CALENDAR_ITEM_LIMIT) truncated = true;
  return { from, to, truncated, items: items.slice(0, CALENDAR_ITEM_LIMIT) };
}

async function readCalendar(ctx) {
  const { from, to } = parseCalendarQuery(ctx.url.searchParams);
  return loadThenAudit(ctx.db, async () => ({ ...(await loadCalendarRange(ctx.db, from, to)), today: koreaDate(ctx.now) }),
    (data) => auditBase(ctx, "calendar.view", { reason: `result_count=${data.items.length}` }));
}

// ── 1년 지난 일정 자동 삭제(03:00 차례, work-scheduled.mjs runAppointmentExpire) ─────────────────
// 2026-11-26 사용자 답(대장 전달): 날짜가 지난 지 1년 뒤 매일 03:00 정리에서 지운다. 반복 일정은 반복이 끝난 것(끝나는 날이 1년 지난 것)만,
// 끝 없는 반복은 남긴다. 휴지통을 거치지 않고 바로 지운다(감사 기록 3년 삭제와 같은 방식, 1년 지난 자료라 7일 안에 되살릴 일이 드묾).
// - 1년은 한국 날짜에서 해만 1 뺀 글자다. 2월 29일이면 '그 전해 02-29' 글자가 되어 02-28까지 지우고 03-01은 남긴다(덜 지우는 쪽).
// - '이 날만 고친' 줄도 반복 없는 줄이라 자기 날짜로 따로 지운다. 원래 반복의 뺀 날은 그대로 두어 그날이 다시 보이지 않게 한다.
// - 지운 일은 감사 로그에 적지 않고, 로그에는 지운 줄 수와 남았는지만 남긴다(제목·id 없음).
export const APPOINTMENT_KEEP_YEARS = 1;
export const APPOINTMENT_EXPIRE_PER_ROUND = 500;
export const APPOINTMENT_EXPIRE_MAX_ROUNDS = 4;
const EXPIRED_WHERE = "(repeat_rule = 'none' AND starts_on < ?1) OR (repeat_rule <> 'none' AND repeat_until IS NOT NULL AND repeat_until < ?1)";
const APPOINTMENT_EXPIRE_SQL = "DELETE FROM appointments WHERE id IN (SELECT id FROM appointments WHERE " + EXPIRED_WHERE + " ORDER BY starts_on, id LIMIT ?2)";
const APPOINTMENT_LEFT_SQL = "SELECT 1 AS n FROM appointments WHERE " + EXPIRED_WHERE + " LIMIT 1";

// 이 날짜보다 앞(starts_on·repeat_until < 이 글자)이면 1년 지난 일정이다.
export function appointmentCutoffDate(nowMs) {
  const today = koreaDate(nowMs);
  return `${String(Number(today.slice(0, 4)) - APPOINTMENT_KEEP_YEARS).padStart(4, "0")}${today.slice(4)}`;
}

export async function expireAppointments(db, nowMs) {
  const cutoff = appointmentCutoffDate(nowMs);
  let deleted = 0;
  for (let round = 1; round <= APPOINTMENT_EXPIRE_MAX_ROUNDS; round += 1) {
    const changes = changesOf(await db.prepare(APPOINTMENT_EXPIRE_SQL).bind(cutoff, APPOINTMENT_EXPIRE_PER_ROUND).run());
    deleted += changes;
    if (changes < APPOINTMENT_EXPIRE_PER_ROUND) return { deleted, rounds: round, backlog: false };
  }
  const left = await db.prepare(APPOINTMENT_LEFT_SQL).bind(cutoff).first();
  return { deleted, rounds: APPOINTMENT_EXPIRE_MAX_ROUNDS, backlog: Boolean(left) };
}

// 경로가 일정(/appointments, /appointments/:id)·달력(/calendar)이면 { status?, data }를, 아니면 null을 돌려준다.
export async function routeWorkAppointments(ctx) {
  const [collection, id, extra] = ctx.route.split("/").filter(Boolean);
  if (extra !== undefined) return null;
  if (collection === "calendar") {
    if (id !== undefined) return null;
    if (ctx.method === "GET") return { data: await readCalendar(ctx) };
    throw methodNotAllowed("GET");
  }
  if (collection !== "appointments") return null;
  if (id === undefined) {
    if (ctx.method === "POST") return createAppointment(ctx);
    throw methodNotAllowed("POST");
  }
  if (!isUuid(id)) throw notFound();
  if (ctx.method === "GET") {
    const appointment = await loadThenAudit(ctx.db, () => loadAppointment(ctx.db, id),
      () => auditBase(ctx, "appointment.view", { targetType: "appointment", targetId: id }));
    if (!appointment) throw notFound();
    return { data: { appointment } };
  }
  if (ctx.method === "PATCH") return updateAppointment(ctx, id);
  if (ctx.method === "DELETE") return deleteAppointment(ctx, id);
  throw methodNotAllowed("GET, PATCH, DELETE");
}
