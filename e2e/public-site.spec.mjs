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
  const filterForm = page.locator("[data-listing-filter]");

  await filterForm.getByLabel("거래유형").selectOption("sale");
  await expect(page).toHaveURL(/\/properties\/\?trade=sale$/u);

  await filterForm.getByLabel("최소 가격").fill("30000");
  await filterForm.getByLabel("최소 면적").fill("59");
  await filterForm.getByRole("button", { name: "조건 적용" }).click();
  await expect(page).toHaveURL(/trade=sale/u);
  await expect(page).toHaveURL(/minPrice=30000/u);
  await expect(page).toHaveURL(/minArea=59/u);

  const visibleCards = page.locator("[data-naver-listing-card]:visible");
  const visibleCount = await visibleCards.count();
  expect(visibleCount).toBeGreaterThan(0);
  for (const card of await visibleCards.all()) {
    expect(Number(await card.getAttribute("data-price"))).toBeGreaterThanOrEqual(30000);
    expect(Number(await card.getAttribute("data-area"))).toBeGreaterThanOrEqual(59);
  }
  await expect(page.locator("[data-result-count]")).toHaveText(`네이버 등록 매물 ${visibleCount}건`);

  await filterForm.getByRole("button", { name: "필터 초기화" }).click();
  await expect(page).toHaveURL(/\/properties\/$/u);
  await expect(filterForm.getByLabel("거래유형")).toHaveValue("");
  await expect(filterForm.getByLabel("정렬기준")).toHaveValue("latest");
  assertNoBrowserErrors();
});

test("관심 매물은 브라우저에 유지되고 선택한 매물은 최대 3개까지 비교한다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.goto("/properties/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const favorite = page.locator("[data-favorite-button]").first();
  await favorite.click();
  await expect(favorite).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-favorite-count]")).toHaveText("1");
  await page.reload();
  await expect(page.locator("[data-favorite-button]").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-favorite-count]")).toHaveText("1");

  const compareButtons = page.locator("[data-compare-button]");
  for (let index = 0; index < 4; index += 1) await compareButtons.nth(index).click();
  await expect(page.locator("[data-compare-count]")).toHaveText("비교 매물 3/3");
  await expect(compareButtons.nth(3)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-compare-status]")).toHaveText("최대 3개까지 비교할 수 있습니다.");

  await page.locator("[data-compare-link]").click();
  await expect(page).toHaveURL(/\/properties\/compare\/\?ids=\d+%2C\d+%2C\d+$/u);
  await expect(page.locator("[data-compare-summary]")).toHaveText("선택한 공개 매물 3개를 비교합니다.");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/u);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/properties\/$/u);
  assertNoBrowserErrors();
});

test("문의 문장은 선택한 공개 정보만 화면에서 만들고 서버로 제출하지 않는다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  const apiRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) apiRequests.push(request.url());
  });
  await page.goto("/properties/");

  const firstCard = page.locator("[data-naver-listing-card]").first();
  const firstId = await firstCard.getAttribute("data-listing-id");
  await firstCard.locator("[data-compare-button]").click();
  await page.getByLabel("희망 지역·단지").fill("리더스시티");
  await page.getByLabel("예산 범위").fill("3억원대");
  await page.getByLabel(/추가 요청/u).fill("남향 여부를 확인해 주세요.");
  await page.getByRole("button", { name: "문의 문장 만들기" }).click();

  const result = page.locator("[data-inquiry-result]");
  await expect(result).toBeVisible();
  await expect(result).toHaveValue(new RegExp(`매물번호 ${firstId}`, "u"));
  await expect(result).toHaveValue(/지역·단지: 리더스시티/u);
  await expect(result).toHaveValue(/추가 요청[\s\S]*남향 여부를 확인해 주세요\./u);
  expect(apiRequests).toEqual([]);
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

test("360px 매물 화면에서 조건 패널과 선택 기능이 가로 넘침 없이 동작한다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/properties/");

  const filterToggle = page.locator("[data-filter-toggle]");
  const filterForm = page.locator("[data-listing-filter]");
  await expect(filterToggle).toBeVisible();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await filterToggle.click();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "true");
  await expect(filterForm.getByLabel("거래유형")).toBeVisible();

  await filterForm.getByLabel("거래유형").selectOption("sale");
  await filterForm.getByRole("button", { name: "조건 적용" }).click();
  await expect(filterToggle).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-compare-button]").first().click();
  await expect(page.locator("[data-compare-tray]")).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  assertNoBrowserErrors();
});
