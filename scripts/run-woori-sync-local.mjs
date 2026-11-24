// 우리집부동산 공개 매물 매일 받기를 운영자 PC(국내)에서 돌린다.
// 2026-11-24: GitHub Actions 서버(해외)와 Cloudflare(미국 LAX)에서는 우리집부동산이 연결을 받지 않아(시간 초과)
// 사용자가 "이 PC에서 받기"를 골랐다. GitHub의 sync-woori-listings.yml은 꺼 두었다(disabled_manually).
// 순서는 sync-woori-listings.yml과 같다: origin/master로 맞춤 → 받기(요청 1번) → npm test·빌드·운영 빌드 검사
// → 바뀐 경로가 허용된 2개뿐인지 확인 → 커밋·push → 운영 반영 확인 → 실패 이슈 열기·닫기.
// git reset --hard·git clean을 쓰므로 받기 전용 사본(.git 안에 표시 파일이 있는 폴더)에서만 돈다.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseGitStatusPorcelain } from "./check-sync-worktree.mjs";
import { classifyWooriSyncChanges } from "./check-woori-sync-worktree.mjs";

export const WOORI_LOCAL_SYNC_MARKER = "woori-local-sync-clone";
export const WOORI_LOCAL_SYNC_ISSUE_TITLE = "우리집부동산 매물 자동 받기 실패";
const SYNC_PATHS = [".github/listing-review-state.json", "src/data/naver-listings.json"];
const LOCK_HASH_FILE = "woori-local-sync-lock";
const PRODUCTION_BUILD_ENV = { PUBLIC_SITE_URL: "https://leaderscityhappy.com", PUBLIC_ALLOW_INDEXING: "true" };

export const WOORI_LOCAL_COMMIT_MESSAGE = [
  "네이버 공개 매물 목록을 우리집부동산 최신 목록에 맞춰 자동 갱신",
  "",
  "홈페이지 매물 목록 가운데 우리집부동산에서 가져온 매물이 우리집부동산 공개 중개사 홈페이지의 최신 목록과 같아집니다.",
  "무엇: 우리집부동산 공개 목록에 새로 생기거나 내용이 바뀐 매물은 반영하고, 목록에서 내려간 매물은 지웁니다. 부동산뱅크 매물과 직접 등록 매물은 그대로 둡니다.",
  "언제: 사무소 PC의 작업 스케줄러가 매일 한 번 실행할 때 만들어집니다(우리집부동산이 해외 서버의 접속을 받지 않아 GitHub 대신 국내 PC에서 받음).",
  "확인: 반영 전에 자동 시험(npm test), 공개 자료 검사, 빌드, 검색용 운영 빌드 검사를 모두 통과했고, 바뀐 파일이 허용된 2개 안에서만 바뀌었는지 확인했습니다.",
  "반영: 커밋 뒤 운영 사이트에 이 변경이 실제로 올라갔는지 자동으로 확인합니다.",
].join("\n");

class StepError extends Error {
  constructor(step, message) {
    super(message);
    this.step = step;
  }
}

// exec(command, args, { env }) → { status, stdout, stderr }. 시험은 가짜 exec를 넘긴다.
export function defaultExec(repoDir) {
  return (command, args, { env } = {}) => {
    const result = spawnSync(command, args, {
      cwd: repoDir,
      encoding: "utf8",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
      // npm은 Windows에서 npm.cmd라 shell이 필요하다. 인자는 이 파일에 적은 고정 글자뿐이다.
      shell: command === "npm" && process.platform === "win32",
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
    });
    return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? String(result.error ?? "") };
  };
}

export async function runWooriLocalSync({ repoDir, exec = defaultExec(repoDir), log = () => {} }) {
  const gitDir = join(repoDir, ".git");
  if (!existsSync(join(gitDir, WOORI_LOCAL_SYNC_MARKER))) {
    throw new Error(`받기 전용 사본이 아닙니다(.git/${WOORI_LOCAL_SYNC_MARKER} 없음). git reset --hard를 쓰므로 다른 폴더에서는 돌리지 않습니다.`);
  }

  let step = "준비";
  const run = (name, command, args, options = {}) => {
    step = name;
    log(`[${name}] ${command} ${args.join(" ")}`);
    const result = exec(command, args, options);
    if (result.stdout) log(result.stdout.trimEnd());
    if (result.stderr) log(result.stderr.trimEnd());
    if (result.status !== 0 && !options.allowFailure) throw new StepError(name, `${name} 단계가 실패했습니다(종료 코드 ${result.status}).`);
    return result;
  };

  const verify = () => {
    run("시험", "npm", ["test"]);
    run("빌드", "npm", ["run", "build"]);
    run("운영 빌드", "npm", ["run", "build:site"], { env: PRODUCTION_BUILD_ENV });
    run("운영 빌드 검사", "npm", ["run", "assert:production-build"], { env: PRODUCTION_BUILD_ENV });
    return run("운영 표시값", "node", ["scripts/deployment-marker.mjs", "print", "bank"]).stdout.trim();
  };

  let outcome = "failed";
  let failedStep = null;
  let committed = false;
  try {
    // 지난 실행이 다시 얹기 도중 멈췄으면 먼저 푼다(받기 전용 사본이라 지워도 되는 상태뿐이다).
    run("사본 맞추기", "git", ["rebase", "--abort"], { allowFailure: true });
    run("최신 받기", "git", ["fetch", "--prune", "origin", "master"]);
    run("사본 맞추기", "git", ["checkout", "--force", "-B", "master", "origin/master"]);
    run("사본 맞추기", "git", ["reset", "--hard", "origin/master"]);
    run("사본 맞추기", "git", ["clean", "-fd"]);

    step = "의존성";
    const lockHash = createHash("sha256").update(readFileSync(join(repoDir, "package-lock.json"))).digest("hex");
    const lockHashPath = join(gitDir, LOCK_HASH_FILE);
    const savedHash = existsSync(lockHashPath) ? readFileSync(lockHashPath, "utf8").trim() : "";
    if (savedHash !== lockHash || !existsSync(join(repoDir, "node_modules"))) {
      run("의존성", "npm", ["ci"]);
      writeFileSync(lockHashPath, `${lockHash}\n`, "utf8");
    }

    // 우리집부동산 요청은 이 단계 한 번뿐이다(scripts/sync-woori-listings.mjs가 1번 부르고 다시 시도하지 않음).
    run("우리집부동산 받기", "node", ["scripts/sync-woori-listings.mjs"]);
    let expectedMarker = verify();

    step = "바뀐 경로 확인";
    const status = run("바뀐 경로 확인", "git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).stdout;
    let classification;
    try {
      classification = classifyWooriSyncChanges(parseGitStatusPorcelain(status));
    } catch (error) {
      throw new StepError("바뀐 경로 확인", error.message);
    }
    if (classification.mode === "none") {
      log("바뀐 매물이 없어 커밋하지 않습니다.");
      outcome = "ok";
    } else {
      run("커밋", "git", ["add", "--", ...SYNC_PATHS]);
      const messagePath = join(gitDir, "woori-local-sync-message.txt");
      writeFileSync(messagePath, `${WOORI_LOCAL_COMMIT_MESSAGE}\n`, "utf8");
      run("커밋", "git", ["commit", "-F", messagePath]);
      committed = true;

      const pushed = run("올리기", "git", ["push", "origin", "HEAD:master"], { allowFailure: true });
      if (pushed.status !== 0) {
        // 그 사이 master가 앞으로 갔으면 한 번만 다시 얹는다. 우리집부동산은 다시 부르지 않는다.
        run("다시 얹기", "git", ["fetch", "--prune", "origin", "master"]);
        const rebased = run("다시 얹기", "git", ["rebase", "origin/master"], { allowFailure: true });
        if (rebased.status !== 0) {
          run("다시 얹기", "git", ["rebase", "--abort"], { allowFailure: true });
          throw new StepError("다시 얹기", "master가 같은 파일을 바꿔 다시 얹지 못했습니다. 다음 실행에서 다시 받습니다.");
        }
        const changed = run("다시 얹기", "git", ["diff", "--name-only", "origin/master", "HEAD"]).stdout.split(/\r?\n/u).filter(Boolean);
        try {
          classifyWooriSyncChanges(changed);
        } catch (error) {
          throw new StepError("다시 얹기", error.message);
        }
        expectedMarker = verify();
        run("올리기", "git", ["push", "origin", "HEAD:master"]);
      }
      run("운영 반영 확인", "node", ["scripts/verify-production-deployment.mjs", "--scope", "bank", "--expected", expectedMarker]);
      outcome = "ok";
    }
  } catch (error) {
    failedStep = error instanceof StepError ? error.step : step;
    log(`실패: ${failedStep} — ${error.message}`);
  }

  try {
    updateFailureIssue({ exec, log, outcome, failedStep, committed });
  } catch (error) {
    log(`알림 이슈를 다루지 못했습니다: ${error.message}`);
  }
  return { outcome, failedStep, committed };
}

// 봇(옛 GitHub 작업)이나 이 PC의 gh 계정이 연 같은 제목의 열린 이슈만 다룬다.
function updateFailureIssue({ exec, log, outcome, failedStep, committed }) {
  const me = exec("gh", ["api", "user", "--jq", ".login"]);
  if (me.status !== 0) throw new Error("gh 로그인 계정을 읽지 못했습니다.");
  const login = me.stdout.trim();
  const listed = exec("gh", ["issue", "list", "--state", "open", "--limit", "200", "--json", "number,title,author"]);
  if (listed.status !== 0) throw new Error("이슈 목록을 읽지 못했습니다.");
  const issue = JSON.parse(listed.stdout || "[]")
    .find((item) => item.title === WOORI_LOCAL_SYNC_ISSUE_TITLE && (item.author?.is_bot || item.author?.login === login));

  if (outcome === "ok") {
    if (issue) exec("gh", ["issue", "close", String(issue.number), "--comment", "사무소 PC의 다음 실행이 성공해 닫습니다."]);
    return;
  }
  // 이슈 본문에는 멈춘 단계 이름만 넣는다(공개 저장소라 로그·PC 경로·비밀값은 넣지 않음).
  const body = [
    "사무소 PC에서 매일 우리집부동산 공개 매물을 받아 홈페이지 목록에 반영하는 작업이 실패했습니다. 홈페이지 매물 목록에 이번 변경이 반영되지 않았을 수 있습니다.",
    "",
    `- 멈춘 곳: ${failedStep ?? "확인 못 함"}`,
    `- 커밋: ${committed ? "만들었으나 올리기 또는 운영 반영 확인에서 멈춤" : "만들지 않음(홈페이지 자료 그대로)"}`,
    "",
    "자세한 기록은 사무소 PC의 받기 기록에 있습니다. 우리집부동산은 짧은 시간에 여러 번 부르면 IP를 막으므로 손으로 다시 돌릴 때는 한 번만 돌립니다. 다음 실행이 성공하면 이 이슈가 저절로 닫힙니다. 급하면 관리자 '매물 등록·동기화'의 우리집부동산 엑셀 가져오기를 씁니다.",
  ].join("\n");
  const result = issue
    ? exec("gh", ["issue", "comment", String(issue.number), "--body", body])
    : exec("gh", ["issue", "create", "--title", WOORI_LOCAL_SYNC_ISSUE_TITLE, "--body", body]);
  if (result.status !== 0) log("알림 이슈를 쓰지 못했습니다.");
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--log-dir") options.logDir = argv[++index];
    else throw new Error(`모르는 인자입니다: ${argv[index]}`);
  }
  if (!options.logDir) throw new Error("사용법: node scripts/run-woori-sync-local.mjs --log-dir <받기 기록 폴더>");
  return options;
}

async function main() {
  const { logDir } = parseArguments(process.argv.slice(2));
  mkdirSync(logDir, { recursive: true });
  // 받기 기록은 최근 60개만 남긴다(이 스크립트가 만든 .log 파일만 지움).
  const oldLogs = readdirSync(logDir).filter((name) => /^\d{4}-\d{2}-\d{2}_\d{6}\.log$/u.test(name)).sort().slice(0, -59);
  for (const name of oldLogs) rmSync(join(logDir, name));
  const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" }).replace(" ", "_").replaceAll(":", "");
  const logPath = resolve(logDir, `${stamp}.log`);
  const log = (line) => appendFileSync(logPath, `${line}\n`, "utf8");
  log(`시작 ${new Date().toISOString()}`);
  const result = await runWooriLocalSync({ repoDir: process.cwd(), log });
  log(`끝 ${new Date().toISOString()} ${JSON.stringify(result)}`);
  console.log(`우리집부동산 PC 받기: ${result.outcome}${result.failedStep ? ` (${result.failedStep})` : ""}`);
  if (result.outcome !== "ok") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`우리집부동산 PC 받기 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
