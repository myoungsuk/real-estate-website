export const ADMIN_RESOURCE_PATHS = Object.freeze({
  listings: "src/data/listings.json",
  "naver-listings": "src/data/naver-listings.json",
  "listing-review-state": ".github/listing-review-state.json",
  office: "src/data/office.json",
  complexes: "src/data/complexes.json",
  "complexes-overview": "src/data/complexes-overview.json",
  "external-links": "src/data/external-links.json",
  "home-content": "src/data/home-content.json",
  faq: "src/data/faq.json",
  reviews: "src/data/reviews.json",
});

const encoder = new TextEncoder();

export function normalizeAdminResourceJson(data) {
  const serialized = JSON.stringify(data, null, 2);
  if (typeof serialized !== "string") throw new TypeError("관리자 리소스를 JSON으로 정규화할 수 없습니다.");
  return `${serialized}\n`;
}

export async function calculateAdminResourceDigest(data, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("SHA-256 계산 기능을 사용할 수 없습니다.");
  const digest = new Uint8Array(await cryptoImpl.subtle.digest(
    "SHA-256",
    encoder.encode(normalizeAdminResourceJson(data)),
  ));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
