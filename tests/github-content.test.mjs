import assert from "node:assert/strict";
import test from "node:test";
import { readAdminResource, uploadAdminImage, validateWebpBytes, writeAdminResource } from "../worker/github-content.mjs";

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

test("허용 목록에 없는 GitHub 콘텐츠 경로는 요청 전에 차단한다", async () => {
  let called = false;
  await assert.rejects(
    readAdminResource("../../workflows", env, async () => { called = true; return new Response(); }),
    (error) => error.code === "RESOURCE_NOT_ALLOWED" && error.status === 404,
  );
  assert.equal(called, false);
});

test("GitHub JSON 저장은 최신 SHA와 고정 브랜치를 전달한다", async () => {
  let requestBody = null;
  const result = await writeAdminResource("listings", [], "source-sha", env, async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return Response.json({ content: { sha: "next-content-sha" }, commit: { sha: "commit-sha" } });
  });
  assert.equal(requestBody.sha, "source-sha");
  assert.equal(requestBody.branch, "master");
  assert.equal(atob(requestBody.content), "[]\n");
  assert.deepEqual(result, { resource: "listings", commitSha: "commit-sha", contentSha: "next-content-sha" });
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
