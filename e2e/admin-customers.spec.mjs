// 손님·손님 카드·메모 창고(단계 2, /admin/work/customers/·customers/detail/·notes/)를 가짜 업무 API로 본다.
// 사용자 선택 2026-11-21 02:26:01: 목록 "A 한 열 카드", 카드 "A 차례대로", "손님 상세에 일정 함께 담기", 메뉴 "손님 화면 안 링크로만".
// 이름·전화·찾는 조건·메모는 모두 지어낸 값(가상 손님 n, 010-0000-000n)이고 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-21T03:00:00Z"); // 한국 12:00
const TODAY = "2026-11-21";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });

function customer(n, extra = {}) {
  return {
    id: uuid(n),
    displayName: `가상 손님 ${n}`,
    phoneDigits: `0100000000${n}`.slice(0, 11),
    needs: `가상숲${n}단지 84㎡ 매매, 4억 중반까지`,
    status: "consulting",
    lastContactOn: "2026-11-19",
    retentionUntil: "2027-11-19",
    version: 1,
    createdAt: "2026-11-01T01:00:00.000Z",
    updatedAt: `2026-11-${String(10 + n).padStart(2, "0")}T01:00:00.000Z`,
    ...extra,
  };
}
const event = (id, dealId, dueOn, title, doneAt = null) => ({ id: uuid(id), dealId, kind: "custom", dueOn, title, source: "manual", doneAt, version: 1 });
const note = (n, body, extra = {}) => ({ id: uuid(500 + n), customerId: null, dealId: null, body, source: "manual", fileId: null, version: 1, createdAt: `2026-11-2${n % 2}T0${n}:10:00.000Z`, updatedAt: `2026-11-2${n % 2}T0${n}:10:00.000Z`, ...extra });

function makeStore({ customers, count } = {}) {
  const list = customers ?? (count
    ? Array.from({ length: count }, (_, index) => customer(index + 1))
    : [
      customer(1),
      customer(2, { status: "contracting", needs: "가상강변마을 84㎡ 전세, 보증금 3억 안쪽" }),
      customer(3, { phoneDigits: null, status: "on_hold" }),
      customer(4, { status: "completed", lastContactOn: "2025-10-01", retentionUntil: "2026-10-01" }),
    ]);
  const deal1 = uuid(101);
  return {
    customers: list.map((item) => ({ ...item })),
    deals: {
      [uuid(1)]: [
        { id: deal1, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: "contracted", role: "buyer", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [event(201, deal1, "2026-11-10", "계약", "2026-11-10T03:00:00.000Z"), event(202, deal1, "2026-11-24", "중도금"), event(203, deal1, "2026-12-20", "잔금")] },
        { id: deal1, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: "contracted", role: "other", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [event(201, deal1, "2026-11-10", "계약", "2026-11-10T03:00:00.000Z"), event(202, deal1, "2026-11-24", "중도금"), event(203, deal1, "2026-12-20", "잔금")] },
        { id: uuid(102), title: "가상강변마을 59㎡ 전세", dealType: "jeonse", status: "open", role: "tenant", version: 1, updatedAt: "2026-11-17T01:00:00.000Z", events: [] },
      ],
    },
    notes: [
      note(1, "가상 손님 1 통화. 다음 주 토요일 방문.", { customerId: uuid(1) }),
      note(2, "모르는 번호 010-0000-0009 전화. 천동 59㎡ 전세 찾음."),
      note(3, "가상숲2단지 관리사무소: 주차 1.2대."),
    ],
  };
}

// 늘 같은 시각에서 시작하고 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
// failCustomerReadAfterNote: 손님 메모 저장(POST /notes) 바로 뒤의 손님 카드 읽기 한 번만 503으로 실패시킨다.
async function setup(page, { width = 390, enabled = true, store = makeStore(), patchConflict = false, failCustomerReadAfterNote = false } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  let nextId = 900;
  let failNextCustomerRead = false;
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    calls.all.push(`${method} ${path}${url.search}`);
    const body = method === "GET" ? null : request.postDataJSON();
    if (method !== "GET") {
      calls.writes.push({ method, path, body, csrf: request.headers()["x-admin-csrf"] ?? null, type: request.headers()["content-type"] ?? "" });
      if (request.headers()["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: "시험 관리자", csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 4 : null }));
    if (!enabled) return route.fulfill(failure(503, "WORK_DISABLED"));

    if (path === "/customers" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const status = url.searchParams.get("status");
      const digits = /^[\d\s-]+$/u.test(q) ? q.replace(/\D/gu, "") : "";
      const found = store.customers
        .filter((item) => !status || item.status === status)
        .filter((item) => !q || item.displayName.toLowerCase().includes(q) || item.needs.toLowerCase().includes(q) || (digits.length >= 3 && (item.phoneDigits ?? "").includes(digits)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const items = found.slice(start, start + limit);
      return route.fulfill(envelope({ items, nextCursor: start + limit < found.length ? String(start + limit) : null }));
    }
    if (path === "/customers" && method === "POST") {
      const created = customer(nextId++, { ...body, phoneDigits: body.phoneDigits ?? null, lastContactOn: TODAY, retentionUntil: "2027-11-21", updatedAt: "2026-11-21T03:00:00.000Z" });
      created.displayName = body.displayName;
      store.customers.push(created);
      return route.fulfill(envelope({ customer: created }, 201));
    }
    const customerMatch = path.match(/^\/customers\/([^/]+)$/u);
    if (customerMatch) {
      const index = store.customers.findIndex((item) => item.id === decodeURIComponent(customerMatch[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const current = store.customers[index];
      if (method === "GET") {
        if (failNextCustomerRead) {
          failNextCustomerRead = false;
          return route.fulfill(failure(503, "TEST_OFFLINE"));
        }
        return route.fulfill(envelope({ customer: current, deals: store.deals[current.id] ?? [], notes: store.notes.filter((item) => item.customerId === current.id), files: [] }));
      }
      if (method === "PATCH") {
        if (patchConflict || body.version !== current.version) {
          patchConflict = false;
          store.customers[index] = { ...current, needs: "다른 화면에서 고친 조건", version: current.version + 1 };
          return route.fulfill(failure(409, "VERSION_CONFLICT"));
        }
        const { version, ...changes } = body;
        store.customers[index] = { ...current, ...changes, version: version + 1 };
        return route.fulfill(envelope({ customer: store.customers[index] }));
      }
      if (method === "DELETE") {
        if (body.confirmName !== current.displayName) return route.fulfill(failure(400, "CONFIRMATION_MISMATCH"));
        store.customers.splice(index, 1);
        const removed = store.notes.filter((item) => item.customerId === current.id).length;
        store.notes = store.notes.filter((item) => item.customerId !== current.id);
        return route.fulfill(envelope({ deleted: { customers: 1, deals: 1, notes: removed, files: 0, tasks: 2 }, kept: { notes: 1 } }));
      }
    }
    if (path === "/notes" && method === "GET") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const items = store.notes
        .filter((item) => url.searchParams.get("inbox") !== "1" || (!item.customerId && !item.dealId))
        .filter((item) => !q || item.body.toLowerCase().includes(q))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return route.fulfill(envelope({ items, nextCursor: null }));
    }
    if (path === "/notes" && method === "POST") {
      const created = note(0, body.body, { id: uuid(nextId++), customerId: body.customerId ?? null, createdAt: "2026-11-21T03:00:00.000Z", updatedAt: "2026-11-21T03:00:00.000Z" });
      store.notes.push(created);
      const owner = store.customers.find((item) => item.id === body.customerId);
      if (owner) owner.lastContactOn = TODAY;
      if (owner && failCustomerReadAfterNote) failNextCustomerRead = true;
      return route.fulfill(envelope({ note: created }, 201));
    }
    const noteMatch = path.match(/^\/notes\/([^/]+)$/u);
    if (noteMatch) {
      const index = store.notes.findIndex((item) => item.id === decodeURIComponent(noteMatch[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      if (method === "PATCH") {
        const { version, ...changes } = body;
        if (version !== store.notes[index].version) return route.fulfill(failure(409, "VERSION_CONFLICT"));
        store.notes[index] = { ...store.notes[index], ...changes, version: version + 1 };
        return route.fulfill(envelope({ note: store.notes[index] }));
      }
      if (method === "DELETE") {
        store.notes.splice(index, 1);
        return route.fulfill(envelope({ deleted: true }));
      }
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return calls;
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
// 화면 주소·브라우저 저장소에 손님 이름·전화가 남지 않았는지
async function expectNoPersonalTrace(page) {
  const url = decodeURIComponent(page.url());
  expect(url).not.toMatch(/가상 손님|0100000000|가상숲/u);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}

test("업무 세션이 꺼져 있으면 손님·손님 카드·메모 창고 모두 켜지지 않았다고 알리고 손님 자료는 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, enabled: false });
  for (const path of ["/admin/work/customers/", `/admin/work/customers/detail/?id=${uuid(1)}`, "/admin/work/notes/"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "손님 자료 저장이 아직 켜지지 않았습니다" })).toBeVisible();
    await expect(page.getByRole("link", { name: "업무 도구 처음으로" })).toBeVisible();
  }
  expect(calls.all).toEqual(["GET /session", "GET /session", "GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

for (const width of [360, 390, 1280]) {
  test(`손님 목록 ${width}px: 한 열 카드, 상태 거르기·찾기는 서버에 묻고, 0건이면 까닭과 지우기 단추, 가로 넘침 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await page.goto("/admin/work/customers/");
    const cards = page.locator(".cu-card");
    await expect(cards).toHaveCount(4);
    await expect(page.locator("[data-cu-count]")).toHaveText("손님 4명 · 최근 고친 순");
    await expect(cards.first().locator(".cu-card__name")).toHaveText("가상 손님 4");
    await expect(cards.first().locator(".cu-cleanup")).toHaveText("정리할 때 지남");
    await expect(cards.nth(1).locator(".cu-card__nophone")).toHaveText("전화번호 없음");
    await expect(cards.nth(3).locator(".cu-card__call")).toHaveAttribute("href", "tel:01000000001");
    await expect(cards.nth(3).locator(".cu-card__link")).toHaveAttribute("href", `/admin/work/customers/detail/?id=${uuid(1)}`);
    await expect(page.getByRole("link", { name: "메모 창고", exact: true })).toHaveAttribute("href", "/admin/work/notes/");
    // 메뉴: '손님'이 지금 화면, 메모 창고는 메뉴에 없음
    await expect(page.locator('.admin-subtabs a[href="/admin/work/customers/"], .admin-menu a[href="/admin/work/customers/"]').first()).toHaveAttribute("aria-current", "page");
    await expect(page.locator('.admin-subtabs a[href="/admin/work/notes/"], .admin-menu a[href="/admin/work/notes/"]')).toHaveCount(0);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "계약 진행" }).click();
    await expect(cards).toHaveCount(1);
    await expect(page.getByRole("button", { name: "계약 진행" })).toHaveAttribute("aria-pressed", "true");
    expect(calls.all.at(-1)).toBe("GET /customers?status=contracting&limit=20");
    await page.getByRole("button", { name: "전체", exact: true }).click();
    await page.locator("#cu-q").fill(" 0000-0003 ");
    await page.locator("#cu-q").press("Enter");
    await expect(cards).toHaveCount(0);
    expect(decodeURIComponent(calls.all.at(-1))).toBe("GET /customers?q=0000-0003&limit=20");
    await expect(page.getByRole("heading", { name: "찾는 손님이 없습니다" })).toBeVisible();
    await page.locator("[data-cu-empty-clear]").click();
    await expect(cards).toHaveCount(4);
    await expect(page.locator("#cu-q")).toHaveValue("");
    await expectNoPersonalTrace(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("손님 목록: 20명씩 보이고 '20명 더 보기'로 다음을 이어 붙이며, 손님이 없으면 '새 손님' 단추를 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, store: makeStore({ count: 23 }) });
  await page.goto("/admin/work/customers/");
  await expect(page.locator(".cu-card")).toHaveCount(20);
  await expect(page.locator("[data-cu-count]")).toHaveText("손님 20명 이상 · 최근 고친 순");
  await page.getByRole("button", { name: "20명 더 보기" }).click();
  await expect(page.locator(".cu-card")).toHaveCount(23);
  await expect(page.getByRole("button", { name: "20명 더 보기" })).toBeHidden();
  expect(calls.all.at(-1)).toBe("GET /customers?cursor=20&limit=20");

  await setup(page, { width: 360, store: makeStore({ customers: [] }) });
  await page.goto("/admin/work/customers/");
  await expect(page.getByRole("heading", { name: "아직 손님이 없습니다" })).toBeVisible();
  await page.locator("[data-cu-empty-new]").click();
  await expect(page.locator("#cu-new-name")).toBeFocused();
  assertNoErrors();
});

test("새 손님: 이름이 비면 칸 아래 오류, 저장은 CSRF 머리말과 숫자만 남긴 전화로 보내고 '손님 카드 열기'는 무작위 ID 주소", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/customers/");
  await page.getByRole("button", { name: "새 손님" }).click();
  await expect(page.locator("#cu-new-name")).toBeFocused();
  await page.getByRole("button", { name: "손님 저장" }).click();
  await expect(page.locator("#cu-new-name-error")).toContainText("이름을 넣어 주세요");
  await expect(page.locator("#cu-new-name")).toHaveAttribute("aria-invalid", "true");
  expect(calls.writes).toEqual([]);

  await page.locator("#cu-new-name").fill("가상 손님 9");
  await page.locator("#cu-new-phone").fill("010-0000-0009");
  await page.locator("#cu-new-needs").fill("천동 59㎡ 전세");
  await page.getByRole("radio", { name: "계약 진행" }).check();
  await page.getByRole("button", { name: "손님 저장" }).click();
  await expect(page.locator("[data-cu-done-text]")).toHaveText("✓ '가상 손님 9'을(를) 넣었습니다.");
  expect(calls.writes).toEqual([{ method: "POST", path: "/customers", body: { displayName: "가상 손님 9", phoneDigits: "01000000009", needs: "천동 59㎡ 전세", status: "contracting" }, csrf: "test-csrf", type: "application/json" }]);
  await expect(page.locator("[data-cu-done-link]")).toHaveAttribute("href", `/admin/work/customers/detail/?id=${uuid(900)}`);
  await expect(page.locator(".cu-card")).toHaveCount(5);
  await expect(page.locator(".cu-card").first().locator(".cu-card__name")).toHaveText("가상 손님 9");
  await expect(page.locator("[data-cu-new-panel]")).toBeHidden();
  await expectNoPersonalTrace(page);
  assertNoErrors();
});

for (const width of [360, 1280]) {
  test(`손님 카드 ${width}px: 기본 정보 → 거래·일정(역할 둘인 거래는 하나로) → 메모 → 파일, 메모 저장은 손님 ID와 함께`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("가상 손님 1");
    await expect(page).toHaveTitle("손님 카드 | 행복한부동산 관리자");
    await expect(page.locator("[data-cu-call]")).toHaveAttribute("href", "tel:01000000001");
    await expect(page.locator("[data-cu-sms]")).toHaveAttribute("href", "sms:01000000001");
    await expect(page.locator("[data-cu-phone]")).toHaveText("010-0000-0001");
    await expect(page.locator("[data-cu-contact-on]")).toHaveText("11. 19. · 2일 전");
    const titles = await page.locator(".cu-block__title").evaluateAll((nodes) => nodes.map((node) => node.firstChild.textContent.trim()));
    expect(titles).toEqual(["기본 정보", "거래·일정", "메모", "파일"]);
    const deals = page.locator(".cu-deal");
    await expect(deals).toHaveCount(2);
    await expect(page.locator("[data-cu-deals-count]")).toHaveText("2건");
    await expect(deals.first().locator(".cu-deal__meta")).toHaveText("매매 · 매수인·기타 · 계약함");
    await expect(deals.first().locator(".cu-event")).toHaveText(["11. 10.계약✓ 끝남", "11. 24.중도금3일 남음", "12. 20.잔금29일 남음"]);
    await expect(deals.nth(1)).toContainText("아직 일정이 없습니다.");
    await expect(page.locator("[data-cu-files-text]")).toContainText("파일 저장소가 아직 켜지지 않았습니다");
    await expect(page.locator(".cu-notes .cu-memo")).toHaveCount(1);
    const bar = page.locator("[data-cu-bar]");
    if (width < 980) {
      await expect(bar).toBeVisible();
      await page.getByRole("button", { name: "메모 추가" }).click();
      await expect(page.locator("#cu-memo")).toBeFocused();
    } else {
      await expect(bar).toBeHidden();
      const [side, main] = await Promise.all([page.locator(".cu-two__side").boundingBox(), page.locator(".cu-two__main").boundingBox()]);
      expect(side.x + side.width, "PC는 기본 정보가 왼쪽").toBeLessThanOrEqual(main.x);
    }
    await page.locator("#cu-memo").fill("가상 손님 1 통화. 잔금일 확인함.");
    await page.getByRole("button", { name: "메모 저장" }).click();
    await expect(page.locator("[data-cu-memo-status]")).toHaveText("✓ 메모를 저장했습니다.");
    expect(calls.writes.at(-1)).toMatchObject({ method: "POST", path: "/notes", body: { body: "가상 손님 1 통화. 잔금일 확인함.", customerId: uuid(1) }, csrf: "test-csrf" });
    await expect(page.locator(".cu-notes .cu-memo")).toHaveCount(2);
    await expect(page.locator("[data-cu-contact-on]")).toHaveText("11. 21. · 오늘");
    await expect(page.locator("#cu-memo")).toHaveValue("");
    await expectNoPersonalTrace(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("손님 카드 고치기: 바뀐 칸과 version만 보내고, 다른 화면이 먼저 고쳤으면(409) 저장하지 않고 '다시 불러오기'로 새 내용을 채운다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390, patchConflict: true });
  await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
  await page.getByRole("button", { name: "고치기" }).click();
  await expect(page.locator("#cu-edit-name")).toHaveValue("가상 손님 1");
  await expect(page.locator("#cu-edit-phone")).toHaveValue("010-0000-0001");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(page.locator("[data-cu-edit-status]")).toHaveText("바뀐 것이 없습니다.");
  expect(calls.writes).toEqual([]);

  await page.getByRole("radio", { name: "계약 진행" }).check();
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(page.locator("[data-cu-edit-status]")).toContainText("다른 화면에서 먼저 고쳐서");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", path: `/customers/${uuid(1)}`, body: { version: 1, status: "contracting" } });
  await page.locator("[data-cu-edit-reload]").click();
  await expect(page.locator("#cu-edit-needs")).toHaveValue("다른 화면에서 고친 조건");
  await page.getByRole("radio", { name: "계약 진행" }).check();
  await page.locator("#cu-edit-phone").fill("");
  await page.getByRole("button", { name: "고친 내용 저장" }).click();
  await expect(page.locator("[data-cu-basic-status]")).toHaveText("✓ 고친 내용을 저장했습니다.");
  expect(calls.writes.at(-1).body).toEqual({ version: 2, phoneDigits: null, status: "contracting" });
  await expect(page.locator("[data-cu-head-status] .cu-status")).toHaveText("계약 진행");
  await expect(page.locator("[data-cu-contact]")).toBeHidden();
  await expect(page.locator("[data-cu-phone]")).toHaveText("없음");
  assertNoErrors();
});

test("손님 카드 메모: 저장은 됐는데 다시 읽기만 실패하면 '저장했습니다'와 '다시 불러오기'를 보이고, 메모는 한 번만 보낸다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, failCustomerReadAfterNote: true });
  await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
  await expect(page.locator(".cu-notes .cu-memo")).toHaveCount(1);
  const status = page.locator("[data-cu-memo-status]");
  const reload = page.locator("[data-cu-memo-reload]");
  await expect(reload).toBeHidden();
  await page.locator("#cu-memo").fill("가상 손님 1 통화. 다시 읽기 실패 시험.");
  await page.getByRole("button", { name: "메모 저장" }).click();
  await expect(status).toContainText("메모는 저장했습니다");
  await expect(status).not.toContainText("저장하지 못했습니다");
  await expect(page.locator("#cu-memo")).toHaveValue("");
  await expect(reload).toBeVisible();
  await expect(page.locator(".cu-notes .cu-memo")).toHaveCount(1);
  await reload.click();
  await expect(status).toHaveText("✓ 손님 카드를 새로 읽었습니다.");
  await expect(reload).toBeHidden();
  await expect(page.locator(".cu-notes .cu-memo")).toHaveCount(2);
  await expect(page.locator("[data-cu-contact-on]")).toHaveText("11. 21. · 오늘");
  expect(calls.writes.filter((write) => write.path === "/notes")).toHaveLength(1);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("손님 지우기: 이름이 한 글자라도 다르면 '지우기'가 눌리지 않고, 똑같이 넣으면 confirmName으로 지운 뒤 남긴 메모를 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
  await page.getByRole("button", { name: "손님 지우기" }).click();
  await expect(page.locator("#cu-delete-confirm")).toBeFocused();
  await expect(page.locator("[data-cu-delete-name]")).toHaveText("'가상 손님 1'");
  const go = page.locator("[data-cu-delete-go]");
  await page.locator("#cu-delete-confirm").fill("가상손님 1");
  await expect(go).toBeDisabled();
  await page.locator("#cu-delete-confirm").fill("가상 손님 1");
  await expect(go).toBeEnabled();
  await go.click();
  await expect(page.getByRole("heading", { name: "손님을 지웠습니다" })).toBeVisible();
  await expect(page.locator("[data-cu-gone-text]")).toContainText("메모 1개는 그 거래 기록이라 남겼습니다");
  await expect(page.locator("[data-cu-gone-text]")).toContainText("할 일 2개");
  expect(calls.writes.at(-1)).toMatchObject({ method: "DELETE", path: `/customers/${uuid(1)}`, body: { confirmName: "가상 손님 1" }, csrf: "test-csrf" });
  await expect(page.locator("[data-cu-main]")).toBeHidden();
  await expect(page.locator("[data-cu-bar]")).toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("손님 카드");
  assertNoErrors();
});

test("손님 카드: 주소의 id가 UUID가 아니면 서버에 묻지 않고, 없는 손님이면 '이 손님을 찾지 못했습니다'와 목록 링크", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await page.goto("/admin/work/customers/detail/?id=가상손님");
  await expect(page.getByRole("heading", { name: "이 손님을 찾지 못했습니다" })).toBeVisible();
  expect(calls.all).toEqual([]);
  await page.goto(`/admin/work/customers/detail/?id=${uuid(77)}`);
  await expect(page.getByRole("heading", { name: "이 손님을 찾지 못했습니다" })).toBeVisible();
  await expect(page.getByRole("link", { name: "손님 목록으로" })).toHaveAttribute("href", "/admin/work/customers/");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();
  assertNoErrors();
});

for (const width of [360, 1280]) {
  test(`메모 창고 ${width}px: 손님과 잇지 않은 메모만, 빠른 메모는 손님 없이 저장하고 '손님에게 옮기기'는 찾은 손님을 골라 옮긴다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await page.goto("/admin/work/notes/");
    const memos = page.locator("[data-nt-list] > .cu-memo");
    await expect(memos).toHaveCount(2);
    await expect(page.locator("[data-nt-count]")).toHaveText("메모 2개 · 최근 쓴 순");
    expect(calls.all).toContain("GET /notes?inbox=1&limit=20");
    await expect(page.locator('.admin-subtabs a[aria-current="page"], .admin-menu a[aria-current="page"]')).toHaveCount(0);

    await page.locator("#nt-memo").fill("가상숲3단지 매물 문의 전화. 이름 못 물어봄.");
    await page.getByRole("button", { name: "메모 저장" }).click();
    await expect(page.locator("[data-nt-memo-status]")).toHaveText("✓ 메모를 저장했습니다.");
    expect(calls.writes.at(-1)).toMatchObject({ method: "POST", path: "/notes", body: { body: "가상숲3단지 매물 문의 전화. 이름 못 물어봄." } });
    expect(calls.writes.at(-1).body).not.toHaveProperty("customerId");
    await expect(memos).toHaveCount(3);

    const target = memos.filter({ hasText: "모르는 번호" });
    await target.getByRole("button", { name: "손님에게 옮기기" }).click();
    const move = target.locator(".cu-move");
    await expect(move.getByRole("searchbox")).toBeFocused();
    await move.getByRole("searchbox").fill("가상 손님 2");
    await move.getByRole("searchbox").press("Enter");
    await expect(move.locator(".cu-move__opt")).toHaveCount(1);
    await expect(move.getByRole("button", { name: "이 손님에게 옮기기" })).toBeDisabled();
    await move.getByRole("radio").check();
    await move.getByRole("button", { name: "이 손님에게 옮기기" }).click();
    await expect(page.locator("[data-nt-done-text]")).toHaveText("✓ 메모를 '가상 손님 2' 손님 카드로 옮겼습니다.");
    await expect(page.locator("[data-nt-done-link]")).toHaveAttribute("href", `/admin/work/customers/detail/?id=${uuid(2)}`);
    expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", path: `/notes/${uuid(502)}`, body: { version: 1, customerId: uuid(2) }, csrf: "test-csrf" });
    await expect(memos).toHaveCount(2);
    await expectNoPersonalTrace(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("메모 창고: 다른 화면이 먼저 고친 메모(409)는 목록 위에 까닭을 남기고 새로 읽어 다시 고칠 수 있고, 옮기기 409도 까닭이 남는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const store = makeStore();
  const calls = await setup(page, { width: 360, store });
  await page.goto("/admin/work/notes/");
  const memos = page.locator("[data-nt-list] > .cu-memo");
  const notice = page.locator("[data-nt-notice]");
  await expect(memos).toHaveCount(2);

  // 고치기: 펼친 사이 다른 화면이 먼저 고침 → 409 → 목록 위 까닭 + 새 글로 다시 읽음
  let target = memos.filter({ hasText: "관리사무소" });
  await target.getByRole("button", { name: "고치기" }).click();
  store.notes[2] = { ...store.notes[2], body: "가상숲2단지 관리사무소: 주차 1.3대(다른 화면).", version: 2 };
  await target.locator("textarea").fill("가상숲2단지 관리사무소: 주차 1.2대, 승강기 공사.");
  await target.getByRole("button", { name: "고친 메모 저장" }).click();
  await expect(notice).toContainText("고친 글을 저장하지 않았습니다. 다른 화면에서 이 메모를 먼저 고치거나 옮겼습니다.");
  await expect(notice).toBeFocused();
  await expect(memos.filter({ hasText: "주차 1.3대(다른 화면)" })).toHaveCount(1);
  await expect(page.locator("[data-nt-edit-body]")).toHaveCount(0);
  expect(calls.writes.at(-1).body).toMatchObject({ version: 1 });

  // 다시 고치면 새 version(2)으로 저장되고 까닭 줄은 지워진다
  target = memos.filter({ hasText: "관리사무소" });
  await target.getByRole("button", { name: "고치기" }).click();
  await target.locator("textarea").fill("가상숲2단지 관리사무소: 주차 1.3대, 승강기 공사.");
  await target.getByRole("button", { name: "고친 메모 저장" }).click();
  await expect(page.locator("[data-nt-list-status]")).toHaveText("✓ 고친 메모를 저장했습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", path: `/notes/${uuid(503)}`, body: { version: 2, body: "가상숲2단지 관리사무소: 주차 1.3대, 승강기 공사." } });
  await expect(notice).toHaveText("");

  // 옮기기: 고르는 사이 다른 화면이 먼저 고침 → 409 → 펼친 칸은 닫혀도 까닭은 목록 위에 남음
  target = memos.filter({ hasText: "모르는 번호" });
  await target.getByRole("button", { name: "손님에게 옮기기" }).click();
  const move = target.locator(".cu-move");
  await move.getByRole("searchbox").fill("가상 손님 2");
  await move.getByRole("searchbox").press("Enter");
  await move.getByRole("radio").check();
  store.notes[1] = { ...store.notes[1], version: 3 };
  await move.getByRole("button", { name: "이 손님에게 옮기기" }).click();
  await expect(notice).toContainText("옮기지 않았습니다. 다른 화면에서 이 메모를 먼저 고치거나 옮겼습니다.");
  await expect(page.locator(".cu-move")).toHaveCount(0);
  await expect(memos.filter({ hasText: "모르는 번호" })).toHaveCount(1);
  await expect(page.locator("[data-nt-done]")).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("메모 창고: '고치기'는 글과 version만 보내고, '지우기'는 한 번 더 '지우기'를 눌러야 지우며, 찾기 0건이면 까닭을 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/notes/");
  const memos = page.locator("[data-nt-list] > .cu-memo");
  await expect(memos).toHaveCount(2);
  const first = memos.filter({ hasText: "관리사무소" });
  await first.getByRole("button", { name: "고치기" }).click();
  const box = first.locator("textarea");
  await expect(box).toBeFocused();
  await box.fill("가상숲2단지 관리사무소: 주차 1.3대.");
  await first.getByRole("button", { name: "고친 메모 저장" }).click();
  await expect(page.locator("[data-nt-list-status]")).toHaveText("✓ 고친 메모를 저장했습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", path: `/notes/${uuid(503)}`, body: { version: 1, body: "가상숲2단지 관리사무소: 주차 1.3대." } });
  await expect(memos.filter({ hasText: "주차 1.3대" })).toHaveCount(1);

  const other = memos.filter({ hasText: "모르는 번호" });
  await other.getByRole("button", { name: "지우기" }).click();
  await expect(other.getByText("이 메모를 지울까요? 지우면 되돌릴 수 없습니다.")).toBeVisible();
  const writes = calls.writes.length;
  await other.getByRole("button", { name: "그만두기" }).click();
  expect(calls.writes.length).toBe(writes);
  await other.getByRole("button", { name: "지우기" }).click();
  await other.locator("[data-nt-delete-go]").click();
  await expect(page.locator("[data-nt-list-status]")).toHaveText("✓ 메모를 지웠습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "DELETE", path: `/notes/${uuid(502)}`, body: {} });
  await expect(memos).toHaveCount(1);

  await page.locator("#nt-q").fill("없는 글자");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "찾는 메모가 없습니다" })).toBeVisible();
  await page.locator("[data-nt-empty-clear]").click();
  await expect(memos).toHaveCount(1);
  assertNoErrors();
});
