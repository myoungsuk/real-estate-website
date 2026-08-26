import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyBankSyncChanges } from "../scripts/check-bank-sync-worktree.mjs";
import { fetchBankPublicSnapshot, runBankListingSync } from "../scripts/sync-bank-listings.mjs";
import {
  BANK_OFFICE_PATH,
  mergeBankPublicPages,
  parseBankPublicPage,
  planBankListingSync,
} from "../scripts/sync/bank-listings.mjs";

const officeName = "리더스시티행복한공인중개사사무소";

function listingMarkup({
  bankId,
  naverId,
  trade = "매매",
  propertyType = "아파트",
  location = "대전동구 천동",
  confirmedAt = "26.08.26",
  title = "리더스시티5BL",
  area = "81/59",
  floor = "고/29",
  price = "39,000",
  direction = "남서향",
  summary = "공개 매물 설명",
} = {}) {
  return `
    <table>
      <tr class="bg_white">
        <td rowspan="2">${trade}</td><td rowspan="2">${propertyType}</td><td rowspan="2">${location}</td><td rowspan="2">${confirmedAt}</td>
        <td colspan="2"><a class="link_blue" href="javascript:onClickOpenNaverDetail('${naverId}');">${title}</a><a href="javascript:onClickOpenDetail('AT', '${bankId}');">새창</a></td>
        <td>${area}</td><td>${floor}</td><td>${price}</td>
      </tr>
      <tr><td colspan="4">${summary}</td></tr>
    </table>
    <a href="javascript:onClickOpenNaverDetail('${naverId}');">
      <table class="offer_contents"><tr><td>
        <p>[${propertyType}] ${location} ${title}</p><p>${trade} ${price}만</p><p>${area}, ${floor}층, ${direction}</p><p>${summary}</p>
      </td></tr></table>
    </a>`;
}

function pageHtml({ total, listings, pages = [] }) {
  return `<!doctype html><html><body><h1>${officeName}</h1><strong>${officeName}</strong>에서 등록한 매물 수 (${total}건)
    ${listings.map(listingMarkup).join("\n")}
    ${pages.map((page) => `<a href="/r/info/503143?&amp;page=${page}">${page}</a>`).join("\n")}
  </body></html>`;
}

const firstCandidate = {
  bankId: "143293603",
  naverId: "2645402920",
};
const secondCandidate = {
  bankId: "143293263",
  naverId: "2645400881",
  trade: "전세",
  propertyType: "아파트분양권",
  location: "대전중구 문화동",
  title: "e편한세상서대전역센트로",
  area: "110/84",
  floor: "16/20",
  price: "40,000",
  direction: "남동향",
  summary: "시스템에어컨 설치 앞동으로 조망 좋아요",
};

const firstPageHtml = pageHtml({ total: 2, listings: [firstCandidate], pages: [2] });
const secondPageHtml = pageHtml({ total: 2, listings: [secondCandidate], pages: [1] });

function responseWithUrl(body, url, status = 200) {
  const response = new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

function fixtureFetcher() {
  return async (value) => {
    const url = new URL(value);
    if (url.hostname !== "land.neonet.co.kr" || url.pathname !== BANK_OFFICE_PATH) throw new Error(`예상하지 못한 URL: ${url}`);
    return responseWithUrl(url.searchParams.get("page") === "2" ? secondPageHtml : firstPageHtml, url.toString());
  };
}

function publicListing(id, overrides = {}) {
  return {
    id,
    title: "리더스시티 5블록 507동",
    propertyType: "아파트",
    tradeType: "sale",
    priceLabel: "3억 9,000",
    areaLabel: "81B㎡ · 전용 59.64B㎡",
    floorLabel: "고/29층",
    direction: "남서향",
    summary: "공개 매물 설명",
    confirmedAt: "2026-08-26",
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${id}`,
    ...overrides,
  };
}

function emptyState() {
  return { version: 1, officePath: BANK_OFFICE_PATH, updatedAt: null, items: [] };
}

test("부동산뱅크 공개 HTML에서 카드 필드와 두 매물번호를 추출한다", () => {
  const page = parseBankPublicPage(firstPageHtml);
  assert.equal(page.total, 2);
  assert.deepEqual(page.pageNumbers, [1, 2]);
  assert.deepEqual(page.listings[0], {
    naverId: "2645402920",
    bankId: "143293603",
    bankType: "AT",
    tradeType: "sale",
    propertyType: "아파트",
    location: "대전동구 천동",
    confirmedAt: "2026-08-26",
    title: "리더스시티5BL",
    area: "81/59",
    floor: "고/29",
    price: "39,000",
    direction: "남서향",
    summary: "공개 매물 설명",
  });
});

test("페이지 누락과 중복 네이버 ID는 전체 동기화를 중단한다", () => {
  const first = parseBankPublicPage(firstPageHtml);
  const second = parseBankPublicPage(secondPageHtml);
  assert.equal(mergeBankPublicPages([first, second]).listings.length, 2);
  assert.throws(() => mergeBankPublicPages([first]), /1건만 수집/u);
  assert.throws(() => mergeBankPublicPages([first, first]), /중복/u);
});

test("첫 실행은 외부 공급처 매물을 보존하고 부동산뱅크 기준선만 만든다", () => {
  const snapshot = mergeBankPublicPages([parseBankPublicPage(firstPageHtml), parseBankPublicPage(secondPageHtml)]);
  const outside = publicListing("2999999999", { title: "다른 공급처 매물" });
  const current = { checkedAt: "2026-08-26", items: [publicListing(firstCandidate.naverId), outside] };
  const plan = planBankListingSync(current, snapshot, emptyState(), "2026-08-26");
  assert.deepEqual(plan.newItems.map(({ id }) => id), [secondCandidate.naverId]);
  assert.deepEqual(plan.removedIds, []);
  assert.deepEqual(plan.outsideBankIds, [outside.id]);
  assert.ok(plan.nextData.items.some(({ id }) => id === outside.id));
  assert.equal(plan.nextState.items.length, 2);
  assert.equal(plan.nextData.items.find(({ id }) => id === firstCandidate.naverId).title, "리더스시티 5블록 507동");
});

test("다음 실행부터 부동산뱅크에서 빠진 매물만 삭제한다", () => {
  const firstSnapshot = mergeBankPublicPages([parseBankPublicPage(firstPageHtml), parseBankPublicPage(secondPageHtml)]);
  const outside = publicListing("2999999999", { title: "다른 공급처 매물" });
  const initial = planBankListingSync(
    { checkedAt: "2026-08-26", items: [publicListing(firstCandidate.naverId), outside] },
    firstSnapshot,
    emptyState(),
    "2026-08-26",
  );
  const remainingPage = parseBankPublicPage(pageHtml({ total: 1, listings: [secondCandidate] }));
  const next = planBankListingSync(initial.nextData, mergeBankPublicPages([remainingPage]), initial.nextState, "2026-08-27");
  assert.deepEqual(next.removedIds, [firstCandidate.naverId]);
  assert.ok(!next.nextData.items.some(({ id }) => id === firstCandidate.naverId));
  assert.ok(next.nextData.items.some(({ id }) => id === outside.id));
});

test("부동산뱅크 공개 목록이 0건이면 기존 부동산뱅크 매물을 모두 삭제하고 외부 매물은 보존한다", () => {
  const outside = publicListing("2999999999", { title: "다른 공급처 매물" });
  const state = {
    version: 1,
    officePath: BANK_OFFICE_PATH,
    updatedAt: "2026-08-26",
    items: [{ naverId: firstCandidate.naverId, bankId: firstCandidate.bankId }],
  };
  const emptySnapshot = mergeBankPublicPages([parseBankPublicPage(pageHtml({ total: 0, listings: [] }))]);
  const plan = planBankListingSync(
    { checkedAt: "2026-08-26", items: [publicListing(firstCandidate.naverId), outside] },
    emptySnapshot,
    state,
    "2026-08-27",
  );
  assert.deepEqual(plan.removedIds, [firstCandidate.naverId]);
  assert.deepEqual(plan.nextData.items.map(({ id }) => id), [outside.id]);
  assert.deepEqual(plan.nextState.items, []);
});

test("공개 목록 설명이 말줄임표로 잘리면 같은 접두사의 기존 전체 설명을 보존한다", () => {
  const candidate = { ...firstCandidate, summary: "시스템에어컨4대외 옵션..." };
  const snapshot = mergeBankPublicPages([parseBankPublicPage(pageHtml({ total: 1, listings: [candidate] }))]);
  const existing = publicListing(firstCandidate.naverId, { summary: "시스템에어컨4대외 옵션 설치 앞동으로 조망 좋아요" });
  const plan = planBankListingSync(
    { checkedAt: "2026-08-26", items: [existing] },
    snapshot,
    emptyState(),
    "2026-08-26",
  );
  assert.equal(plan.nextData.items[0].summary, existing.summary);
});

test("공개 설명에 전화번호가 섞이면 저장 결과를 만들지 않는다", () => {
  const unsafePage = parseBankPublicPage(pageHtml({
    total: 1,
    listings: [{ ...firstCandidate, summary: "문의 010-1111-2222" }],
  }));
  assert.throws(() => planBankListingSync(
    { checkedAt: "2026-08-26", items: [publicListing(firstCandidate.naverId)] },
    mergeBankPublicPages([unsafePage]),
    emptyState(),
    "2026-08-26",
  ), /공개 안전 검증/u);
});

test("dry-run은 두 공개 페이지만 읽고 파일을 변경하지 않는다", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "bank-listing-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src", "data"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  const content = { checkedAt: "2026-08-26", items: [publicListing(firstCandidate.naverId), publicListing("2999999999")] };
  await writeFile(join(root, "src", "data", "naver-listings.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
  await writeFile(join(root, ".github", "bank-listing-sync-state.json"), `${JSON.stringify(emptyState(), null, 2)}\n`, "utf8");
  const beforeContent = await readFile(join(root, "src", "data", "naver-listings.json"), "utf8");
  const beforeState = await readFile(join(root, ".github", "bank-listing-sync-state.json"), "utf8");
  const snapshot = await fetchBankPublicSnapshot({ fetcher: fixtureFetcher(), fetchAttempts: 1 });
  assert.equal(snapshot.total, 2);
  const result = await runBankListingSync({
    rootDir: root,
    dryRun: true,
    fetcher: fixtureFetcher(),
    fetchAttempts: 1,
    now: new Date("2026-08-26T16:00:00Z"),
    logger: { log() {} },
  });
  assert.deepEqual({ public: result.publicCount, added: result.newCount, outside: result.outsideBankCount }, { public: 2, added: 1, outside: 1 });
  assert.equal(await readFile(join(root, "src", "data", "naver-listings.json"), "utf8"), beforeContent);
  assert.equal(await readFile(join(root, ".github", "bank-listing-sync-state.json"), "utf8"), beforeState);
});

test("부동산뱅크 동기화 워크플로는 허용된 두 파일만 커밋한다", async () => {
  assert.deepEqual(classifyBankSyncChanges([]), { mode: "none", paths: [] });
  assert.deepEqual(classifyBankSyncChanges(["src/data/naver-listings.json"]), {
    mode: "content",
    paths: ["src/data/naver-listings.json"],
  });
  assert.throws(() => classifyBankSyncChanges(["src/data/office.json"]), /허용 목록 밖/u);
  const workflow = await readFile(new URL("../.github/workflows/sync-bank-listings.yml", import.meta.url), "utf8");
  assert.match(workflow, /cron: "10 15 \* \* \*"/u);
  assert.match(workflow, /\.github\/bank-listing-sync-state\.json src\/data\/naver-listings\.json/u);
  assert.doesNotMatch(workflow, /new\.land\.naver|fin\.land\.naver|playwright|selenium/iu);
});
