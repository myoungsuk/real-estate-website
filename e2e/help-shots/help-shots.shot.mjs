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

const OUT = process.env.HELP_SHOTS_OUT;
const FRAMES = new Map(Object.values(ADMIN_HELP_FIGURES).flatMap((figure) => [...figure.phone, ...figure.wide].map((frame) => [frame.shot, frame])));
const DEVICES = [["phone", 390], ["wide", 1280]];

test.use({ deviceScaleFactor: 2 });
test.skip(!OUT, "HELP_SHOTS_OUT이 없으면 찍지 않음(npm run help:shots로 실행)");

async function unionBox(page, locators, pad) {
  for (const locator of locators) await locator.first().scrollIntoViewIfNeeded();
  const boxes = [];
  for (const locator of locators) {
    const box = await locator.first().boundingBox();
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
    area = { x: 0, y: 0, ...page.viewportSize() };
  }
  // 입력칸 포커스 테두리·고른 글자가 그림에 남지 않게 포커스를 뺀다.
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(150);
  const marks = [];
  for (const target of targets) {
    const box = target.text
      ? await target.text.first().evaluate((node) => { const range = document.createRange(); range.selectNodeContents(node); const r = range.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })
      : await target.first().boundingBox();
    if (!box) throw new Error(`${shot}: 번호 ${marks.length + 1} 자리가 보이지 않음`);
    marks.push([box.x - area.x, box.y - area.y, box.x + box.width - area.x, box.y + box.height - area.y].map((value, index) => Math.round(Math.min(1, Math.max(0, value / (index % 2 ? area.height : area.width))) * 10_000) / 10_000));
  }
  // 화면 아래 탭 막대처럼 고정된 것이 잘라 찍는 그림 가운데에 끼지 않게 잠깐 숨긴다(열린 창 안은 그대로).
  if (clip) await page.evaluate(() => { for (const node of document.querySelectorAll("body *")) if (getComputedStyle(node).position === "fixed" && !node.closest("dialog[open]")) node.dataset.helpShotHidden = node.style.visibility || "-", node.style.visibility = "hidden"; });
  const [scrollX, scrollY] = await page.evaluate(() => [window.scrollX, window.scrollY]);
  const png = await page.screenshot({ clip: { x: area.x + scrollX, y: area.y + scrollY, width: area.width, height: area.height }, fullPage: true, animations: "disabled", caret: "hide" });
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
