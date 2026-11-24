// 계약서 AI 일정 뽑기 시험(e2e/admin-ai-review.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API와 칸 찾기.
// 2026-11-24 시험 파일에서 그대로 옮김(사용자 2026-11-24 14:13:32 "AI 관련 기능이나 어려워 보이는거만 해 그럼"). 계약서 결과는 모두 가상 값이고 실제 서버·D1·R2·OpenAI는 부르지 않는다.
import { expect, test } from "@playwright/test";

export const NOW = new Date("2026-11-23T05:00:00Z"); // 한국 11월 23일(월) 14:00
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const CUSTOMER_ID = uuid(1);
export const DEAL_A = uuid(101);
export const DEAL_B = uuid(102);
export const GROUP = uuid(700);
export const OTHER_GROUP = uuid(701);
export const DETAIL = `/admin/work/customers/detail/?id=${CUSTOMER_ID}`;
export const REVIEW = `/admin/work/ai/review/?id=${GROUP}&from=${CUSTOMER_ID}`;
export const MODEL_A = "gpt-test-contract-a";
export const MODEL_B = "gpt-test-contract-b";
export const QUOTE = "ZZQUOTE-가상문구";
export const PROPERTY = "ZZPROPERTY-가상번지";
// 화면 글(work/contract-ai-view.mjs)과 같아야 하는 문장
export const AI_DISABLED_TEXT = "AI 일정 뽑기가 아직 켜지지 않았습니다.";
export const AI_CONFLICT_TEXT = "다른 곳에서 바뀌었습니다. 다시 불러와 주세요.";
export const AI_COPY_TRASHED_TEXT = "읽은 계약서 사본이 휴지통에 있어 이 결과를 거래에 넣을 수 없습니다. 휴지통에서 되살리면 이어집니다.";
export const AI_DEAL_CLOSED_TEXT = "끝난 거래와 취소한 거래에는 AI 결과를 넣을 수 없습니다."; // G20(대장 결정)
export const NEW_COST_TEXT = "다시 실행하면 새 비용이 듭니다";

export const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
export const failure = (status, code, details) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, ...(details ? { details } : {}) }, requestId: "test" } });
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

export const ev = (quote = "", page = 1, box = null) => ({ page, quote, box });
export const pay = (amount, date, quote = "") => ({ amount: { value: amount, evidence: ev() }, date: { value: date, evidence: ev(date ? quote : "") } });
// 검사를 통과한 꼴의 결과 하나(가상 값, contract-extract.mjs와 같은 snake_case).
export function result({ contractDate = "2026-11-02", price = 350_000_000, middles = [], balance = "2026-12-30", dealType = "sale", documentKind = "sale_contract", warnings = [] } = {}) {
  return {
    document_kind: documentKind,
    deal_type: dealType,
    contract_date: { value: contractDate, evidence: ev(contractDate ? QUOTE : "", 1, [0.1, 0.2, 0.5, 0.26]) },
    price_won: { value: price, evidence: ev(price === null ? "" : "금 삼억오천만원정") },
    deposit_won: { value: null, evidence: ev() },
    monthly_rent_won: { value: null, evidence: ev() },
    down_payment: pay(35_000_000, "2026-11-02", "계약시"),
    middle_payments: middles.map((date, index) => pay(10_000_000 * (index + 1), date, `${index + 1}차 중도금 가상 문구`)),
    balance: { amount: { value: 315_000_000, evidence: ev("잔금", 2) }, date: { value: balance, evidence: ev(balance ? "2026년 12월 가상 문구" : "", 2, [0.2, 0.6, 0.7, 0.66]) } },
    property_text: { value: PROPERTY, evidence: ev("소재지") },
    warnings,
  };
}
export const job = (runIndex, { status = "completed", errorCode = null, model = runIndex === 1 ? MODEL_A : MODEL_B, maskedCount = 0, value } = {}) => ({
  id: uuid(800 + runIndex), runIndex, model, status, errorCode, reasoningEffort: "max", maskedCount, result: status === "completed" ? value ?? result() : null,
});
export const copy = (n, dealId) => ({ id: uuid(400 + n), kind: "contract_copy", mimeType: "image/jpeg", byteSize: 1_800_000, caption: "", dealId, createdAt: new Date(Date.parse("2026-11-22T07:20:00.000Z") - n * 3_600_000).toISOString() });
export const FILE_IDS = [uuid(401), uuid(402)];
// 결과 고르기 화면이 받는 거래(GET /deals/:id, camelCase)
export const reviewDeal = (overrides = {}) => ({
  id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", saleKind: null, propertyKind: "housing", scheduleTarget: null, propertyLabel: "가상단지",
  priceWon: 350_000_000, depositWon: null, monthlyRentWon: null, contractOn: "2026-11-02", middlePaymentOn: null, balanceOn: "2026-12-20",
  buyerIsCorporation: false, regulation: "none", landPermitArea: false, metroArea: false, landShare: false, separateFundingSubmission: false,
  leaseReportingRegion: false, leaseRenewalWithoutChange: false, status: "contracted", version: 2, ...overrides,
});
// 기본값은 옛 두 번 읽기 묶음(작업 2개). 한 번 읽기 묶음은 singleView로 만든다.
export const groupView = ({ id = GROUP, status = "ready", pairMode = "cross", dealId = DEAL_A, jobs = [job(1), job(2)], confirmedAt = null } = {}) => ({
  group: { id, kind: "contract_schedule", dealId, status, pairMode, createdAt: "2026-11-23T04:50:00.000Z", confirmedAt, fileIds: FILE_IDS },
  // 서버는 끝난 묶음에만 결과를 싣는다.
  jobs: status === "running" ? jobs.map((item) => ({ ...item, result: null })) : jobs,
});
// 한 번 읽기 묶음(작업 1개, pairMode null)
export const singleView = ({ jobs = [job(1)], ...rest } = {}) => groupView({ pairMode: null, jobs, ...rest });
export const listItem = (view) => ({ groupId: view.group.id, status: view.group.status, pairMode: view.group.pairMode, createdAt: view.group.createdAt, confirmedAt: view.group.confirmedAt, jobs: view.jobs.map(({ id, runIndex, model, status, errorCode }) => ({ id, runIndex, model, status, errorCode })) });
export const estimateOf = (pages, overrides = {}) => ({
  pages, requests: 1, estimatedCostMicroUsd: 700_000 * pages, dailyCreateLimit: 10, todayCreates: 0, remainingCreates: 10,
  monthlyCostLimitMicroUsd: 10_000_000, monthCostMicroUsd: 0, remainingCostMicroUsd: 10_000_000, allowed: true, blockedBy: null, ...overrides,
});
export const confirmed = (body) => ({
  deal: { ...reviewDeal(), contractOn: body.apply.contractDate ?? "2026-11-02", balanceOn: body.apply.balanceDate ?? "2026-12-20", version: 3 },
  events: [
    { id: uuid(901), dealId: DEAL_A, kind: "contract", dueOn: "2026-11-02", title: "계약일(가상단지)", alarmOffsets: [], source: "calculated", doneAt: null, version: 1, createdAt: "", updatedAt: "" },
    { id: uuid(902), dealId: DEAL_A, kind: "transaction_report", dueOn: "2026-12-01", title: "부동산 거래신고 기한(가상단지)", alarmOffsets: [], source: "calculated", doneAt: null, version: 1, createdAt: "", updatedAt: "" },
    { id: uuid(903), dealId: DEAL_A, kind: "balance", dueOn: body.apply.balanceDate ?? "2026-12-20", title: "잔금일(가상단지)", alarmOffsets: [], source: "calculated", doneAt: null, version: 1, createdAt: "", updatedAt: "" },
  ],
  notices: ["가상 안내: 거래신고는 계약일부터 30일 안에 합니다."],
  kept: [],
});

// 가짜 업무 API. ai: { enabled, list, groups(Map id → 차례대로 돌려줄 묶음 응답 배열, 마지막 것을 계속), estimate(pages), create(body), cancel, confirm(body) }
export async function setup(page, { width = 390, aiEnabled = true, copiesA = 2, dealStatus = "contracted", ai = {} } = {}) {
  await page.addInitScript(() => {
    window.__blobUrls = 0;
    const original = URL.createObjectURL;
    URL.createObjectURL = function createObjectURL(...args) {
      window.__blobUrls += 1;
      return original.apply(this, args);
    };
  });
  await page.clock.install({ time: NOW });
  // 조회 간격(5초·15초)으로 건 타이머만 적는다(가짜 시계 위에 씌움).
  await page.addInitScript(() => {
    window.__axDelays = [];
    const original = window.setTimeout;
    window.setTimeout = function setTimeout(handler, delay, ...args) {
      if (delay === 5_000 || delay === 15_000) window.__axDelays.push(delay);
      return original.call(this, handler, delay, ...args);
    };
  });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [], gets: [] };
  const copiesOfA = Array.from({ length: copiesA }, (_, index) => copy(index + 1, DEAL_A));
  const customer = { id: CUSTOMER_ID, displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "가상숲1단지 84㎡ 매매", status: "consulting", lastContactOn: "2026-11-19", retentionUntil: "2027-11-19", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: "2026-11-19T01:00:00.000Z" };
  const deals = () => [
    { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: dealStatus, role: "buyer", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [], files: copiesOfA.map((file) => ({ ...file })) },
    { id: DEAL_B, title: "가상강변마을 59㎡ 전세", dealType: "jeonse", status: "open", role: "tenant", version: 1, updatedAt: "2026-11-17T01:00:00.000Z", events: [], files: [] },
  ];
  const groups = ai.groups ?? new Map();
  const groupReads = new Map();
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    calls.all.push(`${method} ${path}${url.search}`);
    if (method !== "GET") {
      calls.writes.push({ method, path, body: request.postDataJSON() });
      if (request.headers()["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled: true, filesEnabled: true, aiEnabled, administrator: "시험 관리자", csrfToken: "test-csrf", schemaVersion: 7, aiWarnings: [] }));
    if (path === `/customers/${CUSTOMER_ID}` && method === "GET") return route.fulfill(envelope({ customer, deals: deals(), notes: [], files: [] }));
    if (path.startsWith("/ai/") && !aiEnabled) return route.fulfill(failure(503, "AI_DISABLED"));
    if (path === "/ai/jobs" && method === "GET") return route.fulfill(envelope({ items: ai.list ? ai.list(url.searchParams.get("dealId")) : [] }));
    if (path === "/ai/estimate") {
      const pages = Number(url.searchParams.get("pages"));
      return route.fulfill(envelope(ai.estimate ? ai.estimate(pages) : estimateOf(pages)));
    }
    if (path === "/ai/jobs" && method === "POST") {
      const answer = ai.create?.(request.postDataJSON()) ?? envelope({ groupId: GROUP, pairMode: null, jobs: [job(1, { status: "queued" })].map(({ id, runIndex, model, status, errorCode }) => ({ id, runIndex, model, status, errorCode })) }, 201);
      return route.fulfill(answer);
    }
    const one = path.match(/^\/ai\/jobs\/([^/]+)(\/cancel|\/confirm)?$/u);
    if (one) {
      const id = decodeURIComponent(one[1]);
      if (one[2] === "/cancel") return route.fulfill(ai.cancel?.(id) ?? envelope({ status: "cancelled" }));
      if (one[2] === "/confirm") {
        const body = request.postDataJSON();
        return route.fulfill(ai.confirm?.(body) ?? envelope(confirmed(body)));
      }
      calls.gets.push(id);
      const answers = groups.get(id);
      if (!answers) return route.fulfill(failure(404, "NOT_FOUND"));
      const n = groupReads.get(id) ?? 0;
      groupReads.set(id, n + 1);
      const answer = answers[Math.min(n, answers.length - 1)];
      return route.fulfill(answer.status && answer.json ? answer : envelope(answer));
    }
    if (path === `/deals/${DEAL_A}` && method === "GET") return route.fulfill(ai.deal ? ai.deal() : envelope({ deal: reviewDeal({ status: dealStatus }), parties: [{ customerId: CUSTOMER_ID, role: "buyer", displayName: "가상 손님 1" }], events: [] }));
    const content = path.match(/^\/files\/([^/]+)\/content$/u);
    if (content) return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
    return route.fulfill(failure(404, "NOT_FOUND"));
  });
  return calls;
}

export function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
export const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
export const aiCalls = (calls) => calls.all.filter((line) => / \/ai\//u.test(line));
export const aiWrites = (calls, suffix) => calls.writes.filter((item) => item.path.startsWith("/ai/") && item.path.endsWith(suffix));
// 보이는 화면 그대로(전체 쪽 찍기는 고정·sticky 요소가 겹쳐 찍혀 실제 화면과 다름)
export const shot = (page, name) => page.screenshot({ path: test.info().outputPath(name) });
// 가짜 시계를 돌린 뒤 실제 시간으로 잠깐 기다린다: 타이머가 보낸 요청이 가짜 업무 API에 닿고 다음 타이머가 걸릴 틈.
// 곧바로 세면 늦게 닿는 요청을 놓쳐 "0번" 검사가 늘 통과한다(날개-2 깨 보기 2026-11-23).
export const settle = () => new Promise((resolve) => { setTimeout(resolve, 300); });
export const axDelayCount = (page) => page.evaluate(() => window.__axDelays.length);
// 브라우저 기본 단추 꼴(회색 바탕·볼록 테두리)이 남은 단추가 없는지: 관리자 단추 클래스가 하나도 안 붙은 단추를 찾는다.
export async function expectStyledButtons(scope, label) {
  const plain = await scope.locator("button").evaluateAll((nodes) => nodes
    .filter((node) => node.getClientRects().length > 0)
    .filter((node) => {
      const style = getComputedStyle(node);
      return style.borderTopStyle === "outset" || /^rgb\(2(39|40), 2(39|40), 2(39|40)\)$/u.test(style.backgroundColor);
    })
    .map((node) => `${node.textContent.trim()} [${node.className}]`));
  expect(plain, `${label}: 기본 꼴 단추`).toEqual([]);
}
export const box = (page, dealId = DEAL_A) => page.locator(`section.ax[data-ax-deal="${dealId}"]`);
export async function openCopies(page, dealId = DEAL_A) {
  await page.goto(DETAIL);
  const toggle = page.locator(`[data-kc-toggle="${dealId}"]`);
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator(`[data-kc-panel="${dealId}"]`)).toBeVisible();
}
// 저장소·주소·제목에 계약서 값이 없는지(S-17)
export async function expectNoTrace(page) {
  const trace = await page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    title: document.title,
    href: location.href,
    blobs: window.__blobUrls,
  }));
  for (const value of [QUOTE, PROPERTY, "2026-12-30", "350000000", "3억", "가상 손님", "가상숲"]) {
    expect(trace.local, `localStorage에 ${value}`).not.toContain(value);
    expect(trace.session, `sessionStorage에 ${value}`).not.toContain(value);
    expect(trace.title, `제목에 ${value}`).not.toContain(value);
    expect(decodeURIComponent(trace.href), `주소에 ${value}`).not.toContain(value);
  }
  expect(trace.blobs, "blob: 주소를 만들지 않음").toBe(0);
}

// ── 손님 카드 'AI로 일정 뽑기' 상자 ──
