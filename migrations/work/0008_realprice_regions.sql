-- 업무 도구 D1 구조 8번: 실거래가를 대전 동구 한 곳에서 대전 5개 구로 넓힌다(설계서 22.5절, 2026-11-25 사용자 결정 "대전만 하면 될 것 같아").
-- 0001 ~ 0007은 원격에 적용됐으므로 고치지 않는다. 원격 적용은 PR 병합 뒤, 사용자 승인을 받고 `wrangler d1 export`로 백업한 다음 대장이 한다(진행 체크리스트 8a절).
-- 원격에 적용한 뒤에는 이 파일을 고칠 수 없다. 구조를 바꾸려면 새 번호 파일을 더한다.
--
-- 지금 있는 행은 모두 대전 동구(30110)다. 행을 지우거나 다시 쓰지 않고 그대로 30110으로 읽히게 한다.
-- - rt_trades: 칸 하나(lawd_cd)를 더한다. SQLite의 ADD COLUMN은 표 정의만 바꾸고 기존 행은 고쳐 쓰지 않는다(기존 행은 기본값 '30110'으로 읽힘).
--   CHECK는 더할 때 기존 행 전부에 대해 한 번 검사한다(읽기만, 약 13만 행). 거래 ID(trade_key)는 그대로다(동구 행의 ID가 바뀌지 않음).
-- - rt_fetch_months: 기본 키에 구가 들어가야 해서(같은 종류·같은 달을 구마다 따로 받음) 새 표로 옮긴다(약 680행).
-- - 색인은 더하지 않는다. 목록은 기본 키 범위(종류·계약 연월)로, 신고가·흐름·단지 상세는 idx_rt_trades_sale_group(cmp_seq = aptSeq, 구 코드로 시작)으로 읽는다.
-- 되돌리기: 이 파일을 적용하기 전에 받은 `wrangler d1 export` 백업으로 되돌리거나, 같은 날 안이면 D1 Time Travel로 적용 직전 시각을 고른다(설계서 8.4절).

ALTER TABLE rt_trades ADD COLUMN lawd_cd TEXT NOT NULL DEFAULT '30110'
  CHECK (lawd_cd IN ('30110','30140','30170','30200','30230'));  -- 동구·중구·서구·유성구·대덕구(src/lib/work/realprice-regions.mjs와 같아야 함, 시험이 대조)

CREATE TABLE rt_fetch_months_v8 (
  lawd_cd         TEXT NOT NULL CHECK (lawd_cd IN ('30110','30140','30170','30200','30230')),
  kind            TEXT NOT NULL CHECK (kind IN ('sale','rent','presale')),
  deal_ymd        TEXT NOT NULL CHECK (length(deal_ymd) = 6),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ok','failed','held')),
  row_count       INTEGER NOT NULL DEFAULT 0,
  dropped_count   INTEGER NOT NULL DEFAULT 0,
  held_count      INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT CHECK (last_error IS NULL OR length(last_error) <= 40),
  last_success_at TEXT,
  next_due_at     TEXT NOT NULL,
  PRIMARY KEY (lawd_cd, kind, deal_ymd)
) WITHOUT ROWID;

INSERT INTO rt_fetch_months_v8 (lawd_cd, kind, deal_ymd, status, row_count, dropped_count, held_count, attempts, last_error, last_success_at, next_due_at)
SELECT '30110', kind, deal_ymd, status, row_count, dropped_count, held_count, attempts, last_error, last_success_at, next_due_at FROM rt_fetch_months;

DROP TABLE rt_fetch_months;
ALTER TABLE rt_fetch_months_v8 RENAME TO rt_fetch_months;

-- 휴지통 묶음은 지울 때의 구조 번호와 지금 번호가 같을 때만 되살린다(worker/work-trash.mjs). 이 파일은 휴지통이 담는 표(손님·거래·메모·일정·장부·할 일·파일)를
-- 바꾸지 않으므로, 7번 때 지운 묶음도 그대로 되살릴 수 있게 번호를 8로 옮긴다(7일 안 되살리기 약속을 지킴).
UPDATE trash_batches SET schema_version = 8 WHERE schema_version = 7;

-- 코드가 기대하는 구조 번호. 단계 2 경로와 단계 P 경로가 같은 번호를 기대한다.
UPDATE settings SET value_json = '8', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
