export const naverListingSortKeys = Object.freeze([
  "price",
  "price-desc",
  "latest",
  "area",
  "area-desc",
]);

export function isNaverListingSortKey(value) {
  return naverListingSortKeys.includes(value);
}

function compareOptionalNumbers(firstValue, secondValue, direction) {
  const first = Number(firstValue);
  const second = Number(secondValue);
  const firstIsNumber = firstValue !== undefined && firstValue !== "" && Number.isFinite(first);
  const secondIsNumber = secondValue !== undefined && secondValue !== "" && Number.isFinite(second);

  if (!firstIsNumber && !secondIsNumber) return 0;
  if (!firstIsNumber) return 1;
  if (!secondIsNumber) return -1;
  return direction === "desc" ? second - first : first - second;
}

export function compareNaverListingSortData(first, second, sortKey) {
  const rankDifference = compareOptionalNumbers(first.rank, second.rank, "asc");

  if (sortKey === "price" || sortKey === "price-desc") {
    return compareOptionalNumbers(first.price, second.price, sortKey === "price-desc" ? "desc" : "asc") || rankDifference;
  }
  if (sortKey === "latest") {
    return (second.confirmedAt ?? "").localeCompare(first.confirmedAt ?? "") || rankDifference;
  }
  if (sortKey === "area" || sortKey === "area-desc") {
    return compareOptionalNumbers(first.area, second.area, sortKey === "area-desc" ? "desc" : "asc") || rankDifference;
  }
  return rankDifference;
}
