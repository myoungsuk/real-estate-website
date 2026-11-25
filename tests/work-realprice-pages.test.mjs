// 실거래가·실거래가 설정 화면(P1-d) 정적 검사. 화면 동작은 e2e/admin-realprice.spec.mjs(가짜 API)가 본다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ADMIN_HELP_FACTS } from "../src/lib/admin-help.mjs";
import { REALPRICE_VIEW_PAGE_SIZE } from "../src/lib/work/realprice-view.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const PAGES = ["src/pages/admin/work/realprice/index.astro", "src/pages/admin/work/realprice/settings.astro", "src/pages/admin/work/realprice/promo.astro"];
const SCRIPTS = ["src/lib/work-realprice-client.ts", "src/lib/work-realprice-dom.ts", "src/lib/work/realprice-view.mjs", "src/lib/work-realprice-card.ts", "src/lib/work/realprice-promo.mjs", "src/lib/work-card-draw.ts", "src/lib/work-realprice-detail.ts", "src/lib/work/realprice-complex-view.mjs"];
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

test("세 화면(실거래가·설정·홍보물)은 관리 틀·사용법 상자를 쓰고, form 없이 입력칸마다 autocomplete=off", async () => {
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

test("화면 글자 속 숫자는 서버 값과 같다(30건 더 보기·10분마다·최근 4개월·약 50분·최근 3년)", async () => {
  const [index, settings] = await Promise.all(PAGES.map(readSource));
  assert.equal(REALPRICE_VIEW_PAGE_SIZE, ADMIN_HELP_FACTS.realpricePageSize);
  assert.ok(index.includes(`${REALPRICE_VIEW_PAGE_SIZE}건 더 보기`), "더 보기 단추 글자 = 한 번에 받는 수");
  assert.ok(index.includes(`${ADMIN_HELP_FACTS.realpriceFetchMinutes}분마다 조금씩 받아 둡니다`));
  assert.ok(settings.includes(`최근 ${ADMIN_HELP_FACTS.realpriceRefreshMonths}개월 자료(매매·전월세·분양권)`));
  assert.ok(settings.includes(`${ADMIN_HELP_FACTS.realpriceFetchMinutes}분마다 나눠 받아 약 ${ADMIN_HELP_FACTS.realpriceRefreshMinutes}분 안에 끝납니다`));
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

test("D안: 모든 폭에서 상태 한 줄(문제 있을 때만 펼침)·찾기칸·거르기 단추 6개·'n건 보는 중' 줄, 1220px 이하 카드·1221px 이상 표(운영자 결정 2026-11-20 13:36:35)", async () => {
  const css = await readSource("src/styles/admin.css");
  const rt = css.slice(css.indexOf("/* 실거래가·실거래가 설정(단계 P, P1-d·P1-f)"));
  assert.ok(rt.length > 1000, "실거래가 규칙은 admin.css 끝에 있음");
  const narrow = mediaBlocks(rt, "(max-width: 979px)");
  const wide = mediaBlocks(rt, "(min-width: 980px)");
  assert.match(rt, /^\.rt-sum > summary \{ display: grid;/mu, "상태 한 줄 요약은 모든 폭(미디어 덩어리 밖)");
  assert.doesNotMatch(rt, /\.rt-fold|\.rt-lead|\.rt-wide-only|\.rt-narrow-only/u, "B안·0안 접기·설명 줄·폭별 숨김 규칙은 지움");
  assert.match(narrow, /\.rt-sum:not\(\[open\]\) \+ \.rt-backfill \{ display: none; \}/u, "휴대폰은 과거 채우기 막대를 '자세히' 안에(날개대장 검토)");
  assert.match(narrow, /\.rt-mode \.work-row__label \{ position: absolute;/u, "보기 이름표는 화면 읽기 프로그램에만");
  assert.match(rt, /\.rt-find input \{[^}]*min-height: 48px;/u, "찾기칸 48px");
  assert.match(rt, /\.rt-chip \{[^}]*min-height: 44px;/u, "거르기 단추 44px");
  assert.match(rt, /\.rt-chip--select select \{ position: absolute; inset: 0;[^}]*opacity: 0;/u, "기간·평형·금액은 단추 위에 기본 고르기 목록을 덮음");
  assert.match(rt, /\.rt-take \{[^}]*min-height: 44px;/u, "다 담기 단추 44px");
  assert.match(rt, /\.rt-pick-button \{[^}]*min-height: 44px;/u, "거래마다 담기 단추 44px");
  assert.match(wide, /\.rt-top \{ display: grid;/u, "PC는 찾기칸·단추를 한 줄에");
  const cards = mediaBlocks(rt, "(max-width: 1220px)");
  const table = mediaBlocks(rt, "(min-width: 1221px)");
  assert.match(cards, /\.rt-table tr \{ display: block;/u);
  assert.match(cards, /\.rt-table tbody tr td\.rt-name:first-child \{ display: inline; padding-bottom: 0; \}/u, "공용 표 첫 칸 블록 처리를 받지 않음");
  assert.match(table, /\.rt-only-card \{ display: none; \}/u);
  assert.doesNotMatch(rt, /#(?!8a6424\b)[0-9a-f]{3,8}\b/iu, "새 색은 --ds-* 이름만(경고 금색 #8a6424만 예외)");

  const index = await readSource(PAGES[0]);
  assert.doesNotMatch(index, /window\.matchMedia\(/u, "폭에 따라 펼치는 코드 없음(휴대폰·PC 같은 순서)");
  assert.match(index, /sum\.open = problem;/u, "문제가 있을 때만 상태를 펼쳐 둠");
  assert.match(index, /<input id="rt-q" type="search" maxlength="30"/u, "찾는 말 30자(서버 q 상한과 같음)");
  for (const marker of ['data-rt-toggle="highOnly">신고가만</button>', 'data-rt-toggle="presale">분양권만</button>', 'aria-expanded="false" aria-controls="rt-more-filters" data-rt-more-toggle>더 보기</button>', '<input type="radio" name="rt-mode" value="major"']) {
    assert.ok(index.includes(marker), marker);
  }
});

test("메뉴: 업무 도구 아래 단계에 '실거래가'를 더하고(2026-11-20 글 초안·홍보 종이·매물 안내지가 뒤에 붙음), 미리 그리기 prerender 목록과 업무 도구 첫 화면 도구 3개는 그대로(TK-37)", async () => {
  const [layout, workIndex] = await Promise.all([readSource("src/layouts/AdminLayout.astro"), readSource("src/pages/admin/work/index.astro")]);
  // 2026-11-21 메뉴 B안: 상담 도구(…계약 일정·실거래가)와 홍보 만들기(글 초안·홍보 종이·매물 안내지) 묶음
  assert.match(layout, /\{ href: "\/admin\/work\/schedule\/", label: "계약 일정", group: "상담 도구" \},\r?\n\s*\{ href: "\/admin\/work\/realprice\/", label: "실거래가", group: "상담 도구" \},\r?\n\s*\{ href: "\/admin\/work\/blog\/", label: "글 초안", group: "홍보 만들기" \},\r?\n\s*\{ href: "\/admin\/work\/paper\/", label: "홍보 종이", group: "홍보 만들기" \},\r?\n\s*\{ href: "\/admin\/work\/listing-paper\/", label: "매물 안내지", group: "홍보 만들기" \},\r?\n\s*\],/u);
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
  assert.match(css, /@media \(max-width: 979px\) \{[^@]*\.rt-notice--in-sum \{ display: none; \}/u, "979px 이하: 신고가 준비 안내는 상태 줄로 옮김");
  assert.match(css, /\.admin-menu__subitem\[aria-current="true"\] \{[^}]*font-weight: 800;/u);
});

test("P1-e 홍보물: 목록 고르기는 메모리만(최대 6건·해제 막음), 홍보물 화면은 ids로 다시 읽고, 그림은 data 주소 PNG, A4는 인쇄 CSS", async () => {
  const [index, promo, card, promoLib, css, draw, promoLoad] = await Promise.all([
    readSource(PAGES[0]),
    readSource(PAGES[2]),
    readSource("src/lib/work-realprice-card.ts"),
    readSource("src/lib/work/realprice-promo.mjs"),
    readSource("src/styles/admin.css"),
    readSource("src/lib/work-card-draw.ts"),
    readSource("src/lib/work/realprice-promo-load.mjs"),
  ]);
  assert.match(index, /<th scope="col" class="rt-pick-col">담기<\/th>/u, "표 끝 열");
  assert.match(index, /const view = takeButtonView\(shown, new Set\(picked\.keys\(\)\)\);/u, "'다 담기'는 보이는 거래만(realprice-promo.mjs)");
  assert.match(index, /const picked = new Map<string, Trade>\(\);/u, "고른 거래는 화면 메모리에만");
  assert.match(index, /box\.disabled = !selectable \|\| \(!box\.checked && picked\.size >= PROMO_IDS_MAX\);/u, "해제는 막고, 다 고르면 나머지를 잠금");
  assert.match(index, /const href = promoHref\(\[\.\.\.picked\.keys\(\)\]\);\r?\n\s*if \(href\) promoLink\.href = href;/u, "링크 주소로만 넘김(주소 바꾸기 없음)");
  // 세 규칙은 홍보물 화면과 목록 오른쪽 미리보기 칸(D-3)이 같이 쓰는 공용 모듈(realprice-promo-load.mjs)에 있다.
  for (const [name, source] of [["홍보물 화면", promo], ["미리보기 칸", index]]) {
    assert.match(source, /loaded = await loadPromoTrades\(readWork, ids, office\);/u, `${name}: 공용 모듈로 다시 읽음`);
  }
  assert.match(promoLoad, /await read\("\/realprice\/trades", `ids=\$\{ids\.join\(","\)\}`\);/u, "고른 ID로 다시 읽음");
  assert.match(promoLoad, /const selection = promoSelection\(data\);/u, "해제·찾지 못한 거래는 빼고 알림");
  assert.match(promoLoad, /blocked: promoBlockReason\(input\)/u, "명시사항·받은 시각이 없으면 막음");
  assert.match(promo, /link\.download = name;/u);
  assert.match(promo, /<div class="rt-print-sheet" data-promo-sheet><\/div>/u);
  assert.match(card, /canvas\.toDataURL\("image\/png"\)/u, "CSP img-src에 blob이 없어 data 주소");
  assert.doesNotMatch(`${card}\n${promo}\n${index}`, /createObjectURL|blob:/u);
  // 로고 읽기는 업무 카드 공통 파일로 옮겼다(보드 45번 C). 카드는 그 함수를 가져다 쓴다.
  assert.match(draw, /export const LOGO_SRC = "\/images\/brand\/leaders-city-happy-logo\.webp";/u, "같은 출처 로고(canvas가 오염되지 않음)");
  assert.match(card, /import \{[^}]*\bloadLogo\b[^}]*\} from "\.\/work-card-draw";/u, "카드는 공통 로고 읽기를 씀");
  assert.doesNotMatch(`${card}\n${promoLib}`, /aptDong|jibun/u, "카드·글에 동 번호·지번 칸을 쓰지 않음(DEC-WT-22)");
  const print = mediaBlocks(css, "print");
  assert.match(print, /@page \{ size: A4 portrait;/u);
  assert.match(print, /\.admin-body:has\(\.rt-print-sheet\) :is\(\.skip-link, \.admin-bar, \.admin-top, \.admin-subtabs, \.admin-tabbar\) \{ display: none !important; \}/u, "메뉴 숨김");
  assert.match(print, /\.rt-promo > :not\(\.rt-print-sheet\) \{ display: none !important; \}/u, "단추·설명 숨김");
  assert.match(css, /\.rt-print-sheet \{ display: none; \}/u, "화면에서는 인쇄 칸을 숨김");
});
