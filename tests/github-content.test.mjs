import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_RESOURCE_PATHS } from "../worker/admin-resource-validation.mjs";
import { calculateAdminResourceDigest } from "../src/lib/admin-resource-digest.mjs";
import {
  readAdminResource,
  readAdminResourceHistory,
  readAdminResourceRevision,
  readAdminResourcesSnapshot,
  uploadAdminImage,
  validateWebpBytes,
  writeAdminResource,
  writeAdminResources,
} from "../worker/github-content.mjs";

const validWebpBytes = Uint8Array.from(
  Buffer.from("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoCAAMAAUAmJaQAA3AA/vz0AAA=", "base64"),
);
const validAlphaWebpBytes = Uint8Array.from(
  Buffer.from("UklGRl4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAwAAAA0AEAnQEqAgADAAFAJiWgAnS6AfgAA7AA/vLrf/zYFc1z7/f/0uD9Lg/S4P/SkAAA", "base64"),
);

function webpDataUrl(bytes) {
  return `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
}

function appendWebpChunk(bytes, type, payload = new Uint8Array()) {
  const padding = payload.length % 2;
  const next = new Uint8Array(bytes.length + 8 + payload.length + padding);
  next.set(bytes);
  next.set(Buffer.from(type, "ascii"), bytes.length);
  const view = new DataView(next.buffer);
  view.setUint32(bytes.length + 4, payload.length, true);
  next.set(payload, bytes.length + 8);
  view.setUint32(4, next.length - 8, true);
  return next;
}

const env = {
  GITHUB_CONTENTS_TOKEN: "test-token",
  GITHUB_REPOSITORY: "owner/repository",
  GITHUB_BRANCH: "master",
};

const baseCommitSha = "a".repeat(40);
const baseTreeSha = "b".repeat(40);
const resourceEntries = Object.entries(ADMIN_RESOURCE_PATHS).map(([resource, path], index) => ({
  resource,
  path,
  sha: (index + 1).toString(16).repeat(40),
  data: { resource },
}));
const resourceSnapshot = {
  baseCommitSha,
  treeSha: baseTreeSha,
  resources: Object.fromEntries(resourceEntries.map(({ resource, sha, data }) => [
    resource,
    { resource, sha, data },
  ])),
};

function createSnapshotFetcher(calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/ref/heads/master")) {
      return Response.json({ object: { type: "commit", sha: baseCommitSha } });
    }
    if (url.endsWith(`/git/commits/${baseCommitSha}`)) {
      return Response.json({ sha: baseCommitSha, tree: { sha: baseTreeSha } });
    }
    if (url.endsWith(`/git/trees/${baseTreeSha}?recursive=1`)) {
      return Response.json({
        truncated: false,
        tree: resourceEntries.map(({ path, sha }) => ({ path, type: "blob", mode: "100644", sha })),
      });
    }
    const entry = resourceEntries.find(({ sha }) => url.endsWith(`/git/blobs/${sha}`));
    if (entry) {
      return Response.json({
        encoding: "base64",
        content: Buffer.from(`${JSON.stringify(entry.data)}\n`).toString("base64"),
      });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };
}

test("허용 목록에 없는 GitHub 콘텐츠 경로는 요청 전에 차단한다", async () => {
  let called = false;
  await assert.rejects(
    readAdminResource("../../workflows", env, async () => { called = true; return new Response(); }),
    (error) => error.code === "RESOURCE_NOT_ALLOWED" && error.status === 404,
  );
  assert.equal(called, false);
});

test("관리자 JSON 전체는 한 branch-tip commit과 tree에서 읽는다", async () => {
  const calls = [];
  const snapshot = await readAdminResourcesSnapshot(env, createSnapshotFetcher(calls));

  assert.equal(snapshot.baseCommitSha, baseCommitSha);
  assert.equal(snapshot.treeSha, baseTreeSha);
  assert.deepEqual(Object.keys(snapshot.resources), Object.keys(ADMIN_RESOURCE_PATHS));
  assert.deepEqual(snapshot.resources.listings.data, { resource: "listings" });
  assert.equal(calls.filter(({ url }) => url.endsWith("/git/ref/heads/master")).length, 1);
  assert.equal(calls.filter(({ url }) => url.includes("/git/blobs/")).length, resourceEntries.length);
});

test("단일 관리자 JSON 조회도 고정 commit을 응답에 포함한다", async () => {
  const result = await readAdminResource("listings", env, createSnapshotFetcher());
  assert.equal(result.baseCommitSha, baseCommitSha);
  assert.equal(result.sha, resourceSnapshot.resources.listings.sha);
  assert.deepEqual(result.data, { resource: "listings" });
});

test("콘텐츠 변경 이력은 현재 branch의 허용 경로만 최대 건수와 cursor로 조회한다", async () => {
  const commits = ["c".repeat(40), "d".repeat(40), "e".repeat(40)];
  const trees = ["1".repeat(40), "2".repeat(40), "3".repeat(40)];
  const blobs = ["4".repeat(40), "5".repeat(40), "6".repeat(40)];
  const calls = [];
  const result = await readAdminResourceHistory("home-content", { limit: 2 }, env, async (url, init) => {
    calls.push({ url, init });
    if (url.includes("/commits?")) {
      const parsed = new URL(url);
      assert.equal(parsed.searchParams.get("sha"), "master");
      assert.equal(parsed.searchParams.get("path"), ADMIN_RESOURCE_PATHS["home-content"]);
      assert.equal(parsed.searchParams.get("per_page"), "3");
      return Response.json(commits.map((sha, index) => ({
        sha,
        commit: {
          message: index === 0 ? "관리자: 공개 문구 수정\n상세" : "owner@example.com 010-1234-5678 수정",
          author: { name: index === 0 ? "관리자" : "owner@example.com", date: `2026-08-${30 - index}T01:02:03Z` },
          committer: { date: `2026-08-${30 - index}T01:02:03Z` },
          tree: { sha: trees[index] },
        },
      })));
    }
    const treeIndex = trees.findIndex((sha) => url.includes(`/git/trees/${sha}`));
    if (treeIndex >= 0) {
      return Response.json({
        truncated: false,
        tree: [{ path: ADMIN_RESOURCE_PATHS["home-content"], type: "blob", sha: blobs[treeIndex] }],
      });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  });

  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].title, "관리자: 공개 문구 수정");
  assert.doesNotMatch(JSON.stringify(result), /owner@example\.com|010-1234-5678/u);
  assert.equal(result.entries[1].resourceBlobSha, blobs[1]);
  assert.equal(result.entries.every((entry) => entry.onCurrentBranch && entry.productionMatched === null), true);
  assert.match(result.nextCursor, /^[A-Za-z0-9_-]+$/u);
  assert.equal(calls.filter(({ url }) => url.includes("/git/trees/")).length, 2);
});

test("과거 JSON은 현재 branch의 조상 commit인지 확인한 뒤 허용 resource blob만 읽는다", async () => {
  const sourceCommit = "c".repeat(40);
  const treeSha = "d".repeat(40);
  const blobSha = "e".repeat(40);
  const calls = [];
  const result = await readAdminResourceRevision("home-content", sourceCommit, env, async (url, init) => {
    calls.push({ url, init });
    if (url.includes(`/compare/${sourceCommit}...master`)) {
      return Response.json({ status: "ahead", merge_base_commit: { sha: sourceCommit } });
    }
    if (url.endsWith(`/git/commits/${sourceCommit}`)) return Response.json({ tree: { sha: treeSha } });
    if (url.endsWith(`/git/trees/${treeSha}?recursive=1`)) {
      return Response.json({
        truncated: false,
        tree: [{ path: ADMIN_RESOURCE_PATHS["home-content"], type: "blob", sha: blobSha }],
      });
    }
    if (url.endsWith(`/git/blobs/${blobSha}`)) {
      return Response.json({ encoding: "base64", content: Buffer.from('{"past":true}\n').toString("base64") });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  });

  assert.equal(result.sourceCommit, sourceCommit);
  assert.equal(result.sha, blobSha);
  assert.deepEqual(result.data, { past: true });
  assert.equal(calls.length, 4);
});

test("현재 branch 밖의 commit과 GitHub rate limit은 안전하게 실패한다", async () => {
  const sourceCommit = "c".repeat(40);
  let calls = 0;
  await assert.rejects(
    readAdminResourceRevision("home-content", sourceCommit, env, async () => {
      calls += 1;
      return Response.json({ status: "diverged", merge_base_commit: { sha: "f".repeat(40) } });
    }),
    (error) => error.code === "HISTORY_COMMIT_DENIED" && error.status === 400,
  );
  assert.equal(calls, 1);

  await assert.rejects(
    readAdminResourceHistory("home-content", { limit: 10 }, env, async () => Response.json({}, { status: 429 })),
    (error) => error.code === "GITHUB_RATE_LIMITED" && error.status === 503 && error.upstreamStatus === 429,
  );
  await assert.rejects(
    readAdminResourceHistory("home-content", { limit: 10 }, env, async () => Response.json({}, { status: 503 })),
    (error) => error.code === "GITHUB_UNAVAILABLE" && error.status === 502 && error.upstreamStatus === 503,
  );
});

test("GitHub JSON 저장은 base tree에 단일 commit을 만들고 ref를 강제 없이 갱신한다", async () => {
  const newBlobSha = "c".repeat(40);
  const newTreeSha = "d".repeat(40);
  const newCommitSha = "e".repeat(40);
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: newBlobSha }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: newTreeSha }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: newCommitSha }, { status: 201 });
    if (url.endsWith("/git/refs/heads/master")) {
      return Response.json({ ref: "refs/heads/master", object: { sha: newCommitSha } });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };
  const result = await writeAdminResource(
    "listings",
    [],
    resourceSnapshot.resources.listings.sha,
    env,
    { fetcher, snapshot: resourceSnapshot },
  );

  assert.equal(calls.length, 4);
  const blobBody = JSON.parse(calls[0].init.body);
  const treeBody = JSON.parse(calls[1].init.body);
  const commitBody = JSON.parse(calls[2].init.body);
  const refBody = JSON.parse(calls[3].init.body);
  assert.equal(atob(blobBody.content), "[]\n");
  assert.equal(blobBody.encoding, "base64");
  assert.equal(treeBody.base_tree, baseTreeSha);
  assert.deepEqual(treeBody.tree, [{
    path: ADMIN_RESOURCE_PATHS.listings,
    mode: "100644",
    type: "blob",
    sha: newBlobSha,
  }]);
  assert.deepEqual(commitBody.parents, [baseCommitSha]);
  assert.equal(commitBody.tree, newTreeSha);
  assert.deepEqual(refBody, { sha: newCommitSha, force: false });
  assert.deepEqual(result, {
    resource: "listings",
    commitSha: newCommitSha,
    contentSha: newBlobSha,
    resourceDigest: await calculateAdminResourceDigest([]),
    baseCommitSha: newCommitSha,
  });
});

test("여러 관리자 JSON은 복수 blob과 한 tree, 한 commit, 한 ref 갱신으로 저장한다", async () => {
  const blobShas = ["c".repeat(40), "d".repeat(40)];
  const newTreeSha = "e".repeat(40);
  const newCommitSha = "f".repeat(40);
  const calls = [];
  let blobIndex = 0;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) {
      const sha = blobShas[blobIndex];
      blobIndex += 1;
      return Response.json({ sha }, { status: 201 });
    }
    if (url.endsWith("/git/trees")) return Response.json({ sha: newTreeSha }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: newCommitSha }, { status: 201 });
    if (url.endsWith("/git/refs/heads/master")) {
      return Response.json({ ref: "refs/heads/master", object: { sha: newCommitSha } });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };
  const changes = [
    {
      resource: "listings",
      data: [],
      sha: resourceSnapshot.resources.listings.sha,
    },
    {
      resource: "faq",
      data: [{ category: "가격과 시세", question: "질문", answer: "답변" }],
      sha: resourceSnapshot.resources.faq.sha,
    },
  ];

  const result = await writeAdminResources(changes, env, { fetcher, snapshot: resourceSnapshot });

  assert.equal(calls.length, 5);
  assert.deepEqual(
    calls.slice(0, 2).map(({ init }) => Buffer.from(JSON.parse(init.body).content, "base64").toString("utf8")),
    [
      "[]\n",
      `${JSON.stringify(changes[1].data, null, 2)}\n`,
    ],
  );
  const treeBody = JSON.parse(calls[2].init.body);
  const commitBody = JSON.parse(calls[3].init.body);
  const refBody = JSON.parse(calls[4].init.body);
  assert.equal(treeBody.base_tree, baseTreeSha);
  assert.deepEqual(treeBody.tree, [
    { path: ADMIN_RESOURCE_PATHS.listings, mode: "100644", type: "blob", sha: blobShas[0] },
    { path: ADMIN_RESOURCE_PATHS.faq, mode: "100644", type: "blob", sha: blobShas[1] },
  ]);
  assert.equal(commitBody.message, "관리자: listings, faq 콘텐츠 일괄 수정");
  assert.deepEqual(commitBody.parents, [baseCommitSha]);
  assert.equal(commitBody.tree, newTreeSha);
  assert.deepEqual(refBody, { sha: newCommitSha, force: false });
  assert.deepEqual(result, {
    resources: [
      { resource: "listings", contentSha: blobShas[0], resourceDigest: await calculateAdminResourceDigest(changes[0].data) },
      { resource: "faq", contentSha: blobShas[1], resourceDigest: await calculateAdminResourceDigest(changes[1].data) },
    ],
    commitSha: newCommitSha,
    baseCommitSha: newCommitSha,
  });
});

test("blob, tree, commit의 422는 충돌이 아니라 GitHub 장애로 처리한다", async () => {
  for (const failureStage of ["blob", "tree", "commit"]) {
    const calls = [];
    const fetcher = async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/git/blobs")) {
        return failureStage === "blob"
          ? Response.json({ message: "Validation Failed" }, { status: 422 })
          : Response.json({ sha: "c".repeat(40) }, { status: 201 });
      }
      if (url.endsWith("/git/trees")) {
        return failureStage === "tree"
          ? Response.json({ message: "Validation Failed" }, { status: 422 })
          : Response.json({ sha: "d".repeat(40) }, { status: 201 });
      }
      if (url.endsWith("/git/commits")) {
        return failureStage === "commit"
          ? Response.json({ message: "Validation Failed" }, { status: 422 })
          : Response.json({ sha: "e".repeat(40) }, { status: 201 });
      }
      throw new Error(`실패 단계 뒤 호출되면 안 됩니다: ${url}`);
    };

    await assert.rejects(
      writeAdminResource(
        "listings",
        [],
        resourceSnapshot.resources.listings.sha,
        env,
        { fetcher, snapshot: resourceSnapshot },
      ),
      (error) => error.code === "GITHUB_UNAVAILABLE" && error.status === 502,
    );
    assert.equal(calls.length, { blob: 1, tree: 2, commit: 3 }[failureStage]);
    assert.equal(calls.some(({ url }) => url.endsWith("/git/refs/heads/master")), false);
  }
});

test("두 번째 blob 생성이 실패하면 tree, commit, ref를 호출하지 않는다", async () => {
  const calls = [];
  let blobIndex = 0;
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (!url.endsWith("/git/blobs")) throw new Error(`blob 실패 뒤 호출되면 안 됩니다: ${url}`);
    blobIndex += 1;
    return blobIndex === 1
      ? Response.json({ sha: "c".repeat(40) }, { status: 201 })
      : Response.json({ message: "Validation Failed" }, { status: 422 });
  };

  await assert.rejects(
    writeAdminResources([
      { resource: "listings", data: [], sha: resourceSnapshot.resources.listings.sha },
      { resource: "faq", data: [], sha: resourceSnapshot.resources.faq.sha },
    ], env, { fetcher, snapshot: resourceSnapshot }),
    (error) => error.code === "GITHUB_UNAVAILABLE" && error.status === 502,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls.every(({ url }) => url.endsWith("/git/blobs")), true);
});

test("일괄 저장은 빈 변경, 중복 또는 허용되지 않은 resource를 Git 쓰기 전에 거부한다", async () => {
  const cases = [
    { changes: [], code: "CHANGES_REQUIRED" },
    {
      changes: [
        { resource: "faq", data: [], sha: resourceSnapshot.resources.faq.sha },
        { resource: "faq", data: [], sha: resourceSnapshot.resources.faq.sha },
      ],
      code: "DUPLICATE_RESOURCE",
    },
    { changes: [{ resource: "../faq", data: [], sha: "sha" }], code: "RESOURCE_NOT_ALLOWED" },
  ];

  for (const { changes, code } of cases) {
    let called = false;
    await assert.rejects(
      writeAdminResources(changes, env, {
        snapshot: resourceSnapshot,
        fetcher: async () => { called = true; return new Response(); },
      }),
      (error) => error.code === code,
    );
    assert.equal(called, false);
  }
});

test("일괄 저장은 변경 중 한 파일의 SHA가 오래됐으면 모든 Git 쓰기를 생략한다", async () => {
  let called = false;
  await assert.rejects(
    writeAdminResources([
      { resource: "listings", data: [], sha: resourceSnapshot.resources.listings.sha },
      { resource: "faq", data: [], sha: "stale-sha" },
    ], env, {
      snapshot: resourceSnapshot,
      fetcher: async () => { called = true; return new Response(); },
    }),
    (error) => error.code === "GITHUB_CONFLICT" && error.status === 409,
  );
  assert.equal(called, false);
});

test("일괄 저장도 snapshot 이후 branch가 이동하면 ref 갱신에서 409로 중단한다", async () => {
  const calls = [];
  let blobIndex = 0;
  const movedCommitSha = "9".repeat(40);
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) {
      blobIndex += 1;
      return Response.json({ sha: String(blobIndex + 2).repeat(40) }, { status: 201 });
    }
    if (url.endsWith("/git/trees")) return Response.json({ sha: "d".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "e".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/refs/heads/master")) {
      return Response.json({ message: "Reference update failed" }, { status: 422 });
    }
    if (url.endsWith("/git/ref/heads/master")) {
      return Response.json({ object: { type: "commit", sha: movedCommitSha } });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };

  await assert.rejects(
    writeAdminResources([
      { resource: "listings", data: [], sha: resourceSnapshot.resources.listings.sha },
      { resource: "faq", data: [], sha: resourceSnapshot.resources.faq.sha },
    ], env, { fetcher, snapshot: resourceSnapshot }),
    (error) => error.code === "GITHUB_CONFLICT" && error.status === 409,
  );
  assert.equal(calls.length, 6);
  assert.deepEqual(JSON.parse(calls[4].init.body), { sha: "e".repeat(40), force: false });
  assert.equal(calls[5].init.method, "GET");
});

test("ref PATCH 422 뒤 branch tip이 같으면 GitHub 장애 502를 유지한다", async () => {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "c".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "d".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "e".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/refs/heads/master")) {
      return Response.json({ message: "Validation Failed" }, { status: 422 });
    }
    if (url.endsWith("/git/ref/heads/master")) {
      return Response.json({ object: { type: "commit", sha: baseCommitSha } });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };

  await assert.rejects(
    writeAdminResource(
      "listings",
      [],
      resourceSnapshot.resources.listings.sha,
      env,
      { fetcher, snapshot: resourceSnapshot },
    ),
    (error) => error.code === "GITHUB_UNAVAILABLE"
      && error.status === 502
      && error.upstreamStatus === 422,
  );
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[3].init.body), { sha: "e".repeat(40), force: false });
  assert.equal(calls[4].init.method, "GET");
});

test("GitHub JSON 저장은 대상 파일 SHA가 snapshot과 다르면 쓰기 전에 거부한다", async () => {
  let called = false;
  await assert.rejects(
    writeAdminResource("listings", [], "stale-sha", env, {
      snapshot: resourceSnapshot,
      fetcher: async () => { called = true; return new Response(); },
    }),
    (error) => error.code === "GITHUB_CONFLICT" && error.status === 409,
  );
  assert.equal(called, false);
});

test("branch가 snapshot 이후 이동하면 force 없이 ref CAS가 충돌한다", async () => {
  const calls = [];
  const movedCommitSha = "9".repeat(40);
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "c".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "d".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "e".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/refs/heads/master")) {
      return Response.json({ message: "Reference update failed" }, { status: 422 });
    }
    if (url.endsWith("/git/ref/heads/master")) {
      return Response.json({ object: { type: "commit", sha: movedCommitSha } });
    }
    throw new Error(`예상하지 못한 GitHub 요청: ${url}`);
  };

  await assert.rejects(
    writeAdminResource(
      "listings",
      [],
      resourceSnapshot.resources.listings.sha,
      env,
      { fetcher, snapshot: resourceSnapshot },
    ),
    (error) => error.code === "GITHUB_CONFLICT" && error.status === 409,
  );
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[3].init.body), { sha: "e".repeat(40), force: false });
  assert.equal(calls[4].init.method, "GET");
});

test("이미지 업로드는 WebP 데이터와 허용 분류만 받는다", async () => {
  await assert.rejects(
    uploadAdminImage({ category: "secret", dataUrl: "data:image/webp;base64,AA==" }, env, async () => new Response()),
    (error) => error.code === "MEDIA_CATEGORY_DENIED",
  );
  await assert.rejects(
    uploadAdminImage({ category: "listing", dataUrl: "data:image/png;base64,AA==" }, env, async () => new Response()),
    (error) => error.code === "MEDIA_FORMAT_INVALID",
  );
});

test("이미지 업로드는 구조와 크기가 유효한 WebP만 GitHub로 전달한다", async () => {
  assert.deepEqual(validateWebpBytes(validAlphaWebpBytes), { width: 2, height: 3 });
  let requestBody = null;
  const result = await uploadAdminImage(
    { category: "listing", dataUrl: webpDataUrl(validWebpBytes) },
    env,
    async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return Response.json({ commit: { sha: "image-commit-sha" } });
    },
  );

  assert.equal(requestBody.branch, "master");
  assert.equal(requestBody.content, Buffer.from(validWebpBytes).toString("base64"));
  assert.equal(result.commitSha, "image-commit-sha");
  assert.match(result.src, /^\/images\/content\/listing\/.+\.webp$/u);
});

test("이미지 업로드는 위조 magic, RIFF 길이와 청크 범위 오류를 거부한다", async () => {
  let called = false;
  const fetcher = async () => { called = true; return new Response(); };
  await assert.rejects(
    uploadAdminImage({ category: "listing", dataUrl: webpDataUrl(Buffer.from("RIFF0000WEBP")) }, env, fetcher),
    (error) => error.code === "MEDIA_FORMAT_INVALID",
  );

  const wrongRiffLength = validWebpBytes.slice();
  wrongRiffLength[4] = 0;
  await assert.rejects(
    uploadAdminImage({ category: "listing", dataUrl: webpDataUrl(wrongRiffLength) }, env, fetcher),
    (error) => error.code === "MEDIA_FORMAT_INVALID",
  );

  const overflowingChunk = validWebpBytes.slice();
  overflowingChunk.fill(0xff, 16, 20);
  await assert.rejects(
    uploadAdminImage({ category: "listing", dataUrl: webpDataUrl(overflowingChunk) }, env, fetcher),
    (error) => error.code === "MEDIA_FORMAT_INVALID",
  );
  assert.equal(called, false);
});

test("이미지 업로드는 최대 변 길이와 최대 픽셀을 초과한 WebP를 거부한다", async () => {
  const oversized = validWebpBytes.slice();
  oversized[26] = 0x41;
  oversized[27] = 0x06;
  await assert.rejects(
    uploadAdminImage({ category: "listing", dataUrl: webpDataUrl(oversized) }, env, async () => new Response()),
    (error) => error.code === "MEDIA_DIMENSIONS_INVALID" && error.status === 413,
  );
});

test("이미지 업로드는 애니메이션과 EXIF, XMP, ICC 메타데이터 청크를 거부한다", async () => {
  for (const type of ["ANIM", "EXIF", "XMP ", "ICCP"]) {
    await assert.rejects(
      uploadAdminImage(
        { category: "listing", dataUrl: webpDataUrl(appendWebpChunk(validWebpBytes, type)) },
        env,
        async () => new Response(),
      ),
      (error) => error.code === "MEDIA_METADATA_DENIED",
    );
  }
});
