import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const approvedActionShas = new Set([
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
  "actions/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53",
]);

async function readWorkflow(name) {
  return readFile(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
}

function assertPinnedOfficialActions(workflow) {
  const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map((match) => match[1]);
  assert.ok(uses.length > 0);
  for (const action of uses) assert.ok(approvedActionShas.has(action), `고정되지 않았거나 승인 목록 밖의 Action: ${action}`);

  const checkoutCount = uses.filter((action) => action.startsWith("actions/checkout@")).length;
  assert.equal((workflow.match(/persist-credentials: false/gu) ?? []).length, checkoutCount);
}

test("CI는 읽기 전용 자격 증명과 Production SEO 산출물 검사를 고정한다", async () => {
  const workflow = await readWorkflow("ci.yml");
  assertPinnedOfficialActions(workflow);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /contents: write/u);
  assert.match(workflow, /PUBLIC_ALLOW_INDEXING: "true"[\s\S]*npm run assert:production-build/u);
  const productionBuildIndex = workflow.indexOf("- name: Build and assert Production SEO output");
  const playwrightInstallIndex = workflow.indexOf("- name: Install Playwright Chromium");
  const playwrightIndex = workflow.indexOf("- name: Run public-site Playwright E2E");
  const lighthouseIndex = workflow.indexOf("- name: Run mobile Lighthouse audit");
  assert.ok(productionBuildIndex > 0 && productionBuildIndex < playwrightInstallIndex);
  assert.ok(playwrightInstallIndex < playwrightIndex && playwrightIndex < lighthouseIndex);
  assert.match(workflow, /npx playwright install --with-deps chromium/u);
  assert.match(workflow, /npm run test:e2e/u);
  assert.match(workflow, /npm run audit:lighthouse/u);
});

for (const name of ["sync-bank-listings.yml", "sync-external-content.yml"]) {
  test(`${name}은 읽기 검증과 쓰기 배포를 분리하고 Production marker를 확인한다`, async () => {
    const workflow = await readWorkflow(name);
    assertPinnedOfficialActions(workflow);

    const publishIndex = workflow.indexOf("\n  publish:");
    assert.ok(publishIndex > 0);
    const validateJob = workflow.slice(0, publishIndex);
    const publishJob = workflow.slice(publishIndex);

    assert.match(validateJob, /permissions:\s*\n\s*contents: read/u);
    assert.doesNotMatch(validateJob, /contents: write|GITHUB_TOKEN/u);
    assert.match(validateJob, /npm run assert:production-build/u);
    assert.match(publishJob, /permissions:\s*\n\s*contents: write/u);
    assert.equal((publishJob.match(/GITHUB_TOKEN:/gu) ?? []).length, 1);
    assert.match(publishJob, /GIT_CONFIG_KEY_0=http\.https:\/\/github\.com\/\.extraheader/u);
    assert.doesNotMatch(publishJob, /git -c/u);

    const pushIndex = publishJob.indexOf("- name: Push with job-scoped credential");
    const markerIndex = publishJob.indexOf("- name: Wait for Production content marker");
    assert.ok(pushIndex > 0 && pushIndex < markerIndex);
  });
}

test("IndexNow 알림은 성공한 master CI와 Production search marker 뒤에만 실행된다", async () => {
  const workflow = await readWorkflow("notify-indexnow.yml");
  assertPinnedOfficialActions(workflow);
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\][\s\S]*types: \[completed\]/u);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /contents: write|GITHUB_TOKEN|secrets\./u);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/u);
  assert.match(workflow, /workflow_run\.event == 'push'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'master'/u);

  const markerIndex = workflow.indexOf("- name: Wait for Production search marker");
  const keyIndex = workflow.indexOf("- name: Verify published IndexNow key");
  const notifyIndex = workflow.indexOf("- name: Notify Naver IndexNow");
  assert.ok(markerIndex > 0 && markerIndex < keyIndex && keyIndex < notifyIndex);
  assert.match(workflow, /--scope search/u);
});
