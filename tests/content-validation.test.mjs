import test from "node:test";
import assert from "node:assert/strict";
import { findBannedKeys, validateListing } from "../scripts/content-validation.mjs";

const base = {
  id: "leaders-city-5-sale-001",
  slug: "leaders-city-5-sale-001",
  title: "공개 승인 매물",
  status: "published",
  propertyType: "apartment",
  tradeType: "sale",
  complex: "leaders-city-5",
  salePriceKrw: 500000000,
  depositKrw: null,
  monthlyRentKrw: null,
  exclusiveAreaM2: 84.9,
  summary: "검증용 가상 데이터",
  features: [],
  source: "test",
  confirmedAt: "2026-08-24",
  publishedAt: "2026-08-24"
};

test("유효한 매매 가격 조합을 허용한다", () => {
  assert.deepEqual(validateListing(base), []);
});

test("월세에 매매가격이 함께 있으면 거부한다", () => {
  const listing = { ...base, tradeType: "monthly-rent", depositKrw: 10000000, monthlyRentKrw: 700000 };
  assert.match(validateListing(listing).join("\n"), /월세/);
});

test("공개 저장 금지 필드를 재귀적으로 찾는다", () => {
  assert.match(findBannedKeys({ nested: { clientPhone: "010" } }).join("\n"), /clientPhone/);
});
