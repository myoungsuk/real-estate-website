import { appendFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseGitStatusPorcelain } from "./check-sync-worktree.mjs";

const ALLOWED_PATHS = new Set([
  ".github/bank-listing-sync-state.json",
  "src/data/naver-listings.json",
]);

export function classifyBankSyncChanges(paths) {
  const uniquePaths = [...new Set(paths.map((path) => path.replaceAll("\\", "/")))];
  const unexpectedPaths = uniquePaths.filter((path) => !ALLOWED_PATHS.has(path));
  if (unexpectedPaths.length > 0) throw new Error(`허용 목록 밖의 변경 경로가 있습니다: ${unexpectedPaths.join(", ")}`);
  return { mode: uniquePaths.length > 0 ? "content" : "none", paths: uniquePaths };
}

async function main() {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git status를 실행하지 못했습니다.");
  const classification = classifyBankSyncChanges(parseGitStatusPorcelain(result.stdout));
  console.log(`Bank sync change mode: ${classification.mode}`);
  for (const path of classification.paths) console.log(`- ${path}`);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mode=${classification.mode}\n`, "utf8");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`부동산뱅크 동기화 변경 경로 검증 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
