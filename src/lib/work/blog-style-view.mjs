// 글 초안 3단계 '글 성격·만들기'의 화면 계산(2026-11-25 글 성격 21가지·현장 메모 '빠르게 넣기'). 화면 스크립트가 쓰고 시험이 직접 부른다.
// 서버 요청·브라우저 저장·주소 변경을 하지 않는다. 메모 글을 기록하지 않는다.
import { BLOG_STYLES, BLOG_STYLE_GROUPS, EMPHASIS_MAX, allowedStyles } from "./blog-checks.mjs";

const styleOf = (id) => BLOG_STYLES.find((style) => style.id === id);

// 서버가 준 성격 목록(styles: { id, label, note })을 묶음 넷으로 나눈다. off는 이 자료에 쓸 수 없는 성격(잠금).
// 묶음을 모르는 성격은 첫 묶음에 둔다(빠뜨리지 않으려고). 빈 묶음은 내지 않는다.
export function styleGroups(styles, source) {
  const allowed = allowedStyles(source);
  const first = BLOG_STYLE_GROUPS[0].id;
  return BLOG_STYLE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: styles.filter((style) => (styleOf(style.id)?.group ?? first) === group.id)
      .map((style) => ({ id: style.id, label: style.label, off: !allowed.includes(style.id) })),
  })).filter((group) => group.items.length > 0);
}

const hasBatchim = (text) => {
  const code = String(text).charCodeAt(String(text).length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
};
const SOURCE_NAMES = { sale: "매매 매물", jeonse: "전세 매물", "monthly-rent": "월세 매물" };

// 잠긴 성격과 까닭 한 줄. 잠긴 것이 없으면 빈 글자. 예: "전세 안내·월세는 매매 매물이라 잠겼습니다."
export function lockedStylesText(styles, source) {
  const allowed = allowedStyles(source);
  const labels = styles.filter((style) => !allowed.includes(style.id)).map((style) => style.label);
  if (labels.length === 0) return "";
  const joined = labels.join("·");
  const name = source?.type === "complex" ? "단지 소개 글" : SOURCE_NAMES[source?.facts?.tradeType];
  const reason = name ? `${name}이라` : "이 자료의 거래 형태에 맞지 않아";
  return `${joined}${hasBatchim(joined) ? "은" : "는"} ${reason} 잠겼습니다.`;
}

// ── 현장 메모 '빠르게 넣기' ──
// 새 칸을 두지 않고, 단추를 누르면 메모 칸에 머리말("역·교통: ")만 넣는다(사용자 결정 2026-11-25 "추천대로").
const MEMO_HEADS = Object.freeze({
  listing: ["역·교통", "학교", "상권", "수리·상태", "전망·채광"],
  complex: ["역·교통", "학교", "상권", "단지 시설"],
});

// 그 자료·성격에서 보일 머리말 단추. 메모에 사실이 있어야 글이 되는 성격(재건축·재개발·시황·타이밍·경험담)은 그 성격의 머리말을 맨 앞에 더한다.
export function memoQuickHeads(source, styleId) {
  const base = MEMO_HEADS[source?.type === "complex" ? "complex" : "listing"];
  const extra = styleOf(styleId)?.memoHead;
  return extra ? [extra, ...base] : [...base];
}

// 머리말을 메모 끝 새 줄에 넣는다. 돌려주는 값: { value, caret, added, full }.
// 같은 머리말 줄이 이미 있으면 넣지 않고 그 줄 끝을 caret으로 준다. 넣으면 상한(max)을 넘을 때는 넣지 않고 full: true.
export function addMemoHead(value, head, max = EMPHASIS_MAX) {
  const text = String(value ?? "");
  const mark = `${head}:`;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith(mark)) return { value: text, caret: offset + line.length, added: false, full: false };
    offset += line.length + 1;
  }
  const base = text.trimEnd();
  const next = base === "" ? `${mark} ` : `${base}\n${mark} `;
  if (next.length > max) return { value: text, caret: text.length, added: false, full: true };
  return { value: next, caret: next.length, added: true, full: false };
}

// 메모에 사실이 있어야 글이 되는 성격을 골랐는데 메모가 비었을 때의 한 줄(막지 않음). 그 밖에는 빈 글자.
export function memoNeedText(styleId, value) {
  const style = styleOf(styleId);
  if (!style?.memoHead || String(value ?? "").trim() !== "") return "";
  return `'${style.label}' 글은 이 칸에 확인한 사실을 적어야 글이 됩니다. 비워 두면 평범한 소개 글이 됩니다(그대로 만들 수는 있습니다).`;
}

export const MEMO_FULL_TEXT = `머리말을 넣으면 ${EMPHASIS_MAX}자를 넘습니다. 글을 줄인 뒤 다시 눌러 주세요.`;
