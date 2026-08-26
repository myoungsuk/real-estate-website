import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchAllowedBuffer } from "./sync/http.mjs";
import {
  BANK_OFFICE_HOSTS,
  BANK_OFFICE_PATH,
  BANK_OFFICE_START_URL,
  BANK_SYNC_MAX_PAGES,
  mergeBankPublicPages,
  parseBankPublicPage,
  planBankListingSync,
} from "./sync/bank-listings.mjs";

const CONTENT_PATH = join("src", "data", "naver-listings.json");
const STATE_PATH = join(".github", "bank-listing-sync-state.json");

async function readJson(path, label) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`${label}을 읽지 못했습니다: ${error.message}`);
  }
  try {
    return { raw, value: JSON.parse(raw) };
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

function decodeHtml(buffer, contentType, label) {
  if (contentType && !contentType.includes("text/html") && !contentType.startsWith("text/")) {
    throw new Error(`${label}: HTML Content-Type이 아닙니다.`);
  }
  const encoding = contentType.includes("utf-8") ? "utf-8" : "euc-kr";
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`${label}: ${encoding.toUpperCase()} HTML을 읽지 못했습니다.`);
  }
}

async function fetchBankPage(value, { fetcher, fetchAttempts, label }) {
  const { response, buffer } = await fetchAllowedBuffer(value, {
    allowedHosts: BANK_OFFICE_HOSTS,
    fetcher,
    attempts: fetchAttempts,
    timeoutMs: 15_000,
    maxBytes: 2 * 1024 * 1024,
    maxRedirects: 3,
    label,
  });
  const responseUrl = new URL(response.url || value);
  if (responseUrl.hostname !== "land.neonet.co.kr" || responseUrl.pathname !== BANK_OFFICE_PATH) {
    throw new Error(`${label}: 승인된 중개사무소 최종 주소가 아닙니다.`);
  }
  return {
    responseUrl,
    parsed: parseBankPublicPage(decodeHtml(buffer, response.headers.get("content-type")?.toLowerCase() ?? "", label)),
  };
}

export async function fetchBankPublicSnapshot({ fetcher = globalThis.fetch, fetchAttempts = 2 } = {}) {
  const first = await fetchBankPage(BANK_OFFICE_START_URL, { fetcher, fetchAttempts, label: "부동산뱅크 공개 매물 1페이지" });
  const pageNumbers = first.parsed.pageNumbers;
  const lastPage = Math.max(...pageNumbers);
  if (lastPage > BANK_SYNC_MAX_PAGES) throw new Error(`부동산뱅크 공개 매물 페이지가 ${BANK_SYNC_MAX_PAGES}페이지를 초과했습니다.`);
  const expectedPages = Array.from({ length: lastPage }, (_, index) => index + 1);
  if (expectedPages.some((page) => !pageNumbers.includes(page))) throw new Error("부동산뱅크 공개 매물 페이지 번호가 연속적이지 않습니다.");

  const pages = [first.parsed];
  for (const page of pageNumbers.filter((value) => value > 1)) {
    const pageUrl = new URL(first.responseUrl);
    pageUrl.search = `?page=${page}`;
    const next = await fetchBankPage(pageUrl, { fetcher, fetchAttempts, label: `부동산뱅크 공개 매물 ${page}페이지` });
    pages.push(next.parsed);
  }
  return mergeBankPublicPages(pages);
}

async function appendGitHubSummary(result) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const lines = [
    "## 부동산뱅크 공개 매물 동기화",
    "",
    `- Public listings: ${result.publicCount}`,
    `- New: ${result.newCount}`,
    `- Changed: ${result.changedCount}`,
    `- Same: ${result.sameCount}`,
    `- Removed: ${result.removedCount}`,
    `- Outside Bank preserved: ${result.outsideBankCount}`,
    `- Content: ${result.contentChanged ? "changed" : "unchanged"}`,
    `- State: ${result.stateChanged ? "changed" : "unchanged"}`,
  ];
  await writeFile(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

export async function runBankListingSync({
  rootDir = process.cwd(),
  dryRun = false,
  fetcher = globalThis.fetch,
  fetchAttempts = 2,
  now = new Date(),
  logger = console,
} = {}) {
  const absoluteRoot = resolve(rootDir);
  const contentPath = join(absoluteRoot, CONTENT_PATH);
  const statePath = join(absoluteRoot, STATE_PATH);
  const [{ value: current }, { value: state }, snapshot] = await Promise.all([
    readJson(contentPath, CONTENT_PATH),
    readJson(statePath, STATE_PATH),
    fetchBankPublicSnapshot({ fetcher, fetchAttempts }),
  ]);
  const plan = planBankListingSync(current, snapshot, state, seoulDate(now));
  if (!dryRun) {
    if (plan.contentChanged) await writeTextAtomically(contentPath, `${JSON.stringify(plan.nextData, null, 2)}\n`);
    if (plan.stateChanged) await writeTextAtomically(statePath, `${JSON.stringify(plan.nextState, null, 2)}\n`);
  }

  const result = {
    publicCount: snapshot.total,
    newCount: plan.newItems.length,
    changedCount: plan.changedItems.length,
    sameCount: plan.sameItems.length,
    removedCount: plan.removedIds.length,
    outsideBankCount: plan.outsideBankIds.length,
    contentChanged: plan.contentChanged,
    stateChanged: plan.stateChanged,
    dryRun,
    newItems: plan.newItems,
    changedItems: plan.changedItems,
    removedIds: plan.removedIds,
  };
  logger.log(`Public listings: ${result.publicCount}`);
  logger.log(`New: ${result.newCount}`);
  logger.log(`Changed: ${result.changedCount}`);
  logger.log(`Same: ${result.sameCount}`);
  logger.log(`Removed: ${result.removedCount}`);
  logger.log(`Outside Bank preserved: ${result.outsideBankCount}`);
  if (dryRun) logger.log("No files changed");
  else if (!result.contentChanged && !result.stateChanged) logger.log("No changes");
  await appendGitHubSummary(result);
  return result;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const allowedArgs = new Set(["--dry-run"]);
  const unknown = [...args].filter((argument) => !allowedArgs.has(argument));
  if (unknown.length > 0) throw new Error(`지원하지 않는 옵션입니다: ${unknown.join(", ")}`);
  await runBankListingSync({ dryRun: args.has("--dry-run") });
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`부동산뱅크 공개 매물 동기화 실패: ${error.message}`);
    process.exitCode = 1;
  });
}
