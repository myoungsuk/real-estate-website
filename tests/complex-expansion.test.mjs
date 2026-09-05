import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatComplexComparisonRows,
  parseComplexComparisonRows,
  parseComplexSlugLines,
} from "../src/lib/admin-complexes.mjs";
import {
  getComplexMatchCandidates,
  matchComplexByListingTitle,
  normalizeComplexText,
} from "../src/lib/complex-matching.mjs";
import {
  createComplexListingPreview,
  selectComplexListings,
} from "../src/lib/complex-listings.mjs";
import {
  findUnexpectedKeys,
  validateComplexes,
  validateComplexOverview,
} from "../scripts/content-validation.mjs";

const readJson = (relativePath) => readFile(new URL(relativePath, import.meta.url), "utf8").then(JSON.parse);

test("단지명은 공백·대소문자·구분기호를 정규화해 접두어로 매칭한다", () => {
  const complexes = [
    { slug: "leaders-city", name: "리더스시티", aliases: [] },
    { slug: "leaders-city-5", name: "리더스시티 5블록", aliases: [] },
    { slug: "sinheung-sk-view", name: "신흥 SK뷰", aliases: ["신흥에스케이뷰"] },
  ];

  assert.equal(normalizeComplexText(" 신흥-SK VIEW "), "신흥skview");
  assert.equal(normalizeComplexText("신흥_(SK)뷰"), "신흥sk뷰");
  assert.deepEqual(getComplexMatchCandidates(complexes[2]), ["신흥에스케이뷰", "신흥sk뷰"]);
  assert.equal(matchComplexByListingTitle("신흥SK뷰 101동", complexes)?.slug, "sinheung-sk-view");
  assert.equal(matchComplexByListingTitle("신흥에스케이뷰 매매", complexes)?.slug, "sinheung-sk-view");
  assert.equal(matchComplexByListingTitle("리더스시티5블록 501동", complexes)?.slug, "leaders-city-5");
  assert.equal(matchComplexByListingTitle("알 수 없는 단지", complexes), undefined);
  assert.equal(matchComplexByListingTitle("", complexes), undefined);
});

test("같은 길이의 복수 단지 후보가 일치하면 오탐하지 않는다", () => {
  const complexes = [
    { slug: "first", name: "같은 단지", aliases: [] },
    { slug: "second", name: "같은단지", aliases: [] },
  ];
  assert.equal(matchComplexByListingTitle("같은단지 101동", complexes), undefined);
});

test("관리자 비교표는 선택한 slug 순서로 직렬화하고 열 수 불일치를 거부한다", () => {
  const slugs = parseComplexSlugLines("leaders-city-4\nleaders-city-5\n");
  const rows = [{ label: "세대수", values: { "leaders-city-4": "1,328세대", "leaders-city-5": "2,135세대" } }];
  const text = formatComplexComparisonRows(rows, slugs);
  assert.equal(text, "세대수 | 1,328세대 | 2,135세대");
  assert.deepEqual(parseComplexComparisonRows(text, slugs), rows);
  assert.throws(() => parseComplexComparisonRows("세대수 | 1,328세대", slugs), /비교 대상 2개/);
});

test("신흥 SK뷰 공개 데이터는 사진·공식 수치·strict schema Gate를 통과한다", async () => {
  const [complexes, overview, externalLinks] = await Promise.all([
    readJson("../src/data/complexes.json"),
    readJson("../src/data/complexes-overview.json"),
    readJson("../src/data/external-links.json"),
  ]);

  assert.equal(complexes.find((complex) => complex.slug === "sinheung-sk-view")?.status, "published");
  assert.deepEqual(overview.featuredComplexSlugs, ["leaders-city-4", "leaders-city-5", "sinheung-sk-view"]);
  assert.deepEqual(overview.comparisonComplexSlugs, ["leaders-city-4", "leaders-city-5"]);
  assert.deepEqual(validateComplexes(complexes, externalLinks), []);
  assert.deepEqual(validateComplexOverview(overview, complexes, externalLinks), []);
  assert.deepEqual(findUnexpectedKeys("complexes", complexes), []);
  assert.deepEqual(findUnexpectedKeys("complexOverview", overview), []);

  const publishedOnly = complexes.filter((complex) => complex.status === "published");
  for (const complex of publishedOnly) {
    assert.ok(complex.seo.title.length > 0 && complex.seo.title.length <= 70);
    assert.ok(complex.seo.description.length > 0 && complex.seo.description.length <= 180);
  }
  assert.equal(matchComplexByListingTitle("신흥SK뷰", publishedOnly)?.slug, "sinheung-sk-view");
  assert.equal(matchComplexByListingTitle("신흥SK뷰", complexes)?.slug, "sinheung-sk-view");

  const sinheung = complexes.find((complex) => complex.slug === "sinheung-sk-view");
  assert.deepEqual(sinheung.image, {
    src: "/images/area/sinheung-sk-view.webp",
    alt: "대전 동구 신흥 SK뷰 야간 출입구와 아파트 전경",
  });
  assert.deepEqual(sinheung.facts, [
    { label: "주소", value: "대전광역시 동구 충무로 255" },
    { label: "지번", value: "대전광역시 동구 신흥동 161-33" },
    { label: "사업 맥락", value: "신흥3구역 재개발정비사업" },
    { label: "규모", value: "12개동 · 1,588세대" },
    { label: "사용승인", value: "2022년 4월 28일" },
    { label: "공급 구성", value: "분양 1,499세대 · 임대 89세대" },
    { label: "전용면적 구간", value: "60㎡ 이하 897세대 · 60㎡ 초과~85㎡ 이하 691세대" },
    { label: "난방", value: "개별난방" },
    { label: "주차", value: "지상 0대 · 지하 1,957대" },
    { label: "승강기", value: "34대" },
  ]);
  assert.deepEqual(sinheung.unitGroups, [
    { category: "전체", areaLabel: "60㎡ 이하", households: 897, note: "K-apt 전용면적 구간 집계" },
    { category: "전체", areaLabel: "60㎡ 초과~85㎡ 이하", households: 691, note: "K-apt 전용면적 구간 집계" },
  ]);
  assert.equal(sinheung.unitGroups.reduce((sum, unit) => sum + unit.households, 0), 1588);
  assert.equal(sinheung.amenityGroups[0].verification, "official");
  assert.equal(sinheung.supplySummary.reduce((sum, item) => sum + Number(item.value.replace(/\D/gu, "")), 0), 1588);
  assert.deepEqual(sinheung.livingSections.map((section) => section.title), [
    "12개동 · 1,588세대",
    "2022년 4월 28일",
    "지하 1,957대",
    "전 세대 85㎡ 이하 구간",
  ]);
  assert.deepEqual(sinheung.relatedContentIds, [
    "youtube-hhmqrk5ih60",
    "naver-blog-224218400489",
    "youtube-3pccpq6ya0u",
  ]);
  assert.deepEqual(sinheung.sources.map((source) => source.id), [
    "kapt-sinheung-sk-view-basic",
    "kapt-sinheung-sk-view-management",
    "donggu-sinheung-3-status",
    "daejeon-2022-housing-move-in-plan",
  ]);

  const publicationCandidate = structuredClone(complexes);
  const candidate = publicationCandidate.find((complex) => complex.slug === "sinheung-sk-view");
  candidate.status = "published";
  candidate.image = { src: "/images/area/sinheung-sk-view.webp", alt: "대전 동구 신흥 SK뷰 야간 출입구와 아파트 전경" };
  assert.deepEqual(validateComplexes(publicationCandidate, externalLinks), []);
});

test("고정 매물 fixture로 단지 연결과 매물 추가·삭제·빈 배열·3건 미리보기를 검증한다", async () => {
  const [complexes, detailTemplate] = await Promise.all([
    readJson("../src/data/complexes.json"),
    readFile(new URL("../src/pages/complexes/[slug].astro", import.meta.url), "utf8"),
  ]);
  const matcher = (title) => matchComplexByListingTitle(title, complexes);
  const listings = [
    { id: "leaders-4", title: "리더스시티 4블록 401동" },
    { id: "leaders-5", title: "리더스시티5블록 501동" },
    { id: "sinheung-1", title: "신흥SK뷰" },
    { id: "sinheung-2", title: "신흥에스케이뷰 101동" },
    { id: "unmatched", title: "다른 단지" },
  ];
  const selectedIds = (items, slug) => selectComplexListings(items, slug, matcher).map((listing) => listing.id);

  assert.deepEqual(selectedIds(listings, "leaders-city-4"), ["leaders-4"]);
  assert.deepEqual(selectedIds(listings, "leaders-city-5"), ["leaders-5"]);
  assert.deepEqual(selectedIds(listings, "sinheung-sk-view"), ["sinheung-1", "sinheung-2"]);
  assert.deepEqual(selectedIds(listings.filter((listing) => listing.id !== "leaders-4"), "leaders-city-4"), []);
  assert.deepEqual(selectedIds(listings.filter((listing) => listing.id !== "sinheung-1"), "sinheung-sk-view"), ["sinheung-2"]);
  assert.deepEqual(selectedIds([...listings, { id: "sinheung-3", title: "신흥 SK뷰 102동" }], "sinheung-sk-view"), ["sinheung-1", "sinheung-2", "sinheung-3"]);
  assert.deepEqual(selectedIds([], "sinheung-sk-view"), []);
  assert.deepEqual(createComplexListingPreview([], 3), { items: [], total: 0, hasMore: false });
  assert.deepEqual(createComplexListingPreview([1, 2, 3, 4], 3), { items: [1, 2, 3], total: 4, hasMore: true });
  assert.match(detailTemplate, /현재 공개 목록에 \{complex\.name\} 매물이 없습니다/);
  assert.match(detailTemplate, /selectComplexListings\(naverListings, complex\.slug, matchPublishedComplexByListingTitle\)/);
  assert.match(detailTemplate, /sinheung-sk-view-community-center\.webp/);
  assert.match(detailTemplate, /sinheung-sk-view-rest-garden\.webp/);
  assert.match(detailTemplate, /sinheung-sk-view-playground\.webp/);
  assert.match(detailTemplate, /단지시설 직접 촬영 사진/);
  assert.match(detailTemplate, /loading="lazy"/);
});

test("현재 운영 매물의 알려진 단지명은 매물 건수와 무관하게 연결된다", async () => {
  const [complexes, listingData] = await Promise.all([
    readJson("../src/data/complexes.json"),
    readJson("../src/data/naver-listings.json"),
  ]);
  const unmatchedKnownTitles = listingData.items
    .filter((listing) => /리더스시티|신흥.*뷰/iu.test(listing.title) && !matchComplexByListingTitle(listing.title, complexes))
    .map((listing) => listing.title);
  assert.deepEqual(unmatchedKnownTitles, []);
});

test("alias 충돌·공개 SEO 누락·비교 범위 오염을 검증 단계에서 차단한다", async () => {
  const [complexes, overview, externalLinks] = await Promise.all([
    readJson("../src/data/complexes.json"),
    readJson("../src/data/complexes-overview.json"),
    readJson("../src/data/external-links.json"),
  ]);

  const aliasConflict = structuredClone(complexes);
  aliasConflict[2].aliases.push("리더스시티 4블록");
  assert.match(validateComplexes(aliasConflict, externalLinks).join("\n"), /정규화 매칭 이름이 충돌/);

  const shortAlias = structuredClone(complexes);
  shortAlias[2].aliases.push("신");
  assert.match(validateComplexes(shortAlias, externalLinks).join("\n"), /두 글자 이상/);

  const missingSeo = structuredClone(complexes);
  missingSeo[0].seo.title = "";
  assert.match(validateComplexes(missingSeo, externalLinks).join("\n"), /SEO 문구/);

  const oversizedSeo = structuredClone(complexes);
  oversizedSeo[2].seo.title = "가".repeat(71);
  oversizedSeo[2].seo.description = "나".repeat(181);
  const seoLengthErrors = validateComplexes(oversizedSeo, externalLinks).join("\n");
  assert.match(seoLengthErrors, /seo\.title: 최대 70자/);
  assert.match(seoLengthErrors, /seo\.description: 최대 180자/);

  const unresponsivePublishedImage = structuredClone(complexes);
  unresponsivePublishedImage[0].image.src = "/images/content/area/admin-upload.webp";
  assert.match(validateComplexes(unresponsivePublishedImage, externalLinks).join("\n"), /\/images\/area\/\*\.webp 원본과 반응형 파생본/);

  const pollutedComparison = structuredClone(overview);
  pollutedComparison.comparisonRows[0].values["sinheung-sk-view"] = "비교하지 않는 값";
  assert.match(validateComplexOverview(pollutedComparison, complexes, externalLinks).join("\n"), /비교 대상 단지 값만 허용/);

  const complexesWithPreparingSinheung = structuredClone(complexes);
  complexesWithPreparingSinheung.find((complex) => complex.slug === "sinheung-sk-view").status = "preparing";
  const preparingComparison = structuredClone(overview);
  preparingComparison.comparisonComplexSlugs.push("sinheung-sk-view");
  assert.match(validateComplexOverview(preparingComparison, complexesWithPreparingSinheung, externalLinks).join("\n"), /공개 상태 단지만 비교/);

  const emptyFeatured = structuredClone(overview);
  emptyFeatured.featuredComplexSlugs = [];
  assert.match(validateComplexOverview(emptyFeatured, complexes, externalLinks).join("\n"), /featuredComplexSlugs: 1개 이상의 단지 slug/);

  const shortComparison = structuredClone(overview);
  shortComparison.comparisonComplexSlugs = ["leaders-city-4"];
  assert.match(validateComplexOverview(shortComparison, complexes, externalLinks).join("\n"), /comparisonComplexSlugs: 2개 이상의 단지 slug/);

  const missingComparisonValue = structuredClone(overview);
  delete missingComparisonValue.comparisonRows[0].values["leaders-city-5"];
  assert.match(validateComplexOverview(missingComparisonValue, complexes, externalLinks).join("\n"), /leaders-city-5: 비교값이 필요/);

  const invalidPublishedTotal = structuredClone(complexes);
  const sinheung = invalidPublishedTotal.find((complex) => complex.slug === "sinheung-sk-view");
  sinheung.status = "published";
  sinheung.unitGroups = [{ category: "분양", areaLabel: "확인 중", households: 1 }];
  sinheung.supplySummary = [{ label: "전체", value: "1세대", description: "검증용" }];
  const totalErrors = validateComplexes(invalidPublishedTotal, externalLinks).join("\n");
  assert.match(totalErrors, /unitGroups: 전체 세대수 합계는 1,588/);
  assert.match(totalErrors, /supplySummary: 공급 구분 합계는 1,588/);

  const invalidPublishedSplit = structuredClone(complexes);
  const invalidSplitSinheung = invalidPublishedSplit.find((complex) => complex.slug === "sinheung-sk-view");
  invalidSplitSinheung.status = "published";
  invalidSplitSinheung.unitGroups = [{ category: "전체", areaLabel: "검증용", households: 1588 }];
  invalidSplitSinheung.supplySummary = [
    { label: "분양", value: "1,500세대", description: "검증용" },
    { label: "임대", value: "88세대", description: "검증용" },
  ];
  const splitErrors = validateComplexes(invalidPublishedSplit, externalLinks).join("\n");
  assert.match(splitErrors, /분양 세대수는 공식 확인값 1,499/);
  assert.match(splitErrors, /임대 세대수는 공식 확인값 89/);

  const invalidPublishedEvidence = structuredClone(complexes);
  const evidenceSinheung = invalidPublishedEvidence.find((complex) => complex.slug === "sinheung-sk-view");
  evidenceSinheung.status = "published";
  evidenceSinheung.summary = "공식자료를 추가 확인한 뒤 안내할 예정입니다.";
  evidenceSinheung.facts.find((fact) => fact.label === "주소").value = "대전광역시 동구 확인 중";
  evidenceSinheung.facts.find((fact) => fact.label === "규모").value = "11개동 · 1,588세대";
  evidenceSinheung.sources = evidenceSinheung.sources.filter((source) => source.id !== "kapt-sinheung-sk-view-basic");
  const evidenceErrors = validateComplexes(invalidPublishedEvidence, externalLinks).join("\n");
  assert.match(evidenceErrors, /공식 확인 도로명주소 충무로 255/);
  assert.match(evidenceErrors, /공식 확인 규모 12개동·1,588세대/);
  assert.match(evidenceErrors, /공식 출처 kapt-sinheung-sk-view-basic/);
  assert.match(evidenceErrors, /공개 문구에 준비 상태 표현/);
});
