import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  INDEXNOW_ENDPOINT,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  isAdminOnlyPath,
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
    [
      "https://leaderscityhappy.com/",
      "https://leaderscityhappy.com/complexes/",
      "https://leaderscityhappy.com/complexes/leaders-city-4/",
      "https://leaderscityhappy.com/properties/",
    ],
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

test("관리자 전용 코드·자료·스타일만 바뀐 병합은 공개 URL 제출을 만들지 않는다", () => {
  const adminOnly = [
    "src/lib/work/realprice-view.mjs",
    "src/lib/work-realprice-client.ts",
    "src/lib/admin-help.mjs",
    "src/lib/admin/bank-listing-import.mjs",
    "src/components/admin/AdminMenu.astro",
    "src/layouts/AdminLayout.astro",
    "src/styles/admin.css",
    "src/data/work/legal-rules.json",
  ];
  assert.deepEqual(planIndexNowUrls(adminOnly, sitemapUrls), []);
  assert.deepEqual(planIndexNowUrls([...adminOnly, "src/data/faq.json"], sitemapUrls), ["https://leaderscityhappy.com/faq/"], "공개 자료가 함께 바뀌면 그 URL만");
  assert.equal(isAdminOnlyPath("src/lib/site.ts"), false);
  assert.equal(isAdminOnlyPath("src/styles/global.css"), false);
});

test("공개 화면 코드는 관리자 전용 경로를 가져다 쓰지 않는다(쓰면 위 제외가 공개 변경을 놓침)", async () => {
  const root = new URL("../", import.meta.url);
  const files = (await readdir(new URL("src/", root), { recursive: true }))
    .map((name) => `src/${name.replaceAll("\\", "/")}`)
    .filter((name) => /\.(astro|ts|mjs|js)$/u.test(name) && !name.startsWith("src/pages/admin/") && !isAdminOnlyPath(name));
  for (const name of files) {
    const source = await readFile(new URL(name, root), "utf8");
    for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/gu)) {
      const spec = match[1];
      if (!spec.startsWith(".")) continue;
      const resolved = new URL(spec, new URL(name, root)).pathname.replace(new URL(root).pathname, "");
      assert.equal(isAdminOnlyPath(resolved), false, `${name}이 관리자 전용 ${resolved}를 가져다 씀`);
    }
  }
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
