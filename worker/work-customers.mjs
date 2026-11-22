// 업무 도구 단계 2 PR-A: 손님·메모·검색 API(설계서 8.5 ~ 8.8·10.2·11.2절). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 파일(R2)은 아직 없어서, 손님 삭제 때 파일 행이 있으면 409 FILES_REQUIRE_STORAGE로 막는다(R2 PR에서 실제 삭제로 바꿈).
import { WorkApiError } from "./work-security.mjs";
import { auditIfUpdatedStatement, auditStatement, changesOf, loadThenAudit, runBatch, writeBatchWithAudit } from "./work-audit.mjs";
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

// 손님 X의 단독 거래(그 순간 기준): X가 참여자이고 다른 손님 참여자가 없는 거래. 값 없이 ? 두 개(X, X)만 받는 고정 SQL 조각이다.
// 손님 삭제 batch의 문장마다 이 조건을 batch 안에서 다시 계산한다(미리 읽은 뒤 다른 관리자가 참여자를 더해도 그 거래는 남는다, PR-B 메모 1).
const EXCLUSIVE_DEALS_OF = "SELECT p.deal_id FROM deal_parties p WHERE p.customer_id = ?"
  + " AND NOT EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = p.deal_id AND q.customer_id <> ?)";
// 메모의 손님·거래 연결: 둘 다 있으면 그 손님이 그 거래 참여자여야 한다(PR-B 메모 2). ? 여섯 개(손님, 손님, 거래, 거래, 손님·거래 쌍).
const NOTE_LINK_OK = "(? IS NULL OR EXISTS (SELECT 1 FROM customers WHERE id = ?))"
  + " AND (? IS NULL OR EXISTS (SELECT 1 FROM deals WHERE id = ?))"
  + " AND (? IS NULL OR ? IS NULL OR EXISTS (SELECT 1 FROM deal_parties WHERE deal_id = ? AND customer_id = ?))";
// 장부 줄의 거래 연결 끊기(DEC-WT-38): 거래의 계약일·잔금일을 snap_*로, label이 비었으면 거래 제목을 옮기고 deal_id를 비운다.
// SET의 식은 모두 바꾸기 전 행 값으로 계산되므로 하위 질의의 ledger_entries.deal_id는 끊기 전 거래를 가리킨다. entry_on은 그대로 NULL이다.
// 거래가 지워지기 전에 돌아야 한다(거래 삭제는 dealDelete 앞, 손님 삭제는 exclusiveDealsDelete 앞). 뒤에 붙는 WHERE만 호출하는 쪽이 정한다.
// ? 하나(updated_at). 거래 삭제(work-deals.mjs)도 이 문장을 쓴다.
export const LEDGER_DETACH_SET =
  "UPDATE ledger_entries SET snap_contract_on = (SELECT d.contract_on FROM deals d WHERE d.id = ledger_entries.deal_id),"
  + " snap_balance_on = (SELECT d.balance_on FROM deals d WHERE d.id = ledger_entries.deal_id),"
  + " label = CASE WHEN label = '' THEN coalesce((SELECT substr(d.title, 1, 120) FROM deals d WHERE d.id = ledger_entries.deal_id), '') ELSE label END,"
  + " deal_id = NULL, version = version + 1, updated_at = ?";

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
  // 고치기 batch 첫 문장(guard): version이 그대로가 아니면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(8.5절).
  // 통과하면 같은 트랜잭션이라 UPDATE가 반드시 들어가므로 감사 기록에 "새 version + 같은 시각" 조건을 걸지 않는다
  // (같은 밀리초에 다른 관리자가 같은 version을 만들면 실패한 수정의 감사 행이 남던 겹침을 막음).
  customerVersionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE id = ? AND version = ?) THEN json('guard') ELSE 1 END AS ok",
  customerDelete: "DELETE FROM customers WHERE id = ?",
  customerDeals:
    "SELECT d.id, d.title, d.deal_type, d.status, d.version, d.updated_at, p.role FROM deal_parties p JOIN deals d ON d.id = p.deal_id WHERE p.customer_id = ? ORDER BY d.updated_at DESC, d.id DESC",
  // 손님 카드에 거래별 일정을 함께 싣는다(사용자 선택 2026-11-21 02:26:01 "손님 상세에 일정 함께 담기"). 그 손님이 참여한 거래의 일정을 한 번에 읽는다.
  // 같은 거래에 역할이 둘이어도 IN이라 일정이 두 번 나오지 않는다. 열·순서는 거래 상세(work-deals.mjs dealEvents)와 같다.
  customerDealEvents:
    "SELECT id, deal_id, kind, due_on, title, alarm_offsets, source, done_at, version, created_at, updated_at FROM deal_events"
    + " WHERE deal_id IN (SELECT deal_id FROM deal_parties WHERE customer_id = ?) ORDER BY due_on, id",
  customerNotes:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE customer_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
  customerFiles:
    "SELECT id, kind, mime_type, byte_size, caption, deal_id, created_at FROM files WHERE customer_id = ? ORDER BY created_at DESC, id DESC",
  // 손님 삭제 미리 확인(친절한 오류용): 손님 파일 + 그 손님 단독 거래의 파일 수. 실제 막기는 아래 batch 첫 문장(guard)이 한다.
  customerFileCount: "SELECT count(*) AS n FROM files WHERE customer_id = ? OR deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  // 손님 삭제 batch 첫 문장: 손님이 없거나 이름이 바뀌었거나 파일 행이 있으면 json('guard')(잘못된 JSON)로 일부러 오류를 내
  // batch 전체를 되돌린다. batch는 한 트랜잭션이라 이 판정과 뒤 문장 사이에 다른 쓰기가 끼지 않는다.
  customerDeleteGuard:
    "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM customers WHERE id = ? AND display_name = ?)"
    + " OR EXISTS (SELECT 1 FROM files WHERE customer_id = ? OR deal_id IN (" + EXCLUSIVE_DEALS_OF + "))"
    + " THEN json('guard') ELSE 1 END AS ok",
  // 감사 기록은 지우기 전에 남기며, 남길 메모 수(notes_kept)를 batch 안에서 센다.
  customerDeleteAudit:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)"
    + " SELECT ?, ?, 'customer.delete', 'customer', ?, ?, 'ok', CASE WHEN kept > 0 THEN 'notes_kept=' || kept END FROM (SELECT"
    + " (SELECT count(*) FROM notes WHERE customer_id = ? AND deal_id IS NOT NULL"
    + " AND EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = notes.deal_id AND q.customer_id <> ?))"
    + " + (SELECT count(*) FROM notes WHERE customer_id IS NOT NULL AND customer_id <> ? AND deal_id IN (" + EXCLUSIVE_DEALS_OF + "))"
    + " AS kept)",
  // 손님 메모 중 다른 손님과 함께인 거래에도 걸린 메모는 지우지 않고 손님 연결만 끊는다(그 거래의 기록이므로, 8.7절).
  sharedDealNotesDetach:
    "UPDATE notes SET customer_id = NULL WHERE customer_id = ? AND deal_id IS NOT NULL"
    + " AND EXISTS (SELECT 1 FROM deal_parties q WHERE q.deal_id = notes.deal_id AND q.customer_id <> ?)",
  // 지우는 단독 거래에 걸린 다른 손님(Y)의 메모는 거래 연결만 끊어 Y의 메모로 남기고, 손님 연결 없는 거래 메모는 함께 지운다(8.7절).
  exclusiveDealOtherNotesDetach:
    "UPDATE notes SET deal_id = NULL WHERE customer_id IS NOT NULL AND customer_id <> ? AND deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  exclusiveDealOnlyNotesDelete: "DELETE FROM notes WHERE customer_id IS NULL AND deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  notesDeleteByCustomer: "DELETE FROM notes WHERE customer_id = ?",
  exclusiveDealEventsDelete: "DELETE FROM deal_events WHERE deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  // 지우는 단독 거래의 장부 줄은 지우지 않고 거래 연결만 끊는다(DEC-WT-38). 거래 날짜를 옮겨야 하므로 exclusiveDealsDelete 앞에 둔다.
  // 다른 손님과 함께인 거래는 지우지 않으므로 그 장부 줄은 그대로다.
  exclusiveDealLedgerDetach: LEDGER_DETACH_SET + " WHERE deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  // 지우는 단독 거래의 할 일은 함께 지운다(U-4, 거래 삭제와 같음). ON DELETE CASCADE가 없으므로 exclusiveDealsDelete 앞에 둔다.
  // 다른 손님과 함께인 거래는 지우지 않으므로 그 할 일은 그대로다.
  exclusiveDealTasksDelete: "DELETE FROM tasks WHERE deal_id IN (" + EXCLUSIVE_DEALS_OF + ")",
  exclusiveDealsDelete: "DELETE FROM deals WHERE id IN (" + EXCLUSIVE_DEALS_OF + ")",
  customerPartiesDelete: "DELETE FROM deal_parties WHERE customer_id = ?",
  dealExists: "SELECT id FROM deals WHERE id = ?",
  partyExists: "SELECT 1 AS ok FROM deal_parties WHERE deal_id = ? AND customer_id = ? LIMIT 1",
  noteList:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes"
    + " WHERE (? = 0 OR (customer_id IS NULL AND deal_id IS NULL))"
    + " AND (? IS NULL OR instr(lower(body), ?) > 0)"
    + " AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))"
    + " ORDER BY created_at DESC, id DESC LIMIT ?",
  noteById: "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE id = ?",
  // 메모 넣기·고치기는 연결 조건(NOTE_LINK_OK)을 같은 문장에 걸어, 미리 확인한 뒤 참여자가 빠지면 아무것도 바꾸지 않는다.
  noteInsert:
    "INSERT INTO notes (id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at)"
    + " SELECT ?, ?, ?, ?, 'manual', NULL, 1, ?, ? WHERE " + NOTE_LINK_OK,
  noteUpdate:
    "UPDATE notes SET body = coalesce(?, body), customer_id = CASE WHEN ? = 1 THEN ? ELSE customer_id END,"
    + " deal_id = CASE WHEN ? = 1 THEN ? ELSE deal_id END, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND " + NOTE_LINK_OK,
  // 메모 고치기 guard: version과 고친 뒤 연결 조건(NOTE_LINK_OK)을 batch 안에서 다시 본다.
  noteVersionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM notes WHERE id = ? AND version = ?) OR NOT (" + NOTE_LINK_OK + ") THEN json('guard') ELSE 1 END AS ok",
  customerTouchContactIfNote: "UPDATE customers SET last_contact_on = ?, retention_until = ? WHERE id = ? AND EXISTS (SELECT 1 FROM notes WHERE id = ?)",
  noteDelete: "DELETE FROM notes WHERE id = ?",
  searchCustomers:
    "SELECT id, display_name, phone_digits, needs, status, last_contact_on, retention_until, version, created_at, updated_at FROM customers"
    + " WHERE instr(lower(display_name), ?) > 0 OR instr(lower(needs), ?) > 0 OR (? <> '' AND instr(coalesce(phone_digits, ''), ?) > 0)"
    + " ORDER BY updated_at DESC, id DESC LIMIT ?",
  searchNotes:
    "SELECT id, customer_id, deal_id, body, source, file_id, version, created_at, updated_at FROM notes WHERE instr(lower(body), ?) > 0 ORDER BY created_at DESC, id DESC LIMIT ?",
});

export function methodNotAllowed(allow) {
  const error = new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405);
  error.allow = allow;
  return error;
}

export function notFound() {
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

// 거래 일정 한 건(거래 상세 GET /deals/:id의 events와 같은 모양).
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

export function noteView(row) {
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

export async function all(statement) {
  const result = await statement.all();
  return result?.results ?? [];
}

export function auditBase(ctx, action, extra = {}) {
  return { at: new Date(ctx.now).toISOString(), actorEmail: ctx.actor.email, action, requestId: ctx.requestId, ...extra };
}

const countReason = (count) => `result_count=${count}`;
export const maskReason = (count) => (count > 0 ? `rrn_masked=${count}` : null);

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
    const events = await all(ctx.db.prepare(SQL.customerDealEvents).bind(id));
    const notes = await all(ctx.db.prepare(SQL.customerNotes).bind(id, DETAIL_NOTE_LIMIT));
    const files = await all(ctx.db.prepare(SQL.customerFiles).bind(id));
    const eventsByDeal = new Map();
    for (const event of events) {
      if (!eventsByDeal.has(event.deal_id)) eventsByDeal.set(event.deal_id, []);
      eventsByDeal.get(event.deal_id).push(eventView(event));
    }
    return {
      customer: customerView(row),
      deals: deals.map((deal) => ({
        id: deal.id, title: deal.title, dealType: deal.deal_type, status: deal.status, role: deal.role, version: deal.version, updatedAt: deal.updated_at,
        events: eventsByDeal.get(deal.id) ?? [],
      })),
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
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.customerVersionGuard).bind(id, input.version),
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
      auditStatement(ctx.db, { ...auditBase(ctx, "customer.update", { targetType: "customer", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    // guard가 되돌렸으면 손님 없음 404, 다른 화면이 먼저 고침 409. 그 밖에는 저장소 오류 그대로.
    const latest = await loadCustomer(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    throw error;
  }
  return { data: { customer: customerView(await loadCustomer(ctx.db, id)) } };
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

export async function count(db, sql, ...values) {
  return Number((await db.prepare(sql).bind(...values).first())?.n ?? 0);
}

// 손님 삭제 앞 확인. batch 전(친절한 오류)과 batch가 guard로 되돌려진 뒤(그사이 바뀐 상황 판정)에 같은 순서로 본다.
async function assertCustomerDeletable(db, id, confirmName) {
  const row = await loadCustomer(db, id);
  if (!row) throw notFound();
  if (confirmName !== row.display_name) {
    throw new WorkApiError("CONFIRMATION_MISMATCH", "확인 이름이 손님 이름과 다릅니다.", 400);
  }
  if (await count(db, SQL.customerFileCount, id, id, id) > 0) {
    throw new WorkApiError("FILES_REQUIRE_STORAGE", "연결된 파일이 있어 파일 저장소가 켜진 뒤에 지울 수 있습니다.", 409);
  }
}

async function deleteCustomer(ctx, id) {
  const confirmName = parseConfirmation(ctx.body, "confirmName");
  await assertCustomerDeletable(ctx.db, id, confirmName);
  const at = new Date(ctx.now).toISOString();
  // 한 batch(한 트랜잭션). 단독 거래·남길 메모는 각 문장이 batch 안에서 다시 판정하고, 첫 문장(guard)이 조건이 깨졌으면 전체를 되돌린다.
  // 외래 키 동작에 기대지 않고 지울 행을 직접 지운다(D1 외래 키 기본 검사는 추가 확인 필요).
  const statements = [
    ctx.db.prepare(SQL.customerDeleteGuard).bind(id, confirmName, id, id, id),
    ctx.db.prepare(SQL.customerDeleteAudit).bind(at, ctx.actor.email.toLowerCase(), id, ctx.requestId, id, id, id, id, id),
    ctx.db.prepare(SQL.sharedDealNotesDetach).bind(id, id),
    ctx.db.prepare(SQL.exclusiveDealOtherNotesDetach).bind(id, id, id),
    ctx.db.prepare(SQL.exclusiveDealOnlyNotesDelete).bind(id, id),
    ctx.db.prepare(SQL.notesDeleteByCustomer).bind(id),
    ctx.db.prepare(SQL.exclusiveDealEventsDelete).bind(id, id),
    ctx.db.prepare(SQL.exclusiveDealLedgerDetach).bind(at, id, id),
    ctx.db.prepare(SQL.exclusiveDealTasksDelete).bind(id, id),
    ctx.db.prepare(SQL.exclusiveDealsDelete).bind(id, id),
    ctx.db.prepare(SQL.customerPartiesDelete).bind(id),
    ctx.db.prepare(SQL.customerDelete).bind(id),
  ];
  let results;
  try {
    results = await runBatch(ctx.db, statements);
  } catch (error) {
    // guard가 되돌렸으면 그사이 바뀐 상황(손님 없음·이름 바뀜·파일 생김)을 같은 순서로 알려 주고, 아니면 저장소 오류 그대로.
    await assertCustomerDeletable(ctx.db, id, confirmName);
    throw error;
  }
  // 지운·남긴 개수는 미리 센 값이 아니라 batch 결과로 센다. 남기는 메모 본문에 지운 손님 정보가 있을 수 있어 개수를 알린다(화면 경고용).
  const kept = changesOf(results[2]) + changesOf(results[3]);
  const notes = changesOf(results[4]) + changesOf(results[5]);
  // kept.ledger: 지운 단독 거래에서 연결만 끊고 남긴 장부 줄 수(거래 삭제와 같은 꼴, 감사 reason 꼴은 그대로).
  // deleted.tasks: 지운 단독 거래의 할 일 수(results[8]). 자리 번호는 위 statements 순서와 같아야 한다(할 일 문장을 넣어 거래 수는 results[9]).
  return {
    data: {
      deleted: { customers: 1, deals: changesOf(results[9]), notes, files: 0, tasks: changesOf(results[8]) },
      kept: { notes: kept, ledger: changesOf(results[7]) },
    },
  };
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

// 메모 연결 확인(친절한 오류용): 손님·거래가 있는지, 둘 다 주면 그 손님이 그 거래 참여자인지(PR-B 메모 2).
// 실제 막기는 넣기·고치기 문장의 같은 조건(NOTE_LINK_OK)이 한다.
async function assertLinks(db, { customerId, dealId }) {
  if (customerId && !(await loadCustomer(db, customerId))) throw invalid(["customerId"]);
  if (dealId && !(await db.prepare(SQL.dealExists).bind(dealId).first())) throw invalid(["dealId"]);
  if (customerId && dealId && !(await db.prepare(SQL.partyExists).bind(dealId, customerId).first())) throw invalid(["dealId"]);
}

const linkValues = (customerId, dealId) => [customerId, customerId, dealId, dealId, customerId, dealId, dealId, customerId];

async function loadNote(db, id) {
  return (await db.prepare(SQL.noteById).bind(id).first()) ?? null;
}

function linkChanged() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 손님·거래 연결이 바뀌었습니다. 다시 불러온 뒤 저장해 주세요.", 409);
}

async function createNote(ctx) {
  const input = parseNoteCreate(ctx.body);
  await assertLinks(ctx.db, input);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  const statements = [ctx.db.prepare(SQL.noteInsert).bind(id, input.customerId, input.dealId, input.body, at, at, ...linkValues(input.customerId, input.dealId))];
  if (input.customerId) {
    // 손님 메모를 쓰면 그 손님의 마지막 연락일을 오늘로, 정리 안내 기준일을 +1년으로(8.7절 설계 선택). version은 올리지 않는다.
    // 메모가 실제로 들어갔을 때만 바꾼다.
    const today = koreaDate(ctx.now);
    statements.push(ctx.db.prepare(SQL.customerTouchContactIfNote).bind(today, addOneYear(today), input.customerId, id));
  }
  statements.push(auditIfUpdatedStatement(ctx.db, "notes", auditBase(ctx, "note.create", { targetType: "note", targetId: id, reason: maskReason(input.rrnMasked) }), { id, version: 1, updatedAt: at }));
  const results = await runBatch(ctx.db, statements);
  if (changesOf(results[0]) === 0) throw linkChanged();
  return { status: 201, data: { note: noteView(await loadNote(ctx.db, id)) } };
}

async function updateNote(ctx, id) {
  const input = parseNotePatch(ctx.body);
  const current = await loadNote(ctx.db, id);
  if (!current) throw notFound();
  // 고친 뒤의 연결(준 값 또는 지금 값)로 확인한다. 지금 값은 같은 version일 때만 쓰이므로 guard의 version 조건이 함께 지킨다.
  const customerGiven = "customerId" in input.changes ? 1 : 0;
  const dealGiven = "dealId" in input.changes ? 1 : 0;
  const customerId = customerGiven ? input.changes.customerId : current.customer_id;
  const dealId = dealGiven ? input.changes.dealId : current.deal_id;
  if (current.version !== input.version) throw versionConflict();
  await assertLinks(ctx.db, { customerId, dealId });
  const at = new Date(ctx.now).toISOString();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.noteVersionGuard).bind(id, input.version, ...linkValues(customerId, dealId)),
      ctx.db.prepare(SQL.noteUpdate).bind(
        input.changes.body ?? null,
        customerGiven,
        customerGiven ? input.changes.customerId : null,
        dealGiven,
        dealGiven ? input.changes.dealId : null,
        at,
        id,
        input.version,
        ...linkValues(customerId, dealId),
      ),
      auditStatement(ctx.db, { ...auditBase(ctx, "note.update", { targetType: "note", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    // guard가 되돌렸으면 메모 없음 404, 다른 화면이 먼저 고침 409, 그사이 손님·거래 연결이 바뀜 409. 그 밖에는 저장소 오류 그대로.
    const latest = await loadNote(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    try {
      await assertLinks(ctx.db, { customerId, dealId });
    } catch {
      throw linkChanged();
    }
    throw error;
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
