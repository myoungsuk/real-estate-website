// 달력(/admin/work/calendar/)을 가짜 업무 API(날개-2 API 판 2 모양)로 본다. 사용자 답 2026-11-25 23:32:21·11-26 08:59:51·09:18:41.
// 일정 제목·거래 이름·손님 이름은 모두 지어낸 값이고 실제 서버·D1은 부르지 않는다.
import { expect, test } from "@playwright/test";
import { CAL_TODAY, collectErrors, setupCalendar, uuid } from "./support/calendar-mock.mjs";

const PATH = "/admin/work/calendar/";
const overflowOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function expectNoTrace(page) {
  const url = new URL(page.url());
  expect(url.pathname + url.search + url.hash).toBe(PATH);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.title()).toBe("달력 | 행복한부동산 관리자");
}
const cell = (page, on) => page.locator(`[data-cal-day="${on}"]`);
const dayRows = (page) => page.locator("[data-cal-rows] > li");
const dialog = (page) => page.locator("[data-cal-dialog]");

test("업무 세션이 꺼져 있으면 켜지지 않았다고 알리고 달력 자료는 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const { calls } = await setupCalendar(page, { width: 360, enabled: false });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "업무 도구가 켜지지 않았습니다" })).toBeVisible();
  expect(calls.all).toEqual(["GET /session"]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("자료 구조 9번 전이면 갱신 전이라고 알린다", async ({ page }) => {
  await setupCalendar(page, { width: 390, schemaOutdated: true });
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "자료 구조 갱신 전입니다" })).toBeVisible();
  await expect(page.locator("[data-cal-state-body]")).toContainText("구조(9번)");
});

test("휴대폰: 이 달 칸은 모양 표시, 오늘 목록이 아래에 있고, 요청 값은 날짜 둘뿐이며 가로로 넘치지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const { calls } = await setupCalendar(page, { width: 360 });
  await page.goto(PATH);
  await expect(page.locator("[data-cal-month]")).toHaveText("2026년 11월");
  expect(calls.all.filter((call) => call.startsWith("GET /calendar"))).toEqual(["GET /calendar?from=2026-11-01&to=2026-12-05"]);
  await expect(page.locator("[data-cal-add]")).toBeHidden();
  await expect(cell(page, CAL_TODAY)).toHaveAttribute("aria-pressed", "true");
  await expect(cell(page, CAL_TODAY)).toHaveAttribute("aria-label", /11월 18일 수요일, 오늘, 일정 \d+개/u);
  await expect(cell(page, CAL_TODAY).locator(".cal-marks")).toBeVisible();
  await expect(cell(page, CAL_TODAY).locator(".cal-chips")).toBeHidden();
  await expect(page.locator("#cal-day-title")).toHaveText("11월 18일 수요일");
  await expect(dayRows(page).first()).toContainText("가상 등기부등본 다시 떼기");
  await expect(page.getByRole("button", { name: "11월 18일에 일정 넣기" })).toBeVisible();
  // 지난 거래 일정에는 '! 지남', 끝낸 것에는 '✓ 끝남'
  await cell(page, "2026-11-16").click();
  await expect(dayRows(page).first()).toContainText("! 지남");
  await expect(cell(page, "2026-11-16")).toHaveAttribute("aria-label", /지난 일정 1개/u);
  await cell(page, "2026-11-10").click();
  await expect(dayRows(page).first()).toContainText("✓ 끝남");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await expectNoTrace(page);
  assertNoErrors();
});

test("방향키로 날을 옮기고, 다음 달로 넘어가면 그 달을 다시 부른다", async ({ page }) => {
  const { calls } = await setupCalendar(page, { width: 1280 });
  await page.goto(PATH);
  await cell(page, CAL_TODAY).focus();
  await page.keyboard.press("ArrowRight");
  await expect(cell(page, "2026-11-19")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(cell(page, "2026-11-26")).toBeFocused();
  await expect(page.locator("#cal-day-title")).toHaveText("11월 26일 목요일");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-cal-month]")).toHaveText("2026년 12월");
  await expect(cell(page, "2026-12-03")).toBeFocused();
  expect(calls.all).toContain("GET /calendar?from=2026-11-29&to=2027-01-02");
  await page.getByRole("button", { name: "오늘" }).click();
  await expect(page.locator("[data-cal-month]")).toHaveText("2026년 11월");
  await expect(cell(page, CAL_TODAY)).toBeFocused();
});

test("PC: 넓은 칸 글자 띠·오른쪽 그날 칸, 거르기는 고른 종류만 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  await setupCalendar(page, { width: 1280 });
  await page.goto(PATH);
  await expect(cell(page, "2026-11-20").locator(".cal-chips")).toBeVisible();
  await expect(cell(page, "2026-11-20").locator(".cal-chip")).toContainText(["잔금가상숲1단지 84㎡ 매매"]);
  await expect(page.locator("[data-cal-add]")).toBeVisible();
  const side = await page.locator(".cal-side").boundingBox();
  const grid = await page.locator(".cal-grid").boundingBox();
  expect(side.x).toBeGreaterThan(grid.x + grid.width - 1);
  const filter = (key) => page.locator(`[data-cal-filter="${key}"]`);
  await expect(filter("money")).toHaveAccessibleName("돈 날짜");
  await filter("money").click();
  await expect(filter("money")).toHaveAttribute("aria-pressed", "true");
  await expect(filter("")).toHaveAttribute("aria-pressed", "false");
  await expect(dayRows(page)).toHaveCount(0);
  await expect(page.locator("[data-cal-empty]")).toBeVisible();
  await cell(page, "2026-11-20").click();
  await expect(dayRows(page)).toHaveCount(1);
  await filter("").click();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("일정 넣기: 처음 알림은 하루 종일 '전날 18:00', 시각을 넣으면 '1시간 전', 2개가 차면 나머지는 잠기고, 저장 본문에 고른 값만 간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const { calls } = await setupCalendar(page, { width: 390 });
  await page.goto(PATH);
  await cell(page, "2026-11-24").click();
  await page.getByRole("button", { name: "11월 24일에 일정 넣기" }).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("#cal-date")).toHaveValue("2026-11-24");
  await expect(page.locator("[data-cal-allday]")).toBeChecked();
  const alarm = (key) => page.locator(`[data-cal-alarm][value="${key}"]`);
  await expect(alarm("day-before-18")).toBeChecked();
  await expect(alarm("hour-before")).toBeDisabled();
  // 빈 칸으로 저장하면 칸 아래 글
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.locator('[data-cal-error="title"]')).not.toBeEmpty();
  expect(calls.writes).toEqual([]);

  await page.locator('label.cal-pick:has([data-cal-tag][value="showing"])').click();
  await expect(page.locator('[data-cal-tag][value="showing"]')).toBeChecked();
  await page.locator("#cal-title").fill("가상강변 84㎡ 집 보여 주기");
  await expect(page.locator("[data-cal-title-count]")).toHaveText("16 / 80");
  await page.locator("[data-cal-allday]").uncheck();
  // 시각을 넣기 전에는 '1시간 전'을 고를 수 없어 비워 두고, 시각을 넣으면 처음 값 '1시간 전'이 들어간다.
  await expect(alarm("hour-before")).toBeDisabled();
  await expect(alarm("day-before-18")).not.toBeChecked();
  await page.locator("#cal-start").fill("08:00");
  await expect(alarm("hour-before")).toBeChecked();
  await expect(alarm("day-before-18")).not.toBeChecked();
  await expect(alarm("same-day-09")).toBeDisabled(); // 시작보다 늦게 울리는 알림(서버 400 ["alarms"])
  await page.locator("#cal-start").fill("14:00");
  await expect(alarm("same-day-09")).toBeEnabled();
  await page.locator("#cal-end").fill("13:00");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.locator('[data-cal-error="endTime"]')).not.toBeEmpty();
  await page.locator("#cal-end").fill("15:00");
  // 2개가 차면 남은 체크칸은 잠김
  const choices = page.locator("[data-cal-alarm]:not(:checked):not(:disabled)");
  await choices.first().check();
  await expect(page.locator("[data-cal-alarm]:checked")).toHaveCount(2);
  await expect(page.locator("[data-cal-alarm]:not(:checked):not(:disabled)")).toHaveCount(0);
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("[data-cal-saved]")).toContainText("일정을 저장했습니다");
  const post = calls.writes.find((write) => write.method === "POST");
  expect(post.path).toBe("/appointments");
  expect(post.csrf).toBe("test-csrf");
  expect(post.body).toMatchObject({ tag: "showing", title: "가상강변 84㎡ 집 보여 주기", startsOn: "2026-11-24", startTime: "14:00", endTime: "15:00", repeatRule: "none" });
  expect(post.body.alarms).toHaveLength(2);
  expect(post.body.alarms).toContain("hour-before");
  await expect(dayRows(page).filter({ hasText: "가상강변 84㎡ 집 보여 주기" })).toContainText("14:00 ~ 15:00");
  for (const call of calls.all) expect(call).not.toContain("가상강변");
  await expectNoTrace(page);
  assertNoErrors();
});

test("반복 일정을 '이 날만' 고치면 scope one·그날만 보내고, 반복을 바꾸면 '이 날만'은 막힌다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const { calls } = await setupCalendar(page, { width: 1280 });
  await page.goto(PATH);
  await cell(page, "2026-11-25").click();
  await dayRows(page).filter({ hasText: "가상 사무소 임대료 이체" }).getByRole("button").click();
  await expect(page.locator("#cal-form-title")).toHaveText("일정 고치기");
  await expect(page.locator("[data-cal-repeat-summary]")).toContainText("매달 25일");
  // 반복을 바꾸면 '이 날만'은 고를 수 없음
  const repeatPick = (rule) => page.locator(`label.cal-pick:has([data-cal-repeat][value="${rule}"])`);
  await repeatPick("weekly").click();
  await page.getByRole("button", { name: "고친 것 저장" }).click();
  await expect(page.getByRole("button", { name: /^이 날만 고치기/u })).toBeDisabled();
  await page.locator("[data-cal-scope-cancel]").click();
  await repeatPick("monthly").click();
  await page.locator("#cal-title").fill("가상 사무소 임대료 이체(이번 달만 26일)");
  await page.locator("#cal-date").fill("2026-11-26");
  await page.getByRole("button", { name: "고친 것 저장" }).click();
  await page.getByRole("button", { name: /^이 날만 고치기/u }).click();
  await expect(dialog(page)).toBeHidden();
  const patch = calls.writes.find((write) => write.method === "PATCH");
  expect(patch.path).toBe(`/appointments/${uuid(2)}`);
  expect(patch.body).toMatchObject({ version: 1, scope: "one", occurrenceOn: "2026-11-25", title: "가상 사무소 임대료 이체(이번 달만 26일)", startsOn: "2026-11-26" });
  expect(patch.body).not.toHaveProperty("repeatRule");
  expect(patch.body).not.toHaveProperty("repeatUntil");
  await expect(page.locator("#cal-day-title")).toHaveText("11월 26일 목요일");
  await expect(dayRows(page).filter({ hasText: "이번 달만 26일" })).toHaveCount(1);
  await cell(page, "2026-11-25").click();
  await expect(dayRows(page).filter({ hasText: "가상 사무소 임대료 이체" })).toHaveCount(0);
  assertNoErrors();
});

test("다른 곳에서 먼저 고쳤으면(409) 저장하지 않고 '새 값 보기'로 새 값을 채운다", async ({ page }) => {
  await setupCalendar(page, { width: 1280, conflictOnce: true });
  await page.goto(PATH);
  await dayRows(page).filter({ hasText: "가상강변 59㎡ 집 보여 주기" }).getByRole("button").click();
  await page.locator("#cal-title").fill("가상강변 59㎡ 집 보여 주기(시간 바꿈)");
  await page.getByRole("button", { name: "고친 것 저장" }).click();
  await expect(page.locator("[data-cal-form-status]")).toContainText("저장하지 못했습니다");
  await page.getByRole("button", { name: "새 값 보기" }).click();
  await expect(page.locator("#cal-title")).toHaveValue("가상 다른 화면에서 고친 일정");
});

test("반복 일정을 '이 날부터 모두' 지우면 휴지통으로 옮기고, 알림 줄의 '되살리기'로 되돌린다. 반복 없는 일정은 빈 본문으로 지운다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const { calls } = await setupCalendar(page, { width: 390 });
  await page.goto(PATH);
  await cell(page, "2026-11-23").click();
  await dayRows(page).filter({ hasText: "가상 주간 매물 사진 정리" }).getByRole("button").click();
  await page.getByRole("button", { name: "이 일정 지우기" }).click();
  await expect(page.locator("[data-cal-delete-panel]")).toContainText("휴지통으로 옮깁니다");
  await page.getByRole("button", { name: /^이 날부터 모두 지우기/u }).click();
  await expect(dialog(page)).toBeHidden();
  const removed = calls.writes.find((write) => write.method === "DELETE");
  expect(removed.body).toEqual({ version: 1, scope: "following", occurrenceOn: "2026-11-23" });
  await expect(page.locator("[data-cal-saved]")).toContainText("휴지통");
  await cell(page, "2026-11-30").click();
  await expect(dayRows(page).filter({ hasText: "가상 주간 매물 사진 정리" })).toHaveCount(0);
  await page.getByRole("button", { name: "되살리기" }).click();
  await expect(page.locator("[data-cal-saved]")).toContainText("되살렸습니다");
  await expect(dayRows(page).filter({ hasText: "가상 주간 매물 사진 정리" })).toHaveCount(1);

  await cell(page, CAL_TODAY).click();
  await dayRows(page).filter({ hasText: "가상강변 59㎡ 집 보여 주기" }).getByRole("button").click();
  await page.getByRole("button", { name: "이 일정 지우기" }).click();
  await page.locator("[data-cal-delete-choices]").getByRole("button", { name: "지우기" }).click();
  await expect(dialog(page)).toBeHidden();
  expect(calls.writes.filter((write) => write.method === "DELETE").at(-1).body).toEqual({});
  assertNoErrors();
});

test("고치던 창을 Esc로 닫으려 하면 알리고 닫지 않으며, '그만두기'로 버린다. 거래 일정 줄은 손님 카드로 가는 고리다", async ({ page }) => {
  await setupCalendar(page, { width: 768 });
  await page.goto(PATH);
  await page.locator("[data-cal-day-add]").click();
  await page.locator("#cal-title").fill("가상 일정 메모");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeVisible();
  await expect(page.locator("[data-cal-form-status]")).toContainText("저장하지 않은 내용이 있습니다");
  await page.getByRole("button", { name: "그만두기" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("[data-cal-day-add]")).toBeFocused();
  await cell(page, "2026-11-20").click();
  await expect(dayRows(page).first().locator("a")).toHaveAttribute("href", `/admin/work/customers/detail/?id=${uuid(201)}`);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
});
