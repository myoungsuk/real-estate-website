// 네이버 블로그 글 카드에 싣는 '글 앞부분 요약(excerpt)'과 '분류(category)'의 규칙을 한 곳에 둔다.
// 2026-11-25 사용자 승인: 카드에 글 앞부분 요약과 분류 딱지를 보임 / 매물 소개 글은 요약을 뺌 / 인사말로 시작하면 인사 문장을 건너뜀.
// 까닭: 요약 안에 가격·동 번호가 든 글은 거래가 끝난 뒤에도 홈페이지에 남고, 인사로 시작하는 글은 요약 절반이 인사다.
// 이 파일은 다른 파일을 가져오지 않는 순수 함수만 둔다. 민감 문자열 검사는 부르는 쪽이 넘긴다(findSensitive).

export const BLOG_EXCERPT_MAX_LENGTH = 300;
export const BLOG_EXCERPT_MIN_LENGTH = 30;
export const BLOG_CATEGORY_MAX_LENGTH = 30;

// 이 분류의 글은 매물 소개 글이라 요약을 싣지 않는다(분류 딱지는 싣는다).
export const BLOG_LISTING_CATEGORIES = Object.freeze(["추천매물"]);

// 요약을 싣지 않은 까닭. 시험·보고·동기화 기록에 쓴다.
export const BLOG_EXCERPT_SKIP_LABELS = Object.freeze({
  "listing-category": "분류가 추천매물",
  "deal-closed": "제목에 거래완료",
  "too-short": "글 앞부분이 없거나 너무 짧음",
  sensitive: "민감 문자열 검사에 걸림",
  price: "요약에 금액 표현",
  "building-number": "요약에 동 번호",
  invalid: "요약 형식 검사에 걸림",
});

const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  bull: "•",
  larr: "←",
  rarr: "→",
  times: "×",
  deg: "°",
  tilde: "~",
  laquo: "«",
  raquo: "»",
});
const ENTITY_PATTERN = /&(#[xX][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/gu;
const ENTITY_TEST_PATTERN = /&(?:#[xX][0-9A-Fa-f]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/u;
const HTML_BLOCK_PATTERN = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const HTML_TAG_PATTERN = /<(?:\/?[A-Za-z][^>]*|![^>]*)>/gu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/u;
const MAX_DECODE_ROUNDS = 6;

// 네이버 RSS는 글을 350자쯤에서 자르고 끝에 점 여러 개를 붙인다. 그 표시가 있으면 마지막 낱말이 잘렸을 수 있다.
const SOURCE_CUT_MARK_PATTERN = /\s*(?:\.{3,}|…+)\s*$/u;

const GREETING_HEAD_PATTERN = /^안녕하(?:세요|십니까)(?:\s*(?:여러분|이웃님들?|고객님들?))?[\s,.!~^?ㅎㅋ♡♥:;)]*/u;
// 인사 바로 뒤의 자기소개 한 문장("…행복한부동산입니다.")도 인사로 본다. 문장 부호를 넘어가지 않는다.
const SELF_INTRO_PATTERN = /^[^.!?]{0,80}?(?:부동산|공인중개사\s*사무소|공인중개사|중개사무소)(?:\s*대표\s*[가-힣]{2,4})?\s*입니다[\s.!~^ㅎㅋ♡♥:;)]*/u;

// 금액 표현: 숫자 + 억·천만·백만·만원, 쉼표로 끊은 백만 원 이상.
const PRICE_PATTERN = /\d[\d,.]*\s*(?:억|천\s*만|백\s*만|만\s*원)|\d{1,3}(?:,\d{3}){2,}\s*원/u;
// 동 번호: 숫자 3 ~ 4자리 + 동. '천동' 같은 지명에는 숫자가 없어 걸리지 않고, 숫자 뒤 '동구·동네·동안·동쪽·동향·동참'은 뺀다.
const BUILDING_NUMBER_PATTERN = /(?<![\d,.])\d{3,4}\s*동(?![구네안쪽향참])/u;
const DEAL_CLOSED_PATTERN = /거래\s*완료/u;

function decodeEntitiesOnce(text) {
  return text.replace(ENTITY_PATTERN, (whole, body) => {
    if (body[0] === "#") {
      const code = /^#[xX]/u.test(body) ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0x20 || code === 0x7f || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return " ";
      return String.fromCodePoint(code);
    }
    // 모르는 이름은 글자로 남기지 않는다.
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : " ";
  });
}

// RSS description(HTML)을 한 줄 글자로 바꾼다: 태그 제거 → 엔티티 풀기(두 번 싸인 &amp;quot;도 끝까지) → 공백 정리.
export function blogPlainText(html) {
  if (typeof html !== "string") return "";
  let text = html.replace(HTML_BLOCK_PATTERN, " ");
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    const next = decodeEntitiesOnce(text.replace(HTML_TAG_PATTERN, " "));
    if (next === text) break;
    text = next;
  }
  return text
    .replace(ENTITY_PATTERN, " ")
    .replace(/[<>]/gu, " ")
    .replace(/[\u200b-\u200d\u2060\ufeff]/gu, "")
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

// 맨 앞 인사 문장을 건너뛴다. 돌려주는 skipped는 건너뛴 문장(없으면 null)이다.
export function skipBlogGreeting(text) {
  const head = text.match(GREETING_HEAD_PATTERN);
  if (!head) return { text, skipped: null };
  let consumed = head[0].length;
  const intro = text.slice(consumed).match(SELF_INTRO_PATTERN);
  if (intro) consumed += intro[0].length;
  return { text: text.slice(consumed).trim(), skipped: text.slice(0, consumed).trim() };
}

// max자를 넘으면(또는 원문이 이미 잘려 있으면) 낱말 경계에서 자르고 "…"를 붙인다. 결과는 max자를 넘지 않는다.
export function cutBlogExcerpt(text, { max = BLOG_EXCERPT_MAX_LENGTH, sourceCut = false } = {}) {
  if (text.length <= max && !sourceCut) return text;
  const fits = text.length <= max - 1;
  let head = fits ? text : text.slice(0, max - 1);
  // 이모지 같은 두 칸 글자의 앞 칸만 남지 않게 한다.
  if (/[\ud800-\udbff]$/u.test(head)) head = head.slice(0, -1);
  const midWord = fits ? sourceCut : !/\s/u.test(text[max - 1] ?? " ");
  if (midWord) {
    const at = head.lastIndexOf(" ");
    if (at > head.length * 0.6) head = head.slice(0, at);
  }
  return `${head.replace(/[\s,.·…:;~\-–—]+$/u, "")}…`;
}

function textErrors(value, max) {
  if (typeof value !== "string") return ["문자열이어야 합니다."];
  const errors = [];
  if (value.length < 1 || value.length > max) errors.push(`1 ~ ${max}자여야 합니다.`);
  if (CONTROL_PATTERN.test(value)) errors.push("줄바꿈·제어 문자를 넣을 수 없습니다.");
  if (value !== value.trim()) errors.push("앞뒤 공백을 넣을 수 없습니다.");
  if (/[<>]/u.test(value)) errors.push("HTML 태그 글자(<, >)를 넣을 수 없습니다.");
  if (ENTITY_TEST_PATTERN.test(value)) errors.push("HTML 엔티티(&amp; 같은 꼴)를 넣을 수 없습니다.");
  return errors;
}

// 저장된 값의 형식 검사(콘텐츠 검사가 쓴다). 오류 문장 배열을 돌려준다.
export function getBlogExcerptErrors(value) {
  return textErrors(value, BLOG_EXCERPT_MAX_LENGTH);
}

export function getBlogCategoryErrors(value) {
  return textErrors(value, BLOG_CATEGORY_MAX_LENGTH);
}

// RSS 분류 이름을 한 줄로 정리한다. 비었거나 형식에 맞지 않으면 null(분류 없이 넣음).
export function normalizeBlogCategory(value) {
  const category = blogPlainText(value);
  return category && getBlogCategoryErrors(category).length === 0 ? category : null;
}

export function hasPriceExpression(text) {
  return PRICE_PATTERN.test(text);
}

export function hasBuildingNumber(text) {
  return BUILDING_NUMBER_PATTERN.test(text);
}

function skip(reason, skippedGreeting = null) {
  return { excerpt: null, reason, skippedGreeting };
}

// 글 한 편의 요약을 만든다. 싣지 않을 때는 excerpt가 null이고 reason에 까닭(BLOG_EXCERPT_SKIP_LABELS의 키)이 온다.
// findSensitive는 글자를 받아 걸린 문장 배열을 돌려주는 민감 문자열 검사이며 꼭 넘겨야 한다(자른 조각과 원문 조각 전체를 둘 다 본다).
export function buildBlogExcerpt({ title = "", category = null, description = "" } = {}, { findSensitive } = {}) {
  if (typeof findSensitive !== "function") throw new TypeError("buildBlogExcerpt: 민감 문자열 검사(findSensitive)가 필요합니다.");
  if (BLOG_LISTING_CATEGORIES.includes(typeof category === "string" ? category.trim() : "")) return skip("listing-category");
  if (DEAL_CLOSED_PATTERN.test(typeof title === "string" ? title : "")) return skip("deal-closed");

  const plain = blogPlainText(description);
  const sourceCut = SOURCE_CUT_MARK_PATTERN.test(plain);
  const whole = plain.replace(SOURCE_CUT_MARK_PATTERN, "");
  const { text: body, skipped } = skipBlogGreeting(whole);
  if (body.length < BLOG_EXCERPT_MIN_LENGTH) return skip("too-short", skipped);
  if (findSensitive(whole).length > 0) return skip("sensitive", skipped);

  const excerpt = cutBlogExcerpt(body, { sourceCut });
  if (findSensitive(excerpt).length > 0) return skip("sensitive", skipped);
  if (hasPriceExpression(excerpt)) return skip("price", skipped);
  if (hasBuildingNumber(excerpt)) return skip("building-number", skipped);
  if (excerpt.length < BLOG_EXCERPT_MIN_LENGTH || getBlogExcerptErrors(excerpt).length > 0) return skip("invalid", skipped);
  return { excerpt, reason: null, skippedGreeting: skipped };
}
