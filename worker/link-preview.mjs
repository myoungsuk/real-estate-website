import { AdminWriteError } from "./admin-security.mjs";

const pageHosts = new Set(["blog.naver.com", "m.blog.naver.com"]);
const imageHosts = new Set(["blogfiles.pstatic.net", "postfiles.pstatic.net", "i.ytimg.com"]);
const MAX_PAGE_LENGTH = 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const MAX_OEMBED_BYTES = 64 * 1024;

function assertHttpsHost(value, allowedHosts, message) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AdminWriteError("PREVIEW_URL_INVALID", message, 400);
  }
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname)) {
    throw new AdminWriteError("PREVIEW_URL_DENIED", message, 400);
  }
  return url;
}

async function fetchWithAllowedRedirects(url, allowedHosts, fetcher) {
  let current = assertHttpsHost(url, allowedHosts, "허용되지 않은 미리보기 주소입니다.");
  for (let count = 0; count < 4; count += 1) {
    const response = await fetcher(current, {
      redirect: "manual",
      headers: { "User-Agent": "leaderscityhappy-link-preview/1.0" },
      signal: AbortSignal.timeout(7000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) throw new AdminWriteError("PREVIEW_REDIRECT_INVALID", "미리보기 이동 주소를 확인하지 못했습니다.", 502);
      current = assertHttpsHost(new URL(location, current).toString(), allowedHosts, "미리보기 주소가 허용된 서비스를 벗어났습니다.");
      continue;
    }
    return response;
  }
  throw new AdminWriteError("PREVIEW_REDIRECT_LIMIT", "미리보기 이동 횟수가 너무 많습니다.", 502);
}

function declaredLengthExceeds(response, maxBytes) {
  const value = response.headers.get("Content-Length");
  if (!value) return false;
  const length = Number(value);
  return Number.isFinite(length) && length > maxBytes;
}

async function readBytesWithLimit(response, maxBytes, errorFactory) {
  if (declaredLengthExceeds(response, maxBytes)) throw errorFactory();
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw errorFactory();
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw errorFactory();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function contentType(response) {
  return (response.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function getMeta(html, key, attribute = "property") {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+${attribute}=["']${escapedKey}["'][^>]+content=["']([^"']+)["'][^>]*>`, "iu"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${escapedKey}["'][^>]*>`, "iu"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1].replaceAll("&amp;", "&").replaceAll("&quot;", '"').trim();
  }
  return null;
}

async function imageToDataUrl(imageUrl, fetcher) {
  const response = await fetchWithAllowedRedirects(imageUrl, imageHosts, fetcher);
  if (!response.ok) return null;
  const type = contentType(response);
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
  let bytes;
  try {
    bytes = await readBytesWithLimit(response, MAX_THUMBNAIL_BYTES, () => new Error("thumbnail-too-large"));
  } catch {
    return null;
  }
  if (bytes.length === 0) return null;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return `data:${type};base64,${btoa(binary)}`;
}

function youtubeVideoId(url) {
  if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] ?? null;
  if (!["youtube.com", "www.youtube.com"].includes(url.hostname)) return null;
  if (url.pathname === "/watch") return url.searchParams.get("v");
  const parts = url.pathname.split("/").filter(Boolean);
  if (["shorts", "embed"].includes(parts[0])) return parts[1] ?? null;
  return null;
}

export async function fetchExternalLinkPreview({ type, url: value }, fetcher = fetch) {
  if (type === "youtube") {
    const url = assertHttpsHost(value, new Set(["youtube.com", "www.youtube.com", "youtu.be"]), "유튜브 영상 주소를 확인해 주세요.");
    const videoId = youtubeVideoId(url);
    if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/u.test(videoId)) {
      throw new AdminWriteError("YOUTUBE_VIDEO_REQUIRED", "유튜브 채널이 아니라 개별 영상 주소를 입력해 주세요.", 400);
    }
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url.toString())}&format=json`;
    const response = await fetchWithAllowedRedirects(oembedUrl, new Set(["www.youtube.com"]), fetcher);
    if (!response.ok) throw new AdminWriteError("PREVIEW_UNAVAILABLE", "유튜브 영상 정보를 불러오지 못했습니다.", 502);
    if (contentType(response) !== "application/json") {
      throw new AdminWriteError("PREVIEW_RESPONSE_INVALID", "유튜브 영상 응답 형식을 확인하지 못했습니다.", 502);
    }
    const payloadBytes = await readBytesWithLimit(
      response,
      MAX_OEMBED_BYTES,
      () => new AdminWriteError("PREVIEW_RESPONSE_TOO_LARGE", "유튜브 영상 응답 크기가 너무 큽니다.", 502),
    );
    let payload;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
    } catch {
      throw new AdminWriteError("PREVIEW_RESPONSE_INVALID", "유튜브 영상 응답을 확인하지 못했습니다.", 502);
    }
    const thumbnailDataUrl = await imageToDataUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, fetcher);
    return { title: String(payload.title ?? "").trim(), summary: "", thumbnailDataUrl };
  }

  if (type === "blog") {
    const response = await fetchWithAllowedRedirects(value, pageHosts, fetcher);
    if (!response.ok) throw new AdminWriteError("PREVIEW_UNAVAILABLE", "네이버 블로그 글 정보를 불러오지 못했습니다.", 502);
    if (contentType(response) !== "text/html") {
      throw new AdminWriteError("PREVIEW_RESPONSE_INVALID", "블로그 글 응답 형식을 확인하지 못했습니다.", 502);
    }
    const htmlBytes = await readBytesWithLimit(
      response,
      MAX_PAGE_LENGTH,
      () => new AdminWriteError("PREVIEW_PAGE_TOO_LARGE", "블로그 글 미리보기 크기가 너무 큽니다.", 502),
    );
    let html;
    try {
      html = new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes);
    } catch {
      throw new AdminWriteError("PREVIEW_RESPONSE_INVALID", "블로그 글 응답을 확인하지 못했습니다.", 502);
    }
    const title = getMeta(html, "og:title") ?? "";
    const summary = getMeta(html, "og:description") ?? getMeta(html, "description", "name") ?? "";
    const imageUrl = getMeta(html, "og:image");
    const thumbnailDataUrl = imageUrl ? await imageToDataUrl(imageUrl, fetcher) : null;
    return { title, summary, thumbnailDataUrl };
  }

  throw new AdminWriteError("PREVIEW_TYPE_INVALID", "블로그 또는 유튜브만 미리 볼 수 있습니다.", 400);
}
