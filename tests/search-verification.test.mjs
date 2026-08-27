import assert from "node:assert/strict";
import test from "node:test";

import { isSearchVerificationFile } from "../scripts/assert-production-build.mjs";

test("네이버 원본 소유확인 HTML은 일반 SEO 페이지 검사에서 제외한다", () => {
  const filename = "naver0123456789abcdef0123456789abcdef.html";

  assert.equal(
    isSearchVerificationFile(filename, `naver-site-verification: ${filename}\n`),
    true,
  );
});

test("이름이나 본문이 다른 HTML은 소유확인 파일로 간주하지 않는다", () => {
  const filename = "naver0123456789abcdef0123456789abcdef.html";

  assert.equal(isSearchVerificationFile(`nested/${filename}`, `naver-site-verification: ${filename}`), false);
  assert.equal(isSearchVerificationFile(filename, "<html><head></head></html>"), false);
  assert.equal(isSearchVerificationFile("naver-short.html", "naver-site-verification: naver-short.html"), false);
});
