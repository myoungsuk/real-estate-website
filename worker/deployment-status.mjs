import { ADMIN_RESOURCE_PATHS } from "../src/lib/admin-resource-digest.mjs";

const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const DEPLOYMENT_DELAY_MS = 10 * 60 * 1000;

export class DeploymentStatusInputError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DeploymentStatusInputError";
    this.code = code;
    this.status = 400;
  }
}

function safeText(value, maxLength = 255) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return null;
  return /[\u0000-\u001f\u007f]/u.test(value) ? null : value;
}

export function parseDeploymentStatusTarget(url) {
  const commit = url.searchParams.get("commit")?.toLowerCase() ?? "";
  const resource = url.searchParams.get("resource") ?? "";
  const digest = url.searchParams.get("digest")?.toLowerCase() ?? "";
  const savedAtRaw = url.searchParams.get("savedAt");

  if (!COMMIT_PATTERN.test(commit)) {
    throw new DeploymentStatusInputError("DEPLOYMENT_COMMIT_INVALID", "확인할 GitHub 저장 버전이 올바르지 않습니다.");
  }
  if (!Object.hasOwn(ADMIN_RESOURCE_PATHS, resource)) {
    throw new DeploymentStatusInputError("DEPLOYMENT_RESOURCE_INVALID", "확인할 콘텐츠 종류가 올바르지 않습니다.");
  }
  if (!DIGEST_PATTERN.test(digest)) {
    throw new DeploymentStatusInputError("DEPLOYMENT_DIGEST_INVALID", "확인할 콘텐츠 식별값이 올바르지 않습니다.");
  }

  let savedAt = null;
  if (savedAtRaw !== null) {
    const timestamp = Date.parse(savedAtRaw);
    if (!Number.isFinite(timestamp)) {
      throw new DeploymentStatusInputError("DEPLOYMENT_SAVED_AT_INVALID", "GitHub 저장 시각이 올바르지 않습니다.");
    }
    savedAt = new Date(timestamp).toISOString();
  }
  return { commit, resource, digest, savedAt };
}

export function getWorkerVersionMetadata(env) {
  const metadata = env?.CF_VERSION_METADATA;
  const id = safeText(metadata?.id, 128);
  const createdAt = safeText(metadata?.timestamp, 64);
  if (!id || !createdAt || !Number.isFinite(Date.parse(createdAt))) return null;
  return { id, createdAt: new Date(createdAt).toISOString() };
}

export async function readProductionDeploymentMarker(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") throw new Error("정적 자산 binding을 사용할 수 없습니다.");
  const markerUrl = new URL("/deployment-marker.json", request.url);
  markerUrl.searchParams.set("deployment_status", crypto.randomUUID());
  const response = await env.ASSETS.fetch(new Request(markerUrl, {
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache, no-store",
    },
  }));
  if (!response.ok) throw new Error(`배포 marker HTTP ${response.status}`);
  const raw = await response.text();
  if (raw.length > 128 * 1024) throw new Error("배포 marker가 허용 크기를 넘었습니다.");
  return JSON.parse(raw);
}

function unknownResult(target, workerVersion, checkedAt, reason) {
  return {
    state: "unknown",
    savedCommit: target.commit,
    activeCommit: null,
    branch: null,
    sourceProvider: null,
    resource: target.resource,
    resourceMatched: false,
    workerVersion,
    checkedAt,
    savedAt: target.savedAt,
    pollAfterMs: null,
    reason,
  };
}

export function determineDeploymentStatus(marker, target, {
  now = Date.now(),
  workerVersion = null,
} = {}) {
  const checkedAt = new Date(now).toISOString();
  if (marker?.schemaVersion === 1) return unknownResult(target, workerVersion, checkedAt, "marker-v1");
  if (marker?.schemaVersion !== 2 || marker?.algorithm !== "sha256") {
    return unknownResult(target, workerVersion, checkedAt, "marker-invalid");
  }

  const activeCommit = COMMIT_PATTERN.test(marker.source?.commit ?? "") ? marker.source.commit : null;
  const branch = safeText(marker.source?.branch);
  const sourceProvider = ["workers-builds", "github-actions", "local"].includes(marker.source?.provider)
    ? marker.source.provider
    : null;
  const activeDigest = DIGEST_PATTERN.test(marker.resources?.[target.resource] ?? "")
    ? marker.resources[target.resource]
    : null;
  if (!activeCommit || !activeDigest || !sourceProvider) {
    return unknownResult(target, workerVersion, checkedAt, "marker-source-unknown");
  }

  const resourceMatched = activeDigest === target.digest;
  let state;
  if (resourceMatched) state = activeCommit === target.commit ? "published" : "superseded";
  else if (target.savedAt && now - Date.parse(target.savedAt) >= DEPLOYMENT_DELAY_MS) state = "delayed";
  else state = "deploying";

  return {
    state,
    savedCommit: target.commit,
    activeCommit,
    branch,
    sourceProvider,
    resource: target.resource,
    resourceMatched,
    workerVersion,
    checkedAt,
    savedAt: target.savedAt,
    pollAfterMs: state === "deploying" ? 5_000 : null,
    reason: null,
  };
}

export async function getDeploymentStatus(request, env, {
  readMarker = readProductionDeploymentMarker,
  now = Date.now(),
} = {}) {
  const target = parseDeploymentStatusTarget(new URL(request.url));
  const workerVersion = getWorkerVersionMetadata(env);
  try {
    return determineDeploymentStatus(await readMarker(request, env), target, { now, workerVersion });
  } catch {
    return unknownResult(target, workerVersion, new Date(now).toISOString(), "marker-unavailable");
  }
}
