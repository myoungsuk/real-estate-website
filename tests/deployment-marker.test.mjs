import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  calculateAdminResourceDigests,
  calculateDeploymentScopeHash,
  createDeploymentMarker,
  resolveDeploymentSource,
  writeDeploymentMarker,
} from "../scripts/deployment-marker.mjs";
import { waitForProductionDeployment } from "../scripts/verify-production-deployment.mjs";
import { ADMIN_RESOURCE_PATHS } from "../src/lib/admin-resource-digest.mjs";

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "deployment-marker-"));
  const files = {
    ".github/bank-listing-sync-state.json": "{\"bank\":1}\n",
    ".github/listing-review-policy.json": "{\"policy\":1}\n",
    ".github/listing-review-state.json": "{\"review\":1}\n",
    ".github/automation-health.json": "{\"health\":1}\n",
    "astro.config.mjs": "export default {};\n",
    "src/data/naver-listings.json": "{\"items\":[]}\n",
    "src/data/external-links.json": "[]\n",
    "public/4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3.txt": "4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3\n",
    "public/images/blog/a.webp": "blog",
    "public/images/youtube/b.webp": "youtube",
  };
  for (const [resource, path] of Object.entries(ADMIN_RESOURCE_PATHS)) {
    files[path] ??= `${JSON.stringify({ resource })}\n`;
  }
  for (const [path, content] of Object.entries(files)) {
    const absolutePath = join(rootDir, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return rootDir;
}

test("deployment marker scope hashes are deterministic and isolated", async (context) => {
  const rootDir = await createFixture();
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const first = await createDeploymentMarker({ rootDir });
  const second = await createDeploymentMarker({ rootDir });
  assert.deepEqual(first, second);

  await writeFile(join(rootDir, "src/data/naver-listings.json"), "{\"items\":[1]}\n");
  const changed = await createDeploymentMarker({ rootDir });
  assert.notEqual(changed.scopes.bank, first.scopes.bank);
  assert.notEqual(changed.scopes.search, first.scopes.search);
  assert.equal(changed.scopes.external, first.scopes.external);
  assert.equal(changed.scopes.automation, first.scopes.automation);
});

test("deployment marker text hashes ignore Windows and Linux line-ending differences", async (context) => {
  const rootDir = await createFixture();
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const before = await createDeploymentMarker({ rootDir });
  const textPaths = [
    ".github/bank-listing-sync-state.json",
    ".github/listing-review-policy.json",
    ".github/listing-review-state.json",
    ".github/automation-health.json",
    "astro.config.mjs",
    ...Object.values(ADMIN_RESOURCE_PATHS),
    "public/4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3.txt",
  ];
  for (const path of new Set(textPaths)) {
    const absolutePath = join(rootDir, path);
    const content = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, content.replace(/\n/gu, "\r\n"));
  }
  const after = await createDeploymentMarker({ rootDir });
  assert.deepEqual(after.scopes, before.scopes);
});

test("deployment marker writes all public verification scopes", async (context) => {
  const rootDir = await createFixture();
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const marker = await writeDeploymentMarker({ rootDir });
  assert.equal(marker.schemaVersion, 2);
  assert.deepEqual(marker.source, { commit: null, branch: null, provider: "local" });
  assert.deepEqual(marker.resources, await calculateAdminResourceDigests({ rootDir }));
  for (const digest of Object.values(marker.resources)) assert.match(digest, /^[a-f0-9]{64}$/u);
  for (const scope of ["search", "bank", "external", "automation"]) {
    assert.match(marker.scopes[scope], /^[a-f0-9]{64}$/u);
    assert.equal(marker.scopes[scope], await calculateDeploymentScopeHash(scope, { rootDir }));
  }
});

test("deployment marker source prefers Workers Builds and validates commit metadata", () => {
  assert.deepEqual(resolveDeploymentSource({
    WORKERS_CI: "1",
    WORKERS_CI_COMMIT_SHA: "a".repeat(40),
    WORKERS_CI_BRANCH: "master",
    GITHUB_ACTIONS: "true",
    GITHUB_SHA: "b".repeat(40),
  }), {
    commit: "a".repeat(40),
    branch: "master",
    provider: "workers-builds",
  });
  assert.deepEqual(resolveDeploymentSource({
    GITHUB_ACTIONS: "true",
    GITHUB_SHA: "invalid",
    GITHUB_REF_NAME: "master",
  }), {
    commit: null,
    branch: "master",
    provider: "github-actions",
  });
});

test("production polling retries until the expected scope marker is visible", async () => {
  const expected = "a".repeat(64);
  let calls = 0;
  const marker = await waitForProductionDeployment({
    scope: "bank",
    expected,
    attempts: 3,
    intervalMs: 0,
    sleep: async () => {},
    logger: { log() {} },
    fetcher: async () => {
      calls += 1;
      return new Response(JSON.stringify({ schemaVersion: 2, scopes: { bank: calls === 2 ? expected : "b".repeat(64) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(calls, 2);
  assert.equal(marker.scopes.bank, expected);
});

test("production polling fails when the expected marker never appears", async () => {
  const expected = "c".repeat(64);
  await assert.rejects(
    waitForProductionDeployment({
      scope: "external",
      expected,
      attempts: 2,
      intervalMs: 0,
      sleep: async () => {},
      logger: { log() {} },
      fetcher: async () => new Response(JSON.stringify({ schemaVersion: 1, scopes: { external: "d".repeat(64) } })),
    }),
    /제한 시간 안에 일치하지 않았습니다/u,
  );
});
