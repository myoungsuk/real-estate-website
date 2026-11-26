// 할 일(단계 2, /admin/work/tasks/)과 업무 도구 처음의 '오늘 할 일' 칸을 가짜 업무 API로 본다.
// 사용자 선택 2026-11-22 13:22:11: 메뉴 A안(업무 도구 처음 바로 뒤), 시안 "이 시안대로", 첫 화면 글은 이 PR에서 함께 고침.
// 할 일 제목·거래 이름은 모두 지어낸 값(가상숲1단지 등)이고 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";
import { nextTaskDueOn } from "../src/lib/work/task-repeat.mjs";

const NOW = new Date("2026-11-18T03:00:00Z"); // 한국 수요일 12:00
const TODAY = "2026-11-18";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code, details = []) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details }, requestId: "test" } });

const DEAL_A = { id: uuid(101), title: "가상숲1단지 84㎡ 매매", status: "contracted" };
const DEAL_B = { id: uuid(102), title: "가상강변마을 오피스텔 전세", status: "open" };
const task = (n, patch) => ({ id: uuid(n), title: `가상 할 일 ${n}`, dueOn: null, repeat: "none", repeatDay: null, doneAt: null, version: 1, deal: null, nextId: null, ...patch });
function makeTasks() {
  return [
    task(1, { title: "가상 등기부등본 다시 떼기", dueOn: "2026-11-14", deal: DEAL_A }),
    task(2, { title: "가상 주간 매물 광고 갱신", dueOn: TODAY, repeat: "weekly" }),
    task(3, { title: "가상 잔금일 안내 문자 보내기", dueOn: "2026-11-20", deal: DEAL_A }),
    task(4, { title: "가상 월세 입금 확인", dueOn: "2026-11-30", repeat: "monthly", repeatDay: 31, deal: DEAL_B }),
    task(5, { title: "가상 명함 다시 주문" }),
    task(6, { title: "가상 지난 계약서 정리", dueOn: "2026-11-16", doneAt: "2026-11-17T05:00:00.000Z" }),
  ];
}
// 첫 화면 칸 시험용: 오늘까지 열린 할 일 n개
const dueTasks = (n) => Array.from({ length: n }, (_, index) => task(200 + index, { title: `가상 오늘 할 일 ${index + 1}`, dueOn: index === 0 ? "2026-11-15" : TODAY }));
const publicTask = ({ nextId, ...rest }) => rest;
const order = (a, b) => (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.id.localeCompare(b.id);

// 늘 같은 시각에서 시작하고 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
async function setup(page, { width = 390, enabled = true, tasks = makeTasks(), schemaOutdated = false, failListOnce = false, conflictOnce = false } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  let nextNumber = 900;
  const trashed = new Map();
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    calls.all.push(`${method} ${path}${url.search}`);
    const body = method === "GET" ? null : request.postDataJSON();
    if (method !== "GET") {
      calls.writes.push({ method, path, body, csrf: request.headers()["x-admin-csrf"] ?? null });
      if (request.headers()["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: "시험 관리자", csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 6 : null }));
    if (!enabled) return route.fulfill(failure(503, "WORK_DISABLED"));
    if (schemaOutdated && path.startsWith("/tasks")) return route.fulfill(failure(503, "WORK_SCHEMA_OUTDATED"));

    if (path === "/tasks" && method === "GET") {
      if (failListOnce) {
        failListOnce = false;
        return route.fulfill(failure(503, "STORAGE_UNAVAILABLE"));
      }
      const done = url.searchParams.get("status") === "done";
      const until = url.searchParams.get("until");
      const dealId = url.searchParams.get("dealId");
      const found = tasks
        .filter((item) => Boolean(item.doneAt) === done)
        .filter((item) => !until || (item.dueOn && item.dueOn <= until))
        .filter((item) => !dealId || item.deal?.id === dealId)
        .sort(done ? (a, b) => b.doneAt.localeCompare(a.doneAt) : order);
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const items = found.slice(start, start + limit).map(publicTask);
      return route.fulfill(envelope({ items, nextCursor: start + limit < found.length ? String(start + limit) : null }));
    }
    if (path === "/tasks" && method === "POST") {
      const deal = [DEAL_A, DEAL_B].find((item) => item.id === body.dealId) ?? null;
      const repeat = body.repeat ?? "none";
      const created = task(nextNumber++, { title: body.title, dueOn: body.dueOn ?? null, repeat, repeatDay: repeat === "monthly" ? Number(body.dueOn.slice(8)) : null, deal });
      tasks.push(created);
      return route.fulfill(envelope({ task: publicTask(created) }, 201));
    }
    const taskMatch = path.match(/^\/tasks\/([^/]+)$/u);
    if (taskMatch) {
      const index = tasks.findIndex((item) => item.id === decodeURIComponent(taskMatch[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const current = tasks[index];
      if (method === "PATCH") {
        if (conflictOnce || body.version !== current.version) {
          conflictOnce = false;
          tasks[index] = { ...current, title: "가상 다른 화면에서 고친 제목", version: current.version + 1 };
          return route.fulfill(failure(409, "VERSION_CONFLICT"));
        }
        const { version, done, ...changes } = body;
        const updated = { ...current, ...changes, version: version + 1 };
        if (changes.dealId !== undefined) {
          updated.deal = [DEAL_A, DEAL_B].find((item) => item.id === changes.dealId) ?? null;
          delete updated.dealId;
        }
        let next = null;
        if (done === true && !current.doneAt) {
          updated.doneAt = NOW.toISOString();
          const dueOn = nextTaskDueOn({ dueOn: current.dueOn, rule: current.repeat, day: current.repeatDay, today: TODAY });
          if (dueOn) {
            next = task(nextNumber++, { title: current.title, dueOn, repeat: current.repeat, repeatDay: current.repeatDay, deal: current.deal });
            tasks.push(next);
            updated.nextId = next.id;
          }
        } else if (done === false && current.doneAt) {
          updated.doneAt = null;
          next = tasks.find((item) => item.id === current.nextId) ?? null;
        }
        tasks[index] = updated;
        return route.fulfill(envelope({ task: publicTask(updated), next: next ? publicTask(next) : null }));
      }
      if (method === "DELETE") {
        const [removed] = tasks.splice(index, 1);
        trashed.set(uuid(990), removed);
        return route.fulfill(envelope({ deleted: true, trash: { batchId: uuid(990), purgeAfter: "2026-11-25T03:00:00.000Z" } }));
      }
    }
    // 지운 뒤 알림의 '되살리기'(휴지통 묶음 id로 되살림)
    const restoreMatch = path.match(/^\/trash\/([^/]+)\/restore$/u);
    if (restoreMatch && method === "POST") {
      const removed = trashed.get(decodeURIComponent(restoreMatch[1]));
      if (!removed) return route.fulfill(failure(404, "NOT_FOUND"));
      trashed.delete(decodeURIComponent(restoreMatch[1]));
      tasks.push(removed);
      return route.fulfill(envelope({ restored: { customers: 0, deals: 0, parties: 0, events: 0, notes: 0, tasks: 1, ledger: 0, links: 0, notesUnlinked: 0 }, skipped: [], remaining: 0 }));
    }
    if (path === "/deals" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const items = [DEAL_A, DEAL_B].filter((item) => !q || item.title.includes(q)).map((item) => ({ ...item, dealType: "sale", ledger: null }));
      return route.fulfill(envelope({ items, nextCursor: null, undatedCount: 0 }));
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return { calls, tasks };
}

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 화면 주소·브라우저 저장소에 할 일 제목·거래가 남지 않았는지
async function expectNoTrace(page, path = "/admin/work/tasks/") {
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}
const row = (page, title) => page.locator("[data-tk-task]").filter({ hasText: title });

test("업무 세션이 꺼져 있으면 할 일이 켜지지 않았다고 알리고 할 일 자료는 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 360, enabled: false });
  await page.goto("/admin/work/tasks/");
  await expect(page.getByRole("heading", { name: "업무 도구가 켜지지 않았습니다" })).toBeVisible();
  await expect(page.getByRole("link", { name: "도구 모음으로" })).toBeVisible();
  expect(calls.all).toEqual(["GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("자료 구조가 옛날(6번 전)이면 갱신 전이라고 알리고, 잠깐 실패면 '다시 불러오기'로 다시 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, schemaOutdated: true });
  await page.goto("/admin/work/tasks/");
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-tk-state-body]")).toContainText("구조(6번)");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();

  await setup(page, { width: 360, failListOnce: true });
  await page.goto("/admin/work/tasks/");
  await expect(page.getByRole("heading", { name: "할 일을 불러오지 못했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.locator("[data-tk-count]")).toHaveText("열린 할 일 5개 보는 중 · 날짜 빠른 순");
  assertNoErrors();
});

for (const width of [360, 390, 430, 768, 1280]) {
  test(`할 일 ${width}px: 지난 할 일·오늘·이번 주·나중·날짜 없음 묶음, 지남·반복·말일·거래 상태를 글자로, 단추 44px, 가로 넘침 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const { calls } = await setup(page, { width });
    await page.goto("/admin/work/tasks/");
    await expect(page.locator(".tk-group__title")).toHaveText([
      "! 지난 할 일 1개", "오늘 · 11월 18일(수) 1개", "이번 주 · 11월 22일(일)까지 1개", /^나중/u, /^날짜 없음/u,
    ]);
    expect(calls.all).toEqual(["GET /session", "GET /tasks?limit=50"]);
    await expect(row(page, "가상 등기부등본 다시 떼기")).toContainText("11. 14.(토) · 4일 지남");
    await expect(row(page, "가상 등기부등본 다시 떼기")).toContainText("계약함");
    await expect(row(page, "가상 주간 매물 광고 갱신")).toContainText("↻ 매주 수요일");
    await expect(row(page, "가상 월세 입금 확인")).toContainText("(31일이 없는 달이라 말일)");
    await expect(row(page, "가상 월세 입금 확인")).toContainText("↻ 매월 31일");
    await expect(page.getByRole("button", { name: "끝냄: 가상 명함 다시 주문" })).toBeVisible();
    for (const name of ["끝냄: 가상 명함 다시 주문", "고치기: 가상 명함 다시 주문", "할 일 만들기", "끝낸 할 일 보기"]) {
      const box = await page.getByRole("button", { name }).boundingBox();
      expect(Math.round(box.height), `${name} 높이`).toBeGreaterThanOrEqual(44);
    }
    // 본문 글자는 16px 이상
    expect(await page.locator(".tk-row__meta").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expectNoTrace(page);
    if (width === 360 || width === 1280) await page.screenshot({ path: test.info().outputPath(`tasks-${width}.png`), fullPage: true });
    assertNoErrors();
  });
}

test("만들기(키보드만): 빈 제목은 칸에서 막고, 날짜를 넣어야 반복을 고르며, 끝내면 다음 날짜를 미리 보이고, CSRF로 저장한 뒤 새 줄을 표시한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 390 });
  await page.goto("/admin/work/tasks/");
  await expect(page.locator("[data-tk-count]")).toContainText("5개");
  await page.getByRole("button", { name: "할 일 만들기" }).focus();
  await page.keyboard.press("Enter");
  const title = page.locator("#tk-title");
  await expect(title).toBeFocused();
  const save = page.getByRole("button", { name: "할 일 저장" });
  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tk-title-error")).toHaveText("제목을 넣어 주세요.");
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute("aria-invalid", "true");
  expect(calls.writes).toEqual([]);

  await page.keyboard.type("  가상 매물 사진   다시 찍기 ");
  await expect(page.locator("[data-tk-title-count]")).toHaveText("19 / 80");
  const weekly = page.getByRole("radio", { name: "매주" });
  await expect(weekly).toBeDisabled();
  await expect(page.locator("[data-tk-repeat-help]")).toHaveText("날짜를 넣으면 고를 수 있습니다.");
  await page.locator("#tk-due").fill("2026-11-25");
  await expect(weekly).toBeEnabled();
  await page.getByRole("radio", { name: "없음" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(weekly).toBeChecked();
  await expect(page.locator("[data-tk-next]")).toHaveText("끝내면 다음 할 일: 12월 2일(수)");

  await page.locator("#tk-deal-q").focus();
  await page.keyboard.type("가상숲");
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-tk-deal-status]")).toHaveText("거래 1건을 찾았습니다. 붙일 거래를 고르세요.");
  await page.getByRole("radio", { name: "거래에 붙이지 않음" }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /가상숲1단지 84㎡ 매매/u })).toBeChecked();

  await save.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-tk-saved]")).toHaveText("✓ 할 일을 저장했습니다.");
  expect(calls.writes).toEqual([{ method: "POST", path: "/tasks", body: { title: "가상 매물 사진 다시 찍기", dueOn: "2026-11-25", repeat: "weekly", dealId: DEAL_A.id }, csrf: "test-csrf" }]);
  const fresh = row(page, "가상 매물 사진 다시 찍기");
  await expect(fresh).toHaveClass(/tk-row--fresh/u);
  await expect(fresh).toContainText("새로 만듦");
  await expect(fresh).toContainText("↻ 매주 수요일");
  await expect(page.locator("[data-tk-form]")).toBeHidden();
  await expect(page.getByRole("button", { name: "할 일 만들기" })).toBeFocused();
  await expectNoTrace(page);
  assertNoErrors();
});

test("끝냄: 반복 할 일은 서버가 만든 다음 할 일을 알리고 표시하며, 다시 열기는 다음 할 일이 남아 있을 때만 그렇다고 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 390 });
  await page.goto("/admin/work/tasks/");
  await page.getByRole("button", { name: "끝냄: 가상 주간 매물 광고 갱신" }).click();
  const saved = page.locator("[data-tk-saved]");
  await expect(saved).toHaveText("✓ '가상 주간 매물 광고 갱신'을(를) 끝냈습니다. 다음 할 일을 만들었습니다(11월 25일(수)).");
  await expect(saved).toBeFocused();
  expect(calls.writes.at(-1)).toEqual({ method: "PATCH", path: `/tasks/${uuid(2)}`, body: { version: 1, done: true }, csrf: "test-csrf" });
  const next = row(page, "가상 주간 매물 광고 갱신");
  await expect(next).toHaveCount(1);
  await expect(next).toContainText("11. 25.(수)");
  await expect(next).toContainText("새로 만듦");

  // 반복 없는 할 일 끝내기
  await page.getByRole("button", { name: "끝냄: 가상 명함 다시 주문" }).click();
  await expect(saved).toHaveText("✓ '가상 명함 다시 주문'을(를) 끝냈습니다.");

  await page.getByRole("button", { name: "끝낸 할 일 보기" }).click();
  await expect(page.locator("[data-tk-count]")).toHaveText("끝낸 할 일 3개 보는 중 · 끝낸 때 최근 순");
  await expect(page.locator("[data-tk-done-list] [data-tk-task]").last()).toContainText("끝냄 11. 17.(화)");
  await expect(page.getByRole("button", { name: "할 일 만들기" })).toBeHidden();
  await page.getByRole("button", { name: "다시 열기: 가상 주간 매물 광고 갱신" }).click();
  await expect(saved).toHaveText("✓ '가상 주간 매물 광고 갱신'을(를) 다시 열었습니다. 열린 할 일로 옮겼습니다. 다음 할 일(11월 25일(수))은 따로 남아 있습니다.");
  await expect(page.getByRole("button", { name: "다시 열기: 가상 주간 매물 광고 갱신" })).toHaveCount(0);
  await page.getByRole("button", { name: "다시 열기: 가상 명함 다시 주문" }).click();
  await expect(saved).toHaveText("✓ '가상 명함 다시 주문'을(를) 다시 열었습니다. 열린 할 일로 옮겼습니다.");
  await page.getByRole("button", { name: "← 열린 할 일로" }).click();
  await expect(row(page, "가상 주간 매물 광고 갱신")).toHaveCount(2);
  await expectNoTrace(page);
  assertNoErrors();
});

test("고치기: 그 줄 자리에서 바뀐 칸만 version과 함께 보내고, 409면 넣던 값을 지우지 않고 '새 값 보기'로 다시 채운다. 지우기는 한 번 더 묻는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 360, conflictOnce: true });
  await page.goto("/admin/work/tasks/");
  await page.getByRole("button", { name: "고치기: 가상 잔금일 안내 문자 보내기" }).click();
  const form = page.locator("[data-tk-form]");
  await expect(form.locator("[data-tk-form-title]")).toHaveText("할 일 고치기");
  await expect(page.locator(".tk-row--editing [data-tk-form]")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: /가상숲1단지 84㎡ 매매/u })).toBeChecked();
  const title = page.locator("#tk-title");
  await expect(title).toBeFocused();
  await title.fill("가상 잔금일 안내 문자 미리 보내기");
  await page.getByRole("button", { name: "고친 것 저장" }).click();
  await expect(page.locator("[data-tk-form-status]")).toContainText("넣던 값은 그대로 있습니다");
  await expect(title).toHaveValue("가상 잔금일 안내 문자 미리 보내기");
  expect(calls.writes.at(-1).body).toEqual({ title: "가상 잔금일 안내 문자 미리 보내기", version: 1 });
  await page.getByRole("button", { name: "새 값 보기" }).click();
  await expect(title).toHaveValue("가상 다른 화면에서 고친 제목");
  await expect(page.locator("[data-tk-form-status]")).toHaveText("새 값을 불러왔습니다. 다시 고친 뒤 저장해 주세요.");

  await page.getByRole("button", { name: "이 할 일 지우기" }).click();
  await expect(page.getByRole("heading", { name: "이 할 일을 지울까요?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "지우기", exact: true })).toBeFocused();
  expect(calls.writes.filter((item) => item.method === "DELETE")).toEqual([]);
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  await expect(page.locator("[data-tk-saved]")).toHaveText("✓ 할 일을 휴지통으로 옮겼습니다. 되살리기 · 휴지통 보기");
  expect(calls.writes.at(-1)).toEqual({ method: "DELETE", path: `/tasks/${uuid(3)}`, body: {}, csrf: "test-csrf" });
  await expect(row(page, "가상 다른 화면에서 고친 제목")).toHaveCount(0);
  await expect(page.locator("[data-tk-count]")).toHaveText("열린 할 일 4개 보는 중 · 날짜 빠른 순");
  await expectNoTrace(page);
  // 알림의 '되살리기': 휴지통 묶음 id로 되살리고 목록을 다시 읽는다(빈 본문, 보안 토큰)
  await page.locator("[data-tk-saved]").getByRole("button", { name: "되살리기" }).click();
  await expect(page.locator("[data-tk-saved]")).toHaveText("✓ 할 일을 되살렸습니다.");
  await expect(page.locator("[data-tk-saved]")).toBeFocused();
  expect(calls.writes.at(-1)).toEqual({ method: "POST", path: "/trash/" + uuid(990) + "/restore", body: {}, csrf: "test-csrf" });
  await expect(row(page, "가상 다른 화면에서 고친 제목")).toHaveCount(1);
  await expect(page.locator("[data-tk-count]")).toHaveText("열린 할 일 5개 보는 중 · 날짜 빠른 순");
  await expectNoTrace(page);
  assertNoErrors();
});

test("반복 할 일을 지우려 하면 다음 할 일도 더 만들어지지 않는다고 묻는다", async ({ page }) => {
  await setup(page, { width: 390 });
  await page.goto("/admin/work/tasks/");
  await page.getByRole("button", { name: "고치기: 가상 월세 입금 확인" }).click();
  await expect(page.locator("[data-tk-next]")).toHaveText("끝내면 다음 할 일: 12월 31일(목)");
  await page.getByRole("button", { name: "이 할 일 지우기" }).click();
  await expect(page.locator("[data-tk-delete-text]")).toHaveText("휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다. 반복 할 일이라 휴지통에 있는 동안 다음 할 일은 만들어지지 않습니다.");
  await page.getByRole("button", { name: "그만두기" }).last().click();
  await expect(page.getByRole("button", { name: "이 할 일 지우기" })).toBeFocused();
});

test("거래로 거르기: 줄의 거래 이름을 누르면 그 거래의 할 일만 서버에 묻고(주소는 그대로), '거르기 풀기'로 돌아간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 390 });
  await page.goto("/admin/work/tasks/");
  await row(page, "가상 등기부등본 다시 떼기").getByRole("button", { name: /이 거래의 할 일만 보기/u }).click();
  await expect(page.locator("[data-tk-count]")).toHaveText("거래 가상숲1단지 84㎡ 매매계약함의 할 일 2개");
  expect(calls.all.at(-1)).toBe(`GET /tasks?dealId=${DEAL_A.id}&limit=50`);
  await expect(page.locator("[data-tk-task]")).toHaveCount(2);
  await expect(page.locator("[data-tk-deal]"), "거르는 중에는 거래 이름이 단추가 아님").toHaveCount(0);
  await expectNoTrace(page);
  await page.getByRole("button", { name: "거르기 풀기" }).click();
  await expect(page.locator("[data-tk-count]")).toHaveText("열린 할 일 5개 보는 중 · 날짜 빠른 순");
  assertNoErrors();
});

test("열린 할 일이 0건이면 0건 안내와 함께 만들기 칸을 열어 두되 포커스는 옮기지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, tasks: [] });
  await page.goto("/admin/work/tasks/");
  await expect(page.getByRole("heading", { name: "할 일이 없습니다" })).toBeVisible();
  const form = page.locator("[data-tk-form]");
  await expect(form).toBeVisible();
  await expect(form).toHaveClass(/tk-form--strong/u);
  await expect(page.locator("#tk-title")).not.toBeFocused();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("메뉴 A안: '할 일'은 도구 모음 · 달력 바로 뒤에 있고 할 일 화면에서 지금 화면으로 표시된다(2026-11-26 사용자 답 08:59:51)", async ({ page }) => {
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/tasks/");
  const links = page.locator(".admin-subtabs a[href^='/admin/work/']");
  const hrefs = await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")));
  const start = hrefs.lastIndexOf("/admin/work/");
  expect(hrefs.slice(start, start + 4)).toEqual(["/admin/work/", "/admin/work/calendar/", "/admin/work/tasks/", "/admin/work/customers/"]);
  await expect(page.locator(".admin-subtabs").getByRole("link", { name: "할 일", exact: true })).toHaveAttribute("aria-current", "page");
});

for (const [label, options, expected] of [
  ["0개", { tasks: [] }, { items: 0, state: "오늘까지 할 일이 없습니다.", link: "할 일 만들기" }],
  ["5개", { tasks: dueTasks(5) }, { items: 5, state: null, link: "할 일 화면으로" }],
  ["8개", { tasks: dueTasks(8) }, { items: 5, state: null, link: "할 일 8개 모두 보기" }],
]) {
  test(`업무 도구 처음 '오늘 할 일' 칸 ${label}: 오늘까지 열린 할 일을 5개까지 보이고 할 일 화면으로 잇는다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const { calls } = await setup(page, { width: 360, ...options });
    await page.goto("/admin/work/");
    await expect(page.locator("[data-tk-home-link]")).toBeVisible();
    await expect(page.locator("[data-tk-home-link-text]")).toHaveText(expected.link);
    await expect(page.locator(".tk-home__item")).toHaveCount(expected.items);
    if (expected.state) await expect(page.locator("[data-tk-home-state]")).toHaveText(expected.state);
    else await expect(page.locator("[data-tk-home-state]")).toBeHidden();
    if (expected.items > 0) {
      await expect(page.locator(".tk-home__item").first()).toContainText("! 3일 지남");
      await expect(page.locator(".tk-home__item").nth(1)).toContainText("오늘");
      await expect(page.locator(".tk-home__item").first()).toHaveAttribute("href", "/admin/work/tasks/");
    }
    expect(calls.all).toEqual(["GET /session", `GET /tasks?until=${TODAY}&limit=50`]);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expectNoTrace(page, "/admin/work/");
    if (label === "8개") await page.locator("[data-tk-home]").screenshot({ path: test.info().outputPath("home-card-360.png") });
    assertNoErrors();
  });
}

test("업무 도구 처음 '오늘 할 일' 칸: 꺼져 있으면 한 줄로 알리고 할 일 목록은 부르지 않으며, 머리는 저장하는 것과 안 하는 것을 나눠 적는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 1280, enabled: false });
  await page.goto("/admin/work/");
  await expect(page.locator("[data-tk-home-state]")).toHaveText("업무 도구가 켜지면 할 일을 볼 수 있습니다.");
  await expect(page.locator("[data-tk-home-link]")).toBeHidden();
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();
  expect(calls.all).toEqual(["GET /session"]);
  await expect(page.locator("main")).not.toContainText("단계 0 · 저장하지 않는 도구");
  assertNoErrors();
});

// 떠나려 할 때 브라우저가 묻는지(beforeunload 창). 물으면 '머무르기'를 골라 화면이 그대로 남는다.
async function asksBeforeLeaving(page) {
  const dialogs = [];
  const onDialog = async (dialog) => {
    dialogs.push(dialog.type());
    await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => dialogs.length > 0 || page.isClosed(), { timeout: 3000 }).toBe(true);
  page.off("dialog", onDialog);
  return dialogs.length > 0 && dialogs.every((type) => type === "beforeunload") && !page.isClosed();
}

test("이탈 경고: 만들기·고치기 칸에 바뀐 값이 있으면 떠나기 전에 묻고, 열기만 했거나 0건이라 열려 있는 빈 칸이면 묻지 않는다", async ({ context }) => {
  const fresh = async (options = {}) => {
    const page = await context.newPage();
    await setup(page, { width: 390, ...options });
    await page.goto("/admin/work/tasks/");
    await expect(page.locator("[data-tk-count]")).toBeVisible();
    return page;
  };
  let page = await fresh();
  await page.getByRole("button", { name: "할 일 만들기" }).click();
  await expect(page.locator("#tk-title")).toBeFocused();
  expect(await asksBeforeLeaving(page), "만들기 칸을 열기만 함").toBe(false);

  page = await fresh();
  await page.getByRole("button", { name: "할 일 만들기" }).click();
  await page.locator("#tk-title").fill("가상 쓰던 할 일");
  expect(await asksBeforeLeaving(page), "만들기 칸에 제목을 씀").toBe(true);
  await expect(page.locator("#tk-title")).toHaveValue("가상 쓰던 할 일");
  await page.close();

  page = await fresh();
  await page.getByRole("button", { name: "고치기: 가상 잔금일 안내 문자 보내기" }).click();
  await expect(page.locator("#tk-title")).toHaveValue("가상 잔금일 안내 문자 보내기");
  expect(await asksBeforeLeaving(page), "고치기 칸을 열기만 함").toBe(false);

  page = await fresh();
  await page.getByRole("button", { name: "고치기: 가상 잔금일 안내 문자 보내기" }).click();
  await page.locator("#tk-due").fill("2026-11-27");
  expect(await asksBeforeLeaving(page), "고치기 칸의 날짜를 바꿈").toBe(true);
  await expect(page.locator("#tk-due")).toHaveValue("2026-11-27");
  await page.close();

  page = await context.newPage();
  await setup(page, { width: 360, tasks: [] });
  await page.goto("/admin/work/tasks/");
  await expect(page.getByRole("heading", { name: "할 일이 없습니다" })).toBeVisible();
  await expect(page.locator("[data-tk-form]")).toBeVisible();
  expect(await asksBeforeLeaving(page), "0건이라 열려 있는 빈 만들기 칸").toBe(false);
});
