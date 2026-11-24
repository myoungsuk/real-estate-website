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

test("운영 반영 확인은 master push마다 읽기 권한으로 source commit marker만 기다린다", async () => {
  const workflow = await readWorkflow("verify-production-deploy.yml");
  assertPinnedOfficialActions(workflow);
  assert.match(workflow, /on:\s*\n\s*push:\s*\n\s*branches: \[master\]/u);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /contents: write|GITHUB_TOKEN|secrets\.|pull_request|wrangler|deploy --/u);
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /PUSHED_COMMIT: \$\{\{ github\.sha \}\}/u);
  assert.match(workflow, /node scripts\/verify-production-commit\.mjs --commit "\$PUSHED_COMMIT"/u);
});

test("IndexNow 알림은 성공한 master CI와 그 커밋을 포함한 Production 배포 뒤에만 실행된다", async () => {
  const workflow = await readWorkflow("notify-indexnow.yml");
  assertPinnedOfficialActions(workflow);
  assert.match(workflow, /workflow_run:[\s\S]*workflows: \[CI\][\s\S]*types: \[completed\]/u);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/u);
  assert.doesNotMatch(workflow, /contents: write|GITHUB_TOKEN|secrets\./u);
  assert.match(workflow, /workflow_run\.conclusion == 'success'/u);
  assert.match(workflow, /workflow_run\.event == 'push'/u);
  assert.match(workflow, /workflow_run\.head_branch == 'master'/u);

  const markerIndex = workflow.indexOf("- name: Wait for Production commit marker");
  const keyIndex = workflow.indexOf("- name: Verify published IndexNow key");
  const notifyIndex = workflow.indexOf("- name: Notify Naver IndexNow");
  assert.ok(markerIndex > 0 && markerIndex < keyIndex && keyIndex < notifyIndex);
  // 후속 커밋 판정(git merge-base)에 전체 이력이 필요하다.
  assert.match(workflow, /fetch-depth: 0/u);
  assert.match(workflow, /INDEXED_COMMIT: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/u);
  assert.match(workflow, /node scripts\/verify-production-commit\.mjs --commit "\$INDEXED_COMMIT"/u);
  assert.doesNotMatch(workflow, /--scope search/u);
});

test("부동산뱅크 자동 받기는 실패하면 이슈를 열고 성공하면 닫으며, 알림 job만 이슈 권한을 갖는다", async () => {
  const workflow = await readWorkflow("sync-bank-listings.yml");
  const alertIndex = workflow.indexOf("\n  alert:");
  assert.ok(alertIndex > workflow.indexOf("\n  publish:"), "알림 job은 publish 뒤에 있음");
  const beforeAlert = workflow.slice(0, alertIndex);
  const alertJob = workflow.slice(alertIndex);

  // 이슈 권한은 알림 job에만 있고, 알림 job은 저장소를 받거나 쓰지 않는다.
  assert.doesNotMatch(beforeAlert, /issues: write|actions: read|GH_TOKEN/u);
  assert.match(alertJob, /needs: \[validate, publish\]/u);
  assert.match(alertJob, /if: \$\{\{ always\(\) && github\.ref == 'refs\/heads\/master' \}\}/u);
  assert.match(alertJob, /permissions:\s*\n\s*actions: read\s*\n\s*issues: write\s*\n\s*steps:/u);
  assert.doesNotMatch(alertJob, /contents: write|uses:|secrets\.|GITHUB_TOKEN:|git push/u);
  assert.equal((alertJob.match(/GH_TOKEN: \$\{\{ github\.token \}\}/gu) ?? []).length, 1);

  // 성공 = validate 성공 + publish 성공 또는 바뀐 것 없어 건너뜀. 나머지(실패·취소)는 실패로 알린다.
  assert.match(alertJob, /success\/success \| success\/skipped\) outcome=ok ;;/u);
  assert.match(alertJob, /\*\) outcome=failed ;;/u);
  // 봇이 연 같은 제목의 열린 이슈만 다루고, 열려 있으면 새로 열지 않고 댓글을 단다.
  assert.match(alertJob, /select\(\.title == \\"\$title\\" and \.author\.is_bot\)/u);
  assert.match(alertJob, /gh issue close "\$number" --comment/u);
  assert.match(alertJob, /gh issue comment "\$number" --body-file "\$body_file"/u);
  assert.match(alertJob, /gh issue create --title "\$title" --body-file "\$body_file"/u);
  // 이슈 본문에는 실행 주소·단계 이름·job 결과만 넣는다(로그를 읽지 않음).
  assert.doesNotMatch(alertJob, /--log|gh run download|cat .*\.log/u);
  assert.match(alertJob, /gh run view "\$GITHUB_RUN_ID" --json jobs/u);
});
