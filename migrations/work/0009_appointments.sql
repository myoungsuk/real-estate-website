-- 업무 도구 D1 구조 9번: 거래 없는 일정(appointments)을 더한다(설계서 6.15절, 2026-11-25 사용자 결정 23:03:55 "새 표 따로"·23:32:21 "이 날만 / 이 날부터 모두").
-- 0001 ~ 0008은 원격에 적용됐으므로 고치지 않는다. 원격 적용은 PR 병합 전에 대장이 한다: 켜진 도구 확인 → `wrangler d1 export` 백업 → 사용자 승인 → 원격 적용 → schema_version 9 확인 → 병합.
-- 원격에 적용한 뒤에는 이 파일을 고칠 수 없다. 구조를 바꾸려면 새 번호 파일을 더한다.
--
-- - appointments: 손님·거래에 붙지 않는 일정(안내·상담·일상·비과세·임대차 종료·기타). 반복은 저장하지 않고 읽을 때 펼친다(src/lib/work/appointment-repeat.mjs).
--   꼬리표(tag)·반복 종류(repeat_rule)·알림 키(alarms)는 DB CHECK를 두지 않고 서버 코드가 검사한다(목록을 늘릴 때 표를 다시 만들지 않게, 사용자 답 "코드가 검사").
--   '이 날만' 고치기·지우기로 뺀 날은 skip_dates(JSON 배열)에, '이 날만 고친' 줄은 series_id·series_on으로 원래 반복 줄을 가리킨다(REFERENCES 없음, 코드가 함께 지움).
--   손님 연결 칸은 두지 않는다(사용자 답 "처음에는 붙이지 않음"). 나중에 ADD COLUMN customer_id로 더할 수 있다.
-- - trash_rows: CHECK에 'appointments' 표와 'appt_series'(반복 줄을 줄이기 전 값) 동작을 더하려고 새 표로 옮긴다. 이 표를 가리키는 표는 없다.
--   묶음(trash_batches)은 그대로다(일정 묶음은 기존 종류 'event'를 같이 씀).
-- 되돌리기: 이 파일을 적용하기 전에 받은 `wrangler d1 export` 백업으로 되돌리거나, 같은 날 안이면 D1 Time Travel로 적용 직전 시각을 고른다(설계서 8.4절).
-- 적용한 뒤 코드만 옛 판으로 되돌리면 옛 코드가 구조 번호 9를 보고 업무 API를 모두 503(WORK_SCHEMA_AHEAD)으로 막는다.

CREATE TABLE appointments (
  id           TEXT PRIMARY KEY,
  tag          TEXT NOT NULL,                                                   -- 코드가 검사(appointment-rules.mjs)
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),           -- 손님 이름이 들어갈 수 있음. 감사·로그·주소에 넣지 않는다
  starts_on    TEXT NOT NULL,                                                   -- 한국 날짜 YYYY-MM-DD(반복이면 첫날)
  start_time   TEXT CHECK (start_time IS NULL OR length(start_time) = 5),      -- 한국 시각 HH:MM, NULL이면 하루 종일
  end_time     TEXT CHECK (end_time IS NULL OR length(end_time) = 5),
  repeat_rule  TEXT NOT NULL DEFAULT 'none',                                    -- 코드가 검사(appointment-repeat.mjs)
  repeat_until TEXT,                                                            -- 끝나는 날(그날 포함), NULL이면 끝 없음
  skip_dates   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skip_dates) AND json_type(skip_dates) = 'array'),
  alarms       TEXT NOT NULL DEFAULT '["day-before-18"]' CHECK (json_valid(alarms) AND json_type(alarms) = 'array'),
  series_id    TEXT,                                                            -- '이 날만 고친' 줄의 원래 반복 줄 id
  series_on    TEXT,                                                            -- 그때 원래 반복의 날짜
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (end_time IS NULL OR (start_time IS NOT NULL AND end_time > start_time)),
  CHECK (repeat_until IS NULL OR (repeat_rule <> 'none' AND repeat_until >= starts_on)),
  CHECK (repeat_rule <> 'none' OR skip_dates = '[]'),
  CHECK ((series_id IS NULL) = (series_on IS NULL)),
  CHECK (series_id IS NULL OR repeat_rule = 'none')
);
CREATE INDEX idx_appointments_starts ON appointments(starts_on);
CREATE INDEX idx_appointments_series ON appointments(series_id) WHERE series_id IS NOT NULL;

CREATE TABLE trash_rows_v9 (
  batch_id   TEXT NOT NULL REFERENCES trash_batches(id),
  table_name TEXT NOT NULL CHECK (table_name IN ('customers','deals','deal_parties','deal_events','notes','files','ledger_entries','tasks','appointments')),
  op         TEXT NOT NULL CHECK (op IN ('row','note_customer','note_deal','ledger_deal','appt_series')),
  row_id     TEXT NOT NULL,                                              -- deal_parties는 deal_id || '|' || customer_id || '|' || role
  row_json   TEXT NOT NULL CHECK (json_valid(row_json)),
  PRIMARY KEY (batch_id, table_name, op, row_id)
);
INSERT INTO trash_rows_v9 (batch_id, table_name, op, row_id, row_json) SELECT batch_id, table_name, op, row_id, row_json FROM trash_rows;
DROP TABLE trash_rows;
ALTER TABLE trash_rows_v9 RENAME TO trash_rows;

-- 휴지통 묶음은 지울 때의 구조 번호와 지금 번호가 같을 때만 되살린다(worker/work-trash.mjs). 이 파일은 휴지통이 담는 표(손님·거래·메모·일정·장부·할 일·파일)의
-- 칸을 바꾸지 않으므로, 8번 때 지운 묶음도 그대로 되살릴 수 있게 번호를 9로 옮긴다(0008과 같은 방식, 7일 안 되살리기 약속을 지킴).
UPDATE trash_batches SET schema_version = 9 WHERE schema_version = 8;

-- 코드가 기대하는 구조 번호.
UPDATE settings SET value_json = '9', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
