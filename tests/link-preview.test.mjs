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
        return Response.json({ title: "테스트 영상" }, { headers: { "Content-Type": "application/json" } });
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

test("미리보기 응답을 읽기 전에 선언된 크기와 형식을 제한한다", async () => {
  await assert.rejects(
    fetchExternalLinkPreview(
      { type: "blog", url: "https://blog.naver.com/p5468300/1" },
      async () => new Response("<html></html>", {
        headers: { "Content-Type": "text/html", "Content-Length": String((1024 * 1024) + 1) },
      }),
    ),
    (error) => error.code === "PREVIEW_PAGE_TOO_LARGE" && error.status === 502,
  );

  await assert.rejects(
    fetchExternalLinkPreview(
      { type: "youtube", url: "https://www.youtube.com/watch?v=JtgF9EpJARs" },
      async () => new Response("<html></html>", { headers: { "Content-Type": "text/html" } }),
    ),
    (error) => error.code === "PREVIEW_RESPONSE_INVALID" && error.status === 502,
  );
});

test("허용되지 않은 유튜브 oEmbed 리디렉션과 스트리밍 크기 초과를 차단한다", async () => {
  await assert.rejects(
    fetchExternalLinkPreview(
      { type: "youtube", url: "https://www.youtube.com/watch?v=JtgF9EpJARs" },
      async () => new Response(null, { status: 302, headers: { Location: "https://example.com/oembed" } }),
    ),
    (error) => error.code === "PREVIEW_URL_DENIED" && error.status === 400,
  );

  const oversized = new Uint8Array((64 * 1024) + 1).fill(0x20);
  await assert.rejects(
    fetchExternalLinkPreview(
      { type: "youtube", url: "https://www.youtube.com/watch?v=JtgF9EpJARs" },
      async () => new Response(oversized, { headers: { "Content-Type": "application/json" } }),
    ),
    (error) => error.code === "PREVIEW_RESPONSE_TOO_LARGE" && error.status === 502,
  );
});
