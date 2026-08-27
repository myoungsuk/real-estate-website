import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  calculateDeploymentScopeHash,
  createDeploymentMarker,
  writeDeploymentMarker,
} from "../scripts/deployment-marker.mjs";
import { waitForProductionDeployment } from "../scripts/verify-production-deployment.mjs";

async function createFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "deployment-marker-"));
  const files = {
    ".github/bank-listing-sync-state.json": "{\"bank\":1}\n",
    ".github/automation-health.json": "{\"health\":1}\n",
    "src/data/naver-listings.json": "{\"items\":[]}\n",
    "src/data/external-links.json": "[]\n",
    "public/images/blog/a.webp": "blog",
    "public/images/youtube/b.webp": "youtube",
  };
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
  assert.equal(changed.scopes.external, first.scopes.external);
  assert.equal(changed.scopes.automation, first.scopes.automation);
});

test("deployment marker writes all public verification scopes", async (context) => {
  const rootDir = await createFixture();
  context.after(() => rm(rootDir, { recursive: true, force: true }));
  const marker = await writeDeploymentMarker({ rootDir });
  assert.equal(marker.schemaVersion, 1);
  for (const scope of ["bank", "external", "automation"]) {
    assert.match(marker.scopes[scope], /^[a-f0-9]{64}$/u);
    assert.equal(marker.scopes[scope], await calculateDeploymentScopeHash(scope, { rootDir }));
  }
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
      return new Response(JSON.stringify({ schemaVersion: 1, scopes: { bank: calls === 2 ? expected : "b".repeat(64) } }), {
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
