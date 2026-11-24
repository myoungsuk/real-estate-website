// 손님 카드 거래 칸 '계약서 사본'(단계 4 K-b)을 가짜 업무 API로 본다. 사용자 결정 2026-11-23 10:22:02 "이대로 구현해 올림"·"사진 전체를 크게, 끌어서 봄"·"접어 둠".
// 계약서 사진은 시험 안에서 그린 가상 그림(흰 종이 + 글줄 + 주민등록번호 자리의 빨간 띠)이고 실제 서버·D1·R2는 부르지 않는다.
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-23T01:40:00Z"); // 한국 11월 23일(월) 10:40
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUSTOMER_ID = uuid(1);
const DEAL_A = uuid(101);
const DEAL_B = uuid(102);
const DETAIL = `/admin/work/customers/detail/?id=${CUSTOMER_ID}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });
const FAIL_STATUS = { FILE_STORAGE_FAILED: 503, FILE_LIMIT_REACHED: 409, MASK_CONFIRMATION_REQUIRED: 400 };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const MAKE = "GAJAPHONE-TEST"; // 사진 속 기기 이름(가상). 올린 바이트에 남으면 안 된다.
const FILE_NAME = "IMG_0002_가상계약서.jpg"; // 원래 파일 이름. 어디에도 보내면 안 된다.
// 가상 계약서에서 주민등록번호가 있다고 치는 자리(사진 폭·높이에 대한 비율). 빨간 띠로 그린다.
const BAND = { x: 0.5, y: 0.25, w: 0.4, h: 0.04 };
const KEEP_TEXT = "못 올린 사본은 이 화면에만 남아 있어, 화면을 닫거나 새로 고치면 없어집니다(휴대폰 사진첩에 없을 수 있음).";

const copy = (n, dealId, createdAt) => ({ id: uuid(400 + n), kind: "contract_copy", mimeType: "image/jpeg", byteSize: 1_800_000, caption: "", dealId, createdAt });
// copiesA: 손님 카드가 보여 주는 거래 A의 사본 수. hidden: 다른 화면에서 올려 이 화면은 아직 모르는 사본 수(10장 넘음 시험).
function makeStore({ copiesA = 2, hidden = 0 } = {}) {
  const base = Date.parse("2026-11-22T07:20:00.000Z"); // 한국 11월 22일 16:20
  return {
    customer: { id: CUSTOMER_ID, displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "가상숲1단지 84㎡ 매매", status: "consulting", lastContactOn: "2026-11-19", retentionUntil: "2027-11-19", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: "2026-11-19T01:00:00.000Z" },
    copies: new Map([
      [DEAL_A, Array.from({ length: copiesA }, (_, index) => copy(index + 1, DEAL_A, new Date(base - index * 3_600_000).toISOString()))],
      [DEAL_B, []],
    ]),
    hidden,
    bytes: new Map(),
    trashed: new Map(),
  };
}
const dealsOf = (store) => [
  { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: "contracted", role: "buyer", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [], files: store.copies.get(DEAL_A).map((file) => ({ ...file })) },
  { id: DEAL_B, title: "가상강변마을 59㎡ 전세", dealType: "jeonse", status: "open", role: "tenant", version: 1, updatedAt: "2026-11-17T01:00:00.000Z", events: [], files: store.copies.get(DEAL_B).map((file) => ({ ...file })) },
];

// failUploads: POST /files 응답을 차례로 정한다(null은 정상). 다 쓰면 정상. 서버 규칙(거래 주인·가림 확인 표시·10장·미리보기 거부)은 worker/work-files.mjs를 따른다.
// aiEnabled: 업무 세션의 aiEnabled(켜면 AI 상자가 묶음 목록·비용 미리 보기를 부른다. 묶음은 늘 0개).
async function setup(page, { width = 390, filesEnabled = true, store = makeStore(), failUploads = [], aiEnabled = false } = {}) {
  await page.addInitScript(() => {
    window.__blobUrls = 0;
    const original = URL.createObjectURL;
    URL.createObjectURL = function createObjectURL(...args) {
      window.__blobUrls += 1;
      return original.apply(this, args);
    };
  });
  await page.clock.install({ time: NOW });
  await page.setViewportSize({ width, height: 900 });
  const calls = { all: [], writes: [] };
  let nextId = 800;
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/work/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^.*\/api\/admin\/v1\/work/u, "");
    const headers = request.headers();
    calls.all.push(`${method} ${path}${url.search}`);
    if (method !== "GET") {
      const json = (headers["content-type"] ?? "").includes("json");
      calls.writes.push({ method, path, headers, body: json ? request.postDataJSON() : request.postDataBuffer() });
      if (headers["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled: true, filesEnabled, aiEnabled, administrator: "시험 관리자", csrfToken: "test-csrf", schemaVersion: 7, aiWarnings: [] }));
    if (aiEnabled && path === "/ai/jobs" && method === "GET") return route.fulfill(envelope({ items: [] }));
    if (aiEnabled && path === "/ai/estimate") {
      const pages = Number(url.searchParams.get("pages"));
      return route.fulfill(envelope({ pages, requests: 2, estimatedCostMicroUsd: 560_000 * pages, dailyCreateLimit: 20, todayCreates: 0, remainingCreates: 20, monthlyCostLimitMicroUsd: 10_000_000, monthCostMicroUsd: 0, remainingCostMicroUsd: 10_000_000, allowed: true, blockedBy: null }));
    }
    if (path === `/customers/${CUSTOMER_ID}` && method === "GET") return route.fulfill(envelope({ customer: store.customer, deals: dealsOf(store), notes: [], files: [] }));
    if (path === "/files" && method === "POST") {
      const body = request.postDataBuffer();
      const code = failUploads.shift();
      // AUTH_HTML: Access 로그인이 끝나 JSON 대신 로그인 화면(401 HTML)이 온 경우 → 화면은 AUTH_REQUIRED로 본다.
      if (code === "AUTH_HTML") return route.fulfill({ status: 401, contentType: "text/html", body: "<!doctype html><title>login</title>" });
      if (code) return route.fulfill(failure(FAIL_STATUS[code] ?? 503, code));
      const dealId = /^deal:(.+)$/u.exec(headers["x-work-owner"] ?? "")?.[1];
      const list = store.copies.get(dealId);
      if (headers["x-work-file-kind"] !== "contract_copy" || !list) return route.fulfill(failure(400, "VALIDATION_FAILED"));
      if (headers["x-work-masked"] !== "rrn=1") return route.fulfill(failure(400, "MASK_CONFIRMATION_REQUIRED"));
      if (headers["x-work-file-sha256"] !== sha256(body)) return route.fulfill(failure(422, "CHECKSUM_MISMATCH"));
      if (list.length + store.hidden >= 10) return route.fulfill(failure(409, "FILE_LIMIT_REACHED"));
      const file = { id: uuid(nextId++), kind: "contract_copy", mimeType: headers["content-type"], byteSize: body.length, caption: "", dealId, createdAt: NOW.toISOString() };
      list.unshift(file);
      store.bytes.set(file.id, body);
      return route.fulfill(envelope({ file: { ...file, customerId: null } }, 201));
    }
    const fileMatch = path.match(/^\/files\/([^/]+)(\/thumb|\/content)?$/u);
    if (fileMatch) {
      const id = decodeURIComponent(fileMatch[1]);
      const list = [...store.copies.values()].find((items) => items.some((item) => item.id === id));
      if (!list) return route.fulfill(failure(404, "NOT_FOUND"));
      if (fileMatch[2] === "/thumb") return route.fulfill(method === "PUT" ? failure(400, "FILE_THUMB_NOT_ALLOWED") : failure(404, "NOT_FOUND"));
      if (fileMatch[2] === "/content") return route.fulfill({ status: 200, contentType: store.bytes.has(id) ? "image/jpeg" : "image/png", body: store.bytes.get(id) ?? PNG });
      if (method === "DELETE") {
        const index = list.findIndex((item) => item.id === id);
        const [file] = list.splice(index, 1);
        store.trashed.set(uuid(990), file);
        return route.fulfill(envelope({ deleted: true, trash: { batchId: uuid(990), purgeAfter: "2026-11-30T01:40:00.000Z" } }));
      }
    }
    const restore = path.match(/^\/trash\/([^/]+)\/restore$/u);
    if (restore && method === "POST") {
      const file = store.trashed.get(decodeURIComponent(restore[1]));
      if (!file) return route.fulfill(failure(404, "NOT_FOUND"));
      store.trashed.delete(decodeURIComponent(restore[1]));
      const list = store.copies.get(file.dealId);
      list.push(file);
      list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return route.fulfill(envelope({ restored: { files: 1 }, skipped: [] }));
    }
    return route.fulfill(failure(404, "NOT_FOUND"));
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
// 글자 줄 수. 4px 넘게 떨어진 줄 위치만 다른 줄로 본다.
const lineCount = (locator) => locator.evaluate((node) => {
  const tops = [];
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
  }
  tops.sort((a, b) => a - b);
  return tops.filter((top, index) => index === 0 || top - tops[index - 1] > 4).length;
});
const firesLeaveWarning = (page) => page.evaluate(() => {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
});
const fileWrites = (calls) => calls.writes.filter((item) => item.path.startsWith("/files"));
// 보이는 단추가 모두 44×44px 이상(마우스 PC는 높이 36px)이고 글자가 한 줄인지
// 누르는 곳: 휴대폰·태블릿은 44px, 마우스를 쓰는 1221px 이상 PC는 36px(사용자 승인 2026-11-23 11:34:13).
const tapMin = (page) => (page.viewportSize().width >= 1221 ? 36 : 44);
async function expectButtons(scope, label) {
  const boxes = await scope.locator("button").evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => {
    const tops = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.push(rect.top);
    }
    tops.sort((a, b) => a - b);
    return [node.textContent.trim(), node.getBoundingClientRect().width, node.getBoundingClientRect().height, tops.filter((top, index) => index === 0 || top - tops[index - 1] > 4).length];
  }));
  expect(boxes.length, `${label}: 보이는 단추가 있어야 함`).toBeGreaterThan(0);
  for (const [text, width, height, lines] of boxes) {
    expect(width, `${label} '${text}' 너비`).toBeGreaterThanOrEqual(44);
    expect(height, `${label} '${text}' 높이`).toBeGreaterThanOrEqual(tapMin(scope.page()));
    expect(lines, `${label} '${text}' 글자 줄 수`).toBe(1);
  }
}
const shot = (page, name) => page.screenshot({ path: test.info().outputPath(name) });

// 가상 계약서: 흰 종이 + 왼쪽 글줄 + 주민등록번호 자리의 빨간 띠. 화면이 열린 뒤 그 브라우저 canvas로 JPEG를 만든다.
async function makeDoc(page, width = 1200, height = 1600) {
  const base64 = await page.evaluate(([w, h, band]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, w, h);
    context.fillStyle = "#222";
    for (let index = 0; index < 12; index += 1) context.fillRect(w * 0.1, h * (0.08 + index * 0.07), w * 0.3, h * 0.008);
    context.fillStyle = "#c33";
    context.fillRect(w * band.x, h * band.y, w * band.w, h * band.h);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, [width, height, BAND]);
  return Buffer.from(base64, "base64");
}
// 휴대폰이 적는 EXIF(APP1)를 붙인다: 기기 이름(Make), 방향 1(그대로), GPS 위도 기호.
function withExif(jpeg) {
  const make = Buffer.from(`${MAKE}\0`, "latin1");
  const tiff = Buffer.alloc(68 + make.length);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(3, 8);
  tiff.writeUInt16BE(0x010f, 10); tiff.writeUInt16BE(2, 12); tiff.writeUInt32BE(make.length, 14); tiff.writeUInt32BE(68, 18);
  tiff.writeUInt16BE(0x0112, 22); tiff.writeUInt16BE(3, 24); tiff.writeUInt32BE(1, 26); tiff.writeUInt16BE(1, 30);
  tiff.writeUInt16BE(0x8825, 34); tiff.writeUInt16BE(4, 36); tiff.writeUInt32BE(1, 38); tiff.writeUInt32BE(50, 42);
  tiff.writeUInt32BE(0, 46);
  tiff.writeUInt16BE(1, 50);
  tiff.writeUInt16BE(0x0001, 52); tiff.writeUInt16BE(2, 54); tiff.writeUInt32BE(2, 56); tiff.write("N\0", 60, "latin1");
  tiff.writeUInt32BE(0, 64);
  make.copy(tiff, 68);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(2 + 6 + tiff.length, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, Buffer.from("Exif\0\0", "latin1"), tiff, jpeg.subarray(2)]);
}
function jpegSegments(buffer) {
  const markers = [];
  let at = 2;
  while (at + 4 <= buffer.length && buffer[at] === 0xff) {
    const marker = buffer[at + 1];
    if (marker === 0xda) break;
    markers.push(marker);
    at += 2 + buffer.readUInt16BE(at + 2);
  }
  return markers;
}
const asFile = (buffer, name = FILE_NAME, mimeType = "image/jpeg") => ({ name, mimeType, buffer });
// 올린 JPEG를 브라우저로 풀어 크기와 몇 군데 색을 읽는다(자리는 사진 폭·높이에 대한 비율).
const readPixels = (page, buffer, points) => page.evaluate(async ([base64, spots]) => {
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0);
  return { size: [bitmap.width, bitmap.height], colors: spots.map(([x, y]) => [...context.getImageData(Math.round(x * bitmap.width), Math.round(y * bitmap.height), 1, 1).data.slice(0, 3)]) };
}, [buffer.toString("base64"), points]);
const IN_BAND = [BAND.x + BAND.w / 2, BAND.y + BAND.h / 2];
const PAPER = [0.8, 0.6];
const isBlack = ([r, g, b]) => r < 40 && g < 40 && b < 40;
const isWhite = ([r, g, b]) => r > 215 && g > 215 && b > 215;
const isRed = ([r, g, b]) => r > 150 && g < 110 && b < 110;

async function pickWith(page, trigger, files) {
  const chooserPromise = page.waitForEvent("filechooser");
  await trigger.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  return chooser;
}
async function openDetail(page) {
  await page.goto(DETAIL);
  await expect(page.locator("[data-kc-toggle]").first()).toBeVisible();
}
const blockOf = (page, dealId) => ({
  toggle: page.locator(`[data-kc-toggle="${dealId}"]`),
  panel: page.locator(`[data-kc-panel="${dealId}"]`),
  status: page.locator(`[data-kc-panel="${dealId}"] > .admin-form-status`),
  rows: page.locator(`[data-kc-panel="${dealId}"] > ul > li`),
});
const maskOf = (page) => {
  const dialog = page.locator("[data-kc-mask]");
  return {
    dialog,
    title: dialog.locator("[data-kc-title]"),
    canvas: dialog.locator("[data-kc-canvas]"),
    zoom: dialog.locator("[data-kc-zoom]"),
    count: dialog.locator("[data-kc-count]"),
    status: dialog.locator("[data-kc-status]"),
    buttons: dialog.locator("button:visible"),
    button: (name) => dialog.getByRole("button", { name, exact: true }),
  };
};
// 사진 위 비율 자리 두 곳을 이어 끈다(네모 하나).
async function dragOn(page, canvas, [x1, y1], [x2, y2]) {
  const box = await canvas.boundingBox();
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height];
  await page.mouse.move(...at(x1, y1));
  await page.mouse.down();
  await page.mouse.move(...at((x1 + x2) / 2, (y1 + y2) / 2), { steps: 4 });
  await page.mouse.move(...at(x2, y2), { steps: 4 });
  await page.mouse.up();
}
const coverBand = (page, canvas) => dragOn(page, canvas, [BAND.x - 0.02, BAND.y - 0.015], [BAND.x + BAND.w + 0.02, BAND.y + BAND.h + 0.015]);
// 거래 A의 사본 칸을 펼치고 가상 계약서를 골라 칠하기 창까지 간다.
async function startMask(page, { deal = DEAL_A, size = [1200, 1600], camera = false } = {}) {
  const block = blockOf(page, deal);
  if ((await block.toggle.getAttribute("aria-expanded")) !== "true") await block.toggle.click();
  const original = withExif(await makeDoc(page, ...size));
  const chooser = await pickWith(page, block.panel.getByRole("button", { name: camera ? "계약서 찍기" : "사진첩에서 고르기" }), [asFile(original)]);
  const mask = maskOf(page);
  await expect(mask.dialog).toBeVisible();
  await expect(mask.canvas).toBeVisible();
  return { block, mask, original, chooser };
}

for (const width of [360, 1280]) {
  test(`계약서 사본 칸 ${width}px: 접어 두었다가 펼치면 글자 줄 목록, 창의 모든 단추 44px(마우스 PC는 36px) 이상·한 줄이고 가로 넘침·미리보기 요청·저장소 흔적이 없다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width, failUploads: ["FILE_STORAGE_FAILED"] });
    await openDetail(page);
    const a = blockOf(page, DEAL_A);
    const b = blockOf(page, DEAL_B);
    await expect(a.toggle).toHaveText("계약서 사본 2장");
    await expect(b.toggle).toHaveText("계약서 사본 0장");
    await expect(a.toggle).toHaveAttribute("aria-expanded", "false");
    await expect(a.panel).toBeHidden();
    await expectButtons(page.locator(".kc-copies"), "접어 둔 칸");
    await shot(page, `kc-${width}-1-closed.png`);

    await a.toggle.click();
    await expect(a.toggle).toHaveText("계약서 사본 접기");
    await expect(a.toggle).toHaveAttribute("aria-expanded", "true");
    await expect(a.panel.locator("h4")).toHaveText("계약서 사본 2장 · 10장까지");
    await expect(a.rows.locator("> span:first-child")).toHaveText(["계약서 사본 · 11월 22일 16:20 올림", "계약서 사본 · 11월 22일 15:20 올림"]);
    await expect(a.panel).toContainText("주민등록번호를 검게 가린 사본만 올립니다. 가리는 일은 이 기기에서 하고, 가리기 전 사진은 서버로 보내지 않습니다. 작은 미리보기는 만들지 않습니다.");
    await expect(a.panel.locator("button:visible")).toHaveText(["보기", "지우기", "보기", "지우기", "계약서 찍기", "사진첩에서 고르기"]);
    await expect(a.panel.getByRole("button", { name: "계약서 사본 · 11월 22일 16:20 올림 보기" })).toBeVisible();
    await expect(a.panel.locator("img")).toHaveCount(0);
    await b.toggle.click();
    await expect(b.panel.locator("h4")).toHaveText("계약서 사본 아직 없음 · 10장까지");
    await expect(b.rows).toHaveCount(0);
    await expectButtons(page.locator(".kc-copies"), "펼친 칸");
    const [shootBox, albumBox] = [await a.panel.getByRole("button", { name: "계약서 찍기" }).boundingBox(), await a.panel.getByRole("button", { name: "사진첩에서 고르기" }).boundingBox()];
    // 시안 그대로: 두 단추는 칸 폭을 다 쓰고 위아래로 놓인다.
    expect(Math.abs(shootBox.x - albumBox.x) + Math.abs(shootBox.width - albumBox.width), "'계약서 찍기'와 '사진첩에서 고르기'가 같은 폭").toBeLessThan(2);
    expect(albumBox.y, "'사진첩에서 고르기'가 아래").toBeGreaterThan(shootBox.y + shootBox.height);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    expect(calls.all.filter((call) => call.includes("/files")), "목록은 글자 줄이라 파일을 부르지 않음").toEqual([]);
    await a.toggle.scrollIntoViewIfNeeded();
    await shot(page, `kc-${width}-2-open.png`);
    await b.toggle.click();

    const { mask } = await startMask(page);
    const frame = await mask.dialog.boundingBox();
    expect([Math.round(frame.width), Math.round(frame.height)]).toEqual([width, 900]);
    await expectButtons(mask.dialog, "칠하기(0곳)");
    await coverBand(page, mask.canvas);
    await expect(mask.count).toHaveText("1곳 가림");
    await expectButtons(mask.dialog, "칠하기(1곳)");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await shot(page, `kc-${width}-3-mask.png`);

    await mask.button("그만두기").click();
    await expect(mask.dialog.locator("[data-kc-drop]")).toContainText("가리던 사진을 버릴까요?");
    await expect(mask.buttons).toHaveText(["그만두기", "버리기", "버리지 않기"]);
    await expectButtons(mask.dialog, "버리기 확인");
    await mask.button("버리지 않기").click();

    await mask.button("다 가렸음, 확대해서 확인").click();
    await expect(mask.title).toHaveText("가린 자리 확인");
    await expectButtons(mask.dialog, "확대 확인");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await shot(page, `kc-${width}-4-check.png`);
    await mask.button("주민번호 가림 확인, 올리기").click();
    await expect(mask.status).toContainText("올리지 못했습니다.");
    await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기", "다시 올리기"]);
    await expectButtons(mask.dialog, "못 올림");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await shot(page, `kc-${width}-5-failed.png`);

    await mask.button("다시 가리기").click();
    await mask.button("다 지우기").click();
    await mask.button("가릴 주민번호 없음").click();
    await expect(mask.dialog.locator("[data-kc-ask]")).toBeVisible();
    await expectButtons(mask.dialog, "가린 곳 0개 물음");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await shot(page, `kc-${width}-6-ask.png`);
    await mask.button("그만두기").click();
    await expect(mask.dialog).toBeHidden();

    await a.panel.getByRole("button", { name: "계약서 사본 · 11월 22일 16:20 올림 지우기" }).click();
    await expect(a.panel.locator(".kc-del")).toContainText("이 사본을 지울까요? 휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다.");
    await expectButtons(a.panel, "지우기 확인");
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    await a.panel.locator(".kc-del").scrollIntoViewIfNeeded();
    await shot(page, `kc-${width}-7-delete.png`);

    expect(calls.all.filter((call) => call.includes("/thumb")), "미리보기는 부르지도 올리지도 않음").toEqual([]);
    const trace = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), window.__blobUrls, location.href]));
    expect(trace).not.toContain("계약서");
    expect(trace).not.toContain("101");
    expect(JSON.parse(trace)[2], "blob: 주소를 만들지 않음").toBe(0);
    expect(JSON.parse(trace)[3]).toBe(new URL(DETAIL, page.url()).href);
    assertNoErrors();
  });
}

test("주민등록번호 자리를 칠하고 확대해서 확인한 뒤 올리면, 그 자리가 검게 저장된 JPEG 하나만 거래 주인·가림 확인 표시와 함께 간다(가리기 전 사진·촬영 정보·파일 이름·미리보기는 가지 않음)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await openDetail(page);
  expect(await firesLeaveWarning(page)).toBe(false);
  const { block, mask, original, chooser } = await startMask(page);
  expect(chooser.isMultiple(), "한 번에 한 장").toBe(false);
  await expect(mask.title).toHaveText("주민등록번호 가리기");
  await expect(mask.dialog).toContainText("주민등록번호를 마우스나 손가락으로 끌어 검게 칠하세요. 여러 곳을 칠할 수 있습니다. 키보드로는 그릴 수 없습니다.");
  await expect(mask.buttons).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "가릴 주민번호 없음"]);
  await expect(mask.count).toHaveText("아직 가린 곳이 없습니다");
  expect(await firesLeaveWarning(page), "칠하던 사본이 있으면 떠날 때 물음").toBe(true);

  await coverBand(page, mask.canvas);
  await expect(mask.count).toHaveText("1곳 가림");
  await dragOn(page, mask.canvas, [0.1, 0.8], [0.3, 0.86]);
  await expect(mask.count).toHaveText("2곳 가림");
  await mask.button("되돌리기").click();
  await expect(mask.count).toHaveText("1곳 가림");
  await mask.button("다시 하기").click();
  await mask.button("되돌리기").click();
  await expect(mask.buttons).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "다 가렸음, 확대해서 확인"]);
  // 칠하는 화면에서 이미 검게 보인다(띠 가운데 화면 픽셀).
  expect(isBlack(await mask.canvas.evaluate((node, [x, y]) => [...node.getContext("2d").getImageData(Math.round(x * node.width), Math.round(y * node.height), 1, 1).data.slice(0, 3)], IN_BAND))).toBe(true);

  await mask.button("다 가렸음, 확대해서 확인").click();
  await expect(mask.title).toHaveText("가린 자리 확인");
  await expect(mask.title).toBeFocused();
  await expect(mask.dialog).toContainText("크게 본 모습입니다. 사진을 끌어 옮겨 보면서 주민등록번호가 한 글자도 보이지 않는지 확인하세요.");
  await expect(mask.count).toHaveText("1곳 가림 · 실제 크기로 보는 중");
  await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기", "주민번호 가림 확인, 올리기"]);
  await expect(mask.canvas).toBeHidden();
  const zoomed = mask.zoom.locator("canvas");
  await expect(zoomed).toHaveAccessibleName("주민등록번호를 가린 계약서 사본(올릴 그림)");
  const view = await mask.zoom.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop, width: node.clientWidth, height: node.clientHeight, child: node.firstElementChild.getBoundingClientRect().width }));
  expect(Math.round(view.child), "실제 크기(사진 1픽셀 = 화면 1px)").toBe(1200);
  const center = [IN_BAND[0] * 1200, IN_BAND[1] * 1600];
  expect(view.left).toBeLessThan(center[0]);
  expect(view.left + view.width).toBeGreaterThan(center[0]);
  expect(view.top).toBeLessThan(center[1]);
  expect(view.top + view.height).toBeGreaterThan(center[1]);
  // 마우스로 끌어 옮기기
  const stage = await mask.zoom.boundingBox();
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.down();
  await page.mouse.move(stage.x + stage.width / 2 - 50, stage.y + stage.height / 2 - 30, { steps: 3 });
  await page.mouse.up();
  const moved = await mask.zoom.evaluate((node) => [node.scrollLeft, node.scrollTop]);
  expect(Math.abs(moved[0] - (view.left + 50)), `가로로 50px 옮김(${moved[0]})`).toBeLessThanOrEqual(1);
  expect(Math.abs(moved[1] - (view.top + 30)), `세로로 30px 옮김(${moved[1]})`).toBeLessThanOrEqual(1);
  // 키보드: 사진 자리에 초점을 두고 화살표 키
  await mask.zoom.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(() => mask.zoom.evaluate((node) => node.scrollTop)).toBeGreaterThan(moved[1]);
  expect(fileWrites(calls), "확인을 누르기 전에는 아무것도 보내지 않음").toEqual([]);

  await mask.button("다시 가리기").click();
  await expect(mask.title).toHaveText("주민등록번호 가리기");
  await expect(mask.count).toHaveText("1곳 가림");
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  await expect(block.status).toBeFocused();
  await expect(block.panel.locator("h4")).toHaveText("계약서 사본 3장 · 10장까지");
  await expect(block.rows.first().locator("> span:first-child")).toHaveText("계약서 사본 · 11월 23일 10:40 올림");
  expect(await firesLeaveWarning(page)).toBe(false);

  const writes = fileWrites(calls);
  expect(writes.map((item) => `${item.method} ${item.path}`), "올리기 한 번뿐(미리보기 PUT 없음)").toEqual(["POST /files"]);
  const [upload] = writes;
  expect(Object.keys(upload.headers).filter((key) => key.startsWith("x-work-")).sort()).toEqual(["x-work-file-kind", "x-work-file-sha256", "x-work-masked", "x-work-owner"]);
  expect(upload.headers["x-work-file-kind"]).toBe("contract_copy");
  expect(upload.headers["x-work-owner"]).toBe(`deal:${DEAL_A}`);
  expect(upload.headers["x-work-masked"]).toBe("rrn=1");
  expect(upload.headers["content-type"]).toBe("image/jpeg");
  expect(upload.headers["x-work-file-sha256"]).toBe(sha256(upload.body));
  expect(upload.headers["x-work-file-sha256"], "가리기 전 사진과 다른 바이트").not.toBe(sha256(original));
  expect([upload.body[0], upload.body[1]]).toEqual([0xff, 0xd8]);
  expect(jpegSegments(upload.body), "EXIF(APP1) 조각 없음").not.toContain(0xe1);
  expect(upload.body.includes(Buffer.from(MAKE, "latin1")), "기기 이름 없음").toBe(false);
  expect(JSON.stringify([calls.all, calls.writes.map((item) => item.headers)])).not.toContain("IMG_0002");
  const pixels = await readPixels(page, upload.body, [IN_BAND, PAPER, [BAND.x + 0.01, BAND.y + 0.005], [BAND.x + BAND.w - 0.01, BAND.y + BAND.h - 0.005], [0.2, 0.83]]);
  expect(pixels.size).toEqual([1200, 1600]);
  expect(isBlack(pixels.colors[0]), `띠 가운데 ${pixels.colors[0]}`).toBe(true);
  expect(isWhite(pixels.colors[1]), `종이 ${pixels.colors[1]}`).toBe(true);
  expect(isBlack(pixels.colors[2]), `띠 왼쪽 위 끝 ${pixels.colors[2]}`).toBe(true);
  expect(isBlack(pixels.colors[3]), `띠 오른쪽 아래 끝 ${pixels.colors[3]}`).toBe(true);
  expect(isWhite(pixels.colors[4]), `되돌린 네모 자리는 칠하지 않음 ${pixels.colors[4]}`).toBe(true);

  expect(calls.all.filter((call) => call.includes("/thumb"))).toEqual([]);
  expect(calls.all.filter((call) => call === `GET /customers/${CUSTOMER_ID}`), "올린 뒤 손님 카드를 한 번 다시 읽음").toHaveLength(2);
  expect(await page.locator("[data-kc-canvas]").evaluate((node) => [node.width, node.height]), "창을 닫으면 사진 메모리를 비움").toEqual([0, 0]);
  expect(await mask.zoom.evaluate((node) => node.childElementCount)).toBe(0);
  expect(await page.evaluate(() => window.__blobUrls)).toBe(0);
  assertNoErrors();
});

test("사본 0장 거래에 첫 사본을 올리면 AI 상자가 '불러오는 중'에 멈추지 않고 최근 묶음을 한 번 읽어 시작 칸을 보인다(2026-11-24 운영에서 찾음)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { aiEnabled: true });
  await openDetail(page);
  const { block, mask } = await startMask(page, { deal: DEAL_B });
  expect(calls.all.filter((line) => line.includes("/ai/")), "사본 0장으로 펼칠 때는 AI 업무 API를 부르지 않음").toEqual([]);
  await mask.button("가릴 주민번호 없음").click();
  await mask.button("주민번호 없음 확인, 올리기").click();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  const ax = page.locator(`section.ax[data-ax-deal="${DEAL_B}"]`);
  await expect(ax.getByRole("button", { name: "사본 1장으로 일정 뽑기" })).toBeVisible();
  await expect(ax).not.toContainText("AI 작업을 불러오는 중");
  expect(calls.all.filter((line) => line.startsWith("GET /ai/jobs?")), "최근 묶음은 한 번만 읽음").toEqual([`GET /ai/jobs?dealId=${DEAL_B}`]);
  assertNoErrors();
});

test("가린 곳이 0개면 한 번 더 묻고, '주민번호 없음 확인, 올리기'를 눌러야 같은 확인 표시로 올린다(물음 중에 칠하면 칠하기로 돌아감)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await openDetail(page);
  const { block, mask } = await startMask(page, { deal: DEAL_B, camera: true });
  await mask.button("가릴 주민번호 없음").click();
  const ask = mask.dialog.locator("[data-kc-ask]");
  await expect(ask).toContainText("가린 곳이 없습니다. 이대로 올릴까요?");
  await expect(ask).toContainText("이 사본에 주민등록번호가 정말 없을 때만 올리세요. 한 곳이라도 보이면 돌아가서 가려야 합니다.");
  await expect(mask.dialog.locator("[data-kc-ask-title]")).toBeFocused();
  await expect(mask.buttons).toHaveText(["그만두기", "돌아가서 가리기", "주민번호 없음 확인, 올리기"]);
  expect(fileWrites(calls), "물어보기만 하고 아직 보내지 않음").toEqual([]);

  await mask.button("돌아가서 가리기").click();
  await expect(ask).toBeHidden();
  await expect(mask.buttons).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "가릴 주민번호 없음"]);
  await mask.button("가릴 주민번호 없음").click();
  await expect(ask).toBeVisible();
  await dragOn(page, mask.canvas, [0.1, 0.8], [0.3, 0.86]);
  await expect(ask, "물음 중에 칠하면 물음을 거둠").toBeHidden();
  await expect(mask.count).toHaveText("1곳 가림");
  await mask.button("되돌리기").click();
  await mask.button("가릴 주민번호 없음").click();
  await mask.button("주민번호 없음 확인, 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  await expect(block.panel.locator("h4")).toHaveText("계약서 사본 1장 · 10장까지");

  const writes = fileWrites(calls);
  expect(writes.map((item) => `${item.method} ${item.path}`)).toEqual(["POST /files"]);
  expect(writes[0].headers["x-work-owner"]).toBe(`deal:${DEAL_B}`);
  expect(writes[0].headers["x-work-masked"], "서버 표시는 같음(가렸거나 번호가 없음)").toBe("rrn=1");
  expect(jpegSegments(writes[0].body)).not.toContain(0xe1);
  const pixels = await readPixels(page, writes[0].body, [IN_BAND, PAPER, [0.2, 0.83]]);
  expect(isRed(pixels.colors[0]), `칠하지 않았으므로 띠는 그대로 ${pixels.colors[0]}`).toBe(true);
  expect(isWhite(pixels.colors[2]), `되돌린 네모는 남지 않음 ${pixels.colors[2]}`).toBe(true);
  assertNoErrors();
});

test("큰 사진(4032×3024, 휴대폰 사진 크기) 360px: 화면에서 1 ~ 6px 끌린 것은 네모가 아니고 8px 넘게 끌어야 칠해지며, 확대 확인은 화면 폭의 4배, 올린 사본은 원래 크기 그대로다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { width: 360 });
  await openDetail(page);
  const { mask } = await startMask(page, { size: [4032, 3024] });
  const shown = await mask.canvas.boundingBox();
  expect(4032 / shown.width, "화면 1px이 사진 여러 픽셀").toBeGreaterThan(8);
  const drag = async (pixels) => {
    const x = Math.round(shown.x + shown.width / 2);
    const y = Math.round(shown.y + shown.height / 2);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + pixels, y + pixels, { steps: 2 });
    await page.mouse.up();
  };
  for (const pixels of [1, 2, 3, 6]) {
    await drag(pixels);
    await expect(mask.count, `화면 ${pixels}px 끌림`).toHaveText("아직 가린 곳이 없습니다");
    await expect(mask.button("가릴 주민번호 없음"), `화면 ${pixels}px 끌림 뒤에도 가린 곳 0개`).toBeVisible();
  }
  await drag(12);
  await expect(mask.count).toHaveText("1곳 가림");
  await mask.button("다 가렸음, 확대해서 확인").click();
  await expect(mask.count).toHaveText("1곳 가림 · 화면 폭의 4배로 보는 중");
  const view = await mask.zoom.evaluate((node) => ({ width: node.clientWidth, child: node.firstElementChild.getBoundingClientRect().width, left: node.scrollLeft }));
  expect(Math.round(view.child)).toBe(view.width * 4);
  expect(view.left, "첫 네모가 보이는 자리로 옮김").toBeGreaterThan(0);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await shot(page, "kc-360-big-check.png");
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.dialog).toBeHidden();
  const [upload] = fileWrites(calls);
  expect(upload.body.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  // 화면 12px 네모 = 사진 약 144px. 네모 가운데(사진 가운데에서 오른쪽 아래로 6px)는 검고, 그 밖 종이는 그대로다.
  const half = 6 / shown.width;
  const pixels = await readPixels(page, upload.body, [[0.5 + half, 0.5 + (6 / shown.height)], [0.5 - half * 2, 0.5 - (12 / shown.height)], PAPER]);
  expect(pixels.size, "줄이지 않음(긴 변 4096px까지)").toEqual([4032, 3024]);
  expect(isBlack(pixels.colors[0]), `네모 가운데 ${pixels.colors[0]}`).toBe(true);
  expect(isWhite(pixels.colors[1]), `네모 밖 ${pixels.colors[1]}`).toBe(true);
  expect(isWhite(pixels.colors[2]), `종이 ${pixels.colors[2]}`).toBe(true);
  assertNoErrors();
});

test("10장이 찬 거래(409)는 가린 사본을 남겨 두고 까닭을 알리며, 다른 화면에서 한 장을 지운 뒤 '다시 올리기'는 같은 바이트·같은 SHA-256을 보낸다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const store = makeStore({ copiesA: 9, hidden: 1 });
  const calls = await setup(page, { store });
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await coverBand(page, mask.canvas);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.status).toHaveText(`올리지 못했습니다. 이 거래에는 계약서 사본을 10장까지 올릴 수 있습니다. 다른 화면에서 한 장을 지운 뒤 '다시 올리기'를 누르세요. ${KEEP_TEXT}`);
  await expect(mask.title).toBeFocused();
  await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기", "다시 올리기"]);
  await expect(mask.zoom.locator("canvas")).toBeVisible();
  store.hidden = 0;
  await mask.button("다시 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  await expect(block.panel.locator("h4")).toHaveText("계약서 사본 10장 · 10장까지");
  await expect(block.panel).toContainText("10장을 다 채웠습니다. 더 올리려면 먼저 한 장을 지워 주세요.");
  await expect(block.panel.getByRole("button", { name: "계약서 찍기" })).toBeHidden();
  await expect(block.panel.getByRole("button", { name: "사진첩에서 고르기" })).toBeHidden();
  const writes = fileWrites(calls);
  expect(writes).toHaveLength(2);
  expect(writes[1].headers["x-work-file-sha256"]).toBe(writes[0].headers["x-work-file-sha256"]);
  expect(writes[1].body.equals(writes[0].body)).toBe(true);
  assertNoErrors();
});

test("올리지 못하면(503) 닫기 전에 버릴지 묻고, 브라우저가 창을 닫아도 다시 열어 묻는다. '버리기'를 눌러야 사본이 없어진다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { failUploads: ["FILE_STORAGE_FAILED"] });
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await coverBand(page, mask.canvas);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.status).toContainText("올리지 못했습니다.");
  await expect(mask.status).toContainText("'다시 올리기'");
  await expect(mask.status).toContainText(KEEP_TEXT);
  expect(await firesLeaveWarning(page)).toBe(true);

  const drop = mask.dialog.locator("[data-kc-drop]");
  await mask.button("그만두기").click();
  await expect(drop).toContainText("못 올린 사본을 버릴까요?");
  await expect(drop).toContainText("버리면 그 사진은 없어집니다(휴대폰 사진첩에 없을 수 있음).");
  await expect(mask.button("버리지 않기")).toBeFocused();
  await expect(mask.buttons).toHaveText(["그만두기", "버리기", "버리지 않기"]);
  await mask.button("버리지 않기").click();
  await expect(drop).toBeHidden();
  await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기", "다시 올리기"]);
  await page.keyboard.press("Escape");
  await expect(drop).toBeVisible();
  // Esc를 거듭 누르면 브라우저가 창을 닫을 수 있다 → 다시 열어 묻는다.
  await mask.dialog.evaluate((node) => node.close());
  await expect(mask.dialog).toBeVisible();
  await expect(drop).toBeVisible();
  expect(await mask.dialog.evaluate((node) => node.matches(":modal"))).toBe(true);
  await mask.button("버리기").click();
  await expect(mask.dialog).toBeHidden();
  expect(await firesLeaveWarning(page)).toBe(false);
  expect(fileWrites(calls)).toHaveLength(1);
  await expect(block.panel.locator("h4")).toHaveText("계약서 사본 2장 · 10장까지");
  await expect(block.panel.getByRole("button", { name: "사진첩에서 고르기" })).toBeFocused();
  assertNoErrors();
});

test("가린 곳 0개로 올리다 실패한 뒤 주민등록번호를 칠하면, 앞서 만든 가리지 않은 사본은 버리고 칠한 사본을 새로 만들어 올린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { failUploads: ["FILE_STORAGE_FAILED"] });
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await mask.button("가릴 주민번호 없음").click();
  await mask.button("주민번호 없음 확인, 올리기").click();
  await expect(mask.status).toContainText("올리지 못했습니다.");
  await expect(mask.dialog.locator("[data-kc-ask-title]")).toBeFocused();
  await expect(mask.buttons).toHaveText(["그만두기", "돌아가서 가리기", "다시 올리기"]);

  await coverBand(page, mask.canvas);
  await expect(mask.count).toHaveText("1곳 가림");
  await expect(mask.status).toHaveText("");
  await expect(mask.buttons).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "다 가렸음, 확대해서 확인"]);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await expect(mask.buttons, "'다시 올리기'가 아니라 새 확인").toHaveText(["그만두기", "다시 가리기", "주민번호 가림 확인, 올리기"]);
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  const writes = fileWrites(calls);
  expect(writes).toHaveLength(2);
  expect(writes[1].headers["x-work-file-sha256"]).not.toBe(writes[0].headers["x-work-file-sha256"]);
  const [first, second] = [await readPixels(page, writes[0].body, [IN_BAND]), await readPixels(page, writes[1].body, [IN_BAND])];
  expect(isRed(first.colors[0]), "서버가 받지 않은 첫 사본은 가리지 않은 것").toBe(true);
  expect(isBlack(second.colors[0]), `저장된 사본은 검게 칠한 것 ${second.colors[0]}`).toBe(true);
  assertNoErrors();
});

test("로그인이 끝났으면(401 로그인 화면) 새로고침하라고 하지 않고, 새 탭에서 로그인한 뒤 '다시 올리기'로 같은 사본을 올린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { failUploads: ["AUTH_HTML"] });
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await coverBand(page, mask.canvas);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.status).toContainText("새 탭에서 관리자 화면을 열어 다시 로그인한 뒤 '다시 올리기'");
  await expect(mask.status).not.toContainText("새로고침");
  await expect(mask.zoom.locator("canvas")).toBeVisible();
  await mask.button("다시 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  const writes = fileWrites(calls);
  expect(writes).toHaveLength(2);
  expect(writes[1].body.equals(writes[0].body)).toBe(true);
  assertNoErrors();
});

test("서버가 가림 확인 표시를 받지 않으면(400) '다시 올리기' 없이 까닭만 알리고, 사진이 아닌 파일은 서버로 보내지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { failUploads: ["MASK_CONFIRMATION_REQUIRED"] });
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await coverBand(page, mask.canvas);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await expect(mask.status).toContainText("주민등록번호를 가렸다고 확인한 사본인데 서버가 그 확인을 받지 못해 올리지 않았습니다. 개발 담당에게 알려 주세요.");
  await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기"]);
  await mask.button("그만두기").click();
  await mask.button("버리기").click();
  await expect(mask.dialog).toBeHidden();

  await pickWith(page, block.panel.getByRole("button", { name: "사진첩에서 고르기" }), [asFile(Buffer.from("가상 글자 파일"), "가상메모.txt", "text/plain")]);
  await expect(mask.dialog.locator("[data-kc-wait]")).toContainText("위의 '그만두기'를 누른 뒤 다시 해 주세요.");
  await expect(mask.buttons).toHaveText(["그만두기"]);
  expect(await firesLeaveWarning(page), "읽지 못한 파일은 남길 것이 없음").toBe(false);
  await mask.button("그만두기").click();
  await expect(mask.dialog).toBeHidden();
  expect(fileWrites(calls)).toHaveLength(1);
  assertNoErrors();
});

test("올린 사본 '보기': 누를 때만 올려 둔 사본을 한 번 받고, '크게 보기'·'화면에 맞추기'를 오가며, 닫으면 '보기' 단추로 돌아간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const store = makeStore();
  const calls = await setup(page, { store });
  await openDetail(page);
  store.bytes.set(uuid(401), await makeDoc(page));
  const block = blockOf(page, DEAL_A);
  await block.toggle.click();
  const see = block.panel.getByRole("button", { name: "계약서 사본 · 11월 22일 16:20 올림 보기" });
  await see.click();
  const mask = maskOf(page);
  await expect(mask.title).toHaveText("계약서 사본 보기");
  const image = mask.zoom.locator("img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute("alt", "계약서 사본 · 11월 22일 16:20 올림");
  expect(await image.getAttribute("src")).toBe(`/api/admin/v1/work/files/${uuid(401)}/content`);
  await expect(mask.count).toHaveText("계약서 사본 · 11월 22일 16:20 올림");
  await expect(mask.buttons).toHaveText(["닫기", "크게 보기"]);
  const fit = await mask.zoom.evaluate((node) => [node.clientWidth, node.clientHeight, node.scrollWidth, node.scrollHeight]);
  expect(fit[2], "화면에 맞춘 사본은 가로로 넘치지 않음").toBeLessThanOrEqual(fit[0]);
  expect(fit[3], "화면에 맞춘 사본은 세로로 넘치지 않음").toBeLessThanOrEqual(fit[1] + 1);
  await shot(page, "kc-390-view-fit.png");
  await mask.button("크게 보기").click();
  await expect(mask.buttons).toHaveText(["닫기", "화면에 맞추기"]);
  await expect(mask.count).toHaveText("계약서 사본 · 11월 22일 16:20 올림 · 실제 크기로 보는 중");
  expect(Math.round((await image.boundingBox()).width)).toBe(1200);
  await shot(page, "kc-390-view-big.png");
  await mask.button("화면에 맞추기").click();
  await expect(mask.count).toHaveText("계약서 사본 · 11월 22일 16:20 올림");
  expect(await mask.zoom.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await firesLeaveWarning(page), "보기만 하는 중에는 떠날 때 묻지 않음").toBe(false);
  await page.keyboard.press("Escape");
  await expect(mask.dialog).toBeHidden();
  await expect(see).toBeFocused();
  expect(await mask.zoom.evaluate((node) => node.childElementCount)).toBe(0);
  expect(calls.all.filter((call) => call.includes("/files/")), "올려 둔 사본은 한 번만 받고 미리보기는 부르지 않음").toEqual([`GET /files/${uuid(401)}/content`]);
  expect(fileWrites(calls)).toEqual([]);
  expect(await page.evaluate(() => window.__blobUrls)).toBe(0);
  assertNoErrors();
});

test("사본 '지우기'는 줄 안에서 한 번 더 묻고 휴지통으로 옮기며, 알림의 '되살리기'로 목록에 돌아온다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await openDetail(page);
  const block = blockOf(page, DEAL_A);
  await block.toggle.click();
  const del = block.panel.getByRole("button", { name: "계약서 사본 · 11월 22일 16:20 올림 지우기" });
  await del.click();
  const confirm = block.panel.locator(".kc-del");
  await expect(confirm).toContainText("이 사본을 지울까요? 휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다.");
  await expect(confirm.getByRole("button", { name: "지우기", exact: true })).toBeFocused();
  await expect(del).toHaveAttribute("aria-expanded", "true");
  await confirm.getByRole("button", { name: "그만두기" }).click();
  await expect(confirm).toHaveCount(0);
  await expect(del).toBeFocused();
  expect(calls.writes).toEqual([]);

  await del.click();
  await confirm.getByRole("button", { name: "지우기", exact: true }).click();
  await expect(block.rows).toHaveCount(1);
  await expect(block.status).toHaveText("✓ 계약서 사본을 휴지통으로 옮겼습니다. 되살리기 · 휴지통 보기");
  await expect(block.status).toBeFocused();
  await expect(block.panel.locator("h4")).toHaveText("계약서 사본 1장 · 10장까지");
  await expect(block.status.getByRole("link", { name: "휴지통 보기" })).toHaveAttribute("href", "/admin/work/trash/");
  await block.status.getByRole("button", { name: "되살리기" }).click();
  await expect(block.status).toHaveText("✓ 계약서 사본을 되살렸습니다.");
  await expect(block.rows).toHaveCount(2);
  await expect(block.toggle, "다시 읽어도 펼친 채").toHaveAttribute("aria-expanded", "true");
  expect(calls.writes.map((item) => `${item.method} ${item.path}`)).toEqual([`DELETE /files/${uuid(401)}`, `POST /trash/${uuid(990)}/restore`]);
  assertNoErrors();
});

test("파일 저장소가 꺼져 있으면 사본 수와 까닭만 보이고 '보기'·'지우기'·'계약서 찍기'가 없으며 파일을 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { filesEnabled: false });
  await openDetail(page);
  const a = blockOf(page, DEAL_A);
  const b = blockOf(page, DEAL_B);
  await expect(a.toggle).toHaveText("계약서 사본 2장");
  await a.toggle.click();
  await b.toggle.click();
  await expect(a.rows).toHaveCount(2);
  await expect(a.panel).toContainText("파일 저장소가 아직 켜지지 않았습니다. 올려 둔 계약서 사본 2장은 저장소를 다시 켜면 볼 수 있습니다.");
  await expect(b.panel).toContainText("파일 저장소가 아직 켜지지 않았습니다. 켜지면 여기서 계약서 사본을 찍어 올릴 수 있습니다.");
  await expect(a.panel.locator("button:visible")).toHaveCount(0);
  await expect(b.panel.locator("button:visible")).toHaveCount(0);
  expect(calls.all.filter((call) => call.includes("/files"))).toEqual([]);
  assertNoErrors();
});


// 올리기 요청을 붙잡아 둔다(올리는 중인 화면을 보려고). release()를 부르면 위 setup의 가짜 서버로 넘긴다.
async function holdUploads(page) {
  let release;
  let seen;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { seen = resolve; });
  await page.route("**/api/admin/v1/work/files", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    seen();
    await gate;
    return route.fallback();
  });
  return { started, release };
}
// 사진 읽기(createImageBitmap)를 한 번 붙잡아 둔다. kind "file": 고른 사진 읽기, "canvas": 칠하기 편집기가 줄인 사진을 읽기.
// idle()은 시작한 읽기가 모두 끝나고 그 뒤에 이어진 일까지 돈 다음에 돌아온다.
async function watchBitmaps(page) {
  await page.addInitScript(() => {
    const original = window.createImageBitmap.bind(window);
    const pending = new Set();
    const watch = { hold: null, release: null, started: [] };
    window.createImageBitmap = (source, ...rest) => {
      const kind = source instanceof Blob ? "file" : source instanceof HTMLCanvasElement ? "canvas" : "other";
      watch.started.push(kind);
      const run = (async () => {
        if (watch.hold === kind) {
          watch.hold = null;
          await new Promise((resolve) => { watch.release = resolve; });
        }
        return original(source, ...rest);
      })();
      pending.add(run);
      const done = () => pending.delete(run);
      run.then(done, done);
      return run;
    };
    const turn = () => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(0);
    });
    watch.idle = async () => {
      do {
        await Promise.allSettled([...pending]);
        await turn();
        await turn();
      } while (pending.size > 0);
    };
    window.__bitmaps = watch;
  });
}
const holdBitmap = (page, kind) => page.evaluate((value) => {
  window.__bitmaps.hold = value;
  window.__bitmaps.started = [];
}, kind);
const releaseBitmap = (page) => page.evaluate(async () => {
  window.__bitmaps.release();
  await window.__bitmaps.idle();
  return window.__bitmaps.started;
});
const canvasSize = (canvas) => canvas.evaluate((node) => [node.width, node.height]);
// 화면을 거치지 않고 칠하기 자리에 바로 보내는 끌기(올리는 중에는 칠하기 자리가 inert라 진짜 포인터가 닿지 않으므로, 편집기 잠금만 따로 본다).
const dispatchDrag = (canvas, [x1, y1], [x2, y2]) => canvas.evaluate((node, [fromX, fromY, toX, toY]) => {
  const rect = node.getBoundingClientRect();
  const fire = (type, x, y) => node.dispatchEvent(new PointerEvent(type, { pointerId: 77, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, clientX: rect.left + x * rect.width, clientY: rect.top + y * rect.height }));
  fire("pointerdown", fromX, fromY);
  fire("pointermove", (fromX + toX) / 2, (fromY + toY) / 2);
  fire("pointermove", toX, toY);
  fire("pointerup", toX, toY);
}, [x1, y1, x2, y2]);

test("올리는 중에는 칠할 수 없다: 올리기를 누르기 전에 시작해 그 뒤에 끝난 끌기도, 올리는 중에 새로 시작한 끌기도 네모가 되지 않아 화면의 가린 곳 수와 올라간 사본이 같다", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = await setup(page, { failUploads: ["FILE_STORAGE_FAILED"] });
  const uploads = await holdUploads(page);
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await mask.button("가릴 주민번호 없음").click();
  const ask = mask.dialog.locator("[data-kc-ask]");
  await expect(ask).toBeVisible();

  // 한 손가락으로 주민등록번호 자리를 끄는 중에(아직 떼지 않음) 다른 손가락으로 올리기를 누른 것과 같은 순서: 마우스를 누른 채 키보드로 단추를 누른다.
  const box = await mask.canvas.boundingBox();
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height];
  await page.mouse.move(...at(BAND.x - 0.02, BAND.y - 0.015));
  await page.mouse.down();
  await page.mouse.move(...at(BAND.x + BAND.w / 2, BAND.y + BAND.h / 2), { steps: 4 });
  await mask.button("주민번호 없음 확인, 올리기").focus();
  await page.keyboard.press("Enter");
  await uploads.started;
  await expect(mask.button("올리는 중…")).toBeDisabled();
  await page.mouse.move(...at(BAND.x + BAND.w + 0.02, BAND.y + BAND.h + 0.015), { steps: 4 });
  await page.mouse.up();
  await expect(mask.count, "올리기 전에 시작한 끌기는 버림").toHaveText("아직 가린 곳이 없습니다");
  // 올리는 중에 새로 시작한 끌기
  await dispatchDrag(mask.canvas, [0.1, 0.8], [0.3, 0.86]);
  await expect(mask.count, "올리는 중에 시작한 끌기는 받지 않음").toHaveText("아직 가린 곳이 없습니다");
  await expect(ask, "물음 칸 그대로").toBeVisible();
  await expect(mask.button("올리는 중…")).toBeDisabled();

  uploads.release();
  await expect(mask.status).toContainText("올리지 못했습니다.");
  await expect(mask.count).toHaveText("아직 가린 곳이 없습니다");
  await expect(mask.buttons).toHaveText(["그만두기", "돌아가서 가리기", "다시 올리기"]);
  await mask.button("다시 올리기").click();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");

  const writes = fileWrites(calls);
  expect(writes).toHaveLength(2);
  expect(writes[1].headers["x-work-file-sha256"], "화면이 0곳이라고 한 그 사본을 다시 보냄").toBe(writes[0].headers["x-work-file-sha256"]);
  const pixels = await readPixels(page, writes[1].body, [IN_BAND, [0.2, 0.83]]);
  expect(isRed(pixels.colors[0]), `화면이 0곳이라고 했으므로 띠는 그대로 ${pixels.colors[0]}`).toBe(true);
  expect(isWhite(pixels.colors[1]), `올리는 중에 끈 자리도 그대로 ${pixels.colors[1]}`).toBe(true);
  expect(errors, "브라우저 오류가 없어야 합니다").toEqual([]);
});

test("올리는 중에 Esc를 눌러도 창은 그대로이고 버릴지 묻지 않는다(올리기는 끝까지 가므로, 중간에 닫히면 화면은 버렸다고 하는데 서버에는 사본이 남는다)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  const uploads = await holdUploads(page);
  await openDetail(page);
  const { block, mask } = await startMask(page);
  await coverBand(page, mask.canvas);
  await mask.button("다 가렸음, 확대해서 확인").click();
  await mask.button("주민번호 가림 확인, 올리기").click();
  await uploads.started;
  await expect(mask.button("올리는 중…")).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(mask.dialog).toBeVisible();
  await expect(mask.dialog.locator("[data-kc-drop]"), "올리는 중에는 버릴지 묻지 않음").toBeHidden();
  await expect(mask.buttons).toHaveText(["그만두기", "다시 가리기", "올리는 중…"]);
  await expect(mask.button("그만두기")).toBeDisabled();
  await expect(mask.status).toHaveText("올리고 있습니다…");

  uploads.release();
  await expect(mask.dialog).toBeHidden();
  await expect(block.status).toHaveText("✓ 계약서 사본 1장을 올렸습니다.");
  expect(fileWrites(calls)).toHaveLength(1);
  assertNoErrors();
});

for (const kind of ["file", "canvas"]) {
  const where = kind === "file" ? "고른 사진을 읽는 중" : "칠하기 편집기를 여는 중";
  test(`사진 준비 중(${where}) '그만두기'를 누르면, 늦게 끝난 준비가 가리기 전 사진을 칠하기 자리에 남기지 않는다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page);
    await watchBitmaps(page);
    await openDetail(page);
    const block = blockOf(page, DEAL_A);
    await block.toggle.click();
    const mask = maskOf(page);
    const picture = withExif(await makeDoc(page));
    await holdBitmap(page, kind);
    await pickWith(page, block.panel.getByRole("button", { name: "사진첩에서 고르기" }), [asFile(picture)]);
    await expect(mask.dialog.locator("[data-kc-wait]")).toHaveText("사진을 준비하고 있습니다…");
    await mask.button("그만두기").click();
    await expect(mask.dialog).toBeHidden();
    const started = await releaseBitmap(page);
    // 사진 읽기에서 그만뒀으면 편집기를 열지도 않는다(줄인 사진을 다시 읽지 않음).
    expect(started).toEqual(kind === "file" ? ["file"] : ["file", "canvas"]);
    expect(await canvasSize(mask.canvas), "숨은 칠하기 자리는 빈 채(크기 0)").toEqual([0, 0]);
    expect(fileWrites(calls)).toEqual([]);
    expect(await firesLeaveWarning(page), "남은 사본이 없으므로 떠날 때 묻지 않음").toBe(false);
    assertNoErrors();
  });

  test(`사진 A 준비(${where})를 그만두고 사진 B를 연 뒤 A가 늦게 끝나도, 칠하기 화면과 올라가는 사본은 B다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page);
    await watchBitmaps(page);
    await openDetail(page);
    const block = blockOf(page, DEAL_A);
    await block.toggle.click();
    const mask = maskOf(page);
    const album = block.panel.getByRole("button", { name: "사진첩에서 고르기" });
    // A는 세로 사진(1200×1600), B는 가로 사진(1600×1200): 칠하기 자리의 가로·세로로 어느 사진인지 가린다.
    const [pictureA, pictureB] = [withExif(await makeDoc(page, 1200, 1600)), withExif(await makeDoc(page, 1600, 1200))];
    await holdBitmap(page, kind);
    await pickWith(page, album, [asFile(pictureA)]);
    await expect(mask.dialog.locator("[data-kc-wait]")).toHaveText("사진을 준비하고 있습니다…");
    await mask.button("그만두기").click();
    await expect(mask.dialog).toBeHidden();
    await pickWith(page, album, [asFile(pictureB)]);
    await expect(mask.canvas).toBeVisible();
    const sizeB = await canvasSize(mask.canvas);
    expect(sizeB[0], `가로 사진 ${sizeB}`).toBeGreaterThan(sizeB[1]);

    await releaseBitmap(page);
    expect(await canvasSize(mask.canvas), "A가 늦게 끝나도 칠하기 자리는 B 그대로").toEqual(sizeB);
    await coverBand(page, mask.canvas);
    await expect(mask.count).toHaveText("1곳 가림");
    await mask.button("다 가렸음, 확대해서 확인").click();
    await mask.button("주민번호 가림 확인, 올리기").click();
    await expect(mask.dialog).toBeHidden();
    const writes = fileWrites(calls);
    expect(writes).toHaveLength(1);
    const pixels = await readPixels(page, writes[0].body, [IN_BAND, PAPER]);
    expect(pixels.size, "올라간 사본은 B(가로)").toEqual([1600, 1200]);
    expect(isBlack(pixels.colors[0]), `끈 자리가 B의 띠와 맞음 ${pixels.colors[0]}`).toBe(true);
    assertNoErrors();
  });
}
