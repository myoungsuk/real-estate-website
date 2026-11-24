import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { ADMIN_PAGE_HELP } from "../src/lib/admin-help.mjs";
import { stripWebpMetadataFromDataUrl } from "../src/lib/admin-webp-clean.mjs";
import { validateWebpBytes } from "../worker/github-content.mjs";

// 단지 이름·사실·사진 설명·홈 단지 목록은 운영자가 관리자 화면에서 바꾸는 값이라, 기대값을 글자로 적지 않고 같은 공개 JSON에서 읽는다.
const readData = (name) => JSON.parse(readFileSync(new URL(`../src/data/${name}.json`, import.meta.url), "utf8"));

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

test("신흥 SK뷰 상세와 매물 필터가 연결되고 주요 화면 폭에서 넘치지 않는다", async ({ page }) => {
  const complexes = readData("complexes");
  const overview = readData("complexes-overview");
  const publishedContentIds = new Set(readData("external-links").filter((item) => item.status === "published").map((item) => item.id));
  const sinheung = complexes.find((complex) => complex.slug === "sinheung-sk-view");
  test.skip(sinheung?.status !== "published", "신흥 SK뷰가 공개 상태가 아니면 상세 화면이 만들어지지 않음(운영자 선택)");
  const featured = overview.featuredComplexSlugs
    .map((slug) => complexes.find((complex) => complex.slug === slug))
    .filter((complex) => complex?.status === "published");
  // 홈 기본정보 표와 같은 규칙(index.astro getHomeComplexFact): 앞 이름부터 "확인 중"이 아닌 첫 값
  const homeFact = (complex, labels) => labels
    .map((label) => complex.facts.find((fact) => fact.label === label)?.value ?? "확인 중")
    .find((value) => value !== "확인 중") ?? "확인 중";
  const relatedCount = sinheung.relatedContentIds.filter((id) => publishedContentIds.has(id)).length;
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/properties/");
  const sinheungListingIds = await page.locator('[data-naver-listing-card][data-complex="sinheung-sk-view"]')
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-listing-id")).sort());
  await page.goto("/");

  const homeComplexLinks = page.locator(".home-quick-nav__links--complex a");
  await expect(homeComplexLinks).toHaveCount(featured.length);
  for (const [index, complex] of featured.entries()) {
    await expect(homeComplexLinks.nth(index)).toHaveText(complex.name);
  }
  await expect(page.locator('a[href="/complexes/sinheung-sk-view/"]').first()).toBeVisible();
  await expect(page.getByText("단지 상세정보는 사진과 공식 자료 검수 후 공개합니다.", { exact: true })).toHaveCount(0);
  const sinheungHomeRow = page.locator('[aria-label="천동·신흥 주요 단지 기본정보 표"]')
    .getByRole("row")
    .filter({ hasText: sinheung.name });
  await expect(sinheungHomeRow).toContainText(homeFact(sinheung, ["입주", "사용승인"]));
  await expect(sinheungHomeRow).toContainText(homeFact(sinheung, ["전용면적", "전용면적 구간"]));

  await page.goto("/complexes/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(overview.title);
  await expect(page.locator(".complex-index-card")).toHaveCount(featured.length);
  await page.locator('a[href="/complexes/sinheung-sk-view/"]').click();
  await expect(page).toHaveURL(/\/complexes\/sinheung-sk-view\/$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(sinheung.name);
  await expect(page.getByRole("img", { name: sinheung.image.alt })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: `현재 등록된 ${sinheung.name} 매물 ${sinheungListingIds.length}건` })).toBeVisible();
  await expect(page.locator("[data-naver-listing-card]")).toHaveCount(Math.min(sinheungListingIds.length, 3));
  if (sinheungListingIds.length === 0) {
    await expect(page.getByRole("heading", { name: `현재 공개 목록에 ${sinheung.name} 매물이 없습니다` })).toBeVisible();
  }
  await expect(page.getByRole("heading", { level: 2, name: `${sinheung.name} 한눈에 보기` })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: `${sinheung.name} 핵심 포인트` })).toBeVisible();
  await expect(page.getByText("LIVING GUIDE", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "K-apt 공동주택관리정보시스템 원문 보기" })).toHaveAttribute("href", "https://www.k-apt.go.kr/kaptinfo/openKaptMng.do");
  const amenityPhotos = page.locator(".complex-amenity-gallery img");
  await expect(amenityPhotos).toHaveCount(3);
  await amenityPhotos.last().scrollIntoViewIfNeeded();
  await expect(page.getByRole("img", { name: "신흥 SK뷰 La VIEW Center 입구와 작은도서관·실내골프연습장 안내" })).toBeVisible();
  await expect.poll(async () => amenityPhotos.evaluateAll((images) => images.every((image) => image.naturalWidth > 0))).toBe(true);
  await expect(page.locator(".content-card")).toHaveCount(relatedCount);
  await expect(page.getByRole("link", { name: `${sinheung.name} 조건 상담` }).first()).toHaveAttribute("href", "#contact");
  await page.getByRole("link", { name: `${sinheung.name} 현재 매물 보기` }).click();
  await expect(page).toHaveURL(/\/properties\/\?complex=sinheung-sk-view$/u);
  await expect(page.locator("[data-listing-filter]").getByLabel("단지")).toHaveValue("sinheung-sk-view");
  await expect(page.locator("[data-naver-listing-card]:visible")).toHaveCount(sinheungListingIds.length);
  await expect(page.locator("[data-result-count]")).toHaveText(`네이버 등록 매물 ${sinheungListingIds.length}건`);
  expect(await page.locator("[data-naver-listing-card]:visible")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-listing-id")).sort())).toEqual(sinheungListingIds);

  await page.goto("/office/");
  await expect(page.getByText("리더스시티 4·5블록 · 신흥 SK뷰", { exact: true })).toBeVisible();

  for (const width of [360, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/complexes/", "/complexes/sinheung-sk-view/", "/properties/?complex=sinheung-sk-view", "/office/"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} ${width}px 가로 넘침`).toBeLessThanOrEqual(1);
    }
  }
  assertNoBrowserErrors();
});

test("미리 그리기 규칙은 관리자 화면에만 있고 공개 화면에는 없다", async ({ page }) => {
  for (const path of ["/", "/properties/", "/complexes/sinheung-sk-view/"]) {
    await page.goto(path);
    await expect(page.locator('script[type="speculationrules"]'), `${path} 공개 화면`).toHaveCount(0);
  }

  const assertNoBrowserErrors = failOnBrowserErrors(page);
  // 업무 도구 처음의 '오늘 할 일' 칸이 업무 세션을 묻는다(꺼짐으로 답해 할 일 목록은 부르지 않음).
  await page.route("**/api/admin/v1/work/session", (route) => route.fulfill({ status: 200, json: { ok: true, data: { enabled: false, filesEnabled: false, administrator: null, csrfToken: null, schemaVersion: null }, requestId: "test" } }));
  await page.goto("/admin/work/");
  await expect(page.locator("[data-tk-home-state]")).toHaveText("업무 도구가 켜지면 할 일을 볼 수 있습니다.");
  const rules = page.locator('script[type="speculationrules"]');
  await expect(rules).toHaveCount(1);
  const parsed = JSON.parse(await rules.textContent());
  const includes = (rule) => rule.where.and
    .filter((item) => item.href_matches || item.or)
    .flatMap((item) => (item.or ? item.or.map((choice) => choice.href_matches) : [item.href_matches]));
  const excludes = (rule) => rule.where.and.filter((item) => item.not).map((item) => item.not.href_matches ?? item.not.selector_matches);
  const prerenderPages = ["/admin/work/", "/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/"];
  expect(parsed.prerender.map(includes)).toEqual([prerenderPages]);
  expect(parsed.prefetch.map(includes)).toEqual([["/admin/*"]]);
  for (const rule of [...parsed.prerender, ...parsed.prefetch]) {
    expect(rule.eagerness).toBe("moderate");
    expect(excludes(rule)).toEqual(["/api/*", "/cdn-cgi/*", "/admin/listings/editor*", "[data-no-speculate], [download], [rel~=nofollow]"]);
  }

  // 브라우저의 주소 맞춤 규칙(URLPattern)으로, 나중에 생길 업무 도구 화면과 편집·인증 주소가 미리 그리기에 걸리지 않는지 확인한다.
  const matched = await page.evaluate((patterns) => {
    const urls = ["/admin/work/fee/", "/admin/work/fee/?from=menu", "/admin/work/fee", "/admin/work/customers/", "/admin/work/realprice/", "/admin/work/realprice/settings/", "/admin/listings/editor/", "/admin/listings/editor/?id=1", "/admin/listings/editor", "/cdn-cgi/access/logout", "/api/admin/v1/session"];
    const test = (pattern, url) => new URLPattern(pattern, location.href).test(new URL(url, location.href).href);
    return Object.fromEntries(urls.map((url) => [url, {
      prerender: patterns.prerender.some((pattern) => test(pattern, url)),
      excluded: patterns.excluded.some((pattern) => test(pattern, url)),
    }]));
  }, { prerender: prerenderPages, excluded: ["/api/*", "/cdn-cgi/*", "/admin/listings/editor*"] });
  expect(matched["/admin/work/fee/"].prerender).toBe(true);
  expect(matched["/admin/work/fee/?from=menu"].prerender).toBe(true);
  expect(matched["/admin/work/fee"].prerender, "뒤 빗금 없는 주소는 prerender하지 않음(prefetch만)").toBe(false);
  expect(matched["/admin/work/customers/"].prerender, "단계 2 화면은 목록에 넣기 전까지 prerender하지 않음").toBe(false);
  for (const url of ["/admin/work/realprice/", "/admin/work/realprice/settings/"]) {
    expect(matched[url].prerender, `${url} 서버를 부르는 단계 P 화면은 prerender하지 않음(prefetch만, TK-37)`).toBe(false);
  }
  for (const url of ["/admin/listings/editor/", "/admin/listings/editor/?id=1", "/admin/listings/editor", "/cdn-cgi/access/logout", "/api/admin/v1/session"]) {
    expect(matched[url].excluded, `${url} 두 규칙 모두에서 제외`).toBe(true);
  }
  assertNoBrowserErrors();
});

// 관리자 매물 목록의 '확인 완료'·'선택' 단추는 저장 연결(세션의 writeEnabled)이 켜져 있을 때만 켜진다.
// 이 화면에는 AdminWriteGate가 없으므로 화면 스크립트가 getAdminSession()을 직접 기다린다(세션 응답이 빨라도 놓치지 않음).
const listingReviewState = JSON.parse(readFileSync(new URL("../.github/listing-review-state.json", import.meta.url), "utf8"));
for (const writeEnabled of [true, false]) {
  test(`관리자 매물 목록의 확인 완료 단추는 저장 연결이 ${writeEnabled ? "켜져 있으면 켜진다" : "꺼져 있으면 꺼진 채로 둔다"}`, async ({ page }) => {
    const assertNoBrowserErrors = failOnBrowserErrors(page);
    const requests = { session: 0, content: 0 };
    await page.route("**/api/admin/v1/session", (route) => {
      requests.session += 1;
      return route.fulfill({ json: { ok: true, data: { authenticated: true, administrator: "시험 관리자", authentication: "시험", writeEnabled, csrfToken: writeEnabled ? "test-csrf" : null } } });
    });
    await page.route("**/api/admin/v1/content/listing-review-state", (route) => {
      requests.content += 1;
      return route.fulfill({ json: { ok: true, data: { resource: "listing-review-state", sha: "test-sha", data: listingReviewState } } });
    });
    await page.goto("/admin/listings/");
    const confirmButtons = page.locator("[data-listing-review-confirm]");
    const selectedButton = page.locator("[data-listing-review-selected]");
    expect(await confirmButtons.count(), "직접 등록 매물이 있어야 이 시험을 할 수 있음").toBeGreaterThan(0);
    if (writeEnabled) {
      await expect(confirmButtons.first()).toBeEnabled();
      await expect(page.locator("[data-listing-review-confirm]:disabled")).toHaveCount(0);
      await expect(page.locator("[data-listing-review-select]:disabled")).toHaveCount(0);
      await expect(selectedButton, "고른 매물이 0건이면 묶음 단추는 꺼져 있음").toBeDisabled();
      await page.locator("[data-listing-review-select]").first().check();
      await expect(selectedButton).toBeEnabled();
      await expect(selectedButton).toHaveText("선택 1건 확인 완료");
      expect(requests.content, "최신 재확인 상태를 한 번 불러옴").toBe(1);
    } else {
      await page.waitForLoadState("networkidle");
      await expect(page.locator("[data-listing-review-confirm]:enabled")).toHaveCount(0);
      await expect(page.locator("[data-listing-review-select]:enabled")).toHaveCount(0);
      await expect(selectedButton).toBeDisabled();
      expect(requests.content, "저장 연결이 꺼져 있으면 재확인 상태를 부르지 않음").toBe(0);
    }
    expect(requests.session, "화면이 저장 연결 상태를 한 번 물어봄").toBe(1);
    assertNoBrowserErrors();
  });
}

// 관리자 사진 올리기: 실제 크롬 canvas가 만든 WebP(ICCP 색 정보 조각이 들어감)를 정리하면 서버 검사를 통과해야 한다.
test("관리자 사진: 실제 크롬 canvas WebP에서 메타데이터 조각을 빼면 서버 검사를 통과한다", async ({ page }) => {
  await page.goto("/");
  for (const withAlpha of [false, true]) {
    const dataUrl = await page.evaluate((alpha) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 48;
      const context = canvas.getContext("2d");
      context.fillStyle = "#17344f";
      context.fillRect(0, 0, 64, 48);
      context.fillStyle = "#b85d68";
      context.fillRect(8, 8, 32, 24);
      if (alpha) context.clearRect(40, 0, 24, 48);
      return canvas.toDataURL("image/webp", 0.82);
    }, withAlpha);
    expect(dataUrl.startsWith("data:image/webp;base64,"), "크롬이 WebP를 만듦").toBe(true);
    const cleaned = new Uint8Array(Buffer.from(stripWebpMetadataFromDataUrl(dataUrl).split(",")[1], "base64"));
    expect(validateWebpBytes(cleaned), withAlpha ? "알파 있는 그림" : "알파 없는 그림").toEqual({ width: 64, height: 48 });
  }
});

// 관리 화면 '이 화면 사용법' 상자와 '사용 안내'(보드 62번, 사용자 결정 2026-11-19 13:34:39·14:03:46). 휴대폰(갤럭시) 폭에서 먼저 본다.
test("관리 화면 사용법 상자는 접혀 있다가 열리고, 자세한 안내의 같은 화면 칸으로 간다", async ({ page }) => {
  const assertNoBrowserErrors = failOnBrowserErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/work/fee/");
  const box = page.locator("details.admin-page-help");
  await expect(box).toHaveCount(1);
  await expect(box).not.toHaveAttribute("open", /.*/u);
  const summary = box.locator("summary");
  await expect(summary).toHaveText("이 화면 사용법");
  const summaryBox = await summary.boundingBox();
  expect(summaryBox.height, "누름 영역 44px 이상").toBeGreaterThanOrEqual(44);
  await expect(box.locator("ol > li").first()).toBeHidden();

  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(box).toHaveAttribute("open", "");
  const focus = await summary.evaluate((element) => {
    const style = getComputedStyle(element);
    const width = Number.parseFloat(style.outlineWidth) + Math.max(0, Number.parseFloat(style.outlineOffset));
    const rect = element.getBoundingClientRect();
    const clipped = [];
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      if (parentStyle.overflowX === "visible" && parentStyle.overflowY === "visible") continue;
      const outer = parent.getBoundingClientRect();
      if (rect.left - width < outer.left || rect.right + width > outer.right || rect.top - width < outer.top) clipped.push(parent.className);
    }
    return { outline: style.outlineStyle, width, clipped, inViewport: rect.left - width >= 0 && rect.right + width <= window.innerWidth };
  });
  expect(focus.outline, "키보드 포커스 테두리").toBe("solid");
  expect(focus.clipped, "포커스 테두리를 자르는 칸 없음").toEqual([]);
  expect(focus.inViewport, "포커스 테두리가 화면 안").toBe(true);

  const steps = box.locator("ol > li");
  expect(await steps.count()).toBeGreaterThanOrEqual(3);
  await expect(steps.first()).toBeVisible();
  const texts = await box.locator("li, .admin-page-help__caution, .admin-page-help__more").evaluateAll((elements) => elements.map((element) => {
    const style = getComputedStyle(element);
    return { size: Number.parseFloat(style.fontSize), color: style.color };
  }));
  for (const text of texts) {
    expect(text.size, "글자 16px 이상").toBeGreaterThanOrEqual(16);
    expect(["rgb(31, 35, 41)", "rgb(35, 42, 51)"], "회색이 아닌 본문색·제목색(관리자 새 겉모양 2026-11-23)").toContain(text.color);
  }
  const more = box.locator(".admin-page-help__more");
  await expect(more).toHaveAttribute("href", "/admin/help/#work-fee");
  expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(page).toHaveURL(/\/admin\/help\/#work-fee$/u);
  await expect(page.locator("#work-fee h3")).toHaveText("중개보수 계산");
  await expect(page.locator("#work-fee")).toBeInViewport();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,nofollow,noarchive");
  await expect(page.locator('.admin-menu a[href="/admin/help/"]').first()).toHaveAttribute("aria-current", "page");
  // 2026-11-24 "B 단계 그림 줄": 그림은 단계 그림 칸 안에만, 관리자 그림 폴더에서만 온다.
  await expect(page.locator("#admin-main img:not(.admin-help-figure img)"), "단계 그림 밖에는 사진 없음").toHaveCount(0);
  for (const src of await page.locator("#admin-main .admin-help-figure img").evaluateAll((images) => images.map((image) => image.getAttribute("src")))) {
    expect(src).toMatch(/^\/admin\/help\/img\/[a-z0-9-]+\.webp$/u);
  }
  assertNoBrowserErrors();
});

test("사용 안내 단계 그림: 390px은 휴대폰 그림만, 1280px은 넓은 화면 그림만 받아 모두 뜨고, 번호는 그림 아래 글과 같은 수다", async ({ page }) => {
  await page.route("**/api/admin/**", (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: "TEST_OFFLINE", message: "시험 중에는 관리 API를 부르지 않습니다." } } }));
  for (const [width, shown, hidden] of [[390, "phone", "wide"], [1280, "wide", "phone"]]) {
    await page.setViewportSize({ width, height: 900 });
    const requested = [];
    const listener = (request) => { if (request.url().includes("/admin/help/img/")) requested.push(new URL(request.url()).pathname); };
    page.on("request", listener);
    await page.goto("/admin/help/");
    const figures = page.locator(".admin-help-figure");
    expect(await figures.count(), "단계 그림 11칸(2026-11-24 먼저 3곳, 같은 날 14:13:32 계약서 AI 등 8칸 더함)").toBe(11);
    for (const figure of await figures.all()) {
      await expect(figure.locator(`.admin-help-figure__frames--${hidden}`)).toBeHidden();
      const frames = figure.locator(`.admin-help-figure__frames--${shown} > li`);
      for (const frame of await frames.all()) {
        const image = frame.locator("img");
        await image.scrollIntoViewIfNeeded();
        await expect.poll(() => image.evaluate((node) => node.complete && node.naturalWidth > 0), { message: `${width}px 그림이 뜸` }).toBe(true);
        expect(await image.getAttribute("alt")).toBeTruthy();
        const pins = frame.locator(".admin-help-figure__pin");
        await expect(pins).toHaveCount(await frame.locator(".admin-help-figure__pins > li").count());
        const box = await image.boundingBox();
        for (const pin of await pins.all()) {
          const at = await pin.boundingBox();
          expect(at.x >= box.x - 1 && at.x + at.width <= box.x + box.width + 1, `${width}px 번호가 그림 가로 안`).toBe(true);
        }
      }
    }
    page.off("request", listener);
    expect(requested.length, `${width}px 받은 그림`).toBeGreaterThan(0);
    expect(requested.every((path) => path.includes(`-${shown}-`)), `${width}px 숨은 쪽 그림을 받지 않음: ${requested.join(" ")}`).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px 가로 넘침`).toBeLessThanOrEqual(1);
  }
});

// 화면 목록은 사용법 문구 한 곳(admin-help.mjs ADMIN_PAGE_HELP)에서 센다. 관리 화면마다 항목이 하나씩 있는지는 tests/admin-help.test.mjs가 화면 원본과 대조한다.
const HELP_PAGE_PATHS = Object.keys(ADMIN_PAGE_HELP);

test(`관리 화면 ${HELP_PAGE_PATHS.length}곳과 사용 안내는 사용법 상자를 연 채로 360·390·768·1280px에서 가로로 넘치지 않는다`, async ({ page }) => {
  await page.route("**/api/admin/**", (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: "TEST_OFFLINE", message: "시험 중에는 관리 API를 부르지 않습니다." } } }));
  const paths = [...HELP_PAGE_PATHS, "/admin/help/"];
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of paths) {
      await page.goto(path);
      const boxes = await page.evaluate(() => {
        const list = [...document.querySelectorAll("details.admin-page-help")];
        list.forEach((details) => { details.open = true; });
        return list.length;
      });
      expect(boxes, `${path}: 상자 수`).toBe(path === "/admin/help/" ? 0 : 1);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${path} ${width}px 가로 넘침`).toBeLessThanOrEqual(1);
    }
  }
});

test("사용 안내는 사이트맵·llms.txt에 나오지 않는다", async ({ request }) => {
  for (const path of ["/llms.txt", "/sitemap-index.xml", "/sitemap-0.xml"]) {
    const response = await request.get(path);
    if (response.status() === 404) continue;
    expect(await response.text(), path).not.toContain("/admin/");
  }
});
