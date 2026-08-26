import assert from "node:assert/strict";
import test from "node:test";
import {
  BANK_LISTING_EXPECTED_HEADERS,
  createBankListingImport,
  createManualNaverListing,
  formatBankAreaLabel,
  formatBankPriceLabel,
  parseBankRegisteredAt,
} from "../src/lib/admin/bank-listing-import.mjs";

const makeRow = (overrides = {}) => {
  const values = {
    "번호": "1",
    "매물번호 (네이버번호)": "143293603 ( 2645402920 )",
    "거래": "매매",
    "매물종류": "아파트",
    "소재지": "동구 천동",
    "매물명": "리더스시티5BL",
    "매물설명": "507동 2405호",
    "면적(㎡)": "81.32B/59.64",
    "해당층/총층": "24 / 29",
    "방향": "남서향",
    "방수": "3",
    "욕실수": "2",
    "월관리비": "",
    "매물가(만원)": "39,000",
    "입주가능일": "협의",
    "특징": "시스템에어컨 설치, 입주 협의 가능",
    "상세설명": "수동 테스트용 내부 설명",
    "등록기간": "26.08.24 ~26.09.23",
    "소유자명": "가상소유자",
    "소유자 핸드폰번호": "010-1111-2222",
    "매도자명": "가상매도자",
    "매도자 핸드폰번호": "010-3333-4444",
    "진행상황 (확인방식)": "서비스중",
    "메모": "가상 내부 메모",
    "사진 개수": "0",
    ...overrides,
  };
  return BANK_LISTING_EXPECTED_HEADERS.map((header) => values[header] ?? "");
};

const existing = {
  id: "2645402920",
  title: "리더스시티 5블록 507동",
  propertyType: "아파트",
  tradeType: "sale",
  priceLabel: "3억 9,000",
  areaLabel: "81B㎡ · 전용 59.64B㎡",
  floorLabel: "고/29층",
  direction: "남서향",
  summary: "시스템에어컨 설치, 입주 협의 가능",
  registeredAt: "2026-08-24",
  source: "네이버페이 부동산",
  url: "https://fin.land.naver.com/articles/2645402920",
};

test("부동산뱅크 가격·면적·등록일을 현재 공개 표시로 변환한다", () => {
  assert.equal(formatBankPriceLabel("45,780"), "4억 5,780");
  assert.equal(formatBankPriceLabel("30,000"), "3억");
  assert.equal(formatBankAreaLabel("81.32B/59.64", "아파트"), "81B㎡ · 전용 59.64B㎡");
  assert.equal(formatBankAreaLabel("330/125.45", "단독/다가구"), "대지 330㎡ · 연면적 125.45㎡");
  assert.equal(parseBankRegisteredAt("26.08.24 ~26.09.23"), "2026-08-24");
});

test("엑셀 가져오기는 기존 공개 층과 사이트 전용 매물을 보존한다", () => {
  const manual = { ...existing, id: "2999999999", title: "수동 등록 매물", url: "https://fin.land.naver.com/articles/2999999999" };
  const result = createBankListingImport(
    BANK_LISTING_EXPECTED_HEADERS,
    [makeRow(), makeRow({
      "매물번호 (네이버번호)": "143000001 ( 2645400881 )",
      "거래": "전세",
      "매물종류": "아파트분양권",
      "매물명": "e편한세상서대전역센트로",
      "매물설명": "104동 1203호",
      "면적(㎡)": "110.62A/84.93",
      "매물가(만원)": "40,000",
    })],
    { checkedAt: "2026-08-25", items: [existing, manual] },
    "2026-08-26",
  );

  assert.deepEqual(result.errors, []);
  assert.equal(result.newItems.length, 1);
  assert.equal(result.sameItems.length, 1);
  assert.equal(result.siteOnlyItems.length, 1);
  assert.equal(result.nextData.items.find((item) => item.id === existing.id).floorLabel, "고/29층");
  assert.ok(result.nextData.items.some((item) => item.id === manual.id));
  assert.doesNotMatch(JSON.stringify(result.nextData), /2405호|1203호|가상소유자|010-1111-2222|가상 내부 메모/u);
});

test("개인정보나 월세 추정이 필요한 엑셀은 전체 저장을 차단한다", () => {
  const privacyRisk = createBankListingImport(
    BANK_LISTING_EXPECTED_HEADERS,
    [makeRow({ "특징": "문의 010-5555-6666" })],
    { checkedAt: "2026-08-25", items: [existing] },
    "2026-08-26",
  );
  assert.equal(privacyRisk.nextData, null);
  assert.match(privacyRisk.errors.map((error) => error.message).join("\n"), /전화번호/);
  assert.doesNotMatch(JSON.stringify(privacyRisk.errors), /010-5555-6666/);

  const monthly = createBankListingImport(
    BANK_LISTING_EXPECTED_HEADERS,
    [makeRow({ "거래": "월세" })],
    { checkedAt: "2026-08-25", items: [existing] },
    "2026-08-26",
  );
  assert.equal(monthly.nextData, null);
  assert.match(monthly.errors.map((error) => error.message).join("\n"), /월세 엑셀 샘플/);
});

test("수동 등록은 공개 필드만 만들고 출처와 네이버 URL을 고정한다", () => {
  const result = createManualNaverListing({
    id: "2645400881",
    title: "e편한세상서대전역센트로 104동",
    propertyType: "아파트분양권",
    tradeType: "jeonse",
    priceLabel: "4억",
    areaLabel: "110A㎡ · 전용 84.93A㎡",
    floorLabel: "중/20층",
    direction: "남서향",
    summary: "네이버에 공개된 매물 설명",
    registeredAt: "2026-08-26",
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.listing.source, "네이버페이 부동산");
  assert.equal(result.listing.url, "https://fin.land.naver.com/articles/2645400881");

  const unsafe = createManualNaverListing({ ...result.listing, summary: "정확한 위치 1203호" });
  assert.match(unsafe.errors.join("\n"), /정확한 호수/);
});
