import assert from "node:assert/strict";
import test from "node:test";
import { fetchExternalLinkPreview } from "../worker/link-preview.mjs";

test("네이버 블로그·유튜브 밖의 링크 미리보기를 차단한다", async () => {
  await assert.rejects(
    fetchExternalLinkPreview({ type: "blog", url: "https://example.com/post" }, async () => new Response()),
    (error) => error.code === "PREVIEW_URL_DENIED" && error.status === 400,
  );
});

test("네이버 블로그가 허용되지 않은 호스트로 리디렉션하면 차단한다", async () => {
  await assert.rejects(
    fetchExternalLinkPreview(
      { type: "blog", url: "https://blog.naver.com/p5468300/1" },
      async () => new Response(null, { status: 302, headers: { Location: "https://example.com/private" } }),
    ),
    (error) => error.code === "PREVIEW_URL_DENIED" && error.status === 400,
  );
});

test("유튜브 개별 영상의 제목과 썸네일을 안전한 데이터로 반환한다", async () => {
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const preview = await fetchExternalLinkPreview(
    { type: "youtube", url: "https://www.youtube.com/watch?v=JtgF9EpJARs" },
    async (url) => {
      const value = String(url);
      if (value.startsWith("https://www.youtube.com/oembed")) {
        return Response.json({ title: "테스트 영상" });
      }
      if (value === "https://i.ytimg.com/vi/JtgF9EpJARs/hqdefault.jpg") {
        return new Response(imageBytes, { headers: { "Content-Type": "image/jpeg" } });
      }
      throw new Error(`예상하지 못한 URL: ${value}`);
    },
  );

  assert.equal(preview.title, "테스트 영상");
  assert.match(preview.thumbnailDataUrl, /^data:image\/jpeg;base64,/);
});
