// 계약서 AI 일정 뽑기(단계 4) 업무 API 호출. 세션·보안 토큰·봉투 해석은 손님 화면(work-customers-client.ts)과 같다.
// - 만들기·취소·확정만 쓰기이고, 조회·거래별 목록·예상 비용은 읽기다. 거래별 목록·예상 비용은 결과를 싣지 않아 열람 감사가 남지 않는다.
// - 묶음 조회(GET ai/jobs/:id)는 묶음이 끝났을 때만 결과를 싣고 그때 서버가 열람 감사(ai.view)를 남긴다. 그래서 끝난 뒤에는 다시 부르지 않는다(G17).
// - 계약서 글·금액·날짜는 화면 메모리에만 두고 주소·브라우저 저장소·로그에 넣지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";
import type { DealEvent } from "./work-customers-client";

export type AiGroupStatus = "running" | "ready" | "confirmed" | "failed" | "cancelled";
export type AiPairMode = "cross" | "same_unset" | "same_chosen";
export interface AiJobSummary { id: string; runIndex: number; model: string; status: string; errorCode: string | null }
// result는 contract-extract.mjs validateContractResult()를 통과한 snake_case 객체(묶음이 끝났을 때만, 그 작업이 결과를 냈을 때만).
export interface AiJob extends AiJobSummary { reasoningEffort: string | null; maskedCount: number; result: Record<string, any> | null }
export interface AiGroup {
  id: string;
  kind: string;
  // 사본이 모두 한 거래에 남아 있을 때만 거래 ID(하나라도 휴지통이면 null)
  dealId: string | null;
  status: AiGroupStatus;
  pairMode: AiPairMode;
  createdAt: string;
  confirmedAt: string | null;
  // 읽은 계약서 사본 ID(읽은 순서 = 근거의 쪽 번호). 옛 응답에는 없을 수 있다.
  fileIds?: string[];
}
export interface AiGroupView { group: AiGroup; jobs: AiJob[] }
export interface AiGroupListItem { groupId: string; status: AiGroupStatus; pairMode: AiPairMode; createdAt: string; confirmedAt: string | null; jobs: AiJobSummary[] }
export interface AiEstimate {
  pages: number;
  requests: number;
  estimatedCostMicroUsd: number;
  dailyCreateLimit: number | null;
  todayCreates: number;
  remainingCreates: number | null;
  monthlyCostLimitMicroUsd: number | null;
  monthCostMicroUsd: number;
  remainingCostMicroUsd: number | null;
  allowed: boolean;
  blockedBy: null | "limits_missing" | "daily" | "monthly";
}
export interface AiConfirmBody { dealVersion: number; apply: Record<string, unknown>; keep: string[] }
export interface AiConfirmResult { deal: Record<string, unknown>; events: DealEvent[]; notices: string[]; kept: { kind: string; keptOn: string; calculatedOn: string; reason: string }[] }

const idPath = (id: string) => encodeURIComponent(id);

export const createAiJob = (dealId: string, fileIds: string[]) =>
  writeWorkData<{ groupId: string; pairMode: AiPairMode; jobs: AiJobSummary[] }>("/ai/jobs", "POST", { kind: "contract_schedule", fileIds, dealId });
export const readAiGroup = (groupId: string) => readWorkData<AiGroupView>(`/ai/jobs/${idPath(groupId)}`);
export const listAiGroups = (dealId: string) => readWorkData<{ items: AiGroupListItem[] }>("/ai/jobs", new URLSearchParams({ dealId }));
export const cancelAiGroup = (groupId: string) => writeWorkData<{ status: string }>(`/ai/jobs/${idPath(groupId)}/cancel`, "POST", {});
export const confirmAiGroup = (groupId: string, body: AiConfirmBody) => writeWorkData<AiConfirmResult>(`/ai/jobs/${idPath(groupId)}/confirm`, "POST", body);
// 결과 고르기 화면이 읽는 거래 하나(GET /deals/:id, 서버가 deal.view 감사를 남김). 일정 미리 보기에 거래 칸 전체와 지금 일정이 필요하다.
export interface AiDeal {
  id: string; title: string; dealType: string; saleKind: string | null; propertyKind: string; scheduleTarget: string | null; propertyLabel: string | null;
  priceWon: number | null; depositWon: number | null; monthlyRentWon: number | null; contractOn: string | null; middlePaymentOn: string | null; balanceOn: string | null;
  buyerIsCorporation: boolean; regulation: string | null; landPermitArea: boolean; metroArea: boolean; landShare: boolean; separateFundingSubmission: boolean;
  leaseReportingRegion: boolean; leaseRenewalWithoutChange: boolean; status: string; version: number;
}
export interface AiDealDetail { deal: AiDeal; parties: { customerId: string; role: string; displayName: string }[]; events: DealEvent[] }
export const readAiDeal = (dealId: string) => readWorkData<AiDealDetail>(`/deals/${idPath(dealId)}`);
export const readAiEstimate =(pages: number) => readWorkData<AiEstimate>("/ai/estimate", new URLSearchParams({ pages: String(pages) }));
