// 공개 화면의 네이버 블로그 보이기(2026-11-25): 홈 '블로그·유튜브 새 글'의 블로그 칸(최신 글 1건 크게 + 줄 목록)과
// /blog/ 카드의 글 앞부분 요약·분류 딱지. 블로그 글은 매시간 자동으로 들어오므로 기대값을 글자로 적지 않고,
// 화면에 그려진 글을 원문 주소로 공개 JSON에서 찾아 화면이 쓰는 것과 같은 규칙 파일(blog-card.mjs)로 견준다.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { BLOG_TEMPLATE_SUMMARY_HEAD, getBlogCardCategory, getBlogCardSummary } from "../src/lib/blog-card.mjs";

const contents = JSON.parse(readFileSync(new URL("../src/data/external-links.json", import.meta.url), "utf8"));
const blogs = contents.filter((item) => item.type === "blog" && item.status === "published");
const byUrl = new Map(blogs.map((item) => [item.url, item]));
const oneLine = (value) => (value ?? "").replace(/\s+/gu, " ").trim();

function failOnBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const width of [360, 1280]) {
  test(`홈 블로그 칸 ${width}px: 최신 글 1건은 요약과 함께 크게, 나머지는 줄 목록이고 가로로 넘치지 않는다`, async ({ page }) => {
    test.skip(blogs.length === 0, "공개 블로그 글이 없으면 빈 안내만 보임");
    const assertNoBrowserErrors = failOnBrowserErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const group = page.locator("#blog");
    await group.scrollIntoViewIfNeeded();
    await expect(group.locator(".home-blog__lead")).toHaveCount(1);
    await expect(group.locator(".home-blog__row")).toHaveCount(Math.min(6, blogs.length - 1));
    await expect(group.locator(".content-note")).toHaveCount(0);

    // 큰 글: 누르는 곳은 제목 링크 하나, 요약·분류는 저장된 값 그대로.
    const lead = group.locator(".home-blog__lead");
    await expect(lead.locator("a")).toHaveCount(1);
    const leadLink = lead.locator("a.home-blog__title");
    await expect(leadLink).toHaveAttribute("target", "_blank");
    await expect(leadLink).toHaveAttribute("rel", "noopener noreferrer");
    const leadItem = byUrl.get(await leadLink.getAttribute("href"));
    expect(leadItem, "큰 글은 공개 블로그 글").toBeTruthy();
    expect(blogs.every((item) => (item.publishedAt ?? "") <= (leadItem.publishedAt ?? "")), "큰 글이 가장 새 글").toBe(true);
    await expect(leadLink).toHaveText(leadItem.title);
    const leadSummary = getBlogCardSummary(leadItem);
    if (leadSummary) expect(oneLine(await lead.locator(".home-blog__excerpt").textContent())).toBe(oneLine(leadSummary));
    else await expect(lead.locator(".home-blog__excerpt")).toHaveCount(0);
    const leadCategory = getBlogCardCategory(leadItem);
    if (leadCategory) await expect(lead.locator(".home-blog__tag")).toHaveText(`분류 ${leadCategory}`);
    else await expect(lead.locator(".home-blog__tag")).toHaveCount(0);
    for (const image of await lead.locator("img").all()) await expect(image).toHaveAttribute("loading", "lazy");

    // 줄 목록: 줄마다 링크 하나, 누르는 곳은 줄 전체(44px 이상).
    const rows = await group.locator(".home-blog__row").evaluateAll((elements) => elements.map((row) => {
      const link = row.querySelector("a.home-blog__row-title");
      return {
        links: row.querySelectorAll("a").length,
        href: link?.getAttribute("href") ?? null,
        title: link?.textContent?.trim() ?? null,
        height: row.getBoundingClientRect().height,
      };
    }));
    for (const row of rows) {
      expect(row.links).toBe(1);
      const item = byUrl.get(row.href);
      expect(item, `줄 목록의 글 ${row.href}`).toBeTruthy();
      expect(row.title).toBe(item.title);
      expect(row.height).toBeGreaterThanOrEqual(44);
    }
    expect(new Set([leadItem.url, ...rows.map((row) => row.href)]).size, "같은 글을 두 번 그리지 않음").toBe(rows.length + 1);
    await expect(group.getByRole("link", { name: "블로그 전체 보기" })).toHaveAttribute("href", "/blog/");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    assertNoBrowserErrors();
  });

  test(`블로그 목록 ${width}px: 카드마다 분류 딱지는 분류가 있을 때만, 요약은 글 앞부분 요약 → 옛 설명 순서이고 틀 문장은 그리지 않는다`, async ({ page }) => {
    test.skip(blogs.length === 0, "공개 블로그 글이 없으면 빈 안내만 보임");
    const assertNoBrowserErrors = failOnBrowserErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/blog/");
    await expect(page.locator(".content-card:visible")).toHaveCount(Math.min(9, blogs.length));

    // 숨은 쪽의 카드까지 모두 본다(분류 없는 글·요약 없는 글은 뒤쪽 쪽에 있다).
    const cards = await page.locator(".content-card").evaluateAll((elements) => elements.map((card) => {
      const body = card.querySelector(".content-card__body");
      const summary = body?.querySelector(":scope > p:not(.content-card__source)");
      return {
        href: card.querySelector("h3 a")?.getAttribute("href") ?? null,
        source: card.querySelectorAll(".content-card__source").length,
        category: card.querySelector(".content-card__category")?.textContent ?? null,
        summary: summary ? summary.textContent : null,
      };
    }));
    expect(cards).toHaveLength(blogs.length);
    for (const card of cards) {
      const item = byUrl.get(card.href);
      expect(item, `카드의 글 ${card.href}`).toBeTruthy();
      expect(card.source, "출처 이름표는 카드마다 하나").toBe(1);
      const category = getBlogCardCategory(item);
      expect(card.category === null ? null : oneLine(card.category), item.id).toBe(category ? `분류 ${category}` : null);
      const summary = getBlogCardSummary(item);
      expect(card.summary === null ? null : oneLine(card.summary), item.id).toBe(summary ? oneLine(summary) : null);
      expect(oneLine(card.summary).startsWith(BLOG_TEMPLATE_SUMMARY_HEAD), "틀 문장을 요약으로 그리지 않음").toBe(false);
    }
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    assertNoBrowserErrors();
  });
}
