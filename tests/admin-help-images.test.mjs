// 사용 안내 단계 그림(사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄 — 그림이 화면과 달라지면 시험이 떨어져 다시 찍게 함").
// 그림끼리 픽셀을 비교하지 않는다(Windows와 CI 글꼴이 달라 늘 다름). 대신 찍을 때 적어 둔 화면 원본 지문이 지금 원본과 같은지 본다.
// 예외: 계약서 AI 두 그림(staleness: "warn")은 낡아도 떨어뜨리지 않고 그림 이름·바뀐 파일을 한 줄씩 알린다(CI에서는 GitHub ::warning 주석).
// 사용자 결정 2026-11-24 "AI 칸만 경고". 구조·크기·SHA 검사는 이 두 그림도 그대로다.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { ADMIN_HELP_GUIDE } from "../src/lib/admin-help.mjs";
import { ADMIN_HELP_FIGURES, ADMIN_HELP_IMAGE_MAX_BYTES, figureFrameStarts } from "../src/lib/admin-help-figures.mjs";
import { changedSourceFiles, figureFileHashes, figureFingerprint, fingerprintOf, screenSourceFiles } from "../scripts/admin-help-sources.mjs";

const root = new URL("../", import.meta.url);
const IMG = new URL("public/admin/help/img/", root);
const manifest = JSON.parse(await readFile(new URL("src/lib/admin-help-images.json", root), "utf8"));
const sections = ADMIN_HELP_GUIDE.flatMap((group) => group.sections);
const RESHOOT = "npm run build 뒤 npm run help:shots로 다시 찍고, 바뀐 그림을 확인해 함께 커밋";
const WARN_ONLY = ["contract-ai-box", "contract-ai-review"];

// 낡은 경고 그림을 알린다. 시험 출력에 한 줄, GitHub Actions에서는 ::warning 주석(실행 요약에 보임)도 남긴다.
function warnStale(id, files) {
  const line = `다시 찍을 그림(경고만, 시험은 통과): ${id} · 바뀐 파일: ${files.join(", ") || "(알 수 없음)"} — ${RESHOOT}`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=사용 안내 그림이 낡았을 수 있음::${line}`);
}

// WebP 머리에서 가로·세로 픽셀과 조각 이름을 읽는다(VP8·VP8L·VP8X).
function webpInfo(buffer) {
  assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  assert.equal(buffer.toString("ascii", 8, 12), "WEBP");
  const chunks = [];
  for (let at = 12; at + 8 <= buffer.length;) {
    const id = buffer.toString("ascii", at, at + 4);
    const size = buffer.readUInt32LE(at + 4);
    chunks.push({ id, at: at + 8 });
    at += 8 + size + (size % 2);
  }
  const first = chunks[0];
  if (first.id === "VP8 ") return { chunks: chunks.map((c) => c.id), width: buffer.readUInt16LE(first.at + 6) & 0x3fff, height: buffer.readUInt16LE(first.at + 8) & 0x3fff };
  if (first.id === "VP8L") {
    const bits = buffer.readUInt32LE(first.at + 1);
    return { chunks: chunks.map((c) => c.id), width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  assert.equal(first.id, "VP8X");
  return { chunks: chunks.map((c) => c.id), width: buffer.readUIntLE(first.at + 4, 3) + 1, height: buffer.readUIntLE(first.at + 7, 3) + 1 };
}

test("단계 그림은 사용 안내 화면의 자기 칸에 한 번씩 놓이고, 그 칸이 설명하는 화면을 찍는다", () => {
  const placed = sections.flatMap((section) => section.blocks.filter((block) => block.type === "figure").map((block) => [block.id, section]));
  assert.deepEqual(placed.map(([id]) => id).sort(), Object.keys(ADMIN_HELP_FIGURES).sort(), "그림마다 사용 안내에 한 번");
  for (const [id, section] of placed) {
    const figure = ADMIN_HELP_FIGURES[id];
    assert.equal(section.id, figure.section, `${id}: 놓인 칸`);
    assert.ok(section.screens.includes(figure.route), `${id}: 칸이 설명하는 화면(${figure.route})`);
    assert.ok(figure.phone.length >= 1 && figure.wide.length >= 1, `${id}: 휴대폰·넓은 화면 그림이 다 있음`);
  }
});

test("그림 칸마다 대체 글이 있고, 번호는 그림 줄 전체에서 1부터 이어진다", () => {
  const names = new Set();
  for (const [id, figure] of Object.entries(ADMIN_HELP_FIGURES)) {
    for (const device of ["phone", "wide"]) {
      for (const frame of figure[device]) {
        assert.match(frame.shot, new RegExp(`^[a-z]+-${device}-\\d-[a-z]+$`, "u"), `${id}: 칸 이름 ${frame.shot}`);
        assert.ok(!names.has(frame.shot), `${frame.shot}: 칸 이름이 겹치지 않음`);
        names.add(frame.shot);
        assert.ok(frame.alt.length >= 15 && frame.alt.endsWith("."), `${frame.shot}: 무엇이 보이는지 한 문장 이상(대체 글)`);
        assert.ok(frame.pins.length >= 1 && frame.pins.length <= 3, `${frame.shot}: 번호 1 ~ 3개`);
      }
      const starts = figureFrameStarts(figure[device]);
      assert.equal(starts[0], 1);
      assert.equal(starts.at(-1) + figure[device].at(-1).pins.length - 1, figure[device].reduce((sum, frame) => sum + frame.pins.length, 0), `${id} ${device}: 번호가 끊기지 않음`);
    }
  }
});

test("그림 파일은 칸마다 하나씩 있고, 적어 둔 크기·SHA-256과 같으며, 장당 70KB 이하·찍은 기기 정보 없는 WebP다", async () => {
  const expected = new Set();
  for (const [id, figure] of Object.entries(ADMIN_HELP_FIGURES)) {
    const record = manifest.figures[id];
    assert.ok(record, `${id}: src/lib/admin-help-images.json에 없음 — ${RESHOOT}`);
    assert.equal(record.route, figure.route, `${id}: 찍은 화면`);
    assert.deepEqual(Object.keys(record.shots).sort(), [...figure.phone, ...figure.wide].map((frame) => frame.shot).sort(), `${id}: 칸 목록 — ${RESHOOT}`);
    for (const device of ["phone", "wide"]) {
      for (const frame of figure[device]) {
        const shot = record.shots[frame.shot];
        expected.add(`${frame.shot}.webp`);
        assert.equal(shot.marks.length, frame.pins.length, `${frame.shot}: 번호 자리 수 = 번호 글 수 — ${RESHOOT}`);
        for (const [left, top, right, bottom] of shot.marks) assert.ok(left >= 0 && top >= 0 && right <= 1 && bottom <= 1 && left < right && top < bottom, `${frame.shot}: 번호 자리가 그림 안`);
        const buffer = await readFile(new URL(`${frame.shot}.webp`, IMG));
        assert.ok(buffer.length <= ADMIN_HELP_IMAGE_MAX_BYTES, `${frame.shot}: ${buffer.length}바이트(70KB 이하)`);
        assert.equal(buffer.length, shot.bytes, `${frame.shot}: 적어 둔 크기`);
        assert.equal(createHash("sha256").update(buffer).digest("hex"), shot.sha256, `${frame.shot}: 손으로 바꾼 그림이 아님 — ${RESHOOT}`);
        const info = webpInfo(buffer);
        assert.deepEqual([info.width, info.height], [shot.width, shot.height], `${frame.shot}: 적어 둔 픽셀 크기`);
        assert.ok(info.width <= (device === "phone" ? 800 : 1520), `${frame.shot}: 폭 ${info.width}px`);
        assert.deepEqual(info.chunks.filter((chunk) => ["EXIF", "XMP ", "ICCP"].includes(chunk)), [], `${frame.shot}: 부가 정보 조각 없음`);
      }
    }
  }
  assert.deepEqual((await readdir(IMG)).sort(), [...expected].sort(), "public/admin/help/img/에는 쓰는 그림만");
});

test("그림을 찍은 뒤 그 칸의 원본(화면 .astro·칸을 그리는 스크립트·글 함수)이 바뀌었으면 다시 찍어야 한다", async () => {
  for (const [id, figure] of Object.entries(ADMIN_HELP_FIGURES)) {
    const reachable = await screenSourceFiles(figure.route);
    assert.equal(figure.sources[0], reachable.find((file) => file.startsWith("src/pages/")), `${id}: sources 첫 줄은 그 화면 .astro`);
    assert.equal(new Set(figure.sources).size, figure.sources.length, `${id}: sources 겹침 없음`);
    for (const file of figure.sources) assert.ok(reachable.includes(file), `${id}: ${file}은 그 화면이 불러오는 파일이어야 함(이름이 바뀌었거나 더 쓰지 않으면 sources를 고침)`);
    assert.ok(figure.sources.every((file) => !file.endsWith(".css") && !file.startsWith("src/layouts/")), `${id}: CSS·공통 틀은 지문에서 뺌`);
    if (figure.staleness === "warn") {
      assert.deepEqual(Object.keys(manifest.figures[id].files ?? {}).sort(), [...figure.sources].sort(), `${id}: 경고 그림은 파일별 지문을 적어 둠 — ${RESHOOT}`);
      if (manifest.figures[id].sources !== await figureFingerprint(figure)) warnStale(id, await changedSourceFiles(figure, manifest.figures[id].files));
      continue;
    }
    assert.equal(manifest.figures[id].sources, await figureFingerprint(figure), `${id}(${figure.sources.join(", ")}): 그림에 찍힌 칸의 원본이 그림을 찍은 뒤 바뀌었습니다. 그림이 낡았을 수 있음 — ${RESHOOT}`);
  }
});

test("낡아도 경고만 하는 그림은 계약서 AI 두 그림뿐이고, 경고에는 바뀐 파일 이름이 나온다", async () => {
  const warn = Object.entries(ADMIN_HELP_FIGURES).filter(([, figure]) => figure.staleness !== undefined);
  assert.deepEqual(warn.map(([id]) => id).sort(), WARN_ONLY, "사용자 결정 2026-11-24 \"AI 칸만 경고\"의 두 그림만");
  for (const [id, figure] of warn) {
    assert.equal(figure.staleness, "warn", `${id}: staleness는 \"warn\"만`);
    const now = await figureFileHashes(figure);
    assert.deepEqual(await changedSourceFiles(figure, now), [], `${id}: 같으면 바뀐 파일 없음`);
    const [first, ...rest] = [...figure.sources].sort();
    assert.deepEqual(await changedSourceFiles(figure, { ...now, [first]: "0".repeat(64) }), [first], `${id}: 한 파일만 다르면 그 파일`);
    assert.deepEqual(await changedSourceFiles(figure, {}), [first, ...rest], `${id}: 적어 둔 것이 없으면 전부`);
  }
  for (const [id, figure] of Object.entries(ADMIN_HELP_FIGURES)) if (figure.staleness === undefined) assert.equal(manifest.figures[id]?.files, undefined, `${id}: 시험이 떨어지는 그림은 파일별 지문을 적지 않음`);
});

test("화면 원본 지문은 줄 끝(CRLF·LF)과 상관없고, 원본 한 글자가 바뀌면 달라진다", async () => {
  const figure = ADMIN_HELP_FIGURES["calendar-feed"];
  const files = [...figure.sources].sort();
  assert.ok(files.includes("src/pages/admin/work/schedule.astro"));
  assert.ok(files.some((file) => file.startsWith("src/lib/")), "칸을 그리는 스크립트도 셈");
  const entries = await Promise.all(files.map(async (path) => ({ path, text: await readFile(new URL(path, root), "utf8") })));
  const now = await figureFingerprint(figure);
  assert.equal(fingerprintOf(entries), now);
  assert.equal(fingerprintOf(entries.map((entry) => ({ ...entry, text: entry.text.replace(/\r?\n/gu, "\r\n") }))), now, "CRLF로 받아도 같음");
  assert.equal(fingerprintOf(entries.map((entry) => ({ ...entry, text: entry.text.replace(/\r\n/gu, "\n") }))), now, "LF로 받아도 같음");
  const changed = entries.map((entry) => ({ ...entry, text: entry.path.endsWith("schedule.astro") ? entry.text.replace("구독 주소 만들기", "구독 주소 만들기!") : entry.text }));
  assert.notEqual(fingerprintOf(changed), now, "단추 이름 한 글자");
});
