// 종이 만들기 '문구 고치기'(보드 20번 2판, 2026-11-24 사용자 답 "문구도 수정할 수 있게 하면 안되나?") 순수 함수 src/lib/work/paper-copy.mjs.
// 처음 값은 지금 문구이고, 고친 글은 그리기 전에 동·호수(거래 완료는 층·날짜도)·사무소 밖 전화번호·글자 수·빈 칸을 검사한다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { INTRO_COPY, INTRO_SHAPES } from "../src/lib/work/intro-paper.mjs";
import { LISTING_SHAPES, LISTING_SHAPE_COPY } from "../src/lib/work/listing-paper.mjs";
import { checkPaperCopy, copyTextProblem, defaultPaperCopy, paperCopyFields, stampLines } from "../src/lib/work/paper-copy.mjs";
import { STAMP_TEXT, findDateText } from "../src/lib/work/paper-parts.mjs";
import { CARD_AREA_HEADLINE, CARD_AREA_LINE, CARD_SHAPES, DONE_CONSULT, DONE_COPY, DONE_SHAPES, DONE_STAMP, DONE_TITLE, weekdayCloseTag } from "../src/lib/work/promo-paper.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));
const TOOLS = { done: DONE_SHAPES, listing: LISTING_SHAPES, intro: INTRO_SHAPES, card: CARD_SHAPES };

test("문구 고치기: 모든 화면·모양에 칸 묶음이 있고, 처음 문구는 검사를 그대로 통과한다", () => {
  for (const [tool, shapes] of Object.entries(TOOLS)) {
    const fields = paperCopyFields(tool, office);
    assert.deepEqual(Object.keys(fields).sort(), shapes.map(([value]) => value).sort(), tool);
    for (const [shape] of shapes) {
      const defaults = defaultPaperCopy(tool, shape, office);
      const checked = checkPaperCopy(tool, shape, defaults, office);
      assert.equal(checked.ok, true, `${tool}/${shape}: ${checked.error?.message}`);
      assert.deepEqual(checked.copy, defaults);
      for (const item of fields[shape]) {
        assert.ok(item.value.length <= item.max, `${tool}/${shape}/${item.key} 처음 문구가 한도 안`);
        assert.ok(item.label.length > 0 && item.max > 0);
      }
      // 칸 key는 모양 안에서 겹치지 않는다.
      assert.equal(new Set(fields[shape].map((item) => item.key)).size, fields[shape].length);
    }
  }
});

test("문구 고치기: 처음 값은 지금 문구 그대로다(새 글을 지어내지 않음)", () => {
  assert.deepEqual(defaultPaperCopy("done", "basic", office), { title: DONE_TITLE, stamp: DONE_STAMP, consult: DONE_CONSULT });
  assert.deepEqual(defaultPaperCopy("done", "white", office), { head: DONE_COPY.white.head, line1: DONE_COPY.white.lines[0], line2: DONE_COPY.white.lines[1], sub: DONE_COPY.white.sub, stamp1: STAMP_TEXT[0], stamp2: STAMP_TEXT[1] });
  assert.deepEqual(defaultPaperCopy("done", "receipt", office), { head: DONE_COPY.receipt.head, state: DONE_COPY.receipt.state, thanks: DONE_COPY.receipt.thanks, bye: DONE_COPY.receipt.bye, stamp1: "계약", stamp2: "완료" });
  assert.deepEqual(defaultPaperCopy("done", "stamp", office), { line1: DONE_COPY.stamp.lines[0], stamp1: "계약", stamp2: "완료" });
  assert.deepEqual(defaultPaperCopy("listing", "green", office), { head: LISTING_SHAPE_COPY.green, call: LISTING_SHAPE_COPY.call });
  assert.deepEqual(defaultPaperCopy("listing", "night", office), { line: LISTING_SHAPE_COPY.night, tag: weekdayCloseTag(office.hours) });
  assert.equal(defaultPaperCopy("listing", "night", office).tag, "평일 밤 8시까지 상담");
  assert.deepEqual(defaultPaperCopy("listing", "basic", office), {});
  assert.deepEqual(defaultPaperCopy("listing", "photo", office), {});
  for (const [shape] of INTRO_SHAPES) assert.deepEqual(defaultPaperCopy("intro", shape, office), { line: INTRO_COPY[shape] });
  assert.deepEqual(defaultPaperCopy("card", "white", office), { headline: CARD_AREA_HEADLINE, areas: CARD_AREA_LINE });
  assert.deepEqual(defaultPaperCopy("card", "night", office), { tag: "평일 밤 8시까지 상담", headline: CARD_AREA_HEADLINE, areas: CARD_AREA_LINE });
  // 평일 닫는 시각이 없으면 꼬리표 칸을 두지 않는다(그림에도 꼬리표가 없음).
  assert.equal(paperCopyFields("card", { ...office, hours: [] }).night.some((item) => item.key === "tag"), false);
  assert.equal(defaultPaperCopy("listing", "night", { ...office, hours: [] }).tag, "");
});

test("문구 고치기: 고친 글은 다듬어 그대로 쓰고, 빈 optional 칸은 그 줄을 뺀다", () => {
  const checked = checkPaperCopy("done", "white", { head: "  축하합니다  ", line1: "새 집에서\n행복하세요", line2: "", sub: "   " }, office);
  assert.equal(checked.ok, true);
  assert.equal(checked.copy.head, "축하합니다");
  assert.equal(checked.copy.line1, "새 집에서 행복하세요");
  assert.equal(checked.copy.line2, "");
  assert.equal(checked.copy.sub, "");
  // 화면에 없는 칸은 처음 문구, 모르는 key는 무시한다.
  assert.equal(checked.copy.stamp1, "계약");
  assert.equal(Object.hasOwn(checked.copy, "nope"), false);
  assert.deepEqual(checkPaperCopy("done", "white", { nope: "1동" }, office).copy, defaultPaperCopy("done", "white", office));
  assert.deepEqual(stampLines({ stamp1: "축하", stamp2: "" }), ["축하"]);
  assert.deepEqual(stampLines({ stamp1: "계약", stamp2: "완료" }), ["계약", "완료"]);
  // 모르는 모양은 칸이 없어 빈 글 묶음
  assert.deepEqual(checkPaperCopy("done", "zzz", {}, office), { ok: true, copy: {} });
});

test("문구 고치기: 비울 수 없는 칸(제목·도장 첫 줄·영수증 상태·소개 한 줄·명함 뒷면 제목)은 막는다", () => {
  const cases = [["done", "basic", "title"], ["done", "basic", "stamp"], ["done", "white", "head"], ["done", "white", "stamp1"], ["done", "receipt", "state"], ["listing", "green", "head"], ["intro", "photo", "line"], ["card", "sign", "headline"]];
  for (const [tool, shape, key] of cases) {
    const checked = checkPaperCopy(tool, shape, { [key]: "  " }, office);
    assert.equal(checked.ok, false, `${tool}/${shape}/${key}`);
    assert.equal(checked.error.key, key);
    assert.match(checked.error.message, /비울 수 없습니다.*'처음 문구로'/u);
  }
  for (const [tool, shape, key] of [["done", "basic", "consult"], ["done", "receipt", "bye"], ["listing", "night", "tag"], ["listing", "white", "call"], ["card", "night", "tag"], ["card", "white", "areas"]]) {
    assert.equal(checkPaperCopy(tool, shape, { [key]: "" }, office).ok, true, `${tool}/${shape}/${key}`);
  }
});

test("문구 고치기: 칸마다 글자 수 한도를 넘으면 막는다", () => {
  for (const [tool, shapes] of Object.entries(TOOLS)) {
    const fields = paperCopyFields(tool, office);
    for (const [shape] of shapes) {
      for (const item of fields[shape]) {
        assert.equal(checkPaperCopy(tool, shape, { [item.key]: "가".repeat(item.max) }, office).ok, true, `${tool}/${shape}/${item.key} 한도 딱 맞음`);
        const over = checkPaperCopy(tool, shape, { [item.key]: "가".repeat(item.max + 1) }, office);
        assert.equal(over.ok, false, `${tool}/${shape}/${item.key} 한도 넘음`);
        assert.equal(over.error.message, `'${item.label}': ${item.max}자까지 넣을 수 있습니다.`);
      }
    }
  }
  // 도장 글은 한 줄 3자까지(도장 안에 드는 만큼).
  assert.equal(paperCopyFields("done", office).stamp.find((item) => item.key === "stamp1").max, 3);
});

test("문구 고치기: 동 번호·호수는 모든 화면에서, 층·날짜는 거래 완료 알림에서만 막는다", () => {
  for (const tool of Object.keys(TOOLS)) {
    for (const bad of ["101동 이웃께", "1203호 계약", "3 동", "12호"]) assert.equal(copyTextProblem(tool, bad, office), "동 번호·호수는 넣지 않습니다.", `${tool}: ${bad}`);
    // 동구·호선·천동·신흥동처럼 숫자가 붙지 않은 말은 걸리지 않는다.
    for (const ok of ["대전 동구 전역 상담", "1호선 역 가까이", "천동 · 신흥동", "리더스시티 4·5블록"]) assert.equal(copyTextProblem(tool, ok, office), null, `${tool}: ${ok}`);
  }
  assert.equal(copyTextProblem("done", "15층 남향", office), "층은 넣지 않습니다.");
  assert.equal(copyTextProblem("listing", "15층 남향", office), null);
  for (const date of ["11월 계약", "2026년 11월", "2026-11-24", "11/24 잔금", "2026. 11."]) {
    assert.ok(findDateText([date]).length > 0, date);
    assert.equal(copyTextProblem("done", date, office), "날짜는 넣지 않습니다(계약 달이 드러남).", date);
    assert.equal(copyTextProblem("card", date, office), null, date);
  }
  const blocked = checkPaperCopy("done", "receipt", { thanks: "11월에 계약해 주셔서 감사합니다" }, office);
  assert.deepEqual(blocked, { ok: false, error: { key: "thanks", message: "'인사 글': 날짜는 넣지 않습니다(계약 달이 드러남)." } });
});

test("문구 고치기: 사무소 번호가 아닌 전화번호는 막고, 사무소 번호·등록번호는 통과한다", () => {
  for (const tool of Object.keys(TOOLS)) {
    for (const bad of ["010-1234-5678로 연락", "01012345678", "042-123-4567", "02 123 4567", "1588-1234 대표번호", "(042)123-4567"]) {
      assert.equal(copyTextProblem(tool, bad, office), "사무소 번호가 아닌 전화번호는 넣지 않습니다.", `${tool}: ${bad}`);
    }
    for (const ok of [`상담 ${office.mobile}`, office.mobile.replaceAll("-", ""), `등록번호 ${office.registrationNumber}`, `사업자 ${office.businessNumber}`, "평일 밤 8시까지 상담"]) {
      assert.equal(copyTextProblem(tool, ok, office), null, `${tool}: ${ok}`);
    }
  }
  const card = checkPaperCopy("card", "night", { tag: "010 9999 0000" }, office);
  assert.equal(card.ok, false);
  assert.equal(card.error.key, "tag");
});
