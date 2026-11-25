// 글 초안 화면(P3, /admin/work/blog/)을 가짜 업무 API로 본다. 매물·단지 이름·주소·글은 모두 지어낸 값이고 OpenAI는 부르지 않는다.
// 운영자 결정 2026-11-20 15:51:54: B안 단계 접기, 소재지는 매번 직접 입력(저장 안 함), 명시사항 빈 칸이면 만들기부터 막음.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { listBlogSources } from "../src/lib/work/blog-sources.mjs";
import {
  NOW,
  BLOG,
  rules,
  office,
  LOCATION,
  sources,
  styles,
  listingInputs,
  savedLimits,
  draftOf,
  listItem,
  envelope,
  setup,
  collectErrors,
  overflowOf,
  twoLineChoices,
  expectOneLineChoices,
  step,
  copied,
  listing,
  complex,
} from "./support/blog-mock.mjs";

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
  await expect(page.locator("[data-bl-copy]")).toBeEnabled();
  await page.locator("[data-bl-copy]").click();
  await expect(page.locator("[data-bl-copy-status]")).toHaveText("✓ 블로그 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.");
  const [blogText] = await copied(page);
  expect(blogText.startsWith("가상숲 단지 소개\n\n가상숲 단지는 1,200세대입니다.\n\n단지 안 산책길이 있습니다.\n\n#천동 #가상숲\n\n──────────\n[중개사무소] ")).toBe(true);
  expect(blogText, "명시사항은 office.json의 사무소 5항목").toContain(`${office.mobile} · 등록번호 `);

  // 옛 초안(snsShort 한 칸)은 그 글을 인스타그램·스레드 칸에 그대로 보인다.
  await page.locator("input[name='bl-place'][value='instagram']").check();
  await expect(page.locator("#bl-instagram")).toHaveValue("가상숲 단지 1,200세대");
  await expect(page.locator("[data-bl-copy]")).toHaveText("인스타그램 글 복사");
  await page.evaluate(() => { window.__clipFail = true; });
  await page.locator("[data-bl-copy]").click();
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
  await expect(page.locator("[data-bl-copy]")).toBeDisabled();
  await expect(page.locator("[data-bl-disclosure] .bl-gap")).toHaveText("비어 있음");

  await reloc.fill(`${LOCATION} 101호`);
  await expect(page.locator("[data-bl-check]")).toContainText("소재지에 호수·전화번호처럼 보이는 글자가 있습니다.");
  await expect(page.locator("[data-bl-copy]")).toBeDisabled();
  await reloc.fill(LOCATION);
  await page.locator("input[name='bl-place'][value='instagram']").check();
  await expect(page.locator("[data-bl-copy]")).toBeEnabled();
  await page.locator("[data-bl-copy]").click();
  await expect(page.locator("[data-bl-copy-status]")).toHaveText("✓ 인스타그램 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.");
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
  await expect(page.locator("[data-bl-copy]")).toBeDisabled();

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

test("글 초안 360px 명시사항 칸 밀림 0px: 칸을 고르거나 채워도 아래 칸 위치가 그대로(매물 안내지와 같은 칸), 선택 단추 글자는 360·390px에서 늘 한 줄", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360 });
  await page.goto("/admin/work/blog/");
  await page.getByRole("button", { name: "가상숲1단지 고르기" }).click();
  const rowOf = (key) => page.locator(`[data-bl-row='${key}']`);
  const topOf = (key) => rowOf(key).evaluate((element) => Math.round(element.getBoundingClientRect().top + window.scrollY));

  const beforePick = await topOf("floor");
  await rowOf("violation").locator("label:has(input[value='none'])").click();
  await expect(page.locator("[data-bl-count]")).not.toContainText("위반건축물");
  expect(await topOf("floor") - beforePick, "위반건축물을 고른 뒤 아래 칸").toBe(0);

  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(rowOf("location").locator("[data-bl-mark]")).toBeVisible();
  const beforeFill = await topOf("kind");
  await rowOf("location").locator("input").fill("대전광역시 동구 가상동 100");
  await expect(rowOf("location").locator("[data-bl-mark]")).toBeHidden();
  expect(await topOf("kind") - beforeFill, "소재지를 채운 뒤 아래 칸").toBe(0);
  await expectOneLineChoices(page, "360px");
  await page.setViewportSize({ width: 390, height: 900 });
  await expectOneLineChoices(page, "390px");
  assertNoErrors();
});

// 2026-11-23 사용자 결정(①단지 자료 다 넣기 ②길이·구성 지시 ③현장 메모 칸 늘리기): 소제목이 있는 새 꼴 초안과 이름이 바뀐 메모 칸.
const [complexWithDetails] = listBlogSources({
  rules,
  listings: [],
  naverListings: { items: [] },
  complexes: [{
    status: "published", slug: "zz-forest", name: "가상숲 단지", areaName: "천동", summary: "가상 단지 요약",
    facts: [{ label: "세대수", value: "1,200세대" }],
    unitGroups: [{ category: "분양", areaLabel: "59㎡", households: 400 }],
    livingSections: [{ category: "nature", title: "가상 공원", description: "가상 공원이 단지 옆에 있습니다." }],
    checkpoints: [{ title: "동·층·방향", description: "낮과 저녁에 확인합니다." }],
  }],
});

test("글 초안 360px 새 꼴(2026-11-23): 소제목 칸·현장에서 확인할 점 칸이 보이고, 단지 자료 숫자는 통과·소제목의 가격은 막으며, 복사 글에 '■ 소제목'과 확인할 점 목록이 붙는다. 메모 칸은 매물 '대표 현장 메모'·단지 '강조점' 500자", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = {
    title: "가상숲 단지 소개",
    paragraphs: ["가상숲 단지는 1,200세대입니다.", "전용 59㎡가 400세대입니다.", "가상 공원이 단지 옆에 있습니다."],
    headings: ["단지 개요", "", "4억 원대 생활"],
    checklist: ["동·층·방향을 낮과 저녁에 확인", "관리비 고지서 확인"],
    hashtags: ["천동"],
    snsShort: "가상숲 단지 1,200세대",
    factsUsed: ["세대수"],
  };
  const queued = draftOf(complexWithDetails, { status: "queued", needsLocation: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
  await setup(page, {
    width: 360,
    create: () => queued,
    draftReads: { "zz-draft-1": () => ({ ...queued, status: "completed", result }) },
  });
  await page.goto("/admin/work/blog/");
  await page.getByRole("button", { name: "가상숲1단지 고르기" }).click();
  await expect(page.locator("[data-bl-emphasis-label]")).toHaveText("대표 현장 메모(선택)");
  await expect(page.locator("#bl-emphasis")).toHaveAttribute("maxlength", "500");
  await expect(page.locator("#bl-emphasis")).toHaveAttribute("placeholder", "예: 2024년 욕실 수리, 남향 거실, 앞 동 없이 트인 전망");
  await page.locator("[data-bl-change='1']").click();
  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await expect(page.locator("[data-bl-emphasis-label]")).toHaveText("강조점(선택)");
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await page.locator("#bl-emphasis").fill("가".repeat(500));
  await expect(page.locator("[data-bl-emphasis-count]")).toContainText("500 / 500자");
  await page.locator("#bl-emphasis").fill("");
  await page.getByRole("button", { name: "글 초안 만들기" }).click();
  await expect(page.locator("[data-bl-wait]"), "만들기 요청이 끝나 확인 시계가 걸린 뒤에 시계를 돌림").toBeVisible();
  await page.clock.runFor(5_000);
  await expect(page.locator("[data-bl-result]")).toBeVisible();

  await expect(page.locator("#bl-h1")).toHaveValue("단지 개요");
  await expect(page.locator("#bl-h2"), "소제목이 없는 문단에는 칸이 없음").toHaveCount(0);
  await expect(page.locator("#bl-h3")).toHaveValue("4억 원대 생활");
  await expect(page.locator("label[for='bl-h3']")).toHaveText("소제목(문단 3)");
  await expect(page.locator("[data-bl-checklist-row]")).toBeVisible();
  await expect(page.locator("#bl-checklist")).toHaveValue("동·층·방향을 낮과 저녁에 확인\n관리비 고지서 확인");
  await expect(page.locator("[data-bl-check]")).toContainText("복사 전에 고칠 곳 1곳");
  await expect(page.locator("[data-bl-check]")).toContainText("단지 소개 글에 매물 가격·층 숫자: 문단 3 소제목 '4억 원'");
  await expect(page.locator("[data-bl-where='h3']")).toHaveClass(/bl-para--block/u);
  await expect(page.locator("[data-bl-where='p2']"), "단지 자료의 59㎡는 입력에 있는 숫자").not.toHaveClass(/bl-para--block|bl-para--warn/u);
  await expect(page.locator("[data-bl-where='p3']"), "단지 자료에 있는 '공원'은 경고하지 않음").not.toHaveClass(/bl-para--warn/u);
  await page.locator("[data-bl-check] button.bl-jump").first().click();
  await expect(page.locator("#bl-h3")).toBeFocused();

  await page.locator("#bl-h3").fill("생활 환경");
  await page.locator("#bl-checklist").fill("- 동·층·방향을 낮과 저녁에 확인\n\n관리비 고지서 확인\n마트 동선 확인");
  await expect(page.locator("[data-bl-check]")).toContainText("확인할 곳 1곳(복사는 됨)");
  await expect(page.locator("[data-bl-check]")).toContainText("입력에 없는 생활 편의: 현장에서 확인할 점 '마트'");
  await expect(page.locator("[data-bl-bar-text]")).toHaveText("✓ 복사할 수 있음");
  await page.locator("[data-bl-copy]").click();
  const [blogText] = await copied(page);
  expect(blogText.startsWith([
    "가상숲 단지 소개",
    "■ 단지 개요\n가상숲 단지는 1,200세대입니다.",
    "전용 59㎡가 400세대입니다.",
    "■ 생활 환경\n가상 공원이 단지 옆에 있습니다.",
    "■ 현장에서 확인할 점\n- 동·층·방향을 낮과 저녁에 확인\n- 관리비 고지서 확인\n- 마트 동선 확인",
    "#천동",
    "──────────\n[중개사무소] ",
  ].join("\n\n"))).toBe(true);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

// 카드 그림(2026-11-23 사용자 선택 "B 큰 숫자 인포그래픽"·"3장 한 벌"): 단지 숫자는 빌드 때 실은 공개 단지 자료(complexes.json)에서만.
const realComplexes = JSON.parse(readFileSync(new URL("../src/data/complexes.json", import.meta.url), "utf8"));
const sinheung = listBlogSources({ rules, listings: [], naverListings: { items: [] }, complexes: realComplexes }).find((source) => source.id === "sinheung-sk-view");
const cardResult = {
  title: "신흥 SK뷰 단지 살펴보기",
  paragraphs: ["신흥 SK뷰는 12개동 1,588세대 단지입니다.", "AI 글에 999세대라고 잘못 써도 카드에는 공개 자료 숫자만 들어갑니다."],
  headings: ["단지 개요", ""],
  checklist: ["주차 동선 확인"],
  hashtags: ["신흥동"],
  snsShort: "신흥 SK뷰 1,588세대",
  factsUsed: ["규모"],
};
const naturalSizes = (page) => page.locator("[data-bl-cardset-list] img").evaluateAll((images) => images.map((image) => `${image.naturalWidth}x${image.naturalHeight}`));

test("글 초안 카드 그림 1280px: 단지 소개 초안은 공개 단지 자료로 카드 3장(표지·단지 정보·확인할 점)을 그리고, 저장은 보조 단추이며 서버 요청이 늘지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const done = draftOf(sinheung, { result: cardResult });
  const calls = await setup(page, { width: 1280, drafts: [done] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "신흥 SK뷰 단지 살펴보기 열기" }).click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  const before = calls.requests.length;

  const panel = page.locator("[data-bl-cardset]");
  await expect(panel).toBeVisible();
  await expect(panel.locator("h3")).toContainText("카드 그림");
  const images = panel.locator("[data-bl-cardset-list] img");
  await expect(images).toHaveCount(3);
  for (const image of await images.all()) await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/u);
  await expect(images.nth(0)).toHaveAttribute("alt", "카드 그림 1/3장: 표지");
  await expect(images.nth(2)).toHaveAttribute("alt", "카드 그림 3/3장: 확인할 점");
  await expect.poll(() => naturalSizes(page)).toEqual(["1080x1350", "1080x1350", "1080x1350"]);
  await expect(panel.locator("figcaption span")).toHaveText(["표지", "단지 정보", "확인할 점"]);
  const links = panel.locator("[data-bl-cardset-link]");
  await expect(links).toHaveText(["1장 저장", "2장 저장", "3장 저장"]);
  expect(await links.evaluateAll((list) => list.map((link) => link.getAttribute("download")))).toEqual(["2026-11-20-신흥SK뷰-1.png", "2026-11-20-신흥SK뷰-2.png", "2026-11-20-신흥SK뷰-3.png"]);

  const save = panel.locator("[data-bl-cardset-save]");
  await expect(save).toHaveText("카드 3장 저장");
  await expect(save, "'카드 3장 저장'은 보조 단추").toHaveClass(/work-secondary-button/u);
  await expect(panel.locator(".work-primary-button"), "주 단추는 '블로그 글 복사' 하나").toHaveCount(0);
  await expect(page.locator(".bl-result__side .work-primary-button")).toHaveText(["블로그 글 복사"]);

  const saved = [];
  page.on("download", (download) => saved.push(download.suggestedFilename()));
  await save.click();
  await expect.poll(() => saved.length).toBe(3);
  expect(saved.sort()).toEqual(["2026-11-20-신흥SK뷰-1.png", "2026-11-20-신흥SK뷰-2.png", "2026-11-20-신흥SK뷰-3.png"]);
  await expect(panel.locator("[data-bl-cardset-status]")).toContainText("✓ 카드 3장을 내려받았습니다.");

  // 글을 고쳐도 카드는 공개 자료 그대로라 다시 그리지 않는다.
  const first = await images.nth(1).getAttribute("src");
  await page.locator("#bl-p1").fill("신흥 SK뷰 소개를 고쳤습니다.");
  await expect(page.locator("[data-bl-check]")).toBeVisible();
  await page.waitForTimeout(400);
  expect(await images.nth(1).getAttribute("src"), "글을 고쳐도 같은 그림").toBe(first);
  expect(calls.requests.length, "카드를 그리는 동안 업무 API 요청이 늘지 않음").toBe(before);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
  expect(stored.includes("data:image"), "그림은 브라우저 저장소·주소에 없음").toBe(false);
  assertNoErrors();
});

test("글 초안 카드 그림 360px: 매물 초안은 명시사항이 다 찰 때만 사진 없는 표지 1장을 그리고, 소재지를 지우거나 호수를 넣으면 지운다(가로 넘침 없음)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = { title: "가상숲1단지 매매", paragraphs: ["전용 84.97㎡, 10층 남향입니다."], hashtags: ["천동"], snsShort: "가상숲1단지", factsUsed: [] };
  const calls = await setup(page, { width: 360, drafts: [draftOf(listing, { result })] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 열기" }).click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();

  const panel = page.locator("[data-bl-cardset]");
  await expect(panel).toBeVisible();
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("명시사항 빈 칸을 모두 채우면 표지를 만듭니다.");
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(panel.locator("[data-bl-cardset-save]")).toBeHidden();

  await page.locator("#bl-reloc").fill(LOCATION);
  await expect(panel.locator("img")).toHaveCount(1);
  await expect(panel.locator("img")).toHaveAttribute("alt", "카드 그림: 매물 표지");
  await expect.poll(() => naturalSizes(page)).toEqual(["1080x1350"]);
  await expect(panel.locator("[data-bl-cardset-save]")).toHaveText("표지 저장");
  await expect(panel.locator("[data-bl-cardset-link]")).toBeHidden();
  await expect(panel.locator("[data-bl-cardset-link]")).toHaveAttribute("download", "2026-11-20-매물표지.png");
  expect(await overflowOf(page), "표지가 보인 360px").toBeLessThanOrEqual(0);

  await page.locator("#bl-reloc").fill(`${LOCATION} 101호`);
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("소재지를 고치면 표지를 만듭니다.");
  await expect(panel.locator("img"), "호수처럼 보이면 표지를 지움").toHaveCount(0);
  await page.locator("#bl-reloc").fill("");
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("명시사항 빈 칸을 모두 채우면 표지를 만듭니다.");
  await expect(panel.locator("img")).toHaveCount(0);
  expect(calls.requests.some((line) => line.includes("가상동")), "소재지는 어떤 요청에도 없음").toBe(false);
  assertNoErrors();
});

test("글 초안 카드 그림: 지금 공개 단지 자료에 없는 단지는 카드를 만들지 않고 까닭을 보인다", async ({ page }) => {
  const done = draftOf(complex, { result: { ...cardResult, title: "가상숲 단지 살펴보기" } });
  await setup(page, { width: 390, drafts: [done] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲 단지 살펴보기 열기" }).click();
  await expect(page.locator("[data-bl-cardset-status]")).toHaveText("이 단지는 지금 공개 단지 자료에 없어 카드를 만들 수 없습니다.");
  await expect(page.locator("[data-bl-cardset] img")).toHaveCount(0);
});

// 날개-2 2026-11-23 깨 보기 보탬(C13): 초안을 만든 뒤 자료가 막혀(sourcePublic false) 서버가 currentSource만 주는 경우.
test("글 초안 카드 그림: 지금 막힌 자료의 초안(sourcePublic false, currentSource 있음)은 카드 칸을 열지 않고 그림을 만들지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const done = draftOf(sinheung, { result: cardResult, sourcePublic: false });
  await setup(page, { width: 390, drafts: [done] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "신흥 SK뷰 단지 살펴보기 열기" }).click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  await expect(page.locator("[data-bl-source-gone]"), "까닭은 결과 위 안내 한 줄").toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator("[data-bl-cardset]")).toBeHidden();
  await expect(page.locator("[data-bl-cardset] img")).toHaveCount(0);
  assertNoErrors();
});

// 날개-2 2026-11-23 깨 보기 보탬(C14·C17): 소재지 100자(입력 상한)로 표지 글이 카드에 넘치는 경우.
test("글 초안 카드 그림 360px: 매물 소재지가 100자로 표지에 다 들어가지 않으면 그림을 내보내지 않고 까닭을 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const result = { title: "가상숲1단지 매매", paragraphs: ["전용 84.97㎡, 10층 남향입니다."], hashtags: ["천동"], snsShort: "가상숲1단지", factsUsed: [] };
  await setup(page, { width: 360, drafts: [draftOf(listing, { result })] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 열기" }).click();
  const panel = page.locator("[data-bl-cardset]");
  await page.locator("#bl-reloc").fill(LOCATION);
  await expect(panel.locator("img"), "짧은 소재지는 표지를 그림").toHaveCount(1);
  const long = `${LOCATION} ${"가상로 가상길 ".repeat(20)}`.slice(0, 100);
  expect(long.length).toBe(100);
  await page.locator("#bl-reloc").fill(long);
  await expect(panel.locator("[data-bl-cardset-status]")).toHaveText("내용이 길어 카드에 다 들어가지 않아 만들지 않았습니다.");
  await expect(panel.locator("img")).toHaveCount(0);
  await expect(panel.locator("[data-bl-cardset-save]")).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

// 2026-11-25 올릴 곳 탭 넷(사용자 답 13:26:16 "카카오톡도 해"): 인스타그램·스레드 글을 따로 받은 새 꼴 초안.
// 카카오톡 글은 따로 받지 않고 제목 + 인스타그램 글 + 명시사항으로 코드가 만든다.
const placedResult = {
  title: "가상숲1단지 매매 4억 5,000만원",
  paragraphs: ["전용 84.97㎡, 10층 남향입니다."],
  headings: ["매물 개요"],
  checklist: ["관리비 고지서 확인"],
  hashtags: ["천동", "가상숲1단지", "대전동구", "아파트매매", "남향", "천동아파트"],
  instagram: "가상숲1단지 전용 84.97㎡ 매매입니다.\n10층 남향이고 5억원에 나왔습니다.",
  threads: "가상숲1단지 전용 84.97㎡, 10층 남향 매매입니다.",
  factsUsed: [],
};
const pickPlace = (page, id) => page.locator(`input[name='bl-place'][value='${id}']`).check();
const placeTops = (page) => page.locator(".bl-places__list .work-choice").evaluateAll((list) => [...new Set(list.map((item) => Math.round(item.getBoundingClientRect().top)))]);

test("글 초안 올릴 곳 360px: 탭 넷이 한 줄에 들고, 고른 곳의 칸·글자 수·복사 글만 보이며, 그곳 글의 문제만 그곳 복사를 막는다. 스레드는 500자를 넘으면 막고, 카카오톡 글은 [제목] + 인스타그램 글 + 명시사항이다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360, drafts: [draftOf(listing, { result: placedResult })] });
  await page.goto("/admin/work/blog/");
  await page.locator("[data-bl-drafts-summary]").click();
  await page.getByRole("button", { name: "가상숲1단지 매매 4억 5,000만원 열기" }).click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  await page.locator("#bl-reloc").fill(LOCATION);
  const copy = page.locator("[data-bl-copy]");
  const check = page.locator("[data-bl-check]");
  const meter = page.locator("[data-bl-meter]");

  // 탭 넷: 360·390px에서 한 줄이고 글자가 두 줄로 꺾이지 않는다(고른 뒤에도).
  await expect(page.locator(".bl-places__list .work-choice")).toHaveText(["블로그", "인스타그램", "스레드", "카카오톡"]);
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ["instagram", "threads", "kakao", "blog"]) {
      await pickPlace(page, id);
      expect(await placeTops(page), `${width}px '${id}'을 고른 뒤 탭 줄 수`).toHaveLength(1);
      expect(await twoLineChoices(page), `${width}px '${id}'을 고른 뒤 두 줄 단추`).toEqual([]);
      expect(await overflowOf(page), `${width}px '${id}' 가로 넘침`).toBeLessThanOrEqual(0);
    }
  }
  await page.setViewportSize({ width: 360, height: 900 });

  // 블로그: 인스타그램 글의 문제(입력과 다른 5억원)는 블로그 복사를 막지 않고, 어디에 문제가 있는지만 알린다.
  await expect(copy).toHaveText("블로그 글 복사");
  await expect(copy).toBeEnabled();
  await expect(check).toContainText("✓ 복사할 수 있습니다");
  await expect(check).toContainText("다른 올릴 곳에도 고칠 곳이 있습니다: 인스타그램·카카오톡");
  await expect(page.locator("#bl-instagram")).toBeHidden();
  await expect(page.locator("#bl-threads")).toBeHidden();
  await expect(page.locator("[data-bl-look]")).toBeHidden();
  await expect(page.locator("[data-bl-checklist-row]")).toBeVisible();

  // 인스타그램: 그곳 칸만 보이고, 글의 가격이 입력과 달라 막힌다. 고치면 풀리고 해시태그 6개는 알리기만 한다.
  await pickPlace(page, "instagram");
  await expect(page.locator("#bl-title")).toBeHidden();
  await expect(page.locator("[data-bl-paragraphs]")).toBeHidden();
  await expect(page.locator("[data-bl-checklist-row]")).toBeHidden();
  await expect(page.locator("#bl-tags")).toBeVisible();
  await expect(page.locator("[data-bl-instagram-label]")).toHaveText("인스타그램 글");
  await expect(copy).toHaveText("인스타그램 글 복사");
  await expect(copy).toBeDisabled();
  await expect(check).toContainText("복사 전에 고칠 곳 1곳");
  await expect(check).toContainText("인스타그램 글 '5억원'");
  await expect(page.locator("[data-bl-where='instagram']")).toHaveClass(/bl-para--block/u);
  await expect(page.locator("[data-bl-bar-copy]")).toHaveText("인스타그램 글 복사");
  await expect(page.locator("[data-bl-bar-copy]")).toBeDisabled();
  const instagramText = "가상숲1단지 전용 84.97㎡ 매매입니다.\n10층 남향입니다.";
  await page.locator("#bl-instagram").fill(instagramText);
  await expect(copy).toBeEnabled();
  await expect(check).toContainText("확인할 곳 1곳(복사는 됨)");
  await expect(check).toContainText("해시태그가 6개입니다. 인스타그램 앱이 5개까지만 받을 수 있으니, 올릴 때 막히면 5개만 남기세요.");
  await expect(meter).toHaveText(/^2,200자 중 [\d,]+자 · 내 글 34자 \+ 자동으로 붙는 글 [\d,]+자 · 해시태그 6개$/u);
  await expect(page.locator("[data-bl-look]")).toBeVisible();
  await expect(page.locator("[data-bl-look-title]")).toHaveText("인스타그램에 올라갈 모습");
  await expect(page.locator("[data-bl-look-text]")).toHaveText(instagramText);
  // 미리보기 해시태그에만 '#'과 낱말이 줄 끝에서 갈라지지 않게 붙임 글자(U+2060)가 들어간다. 복사 글에는 없다(아래 instagramCopy 대조).
  await expect(page.locator("[data-bl-look-tags]")).toHaveText("#\u2060천동 #\u2060가상숲1단지 #\u2060대전동구 #\u2060아파트매매 #\u2060남향 #\u2060천동아파트");
  await expect(page.locator("[data-bl-look-img]"), "매물 표지 한 장이 올라갈 모습에 보임").toHaveAttribute("src", /^data:image\/png;base64,/u);
  await expect(page.locator("[data-bl-step-image-text]")).toHaveText("카드 그림을 휴대폰에 저장합니다.");
  await expect(page.locator("[data-bl-step-post]")).toHaveText("인스타그램 앱에서 새 게시물 → 저장한 그림 고르기 → 글 붙여 넣기.");
  await copy.click();
  await expect(page.locator("[data-bl-copy-status]")).toHaveText("✓ 인스타그램 글을 복사했습니다. 명시사항까지 함께 붙여 넣으세요.");
  const instagramCopy = (await copied(page)).at(-1);
  expect(instagramCopy.startsWith(`${instagramText}\n\n#천동 #가상숲1단지 #대전동구 #아파트매매 #남향 #천동아파트\n\n──────────\n`)).toBe(true);
  expect(instagramCopy).toContain(`[매물] 소재지 ${LOCATION} 10층`);
  await expect(page.locator("#bl-preview")).toHaveValue(instagramCopy);
  expect(await overflowOf(page), "인스타그램 360px").toBeLessThanOrEqual(0);

  // 스레드: 해시태그 칸이 없고, 500자를 넘으면 넘은 글자 수를 알리며 막는다. 줄이면 풀린다.
  await pickPlace(page, "threads");
  await expect(page.locator("#bl-threads")).toBeVisible();
  await expect(page.locator("#bl-instagram")).toBeHidden();
  await expect(page.locator("#bl-tags")).toBeHidden();
  await expect(copy).toHaveText("스레드 글 복사");
  await expect(copy).toBeEnabled();
  await expect(page.locator("[data-bl-threads-count]")).toHaveText("31자 · 남은 자리 136자(스레드 500자에서 자동으로 붙는 글 333자를 뺀 자리)");
  await page.locator("#bl-threads").fill("가".repeat(400));
  await expect(copy).toBeDisabled();
  await expect(check).toContainText("스레드 글은 500자까지인데 지금");
  await expect(check).toContainText("자동으로 붙는 글");
  await expect(meter).toHaveClass(/bl-meter--over/u);
  await expect(page.locator("[data-bl-threads-count]")).toHaveText(/^400자 · \d+자 넘음$/u);
  await expect(page.locator("[data-bl-bar-text]")).toHaveText("고칠 곳 1곳 · 복사 막힘");
  await page.locator("#bl-threads").fill(placedResult.threads);
  await expect(copy).toBeEnabled();
  await expect(meter).not.toHaveClass(/bl-meter--over/u);
  await copy.click();
  const threadsCopy = (await copied(page)).at(-1);
  expect(threadsCopy.startsWith(`${placedResult.threads}\n\n──────────\n`), "스레드 글에는 해시태그 줄이 없음").toBe(true);
  expect(threadsCopy.includes("#")).toBe(false);
  expect([...threadsCopy].length).toBeLessThanOrEqual(500);
  expect(await overflowOf(page), "스레드 360px").toBeLessThanOrEqual(0);

  // 카카오톡: 제목과 인스타그램 글 칸(같은 칸)을 보이고, 글은 [제목] + 인스타그램 글 + 명시사항(해시태그·구분선 없음).
  await pickPlace(page, "kakao");
  await expect(page.locator("#bl-title")).toBeVisible();
  await expect(page.locator("#bl-instagram")).toHaveValue(instagramText);
  await expect(page.locator("[data-bl-instagram-label]")).toHaveText("카카오톡 글");
  await expect(page.locator("[data-bl-instagram-count]")).toContainText("여기서 고치면 인스타그램 글도 바뀝니다");
  await expect(page.locator("#bl-tags")).toBeHidden();
  await expect(page.locator("[data-bl-look-title]")).toHaveText("카카오톡으로 보낼 모습");
  await expect(copy).toHaveText("카카오톡 글 복사");
  await copy.click();
  const kakaoCopy = (await copied(page)).at(-1);
  expect(kakaoCopy.startsWith(`[가상숲1단지 매매 4억 5,000만원]\n${instagramText}\n\n[중개사무소] `)).toBe(true);
  expect(kakaoCopy).toContain(`[매물] 소재지 ${LOCATION} 10층`);
  expect(kakaoCopy.includes("#"), "카카오톡 글에는 해시태그가 없음").toBe(false);
  expect(kakaoCopy.includes("──────────"), "카카오톡 글에는 구분선이 없음").toBe(false);
  expect(await overflowOf(page), "카카오톡 360px").toBeLessThanOrEqual(0);

  // '올리는 순서' 상자: 980px 이상에서 인스타그램·스레드·카카오톡은 글 칸 아래(왼쪽), 블로그는 오른쪽 고정 칸. 좁히면 오른쪽 칸 순서로 돌아온다.
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator(".bl-result__main > [data-bl-do]")).toHaveCount(1);
  await pickPlace(page, "blog");
  await expect(page.locator(".bl-result__side > [data-bl-do]")).toHaveCount(1);
  await expect(page.locator(".bl-result__side .work-primary-button")).toHaveText(["블로그 글 복사"]);
  await pickPlace(page, "threads");
  await expect(page.locator(".bl-result__main > [data-bl-do]")).toHaveCount(1);
  await page.setViewportSize({ width: 360, height: 900 });
  await expect(page.locator(".bl-result__side > [data-bl-look] + [data-bl-do]")).toHaveCount(1);

  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
  expect(stored.includes("가상숲"), "글은 브라우저 저장소·주소에 없음").toBe(false);
  expect(calls.requests.some((line) => line.includes("가상동")), "소재지는 어떤 요청에도 없음").toBe(false);
  assertNoErrors();
});

// 2026-11-25 글 성격 21가지(묶음 넷)와 현장 메모 '빠르게 넣기'. 사용자 결정 13:26:16 "마음대로 뺴지마 다 넣어"·"추천대로 해".
test("글 초안 글 성격·빠르게 넣기 360px: 묶음 넷에 21가지가 한 줄 단추로 들고, 자료에 맞지 않는 성격은 잠기며, 머리말 단추는 메모 칸에 머리말만 넣고, 메모가 빈 경험담은 알리기만 한다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const queued = draftOf(complex, { status: "queued", needsLocation: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
  const calls = await setup(page, { width: 360, create: () => queued, draftReads: { "zz-draft-1": () => queued } });
  await page.goto("/admin/work/blog/");
  const lockedOf = () => page.locator("input[name='bl-style']:disabled").evaluateAll((inputs) => inputs.map((input) => input.closest("label").textContent.trim()));

  // 매매 매물: 전세 안내·월세만 잠긴다(3단계를 열기 전에도 단추는 그려져 있다).
  await page.getByRole("button", { name: "가상숲1단지 고르기" }).click();
  await expect(page.locator("input[name='bl-style']")).toHaveCount(21);
  expect(await lockedOf()).toEqual(["전세 안내", "월세"]);
  await expect(page.locator("[data-bl-quick] button")).toHaveText(["역·교통", "학교", "상권", "수리·상태", "전망·채광"]);

  // 단지 소개 글: 거래 조건 성격 넷이 잠기고 머리말은 단지에 맞는 넷.
  await page.locator("[data-bl-change='1']").click();
  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(step(page, 3)).toHaveClass(/bl-step--open/u);
  const groups = step(page, 3).getByRole("radiogroup", { name: "글 성격" }).getByRole("group");
  await expect(groups).toHaveCount(4);
  for (const [index, name, count] of [[0, "기본·거래 조건", 8], [1, "누구에게 권할지", 5], [2, "무엇을 앞에 둘지", 5], [3, "글 짜임", 3]]) {
    await expect(groups.nth(index), name).toHaveAccessibleName(name);
    await expect(groups.nth(index).locator("input[name='bl-style']"), name).toHaveCount(count);
  }
  expect(await lockedOf()).toEqual(["급매", "전세 안내", "월세", "수익형"]);
  await expect(page.locator("input[name='bl-style']:checked")).toHaveValue("plain");
  await expect(page.locator("[data-bl-style-note]")).toContainText("급매·전세 안내·월세·수익형은 단지 소개 글이라 잠겼습니다.");
  await expect(page.locator("[data-bl-quick] button")).toHaveText(["역·교통", "학교", "상권", "단지 시설"]);
  await expect(page.locator("[data-bl-memo-note]")).toBeHidden();

  // 360·390px에서 성격 단추 글자는 모두 한 줄이고(높이 한 가지), 누르는 곳은 44px 이상, 가로 넘침이 없다.
  const sizes = () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll("[data-bl-styles] .work-choice, [data-bl-quick] button")].map((element) => element.getBoundingClientRect());
    const styleHeights = new Set([...document.querySelectorAll("[data-bl-styles] .work-choice")].map((element) => Math.round(element.getBoundingClientRect().height)));
    return { styleHeights: styleHeights.size, small: boxes.filter((box) => box.height < 44 || box.width < 44).length };
  });
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await sizes(), `${width}px 단추`).toEqual({ styleHeights: 1, small: 0 });
    expect(await overflowOf(page), `${width}px 가로 넘침`).toBeLessThanOrEqual(0);
  }

  // 머리말 단추: 메모 끝 새 줄에 "머리말: "만 넣고 그 뒤에 커서를 둔다. 같은 머리말을 또 누르면 글은 그대로다.
  const memo = page.locator("#bl-emphasis");
  await page.locator("[data-bl-quick] button", { hasText: "학교" }).click();
  await expect(memo).toHaveValue("학교: ");
  await expect(memo).toBeFocused();
  await expect(page.locator("[data-bl-emphasis-count]")).toContainText("4 / 500자");
  await page.keyboard.type("가상초등학교가 단지 옆");
  await page.locator("[data-bl-quick] button", { hasText: "상권" }).click();
  await page.keyboard.type("가상시장");
  await expect(memo).toHaveValue("학교: 가상초등학교가 단지 옆\n상권: 가상시장");
  await page.locator("[data-bl-quick] button", { hasText: "학교" }).click();
  await expect(memo).toHaveValue("학교: 가상초등학교가 단지 옆\n상권: 가상시장");
  expect(await memo.evaluate((element) => element.selectionStart), "이미 있는 머리말은 그 줄 끝으로").toBe("학교: 가상초등학교가 단지 옆".length);

  // 경험담: 그 성격의 머리말 단추가 맨 앞에 생기고, 메모가 비면 한 줄로 알리기만 한다(만들기는 막지 않음).
  await step(page, 3).locator("label:has(input[name='bl-style'][value='story'])").click();
  await expect(page.locator("[data-bl-quick] button")).toHaveText(["직접 본 것", "역·교통", "학교", "상권", "단지 시설"]);
  await expect(page.locator("[data-bl-style-note]")).toContainText("직접 본 것을 아래 칸에 적어야 글이 됩니다.");
  await expect(page.locator("[data-bl-memo-note]"), "메모가 있으면 알리지 않음").toBeHidden();
  await memo.fill("");
  await expect(page.locator("[data-bl-memo-note]")).toHaveText("'경험담' 글은 이 칸에 확인한 사실을 적어야 글이 됩니다. 비워 두면 평범한 소개 글이 됩니다(그대로 만들 수는 있습니다).");
  await expect(page.getByRole("button", { name: "글 초안 만들기" })).toBeEnabled();

  // 500자를 넘게 되는 머리말은 넣지 않고 까닭을 알린다.
  await memo.fill("가".repeat(497));
  await page.locator("[data-bl-quick] button", { hasText: "직접 본 것" }).click();
  await expect(memo).toHaveValue("가".repeat(497));
  await expect(page.locator("[data-bl-memo-note]")).toHaveText("머리말을 넣으면 500자를 넘습니다. 글을 줄인 뒤 다시 눌러 주세요.");
  await memo.fill("");
  await page.locator("[data-bl-quick] button", { hasText: "직접 본 것" }).click();
  // 머리말 단추만 누른 메모는 빈 메모다: 알림이 그대로 있고, 글을 써야 사라진다(2026-11-25).
  await expect(memo).toHaveValue("직접 본 것: ");
  await expect(page.locator("[data-bl-memo-note]")).toHaveText("'경험담' 글은 이 칸에 확인한 사실을 적어야 글이 됩니다. 비워 두면 평범한 소개 글이 됩니다(그대로 만들 수는 있습니다).");
  await page.locator("[data-bl-quick] button", { hasText: "역·교통" }).click();
  await expect(page.locator("[data-bl-memo-note]"), "머리말을 더 눌러도 빈 메모").toBeVisible();
  await memo.fill("");
  await page.locator("[data-bl-quick] button", { hasText: "직접 본 것" }).click();
  await page.keyboard.type("오후에 놀이터 쪽이 조용함");
  await expect(page.locator("[data-bl-memo-note]")).toBeHidden();
  await page.locator("[data-bl-quick] button", { hasText: "학교" }).click();
  await expect(memo).toHaveValue("직접 본 것: 오후에 놀이터 쪽이 조용함\n학교: ");

  // 만들기 요청에는 고른 성격의 id와 메모가 간다(머리말만 있는 '학교: ' 줄은 빼고 보냄). 메모는 브라우저 저장소·주소에 남지 않는다.
  await page.getByRole("button", { name: "글 초안 만들기" }).click();
  await expect(page.locator("[data-bl-wait]")).toBeVisible();
  expect(calls.creates).toEqual([{ source: { type: "complex", id: "zz-forest" }, style: "story", inputs: {}, emphasis: "직접 본 것: 오후에 놀이터 쪽이 조용함" }]);
  const stored = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));
  expect(stored.includes("놀이터"), "메모는 브라우저 저장소·주소에 없음").toBe(false);
  assertNoErrors();
});
