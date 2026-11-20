// 손님·메모 화면(단계 2)이 함께 쓰는 화면 조각. 서버 요청·브라우저 저장·주소 변경을 하지 않는다(서버 요청은 work-customers-client.ts 한 곳).
// 이름·전화·메모 글은 textContent로만 넣는다(HTML로 해석하지 않음).
import type { Customer, CustomerStatus, Note } from "./work-customers-client";
import { CUSTOMER_STATUS_LABELS, agoText, customerHref, dateText, isCleanupDue, noteTimeText, phoneText } from "./work/customers-view.mjs";

const statusLabels = CUSTOMER_STATUS_LABELS as Record<string, string>;

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// 상태 글자(테두리 상자 + 글자. 색만으로 구분하지 않음)
export function statusBadge(status: CustomerStatus) {
  return element("span", `cu-status cu-status--${status}`, statusLabels[status] ?? status);
}

const PHONE_ICON = "M6.5 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z";
function phoneIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ class: "admin-icon", width: "20", height: "20", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", focusable: "false" })) {
    svg.setAttribute(key, value);
  }
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", PHONE_ICON);
  svg.append(path);
  return svg;
}

// 손님 목록 카드: 이름(누르면 손님 카드)·상태 / 찾는 조건 2줄 / 마지막 연락 / 전화 단추
export function customerCard(customer: Customer, today: string) {
  const item = element("li", "cu-card");
  const link = element("a", "cu-card__link");
  link.href = customerHref(customer.id);
  link.append(element("span", "cu-card__name", customer.displayName), statusBadge(customer.status));
  item.append(link);
  if (customer.needs) item.append(element("p", "cu-card__needs", customer.needs));
  const meta = element("p", "cu-card__meta");
  meta.append(element("span", "", customer.lastContactOn ? `마지막 연락 ${dateText(customer.lastContactOn, today)} · ${agoText(customer.lastContactOn, today)}` : "마지막 연락 기록 없음"));
  if (isCleanupDue(customer, today)) meta.append(element("span", "admin-badge admin-badge--warning cu-cleanup", "정리할 때 지남"));
  item.append(meta);
  if (customer.phoneDigits) {
    const call = element("a", "cu-card__call");
    call.href = `tel:${customer.phoneDigits}`;
    call.setAttribute("aria-label", `${customer.displayName}에게 전화 ${phoneText(customer.phoneDigits)}`);
    call.append(phoneIcon(), element("span", "", phoneText(customer.phoneDigits)));
    item.append(call);
  } else {
    item.append(element("span", "cu-card__nophone", "전화번호 없음"));
  }
  return item;
}

// 메모 한 개(시각·글). 단추는 화면마다 붙인다.
export function noteItem(note: Note, today: string, className = "cu-memo") {
  const item = element("li", className);
  item.append(element("p", "cu-memo__at", noteTimeText(note.createdAt, today)), element("p", "cu-memo__body", note.body));
  return item;
}

export interface CustomerFieldValues { displayName: string; phone: string; needs: string; status: string }

const field = <T extends HTMLElement>(root: ParentNode, key: string) => root.querySelector<T>(`[data-cu-field="${key}"]`);

export function readFields(root: ParentNode): CustomerFieldValues {
  const checked = root.querySelector<HTMLInputElement>('[data-cu-field="status"]:checked');
  return {
    displayName: field<HTMLInputElement>(root, "displayName")?.value ?? "",
    phone: field<HTMLInputElement>(root, "phone")?.value ?? "",
    needs: field<HTMLTextAreaElement>(root, "needs")?.value ?? "",
    status: checked?.value ?? "",
  };
}

export function fillFields(root: ParentNode, customer: Customer | null) {
  const name = field<HTMLInputElement>(root, "displayName");
  const phone = field<HTMLInputElement>(root, "phone");
  const needs = field<HTMLTextAreaElement>(root, "needs");
  if (name) name.value = customer?.displayName ?? "";
  if (phone) phone.value = customer?.phoneDigits ? phoneText(customer.phoneDigits) : "";
  if (needs) needs.value = customer?.needs ?? "";
  for (const radio of root.querySelectorAll<HTMLInputElement>('[data-cu-field="status"]')) radio.checked = radio.value === (customer?.status ?? "consulting");
  showFieldErrors(root, {});
}

// 칸별 오류 표시. 오류가 있으면 첫 칸으로 포커스를 옮긴다.
export function showFieldErrors(root: ParentNode, errors: Record<string, string>) {
  let first: HTMLElement | null = null;
  for (const slot of root.querySelectorAll<HTMLElement>("[data-cu-error]")) {
    const key = slot.dataset.cuError ?? "";
    const message = errors[key] ?? "";
    slot.textContent = message;
    const control = field<HTMLElement>(root, key);
    if (control) {
      if (message) control.setAttribute("aria-invalid", "true");
      else control.removeAttribute("aria-invalid");
      if (message && !first) first = control;
    }
  }
  if (!first && errors.status) first = root.querySelector<HTMLElement>('[data-cu-field="status"]');
  first?.focus();
}

export function setStatus(target: HTMLElement, text: string, state: "idle" | "saving" | "success" | "error" = "idle") {
  target.textContent = text;
  target.dataset.state = state;
}
