// 관리자 '매물 등록·동기화'의 우리집부동산 엑셀 가져오기. 가짜 관리 API(e2e/support/admin-content-mock.mjs)로만 돌고,
// 엑셀 값은 모두 지어낸 시험 값이다. 저장 요청에 호수·메모·전화가 실리지 않는지, 지난번 우리집부동산 매물만 지우는지 본다.
import { expect, test } from "@playwright/test";
import * as content from "./support/admin-content-mock.mjs";
import { WOORI_LISTING_EXPECTED_HEADERS } from "../src/lib/admin/woori-listing-import.mjs";

const row = (overrides = {}) => ({
  "번호": "1", "홍보방식": "가상홍보", "우리집매물번호": "7000001", "네이버매물번호": "9900000001", "매물종류": "아파트", "거래종류": "매매",
  "소재지": "대전시 동구 가상동", "매물명": "가상마을1BL", "상세주소": "901동 1203호 (고)", "면적1(㎡)": "[공급] 112.45", "면적2(㎡)": "[전용] 84.91",
  "매물가": "38,750", "등록": "25.09.30", "진행상황": "서비스중", "거래완료": "", "중개사메모": "가상 내부 메모 010-0000-0000",
  ...overrides,
});

const listing = (id, title) => ({
  id, title, propertyType: "아파트", tradeType: "sale", priceLabel: "3억", areaLabel: "80㎡ · 전용 59㎡", floorLabel: null, direction: null,
  summary: "가상 기존 요약", registeredAt: "2026-11-01", source: "네이버페이 부동산", url: `https://fin.land.naver.com/articles/${id}`,
});

for (const width of [360, 1280]) {
  test(`우리집부동산 엑셀: 분석·미리보기·저장 ${width}px`, async ({ page }) => {
    const naver = { checkedAt: "2026-11-23", items: [listing("9900000020", "가상 지난번 매물 1동"), listing("9900000030", "가상 부동산뱅크 2동"), listing("9900000040", "가상 직접 3동")] };
    const review = {
      schemaVersion: 1,
      updatedAt: "2026-11-23",
      items: {
        "9900000020": { source: "woori", lastSeenAt: "2026-11-23", lastReviewedAt: null },
        "9900000030": { source: "bank", lastSeenAt: "2026-11-23", lastReviewedAt: null },
        "9900000040": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
      },
    };
    const calls = await content.setup(page, { width, contents: { "naver-listings": naver, "listing-review-state": review } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/admin/listings/editor/");
    await expect(page.locator("[data-admin-write-gate]")).toHaveClass(/admin-inline-notice--ready/u);
    const buffer = content.wooriXls(WOORI_LISTING_EXPECTED_HEADERS, [
      row(),
      row({ "번호": "2", "네이버매물번호": "9900000030" }),
      row({ "번호": "3", "네이버매물번호": "9900000050", "매물종류": "상가점포", "거래종류": "월세", "매물명": "가상상가", "상세주소": "123-4 1층 101호", "면적1(㎡)": "[계약] 66.10", "매물가": "2,000/80" }),
      row({ "번호": "4", "네이버매물번호": "9900000060", "매물종류": "아파트 분양권", "매물명": "가상신도시", "상세주소": "103동 2101호 (21층)" }),
    ]);
    const panel = page.locator(".admin-woori-import");
    await panel.locator("#woori-listing-file").setInputFiles({ name: "woori-export.xls", mimeType: "application/vnd.ms-excel", buffer });
    await panel.locator("[data-woori-analyze]").click();
    await expect(panel.locator("[data-woori-summary]")).toBeVisible();
    await expect(panel.locator("[data-woori-stat='errors']")).toHaveText("0");
    await expect(panel.locator("[data-woori-stat='total']")).toHaveText("4");
    await expect(panel.locator("[data-woori-stat='new']")).toHaveText("2");
    await expect(panel.locator("[data-woori-stat='removed']")).toHaveText("1");
    await expect(panel.locator("[data-woori-stat='skipped']")).toHaveText("2");
    const preview = panel.locator("[data-woori-preview]");
    await expect(preview).toContainText("가상마을1BL 901동");
    await expect(preview).toContainText("가상 지난번 매물 1동");
    await expect(preview).toContainText("부동산뱅크 자동 받기 매물이라 건너뜁니다");
    await expect(preview).toContainText("동 번호가 없어");
    await expect(preview).not.toContainText("1203호");
    // 부동산뱅크 칸은 그대로 숨어 있다.
    await expect(page.locator("[data-bank-summary]")).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await panel.locator("[data-woori-apply]").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "검증 후 최종 저장" }).click();
    await expect(panel.locator("[data-woori-status]")).toContainText("우리집부동산 매물을 GitHub에 저장했습니다");
    expect(calls.writes).toHaveLength(1);
    const sent = JSON.stringify(calls.writes[0]);
    for (const banned of ["1203호", "2101호", "101호", "가상 내부 메모", "010-0000-0000", "7000001", "가상홍보", "woori-export"]) expect(sent.includes(banned), banned).toBe(false);
    const changes = Object.fromEntries(calls.writes[0].changes.map((change) => [change.resource, change.data]));
    expect(changes["naver-listings"].items.map((item) => item.id)).toEqual(["9900000030", "9900000040", "9900000001", "9900000060"]);
    expect(changes["naver-listings"].items.find((item) => item.id === "9900000001")).toMatchObject({ title: "가상마을1BL 901동", floorLabel: "고층", summary: "네이버에 공개된 광고 매물입니다. 자세한 조건은 상세 화면에서 확인해 주세요." });
    expect(Object.fromEntries(Object.entries(changes["listing-review-state"].items).map(([id, item]) => [id, item.source]))).toEqual({
      "9900000030": "bank", "9900000040": "manual", "9900000001": "woori", "9900000060": "woori",
    });
    expect(errors).toEqual([]);
  });
}

test("우리집부동산 엑셀: 부동산뱅크 EUC-KR 파일·머리칸이 다른 파일은 저장 단추를 켜지 않는다", async ({ page }) => {
  const naver = { checkedAt: "2026-11-23", items: [listing("9900000020", "가상 매물 1동")] };
  const review = { schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000020": { source: "manual", lastSeenAt: null, lastReviewedAt: null } } };
  await content.setup(page, { width: 390, contents: { "naver-listings": naver, "listing-review-state": review } });
  await page.goto("/admin/listings/editor/");
  await expect(page.locator("[data-admin-write-gate]")).toHaveClass(/admin-inline-notice--ready/u);
  const panel = page.locator(".admin-woori-import");
  const headers = [...WOORI_LISTING_EXPECTED_HEADERS];
  headers[3] = "네이버번호";
  await panel.locator("#woori-listing-file").setInputFiles({ name: "woori-export.xls", mimeType: "application/vnd.ms-excel", buffer: content.wooriXls(headers, [row()]) });
  await panel.locator("[data-woori-analyze]").click();
  await expect(panel.locator("[data-woori-status]")).toContainText("확인 필요한 항목이 있어");
  await expect(panel.locator("[data-woori-error-list]")).toContainText("4번째 칸이");
  await expect(panel.locator("[data-woori-apply]")).toBeDisabled();
  await panel.locator("#woori-listing-file").setInputFiles({ name: "bank.xls", mimeType: "application/vnd.ms-excel", buffer: content.bankXls(["번호"], [{ "번호": "가상" }]) });
  await panel.locator("[data-woori-analyze]").click();
  await expect(panel.locator("[data-woori-status]")).toContainText(/UTF-8로 읽지 못했습니다|표를 찾지 못했습니다/u);
  await expect(panel.locator("[data-woori-apply]")).toBeDisabled();
});
