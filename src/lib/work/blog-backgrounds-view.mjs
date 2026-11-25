// 글 초안 카드 '표지 사진' 칸의 AI 배경 그림 문장(순수 함수). 서버 요청·브라우저 저장 없음.
// 2026-11-25 사용자 결정(판 1 물음 2·3, 판 2 물음 8·9 "전부 추천대로"):
// - AI 그림은 표지 사진 자리에만 넣고 그림 안에는 글자를 넣지 않는다(숫자·이름·명시사항은 코드가 얹음).
// - 한 번 누르면 3장, 품질(보통·높음)과 상관없이 하루 한도 1편 몫 + 실제 값은 월 비용에서 뺀다(worker/work-blog-backgrounds.mjs).
// - 그림체 4가지(수채화·사진풍 풍경·파스텔 일러스트·색연필 스케치), 품질 처음 값 보통.
// - 카드 모양 4가지는 실거래가 홍보물과 같은 이름(PROMO_STYLES)을 쓴다.
// 기본안 문장·고정 문장은 서버 값과 글자까지 같아야 한다(tests/work-blog-backgrounds-view.test.mjs가 봄). 화면은 보여 주기만 하고 서버가 붙인다.
import { PROMO_STYLE_DEFAULT, PROMO_STYLES } from "./realprice-promo.mjs";
import { apiErrorText, usdText } from "./blog-view.mjs";

export const BLOG_IMAGE_DESCRIPTION_MAX = 200; // worker BLOG_IMAGE_DESCRIPTION_MAX
export const BLOG_IMAGE_COUNT = 3; // worker BLOG_IMAGE_COUNT
export const BLOG_IMAGE_SIZE = Object.freeze({ width: 1024, height: 1280 }); // worker BLOG_IMAGE_SIZE
export const BLOG_IMAGE_DEFAULT_DESCRIPTION = "햇살이 드는 조용한 동네 산책로와 나무"; // worker 값과 같음
export const BLOG_IMAGE_FIXED_TEXT = "그림 안에 글자·숫자·로고 없이. 카드 배경으로 쓸 차분한 세로 그림."; // worker 값과 같음
export const BLOG_IMAGE_STYLE_TEXTS = Object.freeze({ // worker BLOG_IMAGE_STYLES와 같음(코드가 그림 설명 뒤에 붙이는 문장)
  watercolor: "수채화. 부드러운 번짐과 맑은 색.",
  photo: "사진처럼 사실적인 자연 풍경. 사람과 건물은 넣지 않음.",
  pastel: "파스텔 톤 일러스트. 단순한 모양과 부드러운 색.",
  pencil: "색연필 스케치. 종이 결이 보이는 손그림.",
});
export const BLOG_IMAGE_STYLE_CHOICES = Object.freeze([
  Object.freeze({ value: "watercolor", label: "수채화", note: "번짐·종이 결" }),
  Object.freeze({ value: "photo", label: "사진풍 풍경", note: "사람·건물 없이" }),
  Object.freeze({ value: "pastel", label: "파스텔 일러스트", note: "평면 색" }),
  Object.freeze({ value: "pencil", label: "색연필 스케치", note: "선과 옅은 색" }),
]);
export const BLOG_IMAGE_STYLE_DEFAULT = "watercolor";
export const BLOG_IMAGE_QUALITY_CHOICES = Object.freeze([
  Object.freeze({ value: "medium", label: "보통", note: "한도 1편 몫" }),
  Object.freeze({ value: "high", label: "높음", note: "한도 1편 몫 · 월 비용 더 듦 · 더 오래 걸림" }),
]);
export const BLOG_IMAGE_QUALITY_DEFAULT = "medium";
export const BLOG_IMAGE_EXAMPLES = Object.freeze(["벚꽃길 산책로, 봄 햇살", "저녁 노을 공원 잔디밭", "맑은 가을 하늘과 단풍길", "눈 내린 겨울 놀이터", "여름 아침 공원 분수"]);
// 3장 예상 값(참고, 추정): OpenAI 가이드 한 장 값(1024×1536·1024×1024) 사이로 본 3장 값. 서버는 자기 최대 예상으로 예약하고 받은 뒤 실제 값으로 바로잡는다.
export const BLOG_IMAGE_COST_HINT = Object.freeze({ medium: "약 0.12 ~ 0.16달러", high: "약 0.50 ~ 0.63달러" });
export const BLOG_AI_MARK = "AI 생성 이미지"; // work-blog-card.ts BLOG_AI_MARK와 같음
export const BLOG_COVER_SOURCES = Object.freeze([
  Object.freeze({ value: "photo", label: "단지 사진" }),
  Object.freeze({ value: "ai", label: "AI 배경 그림" }),
]);
export const BLOG_CARD_LOOKS = PROMO_STYLES; // [["basic","기본"],["clean","깔끔 카드"],["magazine","잡지"],["dark","다크"]]
export const BLOG_CARD_LOOK_DEFAULT = PROMO_STYLE_DEFAULT;

export const BLOG_IMAGE_RULES = Object.freeze([
  "그림에 글자·숫자를 넣지 말라고 코드가 요청 끝에 붙입니다. 그래도 글자가 그려질 수 있으니 고르기 전에 눈으로 봐 주세요.",
  "실제 단지·건물을 그리는 기능이 아닙니다. 표지 사진 자리에만 들어가고, 'AI 생성 이미지' 표시가 늘 붙습니다.",
  "설명은 저장하지 않습니다. 손님 이름·연락처·동·호수는 넣지 마세요.",
]);

export const isImageStyle = (value) => Object.hasOwn(BLOG_IMAGE_STYLE_TEXTS, value);
export const isImageQuality = (value) => value === "medium" || value === "high";
export const isCardLook = (value) => BLOG_CARD_LOOKS.some(([key]) => key === value);

// 설명 칸 글자 수 한 줄. 200자를 넘으면 too가 참(단추를 막음).
export function descriptionView(text) {
  const trimmed = String(text ?? "").trim();
  const length = [...trimmed].length;
  return {
    trimmed,
    count: `${length} / ${BLOG_IMAGE_DESCRIPTION_MAX}자${trimmed ? "" : ` · 비우면 기본안 "${BLOG_IMAGE_DEFAULT_DESCRIPTION}"`}`,
    too: trimmed.length > BLOG_IMAGE_DESCRIPTION_MAX,
  };
}

// '코드가 덧붙이는 고정 문장 보기' 안 글: 고른 그림체로 실제 서버가 보내는 문장 꼴(서버 buildImagePrompt와 같은 순서).
export function promptPreview(description, style) {
  const text = String(description ?? "").trim() || BLOG_IMAGE_DEFAULT_DESCRIPTION;
  return `${text}. ${BLOG_IMAGE_STYLE_TEXTS[isImageStyle(style) ? style : BLOG_IMAGE_STYLE_DEFAULT]} ${BLOG_IMAGE_FIXED_TEXT}`;
}

// 'AI 그림 3장 만들기' 단추 아래 한 줄. limits: GET /work/blog/limits. 돌려주는 값: { line, reason }.
export function backgroundCostView(limits, quality) {
  const hint = BLOG_IMAGE_COST_HINT[isImageQuality(quality) ? quality : BLOG_IMAGE_QUALITY_DEFAULT];
  if (!limits) return { line: "", reason: "AI 사용 한도를 불러오지 못했습니다." };
  const saved = Number.isSafeInteger(limits.dailyCreateLimit) && Number.isSafeInteger(limits.monthlyCostLimitMicroUsd);
  if (!saved) return { line: "", reason: "AI 사용 한도를 저장하면 만들 수 있습니다." };
  const used = limits.usage?.todayCreates ?? 0;
  const left = Math.max(0, limits.dailyCreateLimit - used);
  const monthLeft = Math.max(0, limits.monthlyCostLimitMicroUsd - (limits.usage?.monthCostMicroUsd ?? 0));
  const line = `한도 1편 몫 · 오늘 남은 ${left}편 · 3장 ${hint}(추정, 실제 값은 이번 달 비용에서 뺌 · 이번 달 남은 ${usdText(monthLeft)}달러)`;
  if (left < 1) return { line, reason: "오늘 만들 수 있는 편수를 다 썼습니다. 내일 0시(한국 시각)부터 다시 만들 수 있습니다." };
  if (monthLeft <= 0) return { line, reason: "이번 달 비용 상한에 닿아 만들 수 없습니다. 다음 달 1일(한국 시각)부터 다시 만들 수 있습니다." };
  return { line, reason: null };
}

// 만드는 중 안내(경과 초). 서버가 한 번에 3장을 돌려주므로 장마다 진행은 없다.
export function backgroundProgressText(elapsedMs, quality) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const expect = quality === "high" ? "1 ~ 4분" : "30초 ~ 2분";
  return `그림 3장을 만드는 중입니다(${seconds}초 지남, 보통 ${expect}). 화면을 닫으면 그림을 받지 못하고 비용은 듭니다.`;
}

// 만든 뒤 한 줄.
export function backgroundDoneText(result) {
  const cost = Number.isFinite(result?.costMicroUsd) ? `${usdText(result.costMicroUsd)}달러${result.costIsEstimate ? "(추정)" : ""}` : "알 수 없음";
  const used = result?.defaultDescriptionUsed ? ` 설명이 비어 기본안 "${BLOG_IMAGE_DEFAULT_DESCRIPTION}"으로 그렸습니다.` : "";
  return `그림 3장을 받았습니다(비용 ${cost}). 하나를 고르면 표지 사진 자리에 들어갑니다. 그림은 이 화면에만 있고 닫으면 사라집니다.${used}`;
}

// 오류 문장. 그림 쪽 코드만 여기서, 나머지는 글 초안과 같은 문장(apiErrorText).
export function backgroundErrorText(code, details = []) {
  const texts = {
    IMAGE_CONFIG_MISSING: "그림 모델이나 단가를 알 수 없어 만들지 않았습니다. 비용은 들지 않았습니다. 개발 담당에게 '그림 설정 확인'이라고 알려 주세요.",
    AI_IMAGE_REFUSED: "그림 설명이 OpenAI 안전 기준에 걸려 만들지 않았습니다. 비용은 들지 않았습니다. 설명을 바꿔 다시 해 주세요.",
    AI_STATE_UNKNOWN: "AI가 그림을 만들었는지 확인하지 못했습니다. 비용은 만든 것으로 셉니다. 잠시 뒤 다시 해 주세요.",
    AI_RESULT_INVALID: "AI가 보낸 그림이 정해진 모양(3장·JPEG·1024×1280)이 아니어서 보이지 않습니다. 비용은 들었습니다.",
    AI_UPSTREAM_FAILED: "AI 서비스가 그림을 만들지 못했습니다. 잠시 뒤 다시 해 주세요.",
    VALIDATION_FAILED: `그림 설명은 ${BLOG_IMAGE_DESCRIPTION_MAX}자까지이고 줄바꿈 같은 조절 글자는 넣을 수 없습니다. 그림체·품질도 다시 골라 주세요.`,
    NETWORK: "서버에 닿지 못했습니다. 그림을 만들었는지 알 수 없어 비용이 들었을 수 있습니다. 잠시 뒤 다시 해 주세요.",
  };
  return texts[code] ?? apiErrorText(code, details);
}

// 받은 그림 → 화면이 쓸 data 주소. JPEG·1024×1280이 아니면 null(그 장은 고를 수 없음).
export function backgroundDataUrl(image) {
  if (!image || image.format !== "jpeg" || image.width !== BLOG_IMAGE_SIZE.width || image.height !== BLOG_IMAGE_SIZE.height) return null;
  if (typeof image.base64 !== "string" || image.base64.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(image.base64) || !image.base64.startsWith("/9j/")) return null;
  return `data:image/jpeg;base64,${image.base64}`;
}

// 고른 그림 칸 이름(대체 글).
export const backgroundAlt = (index, style) =>
  `AI 배경 그림 ${index + 1}/${BLOG_IMAGE_COUNT}(${BLOG_IMAGE_STYLE_CHOICES.find((item) => item.value === style)?.label ?? "그림"})`;
