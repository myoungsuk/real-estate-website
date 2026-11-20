// 단계 P 실거래가 조회(설계서 22.8·22.9절): GET /work/realprice/trades·complexes·watch, PUT /work/realprice/watch.
// - 목록은 기본 키 범위(종류·계약 연월)로만 읽는다. kind=all도 종류별 범위 3개를 각각 정렬·LIMIT으로 읽어 합친다(표 전체를 읽지 않음).
//   한 종류만 볼 때는 나머지 두 갈래에 빈 범위를 넣어 같은 문장을 쓴다(빈 범위는 0행을 읽음).
//   기간은 최근 달부터 1·2·4·8…개월 창으로 나눠 쪽이 찰 때까지만 읽는다(tradeMonthWindows, TK-53 실측으로 보탬).
// - 신고가는 돌려줄 쪽의 매매 행만 단지·면적 묶음으로 모아 묶음마다 한 번 비교 자료를 읽고(REALPRICE_PRIOR_SQL) 보는 순간에 계산한다(저장하지 않음).
//   판정 준비 전(매매 과거 자료가 다 받아지지 않음)·하루 읽기 첫 상한을 넘은 날에는 계산하지 않고 recordHigh: null로 둔다.
// - 하루 읽기 끝 상한을 넘으면 목록·단지 찾기를 429 RT_READ_BUDGET(retryAt = 다음 한국 시각 09:00)로 거절한다.
//   갱신 상태·관심 단지 보기는 읽는 양이 작아 거절하지 않는다(TK-54).
// - 목록·단지 찾기의 읽은 행 수(meta.rows_read)는 rt_daily_usage에 더한다. 보기 요청은 감사 기록을 남기지 않는다(22.12절).
// - trades?ids=(P1-e 홍보물): 거래 ID 1 ~ 6개를 기본 키로만 다시 읽는다(REALPRICE_TRADES_BY_IDS_SQL, json_each 바인딩 1개).
//   목록 거르기·커서와 함께 보내면 400으로 거절한다. 응답은 items(보낸 순서)·missing(없어진 ID)·receivedAt(해제 아닌 거래 달의
//   마지막 성공 시각 가운데 가장 이른 것)·recordHighReady·warnings이고, 사용량 세기·상한·감사 규칙은 목록과 같다.
// - SQL은 모두 이 파일의 고정 문장이고 값은 bind로만 넘긴다(입력값을 SQL에 이어 붙이지 않음).
import complexes from "../src/data/complexes.json" with { type: "json" };
import { getComplexMatchCandidates, normalizeComplexText } from "../src/lib/complex-matching.mjs";
import { auditStatement, runBatch } from "./work-audit.mjs";
import { invalid } from "./work-input.mjs";
import { WorkApiError } from "./work-security.mjs";
import {
  REALPRICE_DAILY_READ_HARD,
  REALPRICE_DAILY_READ_SOFT,
  REALPRICE_KINDS,
  REALPRICE_START_MONTHS,
  addUsageStatement,
  expectedMonths,
  kstMonth,
  readMonthsStatement,
  readUsageStatement,
  rowsReadOf,
  saleCoveredThrough,
} from "./realprice-store.mjs";

export const REALPRICE_TRADES_LIMIT_DEFAULT = 30;
export const REALPRICE_TRADES_LIMIT_MAX = 100;
export const REALPRICE_RANGE_DEFAULT_MONTHS = 3;
export const REALPRICE_RANGE_MAX_MONTHS = 36;
export const REALPRICE_NEW_DAYS = 7; // isNew: 처음 채우기가 아닌 행이고 처음 본 지 7일 안(22.9절)
export const REALPRICE_WATCH_MAX = 20;
export const REALPRICE_WATCH_NAME_MAX = 40;
export const REALPRICE_COMPLEX_QUERY_MAX = 30;
export const REALPRICE_COMPLEX_RESULT_MAX = 50;
export const REALPRICE_COMPLEX_SEARCH_MONTHS = 36; // 단지 찾기는 최근 36개월 매매 범위만 읽는다(표 전체를 훑지 않게)
export const REALPRICE_WATCH_VERSION_SETTING = "realprice_watch_version";
export const REALPRICE_IDS_MAX = 6; // 홍보물에 고를 수 있는 거래 수(설계서 22.10)
// ids와 함께 보내면 400인 목록 매개변수. 조용히 무시하면 어느 쪽이 적용됐는지 헷갈리므로 거절한다(날개대장 조건, P1-e).
const TRADES_LIST_PARAMS = Object.freeze(["kind", "from", "to", "watch", "apt", "umd", "areaMin", "areaMax", "priceMin", "priceMax", "cancelled", "direct", "cursor", "limit"]);
const COVERAGE_PENDING_MAX = 12;
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TRADE_KEY_PATTERN = /^(sale|rent|presale):\d{6}:[0-9a-f]{20}:\d{1,4}$/u;
const APT_SEQ_PATTERN = /^[0-9A-Za-z-]{1,20}$/u;
const AREA_PATTERN = /^\d{1,4}(?:\.\d{1,2})?$/u;
const PRICE_PATTERN = /^\d{1,13}$/u;
const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/u;
const MAX_CURSOR_LENGTH = 200;
const EMPTY_RANGE = ["~", "~"]; // trade_key >= '~' AND trade_key < '~' → 0행
const iso = (ms) => new Date(ms).toISOString();

// 공개 단지(complexes.json의 published)만 관심 단지 연결·후보로 쓴다.
const PUBLISHED_COMPLEXES = Object.freeze(complexes.filter((complex) => complex?.status === "published"));
const PUBLISHED_SLUGS = new Set(PUBLISHED_COMPLEXES.map((complex) => complex.slug));

// ── 문장 ──

// 목록: ?1 ~ ?6 종류별 기본 키 범위 3개(안 보는 종류는 빈 범위), ?7 해제 포함(1)·빼기(0), ?8 직거래 빼기(1),
// ?9 단지 번호, ?10 법정동, ?11·?12 전용면적(㎡ × 100) 아래·위, ?13·?14 금액 아래·위(매매·분양권 거래 금액, 전월세 보증금),
// ?15 관심 단지만(1), ?16·?17 커서(계약일, 거래 ID), ?18 갈래마다 LIMIT(채울 수).
const TRADE_FILTER = `(?7 = 1 OR cancelled = 0)
    AND (?8 = 0 OR dealing_gbn IS NULL OR dealing_gbn <> 'direct')
    AND (?9 IS NULL OR apt_seq = ?9)
    AND (?10 IS NULL OR umd_nm = ?10)
    AND (?11 IS NULL OR area_x100 >= ?11) AND (?12 IS NULL OR area_x100 <= ?12)
    AND (?13 IS NULL OR COALESCE(price_won, deposit_won) >= ?13) AND (?14 IS NULL OR COALESCE(price_won, deposit_won) <= ?14)
    AND (?15 = 0 OR apt_seq IN (SELECT apt_seq FROM rt_watch_complexes))
    AND (?16 IS NULL OR deal_date < ?16 OR (deal_date = ?16 AND trade_key < ?17))`;
const TRADE_BRANCH = (from, to) => `SELECT * FROM (SELECT * FROM rt_trades WHERE trade_key >= ${from} AND trade_key < ${to}
    AND ${TRADE_FILTER}
    ORDER BY deal_date DESC, trade_key DESC LIMIT ?18)`;
export const REALPRICE_TRADES_SQL = `SELECT trade_key, kind, deal_date, umd_nm, jibun, apt_seq, apt_nm, area_x100, floor, build_year, price_won, deposit_won,
  monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, cmp_seq
FROM (
  ${TRADE_BRANCH("?1", "?2")}
  UNION ALL
  ${TRADE_BRANCH("?3", "?4")}
  UNION ALL
  ${TRADE_BRANCH("?5", "?6")}
)
ORDER BY deal_date DESC, trade_key DESC
LIMIT ?18`;

// 고른 거래 다시 읽기(홍보물 화면, P1-e): ?1 = 거래 ID JSON 배열(1 ~ 6개). 기본 키로만 찾는다(표를 훑지 않음).
export const REALPRICE_TRADES_BY_IDS_SQL = `SELECT trade_key, kind, deal_date, umd_nm, jibun, apt_seq, apt_nm, area_x100, floor, build_year, price_won, deposit_won,
  monthly_rent_won, dealing_gbn, cancelled, cancelled_on, registered_on, apt_dong, extra_json, is_backfill, first_seen_at, cmp_seq
FROM rt_trades
WHERE trade_key IN (SELECT value FROM json_each(?1))`;

// 신고가 비교 자료(22.8절): 돌려줄 쪽의 판정 대상 매매 행이 속한 단지·면적 묶음(?1 = JSON [[cmp_seq, area_x100, 가장 이른 계약일, 가장 늦은 계약일], …])마다
// ① 가장 이른 계약일 앞의 비교 대상 최고가 1행(deal_date NULL)과 ② 가장 이른 ~ 가장 늦은 계약일 사이(늦은 날은 빼고)의 비교 대상 거래를 돌려준다.
// 행마다 하위 질의를 돌리면 같은 묶음의 옛 거래를 행 수만큼 다시 읽으므로(TK-53 실측: 한 묶음 600건 × 30행 = 1만 8천 행) 묶음마다 한 번만 읽는다.
// 비교 대상: 매매, 해제 아님, 중개(또는 중개 구분이 없던 옛 자료). 앞선 거래만 비교하는 것은 부르는 쪽(previousMaxByRow)이 계약일로 가른다.
export const REALPRICE_PRIOR_SQL = `WITH g AS MATERIALIZED (
  SELECT json_extract(value, '$[0]') AS cmp_seq, json_extract(value, '$[1]') AS area_x100,
    json_extract(value, '$[2]') AS first_date, json_extract(value, '$[3]') AS last_date
  FROM json_each(?1)
)
SELECT g.cmp_seq, g.area_x100, NULL AS deal_date, (
  SELECT MAX(p.price_won) FROM rt_trades p
  WHERE p.kind = 'sale' AND p.cmp_seq = g.cmp_seq AND p.area_x100 = g.area_x100 AND p.deal_date < g.first_date
    AND p.cancelled = 0 AND (p.dealing_gbn IS NULL OR p.dealing_gbn = 'broker')
) AS price_won
FROM g
UNION ALL
SELECT p.cmp_seq, p.area_x100, p.deal_date, p.price_won
FROM g JOIN rt_trades p ON p.kind = 'sale' AND p.cmp_seq = g.cmp_seq AND p.area_x100 = g.area_x100
  AND p.deal_date >= g.first_date AND p.deal_date < g.last_date
WHERE p.cancelled = 0 AND (p.dealing_gbn IS NULL OR p.dealing_gbn = 'broker')`;

// 단지 찾기: 최근 36개월 매매 범위(?1 ~ ?2)에서 띄어쓰기를 뺀 단지명에 찾는 말(?3)이 든 단지. 이름·법정동은 가장 최근 거래의 값.
export const REALPRICE_COMPLEXES_SQL = `SELECT apt_seq, apt_nm, umd_nm, COUNT(*) AS trade_count, MAX(deal_date) AS last_deal_date
FROM rt_trades
WHERE trade_key >= ?1 AND trade_key < ?2 AND apt_seq IS NOT NULL AND instr(replace(lower(apt_nm), ' ', ''), ?3) > 0
GROUP BY apt_seq
ORDER BY trade_count DESC, apt_seq
LIMIT ?4`;

const WATCH_VERSION_SQL = "SELECT value_json FROM settings WHERE key = ?1";
const WATCH_LIST_SQL = "SELECT apt_seq, display_name, complex_slug, sort_order FROM rt_watch_complexes ORDER BY sort_order, apt_seq";
// 관심 단지 저장 batch 첫 문장(guard): version이 그대로가 아니면 json('guard')(잘못된 JSON)로 batch 전체를 되돌린다(8.5절).
const WATCH_GUARD_SQL = "SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM settings WHERE key = ?1 AND value_json = ?2) THEN json('guard') ELSE 1 END AS ok";
const WATCH_BUMP_SQL = "UPDATE settings SET value_json = ?2, updated_at = ?3 WHERE key = ?1";
const WATCH_CLEAR_SQL = "DELETE FROM rt_watch_complexes";
const WATCH_INSERT_SQL = `INSERT INTO rt_watch_complexes (apt_seq, display_name, complex_slug, sort_order, created_at)
SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'), ?2 FROM json_each(?1)`;

// ── 달·시각 ──

const monthIndex = (ymd) => Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(4, 6)) - 1;
const ymdFromIndex = (index) => `${Math.floor(index / 12)}${String((index % 12) + 1).padStart(2, "0")}`;
const dashed = (ymd) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}`;

// 다음 한국 시각 09:00(= UTC 0시, D1 무료 한도가 초기화되는 시각).
export function nextReadBudgetReset(nowMs) {
  const next = new Date(nowMs);
  next.setUTCHours(24, 0, 0, 0);
  return iso(next.getTime());
}

export function readBudgetExceededError(nowMs) {
  const retryAt = nextReadBudgetReset(nowMs);
  return Object.assign(new WorkApiError("RT_READ_BUDGET", "오늘 실거래가 조회량이 상한에 닿았습니다. 한국 시각 오전 9시 뒤에 다시 보세요.", 429, true), { retryAt });
}

// ── 입력 ──

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function parseMonth(value, field) {
  const match = MONTH_PATTERN.exec(value ?? "");
  if (!match) throw invalid([field]);
  return `${match[1]}${match[2]}`;
}

export function encodeTradeCursor(dealDate, tradeKey) {
  return btoa(JSON.stringify({ d: dealDate, k: tradeKey })).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function decodeTradeCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/u.test(value)) throw invalid(["cursor"]);
  let parsed;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    parsed = JSON.parse(atob(padded));
  } catch {
    throw invalid(["cursor"]);
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).length !== 2 || !DATE_PATTERN.test(parsed.d ?? "") || !TRADE_KEY_PATTERN.test(parsed.k ?? "")) {
    throw invalid(["cursor"]);
  }
  return { dealDate: parsed.d, tradeKey: parsed.k };
}

function parseArea(value, field) {
  if (value === null || value === "") return null;
  if (!AREA_PATTERN.test(value)) throw invalid([field]);
  const x100 = Math.round(Number(value) * 100);
  if (x100 <= 0) throw invalid([field]);
  return x100;
}

function parsePrice(value, field) {
  if (value === null || value === "") return null;
  if (!PRICE_PATTERN.test(value)) throw invalid([field]);
  const won = Number(value);
  if (!Number.isSafeInteger(won)) throw invalid([field]);
  return won;
}

function parseText(value, field, max) {
  if (value === null || value === "") return null;
  const text = value.normalize("NFKC").trim();
  if (text.length < 1 || text.length > max || CONTROL_PATTERN.test(text)) throw invalid([field]);
  return text;
}

// GET /work/realprice/trades 쿼리(22.9절). 기본: 모든 종류, 최근 3개월(이번 달 포함), 해제 빼기, 직거래 포함, 30건.
export function parseTradesQuery(params, nowMs) {
  const kind = params.get("kind") || "all"; // 빈 값은 다른 칸처럼 기본값
  if (!["all", ...REALPRICE_KINDS].includes(kind)) throw invalid(["kind"]);
  const currentYmd = kstMonth(nowMs);
  const fromText = params.get("from");
  const toText = params.get("to");
  const toYmd = toText === null || toText === "" ? currentYmd : parseMonth(toText, "to");
  const fromYmd = fromText === null || fromText === ""
    ? ymdFromIndex(monthIndex(toYmd) - (REALPRICE_RANGE_DEFAULT_MONTHS - 1))
    : parseMonth(fromText, "from");
  if (fromYmd > toYmd || toYmd > currentYmd || fromYmd < REALPRICE_START_MONTHS.sale) throw invalid(["from", "to"]);
  if (monthIndex(toYmd) - monthIndex(fromYmd) + 1 > REALPRICE_RANGE_MAX_MONTHS) throw invalid(["from", "to"]);
  const watch = params.get("watch");
  if (watch !== null && watch !== "" && watch !== "1") throw invalid(["watch"]);
  const apt = params.get("apt");
  if (apt !== null && apt !== "" && !APT_SEQ_PATTERN.test(apt)) throw invalid(["apt"]);
  const cancelled = params.get("cancelled") || "exclude";
  if (!["exclude", "include"].includes(cancelled)) throw invalid(["cancelled"]);
  const direct = params.get("direct") || "include";
  if (!["include", "exclude"].includes(direct)) throw invalid(["direct"]);
  const areaMin = parseArea(params.get("areaMin"), "areaMin");
  const areaMax = parseArea(params.get("areaMax"), "areaMax");
  if (areaMin !== null && areaMax !== null && areaMin > areaMax) throw invalid(["areaMin", "areaMax"]);
  const priceMin = parsePrice(params.get("priceMin"), "priceMin");
  const priceMax = parsePrice(params.get("priceMax"), "priceMax");
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) throw invalid(["priceMin", "priceMax"]);
  const limitText = params.get("limit");
  let limit = REALPRICE_TRADES_LIMIT_DEFAULT;
  if (limitText !== null && limitText !== "") {
    if (!/^\d{1,3}$/u.test(limitText)) throw invalid(["limit"]);
    limit = Number(limitText);
    if (limit < 1 || limit > REALPRICE_TRADES_LIMIT_MAX) throw invalid(["limit"]);
  }
  return {
    kinds: kind === "all" ? [...REALPRICE_KINDS] : [kind],
    fromYmd,
    toYmd,
    watch: watch === "1",
    aptSeq: apt === null || apt === "" ? null : apt,
    umd: parseText(params.get("umd"), "umd", 30),
    areaMin,
    areaMax,
    priceMin,
    priceMax,
    includeCancelled: cancelled === "include",
    excludeDirect: direct === "exclude",
    cursor: decodeTradeCursor(params.get("cursor")),
    limit,
  };
}

// 종류별 기본 키 범위 3개(REALPRICE_KINDS 순서). 안 보는 종류는 빈 범위.
export function tradeKeyRanges(query, fromYmd = query.fromYmd, toYmd = query.toYmd) {
  return REALPRICE_KINDS.flatMap((kind) => (query.kinds.includes(kind) ? [`${kind}:${fromYmd}:`, `${kind}:${toYmd};`] : EMPTY_RANGE));
}

// 읽을 달 창: 맨 위 달(커서가 있으면 커서의 달, 없으면 to)부터 1·2·4·8…개월씩 오래된 쪽으로 넓힌다. 돌려주는 값: [[from, to], …](YYYYMM, 최근 창부터).
// 거래 ID의 달과 계약일의 달은 늘 같으므로(realprice-rows.mjs가 다른 달 행을 버림) 뒤 창의 행은 모두 앞 창의 행보다 계약일이 이르다.
// 그래서 창마다 같은 문장으로 정렬·LIMIT해 이어 붙이면 기간 전체를 한 번에 정렬한 것과 순서가 같다.
// 정렬은 거른 행을 한 번 더 읽은 것으로 세므로(TK-53 실측: 범위 8,580행 정렬에 17,160행) 쪽을 채울 만큼의 달만 읽는다.
export function tradeMonthWindows(query) {
  const cursorYmd = query.cursor ? query.cursor.dealDate.slice(0, 4) + query.cursor.dealDate.slice(5, 7) : null;
  const top = monthIndex(cursorYmd !== null && cursorYmd < query.toYmd ? cursorYmd : query.toYmd);
  const bottom = monthIndex(query.fromYmd);
  const windows = [];
  for (let to = top, size = 1; to >= bottom; size *= 2) {
    const from = Math.max(bottom, to - size + 1);
    windows.push([ymdFromIndex(from), ymdFromIndex(to)]);
    to = from - 1;
  }
  return windows;
}

// ── 신고가 ──

// 신고가를 판정하는 행: 매매, 해제 아님, 직거래 아님, 단지 고유번호 있음(모호 '*' 아님). 그 밖의 행은 recordHigh false(22.8절).
const isRecordHighTarget = (row) => row.kind === "sale" && Number(row.cancelled) === 0 && row.dealing_gbn !== "direct"
  && typeof row.cmp_seq === "string" && row.cmp_seq !== "" && row.cmp_seq !== "*";
const groupKey = (cmpSeq, areaX100) => `${cmpSeq}\u0000${Number(areaX100)}`;

// 돌려줄 쪽의 판정 대상 행을 단지·면적 묶음으로 모은다. 돌려주는 값: [[cmp_seq, area_x100, 가장 이른 계약일, 가장 늦은 계약일], …]
export function recordHighGroups(pageRows) {
  const groups = new Map();
  for (const row of pageRows.filter(isRecordHighTarget)) {
    const key = groupKey(row.cmp_seq, row.area_x100);
    const group = groups.get(key);
    if (!group) groups.set(key, [row.cmp_seq, Number(row.area_x100), row.deal_date, row.deal_date]);
    else {
      if (row.deal_date < group[2]) group[2] = row.deal_date;
      if (row.deal_date > group[3]) group[3] = row.deal_date;
    }
  }
  return [...groups.values()];
}

// 행마다 앞선 비교 대상 최고가(없으면 null). priorRows: REALPRICE_PRIOR_SQL 결과. 같은 날 거래는 서로 비교하지 않는다(deal_date <).
export function previousMaxByRow(pageRows, priorRows) {
  const byGroup = new Map();
  for (const prior of priorRows) {
    const key = groupKey(prior.cmp_seq, prior.area_x100);
    if (!byGroup.has(key)) byGroup.set(key, { before: null, trades: [] });
    const entry = byGroup.get(key);
    if (prior.deal_date === null || prior.deal_date === undefined) entry.before = prior.price_won ?? null;
    else entry.trades.push(prior);
  }
  return pageRows.map((row) => {
    if (!isRecordHighTarget(row)) return null;
    const entry = byGroup.get(groupKey(row.cmp_seq, row.area_x100));
    if (!entry) return null;
    let max = entry.before === null ? null : Number(entry.before);
    for (const trade of entry.trades) {
      if (trade.deal_date < row.deal_date && trade.price_won !== null && (max === null || Number(trade.price_won) > max)) max = Number(trade.price_won);
    }
    return max;
  });
}

// ── 목록 ──

function parseExtra(text) {
  try {
    const value = JSON.parse(text);
    return isPlainObject(value) ? value : {};
  } catch {
    return {};
  }
}

export function tradeView(row, { recordHighEnabled, nowMs }) {
  let recordHigh = null;
  if (recordHighEnabled) {
    // 그 거래 자신이 매매가 아니거나 해제·직거래이거나 단지 번호가 없으면 판정하지 않음(false). 앞선 비교 대상이 없으면(첫 거래) false.
    recordHigh = row.prev_max_won === null || row.prev_max_won === undefined ? false : Number(row.price_won) > Number(row.prev_max_won);
  }
  return {
    tradeKey: row.trade_key,
    kind: row.kind,
    dealDate: row.deal_date,
    umdName: row.umd_nm,
    jibun: row.jibun,
    aptSeq: row.apt_seq,
    aptName: row.apt_nm,
    areaM2: Number(row.area_x100) / 100,
    floor: row.floor,
    buildYear: row.build_year,
    priceWon: row.price_won,
    depositWon: row.deposit_won,
    monthlyRentWon: row.monthly_rent_won,
    dealingGbn: row.dealing_gbn,
    cancelled: Number(row.cancelled) === 1,
    cancelledOn: row.cancelled_on,
    registeredOn: row.registered_on,
    aptDong: row.apt_dong,
    extra: parseExtra(row.extra_json),
    recordHigh,
    prevMaxWon: recordHighEnabled && row.prev_max_won !== undefined ? row.prev_max_won : null,
    isNew: Number(row.is_backfill) === 0 && Date.parse(row.first_seen_at) >= nowMs - REALPRICE_NEW_DAYS * DAY_MS,
  };
}

// 고른 기간·종류의 받은 범위. pending은 아직 한 번도 받지 못한 달(최대 12개).
export function tradesCoverage(monthRows, query, currentYmd) {
  const done = new Set(monthRows.filter((row) => row.last_success_at).map((row) => `${row.kind}:${row.deal_ymd}`));
  const months = [];
  for (let index = monthIndex(query.fromYmd); index <= monthIndex(query.toYmd); index += 1) months.push(ymdFromIndex(index));
  const wanted = query.kinds.flatMap((kind) => months.filter((ymd) => ymd >= REALPRICE_START_MONTHS[kind]).map((ymd) => `${kind}:${ymd}`));
  const pending = wanted.filter((key) => !done.has(key));
  return {
    from: dashed(query.fromYmd),
    to: dashed(query.toYmd),
    kinds: query.kinds,
    monthsTotal: wanted.length,
    monthsDone: wanted.length - pending.length,
    pending: pending.slice(0, COVERAGE_PENDING_MAX).map((key) => `${key.split(":")[0]}:${dashed(key.split(":")[1])}`),
    saleCoveredThrough: saleCoveredThrough(monthRows, currentYmd),
  };
}

async function addReadUsage(db, nowMs, rowsRead) {
  // 사용량 쓰기가 실패해도 이미 읽은 자료는 돌려준다(읽기 예산이 조금 덜 세어질 뿐 자료를 바꾸지 않음).
  try {
    await addUsageStatement(db, nowMs, { rowsRead }).run();
  } catch {
    // 무시
  }
}

async function readTodayUsage(db, nowMs) {
  const row = await readUsageStatement(db, nowMs).first();
  return { rowsRead: Number(row?.rows_read ?? 0) };
}

// ids(쉼표로 이은 거래 ID 1 ~ 6개)가 없으면 null. 형식이 틀리거나 7개 이상이거나 목록 매개변수와 함께 오면 400. 같은 ID는 하나로 합친다(보낸 순서 유지).
export function parseTradeIds(params) {
  if (!params.has("ids")) return null;
  const conflicts = TRADES_LIST_PARAMS.filter((name) => params.has(name));
  if (conflicts.length > 0) throw invalid(["ids", ...conflicts]);
  const values = params.getAll("ids");
  if (values.length !== 1) throw invalid(["ids"]);
  const parts = values[0].split(",");
  if (parts.length > REALPRICE_IDS_MAX || parts.some((part) => !TRADE_KEY_PATTERN.test(part))) throw invalid(["ids"]);
  return [...new Set(parts)];
}

// 고른 거래들이 속한 달(거래 ID의 종류·연월)의 마지막 성공 시각 가운데 가장 이른 것(설계서 22.10 '자료를 받은 시각').
// 받은 기록이 없는 달이 섞이거나 거래가 없으면 null(모르는 시각을 지어내지 않음).
export function tradesReceivedAt(monthRows, tradeRows) {
  const success = new Map(monthRows.map((row) => [`${row.kind}:${row.deal_ymd}`, row.last_success_at]));
  let earliest = null;
  for (const row of tradeRows) {
    const at = success.get(row.trade_key.split(":", 2).join(":"));
    if (!at) return null;
    if (earliest === null || at < earliest) earliest = at;
  }
  return earliest;
}

// 목록과 고른 거래 다시 읽기가 함께 쓰는 앞부분: 하루 읽기 끝 상한(429)·첫 상한, 받은 달 기록, 신고가 판정 준비.
async function readTradesContext(db, nowMs) {
  const usage = await readTodayUsage(db, nowMs);
  if (usage.rowsRead >= REALPRICE_DAILY_READ_HARD) throw readBudgetExceededError(nowMs);
  const readSoftExceeded = usage.rowsRead >= REALPRICE_DAILY_READ_SOFT;
  const currentYmd = kstMonth(nowMs);
  const monthsResult = await readMonthsStatement(db).all();
  const monthRows = monthsResult.results ?? [];
  const saleDone = new Set(monthRows.filter((row) => row.kind === "sale" && row.last_success_at).map((row) => row.deal_ymd));
  const recordHighReady = expectedMonths("sale", currentYmd).every((ymd) => saleDone.has(ymd));
  return { readSoftExceeded, currentYmd, monthsResult, monthRows, recordHighReady, recordHighEnabled: recordHighReady && !readSoftExceeded };
}

// GET /work/realprice/trades?ids= (홍보물 화면, P1-e). 돌려주는 값: { items(보낸 순서), missing(못 찾은 ID), receivedAt, recordHighReady, warnings }
// 해제로 바뀐 거래도 cancelled: true로 그대로 돌려준다(빼는 것은 화면이 알리며 한다). receivedAt은 해제가 아닌 거래의 달만 본다.
async function readRealpriceTradesByIds(db, ids, { nowMs }) {
  const context = await readTradesContext(db, nowMs);
  const result = await db.prepare(REALPRICE_TRADES_BY_IDS_SQL).bind(JSON.stringify(ids)).all();
  let rowsRead = rowsReadOf(result);
  const byKey = new Map((result.results ?? []).map((row) => [row.trade_key, row]));
  const found = ids.filter((id) => byKey.has(id)).map((id) => byKey.get(id));
  const groups = context.recordHighEnabled ? recordHighGroups(found) : [];
  if (groups.length > 0) {
    const prior = await db.prepare(REALPRICE_PRIOR_SQL).bind(JSON.stringify(groups)).all();
    rowsRead += rowsReadOf(prior);
    const previous = previousMaxByRow(found, prior.results ?? []);
    found.forEach((row, index) => { row.prev_max_won = previous[index]; });
  }
  await addReadUsage(db, nowMs, 1 + rowsReadOf(context.monthsResult) + rowsRead);
  const warnings = [];
  if (context.readSoftExceeded) warnings.push({ code: "RT_READ_BUDGET", level: "soft" });
  return {
    items: found.map((row) => tradeView(row, { recordHighEnabled: context.recordHighEnabled, nowMs })),
    missing: ids.filter((id) => !byKey.has(id)),
    receivedAt: tradesReceivedAt(context.monthRows, found.filter((row) => Number(row.cancelled) === 0)),
    recordHighReady: context.recordHighReady,
    warnings,
  };
}

// GET /work/realprice/trades. 돌려주는 값: { items, nextCursor, recordHighReady, coverage, warnings }
export async function listRealpriceTrades(db, params, { nowMs }) {
  const ids = parseTradeIds(params);
  if (ids) return readRealpriceTradesByIds(db, ids, { nowMs });
  const query = parseTradesQuery(params, nowMs);
  const { readSoftExceeded, currentYmd, monthsResult, monthRows, recordHighReady, recordHighEnabled } = await readTradesContext(db, nowMs);

  // 최근 달 창부터 읽어 돌려줄 수 + 1건이 차면 멈춘다(36개월이면 창 6개, 문장 최대 6번).
  const rowsAll = [];
  let rowsRead = 0;
  for (const [fromYmd, toYmd] of tradeMonthWindows(query)) {
    const result = await db.prepare(REALPRICE_TRADES_SQL).bind(
      ...tradeKeyRanges(query, fromYmd, toYmd),
      query.includeCancelled ? 1 : 0,
      query.excludeDirect ? 1 : 0,
      query.aptSeq,
      query.umd,
      query.areaMin,
      query.areaMax,
      query.priceMin,
      query.priceMax,
      query.watch ? 1 : 0,
      query.cursor?.dealDate ?? null,
      query.cursor?.tradeKey ?? null,
      query.limit + 1 - rowsAll.length,
    ).all();
    rowsRead += rowsReadOf(result);
    rowsAll.push(...(result.results ?? []));
    if (rowsAll.length > query.limit) break;
  }
  const page = rowsAll.slice(0, query.limit);
  const last = page.at(-1);
  // 신고가: 돌려줄 쪽의 판정 대상 매매 행이 있을 때만 묶음별 비교 자료를 한 번 더 읽는다(전월세·분양권만이면 읽지 않음).
  const groups = recordHighEnabled ? recordHighGroups(page) : [];
  if (groups.length > 0) {
    const prior = await db.prepare(REALPRICE_PRIOR_SQL).bind(JSON.stringify(groups)).all();
    rowsRead += rowsReadOf(prior);
    const previous = previousMaxByRow(page, prior.results ?? []);
    page.forEach((row, index) => { row.prev_max_won = previous[index]; });
  }
  // .first()는 D1에서도 meta를 주지 않아 1행으로 센다(오늘 사용량).
  await addReadUsage(db, nowMs, 1 + rowsReadOf(monthsResult) + rowsRead);
  const warnings = [];
  if (readSoftExceeded) warnings.push({ code: "RT_READ_BUDGET", level: "soft" });
  return {
    items: page.map((row) => tradeView(row, { recordHighEnabled, nowMs })),
    nextCursor: rowsAll.length > query.limit && last ? encodeTradeCursor(last.deal_date, last.trade_key) : null,
    recordHighReady,
    coverage: tradesCoverage(monthRows, query, currentYmd),
    warnings,
  };
}

// ── 단지 찾기 ──

// 받은 단지명을 공개 단지(complexes.json published) 이름·별칭과 맞춘 후보. 하나로 정해지지 않으면 null(운영자가 설정 화면에서 고름).
export function suggestComplexSlug(aptName) {
  const name = normalizeComplexText(aptName);
  if (!name) return null;
  const matched = PUBLISHED_COMPLEXES.filter((complex) => getComplexMatchCandidates(complex).some((candidate) => name.includes(candidate)));
  return matched.length === 1 ? matched[0].slug : null;
}

export function parseComplexQuery(value) {
  if (value === null || value === undefined) throw invalid(["q"]);
  const text = value.normalize("NFKC").trim();
  if (text.length < 1 || text.length > REALPRICE_COMPLEX_QUERY_MAX || CONTROL_PATTERN.test(text)) throw invalid(["q"]);
  const needle = text.toLowerCase().replace(/\s+/gu, "");
  if (needle.length < 1) throw invalid(["q"]);
  return needle;
}

// GET /work/realprice/complexes?q=. 돌려주는 값: { items: [{ aptSeq, aptName, umdName, tradeCount, lastDealDate, suggestedSlug }] }
export async function searchRealpriceComplexes(db, params, { nowMs }) {
  const needle = parseComplexQuery(params.get("q"));
  const usage = await readTodayUsage(db, nowMs);
  if (usage.rowsRead >= REALPRICE_DAILY_READ_HARD) throw readBudgetExceededError(nowMs);
  const currentYmd = kstMonth(nowMs);
  const fromYmd = ymdFromIndex(monthIndex(currentYmd) - (REALPRICE_COMPLEX_SEARCH_MONTHS - 1));
  const result = await db.prepare(REALPRICE_COMPLEXES_SQL).bind(`sale:${fromYmd}:`, `sale:${currentYmd};`, needle, REALPRICE_COMPLEX_RESULT_MAX).all();
  await addReadUsage(db, nowMs, 1 + rowsReadOf(result));
  return {
    items: (result.results ?? []).map((row) => ({
      aptSeq: row.apt_seq,
      aptName: row.apt_nm,
      umdName: row.umd_nm,
      tradeCount: Number(row.trade_count),
      lastDealDate: row.last_deal_date,
      suggestedSlug: suggestComplexSlug(row.apt_nm),
    })),
  };
}

// ── 관심 단지 ──

function parseVersionValue(valueJson) {
  try {
    const value = JSON.parse(valueJson);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

async function readWatchVersion(db) {
  const row = await db.prepare(WATCH_VERSION_SQL).bind(REALPRICE_WATCH_VERSION_SETTING).first();
  return row ? parseVersionValue(row.value_json) : null;
}

const watchItemView = (row) => ({ aptSeq: row.apt_seq, displayName: row.display_name, complexSlug: row.complex_slug ?? null });

// GET /work/realprice/watch. 돌려주는 값: { version, items }. 읽기가 작아(20행 이하) 사용량에 더하지 않는다.
export async function readRealpriceWatch(db) {
  const version = await readWatchVersion(db);
  if (version === null) throw new WorkApiError("WORK_SCHEMA_OUTDATED", "업무 자료 구조가 아직 준비되지 않았습니다.", 503);
  const list = await db.prepare(WATCH_LIST_SQL).all();
  return { version, items: (list.results ?? []).map(watchItemView) };
}

// PUT 본문: { version, items: [{ aptSeq, displayName, complexSlug? }] }(최대 20개, 통째로 바꿈).
export function parseWatchBody(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => key !== "version" && key !== "items")) throw invalid(["body"]);
  const { version, items } = body;
  if (!Number.isSafeInteger(version) || version < 0) throw invalid(["version"]);
  if (!Array.isArray(items) || items.length > REALPRICE_WATCH_MAX) throw invalid(["items"]);
  const seen = new Set();
  const parsed = items.map((item) => {
    if (!isPlainObject(item) || Object.keys(item).some((key) => !["aptSeq", "displayName", "complexSlug"].includes(key))) throw invalid(["items"]);
    if (typeof item.aptSeq !== "string" || !APT_SEQ_PATTERN.test(item.aptSeq) || seen.has(item.aptSeq)) throw invalid(["aptSeq"]);
    seen.add(item.aptSeq);
    if (typeof item.displayName !== "string") throw invalid(["displayName"]);
    const displayName = item.displayName.normalize("NFC").trim();
    if (displayName.length < 1 || displayName.length > REALPRICE_WATCH_NAME_MAX || CONTROL_PATTERN.test(displayName)) throw invalid(["displayName"]);
    const complexSlug = item.complexSlug ?? null;
    if (complexSlug !== null && (typeof complexSlug !== "string" || !PUBLISHED_SLUGS.has(complexSlug))) throw invalid(["complexSlug"]);
    return { aptSeq: item.aptSeq, displayName, complexSlug };
  });
  return { version, items: parsed };
}

// 관심 단지 저장 batch(guard → version 올림 → 지우기 → 넣기 → 감사). 하나의 트랜잭션이라 guard가 막으면 모두 되돌린다.
export function watchSaveStatements(db, input, nowMs) {
  const at = iso(nowMs);
  const statements = [
    db.prepare(WATCH_GUARD_SQL).bind(REALPRICE_WATCH_VERSION_SETTING, JSON.stringify(input.version)),
    db.prepare(WATCH_BUMP_SQL).bind(REALPRICE_WATCH_VERSION_SETTING, JSON.stringify(input.version + 1), at),
    db.prepare(WATCH_CLEAR_SQL),
  ];
  if (input.items.length > 0) {
    const values = input.items.map((item, index) => [item.aptSeq, item.displayName, item.complexSlug, index]);
    statements.push(db.prepare(WATCH_INSERT_SQL).bind(JSON.stringify(values), at));
  }
  return statements;
}

const watchVersionConflict = () => new WorkApiError("VERSION_CONFLICT", "다른 화면에서 먼저 고쳤습니다. 다시 불러온 뒤 저장해 주세요.", 409);

// PUT /work/realprice/watch. 감사 realprice.watch.update(reason watch_count=N)를 같은 batch에 넣는다(22.12절).
// batch가 실패하면 다시 읽어 version이 바뀌었으면 409, 아니면 저장소 오류(503) 그대로.
export async function saveRealpriceWatch(db, body, { nowMs, actorEmail, requestId }) {
  const input = parseWatchBody(body);
  try {
    await runBatch(db, [
      ...watchSaveStatements(db, input, nowMs),
      auditStatement(db, {
        at: iso(nowMs),
        actorEmail,
        action: "realprice.watch.update",
        requestId,
        outcome: "ok",
        reason: `watch_count=${input.items.length}`,
      }),
    ]);
  } catch (error) {
    let latest = null;
    try {
      latest = await readWatchVersion(db);
    } catch {
      // 다시 읽기도 실패하면 처음 오류를 그대로 돌려준다.
    }
    if (latest !== null && latest !== input.version) throw watchVersionConflict();
    throw error;
  }
  return readRealpriceWatch(db);
}
