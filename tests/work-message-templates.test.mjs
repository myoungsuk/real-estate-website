import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  MESSAGE_TEMPLATES,
  MESSAGE_VARIABLES,
  MESSAGE_VARIANTS,
  buildSmsHref,
  buildWorkMessage,
  countMessageCharacters,
} from "../src/lib/work/message-templates.mjs";

const office = JSON.parse(await readFile(new URL("../src/data/office.json", import.meta.url), "utf8"));
const templateIds = Object.keys(MESSAGE_TEMPLATES);
const variants = Object.keys(MESSAGE_VARIANTS);

test("T0-106 빈 입력이면 자리표시가 보이고 특약 메모 줄은 빠진다", () => {
  assert.deepEqual(templateIds, ["provisional", "agreedDeposit", "contractDay"]);
  for (const templateId of templateIds) {
    for (const variant of variants) {
      const { text } = buildWorkMessage({ templateId, variant, values: {}, office });
      const label = `${templateId}/${variant}`;
      for (const placeholder of ["[물건 표시]", "[거래 종류]", "[거래 금액]", "[계약 예정일]"]) {
        assert.ok(text.includes(placeholder), `${label} ${placeholder}`);
      }
      if (MESSAGE_TEMPLATES[templateId].usesAccount) {
        for (const placeholder of [MESSAGE_TEMPLATES[templateId].depositPlaceholder, "[입금 기한]", "[입금 계좌]"]) {
          assert.ok(text.includes(placeholder), `${label} ${placeholder}`);
        }
      }
      assert.doesNotMatch(text, /특약 메모|메모:/u, `${label} 메모 줄 생략`);
      assert.doesNotMatch(text, /undefined|null|NaN/u, label);
    }
  }
  assert.ok(buildWorkMessage({ templateId: "provisional", values: {}, office }).text.includes("[가계약금]"));
  const withMemo = buildWorkMessage({ templateId: "provisional", values: { specialMemo: "잔금일은 협의" }, office }).text;
  assert.match(withMemo, /- 특약 메모: 잔금일은 협의/u);
});

test("소유자 확인 문장은 기본형·짧은 형 모두 등기사항증명서로 쓴다(운영자 승인 12:13:08)", () => {
  for (const templateId of ["provisional", "agreedDeposit"]) {
    assert.match(buildWorkMessage({ templateId, variant: "basic", values: {}, office }).text, /등기사항증명서의 소유자와 같은지/u);
  }
  assert.match(
    buildWorkMessage({ templateId: "provisional", variant: "short", values: {}, office }).text,
    /입금 전 예금주가 등기사항증명서의 소유자와 같은지 확인해 주세요\./u,
  );
  for (const templateId of templateIds) {
    for (const variant of variants) {
      assert.doesNotMatch(buildWorkMessage({ templateId, variant, values: {}, office }).text, /등기부상/u, `${templateId}/${variant}`);
    }
  }
});

test("짧은 형은 3 ~ 5줄이다", () => {
  for (const templateId of templateIds) {
    const lines = buildWorkMessage({ templateId, variant: "short", values: {}, office }).text.split("\n");
    assert.ok(lines.length >= 3 && lines.length <= 5, `${templateId}: ${lines.length}줄`);
  }
});

test("T0-107 변수 목록에 손님 이름·전화번호·주민등록번호·계좌 비밀번호가 없다", () => {
  for (const name of MESSAGE_VARIABLES) {
    assert.doesNotMatch(name, /name|phone|mobile|tel|resident|rrn|ssn|password|pin|customer|client/iu, name);
  }
  const text = buildWorkMessage({
    templateId: "provisional",
    values: { customerName: "가상 손님 A ZZTEST-7F3A", clientPhone: "01000000001", residentNumber: "900101-1000000", accountPassword: "1234" },
    office,
  }).text;
  assert.doesNotMatch(text, /ZZTEST-7F3A|01000000001|900101-1000000|1234/u);
});

test("T0-108 사무소 이름·전화는 office.json 공개 값과 같다", () => {
  for (const templateId of templateIds) {
    for (const variant of variants) {
      const { text } = buildWorkMessage({ templateId, variant, values: {}, office });
      assert.ok(text.includes(office.brandName), `${templateId}/${variant}`);
      assert.ok(text.includes(office.mobile), `${templateId}/${variant}`);
    }
  }
});

test("T0-109 반환 조건은 자리표시로 남기고 단정하지 않는다", () => {
  for (const templateId of ["provisional", "agreedDeposit"]) {
    for (const variant of variants) {
      const { text } = buildWorkMessage({ templateId, variant, values: {}, office });
      assert.ok(text.includes("[반환 조건 확인]"), `${templateId}/${variant}`);
      assert.doesNotMatch(text, /배액|반환하지 않|돌려드리지|포기/u, `${templateId}/${variant}`);
    }
  }
});

test("T0-110 글자 수는 실제 글자 수와 같고 길어도 막지 않는다", () => {
  const values = {
    property: "가상단지 101동",
    dealType: "sale",
    amountWon: 320_000_000,
    depositAmountWon: 10_000_000,
    depositDeadline: "11월 17일 오후 6시",
    bank: "가상은행",
    accountNumber: "000-00-000000",
    accountHolder: "가상 예금주",
    contractDate: "2026-11-20",
    specialMemo: "가".repeat(300),
  };
  const message = buildWorkMessage({ templateId: "provisional", values, office });
  assert.equal(message.characterCount, [...message.text].length);
  assert.equal(countMessageCharacters("한글😀a"), 4);
  assert.ok(message.characterCount > 300);
  assert.match(message.text, /- 거래 금액: 3억 2,000만 원/u);
  assert.match(message.text, /- 가계약금: 1,000만 원 \(11월 17일 오후 6시까지\)/u);
  assert.match(message.text, /- 입금 계좌: 가상은행 000-00-000000 \(예금주 가상 예금주\)/u);
  assert.match(message.text, /- 본계약 예정일: 2026-11-20\(금\)/u);
});

test("거래 종류별 금액 표기와 계좌 일부만 입력했을 때의 자리표시", () => {
  const monthly = buildWorkMessage({ templateId: "contractDay", values: { dealType: "monthly_rent", amountWon: 10_000_000, monthlyRentWon: 500_000 }, office }).text;
  assert.match(monthly, /보증금 1,000만 원 \/ 월세 50만 원/u);
  const jeonse = buildWorkMessage({ templateId: "contractDay", values: { dealType: "jeonse", amountWon: 200_000_000 }, office }).text;
  assert.match(jeonse, /보증금 2억 원/u);
  const partial = buildWorkMessage({ templateId: "agreedDeposit", values: { bank: "가상은행" }, office }).text;
  assert.match(partial, /가상은행 \[계좌번호\] \(예금주 \[예금주\]\)/u);
  assert.ok(partial.includes("[약정금]"));
});

test("T0-128 문자 앱 주소는 받는 사람을 비우고 본문만 넣는다", () => {
  const text = "가상 안내\n두 번째 줄 & 기호";
  assert.equal(buildSmsHref(text), `sms:?body=${encodeURIComponent(text)}`);
  assert.equal(buildSmsHref(text, "ampersand"), `sms:&body=${encodeURIComponent(text)}`);
  for (const href of [buildSmsHref(text), buildSmsHref(text, "ampersand")]) {
    assert.match(href, /^sms:[?&]body=/u);
    assert.doesNotMatch(href, /^sms:\d/u);
  }
});
