import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const listFiles = async (directory, extension) =>
  (await readdir(new URL(`../${directory}/`, import.meta.url))).filter((name) => name.endsWith(extension)).map((name) => `${directory}/${name}`);

const stage0Files = async () => [
  ...await listFiles("src/lib/work", ".mjs"),
  ...await listFiles("src/pages/admin/work", ".astro"),
  "src/components/admin/WorkToolNav.astro",
  "src/components/admin/WorkLegalBasis.astro",
];

test("T0-115 단계 0 모듈과 화면 스크립트는 서버 요청·브라우저 저장·주소 변경을 하지 않는다", async () => {
  const files = await stage0Files();
  assert.ok(files.length >= 10, files.join(", "));
  const forbidden = [
    ["fetch", /\bfetch\s*\(/u],
    ["XMLHttpRequest", /XMLHttpRequest/u],
    ["sendBeacon", /sendBeacon/u],
    ["WebSocket", /\bWebSocket\b/u],
    ["EventSource", /\bEventSource\b/u],
    ["localStorage", /localStorage/u],
    ["sessionStorage", /sessionStorage/u],
    ["indexedDB", /indexedDB/iu],
    ["cookie", /document\.cookie/u],
    ["history", /\b(?:pushState|replaceState)\b/u],
    ["location write", /\blocation(?:\.(?:href|hash|search|pathname))?\s*=(?!=)/u],
    ["location call", /\blocation\.(?:assign|replace|reload)\s*\(/u],
    ["window.open", /window\.open\s*\(/u],
  ];
  for (const file of files) {
    const source = await readSource(file);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${name}`);
  }
});

test("단계 0 화면은 form 제출이 없고 입력칸 자동 완성을 끈다", async () => {
  for (const file of await listFiles("src/pages/admin/work", ".astro")) {
    const source = await readSource(file);
    assert.doesNotMatch(source, /<form\b/u, `${file}: Enter 제출로 입력값이 주소에 붙지 않게 form을 쓰지 않는다`);
    const controls = source.match(/<(?:input|select|textarea)\b[^>]*>/gu) ?? [];
    for (const control of controls) {
      if (/readonly/u.test(control)) continue;
      assert.match(control, /autocomplete="off"/u, `${file}: ${control}`);
    }
    if (controls.length > 0) {
      assert.match(source, /window\.addEventListener\("pageshow"/u, `${file}: 뒤로 가기 캐시 복원 때 입력값을 지운다`);
      assert.match(source, /\breset\(\);\s*\n\s*\}\s*\n\s*\}\s*\n\s*<\/script>/u, `${file}: 열 때마다 기본값으로 다시 채운다`);
    }
  }
});

test("TU-04 업무 화면의 날짜 칸은 칸 안 어느 위치에 포커스가 있어도 테두리를 보여 준다", async () => {
  const styles = await readSource("src/styles/admin.css");
  assert.match(
    styles,
    /\.work-tool input\[type="date"\]:focus,\r?\n\.work-tool input\[type="date"\]:focus-within \{ outline: 3px solid var\(--focus-ring\); outline-offset: 3px; \}/u,
  );
  assert.doesNotMatch(styles, /^\.admin-field input\[type="date"\]/mu, "기존 관리자 날짜 칸 규칙은 건드리지 않는다");
});

test("TU-15 관리자 메뉴의 대시보드 다음에 업무 도구(짧은 이름 업무)가 있다", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.match(
    layout,
    /\{ href: "\/admin\/", label: "대시보드", shortLabel: "홈" \},\r?\n\s*\{ href: "\/admin\/work\/", label: "업무 도구", shortLabel: "업무" \},/u,
  );
});

test("업무 도구 첫 화면은 세 도구 바로가기와 탭을 제공한다", async () => {
  const [index, nav] = await Promise.all([readSource("src/pages/admin/work/index.astro"), readSource("src/components/admin/WorkToolNav.astro")]);
  for (const href of ["/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/"]) {
    assert.ok(index.includes(`href: "${href}"`), href);
    assert.ok(nav.includes(`href: "${href}"`), href);
  }
  assert.match(nav, /aria-current=\{isCurrent\(tool\.href\) \? "page" : undefined\}/u);
});

test("부가세 기본값은 켬이고 금액 입력은 숫자 키패드를 쓴다", async () => {
  const [fee, feePage, messagesPage, schedulePage] = await Promise.all([
    readSource("src/lib/work/brokerage-fee.mjs"),
    readSource("src/pages/admin/work/fee.astro"),
    readSource("src/pages/admin/work/messages.astro"),
    readSource("src/pages/admin/work/schedule.astro"),
  ]);
  assert.match(fee, /export const DEFAULT_VAT_DISPLAY = true;/u);
  assert.match(feePage, /vat\.checked = DEFAULT_VAT_DISPLAY;/u);
  for (const page of [feePage, messagesPage, schedulePage]) {
    const amountInputs = page.match(/<input\b[^>]*data-(?:fee-amount|message-field="(?:amountWon|monthlyRentWon|depositAmountWon)"|schedule-field="(?:priceWon|depositWon|monthlyRentWon)")[^>]*>/gu) ?? [];
    assert.ok(amountInputs.length > 0);
    for (const input of amountInputs) assert.match(input, /inputmode="numeric"/u, input);
  }
});

test("T0-125·T0-126 대전 밖 물건 안내와 화면 아래 법령 기준·확인일·규칙 ID", async () => {
  const [basis, feePage, schedulePage] = await Promise.all([
    readSource("src/components/admin/WorkLegalBasis.astro"),
    readSource("src/pages/admin/work/fee.astro"),
    readSource("src/pages/admin/work/schedule.astro"),
  ]);
  assert.match(basis, /법령 기준: 국가법령정보센터, 확인일 \{legalRules\.checkedAt\}/u);
  assert.match(basis, /규칙 ID: \{ruleIds\.join\(", "\)\}/u);
  assert.match(feePage, /<WorkLegalBasis ruleIds=\{legalRules\.brokerageFeeRules\.map/u);
  assert.match(schedulePage, /<WorkLegalBasis ruleIds=\{ruleIds\} \/>/u);
  assert.match(feePage, /물건이 대전 밖에 있어도 중개사무소 소재지\(대전광역시\) 조례의 요율표를 씁니다/u);
  assert.match(schedulePage, /공휴일은 직접 확인하세요/u);
});

test("T0-127 iPhone 대체 버튼은 내려받기와 같은 .ics 문자열을 쓴다", async () => {
  const schedulePage = await readSource("src/pages/admin/work/schedule.astro");
  assert.match(schedulePage, /latestIcs = text;\s*\n\s*download\.disabled = false;\s*\n\s*fallback\.href = `data:text\/calendar;charset=utf-8,\$\{encodeURIComponent\(text\)\}`;/u);
  assert.match(schedulePage, /new Blob\(\[latestIcs\], \{ type: "text\/calendar;charset=utf-8" \}\)/u);
  assert.match(schedulePage, /link\.download = icsFileName\(currentContractDate\);/u);
});

test("안내 문자 화면은 받는 사람 없는 sms 주소와 복사 실패 안내를 쓴다", async () => {
  const page = await readSource("src/pages/admin/work/messages.astro");
  assert.match(page, /buildSmsHref\(message\.text, link\.dataset\.messageSms === "ampersand" \? "ampersand" : "query"\)/u);
  assert.match(page, /자동 복사가 막혔습니다/u);
  assert.match(page, /손님 이름·전화번호·주민등록번호·계좌 비밀번호는 넣지 마세요/u);
});
