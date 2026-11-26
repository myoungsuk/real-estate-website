// 홍보 그림 '카톡·문자로 보내기'·'그림 복사'(2026-11-25, 중개날개 대조표 16절 4위)를 화면마다 본다.
// 공유(navigator.canShare·share)와 그림 복사(navigator.clipboard.write·ClipboardItem)는 가짜로 바꿔, 되는 브라우저·안 되는 브라우저를 나눠 본다.
// 단지 이름·소재지는 지어낸 값이고, 서버 요청은 각 화면의 가짜 업무 API만 받는다.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";
import { LOCATION, draftOf, listing, setup as setupBlog } from "./support/blog-mock.mjs";
import { fillApartment, saleApartments, setup as setupListingPaper, SHORT_OF } from "./support/listing-paper-mock.mjs";
import { envelope, firstPage, idsOf, promoAnswer, promoItems, setup as setupRealprice, trade, withProductionCsp } from "./support/realprice-mock.mjs";

const PAPER = "/admin/work/paper/";
const PAPER_NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00

// 되는 브라우저: canShare는 PNG 파일만 받고, share·clipboard.write는 받은 파일·그림을 적어 둔다. window.__shareError에 이름을 넣으면 그 DOMException을 던진다.
async function fakeShare(page, { share = true, copy = true } = {}) {
  await page.addInitScript(({ share, copy }) => {
    window.__sharedFiles = [];
    window.__copiedImages = [];
    window.__shareError = "";
    if (share) {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => Array.isArray(data?.files) && data.files.length > 0 && data.files.every((file) => file.type === "image/png") });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: async (data) => {
          if (window.__shareError) throw new DOMException("시험", window.__shareError);
          window.__sharedFiles.push(data.files.map((file) => [file.name, file.type, file.size]));
        },
      });
    } else {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    }
    if (copy) {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async () => undefined,
          write: async (items) => {
            for (const item of items) {
              const blob = await item.getType("image/png");
              const head = [...new Uint8Array(await blob.slice(0, 4).arrayBuffer())];
              window.__copiedImages.push([item.types.join(","), blob.type, blob.size, head]);
            }
          },
        },
      });
    } else {
      Object.defineProperty(window, "ClipboardItem", { configurable: true, value: undefined });
    }
  }, { share, copy });
}
const sharedFiles = (page) => page.evaluate(() => window.__sharedFiles);
const copiedImages = (page) => page.evaluate(() => window.__copiedImages);
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47];

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}

async function setupPaper(page, width) {
  const apiCalls = [];
  await page.clock.setFixedTime(PAPER_NOW);
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "TEST_OFFLINE" } }) });
  });
  return apiCalls;
}

const heights = (locator) => locator.evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().height)));
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stored = (page) => page.evaluate(() => [localStorage.length, sessionStorage.length]);

test("홍보 종이 390px(되는 브라우저): 그림을 만들면 '카톡·문자로 보내기'·'그림 복사'가 보이고, 누르면 같은 이름 PNG 하나를 보내거나 복사, 닫기는 알리지 않음, 칸을 바꾸면 숨음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const apiCalls = await setupPaper(page, 390);
  await fakeShare(page);
  await page.goto(PAPER);
  const share = page.locator("[data-done-share]");
  const copy = page.locator("[data-done-copy]");
  const status = page.locator("[data-done-status]");
  await expect(share, "그림 전에는 숨김").toBeHidden();
  await expect(copy).toBeHidden();

  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("84.97");
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(page.locator("[data-done-download]")).toBeVisible();
  await expect(share).toBeVisible();
  await expect(share).toHaveText("카톡·문자로 보내기");
  await expect(copy).toHaveText("그림 복사");
  for (const height of await heights(page.locator("[data-done-share], [data-done-copy]"))) expect(height, "390px 누르는 곳 44px 이상").toBeGreaterThanOrEqual(44);

  await share.click();
  await expect(status).toHaveText("✓ 그림을 공유 창으로 보냈습니다.");
  await expect(share).toHaveText("✓ 보냄");
  const sent = await sharedFiles(page);
  expect(sent, "공유 1번, 파일 1개").toHaveLength(1);
  expect(sent[0]).toHaveLength(1);
  expect(sent[0][0].slice(0, 2), "저장 단추와 같은 이름(날짜만)").toEqual(["deal-done-20261120.png", "image/png"]);
  expect(sent[0][0][2]).toBeGreaterThan(1000);

  await copy.click();
  await expect(status).toHaveText("✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");
  await expect(copy).toHaveText("✓ 복사함");
  const copied = await copiedImages(page);
  expect(copied).toHaveLength(1);
  expect(copied[0].slice(0, 2)).toEqual(["image/png", "image/png"]);
  expect(copied[0][3], "PNG 그대로").toEqual(PNG_HEAD);

  // 공유 창을 닫으면(AbortError) 알리지 않고, 막히면(NotAllowedError) 한 번 더 누르라고 알린다.
  await status.evaluate((element) => { element.textContent = ""; });
  await page.evaluate(() => { window.__shareError = "AbortError"; });
  await share.click();
  await expect(status).toHaveText("");
  await page.evaluate(() => { window.__shareError = "NotAllowedError"; });
  await share.click();
  await expect(status).toHaveText("공유 창을 열지 못했습니다. '카톡·문자로 보내기'를 한 번 더 눌러 주세요.");
  await page.evaluate(() => { window.__shareError = ""; });

  // 키보드로도 누른다.
  await share.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await sharedFiles(page)).length).toBe(2);

  // 칸을 바꾸면 저장 단추와 함께 숨고, 다시 만들면 글이 처음으로 돌아온다.
  await page.getByLabel("전용면적(㎡)").fill("59.9");
  await expect(page.locator("[data-done-download]")).toBeHidden();
  await expect(share).toBeHidden();
  await expect(copy).toBeHidden();
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(share).toHaveText("카톡·문자로 보내기");
  await expect(copy).toHaveText("그림 복사");

  // 대표 소개 그림도 같다.
  const intro = page.locator("[data-intro-tool]");
  await expect(intro.locator("[data-intro-share]")).toBeHidden();
  await intro.getByRole("button", { name: "소개 그림 만들기" }).click();
  await expect(intro.locator("[data-intro-preview]")).toBeVisible();
  await intro.getByRole("button", { name: "카톡·문자로 보내기" }).click();
  await expect(intro.locator("[data-intro-status]")).toHaveText("✓ 그림을 공유 창으로 보냈습니다.");
  expect((await sharedFiles(page)).at(-1).map((file) => file[0])).toEqual(["intro-20261120.png"]);
  await intro.getByRole("button", { name: "그림 복사" }).click();
  await expect(intro.locator("[data-intro-status]")).toHaveText("✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");

  expect(page.url(), "주소에 그림·입력값을 넣지 않음").toMatch(/\/admin\/work\/paper\/$/u);
  expect(await stored(page), "브라우저 저장소에 넣지 않음").toEqual([0, 0]);
  expect(apiCalls, "그림을 서버로 보내지 않음").toEqual([]);
  assertNoErrors();
});

test("홍보 종이 1280px(공유·복사가 안 되는 브라우저): 그림 저장은 그대로, '카톡·문자로 보내기'·'그림 복사'는 숨김", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setupPaper(page, 1280);
  await fakeShare(page, { share: false, copy: false });
  await page.goto(PAPER);
  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("84.97");
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(page.locator("[data-done-download]")).toBeVisible();
  await expect(page.locator("[data-done-share]")).toBeHidden();
  await expect(page.locator("[data-done-copy]")).toBeHidden();
  await page.locator("[data-intro-tool]").getByRole("button", { name: "소개 그림 만들기" }).click();
  await expect(page.locator("[data-intro-download]")).toBeVisible();
  await expect(page.locator("[data-intro-share]")).toBeHidden();
  await expect(page.locator("[data-intro-copy]")).toBeHidden();
  assertNoErrors();
});

test("매물 안내지 390px: 명시사항이 비면 그림·저장·보내기·복사 모두 없고, 다 채우면 보내기 1번(listing-YYYYMMDD.png), 1280px 마우스는 누르는 곳 36px", async ({ page }) => {
  test.skip(saleApartments.length < 1, SHORT_OF("층 숫자가 있는 매매 아파트", 1));
  const assertNoErrors = collectErrors(page);
  const { apiCalls } = await setupListingPaper(page, 390);
  await fakeShare(page);
  await page.goto("/admin/work/listing-paper/");
  const first = saleApartments[0];
  await page.locator("#lp-query").fill(first.title);
  await page.locator(`[data-lp-pick='${first.id}']`).click();
  const make = page.locator("[data-lp-make]");
  const share = page.locator("[data-lp-share]");
  const copy = page.locator("[data-lp-copy]");
  await make.click();
  await expect(page.locator("[data-lp-status]")).toContainText("빈 칸이 있으면 만들 수 없습니다.");
  await expect(page.locator("[data-lp-download]")).toBeHidden();
  await expect(share, "명시사항이 비면 보내기도 막음").toBeHidden();
  await expect(copy).toBeHidden();

  await fillApartment(page, first.id);
  await make.click();
  await expect(page.locator("[data-lp-status]")).toHaveText(/^✓ 그림을 만들었습니다/u);
  await expect(share).toBeVisible();
  await share.click();
  await expect(page.locator("[data-lp-status]")).toHaveText("✓ 그림을 공유 창으로 보냈습니다.");
  expect(await sharedFiles(page)).toEqual([[["listing-20261120.png", "image/png", expect.any(Number)]]]);
  await copy.click();
  await expect(page.locator("[data-lp-status]")).toHaveText("✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");

  // 명시사항 칸을 비우면 셋 다 거둔다.
  await page.locator(`[data-lp-form='${first.id}'] [data-bl-row='location'] input`).fill("");
  await expect(share).toBeHidden();
  await expect(copy).toBeHidden();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator(`[data-lp-form='${first.id}'] [data-bl-row='location'] input`).fill("대전광역시 동구 가상동 100");
  await make.click();
  await expect(share).toBeVisible();
  for (const height of await heights(page.locator("[data-lp-share], [data-lp-copy]"))) expect(height, "1280px 마우스 누르는 곳 36px 이상").toBeGreaterThanOrEqual(36);
  expect(apiCalls).toEqual([]);
  expect(await stored(page)).toEqual([0, 0]);
  assertNoErrors();
});

test("실거래가 홍보물 390px: 한 장은 보내기·'그림 복사', 5건 두 장은 '카톡·문자로 보내기(2장)'가 두 파일을 한 번에, 장마다 복사, 모양을 바꾸면 ✓ 표시가 지워짐", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const violations = await withProductionCsp(page);
  const many = [...promoItems, trade(4), trade(6)];
  let answer = promoAnswer();
  await setupRealprice(page, { width: 390, trades: () => answer });
  await fakeShare(page);
  await page.goto(`/admin/work/realprice/promo/?ids=${idsOf(promoItems)}`);
  await expect(page.locator("[data-promo-download]")).toHaveText("그림 저장");
  const row = page.locator("[data-promo-share]");
  await expect(row.locator("button")).toHaveText(["카톡·문자로 보내기", "그림 복사"]);
  for (const height of await heights(row.locator("button"))) expect(height).toBeGreaterThanOrEqual(44);
  await row.getByRole("button", { name: "카톡·문자로 보내기" }).click();
  await expect(page.locator("[data-promo-status]")).toHaveText("✓ 그림을 공유 창으로 보냈습니다.");
  expect(await sharedFiles(page)).toEqual([[["realprice-20261119.png", "image/png", expect.any(Number)]]]);
  await row.getByRole("button", { name: "그림 복사" }).click();
  await expect(page.locator("[data-promo-status]")).toHaveText("✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");
  await expect(row.locator("button").nth(1)).toHaveText("✓ 복사함");
  await page.getByRole("radio", { name: "다크", exact: true }).check();
  await expect(row.locator("button"), "새 그림이라 표시가 처음으로").toHaveText(["카톡·문자로 보내기", "그림 복사"]);
  expect(await page.evaluate(() => (window.__copiedImages.at(-1) ?? [])[3])).toEqual(PNG_HEAD);

  answer = promoAnswer({ items: many });
  await page.goto(`/admin/work/realprice/promo/?ids=${idsOf(many)}`);
  await expect(page.locator("[data-promo-download]")).toHaveText(["1장 저장", "2장 저장"]);
  await expect(row.locator("button")).toHaveText(["카톡·문자로 보내기(2장)", "1장 복사", "2장 복사"]);
  await row.getByRole("button", { name: "카톡·문자로 보내기(2장)" }).click();
  await expect(page.locator("[data-promo-status]")).toHaveText("✓ 그림 2장을 공유 창으로 보냈습니다.");
  expect((await sharedFiles(page)).map((files) => files.map((file) => file[0])), "공유 창 하나로 두 장").toEqual([["realprice-20261119-1.png", "realprice-20261119-2.png"]]);
  await row.getByRole("button", { name: "2장 복사" }).click();
  await expect(page.locator("[data-promo-status]")).toHaveText("✓ 2번째 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");
  await expect(row.getByRole("button", { name: "✓ 2장 복사함" })).toBeVisible();
  expect(await stored(page)).toEqual([0, 0]);
  expect(violations, "운영 CSP 위반 0").toEqual([]);
  assertNoErrors();
});

test("실거래가 홍보물: 받은 시각을 몰라 만들지 못하면 보내기·복사도 없고, 안 되는 브라우저는 저장만 보인다", async ({ browser }) => {
  const blockedPage = await browser.newPage();
  const assertBlocked = collectErrors(blockedPage);
  await setupRealprice(blockedPage, { width: 390, trades: () => promoAnswer({ receivedAt: null }) });
  await fakeShare(blockedPage);
  await blockedPage.goto(`/admin/work/realprice/promo/?ids=${idsOf(promoItems)}`);
  await expect(blockedPage.locator("[data-promo-state-title]")).toHaveText("홍보물을 만들 수 없습니다");
  await expect(blockedPage.locator("[data-promo-download]")).toHaveCount(0);
  await expect(blockedPage.locator("[data-promo-share] button")).toHaveCount(0);
  assertBlocked();
  await blockedPage.close();

  const plainPage = await browser.newPage();
  const assertPlain = collectErrors(plainPage);
  await setupRealprice(plainPage, { width: 390, trades: () => promoAnswer() });
  await fakeShare(plainPage, { share: false, copy: false });
  await plainPage.goto(`/admin/work/realprice/promo/?ids=${idsOf(promoItems)}`);
  await expect(plainPage.locator("[data-promo-download]")).toHaveText("그림 저장");
  await expect(plainPage.locator("[data-promo-share] button")).toHaveCount(0);
  await expect(plainPage.locator("[data-promo-share]")).toBeHidden();
  assertPlain();
  await plainPage.close();
});

test("실거래가 미리보기 칸 1280px: 담으면 저장 단추 아래 보내기·복사(36px 이상), 보내기 1번, 받은 시각을 모르면 칸째 숨김", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let receivedAt = "2026-11-19T03:10:00Z";
  const trades = (params) => {
    const ids = params.get("ids");
    if (!ids) return envelope({ items: firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] });
    const picked = ids.split(",").map((id) => firstPage.find((item) => item.tradeKey === id)).filter(Boolean);
    return envelope({ items: picked, missing: [], receivedAt, recordHighReady: true, warnings: [] });
  };
  await setupRealprice(page, { width: 1280, trades });
  await fakeShare(page);
  await page.goto("/admin/work/realprice/");
  const panel = page.getByRole("complementary", { name: /미리보기/u });
  await page.locator("[data-rt-rows] > tr").nth(0).getByRole("checkbox").check();
  await expect(panel.locator("[data-rt-preview-download]")).toHaveText("그림 저장");
  const row = panel.locator("[data-rt-preview-share]");
  await expect(row.locator("button")).toHaveText(["카톡·문자로 보내기", "그림 복사"]);
  for (const height of await heights(row.locator("button"))) expect(height).toBeGreaterThanOrEqual(36);
  await row.getByRole("button", { name: "카톡·문자로 보내기" }).click();
  await expect(panel.locator("[data-rt-preview-status]")).toHaveText("✓ 그림을 공유 창으로 보냈습니다.");
  expect(await sharedFiles(page)).toEqual([[["realprice-20261119.png", "image/png", expect.any(Number)]]]);
  await row.getByRole("button", { name: "그림 복사" }).click();
  await expect(panel.locator("[data-rt-preview-status]")).toHaveText("✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");

  receivedAt = null;
  await page.locator("[data-rt-rows] > tr").nth(1).getByRole("checkbox").check();
  await expect(panel.locator("[data-rt-preview-blocked]")).toBeVisible();
  await expect(row.locator("button"), "만들지 못하면 보내기·복사도 없음").toHaveCount(0);
  await expect(row).toBeHidden();
  assertNoErrors();
});

test("글 초안 카드 그림 390px: 단지 3장은 '카톡·문자로 보내기(3장)' 한 번에 세 파일·장마다 복사, 매물 표지는 소재지(명시사항)를 넣기 전에는 보내기·복사 없음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const realComplexes = JSON.parse(readFileSync(new URL("../src/data/complexes.json", import.meta.url), "utf8"));
  const rules = JSON.parse(readFileSync(new URL("../src/data/work/ad-disclosure-rules.json", import.meta.url), "utf8"));
  const sinheung = listBlogSources({ rules, listings: [], naverListings: { items: [] }, complexes: realComplexes }).find((source) => source.id === "sinheung-sk-view");
  const complexDone = { ...draftOf(sinheung, { needsLocation: false, result: { title: "신흥 SK뷰 1편 제목", paragraphs: ["첫 문단입니다."], headings: ["단지 개요"], checklist: ["주차 동선 확인"], hashtags: ["신흥동"], snsShort: "신흥 SK뷰", factsUsed: ["규모"] } }), id: "zz-draft-complex" };
  const listingDone = { ...draftOf(listing, { result: { title: "가상숲1단지 매매", paragraphs: ["가상숲1단지 매물입니다."], hashtags: ["천동"], snsShort: "가상숲1단지", factsUsed: [] } }), id: "zz-draft-listing" };
  await setupBlog(page, { width: 390, drafts: [complexDone, listingDone] });
  await fakeShare(page);
  const open = async (title) => {
    await page.goto("/admin/work/blog/");
    await page.locator("[data-bl-drafts-summary]").click();
    await page.getByRole("button", { name: `${title} 열기` }).click();
    await expect(page.locator("[data-bl-result]")).toBeVisible();
  };
  await open("신흥 SK뷰 1편 제목");
  const panel = page.locator("[data-bl-cardset]");
  await expect(panel.locator("[data-bl-cardset-list] img")).toHaveCount(3);
  const row = panel.locator("[data-bl-cardset-share]");
  await expect(row.locator("button")).toHaveText(["카톡·문자로 보내기(3장)", "1장 복사", "2장 복사", "3장 복사"]);
  for (const height of await heights(row.locator("button"))) expect(height).toBeGreaterThanOrEqual(44);
  await row.getByRole("button", { name: "카톡·문자로 보내기(3장)" }).click();
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("✓ 그림 3장을 공유 창으로 보냈습니다.");
  const names = await panel.locator("[data-bl-cardset-link]").evaluateAll((links) => links.map((link) => link.download));
  expect((await sharedFiles(page)).map((files) => files.map((file) => file[0])), "저장 단추와 같은 파일 이름").toEqual([names]);
  await row.getByRole("button", { name: "3장 복사" }).click();
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("✓ 3번째 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.");
  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);

  await open("가상숲1단지 매매");
  await expect(panel.locator("[data-bl-cardset-list] img"), "소재지 전에는 표지 없음").toHaveCount(0);
  await expect(row.locator("button")).toHaveCount(0);
  await page.locator("#bl-reloc").fill(LOCATION);
  await expect(panel.locator("[data-bl-cardset-list] img")).toHaveCount(1);
  await expect(row.locator("button")).toHaveText(["카톡·문자로 보내기", "그림 복사"]);
  await row.getByRole("button", { name: "카톡·문자로 보내기" }).click();
  expect((await sharedFiles(page)).at(-1).map((file) => file[0])).toEqual(["2026-11-20-매물표지.png"]);
  await page.locator("#bl-reloc").fill("");
  await expect(row.locator("button"), "소재지를 지우면 다시 없음").toHaveCount(0);
  assertNoErrors();
});
