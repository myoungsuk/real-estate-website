import assert from "node:assert/strict";
import test from "node:test";
import {
  compareNaverListingSortData,
  isNaverListingSortKey,
  naverListingSortKeys,
} from "../src/lib/naver-listing-sort.mjs";

const listings = [
  { rank: "0", price: "30000", area: "80", confirmedAt: "2026-08-24" },
  { rank: "1", price: "10000", area: "120", confirmedAt: "2026-08-25" },
  { rank: "2", price: "30000", area: "80", confirmedAt: "2026-08-25" },
  { rank: "3", confirmedAt: "" },
];

function sortedRanks(sortKey) {
  return [...listings].sort((first, second) => compareNaverListingSortData(first, second, sortKey)).map((item) => item.rank);
}

test("네이버 매물 정렬 키는 URL에서 허용할 값만 받는다", () => {
  assert.deepEqual(naverListingSortKeys, ["price", "price-desc", "latest", "area", "area-desc"]);
  assert.equal(isNaverListingSortKey("price-desc"), true);
  assert.equal(isNaverListingSortKey("default"), false);
});

test("네이버 매물 정렬은 방향과 동률 순서를 일관되게 적용한다", () => {
  assert.deepEqual(sortedRanks("default"), ["0", "1", "2", "3"]);
  assert.deepEqual(sortedRanks("price"), ["1", "0", "2", "3"]);
  assert.deepEqual(sortedRanks("price-desc"), ["0", "2", "1", "3"]);
  assert.deepEqual(sortedRanks("latest"), ["1", "2", "0", "3"]);
  assert.deepEqual(sortedRanks("area"), ["0", "2", "1", "3"]);
  assert.deepEqual(sortedRanks("area-desc"), ["1", "0", "2", "3"]);
});
