// 매출장부(단계 2, /admin/work/ledger/)와 손님 카드의 거래 장부 칸을 가짜 업무 API로 본다.
// 사용자 선택 2026-11-21 03:09:45: 메뉴 B안(업무 도구 아래 단계를 '손님·돈'·'상담 도구'·'홍보 만들기' 묶음으로), 시안 "이 시안대로".
// 거래·물건 표시·금액은 모두 지어낸 값(가상숲1단지 등)이고 실제 서버·D1은 부르지 않는다.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-21T03:00:00Z"); // 한국 12:00
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code, details = []) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details }, requestId: "test" } });

const DEAL_A = uuid(101);
const DEAL_B = uuid(102);
function deals() {
  return [
    { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", propertyKind: "housing", propertyLabel: null, status: "contracted", contractOn: "2026-10-05", balanceOn: "2026-11-20", priceWon: 450_000_000, depositWon: null, monthlyRentWon: null, version: 2, updatedAt: "2026-11-18T01:00:00.000Z" },
    { id: DEAL_B, title: "가상강변마을 오피스텔 전세", dealType: "jeonse", propertyKind: "officetel", propertyLabel: null, status: "open", contractOn: "2026-11-10", balanceOn: "2026-12-15", priceWon: null, depositWon: 200_000_000, monthlyRentWon: null, version: 1, updatedAt: "2026-11-17T01:00:00.000Z" },
  ];
}
// 장부 줄. dates는 기준마다 합계에 들어가는 날(서버가 계산하는 basisOn을 흉내 냄).
function entry(n, patch, dates) {
  const base = { id: uuid(300 + n), kind: "fee", dealId: null, payerRole: null, label: "", entryOn: null, amountWon: 0, vatWon: 0, receivedWon: 0, receivedOn: null, snapContractOn: null, snapBalanceOn: null, memo: "", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: `2026-11-${String(10 + n).padStart(2, "0")}T01:00:00.000Z`, warnings: [], ...patch };
  return { ...base, dates };
}
function makeStore({ empty = false } = {}) {
  return {
    deals: deals(),
    parties: { [DEAL_A]: [{ customerId: uuid(1), role: "buyer" }, { customerId: uuid(2), role: "seller" }], [DEAL_B]: [{ customerId: uuid(1), role: "tenant" }] },
    entries: empty ? [] : [
      entry(1, { dealId: DEAL_A, payerRole: "buyer", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_980_000, receivedOn: "2026-11-20" }, { balance: "2026-11-20", contract: "2026-10-05", received: "2026-11-20" }),
      entry(2, { dealId: DEAL_A, payerRole: "seller", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000 }, { balance: "2026-11-20", contract: "2026-10-05", received: null }),
      entry(3, { kind: "expense", label: "가상 전단 인쇄", entryOn: "2026-11-02", amountWon: 50_000 }, { balance: "2026-11-02", contract: "2026-11-02", received: "2026-11-02" }),
      entry(4, { kind: "other_income", label: "가상 강의료", entryOn: "2026-10-15", amountWon: 300_000, receivedWon: 300_000, receivedOn: "2026-10-16" }, { balance: "2026-10-15", contract: "2026-10-15", received: "2026-10-16" }),
      entry(5, { payerRole: "other", label: "=가상 메모 줄", amountWon: 900_000, vatWon: 0, warnings: ["VAT_DIFFERS"] }, { balance: null, contract: null, received: null }),
      entry(6, { label: "가상 지난해 줄", entryOn: "2025-12-28", amountWon: 500_000, vatWon: 50_000, receivedWon: 550_000, receivedOn: "2025-12-29" }, { balance: "2025-12-28", contract: "2025-12-28", received: "2025-12-29" }),
    ],
  };
}

const unpaidOf = (item) => (item.kind === "expense" ? 0 : Math.max(0, item.amountWon + item.vatWon - item.receivedWon));
const publicEntry = (item, basis) => {
  const { dates, ...rest } = item;
  return { ...rest, unpaidWon: unpaidOf(item), basisOn: dates[basis] ?? null };
};
function summaryOf(store, year, basis) {
  const blank = () => ({ feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 0, netWon: 0 });
  const months = Array.from({ length: 12 }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, "0")}`, ...blank() }));
  const total = blank();
  for (const item of store.entries) {
    const on = item.dates[basis];
    if (!on || !on.startsWith(`${year}-`)) continue;
    for (const line of [months[Number(on.slice(5, 7)) - 1], total]) {
      if (item.kind === "fee") {
        line.feeWon += item.amountWon;
        line.vatWon += item.vatWon;
        line.feeWithVatWon += item.amountWon + item.vatWon;
        line.netWon += item.amountWon;
      } else if (item.kind === "other_income") {
        line.otherIncomeWon += item.amountWon + item.vatWon;
        line.netWon += item.amountWon + item.vatWon;
      } else {
        line.expenseWon += item.amountWon + item.vatWon;
        line.netWon -= item.amountWon + item.vatWon;
      }
      if (item.kind !== "expense") {
        line.receivedWon += item.receivedWon;
        line.unpaidWon += unpaidOf(item);
      }
    }
  }
  const undatedCount = store.entries.filter((item) => !item.dates[basis]).length;
  return { year: String(year), months, total, undatedCount };
}

// 늘 같은 시각에서 시작하고 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
async function setup(page, { width = 390, enabled = true, store = makeStore(), schemaOutdated = false, failSummaryOnce = false, failExport = false, conflictOnce = false } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  let nextId = 900;
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
    if (path === "/session") return route.fulfill(envelope({ enabled, filesEnabled: false, administrator: "시험 관리자", csrfToken: enabled ? "test-csrf" : null, schemaVersion: enabled ? 5 : null }));
    if (!enabled) return route.fulfill(failure(503, "WORK_DISABLED"));
    if (schemaOutdated && path.startsWith("/ledger")) return route.fulfill(failure(503, "WORK_SCHEMA_OUTDATED"));

    if (path === "/ledger/summary") {
      if (failSummaryOnce) {
        failSummaryOnce = false;
        return route.fulfill(failure(503, "STORAGE_UNAVAILABLE"));
      }
      return route.fulfill(envelope(summaryOf(store, url.searchParams.get("year"), url.searchParams.get("basis"))));
    }
    if (path === "/ledger/export") {
      if (failExport) return route.fulfill(failure(503, "AUDIT_UNAVAILABLE"));
      return route.fulfill(envelope({ recorded: true }));
    }
    if (path === "/ledger" && method === "GET") {
      const basis = url.searchParams.get("basis") ?? "balance";
      const year = url.searchParams.get("year");
      const kind = url.searchParams.get("kind");
      const dealId = url.searchParams.get("dealId");
      let found = store.entries
        .filter((item) => !year || (item.dates[basis] ?? "").startsWith(`${year}-`))
        .filter((item) => !kind || item.kind === kind)
        .filter((item) => !dealId || item.dealId === dealId)
        .filter((item) => url.searchParams.get("unpaid") !== "1" || unpaidOf(item) > 0);
      found = url.searchParams.get("unpaid") === "1"
        ? found.sort((a, b) => unpaidOf(b) - unpaidOf(a))
        : year ? found.sort((a, b) => (b.dates[basis] ?? "").localeCompare(a.dates[basis] ?? "")) : found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const start = Number(url.searchParams.get("cursor") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const items = found.slice(start, start + limit).map((item) => publicEntry(item, basis));
      return route.fulfill(envelope({ items, nextCursor: start + limit < found.length ? String(start + limit) : null, undatedCount: year ? store.entries.filter((item) => !item.dates[basis]).length : 0 }));
    }
    const warningsOf = (item) => (item.kind === "fee" && item.vatWon !== Math.floor(item.amountWon / 10) ? ["VAT_DIFFERS"] : []);
    if (path === "/ledger" && method === "POST") {
      const deal = store.deals.find((item) => item.id === body.dealId);
      const own = body.entryOn ?? null;
      const dates = deal
        ? { balance: deal.balanceOn, contract: deal.contractOn, received: body.kind === "expense" ? deal.balanceOn : body.receivedOn ?? null }
        : { balance: own, contract: own, received: body.kind === "expense" ? own : body.receivedOn ?? null };
      const created = entry(nextId++, { ...body, id: uuid(nextId), updatedAt: "2026-11-21T03:00:00.000Z" }, dates);
      created.warnings = warningsOf(created);
      store.entries.push(created);
      return route.fulfill(envelope({ entry: publicEntry(created, "balance"), warnings: created.warnings }, 201));
    }
    const entryMatch = path.match(/^\/ledger\/([^/]+)$/u);
    if (entryMatch) {
      const index = store.entries.findIndex((item) => item.id === decodeURIComponent(entryMatch[1]));
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const current = store.entries[index];
      if (method === "PATCH") {
        if (conflictOnce || body.version !== current.version) {
          conflictOnce = false;
          store.entries[index] = { ...current, memo: "다른 화면에서 고친 메모", version: current.version + 1 };
          return route.fulfill(failure(409, "VERSION_CONFLICT"));
        }
        const { version, ...changes } = body;
        const next = { ...current, ...changes, version: version + 1 };
        if (changes.receivedOn !== undefined && next.kind !== "expense") next.dates = { ...next.dates, received: changes.receivedOn };
        next.warnings = warningsOf(next);
        store.entries[index] = next;
        return route.fulfill(envelope({ entry: publicEntry(next, "balance"), warnings: next.warnings }));
      }
      if (method === "DELETE") {
        store.entries.splice(index, 1);
        return route.fulfill(envelope({ deleted: true }));
      }
    }
    const ledgerOf = (dealId) => {
      const rows = store.entries.filter((item) => item.dealId === dealId);
      return { feeWon: 0, vatWon: 0, receivedWon: 0, unpaidWon: rows.reduce((sum, item) => sum + unpaidOf(item), 0), entryCount: rows.length };
    };
    if (path === "/deals" && method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      const items = store.deals.filter((item) => !q || item.title.includes(q)).slice(0, Number(url.searchParams.get("limit") ?? 20)).map((item) => ({ ...item, ledger: ledgerOf(item.id) }));
      return route.fulfill(envelope({ items, nextCursor: null, undatedCount: 0 }));
    }
    const dealMatch = path.match(/^\/deals\/([^/]+)$/u);
    if (dealMatch && method === "GET") {
      const deal = store.deals.find((item) => item.id === decodeURIComponent(dealMatch[1]));
      if (!deal) return route.fulfill(failure(404, "NOT_FOUND"));
      return route.fulfill(envelope({ deal, parties: (store.parties[deal.id] ?? []).map((party, index) => ({ ...party, displayName: `가상 손님 ${index + 1}` })), events: [], notes: [], files: [] }));
    }
    const customerMatch = path.match(/^\/customers\/([^/]+)$/u);
    if (customerMatch && method === "GET") {
      const customer = { id: uuid(1), displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "가상숲1단지 84㎡ 매매", status: "contracting", lastContactOn: "2026-11-19", retentionUntil: "2027-11-19", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: "2026-11-19T01:00:00.000Z" };
      const rows = [
        { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: "contracted", role: "buyer", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [] },
        { id: DEAL_B, title: "가상강변마을 오피스텔 전세", dealType: "jeonse", status: "open", role: "tenant", version: 1, updatedAt: "2026-11-17T01:00:00.000Z", events: [] },
      ];
      return route.fulfill(envelope({ customer, deals: rows, notes: [], files: [] }));
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
// 화면 주소·브라우저 저장소에 물건 표시·메모·금액이 남지 않았는지
async function expectNoTrace(page) {
  expect(decodeURIComponent(page.url())).toMatch(/\/admin\/work\/(ledger|customers\/detail)\/(\?id=[0-9a-f-]+)?$/u);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
}
const visibleRows = (page) => page.locator(".lg-rows > li:visible, .lg-table tbody tr:visible");

test("업무 세션이 꺼져 있으면 매출장부가 켜지지 않았다고 알리고 장부 자료는 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, enabled: false });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "업무 도구가 꺼져 있습니다" })).toBeVisible();
  await expect(page.getByRole("link", { name: "중개보수 계산으로" })).toBeVisible();
  expect(calls.all).toEqual(["GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("자료 구조가 옛날(5번 전)이면 갱신 전이라고 알리고, 잠깐 실패면 '다시 불러오기'로 다시 읽는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, schemaOutdated: true });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-lg-state-body]")).toContainText("구조(5번)");
  await expect(page.getByRole("button", { name: "다시 불러오기" })).toBeHidden();

  await setup(page, { width: 360, failSummaryOnce: true });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "매출장부를 불러오지 못했습니다" })).toBeVisible();
  await page.getByRole("button", { name: "다시 불러오기" }).click();
  await expect(page.getByRole("heading", { name: /2026년 합계/u })).toBeVisible();
  assertNoErrors();
});

for (const width of [360, 390, 1280]) {
  test(`매출장부 ${width}px: 합계 칸·달별 표·기준일 없는 줄 알림, 부가세 단추는 다시 부르지 않고, 거르기는 서버에 묻고, 가로 넘침 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await page.goto("/admin/work/ledger/");
    await expect(page.locator("[data-lg-year]")).toHaveText("2026년");
    expect(calls.all).toEqual(expect.arrayContaining(["GET /session", "GET /ledger/summary?year=2026&basis=balance", "GET /ledger?year=2026&basis=balance&limit=50"]));
    const tiles = page.locator("[data-lg-tiles] .lg-tile");
    await expect(tiles).toHaveCount(5);
    await expect(tiles.nth(0)).toContainText("3,600,000원");
    await expect(tiles.nth(2)).toContainText("미입금1,980,000원");
    // 입금·미입금은 부가세 빼고에서도 부가세 포함(표시로 밝힘)
    await expect(tiles.nth(1)).toContainText("부가세 포함 · 보수와 기타 수입");
    await expect(tiles.nth(2)).toContainText("부가세 포함 · 보수와 기타 수입");
    if (width < 980) await expect(page.getByText("미입금은 부가세를 포함한 금액입니다(보수와 기타 수입).")).toBeVisible();
    else await expect(page.locator("[data-lg-wide-head]")).toContainText("미입금(부가세 포함)");
    await expect(page.locator("[data-lg-basis-note]")).toHaveText("· 잔금일 기준");
    // 기준일 없는 줄: 합계 위 알림과 CSV 단추 옆 안내
    await expect(page.locator("[data-lg-undated-text]")).toHaveText("잔금일이 없는 장부 줄 1건은 합계에 없습니다.");
    await expect(page.locator("[data-lg-csv-note]")).toHaveText("기준일이 없는 장부 줄 1건은 파일에 들어가지 않습니다.");
    // 좁은 화면은 값 있는 달만, 넓은 화면(980px 이상)은 12달 표
    if (width < 980) {
      await expect(page.locator("[data-lg-narrow] tr")).toHaveCount(2);
      await expect(page.locator("[data-lg-narrow] tr").first()).toContainText("11월");
      await expect(page.locator("[data-lg-empty-months]")).toHaveText("1 ~ 9월, 12월은 장부 줄이 없습니다.");
    } else {
      await expect(page.locator("[data-lg-wide] tr")).toHaveCount(12);
      await expect(page.locator("[data-lg-wide-total]")).toContainText("3,600,000원");
    }
    // 1220px 이하 카드, 1221px 이상 표
    await expect(visibleRows(page)).toHaveCount(4);
    await expect(page.locator(width >= 1221 ? ".lg-table" : ".lg-rows")).toBeVisible();
    await expect(page.locator(width >= 1221 ? ".lg-rows" : ".lg-table")).toBeHidden();
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 4개 · 기준일 최근 순");
    await expect(visibleRows(page).filter({ hasText: "미입금 1,980,000원" })).toHaveCount(1);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);

    const before = calls.all.length;
    await page.getByRole("button", { name: "부가세 넣고" }).click();
    await expect(page.getByRole("button", { name: "부가세 넣고" })).toHaveAttribute("aria-pressed", "true");
    await expect(tiles.nth(0)).toContainText("3,960,000원");
    expect(calls.all.length, "부가세 단추는 서버를 다시 부르지 않음").toBe(before);

    await page.getByRole("button", { name: "입금일", exact: true }).click();
    await expect(page.locator("[data-lg-basis-note]")).toHaveText("· 입금일 기준 · 지출은 잔금일(거래 없는 지출은 지출일)로 셈");
    await expect(page.locator("[data-lg-undated-text]")).toContainText("입금일이 없는 장부 줄 2건(아직 입금 전 포함)");
    expect(calls.all).toContain("GET /ledger?year=2026&basis=received&limit=50");

    await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
    await expect(page.getByRole("button", { name: /^(✓ )?미입금만$/u })).toHaveAttribute("aria-pressed", "true");
    // 입금일 기준 + 미입금만: 연도 없이 모든 해의 미입금 줄(기준일 없는 줄 포함)과 안내 줄
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 2개 · 미입금 큰 순");
    expect(calls.all).toContain("GET /ledger?basis=received&unpaid=1&limit=50");
    expect(calls.all.filter((call) => call.startsWith("GET /ledger?") && call.includes("unpaid=1") && call.includes("year="))).toEqual([]);
    await expect(page.locator("[data-lg-unpaid-note]")).toHaveText("입금일 기준에서는 미입금 줄을 연도와 상관없이 모두 보여 줍니다(아직 입금일이 없으므로).");
    await expect(visibleRows(page).first()).toContainText("미입금 1,980,000원");
    // 잔금일 기준으로 바꾸면 다시 연도로 거르고 안내 줄은 숨김
    await page.getByRole("button", { name: /^(✓ )?잔금일$/u }).click();
    await expect(page.locator("[data-lg-unpaid-note]")).toBeHidden();
    expect(calls.all).toContain("GET /ledger?year=2026&basis=balance&unpaid=1&limit=50");
    await expect(page.locator("[data-lg-count]")).toHaveText("장부 줄 1개 · 미입금 큰 순");
    await page.getByRole("button", { name: /^(✓ )?입금일$/u }).click();
    await page.getByRole("button", { name: /^(✓ )?미입금만$/u }).click();
    await expect(page.locator("[data-lg-unpaid-note]")).toBeHidden();
    await page.getByRole("button", { name: "지출", exact: true }).click();
    await expect(visibleRows(page)).toHaveCount(1);
    expect(calls.all).toContain("GET /ledger?year=2026&basis=received&kind=expense&limit=50");

    await page.getByRole("button", { name: "앞 해" }).click();
    await expect(page.locator("[data-lg-year]")).toHaveText("2025년");
    await expect(page.getByRole("button", { name: "다음 해" })).toBeEnabled();
    await expectNoTrace(page);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("기준일 없는 줄: '그 줄만 보기'는 연도 없이 읽어 기준일이 빈 줄만 보이고, 경고는 글자로 굵게 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "그 줄만 보기" }).click();
  await expect(page.locator("[data-lg-count]")).toHaveText("잔금일이 없는 장부 줄 1개");
  expect(calls.all.at(-1), "연도 없이 읽음").toBe("GET /ledger?basis=balance&limit=50");
  await expect(visibleRows(page)).toHaveCount(1);
  await expect(visibleRows(page).first()).toContainText("기준일 없음");
  await expect(visibleRows(page).first().locator(".lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 90,000원)");
  await expect(page.locator("[data-lg-chips]")).toBeHidden();
  await page.getByRole("button", { name: "전체 줄로 돌아가기" }).click();
  await expect(visibleRows(page)).toHaveCount(4);
  assertNoErrors();
});

test("장부 줄 만들기: 거래 없는 지출은 날짜가 꼭 있어야 하고, 저장은 CSRF로 보낸 뒤 목록·합계를 다시 읽어 그 줄을 강조한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "장부 줄 만들기" }).first().click();
  await expect(page.getByRole("radio", { name: "보수" })).toBeFocused();
  await page.getByRole("radio", { name: "지출" }).check();
  await expect(page.locator("[data-lg-payer-row]")).toBeHidden();
  await expect(page.locator("[data-lg-received-row]")).toBeHidden();
  await expect(page.locator("[data-lg-entry-help]")).toContainText("입금일 기준에서도 같음");
  await page.locator("#lg-entry-on").fill("");
  await page.locator("#lg-label").fill("가상 사무실 소모품");
  await page.locator("#lg-amount").fill("33,000");
  await expect(page.locator("[data-lg-total]")).toHaveText("합계 33,000원");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("#lg-entry-error")).toHaveText("거래에 잇지 않은 지출·기타 수입은 날짜가 있어야 합니다.");
  await expect(page.locator("#lg-entry-on")).toBeFocused();
  expect(calls.writes).toEqual([]);
  await page.locator("#lg-entry-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 저장했습니다.");
  expect(calls.writes).toEqual([{ method: "POST", path: "/ledger", csrf: "test-csrf", body: { kind: "expense", amountWon: 33_000, vatWon: 0, receivedWon: 0, receivedOn: null, entryOn: "2026-11-21", label: "가상 사무실 소모품", memo: "" } }]);
  await expect(page.locator(".lg-row.is-saved")).toContainText("가상 사무실 소모품");
  await expect(page.locator("[data-lg-form]")).toBeHidden();
  await expectNoTrace(page);
  assertNoErrors();
});

test("보수 줄: 주택 거래를 찾아 고르면 '상한으로 채우기'로 법정 상한을 넣고, 저장 뒤 경고(10%와 다른 부가세)를 굵게 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "장부 줄 만들기" }).first().click();
  await page.locator("#lg-deal-q").fill("가상");
  await page.locator("#lg-deal-q").press("Enter");
  expect(decodeURIComponent(calls.all.at(-1))).toBe("GET /deals?limit=5&q=가상");
  await expect(page.getByRole("radio", { name: "거래에 잇지 않음" })).toBeChecked();
  await page.getByRole("radio", { name: /가상강변마을 오피스텔 전세/u }).check();
  await expect(page.locator("[data-lg-cap-text]")).toContainText("주택이 아닌 거래");
  await expect(page.getByRole("button", { name: "상한으로 채우기" })).toBeHidden();
  await page.getByRole("radio", { name: /가상숲1단지 84㎡ 매매/u }).check();
  await expect(page.locator("[data-lg-cap-text]")).toHaveText("법정 상한 1,800,000원 + 부가세 180,000원 (계약일 기준 요율, 한쪽 의뢰인 기준)");
  await expect(page.locator("[data-lg-entry-row]")).toBeHidden();
  await expect(page.locator("#lg-label")).toHaveValue("가상숲1단지 84㎡ 매매");
  await page.getByRole("button", { name: "상한으로 채우기" }).click();
  await expect(page.locator("#lg-amount")).toHaveValue("1,800,000");
  await expect(page.locator("#lg-vat")).toHaveValue("180,000");
  await page.locator("#lg-vat").fill("100,000");
  await page.getByRole("radio", { name: "매도인" }).check();
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toContainText("굵은 경고를 확인하세요");
  expect(calls.writes.at(-1).body).toEqual({ kind: "fee", amountWon: 1_800_000, vatWon: 100_000, receivedWon: 0, receivedOn: null, label: "가상숲1단지 84㎡ 매매", memo: "", payerRole: "seller", dealId: DEAL_A });
  await expect(page.locator(".lg-table tr.is-saved .lg-warn")).toContainText("부가세가 10%와 다릅니다(10%면 180,000원)");
  assertNoErrors();
});

test("고치기: 바뀐 칸만 version과 함께 보내고, 409면 넣던 값을 지우지 않고 '새 값 보기'로 저장된 값을 다시 채운다. 지우기는 한 번 더 묻는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 390, conflictOnce: true });
  await page.goto("/admin/work/ledger/");
  await page.getByRole("button", { name: "가상숲1단지 84㎡ 매매 보수 장부 줄 고치기" }).nth(1).click();
  await expect(page.locator("[data-lg-form-title]")).toHaveText("장부 줄 고치기");
  await expect(page.locator("[data-lg-kind-row]")).toBeHidden();
  await expect(page.locator("[data-lg-fixed]")).toContainText("거래에 이은 줄");
  await expect(page.locator("#lg-amount")).toBeFocused();
  await page.locator("#lg-received").fill("1,980,000");
  await page.locator("#lg-received-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-form-status]")).toContainText("다른 곳에서 먼저 고쳤거나");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", body: { receivedWon: 1_980_000, receivedOn: "2026-11-21", version: 1 } });
  await expect(page.locator("#lg-received")).toHaveValue("1,980,000");
  await page.getByRole("button", { name: "새 값 보기" }).click();
  await expect(page.locator("[data-lg-form-status]")).toHaveText("새 값을 불러왔습니다. 다시 고친 뒤 저장해 주세요.");
  await expect(page.locator("#lg-memo")).toHaveValue("다른 화면에서 고친 메모");
  await page.locator("#lg-received").fill("1,980,000");
  await page.locator("#lg-received-on").fill("2026-11-21");
  await page.getByRole("button", { name: "장부 줄 저장" }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 저장했습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "PATCH", body: { receivedWon: 1_980_000, receivedOn: "2026-11-21", version: 2 } });

  await page.locator(".lg-row", { hasText: "가상 전단 인쇄" }).getByRole("button", { name: /고치기/u }).click();
  await page.getByRole("button", { name: "이 장부 줄 지우기" }).click();
  await expect(page.getByRole("button", { name: "지우기", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "지우기", exact: true }).click();
  await expect(page.locator("[data-lg-saved]")).toHaveText("✓ 장부 줄을 지웠습니다.");
  expect(calls.writes.at(-1)).toMatchObject({ method: "DELETE", path: `/ledger/${uuid(303)}` });
  await expect(page.locator(".lg-row", { hasText: "가상 전단 인쇄" })).toHaveCount(0);
  assertNoErrors();
});

test("CSV: 작업 기록(POST /ledger/export)을 남긴 뒤에만 BOM·수식 막기 파일을 내려받고, 기록이 실패하면 내려받지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  let calls = await setup(page, { width: 390 });
  await page.goto("/admin/work/ledger/");
  await expect(visibleRows(page)).toHaveCount(4);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("매출장부-2026-잔금일기준.csv");
  expect(calls.writes.at(-1)).toEqual({ method: "POST", path: "/ledger/export", csrf: "test-csrf", body: { year: 2026, basis: "balance", count: 4 } });
  const text = await readFile(await download.path(), "utf8");
  expect(text.startsWith("﻿기준일,종류,")).toBe(true);
  expect(text.split("\r\n")).toHaveLength(6);
  await expect(page.locator("[data-lg-csv-status]")).toContainText("(장부 줄 4개)을 내려받았습니다");
  await expect(page.getByRole("link", { name: "CSV 파일 저장" })).toBeVisible();

  calls = await setup(page, { width: 390, failExport: true });
  await page.goto("/admin/work/ledger/");
  await expect(visibleRows(page)).toHaveCount(4);
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await page.getByRole("button", { name: "CSV 내려받기" }).click();
  await expect(page.locator("[data-lg-csv-status]")).toHaveText("내려받지 않았습니다. 작업 기록을 남기지 못해 파일을 만들지 않았습니다. 잠시 뒤 다시 해 주세요.");
  await expect(page.getByRole("link", { name: "CSV 파일 저장" })).toBeHidden();
  expect(downloaded).toBe(false);
  expect(calls.writes.at(-1).path).toBe("/ledger/export");
  assertNoErrors();
});

test("장부 줄이 하나도 없으면 합계 칸 대신 0건 안내와 '장부 줄 만들기'를 보이고, CSV 안내는 숨긴다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, store: makeStore({ empty: true }) });
  await page.goto("/admin/work/ledger/");
  await expect(page.getByRole("heading", { name: "2026년 장부 줄이 없습니다" })).toBeVisible();
  await expect(page.locator("[data-lg-sum]")).toBeHidden();
  await expect(page.locator("[data-lg-undated]")).toBeHidden();
  await expect(page.locator("[data-lg-csv-note]")).toBeHidden();
  await page.locator("[data-lg-empty-new]").click();
  await expect(page.locator("[data-lg-form]")).toBeVisible();
  assertNoErrors();
});

for (const width of [360, 1280]) {
  test(`메뉴 B안 ${width}px: 업무 도구 아래 단계는 묶음마다 role=group(보이는 제목·aria-labelledby), 순서·Tab 차례가 같고 매출장부가 지금 화면`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    await setup(page, { width });
    await page.goto("/admin/work/ledger/");
    const menu = width < 980 ? page.locator(".admin-subtabs") : page.locator(".admin-side");
    for (const [name, links] of [["손님·돈", ["손님", "매출장부"]], ["상담 도구", ["중개보수 계산", "안내 문자", "계약 일정", "실거래가"]], ["홍보 만들기", ["글 초안", "홍보 종이", "매물 안내지"]]]) {
      const group = menu.getByRole("group", { name });
      await expect(group).toHaveCount(1);
      await expect(group.getByRole("link")).toHaveText(links);
    }
    const current = menu.getByRole("link", { name: "매출장부" });
    await expect(current).toHaveAttribute("aria-current", "page");
    const hrefs = ["/admin/work/", "/admin/work/customers/", "/admin/work/ledger/", "/admin/work/fee/", "/admin/work/messages/", "/admin/work/schedule/", "/admin/work/realprice/", "/admin/work/blog/", "/admin/work/paper/", "/admin/work/listing-paper/"];
    await menu.locator('a[href="/admin/work/"]').last().focus();
    const order = [];
    for (let index = 0; index < hrefs.length; index += 1) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("href")));
      await page.keyboard.press("Tab");
    }
    expect(order, "Tab 차례 = 보이는 차례").toEqual(hrefs);
    if (width < 980) {
      // 작은 탭은 한 줄(49px), 지금 탭은 처음부터 화면 안
      const strip = await page.locator(".admin-subtabs").boundingBox();
      expect(Math.round(strip.height)).toBeLessThanOrEqual(49);
      await page.goto("/admin/work/ledger/");
      const box = await current.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // 묶음 제목은 화면 읽기 프로그램에만(작은 탭)
      await expect(page.locator(".admin-subtabs__group > .sr-only").first()).toHaveText("손님·돈");
    } else {
      await expect(page.locator(".admin-side .admin-menu__subhead").first()).toBeVisible();
    }
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

for (const width of [360, 1280]) {
  test(`손님 카드 ${width}px 거래의 장부 칸: '장부 보기'를 눌렀을 때만 거래·장부를 읽고, 쌍방 보수 줄 두 개를 한 번에 만든다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const store = makeStore();
    store.entries = store.entries.filter((item) => item.dealId !== DEAL_A);
    const calls = await setup(page, { width, store });
    await page.goto(`/admin/work/customers/detail/?id=${uuid(1)}`);
    const toggle = page.locator(`[data-cu-ledger-toggle="${DEAL_A}"]`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(calls.all.filter((call) => call.startsWith("GET /deals") || call.startsWith("GET /ledger")), "열기 전에는 부르지 않음").toEqual([]);
    await toggle.click();
    await expect(toggle).toHaveText("장부 접기");
    const panel = page.locator(`[data-cu-ledger="${DEAL_A}"]`);
    await expect(panel.locator("h4")).toHaveText("장부 아직 없음");
    expect(calls.all).toEqual(expect.arrayContaining([`GET /deals/${DEAL_A}`, `GET /ledger?basis=balance&dealId=${DEAL_A}&limit=50`]));
    await expect(panel.getByRole("link", { name: "매출장부에서 보기" })).toHaveAttribute("href", "/admin/work/ledger/");
    await panel.getByRole("button", { name: "보수 줄 만들기" }).click();
    await expect(panel.locator(".lg-cap")).toContainText("법정 상한 1,800,000원 + 부가세 180,000원");
    // 매수인·매도인 둘 다 이 거래의 손님이라 쌍방으로 둘 다 골라짐
    await expect(panel.getByRole("checkbox", { name: "매수인" })).toBeChecked();
    await expect(panel.getByRole("checkbox", { name: "매도인" })).toBeChecked();
    await expect(panel.getByRole("button", { name: "보수 줄 2개 저장" })).toBeVisible();
    await panel.locator(`#cu-lg-${DEAL_A}-buyer-received`).fill("1,980,000");
    await panel.getByRole("button", { name: "보수 줄 2개 저장" }).click();
    await expect(panel.locator(`#cu-lg-${DEAL_A}-buyer-receivedOn-error`)).toHaveText("입금액이 있으면 입금일을 넣어 주세요.");
    expect(calls.writes).toEqual([]);
    await panel.locator(`#cu-lg-${DEAL_A}-buyer-receivedOn`).fill("2026-11-20");
    await panel.getByRole("button", { name: "보수 줄 2개 저장" }).click();
    await expect(panel.locator("h4")).toHaveText("장부 2줄 · 미입금 1,980,000원");
    await expect(panel.getByRole("status").filter({ hasText: "✓ 보수 줄 2개를 저장했습니다." })).toBeVisible();
    expect(calls.writes.map((write) => write.body)).toEqual([
      { kind: "fee", dealId: DEAL_A, payerRole: "buyer", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 1_980_000, receivedOn: "2026-11-20", memo: "" },
      { kind: "fee", dealId: DEAL_A, payerRole: "seller", label: "가상숲1단지 84㎡ 매매", amountWon: 1_800_000, vatWon: 180_000, receivedWon: 0, receivedOn: null, memo: "" },
    ]);
    await expect(panel.locator("li")).toHaveCount(2);
    await expect(panel.locator("li").nth(0)).toContainText("입금 끝 11. 20.");
    // 오피스텔 전세는 상한을 채우지 않고 까닭만 알림
    await page.getByRole("button", { name: "장부 보기" }).click();
    const other = page.locator(`[data-cu-ledger="${DEAL_B}"]`);
    await other.getByRole("button", { name: "보수 줄 만들기" }).click();
    await expect(other.locator(".lg-cap")).toContainText("주택이 아닌 거래");
    await expect(other.getByRole("checkbox", { name: "임차인" })).toBeChecked();
    await expect(other.getByRole("checkbox", { name: "임대인" })).not.toBeChecked();
    await expect(other.locator(`#cu-lg-${DEAL_B}-tenant-amount`)).toHaveValue("");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await expectNoTrace(page);
    assertNoErrors();
  });
}
