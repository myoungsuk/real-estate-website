// 관리자 '인스타그램' 카테고리에서 콘텐츠 ID 칸을 비워 두면 저장 전에 채울 ID를 만든다.
// instagram-<게시일 YYYY-MM-DD>이고, 같은 ID가 이미 있으면 -2, -3…을 붙인다. 게시일이 없거나 형식이 다르면 null(날짜를 지어내지 않음).
// RSS 자동 동기화의 ID(naver-blog-…, youtube-…)와 머리말이 달라 서로 겹치지 않는다.
export function suggestInstagramContentId(publishedAt, existingIds) {
  if (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(publishedAt)) return null;
  const taken = new Set(existingIds);
  const base = `instagram-${publishedAt}`;
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
