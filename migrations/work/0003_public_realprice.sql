-- 업무 도구 D1 구조 3번: 단계 P 공개 실거래 자료(설계서 22.5절, ADR-011 2026-11-19 보탬).
-- 손님 자료 표와 외래 키·조인을 두지 않는다. 0001·0002는 원격에 적용됐으므로 고치지 않는다.
-- 원격 적용은 PR 병합 뒤, 사용자 승인을 받고 `wrangler d1 export`로 백업한 다음에 한다(설계서 8.4·22.15절).
-- 원격에 적용한 뒤에는 이 파일을 고칠 수 없다. 구조를 바꾸려면 새 번호 파일을 더한다.
--
-- 키 발급 뒤 첫 확인(TK-43, 2026-11-19 15:44 운영자 PC에서 첫 확인 스크립트 실행)으로 정한 것:
-- - rt_complex_keys(옛 매매의 aptSeq 빈 칸을 메우는 표)는 만들지 않는다(D-4). 2006 ~ 2015년 각 6월 매매 상세
--   2,628행에서 aptSeq 빈 값이 0건이었다. cmp_seq에는 apt_seq를 그대로 넣는다(worker/realprice-store.mjs).
-- - 칸 길이 제한은 설계 그대로 둔다(관찰한 최대 aptSeq 10·aptNm 16·aptDong 4·umdNm 3자).
--   worker/realprice-rows.mjs의 REALPRICE_ROW_LIMITS와 같아야 한다(시험이 대조). 넘는 행은 칸 변환이 버리고 dropped_count에 센다.

CREATE TABLE rt_trades (
  trade_key        TEXT PRIMARY KEY CHECK (length(trade_key) BETWEEN 20 AND 60),
                   -- '{kind}:{YYYYMM}:{서명 SHA-256 앞 20자}:{같은 서명 안 순번}'(22.6절)
  kind             TEXT NOT NULL CHECK (kind IN ('sale','rent','presale')),   -- 매매·전월세·분양권
  deal_ymd         TEXT NOT NULL CHECK (length(deal_ymd) = 6),
  deal_date        TEXT NOT NULL CHECK (length(deal_date) = 10),              -- 계약일
  umd_nm           TEXT NOT NULL DEFAULT '' CHECK (length(umd_nm) <= 30),     -- 전월세 명세 크기 30(2026-11-19 D-7)
  jibun            TEXT NOT NULL DEFAULT '' CHECK (length(jibun) <= 20),
  apt_seq          TEXT CHECK (apt_seq IS NULL OR length(apt_seq) BETWEEN 1 AND 20),
  cmp_seq          TEXT CHECK (cmp_seq IS NULL OR length(cmp_seq) BETWEEN 1 AND 20),  -- 신고가 비교용 단지 번호. 넣을 때 apt_seq를 그대로 씀(D-4)
  apt_nm           TEXT NOT NULL CHECK (length(apt_nm) BETWEEN 1 AND 80),
  area_x100        INTEGER NOT NULL CHECK (area_x100 > 0),
  floor            INTEGER,
  build_year       INTEGER,
  price_won        INTEGER CHECK (price_won IS NULL OR price_won >= 0),
  deposit_won      INTEGER CHECK (deposit_won IS NULL OR deposit_won >= 0),
  monthly_rent_won INTEGER CHECK (monthly_rent_won IS NULL OR monthly_rent_won >= 0),
  dealing_gbn      TEXT CHECK (dealing_gbn IS NULL OR dealing_gbn IN ('broker','direct')),
  cancelled        INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0,1)),
  cancelled_on     TEXT,
  registered_on    TEXT,
  apt_dong         TEXT CHECK (apt_dong IS NULL OR length(apt_dong) <= 20),  -- 명세 크기는 400. 넘으면 칸 변환이 NULL로 두고 센다(22.4절)
  extra_json       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(extra_json) AND length(extra_json) <= 1000),
  is_backfill      INTEGER NOT NULL DEFAULT 0 CHECK (is_backfill IN (0,1)),  -- 처음 채우기로 들어온 행("새로 들어옴" 표시에서 뺌)
  first_seen_at    TEXT NOT NULL,
  updated_at       TEXT NOT NULL
) WITHOUT ROWID;

-- 색인은 신고가 판정용 부분 색인 하나만 둔다(색인 칸을 쓸 때마다 D1 쓰기 행이 하나 더 든다, 22.5절).
CREATE INDEX idx_rt_trades_sale_group ON rt_trades(cmp_seq, area_x100, deal_date) WHERE kind = 'sale';

CREATE TABLE rt_fetch_months (
  kind            TEXT NOT NULL CHECK (kind IN ('sale','rent','presale')),
  deal_ymd        TEXT NOT NULL CHECK (length(deal_ymd) = 6),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed','held')),
  row_count       INTEGER NOT NULL DEFAULT 0,  -- 저장한 행 수(버린 뒤)
  dropped_count   INTEGER NOT NULL DEFAULT 0,  -- 마지막 반영에서 칸 변환이 버린 항목 수(2026-11-19 D-5). row_count + dropped_count = 받은 totalCount
  held_count      INTEGER,                     -- 'held'(건수가 크게 줄어 반영을 미룸) 때 받은 건수(버린 뒤)
  attempts        INTEGER NOT NULL DEFAULT 0,  -- 받기 시작 때 +1, 끝나면 0. 0이 아닌데 시작한 실행이 끝났으면 중단으로 봄
  last_error      TEXT CHECK (last_error IS NULL OR length(last_error) <= 40),
  last_success_at TEXT,
  next_due_at     TEXT NOT NULL,
  PRIMARY KEY (kind, deal_ymd)
) WITHOUT ROWID;

CREATE TABLE rt_fetch_runs (
  seq          INTEGER PRIMARY KEY,         -- 받은 일이 있는 실행만 기록(빈 실행은 기록하지 않음)
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  months_done  INTEGER NOT NULL DEFAULT 0,
  api_calls    INTEGER NOT NULL DEFAULT 0,
  inserted     INTEGER NOT NULL DEFAULT 0,
  updated      INTEGER NOT NULL DEFAULT 0,
  deleted      INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,  -- D1 응답 meta.rows_written 합
  outcome      TEXT NOT NULL DEFAULT 'running' CHECK (outcome IN ('running','ok','partial','failed')),
  error_code   TEXT CHECK (error_code IS NULL OR length(error_code) <= 40)
);

CREATE TABLE rt_daily_usage (
  day_utc      TEXT PRIMARY KEY,            -- D1 무료 한도가 UTC 0시(한국 09시)에 초기화되므로 UTC 날짜
  api_calls    INTEGER NOT NULL DEFAULT 0,
  rows_written INTEGER NOT NULL DEFAULT 0,
  rows_read    INTEGER NOT NULL DEFAULT 0   -- Cron과 실거래가 조회 API의 meta.rows_read 합(22.7절 읽기 예산)
) WITHOUT ROWID;

CREATE TABLE rt_watch_complexes (
  apt_seq      TEXT PRIMARY KEY CHECK (length(apt_seq) BETWEEN 1 AND 20),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 40),
  complex_slug TEXT CHECK (complex_slug IS NULL OR length(complex_slug) <= 60),  -- complexes.json의 공개 단지와 연결(있으면)
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
) WITHOUT ROWID;

-- 관심 단지 저장의 version 확인(22.9절)이 비교할 행.
INSERT INTO settings (key, value_json, updated_at) VALUES ('realprice_watch_version', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
-- 코드가 기대하는 구조 번호. 단계 2 경로와 단계 P 경로가 같은 번호를 기대한다.
UPDATE settings SET value_json = '3', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
