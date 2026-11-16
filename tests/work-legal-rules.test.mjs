import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateLegalRules } from "../scripts/content-validation.mjs";

const legalRules = JSON.parse(await readFile(new URL("../src/data/work/legal-rules.json", import.meta.url), "utf8"));
const clone = () => structuredClone(legalRules);

test("법령 데이터 파일은 검증을 통과하고 빌드 전 검사에 포함된다", async () => {
  assert.deepEqual(validateLegalRules(legalRules), []);
  const entry = await readFile(new URL("../scripts/validate-content.mjs", import.meta.url), "utf8");
  assert.match(entry, /src\/data\/work\/legal-rules\.json/u);
  assert.match(entry, /validateLegalRules\(legalRules\)/u);
});

test("T0-120 요율 구간은 0원부터 빈틈·겹침 없이 이어지고 마지막만 null이다", () => {
  for (const group of ["sale", "lease"]) {
    const brackets = legalRules.brokerageFeeRules[0].housing[group];
    assert.equal(brackets[0].minWon, 0);
    brackets.forEach((bracket, index) => {
      if (index > 0) assert.equal(bracket.minWon, brackets[index - 1].maxWonExclusive, `${group}[${index}]`);
      assert.equal(bracket.maxWonExclusive === null, index === brackets.length - 1, `${group}[${index}]`);
    });
  }
  const gap = clone();
  gap.brokerageFeeRules[0].housing.sale[1].minWon = 50_000_001;
  assert.match(validateLegalRules(gap).join("\n"), /빈틈·겹침/u);
  const overlap = clone();
  overlap.brokerageFeeRules[0].housing.lease[2].minWon = 90_000_000;
  assert.match(validateLegalRules(overlap).join("\n"), /빈틈·겹침/u);
  const openMiddle = clone();
  openMiddle.brokerageFeeRules[0].housing.sale[2].maxWonExclusive = null;
  assert.ok(validateLegalRules(openMiddle).length > 0);
});

test("T0-121 bp 값은 모두 정수다", () => {
  const rule = legalRules.brokerageFeeRules[0];
  const rates = [
    ...rule.housing.sale.map((bracket) => bracket.rateBp),
    ...rule.housing.lease.map((bracket) => bracket.rateBp),
    rule.officetel.saleRateBp,
    rule.officetel.leaseRateBp,
    rule.otherMaxRateBp,
  ];
  for (const rate of rates) assert.ok(Number.isSafeInteger(rate), String(rate));
  const fractional = clone();
  fractional.brokerageFeeRules[0].housing.sale[0].rateBp = 0.6;
  assert.match(validateLegalRules(fractional).join("\n"), /rateBp/u);
  const fractionalOfficetel = clone();
  fractionalOfficetel.brokerageFeeRules[0].officetel.saleRateBp = 49.5;
  assert.match(validateLegalRules(fractionalOfficetel).join("\n"), /saleRateBp/u);
});

test("T0-122 모든 규칙에 출처가 있고 루트에 확인일이 있다", () => {
  assert.match(legalRules.checkedAt, /^\d{4}-\d{2}-\d{2}$/u);
  const ruleGroups = [...legalRules.brokerageFeeRules, ...legalRules.deadlineRules, legalRules.screeningRules];
  for (const rule of ruleGroups) {
    assert.ok(Array.isArray(rule.sources) && rule.sources.length > 0, rule.id);
    for (const source of rule.sources) {
      assert.ok(source.title.length > 0, rule.id);
      assert.match(source.version, /제\d+호/u, rule.id);
    }
  }
  const noSources = clone();
  noSources.deadlineRules[0].sources = [];
  assert.match(validateLegalRules(noSources).join("\n"), /법령 출처/u);
  const noDate = clone();
  delete noDate.checkedAt;
  assert.match(validateLegalRules(noDate).join("\n"), /checkedAt/u);
  const badVersion = clone();
  badVersion.screeningRules.sources[0].version = "가상 손님 010-1234-5678";
  assert.match(validateLegalRules(badVersion).join("\n"), /법령 판 표기/u);
});

test("T0-123 개인정보 필드·허용되지 않은 필드·민감 문자열을 넣으면 검증이 실패한다", () => {
  const banned = clone();
  banned.brokerageFeeRules[0].clientPhone = "01000000001";
  const bannedErrors = validateLegalRules(banned).join("\n");
  assert.match(bannedErrors, /clientPhone: 공개 저장 금지 필드/u);
  assert.match(bannedErrors, /허용되지 않은 필드/u);

  const unexpected = clone();
  unexpected.deadlineRules[0].customerName = "가상 손님 A ZZTEST-7F3A";
  assert.match(validateLegalRules(unexpected).join("\n"), /customerName: 허용되지 않은 필드/u);

  const sensitive = clone();
  sensitive.deadlineRules[0].legalText = "문의 010-1234-5678";
  assert.match(validateLegalRules(sensitive).join("\n"), /휴대전화번호/u);

  const residentNumber = clone();
  residentNumber.deadlineRules[1].label = "900101-1000000";
  assert.match(validateLegalRules(residentNumber).join("\n"), /주민등록번호/u);
});

test("기한 규칙은 네 종류가 정확히 하나씩 있다", () => {
  assert.deepEqual(
    legalRules.deadlineRules.map((rule) => [rule.kind, rule.days]),
    [["transactionReport", 30], ["fundingPlanDelivery", 25], ["fundingPlanSeparate", 30], ["leaseReport", 30]],
  );
  const missing = clone();
  missing.deadlineRules = missing.deadlineRules.filter((rule) => rule.kind !== "leaseReport");
  assert.match(validateLegalRules(missing).join("\n"), /leaseReport 규칙이 정확히 1개/u);
});
