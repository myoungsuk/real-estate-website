// 달력 화면(/admin/work/calendar/)용 가짜 업무 API(날개-2 API 판 2 모양). 실제 서버·D1은 부르지 않는다.
// 거래 일정·할 일·손님 이름·일정 제목은 모두 지어낸 값(가상숲1단지 등)이다. 반복 펼치기는 서버와 같은 appointment-repeat.mjs를 쓴다.
import { appointmentOccurrences, seriesEndBefore } from "../../src/lib/work/appointment-repeat.mjs";

export const CAL_NOW = new Date("2026-11-18T03:00:00Z"); // 한국 수요일 12:00
export const CAL_TODAY = "2026-11-18";
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code, details = []) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: status >= 500, details }, requestId: "test" } });
const stamp = CAL_NOW.toISOString();

export const DEAL_A = { id: uuid(101), title: "가상숲1단지 84㎡ 매매", status: "contracted" };
export const CUSTOMER_A = { id: uuid(201), displayName: "가상손님매수" };

export const appointment = (n, patch) => ({
  id: uuid(n), tag: "routine", title: `가상 일정 ${n}`, startsOn: CAL_TODAY, startTime: null, endTime: null,
  repeatRule: "none", repeatUntil: null, skipDates: [], alarms: ["day-before-18"], seriesId: null, seriesOn: null,
  version: 1, createdAt: stamp, updatedAt: stamp, ...patch,
});

export function makeAppointments() {
  return [
    appointment(1, { tag: "showing", title: "가상강변 59㎡ 집 보여 주기", startTime: "16:00", endTime: "17:00", alarms: ["hour-before"] }),
    appointment(2, { tag: "routine", title: "가상 사무소 임대료 이체", startsOn: "2026-11-25", repeatRule: "monthly" }),
    appointment(3, { tag: "consult", title: "가상 전세 상담", startsOn: "2026-11-12", startTime: "10:00" }),
    appointment(4, { tag: "tax", title: "가상 비과세 기한 확인", startsOn: "2026-11-27" }),
    appointment(5, { tag: "routine", title: "가상 주간 매물 사진 정리", startsOn: "2026-11-02", repeatRule: "weekly", repeatUntil: "2026-12-28" }),
  ];
}
// 거래 일정·할 일(달력 읽기 응답에 그대로 싣는다)
export function makeOthers() {
  return [
    { key: `deal-${uuid(301)}`, source: "deal", id: uuid(301), on: "2026-11-20", kind: "balance", title: "잔금", startTime: null, endTime: null, done: false, deal: DEAL_A, customer: CUSTOMER_A },
    { key: `deal-${uuid(302)}`, source: "deal", id: uuid(302), on: "2026-11-10", kind: "contract", title: "계약일", startTime: null, endTime: null, done: true, deal: DEAL_A, customer: CUSTOMER_A },
    { key: `deal-${uuid(303)}`, source: "deal", id: uuid(303), on: "2026-11-16", kind: "transaction_report", title: "거래신고", startTime: null, endTime: null, done: false, deal: DEAL_A, customer: CUSTOMER_A },
    { key: `task-${uuid(401)}`, source: "task", id: uuid(401), on: CAL_TODAY, title: "가상 등기부등본 다시 떼기", done: false, repeat: "none", deal: null, customer: null },
    { key: `task-${uuid(402)}`, source: "task", id: uuid(402), on: "2026-11-14", title: "가상 지난 계약서 정리", done: true, repeat: "weekly", deal: null, customer: null },
  ];
}

const compact = (on) => on.replaceAll("-", "");
const FIELDS = ["tag", "title", "startsOn", "startTime", "endTime", "repeatRule", "repeatUntil", "alarms"];
const pickFields = (body) => Object.fromEntries(FIELDS.filter((key) => key in body).map((key) => [key, body[key]]));

/**
 * @param {import("@playwright/test").Page} page
 * @param {{ width?: number, enabled?: boolean, appointments?: any[], others?: any[], truncated?: boolean, conflictOnce?: boolean, schemaOutdated?: boolean }} [options]
 */
export async function setupCalendar(page, { width = 390, height = 900, enabled = true, appointments = makeAppointments(), others = makeOthers(), truncated = false, conflictOnce = false, schemaOutdated = false } = {}) {
  await page.clock.install({ time: CAL_NOW });
  await page.setViewportSize({ width, height });
  const calls = { all: [], writes: [] };
  const trashed = new Map();
  let nextNumber = 900;
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    calls.all.push(`${method} ${path}${url.search}`);
    const body = method === "GET" ? null : request.postDataJSON();
    if (method !== "GET") {
      calls.writes.push({ method, path, body, csrf: request.headers()["x-admin-csrf"] ?? null });
      if (request.headers()["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: "시험 관리자", csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 9 : null }));
    if (!enabled) return route.fulfill(failure(503, "WORK_DISABLED"));
    if (schemaOutdated) return route.fulfill(failure(503, "WORK_SCHEMA_OUTDATED"));

    if (path === "/calendar" && method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const items = others.filter((item) => item.on >= from && item.on <= to);
      for (const appt of appointments) {
        for (const on of appointmentOccurrences(appt, from, to)) {
          items.push({ key: `appt-${appt.id}-${compact(on)}`, source: "appointment", id: appt.id, on, title: appt.title, startTime: appt.startTime, endTime: appt.endTime, done: false, deal: null, customer: null, appointment: structuredClone(appt) });
        }
      }
      items.sort((a, b) => a.on.localeCompare(b.on) || (a.startTime ?? "").localeCompare(b.startTime ?? "") || a.key.localeCompare(b.key));
      return route.fulfill(envelope({ from, to, today: CAL_TODAY, truncated, items }));
    }
    if (path === "/appointments" && method === "POST") {
      if (!body.title || !body.tag || !body.startsOn) return route.fulfill(failure(400, "VALIDATION_FAILED", ["title"]));
      const created = appointment(nextNumber++, { ...pickFields(body), alarms: body.alarms ?? ["day-before-18"] });
      appointments.push(created);
      return route.fulfill(envelope({ appointment: created }, 201));
    }
    const match = path.match(/^\/appointments\/([^/]+)$/u);
    if (match) {
      const index = appointments.findIndex((item) => item.id === decodeURIComponent(match[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const current = appointments[index];
      if (method === "GET") return route.fulfill(envelope({ appointment: current }));
      const repeating = current.repeatRule !== "none";
      if (method === "PATCH") {
        if (conflictOnce || body.version !== current.version) {
          conflictOnce = false;
          appointments[index] = { ...current, title: "가상 다른 화면에서 고친 일정", version: current.version + 1 };
          return route.fulfill(failure(409, "VERSION_CONFLICT"));
        }
        if (!repeating && body.scope) return route.fulfill(failure(400, "VALIDATION_FAILED", ["scope"]));
        if (repeating && !(body.scope && body.occurrenceOn)) return route.fulfill(failure(400, "VALIDATION_FAILED", ["scope"]));
        const changes = pickFields(body);
        if (!repeating || (body.scope === "following" && body.occurrenceOn === current.startsOn)) {
          appointments[index] = { ...current, ...changes, version: current.version + 1, updatedAt: stamp };
          return route.fulfill(envelope({ appointment: appointments[index] }));
        }
        if (body.scope === "one") {
          if ("repeatRule" in body || "repeatUntil" in body) return route.fulfill(failure(400, "VALIDATION_FAILED", ["repeatRule"]));
          const series = { ...current, skipDates: [...current.skipDates, body.occurrenceOn].sort(), version: current.version + 1 };
          const created = appointment(nextNumber++, { ...current, ...changes, id: uuid(nextNumber - 1), startsOn: changes.startsOn ?? body.occurrenceOn, repeatRule: "none", repeatUntil: null, skipDates: [], seriesId: current.id, seriesOn: body.occurrenceOn, version: 1 });
          appointments[index] = series;
          appointments.push(created);
          return route.fulfill(envelope({ appointment: created, series }, 201));
        }
        const series = { ...current, repeatUntil: seriesEndBefore(current.startsOn, body.occurrenceOn), skipDates: current.skipDates.filter((on) => on < body.occurrenceOn), version: current.version + 1 };
        const created = appointment(nextNumber++, { ...current, ...changes, id: uuid(nextNumber - 1), startsOn: changes.startsOn ?? body.occurrenceOn, skipDates: current.skipDates.filter((on) => on >= body.occurrenceOn), version: 1 });
        appointments[index] = series;
        appointments.push(created);
        return route.fulfill(envelope({ appointment: created, series }, 201));
      }
      if (method === "DELETE") {
        const batchId = uuid(990 + trashed.size);
        const trash = { batchId, purgeAfter: "2026-11-25T03:00:00.000Z" };
        if (!repeating) {
          if (body && Object.keys(body).length > 0) return route.fulfill(failure(400, "VALIDATION_FAILED", ["scope"]));
          const [removed] = appointments.splice(index, 1);
          trashed.set(batchId, { restore: () => appointments.push(removed) });
          return route.fulfill(envelope({ deleted: true, trash }));
        }
        if (!body?.scope || !body.occurrenceOn || body.version !== current.version) return route.fulfill(failure(400, "VALIDATION_FAILED", ["scope"]));
        const before = structuredClone(current);
        if (body.scope === "one") appointments[index] = { ...current, skipDates: [...current.skipDates, body.occurrenceOn].sort(), version: current.version + 1 };
        else if (body.occurrenceOn === current.startsOn) appointments.splice(index, 1);
        else appointments[index] = { ...current, repeatUntil: seriesEndBefore(current.startsOn, body.occurrenceOn), version: current.version + 1 };
        trashed.set(batchId, { restore: () => {
          const at = appointments.findIndex((item) => item.id === before.id);
          if (at >= 0) appointments[at] = before;
          else appointments.push(before);
        } });
        return route.fulfill(envelope({ deleted: true, trash }));
      }
    }
    const restoreMatch = path.match(/^\/trash\/([^/]+)\/restore$/u);
    if (restoreMatch && method === "POST") {
      const entry = trashed.get(decodeURIComponent(restoreMatch[1]));
      if (!entry) return route.fulfill(failure(404, "NOT_FOUND"));
      trashed.delete(decodeURIComponent(restoreMatch[1]));
      entry.restore();
      return route.fulfill(envelope({ restored: { customers: 0, deals: 0, parties: 0, events: 0, notes: 0, tasks: 0, ledger: 0, links: 0, notesUnlinked: 0, appointments: 1 }, skipped: [], remaining: 0 }));
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return { calls, appointments };
}

export function collectErrors(page, expect) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
