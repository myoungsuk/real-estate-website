-- 업무 도구 D1 구조 6번: 할 일·반복 할 일(설계서 6.13·8.2·8.7절, 기획서 WT-2-12, 2026-11-21 사용자 결정 11:15:11).
-- 0001 ~ 0005는 원격 D1에 적용됐으므로 고치지 않는다. 원격 적용은 PR 병합과 따로 사용자 승인을 받고 백업 뒤에 한다.
-- 휴지통 표(trash_*)는 0007에서 만든다. 0007의 table_name CHECK에 'tasks'를 넣어야 하므로 이 표가 먼저다(설계서 8.4절).
-- - 반복은 끝낼 때 다음 줄 하나를 새로 만든다(앞날 줄을 미리 펼쳐 두지 않음). 열린 줄만 반복 규칙을 가진다.
-- - 거래를 지우면 거래·손님 삭제 batch가 이 표의 줄을 명시적으로 지운다(ON DELETE CASCADE 없음. 휴지통이 옮겨 적을 수 있게).
-- - 날짜 칸(due_on)은 YYYY-MM-DD 글자이고 형식 검사는 서버 입력 검사에서 한다.
-- - next_task_id: 반복 할 일을 끝낼 때 같은 batch에서 만든 다음 줄의 id(다시 열면 "다음 할 일은 따로 남아 있습니다"를 보이려고).
--   REFERENCES를 두지 않는다(다음 줄을 지우거나 같은 거래 삭제 batch에서 함께 지워도 막히지 않게). 다시 열어도 그대로 두므로
--   done_at과 묶는 CHECK도 두지 않는다. 가리키는 줄이 없으면 서버가 '다음 줄 없음'으로 본다.

CREATE TABLE tasks (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  deal_id     TEXT REFERENCES deals(id),
  due_on      TEXT,
  repeat_rule TEXT NOT NULL DEFAULT 'none' CHECK (repeat_rule IN ('none','weekly','monthly')),
  repeat_day  INTEGER CHECK (repeat_day IS NULL OR repeat_day BETWEEN 1 AND 31),
  done_at     TEXT,
  next_task_id TEXT,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  CHECK (repeat_rule = 'none' OR due_on IS NOT NULL),            -- 반복에는 날짜가 있어야 함
  CHECK ((repeat_rule = 'monthly') = (repeat_day IS NOT NULL)),  -- 매월만 기준일을 가짐
  CHECK (done_at IS NULL OR repeat_rule = 'none')                -- 끝낸 줄은 반복이 없음(다음 줄을 두 번 만들지 않게)
);
CREATE INDEX idx_tasks_open_due ON tasks(due_on) WHERE done_at IS NULL;
CREATE INDEX idx_tasks_deal ON tasks(deal_id);

UPDATE settings SET value_json = '6', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
