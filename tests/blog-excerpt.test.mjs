import test from "node:test";
import assert from "node:assert/strict";
import { findSensitiveStrings } from "../scripts/content-validation.mjs";
import { keepBlogExtras } from "../src/lib/admin-blog-extras.mjs";
import { getAdminFieldLabel } from "../src/lib/admin-content-diff.mjs";
import {
  BLOG_CATEGORY_MAX_LENGTH,
  BLOG_EXCERPT_MAX_LENGTH,
  BLOG_EXCERPT_SKIP_LABELS,
  blogPlainText,
  buildBlogExcerpt,
  cutBlogExcerpt,
  getBlogCategoryErrors,
  getBlogExcerptErrors,
  hasBuildingNumber,
  hasPriceExpression,
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
  const noGreeting = "전세 계약을 앞둔 분들이 많이 묻습니다. 안녕하세요~ 리더스시티행복한부동산입니다.";
  assert.deepEqual(skipBlogGreeting(noGreeting), { text: noGreeting, skipped: null }, "맨 앞이 아닌 인사는 그대로 둠");
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
  for (const text of ["3억 8천5백만 원", "3억9천만원", "5억 원", "550만 원", "1천만 원 정액", "4억대", "2,000만원", "385,000,000원", "1억~2억 원", "8천 5백만원", "4.2억"]) {
    assert.equal(hasPriceExpression(`매매가 ${text} 입니다`), true, text);
    assert.equal(build({ title: "가격 안내", description: `${body} 이번 매물은 ${text}에 나왔습니다.` }).reason, "price", text);
  }
  for (const text of ["총 1,328세대", "전용 59㎡", "2026년 9월 1주", "신흥역까지 10분", "0.15% 올랐습니다", "3~4인 가족", "1만 세대 규모", "수억 원", "만원 버스", "33~34평형"]) {
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
  for (const reason of ["listing-category", "deal-closed", "too-short", "sensitive", "price", "building-number", "invalid"]) {
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

test("관리자 저장: 같은 블로그 글을 고칠 때 요약·분류를 그대로 넘긴다", () => {
  const existing = {
    id: "naver-blog-224999999999",
    type: "blog",
    status: "published",
    title: "임대차 계약 신고",
    summary: "운영자가 적은 설명",
    excerpt: body,
    category: "부동산공부",
    url: "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224999999999",
    publishedAt: "2026-08-26",
    thumbnail: null,
  };
  assert.deepEqual(keepBlogExtras(existing, { type: "blog", url: existing.url }), { excerpt: body, category: "부동산공부" });
  assert.deepEqual(Object.keys(keepBlogExtras(existing, { type: "blog", url: existing.url })), ["excerpt", "category"], "저장 순서는 요약 → 분류");

  const { excerpt, ...categoryOnly } = existing;
  assert.deepEqual(keepBlogExtras(categoryOnly, { type: "blog", url: existing.url }), { category: "부동산공부" }, "없는 칸은 만들지 않음");
  const { category, ...excerptOnly } = existing;
  assert.deepEqual(keepBlogExtras(excerptOnly, { type: "blog", url: existing.url }), { excerpt: body });
  assert.equal(excerpt, body);
  assert.equal(category, "부동산공부");

  assert.deepEqual(keepBlogExtras(undefined, { type: "blog", url: existing.url }), {}, "새 글");
  assert.deepEqual(keepBlogExtras(existing, { type: "youtube", url: existing.url }), {}, "종류를 바꾸면 넘기지 않음(검사가 블로그에만 허용)");
  assert.deepEqual(keepBlogExtras(existing, { type: "instagram", url: existing.url }), {});
  assert.deepEqual(keepBlogExtras({ ...existing, type: "youtube" }, { type: "blog", url: existing.url }), {});
  assert.deepEqual(keepBlogExtras(existing, { type: "blog", url: "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224000000000" }), {}, "다른 글 주소로 바꾸면 옛 글의 요약을 남기지 않음");
});

test("관리자 변경 미리보기는 요약·분류 칸을 쉬운 이름으로 보인다", () => {
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].excerpt"), "외부 콘텐츠 · 글 앞부분 요약");
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].category"), "외부 콘텐츠 · 네이버 분류");
  assert.equal(getAdminFieldLabel("external-links", "items[naver-blog-224999999999].summary"), "외부 콘텐츠 · 요약", "기존 칸 이름은 그대로");
});
