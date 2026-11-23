// 휴지통(단계 2, /admin/work/trash/, 시안 2026-11-22 14:42:41 "이 시안대로")을 가짜 업무 API로 본다(T2-133 ~ T2-135).
// 메뉴에는 넣지 않고 손님 목록 위 고리와 업무 도구 처음 바로가기로 들어온다(2026-11-22 14:31:26).
// 손님 이름·메모·거래 이름은 모두 지어낸 값이고 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-18T03:00:00Z"); // 한국 수요일 12:00
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code, details = []) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details }, requestId: "test" } });
const counts = (values = {}) => ({ customers: 0, deals: 0, parties: 0, events: 0, notes: 0, tasks: 0, ledger: 0, links: 0, ...values });
const batch = (n, kind, label, deletedAt, purgeAfter, daysLeft, values, patch = {}) => ({ batchId: uuid(n), kind, label, deletedAt, purgeAfter, daysLeft, counts: counts(values), restorable: true, ...patch });
function makeBatches() {
  return [
    batch(1, "customer", "가상 손님 7", "2026-11-18T01:12:00.000Z", "2026-11-25T01:12:00.000Z", 7, { customers: 1, deals: 1, parties: 1, events: 2, notes: 3, tasks: 1, links: 2 }),
    batch(2, "note", "잔금일 다시 확인 부탁, 은행 대출 승인 문자 오면 알려…", "2026-11-17T07:40:00.000Z", "2026-11-24T07:40:00.000Z", 6, { notes: 1 }),
    batch(3, "deal", "가상강변마을 59㎡ 전세", "2026-11-15T00:05:00.000Z", "2026-11-22T00:05:00.000Z", 4, { deals: 1, parties: 2, events: 3, notes: 1, tasks: 2, links: 2 }),
    batch(4, "ledger", "가상 전단 인쇄 · 지출 50,000원", "2026-11-13T09:22:00.000Z", "2026-11-20T09:22:00.000Z", 2, { ledger: 1 }),
    batch(5, "task", "가상 광고 사진 다시 찍기", "2026-11-12T02:30:00.000Z", "2026-11-19T02:30:00.000Z", 1, { tasks: 1 }),
    batch(6, "event", "가상숲2단지 84㎡ 매매 · 잔금", "2026-11-10T23:50:00.000Z", "2026-11-17T23:50:00.000Z", 0, { events: 1 }),
  ];
}
const FULL_RESTORE = { restored: { customers: 1, deals: 1, parties: 1, events: 2, notes: 3, tasks: 1, ledger: 0, links: 2, notesUnlinked: 0 }, skipped: [], remaining: 0 };
const PARTLY_RESTORE = {
  restored: { customers: 1, deals: 1, parties: 0, events: 2, notes: 3, tasks: 1, ledger: 0, links: 0, notesUnlinked: 2 },
  skipped: [{ table: "noteCustomer", reason: "relinked", count: 1 }, { table: "ledgerDeal", reason: "changed", count: 1 }, { table: "parties", reason: "deal_missing", count: 1 }],
  remaining: 1,
};

// 늘 같은 시각에서 시작하고 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
async function setup(page, { width = 390, enabled = true, batches = makeBatches(), schemaOutdated = false, failListOnce = false, pageSize = 50, restore = () => FULL_RESTORE } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
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
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: "시험 관리자", csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 7 : null }));
    if (!enabled) return route.fulfill(failure(503, "WORK_DISABLED"));
    if (schemaOutdated && path.startsWith("/trash")) return route.fulfill(failure(503, "WORK_SCHEMA_OUTDATED"));
    if (path === "/trash" && method === "GET") {
      if (failListOnce) {
        failListOnce = false;
        return route.fulfill(failure(503, "STORAGE_UNAVAILABLE"));
      }
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), pageSize);
      const items = batches.slice(start, start + limit);
      return route.fulfill(envelope({ items, nextCursor: start + limit < batches.length ? String(start + limit) : null }));
    }
    const match = path.match(/^\/trash\/([^/]+)(\/restore)?$/u);
    if (match) {
      const index = batches.findIndex((item) => item.batchId === decodeURIComponent(match[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const current = batches[index];
      if (match[2] && method === "POST") {
        if (!current.restorable) return route.fulfill(failure(409, "TRASH_SCHEMA_CHANGED"));
        const result = restore(current);
        if (result.remaining > 0) batches[index] = { ...current, counts: counts({ parties: 1 }) };
        else batches.splice(index, 1);
        return route.fulfill(envelope(result));
      }
      if (!match[2] && method === "DELETE") {
        if (body.confirm !== "영구 삭제") return route.fulfill(failure(400, "CONFIRMATION_MISMATCH"));
        batches.splice(index, 1);
        return route.fulfill(envelope({ purged: true }));
      }
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return { calls, batches };
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
// 화면 주소·브라우저 저장소에 묶음 이름이 남지 않았는지
async function expectNoTrace(page) {
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe("/admin/work/trash/");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}
const row = (page, label) => page.locator(".tr-row:not(.tr-row--panel)").filter({ hasText: label });
const notice = (page) => page.locator("[data-tr-notice]");

test("T2-134 꺼짐: 업무 세션이 꺼져 있으면 켜지지 않았다고 알리고(7일 지난 묶음은 그래도 지워짐) 휴지통은 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 360, enabled: false });
  await page.goto("/admin/work/trash/");
  await expect(page.getByRole("heading", { name: "업무 도구가 켜지지 않았습니다" })).toBeVisible();
  await expect(page.locator("[data-tr-state-body]")).toContainText("꺼져 있는 동안에도 7일이 지난 묶음은 새벽에 저절로 영구 삭제됩니다.");
  await expect(page.getByRole("link", { name: "도구 모음으로" })).toBeVisible();
  expect(calls.all).toEqual(["GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("T2-134 구조 옛날(7번 전)·잠깐 실패: 갱신 전이라고 알리고, 실패면 '다시 불러오기'로 다시 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, schemaOutdated: true });
  await page.goto("/admin/work/trash/");
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-tr-state-body]")).toContainText("구조(7번)");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();

  await setup(page, { width: 360, failListOnce: true });
  await page.goto("/admin/work/trash/");
  await expect(page.getByRole("heading", { name: "휴지통을 불러오지 못했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 6개 · 지운 때 최근 순");
  assertNoErrors();
});

test("T2-134 0건: '지운 자료가 없습니다'와 7일 보관 안내", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, batches: [] });
  await page.goto("/admin/work/trash/");
  await expect(page.getByRole("heading", { name: "지운 자료가 없습니다" })).toBeVisible();
  await expect(page.locator("[data-tr-empty-body]")).toHaveText("지운 자료는 7일 동안 여기에 있습니다.");
  await expect(page.locator(".tr-keep")).toContainText("7일이 지나면 하루 안에 자동으로 영구 삭제됩니다. 영구 삭제한 뒤에도 백업에는 개인정보 처리방침에 적힌 기간 동안 남았다가 지워집니다.");
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 0개 · 지운 때 최근 순");
  assertNoErrors();
});

for (const width of [360, 390, 430, 768, 1280]) {
  test(`T2-133 휴지통 ${width}px: 종류·남은 날을 글자로, 단추 44px(마우스 PC는 36px), 가로 넘침 없음, 주소·브라우저 저장소에 이름 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const { calls } = await setup(page, { width });
    await page.goto("/admin/work/trash/");
    await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 6개 · 지운 때 최근 순");
    expect(calls.all).toEqual(["GET /session", "GET /trash?limit=50"]);
    await expect(page.locator(".tr-kind")).toHaveText(["손님", "메모", "거래", "장부 줄", "할 일", "일정"]);
    const customer = row(page, "가상 손님 7");
    await expect(customer).toContainText("지운 때 11. 18.(수) 10:12");
    await expect(customer).toContainText("함께: 거래 1건 · 일정 2개 · 메모 3개 · 할 일 1개");
    await expect(customer).toContainText("되살리면 지울 때 끊었던 메모·장부 줄 연결 2개도 다시 잇습니다");
    await expect(customer.locator(".tr-left")).toHaveText("7일 남음11월 25일(수)부터 영구 삭제");
    await expect(row(page, "가상 광고 사진 다시 찍기").locator(".tr-left strong")).toHaveText("! 1일 남음");
    await expect(row(page, "가상숲2단지 84㎡ 매매 · 잔금").locator(".tr-left")).toHaveText("! 곧 영구 삭제7일이 지나 다음 새벽 정리 때 지워집니다");
    await expect(page.locator(".tr-row--late")).toHaveCount(2);
    // 거르기 단추는 눌린 것에 ✓가 붙어 이름이 바뀌므로 data 칸으로 찾는다
    for (const button of [page.getByRole("button", { name: "되살리기: 가상 손님 7" }), page.getByRole("button", { name: "영구 삭제: 가상 손님 7" }), page.locator('[data-tr-filter=""]'), page.locator('[data-tr-filter="ledger"]')]) {
      const box = await button.boundingBox();
      expect(Math.round(box.height), `${await button.textContent()} 높이`).toBeGreaterThanOrEqual(width >= 1221 ? 36 : 44);
    }
    for (const name of ["손님 목록"]) {
      const box = await page.getByRole("link", { name }).boundingBox();
      expect(box.width, `${name} 너비`).toBeGreaterThan(0);
    }
    expect(await page.locator(".tr-row__meta").first().evaluate((node) => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expectNoTrace(page);
    if (width === 360 || width === 1280) await page.screenshot({ path: test.info().outputPath(`trash-${width}.png`), fullPage: true });
    assertNoErrors();
  });
}

for (const width of [360, 1280]) {
  test(`계약서 사본·사진 묶음 ${width}px: 종류 표시는 '계약서 사본'·'사진'으로 가려 쓰고, 거르기 '사진·계약서 사본'은 둘 다 보이며 가로로 넘치지 않는다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const batches = [
      batch(11, "file", "계약서 사본 · 11월 17일 10:40 올림", "2026-11-18T01:12:00.000Z", "2026-11-25T01:12:00.000Z", 7, { files: 1 }),
      batch(12, "file", "거실 창 쪽 누수 자국", "2026-11-17T07:40:00.000Z", "2026-11-24T07:40:00.000Z", 6, { files: 1 }),
      batch(13, "customer", "가상 손님 9", "2026-11-16T07:40:00.000Z", "2026-11-23T07:40:00.000Z", 5, { customers: 1, deals: 1, parties: 1, files: 3 }),
    ];
    await setup(page, { width, batches });
    await page.goto("/admin/work/trash/");
    await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 3개 · 지운 때 최근 순");
    await expect(page.locator(".tr-kind")).toHaveText(["계약서 사본", "사진", "손님"]);
    await expect(row(page, "가상 손님 9")).toContainText("함께: 거래 1건 · 사진·계약서 사본 3장");
    const chip = page.locator('[data-tr-filter="file"]');
    await expect(chip).toHaveText("사진·계약서 사본");
    for (const tag of await page.locator(".tr-kind").all()) expect((await tag.boundingBox()).height, "종류 표시는 한 줄").toBeLessThan(40);
    expect((await chip.boundingBox()).height, "거르기 단추 높이").toBeGreaterThanOrEqual(width >= 1221 ? 36 : 44);
    expect(await chip.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), "거르기 단추 글자가 잘리지 않음").toBe(true);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath(`trash-copy-${width}.png`), fullPage: true });

    await chip.click();
    await expect(page.locator("[data-tr-count]")).toHaveText("사진·계약서 사본 묶음 2개 · 지운 때 최근 순");
    await expect(page.locator(".tr-kind")).toHaveText(["계약서 사본", "사진"]);
    await page.getByRole("button", { name: "영구 삭제: 계약서 사본 · 11월 17일 10:40 올림" }).click();
    await expect(page.locator("[data-tr-purge-what]")).toContainText("계약서 사본 1장");
    await expect(page.locator("[data-tr-purge-what]")).not.toContainText("사진");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("T2-134 종류 거르기는 받은 목록에서만(서버에 다시 묻지 않음), 0건이어도 더 받을 것이 있으면 '50개 더 보기'", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const many = [...makeBatches().slice(1), ...Array.from({ length: 50 }, (_, index) => batch(100 + index, "note", `가상 메모 ${index + 1}`, "2026-11-11T00:00:00.000Z", "2026-11-18T00:00:00.000Z", 0, { notes: 1 })), makeBatches()[0]];
  const { calls } = await setup(page, { width: 390, batches: many });
  await page.goto("/admin/work/trash/");
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 50개 이상 · 지운 때 최근 순");
  await page.locator('[data-tr-filter="customer"]').click();
  await expect(page.locator('[data-tr-filter="customer"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "지운 손님이 없습니다" })).toBeVisible();
  await expect(page.locator("[data-tr-more]")).toBeVisible();
  expect(calls.all.filter((call) => call.startsWith("GET /trash"))).toEqual(["GET /trash?limit=50"]);
  await page.locator("[data-tr-more]").click();
  await expect(page.locator("[data-tr-count]")).toHaveText("손님 묶음 1개 · 지운 때 최근 순");
  await expect(row(page, "가상 손님 7")).toHaveCount(1);
  expect(calls.all.at(-1)).toBe("GET /trash?cursor=50&limit=50");
  await page.getByRole("button", { name: "거르기 풀기" }).first().click();
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 56개 · 지운 때 최근 순");
  await expectNoTrace(page);
  assertNoErrors();
});

test("T2-134 되살리기(모두 됨): 빈 본문·보안 토큰으로 보내고, 돌아온 수를 알린 뒤 목록을 새로 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 390 });
  await page.goto("/admin/work/trash/");
  await page.getByRole("button", { name: "되살리기: 가상 손님 7" }).click();
  await expect(notice(page)).toContainText("✓ '가상 손님 7'을(를) 되살렸습니다. 손님 1명, 거래 1건, 일정 2개, 메모 3개, 할 일 1개가 돌아왔고 연결 2개도 원래대로 이었습니다.");
  await expect(notice(page)).toBeFocused();
  await expect(notice(page).getByRole("link", { name: "손님 목록 열기" })).toHaveAttribute("href", "/admin/work/customers/");
  expect(calls.writes.at(-1)).toEqual({ method: "POST", path: `/trash/${uuid(1)}/restore`, body: {}, csrf: "test-csrf" });
  await expect(row(page, "가상 손님 7")).toHaveCount(0);
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 5개 · 지운 때 최근 순");
  await expectNoTrace(page);
  assertNoErrors();
});

test("T2-134 되살리기(일부 건너뜀): 까닭별 한 줄을 알리고, 남은 묶음에는 '일부만 남음'을 붙인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, restore: () => PARTLY_RESTORE });
  await page.goto("/admin/work/trash/");
  await page.getByRole("button", { name: "되살리기: 가상 손님 7" }).click();
  await expect(notice(page)).toHaveClass(/tr-saved--warn/u);
  await expect(notice(page).locator("li")).toHaveText([
    "메모 1개 — 지운 뒤 다른 손님에게 이미 붙여 두어서 그대로 두었습니다.",
    "장부 줄 1개 — 지운 뒤 고쳐져서 거래에 다시 잇지 않았습니다. 매출장부에서 직접 이어 주세요.",
    "참여자 1줄 — 함께였던 거래가 지금 없어(휴지통에 있을 수 있음) 남겨 두었습니다. 그 거래를 되살린 뒤 이 묶음에서 다시 '되살리기'를 누르세요.",
    "메모 2개 — 이을 손님·거래가 지금 없어 그 연결만 비우고 되살렸습니다.",
  ]);
  const left = row(page, "가상 손님 7");
  await expect(left).toContainText("함께: 참여자 1줄");
  await expect(left).toContainText("일부만 남음 — 함께였던 거래나 손님을 먼저 되살린 뒤 다시 누르세요.");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: test.info().outputPath("trash-partly-360.png"), fullPage: true });
  assertNoErrors();
});

test("T2-134 구조가 바뀐 묶음(restorable=false)은 '되살리기' 없이 까닭과 '영구 삭제'만, 다른 화면이 먼저 되살린 묶음(404)은 알리고 새로 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const batches = makeBatches();
  batches[5] = { ...batches[5], restorable: false };
  const state = await setup(page, { width: 390, batches });
  await page.goto("/admin/work/trash/");
  const blocked = row(page, "가상숲2단지 84㎡ 매매 · 잔금");
  await expect(blocked.getByRole("button", { name: /^되살리기/u })).toHaveCount(0);
  await expect(blocked.getByRole("button", { name: "영구 삭제: 가상숲2단지 84㎡ 매매 · 잔금" })).toBeVisible();
  await expect(blocked).toContainText("! 되살릴 수 없음 — 자료 구조가 바뀌기 전에 지운 것이라 되살릴 수 없습니다. 영구 삭제만 할 수 있고, 두면 11월 18일(수)부터 저절로 지워집니다.");

  // 다른 화면이 먼저 되살림: 누르기 전에 서버에서 사라짐
  state.batches.splice(1, 1);
  await page.getByRole("button", { name: "되살리기: 잔금일 다시 확인 부탁, 은행 대출 승인 문자 오면 알려…" }).click();
  await expect(notice(page)).toHaveText("되살리지 못했습니다. 이미 되살렸거나 영구 삭제된 묶음입니다(다른 관리자 화면에서 먼저 했을 수 있습니다). 목록을 새로 불러왔습니다.");
  await expect(notice(page)).toHaveClass(/tr-saved--error/u);
  await expect(page.locator("[data-tr-count]")).toHaveText("지운 묶음 5개 · 지운 때 최근 순");
  assertNoErrors();
});

test("T2-134 영구 삭제: 칸 안에서 '영구 삭제'를 띄어쓰기까지 넣어야 단추가 켜지고(확인 창 없음), confirm 글자로 지운다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  page.on("dialog", (dialog) => {
    throw new Error(`확인 창이 뜨면 안 됩니다: ${dialog.message()}`);
  });
  const { calls } = await setup(page, { width: 360 });
  await page.goto("/admin/work/trash/");
  const opener = page.getByRole("button", { name: "영구 삭제: 가상 손님 7" });
  await opener.click();
  await expect(opener).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "'가상 손님 7' 묶음을 영구 삭제할까요?" })).toBeVisible();
  await expect(page.locator("[data-tr-purge-what]")).toHaveText("손님 1명, 거래 1건, 일정 2개, 메모 3개, 할 일 1개 — 모두 지금 바로 지워지고 되살릴 수 없습니다. 손님이 바로 지워 달라고 했을 때 씁니다.");
  const input = page.getByLabel("확인하려면 영구 삭제를 그대로 넣으세요");
  await expect(input).toBeFocused();
  const go = page.locator("[data-tr-purge-go]");
  await input.fill("영구삭제");
  await expect(go).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath("trash-purge-360.png"), fullPage: true });
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "그만두기" }).click();
  await expect(opener).toBeFocused();
  await expect(page.locator("[data-tr-purge-go]")).toHaveCount(0);
  expect(calls.writes).toEqual([]);

  await opener.click();
  await page.getByLabel("확인하려면 영구 삭제를 그대로 넣으세요").fill("영구 삭제");
  await expect(page.locator("[data-tr-purge-go]")).toBeEnabled();
  await page.locator("[data-tr-purge-go]").click();
  await expect(notice(page)).toHaveText("✓ '가상 손님 7' 묶음을 영구 삭제했습니다. 되살릴 수 없습니다. 영구 삭제한 뒤에도 백업에는 개인정보 처리방침에 적힌 기간 동안 남았다가 지워집니다.");
  expect(calls.writes.at(-1)).toEqual({ method: "DELETE", path: `/trash/${uuid(1)}`, body: { confirm: "영구 삭제" }, csrf: "test-csrf" });
  await expect(row(page, "가상 손님 7")).toHaveCount(0);
  await expectNoTrace(page);
  assertNoErrors();
});

test("T2-135 키보드만으로 되살리기: Tab으로 '되살리기'에 가서 Enter, 알림으로 포커스가 간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls } = await setup(page, { width: 1280 });
  await page.goto("/admin/work/trash/");
  await expect(page.locator(".tr-row")).toHaveCount(6);
  await page.locator('[data-tr-filter="ledger"]').focus();
  const target = page.getByRole("button", { name: "되살리기: 가상 손님 7" });
  for (let step = 0; step < 12 && !(await target.evaluate((node) => node === document.activeElement)); step += 1) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(notice(page)).toBeFocused();
  await expect(notice(page)).toContainText("✓ '가상 손님 7'을(를) 되살렸습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "POST", path: `/trash/${uuid(1)}/restore` });
  assertNoErrors();
});

test("T2-135 들어오는 길: 손님 목록 위 '휴지통' 고리와 업무 도구 처음 바로가기(메뉴에는 없음)", async ({ page }) => {
  await setup(page, { width: 360 });
  await page.goto("/admin/work/customers/");
  const link = page.locator(".cu-links").getByRole("link", { name: "휴지통" });
  await expect(link).toHaveAttribute("href", "/admin/work/trash/");
  expect(Math.round((await link.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await page.goto("/admin/work/");
  const home = page.getByRole("navigation", { name: "휴지통 바로가기" }).getByRole("link");
  await expect(home).toHaveText("휴지통 지운 자료 7일 보관 →");
  await expect(home).toHaveAttribute("href", "/admin/work/trash/");
  expect(Math.round((await home.boundingBox()).height)).toBeGreaterThanOrEqual(44);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await expect(page.locator('nav a[href="/admin/work/trash/"]')).toHaveCount(1, { timeout: 1000 });
});
