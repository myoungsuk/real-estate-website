import { ADMIN_RESOURCE_PATHS, getAdminResourcePath } from "./admin-resource-validation.mjs";
import {
  calculateAdminResourceDigest,
  normalizeAdminResourceJson,
} from "../src/lib/admin-resource-digest.mjs";

export class GithubContentError extends Error {
  constructor(code, message, status, upstreamStatus = null) {
    super(message);
    this.name = "GithubContentError";
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstreamStatus;
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const MAX_IMAGE_PIXELS = MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION;
const MAX_HISTORY_LIMIT = 10;
const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/u;
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
    const isConflict = response.status === 409;
    const isRateLimited = response.status === 429;
    const status = isConflict ? 409 : isRateLimited ? 503 : 502;
    const code = isConflict ? "GITHUB_CONFLICT" : isRateLimited ? "GITHUB_RATE_LIMITED" : "GITHUB_UNAVAILABLE";
    const message = isConflict
      ? "다른 변경이 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요."
      : isRateLimited
        ? "GitHub 조회 요청이 잠시 제한되었습니다. 잠시 뒤 다시 시도해 주세요."
        : "GitHub 저장소와 통신하지 못했습니다.";
    throw new GithubContentError(code, message, status, response.status);
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

async function readAdminResourcesAtCommit(resources, baseCommitSha, env, fetcher) {
  if (!COMMIT_SHA_PATTERN.test(baseCommitSha ?? "")) throw githubContentInvalid();
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

async function readAdminResourcesAtCurrentRef(resources, env, fetcher) {
  const config = getGithubConfig(env);
  const ref = await githubRequest(gitRefPath(config.branch), { method: "GET" }, env, fetcher);
  const baseCommitSha = ref.object?.type === "commit" ? ref.object.sha : null;
  if (!COMMIT_SHA_PATTERN.test(baseCommitSha ?? "")) throw githubContentInvalid();
  return readAdminResourcesAtCommit(resources, baseCommitSha, env, fetcher);
}

function normalizeHistoryLimit(value) {
  if (value === undefined || value === null || value === "") return MAX_HISTORY_LIMIT;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
    throw new GithubContentError("HISTORY_LIMIT_INVALID", `변경 이력은 1개부터 ${MAX_HISTORY_LIMIT}개까지 조회할 수 있습니다.`, 400);
  }
  return limit;
}

function encodeHistoryCursor(page) {
  return btoa(String(page)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decodeHistoryCursor(value) {
  if (value === undefined || value === null || value === "") return 1;
  if (!/^[A-Za-z0-9_-]{1,16}$/u.test(value)) {
    throw new GithubContentError("HISTORY_CURSOR_INVALID", "변경 이력 다음 페이지 정보가 올바르지 않습니다.", 400);
  }
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = atob(`${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`);
    const page = Number(decoded);
    if (!Number.isInteger(page) || page < 2 || page > 10_000) throw new Error("invalid page");
    return page;
  } catch {
    throw new GithubContentError("HISTORY_CURSOR_INVALID", "변경 이력 다음 페이지 정보가 올바르지 않습니다.", 400);
  }
}

function sanitizeHistoryText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const firstLine = value.split(/\r?\n/u, 1)[0]
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, "[이메일 가림]")
    .replace(/01[016789][ -]?\d{3,4}[ -]?\d{4}/gu, "[연락처 가림]")
    .replace(/\b[A-Za-z0-9_-]{48,}\b/gu, "[민감 문자열 가림]")
    .trim();
  return firstLine.slice(0, maxLength) || fallback;
}

async function assertCommitOnCurrentBranch(commitSha, env, fetcher) {
  const config = getGithubConfig(env);
  const comparison = await githubRequest(
    `/compare/${encodeURIComponent(commitSha)}...${encodeURIComponent(config.branch)}`,
    { method: "GET" },
    env,
    fetcher,
  );
  const mergeBaseSha = comparison.merge_base_commit?.sha;
  if (!["ahead", "identical"].includes(comparison.status) || mergeBaseSha !== commitSha) {
    throw new GithubContentError("HISTORY_COMMIT_DENIED", "현재 운영 branch의 변경 이력만 복원할 수 있습니다.", 400);
  }
}

export async function readAdminResourceHistory(resource, options, env, fetcher = fetch) {
  const filePath = getAdminResourcePath(resource);
  if (!filePath) throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
  const limit = normalizeHistoryLimit(options?.limit);
  const page = decodeHistoryCursor(options?.cursor);
  const config = getGithubConfig(env);
  const query = new URLSearchParams({
    sha: config.branch,
    path: filePath,
    per_page: String(limit + 1),
    page: String(page),
  });
  const commits = await githubRequest(`/commits?${query}`, { method: "GET" }, env, fetcher);
  if (!Array.isArray(commits)) throw githubContentInvalid();

  const visible = commits.slice(0, limit);
  const entries = await Promise.all(visible.map(async (item) => {
    const commitSha = typeof item?.sha === "string" ? item.sha.toLowerCase() : "";
    const treeSha = item?.commit?.tree?.sha;
    if (!COMMIT_SHA_PATTERN.test(commitSha) || !COMMIT_SHA_PATTERN.test(treeSha ?? "")) throw githubContentInvalid();
    const tree = await githubRequest(
      `/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
      { method: "GET" },
      env,
      fetcher,
    );
    if (!Array.isArray(tree.tree) || tree.truncated === true) throw githubContentInvalid();
    const resourceEntry = tree.tree.find((entry) => entry.path === filePath && entry.type === "blob");
    if (!COMMIT_SHA_PATTERN.test(resourceEntry?.sha ?? "")) throw githubContentInvalid();
    const committedAt = item.commit?.committer?.date ?? item.commit?.author?.date;
    if (!Number.isFinite(Date.parse(committedAt ?? ""))) throw githubContentInvalid();
    return {
      commitSha,
      title: sanitizeHistoryText(item.commit?.message, "GitHub 콘텐츠 변경", 120),
      committedAt: new Date(committedAt).toISOString(),
      author: sanitizeHistoryText(item.commit?.author?.name, "관리자", 80),
      resourceBlobSha: resourceEntry.sha,
      onCurrentBranch: true,
      productionMatched: null,
    };
  }));

  return {
    resource,
    entries,
    nextCursor: commits.length > limit ? encodeHistoryCursor(page + 1) : null,
  };
}

export async function readAdminResourcesRevision(resources, commitSha, env, fetcher = fetch) {
  if (!COMMIT_SHA_PATTERN.test(commitSha ?? "")) {
    throw new GithubContentError("HISTORY_COMMIT_INVALID", "복원할 GitHub 버전이 올바르지 않습니다.", 400);
  }
  const requestedResources = Array.isArray(resources) ? resources : [];
  const uniqueResources = [...new Set(requestedResources)];
  if (uniqueResources.length === 0 || uniqueResources.length !== requestedResources.length) {
    throw new GithubContentError("RESTORE_RESOURCES_INVALID", "복원할 콘텐츠 종류를 다시 확인해 주세요.", 400);
  }
  for (const resource of uniqueResources) {
    if (!getAdminResourcePath(resource)) {
      throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
    }
  }
  await assertCommitOnCurrentBranch(commitSha, env, fetcher);
  return readAdminResourcesAtCommit(uniqueResources, commitSha, env, fetcher);
}

export async function readAdminResourceRevision(resource, commitSha, env, fetcher = fetch) {
  const revision = await readAdminResourcesRevision([resource], commitSha, env, fetcher);
  return { ...revision.resources[resource], sourceCommit: revision.baseCommitSha };
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

function normalizeAdminResourceChanges(changes) {
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new GithubContentError("CHANGES_REQUIRED", "저장할 콘텐츠 변경을 한 개 이상 입력해 주세요.", 400);
  }

  const resources = new Set();
  return changes.map((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      throw new GithubContentError("CHANGE_INVALID", "저장할 콘텐츠 변경 형식이 올바르지 않습니다.", 400);
    }
    const filePath = getAdminResourcePath(change.resource);
    if (!filePath) {
      throw new GithubContentError("RESOURCE_NOT_ALLOWED", "허용되지 않은 콘텐츠 종류입니다.", 404);
    }
    if (resources.has(change.resource)) {
      throw new GithubContentError("DUPLICATE_RESOURCE", "같은 콘텐츠 종류를 한 번의 저장에 중복해서 넣을 수 없습니다.", 400);
    }
    if (typeof change.sha !== "string" || change.sha.length === 0) {
      throw new GithubContentError("SHA_REQUIRED", "최신 파일 버전을 확인한 뒤 저장해 주세요.", 409);
    }
    if (!Object.hasOwn(change, "data")) {
      throw new GithubContentError("DATA_REQUIRED", "저장할 콘텐츠 데이터가 필요합니다.", 400);
    }
    resources.add(change.resource);
    return {
      resource: change.resource,
      filePath,
      data: change.data,
      sha: change.sha,
    };
  });
}

export async function writeAdminResources(changes, env, options = {}) {
  const normalizedChanges = normalizeAdminResourceChanges(changes);
  const fetcher = typeof options === "function" ? options : options.fetcher ?? fetch;
  const snapshot = typeof options === "function" || !options.snapshot
    ? await readAdminResourcesSnapshot(env, fetcher)
    : options.snapshot;
  if (
    typeof snapshot?.baseCommitSha !== "string"
    || snapshot.baseCommitSha.length === 0
    || typeof snapshot?.treeSha !== "string"
    || snapshot.treeSha.length === 0
  ) {
    throw githubContentInvalid();
  }

  for (const change of normalizedChanges) {
    const current = snapshot.resources?.[change.resource];
    if (!current) throw githubContentInvalid();
    if (current.sha !== change.sha) {
      throw new GithubContentError("GITHUB_CONFLICT", "다른 변경이 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요.", 409);
    }
  }

  const config = getGithubConfig(env);
  const requestedCommitMessage = typeof options === "function" ? null : options.commitMessage;
  if (requestedCommitMessage !== undefined && (
    typeof requestedCommitMessage !== "string"
    || requestedCommitMessage.length === 0
    || requestedCommitMessage.length > 200
    || /[\u0000-\u001f\u007f]/u.test(requestedCommitMessage)
  )) {
    throw new GithubContentError("COMMIT_MESSAGE_INVALID", "GitHub 저장 제목이 올바르지 않습니다.", 400);
  }
  const writtenResources = [];
  for (const change of normalizedChanges) {
    const content = normalizeAdminResourceJson(change.data);
    const resourceDigest = await calculateAdminResourceDigest(change.data);
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
    writtenResources.push({
      resource: change.resource,
      path: change.filePath,
      contentSha: blob.sha,
      resourceDigest,
    });
  }

  const tree = await githubRequest(
    "/git/trees",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: snapshot.treeSha,
        tree: writtenResources.map(({ path, contentSha }) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: contentSha,
        })),
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
        message: requestedCommitMessage ?? (normalizedChanges.length === 1
          ? `관리자: ${normalizedChanges[0].resource} 콘텐츠 수정`
          : `관리자: ${normalizedChanges.map(({ resource }) => resource).join(", ")} 콘텐츠 일괄 수정`),
        tree: tree.sha,
        parents: [snapshot.baseCommitSha],
      }),
    },
    env,
    fetcher,
  );
  if (typeof commit.sha !== "string" || commit.sha.length === 0) throw githubContentInvalid();

  try {
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
  } catch (error) {
    if (!(error instanceof GithubContentError) || error.upstreamStatus !== 422) throw error;

    let currentCommitSha;
    try {
      const currentRef = await githubRequest(gitRefPath(config.branch), { method: "GET" }, env, fetcher);
      currentCommitSha = currentRef.object?.type === "commit" ? currentRef.object.sha : null;
      if (typeof currentCommitSha !== "string" || currentCommitSha.length === 0) throw githubContentInvalid();
    } catch {
      throw error;
    }
    if (currentCommitSha !== snapshot.baseCommitSha) {
      throw new GithubContentError(
        "GITHUB_CONFLICT",
        "다른 변경이 먼저 저장되었습니다. 최신 내용을 다시 불러와 주세요.",
        409,
        error.upstreamStatus,
      );
    }
    throw error;
  }

  return {
    resources: writtenResources.map(({ resource, contentSha, resourceDigest }) => ({ resource, contentSha, resourceDigest })),
    commitSha: commit.sha,
    baseCommitSha: commit.sha,
  };
}

export async function writeAdminResource(resource, data, sha, env, options = {}) {
  const result = await writeAdminResources([{ resource, data, sha }], env, options);
  return {
    resource,
    commitSha: result.commitSha,
    contentSha: result.resources[0].contentSha,
    resourceDigest: result.resources[0].resourceDigest,
    baseCommitSha: result.baseCommitSha,
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
