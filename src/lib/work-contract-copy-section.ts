// 손님 카드 거래 칸 '계약서 사본'(단계 4 K-b, 사용자 결정 2026-11-23 10:22:02 "이대로 구현해 올림"). 서버 요청은 work-files-client.ts 한 곳.
// - 거래 칸마다 접어 둔 '계약서 사본 n장' 단추가 있고("접어 둠"), 펼치면 목록(글자 줄)·'계약서 찍기'·'사진첩에서 고르기'가 보인다. 한 번에 한 장씩이다.
// - 찍거나 고른 사진은 화면 메모리에서만 다루고, 화면 전체 창에서 주민등록번호를 검게 칠한 뒤(work-mask-canvas.ts의 paintBlack)
//   '다 가렸음, 확대해서 확인' → 사진 전체를 크게 보며 끌어서 확인("사진 전체를 크게, 끌어서 봄") → '주민번호 가림 확인, 올리기' 순서로 올린다.
//   가린 곳이 0개면 한 번 더 물은 뒤 '주민번호 없음 확인, 올리기'로 올린다(서버 표시는 같음: 가렸거나 번호가 없음).
// - 서버로 가는 것은 검게 칠한 뒤 다시 저장한 JPEG 하나뿐이다(촬영 정보 없음, 손님 사진과 같은 길). 가리기 전 사진·원래 파일 이름·미리보기는 보내지 않는다.
//   그림은 canvas와 같은 출처 <img>로만 보이고 blob: 주소·브라우저 저장소·주소창을 쓰지 않는다.
// - 못 올리면 가린 사본을 화면 메모리에 두고 '다시 올리기'(같은 바이트·같은 SHA-256)를 보인다. 남은 사본이 있으면 떠날 때 묻는다(hasPending).
// - 기울기 보정·자르기는 없고, 키보드로는 칠할 수 없다(창에 안내). 확대 확인·보기의 사진은 화살표 키로도 옮겨 볼 수 있다.
import type { CustomerDeal, CustomerFile } from "./work-customers-client";
import { element, setStatus } from "./work-customers-dom";
import { WorkApiError, deleteFile, fileContentUrl, uploadContractCopy } from "./work-files-client";
import { MaskError, openMaskEditor, paintBlack, type MaskEditor, type MaskState } from "./work-mask-canvas";
import { PhotoPrepareError, decodeScaled, sha256Hex } from "./work-photo-dom";
import { showMovedToTrash } from "./work-trash-dom";
import { customerErrorText } from "./work/customers-view.mjs";
import {
  COPY_CHECK_GUIDE,
  COPY_CHECK_TITLE,
  COPY_DROP_EDIT_TITLE,
  COPY_DROP_FAILED_TITLE,
  COPY_FULL_TEXT,
  COPY_GO_LABEL,
  COPY_GO_NONE_LABEL,
  COPY_KEEP_TEXT,
  COPY_MASK_GUIDE,
  COPY_MASK_TITLE,
  COPY_NONE_LABEL,
  COPY_NOTE_TEXT,
  COPY_PICK_LABEL,
  COPY_RETRY_LABEL,
  COPY_SHOOT_LABEL,
  COPY_TO_CHECK_LABEL,
  COPY_UPLOADED_STALE_TEXT,
  COPY_UPLOADED_TEXT,
  COPY_VIEW_BIG_LABEL,
  COPY_VIEW_FIT_LABEL,
  COPY_VIEW_GUIDE,
  COPY_VIEW_TITLE,
  copyCheckText,
  copyErrorText,
  copyFailText,
  copyFilesOf,
  copyHeadText,
  copyOffText,
  copyRowText,
  copyToggleText,
  copyZoom,
  copyZoomStart,
  copyZoomText,
  isCopyFull,
  isCopyRetryable,
} from "./work/contract-copy-view.mjs";
import { maskCountText } from "./work/mosaic.mjs";
import { PHOTO_MAX_BYTES, PHOTO_QUALITIES, prepareErrorText } from "./work/photo-view.mjs";
import { TRASH_MOVE_NOTICE } from "./work/trash-view.mjs";

interface CopySectionOptions {
  // 파일 저장소가 켜졌는지(업무 세션의 filesEnabled)
  enabled: () => boolean;
  // 손님 카드 전체를 다시 읽는다(거래 칸을 다시 그림). 끝나면 block()이 다시 불린다.
  reload: () => Promise<unknown>;
  // 펼친 칸 맨 끝에 붙일 자리(계약서 AI 일정 뽑기 상자, work-ai-section.ts). 칸을 펼칠 때 opened(dealId)를 부른다.
  addon?: { slot: (dealId: string) => HTMLElement; opened: (dealId: string) => void };
}

// closed: 창 닫힘 · preparing: 사진 읽는 중 · mask: 칠하기 · ask: 가린 곳 0개 확인 · check: 확대 확인 · view: 올린 사본 보기
type Step = "closed" | "preparing" | "mask" | "ask" | "check" | "view";
interface Job {
  dealId: string;
  // 한 번 만든 올릴 사본과 그때 칠한 상태(state). 못 올렸을 때 같은 바이트·같은 SHA-256으로 다시 보낸다.
  // 칠한 상태가 그때와 다르면 쓰지 않고 새로 만든다(upload 한 곳에서 대조. 가린 곳이 다른 낡은 사본이 올라가지 않게).
  ready: { blob: Blob; sha256: string; state: MaskState } | null;
  failed: boolean;
  retryable: boolean;
}
interface Block {
  root: HTMLElement;
  update: (files: CustomerFile[]) => void;
  say: (text: string, state: "idle" | "success" | "error") => void;
  focusStatus: () => void;
}

const codeOf = (error: unknown) => (error instanceof WorkApiError ? error.code : null);

export function mountContractCopies(root: HTMLElement, options: CopySectionOptions) {
  const pick = <T extends HTMLElement>(selector: string) => {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`계약서 사본 칸이 없습니다: ${selector}`);
    return found;
  };
  const cameraInput = pick<HTMLInputElement>("[data-kc-camera-input]");
  const albumInput = pick<HTMLInputElement>("[data-kc-album-input]");
  const dialog = pick<HTMLDialogElement>("[data-kc-mask]");
  const title = pick("[data-kc-title]");
  const guide = pick("[data-kc-guide]");
  const closeButton = pick<HTMLButtonElement>("[data-kc-close]");
  const wait = pick("[data-kc-wait]");
  const canvas = pick<HTMLCanvasElement>("[data-kc-canvas]");
  const zoom = pick("[data-kc-zoom]");
  const countLine = pick("[data-kc-count]");
  const editRow = pick("[data-kc-edit-row]");
  const undo = pick<HTMLButtonElement>("[data-kc-undo]");
  const redo = pick<HTMLButtonElement>("[data-kc-redo]");
  const clear = pick<HTMLButtonElement>("[data-kc-clear]");
  const nextRow = pick("[data-kc-next-row]");
  const next = pick<HTMLButtonElement>("[data-kc-next]");
  const backRow = pick("[data-kc-back-row]");
  const back = pick<HTMLButtonElement>("[data-kc-back]");
  const goRow = pick("[data-kc-go-row]");
  const go = pick<HTMLButtonElement>("[data-kc-go]");
  const ask = pick("[data-kc-ask]");
  const askTitle = pick("[data-kc-ask-title]");
  const askBack = pick<HTMLButtonElement>("[data-kc-ask-back]");
  const askGoRow = pick("[data-kc-ask-go-row]");
  const askGo = pick<HTMLButtonElement>("[data-kc-ask-go]");
  const viewRow = pick("[data-kc-view-row]");
  const viewSize = pick<HTMLButtonElement>("[data-kc-view-size]");
  const drop = pick("[data-kc-drop]");
  const dropTitle = pick("[data-kc-drop-title]");
  const dropGo = pick<HTMLButtonElement>("[data-kc-drop-go]");
  const dropCancel = pick<HTMLButtonElement>("[data-kc-drop-cancel]");
  const status = pick("[data-kc-status]");

  const blocks = new Map<string, Block>();
  let step: Step = "closed";
  let job: Job | null = null;
  let editor: MaskEditor | null = null;
  let sequence = 0;
  let uploading = false;
  let dropOpen = false;
  let busy = false; // 사본 지우기와 지운 뒤 되살리기
  let pickFor: { dealId: string; opener: HTMLElement } | null = null;
  let opener: HTMLElement | null = null;
  let zoomInfo: ReturnType<typeof copyZoom> = null;
  // 올린 사본 보기
  let viewFile: CustomerFile | null = null;
  let viewImage: HTMLImageElement | null = null;
  let viewLoaded = false;
  let viewBig = false;

  // ── 창 그리기 ──
  function renderDialog() {
    const state = editor?.state();
    const count = state?.boxes.length ?? 0;
    const viewing = step === "view";
    const failed = Boolean(job?.failed);
    const canRetry = !failed || Boolean(job?.retryable);
    title.textContent = viewing ? COPY_VIEW_TITLE : step === "check" ? COPY_CHECK_TITLE : COPY_MASK_TITLE;
    guide.textContent = viewing ? COPY_VIEW_GUIDE : step === "check" ? COPY_CHECK_GUIDE : COPY_MASK_GUIDE;
    closeButton.textContent = viewing ? "닫기" : "그만두기";
    closeButton.disabled = uploading;
    wait.hidden = !(step === "preparing" || (viewing && !viewLoaded));
    canvas.hidden = !(step === "mask" || step === "ask");
    // 올리는 중에는 칠하지 못한다(올라가는 사본과 화면이 달라지지 않게). 이미 누르고 있던 끌기는 inert로 막히지 않으므로 upload가 편집기도 잠근다.
    canvas.toggleAttribute("inert", uploading);
    zoom.hidden = !(step === "check" || (viewing && viewLoaded));
    if (step === "check") countLine.textContent = copyCheckText(count, zoomInfo);
    else if (viewing) countLine.textContent = viewFile ? [copyRowText(viewFile), viewBig ? copyZoomText(zoomInfo) : ""].filter(Boolean).join(" · ") : "";
    else countLine.textContent = step === "preparing" ? "" : maskCountText(count);
    editRow.hidden = step !== "mask" || dropOpen;
    undo.disabled = count === 0;
    redo.disabled = (state?.redo.length ?? 0) === 0;
    clear.disabled = count === 0;
    nextRow.hidden = step !== "mask" || dropOpen;
    next.textContent = count > 0 ? COPY_TO_CHECK_LABEL : COPY_NONE_LABEL;
    backRow.hidden = step !== "check" || dropOpen;
    back.disabled = uploading;
    goRow.hidden = step !== "check" || dropOpen || !canRetry;
    go.disabled = uploading;
    go.textContent = uploading ? "올리는 중…" : failed ? COPY_RETRY_LABEL : COPY_GO_LABEL;
    ask.hidden = step !== "ask" || dropOpen;
    askBack.disabled = uploading;
    askGoRow.hidden = !canRetry;
    askGo.disabled = uploading;
    askGo.textContent = uploading ? "올리는 중…" : failed ? COPY_RETRY_LABEL : COPY_GO_NONE_LABEL;
    viewRow.hidden = !viewing;
    viewSize.disabled = !viewLoaded;
    viewSize.textContent = viewBig ? COPY_VIEW_FIT_LABEL : COPY_VIEW_BIG_LABEL;
    drop.hidden = !dropOpen;
    dropTitle.textContent = failed ? COPY_DROP_FAILED_TITLE : COPY_DROP_EDIT_TITLE;
    dialog.setAttribute("aria-busy", String(uploading));
  }

  // 창을 닫고 사진·canvas 메모리를 푼다(가리기 전 사진도 여기서 없어진다).
  function closeDialog(focusBack: boolean) {
    sequence += 1;
    zoom.replaceChildren();
    editor?.destroy();
    editor = null;
    canvas.hidden = true;
    canvas.width = 0;
    canvas.height = 0;
    job = null;
    uploading = false;
    dropOpen = false;
    zoomInfo = null;
    viewFile = null;
    viewImage = null;
    viewLoaded = false;
    viewBig = false;
    step = "closed";
    setStatus(status, "", "idle");
    if (dialog.open) dialog.close();
    const target = opener;
    opener = null;
    if (focusBack && target?.isConnected) target.focus();
  }
  // 창 위 단추(그만두기·닫기)와 Esc·휴대폰 뒤로 가기: 올리는 중에는 닫지 않고, 못 올린 사본이나 칠한 곳이 있으면 버릴지 먼저 묻는다
  // (바로 찍은 사진은 휴대폰 사진첩에 없을 수 있어, 잘못 닫으면 다시 찍어야 한다).
  const hasWork = () => Boolean(job?.failed) || (editor?.state().boxes.length ?? 0) > 0;
  function requestClose() {
    if (uploading) return;
    if (hasWork()) {
      dropOpen = true;
      renderDialog();
      dropCancel.focus();
      return;
    }
    closeDialog(true);
  }
  closeButton.addEventListener("click", requestClose);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    requestClose();
  });
  // 다른 길로 닫혀도 메모리를 푼다. 다만 Esc를 거듭 눌러 브라우저가 닫은 때에 올리는 중이거나 버릴지 묻던 사본이 있으면 다시 연다(사본이 말없이 없어지지 않게).
  dialog.addEventListener("close", () => {
    if (step === "closed") return;
    if (uploading || hasWork()) {
      dropOpen = !uploading;
      renderDialog();
      dialog.showModal();
      return;
    }
    closeDialog(false);
  });
  dropGo.addEventListener("click", () => closeDialog(true));
  dropCancel.addEventListener("click", () => {
    dropOpen = false;
    renderDialog();
    closeButton.focus();
  });

  // ── 사진 고르기 → 칠하기 ──
  function openPicker(dealId: string, kind: "camera" | "album", from: HTMLElement) {
    if (!options.enabled() || step !== "closed" || busy) return;
    pickFor = { dealId, opener: from };
    (kind === "camera" ? cameraInput : albumInput).click();
  }
  async function handlePicked(input: HTMLInputElement) {
    const file = input.files?.[0] ?? null;
    // 같은 사진을 다시 골라도 change가 오도록 바로 비운다(파일 이름은 어디에도 남기지 않음).
    input.value = "";
    const picked = pickFor;
    pickFor = null;
    if (!file || !picked || step !== "closed") return;
    const current = ++sequence;
    opener = picked.opener;
    job = { dealId: picked.dealId, ready: null, failed: false, retryable: true };
    step = "preparing";
    wait.textContent = "사진을 준비하고 있습니다…";
    setStatus(status, "", "idle");
    renderDialog();
    dialog.showModal();
    let source: HTMLCanvasElement | null = null;
    try {
      source = await decodeScaled(file);
      // 읽는 동안 그만뒀거나 다른 사진을 열었으면 여기서 끝낸다(편집기는 함께 쓰는 canvas의 크기를 바꾸고 가리기 전 사진을 그려 넣는다).
      if (current !== sequence) return;
      const opened = await openMaskEditor(canvas, source, {
        paint: paintBlack,
        outline: false,
        cancelled: () => current !== sequence,
        onChange: () => {
          // 칠한 곳이 바뀌면 '못 올림' 표시를 거둔다(다음 올리기는 '다시 올리기'가 아니라 새 확인). 앞서 만든 사본을 버리는 일은 upload가 칠한 상태를 대조해 맡는다.
          // 올리는 중에는 편집기를 잠가 두어 여기로 오지 않는다.
          if (job && !uploading && job.failed) {
            job.failed = false;
            job.retryable = true;
            setStatus(status, "", "idle");
          }
          dropOpen = false;
          // 물어보는 중에 네모를 그리면 칠하기로 돌아간다.
          if (step === "ask" && (editor?.state().boxes.length ?? 0) > 0) step = "mask";
          renderDialog();
        },
      });
      if (current !== sequence) {
        opened.destroy();
        return;
      }
      editor = opened;
      step = "mask";
      renderDialog();
    } catch (error) {
      if (current !== sequence) return;
      // 읽지 못한 사진은 남길 것이 없으므로 떠날 때 묻지 않는다.
      job = null;
      const code = error instanceof PhotoPrepareError ? error.code : error instanceof MaskError ? "DECODE_FAILED" : "ENCODE_FAILED";
      wait.textContent = `${prepareErrorText(code)} 위의 '그만두기'를 누른 뒤 다시 해 주세요.`;
    } finally {
      if (source) {
        source.width = 0;
        source.height = 0;
      }
    }
  }
  cameraInput.addEventListener("change", () => void handlePicked(cameraInput));
  albumInput.addEventListener("change", () => void handlePicked(albumInput));

  undo.addEventListener("click", () => editor?.undo());
  redo.addEventListener("click", () => editor?.redo());
  clear.addEventListener("click", () => editor?.clear());

  // 사진 자리에 그림을 붙이고(복사 없음) 크게 볼 폭을 정한 뒤 처음 보일 자리로 옮긴다.
  function placeZoom(node: HTMLElement, imageWidth: number, start?: { x: number; y: number; w: number; h: number }) {
    zoomInfo = copyZoom(imageWidth, zoom.clientWidth);
    node.style.width = zoomInfo ? `${zoomInfo.width}px` : "100%";
    if (node.parentElement !== zoom) zoom.replaceChildren(node);
    const at = copyZoomStart(start, zoomInfo ? zoomInfo.width / imageWidth : 0, { width: zoom.clientWidth, height: zoom.clientHeight });
    zoom.scrollLeft = at.left;
    zoom.scrollTop = at.top;
  }

  function toMask() {
    if (!job || !editor || uploading) return;
    // 다시 가리러 가면 '못 올림' 표시를 거둔다(칠한 곳을 바꾸면 upload가 사본을 새로 만든다).
    job.failed = false;
    job.retryable = true;
    dropOpen = false;
    zoom.replaceChildren();
    zoomInfo = null;
    step = "mask";
    setStatus(status, "", "idle");
    renderDialog();
    title.focus();
  }
  next.addEventListener("click", () => {
    if (!editor || step !== "mask") return;
    setStatus(status, "", "idle");
    if (editor.state().boxes.length === 0) {
      step = "ask";
      renderDialog();
      askTitle.focus();
      return;
    }
    step = "check";
    renderDialog();
    const result = editor.result;
    result.setAttribute("role", "img");
    result.setAttribute("aria-label", "주민등록번호를 가린 계약서 사본(올릴 그림)");
    placeZoom(result, editor.width, editor.state().boxes[0]);
    renderDialog();
    title.focus();
  });
  back.addEventListener("click", toMask);
  askBack.addEventListener("click", toMask);

  // ── 올리기 ──
  // 손님 사진과 같은 길: JPEG 품질 0.9 → 10MB를 넘으면 0.8 → 그래도 넘으면 올리지 않는다.
  // 가린 곳이 0개인 사본은 한 번 더 물은 길(ask)에서만 만든다(확대 확인 길에서는 NO_BOXES로 멈춤).
  async function exportCopy(current: MaskEditor, allowEmpty: boolean) {
    for (const quality of PHOTO_QUALITIES) {
      const blob = await current.exportJpeg({ quality, allowEmpty });
      if (blob.size <= PHOTO_MAX_BYTES) return { blob, sha256: await sha256Hex(blob) };
    }
    throw new PhotoPrepareError("TOO_LARGE");
  }
  async function upload() {
    const current = job;
    const source = editor;
    if (!current || !source || uploading || (step !== "check" && step !== "ask")) return;
    const allowEmpty = step === "ask";
    uploading = true;
    // 끌던 네모는 버리고, 끝날 때까지 칠한 곳이 바뀌지 않게 잠근다(화면의 가린 곳 수 = 올라가는 사본).
    source.setLocked(true);
    dropOpen = false;
    setStatus(status, "올리고 있습니다…", "saving");
    renderDialog();
    let done = false;
    let failText = "";
    try {
      // 앞서 만든 사본은 칠한 상태가 그때 그대로일 때만 다시 쓴다('다시 올리기' = 같은 바이트). 달라졌으면 새로 만든다.
      const state = source.state();
      if (!current.ready || current.ready.state !== state) current.ready = { ...(await exportCopy(source, allowEmpty)), state };
      await uploadContractCopy(current.ready.blob, { dealId: current.dealId, sha256: current.ready.sha256 });
      done = true;
    } catch (error) {
      if (error instanceof PhotoPrepareError) failText = prepareErrorText(error.code);
      else if (error instanceof MaskError) failText = error.code === "NO_BOXES" ? "먼저 주민등록번호를 검게 칠하세요." : prepareErrorText("ENCODE_FAILED");
      else {
        const code = codeOf(error);
        current.failed = true;
        current.retryable = isCopyRetryable(code);
        failText = `올리지 못했습니다. ${copyFailText(code, customerErrorText)} ${COPY_KEEP_TEXT}`;
      }
    }
    if (job !== current) return;
    uploading = false;
    source.setLocked(false);
    if (!done) {
      setStatus(status, failText, "error");
      renderDialog();
      (allowEmpty ? askTitle : title).focus();
      return;
    }
    const dealId = current.dealId;
    closeDialog(false);
    let stale = false;
    await options.reload().catch(() => {
      stale = true;
    });
    const block = blocks.get(dealId);
    block?.say(stale ? COPY_UPLOADED_STALE_TEXT : COPY_UPLOADED_TEXT, stale ? "error" : "success");
    block?.focusStatus();
  }
  go.addEventListener("click", () => void upload());
  askGo.addEventListener("click", () => void upload());

  // ── 올린 사본 보기(누를 때마다 올려 둔 사본을 받는다 = 감사 file.download) ──
  function openView(file: CustomerFile, from: HTMLElement) {
    if (!options.enabled() || step !== "closed") return;
    sequence += 1;
    opener = from;
    step = "view";
    viewFile = file;
    viewLoaded = false;
    viewBig = false;
    zoomInfo = null;
    wait.textContent = "사본을 불러오고 있습니다…";
    setStatus(status, "", "idle");
    const image = element("img");
    viewImage = image;
    image.alt = copyRowText(file);
    image.decoding = "async";
    image.draggable = false;
    image.addEventListener("load", () => {
      if (viewImage !== image) return;
      viewLoaded = true;
      image.classList.add("is-fit");
      zoom.replaceChildren(image);
      renderDialog();
    });
    image.addEventListener("error", () => {
      if (viewImage !== image) return;
      wait.textContent = "사본을 불러오지 못했습니다. 위의 '닫기'를 누른 뒤 다시 열어 주세요.";
    });
    image.src = fileContentUrl(file.id);
    renderDialog();
    dialog.showModal();
  }
  viewSize.addEventListener("click", () => {
    if (step !== "view" || !viewImage || !viewLoaded) return;
    viewBig = !viewBig;
    viewImage.classList.toggle("is-fit", !viewBig);
    if (viewBig) placeZoom(viewImage, viewImage.naturalWidth);
    else {
      zoomInfo = null;
      viewImage.style.width = "";
      zoom.scrollLeft = 0;
      zoom.scrollTop = 0;
    }
    renderDialog();
  });

  // 크게 본 사진을 마우스로 끌어 옮긴다(손가락은 브라우저가 스크롤하고, 키보드는 사진 자리에 초점을 두고 화살표 키).
  let pan: { id: number; x: number; y: number } | null = null;
  zoom.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    const rect = zoom.getBoundingClientRect();
    // 스크롤 막대 위에서 누른 것은 막대에 맡긴다.
    if (event.clientX - rect.left > zoom.clientWidth || event.clientY - rect.top > zoom.clientHeight) return;
    pan = { id: event.pointerId, x: event.clientX, y: event.clientY };
    zoom.setPointerCapture?.(event.pointerId);
    zoom.classList.add("is-dragging");
  });
  zoom.addEventListener("pointermove", (event) => {
    if (!pan || event.pointerId !== pan.id) return;
    zoom.scrollBy(pan.x - event.clientX, pan.y - event.clientY);
    pan = { id: pan.id, x: event.clientX, y: event.clientY };
  });
  const endPan = (event: PointerEvent) => {
    if (!pan || event.pointerId !== pan.id) return;
    pan = null;
    zoom.classList.remove("is-dragging");
  };
  zoom.addEventListener("pointerup", endPan);
  zoom.addEventListener("pointercancel", endPan);

  // ── 거래 칸 안의 사본 칸(거래마다 하나. 손님 카드를 다시 그려도 같은 칸을 다시 붙여 펼친 상태·알림이 남는다) ──
  function makeBlock(dealId: string): Block {
    const box = element("div", "lg-deal-ledger kc-copies");
    const panelId = `cu-copies-${dealId}`;
    const toggle = element("button", "work-secondary-button");
    toggle.type = "button";
    toggle.setAttribute("aria-controls", panelId);
    toggle.dataset.kcToggle = dealId;
    const panel = element("div");
    panel.id = panelId;
    panel.dataset.kcPanel = dealId;
    const head = element("h4", "", "계약서 사본 ");
    const headCount = element("span", "cu-block__n");
    head.append(headCount);
    const list = element("ul");
    const note = element("p", "cu-soft", COPY_NOTE_TEXT);
    const off = element("p", "cu-soft");
    const full = element("p", "cu-soft", COPY_FULL_TEXT);
    const actions = element("div", "cu-actions");
    const shoot = element("button", "work-primary-button", COPY_SHOOT_LABEL);
    shoot.type = "button";
    shoot.setAttribute("aria-haspopup", "dialog");
    const album = element("button", "work-secondary-button", COPY_PICK_LABEL);
    album.type = "button";
    album.setAttribute("aria-haspopup", "dialog");
    actions.append(shoot, album);
    const blockStatus = element("p", "admin-form-status");
    blockStatus.setAttribute("role", "status");
    blockStatus.setAttribute("aria-live", "polite");
    blockStatus.tabIndex = -1;
    panel.append(head, list, note, off, full, actions, blockStatus);
    if (options.addon) panel.append(options.addon.slot(dealId));
    box.append(toggle, panel);

    let files: CustomerFile[] = [];
    let open = false;
    let deleting: string | null = null;
    const deleteButton = (id: string) => list.querySelector<HTMLButtonElement>(`[data-kc-delete="${CSS.escape(id)}"]`);

    function confirmPanel(file: CustomerFile) {
      const section = element("section", "cu-form cu-panel cu-panel--danger kc-del");
      section.setAttribute("aria-label", "계약서 사본 지우기 확인");
      const text = element("p");
      text.append(element("strong", "", "이 사본을 지울까요? "), TRASH_MOVE_NOTICE);
      const line = element("div", "cu-actions");
      const yes = element("button", "work-primary-button cu-save cu-delete-go", "지우기");
      yes.type = "button";
      const no = element("button", "work-secondary-button", "그만두기");
      no.type = "button";
      line.append(yes, no);
      const delStatus = element("p", "admin-form-status");
      delStatus.setAttribute("role", "status");
      delStatus.setAttribute("aria-live", "polite");
      section.append(text, line, delStatus);
      no.addEventListener("click", () => {
        deleting = null;
        render();
        deleteButton(file.id)?.focus();
      });
      yes.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        yes.disabled = true;
        setStatus(delStatus, "지우고 있습니다…", "saving");
        try {
          const result = await deleteFile(file.id);
          deleting = null;
          files = files.filter((item) => item.id !== file.id);
          render();
          showMovedToTrash(blockStatus, "계약서 사본", result.trash, {
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
          blockStatus.focus();
        } catch (error) {
          const code = codeOf(error);
          setStatus(delStatus, `지우지 못했습니다. ${copyErrorText(code, customerErrorText)}`, "error");
          yes.disabled = false;
          if (code === "NOT_FOUND") await options.reload().catch(() => undefined);
        } finally {
          busy = false;
        }
      });
      return section;
    }

    function render() {
      const enabled = options.enabled();
      const count = files.length;
      toggle.textContent = copyToggleText(count, open);
      toggle.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      headCount.textContent = copyHeadText(count);
      list.hidden = count === 0;
      list.replaceChildren(...files.map((file) => {
        const row = element("li");
        const label = copyRowText(file);
        row.append(element("span", "", label));
        if (enabled) {
          const act = element("span", "kc-row__act");
          const see = element("button", "work-secondary-button", "보기");
          see.type = "button";
          see.setAttribute("aria-label", `${label} 보기`);
          see.setAttribute("aria-haspopup", "dialog");
          see.dataset.kcView = file.id;
          see.addEventListener("click", () => openView(file, see));
          const del = element("button", "work-secondary-button cu-danger", "지우기");
          del.type = "button";
          del.setAttribute("aria-label", `${label} 지우기`);
          del.setAttribute("aria-expanded", String(deleting === file.id));
          del.dataset.kcDelete = file.id;
          del.addEventListener("click", () => {
            deleting = deleting === file.id ? null : file.id;
            render();
            (deleting ? list.querySelector<HTMLButtonElement>(".kc-del .cu-delete-go") : deleteButton(file.id))?.focus();
          });
          act.append(see, del);
          row.append(act);
          if (deleting === file.id) row.append(confirmPanel(file));
        }
        return row;
      }));
      note.hidden = !enabled;
      off.hidden = enabled;
      off.textContent = enabled ? "" : copyOffText(count);
      full.hidden = !enabled || !isCopyFull(count);
      actions.hidden = !enabled || isCopyFull(count);
    }

    toggle.addEventListener("click", () => {
      open = !open;
      render();
      if (open) options.addon?.opened(dealId);
    });
    shoot.addEventListener("click", () => openPicker(dealId, "camera", shoot));
    album.addEventListener("click", () => openPicker(dealId, "album", album));
    render();

    return {
      root: box,
      update(nextFiles) {
        files = nextFiles;
        if (deleting && !files.some((file) => file.id === deleting)) deleting = null;
        render();
      },
      say(text, state) {
        setStatus(blockStatus, text, state);
      },
      focusStatus() {
        if (!open) {
          open = true;
          render();
        }
        blockStatus.focus();
      },
    };
  }

  return {
    // 거래 칸에 붙일 사본 칸. 같은 거래는 같은 칸을 돌려준다(목록만 새로 채움).
    block(deal: Pick<CustomerDeal, "id" | "files">) {
      let block = blocks.get(deal.id);
      if (!block) {
        block = makeBlock(deal.id);
        blocks.set(deal.id, block);
      }
      block.update(copyFilesOf(deal) as CustomerFile[]);
      return block.root;
    },
    // 아직 올리지 못한 사본(찍은 사진)이 화면 메모리에 있는지(떠날 때 묻기)
    hasPending: () => job !== null,
    reset() {
      closeDialog(false);
      pickFor = null;
      blocks.clear();
    },
  };
}
