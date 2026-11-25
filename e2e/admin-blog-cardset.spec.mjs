// 글 초안 3편 같이 만들기와 카드 그림 판 2(방향 A·모양 4가지·AI 배경 그림)를 가짜 업무 API로 본다.
// 2026-11-25 사용자 결정 1 ~ 9(판 1·판 2 "전부 추천대로"). 단지 숫자는 빌드 때 실은 공개 단지 자료, 그림은 sharp로 만든 가짜 JPEG이고 OpenAI는 부르지 않는다.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";
import {
  NOW, rules, savedLimits, draftOf, setup, collectErrors, overflowOf, step, complex, listing, LOCATION,
  SET_IDS, setDraftOf, fakeBackgroundImages, backgroundsResult,
} from "./support/blog-mock.mjs";

const realComplexes = JSON.parse(readFileSync(new URL("../src/data/complexes.json", import.meta.url), "utf8"));
const sinheung = listBlogSources({ rules, listings: [], naverListings: { items: [] }, complexes: realComplexes }).find((source) => source.id === "sinheung-sk-view");
const resultOf = (n) => ({
  title: `신흥 SK뷰 ${n}편 제목`,
  paragraphs: [`${n}편 첫 문단입니다. 신흥 SK뷰는 12개동 1,588세대 단지입니다.`],
  headings: ["단지 개요"],
  checklist: ["주차 동선 확인"],
  hashtags: ["신흥동"],
  snsShort: "신흥 SK뷰 1,588세대",
  factsUsed: ["규모"],
});
const stored = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
const cardImages = (page) => page.locator("[data-bl-cardset-list] img");

async function openThroughList(page, title) {
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: `${title} 열기` }).click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();
}

test("TK-212 글 초안 3편 390px: 처음 3편으로 보내고, 기다리는 동안 편마다 상태를 보인 뒤 먼저 끝난 편을 열며, 나머지 편은 탭에서 끝나는 대로 열린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const at = { createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), needsLocation: false };
  const queued = SET_IDS.map((_, index) => setDraftOf(complex, index + 1, { status: "queued", ...at }));
  const calls = await setup(page, {
    create: () => ({ draft: queued[0], drafts: queued }),
    draftReads: {
      [SET_IDS[0]]: (n) => (n < 2 ? { ...queued[0], status: "in_progress" } : { ...queued[0], status: "completed", result: resultOf(1) }),
      [SET_IDS[1]]: () => ({ ...queued[1], status: "completed", result: resultOf(2) }),
      [SET_IDS[2]]: (n) => (n < 2 ? { ...queued[2], status: "in_progress" } : { ...queued[2], status: "failed", errorCode: "AI_UPSTREAM_FAILED" }),
    },
  });
  await page.goto("/admin/work/blog/");
  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(step(page, 3)).toHaveClass(/bl-step--open/u);
  await expect(page.locator("input[name='bl-count'][value='3']")).toBeChecked();
  await expect(page.locator("[data-bl-make-note]")).toContainText("한도 3편 몫을 씁니다 · 오늘 남은 8편");
  expect(await overflowOf(page), "3단계 390px").toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "글 초안 만들기" }).click();
  expect(calls.creates).toEqual([{ source: { type: "complex", id: "zz-forest" }, style: "plain", inputs: {}, emphasis: "", count: 3 }]);

  const progress = page.locator("[data-bl-set-progress]");
  await expect(progress).toBeVisible();
  await expect(progress.locator("li")).toHaveText(["1편 만드는 중", "2편 만드는 중", "3편 만드는 중"]);
  await page.clock.runFor(5_000);
  // 2편이 먼저 끝나 결과로 넘어가고, 탭은 1편·3편 만드는 중(누를 수 없음)·2편 보는 중.
  await expect(page.locator("#bl-title")).toHaveValue("신흥 SK뷰 2편 제목");
  const tabs = page.locator("[data-bl-set-list] button");
  await expect(tabs).toHaveText(["1편만드는 중", "2편보는 중", "3편만드는 중"]);
  await expect(tabs.nth(0)).toBeDisabled();
  await expect(tabs.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-bl-set-line]")).toHaveText("· 3편 중 1편 다 됨 · 2편 만드는 중");
  expect(await overflowOf(page), "결과 390px").toBeLessThanOrEqual(0);

  await page.clock.runFor(5_000);
  await expect(tabs).toHaveText(["1편열기", "2편보는 중", "3편못 만듦"]);
  await expect(tabs.nth(2)).toBeDisabled();
  await tabs.nth(0).click();
  await expect(page.locator("#bl-title")).toHaveValue("신흥 SK뷰 1편 제목");
  await expect(tabs.nth(0)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-bl-set-tabs]")).toContainText("고르지 않은 편은 '보관 중인 초안'에 남습니다.");
  expect((await stored(page)).includes("신흥 SK뷰 1편"), "글은 브라우저 저장소·주소에 없음").toBe(false);
  assertNoErrors();
});

test("TK-213 글 초안 3편: 보관 목록에 '3편 중 n편'을 붙이고, 만드는 중 취소는 열린 편을 모두 닫으며, 1편 초안은 탭을 보이지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const at = { createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), needsLocation: false };
  const one = setDraftOf(sinheung, 1, { status: "completed", result: resultOf(1), ...at });
  const two = setDraftOf(sinheung, 2, { status: "in_progress", ...at });
  const three = setDraftOf(sinheung, 3, { status: "queued", ...at });
  const single = draftOf(sinheung, { id: "zz-single", result: resultOf(9), needsLocation: false });
  const calls = await setup(page, { width: 360, drafts: [one, two, three, single] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await expect(page.locator("[data-bl-drafts] li span").first()).toContainText("3편 중 1편 · ");
  await page.getByRole("button", { name: "신흥 SK뷰 1편 제목 열기" }).click();
  await expect(page.locator("[data-bl-set-list] button")).toHaveText(["1편보는 중", "2편만드는 중", "3편만드는 중"]);
  expect(await overflowOf(page), "탭 360px").toBeLessThanOrEqual(0);

  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "신흥 SK뷰 9편 제목 열기" }).click();
  await expect(page.locator("#bl-title")).toHaveValue("신흥 SK뷰 9편 제목");
  await expect(page.locator("[data-bl-set-tabs]"), "1편 초안은 탭 없음").toBeHidden();

  // 만드는 중인 편을 열면 기다림 화면이고, 취소는 열린 두 편을 모두 닫는다(끝난 1편은 건드리지 않음).
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "신흥 SK뷰 열기", exact: true }).first().click();
  await expect(page.locator("[data-bl-wait]")).toBeVisible();
  await expect(page.locator("[data-bl-set-progress] li")).toHaveText(["1편 다 됨", "2편 만드는 중", "3편 만드는 중"]);
  await page.locator("[data-bl-cancel]").click();
  await expect.poll(() => calls.closes).toEqual([`${SET_IDS[1]}:cancel`, `${SET_IDS[2]}:cancel`]);
  assertNoErrors();
});

test("TK-214 카드 그림 판 2 1280px: 처음은 기본 모양·단지 사진, 모양 4가지(홍보물과 같은 이름)를 고르면 다시 그리고, 서버 요청은 늘지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const done = draftOf(sinheung, { result: resultOf(1), needsLocation: false });
  const calls = await setup(page, { width: 1280, drafts: [done] });
  await openThroughList(page, "신흥 SK뷰 1편 제목");
  const panel = page.locator("[data-bl-cardset]");
  await expect(panel.locator("h3")).toContainText("AI 그림은 표지 사진 자리에만");
  await expect(cardImages(page)).toHaveCount(3);
  const looks = panel.locator(".bl-cardopts fieldset").first().locator(".work-choice");
  await expect(looks).toHaveText(["기본", "깔끔 카드", "잡지", "다크"]);
  await expect(panel.getByRole("radio", { name: "기본" })).toBeChecked();
  await expect(panel.getByRole("radio", { name: "단지 사진" })).toBeChecked();
  await expect(panel.locator(".bl-bg"), "AI 배경 칸은 고를 때만").toBeHidden();
  const before = calls.requests.length;
  const sources = [await cardImages(page).nth(0).getAttribute("src")];
  for (const name of ["깔끔 카드", "잡지", "다크"]) {
    await panel.getByRole("radio", { name }).check();
    await expect.poll(async () => cardImages(page).nth(0).getAttribute("src"), `${name} 모양으로 다시 그림`).not.toBe(sources.at(-1));
    sources.push(await cardImages(page).nth(0).getAttribute("src"));
  }
  expect(new Set(sources).size, "모양 4가지가 모두 다른 그림").toBe(4);
  await expect(cardImages(page).nth(0)).toHaveAttribute("alt", "카드 그림 1/3장: 표지");
  expect(calls.requests.length, "모양을 바꿔도 업무 API 요청 없음").toBe(before);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("TK-215 AI 배경 그림 390px: 비용 줄을 보인 뒤 3장을 받아 하나를 고르면 표지 사진 자리에 들어가고 'AI 생성 이미지'가 붙으며, 그림은 저장소·주소에 남지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const images = await fakeBackgroundImages();
  const done = draftOf(sinheung, { result: resultOf(1), needsLocation: false });
  const calls = await setup(page, { drafts: [done], backgrounds: () => backgroundsResult(images) });
  await openThroughList(page, "신흥 SK뷰 1편 제목");
  const panel = page.locator("[data-bl-cardset]");
  await expect(cardImages(page)).toHaveCount(3);
  const photoCover = await cardImages(page).nth(0).getAttribute("src");
  await panel.getByRole("radio", { name: "AI 배경 그림" }).check();
  const bg = panel.locator(".bl-bg");
  await expect(bg).toBeVisible();
  await expect(bg.getByRole("radio", { name: /수채화/u })).toBeChecked();
  await expect(bg.getByRole("radio", { name: /보통/u })).toBeChecked();
  await expect(bg.locator(".bl-make__note")).toHaveText("한도 1편 몫 · 오늘 남은 8편 · 3장 약 0.12 ~ 0.16달러(추정, 실제 값은 이번 달 비용에서 뺌 · 이번 달 남은 9.58달러)");
  await bg.getByRole("radio", { name: /높음/u }).check();
  await expect(bg.locator(".bl-make__note")).toContainText("3장 약 0.50 ~ 0.63달러");
  await bg.getByRole("radio", { name: /보통/u }).check();
  await bg.getByRole("button", { name: "벚꽃길 산책로, 봄 햇살" }).click();
  await expect(bg.locator("textarea")).toHaveValue("벚꽃길 산책로, 봄 햇살");
  await bg.locator("summary").click();
  await expect(bg.locator(".bl-bg__fixed")).toContainText("벚꽃길 산책로, 봄 햇살. 수채화. 부드러운 번짐과 맑은 색. 그림 안에 글자·숫자·로고 없이. 카드 배경으로 쓸 차분한 세로 그림.");
  expect(await overflowOf(page), "AI 배경 칸 390px").toBeLessThanOrEqual(0);

  await bg.getByRole("button", { name: "AI 그림 3장 만들기" }).click();
  await expect(bg.locator(".bl-bg__progress")).toContainText("그림 3장을 받았습니다(비용 0.14달러)");
  expect(calls.backgrounds).toEqual([{ body: { description: "벚꽃길 산책로, 봄 햇살", style: "watercolor", quality: "medium" }, csrf: "test-csrf" }]);
  const picks = bg.locator(".bl-bg__list img");
  await expect(picks).toHaveCount(3);
  await expect(picks.nth(0)).toHaveAttribute("src", /^data:image\/jpeg;base64,\/9j\//u);
  await expect(picks.nth(1)).toHaveAttribute("alt", "AI 배경 그림 2/3(수채화)");
  // 고르기 전에는 단지 사진 그대로.
  expect(await cardImages(page).nth(0).getAttribute("src")).toBe(photoCover);
  await bg.getByText("2장 고르기").click();
  await expect(cardImages(page).nth(0)).toHaveAttribute("alt", "카드 그림 1/3장: 표지 (표지 사진 자리는 AI 생성 이미지)");
  expect(await cardImages(page).nth(0).getAttribute("src")).not.toBe(photoCover);
  // 다시 단지 사진으로 돌리면 표시가 빠진다.
  await panel.getByRole("radio", { name: "단지 사진" }).check();
  await expect(cardImages(page).nth(0)).toHaveAttribute("alt", "카드 그림 1/3장: 표지");
  const saved = await stored(page);
  expect(saved.includes("data:image") || saved.includes("/9j/"), "그림은 브라우저 저장소·주소에 없음").toBe(false);
  expect(saved.includes("벚꽃"), "설명은 브라우저 저장소·주소에 없음").toBe(false);
  expect(await overflowOf(page), "그림 3장 390px").toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("TK-216 AI 배경 그림 오류: 코드마다 까닭을 알리고 그림 없이도 카드는 그대로이며, 한도를 다 썼거나 설명이 200자를 넘으면 단추를 막는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const answers = [
    { status: 422, error: { code: "AI_IMAGE_REFUSED" } },
    { status: 503, error: { code: "IMAGE_CONFIG_MISSING" } },
    { status: 429, error: { code: "AI_BUDGET_EXCEEDED", details: ["monthly"] } },
    { status: 502, error: { code: "AI_STATE_UNKNOWN" } },
  ];
  const done = draftOf(sinheung, { result: resultOf(1), needsLocation: false });
  await setup(page, { drafts: [done], backgrounds: (_body, n) => answers[n - 1] });
  await openThroughList(page, "신흥 SK뷰 1편 제목");
  const panel = page.locator("[data-bl-cardset]");
  await panel.getByRole("radio", { name: "AI 배경 그림" }).check();
  const bg = panel.locator(".bl-bg");
  const make = bg.getByRole("button", { name: "AI 그림 3장 만들기" });
  const alert = bg.locator(".bl-alert");
  for (const text of ["OpenAI 안전 기준에 걸려", "그림 설정 확인", "이번 달 AI 비용 상한", "비용은 만든 것으로 셉니다"]) {
    await make.click();
    await expect(alert).toContainText(text);
    await expect(alert).toBeFocused();
  }
  await expect(cardImages(page), "그림이 없어도 카드 3장은 그대로").toHaveCount(3);
  await expect(cardImages(page).nth(0)).toHaveAttribute("alt", "카드 그림 1/3장: 표지");
  await bg.locator("textarea").evaluate((node) => { node.removeAttribute("maxlength"); });
  await bg.locator("textarea").fill("가".repeat(201));
  await expect(bg.locator("textarea + small")).toHaveText("201 / 200자");
  await expect(make, "200자를 넘으면 막음").toBeDisabled();
  assertNoErrors();
});

test("TK-217 AI 배경 그림: 오늘 편수를 다 쓰면 단추를 막고 까닭을 단추 아래에 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const full = { ...savedLimits, usage: { ...savedLimits.usage, todayCreates: 10 } };
  const done = draftOf(sinheung, { result: resultOf(1), needsLocation: false });
  await setup(page, { limits: full, drafts: [done], backgrounds: () => ({ status: 500, error: { code: "AI_UPSTREAM_FAILED" } }) });
  await openThroughList(page, "신흥 SK뷰 1편 제목");
  const panel = page.locator("[data-bl-cardset]");
  await panel.getByRole("radio", { name: "AI 배경 그림" }).check();
  await expect(panel.getByRole("button", { name: "AI 그림 3장 만들기" })).toBeDisabled();
  await expect(panel.locator(".bl-bg .bl-make__note")).toHaveText("오늘 만들 수 있는 편수를 다 썼습니다. 내일 0시(한국 시각)부터 다시 만들 수 있습니다.");
  assertNoErrors();
});

test("TK-218 카드 그림 판 2 360px: 매물 초안은 모양만 고르고(표지 사진 고르기 없음) 다크 모양으로 다시 그린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = { title: "가상숲1단지 매매", paragraphs: ["가상숲1단지 매물입니다."], hashtags: ["천동"], snsShort: "가상숲1단지", factsUsed: [] };
  const done = draftOf(listing, { result });
  await setup(page, { width: 360, drafts: [done] });
  await openThroughList(page, "가상숲1단지 매매");
  await page.locator("#bl-reloc").fill(LOCATION);
  const panel = page.locator("[data-bl-cardset]");
  await expect(cardImages(page)).toHaveCount(1);
  await expect(panel.getByRole("radio", { name: "단지 사진" })).toBeHidden();
  await expect(panel).toContainText("매물 표지에는 사진 자리가 없어 모양만 고릅니다.");
  const before = await cardImages(page).nth(0).getAttribute("src");
  await panel.getByRole("radio", { name: "다크" }).check();
  await expect.poll(async () => cardImages(page).nth(0).getAttribute("src")).not.toBe(before);
  expect(await overflowOf(page), "매물 카드 360px").toBeLessThanOrEqual(0);
  assertNoErrors();
});
