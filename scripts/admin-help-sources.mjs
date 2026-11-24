// 사용 안내 단계 그림(src/lib/admin-help-figures.mjs)이 찍은 화면의 원본 지문.
// scripts/help-shots.mjs가 찍을 때 지문을 src/lib/admin-help-images.json에 적고, tests/admin-help-images.test.mjs가 지금 원본과 맞춰 본다.
// 지문을 세는 파일은 그림마다 ADMIN_HELP_FIGURES의 sources(화면 .astro, 찍힌 칸을 그리는 스크립트, 그 칸 글의 순수 함수)다.
// screenSourceFiles는 화면이 상대 경로로 불러오는 src 안 파일 전부(CSS·사용 안내 파일·src/layouts/ 제외)이고, sources가 모두 그 안에 있는지 시험이 본다.
// 줄 끝(CRLF·LF)은 LF로 맞춰 센다(Windows로 받은 폴더와 CI가 같은 지문을 내게).
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const SKIP_FILES = new Set([
  "src/lib/admin-help.mjs",
  "src/lib/admin-help-figures.mjs",
  "src/lib/admin-help-images.json",
  "src/components/admin/AdminPageHelp.astro",
  "src/components/admin/AdminHelpText.astro",
  "src/components/admin/AdminHelpFigure.astro",
]);
const SKIP_DIRS = ["src/layouts/"];

async function isFile(url) {
  try {
    return (await stat(url)).isFile();
  } catch {
    return false;
  }
}

async function resolveImport(fromPath, specifier) {
  const base = new URL(specifier, new URL(fromPath, root));
  for (const candidate of [base, ...["ts", "mjs", "js", "astro", "json"].map((ext) => new URL(`${base.href}.${ext}`))]) {
    if (await isFile(candidate)) return decodeURIComponent(candidate.href.slice(root.href.length));
  }
  return null;
}

/** 관리 화면 주소(/admin/work/ledger/) → 화면 파일(src/pages/admin/work/ledger.astro 또는 …/index.astro). */
export async function screenPageFile(route) {
  const trimmed = route.replace(/^\/|\/$/gu, "");
  for (const candidate of [`src/pages/${trimmed}.astro`, `src/pages/${trimmed}/index.astro`]) {
    if (await isFile(new URL(candidate, root))) return candidate;
  }
  throw new Error(`${route}: 화면 파일이 없습니다`);
}

/** 그 화면의 원본 파일 목록(저장소 기준 경로, 정렬). */
export async function screenSourceFiles(route) {
  const seen = new Set();
  const queue = [await screenPageFile(route)];
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path) || SKIP_FILES.has(path) || SKIP_DIRS.some((dir) => path.startsWith(dir))) continue;
    seen.add(path);
    const source = await readFile(new URL(path, root), "utf8");
    for (const match of source.matchAll(/(?:import|from)\s*["'](\.{1,2}\/[^"']+)["']/gu)) {
      if (match[1].endsWith(".css")) continue;
      const resolved = await resolveImport(path, match[1]);
      if (resolved?.startsWith("src/")) queue.push(resolved);
    }
  }
  return [...seen].sort();
}

/** [{ path, text }] → 파일 이름과 LF로 맞춘 내용을 차례로 이어 센 SHA-256(16진수). */
export function fingerprintOf(entries) {
  const hash = createHash("sha256");
  for (const { path, text } of entries) {
    const lf = text.replace(/\r\n/gu, "\n");
    hash.update(`${path}\n${lf.length}\n${lf}\n`);
  }
  return hash.digest("hex");
}

/** 그림의 원본 지문(figure.sources를 정렬해 셈). */
export async function figureFingerprint(figure) {
  const entries = [];
  for (const path of [...figure.sources].sort()) entries.push({ path, text: await readFile(new URL(path, root), "utf8") });
  return fingerprintOf(entries);
}

/** 그림 sources 파일마다의 지문({ 경로: LF로 맞춘 내용의 SHA-256 }). 낡아도 경고만 하는 그림(staleness: "warn")만 manifest에 적어, 바뀐 파일 이름을 알린다. */
export async function figureFileHashes(figure) {
  const hashes = {};
  for (const path of [...figure.sources].sort()) hashes[path] = fingerprintOf([{ path, text: await readFile(new URL(path, root), "utf8") }]);
  return hashes;
}

/** 찍을 때 적어 둔 파일별 지문(recorded)과 지금 원본을 견줘 바뀐(또는 새로 더한) sources 파일 목록. 적어 둔 것이 없으면 sources 전부. */
export async function changedSourceFiles(figure, recorded = {}) {
  const now = await figureFileHashes(figure);
  return Object.keys(now).filter((path) => recorded[path] !== now[path]);
}
