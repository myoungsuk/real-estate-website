// marker 주소·User-Agent·요청 5초·10초 간격·30분 기준을 바꿀 때는 scripts/verify-production-deployment.mjs도 함께 본다.
import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MARKER_URL = "https://leaderscityhappy.com/deployment-marker.json";
const DEFAULT_BRANCH = "master";
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/u;

function validateOptions({ commit, markerUrl, attempts, intervalMs, timeoutMs }) {
  if (!COMMIT_PATTERN.test(commit ?? "")) throw new Error("commit은 40자리 소문자 Git SHA여야 합니다.");
  const url = new URL(markerUrl);
  if (url.protocol !== "https:") throw new Error("Production marker URL은 HTTPS여야 합니다.");
  if (!Number.isSafeInteger(attempts) || attempts < 1) throw new Error("attempts는 1 이상의 정수여야 합니다.");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 0) throw new Error("interval-ms는 0 이상의 정수여야 합니다.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) throw new Error("timeout-ms는 0 이상의 정수여야 합니다.");
}

function runGit(args, { cwd = process.cwd() } = {}) {
  return new Promise((resolvePromise) => {
    execFile("git", args, { cwd, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : -1) : 0;
      resolvePromise({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}

// 운영 marker의 commit이 push 커밋의 후손이고 branch에 포함되어 있으면 push 커밋이 운영에 포함된 것으로 본다.
export function createGitDescendantChecker({ cwd = process.cwd(), branch = DEFAULT_BRANCH, git = runGit } = {}) {
  if (!/^[A-Za-z0-9._/-]+$/u.test(branch)) throw new Error(`branch 이름이 올바르지 않습니다: ${branch}`);
  const remoteRef = `refs/remotes/origin/${branch}`;
  const decided = new Map();

  async function hasCommit(commit) {
    return (await git(["cat-file", "-e", `${commit}^{commit}`], { cwd })).code === 0;
  }

  async function isAncestor(ancestor, descendant) {
    const result = await git(["merge-base", "--is-ancestor", ancestor, descendant], { cwd });
    if (result.code === 0) return true;
    if (result.code === 1) return false;
    throw new Error(`git merge-base 실패(${result.code}): ${result.stderr.trim()}`);
  }

  return async function isDescendantOnBranch(pushedCommit, observedCommit) {
    if (!COMMIT_PATTERN.test(pushedCommit ?? "") || !COMMIT_PATTERN.test(observedCommit ?? "")) return false;
    if (pushedCommit === observedCommit) return true;
    const key = `${pushedCommit}:${observedCommit}`;
    if (decided.has(key)) return decided.get(key);

    const isOnBranch = async () => (await hasCommit(observedCommit)) && (await isAncestor(observedCommit, remoteRef));
    let onBranch = await isOnBranch();
    if (!onBranch) {
      // checkout 뒤에 branch로 들어온 커밋이면 branch를 다시 받아 확인한다.
      const fetched = await git(["fetch", "--no-tags", "--quiet", "origin", `+refs/heads/${branch}:${remoteRef}`], { cwd });
      if (fetched.code !== 0) throw new Error(`git fetch 실패(${fetched.code}): ${fetched.stderr.trim()}`);
      onBranch = await isOnBranch();
    }
    // branch에 아직 없다는 결과는 다음 조회에서 바뀔 수 있으므로 기억하지 않는다.
    if (!onBranch) return false;

    const accepted = await isAncestor(pushedCommit, observedCommit);
    decided.set(key, accepted);
    return accepted;
  };
}

export async function waitForProductionCommit({
  commit,
  markerUrl = DEFAULT_MARKER_URL,
  attempts = 180,
  intervalMs = 10_000,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  isAcceptedCommit = createGitDescendantChecker(),
  fetcher = globalThis.fetch,
  sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  now = Date.now,
  logger = console,
} = {}) {
  validateOptions({ commit, markerUrl, attempts, intervalMs, timeoutMs });
  // 조회 시간까지 포함해 시작 시각 기준으로 끝내야 job 제한(45분)보다 먼저 실패 원인을 남긴다.
  const deadline = now() + timeoutMs;
  let lastObservation = "응답 없음";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const url = new URL(markerUrl);
    url.searchParams.set("deployment_check", `${commit.slice(0, 12)}-${attempt}`);
    try {
      const response = await fetcher(url, {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          "User-Agent": "leaders-city-happy-deployment-check/1.0",
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        lastObservation = `HTTP ${response.status}`;
      } else {
        const marker = await response.json();
        const observed = marker?.schemaVersion === 2 ? marker?.source?.commit : undefined;
        if (typeof observed === "string" && COMMIT_PATTERN.test(observed)) {
          if (observed === commit) {
            logger.log(`Production 배포 확인 완료: source.commit ${commit}`);
            return { marker, observed, relation: "same" };
          }
          if (await isAcceptedCommit(commit, observed)) {
            logger.log(`Production 배포 확인 완료: source.commit ${observed}이(가) ${commit}을(를) 포함한 후속 커밋입니다.`);
            return { marker, observed, relation: "descendant" };
          }
          lastObservation = `source.commit ${observed}`;
        } else {
          lastObservation = observed === null ? "source.commit 없음" : "잘못된 marker 형식";
        }
      }
    } catch (error) {
      lastObservation = error instanceof Error ? error.message : String(error);
    }

    logger.log(`Production 배포 대기 ${attempt}/${attempts}: commit ${commit}, 현재 ${lastObservation}`);
    if (attempt >= attempts) break;
    const remainingMs = deadline - now();
    if (remainingMs <= 0) break;
    await sleep(Math.min(intervalMs, remainingMs));
  }

  throw new Error(`Production 배포 marker의 source.commit이 제한 시간 안에 ${commit} 또는 그 후속 커밋이 되지 않았습니다. last=${lastObservation}`);
}

function parseArguments(values) {
  const options = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("모든 옵션은 --이름 값 형식이어야 합니다.");
    options[key.slice(2)] = value;
  }
  return {
    commit: options.commit,
    markerUrl: options.url ?? DEFAULT_MARKER_URL,
    attempts: options.attempts === undefined ? 180 : Number(options.attempts),
    intervalMs: options["interval-ms"] === undefined ? 10_000 : Number(options["interval-ms"]),
    timeoutMs: options["timeout-ms"] === undefined ? DEFAULT_TIMEOUT_MS : Number(options["timeout-ms"]),
  };
}

async function main() {
  await waitForProductionCommit(parseArguments(process.argv.slice(2)));
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Production 배포 확인 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
