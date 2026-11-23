import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const listFiles = async (directory, extension) =>
  (await readdir(new URL(`../${directory}/`, import.meta.url))).filter((name) => name.endsWith(extension)).map((name) => `${directory}/${name}`);

const stage0Files = async () => [
  ...await listFiles("src/lib/work", ".mjs"),
  ...await listFiles("src/pages/admin/work", ".astro"),
  "src/components/admin/WorkLegalBasis.astro",
  "src/components/admin/WorkResultBar.astro",
  "src/components/admin/AdminIcon.astro",
  // 업무 도구 화면을 감싸는 관리자 공용 틀(메뉴·전체 메뉴 창 스크립트)도 같은 규칙을 지킨다.
  "src/layouts/AdminLayout.astro",
  "src/components/admin/AdminMenu.astro",
  // 업무 도구 화면이 가져다 쓰는 그림·화면 모듈(work-*.ts)도 같은 규칙을 지킨다. 서버를 부르는 곳은 *-client.ts 한 곳씩뿐이라 그것만 뺀다.
  ...(await listFiles("src/lib", ".ts")).filter((file) => /\/work-[^/]+\.ts$/u.test(file) && !file.endsWith("-client.ts")),
];

test("T0-115 단계 0 모듈과 화면 스크립트는 서버 요청·브라우저 저장·주소 변경을 하지 않는다", async () => {
  const files = await stage0Files();
  assert.ok(files.length >= 10, files.join(", "));
  // 그림 파일(보드 #91 리뷰): 카드 공통 그리기·거래 완료 알림·중개보수 영수증·실거래가 카드가 빠지지 않았는지 이름으로도 본다.
  for (const file of ["src/lib/work-card-draw.ts", "src/lib/work-done-card.ts", "src/lib/work-fee-receipt-card.ts", "src/lib/work-realprice-card.ts"]) assert.ok(files.includes(file), `${file}: 검사 대상`);
  // 빠지는 것은 서버 요청 모듈(*-client.ts)뿐이다.
  const skipped = (await listFiles("src/lib", ".ts")).filter((file) => /\/work-[^/]+\.ts$/u.test(file) && !files.includes(file));
  assert.deepEqual(skipped, skipped.filter((file) => file.endsWith("-client.ts")), `빠진 업무 모듈: ${skipped.join(", ")}`);
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
      assert.match(source, /\breset\(\);\s*\n(?:\s*\}\s*\n){1,2}\s*<\/script>/u, `${file}: 열 때마다 기본값으로 다시 채운다`);
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

test("업무 도구 네 화면은 관리자 공용 틀의 아래 단계 메뉴(위 알약 줄)로 오가고 화면 안에 따로 메뉴를 두지 않는다(사용자 선택 2026-11-18 C+D 17:24:07·CD1 17:55:44, 2026-11-23 11:34:13 위 알약 메뉴)", async () => {
  const [layout, index, ...toolPages] = await Promise.all([
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/pages/admin/work/index.astro"),
    readSource("src/pages/admin/work/fee.astro"),
    readSource("src/pages/admin/work/messages.astro"),
    readSource("src/pages/admin/work/schedule.astro"),
  ]);
  for (const href of ["/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/"]) {
    assert.ok(index.includes(`href: "${href}"`), `첫 화면 바로가기 ${href}`);
    assert.match(layout, new RegExp(`\\{ href: "${href.replaceAll("/", "\\/")}", label: "[^"]+"(?:, group: "[^"]+")? \\},`, "u"), `아래 단계 메뉴 ${href}`);
  }
  assert.match(layout, /"\/admin\/work\/": \[\r?\n\s*\{ href: "\/admin\/work\/", label: "업무 도구 처음" \},/u, "아래 단계 맨 위는 첫 화면");
  for (const page of [index, ...toolPages]) {
    // 11-16 결정(문구·계산 화면은 밑줄 탭만, 위 메뉴 줄 + 왼쪽 목록)은 11-18 C+D·CD1 선택이 대신한다.
    assert.doesNotMatch(page, /slot="aside"|<WorkToolNav|<AdminSubnav/u, "화면 안 메뉴는 공용 틀 하나로 합침");
  }
  assert.doesNotMatch(layout, /<slot name="aside"/u, "화면별 왼쪽 목록 자리는 없앰");
  assert.doesNotMatch(layout, /type="search"/u, "왼쪽 목록 찾기 칸은 없앰(사용자 결정 2026-11-18 19:47:29)");
});

test("관리자 메뉴는 모든 메뉴를 묶음에 한 번씩 넣고, 지금 화면(page)과 지금 구역(true)을 색만이 아니라 막대·채움·굵기로 구분한다", async () => {
  const [styles, layout, menu] = await Promise.all([
    readSource("src/styles/admin.css"),
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/components/admin/AdminMenu.astro"),
  ]);
  const navigationHrefs = [...layout.matchAll(/\{ href: "(\/admin\/[^"]*)", label: "[^"]+", shortLabel: "[^"]+" \}/gu)].map((match) => match[1]);
  const groupHrefs = [...layout.matchAll(/hrefs: \[([^\]]+)\]/gu)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/gu)].map((href) => href[1]));
  assert.equal(navigationHrefs.length, 9, "관리자 메뉴 9개(2026-11-19 사용 안내 추가)");
  assert.deepEqual([...groupHrefs].sort(), [...navigationHrefs].sort(), "메뉴 묶음에 빠지거나 두 번 들어간 메뉴가 없음");
  assert.match(layout, /const currentState = \(href: string\): "page" \| "true" \| undefined => \(currentPath === href \? "page" : isCurrentPath\(href\) \? "true" : undefined\);/u);
  assert.equal(layout.split("<a href={item.href} aria-current={currentState(item.href)}>").length - 1, 2, "아래 탭과 PC 구역 알약 줄(nav.admin-topnav) 두 곳 모두 지금 화면·지금 구역");
  assert.match(layout, /<nav class="admin-topnav"[^>]*>[\s\S]*?<a href=\{item\.href\} aria-current=\{currentState\(item\.href\)\}>[\s\S]*?<\/nav>/u, "PC 구역 알약 줄");
  assert.match(layout, /<nav class="admin-tabbar"[^>]*>[\s\S]*?<a href=\{item\.href\} aria-current=\{currentState\(item\.href\)\}>[\s\S]*?<\/nav>/u, "휴대폰 아래 탭");
  assert.match(layout, /<a href=\{item\.href\} aria-current=\{subCurrentState\(currentSection\.href, item\.href\)\}>/u, "작은 탭은 지금 화면, 그 아래 화면(실거래가 설정)에서는 지금 구역");
  assert.match(menu, /aria-current=\{item\.current\}/u);
  assert.match(menu, /aria-current=\{sub\.current\}/u);
  assert.match(styles, /\.admin-menu \[aria-current="page"\] \{[^}]*box-shadow: inset 4px 0 0 var\(--ds-navy\);[^}]*font-weight: 800;/u, "전체 메뉴 창: 왼쪽 막대 4px + 굵기");
  assert.match(styles, /\.admin-menu__item\[aria-current="true"\] \{[^}]*font-weight: 800;/u, "지금 구역: 굵기");
  // 위 알약 줄(2026-11-23 11:34:13): 지금 화면은 파란 채움 + 흰 글자 + 굵기, 지금 구역은 파란 테두리 + 굵기. 누르는 곳은 줄 높이 48px 그대로.
  assert.match(styles, /\.admin-subtabs a\[aria-current="page"\] \{[^}]*color: #fff;[^}]*font-weight: 800;/u, "알약: 흰 글자 + 굵기");
  assert.match(styles, /\.admin-subtabs a\[aria-current="page"\]::before \{[^}]*background: var\(--ad-blue\);/u, "알약: 파란 채움");
  assert.match(styles, /\.admin-subtabs a\[aria-current="true"\]::before \{ border-color: var\(--ad-blue\); box-shadow: inset 0 0 0 1px var\(--ad-blue\); \}/u, "지금 구역 알약: 파란 테두리 1px + 안쪽 파란 줄 1px");
  assert.match(styles, /\.admin-subtabs a,\r?\n\.admin-topnav a \{[^}]*min-height: 48px;/u, "알약을 누르는 곳 48px");
  assert.match(styles, /\.admin-subtabs a::before,\r?\n\.admin-topnav a::before \{[^}]*inset: 4px 0;/u, "알약 모양은 안쪽 40px(줄 높이를 늘리지 않음)");
  assert.match(styles, /\.admin-tabbar a\[aria-current\] \{[^}]*font-weight: 800;[^}]*box-shadow: inset 0 3px 0/u, "아래 탭: 위 막대 3px");
});

test("휴대폰 아래 탭은 화면 아래에 고정되고 본문 끝·키보드 포커스가 탭 뒤로 숨지 않게 띄우며, 위 제목 줄은 고정하지 않는다(사용자 선택 2026-11-18 C+D 17:24:07·CD1 17:55:44)", async () => {
  const [styles, layout] = await Promise.all([readSource("src/styles/admin.css"), readSource("src/layouts/AdminLayout.astro")]);
  assert.match(styles, /\.admin-tabbar \{ position: fixed; inset: auto 0 0;[^}]*padding-bottom: env\(safe-area-inset-bottom\);/u);
  assert.match(styles, /\.admin-tabbar a,\r?\n\.admin-tabbar button \{[^}]*min-height: 56px;/u, "아래 탭 56px(CD1)");
  // 탭 높이 56px + 8px. 본문 끝은 80px 띄우고, 첫 화면·사무소 편집의 아래 고정 저장 줄도 탭 위(56px + 10px)에 둔다.
  assert.match(
    styles,
    /@media \(max-width: 979px\) \{[^@]*html \{ scroll-padding-bottom: calc\(64px \+ env\(safe-area-inset-bottom\)\); \}[^@]*\.admin-main \{ padding-bottom: calc\(80px \+ env\(safe-area-inset-bottom\)\); \}[^@]*\.admin-editor__actions \{ bottom: calc\(66px \+ env\(safe-area-inset-bottom\)\); \}/u,
  );
  assert.match(styles, /@media \(min-width: 980px\) \{[^@]*\.admin-top__title,\r?\n\s*\.admin-top__public,\r?\n\s*\.admin-tabbar \{ display: none; \}/u, "PC는 위 한 줄(로고·알약·전체 메뉴)만(2026-11-23 11:34:13)");
  assert.match(styles, /^\.admin-bar__step,\r?\n\.admin-bar__tools,\r?\n\.admin-topnav \{ display: none; \}/mu, "휴대폰에는 PC 위 줄의 단추·구역 알약 줄이 없음");
  // 줄 밀기 단추: 마우스를 쓸 때만 보이고(손가락 화면은 줄을 직접 밂) 누르는 곳 44px, 숨겨도 자리를 지킨다. 키보드·화면 읽기 프로그램은 알약 줄을 바로 가므로 단추는 건너뛴다.
  const stepRules = styles.split("@media (min-width: 980px) and (hover: hover) and (pointer: fine) {");
  assert.equal(stepRules.length, 2, "줄 밀기 단추 덩어리는 하나, 조건은 980px 이상 + 마우스");
  assert.match(stepRules[1].slice(0, stepRules[1].indexOf("\n}")), /\.admin-bar__step \{ display: grid;[^}]*width: 44px; height: 44px;[^}]*\}[\s\S]*\.admin-bar__step\[hidden\] \{ display: grid; visibility: hidden; \}/u, "44px, 숨겨도 자리 지킴");
  assert.equal(stepRules[0].split(".admin-bar__step {").length - 1, 0, "마우스 조건 밖에서는 줄 밀기 단추를 보이게 하지 않음");
  const stepButtons = [...layout.matchAll(/<button class="admin-bar__step"[^>]*>/gu)].map((match) => match[0]);
  assert.equal(stepButtons.length, 2, "줄 밀기 단추 2개(‹ ›)");
  for (const tag of stepButtons) assert.match(tag, / tabindex="-1" aria-hidden="true" /u, "줄 밀기 단추는 Tab 차례·화면 읽기 프로그램에서 뺌");
  // 알약 그림은 꾸밈이다(이름은 옆의 글자). 화면 읽기 프로그램에 이름 없는 그림으로 잡히지 않게 한다.
  const pillIcon = await readSource("src/components/admin/AdminPillIcon.astro");
  assert.equal(pillIcon.split("<svg").length - 1, 1, "알약 그림은 svg 하나");
  assert.match(pillIcon, /<svg class="admin-pill-icon" data-pill=\{name\} viewBox="0 0 24 24" aria-hidden="true" focusable="false">/u, "알약 그림: aria-hidden·focusable=false");
  // 조밀한 PC(표 13px·누르는 곳 36px)는 "1221px 이상 + 마우스"일 때만이다(사용자 승인 2026-11-23 11:34:13). 손가락으로 쓰는 넓은 화면은 16px·44px 그대로.
  const skinAt = styles.indexOf("/* ── 새 겉모양(");
  const denseAt = styles.indexOf("@media (min-width: 1221px) and (hover: hover) and (pointer: fine) {");
  assert.ok(skinAt > 0 && denseAt > skinAt, "조밀한 PC 덩어리의 조건: 1221px 이상 + (hover: hover) + (pointer: fine)");
  assert.doesNotMatch(styles.slice(skinAt, denseAt), /(?:min-)?height: 36px|font-size: 0\.8125rem/u, "36px·13px 규칙은 조밀한 PC 덩어리 안에만");
  const dense = styles.slice(denseAt);
  for (const rule of [".admin-bar__menu { min-height: 36px;", ".admin-bar__step { width: 36px; height: 36px; }", ".work-secondary-button { min-height: 36px;", ".lg-table td { height: 36px;", ".admin-table th,\n  .admin-table td,\n  .lg-table th,\n  .lg-table td,\n  .lg-months th,\n  .lg-months td { font-size: 0.8125rem; }"]) {
    assert.ok(dense.replaceAll("\r\n", "\n").includes(rule), `조밀한 PC 덩어리 안: ${rule}`);
  }
  assert.doesNotMatch(styles, /\.admin-bar \{[^}]*position: (?:sticky|fixed)/u, "PC 위 줄도 고정하지 않음");
  assert.doesNotMatch(layout, /admin-side/u, "왼쪽 고정 목록은 없앰");
  assert.doesNotMatch(styles, /\.admin-top \{[^}]*position: (?:sticky|fixed)/u, "위 제목 줄은 고정하지 않음");
  assert.doesNotMatch(styles, /^html \{[^}]*scroll-padding-top/mu, "문서 전체 위 여백은 쓰지 않음(회귀 1회차 S2)");
  assert.match(styles, /:root \{ --admin-sticky-height: 0px;/u, "위에 고정되는 줄이 없어 0");
  assert.match(styles, /#admin-main \{ scroll-margin-top: var\(--admin-sticky-height\); \}/u, "건너뛰기 링크 대상");
  assert.match(styles, /\[data-manual-form\], \[data-history-preview\] \{ scroll-margin-top: var\(--admin-sticky-height\); \}/u, "스크립트로 옮기는 매물 편집 폼·변경 이력 미리보기(회귀 2회차 S3)");
  assert.match(styles, /\.admin-subtabs a:focus-visible,\r?\n\.admin-tabbar :focus-visible \{ outline-offset: -3px; \}/u, "잘리는 포커스 테두리는 안쪽에");
  assert.doesNotMatch(layout, /window\.scrollBy|attempts >= 3|const header =/u, "고정 머리글 포커스 보정 스크립트는 없앰(위에 고정되는 줄 없음)");
  assert.match(layout, /<dialog class="admin-sheet" aria-labelledby="admin-sheet-title" data-admin-menu-sheet>/u);
  assert.match(layout, /<button type="button" aria-haspopup="dialog" data-admin-menu-open>/u);
  assert.match(layout, /<button class="admin-bar__menu" type="button" aria-haspopup="dialog" data-admin-menu-open>전체 메뉴<\/button>/u, "PC 위 줄의 단추도 같은 전체 메뉴 창을 엶");
  assert.match(layout, /for \(const openButton of openButtons\) openButton\.addEventListener/u, "두 단추 모두");
  assert.match(layout, /openButton\.addEventListener\("click", \(\) => sheet\.showModal\(\)\);/u);
  assert.match(layout, /window\.addEventListener\("pagehide", \(\) => sheet\.close\(\)\);/u, "뒤로 가기로 돌아왔을 때 전체 메뉴 창이 열린 채 남지 않게");
  assert.match(layout, /sheet\.addEventListener\("click", \(event\) => \{\r?\n\s*if \(event\.target !== sheet\) return;[^}]*event\.clientX < box\.left[^}]*\) sheet\.close\(\);/u, "창 바깥 바탕을 누르면 닫고 창 안 여백은 그대로");
  assert.doesNotMatch(layout, /admin-write-ready|AdminApiError|fetch\(/u, "세션·쓰기 흐름은 건드리지 않음");
});

test("관리자 화면도 한글 낱말 가운데서 줄을 바꾸지 않고, 매물 현황은 1220px까지 세 줄 카드, 1221px 이상은 짧은 열을 한 줄로 둔 표다(보드 46번·F6-2)", async () => {
  const styles = await readSource("src/styles/admin.css");
  assert.match(styles, /^\.admin-body \{ word-break: keep-all; overflow-wrap: anywhere; \}/mu, "공개 화면(global.css)과 같은 값을 관리자 전체에");
  assert.match(styles, /^\.admin-body :where\(td, th\) \{ overflow-wrap: break-word; \}/mu, "표 칸은 열이 낱말보다 좁아지지 않게");
  assert.match(styles, /@media \(min-width: 1221px\) \{\r?\n\s*\.admin-table th,\r?\n\s*\.admin-table td:not\(\[data-label="매물명"\]\) \{ white-space: nowrap; \}\r?\n\s*\.admin-table th:first-child \{ width: 100%; \}/u, "1221px 이상 표: 짧은 열은 한 줄, 매물명 열이 남는 폭을 씀");
  assert.match(styles, /^\.admin-table-wrap \{ overflow-x: auto;/mu, "넓어진 표는 표만 가로로 밀림");
  // 641 ~ 1220px에서 표가 가로로 밀리던 것을 없앤다(F6-2). 표를 카드로 바꾸는 규칙과 세 줄 배치가 같은 1220px 경계를 쓴다.
  assert.match(styles, /@media \(max-width: 1220px\) \{\r?\n\s*\.admin-table-wrap \{ overflow: visible; \}/u, "1220px까지 표 감싼 칸은 가로로 밀리지 않음");
  assert.match(styles, /@media \(max-width: 1220px\) \{\r?\n\s*\.admin-table \{ max-width: 720px; \}\r?\n\s*\.admin-table tr \{[^}]*"name name name price"[^}]*"type trade date date"[^}]*"check check check action";/u, "1220px까지 세 줄 카드, 넓은 화면은 카드 목록 폭 720px까지");
  assert.doesNotMatch(styles, /@media \(m(?:in|ax)-width: 64[01]px\) \{[^@]*\.admin-table/u, "표 규칙에 옛 640px 경계가 남지 않음");
  assert.doesNotMatch(styles, /@media \(m(?:in|ax)-width: 11(?:79|80)px\) \{[^@]*\.admin-table/u, "1180 ~ 1220px에서도 표가 밀려 올린 옛 1179/1180px 경계가 남지 않음(사용자 결정 2026-11-18)");
});

test("업무 도구 결과 막대는 979px 이하에서 아래 탭 바로 위에 붙고, 막대가 보이면 본문 끝·포커스 여백을 두 막대 높이만큼 늘리며, 복사는 원래 단추를 누른다(사용자 선택 2026-11-18 CD1·F6-2)", async () => {
  const [styles, bar, fee, messages] = await Promise.all([
    readSource("src/styles/admin.css"),
    readSource("src/components/admin/WorkResultBar.astro"),
    readSource("src/pages/admin/work/fee.astro"),
    readSource("src/pages/admin/work/messages.astro"),
  ]);
  assert.match(styles, /^\.work-result-bar \{ display: none; \}/mu, "PC는 막대를 쓰지 않음");
  assert.match(styles, /@media \(max-width: 979px\) \{\r?\n\s*\.work-result-bar \{[^}]*position: fixed;[^}]*inset: auto 0 calc\(56px \+ env\(safe-area-inset-bottom\)\);[^}]*z-index: 99;[^}]*min-height: 56px;/u, "아래 탭(56px, z-index 100) 바로 위");
  assert.match(styles, /\.work-result-bar\[hidden\] \{ display: none; \}/u);
  // 아래 탭 56px + 결과 막대 56px + 8px. 본문 끝은 136px 띄운다(막대가 없을 때는 64px·80px 그대로).
  assert.match(styles, /html:has\(\.work-result-bar:not\(\[hidden\]\)\) \{ scroll-padding-bottom: calc\(120px \+ env\(safe-area-inset-bottom\)\); \}/u);
  assert.match(styles, /html:has\(\.work-result-bar:not\(\[hidden\]\)\) \.admin-main \{ padding-bottom: calc\(136px \+ env\(safe-area-inset-bottom\)\); \}/u);
  assert.match(bar, /<div class="work-result-bar__text" aria-hidden="true">/u, "결과 칸에 이미 있는 글자는 화면 읽기 도구에 다시 읽히지 않게");
  assert.match(bar, /button\.addEventListener\("click", \(\) => copy\.click\(\)\);/u, "복사는 결과 칸의 원래 단추가 처리");
  assert.match(bar, /window\.clearTimeout\(copiedTimer\);/u, "연달아 눌러도 \"복사함\" 타이머가 꼬이지 않게");
  assert.doesNotMatch(bar, /navigator\.clipboard/u, "막대는 직접 복사하지 않음");
  assert.match(styles, /\.work-ui \.admin-form-status:empty \{ position: absolute; width: 1px; height: 1px;[^}]*clip: rect\(0 0 0 0\);/u, "빈 알림 칸은 화면에서만 숨겨 첫 복사 알림도 화면 읽기 도구가 읽음");
  assert.doesNotMatch(styles, /\.admin-form-status:empty \{ display: none; \}/u);
  assert.match(styles, /\.work-ui \.work-check input \{ scroll-margin-block: 32px; \}/u, "여러 줄 체크 칸 이름표·포커스 테두리가 아래 탭에 가리지 않게(360px)");
  assert.match(fee, /<WorkResultBar tool="fee" \/>/u);
  assert.match(messages, /<WorkResultBar tool="message" \/>/u);
  // 결과 칸 안 순서: 합계 → 내역 → 복사 단추(마크업 순서가 보이는 순서·키보드 순서)
  const feeOutput = fee.match(/<section class="work-output"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.ok(feeOutput.indexOf('class="work-total"') < feeOutput.indexOf('class="work-facts"'), "합계가 내역보다 먼저");
  assert.ok(feeOutput.indexOf('class="work-facts"') < feeOutput.indexOf("data-fee-copy "), "복사 단추는 결과 칸 안, 내역 뒤");
  const messageOutput = messages.match(/<section class="work-output"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.ok(messageOutput.indexOf("data-message-count") < messageOutput.indexOf("data-message-copy"), "복사 단추는 미리보기 글자 수 바로 뒤");
  assert.match(styles, /^\.work-output \.work-doc__action \.work-secondary-button \{ flex-basis: 320px; \}/mu, "좁은 결과 칸(넓은 화면 포함)에서 문자 앱 단추 두 개는 세로로 쌓여 한 줄씩(사용자 결정 2026-11-18)");
  assert.match(messages, /preview\.addEventListener\("focus", \(\) => preview\.scrollIntoView\(\{ block: "nearest" \}\)\);/u, "Tab으로 간 미리보기가 화면 위로 잘리지 않게(날개-2 TU-23)");
  assert.match(messages, /memo\?\.addEventListener\("focus", \(\) => \{[^}]*if \(lastInputKeyboard\) memo\.scrollIntoView\(\{ block: "nearest" \}\);/u, "Tab으로 간 특약 메모 칸도 화면 아래로 잘리지 않게, 마우스·손가락으로 누를 때는 움직이지 않게(날개-2 TU-23)");
  assert.match(messages, /document\.addEventListener\("pointerdown", \(\) => \{ lastInputKeyboard = false; \}, true\);/u, "마지막 입력이 마우스·손가락이면 옮기지 않음");
});

test("관리자 화면의 색 이름(--ds-*)은 공개 화면(global.css)과 이름이 같고, 값은 관리자 화면만의 새 겉모양 값이다(사용자 승인 2026-11-23 11:34:13)", async () => {
  const [globalStyles, adminStyles] = await Promise.all([readSource("src/styles/global.css"), readSource("src/styles/admin.css")]);
  const tokens = (block) => Object.fromEntries([...block.matchAll(/(--ds-[a-z0-9-]+):\s*([^;]+);/gu)].map(([, name, value]) => [name, value.trim().toLowerCase()]));
  const publicBlock = globalStyles.match(/:where\(body:not\(\.admin-body\)\) \{([^}]*)\}/u)?.[1] ?? "";
  const adminBlock = adminStyles.match(/^\.admin-body \{([^}]*--ds-[^}]*)\}/mu)?.[1] ?? "";
  assert.equal(Object.keys(tokens(publicBlock)).length, 8, "공개 화면 색 이름 8개");
  assert.deepEqual(Object.keys(tokens(adminBlock)).sort(), Object.keys(tokens(publicBlock)).sort(), "이름이 어긋나면 한쪽 화면에서 색이 빠짐");
  // 공개 화면 값은 관리자 새 겉모양과 상관없이 그대로다.
  assert.deepEqual(tokens(publicBlock), {
    "--ds-paper": "#ffffff", "--ds-paper-2": "#f1f3f5", "--ds-edge": "#e1e4e8", "--ds-ink": "#141414",
    "--ds-navy": "#132a3e", "--ds-ink-soft": "#46494f", "--ds-stamp": "#b3261e", "--ds-field-edge": "#858a91",
  });
  assert.deepEqual(tokens(adminBlock), {
    "--ds-paper": "#ffffff", "--ds-paper-2": "#f3f4f6", "--ds-edge": "#e3e6ea", "--ds-ink": "#1f2329",
    "--ds-navy": "#232a33", "--ds-ink-soft": "#5b6472", "--ds-stamp": "#c62828", "--ds-field-edge": "#858a91",
  });
  assert.match(globalStyles, /:where\(body:not\(\.admin-body\)\) \{/u, "공개 화면 값은 관리자 화면에 닿지 않음");
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
  // 복사가 막혀 미리보기로 갈 때 위쪽이 화면 위로 잘리지 않게 직접 옮긴다(보드 35번). 선택·안내 문구는 그대로
  assert.match(page, /preview\.focus\(\{ preventScroll: true \}\);\r?\n\s*preview\.select\(\);/u);
  assert.match(page, /if \(previewBox\.top < \(Number\.parseFloat\(getComputedStyle\(preview\)\.scrollMarginTop\) \|\| 0\)\) preview\.scrollIntoView\(\{ block: "start", behavior \}\);/u, "위쪽이 위 여백보다 위면 여백 아래로");
  assert.match(page, /else if \(previewBox\.bottom > window\.innerHeight\) preview\.scrollIntoView\(\{ block: "nearest", behavior \}\);/u, "화면 아래로 벗어나면 보이게");
  const styles = await readSource("src/styles/admin.css");
  assert.match(styles, /\[data-message-preview\] \{ scroll-margin-top: calc\(var\(--admin-sticky-height\) \+ 8px\); \}/u, "위 고정 줄 아래 8px");
});

test("가로로 미는 알약 줄(업무 도구·네이버 매물 아래 단계, PC 구역 줄)은 키보드로 간 링크만 그 줄 안에서 가로로 밀고 문서는 세로로 움직이지 않는다(보드 34번)", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.match(layout, /const strips = "\.admin-subtabs, \.admin-topnav";/u);
  assert.match(layout, /!target\.matches\(":focus-visible"\) \|\| performance\.now\(\) - stripPointerAt < 600\) return;/u, "마우스·손가락으로 누를 때는 밀지 않음");
  assert.match(layout, /strip\.scrollBy\(\{ left: delta, behavior: stripMotion\.matches \? "auto" : "smooth" \}\)/u, "줄의 가로 위치만 바꿈");
  const stripBlock = layout.slice(layout.indexOf("const strips ="), layout.indexOf("</script>", layout.indexOf("const strips =")));
  assert.doesNotMatch(stripBlock, /scrollIntoView|window\.scroll/u, "문서 세로 스크롤을 건드리지 않음");
});
