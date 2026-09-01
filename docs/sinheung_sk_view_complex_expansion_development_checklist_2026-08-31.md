# 신흥 SK뷰 단지·상담 영역 확장 개발 체크리스트

| 항목 | 내용 |
|---|---|
| 문서 ID | HRE-SKV-TRACK-001 |
| 버전 | v1.5 Production 공개·검색 알림 검증 기록 |
| 작성 기준일 | 2026-09-01 |
| 대상 저장소 | `myoungsuk/real-estate-website` |
| 기준 브랜치 | `origin/master` 확인 후 별도 작업 브랜치 또는 격리 worktree 사용 |
| 공개 기능 커밋 | `e4685c72123473b892398346c3215f3a19586bfd` |
| 연계 설계 | `docs/sinheung_sk_view_complex_expansion_design_2026-08-31.md` |
| 현재 판정 | 공식 기본정보·면적 합계·운영자 직접 촬영 사진·공개 문구를 승인해 `published` 전환, 로컬·CI·Production·검색 알림 Gate 통과, 실기기 제외 승인 |
| 출시 원칙 | 공식 근거·사진 권리·운영자 승인·자동 회귀·Production 스모크를 모두 통과한 뒤 공개 |

> 체크박스는 코드가 존재한다는 이유만으로 완료하지 않는다. `로컬 구현`, `자동 테스트`, `운영자 검수`, `Production 반영`, `검색 수집`은 서로 다른 상태다.

---

## 0. 상태 표기

| 상태 | 의미 |
|---|---|
| `[ ] 미착수` | 아직 작업하지 않음 |
| `[~] 진행 중` | 일부 구현 또는 자료 확인 중 |
| `[x] 완료` | 증거와 완료 조건까지 충족 |
| `[!] 차단` | 필수 근거·승인·외부 조건 때문에 다음 단계 진행 불가 |
| `[-] 제외` | 이번 범위에서 의도적으로 제외, 사유 기록 |
| `[R] 회귀` | 이전 정상 기능이 깨져 수정 필요 |

실제 Markdown 체크박스는 `[ ]`, `[x]`를 사용하고 상태 설명은 항목 끝에 붙인다.

---

# 1. 한눈에 보는 Gate

| Gate | 현재 | 통과 조건 | 차단 시 처리 |
|---|---|---|---|
| G0 기준선 | 완료 | `origin/master` SHA·격리 작업 경로·기존 dirty 변경·기존 테스트 기록 | 구현 시작 금지 |
| G1 공개 문구 | 완료 | 설계 문구 코드 반영, 운영자 최종 화면 승인 | preparing 유지 |
| G2 공식 수치 | 완료 | K-apt 단지코드·주소·면적 구간·난방·주차·승강기와 지자체 세대·공급 원문 확인 | 미확정 숫자 미노출 |
| G3 사진 권리 | 완료 | 운영자 직접 촬영·공개 승인 사진 | published 금지 |
| G4 스키마 | 완료 | 타입·관리자·Worker·validator 동기화 | 저장·빌드 금지 |
| G5 회귀 | 완료 | unit·check·Production-mode build·공개 상태 E2E·Lighthouse PASS | PR 병합 금지 |
| G6 화면 | 완료 | 360·390·430·768·1280px 자동 검사, 200% 확대 동등 조건·키보드·포커스 브라우저 검수 PASS, 실기기 제외 승인 | 공개 금지 |
| G7 배포 | 완료 | Production marker·공개 HTML·이미지·상담 링크 스모크 PASS | 이전 릴리스 유지 |
| G8 검색 | 완료 | Production sitemap·robots 공개, search marker·공개키 확인, IndexNow 알림 성공 | 실제 색인·노출 모니터링 |

---

## 1.1 2026-09-01 로컬 구현 기록

- [x] 기준 SHA `8a03d0e3ca461da35136a80279de00d1c4d0768c`, `origin/master` 일치와 기존 dirty 변경 분리 확인
- [x] `featuredComplexSlugs`와 `comparisonComplexSlugs` 분리, 리더스시티 4·5블록 비교 범위·3,463세대 검증 유지
- [x] `aliases`, 데이터 기반 `seo`, `unitDataNote`를 타입·strict schema·기존 4·5 데이터·관리자 round-trip에 동시 반영
- [x] NFKC·영문 대소문자·공백·구분기호 정규화, 긴 접두어 우선·동률 충돌 회피 매칭 구현
- [x] 홈·사무소 문구, 단지 목록, 상세 SEO·단위 안내·현재 공개 매물, 매물 필터 연결 일반화
- [x] 관리자 주요 단지·비교 대상 동적 파서와 변경 검토 영향 화면 갱신
- [x] 신흥 SK뷰를 `preparing`으로 등록하고 상세 HTML·sitemap·매물 필터에서 제외
- [x] 공식 지번·12개동·1,588세대·사용승인일·분양 1,499/임대 89와 K-apt·동구청·대전광역시 출처·확인일 반영
- [x] K-apt 단지코드 A10023828에서 도로명주소·면적 구간 897/691세대·개별난방·지하주차 1,957대·승강기 34대·등록 시설 반영
- [x] 안전한 생활환경·현장 체크·FAQ 초안과 실제 신흥SK뷰 매물 2건 매칭, 0건·최근 3건 미리보기 테스트 반영
- [x] 공개 SEO 70/180자 상한, 준비 문구, 공식 사실·수량·출처, 대표 사진 원본·640·1200 파생본 Gate 반영
- [x] 로컬 단위 테스트 207건, Astro·TypeScript·콘텐츠 검증, 기본·Production-mode 빌드 assertion, 공개 상태 E2E 8건 통과
- [x] 홈·단지 목록·상세·신흥 SK뷰 필터의 360·390·430·768·1280px 가로 넘침과 공개 링크·매물 연결 자동 검증
- [x] 공개 상태 Lighthouse 최종 측정: 홈 98·LCP 2,177ms, 매물 96·2,327ms, 단지 목록 99·2,102ms, 신흥 상세 99·1,802ms, 신흥 필터 96·2,326ms, 전 경로 접근성·Best Practices·SEO 100
- [x] 2026-09-01 공식값·승인 사진·문구를 반영해 `published` 전환 후 공개 Gate와 로컬 자동 회귀 재통과
- [x] 브라우저 검수에서 홈의 남은 준비 문구와 `확인 중` 표 값을 발견해 공식 사용승인일·면적 구간으로 수정하고 E2E 회귀 추가
- [x] 652px 유효 폭의 200% 확대 동등 조건에서 다섯 경로 문서 가로 넘침 0, 키보드 포커스·건너뛰기 링크·축소 메뉴 이동 확인
- [x] 대표 사진·대체 텍스트·반응형 파생본
- [x] 면적별 전체 세대수 1,588세대 합계 공식 원문 확정
- [x] K-apt 등록 시설 상태·현장 재확인 문구와 화면 문구·FAQ 운영자 승인
- [x] `published` 전환 후 신흥 SK뷰 상세·필터 E2E와 Lighthouse 검증
- [x] 200% 확대 동등 조건과 키보드·포커스 브라우저 검증
- [x] 실제 Android·iPhone 검수를 이번 공개 완료 조건에서 제외 — 운영자 승인, 2026-09-01
- [x] Production marker·공개 스모크·sitemap·robots·IndexNow 알림 검증

---

# 2. Phase 0: 작업 기준선과 범위 고정

## SKV-P0-01 저장소 확인

- [x] `git remote -v`가 `myoungsuk/real-estate-website`를 가리키는지 확인
- [x] `origin/master`가 기준 커밋 또는 승인된 최신 커밋을 가리키는지 확인
- [x] 오래된 로컬 `master`로 전환하지 않고 작업 시작 기준 SHA 기록
- [x] 기준 SHA에서 별도 작업 브랜치 또는 격리 worktree 생성
- [x] `git status --short`로 기존 dirty 변경과 이번 문서 두 파일을 구분해 기록
- [x] 기존 dirty 변경은 임의 commit·stash·삭제하지 않고 별도 작업 범위로 보존
- [x] Node.js가 22.12 이상인지 확인
- [ ] `npm ci` 또는 기존 승인 방식으로 의존성 복원
- [x] `package-lock.json`이 임의 갱신되지 않았는지 확인

### 증거

```text
Branch:
Base ref:
Commit:
Worktree:
Existing dirty paths:
Node:
npm:
확인자:
확인일:
```

## SKV-P0-02 기준 문서 읽기

- [x] `CODEX.md`
- [x] `docs/01_천동_리더스시티_행복한부동산_서비스기획서.md`
- [x] `docs/02_천동_리더스시티_행복한부동산_시스템설계서.md`
- [x] `docs/03_천동_리더스시티_행복한부동산_개발진행체크리스트.md`
- [x] `docs/leaderscity_complex_content_research_2026-08-25.md`
- [x] 관리자시스템 설계서
- [x] 관리자시스템 개발 체크리스트
- [x] `docs/operations/CONTENT_GUIDE.md`
- [x] `README.md`
- [x] 본 신흥 SK뷰 설계서

## SKV-P0-03 기존 회귀 기준선

- [ ] `npm test`
- [ ] `npm run check`
- [ ] `npm run build`
- [ ] 기존 `dist/complexes/leaders-city-4/index.html` 존재 확인
- [ ] 기존 `dist/complexes/leaders-city-5/index.html` 존재 확인
- [ ] 홈 빠른 탐색과 4·5블록 비교 화면 캡처
- [ ] `/properties/` 단지 필터 현재 옵션 캡처
- [ ] 실패·skip·경고 건수 기록

### 완료 기준

- 작업 전 실패가 새 변경 때문인지 구분할 수 있는 기준선이 남아 있다.
- 기준선 실패가 있으면 원인과 처리 방침을 먼저 기록한다.

---

# 3. Phase 1: 공개 문구·사실·사진 승인

## SKV-P1-01 상담 범위 승인

- [x] 운영자에게 `신흥 SK뷰도 실제 상담하는가` 확인
- [x] 거래 범위가 매매·전세·월세 모두인지 확인
- [x] `주요 상담 단지` 표현 승인
- [x] `전문` 표현은 이번 릴리스에서 사용하지 않는 것 승인
- [x] 홈 Hero 문구 승인
- [x] 사무소 소개 문구 승인
- [x] 신흥 SK뷰 상세 CTA 문구 승인
- [x] 승인자·승인일·승인 문구를 문서에 기록 — 운영자, 2026-09-01

## SKV-P1-02 공식 자료 확보

- [x] K-apt 직접 단지정보 조회 — 2026-08-31 공식 공개 목록 확인
- [x] 단지 식별 코드 기록 — A10023828
- [x] 도로명주소 확인 — 대전광역시 동구 충무로 255
- [x] 지번주소 유지 — 정비사업 원문과 단지 식별 대조용
- [x] 총 세대수 1,588세대 확인 — K-apt·대전 동구청 일치
- [x] 동수 12개동 확인 — K-apt·대전 동구청 일치
- [x] 최고·최저 층수는 이번 공개 범위에서 제외 — K-apt 직접 화면에서 검증한 값만 반영
- [x] 사용승인일 2022-04-28 확인 — K-apt
- [x] 난방 방식 확인 — 개별난방
- [x] 면적별 전체 세대 구성 확인 — 60㎡ 이하 897세대, 60㎡ 초과~85㎡ 이하 691세대
- [x] 분양 1,499·임대 89 확인 — 대전광역시 2022년 주택입주 계획
- [x] 주차대수 공식값 확인 — K-apt 지상 0대·지하 1,957대
- [ ] 시공·시행·사업명 표시 필요 여부 결정
- [x] 현재 확인된 세대·동·사용승인·공급 원문 URL·문서명·확인일 기록
- [ ] 웹 화면만 있는 자료는 PDF·캡처 등 검수 증거 보존
- [x] 검색 결과 요약문이 아닌 K-apt·지자체 원문까지 열어 확인

2026-08-31~2026-09-01 공식 원문 확인 기록:

- [K-apt 공동주택관리정보시스템 단지 공개 목록](https://www.k-apt.go.kr/cmmn/introMmentPop.do?bjdCode=30&searchOccuDate=202408&upYn=Y): 신흥SK뷰아파트, 신흥동 161-33, 12개동, 1,588세대, 사용승인일 2022-04-28
- [K-apt 공동주택관리정보시스템 단지 기본정보](https://www.k-apt.go.kr/kaptinfo/openkaptinfo.do): 단지코드 A10023828 선택 후 충무로 255, 개별난방, 60㎡ 이하 897세대, 60㎡ 초과~85㎡ 이하 691세대 확인
- [K-apt 공동주택관리정보시스템 관리시설정보](https://www.k-apt.go.kr/kaptinfo/openKaptMng.do): 단지코드 A10023828 선택 후 지상 0대·지하 1,957대, 승강기 34대와 등록 시설 목록 확인
- [대전 동구청 재개발정비사업 추진현황](https://donggu.go.kr/dg/kor/contents/150): 신흥3구역, 신흥동 161-33 일원, 12개동 1,588세대, 2022년 4월 준공·입주
- [대전광역시 2022년 주택입주 계획](https://www.daejeon.go.kr/drh/drhStoryDaejeonView.do?boardId=blog_0001&categorySeq=293&menuSeq=7713&ntatcSeq=1393288021&pageIndex=1): 분양 1,499세대, 임대 89세대, 합계 1,588세대
- G2 공개 필수값은 확인 완료했습니다. 최고·최저 층수는 이번 범위에서 미표시하고, K-apt 등록 시설은 현재 실제 운영을 단정하지 않는 재확인 문구로 공개합니다. 사진 권리와 공개 문구는 2026-09-01 운영자가 승인했습니다.

## SKV-P1-03 충돌 값 처리

- [x] 주차 1,957 / 1,966 후보 충돌 기록 — 2026-09-01 K-apt 관리시설정보의 지상 0대·지하 1,957대를 채택하고 근거가 불명확한 1,966대는 미사용
- [x] 일반분양 수량과 전체 세대 수량 구분
- [x] 입주월과 사용승인일 구분
- [x] 공급면적과 전용면적 구분
- [x] 과거 계획 시설과 현재 운영 시설 구분
- [ ] 학교 인접과 실제 배정학교 구분
- [ ] 개관 예정 공공시설의 일정 변경 가능성 표시
- [ ] 해결되지 않은 값은 `불확실한 사실` 표에 남김
- [ ] 미해결 값이 facts·SEO·JSON-LD에 들어가지 않았는지 확인

## SKV-P1-04 사진

- [x] 운영자 촬영 사진 확보
- [x] 사진 사용권 확인
- [x] 다른 중개사·블로그·검색 이미지가 아닌지 확인 — 운영자 직접 촬영
- [x] 촬영 위치의 공개 가능 여부 확인 — 운영자 공개 승인
- [x] 사람·차량번호·호수·연락처 등 민감 요소 확인
- [x] EXIF 제거
- [x] 원본 보존 정책 확인 — 원본 JPG는 로컬 보존·Git 제외, 공개 최적화본만 저장
- [x] WebP 변환
- [x] 공개 원본 2,000×2,000px 정사각형 crop 확인
- [x] 상세용·카드용 반응형 파생 이미지 생성
- [x] 첫 공개 대표 사진을 `public/images/area/sinheung-sk-view.webp`와 `-640.webp`·`-1200.webp`로 등록
- [x] `node scripts/prepare-complex-image.mjs --input <원본> --slug sinheung-sk-view`로 메타데이터를 제거한 2,000·640·1,200px 정사각형 WebP를 생성하고 기존 파일은 덮어쓰지 않도록 구현
- [x] `src/lib/responsive-images.ts`에 신규 경로 등록, 신규 준비 도구가 원본·640·1200px 파일 생성
- [x] 관리자 단일 WebP 업로드 경로와 첫 공개 반응형 대표 사진 경로를 혼동하지 않음
- [x] alt 문구 승인
- [x] 생성된 공개 이미지에서 과도한 crop 없음

### Phase 1 완료 기준

- 문구 승인, 1차 근거, 대표 사진을 확보했다.
- 공식 면적별 세대 수량이 없으면 `published`로 전환하지 않는다.

---

# 4. Phase 2: 핵심 문서 동기화

## SKV-P2-01 설계·서비스 범위

- [x] 본 설계서를 `docs/`에 추가
- [x] 본 체크리스트를 `docs/`에 추가
- [x] 서비스기획서에 주요 상담 단지 확장 반영
- [x] 시스템설계서에 신규 필드·흐름 반영
- [x] 총괄 개발 체크리스트의 단지 단계 갱신
- [x] 관리자시스템 설계서에 신규 편집 필드 반영
- [x] 관리자시스템 체크리스트에 신규 검증 항목 반영
- [x] `CONTENT_GUIDE.md`에 단지 추가 절차 반영
- [x] `CODEX.md`에 featured·comparison 범위 분리 규칙 반영
- [x] `README.md` 갱신 필요 여부 검토
- [x] 문서 전체에서 `4·5블록만 전체 영업 범위`로 읽히는 문구 검색
- [x] 폐기된 필드·하드코딩 설명 제거

## SKV-P2-02 결정 기록

- [x] `featuredComplexSlugs` 도입 근거 기록
- [x] `comparisonComplexSlugs` 도입 근거 기록
- [x] arbitrary comparison group은 이번 범위에서 제외한 이유 기록
- [x] alias 정규화 규칙 기록
- [x] SEO 데이터화 결정 기록
- [x] `preparing` 우선 등록 정책 기록

### 완료 기준

- 코드 변경 전에 문서상 데이터 계약과 공개 Gate가 서로 충돌하지 않는다.

---

# 5. Phase 3: 스키마와 타입

## SKV-P3-01 `ComplexContent`

- [x] `aliases: string[]` 추가
- [x] `seo.title` 추가
- [x] `seo.description` 추가
- [x] `unitDataNote: string | null` 추가
- [x] 기존 리더스시티 4블록에 새 필드 입력
- [x] 기존 리더스시티 5블록에 새 필드 입력
- [x] `aliases`·`seo`·`unitDataNote`는 모든 상태에서 JSON에 항상 명시
- [x] TypeScript 타입에서 세 필드의 `undefined`를 허용하지 않음
- [x] preparing SEO는 초안 허용, published SEO는 비어 있지 않은 최종 문구 필수
- [x] 공개 상태에서 SEO가 필수라는 계약 반영
- [x] unitDataNote가 없을 때 렌더링하지 않는 계약 반영
- [x] 타입·strict schema·기존 4·5 데이터·관리자 파서·round-trip 테스트를 같은 원자적 변경으로 반영

## SKV-P3-02 `ComplexOverview`

- [x] `featuredComplexSlugs` 추가
- [x] `comparisonComplexSlugs` 추가
- [x] 초기 featured 순서 4블록, 5블록, 신흥 SK뷰 정의
- [x] 초기 comparison 순서 4블록, 5블록 정의
- [x] `stats`와 `reasons`는 리더스시티 집중 섹션임을 문서화
- [x] `comparisonRows` 구조는 유지
- [x] renderer가 comparison slug만 열로 사용하는 계약 반영

## SKV-P3-03 데이터 접근 함수

- [x] `getComplexBySlug()`
- [x] `getOrderedComplexes()`
- [x] 누락 slug 처리 정책
- [x] 중복 slug 입력 방어
- [x] `featuredComplexes` 파생 컬렉션
- [x] `comparisonComplexes` 파생 컬렉션
- [x] published 필터 적용 순서 검증
- [x] preparing slug가 featured 목록에 있어도 공개하지 않도록 확인

### 완료 기준

- TypeScript에서 새 스키마를 타입 안전하게 읽는다.
- 기존 두 단지 데이터가 새 타입으로 정상 컴파일된다.

---

# 6. Phase 4: 단지명 정규화·매물 연결

## SKV-P4-01 정규화 함수

- [x] Unicode NFKC 적용
- [x] trim
- [x] 영문 소문자화
- [x] 공백 제거
- [x] `-`, `.`, `·` 등 승인 구분기호 제거
- [x] 한글·영문·숫자 외 문자의 처리 결정
- [x] 빈 문자열 입력 방어
- [x] 너무 짧은 alias 거부 기준 결정

## SKV-P4-02 후보 생성

- [x] canonical `name` 포함
- [x] `aliases` 포함
- [x] 정규화 중복 제거
- [x] 긴 후보 우선 정렬
- [x] 동일 길이 안정 정렬
- [x] 결과가 빈 후보가 되지 않도록 검증

## SKV-P4-03 매칭 함수

- [x] 매물 제목 정규화
- [x] 후보 접두어 매칭
- [x] `includes`를 사용하지 않음
- [x] 복수 단지 충돌 시 매칭하지 않음
- [x] unmatched는 일반 매물로 유지
- [x] 함수가 상태를 갖지 않음
- [x] 함수 입력에 published 단지만 사용

## SKV-P4-04 적용

- [x] `/properties/index.astro` 로컬 `getComplexSlug` 제거
- [x] 공용 matcher 사용
- [x] 신흥SK뷰 공백 없는 제목 매칭
- [x] 리더스시티 기존 매칭 회귀 확인
- [x] 상세 페이지 현재 매물 필터에 같은 matcher 사용
- [x] 문의·비교 기능에 기존 공개 ID만 사용
- [x] 외부 동기화 스크립트는 임의 slug를 저장하지 않음

## SKV-P4-05 단위 테스트

- [x] `신흥 SK뷰` vs `신흥SK뷰`
- [x] ASCII 대소문자
- [x] 하이픈
- [x] canonical
- [x] alias
- [x] 긴 후보 우선
- [x] 충돌
- [x] unmatched
- [x] 빈 제목
- [x] 준비 중 단지 제외

### 완료 기준

- 현재 `naver-listings.json`의 신흥SK뷰 매물이 `sinheung-sk-view`로 연결된다.
- 잘못된 다른 단지 매칭 0건이다.

---

# 7. Phase 5: 콘텐츠 검증기

## SKV-P5-01 strict schema

- [x] `publicContentSchemas.complexes.aliases`
- [x] `publicContentSchemas.complexes.seo`
- [x] `publicContentSchemas.complexes.unitDataNote`
- [x] `publicContentSchemas.complexOverview.featuredComplexSlugs`
- [x] `publicContentSchemas.complexOverview.comparisonComplexSlugs`
- [x] Worker가 사용하는 허용 리소스 스키마 동기화
- [x] 관리자 사전 검증과 로컬 검증이 같은 결과를 내는지 확인

## SKV-P5-02 alias 검증

- [x] 배열 여부
- [x] 문자열 여부
- [x] 빈 값 금지
- [x] canonical과 정규화 중복 금지
- [x] 동일 단지 내 중복 금지
- [x] 공개 단지 간 충돌 금지
- [x] 금지·민감 문자열 검사 적용

## SKV-P5-03 SEO·단위 주의

- [x] published SEO title 필수
- [x] published SEO description 필수
- [x] title 권장 길이 경고 또는 테스트
- [x] description 권장 길이 경고 또는 테스트
- [x] unitDataNote null 허용
- [x] 빈 문자열 unitDataNote 금지
- [x] 소개와 SEO에 가격·현재 매물 수 고정값이 없는지 검토

## SKV-P5-04 featured·comparison

- [x] featured 배열 필수
- [x] featured slug 중복 금지
- [x] 등록되지 않은 slug 금지
- [x] comparison 2개 이상
- [x] comparison slug 중복 금지
- [x] comparison slug 등록·공개 상태 확인
- [x] 각 row가 comparison slug 전체 값을 가짐
- [x] row에 비교 대상이 아닌 slug가 있을 때 처리
- [x] featured 순서 보존
- [x] 리더스시티 3,463 합계 검증 유지
- [x] 신흥 SK뷰 때문에 기존 통계 카드 검증이 깨지지 않음

## SKV-P5-05 신흥 SK뷰 합계

- [x] 공식 전체 세대수 상수 또는 데이터 근거 결정
- [x] `unitGroups` 합계 검증
- [x] 공급 구분 합계 검증
- [x] 일반분양 수량을 전체 세대 수량으로 잘못 사용하지 않음
- [x] 공식 수량이 미확정이면 published 거부
- [x] K-apt 공식 주차대수 지상 0대·지하 1,957대와 출처 누락을 자동 검증

## SKV-P5-06 테스트

- [x] 정상 3단지 fixture PASS — 승인 사진 경로를 가정한 공개 후보 콘텐츠 Gate 통과
- [x] featured 누락 FAIL
- [x] comparison 누락 FAIL
- [x] 비교값 누락 FAIL
- [x] alias 충돌 FAIL
- [x] SEO 누락 FAIL
- [x] 신흥 SK뷰 합계 불일치 FAIL
- [x] preparing 불완전 데이터 PASS
- [x] published 사진 누락 FAIL
- [x] published 출처 누락 FAIL
- [x] 개인정보 패턴 FAIL
- [x] 기존 리더스시티 합계 회귀 PASS

### 완료 기준

- 잘못된 세 번째 단지 추가가 빌드 전에 차단된다.
- 기존 관리자 저장과 CI가 같은 오류를 보여준다.

---

# 8. Phase 6: 신흥 SK뷰 데이터 작성

## SKV-P6-01 준비 상태 등록

- [x] slug `sinheung-sk-view`
- [x] areaSlug `sinheung-dong`
- [x] areaName `신흥동`
- [x] display name `신흥 SK뷰`
- [x] aliases 입력
- [x] SEO 초안
- [x] summary
- [x] introTitle
- [x] introduction
- [x] `status: preparing`
- [x] image null 또는 승인 이미지
- [x] confirmedAt null 또는 공식 자료 최종 확인일
- [x] sources 빈 배열 또는 확인한 공식 자료
- [x] 빌드·관리자 목록에서 준비 중으로 확인
- [x] 공개 페이지·sitemap에는 없음

## SKV-P6-02 공식 자료 입력

- [x] 주소
- [x] 지번 필요 시 입력
- [x] 규모
- [x] 공급 구성
- [x] 전용면적 구간
- [x] 사용승인·입주
- [x] 동수
- [x] 층수는 검증값 미확보로 미표시
- [x] 난방
- [ ] 시행·시공 표시 여부
- [x] 각 fact의 출처와 문구 일치
- [x] 과도한 숫자 나열 방지

## SKV-P6-03 면적·공급

- [x] 공식 표의 각 행 전사
- [x] category 이름 통일
- [x] areaLabel 통일
- [x] households 양의 정수
- [x] 합계 계산 — 897 + 691 = 1,588
- [x] supplySummary 작성
- [x] unitDataNote 작성
- [x] 분양·임대·조합원·일반분양 용어 혼동 없음

## SKV-P6-04 생활환경

- [x] 교통
- [x] 교육
- [x] 생활편의
- [x] 자연·산책
- [x] 고정 도보 분 수를 쓰지 않음
- [x] 배정학교 단정 금지
- [ ] 예정 시설에 예정 시점·확인일 표시
- [x] 현재 영업 여부가 바뀔 수 있는 시설은 현장 확인 문구

## SKV-P6-05 시설

- [x] 시설 목록 원문 확보 — K-apt 관리시설정보
- [ ] 현재 운영 여부 확인
- [x] verification 상태 지정 — `official`, 현재 운영 여부는 별도 확인 문구 유지
- [x] historical-plan을 현재 운영으로 표현하지 않음
- [x] 이용료·시간·예약 조건은 확인 전 미노출

## SKV-P6-06 현장 체크포인트

- [x] 타입별 구조
- [x] 동·층·방향
- [x] 일조·조망
- [x] 도로·철도·생활 소음
- [x] 주차·출입구·택배·재활용 동선
- [x] 창호·결로·배수·마감
- [x] 등기·근저당·잔금
- [x] 실거래가와 호가 구분
- [x] 매물별 옵션·입주시기

## SKV-P6-07 FAQ

- [x] 같은 면적의 타입 차이
- [x] 현재 매물 확인 방법
- [x] 관리비 확인 방법
- [x] 학교·통학구역 확인
- [x] 현재 시세를 고정하지 않는 이유
- [x] K-apt 확인일·지상·지하·합계와 현장 재확인 조건 안내
- [x] 계약 전 최신 서류 우선 안내

## SKV-P6-08 관련 콘텐츠

- [ ] 공식 블로그의 신흥 SK뷰 글 검색
- [ ] 공식 유튜브의 신흥 SK뷰 영상 검색
- [ ] 사용할 콘텐츠가 `published`
- [ ] 게시일 존재
- [ ] 썸네일 권리·대체 텍스트
- [x] 없으면 빈 배열 허용
- [x] 다른 중개사 콘텐츠 연결 금지

## SKV-P6-09 공개 전환

- [x] 대표 사진 완료
- [x] sources 1개 이상
- [x] confirmedAt
- [x] 모든 필수 배열
- [x] 합계 검증
- [x] 문구 승인
- [x] 로컬 preview
- [x] `status: published`
- [x] featured 목록 포함
- [x] comparison 목록에는 넣지 않음

### 완료 기준

- 신흥 SK뷰 데이터가 검증을 통과하며, 불확실한 값은 공개되지 않는다.

---

# 9. Phase 7: 홈과 사무소 소개

## SKV-P7-01 홈 데이터

- [x] broker eyebrow 변경
- [x] broker headline 변경
- [x] broker lead 변경
- [x] office description 변경
- [x] badge에 주요 단지 상담 추가 여부
- [x] areaGuide title을 천동·신흥 주요 단지로 확장
- [x] areaGuide description 확장
- [x] 카드 중 하나에 신흥 SK뷰 안내 추가
- [x] 기존 리더스시티 3,463세대 정보 보존

## SKV-P7-02 홈 코드

- [x] hardcoded `quickComplexes` 제거
- [x] `featuredComplexes` import
- [x] 빠른 탐색 label `주요 단지`
- [ ] 세 단지 링크 순서
- [x] 홈 단지 표도 featured 범위 사용
- [x] 표 heading 일반화
- [x] 표 aria-label 일반화
- [x] SEO title
- [x] SEO description
- [x] OG alt 문구 검토
- [x] JSON-LD 법적 정보 불변

## SKV-P7-03 사무소 데이터·코드

- [x] `office.introduction[0]` 변경
- [x] office SEO title
- [x] office SEO description
- [x] Hero eyebrow
- [x] Hero headline
- [x] Hero body
- [x] facts에 주요 상담 단지
- [x] 신뢰 카드 추가 또는 교체
- [x] activity card 문구 일반화
- [x] 위치는 여전히 5블록 단지 내로 정확히 표시
- [x] `신흥 SK뷰 단지 내 사무소`로 오해할 문구 없음

## SKV-P7-04 반응형

- [x] 빠른 탐색 3개 링크 360px
- [x] 카드 3개 390px
- [x] tablet
- [x] desktop
- [x] 200% 확대 동등 조건
- [x] 긴 한글 단지명 줄바꿈
- [x] CTA와 겹침 없음

### 완료 기준

- 처음 방문한 사람이 홈과 사무소 소개에서 신흥 SK뷰 상담 범위를 명확히 이해한다.
- 법적 상호·주소·연락처는 기존 값과 동일하다.

---

# 10. Phase 8: 단지 목록·상세 UI

## SKV-P8-01 `/complexes/` Hero

- [x] generic eyebrow
- [x] 천동·신흥 주요 단지 title
- [x] description
- [x] note
- [x] title metadata
- [x] description metadata
- [x] breadcrumb 유지

## SKV-P8-02 주요 단지 카드

- [x] `featuredComplexes` 사용
- [x] 4블록
- [x] 5블록
- [ ] 신흥 SK뷰
- [x] preparing 제외
- [x] 카드 image alt
- [x] 카드 링크
- [ ] card mark `SK` 표시 검수
- [ ] 3개 카드 Grid 반응형

## SKV-P8-03 리더스시티 집중 섹션

- [x] 숫자 카드 제목은 리더스시티로 유지
- [x] 통계 합계 3,463 유지
- [x] 생활권 설명 범위 명확
- [x] 신흥 SK뷰 수치를 리더스시티 합계에 더하지 않음

## SKV-P8-04 4·5 비교표

- [x] `comparisonComplexes` 사용
- [x] 4블록·5블록 두 열
- [x] comparisonRows 값 존재
- [x] 신흥 SK뷰 열 미표시
- [x] 모바일 가로 스크롤
- [x] table header scope
- [x] aria label
- [x] 비교 설명이 우열 표현이 아님

## SKV-P8-05 상세 공통화

- [x] if/else SEO 제거
- [x] `complex.seo.title`
- [x] `complex.seo.description`
- [x] `complex.unitDataNote`
- [x] 방어적 maxUnitHouseholds
- [ ] 신흥 SK뷰 상세 생성
- [x] 기존 4블록 상세 회귀
- [x] 기존 5블록 상세 회귀

## SKV-P8-06 현재 공개 매물 섹션

- [x] naverListings import
- [x] matcher 사용
- [x] 최근 등록순 유지
- [x] 기준일 표시
- [x] 1~3건은 전부, 4건 이상은 최근 등록순 3건만 노출
- [x] 0건 상태
- [x] 전체 매물 링크
- [x] 네이버 개별 링크
- [x] 가격·면적·층·방향 공개값 그대로
- [x] 외부 링크 새 창 표기
- [x] 개인정보 미노출

## SKV-P8-07 CTA

- [x] `신흥 SK뷰 매물 보기`
- [x] `신흥 SK뷰 조건 상담`
- [x] 전화
- [x] 문자
- [x] 카카오
- [x] 모바일 safe-area
- [x] 키보드 포커스

### 완료 기준

- 세 번째 단지가 독립 상세 페이지로 보이면서 기존 리더스시티 비교 콘텐츠는 유지된다.

---

# 11. Phase 9: 매물 목록 필터

## SKV-P9-01 filter option

- [ ] published 신흥 SK뷰 option 생성
- [ ] 표시명 `신흥 SK뷰`
- [ ] value `sinheung-sk-view`
- [ ] URL 쿼리 복원
- [ ] 허용 slug 목록 반영

## SKV-P9-02 카드 dataset

- [ ] `complexSlug`가 신흥SK뷰 카드에 설정
- [ ] 리더스시티 카드 회귀 없음
- [ ] unmatched 카드에 빈 slug
- [ ] filter state와 dataset 일치

## SKV-P9-03 필터 동작

- [ ] 전체 → 신흥 SK뷰
- [ ] 신흥 SK뷰 + 매매
- [ ] 신흥 SK뷰 + 전세
- [ ] 신흥 SK뷰 + 월세
- [ ] 면적
- [ ] 가격
- [ ] 정렬
- [ ] 관심 매물
- [ ] 최대 3개 비교
- [ ] 문의 문장
- [ ] 필터 초기화
- [ ] 0건 상태
- [ ] 새로고침 후 URL 복원
- [ ] 잘못된 slug 정규화

### 완료 기준

- 공백 없는 외부 매물 제목을 포함해 신흥 SK뷰 필터 결과가 정확하다.

---

# 12. Phase 10: 관리자 화면

## SKV-P10-01 개별 단지 폼

- [x] aliases textarea
- [x] SEO title input
- [x] SEO description textarea
- [x] unitDataNote textarea
- [x] 도움말
- [x] preparing/published 설명
- [x] 이미지 alt
- [x] 기존 필드 값 채우기
- [x] 새 필드 값 채우기
- [x] reset form
- [x] edit form
- [x] dirty guard

## SKV-P10-02 serialize·parse

- [x] aliases 한 줄 파싱
- [x] 빈 줄 제거
- [x] seo nested object 생성
- [x] unitDataNote 빈 값 null
- [x] 기존 단지 저장 시 새 필드 유실 없음
- [x] 신규 단지 저장
- [x] 사진 업로드 후 데이터 SHA 갱신
- [x] 저장 취소 시 입력 유지

## SKV-P10-03 전체 안내 폼

- [x] featured slug 입력
- [x] comparison slug 입력
- [x] 현재 단지 목록 도움말
- [x] 비교 열 순서 표시
- [x] dynamic row parser
- [x] 열 수 불일치 오류
- [x] 등록되지 않은 slug 오류
- [x] preparing 단지의 featured 처리 설명
- [x] review impact pages 갱신
- [x] `src/lib/admin-content-diff.mjs`의 신규 필드 라벨과 `단지 전체 안내` 명칭 갱신
- [x] `src/components/admin/AdminContentHistory.astro`의 고정 `리더스시티 전체 안내` 명칭 갱신

## SKV-P10-04 사전 검토

- [x] before/after aliases
- [x] SEO 변화
- [x] published 전환
- [x] featured 순서 변화
- [x] comparison 범위 변화
- [x] 신흥 SK뷰 페이지 영향
- [x] 홈 영향
- [x] sitemap 영향
- [x] 저장 2차 확인 문구

## SKV-P10-05 Worker

- [x] 허용 스키마
- [x] full candidate cross validation
- [x] branch tip SHA
- [x] CAS 저장
- [x] 민감정보 검사
- [x] 사진 허용 경로
- [x] Access·Origin·CSRF 회귀
- [x] write disabled fail closed

## SKV-P10-06 관리자 테스트

- [x] 필드 존재
- [x] label 연결
- [x] disabled 기본
- [x] Access ready 후 활성
- [x] parse 정상
- [x] parse 오류
- [x] preview 취소
- [x] save 성공
- [x] stale SHA 실패
- [x] validation 실패
- [x] image upload
- [x] 기존 4·5 수정 회귀

### 완료 기준

- 운영자가 코드 수정 없이 신흥 SK뷰 콘텐츠와 노출 범위를 안전하게 관리할 수 있다.

---

# 13. Phase 11: SEO·검색·Production 빌드

## SKV-P11-01 메타

- [ ] 홈 title
- [ ] 홈 description
- [ ] office title
- [ ] office description
- [ ] complexes title
- [ ] complexes description
- [ ] 신흥 SK뷰 title
- [ ] 신흥 SK뷰 description
- [ ] OG title·description
- [ ] 대표 이미지
- [ ] canonical

## SKV-P11-02 구조화 데이터

- [ ] 홈 WebSite 유지
- [ ] RealEstateAgent 유지
- [ ] 법적 상호 유지
- [ ] address 유지
- [ ] areaServed 유지
- [ ] BreadcrumbList 상세 추가 확인
- [ ] 근거 없는 aggregate rating 없음
- [ ] 근거 없는 priceRange 없음
- [ ] 현재 매물 가격을 LocalBusiness 정보로 넣지 않음

## SKV-P11-03 sitemap·robots·llms

- [x] published 상세 URL sitemap
- [x] preparing 상태에서는 상세 URL 제외
- [x] Production-mode 산출물 robots 허용
- [x] 로컬 기본 noindex 유지
- [ ] llms.txt 갱신 여부
- [x] 내부 관리자 URL 제외

## SKV-P11-04 IndexNow

- [x] 변경 공개 URL 계획 생성
- [x] Production search marker
- [x] 공개 key
- [x] GitHub Actions `Notify IndexNow` 성공 로그 — run `33475145697`, 2026-09-01

## SKV-P11-05 Production assertion

- [x] 새 상세 HTML
- [x] canonical
- [x] title
- [x] sitemap
- [x] 빌드 marker
- [x] 개인정보 문자열 없음
- [x] 비공개 관리자 정보 없음

### 완료 기준

- Production 빌드 산출물에서 신흥 SK뷰 URL과 메타데이터가 정확하며 준비 상태는 노출되지 않는다.

---

# 14. Phase 12: 자동 테스트

## SKV-P12-01 단위·콘텐츠

- [x] `npm test`
- [x] 총 PASS 수 기록
- [x] FAIL 0
- [x] 예기치 않은 skip 0
- [x] 신규 matcher 테스트
- [x] 신흥 SK뷰 매물 빈 배열 fixture의 0건 표시 상태 테스트
- [x] 신규 validator 테스트
- [x] 관리자 파서 테스트
- [x] 기존 listing filter 회귀
- [x] 기존 worker 회귀
- [x] 기존 deployment marker 회귀

## SKV-P12-02 check·build

- [x] `npm run check`
- [x] Astro check PASS
- [x] TypeScript PASS
- [x] content validation PASS
- [x] `npm run build`
- [x] dist 생성
- [ ] 신흥 SK뷰 상세 생성
- [x] 4·5 상세 유지
- [x] 빌드 경고 검토

## SKV-P12-03 Production assertion

- [x] 기본 `npm run build`의 noindex 산출물 검증과 Production 산출물 검증을 분리
- [x] `PUBLIC_SITE_URL=https://leaderscityhappy.com` 설정
- [x] `PUBLIC_ALLOW_INDEXING=true` 설정
- [x] Production 환경변수 상태에서 `npm run build:site`
- [x] `npm run assert:production-build`
- [x] assertion 직후 같은 Production `dist/`로 E2E와 Lighthouse 실행
- [x] robots
- [x] canonical
- [x] sitemap
- [x] JSON-LD
- [x] IndexNow key
- [x] deployment marker
- [x] 검증 후 로컬 Production 환경변수 제거

PowerShell 실행 순서:

```powershell
npm ci
npm test
npm run check
npm run build

$env:PUBLIC_SITE_URL = "https://leaderscityhappy.com"
$env:PUBLIC_ALLOW_INDEXING = "true"
npm run build:site
npm run assert:production-build
npm run test:e2e
npm run audit:lighthouse

Remove-Item Env:PUBLIC_SITE_URL -ErrorAction SilentlyContinue
Remove-Item Env:PUBLIC_ALLOW_INDEXING -ErrorAction SilentlyContinue
```

## SKV-P12-04 E2E

- [x] `npm run test:e2e`
- [x] 홈 → 신흥 SK뷰
- [x] 상세 → 매물
- [x] URL filter
- [x] 실제 운영 JSON은 수정하지 않고 현재 공개 매물 흐름 검증
- [x] 0건 상태는 빈 배열 단위 fixture와 정적 마크업 검사로 별도 검증
- [x] 360px
- [x] 390px
- [x] 768px
- [x] desktop
- [x] 모바일 메뉴
- [x] 가로 넘침
- [x] 전화·문자 링크 DOM
- [x] 관심·비교 회귀
- [x] 404 회귀

## SKV-P12-05 Lighthouse

- [x] `npm run audit:lighthouse` — 현재 공개 다섯 경로 PASS
- [x] 홈 performance 98·접근성 100·Best Practices 100·SEO 100·LCP 2,177ms
- [x] 단지 목록 performance 99·접근성 100·Best Practices 100·SEO 100·LCP 2,102ms
- [x] 신흥 SK뷰 상세 performance 99·접근성 100·Best Practices 100·SEO 100·LCP 1,802ms
- [x] `/properties/?complex=sinheung-sk-view` performance 96·접근성 100·Best Practices 100·SEO 100·LCP 2,326ms
- [x] `scripts/run-lighthouse.mjs` 대상 배열에 홈·매물·단지 목록·신흥 상세·신흥 필터 다섯 경로가 실제 포함됨
- [x] 현재 공개 다섯 경로 LCP
- [x] CLS
- [x] 접근성
- [x] SEO
- [x] 다섯 경로별 점수와 LCP·TBT·CLS를 검증 기록에 보존

### 검증 기록

```text
npm test: 207 PASS, 0 FAIL, 0 skip
npm run check: Astro 0 errors/warnings/hints, 콘텐츠 검증 통과
npm run build: 기본 noindex 빌드 통과
npm run build:site + assert:production-build: 26 HTML, JSON-LD 16개 검사 통과, 신흥 SK뷰 상세·sitemap 포함
npm run test:e2e: Chromium 8 PASS, 360·390·430·768·1280px 자동 넘침 검사 포함
npm run audit:lighthouse: PASS - 홈 performance 98/LCP 2,177ms, 매물 96/2,327ms, 단지 목록 99/2,102ms, 신흥 상세 99/1,802ms, 신흥 필터 96/2,326ms, 전 경로 accessibility·best-practices·SEO 100, TBT 0ms, CLS 0.000
실행 환경: Windows, Node.js v24.19.0, Production 환경변수로 생성한 동일 dist
실행 시각: 2026-09-01 Asia/Seoul
검증자: Codex 로컬 자동 검증
```

---

# 15. Phase 13: 브라우저 화면·접근성 검수

## SKV-P13-01 데스크톱

- [x] 홈 Hero
- [x] 빠른 탐색
- [x] 주요 단지 표
- [x] 사무소 소개
- [x] 단지 목록
- [x] 리더스시티 비교표
- [x] 신흥 SK뷰 상세
- [x] 현재 매물
- [x] 매물 filter
- [x] 출처·확인일
- [x] CTA

## SKV-P13-02 모바일 실기기 — 이번 공개 완료 조건에서 제외

- [x] 제외 승인 기록 — 운영자, 2026-09-01
- 자동 360·390·430px, 하단 CTA, 가로 넘침, 이미지 crop 검증은 E2E와 로컬 브라우저에서 유지한다.

## SKV-P13-03 접근성

- [x] 키보드 only
- [x] focus visible
- [x] skip link
- [x] heading 순서
- [x] table header
- [ ] aria-live
- [x] details/summary
- [x] external link 설명
- [x] alt
- [x] 200% zoom 동등 조건
- [ ] reduced motion
- [x] 명도 대비

## SKV-P13-04 문구·사실 검수

- [x] 운영자가 모든 신흥 SK뷰 공개 문구 확인
- [x] `신흥 SK뷰 전문` 미사용
- [x] 위치와 상담 범위 혼동 없음
- [x] 세대·동·입주 값 원문 일치
- [x] 근거 불명 1,966대 미노출, K-apt 확인값 1,957대와 확인일 표시
- [x] 현재 가격 고정 문구 없음
- [x] 시설 상태 라벨 정확 — 공식 등록과 현재 실제 운영을 구분
- [x] 학교 배정 단정 없음
- [x] 사진 권리 확인
- [x] 개인정보 없음

### 완료 기준

- 운영자와 개발자가 각각 승인했다.
- 브라우저 개발자 도구뿐 아니라 실제 스마트폰에서 상담 링크를 확인했다.

---

# 16. Phase 14: Git·CI·배포

## SKV-P14-01 커밋 품질

- [x] 관련 없는 변경 제거 — 기존 README·문서·이미지 dirty 변경 보존
- [x] 생성물 미커밋
- [x] `.env` 미커밋
- [x] 사진 최적화본만 공개 경로에 포함하고 원본 JPG는 Git 제외
- [x] 문서·코드·테스트 동기화
- [x] commit 단위 빌드 가능
- [x] commit 메시지 명확 — `feat(complex): publish Sinheung SK View`
- [x] diff에서 개인정보·Secret 검색

## SKV-P14-02 PR

- [ ] 변경 목적
- [ ] 사용자 결과
- [ ] 파일 목록
- [ ] 데이터 출처
- [x] 운영자 승인
- [x] 테스트 결과
- [ ] 화면 캡처
- [ ] SEO 영향
- [ ] 롤백 방법
- [ ] 미검증 범위
- [x] CI PASS — run `33475028741`, 2026-09-01
- [ ] 리뷰 반영

## SKV-P14-03 Production 배포

- [x] master 반영 — 공개 기능 커밋 `e4685c72123473b892398346c3215f3a19586bfd`
- [x] Workers Build 시작
- [x] Workers Build 성공 — marker provider `workers-builds`
- [x] deployment marker 갱신·공개 기능 커밋 일치
- [ ] 관리자 배포 상태 `공개 완료`
- [x] 캐시 반영 확인 — 실제 공개 HTML과 WebP 응답 확인
- [x] 이전 Production에서 공개 기능 커밋으로 갱신 확인
- [ ] 실패 시 이전 배포 유지

## SKV-P14-04 Production 스모크

- [x] `/`
- [x] `/office/`
- [x] `/complexes/`
- [x] `/complexes/leaders-city-4/`
- [x] `/complexes/leaders-city-5/`
- [x] `/complexes/sinheung-sk-view/`
- [x] `/properties/?complex=sinheung-sk-view`
- [x] 실제 sitemap
- [x] `/robots.txt`
- [x] `/llms.txt`
- [x] 전화·문자·카카오 링크
- [x] 네이버 매물 링크
- [x] 모바일 자동 반응형 검사, 실제 Android·iPhone은 운영자 승인으로 제외

### 완료 기준

- GitHub 상태, Production marker, 실제 공개 HTML이 같은 commit을 가리킨다.

---

# 17. Phase 15: 검색 등록과 출시 후 관찰

## SKV-P15-01 Google

- [ ] sitemap 재제출 또는 확인
- [ ] 신흥 SK뷰 URL 검사
- [x] 수집 가능 — Production robots 허용·sitemap 상세 URL 공개
- [ ] canonical 선택 확인
- [ ] 모바일 사용성
- [ ] 구조화 데이터 오류
- [ ] title·description 노출 확인
- [ ] 색인 상태 기록

## SKV-P15-02 네이버

- [x] Production 사이트맵 확인
- [ ] 웹페이지 수집 요청
- [x] robots 확인
- [x] 대표 문구·title 확인
- [ ] 색인 여부 기록

## SKV-P15-03 IndexNow

- [x] 알림 대상 URL 계획
- [x] Naver IndexNow 알림 단계 성공 — GitHub Actions run `33475145697`
- [ ] 실패 재시도 정책
- [ ] 중복 알림 과다 없음

## SKV-P15-04 운영 관찰

- [ ] 신흥 SK뷰 매물 매칭 건수
- [ ] unmatched 단지명 목록
- [ ] 현재 매물 0건 상태
- [ ] 깨진 외부 링크
- [ ] source 확인일 만료 정책
- [ ] 시설 운영 상태 재확인
- [ ] 운영자 문의 피드백
- [ ] 검색 유입어
- [ ] CTA 클릭 분석 도입 여부 별도 결정
- [ ] 개인정보 없는 방식만 사용

### 완료 기준

- 검색 결과 노출 자체를 출시 완료 조건으로 삼지 않는다.
- 수집 가능성과 오류 없음까지 확인하고, 순위는 장기 관찰 지표로 관리한다.

---

# 18. 회귀 방지 매트릭스

| 기능 | 기존 정상 | 신규 기대 | 검증 |
|---|---|---|---|
| 리더스시티 4 상세 | 공개 | 그대로 공개 | HTML·E2E |
| 리더스시티 5 상세 | 공개 | 그대로 공개 | HTML·E2E |
| 4·5 비교표 | 두 열 | 계속 두 열 | unit·화면 |
| 리더스시티 합계 | 3,463 | 그대로 | validator |
| 홈 빠른 탐색 | 2단지 | 3단지 | E2E |
| 매물 필터 | 4·5 매칭 | 신흥 SK뷰 추가 | matcher test |
| 관리자 저장 | 기존 필드 | 새 필드 보존 | admin test |
| 개인정보 검사 | 차단 | 계속 차단 | negative test |
| 준비 단지 | 비공개 | 계속 비공개 | build test |
| 현재 매물 0건 | 정상 | 정상 안내 | fixture E2E |

---

# 19. 롤백 체크리스트

## 콘텐츠 롤백

- [ ] 신흥 SK뷰 `status: preparing`
- [ ] featured 목록 제거
- [ ] 홈 Hero 직전 문구 복원
- [ ] office 문구 직전 문구 복원
- [ ] build PASS
- [ ] sitemap에서 URL 제거
- [ ] Production 배포 확인

## 코드 롤백

- [ ] 문제 commit 식별
- [ ] revert commit 생성
- [ ] 기존 스키마 데이터 호환 확인
- [ ] 4·5 상세 확인
- [ ] 4·5 비교 확인
- [ ] 매물 필터 확인
- [ ] 관리자 확인
- [ ] Production marker 확인

## 외부 동기화 장애

- [ ] 단지 페이지 유지
- [ ] 매물 0건 상태 확인
- [ ] 동기화 job 로그 확인
- [ ] 수동으로 오래된 가격을 본문에 넣지 않음
- [ ] 복구 후 현재 JSON 기준일 확인

---

# 20. 최종 완료 보고 템플릿

```text
[변경 사항 요약]

* 수정 목적:
* 사용자 결과:
* 기준 branch/commit:
* 최종 commit:
* PR:
* Production marker:

변경 파일
* 경로:
* 핵심 변경:

콘텐츠 근거
* 단지 공식 자료:
* 확인일:
* 운영자 승인:
* 사진 권리:
* 불확실한 값:

검증
* npm test:
* npm run check:
* npm run build:
* npm run assert:production-build:
* npm run test:e2e:
* npm run audit:lighthouse:
* CI:
* Production smoke:
* Android Chrome:
* iPhone Safari:

운영 영향
* 관리자 필드:
* sitemap:
* IndexNow:
* 검색도구:
* 외부 매물 동기화:
* 개인정보·Secret:

롤백
* 콘텐츠 롤백:
* 코드 롤백:
* 직전 정상 commit:

남은 위험
* 미검증 공식 자료:
* 시설 상태:
* 검색 색인:
* 후속 작업:
```

---

# 21. Definition of Done

아래 항목이 모두 `[x]`가 되기 전에는 최종 완료로 보고하지 않는다.

- [x] G0 기준선 통과
- [x] G1 문구 승인
- [x] G2 공식 수치
- [x] G3 사진 권리
- [x] G4 스키마·관리자·validator 동기화
- [x] G5 전체 자동 회귀
- [x] G6 화면·접근성 검수 — 실기기 제외 승인 포함
- [x] G7 Production 스모크
- [x] G8 검색 수집 가능 확인 — 실제 색인·순위는 후속 관찰
- [x] 리더스시티 4·5 회귀 0건
- [x] 개인정보·비밀정보 노출 0건
- [x] 불확실한 주차·시설·학교 값의 확정 표현 0건
- [x] 신흥 SK뷰 현재 매물 또는 정상 0건 상태
- [x] 운영자에게 롤백 방법 전달 — 문제 커밋을 `git revert` 후 push하고 Production marker·공개 화면을 재확인
