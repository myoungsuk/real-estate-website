// '계약 일정' 화면의 휴대폰 캘린더 구독 칸(단계 3 C-b)이 쓰는 업무 API 호출. 세션·보안 토큰(X-Admin-CSRF)·응답 봉투 해석은
// 손님 화면과 같은 work-customers-client.ts를 쓴다. 구독 주소(subscribeUrl)는 만들 때 응답에만 있고, 브라우저 저장소·화면 주소·로그에 넣지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";

export { WorkApiError, getCustomerSession as getFeedSession } from "./work-customers-client";

export interface CalendarFeed { id: string; label: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

const idPath = (id: string) => encodeURIComponent(id);

export const listCalendarFeeds = () => readWorkData<{ feeds: CalendarFeed[] }>("/calendar-feeds");
// 새 주소: 서버가 이전 주소를 같은 요청 안에서 취소한다(사무소 주소 1개).
export const createCalendarFeed = () => writeWorkData<{ feed: CalendarFeed; subscribeUrl: string }>("/calendar-feeds", "POST", {});
export const revokeCalendarFeed = (id: string) => writeWorkData<{ revoked: boolean }>(`/calendar-feeds/${idPath(id)}`, "DELETE", {});
