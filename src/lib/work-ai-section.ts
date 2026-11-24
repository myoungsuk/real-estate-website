// 손님 카드 거래 칸 '계약서 사본' 칸 맨 끝의 'AI로 일정 뽑기' 상자(단계 4, 사용자 선택 2026-11-23 "B안 별도 화면"·비용 표시 "넣음").
// 서버 요청은 work-ai-client.ts 한 곳, 글은 work/contract-ai-view.mjs.
// - 업무 세션의 aiEnabled·filesEnabled가 모두 켜졌고 그 거래에 계약서 사본이 있을 때만 보인다. 꺼져 있으면 아무것도 그리지 않고 서버도 부르지 않는다.
// - 사본 칸을 펼쳤을 때만 그 거래의 최근 묶음(GET ai/jobs?dealId=, 결과 없음·열람 감사 없음)을 한 번 읽는다.
//   진행 중이면 이어서 조회하고(처음 1분 5초, 그 뒤 15초), 묶음이 끝나면 조회를 멈춘다(그 뒤 다시 부르지 않음, G17). 화면을 떠나면 타이머를 푼다.
// - 시작 칸: 사본 고르기(1 ~ 5장) → 예상 비용·남은 한도(GET ai/estimate, 읽기만) → '사본 N장으로 일정 뽑기'(POST ai/jobs 한 번). 409 AI_JOB_ACTIVE면 그 묶음을 이어서 본다.
// - 결과가 나오면 개수만 보이고 '결과 보고 고르기'로 결과 고르기 화면(/admin/work/ai/review/?id=)에 간다. 비교·확정은 그 화면에서만 한다.
// - 계약서 글·금액·날짜는 화면 메모리에만 둔다(주소·브라우저 저장소·제목 없음). 고르기 화면 주소에는 묶음 ID와 손님 카드 ID(UUID)만 싣는다.
import type { CustomerDeal, CustomerFile } from "./work-customers-client";
import { WorkApiError } from "./work-customers-client";
import { element, setStatus } from "./work-customers-dom";
import {
  cancelAiGroup,
  createAiJob,
  listAiGroups,
  readAiEstimate,
  readAiGroup,
  type AiEstimate,
  type AiGroupStatus,
  type AiGroupView,
  type AiJobSummary,
  type AiPairMode,
} from "./work-ai-client";
import { copyFilesOf, copyRowText } from "./work/contract-copy-view.mjs";
import {
  AI_JOB_STATUS_LABELS,
  AI_PICK_MAX,
  aiCreateErrorText,
  aiElapsedText,
  aiEstimateLines,
  aiHalfText,
  aiInitialChoices,
  aiJobErrorText,
  aiPendingFields,
  aiPollDelay,
  aiReviewHref,
  aiSummary,
  compareContractResults,
} from "./work/contract-ai-view.mjs";
import { customerErrorText } from "./work/customers-view.mjs";
import { photoShortAtText, photoSizeText } from "./work/photo-view.mjs";

interface AiSectionOptions {
  // 업무 세션의 aiEnabled && filesEnabled
  enabled: () => boolean;
  // 결과 고르기 화면에서 돌아올 손님 카드 ID
  customerId: () => string | null;
}

type Phase = "idle" | "loading" | "load_error" | "start" | "creating" | "running" | "poll_error" | "ready" | "confirmed" | "failed";
interface Group { id: string; status: AiGroupStatus; pairMode: AiPairMode; createdAt: string; confirmedAt: string | null; jobs: AiJobSummary[] }
interface Slot {
  dealId: string;
  root: HTMLElement;
  deal: Pick<CustomerDeal, "id" | "status" | "dealType" | "files"> | null;
  phase: Phase;
  group: Group | null;
  // 조회가 결과까지 받아 온 묶음(그때만 개수를 보인다. 다시 들어오면 결과를 다시 부르지 않음)
  view: AiGroupView | null;
  picked: Set<string> | null;
  estimates: Map<number, AiEstimate | { error: string }>;
  timer: number | null;
  watchStart: number;
  busy: boolean;
  askDiscard: boolean;
  // 시작 칸을 다시 보일 때 위에 남길 한 줄(그만둠·실패 알림)
  note: { text: string; state: "idle" | "success" | "error" } | null;
  // 잘못 끝난 요청이 늦게 돌아와 새 상태를 덮지 않게 세는 번호
  seq: number;
  // 사본 칸을 펼친 적이 있음(그때 사본이 0장이었으면 첫 사본이 올라온 뒤 update에서 읽는다)
  wanted: boolean;
}

const CLOSED_TEXT: Record<string, string> = { completed: "끝난 거래라 일정을 뽑지 않습니다.", cancelled: "취소한 거래라 일정을 뽑지 않습니다." };
const codeOf = (error: unknown) => (error instanceof WorkApiError ? error.code : null);
const detailsOf = (error: unknown) => (error instanceof WorkApiError ? error.details : []);
const errorText = (error: unknown) => aiCreateErrorText(codeOf(error), customerErrorText);

export function mountAiSection(options: AiSectionOptions) {
  const slots = new Map<string, Slot>();

  function makeSlot(dealId: string): Slot {
    const root = element("section", "ax");
    root.dataset.axDeal = dealId;
    root.setAttribute("aria-labelledby", `ax-title-${dealId}`);
    root.hidden = true;
    return { dealId, root, deal: null, phase: "idle", group: null, view: null, picked: null, estimates: new Map(), timer: null, watchStart: 0, busy: false, askDiscard: false, note: null, seq: 0, wanted: false };
  }
  const slotOf = (dealId: string) => {
    let slot = slots.get(dealId);
    if (!slot) {
      slot = makeSlot(dealId);
      slots.set(dealId, slot);
    }
    return slot;
  };
  const copiesOf = (slot: Slot) => (copyFilesOf(slot.deal) as CustomerFile[]).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const isClosed = (slot: Slot) => Boolean(slot.deal && CLOSED_TEXT[slot.deal.status]);

  function stop(slot: Slot) {
    if (slot.timer !== null) window.clearTimeout(slot.timer);
    slot.timer = null;
  }

  // ── 서버 ──

  async function loadLatest(slot: Slot) {
    const seq = ++slot.seq;
    slot.phase = "loading";
    render(slot);
    try {
      const { items } = await listAiGroups(slot.dealId);
      if (seq !== slot.seq) return;
      const latest = items[0];
      if (!latest || latest.status === "cancelled") {
        toStart(slot);
        return;
      }
      slot.group = { id: latest.groupId, status: latest.status, pairMode: latest.pairMode, createdAt: latest.createdAt, confirmedAt: latest.confirmedAt, jobs: latest.jobs };
      slot.view = null;
      if (latest.status === "running") watch(slot, false);
      else {
        slot.phase = latest.status;
        render(slot);
      }
    } catch (error) {
      if (seq !== slot.seq) return;
      slot.phase = "load_error";
      slot.note = { text: `AI 작업을 불러오지 못했습니다. ${errorText(error)}`, state: "error" };
      render(slot);
    }
  }

  function toStart(slot: Slot, note: Slot["note"] = null) {
    stop(slot);
    slot.phase = "start";
    slot.askDiscard = false;
    slot.note = note;
    const copies = copiesOf(slot);
    if (!slot.picked) slot.picked = new Set(copies.slice(0, AI_PICK_MAX).map((file) => file.id));
    // 지운 사본은 고른 것에서 뺀다.
    for (const id of [...slot.picked]) if (!copies.some((file) => file.id === id)) slot.picked.delete(id);
    render(slot);
    void loadEstimate(slot);
  }

  async function loadEstimate(slot: Slot) {
    const pages = slot.picked?.size ?? 0;
    if (pages < 1 || slot.estimates.has(pages)) return;
    try {
      const estimate = await readAiEstimate(pages);
      slot.estimates.set(pages, estimate);
    } catch (error) {
      slot.estimates.set(pages, { error: errorText(error) });
    }
    if (slot.phase === "start") render(slot);
  }

  // 묶음 지켜보기: 곧바로 한 번 조회하고(fresh가 아니면) 결과가 날 때까지 간격을 두고 다시 조회한다.
  function watch(slot: Slot, justCreated: boolean) {
    stop(slot);
    slot.phase = "running";
    slot.watchStart = Date.now();
    render(slot);
    if (justCreated) schedule(slot);
    else void poll(slot);
  }
  function schedule(slot: Slot) {
    stop(slot);
    slot.timer = window.setTimeout(() => void poll(slot), aiPollDelay(Date.now() - slot.watchStart));
  }
  async function poll(slot: Slot) {
    slot.timer = null;
    const group = slot.group;
    if (!group || slot.phase !== "running") return;
    const seq = ++slot.seq;
    let view: AiGroupView;
    try {
      view = await readAiGroup(group.id);
    } catch (error) {
      if (seq !== slot.seq) return;
      // 자동으로 다시 조회하지 않는다(오류가 반복되면 요청만 쌓임). '다시 확인'으로 이어 간다.
      slot.phase = "poll_error";
      slot.note = { text: `결과를 확인하지 못했습니다. ${errorText(error)}`, state: "error" };
      render(slot);
      return;
    }
    if (seq !== slot.seq || slot.phase !== "running") return;
    slot.group = { ...group, status: view.group.status, pairMode: view.group.pairMode, confirmedAt: view.group.confirmedAt, jobs: view.jobs };
    if (view.group.status === "running") {
      render(slot);
      schedule(slot);
      return;
    }
    // 끝남: 조회를 멈춘다. 결과가 실린 응답(ready·confirmed)이면 개수를 보이려고 화면 메모리에만 둔다.
    slot.view = view.jobs.some((job) => job.result) ? view : null;
    if (view.group.status === "cancelled") toStart(slot, { text: "AI 작업을 그만뒀습니다.", state: "idle" });
    else {
      slot.phase = view.group.status;
      render(slot);
    }
  }

  async function start(slot: Slot) {
    if (slot.busy || !slot.picked || slot.picked.size === 0) return;
    const fileIds = copiesOf(slot).filter((file) => slot.picked?.has(file.id)).map((file) => file.id);
    slot.busy = true;
    slot.phase = "creating";
    slot.note = null;
    render(slot);
    try {
      const created = await createAiJob(slot.dealId, fileIds);
      slot.estimates.clear();
      slot.group = { id: created.groupId, status: "running", pairMode: created.pairMode, createdAt: new Date().toISOString(), confirmedAt: null, jobs: created.jobs };
      slot.view = null;
      slot.busy = false;
      watch(slot, true);
    } catch (error) {
      slot.busy = false;
      const code = codeOf(error);
      const active = detailsOf(error)[0];
      if (code === "AI_JOB_ACTIVE" && active) {
        // 이미 읽고 있는 묶음을 이어서 본다(새로 만들지 않음).
        slot.group = { id: active, status: "running", pairMode: "cross", createdAt: new Date().toISOString(), confirmedAt: null, jobs: [] };
        slot.view = null;
        watch(slot, false);
        return;
      }
      slot.estimates.clear();
      if (code === "AI_STATE_UNKNOWN") {
        // 행은 남아 있으므로 목록을 다시 읽어 그 묶음 상태를 보인다.
        await loadLatest(slot);
        slot.note = { text: errorText(error), state: "error" };
        render(slot);
        return;
      }
      toStart(slot, { text: `보내지 않았습니다. ${errorText(error)}`, state: "error" });
    }
  }

  async function cancel(slot: Slot, after: string) {
    const group = slot.group;
    if (slot.busy || !group) return;
    slot.busy = true;
    stop(slot);
    slot.seq += 1;
    render(slot);
    try {
      await cancelAiGroup(group.id);
      slot.busy = false;
      slot.group = null;
      slot.view = null;
      toStart(slot, { text: after, state: "success" });
    } catch (error) {
      slot.busy = false;
      if (codeOf(error) === "AI_JOB_STATE_CONFLICT") {
        await loadLatest(slot);
        slot.note = { text: "이미 거래에 넣은 결과라 버릴 수 없습니다.", state: "error" };
        render(slot);
        return;
      }
      slot.note = { text: `그만두지 못했습니다. ${errorText(error)}`, state: "error" };
      if (slot.phase === "running") schedule(slot);
      render(slot);
    }
  }

  // ── 그리기 ──

  function tag(text: string, tone: "ai" | "wait" | "warn" | "ok" | "bad") {
    return element("span", `ax-tag ax-tag--${tone}`, text);
  }
  function button(text: string, primary: boolean, key: string, onClick: () => void) {
    const node = element("button", primary ? "work-primary-button" : "work-secondary-button", text);
    node.type = "button";
    node.dataset.axKey = key;
    node.addEventListener("click", onClick);
    return node;
  }
  function heading(slot: Slot, text: string, badge?: HTMLElement, small?: string) {
    const head = element("h4", "", text);
    head.id = `ax-title-${slot.dealId}`;
    if (small) head.append(" ", element("small", "", small));
    if (badge) head.append(" ", badge);
    return head;
  }
  function statusLine(slot: Slot) {
    const line = element("p", "admin-form-status ax-status");
    line.setAttribute("role", "status");
    line.setAttribute("aria-live", "polite");
    line.dataset.axStatus = "";
    if (slot.note) setStatus(line, slot.note.text, slot.note.state);
    return line;
  }
  const jobLine = (job: AiJobSummary) => {
    const row = element("li");
    const done = job.status === "completed";
    const failed = !done && !["queued", "in_progress"].includes(job.status);
    row.append(
      done ? tag("✓", "ok") : failed ? tag("✕", "bad") : tag("…", "wait"),
      (() => {
        const name = element("span");
        name.append(element("b", "", `${job.runIndex}회`), " ", element("code", "", job.model));
        return name;
      })(),
      element("span", "ax-soft", AI_JOB_STATUS_LABELS[job.status as keyof typeof AI_JOB_STATUS_LABELS] ?? job.status),
    );
    return row;
  };

  function startForm(slot: Slot) {
    const nodes: HTMLElement[] = [];
    const copies = copiesOf(slot);
    const picked = slot.picked ?? new Set<string>();
    nodes.push(element("p", "ax-soft", `읽을 사본을 고르세요(1 ~ ${AI_PICK_MAX}장). 같은 사진을 두 번 읽어 맞춰 보고, 거래에 넣기 전에 직접 확인합니다.`));
    const list = element("ul", "ax-pick");
    for (const file of copies) {
      const row = element("li");
      const label = element("label");
      const box = element("input");
      box.type = "checkbox";
      box.checked = picked.has(file.id);
      box.disabled = slot.busy || (!box.checked && picked.size >= AI_PICK_MAX);
      box.dataset.axKey = `pick-${file.id}`;
      box.dataset.axPick = file.id;
      box.addEventListener("change", () => {
        if (box.checked) picked.add(file.id);
        else picked.delete(file.id);
        slot.picked = picked;
        render(slot);
        void loadEstimate(slot);
      });
      label.append(box, element("span", "", copyRowText(file)), element("span", "", photoSizeText(file.byteSize)));
      row.append(label);
      list.append(row);
    }
    nodes.push(list);
    if (copies.length > AI_PICK_MAX) nodes.push(element("p", "ax-soft", `한 번에 ${AI_PICK_MAX}장까지 고를 수 있습니다.`));

    const count = picked.size;
    const estimate = count > 0 ? slot.estimates.get(count) : undefined;
    const facts = element("dl", "ax-facts");
    const fact = (term: string, value: string | Node, small?: string) => {
      const row = element("div");
      const dd = element("dd");
      dd.append(value);
      if (small) dd.append(element("small", "", small));
      row.append(element("dt", "", term), dd);
      facts.append(row);
    };
    fact("읽는 방법", (() => {
      const text = document.createDocumentFragment();
      text.append(element("b", "", "두 번 읽고 맞춰 봄"));
      return text;
    })(), "어느 모델이 읽었는지는 결과에 나옵니다.");
    let blocked: string | null = null;
    if (count === 0) fact("비용", "사본을 한 장 이상 고르면 보입니다.");
    else if (!estimate) fact("비용", "확인하는 중…");
    else if ("error" in estimate) {
      blocked = estimate.error;
      fact("비용", "확인하지 못했습니다.");
    } else {
      const lines = aiEstimateLines(estimate);
      blocked = lines.blocked;
      const cost = document.createDocumentFragment();
      cost.append(element("b", "", lines.cost), "를 먼저 잡아 둠");
      fact("비용", cost, "끝나면 실제 사용량으로 바로잡습니다(추정 값). 그만두거나 결과를 못 받으면 돌아오지 않을 수 있습니다.");
      fact("남은 한도", lines.limit);
    }
    fact("걸리는 시간", "몇 분 걸릴 수 있음", "화면을 닫아도 서버가 1분마다 결과를 받아 둡니다.");
    nodes.push(facts);
    const send = element("p", "ax-send");
    send.append("고른 사진은 ", element("b", "", "OpenAI(미국)"), "로 갑니다. 주민등록번호를 가렸다고 확인한 사본만 보냅니다. 덜 가린 사본은 위 목록의 '보기'로 한 번 더 보세요.");
    nodes.push(send);
    if (blocked) {
      const box = element("div", "ax-fail ax-fail--limit");
      const text = element("p", "", blocked);
      if (estimate && !("error" in estimate) && estimate.blockedBy) {
        const link = element("a", "", "AI 사용 한도 바꾸기(글 초안 화면)");
        link.href = "/admin/work/blog/";
        text.append(" ", link);
      }
      box.append(element("h5", "", "보낼 수 없음"), text);
      box.querySelector("h5")?.prepend(tag("한도", "warn"), " ");
      nodes.push(box);
    }
    const act = element("div", "ax-act");
    const go = button(slot.phase === "creating" ? "보내는 중…" : `사본 ${count}장으로 일정 뽑기`, true, "go", () => void start(slot));
    go.disabled = slot.busy || count === 0 || !estimate || "error" in estimate || Boolean(blocked);
    go.dataset.axGo = "";
    act.append(go);
    nodes.push(act);
    return nodes;
  }

  function render(slot: Slot) {
    const root = slot.root;
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.axKey ?? null : null;
    const copies = copiesOf(slot);
    const visible = options.enabled() && slot.deal !== null && (copies.length > 0 || slot.group !== null);
    root.hidden = !visible;
    if (!visible) {
      root.replaceChildren();
      return;
    }
    const nodes: HTMLElement[] = [];
    if (isClosed(slot)) {
      nodes.push(heading(slot, "AI로 일정 뽑기", tag("꺼짐", "wait")), element("p", "ax-soft", CLOSED_TEXT[slot.deal!.status]));
      root.replaceChildren(...nodes);
      return;
    }
    const group = slot.group;
    switch (slot.phase) {
      case "idle":
      case "loading":
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("AI", "ai")), element("p", "ax-soft", "AI 작업을 불러오는 중…"));
        break;
      case "load_error":
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("AI", "ai")), statusLine(slot), button("다시 불러오기", false, "reload", () => void loadLatest(slot)));
        root.replaceChildren(...nodes);
        restoreFocus(root, focused);
        return;
      case "start":
      case "creating":
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("AI", "ai")));
        if (slot.note) nodes.push(statusLine(slot));
        nodes.push(...startForm(slot));
        break;
      case "running":
      case "poll_error": {
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("읽는 중", "wait")));
        const time = element("div", "ax-time");
        time.append(element("strong", "", aiElapsedText(Date.now() - Date.parse(group?.createdAt ?? "") || 0)), element("span", "ax-soft", "처음 1분은 5초, 그 뒤 15초마다 확인 · 결과가 나오면 확인을 멈춥니다"));
        nodes.push(time);
        if (group && group.jobs.length > 0) {
          const runs = element("ul", "ax-run");
          runs.append(...group.jobs.map(jobLine));
          nodes.push(runs);
        }
        nodes.push(element("p", "ax-soft", "화면을 닫거나 휴대폰이 꺼져도 서버가 1분마다 결과를 받아 둡니다. 다시 열면 여기서 이어 봅니다."));
        if (slot.phase === "poll_error") nodes.push(statusLine(slot));
        else if (slot.note) nodes.push(statusLine(slot));
        const act = element("div", "ax-act");
        if (slot.phase === "poll_error") {
          act.append(button("다시 확인", true, "repoll", () => {
            slot.note = null;
            watch(slot, false);
          }));
        }
        const quit = button(slot.busy ? "그만두는 중…" : "그만두기", false, "quit", () => void cancel(slot, "AI 작업을 그만뒀습니다."));
        quit.disabled = slot.busy;
        quit.dataset.axQuit = "";
        act.append(quit, element("span", "ax-soft", "그만둬도 잡아 둔 비용은 돌아오지 않을 수 있습니다."));
        nodes.push(act);
        break;
      }
      case "ready": {
        nodes.push(heading(slot, "AI로 뽑은 값", tag("결과 나옴", "ai")));
        const at = photoShortAtText(group?.createdAt ?? "");
        if (slot.view && slot.deal) {
          const first = slot.view.jobs.find((job) => job.runIndex === 1)?.result ?? null;
          const second = slot.view.jobs.find((job) => job.runIndex === 2)?.result ?? null;
          const comparison = compareContractResults(first, second, slot.deal.dealType);
          const sum = aiSummary(comparison);
          const chips = element("div", "ax-sum");
          chips.append(element("span", "ax-same", `✓ 같음 ${sum.same}`));
          if (sum.different) chips.append(tag(`≠ 다름 ${sum.different}`, "warn"));
          if (sum.oneSide) chips.append(tag(`◐ 한쪽만 ${sum.oneSide}`, "warn"));
          chips.append(tag(`보기만 ${sum.reference}`, "wait"));
          nodes.push(chips);
          const pending = aiPendingFields(comparison, aiInitialChoices(comparison)).length;
          nodes.push(element("p", "ax-soft", `${at} 뽑음 · 고를 칸 ${pending}개`));
          const half = aiHalfText(slot.view.jobs);
          if (half) nodes.push(element("p", "ax-soft", half));
        } else {
          nodes.push(element("p", "ax-soft", `${at} 뽑음 · ${group?.jobs.map((job) => `${job.runIndex}회 ${AI_JOB_STATUS_LABELS[job.status as keyof typeof AI_JOB_STATUS_LABELS] ?? job.status}`).join(" · ") ?? ""}`));
        }
        for (const job of group?.jobs ?? []) {
          if (job.status !== "completed" && job.errorCode) nodes.push(element("p", "ax-soft", `${job.runIndex}회: ${aiJobErrorText(job.errorCode)}`));
        }
        if (slot.note) nodes.push(statusLine(slot));
        const act = element("div", "ax-act");
        const go = element("a", "work-primary-button", "결과 보고 고르기");
        go.href = aiReviewHref(group?.id ?? "", options.customerId());
        go.dataset.axKey = "review";
        go.dataset.axReview = "";
        act.append(go);
        if (!slot.askDiscard) {
          act.append(button("결과 버리기", false, "discard", () => {
            slot.askDiscard = true;
            render(slot);
            slot.root.querySelector<HTMLElement>("[data-ax-key='discard-yes']")?.focus();
          }));
        }
        nodes.push(act);
        if (slot.askDiscard) {
          const ask = element("div", "ax-fail");
          ask.append(element("h5", "", "결과를 버릴까요?"), element("p", "", "버리면 이 결과로는 거래에 넣을 수 없고, 다시 뽑으면 새 비용이 듭니다."));
          const line = element("div", "ax-act");
          const yes = button(slot.busy ? "버리는 중…" : "버리기", true, "discard-yes", () => void cancel(slot, "결과를 버렸습니다."));
          yes.disabled = slot.busy;
          line.append(yes, button("그만두기", false, "discard-no", () => {
            slot.askDiscard = false;
            render(slot);
            slot.root.querySelector<HTMLElement>("[data-ax-key='discard']")?.focus();
          }));
          ask.append(line);
          nodes.push(ask);
        }
        break;
      }
      case "confirmed": {
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("거래에 넣음", "ok")));
        const at = photoShortAtText(group?.confirmedAt ?? "");
        nodes.push(element("p", "ax-soft", `${photoShortAtText(group?.createdAt ?? "")}에 뽑은 값을${at ? ` ${at}에` : ""} 거래에 넣었습니다.`));
        if (slot.note) nodes.push(statusLine(slot));
        const act = element("div", "ax-act");
        act.append(button("다시 뽑기", false, "again", () => toStart(slot)));
        nodes.push(act);
        break;
      }
      case "failed": {
        nodes.push(heading(slot, "AI로 일정 뽑기", tag("✕ 실패", "bad")));
        const box = element("div", "ax-fail");
        box.append(element("h5", "", "두 번 다 결과를 받지 못했습니다"));
        for (const job of group?.jobs ?? []) box.append(element("p", "", `${job.runIndex}회: ${aiJobErrorText(job.errorCode)}`));
        box.append(button("다시 뽑기", false, "again", () => toStart(slot)));
        nodes.push(box);
        if (slot.note) nodes.push(statusLine(slot));
        break;
      }
    }
    root.replaceChildren(...nodes);
    restoreFocus(root, focused);
  }

  function restoreFocus(root: HTMLElement, key: string | null) {
    if (!key) return;
    const target = root.querySelector<HTMLElement>(`[data-ax-key="${CSS.escape(key)}"]`);
    if (target && !(target as HTMLButtonElement).disabled) target.focus({ preventScroll: true });
    else root.querySelector<HTMLElement>("[data-ax-status]")?.focus?.();
  }

  // 펼친 적이 있고, 켜져 있고, 끝나지 않은 거래이고, 사본이 있고, 아직 읽지 않았을 때만 최근 묶음을 읽는다.
  function loadIfWanted(slot: Slot) {
    if (!slot.wanted || !options.enabled() || !slot.deal || isClosed(slot) || slot.phase !== "idle") return;
    if (copiesOf(slot).length === 0) return;
    void loadLatest(slot);
  }

  const stopAll = () => {
    for (const slot of slots.values()) {
      stop(slot);
      slot.seq += 1;
    }
  };
  window.addEventListener("pagehide", stopAll);

  return {
    // 사본 칸(work-contract-copy-section.ts)이 펼친 칸 맨 끝에 붙일 자리
    slot(dealId: string) {
      return slotOf(dealId).root;
    },
    // 사본 칸을 펼쳤을 때: 처음이면 그 거래의 최근 묶음을 읽는다.
    opened(dealId: string) {
      const slot = slotOf(dealId);
      slot.wanted = true;
      loadIfWanted(slot);
    },
    // 손님 카드를 다시 그릴 때(거래 상태·사본 목록이 바뀜)
    update(deal: Pick<CustomerDeal, "id" | "status" | "dealType" | "files">) {
      const slot = slotOf(deal.id);
      slot.deal = deal;
      if (slot.phase === "start" && slot.picked) {
        const copies = copiesOf(slot);
        for (const id of [...slot.picked]) if (!copies.some((file) => file.id === id)) slot.picked.delete(id);
      }
      render(slot);
      // 사본 0장에서 펼친 뒤 첫 사본을 올리면 여기서 읽는다(전에는 '불러오는 중…'에 멈췄다)
      loadIfWanted(slot);
    },
    reset() {
      stopAll();
      slots.clear();
    },
  };
}
