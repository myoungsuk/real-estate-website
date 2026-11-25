// 관리자 '블로그·유튜브·인스타그램' 화면의 블로그 전용 두 칸 — 글 앞부분 요약(excerpt)·분류(category) — 의 입력값을
// 저장할 꼴로 바꾸고 검사한다(2026-11-25 입력 칸이 생김. 그 전에는 저장돼 있던 값을 그대로 넘기기만 했다).
// 형식 규칙은 콘텐츠 검사와 같은 함수(blog-excerpt.mjs)를 쓴다. 화면 스크립트가 쓰고 시험이 직접 부른다.
import { getBlogCategoryErrors, getBlogExcerptErrors, hasBuildingNumber, hasPriceExpression } from "./blog-excerpt.mjs";

// 칸에 적은 글을 한 줄로: 줄바꿈·잇단 공백은 한 칸으로, 앞뒤 공백 정리(검사가 줄바꿈·앞뒤 공백을 받지 않는다).
export function tidyBlogExtraInput(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

// 저장할 칸. 블로그가 아니면 두 칸을 넘기지 않고(검사도 블로그에만 허용), 비운 칸은 키째 뺀다(빈 문자열을 저장하지 않음).
export function blogExtrasFromInput(type, input) {
  if (type !== "blog") return {};
  const excerpt = tidyBlogExtraInput(input?.excerpt);
  const category = tidyBlogExtraInput(input?.category);
  return { ...(excerpt ? { excerpt } : {}), ...(category ? { category } : {}) };
}

// 저장 전에 화면이 먼저 알릴 형식 오류(서버 사전 검증과 같은 규칙). 없으면 빈 배열.
export function getBlogExtraInputErrors(type, input) {
  const extras = blogExtrasFromInput(type, input);
  return [
    ...(extras.excerpt === undefined ? [] : getBlogExcerptErrors(extras.excerpt).map((error) => `글 앞부분 요약: ${error}`)),
    ...(extras.category === undefined ? [] : getBlogCategoryErrors(extras.category).map((error) => `분류: ${error}`)),
  ];
}

// 저장은 막지 않고 알리기만 하는 것(문장 배열). 자동으로 받는 요약은 금액·동 번호가 있으면 싣지 않으므로, 직접 적을 때는 한 번 더 보게 한다.
// 금액 규칙은 '2026/11'·'100만 인구'처럼 금액이 아닌 글도 잡으므로 '금액이 있다'고 단정하지 않는다.
// savedUrl은 고치는 중인 블로그 글의 저장된 원문 링크(새 글이면 빈 글자), url은 지금 칸의 값이다. 링크를 다른 글로 바꿨는데 요약·분류가 남아 있으면 알린다.
export function getBlogExtraNotices(input, { savedUrl = "" } = {}) {
  const excerpt = tidyBlogExtraInput(input?.excerpt);
  const category = tidyBlogExtraInput(input?.category);
  const url = String(input?.url ?? "").trim();
  return [
    ...(hasPriceExpression(excerpt) ? ["요약에 금액으로 보이는 숫자가 있습니다. 가격이라면 바뀔 수 있으니 그대로 실을지 확인해 주세요."] : []),
    ...(hasBuildingNumber(excerpt) ? ["요약에 동 번호가 있습니다. 공개 광고에 나온 동인지 확인해 주세요."] : []),
    ...(savedUrl && url && url !== savedUrl && (excerpt || category) ? ["원문 링크를 바꿨습니다. 요약·분류가 새 글의 것인지 확인해 주세요."] : []),
  ];
}
