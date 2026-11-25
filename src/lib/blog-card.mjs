// 공개 화면의 네이버 블로그 카드가 보일 요약·분류·날짜를 고르는 규칙을 한 곳에 둔다.
// 2026-11-25 사용자 승인 "전부 추천대로": 카드에 글 앞부분 요약과 분류 딱지, 홈에 최신 글 1건 크게.
// 화면은 글을 지어내지 않는다. 저장된 값 가운데 무엇을 보일지만 고른다(요약을 만드는 규칙은 blog-excerpt.mjs).

// 자동 받기가 새 글에 넣는 틀 문장의 머리("…공식 블로그에서 “제목” 관련 내용을 확인해 보세요.").
// 만드는 곳은 scripts/sync/external-content.mjs이고, 둘이 어긋나면 tests/blog-card.test.mjs가 떨어진다.
export const BLOG_TEMPLATE_SUMMARY_HEAD = "리더스시티행복한부동산 공식 블로그에서 “";

const text = (value) => (typeof value === "string" ? value.trim() : "");

export function isTemplateBlogSummary(summary) {
  return text(summary).startsWith(BLOG_TEMPLATE_SUMMARY_HEAD);
}

// 카드 요약: 글 앞부분 요약(excerpt)이 있으면 그것, 없으면 예전에 적어 둔 summary.
// summary가 틀 문장뿐이면 요약 줄을 그리지 않는다(null). 블로그가 아닌 항목은 summary 그대로.
export function getBlogCardSummary(item) {
  if (item?.type !== "blog") return text(item?.summary) || null;
  const excerpt = text(item.excerpt);
  if (excerpt) return excerpt;
  const summary = text(item.summary);
  return summary && !isTemplateBlogSummary(summary) ? summary : null;
}

// 분류 딱지: 블로그 글에 분류가 저장돼 있을 때만.
export function getBlogCardCategory(item) {
  return item?.type === "blog" ? text(item.category) || null : null;
}

// 홈 줄 목록의 짧은 날짜: 기준 해(가장 새 글의 해)와 같으면 "11. 24.", 다르면 "2025. 3. 9.". 날짜 꼴이 아니면 null.
export function formatShortContentDate(value, baseYear) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text(value));
  if (!match) return null;
  const [, year, month, day] = match;
  const monthDay = `${Number(month)}. ${Number(day)}.`;
  return year === String(baseYear ?? "") ? monthDay : `${year}. ${monthDay}`;
}
