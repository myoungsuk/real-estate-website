import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("관리자 레이아웃은 검색 색인을 항상 차단한다", async () => {
  const source = await readSource("src/layouts/AdminLayout.astro");
  assert.match(source, /name="robots" content="noindex,nofollow,noarchive"/);
  assert.doesNotMatch(source, /PUBLIC_ALLOW_INDEXING/);
});

test("관리자 정적 경로는 캐시와 검색 노출을 차단한다", async () => {
  const headers = await readSource("public/_headers");
  assert.match(headers, /\/admin\/\*[\s\S]*Cache-Control: no-store/);
  assert.match(headers, /\/admin\/\*[\s\S]*X-Robots-Tag: noindex, nofollow, noarchive/);
});

test("공개 robots와 sitemap에서 관리자 경로를 제외한다", async () => {
  const [robots, config] = await Promise.all([readSource("src/pages/robots.txt.ts"), readSource("astro.config.mjs")]);
  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/api\/admin\//);
  assert.match(config, /startsWith\("\/admin\/"\)/);
});

test("공개 사이트는 승인된 공식 로고를 헤더·푸터·공유 이미지에 사용한다", async () => {
  const [header, footer, layout, home, adminLayout] = await Promise.all([
    readSource("src/components/SiteHeader.astro"),
    readSource("src/components/SiteFooter.astro"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/layouts/AdminLayout.astro"),
    access(new URL("../public/images/brand/leaders-city-happy-logo.png", import.meta.url)),
    access(new URL("../public/images/brand/leaders-city-happy-logo.webp", import.meta.url)),
  ]);
  assert.match(header, /leaders-city-happy-logo\.webp/);
  assert.match(footer, /leaders-city-happy-logo\.webp/);
  assert.match(layout, /property="og:image"/);
  assert.match(layout, /leaders-city-happy-logo\.png/);
  assert.match(home, /logo:[^]*leaders-city-happy-logo\.png/);
  assert.match(adminLayout, /leaders-city-happy-logo\.webp/);
  assert.match(adminLayout, /office\.brandName/);
  assert.match(adminLayout, /공인중개사사무소 · 관리자 시스템/);
});

test("관리자 화면은 네이버 매물 관리와 GitHub 콘텐츠 저장 범위를 구분한다", async () => {
  const [dashboard, listings, writeGate] = await Promise.all([
    readSource("src/pages/admin/index.astro"),
    readSource("src/pages/admin/listings/index.astro"),
    readSource("src/components/admin/AdminWriteGate.astro"),
  ]);
  assert.match(dashboard, /2단계 · 콘텐츠 관리/);
  assert.match(listings, /office\.naverListingsUrl/);
  assert.match(listings, /네이버에서 매물 관리/);
  assert.doesNotMatch(listings, /새 매물 등록/);
  assert.match(writeGate, /data-admin-write-gate/);
  assert.match(writeGate, /session\.writeEnabled/);
});

test("관리자 편집 화면은 네이버 매물 안내와 자체 콘텐츠 편집을 구분한다", async () => {
  const [listingEditor, homeEditor, externalEditor, complexEditor] = await Promise.all([
    readSource("src/pages/admin/listings/editor.astro"),
    readSource("src/pages/admin/content/index.astro"),
    readSource("src/pages/admin/external-links/index.astro"),
    readSource("src/pages/admin/complexes/index.astro"),
  ]);
  assert.match(listingEditor, /office\.naverListingsUrl/);
  assert.match(listingEditor, /매물은 네이버에서 등록·수정합니다/);
  assert.doesNotMatch(listingEditor, /writeAdminContent\("listings"/);
  assert.doesNotMatch(listingEditor, /thumbnailFile/);
  assert.match(homeEditor, /writeAdminContent\("home-content"/);
  assert.match(externalEditor, /fetchExternalLinkPreview/);
  assert.match(externalEditor, /thumbnailFile/);
  assert.match(externalEditor, /data-external-category="blog"/);
  assert.match(externalEditor, /data-external-category="youtube"/);
  assert.match(externalEditor, /data-external-search/);
  assert.match(complexEditor, /writeAdminContent\("complexes"/);
  assert.match(complexEditor, /uploadAdminImage\("area"/);
  assert.match(complexEditor, /name="facts"/);
  assert.match(complexEditor, /name="highlights"/);
  assert.match(complexEditor, /name="sources"/);
});

test("외부 콘텐츠는 블로그와 유튜브를 별도 페이지에서 각각 나눈다", async () => {
  const [component, home, blog, youtube, rawData] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/pages/blog.astro"),
    readSource("src/pages/youtube.astro"),
    readSource("src/data/external-links.json"),
  ]);
  const items = JSON.parse(rawData);
  const blogs = items.filter((item) => item.type === "blog");
  const videos = items.filter((item) => item.type === "youtube");
  assert.equal(blogs.length, 128);
  assert.equal(videos.length, 40);
  assert.deepEqual(
    blogs.reduce((counts, item) => ({ ...counts, [item.publishedAt.slice(0, 4)]: (counts[item.publishedAt.slice(0, 4)] ?? 0) + 1 }), {}),
    { 2024: 41, 2025: 34, 2026: 53 },
  );
  assert.ok(blogs.every((item) => item.publishedAt >= "2024-01-01" && /logNo=/.test(item.url)));
  assert.ok(videos.every((item) => /youtube\.com\/watch\?v=/.test(item.url)));
  assert.match(component, /data-content-pager/);
  assert.match(component, /data-content-page/);
  assert.match(home, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(home, /publishedYoutubeContents[^]*pageSize=\{6\}/);
  assert.match(blog, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(youtube, /publishedYoutubeContents[^]*pageSize=\{6\}/);
  assert.doesNotMatch(home, /\.slice\(0, 6\)/);
});

test("네이버 매물 관리 화면은 검색·유형 필터와 접근 가능한 결과 수를 제공한다", async () => {
  const [listings, adminStyles] = await Promise.all([readSource("src/pages/admin/listings/index.astro"), readSource("src/styles/admin.css")]);
  assert.match(listings, /data-admin-listing-query/);
  assert.match(listings, /data-admin-listing-type/);
  assert.match(listings, /aria-live="polite" data-admin-listing-count/);
  assert.match(listings, /history\.replaceState/);
  assert.match(adminStyles, /\.admin-empty-state\[hidden\][\s\S]*display: none !important/);
});

test("공개 매물 화면은 네이버 개별 매물 50건을 사진 없이 페이지·정렬해 표시한다", async () => {
  const [home, pager, properties, card, styles, rawData] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/components/NaverListingPager.astro"),
    readSource("src/pages/properties/index.astro"),
    readSource("src/components/NaverListingCard.astro"),
    readSource("src/styles/global.css"),
    readSource("src/data/naver-listings.json"),
  ]);
  const data = JSON.parse(rawData);
  assert.equal(data.items.length, 50);
  assert.equal(new Set(data.items.map((item) => item.id)).size, 50);
  assert.equal(data.items[0].title, "휴먼시아2단지 202동");
  assert.equal(data.items[0].floorLabel, "2/22층");
  assert.ok(data.items.every((item) => item.url === `https://fin.land.naver.com/articles/${item.id}`));
  assert.match(home, /NaverListingPager items=\{naverListings\} pageSize=\{6\}/);
  assert.match(pager, /data-listing-page/);
  assert.match(pager, /data-listing-sort="price"/);
  assert.match(pager, /data-listing-sort="latest"/);
  assert.match(pager, /data-listing-sort="area"/);
  assert.doesNotMatch(pager, /랭킹순/);
  assert.match(properties, /naverListings\.map/);
  assert.doesNotMatch(properties, /랭킹순/);
  assert.match(properties, /가격순/);
  assert.match(properties, /최신순/);
  assert.match(properties, /면적순/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /listing\.floorLabel/);
  assert.doesNotMatch(card, /listing-card__visual/);
  assert.match(styles, /\.empty-state\[hidden\][^}]*display: none !important/);
});

test("공개 헤더와 상담 화면은 전체 상호·분리된 콘텐츠·비저장 상담을 안내한다", async () => {
  const [header, navigation, faq] = await Promise.all([
    readSource("src/components/SiteHeader.astro"),
    readSource("src/lib/site.ts"),
    readSource("src/pages/faq.astro"),
  ]);
  assert.match(header, /office\.legalName/);
  assert.match(navigation, /href: "\/blog\/"/);
  assert.match(navigation, /href: "\/youtube\/"/);
  assert.match(navigation, /FAQ·상담/);
  assert.match(faq, /data-consultation-form/);
  assert.match(faq, /홈페이지나 공개 게시판에 저장되지 않습니다/);
  assert.match(faq, /window\.location\.href/);
});

test("사무소·블로그·유튜브 안내 문구는 공개 범위와 자연스러운 표현을 사용한다", async () => {
  const [office, blog, youtube, contents, styles] = await Promise.all([
    readSource("src/pages/office.astro"),
    readSource("src/pages/blog.astro"),
    readSource("src/pages/youtube.astro"),
    readSource("src/pages/contents.astro"),
    readSource("src/styles/global.css"),
  ]);
  assert.match(office, /네이버에 공개된 동·호수와 매물 조건은 그대로 안내/);
  assert.doesNotMatch(office, /정확한 동·호수와 의뢰인 정보는/);
  assert.match(blog, /새로운 소식과 생활 정보를 편하게 둘러보세요/);
  assert.match(youtube, /현장 모습을 영상으로 편하게 확인해 보세요/);
  assert.doesNotMatch(`${youtube}\n${contents}`, /자동재생 없이/);
  assert.match(styles, /\.office-facts h2 \{[^}]*word-break: keep-all/);
  assert.match(styles, /\.section-heading h2 \{[^}]*word-break: keep-all/);
});
