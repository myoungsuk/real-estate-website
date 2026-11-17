// 업무 도구 단계 2 PR-B2: 거래 일정 API(설계서 6.7·6.8·8.2·10.2절). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 법정 기한 계산은 단계 0 화면과 같은 함수(buildContractSchedule)와 같은 법령 데이터(legal-rules.json)를 그대로 쓴다.
import legalRules from "../src/data/work/legal-rules.json" with { type: "json" };
import { buildContractSchedule } from "../src/lib/work/legal-dates.mjs";
import { cleanSingleLine } from "../src/lib/work/work-format.mjs";
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, loadThenAudit, runBatch } from "./work-audit.mjs";
import { invalid, isUuid, koreaDate, parseCalculate, parseEventCreate, parseEventPatch } from "./work-input.mjs";
import { all, auditBase, maskReason, methodNotAllowed, notFound } from "./work-customers.mjs";
import { loadDeal } from "./work-deals.mjs";
import { DEFAULT_ALARM_TRIGGERS, buildDealIcsCalendar, dealIcsFileName } from "./work-calendar.mjs";

// 단계 0 일정 종류(카멜 표기) → deal_events.kind(0001 CHECK 값).
const SCHEDULE_KIND_TO_EVENT = Object.freeze({
  contract: "contract",
  middlePayment: "middle_payment",
  balance: "balance",
  transactionReport: "transaction_report",
  fundingPlanDelivery: "funding_plan_to_agent",
  fundingPlanSeparate: "funding_plan_submit",
  leaseReport: "lease_report",
});
// .ics 설명(법정 문구)을 붙일 일정 종류 → legal-rules.json deadlineRules.kind.
const EVENT_KIND_TO_RULE = Object.freeze({
  transaction_report: "transactionReport",
  funding_plan_to_agent: "fundingPlanDelivery",
  funding_plan_submit: "fundingPlanSeparate",
  lease_report: "leaseReport",
});
const EVENT_KIND_LABELS = Object.freeze({
  contract: "계약일",
  middle_payment: "중도금",
  balance: "잔금",
  transaction_report: "거래신고",
  funding_plan_to_agent: "자금조달계획서 등 전달",
  funding_plan_submit: "자금조달계획서 별도 제출",
  lease_report: "주택 임대차 신고",
  custom: "직접 넣은 일정",
});
const REPORTABLE_KINDS = new Set(["sale", "supply", "status_sale"]);
const LEASE_KINDS = new Set(["jeonse", "monthly_rent"]);

const EVENT_COLUMNS = "id, deal_id, kind, due_on, title, alarm_offsets, source, done_at, version, created_at, updated_at";
const SQL = Object.freeze({
  dealEvents: "SELECT " + EVENT_COLUMNS + " FROM deal_events WHERE deal_id = ? ORDER BY due_on, id",
  dealOpenEvents: "SELECT " + EVENT_COLUMNS + " FROM deal_events WHERE deal_id = ? AND done_at IS NULL ORDER BY due_on, id",
  eventById: "SELECT " + EVENT_COLUMNS + " FROM deal_events WHERE id = ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(설계서 8.5절).
  dealVersionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deals WHERE id = ? AND version = ?) THEN json('guard') ELSE 1 END AS ok",
  dealExistsGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deals WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  eventVersionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deal_events WHERE id = ? AND version = ?) THEN json('guard') ELSE 1 END AS ok",
  eventExistsGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deal_events WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  // 다시 계산(D4): 끝나지 않은 자동 계산 일정(source='calculated', done_at 없음)만 새 계산값으로 바꾼다.
  // 남기는 일정: 사용자 일정(manual·ai_confirmed)과 완료한 자동 일정(날짜·완료 그대로, 기록이 사실과 달라지지 않게).
  // 남기는 일정이 있는 종류는 바꾸지도 새로 넣지도 않는다.
  // ① 지우기(끝나지 않은 자동 일정만): 새 계산에 없는 종류이거나, 같은 종류에 남기는 일정이 있는 것.
  //    종류 목록은 JSON 배열 하나로 bind한다(고정 SQL). 완료한 자동 일정은 계산에서 빠진 종류여도 기록으로 남긴다.
  calculatedPrune:
    "DELETE FROM deal_events WHERE deal_id = ? AND source = 'calculated' AND done_at IS NULL"
    + " AND (kind NOT IN (SELECT value FROM json_each(?))"
    + " OR EXISTS (SELECT 1 FROM deal_events AS kept WHERE kept.deal_id = deal_events.deal_id AND kept.kind = deal_events.kind"
    + " AND (kept.source <> 'calculated' OR kept.done_at IS NOT NULL)))",
  // ② 남은 끝나지 않은 자동 일정은 그 자리에서 날짜·제목만 고친다(id·알림 유지 → .ics UID도 같음).
  calculatedUpdate:
    "UPDATE deal_events SET due_on = ?, title = ?, version = version + 1, updated_at = ?"
    + " WHERE deal_id = ? AND kind = ? AND source = 'calculated' AND done_at IS NULL AND (due_on <> ? OR title <> ?)",
  // ③ 그 종류의 일정이 하나도 없을 때만 새로 넣는다.
  calculatedInsert:
    "INSERT INTO deal_events (" + EVENT_COLUMNS + ")"
    + " SELECT ?, ?, ?, ?, ?, ?, 'calculated', NULL, 1, ?, ?"
    + " WHERE NOT EXISTS (SELECT 1 FROM deal_events WHERE deal_id = ? AND kind = ?)",
  customInsert: "INSERT INTO deal_events (" + EVENT_COLUMNS + ") VALUES (?, ?, 'custom', ?, ?, ?, 'manual', NULL, 1, ?, ?)",
  // 고치기: 자동 계산 일정의 날짜·제목을 직접 고치면 사용자 일정(manual)이 되어 다시 계산이 건드리지 않는다(D4).
  // 완료 표시·알림만 바꾸면 출처는 자동 그대로다. 완료한 동안은 다시 계산이 건드리지 않고, 완료를 풀면 다시 새 날짜로 계산된다.
  // 알림만 바꾼 끝나지 않은 자동 일정은 다시 계산 때 새 날짜로 바뀌면서 알림을 이어받는다.
  eventUpdate:
    "UPDATE deal_events SET due_on = coalesce(?, due_on), title = coalesce(?, title), alarm_offsets = coalesce(?, alarm_offsets),"
    + " done_at = CASE WHEN ? = 1 THEN ? ELSE done_at END, source = CASE WHEN source = 'calculated' AND ? = 1 THEN 'manual' ELSE source END,"
    + " version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  eventDelete: "DELETE FROM deal_events WHERE id = ?",
});

function eventView(row) {
  return {
    id: row.id,
    dealId: row.deal_id,
    kind: row.kind,
    dueOn: row.due_on,
    title: row.title,
    alarmOffsets: JSON.parse(row.alarm_offsets),
    source: row.source,
    doneAt: row.done_at,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function loadEvent(db, id) {
  return (await db.prepare(SQL.eventById).bind(id).first()) ?? null;
}

async function loadDealEvents(db, dealId) {
  return (await all(db.prepare(SQL.dealEvents).bind(dealId))).map(eventView);
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

// 거래 칸을 단계 0 일정 계산 입력으로 옮긴다(0002 칸 포함). 오피스텔은 거래마다 고른 일정 판정(주택·그 밖)을 쓴다.
function scheduleInput(row) {
  return {
    dealKind: row.deal_type === "sale" ? (row.sale_kind ?? "sale") : row.deal_type,
    target: row.property_kind === "officetel" ? row.schedule_target : row.property_kind,
    regulation: row.regulation,
    contractDate: row.contract_on,
    middlePaymentDate: row.middle_payment_on,
    balanceDate: row.balance_on,
    propertyLabel: row.property_label,
    priceWon: row.price_won,
    depositWon: row.deposit_won,
    monthlyRentWon: row.monthly_rent_won,
    buyerType: row.buyer_is_corporation === 1 ? "corporation" : "individual",
    landPermitArea: row.land_permit_area === 1,
    capitalAreaEtc: row.metro_area === 1,
    landShare: row.land_share === 1,
    separateFundingSubmission: row.separate_funding_submission === 1,
    reportingRegion: row.lease_reporting_region === 1,
    renewalWithoutChange: row.lease_renewal_without_change === 1,
  };
}

// 계산 전에 비어 있으면 안 되는 거래 칸을 칸 이름으로 알린다(계산 함수의 오류 문구는 어느 칸인지 담지 않으므로).
function missingScheduleFields(row, input) {
  const missing = [];
  if (row.property_kind === "officetel" && row.schedule_target === null) missing.push("scheduleTarget");
  if (!input.contractDate) missing.push("contractOn");
  const positive = (value) => Number.isSafeInteger(value) && value > 0;
  if (REPORTABLE_KINDS.has(input.dealKind) && (input.target === "housing" || input.target === "land") && !positive(input.priceWon)) {
    missing.push("priceWon");
  }
  if (LEASE_KINDS.has(input.dealKind) && input.target === "housing" && input.reportingRegion && !input.renewalWithoutChange) {
    const depositOk = input.dealKind === "jeonse" ? positive(input.depositWon) : Number.isSafeInteger(input.depositWon) && input.depositWon >= 0;
    if (!depositOk) missing.push("depositWon");
    if (input.dealKind === "monthly_rent" && !positive(input.monthlyRentWon)) missing.push("monthlyRentWon");
  }
  return missing;
}

const SCHEDULE_ERROR_FIELDS = Object.freeze({
  DATE_INVALID: ["contractOn"],
  DATE_UNSUPPORTED: ["contractOn"],
  DATE_ORDER_INVALID: ["middlePaymentOn", "balanceOn"],
  DEAL_TYPE_INVALID: ["dealType"],
  PROPERTY_KIND_INVALID: ["propertyKind"],
  REGULATION_INVALID: ["regulation"],
  AMOUNT_INVALID: ["priceWon", "depositWon", "monthlyRentWon"],
  AMOUNT_TOO_LARGE: ["priceWon", "depositWon", "monthlyRentWon"],
});

async function calculateEvents(ctx, dealId) {
  parseCalculate(ctx.body);
  const deal = await loadDeal(ctx.db, dealId);
  if (!deal) throw notFound();
  const input = scheduleInput(deal);
  const missing = missingScheduleFields(deal, input);
  if (missing.length > 0) throw invalid(missing);
  const schedule = buildContractSchedule(input, legalRules);
  if (!schedule.ok) {
    const fields = SCHEDULE_ERROR_FIELDS[schedule.error.code];
    if (!fields) throw new Error(`schedule ${schedule.error.code}`);
    throw invalid(fields);
  }
  const at = new Date(ctx.now).toISOString();
  const alarms = JSON.stringify(DEFAULT_ALARM_TRIGGERS);
  const planned = schedule.events.map((event) => {
    const kind = SCHEDULE_KIND_TO_EVENT[event.kind];
    if (!kind) throw new Error(`schedule kind ${event.kind}`);
    return { kind, date: event.date, title: cleanSingleLine(event.title, 80) };
  });
  const statements = [
    ctx.db.prepare(SQL.dealVersionGuard).bind(dealId, deal.version),
    ctx.db.prepare(SQL.calculatedPrune).bind(dealId, JSON.stringify(planned.map((event) => event.kind))),
  ];
  for (const event of planned) {
    statements.push(ctx.db.prepare(SQL.calculatedUpdate).bind(event.date, event.title, at, dealId, event.kind, event.date, event.title));
  }
  for (const event of planned) {
    statements.push(ctx.db.prepare(SQL.calculatedInsert).bind(ctx.randomUUID(), dealId, event.kind, event.date, event.title, alarms, at, at, dealId, event.kind));
  }
  statements.push(auditStatement(ctx.db, { ...auditBase(ctx, "event.calculate", { targetType: "deal", targetId: dealId }), outcome: "ok" }));
  try {
    await runBatch(ctx.db, statements);
  } catch (error) {
    // guard가 되돌렸으면: 거래 없음 404, 계산하는 사이 거래가 고쳐짐 409. 그 밖에는 저장소 오류 그대로.
    const latest = await loadDeal(ctx.db, dealId);
    if (!latest) throw notFound();
    if (latest.version !== deal.version) throw versionConflict();
    throw error;
  }
  // 안내 문장은 저장이 끝난 뒤의 일정으로 만든다(미리 읽으면 그 사이 다른 화면에서 고친 일정을 놓칠 수 있음).
  const events = await loadDealEvents(ctx.db, dealId);
  // 남긴 종류(kept)는 새로 계산한 날짜와 함께 돌려준다. 화면은 keptOn과 calculatedOn이 다르면 크게 보여 준다.
  // reason: manual = 날짜·제목을 직접 고친 일정(manual·ai_confirmed), done = 완료로 표시한 자동 일정. 한 종류에 둘 다 있으면 manual.
  const kept = [];
  for (const event of planned) {
    const row = events.find((item) => item.kind === event.kind && item.source !== "calculated")
      ?? events.find((item) => item.kind === event.kind && item.source === "calculated" && item.doneAt !== null);
    if (!row) continue;
    kept.push({ kind: event.kind, keptOn: row.dueOn, calculatedOn: event.date, reason: row.source === "calculated" ? "done" : "manual" });
  }
  const notices = [];
  for (const item of kept) {
    const label = EVENT_KIND_LABELS[item.kind];
    const deadline = Boolean(EVENT_KIND_TO_RULE[item.kind]);
    const noun = deadline ? "기한" : "날짜";
    const changed = `지금 거래 기준으로 다시 계산한 ${deadline ? "기한은" : "날짜는"} ${item.calculatedOn}입니다.`;
    if (item.reason === "manual") {
      notices.push(item.keptOn === item.calculatedOn
        ? `${label}: 직접 고친 일정을 그대로 두었습니다(${deadline ? "기한은" : "날짜는"} 다시 계산한 값과 같습니다).`
        : `${label}: 직접 정한 ${noun}(${item.keptOn})${deadline ? "을" : "를"} 그대로 두었습니다. ${changed}`);
    } else if (item.keptOn !== item.calculatedOn) {
      // 완료한 자동 일정은 날짜가 같으면 알리지 않는다(다시 계산할 때마다 같은 문장이 쌓이지 않게). kept에는 그대로 들어간다.
      notices.push(`${label}: 완료로 표시한 일정의 ${noun}(${item.keptOn})${deadline ? "을" : "를"} 그대로 두었습니다. ${changed}`);
    }
  }
  if (kept.some((item) => item.reason === "manual")) notices.push("직접 고친 일정을 다시 계산한 값으로 바꾸려면 그 일정을 지운 뒤 다시 계산하세요.");
  if (kept.some((item) => item.reason === "done" && item.keptOn !== item.calculatedOn)) notices.push("완료로 표시한 일정을 다시 계산한 날짜로 바꾸려면 완료 표시를 푼 뒤 다시 계산하세요.");
  notices.push(...schedule.notices);
  return { data: { events, notices, kept } };
}

async function createEvent(ctx, dealId) {
  const input = parseEventCreate(ctx.body);
  if (!(await loadDeal(ctx.db, dealId))) throw notFound();
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.dealExistsGuard).bind(dealId),
      ctx.db.prepare(SQL.customInsert).bind(id, dealId, input.dueOn, input.title, JSON.stringify(input.alarmOffsets), at, at),
      auditStatement(ctx.db, { ...auditBase(ctx, "event.create", { targetType: "event", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await loadDeal(ctx.db, dealId))) throw notFound();
    throw error;
  }
  return { status: 201, data: { event: eventView(await loadEvent(ctx.db, id)) } };
}

async function updateEvent(ctx, id) {
  const input = parseEventPatch(ctx.body);
  const current = await loadEvent(ctx.db, id);
  if (!current) throw notFound();
  if (current.version !== input.version) throw versionConflict();
  const at = new Date(ctx.now).toISOString();
  const doneGiven = "done" in input.changes ? 1 : 0;
  // 화면이 칸을 모두 보내도(지금과 같은 날짜·제목) 실제로 값이 바뀐 경우만 사용자 일정이 된다.
  // current는 batch 첫 문장(version guard)이 같은 version임을 다시 확인하므로 저장 시점의 값과 같다.
  const dueOnChanged = input.changes.dueOn !== undefined && input.changes.dueOn !== current.due_on;
  const titleChanged = input.changes.title !== undefined && input.changes.title !== current.title;
  const contentEdited = dueOnChanged || titleChanged ? 1 : 0;
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.eventVersionGuard).bind(id, input.version),
      ctx.db.prepare(SQL.eventUpdate).bind(
        input.changes.dueOn ?? null,
        input.changes.title ?? null,
        input.changes.alarmOffsets ? JSON.stringify(input.changes.alarmOffsets) : null,
        doneGiven,
        doneGiven && input.changes.done ? at : null,
        contentEdited,
        at,
        id,
        input.version,
      ),
      auditStatement(ctx.db, { ...auditBase(ctx, "event.update", { targetType: "event", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    const latest = await loadEvent(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    throw error;
  }
  return { data: { event: eventView(await loadEvent(ctx.db, id)) } };
}

async function deleteEvent(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  if (!(await loadEvent(ctx.db, id))) throw notFound();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.eventExistsGuard).bind(id),
      ctx.db.prepare(SQL.eventDelete).bind(id),
      auditStatement(ctx.db, { ...auditBase(ctx, "event.delete", { targetType: "event", targetId: id }), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await loadEvent(ctx.db, id))) throw notFound();
    throw error;
  }
  return { data: { deleted: true } };
}

function ruleText(kind) {
  const ruleKind = EVENT_KIND_TO_RULE[kind];
  return ruleKind ? (legalRules.deadlineRules ?? []).find((rule) => rule.kind === ruleKind)?.legalText ?? "" : "";
}

// .ics UID 키: 거래마다 하나뿐인 종류(계약일·중도금·잔금·신고 기한)는 "거래 ID-종류"라 다시 계산·다시 만들기로 일정 id가 바뀌어도
// 같은 UID가 나온다(캘린더가 중복 대신 갱신할 수 있음, 앱마다 다름). 직접 넣은 일정과, 같은 종류가 둘 이상일 때의 두 번째부터는 일정 id를 쓴다.
function icsUidKeys(dealId, events) {
  const used = new Set();
  return events.map((event) => {
    const kindKey = `${dealId}-${event.kind}`;
    if (event.kind === "custom" || used.has(kindKey)) return event.id;
    used.add(kindKey);
    return kindKey;
  });
}

// 거래 .ics: 끝나지 않은 일정만 넣는다. 감사는 deal.view(reason format=ics, 설계서 8.8 보기).
async function dealCalendar(ctx, dealId) {
  const data = await loadThenAudit(ctx.db, async () => {
    const deal = await loadDeal(ctx.db, dealId);
    if (!deal) return null;
    const events = await all(ctx.db.prepare(SQL.dealOpenEvents).bind(dealId));
    return { deal, events };
  }, () => auditBase(ctx, "deal.view", { targetType: "deal", targetId: dealId, reason: "format=ics" }));
  if (!data) throw notFound();
  const uidKeys = icsUidKeys(data.deal.id, data.events);
  const body = buildDealIcsCalendar({
    now: new Date(ctx.now),
    events: data.events.map((event, index) => ({
      uidKey: uidKeys[index],
      date: event.due_on,
      title: event.title,
      description: ruleText(event.kind),
      alarmTriggers: JSON.parse(event.alarm_offsets),
    })),
  });
  return { raw: { body, contentType: "text/calendar; charset=utf-8", filename: dealIcsFileName(data.deal.contract_on ?? koreaDate(ctx.now)) } };
}

// 일정 경로면 { status?, data } 또는 { raw }를, 아니면 null을 돌려준다.
// /deals/:id/events(POST), /deals/:id/events/calculate(POST), /deals/:id/calendar.ics(GET), /events/:id(PATCH·DELETE)
export async function routeWorkEvents(ctx) {
  const segments = ctx.route.split("/").filter(Boolean);
  if (segments[0] === "deals" && segments.length >= 3 && segments.length <= 4) {
    const [, dealId, sub, extra] = segments;
    const known = (sub === "events" && (extra === undefined || extra === "calculate")) || (sub === "calendar.ics" && extra === undefined);
    if (!known) return null;
    if (!isUuid(dealId)) throw notFound();
    if (sub === "calendar.ics") {
      if (ctx.method === "GET") return dealCalendar(ctx, dealId);
      throw methodNotAllowed("GET");
    }
    if (ctx.method !== "POST") throw methodNotAllowed("POST");
    return extra === "calculate" ? calculateEvents(ctx, dealId) : createEvent(ctx, dealId);
  }
  if (segments[0] === "events" && segments.length === 2) {
    if (!isUuid(segments[1])) throw notFound();
    if (ctx.method === "PATCH") return updateEvent(ctx, segments[1]);
    if (ctx.method === "DELETE") return deleteEvent(ctx, segments[1]);
    throw methodNotAllowed("PATCH, DELETE");
  }
  return null;
}
