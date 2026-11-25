// 네이버 블로그 글 카드에 싣는 '글 앞부분 요약(excerpt)'과 '분류(category)'의 규칙을 한 곳에 둔다.
// 2026-11-25 사용자 승인: 카드에 글 앞부분 요약과 분류 딱지를 보임 / 매물 소개 글은 요약을 뺌 / 인사말로 시작하면 인사 문장을 건너뜀.
// 까닭: 요약 안에 가격·동 번호가 든 글은 거래가 끝난 뒤에도 홈페이지에 남고, 인사로 시작하는 글은 요약 절반이 인사다.
// 같은 날 요약 표 50건을 읽고 보강: 제목으로 매물 소개 글을 가려 빼고, 맨 앞이 아닌 인사·제목 되풀이·'목차' 뒤는 요약에서 뺀다.
// 이 파일은 다른 파일을 가져오지 않는 순수 함수만 둔다. 민감 문자열 검사는 부르는 쪽이 넘긴다(findSensitive).

export const BLOG_EXCERPT_MAX_LENGTH = 300;
export const BLOG_EXCERPT_MIN_LENGTH = 30;
export const BLOG_CATEGORY_MAX_LENGTH = 30;
// '목차' 앞에서 끊었을 때 남아야 하는 글자 수. 이보다 짧으면 끊지 않는다.
export const BLOG_CONTENTS_MIN_KEPT_LENGTH = 60;
// 글 앞의 제목 되풀이를 떼어 낼 때 제목이 이보다 짧으면 우연히 같은 낱말일 수 있어 그대로 둔다.
export const BLOG_REPEATED_TITLE_MIN_LENGTH = 5;

// 이 분류의 글은 매물 소개 글이라 요약을 싣지 않는다(분류 딱지는 싣는다).
export const BLOG_LISTING_CATEGORIES = Object.freeze(["추천매물"]);

// 요약을 싣지 않은 까닭. 시험·보고·동기화 기록에 쓴다.
export const BLOG_EXCERPT_SKIP_LABELS = Object.freeze({
  "listing-category": "분류가 추천매물",
  "deal-closed": "제목에 거래완료",
  "listing-title": "제목이 매물 소개",
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

// 인사는 문장이 시작하는 자리(글 맨 앞, 또는 . ! ? ~ 뒤)에서만 찾는다. 따옴표 바로 뒤나 문장 가운데의 "안녕하세요"는 인사 문장으로 보지 않는다.
const GREETING_HEAD_PATTERN = /(?<=^|[.!?~]\s*)안녕하(?:세요|십니까)(?:\s*(?:여러분|이웃님들?|고객님들?))?[\s,.!~^?ㅎㅋ♡♥:;)]*/gu;
// 인사 바로 뒤의 자기소개 한 문장("…행복한부동산입니다.")도 인사로 본다. 문장 부호를 넘어가지 않는다.
const SELF_INTRO_PATTERN = /^[^.!?]{0,80}?(?:부동산|공인중개사\s*사무소|공인중개사|중개사무소)(?:\s*대표\s*[가-힣]{2,4})?\s*입니다[\s.!~^ㅎㅋ♡♥:;)]*/u;

// 금액 표현: 숫자 + 억·천만·백만·만원, 쉼표로 끊은 백만 원 이상,
// '원' 없이 쓴 세 자리 이상 숫자 + 만(5,000만·5000만), 숫자/숫자 줄임 꼴(1000/50).
// 뒤 둘은 2026-11-25 사용자 답으로 더했다("100만 인구"·"2026/11"처럼 금액이 아닌 글도 걸려 요약이 빠진다).
const PRICE_PATTERN = /\d[\d,.]*\s*(?:억|천\s*만|백\s*만|만\s*원)|\d{1,3}(?:,\d{3}){2,}\s*원|(?:\d{3,}|\d{1,3}(?:,\d{3})+)\s*만|\d\s*\/\s*\d/u;
// 동 번호: 숫자 3 ~ 4자리 + 동. '천동' 같은 지명에는 숫자가 없어 걸리지 않고, 숫자 뒤 '동구·동네·동안·동쪽·동향·동참'은 뺀다.
const BUILDING_NUMBER_PATTERN = /(?<![\d,.])\d{3,4}\s*동(?![구네안쪽향참])/u;
const DEAL_CLOSED_PATTERN = /거래\s*완료/u;
// 제목으로 가리는 매물 소개 글: '급매'·'매물' 낱말, 또는 면적·타입 표기(59A·59B타입·74타입·84㎡)와 거래 종류가 함께 있는 제목.
// 숫자 2 ~ 3자리 바로 뒤의 ㎡·'타입'·영문 한 글자만 타입 표기로 본다('24평'·'401동'·'2026년'·'4bl'은 아니다).
const LISTING_TITLE_WORD_PATTERN = /급매|매물/u;
const TITLE_UNIT_TYPE_PATTERN = /(?<![\d.,])\d{2,3}(?:\s*(?:㎡|타입)|[A-Za-z](?![A-Za-z]))/u;
const TITLE_TRADE_PATTERN = /매매|전세|월세/u;
// 낱말 '목차'(앞뒤에 다른 글자가 붙지 않은 것). 문장이 끝난 뒤에 오거나 바로 뒤에 번호·줄표 목록이 이어질 때만 목차로 본다.
const CONTENTS_WORD_PATTERN = /(?<![가-힣A-Za-z0-9])목차(?![가-힣A-Za-z0-9])/gu;
const CONTENTS_AFTER_SENTENCE_PATTERN = /(?:^|[.!?~…)\]])\s*$/u;
const CONTENTS_BEFORE_LIST_PATTERN = /^\s*[:：]?\s*(?:\d{1,2}\s*[.)]|[-–•·▶▷■□◆◇①②③④⑤⑥⑦⑧⑨⑩])/u;

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

// 그 자리 앞에서 열린 따옴표가 아직 닫히지 않았는지 본다(인용문 안의 인사를 지우지 않기 위해).
function insideQuote(text, index) {
  const before = text.slice(0, index);
  const count = (pattern) => (before.match(pattern) ?? []).length;
  return count(/"/gu) % 2 === 1 || count(/“/gu) > count(/”/gu) || count(/‘/gu) > count(/’/gu) || count(/「/gu) > count(/」/gu);
}

// 인사 문장을 건너뛴다(맨 앞이 아니어도 문장 시작이면, 첫 번째 한 곳만). 바로 뒤 자기소개 문장도 함께 빼고 앞뒤 글을 잇는다.
// 돌려주는 skipped는 건너뛴 문장(없으면 null)이다.
export function skipBlogGreeting(text) {
  for (const head of text.matchAll(GREETING_HEAD_PATTERN)) {
    if (insideQuote(text, head.index)) continue;
    let end = head.index + head[0].length;
    const intro = text.slice(end).match(SELF_INTRO_PATTERN);
    if (intro) end += intro[0].length;
    const before = text.slice(0, head.index).trimEnd();
    const after = text.slice(end).trimStart();
    return { text: before && after ? `${before} ${after}` : `${before}${after}`, skipped: text.slice(head.index, end).trim() };
  }
  return { text, skipped: null };
}

// 글이 제목 글자 그대로 시작하면 그 제목을 뗀다. 공백을 정리한 제목과 정확히 같고 바로 뒤가 띄어쓰기(또는 글 끝)일 때만이다.
export function dropRepeatedBlogTitle(text, title) {
  const head = blogPlainText(typeof title === "string" ? title : "");
  if (head.length < BLOG_REPEATED_TITLE_MIN_LENGTH || !text.startsWith(head)) return text;
  const next = text[head.length];
  if (next !== undefined && next.trim() !== "") return text;
  return text.slice(head.length).trimStart();
}

// 글 가운데 '목차'와 그 뒤 목록이 이어지면 '목차' 앞에서 끊는다. 끊고 남는 글이 min자 미만이면 끊지 않는다.
export function cutBlogBeforeContents(text, { min = BLOG_CONTENTS_MIN_KEPT_LENGTH } = {}) {
  for (const word of text.matchAll(CONTENTS_WORD_PATTERN)) {
    const before = text.slice(0, word.index);
    const after = text.slice(word.index + word[0].length);
    if (!CONTENTS_AFTER_SENTENCE_PATTERN.test(before) && !CONTENTS_BEFORE_LIST_PATTERN.test(after)) continue;
    const kept = before.trimEnd();
    return kept.length < min ? { text, cut: false } : { text: kept, cut: true };
  }
  return { text, cut: false };
}

// max자를 넘으면(또는 원문이 이미 잘려 있으면) 낱말 경계에서 자르고 "…"를 붙인다. 결과는 max자를 넘지 않는다.
// cleanCut은 낱말이 끝난 자리에서 이미 끊은 글('목차' 앞)이라는 뜻이다. 마지막 낱말을 버리지 않고 "…"만 붙인다.
export function cutBlogExcerpt(text, { max = BLOG_EXCERPT_MAX_LENGTH, sourceCut = false, cleanCut = false } = {}) {
  if (text.length <= max && !sourceCut && !cleanCut) return text;
  const fits = text.length <= max - 1;
  let head = fits ? text : text.slice(0, max - 1);
  // 이모지 같은 두 칸 글자의 앞 칸만 남지 않게 한다.
  if (/[\ud800-\udbff]$/u.test(head)) head = head.slice(0, -1);
  const midWord = fits ? sourceCut && !cleanCut : !/\s/u.test(text[max - 1] ?? " ");
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

// 제목만 보고 매물 소개 글인지 가린다.
export function isBlogListingTitle(title) {
  if (typeof title !== "string") return false;
  return LISTING_TITLE_WORD_PATTERN.test(title) || (TITLE_UNIT_TYPE_PATTERN.test(title) && TITLE_TRADE_PATTERN.test(title));
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
  if (isBlogListingTitle(title)) return skip("listing-title");

  const plain = blogPlainText(description);
  const sourceCut = SOURCE_CUT_MARK_PATTERN.test(plain);
  const whole = plain.replace(SOURCE_CUT_MARK_PATTERN, "");
  // 제목 되풀이 → 인사 → '목차' 뒤 차례로 덜어 낸다. 민감 문자열 검사는 덜어 내기 전 원문 조각 전체(whole)도 본다.
  const { text: greeted, skipped } = skipBlogGreeting(dropRepeatedBlogTitle(whole, title));
  const contents = cutBlogBeforeContents(greeted);
  const body = contents.text;
  if (body.length < BLOG_EXCERPT_MIN_LENGTH) return skip("too-short", skipped);
  if (findSensitive(whole).length > 0) return skip("sensitive", skipped);

  const excerpt = cutBlogExcerpt(body, contents.cut ? { cleanCut: true } : { sourceCut });
  if (findSensitive(excerpt).length > 0) return skip("sensitive", skipped);
  if (hasPriceExpression(excerpt)) return skip("price", skipped);
  if (hasBuildingNumber(excerpt)) return skip("building-number", skipped);
  if (excerpt.length < BLOG_EXCERPT_MIN_LENGTH || getBlogExcerptErrors(excerpt).length > 0) return skip("invalid", skipped);
  return { excerpt, reason: null, skippedGreeting: skipped };
}
