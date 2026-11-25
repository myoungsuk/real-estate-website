import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ADMIN_RESOURCE_PATHS, validateAdminResource } from "../worker/admin-resource-validation.mjs";
import {
  APPROVED_OFFICE_FACTS,
  HOME_CONTENT_MAX_LENGTHS,
  findBannedKeys,
  findSensitiveStrings,
  findUnexpectedKeys,
  validateComplexes,
  validateComplexOverview,
  validateExternalLinks,
  validateFaq,
  validateHomeContent,
  validateListing,
  validateNaverListings,
  validateOffice,
  validateReviews,
  validateApprovedOfficeFacts,
  validateKnownListingTitles,
} from "../scripts/content-validation.mjs";

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

test("공개 스키마에 없는 루트와 중첩 필드를 거부한다", () => {
  assert.match(
    findUnexpectedKeys("faq", [{ category: "매물 확인과 상담", question: "질문", answer: "답변", privateNote: "메모" }]).join("\n"),
    /faq\[0\]\.privateNote/,
  );
  assert.match(
    findUnexpectedKeys("homeContent", {
      broker: { eyebrow: "대표", headline: "제목", lead: "설명", portrait: { src: "/images/a.webp", alt: "사진", token: "x" } },
    }).join("\n"),
    /portrait\.token/,
  );
});

test("전역 민감 문자열 검사는 승인된 사무소 공개값만 예외로 둔다", () => {
  const office = {
    mobile: "010-2790-8675",
    email: "office@example.com",
    address: "대전광역시 동구 근린생활시설 105호",
  };
  assert.deepEqual(findSensitiveStrings({ text: "문의 010-2790-8675 office@example.com 105호" }, { office }), []);

  const errors = findSensitiveStrings({
    phone: "010-1111-2222",
    email: "customer@example.net",
    unit: "1203호",
    token: "github_" + "pat_abcdefghijklmnopqrstuvwxyz123456",
    jwt: "eyJabcdefghijk.abcdefghijk.abcdefghijk",
  }, { office }).join("\n");
  assert.match(errors, /휴대전화번호/);
  assert.match(errors, /이메일/);
  assert.match(errors, /정확한 호수/);
  assert.match(errors, /GitHub 토큰/);
  assert.match(errors, /JWT/);
});

test("미분양 물량의 천 단위 수량은 허용하고 실제 호수와 다른 민감정보는 차단한다", () => {
  for (const text of [
    "대전 미분양 물량 2026년 7월 1,866호｜중구 쏠림이 핵심",
    "미분양 물량 12,345호",
  ]) {
    assert.deepEqual(findSensitiveStrings({ text }), [], text);
  }
  for (const text of [
    "1203호", "101동 1203호", "1,203호", "101동 1,203호",
    "미분양 물량 1,866호, 매물 1203호", "미분양 물량 101동 1,203호",
    "미분양 물량 1203호", "미분양 물량 1,23호", "미분양 물량 2026년 7월 1,866호실",
  ]) {
    assert.match(findSensitiveStrings({ text }).join("\n"), /정확한 호수/u, text);
  }
  assert.match(findSensitiveStrings({ text: "미분양 물량 1,866호 문의 010-1111-2222" }).join("\n"), /휴대전화번호/u);
  assert.match(findSensitiveStrings({ text: "미분양 물량 1,866호 문의 customer@example.net" }).join("\n"), /이메일/u);
  assert.deepEqual(findSensitiveStrings({ text: "1호선 2호점 3호기 4호차" }), []);
});

test("공개 날짜는 실제 달력 날짜이며 오늘보다 늦을 수 없다", () => {
  assert.match(validateListing({ ...base, confirmedAt: "2026-02-30" }).join("\n"), /confirmedAt/);
  assert.match(validateListing({ ...base, publishedAt: "2999-01-01" }).join("\n"), /publishedAt/);

  const naver = {
    checkedAt: "2999-01-01",
    items: [{
      id: "2645736151",
      title: "휴먼시아2단지 202동",
      propertyType: "아파트",
      tradeType: "sale",
      priceLabel: "2억 6,000",
      areaLabel: "111B㎡",
      floorLabel: "2/22층",
      direction: "남향",
      summary: "네이버 공개 설명",
      registeredAt: "2026-02-30",
      source: "네이버페이 부동산",
      url: "https://fin.land.naver.com/articles/2645736151",
    }],
  };
  const naverErrors = validateNaverListings(naver).join("\n");
  assert.match(naverErrors, /checkedAt/);
  assert.match(naverErrors, /registeredAt/);

  const reviewErrors = validateReviews([{
    id: "approved-review",
    displayName: "입주민",
    content: "공개 동의를 받은 후기",
    confirmedAt: "2026-08-26",
    source: "운영자 확인",
    isPublished: true,
    privacyReviewed: true,
    privacyReviewedAt: "2999-01-01",
  }]).join("\n");
  assert.match(reviewErrors, /privacyReviewedAt/);
});

test("FAQ는 허용 카테고리와 질문·답변을 요구하고 중복 질문을 거부한다", () => {
  const valid = [{ category: "매물 확인과 상담", question: "방문 예약이 필요한가요?", answer: "사전 예약을 권합니다." }];
  assert.deepEqual(validateFaq(valid), []);
  const errors = validateFaq([
    ...valid,
    { category: "임의 분류", question: "방문 예약이 필요한가요?", answer: "" },
  ]).join("\n");
  assert.match(errors, /category/);
  assert.match(errors, /중복 질문/);
  assert.match(errors, /answer/);
});

test("대전 동구의 다른 동네 매물도 허용한다", () => {
  const listing = { ...base, id: "yongun-dong-sale-001", slug: "yongun-dong-sale-001", neighborhoodSlug: "yongun-dong", neighborhoodName: "용운동", complexName: null };
  assert.deepEqual(validateListing(listing), []);
});

test("대전 동구 밖의 매물은 거부한다", () => {
  assert.match(validateListing({ ...base, district: "대전 중구" }).join("\n"), /대전 동구/);
});

test("네이버에 공개된 동 번호와 광고 층수를 허용한다", () => {
  const data = {
    checkedAt: "2026-08-25",
    items: [{
      id: "2645736151",
      title: "휴먼시아2단지 202동",
      propertyType: "아파트",
      tradeType: "sale",
      priceLabel: "2억 6,000",
      areaLabel: "111B㎡ · 전용 84.77B㎡",
      floorLabel: "2/22층",
      direction: "남향",
      summary: "네이버 공개 설명",
      registeredAt: "2026-08-25",
      source: "네이버페이 부동산",
      url: "https://fin.land.naver.com/articles/2645736151",
    }],
  };

  assert.deepEqual(validateNaverListings(data), []);
});

test("네이버 매물번호와 연결되지 않는 주소와 중복 ID를 거부한다", () => {
  const item = {
    id: "2645736151",
    title: "휴먼시아2단지 202동",
    propertyType: "아파트",
    tradeType: "sale",
    priceLabel: "2억 6,000",
    areaLabel: "111B㎡",
    floorLabel: "2/22층",
    direction: "남향",
    summary: "네이버 공개 설명",
    registeredAt: "2026-08-25",
    source: "네이버페이 부동산",
    url: "https://example.com/articles/2645736151",
  };
  const errors = validateNaverListings({ checkedAt: "2026-08-25", items: [item, item] }).join("\n");

  assert.match(errors, /네이버 매물번호/);
  assert.match(errors, /중복 ID/);
});

test("네이버 공개 매물의 개인정보와 허용되지 않은 필드를 거부한다", () => {
  const item = {
    id: "2645736151",
    title: "휴먼시아2단지 202동",
    propertyType: "아파트",
    tradeType: "sale",
    priceLabel: "2억 6,000",
    areaLabel: "111B㎡",
    floorLabel: "2/22층",
    direction: "남향",
    summary: "문의 010-1111-2222, 1203호",
    registeredAt: "2026-08-25",
    source: "네이버페이 부동산",
    url: "https://fin.land.naver.com/articles/2645736151",
    bankListingId: "143000000",
  };
  const errors = validateNaverListings({ checkedAt: "2026-08-25", items: [item] }).join("\n");
  assert.match(errors, /허용되지 않은 필드/);
  assert.match(errors, /전화번호/);
  assert.match(errors, /정확한 호수/);
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
    naverListingsUrl: "https://fin.land.naver.com/map",
    naverBlogUrl: "https://blog.naver.com/",
    youtubeUrl: "https://www.youtube.com/",
    instagramUrl: "https://www.instagram.com/test/",
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
    naverListingsUrl: "https://fin.land.naver.com/map",
    naverBlogUrl: "https://blog.naver.com/",
    youtubeUrl: "https://www.youtube.com/",
    instagramUrl: "https://www.instagram.com/test/",
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
    aliases: [],
    seo: { title: `${name} 검색 제목`, description: `${name} 검색 설명` },
    unitDataNote: null,
    status: "preparing",
    summary: "공개 준비 중",
    introTitle: `${name} 소개`,
    introduction: ["확인된 내용을 준비하고 있습니다."],
    image: null,
    facts: [],
    highlights: [],
    unitGroups: [],
    supplySummary: [],
    livingSections: [],
    amenityGroups: [],
    checkpoints: [],
    faqs: [],
    relatedContentIds: [],
    sources: [],
    confirmedAt: null,
  });
  const complexes = [
    makeComplex("leaders-city-4", "리더스시티 4블록", "4"),
    makeComplex("leaders-city-5", "리더스시티 5블록", "5"),
    makeComplex("cheon-dong-example", "천동 주요 단지", "천"),
  ];
  assert.deepEqual(validateComplexes(complexes), []);
});

test("공개 단지는 사진·사실·특징·출처·확인일을 모두 요구한다", () => {
  const errors = validateComplexes([{
    slug: "leaders-city-5",
    areaSlug: "cheon-dong",
    areaName: "천동",
    eyebrow: "LEADERS CITY",
    mark: "5",
    name: "리더스시티 5블록",
    status: "published",
    summary: "공개 단지",
    introTitle: "리더스시티 5블록 소개",
    introduction: ["공개 소개 문단"],
    image: null,
    facts: [],
    highlights: [],
    sources: [],
    confirmedAt: null,
  }]).join("\n");

  assert.match(errors, /image/);
  assert.match(errors, /facts/);
  assert.match(errors, /highlights/);
  assert.match(errors, /sources/);
  assert.match(errors, /confirmedAt/);
});

test("리더스시티 면적별 세대수 합계와 공개 관련 콘텐츠를 검증한다", async () => {
  const [complexes, overview, externalLinks] = await Promise.all([
    readFile(new URL("../src/data/complexes.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/data/complexes-overview.json", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../src/data/external-links.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

  assert.deepEqual(validateComplexes(complexes, externalLinks), []);
  assert.deepEqual(validateComplexOverview(overview, complexes, externalLinks), []);

  const wrongTotal = structuredClone(complexes);
  wrongTotal[0].unitGroups[0].households += 1;
  assert.match(validateComplexes(wrongTotal, externalLinks).join("\n"), /1,328/);

  const missingContent = structuredClone(overview);
  missingContent.relatedContentIds.push("missing-content");
  assert.match(validateComplexOverview(missingContent, complexes, externalLinks).join("\n"), /없는 ID/);

  const unexpectedComparison = structuredClone(overview);
  unexpectedComparison.comparisonRows[0].values["unknown-complex"] = "임의 값";
  assert.match(validateComplexOverview(unexpectedComparison, complexes, externalLinks).join("\n"), /등록된 단지 slug/);
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
  }, {
    id: "youtube-short-1",
    type: "youtube",
    youtubeFormat: "short",
    status: "published",
    title: "대전 동구 Shorts",
    summary: "공개 승인 요약",
    url: "https://www.youtube.com/watch?v=I05mw0iCFnM",
    publishedAt: "2026-08-25",
    thumbnail: null,
  }];
  assert.deepEqual(validateExternalLinks(links), []);
  assert.match(validateExternalLinks([{ ...links[1], youtubeFormat: "clip" }]).join("\n"), /video 또는 short/);
  assert.match(validateExternalLinks([{ ...links[0], youtubeFormat: "video" }]).join("\n"), /블로그 콘텐츠/);
});

test("글 앞부분 요약·분류 칸은 블로그 글에만 두고 형식을 검증한다", () => {
  const blog = {
    id: "naver-blog-224999999999",
    type: "blog",
    status: "published",
    title: "임대차 계약 신고 정리",
    summary: "공개 승인 요약",
    excerpt: "전세나 월세 계약을 마친 뒤에도 꼭 확인해야 하는 절차가 있습니다…",
    category: "아파트/분양권",
    url: "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224999999999",
    publishedAt: "2026-08-26",
    thumbnail: null,
  };
  const { excerpt, category, ...plain } = blog;
  const youtube = { ...plain, id: "youtube-short-1", type: "youtube", youtubeFormat: "short", url: "https://www.youtube.com/watch?v=I05mw0iCFnM" };
  const instagram = { ...plain, id: "instagram-2026-08-26", type: "instagram", url: "https://www.instagram.com/p/ABCdef_12-3/", thumbnail: { src: "/images/content/instagram/a.webp", alt: "사진" } };
  for (const links of [[blog], [plain], [{ ...plain, excerpt }], [{ ...plain, category }], [youtube], [instagram]]) {
    assert.deepEqual(validateExternalLinks(links), []);
    assert.deepEqual(findUnexpectedKeys("externalLinks", links), []);
    assert.deepEqual(validateAdminResource("external-links", links), []);
  }

  for (const other of [youtube, instagram]) {
    const errors = validateExternalLinks([{ ...other, excerpt, category }]).join("\n");
    assert.match(errors, /externalLinks\[0\]\.excerpt: 블로그 콘텐츠에만 사용할 수 있습니다/u, other.type);
    assert.match(errors, /externalLinks\[0\]\.category: 블로그 콘텐츠에만 사용할 수 있습니다/u, other.type);
    assert.match(validateAdminResource("external-links", [{ ...other, category }]).join("\n"), /category: 블로그 콘텐츠에만/u, `${other.type}: 관리자 저장도 막음`);
  }

  for (const [value, pattern] of [
    ["", /excerpt: 1 ~ 300자/u],
    ["가".repeat(301), /excerpt: 1 ~ 300자/u],
    ["첫 줄\n둘째 줄", /excerpt: 줄바꿈/u],
    [" 앞 공백", /excerpt: 앞뒤 공백/u],
    ["뒤 공백 ", /excerpt: 앞뒤 공백/u],
    ["<b>굵게</b>", /excerpt: HTML 태그/u],
    ["&quot;따옴표&quot;", /excerpt: HTML 엔티티/u],
    [null, /excerpt: 문자열/u],
    [["글"], /excerpt: 문자열/u],
  ]) {
    assert.match(validateExternalLinks([{ ...blog, excerpt: value }]).join("\n"), pattern, JSON.stringify(value));
  }
  assert.deepEqual(validateExternalLinks([{ ...blog, excerpt: "가".repeat(300) }]), []);
  for (const [value, pattern] of [
    ["", /category: 1 ~ 30자/u],
    ["가".repeat(31), /category: 1 ~ 30자/u],
    ["분류\n둘", /category: 줄바꿈/u],
    ["<i>분류</i>", /category: HTML 태그/u],
    [7, /category: 문자열/u],
  ]) {
    assert.match(validateExternalLinks([{ ...blog, category: value }]).join("\n"), pattern, JSON.stringify(value));
  }

  // 태그 칸은 두지 않는다(쓸 화면이 없음). 새 칸에도 민감 문자열 검사는 그대로 걸린다.
  assert.match(findUnexpectedKeys("externalLinks", [{ ...blog, tags: ["대전"] }]).join("\n"), /externalLinks\[0\]\.tags: 허용되지 않은 필드/u);
  assert.match(validateAdminResource("external-links", [{ ...blog, tags: ["대전"] }]).join("\n"), /tags: 허용되지 않은 필드/u);
  for (const text of ["문의 010-1111-2222", "이번 집은 1203호입니다", "someone@example.com 으로 주세요"]) {
    assert.match(findSensitiveStrings([{ ...blog, excerpt: text }], { path: "externalLinks" }).join("\n"), /externalLinks\[0\]\.excerpt/u, text);
    assert.notDeepEqual(validateAdminResource("external-links", [{ ...blog, excerpt: text }]), [], text);
  }
});

test("인스타그램 콘텐츠는 게시물 주소(/p/·/reel/)·썸네일 필수·youtubeFormat 금지를 검증한다", async () => {
  const post = {
    id: "instagram-2026-11-19",
    type: "instagram",
    status: "published",
    title: "리더스시티 산책길",
    summary: "공개 승인 요약",
    url: "https://www.instagram.com/p/ABCdef_12-3/",
    publishedAt: "2026-11-19",
    thumbnail: { src: "/images/content/instagram/admin-upload.webp", alt: "리더스시티 산책길 사진" },
  };
  assert.deepEqual(validateExternalLinks([post]), []);
  for (const url of ["https://instagram.com/p/ABCdef/", "https://www.instagram.com/reel/ABCdef", "https://www.instagram.com/reel/ABCdef/"]) {
    assert.deepEqual(validateExternalLinks([{ ...post, url }]), [], url);
  }
  for (const url of [
    "http://www.instagram.com/p/ABCdef/",
    "https://www.instagram.com/readers.45_real.estate/",
    "https://www.instagram.com/p/ABCdef/?igsh=abc123",
    "https://www.instagram.com/p/ABCdef/#comments",
    "https://www.instagram.com/p/ABCdef/?",
    "https://www.instagram.com.example.com/p/ABCdef/",
    "https://m.instagram.com/p/ABCdef/",
    "https://www.instagram.com:8443/p/ABCdef/",
    "https://user@www.instagram.com/p/ABCdef/",
    "https://www.instagram.com/stories/readers/123/",
    "https://www.instagram.com/p/ABCdef/extra/",
    "https://www.instagram.com/p/",
    "https://blog.naver.com/p5468300/123",
  ]) {
    assert.match(validateExternalLinks([{ ...post, url }]).join("\n"), /url: 인스타그램 게시물 주소/u, url);
  }
  assert.match(validateExternalLinks([{ ...post, thumbnail: null }]).join("\n"), /thumbnail: 공개 이미지가 필요합니다/u, "사진이 카드 본문이라 썸네일 필수");
  assert.match(validateExternalLinks([{ ...post, thumbnail: { src: "https://scontent.cdninstagram.com/a.jpg", alt: "사진" } }]).join("\n"), /thumbnail\.src: \/images\//u, "인스타그램 서버 사진 주소를 그대로 쓰지 않음");
  assert.match(validateExternalLinks([{ ...post, youtubeFormat: "video" }]).join("\n"), /youtubeFormat: 인스타그램 콘텐츠에는 사용할 수 없습니다/u);
  assert.match(validateExternalLinks([{ ...post, type: "tiktok" }]).join("\n"), /type: blog·youtube·instagram만 허용합니다/u);
  assert.match(validateExternalLinks([{ ...post, type: "blog" }]).join("\n"), /네이버 블로그 주소만 허용합니다/u, "인스타그램 주소를 블로그 종류로 넣으면 막음");
  assert.deepEqual(
    validateExternalLinks([{ ...post, type: "youtube", youtubeFormat: "video", url: "https://www.youtube.com/watch?v=I05mw0iCFnM", thumbnail: null }]),
    [],
    "블로그·유튜브는 지금처럼 썸네일 없이도 저장",
  );
  // 금지 필드·민감 문자열·스키마 밖 필드 검사는 인스타그램 항목에도 그대로 걸린다(관리자 저장 경로 포함).
  assert.match(findUnexpectedKeys("externalLinks", [{ ...post, ownerHandle: "someone" }]).join("\n"), /externalLinks\[0\]\.ownerHandle/u);
  assert.match(findBannedKeys([{ ...post, clientPhone: "010" }]).join("\n"), /clientPhone/u);
  assert.match(findSensitiveStrings([{ ...post, summary: "문의 010-1111-2222" }], { office: { mobile: "010-2790-8675", email: "office@example.com", address: "105호" } }).join("\n"), /휴대전화번호/u);
  assert.match(validateAdminResource("external-links", [{ ...post, url: "https://www.instagram.com/p/ABCdef/?igsh=abc123" }]).join("\n"), /인스타그램 게시물 주소/u, "관리자 저장 전 검증");
  assert.match(validateAdminResource("external-links", [{ ...post, url: "https://www.instagram.com/p/ABCdef/?igsh=abc123" }], await currentAdminResources()).join("\n"), /인스타그램 게시물 주소/u, "다른 자료와 함께 보는 저장 경로");
});

test("홈 대표·사무소·지역 소개 문구와 이미지를 검증한다", () => {
  const homeContent = {
    broker: { eyebrow: "대표", headline: "신뢰", lead: "안내", portrait: { src: "/images/office/representative.webp", alt: "대표" } },
    office: { eyebrow: "사무소", title: "지역 전문", description: "설명", image: { src: "/images/office/storefront.webp", alt: "사무소" }, badges: ["대전 동구"] },
    areaGuide: { eyebrow: "지역", title: "리더스시티", description: "설명", cards: [{ title: "현장", description: "안내" }] },
  };
  assert.deepEqual(validateHomeContent(homeContent), []);
});

// ---- 2026-11-17 콘텐츠 검사 보강(사용자 승인 17:53:04): 홈 문구 최대 글자 수, 확정 공개 정보 9가지, 매물 단지 표기 6가지 ----
const readRepoJson = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then(JSON.parse);

async function currentAdminResources() {
  const entries = await Promise.all(Object.entries(ADMIN_RESOURCE_PATHS).map(async ([resource, path]) => [resource, await readRepoJson(path)]));
  return Object.fromEntries(entries);
}

test("홈 문구 칸별 최대 글자 수: 지금 자료와 최대 글자는 통과하고, 한 글자 넘으면 칸 이름·최대 글자 수로 막는다(관리자 저장 두 경로 모두)", async () => {
  const homeContent = await readRepoJson("src/data/home-content.json");
  assert.deepEqual(validateHomeContent(homeContent), []);
  assert.equal(HOME_CONTENT_MAX_LENGTHS["broker.headline"], 50, "사진 위 대표 문장(날개-4 배치 확인)");
  assert.equal(HOME_CONTENT_MAX_LENGTHS["broker.eyebrow"], 30);
  const set = (path, value) => {
    const copy = structuredClone(homeContent);
    const keys = path.split(".");
    keys.slice(0, -1).reduce((node, key) => node[key], copy)[keys.at(-1)] = value;
    return copy;
  };
  const cases = [
    ["broker.eyebrow", "broker.eyebrow"], ["broker.headline", "broker.headline"], ["broker.lead", "broker.lead"],
    ["office.eyebrow", "office.eyebrow"], ["office.title", "office.title"], ["office.description", "office.description"],
    ["areaGuide.eyebrow", "areaGuide.eyebrow"], ["areaGuide.title", "areaGuide.title"], ["areaGuide.description", "areaGuide.description"],
    ["broker.portrait.alt", "imageAlt"], ["office.image.alt", "imageAlt"],
    ["office.badges.0", "badge"], ["areaGuide.cards.0.title", "cardTitle"], ["areaGuide.cards.0.description", "cardDescription"],
  ];
  for (const [path, limitKey] of cases) {
    const max = HOME_CONTENT_MAX_LENGTHS[limitKey];
    assert.ok(Number.isInteger(max), path);
    assert.deepEqual(validateHomeContent(set(path, "가".repeat(max))), [], `${path} ${max}자는 통과`);
    const errors = validateHomeContent(set(path, "가".repeat(max + 1)));
    assert.equal(errors.length, 1, path);
    assert.match(errors[0], new RegExp(`최대 ${max}자`, "u"), path);
  }
  const over = set("broker.headline", "가".repeat(51));
  assert.match(validateAdminResource("home-content", over).join("\n"), /broker\.headline: 최대 50자/u, "한 종류만 보는 저장 경로");
  assert.match(validateAdminResource("home-content", over, await currentAdminResources()).join("\n"), /broker\.headline: 최대 50자/u, "다른 자료와 함께 보는 저장 경로");
  const page = await readFile(new URL("../src/pages/admin/content/index.astro", import.meta.url), "utf8");
  assert.match(page, /HOME_CONTENT_MAX_LENGTHS as MAX/u, "관리자 입력 칸도 같은 값을 씀");
  assert.equal((page.match(/maxlength=\{MAX/gu) ?? []).length, 13);
});

test("확정 공개 정보 9가지는 승인값과 같아야 저장되고, 영업시간·주차·소개·링크는 바꿀 수 있다", async () => {
  const office = await readRepoJson("src/data/office.json");
  assert.deepEqual(Object.keys(APPROVED_OFFICE_FACTS), ["legalName", "brandName", "representative", "mobile", "email", "address", "registrationNumber", "businessNumber", "kakaoUrl"]);
  assert.deepEqual(validateApprovedOfficeFacts(office), []);
  const guide = await readFile(new URL("../CLAUDE.md", import.meta.url), "utf8");
  for (const value of Object.values(APPROVED_OFFICE_FACTS)) {
    assert.ok(guide.includes(value), "CLAUDE.md 확정 공개 정보 표와 같은 값(바꿀 때 함께 고침)");
  }
  for (const key of ["mobile", "kakaoUrl", "representative", "address"]) {
    const changed = { ...office, [key]: `${office[key]}0` };
    assert.deepEqual(validateApprovedOfficeFacts(changed), [`office.${key}: 확정 공개 정보와 다릅니다. 바꾸려면 개발 PR로 승인값을 함께 고쳐야 합니다.`]);
  }
  const editable = {
    ...office,
    parking: "가상 주차 안내",
    introduction: ["가상 소개 문장"],
    hours: office.hours.map((hour) => ({ ...hour, note: "가상 메모" })),
    naverBlogUrl: "https://blog.naver.com/example",
    youtubeUrl: "https://www.youtube.com/@example",
    instagramUrl: "https://www.instagram.com/example/",
  };
  assert.deepEqual(validateApprovedOfficeFacts(editable), [], "고정하지 않는 칸");
  const forged = { ...office, mobile: "010-0000-0000" };
  assert.match(validateAdminResource("office", forged).join("\n"), /office\.mobile: 확정 공개 정보와 다릅니다/u, "한 종류만 보는 저장 경로");
  assert.match(validateAdminResource("office", forged, await currentAdminResources()).join("\n"), /office\.mobile: 확정 공개 정보와 다릅니다/u, "다른 자료와 함께 보는 저장 경로");
  assert.deepEqual(validateOffice({ ...office, mobile: "010-0000-0000" }).filter((error) => error.includes("확정 공개 정보")), [], "형식 검사(validateOffice)에는 걸지 않음");
});

test("사무소 인스타그램 주소는 https://www.instagram.com/ 아래 HTTPS 주소만 허용한다", async () => {
  const office = await readRepoJson("src/data/office.json");
  assert.equal(office.instagramUrl, "https://www.instagram.com/readers.45_real.estate/");
  assert.deepEqual(validateOffice(office), []);
  for (const instagramUrl of ["https://instagram.com/readers.45_real.estate/", "https://www.instagram.com.example.com/readers.45_real.estate/", "https://www.instagram.com:8443/readers.45_real.estate/"]) {
    assert.match(validateOffice({ ...office, instagramUrl }).join("\n"), /office\.instagramUrl: https:\/\/www\.instagram\.com\/ 아래 주소만 허용합니다/u, instagramUrl);
  }
  assert.match(validateOffice({ ...office, instagramUrl: "http://www.instagram.com/readers.45_real.estate/" }).join("\n"), /office\.instagramUrl: HTTPS만 허용합니다/u);
  const withoutInstagram = { ...office };
  delete withoutInstagram.instagramUrl;
  assert.match(validateOffice(withoutInstagram).join("\n"), /office\.instagramUrl: 올바른 공개 URL이 필요합니다/u, "빠지면 머리 메뉴 링크가 비므로 막음");
});

test("매물 단지 표기 6가지: 단지 이름만 바꾸면 저장을 막고, 옛 이름을 별칭에 넣으면 통과하며, 단지를 지우거나 준비 중으로 돌리는 것은 막지 않는다", async () => {
  const complexes = await readRepoJson("src/data/complexes.json");
  assert.deepEqual(validateKnownListingTitles(complexes), []);
  const renamed = structuredClone(complexes);
  renamed.find((complex) => complex.slug === "leaders-city-4").name = "천동 리더스시티 4블록";
  assert.deepEqual(validateKnownListingTitles(renamed), [
    'complexes.leaders-city-4: 매물 표기 "리더스시티 4블록"이(가) 이 단지에 연결되지 않습니다. 옛 이름을 별칭에 넣어 주세요.',
    'complexes.leaders-city-4: 매물 표기 "리더스시티4블록 401동"이(가) 이 단지에 연결되지 않습니다. 옛 이름을 별칭에 넣어 주세요.',
  ]);
  assert.match(validateAdminResource("complexes", renamed).join("\n"), /매물 표기 "리더스시티 4블록"/u, "한 종류만 보는 저장 경로");
  assert.match(validateAdminResource("complexes", renamed, await currentAdminResources()).join("\n"), /매물 표기 "리더스시티 4블록"/u, "다른 자료와 함께 보는 저장 경로");
  const withAlias = structuredClone(renamed);
  withAlias.find((complex) => complex.slug === "leaders-city-4").aliases.push("리더스시티 4블록");
  assert.deepEqual(validateKnownListingTitles(withAlias), []);
  const preparing = structuredClone(complexes);
  preparing.find((complex) => complex.slug === "sinheung-sk-view").status = "preparing";
  assert.deepEqual(validateKnownListingTitles(preparing), []);
  assert.deepEqual(validateKnownListingTitles(complexes.filter((complex) => complex.slug !== "sinheung-sk-view")), [], "단지를 지우면 그 단지 표기는 보지 않음");
  assert.deepEqual(validateKnownListingTitles(null), []);
});
