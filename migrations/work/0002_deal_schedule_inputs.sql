-- 업무 도구 D1 구조 2번: 거래 일정 계산 입력 칸(설계서 6.7·8.2절, 2026-11-17 사용자 승인 17:42:16).
-- 0001은 2026-11-17 원격 D1에 적용됐으므로 고치지 않고, 단계 0 일정 계산 함수(buildContractSchedule)가 쓰는 입력 중
-- 0001 deals에 없는 칸을 여기서 더한다. 원격 D1 적용은 PR 병합과 따로 사용자 승인을 받고 백업 뒤에 한다.
-- 다른 칸을 함께 보는 CHECK는 ADD COLUMN 때 기존 행에도 검사된다(어긋난 행이 있으면 이 마이그레이션이 실패한다).

-- 매매 세부 종류: 일반 매매(sale)·분양 공급계약(supply)·분양권·입주권 매매(status_sale). 매매 거래에만 둔다(NULL이면 일반 매매).
ALTER TABLE deals ADD COLUMN sale_kind TEXT
  CHECK (sale_kind IS NULL OR (deal_type = 'sale' AND sale_kind IN ('sale','supply','status_sale')));

-- 규제지역 3단계. 0001의 regulated_area(0/1)와 어긋나지 않게 묶는다(비규제 = 0, 조정·투기과열 = 1).
ALTER TABLE deals ADD COLUMN regulation TEXT NOT NULL DEFAULT 'none'
  CHECK (regulation IN ('none','adjusted','overheated')
    AND regulated_area = CASE WHEN regulation = 'none' THEN 0 ELSE 1 END);

-- 오피스텔 거래만: 일정 판정(임대차 신고·자금조달)을 주택으로 볼지 그 밖의 건축물로 볼지 거래마다 고른다.
-- 주거용 오피스텔의 신고 대상 여부는 법률 해석이 필요해 사용자가 고른다(추가 확인 필요). 다른 물건 종류는 NULL(물건 종류를 그대로 따름).
ALTER TABLE deals ADD COLUMN schedule_target TEXT
  CHECK (schedule_target IS NULL OR (property_kind = 'officetel' AND schedule_target IN ('housing','other')));

-- 토지 지분 매수(토지 자금조달 판정).
ALTER TABLE deals ADD COLUMN land_share INTEGER NOT NULL DEFAULT 0 CHECK (land_share IN (0,1));

-- 자금조달계획서 등을 거래계약 신고서와 나누어 따로 제출(시행규칙 제2조⑨).
ALTER TABLE deals ADD COLUMN separate_funding_submission INTEGER NOT NULL DEFAULT 0 CHECK (separate_funding_submission IN (0,1));

-- 주택 임대차 신고 대상 지역(대전 동구 자치구는 대상이라 기본 1).
ALTER TABLE deals ADD COLUMN lease_reporting_region INTEGER NOT NULL DEFAULT 1 CHECK (lease_reporting_region IN (0,1));

-- 보증금·차임 변동 없이 기간만 늘리는 갱신(임대차 신고 제외).
ALTER TABLE deals ADD COLUMN lease_renewal_without_change INTEGER NOT NULL DEFAULT 0 CHECK (lease_renewal_without_change IN (0,1));

UPDATE settings SET value_json = '2', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE key = 'schema_version';
