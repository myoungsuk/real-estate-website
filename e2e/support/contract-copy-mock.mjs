// 손님 카드 거래 칸 '계약서 사본' 시험(e2e/admin-contract-copy.spec.mjs)과 사용 안내 그림 찍기(e2e/help-shots/)가 함께 쓰는 가짜 업무 API.
// 2026-11-24 시험 파일에서 그대로 옮김(사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄"). 실제 서버·D1·R2는 부르지 않는다.
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";

export const NOW = new Date("2026-11-23T01:40:00Z"); // 한국 11월 23일(월) 10:40
export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const CUSTOMER_ID = uuid(1);
export const DEAL_A = uuid(101);
export const DEAL_B = uuid(102);
export const DETAIL = `/admin/work/customers/detail/?id=${CUSTOMER_ID}`;
export const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
export const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false }, requestId: "test" } });
export const FAIL_STATUS = { FILE_STORAGE_FAILED: 503, FILE_LIMIT_REACHED: 409, MASK_CONFIRMATION_REQUIRED: 400 };
export const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
export const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export const copy = (n, dealId, createdAt) => ({ id: uuid(400 + n), kind: "contract_copy", mimeType: "image/jpeg", byteSize: 1_800_000, caption: "", dealId, createdAt });
// copiesA: 손님 카드가 보여 주는 거래 A의 사본 수. hidden: 다른 화면에서 올려 이 화면은 아직 모르는 사본 수(10장 넘음 시험).
export function makeStore({ copiesA = 2, hidden = 0 } = {}) {
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
export const dealsOf = (store) => [
  { id: DEAL_A, title: "가상숲1단지 84㎡ 매매", dealType: "sale", status: "contracted", role: "buyer", version: 2, updatedAt: "2026-11-18T01:00:00.000Z", events: [], files: store.copies.get(DEAL_A).map((file) => ({ ...file })) },
  { id: DEAL_B, title: "가상강변마을 59㎡ 전세", dealType: "jeonse", status: "open", role: "tenant", version: 1, updatedAt: "2026-11-17T01:00:00.000Z", events: [], files: store.copies.get(DEAL_B).map((file) => ({ ...file })) },
];

// failUploads: POST /files 응답을 차례로 정한다(null은 정상). 다 쓰면 정상. 서버 규칙(거래 주인·가림 확인 표시·10장·미리보기 거부)은 worker/work-files.mjs를 따른다.
// aiEnabled: 업무 세션의 aiEnabled(켜면 AI 상자가 묶음 목록·비용 미리 보기를 부른다. 묶음은 늘 0개).
export async function setup(page, { width = 390, filesEnabled = true, store = makeStore(), failUploads = [], aiEnabled = false } = {}) {
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
      return route.fulfill(envelope({ pages, requests: 1, estimatedCostMicroUsd: 280_000 * pages, dailyCreateLimit: 20, todayCreates: 0, remainingCreates: 20, monthlyCostLimitMicroUsd: 10_000_000, monthCostMicroUsd: 0, remainingCostMicroUsd: 10_000_000, allowed: true, blockedBy: null }));
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

export async function pickWith(page, trigger, files) {
  const chooserPromise = page.waitForEvent("filechooser");
  await trigger.click();
  const chooser = await chooserPromise;
  await chooser.setFiles(files);
  return chooser;
}
export async function openDetail(page) {
  await page.goto(DETAIL);
  await expect(page.locator("[data-kc-toggle]").first()).toBeVisible();
}
export const blockOf = (page, dealId) => ({
  toggle: page.locator(`[data-kc-toggle="${dealId}"]`),
  panel: page.locator(`[data-kc-panel="${dealId}"]`),
  status: page.locator(`[data-kc-panel="${dealId}"] > .admin-form-status`),
  rows: page.locator(`[data-kc-panel="${dealId}"] > ul > li`),
});
export const maskOf = (page) => {
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
export async function dragOn(page, canvas, [x1, y1], [x2, y2]) {
  const box = await canvas.boundingBox();
  const at = (x, y) => [box.x + x * box.width, box.y + y * box.height];
  await page.mouse.move(...at(x1, y1));
  await page.mouse.down();
  await page.mouse.move(...at((x1 + x2) / 2, (y1 + y2) / 2), { steps: 4 });
  await page.mouse.move(...at(x2, y2), { steps: 4 });
  await page.mouse.up();
}
