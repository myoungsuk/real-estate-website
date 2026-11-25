import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLOG_PLACES, BLOG_PLACE_FIELDS, BLOG_PLACE_LIMITS, INSTAGRAM_HASHTAG_NOTE_FROM, placeCopyText, placeCount, placeFieldNote, placeHasWhere, placeMeterText, placeSteps, placeVerdict } from "../src/lib/work/blog-places.mjs";
import { blogCopyText, snsCopyText } from "../src/lib/work/blog-view.mjs";
import { PROMO_LIMITS, PROMO_PLACES } from "../src/lib/work/realprice-promo.mjs";
import { buildDisclosure } from "../src/lib/work/ad-disclosure.mjs";
import { BLOG_RESULT_LIMITS, validateBlogInputs } from "../src/lib/work/blog-checks.mjs";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";

const length = (text) => [...text].length;
const disclosureText = "중개사무소 ZZTEST-7F3A"; // 17자
const RULE_PART = "\n\n──────────\n"; // 빈 줄 + 구분선 + 줄바꿈 = 13자

// 지어낸 매물 하나의 실제 명시사항 글(공동주택 13항목 + 사무소 5항목). 주소·이름은 가상 값.
const rules = JSON.parse(readFileSync(new URL("../src/data/work/ad-disclosure-rules.json", import.meta.url), "utf8"));
const office = JSON.parse(readFileSync(new URL("../src/data/office.json", import.meta.url), "utf8"));
function listingDisclosure() {
  const [source] = listBlogSources({
    rules,
    listings: [],
    naverListings: { items: [{ id: "9990000001", title: "가상숲1단지", propertyType: "아파트", tradeType: "sale", priceLabel: "4억 5,000", areaLabel: "112㎡ · 전용 84.97㎡", floorLabel: "10/25층", direction: "남향", summary: "가상 요약", registeredAt: "2026-11-10" }] },
    complexes: [],
  });
  const { inputs } = validateBlogInputs({
    kind: "아파트", violation: "none", floorMode: "number", floorNumber: 10, totalFloors: 25, moveIn: { type: "now" }, rooms: 3, bathrooms: 2, approvalDate: "2020-05-01",
    parking: { basis: "perHousehold", value: 1.2 }, managementFee: { type: "average", monthlyWon: 250_000, included: ["general"] }, direction: "남향", directionBasis: "거실",
  }, { officePhone: office.mobile });
  const built = buildDisclosure({ source, inputs: { ...inputs, location: "대전광역시 동구 가상동 1" }, office, rules });
  assert.deepEqual(built.missing, [], "가상 매물의 명시사항이 다 참");
  return built.text;
}

test("올릴 곳: 블로그·인스타그램·스레드·카카오톡 넷이고, 글자 수 상한은 실거래 홍보물과 같다", () => {
  assert.deepEqual(BLOG_PLACES.map((place) => [place.id, place.label]), [["blog", "블로그"], ["instagram", "인스타그램"], ["threads", "스레드"], ["kakao", "카카오톡"]]);
  assert.deepEqual(BLOG_PLACES.map((place) => place.label).sort(), PROMO_PLACES.map(([, label]) => label).sort(), "실거래 홍보물과 같은 네 곳·같은 이름");
  assert.deepEqual(Object.keys(BLOG_PLACE_FIELDS), BLOG_PLACES.map((place) => place.id));
  assert.equal(BLOG_PLACE_LIMITS.kakao, null);
  assert.equal(BLOG_PLACE_LIMITS.threads, PROMO_LIMITS.threads);
  assert.equal(BLOG_PLACE_LIMITS.instagram, PROMO_LIMITS.instagram);
  assert.equal(BLOG_PLACE_LIMITS.blog, null);
  assert.equal(BLOG_PLACE_LIMITS.threads, 500);
  assert.equal(BLOG_PLACE_LIMITS.instagram, 2200);
  assert.equal(INSTAGRAM_HASHTAG_NOTE_FROM, 5);
  assert.throws(() => placeCopyText("band", { text: "글", disclosureText }), RangeError);
  assert.throws(() => placeHasWhere("band", "title"), RangeError);
  assert.throws(() => placeSteps("band"), RangeError);
  assert.throws(() => placeCount("", { text: "글", disclosureText }), RangeError);
});

test("복사 글: 인스타그램은 글 → 해시태그 → 명시사항, 스레드는 해시태그 없이 글 → 명시사항", () => {
  const input = { text: " 남향 10층 집 ", hashtags: ["#가상동", " ", "#남향"], disclosureText };
  assert.equal(placeCopyText("instagram", input), `남향 10층 집\n\n#가상동 #남향${RULE_PART}${disclosureText}`);
  assert.equal(placeCopyText("threads", input), `남향 10층 집${RULE_PART}${disclosureText}`);
  assert.equal(placeCopyText("instagram", input), snsCopyText({ snsShort: input.text, hashtags: ["#가상동", "#남향"], disclosureText }), "지금 'SNS 글 복사'와 같은 조립");
  assert.equal(placeCopyText("threads", { ...input, text: "  " }), `──────────\n${disclosureText}`, "글이 비면 빈 줄로 시작하지 않음");
  for (const place of ["instagram", "threads"]) assert.ok(placeCopyText(place, input).endsWith(disclosureText), "명시사항은 늘 맨 끝");
});

test("복사 글: 블로그는 지금 '블로그 글 복사'와 같다", () => {
  const input = { title: " 제목 ", paragraphs: ["첫 문단", "둘째 문단"], headings: ["소제목", ""], checklist: ["확인 하나"], hashtags: ["#가상동"], disclosureText };
  assert.equal(placeCopyText("blog", input), blogCopyText(input));
  assert.ok(placeCopyText("blog", input).endsWith(`#가상동${RULE_PART}${disclosureText}`));
});

test("글자 수: 전체 = 내 글 + 자동으로 붙는 글이 늘 맞는다", () => {
  const text = "남향 10층 집"; // 8자
  const threads = placeCount("threads", { text, hashtags: ["#가상동"], disclosureText });
  assert.deepEqual(threads, { place: "threads", total: 38, own: 8, attached: 30, limit: 500, room: 470, left: 462, tags: 0, emoji: 0 });
  assert.equal(threads.attached, length(RULE_PART) + length(disclosureText), "빈 줄·구분선 13자 + 명시사항 17자");
  const instagram = placeCount("instagram", { text, hashtags: ["#가상동", "#남향"], disclosureText });
  assert.equal(instagram.own, 8);
  assert.equal(instagram.attached, 2 + length("#가상동 #남향") + length(RULE_PART) + length(disclosureText));
  assert.equal(instagram.tags, 2);
  const blog = placeCount("blog", { title: "제목", paragraphs: ["문단"], hashtags: ["#가상동"], disclosureText });
  assert.equal(blog.own, length("제목\n\n문단"));
  assert.deepEqual([blog.limit, blog.room, blog.left], [null, null, null]);
  const empty = placeCount("threads", { text: "", hashtags: [], disclosureText });
  assert.deepEqual([empty.total, empty.own, empty.attached], [28, 0, 28], "글이 비면 앞의 빈 줄 2자가 없음");
  for (const count of [threads, instagram, blog, empty]) assert.equal(count.own + count.attached, count.total);
  for (const count of [threads, instagram]) assert.equal(count.room - count.own, count.left, "남은 자리 = 내 글 자리 - 내 글");
  assert.equal(placeCount("instagram", { text: "글 #직접쓴태그", hashtags: ["#가상동"], disclosureText }).tags, 2, "내 글에 직접 쓴 해시태그도 셈");
  assert.equal(placeCount("threads", { text: "가나다", hashtags: [], disclosureText: "한\n글" }).attached, 13 + 3, "한글·줄바꿈은 한 자씩");
});

test("글자 수 줄: 화면에 보이는 두 숫자를 더하면 전체가 된다", () => {
  const disclosure = listingDisclosure();
  const text = "남향 10층, 거실 앞이 트인 가상숲1단지 전용 84.97㎡. 매매 4억 5,000만 원이고 즉시 입주할 수 있습니다.";
  const count = placeCount("threads", { text, hashtags: ["#가상동"], disclosureText: disclosure });
  assert.equal(length(disclosure), 320);
  assert.deepEqual([count.total, count.own, count.attached, count.room, count.left], [399, 66, 333, 167, 101]);
  assert.equal(placeMeterText(count), "500자 중 399자 · 내 글 66자 + 자동으로 붙는 글 333자");
  const [, total, own, attached] = placeMeterText(count).match(/중 ([\d,]+)자 · 내 글 ([\d,]+)자 \+ 자동으로 붙는 글 ([\d,]+)자/u).map((part) => Number(String(part).replace(/,/gu, "")));
  assert.equal(own + attached, total);
  assert.equal(placeMeterText(placeCount("instagram", { text: "가".repeat(1500), hashtags: [], disclosureText })), "2,200자 중 1,530자 · 내 글 1,500자 + 자동으로 붙는 글 30자 · 해시태그 0개");
  assert.equal(placeMeterText(placeCount("instagram", { text: "글", hashtags: ["#가상동", "#남향"], disclosureText })), "2,200자 중 41자 · 내 글 1자 + 자동으로 붙는 글 40자 · 해시태그 2개");
  assert.equal(placeMeterText(placeCount("kakao", { title: "제목", text: "글", disclosureText })), "복사할 글 25자", "카카오톡은 상한이 없어 글자 수만");
  assert.equal(placeFieldNote(count), "66자 · 남은 자리 101자(스레드 500자에서 자동으로 붙는 글 333자를 뺀 자리)");
  assert.equal(placeFieldNote(placeCount("threads", { text: "가".repeat(200), hashtags: [], disclosureText: disclosure })), "200자 · 33자 넘음");
  assert.equal(placeFieldNote(placeCount("kakao", { title: "", text: "가나다", disclosureText })), "3자");
  assert.equal(placeMeterText(placeCount("blog", { title: "가".repeat(1234), paragraphs: [], hashtags: [], disclosureText: "" })), "복사할 글 1,247자");
});

test("한도: 스레드 500자를 넘으면 막고, 얼마나 줄일지 알린다", () => {
  const disclosure = listingDisclosure();
  const fits = placeVerdict("threads", { text: "가".repeat(167), hashtags: ["#가상동"], disclosureText: disclosure });
  assert.equal(fits.ok, true);
  assert.equal(fits.count.total, 500);
  assert.deepEqual([fits.reasons, fits.notes], [[], []]);
  const over = placeVerdict("threads", { text: "가".repeat(200), hashtags: ["#가상동"], disclosureText: disclosure });
  assert.equal(over.ok, false);
  assert.deepEqual(over.reasons, ["스레드 글은 500자까지인데 지금 533자입니다. 내 글을 33자 줄이세요(자동으로 붙는 글 333자는 줄일 수 없습니다)."]);
  const noRoom = placeVerdict("threads", { text: "글", hashtags: [], disclosureText: "가".repeat(490) });
  assert.equal(noRoom.ok, false);
  assert.deepEqual(noRoom.reasons, ["자동으로 붙는 글(명시사항)만 503자라 스레드 500자에 넣을 수 없습니다."]);
});

test("한도: 스레드만 이모지를 UTF-8 바이트 수로 센다(Meta 문서 'Emojis are counted as the number of UTF-8 bytes'). 이모지 180개 + 명시사항 300자는 막힌다", () => {
  const disclosure = "가".repeat(300);
  // 2026-11-25 전에는 코드 포인트로 세어 180 + 313 = 493자로 통과했다(날개-2 검토에서 찾음).
  const emoji = placeVerdict("threads", { text: "😀".repeat(180), hashtags: [], disclosureText: disclosure });
  assert.deepEqual([emoji.ok, emoji.count.own, emoji.count.attached, emoji.count.total, emoji.count.emoji], [false, 720, 313, 1033, 180]);
  assert.equal(emoji.count.total, emoji.count.own + emoji.count.attached, "전체 = 내 글 + 자동으로 붙는 글은 그대로 맞음");
  assert.equal(placeFieldNote(emoji.count), "720자 · 533자 넘음 · 이모지는 스레드가 세는 대로 한 개를 여러 자로 셉니다");
  assert.equal(placeVerdict("threads", { text: "😀".repeat(46), hashtags: [], disclosureText: disclosure }).ok, true, "46개 × 4 = 184자는 남은 자리 187자 안");
  assert.equal(placeVerdict("threads", { text: "😀".repeat(47), hashtags: [], disclosureText: disclosure }).ok, false, "47개 × 4 = 188자는 넘음");
  // 글자마다: 4바이트 이모지 4자, 3바이트 그림 문자(☀)·이어 붙이는 글자(U+200D·U+FE0F·U+20E3) 3자, 한글·숫자·#·줄바꿈은 1자(글 끝의 줄바꿈은 복사 글에 들어가지 않음).
  const own = (text) => placeCount("threads", { text, hashtags: [], disclosureText: "가" }).own;
  assert.deepEqual([own("가1#\n나"), own("😀"), own("☀"), own("👍🏽"), own("🇰🇷"), own("1️⃣"), own("👨‍👩‍👧")], [5, 4, 3, 8, 8, 7, 18]);
  assert.equal(placeCount("threads", { text: "가나다", hashtags: [], disclosureText: "가" }).emoji, 0);
  assert.equal(placeFieldNote(placeCount("threads", { text: "가나다", hashtags: [], disclosureText: "가" })).includes("이모지"), false, "이모지가 없으면 알리지 않음");
  // 인스타그램·카카오톡·블로그는 그대로 한 개를 1자로 센다(문서에 세는 방식이 없음).
  assert.deepEqual([placeCount("instagram", { text: "😀😀", hashtags: [], disclosureText: "가" }).own, placeCount("instagram", { text: "😀😀", hashtags: [], disclosureText: "가" }).emoji], [2, 0]);
  assert.equal(placeCount("kakao", { title: "", text: "😀😀", disclosureText: "가" }).own, 2);
});

test("한도: 인스타그램은 2,200자에서 막고, 해시태그 6개부터는 막지 않고 알리기만 한다", () => {
  const tags = ["#대전동구", "#가상동", "#가상숲1단지", "#아파트매매", "#남향"];
  const fine = placeVerdict("instagram", { text: "글", hashtags: tags, disclosureText });
  assert.deepEqual([fine.ok, fine.reasons, fine.notes], [true, [], []]);
  const six = placeVerdict("instagram", { text: "글", hashtags: [...tags, "#즉시입주"], disclosureText });
  assert.equal(six.ok, true, "해시태그 수는 공식 문서로 확인하지 못해 막지 않음");
  assert.deepEqual(six.notes, ["해시태그가 6개입니다. 인스타그램 앱이 5개까지만 받을 수 있으니, 올릴 때 막히면 5개만 남기세요."]);
  const long = placeVerdict("instagram", { text: "가".repeat(2200), hashtags: [], disclosureText });
  assert.equal(long.ok, false);
  assert.match(long.reasons[0], /^인스타그램 글은 2,200자까지인데 지금 2,230자입니다\. 내 글을 30자 줄이세요/u);
  const blog = placeVerdict("blog", { title: "가".repeat(5000), paragraphs: [], hashtags: [...tags, "#즉시입주"], disclosureText });
  assert.deepEqual([blog.ok, blog.reasons, blog.notes], [true, [], []], "블로그는 상한이 없음");
});

test("카카오톡 글: [제목] 한 줄 + 인스타그램 글 + 명시사항. 해시태그·구분선은 붙이지 않는다", () => {
  const input = { title: " 가상숲1단지 남향 매매 ", text: " 남향 10층 집입니다.\n보러 오실 분은 연락 주세요. ", hashtags: ["#가상동"], disclosureText };
  assert.equal(placeCopyText("kakao", input), `[가상숲1단지 남향 매매]\n남향 10층 집입니다.\n보러 오실 분은 연락 주세요.\n\n${disclosureText}`);
  assert.doesNotMatch(placeCopyText("kakao", input), /#|──/u);
  assert.equal(placeCopyText("kakao", { ...input, title: "  " }), `남향 10층 집입니다.\n보러 오실 분은 연락 주세요.\n\n${disclosureText}`, "제목이 비면 [ ] 줄이 없음");
  assert.equal(placeCopyText("kakao", { title: "제목", text: "", disclosureText }), `[제목]\n\n${disclosureText}`);
  assert.equal(placeCopyText("kakao", { title: "", text: "", disclosureText }), disclosureText, "둘 다 비면 명시사항만");
  const count = placeCount("kakao", input);
  assert.deepEqual([count.limit, count.room, count.left, count.tags], [null, null, null, 0]);
  assert.equal(count.own + count.attached, count.total);
  assert.equal(count.attached, 2 + length(disclosureText));
  const verdict = placeVerdict("kakao", { title: "제목", text: "가".repeat(5000), disclosureText });
  assert.deepEqual([verdict.ok, verdict.reasons, verdict.notes], [true, [], []], "카카오톡은 글자 수로 막지 않음");
});

test("한도: AI가 스레드 글을 받는 상한(500자)까지 써도 화면 판정이 복사를 막는다(예전 'SNS 글 복사'는 595자가 그대로 복사됐음)", () => {
  const disclosure = listingDisclosure();
  const hashtags = ["#대전동구", "#천동", "#가상숲1단지", "#아파트매매", "#남향", "#전용84", "#대전아파트", "#동구아파트", "#실거주", "#대전부동산"];
  const old = snsCopyText({ snsShort: "가".repeat(BLOG_RESULT_LIMITS.snsShort), hashtags, disclosureText: disclosure });
  assert.equal(length(old), 595, "예전 조립: 짧은 글 200자 + 해시태그 10개 + 명시사항");
  const verdict = placeVerdict("threads", { text: "가".repeat(BLOG_RESULT_LIMITS.threads), hashtags, disclosureText: disclosure });
  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /^스레드 글은 500자까지인데 지금 833자입니다\. 내 글을 333자 줄이세요/u);
  assert.equal(placeVerdict("threads", { text: "가".repeat(verdict.count.room), hashtags, disclosureText: disclosure }).ok, true, "남은 자리만큼은 통과");
  const insta = placeVerdict("instagram", { text: "가".repeat(BLOG_RESULT_LIMITS.instagram), hashtags, disclosureText: disclosure });
  assert.equal(insta.ok, true, `인스타그램 글을 받는 상한(${BLOG_RESULT_LIMITS.instagram}자)은 가상 매물의 명시사항·해시태그 10개와 함께 2,200자 안: ${insta.count.total}자`);
});

test("글 검사 자리: 그 올릴 곳의 복사 글에 들어가는 칸의 문제만 그곳 복사를 막는다", () => {
  const wheres = ["title", "h1", "p1", "p12", "check", "tags", "instagram", "threads"];
  const of = (place) => wheres.filter((where) => placeHasWhere(place, where));
  assert.deepEqual(of("blog"), ["title", "h1", "p1", "p12", "check", "tags"]);
  assert.deepEqual(of("instagram"), ["tags", "instagram"]);
  assert.deepEqual(of("threads"), ["threads"]);
  assert.deepEqual(of("kakao"), ["title", "instagram"], "카카오톡 글은 제목과 인스타그램 글로 만든다");
  assert.deepEqual(BLOG_PLACE_FIELDS, { blog: ["title", "body", "tags"], instagram: ["instagram", "tags"], threads: ["threads"], kakao: ["title", "instagram"] });
});

test("순서 글: 카드 그림이 없으면 그림 줄이 없고, 단추·복사 알림은 올릴 곳 이름을 쓴다", () => {
  assert.deepEqual(placeSteps("instagram", { cardCount: 1 }), {
    image: "카드 그림을 휴대폰에 저장합니다.",
    copy: "글을 복사합니다(명시사항까지 함께).",
    post: "인스타그램 앱에서 새 게시물 → 저장한 그림 고르기 → 글 붙여 넣기.",
    copyLabel: "인스타그램 글 복사",
    copied: "✓ 인스타그램 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.",
  });
  assert.equal(placeSteps("blog", { cardCount: 3 }).image, "카드 그림 3장을 저장합니다(블로그 글에 사진으로 넣습니다).");
  assert.equal(placeSteps("kakao", { cardCount: 1 }).image, "카드 그림을 저장합니다(채팅에 사진으로 보냅니다).");
  assert.equal(placeSteps("threads", { cardCount: 1 }).post, "스레드 앱에서 새 스레드 → 글 붙여 넣기 → 저장한 그림 붙이기.");
  for (const place of BLOG_PLACES) {
    const none = placeSteps(place.id);
    assert.equal(none.image, null);
    assert.doesNotMatch(none.post, /저장한 그림/u, "그림이 없으면 그림 이야기를 하지 않음");
    assert.equal(none.copyLabel, `${place.label} 글 복사`);
  }
  assert.equal(placeSteps("blog").copied, "✓ 블로그 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.", "지금 블로그 복사 알림과 같은 글");
});
