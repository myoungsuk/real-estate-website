// 휴대폰 캘린더 구독 칸(단계 3 C-b, '계약 일정' 화면 맨 아래, 사용자 결정 2026-11-23 08:55:04 "가안: 맨 아래 칸 하나 (Recommended)")의 순수 함수.
// 서버 요청·브라우저 저장·주소 변경을 하지 않는다. 구독 주소(토큰이 든 주소)는 화면 메모리에만 두고 어디에도 남기지 않는다.
import { customerErrorText } from "./customers-view.mjs";
import { photoDayText } from "./photo-view.mjs";

/** iPhone 캘린더에 넣기: https:// 주소를 webcal:// 주소로(iPhone은 이 주소를 누르면 '구독' 확인 창을 띄움). @param {string} url */
export function webcalUrl(url) {
  return String(url).replace(/^https?:\/\//u, "webcal://");
}

/**
 * Google 캘린더에 넣기: 브라우저에서 Google 캘린더 사이트의 '주소로 추가'를 여는 주소.
 * **추정**: Android Google 캘린더 앱은 주소로 구독을 더하지 못해 사이트에서 더해야 한다(실기기 확인 T3-11 전).
 * @param {string} url
 */
export function googleCalendarUrl(url) {
  return `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl(url))}`;
}

/**
 * 살아 있는 주소 목록에서 보일 주소 하나(사무소 주소는 늘 1개, 혹시 여럿이면 가장 새것).
 * @template {{ createdAt: string }} T
 * @param {T[] | null | undefined} feeds
 * @returns {T | null}
 */
export function currentFeed(feeds) {
  if (!Array.isArray(feeds) || feeds.length === 0) return null;
  return [...feeds].sort((left, right) => (left.createdAt < right.createdAt ? 1 : left.createdAt > right.createdAt ? -1 : 0))[0];
}

/** '만든 날' 줄 @param {string} iso */
export const feedCreatedText = (iso) => photoDayText(iso);

/** '마지막으로 받아 감' 줄(하루 1번만 적으므로 날짜까지만) @param {string | null} iso */
export function feedUsedText(iso) {
  return iso ? photoDayText(iso) : "아직 받아 가지 않음";
}

/** 오류 문장. 해시 키(WORK_FEED_TOKEN_PEPPER)가 없으면 503 WORK_CONFIG_MISSING이다. @param {string | null} code */
export function feedErrorText(code) {
  if (code === "WORK_CONFIG_MISSING") return "구독 주소 설정이 아직 끝나지 않았습니다. 개발 담당에게 '구독 주소 설정 누락'이라고 알려 주세요.";
  if (code === "NOT_FOUND") return "이미 취소된 주소입니다. 칸을 다시 불러왔습니다.";
  return customerErrorText(code ?? "");
}
