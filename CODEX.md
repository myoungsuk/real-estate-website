# CODEX.md

## 프로젝트 개요

이 저장소는 대전 동구 전역을 전문 지역으로 운영하며, 천동 리더스시티5블록 단지 내 상가에 있는 `리더스시티행복한공인중개사사무소`의 공개 홈페이지다.

- Astro가 정적 HTML을 생성한다.
- GitHub를 코드·공개 콘텐츠 저장소로 사용한다.
- Cloudflare Workers Static Assets와 관리 API를 같은 Worker로 배포한다.
- `/api/admin/*`만 Worker 코드가 먼저 처리하고 나머지 공개 요청은 정적 자산으로 제공한다.
- 관리 API는 Cloudflare Access, 허용 이메일 2개, Email OTP와 JWT 재검증으로 보호한다.
- 초기 버전에는 DB, 자체 비밀번호, 서버 저장형 상담 게시판을 두지 않는다. FAQ 상담 작성 화면과 매물 문의 문장 도우미는 입력값을 서버로 보내거나 영구 저장하지 않고, 이용자가 직접 복사해 문자·카카오톡 앱에서 전송한다.
- 운영자는 Access 보호 관리자 화면 또는 승인된 JSON·사진 파일에서 공개 콘텐츠를 수정하고 GitHub에 반영한다.
- 전화·문자·공식 외부 채널로 상담을 연결한다.

사용자 또는 운영자의 최신 명시적 지시가 이 문서보다 우선한다. 미확정 정보는 추정해서 공개하지 않는다.

## 먼저 읽을 파일

작업 전 다음 순서로 실제 코드를 확인한다.

1. `CODEX.md`
2. `docs/01_천동_리더스시티_행복한부동산_서비스기획서.md`
3. `docs/02_천동_리더스시티_행복한부동산_시스템설계서.md`
4. `docs/03_천동_리더스시티_행복한부동산_개발진행체크리스트.md`
5. `README.md`
6. 변경 대상과 연결된 `src/`, `scripts/`, `tests/`, `docs/operations/` 파일

작업 시작 전 관련 파일, 호출 흐름, 영향 범위를 확인하고 실제 코드 기준으로 판단한다.

## 문서 동기화 규칙

- 공개 범위, 데이터 스키마, 운영 정책, 관리자 편집 범위가 바뀌면 코드만 수정하지 않고 같은 작업에서 아래 핵심 문서와 관련 운영 가이드를 함께 갱신한다.
  - `docs/01_천동_리더스시티_행복한부동산_서비스기획서.md`
  - `docs/02_천동_리더스시티_행복한부동산_시스템설계서.md`
  - `docs/03_천동_리더스시티_행복한부동산_개발진행체크리스트.md`
  - `docs/리더스시티 행복한부동산 관리자시스템 설계서.md`
  - `docs/리더스시티 행복한부동산 관리자시스템 개발 진행 체크리스트.md`
  - `docs/operations/CONTENT_GUIDE.md` 등 변경된 스키마를 사용하는 운영 문서
- 수정 후 이전 범위나 폐기된 필드가 남아 있는지 전체 문서 검색을 실행한다.
- 현재 초기 데이터에 리더스시티 4·5블록만 있더라도 이를 시스템의 고정 허용값 또는 전체 영업 범위로 표현하지 않는다.
- 관련 문서가 코드와 일치하지 않으면 작업을 완료로 보고하지 않는다.

## 확정 공개 정보

| 항목 | 값 |
|---|---|
| 법적 상호 | 리더스시티행복한공인중개사사무소 |
| 브랜드명 | 리더스시티 행복한부동산 |
| 대표 | 백진옥 |
| 연락처 | 010-2790-8675 |
| 이메일 | packjinok123@gmail.com |
| 주소 | 대전광역시 동구 안샘로14번길 7, 리더스시티5블록 근린생활시설 105호 |
| 중개사무소 등록번호 | 30110-2023-00028 |
| 사업자등록번호 | 805-05-02602 |
| 영업시간 | 평일 09:00~20:00, 토요일 09:00~18:00, 일요일 휴무(예약 상담 가능) |
| 주차 | 리더스시티5블록 단지 내 상가 주차장 이용 가능 |
| 카카오톡 상담 | https://pf.kakao.com/_nxmabn/chat |
| 네이버 등록 매물 | `src/data/naver-listings.json`의 개별 공개 매물 카드와 `src/data/office.json`의 중개사 매물 지도 링크 |
| 실제 도메인 | https://leaderscityhappy.com |
| 전문 지역 | 대전광역시 동구 전역(천동·신흥동과 리더스시티 포함) |
| 운영 현황 | 허위매물 0건·중개사고 0건(공개 화면에는 내부 확인 기준 문구를 표시하지 않음) |

대표 소개 문안, 대표 사진, 공식 로고, 이메일과 `etc/`에 제공된 4·5블록 단지 사진은 2026-08-25 운영자 제공 자료를 기준으로 공개한다. 공식 로고 원본은 `public/images/brand/leaders-city-happy-logo.png`, 화면용 최적화본은 같은 폴더의 WebP를 사용한다. 리더스시티 단지 수치는 LH·사업주체 공개자료와 확인일을 함께 기록한다. 상세 경력·약력, 매물과 후기는 운영자 승인 전 확정하지 않는다.

## 주요 디렉터리 구조

```text
/
├─ src/
│  ├─ components/      공통 UI
│  ├─ data/            운영자가 수정하는 공개 JSON
│  ├─ layouts/         공통 HTML·SEO 레이아웃
│  ├─ lib/             데이터 타입·표시 유틸리티
│  ├─ pages/           Astro 정적 페이지와 robots/llms 엔드포인트
│  └─ styles/          전역 반응형 스타일
├─ public/             공개 정적 파일과 Cloudflare 헤더
├─ scripts/            빌드 전 콘텐츠 검증·외부 RSS 동기화
├─ tests/              Node 단위 테스트
├─ e2e/                Playwright 공개 화면 핵심 흐름
├─ worker/             동일 Worker의 Access 검증·관리 API
├─ docs/operations/    콘텐츠·배포·검색 등록 절차
├─ docs/adr/           승인된 아키텍처 결정
├─ .github/workflows/  GitHub CI·예약/수동 외부 콘텐츠 동기화
├─ astro.config.mjs
└─ wrangler.jsonc
```

`dist/`, `.astro/`, `.wrangler/`, `node_modules/`, `.env`는 생성물 또는 로컬 정보이므로 커밋하지 않는다.

## 빌드·실행 방법

요구 환경은 Node.js 22.12 이상과 npm이다.

```bash
npm install
npm run dev
npm test
npm run check
npm run build
npm run assert:production-build
npm run test:e2e
npm run audit:lighthouse
npm run sync:bank:dry-run
npm run sync:external:dry-run
```

- `npm run check`: 공개 콘텐츠 검증 후 Astro·TypeScript 검사
- `npm run build`: 검사 후 `dist/` 정적 산출물 생성
- `npm run assert:production-build`: Production 환경변수로 만든 산출물의 robots·canonical·sitemap·JSON-LD·IndexNow 공개키·배포 marker 검사
- `npm run test:e2e`: 먼저 생성된 `dist/`에서 홈 상담 링크, 가격·면적 필터, 관심 매물 유지, 최대 3개 비교, 비저장 문의 문장, 404, 360px 메뉴·가로 넘침을 Chromium으로 검사
- `npm run audit:lighthouse`: 먼저 생성된 `dist/`의 홈·매물·단지 목록을 모바일 Lighthouse 90점, LCP·TBT·CLS 내부 기준으로 검사
- `npm run deploy`: 검사·빌드 후 Wrangler로 Cloudflare 배포
- `npm run sync:bank:dry-run`: 허용된 부동산뱅크 공개 사무소 목록을 조회하고 예상 매물 변경을 파일 수정 없이 검증
- `npm run sync:external:dry-run`: `YOUTUBE_CHANNEL_ID`로 공식 Naver RSS·YouTube Atom을 조회하고 예상 변경을 파일 수정 없이 검증
- 실제 검색 공개 빌드: `PUBLIC_SITE_URL`과 `PUBLIC_ALLOW_INDEXING=true`를 함께 설정

`PUBLIC_ALLOW_INDEXING=true`인데 `PUBLIC_SITE_URL`이 없으면 빌드를 실패시킨다. 로컬 기본값은 `noindex`다. 현재 Cloudflare의 Production 이외 브랜치 빌드는 비활성화되어 있어, 별도 Preview URL이 아니라 로컬 화면과 PR CI를 공개 전 승인 근거로 사용한다.

## 핵심 모듈과 화면 흐름

- `src/data/home-content.json` → `src/lib/content.ts` → 홈 대표·사무소·리더스시티 설명과 사진
- `src/data/office.json` → `src/lib/site.ts` → 헤더·푸터·사무소·오시는 길·네이버 등록 매물 링크·구조화 데이터
- `src/data/listings.json` → `src/lib/listings.ts` → 매물 목록 필터와 공개 상세 정적 생성
- `src/data/naver-listings.json` → `src/lib/naver-listings.ts` → 사진 없는 네이버 공개 매물 카드·홈 6건 단위 페이징·거래/유형/단지/가격/면적 필터·최근 등록/가격 낮은·높은/면적 작은·큰 정렬·관심 매물·최대 3개 비교·비저장 문의 문장·외부 상세 링크. 부동산뱅크 `등록기간` 시작일은 `registeredAt`으로 저장하고 최근 등록순을 기본값으로 사용한다.
- 부동산뱅크 공개 사무소 목록 → `scripts/sync-bank-listings.mjs` → EUC-KR 공개 HTML의 현재 페이지 전체 파싱·네이버 ID 기준 갱신·직전 부동산뱅크 기준선에서 사라진 항목 삭제·다른 공급처 항목 보존 → `naver-listings.json`. 정상 수집 뒤 `.github/listing-review-state.json`의 Bank `lastSeenAt`만 함께 갱신하며 경고 기준은 `.github/listing-review-policy.json`의 승인된 값만 사용한다. 기준이 `null`이면 경고 기능을 정상 비활성화하고 날짜 경과만으로 매물을 자동 종료·숨김 처리하지 않는다. 2026-08-26 1:1 문의의 본인 매물·하루 1회 허용 범위만 사용하며 로그인·상세·네이버 페이지는 조회하지 않는다.
- `src/data/complexes-overview.json` → 리더스시티 4·5블록 전체 소개·숫자 카드·비교표·공통 현장 확인사항·관련 콘텐츠와 출처
- `src/data/complexes.json` → 대전 동구 주요 단지의 사진·기본 사실·면적별 세대 구성·공급 구성·생활환경·시설 확인 상태·FAQ·관련 콘텐츠·복수 출처와 목록·상세 정적 생성
- 공식 Naver RSS·YouTube Atom → `scripts/sync-external-content.mjs` → `src/data/external-links.json` 신규 `published` 항목과 자체 WebP 썸네일. YouTube alternate URL의 `/shorts/`는 `youtubeFormat: short`, 그 밖의 개별 영상은 `video`로 분류하며 기존 항목은 append-only로 보존. 한 출처의 일시 장애는 3회 이내 재시도 후 경고와 함께 건너뛰고 정상 출처만 반영하며, 두 출처 모두 장애이거나 출처·채널·XML·ID 신뢰 검증이 실패하면 전체 실행을 중단
- `src/data/external-links.json` → 자동화 전 공식 블로그 128건·일반 영상 40건과 2026-08-26 확인한 공식 Shorts 32건을 기준으로 누적되는 원문 링크·자체 썸네일·최신순 카드
- `src/layouts/BaseLayout.astro` → 페이지별 title, description, canonical, robots, JSON-LD와 공개 하위 페이지 `BreadcrumbList`. 홈은 `WebSite`와 `RealEstateAgent`·`LocalBusiness`를 고정 `@id`로 연결한 단일 `@graph`를 제공
- `src/pages/robots.txt.ts`, `llms.txt.ts`, sitemap integration → 검색 로봇 안내
- `scripts/indexnow.mjs`, `.github/workflows/notify-indexnow.yml` → 성공한 `master` CI의 변경 URL 계획 → Production `search` marker·공개키 확인 → 네이버 IndexNow 알림
- `/admin/` → 관리자 대시보드와 관리 API 연결 상태
- `/admin/deployment/` → 마지막 관리자 저장 commit·resource digest와 Production marker v2를 비교한 배포 중·공개 완료·최신 배포 포함·지연·확인 불가 상태
- `/admin/history/` → 허용 공개 JSON별 현재 `master` 변경 이력, 과거 JSON과 현재 JSON의 안전한 diff, 현재 스키마 재검증, 정확한 2차 문구와 최신 blob SHA를 요구하는 새 커밋 복원
- `/admin/listings/`, `/admin/listings/editor/` → 네이버 공개 매물 현황·검색·유형·재확인 출처 필터와 확인일 정렬, 부동산뱅크 EUC-KR HTML-table `.xls` 브라우저 가져오기, 그 밖의 네이버 매물 직접 등록·수정·등록 종료. 원본 XLS는 서버로 보내지 않고 정제된 공개 목록과 재확인 상태를 한 Git 커밋으로 저장한다. 직접 등록 매물의 단건 `확인 완료`는 공통 변경 미리보기·최신 SHA 검증 뒤 `lastReviewedAt`만 새 커밋으로 갱신하며 변경 이력에서 복원할 수 있다. 재확인 정책이 미설정이면 관리자 화면도 `기준 미설정`으로 표시한다.
- `/properties/` → 공개 매물을 거래·유형·단지·가격·면적으로 좁히고, 공개 ID만 브라우저 `localStorage`에 최대 30개 관심 매물로 저장하며 최대 3개를 비교 선택한다. `/properties/compare/?ids=...`는 공개 ID만 복원하고 `noindex,follow`, canonical `/properties/`를 사용한다. 문의 조건과 자유 메모는 현재 페이지 메모리에서만 문장으로 만든다.
- `/blog/`, `/youtube/` → 지역 콘텐츠를 원문 종류별로 분리하고, 유튜브는 일반 영상을 기본으로 `일반 영상·Shorts 보기`를 전환하며 독립 페이지에서 6개 단위로 탐색
- `/faq/` → 승인된 공개 FAQ 38개를 8개 카테고리 바로가기·구역별 아코디언으로 표시하고 서버에 저장하지 않는 문자 상담 작성 화면
- `/admin/content/` → 홈 대표·사무소·리더스시티 설명과 대표 사진
- `/admin/external-links/` → 네이버 블로그·유튜브를 분리한 관리 카테고리, 유튜브 일반 영상·Shorts 형식 선택, 카테고리별 건수·검색·링크 미리보기·썸네일
- `/admin/complexes/` → 리더스시티 전체 비교 콘텐츠와 대전 동구 지역·단지 소개·사진·면적·공급·생활환경·시설 상태·FAQ·관련 콘텐츠·복수 출처·확인일
- 관리자 저장 화면 → `src/lib/admin-content-diff.mjs` 공개 필드 diff·민감 문자열 가림 → `src/lib/admin-content-review.ts` 변경 전후·영향 화면 확인과 dirty 이탈 경고 → 서버 사전 검증 → 최종 저장
- 관리자 저장 성공 → commit SHA·정규화 JSON SHA-256 digest·저장 시각을 브라우저에 안전하게 기억 → `/api/admin/v1/deployment-status`가 같은 Worker의 Production `deployment-marker.json`과 비교 → 공개 반영 상태 표시
- 관리자 복원 → `/api/admin/v1/content-history/:resource`에서 현재 branch 이력·과거 blob 확인 → 현재 전체 허용 JSON과 교차 검증 → `/api/admin/v1/content/restore`가 `force: false` 새 commit 생성 → 일반 배포 상태 추적. Cloudflare 전체 롤백과 혼합하지 않는다.
- `/api/admin/*` → `worker/index.mjs` → Access JWT·허용 이메일·Origin·CSRF 검증 → `POST /api/admin/v1/content/validate`는 쓰기 없이 같은 branch-tip snapshot과 전체 후보를 교차 검증 → 실제 저장은 요청된 JSON blob을 같은 base tree의 단일 commit으로 저장하고 non-force ref CAS로 갱신. WebP는 별도 허용 경로의 Contents API로 저장

DB와 TR 흐름은 없다. 관리 API의 콘텐츠 쓰기는 `ADMIN_WRITE_ENABLED=true`와 CSRF·GitHub Secret이 모두 있을 때만 활성화되며, 기본 로컬·Preview 설정은 fail closed다. 브라우저 JavaScript는 공개 화면의 모바일 메뉴·매물 페이징·필터·정렬·관심 ID·비교·비저장 문의 문장과 관리자 폼·WebP 변환에 사용한다. 고객 관심 상태는 공개 매물 ID만 같은 브라우저에 저장하며, 상담 입력은 `localStorage`·URL·서버 요청에 넣지 않는다.

## 공개·비공개 데이터 경계

저장소에는 공개가 승인된 정보만 둔다. 다음 정보는 소스, JSON, HTML, URL, 로그, 사이트맵에 넣지 않는다.

- 고객 연락처와 상담 내용
- 네이버 등 공개 광고 화면에 표시되지 않은 정확한 호수와 비공개 동·층 정보
- 소유자·임대인·임차인 정보
- 중개의뢰 내부 근거와 내부 메모
- 비밀번호, 토큰, API 키, 인증서, 운영 `.env`
- 신분증·등록증 원본과 사진 원본 메타데이터

`scripts/content-validation.mjs`의 금지 필드 검사를 약화하지 않는다. 단지 콘텐츠는 리더스시티 4·5블록 세대수 합계와 `external-links.json`의 공개 콘텐츠 연결도 빌드 전에 검증한다. 비공개 데이터가 필요해지면 JSON 필드를 추가하지 말고 DB·권한·암호화·보유기간을 별도로 설계하고 승인받는다.

## 콘텐츠 규칙

- `published` 매물만 공개 목록·상세·사이트맵에 생성한다.
- 공개 매물에는 고유 ID·slug, 동구 내 동네, 거래유형, 가격, 전용면적, 출처, 확인일을 입력한다.
- 네이버 외부 매물 카드는 네이버에 공개된 매물번호·동 번호·광고 층수·가격·면적·방향과 부동산뱅크 등록기간 시작일(`registeredAt`)만 `naver-listings.json`에 기록하고, 각 카드가 같은 매물번호의 `fin.land.naver.com/articles/` 주소로 연결되어야 한다. 목록 수집 기준일은 루트 `checkedAt`으로 별도 관리한다.
- 네이버 공개 카드에 없는 정확한 호수나 고객·소유자 정보는 추가하지 않는다. 공개 동 번호와 광고 층수는 그대로 표시할 수 있다.
- 매물 대표 이미지는 `thumbnail`, 상세 이미지는 `images`에 자체 `/images/` 경로와 대체 텍스트로 저장한다.
- 매매는 매매가만, 전세는 보증금만, 월세는 보증금과 월 임대료만 입력한다.
- 금액은 원 단위 정수, 면적은 ㎡로 저장한다.
- 사진·후기·대표 약력·단지 수치는 출처와 공개 승인을 확인한다.
- 승인 콘텐츠가 없으면 가짜 샘플을 만들지 않고 빈 상태 또는 준비 중으로 표시한다.
- 외부 글·영상의 원문이나 권한 없는 이미지를 복제하지 않고 짧은 설명과 원문 링크를 쓴다.
- 외부 콘텐츠는 고유 ID·`draft|published`·게시일·자체 저장 썸네일을 사용하고, 네이버 블로그·유튜브 허용 도메인만 등록한다. YouTube 항목은 `youtubeFormat: video|short`를 반드시 기록한다.
- 공식 RSS 동기화는 네이버 블로그 ID `p5468300`과 Repository Variable `YOUTUBE_CHANNEL_ID`의 고정 채널만 허용하고 신규 항목만 `published`로 추가한다. 기존 수동 수정값과 피드에 없는 항목은 덮어쓰거나 삭제하지 않는다.
- 홈과 지역 콘텐츠는 최신순으로 정렬하고 블로그는 페이지당 9개를 표시한다. 홈의 유튜브는 일반 영상 최신 6개만 표시한다. `/youtube/`는 전체 혼합 필터 없이 일반 영상을 기본으로 `일반 영상·Shorts 보기`를 제공하고 선택 형식을 페이지당 6개씩 데스크톱 3열·태블릿 2열·모바일 1열로 표시한다. 필터를 바꾸면 1페이지로 돌아간다.
- 홈의 대표·사무소·리더스시티 설명은 `home-content.json`에서 관리한다.

## 디자인·모바일·접근성

- 360px부터 가로 넘침이 없는 모바일 우선 레이아웃을 유지한다.
- 본문은 16px 이상, 주요 터치 대상은 44×44px 이상을 기본으로 한다.
- 모바일 하단 전화·문자 CTA가 콘텐츠와 safe-area를 가리지 않게 한다.
- 카카오톡 URL이 승인되기 전에는 버튼을 렌더링하지 않는다.
- 키보드 탐색, 포커스 표시, 건너뛰기 링크, 의미 있는 대체 텍스트를 보존한다.
- 색상만으로 상태를 전달하지 않고 페이지 진입 직후 자동재생과 과도한 애니메이션을 사용하지 않는다. 유튜브 카드 미리보기는 hover 가능한 정밀 포인터가 카드 전체에 0.3초 머물 때만 음소거로 한 개를 지연 로드하며, 포인터가 카드에서 벗어나면 제거한다. 모바일과 `prefers-reduced-motion` 환경에서는 실행하지 않는다.
- UI 변경 후 360·390·430·768·1280px과 실제 Android Chrome·iPhone Safari를 구분해 검증 결과를 보고한다.

## SEO·검색 노출

- 각 공개 페이지에 고유 title, description, canonical을 둔다.
- 홈의 `WebSite`와 중개사무소 구조화 데이터는 고정 `@id`로 연결하고 승인된 공식 채널만 `sameAs`로 사용한다.
- 승인된 실제 정보만 구조화 데이터에 넣는다.
- sitemap과 robots.txt를 제공한다.
- 필터·정렬 쿼리는 사이트맵에서 제외하고 기본 목록 canonical로 통합한다. 비교 페이지도 sitemap에서 제외하고 `noindex,follow`와 `/properties/` canonical을 사용한다. 초안·종료 매물과 Preview는 색인 대상에서 제외한다.
- 관리자 화면은 sitemap과 `llms.txt`에서 제외하고 `noindex`, `no-store`를 적용한다.
- `llms.txt`는 보조 안내 파일이며 검색·AI 인용을 보장한다고 표현하지 않는다.
- Google Search Console과 네이버 Search Advisor의 소유 확인 파일은 원본 이름과 내용을 유지해 `public/`에 둔다.
- 실제 검색 등록과 색인 요청은 배포·도메인·운영자 공개 검수 후 수행한다.
- 홈을 제외한 공개 HTML은 실제 화면 계층과 같은 절대 URL의 `BreadcrumbList`를 제공한다.
- 성공한 `master` push의 공개 페이지 변경은 Production `search` marker 확인 뒤 네이버 IndexNow에 알린다. 공개키는 비밀정보가 아니며, sitemap·수집 요청을 대체하거나 색인을 보장한다고 표현하지 않는다.

## Cloudflare 배포

- `wrangler.jsonc`는 `dist/` 정적 자산과 `worker/index.mjs`를 한 Worker로 배포한다.
- `assets.run_worker_first`는 `/api/admin`과 `/api/admin/*`에만 적용한다.
- Static Assets 라우터는 `ctx.access`를 전달하지 않으므로 관리 API가 `Cf-Access-Jwt-Assertion`을 `jose`로 다시 검증한다.
- Access 정책은 정확한 허용 이메일 2개와 Email OTP를 사용한다.
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`는 Production 환경에 등록하고 실제 값을 저장소에 넣지 않는다.
- GitHub Actions CI는 `npm ci`, `npm test`, 기본 `noindex` 빌드, 별도 Production-mode SEO 산출물 검사, Playwright Chromium E2E와 모바일 Lighthouse를 수행하며 Cloudflare 배포는 실행하지 않는다.
- GitHub 공식 Actions는 검증한 전체 commit SHA로 고정하고 모든 checkout은 `persist-credentials: false`를 사용한다.
- `.github/workflows/sync-external-content.yml`은 매시간 17분 `schedule`과 `workflow_dispatch`를 지원한다. 네트워크 수집·의존성·테스트는 `contents: read` job에서 수행하고, 검증 artifact를 적용하는 별도 job만 `contents: write`를 사용하며 토큰은 push 단계에만 환경변수로 전달한다.
- 동기화 워크플로는 허용된 콘텐츠·썸네일 경로 또는 45일 keepalive 상태 파일만 분리 커밋하고, 같은 실행에서 테스트·콘텐츠 검사·빌드를 다시 수행한다.
- `.github/workflows/sync-bank-listings.yml`도 매일 00:10 KST와 수동 실행을 지원하며 같은 read-validation/write-publish 권한 분리를 사용한다. 공개 목록만 조회하고 `.github/bank-listing-sync-state.json`, `.github/listing-review-state.json`, `src/data/naver-listings.json`만 하나의 Git 커밋으로 변경한다.
- Cloudflare Workers Builds는 GitHub `myoungsuk/real-estate-website`의 `master`에 연결되어 있으며, `master` 푸시 시 Production을 자동 빌드·배포한다.
- Production 빌드는 `PUBLIC_SITE_URL=https://leaderscityhappy.com`, `PUBLIC_ALLOW_INDEXING=true`를 사용한다.
- `npm run build`는 공개 `deployment-marker.json` v2에 Workers Builds·GitHub Actions source commit/branch, 허용 관리자 JSON별 정규화 SHA-256 digest와 검색 대상·Bank·외부 콘텐츠·scheduler scope hash를 생성한다. 기존 v1 scope reader는 2026-09-30까지 호환한다. 동기화와 IndexNow 워크플로는 push 후 해당 scope가 운영 URL과 일치할 때까지 확인하며 불일치·시간 초과를 실패로 표시한다.
- `wrangler.jsonc`의 `CF_VERSION_METADATA` binding은 인증된 관리자에게 현재 Worker version ID·생성 시각만 제공하며 Secret·태그·관리자 이메일은 반환하지 않는다.
- `master` 푸시 후에는 deployment marker와 Cloudflare 새 배포 버전, 운영 URL 반영을 확인한다. 자동 배포가 진행 중인 동안 중복 수동 배포를 실행하지 않는다.
- 자동 배포가 실패하거나 시작되지 않은 사실을 확인한 경우에만 Production 환경변수 빌드와 `npx wrangler deploy --dry-run`을 다시 검증한 뒤 `npx wrangler deploy`로 수동 배포한다.
- GitHub·Cloudflare 계정 연결 변경, Production/Preview 환경변수 변경, 사용자 도메인 DNS 변경은 외부 운영 작업이다.
- Workers Static Assets `_redirects`는 domain-level·프로토콜 조건을 지원하지 않으므로 HTTP→HTTPS 강제에 사용하지 않는다. Cloudflare zone의 `Always Use HTTPS`를 활성화하고 HTTP 응답의 301과 query/path 보존을 확인한다.
- 관례적인 `/sitemap.xml` 요청만 `_redirects`에서 공식 `/sitemap-index.xml`로 301 이동하며, 존재하지 않는 경로 전체를 홈으로 리디렉션하지 않는다.
- 잘못된 배포는 직전 정상 Cloudflare 배포로 롤백하거나 Git revert 후 재배포한다.

## 조건부 컴파일·인코딩·리소스

- C/C++식 조건부 컴파일 매크로는 없다.
- 공개 빌드 환경 분기는 `PUBLIC_SITE_URL`, `PUBLIC_ALLOW_INDEXING`을 사용한다.
- 외부 콘텐츠 동기화는 공개 설정 `YOUTUBE_CHANNEL_ID`를 GitHub Actions Repository Variable로 사용한다. API Key나 Secret으로 취급하지 않는다.
- 관리 API 환경은 `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_WRITE_ENABLED`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_CSRF_SECRET`, `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`를 사용한다. `ADMIN_ALLOWED_ORIGINS` 미설정 시 운영 원점 `https://leaderscityhappy.com`만 관리자 쓰기를 허용한다.
- GitHub 토큰은 Fine-grained token으로 저장소 한 개의 Contents Read/Write만 허용하고 Cloudflare Secret에만 둔다.
- 소스와 콘텐츠는 UTF-8, LF, 2칸 들여쓰기를 따른다.
- 공개 사진은 권한과 개인정보를 확인하고 EXIF·GPS를 제거한 WebP/AVIF 최적화본을 우선한다.
- 공식 로고는 승인된 PNG 원본을 보존하고 화면에는 최적화 WebP를 사용하며, 헤더·푸터·Open Graph에서 같은 브랜드를 유지한다.
- 원본 파일명에 동·호수나 고객 이름을 넣지 않는다.

## 최소 수정과 검증

- 요청 범위만 수정하며 관련 없는 리팩터링·포맷 변경·네이밍 변경을 섞지 않는다.
- 기존 Astro·TypeScript·CSS 패턴과 검증 방식을 따른다.
- 공용 타입, 콘텐츠 스키마, 전역 설정, 배포 설정 변경 전 영향과 위험을 먼저 알린다.
- 테스트를 통과시키려고 공개 검수·금지 필드·보안 헤더를 약화하지 않는다.
- 실행하지 않은 검사나 실기기 검수를 통과했다고 보고하지 않는다.

기본 완료 검증:

```bash
npm test
npm run check
npm run build
npm run test:e2e
npm run audit:lighthouse
npx wrangler deploy --dry-run
```

화면 변경은 모바일 메뉴, 필터, 0건 상태, 전화·문자 링크, 404, 가로 넘침, 콘솔 오류를 함께 확인한다.

## 완료 보고 형식

```text
[변경 사항 요약]

* 수정 목적:
* 변경 파일:
* 핵심 변경 내용:
* 영향 범위:
* 주의 사항:

검증:
* 실행 명령과 실제 결과

데이터베이스:
* 마이그레이션 여부와 영향

남은 확인:
* 운영자 승인, 외부 계정, 실기기 등 미완료 항목
```
