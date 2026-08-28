import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const INDEXNOW_ORIGIN = "https://leaderscityhappy.com";
export const INDEXNOW_ENDPOINT = "https://searchadvisor.naver.com/indexnow";
export const INDEXNOW_KEY = "4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3";
export const INDEXNOW_KEY_LOCATION = `${INDEXNOW_ORIGIN}/${INDEXNOW_KEY}.txt`;

const exactDataRoutes = new Map([
  ["src/data/home-content.json", ["/"]],
  ["src/data/office.json", ["/", "/office/", "/location/"]],
  ["src/data/naver-listings.json", ["/", "/properties/"]],
  ["src/data/faq.json", ["/faq/"]],
  ["src/data/reviews.json", ["/reviews/"]],
  ["src/data/complexes-overview.json", ["/", "/complexes/"]],
]);

function normalizeRepositoryPath(value) {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function decodeXmlText(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'");
}

export function extractSitemapUrls(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => decodeXmlText(match[1].trim()));
}

export function validateIndexNowUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0) throw new Error("IndexNow에 제출할 URL이 없습니다.");
  if (urls.length > 10_000) throw new Error("IndexNow URL은 한 요청에 최대 10,000개까지만 제출할 수 있습니다.");

  const normalized = [];
  const seen = new Set();
  for (const value of urls) {
    const url = new URL(value);
    if (url.origin !== INDEXNOW_ORIGIN) throw new Error(`다른 사이트 URL은 제출할 수 없습니다: ${value}`);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) {
      throw new Error(`IndexNow URL 형식이 올바르지 않습니다: ${value}`);
    }
    if (!seen.has(url.href)) {
      seen.add(url.href);
      normalized.push(url.href);
    }
  }
  return normalized;
}

function addSitemapGroup(paths, sitemapUrls, matcher) {
  for (const value of sitemapUrls) {
    const url = new URL(value, INDEXNOW_ORIGIN);
    if (url.origin === INDEXNOW_ORIGIN && matcher(url.pathname)) paths.add(url.pathname);
  }
}

function routeFromAstroPage(path) {
  if (!path.startsWith("src/pages/") || !path.endsWith(".astro")) return null;
  const relativePath = path.slice("src/pages/".length, -".astro".length);
  if (relativePath === "404" || relativePath.startsWith("admin/")) return null;
  if (relativePath.includes("[")) return "*";
  if (relativePath === "index") return "/";
  return `/${relativePath.replace(/\/index$/u, "")}/`;
}

export function planIndexNowUrls(changedFiles, sitemapUrls) {
  const paths = new Set();
  const allSitemapPaths = () => addSitemapGroup(paths, sitemapUrls, () => true);
  const complexPaths = () => addSitemapGroup(paths, sitemapUrls, (path) => path.startsWith("/complexes/"));
  const propertyPaths = () => addSitemapGroup(paths, sitemapUrls, (path) => path.startsWith("/properties/"));

  for (const value of changedFiles) {
    const path = normalizeRepositoryPath(value);
    if (!path) continue;

    const exactRoutes = exactDataRoutes.get(path);
    if (exactRoutes) {
      for (const route of exactRoutes) paths.add(route);
      continue;
    }
    if (path === "src/data/complexes.json") {
      paths.add("/");
      paths.add("/complexes/");
      complexPaths();
      continue;
    }
    if (path === "src/data/listings.json") {
      paths.add("/properties/");
      propertyPaths();
      continue;
    }
    if (path === "src/data/external-links.json") {
      for (const route of ["/", "/contents/", "/blog/", "/youtube/", "/complexes/"]) paths.add(route);
      complexPaths();
      continue;
    }
    if (path.startsWith("src/data/")) {
      allSitemapPaths();
      continue;
    }

    const pageRoute = routeFromAstroPage(path);
    if (pageRoute === "*") {
      allSitemapPaths();
      continue;
    }
    if (pageRoute) {
      paths.add(pageRoute);
      continue;
    }

    if (
      path === "astro.config.mjs"
      || path.startsWith("src/components/")
      || path.startsWith("src/layouts/")
      || path.startsWith("src/lib/")
      || path.startsWith("src/styles/")
      || path.startsWith("public/images/")
    ) {
      allSitemapPaths();
    }
  }

  const urls = [...paths].map((path) => new URL(path, INDEXNOW_ORIGIN).href);
  return urls.length > 0 ? validateIndexNowUrls(urls).sort() : [];
}

async function wait(milliseconds) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

export async function submitIndexNowUrls(urls, {
  fetcher = globalThis.fetch,
  attempts = 3,
  sleep = wait,
  logger = console,
} = {}) {
  const urlList = validateIndexNowUrls(urls);
  const body = {
    host: new URL(INDEXNOW_ORIGIN).host,
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList,
  };

  let lastFailure = "응답 없음";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetcher(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 200 || response.status === 202) {
        logger.log(`Naver IndexNow 제출 완료: HTTP ${response.status}, URL ${urlList.length}개`);
        return { status: response.status, urlList };
      }

      const detail = (await response.text()).trim().slice(0, 300);
      lastFailure = `HTTP ${response.status}${detail ? ` ${detail}` : ""}`;
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) await sleep(attempt * 2_000);
  }
  throw new Error(`Naver IndexNow 제출 실패: ${lastFailure}`);
}

export async function verifyPublishedIndexNowKey({ fetcher = globalThis.fetch } = {}) {
  const response = await fetcher(INDEXNOW_KEY_LOCATION, {
    headers: { "Cache-Control": "no-cache", Accept: "text/plain" },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`공개 IndexNow 키 확인 실패: HTTP ${response.status}`);
  if ((await response.text()).trim() !== INDEXNOW_KEY) throw new Error("공개 IndexNow 키 파일 내용이 일치하지 않습니다.");
  return true;
}

function parseOptions(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("모든 옵션은 --이름 값 형식이어야 합니다.");
    options[key.slice(2)] = value;
  }
  return options;
}

async function readLines(path) {
  return (await readFile(resolve(path), "utf8")).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const options = parseOptions(values);
  if (command === "plan") {
    if (!options["changed-files"] || !options.sitemap || !options.output) {
      throw new Error("plan 사용법: --changed-files <파일> --sitemap <파일> --output <파일>");
    }
    const [changedFiles, sitemap] = await Promise.all([
      readLines(options["changed-files"]),
      readFile(resolve(options.sitemap), "utf8"),
    ]);
    const urls = planIndexNowUrls(changedFiles, extractSitemapUrls(sitemap));
    await writeFile(resolve(options.output), urls.length > 0 ? `${urls.join("\n")}\n` : "", "utf8");
    console.log(`IndexNow 제출 계획: URL ${urls.length}개`);
    return;
  }
  if (command === "verify-key") {
    await verifyPublishedIndexNowKey();
    console.log(`공개 IndexNow 키 확인 완료: ${INDEXNOW_KEY_LOCATION}`);
    return;
  }
  if (command === "submit") {
    if (!options["urls-file"]) throw new Error("submit 사용법: --urls-file <파일>");
    await submitIndexNowUrls(await readLines(options["urls-file"]));
    return;
  }
  throw new Error("사용법: node scripts/indexnow.mjs <plan|verify-key|submit> [옵션]");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
