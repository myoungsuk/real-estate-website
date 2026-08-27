import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const readSource = (relativePath) => readFile(new URL(relativePath, root), "utf8");

const contactSources = [
  "src/components/ContactPanel.astro",
  "src/components/MobileContactBar.astro",
  "src/components/SiteFooter.astro",
  "src/components/SiteHeader.astro",
  "src/pages/404.astro",
  "src/pages/faq.astro",
  "src/pages/index.astro",
  "src/pages/location.astro",
  "src/pages/office.astro",
];

test("전화·문자·카카오 링크는 승인된 사무소 정보의 공통 href만 사용한다", async () => {
  const [officeSource, siteSource, ...sources] = await Promise.all([
    readSource("src/data/office.json"),
    readSource("src/lib/site.ts"),
    ...contactSources.map(readSource),
  ]);
  const office = JSON.parse(officeSource);

  assert.equal(office.mobile, "010-2790-8675");
  assert.equal(office.kakaoUrl, "https://pf.kakao.com/_nxmabn/chat");
  assert.match(siteSource, /phoneHref = `tel:\$\{office\.mobile\.replaceAll\("-", ""\)\}`/);
  assert.match(siteSource, /smsHref = `sms:\$\{office\.mobile\.replaceAll\("-", ""\)\}`/);
  assert.match(siteSource, /kakaoHref = office\.kakaoUrl/);

  for (const [index, source] of sources.entries()) {
    assert.doesNotMatch(source, /href=["'](?:tel|sms):/u, `${contactSources[index]}에 연락처가 직접 입력되어 있습니다.`);
    assert.doesNotMatch(source, /https:\/\/pf\.kakao\.com/u, `${contactSources[index]}에 카카오 주소가 직접 입력되어 있습니다.`);
  }
});

test("공개 상담 CTA는 전화·문자·카카오 이동과 안전한 외부 링크 속성을 유지한다", async () => {
  const [mobileBar, contactPanel, faq, styles] = await Promise.all([
    readSource("src/components/MobileContactBar.astro"),
    readSource("src/components/ContactPanel.astro"),
    readSource("src/pages/faq.astro"),
    readSource("src/styles/global.css"),
  ]);

  for (const source of [mobileBar, contactPanel]) {
    assert.match(source, /href=\{phoneHref\}/);
    assert.match(source, /href=\{smsHref\}/);
    assert.match(source, /href=\{kakaoHref\}[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/);
  }

  assert.match(faq, /<form[^>]*action=\{smsHref\}[^>]*data-consultation-form>/);
  assert.match(faq, /\?body=\$\{encodeURIComponent\(lines\.join\("\\n"\)\)\}/);
  assert.match(styles, /\.button \{[^}]*min-height: 50px/);
  assert.match(styles, /\.text-link \{[^}]*min-height: 44px/);
  assert.match(styles, /\.contact-bar__item \{[^}]*min-height: 52px/);
  assert.match(styles, /\.contact-bar \{[^}]*grid-template-columns: 0\.75fr 0\.85fr 1\.4fr/);
});
