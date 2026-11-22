import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 할 일 화면(단계 2, /admin/work/tasks/)과 업무 도구 처음의 '오늘 할 일' 칸. tasks.astro는 work 폴더 바로 아래라 단계 0 정적 검사(T0-115)에도 들어간다.
const PAGES = ["src/pages/admin/work/tasks.astro", "src/pages/admin/work/index.astro"];
const SCREEN_PARTS = ["src/lib/work-tasks-dom.ts", "src/lib/work/tasks-view.mjs", "src/lib/work/task-repeat.mjs"];

test("할 일 화면·부품은 서버를 직접 부르지 않고(work-tasks-client.ts 한 곳), 브라우저 저장소·주소 바꾸기·기록 남기기를 쓰지 않는다", async () => {
  const forbidden = [
    ["fetch", /\bfetch\s*\(/u],
    ["XMLHttpRequest", /XMLHttpRequest/u],
    ["sendBeacon", /sendBeacon/u],
    ["localStorage", /localStorage/u],
    ["sessionStorage", /sessionStorage/u],
    ["indexedDB", /indexedDB/iu],
    ["cookie", /document\.cookie/u],
    ["history", /\b(?:pushState|replaceState)\b/u],
    ["location write", /\blocation(?:\.(?:href|hash|search|pathname))?\s*=(?!=)/u],
    ["location call", /\blocation\.(?:assign|replace|reload)\s*\(/u],
    ["window.open", /window\.open\s*\(/u],
    ["console", /\bconsole\.(?:log|info|warn|error|debug)\s*\(/u],
  ];
  for (const file of [...PAGES, ...SCREEN_PARTS, "src/lib/work-tasks-client.ts"]) {
    const source = await readSource(file);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${name}`);
  }
  const client = await readSource("src/lib/work-tasks-client.ts");
  assert.match(client, /import \{ readWorkData, writeWorkData \} from "\.\/work-customers-client";/u, "세션·CSRF·봉투 해석은 손님 화면과 같은 모듈");
  for (const page of PAGES) assert.match(await readSource(page), /from "\.\.\/\.\.\/\.\.\/lib\/work-tasks-client"/u, `${page}: 서버 요청은 한 곳`);
});

test("할 일 목록 요청 값에는 할 일 제목·거래 이름을 넣지 않는다(상태·날짜·거래 ID·커서·개수만)", async () => {
  const view = await readSource("src/lib/work/tasks-view.mjs");
  const query = /export function taskListQuery\([^)]*\) \{([\s\S]*?)\n\}/u.exec(view)?.[1] ?? "";
  assert.ok(query, "taskListQuery 본문");
  const keys = [...query.matchAll(/query\.set\("([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(keys.sort(), ["cursor", "dealId", "limit", "status", "until"]);
  assert.doesNotMatch(query, /title/u);
});

test("할 일 화면은 form 제출이 없고 입력칸 자동 완성을 끄며, 열 때와 뒤로 가기 캐시 복원 때 넣던 값을 비우고 다시 부른다", async () => {
  const page = await readSource("src/pages/admin/work/tasks.astro");
  assert.doesNotMatch(page, /<form\b/u);
  for (const input of page.match(/<input\b[^>]*>/gu) ?? []) assert.match(input, /autocomplete="off"/u, input);
  assert.match(page, /window\.addEventListener\("pageshow", \(event\) => \{\r?\n\s*if \(event\.persisted\) reset\(\);\r?\n\s*\}\);\r?\n\s*reset\(\);\r?\n\s*\}\r?\n\s*<\/script>/u);
  assert.match(page, /window\.addEventListener\("beforeunload"/u, "고친 내용이 있으면 떠나기 전에 묻기");
  assert.match(page, /<AdminPageHelp page="\/admin\/work\/tasks\/" \/>/u);
});

test("메뉴 A안(2026-11-22 13:22:11): '할 일'은 업무 도구 처음 바로 뒤, 탭 미리 그리기(prerender) 목록에는 넣지 않는다", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.match(layout, /\{ href: "\/admin\/work\/", label: "업무 도구 처음" \},\r?\n\s*\{ href: "\/admin\/work\/tasks\/", label: "할 일" \},/u);
  const prerender = /const prerenderPages = \[([^\]]*)\];/u.exec(layout)?.[1] ?? "";
  assert.doesNotMatch(prerender, /tasks/u, "서버를 부르는 할 일 화면은 미리 그리지 않음");
});

test("업무 도구 처음은 prerender 목록에 그대로 두고, '오늘 할 일' 칸은 미리 그리는 동안 부르지 않는다(prerenderingchange 뒤)", async () => {
  const home = await readSource("src/pages/admin/work/index.astro");
  assert.match(home, /if \(doc\.prerendering\) document\.addEventListener\("prerenderingchange", \(\) => void loadHome\(\), \{ once: true \}\);\r?\n\s*else void loadHome\(\);/u);
  assert.equal((home.match(/loadHome\(\)/gu) ?? []).length, 5, "함수 선언 하나와, 부르는 곳은 미리 그리기 뒤·바로·다시 불러오기·뒤로 가기 복원 넷뿐");
  assert.match(home, /if \(!session\.enabled\) \{\r?\n\s*show\(homeStateText\("WORK_DISABLED"\)\);\r?\n\s*return;/u, "꺼져 있으면 할 일 목록을 부르지 않음");
  assert.match(home, /taskListQuery\(\{ until: today, limit: TASK_PAGE_SIZE \}\)/u, "오늘까지 열린 할 일만");
  assert.match(home, /data-tk-home-state[^>]*>|role="status"[^>]*data-tk-home-state/u);
  assert.doesNotMatch(home, /<input\b/u, "첫 화면 할 일 칸은 읽기만");
});

test("손님 지우기 확인 칸은 함께 휴지통으로 옮겨지는 할 일을 미리 알린다", async () => {
  const detail = await readSource("src/pages/admin/work/customers/detail.astro");
  assert.match(detail, /이 손님의 메모와, 이 손님만 참여한 거래·일정·할 일이 함께 옮겨집니다\./u);
});
