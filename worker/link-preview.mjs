import { AdminWriteError } from "./admin-security.mjs";

const pageHosts = new Set(["blog.naver.com", "m.blog.naver.com"]);
const imageHosts = new Set(["blogfiles.pstatic.net", "postfiles.pstatic.net", "i.ytimg.com"]);
const MAX_PAGE_LENGTH = 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

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
  const type = (response.headers.get("Content-Type") ?? "").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_THUMBNAIL_BYTES) return null;
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
    const response = await fetcher(oembedUrl, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new AdminWriteError("PREVIEW_UNAVAILABLE", "유튜브 영상 정보를 불러오지 못했습니다.", 502);
    const payload = await response.json();
    const thumbnailDataUrl = await imageToDataUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, fetcher);
    return { title: String(payload.title ?? "").trim(), summary: "", thumbnailDataUrl };
  }

  if (type === "blog") {
    const response = await fetchWithAllowedRedirects(value, pageHosts, fetcher);
    if (!response.ok) throw new AdminWriteError("PREVIEW_UNAVAILABLE", "네이버 블로그 글 정보를 불러오지 못했습니다.", 502);
    const html = await response.text();
    if (html.length > MAX_PAGE_LENGTH) throw new AdminWriteError("PREVIEW_PAGE_TOO_LARGE", "블로그 글 미리보기 크기가 너무 큽니다.", 502);
    const title = getMeta(html, "og:title") ?? "";
    const summary = getMeta(html, "og:description") ?? getMeta(html, "description", "name") ?? "";
    const imageUrl = getMeta(html, "og:image");
    const thumbnailDataUrl = imageUrl ? await imageToDataUrl(imageUrl, fetcher) : null;
    return { title, summary, thumbnailDataUrl };
  }

  throw new AdminWriteError("PREVIEW_TYPE_INVALID", "블로그 또는 유튜브만 미리 볼 수 있습니다.", 400);
}
