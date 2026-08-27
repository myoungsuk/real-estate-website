import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { getResponsivePublicImageSrcSet } from "../src/lib/responsive-images.ts";

const root = new URL("../", import.meta.url);
const readSource = (relativePath) => readFile(new URL(relativePath, root), "utf8");

test("낮은 화면의 모바일 메뉴와 잘리지 않는 고대비 포커스를 유지한다", async () => {
  const styles = await readSource("src/styles/global.css");
  assert.match(styles, /--focus-ring: #075b74/);
  assert.match(styles, /\.site-nav \{[^}]*max-height: calc\(100dvh - 74px\)[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/);
  assert.match(styles, /@media \(min-width: 1024px\)[\s\S]*\.site-nav \{ max-height: calc\(100dvh - 82px\); \}/);
  assert.match(styles, /\.faq-list summary:focus-visible \{ outline-offset: -4px; \}/);
  const focusRing = /:focus-visible \{ outline: (\d+)px solid [^;]+; outline-offset: (\d+)px; \}/u.exec(styles);
  const filterPadding = /\.content-filter \{[^}]*padding: (\d+)px (\d+)px (\d+)px;[^}]*overflow-x: auto/u.exec(styles);
  const paginationPadding = /\.content-pagination__pages \{[^}]*padding: (\d+)px;[^}]*overflow-x: auto/u.exec(styles);
  assert.ok(focusRing && filterPadding && paginationPadding);
  const requiredInset = Number(focusRing[1]) + Number(focusRing[2]);
  assert.ok(Number(filterPadding[1]) >= requiredInset);
  assert.ok(Number(filterPadding[2]) >= requiredInset);
  assert.ok(Number(filterPadding[3]) >= requiredInset);
  assert.ok(Number(paginationPadding[1]) >= requiredInset);
});

test("홈은 최신 콘텐츠만 렌더하고 페이저는 정확한 상태와 활성 페이지 노출을 제공한다", async () => {
  const [home, contentPager, listingPager] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/components/NaverListingPager.astro"),
  ]);
  assert.match(home, /publishedBlogContents\.slice\(0, 9\)/);
  assert.match(home, /publishedYoutubeVideoContents\.slice\(0, 6\)/);
  assert.match(home, /items=\{homeBlogContents\}[^>]*paginate=\{false\}/);
  assert.match(home, /items=\{homeYoutubeContents\}[^>]*paginate=\{false\}/);
  assert.match(contentPager, /hidden=\{!initiallyVisibleIds\.has\(item\.id\)\}/);
  assert.match(contentPager, /firstVisible[\s\S]*lastVisible[\s\S]*visibleCount/);
  assert.match(contentPager, /pageList\.scrollTo/);
  assert.match(contentPager, /const prefersReducedMotion = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(contentPager, /behavior: moveToGrid && !prefersReducedMotion \? "smooth" : "auto"/);
  assert.match(contentPager, /scrollIntoView\(\{ behavior: prefersReducedMotion \? "auto" : "smooth"/);
  assert.match(listingPager, /data-listing-status/);
  assert.match(listingPager, /매물 총 \$\{orderedItems\.length\}건/);
  assert.match(listingPager, /const prefersReducedMotion = window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/);
  assert.match(listingPager, /behavior: moveToGrid && !prefersReducedMotion \? "smooth" : "auto"/);
  assert.match(listingPager, /scrollIntoView\(\{ behavior: prefersReducedMotion \? "auto" : "smooth"/);
  const styles = await readSource("src/styles/global.css");
  assert.match(styles, /\.content-pagination button\[hidden\] \{ display: none; \}/);
  assert.match(styles, /\.content-pagination\[hidden\] \{ display: none !important; \}/);
});

test("단지 상세의 매물 링크는 공개 매물 화면의 단지 필터와 연결된다", async () => {
  const [detail, properties, card] = await Promise.all([
    readSource("src/pages/complexes/[slug].astro"),
    readSource("src/pages/properties/index.astro"),
    readSource("src/components/NaverListingCard.astro"),
  ]);
  assert.match(detail, /\/properties\/\?complex=\$\{complex\.slug\}/);
  assert.doesNotMatch(detail, /\/properties\/\?area=/);
  assert.match(properties, /name="complex"/);
  assert.match(properties, /next\.set\("complex", complex\.value\)/);
  assert.match(properties, /card\.dataset\.listingTitle\?\.startsWith\(complexName\)/);
  assert.match(card, /data-listing-title=\{listing\.title\}/);
});

test("반응형 지역 이미지, Astro 캐시 경로, 404 noindex와 favicon을 제공한다", async () => {
  const [home, complexIndex, complexDetail, layout, notFound, headers, favicon] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/pages/complexes/index.astro"),
    readSource("src/pages/complexes/[slug].astro"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/pages/404.astro"),
    readSource("public/_headers"),
    readFile(new URL("public/favicon.ico", root)),
  ]);
  assert.match(home, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(complexIndex, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(complexDetail, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(headers, /\/_astro\/\*[\s\S]*max-age=31536000, immutable/);
  assert.match(headers, /\/deployment-marker\.json[\s\S]*Cache-Control: no-store, max-age=0/);
  assert.doesNotMatch(headers, /\/assets\/\*/);
  assert.match(layout, /Astro\.site && !noindex/);
  assert.match(layout, /href="\/favicon\.ico"/);
  assert.match(notFound, /<BaseLayout \{title\} \{description\} noindex>/);
  assert.equal(favicon.readUInt16LE(2), 1);
  assert.equal(favicon.readUInt16LE(4), 4);
  assert.equal(getResponsivePublicImageSrcSet("/images/content/office/admin-upload.webp"), undefined);

  for (const name of ["leaders-city-4-landscape", "leaders-city-5-entrance", "leaders-city-5-landscape"]) {
    const src = `/images/area/${name}.webp`;
    assert.equal(
      getResponsivePublicImageSrcSet(src),
      `/images/area/${name}-640.webp 640w, /images/area/${name}-1200.webp 1200w, ${src} 2000w`,
    );
    const [small, medium, original] = await Promise.all([
      stat(new URL(`public/images/area/${name}-640.webp`, root)),
      stat(new URL(`public/images/area/${name}-1200.webp`, root)),
      stat(new URL(`public/images/area/${name}.webp`, root)),
    ]);
    assert.ok(small.size < medium.size);
    assert.ok(medium.size < original.size);
  }
});
