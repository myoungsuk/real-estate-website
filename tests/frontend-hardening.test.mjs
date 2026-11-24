import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import vm from "node:vm";
import { getResponsivePublicImageSrcSet } from "../src/lib/responsive-images.ts";
import { GOOGLE_TAG_ID, createGoogleTagLoader } from "../src/lib/google-tag.mjs";

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

test("단지 목록·상세는 첫 화면 사진을 먼저 받고 전역 CSS를 HTML에 넣어 사진 표시를 늦추지 않는다", async () => {
  const [complexIndex, complexDetail] = await Promise.all([
    readSource("src/pages/complexes/index.astro"),
    readSource("src/pages/complexes/[slug].astro"),
  ]);
  for (const page of [complexIndex, complexDetail]) assert.match(page, /<BaseLayout[\s\S]*?inlineGlobalStyles[\s\S]*?>/u);
  assert.match(complexIndex, /loading=\{index === 0 \? "eager" : "lazy"\}/u, "목록 첫 사진만 바로 받고 나머지는 늦게 받음");
  assert.match(complexIndex, /fetchpriority=\{index === 0 \? "high" : "low"\}/u);
  assert.match(complexDetail, /loading="eager"\s+fetchpriority="high"/u, "상세 대표 사진은 바로·높은 우선순위로 받음");
});

test("홈은 최신 콘텐츠만 렌더하고 페이저는 정확한 상태와 활성 페이지 노출을 제공한다", async () => {
  const [home, layout, contentPager, listingPager] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/components/ExternalContentList.astro"),
    readSource("src/components/NaverListingPager.astro"),
  ]);
  assert.match(home, /publishedBlogContents\.slice\(0, 9\)/);
  assert.match(home, /publishedYoutubeVideoContents\.slice\(0, 6\)/);
  assert.match(home, /items=\{homeBlogContents\}[^>]*paginate=\{false\}/);
  assert.match(home, /items=\{homeYoutubeContents\}[^>]*paginate=\{false\}/);
  assert.match(home, /<BaseLayout[\s\S]*inlineGlobalStyles/);
  assert.match(layout, /global\.css\?inline/);
  assert.match(layout, /inlineGlobalStyles[\s\S]*<style is:inline set:html=\{globalStyles\}/);
  assert.match(layout, /<link rel="stylesheet" href=\{globalStylesheet\}/);
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
  assert.match(properties, /matchPublishedComplexByListingTitle/);
  assert.match(properties, /complexSlug=\{matchPublishedComplexByListingTitle\(listing\.title\)\?\.slug \?\? ""\}/);
  assert.match(properties, /buildListingExplorerSearchParams/);
  assert.match(card, /data-listing-title=\{listing\.title\}/);
  assert.match(card, /data-complex=\{complexSlug\}/);
});

test("반응형 지역 이미지, Astro 캐시 경로, 404 noindex와 sitemap 별칭을 제공한다", async () => {
  const [home, complexIndex, complexDetail, layout, compare, astroConfig, productionAssert, notFound, headers, redirects, favicon] = await Promise.all([
    readSource("src/pages/index.astro"),
    readSource("src/pages/complexes/index.astro"),
    readSource("src/pages/complexes/[slug].astro"),
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/pages/properties/compare/index.astro"),
    readSource("astro.config.mjs"),
    readSource("scripts/assert-production-build.mjs"),
    readSource("src/pages/404.astro"),
    readSource("public/_headers"),
    readSource("public/_redirects"),
    readFile(new URL("public/favicon.ico", root)),
  ]);
  assert.match(home, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(complexIndex, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(complexDetail, /srcset=\{getResponsivePublicImageSrcSet/);
  assert.match(headers, /\/_astro\/\*[\s\S]*max-age=31536000, immutable/);
  assert.match(headers, /\/deployment-marker\.json[\s\S]*Cache-Control: no-store, max-age=0/);
  assert.doesNotMatch(headers, /\/assets\/\*/);
  assert.equal(redirects.trim(), "/sitemap.xml /sitemap-index.xml 301");
  assert.match(layout, /canonicalPath \?\? Astro\.url\.pathname/);
  assert.match(layout, /noindexFollow \? "noindex,follow"/);
  assert.match(compare, /canonicalPath="\/properties\/"/);
  assert.match(astroConfig, /pathname !== "\/properties\/compare\/"/);
  assert.match(productionAssert, /properties\/compare\/index\.html/);
  assert.match(productionAssert, /name="robots" content="noindex,follow"/);
  assert.match(productionAssert, /sitemap에 검색 제외 비교 URL/);
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
  assert.equal(
    getResponsivePublicImageSrcSet("/images/area/sinheung-sk-view.webp"),
    "/images/area/sinheung-sk-view-640.webp 640w, /images/area/sinheung-sk-view-1200.webp 1200w, /images/area/sinheung-sk-view.webp 2000w",
  );
});

test("CSP는 Cloudflare Web Analytics와 Google 태그 공식 도메인만 추가 허용한다", async () => {
  const [headers, privacy] = await Promise.all([
    readSource("public/_headers"),
    readSource("src/pages/privacy.astro"),
  ]);
  const csp = /Content-Security-Policy: ([^\r\n]+)/u.exec(headers)?.[1] ?? "";
  const directive = (name) => csp.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name} `));
  assert.equal(
    directive("script-src"),
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://www.googletagmanager.com https://www.googleadservices.com https://www.google.com",
  );
  assert.equal(
    directive("connect-src"),
    "connect-src 'self' https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com https://*.google.co.kr https://*.g.doubleclick.net https://pagead2.googlesyndication.com https://www.googleadservices.com https://ad.doubleclick.net",
  );
  assert.equal(
    directive("img-src"),
    "img-src 'self' data: https://www.googletagmanager.com https://*.google-analytics.com https://*.google.com https://*.google.co.kr https://*.g.doubleclick.net https://www.googleadservices.com https://pagead2.googlesyndication.com",
  );
  assert.equal(directive("frame-src"), "frame-src https://www.youtube-nocookie.com https://www.googletagmanager.com");
  assert.equal(directive("frame-ancestors"), "frame-ancestors 'none'");
  assert.match(privacy, /Cloudflare Web Analytics/);
  assert.match(privacy, /쿠키나 브라우저 저장소를 사용하지 않고/);
  assert.match(privacy, /Google 애널리틱스와 Google 광고\(행태정보\)/);
  assert.match(privacy, /거부 방법/);
  assert.doesNotMatch(privacy, /분석 쿠키도 사용하지 않습니다/);
});

test("처리방침에 계약서 사본 AI 일정 뽑기의 OpenAI 국외 이전·AI 결과 30일 보관이 있다(사용자 승인 2026-11-24 09:23 '이대로 올림')", async () => {
  const privacy = await readSource("src/pages/privacy.astro");
  assert.match(privacy, /중개 업무\(상담 기록, 계약 일정과 할 일 관리, 계약서 사본에서 일정 뽑기, 매출장부 정리, 현장·서류 사진 보관\)/u);
  assert.match(privacy, /<p>AI가 뽑은 일정 결과\(뽑은 값과 근거 글\): 거래에 넣거나 취소한 뒤, 또는 손대지 않은 채 30일이 지나면 지웁니다\./u);
  assert.match(privacy, /<p>이전받는 자: OpenAI OpCo, LLC\(미국\), 연락처: dpo@openai\.com<\/p>/u);
  assert.match(privacy, /AI 학습에 쓰지 않고, 처리하는 동안 약 10분 임시 보관한 뒤 지웁니다\. 다만 남용 감시를 위해 최대 30일 보관할 수 있고/u);
  assert.match(privacy, /사무소가 주민등록번호를 가렸다고 확인한 사본만 보냅니다\./u);
  // 8항 안(9항 앞)에 있어야 국외 이전 항목으로 읽힌다.
  const eighth = privacy.slice(privacy.indexOf("<h2>8. 처리 위탁과 국외 이전</h2>"), privacy.indexOf("<h2>9. "));
  assert.match(eighth, /OpenAI OpCo, LLC/u);
});

test("Google 태그는 공개 레이아웃의 Production 빌드와 운영 도메인에서만 실행된다", async () => {
  const [baseLayout, adminLayout] = await Promise.all([
    readSource("src/layouts/BaseLayout.astro"),
    readSource("src/layouts/AdminLayout.astro"),
  ]);
  assert.equal(GOOGLE_TAG_ID, "G-DFMC9Y1MG2");
  assert.match(baseLayout, /allowIndexing && Astro\.site \? createGoogleTagLoader\(GOOGLE_TAG_ID, new URL\(Astro\.site\)\.hostname\)/);
  assert.match(baseLayout, /<script is:inline set:html=\{googleTagLoader\} \/>/);
  assert.doesNotMatch(adminLayout, /google-tag|googletagmanager|gtag/i);
  assert.throws(() => createGoogleTagLoader("GTM-ABC123", "leaderscityhappy.com"));
  assert.throws(() => createGoogleTagLoader(GOOGLE_TAG_ID, "leaderscityhappy.com\";alert(1);//"));

  const run = (hostname) => {
    const appended = [];
    const context = {
      location: { hostname },
      window: {},
      document: { createElement: () => ({}), head: { appendChild: (element) => appended.push(element) } },
      Date,
      encodeURIComponent,
    };
    vm.runInNewContext(createGoogleTagLoader(GOOGLE_TAG_ID, "leaderscityhappy.com"), context);
    return { appended, dataLayer: context.window.dataLayer };
  };
  for (const hostname of ["localhost", "127.0.0.1", "fix-cloudflare-web-analytics.real-estate-website-dnv.pages.dev", "www.leaderscityhappy.com"]) {
    const result = run(hostname);
    assert.equal(result.appended.length, 0, hostname);
    assert.equal(result.dataLayer, undefined, hostname);
  }
  const production = run("leaderscityhappy.com");
  assert.equal(production.appended.length, 1);
  assert.equal(production.appended[0].async, true);
  assert.equal(production.appended[0].src, "https://www.googletagmanager.com/gtag/js?id=G-DFMC9Y1MG2");
  assert.equal(production.dataLayer.length, 2);
  assert.equal(production.dataLayer[1][0], "config");
  assert.equal(production.dataLayer[1][1], "G-DFMC9Y1MG2");
});
