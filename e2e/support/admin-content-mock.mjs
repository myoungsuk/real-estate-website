// 사용 안내 그림 찍기(e2e/help-shots/)가 쓰는 가짜 관리 API(/api/admin/v1/*): 세션·공개 JSON 읽기·사전 검증·저장·변경 이력·복원.
// 2026-11-24 사용자 "AI 관련 기능이나 어려워 보이는거만 해 그럼"으로 더한 매물 등록·변경 이력 그림용. 실제 GitHub·Worker는 부르지 않는다.
import { readFileSync } from "node:fs";

export const NOW = new Date("2026-11-24T05:00:00Z"); // 한국 14:00
const hex = (seed, length) => seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
export const envelope = (data, status = 200) => ({ status, json: { ok: true, data, requestId: "test" } });
const failure = (status, code) => ({ status, json: { ok: false, error: { code, message: "시험 오류", retryable: false, details: [] }, requestId: "test" } });
export const readJson = (path) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));

// contents: { 자원 이름: 지금 JSON }. history: { entries, revision }(변경 이력 화면용).
export async function setup(page, { width = 390, contents = {}, history = null } = {}) {
  await page.clock.setFixedTime(NOW);
  await page.setViewportSize({ width, height: 900 });
  const calls = { writes: [], validates: [], restores: [] };
  await page.route("**/api/admin/**", (route) => route.fulfill(failure(503, "TEST_OFFLINE")));
  await page.route("**/api/admin/v1/session", (route) => route.fulfill(envelope({ authenticated: true, administrator: "시험 관리자", authentication: "access", writeEnabled: true, csrfToken: "test-csrf" })));
  await page.route("**/api/admin/v1/content/validate", (route) => {
    const body = route.request().postDataJSON();
    calls.validates.push(body);
    return route.fulfill(envelope({ valid: true, snapshotCommit: hex("5a5b64b0", 40), changedResources: body.changes.map((change) => change.resource), warnings: [] }));
  });
  await page.route("**/api/admin/v1/content/restore", (route) => {
    const body = route.request().postDataJSON();
    calls.restores.push(body);
    return route.fulfill(envelope({ resources: body.resources.map(({ resource }) => ({ resource, contentSha: hex("c0ffee", 40), resourceDigest: hex("d1", 64) })), commitSha: hex("e2e2e2e", 40), baseCommitSha: hex("5a5b64b0", 40), sourceCommit: body.sourceCommit, restoredResources: body.resources.map(({ resource }) => resource), savedAt: NOW.toISOString() }));
  });
  await page.route("**/api/admin/v1/content", (route) => {
    const body = route.request().postDataJSON();
    calls.writes.push(body);
    return route.fulfill(envelope({ resources: body.changes.map(({ resource }) => ({ resource, contentSha: hex("c0ffee", 40), resourceDigest: hex("d1", 64) })), commitSha: hex("e2e2e2e", 40), baseCommitSha: hex("5a5b64b0", 40), savedAt: NOW.toISOString() }));
  });
  await page.route("**/api/admin/v1/content/*", (route) => {
    const resource = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1));
    if (["validate", "restore"].includes(resource)) return route.fallback();
    if (!(resource in contents)) return route.fulfill(failure(404, "NOT_FOUND"));
    return route.fulfill(envelope({ resource, sha: hex("0b1ab5", 40), baseCommitSha: hex("5a5b64b0", 40), data: contents[resource] }));
  });
  if (history) {
    await page.route("**/api/admin/v1/content-history/**", (route) => {
      const parts = new URL(route.request().url()).pathname.split("/").filter(Boolean);
      const tail = parts.at(-1);
      if (parts.at(-2) === "content-history") return route.fulfill(envelope({ resource: tail, entries: history.entries, nextCursor: null }));
      return route.fulfill(envelope(history.revision));
    });
  }
  return calls;
}

// 부동산뱅크 엑셀출력(.xls, EUC-KR HTML 표)을 흉내 낸 파일. 브라우저 TextDecoder("euc-kr")로 읽히도록 Node의 디코더 표를 뒤집어 인코딩한다.
let eucKrTable = null;
function encodeEucKr(text) {
  if (!eucKrTable) {
    eucKrTable = new Map();
    const decoder = new TextDecoder("euc-kr");
    for (let lead = 0x81; lead <= 0xfe; lead += 1) {
      for (let trail = 0x41; trail <= 0xfe; trail += 1) {
        const char = decoder.decode(Uint8Array.of(lead, trail));
        if (char.length === 1 && char !== "�" && !eucKrTable.has(char)) eucKrTable.set(char, [lead, trail]);
      }
    }
  }
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code < 0x80) bytes.push(code);
    else {
      const pair = eucKrTable.get(char);
      if (!pair) throw new Error(`EUC-KR로 바꿀 수 없는 글자: ${char}`);
      bytes.push(...pair);
    }
  }
  return Buffer.from(bytes);
}
export function bankXls(headers, rows) {
  const cell = (value) => `<td>${String(value).replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</td>`;
  const html = `<html><head><meta http-equiv="Content-Type" content="text/html; charset=euc-kr"></head><body><table>`
    + `<tr>${headers.map(cell).join("")}</tr>${rows.map((row) => `<tr>${headers.map((header) => cell(row[header] ?? "")).join("")}</tr>`).join("")}</table></body></html>`;
  return encodeEucKr(html);
}
