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

test("홍보 종이 명함: 앞면 대표·이름·전화·이메일(직함 없음), 뒷면 영업시간·상호·주소, 360·390·768·1280px 가로 넘침·명함 안 글자 넘침 없음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { violations } = await setup(page, 360);
  await page.goto(PAGE);
  const front = page.locator(".bc-stage .bc--front");
  const back = page.locator(".bc-stage .bc--back");
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

  for (const width of [360, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
    const cards = await page.evaluate(() => [...document.querySelectorAll(".bc-stage .bc")].map((card) => {
      const box = card.getBoundingClientRect();
      const inner = [...card.querySelectorAll("*")].filter((node) => node.getClientRects().length > 0).map((node) => node.getBoundingClientRect());
      const outside = inner.filter((rect) => rect.right > box.right + 0.5 || rect.bottom > box.bottom + 0.5 || rect.left < box.left - 0.5 || rect.top < box.top - 0.5).length;
      return { ratio: Math.round((box.width / box.height) * 100) / 100, outside, overflowX: card.scrollWidth - card.clientWidth, overflowY: card.scrollHeight - card.clientHeight };
    }));
    for (const card of cards) {
      expect(card.ratio, `${width}px 명함 비율 90:50`).toBeCloseTo(1.8, 1);
      expect(card.outside, `${width}px 명함 밖으로 나간 글자 칸`).toBe(0);
      expect(card.overflowX, `${width}px 명함 가로 넘침`).toBeLessThanOrEqual(0);
      expect(card.overflowY, `${width}px 명함 세로 넘침`).toBeLessThanOrEqual(0);
    }
  }
  expect(violations, "운영 CSP 위반").toEqual([]);
  assertNoErrors();
});

test("홍보 종이 인쇄: 인쇄소용은 96×56mm 2쪽(앞·뒤), A4 10장 판은 A4 2쪽(칸 10개씩), 알림 그림은 A4 1쪽, 메뉴·단추는 숨김", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, 1280);
  await page.goto(PAGE);

  await page.getByRole("button", { name: "인쇄소용 PDF(앞·뒤)" }).click();
  expect(await page.evaluate(() => window.__printed)).toEqual(["card"]);
  await page.emulateMedia({ media: "print" });
  for (const selector of [".admin-side", ".admin-top", ".admin-tabbar", ".work-doc__header", ".paper-done", ".paper-card"]) await expect(page.locator(selector).first(), selector).toBeHidden();
  await expect(page.locator(".paper-print--card .bc")).toHaveCount(2);
  const cardPdf = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(cardPdf, "96×56mm 두 쪽").toEqual({ count: 2, sizes: ["96x56", "96x56"] });

  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  expect(await page.evaluate(() => document.body.dataset.paperPrint ?? null), "인쇄 창이 닫히면 표시를 뗌").toBeNull();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("button", { name: "A4 10장 판" }).click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".paper-print--sheet .bc-a4")).toHaveCount(2);
  await expect(page.locator(".paper-print--sheet .bc-a4").first().locator(".bc--front")).toHaveCount(10);
  await expect(page.locator(".paper-print--sheet .bc-a4").last().locator(".bc--back")).toHaveCount(10);
  await expect(page.locator(".paper-print--card")).toBeHidden();
  const sheetPdf = pdfPages(await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  expect(sheetPdf, "A4 두 쪽").toEqual({ count: 2, sizes: ["210x297", "210x297"] });

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
  expect(await page.evaluate(() => window.__printed)).toEqual(["card", "sheet", "done"]);
  assertNoErrors();
});
