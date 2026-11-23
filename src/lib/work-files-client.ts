// 손님 카드 '사진' 칸(단계 2 바로 찍기)의 파일 API 호출. 서버 경로·머리는 worker/work-files.mjs·work-input.mjs와 같다.
// 올리기 본문은 화면이 다시 저장한 그림 바이트 그대로(base64 아님)이고, 원래 파일 이름은 어디에도 보내지 않는다(TP-11).
// SHA-256은 화면이 계산해 X-Work-File-Sha256으로 보내고, 서버(R2)가 받은 내용과 대조한다(다르면 422 CHECKSUM_MISMATCH).
// 쓰기는 업무 세션의 보안 토큰을 X-Admin-CSRF로 보내고, 만료면 세션을 한 번 새로 받아 다시 보낸다(work-customers-client.ts와 같음).
import { getCustomerSession, writeWorkData, WorkApiError, type CustomerFile } from "./work-customers-client";
import { readEnvelope } from "./work-realprice-client";
import type { TrashRef } from "./work-trash-client";

export { WorkApiError };

const WORK_API_ROOT = "/api/admin/v1/work";
const idPath = (id: string) => encodeURIComponent(id);

export type PhotoKind = "property_photo" | "other";
export interface UploadedFile extends CustomerFile { customerId: string | null }

// <img src>로 여는 주소(같은 출처, 쿠키 인증). 원본은 열 때마다 감사 기록 file.download, 미리보기는 기록 없음.
export const fileContentUrl = (id: string) => `${WORK_API_ROOT}/files/${idPath(id)}/content`;
export const fileThumbUrl = (id: string) => `${WORK_API_ROOT}/files/${idPath(id)}/thumb`;

async function sendBytes<T>(path: string, method: "POST" | "PUT", body: Blob, headers: Record<string, string>) {
  let session = await getCustomerSession();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!session.csrfToken) throw new WorkApiError("보안 확인 값이 없습니다.", { code: "CSRF_INVALID" });
    const response = await fetch(`${WORK_API_ROOT}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": body.type, "X-Admin-CSRF": session.csrfToken, ...headers },
      credentials: "same-origin",
      cache: "no-store",
      redirect: "manual",
      body,
    });
    try {
      return await readEnvelope<T>(response);
    } catch (error) {
      if (!(error instanceof WorkApiError) || error.code !== "CSRF_INVALID" || attempt > 0) throw error;
      session = await getCustomerSession({ refresh: true });
    }
  }
  throw new WorkApiError("요청을 처리하지 못했습니다.");
}

// 원본 올리기(POST /work/files) → 201 { file }. 설명은 받지 않으므로 201 뒤에 updateFileCaption으로 넣는다.
export const uploadPhoto = (blob: Blob, input: { kind: PhotoKind; customerId: string; sha256: string }) =>
  sendBytes<{ file: UploadedFile }>("/files", "POST", blob, { "X-Work-File-Kind": input.kind, "X-Work-File-Sha256": input.sha256, "X-Work-Owner": `customer:${input.customerId}` });
// 계약서 사본 올리기(단계 4 K-b): 거래에 붙이고(X-Work-Owner deal:{uuid}), 사람이 가림을 확인한 표시(X-Work-Masked: rrn=1 = "가렸거나 번호가 없음")를 함께 보낸다.
// 본문은 화면이 주민등록번호를 검게 칠한 뒤 다시 저장한 JPEG뿐이다(가리기 전 사진은 보내지 않음). 미리보기는 서버가 받지 않으므로 보내지 않는다.
export const uploadContractCopy = (blob: Blob, input: { dealId: string; sha256: string }) =>
  sendBytes<{ file: UploadedFile }>("/files", "POST", blob, {
    "X-Work-File-Kind": "contract_copy",
    "X-Work-File-Sha256": input.sha256,
    "X-Work-Owner": `deal:${input.dealId}`,
    "X-Work-Masked": "rrn=1",
  });
// 미리보기 올리기(PUT /work/files/:id/thumb, 원본 201 뒤, 이미 있으면 덮어씀)
export const uploadThumb = (id: string, blob: Blob, sha256: string) =>
  sendBytes<{ file: UploadedFile }>(`/files/${idPath(id)}/thumb`, "PUT", blob, { "X-Work-File-Sha256": sha256 });
// 설명 고치기(0 ~ 200자). version이 없어 마지막 쓰기가 이긴다.
export const updateFileCaption = (id: string, caption: string) => writeWorkData<{ file: UploadedFile }>(`/files/${idPath(id)}`, "PATCH", { caption });
// 지우기 → 휴지통(kind file, 7일)
export const deleteFile = (id: string) => writeWorkData<{ deleted: boolean; trash?: TrashRef }>(`/files/${idPath(id)}`, "DELETE", {});
