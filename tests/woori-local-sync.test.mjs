import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWooriLocalSync, WOORI_LOCAL_SYNC_ISSUE_TITLE, WOORI_LOCAL_SYNC_MARKER } from "../scripts/run-woori-sync-local.mjs";

const CHANGED = "M  .github/listing-review-state.json\0M  src/data/naver-listings.json\0";

function makeRepo({ marker = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "woori-local-"));
  mkdirSync(join(dir, ".git"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "package-lock.json"), "{}\n");
  if (marker) writeFileSync(join(dir, ".git", WOORI_LOCAL_SYNC_MARKER), "");
  return dir;
}

// 명령마다 정해 둔 결과를 돌려주고, 부른 순서를 적는 가짜 exec.
function fakeExec({ status = CHANGED, fail = () => false, issues = [], pushFailures = 0, rebaseFails = false, diff = ".github/listing-review-state.json\nsrc/data/naver-listings.json\n" } = {}) {
  const calls = [];
  let pushes = 0;
  const exec = (command, args) => {
    const line = `${command} ${args.join(" ")}`;
    calls.push(line);
    if (fail(line)) return { status: 1, stdout: "", stderr: "실패" };
    if (line.startsWith("git status")) return { status: 0, stdout: status, stderr: "" };
    if (line.startsWith("git push")) {
      pushes += 1;
      return pushes <= pushFailures ? { status: 1, stdout: "", stderr: "rejected" } : { status: 0, stdout: "", stderr: "" };
    }
    if (line === "git rebase origin/master" && rebaseFails) return { status: 1, stdout: "", stderr: "conflict" };
    if (line.startsWith("git diff --name-only")) return { status: 0, stdout: diff, stderr: "" };
    if (line.startsWith("node scripts/deployment-marker.mjs print bank")) return { status: 0, stdout: `marker-${pushes}\n`, stderr: "" };
    if (line === "gh api user --jq .login") return { status: 0, stdout: "office\n", stderr: "" };
    if (line.startsWith("gh issue list")) return { status: 0, stdout: JSON.stringify(issues), stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  return { exec, calls };
}

const countSync = (calls) => calls.filter((line) => line === "node scripts/sync-woori-listings.mjs").length;

test("받기 전용 표시 파일이 없는 폴더에서는 아무 명령도 부르지 않는다", async () => {
  const repoDir = makeRepo({ marker: false });
  const { exec, calls } = fakeExec();
  try {
    await assert.rejects(runWooriLocalSync({ repoDir, exec }), /받기 전용 사본이 아닙니다/u);
    assert.deepEqual(calls, []);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("정상이면 맞추기 → 받기 1번 → 시험·빌드 → 경로 확인 → 커밋·올리기 → 운영 확인 순서이고 열린 실패 이슈를 닫는다", async () => {
  const repoDir = makeRepo();
  const { exec, calls } = fakeExec({ issues: [{ number: 159, title: WOORI_LOCAL_SYNC_ISSUE_TITLE, author: { login: "github-actions", is_bot: true } }] });
  try {
    const result = await runWooriLocalSync({ repoDir, exec });
    assert.deepEqual(result, { outcome: "ok", failedStep: null, committed: true });
    assert.equal(countSync(calls), 1);
    const order = [
      "git reset --hard origin/master",
      "node scripts/sync-woori-listings.mjs",
      "npm test",
      "npm run build",
      "npm run assert:production-build",
      "git status --porcelain=v1 -z --untracked-files=all",
      "git add -- .github/listing-review-state.json src/data/naver-listings.json",
      "git push origin HEAD:master",
      "node scripts/verify-production-deployment.mjs --scope bank --expected marker-0",
      "gh issue close 159 --comment 사무소 PC의 다음 실행이 성공해 닫습니다.",
    ].map((line) => calls.indexOf(line));
    assert.ok(order.every((index) => index >= 0), `빠진 명령: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    // lock 지문이 처음이라 npm ci를 한 번 부른다.
    assert.equal(calls.filter((line) => line === "npm ci").length, 1);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("올리기가 밀리면 다시 얹고 시험·빌드를 다시 한 뒤 한 번만 더 올리며, 우리집부동산은 다시 부르지 않는다", async () => {
  const repoDir = makeRepo();
  const { exec, calls } = fakeExec({ pushFailures: 1 });
  try {
    const result = await runWooriLocalSync({ repoDir, exec });
    assert.equal(result.outcome, "ok");
    assert.equal(countSync(calls), 1);
    assert.equal(calls.filter((line) => line === "npm test").length, 2);
    assert.equal(calls.filter((line) => line.startsWith("git push")).length, 2);
    assert.ok(calls.includes("node scripts/verify-production-deployment.mjs --scope bank --expected marker-1"));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("다시 얹기가 충돌하면 풀고 실패로 알리며 올리지 않는다", async () => {
  const repoDir = makeRepo();
  const { exec, calls } = fakeExec({ pushFailures: 1, rebaseFails: true });
  try {
    const result = await runWooriLocalSync({ repoDir, exec });
    assert.deepEqual(result, { outcome: "failed", failedStep: "다시 얹기", committed: true });
    assert.equal(calls.filter((line) => line.startsWith("git push")).length, 1);
    assert.ok(calls.includes("git rebase --abort"));
    assert.ok(calls.some((line) => line.startsWith(`gh issue create --title ${WOORI_LOCAL_SYNC_ISSUE_TITLE} --body`)));
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("다시 얹은 뒤 허용 밖 경로가 섞이면 올리지 않는다", async () => {
  const repoDir = makeRepo();
  const { exec, calls } = fakeExec({ pushFailures: 1, diff: "src/data/naver-listings.json\npackage.json\n" });
  try {
    const result = await runWooriLocalSync({ repoDir, exec });
    assert.equal(result.failedStep, "다시 얹기");
    assert.equal(calls.filter((line) => line.startsWith("git push")).length, 1);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("받기가 실패하면 시험·커밋 없이 열린 이슈에 단계 이름만 적은 댓글을 단다", async () => {
  const repoDir = makeRepo();
  const { exec, calls } = fakeExec({
    fail: (line) => line === "node scripts/sync-woori-listings.mjs",
    issues: [
      { number: 7, title: WOORI_LOCAL_SYNC_ISSUE_TITLE, author: { login: "someone", is_bot: false } },
      { number: 159, title: WOORI_LOCAL_SYNC_ISSUE_TITLE, author: { login: "github-actions", is_bot: true } },
    ],
  });
  try {
    const result = await runWooriLocalSync({ repoDir, exec });
    assert.deepEqual(result, { outcome: "failed", failedStep: "우리집부동산 받기", committed: false });
    assert.equal(countSync(calls), 1);
    assert.ok(!calls.includes("npm test"));
    assert.ok(!calls.some((line) => line.startsWith("git commit") || line.startsWith("git push")));
    const comment = calls.find((line) => line.startsWith("gh issue comment"));
    assert.ok(comment.startsWith("gh issue comment 159 --body"), "다른 사람이 연 이슈는 건드리지 않음");
    assert.match(comment, /멈춘 곳: 우리집부동산 받기/u);
    assert.doesNotMatch(comment, /[A-Za-z]:\\|\/Users\/|실패$/u);
  } finally {
    rmSync(repoDir, { recursive: true, force: true });
  }
});

test("바뀐 매물이 없으면 커밋하지 않고 성공이며, 허용 밖 경로가 바뀌면 커밋하지 않고 실패다", async () => {
  for (const [status, expected] of [["", "ok"], [`${CHANGED}M  package.json\0`, "failed"]]) {
    const repoDir = makeRepo();
    const { exec, calls } = fakeExec({ status });
    try {
      const result = await runWooriLocalSync({ repoDir, exec });
      assert.equal(result.outcome, expected);
      assert.equal(result.committed, false);
      assert.ok(!calls.some((line) => line.startsWith("git commit") || line.startsWith("git push")));
    } finally {
      rmSync(repoDir, { recursive: true, force: true });
    }
  }
});
