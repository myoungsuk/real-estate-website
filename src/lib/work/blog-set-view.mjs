// 글 초안 1편·3편 고르기 화면 문장(순수 함수). 서버 요청·브라우저 저장 없음.
// 2026-11-25 사용자 결정(판 1 물음 4·5·6 "전부 추천대로"): 1편/3편 중 고르고 처음 값은 3편. 3편은 첫 문장·짜임만 다르고(지시문 끝 한 줄, worker BLOG_SET_LINES),
// 고르지 않은 편은 '내 초안'(보관 중인 초안)에 남는다. 3편은 하루 한도 3편 몫과 3편 예상 비용을 단추 위에 보인다(판 1 추천 4 "3편은 한도 3편 몫과 예상 비용을 단추 위에 보임").
import { isOpenStatus, limitsView, usdText } from "./blog-view.mjs";

export const BLOG_SET_SIZES = Object.freeze([1, 3]); // worker/work-blog.mjs BLOG_SET_SIZES와 같아야 한다(시험이 봄).
export const BLOG_SET_DEFAULT = 3;
export const BLOG_SET_CHOICES = Object.freeze([
  Object.freeze({ count: 3, label: "3편 같이 만들기", note: "첫 문장·짜임만 다른 3편을 나란히 보고 고름" }),
  Object.freeze({ count: 1, label: "1편만", note: "한도 1편 몫" }),
]);
// 1편 값(참고): 운영에서 1편씩 잰 0.0329 ~ 0.0513달러(설계서 22장 지시문 줄인 뒤·앞 측정, 추정). 서버는 이 값이 아니라 자기 최대 예상으로 예약한다.
export const BLOG_DRAFT_COST_MICRO = Object.freeze({ low: 32_900, high: 51_300 });

const roundCents = (micro) => (Math.round(micro / 10_000) / 100).toFixed(2);

export const isSetSize = (value) => BLOG_SET_SIZES.includes(value);

// 만들기 단추 위 한 줄. limits: GET /work/blog/limits 응답. 돌려주는 값: { line, reason }. reason이 있으면 단추를 막는다(서버가 최종 판단).
export function makeCountView(limits, count) {
  const size = isSetSize(count) ? count : BLOG_SET_DEFAULT;
  const base = limitsView(limits);
  if (!base.saved) return { line: "", reason: base.reason };
  const used = limits.usage?.todayCreates ?? 0;
  const left = Math.max(0, limits.dailyCreateLimit - used);
  const monthUsed = limits.usage?.monthCostMicroUsd ?? 0;
  const monthLeft = Math.max(0, limits.monthlyCostLimitMicroUsd - monthUsed);
  const cost = `예상 비용 약 ${roundCents(BLOG_DRAFT_COST_MICRO.low * size)} ~ ${roundCents(BLOG_DRAFT_COST_MICRO.high * size)}달러(추정, 이번 달 남은 ${usdText(monthLeft)}달러)`;
  const line = `한도 ${size}편 몫을 씁니다 · 오늘 남은 ${left}편 · ${cost}`;
  if (base.reason) return { line, reason: base.reason };
  if (left < size) return { line, reason: `오늘 남은 편수가 ${left}편이라 ${size}편을 같이 만들 수 없습니다. '1편만'으로 바꾸거나 내일 0시(한국 시각)부터 다시 만들어 주세요.` };
  return { line, reason: null };
}

// 만들기를 누른 뒤 안내(걸리는 시간).
export const makeWaitText = (count) => (count === 3 ? "3편을 같이 만듭니다. 1 ~ 3분 걸리고, 먼저 끝난 편부터 보입니다." : "1 ~ 3분 걸립니다.");

// 보관 목록·탭에 붙이는 이름. 1편으로 만든 초안은 "".
export function setTag(set) {
  if (!set || !Number.isSafeInteger(set.n) || !Number.isSafeInteger(set.of) || set.of < 2) return "";
  return `${set.of}편 중 ${set.n}편`;
}

const SET_STATUS = { done: "다 됨", open: "만드는 중", failed: "못 만듦" };
// draft: 초안 전체(BlogDraft) 또는 보관 목록 한 줄(BlogDraftListItem). 닫힌 편이라도 다 만든 글이면 열어 볼 수 있다.
function partState(draft) {
  if (!draft) return "open";
  if (draft.status === "completed") return "done";
  if (isOpenStatus(draft.status) && !draft.closed) return "open";
  return "failed";
}

// 3편 진행 한 줄과 편마다 상태. drafts: 편 순서(빈 자리는 null).
// 돌려주는 값: { line, parts: [{ n, state, text }], allSettled, firstDone }.
/**
 * @param {Array<{ status: string, closed?: string | null } | null>} drafts
 * @returns {{ line: string, parts: { n: number, state: "done" | "open" | "failed", text: string }[], allSettled: boolean, firstDone: number | null }}
 */
export function setProgressView(drafts) {
  const parts = drafts.map((draft, index) => {
    const state = partState(draft);
    return { n: index + 1, state, text: `${index + 1}편 ${SET_STATUS[state]}` };
  });
  const count = (state) => parts.filter((part) => part.state === state).length;
  const pieces = [];
  if (count("done")) pieces.push(`${count("done")}편 다 됨`);
  if (count("open")) pieces.push(`${count("open")}편 만드는 중`);
  if (count("failed")) pieces.push(`${count("failed")}편 못 만듦`);
  const firstDone = parts.find((part) => part.state === "done")?.n ?? null;
  return { line: `${drafts.length}편 중 ${pieces.join(" · ")}`, parts, allSettled: count("open") === 0, firstDone };
}

// 묶음 가운데 열린 편(취소 대상). 닫힌 편·끝난 편은 건드리지 않는다.
/** @type {(drafts: Array<{ id: string, status: string, closed?: string | null } | null>) => string[]} */
export const openSetIds = (drafts) => drafts.filter((draft) => draft && !draft.closed && isOpenStatus(draft.status)).map((draft) => draft.id);
