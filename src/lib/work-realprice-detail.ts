// 실거래가 단지 상세 칸(2026-11-25): 거래 줄을 누르면 그 단지의 면적별 최근 거래·숫자 칸·36개월 흐름·최근 거래를 보인다.
// - 1221px 이상(오른쪽 미리보기 칸이 보일 때): 미리보기 칸 자리에 겹쳐 연다(dialog.show(), 미리보기는 inert로 두고 상태는 그대로).
// - 1220px 이하: 화면 전체 칸(dialog.showModal(), 맨 위 층이라 아래 막대·아래 탭을 덮고 뒤를 누를 수 없음).
// 폭은 미리보기 칸이 보이는지(getClientRects)로 가른다(이 화면은 matchMedia를 쓰지 않음, tests/work-realprice-pages.test.mjs).
// 서버 요청은 work-realprice-client.ts의 readWork 한 곳, 서버 값은 textContent·속성으로만 넣고, 받은 자료는 이 화면 메모리에만 둔다(주소·브라우저 저장 없음).
import { readWork, WorkApiError } from "./work-realprice-client";
import { apiErrorText } from "./work/realprice-view.mjs";
import { sparkGeometry } from "./work/realprice-insight-view.mjs";
import {
  COMPLEX_BLOCKED_TEXT,
  COMPLEX_EMPTY_TEXT,
  COMPLEX_ERROR_TEXT,
  COMPLEX_PARTIAL_TEXT,
  areaTab,
  complexCacheKey,
  complexHead,
  complexQuery,
  flowNote,
  flowTicks,
  latestView,
  pickButtonState,
  recentRow,
  statsView,
} from "./work/realprice-complex-view.mjs";

type Series = { ym: string; medianWon: number | null; count: number }[];
export interface ComplexArea {
  areaM2: number;
  tradeCount: number;
  latest: { tradeKey: string; dealDate: string; floor: number | null; priceWon: number | null; dealingGbn: "broker" | "direct" | null; recordHigh: boolean } | null;
  prev: { dealDate: string; floor: number | null; priceWon: number | null } | null;
  prevMaxWon: number | null;
  ratioPct: number | null;
  ratioSkip: string | null;
  recent3m: number;
  typeMaxWon: number | null;
  typeMaxDate: string | null;
  bandM2: number;
  bandMaxWon: number | null;
  bandTypes: number;
  series: Series;
  recent: { tradeKey: string; dealDate: string; floor: number | null; priceWon: number | null; dealingGbn: string | null; cancelled: boolean; recordHigh: boolean }[];
}
export interface ComplexResponse {
  available: boolean;
  reason?: "budget" | "pending";
  complex?: { aptSeq: string; aptName: string | null; umdName: string | null; buildYear: number | null; households: number | null } | null;
  areas?: { areaM2: number; tradeCount: number; lastDealDate: string }[];
  area?: ComplexArea | null;
  warnings: { code: string; level?: string }[];
}
// 목록에서 누른 거래(단지 이름·동네는 자료가 없을 때 머리에 쓰는 값).
export interface DetailSource { tradeKey: string; aptSeq: string; aptName: string | null; umdName: string; areaM2: number }

interface Options {
  dialog: HTMLDialogElement;
  preview: HTMLElement;
  previewShown: () => boolean;
  // 담기 상태(목록 체크칸과 같은 Map). has·count는 지금 값, toggle은 담거나 빼고 결과 글을 돌려준다.
  pick: {
    max: number;
    has: (tradeKey: string) => boolean;
    count: () => number;
    toggle: (data: ComplexResponse, area: ComplexArea) => string;
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_W = 340;
const CHART_H = 132;

export function setupComplexDetail({ dialog, preview, previewShown, pick }: Options) {
  const part = <T extends Element = HTMLElement>(selector: string) => dialog.querySelector<T>(selector) as T;
  const title = part("[data-rt-detail-title]");
  const sub = part("[data-rt-detail-sub]");
  const loading = part("[data-rt-detail-loading]");
  const message = part("[data-rt-detail-msg]");
  const content = part("[data-rt-detail-content]");
  const tabs = part("[data-rt-detail-tabs]");
  const price = part("[data-rt-detail-price]");
  const high = part("[data-rt-detail-high]");
  const meta = part("[data-rt-detail-meta]");
  const prevLine = part("[data-rt-detail-prev]");
  const change = part("[data-rt-detail-change]");
  const stats = part("[data-rt-detail-stats]");
  const chart = part("[data-rt-detail-chart]");
  const ticks = part("[data-rt-detail-ticks]");
  const flowText = part("[data-rt-detail-flow-note]");
  const recent = part("[data-rt-detail-recent]");
  const partial = part("[data-rt-detail-partial]");
  const pickButton = part<HTMLButtonElement>("[data-rt-detail-pick]");
  const pickNote = part("[data-rt-detail-pick-note]");
  const live = part("[data-rt-detail-live]");
  const body = part("[data-rt-detail-body]");
  // 단지·면적마다 받은 응답(이 화면 메모리에만). 같은 단지·면적을 다시 열면 서버를 다시 부르지 않는다.
  const cache = new Map<string, ComplexResponse>();
  let source: DetailSource | null = null;
  let opener: HTMLElement | null = null;
  let current: ComplexResponse | null = null;
  let seq = 0;
  let controller: AbortController | null = null;

  const isOpen = () => dialog.open;
  const modalWanted = () => !previewShown();

  function setState(state: "loading" | "message" | "content", text = "") {
    loading.hidden = state !== "loading";
    message.hidden = state !== "message";
    message.textContent = state === "message" ? text : "";
    content.hidden = state !== "content";
    if (state !== "content") syncPick();
  }

  function head(data: ComplexResponse | null) {
    const view = complexHead(data?.complex ?? null, { aptName: source?.aptName ?? null, umdName: source?.umdName ?? null });
    title.textContent = view.name;
    sub.textContent = view.sub;
    sub.hidden = view.sub === "";
  }

  function chartSvg(series: Series) {
    const geo = sparkGeometry(series, { width: CHART_W, height: CHART_H, padX: 8, padTop: 12, padBottom: 12 });
    if (!geo) return null;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "rt-spark rt-detail__spark");
    svg.setAttribute("viewBox", `0 0 ${CHART_W} ${CHART_H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const shape = (tag: string, attributes: Record<string, string | number>) => {
      const element = document.createElementNS(SVG_NS, tag);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
      svg.append(element);
    };
    for (const y of [12, CHART_H / 2, CHART_H - 12]) shape("line", { class: "rt-detail__grid", x1: 0, x2: CHART_W, y1: y, y2: y });
    shape("path", { class: "rt-spark__area", d: geo.area });
    shape("path", { class: "rt-spark__line", d: geo.line, "vector-effect": "non-scaling-stroke" });
    return svg;
  }

  function renderArea(data: ComplexResponse) {
    const area = data.area as ComplexArea;
    const areas = data.areas ?? [];
    tabs.replaceChildren(...areas.map((item) => {
      const view = areaTab(item);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rt-detail__tab";
      button.dataset.rtDetailArea = String(view.areaM2);
      button.setAttribute("aria-pressed", String(item.areaM2 === area.areaM2));
      const label = document.createElement("b");
      label.textContent = view.label;
      const count = document.createElement("small");
      count.textContent = view.count;
      button.append(label, count);
      return button;
    }));
    const latest = latestView(area);
    price.textContent = latest ? latest.price : "해제 아닌 거래 없음";
    high.hidden = !latest?.high;
    meta.textContent = latest?.meta ?? "";
    prevLine.textContent = latest?.prevLine ?? "";
    change.textContent = latest?.change ?? "";
    change.hidden = !latest?.change;
    stats.replaceChildren(...statsView(area).map((stat) => {
      const box = document.createElement("div");
      box.className = stat.up ? "rt-detail__stat is-up" : "rt-detail__stat";
      box.dataset.rtStat = stat.key;
      const dt = document.createElement("dt");
      dt.textContent = stat.label;
      const dd = document.createElement("dd");
      dd.textContent = stat.value;
      box.append(dt, dd);
      if (stat.note) {
        const note = document.createElement("dd");
        note.className = "rt-detail__note";
        note.textContent = stat.note;
        box.append(note);
      }
      return box;
    }));
    const svg = chartSvg(area.series);
    chart.replaceChildren(...(svg ? [svg] : []));
    chart.hidden = !svg;
    ticks.replaceChildren(...(svg ? flowTicks(area.series).map((tick) => {
      const span = document.createElement("span");
      span.textContent = tick.text;
      return span;
    }) : []));
    ticks.hidden = !svg;
    flowText.textContent = flowNote(area.series);
    recent.replaceChildren(...area.recent.map((item) => {
      const view = recentRow(item, { picked: source?.tradeKey ?? null });
      const li = document.createElement("li");
      li.className = ["rt-detail__row", view.cancelled ? "is-cancelled" : "", view.current ? "is-current" : ""].filter(Boolean).join(" ");
      const date = document.createElement("span");
      date.className = "rt-detail__row-date";
      date.textContent = view.date;
      const floor = document.createElement("span");
      floor.className = "rt-detail__row-floor";
      floor.textContent = view.floor;
      const won = document.createElement("b");
      won.className = "rt-detail__row-price";
      won.textContent = view.price;
      const marks = document.createElement("span");
      marks.className = "rt-detail__row-tags";
      for (const tag of view.tags) {
        const span = document.createElement("span");
        // 신고가 딱지는 목록 딱지(.rt-tag--high)와 이름을 나눠, 목록의 신고가 수를 세는 곳과 섞이지 않게 한다(모양은 같음).
        span.className = tag.key === "high" ? "rt-tag rt-detail__high" : `rt-tag rt-tag--${tag.key}`;
        span.textContent = tag.text;
        marks.append(span);
      }
      if (view.current) {
        const span = document.createElement("span");
        span.className = "rt-tag rt-tag--current";
        span.textContent = "누른 거래";
        marks.append(span);
      }
      li.append(date, floor, won, marks);
      return li;
    }));
    partial.hidden = !data.warnings.some((warning) => warning.code === "RT_COMPLEX_PARTIAL");
    partial.textContent = partial.hidden ? "" : COMPLEX_PARTIAL_TEXT;
    setState("content");
    syncPick();
  }

  function render(data: ComplexResponse) {
    current = data;
    head(data);
    if (!data.available) {
      setState("message", COMPLEX_BLOCKED_TEXT[data.reason ?? "pending"] ?? COMPLEX_ERROR_TEXT);
      return;
    }
    if (!data.area) {
      setState("message", COMPLEX_EMPTY_TEXT);
      return;
    }
    renderArea(data);
  }

  async function load(aptSeq: string, areaM2: number | null, { announce = false } = {}) {
    const query = complexQuery(aptSeq, areaM2);
    if (!query) {
      setState("message", COMPLEX_ERROR_TEXT);
      return;
    }
    const key = complexCacheKey(aptSeq, areaM2);
    const known = cache.get(key);
    controller?.abort();
    const request = ++seq;
    if (known) {
      render(known);
      if (announce) live.textContent = `${title.textContent} 전용 ${areaM2}㎡를 보입니다.`;
      return;
    }
    controller = new AbortController();
    setState("loading");
    try {
      const data = await readWork<ComplexResponse>("/realprice/complex", query, controller.signal);
      if (request !== seq) return;
      // 막힌 응답(조회 한도·채우는 중)은 남기지 않는다(다시 누르면 다시 묻는다).
      if (data.available) {
        cache.set(key, data);
        if (data.area) cache.set(complexCacheKey(aptSeq, data.area.areaM2), data);
      }
      render(data);
      if (announce) live.textContent = `${title.textContent} 전용 ${data.area?.areaM2 ?? areaM2}㎡를 보입니다.`;
    } catch (error) {
      if (request !== seq || (error instanceof DOMException && error.name === "AbortError")) return;
      current = null;
      setState("message", error instanceof WorkApiError && error.code === "RT_READ_BUDGET" ? apiErrorText(error.code, { retryAt: error.retryAt }) : COMPLEX_ERROR_TEXT);
    }
  }

  function syncPick() {
    const area = current?.available ? current.area ?? null : null;
    const latest = area?.latest ?? null;
    const has = latest ? pick.has(latest.tradeKey) : false;
    const state = pickButtonState(latest, { has, count: pick.count(), max: pick.max });
    pickButton.textContent = state.text;
    pickButton.disabled = state.disabled;
    pickButton.setAttribute("aria-pressed", String(has));
    pickNote.textContent = state.note ?? "";
    pickNote.hidden = !state.note;
  }

  // 열린 모양(겹침·전체)이 지금 폭과 다르면 같은 내용으로 다시 연다(창 크기를 바꾼 때).
  function place() {
    if (!isOpen()) return;
    const modal = dialog.matches(":modal");
    if (modal === modalWanted()) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    dialog.close("reflow");
    openDialog();
    focused?.focus();
  }

  function openDialog() {
    dialog.dataset.rtDetailMode = modalWanted() ? "full" : "over";
    if (modalWanted()) {
      preview.inert = false;
      dialog.showModal();
    } else {
      preview.inert = true;
      dialog.show();
    }
  }

  function open(item: DetailSource, from: HTMLElement | null) {
    source = item;
    opener = from;
    current = null;
    head(null);
    if (!isOpen()) openDialog();
    body.scrollTop = 0;
    title.focus();
    void load(item.aptSeq, item.areaM2);
  }

  function close() {
    if (isOpen()) dialog.close();
  }

  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "reflow") {
      dialog.returnValue = "";
      return;
    }
    controller?.abort();
    seq += 1;
    preview.inert = false;
    const back = opener && opener.isConnected ? opener : null;
    opener = null;
    back?.focus();
  });
  // 겹친 칸(모달 아님)은 브라우저가 Esc를 처리하지 않으므로 직접 닫는다. 전체 칸은 cancel 다음 close로 같은 길을 탄다.
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    close();
  });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-rt-detail-close]")) button.addEventListener("click", close);
  tabs.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-rt-detail-area]");
    if (!button || !source || button.getAttribute("aria-pressed") === "true") return;
    void load(source.aptSeq, Number(button.dataset.rtDetailArea), { announce: true });
  });
  pickButton.addEventListener("click", () => {
    const area = current?.available ? current.area ?? null : null;
    if (!current || !area?.latest) return;
    live.textContent = pick.toggle(current, area);
    syncPick();
  });

  return { open, close, place, syncPick, isOpen };
}
