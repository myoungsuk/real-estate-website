// 종이 만들기 공용 부품 순수 함수(src/lib/work/paper-parts.mjs, 보드 20번).
// 명시사항 표 글씨는 지금 매물 안내지 비교표의 가장 작은 글씨(25px × 0.8 = 20px)보다 작아지지 않아야 한다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DISCLOSURE_MIN_PX,
  DISCLOSURE_START_PX,
  OFFICE_FOOT_PX,
  contractBars,
  findDateText,
  corkSpecks,
  fitSteps,
  normalizeRows,
  rotatedBounds,
  seededRandom,
  splitCommonRows,
  tableColumns,
} from "../src/lib/work/paper-parts.mjs";

test("명시사항 표 글씨는 25px에서 20px까지만 줄인다", () => {
  assert.deepEqual(fitSteps(), [25, 24, 23, 22, 21, 20]);
  assert.equal(DISCLOSURE_START_PX, 25);
  assert.equal(DISCLOSURE_MIN_PX, 20);
  assert.ok(fitSteps().every((px) => px >= DISCLOSURE_MIN_PX));
  assert.deepEqual(fitSteps(20, 20), [20]);
});

test("가장 작은 글씨는 지금 매물 안내지 비교표의 가장 작은 글씨와 같다", async () => {
  const card = await readFile(new URL("../src/lib/work-listing-card.ts", import.meta.url), "utf8");
  assert.match(card, /Math\.round\(25 \* s\)/u, "비교표 값 글씨 25px × 비율");
  assert.match(card, /for \(const s of \[1, 0\.95, 0\.9, 0\.85, 0\.8\]\)/u, "가장 작은 비율 0.8");
  assert.equal(DISCLOSURE_MIN_PX, Math.round(25 * 0.8));
  assert.match(card, /const FOOT_PX = 28;/u);
  assert.equal(OFFICE_FOOT_PX, 28, "사무소 아래 칸 글씨도 매물 안내지와 같게");
});

test("매물 1건 줄은 값 1칸짜리 줄이 된다", () => {
  assert.deepEqual(normalizeRows([{ key: "moveIn", label: "입주 가능일", value: "즉시 입주" }]), [{ key: "moveIn", label: "입주 가능일", values: ["즉시 입주"] }]);
  assert.deepEqual(normalizeRows([{ label: "관리비" }]), [{ key: "", label: "관리비", values: ["—"] }]);
  assert.deepEqual(normalizeRows(undefined), []);
});

test("여러 건 표에서 다 같은 값인 줄만 한 줄로 합친다(가격·매물번호·빈 값은 합치지 않음)", () => {
  const rows = [
    { key: "price", label: "가격", values: ["3억 원", "3억 원"] },
    { key: "area", label: "면적", values: ["전용 84.97㎡", "전용 59.98㎡"] },
    { key: "location", label: "소재지", values: ["대전광역시 동구 샘플동", "대전광역시 동구 샘플동"] },
    { key: "parking", label: "주차", values: ["—", "—"] },
    { key: "id", label: "매물번호", values: ["1", "1"] },
  ];
  const { common, rows: rest } = splitCommonRows(rows);
  assert.deepEqual(common, [{ key: "location", label: "소재지", value: "대전광역시 동구 샘플동" }]);
  assert.deepEqual(rest.map((row) => row.key), ["price", "area", "parking", "id"]);
});

test("매물 1건 표는 합치지 않는다", () => {
  const { common, rows } = splitCommonRows([{ key: "location", label: "소재지", value: "대전광역시 동구 샘플동" }]);
  assert.deepEqual(common, []);
  assert.equal(rows.length, 1);
});

test("표 칸 나누기: 이름 칸 22%(최소 150px), 나머지는 같게", () => {
  assert.deepEqual(tableColumns(952, 3), { labelW: 209, colW: (952 - 209) / 3, n: 3 });
  assert.equal(tableColumns(500, 1).labelW, 150);
  assert.equal(tableColumns(952, 0).n, 1);
});

test("씨앗이 같으면 같은 수열, 다르면 다른 수열", () => {
  const a = seededRandom(42);
  const b = seededRandom(42);
  const c = seededRandom(43);
  const listA = [a(), a(), a()];
  assert.deepEqual(listA, [b(), b(), b()]);
  assert.notDeepEqual(listA, [c(), c(), c()]);
  assert.ok(listA.every((value) => value >= 0 && value < 1));
});

test("코르크 점: 같은 씨앗이면 같은 그림, 넓이에 비례한 개수, 모두 칸 안", () => {
  const one = corkSpecks(1080, 1350, 5);
  assert.deepEqual(one, corkSpecks(1080, 1350, 5));
  assert.equal(one.length, Math.round((1080 * 1350) / 10000 * 18));
  assert.ok(one.every((s) => s.x >= 0 && s.x < 1080 && s.y >= 0 && s.y < 1350 && s.shade >= 0 && s.shade <= 2));
  assert.equal(corkSpecks(0, 100, 1).length, 0);
});

test("돌린 네모의 바깥 네모", () => {
  assert.deepEqual(rotatedBounds(0, 0, 100, 50, 0), { x: 0, y: 0, w: 100, h: 50 });
  const r = rotatedBounds(0, 0, 100, 50, 90);
  assert.ok(Math.abs(r.w - 50) < 1e-9 && Math.abs(r.h - 100) < 1e-9);
  assert.ok(Math.abs(r.x - 25) < 1e-9 && Math.abs(r.y + 25) < 1e-9);
  const t = rotatedBounds(600, 500, 420, 470, 6);
  assert.ok(t.w > 420 && t.h > 470, "기울이면 바깥 네모가 커짐");
});

test("계약서 회색 줄 길이는 씨앗마다 늘 같고 55 ~ 100%", () => {
  assert.deepEqual(contractBars(7), contractBars(7));
  assert.ok(contractBars(7).every((ratio) => ratio >= 0.55 && ratio <= 1));
  assert.equal(contractBars(7, 3).length, 3);
});

test("그리기 부품은 서버·브라우저 저장소를 쓰지 않는다", async () => {
  for (const file of ["../src/lib/work-paper-parts.ts", "../src/lib/work/paper-parts.mjs", "../src/lib/work-done-shapes.ts", "../src/lib/work-listing-shapes.ts", "../src/lib/work-intro-card.ts", "../src/lib/work/intro-paper.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest|navigator\.sendBeacon/u, file);
  }
});

test("거래 완료 글의 날짜 모양을 찾는다(전화번호·면적·가격·등록번호는 날짜가 아님)", () => {
  assert.deepEqual(findDateText(["2026년 11월 24일 화요일"]), ["2026년 11월 24일"]);
  assert.deepEqual(findDateText(["리더스시티 행복한부동산 · 2026. 11."]), ["2026. 11."]);
  assert.deepEqual(findDateText(["11월에 계약"]), ["11월"]);
  assert.deepEqual(findDateText(["2026-11-24", "11/24 잔금"]), ["2026-11-24", "11/24"]);
  assert.deepEqual(findDateText([
    "샘플마을 5단지 매매 계약을 마쳤습니다.",
    "전용 84㎡대 · 매매",
    "4억 1,500만 원",
    "상담 010-2790-8675",
    "리더스시티행복한공인중개사사무소 · 대표 백진옥",
    "대전광역시 동구 안샘로14번길 7, 리더스시티5블록 근린생활시설 105호",
    "연락처 010-2790-8675 · 등록번호 30110-2023-00028",
    "평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00",
  ]), []);
});
