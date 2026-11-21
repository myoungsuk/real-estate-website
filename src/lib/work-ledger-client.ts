// 매출장부 화면(단계 2, 설계서 6.12·10.2절)의 업무 API 호출. 세션·보안 토큰(X-Admin-CSRF)·응답 봉투 해석은 손님 화면과 같은
// work-customers-client.ts를 쓴다. 장부 물건 표시·메모는 브라우저 저장소·화면 주소·로그에 남기지 않는다.
import { readWorkData, writeWorkData } from "./work-customers-client";

export { WorkApiError, getCustomerSession as getLedgerSession } from "./work-customers-client";

export type LedgerKind = "fee" | "expense" | "other_income";
export type LedgerBasis = "balance" | "contract" | "received";
export type LedgerWarning = "VAT_DIFFERS" | "FEE_OVER_CAP";

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  dealId: string | null;
  payerRole: string | null;
  label: string;
  entryOn: string | null;
  amountWon: number;
  vatWon: number;
  receivedWon: number;
  receivedOn: string | null;
  snapContractOn: string | null;
  snapBalanceOn: string | null;
  memo: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  unpaidWon: number;
  basisOn: string | null;
  warnings?: LedgerWarning[];
}

export interface LedgerLine { month?: string; feeWon: number; vatWon: number; feeWithVatWon: number; receivedWon: number; unpaidWon: number; expenseWon: number; otherIncomeWon: number; netWon: number }
export interface LedgerSummary { year: string; months: LedgerLine[]; total: LedgerLine; undatedCount: number }
export interface LedgerPage { items: LedgerEntry[]; nextCursor: string | null; undatedCount: number }
export interface LedgerInput {
  kind?: LedgerKind;
  dealId?: string | null;
  payerRole?: string | null;
  label?: string;
  entryOn?: string | null;
  amountWon?: number;
  vatWon?: number;
  receivedWon?: number;
  receivedOn?: string | null;
  memo?: string;
}
export interface LedgerSaved { entry: LedgerEntry; warnings: LedgerWarning[] }

export interface DealSummary {
  id: string;
  title: string;
  dealType: string;
  propertyKind: string | null;
  propertyLabel: string | null;
  status: string;
  contractOn: string | null;
  balanceOn: string | null;
  priceWon: number | null;
  depositWon: number | null;
  monthlyRentWon: number | null;
  version: number;
  updatedAt: string;
  ledger?: { feeWon: number; vatWon: number; receivedWon: number; unpaidWon: number; entryCount: number };
}
export interface DealDetail { deal: DealSummary; parties: { customerId: string; role: string }[] }

const idPath = (id: string) => encodeURIComponent(id);

export const listLedger = (query: URLSearchParams) => readWorkData<LedgerPage>("/ledger", query);
export const readLedgerSummary = (year: string | number, basis: LedgerBasis) =>
  readWorkData<LedgerSummary>("/ledger/summary", new URLSearchParams({ year: String(year), basis }));
export const createLedgerEntry = (body: LedgerInput) => writeWorkData<LedgerSaved>("/ledger", "POST", body);
export const updateLedgerEntry = (id: string, body: LedgerInput & { version: number }) => writeWorkData<LedgerSaved>(`/ledger/${idPath(id)}`, "PATCH", body);
export const deleteLedgerEntry = (id: string) => writeWorkData<{ deleted: boolean }>(`/ledger/${idPath(id)}`, "DELETE", {});
// CSV 내려받기 전 감사(export.ledger). 200 { recorded: true }를 받은 뒤에만 화면이 CSV를 만든다.
export const recordLedgerExport = (body: { year: number; basis: LedgerBasis; count: number }) => writeWorkData<{ recorded: boolean }>("/ledger/export", "POST", body);
export const listDeals = (query: URLSearchParams) => readWorkData<{ items: DealSummary[]; nextCursor: string | null; undatedCount: number }>("/deals", query);
export const readDeal = (id: string) => readWorkData<DealDetail>(`/deals/${idPath(id)}`);
