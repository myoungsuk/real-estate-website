// 공개 화면의 유튜브 보이기(2026-11-25 사용자 승인 "유튜브 추천대로"·"유튜브 전부 추천대로"):
// 홈 유튜브 칸(최신 일반 영상 1개 크게 + 5개 줄 목록, Shorts 없음)과 /youtube/ 카드의 제목 끝 해시태그 떼기·틀 문장 숨기기·형식 딱지.
// 영상은 매시간 자동으로 들어오므로 기대값을 글자로 적지 않고, 화면에 그려진 영상을 원문 주소로 공개 JSON에서 찾아
// 화면이 쓰는 것과 같은 규칙 파일(youtube-card.mjs)로 견준다. 미리 재생 영상은 바깥으로 받지 않고 빈 문서로 바꿔 끼운다.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { YOUTUBE_TEMPLATE_SUMMARY_HEAD, getYoutubeCardSummary, getYoutubeCardTitle, getYoutubeFormatLabel } from "../src/lib/youtube-card.mjs";

const contents = JSON.parse(readFileSync(new URL("../src/data/external-links.json", import.meta.url), "utf8"));
const youtubes = contents.filter((item) => item.type === "youtube" && item.status === "published");
const videos = youtubes.filter((item) => item.youtubeFormat === "video");
const byUrl = new Map(youtubes.map((item) => [item.url, item]));
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
const blankYoutubeEmbed = (page) => page.route(/youtube-nocookie\.com\/embed\//u, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>미리보기</title>" }));

for (const width of [360, 1280]) {
  test(`홈 유튜브 칸 ${width}px: 최신 일반 영상 1개는 크게, 5개는 줄 목록이고 제목 끝 해시태그를 떼고 가로로 넘치지 않는다`, async ({ page }) => {
    test.skip(videos.length === 0, "공개 일반 영상이 없으면 빈 안내만 보임");
    const assertNoBrowserErrors = failOnBrowserErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    const group = page.locator("#youtube");
    await group.scrollIntoViewIfNeeded();
    await expect(group.locator(".home-blog__lead")).toHaveCount(1);
    await expect(group.locator(".home-blog__row")).toHaveCount(Math.min(5, videos.length - 1));
    await expect(group.locator(".content-note")).toHaveCount(0);

    const lead = group.locator(".home-blog__lead");
    await expect(lead.locator("a")).toHaveCount(1);
    const leadLink = lead.locator("a.home-blog__title");
    await expect(leadLink).toHaveAttribute("target", "_blank");
    await expect(leadLink).toHaveAttribute("rel", "noopener noreferrer");
    const leadItem = byUrl.get(await leadLink.getAttribute("href"));
    expect(leadItem?.youtubeFormat, "큰 영상은 공개 일반 영상").toBe("video");
    expect(videos.every((item) => (item.publishedAt ?? "") <= (leadItem.publishedAt ?? "")), "큰 영상이 가장 새 일반 영상").toBe(true);
    await expect(leadLink).toHaveText(getYoutubeCardTitle(leadItem));
    await expect(lead.locator(".home-blog__tag")).toHaveText(getYoutubeFormatLabel(leadItem));
    await expect(lead.locator(".home-blog__excerpt")).toHaveCount(0);
    await expect(lead.locator(".home-yt__play")).toHaveCount(leadItem.thumbnail ? 1 : 0);
    for (const image of await lead.locator("img").all()) await expect(image).toHaveAttribute("loading", "lazy");

    const rows = await group.locator(".home-blog__row").evaluateAll((elements) => elements.map((row) => {
      const link = row.querySelector("a.home-blog__row-title");
      return {
        links: row.querySelectorAll("a").length,
        href: link?.getAttribute("href") ?? null,
        title: link?.textContent?.trim() ?? null,
        tag: row.querySelector(".home-blog__row-meta span")?.textContent ?? null,
        height: row.getBoundingClientRect().height,
      };
    }));
    for (const row of rows) {
      expect(row.links).toBe(1);
      const item = byUrl.get(row.href);
      expect(item?.youtubeFormat, `줄 목록의 영상 ${row.href}는 일반 영상`).toBe("video");
      expect(row.title).toBe(getYoutubeCardTitle(item));
      expect(row.tag).toBe("일반 영상");
      expect(row.height).toBeGreaterThanOrEqual(44);
    }
    expect(new Set([leadItem.url, ...rows.map((row) => row.href)]).size, "같은 영상을 두 번 그리지 않음").toBe(rows.length + 1);
    await expect(group.getByRole("link", { name: "유튜브 전체 보기" })).toHaveAttribute("href", "/youtube/");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    assertNoBrowserErrors();
  });
}

test("홈 유튜브 칸: 정밀 포인터로 큰 영상·목록에 머물면 소리 없이 미리 재생하고, 벗어나면 지운다", async ({ page }) => {
  test.skip(videos.length < 2, "큰 영상과 목록이 모두 있어야 함");
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await blankYoutubeEmbed(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const group = page.locator("#youtube");
  await group.scrollIntoViewIfNeeded();
  for (const target of [group.locator(".home-blog__lead"), group.locator(".home-blog__row").first()]) {
    await target.hover();
    const frame = target.locator("[data-youtube-preview-frame] iframe");
    await expect(frame).toHaveCount(1);
    const src = new URL(await frame.getAttribute("src"));
    expect(src.hostname).toBe("www.youtube-nocookie.com");
    expect(src.searchParams.get("mute")).toBe("1");
    await expect(target.locator(".home-yt__media")).toHaveClass(/is-previewing/u);
    await page.mouse.move(2, 2);
    await expect(frame).toHaveCount(0);
  }
  // 한 번에 하나만 재생한다
  await expect(group.locator("iframe")).toHaveCount(0);
  assertNoBrowserErrors();
});

test("홈 유튜브 칸: 움직임 줄이기 환경에서는 미리 재생하지 않는다", async ({ page }) => {
  test.skip(videos.length === 0, "공개 일반 영상이 없음");
  await blankYoutubeEmbed(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  const lead = page.locator("#youtube .home-blog__lead");
  await lead.scrollIntoViewIfNeeded();
  await lead.hover();
  await page.waitForTimeout(600);
  await expect(lead.locator("iframe")).toHaveCount(0);
});

for (const width of [360, 1280]) {
  test(`유튜브 목록 ${width}px: 카드 제목은 끝 해시태그를 떼고, 틀 문장 설명은 그리지 않고, 형식 딱지를 단다`, async ({ page }) => {
    test.skip(youtubes.length === 0, "공개 영상이 없으면 빈 안내만 보임");
    const assertNoBrowserErrors = failOnBrowserErrors(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/youtube/");
    await expect(page.locator(".content-card:visible")).toHaveCount(Math.min(6, videos.length));

    // 숨은 쪽·Shorts 카드까지 모두 본다.
    const cards = await page.locator(".content-card").evaluateAll((elements) => elements.map((card) => {
      const body = card.querySelector(".content-card__body");
      const summary = body?.querySelector(":scope > p:not(.content-card__source)");
      return {
        href: card.querySelector("h3 a")?.getAttribute("href") ?? null,
        title: card.querySelector("h3 a")?.textContent ?? null,
        label: card.querySelector(".content-card__thumbnail")?.getAttribute("aria-label") ?? null,
        source: card.querySelectorAll(".content-card__source").length,
        category: card.querySelector(".content-card__category")?.textContent ?? null,
        summary: summary ? summary.textContent : null,
      };
    }));
    expect(cards).toHaveLength(youtubes.length);
    for (const card of cards) {
      const item = byUrl.get(card.href);
      expect(item, `카드의 영상 ${card.href}`).toBeTruthy();
      expect(oneLine(card.title), item.id).toBe(oneLine(getYoutubeCardTitle(item)));
      expect(card.label, item.id).toBe(`${getYoutubeCardTitle(item)} 원문 보기`);
      expect(card.source, "출처 이름표 대신 딱지").toBe(0);
      expect(card.category === null ? null : oneLine(card.category), item.id).toBe(getYoutubeFormatLabel(item));
      const summary = getYoutubeCardSummary(item);
      expect(card.summary === null ? null : oneLine(card.summary), item.id).toBe(summary ? oneLine(summary) : null);
      expect(oneLine(card.summary).startsWith(YOUTUBE_TEMPLATE_SUMMARY_HEAD), "틀 문장을 설명으로 그리지 않음").toBe(false);
    }
    // Shorts로 바꿔도 같은 규칙
    await page.getByRole("button", { name: /Shorts 보기/u }).click();
    const firstShort = page.locator(".content-card:visible").first();
    await expect(firstShort.locator(".content-card__category")).toHaveText("Shorts");
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    assertNoBrowserErrors();
  });
}
