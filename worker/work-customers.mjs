// 업무 도구 단계 2 PR-A: 손님·메모·검색 API(설계서 8.5 ~ 8.8·10.2·11.2절). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 파일(R2)은 아직 없어서, 손님 삭제 때 파일 행이 있으면 409 FILES_REQUIRE_STORAGE로 막는다(R2 PR에서 실제 삭제로 바꿈).
import { WorkApiError } from "./work-security.mjs";
import { auditIfUpdatedStatement, changesOf, loadThenAudit, runBatch, writeBatchWithAudit } from "./work-audit.mjs";
import {
  CUSTOMER_STATUSES,
  addOneYear,
  decodeCursor,
  encodeCursor,
  invalid,
  isUuid,
  koreaDate,
  parseConfirmation,
  parseCustomerCreate,
  parseCustomerPatch,
  parseLimit,
  parseNoteCreate,
  parseNotePatch,
  parseSearchQuery,
} from "./work-input.mjs";

const SEARCH_RESULT_LIMIT = 20;
const DETAIL_NOTE_LIMIT = 50;

const SQL = Object.freeze({
  customerList:
    "SELECT id, display_name, phone_digits, needs, status, last_contact_on, retention_until, version, created_at, updated_at FROM customers"
    + " WHERE (? IS NULL OR status = ?)"
    + " AND (? IS NULL OR instr(lower(display_name), ?) > 0 OR instr(lower(needs), ?) > 0 OR (? <> '' AND instr(coalesce(phone_digits, ''), ?) > 0))"
    + " AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?))"
    + " ORDER BY updated_at DESC, id DESC LIMIT ?",
  customerById:
    "SELECT id, display_name, phone_digits, needs, status, last_contact_on, retention_until, version, created_at, updated_at FROM customers WHERE id = ?",
  customerInsert:
    "INSERT INTO customers (id, display_name, phone_digits, needs, status, last_contact_on, retention_until, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)",
  customerUpdate:
    "UPDATE customers SET display_name = coalesce(?, display_name), phone_digits = CASE WHEN ? = 1 THEN ? ELSE phone_digits END,"
    + " needs = coalesce(?, needs), status = coalesce(?, status), version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  customerTouchContact: "UPDATE customers SET last_contact_on = ?, retention_until = ? WHERE id = ?",
  customerDelete: "DELETE FROM customers WHERE id = ?",
  customerDeals:
    "SELECT d.id, d.title, d.deal_type, d.status, d.version, d.updated_at, p.role FROM deal_parties p JOIN deals d ON d.id = p.deal_id WHERE p.customer_id = ? ORDER BY d.updated_at DESC, d.id DESC",
  customerNotes:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  customerFiles:
    "SELECT id, kind, mime_type, byte_size, caption, deal_id, created_at FROM files WHERE customer_id = ? ORDER BY created_at DESC, id DESC",
  // 그 손님에게만 연결된 거래(다른 손님이 없는 거래). 손님을 지울 때 함께 지운다(8.7절).
  exclusiveDeals:
    "SELECT d.id FROM deals d WHERE EXISTS (SELECT 1 FROM deal_parties p WHERE p.deal_id = d.id AND p.customer_id = ?)"
    + " AND NOT EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = d.id AND q.customer_id <> ?)",
  customerFileCount: "SELECT count(*) AS n FROM files WHERE customer_id = ?",
  dealFileCount: "SELECT count(*) AS n FROM files WHERE deal_id = ?",
  // 손님 메모 중 다른 손님과 함께인 거래에도 걸린 메모는 지우지 않고 손님 연결만 끊는다(그 거래의 기록이므로, 8.7절).
  sharedDealNotesDetach:
    "UPDATE notes SET customer_id = NULL WHERE customer_id = ? AND deal_id IS NOT NULL"
    + " AND EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = notes.deal_id AND q.customer_id <> ?)",
  sharedDealNoteCount:
    "SELECT count(*) AS n FROM notes WHERE customer_id = ? AND deal_id IS NOT NULL"
    + " AND EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = notes.deal_id AND q.customer_id <> ?)",
  customerNoteCount:
    "SELECT count(*) AS n FROM notes WHERE customer_id = ?"
    + " AND NOT (deal_id IS NOT NULL AND EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = notes.deal_id AND q.customer_id <> ?))",
  // 지우는 단독 거래에 걸린 메모 중 손님 연결이 없는 것만 함께 지운다. 다른 손님(Y)의 메모는 거래 연결만 끊고 Y의 메모로 남긴다(8.7절).
  dealNoteCount: "SELECT count(*) AS n FROM notes WHERE deal_id = ? AND customer_id IS NULL",
  dealOtherNoteCount: "SELECT count(*) AS n FROM notes WHERE deal_id = ? AND customer_id IS NOT NULL AND customer_id <> ?",
  dealOtherNotesDetach: "UPDATE notes SET deal_id = NULL WHERE deal_id = ? AND customer_id IS NOT NULL AND customer_id <> ?",
  notesDeleteByCustomer: "DELETE FROM notes WHERE customer_id = ?",
  notesDeleteByDeal: "DELETE FROM notes WHERE deal_id = ?",
  dealEventsDelete: "DELETE FROM deal_events WHERE deal_id = ?",
  dealPartiesDelete: "DELETE FROM deal_parties WHERE deal_id = ?",
  dealDelete: "DELETE FROM deals WHERE id = ?",
  customerPartiesDelete: "DELETE FROM deal_parties WHERE customer_id = ?",
  dealExists: "SELECT id FROM deals WHERE id = ?",
  noteList:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes"
    + " WHERE (? = 0 OR (customer_id IS NULL AND deal_id IS NULL))"
    + " AND (? IS NULL OR instr(lower(body), ?) > 0)"
    + " AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))"
    + " ORDER BY created_at DESC, id DESC LIMIT ?",
  noteById: "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE id = ?",
  noteInsert:
    "INSERT INTO notes (id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'manual', NULL, 1, ?, ?)",
  noteUpdate:
    "UPDATE notes SET body = coalesce(?, body), customer_id = CASE WHEN ? = 1 THEN ? ELSE customer_id END,"
    + " deal_id = CASE WHEN ? = 1 THEN ? ELSE deal_id END, version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  noteDelete: "DELETE FROM notes WHERE id = ?",
  searchCustomers:
    "SELECT id, display_name, phone_digits, needs, status, last_contact_on, retention_until, version, created_at, updated_at FROM customers"
    + " WHERE instr(lower(display_name), ?) > 0 OR instr(lower(needs), ?) > 0 OR (? <> '' AND instr(coalesce(phone_digits, ''), ?) > 0)"
    + " ORDER BY updated_at DESC, id DESC LIMIT ?",
  searchNotes:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE instr(lower(body), ?) > 0 ORDER BY created_at DESC, id DESC LIMIT ?",
});

function methodNotAllowed(allow) {
  const error = new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405);
  error.allow = allow;
  return error;
}

function notFound() {
  return new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);
}

function customerView(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    phoneDigits: row.phone_digits,
    needs: row.needs,
    status: row.status,
    lastContactOn: row.last_contact_on,
    retentionUntil: row.retention_until,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function noteView(row) {
  return {
    id: row.id,
    customerId: row.customer_id,
    dealId: row.deal_id,
    body: row.body,
    source: row.source,
    fileId: row.file_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function all(statement) {
  const result = await statement.all();
  return result?.results ?? [];
}

function auditBase(ctx, action, extra = {}) {
  return { at: new Date(ctx.now).toISOString(), actorEmail: ctx.actor.email, action, requestId: ctx.requestId, ...extra };
}

const countReason = (count) => `result_count=${count}`;
const maskReason = (count) => (count > 0 ? `rrn_masked=${count}` : null);

async function listCustomers(ctx) {
  const params = ctx.url.searchParams;
  const query = parseSearchQuery(params.get("q"), { required: false });
  const status = params.get("status");
  if (status !== null && !CUSTOMER_STATUSES.includes(status)) throw invalid(["status"]);
  const cursor = decodeCursor(params.get("cursor"));
  const limit = parseLimit(params.get("limit"));
  return loadThenAudit(ctx.db, async () => {
    const rows = await all(ctx.db.prepare(SQL.customerList).bind(
      status, status,
      query?.text ?? null, query?.text ?? null, query?.text ?? null, query?.digits ?? "", query?.digits ?? "",
      cursor?.time ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? null,
      limit + 1,
    ));
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(customerView), nextCursor: rows.length > limit && last ? encodeCursor(last.updated_at, last.id) : null };
  }, (data) => auditBase(ctx, "customer.list", { reason: countReason(data.items.length) }));
}

async function loadCustomer(db, id) {
  return (await db.prepare(SQL.customerById).bind(id).first()) ?? null;
}

async function getCustomer(ctx, id) {
  const data = await loadThenAudit(ctx.db, async () => {
    const row = await loadCustomer(ctx.db, id);
    if (!row) return null;
    const deals = await all(ctx.db.prepare(SQL.customerDeals).bind(id));
    const notes = await all(ctx.db.prepare(SQL.customerNotes).bind(id, DETAIL_NOTE_LIMIT));
    const files = await all(ctx.db.prepare(SQL.customerFiles).bind(id));
    return {
      customer: customerView(row),
      deals: deals.map((deal) => ({ id: deal.id, title: deal.title, dealType: deal.deal_type, status: deal.status, role: deal.role, version: deal.version, updatedAt: deal.updated_at })),
      notes: notes.map(noteView),
      files: files.map((file) => ({ id: file.id, kind: file.kind, mimeType: file.mime_type, byteSize: file.byte_size, caption: file.caption, dealId: file.deal_id, createdAt: file.created_at })),
    };
  }, () => auditBase(ctx, "customer.view", { targetType: "customer", targetId: id }));
  if (!data) throw notFound();
  return data;
}

async function createCustomer(ctx) {
  const input = parseCustomerCreate(ctx.body);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  const today = koreaDate(ctx.now);
  // 정리 안내 기준일: 만든 날(한국 날짜)을 마지막 연락일로 두고 +1년(8.7절 설계 선택).
  await writeBatchWithAudit(ctx.db, [
    ctx.db.prepare(SQL.customerInsert).bind(id, input.displayName, input.phoneDigits, input.needs, input.status, today, addOneYear(today), at, at),
  ], auditBase(ctx, "customer.create", { targetType: "customer", targetId: id, reason: maskReason(input.rrnMasked) }));
  return { status: 201, data: { customer: customerView(await loadCustomer(ctx.db, id)) } };
}

async function updateCustomer(ctx, id) {
  const input = parseCustomerPatch(ctx.body);
  const at = new Date(ctx.now).toISOString();
  const phoneGiven = "phoneDigits" in input.changes ? 1 : 0;
  const results = await runBatch(ctx.db, [
    ctx.db.prepare(SQL.customerUpdate).bind(
      input.changes.displayName ?? null,
      phoneGiven,
      phoneGiven ? input.changes.phoneDigits : null,
      input.changes.needs ?? null,
      input.changes.status ?? null,
      at,
      id,
      input.version,
    ),
    auditIfUpdatedStatement(ctx.db, "customers", auditBase(ctx, "customer.update", { targetType: "customer", targetId: id, reason: maskReason(input.rrnMasked) }), { id, version: input.version + 1, updatedAt: at }),
  ]);
  if (changesOf(results[0]) === 0) {
    if (!(await loadCustomer(ctx.db, id))) throw notFound();
    throw new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
  }
  return { data: { customer: customerView(await loadCustomer(ctx.db, id)) } };
}

async function count(db, sql, ...values) {
  return Number((await db.prepare(sql).bind(...values).first())?.n ?? 0);
}

async function deleteCustomer(ctx, id) {
  const confirmName = parseConfirmation(ctx.body, "confirmName");
  const row = await loadCustomer(ctx.db, id);
  if (!row) throw notFound();
  if (confirmName !== row.display_name) {
    throw new WorkApiError("CONFIRMATION_MISMATCH", "확인 이름이 손님 이름과 다릅니다.", 400);
  }
  const deals = (await all(ctx.db.prepare(SQL.exclusiveDeals).bind(id, id))).map((deal) => deal.id);
  let fileCount = await count(ctx.db, SQL.customerFileCount, id);
  for (const dealId of deals) fileCount += await count(ctx.db, SQL.dealFileCount, dealId);
  if (fileCount > 0) {
    throw new WorkApiError("FILES_REQUIRE_STORAGE", "연결된 파일이 있어 파일 저장소가 켜진 뒤에 지울 수 있습니다.", 409);
  }
  let noteCount = await count(ctx.db, SQL.customerNoteCount, id, id);
  // 남기는 메모(함께인 거래에 걸린 이 손님의 메모 + 단독 거래에 걸린 다른 손님의 메모) 본문에 지운 손님 정보가 있을 수 있어,
  // 그 개수를 응답과 감사 기록에 남긴다(화면 경고용).
  let keptNotes = await count(ctx.db, SQL.sharedDealNoteCount, id, id);
  for (const dealId of deals) {
    noteCount += await count(ctx.db, SQL.dealNoteCount, dealId);
    keptNotes += await count(ctx.db, SQL.dealOtherNoteCount, dealId, id);
  }
  // 외래 키 동작에 기대지 않고 지울 행을 직접 지운다(D1 외래 키 기본 검사는 추가 확인 필요).
  const statements = [ctx.db.prepare(SQL.sharedDealNotesDetach).bind(id, id), ctx.db.prepare(SQL.notesDeleteByCustomer).bind(id)];
  for (const dealId of deals) {
    statements.push(
      ctx.db.prepare(SQL.dealOtherNotesDetach).bind(dealId, id),
      ctx.db.prepare(SQL.notesDeleteByDeal).bind(dealId),
      ctx.db.prepare(SQL.dealEventsDelete).bind(dealId),
      ctx.db.prepare(SQL.dealPartiesDelete).bind(dealId),
      ctx.db.prepare(SQL.dealDelete).bind(dealId),
    );
  }
  statements.push(ctx.db.prepare(SQL.customerPartiesDelete).bind(id), ctx.db.prepare(SQL.customerDelete).bind(id));
  await writeBatchWithAudit(ctx.db, statements, auditBase(ctx, "customer.delete", { targetType: "customer", targetId: id, reason: keptNotes > 0 ? `notes_kept=${keptNotes}` : null }));
  return { data: { deleted: { customers: 1, deals: deals.length, notes: noteCount, files: 0 }, kept: { notes: keptNotes } } };
}

async function listNotes(ctx) {
  const params = ctx.url.searchParams;
  const inbox = params.get("inbox");
  if (inbox !== null && inbox !== "1" && inbox !== "0") throw invalid(["inbox"]);
  const query = parseSearchQuery(params.get("q"), { required: false });
  const cursor = decodeCursor(params.get("cursor"));
  const limit = parseLimit(params.get("limit"));
  return loadThenAudit(ctx.db, async () => {
    const rows = await all(ctx.db.prepare(SQL.noteList).bind(
      inbox === "1" ? 1 : 0,
      query?.text ?? null, query?.text ?? null,
      cursor?.time ?? null, cursor?.time ?? null, cursor?.time ?? null, cursor?.id ?? null,
      limit + 1,
    ));
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return { items: page.map(noteView), nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null };
  }, (data) => auditBase(ctx, "notes.list", { reason: countReason(data.items.length) }));
}

async function assertLinks(db, { customerId, dealId }) {
  if (customerId && !(await loadCustomer(db, customerId))) throw invalid(["customerId"]);
  if (dealId && !(await db.prepare(SQL.dealExists).bind(dealId).first())) throw invalid(["dealId"]);
}

async function loadNote(db, id) {
  return (await db.prepare(SQL.noteById).bind(id).first()) ?? null;
}

async function createNote(ctx) {
  const input = parseNoteCreate(ctx.body);
  await assertLinks(ctx.db, input);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  const statements = [ctx.db.prepare(SQL.noteInsert).bind(id, input.customerId, input.dealId, input.body, at, at)];
  if (input.customerId) {
    // 손님 메모를 쓰면 그 손님의 마지막 연락일을 오늘로, 정리 안내 기준일을 +1년으로(8.7절 설계 선택). version은 올리지 않는다.
    const today = koreaDate(ctx.now);
    statements.push(ctx.db.prepare(SQL.customerTouchContact).bind(today, addOneYear(today), input.customerId));
  }
  await writeBatchWithAudit(ctx.db, statements, auditBase(ctx, "note.create", { targetType: "note", targetId: id, reason: maskReason(input.rrnMasked) }));
  return { status: 201, data: { note: noteView(await loadNote(ctx.db, id)) } };
}

async function updateNote(ctx, id) {
  const input = parseNotePatch(ctx.body);
  await assertLinks(ctx.db, input.changes);
  const at = new Date(ctx.now).toISOString();
  const customerGiven = "customerId" in input.changes ? 1 : 0;
  const dealGiven = "dealId" in input.changes ? 1 : 0;
  const results = await runBatch(ctx.db, [
    ctx.db.prepare(SQL.noteUpdate).bind(
      input.changes.body ?? null,
      customerGiven,
      customerGiven ? input.changes.customerId : null,
      dealGiven,
      dealGiven ? input.changes.dealId : null,
      at,
      id,
      input.version,
    ),
    auditIfUpdatedStatement(ctx.db, "notes", auditBase(ctx, "note.update", { targetType: "note", targetId: id, reason: maskReason(input.rrnMasked) }), { id, version: input.version + 1, updatedAt: at }),
  ]);
  if (changesOf(results[0]) === 0) {
    if (!(await loadNote(ctx.db, id))) throw notFound();
    throw new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
  }
  return { data: { note: noteView(await loadNote(ctx.db, id)) } };
}

async function deleteNote(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  if (!(await loadNote(ctx.db, id))) throw notFound();
  await writeBatchWithAudit(ctx.db, [ctx.db.prepare(SQL.noteDelete).bind(id)], auditBase(ctx, "note.delete", { targetType: "note", targetId: id }));
  return { data: { deleted: true } };
}

async function search(ctx) {
  const query = parseSearchQuery(ctx.url.searchParams.get("q"), { required: true });
  return loadThenAudit(ctx.db, async () => {
    const customers = await all(ctx.db.prepare(SQL.searchCustomers).bind(query.text, query.text, query.digits, query.digits, SEARCH_RESULT_LIMIT));
    const notes = await all(ctx.db.prepare(SQL.searchNotes).bind(query.text, SEARCH_RESULT_LIMIT));
    return { customers: customers.map(customerView), notes: notes.map(noteView), files: [] };
  }, (data) => auditBase(ctx, "search.run", { reason: countReason(data.customers.length + data.notes.length) }));
}

// 경로가 손님·메모·검색이면 { status?, data }를, 아니면 null을 돌려준다.
export async function routeWorkData(ctx) {
  const segments = ctx.route.split("/").filter(Boolean);
  const [collection, id, extra] = segments;
  if (extra !== undefined) return null;
  if (collection === "customers") {
    if (id === undefined) {
      if (ctx.method === "GET") return { data: await listCustomers(ctx) };
      if (ctx.method === "POST") return createCustomer(ctx);
      throw methodNotAllowed("GET, POST");
    }
    if (!isUuid(id)) throw notFound();
    if (ctx.method === "GET") return { data: await getCustomer(ctx, id) };
    if (ctx.method === "PATCH") return updateCustomer(ctx, id);
    if (ctx.method === "DELETE") return deleteCustomer(ctx, id);
    throw methodNotAllowed("GET, PATCH, DELETE");
  }
  if (collection === "notes") {
    if (id === undefined) {
      if (ctx.method === "GET") return { data: await listNotes(ctx) };
      if (ctx.method === "POST") return createNote(ctx);
      throw methodNotAllowed("GET, POST");
    }
    if (!isUuid(id)) throw notFound();
    if (ctx.method === "PATCH") return updateNote(ctx, id);
    if (ctx.method === "DELETE") return deleteNote(ctx, id);
    throw methodNotAllowed("PATCH, DELETE");
  }
  if (collection === "search" && id === undefined) {
    if (ctx.method === "GET") return { data: await search(ctx) };
    throw methodNotAllowed("GET");
  }
  return null;
}
