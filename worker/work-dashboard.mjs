// 관리자 대시보드(/admin/) 읽기 API: GET /work/dashboard (사용자 선택 2026-11-23 16:32:35 "읽기 전용 API 하나 새로", 16:55 A안).
// - work-api.mjs의 handleWorkApi()가 단계 2·단계 P 켜기 값 확인 **전에** 이 파일로 넘긴다. 칸마다 켜기 값을 따로 본다:
//   할 일·계약 일정·이번 달 돈 = WORK_TOOLS_ENABLED(단계 2), 실거래 = WORK_REALPRICE_ENABLED(단계 P).
//   꺼진 칸은 { ok: false, code } 하나로 알리고, 둘 다 꺼져 있으면 D1을 읽지 않는다.
// - 한 칸이 실패해도 나머지 칸은 그대로 돌려준다(응답 봉투는 늘 200 ok: true, 칸마다 ok).
// - 감사: 단계 2 칸(손님 이름·할 일 제목이 들어 있음)을 읽었으면 dashboard.view 한 줄(reason result_count=n)을 남기고, 남기지 못하면
//   단계 2 칸을 AUDIT_UNAVAILABLE로 바꿔 자료를 돌려주지 않는다(loadThenAudit과 같은 규칙). 실거래 칸은 감사를 남기지 않는다(22.12절).
// - 실거래 칸이 읽은 행 수는 rt_daily_usage에 더하고, 하루 읽기 끝 상한을 넘으면 그 칸만 RT_READ_BUDGET이다.
// - work-api.mjs와 서로 import한다(요청을 처리할 때만 쓰므로 순환 import가 문제되지 않음, work-public-tools.mjs와 같음).
// - SQL은 고정 문장이고 값은 bind로만 넘긴다. 손님 이름·할 일 제목은 응답 본문에만 싣고 감사·로그에 넣지 않는다.
import { EVENT_KIND_LABELS } from "./work-events.mjs";
import { koreaDate } from "./work-input.mjs";
import { auditStatement } from "./work-audit.mjs";
import { all, auditBase } from "./work-customers.mjs";
import { loadLedgerMonthForDashboard } from "./work-ledger.mjs";
import { getRealpriceConfigState } from "./work-public-tools.mjs";
import { addReadUsage, listRealpriceTrades, REALPRICE_NEW_DAYS } from "./realprice-query.mjs";
import { kstMonth, monthKeyRange, rowsReadOf } from "./realprice-store.mjs";
import { WorkApiError, getWorkConfigState } from "./work-security.mjs";
import { WORK_SCHEMA_VERSION, readSchemaVersion, recordDenied, workError, workSuccess } from "./work-api.mjs";

export const DASHBOARD_ITEMS_MAX = 5; // 할 일·계약 일정 목록 줄 수
export const DASHBOARD_EVENT_DAYS = 14; // 오늘부터 14일 뒤까지
export const DASHBOARD_EVENT_PAST_ITEMS_MAX = 2; // 계약 일정 목록 5줄 가운데 지난 일정은 앞날 일정이 넉넉하면 최대 2줄
export const DASHBOARD_EVENT_PAST_DAYS = 30; // 끝내지 않은 지난 일정도 30일 안이면 '지남'으로 함께(캘린더 구독과 같은 30일)
export const DASHBOARD_TRADE_ITEMS_MAX = 3; // 최근 신고가 줄 수
export const DASHBOARD_NEW_TRADE_MONTHS = 3; // 새 실거래를 세는 계약 연월 범위(이번 달 포함 3개월, 신고 기한 30일보다 넉넉함)
const DAY_MS = 24 * 60 * 60 * 1000;

const SQL = Object.freeze({
  // 오늘까지(지난 것 포함) 열린 할 일. 할 일 화면 '오늘' 묶음·도구 모음 '오늘 할 일' 칸과 같은 차례(날짜 → 만든 시각 → id).
  tasks:
    "SELECT t.id, t.title, t.due_on, t.repeat_rule, t.deal_id, d.title AS deal_title FROM tasks t LEFT JOIN deals d ON d.id = t.deal_id"
    + " WHERE t.done_at IS NULL AND t.due_on IS NOT NULL AND t.due_on <= ?1 ORDER BY t.due_on, t.created_at, t.id LIMIT ?2",
  taskCounts:
    "SELECT coalesce(sum(CASE WHEN due_on < ?1 THEN 1 ELSE 0 END), 0) AS overdue, coalesce(sum(CASE WHEN due_on = ?1 THEN 1 ELSE 0 END), 0) AS due_today"
    + " FROM tasks WHERE done_at IS NULL AND due_on IS NOT NULL AND due_on <= ?1",
  // 끝내지 않은 거래 일정(취소한 거래 제외, 캘린더 구독 work-calendar-feeds.mjs와 같은 규칙). 손님은 거래의 참여자 가운데
  // 매수인 → 임차인 → 매도인 → 임대인 → 그 밖 차례로 한 명(같은 역할이면 손님 id 차례), 참여자 수를 같이 준다.
  events:
    "SELECT x.*, c.display_name AS customer_name FROM ("
    + "SELECT e.id, e.kind, e.title, e.due_on, e.deal_id, d.title AS deal_title, d.deal_type,"
    + " (SELECT p.customer_id FROM deal_parties p WHERE p.deal_id = e.deal_id ORDER BY CASE p.role WHEN 'buyer' THEN 0 WHEN 'tenant' THEN 1"
    + " WHEN 'seller' THEN 2 WHEN 'landlord' THEN 3 ELSE 4 END, p.customer_id LIMIT 1) AS customer_id,"
    + " (SELECT count(*) FROM deal_parties p WHERE p.deal_id = e.deal_id) AS party_count"
    + " FROM deal_events e JOIN deals d ON d.id = e.deal_id"
    + " WHERE e.done_at IS NULL AND d.status <> 'cancelled' AND e.due_on >= ?1 AND e.due_on <= ?2 ORDER BY e.due_on, e.id LIMIT ?3"
    + ") x LEFT JOIN customers c ON c.id = x.customer_id ORDER BY x.due_on, x.id",
  eventCounts:
    "SELECT count(*) AS total, coalesce(sum(CASE WHEN e.due_on < ?3 THEN 1 ELSE 0 END), 0) AS overdue"
    + " FROM deal_events e JOIN deals d ON d.id = e.deal_id WHERE e.done_at IS NULL AND d.status <> 'cancelled' AND e.due_on >= ?1 AND e.due_on <= ?2",
  // 새 실거래: 처음 채우기가 아닌 행이고 처음 본 지 7일 안(realprice-query.mjs tradeView의 isNew와 같은 판정).
  // 종류마다 기본 키 범위(계약 연월 3개월)로만 읽는다(표 전체를 훑지 않음). 관심 단지는 rt_watch_complexes(20행 이하).
  newTrades:
    "SELECT count(*) AS new_count, coalesce(sum(CASE WHEN w.apt_seq IS NOT NULL THEN 1 ELSE 0 END), 0) AS watch_new_count FROM ("
    + "SELECT apt_seq, is_backfill, first_seen_at FROM rt_trades WHERE trade_key >= ?1 AND trade_key < ?2"
    + " UNION ALL SELECT apt_seq, is_backfill, first_seen_at FROM rt_trades WHERE trade_key >= ?3 AND trade_key < ?4"
    + " UNION ALL SELECT apt_seq, is_backfill, first_seen_at FROM rt_trades WHERE trade_key >= ?5 AND trade_key < ?6"
    + ") t LEFT JOIN rt_watch_complexes w ON w.apt_seq = t.apt_seq WHERE t.is_backfill = 0 AND t.first_seen_at >= ?7",
});

const shiftDate = (dateText, days) => new Date(Date.parse(`${dateText}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);

function shiftYmd(ymd, months) {
  const index = Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(4, 6)) - 1 + months;
  return `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
}

// 칸 오류 코드: 알고 있는 업무 오류는 그 코드, 그 밖은 STORAGE_UNAVAILABLE(오류 문장·입력값은 싣지 않음).
function failedSection(error) {
  return { ok: false, code: error instanceof WorkApiError ? error.code : "STORAGE_UNAVAILABLE" };
}

function logSectionFailure(auditLog, requestId, section, error) {
  try {
    auditLog({
      event: "work_request_failed",
      requestId,
      section,
      code: error instanceof WorkApiError ? error.code : "STORAGE_UNAVAILABLE",
      errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error",
    });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

async function loadTasks(db, today) {
  const rows = await all(db.prepare(SQL.tasks).bind(today, DASHBOARD_ITEMS_MAX));
  const counts = await db.prepare(SQL.taskCounts).bind(today).first();
  return {
    ok: true,
    overdue: Number(counts?.overdue ?? 0),
    dueToday: Number(counts?.due_today ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      dueOn: row.due_on,
      repeat: row.repeat_rule,
      deal: row.deal_id === null ? null : { id: row.deal_id, title: row.deal_title },
    })),
  };
}

async function loadEvents(db, today) {
  const from = shiftDate(today, -DASHBOARD_EVENT_PAST_DAYS);
  const until = shiftDate(today, DASHBOARD_EVENT_DAYS);
  // 목록 5줄: 지난 일정은 오래된 차례로 최대 2줄, 나머지는 오늘부터 앞날 차례로 채운다(지난 것이 많아도 앞날 일정이 밀려나지 않게,
  // 대장 결정 2026-11-23). 한쪽이 모자라 5줄이 안 차면 남는 줄을 다른 쪽으로 채운다: 지난 일정이 2줄보다 적으면 앞날을 더,
  // 앞날 일정이 3줄보다 적으면 지난 일정을 오래된 차례 다음 것으로 더(예: 지난 6 + 앞날 1 → 지난 4 + 앞날 1). 숫자(total·overdue)는 목록 줄 수와 상관없이 전체를 센다.
  const pastRows = await all(db.prepare(SQL.events).bind(from, shiftDate(today, -1), DASHBOARD_ITEMS_MAX));
  const upcomingRows = await all(db.prepare(SQL.events).bind(today, until, DASHBOARD_ITEMS_MAX));
  const pastTake = Math.min(pastRows.length, Math.max(DASHBOARD_EVENT_PAST_ITEMS_MAX, DASHBOARD_ITEMS_MAX - upcomingRows.length));
  const rows = [...pastRows.slice(0, pastTake), ...upcomingRows.slice(0, DASHBOARD_ITEMS_MAX - pastTake)];
  const counts = await db.prepare(SQL.eventCounts).bind(from, until, today).first();
  return {
    ok: true,
    until,
    total: Number(counts?.total ?? 0),
    overdue: Number(counts?.overdue ?? 0),
    items: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      kindLabel: EVENT_KIND_LABELS[row.kind] ?? row.kind,
      title: row.title ?? "",
      dueOn: row.due_on,
      deal: { id: row.deal_id, title: row.deal_title, dealType: row.deal_type },
      customer: row.customer_id === null ? null : { id: row.customer_id, displayName: row.customer_name ?? "" },
      partyCount: Number(row.party_count ?? 0),
    })),
  };
}

async function loadMoney(db, today) {
  return { ok: true, ...(await loadLedgerMonthForDashboard(db, today.slice(0, 7))) };
}

async function loadRealprice(db, nowMs) {
  // 주요 거래(view=major)를 그대로 불러 신고가를 센다. 하루 읽기 끝 상한이면 여기서 RT_READ_BUDGET이 난다(사용량도 여기서 더함).
  const major = await listRealpriceTrades(db, new URLSearchParams("view=major"), { nowMs });
  const highs = major.items.filter((item) => item.recordHigh === true)
    .sort((a, b) => (a.dealDate === b.dealDate ? (a.tradeKey < b.tradeKey ? 1 : -1) : (a.dealDate < b.dealDate ? 1 : -1)));
  const toYmd = kstMonth(nowMs);
  const fromYmd = shiftYmd(toYmd, -(DASHBOARD_NEW_TRADE_MONTHS - 1));
  const ranges = ["sale", "rent", "presale"].flatMap((kind) => [monthKeyRange(kind, fromYmd)[0], monthKeyRange(kind, toYmd)[1]]);
  const since = new Date(nowMs - REALPRICE_NEW_DAYS * DAY_MS).toISOString();
  // 읽은 행 수(meta.rows_read)를 실거래 하루 사용량에 더하려고 first() 대신 all()로 받는다.
  const counted = await db.prepare(SQL.newTrades).bind(...ranges, since).all();
  const result = counted.results?.[0];
  await addReadUsage(db, nowMs, rowsReadOf(counted));
  return {
    ok: true,
    newCount: Number(result?.new_count ?? 0),
    watchNewCount: Number(result?.watch_new_count ?? 0),
    newHighCount: major.recordHighReady ? highs.length : null,
    partial: major.warnings.some((warning) => warning.code === "RT_MAJOR_PARTIAL"),
    items: highs.slice(0, DASHBOARD_TRADE_ITEMS_MAX).map((item) => ({
      tradeKey: item.tradeKey,
      dealDate: item.dealDate,
      aptName: item.aptName,
      areaM2: item.areaM2,
      priceWon: item.priceWon,
    })),
  };
}

// GET /work/dashboard. 돌려주는 값: { today, tasks, events, money, realprice } (칸마다 { ok: true, … } 또는 { ok: false, code })
export async function handleWorkDashboard(request, env, { db, actor, requestId, now, auditLog, method }) {
  if (method !== "GET") {
    return workError(requestId, new WorkApiError("METHOD_NOT_ALLOWED", "허용되지 않은 요청 방식입니다.", 405), { Allow: "GET" });
  }
  const today = koreaDate(now);
  const workState = getWorkConfigState(env, db);
  const realpriceState = getRealpriceConfigState(env, db);
  const off = (state, disabledCode, missingCode) => (state === "disabled" ? { ok: false, code: disabledCode } : { ok: false, code: missingCode });
  const workOff = workState === "enabled" ? null : off(workState, "WORK_DISABLED", "WORK_CONFIG_MISSING");
  let realprice = realpriceState === "enabled" ? null : off(realpriceState, "REALPRICE_DISABLED", "REALPRICE_CONFIG_MISSING");

  let tasks = workOff;
  let events = workOff;
  let money = workOff;
  if (!workOff || !realprice) {
    // 켜진 칸이 하나라도 있을 때만 D1 구조 번호를 한 번 읽는다(8.4절과 같은 규칙, 맞지 않으면 켜진 칸만 그 코드로).
    let schemaCode = null;
    try {
      const version = await readSchemaVersion(db);
      if (version === null || version < WORK_SCHEMA_VERSION) schemaCode = "WORK_SCHEMA_OUTDATED";
      else if (version > WORK_SCHEMA_VERSION) schemaCode = "WORK_SCHEMA_AHEAD";
    } catch {
      schemaCode = "STORAGE_UNAVAILABLE";
    }
    if (schemaCode) {
      if (schemaCode !== "STORAGE_UNAVAILABLE") await recordDenied(db, actor, env, request, requestId, now, schemaCode, auditLog);
      const failed = { ok: false, code: schemaCode };
      if (!workOff) tasks = events = money = failed;
      if (!realprice) realprice = failed;
    } else {
      const guard = async (section, load) => {
        try {
          return await load();
        } catch (error) {
          logSectionFailure(auditLog, requestId, section, error);
          return failedSection(error);
        }
      };
      if (!workOff) {
        [tasks, events, money] = await Promise.all([
          guard("tasks", () => loadTasks(db, today)),
          guard("events", () => loadEvents(db, today)),
          guard("money", () => loadMoney(db, today)),
        ]);
        const loaded = [tasks, events, money].filter((section) => section.ok);
        if (loaded.length > 0) {
          const count = (tasks.ok ? tasks.items.length : 0) + (events.ok ? events.items.length : 0) + (money.ok ? money.items.length : 0);
          try {
            await auditStatement(db, { ...auditBase({ now, actor, requestId }, "dashboard.view", { reason: `result_count=${count}` }), outcome: "ok" }).run();
          } catch {
            const failed = { ok: false, code: "AUDIT_UNAVAILABLE" };
            if (tasks.ok) tasks = failed;
            if (events.ok) events = failed;
            if (money.ok) money = failed;
          }
        }
      }
      if (!realprice) realprice = await guard("realprice", () => loadRealprice(db, now));
    }
  }
  return workSuccess({ today, tasks, events, money, realprice }, requestId);
}
