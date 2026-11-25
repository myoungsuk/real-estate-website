// 글 초안 화면 맨 위 '기다리던 글' 알림(2026-11-25 사용자 결정 "추천대로"). 글 초안 화면(blog.astro)만 쓴다.
// 만드는 중에 화면을 닫아도 서버가 글을 받아 두므로, 이 브라우저가 기다리던 초안 번호(UUID)만 localStorage에 기억했다가
// 다음에 화면을 열 때 서버 보관 목록과 맞춰 "다 만들어졌습니다 · 글 열기"(또는 만들지 못한 까닭)를 보인다.
// - 저장소에는 초안 번호 배열만 넣는다(글·제목·단지 이름·소재지 없음). 글자·순수 계산은 work/blog-wait-view.mjs.
// - 저장소를 쓸 수 없는 브라우저(막아 둠·사생활 보호 창)에서는 기억하지 못할 뿐, 화면은 그대로 돈다.
// - 서버 요청을 하지 않는다(목록은 화면이 이미 받은 것을 넘겨받음).
import type { BlogDraftListItem } from "./work-blog-client";
import { isOpenStatus } from "./work/blog-view.mjs";
import {
  BLOG_WAITING_STORAGE_KEY,
  addWaitingId,
  parseWaitingIds,
  removeWaitingId,
  serializeWaitingIds,
  waitingNotices,
} from "./work/blog-wait-view.mjs";

interface WaitNotice { id: string; kind: "done" | "failed"; title: string; detail: string; action: string; name: string }

function readIds(): string[] {
  try {
    return parseWaitingIds(globalThis.localStorage?.getItem(BLOG_WAITING_STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}

function writeIds(ids: string[]) {
  try {
    if (ids.length === 0) globalThis.localStorage?.removeItem(BLOG_WAITING_STORAGE_KEY);
    else globalThis.localStorage?.setItem(BLOG_WAITING_STORAGE_KEY, serializeWaitingIds(ids));
  } catch {
    // 저장소를 쓸 수 없으면 기억하지 않는다.
  }
}

/** @param box 알림을 그릴 빈 상자(role=status) @param open '글 열기'를 눌렀을 때 그 초안을 여는 함수 */
export function createBlogWaitNotice(box: HTMLElement, open: (id: string) => void) {
  let shown: WaitNotice[] = [];

  function render() {
    box.replaceChildren(...shown.map((notice) => {
      const item = document.createElement("div");
      item.className = "bl-waited__item";
      item.dataset.state = notice.kind;
      const text = document.createElement("p");
      const title = document.createElement("strong");
      title.textContent = notice.title;
      const detail = document.createElement("span");
      detail.textContent = notice.detail;
      text.append(title, detail);
      const button = document.createElement("button");
      button.type = "button";
      button.className = notice.kind === "done" ? "work-primary-button" : "work-secondary-button";
      button.textContent = notice.action;
      button.setAttribute("aria-label", `${notice.name} ${notice.action}`);
      button.addEventListener("click", () => open(notice.id));
      item.append(text, button);
      return item;
    }));
    box.hidden = shown.length === 0;
  }

  return {
    // 초안을 화면에 띄울 때마다 부른다. 만드는 중이면 기억하고, 끝났거나 닫힌 초안이면(= 열어 봤으면) 잊고 그 알림을 지운다.
    track(draft: { id: string; status: string; closed: string | null }) {
      const ids = readIds();
      if (isOpenStatus(draft.status) && !draft.closed) {
        writeIds(addWaitingId(ids, draft.id));
        return;
      }
      if (ids.includes(draft.id)) writeIds(removeWaitingId(ids, draft.id));
      if (shown.some((notice) => notice.id === draft.id)) {
        shown = shown.filter((notice) => notice.id !== draft.id);
        render();
      }
    },
    // 보관 목록을 새로 받을 때마다 부른다. skipId: 지금 화면에서 기다리는 초안(알림을 띄우지 않음).
    sync(items: BlogDraftListItem[], skipId: string | null = null) {
      const ids = readIds();
      const { keep, notices } = waitingNotices(ids, items, { nowMs: Date.now(), skipId });
      if (keep.length !== ids.length) writeIds(keep);
      shown = notices as WaitNotice[];
      render();
    },
  };
}
