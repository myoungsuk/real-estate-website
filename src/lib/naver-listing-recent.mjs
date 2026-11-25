// 홈 첫 화면 "최근 등록 매물" 제목 아래 한 줄(DESIGN.md "유리창 상태")에 쓰는 순수 함수.
// 확인일 기준 최근 7일 안에 등록된 공개 매물 수를 세고, 그 줄에 들어갈 글 조각을 만든다.
//
// 기준 날짜는 빌드한 날이 아니라 매물 목록 확인일(naver-listings.json 루트 checkedAt)이다.
// - 이 사이트는 정적이라 빌드가 며칠 안 돌면 화면도 그대로 남는다. 빌드한 날을 기준으로 세면 그 사이 숫자가 거짓이 된다.
// - 확인일 기준이면 줄 전체가 "11월 25일에 확인했을 때, 그날까지 7일 동안 등록된 매물 n건"이라는 한 문장으로 읽혀
//   며칠 뒤에 봐도 사실이다. 그래서 "오늘"·"이번 주" 같은 상대 표현도 쓰지 않고 날짜를 쓴다.
// - 콘텐츠 검사가 registeredAt이 checkedAt보다 늦지 못하게 막으므로(scripts/content-validation.mjs) 확인일이 가장 늦은 날이다.
export const NAVER_LISTING_RECENT_DAYS = 7;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

// "2026-11-25" → 그날 0시(UTC)의 밀리초. 달력에 없는 날짜(2026-02-30)나 다른 꼴은 null.
function isoDateToUtcMs(value) {
  const match = typeof value === "string" ? value.match(ISO_DATE) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? ms : null;
}

// 확인일 당일을 넣어 days일(기본 7일: 확인일 6일 전 ~ 확인일)의 첫날. 확인일이 날짜 꼴이 아니면 null.
export function recentNaverListingStartDate(checkedAt, days = NAVER_LISTING_RECENT_DAYS) {
  const checkedMs = isoDateToUtcMs(checkedAt);
  if (checkedMs === null || !Number.isInteger(days) || days < 1) return null;
  return new Date(checkedMs - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}

// 확인일 기준 최근 days일 안에 등록된 매물 수. 등록일이 날짜 꼴이 아니거나 확인일보다 늦은 항목은 세지 않는다.
export function countRecentNaverListings(items, checkedAt, days = NAVER_LISTING_RECENT_DAYS) {
  const startDate = recentNaverListingStartDate(checkedAt, days);
  if (startDate === null || !Array.isArray(items)) return 0;
  return items.filter((item) => {
    const registeredAt = item?.registeredAt;
    return isoDateToUtcMs(registeredAt) !== null && registeredAt >= startDate && registeredAt <= checkedAt;
  }).length;
}

// 제목 아래 한 줄의 글 조각(화면에서는 " · "로 잇는다).
// 최근 등록이 0건이면 가운데 조각을 빼고 매물 수와 확인일만 남긴다(0건이라고 쓰지 않는다).
// 가운데 조각은 "등록"이라고만 쓴다. registeredAt은 광고 등록기간 시작일이라 기간이 끝나 다시 등록한 매물도 들어가므로
// '새로 나온 매물'이라는 뜻의 말은 쓰지 않는다(2026-11-25 사용자 결정).
export function naverListingBoardLineParts({ total, recentCount, checkedAt, days = NAVER_LISTING_RECENT_DAYS }) {
  const parts = [`네이버 공개 매물 ${total}건`];
  if (Number.isInteger(recentCount) && recentCount > 0) parts.push(`최근 ${days}일 등록 ${recentCount}건`);
  if (isoDateToUtcMs(checkedAt) !== null) parts.push(`${Number(checkedAt.slice(5, 7))}월 ${Number(checkedAt.slice(8, 10))}일 확인`);
  return parts;
}
