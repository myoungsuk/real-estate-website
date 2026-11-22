// 할 일 화면(단계 2, /admin/work/tasks/)과 업무 도구 처음의 '오늘 할 일' 칸의 업무 API 호출. 세션·보안 토큰(X-Admin-CSRF)·응답 봉투 해석은
// 손님 화면과 같은 work-customers-client.ts를 쓴다. 할 일 제목은 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";

export { WorkApiError, getCustomerSession as getTaskSession } from "./work-customers-client";

export type TaskRepeat = "none" | "weekly" | "monthly";

// 목록 줄의 거래는 제목과 지금 상태만(손님 이름은 싣지 않음)
export interface TaskDeal { id: string; title: string; status: string }
export interface Task {
  id: string;
  title: string;
  dueOn: string | null;
  repeat: TaskRepeat;
  repeatDay: number | null;
  doneAt: string | null;
  version: number;
  deal: TaskDeal | null;
}
export interface TaskPage { items: Task[]; nextCursor: string | null }
export interface TaskInput { title?: string; dueOn?: string | null; dealId?: string | null; repeat?: TaskRepeat; done?: boolean }
// next: 끝내며 만든 다음 할 일(반복일 때), 또는 다시 열 때 그때 만든 다음 할 일이 아직 있으면 그 줄. 그 밖에는 null.
export interface TaskSaved { task: Task; next: Task | null }
export interface DealPick { id: string; title: string; status: string }

const idPath = (id: string) => encodeURIComponent(id);

export const listTasks = (query: URLSearchParams) => readWorkData<TaskPage>("/tasks", query);
export const createTask = (body: TaskInput) => writeWorkData<{ task: Task }>("/tasks", "POST", body);
export const updateTask = (id: string, body: TaskInput & { version: number }) => writeWorkData<TaskSaved>(`/tasks/${idPath(id)}`, "PATCH", body);
export const deleteTask = (id: string) => writeWorkData<{ deleted: boolean }>(`/tasks/${idPath(id)}`, "DELETE", {});
// 거래 찾기(매출장부와 같은 목록 API, 제목·상태만 쓴다)
export const findDeals = (query: URLSearchParams) => readWorkData<{ items: DealPick[]; nextCursor: string | null }>("/deals", query);
