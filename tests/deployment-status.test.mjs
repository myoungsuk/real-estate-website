import assert from "node:assert/strict";
import test from "node:test";
import {
  determineDeploymentStatus,
  getDeploymentStatus,
  getWorkerVersionMetadata,
  parseDeploymentStatusTarget,
} from "../worker/deployment-status.mjs";

const savedCommit = "a".repeat(40);
const activeCommit = "b".repeat(40);
const digest = "c".repeat(64);
const otherDigest = "d".repeat(64);
const savedAt = "2026-08-31T00:00:00.000Z";
const target = { commit: savedCommit, resource: "home-content", digest, savedAt };

function marker({ commit = savedCommit, resourceDigest = digest } = {}) {
  return {
    schemaVersion: 2,
    algorithm: "sha256",
    source: { commit, branch: "master", provider: "workers-builds" },
    resources: { "home-content": resourceDigest },
    scopes: {},
  };
}

test("배포 상태 query는 commit, 허용 resource, digest와 시각을 엄격히 검증한다", () => {
  const url = new URL("https://leaderscityhappy.com/api/admin/v1/deployment-status");
  url.searchParams.set("commit", savedCommit);
  url.searchParams.set("resource", "home-content");
  url.searchParams.set("digest", digest);
  url.searchParams.set("savedAt", savedAt);
  assert.deepEqual(parseDeploymentStatusTarget(url), target);

  url.searchParams.set("resource", "../secret");
  assert.throws(() => parseDeploymentStatusTarget(url), (error) => error.code === "DEPLOYMENT_RESOURCE_INVALID");
});

test("저장 commit과 digest가 모두 같을 때만 공개 완료로 판정한다", () => {
  const status = determineDeploymentStatus(marker(), target, { now: Date.parse("2026-08-31T00:01:00.000Z") });
  assert.equal(status.state, "published");
  assert.equal(status.resourceMatched, true);
  assert.equal(status.activeCommit, savedCommit);
});

test("더 최신 commit의 resource digest가 같으면 최신 배포에 포함된 것으로 판정한다", () => {
  const status = determineDeploymentStatus(marker({ commit: activeCommit }), target, { now: Date.parse("2026-08-31T00:02:00.000Z") });
  assert.equal(status.state, "superseded");
  assert.equal(status.resourceMatched, true);
});

test("digest 불일치는 10분 전 배포 중, 10분 뒤 배포 지연으로 구분한다", () => {
  const deploying = determineDeploymentStatus(marker({ resourceDigest: otherDigest }), target, {
    now: Date.parse("2026-08-31T00:09:59.000Z"),
  });
  const delayed = determineDeploymentStatus(marker({ resourceDigest: otherDigest }), target, {
    now: Date.parse("2026-08-31T00:10:00.000Z"),
  });
  assert.equal(deploying.state, "deploying");
  assert.equal(deploying.pollAfterMs, 5_000);
  assert.equal(delayed.state, "delayed");
  assert.equal(delayed.pollAfterMs, null);
});

test("marker v1과 source commit 누락은 저장 실패가 아닌 확인 불가로 판정한다", () => {
  assert.equal(determineDeploymentStatus({ schemaVersion: 1 }, target).state, "unknown");
  assert.equal(determineDeploymentStatus(marker({ commit: null }), target).reason, "marker-source-unknown");
});

test("정적 marker 조회 장애는 200 응답용 확인 불가 데이터로 격리한다", async () => {
  const url = new URL("https://leaderscityhappy.com/api/admin/v1/deployment-status");
  for (const [key, value] of Object.entries(target)) url.searchParams.set(key === "commit" ? "commit" : key, value);
  const status = await getDeploymentStatus(new Request(url), {}, {
    readMarker: async () => { throw new Error("asset unavailable"); },
    now: Date.parse("2026-08-31T00:01:00.000Z"),
  });
  assert.equal(status.state, "unknown");
  assert.equal(status.reason, "marker-unavailable");
});

test("Worker version metadata는 안전한 id와 생성 시각만 노출한다", () => {
  assert.deepEqual(getWorkerVersionMetadata({
    CF_VERSION_METADATA: {
      id: "12345678-abcd-1234-abcd-1234567890ab",
      tag: "private-tag-not-returned",
      timestamp: "2026-08-31T00:00:00Z",
    },
  }), {
    id: "12345678-abcd-1234-abcd-1234567890ab",
    createdAt: "2026-08-31T00:00:00.000Z",
  });
});
