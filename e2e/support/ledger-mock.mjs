// 매출장부 시험(e2e/admin-ledger.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API와 표 칸 찾기.
// 2026-11-24 시험 파일에서 그대로 옮김(사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄"). 실제 서버·D1은 부르지 않는다.

export const NOW = new Date("2026-11-21T03:00:00Z"); // 한국 12:00
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
export const failure = (status, code, details = []) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details }, requestId: "test" } });

export const DEAL_A = uuid(101);
export const DEAL_B = uuid(102);
export function deals() {
  return [
    { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", propertyKind: "housing", propertyLabel: null, status: "contracted", contractOn: "2026-10-05", balanceOn: "2026-11-20", priceWon: 450_000_000, depositWon: null, monthlyRentWon: null, version: 2, updatedAt: "2026-11-18T01:00:00.000Z" },
    { id: DEAL_B, title: "가상강변마을 오피스텔 전세", dealType: "jeonse", propertyKind: "officetel", propertyLabel: null, status: "open", contractOn: "2026-11-10", balanceOn: "2026-12-15", priceWon: null, depositWon: 200_000_000, monthlyRentWon: null, version: 1, updatedAt: "2026-11-17T01:00:00.000Z" },
  ];
}
// 장부 줄. dates는 기준마다 합계에 들어가는 날(서버가 계산하는 basisOn을 흉내 냄).
export function entry(n, patch, dates) {
  const base = { id: uuid(300 + n), kind: "fee", dealId: null, payerRole: null, label: "", entryOn: null, amountWon: 0, vatWon: 0, receivedWon: 0, receivedOn: null, snapContractOn: null, snapBalanceOn: null, memo: "", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: `2026-11-${String(10 + n).padStart(2, "0")}T01:00:00.000Z`, warnings: [], ...patch };
  return { ...base, dates };
}
export function makeStore({ empty = false } = {}) {
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

export const unpaidOf = (item) => (item.kind === "expense" ? 0 : Math.max(0, item.amountWon + item.vatWon - item.receivedWon));
export const publicEntry = (item, basis) => {
  const { dates, ...rest } = item;
  return { ...rest, unpaidWon: unpaidOf(item), basisOn: dates[basis] ?? null };
};
export function summaryOf(store, year, basis) {
  // 실제 서버(worker/work-ledger.mjs summaryByMonth)와 같은 셈: 기타 수입·지출·순수익은 공급가액만, 받을 금액은 보수·기타 수입의 공급가액 + 부가세
  const blank = () => ({ feeWon: 0, vatWon: 0, feeWithVatWon: 0, receivedWon: 0, unpaidWon: 0, expenseWon: 0, otherIncomeWon: 0, netWon: 0, receivableWon: 0 });
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
        line.otherIncomeWon += item.amountWon;
        line.netWon += item.amountWon;
      } else {
        line.expenseWon += item.amountWon;
        line.netWon -= item.amountWon;
      }
      if (item.kind !== "expense") {
        line.receivableWon += item.amountWon + item.vatWon;
        line.receivedWon += item.receivedWon;
        line.unpaidWon += unpaidOf(item);
      }
    }
  }
  const undatedCount = store.entries.filter((item) => !item.dates[basis]).length;
  return { year: String(year), months, total, undatedCount };
}

// 늘 같은 시각에서 시작하고 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
export async function setup(page, { width = 390, enabled = true, store = makeStore(), schemaOutdated = false, failSummaryOnce = false, failExport = false, conflictOnce = false, control = {} } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  let nextId = 900;
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "PATCH" && control.hold) await control.hold;
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    if (method === "POST" && path === "/ledger" && control.holdPost) await control.holdPost;
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
      if (control.holdSummary) await control.holdSummary;
      if (control.failSummary > 0) {
        control.failSummary -= 1;
        return route.fulfill(failure(503, control.failSummaryCode ?? "STORAGE_UNAVAILABLE"));
      }
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
        if (control.failPatch > 0) {
          control.failPatch -= 1;
          return route.fulfill(failure(503, "STORAGE_UNAVAILABLE"));
        }
        if (conflictOnce || body.version !== current.version) {
          conflictOnce = false;
          store.entries[index] = { ...current, memo: "다른 화면에서 고친 메모", version: current.version + 1 };
          return route.fulfill(failure(409, "VERSION_CONFLICT"));
        }
        const { version, ...changes } = body;
        const next = { ...current, ...changes, version: version + 1 };
        if (changes.receivedOn !== undefined && next.kind !== "expense") next.dates = { ...next.dates, received: changes.receivedOn };
        if (changes.entryOn !== undefined && !next.dealId) next.dates = { ...next.dates, balance: changes.entryOn, contract: changes.entryOn, ...(next.kind === "expense" ? { received: changes.entryOn } : {}) };
        next.warnings = warningsOf(next);
        store.entries[index] = next;
        return route.fulfill(envelope({ entry: publicEntry(next, "balance"), warnings: next.warnings }));
      }
      if (method === "DELETE") {
        store.entries.splice(index, 1);
        return route.fulfill(envelope({ deleted: true, trash: { batchId: uuid(990), purgeAfter: "2026-11-28T03:00:00.000Z" } }));
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

export const gridRow = (page, n) => page.locator(`.lg-table tr[data-lg-entry="${uuid(300 + n)}"]`);
export const gridCell = (page, n, column) => gridRow(page, n).locator(`[data-lg-cell="${column}"]`);
export const gridInput = (page, n, column) => gridRow(page, n).locator(`[data-lg-input="${column}"]`);
export const gridState = (page, n) => gridRow(page, n).locator(".lg-rowstate");
export const noteOf = (page, n) => gridRow(page, n).locator("xpath=following-sibling::tr[1][contains(@class,'lg-noterow')]");
