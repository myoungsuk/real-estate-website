import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  planIndexNowUrls,
  submitIndexNowUrls,
  validateIndexNowUrls,
  verifyPublishedIndexNowKey,
} from "../scripts/indexnow.mjs";

const sitemapUrls = [
  "https://leaderscityhappy.com/",
  "https://leaderscityhappy.com/complexes/",
  "https://leaderscityhappy.com/complexes/leaders-city-4/",
  "https://leaderscityhappy.com/properties/",
  "https://leaderscityhappy.com/faq/",
];

test("IndexNow 계획은 데이터별 관련 URL만 선택한다", () => {
  assert.deepEqual(
    planIndexNowUrls(["src/data/naver-listings.json"], sitemapUrls),
    ["https://leaderscityhappy.com/", "https://leaderscityhappy.com/properties/"],
  );
  assert.deepEqual(
    planIndexNowUrls(["src/data/complexes.json"], sitemapUrls),
    [
      "https://leaderscityhappy.com/",
      "https://leaderscityhappy.com/complexes/",
      "https://leaderscityhappy.com/complexes/leaders-city-4/",
    ],
  );
});

test("공통 레이아웃 변경은 현재 sitemap URL 전체를 선택한다", () => {
  assert.deepEqual(planIndexNowUrls(["src/layouts/BaseLayout.astro"], sitemapUrls), [...sitemapUrls].sort());
});

test("문서와 관리자 코드 변경은 공개 URL 제출을 만들지 않는다", () => {
  assert.deepEqual(planIndexNowUrls(["README.md", "src/pages/admin/index.astro"], sitemapUrls), []);
});

test("IndexNow는 운영 도메인 URL만 허용하고 올바른 요청 본문을 전송한다", async () => {
  assert.throws(() => validateIndexNowUrls(["https://example.com/"]), /다른 사이트 URL/u);
  let request;
  const result = await submitIndexNowUrls(["https://leaderscityhappy.com/faq/"], {
    logger: { log() {} },
    fetcher: async (url, options) => {
      request = { url, options };
      return new Response("", { status: 202 });
    },
  });
  assert.equal(result.status, 202);
  assert.equal(request.url, INDEXNOW_ENDPOINT);
  assert.deepEqual(JSON.parse(request.options.body), {
    host: "leaderscityhappy.com",
    key: INDEXNOW_KEY,
    keyLocation: INDEXNOW_KEY_LOCATION,
    urlList: ["https://leaderscityhappy.com/faq/"],
  });
});

test("공개 키 파일은 IndexNow 키와 정확히 일치한다", async () => {
  const keyFile = await readFile(new URL(`../public/${INDEXNOW_KEY}.txt`, import.meta.url), "utf8");
  assert.equal(keyFile.trim(), INDEXNOW_KEY);
  await verifyPublishedIndexNowKey({
    fetcher: async (url) => {
      assert.equal(url, INDEXNOW_KEY_LOCATION);
      return new Response(`${INDEXNOW_KEY}\n`, { status: 200 });
    },
  });
});
