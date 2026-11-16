import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEFAULT_DOCUMENTS,
  PROGRESS_MARKERS,
  ProgressDocumentError,
  TEST_GROUPS,
  TEST_GROUP_LABELS,
  TEST_MARKERS,
  countProgress,
  countTestScore,
  diffDocumentBlock,
  findMarkerRange,
  renderBar,
  runProgress,
  updateDocumentText,
} from "../scripts/work-tools-progress.mjs";

const progressDocument = (body, block = ["(옛 표)"]) => [
  "# 가상 진행 체크리스트",
  "",
  "## 1. 현재 진행도",
  "",
  PROGRESS_MARKERS.start,
  ...block,
  PROGRESS_MARKERS.end,
  "",
  `설명 문장에 표식 ${PROGRESS_MARKERS.start} 문자열이 있어도 표식이 아니다.`,
  "",
  "## 2. 기준선",
  "",
  "- [ ] 단계 절이 아니라 세지 않는 항목",
  "",
  ...body,
  "",
  "## 9. 변경 기록",
  "",
  "- [ ] 변경 기록 절도 세지 않는다",
].join("\n");

const testDocument = (rows, block = ["(옛 점수표)"]) => [
  "# 가상 테스트 체크리스트",
  "",
  TEST_MARKERS.start,
  ...block,
  TEST_MARKERS.end,
  "",
  `1.5절 설명: 표식(\`${TEST_MARKERS.start}\` ~ \`${TEST_MARKERS.end}\`) 안은 세지 않는다.`,
  "",
  "| ID | 시험 | 결과 |",
  "|---|---|---|",
  ...rows,
].join("\n");

test("막대와 %는 반올림(0.5는 올림)이고 항목이 없으면 0% 또는 —다", () => {
  assert.equal(renderBar(0, 0), "░░░░░░░░░░ 0%");
  assert.equal(renderBar(0, 0, { emptyLabel: "—" }), "░░░░░░░░░░ —");
  assert.equal(renderBar(1, 2), "█████░░░░░ 50%");
  assert.equal(renderBar(1, 4), "███░░░░░░░ 25%", "2.5칸은 3칸으로 올림");
  assert.equal(renderBar(1, 8), "█░░░░░░░░░ 13%", "12.5%는 13%로 올림");
  assert.equal(renderBar(1, 3), "███░░░░░░░ 33%");
  assert.equal(renderBar(2, 3), "███████░░░ 67%");
  assert.equal(renderBar(124, 130), "██████████ 95%", "9.54칸은 10칸");
  assert.equal(renderBar(37, 42), "█████████░ 88%");
  assert.equal(renderBar(58, 210), "███░░░░░░░ 28%");
});

test("진행 체크리스트: 단계 절의 맨 앞 체크 항목만 세고 🔒·👤 → 대기, ⏳ → 진행 중", () => {
  const text = progressDocument([
    "## 3. 단계 1 — 문서",
    "",
    "- [x] 완료 항목",
    "- [X] 대문자 X도 완료",
    "- [x] 🔒 완료된 관문은 완료",
    "",
    "## 4. 단계 0 — 저장하지 않는 도구",
    "",
    "- [ ] ⏳ 진행 중 항목",
    "- [ ] 🔒 승인 관문",
    "- [ ] 👤 운영자 실기기",
    "- [ ] 🔒 ⏳ 두 표식이면 🔒가 앞섬",
    "- [ ] 남은 항목",
    "  - [ ] 들여쓴 항목은 세지 않음",
    "```text",
    "- [ ] 코드 블록 안 항목은 세지 않음",
    "```",
    "",
    "## 5. 단계 2 — 비어 있는 단계",
  ]);
  const { stages, total } = countProgress(text);
  assert.deepEqual(stages.map((stage) => [stage.stage, stage.title, stage.done, stage.active, stage.left, stage.waiting]), [
    ["1", "문서", 3, 0, 0, 0],
    ["0", "저장하지 않는 도구", 0, 1, 1, 3],
    ["2", "비어 있는 단계", 0, 0, 0, 0],
  ]);
  assert.deepEqual(total, { done: 3, active: 1, left: 1, waiting: 3 });
});

test("진행 체크리스트: 표식 안의 옛 표는 세지 않고 --write 결과는 다시 계산해도 같다", () => {
  const body = ["## 3. 단계 1 — 문서", "", "- [x] 끝", "", "## 4. 단계 0 — 도구", "", "- [ ] ⏳ 하는 중", "- [ ] 남음"];
  const stale = progressDocument(body, ["- [x] 표식 안 체크 항목은 세지 않는다", "| 전체 | 옛 숫자 |"]);
  const written = updateDocumentText(stale, "progress");
  assert.equal(updateDocumentText(written, "progress"), written, "두 번 써도 같다");
  assert.deepEqual(diffDocumentBlock(written, "progress"), []);
  assert.match(written, /전체 체크 항목 1 \/ 3개 완료\(33%\)\. 지금 하는 단계: 단계 0\(완료 0 \/ 2개, ⏳ 진행 중 1개, 🔒·👤 대기·막힘 0개, 남음 1개\)\./u);
  assert.match(written, /\| 단계 1 · 문서 \| ██████████ 100% \| 1 \| 0 \| 0 \| 0 \|/u);
  assert.match(written, /\| 단계 0 · 도구 \| ░░░░░░░░░░ 0% \| 0 \| 1 \| 1 \| 0 \|/u);
  assert.ok(diffDocumentBlock(stale, "progress").length > 0, "옛 표는 다르다고 알려 준다");
});

test("표식 문자열이 설명 문장 안에 있어도 표식으로 보지 않는다(줄 전체가 같아야 표식)", () => {
  const lines = ["설명 " + PROGRESS_MARKERS.start, PROGRESS_MARKERS.start, "본문", `  ${PROGRESS_MARKERS.end}  `];
  assert.deepEqual(findMarkerRange(lines, PROGRESS_MARKERS), { start: 1, end: 3 });
  assert.throws(() => findMarkerRange([PROGRESS_MARKERS.start, PROGRESS_MARKERS.start, PROGRESS_MARKERS.end], PROGRESS_MARKERS), ProgressDocumentError);
  assert.throws(() => findMarkerRange([PROGRESS_MARKERS.start], PROGRESS_MARKERS), /정확히 1개/u);
  assert.throws(() => findMarkerRange([PROGRESS_MARKERS.end, PROGRESS_MARKERS.start], PROGRESS_MARKERS), /앞에 있어야/u);
});

test("CRLF 문서는 CRLF 그대로 다시 쓴다", () => {
  const crlf = progressDocument(["## 3. 단계 1 — 문서", "", "- [x] 끝"]).replace(/\n/gu, "\r\n");
  const written = updateDocumentText(crlf, "progress");
  assert.equal(written.replace(/\r\n/gu, "").includes("\n"), false);
  assert.ok(written.includes("\r\n| 단계 1 · 문서 | ██████████ 100% | 1 | 0 | 0 | 0 |\r\n"));
});

test("테스트 체크리스트: 결과 칸 첫 낱말·묶음·시험 층을 1.5절 규칙대로 센다", () => {
  const text = testDocument([
    "| T0-01 | 자동 | 통과 |",
    "| T0-02 [화면] | 화면 | 실패(14px) |",
    "| T0-69a [수동] | 수동 | 통과(근거) |",
    "| TU-05 [실기기] | 실기기 | 미실행 |",
    "| TD-01 [실기기] | TD는 표식보다 배포 후가 앞섬 | 미실행 |",
    "| T3-01 | 고르지 않은 쪽 | 해당 없음(DEC-WT-05) |",
    "| T2-10 | 칸 안의 \\| 기호는 칸 구분이 아님 | 통과(근거 a \\| b) |",
    "| 기타 | 시험 ID가 아닌 행은 세지 않음 | 통과 |",
    "```text",
    "| T0-99 | 코드 블록 안 | 통과 |",
    "```",
  ], ["| T0-98 | 점수표 안 | 통과 |"]);
  const { groups, layers, total } = countTestScore(text);
  assert.deepEqual(total, { pass: 3, fail: 1, notRun: 2, notApplicable: 1 });
  assert.deepEqual(groups.T0, { pass: 2, fail: 1, notRun: 0, notApplicable: 0 });
  assert.deepEqual(groups.T2, { pass: 1, fail: 0, notRun: 0, notApplicable: 0 });
  assert.deepEqual(groups.T3, { pass: 0, fail: 0, notRun: 0, notApplicable: 1 });
  assert.deepEqual(layers["자동"], { pass: 2, fail: 0, notRun: 0, notApplicable: 1 });
  assert.deepEqual(layers["화면 자동"], { pass: 0, fail: 1, notRun: 0, notApplicable: 0 });
  assert.deepEqual(layers["수동 확인"], { pass: 1, fail: 0, notRun: 0, notApplicable: 0 });
  assert.deepEqual(layers["실기기"], { pass: 0, fail: 0, notRun: 1, notApplicable: 0 });
  assert.deepEqual(layers["배포 후"], { pass: 0, fail: 0, notRun: 1, notApplicable: 0 });

  const written = updateDocumentText(text, "test");
  assert.match(written, /\*\*전체 통과 3 \/ 6 \(50%\) · 실패 1 · 해당 없음 1 · 미실행 2\*\*/u, "분모는 전체 − 해당 없음");
  assert.match(written, /\| 단계 3 알림·모자이크 \(T3\) \| `░░░░░░░░░░ —` \| 0 \| 0 \| 0 \| 1 \|/u, "분모 0이면 —");
  assert.match(written, /\(전체 7개 − 해당 없음 1개 = 6개\)/u);
  assert.equal(updateDocumentText(written, "test"), written);
});

test("테스트 체크리스트: 점수표 묶음 이름은 쉬운 말 + 괄호 속 시험 ID 앞부분으로 쓴다(운영자 요청 2026-11-16)", () => {
  assert.deepEqual(Object.keys(TEST_GROUP_LABELS), [...TEST_GROUPS], "묶음마다 이름이 하나씩, 같은 순서");
  for (const group of TEST_GROUPS) {
    const label = TEST_GROUP_LABELS[group];
    assert.ok(label.endsWith(` (${group})`), `${label}: 괄호 속 ID 앞부분`);
    assert.ok(label.length > group.length + 3, `${label}: 쉬운 말 이름이 있음`);
  }
  const written = updateDocumentText(testDocument(["| T0-01 | 가 | 통과 |", "| TR-01 | 나 | 미실행 |"]), "test");
  assert.match(written, /^\| 단계 0 계산·문구·일정 \(T0\) \| `██████████ 100%` \| 1 \| 0 \| 0 \| 0 \|$/mu);
  assert.match(written, /^\| 기존 기능 유지 \(TR\) \| `░░░░░░░░░░ 0%` \| 0 \| 0 \| 1 \| 0 \|$/mu);
  assert.doesNotMatch(written, /^\| T0 \|/mu, "약어만 쓴 묶음 칸이 남지 않음");
  // 세는 규칙은 그대로: 같은 문서를 다시 써도 같은 결과
  assert.equal(updateDocumentText(written, "test"), written);
});

test("테스트 체크리스트: 잘못된 문서는 멈춘다(중복 ID, 결과 낱말, 층 표식 2개)", () => {
  assert.throws(() => countTestScore(testDocument(["| T0-01 | 가 | 통과 |", "| T0-01 | 나 | 통과 |"])), /두 번/u);
  assert.throws(() => countTestScore(testDocument(["| T0-01 | 가 | 통과함 |"])), /결과 칸/u);
  assert.throws(() => countTestScore(testDocument(["| T0-01 | 가 | 보류 |"])), /결과 칸/u);
  assert.throws(() => countTestScore(testDocument(["| T0-01 [화면] [실기기] | 가 | 통과 |"])), /하나만/u);
});

test("실제 두 문서의 표가 체크 항목·결과 칸과 같다(어긋나면 --write로 다시 쓴다)", async () => {
  for (const document of DEFAULT_DOCUMENTS) {
    const text = await readFile(document.url, "utf8");
    const differences = diffDocumentBlock(text, document.kind);
    assert.deepEqual(
      differences,
      [],
      `${document.label} 표가 실제와 다릅니다. node scripts/work-tools-progress.mjs --write를 실행하세요.\n${JSON.stringify(differences, null, 2)}`,
    );
  }
  const logs = [];
  assert.equal(await runProgress("--check", { log: (line) => logs.push(line) }), true);
  assert.equal(logs.length, DEFAULT_DOCUMENTS.length);
});

test("사용법이 틀리면 알려 준다", async () => {
  await assert.rejects(() => runProgress("--fix"), /사용법/u);
});
