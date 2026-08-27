import { ADMIN_RESOURCE_PATHS, getAdminResourcePath } from "./admin-resource-validation.mjs";

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
const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;
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

function mediaFormatError() {
  return new GithubContentError("MEDIA_FORMAT_INVALID", "올바른 WebP 이미지가 아닙니다.", 400);
}

function readFourCc(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readUint24Le(bytes, offset) {
  return bytes[offset] + (bytes[offset + 1] * 0x100) + (bytes[offset + 2] * 0x10000);
}

function readUint32Le(bytes, offset) {
  return bytes[offset]
    + (bytes[offset + 1] * 0x100)
    + (bytes[offset + 2] * 0x10000)
    + (bytes[offset + 3] * 0x1000000);
}

function readWebpBitstreamDimensions(type, bytes, offset, size) {
  if (type === "VP8 ") {
    if (
      size < 10
      || (bytes[offset] & 1) !== 0
      || bytes[offset + 3] !== 0x9d
      || bytes[offset + 4] !== 0x01
      || bytes[offset + 5] !== 0x2a
    ) {
      throw mediaFormatError();
    }
    return {
      width: (bytes[offset + 6] + (bytes[offset + 7] * 0x100)) & 0x3fff,
      height: (bytes[offset + 8] + (bytes[offset + 9] * 0x100)) & 0x3fff,
    };
  }
  if (type === "VP8L") {
    if (size < 5 || bytes[offset] !== 0x2f) throw mediaFormatError();
    const bits = readUint32Le(bytes, offset + 1);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
    };
  }
  throw mediaFormatError();
}

export function validateWebpBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) throw mediaFormatError();
  if (readFourCc(bytes, 0) !== "RIFF" || readFourCc(bytes, 8) !== "WEBP") throw mediaFormatError();
  if (readUint32Le(bytes, 4) + 8 !== bytes.length) throw mediaFormatError();

  let offset = 12;
  let chunkIndex = 0;
  let extendedDimensions = null;
  let bitstreamDimensions = null;
  let extendedFlags = 0;
  let hasAlphaChunk = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw mediaFormatError();
    const type = readFourCc(bytes, offset);
    const size = readUint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const dataEnd = dataOffset + size;
    const paddedEnd = dataEnd + (size % 2);
    if (dataEnd > bytes.length || paddedEnd > bytes.length) throw mediaFormatError();
    if (size % 2 === 1 && bytes[dataEnd] !== 0) throw mediaFormatError();

    if (["ANIM", "ANMF", "EXIF", "XMP ", "ICCP", "IPTC"].includes(type)) {
      throw new GithubContentError("MEDIA_METADATA_DENIED", "애니메이션과 메타데이터가 없는 WebP만 업로드할 수 있습니다.", 400);
    }
    if (type === "VP8X") {
      if (chunkIndex !== 0 || extendedDimensions || size !== 10) throw mediaFormatError();
      extendedFlags = bytes[dataOffset];
      if (
        (extendedFlags & 0xc1) !== 0
        || bytes[dataOffset + 1] !== 0
        || bytes[dataOffset + 2] !== 0
        || bytes[dataOffset + 3] !== 0
      ) {
        throw mediaFormatError();
      }
      if ((extendedFlags & 0x2e) !== 0) {
        throw new GithubContentError("MEDIA_METADATA_DENIED", "애니메이션과 메타데이터가 없는 WebP만 업로드할 수 있습니다.", 400);
      }
      extendedDimensions = {
        width: readUint24Le(bytes, dataOffset + 4) + 1,
        height: readUint24Le(bytes, dataOffset + 7) + 1,
      };
    } else if (type === "VP8 " || type === "VP8L") {
      if (bitstreamDimensions) throw mediaFormatError();
      bitstreamDimensions = readWebpBitstreamDimensions(type, bytes, dataOffset, size);
    } else if (type === "ALPH") {
      if (!extendedDimensions || hasAlphaChunk || size === 0) throw mediaFormatError();
      hasAlphaChunk = true;
    } else {
      throw mediaFormatError();
    }

    offset = paddedEnd;
    chunkIndex += 1;
  }

  if (!bitstreamDimensions) throw mediaFormatError();
  if (hasAlphaChunk && (extendedFlags & 0x10) === 0) throw mediaFormatError();
  if (
    extendedDimensions
    && (extendedDimensions.width !== bitstreamDimensions.width || extendedDimensions.height !== bitstreamDimensions.height)
  ) {
    throw mediaFormatError();
  }
  const dimensions = extendedDimensions ?? bitstreamDimensions;
  if (
    dimensions.width <= 0
    || dimensions.height <= 0
    || dimensions.width > MAX_IMAGE_DIMENSION
    || dimensions.height > MAX_IMAGE_DIMENSION
    || dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new GithubContentError("MEDIA_DIMENSIONS_INVALID", "이미지 크기는 1,600px와 2,560,000픽셀 이하여야 합니다.", 413);
  }
  return dimensions;
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

function gitRefPath(branch, { plural = false } = {}) {
  const encodedBranch = branch.split("/").map(encodeURIComponent).join("/");
  return `/git/${plural ? "refs" : "ref"}/heads/${encodedBranch}`;
}

function githubContentInvalid() {
  return new GithubContentError("GITHUB_CONTENT_INVALID", "저장소 콘텐츠를 읽지 못했습니다.", 502);
}

async function readAdminResourcesAtCurrentRef(resources, env, fetcher) {
  const config = getGithubConfig(env);
  const ref = await githubRequest(gitRefPath(config.branch), { method: "GET" }, env, fetcher);
  const baseCommitSha = ref.object?.type === "commit" ? ref.object.sha : null;
  if (typeof baseCommitSha !== "string" || baseCommitSha.length === 0) throw githubContentInvalid();

  const commit = await githubRequest(
    `/git/commits/${encodeURIComponent(baseCommitSha)}`,
    { method: "GET" },
    env,
    fetcher,
  );
  const treeSha = commit.tree?.sha;
  if (typeof treeSha !== "string" || treeSha.length === 0) throw githubContentInvalid();

  const tree = await githubRequest(
    `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
    { method: "GET" },
    env,
    fetcher,
  );
  if (!Array.isArray(tree.tree) || tree.truncated === true) throw githubContentInvalid();

  const entriesByPath = new Map(tree.tree.map((entry) => [entry.path, entry]));
  const entries = resources.map((resource) => {
    const filePath = getAdminResourcePath(resource);
    const entry = entriesByPath.get(filePath);
    if (entry?.type !== "blob" || typeof entry.sha !== "string" || entry.sha.length === 0) {
      throw githubContentInvalid();
    }
    return { resource, entry };
  });

  const loaded = await Promise.all(entries.map(async ({ resource, entry }) => {
    const blob = await githubRequest(
      `/git/blobs/${encodeURIComponent(entry.sha)}`,
      { method: "GET" },
      env,
      fetcher,
    );
    if (blob.encoding !== "base64" || typeof blob.content !== "string") throw githubContentInvalid();
    try {
      const bytes = base64ToBytes(blob.content);
      return [resource, { resource, sha: entry.sha, data: JSON.parse(decoder.decode(bytes)) }];
    } catch {
      throw githubContentInvalid();
    }
  }));

  return {
    baseCommitSha,
    treeSha,
    resources: Object.fromEntries(loaded),
  };
}

export async function readAdminResourcesSnapshot(env, fetcher = fetch) {
  return readAdminResourcesAtCurrentRef(Object.keys(ADMIN_RESOURCE_PATHS), env, fetcher);
}

export async function readAdminResource(resource, env, fetcher = fetch) {
  const filePath = getAdminResourcePath(resource);
  if (!filePath) throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
  const snapshot = await readAdminResourcesAtCurrentRef([resource], env, fetcher);
  return { ...snapshot.resources[resource], baseCommitSha: snapshot.baseCommitSha };
}

export async function writeAdminResource(resource, data, sha, env, options = {}) {
  const filePath = getAdminResourcePath(resource);
  if (!filePath) throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
  if (typeof sha !== "string" || sha.length === 0) {
    throw new GithubContentError("SHA_REQUIRED", "최신 파일 버전을 확인한 뒤 저장해 주세요.", 409);
  }
  const fetcher = typeof options === "function" ? options : options.fetcher ?? fetch;
  const snapshot = typeof options === "function" || !options.snapshot
    ? await readAdminResourcesSnapshot(env, fetcher)
    : options.snapshot;
  const current = snapshot?.resources?.[resource];
  if (
    typeof snapshot?.baseCommitSha !== "string"
    || snapshot.baseCommitSha.length === 0
    || typeof snapshot?.treeSha !== "string"
    || snapshot.treeSha.length === 0
    || !current
  ) {
    throw githubContentInvalid();
  }
  if (current.sha !== sha) {
    throw new GithubContentError("GITHUB_CONFLICT", "다른 변경이 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요.", 409);
  }

  const config = getGithubConfig(env);
  const content = `${JSON.stringify(data, null, 2)}\n`;
  const blob = await githubRequest(
    "/git/blobs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: bytesToBase64(encoder.encode(content)),
        encoding: "base64",
      }),
    },
    env,
    fetcher,
  );
  if (typeof blob.sha !== "string" || blob.sha.length === 0) throw githubContentInvalid();

  const tree = await githubRequest(
    "/git/trees",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: snapshot.treeSha,
        tree: [{ path: filePath, mode: "100644", type: "blob", sha: blob.sha }],
      }),
    },
    env,
    fetcher,
  );
  if (typeof tree.sha !== "string" || tree.sha.length === 0) throw githubContentInvalid();

  const commit = await githubRequest(
    "/git/commits",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `관리자: ${resource} 콘텐츠 수정`,
        tree: tree.sha,
        parents: [snapshot.baseCommitSha],
      }),
    },
    env,
    fetcher,
  );
  if (typeof commit.sha !== "string" || commit.sha.length === 0) throw githubContentInvalid();

  await githubRequest(
    gitRefPath(config.branch, { plural: true }),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
    env,
    fetcher,
  );

  return {
    resource,
    commitSha: commit.sha,
    contentSha: blob.sha,
    baseCommitSha: commit.sha,
  };
}

export async function uploadAdminImage({ category, dataUrl }, env, fetcher = fetch) {
  if (!mediaCategories.has(category)) {
    throw new GithubContentError("MEDIA_CATEGORY_DENIED", "허용되지 않은 이미지 분류입니다.", 400);
  }
  const match = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl ?? "");
  if (!match) throw new GithubContentError("MEDIA_FORMAT_INVALID", "WebP 이미지만 업로드할 수 있습니다.", 400);
  let bytes;
  try {
    bytes = base64ToBytes(match[1]);
  } catch {
    throw mediaFormatError();
  }
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new GithubContentError("MEDIA_SIZE_INVALID", "이미지는 2MB 이하로 최적화해 주세요.", 413);
  }
  validateWebpBytes(bytes);
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
