import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ADMIN_RESOURCE_PATHS,
  calculateAdminResourceDigest,
} from "../src/lib/admin-resource-digest.mjs";

export const DEPLOYMENT_MARKER_SCHEMA_VERSION = 2;

const TEXT_EXTENSIONS = new Set([
  ".astro",
  ".css",
  ".html",
  ".json",
  ".jsonc",
  ".md",
  ".mjs",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);

export const deploymentMarkerScopes = Object.freeze({
  search: [
    "astro.config.mjs",
    "src",
    "public/images",
    "public/4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3.txt",
  ],
  bank: [
    ".github/bank-listing-sync-state.json",
    ".github/listing-review-policy.json",
    ".github/listing-review-state.json",
    "src/data/naver-listings.json",
  ],
  external: [
    "src/data/external-links.json",
    "public/images/blog",
    "public/images/youtube",
  ],
  automation: [
    ".github/automation-health.json",
  ],
});

async function collectFiles(rootDir, entryPath, files) {
  const absolutePath = resolve(rootDir, entryPath);
  const entry = await lstat(absolutePath);
  if (entry.isSymbolicLink()) throw new Error(`배포 marker 입력에 심볼릭 링크를 사용할 수 없습니다: ${entryPath}`);
  if (entry.isFile()) {
    files.push(entryPath.replaceAll("\\", "/"));
    return;
  }
  if (!entry.isDirectory()) throw new Error(`배포 marker 입력은 파일 또는 디렉터리여야 합니다: ${entryPath}`);

  const children = await readdir(absolutePath, { withFileTypes: true });
  for (const child of children.sort((left, right) => left.name.localeCompare(right.name))) {
    await collectFiles(rootDir, `${entryPath}/${child.name}`, files);
  }
}

export async function calculateDeploymentScopeHash(scope, { rootDir = process.cwd() } = {}) {
  const entries = deploymentMarkerScopes[scope];
  if (!entries) throw new Error(`알 수 없는 배포 marker scope입니다: ${scope}`);

  const absoluteRoot = resolve(rootDir);
  const files = [];
  for (const entryPath of entries) await collectFiles(absoluteRoot, entryPath, files);
  files.sort((left, right) => left.localeCompare(right));

  const hash = createHash("sha256");
  for (const filePath of files) {
    const absolutePath = resolve(absoluteRoot, filePath);
    if (relative(absoluteRoot, absolutePath).startsWith("..")) throw new Error(`배포 marker 경로가 저장소 밖을 가리킵니다: ${filePath}`);
    const content = await readFile(absolutePath);
    const hashContent = TEXT_EXTENSIONS.has(extname(filePath).toLowerCase())
      ? Buffer.from(content.toString("utf8").replace(/\r\n?/gu, "\n"), "utf8")
      : content;
    hash.update(filePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(hashContent);
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function normalizeCommit(value) {
  return /^[a-f0-9]{40}$/u.test(value ?? "") ? value.toLowerCase() : null;
}

function normalizeBranch(value) {
  const branch = value?.trim();
  return branch && branch.length <= 255 && !/[\u0000-\u001f\u007f]/u.test(branch) ? branch : null;
}

export function resolveDeploymentSource(environment = process.env) {
  if (environment.WORKERS_CI === "1" || environment.WORKERS_CI_COMMIT_SHA || environment.WORKERS_CI_BRANCH) {
    return {
      commit: normalizeCommit(environment.WORKERS_CI_COMMIT_SHA),
      branch: normalizeBranch(environment.WORKERS_CI_BRANCH),
      provider: "workers-builds",
    };
  }
  if (environment.GITHUB_ACTIONS === "true" || environment.GITHUB_SHA || environment.GITHUB_REF_NAME) {
    return {
      commit: normalizeCommit(environment.GITHUB_SHA),
      branch: normalizeBranch(environment.GITHUB_REF_NAME),
      provider: "github-actions",
    };
  }
  return { commit: null, branch: null, provider: "local" };
}

export async function calculateAdminResourceDigests({ rootDir = process.cwd() } = {}) {
  const resources = {};
  const absoluteRoot = resolve(rootDir);
  for (const [resource, filePath] of Object.entries(ADMIN_RESOURCE_PATHS)) {
    const absolutePath = resolve(absoluteRoot, filePath);
    if (relative(absoluteRoot, absolutePath).startsWith("..")) {
      throw new Error(`관리자 리소스 경로가 저장소 밖을 가리킵니다: ${filePath}`);
    }
    resources[resource] = await calculateAdminResourceDigest(JSON.parse(await readFile(absolutePath, "utf8")));
  }
  return resources;
}

export async function createDeploymentMarker({ rootDir = process.cwd(), environment = process.env } = {}) {
  const scopes = {};
  for (const scope of Object.keys(deploymentMarkerScopes)) {
    scopes[scope] = await calculateDeploymentScopeHash(scope, { rootDir });
  }
  return {
    schemaVersion: DEPLOYMENT_MARKER_SCHEMA_VERSION,
    algorithm: "sha256",
    source: resolveDeploymentSource(environment),
    resources: await calculateAdminResourceDigests({ rootDir }),
    scopes,
  };
}

export async function writeDeploymentMarker({
  rootDir = process.cwd(),
  outputPath = "dist/deployment-marker.json",
} = {}) {
  const marker = await createDeploymentMarker({ rootDir });
  const absoluteOutputPath = resolve(rootDir, outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  return marker;
}

async function main() {
  const [command, value] = process.argv.slice(2);
  if (command === "print") {
    console.log(await calculateDeploymentScopeHash(value));
    return;
  }
  if (command === "write") {
    const marker = await writeDeploymentMarker();
    console.log(`Deployment marker written: ${JSON.stringify(marker.scopes)}`);
    return;
  }
  throw new Error("사용법: node scripts/deployment-marker.mjs write | print <search|bank|external|automation>");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`배포 marker 생성 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
