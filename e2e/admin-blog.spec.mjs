// 글 초안 화면(P3, /admin/work/blog/)을 가짜 업무 API로 본다. 매물·단지 이름·주소·글은 모두 지어낸 값이고 OpenAI는 부르지 않는다.
// 운영자 결정 2026-11-20 15:51:54: B안 단계 접기, 소재지는 매번 직접 입력(저장 안 함), 명시사항 빈 칸이면 만들기부터 막음.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { BLOG_STYLES, validateBlogInputs } from "../src/lib/work/blog-checks.mjs";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";

const NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00
const BLOG = "**/api/admin/v1/work/blog/**";
const rules = JSON.parse(readFileSync(new URL("../src/data/work/ad-disclosure-rules.json", import.meta.url), "utf8"));
const office = JSON.parse(readFileSync(new URL("../src/data/office.json", import.meta.url), "utf8"));
const LOCATION = "대전광역시 동구 가상동 1";

const sources = listBlogSources({
  rules,
  listings: [],
  naverListings: {
    items: [
      { id: "9990000001", title: "가상숲1단지", propertyType: "아파트", tradeType: "sale", priceLabel: "4억 5,000", areaLabel: "112㎡ · 전용 84.97㎡", floorLabel: "10/25층", direction: "남향", summary: "가상 요약", registeredAt: "2026-11-10" },
      { id: "9990000002", title: "가상숲분양권", propertyType: "아파트분양권", tradeType: "sale", priceLabel: "3억", areaLabel: "전용 59㎡", floorLabel: "5/20층", direction: "남향", summary: "" },
    ],
  },
  complexes: [{ status: "published", slug: "zz-forest", name: "가상숲 단지", areaName: "천동", summary: "가상 단지 요약", facts: [{ label: "세대수", value: "1,200세대" }, { label: "최고 층", value: "25층" }] }],
});
const [listing, , complex] = sources;
const styles = BLOG_STYLES.map(({ id, label, note }) => ({ id, label, note }));
// 공동주택 명시사항을 소재지만 빼고 다 채운 값(서버가 초안에 남기는 모양).
const listingInputs = validateBlogInputs({
  kind: "아파트",
  violation: "none",
  floorMode: "number",
  floorNumber: 10,
  totalFloors: 25,
  moveIn: { type: "now" },
  rooms: 3,
  bathrooms: 2,
  approvalDate: "2020-05-01",
  parking: { basis: "perHousehold", value: 1.2 },
  managementFee: { type: "average", monthlyWon: 250_000, included: ["general"] },
  direction: "남향",
  directionBasis: "거실",
}, { officePhone: office.mobile }).inputs;

const savedLimits = {
  version: 2,
  dailyCreateLimit: 10,
  monthlyCostLimitMicroUsd: 10_000_000,
  defaults: { dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 },
  ranges: { daily: [1, 50], monthly: [10_000, 100_000_000] },
  usage: { day: "2026-11-20", todayCreates: 2, monthCostMicroUsd: 420_000 },
};

function draftOf(source, extra = {}) {
  return {
    id: "zz-draft-1",
    source: { type: source.type, id: source.id, title: source.title },
    sourcePublic: true,
    currentSource: source,
    status: "completed",
    closed: null,
    errorCode: null,
    inputs: source.type === "complex" ? {} : listingInputs,
    emphasisNumbers: "",
    needsLocation: source.type !== "complex",
    result: null,
    checks: null,
    createdAt: "2026-11-20T05:58:00.000Z",
    updatedAt: "2026-11-20T05:58:00.000Z",
    closedAt: null,
    ...extra,
  };
}
const listItem = (draft) => ({ id: draft.id, source: draft.source, status: draft.status, closed: draft.closed, errorCode: draft.errorCode, title: draft.result?.title ?? null, createdAt: draft.createdAt, closedAt: draft.closedAt });

const envelope = (data) => ({ json: { ok: true, data, requestId: "test" } });

// 늘 같은 시각에서 시작하고(시계는 그 뒤 흐름), 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
// 클립보드는 가짜로 바꿔 복사한 글을 시험 쪽에서 읽는다.
async function setup(page, { width = 390, limits = savedLimits, drafts = [], draftReads = {}, create } = {}) {
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => {
    window.__copied = [];
    window.__clipFail = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text) => { if (window.__clipFail) throw new Error("blocked"); window.__copied.push(text); } },
    });
  });
  page.on("dialog", (dialog) => dialog.accept());
  const calls = { requests: [], limitPuts: [], creates: [], closes: [], reads: {} };
  let limitState = limits;
  await page.route("**/api/admin/**", (route) => route.fulfill({ status: 503, json: { ok: false, error: { code: "TEST_OFFLINE", message: "시험 오류", retryable: false }, requestId: "test" } }));
  await page.route("**/api/admin/v1/work/public-tools/session", (route) => route.fulfill(envelope({ blogEnabled: true, realpriceEnabled: false, administrator: "시험 관리자", csrfToken: "test-csrf", schemaVersion: 4 })));
  await page.route(BLOG, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const body = request.postData() ?? "";
    calls.requests.push(`${request.method()} ${url.pathname}${url.search} ${body}`);
    const path = url.pathname.replace(/^.*\/work\/blog/u, "");
    if (path === "/sources") return route.fulfill(envelope({ items: sources, styles }));
    if (path === "/limits") {
      if (request.method() === "PUT") {
        const sent = request.postDataJSON();
        calls.limitPuts.push({ body: sent, csrf: request.headers()["x-admin-csrf"] });
        limitState = { ...limitState, version: sent.version + 1, dailyCreateLimit: sent.dailyCreateLimit, monthlyCostLimitMicroUsd: sent.monthlyCostLimitMicroUsd };
      }
      return route.fulfill(envelope(limitState));
    }
    if (path === "/drafts") {
      if (request.method() === "POST") {
        calls.creates.push(request.postDataJSON());
        return route.fulfill(envelope({ draft: create() }));
      }
      return route.fulfill(envelope({ items: drafts.map(listItem) }));
    }
    const match = path.match(/^\/drafts\/([^/]+)(?:\/(confirm|cancel))?$/u);
    if (match && match[2]) {
      calls.closes.push(`${match[1]}:${match[2]}`);
      const base = draftReads[match[1]]?.(99) ?? drafts.find((item) => item.id === match[1]);
      return route.fulfill(envelope({ draft: { ...base, closed: match[2] === "confirm" ? "confirmed" : "cancelled", closedAt: "2026-11-20T06:10:00.000Z" } }));
    }
    if (match) {
      calls.reads[match[1]] = (calls.reads[match[1]] ?? 0) + 1;
      const draft = draftReads[match[1]]?.(calls.reads[match[1]]) ?? drafts.find((item) => item.id === match[1]);
      return route.fulfill(envelope({ draft }));
    }
    return route.fulfill({ status: 404, json: { ok: false, error: { code: "NOT_FOUND", message: "없음", retryable: false }, requestId: "test" } });
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
const step = (page, no) => page.locator(`[data-bl-step="${no}"]`);
const copied = (page) => page.evaluate(() => window.__copied);

test("글 초안 한도: 한도가 없으면 'AI 사용 한도'가 펼쳐져 처음 값(하루 10편 · 월 10달러)을 채우고, 저장 전에는 만들 수 없다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { limits: { ...savedLimits, version: 1, dailyCreateLimit: null, monthlyCostLimitMicroUsd: null, usage: { day: "2026-11-20", todayCreates: 0, monthCostMicroUsd: 0 } } });
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-limits-fold]")).toHaveAttribute("open", "");
  await expect(page.locator("[data-bl-limits-badge]")).toHaveText("아직 없음");
  await expect(page.locator("#bl-daily")).toHaveValue("10");
  await expect(page.locator("#bl-monthly")).toHaveValue("10.00");

  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(page.locator("[data-bl-make]")).toBeDisabled();
  await expect(page.locator("[data-bl-make-note]")).toHaveText("AI 사용 한도를 저장하면 만들 수 있습니다.");

  await page.locator("#bl-daily").fill("0");
  await page.getByRole("button", { name: "한도 저장" }).click();
  await expect(page.locator("[data-bl-limits-alert]")).toContainText("하루 만들기는 1 ~ 50편");
  expect(calls.limitPuts, "범위 밖 값은 보내지 않음").toEqual([]);

  await page.locator("#bl-daily").fill("10");
  await page.getByRole("button", { name: "한도 저장" }).click();
  await expect(page.locator("[data-bl-limits-alert]")).toContainText("한도를 저장했습니다.");
  expect(calls.limitPuts).toEqual([{ body: { version: 1, dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 }, csrf: "test-csrf" }]);
  await expect(page.locator("[data-bl-limits-badge]")).toHaveText("· 하루 10편 · 월 10.00달러");
  await expect(page.locator("[data-bl-usage-text]")).toHaveText("오늘 0 / 10편 · 이번 달 0.00 / 10.00달러(추정)");
  await expect(page.locator("[data-bl-make]")).toBeEnabled();
  assertNoErrors();
});

test("글 초안 360px 매물: 막힌 매물은 고를 수 없고, '찾기'로 좁히며, 명시사항 빈 칸이 있으면 '다음: 글 성격'에서 멈춘다(가로 넘침 없음)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-kind-label='listing']")).toHaveText("매물 2");
  await expect(page.locator("[data-bl-kind-label='complex']")).toHaveText("단지 소개 1");
  await expect(page.locator("[data-bl-source-status]")).toHaveText("2건");
  await expect(page.getByRole("button", { name: "가상숲분양권 고르기" })).toBeDisabled();
  await expect(page.locator(".bl-card.is-blocked")).toContainText("분양권은 명시 기준");

  await page.locator("#bl-q").fill("분양권");
  await page.locator("#bl-q").press("Enter");
  await expect(page.locator("[data-bl-source-status]")).toHaveText("“분양권” 1건");
  await page.locator("#bl-q").fill("");
  await page.getByRole("button", { name: "찾기", exact: true }).click();
  await expect(page.locator("[data-bl-source-status]")).toHaveText("2건");

  await page.getByRole("button", { name: "가상숲1단지 고르기" }).click();
  await expect(step(page, 1)).toHaveClass(/bl-step--done/u);
  await expect(step(page, 1).locator("[data-bl-summary]")).toHaveText("가상숲1단지 · 매매 4억 5,000만 원");
  await expect(step(page, 3)).toHaveClass(/bl-step--locked/u);
  await expect(page.locator("[data-bl-row='location'] input"), "소재지 칸은 비어서 시작").toHaveValue("");
  expect(await overflowOf(page), "명시사항 칸이 다 펼쳐진 360px").toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  const alert = page.locator("[data-bl-fields-alert]");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("소재지");
  await expect(alert).toContainText("빈 칸이 있으면 만들 수 없습니다.");
  await expect(step(page, 3), "빈 칸이 있으면 3단계가 열리지 않음").toHaveClass(/bl-step--locked/u);
  await expect(page.locator("[data-bl-row='location']")).toHaveClass(/bl-row--empty/u);
  await expect(page.locator("[data-bl-row='location'] input")).toBeFocused();
  expect(calls.creates, "만들기 요청 없음").toEqual([]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("글 초안 단지 소개: 만들기 → 5초마다 확인 → 결과, 입력에 없는 가격 숫자는 복사를 막고 고치면 풀리며, 복사 글 끝에 명시사항이 붙는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = {
    title: "가상숲 단지 소개",
    paragraphs: ["가상숲 단지는 1,200세대입니다.", "이 단지 매물은 4억 5,000만원입니다."],
    hashtags: ["천동", "가상숲"],
    snsShort: "가상숲 단지 1,200세대",
    factsUsed: ["세대수"],
  };
  const queued = draftOf(complex, { status: "queued", needsLocation: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
  const calls = await setup(page, {
    create: () => queued,
    draftReads: { "zz-draft-1": (n) => (n === 1 ? { ...queued, status: "in_progress" } : { ...queued, status: "completed", result }) },
  });
  await page.goto("/admin/work/blog/");
  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await expect(page.locator("[data-bl-count]")).toHaveText("✓ 채울 칸이 없습니다.");
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(step(page, 3)).toHaveClass(/bl-step--open/u);
  await expect(page.locator("input[name='bl-style'][value='plain']")).toBeChecked();
  await expect(page.locator("input[name='bl-style'][value='urgent']"), "단지 소개 글에는 급매를 잠금").toBeDisabled();
  await expect(page.locator("[data-bl-make-note]")).toHaveText("만들면 오늘 3 / 10편이 됩니다. 1 ~ 3분 걸립니다.");

  await page.getByRole("button", { name: "글 초안 만들기" }).click();
  await expect(page.locator("[data-bl-wait]")).toBeVisible();
  expect(calls.creates).toEqual([{ source: { type: "complex", id: "zz-forest" }, style: "plain", inputs: {}, emphasis: "" }]);
  await expect(page.locator("[data-bl-wait-text]")).toContainText("11. 20. 15:00에 보냄");

  await page.clock.runFor(5_000);
  await expect.poll(() => calls.reads["zz-draft-1"]).toBe(1);
  await expect(page.locator("[data-bl-wait]")).toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  expect(calls.reads["zz-draft-1"]).toBe(2);

  await expect(page.locator("[data-bl-reloc-row]"), "단지 소개는 소재지 칸 없음").toBeHidden();
  await expect(page.locator("[data-bl-check]")).toContainText("복사 전에 고칠 곳 1곳");
  await expect(page.locator("[data-bl-check]")).toContainText("단지 소개 글에 매물 가격·층 숫자: 문단 2 '4억 5,000만원'");
  await expect(page.locator("[data-bl-where='p2']")).toHaveClass(/bl-para--block/u);
  await expect(page.getByRole("button", { name: "블로그 글 복사" }).first()).toBeDisabled();
  await expect(page.locator("[data-bl-bar]")).toBeVisible();
  await expect(page.locator("[data-bl-bar-text]")).toHaveText("고칠 곳 1곳 · 복사 막힘");
  await expect(page.locator("[data-bl-bar-copy]")).toBeDisabled();

  await page.locator("#bl-p2").fill("단지 안 산책길이 있습니다.");
  await expect(page.locator("[data-bl-bar-text]")).toHaveText("✓ 복사할 수 있음");
  await expect(page.locator("[data-bl-copy='blog']")).toBeEnabled();
  await page.locator("[data-bl-copy='blog']").click();
  await expect(page.locator("[data-bl-copy-status]")).toHaveText("✓ 블로그 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.");
  const [blogText] = await copied(page);
  expect(blogText.startsWith("가상숲 단지 소개\n\n가상숲 단지는 1,200세대입니다.\n\n단지 안 산책길이 있습니다.\n\n#천동 #가상숲\n\n──────────\n[중개사무소] ")).toBe(true);
  expect(blogText, "명시사항은 office.json의 사무소 5항목").toContain(`${office.mobile} · 등록번호 `);

  await page.evaluate(() => { window.__clipFail = true; });
  await page.locator("[data-bl-copy='sns']").click();
  await expect(page.locator("[data-bl-preview-fold]"), "자동 복사가 막히면 미리 보기를 펼침").toHaveAttribute("open", "");
  await expect(page.locator("[data-bl-copy-status]")).toContainText("자동 복사가 막혔습니다");
  await expect(page.locator("#bl-preview")).toHaveValue(/^가상숲 단지 1,200세대\n\n#천동 #가상숲\n\n──────────\n\[중개사무소\] /u);

  await page.getByRole("button", { name: "다 씀" }).click();
  await expect(page.locator("[data-bl-copy-status]")).toHaveText("'다 씀'으로 표시했습니다. 30일 뒤 지웁니다.");
  expect(calls.closes).toEqual(["zz-draft-1:confirm"]);
  await expect(page.locator("[data-bl-discard]")).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("글 초안 다시 열기 360px: 소재지는 저장하지 않아 다시 넣어야 복사가 풀리고, 호수처럼 보이면 막으며, 요청·브라우저 저장소에 남지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = {
    title: "가상숲1단지 매매 4억 5,000만원",
    paragraphs: ["전용 84.97㎡, 10층 남향입니다.", "관리비는 월 평균 25만원입니다."],
    hashtags: ["천동"],
    snsShort: "가상숲1단지 매매",
    factsUsed: [],
  };
  const done = draftOf(listing, { result });
  const expired = draftOf(listing, { id: "zz-draft-2", status: "expired", result: null, errorCode: "AI_RESULT_EXPIRED" });
  const calls = await setup(page, { width: 360, drafts: [done, expired] });
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-drafts-summary]")).toHaveText("보관 중인 초안 2");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 4억 5,000만원 열기" }).click();

  await expect(page.locator("[data-bl-result]")).toBeVisible();
  const reloc = page.locator("#bl-reloc");
  await expect(reloc).toBeVisible();
  await expect(reloc).toHaveValue("");
  await expect(page.locator("[data-bl-check]")).toContainText("명시사항 빈 칸: 소재지");
  await expect(page.locator("[data-bl-copy='blog']")).toBeDisabled();
  await expect(page.locator("[data-bl-disclosure] .bl-gap")).toHaveText("비어 있음");

  await reloc.fill(`${LOCATION} 101호`);
  await expect(page.locator("[data-bl-check]")).toContainText("소재지에 호수·전화번호처럼 보이는 글자가 있습니다.");
  await expect(page.locator("[data-bl-copy='blog']")).toBeDisabled();
  await reloc.fill(LOCATION);
  await expect(page.locator("[data-bl-copy='sns']")).toBeEnabled();
  await page.locator("[data-bl-copy='sns']").click();
  const [snsText] = await copied(page);
  expect(snsText).toContain(`[매물] 소재지 ${LOCATION} 10층 · 면적 전용 84.97㎡ · 가격 매매 4억 5,000만 원`);
  expect(await overflowOf(page), "결과 화면 360px").toBeLessThanOrEqual(0);

  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
  expect(stored.includes("가상동"), "소재지는 브라우저 저장소·주소에 없음").toBe(false);
  expect(calls.requests.some((line) => line.includes("가상동")), "소재지는 어떤 요청에도 없음").toBe(false);

  await page.getByRole("button", { name: "새 글 만들기" }).click();
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 4억 5,000만원 열기" }).click();
  await expect(reloc, "'새 글 만들기' 뒤 다시 열면 소재지를 다시 넣어야 함").toHaveValue("");
  await expect(page.locator("[data-bl-copy='blog']")).toBeDisabled();

  await page.reload();
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 4억 5,000만원 열기" }).click();
  await expect(reloc, "새로고침 뒤에도 소재지는 비어 있음").toHaveValue("");

  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 열기" }).click();
  await expect(page.locator("[data-bl-fail]")).toBeVisible();
  await expect(page.locator("[data-bl-fail-title]")).toHaveText("결과를 받지 못했습니다(10분 지남)");
  await expect(page.locator("[data-bl-retry]"), "고른 자료가 없으면 '다시 만들기'를 숨김").toBeHidden();
  assertNoErrors();
});
