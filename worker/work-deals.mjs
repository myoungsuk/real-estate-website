// 업무 도구 단계 2 PR-B1: 거래·참여자 API(설계서 8.2·8.7·8.8·10.2절). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 일정(다시 계산·직접 추가·.ics)은 PR-B2에서 더한다. 파일(R2)은 아직 없어서, 파일 행이 있는 거래는 409 FILES_REQUIRE_STORAGE로 막는다.
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, changesOf, loadThenAudit, runBatch } from "./work-audit.mjs";
import {
  CLOSED_DEAL_STATUSES,
  addOneYear,
  assertDealConsistent,
  dealRegulatedArea,
  encodeCursor,
  encodeKeyCursor,
  invalid,
  isUuid,
  koreaDate,
  parseConfirmation,
  parseDealCreate,
  parseDealListQuery,
  parseDealPatch,
} from "./work-input.mjs";
import { LEDGER_DETACH_SET, all, auditBase, count, maskReason, methodNotAllowed, notFound } from "./work-customers.mjs";

const DEAL_COLUMNS = "id, title, deal_type, sale_kind, property_kind, schedule_target, property_label, price_won, deposit_won, monthly_rent_won,"
  + " contract_on, middle_payment_on, balance_on, buyer_is_corporation, regulated_area, regulation, land_permit_area, metro_area,"
  + " land_share, separate_funding_submission, lease_reporting_region, lease_renewal_without_change, status, closed_on, retention_until,"
  + " version, created_at, updated_at";
// 참여자 목록은 JSON 배열 하나로 bind하고 json_each로 펼친다(고정 SQL에 값 이어 붙이지 않음).
const PARTY_ROWS = "SELECT ?, json_extract(j.value, '$.customerId'), json_extract(j.value, '$.role') FROM json_each(?) j";
const PARTY_CUSTOMER_MISSING = "EXISTS (SELECT 1 FROM json_each(?) j WHERE NOT EXISTS"
  + " (SELECT 1 FROM customers c WHERE c.id = json_extract(j.value, '$.customerId')))";
// 거래 목록(10.2절): 거래 요약 + 그 거래 장부 줄의 합(보수·보수 부가세·입금·미입금은 보수·기타 수입, 줄 수는 전부).
// 기준(?)은 잔금일·계약일 중 하나로, 값을 SQL에 이어 붙이지 않는다. 상태는 JSON 배열 하나로 bind한다.
// ? 순서: 기준, 상태, 상태, 검색어 ×3.
const DEAL_LIST_BASE =
  "WITH s AS (SELECT deal_id, sum(CASE WHEN kind = 'fee' THEN amount_won ELSE 0 END) AS fee_won,"
  + " sum(CASE WHEN kind = 'fee' THEN vat_won ELSE 0 END) AS vat_won,"
  + " sum(CASE WHEN kind <> 'expense' THEN received_won ELSE 0 END) AS received_won,"
  + " sum(CASE WHEN kind <> 'expense' THEN max(0, amount_won + vat_won - received_won) ELSE 0 END) AS unpaid_won,"
  + " count(*) AS entry_count FROM ledger_entries WHERE deal_id IS NOT NULL GROUP BY deal_id),"
  + " f AS (SELECT id, title, deal_type, property_kind, property_label, status, contract_on, balance_on, price_won, deposit_won, monthly_rent_won,"
  + " version, updated_at, CASE ? WHEN 'contract' THEN contract_on ELSE balance_on END AS basis_on FROM deals"
  + " WHERE (? IS NULL OR status IN (SELECT value FROM json_each(?)))"
  + " AND (? IS NULL OR instr(lower(title), ?) > 0 OR instr(lower(property_label), ?) > 0))"
  + " SELECT f.*, coalesce(s.fee_won, 0) AS ledger_fee_won, coalesce(s.vat_won, 0) AS ledger_vat_won, coalesce(s.received_won, 0) AS ledger_received_won,"
  + " coalesce(s.unpaid_won, 0) AS ledger_unpaid_won, coalesce(s.entry_count, 0) AS ledger_entry_count FROM f LEFT JOIN s ON s.deal_id = f.id ";

const SQL = Object.freeze({
  // 기간(달 YYYY-MM 또는 해 YYYY)을 주면 고른 기준일이 그 기간인 거래만, 기준일·id 내림차순. 커서는 (기준일, id).
  dealListByBasis:
    DEAL_LIST_BASE + "WHERE substr(f.basis_on, 1, ?) = ? AND (? IS NULL OR f.basis_on < ? OR (f.basis_on = ? AND f.id < ?))"
    + " ORDER BY f.basis_on DESC, f.id DESC LIMIT ?",
  // 기간이 없으면 고친 시각·id 내림차순(손님 목록과 같음).
  dealListByUpdated:
    DEAL_LIST_BASE + "WHERE (? IS NULL OR f.updated_at < ? OR (f.updated_at = ? AND f.id < ?)) ORDER BY f.updated_at DESC, f.id DESC LIMIT ?",
  // 기간을 줬을 때 고른 기준일이 비어 빠진 거래 수(같은 상태·검색어 조건). ? 순서: 상태, 상태, 검색어 ×3, 기준.
  dealListUndated:
    "SELECT count(*) AS n FROM deals WHERE (? IS NULL OR status IN (SELECT value FROM json_each(?)))"
    + " AND (? IS NULL OR instr(lower(title), ?) > 0 OR instr(lower(property_label), ?) > 0)"
    + " AND (CASE ? WHEN 'contract' THEN contract_on ELSE balance_on END) IS NULL",
  dealById: "SELECT " + DEAL_COLUMNS + " FROM deals WHERE id = ?",
  dealInsert:
    "INSERT INTO deals (" + DEAL_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  dealUpdate:
    "UPDATE deals SET title = ?, deal_type = ?, sale_kind = ?, property_kind = ?, schedule_target = ?, property_label = ?,"
    + " price_won = ?, deposit_won = ?, monthly_rent_won = ?, contract_on = ?, middle_payment_on = ?, balance_on = ?,"
    + " buyer_is_corporation = ?, regulated_area = ?, regulation = ?, land_permit_area = ?, metro_area = ?, land_share = ?,"
    + " separate_funding_submission = ?, lease_reporting_region = ?, lease_renewal_without_change = ?, status = ?, closed_on = ?,"
    + " retention_until = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 일부러 오류를 내 batch 전체를 되돌린다.
  // batch는 한 트랜잭션이라 guard를 통과하면 뒤 문장도 같은 상태에서 돈다. 만들기는 참여자 손님이 모두 있는지,
  // 고치기는 그에 더해 version이 그대로인지 본다(통과하면 UPDATE가 반드시 들어가므로 참여자 교체·감사에 따로 조건을 걸지 않는다).
  partiesGuard: "SELECT CASE WHEN " + PARTY_CUSTOMER_MISSING + " THEN json('guard') ELSE 1 END AS ok",
  dealUpdateGuard:
    "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deals WHERE id = ? AND version = ?) OR " + PARTY_CUSTOMER_MISSING
    + " THEN json('guard') ELSE 1 END AS ok",
  partyCustomersFound: "SELECT count(*) AS n FROM customers WHERE id IN (SELECT json_extract(j.value, '$.customerId') FROM json_each(?) j)",
  partiesInsert: "INSERT INTO deal_parties (deal_id, customer_id, role) " + PARTY_ROWS,
  partiesDelete: "DELETE FROM deal_parties WHERE deal_id = ?",
  dealParties:
    "SELECT p.customer_id, p.role, c.display_name FROM deal_parties p JOIN customers c ON c.id = p.customer_id"
    + " WHERE p.deal_id = ? ORDER BY c.display_name, p.customer_id, p.role",
  dealEvents:
    "SELECT id, deal_id, kind, due_on, title, alarm_offsets, source, done_at, version, created_at, updated_at FROM deal_events WHERE deal_id = ? ORDER BY due_on, id",
  dealNotes:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE deal_id = ? ORDER BY created_at DESC, id DESC LIMIT 50",
  dealFiles: "SELECT id, kind, mime_type, byte_size, caption, customer_id, created_at FROM files WHERE deal_id = ? ORDER BY created_at DESC, id DESC",
  dealFileCount: "SELECT count(*) AS n FROM files WHERE deal_id = ?",
  // 거래 삭제 batch 첫 문장: 거래가 없거나 제목이 바뀌었거나 파일 행이 있으면 전체를 되돌린다.
  dealDeleteGuard:
    "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM deals WHERE id = ? AND title = ?) OR EXISTS (SELECT 1 FROM files WHERE deal_id = ?)"
    + " THEN json('guard') ELSE 1 END AS ok",
  // 감사 기록은 지우기 전에 남기고, 손님 메모로 남길 메모 수(notes_kept)를 batch 안에서 센다.
  dealDeleteAudit:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)"
    + " SELECT ?, ?, 'deal.delete', 'deal', ?, ?, 'ok', CASE WHEN kept > 0 THEN 'notes_kept=' || kept END"
    + " FROM (SELECT count(*) AS kept FROM notes WHERE deal_id = ? AND customer_id IS NOT NULL)",
  // 손님이 붙은 거래 메모는 거래 연결만 끊어 손님 메모로 남기고, 손님 연결 없는 거래 메모는 함께 지운다(8.7절, 손님 삭제와 같은 규칙).
  dealCustomerNotesDetach: "UPDATE notes SET deal_id = NULL WHERE deal_id = ? AND customer_id IS NOT NULL",
  dealOnlyNotesDelete: "DELETE FROM notes WHERE deal_id = ? AND customer_id IS NULL",
  dealEventsDelete: "DELETE FROM deal_events WHERE deal_id = ?",
  dealPartiesDelete: "DELETE FROM deal_parties WHERE deal_id = ?",
  // 장부 줄은 지우지 않고 거래 연결만 끊는다(DEC-WT-38). 감사 reason 꼴(notes_kept=)은 그대로 두고 응답 kept.ledger로만 알린다.
  dealLedgerDetach: LEDGER_DETACH_SET + " WHERE deal_id = ?",
  // 그 거래의 할 일은 함께 지운다(2026-11-21 사용자 결정 11:15:11 U-4). 0006은 ON DELETE CASCADE가 없으므로 dealDelete 앞에서 직접 지운다.
  dealTasksDelete: "DELETE FROM tasks WHERE deal_id = ?",
  dealDelete: "DELETE FROM deals WHERE id = ?",
});

const bool = (value) => value === 1;

function dealView(row) {
  return {
    id: row.id,
    title: row.title,
    dealType: row.deal_type,
    saleKind: row.sale_kind,
    propertyKind: row.property_kind,
    scheduleTarget: row.schedule_target,
    propertyLabel: row.property_label,
    priceWon: row.price_won,
    depositWon: row.deposit_won,
    monthlyRentWon: row.monthly_rent_won,
    contractOn: row.contract_on,
    middlePaymentOn: row.middle_payment_on,
    balanceOn: row.balance_on,
    buyerIsCorporation: bool(row.buyer_is_corporation),
    regulation: row.regulation,
    landPermitArea: bool(row.land_permit_area),
    metroArea: bool(row.metro_area),
    landShare: bool(row.land_share),
    separateFundingSubmission: bool(row.separate_funding_submission),
    leaseReportingRegion: bool(row.lease_reporting_region),
    leaseRenewalWithoutChange: bool(row.lease_renewal_without_change),
    status: row.status,
    closedOn: row.closed_on,
    retentionUntil: row.retention_until,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 저장된 행을 입력과 같은 모양(0/1 깃발)으로 바꾼다. 고치기 때 바뀐 칸과 합쳐 앞뒤를 다시 본다.
function rowToDeal(row) {
  return {
    title: row.title,
    dealType: row.deal_type,
    saleKind: row.sale_kind,
    propertyKind: row.property_kind,
    scheduleTarget: row.schedule_target,
    propertyLabel: row.property_label,
    priceWon: row.price_won,
    depositWon: row.deposit_won,
    monthlyRentWon: row.monthly_rent_won,
    contractOn: row.contract_on,
    middlePaymentOn: row.middle_payment_on,
    balanceOn: row.balance_on,
    buyerIsCorporation: row.buyer_is_corporation,
    regulation: row.regulation,
    landPermitArea: row.land_permit_area,
    metroArea: row.metro_area,
    landShare: row.land_share,
    separateFundingSubmission: row.separate_funding_submission,
    leaseReportingRegion: row.lease_reporting_region,
    leaseRenewalWithoutChange: row.lease_renewal_without_change,
    status: row.status,
  };
}

// 칸 순서는 DEAL_COLUMNS의 title ~ retention_until과 같다. regulated_area는 여기 한 곳에서 regulation으로 만든다(0002 CHECK와 같음).
function dealValues(deal, closed) {
  return [
    deal.title, deal.dealType, deal.saleKind, deal.propertyKind, deal.scheduleTarget, deal.propertyLabel,
    deal.priceWon, deal.depositWon, deal.monthlyRentWon, deal.contractOn, deal.middlePaymentOn, deal.balanceOn,
    deal.buyerIsCorporation, dealRegulatedArea(deal.regulation), deal.regulation, deal.landPermitArea, deal.metroArea, deal.landShare,
    deal.separateFundingSubmission, deal.leaseReportingRegion, deal.leaseRenewalWithoutChange, deal.status, closed.closedOn, closed.retentionUntil,
  ];
}

// 완료·취소가 되면 그날(한국 날짜)을 closed_on으로, +1년을 정리 안내 기준일로 둔다(8.7절). 이미 닫힌 거래는 처음 닫은 날을 유지하고,
// 진행 중으로 되돌리면 둘 다 비운다.
function closedFields(status, current, today) {
  if (!CLOSED_DEAL_STATUSES.includes(status)) return { closedOn: null, retentionUntil: null };
  if (current && CLOSED_DEAL_STATUSES.includes(current.status) && current.closed_on) {
    return { closedOn: current.closed_on, retentionUntil: current.retention_until };
  }
  return { closedOn: today, retentionUntil: addOneYear(today) };
}

export async function loadDeal(db, id) {
  return (await db.prepare(SQL.dealById).bind(id).first()) ?? null;
}

async function assertPartiesExist(db, parties) {
  if (parties.length === 0) return;
  const ids = [...new Set(parties.map((party) => party.customerId))];
  if (await count(db, SQL.partyCustomersFound, JSON.stringify(ids.map((customerId) => ({ customerId })))) !== ids.length) {
    throw invalid(["parties"]);
  }
}

async function loadParties(db, id) {
  return (await all(db.prepare(SQL.dealParties).bind(id))).map((row) => ({ customerId: row.customer_id, role: row.role, displayName: row.display_name }));
}

async function createDeal(ctx) {
  const input = parseDealCreate(ctx.body);
  await assertPartiesExist(ctx.db, input.parties);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  const partiesJson = JSON.stringify(input.parties);
  const statements = [
    ctx.db.prepare(SQL.partiesGuard).bind(partiesJson),
    ctx.db.prepare(SQL.dealInsert).bind(id, ...dealValues(input.deal, closedFields(input.deal.status, null, koreaDate(ctx.now))), at, at),
    ctx.db.prepare(SQL.partiesInsert).bind(id, partiesJson),
    auditStatement(ctx.db, { ...auditBase(ctx, "deal.create", { targetType: "deal", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
  ];
  try {
    await runBatch(ctx.db, statements);
  } catch (error) {
    await assertPartiesExist(ctx.db, input.parties); // 그사이 참여자 손님이 지워졌으면 400
    throw error;
  }
  return { status: 201, data: { deal: dealView(await loadDeal(ctx.db, id)), parties: await loadParties(ctx.db, id) } };
}

async function getDeal(ctx, id) {
  const data = await loadThenAudit(ctx.db, async () => {
    const row = await loadDeal(ctx.db, id);
    if (!row) return null;
    const events = await all(ctx.db.prepare(SQL.dealEvents).bind(id));
    const notes = await all(ctx.db.prepare(SQL.dealNotes).bind(id));
    const files = await all(ctx.db.prepare(SQL.dealFiles).bind(id));
    return {
      deal: dealView(row),
      parties: await loadParties(ctx.db, id),
      events: events.map((event) => ({
        id: event.id, dealId: event.deal_id, kind: event.kind, dueOn: event.due_on, title: event.title, alarmOffsets: JSON.parse(event.alarm_offsets),
        source: event.source, doneAt: event.done_at, version: event.version, createdAt: event.created_at, updatedAt: event.updated_at,
      })),
      notes: notes.map((note) => ({ id: note.id, customerId: note.customer_id, dealId: note.deal_id, body: note.body, source: note.source, fileId: note.file_id, version: note.version, createdAt: note.created_at, updatedAt: note.updated_at })),
      files: files.map((file) => ({ id: file.id, kind: file.kind, mimeType: file.mime_type, byteSize: file.byte_size, caption: file.caption, customerId: file.customer_id, createdAt: file.created_at })),
    };
  }, () => auditBase(ctx, "deal.view", { targetType: "deal", targetId: id }));
  if (!data) throw notFound();
  return data;
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

async function updateDeal(ctx, id) {
  const input = parseDealPatch(ctx.body);
  const current = await loadDeal(ctx.db, id);
  if (!current) throw notFound();
  if (current.version !== input.version) throw versionConflict();
  const merged = { ...rowToDeal(current), ...input.changes };
  // 거래 종류·물건 종류를 바꾸면서 딸린 칸을 주지 않았으면 맞춰 준다(매매가 아니면 세부 종류 없음, 매매로 바꾸면 일반 매매,
  // 오피스텔이 아니면 일정 판정 선택 없음). 오피스텔로 바꾸면서 일정 판정을 안 주면 assertDealConsistent가 400을 낸다.
  if ("dealType" in input.changes && !("saleKind" in input.changes)) merged.saleKind = merged.dealType === "sale" ? (current.deal_type === "sale" ? current.sale_kind : "sale") : null;
  if ("propertyKind" in input.changes && !("scheduleTarget" in input.changes) && merged.propertyKind !== "officetel") merged.scheduleTarget = null;
  assertDealConsistent(merged);
  if (input.parties) await assertPartiesExist(ctx.db, input.parties);
  const at = new Date(ctx.now).toISOString();
  const statements = [
    ctx.db.prepare(SQL.dealUpdateGuard).bind(id, input.version, JSON.stringify(input.parties ?? [])),
    ctx.db.prepare(SQL.dealUpdate).bind(...dealValues(merged, closedFields(merged.status, current, koreaDate(ctx.now))), at, id, input.version),
  ];
  if (input.parties) {
    statements.push(ctx.db.prepare(SQL.partiesDelete).bind(id), ctx.db.prepare(SQL.partiesInsert).bind(id, JSON.stringify(input.parties)));
  }
  statements.push(auditStatement(ctx.db, { ...auditBase(ctx, "deal.update", { targetType: "deal", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }));
  try {
    await runBatch(ctx.db, statements);
  } catch (error) {
    // guard가 되돌렸으면 그사이 바뀐 상황을 알려 준다: 거래 없음 404, 다른 화면이 먼저 고침 409, 참여자 손님 없음 400.
    const latest = await loadDeal(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    if (input.parties) await assertPartiesExist(ctx.db, input.parties);
    throw error;
  }
  return { data: { deal: dealView(await loadDeal(ctx.db, id)), parties: await loadParties(ctx.db, id) } };
}

async function assertDealDeletable(db, id, confirmTitle) {
  const row = await loadDeal(db, id);
  if (!row) throw notFound();
  if (confirmTitle !== row.title) throw new WorkApiError("CONFIRMATION_MISMATCH", "확인 제목이 거래 제목과 다릅니다.", 400);
  if (await count(db, SQL.dealFileCount, id) > 0) {
    throw new WorkApiError("FILES_REQUIRE_STORAGE", "연결된 파일이 있어 파일 저장소가 켜진 뒤에 지울 수 있습니다.", 409);
  }
}

async function deleteDeal(ctx, id) {
  const confirmTitle = parseConfirmation(ctx.body, "confirmTitle");
  await assertDealDeletable(ctx.db, id, confirmTitle);
  const at = new Date(ctx.now).toISOString();
  const statements = [
    ctx.db.prepare(SQL.dealDeleteGuard).bind(id, confirmTitle, id),
    ctx.db.prepare(SQL.dealDeleteAudit).bind(at, ctx.actor.email.toLowerCase(), id, ctx.requestId, id),
    ctx.db.prepare(SQL.dealCustomerNotesDetach).bind(id),
    ctx.db.prepare(SQL.dealOnlyNotesDelete).bind(id),
    ctx.db.prepare(SQL.dealEventsDelete).bind(id),
    ctx.db.prepare(SQL.dealPartiesDelete).bind(id),
    ctx.db.prepare(SQL.dealLedgerDetach).bind(at, id),
    ctx.db.prepare(SQL.dealTasksDelete).bind(id),
    ctx.db.prepare(SQL.dealDelete).bind(id),
  ];
  let results;
  try {
    results = await runBatch(ctx.db, statements);
  } catch (error) {
    await assertDealDeletable(ctx.db, id, confirmTitle);
    throw error;
  }
  return {
    data: {
      deleted: { deals: 1, events: changesOf(results[4]), notes: changesOf(results[3]), files: 0, tasks: changesOf(results[7]) },
      kept: { notes: changesOf(results[2]), ledger: changesOf(results[6]) },
    },
  };
}

function dealListItem(row) {
  return {
    id: row.id,
    title: row.title,
    dealType: row.deal_type,
    propertyKind: row.property_kind,
    propertyLabel: row.property_label,
    status: row.status,
    contractOn: row.contract_on,
    balanceOn: row.balance_on,
    priceWon: row.price_won,
    depositWon: row.deposit_won,
    monthlyRentWon: row.monthly_rent_won,
    version: row.version,
    updatedAt: row.updated_at,
    ledger: {
      feeWon: row.ledger_fee_won,
      vatWon: row.ledger_vat_won,
      receivedWon: row.ledger_received_won,
      unpaidWon: row.ledger_unpaid_won,
      entryCount: row.ledger_entry_count,
    },
  };
}

// 거래 목록(10.2절, 매출장부·메모 거래 붙이기). 감사는 deal.list(요청 1회당 1건, 대상 없음, 결과 수만).
async function listDeals(ctx) {
  const query = parseDealListQuery(ctx.url.searchParams);
  const statusJson = query.statuses ? JSON.stringify(query.statuses) : null;
  const text = query.query?.text ?? null;
  const filter = [query.basis, statusJson, statusJson, text, text, text];
  const cursorValues = [query.cursor?.key ?? null, query.cursor?.key ?? null, query.cursor?.key ?? null, query.cursor?.id ?? null];
  return loadThenAudit(ctx.db, async () => {
    const statement = query.period
      ? ctx.db.prepare(SQL.dealListByBasis).bind(...filter, query.period.length, query.period, ...cursorValues, query.limit + 1)
      : ctx.db.prepare(SQL.dealListByUpdated).bind(...filter, ...cursorValues, query.limit + 1);
    const rows = await all(statement);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    let nextCursor = null;
    if (rows.length > query.limit && last) nextCursor = query.period ? encodeKeyCursor(last.basis_on, last.id) : encodeCursor(last.updated_at, last.id);
    // 기간을 주면 그 기준일이 비어 빠진 거래 수를 따로 알린다(DEC-WT-39). 기간이 없으면 빠진 거래가 없다.
    const undatedCount = query.period ? await count(ctx.db, SQL.dealListUndated, statusJson, statusJson, text, text, text, query.basis) : 0;
    return { items: page.map(dealListItem), nextCursor, undatedCount };
  }, (data) => auditBase(ctx, "deal.list", { reason: `result_count=${data.items.length}` }));
}

// 경로가 거래(/deals, /deals/:id)면 { status?, data }를, 아니면 null을 돌려준다. 일정 경로(/deals/:id/events…·calendar.ics)는 work-events.mjs(PR-B2)가 맡는다.
export async function routeWorkDeals(ctx) {
  const [collection, id, extra] = ctx.route.split("/").filter(Boolean);
  if (collection !== "deals" || extra !== undefined) return null;
  if (id === undefined) {
    if (ctx.method === "GET") return { data: await listDeals(ctx) };
    if (ctx.method === "POST") return createDeal(ctx);
    throw methodNotAllowed("GET, POST");
  }
  if (!isUuid(id)) throw notFound();
  if (ctx.method === "GET") return { data: await getDeal(ctx, id) };
  if (ctx.method === "PATCH") return updateDeal(ctx, id);
  if (ctx.method === "DELETE") return deleteDeal(ctx, id);
  throw methodNotAllowed("GET, PATCH, DELETE");
}
