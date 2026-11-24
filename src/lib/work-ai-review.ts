// 계약서 AI 결과 고르기 화면(/admin/work/ai/review/?id=, 단계 4 B안). 서버 요청은 work-ai-client.ts 한 곳, 글·규칙은 work/contract-ai-view.mjs.
// - 열 때 업무 세션 → 묶음(결과, 감사 ai.view) → 거래(감사 deal.view)를 한 번씩만 읽는다. 409 뒤 '다시 불러오기'를 누를 때만 다시 읽는다.
// - 비교는 서버와 같은 함수(contract-compare.mjs)로 한다.
//   한 번 읽기 묶음(작업 1개, 2026-11-24부터): 칸마다 AI 값 하나를 보이고, AI가 읽은 칸은 사람이 사진과 견줘 [AI 값]·[지금 값 그대로]·[직접 넣기] 가운데 고른다(미리 골라 두지 않음).
//   표·카드 위 [모두 AI 값으로]는 그대로 넣을 수 있는 칸을 한 번에 AI 값으로 고른다(누를 때만, 다음 단계로 저절로 넘기지 않음).
//   옛 두 번 읽기 묶음(작업 2개): 같은 칸은 넣을 값으로 두고, 다름·한쪽만 칸은 사람이 [1회 값]·[2회 값]·[지금 값 그대로]·[직접 넣기] 가운데 고른다.
//   (시안의 '없음'은 '지금 값 그대로'로 바꿨다. 거래 칸을 실수로 비우지 않게.)
// - '거래에 넣기 전 확인'은 지금 값 → 넣을 값과, 서버와 같은 계산 함수로 만든 일정 미리 보기를 보인다. '거래에 넣기'는 POST confirm 한 번이고 자동으로 다시 보내지 않는다.
// - 근거는 원문 글(evidence.quote)이 먼저이고, 사진 위 상자는 참고다. 사진은 같은 출처 <img>(사본 원본, 감사 file.download)로만 보이고 blob: 주소를 쓰지 않는다.
// - 계약서 글·금액·날짜는 화면 메모리에만 둔다(주소·제목·브라우저 저장소 없음).
import legalRules from "../data/work/legal-rules.json";
import { WorkApiError, getCustomerSession } from "./work-customers-client";
import type { DealEvent } from "./work-customers-client";
import { element, setStatus } from "./work-customers-dom";
import { confirmAiGroup, readAiDeal, readAiGroup, type AiConfirmResult, type AiDeal, type AiDealDetail, type AiGroupView, type AiJob } from "./work-ai-client";
import { fileContentUrl } from "./work-files-client";
import {
  AI_CHANGE_TEXT,
  AI_COPY_TRASHED_TEXT,
  AI_DEAL_CLOSED_TEXT,
  AI_DISABLED_TEXT,
  AI_FIELD_LABELS,
  AI_INTO_LABELS,
  AI_STATUS_TEXT,
  aiCanApply,
  aiCompareJobs,
  aiConfirmBody,
  aiConfirmErrorText,
  aiDateText,
  aiEmptyStatus,
  aiEvidenceOf,
  aiHalfText,
  aiInitialChoices,
  aiIntoRows,
  aiJobErrorText,
  aiManualProblem,
  aiPendingFields,
  aiPickAllAi,
  aiPickAllText,
  aiReviewParams,
  aiSchedulePreview,
  aiShortDate,
  aiSingleRead,
  aiSummary,
  aiValueText,
} from "./work/contract-ai-view.mjs";
import { CONFIRM_MIDDLE_PAYMENTS_MAX } from "./work/contract-compare.mjs";
import { contractCodeWarningKind } from "./work/contract-extract.mjs";
import { DEAL_TYPE_LABELS, customerErrorText, customerHref, customerSaveErrorText } from "./work/customers-view.mjs";
import { formatWon } from "./work/work-format.mjs";
import { photoShortAtText } from "./work/photo-view.mjs";

type Kind = "first" | "second" | "keep" | "manual" | "same";
interface Choice { kind: Kind; value: unknown }
interface Item { field: string; status: string; first: unknown; second: unknown }
interface Comparison { fields: Item[]; reference: Item[] }
type Step = "compare" | "confirm" | "done";

const codeOf = (error: unknown) => (error instanceof WorkApiError ? error.code : null);
const detailsOf = (error: unknown) => (error instanceof WorkApiError ? error.details : []);
const MONEY = new Set(["priceWon", "depositWon", "monthlyRentWon"]);

export function mountAiReview(page: HTMLElement) {
  const pick = <T extends HTMLElement>(selector: string) => {
    const node = page.querySelector<T>(selector);
    if (!node) throw new Error(`missing ${selector}`);
    return node;
  };
  const boot = pick("[data-axr-boot]");
  const state = pick("[data-axr-state]");
  const main = pick("[data-axr-main]");
  const title = pick("[data-axr-title]");
  const sub = pick("[data-axr-sub]");
  const back = pick<HTMLAnchorElement>("[data-axr-back]");
  const backText = pick("[data-axr-back-text]");
  const photoBox = pick("[data-axr-photo]");
  const body = pick("[data-axr-body]");
  const foot = pick("[data-axr-foot]");
  const footText = pick("[data-axr-foot-text]");
  const next = pick<HTMLButtonElement>("[data-axr-next]");
  const backStep = pick<HTMLButtonElement>("[data-axr-back-step]");
  const status = pick("[data-axr-status]");
  const reloadButton = element("button", "work-secondary-button axr-reload", "다시 불러오기");
  reloadButton.type = "button";
  reloadButton.hidden = true;
  reloadButton.dataset.axrReload = "";
  status.after(reloadButton);
  // '모두 AI 값으로'를 누른 뒤 한 줄. 다시 그려도 같은 마디를 단추 옆에 옮겨 붙여 글이 이어진다.
  const pickAllStatus = element("p", "admin-form-status axr-status");
  pickAllStatus.setAttribute("role", "status");
  pickAllStatus.setAttribute("aria-live", "polite");
  pickAllStatus.dataset.axrPickAllStatus = "";

  const tableMq = window.matchMedia("(min-width: 1221px)");
  const photoMq = window.matchMedia("(min-width: 980px)");

  let groupId: string | null = null;
  let from: string | null = null;
  let filesEnabled = false;
  let view: AiGroupView | null = null;
  let detail: AiDealDetail | null = null;
  let comparison: Comparison | null = null;
  let choices: Record<string, Choice> = {};
  // '모두 AI 값으로'가 덮은 직접 넣기 값. 그 칸의 '직접 넣기'를 다시 누르면 한 번 되살린다(화면 메모리에만).
  let manualDrafts: Record<string, unknown> = {};
  let step: Step = "compare";
  let focusField: string | null = null;
  let photoOpen = false;
  let photoPage = 1;
  let busy = false;
  let blocked = false;
  let badFields: string[] = [];
  let done: AiConfirmResult | null = null;
  const images = new Map<number, HTMLImageElement>();

  const jobOf = (runIndex: number): AiJob | undefined => view?.jobs.find((job) => job.runIndex === runIndex);
  const resultOf = (runIndex: number) => jobOf(runIndex)?.result ?? null;
  const fileIds = () => view?.group.fileIds ?? [];
  // 한 번 읽기 묶음(작업 1개)이면 참. 옛 두 번 읽기 묶음은 비교표 그대로 보인다.
  const single = () => aiSingleRead(view?.jobs ?? []);

  // ── 불러오기 ──

  function showState(heading: string, text: string, retry = false) {
    boot.hidden = true;
    main.hidden = true;
    sub.hidden = true;
    state.hidden = false;
    pick("[data-axr-state-title]").textContent = heading;
    pick("[data-axr-state-body]").textContent = text;
    pick("[data-axr-state-retry]").hidden = !retry;
  }

  async function load(keepChoices: boolean) {
    if (!groupId) return;
    const nextView = await readAiGroup(groupId);
    const group = nextView.group;
    if (group.status === "running") throw Object.assign(new Error("running"), { state: ["아직 읽는 중입니다", "손님 카드의 'AI로 일정 뽑기' 칸에서 결과가 나올 때까지 기다려 주세요."] });
    if (group.status === "confirmed") throw Object.assign(new Error("confirmed"), { state: ["이미 거래에 넣은 결과입니다", `${photoShortAtText(group.confirmedAt ?? "")}에 거래에 넣었습니다. 손님 카드에서 일정을 확인하세요.`] });
    if (group.status === "cancelled") throw Object.assign(new Error("cancelled"), { state: ["버린 결과입니다", "이 결과는 버렸습니다. 다시 뽑으려면 손님 카드의 계약서 사본 칸에서 시작하세요."] });
    if (group.status === "failed") {
      const reason = aiSingleRead(nextView.jobs)
        ? aiJobErrorText(nextView.jobs[0].errorCode)
        : nextView.jobs.map((job) => `${job.runIndex}회: ${aiJobErrorText(job.errorCode)}`).join(" ");
      throw Object.assign(new Error("failed"), { state: ["결과를 받지 못했습니다", reason] });
    }
    if (!group.dealId) throw Object.assign(new Error("trashed"), { state: ["거래에 넣을 수 없습니다", AI_COPY_TRASHED_TEXT] });
    const nextDetail = await readAiDeal(group.dealId);
    if (["completed", "cancelled"].includes(nextDetail.deal.status)) throw Object.assign(new Error("closed"), { state: ["거래에 넣을 수 없습니다", AI_DEAL_CLOSED_TEXT] });
    view = nextView;
    detail = nextDetail;
    comparison = aiCompareJobs(nextView.jobs, nextDetail.deal.dealType) as Comparison;
    const initial = aiInitialChoices(comparison) as Record<string, Choice>;
    if (keepChoices) {
      const kept: Record<string, Choice> = {};
      for (const item of comparison.fields) kept[item.field] = choices[item.field] ?? initial[item.field];
      choices = Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined));
    } else {
      choices = initial;
      manualDrafts = {};
      setStatus(pickAllStatus, "", "idle");
      const pending = aiPendingFields(comparison, choices);
      focusField = pending[0] ?? null;
    }
  }

  async function start() {
    state.hidden = true;
    main.hidden = true;
    boot.hidden = false;
    ({ id: groupId, from } = aiReviewParams(location.search));
    back.href = from ? customerHref(from) : "/admin/work/customers/";
    pick<HTMLAnchorElement>("[data-axr-state-back]").href = back.href;
    if (!groupId) {
      showState("주소가 맞지 않습니다", "손님 카드의 계약서 사본 칸에서 '결과 보고 고르기'를 눌러 다시 들어와 주세요.");
      return;
    }
    try {
      const session = await getCustomerSession({ refresh: true });
      if (!session.enabled || session.aiEnabled !== true) {
        showState("AI 일정 뽑기가 꺼져 있습니다", `${AI_DISABLED_TEXT} 켜지면 손님 카드에서 시작합니다.`);
        return;
      }
      filesEnabled = session.filesEnabled;
      await load(false);
    } catch (error) {
      const known = (error as { state?: [string, string] }).state;
      if (known) showState(known[0], known[1]);
      else if (codeOf(error) === "AI_DISABLED") showState("AI 일정 뽑기가 꺼져 있습니다", `${AI_DISABLED_TEXT} 켜지면 손님 카드에서 시작합니다.`);
      else if (codeOf(error) === "NOT_FOUND") showState("결과를 찾지 못했습니다", "지웠거나 주소가 틀렸을 수 있습니다. 손님 카드에서 다시 들어와 주세요.");
      else showState("불러오지 못했습니다", customerErrorText(codeOf(error)), true);
      return;
    }
    boot.hidden = true;
    main.hidden = false;
    step = "compare";
    renderHead();
    render();
  }

  // ── 위쪽 ──

  function renderHead() {
    if (!detail || !view) return;
    const party = detail.parties.find((item) => item.customerId === from) ?? detail.parties[0];
    if (!from && party) back.href = customerHref(party.customerId);
    backText.textContent = party ? `${party.displayName} 손님 카드` : "손님 목록";
    const type = DEAL_TYPE_LABELS[detail.deal.dealType as keyof typeof DEAL_TYPE_LABELS] ?? detail.deal.dealType;
    sub.textContent = `${detail.deal.title} · ${type} · 사본 ${fileIds().length || "?"}장 · ${photoShortAtText(view.group.createdAt)} 결과`;
    sub.hidden = false;
  }

  // ── 고르기 ──

  function choose(field: string, choice: Choice) {
    choices[field] = choice;
    focusField = field;
    badFields = [];
    render(`chip-${field}-${choice.kind}`);
  }

  function currentText(field: string) {
    if (!detail) return "";
    const deal = detail.deal;
    const value = field === "middlePayments" ? deal.middlePaymentOn : (deal as unknown as Record<string, unknown>)[{ contractDate: "contractOn", balanceDate: "balanceOn" }[field] ?? field];
    if (value === null || value === undefined) return "비어 있음";
    return MONEY.has(field) ? formatWon(value as number) : String(value);
  }

  function chipText(field: string, value: unknown) {
    if (field === "middlePayments") return (value as string[]).join(" · ");
    if (MONEY.has(field)) return formatWon(value as number);
    return String(value);
  }

  function chooser(item: Item) {
    const box = element("div", "ax-choose");
    box.setAttribute("role", "radiogroup");
    box.setAttribute("aria-label", `${AI_FIELD_LABELS[item.field as keyof typeof AI_FIELD_LABELS]} 고르기`);
    const current = choices[item.field];
    const chip = (kind: Kind, text: string, value: unknown, extra = "") => {
      const node = element("button", `ax-chip${extra}${current?.kind === kind ? " is-on" : ""}`, text);
      node.type = "button";
      node.setAttribute("role", "radio");
      node.setAttribute("aria-checked", String(current?.kind === kind));
      node.dataset.axKey = `chip-${item.field}-${kind}`;
      node.dataset.axrChip = `${item.field}:${kind}`;
      node.addEventListener("click", () => choose(item.field, { kind, value: kind === "manual" ? manualStart(item) : value }));
      return node;
    };
    const long = item.field === "middlePayments" ? " ax-chip--long" : "";
    if (aiCanApply(item.field, item.first)) box.append(chip("first", `${chipText(item.field, item.first)} (${single() ? "AI" : "1회"})`, item.first, long));
    if (aiCanApply(item.field, item.second)) box.append(chip("second", `${chipText(item.field, item.second)} (2회)`, item.second, long));
    box.append(chip("keep", `지금 값 그대로(${currentText(item.field)})`, null));
    box.append(chip("manual", "직접 넣기", null, " ax-chip--plain"));
    const wrap = element("div", "axr-choose");
    wrap.append(box);
    if (current?.kind === "manual") wrap.append(manualEditor(item));
    return wrap;
  }

  function manualStart(item: Item): unknown {
    const existing = choices[item.field];
    if (existing?.kind === "manual") return existing.value;
    if (Object.hasOwn(manualDrafts, item.field)) {
      const draft = manualDrafts[item.field];
      delete manualDrafts[item.field];
      return Array.isArray(draft) ? [...draft] : draft;
    }
    const ai = [item.first, item.second].find((value) => value !== null && value !== undefined && !(Array.isArray(value) && value.length === 0));
    if (item.field === "middlePayments") return Array.isArray(ai) ? (ai as (string | null)[]).map((date) => date ?? "") : [""];
    if (MONEY.has(item.field)) return typeof ai === "number" ? ai : null;
    return typeof ai === "string" ? ai : "";
  }

  function manualEditor(item: Item) {
    const field = item.field;
    const editor = element("div", "axr-manual");
    const label = AI_FIELD_LABELS[field as keyof typeof AI_FIELD_LABELS];
    const problem = element("p", "axr-problem");
    problem.dataset.axrProblem = field;
    const showProblem = () => {
      const text = aiManualProblem(field, choices[field]?.value);
      problem.textContent = text ?? "";
      problem.hidden = !text;
      renderFoot();
    };
    const setValue = (value: unknown) => {
      choices[field] = { kind: "manual", value };
      badFields = [];
      showProblem();
    };
    if (field === "middlePayments") {
      const dates = [...((choices[field]?.value as string[]) ?? [""])];
      dates.forEach((date, index) => {
        const row = element("label", "axr-manual__row");
        row.append(element("span", "", `${index + 1}차`));
        const input = element("input", "work-input");
        input.type = "date";
        input.value = date;
        input.dataset.axKey = `manual-${field}-${index}`;
        input.setAttribute("aria-label", `중도금 ${index + 1}차 날짜`);
        input.addEventListener("input", () => {
          dates[index] = input.value;
          setValue([...dates]);
        });
        row.append(input);
        editor.append(row);
      });
      const line = element("div", "ax-act");
      if (dates.length < CONFIRM_MIDDLE_PAYMENTS_MAX) {
        const add = element("button", "work-secondary-button", "한 차 더하기");
        add.type = "button";
        add.dataset.axKey = "manual-add";
        add.addEventListener("click", () => {
          choices[field] = { kind: "manual", value: [...dates, ""] };
          render(`manual-${field}-${dates.length}`);
        });
        line.append(add);
      }
      if (dates.length > 1) {
        const drop = element("button", "work-secondary-button", "마지막 차 빼기");
        drop.type = "button";
        drop.dataset.axKey = "manual-drop";
        drop.addEventListener("click", () => {
          choices[field] = { kind: "manual", value: dates.slice(0, -1) };
          render("manual-drop");
        });
        line.append(drop);
      }
      editor.append(line);
    } else {
      const row = element("label", "axr-manual__row");
      row.append(element("span", "", `${label} 직접 넣기`));
      const input = element("input", "work-input");
      input.dataset.axKey = `manual-${field}`;
      if (MONEY.has(field)) {
        input.type = "text";
        input.inputMode = "numeric";
        input.autocomplete = "off";
        const value = choices[field]?.value;
        input.value = typeof value === "number" ? String(value) : "";
        input.placeholder = "원 단위 숫자";
        input.addEventListener("input", () => {
          const digits = input.value.replace(/[^0-9]/gu, "");
          setValue(digits === "" ? null : Number(digits));
        });
      } else {
        input.type = "date";
        input.value = String(choices[field]?.value ?? "");
        input.addEventListener("input", () => setValue(input.value));
      }
      row.append(input);
      editor.append(row);
    }
    editor.append(problem);
    const text = aiManualProblem(field, choices[field]?.value);
    problem.textContent = text ?? "";
    problem.hidden = !text;
    return editor;
  }

  function evidenceLine(item: Item) {
    const runs = [1, 2].map((runIndex) => ({ runIndex, evidence: aiEvidenceOf(resultOf(runIndex), item.field) })).filter((entry) => entry.evidence);
    if (runs.length === 0) return null;
    const { runIndex, evidence } = runs[0];
    const line = element("span", "ax-quote");
    const who = single() ? jobOf(runIndex)?.model ?? "" : `${runIndex}회 · ${jobOf(runIndex)?.model ?? ""}`;
    line.append(`근거(${who}): ${evidence!.page}쪽 “${evidence!.quote}”`);
    if (filesEnabled && fileIds()[evidence!.page - 1]) {
      const see = element("button", "work-secondary-button axr-see", "사진에서 보기");
      see.type = "button";
      see.dataset.axKey = `see-${item.field}`;
      see.addEventListener("click", () => {
        focusField = item.field;
        photoPage = evidence!.page;
        photoOpen = true;
        render(`see-${item.field}`);
        photoBox.scrollIntoView({ block: "nearest" });
      });
      line.append(" ", see);
    }
    return line;
  }

  const statusTag = (status: string) => (status === "same"
    ? element("span", "ax-same", AI_STATUS_TEXT.same)
    : element("span", `ax-tag ${aiEmptyStatus(status) ? "ax-tag--wait" : "ax-tag--warn"}`, AI_STATUS_TEXT[status as keyof typeof AI_STATUS_TEXT] ?? status));
  const valueNode = (field: string, value: unknown) => {
    const text = aiValueText(field, value);
    return text === null ? element("em", "ax-miss", "— 못 읽음") : document.createTextNode(text);
  };
  function decided(item: Item) {
    if (item.status === "same") return aiCanApply(item.field, item.first) ? element("span", "ax-same", chipText(item.field, item.first)) : element("span", "ax-miss", "넣지 않음(못 읽은 차가 있음)");
    return element("span", "ax-miss", "넣지 않음(지금 값 그대로)");
  }
  const needs = (item: Item) => item.status === "different" || item.status === "one_side" || item.status === "read";
  // 표·카드에서 눈에 띄게 할 줄: 옛 묶음은 다름·한쪽만, 한 번 읽기는 아직 고르지 않은 칸만(다 노랗게 칠하지 않게).
  const marked = (item: Item) => needs(item) && (!single() || !choices[item.field]);

  function compareTable(cmp: Comparison) {
    const table = element("table", "ax-cmp");
    const head = element("thead");
    const headRow = element("tr");
    const th = (text: string, small?: string) => {
      const cell = element("th", "", text);
      cell.scope = "col";
      if (small) cell.append(element("small", "", small));
      return cell;
    };
    const one = single();
    if (one) headRow.append(th("칸"), th("AI 읽음", jobOf(1)?.model), th("거래에 넣을 값"));
    else headRow.append(th("칸"), th("1회 읽음", jobOf(1)?.model), th("2회 읽음", jobOf(2)?.model), th("맞춰 봄"), th("거래에 넣을 값"));
    head.append(headRow);
    const saved = element("tbody");
    for (const item of cmp.fields) {
      const row = element("tr", `${marked(item) ? "is-diff" : ""}${focusField === item.field ? " is-focus" : ""}`);
      row.dataset.axrRow = item.field;
      const name = element("th", "", AI_FIELD_LABELS[item.field as keyof typeof AI_FIELD_LABELS]);
      name.scope = "row";
      const a = element("td", "ax-v");
      a.append(valueNode(item.field, item.first));
      const b = element("td", "ax-v");
      b.append(valueNode(item.field, item.second));
      const st = element("td");
      st.append(statusTag(item.status));
      const pickCell = element("td");
      pickCell.append(needs(item) ? chooser(item) : decided(item));
      const quote = evidenceLine(item);
      if (quote) pickCell.append(quote);
      if (one) row.append(name, a, pickCell);
      else row.append(name, a, b, st, pickCell);
      saved.append(row);
    }
    table.append(head, saved);
    const refs = cmp.reference.filter((item) => !aiEmptyStatus(item.status));
    if (refs.length > 0) {
      const more = element("tbody");
      const capRow = element("tr");
      const cap = element("th", "axr-refcap", "보기만 하는 칸 — 금액은 거래에 넣을 칸이 없고 일정 제목에도 넣지 않습니다(캘린더 구독으로 나가지 않게)");
      cap.colSpan = one ? 3 : 5;
      cap.scope = "rowgroup";
      capRow.append(cap);
      more.append(capRow);
      for (const item of refs) {
        const row = element("tr", "is-nosave");
        const name = element("th", "", AI_FIELD_LABELS[item.field as keyof typeof AI_FIELD_LABELS]);
        name.scope = "row";
        const a = element("td", "ax-v");
        a.append(valueNode(item.field, item.first));
        const b = element("td", "ax-v");
        b.append(valueNode(item.field, item.second));
        const st = element("td");
        st.append(statusTag(item.status));
        if (one) row.append(name, a, element("td", "ax-miss", "보기만(거래에 칸 없음)"));
        else row.append(name, a, b, st, element("td", "ax-miss", "보기만(거래에 칸 없음)"));
        more.append(row);
      }
      table.append(more);
    }
    return table;
  }

  function compareCards(cmp: Comparison) {
    const nodes: HTMLElement[] = [];
    const short = (runIndex: number) => `${runIndex}회 · ${jobOf(runIndex)?.model ?? ""}`;
    const one = single();
    const card = (item: Item, save: boolean) => {
      const li = element("li", `ax-card${save && marked(item) ? " is-diff" : ""}${save ? "" : " is-nosave"}${save && focusField === item.field ? " is-focus" : ""}`);
      li.dataset.axrRow = item.field;
      const head = element("div", "ax-card__head");
      head.append(element("b", "", AI_FIELD_LABELS[item.field as keyof typeof AI_FIELD_LABELS]));
      if (!one && item.status !== "same") head.append(statusTag(item.status));
      li.append(head);
      if (one) {
        // 한 번 읽기: AI 값 하나(못 읽었으면 '못 읽음')와 읽은 모델
        const line = element("p", "ax-card__one");
        const value = element("span");
        value.append(valueNode(item.field, item.first));
        line.append(value, element("span", "ax-soft", `AI 읽음 · ${jobOf(1)?.model ?? ""}`));
        li.append(line);
      } else if (item.status === "same") {
        const one = element("p", "ax-card__one");
        one.append(element("span", "", aiValueText(item.field, item.first) ?? ""), element("span", "ax-same", "✓ 둘이 같음"));
        li.append(one);
      } else {
        const vals = element("dl", "ax-card__vals");
        for (const [runIndex, value] of [[1, item.first], [2, item.second]] as const) {
          const cell = element("div");
          const dd = element("dd");
          dd.append(valueNode(item.field, value));
          cell.append(element("dt", "", short(runIndex)), dd);
          vals.append(cell);
        }
        li.append(vals);
      }
      if (save) {
        if (needs(item)) li.append(chooser(item));
        else if (aiEmptyStatus(item.status)) li.append(decided(item));
        const quote = evidenceLine(item);
        if (quote) li.append(quote);
      }
      return li;
    };
    const list = element("ul", "ax-cards");
    list.append(...cmp.fields.map((item) => card(item, true)));
    nodes.push(list);
    const refs = cmp.reference.filter((item) => !aiEmptyStatus(item.status));
    if (refs.length > 0) {
      const more = element("details", "ax-more");
      more.append(element("summary", "", `보기만 하는 칸 ${refs.length}개(금액·계약서 종류) — 거래에 넣지 않음`));
      const refList = element("ul", "ax-cards");
      refList.append(...refs.map((item) => card(item, false)));
      more.append(refList);
      nodes.push(more);
    }
    return nodes;
  }

  function notes() {
    const nodes: HTMLElement[] = [];
    const note = (tone: "warn" | "info", mark: string, ...content: (string | Node)[]) => {
      const p = element("p", `ax-note ax-note--${tone}`);
      p.append(element("span", "", mark));
      const text = element("span");
      text.append(...content);
      p.append(text);
      nodes.push(p);
      return p;
    };
    if (!view || !detail) return nodes;
    const model = jobOf(1)?.model ?? "";
    if (single()) {
      note("info", "ⓘ", `AI(${model})가 계약서를 한 번 읽은 값입니다. 칸마다 사진과 견줘 보고 AI 값·직접 넣기·지금 값 그대로 가운데 골라 주세요.`).dataset.axrSingle = "";
    } else if (view.group.pairMode === "same_unset") {
      note("warn", "⚠", element("b", "", "교차 아님"), ` — 같은 모델(${model})로 두 번 읽었습니다. 2회째 모델 설정이 비어 있어, 서로 다른 모델이 맞춰 본 결과가 아닙니다. 같은 칸을 둘 다 똑같이 틀렸을 수 있으니 '같음' 칸도 사진과 견줘 보세요.`).dataset.axrCross = "";
    } else if (view.group.pairMode === "same_chosen") {
      note("info", "ⓘ", `같은 모델(${model})로 두 번 읽었습니다(운영자가 고른 방식).`);
    }
    const half = aiHalfText(view.jobs);
    if (half) note("warn", "◐", half);
    if (!single()) for (const job of view.jobs) if (!job.result && job.errorCode) note("info", "ⓘ", `${job.runIndex}회: ${aiJobErrorText(job.errorCode)}`);
    const masked = view.jobs.reduce((sum, job) => sum + (job.maskedCount ?? 0), 0);
    const allWarnings = [...new Set(view.jobs.flatMap((job) => (job.result?.warnings as string[] | undefined) ?? []))];
    // 코드가 만든 경고(합계 다름·중도금 넘침)는 "AI가 남긴 말"에 섞지 않고 ⚠ 줄로 따로 보인다(2026-11-24 사용자 결정 "같이 넣어").
    for (const text of allWarnings) {
      const kind = contractCodeWarningKind(text);
      if (kind) note("warn", "⚠", element("b", "", kind === "sum" ? "금액 확인: " : "중도금 확인: "), text).dataset.axrCheck = kind;
    }
    const warnings = allWarnings.filter((text) => !contractCodeWarningKind(text)).slice(0, 3);
    if (masked > 0 || warnings.length > 0) {
      const parts: (string | Node)[] = [];
      if (masked > 0) parts.push(element("b", "", `가린 항목 ${masked}개`), " — 결과 글에서 주민등록번호 꼴을 가렸습니다.");
      if (warnings.length > 0) parts.push(`${masked > 0 ? " " : ""}AI가 남긴 말: ${warnings.map((text) => `“${text}”`).join(" ")}`);
      note("info", "ⓘ", ...parts).dataset.axrMasked = String(masked);
    }
    const kinds = view.jobs.filter((job) => job.result).map((job) => job.result!.document_kind as string);
    if (kinds.some((kind) => kind === "unknown")) note("warn", "⚠", "계약서 종류를 알아보지 못한 결과가 있습니다. 계약서 사진이 맞는지 먼저 확인하세요.");
    else if (new Set(kinds).size > 1) note("warn", "⚠", "두 번 읽은 계약서 종류가 서로 다릅니다. 사진을 꼭 확인하세요.");
    const types = [...new Set(view.jobs.filter((job) => job.result).map((job) => job.result!.deal_type as string))];
    if (types.some((type) => type !== detail!.deal.dealType)) {
      const label = (type: string) => DEAL_TYPE_LABELS[type as keyof typeof DEAL_TYPE_LABELS] ?? type;
      note("warn", "⚠", `계약서는 '${types.map(label).join("·")}'로 읽혔는데 이 거래는 '${label(detail.deal.dealType)}'입니다. 거래 종류에 맞는 금액 칸만 넣습니다.`);
    }
    return nodes;
  }

  function summaryChips(cmp: Comparison) {
    const sum = aiSummary(cmp);
    const box = element("div", "ax-sum");
    if (single()) {
      box.append(element("span", "ax-tag ax-tag--warn", `확인할 칸 ${sum.read}`));
      if (sum.unread) box.append(element("span", "ax-tag ax-tag--wait", `– 못 읽음 ${sum.unread}`));
      box.append(element("span", "ax-tag ax-tag--wait", `보기만 ${sum.reference}`));
      return box;
    }
    box.append(element("span", "ax-same", `✓ 같음 ${sum.same}`));
    if (sum.different) box.append(element("span", "ax-tag ax-tag--warn", `≠ 다름 ${sum.different}`));
    if (sum.oneSide) box.append(element("span", "ax-tag ax-tag--warn", `◐ 한쪽만 ${sum.oneSide}`));
    box.append(element("span", "ax-tag ax-tag--wait", `보기만 ${sum.reference}`));
    return box;
  }

  // 한 번 읽기 묶음의 표·카드 위 '모두 AI 값으로'. AI가 읽어 그대로 넣을 수 있는 칸이 없으면 그리지 않는다.
  // 누르면 그 칸들만 AI 값으로 고르고(못 읽은 칸은 그대로) 한 줄로 알린다. 다음 단계로 저절로 넘기지 않는다.
  function pickAllRow(cmp: Comparison) {
    if (!single() || aiPickAllAi(cmp, {}).picked.length === 0) return null;
    const row = element("div", "ax-act");
    const button = element("button", "work-secondary-button", "모두 AI 값으로");
    button.type = "button";
    button.dataset.axKey = "pick-all";
    button.dataset.axrPickAll = "";
    button.addEventListener("click", () => {
      if (!comparison) return;
      const outcome = aiPickAllAi(comparison, choices);
      choices = outcome.choices as Record<string, Choice>;
      Object.assign(manualDrafts, outcome.drafts);
      badFields = [];
      render("pick-all");
      setStatus(pickAllStatus, aiPickAllText(outcome, aiPendingFields(comparison, choices)), "success");
    });
    row.append(button, pickAllStatus);
    return row;
  }

  // ── 거래에 넣기 전 확인 ──

  function intoValue(field: string, value: unknown) {
    if (value === null || value === undefined) return "비어 있음";
    return MONEY.has(field) ? formatWon(value as number) : aiDateText(String(value));
  }

  function confirmBody() {
    const nodes: HTMLElement[] = [];
    if (!comparison || !detail) return nodes;
    const req = aiConfirmBody(comparison, choices, detail.deal.version);
    const rows = aiIntoRows(detail.deal, req);
    nodes.push(element("p", "ax-sub", "거래 칸 — 지금 값 → 넣을 값"));
    const list = element("ul", "ax-into");
    const lost: string[] = [];
    for (const row of rows) {
      const li = element("li", `${row.change === "overwrite" || row.change === "clear" ? "is-over" : ""}${badFields.includes(row.field) ? " is-bad" : ""}`);
      li.dataset.axrInto = row.field;
      const value = element("span");
      if (row.change === "same") value.append(element("b", "", intoValue(row.field, row.after)));
      else {
        value.append(element("s", "", intoValue(row.field, row.before)), " ");
        const arrow = element("span", "ax-nw", "→ ");
        arrow.append(element("b", "", row.after === null ? "비움" : intoValue(row.field, row.after)));
        value.append(arrow);
      }
      if (badFields.includes(row.field)) value.append(element("small", "axr-problem", "이 칸을 확인해 주세요"));
      const tone = row.change === "same" ? "wait" : row.change === "new" ? "ok" : "bad";
      li.append(element("span", "", AI_INTO_LABELS[row.field as keyof typeof AI_INTO_LABELS]), value, element("span", `ax-tag ax-tag--${tone}`, AI_CHANGE_TEXT[row.change as keyof typeof AI_CHANGE_TEXT]));
      list.append(li);
      if ((row.change === "overwrite" || row.change === "clear") && row.before !== null) lost.push(`${AI_INTO_LABELS[row.field as keyof typeof AI_INTO_LABELS]} ${intoValue(row.field, row.before)}`);
    }
    for (const field of badFields.filter((name) => !rows.some((row) => row.field === name))) {
      const li = element("li", "is-bad");
      li.dataset.axrInto = field;
      li.append(element("span", "", AI_INTO_LABELS[field as keyof typeof AI_INTO_LABELS] ?? AI_FIELD_LABELS[field as keyof typeof AI_FIELD_LABELS] ?? field), element("small", "axr-problem", "이 칸을 확인해 주세요(지금 거래 값으로는 일정을 계산할 수 없음)"), element("span", "ax-tag ax-tag--bad", "확인"));
      list.append(li);
    }
    nodes.push(list);
    if (req.keep.length > 0) nodes.push(element("p", "ax-soft", `지금 값 그대로 둔 칸: ${req.keep.map((field) => AI_INTO_LABELS[field as keyof typeof AI_INTO_LABELS]).join(", ")}`));
    if (lost.length > 0) {
      const warn = element("p", "ax-note ax-note--warn");
      const text = element("span");
      text.append(element("b", "", "덮어쓴 값은 되돌릴 수 없습니다."), ` ${lost.join(", ")}은 없어집니다.`);
      warn.append(element("span", "", "⚠"), text);
      nodes.push(warn);
    }
    nodes.push(element("p", "ax-sub", "일정 — 거래 칸으로 다시 계산(AI가 계산한 기한은 쓰지 않음)"));
    const preview = aiSchedulePreview(detail.deal, req, detail.events, legalRules);
    if (!preview.ok) nodes.push(element("p", "ax-soft", "지금 고른 값으로는 일정을 미리 계산하지 못했습니다(계약일 등 빈 칸). 넣을 때 서버가 다시 확인합니다."));
    else {
      const evts = element("ul", "ax-evts");
      for (const event of preview.events) {
        const li = element("li");
        const name = element("span", "", event.title);
        if (event.kept) name.append(" ", element("small", "ax-soft", `(${event.keptReason === "done" ? "완료한" : "직접 고친"} 일정 ${aiShortDate(event.kept)} 그대로 둠)`));
        else if (event.source === "ai") name.append(" ", element("small", "ax-soft", "(거래에 중도금 칸이 하나뿐이라 따로 넣는 일정, 금액 없음)"));
        const tag = event.kept ? element("span", "ax-tag ax-tag--warn", "그대로 둠") : event.source === "ai" ? element("span", "ax-tag ax-tag--ok", "AI로 넣음") : element("span", "ax-tag ax-tag--wait", "계산");
        li.append(element("span", "", aiShortDate(event.date)), name, tag);
        evts.append(li);
      }
      nodes.push(evts);
      // 앞 확정이 넣은 둘째 이후 중도금: 서버가 끝나지 않은 것을 지우고 새로 넣으므로 말없이 사라지지 않게 보인다.
      if (preview.previous.length > 0) {
        nodes.push(element("p", "ax-sub", "앞 AI 결과로 넣은 일정"));
        const prev = element("ul", "ax-evts");
        prev.dataset.axrPrev = "";
        const tags = { changed: ["ax-tag--warn", "바뀜"], removed: ["ax-tag--bad", "지움"], done: ["ax-tag--wait", "그대로, 완료"], kept: ["ax-tag--wait", "그대로 둠"] } as const;
        for (const item of preview.previous) {
          const li = element("li", item.status === "done" ? "is-done" : "");
          const name = element("span", "", item.title);
          const note = item.status === "changed" ? `(${aiShortDate(item.next ?? "")}로 다시 넣음)`
            : item.status === "removed" ? "(이번 결과에 이 차 중도금이 없어 지움)"
            : item.status === "done" ? "(완료로 표시해 지우지 않음)"
            : "(중도금을 넣지 않아 그대로)";
          name.append(" ", element("small", "ax-soft", note));
          li.append(element("span", "", aiShortDate(item.date)), name, element("span", `ax-tag ${tags[item.status][0]}`, tags[item.status][1]));
          prev.append(li);
        }
        nodes.push(prev);
      }
      // 끝나지 않은 직접 일정이 이번 AI 중도금과 같은 차이면 서버는 둘 다 남긴다: 두 줄이 된다고 미리 알린다(서버 판정은 그대로).
      if (preview.twins.length > 0) {
        nodes.push(element("p", "ax-sub", "직접 넣은 같은 차 중도금"));
        const warn = element("p", "ax-note ax-note--warn");
        const text = element("span");
        text.append(element("b", "", "같은 차수 AI 일정과 두 줄이 됩니다."), " 직접 넣은 일정은 그대로 둡니다. 하나만 남기려면 넣은 뒤 손님 카드에서 필요 없는 줄을 지워 주세요.");
        warn.append(element("span", "", "⚠"), text);
        nodes.push(warn);
        const twins = element("ul", "ax-evts");
        twins.dataset.axrTwin = "";
        for (const item of preview.twins) {
          const name = element("span", "", item.title);
          name.append(" ", element("small", "ax-soft", `(같은 차 AI 일정: ${aiShortDate(item.aiDate)})`));
          const li = element("li");
          li.append(element("span", "", aiShortDate(item.date)), name, element("span", "ax-tag ax-tag--warn", "그대로 둠"));
          twins.append(li);
        }
        nodes.push(twins);
      }
    }
    nodes.push(element("p", "ax-sub", "넣지 않는 것"));
    const out = element("ul", "ax-out");
    for (const text of ["계약금·중도금·잔금 금액: 거래에 넣을 칸이 없어 보기만 했습니다. 일정 제목에도 넣지 않습니다.", "물건 표시·계약서 종류: 보기만 했습니다.", "이 거래에 직접 넣거나 고친 일정(계산·AI로 넣은 일정을 손으로 고친 것 포함)은 그대로 둡니다."]) out.append(element("li", "", text));
    nodes.push(out);
    return nodes;
  }

  function confirmLabel() {
    if (!comparison || !detail) return "거래에 넣기";
    const req = aiConfirmBody(comparison, choices, detail.deal.version);
    const changed = aiIntoRows(detail.deal, req).filter((row) => row.change !== "same").length;
    const preview = aiSchedulePreview(detail.deal, req, detail.events, legalRules);
    return preview.ok ? `거래에 넣기 (칸 ${changed}개 · 일정 ${preview.events.length}개)` : `거래에 넣기 (칸 ${changed}개)`;
  }

  async function confirm() {
    if (busy || blocked || !comparison || !detail || !groupId) return;
    busy = true;
    reloadButton.hidden = true;
    renderFoot();
    setStatus(status, "거래에 넣고 있습니다…", "saving");
    try {
      done = await confirmAiGroup(groupId, aiConfirmBody(comparison, choices, detail.deal.version));
      busy = false;
      step = "done";
      setStatus(status, "", "idle");
      render();
      title.focus();
    } catch (error) {
      busy = false;
      const code = codeOf(error);
      setStatus(status, aiConfirmErrorText(code, detailsOf(error), (value: string | null) => customerSaveErrorText(value, error)), "error");
      if (code === "VERSION_CONFLICT" || code === "AI_JOB_STATE_CONFLICT") reloadButton.hidden = false;
      if (code === "DEAL_CLOSED" || code === "NOT_FOUND") blocked = true;
      if (code === "VALIDATION_FAILED") badFields = detailsOf(error);
      render();
      status.focus();
    }
  }

  // ── 사진 ──

  function renderPhoto() {
    const wide = photoMq.matches;
    const nodes: HTMLElement[] = [];
    const ids = fileIds();
    const focusItem = focusField;
    const evidence = focusItem ? [1, 2].map((runIndex) => aiEvidenceOf(resultOf(runIndex), focusItem)).find(Boolean) ?? null : null;
    if (!wide) {
      const peek = element("div", "axr-peek");
      const label = element("span");
      label.append(element("b", "", "계약서 사진"));
      if (evidence && focusItem) label.append(" ", element("span", "ax-soft", `· ${AI_FIELD_LABELS[focusItem as keyof typeof AI_FIELD_LABELS]} 근거 ${evidence.page}쪽`));
      const toggle = element("button", "work-secondary-button", photoOpen ? "사진 접기" : "사진 펼치기");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", String(photoOpen));
      toggle.dataset.axKey = "photo-toggle";
      toggle.dataset.axrPhotoToggle = "";
      toggle.disabled = !filesEnabled || ids.length === 0;
      toggle.addEventListener("click", () => {
        photoOpen = !photoOpen;
        if (photoOpen && evidence) photoPage = evidence.page;
        renderPhoto();
        photoBox.querySelector<HTMLElement>("[data-ax-key='photo-toggle']")?.focus();
      });
      peek.append(label, toggle);
      nodes.push(peek);
    }
    const showImage = wide || photoOpen;
    if (showImage) {
      const panel = element("div", "axr-photo__panel");
      if (!filesEnabled) panel.append(element("p", "ax-soft", "파일 저장소가 꺼져 있어 사진을 볼 수 없습니다."));
      else if (ids.length === 0) panel.append(element("p", "ax-soft", "읽은 사본 번호를 받지 못해 사진을 보일 수 없습니다."));
      else {
        const pages = element("div", "axw__pages");
        ids.forEach((_, index) => {
          const n = index + 1;
          const chip = element("button", `ax-chip${photoPage === n ? " is-on" : ""}`, `${n}쪽`);
          chip.type = "button";
          chip.setAttribute("aria-pressed", String(photoPage === n));
          chip.dataset.axKey = `page-${n}`;
          chip.addEventListener("click", () => {
            photoPage = n;
            renderPhoto();
            photoBox.querySelector<HTMLElement>(`[data-ax-key='page-${n}']`)?.focus();
          });
          pages.append(chip);
        });
        pages.append(element("span", "ax-soft axr-photo__hint", "근거 자리는 참고(정확하지 않을 수 있음)"));
        const stage = element("div", "axw__stage");
        const frame = element("div", "axr-frame");
        let image = images.get(photoPage);
        const id = ids[photoPage - 1];
        if (!image && id) {
          image = element("img");
          image.alt = `계약서 사본 ${photoPage}쪽`;
          image.decoding = "async";
          image.src = fileContentUrl(id);
          images.set(photoPage, image);
        }
        if (image) frame.append(image);
        if (evidence && evidence.page === photoPage && evidence.box && focusItem) {
          const [left, top, right, bottom] = evidence.box as number[];
          if (right > left && bottom > top) {
            const box = element("span", "axw__box");
            box.style.left = `${left * 100}%`;
            box.style.top = `${top * 100}%`;
            box.style.width = `${(right - left) * 100}%`;
            box.style.height = `${(bottom - top) * 100}%`;
            const tag = element("span", "axw__boxtag", `${AI_FIELD_LABELS[focusItem as keyof typeof AI_FIELD_LABELS]} 근거(참고)`);
            tag.style.left = `${left * 100}%`;
            tag.style.top = `${top * 100}%`;
            frame.append(box, tag);
          }
        }
        stage.append(frame);
        panel.append(pages, stage);
      }
      nodes.push(panel);
    }
    photoBox.replaceChildren(...nodes);
    photoBox.classList.toggle("is-open", showImage);
  }

  // ── 그리기 ──

  function renderFoot() {
    if (step === "done" || !comparison) {
      foot.hidden = true;
      return;
    }
    foot.hidden = false;
    if (step === "compare") {
      const pending = aiPendingFields(comparison, choices);
      footText.hidden = false;
      footText.textContent = pending.length > 0
        ? `고를 칸 ${pending.length}개 남음 — ${pending.map((field: string) => AI_FIELD_LABELS[field as keyof typeof AI_FIELD_LABELS]).join(", ")}`
        : "모두 골랐습니다";
      next.textContent = "확인으로 넘어가기";
      next.disabled = pending.length > 0;
      backStep.hidden = true;
    } else {
      footText.hidden = true;
      next.textContent = busy ? "넣는 중…" : confirmLabel();
      next.disabled = busy || blocked;
      backStep.hidden = false;
      backStep.textContent = single() ? "값 고르기로 돌아가기" : "비교표로 돌아가기";
      backStep.disabled = busy;
    }
  }

  function render(focusKey: string | null = null) {
    if (!comparison || !view || !detail) return;
    const nodes: HTMLElement[] = [];
    if (step === "compare") {
      title.textContent = "AI로 뽑은 값 맞춰 보기";
      nodes.push(...notes(), summaryChips(comparison));
      const pickAll = pickAllRow(comparison);
      if (pickAll) nodes.push(pickAll);
      if (tableMq.matches) nodes.push(compareTable(comparison));
      else nodes.push(...compareCards(comparison));
      photoBox.hidden = false;
      renderPhoto();
    } else if (step === "confirm") {
      title.textContent = "거래에 넣기 전 확인";
      nodes.push(...confirmBody());
      photoBox.hidden = true;
    } else {
      title.textContent = "거래에 넣었습니다";
      photoBox.hidden = true;
      if (done) {
        for (const text of done.notices) {
          const p = element("p", "ax-note ax-note--info");
          p.append(element("span", "", "ⓘ"), element("span", "", text));
          nodes.push(p);
        }
        nodes.push(element("p", "ax-sub", `이 거래의 일정 ${done.events.length}개`));
        const evts = element("ul", "ax-evts");
        for (const event of done.events as DealEvent[]) {
          const li = element("li", event.doneAt ? "is-done" : "");
          const tag = event.doneAt ? "✓ 끝남" : event.source === "calculated" ? "계산" : event.source === "ai_confirmed" ? "AI로 넣음" : "직접";
          li.append(element("span", "", aiShortDate(event.dueOn)), element("span", "", event.title), element("span", "ax-tag ax-tag--wait", tag));
          evts.append(li);
        }
        nodes.push(evts);
      }
      const go = element("a", "work-primary-button axr-done-go", "손님 카드로 돌아가기");
      go.href = back.href;
      const act = element("div", "ax-act");
      act.append(go);
      nodes.push(act);
    }
    main.classList.toggle("is-single", step !== "compare");
    body.replaceChildren(...nodes);
    renderFoot();
    if (focusKey) page.querySelector<HTMLElement>(`[data-ax-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  next.addEventListener("click", () => {
    if (step === "compare") {
      if (!comparison || aiPendingFields(comparison, choices).length > 0) return;
      step = "confirm";
      badFields = [];
      setStatus(status, "", "idle");
      setStatus(pickAllStatus, "", "idle");
      render();
      window.scrollTo({ top: 0 });
      title.focus({ preventScroll: true });
    } else if (step === "confirm") void confirm();
  });
  backStep.addEventListener("click", () => {
    if (busy) return;
    step = "compare";
    reloadButton.hidden = true;
    setStatus(status, "", "idle");
    render();
    title.focus();
  });
  reloadButton.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    reloadButton.disabled = true;
    setStatus(status, "다시 불러오는 중…", "saving");
    try {
      await load(true);
      busy = false;
      reloadButton.hidden = true;
      blocked = false;
      badFields = [];
      setStatus(status, "새 내용을 불러왔습니다. 고른 값은 그대로이니 지금 값을 다시 확인한 뒤 넣어 주세요.", "success");
      renderHead();
      render();
    } catch (error) {
      busy = false;
      const known = (error as { state?: [string, string] }).state;
      if (known) showState(known[0], known[1]);
      else setStatus(status, `다시 불러오지 못했습니다. ${customerErrorText(codeOf(error))}`, "error");
    } finally {
      reloadButton.disabled = false;
    }
  });
  pick("[data-axr-state-retry]").addEventListener("click", () => void start());
  tableMq.addEventListener("change", () => render());
  photoMq.addEventListener("change", () => {
    if (step === "compare") renderPhoto();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    // 뒤로 가기 캐시에서 돌아오면 고른 값을 버리고 다시 읽는다(그 사이 거래가 바뀌었을 수 있음).
    view = null;
    detail = null;
    comparison = null;
    choices = {};
    manualDrafts = {};
    done = null;
    images.clear();
    void start();
  });
  void start();
}
