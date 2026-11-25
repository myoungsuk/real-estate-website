// 우리집부동산 공개 목록 자동 받기(scripts/sync-woori-listings.mjs) 시험. 값은 모두 지어냈고 실제 요청은 보내지 않는다.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyWooriSyncChanges } from "../scripts/check-woori-sync-worktree.mjs";
import { runWooriListingSync } from "../scripts/sync-woori-listings.mjs";
import {
  WOORI_PUBLIC_LIST_PATH,
  WOORI_PUBLIC_TOP_COUNT,
  parseWooriPublicListResponse,
  wooriPublicListUrl,
  wooriPublicRowsToTable,
} from "../scripts/sync/woori-listings.mjs";
import { WOORI_LISTING_EXPECTED_HEADERS, formatWooriFloorLabel, parseWooriDetailAddress } from "../src/lib/admin/woori-listing-import.mjs";

function apiRow(overrides = {}) {
  return {
    mm_uid: "9100001",
    naver_uid: "2700000001",
    RLSTTYPE_NM: "아파트",
    SUB_RLSTTYPE_NM: "아파트",
    DEALTYPE_NM: "매매",
    BLDNM: "샘플마을5단지",
    DONG_NM: "101",
    CORES_FLR_CNT: "7",
    CORES_FLR_CNT_NM: "",
    TOT_FLR_CNT: "22",
    SPLY_SPC: "112.40",
    EXCLS_SPC: "84.91",
    DEAL_AMT: "41,500",
    WRRNT_AMT: "0",
    LEASE_AMT: "0",
    prcl_price: "0",
    premium_price: "0",
    optionPrice: "0",
    SVC_DATE_STRT: "26.11.10",
    PRCS_CD: "4",
    DEAL_CMPT_DATE: "",
    FETR_DESC: "지어낸 설명",
    ...overrides,
  };
}

function apiBody(rows, extra = {}) {
  return JSON.stringify({ result: true, next_page: false, list_result: rows, ...extra });
}

function existingListing(id, overrides = {}) {
  return {
    id,
    title: "샘플마을 5단지 509동",
    propertyType: "아파트",
    tradeType: "sale",
    priceLabel: "3억 9,000",
    areaLabel: "81㎡ · 전용 59.64㎡",
    floorLabel: "고/29층",
    direction: "남서향",
    summary: "공개 매물 설명",
    registeredAt: "2026-11-01",
    source: "네이버페이 부동산",
    url: `https://fin.land.naver.com/articles/${id}`,
    ...overrides,
  };
}

function fakeFetcher(bodies) {
  const calls = [];
  const fetcher = async (value) => {
    const url = new URL(value);
    calls.push(url);
    if (url.hostname !== "home.woori-house.co.kr" || url.pathname !== WOORI_PUBLIC_LIST_PATH) throw new Error(`예상하지 못한 URL: ${url}`);
    const body = bodies.shift();
    const response = new Response(body, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    Object.defineProperty(response, "url", { value: url.toString() });
    return response;
  };
  return { fetcher, calls };
}

async function makeRoot(t, content, reviewState) {
  const root = await mkdtemp(join(tmpdir(), "woori-listing-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src", "data"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await writeFile(join(root, "src", "data", "naver-listings.json"), `${JSON.stringify(content, null, 2)}\n`, "utf8");
  await writeFile(join(root, ".github", "listing-review-state.json"), `${JSON.stringify(reviewState, null, 2)}\n`, "utf8");
  return root;
}

const quiet = { log() {} };

test("공개 목록 주소는 사무소 번호 하나·한 번에 받는 건수만 싣고 허용된 호스트·경로다", () => {
  const url = wooriPublicListUrl();
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, "home.woori-house.co.kr");
  assert.equal(url.pathname, WOORI_PUBLIC_LIST_PATH);
  assert.equal(url.searchParams.get("prtn_uid"), "42957");
  assert.equal(url.searchParams.get("top_cnt"), String(WOORI_PUBLIC_TOP_COUNT));
});

test("공개 목록 응답의 모양이 다르면 받지 않고 멈춘다(빈 목록·다음 쪽·처음 보는 진행 코드 포함)", () => {
  assert.throws(() => parseWooriPublicListResponse("<html>"), /JSON이 아닙니다/u);
  assert.throws(() => parseWooriPublicListResponse(JSON.stringify({ result: false, next_page: false, list_result: [] })), /성공 응답이 아닙니다/u);
  assert.throws(() => parseWooriPublicListResponse(apiBody([apiRow()], { next_page: true })), /다음 쪽/u);
  assert.throws(() => parseWooriPublicListResponse(apiBody([])), /비어 있습니다/u);
  const missing = apiRow();
  delete missing.TOT_FLR_CNT;
  assert.throws(() => parseWooriPublicListResponse(apiBody([missing])), /칸이 없습니다: TOT_FLR_CNT/u);
  assert.throws(() => parseWooriPublicListResponse(apiBody([apiRow({ PRCS_CD: "5" })])), /진행 코드가 처음 보는 값/u);
  const full = Array.from({ length: WOORI_PUBLIC_TOP_COUNT }, (_, index) => apiRow({ naver_uid: String(2700000000 + index) }));
  assert.throws(() => parseWooriPublicListResponse(apiBody(full)), /빠진 매물이 있을 수/u);
  assert.equal(parseWooriPublicListResponse(apiBody([apiRow()])).length, 1);
});

test("공개 매물 줄을 엑셀과 같은 16칸으로 바꾸고 상세주소에는 동 번호와 광고 층·총층만 넣는다", () => {
  const rows = [
    apiRow(),
    apiRow({ naver_uid: "2700000002", CORES_FLR_CNT: "고", TOT_FLR_CNT: "29" }),
    apiRow({ naver_uid: "2700000003", SUB_RLSTTYPE_NM: "아파트 분양권", DEAL_AMT: "0", prcl_price: "38,000", premium_price: "3,000", optionPrice: "500" }),
    apiRow({ naver_uid: "2700000004", DEALTYPE_NM: "월세", DEAL_AMT: "0", WRRNT_AMT: "2,000", LEASE_AMT: "80" }),
    apiRow({ naver_uid: "2700000005", DEALTYPE_NM: "전세", DEAL_AMT: "0", WRRNT_AMT: "23,000" }),
    apiRow({ naver_uid: "2700000006", RLSTTYPE_NM: "상가", SUB_RLSTTYPE_NM: "상가점포", DONG_NM: "", BLDNM: "", CORES_FLR_CNT: "1" }),
  ];
  const table = wooriPublicRowsToTable(rows);
  assert.deepEqual(table.headers, [...WOORI_LISTING_EXPECTED_HEADERS]);
  const records = table.rows.map((values) => Object.fromEntries(table.headers.map((header, index) => [header, values[index]])));
  assert.equal(records[0]["상세주소"], "101동 (7/22층)");
  assert.equal(records[1]["상세주소"], "101동 (고/29층)");
  assert.equal(records[0]["매물가"], "41,500");
  assert.equal(records[2]["매물가"], "41,500", "분양권은 분양가 + 프리미엄 + 옵션");
  assert.equal(records[3]["매물가"], "2,000/80");
  assert.equal(records[4]["매물가"], "23,000");
  assert.equal(records[0]["면적1(㎡)"], "[공급] 112.40");
  assert.equal(records[5]["면적1(㎡)"], "[계약] 112.40");
  assert.equal(records[5]["상세주소"], "(1/22층)", "동 번호가 없으면 광고 층·총층만(2026-11-24 모든 종류 받기)");
  assert.equal(records[0]["등록"], "26.11.10");
  // 버리는 칸은 비운다(설명·메모는 공개 카드에 쓰지 않음. 법정동이 없으면 소재지도 빈 칸).
  for (const record of records) {
    assert.equal(record["소재지"], "");
    assert.equal(record["중개사메모"], "");
    assert.doesNotMatch(record["상세주소"], /호/u);
  }
});

test("아파트·분양권 밖의 종류: 법정동·건물 꼴로 매물명 자리를 채우고, 토지·단독은 대지·연면적 이름표로 넘기며 좌표·사진·설명은 쓰지 않는다", () => {
  const secret = { MAP_X: "127.4567891", MAP_Y: "36.3456789", PHTO_PATH: "https://example.invalid/photo/9876.jpg", FETR_DESC: "가상 설명 010-0000-0000", BRKG_NM: "가상중개사무소" };
  const where = { CITY_NM: "대전광역시", GUN_NM: "동구", BDONG_NM: "가상동" };
  const rows = [
    apiRow({ naver_uid: "2700000011", RLSTTYPE_NM: "상가", SUB_RLSTTYPE_NM: "상가점포", DEALTYPE_NM: "월세", DEAL_AMT: "0", WRRNT_AMT: "2,000", LEASE_AMT: "80", DONG_NM: "", BLDNM: "", BLDTYPE_NM: "복합상가", CORES_FLR_CNT: "4", TOT_FLR_CNT: "6", SPLY_SPC: "66.10", EXCLS_SPC: "50.20", ...where, ...secret }),
    apiRow({ naver_uid: "2700000012", RLSTTYPE_NM: "토지", SUB_RLSTTYPE_NM: "토지", DONG_NM: "", BLDNM: "", CORES_FLR_CNT: "", TOT_FLR_CNT: "", SPLY_SPC: "0.00", EXCLS_SPC: "0.00", grnd_spc: "1,200.00", TOT_SPC: "0.00", ...where }),
    apiRow({ naver_uid: "2700000013", RLSTTYPE_NM: "주택", SUB_RLSTTYPE_NM: "단독/다가구", DONG_NM: "", BLDNM: "", CORES_FLR_CNT: "2", TOT_FLR_CNT: "2", SPLY_SPC: "0.00", EXCLS_SPC: "0.00", grnd_spc: "330.00", TOT_SPC: "125.50", BDONG_NM: "" }),
    apiRow({ naver_uid: "2700000014", RLSTTYPE_NM: "상가", SUB_RLSTTYPE_NM: "상가점포", DONG_NM: "", BLDNM: "가상프라자", BLDTYPE_NM: "복합상가", ...where }),
  ];
  const table = wooriPublicRowsToTable(rows);
  const records = table.rows.map((values) => Object.fromEntries(table.headers.map((header, index) => [header, values[index]])));
  assert.deepEqual([records[0]["매물명"], records[0]["소재지"], records[0]["상세주소"], records[0]["면적1(㎡)"], records[0]["면적2(㎡)"]], ["가상동 복합상가", "대전광역시 동구 가상동", "(4/6층)", "[계약] 66.10", "[전용] 50.20"]);
  assert.deepEqual([records[1]["면적1(㎡)"], records[1]["면적2(㎡)"], records[1]["상세주소"]], ["[토지] 1200.00", "", ""]);
  assert.deepEqual([records[2]["매물명"], records[2]["소재지"], records[2]["면적1(㎡)"], records[2]["면적2(㎡)"]], ["", "", "[대지] 330.00", "[연면적] 125.50"]);
  assert.equal(records[3]["매물명"], "가상프라자", "공개 매물명이 있으면 그것");
  const text = JSON.stringify(table);
  for (const banned of ["127.45", "36.34", "photo", "가상 설명", "010-0000-0000", "가상중개사무소"]) assert.equal(text.includes(banned), false, banned);
});

test("총층이 있는 층은 부동산뱅크와 같은 꼴로 적고, 엑셀(총층 없음)은 지금처럼 이미 있는 값을 둔다", () => {
  assert.deepEqual(parseWooriDetailAddress("101동 (7/22층)"), { building: "101", floor: "7", totalFloors: "22" });
  assert.deepEqual(parseWooriDetailAddress("101동 (고/29층)"), { building: "101", floor: "고", totalFloors: "29" });
  assert.deepEqual(parseWooriDetailAddress("101동 1203호 (7층)"), { building: "101", floor: "7", totalFloors: null });
  assert.equal(formatWooriFloorLabel("7", null, "22"), "7/22층");
  assert.equal(formatWooriFloorLabel("고", "고층", "29"), "고/29층");
  assert.equal(formatWooriFloorLabel("7", "7/22층"), "7/22층", "엑셀로 다시 올려도 자동 받기의 총층 값을 지우지 않음");
  assert.equal(formatWooriFloorLabel("7", null), "7층");
});

test("자동 받기: 새 매물을 넣고 재확인 상태를 woori로 적으며, 부동산뱅크·직접 등록 매물은 그대로 둔다", async (t) => {
  const bank = existingListing("2700000101", { title: "샘플마을 5단지 510동" });
  const manual = existingListing("2700000102", { title: "직접 등록 매물" });
  const root = await makeRoot(t, { checkedAt: "2026-11-13", items: [bank, manual] }, {
    schemaVersion: 1,
    updatedAt: "2026-11-13",
    items: {
      [bank.id]: { source: "bank", lastSeenAt: "2026-11-13", lastReviewedAt: null },
      [manual.id]: { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-10" },
    },
  });
  const { fetcher, calls } = fakeFetcher([apiBody([
    apiRow(),
    apiRow({ naver_uid: bank.id, DEAL_AMT: "99,999" }),
    apiRow({ naver_uid: "2700000006", RLSTTYPE_NM: "상가", SUB_RLSTTYPE_NM: "상가점포", DONG_NM: "", BLDNM: "", BLDTYPE_NM: "복합상가", BDONG_NM: "가상동", CITY_NM: "대전광역시", GUN_NM: "동구", CORES_FLR_CNT: "1", TOT_FLR_CNT: "4" }),
  ])]);
  const result = await runWooriListingSync({ rootDir: root, fetcher, now: new Date("2026-11-14T15:40:00Z"), logger: quiet, summaryPath: null });
  assert.equal(calls.length, 1, "요청은 실행마다 1번");
  assert.equal(result.newCount, 2, "동 번호 없는 상가도 새 매물(2026-11-24 모든 종류 받기)");
  assert.equal(result.skippedCount, 1, "부동산뱅크 매물만 건너뜀");
  assert.equal(result.removedCount, 0);
  const content = JSON.parse(await readFile(join(root, "src", "data", "naver-listings.json"), "utf8"));
  const review = JSON.parse(await readFile(join(root, ".github", "listing-review-state.json"), "utf8"));
  assert.equal(content.checkedAt, "2026-11-15");
  const added = content.items.find(({ id }) => id === "2700000001");
  assert.equal(added.title, "샘플마을5단지 101동");
  assert.equal(added.floorLabel, "7/22층");
  assert.equal(added.priceLabel, "4억 1,500");
  assert.equal(added.url, "https://fin.land.naver.com/articles/2700000001");
  const shop = content.items.find(({ id }) => id === "2700000006");
  assert.deepEqual([shop.title, shop.propertyType, shop.floorLabel, shop.areaLabel], ["가상동 복합상가 84㎡", "상가점포", "1/4층", "계약 112.4㎡ · 전용 84.91㎡"]);
  assert.deepEqual(review.items["2700000006"], { source: "woori", lastSeenAt: "2026-11-15", lastReviewedAt: null });
  assert.deepEqual(content.items.find(({ id }) => id === bank.id), bank, "부동산뱅크 매물 값 그대로");
  assert.deepEqual(content.items.find(({ id }) => id === manual.id), manual);
  assert.deepEqual(review.items["2700000001"], { source: "woori", lastSeenAt: "2026-11-15", lastReviewedAt: null });
  assert.deepEqual(review.items[bank.id], { source: "bank", lastSeenAt: "2026-11-13", lastReviewedAt: null });
  assert.deepEqual(review.items[manual.id], { source: "manual", lastSeenAt: null, lastReviewedAt: "2026-11-10" });
});

test("자동 받기: 다음 날 공개 목록에서 빠진 우리집부동산 매물만 지우고, 시험 실행(--dry-run)은 파일을 바꾸지 않는다", async (t) => {
  const keep = existingListing("2700000001", { title: "샘플마을5단지 101동", priceLabel: "4억 1,500", areaLabel: "112㎡ · 전용 84.91㎡", floorLabel: "7/22층", direction: null, registeredAt: "2026-11-10" });
  const gone = existingListing("2700000002", { title: "샘플마을5단지 102동" });
  const manual = existingListing("2700000102", { title: "직접 등록 매물" });
  const root = await makeRoot(t, { checkedAt: "2026-11-14", items: [keep, gone, manual] }, {
    schemaVersion: 1,
    updatedAt: "2026-11-14",
    items: {
      [keep.id]: { source: "woori", lastSeenAt: "2026-11-14", lastReviewedAt: null },
      [gone.id]: { source: "woori", lastSeenAt: "2026-11-14", lastReviewedAt: null },
      [manual.id]: { source: "manual", lastSeenAt: null, lastReviewedAt: null },
    },
  });
  const contentPath = join(root, "src", "data", "naver-listings.json");
  const reviewPath = join(root, ".github", "listing-review-state.json");
  const before = [await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")];

  const dry = await runWooriListingSync({ rootDir: root, dryRun: true, fetcher: fakeFetcher([apiBody([apiRow()])]).fetcher, now: new Date("2026-11-15T15:40:00Z"), logger: quiet, summaryPath: null });
  assert.deepEqual(dry.removedIds, [gone.id]);
  assert.deepEqual([await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")], before);

  const result = await runWooriListingSync({ rootDir: root, fetcher: fakeFetcher([apiBody([apiRow()])]).fetcher, now: new Date("2026-11-15T15:40:00Z"), logger: quiet, summaryPath: null });
  assert.deepEqual(result.removedIds, [gone.id]);
  assert.equal(result.changedCount, 0);
  const content = JSON.parse(await readFile(contentPath, "utf8"));
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  assert.deepEqual(content.items.map(({ id }) => id), [keep.id, manual.id]);
  assert.equal(review.items[gone.id], undefined);
  assert.equal(review.items[keep.id].lastSeenAt, "2026-11-16");
});

test("자동 받기: 응답이 비었거나 형식이 틀린 줄이 있으면 파일을 하나도 바꾸지 않고 실패한다", async (t) => {
  const keep = existingListing("2700000001", { title: "샘플마을5단지 101동" });
  const root = await makeRoot(t, { checkedAt: "2026-11-14", items: [keep] }, {
    schemaVersion: 1,
    updatedAt: "2026-11-14",
    items: { [keep.id]: { source: "woori", lastSeenAt: "2026-11-14", lastReviewedAt: null } },
  });
  const contentPath = join(root, "src", "data", "naver-listings.json");
  const reviewPath = join(root, ".github", "listing-review-state.json");
  const before = [await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")];
  const run = (body) => runWooriListingSync({ rootDir: root, fetcher: fakeFetcher([body]).fetcher, now: new Date("2026-11-15T15:40:00Z"), logger: quiet, summaryPath: null });

  await assert.rejects(run(apiBody([])), /비어 있습니다/u);
  await assert.rejects(run(apiBody([apiRow({ DEAL_AMT: "협의" })])), /형식이 맞지 않아 아무것도 바꾸지 않았습니다/u);
  await assert.rejects(run(apiBody([apiRow({ SVC_DATE_STRT: "27.01.01" })])), /형식이 맞지 않아/u);
  // 처음 보는 매물종류가 오면 그 줄만 건너뛰지 않고 그날 전체를 멈춘다(모르는 종류 때문에 매물을 지우지 않음).
  await assert.rejects(run(apiBody([apiRow(), apiRow({ naver_uid: "2700000009", RLSTTYPE_NM: "가상", SUB_RLSTTYPE_NM: "가상숙박시설" })])), /처음 보는 매물종류/u);
  assert.deepEqual([await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")], before);
});

test("우리집부동산 동기화는 공개 목록과 재확인 상태 두 파일만 바꿀 수 있다", () => {
  assert.equal(classifyWooriSyncChanges([]).mode, "none");
  assert.equal(classifyWooriSyncChanges(["src/data/naver-listings.json", ".github/listing-review-state.json"]).mode, "content");
  assert.throws(() => classifyWooriSyncChanges([".github/bank-listing-sync-state.json"]), /허용 목록 밖/u);
  assert.throws(() => classifyWooriSyncChanges(["src/data/office.json"]), /허용 목록 밖/u);
});

test("자동 받기: 실패 응답(503)·리디렉션(302)이 와도 요청은 1번뿐이고 파일을 바꾸지 않는다(짧은 시간 여러 번 = IP 차단)", async (t) => {
  const keep = existingListing("2700000001", { title: "샘플마을5단지 101동" });
  const root = await makeRoot(t, { checkedAt: "2026-11-14", items: [keep] }, {
    schemaVersion: 1,
    updatedAt: "2026-11-14",
    items: { [keep.id]: { source: "woori", lastSeenAt: "2026-11-14", lastReviewedAt: null } },
  });
  const contentPath = join(root, "src", "data", "naver-listings.json");
  const reviewPath = join(root, ".github", "listing-review-state.json");
  const before = [await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")];
  for (const [status, headers] of [[503, {}], [302, { Location: `https://home.woori-house.co.kr${WOORI_PUBLIC_LIST_PATH}?again=1` }]]) {
    const calls = [];
    const fetcher = async (value) => {
      calls.push(String(value));
      const response = new Response(status === 302 ? null : "busy", { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
      Object.defineProperty(response, "url", { value: String(value) });
      return response;
    };
    await assert.rejects(runWooriListingSync({ rootDir: root, fetcher, now: new Date("2026-11-15T15:40:00Z"), logger: quiet, summaryPath: null }));
    assert.equal(calls.length, 1, `${status} 응답에도 요청은 1번`);
  }
  assert.deepEqual([await readFile(contentPath, "utf8"), await readFile(reviewPath, "utf8")], before);
});
