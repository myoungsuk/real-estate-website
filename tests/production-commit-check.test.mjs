import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGitDescendantChecker, waitForProductionCommit } from "../scripts/verify-production-commit.mjs";

const pushed = "a".repeat(40);
const later = "b".repeat(40);
const older = "c".repeat(40);

function markerResponse(commit, schemaVersion = 2) {
  return new Response(JSON.stringify({ schemaVersion, source: { commit, branch: "master", provider: "workers-builds" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const quiet = { sleep: async () => {}, logger: { log() {} }, intervalMs: 0 };

test("운영 marker가 push 커밋이 될 때까지 다시 확인한다", async () => {
  let calls = 0;
  const result = await waitForProductionCommit({
    ...quiet,
    commit: pushed,
    attempts: 3,
    isAcceptedCommit: async () => false,
    fetcher: async () => {
      calls += 1;
      return markerResponse(calls === 2 ? pushed : older);
    },
  });
  assert.equal(calls, 2);
  assert.equal(result.relation, "same");
  assert.equal(result.observed, pushed);
});

test("운영 marker가 push 커밋의 후속 커밋이면 성공으로 본다", async () => {
  const asked = [];
  const result = await waitForProductionCommit({
    ...quiet,
    commit: pushed,
    attempts: 1,
    isAcceptedCommit: async (pushedCommit, observedCommit) => {
      asked.push([pushedCommit, observedCommit]);
      return observedCommit === later;
    },
    fetcher: async () => markerResponse(later),
  });
  assert.equal(result.relation, "descendant");
  assert.deepEqual(asked, [[pushed, later]]);
});

test("후속 커밋이 아닌 marker가 계속되면 제한 시간 뒤 실패한다", async () => {
  await assert.rejects(
    waitForProductionCommit({
      ...quiet,
      commit: pushed,
      attempts: 2,
      isAcceptedCommit: async () => false,
      fetcher: async () => markerResponse(older),
    }),
    /제한 시간 안에[\s\S]*source\.commit c{40}/u,
  );
});

test("v1 marker, source.commit 없음, HTTP 오류, 조회 예외는 기다림을 계속한다", async () => {
  const responses = [
    () => markerResponse(pushed, 1),
    () => markerResponse(null),
    () => new Response("not found", { status: 404 }),
    () => {
      throw new Error("network down");
    },
    () => markerResponse(pushed),
  ];
  let calls = 0;
  const result = await waitForProductionCommit({
    ...quiet,
    commit: pushed,
    attempts: responses.length,
    isAcceptedCommit: async () => false,
    fetcher: async () => responses[calls++](),
  });
  assert.equal(calls, responses.length);
  assert.equal(result.relation, "same");
});

test("잘못된 commit과 HTTP marker 주소는 조회 전에 거부한다", async () => {
  await assert.rejects(waitForProductionCommit({ ...quiet, commit: "ABC", attempts: 1 }), /40자리 소문자 Git SHA/u);
  await assert.rejects(
    waitForProductionCommit({ ...quiet, commit: pushed, attempts: 1, markerUrl: "http://leaderscityhappy.com/deployment-marker.json" }),
    /HTTPS/u,
  );
});

test("Git 후손 판정은 branch에 포함된 후속 커밋만 허용한다", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "production-commit-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");
    const commitFile = (content) => {
      execFileSync("git", ["commit", "--quiet", "--allow-empty", "-m", content], { cwd });
      return git("rev-parse", "HEAD");
    };
    await writeFile(join(cwd, "a.txt"), "a\n");
    git("add", "a.txt");
    const first = commitFile("first");
    const second = commitFile("second");
    git("update-ref", "refs/remotes/origin/master", second);
    git("checkout", "--quiet", "-b", "side", first);
    const side = commitFile("side");

    let fetchCalls = 0;
    const gitRunner = async (args) => {
      if (args[0] === "fetch") {
        fetchCalls += 1;
        return { code: 0, stdout: "", stderr: "" };
      }
      try {
        return { code: 0, stdout: execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }), stderr: "" };
      } catch (error) {
        return { code: typeof error.status === "number" ? error.status : -1, stdout: "", stderr: String(error.stderr ?? "") };
      }
    };

    const checker = createGitDescendantChecker({ cwd, git: gitRunner });
    assert.equal(await checker(first, first), true);
    assert.equal(await checker(first, second), true);
    assert.equal(await checker(second, first), false);
    assert.equal(fetchCalls, 0);
    assert.equal(await checker(first, side), false);
    assert.equal(fetchCalls, 1);
    // branch에 아직 없다는 결과는 기억하지 않으므로 다음 조회에서 다시 받아 본다.
    assert.equal(await checker(first, side), false);
    assert.equal(fetchCalls, 2);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("조회 시간을 포함해 시작 시각 기준 제한 시간이 지나면 시도 횟수와 관계없이 끝낸다", async () => {
  let clock = 0;
  let calls = 0;
  const slept = [];
  await assert.rejects(
    waitForProductionCommit({
      commit: pushed,
      attempts: 180,
      intervalMs: 10_000,
      timeoutMs: 25_000,
      now: () => clock,
      sleep: async (milliseconds) => {
        slept.push(milliseconds);
        clock += milliseconds;
      },
      logger: { log() {} },
      isAcceptedCommit: async () => false,
      fetcher: async () => {
        calls += 1;
        clock += 5_000;
        return markerResponse(older);
      },
    }),
    /제한 시간 안에/u,
  );
  assert.equal(calls, 3);
  assert.deepEqual(slept, [10_000, 5_000]);
});

function createOriginAndClone(root) {
  const run = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  const clone = join(root, "clone");
  run(root, "init", "--quiet", "--bare", origin);
  run(root, "init", "--quiet", work);
  for (const [key, value] of [["user.email", "test@example.invalid"], ["user.name", "test"], ["commit.gpgsign", "false"]]) {
    run(work, "config", key, value);
  }
  const commitAndPush = (message) => {
    run(work, "commit", "--quiet", "--allow-empty", "-m", message);
    run(work, "push", "--quiet", origin, "HEAD:refs/heads/master");
    return run(work, "rev-parse", "HEAD");
  };
  const first = commitAndPush("first");
  run(root, "clone", "--quiet", "--branch", "master", origin, clone);
  return { run, clone, first, commitAndPush };
}

test("checkout 뒤에 master로 들어온 후속 커밋은 실제 git fetch로 받아 성공으로 본다", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-commit-origin-"));
  try {
    const { run, clone, first, commitAndPush } = createOriginAndClone(root);
    const second = commitAndPush("second");
    assert.throws(() => run(clone, "cat-file", "-e", `${second}^{commit}`));

    const result = await waitForProductionCommit({
      ...quiet,
      commit: first,
      attempts: 1,
      isAcceptedCommit: createGitDescendantChecker({ cwd: clone }),
      fetcher: async () => markerResponse(second),
    });
    assert.equal(result.relation, "descendant");
    assert.equal(run(clone, "rev-parse", "refs/remotes/origin/master"), second);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("git fetch가 실패하면 성공으로 보지 않고 기다리다 제한 시간 뒤 실패한다", async () => {
  const root = await mkdtemp(join(tmpdir(), "production-commit-fetch-fail-"));
  try {
    const { run, clone, first, commitAndPush } = createOriginAndClone(root);
    const second = commitAndPush("second");
    run(clone, "remote", "set-url", "origin", join(root, "missing.git"));

    let calls = 0;
    await assert.rejects(
      waitForProductionCommit({
        ...quiet,
        commit: first,
        attempts: 3,
        isAcceptedCommit: createGitDescendantChecker({ cwd: clone }),
        fetcher: async () => {
          calls += 1;
          return markerResponse(second);
        },
      }),
      /제한 시간 안에[\s\S]*git fetch 실패/u,
    );
    assert.equal(calls, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
