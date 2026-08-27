import { readFile, readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

function assertStructuredData(html, path) {
  const scripts = html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gu);
  let count = 0;
  for (const match of scripts) {
    try {
      JSON.parse(match[1]);
      count += 1;
    } catch (error) {
      throw new Error(`${path}: JSON-LD를 파싱할 수 없습니다. ${error.message}`);
    }
  }
  return count;
}

export function isSearchVerificationFile(path, html) {
  const match = /^naver[a-f0-9]{32}\.html$/u.exec(path);
  return Boolean(match && html.trim() === `naver-site-verification: ${match[0]}`);
}

export async function assertProductionBuild({ distDir = "dist" } = {}) {
  const absoluteDist = resolve(distDir);
  const [robots, sitemapIndex, sitemap, markerRaw, headers] = await Promise.all([
    readFile(join(absoluteDist, "robots.txt"), "utf8"),
    readFile(join(absoluteDist, "sitemap-index.xml"), "utf8"),
    readFile(join(absoluteDist, "sitemap-0.xml"), "utf8"),
    readFile(join(absoluteDist, "deployment-marker.json"), "utf8"),
    readFile(join(absoluteDist, "_headers"), "utf8"),
  ]);

  assert(robots.includes("Allow: /"), "robots.txt: Production 공개 허용 규칙이 없습니다.");
  assert(!/^Disallow:\s*\/\s*$/gmu.test(robots), "robots.txt: Production 전체 차단 규칙이 남아 있습니다.");
  assert(robots.includes("Disallow: /admin/"), "robots.txt: 관리자 차단 규칙이 없습니다.");
  assert(robots.includes("Disallow: /api/admin/"), "robots.txt: 관리자 API 차단 규칙이 없습니다.");
  assert(robots.includes(`Sitemap: ${PRODUCTION_ORIGIN}/sitemap-index.xml`), "robots.txt: Production sitemap URL이 다릅니다.");
  assert(sitemapIndex.includes(`${PRODUCTION_ORIGIN}/sitemap-0.xml`), "sitemap index가 Production origin을 사용하지 않습니다.");
  assert(!sitemap.includes("/admin/"), "sitemap에 관리자 URL이 포함되었습니다.");
  assert(!sitemap.includes("http://leaderscityhappy.com"), "sitemap에 HTTP URL이 포함되었습니다.");

  const marker = JSON.parse(markerRaw);
  assert(marker.schemaVersion === 1 && marker.algorithm === "sha256", "deployment marker 형식이 올바르지 않습니다.");
  for (const scope of ["bank", "external", "automation"]) {
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
    const pageStructuredDataCount = assertStructuredData(html, path);
    structuredDataCount += pageStructuredDataCount;
    if (path === "index.html") assert(pageStructuredDataCount > 0, "index.html: 홈페이지 JSON-LD가 없습니다.");
    if (path.startsWith("admin/")) {
      assert(html.includes('name="robots" content="noindex,nofollow,noarchive"'), `${path}: 관리자 noindex가 없습니다.`);
      assert(!html.includes('rel="canonical"'), `${path}: 관리자 페이지에 canonical이 포함되었습니다.`);
      continue;
    }
    if (path === "404.html") continue;
    assert(html.includes('name="robots" content="index,follow"'), `${path}: Production index,follow가 없습니다.`);
    assert(html.includes(`rel="canonical" href="${PRODUCTION_ORIGIN}/`), `${path}: Production canonical이 없거나 origin이 다릅니다.`);
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
