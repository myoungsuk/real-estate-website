// 관리자 '사용 안내' 단계 그림을 다시 찍는다: npm run help:shots (사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄").
// 1) 지금 원본으로 dist를 다시 만들고(npm run build:site, --no-build면 건너뜀) 2) 시험 서버를 띄워 e2e/help-shots/를 돌려 PNG·번호 자리를 받은 뒤
// 3) sharp로 WebP(품질 75, 휴대폰 그림은 찍은 크기, 넓은 화면 그림은 폭 1520px까지)로 바꿔 public/admin/help/img/에 쓰고
// 4) 크기·번호 자리·SHA-256·화면 원본 지문을 src/lib/admin-help-images.json에 쓴다. 시험 서버는 같은 실행에서 끈다.
// 그림은 운영자 PC(Windows 글꼴)에서만 찍는다. CI는 다시 찍지 않고 tests/admin-help-images.test.mjs로 지문·크기만 본다.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { ADMIN_HELP_FIGURES, ADMIN_HELP_IMAGE_MAX_BYTES } from "../src/lib/admin-help-figures.mjs";
import { figureFileHashes, figureFingerprint } from "./admin-help-sources.mjs";

const WIDE_MAX_WIDTH = 1520;
const QUALITY = 75;
const root = new URL("../", import.meta.url);
const RAW = new URL("test-results/help-shots-raw/", root);
const IMG = new URL("public/admin/help/img/", root);
const MANIFEST = new URL("src/lib/admin-help-images.json", root);
const port = 4395;
const origin = `http://127.0.0.1:${port}`;

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  child.once("error", reject);
  child.once("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${args.join(" ")}: ${signal ?? code}`))));
});

async function waitForServer(server) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error("시험 서버가 일찍 끝났습니다");
    try {
      if ((await fetch(origin)).ok) return;
    } catch {
      // 포트가 열릴 때까지 다시 본다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("시험 서버 시작 시간을 넘겼습니다");
}

if (!process.argv.includes("--no-build")) {
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build:site"], { shell: process.platform === "win32" });
}
await rm(RAW, { recursive: true, force: true });
const server = spawn(process.execPath, ["scripts/serve-dist.mjs", "--port", String(port)], { stdio: "ignore", cwd: root });
try {
  await waitForServer(server);
  await run(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", "playwright.help-shots.config.mjs"], {
    cwd: root,
    env: { ...process.env, E2E_BASE_URL: origin, HELP_SHOTS_OUT: fileURLToPath(RAW) },
  });
} finally {
  server.kill();
}

await mkdir(IMG, { recursive: true });
const manifest = { note: "npm run help:shots가 쓰는 파일입니다. 손으로 고치지 않습니다.", figures: {} };
const keep = new Set();
const rows = [];
for (const [id, figure] of Object.entries(ADMIN_HELP_FIGURES)) {
  const shots = {};
  for (const [device, frames] of [["phone", figure.phone], ["wide", figure.wide]]) {
    for (const frame of frames) {
      const png = await readFile(new URL(`${frame.shot}.png`, RAW));
      const { marks } = JSON.parse(await readFile(new URL(`${frame.shot}.json`, RAW), "utf8"));
      if (marks.length !== frame.pins.length) throw new Error(`${frame.shot}: 번호 ${marks.length}개, 글 ${frame.pins.length}줄`);
      let image = sharp(png);
      if (device === "wide") image = image.resize({ width: WIDE_MAX_WIDTH, withoutEnlargement: true });
      const webp = await image.webp({ quality: QUALITY, effort: 6 }).toBuffer();
      const info = await sharp(webp).metadata();
      await writeFile(new URL(`${frame.shot}.webp`, IMG), webp);
      keep.add(`${frame.shot}.webp`);
      shots[frame.shot] = { width: info.width, height: info.height, bytes: webp.length, sha256: createHash("sha256").update(webp).digest("hex"), marks };
      rows.push([frame.shot, info.width, info.height, webp.length]);
    }
  }
  manifest.figures[id] = { route: figure.route, sources: await figureFingerprint(figure), shots };
  // 낡아도 경고만 하는 그림(2026-11-24 사용자 결정 "AI 칸만 경고")은 바뀐 파일 이름을 알릴 수 있게 파일별 지문도 적는다.
  if (figure.staleness === "warn") manifest.figures[id].files = await figureFileHashes(figure);
}
for (const name of await readdir(IMG)) if (!keep.has(name)) await rm(new URL(name, IMG));
await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

let over = 0;
for (const [shot, width, height, bytes] of rows) {
  const big = bytes > ADMIN_HELP_IMAGE_MAX_BYTES;
  over += big ? 1 : 0;
  console.log(`${shot.padEnd(26)} ${String(width).padStart(5)}×${String(height).padEnd(5)} ${String(Math.round(bytes / 1024)).padStart(3)}KB${big ? "  ← 70KB 넘음" : ""}`);
}
console.log(`그림 ${rows.length}장, 합계 ${Math.round(rows.reduce((sum, row) => sum + row[3], 0) / 1024)}KB → public/admin/help/img/, src/lib/admin-help-images.json (화면에서 보려면 npm run build를 다시 합니다)`);
if (over) {
  console.error(`70KB를 넘는 그림 ${over}장: 찍는 칸(e2e/help-shots/help-shots.shot.mjs의 clip)을 줄여 다시 찍어 주세요.`);
  process.exitCode = 1;
}
