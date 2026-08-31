import assert from "node:assert/strict";
import test from "node:test";
import {
  buildListingExplorerSearchParams,
  matchesListingExplorerState,
  normalizeListingExplorerQuery,
  parseNaverListingAreaLabel,
  parseNaverListingPriceLabel,
} from "../src/lib/naver-listing-filter.mjs";
import {
  createListingPreferencesStore,
  LISTING_PREFERENCES_STORAGE_KEY,
  MAX_FAVORITE_LISTINGS,
  parseListingPreferences,
} from "../src/lib/listing-preferences.mjs";
import { buildCompareHref, normalizeCompareIds, toggleCompareId } from "../src/lib/listing-compare.mjs";
import { buildInquiryMessage } from "../src/lib/inquiry-message.mjs";

test("억·만원과 월세 가격, 첫 번째 표시면적을 안전하게 파싱한다", () => {
  assert.deepEqual(parseNaverListingPriceLabel("5억 3,000", "sale"), {
    standard: 53_000, deposit: null, monthlyRent: null, valid: true,
  });
  assert.deepEqual(parseNaverListingPriceLabel("3,000/80", "monthly-rent"), {
    standard: null, deposit: 3_000, monthlyRent: 80, valid: true,
  });
  assert.equal(parseNaverListingPriceLabel("가격 협의", "sale").valid, false);
  assert.equal(parseNaverListingAreaLabel("공급 111㎡ · 전용 84㎡"), 111);
  assert.equal(parseNaverListingAreaLabel(null), null);
});

test("조건 query는 허용값만 복원하고 역전 범위를 해제한다", () => {
  const { state, invalidRanges } = normalizeListingExplorerQuery(
    "trade=sale&type=%EC%95%84%ED%8C%8C%ED%8A%B8&complex=leaders-city-5&sort=price-desc&minPrice=60000&maxPrice=30000&minArea=84",
    { propertyTypes: ["아파트"], complexes: ["leaders-city-5"] },
  );
  assert.equal(state.trade, "sale");
  assert.equal(state.propertyType, "아파트");
  assert.equal(state.complex, "leaders-city-5");
  assert.equal(state.sort, "price-desc");
  assert.equal(state.minPrice, null);
  assert.equal(state.maxPrice, null);
  assert.deepEqual(invalidRanges, ["price"]);
  assert.equal(buildListingExplorerSearchParams(state).toString(), "trade=sale&type=%EC%95%84%ED%8C%8C%ED%8A%B8&complex=leaders-city-5&sort=price-desc&minArea=84");
});

test("월세 조건은 보증금과 월 임대료를 독립적으로 적용한다", () => {
  const { state } = normalizeListingExplorerQuery("trade=monthly-rent&minDeposit=1000&maxRent=90&minPrice=50000");
  assert.equal(matchesListingExplorerState({ trade: "monthly-rent", propertyType: "아파트", complex: "", deposit: "3000", monthlyRent: "80", area: "84" }, state), true);
  assert.equal(matchesListingExplorerState({ trade: "monthly-rent", propertyType: "아파트", complex: "", deposit: "500", monthlyRent: "80", area: "84" }, state), false);
  assert.equal(state.minPrice, null);
});

test("관심 매물은 공개 ID만 중복 없이 최대 30개 저장한다", () => {
  const ids = new Set(Array.from({ length: 35 }, (_, index) => String(1000 + index)));
  const stored = new Map();
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const store = createListingPreferencesStore({ storage, validIds: ids, now: () => "2026-08-31T00:00:00.000Z" });
  for (const id of [...ids].slice(0, MAX_FAVORITE_LISTINGS)) assert.equal(store.toggle(id).ok, true);
  assert.equal(store.toggle("1030").reason, "limit");
  assert.equal(store.toggle("9999").reason, "invalid");
  const raw = stored.get(LISTING_PREFERENCES_STORAGE_KEY);
  assert.equal(parseListingPreferences(raw, ids).length, 30);
  assert.doesNotMatch(raw, /title|price|memo/u);
});

test("localStorage가 실패해도 현재 탭의 관심 상태는 유지된다", () => {
  const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const store = createListingPreferencesStore({ storage, validIds: new Set(["1"]) });
  assert.equal(store.toggle("1").ok, true);
  assert.deepEqual(store.getState(), { favoriteIds: ["1"], persistent: false });
});

test("종료되어 공개 목록에서 사라진 관심 ID는 저장값에서도 정리한다", () => {
  const stored = new Map([[LISTING_PREFERENCES_STORAGE_KEY, JSON.stringify({
    version: 1,
    favoriteIds: ["1", "2", "1"],
    updatedAt: "2026-08-30T00:00:00.000Z",
  })]]);
  const storage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  const store = createListingPreferencesStore({ storage, validIds: new Set(["1"]), now: () => "2026-08-31T00:00:00.000Z" });

  assert.deepEqual(store.getState().favoriteIds, ["1"]);
  assert.deepEqual(JSON.parse(stored.get(LISTING_PREFERENCES_STORAGE_KEY)).favoriteIds, ["1"]);
});

test("비교 ID는 공개 숫자 ID만 선택 순서대로 최대 3개 유지한다", () => {
  const validIds = new Set(["1", "2", "3", "4"]);
  assert.deepEqual(normalizeCompareIds("2,1,2,x,3,4", validIds), ["2", "1", "3"]);
  assert.equal(toggleCompareId(["1", "2", "3"], "4", validIds).reason, "limit");
  assert.equal(buildCompareHref(["2", "1"], validIds), "/properties/compare/?ids=2%2C1");
});

test("문의 문장은 공개 매물 정보만 포함하고 자유 메모를 200자로 제한한다", () => {
  const message = buildInquiryMessage({
    listings: [{ id: "2640120487", tradeType: "sale", priceLabel: "5억 3,000", privateMemo: "비공개" }],
    tradeType: "sale",
    location: "리더스시티5블록",
    budget: "5억원 이하",
    area: "84㎡ 이상",
    moveIn: "2026년 10월경",
    memo: `<script>alert(1)</script>${"가".repeat(220)}`,
  });
  assert.match(message, /네이버 매물번호 2640120487 \/ 매매 \/ 5억 3,000/u);
  assert.match(message, /지역·단지: 리더스시티5블록/u);
  assert.doesNotMatch(message, /비공개/u);
  assert.ok(message.length < 700);
});
