// 글 초안 시험(e2e/admin-blog.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API와 칸 찾기.
// 2026-11-24 시험 파일에서 그대로 옮김. 매물·단지 이름·주소·글은 모두 지어낸 값이고 OpenAI는 부르지 않는다.
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { BLOG_STYLES, validateBlogInputs } from "../../src/lib/work/blog-checks.mjs";
import { listBlogSources } from "../../src/lib/work/blog-sources.mjs";

export const NOW = new Date("2026-11-20T06:00:00Z"); // 한국 15:00
export const BLOG = "**/api/admin/v1/work/blog/**";
export const rules = JSON.parse(readFileSync(new URL("../../src/data/work/ad-disclosure-rules.json", import.meta.url), "utf8"));
export const office = JSON.parse(readFileSync(new URL("../../src/data/office.json", import.meta.url), "utf8"));
export const LOCATION = "대전광역시 동구 가상동 1";

export const sources = listBlogSources({
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
export const [listing, , complex] = sources;
export const styles = BLOG_STYLES.map(({ id, label, note }) => ({ id, label, note }));
// 공동주택 명시사항을 소재지만 빼고 다 채운 값(서버가 초안에 남기는 모양).
export const listingInputs = validateBlogInputs({
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

export const savedLimits = {
  version: 2,
  dailyCreateLimit: 10,
  monthlyCostLimitMicroUsd: 10_000_000,
  defaults: { dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 },
  ranges: { daily: [1, 50], monthly: [10_000, 100_000_000] },
  usage: { day: "2026-11-20", todayCreates: 2, monthCostMicroUsd: 420_000 },
};

export function draftOf(source, extra = {}) {
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
export const listItem = (draft) => ({ id: draft.id, source: draft.source, status: draft.status, closed: draft.closed, errorCode: draft.errorCode, title: draft.result?.title ?? null, createdAt: draft.createdAt, closedAt: draft.closedAt });

export const envelope = (data) => ({ json: { ok: true, data, requestId: "test" } });

// 늘 같은 시각에서 시작하고(시계는 그 뒤 흐름), 실제 서버는 부르지 않는다(맞지 않는 관리 API는 503).
// 클립보드는 가짜로 바꿔 복사한 글을 시험 쪽에서 읽는다.
export async function setup(page, { width = 390, limits = savedLimits, drafts = [], draftReads = {}, create } = {}) {
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

export function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}
export const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// 보이는 명시사항 선택 단추(.bl-seg)마다 글자 노드가 놓인 줄 수를 세어 두 줄 이상인 단추 이름을 돌려준다.
// 좁은 폭에서 '다세대주택'·'위반건축물'이 두 줄로 꺾이면 단추가 높아져 아래 칸이 밀린다.
export const twoLineChoices = (page) => page.evaluate(() => [...document.querySelectorAll(".bl-seg .work-choice")].filter((choice) => choice.offsetParent).flatMap((choice) => {
  const walker = document.createTreeWalker(choice, NodeFilter.SHOW_TEXT);
  const tops = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
  }
  return tops.size > 1 ? [`${choice.textContent.trim()}(${choice.querySelector("input")?.checked ? "고름" : "안 고름"})`] : [];
}));
// 고르기 전에 한 번, 보이는 단추를 하나씩 고를 때마다 한 번 잰다. 누른 단추 이름을 돌려준다.
export async function expectOneLineChoices(page, label) {
  expect(await twoLineChoices(page), `${label}: 고르기 전 두 줄 단추`).toEqual([]);
  const choices = page.locator(".bl-seg .work-choice:visible");
  const names = [];
  for (let index = 0; index < await choices.count(); index++) {
    const choice = choices.nth(index);
    names.push((await choice.innerText()).trim());
    await choice.click();
    expect(await twoLineChoices(page), `${label}: '${names.at(-1)}'을 고른 뒤 두 줄 단추`).toEqual([]);
  }
  expect(names, `${label}: 긴 단추도 눌러 봄`).toEqual(expect.arrayContaining(["다세대주택", "위반건축물"]));
  return names;
}
export const step = (page, no) => page.locator(`[data-bl-step="${no}"]`);
export const copied = (page) => page.evaluate(() => window.__copied);
