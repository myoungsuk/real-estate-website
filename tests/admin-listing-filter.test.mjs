import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAdminListings,
  matchesAdminListing,
  normalizeAdminListingQuery,
  normalizeAdminListingStatus,
  readAdminListingFilters,
} from "../src/lib/admin-listing-filter.mjs";

const records = [
  {
    id: "listing-a",
    status: "published",
    searchText: "리더스시티 5블록 천동 매매 leaders-city-5-sale-001",
  },
  {
    id: "listing-b",
    status: "draft",
    searchText: "용운동 아파트 전세 yongun-dong-jeonse-001",
  },
  {
    id: "listing-c",
    status: "ended",
    searchText: "신흥동 월세 shinheung-dong-rent-001",
  },
];

test("관리자 매물 검색어는 공백과 영문 대소문자를 정규화한다", () => {
  assert.equal(normalizeAdminListingQuery("  LEADERS   City  "), "leaders city");
  assert.equal(normalizeAdminListingQuery("ＬＥＡＤＥＲＳ"), "leaders");
});

test("알 수 없는 관리자 매물 상태는 전체 상태로 되돌린다", () => {
  assert.equal(normalizeAdminListingStatus("published"), "published");
  assert.equal(normalizeAdminListingStatus("deleted"), "all");
});

test("매물명·지역·ID 통합 검색이 동작한다", () => {
  assert.deepEqual(
    filterAdminListings(records, { query: "용운동", status: "all" }).map((record) => record.id),
    ["listing-b"],
  );
  assert.equal(matchesAdminListing(records[0], { query: "SALE-001", status: "all" }), true);
});

test("검색어와 공개 상태를 함께 적용한다", () => {
  assert.deepEqual(
    filterAdminListings(records, { query: "동", status: "ended" }).map((record) => record.id),
    ["listing-c"],
  );
  assert.deepEqual(filterAdminListings(records, { query: "천동", status: "draft" }), []);
});

test("URL 쿼리에서 검색 조건을 안전하게 읽는다", () => {
  assert.deepEqual(
    readAdminListingFilters(new URLSearchParams("q=%20%EC%9A%A9%EC%9A%B4%EB%8F%99%20&status=draft")),
    { query: "용운동", status: "draft" },
  );
  assert.deepEqual(
    readAdminListingFilters(new URLSearchParams("q=&status=unknown")),
    { query: "", status: "all" },
  );
});
