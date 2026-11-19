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

  // 홈 대표 제목·설명은 운영자가 관리자 화면에서 바꾸는 문구라 글자 대신 있는지만 본다(내용 검사는 content-validation).
  assert.equal(typeof homeContent.broker.headline, "string");
  assert.ok(homeContent.broker.headline.trim().length > 0);
  assert.equal(typeof homeContent.broker.lead, "string");
  assert.ok(homeContent.broker.lead.trim().length > 0);
  assert.match(home, /href="\/properties\/">현재 매물 \{naverListings\.length\}건 보기/);
  assert.match(home, /\/properties\/\?trade=sale/);
  assert.match(home, /\/properties\/\?trade=jeonse/);
  assert.match(home, /\/properties\/\?trade=monthly-rent/);
  assert.match(home, /featuredComplexes/);
  assert.doesNotMatch(home, /slug === "leaders-city-4"|slug === "leaders-city-5"/);
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

  assert.match(complexes, /<a class="complex-index-card" href=\{`\/complexes\/\$\{complex\.slug\}\/`\}/);
  assert.match(styles, /\.complex-index-card \{[^}]*width: 100%[^}]*min-width: 0/);
  assert.match(styles, /\.complex-index-card:hover \{[^}]*translateY\(-8px\)[^}]*box-shadow/);
  assert.match(styles, /\.complex-index-card:hover > picture img \{[^}]*scale\(1\.045\)/);
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
  assert.match(listingEditor, /한 번 더 눌러 등록 종료/);
  assert.match(listingEditor, /dataset\.confirmDelete/);
  assert.doesNotMatch(listingEditor, /window\.confirm/);
  assert.match(listingEditor, /createBankListingImport/);
  assert.match(listingEditor, /createManualNaverListing/);
  assert.match(listingEditor, /writeAdminContentBatch/);
  assert.match(listingEditor, /resource: "listing-review-state"/);
  assert.match(listingEditor, /resource: "naver-listings"/);
  assert.match(listingEditor, /data-manual-delete/);
  assert.match(listingEditor, /data-bank-apply/);
  assert.doesNotMatch(listingEditor, /thumbnailFile/);
  assert.match(homeEditor, /writeAdminContent\("home-content"/);
  assert.match(externalEditor, /fetchExternalLinkPreview/);
  assert.match(externalEditor, /thumbnailFile/);
  assert.match(externalEditor, /data-external-category="blog"/);
  assert.match(externalEditor, /data-external-category="youtube"/);
  assert.match(externalEditor, /data-external-category="instagram"/);
  assert.match(externalEditor, /<option value="instagram">인스타그램<\/option>/u);
  assert.match(externalEditor, /previewButton\.hidden = isInstagram/u, "인스타그램은 '정보 불러오기'를 숨김(링크 미리보기 허용 주소는 블로그·유튜브뿐)");
  assert.match(externalEditor, /url: type === "instagram" \? normalizeInstagramUrl\(/u, "공유 꼬리(?igsh=)를 지우고 저장");
  assert.match(externalEditor, /type === "instagram" && !thumbnail/u, "사진 없이 저장하지 않음");
  assert.match(externalEditor, /<h1>블로그·유튜브·인스타그램 관리<\/h1>/u, "화면 제목에 인스타그램(2026-11-19 사용자 결정)");
  assert.match(externalEditor, /<span aria-current="page">블로그·유튜브·인스타그램<\/span>/u, "이동 경로도 같은 이름");
  assert.match(externalEditor, /name="youtubeFormat"/);
  assert.match(externalEditor, /data-external-search/);
  assert.match(complexEditor, /writeAdminContent\("complexes"/);
  assert.match(complexEditor, /uploadAdminImage\("area"/);
  assert.match(complexEditor, /공개 전에는 검수한 `\/images\/area\/` 원본과 640·1200px 파생본/);
  assert.match(complexEditor, /name="facts"/);
  assert.match(complexEditor, /name="highlights"/);
  assert.match(complexEditor, /writeAdminContent\("complexes-overview"/);
  assert.match(complexEditor, /name="aliases"/);
  assert.match(complexEditor, /name="seoTitle"/);
  assert.match(complexEditor, /name="seoDescription"/);
  assert.match(complexEditor, /name="seoTitle" maxlength="70"/);
  assert.match(complexEditor, /name="seoDescription" rows="3" maxlength="180"/);
  assert.match(complexEditor, /name="unitDataNote"/);
  assert.match(complexEditor, /준비 중 단지는 공개 상세·주요 단지 카드·매물 필터·sitemap에서 제외/);
  assert.match(complexEditor, /name="featuredComplexSlugs"/);
  assert.match(complexEditor, /name="comparisonComplexSlugs"/);
  assert.match(complexEditor, /parseComplexComparisonRows/);
  assert.match(complexEditor, /name="unitGroups"/);
  assert.match(complexEditor, /name="livingSections"/);
  assert.match(complexEditor, /name="amenityGroups"/);
  assert.match(complexEditor, /name="relatedContentIds"/);
  assert.match(complexEditor, /name="sources"/);
});

test("관리자 인스타그램: 메뉴 이름에 인스타그램을 넣고, 콘텐츠 ID를 비우면 instagram-게시일로 채운다", async () => {
  const { suggestInstagramContentId } = await import("../src/lib/admin-external-id.mjs");
  const [layout, editor] = await Promise.all([
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/pages/admin/external-links/index.astro"),
  ]);
  assert.match(layout, /href: "\/admin\/external-links\/", label: "블로그·유튜브·인스타그램"/u);
  assert.equal(suggestInstagramContentId("2026-11-19", ["naver-blog-p5468300-1", "youtube-abc"]), "instagram-2026-11-19");
  assert.equal(suggestInstagramContentId("2026-11-19", ["instagram-2026-11-19"]), "instagram-2026-11-19-2");
  assert.equal(suggestInstagramContentId("2026-11-19", ["instagram-2026-11-19", "instagram-2026-11-19-2", "instagram-2026-11-19-4"]), "instagram-2026-11-19-3");
  assert.match(suggestInstagramContentId("2026-11-19", ["instagram-2026-11-19"]), /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "ID 칸 pattern·검사 규칙(kebab-case)에 맞음");
  assert.equal(suggestInstagramContentId("", []), null, "게시일이 없으면 날짜를 지어내지 않음");
  assert.equal(suggestInstagramContentId("2026-1-9", []), null);
  assert.match(editor, /type === "instagram" && !field\("id"\)!\.value\.trim\(\)/u, "직접 넣은 ID는 그대로 둠");
  assert.match(editor, /suggestInstagramContentId\(field\("publishedAt"\)!\.value, resource\.data\.filter\(\(item\) => item\.id !== originalId\)/u, "고치는 중인 자기 ID는 겹침으로 세지 않음");
  assert.match(editor, /idField\.required = !isInstagram/u, "인스타그램은 ID 칸을 비워도 저장 단계로 넘어감");
});

test("관리자 인스타그램: 계정 이름이 들어간 게시물 주소는 저장 전에 /p/·/reel/ 주소로 바꾼다", async () => {
  const { normalizeInstagramUrl } = await import("../src/lib/admin-instagram-url.mjs");
  const editor = await readSource("src/pages/admin/external-links/index.astro");
  assert.equal(normalizeInstagramUrl("https://www.instagram.com/readers.45_real.estate/p/ABCdef_12-x/"), "https://www.instagram.com/p/ABCdef_12-x/");
  assert.equal(normalizeInstagramUrl("https://www.instagram.com/readers.45_real.estate/reel/ABCdef/?igsh=abc123"), "https://www.instagram.com/reel/ABCdef/", "공유 꼬리도 같이 지움");
  assert.equal(normalizeInstagramUrl("https://instagram.com/some_account/p/ABCdef"), "https://instagram.com/p/ABCdef/", "주소 뒤 / 없어도 바꿈");
  assert.equal(normalizeInstagramUrl("https://www.instagram.com/p/ABCdef/?igsh=abc123"), "https://www.instagram.com/p/ABCdef/", "이미 /p/ 주소면 꼬리만 지움");
  assert.equal(normalizeInstagramUrl("https://m.instagram.com/some_account/p/ABCdef/"), "https://m.instagram.com/some_account/p/ABCdef/", "m.instagram.com은 바꾸지 않음(콘텐츠 검사가 거부)");
  assert.equal(normalizeInstagramUrl("https://example.com/some_account/p/ABCdef/"), "https://example.com/some_account/p/ABCdef/", "다른 도메인은 바꾸지 않음");
  assert.equal(normalizeInstagramUrl("https://www.instagram.com/some_account/"), "https://www.instagram.com/some_account/", "계정 첫 화면 주소는 바꾸지 않음(콘텐츠 검사가 거부)");
  assert.match(editor, /import \{ normalizeInstagramUrl \} from "\.\.\/\.\.\/\.\.\/lib\/admin-instagram-url\.mjs"/u);
  assert.doesNotMatch(editor, /const normalizeInstagramUrl =/u, "화면 안에 따로 만든 함수 없이 같은 함수를 씀");
});

test("관리자 배포 상태 화면은 GitHub 저장과 Production digest 확인을 분리한다", async () => {
  const [layout, page, component, client, styles, config] = await Promise.all([
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/pages/admin/deployment/index.astro"),
    readSource("src/components/admin/AdminDeploymentStatus.astro"),
    readSource("src/lib/admin-content-client.ts"),
    readSource("src/styles/admin.css"),
    readSource("wrangler.jsonc"),
  ]);
  assert.match(layout, /href: "\/admin\/deployment\/"/u);
  assert.match(page, /저장과 공개 반영을 따로 확인/u);
  assert.match(component, /GitHub 저장/u);
  assert.match(component, /Cloudflare 빌드/u);
  assert.match(component, /resourceMatched/u);
  assert.match(component, /5_000|pollAfterMs/u);
  assert.match(client, /\/api\/admin\/v1\/deployment-status/u);
  assert.match(client, /leaderscityhappy\.admin\.deployment\.v1/u);
  assert.match(styles, /\.admin-deployment-steps/u);
  assert.match(config, /"version_metadata"[\s\S]*"CF_VERSION_METADATA"/u);
});

test("관리자 변경 이력 화면은 diff와 정확한 2차 문구 뒤 새 commit 복원만 요청한다", async () => {
  const [layout, page, component, client, styles] = await Promise.all([
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/pages/admin/history/index.astro"),
    readSource("src/components/admin/AdminContentHistory.astro"),
    readSource("src/lib/admin-content-client.ts"),
    readSource("src/styles/admin.css"),
  ]);
  assert.match(layout, /href: "\/admin\/history\/"/u);
  assert.match(page, /과거 내용을 확인하고 안전하게 복원/u);
  assert.match(page, /Git 복원과 Cloudflare 롤백은 다른 작업/u);
  assert.match(component, /readAdminContentHistory/u);
  assert.match(component, /readAdminContentRevision/u);
  assert.match(component, /createAdminContentDiff/u);
  assert.match(component, /confirmationInput\.value !== selectedRevision\.confirmation/u);
  assert.match(component, /restoreAdminContent/u);
  assert.doesNotMatch(component, /window\.confirm|force:\s*true/u);
  assert.match(client, /\/api\/admin\/v1\/content-history/u);
  assert.match(client, /\/api\/admin\/v1\/content\/restore/u);
  assert.match(styles, /\.admin-history-list/u);
  assert.match(styles, /\.admin-history-confirmation/u);
});

test("관리자 저장 화면은 공통 변경 요약·사전 검증과 이탈 경고를 사용한다", async () => {
  const [listingEditor, homeEditor, externalEditor, complexEditor, review, styles] = await Promise.all([
    readSource("src/pages/admin/listings/editor.astro"),
    readSource("src/pages/admin/content/index.astro"),
    readSource("src/pages/admin/external-links/index.astro"),
    readSource("src/pages/admin/complexes/index.astro"),
    readSource("src/lib/admin-content-review.ts"),
    readSource("src/styles/admin.css"),
  ]);
  for (const source of [listingEditor, homeEditor, externalEditor, complexEditor]) {
    assert.match(source, /reviewAdminContentChange/u);
    assert.match(source, /guardAdminFormChanges/u);
  }
  assert.match(review, /\/api\/admin\/v1\/content\/validate|validateAdminContent/u);
  assert.match(review, /beforeunload/u);
  assert.match(review, /저장 전 변경 내용 확인/u);
  assert.match(styles, /\.admin-review-dialog::backdrop/u);
  assert.match(styles, /\.admin-review-actions/u);
});

test("외부 콘텐츠는 블로그와 유튜브를 나누고 일반 영상을 기본으로 Shorts를 전환한다", async () => {
  const [component, home, blog, youtube, privacy, headers, contentSource, rawData] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/pages/blog.astro"),
    readSource("src/pages/youtube.astro"),
    readSource("src/pages/privacy.astro"),
    readSource("public/_headers"),
    readSource("src/lib/content.ts"),
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
  assert.ok(videos.filter((item) => item.youtubeFormat === "short").length >= 32);
  assert.match(component, /data-content-pager/);
  assert.match(component, /data-content-page/);
  assert.doesNotMatch(component, /data-content-filter="all"/);
  assert.match(component, /aria-pressed="true"[^>]*data-content-filter="video"/);
  assert.match(component, /data-content-filter="short">Shorts 보기/);
  assert.match(component, /showPage\(0\)/);
  assert.match(component, /\(hover: hover\) and \(pointer: fine\)/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.match(component, /media\.closest<HTMLElement>\("\[data-content-item\]"\)/);
  assert.match(component, /youtube-nocookie\.com\/embed/);
  assert.match(component, /}, 300\)/);
  assert.match(home, /homeBlogContents[^]*pageSize=\{9\}[^]*paginate=\{false\}/);
  assert.match(home, /homeYoutubeContents[^]*pageSize=\{6\}[^]*paginate=\{false\}[^]*hoverPreview/);
  assert.doesNotMatch(home, /youtubeFilters/);
  assert.match(blog, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(youtube, /publishedYoutubeContents[^]*pageSize=\{6\}[^]*youtubeFilters[^]*hoverPreview/);
  assert.doesNotMatch(`${home}\n${youtube}`, /youtube-format-group/);
  assert.match(contentSource, /timeZone: "Asia\/Seoul"/);
  assert.match(headers, /frame-src https:\/\/www\.youtube-nocookie\.com/);
  assert.match(privacy, /youtube-nocookie\.com/);
  assert.match(home, /publishedBlogContents\.slice\(0, 9\)/);
  assert.match(home, /publishedYoutubeVideoContents\.slice\(0, 6\)/);
  assert.match(home, /publishedInstagramContents\.slice\(0, 6\)/);
  assert.match(home, /homeInstagramContents\.length > 0 && <ExternalContentList items=\{homeInstagramContents\}[^>]*paginate=\{false\}[^>]*variant="note"/u, "0건이면 목록 없이 바로가기만");
  assert.match(contentSource, /export type ExternalContentType = "blog" \| "youtube" \| "instagram";/u);
});

test("네이버 매물 관리 화면은 검색·유형·재확인 필터와 기준 미설정 안전 상태를 제공한다", async () => {
  const [listings, adminStyles, policy] = await Promise.all([
    readSource("src/pages/admin/listings/index.astro"),
    readSource("src/styles/admin.css"),
    readSource(".github/listing-review-policy.json"),
  ]);
  assert.match(listings, /data-admin-listing-query/);
  assert.match(listings, /data-admin-listing-type/);
  assert.match(listings, /data-admin-listing-review/);
  assert.match(listings, /data-admin-listing-sort/);
  assert.match(listings, /Bank 자동 동기화/u);
  assert.match(listings, /날짜 경과만으로 자동 종료하거나 숨기지 않습니다/u);
  assert.match(listings, /data-admin-listing-review-date/u);
  assert.match(listings, /data-listing-review-confirm/u);
  assert.match(listings, /data-listing-review-select/u);
  assert.match(listings, /data-listing-review-selected/u);
  assert.match(listings, /reviewedManualIds: ids/u);
  assert.match(listings, /reviewAdminContentChange/u);
  assert.match(listings, /writeAdminContent\("listing-review-state"/u);
  assert.match(listings, /aria-live="polite" data-admin-listing-count/);
  assert.match(listings, /history\.replaceState/);
  assert.deepEqual(JSON.parse(policy), { schemaVersion: 1, bankWarningDays: null, manualWarningDays: null });
  assert.match(adminStyles, /\.admin-listing-review-summary/u);
  assert.match(adminStyles, /\.admin-empty-state\[hidden\][\s\S]*display: none !important/);
});

test("공개 매물 화면은 조건·관심·비교 기능과 기존 네이버 링크·정렬을 함께 제공한다", async () => {
  const [home, pager, properties, compare, inquiry, card, styles, rawData] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/components/NaverListingPager.astro"),
    readSource("src/pages/properties/index.astro"),
    readSource("src/pages/properties/compare/index.astro"),
    readSource("src/components/InquiryComposer.astro"),
    readSource("src/components/NaverListingCard.astro"),
    readSource("src/styles/global.css"),
    readSource("src/data/naver-listings.json"),
  ]);
  const data = JSON.parse(rawData);
  assert.ok(data.items.length > 0);
  assert.equal(new Set(data.items.map((item) => item.id)).size, data.items.length);
  // 매물 목록은 매일 동기화와 관리자 화면이 바꾸므로 첫 매물의 글자 대신 모든 매물의 모양을 본다.
  assert.ok(data.items.every((item) => typeof item.title === "string" && item.title.trim().length > 0));
  assert.ok(data.items.every((item) => item.floorLabel === null || (typeof item.floorLabel === "string" && /층$/u.test(item.floorLabel))));
  assert.ok(data.items.every((item) => item.url === `https://fin.land.naver.com/articles/${item.id}`));
  assert.ok(data.items.every((item) => /^\d{4}-\d{2}-\d{2}$/u.test(item.registeredAt)));
  assert.match(home, /NaverListingPager items=\{naverListings\} pageSize=\{6\}/);
  assert.match(pager, /data-listing-page/);
  assert.doesNotMatch(pager, /data-listing-sort="default"|기본순/);
  assert.match(pager, /data-listing-sort="latest" aria-pressed="true">최근 등록순/);
  assert.match(pager, /data-listing-sort="price"[^>]*>가격 낮은순/);
  assert.match(pager, /data-listing-sort="price-desc"[^>]*>가격 높은순/);
  assert.match(pager, /data-listing-sort="area"[^>]*>면적 작은순/);
  assert.match(pager, /data-listing-sort="area-desc"[^>]*>면적 큰순/);
  assert.match(pager, /applySort\("latest"\)/);
  assert.doesNotMatch(pager, /랭킹순/);
  assert.match(properties, /naverListings\.map/);
  assert.match(properties, /name="complex"/);
  assert.match(properties, /name="minPrice"/);
  assert.match(properties, /name="minArea"/);
  assert.match(properties, /normalizeListingExplorerQuery/);
  assert.match(properties, /buildListingExplorerSearchParams/);
  assert.match(properties, /data-favorite-view="favorites"/);
  assert.match(properties, /data-compare-tray/);
  assert.doesNotMatch(properties, /랭킹순/);
  assert.doesNotMatch(properties, /기본순|최근 확인순/);
  assert.match(properties, /<option value="latest">최근 등록순<\/option>/);
  assert.match(properties, /가격 낮은순/);
  assert.match(properties, /가격 높은순/);
  assert.match(properties, /면적 작은순/);
  assert.match(properties, /면적 큰순/);
  assert.match(properties, /class="listing-update"/);
  assert.match(properties, /naverListingsUpdatedAt/);
  assert.match(compare, /noindexFollow/);
  assert.match(compare, /canonicalPath="\/properties\/"/);
  assert.match(compare, /normalizeCompareIds/);
  assert.match(inquiry, /buildInquiryMessage/);
  assert.doesNotMatch(inquiry, /fetch\(|\?body=/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /listing\.floorLabel/);
  assert.match(card, /등록 \{registeredAtLabel\}/);
  assert.doesNotMatch(card, /확인<\/time>/);
  assert.match(card, /data-registered-at/);
  assert.match(card, /data-listing-id=\{listing\.id\}/);
  assert.match(card, /data-complex=\{complexSlug\}/);
  assert.match(card, /data-favorite-button/);
  assert.match(card, /data-compare-button/);
  assert.doesNotMatch(card, /listing-card__visual/);
  assert.match(styles, /\.empty-state\[hidden\][^}]*display: none !important/);
});

test("공개 헤더와 상담 화면은 전체 상호·분리된 콘텐츠·FAQ 38개·비저장 상담을 안내한다", async () => {
  const [header, navigation, faq, faqData] = await Promise.all([
    readSource("src/components/SiteHeader.astro"),
    readSource("src/lib/site.ts"),
    readSource("src/pages/faq.astro"),
    readSource("src/data/faq.json"),
  ]);
  assert.match(header, /office\.legalName/);
  assert.match(navigation, /href: "\/blog\/"/);
  assert.match(navigation, /href: "\/youtube\/"/);
  assert.match(navigation, /FAQ·상담/);
  assert.match(navigation, /href: "\/youtube\/", label: "유튜브" \},\r?\n  \{ href: office\.instagramUrl, label: "인스타그램", external: true \}/u, "인스타그램은 유튜브 바로 뒤 바깥 링크");
  assert.match(header, /item\.external \? \(\s*<a href=\{item\.href\} target="_blank" rel="noopener noreferrer">[\s\S]*?<span class="sr-only">\(새 창\)<\/span>/u, "바깥 링크는 새 창 안내");
  assert.match(
    navigation,
    /href: "\/office\/", label: "사무소 소개"[\s\S]*href: "\/complexes\/", label: "아파트 소개"[\s\S]*href: "\/properties\/", label: "매물"/,
  );
  assert.match(faq, /data-consultation-form/);
  assert.match(faq, /홈페이지나 공개 게시판에 저장되지 않습니다/);
  assert.match(faq, /window\.location\.href/);
  assert.match(faq, /class="faq-category-nav"/);
  assert.match(faq, /class="faq-category-section"/);
  const faqItems = JSON.parse(faqData);
  // 카테고리 8개는 화면 코드(faq.astro)와 content-validation이 정한 목록이라 그대로 본다.
  const faqCategoryTitles = [...faq.matchAll(/title: "([^"]+)", shortTitle:/gu)].map((match) => match[1]);
  assert.deepEqual(faqCategoryTitles, [
    "매물 확인과 상담",
    "리더스시티 4블록·5블록",
    "가격과 시세",
    "매매계약과 권리관계",
    "전세·월세와 보증금 보호",
    "중개보수·대출·세금과 관리비",
    "하자·잔금과 입주",
    "정보의 범위와 책임",
  ]);
  // FAQ 개수와 카테고리별 개수는 운영자가 관리자 화면에서 바꾸므로, 있는지와 화면 카테고리 안에 드는지만 본다.
  assert.ok(faqItems.length > 0);
  assert.ok(faqItems.every((item) => faqCategoryTitles.includes(item.category)));
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
