import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runExternalContentSync } from "../scripts/sync-external-content.mjs";
import { classifySyncChanges, parseGitStatusPorcelain } from "../scripts/check-sync-worktree.mjs";
import { ExternalSyncSourceUnavailableError } from "../scripts/sync/errors.mjs";
import { fetchXml, prepareWebpThumbnail } from "../scripts/sync/http.mjs";
import {
  assertYouTubeChannelId,
  buildExternalContentItem,
  mergeExternalContentsPreservingOrder,
  normalizeYouTubeInternalId,
  parseNaverBlogFeed,
  parseYouTubeFeed,
  planNewExternalContent,
  shouldRefreshKeepalive,
  validateMergedExternalContents,
} from "../scripts/sync/external-content.mjs";

const channelId = "UCuOZDnM5vxOZELDgu-y-hNg";
const fixtureDirectory = new URL("./fixtures/external-sync/", import.meta.url);
const onePixelPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const [naverRss, youtubeAtom] = await Promise.all([
  readFile(new URL("naver-rss.xml", fixtureDirectory), "utf8"),
  readFile(new URL("youtube-atom.xml", fixtureDirectory), "utf8"),
]);
const [externalContentComponent, syncWorkflow] = await Promise.all([
  readFile(new URL("../src/components/ExternalContentList.astro", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/sync-external-content.yml", import.meta.url), "utf8"),
]);

function fixtureFetcher({ imageFailure = false, naverStatus = 200, youtubeStatus = 200, naverXml = naverRss, youtubeXml = youtubeAtom } = {}) {
  return async (value) => {
    const url = String(value);
    if (url === "https://rss.blog.naver.com/p5468300.xml") {
      if (naverStatus !== 200) return new Response("naver unavailable", { status: naverStatus });
      return new Response(naverXml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
    }
    if (url === `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`) {
      if (youtubeStatus !== 200) return new Response("youtube unavailable", { status: youtubeStatus });
      return new Response(youtubeXml, { headers: { "Content-Type": "application/atom+xml; charset=utf-8" } });
    }
    if (url.startsWith("https://blogthumb.pstatic.net/") || url.startsWith("https://i2.ytimg.com/")) {
      if (imageFailure) return new Response("not an image", { status: 502, headers: { "Content-Type": "text/plain" } });
      return new Response(onePixelPng, { headers: { "Content-Type": "image/png" } });
    }
    throw new Error(`예상하지 못한 fixture URL: ${url}`);
  };
}

async function makeSyncRoot(t, { current = [], lastKeepaliveAt = "2026-08-26" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "external-sync-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src", "data"), { recursive: true });
  await mkdir(join(root, ".github"), { recursive: true });
  await writeFile(join(root, "src", "data", "external-links.json"), `${JSON.stringify(current, null, 2)}\n`, "utf8");
  await writeFile(join(root, "src", "data", "office.json"), JSON.stringify({
    mobile: "010-2790-8675", email: "office@example.com", address: "근린생활시설 105호",
  }), "utf8");
  await writeFile(join(root, ".github", "automation-health.json"), `${JSON.stringify({ lastKeepaliveAt }, null, 2)}\n`, "utf8");
  return root;
}

test("네이버 RSS에서 공식 logNo·제목·게시일·썸네일을 정규화한다", () => {
  const [item] = parseNaverBlogFeed(naverRss);
  assert.equal(item.id, "naver-blog-224999999999");
  assert.equal(item.title, "새 블로그 글 & 확인사항");
  assert.equal(item.url, "https://blog.naver.com/PostView.naver?blogId=p5468300&logNo=224999999999");
  assert.equal(item.publishedAt, "2026-08-26");
  assert.match(item.thumbnailUrl, /^https:\/\/blogthumb\.pstatic\.net\//u);
});

test("네이버 RSS의 승인 블로그 ID 불일치를 거부한다", () => {
  const wrongFeed = naverRss.replaceAll("p5468300", "another-blog");
  assert.throws(() => parseNaverBlogFeed(wrongFeed), /승인된 블로그/u);
  assert.throws(() => parseNaverBlogFeed(naverRss.replace("https://blog.naver.com/p5468300/224999999999", "https://example.com/p5468300/224999999999")), /허용된 HTTPS 호스트/u);
  assert.throws(() => parseNaverBlogFeed(naverRss.replace(/<pubDate>[^<]+<\/pubDate>/u, "")), /게시 시각/u);
  assert.throws(() => parseNaverBlogFeed(naverRss.replace("</item>", "")), /올바른 XML/u);
});

test("YouTube Atom Shorts 링크를 검증하고 기존 watch URL로 정규화한다", () => {
  const [item] = parseYouTubeFeed(youtubeAtom, { channelId });
  assert.equal(item.id, "youtube-i05mw0icfnm");
  assert.equal(item.title, "새 영상 & Shorts");
  assert.equal(item.youtubeFormat, "short");
  assert.equal(item.url, "https://www.youtube.com/watch?v=I05mw0iCFnM");
  assert.equal(item.publishedAt, "2026-08-24");
});

test("YouTube Atom의 승인 채널·필수 필드·videoId 링크 일치를 검증한다", () => {
  assert.throws(() => assertYouTubeChannelId("UC0000000000000000000000"), /승인된 YouTube channelId/u);
  const wrongChannel = youtubeAtom.replaceAll(channelId, "UC0000000000000000000000");
  assert.throws(() => parseYouTubeFeed(wrongChannel, { channelId }), /channelId/u);
  assert.throws(() => parseYouTubeFeed(youtubeAtom.replace(/<updated>[^<]+<\/updated>/u, ""), { channelId }), /updated/u);
  assert.throws(() => parseYouTubeFeed(youtubeAtom.replace("/shorts/I05mw0iCFnM", "/shorts/Aw5FRwg5kEI"), { channelId }), /일치하지 않습니다/u);
});

test("같은 videoId의 updated 변경은 기존 수동 값을 보존한다", () => {
  const [candidate] = parseYouTubeFeed(youtubeAtom, { channelId });
  const current = [{
    ...buildExternalContentItem(candidate, null),
    summary: "운영자가 수정한 요약",
    status: "draft",
    thumbnail: { src: "/images/youtube/operator.webp", alt: "운영자 썸네일" },
  }];
  const snapshot = structuredClone(current);
  assert.deepEqual(planNewExternalContent(current, [candidate]), []);
  assert.deepEqual(current, snapshot);
  assert.deepEqual(planNewExternalContent(current, []), []);
});

test("신규 항목은 기존 항목의 상대 순서를 바꾸지 않고 게시일 위치에 삽입한다", () => {
  const current = [
    { id: "existing-older", publishedAt: "2026-08-01" },
    { id: "existing-newer", publishedAt: "2026-08-20" },
  ];
  const additions = [
    { id: "new-middle", publishedAt: "2026-08-10" },
    { id: "new-first", publishedAt: "2026-08-30" },
  ];
  assert.deepEqual(
    mergeExternalContentsPreservingOrder(current, additions).map(({ id }) => id),
    ["new-first", "new-middle", "existing-older", "existing-newer"],
  );
  assert.deepEqual(current.map(({ id }) => id), ["existing-older", "existing-newer"]);
});

test("서로 다른 원본 videoId가 같은 내부 ID로 정규화되면 중단한다", () => {
  const firstId = "ABC_DEF1234";
  const secondId = "ABC-DEF1234";
  assert.equal(normalizeYouTubeInternalId(firstId), normalizeYouTubeInternalId(secondId));
  const current = [{
    id: normalizeYouTubeInternalId(firstId),
    type: "youtube",
    youtubeFormat: "video",
    status: "published",
    title: "기존 영상",
    summary: "기존 요약",
    url: `https://www.youtube.com/watch?v=${firstId}`,
    publishedAt: "2026-08-20",
    thumbnail: null,
  }];
  const candidate = {
    sourceId: secondId,
    id: normalizeYouTubeInternalId(secondId),
    type: "youtube",
    youtubeFormat: "video",
    title: "새 영상",
    summary: "새 요약",
    url: `https://www.youtube.com/watch?v=${secondId}`,
    publishedAt: "2026-08-21",
    thumbnailUrl: null,
  };
  assert.throws(() => planNewExternalContent(current, [candidate]), /충돌/u);
});

test("dry-run은 신규 항목과 썸네일을 검증해도 파일을 변경하지 않는다", async (t) => {
  const root = await makeSyncRoot(t);
  const contentPath = join(root, "src", "data", "external-links.json");
  const before = await readFile(contentPath, "utf8");
  const result = await runExternalContentSync({
    rootDir: root,
    dryRun: true,
    fetcher: fixtureFetcher(),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    now: new Date("2026-08-30T00:00:00Z"),
    logger: { log() {}, warn() {} },
  });
  assert.deepEqual({ blog: result.blogNew, youtube: result.youtubeNew, assets: result.assetCount }, { blog: 1, youtube: 1, assets: 2 });
  assert.equal(await readFile(contentPath, "utf8"), before);
  await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
});

test("동기화 결과는 공개 스키마와 금지 필드·민감 문자열을 함께 검증한다", () => {
  const item = buildExternalContentItem(parseNaverBlogFeed(naverRss)[0], null);
  const office = { mobile: "010-2790-8675", email: "office@example.com", address: "근린생활시설 105호" };
  assert.doesNotThrow(() => validateMergedExternalContents([
    { ...item, summary: "문의 010-2790-8675 office@example.com 105호" },
  ], { office }));
  for (const candidate of [
    { ...item, title: "101동 1203호" },
    { ...item, summary: "문의 010-1111-2222" },
    { ...item, thumbnail: { src: "/images/blog/test.webp", alt: "customer@example.net" } },
    { ...item, privateNote: "내부 메모" },
    { ...item, thumbnail: { src: "/images/blog/test.webp", alt: "사진", extra: "추가 필드" } },
  ]) {
    assert.throws(() => validateMergedExternalContents([candidate], { office }), /동기화 결과 검증 실패/u);
  }
});

test("미분양 통계 RSS는 저장하고 민감정보 RSS는 콘텐츠·썸네일 저장 전에 거부한다", async (t) => {
  for (const [title, allowed] of [
    ["대전 미분양 물량 2026년 7월 1,866호｜중구 쏠림이 핵심", true],
    ["공식 문의 010-2790-8675 office@example.com 105호", true],
    ["미분양 물량 1,866호, 101동 1203호", false],
    ["미분양 물량 1,866호 문의 010-1111-2222", false],
  ]) {
    await t.test(title, async (t) => {
      const root = await makeSyncRoot(t);
      const contentPath = join(root, "src", "data", "external-links.json");
      const healthPath = join(root, ".github", "automation-health.json");
      const before = await readFile(contentPath, "utf8");
      const healthBefore = await readFile(healthPath, "utf8");
      const sync = () => runExternalContentSync({
        rootDir: root,
        fetcher: fixtureFetcher({ naverXml: naverRss.replace("새 블로그 글 & 확인사항", title) }),
        fetchAttempts: 1,
        youtubeChannelId: channelId,
        logger: { log() {}, warn() {} },
      });
      if (allowed) {
        assert.equal((await sync()).blogNew, 1);
        const saved = JSON.parse(await readFile(contentPath, "utf8")).find((item) => item.type === "blog");
        assert.equal(saved.title, title);
        assert.ok(saved.summary.includes(title));
        assert.ok(saved.thumbnail.alt.includes(title));
      } else {
        await assert.rejects(sync, /동기화 결과 검증 실패/u);
        assert.equal(await readFile(contentPath, "utf8"), before);
        await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
      }
      assert.equal(await readFile(healthPath, "utf8"), healthBefore);
    });
  }
});

test("YouTube Atom 404는 세 번 재시도한 뒤 일시 장애로 분류한다", async () => {
  let requestCount = 0;
  const waits = [];
  await assert.rejects(() => fetchXml(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, {
    allowedHosts: new Set(["www.youtube.com"]),
    fetcher: async () => {
      requestCount += 1;
      return new Response("not found", { status: 404 });
    },
    attempts: 3,
    additionalRetryableStatuses: new Set([404]),
    label: "YouTube Atom RSS",
    sleep: async (milliseconds) => waits.push(milliseconds),
  }), (error) => {
    assert.ok(error instanceof ExternalSyncSourceUnavailableError);
    assert.equal(error.status, 404);
    assert.equal(error.attempts, 3);
    return true;
  });
  assert.equal(requestCount, 3);
  assert.deepEqual(waits, [250, 500]);
});

test("YouTube가 일시 장애이면 네이버만 반영하고 복구 실행에서 누락 영상을 추가한다", async (t) => {
  const root = await makeSyncRoot(t);
  const first = await runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher({ youtubeStatus: 404 }),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  });
  assert.deepEqual(first.sourceStatus, { blog: "available", youtube: "skipped" });
  assert.deepEqual({ blog: first.blogNew, youtube: first.youtubeNew }, { blog: 1, youtube: 0 });
  assert.match(first.warnings.join("\n"), /YouTube Atom RSS.*건너뜁니다/u);
  assert.deepEqual(JSON.parse(await readFile(join(root, "src", "data", "external-links.json"))).map(({ type }) => type), ["blog"]);

  const recovered = await runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher(),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  });
  assert.deepEqual(recovered.sourceStatus, { blog: "available", youtube: "available" });
  assert.deepEqual({ blog: recovered.blogNew, youtube: recovered.youtubeNew }, { blog: 0, youtube: 1 });
  assert.deepEqual(
    JSON.parse(await readFile(join(root, "src", "data", "external-links.json"))).map(({ type }) => type).sort(),
    ["blog", "youtube"],
  );
});

test("네이버가 일시 장애이면 YouTube만 반영한다", async (t) => {
  const root = await makeSyncRoot(t);
  const result = await runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher({ naverStatus: 503 }),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  });
  assert.deepEqual(result.sourceStatus, { blog: "skipped", youtube: "available" });
  assert.deepEqual({ blog: result.blogNew, youtube: result.youtubeNew }, { blog: 0, youtube: 1 });
  assert.deepEqual(JSON.parse(await readFile(join(root, "src", "data", "external-links.json"))).map(({ type }) => type), ["youtube"]);
});

test("두 출처가 모두 일시 장애이면 실패하고 기존 파일을 보존한다", async (t) => {
  const root = await makeSyncRoot(t);
  const contentPath = join(root, "src", "data", "external-links.json");
  const before = await readFile(contentPath, "utf8");
  await assert.rejects(() => runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher({ naverStatus: 503, youtubeStatus: 404 }),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  }), /모두 조회하지 못했습니다/u);
  assert.equal(await readFile(contentPath, "utf8"), before);
  await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
});

test("재시도 대상이 아닌 HTTP 오류는 다른 출처가 정상이어도 전체 실패한다", async (t) => {
  const root = await makeSyncRoot(t);
  await assert.rejects(() => runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher({ youtubeStatus: 403 }),
    fetchAttempts: 3,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  }), /YouTube Atom RSS: HTTP 403/u);
  assert.equal(await readFile(join(root, "src", "data", "external-links.json"), "utf8"), "[]\n");
  await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
});

test("비정상적으로 큰 피드 응답은 일시 장애로 건너뛰지 않고 전체 실패한다", async (t) => {
  const root = await makeSyncRoot(t);
  const baseFetcher = fixtureFetcher();
  await assert.rejects(() => runExternalContentSync({
    rootDir: root,
    fetcher: async (value, options) => {
      if (String(value).startsWith("https://www.youtube.com/feeds/videos.xml")) {
        return new Response("", {
          headers: {
            "Content-Length": String(2 * 1024 * 1024 + 1),
            "Content-Type": "application/atom+xml",
          },
        });
      }
      return baseFetcher(value, options);
    },
    fetchAttempts: 3,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  }), /응답 크기/u);
  assert.equal(await readFile(join(root, "src", "data", "external-links.json"), "utf8"), "[]\n");
  await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
});

test("실행 결과는 원자적으로 저장되고 같은 입력의 두 번째 실행은 diff가 없다", async (t) => {
  const root = await makeSyncRoot(t);
  const options = {
    rootDir: root,
    fetcher: fixtureFetcher(),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    now: new Date("2026-08-30T00:00:00Z"),
    logger: { log() {}, warn() {} },
  };
  const first = await runExternalContentSync(options);
  assert.equal(first.contentChanged, true);
  const contentPath = join(root, "src", "data", "external-links.json");
  const firstRaw = await readFile(contentPath, "utf8");
  const second = await runExternalContentSync(options);
  assert.equal(second.contentChanged, false);
  assert.equal(await readFile(contentPath, "utf8"), firstRaw);
  assert.deepEqual((await readdir(join(root, "public", "images", "blog"))).sort(), ["224999999999.webp"]);
  assert.deepEqual((await readdir(join(root, "public", "images", "youtube"))).sort(), ["I05mw0iCFnM.webp"]);
});

test("썸네일 단독 실패는 경고와 thumbnail:null로 격리한다", async (t) => {
  const root = await makeSyncRoot(t);
  const result = await runExternalContentSync({
    rootDir: root,
    dryRun: true,
    fetcher: fixtureFetcher({ imageFailure: true }),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  });
  assert.equal(result.assetCount, 0);
  assert.equal(result.warnings.length, 2);
});

test("채널 신뢰 경계 실패 시 기존 JSON과 이미지를 변경하지 않는다", async (t) => {
  const root = await makeSyncRoot(t);
  const contentPath = join(root, "src", "data", "external-links.json");
  const before = await readFile(contentPath, "utf8");
  const wrongFeed = youtubeAtom.replaceAll(channelId, "UC0000000000000000000000");
  await assert.rejects(() => runExternalContentSync({
    rootDir: root,
    fetcher: fixtureFetcher({ youtubeXml: wrongFeed }),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  }), /channelId/u);
  assert.equal(await readFile(contentPath, "utf8"), before);
  await assert.rejects(() => readdir(join(root, "public")), /ENOENT/u);
});

test("YouTube XML 오류와 승인되지 않은 썸네일 URL을 신뢰 경계 오류로 거부한다", async () => {
  assert.throws(() => parseYouTubeFeed(youtubeAtom.replace("</entry>", ""), { channelId }), /올바른 XML/u);
  let called = false;
  await assert.rejects(() => prepareWebpThumbnail("https://example.com/thumb.jpg", {
    allowedHosts: new Set(["i.ytimg.com"]),
    fetcher: async () => {
      called = true;
      return new Response(onePixelPng, { headers: { "Content-Type": "image/png" } });
    },
    attempts: 1,
    label: "테스트 썸네일",
  }), /허용된 HTTPS 호스트/u);
  assert.equal(called, false);
  await assert.rejects(() => prepareWebpThumbnail("https://i.ytimg.com:444/thumb.jpg", {
    allowedHosts: new Set(["i.ytimg.com"]),
    fetcher: async () => new Response(onePixelPng, { headers: { "Content-Type": "image/png" } }),
    attempts: 1,
    label: "테스트 썸네일",
  }), /허용된 HTTPS 호스트/u);
});

test("이미지가 아닌 응답과 최대 크기 초과 썸네일을 거부한다", async () => {
  await assert.rejects(() => prepareWebpThumbnail("https://i.ytimg.com/not-image", {
    allowedHosts: new Set(["i.ytimg.com"]),
    fetcher: async () => new Response("plain text", { headers: { "Content-Type": "text/plain" } }),
    attempts: 1,
    label: "테스트 썸네일",
  }), /Content-Type/u);
  await assert.rejects(() => prepareWebpThumbnail("https://i.ytimg.com/too-large", {
    allowedHosts: new Set(["i.ytimg.com"]),
    fetcher: async () => new Response("", { headers: { "Content-Type": "image/jpeg", "Content-Length": String(5 * 1024 * 1024 + 1) } }),
    attempts: 1,
    label: "테스트 썸네일",
  }), /응답 크기/u);
});

test("기존 썸네일 경로는 다시 다운로드하거나 JSON에 반영하지 않는다", async (t) => {
  const root = await makeSyncRoot(t);
  const existingThumbnail = join(root, "public", "images", "blog", "224999999999.webp");
  await mkdir(join(root, "public", "images", "blog"), { recursive: true });
  await writeFile(existingThumbnail, "operator-file", "utf8");
  let thumbnailFetches = 0;
  const baseFetcher = fixtureFetcher();
  const fetcher = async (value, options) => {
    if (String(value).includes("blogthumb.pstatic.net")) thumbnailFetches += 1;
    return baseFetcher(value, options);
  };
  await assert.rejects(() => runExternalContentSync({
    rootDir: root,
    fetcher,
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  }), /썸네일 경로가 이미 존재/u);
  assert.equal(thumbnailFetches, 0);
  assert.equal(await readFile(existingThumbnail, "utf8"), "operator-file");
  assert.equal(await readFile(join(root, "src", "data", "external-links.json"), "utf8"), "[]\n");
});

test("keepalive는 45일 경계부터 갱신한다", () => {
  assert.equal(shouldRefreshKeepalive("2026-01-01", new Date("2026-02-14T23:59:59Z")), false);
  assert.equal(shouldRefreshKeepalive("2026-01-01", new Date("2026-02-15T00:00:00Z")), true);
  assert.equal(shouldRefreshKeepalive("2026-01-01", new Date("2026-03-01T00:00:00Z")), true);
});

test("무변경 실행은 45일 전에는 파일을 보존하고 경계일에는 health 파일만 갱신한다", async (t) => {
  const current = [
    buildExternalContentItem(parseNaverBlogFeed(naverRss)[0], null),
    buildExternalContentItem(parseYouTubeFeed(youtubeAtom, { channelId })[0], null),
  ];
  const root = await makeSyncRoot(t, { current, lastKeepaliveAt: "2026-08-26" });
  const contentPath = join(root, "src", "data", "external-links.json");
  const healthPath = join(root, ".github", "automation-health.json");
  const contentBefore = await readFile(contentPath, "utf8");
  const healthBefore = await readFile(healthPath, "utf8");
  const options = {
    rootDir: root,
    fetcher: fixtureFetcher(),
    fetchAttempts: 1,
    youtubeChannelId: channelId,
    logger: { log() {}, warn() {} },
  };
  const beforeBoundary = await runExternalContentSync({ ...options, now: new Date("2026-10-09T00:00:00Z") });
  assert.equal(beforeBoundary.keepaliveChanged, false);
  assert.equal(await readFile(healthPath, "utf8"), healthBefore);
  const atBoundary = await runExternalContentSync({ ...options, now: new Date("2026-10-10T00:00:00Z") });
  assert.equal(atBoundary.keepaliveChanged, true);
  assert.equal(await readFile(contentPath, "utf8"), contentBefore);
  assert.equal(JSON.parse(await readFile(healthPath, "utf8")).lastKeepaliveAt, "2026-10-10");
});

test("동기화 커밋은 콘텐츠와 keepalive 허용 경로를 분리한다", () => {
  assert.deepEqual(classifySyncChanges([
    "src/data/external-links.json",
    "public/images/youtube/I05mw0iCFnM.webp",
  ]).mode, "content");
  assert.equal(classifySyncChanges([".github/automation-health.json"]).mode, "keepalive");
  assert.equal(classifySyncChanges([]).mode, "none");
  assert.throws(() => classifySyncChanges(["src/data/external-links.json", ".github/automation-health.json"]), /같은 커밋/u);
  assert.throws(() => classifySyncChanges(["package.json"]), /허용 목록 밖/u);
  assert.throws(() => classifySyncChanges(["public/images/blog/224999999999.webp"]), /external-links/u);
});

test("git status porcelain 경로를 안전하게 해석하고 rename은 거부한다", () => {
  assert.deepEqual(parseGitStatusPorcelain(" M src/data/external-links.json\0?? public/images/blog/1.webp\0"), [
    "src/data/external-links.json",
    "public/images/blog/1.webp",
  ]);
  assert.throws(() => parseGitStatusPorcelain("R  old-path\0new-path\0"), /rename/u);
});

test("thumbnail:null UI fallback과 읽기 검증·쓰기 배포 분리·예약 워크플로를 고정한다", () => {
  assert.match(externalContentComponent, /item\.thumbnail \?/u);
  assert.match(externalContentComponent, /item\.type === "blog" \? "N" : "▶"/u);
  const testStep = syncWorkflow.indexOf("- run: npm test");
  const validateStep = syncWorkflow.indexOf("- name: Validate changed paths");
  const packageStep = syncWorkflow.indexOf("- name: Package verified changes");
  const publishJob = syncWorkflow.indexOf("\n  publish:");
  const commitStep = syncWorkflow.indexOf("- name: Commit verified changes");
  const pushStep = syncWorkflow.indexOf("- name: Push with job-scoped credential");
  assert.ok(
    testStep > 0 &&
      testStep < validateStep &&
      validateStep < packageStep &&
      packageStep < publishJob &&
      publishJob < commitStep &&
      commitStep < pushStep,
  );
  assert.match(syncWorkflow, /permissions:\s*\n\s*contents: read/u);
  assert.match(syncWorkflow, /publish:[\s\S]*?permissions:\s*\n\s*contents: write/u);
  assert.equal((syncWorkflow.match(/persist-credentials: false/gu) ?? []).length, 2);
  assert.match(syncWorkflow, /schedule:\s*\n\s*- cron: "17 \* \* \* \*"/u);
});
