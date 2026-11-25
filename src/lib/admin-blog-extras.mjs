// 관리자 '블로그·유튜브·인스타그램' 화면에는 글 앞부분 요약(excerpt)·네이버 분류(category)를 고치는 입력 칸이 없다.
// 화면이 아는 칸만 다시 조립해 저장하면 두 칸이 사라지므로, 같은 블로그 글을 고칠 때는 저장돼 있던 값을 그대로 넘긴다.
// 종류를 블로그가 아닌 것으로 바꾸거나 원문 링크를 다른 글로 바꾸면 옛 글의 요약·분류를 남기지 않는다(검사도 블로그에만 허용).
export function keepBlogExtras(existing, next) {
  if (!existing || existing.type !== "blog" || next?.type !== "blog" || existing.url !== next.url) return {};
  return {
    ...(existing.excerpt !== undefined ? { excerpt: existing.excerpt } : {}),
    ...(existing.category !== undefined ? { category: existing.category } : {}),
  };
}
