// 손님·메모 화면(단계 2)의 업무 API 호출. 응답 봉투 해석과 오류 모양은 실거래가와 같은 work-realprice-client.ts를 쓴다.
// 세션은 단계 2 업무 세션(GET /work/session)이고, 쓰기(만들기·고치기·지우기)는 그 세션의 보안 토큰을 X-Admin-CSRF로 보낸다.
// 토큰이 만료됐으면 세션을 한 번 새로 받아 다시 보낸다. 손님 이름·전화·메모는 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readEnvelope, WorkApiError } from "./work-realprice-client";
import type { TrashRef } from "./work-trash-client";

export { WorkApiError };

const WORK_API_ROOT = "/api/admin/v1/work";

export interface CustomerSession {
  enabled: boolean;
  filesEnabled: boolean;
  administrator: string;
  csrfToken: string | null;
  schemaVersion: number | null;
}

export type CustomerStatus = "consulting" | "contracting" | "completed" | "on_hold";

export interface Customer {
  id: string;
  displayName: string;
  phoneDigits: string | null;
  needs: string;
  status: CustomerStatus;
  lastContactOn: string | null;
  retentionUntil: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DealEvent {
  id: string;
  dealId: string;
  kind: string;
  dueOn: string;
  title: string;
  source: string;
  doneAt: string | null;
  version: number;
}

export interface CustomerDeal {
  id: string;
  title: string;
  dealType: string;
  status: string;
  role: string;
  version: number;
  updatedAt: string;
  events: DealEvent[];
}

export interface Note {
  id: string;
  customerId: string | null;
  dealId: string | null;
  body: string;
  source: string;
  fileId: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerFile { id: string; kind: string; mimeType: string; byteSize: number; caption: string; dealId: string | null; createdAt: string }
export interface CustomerDetail { customer: Customer; deals: CustomerDeal[]; notes: Note[]; files: CustomerFile[] }
export interface Page<T> { items: T[]; nextCursor: string | null }
export interface CustomerInput { displayName?: string; phoneDigits?: string | null; needs?: string; status?: CustomerStatus }

let sessionPromise: Promise<CustomerSession> | null = null;

export function getCustomerSession({ refresh = false } = {}) {
  if (refresh || !sessionPromise) {
    const next = fetch(`${WORK_API_ROOT}/session`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" })
      .then((response) => readEnvelope<CustomerSession>(response));
    sessionPromise = next;
    void next.catch(() => {
      if (sessionPromise === next) sessionPromise = null;
    });
  }
  return sessionPromise;
}

async function read<T>(path: string, query?: URLSearchParams) {
  const search = query && [...query.keys()].length > 0 ? `?${query}` : "";
  const response = await fetch(`${WORK_API_ROOT}${path}${search}`, { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
  return readEnvelope<T>(response);
}

async function write<T>(path: string, method: "POST" | "PATCH" | "DELETE", body: unknown) {
  let session = await getCustomerSession();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!session.csrfToken) throw new WorkApiError("보안 확인 값이 없습니다.", { code: "CSRF_INVALID" });
    const response = await fetch(`${WORK_API_ROOT}${path}`, {
      method,
      headers: { Accept: "application/json", "Content-Type": "application/json", "X-Admin-CSRF": session.csrfToken },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify(body),
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

const idPath = (id: string) => encodeURIComponent(id);

// 매출장부 화면(work-ledger-client.ts)도 같은 세션·보안 토큰·봉투 해석을 쓴다.
export { read as readWorkData, write as writeWorkData };

export const listCustomers = (query: URLSearchParams) => read<Page<Customer>>("/customers", query);
export const readCustomer = (id: string) => read<CustomerDetail>(`/customers/${idPath(id)}`);
export const createCustomer = (body: CustomerInput) => write<{ customer: Customer }>("/customers", "POST", body);
export const updateCustomer = (id: string, body: CustomerInput & { version: number }) => write<{ customer: Customer }>(`/customers/${idPath(id)}`, "PATCH", body);
export const deleteCustomer = (id: string, confirmName: string) =>
  write<{ deleted: { customers: number; deals: number; notes: number; files: number; tasks?: number }; kept: { notes: number; ledger?: number }; trash?: TrashRef }>(`/customers/${idPath(id)}`, "DELETE", { confirmName });
export const listNotes = (query: URLSearchParams) => read<Page<Note>>("/notes", query);
export const createNote = (body: { body: string; customerId?: string | null }) => write<{ note: Note }>("/notes", "POST", body);
export const updateNote = (id: string, body: { version: number; body?: string; customerId?: string | null }) => write<{ note: Note }>(`/notes/${idPath(id)}`, "PATCH", body);
export const deleteNote = (id: string) => write<{ deleted: boolean; trash?: TrashRef }>(`/notes/${idPath(id)}`, "DELETE", {});
