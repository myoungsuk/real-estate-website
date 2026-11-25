import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BLOG_TEMPLATE_SUMMARY_HEAD,
  formatShortContentDate,
  getBlogCardCategory,
  getBlogCardSummary,
  isTemplateBlogSummary,
} from "../src/lib/blog-card.mjs";
import { buildExternalContentItem, parseNaverBlogFeed } from "../scripts/sync/external-content.mjs";

// 공개 화면의 네이버 블로그 카드(2026-11-25): 요약은 글 앞부분 요약 → 옛 설명 순서로 고르고,
// 자동 받기가 넣은 틀 문장뿐이면 요약 줄을 그리지 않는다. 분류 딱지는 분류가 저장된 글에만.
const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const naverRss = await readSource("tests/fixtures/external-sync/naver-rss.xml");

const blog = (extra = {}) => ({
  id: "naver-blog-224999999999",
  type: "blog",
  status: "published",
  title: "가상숲1단지 둘러보기",
  summary: "운영자가 적은 설명",
  url: "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224999999999",
  publishedAt: "2026-11-24",
  thumbnail: null,
  ...extra,
});
const template = "리더스시티행복한부동산 공식 블로그에서 “가상숲1단지 둘러보기” 관련 내용을 확인해 보세요.";

test("블로그 카드 요약: 글 앞부분 요약 → 옛 설명 순서로 고르고, 틀 문장뿐이면 그리지 않는다", () => {
  assert.equal(getBlogCardSummary(blog({ excerpt: "글 앞부분 요약입니다." })), "글 앞부분 요약입니다.", "요약이 있으면 그것");
  assert.equal(getBlogCardSummary(blog({ excerpt: "글 앞부분 요약입니다.", summary: template })), "글 앞부분 요약입니다.");
  assert.equal(getBlogCardSummary(blog()), "운영자가 적은 설명", "요약이 없으면 옛 설명");
  assert.equal(getBlogCardSummary(blog({ summary: template })), null, "틀 문장뿐이면 요약 줄을 그리지 않음");
  assert.equal(getBlogCardSummary(blog({ summary: `  ${template}  ` })), null, "앞뒤 공백이 있어도 같음");
  assert.equal(getBlogCardSummary(blog({ excerpt: "   ", summary: template })), null, "공백뿐인 요약은 없는 것");
  assert.equal(getBlogCardSummary(blog({ summary: "" })), null);
  assert.equal(getBlogCardSummary(blog({ summary: "리더스시티행복한부동산 공식 블로그에서 다룬 글입니다." })), "리더스시티행복한부동산 공식 블로그에서 다룬 글입니다.", "틀 문장의 여는 따옴표까지 같아야 틀 문장");
});

test("블로그 카드 요약: 블로그가 아닌 항목은 옛 설명 그대로(틀 문장 규칙·요약 칸을 보지 않음)", () => {
  assert.equal(getBlogCardSummary({ type: "youtube", summary: "영상 설명", excerpt: "쓰지 않는 값" }), "영상 설명");
  assert.equal(getBlogCardSummary({ type: "youtube", summary: template }), template);
  assert.equal(getBlogCardSummary({ type: "instagram", summary: "" }), null);
  assert.equal(getBlogCardSummary(undefined), null);
});

test("블로그 카드 분류 딱지: 블로그 글에 분류가 저장돼 있을 때만", () => {
  assert.equal(getBlogCardCategory(blog({ category: "부동산공부" })), "부동산공부");
  assert.equal(getBlogCardCategory(blog({ category: " 아파트/분양권 " })), "아파트/분양권");
  assert.equal(getBlogCardCategory(blog()), null, "분류 없는 글");
  assert.equal(getBlogCardCategory(blog({ category: "   " })), null);
  assert.equal(getBlogCardCategory({ type: "youtube", category: "부동산공부" }), null, "블로그가 아니면 그리지 않음");
  assert.equal(getBlogCardCategory(null), null);
});

test("홈 줄 목록의 짧은 날짜: 가장 새 글과 같은 해는 월·일만, 다른 해는 해까지", () => {
  assert.equal(formatShortContentDate("2026-11-24", "2026"), "11. 24.");
  assert.equal(formatShortContentDate("2026-03-09", "2026"), "3. 9.", "앞자리 0은 뺌");
  assert.equal(formatShortContentDate("2025-03-09", "2026"), "2025. 3. 9.");
  assert.equal(formatShortContentDate("2026-11-24", undefined), "2026. 11. 24.", "기준 해를 모르면 해까지");
  assert.equal(formatShortContentDate("2026-11-24", 2026), "11. 24.", "숫자로 준 해도 같음");
  assert.equal(formatShortContentDate(null, "2026"), null);
  assert.equal(formatShortContentDate("2026/11/24", "2026"), null, "날짜 꼴이 아니면 그리지 않음");
});

// 틀 문장은 자동 받기(scripts/sync/external-content.mjs)가 만든다. 그 문장이 바뀌면 카드가 틀 문장을 요약으로 다시 그리게 되므로 여기서 묶는다.
test("자동 받기가 만든 틀 문장은 카드가 틀 문장으로 알아본다(만드는 곳과 알아보는 곳이 어긋나면 떨어짐)", () => {
  const [candidate] = parseNaverBlogFeed(naverRss);
  const built = buildExternalContentItem(candidate, null);
  assert.equal(built.type, "blog");
  assert.equal(built.excerpt, undefined, "이 시험 자료는 글 앞부분 요약이 없는 글");
  assert.equal(built.summary.startsWith(BLOG_TEMPLATE_SUMMARY_HEAD), true);
  assert.equal(isTemplateBlogSummary(built.summary), true);
  assert.equal(getBlogCardSummary(built), null, "새로 받은 글은 요약이 생기기 전까지 요약 줄이 없음");
});

test("블로그 카드 부품과 홈 블로그 칸은 같은 규칙 파일을 쓴다", async () => {
  const [card, homeLead, home] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/components/HomeBlogLead.astro"),
    readSource("src/pages/index.astro"),
  ]);
  assert.match(card, /import \{ getBlogCardCategory, getBlogCardSummary \} from "\.\.\/lib\/blog-card\.mjs";/u);
  assert.match(homeLead, /import \{ formatShortContentDate, getBlogCardCategory, getBlogCardSummary \} from "\.\.\/lib\/blog-card\.mjs";/u);
  assert.match(homeLead, /<a class="home-blog__title" href=\{lead\.url\} target="_blank" rel="noopener noreferrer">\{lead\.title\}<\/a>/u, "큰 글의 누르는 곳은 제목 링크 하나");
  assert.doesNotMatch(homeLead, /loading="eager"|fetchpriority/u, "홈 블로그 그림은 먼저 받지 않음(첫 화면 그림이 아님)");
  assert.equal((homeLead.match(/loading="lazy"/gu) ?? []).length, 2, "큰 글·줄 목록 그림 모두 늦게 받음");
  assert.match(home, /const homeBlogContents = publishedBlogContents\.slice\(0, 7\);/u, "홈은 최신 글 1건 크게 + 6건 줄 목록");
  assert.match(home, /<HomeBlogLead items=\{homeBlogContents\} \/>/u);
});
