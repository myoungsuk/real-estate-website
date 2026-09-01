export function splitAdminLines(value) {
  return String(value ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
}

export function parseComplexSlugLines(value) {
  return splitAdminLines(value);
}

export function formatComplexComparisonRows(rows, comparisonSlugs) {
  return rows
    .map((row) => [row.label, ...comparisonSlugs.map((slug) => row.values?.[slug] ?? "")].join(" | "))
    .join("\n");
}

export function parseComplexComparisonRows(value, comparisonSlugs) {
  if (!Array.isArray(comparisonSlugs) || comparisonSlugs.length < 2) {
    throw new Error("비교 대상 단지 slug를 두 개 이상 입력해 주세요.");
  }
  return splitAdminLines(value).map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== comparisonSlugs.length + 1) {
      throw new Error(`비교표 ${index + 1}행은 항목명과 비교 대상 ${comparisonSlugs.length}개 값을 입력해야 합니다.`);
    }
    const [label, ...values] = parts;
    if (!label || values.some((item) => !item)) {
      throw new Error(`비교표 ${index + 1}행에 빈 항목이나 값이 있습니다.`);
    }
    return {
      label,
      values: Object.fromEntries(comparisonSlugs.map((slug, valueIndex) => [slug, values[valueIndex]])),
    };
  });
}
