// 관리자 대시보드(/admin/)의 업무 API 호출(GET /work/dashboard 하나). 응답 봉투 해석은 손님 화면과 같은 work-customers-client.ts를 쓴다.
// 서버가 칸마다 켜기 값을 따로 보므로 업무 세션을 먼저 묻지 않는다(업무 도구가 꺼져 있으면 서버가 D1을 읽지 않고 '꺼짐'만 돌려준다).
// 손님 이름·할 일 제목은 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readWorkData } from "./work-customers-client";

export { WorkApiError } from "./work-customers-client";

export type DashboardFailed = { ok: false; code: string };

export interface DashboardTasks {
  ok: true;
  overdue: number;
  dueToday: number;
  items: { id: string; title: string; dueOn: string; repeat: string; deal: { id: string; title: string } | null }[];
}
export interface DashboardEvent {
  id: string;
  kind: string;
  kindLabel: string;
  title: string;
  dueOn: string;
  deal: { id: string; title: string; dealType: string };
  customer: { id: string; displayName: string } | null;
  partyCount: number;
}
export interface DashboardEvents { ok: true; until: string; total: number; overdue: number; items: DashboardEvent[] }
export interface DashboardMoney {
  ok: true;
  month: string;
  basis: string;
  receivableWon: number;
  receivedWon: number;
  unpaidWon: number;
  unpaidCount: number;
  undatedCount: number;
  items: { id: string; kind: string; label: string; payerRole: string | null; basisOn: string; unpaidWon: number }[];
}
export interface DashboardRealprice {
  ok: true;
  newCount: number;
  watchNewCount: number;
  newHighCount: number | null;
  partial: boolean;
  items: { tradeKey: string; dealDate: string; aptName: string; areaM2: number; priceWon: number | null }[];
}
export interface Dashboard {
  today: string;
  tasks: DashboardTasks | DashboardFailed;
  events: DashboardEvents | DashboardFailed;
  money: DashboardMoney | DashboardFailed;
  realprice: DashboardRealprice | DashboardFailed;
}

export const getDashboard = () => readWorkData<Dashboard>("/dashboard");
