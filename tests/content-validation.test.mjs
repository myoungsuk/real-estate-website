import test from "node:test";
import assert from "node:assert/strict";
import { findBannedKeys, validateComplexes, validateExternalLinks, validateHomeContent, validateListing, validateOffice } from "../scripts/content-validation.mjs";

const base = {
  id: "leaders-city-5-sale-001",
  slug: "leaders-city-5-sale-001",
  title: "공개 승인 매물",
  status: "published",
  propertyType: "apartment",
  tradeType: "sale",
  district: "대전 동구",
  neighborhoodSlug: "cheon-dong",
  neighborhoodName: "천동",
  complexName: "리더스시티 5블록",
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

test("대전 동구의 다른 동네 매물도 허용한다", () => {
  const listing = { ...base, id: "yongun-dong-sale-001", slug: "yongun-dong-sale-001", neighborhoodSlug: "yongun-dong", neighborhoodName: "용운동", complexName: null };
  assert.deepEqual(validateListing(listing), []);
});

test("대전 동구 밖의 매물은 거부한다", () => {
  assert.match(validateListing({ ...base, district: "대전 중구" }).join("\n"), /대전 동구/);
});

test("확정된 사무소 정보와 영업시간을 허용한다", () => {
  const office = {
    legalName: "테스트공인중개사사무소",
    brandName: "테스트부동산",
    serviceArea: "대전광역시 동구",
    representative: "홍길동",
    mobile: "010-0000-0000",
    email: "owner@example.com",
    address: "공개 주소",
    registrationNumber: "00000-0000-00000",
    businessNumber: "000-00-00000",
    parking: "주차 가능",
    hours: [{ label: "평일", days: ["Monday"], opens: "09:00", closes: "18:00", note: null }],
    introduction: ["공개 승인된 소개 문안"],
    publicClaims: { basis: "운영자 확인 기준", items: [{ label: "허위매물", value: "0건" }] },
    naverPlaceUrl: "https://map.naver.com/",
    naverBlogUrl: "https://blog.naver.com/",
    youtubeUrl: "https://www.youtube.com/",
    kakaoUrl: "https://pf.kakao.com/_test/chat",
  };

  assert.deepEqual(validateOffice(office), []);
});

test("사무소 외부 링크의 HTTP 주소를 거부한다", () => {
  const office = {
    legalName: "테스트공인중개사사무소",
    brandName: "테스트부동산",
    serviceArea: "대전광역시 동구",
    representative: "홍길동",
    mobile: "010-0000-0000",
    email: "owner@example.com",
    address: "공개 주소",
    registrationNumber: "00000-0000-00000",
    businessNumber: "000-00-00000",
    parking: "주차 가능",
    hours: [{ label: "일요일", days: ["Sunday"], opens: null, closes: null, note: "휴무" }],
    introduction: ["공개 승인된 소개 문안"],
    publicClaims: { basis: "운영자 확인 기준", items: [{ label: "허위매물", value: "0건" }] },
    naverPlaceUrl: "https://map.naver.com/",
    naverBlogUrl: "https://blog.naver.com/",
    youtubeUrl: "https://www.youtube.com/",
    kakaoUrl: "http://pf.kakao.com/_test/chat",
  };

  assert.match(validateOffice(office).join("\n"), /kakaoUrl: HTTPS/);
});

test("주요 단지는 두 개보다 많아도 허용한다", () => {
  const makeComplex = (slug, name, mark) => ({
    slug,
    areaSlug: "cheon-dong",
    areaName: "천동",
    eyebrow: "DAEJEON DONG-GU",
    mark,
    name,
    status: "preparing",
    summary: "공개 준비 중",
    introTitle: `${name} 소개`,
    introduction: ["확인된 내용을 준비하고 있습니다."],
    source: null,
    confirmedAt: null,
  });
  const complexes = [
    makeComplex("leaders-city-4", "리더스시티 4블록", "4"),
    makeComplex("leaders-city-5", "리더스시티 5블록", "5"),
    makeComplex("cheon-dong-example", "천동 주요 단지", "천"),
  ];
  assert.deepEqual(validateComplexes(complexes), []);
});

test("블로그와 유튜브 콘텐츠는 공개 상태와 자체 이미지 경로를 검증한다", () => {
  const links = [{
    id: "blog-post-1",
    type: "blog",
    status: "published",
    title: "대전 동구 소식",
    summary: "공개 승인 요약",
    url: "https://blog.naver.com/p5468300/123",
    publishedAt: "2026-08-25",
    thumbnail: { src: "/images/content/blog-post-1.webp", alt: "블로그 글 썸네일" },
  }];
  assert.deepEqual(validateExternalLinks(links), []);
});

test("홈 대표·사무소·지역 소개 문구와 이미지를 검증한다", () => {
  const homeContent = {
    broker: { eyebrow: "대표", headline: "신뢰", lead: "안내", portrait: { src: "/images/office/representative.webp", alt: "대표" } },
    office: { eyebrow: "사무소", title: "지역 전문", description: "설명", image: { src: "/images/office/storefront.webp", alt: "사무소" }, badges: ["대전 동구"] },
    areaGuide: { eyebrow: "지역", title: "리더스시티", description: "설명", cards: [{ title: "현장", description: "안내" }] },
  };
  assert.deepEqual(validateHomeContent(homeContent), []);
});
