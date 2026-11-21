-- 업무 도구 D1 구조 5번: 매출장부(설계서 6.12·8.2·8.7절, DEC-WT-38·39, 2026-11-21 사용자 결정 02:39:45).
-- 0001 ~ 0004는 원격 D1에 적용됐으므로 고치지 않는다. 원격 적용은 PR 병합과 따로 사용자 승인을 받고 백업 뒤에 한다.
-- 휴지통 표(trash_*)는 이 파일에 넣지 않는다(휴지통 PR의 다음 번호, 설계서 8.4절).
-- - 한 거래에 장부 줄을 여러 개 둔다(쌍방 보수). 손님 ID 칸은 없다(누가 낸 보수인지는 payer_role 역할만).
-- - 거래·손님을 지우면 장부 줄은 남기고 거래 연결만 끊는다(deal_id NULL, 거래의 계약일·잔금일은 snap_*, 빈 label에는 거래 제목, DEC-WT-38).
-- - "날짜가 하나는 있어야 한다" CHECK는 두지 않는다. 날짜 없는 거래에 지출 줄이 붙어 있으면 거래 삭제의 연결 끊기가
--   그 CHECK에 걸려 삭제 batch 전체가 실패하기 때문이다. 거래 없는 새 지출·기타 수입의 날짜 필수는 서버 입력 검사로만 하고,
--   기준일이 없는 줄은 종류와 상관없이 "기준일 없는 n건"(undatedCount)으로 센다.
-- - 날짜 칸(entry_on·received_on·snap_*)은 YYYY-MM-DD 글자이고 형식 검사는 서버 입력 검사에서 한다.

CREATE TABLE ledger_entries (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('fee','expense','other_income')),
  deal_id          TEXT REFERENCES deals(id),
  payer_role       TEXT CHECK (payer_role IS NULL OR (kind = 'fee' AND payer_role IN ('buyer','seller','tenant','landlord','other'))),
  label            TEXT NOT NULL DEFAULT '' CHECK (length(label) <= 120),
  entry_on         TEXT CHECK (entry_on IS NULL OR deal_id IS NULL),
  amount_won       INTEGER NOT NULL CHECK (amount_won >= 0),
  vat_won          INTEGER NOT NULL DEFAULT 0 CHECK (vat_won >= 0),
  received_won     INTEGER NOT NULL DEFAULT 0 CHECK (received_won >= 0 AND (kind <> 'expense' OR received_won = 0)),
  received_on      TEXT,
  snap_contract_on TEXT,
  snap_balance_on  TEXT,
  memo             TEXT NOT NULL DEFAULT '' CHECK (length(memo) <= 500),
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX idx_ledger_deal ON ledger_entries(deal_id);
CREATE INDEX idx_ledger_entry_on ON ledger_entries(entry_on);

UPDATE settings SET value_json = '5', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
