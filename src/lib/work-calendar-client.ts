// 달력 화면(/admin/work/calendar/)의 업무 API 호출(날개-2 API 판 2). 세션·보안 토큰(X-Admin-CSRF)·응답 봉투 해석은
// 손님 화면과 같은 work-customers-client.ts를 쓴다. 일정 제목은 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";
import type { TrashRef } from "./work-trash-client";

export { WorkApiError, getCustomerSession as getCalendarSession } from "./work-customers-client";

export type AppointmentTag = "showing" | "consult" | "routine" | "tax" | "lease_end" | "other";
export type AppointmentRepeat = "none" | "daily" | "weekdays" | "weekly" | "monthly" | "yearly";
export type RepeatScope = "one" | "following";

export interface Appointment {
  id: string;
  tag: AppointmentTag;
  title: string;
  startsOn: string;
  startTime: string | null;
  endTime: string | null;
  repeatRule: AppointmentRepeat;
  repeatUntil: string | null;
  skipDates: string[];
  alarms: string[];
  seriesId: string | null;
  seriesOn: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarApiItem {
  key: string;
  source: "deal" | "task" | "appointment";
  id: string;
  on: string;
  kind?: string;
  title: string;
  startTime?: string | null;
  endTime?: string | null;
  done: boolean;
  repeat?: "none" | "weekly" | "monthly";
  deal: { id: string; title: string; status?: string } | null;
  customer: { id: string; displayName: string } | null;
  appointment?: Appointment;
}
export interface CalendarRange { from: string; to: string; today: string; truncated: boolean; items: CalendarApiItem[] }

export interface AppointmentInput {
  tag?: AppointmentTag;
  title?: string;
  startsOn?: string;
  startTime?: string | null;
  endTime?: string | null;
  repeatRule?: AppointmentRepeat;
  repeatUntil?: string | null;
  alarms?: string[];
}
export interface AppointmentWhere { version: number; scope?: RepeatScope; occurrenceOn?: string }
// 반복 줄을 '이 날만'·'이 날부터(그 뒤 날)'로 고치면 새 줄(appointment)과 원래 줄(series)이 함께 온다.
export interface AppointmentSaved { appointment: Appointment; series?: Appointment }

const idPath = (id: string) => encodeURIComponent(id);

/** 한 달 칸 범위(1 ~ 42일)의 거래 일정·할 일·거래 없는 일정. 요청 값은 날짜 둘뿐이다. */
export function readCalendar(from: string, to: string) {
  const query = new URLSearchParams();
  query.set("from", from);
  query.set("to", to);
  return readWorkData<CalendarRange>("/calendar", query);
}
export const readAppointment = (id: string) => readWorkData<{ appointment: Appointment }>(`/appointments/${idPath(id)}`);
export const createAppointment = (body: AppointmentInput) => writeWorkData<{ appointment: Appointment }>("/appointments", "POST", body);
export const updateAppointment = (id: string, body: AppointmentInput & AppointmentWhere) => writeWorkData<AppointmentSaved>(`/appointments/${idPath(id)}`, "PATCH", body);
// 반복 없는 줄은 빈 본문({}, 할 일 지우기와 같음), 반복 줄은 version·scope·occurrenceOn.
export const deleteAppointment = (id: string, body: AppointmentWhere | null) =>
  writeWorkData<{ deleted: boolean; trash?: TrashRef }>(`/appointments/${idPath(id)}`, "DELETE", body ?? {});
