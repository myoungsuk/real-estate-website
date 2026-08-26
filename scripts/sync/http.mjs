import sharp from "sharp";
import { ExternalSyncTrustError } from "./errors.mjs";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_IMAGE_TYPES = new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]);

function allowedUrl(value, allowedHosts, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ExternalSyncTrustError(`${label}: 올바른 URL이 아닙니다.`);
  }
  if (
    url.protocol !== "https:"
    || url.username
    || url.password
    || url.port
    || !allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw new ExternalSyncTrustError(`${label}: 허용된 HTTPS 호스트가 아닙니다.`);
  }
  return url;
}

async function readLimitedBuffer(response, maxBytes, label) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new Error(`${label}: 응답 크기가 제한을 초과했습니다.`);
  if (!response.body) throw new Error(`${label}: 응답 본문이 없습니다.`);

  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error(`${label}: 응답 크기가 제한을 초과했습니다.`);
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function requestWithRedirects(value, { allowedHosts, fetcher, timeoutMs, maxRedirects, label }) {
  let url = allowedUrl(value, allowedHosts, label);
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetcher(url, {
      redirect: "manual",
      headers: {
        Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, image/avif, image/webp, image/png, image/jpeg, image/gif;q=0.9, */*;q=0.1",
        "User-Agent": "leaderscityhappy-content-sync/1.0",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`${label}: 리디렉션 주소가 없습니다.`);
    url = allowedUrl(new URL(location, url).toString(), allowedHosts, `${label} 리디렉션`);
  }
  throw new Error(`${label}: 리디렉션 횟수가 너무 많습니다.`);
}

export async function fetchAllowedBuffer(value, {
  allowedHosts,
  fetcher = globalThis.fetch,
  timeoutMs = 10_000,
  maxBytes,
  maxRedirects = 3,
  attempts = 3,
  label,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await requestWithRedirects(value, { allowedHosts, fetcher, timeoutMs, maxRedirects, label });
      if (!response.ok) {
        const error = new Error(`${label}: HTTP ${response.status}`);
        error.retryable = RETRYABLE_STATUSES.has(response.status);
        throw error;
      }
      return { response, buffer: await readLimitedBuffer(response, maxBytes, label) };
    } catch (error) {
      if (error instanceof ExternalSyncTrustError) throw error;
      lastError = error;
      if (error?.retryable === false || attempt === attempts) break;
      await sleep(250 * attempt);
    }
  }
  throw lastError ?? new Error(`${label}: 요청에 실패했습니다.`);
}

export async function fetchXml(value, options) {
  const { response, buffer } = await fetchAllowedBuffer(value, { ...options, maxBytes: options?.maxBytes ?? 2 * 1024 * 1024 });
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("xml") && !contentType.startsWith("text/")) {
    throw new Error(`${options.label}: XML Content-Type이 아닙니다.`);
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${options.label}: UTF-8 XML이 아닙니다.`);
  }
}

export async function prepareWebpThumbnail(value, { allowedHosts, fetcher, label, attempts = 3 } = {}) {
  const { response, buffer } = await fetchAllowedBuffer(value, {
    allowedHosts,
    fetcher,
    label,
    attempts,
    timeoutMs: 10_000,
    maxBytes: 5 * 1024 * 1024,
  });
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) throw new Error(`${label}: 허용된 이미지 Content-Type이 아닙니다.`);

  const image = sharp(buffer, { limitInputPixels: 40_000_000 });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width > 10_000 || metadata.height > 10_000) {
    throw new Error(`${label}: 이미지 해상도가 올바르지 않습니다.`);
  }
  return image
    .rotate()
    .resize({ width: 960, height: 540, fit: "cover" })
    .webp({ quality: 82 })
    .toBuffer();
}
