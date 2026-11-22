import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { TRASH_MOVE_NOTICE } from "../src/lib/work/trash-view.mjs";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 휴지통 화면(단계 2, /admin/work/trash/)과 지우기 화면 4곳. trash.astro는 work 폴더 바로 아래라 단계 0 정적 검사(T0-115)에도 들어간다.
const PAGE = "src/pages/admin/work/trash.astro";
const DELETE_PAGES = ["src/pages/admin/work/notes.astro", "src/pages/admin/work/ledger.astro", "src/pages/admin/work/tasks.astro", "src/pages/admin/work/customers/detail.astro"];

test("휴지통 화면·부품은 서버를 직접 부르지 않고(work-trash-client.ts 한 곳), 브라우저 저장소·주소 바꾸기·기록 남기기를 쓰지 않는다", async () => {
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
    ["innerHTML", /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML/u],
  ];
  for (const file of [PAGE, "src/lib/work-trash-dom.ts", "src/lib/work/trash-view.mjs", "src/lib/work-trash-client.ts"]) {
    const source = await readSource(file);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${name}`);
  }
  const client = await readSource("src/lib/work-trash-client.ts");
  assert.match(client, /import \{ readWorkData, writeWorkData \} from "\.\/work-customers-client";/u, "세션·CSRF·봉투 해석은 손님 화면과 같은 모듈");
  assert.match(client, /readWorkData<TrashPage>\("\/trash", query\)/u);
  assert.match(client, /writeWorkData<TrashRestored>\(`\/trash\/\$\{idPath\(batchId\)\}\/restore`, "POST", \{\}\)/u, "되살리기 본문은 빈 객체");
  assert.match(client, /writeWorkData<\{ purged: boolean \}>\(`\/trash\/\$\{idPath\(batchId\)\}`, "DELETE", \{ confirm \}\)/u);
  assert.match(await readSource(PAGE), /from "\.\.\/\.\.\/\.\.\/lib\/work-trash-client"/u, "서버 요청은 한 곳");
  assert.match(await readSource("src/lib/work-trash-dom.ts"), /from "\.\/work-trash-client"/u);
});

test("휴지통 목록 요청 값에는 묶음 이름·종류를 넣지 않는다(커서·개수만, 종류 거르기는 화면에서)", async () => {
  const view = await readSource("src/lib/work/trash-view.mjs");
  const query = /export function trashListQuery\([^)]*\) \{([\s\S]*?)\n\}/u.exec(view)?.[1] ?? "";
  assert.ok(query, "trashListQuery 본문");
  const keys = [...query.matchAll(/query\.set\("([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(keys.sort(), ["cursor", "limit"]);
  const page = await readSource(PAGE);
  assert.match(page, /const shown = kind \? items\.filter\(\(item\) => item\.kind === kind\) : items;/u, "받은 목록에서 거름");
  assert.match(page, /more\.hidden = !cursor;/u, "거른 결과가 0건이어도 더 받을 것이 있으면 '더 보기'");
  assert.match(page, /element\("p", "tr-row__title", item\.label\)/u, "묶음 이름은 글자로만 그림");
});

test("휴지통 화면은 form 제출이 없고 입력칸 자동 완성을 끄며, 열 때와 뒤로 가기 캐시 복원 때 비우고 다시 부른다", async () => {
  const page = await readSource(PAGE);
  assert.doesNotMatch(page, /<form\b/u);
  for (const input of page.match(/<input\b[^>]*>/gu) ?? []) assert.match(input, /autocomplete="off"/u, input);
  assert.match(page, /window\.addEventListener\("pageshow", \(event\) => \{\r?\n\s*if \(event\.persisted\) reset\(\);\r?\n\s*\}\);\r?\n\s*reset\(\);\r?\n\s*\}\r?\n\s*\}\r?\n\s*<\/script>/u);
  assert.match(page, /<AdminPageHelp page="\/admin\/work\/trash\/" \/>/u);
  assert.match(page, /if \(!session\.enabled\) \{\r?\n\s*showCode\("WORK_DISABLED"\);\r?\n\s*return;/u, "꺼져 있으면 휴지통을 부르지 않음");
  // 영구 삭제: 확인 창 없이 칸 안에서 글자를 넣어야 단추가 켜진다
  assert.doesNotMatch(page, /window\.confirm|confirm\(/u);
  assert.match(page, /go\.disabled = !isPurgeWord\(input\.value\);/u);
  assert.match(page, /<button class="work-primary-button cu-save cu-delete-go" type="button" disabled data-tr-purge-go>영구 삭제<\/button>/u);
  // 되살릴 수 없는 묶음(restorable=false)에는 '되살리기' 단추를 만들지 않는다
  assert.match(page, /if \(!blocked\) \{\r?\n\s*const restoreButton = element\("button", "work-secondary-button tr-restore", "되살리기"\);/u);
});

test("메뉴에는 넣지 않고(2026-11-22 14:31:26) 손님 목록 고리와 업무 도구 처음 바로가기로 들어온다. 탭 미리 그리기 목록에는 넣지 않는다", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.doesNotMatch(layout, /\/admin\/work\/trash\//u, "메뉴·미리 그리기에 없음");
  const customers = await readSource("src/pages/admin/work/customers/index.astro");
  assert.match(customers, /<p class="cu-links"><a class="admin-text-link" href="\/admin\/work\/notes\/">메모 창고 <span aria-hidden="true">→<\/span><\/a><a class="admin-text-link" href="\/admin\/work\/trash\/">휴지통 <span aria-hidden="true">→<\/span><\/a><\/p>/u);
  const home = await readSource("src/pages/admin/work/index.astro");
  assert.match(home, /<nav class="tr-homelinks" aria-label="휴지통 바로가기"><a class="admin-text-link" href="\/admin\/work\/trash\/">휴지통 <small>지운 자료 7일 보관<\/small>/u);
  const homeLinkAt = home.indexOf('class="tr-homelinks"');
  assert.ok(homeLinkAt > home.indexOf("work-tool-row__text") && homeLinkAt < home.indexOf('class="work-home__notice"'), "도구 3개 아래, 안내 글 위");
  // 첫 화면 바로가기는 개수를 싣지 않아 서버를 부르지 않는다(미리 그리기 유지)
  assert.doesNotMatch(home, /work-trash-client|listTrash/u);
});

test("지우기 화면 4곳의 확인 글은 '되돌릴 수 없음' 대신 휴지통 문장이고, 지운 뒤 '휴지통 보기'로 갈 수 있다", async () => {
  for (const file of DELETE_PAGES) {
    const source = await readSource(file);
    assert.doesNotMatch(source, /되돌릴 수 없/u, `${file}: 옛 문장 없음`);
    assert.match(source, /\{TRASH_MOVE_NOTICE\}/u, `${file}: 확인 칸에 휴지통 문장(${TRASH_MOVE_NOTICE})`);
  }
  for (const [file, what] of [["src/pages/admin/work/notes.astro", "메모"], ["src/pages/admin/work/ledger.astro", "장부 줄"], ["src/pages/admin/work/tasks.astro", "할 일"]]) {
    const source = await readSource(file);
    assert.match(source, new RegExp(`showMovedToTrash\\((?:listStatus|saved), "${what}", result\\.trash, \\{`, "u"), `${file}: 지운 뒤 알림에 '되살리기'·'휴지통 보기'`);
  }
  const dom = await readSource("src/lib/work-trash-dom.ts");
  assert.match(dom, /element\("a", "admin-text-link", "휴지통 보기"\)/u);
  assert.match(dom, /if \(trash\?\.batchId\) \{/u, "응답에 묶음 id가 있을 때만 '되살리기'");
  const detail = await readSource("src/pages/admin/work/customers/detail.astro");
  assert.match(detail, /<h2 id="cu-gone-title">손님을 휴지통으로 옮겼습니다<\/h2>/u);
  assert.match(detail, /<a class="work-secondary-button cu-state__go" href="\/admin\/work\/trash\/">휴지통 보기<\/a>/u);
});
