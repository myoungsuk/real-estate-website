// 중개업무 도구 진행 체크리스트의 진행 요약표와 테스트 체크리스트의 진행 점수표를
// 문서의 체크 항목·시험 결과 칸에서 다시 계산한다. Node 내장 모듈만 쓴다.
//
//   node scripts/work-tools-progress.mjs --write   두 문서의 표식 사이를 다시 쓴다
//   node scripts/work-tools-progress.mjs --check   표가 실제와 다르면 어디가 다른지 출력하고 실패한다
//
// 세는 규칙은 진행 체크리스트 1절과 테스트 체크리스트 1.5절에 적혀 있다.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PROGRESS_MARKERS = Object.freeze({
  start: "<!-- work-progress:start -->",
  end: "<!-- work-progress:end -->",
});
export const TEST_MARKERS = Object.freeze({
  start: "<!-- work-test-score:start -->",
  end: "<!-- work-test-score:end -->",
});

const WORK_TOOLS_DIR = new URL("../docs/work-tools/", import.meta.url);
export const PROGRESS_DOCUMENT = new URL("리더스시티 행복한부동산 중개업무 도구 개발 진행 체크리스트.md", WORK_TOOLS_DIR);
export const TEST_DOCUMENT = new URL("리더스시티 행복한부동산 중개업무 도구 테스트 체크리스트.md", WORK_TOOLS_DIR);

export const TEST_GROUPS = Object.freeze(["T0", "TU", "T2", "TP", "T3", "T4", "TR", "TD"]);
// 점수표에 보이는 묶음 이름. 세는 규칙(시험 ID 앞부분)은 그대로 두고, 표에는 쉬운 말과 괄호 속 ID 앞부분을 함께 쓴다.
export const TEST_GROUP_LABELS = Object.freeze({
  T0: "단계 0 계산·문구·일정 (T0)",
  TU: "화면 (TU)",
  T2: "단계 2 손님·메모·일정·파일 (T2)",
  TP: "개인정보 유출 검사 (TP)",
  T3: "단계 3 알림·모자이크 (T3)",
  T4: "단계 4 AI (T4)",
  TR: "기존 기능 유지 (TR)",
  TD: "배포 후 확인 (TD)",
});
export const TEST_LAYERS = Object.freeze(["자동", "화면 자동", "수동 확인", "실기기", "배포 후"]);
const RESULT_KEYS = Object.freeze({ 통과: "pass", 실패: "fail", 미실행: "notRun", "해당 없음": "notApplicable" });
const LAYER_TAGS = Object.freeze({ "[실기기]": "실기기", "[화면]": "화면 자동", "[수동]": "수동 확인" });

export class ProgressDocumentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProgressDocumentError";
  }
}

function splitDocument(text) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  return { eol, lines: text.split(/\r?\n/u) };
}

// 표식 줄은 그 문자열만 있는 줄이다. 설명 문장 안에 같은 문자열이 있어도 표식이 아니다.
export function findMarkerRange(lines, markers) {
  const starts = [];
  const ends = [];
  lines.forEach((line, index) => {
    if (line.trim() === markers.start) starts.push(index);
    if (line.trim() === markers.end) ends.push(index);
  });
  if (starts.length !== 1 || ends.length !== 1) {
    throw new ProgressDocumentError(`표식 ${markers.start} / ${markers.end} 줄이 각각 정확히 1개여야 합니다(지금 ${starts.length}개 / ${ends.length}개).`);
  }
  if (starts[0] >= ends[0]) throw new ProgressDocumentError(`표식 ${markers.start}가 ${markers.end}보다 앞에 있어야 합니다.`);
  return { start: starts[0], end: ends[0] };
}

// 문서 줄을 돌면서 코드 블록과 표식 사이를 건너뛰고 나머지 줄만 넘겨준다.
function* countableLines(lines, markers) {
  const range = findMarkerRange(lines, markers);
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    if (index >= range.start && index <= range.end) continue;
    const line = lines[index];
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) yield line;
  }
}

function roundedRatio(part, whole, scale) {
  // 반올림(0.5는 올림)을 정수 계산으로 한다. 부동소수점 오차로 경계가 흔들리지 않게 하기 위해서다.
  return Math.floor((2 * part * scale + whole) / (2 * whole));
}

export function renderBar(part, whole, { emptyLabel = "0%" } = {}) {
  if (whole === 0) return `░░░░░░░░░░ ${emptyLabel}`;
  const filled = roundedRatio(part, whole, 10);
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${roundedRatio(part, whole, 100)}%`;
}

const emptyProgressCounts = () => ({ done: 0, active: 0, left: 0, waiting: 0 });
const progressTotal = (counts) => counts.done + counts.active + counts.left + counts.waiting;

// 진행 체크리스트: "## N. 단계 M — 제목" 절 안의 맨 앞(들여쓰기 없는) 체크 항목만 센다.
export function countProgress(text) {
  const { lines } = splitDocument(text);
  const stages = [];
  let current = null;
  for (const line of countableLines(lines, PROGRESS_MARKERS)) {
    const heading = /^## \d+\. 단계 (\d+) — (.+)$/u.exec(line);
    if (heading) {
      current = { stage: heading[1], title: heading[2].trim(), ...emptyProgressCounts() };
      stages.push(current);
      continue;
    }
    if (/^## /u.test(line)) {
      current = null;
      continue;
    }
    const item = /^- \[([ xX])\] (.*)$/u.exec(line);
    if (!item || current === null) continue;
    if (item[1] !== " ") current.done += 1;
    else if (item[2].includes("🔒") || item[2].includes("👤")) current.waiting += 1;
    else if (item[2].includes("⏳")) current.active += 1;
    else current.left += 1;
  }
  if (stages.length === 0) throw new ProgressDocumentError("\"## N. 단계 M — 제목\" 형식의 단계 절을 찾지 못했습니다.");
  const total = emptyProgressCounts();
  for (const stage of stages) for (const key of Object.keys(total)) total[key] += stage[key];
  return { stages, total };
}

export function renderProgressBlock({ stages, total }) {
  const totalCount = progressTotal(total);
  const current = stages.find((stage) => progressTotal(stage) > 0 && stage.done < progressTotal(stage));
  const currentText = current
    ? `단계 ${current.stage}(완료 ${current.done} / ${progressTotal(current)}개, ⏳ 진행 중 ${current.active}개, 🔒·👤 대기·막힘 ${current.waiting}개, 남음 ${current.left}개)`
    : "없음(모든 단계의 체크 항목 완료)";
  const row = (label, counts) => `| ${label} | ${renderBar(counts.done, progressTotal(counts))} | ${counts.done} | ${counts.active} | ${counts.left} | ${counts.waiting} |`;
  return [
    `전체 체크 항목 ${total.done} / ${totalCount}개 완료(${totalCount === 0 ? 0 : roundedRatio(total.done, totalCount, 100)}%). 지금 하는 단계: ${currentText}.`,
    "",
    "| 단계 | 진행 | 완료 | 진행 중 | 남음 | 대기·막힘 |",
    "|---|---|---:|---:|---:|---:|",
    row("전체", total),
    ...stages.map((stage) => row(`단계 ${stage.stage} · ${stage.title}`, stage)),
  ];
}

const emptyTestCounts = () => ({ pass: 0, fail: 0, notRun: 0, notApplicable: 0 });
const testTotal = (counts) => counts.pass + counts.fail + counts.notRun + counts.notApplicable;

function splitTableCells(line) {
  // 칸 안의 `\|`는 칸 구분이 아니다.
  return line.split(/(?<!\\)\|/u).slice(1, -1).map((cell) => cell.trim());
}

// 테스트 체크리스트: 첫 칸이 시험 ID로 시작하는 표 행의 마지막 칸 결과를 센다.
export function countTestScore(text) {
  const { lines } = splitDocument(text);
  const groups = Object.fromEntries(TEST_GROUPS.map((group) => [group, emptyTestCounts()]));
  const layers = Object.fromEntries(TEST_LAYERS.map((layer) => [layer, emptyTestCounts()]));
  const seen = new Set();
  for (const line of countableLines(lines, TEST_MARKERS)) {
    if (!line.startsWith("|")) continue;
    const cells = splitTableCells(line);
    const first = cells[0] ?? "";
    const match = /^(T0|TU|T2|TP|T3|T4|TR|TD)-\d+[a-z]?\b/u.exec(first);
    if (!match) continue;
    const id = match[0];
    if (seen.has(id)) throw new ProgressDocumentError(`시험 ID ${id}가 두 번 나옵니다.`);
    seen.add(id);

    const result = /^(통과|실패|미실행|해당 없음)(?=$|[\s(])/u.exec(cells.at(-1) ?? "");
    if (!result) throw new ProgressDocumentError(`${id}: 결과 칸이 통과·실패·미실행·해당 없음 가운데 하나로 시작해야 합니다(지금 "${cells.at(-1)}").`);

    const tags = (first.slice(id.length).match(/\[(?:실기기|화면|수동)\]/gu) ?? []);
    if (tags.length > 1) throw new ProgressDocumentError(`${id}: 시험 층 표식은 한 행에 하나만 붙입니다(지금 ${tags.join(", ")}).`);
    const layer = match[1] === "TD" ? "배포 후" : tags.length === 1 ? LAYER_TAGS[tags[0]] : "자동";

    const key = RESULT_KEYS[result[1]];
    groups[match[1]][key] += 1;
    layers[layer][key] += 1;
  }
  if (seen.size === 0) throw new ProgressDocumentError("시험 ID 행을 찾지 못했습니다.");
  const total = emptyTestCounts();
  for (const group of TEST_GROUPS) for (const key of Object.keys(total)) total[key] += groups[group][key];
  return { groups, layers, total };
}

function scoreCell(counts) {
  const denominator = testTotal(counts) - counts.notApplicable;
  return `\`${renderBar(counts.pass, denominator, { emptyLabel: "—" })}\``;
}

export function renderTestBlock({ groups, layers, total }) {
  const denominator = testTotal(total) - total.notApplicable;
  const percent = denominator === 0 ? "—" : `${roundedRatio(total.pass, denominator, 100)}%`;
  const row = (label, counts) => `| ${label} | ${scoreCell(counts)} | ${counts.pass} | ${counts.fail} | ${counts.notRun} | ${counts.notApplicable} |`;
  const header = (label) => [`| ${label} | 점수 | 통과 | 실패 | 미실행 | 해당 없음 |`, "|---|---|---:|---:|---:|---:|"];
  return [
    `**전체 통과 ${total.pass} / ${denominator} (${percent}) · 실패 ${total.fail} · 해당 없음 ${total.notApplicable} · 미실행 ${total.notRun}**`,
    "",
    ...header("묶음"),
    ...TEST_GROUPS.map((group) => row(TEST_GROUP_LABELS[group], groups[group])),
    row("**전체**", total),
    "",
    ...header("시험 층"),
    ...TEST_LAYERS.map((layer) => row(layer, layers[layer])),
    row("**전체**", total),
    "",
    `- 통과율의 분모는 전체 시험 수에서 "해당 없음"을 뺀 수다(전체 ${testTotal(total)}개 − 해당 없음 ${total.notApplicable}개 = ${denominator}개).`,
    "- 막대는 10칸이고 채운 칸 수는 반올림(통과 ÷ 분모 × 10)이다. 숫자는 각 시험 행의 결과 칸을 센 값이며, 세는 규칙은 1.5절 \"진행 점수표 세는 규칙\"을 따른다.",
  ];
}

const DOCUMENT_KINDS = Object.freeze({
  progress: { markers: PROGRESS_MARKERS, build: (text) => renderProgressBlock(countProgress(text)) },
  test: { markers: TEST_MARKERS, build: (text) => renderTestBlock(countTestScore(text)) },
});

// 표식 사이만 새로 계산한 내용으로 바꾼 문서 전체를 돌려준다. 줄바꿈 방식(CRLF·LF)은 그대로 둔다.
export function updateDocumentText(text, kind) {
  const config = DOCUMENT_KINDS[kind];
  if (!config) throw new ProgressDocumentError(`알 수 없는 문서 종류입니다: ${kind}`);
  const { eol, lines } = splitDocument(text);
  const range = findMarkerRange(lines, config.markers);
  const block = config.build(text);
  return [...lines.slice(0, range.start + 1), ...block, ...lines.slice(range.end)].join(eol);
}

// 표식 사이의 지금 내용과 다시 계산한 내용을 비교해 다른 줄을 돌려준다(같으면 빈 배열).
export function diffDocumentBlock(text, kind) {
  const config = DOCUMENT_KINDS[kind];
  const { lines } = splitDocument(text);
  const range = findMarkerRange(lines, config.markers);
  const actual = lines.slice(range.start + 1, range.end);
  const expected = config.build(text);
  const differences = [];
  for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
    if (actual[index] !== expected[index]) {
      differences.push({ line: range.start + 2 + index, actual: actual[index] ?? "(없음)", expected: expected[index] ?? "(없음)" });
    }
  }
  return differences;
}

export const DEFAULT_DOCUMENTS = Object.freeze([
  { kind: "progress", label: "진행 체크리스트", url: PROGRESS_DOCUMENT },
  { kind: "test", label: "테스트 체크리스트", url: TEST_DOCUMENT },
]);

export async function runProgress(mode, { documents = DEFAULT_DOCUMENTS, log = console.log } = {}) {
  if (mode !== "--write" && mode !== "--check") {
    throw new ProgressDocumentError("사용법: node scripts/work-tools-progress.mjs --write | --check");
  }
  let failures = 0;
  for (const document of documents) {
    const text = await readFile(document.url, "utf8");
    if (mode === "--check") {
      const differences = diffDocumentBlock(text, document.kind);
      if (differences.length === 0) {
        log(`${document.label}: 표가 체크 항목·결과 칸과 같습니다.`);
        continue;
      }
      failures += 1;
      log(`${document.label}: 표가 실제와 다릅니다(${differences.length}줄). node scripts/work-tools-progress.mjs --write로 다시 쓰세요.`);
      for (const difference of differences) {
        log(`  ${difference.line}행\n    지금: ${difference.actual}\n    계산: ${difference.expected}`);
      }
    } else {
      const next = updateDocumentText(text, document.kind);
      if (next !== text) {
        await writeFile(document.url, next, "utf8");
        log(`${document.label}: 표를 다시 썼습니다.`);
      } else {
        log(`${document.label}: 바뀐 것이 없습니다.`);
      }
    }
  }
  return failures === 0;
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    const ok = await runProgress(process.argv[2]);
    if (!ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof ProgressDocumentError ? error.message : error);
    process.exitCode = 2;
  }
}
