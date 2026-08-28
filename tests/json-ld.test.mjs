import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createBreadcrumbList, serializeJsonLd } from "../src/lib/json-ld.mjs";

test("JSON-LD 직렬화는 script 종료와 HTML 특수문자를 안전하게 이스케이프한다", () => {
  const value = {
    text: "</script><script>alert('xss')</script> < > &",
    separators: "line\u2028paragraph\u2029end",
  };
  const serialized = serializeJsonLd(value);

  assert.doesNotMatch(serialized, /<|>|&|\u2028|\u2029/u);
  assert.match(serialized, /\\u003c\/script\\u003e/u);
  assert.match(serialized, /\\u003cscript\\u003e/u);
  assert.match(serialized, /\\u0026/u);
  assert.match(serialized, /\\u2028/u);
  assert.match(serialized, /\\u2029/u);
  assert.deepEqual(JSON.parse(serialized), value);
});

test("BaseLayout은 구조화 데이터를 안전한 JSON-LD 직렬화 결과로만 삽입한다", async () => {
  const layout = await readFile(new URL("../src/layouts/BaseLayout.astro", import.meta.url), "utf8");
  assert.match(layout, /serializeJsonLd\(structuredDataItems\.length/u);
  assert.match(layout, /set:html=\{serializedStructuredData\}/u);
  assert.doesNotMatch(layout, /set:html=\{JSON\.stringify/u);
});

test("BreadcrumbList는 검색엔진이 해석할 수 있는 절대 URL 계층을 만든다", () => {
  assert.deepEqual(createBreadcrumbList([
    { name: "홈", url: "https://leaderscityhappy.com/" },
    { name: "단지 정보", url: "https://leaderscityhappy.com/complexes/" },
  ]), {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "홈", item: "https://leaderscityhappy.com/" },
      { "@type": "ListItem", position: 2, name: "단지 정보", item: "https://leaderscityhappy.com/complexes/" },
    ],
  });
  assert.throws(() => createBreadcrumbList([{ name: "홈", url: "https://leaderscityhappy.com/" }]), /2개 이상/u);
});
