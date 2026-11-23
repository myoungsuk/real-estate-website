// 매물 안내지 화면(보드 45번 D, /admin/work/listing-paper/)을 본다. 서버를 부르지 않는 화면이라 관리 API는 모두 끊어 둔다.
// 매물은 공개 naver-listings.json 그대로이고, 명시사항 칸에 넣는 소재지는 지어낸 값(가상동)이다.
// 운영자 결정 2026-11-20 23:41:16: A안 매물 종이, 명시사항은 만들 때마다 넣고 저장하지 않음, 최저가 표시는 넣지 않음.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00
const PAGE = "/admin/work/listing-paper/";
const PRODUCTION_CSP = /^\s*Content-Security-Policy: (.+)$/mu.exec(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"))[1];
const naver = JSON.parse(readFileSync(new URL("../src/data/naver-listings.json", import.meta.url), "utf8"));
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), signature: bytes.subarray(1, 4).toString("ascii") });
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 보이는 명시사항 선택 단추(.bl-seg)마다 글자 노드가 놓인 줄 수를 세어 두 줄 이상인 단추 이름을 돌려준다.
// 좁은 폭에서 '다세대주택'·'위반건축물'이 두 줄로 꺾이면 단추가 높아져 아래 칸이 밀린다.
const twoLineChoices = (page) => page.evaluate(() => [...document.querySelectorAll(".bl-seg .work-choice")].filter((choice) => choice.offsetParent).flatMap((choice) => {
  const walker = document.createTreeWalker(choice, NodeFilter.SHOW_TEXT);
  const tops = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
  }
  return tops.size > 1 ? [`${choice.textContent.trim()}(${choice.querySelector("input")?.checked ? "고름" : "안 고름"})`] : [];
}));
// 고르기 전에 한 번, 보이는 단추를 하나씩 고를 때마다 한 번 잰다. 누른 단추 이름을 돌려준다.
async function expectOneLineChoices(page, label) {
  expect(await twoLineChoices(page), `${label}: 고르기 전 두 줄 단추`).toEqual([]);
  const choices = page.locator(".bl-seg .work-choice:visible");
  const names = [];
  for (let index = 0; index < await choices.count(); index++) {
    const choice = choices.nth(index);
    names.push((await choice.innerText()).trim());
    await choice.click();
    expect(await twoLineChoices(page), `${label}: '${names.at(-1)}'을 고른 뒤 두 줄 단추`).toEqual([]);
  }
  expect(names, `${label}: 긴 단추도 눌러 봄`).toEqual(expect.arrayContaining(["다세대주택", "위반건축물"]));
  return names;
}
// 매매 아파트(층 숫자가 있는 것) 4건, 월세 아파트 1건, 분양권 1건을 공개 목록에서 고른다.
const saleApartments = naver.items.filter((item) => item.tradeType === "sale" && item.propertyType === "아파트" && /^\d+\/\d+층$/u.test(item.floorLabel ?? ""));
const rentApartment = naver.items.find((item) => item.tradeType !== "sale" && item.propertyType === "아파트");
const presale = naver.items.find((item) => item.propertyType === "아파트분양권");

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}

// 운영 CSP를 이 화면 응답에 붙이고 위반을 모은다. 서버 요청이 하나라도 나가면 모은다(이 화면은 서버를 부르지 않음).
async function setup(page, width = 390) {
  const apiCalls = [];
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: 900 });
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "TEST_OFFLINE" } }) });
  });
  await page.route(`**${PAGE}**`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": PRODUCTION_CSP } });
  });
  const violations = [];
  await page.exposeFunction("__cspViolation", (text) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => window.__cspViolation(`${event.violatedDirective} ${event.blockedURI}`));
    window.__printed = [];
    window.print = () => window.__printed.push(document.body.dataset.paperPrint ?? "");
  });
  return { apiCalls, violations };
}

const row = (page, id, key) => page.locator(`[data-lp-form='${id}'] [data-bl-row='${key}']`);
// 공동주택 명시사항 칸을 모두 채운다(층·총 층수는 공개 자료에서 이미 채워져 있음).
async function fillApartment(page, id, { location = "대전광역시 동구 가상동 100", fee = "250000" } = {}) {
  await row(page, id, "location").locator("input").fill(location);
  await row(page, id, "kind").locator("label:has(input[value='아파트'])").click();
  await row(page, id, "violation").locator("label:has(input[value='none'])").click();
  await row(page, id, "moveIn").locator("label:has(input[value='now'])").click();
  await row(page, id, "rooms").locator("input").fill("3");
  await row(page, id, "bathrooms").locator("input").fill("2");
  await row(page, id, "approvalDate").locator("input").fill("2010-05-01");
  await row(page, id, "parking").locator("label:has(input[value='perHousehold'])").click();
  await row(page, id, "parking").locator("input[type='text']").first().fill("1.2");
  await row(page, id, "managementFee").locator("label:has(input[value='average'])").click();
  await row(page, id, "managementFee").locator("input[type='text']:visible").first().fill(fee);
  await row(page, id, "managementFee").locator("label:has(input[value='general'])").click();
  await row(page, id, "direction").locator("label:has(input[value='거실'])").click();
}

test("매물 안내지 390px: 분양권 잠금, 빈 칸이면 안 만듦, 다 채우면 PNG 1080×1350·listing-YYYYMMDD.png, 칸을 바꾸면 그림을 버림, 서버 요청·저장·CSP 위반 0", async ({ page }) => {
  expect(saleApartments.length, "시험할 매매 아파트 4건").toBeGreaterThanOrEqual(4);
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 390);
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "매물 안내지" })).toBeVisible();
  await expect(page.locator("[data-lp-pick]")).toHaveCount(naver.items.length);
  await expect(page.locator("#lp-query")).toHaveAttribute("autocomplete", "off");
  const make = page.locator("[data-lp-make]");
  const status = page.locator("[data-lp-status]");
  const download = page.locator("[data-lp-download]");
  await expect(make, "담기 전에는 만들 수 없음").toBeDisabled();

  // 분양권은 까닭을 보이고 잠근다.
  if (presale) {
    const item = page.locator(`[data-lp-item='${presale.id}']`);
    await expect(item.locator("[data-lp-pick]")).toBeDisabled();
    await expect(item.locator("[data-lp-reason]")).toContainText("분양권");
  }

  const first = saleApartments[0];
  await page.locator("#lp-query").fill(first.title);
  await expect(page.locator(`[data-lp-item='${first.id}']`)).toBeVisible();
  await page.locator(`[data-lp-pick='${first.id}']`).click();
  await expect(page.locator(`[data-lp-pick='${first.id}']`)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-lp-picked]")).toHaveText("담은 매물 1 / 3");
  await expect(make).toHaveText("안내지 그림 만들기");
  if (rentApartment) {
    await page.locator("#lp-query").fill("");
    const rent = page.locator(`[data-lp-item='${rentApartment.id}']`);
    await expect(rent.locator("[data-lp-pick]"), "매매와 월세는 한 장에 섞지 않음").toBeDisabled();
    await expect(rent.locator("[data-lp-reason]")).toHaveText("처음 담은 매물과 종류·거래 형태가 같아야 한 장에 비교할 수 있습니다.");
  }
  await expect(row(page, first.id, "location").locator("input"), "소재지는 비어서 시작").toHaveValue("");
  for (const input of await page.locator("[data-lp-form] input, [data-lp-form] select").all()) await expect(input).toHaveAttribute("autocomplete", "off");

  await make.click();
  await expect(status).toContainText("빈 칸이 있으면 만들 수 없습니다.");
  await expect(status).toContainText("소재지");
  await expect(row(page, first.id, "location")).toHaveClass(/bl-row--empty/u);
  await expect(row(page, first.id, "location").locator("input")).toBeFocused();
  await expect(download).toBeHidden();

  // 호수를 넣으면 막는다.
  await fillApartment(page, first.id, { location: "대전광역시 동구 가상동 100 101동 1203호" });
  await make.click();
  await expect(status).toContainText("소재지");
  await expect(download).toBeHidden();

  await row(page, first.id, "location").locator("input").fill("대전광역시 동구 가상동 100");
  await expect(page.locator(`[data-lp-form='${first.id}'] .bl-count`)).toHaveText("✓ 명시사항을 다 채웠습니다.");
  await make.click();
  await expect(status).toHaveText(/^✓ 그림을 만들었습니다/u);
  const image = page.locator("[data-lp-image]");
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/u);
  await expect(image).toHaveAttribute("alt", new RegExp(`^매물 안내: ${first.title} · `, "u"));
  await expect(download).toHaveAttribute("download", "listing-20261120.png");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename(), "파일 이름에는 날짜만").toBe("listing-20261120.png");
  expect(pngSize(readFileSync(await file.path()))).toEqual({ width: 1080, height: 1350, signature: "PNG" });
  await expect(page.getByRole("button", { name: "종이로 뽑기(A4)" })).toBeVisible();

  // 칸을 바꾸면 그림·저장·인쇄 단추를 모두 거둔다.
  await row(page, first.id, "rooms").locator("input").fill("4");
  await expect(download).toBeHidden();
  await expect(page.locator("[data-lp-preview]")).toBeHidden();
  await expect(page.getByRole("button", { name: "종이로 뽑기(A4)" })).toBeHidden();
  await expect(page.locator("[data-lp-sheet] img")).toHaveCount(0);

  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);
  expect(page.url(), "주소에 입력값을 넣지 않음").toMatch(/\/admin\/work\/listing-paper\/$/u);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length]), "브라우저 저장소에 넣지 않음").toEqual([0, 0]);
  expect(apiCalls, "이 화면은 서버를 부르지 않음").toEqual([]);
  expect(violations, "운영 CSP 위반").toEqual([]);
  assertNoErrors();
});

test("매물 비교표 1280px: 3건까지 담고 4건째는 잠금, 빼기, listing-compare-YYYYMMDD.png, A4 인쇄 칸, 360px 가로 넘침 없음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 1280);
  await page.goto(PAGE);
  const [a, b, c, d] = saleApartments;
  for (const item of [a, b, c]) {
    await page.locator(`[data-lp-pick='${item.id}']`).click();
    await fillApartment(page, item.id);
  }
  await expect(page.locator("[data-lp-picked]")).toHaveText("담은 매물 3 / 3");
  await expect(page.locator(`[data-lp-pick='${d.id}']`)).toBeDisabled();
  await expect(page.locator(`[data-lp-item='${d.id}'] [data-lp-reason]`)).toHaveText("한 장에 3건까지 담을 수 있습니다.");
  await expect(page.locator(".lp-form__title").first()).toHaveText(`1. ${a.title}`);

  const make = page.getByRole("button", { name: "비교표 그림 만들기" });
  await make.click();
  await expect(page.locator("[data-lp-status]")).toHaveText(/^✓ 그림을 만들었습니다/u);
  await expect(page.locator("[data-lp-download]")).toHaveAttribute("download", "listing-compare-20261120.png");
  const [file] = await Promise.all([page.waitForEvent("download"), page.locator("[data-lp-download]").click()]);
  expect(pngSize(readFileSync(await file.path()))).toEqual({ width: 1080, height: 1350, signature: "PNG" });
  await expect(page.locator("[data-lp-image]")).toHaveAttribute("alt", `매물 비교: ${[a, b, c].map((item) => item.title).join(", ")}`);

  await page.getByRole("button", { name: "종이로 뽑기(A4)" }).click();
  expect(await page.evaluate(() => window.__printed)).toEqual(["done"]);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper-print--done img")).toBeVisible();
  await expect(page.locator(".lp-step").first()).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await page.evaluate(() => document.body.dataset.paperPrint ?? null), "인쇄 창이 닫히면 표시를 뗌").toBeNull();

  // 빼면 칸 묶음도 사라지고 4건째를 담을 수 있다.
  await page.locator(`[data-lp-pick='${b.id}']`).click();
  await expect(page.locator(`[data-lp-form='${b.id}']`)).toHaveCount(0);
  await expect(page.locator("[data-lp-picked]")).toHaveText("담은 매물 2 / 3");
  await expect(page.locator(`[data-lp-pick='${d.id}']`)).toBeEnabled();
  await expect(page.locator("[data-lp-download]"), "담은 매물이 바뀌면 그림을 버림").toBeHidden();
  await expect(page.locator(".lp-form__title").nth(1)).toHaveText(`2. ${c.title}`);

  for (const width of [360, 768]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }
  expect(apiCalls).toEqual([]);
  expect(violations).toEqual([]);
  assertNoErrors();
});

// 칸을 고르거나 채울 때 그 아래 칸이 움직이지 않는다(보드 후보, 2026-11-21 측정: 고치기 전 26 ~ 28px 올라감).
// ① '위반건축물·미등기 여부'를 고르면 위 '빈 칸·고칠 칸' 줄이 줄어듦 ② 빈 칸 표시가 켜진 뒤 소재지를 채우면 그 칸 안내 글이 사라짐.
test("명시사항 칸 밀림 0px: 360·390·1280px에서 칸을 고르거나 채워도 아래 칸 위치가 그대로, 선택 단추 글자는 늘 한 줄", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, 360);
  const first = saleApartments[0];
  const topOf = (key) => row(page, first.id, key).evaluate((element) => Math.round(element.getBoundingClientRect().top + window.scrollY));
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await page.locator(`[data-lp-pick='${first.id}']`).click();

    const beforePick = await topOf("floor");
    await row(page, first.id, "violation").locator("label:has(input[value='none'])").click();
    await expect(page.locator(`[data-lp-form='${first.id}'] .bl-count`)).not.toContainText("위반건축물");
    expect(await topOf("floor") - beforePick, `${width}px: 위반건축물을 고른 뒤 아래 칸`).toBe(0);

    await page.locator("[data-lp-make]").click();
    const mark = row(page, first.id, "location").locator("[data-bl-mark]");
    await expect(mark).toBeVisible();
    const beforeFill = await topOf("kind");
    await row(page, first.id, "location").locator("input").fill("대전광역시 동구 가상동 100");
    await expect(row(page, first.id, "location")).not.toHaveClass(/bl-row--empty/u);
    await expect(mark, "채운 칸의 안내 글은 보이지 않음(자리만 남김)").toBeHidden();
    expect(await topOf("kind") - beforeFill, `${width}px: 소재지를 채운 뒤 아래 칸`).toBe(0);
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
    await expectOneLineChoices(page, `${width}px`);
  }
  assertNoErrors();
});

// 2026-11-23 위 알약 메뉴: 업무 도구 알약 11개는 1280px 한 줄에 다 들어가지 않는다. 마지막 '매물 안내지'가 지금 화면일 때 줄 밖에 남으면 안 된다.
// 줄 밀기 단추가 나타나고 사라질 때 줄 폭이 바뀌면 방금 옮긴 알약이 다시 잘리므로(실제로 86px 잘렸음) 숨긴 단추도 자리를 지킨다.
const pillGaps = (page, selector) => page.evaluate((target) => {
  const strip = document.querySelector(".admin-subtabs");
  const pill = target === ":focus" ? document.activeElement : strip.querySelector(target);
  const bounds = strip.getBoundingClientRect();
  const box = pill.getBoundingClientRect();
  return { name: pill.textContent.trim(), left: Math.round(box.left - bounds.left), right: Math.round(bounds.right - box.right), scrollLeft: Math.round(strip.scrollLeft), hidden: strip.scrollWidth - strip.clientWidth };
}, selector);

test("PC 위 알약 줄 1280px: 줄 밖에 있던 지금 화면 알약 '매물 안내지'가 처음부터 줄 안에 있고, Tab으로 간 알약도 줄이 따라온다", async ({ page }) => {
  await setup(page, 1280);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  const current = await pillGaps(page, '[aria-current="page"]');
  expect(current.name).toBe("매물 안내지");
  expect(current.hidden, "알약이 줄보다 많아야 이 시험이 뜻이 있음").toBeGreaterThan(0);
  expect(current.scrollLeft, "줄을 옮겨 둠").toBeGreaterThan(0);
  expect(current.left, "왼쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
  expect(current.right, "오른쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
  // 줄 밀기 단추: 끝까지 간 쪽은 숨기되 자리는 그대로(줄 폭이 바뀌지 않음)
  const next = page.locator('[data-admin-strip-step="1"]');
  const back = page.locator('[data-admin-strip-step="-1"]');
  await expect(next).toBeHidden();
  await expect(back).toBeVisible();
  expect(Math.round((await next.evaluate((button) => button.getBoundingClientRect().width))), "숨긴 단추도 자리를 지킴").toBe(36);
  expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(36);
  await back.click();
  await expect.poll(async () => (await pillGaps(page, "li:first-child a")).left, "'‹'로 줄을 되돌림").toBeGreaterThanOrEqual(0);
  // 키보드: 처음 화면(줄이 처음 자리)에서 Tab으로 마지막 알약까지 가면 줄이 따라와 포커스가 보인다
  await page.goto("/admin/work/");
  expect((await pillGaps(page, '[aria-current="page"]')).scrollLeft).toBe(0);
  const last = page.locator(".admin-subtabs a").last();
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    if (await last.evaluate((link) => link === document.activeElement)) break;
  }
  await expect(last).toBeFocused();
  await expect.poll(async () => (await pillGaps(page, ":focus")).right, "Tab으로 간 알약이 줄 안").toBeGreaterThanOrEqual(0);
  expect((await pillGaps(page, ":focus")).name).toBe("매물 안내지");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
});

test("PC '전체 메뉴' 창 1280×720: 창이 화면 안에 있고 메뉴 고리는 내리지 않아도 다 보이며, 넘치는 아래쪽은 창 안에서 내려 보고, 닫으면 '전체 메뉴' 단추로 돌아온다", async ({ page }) => {
  await setup(page, 1280);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(PAGE);
  const open = page.getByRole("button", { name: "전체 메뉴" });
  await open.click();
  const sheet = page.getByRole("dialog", { name: "전체 메뉴" });
  await expect(sheet).toBeVisible();
  const box = await sheet.boundingBox();
  expect(box.y, "창 위").toBeGreaterThanOrEqual(0);
  expect(Math.round(box.y + box.height), "창 아래가 화면 안").toBeLessThanOrEqual(720);
  expect(Math.round(box.x + box.width), "창 오른쪽이 화면 안").toBeLessThanOrEqual(1280);
  // 메뉴 고리(구역 9개 + 업무 도구 아래 단계 11개)는 창을 내리지 않아도 모두 보인다
  const links = sheet.locator(".admin-menu a");
  expect(await links.count()).toBeGreaterThanOrEqual(20);
  for (const link of await links.all()) await expect(link, await link.textContent()).toBeInViewport({ ratio: 1 });
  await expect(sheet.getByRole("link", { name: "매물 안내지" })).toHaveAttribute("aria-current", "page");
  // 창 아래 글(상호·공개 홈페이지)이 넘치면 문서가 아니라 창 안에서 내린다
  const foot = sheet.getByRole("link", { name: /공개 홈페이지/u });
  await foot.scrollIntoViewIfNeeded();
  await expect(foot).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => window.scrollY), "문서는 그대로").toBe(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(open, "Esc로 닫으면 연 단추로").toBeFocused();
  await open.click();
  await sheet.getByRole("button", { name: "닫기" }).click();
  await expect(sheet).toBeHidden();
  await expect(open, "'닫기'로 닫아도 연 단추로").toBeFocused();
});

// 줄 밀기 단추는 마우스를 쓸 때만 보이고 누르는 곳은 44px이다. 36px은 "1221px 이상 + 마우스"(조밀한 PC)뿐이다(사용자 승인 2026-11-23 11:34:13).
test("PC 위 알약 줄 1024px(마우스): 줄 밀기 단추는 44px이고 숨긴 쪽도 자리를 지키며, 지금 화면 알약 '매물 안내지'가 처음부터 줄 안에 있다", async ({ page }) => {
  await setup(page, 1024);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(PAGE);
  expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches), "이 시험은 마우스 화면").toBe(true);
  const current = await pillGaps(page, '[aria-current="page"]');
  expect(current.name).toBe("매물 안내지");
  expect(current.hidden, "알약이 줄보다 많음").toBeGreaterThan(0);
  expect(current.left, "왼쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
  expect(current.right, "오른쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
  const next = page.locator('[data-admin-strip-step="1"]');
  const back = page.locator('[data-admin-strip-step="-1"]');
  await expect(next).toBeHidden();
  await expect(back).toBeVisible();
  const backBox = await back.boundingBox();
  expect(Math.round(backBox.width), "줄 밀기 단추 폭").toBe(44);
  expect(Math.round(backBox.height), "줄 밀기 단추 높이").toBe(44);
  expect(Math.round(await next.evaluate((button) => button.getBoundingClientRect().width)), "숨긴 단추도 자리를 지킴").toBe(44);
  expect((await page.getByRole("button", { name: "전체 메뉴" }).boundingBox()).height, "'전체 메뉴' 44px").toBeGreaterThanOrEqual(44);
  // 한 번에 줄 폭의 0.8배씩 민다. 처음 자리에 닿으면 '‹'가 숨는다
  for (let step = 0; step < 6 && (await pillGaps(page, "li:first-child a")).scrollLeft > 0; step += 1) {
    const from = (await pillGaps(page, "li:first-child a")).scrollLeft;
    await back.click();
    await expect.poll(async () => (await pillGaps(page, "li:first-child a")).scrollLeft, "'‹'를 누르면 줄이 왼쪽으로").toBeLessThan(from);
  }
  await expect(back, "처음 자리에서는 '‹'를 숨김").toBeHidden();
  await expect(next).toBeVisible();
  expect((await pillGaps(page, "li:first-child a")).left, "'‹'로 줄을 되돌림").toBeGreaterThanOrEqual(0);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
});

test("손가락으로 쓰는 넓은 화면 1280px: 조밀한 PC 규칙(36px·14px)이 걸리지 않아 누르는 곳 44px·알약 글자 16px 그대로이고, 줄 밀기 단추 없이 줄을 직접 민다", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    await setup(page, 1280);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(PAGE);
    expect(await page.evaluate(() => innerWidth), "화면 폭").toBe(1280);
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches), "이 시험은 손가락 화면").toBe(false);
    const menu = page.getByRole("button", { name: "전체 메뉴" });
    expect((await menu.boundingBox()).height, "'전체 메뉴' 44px").toBeGreaterThanOrEqual(44);
    expect(await menu.evaluate((button) => getComputedStyle(button).fontSize), "'전체 메뉴' 글자 16px").toBe("16px");
    const pill = page.locator('.admin-subtabs a[aria-current="page"]');
    expect(await pill.evaluate((link) => getComputedStyle(link).fontSize), "알약 글자 16px").toBe("16px");
    expect((await pill.boundingBox()).height, "알약을 누르는 곳 48px").toBeGreaterThanOrEqual(48);
    for (const step of await page.locator("[data-admin-strip-step]").all()) {
      expect(await step.evaluate((button) => getComputedStyle(button).display), "줄 밀기 단추는 손가락 화면에 없음").toBe("none");
    }
    // 단추가 없어도 지금 화면 알약은 처음부터 줄 안에 있고, 줄은 옆으로 밀린다
    const current = await pillGaps(page, '[aria-current="page"]');
    expect(current.name).toBe("매물 안내지");
    expect(current.hidden, "알약이 줄보다 많음").toBeGreaterThan(0);
    expect(current.left, "왼쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
    expect(current.right, "오른쪽으로 잘리지 않음").toBeGreaterThanOrEqual(0);
    expect(await page.locator(".admin-subtabs").evaluate((strip) => getComputedStyle(strip.querySelector("ul") ?? strip).overflowX + "/" + getComputedStyle(strip).overflowX), "줄을 옆으로 밀 수 있음").toMatch(/auto|scroll/u);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});
