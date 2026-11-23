// 손님 카드 '사진' 칸(단계 2 바로 찍기, 시안 2026-11-22 15:39:08 "이 시안대로"). 서버 요청은 work-files-client.ts 한 곳.
// - '바로 찍기'는 카메라 화면이 보이는 일반 촬영(<input capture="environment">)이고, 숨긴 촬영·카메라 미리보기는 만들지 않는다(DEC-WT-27).
// - 찍거나 고른 사진은 화면 안에서 다시 저장한 뒤(work-photo-dom.ts) 칸 안 확인 칸에 보이고, '신분증·주민번호 없음 확인, 올리기'로 올린다.
// - iPhone은 찍은 사진을 사진첩에 남기지 않을 수 있어(추정) 다 올릴 때까지 화면 메모리에 두고, 못 올리면 '다시 올리기'(같은 바이트·같은 SHA-256).
//   남은 사진이 있으면 떠날 때 묻는다(hasPending, 손님 카드의 beforeunload). 브라우저 저장소에는 넣지 않는다.
// - 사진을 누르면 칸 위 '사진 크게 보기'에서 원본을 보고 설명을 고치거나 지운다(지우기는 칸 안에서 한 번 더 묻기, 휴지통 7일).
// - 크게 보기의 '얼굴 가려서 내보내기'(단계 3 M-b, 사용자 결정 2026-11-23 08:55:04 "나안: 화면 전체 (Recommended)")는 화면 전체 창에서
//   이미 받아 둔 원본 그림에 네모를 그려 모자이크한 사본을 '가려서 내려받기'·'가려서 공유'로만 내보낸다. 서버로 올리지 않고(T3-20),
//   원본 내려받기 단추는 없다(DEC-WT-42). 키보드로는 그릴 수 없다(첫판에서 뺌, 창에 안내).
// 설명에는 손님 이름이 들어갈 수 있으므로 화면에만 보이고 주소·브라우저 저장소·로그에 넣지 않는다.
import type { CustomerFile } from "./work-customers-client";
import { element, setStatus } from "./work-customers-dom";
import { WorkApiError, deleteFile, fileContentUrl, fileThumbUrl, updateFileCaption, uploadPhoto, uploadThumb, type PhotoKind } from "./work-files-client";
import { PhotoPrepareError, preparePhoto, previewCanvas, type PreparedPhoto } from "./work-photo-dom";
import { MaskError, openMaskEditor, type MaskEditor, type MaskState } from "./work-mask-canvas";
import { showMovedToTrash } from "./work-trash-dom";
import { todayInKorea } from "./work/legal-dates.mjs";
import { maskCountText, maskedFileName } from "./work/mosaic.mjs";
import { customerErrorText } from "./work/customers-view.mjs";
import {
  PHOTO_GO_LABEL,
  PHOTO_PAGE_SIZE,
  captionCountText,
  captionMissedText,
  checkCaption,
  checkPickCount,
  groupByDay,
  isUploadRetryable,
  photoAtText,
  photoButtonLabel,
  photoMetaText,
  photoShownText,
  photoSizeText,
  photoTimeText,
  photosOffText,
  prepareErrorText,
  PHOTO_ERROR_TEXTS,
  uploadFailText,
  uploadTitleText,
  uploadedText,
} from "./work/photo-view.mjs";

interface PhotoSectionOptions {
  // 지금 손님 id(주소의 ?id=, UUID만)
  customerId: () => string | null;
  // 손님 카드 전체를 다시 읽는다(사진 목록 포함). 끝나면 render가 다시 불린다.
  reload: () => Promise<unknown>;
}

type PendingState = "ready" | "busy" | "done" | "fail";
interface Pending {
  prepared: PreparedPhoto;
  state: PendingState;
  code: string | null;
  captionMissed: boolean;
}

const codeOf = (error: unknown) => (error instanceof WorkApiError ? error.code : null);
const photoErrorText = (code: string | null) => (code && PHOTO_ERROR_TEXTS[code as keyof typeof PHOTO_ERROR_TEXTS]) || customerErrorText(code ?? "");

export function mountPhotoSection(root: HTMLElement, options: PhotoSectionOptions) {
  const pick = <T extends HTMLElement>(selector: string) => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`사진 칸이 없습니다: ${selector}`);
    return found;
  };
  const count = pick("[data-ph-count]");
  const off = pick("[data-ph-off]");
  const take = pick("[data-ph-take]");
  const cameraButton = pick<HTMLButtonElement>("[data-ph-camera]");
  const albumButton = pick<HTMLButtonElement>("[data-ph-album]");
  const cameraInput = pick<HTMLInputElement>("[data-ph-camera-input]");
  const albumInput = pick<HTMLInputElement>("[data-ph-album-input]");
  const status = pick("[data-ph-status]");
  const list = pick("[data-ph-list]");
  const empty = pick("[data-ph-empty]");
  const moreLine = pick("[data-ph-more-line]");
  const moreButton = pick<HTMLButtonElement>("[data-ph-more]");
  const shownText = pick("[data-ph-shown]");
  // 확인 칸
  const check = pick("[data-ph-check]");
  const checkHeading = pick("#ph-check-title");
  const checkTitle = pick("[data-ph-check-title]");
  const checkCount = pick("[data-ph-check-count]");
  const preview = pick("[data-ph-preview]");
  const previewBox = pick("[data-ph-preview-canvas]");
  const previewSize = pick("[data-ph-preview-size]");
  const picks = pick("[data-ph-picks]");
  const warn = pick("[data-ph-warn]");
  const kindRow = pick("[data-ph-kind]");
  const descRow = pick("[data-ph-desc-row]");
  const desc = pick<HTMLTextAreaElement>("[data-ph-desc]");
  const descHint = pick("[data-ph-desc-hint]");
  const descCount = pick("[data-ph-desc-n]");
  const what = pick("[data-ph-what]");
  const max = pick("[data-ph-max]");
  const failText = pick("[data-ph-fail-text]");
  const goButton = pick<HTMLButtonElement>("[data-ph-go]");
  const cancelButton = pick<HTMLButtonElement>("[data-ph-cancel]");
  const drop = pick("[data-ph-drop]");
  const dropGo = pick<HTMLButtonElement>("[data-ph-drop-go]");
  const checkStatus = pick("[data-ph-check-status]");
  // 크게 보기
  const view = pick("[data-ph-view]");
  const viewHeading = pick("#ph-view-title");
  const viewWait = pick("[data-ph-view-wait]");
  const viewImage = pick<HTMLImageElement>("[data-ph-view-img]");
  const viewMeta = pick("[data-ph-view-meta]");
  const viewDesc = pick<HTMLTextAreaElement>("[data-ph-view-desc]");
  const viewDescCount = pick("[data-ph-view-desc-n]");
  const viewSave = pick<HTMLButtonElement>("[data-ph-view-save]");
  const viewStatus = pick("[data-ph-view-status]");
  const viewDelete = pick<HTMLButtonElement>("[data-ph-view-delete]");
  const del = pick("[data-ph-del]");
  const delGo = pick<HTMLButtonElement>("[data-ph-del-go]");
  const delStatus = pick("[data-ph-del-status]");
  // 얼굴 가려서 내보내기
  const maskOpen = pick<HTMLButtonElement>("[data-ph-mask-open]");
  const mask = pick<HTMLDialogElement>("[data-ph-mask]");
  const maskCanvas = pick<HTMLCanvasElement>("[data-ph-mask-canvas]");
  const maskWait = pick("[data-ph-mask-wait]");
  const maskCount = pick("[data-ph-mask-count]");
  const maskUndo = pick<HTMLButtonElement>("[data-ph-mask-undo]");
  const maskRedo = pick<HTMLButtonElement>("[data-ph-mask-redo]");
  const maskClear = pick<HTMLButtonElement>("[data-ph-mask-clear]");
  const maskDownload = pick<HTMLButtonElement>("[data-ph-mask-download]");
  const maskShare = pick<HTMLButtonElement>("[data-ph-mask-share]");
  const maskStatus = pick("[data-ph-mask-status]");

  let files: CustomerFile[] = [];
  let enabled = false;
  let shown = PHOTO_PAGE_SIZE;
  let pending: Pending[] = [];
  let source: "camera" | "album" = "camera";
  let preparing = false;
  let uploading = false;
  let busy = false; // 크게 보기의 설명 저장·지우기, 지운 뒤 '되살리기'
  let viewId: string | null = null;
  let captionToApply = "";
  let kindToApply: PhotoKind = "property_photo";

  function say(text: string, state: "idle" | "saving" | "success" | "error" = "idle") {
    setStatus(status, text, state);
    status.hidden = !text;
  }

  // ── 목록 ──
  function thumbButton(file: CustomerFile) {
    const button = element("button", "ph-thumb");
    button.type = "button";
    button.dataset.phOpen = file.id;
    button.setAttribute("aria-label", photoButtonLabel(file));
    if (file.id === viewId) {
      button.classList.add("is-current");
      button.setAttribute("aria-current", "true");
    }
    const image = element("img");
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 480;
    image.height = 480;
    // 미리보기가 없거나(404) 읽지 못하면 글자 자리표
    image.addEventListener("error", () => image.replaceWith(element("span", "ph-thumb__none", "미리보기 없음")), { once: true });
    image.src = fileThumbUrl(file.id);
    button.append(image, element("span", "ph-thumb__at", photoTimeText(file.createdAt)));
    if (file.caption) button.append(element("span", "ph-thumb__desc", file.caption));
    button.addEventListener("click", () => openView(file.id));
    return button;
  }

  function renderList() {
    const visible = files.slice(0, shown);
    const nodes: HTMLElement[] = [];
    for (const group of groupByDay(visible)) {
      const items = element("ol", "ph-grid");
      for (const file of group.items) {
        const item = element("li");
        item.append(thumbButton(file));
        items.append(item);
      }
      nodes.push(element("h3", "ph-day", group.day), items);
    }
    list.replaceChildren(...nodes);
    empty.hidden = files.length > 0;
    moreLine.hidden = files.length <= shown;
    shownText.textContent = photoShownText(Math.min(shown, files.length), files.length);
  }

  function render(nextFiles: CustomerFile[], nextEnabled: boolean) {
    files = nextFiles;
    enabled = nextEnabled;
    count.textContent = files.length > 0 ? `${files.length.toLocaleString("ko-KR")}장` : "";
    off.hidden = enabled;
    off.textContent = enabled ? "" : photosOffText(files.length);
    take.hidden = !enabled || pending.length > 0;
    list.hidden = !enabled;
    if (!enabled) {
      list.replaceChildren();
      empty.hidden = true;
      moreLine.hidden = true;
      closeView(false);
      return;
    }
    if (viewId && !files.some((file) => file.id === viewId)) closeView(false);
    renderList();
  }

  moreButton.addEventListener("click", () => {
    const first = shown;
    shown += PHOTO_PAGE_SIZE;
    renderList();
    list.querySelectorAll<HTMLButtonElement>(".ph-thumb")[first]?.focus();
  });

  // ── 고르기 → 다시 저장 → 확인 칸 ──
  function openPicker(kind: "camera" | "album") {
    if (!enabled || preparing || pending.length > 0) {
      root.scrollIntoView({ block: "start" });
      return;
    }
    (kind === "camera" ? cameraInput : albumInput).click();
  }
  cameraButton.addEventListener("click", () => openPicker("camera"));
  albumButton.addEventListener("click", () => openPicker("album"));

  async function handlePicked(input: HTMLInputElement, from: "camera" | "album") {
    const chosen = [...(input.files ?? [])];
    // 같은 사진을 다시 골라도 change가 오도록 바로 비운다(파일 이름은 어디에도 남기지 않음).
    input.value = "";
    const checked = checkPickCount(chosen.length);
    if (!checked.ok) {
      if (checked.error) say(checked.error, "error");
      return;
    }
    source = from;
    preparing = true;
    cameraButton.disabled = true;
    albumButton.disabled = true;
    say(chosen.length > 1 ? `사진 ${chosen.length}장을 준비하고 있습니다…` : "사진을 준비하고 있습니다…", "saving");
    const ready: Pending[] = [];
    const failed = new Map<string, number>();
    for (const file of chosen) {
      try {
        ready.push({ prepared: await preparePhoto(file), state: "ready", code: null, captionMissed: false });
      } catch (error) {
        const code = error instanceof PhotoPrepareError ? error.code : "ENCODE_FAILED";
        failed.set(code, (failed.get(code) ?? 0) + 1);
      }
    }
    preparing = false;
    cameraButton.disabled = false;
    albumButton.disabled = false;
    const problems = [...failed].map(([code, n]) => prepareErrorText(code, chosen.length > 1 ? n : 1)).join(" ");
    if (ready.length === 0) {
      say(problems, "error");
      return;
    }
    say(problems, problems ? "error" : "idle");
    pending = ready;
    desc.value = "";
    descCount.textContent = captionCountText("");
    root.querySelector<HTMLInputElement>('[data-ph-kind-input][value="property_photo"]')!.checked = true;
    setStatus(checkStatus, "", "idle");
    renderCheck();
    check.scrollIntoView({ block: "start" });
    checkHeading.focus({ preventScroll: true });
  }
  cameraInput.addEventListener("change", () => void handlePicked(cameraInput, "camera"));
  albumInput.addEventListener("change", () => void handlePicked(albumInput, "album"));

  const STATE_LABELS: Record<PendingState, string> = { ready: "", busy: "올리는 중…", done: "✓ 올림", fail: "✕ 못 올림" };
  function renderCheck() {
    if (pending.length === 0) {
      check.hidden = true;
      take.hidden = !enabled;
      return;
    }
    const total = pending.length;
    const done = pending.filter((item) => item.state === "done").length;
    const failedItems = pending.filter((item) => item.state === "fail");
    const allReady = pending.every((item) => item.state === "ready");
    const heading = uploadTitleText({ source, total, done, failed: uploading ? 0 : failedItems.length, busy: uploading });
    check.hidden = false;
    take.hidden = true;
    check.classList.toggle("cu-panel--danger", !uploading && failedItems.length > 0);
    check.setAttribute("aria-busy", String(uploading));
    checkTitle.textContent = heading.title;
    checkCount.textContent = heading.count;
    // 한 장을 고른 직후는 크게, 그 밖에는 작은 칸 여러 개(올리는 상태 표시)
    const single = allReady && total === 1;
    preview.hidden = !single;
    picks.hidden = single;
    if (single) {
      previewBox.replaceChildren(previewCanvas(pending[0].prepared, source === "camera" ? "찍은 사진" : "고른 사진"));
      previewSize.textContent = `올릴 크기 ${photoSizeText(pending[0].prepared.blob.size)}`;
    } else {
      picks.replaceChildren(...pending.map((item, index) => {
        const li = element("li", `ph-pick ph-pick--${item.state}`);
        li.append(previewCanvas(item.prepared, `고른 사진 ${index + 1}`), element("span", "ph-pick__state", STATE_LABELS[item.state]));
        if (allReady && total > 1) {
          const remove = element("button", "admin-text-link cu-linkbtn", "이 사진 빼기");
          remove.type = "button";
          remove.addEventListener("click", () => {
            pending.splice(index, 1);
            renderCheck();
            if (pending.length > 0) checkHeading.focus();
            else cameraButton.focus();
          });
          li.append(remove);
        }
        return li;
      }));
    }
    warn.hidden = !allReady;
    kindRow.hidden = !(allReady && source === "album");
    descRow.hidden = !allReady;
    descHint.textContent = total > 1 ? `(안 써도 됨, ${total}장 모두에 붙음. 사진마다 나중에 고칠 수 있음)` : "(안 써도 됨)";
    what.hidden = !allReady;
    max.hidden = !(allReady && source === "album");
    const showFail = !uploading && failedItems.length > 0;
    failText.hidden = !showFail;
    if (showFail) {
      const lead = uploadFailText(failedItems[0].code, customerErrorText);
      failText.replaceChildren(`${lead} `, element("strong", "", "못 올린 사진은 이 화면에만 남아 있어"), ", 화면을 닫거나 새로 고치면 없어집니다(휴대폰 사진첩에 없을 수 있음).");
    }
    const retryable = failedItems.some((item) => isUploadRetryable(item.code ?? undefined));
    goButton.disabled = uploading;
    goButton.hidden = showFail && !retryable;
    goButton.textContent = uploading ? "올리는 중…" : showFail ? "다시 올리기" : PHOTO_GO_LABEL;
    cancelButton.hidden = uploading;
    cancelButton.textContent = showFail ? (failedItems.length > 1 ? "못 올린 사진 버리기" : "이 사진 버리기") : "그만두기";
    if (!showFail) drop.hidden = true;
  }

  desc.addEventListener("input", () => {
    descCount.textContent = captionCountText(desc.value);
  });

  async function upload() {
    const customerId = options.customerId();
    if (!customerId || uploading) return;
    const retrying = pending.some((item) => item.state === "fail");
    if (!retrying) {
      const caption = checkCaption(desc.value);
      if (!caption.ok) {
        setStatus(checkStatus, caption.error ?? "", "error");
        desc.focus();
        return;
      }
      captionToApply = caption.value ?? "";
      kindToApply = source === "camera" ? "property_photo" : ((root.querySelector<HTMLInputElement>("[data-ph-kind-input]:checked")?.value ?? "property_photo") as PhotoKind);
    }
    setStatus(checkStatus, "", "idle");
    uploading = true;
    drop.hidden = true;
    for (const item of pending) if (item.state === "fail" && isUploadRetryable(item.code ?? undefined)) item.state = "ready";
    // 알림은 이번에 올린 장수만 센다('다시 올리기' 뒤에 앞서 올린 사진까지 세면 두 번 올린 것처럼 보임).
    let uploadedNow = 0;
    let missedNow = 0;
    for (const item of pending) {
      if (item.state !== "ready") continue;
      item.state = "busy";
      renderCheck();
      try {
        const { file } = await uploadPhoto(item.prepared.blob, { kind: kindToApply, customerId, sha256: item.prepared.sha256 });
        // 미리보기·설명은 원본이 들어간 뒤에 보낸다. 실패해도 사진은 올라간 것이므로 '못 올림'으로 보지 않는다.
        if (item.prepared.thumb) await uploadThumb(file.id, item.prepared.thumb.blob, item.prepared.thumb.sha256).catch(() => undefined);
        if (captionToApply) await updateFileCaption(file.id, captionToApply).catch(() => { item.captionMissed = true; });
        item.state = "done";
        uploadedNow += 1;
        if (item.captionMissed) missedNow += 1;
      } catch (error) {
        item.state = "fail";
        item.code = codeOf(error);
      }
    }
    uploading = false;
    if (uploadedNow > 0) await options.reload().catch(() => undefined);
    const doneText = `${uploadedText(uploadedNow)}${missedNow > 0 ? ` ${captionMissedText(missedNow)}` : ""}`;
    if (pending.every((item) => item.state === "done")) {
      pending = [];
      renderCheck();
      say(doneText, missedNow > 0 ? "error" : "success");
      status.tabIndex = -1;
      status.focus();
      return;
    }
    renderCheck();
    if (uploadedNow > 0) say(doneText, missedNow > 0 ? "error" : "success");
    checkHeading.focus();
  }
  goButton.addEventListener("click", () => void upload());

  cancelButton.addEventListener("click", () => {
    if (pending.some((item) => item.state === "fail")) {
      drop.hidden = false;
      dropGo.focus();
      return;
    }
    pending = [];
    renderCheck();
    say("", "idle");
    cameraButton.focus();
  });
  dropGo.addEventListener("click", () => {
    pending = pending.filter((item) => item.state !== "fail");
    if (pending.every((item) => item.state === "done")) pending = [];
    drop.hidden = true;
    renderCheck();
    if (pending.length > 0) checkHeading.focus();
    else cameraButton.focus();
  });
  pick("[data-ph-drop-cancel]").addEventListener("click", () => {
    drop.hidden = true;
    cancelButton.focus();
  });

  // ── 크게 보기 ──
  function openView(id: string) {
    const index = files.findIndex((file) => file.id === id);
    if (index < 0) return;
    const file = files[index];
    viewId = id;
    view.hidden = false;
    viewWait.hidden = false;
    viewWait.textContent = "사진을 불러오고 있습니다…";
    viewImage.hidden = true;
    maskOpen.disabled = true;
    viewImage.alt = `사진 원본 · ${photoAtText(file.createdAt)}`;
    viewImage.src = fileContentUrl(id);
    viewMeta.textContent = photoMetaText(file, index, files.length);
    viewDesc.value = file.caption;
    viewDescCount.textContent = captionCountText(file.caption);
    setStatus(viewStatus, "", "idle");
    openDelete(false);
    renderList();
    view.scrollIntoView({ block: "start" });
    viewHeading.focus({ preventScroll: true });
  }
  viewImage.addEventListener("load", () => {
    viewImage.hidden = false;
    viewWait.hidden = true;
    maskOpen.disabled = false;
  });
  viewImage.addEventListener("error", () => {
    if (!viewId) return;
    viewWait.hidden = false;
    viewWait.textContent = "사진을 불러오지 못했습니다. '닫기'를 누른 뒤 다시 열어 주세요.";
  });

  function closeView(focusBack = true) {
    if (!viewId && view.hidden) return;
    const id = viewId;
    viewId = null;
    closeMask();
    view.hidden = true;
    maskOpen.disabled = true;
    viewImage.removeAttribute("src");
    openDelete(false);
    if (!focusBack) return;
    renderList();
    const back = id ? list.querySelector<HTMLButtonElement>(`[data-ph-open="${CSS.escape(id)}"]`) : null;
    (back ?? cameraButton).focus();
  }
  pick("[data-ph-view-close]").addEventListener("click", () => closeView());

  // ── 얼굴 가려서 내보내기(화면 전체 창) ──
  let editor: MaskEditor | null = null;
  let maskSequence = 0;
  // 공유는 누른 그 순간(사용자 동작 안)에 불러야 하는 브라우저가 있어(Safari, 추정), 상자가 바뀔 때마다 가린 사본을 미리 만들어 둔다.
  let exported: { state: MaskState; blob: Blob } | null = null;
  let exportTimer = 0;
  const shareProbe = () => {
    try {
      return typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([new Uint8Array(1)], "photo-masked.jpg", { type: "image/jpeg" })] });
    } catch {
      return false;
    }
  };
  function renderMask(state: MaskState) {
    const count = state.boxes.length;
    maskCount.textContent = maskCountText(count);
    maskUndo.disabled = count === 0;
    maskRedo.disabled = state.redo.length === 0;
    maskClear.disabled = count === 0;
    maskDownload.disabled = count === 0;
    maskShare.disabled = count === 0;
    exported = null;
    window.clearTimeout(exportTimer);
    if (count === 0 || maskShare.hidden) return;
    exportTimer = window.setTimeout(() => {
      const current = editor;
      if (!current) return;
      void current.exportJpeg().then((blob) => {
        if (editor === current && current.state() === state) exported = { state, blob };
      }, () => undefined);
    }, 300);
  }
  function closeMask() {
    maskSequence += 1;
    window.clearTimeout(exportTimer);
    exported = null;
    editor?.destroy();
    editor = null;
    maskCanvas.hidden = true;
    maskCanvas.width = 0;
    maskCanvas.height = 0;
    if (mask.open) mask.close();
  }
  async function openMask() {
    if (!viewId || viewImage.hidden || !viewImage.complete || viewImage.naturalWidth === 0) return;
    const sequence = ++maskSequence;
    maskShare.hidden = !shareProbe();
    maskWait.hidden = false;
    maskWait.textContent = "사진을 준비하고 있습니다…";
    maskCanvas.hidden = true;
    setStatus(maskStatus, "", "idle");
    renderMask({ boxes: [], redo: [] });
    mask.showModal();
    try {
      const next = await openMaskEditor(maskCanvas, viewImage, { onChange: renderMask });
      if (sequence !== maskSequence) {
        next.destroy();
        return;
      }
      editor = next;
      maskWait.hidden = true;
      maskCanvas.hidden = false;
    } catch {
      if (sequence !== maskSequence) return;
      maskWait.textContent = "사진을 준비하지 못했습니다. '그만두기'를 누른 뒤 다시 해 주세요.";
    }
  }
  async function maskedBlob() {
    if (!editor) throw new MaskError("NO_BOXES");
    const state = editor.state();
    if (exported && exported.state === state) return exported.blob;
    const blob = await editor.exportJpeg();
    exported = { state, blob };
    return blob;
  }
  const maskFailText = (error: unknown) => (error instanceof MaskError && error.code === "NO_BOXES" ? "먼저 가릴 곳에 네모를 그리세요." : "가린 사진을 만들지 못했습니다. 다시 해 주세요.");
  maskOpen.addEventListener("click", () => void openMask());
  pick("[data-ph-mask-close]").addEventListener("click", () => {
    closeMask();
    maskOpen.focus();
  });
  // Esc로 닫혀도 비트맵·canvas 메모리를 푼다.
  mask.addEventListener("close", () => {
    if (editor || maskCanvas.width > 0) closeMask();
  });
  maskUndo.addEventListener("click", () => editor?.undo());
  maskRedo.addEventListener("click", () => editor?.redo());
  maskClear.addEventListener("click", () => editor?.clear());
  maskDownload.addEventListener("click", async () => {
    try {
      const blob = await maskedBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = maskedFileName(todayInKorea());
      mask.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(maskStatus, `✓ ${link.download} 파일을 만들었습니다. 가린 사본은 이 기기에만 있고, 앱에 보관한 사진은 그대로입니다.`, "success");
    } catch (error) {
      setStatus(maskStatus, maskFailText(error), "error");
    }
  });
  maskShare.addEventListener("click", async () => {
    try {
      const blob = await maskedBlob();
      await navigator.share({ files: [new File([blob], maskedFileName(todayInKorea()), { type: "image/jpeg" })] });
      setStatus(maskStatus, "✓ 가린 사진을 공유 창으로 보냈습니다.", "success");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setStatus(maskStatus, "공유 창을 열지 못했습니다. '가려서 공유'를 한 번 더 눌러 주세요.", "error");
        return;
      }
      setStatus(maskStatus, error instanceof MaskError ? maskFailText(error) : "공유하지 못했습니다. '가려서 내려받기'로 저장한 뒤 보내 주세요.", "error");
    }
  });

  viewDesc.addEventListener("input", () => {
    viewDescCount.textContent = captionCountText(viewDesc.value);
  });

  viewSave.addEventListener("click", async () => {
    const id = viewId;
    if (!id || busy) return;
    const caption = checkCaption(viewDesc.value);
    if (!caption.ok) {
      setStatus(viewStatus, caption.error ?? "", "error");
      viewDesc.focus();
      return;
    }
    busy = true;
    viewSave.disabled = true;
    setStatus(viewStatus, "설명을 저장하고 있습니다…", "saving");
    try {
      const { file } = await updateFileCaption(id, caption.value ?? "");
      files = files.map((item) => (item.id === id ? { ...item, caption: file.caption } : item));
      if (viewId === id) {
        viewDesc.value = file.caption;
        viewDescCount.textContent = captionCountText(file.caption);
      }
      renderList();
      setStatus(viewStatus, "✓ 설명을 저장했습니다.", "success");
    } catch (error) {
      const code = codeOf(error);
      setStatus(viewStatus, `저장하지 못했습니다. ${photoErrorText(code)}`, "error");
      if (code === "NOT_FOUND") await options.reload().catch(() => undefined);
    } finally {
      busy = false;
      viewSave.disabled = false;
    }
  });

  function openDelete(open: boolean) {
    del.hidden = !open;
    viewDelete.setAttribute("aria-expanded", String(open));
    setStatus(delStatus, "", "idle");
  }
  viewDelete.addEventListener("click", () => {
    openDelete(del.hidden !== false);
    if (!del.hidden) delGo.focus();
  });
  pick("[data-ph-del-cancel]").addEventListener("click", () => {
    openDelete(false);
    viewDelete.focus();
  });
  delGo.addEventListener("click", async () => {
    const id = viewId;
    if (!id || busy) return;
    busy = true;
    delGo.disabled = true;
    setStatus(delStatus, "지우고 있습니다…", "saving");
    try {
      const result = await deleteFile(id);
      files = files.filter((file) => file.id !== id);
      closeView(false);
      render(files, enabled);
      showMovedToTrash(status, "사진", result.trash, {
        reload: options.reload,
        begin: () => {
          if (busy) return false;
          busy = true;
          return true;
        },
        end: () => {
          busy = false;
        },
      });
      status.hidden = false;
      status.tabIndex = -1;
      status.focus();
    } catch (error) {
      const code = codeOf(error);
      setStatus(delStatus, `지우지 못했습니다. ${photoErrorText(code)}`, "error");
      if (code === "NOT_FOUND") await options.reload().catch(() => undefined);
    } finally {
      busy = false;
      delGo.disabled = false;
    }
  });

  return {
    render,
    // 휴대폰 하단 막대 '사진 찍기'(누른 그 자리에서 카메라를 연다. 꺼졌거나 확인 중이면 사진 칸으로 간다)
    openCamera: () => openPicker("camera"),
    // 아직 올리지 못한 사진이 화면 메모리에 있는지(떠날 때 묻기)
    hasPending: () => preparing || pending.some((item) => item.state !== "done"),
    reset() {
      pending = [];
      uploading = false;
      shown = PHOTO_PAGE_SIZE;
      files = [];
      closeView(false);
      renderCheck();
      say("", "idle");
      list.replaceChildren();
    },
  };
}
