import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BLOG_THUMBNAIL_HOSTS,
  NAVER_BLOG_ID,
  YOUTUBE_CHANNEL_ID,
  YOUTUBE_THUMBNAIL_HOSTS,
  assertNaverBlogId,
  assertYouTubeChannelId,
  buildExternalContentItem,
  mergeExternalContentsPreservingOrder,
  parseNaverBlogFeed,
  parseYouTubeFeed,
  planNewExternalContent,
  shouldRefreshKeepalive,
  validateMergedExternalContents,
} from "./sync/external-content.mjs";
import { ExternalSyncSourceUnavailableError, ExternalSyncTrustError } from "./sync/errors.mjs";
import { fetchXml, prepareWebpThumbnail } from "./sync/http.mjs";

const BLOG_FEED_HOSTS = new Set(["rss.blog.naver.com"]);
const YOUTUBE_FEED_HOSTS = new Set(["www.youtube.com"]);
const EXTERNAL_LINKS_PATH = join("src", "data", "external-links.json");
const HEALTH_PATH = join(".github", "automation-health.json");
const YOUTUBE_RETRYABLE_STATUSES = new Set([404]);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path, label) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label}을 읽지 못했습니다: ${error.message}`);
  }
  try {
    return { raw, value: JSON.parse(raw) };
  } catch {
    throw new Error(`${label}이 올바른 JSON이 아닙니다.`);
  }
}

function temporaryPath(path) {
  return `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

async function writeTextAtomically(path, value) {
  const temporary = temporaryPath(path);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function writeContentAtomically(contentPath, content, assets) {
  const temporaryContent = temporaryPath(contentPath);
  const temporaryAssets = [];
  const createdAssets = [];
  try {
    await writeFile(temporaryContent, content, { encoding: "utf8", flag: "wx" });
    for (const asset of assets) {
      await mkdir(dirname(asset.path), { recursive: true });
      const temporary = temporaryPath(asset.path);
      await writeFile(temporary, asset.buffer, { flag: "wx" });
      temporaryAssets.push({ temporary, final: asset.path });
    }
    for (const asset of temporaryAssets) {
      if (await pathExists(asset.final)) throw new ExternalSyncTrustError(`썸네일 출력 경로가 이미 존재합니다: ${asset.final}`);
      await rename(asset.temporary, asset.final);
      createdAssets.push(asset.final);
    }
    await rename(temporaryContent, contentPath);
  } catch (error) {
    await Promise.all(createdAssets.map((path) => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(temporaryContent, { force: true });
    await Promise.all(temporaryAssets.map(({ temporary }) => rm(temporary, { force: true })));
  }
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

function thumbnailDetails(candidate, rootDir) {
  const directory = candidate.type === "blog" ? "blog" : "youtube";
  const source = `/images/${directory}/${candidate.sourceId}.webp`;
  return {
    source,
    path: join(rootDir, "public", "images", directory, `${candidate.sourceId}.webp`),
    alt: candidate.type === "blog"
      ? `${candidate.title} 블로그 글 썸네일`
      : `${candidate.title} ${candidate.youtubeFormat === "short" ? "YouTube Shorts" : "유튜브 영상"} 썸네일`,
    allowedHosts: candidate.type === "blog" ? BLOG_THUMBNAIL_HOSTS : YOUTUBE_THUMBNAIL_HOSTS,
  };
}

async function prepareCandidate(candidate, { rootDir, fetcher, fetchAttempts, warnings }) {
  if (!candidate.thumbnailUrl) return { item: buildExternalContentItem(candidate, null), asset: null };
  const details = thumbnailDetails(candidate, rootDir);
  if (await pathExists(details.path)) throw new ExternalSyncTrustError(`신규 콘텐츠의 썸네일 경로가 이미 존재합니다: ${details.source}`);
  try {
    const buffer = await prepareWebpThumbnail(candidate.thumbnailUrl, {
      allowedHosts: details.allowedHosts,
      fetcher,
      attempts: fetchAttempts,
      label: `${candidate.id} 썸네일`,
    });
    return {
      item: buildExternalContentItem(candidate, { src: details.source, alt: details.alt }),
      asset: { path: details.path, buffer },
    };
  } catch (error) {
    if (error instanceof ExternalSyncTrustError) throw error;
    warnings.push(`${candidate.id}: 썸네일을 준비하지 못해 thumbnail:null로 추가합니다. (${error.message})`);
    return { item: buildExternalContentItem(candidate, null), asset: null };
  }
}

function currentDate(now) {
  return now.toISOString().slice(0, 10);
}

async function appendGitHubSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "## 외부 콘텐츠 동기화",
    "",
    `- Blog source: ${result.sourceStatus.blog}`,
    `- YouTube source: ${result.sourceStatus.youtube}`,
    `- Blog new: ${result.blogNew}`,
    `- YouTube new: ${result.youtubeNew}`,
    `- Assets: ${result.assetCount}`,
    `- Keepalive: ${result.keepaliveChanged ? "refresh" : "unchanged"}`,
  ];
  if (result.warnings.length > 0) lines.push("", "### 경고", ...result.warnings.map((warning) => `- ${warning}`));
  await writeFile(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

async function fetchSourceXml(value, options) {
  try {
    return { status: "available", xml: await fetchXml(value, options), warning: null };
  } catch (error) {
    if (!(error instanceof ExternalSyncSourceUnavailableError)) throw error;
    return {
      status: "skipped",
      xml: null,
      warning: `${options.label}를 일시적으로 조회하지 못해 이번 실행에서 건너뜁니다. (${error.message})`,
    };
  }
}

export async function runExternalContentSync({
  rootDir = process.cwd(),
  dryRun = false,
  fetcher = globalThis.fetch,
  now = new Date(),
  youtubeChannelId = process.env.YOUTUBE_CHANNEL_ID,
  blogId = NAVER_BLOG_ID,
  fetchAttempts = 3,
  logger = console,
} = {}) {
  assertNaverBlogId(blogId);
  assertYouTubeChannelId(youtubeChannelId, YOUTUBE_CHANNEL_ID);
  const absoluteRoot = resolve(rootDir);
  const contentPath = join(absoluteRoot, EXTERNAL_LINKS_PATH);
  const healthPath = join(absoluteRoot, HEALTH_PATH);
  const [{ raw: currentRaw, value: current }, { value: health }, { value: office }] = await Promise.all([
    readJson(contentPath, EXTERNAL_LINKS_PATH),
    readJson(healthPath, HEALTH_PATH),
    readJson(join(absoluteRoot, "src", "data", "office.json"), "src/data/office.json"),
  ]);

  const [blogSource, youtubeSource] = await Promise.all([
    fetchSourceXml(`https://rss.blog.naver.com/${blogId}.xml`, {
      allowedHosts: BLOG_FEED_HOSTS,
      fetcher,
      attempts: fetchAttempts,
      label: "네이버 블로그 RSS",
    }),
    fetchSourceXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(youtubeChannelId ?? "")}`, {
      allowedHosts: YOUTUBE_FEED_HOSTS,
      fetcher,
      attempts: fetchAttempts,
      additionalRetryableStatuses: YOUTUBE_RETRYABLE_STATUSES,
      label: "YouTube Atom RSS",
    }),
  ]);

  const unavailableSources = [blogSource, youtubeSource].filter(({ status }) => status === "skipped");
  if (unavailableSources.length === 2) {
    throw new ExternalSyncSourceUnavailableError(
      `네이버 블로그 RSS와 YouTube Atom RSS를 모두 조회하지 못했습니다. ${unavailableSources.map(({ warning }) => warning).join(" ")}`,
      { attempts: fetchAttempts },
    );
  }

  const blogCandidates = blogSource.xml === null ? [] : parseNaverBlogFeed(blogSource.xml, { blogId });
  const youtubeCandidates = youtubeSource.xml === null ? [] : parseYouTubeFeed(youtubeSource.xml, { channelId: youtubeChannelId });
  const newCandidates = planNewExternalContent(current, [...blogCandidates, ...youtubeCandidates], { blogId });
  const warnings = [blogSource.warning, youtubeSource.warning].filter(Boolean);
  const prepared = await mapWithConcurrency(newCandidates, 4, (candidate) => prepareCandidate(candidate, {
    rootDir: absoluteRoot,
    fetcher,
    fetchAttempts,
    warnings,
  }));
  const newItems = prepared.map(({ item }) => item);
  const assets = prepared.map(({ asset }) => asset).filter(Boolean);
  const nextItems = newItems.length > 0 ? mergeExternalContentsPreservingOrder(current, newItems) : current;
  validateMergedExternalContents(nextItems, { office });
  const nextRaw = newItems.length > 0 ? `${JSON.stringify(nextItems, null, 2)}\n` : currentRaw;
  const contentChanged = nextRaw !== currentRaw;

  let keepaliveChanged = false;
  let nextHealthRaw = null;
  if (!contentChanged && shouldRefreshKeepalive(health?.lastKeepaliveAt, now)) {
    keepaliveChanged = true;
    nextHealthRaw = `${JSON.stringify({ lastKeepaliveAt: currentDate(now) }, null, 2)}\n`;
  }

  if (!dryRun) {
    if (contentChanged) await writeContentAtomically(contentPath, nextRaw, assets);
    else if (keepaliveChanged) await writeTextAtomically(healthPath, nextHealthRaw);
  }

  const result = {
    sourceStatus: {
      blog: blogSource.status,
      youtube: youtubeSource.status,
    },
    blogNew: newCandidates.filter((candidate) => candidate.type === "blog").length,
    youtubeNew: newCandidates.filter((candidate) => candidate.type === "youtube").length,
    assetCount: assets.length,
    contentChanged,
    keepaliveChanged,
    dryRun,
    warnings,
  };
  logger.log(`Blog source: ${result.sourceStatus.blog}`);
  logger.log(`YouTube source: ${result.sourceStatus.youtube}`);
  logger.log(`Blog new: ${result.blogNew}`);
  logger.log(`YouTube new: ${result.youtubeNew}`);
  logger.log(`${dryRun ? "Would add" : "Added"} assets: ${result.assetCount}`);
  logger.log(`Keepalive: ${keepaliveChanged ? (dryRun ? "would refresh" : "refreshed") : "unchanged"}`);
  for (const warning of warnings) logger.warn(`${process.env.GITHUB_ACTIONS === "true" ? "::warning::" : "Warning: "}${warning}`);
  if (dryRun) logger.log("No files changed");
  else if (!contentChanged && !keepaliveChanged) logger.log("No changes");
  await appendGitHubSummary(result);
  return result;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowedArgs = new Set(["--dry-run"]);
  const unknown = [...args].filter((argument) => !allowedArgs.has(argument));
  if (unknown.length > 0) throw new Error(`지원하지 않는 옵션입니다: ${unknown.join(", ")}`);
  await runExternalContentSync({ dryRun: args.has("--dry-run") });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`외부 콘텐츠 동기화 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
