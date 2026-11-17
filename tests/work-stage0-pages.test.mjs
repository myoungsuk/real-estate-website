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
  "src/components/admin/AdminSubnav.astro",
  "src/components/admin/AdminIcon.astro",
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

test("업무 도구 첫 화면은 왼쪽 목록과 세 도구 바로가기를, 세 도구 화면은 밑줄 탭을 제공한다", async () => {
  const [index, nav, subnav, ...toolPages] = await Promise.all([
    readSource("src/pages/admin/work/index.astro"),
    readSource("src/components/admin/WorkToolNav.astro"),
    readSource("src/components/admin/AdminSubnav.astro"),
    readSource("src/pages/admin/work/fee.astro"),
    readSource("src/pages/admin/work/messages.astro"),
    readSource("src/pages/admin/work/schedule.astro"),
  ]);
  for (const href of ["/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/"]) {
    assert.ok(index.includes(`href: "${href}"`), href);
    assert.ok(nav.includes(`href: "${href}"`), href);
  }
  assert.match(index, /<AdminSubnav slot="aside"/u, "첫 화면은 왼쪽 보조 목록을 쓴다");
  assert.match(index, /\{ href: "\/admin\/work\/", label: "업무 도구 처음"/u, "왼쪽 목록 맨 위는 첫 화면");
  assert.match(subnav, /aria-current=\{pathname === item\.href \? "page" : undefined\}/u);
  assert.match(nav, /aria-current=\{isCurrent\(tool\.href\) \? "page" : undefined\}/u);
  for (const page of toolPages) {
    assert.match(page, /<WorkToolNav \/>/u);
    assert.doesNotMatch(page, /slot="aside"/u, "문구·계산 화면은 왼쪽 목록 없이 밑줄 탭만 쓴다(운영자 승인 2026-11-16 15:05:43)");
  }
});

test("왼쪽 목록 찾기 칸은 메뉴 이름만 거르고 저장·전송하지 않는다", async () => {
  const subnav = await readSource("src/components/admin/AdminSubnav.astro");
  assert.doesNotMatch(subnav, /<form\b/u);
  assert.match(subnav, /<input\b[^>]*type="search"[^>]*autocomplete="off"[^>]*data-admin-subnav-search/u);
  assert.match(subnav, /window\.addEventListener\("pageshow", \(\) => \{\s*\n\s*search\.value = "";/u, "뒤로 가기 복원 때 찾기 칸을 비운다");
});

test("관리자 메뉴의 지금 화면 표시는 색만이 아니라 굵기·밑줄·막대·기호 반전으로도 구분한다", async () => {
  const [styles, layout] = await Promise.all([readSource("src/styles/admin.css"), readSource("src/layouts/AdminLayout.astro")]);
  assert.match(styles, /\.admin-topnav__item\[aria-current="page"\] \{[^}]*font-weight: 900;/u);
  assert.match(styles, /\.admin-topnav__item\[aria-current="page"\] \.admin-topnav__icon \{ color: var\(--admin-blue\); background: #fff; \}/u);
  assert.match(styles, /\.work-tool-nav a\[aria-current="page"\] \{[^}]*font-weight: 900;[^}]*box-shadow: inset 0 -2px 0/u);
  assert.match(styles, /\.admin-subnav__nav a\[aria-current="page"\] \{[^}]*font-weight: 900;/u);
  assert.match(styles, /\.admin-subnav__nav a\[aria-current="page"\] \{ background: #e6e9ed; box-shadow: inset 3px 0 0 var\(--admin-blue\); \}/u);
  assert.match(layout, /aria-current=\{isCurrentPath\(item\.href\) \? "page" : undefined\}/u);
  assert.match(layout, /if \(document\.activeElement === button\)/u, "넘기기 단추가 숨겨질 때 포커스를 옮긴다");
});

test("위 메뉴 줄은 모든 폭에서 고정되고, 고정 머리글 뒤로 숨는 키보드 포커스를 보정한다(사용자 선택 2026-11-16 16:59:58)", async () => {
  const [styles, layout] = await Promise.all([readSource("src/styles/admin.css"), readSource("src/layouts/AdminLayout.astro")]);
  // 좁은 화면: 브랜드 줄(56px)이 올라가고 메뉴 줄만 남음. 넓은 화면: 한 줄 전체 고정
  assert.match(styles, /\.admin-topnav \{ position: sticky; top: calc\(-1 \* var\(--admin-topnav-hide\)\);/u);
  assert.match(styles, /--admin-topnav-hide: 56px; --admin-sticky-height: 53px;/u);
  assert.match(styles, /:root \{ --admin-sticky-height: var\(--admin-topnav-height\); \}\r?\n\s*\.admin-topnav \{ top: 0;/u);
  assert.doesNotMatch(styles, /^html \{[^}]*scroll-padding-top/mu, "문서 전체 여백은 머리글 안 Tab 때 문서를 튀게 하므로 쓰지 않음(회귀 1회차 S2)");
  assert.match(styles, /#admin-main \{ scroll-margin-top: var\(--admin-sticky-height\); \}/u, "건너뛰기 링크 대상은 머리글 아래로");
  assert.match(styles, /\[data-manual-form\], \[data-history-preview\] \{ scroll-margin-top: var\(--admin-sticky-height\); \}/u, "스크립트로 옮기는 매물 편집 폼·변경 이력 미리보기는 머리글 아래로(회귀 2회차 S3)");
  assert.match(styles, /\.admin-topnav:has\(:focus-visible\) \{ top: 0; \}/u, "좁은 화면 숨은 브랜드 줄에 키보드 포커스가 가면 보이게(회귀 1회차 S1)");
  assert.match(styles, /\.admin-shell__aside \{ position: sticky; top: var\(--admin-topnav-height\);/u, "왼쪽 목록은 고정 머리글 아래");
  // 보정 스크립트: 키보드 포커스만, 머리글 안·건너뛰기·열린 확인 창 제외, 마우스 클릭 직후 제외, 횟수 제한
  assert.match(layout, /document\.addEventListener\("focusin"/u);
  assert.match(layout, /!\(target\.matches\(":focus-visible"\) \|\| target\.matches\(textEntry\)\)/u, "키보드로 들어가도 :focus-visible이 아닌 날짜 칸 등 글 입력류도 보정(회귀 2회차 S4)");
  assert.match(layout, /const textEntry =\s*"textarea, select, input:not\(\[type=button\]\)/u);
  assert.match(layout, /:not\(\[type=checkbox\]\):not\(\[type=radio\]\)/u, "체크·라디오는 :focus-visible 기준 그대로");
  assert.match(layout, /performance\.now\(\) - pointerAt < 600/u);
  assert.match(layout, /header\.contains\(target\) \|\| target\.classList\.contains\("skip-link"\) \|\| target\.closest\("dialog\[open\]"\)/u);
  assert.match(layout, /attempts >= 3/u);
  assert.match(layout, /target\.closest\("label"\) \?\? target/u, "숨긴 라디오는 감싼 라벨 기준");
  assert.doesNotMatch(layout, /admin-write-ready|AdminApiError|fetch\(/u, "세션·쓰기 흐름은 건드리지 않음");
});

test("관리자 탭 미리 그리기는 업무 도구 4화면만 prerender, 나머지 관리자는 prefetch하고 저장·인증·내려받기 링크와 공개 화면은 뺀다", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.match(layout, /<script type="speculationrules" is:inline set:html=\{JSON\.stringify\(speculationRules\)\}><\/script>\r?\n\s*<\/head>/u, "규칙은 관리자 공용 틀 head 안에 한 번");
  assert.match(layout, /const prerenderPages = \["\/admin\/work\/", "\/admin\/work\/fee\/", "\/admin\/work\/messages\/", "\/admin\/work\/schedule\/"\];/u, "화면 전체 미리 그리기는 서버 요청이 없는 단계 0 업무 도구 4화면만 이름으로(T0-115)");
  assert.match(layout, /prerender: \[\{ where: \{ and: \[\{ or: prerenderPages\.map\(\(page\) => \(\{ href_matches: page \}\)\) \}, \.\.\.speculationExclusions\] \}, eagerness: "moderate" \}\]/u);
  assert.doesNotMatch(layout, /href_matches: "\/admin\/work\/\*"/u, "업무 도구 아래 새 화면이 저절로 prerender되지 않게 앞부분 맞춤을 쓰지 않음");
  assert.match(layout, /prefetch: \[\{ where: \{ and: \[\{ href_matches: "\/admin\/\*" \}, \.\.\.speculationExclusions\] \}, eagerness: "moderate" \}\]/u, "HTML만 미리 받기는 관리자 경로 안에서만");
  for (const exclusion of ['"/api/*"', '"/cdn-cgi/*"', '"/admin/listings/editor*"', '"[data-no-speculate], [download], [rel~=nofollow]"']) {
    assert.ok(layout.includes(exclusion), `두 규칙 공통 제외 목록에 ${exclusion}`);
  }
  assert.doesNotMatch(layout, /eagerness: "(eager|immediate)"/u, "손을 올리기 전 자동 미리 그리기는 쓰지 않음");

  const sourceFiles = (await readdir(new URL("../src/", import.meta.url), { recursive: true }))
    .filter((name) => /\.(astro|ts|mjs|js|json)$/u.test(name))
    .map((name) => `src/${name.replaceAll("\\", "/")}`);
  const withRules = [];
  for (const file of sourceFiles) {
    if ((await readSource(file)).includes("speculationrules")) withRules.push(file);
  }
  assert.deepEqual(withRules, ["src/layouts/AdminLayout.astro"], "공개 화면(BaseLayout·공개 페이지)에는 미리 그리기 규칙이 없음");
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
