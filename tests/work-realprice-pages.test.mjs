// 실거래가·실거래가 설정 화면(P1-d) 정적 검사. 화면 동작은 e2e/admin-realprice.spec.mjs(가짜 API)가 본다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADMIN_HELP_FACTS } from "../src/lib/admin-help.mjs";
import { REALPRICE_VIEW_PAGE_SIZE } from "../src/lib/work/realprice-view.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const PAGES = ["src/pages/admin/work/realprice/index.astro", "src/pages/admin/work/realprice/settings.astro"];
const SCRIPTS = ["src/lib/work-realprice-client.ts", "src/lib/work-realprice-dom.ts", "src/lib/work/realprice-view.mjs"];
// 미디어 덩어리 하나(@media … { … })를 잘라 낸다. 안쪽 괄호가 한 겹인 이 파일의 규칙 모양을 기준으로 한다.
const mediaBlocks = (css, query) => {
  const blocks = [];
  let at = css.indexOf(`@media ${query} {`);
  while (at >= 0) {
    let depth = 0;
    let end = at;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      if (css[end] === "}" && (depth -= 1) === 0) break;
    }
    blocks.push(css.slice(at, end + 1));
    at = css.indexOf(`@media ${query} {`, end);
  }
  return blocks.join("\n");
};

test("두 화면은 관리 틀·사용법 상자를 쓰고, form 없이 입력칸마다 autocomplete=off", async () => {
  for (const path of PAGES) {
    const source = await readSource(path);
    assert.match(source, /import AdminLayout from "\.\.\/\.\.\/\.\.\/\.\.\/layouts\/AdminLayout\.astro";/u, path);
    assert.doesNotMatch(source, /<form\b/u, `${path}: Enter로 보내는 form 없음`);
    const fields = source.match(/<(?:input|select)\b[^>]*>/gu) ?? [];
    assert.ok(fields.length > 0, path);
    for (const field of fields) assert.match(field, /autocomplete="off"/u, `${path}: ${field}`);
  }
});

test("서버 요청은 work-realprice-client.ts 한 곳에서만, 브라우저 저장·주소 바꾸기·HTML 끼워 넣기는 없다", async () => {
  const forbidden = [
    ["localStorage", /localStorage/u],
    ["sessionStorage", /sessionStorage/u],
    ["indexedDB", /indexedDB/iu],
    ["cookie", /document\.cookie/u],
    ["history", /\b(?:pushState|replaceState)\b/u],
    ["location write", /\blocation(?:\.(?:href|hash|search|pathname))?\s*=(?!=)/u],
    ["innerHTML", /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML/u],
    ["set:html", /set:html/u],
  ];
  for (const path of [...PAGES, ...SCRIPTS]) {
    const source = await readSource(path);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${path}: ${name}`);
    if (path !== "src/lib/work-realprice-client.ts") assert.doesNotMatch(source, /\bfetch\s*\(/u, `${path}: fetch는 클라이언트 파일에서만`);
  }
  const client = await readSource("src/lib/work-realprice-client.ts");
  assert.match(client, /"X-Admin-CSRF": session\.csrfToken/u, "쓰기는 업무 세션 보안 토큰을 보냄");
  assert.match(client, /credentials: "same-origin"/u);
  assert.match(client, /cache: "no-store"/u);
});

test("화면 글자 속 숫자는 서버 값과 같다(30건 더 보기·10분마다·최근 4개월·약 2시간·최근 3년)", async () => {
  const [index, settings] = await Promise.all(PAGES.map(readSource));
  assert.equal(REALPRICE_VIEW_PAGE_SIZE, ADMIN_HELP_FACTS.realpricePageSize);
  assert.ok(index.includes(`${REALPRICE_VIEW_PAGE_SIZE}건 더 보기`), "더 보기 단추 글자 = 한 번에 받는 수");
  assert.ok(index.includes(`${ADMIN_HELP_FACTS.realpriceFetchMinutes}분마다 조금씩 받아 둡니다`));
  assert.ok(settings.includes(`최근 ${ADMIN_HELP_FACTS.realpriceRefreshMonths}개월 자료(매매·전월세·분양권)`));
  assert.ok(settings.includes(`${ADMIN_HELP_FACTS.realpriceFetchMinutes}분마다 하나씩 받아 약 ${ADMIN_HELP_FACTS.realpriceRefreshHours}시간 안에 끝납니다`));
  assert.ok(settings.includes(`최근 ${ADMIN_HELP_FACTS.realpriceSearchYears}년 매매 기준`));
  assert.ok(settings.includes(`최근 ${ADMIN_HELP_FACTS.realpriceSearchYears}년 매매 \${`), "찾기 결과 줄");
});

test("표시는 색이 아니라 글자로: 신고가·해제·새로 들어옴·직거래, 서버 값은 textContent로만", async () => {
  const index = await readSource(PAGES[0]);
  for (const text of ['tag("신고가", "rt-tag--high")', 'tag("해제", "rt-tag--cancel")', 'tag("새로 들어옴", "rt-tag--new rt-only-table")', 'tag("새로 들어옴", "rt-tag--new")', 'direct.textContent = "직거래"']) {
    assert.ok(index.includes(text), text);
  }
  assert.match(index, /strong\.textContent = item\.aptName \|\| "단지명 없음";/u);
  assert.match(index, /if \(request !== requestSeq\) return;/u, "늦게 온 응답은 버림");
});

test("979px 이하 B안·980px 이상 0안, 1220px 이하 카드·1221px 이상 표(사용자 결정 2026-11-19 12:58:48)", async () => {
  const css = await readSource("src/styles/admin.css");
  const rt = css.slice(css.indexOf("/* 실거래가·실거래가 설정(단계 P, P1-d)"));
  assert.ok(rt.length > 1000, "실거래가 규칙은 admin.css 끝에 있음");
  const narrow = mediaBlocks(rt, "(max-width: 979px)");
  const wide = mediaBlocks(rt, "(min-width: 980px)");
  assert.match(narrow, /\.rt-lead--full \{ display: none; \}/u, "휴대폰은 설명 한 줄");
  assert.match(narrow, /\.rt-sum > summary \{ display: grid;/u, "휴대폰은 상태 한 줄 요약");
  assert.match(narrow, /\.rt-sum:not\(\[open\]\) \+ \.rt-backfill \{ display: none; \}/u, "휴대폰은 과거 채우기 막대를 '자세히' 안에(날개대장 검토)");
  assert.match(narrow, /\.rt-fold > summary \{ display: flex;/u, "휴대폰은 거르기 접기");
  assert.match(narrow, /\.rt-mode \.work-row__label \{ position: absolute;/u, "보기 이름표는 화면 읽기 프로그램에만");
  assert.match(wide, /\.rt-sum > summary,\r?\n\s*\.rt-sum__lead \{ display: none; \}/u, "PC는 상태 칸을 늘 펼침");
  assert.match(wide, /\.rt-fold > summary \{ display: none; \}/u, "PC는 거르기를 늘 펼침");
  const cards = mediaBlocks(rt, "(max-width: 1220px)");
  const table = mediaBlocks(rt, "(min-width: 1221px)");
  assert.match(cards, /\.rt-table tr \{ display: block;/u);
  assert.match(cards, /\.rt-table tbody tr td\.rt-name:first-child \{ display: inline; padding-bottom: 0; \}/u, "공용 표 첫 칸 블록 처리를 받지 않음");
  assert.match(table, /\.rt-only-card \{ display: none; \}/u);
  assert.doesNotMatch(rt, /#(?!8a6424\b)[0-9a-f]{3,8}\b/iu, "새 색은 --ds-* 이름만(경고 금색 #8a6424만 예외)");

  const index = await readSource(PAGES[0]);
  assert.match(index, /const wide = window\.matchMedia\("\(min-width: 980px\)"\);/u, "CSS와 같은 경계");
  assert.match(index, /sum\.open = wide\.matches \|\| problem;/u, "휴대폰은 문제가 있을 때만 상태를 펼쳐 둠");
  assert.match(index, /fold\.open = wide\.matches;/u);
});

test("메뉴: 업무 도구 아래 단계에 '실거래가'를 더하고, 미리 그리기 prerender 목록과 업무 도구 첫 화면 도구 3개는 그대로(TK-37)", async () => {
  const [layout, workIndex] = await Promise.all([readSource("src/layouts/AdminLayout.astro"), readSource("src/pages/admin/work/index.astro")]);
  assert.match(layout, /\{ href: "\/admin\/work\/schedule\/", label: "계약 일정" \},\r?\n\s*\{ href: "\/admin\/work\/realprice\/", label: "실거래가" \},\r?\n\s*\],/u);
  assert.match(layout, /const prerenderPages = \["\/admin\/work\/", "\/admin\/work\/fee\/", "\/admin\/work\/messages\/", "\/admin\/work\/schedule\/"\];/u);
  assert.doesNotMatch(layout, /\/admin\/work\/realprice\/settings\//u, "설정은 메뉴에 따로 넣지 않음(실거래가 화면에서 들어감)");
  assert.match(
    layout,
    /const subCurrentState = \(sectionHref: string, href: string\): "page" \| "true" \| undefined =>\r?\n\s*currentPath === href \? "page" : href !== sectionHref && currentPath\.startsWith\(href\) \? "true" : undefined;/u,
    "설정 화면에서는 '실거래가'가 지금 구역(true), 구역 첫 주소는 true로 보지 않음",
  );
  const tools = [...workIndex.matchAll(/href: "(\/admin\/work\/[^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(tools, ["/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/"], "업무 도구 첫 화면 도구 3개 그대로");
  const css = await readSource("src/styles/admin.css");
  assert.match(css, /\.admin-subtabs a\[aria-current="true"\] \{[^}]*font-weight: 800;/u);
  assert.match(css, /\.admin-menu__subitem\[aria-current="true"\] \{[^}]*font-weight: 800;/u);
});
