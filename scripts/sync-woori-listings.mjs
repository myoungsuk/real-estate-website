import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchAllowedBuffer } from "./sync/http.mjs";
import {
  WOORI_PUBLIC_HOSTS,
  WOORI_PUBLIC_LIST_PATH,
  parseWooriPublicListResponse,
  wooriPublicListUrl,
  wooriPublicRowsToTable,
} from "./sync/woori-listings.mjs";
import { createWooriListingImport } from "../src/lib/admin/woori-listing-import.mjs";
import { updateListingReviewStateForAdmin, validateListingReviewState } from "../src/lib/listing-review.mjs";
import { validateNaverListings } from "./content-validation.mjs";

const CONTENT_PATH = join("src", "data", "naver-listings.json");
const REVIEW_STATE_PATH = join(".github", "listing-review-state.json");

async function readJson(path, label) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label}을 읽지 못했습니다: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${label}이 올바른 JSON이 아닙니다.`);
  }
}

function temporaryPath(path) {
  return `${path}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
}

async function writeTextAtomically(path, value) {
  const temporary = temporaryPath(path);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, value, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function seoulDate(now) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("실행 날짜를 계산할 수 없습니다.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

// 하루 1번, 요청 1번만 보낸다. 우리집부동산은 짧은 시간에 여러 번 부르면 IP를 막는다(2026-11-24 회신).
export async function fetchWooriPublicRows({ fetcher = globalThis.fetch } = {}) {
  const label = "우리집부동산 공개 매물 목록";
  const { response, buffer } = await fetchAllowedBuffer(wooriPublicListUrl(), {
    allowedHosts: WOORI_PUBLIC_HOSTS,
    fetcher,
    attempts: 1,
    timeoutMs: 15_000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 0,
    label,
  });
  const responseUrl = new URL(response.url || wooriPublicListUrl());
  if (!WOORI_PUBLIC_HOSTS.has(responseUrl.hostname) || responseUrl.pathname !== WOORI_PUBLIC_LIST_PATH) {
    throw new Error(`${label}: 승인된 주소가 아닙니다.`);
  }
  let body;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label}: UTF-8 글을 읽지 못했습니다.`);
  }
  return parseWooriPublicListResponse(body);
}

async function appendGitHubSummary(result, summaryPath) {
  if (!summaryPath) return;
  const lines = [
    "## 우리집부동산 공개 매물 동기화",
    "",
    `- Public listings: ${result.publicCount}`,
    `- Imported: ${result.importedCount}`,
    `- New: ${result.newCount}`,
    `- Changed: ${result.changedCount}`,
    `- Removed: ${result.removedCount}`,
    `- Skipped: ${result.skippedCount}`,
    `- Content: ${result.contentChanged ? "changed" : "unchanged"}`,
    `- Review state: ${result.reviewStateChanged ? "changed" : "unchanged"}`,
  ];
  await writeFile(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

export async function runWooriListingSync({
  rootDir = process.cwd(),
  dryRun = false,
  fetcher = globalThis.fetch,
  now = new Date(),
  logger = console,
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  const absoluteRoot = resolve(rootDir);
  const contentPath = join(absoluteRoot, CONTENT_PATH);
  const reviewStatePath = join(absoluteRoot, REVIEW_STATE_PATH);
  const [current, reviewState, publicRows] = await Promise.all([
    readJson(contentPath, CONTENT_PATH),
    readJson(reviewStatePath, REVIEW_STATE_PATH),
    fetchWooriPublicRows({ fetcher }),
  ]);
  const today = seoulDate(now);
  const table = wooriPublicRowsToTable(publicRows);
  const plan = createWooriListingImport(table.headers, table.rows, current, reviewState, today);
  if (plan.errors.length > 0) {
    // 줄 번호와 까닭만 남긴다(매물 값은 로그에 넣지 않음).
    const detail = plan.errors.slice(0, 10).map((error) => `${error.rowNumber}번째 줄: ${error.message}`).join(" / ");
    throw new Error(`우리집부동산 공개 매물 ${plan.errors.length}곳의 형식이 맞지 않아 아무것도 바꾸지 않았습니다. ${detail}`);
  }
  if (!plan.nextData) throw new Error("우리집부동산 공개 매물을 반영한 목록을 만들지 못했습니다.");

  const contentChanged = JSON.stringify(plan.nextData) !== JSON.stringify(current);
  const nextData = contentChanged ? plan.nextData : current;
  const nextReviewState = updateListingReviewStateForAdmin({
    listings: nextData.items,
    currentState: reviewState,
    updatedAt: today,
    wooriIds: plan.wooriIds,
  });
  const listingErrors = validateNaverListings(nextData);
  if (listingErrors.length > 0) throw new Error(`반영할 공개 매물 목록 검사 실패: ${listingErrors.slice(0, 5).join(" / ")}`);
  validateListingReviewState(nextReviewState, { listingIds: nextData.items.map((item) => item.id) });
  const reviewStateChanged = JSON.stringify(nextReviewState) !== JSON.stringify(reviewState);

  if (!dryRun) {
    if (contentChanged) await writeTextAtomically(contentPath, `${JSON.stringify(nextData, null, 2)}\n`);
    if (reviewStateChanged) await writeTextAtomically(reviewStatePath, `${JSON.stringify(nextReviewState, null, 2)}\n`);
  }

  const result = {
    publicCount: publicRows.length,
    importedCount: plan.importedCount,
    newCount: plan.newItems.length,
    changedCount: plan.changedItems.length,
    removedCount: plan.removedItems.length,
    skippedCount: plan.skippedItems.length,
    contentChanged,
    reviewStateChanged,
    dryRun,
    newIds: plan.newItems.map((item) => item.id),
    changedIds: plan.changedItems.map((item) => item.id),
    removedIds: plan.removedItems.map((item) => item.id),
    skipped: plan.skippedItems.map((item) => ({ id: item.id, reason: item.reason })),
  };
  logger.log(`Public listings: ${result.publicCount}`);
  logger.log(`Imported: ${result.importedCount}`);
  logger.log(`New: ${result.newCount}`);
  logger.log(`Changed: ${result.changedCount}`);
  logger.log(`Removed: ${result.removedCount}`);
  logger.log(`Skipped: ${result.skippedCount}`);
  if (dryRun) logger.log("No files changed");
  else if (!contentChanged && !reviewStateChanged) logger.log("No changes");
  await appendGitHubSummary(result, summaryPath);
  return result;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowedArgs = new Set(["--dry-run"]);
  const unknown = [...args].filter((argument) => !allowedArgs.has(argument));
  if (unknown.length > 0) throw new Error(`지원하지 않는 옵션입니다: ${unknown.join(", ")}`);
  await runWooriListingSync({ dryRun: args.has("--dry-run") });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`우리집부동산 공개 매물 동기화 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
