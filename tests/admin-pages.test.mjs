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

test("공개 사이트는 승인된 공식 로고와 메인 전용 공유 이미지를 사용한다", async () => {
  const [header, footer, layout, home, adminLayout] = await Promise.all([
    readSource("src/components/SiteHeader.astro"),
    readSource("src/components/SiteFooter.astro"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/layouts/AdminLayout.astro"),
    access(new URL("../public/images/brand/leaders-city-happy-logo.png", import.meta.url)),
    access(new URL("../public/images/brand/leaders-city-happy-logo.webp", import.meta.url)),
    access(new URL("../public/images/brand/og-home.png", import.meta.url)),
  ]);
  assert.match(header, /leaders-city-happy-logo\.webp/);
  assert.match(footer, /leaders-city-happy-logo\.webp/);
  assert.match(layout, /property="og:image"/);
  assert.match(layout, /leaders-city-happy-logo\.png/);
  assert.match(layout, /shareImageWidth = 1402/);
  assert.match(layout, /shareImageHeight = 1122/);
  assert.match(home, /shareImage="\/images\/brand\/og-home\.png"/);
  assert.match(home, /shareImageWidth=\{1200\}/);
  assert.match(home, /shareImageHeight=\{630\}/);
  assert.match(home, /logo:[^]*leaders-city-happy-logo\.png/);
  assert.match(adminLayout, /leaders-city-happy-logo\.webp/);
  assert.match(adminLayout, /office\.brandName/);
  assert.match(adminLayout, /공인중개사사무소 · 관리자 시스템/);
});

test("메인페이지 선택 개선은 기존 데이터와 URL을 재사용한다", async () => {
  const [home, rawHomeContent, ogImage] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/data/home-content.json"),
    readFile(new URL("../public/images/brand/og-home.png", import.meta.url)),
  ]);
  const homeContent = JSON.parse(rawHomeContent);

  assert.equal(homeContent.broker.headline, "대전 동구 매물, 직접 확인하고 비교해서 안내합니다.");
  assert.match(homeContent.broker.lead, /리더스시티 4·5블록[^]*매매·전세·월세/);
  assert.match(home, /href="\/properties\/">현재 매물 \{naverListings\.length\}건 보기/);
  assert.match(home, /\/properties\/\?trade=sale/);
  assert.match(home, /\/properties\/\?trade=jeonse/);
  assert.match(home, /\/properties\/\?trade=monthly-rent/);
  assert.match(home, /slug === "leaders-city-4"/);
  assert.match(home, /slug === "leaders-city-5"/);
  assert.doesNotMatch(home, /office-specialist/);
  assert.match(home, /href="\/office\/">사무소 자세히 보기/);
  assert.match(home, /href="\/location\/">오시는 길/);

  const listingsIndex = home.indexOf('id="listings"');
  const leadersCityIndex = home.indexOf('id="leaders-city"');
  const blogIndex = home.indexOf('id="blog"');
  const youtubeIndex = home.indexOf('id="youtube"');
  assert.ok(listingsIndex < leadersCityIndex);
  assert.ok(leadersCityIndex < blogIndex);
  assert.ok(blogIndex < youtubeIndex);

  assert.equal(ogImage.toString("ascii", 1, 4), "PNG");
  assert.equal(ogImage.readUInt32BE(16), 1200);
  assert.equal(ogImage.readUInt32BE(20), 630);
});

test("단지 목록 카드는 전체 링크와 hover·focus 피드백을 제공한다", async () => {
  const [complexes, styles] = await Promise.all([
    readSource("src/pages/complexes/index.astro"),
    readSource("src/styles/global.css"),
  ]);

  assert.match(complexes, /<a class="complex-index-card" href=\{`\/complexes\/\$\{complex\.slug\}\/`\}>/);
  assert.match(styles, /\.complex-index-card \{[^}]*width: 100%[^}]*min-width: 0/);
  assert.match(styles, /\.complex-index-card:hover \{[^}]*translateY\(-8px\)[^}]*box-shadow/);
  assert.match(styles, /\.complex-index-card:hover > img \{[^}]*scale\(1\.045\)/);
  assert.match(styles, /\.complex-index-card:focus-visible \{[^}]*outline-offset: 6px[^}]*translateY\(-6px\)/);
  assert.match(styles, /\.complex-index-card:active \{[^}]*scale\(0\.99\)/);
});

test("관리자 화면은 네이버 매물 목록과 등록·동기화 화면을 연결한다", async () => {
  const [dashboard, listings, writeGate] = await Promise.all([
    readSource("src/pages/admin/index.astro"),
    readSource("src/pages/admin/listings/index.astro"),
    readSource("src/components/admin/AdminWriteGate.astro"),
  ]);
  assert.match(dashboard, /2단계 · 콘텐츠 관리/);
  assert.match(listings, /\/admin\/listings\/editor\//);
  assert.match(listings, /매물 등록·동기화/);
  assert.match(listings, /수정·종료/);
  assert.match(writeGate, /data-admin-write-gate/);
  assert.match(writeGate, /session\.writeEnabled/);
});

test("관리자 편집 화면은 부동산뱅크 가져오기와 네이버 매물 직접 등록을 제공한다", async () => {
  const [listingEditor, homeEditor, externalEditor, complexEditor] = await Promise.all([
    readSource("src/pages/admin/listings/editor.astro"),
    readSource("src/pages/admin/content/index.astro"),
    readSource("src/pages/admin/external-links/index.astro"),
    readSource("src/pages/admin/complexes/index.astro"),
  ]);
  assert.match(listingEditor, /office\.naverListingsUrl/);
  assert.match(listingEditor, /readBankListingFile/);
  assert.match(listingEditor, /createBankListingImport/);
  assert.match(listingEditor, /createManualNaverListing/);
  assert.match(listingEditor, /writeAdminContent\("naver-listings"/);
  assert.match(listingEditor, /data-manual-delete/);
  assert.match(listingEditor, /data-bank-apply/);
  assert.doesNotMatch(listingEditor, /thumbnailFile/);
  assert.match(homeEditor, /writeAdminContent\("home-content"/);
  assert.match(externalEditor, /fetchExternalLinkPreview/);
  assert.match(externalEditor, /thumbnailFile/);
  assert.match(externalEditor, /data-external-category="blog"/);
  assert.match(externalEditor, /data-external-category="youtube"/);
  assert.match(externalEditor, /name="youtubeFormat"/);
  assert.match(externalEditor, /data-external-search/);
  assert.match(complexEditor, /writeAdminContent\("complexes"/);
  assert.match(complexEditor, /uploadAdminImage\("area"/);
  assert.match(complexEditor, /name="facts"/);
  assert.match(complexEditor, /name="highlights"/);
  assert.match(complexEditor, /writeAdminContent\("complexes-overview"/);
  assert.match(complexEditor, /name="unitGroups"/);
  assert.match(complexEditor, /name="livingSections"/);
  assert.match(complexEditor, /name="amenityGroups"/);
  assert.match(complexEditor, /name="relatedContentIds"/);
  assert.match(complexEditor, /name="sources"/);
});

test("외부 콘텐츠는 블로그와 유튜브를 나누고 유튜브는 한 목록에서 형식을 전환한다", async () => {
  const [component, home, blog, youtube, privacy, headers, rawData] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/pages/blog.astro"),
    readSource("src/pages/youtube.astro"),
    readSource("src/pages/privacy.astro"),
    readSource("public/_headers"),
    readSource("src/data/external-links.json"),
  ]);
  const items = JSON.parse(rawData);
  const blogs = items.filter((item) => item.type === "blog");
  const videos = items.filter((item) => item.type === "youtube");
  const blogCountsByYear = blogs.reduce(
    (counts, item) => ({ ...counts, [item.publishedAt.slice(0, 4)]: (counts[item.publishedAt.slice(0, 4)] ?? 0) + 1 }),
    {},
  );
  assert.ok(blogs.length >= 128);
  assert.ok(videos.length >= 40);
  assert.ok(blogCountsByYear["2024"] >= 41);
  assert.ok(blogCountsByYear["2025"] >= 34);
  assert.ok(blogCountsByYear["2026"] >= 53);
  assert.ok(blogs.every((item) => item.publishedAt >= "2024-01-01" && /logNo=/.test(item.url)));
  assert.ok(videos.every((item) => /youtube\.com\/watch\?v=/.test(item.url)));
  assert.ok(videos.every((item) => item.youtubeFormat === "video" || item.youtubeFormat === "short"));
  assert.ok(videos.filter((item) => item.youtubeFormat === "video").length >= 40);
  assert.match(component, /data-content-pager/);
  assert.match(component, /data-content-page/);
  assert.match(component, /data-content-filter="all"/);
  assert.match(component, /data-content-filter="video"/);
  assert.match(component, /data-content-filter="short"/);
  assert.match(component, /showPage\(0\)/);
  assert.match(component, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /media\.closest<HTMLElement>\("\[data-content-item\]"\)/);
  assert.match(component, /youtube-nocookie\.com\/embed/);
  assert.match(component, /}, 300\)/);
  assert.match(home, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(home, /publishedYoutubeContents[^]*pageSize=\{6\}[^]*youtubeFilters[^]*paginate=\{false\}[^]*hoverPreview/);
  assert.match(blog, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(youtube, /publishedYoutubeContents[^]*pageSize=\{6\}[^]*youtubeFilters[^]*hoverPreview/);
  assert.doesNotMatch(`${home}\n${youtube}`, /youtube-format-group/);
  assert.match(headers, /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.match(privacy, /youtube-nocookie\.com/);
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

test("공개 매물 화면은 현재 네이버 개별 매물을 사진 없이 페이지·정렬해 표시한다", async () => {
  const [home, pager, properties, card, styles, rawData] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/components/NaverListingPager.astro"),
    readSource("src/pages/properties/index.astro"),
    readSource("src/components/NaverListingCard.astro"),
    readSource("src/styles/global.css"),
    readSource("src/data/naver-listings.json"),
  ]);
  const data = JSON.parse(rawData);
  assert.ok(data.items.length > 0);
  assert.equal(new Set(data.items.map((item) => item.id)).size, data.items.length);
  assert.equal(data.items[0].title, "휴먼시아2단지 202동");
  assert.equal(data.items[0].floorLabel, "2/22층");
  assert.ok(data.items.every((item) => item.url === `https://fin.land.naver.com/articles/${item.id}`));
  assert.match(home, /NaverListingPager items=\{naverListings\} pageSize=\{6\}/);
  assert.match(pager, /data-listing-page/);
  assert.match(pager, /data-listing-sort="default" aria-pressed="true">기본순/);
  assert.match(pager, /data-listing-sort="price"[^>]*>가격 낮은순/);
  assert.match(pager, /data-listing-sort="price-desc"[^>]*>가격 높은순/);
  assert.match(pager, /data-listing-sort="latest"[^>]*>최근 확인순/);
  assert.match(pager, /data-listing-sort="area"[^>]*>면적 작은순/);
  assert.match(pager, /data-listing-sort="area-desc"[^>]*>면적 큰순/);
  assert.doesNotMatch(pager, /랭킹순/);
  assert.match(properties, /naverListings\.map/);
  assert.doesNotMatch(properties, /랭킹순/);
  assert.match(properties, /<option value="">기본순<\/option>/);
  assert.match(properties, /가격 낮은순/);
  assert.match(properties, /가격 높은순/);
  assert.match(properties, /최근 확인순/);
  assert.match(properties, /면적 작은순/);
  assert.match(properties, /면적 큰순/);
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
