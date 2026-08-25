import { getAdminResourcePath } from "./admin-resource-validation.mjs";

export class GithubContentError extends Error {
  constructor(code, message, status) {
    super(message);
    this.name = "GithubContentError";
    this.code = code;
    this.status = status;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const mediaCategories = new Set(["listing", "blog", "youtube", "office", "area"]);

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 8192;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/\s/gu, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function getGithubConfig(env) {
  const [owner, repository] = (env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repository || !env.GITHUB_CONTENTS_TOKEN || !env.GITHUB_BRANCH) {
    throw new GithubContentError("GITHUB_CONFIG_MISSING", "GitHub 저장 연결 설정이 필요합니다.", 503);
  }
  return { owner, repository, branch: env.GITHUB_BRANCH, token: env.GITHUB_CONTENTS_TOKEN };
}

async function githubRequest(path, init, env, fetcher = fetch) {
  const config = getGithubConfig(env);
  const response = await fetcher(`https://api.github.com/repos/${config.owner}/${config.repository}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "leaderscityhappy-admin-worker",
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const status = response.status === 409 || response.status === 422 ? 409 : 502;
    const code = status === 409 ? "GITHUB_CONFLICT" : "GITHUB_UNAVAILABLE";
    const message = status === 409
      ? "다른 변경이 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요."
      : "GitHub 저장소와 통신하지 못했습니다.";
    throw new GithubContentError(code, message, status);
  }
  return response.json();
}

function contentApiPath(filePath, branch) {
  const encodedPath = filePath.split("/").map(encodeURIComponent).join("/");
  return `/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
}

export async function readAdminResource(resource, env, fetcher = fetch) {
  const filePath = getAdminResourcePath(resource);
  if (!filePath) throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
  const config = getGithubConfig(env);
  const payload = await githubRequest(contentApiPath(filePath, config.branch), { method: "GET" }, env, fetcher);
  try {
    const bytes = base64ToBytes(payload.content);
    return { resource, sha: payload.sha, data: JSON.parse(decoder.decode(bytes)) };
  } catch {
    throw new GithubContentError("GITHUB_CONTENT_INVALID", "저장소 콘텐츠를 읽지 못했습니다.", 502);
  }
}

export async function writeAdminResource(resource, data, sha, env, fetcher = fetch) {
  const filePath = getAdminResourcePath(resource);
  if (!filePath) throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
  if (typeof sha !== "string" || sha.length === 0) {
    throw new GithubContentError("SHA_REQUIRED", "최신 파일 버전을 확인한 뒤 저장해 주세요.", 409);
  }
  const config = getGithubConfig(env);
  const content = bytesToBase64(encoder.encode(`${JSON.stringify(data, null, 2)}\n`));
  const payload = await githubRequest(
    `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `관리자: ${resource} 콘텐츠 수정`,
        content,
        sha,
        branch: config.branch,
      }),
    },
    env,
    fetcher,
  );
  return { resource, commitSha: payload.commit?.sha ?? null, contentSha: payload.content?.sha ?? null };
}

export async function uploadAdminImage({ category, dataUrl }, env, fetcher = fetch) {
  if (!mediaCategories.has(category)) {
    throw new GithubContentError("MEDIA_CATEGORY_DENIED", "허용되지 않은 이미지 분류입니다.", 400);
  }
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl ?? "");
  if (!match) throw new GithubContentError("MEDIA_FORMAT_INVALID", "WebP 이미지만 업로드할 수 있습니다.", 400);
  const bytes = base64ToBytes(match[1]);
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new GithubContentError("MEDIA_SIZE_INVALID", "이미지는 2MB 이하로 최적화해 주세요.", 413);
  }
  const header = decoder.decode(bytes.subarray(0, 12));
  if (!header.startsWith("RIFF") || !header.endsWith("WEBP")) {
    throw new GithubContentError("MEDIA_FORMAT_INVALID", "올바른 WebP 이미지가 아닙니다.", 400);
  }
  const config = getGithubConfig(env);
  const fileName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}.webp`;
  const filePath = `public/images/content/${category}/${fileName}`;
  const payload = await githubRequest(
    `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `관리자: ${category} 이미지 추가`,
        content: match[1],
        branch: config.branch,
      }),
    },
    env,
    fetcher,
  );
  return {
    src: filePath.replace(/^public/u, ""),
    commitSha: payload.commit?.sha ?? null,
  };
}
