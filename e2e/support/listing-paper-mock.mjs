// 매물 안내지 시험(e2e/admin-listing-paper.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 도우미.
// 2026-11-24 시험 파일에서 그대로 옮김. 매물은 공개 네이버 매물(src/data/naver-listings.json)이고 넣는 값(소재지 등)은 지어낸 값이다.
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";

export const NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00
export const PAGE = "/admin/work/listing-paper/";
export const PRODUCTION_CSP = /^\s*Content-Security-Policy: (.+)$/mu.exec(readFileSync(new URL("../../public/_headers", import.meta.url), "utf8"))[1];
export const naver = JSON.parse(readFileSync(new URL("../../src/data/naver-listings.json", import.meta.url), "utf8"));
export const pngSize = (bytes) => ({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), signature: bytes.subarray(1, 4).toString("ascii") });
export const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 보이는 명시사항 선택 단추(.bl-seg)마다 글자 노드가 놓인 줄 수를 세어 두 줄 이상인 단추 이름을 돌려준다.
// 좁은 폭에서 '다세대주택'·'위반건축물'이 두 줄로 꺾이면 단추가 높아져 아래 칸이 밀린다.
export const twoLineChoices = (page) => page.evaluate(() => [...document.querySelectorAll(".bl-seg .work-choice")].filter((choice) => choice.offsetParent).flatMap((choice) => {
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
export async function expectOneLineChoices(page, label) {
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
// 이 화면은 빌드 때 공개 naver-listings.json으로 그려져 가상 매물을 넣을 수 없고, 매물은 매일 부동산뱅크 동기화로 바뀐다.
// 그래서 번호를 박지 않고 조건으로 고르며, 모자라면 그 시험(또는 그 대목)만 까닭을 남기고 건너뛴다.
// 잠금 규칙(분양권 잠금·매매와 월세 섞지 않음·3건 상한)은 tests/work-listing-paper.test.mjs가 가상 매물로 늘 본다.
export const SHORT_OF = (what, count) => `공개 매물에 ${what}이(가) ${count}건 모자라 건너뜀(매물 동기화로 바뀜, 잠금 규칙은 tests/work-listing-paper.test.mjs가 봄)`;
export const saleApartments = naver.items.filter((item) => item.tradeType === "sale" && item.propertyType === "아파트" && /^\d+\/\d+층$/u.test(item.floorLabel ?? ""));
export const rentApartment = naver.items.find((item) => item.tradeType !== "sale" && item.propertyType === "아파트");
export const presale = naver.items.find((item) => item.propertyType === "아파트분양권");

export function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}

// 운영 CSP를 이 화면 응답에 붙이고 위반을 모은다. 서버 요청이 하나라도 나가면 모은다(이 화면은 서버를 부르지 않음).
export async function setup(page, width = 390) {
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

export const row = (page, id, key) => page.locator(`[data-lp-form='${id}'] [data-bl-row='${key}']`);
// 공동주택 명시사항 칸을 모두 채운다(층·총 층수는 공개 자료에서 이미 채워져 있음).
export async function fillApartment(page, id, { location = "대전광역시 동구 가상동 100", fee = "250000" } = {}) {
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
