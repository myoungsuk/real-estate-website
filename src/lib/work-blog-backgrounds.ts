// 글 초안 '카드 그림' 칸 위쪽의 고르기(카드 모양·표지 사진·AI 배경 그림). 2026-11-25 사용자 결정 2·3·7·8·9(판 1·판 2 "전부 추천대로").
// - 카드 모양 4가지는 실거래가 홍보물과 같은 이름(기본·깔끔 카드·잡지·다크), 처음 기본.
// - 표지 사진: 단지 사진(처음) 또는 AI 배경 그림. AI 그림은 'AI 그림 3장 만들기'(POST /work/blog/backgrounds)로 3장을 받아 하나를 고른다.
//   그림은 이 화면 메모리(data 주소)에만 두고 서버·브라우저 저장소·화면 주소에 넣지 않는다. blob 주소를 쓰지 않는다.
// - 매물 초안 표지에는 사진 자리가 없어 '표지 사진' 고르기를 보이지 않는다(모양만 고름).
// 글·숫자는 src/lib/work/blog-backgrounds-view.mjs 순수 함수, 서버 요청은 work-blog-client.ts 한 곳.
import { WorkApiError, createBlogBackgrounds, type BlogImageQuality, type BlogImageStyle, type BlogLimits } from "./work-blog-client";
import {
  BLOG_CARD_LOOKS,
  BLOG_CARD_LOOK_DEFAULT,
  BLOG_COVER_SOURCES,
  BLOG_IMAGE_DESCRIPTION_MAX,
  BLOG_IMAGE_EXAMPLES,
  BLOG_IMAGE_QUALITY_CHOICES,
  BLOG_IMAGE_QUALITY_DEFAULT,
  BLOG_IMAGE_RULES,
  BLOG_IMAGE_STYLE_CHOICES,
  BLOG_IMAGE_STYLE_DEFAULT,
  backgroundAlt,
  backgroundCostView,
  backgroundDataUrl,
  backgroundDoneText,
  backgroundErrorText,
  backgroundProgressText,
  descriptionView,
  promptPreview,
} from "./work/blog-backgrounds-view.mjs";
import type { BlogCardLook } from "./work-blog-card";

export type CardOptionsState = { look: BlogCardLook; coverImage: string | null; key: string };
type Deps = {
  limits: () => BlogLimits | null;
  // 그림을 만든 뒤(성공·실패 모두) 한도·사용량을 다시 받는다.
  refreshLimits: () => void;
  // 모양·표지 그림이 바뀌면 카드를 다시 그린다.
  changed: () => void;
};

let uid = 0;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
// work-segment 라디오 묶음(기존 .bl-seg 모양). note가 있으면 글 아래 작은 글.
function segment(legend: string, name: string, items: readonly { value: string; label: string; note?: string }[], checked: string, cols: number) {
  const box = el("fieldset", "bl-opt");
  box.append(el("legend", "bl-opt__legend", legend));
  const seg = el("div", `work-segment bl-seg${items.some((item) => item.note) ? " bl-seg--noted" : ""}`);
  seg.dataset.cols = String(cols);
  const inputs = items.map((item) => {
    const label = el("label", "work-choice");
    const input = el("input");
    input.type = "radio";
    input.name = name;
    input.value = item.value;
    input.autocomplete = "off";
    input.checked = item.value === checked;
    const text = el("span", "", item.label);
    label.append(input, text);
    if (item.note) label.append(el("small", "bl-seg__note", item.note));
    seg.append(label);
    return input;
  });
  box.append(seg);
  return { box, inputs, value: () => inputs.find((input) => input.checked)?.value ?? checked };
}

export function createBlogCardOptions(root: HTMLElement, deps: Deps) {
  const id = `bl-bg-${++uid}`;
  const look = segment("카드 모양", `${id}-look`, BLOG_CARD_LOOKS.map(([value, label]) => ({ value, label })), BLOG_CARD_LOOK_DEFAULT, 4);
  const source = segment("표지 사진", `${id}-source`, BLOG_COVER_SOURCES, "photo", 2);
  const panel = el("div", "bl-bg");
  panel.hidden = true;
  const style = segment("그림체", `${id}-style`, BLOG_IMAGE_STYLE_CHOICES, BLOG_IMAGE_STYLE_DEFAULT, 4);
  const quality = segment("품질", `${id}-quality`, BLOG_IMAGE_QUALITY_CHOICES, BLOG_IMAGE_QUALITY_DEFAULT, 2);

  const descBox = el("div", "bl-bg__desc");
  const descLabel = el("label", "bl-opt__legend", "그림 설명(선택)");
  descLabel.htmlFor = `${id}-desc`;
  const desc = el("textarea");
  desc.id = `${id}-desc`;
  desc.rows = 2;
  desc.maxLength = BLOG_IMAGE_DESCRIPTION_MAX;
  desc.autocomplete = "off";
  desc.placeholder = "예: 벚꽃길 산책로, 봄 햇살";
  const descCount = el("small");
  descCount.id = `${id}-desc-count`;
  desc.setAttribute("aria-describedby", descCount.id);
  const examples = el("div", "bl-quick");
  examples.setAttribute("role", "group");
  const examplesLabel = el("span", "bl-quick__label", "예시 넣기");
  examplesLabel.id = `${id}-examples`;
  examples.setAttribute("aria-labelledby", examplesLabel.id);
  const examplesList = el("div", "bl-quick__list");
  for (const text of BLOG_IMAGE_EXAMPLES) {
    const button = el("button", "bl-quick__chip", text);
    button.type = "button";
    button.addEventListener("click", () => {
      desc.value = text;
      renderDesc();
      desc.focus();
    });
    examplesList.append(button);
  }
  examples.append(examplesLabel, examplesList);
  descBox.append(descLabel, examples, desc, descCount);

  const rules = el("ul", "bl-bg__rules");
  rules.append(...BLOG_IMAGE_RULES.map((text) => el("li", "", text)));
  const fixed = el("details", "bl-fold bl-bg__fixed");
  const fixedText = el("p", "bl-soft");
  fixed.append(el("summary", "", "코드가 덧붙이는 고정 문장 보기"), el("p", "bl-soft", "서버가 그림 설명 뒤에 아래 문장을 붙여 보냅니다(바꿀 수 없음)."), fixedText);
  const alert = el("p", "admin-inline-notice bl-alert");
  alert.setAttribute("role", "alert");
  alert.tabIndex = -1;
  alert.hidden = true;
  const make = el("button", "work-secondary-button bl-bg__make", "AI 그림 3장 만들기");
  make.type = "button";
  const cost = el("p", "bl-make__note");
  const progress = el("p", "bl-bg__progress");
  progress.setAttribute("role", "status");
  const list = el("ul", "bl-bg__list");
  list.setAttribute("aria-label", "받은 AI 배경 그림 3장");
  panel.append(style.box, quality.box, descBox, rules, fixed, make, cost, alert, progress, list);
  const listingNote = el("p", "bl-soft", "매물 표지에는 사진 자리가 없어 모양만 고릅니다.");
  listingNote.hidden = true;
  root.replaceChildren(look.box, source.box, listingNote, panel);

  // 받은 그림(data 주소)과 고른 칸. 화면 메모리에만 있다.
  let images: { src: string; style: BlogImageStyle }[] = [];
  let chosen: number | null = null;
  let busy = false;
  let seq = 0;
  let started = 0;
  let tickTimer = 0;
  let kind: "complex" | "listing" | null = null;

  function setAlert(text: string) {
    alert.replaceChildren();
    if (text) alert.append(el("span", "", "!"), el("span", "", text));
    alert.firstElementChild?.setAttribute("aria-hidden", "true");
    alert.hidden = !text;
  }
  function renderDesc() {
    const view = descriptionView(desc.value);
    descCount.textContent = view.count;
    fixedText.textContent = promptPreview(desc.value, style.value());
    renderMake();
  }
  function renderMake() {
    const view = backgroundCostView(deps.limits(), quality.value());
    const tooLong = descriptionView(desc.value).too;
    make.disabled = busy || Boolean(view.reason) || tooLong;
    cost.textContent = view.reason ?? view.line;
    cost.classList.toggle("is-blocked", !busy && Boolean(view.reason));
  }
  function renderList() {
    list.replaceChildren(...[0, 1, 2].map((index) => {
      const li = el("li");
      const image = images[index];
      if (!image) {
        const slot = el("span", "bl-bg__slot", busy ? `${index + 1}장 그리는 중` : `${index + 1}장`);
        li.append(slot);
        return li;
      }
      const label = el("label", "bl-bg__pick");
      const input = el("input");
      input.type = "radio";
      input.name = `${id}-pick`;
      input.value = String(index);
      input.checked = chosen === index;
      input.addEventListener("change", () => {
        chosen = index;
        deps.changed();
      });
      const img = el("img");
      img.src = image.src;
      img.alt = backgroundAlt(index, image.style);
      img.width = 1024;
      img.height = 1280;
      label.append(input, img, el("span", "", `${index + 1}장 고르기`));
      li.append(label);
      return li;
    }));
    list.hidden = !busy && images.length === 0;
  }
  function renderSource() {
    const complex = kind === "complex";
    source.box.hidden = !complex;
    listingNote.hidden = kind !== "listing";
    panel.hidden = !complex || source.value() !== "ai";
  }

  for (const input of look.inputs) input.addEventListener("change", () => deps.changed());
  for (const input of source.inputs) input.addEventListener("change", () => {
    renderSource();
    deps.changed();
  });
  for (const input of quality.inputs) input.addEventListener("change", renderMake);
  for (const input of style.inputs) input.addEventListener("change", renderDesc);
  desc.addEventListener("input", renderDesc);

  make.addEventListener("click", async () => {
    if (busy) return;
    const view = descriptionView(desc.value);
    if (view.too) return;
    busy = true;
    setAlert("");
    const mySeq = ++seq;
    const chosenStyle = style.value() as BlogImageStyle;
    const chosenQuality = quality.value() as BlogImageQuality;
    started = Date.now();
    const tick = () => { progress.textContent = backgroundProgressText(Date.now() - started, chosenQuality); };
    tick();
    window.clearInterval(tickTimer);
    tickTimer = window.setInterval(tick, 1000);
    renderMake();
    renderList();
    try {
      const result = await createBlogBackgrounds({ description: view.trimmed, style: chosenStyle, quality: chosenQuality });
      if (mySeq !== seq) return;
      const next = result.images.map((image) => backgroundDataUrl(image));
      if (next.length !== 3 || next.some((src) => !src)) throw new WorkApiError("invalid", { code: "AI_RESULT_INVALID" });
      images = next.map((src) => ({ src: src as string, style: chosenStyle }));
      chosen = null;
      progress.textContent = backgroundDoneText(result);
      deps.changed();
    } catch (error) {
      if (mySeq !== seq) return;
      const code = error instanceof WorkApiError ? error.code : null;
      const details = error instanceof WorkApiError ? error.details : [];
      progress.textContent = "";
      setAlert(backgroundErrorText(code ?? "NETWORK", details));
      alert.focus();
    } finally {
      if (mySeq === seq) {
        busy = false;
        window.clearInterval(tickTimer);
        renderMake();
        renderList();
        deps.refreshLimits();
      }
    }
  });

  renderDesc();
  renderSource();
  renderList();

  return {
    // 지금 고른 모양·표지 그림. key는 카드를 다시 그릴지 가르는 값(그림 자체를 넣지 않음).
    state(): CardOptionsState {
      const lookValue = look.value() as BlogCardLook;
      const useAi = kind === "complex" && source.value() === "ai" && chosen !== null && images[chosen];
      return { look: lookValue, coverImage: useAi ? images[chosen as number].src : null, key: `${lookValue}|${useAi ? `ai${seq}:${chosen}` : "photo"}` };
    },
    // 초안 종류가 바뀔 때(단지 소개·매물·없음).
    setKind(next: "complex" | "listing" | null) {
      kind = next;
      renderSource();
    },
    // 한도가 바뀌었을 때 비용 줄만 다시 쓴다.
    renderLimits: renderMake,
    // 화면을 처음으로 돌릴 때: 받은 그림을 지우고 처음 값으로.
    clear() {
      seq += 1;
      busy = false;
      window.clearInterval(tickTimer);
      images = [];
      chosen = null;
      progress.textContent = "";
      setAlert("");
      for (const input of source.inputs) input.checked = input.value === "photo";
      renderSource();
      renderMake();
      renderList();
    },
  };
}
