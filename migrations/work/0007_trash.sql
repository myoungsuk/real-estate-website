-- 업무 도구 D1 구조 7번: 휴지통 7일(기획서 WT-2-13, 설계서 8.7절, 2026-11-21 사용자 결정 02:39:45).
-- 0001 ~ 0006은 원격 D1에 적용됐으므로 고치지 않는다. 원격 적용은 PR 병합과 따로 사용자 승인을 받고 백업 뒤에 한다.
-- 한 번의 삭제 = 한 묶음. 지운 행·끊은 연결을 JSON으로 옮겨 적고 원래 표에서는 지금처럼 실제로 지운다(T-1 가).
-- - kind·table_name에 파일 몫(file·files)을 미리 넣는다. SQLite는 CHECK를 바꾸려면 표를 다시 만들어야 해서다(R-4, 코드는 파일 PR 때).
-- - trash_rows의 기본 키에는 되살릴 순서 번호를 두지 않는다. 되살리는 순서는 코드의 고정 표 순서다(R-1).
-- - 휴지통 자료도 손님 개인정보다(label에 손님 이름, row_json에 전화번호·메모 본문). 7일 뒤 Cron이 영구 삭제한다.
CREATE TABLE trash_batches (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('customer','deal','note','event','ledger','task','file')),
  target_id      TEXT NOT NULL,
  label          TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),  -- 휴지통 목록 이름(손님 이름·거래 제목·메모 앞 40자 등). 개인정보
  schema_version INTEGER NOT NULL,                                       -- 지울 때 구조 번호. 지금과 다르면 되살리기 막음(T-7)
  deleted_at     TEXT NOT NULL,
  deleted_by     TEXT NOT NULL CHECK (length(deleted_by) > 0),
  request_id     TEXT NOT NULL,                                          -- 같은 요청의 감사 기록과 잇는 값(T-6)
  purge_after    TEXT NOT NULL                                           -- deleted_at + 7일
);
CREATE TABLE trash_rows (
  batch_id   TEXT NOT NULL REFERENCES trash_batches(id),
  table_name TEXT NOT NULL CHECK (table_name IN ('customers','deals','deal_parties','deal_events','notes','files','ledger_entries','tasks')),
  op         TEXT NOT NULL CHECK (op IN ('row','note_customer','note_deal','ledger_deal')),
  row_id     TEXT NOT NULL,                                              -- deal_parties는 deal_id || '|' || customer_id || '|' || role
  row_json   TEXT NOT NULL CHECK (json_valid(row_json)),
  PRIMARY KEY (batch_id, table_name, op, row_id)
);
CREATE INDEX idx_trash_batches_purge ON trash_batches(purge_after);
CREATE INDEX idx_trash_batches_deleted ON trash_batches(deleted_at DESC, id DESC);

UPDATE settings SET value_json = '7', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
