// 관리자 '사용 안내' 단계 그림을 찍는다(사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄"). 평소 e2e(`npm run test:e2e`)에서는 돌지 않고
// `npm run help:shots`(scripts/help-shots.mjs → playwright.help-shots.config.mjs)로만 돈다.
// 화면은 e2e와 같은 가짜 업무 API(e2e/support/*)로 열고, 계약서 사진은 이 파일이 그리는 가상 계약서다(사람·주소·번호 모두 지어냄,
// 주민등록번호는 뒤 첫 자리가 0인 실제로 없는 꼴). 실제 서버·손님 자료는 쓰지 않는다.
// 칸 이름과 번호 개수는 src/lib/admin-help-figures.mjs와 같아야 하고, 다르면 찍기가 실패한다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN_HELP_FIGURES } from "../../src/lib/admin-help-figures.mjs";
import * as contract from "../support/contract-copy-mock.mjs";
import * as ledger from "../support/ledger-mock.mjs";
import * as calendar from "../support/calendar-feed-mock.mjs";
import * as ai from "../support/ai-review-mock.mjs";
import * as blog from "../support/blog-mock.mjs";
import * as rp from "../support/realprice-mock.mjs";
import * as lp from "../support/listing-paper-mock.mjs";
import * as content from "../support/admin-content-mock.mjs";
import { listBlogSources } from "../../src/lib/work/blog-sources.mjs";
import { BANK_LISTING_EXPECTED_HEADERS } from "../../src/lib/admin/bank-listing-import.mjs";
import { contractSumWarning, validateContractResult } from "../../src/lib/work/contract-extract.mjs";

const OUT = process.env.HELP_SHOTS_OUT;
const FRAMES = new Map(Object.values(ADMIN_HELP_FIGURES).flatMap((figure) => [...figure.phone, ...figure.wide].map((frame) => [frame.shot, frame])));
const DEVICES = [["phone", 390], ["wide", 1280]];

test.use({ deviceScaleFactor: 2 });
test.skip(!OUT, "HELP_SHOTS_OUT이 없으면 찍지 않음(npm run help:shots로 실행)");

// 문서 좌표(화면을 내린 만큼 더한 값)로 센다. 칸이 화면보다 길어 일부가 화면 위로 나가도 잘리지 않게(2026-11-24).
const scrollOf = (page) => page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
async function pageBox(page, locator) {
  const box = await locator.first().boundingBox();
  if (!box) return null;
  const scroll = await scrollOf(page);
  return { x: box.x + scroll.x, y: box.y + scroll.y, width: box.width, height: box.height };
}
async function unionBox(page, locators, pad) {
  for (const locator of locators) await locator.first().scrollIntoViewIfNeeded();
  const boxes = [];
  for (const locator of locators) {
    const box = await pageBox(page, locator);
    if (!box) throw new Error("잘라 찍을 칸이 보이지 않음");
    boxes.push(box);
  }
  const width = page.viewportSize().width;
  const x = Math.max(0, Math.min(...boxes.map((box) => box.x)) - pad);
  const y = Math.max(0, Math.min(...boxes.map((box) => box.y)) - pad);
  const right = Math.min(width, Math.max(...boxes.map((box) => box.x + box.width)) + pad);
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + pad;
  return { x, y, width: right - x, height: bottom - y };
}

// clip: 합쳐 찍을 칸들(없으면 지금 보이는 화면 전체). targets: 번호 자리(차례대로 pins와 짝). { text: 로케이터 }는 칸 전체가 아니라 글자 자리만 가리킨다.
async function snap(page, shot, { clip = null, targets, pad = 12, fullWidth = false }) {
  const frame = FRAMES.get(shot);
  expect(frame, `${shot}: src/lib/admin-help-figures.mjs에 있는 칸`).toBeTruthy();
  expect(targets.length, `${shot}: 번호 개수 = pins 개수`).toBe(frame.pins.length);
  let area;
  if (clip) {
    area = await unionBox(page, clip, pad);
    if (fullWidth) Object.assign(area, { x: 0, width: page.viewportSize().width });
  } else {
    const scroll = await scrollOf(page);
    area = { x: scroll.x, y: scroll.y, ...page.viewportSize() };
  }
  // 입력칸 포커스 테두리·고른 글자가 그림에 남지 않게 포커스를 뺀다.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(150);
  const marks = [];
  for (const target of targets) {
    const box = target.text
      ? await target.text.first().evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height }; })
      : await pageBox(page, target);
    if (!box) throw new Error(`${shot}: 번호 ${marks.length + 1} 자리가 보이지 않음`);
    marks.push([box.x - area.x, box.y - area.y, box.x + box.width - area.x, box.y + box.height - area.y].map((value, index) => Math.round(Math.min(1, Math.max(0, value / (index % 2 ? area.height : area.width))) * 10_000) / 10_000));
  }
  // 화면 아래 탭 막대처럼 고정된 것이 잘라 찍는 그림 가운데에 끼지 않게 잠깐 숨긴다(열린 창 안은 그대로).
  if (clip) await page.evaluate(() => { for (const node of document.querySelectorAll("body *")) if (getComputedStyle(node).position === "fixed" && !node.closest("dialog[open]")) node.dataset.helpShotHidden = node.style.visibility || "-", node.style.visibility = "hidden"; });
  // 잘라 찍기는 문서 좌표(fullPage)로, 화면 전체 찍기는 지금 보이는 화면 그대로(고정된 아래 막대가 제자리에 남게) 찍는다.
  const png = clip
    ? await page.screenshot({ clip: { x: area.x, y: area.y, width: area.width, height: area.height }, fullPage: true, animations: "disabled", caret: "hide" })
    : await page.screenshot({ animations: "disabled", caret: "hide" });
  if (clip) await page.evaluate(() => { for (const node of document.querySelectorAll("[data-help-shot-hidden]")) node.style.visibility = node.dataset.helpShotHidden === "-" ? "" : node.dataset.helpShotHidden, delete node.dataset.helpShotHidden; });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${shot}.png`), png);
  writeFileSync(path.join(OUT, `${shot}.json`), `${JSON.stringify({ shot, marks }, null, 2)}\n`);
}

// 가상 계약서 아랫부분(당사자 칸)을 휴대폰으로 찍은 사진처럼 만든다. 주민등록번호 칸 자리를 사진에 대한 비율로 함께 돌려준다.
const CONTRACT_HTML = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;color:#111;font:20px/1.5 "Malgun Gothic","Noto Sans KR",sans-serif}
.doc{width:680px;padding:28px 30px}
h1{font-size:26px;text-align:center;margin:0 0 14px;letter-spacing:2px}
p{margin:0 0 14px;font-size:17px}
table{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:17px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{width:110px;background:#f2f2f2;font-weight:600}
</style><div class="doc"><h1>부동산(아파트) 매매 계약서</h1>
<p>본 계약을 증명하기 위하여 계약 당사자가 이의 없음을 확인하고 각각 서명·날인한다. 2026년 11월 20일</p>
<table><tr><th>매도인 주소</th><td colspan="3">대전광역시 가상구 연습로 12, 101동 1001호</td></tr>
<tr><th>주민등록번호</th><td class="rrn">900101-0000000</td><th>성명</th><td>가상 매도인 (인)</td></tr></table>
<table><tr><th>매수인 주소</th><td colspan="3">대전광역시 가상구 시험길 34, 202동 2002호</td></tr>
<tr><th>주민등록번호</th><td class="rrn">920202-0000000</td><th>성명</th><td>가상 매수인 (인)</td></tr></table>
<table><tr><th>개업공인중개사</th><td colspan="3">가상 공인중개사사무소 · 대표 가상 중개사 (인)</td></tr></table></div>`;

async function contractPhoto(context) {
  const photo = await context.newPage();
  await photo.setViewportSize({ width: 740, height: 600 });
  await photo.setContent(CONTRACT_HTML);
  await photo.evaluate(() => document.fonts.ready);
  const area = await photo.evaluate(() => { const box = document.querySelector(".doc").getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) }; });
  const rrn = await photo.evaluate(({ width, height }) => [...document.querySelectorAll(".rrn")].map((cell) => {
    const range = document.createRange();
    range.selectNodeContents(cell);
    const box = range.getBoundingClientRect();
    return [box.left / width, box.top / height, box.right / width, box.bottom / height];
  }), area);
  const buffer = await photo.screenshot({ type: "jpeg", quality: 90, clip: area });
  await photo.close();
  return { buffer, rrn };
}

for (const [device, width] of DEVICES) {
  test(`그림 찍기: 계약서 사본 ${device}`, async ({ page }) => {
    const { DEAL_A, blockOf, maskOf, dragOn, pickWith, makeStore, openDetail, setup } = contract;
    await setup(page, { width, store: makeStore({ copiesA: 1 }) });
    await openDetail(page);
    const block = blockOf(page, DEAL_A);
    await block.toggle.click();
    await expect(block.panel).toBeVisible();
    const pickName = device === "phone" ? "계약서 찍기" : "사진첩에서 고르기";
    await snap(page, `contract-${device}-1-panel`, { clip: [block.toggle, block.panel], targets: [block.toggle, block.panel.getByRole("button", { name: pickName })] });

    // 휴대폰 칠하기 창은 사진과 아래 단추 사이가 비므로, 키가 작은 휴대폰(390×700)으로 찍어 빈 곳을 줄인다.
    if (device === "phone") await page.setViewportSize({ width, height: 700 });
    const { buffer, rrn } = await contractPhoto(page.context());
    await pickWith(page, block.panel.getByRole("button", { name: "사진첩에서 고르기" }), [{ name: "contract.jpg", mimeType: "image/jpeg", buffer }]);
    const mask = maskOf(page);
    await expect(mask.canvas).toBeVisible();
    await page.waitForTimeout(300);
    const canvasBox = await mask.canvas.boundingBox();
    const [left, top, right, bottom] = rrn[0];
    await page.evaluate(([x, y, w, h]) => {
      const marker = document.createElement("div");
      marker.dataset.helpShotRrn = "";
      Object.assign(marker.style, { position: "fixed", left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, pointerEvents: "none" });
      document.querySelector("[data-kc-mask]").append(marker);
    }, [canvasBox.x + left * canvasBox.width, canvasBox.y + top * canvasBox.height, (right - left) * canvasBox.width, (bottom - top) * canvasBox.height]);
    for (const [x1, y1, x2, y2] of rrn) await dragOn(page, mask.canvas, [x1 - 0.012, y1 - 0.02], [x2 + 0.012, y2 + 0.02]);
    await expect(mask.count).toHaveText(`${rrn.length}곳 가림`);
    const confirm = mask.button("다 가렸음, 확대해서 확인");
    await snap(page, `contract-${device}-2-mask`, { clip: [mask.canvas, mask.count, confirm], fullWidth: device === "phone", targets: [page.locator("[data-help-shot-rrn]"), { text: mask.count }, confirm] });
    await page.locator("[data-help-shot-rrn]").evaluate((node) => node.remove());

    await confirm.click();
    await expect(mask.title).toHaveText("가린 자리 확인");
    await page.waitForTimeout(300);
    const upload = mask.button("주민번호 가림 확인, 올리기");
    await snap(page, `contract-${device}-3-zoom`, { clip: [mask.zoom, upload], fullWidth: device === "phone", targets: [mask.zoom, upload] });

    await upload.click();
    await expect(mask.dialog).toBeHidden();
    await expect(block.rows).toHaveCount(2);
    await snap(page, `contract-${device}-4-done`, { clip: [block.toggle, block.panel], targets: [{ text: block.rows.first().locator(":scope > span").first() }] });
  });
}

test("그림 찍기: 매출장부 wide", async ({ page }) => {
  const { setup, gridCell, gridInput, gridRow, gridState, noteOf } = ledger;
  await setup(page, { width: 1280 });
  await page.goto("/admin/work/ledger/");
  const amount = gridCell(page, 2, "amountWon");
  await expect(amount).toBeVisible();
  const undo = page.locator("[data-lg-undo]:visible");
  await amount.click();
  await gridInput(page, 2, "amountWon").fill("2000000");
  await gridInput(page, 2, "amountWon").press("Enter");
  await expect(gridState(page, 2)).toHaveText("저장함");
  await expect(undo).toBeEnabled();
  await snap(page, "ledger-wide-1-saved", { clip: [page.locator(".lg-table thead"), gridRow(page, 4), noteOf(page, 2), undo], fullWidth: true, targets: [amount, gridState(page, 2), undo] });
});

test("그림 찍기: 매출장부 phone", async ({ page }) => {
  await ledger.setup(page, { width: 390 });
  await page.goto("/admin/work/ledger/");
  const edit = page.getByRole("button", { name: "가상숲1단지 84㎡ 매매 보수 장부 줄 고치기" }).nth(1);
  await expect(edit).toBeVisible();
  await snap(page, "ledger-phone-1-card", { clip: [edit.locator("xpath=ancestor::li[1]")], targets: [edit] });
  await edit.click();
  await expect(page.locator("[data-lg-form-title]")).toHaveText("장부 줄 고치기");
  await page.locator("#lg-received").fill("1,980,000");
  await page.locator("#lg-received-on").fill("2026-11-21");
  const save = page.getByRole("button", { name: "장부 줄 저장" });
  await snap(page, "ledger-phone-2-form", { clip: [page.locator("label[for=\"lg-received\"]"), save], pad: 16, fullWidth: true, targets: [page.locator("#lg-received"), save] });
});

for (const [device, width] of DEVICES) {
  test(`그림 찍기: 휴대폰 캘린더 구독 ${device}`, async ({ page }) => {
    await calendar.setup(page, { width });
    await page.goto(calendar.PAGE);
    const panel = page.locator("[data-cf-panel]");
    const make = panel.getByRole("button", { name: "구독 주소 만들기" });
    await expect(make).toBeVisible();
    await snap(page, `calendar-${device}-1-empty`, { clip: [panel], targets: [make] });
    await make.click();
    await expect(panel.getByLabel("구독 주소", { exact: true })).toHaveValue(calendar.SUBSCRIBE);
    // 가짜 주소지만 그림에서는 흐리게 둔다(안내 그림의 주소를 따라 치지 않게).
    await page.addStyleTag({ content: "[data-cf-url]{filter:blur(5px)}" });
    const qrIos = panel.getByRole("button", { name: "iPhone용 QR 보기" });
    const targets = device === "phone"
      ? [panel.getByRole("link", { name: "iPhone 캘린더에 넣기" }), panel.getByRole("link", { name: "Google 캘린더에 넣기" }), qrIos]
      : [qrIos];
    await snap(page, `calendar-${device}-2-made`, { clip: [panel.locator("label[for=\"cf-url\"]"), panel.getByRole("button", { name: "Android용 QR 보기" })], pad: 16, fullWidth: device === "phone", targets });
    await qrIos.click();
    const canvas = panel.locator("canvas:visible");
    await expect(canvas).toBeVisible();
    await snap(page, `calendar-${device}-3-qr`, { clip: [panel.locator("#cf-qr-box")], pad: 16, fullWidth: device === "phone", targets: [canvas] });
  });
}

// ── 2026-11-24 14:13:32 사용자 "AI 관련 기능이나 어려워 보이는거만 해 그럼"으로 더한 그림 ──

// 계약서 AI가 읽은 가상 매매 계약서(주민등록번호는 이미 검게 가린 사본처럼). 근거 상자를 그릴 글자 자리를 사진에 대한 비율로 돌려준다.
const AI_CONTRACT_HTML = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;color:#111;font:20px/1.5 "Malgun Gothic","Noto Sans KR",sans-serif}
.doc{width:680px;padding:28px 30px}
h1{font-size:26px;text-align:center;margin:0 0 14px;letter-spacing:2px}
p{margin:0 0 10px;font-size:17px}
table{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:17px}
th,td{border:1px solid #333;padding:6px 8px;text-align:left}
th{width:110px;background:#f2f2f2;font-weight:600}
.rrn{background:#111;color:#111}
</style><div class="doc"><h1>부동산(아파트) 매매 계약서</h1>
<table><tr><th>소재지</th><td>대전광역시 가상구 연습로 12, 가상숲1단지</td></tr>
<tr><th>매매대금</th><td><span data-box="price">금 사억팔천오백만원정(₩485,000,000)</span></td></tr>
<tr><th>계약금</th><td>금 삼천오백만원정은 계약 시 지불한다.</td></tr>
<tr><th>잔금</th><td>금 삼억일천오백만원정은 <span data-box="balance">2026년 12월 30일</span>에 지불한다.</td></tr></table>
<p>계약일: <span data-box="date">2026년 11월 2일</span></p>
<table><tr><th>매도인</th><td>가상 매도인 (인)</td><th>주민등록번호</th><td class="rrn">000000-0000000</td></tr>
<tr><th>매수인</th><td>가상 매수인 (인)</td><th>주민등록번호</th><td class="rrn">000000-0000000</td></tr></table></div>`;

async function aiContractPhoto(context) {
  const photo = await context.newPage();
  await photo.setViewportSize({ width: 740, height: 600 });
  await photo.setContent(AI_CONTRACT_HTML);
  await photo.evaluate(() => document.fonts.ready);
  const area = await photo.evaluate(() => { const box = document.querySelector(".doc").getBoundingClientRect(); return { x: 0, y: 0, width: Math.ceil(box.width), height: Math.ceil(box.height) }; });
  const boxes = await photo.evaluate(({ width, height }) => Object.fromEntries([...document.querySelectorAll("[data-box]")].map((node) => {
    const box = node.getBoundingClientRect();
    return [node.dataset.box, [box.left / width, box.top / height, box.right / width, box.bottom / height].map((value) => Math.round(value * 1000) / 1000)];
  })), area);
  const buffer = await photo.screenshot({ type: "jpeg", quality: 90, clip: area });
  await photo.close();
  return { buffer, boxes };
}

// AI가 한 번 읽은 결과(가상 값). 계약금 3,500만 + 잔금 3억 1,500만 ≠ 매매대금 4억 8,500만이라 서버 재검사가 '금액 확인' 경고를 맨 앞에 둔다(2026-11-24 PR #153).
function aiReady(boxes) {
  const value = ai.result({ price: 485_000_000 });
  value.contract_date.evidence = { page: 1, quote: "계약일: 2026년 11월 2일", box: boxes.date };
  value.price_won.evidence = { page: 1, quote: "금 사억팔천오백만원정(₩485,000,000)", box: boxes.price };
  value.balance.date.evidence = { page: 1, quote: "2026년 12월 30일에 지불한다", box: boxes.balance };
  value.balance.amount.evidence = { page: 1, quote: "금 삼억일천오백만원정", box: null };
  value.property_text = { value: "대전광역시 가상구 연습로 12, 가상숲1단지", evidence: { page: 1, quote: "소재지", box: null } };
  value.warnings = [contractSumWarning(validateContractResult({ ...value, warnings: [] }).result)];
  return ai.singleView({ jobs: [ai.job(1, { model: "gpt-6.2-sol", value })] });
}
const AI_ESTIMATE = (pages) => ai.estimateOf(pages, { estimatedCostMicroUsd: 280_000 * pages, dailyCreateLimit: 20, remainingCreates: 20 });

for (const [device, width] of DEVICES) {
  test(`그림 찍기: 계약서 AI 상자 ${device}`, async ({ page }) => {
    const running = ai.singleView({ status: "running", jobs: [ai.job(1, { status: "in_progress", model: "gpt-6.2-sol" })] });
    const { boxes } = await aiContractPhoto(page.context());
    await ai.setup(page, { width, ai: { groups: new Map([[ai.GROUP, [running, aiReady(boxes)]]]), estimate: AI_ESTIMATE } });
    await ai.openCopies(page);
    const box = ai.box(page);
    const go = box.locator("[data-ax-go]");
    await expect(go).toBeEnabled();
    await expect(go).toHaveText("사본 2장으로 일정 뽑기");
    await snap(page, `aibox-${device}-1-start`, { clip: [box], targets: [box.locator(".ax-pick"), box.locator(".ax-facts > div").nth(1), go] });
    await go.click();
    await expect(box.locator("h4")).toContainText("읽는 중");
    for (let n = 1; n <= 2; n += 1) {
      await expect.poll(() => page.evaluate(() => window.__axDelays.length)).toBe(n);
      await page.clock.runFor(5_000);
    }
    await expect(box.locator("h4")).toContainText("결과 나옴");
    await snap(page, `aibox-${device}-2-ready`, { clip: [box], targets: [box.locator("[data-ax-review]")] });
  });

  test(`그림 찍기: 계약서 AI 결과 고르기 ${device}`, async ({ page }) => {
    const { buffer, boxes } = await aiContractPhoto(page.context());
    await ai.setup(page, { width, ai: { groups: new Map([[ai.GROUP, [aiReady(boxes)]]]) } });
    await page.route("**/api/admin/v1/work/files/*/content", (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: buffer }));
    await page.goto(ai.REVIEW);
    await expect(page.locator("[data-axr-main]")).toBeVisible();
    const sum = page.locator("[data-axr-check='sum']");
    const all = page.getByRole("button", { name: "모두 AI 값으로" });
    await expect(sum).toBeVisible();
    if (device === "phone") {
      const card = page.locator("[data-axr-row='contractDate']");
      await snap(page, "aireview-phone-1-pick", { clip: [sum, card], fullWidth: true, targets: [sum, all, card.locator("[data-axr-chip='contractDate:keep']")] });
    } else {
      const frame = page.locator(".axr-frame img");
      await expect(frame).toBeVisible();
      await expect.poll(() => frame.evaluate((image) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
      await snap(page, "aireview-wide-1-pick", { clip: [page.locator("[data-axr-photo]"), sum, page.locator("[data-axr-row='balanceDate']")], fullWidth: true, targets: [page.locator(".axw__box"), sum, all] });
    }
    await all.click();
    const next = page.locator("[data-axr-next]");
    await expect(next).toBeEnabled();
    await next.click();
    await expect(page.locator("[data-axr-title]")).toHaveText("거래에 넣기 전 확인");
    // 아래 단추 줄(sticky)이 글 끝에 오도록 화면을 길게 둔다.
    await page.setViewportSize({ width, height: 1800 });
    await page.waitForTimeout(200);
    await snap(page, `aireview-${device}-2-confirm`, { clip: [page.locator("[data-axr-body]"), page.locator("[data-axr-foot]")], fullWidth: device === "phone", targets: [{ text: page.locator("[data-axr-body] .ax-sub").first() }, { text: next }] });
  });
}

for (const [device, width] of DEVICES) {
  test(`그림 찍기: 글 초안 ${device}`, async ({ page }) => {
    // 공개 단지 자료(src/data/complexes.json)로 만든 자료 목록. 글은 지어낸 AI 결과이고 OpenAI는 부르지 않는다.
    const complexes = listBlogSources({ rules: blog.rules, listings: [], naverListings: { items: [] }, complexes: content.readJson("src/data/complexes.json") });
    const sinheung = complexes.find((source) => source.id === "sinheung-sk-view");
    const result = {
      title: "신흥 SK뷰 단지 살펴보기",
      paragraphs: ["신흥 SK뷰는 대전 동구 신흥동에 있는 단지입니다.", "단지 주변 생활 시설은 현장에서 함께 둘러보시면 좋습니다.", "실제 거래 가격은 그때그때 다르니 상담 때 확인해 드립니다."],
      headings: ["단지 개요", "생활 환경", "5억 원대 실거주"],
      checklist: ["주차 동선 확인", "동·층·방향을 낮과 저녁에 확인"],
      hashtags: ["신흥동", "대전동구"],
      snsShort: "신흥 SK뷰 단지 살펴보기",
      factsUsed: ["규모"],
    };
    const queued = blog.draftOf(sinheung, { status: "queued", needsLocation: false, createdAt: blog.NOW.toISOString(), updatedAt: blog.NOW.toISOString() });
    await blog.setup(page, { width, create: () => queued, draftReads: { "zz-draft-1": () => ({ ...queued, status: "completed", result }) } });
    await page.route("**/api/admin/v1/work/blog/sources", (route) => route.fulfill(blog.envelope({ items: complexes, styles: blog.styles })));
    await page.goto("/admin/work/blog/");
    await page.locator("input[name='bl-kind'][value='complex']").check();
    const pick = page.getByRole("button", { name: "신흥 SK뷰 고르기" });
    await expect(pick).toBeVisible();
    await snap(page, `blog-${device}-1-source`, { clip: [blog.step(page, 1)], targets: [page.locator(".bl-kind label").filter({ has: page.locator("input[value='complex']") }), pick] });
    await pick.click();
    await page.getByRole("button", { name: "다음: 글 성격" }).click();
    await expect(blog.step(page, 3)).toHaveClass(/bl-step--open/u);
    const make = page.getByRole("button", { name: "글 초안 만들기" });
    const styleGroup = blog.step(page, 3).locator("input[name='bl-style']").first().locator("xpath=ancestor::*[@role='radiogroup'][1]");
    await snap(page, `blog-${device}-2-make`, { clip: [blog.step(page, 3)], targets: [styleGroup, make] });
    await make.click();
    await expect(page.locator("[data-bl-wait]")).toBeVisible();
    await page.clock.runFor(5_000);
    await expect(page.locator("[data-bl-result]")).toBeVisible();
    const check = page.locator("[data-bl-check]");
    await expect(check).toContainText("복사 전에 고칠 곳 1곳");
    const blocked = page.locator("[data-bl-where='h3']");
    const copy = page.locator("[data-bl-copy='blog']");
    await expect(copy).toBeDisabled();
    // 휴대폰은 글 칸이 길어 고칠 곳 줄 ~ 막힌 칸까지만 찍는다(복사 단추는 맨 아래, 번호 글로 알림). PC는 오른쪽 복사 단추·카드 칸까지.
    if (device === "phone") await snap(page, "blog-phone-3-result", { clip: [check, blocked], fullWidth: true, targets: [check, blocked] });
    else await snap(page, "blog-wide-3-result", { clip: [check, blocked, copy, page.locator("[data-bl-cardset]")], fullWidth: true, targets: [check, blocked, copy] });
    const cardset = page.locator("[data-bl-cardset]");
    const images = cardset.locator("[data-bl-cardset-list] img");
    await expect(images).toHaveCount(3);
    await expect.poll(() => images.evaluateAll((list) => list.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
    await snap(page, `blog-${device}-4-cards`, { clip: [cardset], targets: [cardset.locator("[data-bl-cardset-list]"), cardset.locator("[data-bl-cardset-save]")] });
  });

  test(`그림 찍기: 홍보물 ${device}`, async ({ page }) => {
    const listOrIds = (params) => {
      const ids = params.get("ids");
      if (ids) return rp.envelope({ items: rp.firstPage.filter((item) => ids.split(",").includes(item.tradeKey)), missing: [], receivedAt: "2026-11-19T03:10:00Z", recordHighReady: true, warnings: [] });
      return rp.envelope({ items: rp.firstPage, nextCursor: null, recordHighReady: true, coverage: {}, warnings: [] });
    };
    await rp.setup(page, { width, trades: listOrIds });
    await page.goto("/admin/work/realprice/");
    await expect(rp.rows(page)).toHaveCount(30);
    for (const index of [0, 1]) await rp.rows(page).nth(index).getByRole("checkbox").check();
    if (device === "phone") {
      const link = page.locator("[data-rt-promo-link]");
      await expect(link).toBeVisible();
      await page.locator("#rt-list-title").evaluate((title) => title.scrollIntoView({ block: "start" }));
      await snap(page, "promo-phone-1-pick", { targets: [rp.rows(page).first().locator(".rt-pick-button"), link] });
    } else {
      const panel = page.getByRole("complementary", { name: /미리보기/u });
      const card = panel.locator("[data-rt-preview-cards] img");
      await expect(card).toHaveCount(1);
      await expect.poll(() => card.evaluate((image) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
      await snap(page, "promo-wide-1-pick", { clip: [page.locator("#rt-preview-title"), page.locator("table:has([data-rt-rows]) thead"), rp.rows(page).nth(1), panel.locator("[data-rt-preview-downloads]")], fullWidth: true, targets: [rp.rows(page).first().locator(".rt-pick-button"), card, panel.locator("[data-rt-preview-downloads]")] });
    }

    await rp.setup(page, { width, trades: () => rp.promoAnswer() });
    await page.goto(`/admin/work/realprice/promo/?ids=${rp.idsOf(rp.promoItems)}`);
    await expect(page.locator("[data-promo-main]")).toBeVisible();
    const styles = page.getByRole("radiogroup", { name: "카드 모양" });
    const cardImage = page.locator(".rt-promo__card img");
    await expect(cardImage).toHaveAttribute("src", /^data:image\/png;base64,/u);
    await expect.poll(() => cardImage.evaluate((image) => image.complete && image.naturalWidth)).toBeGreaterThan(0);
    const download = page.locator("[data-promo-download]");
    await snap(page, `promo-${device}-2-card`, { clip: [styles, cardImage, download], fullWidth: device === "phone", targets: [styles, download] });
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
    const places = page.locator("[data-promo-copy]");
    await places.first().click();
    await expect(places.first()).toContainText("복사됨");
    await snap(page, `promo-${device}-3-post`, { clip: [page.locator("#promo-copy-title"), page.locator("[data-promo-step-post]"), places.first(), places.last(), page.locator("[data-promo-status]")], fullWidth: device === "phone", targets: [places.first()] });
  });

  test(`그림 찍기: 매물 안내지 ${device}`, async ({ page }) => {
    const first = lp.saleApartments[0];
    expect(first, "층 숫자가 있는 매매 아파트 공개 매물이 있어야 찍음").toBeTruthy();
    await lp.setup(page, width);
    await page.goto(lp.PAGE);
    await page.locator("#lp-query").fill(first.title);
    const item = page.locator(`[data-lp-item='${first.id}']`);
    await expect(item).toBeVisible();
    const pickButton = page.locator(`[data-lp-pick='${first.id}']`);
    await pickButton.click();
    await expect(page.locator("[data-lp-picked]")).toHaveText("담은 매물 1 / 3");
    await snap(page, `listing-${device}-1-pick`, { clip: [page.locator("label[for='lp-query']"), page.locator("#lp-query"), item, page.locator("[data-lp-picked]")], targets: [page.locator("#lp-query"), { text: item.locator("[data-lp-mark]") }] });
    await lp.fillApartment(page, first.id);
    const form = page.locator(`[data-lp-form='${first.id}']`);
    const count = form.locator(".bl-count");
    await expect(count).toHaveText("✓ 명시사항을 다 채웠습니다.");
    // 명시사항 칸은 길어 매물 이름 ~ 위반건축물 칸까지만 찍는다(아래 칸이 더 있음은 대체 글에 적음).
    await snap(page, `listing-${device}-2-fill`, { clip: [form.locator(".lp-form__title"), count, lp.row(page, first.id, "location"), lp.row(page, first.id, "violation")], fullWidth: device === "phone", pad: 4, targets: [lp.row(page, first.id, "location"), count] });
    const make = page.locator("[data-lp-make]");
    await make.click();
    const image = page.locator("[data-lp-image]");
    await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/u);
    await expect.poll(() => image.evaluate((node) => node.complete && node.naturalWidth)).toBeGreaterThan(0);
    const download = page.locator("[data-lp-download]");
    await snap(page, `listing-${device}-3-image`, { clip: [make, image, download], targets: [{ text: make }, { text: download }] });
  });

  test(`그림 찍기: 부동산뱅크 엑셀 가져오기 ${device}`, async ({ page }) => {
    const naver = content.readJson("src/data/naver-listings.json");
    const review = content.readJson(".github/listing-review-state.json");
    // 지금 공개 매물 한 건은 값만 바꾸고(변경), 한 건은 지어낸 새 매물(신규)이다. 소유자·전화·호수 칸은 지어낸 값이고 가져오기가 버린다.
    const areaOf = (label) => /^(\d+)([A-Z0-9-]*)㎡ · 전용 ([\d.]+)\2㎡$/u.exec(label);
    const existing = naver.items.find((item) => item.tradeType === "sale" && item.propertyType === "아파트" && areaOf(item.areaLabel) && /^(.+) (\d+)동$/u.test(item.title));
    expect(existing, "제목·면적 꼴이 맞는 매매 아파트 공개 매물이 있어야 찍음").toBeTruthy();
    const [, supply, suffix, exclusive] = areaOf(existing.areaLabel);
    const [, complex, building] = /^(.+) (\d+)동$/u.exec(existing.title);
    const ymd = (iso) => iso.slice(2).replaceAll("-", ".");
    const base = { "번호": "1", "소재지": "동구 가상동", "방수": "3", "욕실수": "2", "월관리비": "", "입주가능일": "협의", "상세설명": "가상 내부 설명", "소유자명": "가상소유자", "소유자 핸드폰번호": "010-0000-0000", "매도자명": "가상매도자", "매도자 핸드폰번호": "010-0000-0000", "진행상황 (확인방식)": "서비스중", "메모": "가상 내부 메모", "사진 개수": "0", "거래": "매매", "매물종류": "아파트" };
    const rows = [
      { ...base, "매물번호 (네이버번호)": `100000001 ( ${existing.id} )`, "매물명": complex, "매물설명": `${building}동 0000호`, "면적(㎡)": `${supply}${suffix}/${exclusive}`, "해당층/총층": "1 / 1", "방향": existing.direction ?? "", "매물가(만원)": "99,000", "특징": existing.summary, "등록기간": `${ymd(existing.registeredAt)} ~${ymd(existing.registeredAt)}` },
      { ...base, "번호": "2", "매물번호 (네이버번호)": "100000002 ( 2699999901 )", "매물명": "가상숲1단지", "매물설명": "101동 0000호", "면적(㎡)": "112B/84.97", "해당층/총층": "1 / 1", "방향": "남향", "매물가(만원)": "45,000", "특징": "가상 시험 매물입니다", "등록기간": "26.11.24 ~26.12.23" },
    ];
    const buffer = content.bankXls(BANK_LISTING_EXPECTED_HEADERS, rows);
    await content.setup(page, { width, contents: { "naver-listings": naver, "listing-review-state": review } });
    await page.goto("/admin/listings/editor/");
    await expect(page.locator("[data-admin-write-gate]")).toHaveClass(/admin-inline-notice--ready/u);
    const panel = page.locator(".admin-bank-import");
    const file = page.locator("#bank-listing-file");
    const analyze = page.locator("[data-bank-analyze]");
    await snap(page, `bank-${device}-1-file`, { clip: [panel.locator(".admin-panel__heading"), page.locator("[data-bank-status]")], targets: [file, analyze] });
    await file.setInputFiles({ name: "bank-export.xls", mimeType: "application/vnd.ms-excel", buffer });
    await analyze.click();
    await expect(page.locator("[data-bank-summary]")).toBeVisible();
    await expect(page.locator("[data-bank-stat='errors']")).toHaveText("0");
    await expect(page.locator("[data-bank-stat='new']")).toHaveText("1");
    await expect(page.locator("[data-bank-stat='changed']")).toHaveText("1");
    const items = page.locator("[data-bank-preview] > article");
    await snap(page, `bank-${device}-2-preview`, { clip: [panel.locator(".admin-import-stats"), items.nth(3)], fullWidth: device === "phone", targets: [panel.locator(".admin-import-stats"), items.first()] });
    await page.locator("[data-bank-apply]").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "검증 후 최종 저장" });
    await expect(confirm).toBeEnabled();
    await snap(page, `bank-${device}-3-review`, { clip: [dialog], targets: [dialog.locator(".admin-review-impact"), confirm] });
  });

  test(`그림 찍기: 변경 이력·복원 ${device}`, async ({ page }) => {
    const current = content.readJson("src/data/home-content.json");
    const source = structuredClone(current);
    source.broker.headline = "천동 리더스시티 단지 안 부동산입니다. 단지를 가장 가까이서 압니다.";
    const sha = (seed) => seed.repeat(40).slice(0, 40);
    const entries = [
      { commitSha: sha("a1"), title: "관리자: home-content 수정", committedAt: "2026-11-24T02:10:00Z", author: "관리자", resourceBlobSha: sha("b1"), onCurrentBranch: true, productionMatched: true },
      { commitSha: sha("a2"), title: "관리자: home-content 수정", committedAt: "2026-11-20T06:30:00Z", author: "관리자", resourceBlobSha: sha("b2"), onCurrentBranch: true, productionMatched: false },
      { commitSha: sha("a3"), title: "관리자: home-content 수정", committedAt: "2026-11-12T01:05:00Z", author: "관리자", resourceBlobSha: sha("b3"), onCurrentBranch: true, productionMatched: false },
    ];
    const revision = {
      resource: "home-content",
      source: { commitSha: sha("a2"), resourceBlobSha: sha("b2"), resourceDigest: sha("d2").repeat(2).slice(0, 64), data: source, productionMatched: false },
      current: { commitSha: sha("a1"), resourceBlobSha: sha("b1"), data: current },
      validation: { valid: true, errors: [] },
      confirmation: "home-content 이전 내용으로 복원",
    };
    await content.setup(page, { width, history: { entries, revision } });
    await page.goto("/admin/history/");
    const select = page.locator("[data-history-resource]");
    await select.selectOption("home-content");
    await page.getByRole("button", { name: "변경 이력 불러오기" }).click();
    const list = page.locator("[data-history-list]");
    await expect(list.locator("li")).toHaveCount(3);
    const pickOld = list.locator("li").nth(1).getByRole("button", { name: "변경 확인" });
    await snap(page, `history-${device}-1-list`, { clip: [page.locator("[data-history-form]"), list], targets: [select, pickOld] });
    await pickOld.click();
    const preview = page.locator("[data-history-preview]");
    await expect(page.locator("[data-history-confirmation]")).toBeVisible();
    await page.locator("[data-confirmation-input]").fill(revision.confirmation);
    const restore = page.locator("[data-restore-button]");
    await expect(restore).toBeEnabled();
    await snap(page, `history-${device}-2-restore`, { clip: [preview], targets: [page.locator("[data-history-diff] > li").first(), page.locator("[data-confirmation-guide]"), restore] });
  });
}
