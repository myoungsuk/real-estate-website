// 단계 4 AI 작업 시험 공용 도구(시험 파일이 아니라 npm test가 직접 돌리지 않음). 가짜 자료·가짜 R2·가짜 OpenAI만 쓴다.
import { FAKE_OPENAI_KEY } from "./openai-fixtures.mjs";
import { NOW, createR2, freshDb, nextUuid, workEnv } from "./work-test-kit.mjs";

export const MODEL_A = "gpt-test-contract-a";
export const MODEL_B = "gpt-test-contract-b";
export const AI_MAX_OUTPUT = 20_000;
// 100만 토큰당 마이크로달러(시험용 이름, 설계서 14.2의 두 모델 단가와 같은 크기).
export const AI_PRICES = { [MODEL_A]: { input: 2_000_000, output: 10_000_000 }, [MODEL_B]: { input: 10_000_000, output: 50_000_000 } };
// 감사·로그에 새지 않아야 할 표식 글자.
export const MARK = { title: "ZZTITLE-가상거래", key: "ZZR2KEY", property: "ZZPROPERTY-가상번지", quote: "ZZQUOTE-가상문구" };

export const aiEnv = (db, r2, extra = {}) => workEnv(db, {
  WORK_FILES_ENABLED: "true",
  WORK_FILES: r2,
  WORK_AI_ENABLED: "true",
  OPENAI_API_KEY: FAKE_OPENAI_KEY,
  OPENAI_MODEL: MODEL_A,
  OPENAI_MODEL_CONTRACT_B: MODEL_B,
  OPENAI_REASONING_EFFORT: "max",
  OPENAI_MAX_OUTPUT_TOKENS: String(AI_MAX_OUTPUT),
  OPENAI_IMAGE_DETAIL: "high",
  OPENAI_PRICES_JSON: JSON.stringify(AI_PRICES),
  ...extra,
});

export function setLimits(database, { daily = 10, monthly = 50_000_000 } = {}) {
  const put = database.prepare("INSERT OR REPLACE INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)");
  put.run("ai_daily_create_limit", JSON.stringify(daily), new Date(NOW).toISOString());
  put.run("ai_monthly_cost_limit_micro_usd", JSON.stringify(monthly), new Date(NOW).toISOString());
}

export function seedDeal(database, { id = nextUuid(), title = MARK.title } = {}) {
  const at = new Date(NOW).toISOString();
  database.prepare("INSERT INTO deals (id, title, deal_type, property_kind, created_at, updated_at) VALUES (?, ?, 'sale', 'housing', ?, ?)").run(id, title, at, at);
  return id;
}

// 가짜 사진 바이트(JPEG 머리 2바이트 + 채움). seed마다 내용이 다르다.
export function fakeImage(size = 300, seed = 1) {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  for (let index = 2; index < size; index += 1) bytes[index] = (index * 31 + seed * 7) % 256;
  return bytes;
}

// files 행 + R2 객체를 직접 넣는다(올리기 API는 work-files 시험이 본다). 돌려주는 값: 파일 ID.
export async function seedCopy(database, r2, { dealId, bytes = fakeImage(), kind = "contract_copy", rrnMasked = 1, mime = "image/jpeg", byteSize, putObject = true } = {}) {
  const id = nextUuid();
  const key = `work/${MARK.key}/${id}`;
  if (putObject) {
    await r2.put(key, bytes);
    r2.calls.length = 0;
  }
  database.prepare(`INSERT INTO files (id, r2_key, kind, mime_type, byte_size, sha256_hex, customer_id, deal_id, rrn_masked, created_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`).run(id, key, kind, mime, byteSize ?? bytes.byteLength, "a".repeat(64), dealId, rrnMasked, new Date(NOW).toISOString());
  return id;
}

// 흔한 준비: D1 + R2 + 켜진 env + 한도 + 거래 1개 + 계약서 사본 pages장.
export async function setupAi({ env: extraEnv = {}, limits = {}, pages = 2 } = {}) {
  const { database, db } = freshDb();
  const r2 = createR2();
  const env = aiEnv(db, r2, extraEnv);
  if (limits) setLimits(database, limits);
  const dealId = seedDeal(database);
  const fileIds = [];
  const images = [];
  for (let page = 1; page <= pages; page += 1) {
    const bytes = fakeImage(300 + page, page);
    images.push(bytes);
    fileIds.push(await seedCopy(database, r2, { dealId, bytes }));
  }
  return { database, db, r2, env, dealId, fileIds, images, body: { kind: "contract_schedule", fileIds, dealId } };
}

const evidence = (quote = "", page = 1) => ({ page, quote, box: null });

// 정상 결과 하나(가상 값). 시험마다 덮어쓴다.
export const sampleContract = (overrides = {}) => ({
  document_kind: "sale_contract",
  deal_type: "sale",
  contract_date: { value: "2026-11-02", evidence: evidence(MARK.quote) },
  price_won: { value: 350_000_000, evidence: evidence("금 삼억오천만원정") },
  deposit_won: { value: null, evidence: evidence() },
  monthly_rent_won: { value: null, evidence: evidence() },
  down_payment: { amount: { value: 35_000_000, evidence: evidence("계약금") }, date: { value: "2026-11-02", evidence: evidence("계약시") } },
  middle_payments: [],
  balance: { amount: { value: 315_000_000, evidence: evidence("잔금", 2) }, date: { value: "2026-12-30", evidence: evidence("2026년 12월 30일", 2) } },
  property_text: { value: MARK.property, evidence: evidence("소재지") },
  warnings: [],
  ...overrides,
});
