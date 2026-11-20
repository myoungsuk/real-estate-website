-- 업무 도구 단계 P3 AI 블로그 글 초안(설계서 22.11절, 구조 번호 4).
-- 공개 매물·단지 1건으로 만든 글 초안만 둔다. 손님 자료는 넣지 않는다.
-- - disclosure_json: 명시사항 화면 입력값(공개 자료로 채운 값 제외). 소재지(지번·동)는 넣지 않는다(운영자 결정 2026-11-20 "매번 직접 입력, 저장 안 함").
--   그래서 초안을 다시 열면 소재지를 다시 넣어야 복사가 풀린다. 모양: { inputs, emphasisNumbers }.
--   글 성격과 강조점 글은 넣지 않는다(이번 요청에만 씀). 강조점에 나온 금액·면적·층·날짜 표기만 emphasisNumbers(200자 이하)로 남겨
--   다시 열었을 때 숫자 대조가 강조점의 숫자를 막지 않게 한다.
-- - usage_day·reserved_cost_micro_usd: 만들기 전에 ai_usage_daily에 미리 더한 날(한국 날짜)과 최대 예상 비용. 결과를 받으면 실제 값으로 한 번만 바로잡는다.
-- - 보관(DEC-WT-24): 다 씀·취소 뒤 30일에 지우고, 닫지 않은 초안은 만든 지 30일에 closed='auto'로 닫고 다시 30일 뒤 지운다(Cron 03:00 차례).
-- 한도 행(ai_daily_create_limit·ai_monthly_cost_limit_micro_usd)은 넣지 않는다. 화면 한도 칸에서 저장하기 전까지 만들기는 막힌다(fail closed, DEC-WT-35).
CREATE TABLE blog_drafts (
  id                       TEXT PRIMARY KEY,
  source_type              TEXT NOT NULL CHECK (source_type IN ('naver_listing','listing','complex')),
  source_id                TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 80),
  source_title             TEXT NOT NULL CHECK (length(source_title) BETWEEN 1 AND 120),
  status                   TEXT NOT NULL CHECK (status IN ('queued','in_progress','completed','failed','expired','unknown')),
  closed                   TEXT CHECK (closed IS NULL OR closed IN ('confirmed','cancelled','auto')),
  openai_response_id       TEXT CHECK (openai_response_id IS NULL OR length(openai_response_id) BETWEEN 1 AND 200),
  model                    TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 64),
  reasoning_effort         TEXT NOT NULL CHECK (length(reasoning_effort) BETWEEN 1 AND 16),
  disclosure_json          TEXT NOT NULL CHECK (json_valid(disclosure_json) AND length(disclosure_json) <= 4000),
  result_json              TEXT CHECK (result_json IS NULL OR (json_valid(result_json) AND length(result_json) <= 60000)),
  check_json               TEXT CHECK (check_json IS NULL OR (json_valid(check_json) AND length(check_json) <= 8000)),
  error_code               TEXT CHECK (error_code IS NULL OR length(error_code) <= 40),
  usage_day                TEXT NOT NULL CHECK (length(usage_day) = 10),
  reserved_cost_micro_usd  INTEGER NOT NULL CHECK (reserved_cost_micro_usd >= 0),
  actual_cost_micro_usd    INTEGER CHECK (actual_cost_micro_usd IS NULL OR actual_cost_micro_usd >= 0),
  input_tokens             INTEGER,
  output_tokens            INTEGER,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  closed_at                TEXT
);
CREATE INDEX idx_blog_drafts_created ON blog_drafts(created_at DESC);
INSERT INTO settings (key, value_json, updated_at) VALUES ('ai_limits_version', '0', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
UPDATE settings SET value_json = '4', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
