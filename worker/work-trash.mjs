// 업무 도구 휴지통 7일(기획서 WT-2-13, 설계서 8.7절, 0007, 2026-11-21 사용자 결정 02:39:45). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// - 지우는 batch(손님·거래·메모·일정·장부 줄·할 일)는 지우기·끊기 문장마다 바로 앞에 같은 WHERE의 복사 문장을 둔다.
//   복사·되살리기 SQL은 모듈을 읽을 때 표별 칸 목록 상수(TRASH_COLUMNS)로 한 번 만든다(요청 값은 bind로만).
// - 이 파일은 work-customers.mjs 등 경로 파일을 가져오지 않는다. 그 파일들이 모듈을 읽을 때 이 파일의 도우미로 SQL을 만들기 때문이다(순환 import 방지).
// - 감사 기록에는 묶음 id만 남기고 이름·제목·메모 내용(label·row_json)은 남기지 않는다.
// - 휴지통 자료도 손님 개인정보다. 7일 뒤 Cron(work-scheduled.mjs runTrashExpire)이 켜기 값과 상관없이 영구 삭제한다.
// - 파일(사진, F-a): R2 객체는 휴지통에 있는 동안 그대로 두고, 영구 삭제·7일 만료 때 원본·미리보기 두 키를 R2에서 먼저 지운 뒤 휴지통 행을 지운다(DEC-WT-37).
//   R2 삭제가 실패하면 휴지통 행을 남긴다(D1에는 없는데 R2에 남은 파일을 만들지 않음). R2에 이미 없는 키는 성공으로 본다(R2 delete 동작).
import { WorkApiError, hasR2 } from "./work-security.mjs";
import { auditStatement, changesOf, loadThenAudit, runBatch } from "./work-audit.mjs";
import { encodeCursor, invalid, isUuid, koreaDate, parseTrashPurge, parseTrashQuery } from "./work-input.mjs";

export const TRASH_KEEP_DAYS = 7;
export const TRASH_EXPIRE_PER_ROUND = 100;
export const TRASH_EXPIRE_MAX_ROUNDS = 10;
export const TRASH_CRON_ACTOR = "system:cron";
const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// 표별 칸 목록(PRAGMA table_info 순서). 복사(json_object)와 되살리기(json_extract)가 같이 쓴다.
// 새 마이그레이션이 칸을 보태면 tests/work-trash.test.mjs T2-92c가 깨져 이 목록을 함께 고치게 한다.
// 파일(files)은 사진 서버 PR(F-a)에서 넣었다(0007 CHECK에는 미리 있음).
export const TRASH_COLUMNS = Object.freeze({
  customers: Object.freeze(["id", "display_name", "phone_digits", "needs", "status", "last_contact_on", "retention_until", "version", "created_at", "updated_at"]),
  deals: Object.freeze([
    "id", "title", "deal_type", "property_kind", "property_label", "price_won", "deposit_won", "monthly_rent_won", "contract_on", "middle_payment_on",
    "balance_on", "buyer_is_corporation", "regulated_area", "land_permit_area", "metro_area", "status", "closed_on", "retention_until", "version",
    "created_at", "updated_at", "sale_kind", "regulation", "schedule_target", "land_share", "separate_funding_submission", "lease_reporting_region",
    "lease_renewal_without_change",
  ]),
  files: Object.freeze([
    "id", "r2_key", "kind", "mime_type", "byte_size", "sha256_hex", "customer_id", "deal_id", "rrn_masked", "caption", "extracted_text", "recording_group_id",
    "recording_index", "retention_until", "created_at",
  ]),
  deal_parties: Object.freeze(["deal_id", "customer_id", "role"]),
  deal_events: Object.freeze(["id", "deal_id", "kind", "due_on", "title", "alarm_offsets", "source", "done_at", "version", "created_at", "updated_at"]),
  notes: Object.freeze(["id", "customer_id", "deal_id", "body", "source", "file_id", "version", "created_at", "updated_at"]),
  tasks: Object.freeze(["id", "title", "deal_id", "due_on", "repeat_rule", "repeat_day", "done_at", "next_task_id", "version", "created_at", "updated_at"]),
  ledger_entries: Object.freeze([
    "id", "kind", "deal_id", "payer_role", "label", "entry_on", "amount_won", "vat_won", "received_won", "received_on", "snap_contract_on",
    "snap_balance_on", "memo", "version", "created_at", "updated_at",
  ]),
  // 거래 없는 일정(0009). 손님·거래에 붙지 않아 되살릴 때 늘 넣을 수 있다.
  appointments: Object.freeze([
    "id", "tag", "title", "starts_on", "start_time", "end_time", "repeat_rule", "repeat_until", "skip_dates", "alarms", "series_id", "series_on", "version",
    "created_at", "updated_at",
  ]),
});
// 되살리는 순서(고정, R-1): 손님 → 거래 → 파일 → 참여자 → 일정 → 메모 → 할 일 → 장부 줄 → 거래 없는 일정. 그 뒤에 끊은 연결·줄인 반복을 되돌린다.
// 파일은 손님·거래 뒤(외래 키), 메모 앞(메모의 file_id가 되살린 파일을 가리키게, F-6).
const ROW_TABLES = Object.freeze(["customers", "deals", "files", "deal_parties", "deal_events", "notes", "tasks", "ledger_entries", "appointments"]);
// 응답(counts·restored·skipped)의 표 이름.
const VIEW_KEY = Object.freeze({
  customers: "customers", deals: "deals", files: "files", deal_parties: "parties", deal_events: "events", notes: "notes", tasks: "tasks", ledger_entries: "ledger",
  appointments: "appointments",
});
const CURRENT_SCHEMA = "(SELECT CAST(value_json AS INTEGER) FROM settings WHERE key = 'schema_version')";
// 미리보기 사본(Q-2)의 R2 키 = 원본 키 + 이 꼬리(확장자 없음, WebP·JPEG는 httpMetadata.contentType으로 구분. D1 칸 없음). 영구 삭제·만료는 두 키를 함께 지운다.
export const FILE_THUMB_SUFFIX = ".thumb";
export const r2KeysOf = (r2Key) => [r2Key, r2Key + FILE_THUMB_SUFFIX];
const R2_DELETE_MAX_KEYS = 1000; // R2 delete(keys[]) 한 번에 1,000개까지

// ── 지우는 batch에 넣는 문장 ────────────────────────────────────────────────

// 휴지통 묶음(조건 batchWhere)의 파일 행을 읽은, 끝난 AI 작업 묶음의 행을 모두 지우는 문장(purgeAiJobs·expireAiJobs).
const aiJobsOfTrashFilesSql = (batchWhere) => "DELETE FROM ai_jobs WHERE group_id IN (SELECT j.group_id FROM ai_jobs j JOIN json_each(j.input_file_ids) e"
  + " JOIN trash_rows r ON r.row_id = e.value AND r.table_name = 'files' AND r.op = 'row' WHERE " + batchWhere + ")"
  + " AND group_id NOT IN (SELECT group_id FROM ai_jobs WHERE status IN ('queued','in_progress'))";
const rowIdOf = (table) => (table === "deal_parties" ? "deal_id || '|' || customer_id || '|' || role" : "id");

function rowJsonOf(table) {
  const columns = TRASH_COLUMNS[table];
  if (!columns) throw new Error("unknown trash table");
  const pairs = columns.map((column) => "'" + column + "', " + column);
  // 장부 줄 한 건 삭제: 붙어 있던 거래의 날짜·제목을 함께 적어 둔다. 되살릴 때 그 거래가 없으면 LEDGER_DETACH_SET과 같은 값으로 채운다(날짜 없는 줄이 되지 않게).
  // json()으로 감싸야 하위 질의 결과가 글자가 아니라 JSON 객체로 들어간다.
  if (table === "ledger_entries") {
    pairs.push("'deal_snap', json((SELECT json_object('contract_on', d.contract_on, 'balance_on', d.balance_on, 'title', d.title) FROM deals d WHERE d.id = ledger_entries.deal_id))");
  }
  return "json_object(" + pairs.join(", ") + ")";
}

// 지운 행 전체를 옮겨 적는 문장. whereSql은 짝인 지우기 문장의 WHERE 뒤 글과 같아야 한다(? 순서도 같음). 첫 ?는 묶음 id.
export function trashRowsSql(table, whereSql) {
  return "INSERT INTO trash_rows (batch_id, table_name, op, row_id, row_json) SELECT ?, '" + table + "', 'row', " + rowIdOf(table) + ", "
    + rowJsonOf(table) + " FROM " + table + " WHERE " + whereSql;
}

// 끊는 연결을 끊기 전 값으로 옮겨 적는 문장. ledger_deal의 version_after는 끊은 뒤 version(LEDGER_DETACH_SET이 +1 함).
const LINK_SOURCES = Object.freeze({
  note_customer: ["notes", "json_object('id', id, 'customer_id', customer_id)"],
  note_deal: ["notes", "json_object('id', id, 'deal_id', deal_id)"],
  ledger_deal: ["ledger_entries", "json_object('id', id, 'deal_id', deal_id, 'snap_contract_on', snap_contract_on, 'snap_balance_on', snap_balance_on, 'label', label, 'version_after', version + 1)"],
  // 반복 일정 줄이기('이 날만' 지우기·'이 날부터 모두' 지우기, 0009): 줄이기 전 끝나는 날·뺀 날과 줄인 뒤 version을 적어 둔다.
  // 되살릴 때 그 줄의 version이 version_after 그대로일 때만 옛 값으로 돌린다(그사이 고쳤으면 'changed'로 건너뜀).
  appt_series: ["appointments", "json_object('id', id, 'repeat_until', repeat_until, 'skip_dates', json(skip_dates), 'version_after', version + 1)"],
});

export function trashLinksSql(op, whereSql) {
  const source = LINK_SOURCES[op];
  if (!source) throw new Error("unknown trash link");
  return "INSERT INTO trash_rows (batch_id, table_name, op, row_id, row_json) SELECT ?, '" + source[0] + "', '" + op + "', id, " + source[1]
    + " FROM " + source[0] + " WHERE " + whereSql;
}

// 묶음 넣기. label은 그 순간의 원래 행에서 SQL이 만든다(Worker가 이름을 다루지 않음). 구조 번호도 그 순간 settings 값이다.
const BATCH_SOURCES = Object.freeze({
  customer: ["customers", "substr(display_name, 1, 80)"],
  deal: ["deals", "substr(title, 1, 80)"],
  note: ["notes", "coalesce(nullif(substr(trim(replace(replace(replace(body, char(13), ' '), char(10), ' '), char(9), ' ')), 1, 40), ''), '메모')"],
  event: ["deal_events", "substr(title, 1, 80)"],
  ledger: ["ledger_entries", "substr(CASE WHEN label <> '' THEN label ELSE '장부 줄 ' || amount_won || '원' END, 1, 80)"],
  task: ["tasks", "substr(title, 1, 80)"],
  // 사진 한 장(F-5, 사용자 2026-11-22 15:39:08): 설명이 있으면 설명 앞 40자, 없으면 "사진 · 11월 22일 14:05 올림"(올린 시각 created_at을 한국 시각으로,
  // 월·일은 앞 0 없이, 시:분은 두 자리). 손님 이름은 넣지 않는다. 계약서 사본(단계 4 K-a)은 설명이 있든 없든 앞에 '계약서 사본 · '을 붙인다.
  file: ["files", "coalesce(substr(CASE WHEN kind = 'contract_copy' THEN '계약서 사본 · ' WHEN caption <> '' THEN '' ELSE '사진 · ' END"
    + " || CASE WHEN caption <> '' THEN substr(caption, 1, 40) ELSE CAST(strftime('%m', created_at, '+9 hours') AS INTEGER) || '월 '"
    + " || CAST(strftime('%d', created_at, '+9 hours') AS INTEGER) || '일 ' || strftime('%H:%M', created_at, '+9 hours') || ' 올림' END, 1, 80), '사진')"],
});
const BATCH_INSERT_SQL = Object.freeze(Object.fromEntries(Object.entries(BATCH_SOURCES).map(([kind, [table, label]]) => [kind,
  "INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after)"
  + " SELECT ?, '" + kind + "', id, " + label + ", " + CURRENT_SCHEMA + ", ?, ?, ?, ? FROM " + table + " WHERE id = ?",
])));

// 지우는 요청 하나의 묶음: { batchId, purgeAfter, statement(묶음 넣기), trash(응답에 붙일 값) }.
export function trashBatchFor(ctx, kind, targetId) {
  const sql = BATCH_INSERT_SQL[kind];
  if (!sql) throw new Error("unknown trash kind");
  const batchId = ctx.randomUUID();
  const purgeAfter = iso(ctx.now + TRASH_KEEP_DAYS * DAY_MS);
  return {
    batchId,
    purgeAfter,
    statement: ctx.db.prepare(sql).bind(batchId, iso(ctx.now), ctx.actor.email.toLowerCase(), ctx.requestId, purgeAfter, targetId),
    trash: { batchId, purgeAfter },
  };
}

// 거래 없는 일정 묶음(0009): 종류는 기존 '일정'(event)을 같이 쓴다(휴지통 거르기·글을 늘리지 않음).
// 이름은 그 순간의 일정 제목에 Worker가 정한 날짜 꼬리(반복 줄의 하루 지우기면 " · 12월 10일", 아니면 "")를 붙인다(꼬리를 넣어도 80자 안).
const APPOINTMENT_BATCH_SQL = "INSERT INTO trash_batches (id, kind, target_id, label, schema_version, deleted_at, deleted_by, request_id, purge_after)"
  + " SELECT ?, 'event', id, substr(title, 1, 80 - length(?)) || ?, " + CURRENT_SCHEMA + ", ?, ?, ?, ? FROM appointments WHERE id = ?";

export function trashAppointmentBatchFor(ctx, targetId, labelTail = "") {
  const batchId = ctx.randomUUID();
  const purgeAfter = iso(ctx.now + TRASH_KEEP_DAYS * DAY_MS);
  return {
    batchId,
    purgeAfter,
    statement: ctx.db.prepare(APPOINTMENT_BATCH_SQL).bind(batchId, labelTail, labelTail, iso(ctx.now), ctx.actor.email.toLowerCase(), ctx.requestId, purgeAfter, targetId),
    trash: { batchId, purgeAfter },
  };
}

// 이름 붙인 batch(R-3): 결과의 바뀐 행 수를 자리 번호 대신 문장 이름으로 읽는다. 손님·거래 삭제 batch에만 쓴다.
export function namedStatements(entries) {
  const names = entries.map(([name]) => name);
  if (new Set(names).size !== names.length) throw new Error("duplicate statement name");
  return {
    statements: entries.map(([, statement]) => statement),
    changes(results, name) {
      const index = names.indexOf(name);
      if (index < 0) throw new Error("unknown statement name");
      return changesOf(results[index]);
    },
  };
}

// ── 휴지통 API ───────────────────────────────────────────────────────────

function notFound() {
  return new WorkApiError("NOT_FOUND", "요청한 업무 자료를 찾지 못했습니다.", 404);
}

function methodNotAllowed(allow) {
  const error = new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405);
  error.allow = allow;
  return error;
}

function schemaChanged() {
  return new WorkApiError("TRASH_SCHEMA_CHANGED", "지운 뒤 업무 자료 구조가 바뀌어 되살릴 수 없습니다. 영구 삭제만 할 수 있습니다.", 409);
}

function auditBase(ctx, action, extra = {}) {
  return { at: iso(ctx.now), actorEmail: ctx.actor.email, action, requestId: ctx.requestId, ...extra };
}

// 목록 줄의 함께 든 것 수: 지울 때 값이 아니라 지금 trash_rows에서 센다(일부만 되살리고 남은 묶음도 맞게 보이게, 대장 2026-11-22).
const COUNT_COLUMNS = ROW_TABLES.map((table) => "(SELECT count(*) FROM trash_rows r WHERE r.batch_id = b.id AND r.op = 'row' AND r.table_name = '"
  + table + "') AS n_" + VIEW_KEY[table]).join(", ")
  + ", (SELECT count(*) FROM trash_rows r WHERE r.batch_id = b.id AND r.op = 'appt_series') AS n_appt_series";

// T: UPDATE trash_rows 문장 안에서 옮겨 적은 칸 값. J: trash_rows r을 읽는 SELECT 안에서 옮겨 적은 칸 값.
const T = (column) => "json_extract(trash_rows.row_json, '$." + column + "')";
const J = (column) => "json_extract(r.row_json, '$." + column + "')";
const UNMARKED = "json_extract(r.row_json, '$._skip') IS NULL";
const existsIn = (table, column) => "EXISTS (SELECT 1 FROM " + table + " x WHERE x.id = " + J(column) + ")";

// 원래 표에 그 행이 있음(UPDATE trash_rows 문장 안에서).
function presentSql(table) {
  if (table === "deal_parties") {
    return "EXISTS (SELECT 1 FROM deal_parties x WHERE x.deal_id = " + T("deal_id") + " AND x.customer_id = " + T("customer_id") + " AND x.role = " + T("role") + ")";
  }
  return "EXISTS (SELECT 1 FROM " + table + " x WHERE x.id = trash_rows.row_id)";
}

// 되살리기 중 건너뛸 휴지통 행에 까닭(_skip)을 잠깐 적는다. ? 두 개: 까닭, 묶음 id. 바뀐 행 수가 그 까닭의 수다.
// 같은 batch 끝에서 다 된 행은 지우고 남길 행은 표시를 지우므로 표시가 batch 밖에 남지 않는다.
function markSql(table, op, condition) {
  return "UPDATE trash_rows SET row_json = json_set(row_json, '$._skip', ?) WHERE batch_id = ? AND table_name = '" + table + "' AND op = '" + op + "'"
    + " AND json_extract(row_json, '$._skip') IS NULL AND " + condition;
}

function restoreInsertSql(table, overrides = {}, extraWhere = "") {
  const columns = TRASH_COLUMNS[table];
  return "INSERT INTO " + table + " (" + columns.join(", ") + ") SELECT " + columns.map((column) => overrides[column] ?? J(column)).join(", ")
    + " FROM trash_rows r WHERE r.batch_id = ? AND r.table_name = '" + table + "' AND r.op = 'row' AND " + UNMARKED + extraWhere;
}

// 메모 연결이 그대로 맞음: 손님·거래가 있고, 둘 다 있으면 그 손님이 그 거래 참여자(work-customers.mjs NOTE_LINK_OK와 같은 규칙), 파일이 있음.
const PARTY_OF_NOTE = "EXISTS (SELECT 1 FROM deal_parties x WHERE x.deal_id = " + J("deal_id") + " AND x.customer_id = " + J("customer_id") + ")";
const NOTE_LINKS_OK = "(" + J("customer_id") + " IS NULL OR " + existsIn("customers", "customer_id") + ")"
  + " AND (" + J("deal_id") + " IS NULL OR " + existsIn("deals", "deal_id") + ")"
  + " AND (" + J("customer_id") + " IS NULL OR " + J("deal_id") + " IS NULL OR " + PARTY_OF_NOTE + ")"
  + " AND (" + J("file_id") + " IS NULL OR " + existsIn("files", "file_id") + ")";
const LEDGER_DEAL_GONE = J("deal_id") + " IS NOT NULL AND NOT " + existsIn("deals", "deal_id");
const linkSub = (table, op, column) => "(SELECT " + J(column) + " FROM trash_rows r WHERE r.batch_id = ? AND r.table_name = '" + table + "' AND r.op = '" + op
  + "' AND r.row_id = " + table + ".id)";
const linkRow = (table, op, condition) => "EXISTS (SELECT 1 FROM trash_rows r WHERE r.batch_id = ? AND r.table_name = '" + table + "' AND r.op = '" + op
  + "' AND r.row_id = " + table + ".id AND " + UNMARKED + " AND " + condition + ")";
const NOTE_GONE = "NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = trash_rows.row_id)";
const ENTRY_GONE = "NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.id = trash_rows.row_id)";
const APPOINTMENT_GONE = "NOT EXISTS (SELECT 1 FROM appointments a WHERE a.id = trash_rows.row_id)";

// 까닭: 다 된 것(exists·relinked·changed)은 휴지통에서 지우고, 없는 대상(*_missing)은 휴지통에 남긴다(R-2). 표 이름은 응답 이름.
// 앞(넣기 전)에 보는 것: 같은 행이 이미 있음, 끊었던 연결을 그사이 다시 붙임, 장부 줄을 그사이 고침.
const SKIP_BEFORE = Object.freeze([
  ...ROW_TABLES.map((table) => ({ table: VIEW_KEY[table], reason: "exists", sql: markSql(table, "row", presentSql(table)) })),
  { table: "noteCustomer", reason: "relinked", sql: markSql("notes", "note_customer", "EXISTS (SELECT 1 FROM notes n WHERE n.id = trash_rows.row_id AND n.customer_id IS NOT NULL)") },
  { table: "noteDeal", reason: "relinked", sql: markSql("notes", "note_deal", "EXISTS (SELECT 1 FROM notes n WHERE n.id = trash_rows.row_id AND n.deal_id IS NOT NULL)") },
  { table: "ledgerDeal", reason: "changed", sql: markSql("ledger_entries", "ledger_deal", "EXISTS (SELECT 1 FROM ledger_entries e WHERE e.id = trash_rows.row_id"
    + " AND (e.deal_id IS NOT NULL OR e.version <> " + T("version_after") + "))") },
  { table: "appointmentSeries", reason: "changed", sql: markSql("appointments", "appt_series", "EXISTS (SELECT 1 FROM appointments a WHERE a.id = trash_rows.row_id"
    + " AND a.version <> " + T("version_after") + ")") },
]);
// 뒤(넣은 뒤)에 보는 것: 넣지 못한 행. 앞 줄이 먼저 표시하므로 둘 다 없으면 앞 까닭(거래 없음·메모 없음)이 된다.
const SKIP_AFTER = Object.freeze([
  { table: "files", reason: "deal_missing", sql: markSql("files", "row", "NOT " + presentSql("files") + " AND " + T("deal_id") + " IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals x WHERE x.id = " + T("deal_id") + ")") },
  { table: "files", reason: "customer_missing", sql: markSql("files", "row", "NOT " + presentSql("files")) },
  { table: "events", reason: "deal_missing", sql: markSql("deal_events", "row", "NOT " + presentSql("deal_events")) },
  { table: "parties", reason: "deal_missing", sql: markSql("deal_parties", "row", "NOT " + presentSql("deal_parties") + " AND NOT EXISTS (SELECT 1 FROM deals x WHERE x.id = " + T("deal_id") + ")") },
  { table: "parties", reason: "customer_missing", sql: markSql("deal_parties", "row", "NOT " + presentSql("deal_parties")) },
  { table: "noteCustomer", reason: "note_missing", sql: markSql("notes", "note_customer", NOTE_GONE) },
  { table: "noteCustomer", reason: "customer_missing", sql: markSql("notes", "note_customer", "NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = trash_rows.row_id AND n.customer_id IS NOT NULL)") },
  { table: "noteDeal", reason: "note_missing", sql: markSql("notes", "note_deal", NOTE_GONE) },
  { table: "noteDeal", reason: "deal_missing", sql: markSql("notes", "note_deal", "NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = trash_rows.row_id AND n.deal_id IS NOT NULL)") },
  { table: "ledgerDeal", reason: "entry_missing", sql: markSql("ledger_entries", "ledger_deal", ENTRY_GONE) },
  { table: "ledgerDeal", reason: "deal_missing", sql: markSql("ledger_entries", "ledger_deal", "NOT EXISTS (SELECT 1 FROM ledger_entries e WHERE e.id = trash_rows.row_id AND e.deal_id IS NOT NULL)") },
  // 줄인 반복 줄이 그사이 지워졌으면 휴지통에 남긴다(그 줄의 묶음을 되살린 뒤 다시 누르면 돌아감).
  { table: "appointmentSeries", reason: "appointment_missing", sql: markSql("appointments", "appt_series", APPOINTMENT_GONE) },
]);

const SQL = Object.freeze({
  list:
    "SELECT b.id, b.kind, b.label, b.deleted_at, b.purge_after, b.schema_version = " + CURRENT_SCHEMA + " AS restorable, " + COUNT_COLUMNS + ","
    + " (SELECT count(*) FROM trash_rows r WHERE r.batch_id = b.id AND r.op NOT IN ('row', 'appt_series')) AS n_links FROM trash_batches b"
    + " WHERE (? IS NULL OR b.deleted_at < ? OR (b.deleted_at = ? AND b.id < ?)) ORDER BY b.deleted_at DESC, b.id DESC LIMIT ?",
  batchById: "SELECT id, schema_version = " + CURRENT_SCHEMA + " AS restorable FROM trash_batches WHERE id = ?",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(설계서 8.5절).
  restoreGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM trash_batches WHERE id = ? AND schema_version = " + CURRENT_SCHEMA + ") THEN json('guard') ELSE 1 END AS ok",
  purgeGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM trash_batches WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  // 되살리기: 표 순서대로 넣는다(ROW_TABLES). 표시(_skip)가 없는 행만.
  restoreCustomers: restoreInsertSql("customers"),
  restoreDeals: restoreInsertSql("deals"),
  // 파일: 주인(손님·거래)이 있을 때만. 주인이 없으면 넣지 않고 customer_missing(·deal_missing)으로 휴지통에 남긴다(F-6, 주인 없는 사진을 만들지 않음).
  restoreFiles: restoreInsertSql("files", {}, " AND (" + J("customer_id") + " IS NOT NULL OR " + J("deal_id") + " IS NOT NULL)"
    + " AND (" + J("customer_id") + " IS NULL OR " + existsIn("customers", "customer_id") + ")"
    + " AND (" + J("deal_id") + " IS NULL OR " + existsIn("deals", "deal_id") + ")"),
  restoreParties: restoreInsertSql("deal_parties", {}, " AND " + existsIn("deals", "deal_id") + " AND " + existsIn("customers", "customer_id")),
  restoreEvents: restoreInsertSql("deal_events", {}, " AND " + existsIn("deals", "deal_id")),
  // 메모 ①: 연결이 그대로 맞는 메모. ②: 나머지는 맞지 않는 칸만 비우고 넣는다(메모를 잃지 않음). ②의 수가 notesUnlinked.
  restoreNotes: restoreInsertSql("notes", {}, " AND " + NOTE_LINKS_OK),
  restoreNotesUnlinked: restoreInsertSql("notes", {
    customer_id: "CASE WHEN " + existsIn("customers", "customer_id") + " THEN " + J("customer_id") + " END",
    deal_id: "CASE WHEN " + existsIn("deals", "deal_id") + " AND (NOT " + existsIn("customers", "customer_id") + " OR " + PARTY_OF_NOTE + ") THEN " + J("deal_id") + " END",
    file_id: "CASE WHEN " + existsIn("files", "file_id") + " THEN " + J("file_id") + " END",
  }, " AND NOT EXISTS (SELECT 1 FROM notes x WHERE x.id = " + J("id") + ")"),
  // 할 일: 거래가 없으면 deal_id NULL(next_task_id는 REFERENCES가 없어 그대로).
  restoreTasks: restoreInsertSql("tasks", { deal_id: "CASE WHEN " + existsIn("deals", "deal_id") + " THEN " + J("deal_id") + " END" }),
  // 장부 줄: 거래가 없으면 deal_id NULL, snap_*·빈 label을 지울 때 적어 둔 거래 값(deal_snap)으로 채운다(LEDGER_DETACH_SET과 같은 값).
  restoreLedger: restoreInsertSql("ledger_entries", {
    deal_id: "CASE WHEN " + existsIn("deals", "deal_id") + " THEN " + J("deal_id") + " END",
    snap_contract_on: "CASE WHEN " + LEDGER_DEAL_GONE + " THEN json_extract(r.row_json, '$.deal_snap.contract_on') ELSE " + J("snap_contract_on") + " END",
    snap_balance_on: "CASE WHEN " + LEDGER_DEAL_GONE + " THEN json_extract(r.row_json, '$.deal_snap.balance_on') ELSE " + J("snap_balance_on") + " END",
    label: "CASE WHEN " + LEDGER_DEAL_GONE + " AND " + J("label") + " = '' THEN coalesce(substr(json_extract(r.row_json, '$.deal_snap.title'), 1, 120), '') ELSE "
      + J("label") + " END",
  }),
  // 끊은 연결 되돌리기: 메모가 있고 그 칸이 아직 비었고 대상이 있을 때만. version은 끊을 때처럼 올리지 않는다. ? 두 개: 묶음 id ×2.
  relinkNoteCustomer:
    "UPDATE notes SET customer_id = " + linkSub("notes", "note_customer", "customer_id")
    + " WHERE customer_id IS NULL AND " + linkRow("notes", "note_customer", existsIn("customers", "customer_id")),
  relinkNoteDeal:
    "UPDATE notes SET deal_id = " + linkSub("notes", "note_deal", "deal_id")
    + " WHERE deal_id IS NULL AND " + linkRow("notes", "note_deal", existsIn("deals", "deal_id")),
  // 장부 줄: 끊은 직후 그대로(deal_id NULL, version = version_after)이고 거래가 있을 때만 끊기 전 값으로, version + 1.
  // ? 순서: 묶음 id ×4, updated_at, 묶음 id.
  relinkLedger:
    "UPDATE ledger_entries SET deal_id = " + linkSub("ledger_entries", "ledger_deal", "deal_id")
    + ", snap_contract_on = " + linkSub("ledger_entries", "ledger_deal", "snap_contract_on")
    + ", snap_balance_on = " + linkSub("ledger_entries", "ledger_deal", "snap_balance_on")
    + ", label = " + linkSub("ledger_entries", "ledger_deal", "label")
    + ", version = version + 1, updated_at = ? WHERE deal_id IS NULL AND "
    + linkRow("ledger_entries", "ledger_deal", existsIn("deals", "deal_id") + " AND ledger_entries.version = " + J("version_after")),
  // 거래 없는 일정(0009): 늘 넣는다('이 날만 고친' 줄의 원래 반복 줄이 없어도 혼자 서는 일정이 됨).
  restoreAppointments: restoreInsertSql("appointments"),
  // 줄인 반복 줄: 줄인 직후 그대로(version = version_after)일 때만 줄이기 전 끝나는 날·뺀 날로, version + 1. ? 순서: 묶음 id ×3, updated_at, 묶음 id.
  relinkAppointmentSeries:
    "UPDATE appointments SET repeat_until = " + linkSub("appointments", "appt_series", "repeat_until")
    + ", skip_dates = json(" + "(SELECT json_extract(r.row_json, '$.skip_dates') FROM trash_rows r WHERE r.batch_id = ? AND r.table_name = 'appointments' AND r.op = 'appt_series'"
    + " AND r.row_id = appointments.id))"
    + ", version = version + 1, updated_at = ? WHERE "
    + linkRow("appointments", "appt_series", "appointments.version = " + J("version_after")),
  // 감사(trash.restore): 건너뛴 행 수를 batch 안에서 센다(표시가 붙은 행 = 건너뜀).
  restoreAudit:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)"
    + " SELECT ?, ?, 'trash.restore', 'trash', ?, ?, 'ok', 'skipped=' || (SELECT count(*) FROM trash_rows WHERE batch_id = ? AND json_extract(row_json, '$._skip') IS NOT NULL)",
  // 되살렸거나 다 된 행은 지우고, 없는 대상(*_missing) 행은 표시를 지워 남긴다. 남은 행이 없으면 묶음도 지운다(R-2).
  restoreCleanup: "DELETE FROM trash_rows WHERE batch_id = ? AND coalesce(json_extract(row_json, '$._skip'), '') IN ('', 'exists', 'relinked', 'changed')",
  restoreUnmark: "UPDATE trash_rows SET row_json = json_remove(row_json, '$._skip') WHERE batch_id = ?",
  batchDeleteIfEmpty: "DELETE FROM trash_batches WHERE id = ? AND NOT EXISTS (SELECT 1 FROM trash_rows WHERE batch_id = ?)",
  // 영구 삭제하는 묶음의 파일 행(계약서 사본 등)을 읽은 AI 작업 묶음을 같은 batch에서 지운다(설계서 14.10절 약점 4: result_json의 원문 근거에
  // 계약서 글이 들어 있음). ai_jobs에는 거래 칸이 없어 input_file_ids로 찾는다. 거래를 지운 묶음에는 그 거래의 파일 행이 함께 들어 있다.
  // 열린 행(queued·in_progress)이 있는 AI 묶음은 건드리지 않는다(예약 비용·조회 Cron이 씀). 끝난 뒤 30일 정리(work-ai-expire.mjs)가 지운다.
  // trash_rows를 지우기 전에 돌아야 한다(파일 ID를 거기서 읽음).
  purgeAiJobs: aiJobsOfTrashFilesSql("r.batch_id = ?"),
  purgeRows: "DELETE FROM trash_rows WHERE batch_id = ?",
  purgeBatch: "DELETE FROM trash_batches WHERE id = ?",
  // 묶음 안 파일 행의 R2 키(영구 삭제·만료 때 R2를 먼저 지움). 되살려 휴지통에서 빠진 파일은 들어 있지 않다.
  purgeFileKeys: "SELECT json_extract(row_json, '$.r2_key') AS r2_key FROM trash_rows WHERE batch_id = ? AND table_name = 'files' AND op = 'row' ORDER BY row_id",
  expireFileKeys:
    "SELECT batch_id, json_extract(row_json, '$.r2_key') AS r2_key FROM trash_rows WHERE batch_id IN (SELECT value FROM json_each(?)) AND table_name = 'files' AND op = 'row'"
    + " ORDER BY batch_id, row_id",
  // 7일 뒤 영구 삭제(Cron): 고른 묶음 id 목록(JSON 배열 하나로 bind)을 기한을 다시 보고 지운다(그사이 되살려 없어진 묶음은 감사도 남지 않음).
  // 이번 실행에서 R2를 지우지 못해 건너뛴 묶음(JSON 배열)은 다시 고르지 않는다(다음 날 다시).
  expirePick: "SELECT id FROM trash_batches WHERE purge_after <= ? AND id NOT IN (SELECT value FROM json_each(?)) ORDER BY purge_after, id LIMIT ?",
  expireAudit:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason)"
    + " SELECT ?, ?, 'trash.expire', 'trash', id, ?, 'ok', NULL FROM trash_batches WHERE id IN (SELECT value FROM json_each(?)) AND purge_after <= ?",
  expireAiJobs: aiJobsOfTrashFilesSql("r.batch_id IN (SELECT id FROM trash_batches WHERE id IN (SELECT value FROM json_each(?)) AND purge_after <= ?)"),
  expireRows: "DELETE FROM trash_rows WHERE batch_id IN (SELECT id FROM trash_batches WHERE id IN (SELECT value FROM json_each(?)) AND purge_after <= ?)",
  expireBatches: "DELETE FROM trash_batches WHERE id IN (SELECT value FROM json_each(?)) AND purge_after <= ?",
  expireLeft: "SELECT 1 AS ok FROM trash_batches WHERE purge_after <= ? AND id NOT IN (SELECT value FROM json_each(?)) LIMIT 1",
});

// 남은 날: 한국 날짜 기준(purge_after의 한국 날짜 − 오늘 한국 날짜, 0 아래로 내려가지 않음). 0이면 화면이 "! 곧 영구 삭제 · 7일이 지나 다음 새벽 정리 때 지워집니다".
export function trashDaysLeft(purgeAfter, nowMs) {
  const days = (Date.parse(koreaDate(Date.parse(purgeAfter)) + "T00:00:00.000Z") - Date.parse(koreaDate(nowMs) + "T00:00:00.000Z")) / DAY_MS;
  return Math.max(0, Math.round(days));
}

function itemView(row, nowMs) {
  return {
    batchId: row.id,
    kind: row.kind,
    label: row.label,
    deletedAt: row.deleted_at,
    purgeAfter: row.purge_after,
    daysLeft: trashDaysLeft(row.purge_after, nowMs),
    restorable: row.restorable === 1,
    counts: {
      customers: row.n_customers, deals: row.n_deals, files: row.n_files, parties: row.n_parties,
      // 거래 없는 일정(0009)은 화면에서 '일정'으로 함께 센다(지운 줄 + 줄인 반복 줄). appointments는 그 몫이 있을 때만 넣는다(그 밖의 묶음 응답은 0009 전과 같음).
      events: row.n_events + row.n_appointments + row.n_appt_series,
      notes: row.n_notes, tasks: row.n_tasks, ledger: row.n_ledger, links: row.n_links,
      ...(row.n_appointments + row.n_appt_series > 0 ? { appointments: row.n_appointments + row.n_appt_series } : {}),
    },
  };
}

async function listTrash(ctx) {
  const query = parseTrashQuery(ctx.url.searchParams);
  return loadThenAudit(ctx.db, async () => {
    const result = await ctx.db.prepare(SQL.list).bind(
      query.cursor?.time ?? null, query.cursor?.time ?? null, query.cursor?.time ?? null, query.cursor?.id ?? null, query.limit + 1,
    ).all();
    const rows = result?.results ?? [];
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { items: page.map((row) => itemView(row, ctx.now)), nextCursor: rows.length > query.limit && last ? encodeCursor(last.deleted_at, last.id) : null };
  }, (data) => auditBase(ctx, "trash.list", { reason: `result_count=${data.items.length}` }));
}

async function assertRestorable(db, batchId) {
  const row = await db.prepare(SQL.batchById).bind(batchId).first();
  if (!row) throw notFound();
  if (row.restorable !== 1) throw schemaChanged();
}

async function restoreBatch(ctx, batchId) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  await assertRestorable(ctx.db, batchId);
  const prepare = (sql) => ctx.db.prepare(sql);
  const at = iso(ctx.now);
  const restores = [
    ["customers", SQL.restoreCustomers], ["deals", SQL.restoreDeals], ["files", SQL.restoreFiles], ["parties", SQL.restoreParties], ["events", SQL.restoreEvents],
    ["notes", SQL.restoreNotes], ["notesUnlinked", SQL.restoreNotesUnlinked], ["tasks", SQL.restoreTasks], ["ledger", SQL.restoreLedger],
    ["appointments", SQL.restoreAppointments],
  ];
  const entries = [
    ["guard", prepare(SQL.restoreGuard).bind(batchId)],
    ...SKIP_BEFORE.map((skip, index) => [`before${index}`, prepare(skip.sql).bind(skip.reason, batchId)]),
    ...restores.map(([name, sql]) => [`restore:${name}`, prepare(sql).bind(batchId)]),
    ["link:noteCustomer", prepare(SQL.relinkNoteCustomer).bind(batchId, batchId)],
    ["link:noteDeal", prepare(SQL.relinkNoteDeal).bind(batchId, batchId)],
    ["link:ledgerDeal", prepare(SQL.relinkLedger).bind(batchId, batchId, batchId, batchId, at, batchId)],
    ["link:appointmentSeries", prepare(SQL.relinkAppointmentSeries).bind(batchId, batchId, at, batchId)],
    ...SKIP_AFTER.map((skip, index) => [`after${index}`, prepare(skip.sql).bind(skip.reason, batchId)]),
    ["audit", prepare(SQL.restoreAudit).bind(at, ctx.actor.email.toLowerCase(), batchId, ctx.requestId, batchId)],
    ["cleanup", prepare(SQL.restoreCleanup).bind(batchId)],
    ["unmark", prepare(SQL.restoreUnmark).bind(batchId)],
    ["batchDelete", prepare(SQL.batchDeleteIfEmpty).bind(batchId, batchId)],
  ];
  const batch = namedStatements(entries);
  let results;
  try {
    results = await runBatch(ctx.db, batch.statements);
  } catch (error) {
    // guard가 되돌렸으면 그사이 되살렸거나 지운 묶음 404, 구조가 바뀜 409. 그 밖에는 저장소 오류 그대로.
    await assertRestorable(ctx.db, batchId);
    throw error;
  }
  const n = (name) => batch.changes(results, name);
  const skipped = [
    ...SKIP_BEFORE.map((skip, index) => ({ table: skip.table, reason: skip.reason, count: n(`before${index}`) })),
    ...SKIP_AFTER.map((skip, index) => ({ table: skip.table, reason: skip.reason, count: n(`after${index}`) })),
  ].filter((entry) => entry.count > 0);
  return {
    data: {
      restored: {
        customers: n("restore:customers"),
        deals: n("restore:deals"),
        files: n("restore:files"),
        parties: n("restore:parties"),
        events: n("restore:events") + n("restore:appointments") + n("link:appointmentSeries"),
        notes: n("restore:notes") + n("restore:notesUnlinked"),
        tasks: n("restore:tasks"),
        ledger: n("restore:ledger"),
        links: n("link:noteCustomer") + n("link:noteDeal") + n("link:ledgerDeal"),
        notesUnlinked: n("restore:notesUnlinked"),
        // 거래 없는 일정은 휴지통 화면에서 '일정'으로 함께 센다(되살린 줄 + 되돌린 반복 줄). appointments는 그 몫이 있을 때만 넣는다.
        ...(n("restore:appointments") + n("link:appointmentSeries") > 0 ? { appointments: n("restore:appointments") + n("link:appointmentSeries") } : {}),
      },
      skipped,
      remaining: n("unmark"),
    },
  };
}

// R2 키를 1,000개씩 나눠 지운다. 이미 없는 키는 R2가 성공으로 돌려준다. 하나라도 실패하면 예외(부르는 쪽이 휴지통 행을 남김).
export async function deleteR2Keys(files, keys) {
  for (let index = 0; index < keys.length; index += R2_DELETE_MAX_KEYS) {
    await files.delete(keys.slice(index, index + R2_DELETE_MAX_KEYS));
  }
}

function filesDisabled() {
  return new WorkApiError("FILES_DISABLED", "파일 저장소가 아직 켜지지 않았습니다.", 503);
}

function fileStorageFailed() {
  return new WorkApiError("FILE_STORAGE_FAILED", "파일 저장소를 처리하지 못했습니다. 잠시 뒤 다시 해 주세요.", 503, true);
}

async function purgeBatch(ctx, batchId) {
  parseTrashPurge(ctx.body);
  if (!(await ctx.db.prepare(SQL.batchById).bind(batchId).first())) throw notFound();
  // 사진이 든 묶음: R2(원본·미리보기)를 먼저 지운다. 바인딩이 없거나 R2가 실패하면 휴지통 행을 그대로 두고 503(1절 9번).
  const keys = ((await ctx.db.prepare(SQL.purgeFileKeys).bind(batchId).all())?.results ?? []).flatMap((row) => r2KeysOf(row.r2_key));
  if (keys.length > 0) {
    if (!hasR2(ctx.files)) throw filesDisabled();
    try {
      await deleteR2Keys(ctx.files, keys);
    } catch {
      throw fileStorageFailed();
    }
  }
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.purgeGuard).bind(batchId),
      ctx.db.prepare(SQL.purgeAiJobs).bind(batchId),
      ctx.db.prepare(SQL.purgeRows).bind(batchId),
      ctx.db.prepare(SQL.purgeBatch).bind(batchId),
      auditStatement(ctx.db, { ...auditBase(ctx, "trash.purge", { targetType: "trash", targetId: batchId }), outcome: "ok" }),
    ]);
  } catch (error) {
    if (!(await ctx.db.prepare(SQL.batchById).bind(batchId).first())) throw notFound();
    throw error;
  }
  return { data: { purged: true } };
}

// 7일 지난 묶음 영구 삭제(Cron 03:00 차례). 100개씩 고르고 지우기를 지울 것이 없을 때까지, 최대 10번(1,000개) 되풀이한다.
// 한 번(100개)이 한 batch이고 감사 trash.expire는 묶음마다 1줄(작업자 system:cron, 요청 번호 cron-<무작위>는 그 batch 공통).
// 지울 것이 없으면 읽기 1번으로 끝나고 randomUUID도 부르지 않는다. 10번 뒤에도 남으면 backlog: true(부르는 쪽이 경고 로그, 다음 날 이어 감).
// 사진이 든 묶음은 R2(원본·미리보기)를 먼저 지운다(F-a). WORK_FILES 바인딩이 없으면 그 묶음은 건너뛰고(noStorage, 행만 지우면 R2 고아가 생김),
// R2 삭제가 실패한 묶음도 건너뛴다(r2Failed). 건너뛴 묶음은 이번 실행에서 다시 고르지 않고 다음 날 다시 본다. 사진 없는 묶음은 R2를 부르지 않는다.
// R2 삭제는 묶음을 이어 붙여 키 1,000개씩 부른다(실행마다 부르는 수를 줄임).
export async function expireTrash(db, nowMs, randomUUID = () => crypto.randomUUID(), files = null) {
  const nowIso = iso(nowMs);
  let expired = 0;
  let r2Failed = 0;
  let noStorage = 0;
  const skipped = [];
  const done = (rounds, backlog) => ({ expired, rounds, backlog, r2Failed, noStorage });
  for (let round = 1; round <= TRASH_EXPIRE_MAX_ROUNDS; round += 1) {
    const picked = ((await db.prepare(SQL.expirePick).bind(nowIso, JSON.stringify(skipped), TRASH_EXPIRE_PER_ROUND).all())?.results ?? []).map((row) => row.id);
    if (picked.length === 0) return done(round - 1, false);
    const keysByBatch = new Map();
    for (const row of (await db.prepare(SQL.expireFileKeys).bind(JSON.stringify(picked)).all())?.results ?? []) {
      if (!keysByBatch.has(row.batch_id)) keysByBatch.set(row.batch_id, []);
      keysByBatch.get(row.batch_id).push(...r2KeysOf(row.r2_key));
    }
    const ready = picked.filter((id) => !keysByBatch.has(id));
    if (keysByBatch.size > 0 && !hasR2(files)) {
      skipped.push(...keysByBatch.keys());
      noStorage += keysByBatch.size;
    } else if (keysByBatch.size > 0) {
      const chunks = [];
      let current = { ids: [], keys: [] };
      for (const [id, keys] of keysByBatch) {
        if (current.ids.length > 0 && current.keys.length + keys.length > R2_DELETE_MAX_KEYS) {
          chunks.push(current);
          current = { ids: [], keys: [] };
        }
        current.ids.push(id);
        current.keys.push(...keys);
      }
      chunks.push(current);
      for (const chunk of chunks) {
        try {
          await deleteR2Keys(files, chunk.keys);
          ready.push(...chunk.ids);
        } catch {
          skipped.push(...chunk.ids);
          r2Failed += chunk.ids.length;
        }
      }
    }
    if (ready.length > 0) {
      const ids = JSON.stringify(ready);
      const results = await db.batch([
        db.prepare(SQL.expireAudit).bind(nowIso, TRASH_CRON_ACTOR, `cron-${randomUUID()}`, ids, nowIso),
        db.prepare(SQL.expireAiJobs).bind(ids, nowIso),
        db.prepare(SQL.expireRows).bind(ids, nowIso),
        db.prepare(SQL.expireBatches).bind(ids, nowIso),
      ]);
      expired += changesOf(results[3]);
    }
    if (picked.length < TRASH_EXPIRE_PER_ROUND) return done(round, false);
  }
  const left = await db.prepare(SQL.expireLeft).bind(nowIso, JSON.stringify(skipped)).first();
  return done(TRASH_EXPIRE_MAX_ROUNDS, Boolean(left));
}

// 경로가 휴지통(/trash, /trash/:batchId, /trash/:batchId/restore)이면 { status?, data }를, 아니면 null을 돌려준다.
export async function routeWorkTrash(ctx) {
  const [collection, batchId, extra, more] = ctx.route.split("/").filter(Boolean);
  if (collection !== "trash" || more !== undefined) return null;
  if (batchId === undefined) {
    if (ctx.method === "GET") return { data: await listTrash(ctx) };
    throw methodNotAllowed("GET");
  }
  if (extra !== undefined && extra !== "restore") return null;
  if (!isUuid(batchId)) throw notFound();
  if (extra === "restore") {
    if (ctx.method === "POST") return restoreBatch(ctx, batchId);
    throw methodNotAllowed("POST");
  }
  if (ctx.method === "DELETE") return purgeBatch(ctx, batchId);
  throw methodNotAllowed("DELETE");
}
