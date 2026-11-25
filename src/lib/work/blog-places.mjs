// 글 초안: 올릴 곳(블로그·인스타그램·스레드·카카오톡)마다 복사할 글을 조립하고, 글자 수를 세고, 한도를 넘는지 본다(순수 함수).
// AI 글은 고치지 않는다. 해시태그·구분선·명시사항은 지금과 같이 blog-view.mjs의 조립 함수가 붙인다(명시사항은 ad-disclosure.mjs가 만든 글).
import { blogCopyText, snsCopyText } from "./blog-view.mjs";

// 화면 '어디에 올릴까요?' 순서. 처음 골라진 곳은 블로그다.
export const BLOG_PLACES = Object.freeze([
  Object.freeze({ id: "blog", label: "블로그" }),
  Object.freeze({ id: "instagram", label: "인스타그램" }),
  Object.freeze({ id: "threads", label: "스레드" }),
  Object.freeze({ id: "kakao", label: "카카오톡" }),
]);

// 글자 수 상한(2026-11-25 다시 확인). realprice-promo.mjs PROMO_LIMITS와 같은 값이어야 한다(tests/work-blog-places.test.mjs가 대조).
// - 스레드 500자: Meta Threads API 문서 'Threads posts'(2026-10-30 갱신) "Text posts are limited to 500 characters." "Emojis are counted as the number of UTF-8 bytes."(2026-11-25 다시 읽음).
// - 인스타그램 2,200자: Meta 'IG User Media'(2026-09-28 갱신) caption "Maximum 2200 characters, 30 hashtags, and 20 @ tags."
// - 인스타그램 해시태그 5개: 앱에서 올릴 때의 값. 2025-12 Instagram이 "게시물·릴스 캡션의 해시태그를 5개로 차츰 바꾼다"고 알렸다는 보도
//   (Social Media Today 2025-12-18)가 근거이고, Meta 공식 문서에서는 확인하지 못했다(API 문서는 30개). 그래서 넘어도 막지 않고 알리기만 한다.
// - 블로그·카카오톡은 이 글 길이에서 걸리는 상한이 없다(카카오톡 말풍선 길이는 공식 문서에서 확인하지 못해 막지 않는다).
// 글자 수는 코드 포인트로 센다(한글 한 글자·줄바꿈 하나 = 1자). 스레드만 Meta 문서대로 이모지를 UTF-8 바이트 수로 센다(4바이트 이모지 하나 = 4자).
// 문서에 '이모지'의 범위는 없어 넉넉하게 잡는다(그림 문자 + 피부색·국기 글자·이어 붙이는 글자 같은 이모지 부품). 스레드 앱이 덜 셀 수는 있어도
// 우리가 덜 세어 앱에서 넘치는 일은 없게 하려는 것이다(추정). 인스타그램은 이모지를 세는 방식이 문서에 없어 코드 포인트 그대로 센다.
export const BLOG_PLACE_LIMITS = Object.freeze({ blog: null, instagram: 2200, threads: 500, kakao: null });
export const INSTAGRAM_HASHTAG_NOTE_FROM = 5;

const PLACE_IDS = BLOG_PLACES.map((place) => place.id);
const labelOf = (place) => BLOG_PLACES.find((item) => item.id === place).label;
const EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Component}]/u; // Emoji_Component의 숫자·#·*는 1바이트라 그대로 1자다.
const utf8Bytes = (char) => { const code = char.codePointAt(0); return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; };
const byBytes = (place, char) => place === "threads" && EMOJI.test(char) && utf8Bytes(char) > 1;
const length = (text, place) => { let sum = 0; for (const char of String(text ?? "")) sum += byBytes(place, char) ? utf8Bytes(char) : 1; return sum; };
const emojiCount = (text, place) => { let sum = 0; for (const char of String(text ?? "")) if (byBytes(place, char)) sum += 1; return sum; };
const number = (value) => value.toLocaleString("ko-KR");
const tagList = (hashtags) => (hashtags ?? []).map((tag) => String(tag ?? "").trim()).filter(Boolean);
const assertPlace = (place) => {
  if (!PLACE_IDS.includes(place)) throw new RangeError(`모르는 올릴 곳: ${place}`);
};
// 스레드는 글 하나에 주제 태그가 하나뿐이라(Meta 문서 "Only one topic tag is allowed per post") 해시태그 줄을 붙이지 않는다(실거래 홍보물과 같음).
// 카카오톡은 1:1 채팅에 붙여 넣는 글이라 해시태그를 붙이지 않는다(실거래 홍보물의 카카오톡 글과 같음).
const tagsFor = (place, hashtags) => (place === "instagram" || place === "blog" ? tagList(hashtags) : []);
// 카카오톡 글의 앞부분: [제목] 한 줄 + 인스타그램 글. AI에 따로 받지 않고 코드가 만든다.
const kakaoBody = (input) => {
  const title = String(input.title ?? "").trim();
  const text = String(input.text ?? "").trim();
  return [...(title ? [`[${title}]`] : []), ...(text ? [text] : [])].join("\n");
};
// 내 글 뒤에 자동으로 붙는 꼬리. 인스타그램·스레드: (해시태그 줄) → 구분선 + 명시사항. 카카오톡: 명시사항만(구분선 없음).
const tailOf = (place, input) => (place === "kakao"
  ? String(input.disclosureText ?? "")
  : snsCopyText({ snsShort: "", hashtags: tagsFor(place, input.hashtags), disclosureText: input.disclosureText }));

// 복사할 글. input: 블로그는 blogCopyText와 같은 값({ title, paragraphs, headings, checklist, hashtags, disclosureText }),
// 인스타그램·스레드는 { text, hashtags, disclosureText }, 카카오톡은 { title, text, disclosureText }(text는 인스타그램 글).
export function placeCopyText(place, input) {
  assertPlace(place);
  if (place === "blog") return blogCopyText({ ...input, hashtags: tagList(input.hashtags) });
  if (place === "kakao") {
    const body = kakaoBody(input);
    return [...(body ? [body] : []), tailOf(place, input)].join("\n\n");
  }
  return snsCopyText({ snsShort: input.text, hashtags: tagsFor(place, input.hashtags), disclosureText: input.disclosureText });
}

// 글자 수. total = own + attached가 늘 맞는다.
// - own: 내가 고칠 수 있는 글(AI 글). attached: 자동으로 붙는 글(해시태그 줄·빈 줄·구분선·명시사항).
// - room: 내 글이 쓸 수 있는 자리(limit - attached, 상한이 없으면 null). left: 지금 남은 자리(limit - total).
// - tags: 복사 글 안의 해시태그 수(내 글에 직접 쓴 것도 셈). emoji: 바이트 수로 센 이모지 글자 수(스레드만, 그 밖은 0).
export function placeCount(place, input) {
  assertPlace(place);
  const copy = placeCopyText(place, input);
  const total = length(copy, place);
  const tail = length(tailOf(place, input), place);
  const attached = total > tail ? tail + 2 : tail; // 내 글이 있으면 꼬리 앞에 빈 줄 하나(줄바꿈 2자)
  const limit = BLOG_PLACE_LIMITS[place];
  const tags = (copy.match(/#[^\s#]+/gu) ?? []).length;
  return { place, total, own: total - attached, attached, limit, room: limit === null ? null : limit - (tail + 2), left: limit === null ? null : limit - total, tags, emoji: emojiCount(copy, place) };
}

// 화면에 보이는 글자 수 줄. 더한 값이 그대로 맞게 '내 글 + 자동으로 붙는 글' 둘로만 나눈다. 인스타그램은 해시태그 수를 덧붙인다.
export function placeMeterText(count) {
  if (count.limit === null) return `복사할 글 ${number(count.total)}자`;
  const tags = count.place === "instagram" ? ` · 해시태그 ${count.tags}개` : "";
  return `${number(count.limit)}자 중 ${number(count.total)}자 · 내 글 ${number(count.own)}자 + 자동으로 붙는 글 ${number(count.attached)}자${tags}`;
}

// 글 칸 아래 한 줄. 상한이 있는 곳은 남은 자리(넘었으면 넘은 글자 수)를 함께 알린다.
export function placeFieldNote(count) {
  if (count.limit === null) return `${number(count.own)}자`;
  const emoji = count.emoji > 0 ? " · 이모지는 스레드가 세는 대로 한 개를 여러 자로 셉니다" : "";
  if (count.left < 0) return `${number(count.own)}자 · ${number(-count.left)}자 넘음${emoji}`;
  return `${number(count.own)}자 · 남은 자리 ${number(count.left)}자(${labelOf(count.place)} ${number(count.limit)}자에서 자동으로 붙는 글 ${number(count.attached)}자를 뺀 자리)${emoji}`;
}

// 한도 판정. reasons: 복사를 막는 까닭(있으면 ok false). notes: 막지 않고 알리기만 하는 것.
export function placeVerdict(place, input) {
  const count = placeCount(place, input);
  const label = labelOf(place);
  const reasons = [];
  const notes = [];
  if (count.limit !== null && count.room <= 0) {
    reasons.push(`자동으로 붙는 글(명시사항)만 ${number(count.attached)}자라 ${label} ${number(count.limit)}자에 넣을 수 없습니다.`);
  } else if (count.limit !== null && count.total > count.limit) {
    reasons.push(`${label} 글은 ${number(count.limit)}자까지인데 지금 ${number(count.total)}자입니다. 내 글을 ${number(count.total - count.limit)}자 줄이세요(자동으로 붙는 글 ${number(count.attached)}자는 줄일 수 없습니다).`);
  }
  if (place === "instagram" && count.tags > INSTAGRAM_HASHTAG_NOTE_FROM) {
    notes.push(`해시태그가 ${count.tags}개입니다. 인스타그램 앱이 ${INSTAGRAM_HASHTAG_NOTE_FROM}개까지만 받을 수 있으니, 올릴 때 막히면 ${INSTAGRAM_HASHTAG_NOTE_FROM}개만 남기세요.`);
  }
  return { ok: reasons.length === 0, reasons, notes, count };
}

// 글 검사(blog-checks.mjs checkBlogDraft)의 자리(where)가 그 올릴 곳의 복사 글에 들어가는지.
// 블로그: 제목·소제목·문단·확인할 점·해시태그. 인스타그램: 인스타그램 글·해시태그. 스레드: 스레드 글. 카카오톡: 제목·인스타그램 글.
// 그곳에 들어가지 않는 칸의 문제는 그곳 복사를 막지 않는다.
export function placeHasWhere(place, where) {
  assertPlace(place);
  if (place === "instagram") return where === "instagram" || where === "tags";
  if (place === "threads") return where === "threads";
  if (place === "kakao") return where === "title" || where === "instagram";
  return where !== "instagram" && where !== "threads";
}

// 그 올릴 곳에서 보이는 고치는 칸(화면 칸 이름).
export const BLOG_PLACE_FIELDS = Object.freeze({
  blog: Object.freeze(["title", "body", "tags"]),
  instagram: Object.freeze(["instagram", "tags"]),
  threads: Object.freeze(["threads"]),
  kakao: Object.freeze(["title", "instagram"]),
});

// 순서 글(① 그림 저장 ② 글 복사 ③ 그곳에서 붙여 넣기). cardCount가 0이면 그림 줄이 없다(image null).
/** @param {string} place @param {{ cardCount?: number }} [options] */
export function placeSteps(place, { cardCount = 0 } = {}) {
  assertPlace(place);
  const label = labelOf(place);
  const cards = cardCount > 1 ? `카드 그림 ${cardCount}장` : "카드 그림";
  const has = cardCount > 0;
  const image = !has ? null
    : place === "blog" ? `${cards}을 저장합니다(블로그 글에 사진으로 넣습니다).`
      : place === "kakao" ? `${cards}을 저장합니다(채팅에 사진으로 보냅니다).` : `${cards}을 휴대폰에 저장합니다.`;
  const posts = {
    blog: has ? "블로그 글쓰기에서 첫 줄을 제목 칸에 넣고 → 저장한 그림 넣기 → 나머지 글 붙여 넣기." : "블로그 글쓰기에서 첫 줄을 제목 칸에 넣고 → 나머지 글 붙여 넣기.",
    instagram: has ? "인스타그램 앱에서 새 게시물 → 저장한 그림 고르기 → 글 붙여 넣기." : "인스타그램 앱에서 새 게시물 → 올릴 사진 고르기 → 글 붙여 넣기.",
    threads: has ? "스레드 앱에서 새 스레드 → 글 붙여 넣기 → 저장한 그림 붙이기." : "스레드 앱에서 새 스레드 → 글 붙여 넣기.",
    kakao: has ? "카카오톡 채팅에서 저장한 그림을 사진으로 보내고 → 글 붙여 넣기." : "카카오톡 채팅에 글 붙여 넣기.",
  };
  return {
    image,
    copy: "글을 복사합니다(명시사항까지 함께).",
    post: posts[place],
    copyLabel: `${label} 글 복사`,
    copied: `✓ ${label} 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.`,
  };
}
