import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CONTENT_JSON_PATH = "src/data/external-links.json";
const HEALTH_PATH = ".github/automation-health.json";
const CONTENT_IMAGE_PATTERN = /^public\/images\/(?:blog|youtube)\/[A-Za-z0-9_-]+\.webp$/u;

export function classifySyncChanges(paths) {
  const uniquePaths = [...new Set(paths.map((path) => path.replaceAll("\\", "/")))];
  const contentPaths = uniquePaths.filter((path) => path === CONTENT_JSON_PATH || CONTENT_IMAGE_PATTERN.test(path));
  const healthPaths = uniquePaths.filter((path) => path === HEALTH_PATH);
  const unexpectedPaths = uniquePaths.filter((path) => !contentPaths.includes(path) && !healthPaths.includes(path));
  if (unexpectedPaths.length > 0) throw new Error(`허용 목록 밖의 변경 경로가 있습니다: ${unexpectedPaths.join(", ")}`);
  if (contentPaths.length > 0 && healthPaths.length > 0) throw new Error("콘텐츠 변경과 keepalive 변경을 같은 커밋에 포함할 수 없습니다.");
  if (contentPaths.some((path) => CONTENT_IMAGE_PATTERN.test(path)) && !contentPaths.includes(CONTENT_JSON_PATH)) {
    throw new Error("썸네일 변경에는 external-links.json 변경이 함께 있어야 합니다.");
  }
  if (contentPaths.length > 0) return { mode: "content", paths: contentPaths };
  if (healthPaths.length > 0) return { mode: "keepalive", paths: healthPaths };
  return { mode: "none", paths: [] };
}
export function parseGitStatusPorcelain(value) {
  const records = value.split("\0").filter(Boolean);
  return records.map((record) => {
    if (record.length < 4 || record[2] !== " ") throw new Error("git status 출력 형식을 해석하지 못했습니다.");
    const status = record.slice(0, 2);
    if (/[RC]/u.test(status)) throw new Error("동기화 워크플로에서는 rename/copy 변경을 허용하지 않습니다.");
    return record.slice(3);
  });
}

async function main() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git status를 실행하지 못했습니다.");
  const classification = classifySyncChanges(parseGitStatusPorcelain(result.stdout));
  console.log(`Sync change mode: ${classification.mode}`);
  for (const path of classification.paths) console.log(`- ${path}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mode=${classification.mode}\n`, "utf8");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`동기화 변경 경로 검증 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
