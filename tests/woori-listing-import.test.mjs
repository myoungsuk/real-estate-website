import assert from "node:assert/strict";
import test from "node:test";
import {
  WOORI_LISTING_DEFAULT_SUMMARY,
  WOORI_LISTING_EXPECTED_HEADERS,
  createWooriListingImport,
  formatWooriAreaLabel,
  formatWooriFloorLabel,
  formatWooriPriceLabel,
  parseWooriDetailAddress,
  parseWooriRegisteredAt,
} from "../src/lib/admin/woori-listing-import.mjs";
import { validateNaverListings } from "../scripts/content-validation.mjs";
import { validateListingReviewState, updateListingReviewStateForAdmin } from "../src/lib/listing-review.mjs";

// 모든 값은 지어낸 시험 값이다(실제 우리집부동산 파일 값 아님).
const makeRow = (overrides = {}) => {
  const values = {
    "번호": "1",
    "홍보방식": "가상홍보",
    "우리집매물번호": "7000001",
    "네이버매물번호": "9900000001",
    "매물종류": "아파트",
    "거래종류": "매매",
    "소재지": "대전시 동구 가상동",
    "매물명": "가상마을1BL",
    "상세주소": "901동 1203호 (고)",
    "면적1(㎡)": "[공급] 112.45",
    "면적2(㎡)": "[전용] 84.91",
    "매물가": "38,750",
    "등록": "25.09.30",
    "진행상황": "서비스중",
    "거래완료": "",
    "중개사메모": "가상 내부 메모 010-0000-0000",
    ...overrides,
  };
  return WOORI_LISTING_EXPECTED_HEADERS.map((header) => values[header]);
};

const baseData = (items = []) => ({ checkedAt: "2026-11-23", items });
const emptyReview = { schemaVersion: 1, updatedAt: "2026-11-23", items: {} };
const existing = (id, extra = {}) => ({
  id,
  title: `가상 기존 ${id}`,
  propertyType: "아파트",
  tradeType: "sale",
  priceLabel: "3억",
  areaLabel: "80㎡ · 전용 59㎡",
  floorLabel: null,
  direction: "남향",
  summary: "가상 기존 요약",
  registeredAt: "2026-11-01",
  source: "네이버페이 부동산",
  url: `https://fin.land.naver.com/articles/${id}`,
  ...extra,
});

test("상세주소에서 동 번호와 괄호 안 광고 층만 꺼내고 호수는 버린다", () => {
  assert.deepEqual(parseWooriDetailAddress("901동 1203호 (고)"), { building: "901", floor: "고", totalFloors: null });
  assert.deepEqual(parseWooriDetailAddress("902동 304호 (7층)"), { building: "902", floor: "7", totalFloors: null });
  assert.deepEqual(parseWooriDetailAddress("123-4 1층 101,102호"), { building: null, floor: null, totalFloors: null });
  assert.equal(formatWooriFloorLabel("고"), "고층");
  assert.equal(formatWooriFloorLabel("7"), "7층");
  assert.equal(formatWooriFloorLabel("7", "7/22층"), "7/22층");
  assert.equal(formatWooriFloorLabel("8", "7/22층"), "8층");
  assert.equal(formatWooriFloorLabel(null, "중/15층"), "중/15층");
});

test("가격·면적·등록일을 지금 공개 카드 꼴로 바꾼다", () => {
  assert.equal(formatWooriPriceLabel("38,750", "sale"), "3억 8,750");
  assert.equal(formatWooriPriceLabel("2,000/80", "monthly-rent"), "2,000/80");
  assert.equal(formatWooriPriceLabel("10,000/120", "monthly-rent"), "1억/120");
  assert.equal(formatWooriPriceLabel("2,000/80", "sale"), null);
  assert.equal(formatWooriPriceLabel("2,000", "monthly-rent"), null);
  assert.equal(formatWooriAreaLabel("[공급] 112.45", "[전용] 84.91", "아파트"), "112㎡ · 전용 84.91㎡");
  assert.equal(formatWooriAreaLabel("[계약] 66.10", "[전용] 50.20", "상가점포"), "계약 66.1㎡ · 전용 50.2㎡");
  assert.equal(formatWooriAreaLabel("[공급] 70", "[전용] 60.5", "빌라/연립"), "공급 70㎡ · 전용 60.5㎡");
  assert.equal(formatWooriAreaLabel("112.45", "[전용] 84.91", "아파트"), null);
  assert.equal(parseWooriRegisteredAt("25.09.30"), "2025-09-30");
  assert.equal(parseWooriRegisteredAt("26.02.30"), null);
});

test("새 매물은 동 번호 제목·광고 층·기본 요약으로 만들고 호수·메모·전화는 남기지 않는다", () => {
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow(),
    makeRow({ "네이버매물번호": "9900000002", "매물종류": "아파트 분양권", "매물명": "가상신도시", "상세주소": "103동 2101호 (21층)" }),
  ], baseData([existing("9900000099")]), emptyReview, "2026-11-24");
  assert.deepEqual(result.errors, []);
  assert.equal(result.newItems.length, 2);
  const [first, second] = result.nextData.items.slice(-2);
  assert.deepEqual(first, {
    id: "9900000001",
    title: "가상마을1BL 901동",
    propertyType: "아파트",
    tradeType: "sale",
    priceLabel: "3억 8,750",
    areaLabel: "112㎡ · 전용 84.91㎡",
    floorLabel: "고층",
    direction: null,
    summary: WOORI_LISTING_DEFAULT_SUMMARY,
    registeredAt: "2025-09-30",
    source: "네이버페이 부동산",
    url: "https://fin.land.naver.com/articles/9900000001",
  });
  assert.equal(second.propertyType, "아파트분양권");
  assert.equal(second.floorLabel, "21층");
  const text = JSON.stringify(result.nextData);
  for (const banned of ["1203호", "2101호", "가상 내부 메모", "010-0000-0000", "7000001", "가상홍보"]) assert.equal(text.includes(banned), false, banned);
  assert.equal(result.nextData.checkedAt, "2026-11-24");
  assert.deepEqual(validateNaverListings(result.nextData), []);
  assert.deepEqual([...result.wooriIds].sort(), ["9900000001", "9900000002"]);
});

test("리더스시티 BL 표기는 부동산뱅크 가져오기와 같은 단지 이름으로 바꾼다", () => {
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow({ "매물명": "리더스시티5BL" })], baseData(), emptyReview, "2026-11-24");
  assert.equal(result.nextData.items[0].title, "리더스시티 5블록 901동");
});

test("이미 있는 매물은 기존 요약·방향과 같은 층의 총층 표기를 그대로 둔다", () => {
  const current = existing("9900000001", { floorLabel: "고/27층", summary: "가상 운영자 요약" });
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow()], baseData([current]), emptyReview, "2026-11-24");
  const item = result.nextData.items[0];
  assert.equal(item.summary, "가상 운영자 요약");
  assert.equal(item.direction, "남향");
  assert.equal(item.floorLabel, "고/27층");
  assert.equal(result.changedItems.length, 1);
  // 직접 등록이던 매물이 우리집부동산 매물로 바뀌는 것은 미리보기에서 따로 알린다.
  assert.deepEqual(result.takenOverItems.map((item) => item.id), []);
  const withManual = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow()], baseData([current]), {
    schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000001": { source: "manual", lastSeenAt: null, lastReviewedAt: null } },
  }, "2026-11-24");
  assert.deepEqual(withManual.takenOverItems.map((item) => item.id), ["9900000001"]);
});

test("월세 상가처럼 동 번호가 없는 줄은 건너뛰고 까닭을 알리며, 나머지는 막지 않는다", () => {
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow(),
    makeRow({ "네이버매물번호": "9900000003", "매물종류": "상가점포", "거래종류": "월세", "매물명": "가상상가", "상세주소": "123-4 1층 101,102호", "면적1(㎡)": "[계약] 66.10", "면적2(㎡)": "[전용] 50.20", "매물가": "2,000/80" }),
  ], baseData(), emptyReview, "2026-11-24");
  assert.deepEqual(result.errors, []);
  assert.equal(result.importedCount, 1);
  assert.equal(result.skippedItems.length, 1);
  assert.match(result.skippedItems[0].reason, /동 번호가 없어/u);
  assert.equal(JSON.stringify(result).includes("101,102호"), false);
});

test("같은 번호로 이미 등록된 상가는 그 제목으로 월세 값을 갱신한다", () => {
  const shop = existing("9900000003", { title: "가상 상가 1층", propertyType: "상가점포", tradeType: "monthly-rent", priceLabel: "2,000/70", areaLabel: "계약 66.1㎡ · 전용 50.2㎡" });
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow({ "네이버매물번호": "9900000003", "매물종류": "상가점포", "거래종류": "월세", "매물명": "가상상가", "상세주소": "123-4 1층 101호", "면적1(㎡)": "[계약] 66.10", "면적2(㎡)": "[전용] 50.20", "매물가": "2,000/80" }),
  ], baseData([shop]), emptyReview, "2026-11-24");
  assert.deepEqual(result.errors, []);
  assert.equal(result.nextData.items[0].title, "가상 상가 1층");
  assert.equal(result.nextData.items[0].priceLabel, "2,000/80");
  assert.deepEqual(validateNaverListings(result.nextData), []);
});

test("부동산뱅크 매물·서비스중이 아닌 줄·거래완료 줄·네이버 번호 없는 줄·겹친 번호는 건너뛴다", () => {
  const bankItem = existing("9900000010");
  const review = { schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000010": { source: "bank", lastSeenAt: "2026-11-23", lastReviewedAt: null } } };
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow({ "네이버매물번호": "9900000010" }),
    makeRow({ "네이버매물번호": "9900000011", "진행상황": "광고종료" }),
    makeRow({ "네이버매물번호": "9900000012", "거래완료": "26.11.22" }),
    makeRow({ "네이버매물번호": "" }),
    makeRow({ "네이버매물번호": "9900000013" }),
    makeRow({ "네이버매물번호": "9900000013", "매물가": "51,230" }),
  ], baseData([bankItem]), review, "2026-11-24");
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.skippedItems.map((item) => item.reason.slice(0, 8)), [
    "부동산뱅크 자동",
    "진행상황이 '서",
    "거래완료 칸이 ",
    "네이버 매물번호",
    "같은 네이버 매",
  ]);
  assert.deepEqual(result.nextData.items.find((item) => item.id === "9900000010"), bankItem);
  assert.equal(result.nextData.items.find((item) => item.id === "9900000013").priceLabel, "3억 8,750");
  assert.deepEqual([...result.wooriIds], ["9900000013"]);
});

test("다시 올리면 지난번 우리집부동산 매물 가운데 이번 파일에 없는 것만 지운다", () => {
  const items = [existing("9900000001"), existing("9900000020"), existing("9900000030"), existing("9900000040")];
  const review = {
    schemaVersion: 1,
    updatedAt: "2026-11-23",
    items: {
      "9900000001": { source: "woori", lastSeenAt: "2026-11-23", lastReviewedAt: null },
      "9900000020": { source: "woori", lastSeenAt: "2026-11-23", lastReviewedAt: null },
      "9900000030": { source: "bank", lastSeenAt: "2026-11-23", lastReviewedAt: null },
      "9900000040": { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  };
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow()], baseData(items), review, "2026-11-24");
  assert.deepEqual(result.removedItems.map((item) => item.id), ["9900000020"]);
  assert.deepEqual(result.nextData.items.map((item) => item.id), ["9900000001", "9900000030", "9900000040"]);
  const nextReview = updateListingReviewStateForAdmin({ listings: result.nextData.items, currentState: review, updatedAt: "2026-11-24", wooriIds: result.wooriIds });
  validateListingReviewState(nextReview, { listingIds: result.nextData.items.map((item) => item.id), bankIds: ["9900000030"] });
  assert.deepEqual(Object.fromEntries(Object.entries(nextReview.items).map(([id, item]) => [id, item.source])), {
    "9900000001": "woori",
    "9900000030": "bank",
    "9900000040": "manual",
  });
});

test("형식이 틀린 줄이 하나라도 있으면 아무것도 지우거나 저장하지 않는다", () => {
  const review = { schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000020": { source: "woori", lastSeenAt: "2026-11-23", lastReviewedAt: null } } };
  for (const overrides of [
    { "매물가": "가격협의" },
    { "면적1(㎡)": "112.45" },
    { "등록": "2025-09-30" },
    { "등록": "26.12.31" },
    { "거래종류": "단기임대" },
    { "네이버매물번호": "99-00" },
    { "매물명": "가상마을 1203호" },
  ]) {
    const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow(overrides)], baseData([existing("9900000020")]), review, "2026-11-24");
    assert.equal(result.errors.length > 0, true, JSON.stringify(overrides));
    assert.equal(result.nextData, null);
  }
});

test("머리칸 16개가 하나라도 다르면 막고, 칸 수가 다른 표 아래 안내 줄은 건너뛴다", () => {
  const headers = [...WOORI_LISTING_EXPECTED_HEADERS];
  headers[3] = "네이버번호";
  const wrong = createWooriListingImport(headers, [makeRow()], baseData(), emptyReview, "2026-11-24");
  assert.match(wrong.errors[0].message, /4번째 칸/u);
  assert.equal(wrong.nextData, null);
  const footer = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [makeRow(), ["가상 안내 :", "가상 문구"]], baseData(), emptyReview, "2026-11-24");
  assert.equal(footer.rowCount, 1);
  assert.equal(footer.ignoredRowCount, 1);
  assert.deepEqual(footer.errors, []);
});
