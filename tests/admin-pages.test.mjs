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
