import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_HELP_FACTS,
  ADMIN_HELP_GUIDE,
  ADMIN_PAGE_HELP,
  extractHelpLabels,
  splitHelpText,
} from "../src/lib/admin-help.mjs";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

// 사용법 문구 자체와 그 문구를 그리는 파일은 찾을 곳에서 뺀다. 넣으면 문구가 자기 자신과 맞아떨어져 시험이 늘 통과한다.
const HELP_FILES = new Set([
  "src/lib/admin-help.mjs",
  "src/components/admin/AdminPageHelp.astro",
  "src/components/admin/AdminHelpText.astro",
  "src/pages/admin/help/index.astro",
]);

// 화면에서 글자를 이어 붙여 만드는 단추 이름. 원본에 이 조각이 모두 있어야 한다(이름을 바꾸면 조각도 바뀌어 시험이 실패한다).
const COMPOSED_LABELS = {
  "새 인스타그램": ["newButton.textContent = `새 ${label}`", ': "인스타그램";'],
  "선택 ○건 확인 완료": ["`선택 ${selectedCount.toLocaleString(\"ko-KR\")}건 확인 완료`"],
};

const routeOf = (file) => {
  const path = file.replaceAll("\\", "/").replace(/\.astro$/u, "");
  return `/admin/${path === "index" ? "" : `${path.replace(/\/?index$/u, "")}/`}`;
};

async function exists(url) {
  try {
    return (await stat(url)).isFile();
  } catch {
    return false;
  }
}

async function resolveImport(fromPath, specifier) {
  const base = new URL(specifier, new URL(fromPath, root));
  const candidates = [base, ...["ts", "mjs", "js", "astro", "json"].map((ext) => new URL(`${base.href}.${ext}`))];
  for (const candidate of candidates) {
    if (await exists(candidate)) return decodeURIComponent(candidate.href.slice(root.href.length));
  }
  return null;
}

// 화면 원본과, 그 화면이 상대 경로로 불러오는 부품·스크립트·자료(src 안)를 모두 모은다.
async function collectScreenSources(entryPath) {
  const seen = new Set();
  const queue = [entryPath];
  let text = "";
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path) || HELP_FILES.has(path)) continue;
    seen.add(path);
    const source = await readSource(path);
    text += `\n${source}`;
    for (const match of source.matchAll(/(?:import|from)\s*["'](\.{1,2}\/[^"']+)["']/gu)) {
      if (match[1].endsWith(".css")) continue;
      const resolved = await resolveImport(path, match[1]);
      if (resolved?.startsWith("src/")) queue.push(resolved);
    }
  }
  return text;
}

async function listAdminPages() {
  const pagesDir = new URL("src/pages/admin/", root);
  return (await readdir(pagesDir, { recursive: true }))
    .map((name) => name.replaceAll("\\", "/"))
    .filter((name) => name.endsWith(".astro") && !name.startsWith("help/"))
    .sort();
}

async function screenSourceMap() {
  const map = new Map();
  for (const file of await listAdminPages()) map.set(routeOf(file), await collectScreenSources(`src/pages/admin/${file}`));
  return map;
}

function labelFound(label, sources) {
  if (sources.includes(label)) return true;
  const pieces = COMPOSED_LABELS[label];
  return Boolean(pieces) && pieces.every((piece) => sources.includes(piece));
}

const blockTexts = (block) => {
  if (block.type === "steps" || block.type === "list") return block.items;
  if (block.type === "table") return [...block.head, ...block.rows.flat()];
  if (block.type === "note") return [block.title, block.text];
  return [block.text];
};

const guideSections = ADMIN_HELP_GUIDE.flatMap((group) => group.sections);

test("관리 화면마다 제목 아래에 자기 주소의 '이 화면 사용법' 상자가 한 개씩 있다", async () => {
  const pages = await listAdminPages();
  assert.equal(pages.length, 23, "관리 화면 23개(사용 안내 화면 제외, 2026-11-19 실거래가·실거래가 설정, 2026-11-20 홍보물 만들기·글 초안·홍보 종이·매물 안내지, 2026-11-21 손님·손님 카드·메모 창고·매출장부, 2026-11-22 할 일 추가)");
  const routes = [];
  for (const file of pages) {
    const source = await readSource(`src/pages/admin/${file}`);
    const route = routeOf(file);
    routes.push(route);
    const boxes = [...source.matchAll(/<AdminPageHelp page="([^"]+)" \/>/gu)].map((match) => match[1]);
    assert.deepEqual(boxes, [route], `${file}: 상자는 한 개, page 값은 화면 주소`);
    assert.match(source, /import AdminPageHelp from "[./]+components\/admin\/AdminPageHelp\.astro";/u, file);
    const titleAt = source.indexOf("<h1");
    const boxAt = source.indexOf("<AdminPageHelp");
    assert.ok(titleAt > 0 && boxAt > titleAt, `${file}: 상자는 제목(h1) 뒤`);
    const between = source.slice(titleAt, boxAt);
    assert.ok(!/<(?:section|form)\b/u.test(between), `${file}: 제목과 상자 사이에 다른 칸(section·form)이 없음`);
  }
  assert.deepEqual(Object.keys(ADMIN_PAGE_HELP).sort(), routes.sort(), "문구가 있는 화면 = 실제 관리 화면");
});

test("상자 문구는 화면마다 3 ~ 6단계와 주의 1 ~ 2줄이고, 자세한 안내 위치가 사용 안내 화면에 있다", () => {
  const ids = new Set(guideSections.map((section) => section.id));
  assert.equal(ids.size, guideSections.length, "사용 안내 칸 id는 겹치지 않음");
  for (const [route, help] of Object.entries(ADMIN_PAGE_HELP)) {
    assert.ok(help.steps.length >= 3 && help.steps.length <= 6, `${route}: 단계 ${help.steps.length}개`);
    assert.ok(help.cautions.length >= 1 && help.cautions.length <= 2, `${route}: 주의 ${help.cautions.length}줄`);
    assert.ok(ids.has(help.anchor), `${route}: /admin/help/#${help.anchor}가 사용 안내 화면에 있음`);
    for (const text of [...help.steps, ...help.cautions]) assert.equal(text.split("'").length % 2, 1, `${route}: 작은따옴표 짝이 맞음 — ${text}`);
  }
  for (const section of guideSections) {
    for (const block of section.blocks) {
      for (const text of blockTexts(block)) assert.equal(text.split("'").length % 2, 1, `${section.id}: 작은따옴표 짝이 맞음 — ${text}`);
    }
  }
});

test("상자와 사용 안내에 작은따옴표로 적은 단추·칸 이름은 그 화면 원본에 실제로 있다", async () => {
  const sources = await screenSourceMap();
  const allSources = [...sources.values()].join("\n")
    + (await Promise.all(["worker/admin-api.mjs", "worker/admin-session.mjs", "worker/github-content.mjs", "scripts/content-validation.mjs"]
      .map((path) => readSource(path).catch(() => "")))).join("\n");
  const missing = [];
  let checked = 0;
  for (const [route, help] of Object.entries(ADMIN_PAGE_HELP)) {
    const screen = sources.get(route);
    for (const text of [...help.steps, ...help.cautions]) {
      for (const label of extractHelpLabels(text)) {
        checked += 1;
        if (!labelFound(label, screen)) missing.push(`${route} 상자: '${label}'`);
      }
    }
  }
  for (const section of guideSections) {
    const screen = section.screens === "all" ? allSources : section.screens.map((route) => sources.get(route) ?? "").join("\n");
    assert.ok(screen.length > 0, `${section.id}: 찾을 화면이 있음`);
    for (const block of section.blocks) {
      for (const text of blockTexts(block)) {
        for (const label of extractHelpLabels(text)) {
          checked += 1;
          if (!labelFound(label, screen)) missing.push(`사용 안내 #${section.id}: '${label}'`);
        }
      }
    }
  }
  assert.deepEqual(missing, [], "화면에 없는 이름(단추 이름을 바꿨으면 src/lib/admin-help.mjs도 고침)");
  assert.ok(checked >= 150, `확인한 이름 ${checked}개`);
});

test("사용 안내 숫자는 작업 예약·서버·화면 코드의 같은 값과 맞다", async () => {
  const [bankWorkflow, externalWorkflow, client, githubContent, deployment] = await Promise.all([
    readSource(".github/workflows/sync-bank-listings.yml"),
    readSource(".github/workflows/sync-external-content.yml"),
    readSource("src/lib/admin-content-client.ts"),
    readSource("worker/github-content.mjs"),
    readSource("worker/deployment-status.mjs"),
  ]);
  const [, minute, utcHour] = /cron: "(\d+) (\d+) \* \* \*"/u.exec(bankWorkflow) ?? [];
  const kstHour = (Number(utcHour) + 9) % 24;
  assert.equal(ADMIN_HELP_FACTS.bankSyncTime, `밤 ${kstHour}시 ${Number(minute)}분`, "부동산뱅크 자동 받기 시각(UTC + 9시간)");
  assert.match(externalWorkflow, /cron: "\d+ \* \* \* \*"/u, "블로그·유튜브 동기화는 매시간");
  assert.equal(ADMIN_HELP_FACTS.externalSyncInterval, "매시간");
  assert.match(client, new RegExp(`new URLSearchParams\\(\\{ limit: "${ADMIN_HELP_FACTS.historyLimit}" \\}\\)`, "u"), "화면이 요청하는 이력 개수");
  assert.match(githubContent, new RegExp(`const MAX_HISTORY_LIMIT = ${ADMIN_HELP_FACTS.historyLimit};`, "u"), "서버 이력 개수 한도");
  assert.match(deployment, new RegExp(`pollAfterMs: state === "deploying" \\? ${ADMIN_HELP_FACTS.deploymentPollSeconds}_000 : null`, "u"), "배포 중 다시 확인 간격");
  assert.match(deployment, new RegExp(`const DEPLOYMENT_DELAY_MS = ${ADMIN_HELP_FACTS.deploymentDelayMinutes} \\* 60 \\* 1000;`, "u"), "배포 지연 기준");
  assert.match(client, new RegExp(`approximateBytes > ${ADMIN_HELP_FACTS.imageMaxMegabytes} \\* 1024 \\* 1024`, "u"), "화면 사진 크기 한도");
  assert.match(githubContent, new RegExp(`const MAX_IMAGE_BYTES = ${ADMIN_HELP_FACTS.imageMaxMegabytes} \\* 1024 \\* 1024;`, "u"), "서버 사진 크기 한도");
});

test("실거래가 사용 안내 숫자는 서버 상수·작업 예약과 맞다", async () => {
  const [query, store, wrangler] = await Promise.all([
    import("../worker/realprice-query.mjs"),
    import("../worker/realprice-store.mjs"),
    readSource("wrangler.jsonc"),
  ]);
  const facts = ADMIN_HELP_FACTS;
  assert.equal(facts.realpriceFetchMinutes, store.REALPRICE_CRON_MINUTES, "받는 간격");
  assert.ok(wrangler.includes(`"crons": ["*/${facts.realpriceFetchMinutes} * * * *"]`), "Worker Cron 간격");
  assert.equal(facts.realpricePageSize, query.REALPRICE_TRADES_LIMIT_DEFAULT, "한 번에 보이는 거래 수");
  assert.equal(facts.realpriceWatchMax, query.REALPRICE_WATCH_MAX, "관심 단지 최대");
  assert.equal(facts.realpriceSearchYears * 12, query.REALPRICE_COMPLEX_SEARCH_MONTHS, "단지 찾기 범위");
  assert.equal(facts.realpriceRefreshMonths, store.REALPRICE_RECENT_MONTHS, "다시 받기 달 수");
  assert.equal(facts.realpriceNewDays, query.REALPRICE_NEW_DAYS, "'새로 들어옴' 기간");
  assert.equal(facts.realpricePromoMax, query.REALPRICE_IDS_MAX, "홍보물에 고를 수 있는 거래 수");
  assert.equal(facts.realpriceMajorDays, query.REALPRICE_MAJOR_DAYS, "'주요 거래' 기간");
  assert.equal(facts.realpriceMajorTop, query.REALPRICE_MAJOR_TOP, "'주요 거래' 금액 상위 건수");
  const refresh = store.refreshStatements({ prepare: () => ({ bind: () => ({}) }) }, Date.parse("2026-11-19T05:00:00Z"));
  assert.equal(facts.realpriceRefreshHours * 60, refresh.estimatedMinutes, "다시 받기 예상 시간");
  const reset = new Date(query.nextReadBudgetReset(Date.parse("2026-11-19T05:00:00Z")));
  assert.equal(facts.realpriceReadResetTime, `오전 ${(reset.getUTCHours() + 9) % 24}시`, "조회 한도 풀리는 한국 시각");
});

test("글 초안 사용 안내 숫자는 서버·화면 상수와 맞다", async () => {
  const [budget, blog, view] = await Promise.all([
    import("../worker/work-ai-budget.mjs"),
    import("../worker/work-blog.mjs"),
    import("../src/lib/work/blog-view.mjs"),
  ]);
  const facts = ADMIN_HELP_FACTS;
  assert.equal(facts.blogDailyDefault, budget.AI_LIMIT_DEFAULTS.dailyCreateLimit, "하루 만들기 처음 값");
  assert.equal(facts.blogMonthlyDefaultDollars * 1_000_000, budget.AI_LIMIT_DEFAULTS.monthlyCostLimitMicroUsd, "월 비용 상한 처음 값");
  assert.equal(facts.blogPollFastSeconds * 1000, view.BLOG_POLL_FAST_MS, "처음 확인 간격");
  assert.equal(facts.blogPollSlowSeconds * 1000, view.BLOG_POLL_SLOW_MS, "1분 뒤 확인 간격");
  assert.equal(view.BLOG_POLL_FAST_FOR_MS, 60_000, "처음 간격은 1분 동안");
  assert.equal(facts.blogResultKeepMinutes * 60 * 1000, blog.BLOG_RESULT_KEEP_MS, "결과 맡아 두는 시간");
  assert.equal(facts.blogResultKeepMinutes, view.BLOG_RESULT_KEEP_MINUTES, "화면 문구의 결과 맡아 두는 시간");
  assert.equal(facts.blogRetentionDays, blog.BLOG_RETENTION_DAYS, "보관 기간");
  assert.equal(facts.blogRetentionDays, view.BLOG_RETENTION_DAYS, "화면 문구의 보관 기간");
});

test("작은따옴표 이름은 따옴표 없이 굵은 글자로 나누고, 큰따옴표 말은 그대로 둔다", () => {
  assert.deepEqual(splitHelpText("그 줄의 '확인 완료'를 누릅니다."), [
    { text: "그 줄의 ", label: false },
    { text: "확인 완료", label: true },
    { text: "를 누릅니다.", label: false },
  ]);
  assert.deepEqual(splitHelpText("“Send login code”를 누릅니다."), [{ text: "“Send login code”를 누릅니다.", label: false }]);
  assert.deepEqual(extractHelpLabels("'공개 상태'를 '공개'로"), ["공개 상태", "공개"]);
});

test("사용 안내 화면은 관리자 메뉴 '확인' 묶음 끝에 있고, 다른 관리자 화면처럼 검색·사이트맵·llms.txt에서 빠진다", async () => {
  const [layout, page, box, headers, config, llms] = await Promise.all([
    readSource("src/layouts/AdminLayout.astro"),
    readSource("src/pages/admin/help/index.astro"),
    readSource("src/components/admin/AdminPageHelp.astro"),
    readSource("public/_headers"),
    readSource("astro.config.mjs"),
    readSource("src/pages/llms.txt.ts"),
  ]);
  assert.match(layout, /\{ href: "\/admin\/help\/", label: "사용 안내", shortLabel: "안내" \}/u);
  assert.match(layout, /\{ label: "확인", hrefs: \["\/admin\/deployment\/", "\/admin\/history\/", "\/admin\/help\/"\] \}/u, "확인 묶음 끝");
  assert.match(layout, /"\/admin\/help\/": "help"/u, "메뉴 그림 기호");
  const tabs = /const tabItems = \[([\s\S]*?)\];/u.exec(layout)?.[1] ?? "";
  assert.equal((tabs.match(/href:/gu) ?? []).length, 3, "휴대폰 아래 탭은 그대로 3개 + 전체 메뉴");
  assert.doesNotMatch(tabs, /\/admin\/help\//u);
  assert.match(page, /import AdminLayout from "[./]+layouts\/AdminLayout\.astro";/u, "noindex 머리말은 AdminLayout이 넣음");
  assert.match(page, /<AdminLayout\b/u);
  assert.doesNotMatch(page, /<AdminPageHelp\b/u, "사용 안내 화면에는 상자를 두지 않음");
  assert.doesNotMatch(page, /<img\b|\.webp|\.png|\.jpe?g/u, "사진 없이 글만(사용자 결정 14:03:46)");
  assert.match(headers, /\/admin\/\*\r?\n\s+Cache-Control: no-store\r?\n\s+X-Robots-Tag: noindex, nofollow, noarchive/u, "/admin/help/도 /admin/* 규칙으로 no-store·noindex");
  assert.match(config, /return !pathname\.startsWith\("\/admin\/"\)/u, "사이트맵에서 /admin/ 아래 전부 제외");
  assert.doesNotMatch(llms, /\/admin/u, "llms.txt는 관리자 주소를 쓰지 않음");
  assert.match(box, /<details class="admin-page-help"/u, "접힌 상자(details, open 없음)");
  assert.doesNotMatch(box, /<details[^>]*\bopen\b/u, "처음에는 접혀 있음");
  assert.doesNotMatch(box, /localStorage|sessionStorage/u, "브라우저 저장소를 쓰지 않음");
  assert.match(box, /href=\{`\/admin\/help\/#\$\{help\.anchor\}`\}/u, "자세한 안내 위치로 가는 고리");
});
