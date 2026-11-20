import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateBrokerageFee } from "../src/lib/work/brokerage-fee.mjs";
import {
  RECEIPT_LIMITS,
  RECEIPT_NOT_TAX_NOTICE,
  RECEIPT_PAYER_PLACEHOLDER,
  buildFeeReceipt,
} from "../src/lib/work/fee-receipt.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const legalRules = await readJson("src/data/work/legal-rules.json");
const office = await readJson("src/data/office.json");

const fee = (input) => {
  const result = calculateBrokerageFee({ contractDate: "2026-11-16", propertyKind: "housing", dealType: "sale", priceWon: 300_000_000, depositWon: 300_000_000, vatDisplay: true, ...input }, legalRules);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};
const build = (result, input = {}) => buildFeeReceipt(result, { payer: "홍길동", issuedOn: "2026-11-20", property: "리더스시티5블록 84㎡", ...input }, office);
const rowsOf = (built) => Object.fromEntries(built.receipt.rows);

test("영수증은 계산 결과의 보수·부가세·합계와 사무소 정보를 그대로 쓰고, 세금 서류가 아니라는 문구를 늘 넣는다", () => {
  const result = fee({});
  const built = build(result);
  assert.equal(built.ok, true);
  const rows = rowsOf(built);
  assert.equal(rows["받는 분"], "홍길동");
  assert.equal(rows["발급일"], "2026년 11월 20일");
  assert.equal(rows["물건"], "리더스시티5블록 84㎡ (주택 매매)");
  assert.equal(rows["중개보수"], `${result.feeWon.toLocaleString("ko-KR")}원`);
  assert.equal(rows["부가세(10%)"], `${result.vatWon.toLocaleString("ko-KR")}원`);
  assert.equal(rows["합계"], `${(result.feeWon + result.vatWon).toLocaleString("ko-KR")}원`);
  assert.deepEqual(built.receipt.officeRows.map(([, value]) => value), [office.legalName, office.representative, office.address, office.registrationNumber, office.businessNumber, office.mobile]);
  assert.equal(built.receipt.notice, RECEIPT_NOT_TAX_NOTICE);
  assert.ok(built.receipt.text.endsWith(RECEIPT_NOT_TAX_NOTICE), "문자 글 끝에도 늘 붙음");
  assert.match(built.receipt.text, /위 금액을 중개보수로 받았습니다\./u);
});

test("부가세를 표시하지 않으면 부가세 줄을 빼고 합계는 보수와 같다", () => {
  const result = fee({ vatDisplay: false });
  const rows = rowsOf(build(result));
  assert.equal("부가세(10%)" in rows, false);
  assert.equal(rows["합계"], rows["중개보수"]);
});

test("협의 요율이면 보수 옆에 협의 요율을 적는다", () => {
  const rows = rowsOf(build(fee({ agreedRateBp: 30 })));
  assert.match(rows["중개보수"], /\(협의 요율 0\.30%\)$/u);
});

test("받는 분을 비우면 그림·A4는 손으로 적을 빈칸, 문자 글은 자리 표시로 남긴다", () => {
  const built = build(fee({}), { payer: "  " });
  assert.equal(rowsOf(built)["받는 분"], "");
  assert.match(built.receipt.text, new RegExp(`- 받는 분: ${RECEIPT_PAYER_PLACEHOLDER.replace(/[[\]]/gu, "\\$&")}`, "u"));
});

test("물건 표시를 비우면 물건·거래 종류만 적는다", () => {
  assert.equal(rowsOf(build(fee({ dealType: "jeonse" }), { property: "" }))["물건"], "주택 전세");
});

test("받는 분·물건 칸은 줄바꿈·제어 글자를 지우고 글자 수를 자른다", () => {
  const rows = rowsOf(build(fee({}), { payer: `홍\n길\u0007동${"가".repeat(40)}`, property: "나".repeat(80) }));
  assert.equal(rows["받는 분"].length, RECEIPT_LIMITS.payer);
  assert.doesNotMatch(rows["받는 분"], /[\n\u0007]/u);
  assert.equal(rows["물건"].startsWith("나".repeat(RECEIPT_LIMITS.property)), true);
});

test("주민등록번호·휴대폰 번호처럼 보이는 글자는 영수증을 만들지 않는다", () => {
  for (const [field, value] of [["payer", "홍길동 900101-1234567"], ["payer", "9001011234567"], ["property", "010-1234-5678 연락"], ["property", "01012345678"], ["property", "101동 1203호"], ["property", "1203 호"]]) {
    const built = build(fee({}), { [field]: value });
    assert.equal(built.ok, false, `${field}: ${value}`);
    assert.equal(built.error.code, "PERSONAL_NUMBER");
  }
});

test("계산 결과가 없거나 발급일이 틀리면 만들지 않는다", () => {
  assert.equal(buildFeeReceipt({ ok: false }, {}, office).error.code, "RESULT_MISSING");
  assert.equal(buildFeeReceipt(null, {}, office).error.code, "RESULT_MISSING");
  for (const issuedOn of ["", "2026-02-30", "2026/11/20", undefined]) {
    assert.equal(build(fee({}), { issuedOn }).error.code, "ISSUED_ON_INVALID", String(issuedOn));
  }
});

test("호선·호점 같은 말은 호수로 보지 않는다", () => {
  assert.equal(build(fee({}), { property: "대전 1호선 근처 84㎡" }).ok, true);
});
