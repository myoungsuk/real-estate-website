// 홍보 종이 화면(보드 45번 C, /admin/work/paper/)을 본다. 서버를 부르지 않는 화면이라 관리 API는 모두 끊어 둔다. 단지 이름은 지어낸 값이다.
// 운영자 결정 2026-11-20 18:09: 거래 완료 알림은 가격·동·층·계약 날짜 없이 '전용 N㎡대', 명함은 A안 흰 종이(인쇄 CSS, 96×56mm·A4 10장 판).
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00
const PAGE = "/admin/work/paper/";
const PRODUCTION_CSP = /^\s*Content-Security-Policy: (.+)$/mu.exec(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"))[1];
const office = JSON.parse(readFileSync(new URL("../src/data/office.json", import.meta.url), "utf8"));
const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), signature: bytes.subarray(1, 4).toString("ascii") });
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

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
    // 인쇄 창 대신 눌린 인쇄 칸 이름만 적는다.
    window.__printed = [];
    window.print = () => window.__printed.push(document.body.dataset.paperPrint ?? "");
  });
  return { apiCalls, violations };
}

// PDF 쪽마다 MediaBox(포인트)를 mm로 바꿔 돌려준다.
function pdfPages(buffer) {
  const text = buffer.toString("latin1");
  const boxes = [...text.matchAll(/\/Type\s*\/Page(?!s)[\s\S]*?\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/gu)];
  const fallback = [...text.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/gu)];
  const count = (text.match(/\/Type\s*\/Page(?!s)/gu) ?? []).length;
  const mm = (pt) => Math.round((Number(pt) / 72) * 25.4);
  const list = (boxes.length === count ? boxes : fallback).map((m) => `${mm(m[3]) - mm(m[1])}x${mm(m[4]) - mm(m[2])}`);
  return { count, sizes: list };
}

test("홍보 종이 390px: 거래 완료 알림 PNG 1080×1350·deal-done-YYYYMMDD.png, 면적 '㎡대' 미리 보기, 막는 문구, 입력을 바꾸면 그림을 버림, 서버 요청·CSP 위반 0", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 390);
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "홍보 종이" })).toBeVisible();
  for (const selector of ["#done-name", "#done-deal", "#done-area"]) await expect(page.locator(selector)).toHaveAttribute("autocomplete", "off");
  await expect(page.locator("[data-done-timing]"), "올리는 때 안내(사용자 결정 2026-11-20 18:33)").toHaveText("계약 직후보다 시간을 두고 올리면 거래하신 분이 덜 드러납니다.");

  const make = page.getByRole("button", { name: "알림 그림 만들기" });
  const status = page.locator("[data-done-status]");
  const download = page.locator("[data-done-download]");
  await make.click();
  await expect(status).toHaveText("단지 이름을 넣어 주세요.");
  await expect(download).toBeHidden();

  await page.getByLabel("단지 이름").fill("가상숲 행복단지 101동");
  await page.getByLabel("전용면적(㎡)").fill("84.97");
  await expect(page.locator("[data-done-area-preview]")).toHaveText("그림에는 '전용 84㎡대'로 나옵니다.");
  await make.click();
  await expect(status).toHaveText("단지 이름에는 동 번호·호수·층을 넣지 않습니다.");

  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("84.977");
  await make.click();
  await expect(status).toHaveText(/^전용면적을 ㎡ 숫자로 넣어 주세요/u);

  await page.getByLabel("전용면적(㎡)").fill("84.97");
  await page.getByLabel("거래 종류").selectOption({ label: "전세" });
  await make.click();
  await expect(status).toHaveText(/^✓ 그림을 만들었습니다/u);
  const image = page.locator("[data-done-image]");
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/u);
  await expect(image).toHaveAttribute("alt", "거래 완료 알림: 가상숲 행복단지 · 전용 84㎡대 · 전세");
  await expect(download).toHaveText("그림 저장");
  await expect(download).toHaveAttribute("download", "deal-done-20261120.png");
  const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
  expect(file.suggestedFilename()).toBe("deal-done-20261120.png");
  expect(pngSize(readFileSync(await file.path()))).toEqual({ width: 1080, height: 1350, signature: "PNG" });
  // 그림 글자: 가격·동·층·날짜 숫자가 들어가지 않게 그린 글 묶음을 화면 밖에서 다시 만들지 않고, alt·파일 이름에 단지 외 숫자가 없음을 본다.
  expect(await image.getAttribute("alt")).not.toMatch(/억|만 원|층|호|\d+동/u);
  await expect(page.getByRole("button", { name: "종이로 뽑기(A4)" })).toBeVisible();

  // 입력을 바꾸면 그림·저장·인쇄 단추를 모두 거둔다.
  await page.getByLabel("전용면적(㎡)").fill("59");
  await expect(download).toBeHidden();
  await expect(page.locator("[data-done-preview]")).toBeHidden();
  await expect(page.getByRole("button", { name: "종이로 뽑기(A4)" })).toBeHidden();
  await expect(page.locator("[data-done-sheet] img")).toHaveCount(0);

  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);
  expect(apiCalls, "이 화면은 서버를 부르지 않음").toEqual([]);
  expect(violations, "운영 CSP 위반").toEqual([]);
  assertNoErrors();
});

const CARD_SHAPES = [["white", "흰 종이"], ["green", "초록 카드"], ["sign", "간판색"], ["photo", "사진"], ["stamp", "도장"], ["night", "보라 밤"]];
const cardRadio = (page, label) => page.locator(".paper-card").getByRole("radio", { name: label, exact: true });

test("홍보 종이 명함: 앞면 대표·이름·전화·이메일(직함 없음), 뒷면 영업시간·상호·주소, 모양 6가지 모두 360·390·768·1280px 가로 넘침·명함 안 글자 넘침 없음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 360);
  await page.goto(PAGE);
  // 처음 값은 흰 종이이고, 보이는 세트는 하나뿐이다.
  await expect(cardRadio(page, "흰 종이")).toBeChecked();
  await expect(page.locator(".bc-set:not([hidden])")).toHaveCount(1);
  await expect(page.locator(".bc-set:not([hidden])")).toHaveAttribute("data-card-set", "white");
  const front = page.locator(".bc-set:not([hidden]) .bc--front");
  const back = page.locator(".bc-set:not([hidden]) .bc--back");
  await expect(front).toContainText("대표");
  await expect(front).toContainText(office.representative);
  await expect(front).toContainText(office.mobile);
  await expect(front).toContainText(office.email);
  await expect(back).toContainText("평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00 · 일 예약 상담");
  await expect(back).toContainText(office.legalName);
  await expect(back).toContainText(office.registrationNumber);
  await expect(back).toContainText(office.address);
  expect(await front.textContent()).not.toMatch(/실장|팀장|소장|이사/u);
  // 로고는 흰 여백을 잘라 낸 data 주소로 바뀐다.
  await expect(page.locator(".bc-stage img[data-card-logo]").first()).toHaveAttribute("src", /^data:image\/png;base64,/u);

  for (const [shape, label] of CARD_SHAPES) {
    await cardRadio(page, label).check();
    await expect(page.locator(".bc-set:not([hidden])"), label).toHaveAttribute("data-card-set", shape);
    await expect(page.locator(".bc-set:not([hidden])")).toHaveCount(1);
    // 글은 모양과 상관없이 같다.
    await expect(front, label).toContainText(office.representative);
    await expect(front, label).toContainText(office.mobile);
    await expect(front, label).toContainText(office.email);
    expect(await front.textContent(), label).not.toMatch(/실장|팀장|소장|이사/u);
    await expect(back, label).toContainText(office.legalName);
    await expect(back, label).toContainText(office.registrationNumber);
    if (shape === "night") await expect(front).toContainText("평일 밤 8시까지 상담");
  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${label} ${width}px 가로 넘침`).toBeLessThanOrEqual(0);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".bc-set:not([hidden]) .bc")].map((card) => {
      const box = card.getBoundingClientRect();
      const inner = [...card.querySelectorAll("*")].filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect());
      const outside = inner.filter((rect) => rect.right > box.right + 0.5 || rect.bottom > box.bottom + 0.5 || rect.left < box.left - 0.5 || rect.top < box.top - 0.5).length;
      return { ratio: Math.round((box.width / box.height) * 100) / 100, outside, overflowX: card.scrollWidth - card.clientWidth, overflowY: card.scrollHeight - card.clientHeight };
    }));
    expect(cards.length, `${label} 앞·뒤 두 장`).toBe(2);
    for (const card of cards) {
      expect(card.ratio, `${label} ${width}px 명함 비율 90:50`).toBeCloseTo(1.8, 1);
      expect(card.outside, `${label} ${width}px 명함 밖으로 나간 글자 칸`).toBe(0);
      expect(card.overflowX, `${label} ${width}px 명함 가로 넘침`).toBeLessThanOrEqual(0);
      expect(card.overflowY, `${label} ${width}px 명함 세로 넘침`).toBeLessThanOrEqual(0);
    }
  }
  }
  expect(apiCalls, "서버 요청 0").toEqual([]);
  expect(violations, "운영 CSP 위반").toEqual([]);
  assertNoErrors();
});

test("홍보 종이 인쇄: 인쇄소용은 96×56mm 2쪽(앞·뒤), A4 10장 판은 A4 2쪽(칸 10개씩), 알림 그림은 A4 1쪽, 메뉴·단추는 숨김", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, 1280);
  await page.goto(PAGE);

  // 인쇄 칸은 누르기 전에는 비어 있다.
  await expect(page.locator(".paper-print--card .bc")).toHaveCount(0);
  await page.getByRole("button", { name: "인쇄소용 PDF(앞·뒤)" }).click();
  expect(await page.evaluate(() => window.__printed)).toEqual(["card"]);
  await page.emulateMedia({ media: "print" });
  for (const selector of [".admin-bar", ".admin-top", ".admin-tabbar", ".work-doc__header", ".paper-done", ".paper-card"]) await expect(page.locator(selector).first(), selector).toBeHidden();
  await expect(page.locator(".paper-print--card .bc")).toHaveCount(2);
  await expect(page.locator(".paper-print--card .bc--white")).toHaveCount(2);
  const cardPdf = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(cardPdf, "96×56mm 두 쪽").toEqual({ count: 2, sizes: ["96x56", "96x56"] });

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await page.evaluate(() => document.body.dataset.paperPrint ?? null), "인쇄 창이 닫히면 표시를 뗌").toBeNull();
  await page.emulateMedia({ media: "screen" });
  // 모양을 바꾸면 A4 판에도 그 모양이 앞 10장·뒤 10장 같게 들어간다.
  await cardRadio(page, "보라 밤").check();
  await page.getByRole("button", { name: "A4 10장 판" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper-print--sheet .bc-a4")).toHaveCount(2);
  await expect(page.locator(".paper-print--sheet .bc-a4").first().locator(".bc--front.bc--night")).toHaveCount(10);
  await expect(page.locator(".paper-print--sheet .bc-a4").last().locator(".bc--back.bc--night")).toHaveCount(10);
  await expect(page.locator(".paper-print--sheet .bc--white")).toHaveCount(0);
  await expect(page.locator(".paper-print--card")).toBeHidden();
  const sheetPdf = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(sheetPdf, "A4 두 쪽").toEqual({ count: 2, sizes: ["210x297", "210x297"] });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  // 인쇄소용 모양 6가지: 명함 바탕이 흰색이 아니면 인쇄 칸(재단 여유 3mm를 넣은 96×56mm 쪽 전체)도 같은 바탕이고, 크기는 그대로 두 쪽이다.
  for (const [shape, label] of CARD_SHAPES) {
    await cardRadio(page, label).check();
    await page.getByRole("button", { name: "인쇄소용 PDF(앞·뒤)" }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(`.paper-print--card .bc-page[data-shape="${shape}"]`), label).toHaveCount(2);
    await expect(page.locator(`.paper-print--card .bc--${shape}`), label).toHaveCount(2);
    const sides = await page.evaluate(() => [...document.querySelectorAll(".paper-print--card .bc-page")].map((node) => {
      const paint = (el) => { const style = getComputedStyle(el); return { color: style.backgroundColor, image: style.backgroundImage }; };
      return { side: node.dataset.side, page: paint(node), card: paint(node.querySelector(".bc")) };
    }));
    for (const { side, page: bleed, card } of sides) {
      const plain = card.image === "none" && /^rgba\(0, 0, 0, 0\)$|^rgb\(255, 255, 255\)$/u.test(card.color);
      if (!plain) expect(bleed, `${label} ${side} 재단 여유까지 명함 바탕`).toEqual(card);
    }
    expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true })), `${label} 96×56mm 두 쪽`).toEqual({ count: 2, sizes: ["96x56", "96x56"] });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "A4 10장 판" }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(`.paper-print--sheet .bc--${shape}`), label).toHaveCount(20);
    expect(pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true })), `${label} A4 두 쪽`).toEqual({ count: 2, sizes: ["210x297", "210x297"] });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
  }

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("59.99");
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await page.getByRole("button", { name: "종이로 뽑기(A4)" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper-print--done img")).toBeVisible();
  await expect(page.locator(".paper-print--sheet")).toBeHidden();
  const donePdf = pdfPages(await page.pdf({ format: "A4", preferCSSPageSize: true }));
  expect(donePdf.count, "알림 그림 A4 한 장").toBe(1);
  await page.emulateMedia({ media: "screen" });
  expect(await page.evaluate(() => window.__printed)).toEqual(["card", "sheet", ...CARD_SHAPES.flatMap(() => ["card", "sheet"]), "done"]);
  assertNoErrors();
});

// 보드 20번(2026-11-24): 사용자 답 "어 그렇게 해"(모양 번호)·"아냐 그냥 만들어"(가격 켤 때 허락 체크칸 없음).
test("홍보 종이 모양·가격: 가격은 '가격 넣기'를 켰을 때만, 모양을 바꾸면 같은 값으로 다시 그림, 대표 소개 그림 3가지, 서버 요청 0", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 390);
  await page.goto(PAGE);
  const done = page.locator("[data-done-tool]");
  const image = done.locator("[data-done-image]");
  await expect(done.getByRole("radio", { name: "기본", exact: true })).toBeChecked();
  await expect(page.locator('[data-done-price-row="amount"]')).toBeHidden();

  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("84.97");
  // 가격 칸은 켜야 보이고, 켰는데 비어 있으면 만들지 않는다.
  await done.getByLabel("가격 넣기").check();
  await expect(page.locator('[data-done-price-row="amount"]')).toBeVisible();
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(done.locator("[data-done-status]")).toContainText("매매가");
  await expect(done.locator("[data-done-preview]")).toBeHidden();
  await page.getByLabel("매매가(만 원)").fill("41500");
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(image).toHaveAttribute("alt", /4억 1,500만 원/u);
  const first = await image.getAttribute("src");

  // 가격을 끄면 칸이 숨고, 다시 만든 그림 글에는 가격이 없다.
  await done.getByLabel("가격 넣기").uncheck();
  await expect(page.locator('[data-done-price-row="amount"]')).toBeHidden();
  await page.getByRole("button", { name: "알림 그림 만들기" }).click();
  await expect(image).toHaveAttribute("alt", /^거래 완료 알림: 가상숲 행복단지 · 전용 84㎡대 · [^·]+$/u);

  // 그림이 있을 때 모양을 바꾸면 같은 값으로 다시 그린다. 모든 모양이 1080×1350이다.
  for (const label of ["흰 종이", "초록 카드", "영수증", "도장", "기본"]) {
    const before = await image.getAttribute("src");
    await done.getByRole("radio", { name: label, exact: true }).check();
    await expect(done.locator("[data-done-preview]"), label).toBeVisible();
    await expect.poll(() => image.getAttribute("src"), label).not.toBe(before);
    const src = await image.getAttribute("src");
    expect(pngSize(Buffer.from(src.split(",")[1], "base64")), label).toMatchObject({ width: 1080, height: 1350, signature: "PNG" });
  }
  expect(first).toMatch(/^data:image\/png;base64,/u);

  // 대표 소개: 문구를 고치지 않으면 처음 문구로, 모양만 고르고 만든다.
  const intro = page.locator("[data-intro-tool]");
  await expect(intro.getByRole("radio", { name: "흰 종이", exact: true })).toBeChecked();
  for (const label of ["흰 종이", "초록 카드", "사진 크게"]) {
    await intro.getByRole("radio", { name: label, exact: true }).check();
    await intro.getByRole("button", { name: "소개 그림 만들기" }).click();
    const introImage = intro.locator("[data-intro-image]");
    await expect(intro.locator("[data-intro-preview]"), label).toBeVisible();
    await expect(introImage, label).toHaveAttribute("src", /^data:image\/png;base64,/u);
    const src = await introImage.getAttribute("src");
    expect(pngSize(Buffer.from(src.split(",")[1], "base64")), label).toMatchObject({ width: 1080, height: 1350, signature: "PNG" });
    await expect(intro.getByRole("link", { name: "그림 저장" })).toHaveAttribute("download", /^intro-\d{8}\.png$/u);
  }
  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);
  expect(apiCalls, "서버 요청 0").toEqual([]);
  expect(violations, "운영 CSP 위반").toEqual([]);
  assertNoErrors();
});

// 문구 고치기(보드 20번 2판): 글을 고치면 그림이 바뀌고, 막는 글이면 그림을 만들지 않는다. 모양마다 고친 글이 남고 '처음 문구로'는 보이는 모양만 되돌린다.
test("홍보 종이 문구 고치기 390px: 고친 글로 그림이 바뀜, 동·호수·날짜·다른 전화번호·빈 제목은 막음, 모양마다 따로 남음, 명함은 글을 바로 바꾸고 막히면 인쇄 단추를 끔, 서버 요청 0", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { apiCalls, violations } = await setup(page, 390);
  await page.goto(PAGE);
  const done = page.locator("[data-done-tool]");
  const image = done.locator("[data-done-image]");
  const preview = done.locator("[data-done-preview]");
  const status = done.locator("[data-done-status]");
  const make = page.getByRole("button", { name: "알림 그림 만들기" });
  await page.getByLabel("단지 이름").fill("가상숲 행복단지");
  await page.getByLabel("전용면적(㎡)").fill("84.97");
  await done.getByRole("radio", { name: "흰 종이", exact: true }).check();
  // 접힌 상자를 펴면 고른 모양(흰 종이)의 칸만 보이고, 처음 값은 지금 문구다.
  const box = done.locator("[data-copy-tool='done']");
  await expect(box).not.toHaveAttribute("open", "");
  await box.locator("summary").click();
  const head = page.locator("#done-copy-white-head");
  await expect(head).toBeVisible();
  await expect(head).toHaveValue("거래 완료");
  await expect(page.locator("#done-copy-green-head")).toBeHidden();
  await make.click();
  await expect(preview).toBeVisible();
  const before = await image.getAttribute("src");

  // 글을 고치면 만든 그림을 버리고, 다시 만들면 다른 그림(1080×1350)이 나온다.
  await head.fill("축하합니다");
  await expect(preview).toBeHidden();
  await make.click();
  await expect(preview).toBeVisible();
  const edited = await image.getAttribute("src");
  expect(edited).not.toBe(before);
  expect(pngSize(Buffer.from(edited.split(",")[1], "base64"))).toMatchObject({ width: 1080, height: 1350, signature: "PNG" });

  // 막는 글: 그림을 만들지 않고 까닭 한 줄.
  for (const [selector, value, reason] of [
    ["#done-copy-white-line1", "101동 이웃께", "동 번호·호수"],
    ["#done-copy-white-sub", "11월 24일 계약", "날짜는 넣지 않습니다"],
    ["#done-copy-white-sub", "15층 남향", "층은 넣지 않습니다"],
    ["#done-copy-white-line2", "010-1234-5678로 연락", "사무소 번호가 아닌 전화번호"],
    ["#done-copy-white-head", "  ", "비울 수 없습니다"],
  ]) {
    const input = page.locator(selector);
    const old = await input.inputValue();
    await input.fill(value);
    await make.click();
    await expect(status, value).toContainText(reason);
    await expect(preview, value).toBeHidden();
    await input.fill(old);
  }
  // 빈 optional 칸은 그 줄을 빼고 그린다.
  await page.locator("#done-copy-white-sub").fill("");
  await make.click();
  await expect(preview).toBeVisible();

  // 모양을 바꿔도 흰 종이에서 고친 글은 남고, '처음 문구로'는 보이는 모양만 되돌린다.
  await done.getByRole("radio", { name: "초록 카드", exact: true }).check();
  await expect(page.locator("#done-copy-green-head")).toBeVisible();
  await expect(page.locator("#done-copy-green-head")).toHaveValue("계약을 마쳤습니다");
  await page.locator("#done-copy-green-head").fill("새 출발");
  await done.getByRole("radio", { name: "흰 종이", exact: true }).check();
  await expect(head).toHaveValue("축하합니다");
  await done.getByRole("button", { name: "처음 문구로" }).click();
  await expect(head).toHaveValue("거래 완료");
  await expect(page.locator("#done-copy-white-sub")).toHaveValue("이 단지의 매매·전세·월세도 대표가 직접 상담합니다.");
  await expect(page.locator("#done-copy-green-head")).toHaveValue("새 출발");

  // 기본 모양의 도장 글, 대표 소개의 한 줄 글도 그림을 바꾼다.
  await done.getByRole("radio", { name: "기본", exact: true }).check();
  await make.click();
  await expect(preview).toBeVisible();
  const basic = await image.getAttribute("src");
  await page.locator("#done-copy-basic-stamp").fill("계약 축하");
  await make.click();
  await expect(preview).toBeVisible();
  expect(await image.getAttribute("src")).not.toBe(basic);
  const intro = page.locator("[data-intro-tool]");
  await intro.getByRole("button", { name: "소개 그림 만들기" }).click();
  await expect(intro.locator("[data-intro-preview]")).toBeVisible();
  const introBefore = await intro.locator("[data-intro-image]").getAttribute("src");
  await intro.locator("[data-copy-tool='intro'] summary").click();
  await page.locator("#intro-copy-white-line").fill("동구 어디든 직접 보고 상담합니다");
  await expect(intro.locator("[data-intro-preview]")).toBeHidden();
  await intro.getByRole("button", { name: "소개 그림 만들기" }).click();
  await expect(intro.locator("[data-intro-preview]")).toBeVisible();
  expect(await intro.locator("[data-intro-image]").getAttribute("src")).not.toBe(introBefore);
  await page.locator("#intro-copy-white-line").fill("042-111-2222");
  await intro.getByRole("button", { name: "소개 그림 만들기" }).click();
  await expect(intro.locator("[data-intro-status]")).toContainText("사무소 번호가 아닌 전화번호");
  await expect(intro.locator("[data-intro-preview]")).toBeHidden();

  // 명함: 고친 글이 미리 보기에 바로 들어가고, 인쇄 칸에도 그대로 복사된다. 막히면 인쇄 단추를 끄고 까닭을 보인다.
  const card = page.locator(".paper-card");
  await card.locator("[data-copy-tool='card'] summary").click();
  // 지역 줄 칸 아래 안내: 36자는 섞은 글 기준이라 한글만이면 그 전에 넘침 검사가 막는다고 알린다(뒷면 제목 칸에는 없음).
  await expect(page.locator("#card-copy-white-areas + small")).toHaveText("36자까지 · 한글만 쓰면 30자쯤에서 명함 폭을 넘어 인쇄를 막습니다 · 비우면 그 줄을 뺍니다");
  await expect(page.locator("#card-copy-white-headline + small")).toHaveText("18자까지");
  await page.locator("#card-copy-white-headline").fill("동구 전역 직접 상담");
  const backHeadline = page.locator("[data-card-set='white'] [data-card-face='back'] [data-card-text='headline']");
  await expect(backHeadline).toHaveText("동구 전역 직접 상담");
  await page.locator("#card-copy-white-areas").fill("");
  await expect(page.locator("[data-card-set='white'] [data-card-text='areas']")).toBeHidden();
  await card.getByRole("button", { name: "A4 10장 판" }).click();
  await expect(page.locator("[data-card-slot='back']").first().locator("[data-card-text='headline']")).toHaveText("동구 전역 직접 상담");
  const printButtons = card.locator("[data-card-print]");
  await page.locator("#card-copy-white-areas").fill("101동 앞 상가");
  await expect(card.locator("[data-card-status]")).toContainText("동 번호·호수");
  for (const button of await printButtons.all()) await expect(button).toBeDisabled();
  await page.locator("#card-copy-white-areas").fill("가".repeat(36));
  await expect(card.locator("[data-card-status]")).toContainText("두 줄로 꺾이거나 넘칩니다");
  for (const button of await printButtons.all()) await expect(button).toBeDisabled();
  await card.getByRole("button", { name: "처음 문구로" }).click();
  await expect(card.locator("[data-card-status]")).toHaveText("");
  for (const button of await printButtons.all()) await expect(button).toBeEnabled();
  await expect(backHeadline).toHaveText("대전 동구 전역 상담");
  // 보라 밤 앞면 꼬리표: 비우면 숨는다.
  await cardRadio(page, "보라 밤").check();
  await expect(page.locator("#card-copy-night-tag")).toHaveValue("평일 밤 8시까지 상담");
  await page.locator("#card-copy-night-tag").fill("");
  await expect(page.locator("[data-card-set='night'] [data-card-text='tag']")).toBeHidden();

  expect(await overflowOf(page), "390px 가로 넘침").toBeLessThanOrEqual(0);
  expect(apiCalls, "서버 요청 0").toEqual([]);
  expect(violations, "운영 CSP 위반").toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, location.search])).toEqual([0, 0, ""]);
  assertNoErrors();
});
