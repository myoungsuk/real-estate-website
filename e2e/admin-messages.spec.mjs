// 안내 문자 화면(/admin/work/messages/)의 '특약 메모' 칸 포커스 자리를 본다. 서버를 부르지 않는 화면이라 관리 API는 모두 끊어 둔다.
// 날개-2 포커스 가림 시험(TU-23): 1024px에서 Tab으로 간 메모 칸의 아래 36px이 화면 밖에 남았다(Chromium은 32px 넘게 보이면 스크롤하지 않음).
import { expect, test } from "@playwright/test";

const PAGE = "/admin/work/messages/";

function collectErrors(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !/Failed to load resource/u.test(message.text())) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => expect(errors, "브라우저 콘솔 오류가 없어야 합니다").toEqual([]);
}

async function setup(page, width) {
  const apiCalls = [];
  await page.setViewportSize({ width, height: 768 });
  // 부드러운 스크롤(global.css)이 끝나기 전 자리를 재지 않게, 움직임 줄이기 설정으로 스크롤을 바로 끝낸다(로직은 같음)
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/**", (route) => {
    apiCalls.push(route.request().url());
    return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "TEST_OFFLINE" } }) });
  });
  await page.goto(PAGE);
  return apiCalls;
}

// 메모 칸 위쪽만 visible 픽셀 보이게(아래는 화면 밖) 문서를 스크롤하고, 그때의 칸 자리를 돌려준다.
async function cutMemoBottom(page, visible) {
  return page.locator("#message-memo").evaluate((memo, shown) => {
    const box = memo.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + box.top - (window.innerHeight - shown), behavior: "instant" });
    const after = memo.getBoundingClientRect();
    return { top: after.top, bottom: after.bottom, height: after.height, viewport: window.innerHeight, scrollY: window.scrollY };
  }, visible);
}

for (const width of [1024, 1280]) {
  test(`안내 문자 ${width}px 특약 메모: Tab으로 오면 칸 전체가 화면 안으로 오고, 마우스로 누르면 화면을 움직이지 않는다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const apiCalls = await setup(page, width);
    const memo = page.locator("#message-memo");
    const preview = page.locator("#message-preview");

    // 키보드: 다음 칸(미리보기)에서 Shift+Tab으로 메모 칸에 온다(날짜 칸에서 Tab은 날짜 안 연·월·일을 먼저 돈다)
    // 미리보기 칸은 포커스를 받으면 스스로 화면 안으로 오므로(F6-2), 먼저 포커스를 준 뒤 메모 칸 자리를 잡는다
    await preview.evaluate((element) => element.focus({ preventScroll: true }));
    const before = await cutMemoBottom(page, 63);
    expect(before.bottom - before.viewport, "시험 준비: 칸 아래 36px쯤이 화면 밖").toBeGreaterThan(30);
    expect(before.top, "시험 준비: 칸 위는 화면 안").toBeLessThan(before.viewport);
    await page.keyboard.press("Shift+Tab");
    await expect(memo).toBeFocused();
    await expect.poll(() => memo.evaluate((element) => element.getBoundingClientRect().bottom <= window.innerHeight + 0.5), { message: "칸 아래가 화면 안" }).toBe(true);
    expect(await memo.evaluate((element) => element.getBoundingClientRect().top), "칸 위도 화면 안").toBeGreaterThanOrEqual(0);

    // 마우스: 보이는 위쪽을 눌러도 화면은 그대로(누르는 사이 칸이 움직이면 글자가 잘못 골라짐)
    await memo.fill("가상 특약 메모 첫 줄입니다. 둘째 문장도 이어서 씁니다.");
    await preview.evaluate((element) => element.focus({ preventScroll: true }));
    const cut = await cutMemoBottom(page, 63);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const startY = await page.evaluate(() => window.scrollY);
    expect(startY, "시험 준비: 자리 잡은 뒤 움직이지 않음").toBe(cut.scrollY);
    await page.mouse.click((await memo.boundingBox()).x + 40, cut.top + 14);
    await expect(memo).toBeFocused();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.evaluate(() => window.scrollY), "마우스로 누르면 스크롤하지 않음").toBe(startY);
    expect(await memo.evaluate((element) => element.selectionStart === element.selectionEnd), "글자가 골라지지 않음").toBe(true);

    expect(apiCalls, "서버 요청 없음").toEqual([]);
    assertNoErrors();
  });
}
