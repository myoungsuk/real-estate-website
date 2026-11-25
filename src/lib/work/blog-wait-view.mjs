// 글 초안 '화면을 닫아도 받기'(2026-11-25 사용자 결정 "추천대로")의 순수 함수. 화면 스크립트(work-blog-wait.ts)가 쓰고 시험이 직접 부른다.
// 만드는 중에 화면을 닫으면 서버(1분 예약)가 글을 받아 둔다. 다시 열었을 때 알려 주려고, 이 브라우저가 기다리던 초안 번호만 기억한다.
// - 기억하는 것은 초안 번호(무작위 UUID)의 배열뿐이다. 글·제목·단지 이름·소재지·시각은 넣지 않는다(알림 글은 서버 보관 목록에서 만든다).
// - 여기서는 브라우저 저장소를 읽거나 쓰지 않는다(글자 ↔ 배열 바꾸기와 알림 문장만).
import { failView, isOpenStatus } from "./blog-view.mjs";
import { kstShort } from "./realprice-view.mjs";

export const BLOG_WAITING_STORAGE_KEY = "leaderscityhappy.admin.blog.waiting.v1";
// 보관 목록이 20개까지라(worker/work-blog.mjs BLOG_DRAFT_LIST_LIMIT) 그보다 많이 기억할 까닭이 없다.
export const BLOG_WAITING_MAX = 20;
// 서버의 초안 번호 꼴(worker/work-input.mjs UUID_PATTERN)과 같다. 이 꼴이 아닌 글자는 기억하지 않는다.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const isWaitingId = (value) => typeof value === "string" && UUID_PATTERN.test(value);

// 저장소에서 읽은 글자 → 초안 번호 배열. 모양이 다르면(남이 고쳤거나 옛 꼴) 빈 배열로 본다.
export function parseWaitingIds(raw) {
  if (typeof raw !== "string" || raw === "") return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter(isWaitingId))].slice(-BLOG_WAITING_MAX);
}

export const serializeWaitingIds = (ids) => JSON.stringify(ids.filter(isWaitingId).slice(-BLOG_WAITING_MAX));

export function addWaitingId(ids, id) {
  if (!isWaitingId(id)) return ids;
  return [...ids.filter((entry) => entry !== id), id].slice(-BLOG_WAITING_MAX);
}

export const removeWaitingId = (ids, id) => ids.filter((entry) => entry !== id);

// "오늘 14:58" 또는 "11. 24. 14:58"(한국 시각).
export function startedText(createdAt, nowMs) {
  const [month, day, time] = kstShort(createdAt).split(" ");
  const [nowMonth, nowDay] = kstShort(new Date(nowMs).toISOString()).split(" ");
  const sameDay = month === nowMonth && day === nowDay && Math.abs(nowMs - Date.parse(createdAt)) < 86_400_000;
  return sameDay ? `오늘 ${time}` : `${month} ${day} ${time}`;
}

// 기다리던 초안 번호와 방금 받은 보관 목록을 맞춰 본다.
// 돌려주는 값: keep = 계속 기억할 번호, notices = 맨 위에 보일 알림(다 만든 글·만들지 못한 글).
// - 목록에 없거나(지워짐) 닫힌 초안(다 씀·버림·30일 지남)은 잊는다.
// - 아직 만드는 중인 초안은 알림 없이 계속 기억한다. skipId(지금 화면에서 기다리는 초안)는 목록에 아직 없어도 기억한다.
/**
 * @param {string[]} ids
 * @param {Array<{ id: string, source: { title: string }, status: string, closed: string | null, errorCode: string | null, createdAt: string }>} items
 * @param {{ nowMs: number, skipId?: string | null }} options
 */
export function waitingNotices(ids, items, { nowMs, skipId = null }) {
  const byId = new Map((items ?? []).map((item) => [item.id, item]));
  const keep = [];
  const notices = [];
  for (const id of ids) {
    if (id === skipId) {
      keep.push(id);
      continue;
    }
    const item = byId.get(id);
    if (!item || item.closed) continue;
    keep.push(id);
    if (isOpenStatus(item.status)) continue;
    const started = `${item.source.title} · ${startedText(item.createdAt, nowMs)}에 만들기 시작`;
    if (item.status === "completed") {
      notices.push({ id, kind: "done", title: "기다리던 글이 다 만들어졌습니다", detail: `${started} · 화면을 닫은 동안 받아 두었습니다`, action: "글 열기", name: item.source.title });
    } else {
      notices.push({ id, kind: "failed", title: "기다리던 글을 만들지 못했습니다", detail: `${started} · ${failView(item).title}`, action: "까닭 보기", name: item.source.title });
    }
  }
  return { keep, notices };
}
