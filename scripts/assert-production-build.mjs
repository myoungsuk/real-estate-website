import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { INDEXNOW_KEY } from "./indexnow.mjs";
import { ADMIN_RESOURCE_PATHS } from "../src/lib/admin-resource-digest.mjs";

const PRODUCTION_ORIGIN = "https://leaderscityhappy.com";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function collectHtmlFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) await collectHtmlFiles(entryPath, files);
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(entryPath);
  }
  return files;
}

function parseStructuredData(html, path) {
  const scripts = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gu);
  const values = [];
  for (const match of scripts) {
    try {
      values.push(JSON.parse(match[1]));
    } catch (error) {
      throw new Error(`${path}: JSON-LD를 파싱할 수 없습니다. ${error.message}`);
    }
  }
  return values;
}

export function isSearchVerificationFile(path, html) {
  const match = /^naver[a-f0-9]{32}\.html$/u.exec(path);
  return Boolean(match && html.trim() === `naver-site-verification: ${match[0]}`);
}

export async function assertProductionBuild({ distDir = "dist" } = {}) {
  const absoluteDist = resolve(distDir);
  const [robots, sitemapIndex, sitemap, redirects, markerRaw, headers, indexNowKey] = await Promise.all([
    readFile(join(absoluteDist, "robots.txt"), "utf8"),
    readFile(join(absoluteDist, "sitemap-index.xml"), "utf8"),
    readFile(join(absoluteDist, "sitemap-0.xml"), "utf8"),
    readFile(join(absoluteDist, "_redirects"), "utf8"),
    readFile(join(absoluteDist, "deployment-marker.json"), "utf8"),
    readFile(join(absoluteDist, "_headers"), "utf8"),
    readFile(join(absoluteDist, `${INDEXNOW_KEY}.txt`), "utf8"),
  ]);

  assert(robots.includes("Allow: /"), "robots.txt: Production 공개 허용 규칙이 없습니다.");
  assert(!/^Disallow:\s*\/\s*$/gmu.test(robots), "robots.txt: Production 전체 차단 규칙이 남아 있습니다.");
  assert(robots.includes("Disallow: /admin/"), "robots.txt: 관리자 차단 규칙이 없습니다.");
  assert(robots.includes("Disallow: /api/admin/"), "robots.txt: 관리자 API 차단 규칙이 없습니다.");
  assert(robots.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap-index.xml`), "robots.txt: Production sitemap URL이 다릅니다.");
  assert(sitemapIndex.includes(`${PRODUCTION_ORIGIN}/sitemap-0.xml`), "sitemap index가 Production origin을 사용하지 않습니다.");
  assert(!sitemap.includes("/admin/"), "sitemap에 관리자 URL이 포함되었습니다.");
  assert(!sitemap.includes("/properties/compare/"), "sitemap에 검색 제외 비교 URL이 포함되었습니다.");
  assert(!sitemap.includes("http://leaderscityhappy.com"), "sitemap에 HTTP URL이 포함되었습니다.");
  assert(
    redirects.trim() === "/sitemap.xml /sitemap-index.xml 301",
    "_redirects: sitemap 별칭이 공식 sitemap index로만 이동하지 않습니다.",
  );
  assert(indexNowKey.trim() === INDEXNOW_KEY, "Production IndexNow 공개 키 파일이 올바르지 않습니다.");

  const marker = JSON.parse(markerRaw);
  assert(marker.schemaVersion === 2 && marker.algorithm === "sha256", "deployment marker v2 형식이 올바르지 않습니다.");
  assert(
    ["workers-builds", "github-actions", "local"].includes(marker.source?.provider),
    "deployment marker의 build 출처가 올바르지 않습니다.",
  );
  assert(
    marker.source?.commit === null || /^[a-f0-9]{40}$/u.test(marker.source.commit),
    "deployment marker의 source commit이 올바르지 않습니다.",
  );
  for (const resource of Object.keys(ADMIN_RESOURCE_PATHS)) {
    assert(/^[a-f0-9]{64}$/u.test(marker.resources?.[resource] ?? ""), `deployment marker의 ${resource} digest가 올바르지 않습니다.`);
  }
  for (const scope of ["search", "bank", "external", "automation"]) {
    assert(/^[a-f0-9]{64}$/u.test(marker.scopes?.[scope] ?? ""), `deployment marker의 ${scope} hash가 올바르지 않습니다.`);
  }
  assert(
    /\/deployment-marker\.json[\s\S]*?Cache-Control: no-store, max-age=0/u.test(headers),
    "_headers: deployment marker의 no-store 규칙이 없습니다.",
  );

  const htmlFiles = await collectHtmlFiles(absoluteDist);
  assert(htmlFiles.length > 0, "Production HTML 산출물이 없습니다.");
  let structuredDataCount = 0;
  for (const htmlPath of htmlFiles) {
    const path = relative(absoluteDist, htmlPath).replaceAll("\\", "/");
    const html = await readFile(htmlPath, "utf8");
    if (isSearchVerificationFile(path, html)) continue;
    const pageStructuredData = parseStructuredData(html, path);
    const pageStructuredDataCount = pageStructuredData.length;
    structuredDataCount += pageStructuredDataCount;
    if (path === "index.html") {
      assert(pageStructuredDataCount > 0, "index.html: 홈페이지 JSON-LD가 없습니다.");
      const graph = pageStructuredData.flatMap((value) => value?.["@graph"] ?? []);
      const website = graph.find((node) => node?.["@type"] === "WebSite");
      const business = graph.find((node) => Array.isArray(node?.["@type"]) && node["@type"].includes("RealEstateAgent"));
      assert(website?.["@id"] === `${PRODUCTION_ORIGIN}/#website`, "index.html: WebSite 고정 ID가 올바르지 않습니다.");
      assert(business?.["@id"] === `${PRODUCTION_ORIGIN}/#real-estate-agent`, "index.html: 중개사무소 고정 ID가 올바르지 않습니다.");
      assert(website?.publisher?.["@id"] === business?.["@id"], "index.html: WebSite와 중개사무소가 연결되지 않았습니다.");
      assert(business?.sameAs?.includes("https://map.naver.com/p/entry/place/1135476130"), "index.html: 네이버 플레이스 동일 사업자 링크가 없습니다.");
    }
    if (path.startsWith("admin/")) {
      assert(html.includes('name="robots" content="noindex,nofollow,noarchive"'), `${path}: 관리자 noindex가 없습니다.`);
      assert(!html.includes('rel="canonical"'), `${path}: 관리자 페이지에 canonical이 포함되었습니다.`);
      continue;
    }
    if (path === "404.html") continue;
    if (path === "properties/compare/index.html") {
      assert(html.includes('name="robots" content="noindex,follow"'), `${path}: 비교 페이지 noindex,follow가 없습니다.`);
      assert(
        html.includes(`rel="canonical" href="${PRODUCTION_ORIGIN}/properties/"`),
        `${path}: 비교 페이지 canonical이 매물 목록을 가리키지 않습니다.`,
      );
      assert(html.includes('"@type":"BreadcrumbList"'), `${path}: BreadcrumbList JSON-LD가 없습니다.`);
      continue;
    }
    assert(html.includes('name="robots" content="index,follow"'), `${path}: Production index,follow가 없습니다.`);
    assert(html.includes(`rel="canonical" href="${PRODUCTION_ORIGIN}/`), `${path}: Production canonical이 없거나 origin이 다릅니다.`);
    if (path !== "index.html") assert(html.includes('"@type":"BreadcrumbList"'), `${path}: BreadcrumbList JSON-LD가 없습니다.`);
  }
  assert(structuredDataCount > 0, "Production 공개 HTML에 JSON-LD가 없습니다.");
  return { htmlCount: htmlFiles.length, structuredDataCount };
}

async function main() {
  const result = await assertProductionBuild();
  console.log(`Production SEO build assertion passed: ${result.htmlCount} HTML files, ${result.structuredDataCount} JSON-LD blocks`);
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Production SEO build assertion failed: ${error.message}`);
    process.exitCode = 1;
  });
}
