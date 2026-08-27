import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_RESOURCE_PATHS } from "../worker/admin-resource-validation.mjs";
import {
  readAdminResource,
  readAdminResourcesSnapshot,
  uploadAdminImage,
  validateWebpBytes,
  writeAdminResource,
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
    baseCommitSha: newCommitSha,
  });
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
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/git/blobs")) return Response.json({ sha: "c".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/trees")) return Response.json({ sha: "d".repeat(40) }, { status: 201 });
    if (url.endsWith("/git/commits")) return Response.json({ sha: "e".repeat(40) }, { status: 201 });
    return Response.json({ message: "Reference update failed" }, { status: 422 });
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
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { sha: "e".repeat(40), force: false });
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
