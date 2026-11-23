// 손님 카드 '사진' 칸(단계 2 바로 찍기, F-b)을 가짜 업무 API로 본다. 시안 승인 2026-11-22 15:39:08 "이 시안대로", 하단 막대 "B. 사진 찍기 더함", 사진첩 "10장".
// 사진은 시험 안에서 그린 가상 그림이고, 위치(GPS)·기기 이름도 지어낸 값이다. 실제 서버·D1·R2는 부르지 않는다.
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";

const NOW = new Date("2026-11-22T05:05:00Z"); // 한국 11월 22일(일) 14:05
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CUSTOMER_ID = uuid(1);
const DETAIL = `/admin/work/customers/detail/?id=${CUSTOMER_ID}`;
const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });
const FAIL_STATUS = { FILE_STORAGE_FAILED: 503, PAYLOAD_TOO_LARGE: 413, CHECKSUM_MISMATCH: 422, IMAGE_METADATA_PRESENT: 415 };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const MAKE = "GAJAPHONE-TEST"; // 사진 속 기기 이름(가상). 올린 바이트에 남으면 안 된다.
const FILE_NAME = "IMG_0001_가상손님집.jpg"; // 원래 파일 이름. 어디에도 보내면 안 된다.

const photo = (n, createdAt, extra = {}) => ({ id: uuid(300 + n), kind: "property_photo", mimeType: "image/jpeg", byteSize: 2_400_000, caption: "", dealId: null, createdAt, ...extra });
const PRESET = [
  photo(1, "2026-11-21T05:05:00.000Z", { caption: "거실 창 쪽 누수 자국" }),
  photo(2, "2026-11-21T01:30:00.000Z"),
  photo(3, "2026-11-20T08:00:00.000Z", { kind: "other" }),
];
const NO_THUMB = new Set([uuid(302)]);

function makeStore(files = PRESET) {
  return {
    customer: { id: CUSTOMER_ID, displayName: "가상 손님 1", phoneDigits: "01000000001", needs: "가상숲1단지 84㎡ 매매", status: "consulting", lastContactOn: "2026-11-19", retentionUntil: "2027-11-19", version: 1, createdAt: "2026-11-01T01:00:00.000Z", updatedAt: "2026-11-19T01:00:00.000Z" },
    files: files.map((item) => ({ ...item })),
    bytes: new Map(),
    thumbs: new Map(),
    trashed: new Map(),
  };
}

// failUploads: POST /files 응답을 차례로 정한다(null은 정상). 다 쓰면 정상.
async function setup(page, { width = 390, filesEnabled = true, store = makeStore(), failUploads = [] } = {}) {
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
    calls.all.push(`${method} ${path}`);
    if (method !== "GET") {
      const json = (headers["content-type"] ?? "").includes("json");
      calls.writes.push({ method, path, headers, body: json ? request.postDataJSON() : request.postDataBuffer() });
      if (headers["x-admin-csrf"] !== "test-csrf") return route.fulfill(failure(403, "CSRF_INVALID"));
    }
    if (path === "/session") return route.fulfill(envelope({ enabled: true, filesEnabled, administrator: "시험 관리자", csrfToken: "test-csrf", schemaVersion: 7 }));
    if (path === `/customers/${CUSTOMER_ID}` && method === "GET") return route.fulfill(envelope({ customer: store.customer, deals: [], notes: [], files: store.files }));
    if (path === "/files" && method === "POST") {
      const body = request.postDataBuffer();
      const code = failUploads.shift();
      // AUTH_HTML: Access 로그인이 끝나 JSON 대신 로그인 화면(401 HTML)이 온 경우 → 화면은 AUTH_REQUIRED로 본다.
      if (code === "AUTH_HTML") return route.fulfill({ status: 401, contentType: "text/html", body: "<!doctype html><title>login</title>" });
      if (code) return route.fulfill(failure(FAIL_STATUS[code] ?? 503, code));
      if (headers["x-work-file-sha256"] !== sha256(body)) return route.fulfill(failure(422, "CHECKSUM_MISMATCH"));
      const file = { id: uuid(nextId++), kind: headers["x-work-file-kind"], mimeType: headers["content-type"], byteSize: body.length, caption: "", dealId: null, createdAt: NOW.toISOString() };
      store.files.unshift(file);
      store.bytes.set(file.id, body);
      return route.fulfill(envelope({ file: { ...file, customerId: CUSTOMER_ID } }, 201));
    }
    const fileMatch = path.match(/^\/files\/([^/]+)(\/thumb|\/content)?$/u);
    if (fileMatch) {
      const id = decodeURIComponent(fileMatch[1]);
      const index = store.files.findIndex((item) => item.id === id);
      if (index < 0) return route.fulfill(failure(404, "NOT_FOUND"));
      const file = store.files[index];
      if (fileMatch[2] === "/thumb" && method === "PUT") {
        const body = request.postDataBuffer();
        if (headers["x-work-file-sha256"] !== sha256(body)) return route.fulfill(failure(422, "CHECKSUM_MISMATCH"));
        store.thumbs.set(id, { body, type: headers["content-type"] });
        return route.fulfill(envelope({ file: { ...file, customerId: CUSTOMER_ID } }));
      }
      if (fileMatch[2] === "/thumb") {
        const thumb = store.thumbs.get(id);
        if (thumb) return route.fulfill({ status: 200, contentType: thumb.type, body: thumb.body });
        if (NO_THUMB.has(id) || store.bytes.has(id)) return route.fulfill(failure(404, "NOT_FOUND"));
        return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      }
      if (fileMatch[2] === "/content") return route.fulfill({ status: 200, contentType: "image/png", body: store.bytes.get(id) ?? PNG });
      if (method === "PATCH") {
        store.files[index] = { ...file, caption: request.postDataJSON().caption };
        return route.fulfill(envelope({ file: { ...store.files[index], customerId: CUSTOMER_ID } }));
      }
      if (method === "DELETE") {
        store.files.splice(index, 1);
        store.trashed.set(uuid(990), file);
        return route.fulfill(envelope({ deleted: true, trash: { batchId: uuid(990), purgeAfter: "2026-11-29T05:05:00.000Z" } }));
      }
    }
    const restore = path.match(/^\/trash\/([^/]+)\/restore$/u);
    if (restore && method === "POST") {
      const file = store.trashed.get(decodeURIComponent(restore[1]));
      if (!file) return route.fulfill(failure(404, "NOT_FOUND"));
      store.trashed.delete(decodeURIComponent(restore[1]));
      store.files.push(file);
      store.files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
// 글자 줄 수(아이콘 svg는 세지 않음). 4px 넘게 떨어진 줄 위치만 다른 줄로 본다.
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
// 보이는 단추가 모두 44×44px 이상인지
async function expectTouchSize(locator, label) {
  const boxes = await locator.evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length > 0).map((node) => [node.textContent.trim(), node.getBoundingClientRect().width, node.getBoundingClientRect().height]));
  expect(boxes.length, `${label}: 보이는 단추가 있어야 함`).toBeGreaterThan(0);
  for (const [text, width, height] of boxes) {
    expect(width, `${label} '${text}' 너비`).toBeGreaterThanOrEqual(44);
    expect(height, `${label} '${text}' 높이`).toBeGreaterThanOrEqual(44);
  }
}

// 가상 사진(왼쪽 빨강·오른쪽 파랑). 화면이 열린 뒤 그 브라우저 canvas로 JPEG를 만든다.
async function makeJpeg(page, width = 1200, height = 600) {
  const base64 = await page.evaluate(([w, h]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d");
    context.fillStyle = "#c33";
    context.fillRect(0, 0, w / 2, h);
    context.fillStyle = "#33c";
    context.fillRect(w / 2, 0, w / 2, h);
    return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, [width, height]);
  return Buffer.from(base64, "base64");
}
// 휴대폰이 적는 EXIF(APP1)를 붙인다: 기기 이름(Make), 방향 6(오른쪽으로 90° 돌려 보기), GPS 위도 기호.
function withExif(jpeg) {
  const make = Buffer.from(`${MAKE}\0`, "latin1");
  const tiff = Buffer.alloc(68 + make.length);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(3, 8); // IFD0 항목 3개(태그 순서대로)
  tiff.writeUInt16BE(0x010f, 10); tiff.writeUInt16BE(2, 12); tiff.writeUInt32BE(make.length, 14); tiff.writeUInt32BE(68, 18);
  tiff.writeUInt16BE(0x0112, 22); tiff.writeUInt16BE(3, 24); tiff.writeUInt32BE(1, 26); tiff.writeUInt16BE(6, 30);
  tiff.writeUInt16BE(0x8825, 34); tiff.writeUInt16BE(4, 36); tiff.writeUInt32BE(1, 38); tiff.writeUInt32BE(50, 42);
  tiff.writeUInt32BE(0, 46);
  tiff.writeUInt16BE(1, 50); // GPS IFD 항목 1개: GPSLatitudeRef "N"
  tiff.writeUInt16BE(0x0001, 52); tiff.writeUInt16BE(2, 54); tiff.writeUInt32BE(2, 56); tiff.write("N\0", 60, "latin1");
  tiff.writeUInt32BE(0, 64);
  make.copy(tiff, 68);
  const head = Buffer.alloc(4);
  head.writeUInt16BE(0xffe1, 0);
  head.writeUInt16BE(2 + 6 + tiff.length, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, Buffer.from("Exif\0\0", "latin1"), tiff, jpeg.subarray(2)]);
}
const asFile = (buffer, name = FILE_NAME, mimeType = "image/jpeg") => ({ name, mimeType, buffer });

async function pickWith(page, trigger, files) {
  const chooserPromise = page.waitForEvent("filechooser");
  await trigger.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  return chooser;
}

async function openDetail(page) {
  await page.goto(DETAIL);
  await expect(page.locator("[data-ph-root]")).toBeVisible();
}

for (const width of [360, 390, 430, 768, 1280]) {
  test(`T2-138 사진 칸 ${width}px: 날짜 묶음·미리보기 자리표, 찍기 단추 44px·한 줄, 올리기 단추 한 줄, 설명은 주소·저장소에 없음, 가로 넘침 없음`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { width });
    await openDetail(page);
    const root = page.locator("[data-ph-root]");
    await expect(root.locator("[data-ph-count]")).toHaveText("3장");
    await expect(root.locator(".ph-day")).toHaveText(["11월 21일(토)", "11월 20일(금)"]);
    await expect(root.locator(".ph-thumb")).toHaveCount(3);
    await expect(root.locator(".ph-thumb").nth(0)).toHaveAccessibleName("사진 크게 보기 · 11월 21일(토) 14:05 · 거실 창 쪽 누수 자국");
    await expect(root.locator(".ph-thumb").nth(1).locator(".ph-thumb__none")).toHaveText("미리보기 없음");
    for (const box of await root.locator(".ph-thumb").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);

    const camera = page.getByRole("button", { name: "바로 찍기" });
    const album = page.getByRole("button", { name: "사진첩에서 고르기" });
    const [cameraBox, albumBox] = [await camera.boundingBox(), await album.boundingBox()];
    expect(cameraBox.height).toBeGreaterThanOrEqual(44);
    expect(albumBox.height).toBeGreaterThanOrEqual(44);
    expect(await lineCount(camera)).toBe(1);
    expect(await lineCount(album)).toBe(1);
    if (width === 360) expect(Math.abs(cameraBox.y - albumBox.y), "360px에서 두 단추가 같은 줄").toBeLessThan(2);

    const barCamera = page.locator("[data-cu-bar-camera]");
    if (width < 980) {
      await expect(barCamera).toBeVisible();
      const [memoBox, barBox] = [await page.locator("[data-cu-bar-memo]").boundingBox(), await barCamera.boundingBox()];
      expect(Math.abs(memoBox.y - barBox.y), "하단 막대 두 단추가 같은 줄").toBeLessThan(2);
      expect(barBox.height).toBeGreaterThanOrEqual(44);
      expect(await lineCount(barCamera)).toBe(1);
    } else {
      await expect(barCamera).toBeHidden();
    }

    await pickWith(page, album, [asFile(await makeJpeg(page))]);
    const check = page.locator("[data-ph-check]");
    await expect(check).toBeVisible();
    await expect(check.locator("[data-ph-check-title]")).toHaveText("고른 사진 확인");
    const go = page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" });
    expect((await go.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await lineCount(go), "올리기 단추 글자는 한 줄").toBe(1);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);

    await check.locator("[data-ph-desc]").fill("가상 손님 1 집 거실 누수");
    await go.click();
    await expect(root.locator("[data-ph-status]")).toHaveText("✓ 사진 1장을 올렸습니다.");
    await expect(check).toBeHidden();
    await expect(root.locator("[data-ph-count]")).toHaveText("4장");
    await expect(root.locator(".ph-day").first()).toHaveText("11월 22일(일)");
    expect(fileWrites(calls).map((item) => `${item.method} ${item.path.replace(/[0-9a-f-]{36}/u, ":id")}`)).toEqual(["POST /files", "PUT /files/:id/thumb", "PATCH /files/:id"]);
    expect(decodeURIComponent(page.url())).not.toMatch(/가상 손님|거실/u);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await overflowOf(page)).toBeLessThanOrEqual(0);
    assertNoErrors();
  });
}

test("T2-139 '바로 찍기'는 카메라 입력을 열고, 다시 저장한 JPEG에는 EXIF·GPS·기기 이름·파일 이름이 없으며 방향은 그림에 반영된다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { store: makeStore([]) });
  await openDetail(page);
  await expect(page.locator("[data-ph-empty]")).toHaveText("아직 올린 사진이 없습니다.");
  const original = withExif(await makeJpeg(page));
  expect(original.includes("Exif")).toBe(true);
  const chooser = await pickWith(page, page.getByRole("button", { name: "바로 찍기" }), [asFile(original)]);
  expect(await chooser.element().getAttribute("capture")).toBe("environment");
  expect(chooser.isMultiple()).toBe(false);

  const check = page.locator("[data-ph-check]");
  await expect(check.locator("[data-ph-check-title]")).toHaveText("찍은 사진 확인");
  await expect(check.locator("[data-ph-kind]")).toBeHidden(); // 찍은 사진은 '현장 사진'으로만
  await expect(check.locator("[data-ph-preview-size]")).toContainText("올릴 크기");
  // 1200×600에 방향 6 → 600×1200. 확인 칸 그림은 긴 변 960px.
  expect(await check.locator("[data-ph-preview-canvas] canvas").evaluate((node) => [node.width, node.height])).toEqual([480, 960]);
  await expect(check.locator('[data-ph-preview-canvas] canvas[role="img"]')).toHaveAccessibleName("찍은 사진");
  await page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" }).click();
  await expect(page.locator("[data-ph-status]")).toHaveText("✓ 사진 1장을 올렸습니다.");

  const writes = fileWrites(calls);
  expect(writes.map((item) => `${item.method} ${item.path.replace(/[0-9a-f-]{36}/u, ":id")}`)).toEqual(["POST /files", "PUT /files/:id/thumb"]); // 설명이 없으면 PATCH 없음
  const [sent, thumb] = writes;
  expect(sent.headers["content-type"]).toBe("image/jpeg");
  expect(sent.headers["x-work-file-kind"]).toBe("property_photo");
  expect(sent.headers["x-work-owner"]).toBe(`customer:${CUSTOMER_ID}`);
  expect(sent.headers["x-work-file-sha256"]).toBe(sha256(sent.body));
  expect(sent.headers["x-admin-csrf"]).toBe("test-csrf");
  expect([...sent.body.subarray(0, 2)]).toEqual([0xff, 0xd8]);
  expect(sent.body.includes("Exif"), "EXIF가 빠짐").toBe(false);
  expect(sent.body.includes(MAKE), "기기 이름이 빠짐").toBe(false);
  for (const item of writes) {
    expect(JSON.stringify(item.headers)).not.toContain("IMG_0001");
    expect(Buffer.from(item.body).includes(Buffer.from("IMG_0001"))).toBe(false);
  }
  expect(sent.body.length).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
    return [bitmap.width, bitmap.height];
  }, sent.body.toString("base64"))).toEqual([600, 1200]);
  expect(["image/webp", "image/jpeg"]).toContain(thumb.headers["content-type"]);
  expect(thumb.body.length).toBeLessThanOrEqual(256 * 1024);
  expect(thumb.headers["x-work-file-sha256"]).toBe(sha256(thumb.body));

  await expect(page.locator("[data-ph-empty]")).toBeHidden();
  await expect(page.locator(".ph-thumb")).toHaveCount(1);
  await expect(page.locator(".ph-thumb img")).toHaveJSProperty("complete", true);
  expect(await firesLeaveWarning(page)).toBe(false);
  assertNoErrors();
});

test("T2-139a 사진첩 2장 중 1장을 못 올리면 그 사진만 남고 떠날 때 묻고, '다시 올리기'는 같은 바이트·같은 SHA-256을 다시 보낸다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { store: makeStore([]), failUploads: ["FILE_STORAGE_FAILED"] });
  await openDetail(page);
  const base = await makeJpeg(page);
  await pickWith(page, page.getByRole("button", { name: "사진첩에서 고르기" }), [asFile(base, "a.jpg"), asFile(await makeJpeg(page, 900, 900), "b.jpg")]);
  const check = page.locator("[data-ph-check]");
  await expect(check.locator("[data-ph-check-title]")).toHaveText("고른 사진 2장 확인");
  await expect(check.locator(".ph-pick")).toHaveCount(2);
  await expect(check.getByRole("button", { name: "이 사진 빼기" })).toHaveCount(2);
  await expect(check.locator("[data-ph-desc-hint]")).toContainText("2장 모두에 붙음");
  await check.getByRole("radio", { name: "기타 사진" }).check();
  await check.locator("[data-ph-desc]").fill("거실 창 쪽");
  expect(await firesLeaveWarning(page), "올리기 전 사진도 떠날 때 묻기").toBe(true);
  await page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" }).click();

  await expect(check.locator("[data-ph-check-title]")).toHaveText("! 사진 1장을 올리지 못했습니다");
  await expect(check.locator("[data-ph-fail-text]")).toContainText("못 올린 사진은 이 화면에만 남아 있어");
  await expect(check.locator(".ph-pick--fail")).toHaveCount(1);
  await expect(check.locator(".ph-pick--done")).toHaveCount(1);
  await expect(page.locator("[data-ph-status]")).toHaveText("✓ 사진 1장을 올렸습니다.");
  await expect(page.locator(".ph-thumb")).toHaveCount(1);
  const retry = check.getByRole("button", { name: "다시 올리기" });
  await expect(retry).toBeVisible();
  await expect(check.getByRole("button", { name: "이 사진 버리기" })).toBeVisible();
  expect(await firesLeaveWarning(page), "못 올린 사진이 있으면 떠날 때 묻기").toBe(true);

  const before = fileWrites(calls).filter((item) => item.method === "POST");
  expect(before).toHaveLength(2);
  expect(before.every((item) => item.headers["x-work-file-kind"] === "other")).toBe(true);
  await retry.click();
  await expect(check).toBeHidden();
  await expect(page.locator("[data-ph-status]")).toHaveText("✓ 사진 1장을 올렸습니다.");
  await expect(page.locator(".ph-thumb")).toHaveCount(2);
  const posts = fileWrites(calls).filter((item) => item.method === "POST");
  expect(posts).toHaveLength(3);
  expect(posts[2].headers["x-work-file-sha256"]).toBe(posts[0].headers["x-work-file-sha256"]);
  expect(posts[2].body.equals(posts[0].body)).toBe(true);
  const captions = fileWrites(calls).filter((item) => item.method === "PATCH").map((item) => item.body);
  expect(captions).toEqual([{ caption: "거실 창 쪽" }, { caption: "거실 창 쪽" }]);
  await expect(page.locator(".ph-thumb__desc")).toHaveText(["거실 창 쪽", "거실 창 쪽"]);
  expect(await firesLeaveWarning(page)).toBe(false);
  assertNoErrors();
});

for (const [code, text] of [
  ["AUTH_HTML", "관리자 로그인이 만료되었습니다. 새 탭에서 관리자 화면을 열어 다시 로그인한 뒤 '다시 올리기'를 누르세요."],
  ["CHECKSUM_MISMATCH", "보내는 중에 사진이 깨졌습니다. '다시 올리기'를 눌러 주세요."],
]) {
  test(`T2-139a ${code === "AUTH_HTML" ? "로그인 만료(401 로그인 화면)" : "422 보내는 중 깨짐"}이면 새로고침하라고 하지 않고 '다시 올리기'로 같은 사진을 다시 보낸다`, async ({ page }) => {
    const assertNoErrors = collectErrors(page);
    const calls = await setup(page, { store: makeStore([]), failUploads: [code] });
    await openDetail(page);
    await pickWith(page, page.getByRole("button", { name: "바로 찍기" }), [asFile(await makeJpeg(page))]);
    await page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" }).click();
    const check = page.locator("[data-ph-check]");
    await expect(check.locator("[data-ph-check-title]")).toHaveText("! 사진 1장을 올리지 못했습니다");
    await expect(check.locator("[data-ph-fail-text]")).toContainText(text);
    await expect(check.locator("[data-ph-fail-text]")).not.toContainText("새로고침해");
    const retry = check.getByRole("button", { name: "다시 올리기" });
    await expect(retry).toBeVisible();
    expect(await firesLeaveWarning(page)).toBe(true);
    await retry.click();
    await expect(check).toBeHidden();
    await expect(page.locator("[data-ph-status]")).toHaveText("✓ 사진 1장을 올렸습니다.");
    const posts = fileWrites(calls).filter((item) => item.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1].headers["x-work-file-sha256"]).toBe(posts[0].headers["x-work-file-sha256"]);
    expect(posts[1].body.equals(posts[0].body)).toBe(true);
    await expect(page.locator(".ph-thumb")).toHaveCount(1);
    assertNoErrors();
  });
}

test("T2-138 360px: 확인 칸·못 올린 칸·버리기 확인·크게 보기·지우기 확인의 단추가 모두 44px 이상이고 가로로 넘치지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page, { width: 360, failUploads: ["FILE_STORAGE_FAILED", "FILE_STORAGE_FAILED"] });
  await openDetail(page);
  const check = page.locator("[data-ph-check]");
  await pickWith(page, page.getByRole("button", { name: "사진첩에서 고르기" }), [asFile(await makeJpeg(page), "a.jpg"), asFile(await makeJpeg(page, 900, 900), "b.jpg")]);
  await expect(check.getByRole("button", { name: "이 사진 빼기" })).toHaveCount(2);
  await expectTouchSize(check.getByRole("button", { name: "이 사진 빼기" }), "이 사진 빼기");
  await expectTouchSize(check.locator("[data-ph-go], [data-ph-cancel]"), "올리기 확인 칸");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);

  await page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" }).click();
  await expect(check.locator("[data-ph-check-title]")).toHaveText("! 사진 2장을 올리지 못했습니다");
  await expect(check.getByRole("button", { name: "다시 올리기" })).toBeVisible();
  await expectTouchSize(check.getByRole("button", { name: /^(다시 올리기|못 올린 사진 버리기)$/u }), "못 올린 칸");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await check.getByRole("button", { name: "못 올린 사진 버리기" }).click();
  await expect(check.locator("[data-ph-drop]")).toBeVisible();
  await expectTouchSize(check.locator("[data-ph-drop-go], [data-ph-drop-cancel]"), "버리기 확인");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await check.locator("[data-ph-drop-cancel]").click();
  await expect(check.locator("[data-ph-drop]")).toBeHidden();

  await page.locator(".ph-thumb").first().click();
  const view = page.locator("[data-ph-view]");
  await expect(view).toBeVisible();
  await expectTouchSize(view.getByRole("button", { name: /^(닫기|설명 저장|사진 지우기)$/u }), "크게 보기");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  await view.getByRole("button", { name: "사진 지우기" }).click();
  await expectTouchSize(view.locator("[data-ph-del-go], [data-ph-del-cancel]"), "지우기 확인");
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("T2-139b 서버가 받지 않는 사진(10MB 넘음)은 '다시 올리기' 없이 '이 사진 버리기'만, 버리면 칸이 닫힌다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { store: makeStore([]), failUploads: ["PAYLOAD_TOO_LARGE"] });
  await openDetail(page);
  await pickWith(page, page.getByRole("button", { name: "바로 찍기" }), [asFile(await makeJpeg(page))]);
  await page.getByRole("button", { name: "신분증·주민번호 없음 확인, 올리기" }).click();
  const check = page.locator("[data-ph-check]");
  await expect(check.locator("[data-ph-check-title]")).toHaveText("! 사진 1장을 올리지 못했습니다");
  await expect(check.locator("[data-ph-go]")).toBeHidden();
  await check.getByRole("button", { name: "이 사진 버리기" }).click();
  await expect(check.locator("[data-ph-drop]")).toBeVisible();
  await check.locator("[data-ph-drop-go]").click();
  await expect(check).toBeHidden();
  await expect(page.locator("[data-ph-take]")).toBeVisible();
  await expect(page.getByRole("button", { name: "바로 찍기" })).toBeFocused();
  expect(fileWrites(calls)).toHaveLength(1);
  expect(await firesLeaveWarning(page)).toBe(false);
  assertNoErrors();
});

test("T2-139b 한 번에 11장·사진이 아닌 파일은 서버에 보내지 않고 까닭을 알린다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { store: makeStore([]) });
  await openDetail(page);
  const jpeg = await makeJpeg(page, 120, 60);
  const album = page.getByRole("button", { name: "사진첩에서 고르기" });
  await pickWith(page, album, Array.from({ length: 11 }, (_, index) => asFile(jpeg, `p${index}.jpg`)));
  await expect(page.locator("[data-ph-status]")).toHaveText("한 번에 10장까지 올릴 수 있습니다. 11장을 골랐으니 10장 이하로 다시 골라 주세요.");
  await expect(page.locator("[data-ph-check]")).toBeHidden();
  await pickWith(page, album, [asFile(Buffer.from("사진 아님"), "memo.jpg")]);
  await expect(page.locator("[data-ph-status]")).toContainText("사진으로 읽을 수 없습니다");
  await expect(page.locator("[data-ph-check]")).toBeHidden();
  expect(fileWrites(calls)).toEqual([]);
  expect(await firesLeaveWarning(page)).toBe(false);
  assertNoErrors();
});

test("T2-139b 다시 저장해도 10MB가 넘는 사진은 올리지 않는다(JPEG 결과 크기를 시험에서 크게 만듦)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type, quality) {
      if (type === "image/jpeg" && this.width === 1200) return callback(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: "image/jpeg" }));
      return original.call(this, callback, type, quality);
    };
  });
  const calls = await setup(page, { store: makeStore([]) });
  await openDetail(page);
  await pickWith(page, page.getByRole("button", { name: "바로 찍기" }), [asFile(await makeJpeg(page))]);
  await expect(page.locator("[data-ph-status]")).toContainText("10MB가 넘어");
  await expect(page.locator("[data-ph-check]")).toBeHidden();
  expect(fileWrites(calls)).toEqual([]);
  assertNoErrors();
});

test("T2-139b 파일 저장소가 꺼져 있으면 찍기 단추·하단 '사진 찍기' 없이 까닭만 보이고 사진은 부르지 않는다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page, { filesEnabled: false });
  await openDetail(page);
  await expect(page.locator("[data-ph-off]")).toHaveText("파일 저장소가 아직 켜지지 않았습니다. 올려 둔 사진 3장은 저장소를 다시 켜면 보입니다.");
  await expect(page.locator("[data-ph-take]")).toBeHidden();
  await expect(page.locator(".ph-thumb")).toHaveCount(0);
  await expect(page.locator("[data-ph-empty]")).toBeHidden();
  await expect(page.locator("[data-cu-bar-memo]")).toBeVisible();
  await expect(page.locator("[data-cu-bar-camera]")).toBeHidden();
  expect(calls.all.filter((item) => item.includes("/files"))).toEqual([]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("사진 크게 보기: 원본을 열고, 주민번호 꼴 설명은 막고, 설명 저장·닫기·지우기(휴지통)·되살리기", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const calls = await setup(page);
  await openDetail(page);
  const first = page.locator(".ph-thumb").first();
  await first.click();
  const view = page.locator("[data-ph-view]");
  await expect(view).toBeVisible();
  await expect(page.locator("#ph-view-title")).toBeFocused();
  await expect(view.locator("[data-ph-view-img]")).toBeVisible();
  await expect(view.locator("[data-ph-view-img]")).toHaveAttribute("alt", "사진 원본 · 11월 21일(토) 14:05");
  await expect(view.locator("[data-ph-view-meta]")).toHaveText("현장 사진 · 11월 21일(토) 14:05 올림 · 3장 중 1번째");
  await expect(first).toHaveAttribute("aria-current", "true");
  expect(calls.all).toContain(`GET /files/${uuid(301)}/content`);

  const desc = view.locator("[data-ph-view-desc]");
  await desc.fill("집주인 900101-1234567");
  await view.getByRole("button", { name: "설명 저장" }).click();
  await expect(view.locator("[data-ph-view-status]")).toHaveText("주민등록번호처럼 보이는 숫자는 사진 설명에 넣을 수 없습니다.");
  expect(fileWrites(calls)).toEqual([]);
  await desc.fill("현관 앞 균열");
  await view.getByRole("button", { name: "설명 저장" }).click();
  await expect(view.locator("[data-ph-view-status]")).toHaveText("✓ 설명을 저장했습니다.");
  expect(fileWrites(calls).map((item) => [item.method, item.path, item.body])).toEqual([["PATCH", `/files/${uuid(301)}`, { caption: "현관 앞 균열" }]]);
  await expect(first.locator(".ph-thumb__desc")).toHaveText("현관 앞 균열");

  await view.getByRole("button", { name: "닫기" }).click();
  await expect(view).toBeHidden();
  await expect(page.locator(".ph-thumb").first()).toBeFocused();

  await page.locator(".ph-thumb").first().click();
  const deleteToggle = view.getByRole("button", { name: "사진 지우기" });
  await deleteToggle.click();
  await expect(deleteToggle).toHaveAttribute("aria-expanded", "true");
  await view.locator("[data-ph-del-go]").click();
  await expect(view).toBeHidden();
  const status = page.locator("[data-ph-status]");
  await expect(status).toContainText("✓ 사진을 휴지통으로 옮겼습니다.");
  await expect(status.getByRole("link", { name: /휴지통/u })).toBeVisible();
  await expect(page.locator("[data-ph-count]")).toHaveText("2장");
  expect(fileWrites(calls).at(-1)).toMatchObject({ method: "DELETE", path: `/files/${uuid(301)}`, body: {} });

  await status.getByRole("button", { name: "되살리기" }).click();
  await expect(status).toContainText("✓ 사진을 되살렸습니다.");
  await expect(page.locator("[data-ph-count]")).toHaveText("3장");
  expect(calls.writes.at(-1)).toMatchObject({ method: "POST", path: `/trash/${uuid(990)}/restore` });
  expect(decodeURIComponent(page.url())).not.toMatch(/현관|균열/u);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("사진이 24장이면 20장 먼저, '20장 더 보기'로 나머지를 붙이고 21번째 사진으로 간다(360px)", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const many = Array.from({ length: 24 }, (_, index) => photo(10 + index, new Date(Date.UTC(2026, 10, 21, 9, 0) - index * 3_600_000).toISOString()));
  await setup(page, { width: 360, store: makeStore(many) });
  await openDetail(page);
  await expect(page.locator("[data-ph-count]")).toHaveText("24장");
  await expect(page.locator(".ph-thumb")).toHaveCount(20);
  await expect(page.locator("[data-ph-shown]")).toHaveText("20장 보는 중 · 모두 24장");
  await page.getByRole("button", { name: "20장 더 보기" }).click();
  await expect(page.locator(".ph-thumb")).toHaveCount(24);
  await expect(page.locator(".ph-thumb").nth(20)).toBeFocused();
  await expect(page.locator("[data-ph-more-line]")).toBeHidden();
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  assertNoErrors();
});

test("휴대폰 하단 막대 '사진 찍기'는 그 자리에서 카메라를 열고, 찍은 뒤 사진 칸의 확인 칸으로 간다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  await setup(page);
  await openDetail(page);
  const chooser = await pickWith(page, page.locator("[data-cu-bar-camera]"), [asFile(await makeJpeg(page))]);
  expect(await chooser.element().getAttribute("capture")).toBe("environment");
  const check = page.locator("[data-ph-check]");
  await expect(check.locator("[data-ph-check-title]")).toHaveText("찍은 사진 확인");
  await expect(page.locator("#ph-check-title")).toBeFocused();
  await expect(check).toBeInViewport();
  await expect(page.locator("[data-ph-take]")).toBeHidden();
  await check.getByRole("button", { name: "그만두기" }).click();
  await expect(check).toBeHidden();
  await expect(page.getByRole("button", { name: "바로 찍기" })).toBeFocused();
  assertNoErrors();
});

// ── 얼굴 가려서 내보내기(단계 3 M-b, 사용자 결정 2026-11-23 08:55:04 "나안: 화면 전체 (Recommended)") ──
// 가상 사진 1200×600(왼쪽 빨강·오른쪽 파랑)을 원본으로 두고, 경계(x=600)를 가로지르는 네모를 그려 경계 칸이 섞인 색이 되는지 본다.
function jpegSegments(buffer) {
  const markers = [];
  for (let at = 2; at + 3 < buffer.length;) {
    if (buffer[at] !== 0xff) break;
    const marker = buffer[at + 1];
    if (marker === 0xda) break;
    markers.push(marker);
    at += 2 + buffer.readUInt16BE(at + 2);
  }
  return markers;
}
async function openMaskEditor(page, { width = 390, share = false, photo = [1200, 600] } = {}) {
  if (share) {
    await page.addInitScript(() => {
      window.__shared = [];
      Object.defineProperty(navigator, "canShare", { configurable: true, value: (data) => Array.isArray(data?.files) && data.files.length > 0 });
      Object.defineProperty(navigator, "share", { configurable: true, value: async (data) => { window.__shared.push(data.files.map((file) => [file.name, file.type, file.size])); } });
    });
  }
  const store = makeStore();
  const calls = await setup(page, { width, store });
  await openDetail(page);
  store.bytes.set(uuid(301), await makeJpeg(page, ...photo));
  await page.locator(".ph-thumb").first().click();
  const view = page.locator("[data-ph-view]");
  const entry = view.getByRole("button", { name: "얼굴 가려서 내보내기" });
  await expect(view.locator("[data-ph-view-img]")).toBeVisible();
  await expect(entry).toBeEnabled();
  await entry.click();
  const dialog = page.getByRole("dialog", { name: "얼굴 가려서 내보내기" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-ph-mask-canvas]")).toBeVisible();
  return { calls, dialog, view, entry };
}
async function dragBox(page, dialog, [x1, y1], [x2, y2]) {
  const box = await dialog.locator("[data-ph-mask-canvas]").boundingBox();
  const at = (x, y) => [box.x + (x / 1200) * box.width, box.y + (y / 600) * box.height];
  await page.mouse.move(...at(x1, y1));
  await page.mouse.down();
  await page.mouse.move(...at((x1 + x2) / 2, (y1 + y2) / 2), { steps: 4 });
  await page.mouse.move(...at(x2, y2), { steps: 4 });
  await page.mouse.up();
}

test("T3-16·T3-19·T3-20·T3-20a 얼굴 가리기: 화면 전체 창에서 네모를 그려 되돌리기·다시 하기, 가린 JPEG만 내려받고(EXIF 없음) 서버로 올리지 않으며 원본 내려받기 단추가 없다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls, dialog, entry } = await openMaskEditor(page);
  const callsBefore = calls.all.length;
  const viewport = page.viewportSize();
  const frame = await dialog.boundingBox();
  expect(Math.round(frame.width)).toBe(viewport.width);
  expect(Math.round(frame.height)).toBe(viewport.height);
  await expect(dialog).toContainText("마우스나 손가락으로 끌어 네모를 그리세요");
  await expect(dialog.locator("button:visible")).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "가려서 내려받기"]);
  await expect(dialog.locator("[data-ph-mask-share]")).toBeHidden();
  await expect(page.getByRole("button", { name: /원본/u })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /원본|내려받기/u })).toHaveCount(0);
  const count = dialog.locator("[data-ph-mask-count]");
  await expect(count).toHaveText("아직 가린 곳이 없습니다");
  await expect(dialog.getByRole("button", { name: "가려서 내려받기" })).toBeDisabled();

  await dragBox(page, dialog, [380, 100], [760, 390]);
  await expect(count).toHaveText("1곳 가림");
  // 포인터를 올려도(휴대폰은 누른 뒤에도 남음) 단추 글자가 바탕과 구분된다(명암비 4.5 이상).
  for (const name of ["그만두기", "되돌리기", "다 지우기", "가려서 내려받기"]) {
    const button = dialog.getByRole("button", { name });
    await button.hover();
    const ratio = await button.evaluate((node) => {
      const parse = (text) => (text.match(/[0-9.]+/gu) ?? []).map(Number);
      const lum = ([r, g, b]) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, index) => sum + v * [0.2126, 0.7152, 0.0722][index], 0);
      const text = parse(getComputedStyle(node).color);
      let back = parse(getComputedStyle(node).backgroundColor);
      if (back.length === 4 && back[3] === 0) back = parse(getComputedStyle(node.closest("dialog")).backgroundColor);
      const [hi, lo] = [lum(text), lum(back)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });
    expect(ratio, `'${name}'에 포인터를 올렸을 때 명암비`).toBeGreaterThanOrEqual(4.5);
  }
  await page.mouse.move(2, 2);
  await dragBox(page, dialog, [900, 450], [902, 452]); // 손가락이 살짝 끌린 것(8px 밑)은 넣지 않음
  await expect(count).toHaveText("1곳 가림");
  await dialog.getByRole("button", { name: "되돌리기" }).click();
  await expect(count).toHaveText("아직 가린 곳이 없습니다");
  await dialog.getByRole("button", { name: "다시 하기" }).click();
  await expect(count).toHaveText("1곳 가림");

  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "가려서 내려받기" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe("photo-masked-20261122.jpg");
  const { readFile } = await import("node:fs/promises");
  const bytes = await readFile(await download.path());
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  expect(jpegSegments(bytes), "EXIF(APP1)·XMP 조각 없음").not.toContain(0xe1);
  await expect(dialog.locator("[data-ph-mask-status]")).toHaveText("✓ photo-masked-20261122.jpg 파일을 만들었습니다. 가린 사본은 이 기기에만 있고, 앱에 보관한 사진은 그대로입니다.");

  // 네모 380×290 → 블록 58, 가로 6칸(칸 폭 약 63). 경계 칸(약 570 ~ 633)은 빨강·파랑이 반쯤 섞이고, 네모 밖은 그대로 빨강이다(JPEG 손실 허용).
  const pixels = await page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const at = (x, y) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
    return { size: [bitmap.width, bitmap.height], inside: at(590, 250), outside: at(300, 250) };
  }, bytes.toString("base64"));
  expect(pixels.size).toEqual([1200, 600]);
  expect(pixels.inside[2] - 51, "네모 안 경계 칸은 파랑이 섞임").toBeGreaterThan(20);
  expect(Math.abs(pixels.outside[0] - 204) + Math.abs(pixels.outside[2] - 51), "네모 밖은 원래 빨강").toBeLessThan(30);

  expect(calls.all.slice(callsBefore), "편집·내려받기는 서버를 부르지 않음(올리기 0건)").toEqual([]);
  expect(calls.all.filter((call) => call === `GET /files/${uuid(301)}/content`), "원본은 크게 보기에서 한 번만 받음").toHaveLength(1);
  expect(fileWrites(calls)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(entry).toBeFocused();
  expect(await page.locator("[data-ph-mask-canvas]").evaluate((node) => [node.width, node.height])).toEqual([0, 0]);
  assertNoErrors();
});

test("얼굴 가리기 큰 사진(4032×3024, 휴대폰 사진 크기): 화면에서 1 ~ 6px 끌린 것은 네모가 아니라 '가려서 내려받기'가 꺼진 채이고, 8px 넘게 끌어야 '1곳 가림'이 된다", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { dialog } = await openMaskEditor(page, { width: 360, photo: [4032, 3024] });
  const shown = await dialog.locator("[data-ph-mask-canvas]").boundingBox();
  expect(4032 / shown.width, "화면 1px이 사진 여러 픽셀(사진 픽셀로 8을 재면 1px 끌림도 네모가 됨)").toBeGreaterThan(8);
  const count = dialog.locator("[data-ph-mask-count]");
  const download = dialog.getByRole("button", { name: "가려서 내려받기" });
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
    await expect(count, `화면 ${pixels}px 끌림`).toHaveText("아직 가린 곳이 없습니다");
    await expect(download, `화면 ${pixels}px 끌림 뒤 내려받기`).toBeDisabled();
  }
  await drag(12);
  await expect(count).toHaveText("1곳 가림");
  await expect(download).toBeEnabled();
  assertNoErrors();
});

test("얼굴 가리기 360px: 공유 창이 사진을 받으면 '가려서 공유'가 보이고 가린 JPEG 파일 하나만 넘기며, 단추는 44px 이상·한 줄, 가로 넘침 없음", async ({ page }) => {
  const assertNoErrors = collectErrors(page);
  const { calls, dialog } = await openMaskEditor(page, { width: 360, share: true });
  const callsBefore = calls.all.length;
  await expect(dialog.locator("button:visible")).toHaveText(["그만두기", "되돌리기", "다시 하기", "다 지우기", "가려서 내려받기", "가려서 공유"]);
  await dragBox(page, dialog, [100, 100], [400, 400]);
  await expectTouchSize(dialog.locator("button:visible"), "얼굴 가리기 창");
  for (const button of await dialog.locator("button:visible").all()) expect(await lineCount(button), await button.textContent()).toBe(1);
  const canvas = await dialog.locator("[data-ph-mask-canvas]").boundingBox();
  const tools = await dialog.locator(".ph-mask__tools").boundingBox();
  expect(canvas.y + canvas.height, "사진이 단추에 가리지 않음").toBeLessThanOrEqual(tools.y + 1);
  await dialog.getByRole("button", { name: "가려서 공유" }).click();
  await expect(dialog.locator("[data-ph-mask-status]")).toHaveText("✓ 가린 사진을 공유 창으로 보냈습니다.");
  const shared = await page.evaluate(() => window.__shared);
  expect(shared).toHaveLength(1);
  expect(shared[0]).toHaveLength(1);
  expect(shared[0][0].slice(0, 2)).toEqual(["photo-masked-20261122.jpg", "image/jpeg"]);
  expect(calls.all.slice(callsBefore)).toEqual([]);
  expect(await overflowOf(page)).toBeLessThanOrEqual(0);
  // 가로로 넓고 낮은 화면(PC·눕힌 휴대폰)에서도 사진 전체가 사진 자리 안에 들어온다(아래가 잘리면 그 자리를 가릴 수 없음).
  for (const [w, h] of [[1280, 720], [800, 480]]) {
    await page.setViewportSize({ width: w, height: h });
    const stage = await dialog.locator(".ph-mask__stage").boundingBox();
    const shown = await dialog.locator("[data-ph-mask-canvas]").boundingBox();
    expect(shown.height, `${w}×${h} 사진 높이`).toBeGreaterThan(40);
    expect(shown.y, `${w}×${h} 사진 위`).toBeGreaterThanOrEqual(stage.y - 1);
    expect(shown.y + shown.height, `${w}×${h} 사진 아래`).toBeLessThanOrEqual(stage.y + stage.height + 1);
    expect(Math.abs(shown.width / shown.height - 2), `${w}×${h} 사진 비율(1200×600)`).toBeLessThan(0.05);
  }
  await dialog.getByRole("button", { name: "그만두기" }).click();
  await expect(dialog).toBeHidden();
  assertNoErrors();
});
