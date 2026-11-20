// 홍보 종이(보드 45번 C) 순수 함수(src/lib/work/promo-paper.mjs)와 사무소 명시사항 한 곳(src/lib/work/ad-disclosure.mjs).
// 운영자 결정 2026-11-20: 거래 완료 알림은 가격·동·층·계약 날짜 없이 면적만 "전용 N㎡대"로 흐리게, 명함은 A안 흰 종이(이메일 있음·직함 없음).
// 단지 이름은 가상 값이고 사무소 정보는 공개 office.json이다.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OFFICE_DISCLOSURE_FIELDS, officeFieldsMissing, officeLines } from "../src/lib/work/ad-disclosure.mjs";
import { PROMO_DISCLOSURE_FIELDS, disclosureLines, disclosureProblems } from "../src/lib/work/realprice-promo.mjs";
import {
  DONE_CARD_SIZE,
  DONE_GUARD,
  areaBandText,
  buildDoneNotice,
  businessCardView,
  cardHoursText,
  doneFileName,
  kakaoLine,
} from "../src/lib/work/promo-paper.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));
const NAME = "가상마을 행복단지";
const good = (extra = {}) => ({ complexName: NAME, dealType: "sale", areaM2: "84.97", ...extra });
const noticeText = (notice) => [notice.title, notice.stamp, notice.name, notice.fact, ...notice.message, notice.guard, notice.phone, ...notice.sub, ...notice.disclosure].join("\n");

test("명시사항은 ad-disclosure 한 곳이고 실거래가 홍보물은 같은 함수를 다시 내보낸다", () => {
  assert.equal(PROMO_DISCLOSURE_FIELDS, OFFICE_DISCLOSURE_FIELDS);
  assert.equal(disclosureProblems, officeFieldsMissing);
  assert.equal(disclosureLines, officeLines);
  assert.deepEqual(OFFICE_DISCLOSURE_FIELDS.map(([key]) => key), ["legalName", "address", "mobile", "registrationNumber", "representative"]);
  assert.deepEqual(officeFieldsMissing(office), []);
  const lines = officeLines(office);
  assert.equal(lines.length, 3);
  for (const [key] of OFFICE_DISCLOSURE_FIELDS) assert.ok(lines.join("\n").includes(office[key]), key);
});

test("면적은 정수로 내리고 '㎡대'를 붙이며 범위·형식이 틀리면 null", () => {
  assert.equal(areaBandText("84.97"), "전용 84㎡대");
  assert.equal(areaBandText("59"), "전용 59㎡대");
  assert.equal(areaBandText(" 10 "), "전용 10㎡대");
  assert.equal(areaBandText("400"), "전용 400㎡대");
  for (const bad of ["", "9.99", "400.01", "84.977", "84,97", "-84", "1e2", "84평", null, undefined]) assert.equal(areaBandText(bad), null, String(bad));
});

test("거래 완료 알림에는 가격·동·층·계약 날짜가 없고 명시사항 5항목이 붙는다", () => {
  for (const [dealType, label] of [["sale", "매매"], ["jeonse", "전세"], ["monthly-rent", "월세"]]) {
    const result = buildDoneNotice(good({ dealType }), office);
    assert.equal(result.ok, true);
    const { notice } = result;
    assert.equal(notice.fact, `전용 84㎡대 · ${label}`);
    assert.equal(notice.guard, DONE_GUARD);
    assert.equal(notice.phone, `상담 ${office.mobile}`);
    assert.deepEqual(notice.sub, ["카카오톡 pf.kakao.com/_nxmabn", "leaderscityhappy.com"]);
    assert.deepEqual(notice.disclosure, officeLines(office));
    // 사무소 주소·번호를 뺀 글에 금액·동·층·날짜 숫자가 없어야 한다.
    const text = noticeText(notice).replace(DONE_GUARD, "");
    const free = text.replaceAll(office.address, "").replaceAll(office.mobile, "").replaceAll(office.registrationNumber, "");
    assert.doesNotMatch(free, /[0-9]+\s*(?:억|만\s*원|원|동(?!구)|층|호|년|월|일)/u, dealType);
    assert.doesNotMatch(free, /20\d\d[.-]/u);
  }
});

test("막는 경우: 사무소 칸 비움·단지 이름·거래 종류·면적", () => {
  assert.equal(buildDoneNotice(good(), { ...office, representative: " " }).error.code, "OFFICE");
  assert.match(buildDoneNotice(good(), { ...office, mobile: "" }).error.message, /연락처/u);
  assert.equal(buildDoneNotice(good({ complexName: "  " }), office).error.code, "NAME");
  assert.equal(buildDoneNotice(good({ complexName: "가".repeat(31) }), office).error.code, "NAME");
  assert.equal(buildDoneNotice(good({ complexName: "가".repeat(30) }), office).ok, true);
  for (const bad of ["행복단지 101동", "행복단지 1203호", "행복단지 15층", "행복단지 010-1234-5678"]) {
    assert.equal(buildDoneNotice(good({ complexName: bad }), office).error.code, "NAME", bad);
  }
  // 동구·4·5블록 같은 지명·단지 이름은 막지 않는다.
  for (const okName of ["대전 동구 행복단지", "리더스시티 5블록", "신흥 SK뷰"]) assert.equal(buildDoneNotice(good({ complexName: okName }), office).ok, true, okName);
  assert.equal(buildDoneNotice(good({ dealType: "lease" }), office).error.code, "DEAL");
  assert.equal(buildDoneNotice(good({ areaM2: "5" }), office).error.code, "AREA");
});

test("그림 크기·파일 이름·카카오톡 줄", () => {
  assert.deepEqual(DONE_CARD_SIZE, { width: 1080, height: 1350 });
  assert.equal(doneFileName("2026-11-20"), "deal-done-20261120.png");
  assert.equal(kakaoLine("https://pf.kakao.com/_nxmabn/chat"), "카카오톡 pf.kakao.com/_nxmabn");
  assert.equal(kakaoLine("https://example.com/x"), "");
  assert.equal(kakaoLine(undefined), "");
});

test("명함: 앞면은 대표·이름·전화·이메일, 직함은 없고 뒷면은 영업시간·상호·주소", () => {
  const view = businessCardView(office);
  assert.equal(view.blocked, null);
  assert.deepEqual(view.front, { role: "대표", name: office.representative, phone: office.mobile, email: office.email });
  assert.equal(cardHoursText(office.hours), "평일 09:00 ~ 20:00 · 토 09:00 ~ 18:00 · 일 예약 상담");
  assert.deepEqual(view.back.rows.map(([label]) => label), ["영업", "상담", "홈"]);
  assert.deepEqual(view.back.legal, [`${office.legalName} · 등록번호 ${office.registrationNumber}`, office.address]);
  const all = JSON.stringify(view);
  assert.doesNotMatch(all, /실장|팀장|이사|소장|공인중개사 대표/u);
  assert.doesNotMatch(all, /평(?!일)/u);
  assert.match(businessCardView({ ...office, address: "" }).blocked, /소재지/u);
  assert.equal(cardHoursText([{ label: "일요일", opens: null, closes: null, note: null }]), "일 휴무");
});
