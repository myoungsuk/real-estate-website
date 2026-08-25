import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
  const [robots, config] = await Promise.all([
    readSource("src/pages/robots.txt.ts"),
    readSource("astro.config.mjs"),
  ]);

  assert.match(robots, /Disallow: \/admin\//);
  assert.match(robots, /Disallow: \/api\/admin\//);
  assert.match(config, /startsWith\("\/admin\/"\)/);
});

test("관리자 화면은 콘텐츠 관리 단계와 GitHub 저장 게이트를 명확히 표시한다", async () => {
  const [dashboard, listings, writeGate] = await Promise.all([
    readSource("src/pages/admin/index.astro"),
    readSource("src/pages/admin/listings/index.astro"),
    readSource("src/components/admin/AdminWriteGate.astro"),
  ]);

  assert.match(dashboard, /2단계 · 콘텐츠 관리/);
  assert.match(listings, /href="\/admin\/listings\/editor\/"/);
  assert.match(writeGate, /data-admin-write-gate/);
  assert.match(writeGate, /session\.writeEnabled/);
});

test("관리자 편집 화면은 매물·홈·블로그·유튜브·지역 설명을 제공한다", async () => {
  const [listingEditor, homeEditor, externalEditor, complexEditor] = await Promise.all([
    readSource("src/pages/admin/listings/editor.astro"),
    readSource("src/pages/admin/content/index.astro"),
    readSource("src/pages/admin/external-links/index.astro"),
    readSource("src/pages/admin/complexes/index.astro"),
  ]);

  assert.match(listingEditor, /writeAdminContent\("listings"/);
  assert.match(listingEditor, /uploadAdminImage\("listing"/);
  assert.match(homeEditor, /writeAdminContent\("home-content"/);
  assert.match(externalEditor, /fetchExternalLinkPreview/);
  assert.match(externalEditor, /thumbnailFile/);
  assert.match(complexEditor, /writeAdminContent\("complexes"/);
  assert.match(complexEditor, /uploadAdminImage\("area"/);
  assert.match(complexEditor, /name="facts"/);
  assert.match(complexEditor, /name="highlights"/);
  assert.match(complexEditor, /name="sources"/);
});

test("외부 콘텐츠는 2026년 블로그를 9개, 실제 유튜브 영상을 6개씩 페이지로 나눈다", async () => {
  const [component, home, contents, rawData] = await Promise.all([
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/pages/index.astro"),
    readSource("src/pages/contents.astro"),
    readSource("src/data/external-links.json"),
  ]);
  const items = JSON.parse(rawData);
  const blogs = items.filter((item) => item.type === "blog");
  const videos = items.filter((item) => item.type === "youtube");

  assert.equal(blogs.length, 45);
  assert.equal(videos.length, 40);
  assert.ok(blogs.every((item) => item.publishedAt.startsWith("2026-") && /logNo=/.test(item.url)));
  assert.ok(videos.every((item) => /youtube\.com\/watch\?v=/.test(item.url)));
  assert.match(component, /data-content-pager/);
  assert.match(component, /data-content-page/);
  assert.match(home, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(home, /publishedYoutubeContents[^]*pageSize=\{6\}/);
  assert.match(contents, /publishedBlogContents[^]*pageSize=\{9\}/);
  assert.match(contents, /publishedYoutubeContents[^]*pageSize=\{6\}/);
  assert.doesNotMatch(home, /\.slice\(0, 6\)/);
});

test("매물 관리 화면은 검색·상태 필터와 접근 가능한 결과 수를 제공한다", async () => {
  const [listings, adminStyles] = await Promise.all([
    readSource("src/pages/admin/listings/index.astro"),
    readSource("src/styles/admin.css"),
  ]);

  assert.match(listings, /data-admin-listing-query/);
  assert.match(listings, /data-admin-listing-status/);
  assert.match(listings, /aria-live="polite" data-admin-listing-count/);
  assert.match(listings, /window\.history\.replaceState/);
  assert.match(adminStyles, /\.admin-empty-state\[hidden\][\s\S]*display: none !important/);
});

test("공개 매물 화면은 네이버 개별 매물 50건과 공개 동·층 정보를 표시한다", async () => {
  const [home, properties, card, rawData] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/pages/properties/index.astro"),
    readSource("src/components/NaverListingCard.astro"),
    readSource("src/data/naver-listings.json"),
  ]);
  const data = JSON.parse(rawData);

  assert.equal(data.items.length, 50);
  assert.equal(new Set(data.items.map((item) => item.id)).size, 50);
  assert.equal(data.items[0].title, "휴먼시아2단지 202동");
  assert.equal(data.items[0].floorLabel, "2/22층");
  assert.ok(data.items.every((item) => item.url === `https://fin.land.naver.com/articles/${item.id}`));
  assert.match(home, /naverListings\.slice\(0, 8\)/);
  assert.match(properties, /naverListings\.map/);
  assert.match(card, /target="_blank"/);
  assert.match(card, /listing\.floorLabel/);
});
