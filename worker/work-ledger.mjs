// 업무 도구 단계 2 매출장부 API(설계서 6.12·8.2·8.7·8.8·10.2절, DEC-WT-38·39). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// 참고용 집계이며 세무 장부가 아니다. 저장한 금액은 다시 계산하지 않고, 법정 상한·부가세 비교는 경고(warnings)로만 돌려준다.
// 장부 줄 삭제는 휴지통(0007)으로 옮긴 뒤 실제로 지운다(7일 동안 되살림). 거래·손님 삭제 때의 연결 끊기는 work-deals·work-customers의 batch가 한다.
import defaultLegalRules from "../src/data/work/legal-rules.json" with { type: "json" };
import { calculateBrokerageFee, calculateVatWon, selectBrokerageFeeRule } from "../src/lib/work/brokerage-fee.mjs";
import { WorkApiError } from "./work-security.mjs";
import { auditStatement, loadThenAudit, runBatch } from "./work-audit.mjs";
import {
  assertLedgerState,
  encodeCursor,
  encodeKeyCursor,
  invalid,
  isUuid,
  parseLedgerCreate,
  parseLedgerExport,
  parseLedgerPatch,
  parseLedgerQuery,
  parseLedgerSummaryQuery,
} from "./work-input.mjs";
import { all, auditBase, maskReason, methodNotAllowed, notFound } from "./work-customers.mjs";
import { loadDeal } from "./work-deals.mjs";
import { trashBatchFor, trashRowsSql } from "./work-trash.mjs";

const ENTRY_COLUMNS = "id, kind, deal_id, payer_role, label, entry_on, amount_won, vat_won, received_won, received_on,"
  + " snap_contract_on, snap_balance_on, memo, version, created_at, updated_at";
// 기준일(6.12절): 잔금일·계약일은 거래에 붙은 줄이면 그 거래의 날짜, 연결이 끊긴 줄이면 끊길 때 옮겨 둔 날짜(snap_*),
// 처음부터 거래가 없던 줄(snap_*가 모두 빔)이면 그 줄의 날짜(entry_on). 거래 줄의 entry_on은 0005 CHECK로 늘 NULL이다.
// 입금일 기준은 보수·기타 수입이 received_on이고, 지출은 받는 돈·입금일이 없으므로(입력 검사로 받지 않음) 잔금일 기준과 같은 날짜를 쓴다
// (그러지 않으면 입금일 기준 합계에서 지출이 모두 '기준일 없음'으로 빠져 순수익이 틀림, 2026-11-21 대장 지시).
// 기준은 첫 번째 ?로 받는다(값을 SQL에 이어 붙이지 않음). 미입금은 보수·기타 수입만(지출은 0).
// deal_* 칸은 목록 줄마다 법정 상한 경고(warnings)를 다시 계산하려고 함께 읽는 거래 값이다(응답 entry에는 넣지 않음).
const BALANCE_BASIS = "coalesce(d.balance_on, e.snap_balance_on, CASE WHEN e.snap_contract_on IS NULL AND e.snap_balance_on IS NULL THEN e.entry_on END)";
const ENTRY_BASE =
  "WITH b AS (SELECT e.id, e.kind, e.deal_id, e.payer_role, e.label, e.entry_on, e.amount_won, e.vat_won, e.received_won, e.received_on,"
  + " e.snap_contract_on, e.snap_balance_on, e.memo, e.version, e.created_at, e.updated_at,"
  + " CASE ? WHEN 'received' THEN CASE WHEN e.kind = 'expense' THEN " + BALANCE_BASIS + " ELSE e.received_on END"
  + " WHEN 'contract' THEN coalesce(d.contract_on, e.snap_contract_on, CASE WHEN e.snap_contract_on IS NULL AND e.snap_balance_on IS NULL THEN e.entry_on END)"
  + " ELSE " + BALANCE_BASIS + " END AS basis_on,"
  + " CASE WHEN e.kind = 'expense' THEN 0 ELSE max(0, e.amount_won + e.vat_won - e.received_won) END AS unpaid_won,"
  + " d.deal_type AS deal_deal_type, d.property_kind AS deal_property_kind, d.price_won AS deal_price_won, d.deposit_won AS deal_deposit_won,"
  + " d.monthly_rent_won AS deal_monthly_rent_won, d.contract_on AS deal_contract_on"
  + " FROM ledger_entries e LEFT JOIN deals d ON d.id = e.deal_id) ";
// 목록 거르기(종류·거래·미입금만). ? 다섯 개: 종류, 종류, 거래, 거래, 미입금(0/1).
const ENTRY_FILTER = "(? IS NULL OR kind = ?) AND (? IS NULL OR deal_id = ?) AND (? = 0 OR unpaid_won > 0)";

const SQL = Object.freeze({
  entryById: ENTRY_BASE + "SELECT * FROM b WHERE id = ?",
  // 연도를 주면 그 해 기준일 줄만, 기준일·id 내림차순. 커서는 (기준일, id).
  listByBasis:
    ENTRY_BASE + "SELECT * FROM b WHERE " + ENTRY_FILTER + " AND substr(basis_on, 1, 4) = ?"
    + " AND (? IS NULL OR basis_on < ? OR (basis_on = ? AND id < ?)) ORDER BY basis_on DESC, id DESC LIMIT ?",
  // 연도가 없으면 고친 시각·id 내림차순(손님·메모 목록과 같음).
  listByUpdated:
    ENTRY_BASE + "SELECT * FROM b WHERE " + ENTRY_FILTER
    + " AND (? IS NULL OR updated_at < ? OR (updated_at = ? AND id < ?)) ORDER BY updated_at DESC, id DESC LIMIT ?",
  // 미입금 보기: 미입금액 큰 순·id 내림차순. 연도를 주면 그 해 기준일 줄만.
  listByUnpaid:
    ENTRY_BASE + "SELECT * FROM b WHERE " + ENTRY_FILTER + " AND (? IS NULL OR substr(basis_on, 1, 4) = ?)"
    + " AND (? IS NULL OR unpaid_won < ? OR (unpaid_won = ? AND id < ?)) ORDER BY unpaid_won DESC, id DESC LIMIT ?",
  // 기간에서 빠진 줄(기준일 없음) 수. 같은 거르기 조건.
  undatedCount: ENTRY_BASE + "SELECT count(*) AS n FROM b WHERE " + ENTRY_FILTER + " AND basis_on IS NULL",
  // 달별 합계(6.12절). 보수(부가세 제외)·보수 부가세·입금(보수·기타 수입)·미입금(보수·기타 수입)·지출·기타 수입(부가세 제외)·받을 금액(보수·기타 수입, 부가세 포함).
  summaryByMonth:
    ENTRY_BASE + "SELECT substr(basis_on, 6, 2) AS month,"
    + " sum(CASE WHEN kind = 'fee' THEN amount_won ELSE 0 END) AS fee_won,"
    + " sum(CASE WHEN kind = 'fee' THEN vat_won ELSE 0 END) AS vat_won,"
    + " sum(CASE WHEN kind <> 'expense' THEN received_won ELSE 0 END) AS received_won,"
    + " sum(unpaid_won) AS unpaid_won,"
    + " sum(CASE WHEN kind = 'expense' THEN amount_won ELSE 0 END) AS expense_won,"
    + " sum(CASE WHEN kind = 'other_income' THEN amount_won ELSE 0 END) AS other_income_won,"
    + " sum(CASE WHEN kind <> 'expense' THEN amount_won + vat_won ELSE 0 END) AS receivable_won"
    + " FROM b WHERE substr(basis_on, 1, 4) = ? GROUP BY substr(basis_on, 6, 2)",
  summaryUndated: ENTRY_BASE + "SELECT count(*) AS n FROM b WHERE basis_on IS NULL",
  // batch 첫 문장(guard): 조건이 깨졌으면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(설계서 8.5절).
  // 만들기: 붙일 거래가 그사이 지워졌으면 되돌린다(거래 없는 deal_id가 남지 않게).
  dealGuard: "SELECT CASE WHEN ? IS NOT NULL AND NOT EXISTS (SELECT 1 FROM deals WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  entryVersionGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger_entries WHERE id = ? AND version = ?) THEN json('guard') ELSE 1 END AS ok",
  entryExistsGuard: "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ledger_entries WHERE id = ?) THEN json('guard') ELSE 1 END AS ok",
  entryInsert:
    "INSERT INTO ledger_entries (" + ENTRY_COLUMNS + ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?, ?)",
  // 고치기는 합친 최종 상태를 통째로 쓴다. guard가 같은 version임을 다시 보므로 합친 바탕(저장된 줄)이 저장 시점의 값과 같다.
  entryUpdate:
    "UPDATE ledger_entries SET payer_role = ?, label = ?, entry_on = ?, amount_won = ?, vat_won = ?, received_won = ?, received_on = ?, memo = ?,"
    + " version = version + 1, updated_at = ? WHERE id = ? AND version = ?",
  entryDelete: "DELETE FROM ledger_entries WHERE id = ?",
  // 휴지통(0007): 줄 한 건과 붙어 있던 거래의 날짜·제목(deal_snap)을 옮겨 적는다.
  trashEntry: trashRowsSql("ledger_entries", "id = ?"),
});

function entryView(row) {
  return {
    id: row.id,
    kind: row.kind,
    dealId: row.deal_id,
    payerRole: row.payer_role,
    label: row.label,
    entryOn: row.entry_on,
    amountWon: row.amount_won,
    vatWon: row.vat_won,
    receivedWon: row.received_won,
    receivedOn: row.received_on,
    snapContractOn: row.snap_contract_on,
    snapBalanceOn: row.snap_balance_on,
    memo: row.memo,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    unpaidWon: row.unpaid_won,
    basisOn: row.basis_on,
  };
}

// 저장된 행을 입력 검사와 같은 모양으로 바꾼다(고치기 때 고칠 값과 합쳐 최종 상태를 본다).
function rowToState(row) {
  return {
    kind: row.kind,
    dealId: row.deal_id,
    payerRole: row.payer_role,
    label: row.label,
    entryOn: row.entry_on,
    amountWon: row.amount_won,
    vatWon: row.vat_won,
    receivedWon: row.received_won,
    receivedOn: row.received_on,
    memo: row.memo,
    snapContractOn: row.snap_contract_on,
    snapBalanceOn: row.snap_balance_on,
  };
}

async function loadEntry(db, id, basis = "balance") {
  return (await db.prepare(SQL.entryById).bind(basis, id).first()) ?? null;
}

function versionConflict() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 고쳐 주세요.", 409);
}

function dealGone() {
  return new WorkApiError("VERSION_CONFLICT", "다른 화면에서 거래가 지워졌습니다. 다시 불러온 뒤 저장해 주세요.", 409);
}

// 그 거래의 법정 상한(한쪽 의뢰인 기준, 부가세 제외). 비교할 수 없으면 null(거래 없음·금액 빔·지원 범위 밖 계약일·교환).
// 저장값을 바꾸는 데 쓰지 않는다. 물건 조건을 다 알 수 없는 경우는 가장 높은 상한으로 비교해 잘못된 경고를 줄인다
// (오피스텔은 주거용 조건을 모르므로 그 밖의 건축물 표, 그 밖의 건축물·토지는 법령 최대 요율).
// 교환은 거래 자료에 두 물건 가액이 따로 없어 비교하지 않는다.
export function dealFeeCap(deal, legalRules) {
  if (!deal || deal.deal_type === "exchange") return null;
  let rule;
  try {
    rule = selectBrokerageFeeRule(legalRules, deal.contract_on);
  } catch {
    return null;
  }
  const result = calculateBrokerageFee({
    contractDate: deal.contract_on,
    dealType: deal.deal_type,
    propertyKind: deal.property_kind === "housing" ? "housing" : deal.property_kind === "officetel" ? "officetel" : "other",
    officetelConditions: {},
    officeOtherRateBp: rule.otherMaxRateBp,
    priceWon: deal.price_won,
    depositWon: deal.deposit_won,
    monthlyRentWon: deal.monthly_rent_won,
    vatDisplay: false,
  }, legalRules);
  return result.ok ? result.maxFeeWon : null;
}

function ledgerWarnings(state, deal, legalRules) {
  const warnings = [];
  // 부가세 경고는 보수 줄만(사용자 결정 2026-11-21 02:39:45 "부가세가 10%와 다르거나 법정 상한보다 큰 보수"). 기타 수입은 부가세가 없는 경우가 흔하다.
  if (state.kind === "fee" && state.vatWon !== calculateVatWon(state.amountWon)) warnings.push("VAT_DIFFERS");
  if (state.kind === "fee" && deal) {
    const cap = dealFeeCap(deal, legalRules);
    if (cap !== null && state.amountWon > cap) warnings.push("FEE_OVER_CAP");
  }
  return warnings;
}

const rulesOf = (ctx) => ctx.legalRules ?? defaultLegalRules;

// 목록 줄: 저장 때와 같은 함수(ledgerWarnings)로 경고를 다시 계산해 싣는다(화면을 다시 열어도 경고가 보이게, 2026-11-21 대장 지시).
// 상한은 지금 법령 데이터로 계산하므로 요율표가 바뀌면 경고만 달라질 수 있다(저장값은 그대로).
function listItemView(row, legalRules) {
  const deal = row.deal_id === null ? null : {
    deal_type: row.deal_deal_type,
    property_kind: row.deal_property_kind,
    price_won: row.deal_price_won,
    deposit_won: row.deal_deposit_won,
    monthly_rent_won: row.deal_monthly_rent_won,
    contract_on: row.deal_contract_on,
  };
  return { ...entryView(row), warnings: ledgerWarnings(rowToState(row), deal, legalRules) };
}

async function listEntries(ctx) {
  const query = parseLedgerQuery(ctx.url.searchParams);
  const filter = [query.kind, query.kind, query.dealId, query.dealId, query.unpaid ? 1 : 0];
  const cursorValues = [query.cursor?.key ?? null, query.cursor?.key ?? null, query.cursor?.key ?? null, query.cursor?.id ?? null];
  return loadThenAudit(ctx.db, async () => {
    let statement;
    if (query.order === "unpaid") statement = ctx.db.prepare(SQL.listByUnpaid).bind(query.basis, ...filter, query.year, query.year, ...cursorValues, query.limit + 1);
    else if (query.order === "basis") statement = ctx.db.prepare(SQL.listByBasis).bind(query.basis, ...filter, query.year, ...cursorValues, query.limit + 1);
    else statement = ctx.db.prepare(SQL.listByUpdated).bind(query.basis, ...filter, ...cursorValues, query.limit + 1);
    const rows = await all(statement);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    let nextCursor = null;
    if (rows.length > query.limit && last) {
      if (query.order === "unpaid") nextCursor = encodeKeyCursor(last.unpaid_won, last.id);
      else if (query.order === "basis") nextCursor = encodeKeyCursor(last.basis_on, last.id);
      else nextCursor = encodeCursor(last.updated_at, last.id);
    }
    // 연도를 주면 그 기준일이 비어 목록·합계에서 빠진 줄 수를 따로 알린다(DEC-WT-39). 연도가 없으면 빠진 줄이 없다.
    const undated = query.year ? Number((await ctx.db.prepare(SQL.undatedCount).bind(query.basis, ...filter).first())?.n ?? 0) : 0;
    const rules = rulesOf(ctx);
    return { items: page.map((row) => listItemView(row, rules)), nextCursor, undatedCount: undated };
  }, (data) => auditBase(ctx, "ledger.list", { reason: `result_count=${data.items.length}` }));
}

const SUMMARY_FIELDS = Object.freeze(["feeWon", "vatWon", "feeWithVatWon", "receivedWon", "unpaidWon", "expenseWon", "otherIncomeWon", "netWon", "receivableWon"]);

function summaryLine(row) {
  const feeWon = Number(row?.fee_won ?? 0);
  const vatWon = Number(row?.vat_won ?? 0);
  const expenseWon = Number(row?.expense_won ?? 0);
  const otherIncomeWon = Number(row?.other_income_won ?? 0);
  // 순수익 = 보수(부가세 제외) + 기타 수입 − 지출. 부가세는 낼 세금이라 넣지 않는다(6.12절).
  return {
    feeWon,
    vatWon,
    feeWithVatWon: feeWon + vatWon,
    receivedWon: Number(row?.received_won ?? 0),
    unpaidWon: Number(row?.unpaid_won ?? 0),
    expenseWon,
    otherIncomeWon,
    netWon: feeWon + otherIncomeWon - expenseWon,
    // 받을 금액 = 보수·기타 수입의 공급가액 + 부가세(줄의 받을 금액과 같은 뜻, 미입금과 같은 범위). 화면 합계 줄·달 줄이 이 값을 그대로 쓴다.
    receivableWon: Number(row?.receivable_won ?? 0),
  };
}

async function summary(ctx) {
  const query = parseLedgerSummaryQuery(ctx.url.searchParams);
  return loadThenAudit(ctx.db, async () => {
    const rows = await all(ctx.db.prepare(SQL.summaryByMonth).bind(query.basis, query.year));
    const byMonth = new Map(rows.map((row) => [row.month, row]));
    const months = Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, "0");
      return { month: `${query.year}-${month}`, ...summaryLine(byMonth.get(month)) };
    });
    const total = Object.fromEntries(SUMMARY_FIELDS.map((key) => [key, months.reduce((sum, line) => sum + line[key], 0)]));
    const undated = Number((await ctx.db.prepare(SQL.summaryUndated).bind(query.basis).first())?.n ?? 0);
    return { year: query.year, months, total, undatedCount: undated };
  }, () => auditBase(ctx, "ledger.view"));
}

async function createEntry(ctx) {
  const { entry, rrnMasked } = parseLedgerCreate(ctx.body);
  const deal = entry.dealId ? await loadDeal(ctx.db, entry.dealId) : null;
  if (entry.dealId && !deal) throw invalid(["dealId"]);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.dealGuard).bind(entry.dealId, entry.dealId),
      ctx.db.prepare(SQL.entryInsert).bind(
        id, entry.kind, entry.dealId, entry.payerRole, entry.label, entry.entryOn, entry.amountWon, entry.vatWon, entry.receivedWon, entry.receivedOn,
        entry.memo, at, at,
      ),
      auditStatement(ctx.db, { ...auditBase(ctx, "ledger.create", { targetType: "ledger", targetId: id, reason: maskReason(rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    // guard가 되돌렸으면 그사이 거래가 지워진 것(409). 그 밖에는 저장소 오류 그대로.
    if (entry.dealId && !(await loadDeal(ctx.db, entry.dealId))) throw dealGone();
    throw error;
  }
  return { status: 201, data: { entry: entryView(await loadEntry(ctx.db, id)), warnings: ledgerWarnings(entry, deal, rulesOf(ctx)) } };
}

async function updateEntry(ctx, id) {
  const input = parseLedgerPatch(ctx.body);
  const current = await loadEntry(ctx.db, id);
  if (!current) throw notFound();
  if (current.version !== input.version) throw versionConflict();
  // 보낸 칸만이 아니라 저장된 줄 + 고칠 값의 최종 상태로 검사한다(0005 CHECK 위반이 500이 아니라 400이 되게).
  const merged = { ...rowToState(current), ...input.changes };
  assertLedgerState(merged, { requireEntryOn: "entryOn" in input.changes });
  const deal = merged.dealId ? await loadDeal(ctx.db, merged.dealId) : null;
  const at = new Date(ctx.now).toISOString();
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.entryVersionGuard).bind(id, input.version),
      ctx.db.prepare(SQL.entryUpdate).bind(
        merged.payerRole, merged.label, merged.entryOn, merged.amountWon, merged.vatWon, merged.receivedWon, merged.receivedOn, merged.memo,
        at, id, input.version,
      ),
      auditStatement(ctx.db, { ...auditBase(ctx, "ledger.update", { targetType: "ledger", targetId: id, reason: maskReason(input.rrnMasked) }), outcome: "ok" }),
    ]);
  } catch (error) {
    // guard가 되돌렸으면 줄 없음 404, 다른 화면이 먼저 고침(거래 삭제의 연결 끊기 포함) 409. 그 밖에는 저장소 오류 그대로.
    const latest = await loadEntry(ctx.db, id);
    if (!latest) throw notFound();
    if (latest.version !== input.version) throw versionConflict();
    throw error;
  }
  return { data: { entry: entryView(await loadEntry(ctx.db, id)), warnings: ledgerWarnings(merged, deal, rulesOf(ctx)) } };
}

async function deleteEntry(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  if (!(await loadEntry(ctx.db, id))) throw notFound();
  // guard · 감사 · 묶음 · 복사 · 지우기(한 batch, 휴지통 0007).
  const trash = trashBatchFor(ctx, "ledger", id);
  try {
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.entryExistsGuard).bind(id),
      auditStatement(ctx.db, { ...auditBase(ctx, "ledger.delete", { targetType: "ledger", targetId: id }), outcome: "ok" }),
      trash.statement,
      ctx.db.prepare(SQL.trashEntry).bind(trash.batchId, id),
      ctx.db.prepare(SQL.entryDelete).bind(id),
    ]);
  } catch (error) {
    if (!(await loadEntry(ctx.db, id))) throw notFound();
    throw error;
  }
  return { data: { deleted: true, trash: trash.trash } };
}

// CSV 내려받기 감사(2026-11-21 대장 지시): 화면이 CSV를 만들기 전에 부른다. 자료는 돌려주지 않고 감사 export.ledger 한 줄만 남긴다.
// 감사를 남기지 못하면 503이고, 화면은 200 { recorded: true }를 받은 뒤에만 CSV를 만든다.
async function recordExport(ctx) {
  const input = parseLedgerExport(ctx.body);
  try {
    await auditStatement(ctx.db, { ...auditBase(ctx, "export.ledger", { reason: `result_count=${input.count}` }), outcome: "ok" }).run();
  } catch {
    throw new WorkApiError("AUDIT_UNAVAILABLE", "작업 기록을 남기지 못해 내려받기를 멈췄습니다.", 503, true);
  }
  return { data: { recorded: true } };
}

// 경로가 장부(/ledger, /ledger/summary, /ledger/export, /ledger/:id)면 { status?, data }를, 아니면 null을 돌려준다.
export async function routeWorkLedger(ctx) {
  const [collection, id, extra] = ctx.route.split("/").filter(Boolean);
  if (collection !== "ledger" || extra !== undefined) return null;
  if (id === undefined) {
    if (ctx.method === "GET") return { data: await listEntries(ctx) };
    if (ctx.method === "POST") return createEntry(ctx);
    throw methodNotAllowed("GET, POST");
  }
  if (id === "summary") {
    if (ctx.method === "GET") return { data: await summary(ctx) };
    throw methodNotAllowed("GET");
  }
  if (id === "export") {
    if (ctx.method === "POST") return recordExport(ctx);
    throw methodNotAllowed("POST");
  }
  if (!isUuid(id)) throw notFound();
  if (ctx.method === "PATCH") return updateEntry(ctx, id);
  if (ctx.method === "DELETE") return deleteEntry(ctx, id);
  throw methodNotAllowed("PATCH, DELETE");
}
