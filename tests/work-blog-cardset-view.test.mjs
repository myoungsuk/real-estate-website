// 글 초안 1편·3편 고르기(src/lib/work/blog-set-view.mjs)와 카드 AI 배경 그림 칸(src/lib/work/blog-backgrounds-view.mjs)의 화면 계산.
// 2026-11-25 사용자 결정 1 ~ 9(판 1·판 2 "전부 추천대로"). 한도 값은 모두 지어낸 값이다.
import test from "node:test";
import assert from "node:assert/strict";
import * as server from "../worker/work-blog-backgrounds.mjs";
import { BLOG_SET_SIZES as SERVER_SET_SIZES } from "../worker/work-blog.mjs";
import { PROMO_STYLES, PROMO_STYLE_DEFAULT } from "../src/lib/work/realprice-promo.mjs";
import {
  BLOG_SET_CHOICES, BLOG_SET_DEFAULT, BLOG_SET_SIZES, makeCountView, makeWaitText, openSetIds, setProgressView, setTag,
} from "../src/lib/work/blog-set-view.mjs";
import {
  BLOG_AI_MARK, BLOG_CARD_LOOKS, BLOG_CARD_LOOK_DEFAULT, BLOG_IMAGE_COUNT, BLOG_IMAGE_DEFAULT_DESCRIPTION, BLOG_IMAGE_DESCRIPTION_MAX, BLOG_IMAGE_EXAMPLES,
  BLOG_IMAGE_FIXED_TEXT, BLOG_IMAGE_QUALITY_CHOICES, BLOG_IMAGE_QUALITY_DEFAULT, BLOG_IMAGE_SIZE, BLOG_IMAGE_STYLE_CHOICES, BLOG_IMAGE_STYLE_TEXTS,
  backgroundCostView, backgroundDataUrl, backgroundDoneText, backgroundErrorText, descriptionView, promptPreview,
} from "../src/lib/work/blog-backgrounds-view.mjs";

const limits = (todayCreates, daily = 10, monthUsed = 1_000_000, monthly = 20_000_000) => ({
  version: 1, dailyCreateLimit: daily, monthlyCostLimitMicroUsd: monthly,
  defaults: { dailyCreateLimit: 10, monthlyCostLimitMicroUsd: 10_000_000 }, ranges: { daily: [1, 100], monthly: [1_000_000, 100_000_000] },
  usage: { day: "2026-11-25", todayCreates, monthCostMicroUsd: monthUsed },
});

test("TK-208 3편 고르기: 처음 값 3편, 1·3만, 한도 3편 몫과 3편 예상 비용, 남은 편수가 모자라면 막음", () => {
  assert.deepEqual(BLOG_SET_SIZES, SERVER_SET_SIZES);
  assert.equal(BLOG_SET_DEFAULT, 3);
  assert.deepEqual(BLOG_SET_CHOICES.map((item) => item.count), [3, 1]);

  const three = makeCountView(limits(2), 3);
  assert.equal(three.reason, null);
  assert.match(three.line, /^한도 3편 몫을 씁니다 · 오늘 남은 8편 · 예상 비용 약 0\.10 ~ 0\.15달러\(추정, 이번 달 남은 19\.00달러\)$/u);
  const one = makeCountView(limits(2), 1);
  assert.match(one.line, /^한도 1편 몫을 씁니다 · 오늘 남은 8편 · 예상 비용 약 0\.03 ~ 0\.05달러/u);
  // 형식 밖 값은 처음 값(3편)으로 본다.
  assert.match(makeCountView(limits(0), 2).line, /한도 3편 몫/u);

  const short = makeCountView(limits(8), 3);
  assert.match(short.reason, /오늘 남은 편수가 2편이라 3편을 같이 만들 수 없습니다/u);
  assert.equal(makeCountView(limits(8), 1).reason, null);
  assert.match(makeCountView(limits(10), 1).reason, /오늘 10편을 다 써서/u);
  assert.match(makeCountView(limits(0, 10, 20_000_000), 3).reason, /이번 달 비용 상한/u);
  assert.equal(makeCountView({ ...limits(0), dailyCreateLimit: null }, 3).line, "");
  assert.match(makeCountView({ ...limits(0), dailyCreateLimit: null }, 3).reason, /한도를 저장하면/u);
  assert.match(makeWaitText(3), /먼저 끝난 편부터/u);
  assert.equal(makeWaitText(1), "1 ~ 3분 걸립니다.");
});

test("TK-209 3편 진행·이름·취소 대상: 편마다 다 됨·만드는 중·못 만듦, 먼저 끝난 편, 열린 편만 취소", () => {
  const ids = ["a", "b", "c"];
  assert.equal(setTag({ n: 2, of: 3, ids }), "3편 중 2편");
  assert.equal(setTag(null), "");
  assert.equal(setTag({ n: 1, of: 1, ids: ["a"] }), "");

  const done = { id: "b", status: "completed", closed: null, result: { title: "t" } };
  const open = { id: "a", status: "in_progress", closed: null, result: null };
  const failed = { id: "c", status: "failed", closed: null, result: null };
  const view = setProgressView([open, done, failed]);
  assert.equal(view.line, "3편 중 1편 다 됨 · 1편 만드는 중 · 1편 못 만듦");
  assert.deepEqual(view.parts.map((part) => part.text), ["1편 만드는 중", "2편 다 됨", "3편 못 만듦"]);
  assert.equal(view.firstDone, 2);
  assert.equal(view.allSettled, false);
  assert.equal(setProgressView([done, failed, { ...done, id: "x" }]).allSettled, true);
  assert.equal(setProgressView([null, open, open]).firstDone, null);

  assert.deepEqual(openSetIds([open, done, failed, { ...open, id: "d", closed: "cancelled" }, { id: "e", status: "queued", closed: null }]), ["a", "e"]);
});

test("TK-210 AI 배경 그림 칸: 서버와 같은 문장·선택지, 모양 이름은 홍보물과 같음, 설명 200자", () => {
  // 서버 값과 글자까지 같다(화면은 보여 주기만 함).
  assert.equal(BLOG_IMAGE_DEFAULT_DESCRIPTION, server.BLOG_IMAGE_DEFAULT_DESCRIPTION);
  assert.equal(BLOG_IMAGE_FIXED_TEXT, server.BLOG_IMAGE_FIXED_TEXT);
  assert.deepEqual(BLOG_IMAGE_STYLE_TEXTS, { ...server.BLOG_IMAGE_STYLES });
  assert.equal(BLOG_IMAGE_DESCRIPTION_MAX, server.BLOG_IMAGE_DESCRIPTION_MAX);
  assert.equal(BLOG_IMAGE_COUNT, server.BLOG_IMAGE_COUNT);
  assert.deepEqual(BLOG_IMAGE_SIZE, { ...server.BLOG_IMAGE_SIZE });
  assert.deepEqual(BLOG_IMAGE_QUALITY_CHOICES.map((item) => item.value), [...server.BLOG_IMAGE_QUALITIES]);
  assert.equal(promptPreview("", "photo"), server.buildImagePrompt({ description: server.BLOG_IMAGE_DEFAULT_DESCRIPTION, style: "photo" }));
  assert.equal(promptPreview("  벚꽃길  ", "pencil"), server.buildImagePrompt({ description: "벚꽃길", style: "pencil" }));

  // 결정 9: 그림체 4가지, 품질 보통·높음(처음 보통), 둘 다 한도 1편 몫.
  assert.deepEqual(BLOG_IMAGE_STYLE_CHOICES.map((item) => item.label), ["수채화", "사진풍 풍경", "파스텔 일러스트", "색연필 스케치"]);
  assert.equal(BLOG_IMAGE_QUALITY_DEFAULT, "medium");
  assert.ok(BLOG_IMAGE_QUALITY_CHOICES.every((item) => item.note.startsWith("한도 1편 몫")));
  assert.equal(BLOG_IMAGE_EXAMPLES.length, 5);
  assert.ok(BLOG_IMAGE_EXAMPLES.every((text) => [...text].length <= BLOG_IMAGE_DESCRIPTION_MAX));
  // 결정 8: 모양 4가지는 실거래가 홍보물과 같은 이름·같은 처음 값.
  assert.deepEqual(BLOG_CARD_LOOKS, PROMO_STYLES);
  assert.deepEqual(BLOG_CARD_LOOKS.map(([, label]) => label), ["기본", "깔끔 카드", "잡지", "다크"]);
  assert.equal(BLOG_CARD_LOOK_DEFAULT, PROMO_STYLE_DEFAULT);
  assert.equal(BLOG_AI_MARK, "AI 생성 이미지");

  assert.equal(descriptionView("").count, `0 / 200자 · 비우면 기본안 "${BLOG_IMAGE_DEFAULT_DESCRIPTION}"`);
  assert.equal(descriptionView(" 벚꽃 ").count, "2 / 200자");
  assert.equal(descriptionView("가".repeat(200)).too, false);
  assert.equal(descriptionView("가".repeat(201)).too, true);
});

test("TK-211 AI 배경 그림 비용 줄·오류 문장·받은 그림 검사", () => {
  const medium = backgroundCostView(limits(3), "medium");
  assert.equal(medium.reason, null);
  assert.equal(medium.line, "한도 1편 몫 · 오늘 남은 7편 · 3장 약 0.12 ~ 0.16달러(추정, 실제 값은 이번 달 비용에서 뺌 · 이번 달 남은 19.00달러)");
  assert.match(backgroundCostView(limits(3), "high").line, /3장 약 0\.50 ~ 0\.63달러/u);
  assert.match(backgroundCostView(limits(10), "medium").reason, /오늘 만들 수 있는 편수를 다 썼습니다/u);
  assert.match(backgroundCostView(limits(0, 10, 20_000_000), "medium").reason, /이번 달 비용 상한/u);
  assert.match(backgroundCostView(null, "medium").reason, /불러오지 못했습니다/u);

  for (const code of ["IMAGE_CONFIG_MISSING", "AI_IMAGE_REFUSED", "AI_STATE_UNKNOWN", "AI_RESULT_INVALID", "AI_UPSTREAM_FAILED", "VALIDATION_FAILED", "NETWORK"]) {
    assert.ok(backgroundErrorText(code).length > 10, code);
  }
  assert.match(backgroundErrorText("AI_IMAGE_REFUSED"), /비용은 들지 않았습니다/u);
  assert.match(backgroundErrorText("AI_STATE_UNKNOWN"), /비용은 만든 것으로 셉니다/u);
  assert.match(backgroundErrorText("AI_BUDGET_EXCEEDED", ["daily"]), /오늘 만들 수 있는 편수/u);
  assert.match(backgroundErrorText("AI_BUDGET_EXCEEDED", ["monthly"]), /이번 달 AI 비용 상한/u);
  assert.match(backgroundErrorText("AI_RATE_LIMITED"), /잠시 많습니다/u);

  const jpeg = { format: "jpeg", width: 1024, height: 1280, base64: "/9j/4AAQSkZJRgABAQAAAQABAAD" };
  assert.equal(backgroundDataUrl(jpeg), `data:image/jpeg;base64,${jpeg.base64}`);
  assert.equal(backgroundDataUrl({ ...jpeg, format: "png" }), null);
  assert.equal(backgroundDataUrl({ ...jpeg, width: 1024, height: 1024 }), null);
  assert.equal(backgroundDataUrl({ ...jpeg, base64: "iVBORw0KGgoAAAANSUhEUg" }), null);
  assert.equal(backgroundDataUrl({ ...jpeg, base64: "/9j/<script>alert(1)" }), null);
  assert.equal(backgroundDataUrl(null), null);

  assert.match(backgroundDoneText({ costMicroUsd: 140_000, costIsEstimate: false, defaultDescriptionUsed: true }), /비용 0\.14달러\).*기본안/u);
  assert.match(backgroundDoneText({ costMicroUsd: 160_000, costIsEstimate: true, defaultDescriptionUsed: false }), /0\.16달러\(추정\)/u);
});
