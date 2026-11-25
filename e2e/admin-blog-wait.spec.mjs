// 글 초안 '화면을 닫아도 받기'(2026-11-25)를 가짜 업무 API로 본다. 단지 이름·글은 모두 지어낸 값이고 OpenAI는 부르지 않는다.
// - 만드는 중 문구: 화면을 닫거나 휴대폰을 꺼도 서버가 받아 둔다는 것.
// - 다시 열면 맨 위 알림: "기다리던 글이 다 만들어졌습니다 · 글 열기"(만들지 못했으면 그 까닭).
// - 브라우저에는 기다리던 초안 번호(UUID)만 남는다(글·제목·단지 이름 없음).
import { expect, test } from "@playwright/test";
import { NOW, collectErrors, complex, draftOf, overflowOf, setup, step } from "./support/blog-mock.mjs";

const KEY = "leaderscityhappy.admin.blog.waiting.v1";
const ID = "0f0e0d0c-1111-4222-8333-444455556666";
const OTHER = "0f0e0d0c-1111-4222-8333-444455557777";
const result = { title: "가상숲 단지 소개", paragraphs: ["가상숲 단지는 1,200세대입니다."], hashtags: ["천동"], snsShort: "가상숲 단지 1,200세대", factsUsed: ["세대수"] };
const queuedDraft = (extra = {}) => draftOf(complex, { id: ID, status: "queued", needsLocation: false, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...extra });
const storedOf = (page) => page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, url: location.href }));

async function makeDraft(page) {
  await page.goto("/admin/work/blog/");
  await page.locator("input[name='bl-kind'][value='complex']").check();
  await page.getByRole("button", { name: "가상숲 단지 고르기" }).click();
  await page.getByRole("button", { name: "다음: 글 성격" }).click();
  await expect(step(page, 3)).toHaveClass(/bl-step--open/u);
  await page.getByRole("button", { name: "글 초안 만들기" }).click();
  await expect(page.locator("[data-bl-wait]")).toBeVisible();
}

test("글 초안 화면 닫아도 받기 390px: 만드는 중에 '화면을 닫거나 휴대폰을 꺼도 됩니다'를 보이고 초안 번호만 기억하며, 다시 열면 맨 위에서 알리고 '글 열기'로 연 뒤에는 잊는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const queued = queuedDraft();
  const drafts = [];
  const calls = await setup(page, { drafts, create: () => queued, draftReads: { [ID]: () => drafts[0] ?? { ...queued, status: "in_progress" } } });
  await makeDraft(page);

  const note = page.locator(".bl-wait__note");
  await expect(note).toContainText("화면을 닫거나 휴대폰을 꺼도 됩니다.");
  await expect(note).toContainText("다 만든 글은 서버가 받아 '보관 중인 초안'에 넣어 둡니다.");
  await expect(note).toContainText("30분이 지나도 끝나지 않으면 만들지 못한 것으로 닫습니다.");
  await expect(page.locator("[data-bl-wait]"), "옛 문구(10분 안에 다시 열어야 함)는 없음").not.toContainText("10분");
  await expect(page.locator("[data-bl-waited]"), "지금 기다리는 초안은 알리지 않음").toBeHidden();
  expect(await overflowOf(page), "만드는 중 390px").toBeLessThanOrEqual(0);

  // 브라우저에는 초안 번호만 남는다.
  const waiting = JSON.parse(await storedOf(page));
  expect(waiting.local, "localStorage에는 기다리던 초안 번호 배열 하나뿐").toEqual({ [KEY]: JSON.stringify([ID]) });
  expect(waiting.session).toEqual({});
  expect(waiting.url.endsWith("/admin/work/blog/")).toBe(true);

  // 화면을 닫은 사이 서버(1분 예약)가 글을 받아 둔 상태로 다시 연다.
  drafts.push({ ...queued, status: "completed", result });
  await page.goto("/admin/work/blog/");
  const waited = page.locator("[data-bl-waited]");
  await expect(waited).toBeVisible();
  await expect(waited.locator(".bl-waited__item")).toHaveCount(1);
  await expect(waited.locator("strong")).toHaveText("기다리던 글이 다 만들어졌습니다");
  await expect(waited.locator("span")).toHaveText("가상숲 단지 · 오늘 15:00에 만들기 시작 · 화면을 닫은 동안 받아 두었습니다");
  await expect(waited.locator(".bl-waited__item")).toHaveAttribute("data-state", "done");
  const box = await waited.boundingBox();
  const help = await page.locator(".admin-page-help").first().boundingBox();
  expect(box.y, "알림은 '이 화면 사용법' 위").toBeLessThan(help.y);
  expect(await overflowOf(page), "다시 열기 390px").toBeLessThanOrEqual(0);
  const before = JSON.parse(await storedOf(page));
  expect(before.local, "열기 전에는 번호를 계속 기억").toEqual({ [KEY]: JSON.stringify([ID]) });
  expect(JSON.stringify(before), "글·단지 이름은 저장소·주소에 없음").not.toMatch(/가상숲|1,200세대|단지 소개/u);

  const open = waited.getByRole("button", { name: "가상숲 단지 글 열기" });
  const size = await open.boundingBox();
  expect(size.height, "누르는 곳 44px 이상").toBeGreaterThanOrEqual(44);
  await open.click();
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  await expect(page.locator("[data-bl-title]")).toHaveValue("가상숲 단지 소개");
  await expect(waited, "연 뒤에는 알림을 지움").toBeHidden();
  expect(JSON.parse(await storedOf(page)).local, "연 뒤에는 번호를 잊음").toEqual({});

  // 다시 열어도 알림이 다시 뜨지 않는다.
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-main]")).toBeVisible();
  await expect(page.locator("[data-bl-waited]")).toBeHidden();
  expect(calls.closes, "알림을 여는 것은 초안을 닫지 않음").toEqual([]);
  assertNoErrors();
});

test("글 초안 화면 닫아도 받기 360px: 만들지 못한 글은 까닭과 함께 알리고, 만드는 중·버린 초안·목록에 없는 번호는 알리지 않으며, 저장소가 망가졌거나 막혀 있어도 화면은 그대로 돈다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const failed = queuedDraft({ status: "failed", errorCode: "AI_WAIT_TIMEOUT" });
  const making = queuedDraft({ id: OTHER, status: "in_progress" });
  const drafts = [failed, making];
  await setup(page, { width: 360, drafts });
  // 앞서 이 브라우저가 두 초안을 기다렸고, 목록에 없는 번호와 번호가 아닌 글자도 섞여 있다.
  const gone = "0f0e0d0c-1111-4222-8333-444455558888";
  await page.addInitScript(([key, ids]) => {
    if (!sessionStorage.getItem("zz-seeded")) {
      localStorage.setItem(key, JSON.stringify(ids));
      sessionStorage.setItem("zz-seeded", "1");
    }
  }, [KEY, [ID, OTHER, gone, "가상숲 단지", 7]]);
  await page.goto("/admin/work/blog/");
  const waited = page.locator("[data-bl-waited]");
  await expect(waited.locator(".bl-waited__item")).toHaveCount(1);
  await expect(waited.locator(".bl-waited__item")).toHaveAttribute("data-state", "failed");
  await expect(waited.locator("strong")).toHaveText("기다리던 글을 만들지 못했습니다");
  await expect(waited.locator("span")).toHaveText("가상숲 단지 · 오늘 15:00에 만들기 시작 · 30분을 기다렸지만 글이 끝나지 않았습니다");
  expect(await overflowOf(page), "실패 알림 360px").toBeLessThanOrEqual(0);
  expect(JSON.parse(await storedOf(page)).local[KEY], "목록에 없는 번호·번호가 아닌 글자는 버리고 둘만 남김").toBe(JSON.stringify([ID, OTHER]));

  await waited.getByRole("button", { name: "가상숲 단지 까닭 보기" }).click();
  await expect(page.locator("[data-bl-fail-title]")).toHaveText("30분을 기다렸지만 글이 끝나지 않았습니다");
  await expect(page.locator("[data-bl-fail-body]")).toContainText("서버가 30분 동안 확인했지만 AI가 글을 끝내지 못해 그만 기다립니다.");
  await expect(waited).toBeHidden();
  expect(JSON.parse(await storedOf(page)).local[KEY], "아직 만드는 중인 초안만 계속 기억").toBe(JSON.stringify([OTHER]));

  // 만드는 중이던 초안을 다른 기기에서 버렸으면 알리지 않고 잊는다.
  drafts[1] = { ...making, closed: "cancelled", closedAt: NOW.toISOString() };
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-main]")).toBeVisible();
  await expect(page.locator("[data-bl-waited]")).toBeHidden();
  expect(JSON.parse(await storedOf(page)).local, "버린 초안은 잊음").toEqual({});

  // 저장소 글자가 망가졌으면 빈 것으로 본다.
  await page.evaluate((key) => localStorage.setItem(key, "{망가진 글자"), KEY);
  await page.goto("/admin/work/blog/");
  await expect(page.locator("[data-bl-main]")).toBeVisible();
  await expect(page.locator("[data-bl-waited]")).toBeHidden();
  assertNoErrors();
});

test("글 초안 화면 닫아도 받기: 브라우저 저장소를 쓸 수 없어도 만들기·기다리기·결과 보기가 그대로 되고 콘솔 오류가 없다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const queued = queuedDraft();
  await page.addInitScript(() => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    Object.defineProperty(window, "localStorage", { configurable: true, get: blocked });
  });
  const calls = await setup(page, { create: () => queued, draftReads: { [ID]: (n) => (n === 1 ? { ...queued, status: "in_progress" } : { ...queued, status: "completed", result }) } });
  await makeDraft(page);
  await expect(page.locator(".bl-wait__note")).toContainText("화면을 닫거나 휴대폰을 꺼도 됩니다.");
  await page.clock.runFor(5_000);
  await expect.poll(() => calls.reads[ID]).toBe(1);
  await page.clock.runFor(5_000);
  await expect(page.locator("[data-bl-result]")).toBeVisible();
  await expect(page.locator("[data-bl-waited]")).toBeHidden();
  assertNoErrors();
});
