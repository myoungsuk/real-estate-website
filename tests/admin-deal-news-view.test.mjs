// 관리자 '거래 완료 소식' 화면(/admin/deal-news/)의 글 만들기 순수 함수와 화면 원본의 저장 경계 시험. 이름·숫자는 모두 가상이다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  dealNewsBands,
  dealNewsBlockerLines,
  dealNewsCountResult,
  dealNewsDateText,
  dealNewsHitNote,
  dealNewsReadyLine,
  dealNewsTrimName,
  dealNewsUmdOf,
} from "../src/lib/admin-deal-news-view.mjs";
import { dealNewsNameProblem, judgeDealNews } from "../src/lib/admin-deal-news.mjs";

const root = new URL("../", import.meta.url);
const readSource = (path) => readFile(new URL(path, root), "utf8");

test("실거래 이름에서 괄호 안 글을 덜어 채우고, 덜어도 남는 번호 꼴은 검사가 그대로 막는다(검사를 느슨하게 하지 않음)", () => {
  assert.equal(dealNewsTrimName("가상숲1단지(3블록 1203-1)"), "가상숲1단지");
  assert.equal(dealNewsTrimName("가상숲 2단지（123-4）"), "가상숲 2단지");
  assert.equal(dealNewsTrimName("가상(마을(안))숲  3단지"), "가상 숲 3단지");
  assert.equal(dealNewsTrimName("가상숲(닫히지 않음"), "가상숲 닫히지 않음");
  assert.equal(dealNewsTrimName(null), "");
  assert.equal(dealNewsNameProblem(dealNewsTrimName("가상숲1단지(3블록 1203-1)")), null);
  // 괄호 밖의 번호는 덜지 않는다 → 그대로 막혀 화면이 까닭을 보인다.
  assert.match(dealNewsNameProblem(dealNewsTrimName("가상숲 101동(가)")), /동 번호·호수·층/u);
  assert.match(dealNewsNameProblem(dealNewsTrimName("가상숲 1203(가)")), /세 자리 이상 숫자/u);
  assert.match(dealNewsNameProblem(dealNewsTrimName("가상숲 1203-1")), /날짜/u);
});

test("막는 까닭 문장: 60일 조건은 풀리는 날을 함께 적고, 올릴 수 있을 때 한 줄은 매매만 실거래 확인을 덧붙인다", () => {
  const judged = judgeDealNews({ propertyKind: "villa", dealType: "monthly-rent", contractDate: "2026-10-16", today: "2026-11-25", balancePaid: false });
  assert.deepEqual(dealNewsBlockerLines(judged, "2026-11-25"), ["계약일에서 60일이 지난 뒤에 올릴 수 있습니다(12월 16일부터).", "잔금이 끝난 거래만 올릴 수 있습니다."]);
  assert.equal(dealNewsDateText("2027-01-02", "2026-11-25"), "2027년 1월 2일");
  assert.equal(dealNewsDateText("틀림"), "");
  assert.equal(dealNewsReadyLine("sale"), "올릴 수 있습니다. 잔금 끝남 · 계약일에서 60일 지남 · 실거래 자료 확인");
  assert.equal(dealNewsReadyLine("jeonse"), "올릴 수 있습니다. 잔금 끝남 · 계약일에서 60일 지남");
});

test("건수 응답 문장: 3건 이상이면 단지 이름, 적거나 한도에 막히면 동네 이름이고 받지 못한 달을 알린다", () => {
  const basis = { from: "2026-05-25", to: "2026-11-25" };
  const ok = dealNewsCountResult({ available: true, count: 4, basis, coverage: { complete: true, missingMonths: [] } }, { areaBand: 84, dealType: "sale" });
  assert.deepEqual(ok, { tone: "ok", count: 4, text: "최근 6개월(2026. 5. 25. ~ 11. 25.) 같은 단지·전용 84㎡대·매매 4건. 3건 이상이라 단지 이름을 쓸 수 있습니다." });
  const low = dealNewsCountResult({ available: true, count: 2, basis, coverage: { complete: false, missingMonths: ["2026-08"] } }, { areaBand: 59, dealType: "jeonse" });
  assert.equal(low.tone, "area");
  assert.match(low.text, /전세 2건\. 3건보다 적어 동네 이름으로 올립니다\. 아직 받지 못한 달\(2026-08\)이 있어 실제보다 적을 수 있습니다\.$/u);
  const budget = dealNewsCountResult({ available: false, count: null, basis }, { areaBand: 84, dealType: "sale" });
  assert.deepEqual([budget.tone, budget.count], ["area", null]);
});

test("찾기 결과 작은 글과 면적대 목록: 거래 종류별 자료와 고른 종류에 거래가 없음을 알린다", () => {
  const complex = { aptSeq: "30110-1", aptName: "가상숲1단지", umdName: "천동", bands: { sale: [], jeonse: [59], "monthly-rent": [74] } };
  assert.equal(dealNewsHitNote(complex, "jeonse"), "천동 · 전세·월세 자료");
  assert.equal(dealNewsHitNote(complex, "sale"), "천동 · 전세·월세 자료 · 매매 거래 없음");
  assert.deepEqual(dealNewsBands(complex, "monthly-rent"), [74]);
  assert.deepEqual(dealNewsBands(null, "sale"), []);
  assert.equal(dealNewsUmdOf("천동"), "천동");
  assert.equal(dealNewsUmdOf("가상동"), "");
});

test("화면 원본: 계약일·잔금·건수를 저장·주소·브라우저 저장소에 넣지 않고, 서버 요청은 정해 둔 세 곳뿐이며 초안을 만들지 않는다", async () => {
  const page = await readSource("src/pages/admin/deal-news/index.astro");
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|history\.(push|replace)State|location\.(search|hash|href)\s*=|URLSearchParams/u);
  assert.doesNotMatch(page, /status: "draft"\s*[,}]/u, "초안으로 저장하지 않음");
  assert.match(page, /status: "published"/u);
  const layout = await readSource("src/layouts/AdminLayout.astro");
  assert.doesNotMatch(layout.match(/const prerenderPages = \[[^\]]*\]/u)?.[0] ?? "", /deal-news/u, "서버를 부르므로 미리 그리기 목록에 넣지 않음");
  const requests = [...page.matchAll(/readWork<[^>]+>\("([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(requests, ["/realprice/deal-complexes", "/realprice/deal-count"]);
  assert.equal([...page.matchAll(/writeAdminContent\("deal-news"/gu)].length, 1, "저장은 save() 한 곳");
  assert.match(page, /appendDealNews\(resource\.data, \{ \.\.\.state\.item, id: newDealNewsId\(\) \}\)/u);
  // 입력칸 중 이름(name)을 가진 것은 고르기 단추(radio)뿐이다. 글자칸·날짜칸에는 name이 없고 자동 완성을 끈다.
  for (const match of page.matchAll(/<input\b[^>]*>/gu)) {
    const tag = match[0];
    if (/type="radio"/u.test(tag)) continue;
    assert.doesNotMatch(tag, /\sname=/u, tag);
    assert.match(tag, /autocomplete="off"/u, tag);
  }
  // 건물 종류 5개는 600px 이상에서 한 줄(4 + 1로 꺾이지 않음).
  const styles = await readSource("src/styles/admin.css");
  assert.match(styles, /@media \(min-width: 600px\) \{ \.rt-styles\.dn-choices \{ grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: minmax\(0, 1fr\); \} \}/u);
});
