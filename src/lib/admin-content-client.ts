interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: string[];
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: ApiErrorBody;
  requestId?: string;
}

export interface AdminSession {
  authenticated: boolean;
  administrator: string;
  authentication: string;
  writeEnabled: boolean;
  csrfToken: string | null;
}

export interface AdminResource<T> {
  resource: string;
  sha: string;
  data: T;
}

let sessionPromise: Promise<AdminSession> | null = null;

async function readEnvelope<T>(response: Response) {
  const body = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !body.ok || !body.data) {
    const details = body.error?.details?.length ? `\n${body.error.details.join("\n")}` : "";
    throw new Error(`${body.error?.message ?? "관리자 요청을 처리하지 못했습니다."}${details}`);
  }
  return body.data;
}

export function getAdminSession({ refresh = false } = {}) {
  if (refresh || !sessionPromise) {
    sessionPromise = fetch("/api/admin/v1/session", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    }).then((response) => readEnvelope<AdminSession>(response));
  }
  return sessionPromise;
}

export async function readAdminContent<T>(resource: string) {
  const response = await fetch(`/api/admin/v1/content/${resource}`, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  return readEnvelope<AdminResource<T>>(response);
}

export async function writeAdminContent<T>(resource: string, sha: string, data: T) {
  const session = await getAdminSession();
  if (!session.writeEnabled || !session.csrfToken) throw new Error("관리자 저장 연결이 아직 활성화되지 않았습니다.");
  const response = await fetch(`/api/admin/v1/content/${resource}`, {
    method: "PUT",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Admin-CSRF": session.csrfToken,
    },
    credentials: "same-origin",
    body: JSON.stringify({ sha, data }),
  });
  return readEnvelope<{ resource: string; commitSha: string | null; contentSha: string | null }>(response);
}

export async function uploadAdminImage(category: string, dataUrl: string) {
  const session = await getAdminSession();
  if (!session.writeEnabled || !session.csrfToken) throw new Error("관리자 이미지 저장 연결이 아직 활성화되지 않았습니다.");
  const response = await fetch("/api/admin/v1/media", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Admin-CSRF": session.csrfToken,
    },
    credentials: "same-origin",
    body: JSON.stringify({ category, dataUrl }),
  });
  return readEnvelope<{ src: string; commitSha: string | null }>(response);
}

export async function fetchExternalLinkPreview(type: "blog" | "youtube", url: string) {
  const session = await getAdminSession();
  if (!session.writeEnabled || !session.csrfToken) throw new Error("관리자 링크 미리보기 연결이 아직 활성화되지 않았습니다.");
  const response = await fetch("/api/admin/v1/external-links/preview", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Admin-CSRF": session.csrfToken,
    },
    credentials: "same-origin",
    body: JSON.stringify({ type, url }),
  });
  return readEnvelope<{ title: string; summary: string; thumbnailDataUrl: string | null }>(response);
}

export async function convertDataUrlToWebp(dataUrl: string, maxSide = 1600, quality = 0.82) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return convertImageFileToWebp(new File([blob], "preview-image", { type: blob.type }), maxSide, quality);
}

export async function convertImageFileToWebp(file: File, maxSide = 1600, quality = 0.82) {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일을 선택해 주세요.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지를 처리하지 못했습니다.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp;base64,")) throw new Error("WebP 이미지 변환에 실패했습니다.");
  const approximateBytes = Math.ceil((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
  if (approximateBytes > 2 * 1024 * 1024) throw new Error("최적화 후 이미지가 2MB를 넘습니다. 더 작은 사진을 선택해 주세요.");
  return dataUrl;
}

export function setAdminFormStatus(element: HTMLElement | null, message: string, state: "idle" | "saving" | "success" | "error" = "idle") {
  if (!element) return;
  element.textContent = message;
  element.dataset.state = state;
}
