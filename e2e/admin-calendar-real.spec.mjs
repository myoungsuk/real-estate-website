// 달력(/admin/work/calendar/)을 가짜 API가 아니라 진짜 업무 API(메모리 DB)에 이어 본다(대장 지시 2026-11-26 판 2).
// 만들기 → 달력에 보임 → DB에 줄 → 다시 열어도 보임, 반복 '이 날만' 지우기, 1년 넘게 지난 날짜 막기(화면·서버 둘 다).
// 일정 제목은 모두 지어낸 값이다.
import { expect, test } from "@playwright/test";
import { APPOINTMENT_DATE_EXPIRED_MESSAGE } from "../src/lib/work/appointment-rules.mjs";
import { CAL_NOW, collectErrors } from "./support/calendar-mock.mjs";
import { setupRealWorkApi } from "./support/real-work-api.mjs";

const PATH = "/admin/work/calendar/";
const cell = (page, on) => page.locator(`[data-cal-day="${on}"]`);
const dayRows = (page) => page.locator("[data-cal-rows] > li");
const dialog = (page) => page.locator("[data-cal-dialog]");
const DAY = 24 * 60 * 60 * 1000;

async function openNew(page, on) {
  await cell(page, on).click();
  await page.getByRole("button", { name: `${Number(on.slice(5, 7))}월 ${Number(on.slice(8, 10))}일에 일정 넣기` }).click();
  await expect(dialog(page)).toBeVisible();
  await page.locator('label.cal-pick:has([data-cal-tag][value="consult"])').click();
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: CAL_NOW });
  await page.setViewportSize({ width: 390, height: 900 });
});

test("진짜 업무 API: 넣은 일정이 달력에 보이고 DB에 남아 다시 열어도 보이며, 반복 일정을 '이 날만' 지우면 그날만 빠진다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  const api = await setupRealWorkApi(page, { now: CAL_NOW });
  await page.goto(PATH);
  await openNew(page, "2026-11-24");
  await page.locator("#cal-title").fill("가상 상담 한 번");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("[data-cal-saved]")).toContainText("일정을 저장했습니다");
  await expect(dayRows(page).filter({ hasText: "가상 상담 한 번" })).toHaveCount(1);
  expect(api.rows("SELECT tag, title, starts_on, repeat_rule FROM appointments")).toEqual([{ tag: "consult", title: "가상 상담 한 번", starts_on: "2026-11-24", repeat_rule: "none" }]);

  // 매주 반복 하나 더 넣고, 화면을 새로 열어도 둘 다 서버에서 다시 온다.
  await openNew(page, "2026-11-19");
  await page.locator("#cal-title").fill("가상 매주 상담");
  await page.locator('label.cal-pick:has([data-cal-repeat][value="weekly"])').click();
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(dialog(page)).toBeHidden();
  await page.reload();
  await cell(page, "2026-11-24").click();
  await expect(dayRows(page).filter({ hasText: "가상 상담 한 번" })).toHaveCount(1);
  await cell(page, "2026-11-26").click();
  await expect(dayRows(page).filter({ hasText: "가상 매주 상담" })).toHaveCount(1);

  // 11-26만 지우면 그날만 빠지고 다음 주(12-03)는 남는다.
  await dayRows(page).filter({ hasText: "가상 매주 상담" }).getByRole("button").click();
  await page.getByRole("button", { name: "이 일정 지우기" }).click();
  await page.getByRole("button", { name: /^이 날만 지우기/u }).click();
  await expect(dialog(page)).toBeHidden();
  await expect(page.locator("[data-cal-saved]")).toContainText("휴지통");
  await expect(dayRows(page).filter({ hasText: "가상 매주 상담" })).toHaveCount(0);
  await cell(page, "2026-11-19").click();
  await expect(dayRows(page).filter({ hasText: "가상 매주 상담" })).toHaveCount(1);
  expect(api.rows("SELECT skip_dates FROM appointments WHERE repeat_rule = 'weekly'")).toEqual([{ skip_dates: '["2026-11-26"]' }]);
  for (const call of api.calls) expect(call).not.toContain("가상");
  assertNoErrors();
});

test("1년 넘게 지난 날짜: 화면이 저장 전에 막고, 화면 시계와 서버가 하루 어긋나 서버가 막아도 같은 글을 날짜 칸 아래에 보인다", async ({ page }) => {
  const assertNoErrors = collectErrors(page, expect);
  // 휴대폰 시계(브라우저)는 한국 2026-11-18(기준일 2025-11-18), 서버는 하루 앞선 2026-11-19(기준일 2025-11-19)로 어긋나게 둔다.
  const api = await setupRealWorkApi(page, { now: new Date(CAL_NOW.getTime() + DAY) });
  // 키가 작은 휴대폰: 날짜 칸이 창 아래 끝에 걸려도 칸 아래 글이 잘리지 않아야 한다.
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto(PATH);
  await openNew(page, "2026-11-24");
  await page.locator("#cal-title").fill("가상 옛 상담");
  await page.locator("#cal-date").fill("2025-11-18");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.locator('[data-cal-error="startsOn"]')).toHaveText(APPOINTMENT_DATE_EXPIRED_MESSAGE);
  await expect(page.locator("#cal-date")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#cal-date")).toBeFocused();
  await expect(page.locator('[data-cal-error="startsOn"]')).toBeInViewport({ ratio: 0.9 }); // 소수점 픽셀 차이만 허용
  expect(api.calls.filter((call) => call.startsWith("POST"))).toEqual([]);

  // 하루 뒤 날짜는 화면 판정으로는 통과하지만, 서버가 400으로 막는다.
  await page.locator("#cal-date").fill("2025-11-19");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(page.locator("[data-cal-form-status]")).toContainText(`저장하지 못했습니다. ${APPOINTMENT_DATE_EXPIRED_MESSAGE}`);
  await expect(page.locator('[data-cal-error="startsOn"]')).toHaveText(APPOINTMENT_DATE_EXPIRED_MESSAGE);
  await expect(dialog(page)).toBeVisible();
  expect(api.calls.filter((call) => call.startsWith("POST"))).toEqual(["POST /appointments"]);
  expect(api.rows("SELECT COUNT(*) AS n FROM appointments")).toEqual([{ n: 0 }]);

  // 날짜를 고치면 저장된다.
  await page.locator("#cal-date").fill("2026-11-24");
  await page.getByRole("button", { name: "일정 저장" }).click();
  await expect(dialog(page)).toBeHidden();
  expect(api.rows("SELECT starts_on FROM appointments")).toEqual([{ starts_on: "2026-11-24" }]);
  assertNoErrors();
});
