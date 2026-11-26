// 계약서 AI 결과 고르기 화면에서 '거래에 넣기'가 된 뒤 보이는 '매출장부에 보수 줄 넣기' 칸(중개날개 대조표 16절 2위, 2026-11-25).
// - 서버 요청은 장부 클라이언트(work-ledger-client.ts) 그대로: 칸을 만들 때 그 거래의 보수 줄 목록(GET ledger?dealId=&kind=fee, 감사 ledger.list) 한 번,
//   사람이 '장부에 넣기'를 누르면 고른 쪽마다 POST ledger 한 번씩. 저절로 넣지 않고 다시 보내지도 않는다.
// - 그 거래에 보수 줄이 이미 있으면 미리 채우지 않는다(같은 줄을 두 번 만들지 않게). 답 없이 끊기면 목록을 다시 읽어 들어갔는지 본다.
// - 값·글은 순수 함수 work/ai-ledger-prefill.mjs와 ledger-view.mjs. 금액·거래 제목은 화면 메모리에만 둔다(주소·제목·브라우저 저장소 없음).
import legalRules from "../data/work/legal-rules.json";
import { WorkApiError } from "./work-customers-client";
import { element, setStatus } from "./work-customers-dom";
import { createLedgerEntry, listLedger } from "./work-ledger-client";
import {
  AI_LEDGER_HEADING,
  AI_LEDGER_LOADING_TEXT,
  AI_LEDGER_RECHECK_TEXT,
  aiLedgerButtonText,
  aiLedgerDoneText,
  aiLedgerExistingText,
  aiLedgerFeeCount,
  aiLedgerPartialText,
  aiLedgerPartialUnsureText,
  aiLedgerPrefill,
  aiLedgerVatFollow,
} from "./work/ai-ledger-prefill.mjs";
import { customerErrorText, customerSaveErrorText, dealSaveUnsure, isRetryable } from "./work/customers-view.mjs";
import { LEDGER_LABEL_MAX, LEDGER_PAGE_SIZE, checkLedgerInput, ledgerErrorText, ledgerListQuery, parseWon } from "./work/ledger-view.mjs";

interface PrefillDeal { id: string; title: string; dealType: string; [key: string]: unknown }

const codeOf = (error: unknown) => (error instanceof WorkApiError ? error.code : null);
const httpOf = (error: unknown) => (error instanceof WorkApiError ? error.status : 0);

/** 거래에 넣은 뒤의 거래(확정 응답)와 그 거래에 붙은 손님들의 쪽으로 칸을 만들고 곧바로 보수 줄 목록을 한 번 읽는다. */
export function aiLedgerSection(deal: PrefillDeal, partyRoles: string[]): HTMLElement {
  const section = element("section", "axl");
  section.dataset.axl = "";
  const heading = element("h2", "ax-sub", AI_LEDGER_HEADING);
  heading.id = "axl-title";
  section.setAttribute("aria-labelledby", heading.id);
  const content = element("div", "axl__body");
  const status = element("p", "admin-form-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.tabIndex = -1;
  status.dataset.axlStatus = "";
  section.append(heading, content, status);

  let busy = false;
  let form: ReturnType<typeof buildForm> | null = null;
  const ledgerLink = () => {
    const link = element("a", "admin-text-link", "매출장부에서 보기");
    link.href = "/admin/work/ledger/";
    return link;
  };
  const readFees = async () => {
    const page = await listLedger(ledgerListQuery({ dealId: deal.id, all: true, kind: "fee", limit: LEDGER_PAGE_SIZE }));
    return { count: aiLedgerFeeCount(page.items), more: Boolean(page.nextCursor) };
  };

  function showExisting(text: string) {
    const line = element("p", "", text);
    line.dataset.axlExisting = "";
    content.replaceChildren(line, ledgerLink());
    setStatus(status, "", "idle");
  }

  function showForm() {
    form ??= buildForm();
    content.replaceChildren(form.node);
    form.sync();
  }

  async function start() {
    content.replaceChildren();
    setStatus(status, AI_LEDGER_LOADING_TEXT, "saving");
    try {
      const fees = await readFees();
      if (fees.count > 0) showExisting(aiLedgerExistingText(fees.count, fees.more));
      else {
        setStatus(status, "", "idle");
        showForm();
      }
    } catch (error) {
      const code = codeOf(error);
      setStatus(status, `장부 줄을 확인하지 못해 미리 채우지 않았습니다. ${ledgerErrorText(code, customerErrorText(code))}`, "error");
      if (isRetryable(code)) {
        const retry = element("button", "work-secondary-button", "다시 확인하기");
        retry.type = "button";
        retry.dataset.axlRetry = "";
        retry.addEventListener("click", () => void start());
        const row = element("div", "ax-act");
        row.append(retry);
        content.replaceChildren(row);
      }
    }
  }

  // 쪽마다 공급가액·부가세 두 칸. 입금은 0원으로 넣는다(받은 뒤 매출장부에서 적음).
  function buildForm() {
    const prefill = aiLedgerPrefill(deal, partyRoles, legalRules);
    const node = element("div", "lg-pair");
    const lead = element("p", "lg-cap", prefill.lead);
    lead.setAttribute("role", "note");
    lead.dataset.axlLead = prefill.filled ? "filled" : "empty";
    const pickRow = element("div", "work-segment");
    pickRow.setAttribute("role", "group");
    pickRow.setAttribute("aria-label", "낸 쪽");
    const sides = prefill.sides.map((side) => {
      const base = `axl-${side.role}`;
      const choice = element("label", "work-choice");
      const check = element("input");
      check.type = "checkbox";
      check.autocomplete = "off";
      check.checked = side.checked;
      check.value = side.role;
      check.dataset.axlSide = side.role;
      choice.append(check, element("span", "", side.label));
      pickRow.append(choice);
      const one = element("fieldset", "lg-pair__one");
      one.hidden = !side.checked;
      one.append(element("legend", "", side.label));
      const money = element("div", "lg-money");
      const inputs: Record<"amount" | "vat", HTMLInputElement> = {} as Record<"amount" | "vat", HTMLInputElement>;
      const errors: Record<string, HTMLElement> = {};
      for (const [name, label, value] of [["amount", "공급가액(원)", side.amountText], ["vat", "부가세(원)", side.vatText]] as const) {
        const row = element("div", "work-row");
        const labelNode = element("label", "work-row__label", label);
        labelNode.htmlFor = `${base}-${name}`;
        const control = element("div", "work-row__control");
        const input = element("input");
        input.id = `${base}-${name}`;
        input.type = "text";
        input.inputMode = "numeric";
        input.autocomplete = "off";
        input.value = value;
        input.dataset[name === "amount" ? "axlAmount" : "axlVat"] = side.role;
        const error = element("small", "cu-error");
        error.id = `${base}-${name}-error`;
        input.setAttribute("aria-describedby", error.id);
        control.append(input, error);
        row.append(labelNode, control);
        money.append(row);
        inputs[name] = input;
        errors[name] = error;
      }
      // 공급가액을 고치면 부가세가 10%였을 때만 따라 바꾼다(매출장부 표와 같은 규칙).
      let prevAmount = parseWon(inputs.amount.value) ?? 0;
      inputs.amount.addEventListener("input", () => {
        const follow = aiLedgerVatFollow(prevAmount, inputs.vat.value, inputs.amount.value);
        if (follow !== null) inputs.vat.value = follow;
        const parsed = parseWon(inputs.amount.value);
        if (!Number.isNaN(parsed)) prevAmount = parsed ?? 0;
      });
      one.append(money);
      return { role: side.role, check, one, inputs, errors };
    });
    const soft = element("p", "ax-soft", "부가세는 공급가액을 고치면 10%로 따라 바뀝니다(부가세를 따로 고쳤으면 그대로 둡니다). 입금액은 0원으로 넣습니다. 보수를 받으면 매출장부에서 입금액·입금일을 적어 주세요.");
    const actions = element("div", "ax-act");
    const save = element("button", "work-primary-button");
    save.type = "button";
    save.dataset.axlSave = "";
    actions.append(save);
    const chosen = () => sides.filter((side) => side.check.checked);
    const sync = () => {
      save.textContent = busy ? "넣는 중…" : aiLedgerButtonText(chosen().length);
      save.disabled = busy || chosen().length === 0;
    };
    for (const side of sides) side.check.addEventListener("change", () => {
      side.one.hidden = !side.check.checked;
      sync();
    });
    save.addEventListener("click", () => void submit());
    node.append(lead, pickRow, ...sides.map((side) => side.one), soft, actions);

    async function submit() {
      if (busy) return;
      const bodies: Record<string, unknown>[] = [];
      let firstBad: HTMLInputElement | null = null;
      for (const side of chosen()) {
        const checked = checkLedgerInput({ amount: side.inputs.amount.value, vat: side.inputs.vat.value, received: "0", receivedOn: "" }, { kind: "fee", hasDeal: true });
        for (const [name, error] of Object.entries(side.errors)) {
          const text = checked.ok ? "" : checked.errors[name] ?? "";
          const input = side.inputs[name as "amount" | "vat"];
          error.textContent = text;
          if (text) input.setAttribute("aria-invalid", "true");
          else input.removeAttribute("aria-invalid");
          if (text && !firstBad) firstBad = input;
        }
        if (checked.ok) bodies.push({ ...checked.value, kind: "fee", dealId: deal.id, payerRole: side.role, label: deal.title.slice(0, LEDGER_LABEL_MAX) });
      }
      if (firstBad) {
        setStatus(status, "빨간 글자가 있는 칸을 고쳐 주세요.", "error");
        (firstBad as HTMLInputElement).focus();
        return;
      }
      busy = true;
      sync();
      setStatus(status, "장부에 넣고 있습니다…", "saving");
      let made = 0;
      let warned = false;
      try {
        for (const body of bodies) {
          const result = await createLedgerEntry(body);
          made += 1;
          if (result.warnings.length > 0) warned = true;
        }
        busy = false;
        content.replaceChildren(ledgerLink());
        setStatus(status, aiLedgerDoneText(made, warned), "success");
        status.focus();
      } catch (error) {
        busy = false;
        const code = codeOf(error);
        const reason = ledgerErrorText(code, customerSaveErrorText(code, error));
        if (made > 0) {
          // 한 줄이라도 들어갔으면 칸을 다시 보이지 않는다(같은 줄을 두 번 만들지 않게).
          content.replaceChildren(ledgerLink());
          // 답 없이 끊겼으면 그 줄도 들어갔을 수 있어 "넣지 못했다"고 단정하지 않는다(손으로 다시 넣어 같은 줄이 두 번 생기지 않게).
          setStatus(status, dealSaveUnsure(code, httpOf(error)) ? aiLedgerPartialUnsureText(made) : aiLedgerPartialText(made, reason), "error");
        } else if (dealSaveUnsure(code, httpOf(error))) {
          await recheck(reason);
        } else {
          sync();
          setStatus(status, `장부에 넣지 못했습니다. ${reason}`, "error");
        }
        status.focus();
      }
    }

    // 답 없이 끊겼으면(코드 없음·5xx) 서버가 넣고 답만 잃었을 수 있어 그 거래의 보수 줄을 한 번 다시 읽는다. 다시 보내지는 않는다.
    async function recheck(reason: string) {
      content.replaceChildren();
      setStatus(status, AI_LEDGER_RECHECK_TEXT, "saving");
      try {
        const fees = await readFees();
        if (fees.count > 0) {
          showExisting(`답이 오지 않았지만 다시 확인해 보니 이 거래에 보수 줄이 ${fees.count}줄 있습니다. 다시 누르지 않아도 됩니다. 빠진 쪽이 있으면 손님 카드의 '장부 보기' → '보수 줄 만들기'에서 넣어 주세요.`);
          return;
        }
        showForm();
        setStatus(status, `장부에 넣지 못했습니다. ${reason}`, "error");
      } catch {
        content.replaceChildren(ledgerLink());
        setStatus(status, "답이 오지 않아 장부에 들어갔는지 확인하지 못했습니다. 손님 카드의 '장부 보기'에서 확인한 뒤, 없으면 '보수 줄 만들기'로 넣어 주세요.", "error");
      }
    }

    return { node, sync };
  }

  void start();
  return section;
}
