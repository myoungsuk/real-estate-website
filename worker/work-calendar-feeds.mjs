// 업무 도구 단계 3: 휴대폰 캘린더 구독 주소(설계서 12.3절, DEC-WT-05). 모든 SQL은 준비된 문장(고정 문자열 + bind)만 쓴다.
// - 관리 쪽(Access 안): GET·POST /work/calendar-feeds, DELETE /work/calendar-feeds/:id. work-api.mjs가 Access·CSRF·구조 번호를 먼저 본다.
// - 공개 쪽(Access 밖): GET /api/calendar/{token}.ics. 캘린더 앱은 Access 로그인을 못 하므로 토큰(256비트)만으로 연다.
//   D1에는 토큰 원문 대신 HMAC-SHA256(token, WORK_FEED_TOKEN_PEPPER)만 둔다. 원문은 만들 때 한 번만 돌려준다.
//   없음·취소·형식 틀림·꺼짐·구조 불일치는 모두 같은 404(바이트까지 같음)로 답해 주소가 있는지 알려 주지 않는다.
//   캘린더 앱이 몇 분마다 받아 가도 D1 쓰기가 늘지 않게, last_used_at은 한국 날짜가 바뀐 뒤 처음 받을 때만 쓴다(하루 1번).
//   받기는 감사 기록을 남기지 않는다(8.8절 감사 동작은 feed.create·feed.revoke뿐, 받을 때마다 쓰면 D1 쓰기가 받는 횟수만큼 는다).
import { cleanSingleLine } from "../src/lib/work/work-format.mjs";
import { WorkApiError, getWorkConfigState } from "./work-security.mjs";
import { auditStatement, runBatch } from "./work-audit.mjs";
import { invalid, isUuid, koreaDate } from "./work-input.mjs";
import { all, auditBase, methodNotAllowed, notFound } from "./work-customers.mjs";
import { DEFAULT_ALARM_TRIGGERS, buildDealIcsCalendar } from "./work-calendar.mjs";
import { EVENT_KIND_LABELS, ruleText } from "./work-events.mjs";
import { WORK_SCHEMA_VERSION, readSchemaVersion } from "./work-api.mjs";
import { loadAppointmentOccurrences } from "./work-appointments.mjs";
import { APPOINTMENT_TAGS, appointmentAlarmTrigger } from "../src/lib/work/appointment-rules.mjs";

export const CALENDAR_FEED_PREFIX = "/api/calendar/";
export const FEED_TOKEN_BYTES = 32;
export const FEED_LABEL_MAX = 40;
export const FEED_PEPPER_MIN = 32;
export const FEED_PAST_DAYS = 30;
// 구독 한 번에 넣는 최대 개수(일정·할 일 각각). 넘으면 날짜가 늦은 것(다가올 일정)부터 넣고 오래된 것을 뺀다.
export const FEED_ITEM_LIMIT = 500;
// 거래 없는 일정(0009, 6.15절): 한국 날짜 오늘 −30일 ~ +180일을 날짜마다 펼쳐 500개까지(넘으면 먼 미래부터 뺌, 대장 결정 2026-11-26).
export const FEED_APPOINTMENT_FUTURE_DAYS = 180;
export const FEED_APPOINTMENT_LIMIT = 500;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const FEED_PATH_PATTERN = /^\/api\/calendar\/([^/]+)\.ics$/u;
const DAY_MS = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

const FEED_COLUMNS = "id, label, created_at, last_used_at, revoked_at";
const SQL = Object.freeze({
  activeFeeds: "SELECT " + FEED_COLUMNS + " FROM calendar_feeds WHERE revoked_at IS NULL ORDER BY created_at DESC, id",
  feedById: "SELECT " + FEED_COLUMNS + " FROM calendar_feeds WHERE id = ?",
  feedByHash: "SELECT id, last_used_at FROM calendar_feeds WHERE token_hash = ? AND revoked_at IS NULL",
  // 새 주소를 만들면 이전 주소는 자동 취소(12.3절). 취소 감사는 취소되는 줄마다 같은 batch 안에서 남긴다(취소보다 먼저 실행).
  auditReplaced:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) "
    + "SELECT ?, ?, 'feed.revoke', 'calendar_feed', id, ?, 'ok', 'replaced' FROM calendar_feeds WHERE revoked_at IS NULL",
  revokeAll: "UPDATE calendar_feeds SET revoked_at = ? WHERE revoked_at IS NULL",
  insertFeed: "INSERT INTO calendar_feeds (id, token_hash, label, created_at) VALUES (?, ?, ?, ?)",
  revokeOne: "UPDATE calendar_feeds SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
  // 취소가 이 요청에서 실제로 적용됐을 때만 감사가 남게 같은 batch 안에서 조건을 건다(동시에 두 번 눌러도 기록 1줄).
  auditIfRevoked:
    "INSERT INTO audit_events (at, actor_email, action, target_type, target_id, request_id, outcome, reason) "
    + "SELECT ?, ?, 'feed.revoke', 'calendar_feed', ?, ?, 'ok', NULL WHERE EXISTS (SELECT 1 FROM calendar_feeds WHERE id = ? AND revoked_at = ?)",
  // 하루 1번: 같은 한국 날짜에 이미 썼으면 조건이 맞지 않아 0줄(동시에 받아도 두 번 쓰지 않음).
  touchFeed: "UPDATE calendar_feeds SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL AND (last_used_at IS NULL OR last_used_at < ?)",
  // 끝나지 않은 일정(날짜와 상관없이) + 지난 30일 안의 일정(끝낸 것 포함). 손님 이름·전화번호·메모는 읽지 않는다.
  // 취소한 거래(status 'cancelled')의 일정은 넣지 않는다(사용자 결정 2026-11-23 08:55:04 "뺌 (Recommended)"). 거래를 다시 열면 다음 받기에 돌아온다.
  feedEvents:
    "SELECT e.id, e.kind, e.due_on, e.title, e.alarm_offsets, e.done_at, d.title AS deal_title FROM deal_events e JOIN deals d ON d.id = e.deal_id "
    + "WHERE d.status <> 'cancelled' AND (e.done_at IS NULL OR e.due_on >= ?) ORDER BY e.due_on DESC, e.id LIMIT ?",
  // 날짜 있는 할 일만, 같은 기준(끝나지 않은 것 + 지난 30일).
  feedTasks:
    "SELECT id, title, due_on, done_at FROM tasks WHERE due_on IS NOT NULL AND (done_at IS NULL OR due_on >= ?) ORDER BY due_on DESC, id LIMIT ?",
});

export function isCalendarFeedPath(pathname) {
  return pathname.startsWith(CALENDAR_FEED_PREFIX);
}

export function isFeedPepperReady(pepper) {
  return typeof pepper === "string" && pepper.length >= FEED_PEPPER_MIN;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// 토큰: 32바이트 무작위 → base64url 43자(T3-02).
export function createFeedToken(randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length))) {
  return base64Url(randomBytes(FEED_TOKEN_BYTES));
}

// D1에 두는 값: HMAC-SHA256(키 = WORK_FEED_TOKEN_PEPPER, 내용 = 토큰)의 16진 64자.
export async function feedTokenHash(token, pepper) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(token)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function feedView(row) {
  return { id: row.id, label: row.label, createdAt: row.created_at, lastUsedAt: row.last_used_at, revokedAt: row.revoked_at };
}

function feedConfigMissing() {
  return new WorkApiError("WORK_CONFIG_MISSING", "구독 주소 설정이 완료되지 않았습니다.", 503);
}

function parseFeedCreate(body) {
  const source = body ?? {};
  if (typeof source !== "object" || Array.isArray(source)) throw invalid([]);
  const unknown = Object.keys(source).filter((key) => key !== "label");
  if (unknown.length > 0) throw invalid(unknown.slice(0, 5));
  if (source.label === undefined || source.label === null) return { label: "" };
  if (typeof source.label !== "string") throw invalid(["label"]);
  const label = cleanSingleLine(source.label, FEED_LABEL_MAX + 1);
  if (label.length > FEED_LABEL_MAX) throw invalid(["label"]);
  return { label };
}

async function listFeeds(ctx) {
  return { data: { feeds: (await all(ctx.db.prepare(SQL.activeFeeds))).map(feedView) } };
}

// 새 주소: 이전 주소 취소(감사 feed.revoke reason=replaced) → 새 줄 → 감사 feed.create를 한 batch로. 주소 원문은 이 응답에만 있다.
async function createFeed(ctx) {
  if (!isFeedPepperReady(ctx.feedPepper)) throw feedConfigMissing();
  const { label } = parseFeedCreate(ctx.body);
  const id = ctx.randomUUID();
  const at = new Date(ctx.now).toISOString();
  const token = createFeedToken(ctx.randomBytes);
  const tokenHash = await feedTokenHash(token, ctx.feedPepper);
  await runBatch(ctx.db, [
    ctx.db.prepare(SQL.auditReplaced).bind(at, ctx.actor.email.toLowerCase(), ctx.requestId),
    ctx.db.prepare(SQL.revokeAll).bind(at),
    ctx.db.prepare(SQL.insertFeed).bind(id, tokenHash, label, at),
    auditStatement(ctx.db, { ...auditBase(ctx, "feed.create", { targetType: "calendar_feed", targetId: id }), outcome: "ok" }),
  ]);
  return {
    status: 201,
    data: {
      feed: { id, label, createdAt: at, lastUsedAt: null, revokedAt: null },
      subscribeUrl: `${ctx.url.origin}${CALENDAR_FEED_PREFIX}${token}.ics`,
    },
  };
}

// 취소: 이미 취소된 주소는 그대로 { revoked: true }(다시 쓰지 않음). 없는 id는 404.
async function revokeFeed(ctx, id) {
  if (ctx.body && Object.keys(ctx.body).length > 0) throw invalid(Object.keys(ctx.body).slice(0, 5));
  const row = await ctx.db.prepare(SQL.feedById).bind(id).first();
  if (!row) throw notFound();
  if (row.revoked_at === null) {
    const at = new Date(ctx.now).toISOString();
    await runBatch(ctx.db, [
      ctx.db.prepare(SQL.revokeOne).bind(at, id),
      ctx.db.prepare(SQL.auditIfRevoked).bind(at, ctx.actor.email.toLowerCase(), id, ctx.requestId, id, at),
    ]);
  }
  return { data: { revoked: true } };
}

// 관리 경로면 { status?, data }를, 아니면 null을 돌려준다. /calendar-feeds(GET·POST), /calendar-feeds/:id(DELETE)
export async function routeWorkCalendarFeeds(ctx) {
  const segments = ctx.route.split("/").filter(Boolean);
  if (segments[0] !== "calendar-feeds" || segments.length > 2) return null;
  if (segments.length === 1) {
    if (ctx.method === "GET") return listFeeds(ctx);
    if (ctx.method === "POST") return createFeed(ctx);
    throw methodNotAllowed("GET, POST");
  }
  if (!isUuid(segments[1])) throw notFound();
  if (ctx.method === "DELETE") return revokeFeed(ctx, segments[1]);
  throw methodNotAllowed("DELETE");
}

// ── 공개 쪽 ──

const FEED_HEADERS = Object.freeze({
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
});

function feedTextResponse(status, text, extra = {}) {
  return new Response(text, { status, headers: { ...FEED_HEADERS, "Content-Type": "text/plain; charset=utf-8", ...extra } });
}

// 없음·취소·형식 틀림·꺼짐·구조 불일치가 모두 이 응답 하나(T3-03).
export function feedNotFound() {
  return feedTextResponse(404, "Not found\n");
}

function feedUnavailable() {
  return feedTextResponse(503, "Service unavailable\n", { "Retry-After": "300" });
}

function koreaDayStartIso(now) {
  return new Date(Date.parse(`${koreaDate(now)}T00:00:00+09:00`)).toISOString();
}

function parseAlarms(text) {
  try {
    const value = JSON.parse(text);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

// 일정 이름(DEC-WT-42): 거래 일정은 '일정 종류 · 거래 제목'(직접 넣은 일정은 종류 대신 그 일정 제목), 날짜 있는 할 일은 할 일 제목.
// 알림은 일정에 저장된 알림(기본 전날 18:00, 거래 화면에서 바꾼 값은 그대로), 할 일은 전날 18:00.
// 끝낸 것(지난 30일 안)은 "완료 · "를 앞에 붙이고 알림을 넣지 않는다. 설명은 일정 종류와 법정 문구만(손님 전화번호·메모 없음, 12.3절).
export function feedCalendarEvents(events, tasks) {
  const items = [];
  for (const row of events) {
    const done = row.done_at !== null;
    const kind = EVENT_KIND_LABELS[row.kind] ?? "";
    const name = row.kind === "custom" || !kind ? row.title : kind;
    items.push({
      uidKey: `event-${row.id}`,
      date: row.due_on,
      title: `${done ? "완료 · " : ""}${name} · ${row.deal_title}`,
      description: [kind, ruleText(row.kind)].filter(Boolean).join("\n"),
      alarmTriggers: done ? [] : parseAlarms(row.alarm_offsets),
    });
  }
  for (const row of tasks) {
    const done = row.done_at !== null;
    items.push({
      uidKey: `task-${row.id}`,
      date: row.due_on,
      title: `${done ? "완료 · " : ""}${row.title}`,
      description: "할 일",
      alarmTriggers: done ? [] : [...DEFAULT_ALARM_TRIGGERS],
    });
  }
  return items.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
}

// 거래 없는 일정: 이름 '꼬리표 · 제목', 설명 '직접 넣은 일정', UID 'appt-<id>-<YYYYMMDD>'(날마다 따로, 달력 key와 같음).
// 시각 있으면 startTime·endTime을 실어 시각 일정으로. 알림은 일정의 알림 키를 그날 시작 시각 기준으로 바꾼 값이고, 오늘 전 날에는 넣지 않는다.
// 끝내기 칸이 없어 "완료 · "는 붙지 않는다. 손님 칸이 없어 손님 정보는 없다(제목에 사무소가 적은 글만, 처리방침 8항).
export function feedAppointmentEvents(occurrences, today) {
  return occurrences.map(({ key, on, appointment }) => {
    const tag = APPOINTMENT_TAGS[appointment.tag] ?? "";
    const triggers = on < today ? [] : appointment.alarms.map((alarm) => appointmentAlarmTrigger(alarm, appointment.startTime));
    return {
      uidKey: key,
      date: on,
      title: tag ? `${tag} · ${appointment.title}` : appointment.title,
      description: "직접 넣은 일정",
      alarmTriggers: triggers.every((trigger) => trigger !== null) ? triggers : [],
      ...(appointment.startTime === null ? {} : { startTime: appointment.startTime, endTime: appointment.endTime }),
    };
  });
}

function logFeed(log, entry) {
  try {
    log({ event: "calendar_feed", ...entry });
  } catch {
    // Worker 로그 장애는 무시한다.
  }
}

// HEAD는 GET과 같은 상태·헤더를 본문 없이 돌려준다(캘린더 앱·점검 도구가 먼저 HEAD로 확인하는 경우).
// 실제로 받아 간 것이 아니므로 last_used_at을 쓰지 않는다.
function withoutBody(response) {
  return new Response(null, { status: response.status, headers: response.headers });
}

/**
 * GET·HEAD /api/calendar/{token}.ics. 토큰·주소는 어떤 로그에도 남기지 않는다.
 * @param {Request} request
 * @param {object} env
 * @param {{ now?: () => number, log?: (entry: object) => void }} [options]
 */
export async function handleCalendarFeedRequest(request, env, options = {}) {
  if (request.method === "HEAD") return withoutBody(await answerFeed(request, env, options, { touch: false }));
  if (request.method !== "GET") return feedTextResponse(405, "Method not allowed\n", { Allow: "GET, HEAD" });
  return answerFeed(request, env, options, { touch: true });
}

async function answerFeed(request, env, options, { touch }) {
  const now = typeof options.now === "function" ? options.now() : Date.now();
  const log = options.log ?? ((entry) => console.info(JSON.stringify(entry)));
  const match = FEED_PATH_PATTERN.exec(new URL(request.url).pathname);
  const token = match?.[1] ?? "";
  const db = env?.WORK_DB;
  if (!TOKEN_PATTERN.test(token) || getWorkConfigState(env, db) !== "enabled" || !isFeedPepperReady(env?.WORK_FEED_TOKEN_PEPPER)) {
    return feedNotFound();
  }
  try {
    const schemaVersion = await readSchemaVersion(db);
    if (schemaVersion !== WORK_SCHEMA_VERSION) return feedNotFound();
    const feed = await db.prepare(SQL.feedByHash).bind(await feedTokenHash(token, env.WORK_FEED_TOKEN_PEPPER)).first();
    if (!feed) return feedNotFound();
    const cutoff = koreaDate(now - FEED_PAST_DAYS * DAY_MS);
    const events = await all(db.prepare(SQL.feedEvents).bind(cutoff, FEED_ITEM_LIMIT));
    const tasks = await all(db.prepare(SQL.feedTasks).bind(cutoff, FEED_ITEM_LIMIT));
    const today = koreaDate(now);
    const appointments = await loadAppointmentOccurrences(db, cutoff, koreaDate(now + FEED_APPOINTMENT_FUTURE_DAYS * DAY_MS), FEED_APPOINTMENT_LIMIT);
    const items = [...feedCalendarEvents(events, tasks), ...feedAppointmentEvents(appointments, today)]
      .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
    const body = buildDealIcsCalendar({ now: new Date(now), events: items });
    const dayStart = koreaDayStartIso(now);
    if (touch && (feed.last_used_at === null || feed.last_used_at < dayStart)) {
      try {
        await db.prepare(SQL.touchFeed).bind(new Date(now).toISOString(), feed.id, dayStart).run();
      } catch (error) {
        // 받은 날짜를 못 적어도 일정은 그대로 보낸다.
        logFeed(log, { outcome: "touch_failed", errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error" });
      }
    }
    return new Response(body, { status: 200, headers: { ...FEED_HEADERS, "Content-Type": "text/calendar; charset=utf-8" } });
  } catch (error) {
    logFeed(log, { outcome: "unavailable", errorName: typeof error?.name === "string" ? error.name.slice(0, 40) : "Error" });
    return feedUnavailable();
  }
}
