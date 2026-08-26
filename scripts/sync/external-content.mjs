import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";
import { validateExternalLinks } from "../content-validation.mjs";
import { ExternalSyncTrustError } from "./errors.mjs";

export const NAVER_BLOG_ID = "p5468300";
export const BLOG_THUMBNAIL_HOSTS = new Set([
  "blogfiles.pstatic.net",
  "blogthumb.pstatic.net",
  "postfiles.pstatic.net",
  "ssl.pstatic.net",
]);
export const YOUTUBE_THUMBNAIL_HOSTS = new Set([
  "i.ytimg.com",
  "i1.ytimg.com",
  "i2.ytimg.com",
  "i3.ytimg.com",
  "i4.ytimg.com",
]);

const NAVER_BLOG_HOSTS = new Set(["blog.naver.com", "m.blog.naver.com"]);
const YOUTUBE_PAGE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be"]);
const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/u;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/u;
const NAVER_LOG_NO_PATTERN = /^\d{10,20}$/u;
const MAX_TITLE_LENGTH = 300;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  maxNestedTags: 64,
  processEntities: {
    enabled: true,
    maxEntitySize: 1024,
    maxExpansionDepth: 8,
    maxTotalExpansions: 1000,
    maxExpandedLength: 1024 * 1024,
    maxEntityCount: 100,
  },
  isArray: (tagName, path) => [
    "rss.channel.item",
    "feed.entry",
    "feed.link",
    "feed.entry.link",
    "feed.entry.media:group.media:thumbnail",
  ].includes(path) || (tagName === "media:thumbnail" && path.endsWith("media:thumbnail")),
});

function trustError(message) {
  return new ExternalSyncTrustError(message);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    if (typeof value["#text"] === "string") return value["#text"].trim();
    if (typeof value["#cdata"] === "string") return value["#cdata"].trim();
  }
  return "";
}

function parseXml(xml, label) {
  if (typeof xml !== "string" || xml.trim() === "") throw trustError(`${label}: XML 응답이 비어 있습니다.`);
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw trustError(`${label}: DTD와 사용자 정의 엔티티는 허용하지 않습니다.`);
  try {
    const validation = SyntaxValidator.validate(xml, { allowBooleanAttributes: false });
    if (validation !== true) throw trustError(`${label}: 올바른 XML이 아닙니다.`);
  } catch {
    throw trustError(`${label}: 올바른 XML이 아닙니다.`);
  }
  try {
    return xmlParser.parse(xml);
  } catch {
    throw trustError(`${label}: XML을 파싱하지 못했습니다.`);
  }
}

function normalizeTitle(value, label) {
  const title = textValue(value).replace(/\s+/gu, " ").trim();
  if (!title) throw trustError(`${label}: 제목이 비어 있습니다.`);
  if (title.length > MAX_TITLE_LENGTH) throw trustError(`${label}: 제목이 너무 깁니다.`);
  return title;
}

function parseUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw trustError(`${label}: 올바른 URL이 아닙니다.`);
  }
}

function assertHttpsHost(url, allowedHosts, label) {
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw trustError(`${label}: 허용된 HTTPS 호스트가 아닙니다.`);
  }
}

function assertValidDate(value, label) {
  const timestamp = Date.parse(value);
  if (!value || !Number.isFinite(timestamp)) throw trustError(`${label}: 게시 시각이 올바르지 않습니다.`);
  return new Date(timestamp);
}

function formatSeoulDate(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function atomDate(value, label) {
  const raw = textValue(value);
  assertValidDate(raw, label);
  if (!/^\d{4}-\d{2}-\d{2}T/u.test(raw)) throw trustError(`${label}: ISO 8601 시각이 필요합니다.`);
  return raw.slice(0, 10);
}

function naverDate(value, label) {
  return formatSeoulDate(assertValidDate(textValue(value), label));
}

function decodeHtmlAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function firstImageUrl(description) {
  const html = textValue(description);
  const match = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/iu);
  return match ? decodeHtmlAttribute(match[1].trim()) : null;
}

function assertThumbnailUrl(value, type, label) {
  if (!value) return null;
  const url = parseUrl(value, label);
  assertHttpsHost(url, type === "blog" ? BLOG_THUMBNAIL_HOSTS : YOUTUBE_THUMBNAIL_HOSTS, label);
  url.hash = "";
  return url.toString();
}

function naverBlogIdFromUrl(url) {
  const segments = url.pathname.split("/").filter(Boolean);
  return url.searchParams.get("blogId") ?? segments[0] ?? "";
}

export function parseNaverPostUrl(value, expectedBlogId = NAVER_BLOG_ID) {
  const url = parseUrl(value, "네이버 블로그 글 URL");
  assertHttpsHost(url, NAVER_BLOG_HOSTS, "네이버 블로그 글 URL");
  const blogId = naverBlogIdFromUrl(url);
  const segments = url.pathname.split("/").filter(Boolean);
  const logNo = url.searchParams.get("logNo") ?? (segments[0] === blogId ? segments[1] : "") ?? "";
  if (blogId !== expectedBlogId) throw trustError("네이버 블로그 ID가 승인된 값과 다릅니다.");
  if (!NAVER_LOG_NO_PATTERN.test(logNo)) throw trustError("네이버 블로그 logNo가 올바르지 않습니다.");
  return { blogId, logNo };
}

function assertNaverChannelUrl(value, expectedBlogId) {
  const url = parseUrl(value, "네이버 RSS 채널 URL");
  assertHttpsHost(url, NAVER_BLOG_HOSTS, "네이버 RSS 채널 URL");
  if (naverBlogIdFromUrl(url) !== expectedBlogId) throw trustError("네이버 RSS 채널이 승인된 블로그와 다릅니다.");
}

export function normalizeYouTubeInternalId(videoId) {
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) throw trustError("YouTube videoId 형식이 올바르지 않습니다.");
  const stableId = videoId.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
  if (!stableId) throw trustError("YouTube 내부 ID를 만들 수 없습니다.");
  return `youtube-${stableId}`;
}

export function assertNaverBlogId(blogId) {
  if (!/^[A-Za-z0-9_-]{2,50}$/u.test(blogId ?? "")) throw trustError("네이버 블로그 ID 형식이 올바르지 않습니다.");
}

export function assertYouTubeChannelId(channelId) {
  if (!YOUTUBE_CHANNEL_ID_PATTERN.test(channelId ?? "")) throw trustError("YOUTUBE_CHANNEL_ID 형식이 올바르지 않습니다.");
}

export function youtubeVideoIdFromUrl(value, { feedLink = false } = {}) {
  const url = parseUrl(value, "YouTube 영상 URL");
  assertHttpsHost(url, YOUTUBE_PAGE_HOSTS, "YouTube 영상 URL");
  let videoId = "";
  if (url.hostname.toLowerCase() === "youtu.be") {
    videoId = url.pathname.split("/").filter(Boolean)[0] ?? "";
  } else if (url.pathname === "/watch") {
    videoId = url.searchParams.get("v") ?? "";
  } else {
    const segments = url.pathname.split("/").filter(Boolean);
    if (["shorts", "live"].includes(segments[0])) videoId = segments[1] ?? "";
  }
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) throw trustError("YouTube 개별 영상 URL이 아닙니다.");
  if (feedLink && url.hostname.toLowerCase() === "youtu.be") throw trustError("YouTube 피드 영상 URL 호스트가 올바르지 않습니다.");
  return videoId;
}

export function youtubeFormatFromUrl(value) {
  const url = parseUrl(value, "YouTube 영상 URL");
  assertHttpsHost(url, YOUTUBE_PAGE_HOSTS, "YouTube 영상 URL");
  const [firstSegment] = url.pathname.split("/").filter(Boolean);
  return firstSegment === "shorts" ? "short" : "video";
}

function findAlternateLink(links, label) {
  const alternate = asArray(links).find((link) => link?.["@_rel"] === "alternate");
  const href = alternate?.["@_href"];
  if (typeof href !== "string" || href.trim() === "") throw trustError(`${label}: alternate 링크가 없습니다.`);
  return href.trim();
}

function assertYouTubeChannelLink(value, expectedChannelId) {
  const url = parseUrl(value, "YouTube 채널 URL");
  assertHttpsHost(url, new Set(["youtube.com", "www.youtube.com"]), "YouTube 채널 URL");
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments[0] !== "channel" || segments[1] !== expectedChannelId) {
    throw trustError("YouTube Atom 채널이 승인된 channelId와 다릅니다.");
  }
}

export function parseNaverBlogFeed(xml, { blogId = NAVER_BLOG_ID } = {}) {
  assertNaverBlogId(blogId);
  const document = parseXml(xml, "네이버 블로그 RSS");
  const channel = document?.rss?.channel;
  if (!channel || typeof channel !== "object") throw trustError("네이버 블로그 RSS 채널이 없습니다.");
  assertNaverChannelUrl(textValue(channel.link), blogId);

  return asArray(channel.item).map((item, index) => {
    const label = `네이버 RSS item[${index}]`;
    const title = normalizeTitle(item?.title, label);
    const { logNo } = parseNaverPostUrl(textValue(item?.link), blogId);
    const publishedAt = naverDate(item?.pubDate, label);
    const thumbnailUrl = assertThumbnailUrl(firstImageUrl(item?.description), "blog", `${label} 썸네일`);
    return {
      sourceId: logNo,
      id: `naver-blog-${logNo}`,
      type: "blog",
      title,
      summary: `리더스시티행복한부동산 공식 블로그에서 “${title}” 관련 내용을 확인해 보세요.`,
      url: `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${logNo}`,
      publishedAt,
      thumbnailUrl,
    };
  });
}

export function parseYouTubeFeed(xml, { channelId } = {}) {
  assertYouTubeChannelId(channelId);
  const document = parseXml(xml, "YouTube Atom RSS");
  const feed = document?.feed;
  if (!feed || typeof feed !== "object") throw trustError("YouTube Atom feed가 없습니다.");
  assertYouTubeChannelLink(findAlternateLink(feed.link, "YouTube Atom feed"), channelId);

  return asArray(feed.entry).map((entry, index) => {
    const label = `YouTube entry[${index}]`;
    const videoId = textValue(entry?.["yt:videoId"]);
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) throw trustError(`${label}: videoId 형식이 올바르지 않습니다.`);
    if (textValue(entry?.["yt:channelId"]) !== channelId) throw trustError(`${label}: 승인된 channelId와 다릅니다.`);
    const title = normalizeTitle(entry?.title, label);
    const publishedAt = atomDate(entry?.published, `${label} published`);
    atomDate(entry?.updated, `${label} updated`);
    const alternateUrl = findAlternateLink(entry?.link, label);
    if (youtubeVideoIdFromUrl(alternateUrl, { feedLink: true }) !== videoId) {
      throw trustError(`${label}: videoId와 alternate URL이 일치하지 않습니다.`);
    }
    const youtubeFormat = youtubeFormatFromUrl(alternateUrl);
    const thumbnails = asArray(entry?.["media:group"]?.["media:thumbnail"]);
    const thumbnailValue = thumbnails.find((thumbnail) => typeof thumbnail?.["@_url"] === "string")?.["@_url"] ?? null;
    const thumbnailUrl = assertThumbnailUrl(thumbnailValue, "youtube", `${label} 썸네일`);
    return {
      sourceId: videoId,
      id: normalizeYouTubeInternalId(videoId),
      type: "youtube",
      youtubeFormat,
      title,
      summary: `공식 YouTube 채널에서 “${title}” ${youtubeFormat === "short" ? "Shorts를" : "영상을"} 확인해 보세요.`,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      publishedAt,
      thumbnailUrl,
    };
  });
}

function currentSourceId(item, blogId) {
  if (item.type === "youtube") return youtubeVideoIdFromUrl(item.url);
  if (item.type === "blog") return parseNaverPostUrl(item.url, blogId).logNo;
  throw trustError(`지원하지 않는 외부 콘텐츠 유형입니다: ${item.type}`);
}

export function planNewExternalContent(current, candidates, { blogId = NAVER_BLOG_ID } = {}) {
  const currentErrors = validateExternalLinks(current);
  if (currentErrors.length > 0) throw trustError(`기존 external-links.json 검증 실패:\n${currentErrors.join("\n")}`);

  const byId = new Map();
  const bySource = new Map();
  for (const item of current) {
    byId.set(item.id, item);
    const sourceId = currentSourceId(item, blogId);
    const sourceKey = `${item.type}:${sourceId}`;
    if (bySource.has(sourceKey)) throw trustError(`기존 외부 콘텐츠 원본 ID가 중복됩니다: ${sourceKey}`);
    bySource.set(sourceKey, item);
  }

  const plannedIds = new Map();
  const newCandidates = [];
  for (const candidate of candidates) {
    const plannedSource = plannedIds.get(candidate.id);
    if (plannedSource && plannedSource !== candidate.sourceId) {
      throw trustError(`정규화된 외부 콘텐츠 ID가 충돌합니다: ${candidate.id}`);
    }
    if (plannedSource === candidate.sourceId) continue;
    plannedIds.set(candidate.id, candidate.sourceId);

    const existingById = byId.get(candidate.id);
    if (existingById) {
      if (existingById.type !== candidate.type || currentSourceId(existingById, blogId) !== candidate.sourceId) {
        throw trustError(`기존 ID와 원본 ID가 충돌합니다: ${candidate.id}`);
      }
      continue;
    }

    const existingBySource = bySource.get(`${candidate.type}:${candidate.sourceId}`);
    if (existingBySource) {
      throw trustError(`같은 원본이 다른 내부 ID로 등록되어 있습니다: ${existingBySource.id}`);
    }
    newCandidates.push(candidate);
  }
  return newCandidates;
}

export function buildExternalContentItem(candidate, thumbnail) {
  return {
    id: candidate.id,
    type: candidate.type,
    ...(candidate.type === "youtube" ? { youtubeFormat: candidate.youtubeFormat } : {}),
    status: "published",
    title: candidate.title,
    summary: candidate.summary,
    url: candidate.url,
    publishedAt: candidate.publishedAt,
    thumbnail,
  };
}

export function mergeExternalContentsPreservingOrder(current, additions) {
  const merged = [...current];
  const orderedAdditions = additions
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const dateOrder = (right.item.publishedAt ?? "").localeCompare(left.item.publishedAt ?? "");
      return dateOrder || left.index - right.index;
    })
    .map(({ item }) => item);

  for (const addition of orderedAdditions) {
    const insertAt = merged.findIndex((item) => (item.publishedAt ?? "") < (addition.publishedAt ?? ""));
    if (insertAt === -1) merged.push(addition);
    else merged.splice(insertAt, 0, addition);
  }
  return merged;
}

export function validateMergedExternalContents(items) {
  const errors = validateExternalLinks(items);
  if (errors.length > 0) throw trustError(`동기화 결과 검증 실패:\n${errors.join("\n")}`);
}

export function shouldRefreshKeepalive(lastKeepaliveAt, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(lastKeepaliveAt ?? "")) throw trustError("lastKeepaliveAt은 YYYY-MM-DD여야 합니다.");
  const last = Date.parse(`${lastKeepaliveAt}T00:00:00Z`);
  if (!Number.isFinite(last) || !(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw trustError("keepalive 날짜를 계산할 수 없습니다.");
  }
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((currentDay - last) / 86_400_000) >= 45;
}
