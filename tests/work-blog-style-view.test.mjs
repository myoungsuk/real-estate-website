// 글 초안 3단계 '글 성격·만들기'의 화면 계산(src/lib/work/blog-style-view.mjs)과 2026-11-25 글 성격을 늘리며 더한 경고 꼴.
// 자료·메모는 모두 지어낸 값이다.
import test from "node:test";
import assert from "node:assert/strict";
import { BLOG_STYLES, EMPHASIS_MAX, checkBlogDraft } from "../src/lib/work/blog-checks.mjs";
import { MEMO_FULL_TEXT, addMemoHead, lockedStylesText, memoNeedText, memoQuickHeads, styleGroups } from "../src/lib/work/blog-style-view.mjs";

// 서버가 주는 성격 목록(blog/sources 응답의 styles)과 같은 모양.
const styles = BLOG_STYLES.map(({ id, label, note }) => ({ id, label, note }));
const listing = (tradeType) => ({ type: "naver_listing", facts: { tradeType } });
const SALE = listing("sale");
const JEONSE = listing("jeonse");
const MONTHLY = listing("monthly-rent");
const COMPLEX = { type: "complex", facts: {} };

test("TK-177 글 성격 묶음: 묶음 넷에 21가지가 빠짐없이 한 번씩 들고, 잠긴 성격만 off다", () => {
  const groups = styleGroups(styles, SALE);
  assert.deepEqual(groups.map((group) => [group.label, group.items.length]), [["기본·거래 조건", 8], ["누구에게 권할지", 5], ["무엇을 앞에 둘지", 5], ["글 짜임", 3]]);
  assert.deepEqual(groups.flatMap((group) => group.items.map((item) => item.id)), BLOG_STYLES.map((style) => style.id), "차례는 목록 그대로");
  assert.deepEqual(groups.flatMap((group) => group.items).filter((item) => item.off).map((item) => item.label), ["전세 안내", "월세"]);
  assert.deepEqual(styleGroups(styles, COMPLEX).flatMap((group) => group.items).filter((item) => item.off).map((item) => item.label), ["급매", "전세 안내", "월세", "수익형"]);
  // 서버가 모르는 성격을 주어도 빠뜨리지 않고 첫 묶음에 둔다(잠금).
  const extra = styleGroups([...styles, { id: "zz-new", label: "새 성격", note: "" }], SALE);
  assert.deepEqual(extra[0].items.at(-1), { id: "zz-new", label: "새 성격", off: true });
  // 성격이 하나도 없는 묶음은 내지 않는다.
  assert.deepEqual(styleGroups(styles.filter((style) => style.id === "plain"), SALE).map((group) => group.label), ["기본·거래 조건"]);
});

test("TK-178 잠긴 성격 한 줄: 무엇이 왜 잠겼는지 한 문장, 받침에 따라 은·는, 잠긴 것이 없으면 빈 글자", () => {
  assert.equal(lockedStylesText(styles, SALE), "전세 안내·월세는 매매 매물이라 잠겼습니다.");
  assert.equal(lockedStylesText(styles, JEONSE), "급매·월세·수익형·투자·재건축·재개발은 전세 매물이라 잠겼습니다.");
  assert.equal(lockedStylesText(styles, MONTHLY), "급매·전세 안내·수익형·투자·재건축·재개발은 월세 매물이라 잠겼습니다.");
  assert.equal(lockedStylesText(styles, COMPLEX), "급매·전세 안내·월세·수익형은 단지 소개 글이라 잠겼습니다.");
  assert.equal(lockedStylesText(styles.filter((style) => style.id === "plain"), SALE), "");
  assert.equal(lockedStylesText(styles.slice(0, 2), listing("unknown")), "급매는 이 자료의 거래 형태에 맞지 않아 잠겼습니다.");
});

test("TK-179 현장 메모 '빠르게 넣기' 머리말: 매물 5개·단지 소개 4개, 메모에 사실이 있어야 하는 성격은 그 머리말이 맨 앞", () => {
  assert.deepEqual(memoQuickHeads(SALE, "plain"), ["역·교통", "학교", "상권", "수리·상태", "전망·채광"]);
  assert.deepEqual(memoQuickHeads(COMPLEX, "plain"), ["역·교통", "학교", "상권", "단지 시설"]);
  assert.deepEqual(memoQuickHeads(SALE, "redevelop"), ["사업 단계", "역·교통", "학교", "상권", "수리·상태", "전망·채광"]);
  assert.deepEqual(memoQuickHeads(SALE, "market")[0], "최근 거래");
  assert.deepEqual(memoQuickHeads(COMPLEX, "story"), ["직접 본 것", "역·교통", "학교", "상권", "단지 시설"]);
  assert.deepEqual(memoQuickHeads(SALE, "zz-none"), memoQuickHeads(SALE, "plain"), "모르는 성격은 기본 머리말");
  const base = memoQuickHeads(SALE, "plain");
  base.push("바꿈");
  assert.equal(memoQuickHeads(SALE, "plain").length, 5, "돌려준 배열을 바꿔도 다음 값이 그대로");
});

test("TK-180 머리말 넣기: 메모 끝 새 줄에 '머리말: '만 넣고, 이미 있으면 그 줄 끝으로, 넘치면 넣지 않음", () => {
  assert.deepEqual(addMemoHead("", "역·교통"), { value: "역·교통: ", caret: 6, added: true, full: false });
  assert.deepEqual(addMemoHead("욕실을 새로 고침\n\n", "학교"), { value: "욕실을 새로 고침\n학교: ", caret: 14, added: true, full: false }, "끝의 빈 줄은 정리하고 새 줄에 넣음");
  // 같은 머리말 줄이 있으면 글을 바꾸지 않고 그 줄 끝을 알려 준다(이어서 쓰게).
  const twice = addMemoHead("역·교통: 가상역 걸어서 8분\n학교: ", "역·교통");
  assert.deepEqual(twice, { value: "역·교통: 가상역 걸어서 8분\n학교: ", caret: 16, added: false, full: false });
  assert.equal("역·교통: 가상역 걸어서 8분\n학교: ".slice(0, twice.caret), "역·교통: 가상역 걸어서 8분");
  assert.equal(addMemoHead("  상권: 시장", "상권").added, false, "앞에 빈칸이 있어도 같은 줄로 봄");
  assert.equal(addMemoHead("상권이 좋음", "상권").added, true, "머리말 꼴(상권:)이 아닌 글은 다른 줄로 봄");
  // 상한(500자)을 넘으면 넣지 않는다. 화면이 MEMO_FULL_TEXT를 보인다.
  const long = "가".repeat(EMPHASIS_MAX - 5);
  assert.deepEqual(addMemoHead(long, "역·교통"), { value: long, caret: long.length, added: false, full: true });
  const fit = "가".repeat(EMPHASIS_MAX - 7);
  assert.equal(addMemoHead(fit, "역·교통").value.length, EMPHASIS_MAX, "꼭 맞으면 넣음(줄바꿈 1 + 머리말 6)");
  assert.equal(MEMO_FULL_TEXT, "머리말을 넣으면 500자를 넘습니다. 글을 줄인 뒤 다시 눌러 주세요.");
  assert.deepEqual(addMemoHead(null, "학교").value, "학교: ");
});

test("TK-181 메모 알림: 재건축·재개발, 시황·타이밍, 경험담을 고르고 메모가 비었을 때만 한 줄(막지 않음)", () => {
  assert.equal(memoNeedText("story", ""), "'경험담' 글은 이 칸에 확인한 사실을 적어야 글이 됩니다. 비워 두면 평범한 소개 글이 됩니다(그대로 만들 수는 있습니다).");
  assert.ok(memoNeedText("redevelop", "  \n").startsWith("'재건축·재개발' 글은"));
  assert.ok(memoNeedText("market", null).startsWith("'시황·타이밍' 글은"));
  assert.equal(memoNeedText("story", "직접 본 것: 거실 창이 넓음"), "");
  // 2026-11-25: 머리말 단추만 누른 메모는 빈 메모다(단추가 알림을 끄지 않음).
  assert.ok(memoNeedText("story", "직접 본 것: ").startsWith("'경험담' 글은"));
  assert.ok(memoNeedText("market", "최근 거래: \n역·교통: \n학교:").startsWith("'시황·타이밍' 글은"));
  assert.equal(memoNeedText("story", "직접 본 것: \n학교: 가상초등학교가 단지 옆"), "", "한 줄이라도 쓴 글이 있으면 알리지 않음");
  assert.equal(memoNeedText("story", "주차: "), "", "단추에 없는 머리말은 사용자가 쓴 글로 봄");
  for (const style of BLOG_STYLES.filter((item) => item.memoHead)) {
    for (const source of [SALE, COMPLEX]) {
      const pressed = memoQuickHeads(source, style.id).reduce((value, head) => addMemoHead(value, head).value, "");
      assert.notEqual(memoNeedText(style.id, pressed), "", `${style.id}: 보이는 단추를 모두 누르기만 한 메모(${pressed.split("\n").length}줄)`);
    }
  }
  for (const style of BLOG_STYLES.filter((item) => !item.memoHead)) assert.equal(memoNeedText(style.id, ""), "", style.id);
  assert.equal(memoNeedText("zz-none", ""), "");
});

test("TK-182 지어낸 후기·손님 사례·수익 약속을 더 잡는다(경고, 복사는 됨). 묻고 답하기 글·권하는 글·중개사가 본 것은 잡지 않는다", () => {
  const source = { type: "naver_listing", id: "zz", facts: { tradeType: "sale", title: "가상숲1단지" } };
  const kinds = (text) => {
    const checks = checkBlogDraft({ title: "제목", paragraphs: [text], hashtags: [], snsShort: "짧은 글" }, { source, inputs: {} });
    assert.deepEqual(checks.blocks, [], `막지는 않음: ${text}`);
    return checks.warnings.map((item) => item.kind).filter((kind) => ["review", "persona", "hype"].includes(kind));
  };
  // 지어낸 손님 말
  for (const text of ["손님들이 채광에 만족하셨습니다", "입주민분들도 조용하다고 칭찬이 많습니다", "\"거실이 정말 넓네요\"라고 하셨습니다", "“살기 편해요”라는 반응입니다", "별점 다섯 개", "평점 4.8"]) assert.ok(kinds(text).includes("review"), text);
  // 지어낸 손님 사례
  for (const text of ["어느 손님이 바로 계약하셨습니다", "한 부부가 둘러보고 갔습니다", "30대 신혼 부부가 골랐습니다", "지난주 40대 고객분이 보고 가셨습니다"]) assert.ok(kinds(text).includes("persona"), text);
  // 수익·가격을 약속하는 말
  for (const text of ["확정 수익을 드립니다", "안전 마진이 있습니다", "부동산 불패", "곧 폭등합니다", "마지막 기회입니다", "놓치면 후회합니다", "연 5.5% 수익", "월 수익이 나옵니다", "상승 여력이 큽니다", "값이 더 오를 자리입니다", "시세가 오를 곳"]) assert.ok(kinds(text).includes("hype"), text);
  // 잡지 않는 글
  for (const text of [
    "\"주차는 넉넉한가요?\"라고 묻는 분이 많습니다",
    "30대 고객분들께 맞는 집입니다",
    "편한 손님이 되어 주세요",
    "신혼부부가 처음 마련하기 좋은 집입니다",
    "제가 직접 가 보니 거실 창이 넓었습니다",
    "연 2회 정기 소독을 합니다",
    "오르막이 없는 평지입니다",
  ]) assert.deepEqual(kinds(text), [], text);
});
