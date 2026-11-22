import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 손님 화면(단계 2). customers/ 아래 화면은 단계 0 정적 검사(work 폴더 바로 아래 .astro만 봄)에 저절로 들어가지 않아 여기서 같은 규칙을 본다.
const PAGES = [
  "src/pages/admin/work/customers/index.astro",
  "src/pages/admin/work/customers/detail.astro",
  "src/pages/admin/work/notes.astro",
];
const SCREEN_PARTS = ["src/lib/work-customers-dom.ts", "src/lib/work/customers-view.mjs", "src/components/admin/WorkCustomerFields.astro"];

test("손님 화면·부품은 서버를 직접 부르지 않고(work-customers-client.ts 한 곳), 브라우저 저장소·주소 바꾸기·기록 남기기를 쓰지 않는다", async () => {
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
  for (const file of [...PAGES, ...SCREEN_PARTS]) {
    const source = await readSource(file);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${name}`);
  }
  const client = await readSource("src/lib/work-customers-client.ts");
  assert.doesNotMatch(client, /localStorage|sessionStorage|console\./u, "서버 요청 모듈도 저장소·기록을 쓰지 않음");
  assert.match(client, /"X-Admin-CSRF": session\.csrfToken/u, "쓰기 요청에 CSRF 머리말");
  for (const page of PAGES) assert.match(await readSource(page), /from "(?:\.\.\/)+lib\/work-customers-client"/u, `${page}: 서버 요청은 한 곳`);
});

test("손님 화면은 form 제출이 없고 입력칸 자동 완성을 끄며, 뒤로 가기 캐시 복원 때 넣던 값을 비운다", async () => {
  for (const file of [...PAGES, "src/components/admin/WorkCustomerFields.astro"]) {
    const source = await readSource(file);
    assert.doesNotMatch(source, /<form\b/u, `${file}: Enter 제출로 입력값이 주소에 붙지 않게 form을 쓰지 않음`);
    for (const control of source.match(/<(?:input|select|textarea)\b[^>]*>/gu) ?? []) assert.match(control, /autocomplete="off"/u, `${file}: ${control}`);
  }
  for (const file of PAGES) {
    const source = await readSource(file);
    assert.match(source, /window\.addEventListener\("pageshow", \(event\) => \{\r?\n\s*if \(event\.persisted\) reset\(\);/u, `${file}: 캐시 복원 때 reset`);
    assert.match(source, /\breset\(\);\r?\n\s*\}\r?\n(?:\s*\}\r?\n)?\s*<\/script>/u, `${file}: 열 때마다 비우고 다시 불러옴`);
    assert.match(source, /getCustomerSession\(\{ refresh: true \}\)[\s\S]*?if \(!session\.enabled\) \{\r?\n\s*showDisabled\(\);\r?\n\s*return;/u, `${file}: 업무 세션이 꺼져 있으면 손님 자료를 부르지 않음`);
    assert.match(source, /window\.addEventListener\("beforeunload"/u, `${file}: 저장하지 않은 글이 있으면 떠나기 전에 물음`);
  }
});

test("손님 카드 주소에는 무작위 ID만 넣고, 손님 이름은 제목(title)에 넣지 않는다", async () => {
  const [view, dom, list, detail, notes] = await Promise.all([
    readSource("src/lib/work/customers-view.mjs"),
    readSource("src/lib/work-customers-dom.ts"),
    ...PAGES.map(readSource),
  ]);
  assert.match(view, /export const customerHref = \(id\) => `\/admin\/work\/customers\/detail\/\?id=\$\{encodeURIComponent\(id\)\}`;/u);
  assert.match(dom, /link\.href = customerHref\(customer\.id\);/u);
  for (const source of [list, detail, notes]) {
    assert.doesNotMatch(source, /document\.title\s*=/u, "탭 제목·방문 기록에 이름이 남지 않음");
    assert.doesNotMatch(source, /\.href = (?!`(?:tel|sms):)[^;]*(?:displayName|phoneDigits|needs)/u, "화면 링크 주소에 이름·전화·조건을 넣지 않음(전화·문자 앱 tel:·sms:만 번호를 씀)");
  }
  assert.match(detail, /id = customerIdFromSearch\(location\.search\);/u);
});

test("관리자 메뉴에는 업무 도구 처음·할 일(메뉴 A안 2026-11-22 13:22:11) 바로 뒤 '손님·돈' 묶음에 '손님'·'매출장부'를 넣고(메뉴 B안 2026-11-21 03:09:45), 메모 창고는 손님 화면 안 링크로만 두며, 세 화면 모두 탭 미리 그리기(prerender)에서 뺀다(사용자 선택 2026-11-21 02:26:01)", async () => {
  const [layout, list] = await Promise.all([readSource("src/layouts/AdminLayout.astro"), readSource(PAGES[0])]);
  assert.match(layout, /\{ href: "\/admin\/work\/", label: "업무 도구 처음" \},\r?\n\s*\{ href: "\/admin\/work\/tasks\/", label: "할 일" \},\r?\n\s*\{ href: "\/admin\/work\/customers\/", label: "손님", group: "손님·돈" \},\r?\n\s*\{ href: "\/admin\/work\/ledger\/", label: "매출장부", group: "손님·돈" \},\r?\n\s*\{ href: "\/admin\/work\/fee\/"/u);
  assert.doesNotMatch(layout, /\/admin\/work\/notes\/|메모 창고/u, "메모 창고는 메뉴에 없음");
  const prerender = /const prerenderPages = \[([^\]]*)\];/u.exec(layout)?.[1] ?? "";
  assert.doesNotMatch(prerender, /customers|notes|ledger/u, "서버를 부르는 화면은 미리 그리지 않음");
  assert.match(list, /<a class="admin-text-link" href="\/admin\/work\/notes\/">메모 창고/u);
});

test("손님 카드의 지우기는 이름을 똑같이 다시 넣어야 단추가 눌리고, 고치기는 version과 바뀐 칸만 보내며 409면 '다시 불러오기'를 보인다", async () => {
  const detail = await readSource(PAGES[1]);
  assert.match(detail, /deleteGo\.disabled = !detail \|\| deleteConfirm\.value\.trim\(\) !== detail\.customer\.displayName;/u);
  assert.match(detail, /deleteCustomer\(id, deleteConfirm\.value\.trim\(\)\)/u);
  assert.match(detail, /updateCustomer\(id, \{ version: detail\.customer\.version, \.\.\.changes \}\)/u);
  assert.match(detail, /editReload\.hidden = code !== "VERSION_CONFLICT";/u);
  assert.match(detail, /<button class="work-primary-button cu-save cu-delete-go" type="button" disabled data-cu-delete-go>지우기<\/button>/u, "처음에는 눌리지 않음");
});
