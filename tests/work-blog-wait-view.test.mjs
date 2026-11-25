// 글 초안 '화면을 닫아도 받기'(2026-11-25)의 화면 쪽 순수 함수 시험.
// 브라우저에 기억하는 것은 초안 번호(UUID)뿐인지, 다시 열었을 때 알림 문장이 서버 보관 목록에서만 만들어지는지 본다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BLOG_WAIT_MAX_MINUTES, failView } from "../src/lib/work/blog-view.mjs";
import {
  BLOG_WAITING_MAX,
  BLOG_WAITING_STORAGE_KEY,
  addWaitingId,
  isWaitingId,
  parseWaitingIds,
  removeWaitingId,
  serializeWaitingIds,
  startedText,
  waitingNotices,
} from "../src/lib/work/blog-wait-view.mjs";
import { BLOG_DRAFT_LIST_LIMIT, BLOG_WAIT_MAX_MS } from "../worker/work-blog.mjs";
import { isUuid } from "../worker/work-input.mjs";

// 받은 폴더의 줄 끝(CRLF)과 상관없이 같은 글자로 본다.
const read = async (path) => (await readFile(new URL(`../${path}`, import.meta.url), "utf8")).replace(/\r\n/gu, "\n");
const NOW = Date.parse("2026-11-20T06:30:00.000Z"); // 한국 15:30
const uuid = (n) => `0f0e0d0c-1111-4222-8333-${String(n).padStart(12, "0")}`;
const item = (id, extra = {}) => ({ id, source: { type: "complex", id: "zz-forest", title: "가상숲 단지" }, status: "completed", closed: null, errorCode: null, title: "가상숲 단지 소개", createdAt: "2026-11-20T05:58:00.000Z", closedAt: null, ...extra });

test("TK-162 기다리는 끝 30분은 서버 값과 같고, 화면 문구·실패 문구가 같은 숫자를 쓴다", async () => {
  assert.equal(BLOG_WAIT_MAX_MINUTES * 60_000, BLOG_WAIT_MAX_MS);
  const page = await read("src/pages/admin/work/blog.astro");
  assert.match(page, new RegExp(`${BLOG_WAIT_MAX_MINUTES}분이 지나도 끝나지 않으면 만들지 못한 것으로 닫습니다\\.`, "u"));
  assert.match(page, /<strong>화면을 닫거나 휴대폰을 꺼도 됩니다\.<\/strong> 다 만든 글은 서버가 받아 '보관 중인 초안'에 넣어 둡니다\./u);
  assert.doesNotMatch(page, /10분 안에/u, "옛 문구(10분 안에 다시 열어야 함)는 없음");
  const timeout = failView({ status: "failed", errorCode: "AI_WAIT_TIMEOUT" });
  assert.equal(timeout.title, "30분을 기다렸지만 글이 끝나지 않았습니다");
  assert.match(timeout.body, /서버가 30분 동안 확인했지만 AI가 글을 끝내지 못해 그만 기다립니다\. 비용은 들었을 수 있습니다\(추정\)/u);
  assert.equal(timeout.retry, true);
  assert.match(failView({ status: "expired", errorCode: "AI_RESULT_EXPIRED" }).body, /서버가 받기 전에 10분이 지나/u);
});

test("TK-163 브라우저에 기억하는 것은 초안 번호(UUID) 배열뿐: 번호가 아닌 글자·겹친 번호·망가진 글자는 버리고 20개까지만 둔다", () => {
  assert.equal(BLOG_WAITING_STORAGE_KEY, "leaderscityhappy.admin.blog.waiting.v1");
  assert.equal(BLOG_WAITING_MAX, BLOG_DRAFT_LIST_LIMIT, "보관 목록 수와 같음");
  for (const value of [uuid(1), "00000000-0000-0000-0000-000000000000", "가상숲 단지", "zz-draft-1", uuid(1).toUpperCase(), ` ${uuid(1)}`, 7, null, undefined, {}]) {
    assert.equal(isWaitingId(value), isUuid(value), `서버와 같은 번호 꼴: ${String(value)}`);
  }
  assert.deepEqual(parseWaitingIds(null), []);
  assert.deepEqual(parseWaitingIds(""), []);
  assert.deepEqual(parseWaitingIds("{망가진 글자"), []);
  assert.deepEqual(parseWaitingIds(JSON.stringify({ ids: [uuid(1)] })), [], "배열이 아니면 빈 것으로");
  assert.deepEqual(parseWaitingIds(JSON.stringify([uuid(1), "가상숲 단지 소개", 3, null, uuid(1), { title: "글" }, uuid(2)])), [uuid(1), uuid(2)]);
  const many = Array.from({ length: BLOG_WAITING_MAX + 5 }, (_, index) => uuid(index));
  assert.deepEqual(parseWaitingIds(JSON.stringify(many)), many.slice(5), "넘치면 오래된 것부터 버림");

  assert.deepEqual(addWaitingId([], uuid(1)), [uuid(1)]);
  assert.deepEqual(addWaitingId([uuid(1), uuid(2)], uuid(1)), [uuid(2), uuid(1)], "같은 번호는 한 번만");
  assert.deepEqual(addWaitingId([uuid(1)], "가상숲 단지"), [uuid(1)], "번호가 아니면 넣지 않음");
  assert.equal(addWaitingId(many.slice(0, BLOG_WAITING_MAX), uuid(99)).length, BLOG_WAITING_MAX);
  assert.deepEqual(removeWaitingId([uuid(1), uuid(2)], uuid(1)), [uuid(2)]);
  const stored = serializeWaitingIds([uuid(1), "가상숲 단지", uuid(2)]);
  assert.equal(stored, JSON.stringify([uuid(1), uuid(2)]));
  assert.match(stored, /^\["[0-9a-f-]{36}"(,"[0-9a-f-]{36}")*\]$/u, "저장 글자는 번호 배열 꼴뿐");
});

test("TK-164 다시 열었을 때 알림: 다 만든 글은 '글 열기', 만들지 못한 글은 까닭, 만드는 중·지금 기다리는 초안은 알림 없이 기억, 닫혔거나 목록에 없는 초안은 잊음", () => {
  assert.equal(startedText("2026-11-20T05:58:00.000Z", NOW), "오늘 14:58");
  assert.equal(startedText("2026-11-19T05:58:00.000Z", NOW), "11. 19. 14:58");
  assert.equal(startedText("2026-11-19T15:10:00.000Z", NOW), "오늘 00:10", "한국 날짜로 같은 날");

  const ids = [uuid(1), uuid(2), uuid(3), uuid(4), uuid(5), uuid(6), uuid(7)];
  const items = [
    item(uuid(1)),
    item(uuid(2), { status: "failed", errorCode: "AI_WAIT_TIMEOUT", title: null }),
    item(uuid(3), { status: "in_progress", title: null }),
    item(uuid(4), { closed: "confirmed", closedAt: "2026-11-20T06:10:00.000Z" }),
    item(uuid(5), { status: "queued", closed: "cancelled", title: null }),
    item(uuid(7), { status: "expired", errorCode: "AI_RESULT_EXPIRED", title: null, createdAt: "2026-11-19T05:58:00.000Z" }),
    item(uuid(8)),
  ];
  const { keep, notices } = waitingNotices(ids, items, { nowMs: NOW });
  assert.deepEqual(keep, [uuid(1), uuid(2), uuid(3), uuid(7)], "닫힌 초안(4·5)과 목록에 없는 번호(6)는 잊음");
  assert.deepEqual(notices, [
    { id: uuid(1), kind: "done", title: "기다리던 글이 다 만들어졌습니다", detail: "가상숲 단지 · 오늘 14:58에 만들기 시작 · 화면을 닫은 동안 받아 두었습니다", action: "글 열기", name: "가상숲 단지" },
    { id: uuid(2), kind: "failed", title: "기다리던 글을 만들지 못했습니다", detail: "가상숲 단지 · 오늘 14:58에 만들기 시작 · 30분을 기다렸지만 글이 끝나지 않았습니다", action: "까닭 보기", name: "가상숲 단지" },
    { id: uuid(7), kind: "failed", title: "기다리던 글을 만들지 못했습니다", detail: "가상숲 단지 · 11. 19. 14:58에 만들기 시작 · 결과를 받지 못했습니다(10분 지남)", action: "까닭 보기", name: "가상숲 단지" },
  ]);
  assert.ok(!notices.some((notice) => notice.id === uuid(8)), "기다리지 않은 초안(8)은 다 만들어져 있어도 알리지 않음");
  assert.deepEqual(waitingNotices([], items, { nowMs: NOW }), { keep: [], notices: [] }, "기다리던 번호가 없으면 알림 없음");
  const skipped = waitingNotices([uuid(1)], items, { nowMs: NOW, skipId: uuid(1) });
  assert.deepEqual(skipped, { keep: [uuid(1)], notices: [] }, "지금 화면에서 기다리는 초안은 알리지 않고 기억");
  assert.deepEqual(waitingNotices([uuid(6)], items, { nowMs: NOW, skipId: uuid(6) }), { keep: [uuid(6)], notices: [] }, "지금 기다리는 초안은 목록에 아직 없어도 잊지 않음");
});

test("TK-165 알림 스크립트는 초안 번호 배열 말고는 브라우저 저장소에 쓰지 않고 서버를 부르지 않으며, 저장소 읽기·쓰기는 모두 try 안에 있다", async () => {
  const dom = await read("src/lib/work-blog-wait.ts");
  const code = dom.replace(/^\s*\/\/.*$/gmu, "");
  assert.doesNotMatch(code, /fetch\(|XMLHttpRequest|sessionStorage|indexedDB|document\.cookie|location\.|history\./u);
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML/u, "글자로만 그림");
  const uses = [...code.matchAll(/localStorage\?\.(\w+)\(([^)]*)\)/gu)].map((match) => [match[1], match[2].trim()]);
  assert.deepEqual(uses, [
    ["getItem", "BLOG_WAITING_STORAGE_KEY"],
    ["removeItem", "BLOG_WAITING_STORAGE_KEY"],
    ["setItem", "BLOG_WAITING_STORAGE_KEY, serializeWaitingIds(ids"],
  ]);
  assert.equal((code.match(/localStorage/gu) ?? []).length, 3);
  for (const name of ["readIds", "writeIds"]) {
    const body = code.slice(code.indexOf(`function ${name}(`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /try \{[\s\S]*localStorage[\s\S]*\} catch/u, `${name}: try 안에서만 저장소를 씀`);
  }
  const page = await read("src/pages/admin/work/blog.astro");
  assert.equal((page.match(/localStorage\./gu) ?? []).length, 0, "화면 파일은 저장소를 직접 만지지 않음");
  assert.match(page, /<div class="bl-waited" role="status" data-bl-waited hidden><\/div>\s*\n\s*<AdminPageHelp page="\/admin\/work\/blog\/" \/>/u, "알림 상자는 '이 화면 사용법' 바로 위");
});
