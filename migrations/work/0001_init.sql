-- 업무 도구 단계 2 첫 구조(설계서 8.2·8.3절). 원격 적용은 배포 담당이 사용자 승인 뒤
-- `wrangler d1 export`로 백업한 다음 `wrangler d1 migrations apply leaderscity-work --remote`로 한다(8.4절).
-- 다시 적용 방지는 wrangler의 d1_migrations 기록이 맡는다. 이 파일을 직접 두 번 실행하면 CREATE TABLE에서 멈춘다.
-- 외래 키는 D1이 기본으로 검사한다고 알려져 있어 PRAGMA를 넣지 않는다(시험은 node:sqlite에서 foreign_keys를 켜고 확인).

CREATE TABLE customers (
  id               TEXT PRIMARY KEY,
  display_name     TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 60),
  phone_digits     TEXT CHECK (phone_digits IS NULL OR phone_digits GLOB '[0-9]*'),
  needs            TEXT NOT NULL DEFAULT '' CHECK (length(needs) <= 2000),  -- 찾는 조건
  status           TEXT NOT NULL DEFAULT 'consulting'
                   CHECK (status IN ('consulting','contracting','completed','on_hold')),
  last_contact_on  TEXT,
  retention_until  TEXT,                                -- 정리 안내 기준일(삭제 예정일 아님). 지나면 1년마다 정리 알림만 띄움
  version          INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

CREATE TABLE deals (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  deal_type            TEXT NOT NULL CHECK (deal_type IN ('sale','exchange','jeonse','monthly_rent')),
  property_kind        TEXT NOT NULL CHECK (property_kind IN ('housing','officetel','other','land')),
  property_label       TEXT NOT NULL DEFAULT '' CHECK (length(property_label) <= 120),
  price_won            INTEGER CHECK (price_won IS NULL OR price_won >= 0),
  deposit_won          INTEGER CHECK (deposit_won IS NULL OR deposit_won >= 0),
  monthly_rent_won     INTEGER CHECK (monthly_rent_won IS NULL OR monthly_rent_won >= 0),
  contract_on          TEXT,
  middle_payment_on    TEXT,
  balance_on           TEXT,
  buyer_is_corporation INTEGER NOT NULL DEFAULT 0 CHECK (buyer_is_corporation IN (0,1)),
  regulated_area       INTEGER NOT NULL DEFAULT 0 CHECK (regulated_area IN (0,1)),
  land_permit_area     INTEGER NOT NULL DEFAULT 0 CHECK (land_permit_area IN (0,1)),
  metro_area           INTEGER NOT NULL DEFAULT 1 CHECK (metro_area IN (0,1)),  -- 수도권등
  status               TEXT NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open','contracted','completed','cancelled')),
  closed_on            TEXT,
  retention_until      TEXT,                            -- 정리 안내 기준일(삭제 예정일 아님)
  version              INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE deal_parties (
  deal_id      TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  customer_id  TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('buyer','seller','tenant','landlord','other')),
  PRIMARY KEY (deal_id, customer_id, role)
);

CREATE TABLE deal_events (
  id          TEXT PRIMARY KEY,
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('contract','middle_payment','balance',
                'transaction_report','funding_plan_to_agent','funding_plan_submit',
                'lease_report','custom')),
  due_on      TEXT NOT NULL,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  alarm_offsets TEXT NOT NULL DEFAULT '["-PT6H"]',   -- RFC 5545 duration JSON 배열, 최대 2개
  source      TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('calculated','manual','ai_confirmed')),
  done_at     TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE notes (
  id           TEXT PRIMARY KEY,
  customer_id  TEXT REFERENCES customers(id) ON DELETE CASCADE,
  deal_id      TEXT REFERENCES deals(id) ON DELETE CASCADE,
  body         TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  source       TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','transcript','ai_summary')),
  file_id      TEXT REFERENCES files(id) ON DELETE SET NULL,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
-- customer_id·deal_id가 모두 NULL이면 "메모 창고" 메모다.

CREATE TABLE files (
  id              TEXT PRIMARY KEY,
  r2_key          TEXT NOT NULL UNIQUE,
  kind            TEXT NOT NULL CHECK (kind IN ('contract_copy','registry','recording',
                    'property_photo','document','other')),
  mime_type       TEXT NOT NULL,
  byte_size       INTEGER NOT NULL CHECK (byte_size > 0),
  sha256_hex      TEXT NOT NULL CHECK (length(sha256_hex) = 64),
  customer_id     TEXT REFERENCES customers(id) ON DELETE SET NULL,
  deal_id         TEXT REFERENCES deals(id) ON DELETE SET NULL,
  rrn_masked      INTEGER NOT NULL DEFAULT 0 CHECK (rrn_masked IN (0,1)),   -- 사용자가 가림 완료를 확인
  caption         TEXT NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  extracted_text  TEXT,                       -- 단계 4 글자 인식 결과(주민번호 가림 후)
  recording_group_id TEXT,                    -- 대면 녹음 묶음 ID(14.11절)
  recording_index    INTEGER CHECK (recording_index IS NULL OR recording_index BETWEEN 1 AND 40),
  retention_until TEXT,                                 -- 정리 안내 기준일(삭제 예정일 아님)
  created_at      TEXT NOT NULL,
  UNIQUE (recording_group_id, recording_index)
);

CREATE TABLE ai_jobs (
  id                  TEXT PRIMARY KEY,
  group_id            TEXT NOT NULL,          -- 두 번 읽기 묶음
  run_index           INTEGER NOT NULL CHECK (run_index IN (1,2)),
  pair_mode           TEXT CHECK (pair_mode IS NULL OR pair_mode IN ('cross','same_chosen','same_unset')),
                      -- 계약서 두 번 읽기 묶음만 값이 있고 묶음의 두 행에 같은 값(14.2·14.3절)
                      -- cross: 두 모델 교차 / same_chosen: 운영자가 고른 같은 모델 두 번 / same_unset: CONTRACT_B 설정 누락으로 생긴 같은 모델 두 번
  kind                TEXT NOT NULL CHECK (kind IN ('contract_schedule','registry_message',
                        'transcription','transcript_summary','photo_text','photo_caption')),
  status              TEXT NOT NULL CHECK (status IN ('queued','in_progress','completed',
                        'failed','cancelled','expired','unknown')),
  openai_response_id  TEXT,
  lease_until         TEXT,                   -- Cron이 작업을 가져간 뒤 만료 시각(음성 변환)
  result_note_id      TEXT REFERENCES notes(id) ON DELETE SET NULL,
  model               TEXT NOT NULL,
  reasoning_effort    TEXT NOT NULL,
  input_file_ids      TEXT NOT NULL DEFAULT '[]',
  result_json         TEXT,                   -- 스키마 검증·주민번호 가림 뒤의 초안
  error_code          TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  confirmed_at        TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE TABLE ai_usage_daily (
  day                   TEXT PRIMARY KEY,     -- KST 기준 YYYY-MM-DD
  create_requests       INTEGER NOT NULL DEFAULT 0,
  transcribe_requests   INTEGER NOT NULL DEFAULT 0,
  transcribe_seconds    INTEGER NOT NULL DEFAULT 0,   -- 음성 변환 예산은 길이로 셈(14.9절)
  input_tokens          INTEGER NOT NULL DEFAULT 0,
  output_tokens         INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE worker_leases (
  name         TEXT PRIMARY KEY,              -- 예: 'transcription-runner'(14.6절)
  holder       TEXT NOT NULL,                 -- Cron 실행마다 만든 무작위 ID
  lease_until  TEXT NOT NULL
);

CREATE TABLE calendar_feeds (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,         -- HMAC-SHA256(token, WORK_FEED_TOKEN_PEPPER)
  label         TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);

CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE audit_events (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  at           TEXT NOT NULL,
  actor_email  TEXT NOT NULL CHECK (length(actor_email) > 0),  -- 서명 검증된 Access JWT의 email(소문자)
  action       TEXT NOT NULL,                 -- 예: customer.view, customer.update, file.download, export.full, ai.create, request.denied
  target_type  TEXT,
  target_id    TEXT,
  request_id   TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('ok','denied','failed')),
  reason       TEXT CHECK (reason IS NULL OR length(reason) <= 64)  -- 거부·실패 이유 코드(예: CSRF_INVALID). 입력값·본문은 넣지 않는다
);

CREATE INDEX idx_customers_status_updated ON customers(status, updated_at DESC);
CREATE INDEX idx_customers_phone ON customers(phone_digits);
CREATE INDEX idx_deal_events_due ON deal_events(due_on) WHERE done_at IS NULL;
CREATE INDEX idx_deal_events_deal ON deal_events(deal_id);
CREATE INDEX idx_deal_parties_customer ON deal_parties(customer_id);
CREATE INDEX idx_notes_customer_created ON notes(customer_id, created_at DESC);
CREATE INDEX idx_notes_inbox ON notes(created_at DESC) WHERE customer_id IS NULL AND deal_id IS NULL;
CREATE INDEX idx_files_customer ON files(customer_id);
CREATE INDEX idx_files_deal ON files(deal_id);
CREATE INDEX idx_files_recording_group ON files(recording_group_id, recording_index) WHERE recording_group_id IS NOT NULL;
CREATE INDEX idx_ai_jobs_group ON ai_jobs(group_id);
CREATE INDEX idx_ai_jobs_pending ON ai_jobs(status) WHERE status IN ('queued','in_progress');
CREATE INDEX idx_audit_at ON audit_events(at);
CREATE INDEX idx_audit_actor_at ON audit_events(actor_email, at);

-- 코드가 기대하는 구조 번호. Worker는 이 값이 코드보다 낮으면 WORK_SCHEMA_OUTDATED, 높으면 WORK_SCHEMA_AHEAD로 막는다.
INSERT INTO settings (key, value_json, updated_at) VALUES ('schema_version', '1', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
