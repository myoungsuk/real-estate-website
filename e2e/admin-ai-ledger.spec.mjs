// 계약서 AI 결과 고르기 화면에서 '거래에 넣기'가 된 뒤 보이는 '매출장부에 보수 줄 넣기' 칸(중개날개 대조표 16절 2위, 2026-11-25)을 가짜 업무 API로 본다.
// 미리 채운 값은 화면에만 있고 '장부에 넣기'를 눌러야 POST ledger가 가는지, 이미 보수 줄이 있으면 채우지 않는지, 주택 밖 거래는 빈칸과 까닭인지 본다.
// 계약서 결과·금액은 모두 가상 값이고 실제 서버·D1·R2·OpenAI는 부르지 않는다.
import { expect, test } from "@playwright/test";
import {
  DEAL_A,
  GROUP,
  REVIEW,
  collectErrors,
  confirmed,
  envelope,
  expectNoTrace,
  expectStyledButtons,
  failure,
  ledgerEntry,
  overflowOf,
  reviewDeal,
  setup,
  shot,
  singleView,
} from "./support/ai-review-mock.mjs";

const section = (page) => page.locator("[data-axl]");
const ledgerGets = (calls) => calls.all.filter((line) => line.startsWith("GET /ledger"));
const ledgerPosts = (calls) => calls.writes.filter((item) => item.method === "POST" && item.path === "/ledger");
const groups = () => new Map([[GROUP, [singleView()]]]);

// 한 번 읽기 묶음에서 세 칸을 AI 값으로 고르고 '확인으로 넘어가기' → '거래에 넣기'까지 간다.
async function confirmReview(page) {
  await page.goto(REVIEW);
  await expect(page.locator("[data-axr-main]")).toBeVisible();
  for (const field of ["contractDate", "balanceDate", "priceWon"]) await page.locator(`[data-axr-chip='${field}:first']`).click();
  const next = page.locator("[data-axr-next]");
  await expect(next).toBeEnabled();
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
  await next.click();
  await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣었습니다");
}

for (const width of [390, 1280]) {
  test(`주택 매매(폭 ${width}px): 거래에 넣은 뒤 낸 쪽에 법정 상한·부가세가 미리 채워지고, 저절로 넣지 않으며 '장부에 넣기' 한 번에 POST ledger 한 번이다`, async ({ page }) => {
    const done = collectErrors(page);
    const calls = await setup(page, { width, ai: { groups: groups() } });
    await confirmReview(page);
    const box = section(page);
    await expect(box.locator("h2")).toHaveText("매출장부에 보수 줄 넣기");
    await expect(box.locator("[data-axl-lead]")).toHaveAttribute("data-axl-lead", "filled");
    await expect(box.locator("[data-axl-lead]")).toContainText("법정 상한 1,400,000원 + 부가세 140,000원");
    await expect(box.locator("[data-axl-lead]")).toContainText("아직 장부에 넣지 않았습니다");
    await expect(box.locator("[data-axl-side='buyer']")).toBeChecked();
    await expect(box.locator("[data-axl-side='seller']")).not.toBeChecked();
    await expect(box.locator("[data-axl-amount='buyer']")).toHaveValue("1,400,000");
    await expect(box.locator("[data-axl-vat='buyer']")).toHaveValue("140,000");
    await expect(box.locator("[data-axl-amount='seller']")).toBeHidden();
    const save = box.locator("[data-axl-save]");
    await expect(save).toHaveText("장부에 넣기 (보수 줄 1개)");
    expect((await save.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(ledgerGets(calls), "보수 줄 목록을 한 번 읽음").toEqual([`GET /ledger?basis=balance&kind=fee&dealId=${DEAL_A}&limit=50`]);
    expect(ledgerPosts(calls), "누르기 전에는 장부에 넣지 않음").toEqual([]);
    expect(await overflowOf(page), "가로 넘침").toBe(0);
    await expectStyledButtons(page.locator("[data-axr-page]"), "장부 칸");
    await box.scrollIntoViewIfNeeded();
    await shot(page, `ai-ledger-${width}-prefill.png`);
    // 폭이 바뀌어 화면을 다시 그려도 장부 목록을 다시 읽지 않는다.
    await page.setViewportSize({ width: width === 390 ? 1280 : 390, height: 900 });
    await page.setViewportSize({ width, height: 900 });
    await expect(box.locator("[data-axl-amount='buyer']")).toHaveValue("1,400,000");
    expect(ledgerGets(calls)).toHaveLength(1);
    await save.click();
    await expect(box.locator("[data-axl-status]")).toHaveText("✓ 보수 줄 1개를 장부에 넣었습니다. 보수를 받으면 매출장부에서 입금액·입금일을 적어 주세요.");
    await expect(box.locator("[data-axl-status]")).toBeFocused();
    await expect(box.locator("[data-axl-save]")).toHaveCount(0);
    await expect(box.getByRole("link", { name: "매출장부에서 보기" })).toHaveAttribute("href", "/admin/work/ledger/");
    expect(ledgerPosts(calls).map((item) => item.body)).toEqual([
      { amountWon: 1_400_000, vatWon: 140_000, receivedWon: 0, receivedOn: null, label: "가상숲1단지 84㎡ 매매", memo: "", payerRole: "buyer", kind: "fee", dealId: DEAL_A },
    ]);
    expect(calls.writes.map((item) => item.path), "쓰기는 거래에 넣기 한 번 + 장부 한 번").toEqual([`/ai/jobs/${GROUP}/confirm`, "/ledger"]);
    await shot(page, `ai-ledger-${width}-done.png`);
    await expectNoTrace(page);
    done();
  });
}

test("쌍방(390px): 매도인도 고르면 두 줄이고, 공급가액을 고치면 부가세가 10%였던 쪽만 따라 바뀐다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: groups() } });
  await confirmReview(page);
  const box = section(page);
  await box.locator("label.work-choice", { hasText: "매도인" }).click();
  await expect(box.locator("[data-axl-side='seller']")).toBeChecked();
  await expect(box.locator("[data-axl-save]")).toHaveText("장부에 넣기 (보수 줄 2개)");
  await box.locator("[data-axl-amount='seller']").fill("1,000,000");
  await expect(box.locator("[data-axl-vat='seller']")).toHaveValue("100,000");
  await box.locator("[data-axl-vat='buyer']").fill("0");
  await box.locator("[data-axl-amount='buyer']").fill("1,200,000");
  await expect(box.locator("[data-axl-vat='buyer']"), "부가세를 따로 고쳤으면 그대로").toHaveValue("0");
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-status]")).toHaveText(/^✓ 보수 줄 2개를 장부에 넣었습니다\./u);
  expect(ledgerPosts(calls).map(({ body }) => [body.payerRole, body.amountWon, body.vatWon])).toEqual([["buyer", 1_200_000, 0], ["seller", 1_000_000, 100_000]]);
  done();
});

test("이미 보수 줄이 있는 거래: 미리 채우지 않고 'n줄 있음'만 알리며 장부에 쓰지 않는다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, { width: 390, ai: { groups: groups(), ledger: { list: () => envelope({ items: [ledgerEntry(1), ledgerEntry(2, { payerRole: "seller" })], nextCursor: null, undatedCount: 0 }) } } });
  await confirmReview(page);
  const box = section(page);
  await expect(box.locator("[data-axl-existing]")).toHaveText("이 거래에는 보수 줄이 이미 2줄 있어 새로 채우지 않았습니다. 고칠 것은 손님 카드의 '장부 보기'나 매출장부에서 고쳐 주세요.");
  await expect(box.locator("[data-axl-save]")).toHaveCount(0);
  await expect(box.locator("[data-axl-amount]")).toHaveCount(0);
  expect(ledgerPosts(calls)).toEqual([]);
  await shot(page, "ai-ledger-390-existing.png");
  done();
});

test("주택 밖 거래(사무소 게시 요율 안에서 협의): 빈칸과 까닭을 보이고, 금액 없이 누르면 막고, 넣은 금액의 10%를 부가세로 채운다", async ({ page }) => {
  const done = collectErrors(page);
  const calls = await setup(page, {
    width: 390,
    ai: { groups: groups(), confirm: (body) => envelope({ ...confirmed(body), deal: { ...reviewDeal({ propertyKind: "other", title: "가상상가 매매" }), version: 3 } }) },
  });
  await confirmReview(page);
  const box = section(page);
  await expect(box.locator("[data-axl-lead]")).toHaveAttribute("data-axl-lead", "empty");
  await expect(box.locator("[data-axl-lead]")).toHaveText("보수를 미리 채우지 않았습니다. 주택이 아닌 거래는 요율 조건을 거래 자료에 두지 않아 상한을 채우지 않습니다. '중개보수 계산'에서 확인해 주세요. 금액을 직접 넣으면 장부에 넣을 수 있습니다.");
  await expect(box.locator("[data-axl-amount='buyer']")).toHaveValue("");
  await expect(box.locator("[data-axl-vat='buyer']")).toHaveValue("");
  await shot(page, "ai-ledger-390-negotiated.png");
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-status]")).toHaveText("빨간 글자가 있는 칸을 고쳐 주세요.");
  await expect(box.locator("#axl-buyer-amount-error")).toHaveText("금액을 넣어 주세요.");
  await expect(box.locator("[data-axl-amount='buyer']")).toBeFocused();
  expect(ledgerPosts(calls), "금액 없이는 보내지 않음").toEqual([]);
  await box.locator("[data-axl-amount='buyer']").fill("900000");
  await expect(box.locator("[data-axl-vat='buyer']")).toHaveValue("90,000");
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-status]")).toHaveText(/^✓ 보수 줄 1개를/u);
  expect(ledgerPosts(calls).map(({ body }) => [body.amountWon, body.vatWon, body.label])).toEqual([[900_000, 90_000, "가상상가 매매"]]);
  done();
});

test("답 없이 끊김(502): 다시 보내지 않고 목록을 다시 읽어, 들어가 있으면 '다시 누르지 않아도 됩니다'로 알린다", async ({ page }) => {
  const done = collectErrors(page);
  let reads = 0;
  const calls = await setup(page, {
    width: 390,
    ai: {
      groups: groups(),
      ledger: {
        list: () => envelope({ items: reads++ === 0 ? [] : [ledgerEntry(1)], nextCursor: null, undatedCount: 0 }),
        create: () => failure(502, "UPSTREAM_ERROR"),
      },
    },
  });
  await confirmReview(page);
  const box = section(page);
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-existing]")).toHaveText(/^답이 오지 않았지만 다시 확인해 보니 이 거래에 보수 줄이 1줄 있습니다\. 다시 누르지 않아도 됩니다\./u);
  await expect(box.locator("[data-axl-save]")).toHaveCount(0);
  expect(ledgerPosts(calls), "자동으로 다시 보내지 않음").toHaveLength(1);
  expect(ledgerGets(calls)).toHaveLength(2);
  done();
});

test("두 쪽 중 하나만 들어감: 칸을 다시 보이지 않고 빠진 쪽을 손님 카드에서 넣으라고 알린다", async ({ page }) => {
  const done = collectErrors(page);
  let creates = 0;
  const calls = await setup(page, {
    width: 390,
    ai: {
      groups: groups(),
      ledger: { create: (body) => (creates++ === 0 ? envelope({ entry: ledgerEntry(1, body), warnings: [] }, 201) : failure(400, "VALIDATION_FAILED", ["amountWon"])) },
    },
  });
  await confirmReview(page);
  const box = section(page);
  await box.locator("label.work-choice", { hasText: "매도인" }).click();
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-status]")).toHaveText(/^보수 줄 1개만 넣었습니다\. 나머지는 넣지 못했습니다\. .*'장부 보기' → '보수 줄 만들기'에서 넣어 주세요\.$/u);
  await expect(box.locator("[data-axl-save]")).toHaveCount(0);
  expect(ledgerPosts(calls)).toHaveLength(2);
  done();
});

test("두 쪽 중 둘째가 답 없이 끊김: 넣지 못했다고 단정하지 않고 장부 보기에서 확인하라고 알린다", async ({ page }) => {
  const done = collectErrors(page);
  let creates = 0;
  const calls = await setup(page, {
    width: 390,
    ai: {
      groups: groups(),
      ledger: { create: (body) => (creates++ === 0 ? envelope({ entry: ledgerEntry(1, body), warnings: [] }, 201) : failure(502, "UPSTREAM_ERROR")) },
    },
  });
  await confirmReview(page);
  const box = section(page);
  await box.locator("label.work-choice", { hasText: "매도인" }).click();
  await box.locator("[data-axl-save]").click();
  await expect(box.locator("[data-axl-status]")).toHaveText(/^보수 줄 1개는 넣었지만, 다음 줄은 답이 오지 않아 들어갔는지 확인하지 못했습니다\. .*'장부 보기'에서 확인한 뒤, 빠진 쪽만 '보수 줄 만들기'로 넣어 주세요\.$/u);
  await expect(box.locator("[data-axl-save]")).toHaveCount(0);
  expect(ledgerPosts(calls), "자동으로 다시 보내지 않음").toHaveLength(2);
  done();
});

test("장부 목록을 못 읽으면 미리 채우지 않고 '다시 확인하기'로만 다시 읽는다", async ({ page }) => {
  const done = collectErrors(page);
  let reads = 0;
  const calls = await setup(page, {
    width: 390,
    ai: { groups: groups(), ledger: { list: () => (reads++ === 0 ? failure(503, "D1_UNAVAILABLE") : envelope({ items: [], nextCursor: null, undatedCount: 0 })) } },
  });
  await confirmReview(page);
  const box = section(page);
  await expect(box.locator("[data-axl-status]")).toHaveText(/^장부 줄을 확인하지 못해 미리 채우지 않았습니다\./u);
  await expect(box.locator("[data-axl-save]")).toHaveCount(0);
  await box.locator("[data-axl-retry]").click();
  await expect(box.locator("[data-axl-save]")).toHaveText("장부에 넣기 (보수 줄 1개)");
  expect(ledgerGets(calls)).toHaveLength(2);
  expect(ledgerPosts(calls)).toEqual([]);
  done();
});
