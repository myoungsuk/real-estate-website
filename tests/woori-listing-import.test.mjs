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
  // 동 번호가 없는 상가 줄은 따로 떨어진 "1층"의 층 숫자만 쓰고 지번·호수는 버린다(2026-11-24 모든 종류 받기).
  assert.deepEqual(parseWooriDetailAddress("123-4 1층 101,102호"), { building: null, floor: "1", totalFloors: null });
  assert.deepEqual(parseWooriDetailAddress("123-4 101호"), { building: null, floor: null, totalFloors: null });
  assert.deepEqual(parseWooriDetailAddress("(1/4층)"), { building: null, floor: "1", totalFloors: "4" });
  assert.deepEqual(parseWooriDetailAddress("901동 1203호 3층"), { building: "901", floor: null, totalFloors: null }, "동이 있으면 괄호 밖 층은 읽지 않음(지금 그대로)");
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
  // 토지·단독 등(2026-11-24 모든 종류 받기): 토지는 한 칸, 단독은 대지·연면적, 전용이 비거나 0이면 첫 칸만(아파트·분양권은 막음).
  assert.equal(formatWooriAreaLabel("[토지] 4,027", "", "토지"), "토지 4027㎡");
  assert.equal(formatWooriAreaLabel("[토지] 4027", "[전용] 10", "토지"), null, "토지에 둘째 면적이 오면 뜻을 몰라 막음");
  assert.equal(formatWooriAreaLabel("[대지] 330", "[연면적] 125.5", "단독/다가구"), "대지 330㎡ · 연면적 125.5㎡");
  assert.equal(formatWooriAreaLabel("[대지] 330", "[연면적] 0.00", "단독/다가구"), "대지 330㎡");
  assert.equal(formatWooriAreaLabel("[대지] 330", "[전용] 125", "단독/다가구"), null, "대지와 전용은 짝이 아님");
  assert.equal(formatWooriAreaLabel("[계약] 66.1", "[전용] 0.00", "상가점포"), "계약 66.1㎡");
  assert.equal(formatWooriAreaLabel("[공급] 112.45", "[전용] 0.00", "아파트"), null);
  assert.equal(formatWooriAreaLabel("[토지] 0", "", "토지"), null);
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

// 2026-11-24 사용자 지시 "상가 토지도 해"·"그 밖도 다 해": 동 번호가 없는 상가·토지 등도 건너뛰지 않고 싣는다.
test("월세 상가처럼 동 번호가 없는 줄도 공개 매물명과 층 숫자만으로 싣고, 지번·호수는 남기지 않는다", () => {
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow(),
    makeRow({ "네이버매물번호": "9900000003", "매물종류": "상가점포", "거래종류": "월세", "소재지": "대전광역시 동구 가상동 123-4", "매물명": "가상상가", "상세주소": "123-4 1층 101,102호", "면적1(㎡)": "[계약] 66.10", "면적2(㎡)": "[전용] 50.20", "매물가": "2,000/80" }),
  ], baseData(), emptyReview, "2026-11-24");
  assert.deepEqual(result.errors, []);
  assert.equal(result.importedCount, 2);
  assert.deepEqual(result.skippedItems, []);
  const shop = result.nextData.items.find((item) => item.id === "9900000003");
  assert.deepEqual(
    { title: shop.title, propertyType: shop.propertyType, tradeType: shop.tradeType, priceLabel: shop.priceLabel, areaLabel: shop.areaLabel, floorLabel: shop.floorLabel, summary: shop.summary },
    { title: "가상상가 50㎡", propertyType: "상가점포", tradeType: "monthly-rent", priceLabel: "2,000/80", areaLabel: "계약 66.1㎡ · 전용 50.2㎡", floorLabel: "1층", summary: WOORI_LISTING_DEFAULT_SUMMARY },
  );
  const text = JSON.stringify(result);
  for (const banned of ["101,102호", "123-4", "102호"]) assert.equal(text.includes(banned), false, banned);
  assert.deepEqual(validateNaverListings(result.nextData), []);
});

test("아파트·분양권 밖의 종류: 매물명이 지번·호수 꼴이거나 비면 '{동네} {종류}' 제목, 동네도 없으면 '{종류} 매물', 끝에 면적 정수(2026-11-25)", () => {
  const rows = [
    makeRow({ "네이버매물번호": "9900000051", "매물종류": "상가점포", "소재지": "대전광역시 동구 가상동 123-4", "매물명": "123-4 가상빌딩 101호", "상세주소": "123-4 2층 201호", "면적1(㎡)": "[계약] 40", "면적2(㎡)": "[전용] 30" }),
    makeRow({ "네이버매물번호": "9900000052", "매물종류": "빌라/연립", "소재지": "대전광역시 동구 가상동", "매물명": "", "상세주소": "(2/3층)", "면적1(㎡)": "[공급] 65", "면적2(㎡)": "[전용] 59.9" }),
    makeRow({ "네이버매물번호": "9900000053", "매물종류": "토지", "소재지": "대전광역시 동구 가상2동", "매물명": "", "상세주소": "", "면적1(㎡)": "[토지] 1,200", "면적2(㎡)": "" }),
    makeRow({ "네이버매물번호": "9900000054", "매물종류": "단독/다가구", "소재지": "", "매물명": "", "상세주소": "(2/2층)", "면적1(㎡)": "[대지] 330", "면적2(㎡)": "[연면적] 125.5" }),
    makeRow({ "네이버매물번호": "9900000055", "매물종류": "사무실", "소재지": "대전광역시 동구 가상동", "매물명": "가상타워", "상세주소": "(5/10층)", "면적1(㎡)": "[계약] 80", "면적2(㎡)": "[전용] 60" }),
  ];
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, rows, baseData(), emptyReview, "2026-11-24");
  assert.deepEqual(result.errors, []);
  const pick = (id) => {
    const item = result.nextData.items.find((listing) => listing.id === id);
    return [item.title, item.propertyType, item.areaLabel, item.floorLabel];
  };
  assert.deepEqual(pick("9900000051"), ["가상동 상가 30㎡", "상가점포", "계약 40㎡ · 전용 30㎡", "2층"]);
  assert.deepEqual(pick("9900000052"), ["가상동 빌라 59㎡", "빌라/연립", "공급 65㎡ · 전용 59.9㎡", "2/3층"]);
  assert.deepEqual(pick("9900000053"), ["가상2동 토지 1,200㎡", "토지", "토지 1200㎡", null], "토지는 층 없음(null)");
  assert.deepEqual(pick("9900000054"), ["단독주택 매물 125㎡", "단독/다가구", "대지 330㎡ · 연면적 125.5㎡", "2/2층"]);
  assert.deepEqual(pick("9900000055"), ["가상타워 60㎡", "사무실", "계약 80㎡ · 전용 60㎡", "5/10층"]);
  const text = JSON.stringify(result.nextData);
  for (const banned of ["123-4", "101호", "201호"]) assert.equal(text.includes(banned), false, banned);
  assert.deepEqual(validateNaverListings(result.nextData), []);
});

test("처음 보는 매물종류가 한 줄이라도 오면 그날 반영 전체를 막는다(모르는 종류로 지우거나 싣지 않음)", () => {
  const review = { schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000020": { source: "woori", lastSeenAt: "2026-11-23", lastReviewedAt: null } } };
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow(),
    makeRow({ "네이버매물번호": "9900000061", "매물종류": "가상숙박시설" }),
  ], baseData([existing("9900000020")]), review, "2026-11-24");
  assert.equal(result.nextData, null);
  assert.deepEqual(result.errors.map((error) => [error.rowNumber, error.message.slice(0, 10)]), [[3, "처음 보는 매물종류"]]);
});

test("직접 등록 상가와 번호가 같으면 우리집부동산 매물로 넘어가되, 직접 쓴 제목·설명·방향은 그대로 둔다", () => {
  const manual = existing("9900000070", { title: "가상동 일반상가", propertyType: "상가점포", tradeType: "monthly-rent", priceLabel: "2,000/70", areaLabel: "계약 45㎡ · 전용 36㎡", floorLabel: "1/1층", direction: "남향", summary: "직접 쓴 가상 설명" });
  const review = { schemaVersion: 1, updatedAt: "2026-11-23", items: { "9900000070": { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-20" } } };
  const result = createWooriListingImport(WOORI_LISTING_EXPECTED_HEADERS, [
    makeRow({ "네이버매물번호": "9900000070", "매물종류": "상가점포", "거래종류": "월세", "매물명": "가상상가", "상세주소": "(1/1층)", "면적1(㎡)": "[계약] 45", "면적2(㎡)": "[전용] 36", "매물가": "2,000/80" }),
  ], baseData([manual]), review, "2026-11-24");
  assert.deepEqual(result.errors, []);
  const item = result.nextData.items[0];
  assert.equal(item.title, "가상동 일반상가");
  assert.equal(item.summary, "직접 쓴 가상 설명");
  assert.equal(item.direction, "남향");
  assert.equal(item.priceLabel, "2,000/80", "가격은 우리집부동산 값으로 바뀜");
  assert.deepEqual(result.takenOverItems.map((entry) => entry.id), ["9900000070"]);
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
    { "매물종류": "가상숙박시설" },
    { "매물종류": "토지", "면적1(㎡)": "[토지] 0", "면적2(㎡)": "" },
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
