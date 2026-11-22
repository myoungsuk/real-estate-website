// 휴지통 화면(단계 2, /admin/work/trash/)과 지우기 화면 4곳의 '되살리기'가 쓰는 업무 API 호출. 세션·보안 토큰(X-Admin-CSRF)·응답 봉투 해석은
// 손님 화면과 같은 work-customers-client.ts를 쓴다. 묶음 이름(label)은 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";

export { WorkApiError, getCustomerSession as getTrashSession } from "./work-customers-client";

export type TrashKind = "customer" | "deal" | "note" | "event" | "ledger" | "task" | "file";
// 지우는 요청 6곳의 응답에 붙는 값(7일 뒤 영구 삭제)
export interface TrashRef { batchId: string; purgeAfter: string }
export interface TrashCounts { customers: number; deals: number; parties: number; events: number; notes: number; tasks: number; ledger: number; files?: number; links: number }
export interface TrashItem {
  batchId: string;
  kind: TrashKind;
  label: string;
  deletedAt: string;
  purgeAfter: string;
  daysLeft: number;
  counts: TrashCounts;
  restorable: boolean;
}
export interface TrashPage { items: TrashItem[]; nextCursor: string | null }
export interface TrashSkip { table: string; reason: string; count: number }
export interface TrashRestored {
  restored: { customers: number; deals: number; parties: number; events: number; notes: number; tasks: number; ledger: number; files?: number; links: number; notesUnlinked: number };
  skipped: TrashSkip[];
  remaining: number;
}

const idPath = (id: string) => encodeURIComponent(id);

export const listTrash = (query: URLSearchParams) => readWorkData<TrashPage>("/trash", query);
export const restoreTrash = (batchId: string) => writeWorkData<TrashRestored>(`/trash/${idPath(batchId)}/restore`, "POST", {});
export const purgeTrash = (batchId: string, confirm: string) => writeWorkData<{ purged: boolean }>(`/trash/${idPath(batchId)}`, "DELETE", { confirm });
