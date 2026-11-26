import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readSource = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// 달력 화면(/admin/work/calendar/, 2026-11-25 23:32:21 "C 새 달력 화면"·11-26 08:59:51). calendar.astro는 work 폴더 바로 아래라 단계 0 정적 검사에도 들어간다.
const PAGE = "src/pages/admin/work/calendar.astro";
const SCREEN_PARTS = ["src/lib/work-calendar-dom.ts", "src/lib/work/calendar-view.mjs", "src/lib/work/appointment-repeat.mjs", "src/lib/work/appointment-rules.mjs"];
const CLIENT = "src/lib/work-calendar-client.ts";

test("달력 화면·부품은 서버를 직접 부르지 않고(work-calendar-client.ts 한 곳), 브라우저 저장소·주소 바꾸기·기록 남기기를 쓰지 않는다", async () => {
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
    ["document.title", /document\.title\s*=/u],
    ["innerHTML", /\.(?:innerHTML|outerHTML)\s*=|insertAdjacentHTML/u],
  ];
  for (const file of [PAGE, ...SCREEN_PARTS, CLIENT]) {
    const source = await readSource(file);
    for (const [name, pattern] of forbidden) assert.doesNotMatch(source, pattern, `${file}: ${name}`);
  }
  const client = await readSource(CLIENT);
  assert.match(client, /import \{ readWorkData, writeWorkData \} from "\.\/work-customers-client";/u, "세션·CSRF·봉투 해석은 손님 화면과 같은 모듈");
  assert.match(await readSource(PAGE), /from "\.\.\/\.\.\/\.\.\/lib\/work-calendar-client"/u, "서버 요청은 한 곳");
  for (const file of SCREEN_PARTS) assert.doesNotMatch(await readSource(file), /from "[^"]*work-(?:calendar|customers)-client"/u, `${file}: 서버 요청 모듈을 부르지 않음`);
});

test("달력 읽기 요청 값은 날짜 둘(from·to)뿐이고, 일정 제목·거래 이름·손님 이름을 넣지 않는다", async () => {
  const client = await readSource(CLIENT);
  const body = /export function readCalendar\([^)]*\) \{([\s\S]*?)\n\}/u.exec(client)?.[1] ?? "";
  assert.ok(body, "readCalendar 본문");
  assert.deepEqual([...body.matchAll(/query\.set\("([^"]+)"/gu)].map((match) => match[1]).sort(), ["from", "to"]);
  assert.match(client, /export function readCalendar\(from: string, to: string\)/u);
  // 하나 고치기·지우기 주소에는 일정 UUID만 싣는다(제목은 본문으로만).
  for (const path of client.match(/`\/appointments\/[^`]*`/gu) ?? []) assert.equal(path, "`/appointments/${idPath(id)}`", path);
});

test("달력 화면은 form 제출이 없고 입력칸 자동 완성을 끄며, 열 때와 뒤로 가기 캐시 복원 때 창을 닫고 다시 부른다", async () => {
  const page = await readSource(PAGE);
  assert.doesNotMatch(page, /<form\b/u);
  const inputs = page.match(/<input\b[^>]*>/gu) ?? [];
  assert.ok(inputs.length >= 6, "종류·제목·날짜·시각·반복·알림 칸");
  for (const input of inputs) assert.match(input, /autocomplete="off"/u, input);
  assert.match(page, /window\.addEventListener\("pageshow", \(event\) => \{\r?\n\s*if \(event\.persisted\) reset\(\);\r?\n\s*\}\);\r?\n\s*reset\(\);\r?\n\s*\}\r?\n\s*<\/script>/u);
  assert.match(page, /const reset = \(\) => \{[\s\S]*?closeForm\(\);[\s\S]*?void start\(\);/u, "다시 열면 창을 닫고 처음부터");
  assert.match(page, /window\.addEventListener\("beforeunload"/u, "고친 내용이 있으면 떠나기 전에 묻기");
  assert.match(page, /<AdminPageHelp page="\/admin\/work\/calendar\/" \/>/u);
  assert.match(page, /if \(!session\.enabled\) \{\r?\n\s*showDisabled\(\);\r?\n\s*return;/u, "업무 도구가 꺼져 있으면 달력을 부르지 않음");
});

test("일정 넣기 창: 꼬리표 6개·반복 6개·알림 체크칸(최대 2개)·제목 80자·안내 문구는 공용 규칙에서 가져오고, 반복 줄은 '이 날만 / 이 날부터 모두'를 거친다", async () => {
  const [page, view] = await Promise.all([readSource(PAGE), readSource("src/lib/work/calendar-view.mjs")]);
  assert.match(page, /<dialog class="cal-dialog" aria-labelledby="cal-form-title" data-cal-dialog>/u);
  assert.match(page, /APPOINTMENT_TAG_KEYS\.map/u, "꼬리표는 공용 규칙의 키 순서대로");
  assert.match(page, /maxlength=\{APPOINTMENT_TITLE_MAX\}/u);
  assert.match(page, /\{APPOINTMENT_TITLE_HELP\}/u, "제목 안내는 할 일과 같은 글");
  assert.match(page, /type="checkbox" value=\{key\} autocomplete="off" data-cal-alarm/u, "알림은 체크칸");
  assert.match(page, /full = checkedAlarms\(\)\.length >= APPOINTMENT_MAX_ALARMS/u, "2개가 차면 나머지는 잠금");
  assert.match(page, /keepAllowedAlarms\(checkedAlarms\(\), startTime\)/u, "시각을 바꾸면 고를 수 없게 된 알림을 풂");
  assert.match(page, /defaultAlarms\(true\)/u, "처음 값: 하루 종일 → 전날 18:00");
  assert.match(page, /repeatScopeChoices\(occurrenceOn, action\)/u);
  assert.match(page, /const oneBlocked = repeatChanged \|\| !one \?/u, "반복·끝나는 날을 바꾸면 '이 날만'은 못 고름(서버 400)");
  assert.match(page, /oneExpired \? APPOINTMENT_DATE_EXPIRED_MESSAGE/u, "'이 날만'이 1년 넘게 지난 날짜면 그 단추를 끄고 까닭을 보임");
  assert.match(page, /scopeButtons\(scopeChoices, "edit", [\s\S]*?\{ one: oneBlocked, following: followingBlocked \}\)/u, "막힌 범위 단추에 까닭을 넘김");
  assert.match(page, /showMovedToTrash\(saved, "일정", result\.trash,/u, "지운 뒤 '되살리기'·'휴지통 보기'");
  assert.match(page, /\{APPOINTMENT_KEEP_NOTICE\}/u, "보관 안내는 저장 단추 줄 위");
  assert.ok(page.indexOf("{APPOINTMENT_KEEP_NOTICE}") < page.indexOf("data-cal-actions"), "보관 안내 → 저장 단추 줄");
  assert.match(view, /export const defaultAlarms = \(allDay\) => \(allDay \? \["day-before-18"\] : \["hour-before"\]\);/u, "사용자 답 2026-11-26 09:18:41");
});

test("달력은 서버를 부르므로 탭 미리 그리기(prerender) 목록에 넣지 않고, 알약은 '도구 모음' 바로 뒤에 둔다", async () => {
  const layout = await readSource("src/layouts/AdminLayout.astro");
  const prerender = /const prerenderPages = \[([^\]]*)\];/u.exec(layout)?.[1] ?? "";
  assert.doesNotMatch(prerender, /calendar/u);
  assert.match(layout, /"\/admin\/work\/calendar\/": "calendar",/u);
});

test("달력 CSS: 끝낸·지난 일정은 투명도가 아니라 회색 글자로 흐리게 하고, 13px·36px은 '1221px 이상 + 마우스' 덩어리 안에만 있다", async () => {
  const css = (await readSource("src/styles/admin.css")).replaceAll("\r\n", "\n");
  const at = css.indexOf("/* 달력(/admin/work/calendar/, 2026-11-26");
  assert.ok(at > 0, "달력 CSS 덩어리");
  const end = css.indexOf("\n/* ", css.indexOf("@media (min-width: 1221px) and (hover: hover) and (pointer: fine) {", at));
  const block = css.slice(at, end < 0 ? undefined : end);
  assert.doesNotMatch(block, /opacity: 0?\.\d/u, "투명도로 흐리게 하지 않음(대비 4.5:1)");
  assert.match(block, /\.cal-chip\.is-done, \.cal-chip\.is-past \{ color: var\(--ds-ink-soft\); background: var\(--ds-paper-2\); \}/u);
  const dense = block.slice(block.indexOf("@media (min-width: 1221px) and (hover: hover) and (pointer: fine) {"));
  const outside = block.slice(0, block.indexOf("@media (min-width: 1221px) and (hover: hover) and (pointer: fine) {"));
  assert.doesNotMatch(outside, /font-size: 1[23]px|(?:min-)?height: 36px|width: 36px/u, "13px·36px은 조밀한 PC 덩어리 안에만");
  assert.match(dense, /\.cal-chip \{ min-height: 22px; font-size: 13px; \}/u);
  assert.match(block, /@media \(min-width: 980px\) \{\n[\s\S]*?\.cal-add \{ display: inline-flex; \}/u, "휴대폰은 위 '일정 넣기'를 빼고 그날 목록 아래 단추로");
  assert.match(block, /\.cal-form__foot \{ display: grid; flex: 0 0 auto;/u, "창 아래 저장 줄은 고정(가운데만 스크롤)");
});
