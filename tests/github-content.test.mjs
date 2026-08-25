import assert from "node:assert/strict";
import test from "node:test";
import { readAdminResource, uploadAdminImage, writeAdminResource } from "../worker/github-content.mjs";

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
