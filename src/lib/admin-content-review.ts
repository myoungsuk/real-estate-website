import {
  validateAdminContent,
  type AdminContentBatchChange,
  type AdminContentValidationResult,
} from "./admin-content-client";
import { createAdminContentDiff } from "./admin-content-diff.mjs";

type DiffKind = "added" | "changed" | "removed" | "reordered";

interface AdminFieldDiff {
  resource: string;
  path: string;
  label: string;
  kind: DiffKind;
  before: string;
  after: string;
}

interface ReviewOptions {
  changes: readonly AdminContentBatchChange[];
  beforeByResource: Record<string, unknown>;
  impactPages: readonly string[];
}

const KIND_LABELS: Record<DiffKind, string> = {
  added: "추가",
  changed: "수정",
  removed: "삭제",
  reordered: "순서 변경",
};

function appendValue(container: HTMLElement, label: string, value: string) {
  const wrapper = document.createElement(value.length > 120 ? "details" : "div");
  wrapper.className = "admin-review-value";
  if (wrapper instanceof HTMLDetailsElement) {
    const summary = document.createElement("summary");
    summary.textContent = `${label}: ${value.slice(0, 72)}${value.length > 72 ? "…" : ""}`;
    const paragraph = document.createElement("p");
    paragraph.textContent = value;
    wrapper.append(summary, paragraph);
  } else {
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    const span = document.createElement("span");
    span.textContent = value;
    wrapper.append(strong, span);
  }
  container.append(wrapper);
}

function createReviewDialog(diffs: readonly AdminFieldDiff[], impactPages: readonly string[]) {
  const dialog = document.createElement("dialog");
  dialog.className = "admin-review-dialog";
  dialog.tabIndex = -1;
  dialog.setAttribute("aria-labelledby", "admin-review-title");

  const shell = document.createElement("div");
  shell.className = "admin-review-dialog__shell";
  const eyebrow = document.createElement("p");
  eyebrow.className = "admin-eyebrow";
  eyebrow.textContent = "SAVE REVIEW";
  const title = document.createElement("h2");
  title.id = "admin-review-title";
  title.textContent = "저장 전 변경 내용 확인";
  const introduction = document.createElement("p");
  introduction.textContent = "GitHub에 저장하기 전에 공개될 변경과 영향 화면을 확인해 주세요.";

  const impact = document.createElement("p");
  impact.className = "admin-review-impact";
  const impactStrong = document.createElement("strong");
  impactStrong.textContent = "영향 화면";
  impact.append(impactStrong, document.createTextNode(` ${impactPages.join(" · ")}`));

  const list = document.createElement("ol");
  list.className = "admin-review-list";
  for (const diff of diffs) {
    const item = document.createElement("li");
    item.className = "admin-review-item";
    const heading = document.createElement("div");
    const label = document.createElement("h3");
    label.textContent = diff.label;
    const badge = document.createElement("span");
    badge.dataset.kind = diff.kind;
    badge.textContent = KIND_LABELS[diff.kind];
    heading.append(label, badge);
    item.append(heading);
    appendValue(item, "변경 전", diff.before);
    appendValue(item, "변경 후", diff.after);
    list.append(item);
  }

  const status = document.createElement("p");
  status.className = "admin-review-status";
  status.dataset.state = "saving";
  status.setAttribute("aria-live", "polite");
  status.textContent = "같은 저장 규칙으로 서버 사전 검증 중입니다.";

  const actions = document.createElement("div");
  actions.className = "admin-review-actions";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "admin-secondary-button";
  cancel.textContent = "편집으로 돌아가기";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "admin-primary-button";
  confirm.textContent = "검증 후 최종 저장";
  confirm.disabled = true;
  actions.append(cancel, confirm);

  shell.append(eyebrow, title, introduction, impact, list, status, actions);
  dialog.append(shell);
  document.body.append(dialog);
  return { dialog, status, cancel, confirm };
}

export async function reviewAdminContentChange({ changes, beforeByResource, impactPages }: ReviewOptions) {
  const diffs = changes.flatMap((change) => createAdminContentDiff(
    change.resource,
    beforeByResource[change.resource],
    change.data,
  )) as AdminFieldDiff[];
  if (diffs.length === 0) throw new Error("변경된 내용이 없습니다.");

  const { dialog, status, cancel, confirm } = createReviewDialog(diffs, impactPages);
  let validation: AdminContentValidationResult | null = null;
  let settled = false;
  const finish = (confirmed: boolean) => {
    if (settled) return confirmed;
    settled = true;
    dialog.close();
    dialog.remove();
    return confirmed;
  };

  const decision = new Promise<boolean>((resolve) => {
    cancel.addEventListener("click", () => resolve(finish(false)), { once: true });
    confirm.addEventListener("click", () => resolve(finish(Boolean(validation))), { once: true });
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      resolve(finish(false));
    }, { once: true });
  });

  dialog.showModal();
  dialog.focus();
  try {
    validation = await validateAdminContent(changes);
    status.dataset.state = "success";
    status.textContent = `사전 검증 완료 · ${validation.changedResources.length}개 공개 리소스 · 기준 commit ${validation.snapshotCommit.slice(0, 8)}`;
    confirm.disabled = false;
  } catch (error) {
    status.dataset.state = "error";
    status.textContent = error instanceof Error ? error.message : "서버 사전 검증에 실패했습니다.";
    confirm.disabled = true;
  }
  return decision;
}

export function guardAdminFormChanges(form: HTMLFormElement | null) {
  let dirty = false;
  const markDirty = () => {
    dirty = true;
    if (form) form.dataset.dirty = "true";
  };
  const markSaved = () => {
    dirty = false;
    if (form) delete form.dataset.dirty;
  };
  const warnBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!dirty) return;
    event.preventDefault();
  };
  form?.addEventListener("input", markDirty);
  form?.addEventListener("change", markDirty);
  window.addEventListener("beforeunload", warnBeforeUnload);
  return { markDirty, markSaved, isDirty: () => dirty };
}
