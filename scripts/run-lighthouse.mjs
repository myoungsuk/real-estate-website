import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { chromium } from "@playwright/test";

const host = "127.0.0.1";
const port = 4322;
const origin = `http://${host}:${port}`;
const pages = ["/", "/properties/", "/complexes/"];
const categoryMinimum = 0.9;
const lcpMaximumMs = 2_500;
const tbtMaximumMs = 200;
const clsMaximum = 0.1;
const profileDirectory = resolve("test-results", `lighthouse-profile-${process.pid}`);

function startPreview() {
  return spawn(
    process.execPath,
    ["scripts/serve-dist.mjs", "--port", String(port)],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
}

async function waitForPreview(child) {
  const timeoutAt = Date.now() + 30_000;
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });

  while (Date.now() < timeoutAt) {
    if (child.exitCode !== null) throw new Error(`Astro preview가 일찍 종료되었습니다.\n${output}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Preview가 포트를 열 때까지 짧게 재시도합니다.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Astro preview 시작 시간을 초과했습니다.\n${output}`);
}

function score(result, category) {
  return result.lhr.categories[category]?.score ?? 0;
}

function metric(result, audit) {
  return result.lhr.audits[audit]?.numericValue ?? Number.POSITIVE_INFINITY;
}

async function waitForProcessExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    new Promise((resolveTimeout) => setTimeout(resolveTimeout, timeoutMs)),
  ]);
  return child.exitCode !== null;
}

const preview = startPreview();
let chrome;

try {
  await waitForPreview(preview);
  await mkdir(profileDirectory, { recursive: true });
  chrome = await launch({
    chromePath: chromium.executablePath(),
    chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu"],
    handleSIGINT: false,
    userDataDir: profileDirectory,
  });

  let failed = false;
  for (const pathname of pages) {
    const result = await lighthouse(`${origin}${pathname}`, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: "mobile",
      screenEmulation: {
        mobile: true,
        width: 390,
        height: 844,
        deviceScaleFactor: 3,
        disabled: false,
      },
    });
    if (!result) throw new Error(`${pathname} Lighthouse 결과가 없습니다.`);

    const scores = {
      performance: score(result, "performance"),
      accessibility: score(result, "accessibility"),
      bestPractices: score(result, "best-practices"),
      seo: score(result, "seo"),
    };
    const lcp = metric(result, "largest-contentful-paint");
    const tbt = metric(result, "total-blocking-time");
    const cls = metric(result, "cumulative-layout-shift");
    console.log(
      `${pathname} performance=${Math.round(scores.performance * 100)} accessibility=${Math.round(scores.accessibility * 100)} best-practices=${Math.round(scores.bestPractices * 100)} seo=${Math.round(scores.seo * 100)} LCP=${Math.round(lcp)}ms TBT=${Math.round(tbt)}ms CLS=${cls.toFixed(3)}`,
    );

    for (const [name, value] of Object.entries(scores)) {
      if (value < categoryMinimum) {
        console.error(`${pathname} ${name} 점수가 ${categoryMinimum * 100}점 미만입니다.`);
        failed = true;
      }
    }
    if (lcp > lcpMaximumMs) {
      console.error(`${pathname} LCP가 ${lcpMaximumMs}ms를 초과했습니다.`);
      failed = true;
    }
    if (tbt > tbtMaximumMs) {
      console.error(`${pathname} TBT가 ${tbtMaximumMs}ms를 초과했습니다.`);
      failed = true;
    }
    if (cls > clsMaximum) {
      console.error(`${pathname} CLS가 ${clsMaximum}을 초과했습니다.`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
} finally {
  if (chrome) {
    const chromeProcess = chrome.process;
    chrome.kill();
    if (!(await waitForProcessExit(chromeProcess, 2_000)) && process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(chrome.pid), "/T", "/F"], { stdio: "ignore" });
      await waitForProcessExit(chromeProcess, 2_000);
    }
    if (chromeProcess.exitCode === null) {
      chromeProcess.kill("SIGKILL");
      await waitForProcessExit(chromeProcess, 2_000);
    }
  }
  preview.kill();
  if (!(await waitForProcessExit(preview, 2_000))) {
    preview.kill("SIGKILL");
    await waitForProcessExit(preview, 2_000);
  }
  try {
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`Chrome 임시 폴더 정리를 완료하지 못했습니다: ${error instanceof Error ? error.message : error}`);
  }
}
