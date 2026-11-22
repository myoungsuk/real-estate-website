// 지우기 화면(메모 창고·매출장부·할 일)의 지운 뒤 알림 한 줄: "✓ 메모를 휴지통으로 옮겼습니다. 되살리기 · 휴지통 보기"(시안 2026-11-22 14:42:41).
// '되살리기'는 지운 응답의 묶음 id로 바로 되살린다. 응답에 휴지통 값이 없으면 '휴지통 보기'만 붙인다. 서버 요청은 work-trash-client.ts 한 곳.
import { element, setStatus } from "./work-customers-dom";
import { WorkApiError, restoreTrash, type TrashRef } from "./work-trash-client";
import { customerErrorText } from "./work/customers-view.mjs";
import { isTrashStale, movedToTrashText, trashErrorText, undoneText } from "./work/trash-view.mjs";

export const TRASH_PAGE_HREF = "/admin/work/trash/";

interface MovedOptions {
  // 되살린 뒤(또는 다른 화면이 먼저 되살렸거나 지운 뒤) 그 화면 목록을 다시 읽는다.
  reload: () => Promise<unknown>;
  // 화면의 한 번에 하나만 하기(busy). 시작하지 못하면 false.
  begin: () => boolean;
  end: () => void;
}

const trashLink = () => {
  const link = element("a", "admin-text-link", "휴지통 보기");
  link.href = TRASH_PAGE_HREF;
  return link;
};

/** @param target 알림 줄(role=status) @param what 메모·장부 줄·할 일 @param trash 지운 응답의 휴지통 값 */
export function showMovedToTrash(target: HTMLElement, what: string, trash: TrashRef | null | undefined, options: MovedOptions) {
  setStatus(target, `${movedToTrashText(what)} `, "success");
  target.hidden = false;
  if (trash?.batchId) {
    const undo = element("button", "admin-text-link cu-linkbtn", "되살리기");
    undo.type = "button";
    undo.addEventListener("click", async () => {
      if (!options.begin()) return;
      undo.disabled = true;
      setStatus(target, "되살리고 있습니다…", "saving");
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus();
      try {
        await restoreTrash(trash.batchId);
        await options.reload();
        setStatus(target, undoneText(what), "success");
      } catch (error) {
        const code = error instanceof WorkApiError ? error.code : null;
        if (isTrashStale(code)) await options.reload().catch(() => undefined);
        setStatus(target, `${trashErrorText(code, customerErrorText(code))} `, "error");
        target.append(trashLink());
      } finally {
        options.end();
        target.hidden = false;
        target.focus();
      }
    });
    target.append(undo, " · ");
  }
  target.append(trashLink());
}
