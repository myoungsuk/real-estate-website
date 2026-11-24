// 대표 소개 그림 글 묶음(보드 20번, 2026-11-24 사용자 답 "어 그렇게 해" — 소개 01·06·10) 순수 함수 src/lib/work/intro-paper.mjs.
// 사무소 정보는 공개 office.json이다. 입력 칸이 없고 확정 공개 정보와 공개 승인 사진만 쓴다.
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { officeLines } from "../src/lib/work/ad-disclosure.mjs";
import { INTRO_CARD_SIZE, INTRO_COPY, INTRO_PHOTOS, INTRO_SHAPES, INTRO_SHAPE_DEFAULT, buildIntroView, introFileName, shortAddress } from "../src/lib/work/intro-paper.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));

test("대표 소개: 확정 공개 정보와 공개 승인 소개글만 쓴다", () => {
  const built = buildIntroView(office);
  assert.equal(built.ok, true);
  const { view } = built;
  assert.equal(view.brand, office.brandName);
  assert.equal(view.role, "대표", "직함은 확정 공개 정보의 '대표'만");
  assert.equal(view.name, office.representative);
  assert.equal(view.quote, office.introduction[2]);
  assert.equal(view.phone, office.mobile);
  assert.equal(view.place, "리더스시티5블록 근린생활시설 105호");
  assert.equal(view.hours, "평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00 · 일 예약 상담");
  assert.deepEqual(view.disclosure, officeLines(office), "사무소 명시사항 5항목");
  assert.doesNotMatch(JSON.stringify(view), /실장|팀장|소장|이사|최고|1위|유일/u);
});

test("사무소 5항목이 비면 만들지 않는다", () => {
  assert.equal(buildIntroView({ ...office, representative: "" }).ok, false);
  assert.match(buildIntroView({ ...office, address: " " }).error, /소재지/u);
});

test("사진은 저장소에 있는 공개 사진 경로만", async () => {
  const paths = [INTRO_PHOTOS.representative, INTRO_PHOTOS.storefront, ...INTRO_PHOTOS.strip.map(([src]) => src)];
  for (const path of paths) {
    assert.match(path, /^\/images\/(?:office|area)\/[a-z0-9-]+\.webp$/u, path);
    await access(new URL(`../public${path}`, import.meta.url));
  }
});

test("모양·크기·파일 이름·주소 줄이기", () => {
  assert.deepEqual(INTRO_SHAPES.map(([value]) => value), ["white", "green", "photo"]);
  assert.equal(INTRO_SHAPE_DEFAULT, "white");
  assert.deepEqual(Object.keys(INTRO_COPY), ["white", "green", "photo"]);
  assert.deepEqual(INTRO_CARD_SIZE, { width: 1080, height: 1350 });
  assert.equal(introFileName("2026-11-24"), "intro-20261124.png");
  assert.equal(shortAddress("가상시 가상로 1"), "가상시 가상로 1");
  assert.equal(shortAddress(undefined), "");
});
