const TRADE_LABELS = Object.freeze({ sale: "매매", jeonse: "전세", "monthly-rent": "월세" });

function cleanText(value, maximum) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, "")
    .replace(/[ \t]+/gu, " ")
    .trim()
    .slice(0, maximum);
}

export function buildInquiryMessage(input = {}) {
  const listings = Array.isArray(input.listings) ? input.listings.slice(0, 3) : [];
  const lines = ["안녕하세요. 행복한부동산 홈페이지에서 매물을 보고 문의드립니다."];

  if (listings.length > 0) {
    lines.push("", "관심 매물");
    for (const listing of listings) {
      const id = /^\d+$/u.test(String(listing.id ?? "")) ? String(listing.id) : "";
      if (!id) continue;
      const trade = TRADE_LABELS[listing.tradeType] ?? cleanText(listing.tradeType, 20);
      const price = cleanText(listing.priceLabel, 40);
      lines.push(`- 네이버 매물번호 ${id}${trade ? ` / ${trade}` : ""}${price ? ` / ${price}` : ""}`);
    }
  }

  const conditions = [
    ["거래유형", TRADE_LABELS[input.tradeType] ?? cleanText(input.tradeType, 20)],
    ["지역·단지", cleanText(input.location, 80)],
    ["예산", cleanText(input.budget, 80)],
    ["면적", cleanText(input.area, 80)],
    ["입주 시기", cleanText(input.moveIn, 80)],
  ].filter(([, value]) => value);
  if (conditions.length > 0) {
    lines.push("", "희망 조건", ...conditions.map(([label, value]) => `- ${label}: ${value}`));
  }

  const memo = cleanText(input.memo, 200);
  if (memo) lines.push("", "추가 요청", memo);
  lines.push("", "매물의 현재 상태와 확인 가능한 조건을 다시 상담 부탁드립니다.");
  return lines.join("\n");
}
