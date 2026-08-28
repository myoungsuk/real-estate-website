import { expect, test } from "@playwright/test";

function failOnBrowserErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}

test("홈의 핵심 상담 링크와 검색 가능한 문서 구조가 유지된다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator('a[href^="tel:"]').first()).toBeVisible();
  await expect(page.locator('a[href^="sms:"]').first()).toBeVisible();

  const kakao = page.getByRole("link", { name: /카카오톡/ }).first();
  await expect(kakao).toHaveAttribute("href", /^https:\/\//u);
  await expect(kakao).toHaveAttribute("target", "_blank");
  await expect(kakao).toHaveAttribute("rel", /noopener/u);
  assertNoBrowserErrors();
});

test("매물 필터가 결과·주소를 갱신하고 초기화된다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.goto("/properties/");

  await page.getByLabel("거래유형").selectOption("sale");
  await expect(page).toHaveURL(/\/properties\/\?trade=sale$/u);

  const visibleCards = page.locator("[data-naver-listing-card]:visible");
  const visibleCount = await visibleCards.count();
  expect(visibleCount).toBeGreaterThan(0);
  await expect(page.locator("[data-result-count]")).toHaveText(`네이버 등록 매물 ${visibleCount}건`);

  await page.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page).toHaveURL(/\/properties\/$/u);
  await expect(page.getByLabel("거래유형")).toHaveValue("");
  await expect(page.getByLabel("정렬기준")).toHaveValue("latest");
  assertNoBrowserErrors();
});

test("없는 주소는 404와 noindex를 제공한다", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const response = await page.goto("/e2e-not-found/");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1, name: "페이지를 찾을 수 없습니다." })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
  await expect(page.getByRole("link", { name: "홈으로 이동" })).toHaveAttribute("href", "/");
  expect(pageErrors, "404 화면의 JavaScript 예외가 없어야 합니다").toEqual([]);
});

test("360px 화면에서 메뉴와 빠른 상담이 가로 넘침 없이 동작한다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");

  const menuButton = page.locator("[data-menu-button]");
  await expect(menuButton).toBeVisible();
  await menuButton.click();
  await expect(menuButton).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menuButton).toHaveAttribute("aria-expanded", "false");

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const quickLinks = page.getByRole("complementary", { name: "빠른 상담" }).getByRole("link");
  await expect(quickLinks).toHaveCount(3);
  for (const link of await quickLinks.all()) {
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360.5);
  }
  assertNoBrowserErrors();
});
