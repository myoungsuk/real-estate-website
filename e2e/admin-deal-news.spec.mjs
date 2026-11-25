// 관리자 '거래 완료 소식' 화면(/admin/deal-news/, 2026-11-25 사용자 결정 17:32:49 "전부 추천대로")과 홈 0건 칸.
// 가짜 관리 API(e2e/support/admin-content-mock.mjs)와 이 파일의 가짜 업무 API(실거래 단지 찾기·건수)로만 돈다. 이름·숫자는 모두 지어낸 값이다.
import { expect, test } from "@playwright/test";
import * as content from "./support/admin-content-mock.mjs";

const WORK = "**/api/admin/v1/work";
const CONTRACT = "2026-09-01"; // 오늘(2026-11-24)에서 60일이 지난 계약일
const RECENT = "2026-11-01"; // 아직 60일이 지나지 않은 계약일
const BASIS = { from: "2026-05-24", to: "2026-11-24" };
const SALE_COMPLEX = { aptSeq: "30110-9001", aptName: "가상숲1단지(3블록 1203-1)", umdName: "천동", bands: { sale: [59, 84], jeonse: [84], "monthly-rent": [] } };
const RENT_COMPLEX = { aptSeq: "30110-9002", aptName: "가상숲2단지", umdName: "신흥동", bands: { sale: [], jeonse: [59], "monthly-rent": [74] } };
const BAD_NAME_COMPLEX = { aptSeq: "30110-9003", aptName: "가상숲 101동", umdName: "천동", bands: { sale: [84], jeonse: [], "monthly-rent": [] } };
const OLD_ITEMS = [
  { id: "dn-00000000000000a1", status: "published", placeKind: "area", umdName: "천동", propertyKind: "villa", dealType: "monthly-rent", areaBand: 33 },
  { id: "dn-00000000000000a2", status: "published", placeKind: "complex", umdName: "천동", complexName: "가상숲3단지", propertyKind: "apartment", dealType: "jeonse", areaBand: 59 },
];

async function open(page, { width, items = [], realpriceEnabled = true, complexes = [SALE_COMPLEX, RENT_COMPLEX], count = () => 4 } = {}) {
  const calls = await content.setup(page, { width, contents: { "deal-news": items } });
  Object.assign(calls, { saved: [], search: [], count: [] });
  await page.route("**/api/admin/v1/content/deal-news", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON();
    calls.saved.push(body);
    return route.fulfill(content.envelope({ resource: "deal-news", commitSha: "e2".repeat(20), contentSha: "c0".repeat(20), resourceDigest: "d1".repeat(32), savedAt: content.NOW.toISOString() }));
  });
  await page.route(`${WORK}/public-tools/session`, (route) => route.fulfill(content.envelope({ blogEnabled: false, realpriceEnabled, administrator: "시험 관리자", csrfToken: "test-csrf", schemaVersion: 7 })));
  await page.route(`${WORK}/realprice/deal-complexes**`, (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    calls.search.push(q);
    return route.fulfill(content.envelope({ available: true, items: complexes, basis: BASIS, warnings: [] }));
  });
  await page.route(`${WORK}/realprice/deal-count**`, (route) => {
    const params = Object.fromEntries(new URL(route.request().url()).searchParams);
    calls.count.push(params);
    return route.fulfill(content.envelope({ available: true, count: count(params), basis: BASIS, coverage: { complete: true, missingMonths: [] }, warnings: [] }));
  });
  const errors = [];
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  calls.errors = errors;
  await page.goto("/admin/deal-news/");
  await expect(page.locator("[data-admin-write-gate]")).toHaveClass(/admin-inline-notice--ready/u);
  await expect(page.locator("[data-dn-now-count]")).not.toBeEmpty();
  return calls;
}

const form = (page) => page.locator("[data-dn-form]");
const radio = (page, name) => form(page).getByRole("radio", { name, exact: true });
const judge = (page) => page.locator("[data-dn-judge]");
const submit = (page) => page.locator("[data-dn-submit]");
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const storageText = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));

async function fillDeal(page, { contract = CONTRACT, paid = true, seen = true } = {}) {
  await page.locator("[data-dn-contract]").fill(contract);
  if (paid) await page.locator("[data-dn-paid]").check();
  if (seen && await page.locator("[data-dn-seen]").isVisible()) await page.locator("[data-dn-seen]").check();
}

async function searchFor(page, query) {
  await page.locator("[data-dn-search]").fill(query);
  await page.locator("[data-dn-search-go]").click();
  await expect(page.locator("[data-dn-search-note]")).toContainText("곳을 찾았습니다");
}

async function confirmSave(page, calls, sentence) {
  await submit(page).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  if (sentence) await expect(dialog).toContainText(sentence);
  await dialog.getByRole("button", { name: "검증 후 최종 저장" }).click();
  await expect(page.locator("[data-dn-status]")).toContainText("GitHub에 저장했습니다");
  expect(calls.saved).toHaveLength(1);
  return calls.saved[0].data;
}

test("거래 완료 소식 1280px: 단지를 한 번 찾고 면적대를 골라 한 번 세면 단지 이름으로 올리고, 저장은 8칸뿐이며 계약일·건수는 주소·브라우저 저장소에 남지 않는다", async ({ page }) => {
  const calls = await open(page, { width: 1280 });
  // 건물 종류 5개는 한 줄(4 + 1로 꺾이지 않음)
  const kindTops = await form(page).locator("[data-dn-kind]").evaluateAll((inputs) => inputs.map((input) => Math.round(input.closest("label").getBoundingClientRect().top)));
  expect(new Set(kindTops).size).toBe(1);
  await fillDeal(page);
  await searchFor(page, "가상숲");
  await expect(page.locator("[data-dn-hits] button")).toHaveCount(2);
  await expect(page.locator("[data-dn-hits] button").nth(1)).toContainText("전세·월세 자료 · 매매 거래 없음");
  await page.locator("[data-dn-hits] button").first().click();
  await expect(page.locator("[data-dn-name]")).toHaveValue("가상숲1단지");
  await expect(page.locator("[data-dn-name-row]")).toBeHidden(); // 단지 이름 칸은 건수가 3건 이상일 때만 보인다
  await expect(page.locator("[data-dn-bands] .rt-style")).toHaveText(["59㎡대", "84㎡대", "목록에 없음"]);
  await radio(page, "84㎡대").check();
  await page.locator("[data-dn-count-go]").click();
  await expect(page.locator("[data-dn-count-result]")).toContainText("매매 4건. 3건 이상이라 단지 이름을 쓸 수 있습니다.");
  await expect(page.locator("[data-dn-count-go]")).toBeDisabled();
  await expect(page.locator("[data-dn-name-row]")).toBeVisible();
  await expect(page.locator("[data-dn-name-note]")).toContainText("괄호 안 글을 덜어 채웠습니다");
  await expect(page.locator("[data-dn-line]")).toHaveText("매매가상숲1단지전용 84㎡대");
  await expect(judge(page)).toHaveClass(/ok/u);
  await expect(judge(page)).toContainText("올릴 수 있습니다. 잔금 끝남 · 계약일에서 60일 지남 · 실거래 자료 확인");
  const saved = await confirmSave(page, calls, "가상숲1단지 · 전용 84㎡대 · 매매 (홈에 공개)");
  expect(saved).toHaveLength(1);
  expect(Object.keys(saved[0])).toEqual(["id", "status", "placeKind", "umdName", "complexName", "propertyKind", "dealType", "areaBand"]);
  expect(saved[0]).toMatchObject({ status: "published", placeKind: "complex", umdName: "천동", complexName: "가상숲1단지", propertyKind: "apartment", dealType: "sale", areaBand: 84 });
  expect(saved[0].id).toMatch(/^dn-[0-9a-f]{16}$/u);
  expect(calls.search).toEqual(["가상숲"]);
  expect(calls.count).toEqual([{ apt: "30110-9001", band: "84", deal: "sale" }]);
  // 서버 검증·저장 본문에도 계약일·건수가 없다
  const sent = JSON.stringify([calls.saved, calls.validates]);
  expect(sent).not.toContain(CONTRACT);
  expect(sent).not.toMatch(/count|contract|balance/iu);
  expect(new URL(page.url()).search).toBe("");
  expect(new URL(page.url()).hash).toBe("");
  const stored = await storageText(page);
  expect(stored).not.toContain(CONTRACT);
  expect(stored).not.toContain("가상숲");
  // 저장 뒤 입력칸은 비고 지금 목록에 붙는다
  await expect(page.locator("[data-dn-contract]")).toHaveValue("");
  await expect(page.locator("[data-dn-now] li")).toHaveCount(1);
  await expect(page.locator("[data-dn-now] li").first()).toContainText("가상숲1단지 · 전용 84㎡대 · 매매");
  expect(calls.errors).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
});

test("거래 완료 소식 390px: 60일·잔금이 막으면 까닭과 풀리는 날을 보이고, 괄호를 덜어도 남는 동 번호는 검사가 막아 직접 고치게 한다", async ({ page }) => {
  const calls = await open(page, { width: 390, complexes: [BAD_NAME_COMPLEX] });
  await fillDeal(page, { contract: RECENT, paid: false, seen: false });
  await expect(judge(page)).toHaveClass(/no/u);
  await expect(judge(page)).toContainText("계약일에서 60일이 지난 뒤에 올릴 수 있습니다(2027년 1월 1일부터).");
  await expect(judge(page)).toContainText("잔금이 끝난 거래만 올릴 수 있습니다.");
  await expect(judge(page)).toContainText("매매는 실거래 자료에 이 거래가 올라온 것을 확인한 뒤에 올릴 수 있습니다.");
  await expect(submit(page)).toBeDisabled();
  await page.locator("[data-dn-contract]").fill(CONTRACT);
  await page.locator("[data-dn-paid]").check();
  await page.locator("[data-dn-seen]").check();
  await searchFor(page, "가상숲");
  await page.locator("[data-dn-hits] button").first().click();
  await radio(page, "84㎡대").check();
  // 키보드로 누르면 단추가 꺼진 뒤 초점이 결과 문단으로 간다(body로 빠지지 않음).
  await page.locator("[data-dn-count-go]").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-dn-count-result]")).toBeFocused();
  await expect(page.locator("[data-dn-name]")).toHaveValue("가상숲 101동");
  await expect(page.locator("[data-dn-name-note]")).toHaveClass(/dn-bad/u);
  await expect(page.locator("[data-dn-name-note]")).toContainText("직접 고쳐 주세요");
  await expect(submit(page)).toBeDisabled();
  await page.locator("[data-dn-name]").fill("가상숲");
  await expect(page.locator("[data-dn-name-note]")).not.toHaveClass(/dn-bad/u);
  await expect(submit(page)).toBeEnabled();
  expect(calls.saved).toHaveLength(0);
  expect(calls.errors).toEqual([]);
  expect(await noOverflow(page)).toBe(true);
});

test("거래 완료 소식: 전세·월세 자료에만 있는 단지도 찾고, 3건보다 적으면 동네 이름으로 올린다(단지 이름 칸 없음)", async ({ page }) => {
  const calls = await open(page, { width: 768, count: () => 2 });
  await radio(page, "전세").check();
  await fillDeal(page);
  await expect(page.locator("[data-dn-seen-row]")).toBeHidden();
  await searchFor(page, "가상숲2");
  await page.locator("[data-dn-hits] button").nth(1).click();
  await expect(page.locator("[data-dn-hits] button").nth(1)).toContainText("신흥동 · 전세·월세 자료");
  await expect(page.locator("[data-dn-bands] .rt-style")).toHaveText(["59㎡대", "목록에 없음"]);
  await radio(page, "59㎡대").check();
  await page.locator("[data-dn-count-go]").click();
  await expect(page.locator("[data-dn-count-result]")).toHaveClass(/is-area/u);
  await expect(page.locator("[data-dn-count-result]")).toContainText("전세 2건. 3건보다 적어 동네 이름으로 올립니다.");
  await expect(page.locator("[data-dn-name-row]")).toBeHidden();
  await expect(page.locator("[data-dn-line]")).toHaveText("전세신흥동 아파트전용 59㎡대");
  const saved = await confirmSave(page, calls, "신흥동 아파트 · 전용 59㎡대 · 전세 (홈에 공개)");
  expect(saved[0]).toMatchObject({ placeKind: "area", umdName: "신흥동", propertyKind: "apartment", dealType: "jeonse", areaBand: 59 });
  expect(saved[0]).not.toHaveProperty("complexName");
  expect(calls.count).toEqual([{ apt: "30110-9002", band: "59", deal: "jeonse" }]);
  expect(await noOverflow(page)).toBe(true);
});

test("거래 완료 소식: 지금 목록에서 지우기도 저장 전 확인을 거치고, 실거래가가 꺼져 있으면 찾기 없이 동네 이름으로만 올린다(360px)", async ({ page }) => {
  const calls = await open(page, { width: 360, items: OLD_ITEMS, realpriceEnabled: false });
  await expect(page.locator("[data-dn-now] li")).toHaveCount(2);
  await expect(page.locator("[data-dn-now] li").first()).toContainText("가상숲3단지");
  await expect(page.locator("[data-dn-complex-part]")).toBeHidden();
  await expect(page.locator("[data-dn-area-row]")).toBeVisible();
  await expect(page.locator("[data-dn-umd-row]")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.locator("[data-dn-now] li").first().getByRole("button", { name: "홈에서 지우기" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "검증 후 최종 저장" }).click();
  await expect(page.locator("[data-dn-status]")).toContainText("소식을 지웠습니다");
  expect(calls.saved).toHaveLength(1);
  expect(calls.saved[0].data.map((item) => item.id)).toEqual(["dn-00000000000000a1"]);
  await expect(page.locator("[data-dn-now] li")).toHaveCount(1);
  expect(calls.search).toEqual([]);
  expect(calls.count).toEqual([]);
  expect(calls.errors).toEqual([]);
});

test("홈: 공개한 소식이 0건이면 '최근 거래 완료 소식' 칸을 그리지 않는다", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-deals")).toHaveCount(0);
  await expect(page.getByText("최근 거래 완료 소식")).toHaveCount(0);
});
