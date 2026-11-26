// 매출장부(단계 2, /admin/work/ledger/)와 손님 카드의 거래 장부 칸을 가짜 업무 API로 본다.
// 사용자 선택 2026-11-21 03:09:45: 메뉴 B안(업무 도구 아래 단계를 '손님·돈'·'상담 도구'·'홍보 만들기' 묶음으로), 시안 "이 시안대로".
// 거래·물건 표시·금액은 모두 지어낸 값(가상숲1단지 등)이고 실제 서버·D1은 부르지 않는다.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  NOW,
  uuid,
  envelope,
  failure,
  DEAL_A,
  DEAL_B,
  deals,
  entry,
  makeStore,
  unpaidOf,
  publicEntry,
  summaryOf,
  setup,
  gridRow,
  gridCell,
  gridInput,
  gridState,
  noteOf,
} from "./support/ledger-mock.mjs";

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 화면 주소·브라우저 저장소에 물건 표시·메모·금액이 남지 않았는지
async function expectNoTrace(page) {
  expect(decodeURIComponent(page.url())).toMatch(/\/admin\/work\/(ledger|customers\/detail)\/(\?id=[0-9a-f-]+)?$/u);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}
// 장부 줄만 센다(PC 표의 합계 줄·달 줄·줄 아래 알림 줄은 장부 줄이 아님)
const visibleRows = (page) => page.locator(".lg-rows > li:visible, .lg-table tbody tr[data-lg-entry]:visible");

test("업무 세션이 꺼져 있으면 매출장부가 켜지지 않았다고 알리고 장부 자료는 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, enabled: false });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "업무 도구가 꺼져 있습니다" })).toBeVisible();
  await expect(page.getByRole("link", { name: "중개보수 계산으로" })).toBeVisible();
  expect(calls.all).toEqual(["GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("자료 구조가 옛날(5번 전)이면 갱신 전이라고 알리고, 잠깐 실패면 '다시 불러오기'로 다시 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, schemaOutdated: true });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-lg-state-body]")).toContainText("구조(5번)");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();

  await setup(page, { width: 360, failSummaryOnce: true });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "매출장부를 불러오지 못했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByRole("heading", { name: /2026년 합계/u })).toBeVisible();
  assertNoErrors();
});

for (const width of [360, 390, 1280]) {
  test(`매출장부 ${width}px: 합계 칸·달별 표(1221px 이상은 표 안 합계 줄)·기준일 없는 줄 알림, 부가세 단추는 다시 부르지 않고, 거르기는 서버에 묻고, 가로 넘침 없음`, async ({ page }) => {
    // 1221px 이상은 합계 칸·달별 표·부가세 단추를 숨기고 표 안의 합계 줄·달 줄로 본다(D-2a)
    const wide = width >= 1221;
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await page.goto("/admin/work/ledger/");
    await expect(page.locator("[data-lg-year]")).toHaveText("2026년");
    expect(calls.all).toEqual(expect.arrayContaining(["GET /session", "GET /ledger/summary?year=2026&basis=balance", "GET /ledger?year=2026&basis=balance&limit=50"]));
    const tiles = page.locator("[data-lg-tiles] .lg-tile");
    if (wide) await expect(page.locator(".lg-sum")).toBeHidden();
    else await expect(page.locator(".lg-sum")).toBeVisible();
    await expect(page.locator(".lg-history"), "되돌리기·다시 하기는 표가 보일 때만").toBeVisible({ visible: wide });
    await expect(page.locator("[data-lg-keys]")).toBeVisible({ visible: wide });
    await expect(tiles).toHaveCount(5);
    await expect(tiles.nth(0)).toContainText("3,600,000원");
    await expect(tiles.nth(2)).toContainText("미입금1,980,000원");
    // 입금·미입금은 부가세 빼고에서도 부가세 포함(표시로 밝힘)
    await expect(tiles.nth(1)).toContainText("부가세 포함 · 보수와 기타 수입");
    await expect(tiles.nth(2)).toContainText("부가세 포함 · 보수와 기타 수입");
    if (width < 980) await expect(page.getByText("미입금은 부가세를 포함한 금액입니다(보수와 기타 수입).")).toBeVisible();
    else await expect(page.locator("[data-lg-wide-head]")).toContainText("미입금(부가세 포함)");
    await expect(page.locator("[data-lg-basis-note]")).toHaveText("· 잔금일 기준");
    // 기준일 없는 줄: 합계 위 알림과 CSV 단추 옆 안내
    await expect(page.locator("[data-lg-undated-text]")).toHaveText("잔금일이 없는 장부 줄 1건은 합계에 없습니다.");
    await expect(page.locator("[data-lg-csv-note]")).toHaveText("기준일이 없는 장부 줄 1건은 파일에 들어가지 않습니다.");
    // 좁은 화면은 값 있는 달만, 넓은 화면(980px 이상)은 12달 표
    if (width < 980) {
      await expect(page.locator("[data-lg-narrow] tr")).toHaveCount(2);
      await expect(page.locator("[data-lg-narrow] tr").first()).toContainText("11월");
      await expect(page.locator("[data-lg-empty-months]")).toHaveText("1 ~ 9월, 12월은 장부 줄이 없습니다.");
    } else {
      await expect(page.locator("[data-lg-wide] tr")).toHaveCount(12);
      await expect(page.locator("[data-lg-wide-total]")).toContainText("3,600,000원");
    }
    // 1220px 이하 카드, 1221px 이상 표
    await expect(visibleRows(page)).toHaveCount(4);
    await expect(page.locator(width >= 1221 ? ".lg-table" : ".lg-rows")).toBeVisible();
    await expect(page.locator(width >= 1221 ? ".lg-rows" : ".lg-table")).toBeHidden();
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 4개 · 기준일 최근 순");
    await expect(visibleRows(page).filter({ hasText: wide ? "미입금 1,980,000" : "미입금 1,980,000원" })).toHaveCount(1);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);

    if (!wide) {
      const before = calls.all.length;
      await page.getByRole("button", { name: "부가세 넣고" }).click();
      await expect(page.getByRole("button", { name: "부가세 넣고" })).toHaveAttribute("aria-pressed", "true");
      await expect(tiles.nth(0)).toContainText("3,960,000원");
      expect(calls.all.length, "부가세 단추는 서버를 다시 부르지 않음").toBe(before);
    }

    await page.getByRole("button", { name: "입금일", exact: true }).click();
    await expect(page.locator("[data-lg-basis-note]")).toHaveText("· 입금일 기준 · 지출은 잔금일(거래 없는 지출은 지출일)로 셈");
    await expect(page.locator("[data-lg-undated-text]")).toContainText("입금일이 없는 장부 줄 2건(아직 입금 전 포함)");
    expect(calls.all).toContain("GET /ledger?year=2026&basis=received&limit=50");

    await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
    await expect(page.getByRole("button", { name: /^(✓ )?미입금만$/u })).toHaveAttribute("aria-pressed", "true");
    // 입금일 기준 + 미입금만: 연도 없이 모든 해의 미입금 줄(기준일 없는 줄 포함)과 안내 줄
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 2개 · 미입금 큰 순");
    expect(calls.all).toContain("GET /ledger?basis=received&unpaid=1&limit=50");
    expect(calls.all.filter((call) => call.startsWith("GET /ledger?") && call.includes("unpaid=1") && call.includes("year="))).toEqual([]);
    await expect(page.locator("[data-lg-unpaid-note]")).toHaveText("입금일 기준에서는 미입금 줄을 연도와 상관없이 모두 보여 줍니다(아직 입금일이 없으므로).");
    await expect(visibleRows(page).first()).toContainText(wide ? "미입금 1,980,000" : "미입금 1,980,000원");
    // 잔금일 기준으로 바꾸면 다시 연도로 거르고 안내 줄은 숨김
    await page.getByRole("button", { name: /^(✓ )?잔금일$/u }).click();
    await expect(page.locator("[data-lg-unpaid-note]")).toBeHidden();
    expect(calls.all).toContain("GET /ledger?year=2026&basis=balance&unpaid=1&limit=50");
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 1개 · 미입금 큰 순");
    await page.getByRole("button", { name: /^(✓ )?입금일$/u }).click();
    await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
    await expect(page.locator("[data-lg-unpaid-note]")).toBeHidden();
    await page.getByRole("button", { name: "지출", exact: true }).click();
    await expect(visibleRows(page)).toHaveCount(1);
    expect(calls.all).toContain("GET /ledger?year=2026&basis=received&kind=expense&limit=50");

    await page.getByRole("button", { name: "앞 해" }).click();
    await expect(page.locator("[data-lg-year]")).toHaveText("2025년");
    await expect(page.getByRole("button", { name: "다음 해" })).toBeEnabled();
    await expectNoTrace(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("기준일 없는 줄: '그 줄만 보기'는 연도 없이 읽어 기준일이 빈 줄만 보이고, 경고는 글자로 굵게 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "그 줄만 보기" }).click();
  await expect(page.locator("[data-lg-count]")).toHaveText("잔금일이 없는 장부 줄 1개");
  expect(calls.all.at(-1), "연도 없이 읽음").toBe("GET /ledger?basis=balance&limit=50");
  await expect(visibleRows(page)).toHaveCount(1);
  await expect(visibleRows(page).first()).toContainText("기준일 없음");
  await expect(visibleRows(page).first().locator(".lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 90,000원)");
  await expect(page.locator("[data-lg-chips]")).toBeHidden();
  await page.getByRole("button", { name: "전체 줄로 돌아가기" }).click();
  await expect(visibleRows(page)).toHaveCount(4);
  assertNoErrors();
});

test("장부 줄 만들기: 거래 없는 지출은 날짜가 꼭 있어야 하고, 저장은 CSRF로 보낸 뒤 목록·합계를 다시 읽어 그 줄을 강조한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "장부 줄 만들기" }).first().click();
  await expect(page.getByRole("radio", { name: "보수" })).toBeFocused();
  await page.getByRole("radio", { name: "지출" }).check();
  await expect(page.locator("[data-lg-payer-row]")).toBeHidden();
  await expect(page.locator("[data-lg-received-row]")).toBeHidden();
  await expect(page.locator("[data-lg-entry-help]")).toContainText("입금일 기준에서도 같음");
  await page.locator("#lg-entry-on").fill("");
  await page.locator("#lg-label").fill("가상 사무실 소모품");
  await page.locator("#lg-amount").fill("33,000");
  await expect(page.locator("[data-lg-total]")).toHaveText("합계 33,000원");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("#lg-entry-error")).toHaveText("거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.");
  await expect(page.locator("#lg-entry-on")).toBeFocused();
  expect(calls.writes).toEqual([]);
  await page.locator("#lg-entry-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 저장했습니다.");
  expect(calls.writes).toEqual([{ method: "POST", path: "/ledger", csrf: "test-csrf", body: { kind: "expense", amountWon: 33_000, vatWon: 0, receivedWon: 0, receivedOn: null, entryOn: "2026-11-21", label: "가상 사무실 소모품", memo: "" } }]);
  await expect(page.locator(".lg-row.is-saved")).toContainText("가상 사무실 소모품");
  await expect(page.locator("[data-lg-form]")).toBeHidden();
  await expectNoTrace(page);
  assertNoErrors();
});

test("보수 줄: 주택 거래를 찾아 고르면 '상한으로 채우기'로 법정 상한을 넣고, 저장 뒤 경고(10%와 다른 부가세)를 굵게 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "장부 줄 만들기" }).first().click();
  await page.locator("#lg-deal-q").fill("가상");
  await page.locator("#lg-deal-q").press("Enter");
  expect(decodeURIComponent(calls.all.at(-1))).toBe("GET /deals?limit=5&q=가상");
  await expect(page.getByRole("radio", { name: "거래에 잇지 않음" })).toBeChecked();
  await page.getByRole("radio", { name: /가상강변마을 오피스텔 전세/u }).check();
  await expect(page.locator("[data-lg-cap-text]")).toContainText("주택이 아닌 거래");
  await expect(page.getByRole("button", { name: "상한으로 채우기" })).toBeHidden();
  await page.getByRole("radio", { name: /가상숲1단지 84㎡ 매매/u }).check();
  await expect(page.locator("[data-lg-cap-text]")).toHaveText("법정 상한 1,800,000원 + 부가세 180,000원 (계약일 기준 요율, 한쪽 의뢰인 기준)");
  await expect(page.locator("[data-lg-entry-row]")).toBeHidden();
  await expect(page.locator("#lg-label")).toHaveValue("가상숲1단지 84㎡ 매매");
  await page.getByRole("button", { name: "상한으로 채우기" }).click();
  await expect(page.locator("#lg-amount")).toHaveValue("1,800,000");
  await expect(page.locator("#lg-vat")).toHaveValue("180,000");
  await page.locator("#lg-vat").fill("100,000");
  await page.getByRole("radio", { name: "매도인" }).check();
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toContainText("굵은 경고를 확인하세요");
  expect(calls.writes.at(-1).body).toEqual({ kind: "fee", amountWon: 1_800_000, vatWon: 100_000, receivedWon: 0, receivedOn: null, label: "가상숲1단지 84㎡ 매매", memo: "", payerRole: "seller", dealId: DEAL_A });
  await expect(page.locator(".lg-table tr.is-saved .lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 180,000원)");
  assertNoErrors();
});

test("고치기: 바뀐 칸만 version과 함께 보내고, 409면 넣던 값을 지우지 않고 '새 값 보기'로 저장된 값을 다시 채운다. 지우기는 한 번 더 묻는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390, conflictOnce: true });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "가상숲1단지 84㎡ 매매 보수 장부 줄 고치기" }).nth(1).click();
  await expect(page.locator("[data-lg-form-title]")).toHaveText("장부 줄 고치기");
  await expect(page.locator("[data-lg-kind-row]")).toBeHidden();
  await expect(page.locator("[data-lg-fixed]")).toContainText("거래에 이은 줄");
  await expect(page.locator("#lg-amount")).toBeFocused();
  await page.locator("#lg-received").fill("1,980,000");
  await page.locator("#lg-received-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-form-status]")).toContainText("다른 곳에서 먼저 고쳤거나");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", body: { receivedWon: 1_980_000, receivedOn: "2026-11-21", version: 1 } });
  await expect(page.locator("#lg-received")).toHaveValue("1,980,000");
  await page.getByRole("button", { name: "새 값 보기" }).click();
  await expect(page.locator("[data-lg-form-status]")).toHaveText("새 값을 불러왔습니다. 다시 고친 뒤 저장해 주세요.");
  await expect(page.locator("#lg-memo")).toHaveValue("다른 화면에서 고친 메모");
  await page.locator("#lg-received").fill("1,980,000");
  await page.locator("#lg-received-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 저장했습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", body: { receivedWon: 1_980_000, receivedOn: "2026-11-21", version: 2 } });

  await page.locator(".lg-row", { hasText: "가상 전단 인쇄" }).getByRole("button", { name: /고치기/u }).click();
  await page.getByRole("button", { name: "이 장부 줄 지우기" }).click();
  await expect(page.getByRole("button", { name: "지우기", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 휴지통으로 옮겼습니다. 되살리기 · 휴지통 보기");
  expect(calls.writes.at(-1)).toMatchObject({ method: "DELETE", path: `/ledger/${uuid(303)}` });
  await expect(page.locator(".lg-row", { hasText: "가상 전단 인쇄" })).toHaveCount(0);
  assertNoErrors();
});

test("CSV: 작업 기록(POST /ledger/export)을 남긴 뒤에만 BOM·수식 막기 파일을 내려받고, 기록이 실패하면 내려받지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/ledger/");
  await expect(visibleRows(page)).toHaveCount(4);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("매출장부-2026-잔금일기준.csv");
  expect(calls.writes.at(-1)).toEqual({ method: "POST", path: "/ledger/export", csrf: "test-csrf", body: { year: 2026, basis: "balance", count: 4 } });
  const text = await readFile(await download.path(), "utf8");
  expect(text.startsWith("﻿기준일,종류,")).toBe(true);
  expect(text.split("\r\n")).toHaveLength(6);
  await expect(page.locator("[data-lg-csv-status]")).toContainText("(장부 줄 4개)을 내려받았습니다");
  await expect(page.getByRole("link", { name: "CSV 파일 저장" })).toBeVisible();

  calls = await setup(page, { width: 390, failExport: true });
  await page.goto("/admin/work/ledger/");
  await expect(visibleRows(page)).toHaveCount(4);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  await expect(page.locator("[data-lg-csv-status]")).toHaveText("내려받지 않았습니다. 작업 기록을 남기지 못해 파일을 만들지 않았습니다. 잠시 뒤 다시 해 주세요.");
  await expect(page.getByRole("link", { name: "CSV 파일 저장" })).toBeHidden();
  expect(downloaded).toBe(false);
  expect(calls.writes.at(-1).path).toBe("/ledger/export");
  assertNoErrors();
});

test("장부 줄이 하나도 없으면 합계 칸 대신 0건 안내와 '장부 줄 만들기'를 보이고, CSV 안내는 숨긴다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, store: makeStore({ empty: true }) });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "2026년 장부 줄이 없습니다" })).toBeVisible();
  await expect(page.locator("[data-lg-sum]")).toBeHidden();
  await expect(page.locator("[data-lg-undated]")).toBeHidden();
  await expect(page.locator("[data-lg-csv-note]")).toBeHidden();
  await page.locator("[data-lg-empty-new]").click();
  await expect(page.locator("[data-lg-form]")).toBeVisible();
  assertNoErrors();
});

for (const width of [360, 1280]) {
  test(`메뉴 B안 ${width}px: 업무 도구 아래 단계(위 알약 줄)는 묶음마다 role=group(aria-labelledby), 순서·Tab 차례가 같고 매출장부가 지금 화면`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    await setup(page, { width });
    await page.goto("/admin/work/ledger/");
    const menu = page.locator(".admin-subtabs");
    await expect(menu, "PC도 위 알약 줄(왼쪽 목록 없음)").toBeVisible();
    await expect(page.locator(".admin-side")).toHaveCount(0);
    for (const [name, links] of [["손님·돈", ["손님", "매출장부"]], ["상담 도구", ["중개보수 계산", "안내 문자", "계약 일정", "실거래가"]], ["홍보 만들기", ["글 초안", "홍보 종이", "매물 안내지"]]]) {
      const group = menu.getByRole("group", { name });
      await expect(group).toHaveCount(1);
      await expect(group.getByRole("link")).toHaveText(links);
    }
    const current = menu.getByRole("link", { name: "매출장부" });
    await expect(current).toHaveAttribute("aria-current", "page");
    // 2026-11-26 사용자 답 08:59:51: 알약 순서 도구 모음 · 달력 · 할 일
    const hrefs = ["/admin/work/", "/admin/work/calendar/", "/admin/work/tasks/", "/admin/work/customers/", "/admin/work/ledger/", "/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/", "/admin/work/realprice/", "/admin/work/blog/", "/admin/work/paper/", "/admin/work/listing-paper/"];
    await menu.locator('a[href="/admin/work/"]').last().focus();
    const order = [];
    for (let index = 0; index < hrefs.length; index += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("href")));
      await page.keyboard.press("Tab");
    }
    expect(order, "Tab 차례 = 보이는 차례").toEqual(hrefs);
    if (width < 980) {
      // 작은 탭은 한 줄(49px), 지금 탭은 처음부터 화면 안
      const strip = await page.locator(".admin-subtabs").boundingBox();
      expect(Math.round(strip.height)).toBeLessThanOrEqual(49);
      await page.goto("/admin/work/ledger/");
      const box = await current.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // 묶음 제목은 화면 읽기 프로그램에만(작은 탭)
      await expect(page.locator(".admin-subtabs__group > .sr-only").first()).toHaveText("손님·돈");
    } else {
      // PC 위 줄: 로고 · 알약 · 전체 메뉴가 한 줄이고, 묶음 제목은 화면 읽기 프로그램에만(전체 메뉴 창에서는 보이는 제목)
      await expect(page.locator(".admin-subtabs__group > .sr-only").first()).toHaveText("손님·돈");
      const bar = await page.locator(".admin-bar").boundingBox();
      expect(Math.round(bar.height), "위 한 줄").toBeLessThanOrEqual(61);
      await expect(page.locator(".admin-tabbar")).toBeHidden();
      await page.getByRole("button", { name: "전체 메뉴" }).click();
      const sheet = page.getByRole("dialog", { name: "전체 메뉴" });
      await expect(sheet.locator(".admin-menu__subhead").first()).toBeVisible();
      await expect(sheet.getByRole("link", { name: "매출장부" })).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

for (const width of [360, 1280]) {
  test(`손님 카드 ${width}px 거래의 장부 칸: '장부 보기'를 눌렀을 때만 거래·장부를 읽고, 쌍방 보수 줄 두 개를 한 번에 만든다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const store = makeStore();
    store.entries = store.entries.filter((item) => item.dealId !== DEAL_A);
    const calls = await setup(page, { width, store });
    await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
    const toggle = page.locator(`[data-cu-ledger-toggle="${DEAL_A}"]`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(calls.all.filter((call) => call.startsWith("GET /deals") || call.startsWith("GET /ledger")), "열기 전에는 부르지 않음").toEqual([]);
    await toggle.click();
    await expect(toggle).toHaveText("장부 접기");
    const panel = page.locator(`[data-cu-ledger="${DEAL_A}"]`);
    await expect(panel.locator("h4")).toHaveText("장부 아직 없음");
    expect(calls.all).toEqual(expect.arrayContaining([`GET /deals/${DEAL_A}`, `GET /ledger?basis=balance&dealId=${DEAL_A}&limit=50`]));
    await expect(panel.getByRole("link", { name: "매출장부에서 보기" })).toHaveAttribute("href", "/admin/work/ledger/");
    await panel.getByRole("button", { name: "보수 줄 만들기" }).click();
    await expect(panel.locator(".lg-cap")).toContainText("법정 상한 1,800,000원 + 부가세 180,000원");
    // 매수인·매도인 둘 다 이 거래의 손님이라 쌍방으로 둘 다 골라짐
    await expect(panel.getByRole("checkbox", { name: "매수인" })).toBeChecked();
    await expect(panel.getByRole("checkbox", { name: "매도인" })).toBeChecked();
    await expect(panel.getByRole("button", { name: "보수 줄 2개 저장" })).toBeVisible();
    await panel.locator(`#cu-lg-${DEAL_A}-buyer-received`).fill("1,980,000");
    await panel.getByRole("button", { name: "보수 줄 2개 저장" }).click();
    await expect(panel.locator(`#cu-lg-${DEAL_A}-buyer-receivedOn-error`)).toHaveText("입금액이 있으면 입금일을 넣어 주세요.");
    expect(calls.writes).toEqual([]);
    await panel.locator(`#cu-lg-${DEAL_A}-buyer-receivedOn`).fill("2026-11-20");
    await panel.getByRole("button", { name: "보수 줄 2개 저장" }).click();
    await expect(panel.locator("h4")).toHaveText("장부 2줄 · 미입금 1,980,000원");
    await expect(panel.getByRole("status").filter({ hasText: "✓ 보수 줄 2개를 저장했습니다." })).toBeVisible();
    expect(calls.writes.map((write) => write.body)).toEqual([
      { kind: "fee", dealId: DEAL_A, payerRole: "buyer", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_980_000, receivedOn: "2026-11-20", memo: "" },
      { kind: "fee", dealId: DEAL_A, payerRole: "seller", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 0, receivedOn: null, memo: "" },
    ]);
    await expect(panel.locator("li")).toHaveCount(2);
    await expect(panel.locator("li").nth(0)).toContainText("입금 끝 11. 20.");
    // 오피스텔 전세는 상한을 채우지 않고 까닭만 알림
    await page.getByRole("button", { name: "장부 보기" }).click();
    const other = page.locator(`[data-cu-ledger="${DEAL_B}"]`);
    await other.getByRole("button", { name: "보수 줄 만들기" }).click();
    await expect(other.locator(".lg-cap")).toContainText("주택이 아닌 거래");
    await expect(other.getByRole("checkbox", { name: "임차인" })).toBeChecked();
    await expect(other.getByRole("checkbox", { name: "임대인" })).not.toBeChecked();
    await expect(other.locator(`#cu-lg-${DEAL_B}-tenant-amount`)).toHaveValue("");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expectNoTrace(page);
    assertNoErrors();
  });
}

// ── PC 표에서 칸을 바로 고치기(D-2a, 1221px 이상. 사용자 승인 2026-11-23 11:34:13 "이대로 구현"·"10%였던 줄만 함께 바꿈") ──
const patches = (calls) => calls.writes.filter((write) => write.method === "PATCH");
const countCalls = (calls, head) => calls.all.filter((call) => call.startsWith(head)).length;
const tableOrder = (page) => page.locator(".lg-table tbody > tr:not(.lg-noterow)").evaluateAll((rows) => rows.map((row) => (row.dataset.lgEntry ? "줄" : row.dataset.lgNewrow !== undefined ? "새 줄" : row.querySelector("strong").textContent)));
const leaveWarned = (page) => page.evaluate(() => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});
async function typeCell(page, n, column, text, key = "Enter") {
  await gridCell(page, n, column).click();
  await gridInput(page, n, column).fill(text);
  if (key) await gridInput(page, n, column).press(key);
}

test("PC 표 1280px: 합계 칸 대신 표 안의 합계 줄·달 줄(서버 합계 그대로)을 보이고, 거르면 그 줄은 없으며, 칸은 11개다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await expect(page.locator(".lg-table")).toBeVisible();
  await expect(page.locator(".lg-sum"), "합계 칸·달별 표·부가세 단추는 PC에서 숨김").toBeHidden();
  await expect(page.locator(".lg-table thead th")).toHaveText(["기준일", "종류", "물건 표시·내용", "낸 쪽", "공급가액(원)", "부가세(원)", "받을 금액자동", "입금액(원)", "입금일", "미입금", "줄 상태·고치기·지우기"]);
  expect(await tableOrder(page)).toEqual(["2026년 합계", "새 줄", "11월", "줄", "줄", "줄", "10월", "줄"]);
  // 숫자는 '받을 금액'·'입금액'·'미입금' 세 칸만(공급가액·부가세 칸은 묶음 제목 글에)
  const total = page.locator("tr.lg-group--total");
  await expect(total.locator("th")).toHaveText("2026년 합계보수 3,600,000원 + 부가세 360,000원 · 기타 수입 300,000원 · 지출 50,000원 · 순수익 3,850,000원");
  await expect(total.locator("th")).toHaveAttribute("colspan", "6");
  // 순수익 값만 굵게·본문색(합계 칸을 숨긴 PC에서 순수익이 보이는 곳이 이 줄뿐)
  await expect(total.locator("th .lg-net")).toHaveText("3,850,000원");
  await expect(page.locator("tr.lg-group .lg-net")).toHaveText(["3,850,000원", "3,550,000원", "300,000원"]);
  expect(await total.locator("th").evaluate((head) => {
    const note = getComputedStyle(head.querySelector("small"));
    const net = getComputedStyle(head.querySelector(".lg-net"));
    return [Number(net.fontWeight) >= 700, Number(note.fontWeight) < 700, net.color !== note.color, net.fontSize === note.fontSize].join(",");
  }), "순수익 값: 굵게, 나머지 글과 다른 색, 글자 크기는 같음").toBe("true,true,true,true");
  await expect(total.locator("td")).toHaveText(["4,260,000", "2,280,000", "", "! 1,980,000", ""]);
  const months = page.locator("tr.lg-group:not(.lg-group--total)");
  await expect(months.nth(0).locator("th")).toHaveText("11월보수 3,600,000원 + 부가세 360,000원 · 지출 50,000원 · 순수익 3,550,000원");
  await expect(months.nth(0).locator("td")).toHaveText(["3,960,000", "1,980,000", "", "! 1,980,000", ""]);
  await expect(months.nth(1).locator("th"), "0인 것(보수·지출)은 쓰지 않음").toHaveText("10월기타 수입 300,000원 · 순수익 300,000원");
  await expect(months.nth(1).locator("td")).toHaveText(["300,000", "300,000", "", "—", ""]);
  await expect(page.locator("tr.lg-group [data-lg-cell], tr.lg-group button"), "묶음 줄은 고치는 칸이 아님").toHaveCount(0);
  // 장부 줄 11칸: 거래에 이은 줄의 날짜·종류·받을 금액·미입금은 글, 나머지는 칸 단추
  await expect(gridRow(page, 2).locator("td")).toHaveText(["11. 20. (거래의 날짜, 여기서 고치지 않음)", "보수", "가상숲1단지 84㎡ 매매", "매도인", "1,800,000", "180,000", "1,980,000", "0", "", "미입금 1,980,000", "고치기"]);
  await expect(gridRow(page, 1).locator("td").nth(9)).toHaveText("입금 끝");
  await expect(gridRow(page, 3).locator("td")).toHaveText(["11. 2.", "지출", "가상 전단 인쇄", "—", "50,000", "—", "", "—", "—", "—", "고치기"]);
  expect(await gridRow(page, 2).locator("[data-lg-cell]").evaluateAll((cells) => cells.map((cell) => cell.dataset.lgCell))).toEqual(["label", "payerRole", "amountWon", "vatWon", "receivedWon", "receivedOn"]);
  expect(await gridRow(page, 3).locator("[data-lg-cell]").evaluateAll((cells) => cells.map((cell) => cell.dataset.lgCell)), "지출: 낸 쪽·입금 칸 없음, 거래 없는 줄이라 날짜는 고침").toEqual(["basisOn", "label", "amountWon", "vatWon"]);
  await expect(gridCell(page, 2, "receivedOn"), "빈 칸도 이름이 있음").toHaveAccessibleName("11. 20. 가상숲1단지 84㎡ 매매 매도인 입금일 고치기");
  // 칸 단추는 칸을 꽉 채우고 마우스 PC에서 36px
  const cellBox = await gridCell(page, 2, "receivedOn").boundingBox();
  const tdBox = await gridRow(page, 2).locator('[data-lg-col="receivedOn"]').boundingBox();
  expect(cellBox.height, "칸 단추 높이").toBeGreaterThanOrEqual(36);
  expect(Math.abs(cellBox.width - tdBox.width), "칸 단추가 칸 폭을 채움").toBeLessThanOrEqual(2);
  expect((await gridRow(page, 2).getByRole("button", { name: /장부 줄 고치기$/u }).boundingBox()).height, "줄 끝 '고치기' 36px").toBeGreaterThanOrEqual(36);
  // 되돌리기·다시 하기는 고친 것이 없으면 꺼져 있고, 키 안내가 표 아래에 있다
  await expect(page.getByRole("button", { name: "되돌리기" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "다시 하기" })).toBeDisabled();
  await expect(page.locator("[data-lg-keys]")).toContainText("Enter 고치기·저장");
  // 거르기를 켜면 합계 줄·달 줄 없음(달 합계는 거르지 않은 값이라 보이는 줄과 어긋남)
  await page.getByRole("button", { name: "지출", exact: true }).click();
  await expect(gridRow(page, 3)).toBeVisible();
  await expect(page.locator("tr.lg-group")).toHaveCount(0);
  await page.getByRole("button", { name: /^(✓ )?지출$/u }).first().click();
  await page.getByRole("button", { name: /^(✓ )?전체$/u }).click();
  await expect(page.locator("tr.lg-group")).toHaveCount(3);
  await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
  await expect(page.locator("tr.lg-group")).toHaveCount(0);
  await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
  // 기준일 없는 줄만 볼 때도 없음
  await page.getByRole("button", { name: "그 줄만 보기" }).click();
  await expect(gridRow(page, 5)).toBeVisible();
  await expect(page.locator("tr.lg-group")).toHaveCount(0);
  await expect(gridRow(page, 5).locator(".lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 90,000원)");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await expectNoTrace(page);
  assertNoErrors();
});

test("PC 표 칸 고치기: 누르면 그 자리에 입력칸이 열리고, Enter는 그 칸만(10%였던 줄은 부가세와 함께) version과 보낸 뒤 아래 칸으로 가며, 합계 줄은 서버 합계를 다시 읽고, Esc와 잘못된 값은 보내지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  const amount = gridCell(page, 2, "amountWon");
  await expect(amount).toHaveAccessibleName("11. 20. 가상숲1단지 84㎡ 매매 매도인 공급가액 고치기");
  const sums = countCalls(calls, "GET /ledger/summary");
  await amount.click();
  await expect(gridInput(page, 2, "amountWon")).toBeFocused();
  await expect(gridInput(page, 2, "amountWon")).toHaveValue("1,800,000");
  await expect(gridInput(page, 2, "amountWon")).toHaveAccessibleName("11. 20. 가상숲1단지 84㎡ 매매 매도인 공급가액 고치기");
  await gridInput(page, 2, "amountWon").fill("2000000");
  await expect(gridInput(page, 2, "amountWon"), "쉼표는 저절로").toHaveValue("2,000,000");
  await gridInput(page, 2, "amountWon").press("Enter");
  await expect(gridState(page, 2)).toHaveText("저장함");
  expect(patches(calls)).toEqual([{ method: "PATCH", path: `/ledger/${uuid(302)}`, body: { amountWon: 2_000_000, vatWon: 200_000, version: 1 }, csrf: "test-csrf" }]);
  await expect(amount).toHaveText("2,000,000");
  await expect(gridCell(page, 2, "vatWon")).toHaveText("200,000");
  await expect(gridRow(page, 2).locator('[data-lg-col="totalWon"]')).toHaveText("2,200,000");
  await expect(gridRow(page, 2).locator('[data-lg-col="unpaidWon"]')).toHaveText("미입금 2,200,000");
  await expect(noteOf(page, 2)).toHaveText("부가세도 200,000원으로 함께 바꿨습니다(고치기 전 부가세가 공급가액의 10%였던 줄).");
  await expect(gridCell(page, 3, "amountWon"), "Enter는 저장하고 아래 칸으로").toBeFocused();
  // 합계 줄·달 줄은 서버 합계를 다시 읽어 그린다(목록은 다시 읽지 않음)
  await expect(page.locator("tr.lg-group--total td").nth(0)).toHaveText("4,480,000");
  await expect(page.locator("tr.lg-group--total td").nth(3)).toHaveText("! 2,200,000");
  await expect(page.locator("tr.lg-group--total th")).toContainText("보수 3,800,000원 + 부가세 380,000원");
  expect(countCalls(calls, "GET /ledger/summary")).toBe(sums + 1);
  expect(countCalls(calls, "GET /ledger?"), "목록은 다시 읽지 않음").toBe(1);

  // Esc: 보내지 않고 원래 값, 포커스는 그 칸으로
  await typeCell(page, 3, "label", "가상 현수막", "Escape");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 전단 인쇄");
  await expect(gridCell(page, 3, "label")).toBeFocused();
  // 같은 값이면 보내지 않음
  await typeCell(page, 3, "label", "가상 전단 인쇄");
  // 잘못된 값: 보내지 않고 줄 아래 글로 알림(거래 없는 지출은 날짜가 있어야 함)
  await typeCell(page, 3, "basisOn", "");
  await expect(noteOf(page, 3)).toHaveText("! 거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.");
  await expect(gridInput(page, 3, "basisOn")).toHaveAttribute("aria-invalid", "true");
  await gridInput(page, 3, "basisOn").press("Escape");
  await expect(noteOf(page, 3)).toHaveCount(0);
  await typeCell(page, 2, "amountWon", "");
  await expect(noteOf(page, 2)).toHaveText("! 금액을 넣어 주세요.");
  await gridInput(page, 2, "amountWon").press("Escape");
  expect(patches(calls), "Esc·같은 값·잘못된 값은 보내지 않음").toHaveLength(1);

  // 기준일이 다른 달이 되면 줄은 그 자리에 두고 글을 붙인다. 달 줄 숫자는 서버 합계로 바뀐다
  await typeCell(page, 3, "basisOn", "2026-10-30");
  await expect(gridState(page, 3)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ entryOn: "2026-10-30", version: 1 });
  await expect(gridCell(page, 3, "basisOn")).toHaveText("10. 30.");
  await expect(noteOf(page, 3)).toHaveText("10월로 옮겨짐");
  expect(await tableOrder(page), "줄 자리는 그대로").toEqual(["2026년 합계", "새 줄", "11월", "줄", "줄", "줄", "10월", "줄"]);
  await expect(page.locator("tr.lg-group:not(.lg-group--total) th").nth(1)).toHaveText("10월기타 수입 300,000원 · 지출 50,000원 · 순수익 250,000원");

  // Tab: 저장하고 오른쪽 고칠 수 있는 칸으로('받을 금액'은 건너뜀). 따로 넣은 부가세는 경고를 글로 알린다
  await typeCell(page, 1, "vatWon", "150000", "Tab");
  await expect(gridState(page, 1)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ vatWon: 150_000, version: 1 });
  await expect(gridCell(page, 1, "receivedWon")).toBeFocused();
  await expect(gridRow(page, 1).locator(".lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 180,000원)");
  // 부가세를 따로 넣은 줄은 공급가액을 고쳐도 부가세를 건드리지 않는다
  await typeCell(page, 1, "amountWon", "1900000");
  await expect(gridCell(page, 1, "amountWon")).toHaveText("1,900,000");
  expect(patches(calls).at(-1).body).toEqual({ amountWon: 1_900_000, version: 2 });
  // 다른 곳을 눌러 칸을 떠나도 저장한다
  await typeCell(page, 4, "label", "가상 강의료 2회", null);
  await page.locator("h1").click();
  await expect(gridState(page, 4)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 강의료 2회", version: 1 });

  // 계약일 기준: 저장 응답의 기준일(늘 잔금일 기준)로 바뀌지 않고 계약일 그대로다
  await page.getByRole("button", { name: /^(✓ )?계약일$/u }).click();
  await expect(gridRow(page, 2).locator("td").first()).toContainText("10. 5.");
  await typeCell(page, 2, "label", "가상숲1단지 84㎡ 매매(매도)");
  await expect(gridState(page, 2)).toHaveText("저장함");
  await expect(gridRow(page, 2).locator("td").first()).toContainText("10. 5.");
  await expect(noteOf(page, 2), "옮겨졌다는 글이 붙지 않음").toHaveCount(0);
  await expectNoTrace(page);
  assertNoErrors();
});

test("PC 표 입금액: 입금일이 빈 줄은 저장하지 않고 입금일 칸을 오늘로 열어 두며, Enter는 두 칸을 함께 저장하고 Esc는 둘 다 그만둔다. 입금일 칸을 떠나면 값이 맞을 때 저장한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  const money = gridCell(page, 2, "receivedWon");
  const dateInput = gridInput(page, 2, "receivedOn");
  await typeCell(page, 2, "receivedWon", "1980000");
  await expect(dateInput).toBeFocused();
  await expect(dateInput, "오늘(한국 날짜)").toHaveValue("2026-11-21");
  await expect(noteOf(page, 2)).toHaveText("입금일을 확인해 주세요. Enter로 입금액과 함께 저장하고, Esc로 둘 다 그만둡니다.");
  await expect(money, "넣은 입금액은 칸에 보임").toHaveText("1,980,000");
  expect(patches(calls), "아직 저장하지 않음").toHaveLength(0);
  expect(await leaveWarned(page), "입금일을 묻는 중이면 떠날 때 물음").toBe(true);
  // Esc: 둘 다 그만둠
  await dateInput.press("Escape");
  await expect(money).toHaveText("0");
  await expect(gridCell(page, 2, "receivedOn")).toHaveText("");
  await expect(noteOf(page, 2)).toHaveCount(0);
  expect(patches(calls)).toHaveLength(0);
  expect(await leaveWarned(page)).toBe(false);
  // 입금일을 비우고 Enter: 보내지 않음
  await typeCell(page, 2, "receivedWon", "1980000");
  await dateInput.fill("");
  await dateInput.press("Enter");
  await expect(noteOf(page, 2)).toHaveText("! 입금액이 있으면 입금일을 넣어 주세요.");
  expect(patches(calls)).toHaveLength(0);
  // 날짜를 고치고 Enter: 두 칸을 한 번에
  await dateInput.fill("2026-11-22");
  await dateInput.press("Enter");
  await expect(gridState(page, 2)).toHaveText("저장함");
  expect(patches(calls)).toEqual([{ method: "PATCH", path: `/ledger/${uuid(302)}`, body: { receivedWon: 1_980_000, receivedOn: "2026-11-22", version: 1 }, csrf: "test-csrf" }]);
  await expect(noteOf(page, 2)).toHaveText("입금액과 입금일(2026-11-22)을 함께 저장했습니다.");
  await expect(gridCell(page, 2, "receivedOn")).toHaveText("11. 22.");
  await expect(gridRow(page, 2).locator('[data-lg-col="unpaidWon"]')).toHaveText("입금 끝");
  await expect(page.locator("tr.lg-group--total td").nth(3), "미입금 합계 0").toHaveText("—");
  // 되돌리기 한 번이면 두 칸 모두 앞 값으로
  await page.getByRole("button", { name: "되돌리기: 가상숲1단지 84㎡ 매매 입금액" }).click();
  await expect(money).toHaveText("0");
  expect(patches(calls).at(-1).body).toEqual({ receivedWon: 0, receivedOn: null, version: 2 });
  await expect(gridState(page, 2)).toHaveText("저장함");

  // 입금액 칸에서 다른 칸을 눌러 떠남: 입금일 칸이 열린 채 남고, 그 누름으로 저장하거나 다른 칸으로 넘어가지 않는다
  await typeCell(page, 2, "receivedWon", "500000", null);
  await gridCell(page, 3, "label").click();
  await expect(dateInput).toBeFocused();
  await expect(dateInput).toHaveValue("2026-11-21");
  await expect(gridInput(page, 3, "label")).toHaveCount(0);
  expect(patches(calls), "아직 저장하지 않음").toHaveLength(2);
  // 입금일 칸을 떠나면(값이 맞음) 다른 칸과 같은 규칙으로 저장한다
  await page.locator("h1").click();
  await expect(gridState(page, 2)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ receivedWon: 500_000, receivedOn: "2026-11-21", version: 3 });
  await expect(gridRow(page, 2).locator('[data-lg-col="unpaidWon"]')).toHaveText("미입금 1,480,000");
  // 입금일이 있는 줄은 입금액만 고쳐도 묻지 않고 두 값을 함께 보낸다
  await typeCell(page, 2, "receivedWon", "600000");
  await expect(gridCell(page, 2, "receivedWon")).toHaveText("600,000");
  expect(patches(calls).at(-1).body).toEqual({ receivedWon: 600_000, receivedOn: "2026-11-21", version: 4 });
  // 0원으로 고치면 입금일도 함께 비운다
  await typeCell(page, 2, "receivedWon", "0");
  await expect(noteOf(page, 2)).toHaveText("입금액이 0원이라 입금일도 함께 비웠습니다.");
  expect(patches(calls).at(-1).body).toEqual({ receivedWon: 0, receivedOn: null, version: 5 });
  await expectNoTrace(page);
  assertNoErrors();
});

test("PC 표 409·404: 다른 곳에서 먼저 고친 줄은 덮어쓰지 않고 목록을 다시 읽어 그 줄만 갈아 끼우며 넣던 값을 줄 아래에 남기고, 없어진 줄은 잠근다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const store = makeStore();
  const control = {};
  const calls = await setup(page, { width: 1280, store, conflictOnce: true, control });
  await page.goto("/admin/work/ledger/");
  const undo = page.locator("[data-lg-undo]");
  const redo = page.locator("[data-lg-redo]");
  await typeCell(page, 3, "label", "가상 현수막");
  await expect(noteOf(page, 3)).toHaveText("! 다른 곳에서 먼저 고쳐 저장하지 않았습니다. 저장된 값을 다시 읽었습니다. 넣던 값: 물건 표시·내용 가상 현수막");
  expect(patches(calls), "저절로 다시 보내지 않음").toHaveLength(1);
  expect(countCalls(calls, "GET /ledger?"), "같은 조건으로 목록을 한 번 다시 읽음").toBe(2);
  expect(calls.all.filter((call) => call.startsWith("GET /ledger?")).at(-1)).toBe("GET /ledger?year=2026&basis=balance&limit=50");
  await expect(gridCell(page, 3, "label"), "저장된 값 그대로").toHaveText("가상 전단 인쇄");
  await expect(gridCell(page, 3, "label")).toBeEnabled();
  await expect(page.getByRole("button", { name: "되돌리기" }), "저장하지 못한 것은 되돌리기 단계가 아님").toBeDisabled();
  // 다시 읽은 줄은 새 version으로 고친다
  await typeCell(page, 3, "label", "가상 현수막");
  await expect(gridState(page, 3)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 현수막", version: 2 });
  await expect(noteOf(page, 3)).toHaveCount(0);

  // 넷째 줄을 먼저 한 번 저장해 두면 되돌리기는 그 줄의 단계를 가리킨다
  await typeCell(page, 4, "amountWon", "310000");
  await expect(gridState(page, 4)).toHaveText("저장함");
  await expect(undo).toHaveAccessibleName("되돌리기: 가상 강의료 공급가액");

  // 다른 화면에서 지운 줄(404): 줄을 잠그고 넣던 값을 남긴다
  store.entries.splice(store.entries.findIndex((item) => item.id === uuid(304)), 1);
  await typeCell(page, 4, "label", "가상 강의료 2회");
  await expect(noteOf(page, 4)).toHaveText("! 이 장부 줄을 찾지 못했습니다. 다른 화면에서 지웠을 수 있습니다. 넣던 값: 물건 표시·내용 가상 강의료 2회");
  await expect(gridCell(page, 4, "label")).toBeDisabled();
  await expect(gridCell(page, 4, "amountWon")).toBeDisabled();
  await expect(gridRow(page, 4), "없어진 줄 표시").toHaveClass(/is-gone/u);
  // 없어진 줄의 단계는 버리고, 되돌리기는 그 앞 단계(셋째 줄)를 가리킨다
  await expect(undo, "없어진 줄의 단계를 건너뜀").toHaveAccessibleName("되돌리기: 가상 전단 인쇄 물건 표시·내용");
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  // 먼저 고쳐졌는데(409) 다시 읽은 목록에 없음(다른 해로 옮겨짐): 잠그고 까닭을 알린다
  const moved = store.entries.find((item) => item.id === uuid(301));
  moved.version = 5;
  moved.dates = { ...moved.dates, balance: "2025-12-30" };
  await typeCell(page, 1, "label", "가상숲1단지 84㎡ 매매(매수)");
  await expect(noteOf(page, 1)).toHaveText("! 이 줄이 지금 목록에 없습니다. 지워졌거나, 날짜·입금이 바뀌어 다른 연도나 거르기 밖으로 옮겨졌습니다. 넣던 값: 물건 표시·내용 가상숲1단지 84㎡ 매매(매수)");
  await expect(gridCell(page, 1, "label")).toBeDisabled();
  expect(await leaveWarned(page), "멈춘 줄은 저장 중이 아님").toBe(false);

  // 되돌리기 저장이 그 밖의 오류(가짜 서버 503)로 실패: 단계를 옮기지 않고 칸도 그대로 둔다
  control.failPatch = 1;
  const writes = patches(calls).length;
  await undo.click();
  await expect(noteOf(page, 3)).toContainText("! 되돌리지 못했습니다.");
  expect(patches(calls), "되돌리기 저장은 한 번 보냄").toHaveLength(writes + 1);
  await expect(gridCell(page, 3, "label"), "칸은 고친 값 그대로").toHaveText("가상 현수막");
  await expect(undo, "단계 그대로").toHaveAccessibleName("되돌리기: 가상 전단 인쇄 물건 표시·내용");
  await expect(undo).toBeEnabled();
  await expect(redo, "다시 하기 단계는 생기지 않음").toBeDisabled();
  await expect(redo).toHaveAccessibleName("다시 하기");
  // 다시 누르면 같은 단계를 한다. 남은 단계는 이 하나뿐이라 끝나면 되돌리기가 꺼진다
  await undo.click();
  await expect(noteOf(page, 3)).toHaveText("되돌렸습니다: 가상 전단 인쇄 물건 표시·내용");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 전단 인쇄");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 전단 인쇄", version: 3 });
  await expect(undo, "남은 단계 0").toBeDisabled();
  await expect(redo).toHaveAccessibleName("다시 하기: 가상 전단 인쇄 물건 표시·내용");
  assertNoErrors();
});

test("PC 표 저장 실패: 칸에 넣은 값과 빨간 테두리를 두고 '다시 저장'·'고치기 전 값으로'를 보이며, 그동안 목록을 바꾸거나 떠나려 하면 막는다", async ({ page }) => {
  const control = { failPatch: 1 };
  const calls = await setup(page, { width: 1280, control });
  await page.goto("/admin/work/ledger/");
  await typeCell(page, 3, "amountWon", "70000");
  await expect(gridState(page, 3)).toHaveText("저장 못 함");
  await expect(gridCell(page, 3, "amountWon")).toHaveClass(/is-failed/u);
  await expect(gridCell(page, 3, "amountWon"), "넣은 값은 칸에 그대로").toHaveText("70,000");
  await expect(noteOf(page, 3)).toContainText("! 저장하지 못했습니다.");
  await expect(noteOf(page, 3)).toContainText("넣은 값은 칸에 그대로 있습니다.");
  expect(await leaveWarned(page), "저장하지 못한 칸이 있으면 떠날 때 물음").toBe(true);
  // 목록을 바꾸는 단추와 줄 끝 '고치기'는 막고 글로 알린다
  await page.getByRole("button", { name: "앞 해" }).click();
  await expect(page.locator("[data-lg-year]")).toHaveText("2026년");
  await expect(page.locator("[data-lg-grid-status]")).toContainText("표에 저장 중이거나 저장하지 못한 칸이 있습니다.");
  await gridRow(page, 3).getByRole("button", { name: /장부 줄 고치기$/u }).click();
  await expect(page.locator("#lg-form")).toBeHidden();
  // 같은 줄의 다른 칸은 고칠 수 있지만 앞 저장이 끝나야 보낸다
  await typeCell(page, 3, "label", "가상 현수막");
  expect(patches(calls), "앞 칸이 저장되지 않아 기다림").toHaveLength(1);
  await noteOf(page, 3).getByRole("button", { name: "다시 저장" }).click();
  await expect(gridState(page, 3)).toHaveText("저장함");
  expect(patches(calls).map((write) => write.body)).toEqual([{ amountWon: 70_000, version: 1 }, { amountWon: 70_000, version: 1 }, { label: "가상 현수막", version: 2 }]);
  await expect(gridCell(page, 3, "amountWon")).not.toHaveClass(/is-failed/u);
  await expect(noteOf(page, 3)).toHaveCount(0);
  expect(await leaveWarned(page)).toBe(false);
  await expect(page.locator("[data-lg-grid-status]")).toHaveText("");
  // '고치기 전 값으로': 보내지 않고 저장된 값으로 돌아간다
  control.failPatch = 1;
  await typeCell(page, 3, "amountWon", "90000");
  await expect(gridState(page, 3)).toHaveText("저장 못 함");
  await noteOf(page, 3).getByRole("button", { name: "고치기 전 값으로" }).click();
  await expect(gridCell(page, 3, "amountWon")).toHaveText("70,000");
  await expect(gridCell(page, 3, "amountWon")).not.toHaveClass(/is-failed/u);
  await expect(noteOf(page, 3)).toHaveCount(0);
  expect(patches(calls)).toHaveLength(4);
  expect(await leaveWarned(page)).toBe(false);
  // 입력 화면이 열린 채 표 칸을 저장하지 못했을 때: 입력 화면의 저장은 목록을 다시 그려 표에 넣은 값을 버리므로 막는다
  await gridRow(page, 4).getByRole("button", { name: /장부 줄 고치기$/u }).click();
  await expect(page.locator("#lg-form")).toBeVisible();
  await page.locator("#lg-label").fill("가상 강의료 2회");
  control.failPatch = 1;
  await typeCell(page, 3, "amountWon", "95000");
  await expect(gridState(page, 3)).toHaveText("저장 못 함");
  const sent = calls.writes.length;
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-form-status]")).toContainText("표에 저장 중이거나 저장하지 못한 칸이 있습니다.");
  expect(calls.writes, "입력 화면 저장을 보내지 않음").toHaveLength(sent);
  await expect(gridCell(page, 3, "amountWon"), "표에 넣은 값은 그대로").toHaveText("95,000");
  await noteOf(page, 3).getByRole("button", { name: "다시 저장" }).click();
  await expect(gridState(page, 3)).toHaveText("저장함");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("#lg-form")).toBeHidden();
  expect(calls.writes.at(-1).body).toEqual({ label: "가상 강의료 2회", version: 1 });
});

test("PC 표: 칸을 고친 직후 곧바로 거르기를 누르면 그 누름을 기억했다가 저장이 끝난 뒤 이어서 하고, 저장이 실패하면 하지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let release = () => {};
  const hold = () => new Promise((resolve) => {
    release = resolve;
  });
  const control = { hold: hold() };
  const store = makeStore();
  const calls = await setup(page, { width: 1280, control, store });
  await page.goto("/admin/work/ledger/");
  const status = page.locator("[data-lg-grid-status]");
  const expenseChip = page.locator('[data-lg-kind="expense"]');
  const allChip = page.locator('[data-lg-kind=""]');
  const lists = () => calls.all.filter((call) => call.startsWith("GET /ledger?"));
  // 칸에 값을 넣고(Enter 없이) 곧바로 '지출'을 누름: 그 누름이 칸을 떠나게 해 저장이 시작되고, 누름은 사라지지 않고 기다린다
  await typeCell(page, 3, "amountWon", "70000", null);
  await expenseChip.click();
  await expect(gridState(page, 3)).toHaveText("저장 중…");
  await expect(status).toHaveText("칸을 저장한 뒤 이어서 합니다…");
  await expect(expenseChip, "아직 거르지 않음").toHaveAttribute("aria-pressed", "false");
  expect(lists(), "저장이 끝나기 전에는 목록을 다시 읽지 않음").toHaveLength(1);
  release();
  await expect(expenseChip, "저장이 끝나면 이어서 거름").toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => lists().at(-1)).toContain("kind=expense");
  expect(patches(calls).map((write) => write.body)).toEqual([{ amountWon: 70_000, version: 1 }]);
  await expect(gridCell(page, 3, "amountWon"), "저장한 값").toHaveText("70,000");
  await expect(page.locator("tr.lg-group"), "거르면 합계 줄·달 줄 없음").toHaveCount(0);
  await expect(status).toHaveText("");
  expect(await leaveWarned(page)).toBe(false);

  // 마지막 누름 하나만 기억한다: '전체'를 누른 뒤 '기타 수입'을 누르면 기타 수입만 걸린다
  control.hold = hold();
  await typeCell(page, 3, "amountWon", "75000", null);
  await allChip.click();
  await page.locator('[data-lg-kind="other_income"]').click();
  release();
  await expect(page.locator('[data-lg-kind="other_income"]')).toHaveAttribute("aria-pressed", "true");
  await expect(allChip).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => lists().at(-1)).toContain("kind=other_income");
  expect(lists().filter((call) => !call.includes("kind=")), "'전체'로는 다시 읽지 않음").toHaveLength(1);
  await expenseChip.click();
  await expect(gridRow(page, 3)).toBeVisible();

  // 저장이 실패하면 기억한 누름을 버린다(거르기는 그대로, 줄 아래 알림만 남음)
  control.hold = hold();
  control.failPatch = 1;
  const before = lists().length;
  await typeCell(page, 3, "amountWon", "80000", null);
  await allChip.click();
  await expect(status).toHaveText("칸을 저장한 뒤 이어서 합니다…");
  release();
  await expect(gridState(page, 3)).toHaveText("저장 못 함");
  await expect(status, "버린 것을 글로 알림(눌렀는데 아무 일도 없는 것처럼 보이지 않게)").toHaveText("저장하지 못해 방금 누른 것은 하지 않았습니다. 아래 줄을 확인해 주세요.");
  await expect(expenseChip, "거르기는 그대로").toHaveAttribute("aria-pressed", "true");
  await expect(noteOf(page, 3)).toContainText("! 저장하지 못했습니다.");
  expect(lists(), "목록을 다시 읽지 않음").toHaveLength(before);
  // 저장하지 못한 칸이 있을 때의 누름은 기억하지 않고 막는다(나중에 저절로 실행되지 않음)
  control.hold = null;
  await allChip.click();
  await expect(status).toContainText("표에 저장 중이거나 저장하지 못한 칸이 있습니다.");
  await noteOf(page, 3).getByRole("button", { name: "다시 저장" }).click();
  await expect(gridState(page, 3)).toHaveText("저장함");
  await expect(expenseChip, "막힌 누름은 저장 뒤에도 실행되지 않음").toHaveAttribute("aria-pressed", "true");
  expect(lists()).toHaveLength(before);

  // 다른 곳에서 먼저 고쳤으면(409) 기억한 누름을 버린다: 그 줄만 같은 조건(지출)으로 다시 읽고 거르기는 그대로
  store.entries.find((item) => item.id === uuid(303)).version = 9;
  control.hold = hold();
  await typeCell(page, 3, "amountWon", "85000", null);
  await allChip.click();
  await expect(status).toHaveText("칸을 저장한 뒤 이어서 합니다…");
  release();
  await expect(noteOf(page, 3)).toContainText("! 다른 곳에서 먼저 고쳐 저장하지 않았습니다. 저장된 값을 다시 읽었습니다. 넣던 값: 공급가액 85,000");
  await expect(status).toHaveText("저장하지 못해 방금 누른 것은 하지 않았습니다. 아래 줄을 확인해 주세요.");
  await expect(expenseChip, "거르기는 그대로").toHaveAttribute("aria-pressed", "true");
  expect(lists(), "줄을 다시 읽은 한 번뿐").toHaveLength(before + 1);
  expect(lists().at(-1)).toContain("kind=expense");
  // 다음 동작(칸 열기)에서 그 글을 지운다
  await gridCell(page, 3, "label").click();
  await expect(status).toHaveText("");
  await page.keyboard.press("Escape");
  // 버린 누름은 그 뒤의 저장에도 실행되지 않는다
  control.hold = null;
  await typeCell(page, 3, "amountWon", "86000");
  await expect(gridState(page, 3)).toHaveText("저장함");
  await expect(expenseChip).toHaveAttribute("aria-pressed", "true");
  await expect(gridCell(page, 3, "amountWon")).toHaveText("86,000");
  expect(lists(), "목록을 다시 읽지 않음").toHaveLength(before + 1);
  assertNoErrors();
});

test("PC 표: 기억한 누름은 그 사이 다른 줄이 먼저 고쳐져 멈췄으면(409) 남은 저장이 끝나도 하지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let release = () => {};
  const control = { hold: new Promise((resolve) => {
    release = resolve;
  }) };
  const store = makeStore();
  const calls = await setup(page, { width: 1280, control, store });
  await page.goto("/admin/work/ledger/");
  const expenseChip = page.locator('[data-lg-kind="expense"]');
  // 넷째 줄은 다른 곳에서 먼저 고쳐진 줄(409가 될 저장), 셋째 줄은 그냥 저장될 칸. 둘 다 응답을 붙잡아 둔다
  // 화면이 목록을 다 읽은 뒤에 서버 쪽 version만 올린다(먼저 올리면 화면이 새 version을 받아 409가 나지 않는다)
  await expect(gridRow(page, 4)).toBeVisible();
  store.entries.find((item) => item.id === uuid(304)).version = 9;
  await typeCell(page, 4, "label", "가상 강의료 3회", "Tab");
  await typeCell(page, 3, "amountWon", "70000", null);
  await expenseChip.click();
  await expect(page.locator("[data-lg-grid-status]")).toHaveText("칸을 저장한 뒤 이어서 합니다…");
  release();
  await expect(noteOf(page, 4)).toHaveText("! 다른 곳에서 먼저 고쳐 저장하지 않았습니다. 저장된 값을 다시 읽었습니다. 넣던 값: 물건 표시·내용 가상 강의료 3회");
  await expect(gridState(page, 3)).toHaveText("저장함");
  await expect(expenseChip, "거르지 않음(거르면 넷째 줄 알림이 사라짐)").toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("[data-lg-grid-status]"), "남은 저장이 끝난 뒤에도 글이 남음").toHaveText("저장하지 못해 방금 누른 것은 하지 않았습니다. 아래 줄을 확인해 주세요.");
  await expect(gridRow(page, 4)).toBeVisible();
  expect(calls.all.filter((call) => call.startsWith("GET /ledger?") && call.includes("kind=")), "거르기로 목록을 읽지 않음").toHaveLength(0);
  // 다음 동작(거르기)에서 그 글을 지우고, 그 거르기는 한다
  await expenseChip.click();
  await expect(page.locator("[data-lg-grid-status]")).toHaveText("");
  await expect(expenseChip).toHaveAttribute("aria-pressed", "true");
  assertNoErrors();
});

test("PC 표 되돌리기·다시 하기: 앞 값으로 한 번 저장하는 것이고, 그 사이 다른 곳에서 고쳤으면(409) 멈춰 알리고 단계를 그대로 둔다. 표 안에서는 Ctrl+Z·Ctrl+Y로도 한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const store = makeStore();
  const calls = await setup(page, { width: 1280, store });
  await page.goto("/admin/work/ledger/");
  const undo = page.locator("[data-lg-undo]");
  const redo = page.locator("[data-lg-redo]");
  await expect(undo).toBeDisabled();
  await typeCell(page, 3, "label", "가상 현수막");
  await expect(gridState(page, 3)).toHaveText("저장함");
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAccessibleName("되돌리기: 가상 전단 인쇄 물건 표시·내용");
  await expect(redo).toBeDisabled();
  await undo.click();
  await expect(noteOf(page, 3)).toHaveText("되돌렸습니다: 가상 전단 인쇄 물건 표시·내용");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 전단 인쇄");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 전단 인쇄", version: 2 });
  await expect(undo).toBeDisabled();
  await expect(redo).toHaveAccessibleName("다시 하기: 가상 전단 인쇄 물건 표시·내용");
  await redo.click();
  await expect(noteOf(page, 3)).toHaveText("다시 했습니다: 가상 전단 인쇄 물건 표시·내용");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 현수막", version: 3 });
  await expect(redo).toBeDisabled();

  // 그 사이 다른 곳에서 고침: 되돌리기를 멈추고 알리며, 단계는 지우지 않는다(다음 단계로 건너뛰지도 않음)
  store.entries.find((item) => item.id === uuid(303)).version = 9;
  await undo.click();
  await expect(noteOf(page, 3)).toHaveText("! 다른 곳에서 먼저 고쳐 저장하지 않았습니다. 저장된 값을 다시 읽었습니다. 되돌리기·다시 하기는 멈췄습니다. 값을 확인한 뒤 다시 눌러 주세요.");
  expect(patches(calls)).toHaveLength(4);
  await expect(undo, "남은 단계는 그대로").toBeEnabled();
  await expect(undo).toHaveAccessibleName("되돌리기: 가상 전단 인쇄 물건 표시·내용");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 현수막");
  // 값을 확인한 뒤 다시 누르면 새 version으로 한다
  await undo.click();
  await expect(gridCell(page, 3, "label")).toHaveText("가상 전단 인쇄");
  expect(patches(calls).at(-1).body).toEqual({ label: "가상 전단 인쇄", version: 10 });
  await expect(gridState(page, 3)).toHaveText("저장함");
  // 표 안(칸 단추)에서는 Ctrl+Y·Ctrl+Z
  await gridCell(page, 3, "label").focus();
  await page.keyboard.press("Control+y");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 현수막");
  await expect(gridState(page, 3)).toHaveText("저장함");
  await page.keyboard.press("Control+z");
  await expect(gridCell(page, 3, "label")).toHaveText("가상 전단 인쇄");
  expect(patches(calls).map((write) => write.body.version)).toEqual([1, 2, 3, 4, 10, 11, 12]);
  // 목록을 바꿔 그 줄이 안 보이면 하지 않고 글로 알린다
  await expect(gridState(page, 3)).toHaveText("저장함");
  await page.getByRole("button", { name: "앞 해" }).click();
  await expect(page.locator("[data-lg-year]")).toHaveText("2025년");
  await redo.click();
  await expect(page.locator("[data-lg-grid-status]")).toHaveText("그 줄이 지금 목록에 없어 하지 못했습니다. 그 줄이 보이는 연도·거르기로 바꾼 뒤 다시 눌러 주세요.");
  expect(patches(calls)).toHaveLength(7);
  assertNoErrors();
});

test("PC 표 키보드: 방향키는 고칠 수 있는 칸만 서고, 숫자를 치면 그 숫자로 고치기 시작하며, 입력칸 안의 Ctrl+Z는 표 되돌리기를 부르지 않는다. 낸 쪽은 고르는 칸이다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await gridCell(page, 1, "label").focus();
  await page.keyboard.press("ArrowRight");
  await expect(gridCell(page, 1, "payerRole")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(gridCell(page, 2, "amountWon")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(gridCell(page, 3, "amountWon")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(gridCell(page, 3, "label"), "지출 줄은 낸 쪽 칸을 건너뜀").toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(gridCell(page, 3, "basisOn")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(gridCell(page, 3, "basisOn"), "위 줄들은 날짜를 못 고쳐 제자리").toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(gridCell(page, 4, "basisOn"), "달 줄을 건너 다음 장부 줄로").toBeFocused();
  // 숫자를 치면 그 숫자로 시작
  await gridCell(page, 3, "amountWon").focus();
  await page.keyboard.press("6");
  await expect(gridInput(page, 3, "amountWon")).toBeFocused();
  await expect(gridInput(page, 3, "amountWon")).toHaveValue("6");
  await page.keyboard.type("0000");
  await expect(gridInput(page, 3, "amountWon")).toHaveValue("60,000");
  await page.keyboard.press("Control+z");
  expect(patches(calls), "입력칸 안의 Ctrl+Z는 저장을 부르지 않음").toHaveLength(0);
  await gridInput(page, 3, "amountWon").fill("60000");
  await page.keyboard.press("Enter");
  await expect(gridState(page, 3)).toHaveText("저장함");
  expect(patches(calls).at(-1).body).toEqual({ amountWon: 60_000, version: 1 });
  await expect(gridCell(page, 4, "amountWon")).toBeFocused();
  // 되돌릴 단계가 있을 때도 입력칸 안의 Ctrl+Z는 그 칸의 글자만 되돌린다(표 되돌리기를 부르지 않음)
  await page.keyboard.press("7");
  await expect(gridInput(page, 4, "amountWon")).toHaveValue("7");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+y");
  expect(patches(calls), "입력칸 안의 Ctrl+Z·Ctrl+Y는 저장을 부르지 않음").toHaveLength(1);
  await expect(page.locator("[data-lg-undo]")).toHaveAccessibleName("되돌리기: 가상 전단 인쇄 공급가액");
  await gridInput(page, 4, "amountWon").press("Escape");
  await expect(gridCell(page, 4, "amountWon")).toHaveText("300,000");
  // Enter로도 연다(칸 단추). 낸 쪽은 고르는 칸
  await gridCell(page, 1, "payerRole").focus();
  await page.keyboard.press("Enter");
  await expect(gridInput(page, 1, "payerRole")).toBeFocused();
  await gridInput(page, 1, "payerRole").selectOption("seller");
  await gridInput(page, 1, "payerRole").press("Enter");
  await expect(gridCell(page, 1, "payerRole")).toHaveText("매도인");
  expect(patches(calls).at(-1).body).toEqual({ payerRole: "seller", version: 1 });
  // Shift+Tab: 저장하고 왼쪽 칸으로, 줄 머리에서는 앞 줄 끝 칸으로
  await typeCell(page, 2, "label", "가상숲1단지 84㎡ 매매(매도)", "Shift+Tab");
  await expect(gridCell(page, 1, "receivedOn")).toBeFocused();
  await expect(gridState(page, 2)).toHaveText("저장함");
  // 날짜를 넣다 만 칸(브라우저는 값을 빈 글자로 준다)은 비우는 것으로 저장하지 않는다
  const sent = patches(calls).length;
  await gridCell(page, 3, "basisOn").click();
  await gridInput(page, 3, "basisOn").press("Backspace");
  expect(await gridInput(page, 3, "basisOn").evaluate((input) => `${input.value}/${input.validity.badInput}`), "넣다 만 날짜").toBe("/true");
  await gridInput(page, 3, "basisOn").press("Enter");
  await expect(noteOf(page, 3)).toHaveText("! 날짜를 연·월·일 모두 넣어 주세요.");
  await expect(gridInput(page, 3, "basisOn")).toHaveAttribute("aria-invalid", "true");
  expect(patches(calls), "넣다 만 날짜는 보내지 않음").toHaveLength(sent);
  await gridInput(page, 3, "basisOn").press("Escape");
  await expect(gridCell(page, 3, "basisOn")).toHaveText("11. 2.");
  assertNoErrors();
});

test("넓은 PC 표 위 한 줄: 1221px 이상 + 마우스에서만 연도·기준일·거르기·되돌리기·CSV·만들기를 한 줄로 모으고, 좁히면 원래 자리로 돌려놓으며, Tab 차례는 보이는 차례와 같다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const control = {};
  await setup(page, { width: 1221, control });
  await page.goto("/admin/work/ledger/");
  await expect(page.locator(".lg-table")).toBeVisible();
  const bar = page.locator("[data-lg-bar]");
  const parts = ['.lg-filters', '[data-lg-chips]', '.lg-history', '[data-lg-csv]', '[data-lg-new]', '[data-lg-notice]', '[data-lg-csv-note]'];
  const homes = ['[data-lg-main]', '.cu-list', '.lg-tools', '.lg-tools', '.lg-tools', '[data-lg-page]', '.cu-list'];
  const inBar = ['.lg-bar__left', '.lg-bar__left', '.lg-bar__right', '.lg-bar__right', '.lg-bar__right', '.lg-line', '.lg-line'];
  const placed = (want) => page.evaluate(([list, parents]) => list.map((selector, i) => document.querySelector(selector).parentElement.matches(parents[i])), [parts, want]);
  // 원래 자리의 차례(만들기 → CSV → 되돌리기, 참고용 글은 '불러오는 중' 글 바로 앞)까지 그대로인지
  const homeOrder = () => page.evaluate(() => [
    [...document.querySelector(".lg-tools").children].map((node) => node.matches("[data-lg-new]") ? "new" : node.matches("[data-lg-csv]") ? "csv" : node.matches(".lg-history") ? "history" : "?").join(","),
    document.querySelector("[data-lg-notice]").nextElementSibling.matches("[data-lg-boot]"),
    document.querySelector(".lg-filters").nextElementSibling.matches("[data-lg-line]"),
    document.querySelector("[data-lg-csv-note]").previousElementSibling.matches("[data-lg-grid-live]"),
  ].join("|"));
  const homeExpected = "new,csv,history|true|true|true";
  const allTrue = parts.map(() => true);
  // 클래스가 아니라 결과를 잰다. 글꼴에 따라 한 줄 칸이 두 줄이 될 수 있어(리눅스 CI) 고정 y 대신 사이 거리로 본다:
  // 안내 줄 아래 끝 → 한 줄 칸 위 끝 10px, 한 줄 칸 아래 끝 → 표 머리 41px(줄 수 제목 31px 포함)로 잼, +2px까지. 안내 줄 높이, 빈 단추 칸 숨김
  const layout = () => page.evaluate(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect();
    return {
      lineToBar: box("[data-lg-bar]").top - box("[data-lg-line]").bottom,
      barToHead: box(".lg-table thead").top - box("[data-lg-bar]").bottom,
      line: box("[data-lg-line]").height,
      tools: getComputedStyle(document.querySelector(".lg-tools")).display,
      ...lineShape(),
    };
    function lineShape() {
      const lineNode = document.querySelector("[data-lg-line]");
      const shown = [...lineNode.children].filter((child) => child.getBoundingClientRect().height > 0);
      const centers = shown.map((child) => { const r = child.getBoundingClientRect(); return (r.top + r.bottom) / 2; }).sort((a, b) => a - b);
      const rows = centers.filter((center, i) => i === 0 || center - centers[i - 1] > 4).length;
      const tallest = Math.max(...shown.map((child) => child.getBoundingClientRect().height));
      const rowGap = parseFloat(getComputedStyle(lineNode).rowGap) || 0;
      return { lineRows: rows, lineTallest: tallest, lineRowGap: rowGap };
    }
  });
  // 안내 줄(참고용 · 기준일 없는 줄 알림 · CSV 알림)은 maxRows줄까지. 높이는 가장 높은 알림 × 줄 수 + 줄 사이 + 2px까지(B10처럼 상자·세로 쌓기면 넘음)
  const expectTight = async (label, maxRows = 1) => {
    const now = await layout();
    expect(now.lineRows, `${label}: 안내는 ${maxRows}줄까지`).toBeLessThanOrEqual(maxRows);
    expect(now.line, `${label}: 안내 줄 높이`).toBeLessThanOrEqual(now.lineTallest * maxRows + now.lineRowGap * (maxRows - 1) + 2);
    expect(now.lineToBar, `${label}: 안내 줄 바로 아래 한 줄 칸`).toBeLessThanOrEqual(12);
    expect(now.barToHead, `${label}: 한 줄 칸 바로 아래 표(빈 칸이 끼지 않음)`).toBeLessThanOrEqual(43);
    expect(now.tools, `${label}: 빈 단추 칸은 자리도 차지하지 않음`).toBe("none");
  };
  // CI(리눅스 글꼴)에서 여유를 숫자로 알려고, 모양 검사 전에 한 줄 칸·안내 줄의 필요한 폭과 줄 폭을 남긴다
  const logWidths = async (label) => {
    const now = await page.evaluate(() => {
      const rect = (node) => node.getBoundingClientRect();
      const round = (value) => Math.round(value * 10) / 10;
      const barNode = document.querySelector("[data-lg-bar]");
      const lineNode = document.querySelector("[data-lg-line]");
      const barGap = parseFloat(getComputedStyle(barNode).columnGap) || 0;
      const lineGap = parseFloat(getComputedStyle(lineNode).columnGap) || 0;
      const notes = [...lineNode.children].filter((child) => rect(child).height > 0);
      return {
        barNeed: round(rect(document.querySelector(".lg-bar__left")).width + barGap + rect(document.querySelector(".lg-bar__right")).width),
        barAvail: round(rect(barNode).width),
        lineNeed: round(notes.reduce((sum, child) => sum + rect(child).width, 0) + lineGap * Math.max(0, notes.length - 1)),
        lineAvail: round(rect(lineNode).width),
        notes: notes.length,
        font: getComputedStyle(document.querySelector("[data-lg-new]")).fontFamily,
      };
    });
    const spare = (avail, need) => Math.round((avail - need) * 10) / 10;
    console.log(`[lg-bar] ${label} need=${now.barNeed} avail=${now.barAvail} spare=${spare(now.barAvail, now.barNeed)} font=${now.font}`);
    console.log(`[lg-line] ${label} need=${now.lineNeed} avail=${now.lineAvail} spare=${spare(now.lineAvail, now.lineNeed)} notes=${now.notes}`);
  };
  // 한 줄 칸 모양: 한 줄이거나, 오른쪽 묶음(되돌리기 ~ 장부 줄 만들기)이 통째로 둘째 줄 오른쪽 끝. 묶음 안은 꺾이지 않는다
  const barShape = () => page.evaluate(() => {
    const rect = (node) => node.getBoundingClientRect();
    const rows = (group) => new Set([...group.querySelectorAll("button")].filter((button) => rect(button).width > 0).map((button) => Math.round((rect(button).top + rect(button).bottom) / 2))).size;
    const bar = rect(document.querySelector("[data-lg-bar]"));
    const leftGroup = document.querySelector(".lg-bar__left");
    const rightGroup = document.querySelector(".lg-bar__right");
    const left = rect(leftGroup);
    const right = rect(rightGroup);
    const oneLine = right.top < left.bottom && right.left > left.right;
    const wrapped = right.top >= left.bottom && Math.abs(right.right - bar.right) <= 1;
    const gap = parseFloat(getComputedStyle(document.querySelector("[data-lg-bar]")).columnGap);
    return {
      shape: oneLine ? "한 줄" : wrapped ? "오른쪽 묶음 둘째 줄" : "어긋남",
      leftRows: rows(leftGroup),
      rightRows: rows(rightGroup),
      need: Math.round((left.width + gap + right.width) * 10) / 10,
      avail: Math.round(bar.width * 10) / 10,
      font: getComputedStyle(document.querySelector("[data-lg-new]")).fontFamily,
    };
  });
  const expectShape = async (label, allowed) => {
    const now = await barShape();
    expect(allowed, `${label}: ${now.shape}`).toContain(now.shape);
    expect([now.leftRows, now.rightRows], `${label}: 묶음 안은 꺾이지 않음`).toEqual([1, 1]);
    expect(await overflowOf(page), `${label}: 가로 넘침 없음`).toBeLessThanOrEqual(0);
    return now.shape;
  };
  // Tab 차례 = 보이는 차례(위 줄 → 아래 줄, 같은 줄은 왼쪽 → 오른쪽). 못 누르는 되돌리기·다시 하기는 건너뜀
  const tabNames = ["앞 해", "다음 해", "잔금일", "계약일", "입금일", "전체", "보수", "지출", "기타 수입", "미입금만", "CSV 내려받기", "장부 줄 만들기"];
  const expectTabOrder = async (label) => {
    await page.locator("[data-lg-undated-show]").focus();
    const order = [];
    for (let i = 0; i < tabNames.length; i += 1) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => {
        const node = document.activeElement;
        const box = node.getBoundingClientRect();
        return { name: node.getAttribute("aria-label") || node.textContent.replace("＋", "").trim(), x: box.left, y: (box.top + box.bottom) / 2 };
      }));
    }
    expect(order.map((item) => item.name), label).toEqual(tabNames);
    for (let i = 1; i < order.length; i += 1) {
      const [before, now] = [order[i - 1], order[i]];
      const after = now.y > before.y + 4 || (Math.abs(now.y - before.y) <= 4 && now.x > before.x);
      expect(after, `${label}: ${now.name}는 ${before.name}의 뒤(아래 줄이거나 같은 줄 오른쪽)`).toBe(true);
    }
  };
  const barHidden = () => bar.evaluate((node) => node.hidden);

  // 모양 검사 전에 1280px·1221px 폭을 먼저 남긴다(앞 검사가 떨어져도 두 숫자를 다 얻게)
  await expect(bar).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(1280);
  await logWidths("1280px");
  await page.setViewportSize({ width: 1221, height: 900 });
  await expect.poll(() => page.evaluate(() => document.documentElement.clientWidth)).toBe(1221);
  await logWidths("1221px");
  // 1221px(가장 좁은 넓은 PC): 한 줄, 또는 글꼴이 넓으면 오른쪽 묶음이 통째로 둘째 줄. 가로 넘침 없음
  expect(await placed(inBar)).toEqual(allTrue);
  await expectShape("1221px", ["한 줄", "오른쪽 묶음 둘째 줄"]);
  await expect(page.locator(".lg-tools")).toBeHidden();
  await expectTight("1221px", 2);
  await expect(page.locator(".lg-line .lg-notice")).toHaveText("참고용 집계입니다. 세무 장부가 아닙니다.");
  expect(await page.locator(".lg-line").evaluate((node) => [...node.children].map((child) => child.dataset.lgNotice !== undefined ? "참고용" : child.dataset.lgUndated !== undefined ? "기준일 없음" : child.dataset.lgCsvNote !== undefined ? "CSV" : "?").join(",")), "참고용 글 → 기준일 없는 줄 알림 → CSV 알림").toBe("참고용,기준일 없음,CSV");
  // 누르는 곳은 36px까지(연도 화살표·기준일·거르기·되돌리기·CSV), 주 단추(만들기)는 44px, 연도·만들기 글자는 그대로
  expect((await page.getByRole("button", { name: "앞 해" }).boundingBox()).width).toBeGreaterThanOrEqual(36);
  expect((await page.getByRole("button", { name: "앞 해" }).boundingBox()).height).toBeGreaterThanOrEqual(36);
  expect((await page.locator("[data-lg-new]").boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect((await page.locator("[data-lg-csv]").boundingBox()).height).toBeGreaterThanOrEqual(36);
  expect(await page.locator("[data-lg-year]").evaluate((node) => getComputedStyle(node).fontSize), "연도 글자").toBe("20px");
  expect(await page.locator("[data-lg-new]").evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await expect(page.getByRole("group", { name: "기준일" }), "'기준일' 이름은 읽기 프로그램이 그대로 읽음").toBeVisible();
  await expect(page.locator("#lg-basis-label")).toHaveText("기준일");
  expect((await page.locator("#lg-basis-label").boundingBox()).width, "화면에는 보이지 않음(폭 줄이기)").toBeLessThanOrEqual(1);
  expect(await page.locator("[data-lg-undo] svg, [data-lg-redo] svg").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-hidden"))), "그림은 읽지 않음").toEqual(["true", "true"]);
  // 1px만 좁혀도(1220px) 한 줄 칸은 hidden 속성으로 숨고(크기 0이라 toBeHidden으로는 못 봄) 묶음은 원래 자리로
  await page.setViewportSize({ width: 1220, height: 900 });
  await expect.poll(barHidden, "1220px: 한 줄 칸 hidden").toBe(true);
  expect(await placed(homes)).toEqual(allTrue);
  await page.setViewportSize({ width: 1221, height: 900 });
  await expect.poll(barHidden, "1221px: 다시 보임").toBe(false);
  expect(await placed(inBar)).toEqual(allTrue);

  await expectTabOrder("1221px");
  // 글꼴이 넓어 꺾이는 경우를 어느 글꼴에서나 보이도록 왼쪽 묶음을 시험으로만 넓혀 본다: 오른쪽 묶음만 통째로 내려가고, 거리·Tab 차례는 그대로
  const wider = await page.addStyleTag({ content: ".lg-bar__left { padding-right: 300px; }" });
  expect(await expectShape("왼쪽이 넓을 때", ["오른쪽 묶음 둘째 줄"])).toBe("오른쪽 묶음 둘째 줄");
  await expectTight("둘째 줄로 꺾였을 때", 2);
  await expectTabOrder("둘째 줄로 꺾였을 때");
  await wider.evaluate((node) => node.remove());

  // 칸을 하나 고치면 되돌리기가 켜진다: 36×36 그림 단추, 이름은 무엇을 되돌리는지
  await typeCell(page, 3, "label", "가상 현수막");
  await expect(gridState(page, 3)).toHaveText("저장함");
  const undo = page.locator("[data-lg-undo]");
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAccessibleName("되돌리기: 가상 전단 인쇄 물건 표시·내용");
  await expect(page.locator("[data-lg-redo]")).toBeDisabled();
  const undoBox = await undo.boundingBox();
  expect([Math.round(undoBox.width), Math.round(undoBox.height)], "그림 단추 36×36").toEqual([36, 36]);
  await expect(undo.locator(".lg-history__icon")).toBeVisible();
  // 마우스를 올리면 보이는 이름(title)도 읽기 프로그램 이름(aria-label)과 같다
  expect(await page.locator("[data-lg-undo], [data-lg-redo]").evaluateAll((nodes) => nodes.map((node) => [node.title, node.getAttribute("aria-label")]))).toEqual([["되돌리기: 가상 전단 인쇄 물건 표시·내용", "되돌리기: 가상 전단 인쇄 물건 표시·내용"], ["다시 하기", "다시 하기"]]);
  await undo.focus();
  expect(await undo.evaluate((node) => getComputedStyle(node).outlineStyle), "포커스 테두리").not.toBe("none");

  // 좁히면(1000px) 원래 자리·차례로, 다시 넓히면 한 줄로. 포커스는 같은 단추에 남는다
  const expense = page.locator('[data-lg-kind="expense"]');
  await expense.focus();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect.poll(barHidden).toBe(true);
  expect(await placed(homes)).toEqual(allTrue);
  expect(await homeOrder()).toBe(homeExpected);
  await expect(expense, "옮긴 뒤에도 같은 단추에 포커스").toBeFocused();
  await expect(page.locator(".lg-tools [data-lg-new]")).toBeVisible();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar).toBeVisible();
  expect(await placed(inBar)).toEqual(allTrue);
  await expectShape("1280px", ["한 줄"]);
  await expectTight("1280px");
  await expect(expense).toBeFocused();
  await page.setViewportSize({ width: 1000, height: 900 });
  await expect(bar).toBeHidden();
  expect(await placed(homes)).toEqual(allTrue);
  expect(await homeOrder()).toBe(homeExpected);
  // 옮겨도 단추는 그대로 일한다(거르기)
  await page.setViewportSize({ width: 1280, height: 900 });
  await expense.click();
  await expect(expense).toHaveAttribute("aria-pressed", "true");

  // 목록이 다시 숨으면 참고용 글은 원래 자리로 돌아와 보인다
  const notice = page.locator("[data-lg-notice]");
  const noticeHome = () => notice.evaluate((node) => node.parentElement.matches("[data-lg-page]") && node.nextElementSibling.matches("[data-lg-boot]"));
  // ① 뒤로 가기로 돌아와(bfcache) 처음부터 다시 불러오는 중
  let releaseSummary = () => {};
  control.holdSummary = new Promise((resolve) => {
    releaseSummary = resolve;
  });
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  await expect(page.locator("[data-lg-boot]")).toBeVisible();
  await expect(notice, "불러오는 중에도 '세무 장부가 아닙니다'가 보임").toBeVisible();
  expect(await noticeHome()).toBe(true);
  expect(await placed(homes)).toEqual(allTrue);
  await expect(bar).toBeHidden();
  control.holdSummary = null;
  releaseSummary();
  await expect(page.locator(".lg-table")).toBeVisible();
  await expect(page.locator(".lg-line .lg-notice"), "다 불러오면 다시 한 줄로").toBeVisible();
  expect(await placed(inBar)).toEqual(allTrue);
  // ② 연도를 바꿔 다시 읽다가 목록 칸을 닫는 오류(자료 구조 갱신 전)
  control.failSummary = 1;
  control.failSummaryCode = "WORK_SCHEMA_OUTDATED";
  await page.getByRole("button", { name: "앞 해" }).click();
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-lg-main]")).toBeHidden();
  await expect(notice, "오류 화면에서도 보임").toBeVisible();
  expect(await noticeHome()).toBe(true);
  expect(await placed(homes)).toEqual(allTrue);
  await expect(bar).toBeHidden();
  assertNoErrors();
});

test("손가락으로 쓰는 넓은 화면 1280px 매출장부: 표로 보이되 칸·'고치기'를 누르는 곳은 44px, 글자는 16px 그대로다", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const calls = await setup(page, { width: 1280 });
    await page.goto("/admin/work/ledger/");
    expect(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches), "이 시험은 손가락 화면").toBe(false);
    await expect(page.locator(".lg-table")).toBeVisible();
    await expect(page.locator(".lg-sum")).toBeHidden();
    await expect(page.locator("[data-lg-bar]"), "손가락 화면은 표 위 한 줄로 모으지 않음").toBeHidden();
    await expect(page.locator(".lg-tools [data-lg-new]"), "단추는 원래 자리").toBeVisible();
    await expect(page.locator("[data-lg-undo]"), "되돌리기는 글자 단추 그대로").toHaveText("되돌리기");
    await expect(page.locator("[data-lg-undo] .lg-history__icon")).toBeHidden();
    const cell = gridCell(page, 2, "receivedOn");
    expect((await cell.boundingBox()).height, "칸을 누르는 곳").toBeGreaterThanOrEqual(44);
    expect(await gridCell(page, 2, "amountWon").evaluate((button) => getComputedStyle(button).fontSize), "칸 글자").toBe("16px");
    expect((await gridRow(page, 2).getByRole("button", { name: /장부 줄 고치기$/u }).boundingBox()).height, "줄 끝 '고치기'").toBeGreaterThanOrEqual(44);
    expect((await page.locator("[data-lg-undo]").boundingBox()).height, "'되돌리기'").toBeGreaterThanOrEqual(44);
    await gridCell(page, 2, "amountWon").tap();
    const input = gridInput(page, 2, "amountWon");
    await expect(input).toBeFocused();
    expect((await input.boundingBox()).height, "입력칸").toBeGreaterThanOrEqual(44);
    expect(await input.evaluate((field) => getComputedStyle(field).fontSize), "입력칸 글자(16px 아래면 휴대 기기가 화면을 키움)").toBe("16px");
    await input.fill("1900000");
    await input.press("Enter");
    await expect(gridState(page, 2)).toHaveText("저장함");
    expect(patches(calls).at(-1).body).toEqual({ amountWon: 1_900_000, vatWon: 190_000, version: 1 });
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  } finally {
    await context.close();
  }
});

// ── D-2b: 빈 새 줄에서 새 줄 적기·줄 끝 지우기(1221px 이상 표, 11:34:13 시안. 칸 안 거래 찾기는 대장 결정으로 뺌) ──
const newRowOf = (page) => page.locator(".lg-table tr[data-lg-newrow]");
const newNote = (page) => page.locator(".lg-table tr.lg-newnote");
const newInput = (page, name) => newRowOf(page).getByLabel(`새 줄 ${name}`, { exact: true });

test("PC 표 빈 새 줄: 합계 줄 아래 '새 장부 줄'을 누르면 오늘·지출로 열리고, 빈 공급가액은 보내지 않으며, Enter는 저장 중 줄을 잠가 빨리 두 번 눌러도 POST 한 번이고, 저장 뒤 목록·합계를 다시 읽어 그 줄을 강조한다. Esc는 버린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const control = {};
  const calls = await setup(page, { width: 1280, control });
  const sent = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/work/ledger")) sent.push(request);
  });
  await page.goto("/admin/work/ledger/");
  expect(await tableOrder(page)).toEqual(["2026년 합계", "새 줄", "11월", "줄", "줄", "줄", "10월", "줄"]);
  const start = newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" });
  await expect(start).toHaveText("새 장부 줄");
  await expect(newRowOf(page).locator("input, select"), "처음에는 입력칸이 없음").toHaveCount(0);
  await expect(newNote(page)).toHaveCount(0);

  // 열기: 날짜는 오늘, 종류는 지출(낸 쪽·부가세 칸 없음), 물건 표시 칸에 포커스. Esc는 넣던 것을 버리고 '새 장부 줄'로 돌아온다
  await start.click();
  await expect(newInput(page, "물건 표시·내용")).toBeFocused();
  await expect(newInput(page, "날짜")).toHaveValue("2026-11-21");
  await expect(newInput(page, "종류")).toHaveValue("expense");
  await expect(newInput(page, "낸 쪽")).toHaveCount(0);
  await expect(newInput(page, "부가세(원)")).toHaveCount(0);
  await expect(newRowOf(page).locator(".lg-rowstate")).toHaveText("새 줄");
  await expect(newNote(page)).toContainText("새 지출 줄입니다. Enter로 저장하고 Esc로 지웁니다.");
  await expect(newNote(page), "거래에 잇는 길을 한 문장으로").toContainText("거래에 잇는 보수 줄은 '장부 줄 만들기'나 손님 카드의 거래 칸에서 만듭니다.");
  await newInput(page, "물건 표시·내용").fill("가상 버릴 줄");
  expect(await leaveWarned(page), "넣다 만 새 줄이 있으면 떠나기 전에 묻는다").toBe(true);
  await newInput(page, "물건 표시·내용").press("Escape");
  await expect(start).toBeFocused();
  await expect(newNote(page)).toHaveCount(0);
  expect(await leaveWarned(page)).toBe(false);

  // 보수로 바꾸면 낸 쪽·부가세 칸이 생기고, 부가세는 직접 고치기 전까지 공급가액의 10%, 받을 금액은 자동
  await start.click();
  await newInput(page, "종류").selectOption("fee");
  await expect(newInput(page, "낸 쪽")).toBeVisible();
  await newInput(page, "공급가액(원)").fill("1000000");
  await expect(newInput(page, "공급가액(원)")).toHaveValue("1,000,000");
  await expect(newInput(page, "부가세(원)")).toHaveValue("100,000");
  await expect(newRowOf(page).locator('[data-lg-col="totalWon"]')).toHaveText("1,100,000");
  await newInput(page, "부가세(원)").fill("90000");
  await newInput(page, "공급가액(원)").fill("2000000");
  await expect(newInput(page, "부가세(원)"), "직접 고친 부가세는 덮어쓰지 않음").toHaveValue("90,000");
  await expect(newRowOf(page).locator('[data-lg-col="totalWon"]')).toHaveText("2,090,000");
  await newInput(page, "공급가액(원)").press("Escape");
  await expect(start).toBeFocused();

  // 빈 공급가액: 보내지 않고 그 칸을 빨갛게, 줄 아래 '!' 글
  await start.click();
  await expect(newInput(page, "부가세(원)"), "다시 열면 처음 값(지출)").toHaveCount(0);
  await newInput(page, "물건 표시·내용").fill("가상 현수막");
  await newInput(page, "물건 표시·내용").press("Enter");
  await expect(newInput(page, "공급가액(원)")).toBeFocused();
  await expect(newInput(page, "공급가액(원)")).toHaveAttribute("aria-invalid", "true");
  await expect(newNote(page)).toHaveClass(/is-bad/u);
  await expect(newNote(page).locator("p")).toHaveText(/^! /u);
  expect(sent).toHaveLength(0);

  // 저장 중에는 줄을 잠근다: Enter를 빨리 두 번(+ 한 번 더) 눌러도 POST는 한 번
  let release;
  control.holdPost = new Promise((resolve) => {
    release = resolve;
  });
  const amount = newInput(page, "공급가액(원)");
  await amount.fill("120000");
  await expect(amount).not.toHaveAttribute("aria-invalid", "true");
  await amount.press("Enter");
  await amount.press("Enter");
  await expect(newRowOf(page).locator(".lg-rowstate")).toHaveText("저장 중…");
  await expect(amount).toHaveJSProperty("readOnly", true);
  await expect(amount, "잠가도 포커스는 그 칸에 남음").toBeFocused();
  await expect(newInput(page, "종류")).toBeDisabled();
  await expect(newNote(page).getByRole("button", { name: "저장" })).toBeDisabled();
  await amount.press("Enter");
  await page.getByRole("button", { name: /^(✓ )?지출$/u }).first().click();
  await page.waitForTimeout(150);
  expect(sent, "저장 중 누른 Enter는 보내지 않음").toHaveLength(1);
  release();
  // 저장 중에 누른 '지출' 거르기는 저장이 끝난 뒤 이어서 한다(표의 다른 저장과 같은 규칙) → 거른 목록에서 새 줄은 숨는다
  await expect(page.getByRole("button", { name: /^(✓ )?지출$/u }).first()).toHaveAttribute("aria-pressed", "true");
  await expect(newRowOf(page)).toHaveCount(0);
  expect(sent).toHaveLength(1);
  const posts = calls.writes.filter((write) => write.method === "POST" && write.path === "/ledger");
  expect(posts).toHaveLength(1);
  expect(posts[0].csrf).toBe("test-csrf");
  expect(posts[0].body).toMatchObject({ kind: "expense", entryOn: "2026-11-21", label: "가상 현수막", amountWon: 120000, vatWon: 0 });
  expect(posts[0].body.dealId, "새 줄은 거래에 잇지 않음").toBeUndefined();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 저장했습니다. 지출 가상 현수막 120,000원.");
  await page.getByRole("button", { name: /^(✓ )?전체$/u }).click();
  await expect(newRowOf(page)).toBeVisible();
  await expect(newNote(page), "저장한 뒤 새 줄은 처음 모양").toHaveCount(0);
  await expect(page.locator(".lg-table tr[data-lg-entry]").filter({ hasText: "가상 현수막" })).toHaveCount(1);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await expectNoTrace(page);
  assertNoErrors();
});

test("PC 표 빈 새 줄: 한글 조합 중의 Enter(isComposing·keyCode 229)는 저장하지 않고, Esc도 줄을 버리지 않는다. 조합이 끝난 Enter만 저장한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" }).click();
  await newInput(page, "물건 표시·내용").fill("가상 현수막");
  await newInput(page, "공급가액(원)").fill("120000");
  const fire = (name, init) => newInput(page, name).evaluate((input, value) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...value });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
  expect(await fire("물건 표시·내용", { key: "Enter", isComposing: true }), "조합 중 Enter는 막지 않고 입력기에 맡김").toBe(false);
  expect(await fire("물건 표시·내용", { key: "Enter", keyCode: 229 })).toBe(false);
  expect(await fire("물건 표시·내용", { key: "Escape", isComposing: true })).toBe(false);
  await page.waitForTimeout(150);
  expect(calls.writes.filter((write) => write.method === "POST"), "조합 중 Enter로는 보내지 않음").toHaveLength(0);
  await expect(newInput(page, "물건 표시·내용"), "조합 중 Esc로 줄을 버리지 않음").toHaveValue("가상 현수막");
  await newInput(page, "물건 표시·내용").press("Enter");
  await expect(newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" })).toBeFocused();
  expect(calls.writes.filter((write) => write.method === "POST")).toHaveLength(1);
  assertNoErrors();
});

test("PC 표 칸 고치기: 한글 조합 중의 Enter·Tab(isComposing·keyCode 229)은 저장하지 않고, Esc도 고치던 값을 버리지 않는다. 조합이 끝난 Enter만 저장한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await gridCell(page, 3, "label").click();
  await gridInput(page, 3, "label").fill("가상 전단 인쇄 다시");
  const fire = (init) => gridInput(page, 3, "label").evaluate((input, value) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...value });
    input.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
  expect(await fire({ key: "Enter", isComposing: true }), "조합 중 Enter는 막지 않고 입력기에 맡김").toBe(false);
  expect(await fire({ key: "Tab", isComposing: true })).toBe(false);
  expect(await fire({ key: "Enter", keyCode: 229 })).toBe(false);
  expect(await fire({ key: "Escape", isComposing: true })).toBe(false);
  await page.waitForTimeout(150);
  expect(patches(calls), "조합 중 Enter·Tab으로는 보내지 않음").toHaveLength(0);
  await expect(gridInput(page, 3, "label"), "조합 중 Esc로 고치던 값을 버리지 않음").toHaveValue("가상 전단 인쇄 다시");
  await gridInput(page, 3, "label").press("Enter");
  await expect(gridState(page, 3)).toHaveText("저장함");
  expect(patches(calls)).toHaveLength(1);
  expect(patches(calls)[0].body).toMatchObject({ label: "가상 전단 인쇄 다시" });
  assertNoErrors();
});

test("PC 표 빈 새 줄: 저장한 뒤 포커스는 '새 장부 줄'로 돌아오고, 그 줄을 강조한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  const start = newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" });
  await start.click();
  await newInput(page, "물건 표시·내용").fill("가상 명함");
  await newInput(page, "날짜").fill("2026-11-05");
  await newInput(page, "공급가액(원)").fill("33000");
  await newNote(page).getByRole("button", { name: "저장" }).click();
  await expect(start).toBeFocused();
  const savedRow = page.locator(".lg-table tr[data-lg-entry].is-saved");
  await expect(savedRow).toHaveCount(1);
  await expect(savedRow).toContainText("가상 명함");
  expect(await tableOrder(page)).toEqual(["2026년 합계", "새 줄", "11월", "줄", "줄", "줄", "줄", "10월", "줄"]);
  assertNoErrors();
});

test("PC 표 빈 새 줄은 거르기·'미입금만'·기준일 없는 줄 보기에서 숨고, 끄면 넣던 값 그대로 돌아온다. 저장하지 못하면 넣은 값을 두고 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 1280 });
  await page.route("**/api/admin/v1/work/ledger", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill(failure(503, "STORAGE_UNAVAILABLE"));
  });
  await page.goto("/admin/work/ledger/");
  await newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" }).click();
  await newInput(page, "물건 표시·내용").fill("가상 남길 줄");
  await page.getByRole("button", { name: "지출", exact: true }).click();
  await expect(gridRow(page, 1)).toHaveCount(0);
  await expect(newRowOf(page), "종류 거르기 중에는 숨김").toHaveCount(0);
  await expect(newNote(page)).toHaveCount(0);
  await page.getByRole("button", { name: /^(✓ )?전체$/u }).click();
  await expect(newInput(page, "물건 표시·내용"), "끄면 넣던 값 그대로").toHaveValue("가상 남길 줄");
  await expect(newNote(page)).toBeVisible();
  await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
  await expect(newRowOf(page), "미입금만 볼 때도 숨김").toHaveCount(0);
  await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
  await expect(newRowOf(page)).toBeVisible();
  await page.getByRole("button", { name: "그 줄만 보기" }).click();
  await expect(gridRow(page, 5)).toBeVisible();
  await expect(newRowOf(page), "기준일 없는 줄만 볼 때도 숨김").toHaveCount(0);
  await page.getByRole("button", { name: "전체 줄로 돌아가기" }).click();
  await expect(newRowOf(page)).toBeVisible();
  // 저장 실패: 값은 칸에 남고 줄 아래 '!' 글, 다시 고칠 수 있음
  await newInput(page, "공급가액(원)").fill("70000");
  await newInput(page, "공급가액(원)").press("Enter");
  await expect(newNote(page)).toContainText("! 저장하지 못했습니다.");
  await expect(newNote(page)).toContainText("넣은 값은 칸에 그대로 있습니다.");
  await expect(newInput(page, "물건 표시·내용")).toHaveValue("가상 남길 줄");
  await expect(newInput(page, "공급가액(원)")).toHaveJSProperty("readOnly", false);
  expect(await leaveWarned(page)).toBe(true);
  assertNoErrors();
});

test("PC 표 줄 끝 지우기: 그림 단추(키보드로도 닿음)를 누르면 줄 아래에 휴지통 글로 묻고, '휴지통으로 옮기기'만 DELETE를 보내며, 지운 뒤 포커스는 다음 줄 → 없으면 빈 새 줄 → 거른 목록이 비면 '장부 줄 만들기'로 간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  const trashOf = (n) => gridRow(page, n).locator("button[data-lg-trash]");
  await expect(trashOf(2)).toHaveAccessibleName("가상숲1단지 84㎡ 매매 보수 장부 줄 지우기");
  await expect(trashOf(2)).toHaveAttribute("title", "이 줄 지우기");
  const box = await trashOf(2).boundingBox();
  expect(box.height, "마우스 PC 누르는 곳 36px").toBeGreaterThanOrEqual(36);
  expect(box.width).toBeGreaterThanOrEqual(36);
  // 키보드: '고치기' 다음 Tab이 지우기 단추
  await gridRow(page, 2).getByRole("button", { name: /장부 줄 고치기$/u }).focus();
  await page.keyboard.press("Tab");
  await expect(trashOf(2)).toBeFocused();
  await page.keyboard.press("Enter");
  const ask = page.locator(".lg-table tr.lg-confirmrow");
  await expect(ask).toHaveCount(1);
  await expect(ask).toContainText("'가상숲1단지 84㎡ 매매' 줄을 지울까요? 휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다. 휴지통에 있는 동안 합계에서는 빠집니다.");
  await expect(ask.getByRole("button", { name: "휴지통으로 옮기기" })).toBeFocused();
  // Esc·'그만두기'는 보내지 않고 지우기 단추로 돌아온다
  await page.keyboard.press("Escape");
  await expect(ask).toHaveCount(0);
  await expect(trashOf(2)).toBeFocused();
  await trashOf(2).click();
  await ask.getByRole("button", { name: "그만두기" }).click();
  await expect(ask).toHaveCount(0);
  expect(calls.writes.filter((write) => write.method === "DELETE")).toHaveLength(0);
  // 지우기: DELETE 한 번 → 휴지통 알림('되살리기'·'휴지통 보기') → 다음 줄(3번)의 지우기 단추
  await trashOf(2).click();
  await ask.getByRole("button", { name: "휴지통으로 옮기기" }).press("Enter");
  await expect(gridRow(page, 2)).toHaveCount(0);
  await expect(trashOf(3)).toBeFocused();
  expect(calls.writes.filter((write) => write.method === "DELETE").map((write) => write.path)).toEqual([`/ledger/${uuid(302)}`]);
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 휴지통으로 옮겼습니다. 되살리기 · 휴지통 보기");
  await expect(page.locator("tr.lg-group--total td").nth(3), "합계에서 빠짐(미입금 없음)").toHaveText("—");
  // 맨 아래 줄을 지우면 빈 새 줄로
  await trashOf(4).click();
  await ask.getByRole("button", { name: "휴지통으로 옮기기" }).click();
  await expect(gridRow(page, 4)).toHaveCount(0);
  await expect(newRowOf(page).getByRole("button", { name: "새 장부 줄 적기" })).toBeFocused();
  // 거른 목록의 마지막 줄을 지우면(빈 새 줄도 숨어 있음) '장부 줄 만들기'로
  await page.getByRole("button", { name: "지출", exact: true }).click();
  await expect(gridRow(page, 1)).toHaveCount(0);
  await trashOf(3).click();
  await ask.getByRole("button", { name: "휴지통으로 옮기기" }).click();
  await expect(gridRow(page, 3)).toHaveCount(0);
  await expect(page.locator("[data-lg-new]")).toBeFocused();
  expect(calls.writes.filter((write) => write.method === "DELETE")).toHaveLength(3);
  await expectNoTrace(page);
  assertNoErrors();
});

test("PC 표: 칸을 저장하는 동안에는 줄 끝 지우기를 열지 않고 글로 알린다(지우면 목록을 다시 그려 저장 중인 값이 사라지므로)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let release;
  const control = { hold: new Promise((resolve) => {
    release = resolve;
  }) };
  await setup(page, { width: 1280, control });
  await page.goto("/admin/work/ledger/");
  await typeCell(page, 3, "amountWon", "60000");
  await expect(gridState(page, 3)).toHaveText("저장 중…");
  await gridRow(page, 1).locator("button[data-lg-trash]").click();
  await expect(page.locator(".lg-table tr.lg-confirmrow")).toHaveCount(0);
  await expect(page.locator("[data-lg-grid-status]")).toContainText("다른 줄을 저장하는 중이거나 저장하지 못한 칸이 있습니다.");
  release();
  await expect(gridState(page, 3)).toHaveText("저장함");
  await gridRow(page, 1).locator("button[data-lg-trash]").click();
  await expect(page.locator(".lg-table tr.lg-confirmrow")).toHaveCount(1);
  assertNoErrors();
});
