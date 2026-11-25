import test from "node:test";
import assert from "node:assert/strict";
import { findSensitiveStrings } from "../scripts/content-validation.mjs";
import { blogExtrasFromInput, getBlogExtraInputErrors, getBlogExtraNotices, tidyBlogExtraInput } from "../src/lib/admin-blog-extras.mjs";
import { getAdminFieldLabel } from "../src/lib/admin-content-diff.mjs";
import {
  BLOG_CATEGORY_MAX_LENGTH,
  BLOG_CONTENTS_MIN_KEPT_LENGTH,
  BLOG_EXCERPT_MAX_LENGTH,
  BLOG_EXCERPT_SKIP_LABELS,
  blogPlainText,
  buildBlogExcerpt,
  cutBlogBeforeContents,
  cutBlogExcerpt,
  dropRepeatedBlogTitle,
  getBlogCategoryErrors,
  getBlogExcerptErrors,
  hasBuildingNumber,
  hasPriceExpression,
  isBlogListingTitle,
  normalizeBlogCategory,
  skipBlogGreeting,
} from "../src/lib/blog-excerpt.mjs";

// 동기화가 쓰는 것과 같은 검사(사무소 예외 없이 가장 엄하게).
const findSensitive = (value) => findSensitiveStrings(value, { path: "blog" });
const build = (post) => buildBlogExcerpt(post, { findSensitive });
const body = "전세나 월세 계약을 마친 뒤에도 꼭 확인해야 하는 절차가 있습니다. 임대차 신고 기한과 대상 여부를 차례로 정리했습니다.";
const longBody = Array.from({ length: 40 }, (_, index) => `${index + 1}번째 문장은 계약 전에 확인할 내용을 차례로 적습니다.`).join(" ");

test("RSS description은 태그를 지우고 엔티티를 풀어 한 줄 글자로 바꾼다", () => {
  assert.equal(
    blogPlainText("<p>첫 줄&nbsp;입니다.</p>\n<br/>\t<b>둘째</b> 줄 &amp; 끝 <img src=\"https://blogthumb.pstatic.net/a.png?type=s3\" />"),
    "첫 줄 입니다. 둘째 줄 & 끝",
  );
  assert.equal(blogPlainText("&quot;4블록&quot;이랑 &#39;5블록&#39; &#x27;비교&#x27; &middot; &hellip;"), "\"4블록\"이랑 '5블록' '비교' · …");
  assert.equal(blogPlainText("<script>alert(1)</script>본문<style>p{color:red}</style> 입니다<!-- 주석 -->"), "본문 입니다");
  assert.equal(blogPlainText("모르는 &bogus; 이름과 &#0; 제어 글자"), "모르는 이름과 제어 글자", "모르는 엔티티는 글자로 남기지 않음");
  assert.equal(blogPlainText(null), "");
  assert.equal(blogPlainText(undefined), "");
});

test("두 번·세 번 싸인 엔티티와 그 안의 태그도 글자로 남지 않는다", () => {
  assert.equal(blogPlainText("&amp;quot;뭐가 달라요?&amp;quot; 하고 물으십니다"), "\"뭐가 달라요?\" 하고 물으십니다");
  assert.equal(blogPlainText("&amp;amp;quot;세 번&amp;amp;quot; 싸인 글"), "\"세 번\" 싸인 글");
  assert.equal(blogPlainText("&lt;b&gt;굵게&lt;/b&gt; 쓴 글 &amp;lt;i&amp;gt;기울임&amp;lt;/i&amp;gt;"), "굵게 쓴 글 기울임");
  assert.equal(blogPlainText("&lt;부동산 공부&gt; 첫 글"), "부동산 공부 첫 글", "꺾쇠 글자는 남기지 않음");
  for (const html of [
    "&amp;quot;A&amp;quot; &amp;amp;nbsp; &lt;p&gt;B&lt;/p&gt; &amp;#39;C&amp;#39;",
    "&amp;amp;amp;amp;amp;amp;amp;amp;lt;script&amp;amp;amp;amp;amp;amp;amp;amp;gt;",
  ]) {
    const text = blogPlainText(html);
    assert.doesNotMatch(text, /&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/iu, html);
    assert.doesNotMatch(text, /[<>]/u, html);
  }
});

test("맨 앞 인사 문장과 바로 뒤 자기소개 문장을 건너뛴다", () => {
  for (const [text, skipped, rest] of [
    ["안녕하세요, 대전 동구 리더스시티 5블록 단지내 상가에서 일하고 있는 리더스시티행복한부동산입니다. 요즘 가장 많이 받는 질문입니다.", "안녕하세요, 대전 동구 리더스시티 5블록 단지내 상가에서 일하고 있는 리더스시티행복한부동산입니다.", "요즘 가장 많이 받는 질문입니다."],
    ["안녕하세요, 리더스시티행복한부동산입니다 ^^ 갑자기 날씨가 추워졌습니다.", "안녕하세요, 리더스시티행복한부동산입니다 ^^", "갑자기 날씨가 추워졌습니다."],
    ["안녕하세요. 대전 동구 아파트를 안내하는 리더스 시티 행복한 부동산입니다. 동구 천동에서 신흥역과 가까운 단지입니다.", "안녕하세요. 대전 동구 아파트를 안내하는 리더스 시티 행복한 부동산입니다.", "동구 천동에서 신흥역과 가까운 단지입니다."],
    ["안녕하세요 리더스시티행복한부동산입니다. 26년 4월 공고문이 나왔습니다.", "안녕하세요 리더스시티행복한부동산입니다.", "26년 4월 공고문이 나왔습니다."],
    ["안녕하세요~ 리더스시티행복한공인중개사사무소 대표 백진옥입니다! 오늘은 전세 이야기입니다.", "안녕하세요~ 리더스시티행복한공인중개사사무소 대표 백진옥입니다!", "오늘은 전세 이야기입니다."],
    ["안녕하세요. 2024년 새해가 밝았습니다. 새해에도 건강하세요.", "안녕하세요.", "2024년 새해가 밝았습니다. 새해에도 건강하세요."],
    ["안녕하세요. 최근 대전 동구 아파트 시장에서는 문의가 이어지고 있습니다.", "안녕하세요.", "최근 대전 동구 아파트 시장에서는 문의가 이어지고 있습니다."],
  ]) {
    assert.deepEqual(skipBlogGreeting(text), { text: rest, skipped }, text);
  }
});

test("인사 문장이 맨 앞이 아니어도 문장 시작이면 그 인사와 자기소개만 빼고 앞뒤를 잇는다", () => {
  for (const [text, skipped, rest] of [
    [
      "전세 계약을 앞둔 청년이라면 대출이 가장 궁금하실 겁니다. 안녕하세요~ 대전 동구 아파트 전문 리더스시티행복한부동산입니다. 전세 계약을 진행하다 보면 문의를 자주 받습니다.",
      "안녕하세요~ 대전 동구 아파트 전문 리더스시티행복한부동산입니다.",
      "전세 계약을 앞둔 청년이라면 대출이 가장 궁금하실 겁니다. 전세 계약을 진행하다 보면 문의를 자주 받습니다.",
    ],
    ["전세 계약을 앞둔 분들이 많이 묻습니다. 안녕하세요~ 리더스시티행복한부동산입니다.", "안녕하세요~ 리더스시티행복한부동산입니다.", "전세 계약을 앞둔 분들이 많이 묻습니다."],
    ["요즘 문의가 많네요! 안녕하세요. 오늘은 전세 이야기입니다.", "안녕하세요.", "요즘 문의가 많네요! 오늘은 전세 이야기입니다."],
    ["날씨가 춥습니다~ 안녕하십니까 여러분! 오늘은 세금 이야기입니다.", "안녕하십니까 여러분!", "날씨가 춥습니다~ 오늘은 세금 이야기입니다."],
    [
      "\"지금 사도 될까요?\" 많이들 물으십니다. 안녕하세요. 리더스시티행복한부동산입니다. 오늘 정리합니다.",
      "안녕하세요. 리더스시티행복한부동산입니다.",
      "\"지금 사도 될까요?\" 많이들 물으십니다. 오늘 정리합니다.",
    ],
    [
      "많이 묻습니다. 안녕하세요. 오늘은 전세 이야기입니다. 안녕하세요. 다시 인사드립니다.",
      "안녕하세요.",
      "많이 묻습니다. 오늘은 전세 이야기입니다. 안녕하세요. 다시 인사드립니다.",
    ],
  ]) {
    assert.deepEqual(skipBlogGreeting(text), { text: rest, skipped }, text);
  }
  // 문장 시작이 아니거나 인용문 안에 있는 "안녕하세요"는 지우지 않는다.
  for (const text of [
    "손님들이 안녕하세요 하고 들어오시면 먼저 차를 드립니다. 오늘 이야기입니다.",
    "손님이 문을 열며 말했습니다. \"안녕하세요. 집 보러 왔어요.\" 그날 상담 이야기입니다.",
    "손님이 말했습니다. \"집 보러 왔어요. 안녕하세요. 소장님 계신가요?\" 그날 상담 이야기입니다.",
    "손님이 말했습니다. “집 보러 왔어요. 안녕하세요. 소장님 계신가요?” 그날 상담 이야기입니다.",
    "전화로 ‘어제 통화했어요. 안녕하세요.’ 하고 말씀하셨습니다.",
    "제목 한 줄 안녕하세요. 리더스시티행복한부동산입니다.",
  ]) {
    assert.deepEqual(skipBlogGreeting(text), { text, skipped: null }, text);
  }
});

test("글 앞이 제목 글자 그대로면 그 제목을 뗀다", () => {
  const title = "리더스시티4블럭 전세계약 연장, 집주인은 언제 연락해야 할까?";
  const rest = "리더스시티4블럭 전세 연장 시기가 다가오면서 많은 집주인분들이 비슷한 고민을 하게 됩니다.";
  assert.equal(dropRepeatedBlogTitle(`${title} ${rest}`, title), rest);
  assert.equal(dropRepeatedBlogTitle(`천동 리더스시티 4bl 안내 ${rest}`, "천동  리더스시티 4bl 안내 "), rest, "제목은 공백을 정리한 뒤 견준다");
  assert.equal(dropRepeatedBlogTitle(`A &amp; B 시세 총정리 ${rest}`.replace("&amp;", "&"), "A &amp; B 시세 총정리"), rest, "제목의 엔티티도 풀어서 견준다");
  assert.equal(dropRepeatedBlogTitle(title, title), "", "글이 제목뿐이면 빈 글자");

  for (const [text, givenTitle, why] of [
    [`리더스시티4블럭 전세계약 연장, 집주인은 언제 연락해야 할까요? ${rest}`, title, "한 글자 다름"],
    [`리더스시티4블록 전세계약 연장, 집주인은 언제 연락해야 할까? ${rest}`, title, "가운데 한 글자 다름"],
    [`${title}라는 질문을 자주 받습니다. ${rest}`, title, "제목 바로 뒤가 띄어쓰기가 아님"],
    [`머리말 ${title} ${rest}`, title, "맨 앞이 아님"],
    [`공지 드립니다. ${rest}`, "공지", "제목이 너무 짧음"],
    [`${title} ${rest}`, null, "제목 없음"],
  ]) {
    assert.equal(dropRepeatedBlogTitle(text, givenTitle), text, why);
  }

  // 제목 되풀이 뒤의 인사까지 함께 빠진다(제목 → 인사 차례).
  const result = build({ title, category: "아파트/분양권", description: `${title} 안녕하세요. 대전 동구 아파트를 안내하는 리더스시티행복한부동산입니다. ${body}` });
  assert.deepEqual(result, { excerpt: body, reason: null, skippedGreeting: "안녕하세요. 대전 동구 아파트를 안내하는 리더스시티행복한부동산입니다." });
  const oneOff = build({ title, category: "아파트/분양권", description: `${title}! ${body}` });
  assert.ok(oneOff.excerpt.startsWith(`${title}! `), "한 글자 다르면 그대로 싣는다");
});

test("'목차'와 목록이 이어지면 '목차' 앞에서 끊고, 남는 글이 60자 미만이면 끊지 않는다", () => {
  assert.equal(BLOG_CONTENTS_MIN_KEPT_LENGTH, 60);
  const sixty = `${"가".repeat(59)}.`;
  const fiftyNine = `${"가".repeat(58)}.`;
  const list = "목차 1. 단지 개요 2. 단지 기본 정보 3. 평형 구성";
  assert.deepEqual(cutBlogBeforeContents(`${sixty} ${list}`), { text: sixty, cut: true }, "60자면 끊는다");
  assert.deepEqual(cutBlogBeforeContents(`${fiftyNine} ${list}`), { text: `${fiftyNine} ${list}`, cut: false }, "59자면 끊지 않는다");
  assert.deepEqual(cutBlogBeforeContents(`${sixty} 목차 -전용면적과 공급면적은 어떻게 다른가요? -왜 34평형인가요?`), { text: sixty, cut: true }, "줄표 목록");
  assert.deepEqual(cutBlogBeforeContents(`${"가".repeat(60)} 목차 ① 개요 ② 시세`), { text: "가".repeat(60), cut: true }, "문장 부호 없이 번호 목록이 이어짐");
  assert.deepEqual(cutBlogBeforeContents(`${sixty} 목차 단지 개요부터 살펴봅니다.`), { text: sixty, cut: true }, "문장이 끝난 뒤의 낱말 '목차'");

  for (const text of [
    `${sixty} 아래 목차 순서대로 설명해 드립니다. 먼저 단지 개요입니다.`,
    `${sixty} 세목차이와 목차별 내용은 다음과 같습니다. 1. 단지 개요`,
    `${sixty} 차례 1. 단지 개요 2. 단지 기본 정보`,
    body,
  ]) {
    assert.deepEqual(cutBlogBeforeContents(text), { text, cut: false }, text);
  }

  assert.equal(cutBlogExcerpt("오늘 정리할 내용은 아래와 같습니다.", { cleanCut: true }), "오늘 정리할 내용은 아래와 같습니다…", "가운데서 끊었으니 …를 붙이고 마지막 낱말은 버리지 않는다");
  assert.equal(cutBlogExcerpt("오늘 정리할 내용은 아래와 같습니다.", { cleanCut: true, sourceCut: true }), "오늘 정리할 내용은 아래와 같습니다…");

  assert.ok(body.length >= BLOG_CONTENTS_MIN_KEPT_LENGTH);
  const result = build({
    title: "천동 리더스시티 5블록 아파트 정보 & 시세 총정리",
    category: "아파트/분양권",
    description: `안녕하세요. 리더스시티행복한부동산입니다. ${body} 목차 1. 단지 개요 2. 단지 기본 정보 3. 평형 구성 1. 단지 개요 리더스시티 5블록은.......`,
  });
  assert.deepEqual(result, { excerpt: `${body.slice(0, -1)}…`, reason: null, skippedGreeting: "안녕하세요. 리더스시티행복한부동산입니다." });
  assert.doesNotMatch(result.excerpt, /목차|단지 개요/u);

  const shortLead = build({ title: "짧은 머리말", description: `${fiftyNine} ${list} ${body}` });
  assert.ok(shortLead.excerpt.includes("목차 1. 단지 개요"), "남는 글이 59자면 지금처럼 목차까지 싣는다");
});

test("제목이 매물 소개인 글은 요약을 싣지 않는다: 급매·매물, 면적·타입 표기 + 거래 종류", () => {
  // 2026-11-25 네이버 공식 RSS 50건의 제목 글자 그대로(번호는 RSS 차례).
  const listingTitles = [
    "신흥sk뷰 59A 매매 ㅣ식장산이 방에서도 보이는 고층, 조합원 세대에요", // 2
    "대전 동구 리더스시티4블록 매매 신축 탑층 매물", // 6
    "대전 천동 리더스시티 5블록 84㎡ 매매｜중앙광장과 보문산 조망, 5억 3천만원", // 7
    "대전 천동 리더스시티 4블록 59A 매물 소개(거래완료)", // 11
    "대전 천동 리더스시티 4블록 74타입, 401동 고층 조망 매물 놓치지 마세요", // 18
    "대전 천동 리더스시티 5블록 59B타입 매매", // 26
    "대전 천동 리더스시티 전세 매물 소개(거래완료)", // 34
    "대전 신흥 SK뷰 84㎡ 급매(정원뷰·역세권·실거주 만족도 높은 매물)-거래완료", // 41
    "천동 리더스시티 4bl 매물 찾는 방법", // 47
  ];
  const otherTitles = [
    "대동2구역 1블록 vs 천동 리더스시티, 59㎡ 가격 비교해봤어요", // 3
    "천동 리더스시티 5블록 아파트 정보 & 매매 시세 총정리", // 8
    "전용면적 공급면적 차이, 아파트 평수 제대로 보는 법", // 12
    "대전 아파트 매매 동향! 9월 1주 얼마나 움직였을까?(feat:천동 리더스 시티 · 신흥 sk 뷰)", // 15
    "대전 롯데캐슬 더 퍼스트 59B 타입, 실거주를 생각한다면 살펴볼 포인트", // 24
    "대전 롯데캐슬 더 퍼스트 59A타입, 실거주 만족도를 높인 실용적인 평면", // 25
    "대전 천동 리더스시티 24평 실거래가 분석, 전세대신 매매가 나을까?", // 38
    "지방 미분양 신축 아파트 매매하기 좋은 타이밍은?(ft. 대전 롯데캐슬 더 퍼스트-조합원 취소분)", // 40
  ];
  for (const title of listingTitles) {
    assert.equal(isBlogListingTitle(title), true, title);
    const expected = /거래완료/u.test(title) ? "deal-closed" : "listing-title";
    assert.deepEqual(build({ title, category: "아파트/분양권", description: body }), { excerpt: null, reason: expected, skippedGreeting: null }, title);
  }
  for (const title of otherTitles) {
    assert.equal(isBlogListingTitle(title), false, title);
    assert.deepEqual(build({ title, category: "아파트/분양권", description: body }), { excerpt: body, reason: null, skippedGreeting: null }, title);
  }
  assert.equal(build({ title: listingTitles[2], category: "추천매물", description: body }).reason, "listing-category", "분류가 먼저");

  for (const [title, expected] of [
    ["천동 리더스시티 급매 소식", true],
    ["리더스시티 5블록 59 타입 전세", true],
    ["신흥 SK뷰 84 ㎡ 월세", true],
    ["신흥 SK뷰 84m² 전세", true],
    ["리더스시티 24평 전세", false],
    ["리더스시티 4bl 전세 계약 주의 사항", false],
    ["청년 전세자금 대출 2026년 한도와 금리 총정리", false],
    ["리더스시티 401동 매매 이야기", false],
    ["리더스시티 59A타입 평면 살펴보기", false],
    ["1,866호 미분양과 전세 흐름", false],
    ["", false],
  ]) {
    assert.equal(isBlogListingTitle(title), expected, title);
  }
  assert.equal(isBlogListingTitle(null), false);
  assert.equal(isBlogListingTitle(undefined), false);
});

test("300자를 넘으면 낱말 경계에서 자르고 …를 붙인다", () => {
  assert.equal(cutBlogExcerpt(body), body, "짧은 글은 그대로");
  const exact = "가".repeat(BLOG_EXCERPT_MAX_LENGTH);
  assert.equal(cutBlogExcerpt(exact), exact, "딱 300자는 그대로");

  const cut = cutBlogExcerpt(longBody);
  assert.ok(longBody.length > BLOG_EXCERPT_MAX_LENGTH);
  assert.ok(cut.length <= BLOG_EXCERPT_MAX_LENGTH, `자른 길이 ${cut.length}`);
  assert.ok(cut.endsWith("…"));
  const kept = cut.slice(0, -1);
  assert.ok(longBody.startsWith(kept));
  assert.match(longBody.slice(kept.length), /^[\s,.]/u, "낱말 가운데서 자르지 않음");
  assert.doesNotMatch(cut, /[\s,.]…$/u, "… 앞에 공백·쉼표·마침표를 남기지 않음");

  assert.equal(cutBlogExcerpt("가".repeat(400)).length, BLOG_EXCERPT_MAX_LENGTH, "띄어쓰기가 없으면 글자 수로 자름");
  assert.equal(cutBlogExcerpt("기존 집을 급하게 내", { sourceCut: true }), "기존 집을 급하게…", "원문이 이미 잘려 있으면 마지막 낱말을 버림");
  const emoji = `${"가".repeat(BLOG_EXCERPT_MAX_LENGTH - 2)}😀😀 끝`;
  assert.doesNotMatch(cutBlogExcerpt(emoji), /[\ud800-\udbff]…$/u, "두 칸 글자의 앞 칸만 남기지 않음");
});

test("요약을 실을 수 있는 글은 인사를 건너뛴 글 앞부분을 돌려준다", () => {
  const result = build({
    title: "임대차 계약 신고 헷갈리는 내용 정리",
    category: "부동산공부",
    description: `안녕하세요. 대전 천동 리더스시티 행복한 부동산입니다. ${body}....... <img src="https://blogthumb.pstatic.net/a.png?type=s3" />`,
  });
  assert.deepEqual(result, {
    excerpt: "전세나 월세 계약을 마친 뒤에도 꼭 확인해야 하는 절차가 있습니다. 임대차 신고 기한과 대상 여부를 차례로…",
    reason: null,
    skippedGreeting: "안녕하세요. 대전 천동 리더스시티 행복한 부동산입니다.",
  });
  assert.deepEqual(getBlogExcerptErrors(result.excerpt), []);

  const long = build({ title: "긴 글", category: "세금", description: `<p>${longBody}</p>` });
  assert.equal(long.reason, null);
  assert.ok(long.excerpt.length <= BLOG_EXCERPT_MAX_LENGTH && long.excerpt.endsWith("…"));
  assert.deepEqual(getBlogExcerptErrors(long.excerpt), []);

  const quoted = build({ title: "두 번 싸인 글", description: `&amp;quot;4블록이랑 5블록, 뭐가 달라요?&amp;quot; ${body}` });
  assert.ok(quoted.excerpt.startsWith("\"4블록이랑 5블록, 뭐가 달라요?\" 전세나"));
  assert.doesNotMatch(quoted.excerpt, /&|quot/u);
});

test("매물 소개 글은 요약을 싣지 않는다: 추천매물 분류·거래완료 제목", () => {
  assert.deepEqual(build({ title: "천동 리더스시티 5블록 84㎡ 매매", category: "추천매물", description: body }), { excerpt: null, reason: "listing-category", skippedGreeting: null });
  assert.equal(build({ title: "천동 리더스시티 5블록 84㎡ 매매", category: " 추천매물 ", description: body }).reason, "listing-category");
  assert.equal(build({ title: "대전 천동 리더스시티 전세 매물 소개(거래완료)", category: "아파트/분양권", description: body }).reason, "deal-closed");
  assert.equal(build({ title: "신흥 SK뷰 84㎡ 급매 - 거래 완료", category: "아파트/분양권", description: body }).reason, "deal-closed");
  assert.equal(build({ title: "천동 리더스시티 전세 안내", category: "아파트/분양권", description: body }).reason, null, "다른 분류·제목은 싣는다");
});

test("요약에 금액 표현이 있으면 싣지 않는다", () => {
  for (const text of ["3억 8천5백만 원", "3억9천만원", "5억 원", "550만 원", "1천만 원 정액", "4억대", "2,000만원", "385,000,000원", "1억~2억 원", "8천 5백만원", "4.2억", "보증금 5,000만에 월 40", "5000만", "평당 1,500만", "1000/50", "2,000 / 60"]) {
    assert.equal(hasPriceExpression(`매매가 ${text} 입니다`), true, text);
    assert.equal(build({ title: "가격 안내", description: `${body} 이번 매물은 ${text}에 나왔습니다.` }).reason, "price", text);
  }
  for (const text of ["총 1,328세대", "전용 59㎡", "2026년 9월 1주", "신흥역까지 10분", "0.15% 올랐습니다", "3~4인 가족", "1만 세대 규모", "수억 원", "만원 버스", "33~34평형", "월세 50만", "8천", "오천만", "25평·34평", "3-4인"]) {
    assert.equal(hasPriceExpression(text), false, text);
  }
  assert.equal(build({ title: "가격 안내", description: `${longBody} 매매가 4억 2천만 원` }).reason, null, "잘려서 실리지 않는 뒷부분의 금액은 보지 않음");
});

test("요약에 동 번호가 있으면 싣지 않고, 지명·낱말의 '동'은 그대로 둔다", () => {
  for (const text of ["401동 고층 남서향", "신흥SK뷰 110동 59㎡", "5블록 505동에 위치한", "1203 동", "401동의 조망"]) {
    assert.equal(hasBuildingNumber(text), true, text);
    assert.equal(build({ title: "단지 안내", description: `${body} 이번에 본 집은 ${text} 입니다.` }).reason, "building-number", text);
  }
  for (const text of ["천동 리더스시티", "13개 동 총 1,130세대", "대동2구역 1블록", "좋은 동과 좋은 층", "가오동 롯데캐슬", "2026 동구 소식", "59㎡ 동향", "1,000동 규모", "12동"]) {
    assert.equal(hasBuildingNumber(text), false, text);
  }
  assert.equal(build({ title: "천동 안내", description: `천동 리더스시티는 13개 동으로 이루어진 단지입니다. ${body}` }).reason, null);
});

test("민감 문자열 검사에 걸리면 싣지 않는다: 자른 조각과 원문 조각 전체를 둘 다 본다", () => {
  for (const text of [
    "문의는 010-1111-2222로 주세요.",
    "문의는 010-2790-8675로 주세요.",
    "메일은 someone@example.com 입니다.",
    "6월에 2,044호로 올해 최고치를 찍었고, 7월에 1,866호로 내려왔습니다.",
    "이번 집은 1203호입니다.",
  ]) {
    assert.deepEqual(build({ title: "안내", description: `${body} ${text}` }), { excerpt: null, reason: "sensitive", skippedGreeting: null }, text);
  }
  const tail = build({ title: "안내", description: `${longBody} 문의는 010-1111-2222로 주세요.` });
  assert.equal(tail.reason, "sensitive", "잘려서 실리지 않는 뒷부분이 걸려도 싣지 않음");

  const calls = [];
  const spy = (value) => { calls.push(value); return []; };
  const spied = buildBlogExcerpt({ title: "안내", description: `안녕하세요. ${longBody}` }, { findSensitive: spy });
  assert.equal(calls.length, 2);
  assert.equal(calls[0], `안녕하세요. ${longBody}`, "원문 조각 전체(인사 포함)");
  assert.equal(calls[1], spied.excerpt, "자른 조각");
  assert.equal(buildBlogExcerpt({ title: "안내", description: body }, { findSensitive: (value) => (value === body ? [] : ["걸림"]) }).reason, null);
  assert.equal(buildBlogExcerpt({ title: "안내", description: longBody }, { findSensitive: (value) => (value === longBody ? [] : ["걸림"]) }).reason, "sensitive", "자른 조각만 걸려도 싣지 않음");

  assert.throws(() => buildBlogExcerpt({ title: "안내", description: body }), /findSensitive/u, "검사 없이는 만들지 않음");
  assert.throws(() => buildBlogExcerpt({ title: "안내", description: body }, {}), TypeError);
});

test("글 앞부분이 없거나 인사를 건너뛴 뒤 30자 미만이면 싣지 않는다", () => {
  assert.deepEqual(build({ title: "사진만 있는 글", description: "" }), { excerpt: null, reason: "too-short", skippedGreeting: null });
  assert.equal(build({ title: "사진만 있는 글", description: "<img src=\"https://blogthumb.pstatic.net/a.png\" />" }).reason, "too-short");
  assert.equal(build({ title: "사진만 있는 글" }).reason, "too-short");
  assert.deepEqual(
    build({ title: "짧은 글", description: "안녕하세요. 리더스시티행복한부동산입니다. 오늘은 짧게 씁니다." }),
    { excerpt: null, reason: "too-short", skippedGreeting: "안녕하세요. 리더스시티행복한부동산입니다." },
  );
  assert.equal(build({ title: "짧은 글", description: "가".repeat(29) }).reason, "too-short");
  assert.equal(build({ title: "짧은 글", description: "가".repeat(30) }).reason, null);
  for (const reason of ["listing-category", "deal-closed", "listing-title", "too-short", "sensitive", "price", "building-number", "invalid"]) {
    assert.equal(typeof BLOG_EXCERPT_SKIP_LABELS[reason], "string", reason);
  }
});

test("저장 형식: 요약 1 ~ 300자·분류 1 ~ 30자, 줄바꿈·앞뒤 공백·HTML·엔티티 없음", () => {
  assert.deepEqual(getBlogExcerptErrors(body), []);
  assert.deepEqual(getBlogExcerptErrors("가".repeat(BLOG_EXCERPT_MAX_LENGTH)), []);
  assert.deepEqual(getBlogCategoryErrors("아파트/분양권"), []);
  assert.deepEqual(getBlogCategoryErrors("가".repeat(BLOG_CATEGORY_MAX_LENGTH)), []);
  for (const [value, pattern] of [
    ["", /1 ~ 300자/u],
    ["가".repeat(BLOG_EXCERPT_MAX_LENGTH + 1), /1 ~ 300자/u],
    [`첫 줄\n둘째 줄`, /줄바꿈/u],
    [`첫 칸\t둘째 칸`, /줄바꿈/u],
    [` ${body}`, /앞뒤 공백/u],
    [`${body} `, /앞뒤 공백/u],
    ["<b>굵게</b> 쓴 글", /HTML 태그/u],
    ["3 < 5", /HTML 태그/u],
    ["&quot;따옴표&quot;", /엔티티/u],
    ["A &amp; B", /엔티티/u],
    ["&#39;작은따옴표&#39;", /엔티티/u],
    [null, /문자열/u],
    [123, /문자열/u],
    [["글"], /문자열/u],
  ]) {
    assert.match(getBlogExcerptErrors(value).join("\n"), pattern, JSON.stringify(value));
  }
  assert.match(getBlogCategoryErrors("가".repeat(BLOG_CATEGORY_MAX_LENGTH + 1)).join("\n"), /1 ~ 30자/u);
  assert.match(getBlogCategoryErrors("").join("\n"), /1 ~ 30자/u);
  assert.deepEqual(getBlogExcerptErrors("R&D 센터와 A & B"), [], "엔티티 꼴이 아닌 &는 둔다");

  assert.equal(normalizeBlogCategory(" 아파트/분양권 "), "아파트/분양권");
  assert.equal(normalizeBlogCategory("부동산&amp;공부"), "부동산&공부");
  assert.equal(normalizeBlogCategory(""), null);
  assert.equal(normalizeBlogCategory(undefined), null);
  assert.equal(normalizeBlogCategory("가".repeat(BLOG_CATEGORY_MAX_LENGTH + 1)), null, "너무 긴 분류는 싣지 않음");
});

// 2026-11-25 관리자 화면에 '글 앞부분 요약'·'분류' 입력 칸이 생겼다. 그 전에는 저장돼 있던 값을 그대로 넘겼고(keepBlogExtras),
// 이제는 칸에 적힌 값이 기준이다: 그대로 두면 그대로, 고치면 고친 값, 비우면 키째 빠진다.
test("관리자 저장: 요약·분류 칸의 값을 저장할 꼴로 바꾸고, 비운 칸은 키째 뺀다", () => {
  assert.deepEqual(blogExtrasFromInput("blog", { excerpt: body, category: "부동산공부" }), { excerpt: body, category: "부동산공부" }, "그대로 둔 값은 그대로");
  assert.deepEqual(Object.keys(blogExtrasFromInput("blog", { category: "부동산공부", excerpt: body })), ["excerpt", "category"], "저장 순서는 요약 → 분류");
  assert.deepEqual(blogExtrasFromInput("blog", { excerpt: "", category: "부동산공부" }), { category: "부동산공부" }, "비운 요약은 키째 빠짐(빈 문자열을 저장하지 않음)");
  assert.deepEqual(blogExtrasFromInput("blog", { excerpt: body, category: "   " }), { excerpt: body }, "공백뿐인 분류도 비운 것");
  assert.deepEqual(blogExtrasFromInput("blog", { excerpt: "", category: "" }), {}, "둘 다 비우면 두 칸이 없는 글");
  assert.deepEqual(blogExtrasFromInput("blog", {}), {}, "새 글");
  assert.deepEqual(blogExtrasFromInput("blog", undefined), {});

  assert.deepEqual(blogExtrasFromInput("youtube", { excerpt: body, category: "부동산공부" }), {}, "종류를 바꾸면 넘기지 않음(검사가 블로그에만 허용)");
  assert.deepEqual(blogExtrasFromInput("instagram", { excerpt: body, category: "부동산공부" }), {});

  assert.equal(tidyBlogExtraInput("  첫 줄\n둘째   줄\t끝  "), "첫 줄 둘째 줄 끝", "줄바꿈·잇단 공백은 한 칸으로(검사가 줄바꿈·앞뒤 공백을 받지 않음)");
  assert.equal(tidyBlogExtraInput(null), "");
  const tidied = blogExtrasFromInput("blog", { excerpt: "  " + body + "\n", category: " 부동산공부 " });
  assert.deepEqual(tidied, { excerpt: body, category: "부동산공부" });
  assert.deepEqual(getBlogExcerptErrors(tidied.excerpt), [], "정리한 값은 콘텐츠 검사와 같은 규칙을 통과");
  assert.deepEqual(getBlogCategoryErrors(tidied.category), []);
});

test("관리자 저장: 요약·분류 형식 오류는 저장 전에 칸 이름과 함께 알린다", () => {
  assert.deepEqual(getBlogExtraInputErrors("blog", { excerpt: body, category: "부동산공부" }), []);
  assert.deepEqual(getBlogExtraInputErrors("blog", { excerpt: "", category: "" }), [], "비운 칸은 오류가 아님(칸이 사라짐)");
  const long = getBlogExtraInputErrors("blog", { excerpt: "가".repeat(BLOG_EXCERPT_MAX_LENGTH + 1), category: "나".repeat(BLOG_CATEGORY_MAX_LENGTH + 1) });
  assert.equal(long.some((error) => error.startsWith("글 앞부분 요약: ")), true);
  assert.equal(long.some((error) => error.startsWith("분류: ")), true);
  assert.deepEqual(
    getBlogExtraInputErrors("blog", { excerpt: "가".repeat(BLOG_EXCERPT_MAX_LENGTH), category: "나".repeat(BLOG_CATEGORY_MAX_LENGTH) }),
    [],
    "상한까지는 받음",
  );
  assert.deepEqual(getBlogExtraInputErrors("youtube", { excerpt: "가".repeat(BLOG_EXCERPT_MAX_LENGTH + 1) }), [], "블로그가 아니면 넘기지 않으므로 보지 않음");
});

test("관리자 저장: 요약의 금액·동 번호와 바뀐 원문 링크는 막지 않고 알리기만 한다", () => {
  const url = "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224999999999";
  const other = "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224000000000";
  assert.deepEqual(getBlogExtraNotices({ excerpt: body, category: "부동산공부", url }, { savedUrl: url }), []);
  assert.deepEqual(getBlogExtraNotices({}), [], "빈 칸");

  const price = getBlogExtraNotices({ excerpt: "가상숲1단지 전용 84㎡가 3억 2,000만원에 나왔습니다." });
  assert.equal(price.length, 1);
  assert.match(price[0], /^요약에 금액으로 보이는 숫자가 있습니다\./u);
  assert.equal(getBlogExtraNotices({ excerpt: "가상숲1단지 입주는 2026/11 예정이라고 안내를 받았습니다." }).length, 1, "날짜 꼴도 금액 규칙에 걸려 알림이 뜬다(그래서 단정하지 않는 문장)");
  const building = getBlogExtraNotices({ excerpt: "가상숲1단지 103동 앞 놀이터를 둘러봤습니다." });
  assert.equal(building.length, 1);
  assert.match(building[0], /^요약에 동 번호가 있습니다\./u);
  assert.equal(getBlogExtraNotices({ excerpt: "가상숲1단지 103동 전용 84㎡ 3억 2,000만원" }).length, 2, "둘 다 있으면 두 줄");
  assert.deepEqual(getBlogExtraInputErrors("blog", { excerpt: "가상숲1단지 103동 전용 84㎡ 3억 2,000만원" }), [], "알림은 저장을 막지 않음(형식 오류가 아님)");

  const moved = getBlogExtraNotices({ excerpt: body, url: other }, { savedUrl: url });
  assert.deepEqual(moved, ["원문 링크를 바꿨습니다. 요약·분류가 새 글의 것인지 확인해 주세요."]);
  assert.equal(getBlogExtraNotices({ category: "부동산공부", url: other }, { savedUrl: url }).length, 1, "분류만 남아 있어도 알림");
  assert.deepEqual(getBlogExtraNotices({ excerpt: "", category: "", url: other }, { savedUrl: url }), [], "두 칸을 비웠으면 알릴 것이 없음");
  assert.deepEqual(getBlogExtraNotices({ excerpt: body, url: other }), [], "새 글(저장된 링크 없음)");
  assert.deepEqual(getBlogExtraNotices({ excerpt: body, url: "" }, { savedUrl: url }), [], "링크 칸을 비운 동안에는 알리지 않음(필수 칸 검사가 따로 막음)");
});

test("관리자 변경 미리보기는 요약·분류 칸을 쉬운 이름으로 보인다", () => {
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].excerpt"), "외부 콘텐츠 · 글 앞부분 요약");
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].category"), "외부 콘텐츠 · 네이버 분류");
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].summary"), "외부 콘텐츠 · 요약", "기존 칸 이름은 그대로");
});
