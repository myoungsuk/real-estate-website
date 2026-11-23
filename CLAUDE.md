# CLAUDE.md

이 저장소의 작업 규칙 기준 문서다. 이 저장소는 Claude Code만 사용하므로 2026-11-16에 예전 `CODEX.md`·`AGENTS.md`의 내용을 이 파일로 통합하고 두 파일을 삭제했다. 그 이전에 작성된 문서·체크리스트에 나오는 `CODEX.md`는 이 파일을 가리킨다.

## 프로젝트 개요

이 저장소는 대전 동구 전역을 전문 지역으로 운영하며, 천동 리더스시티5블록 단지 내 상가에 있는 `리더스시티행복한공인중개사사무소`의 공개 홈페이지다.

- Astro가 정적 HTML을 생성한다.
- GitHub를 코드·공개 콘텐츠 저장소로 사용한다.
- Cloudflare Workers Static Assets와 관리 API를 같은 Worker로 배포한다.
- `/api/admin/*`와 업무 도구 캘린더 구독 주소 `/api/calendar/*`(단계 3, Access 밖에서 토큰으로만 열림)만 Worker 코드가 먼저 처리하고 나머지 공개 요청은 정적 자산으로 제공한다.
- 관리 API는 Cloudflare Access, 허용 이메일 2개, Email OTP와 JWT 재검증으로 보호한다.
- 공개 홈페이지에는 DB, 자체 비밀번호, 서버 저장형 상담 게시판을 두지 않는다. 관리자 전용 중개업무 도구(단계 2 손님 자료, 단계 P 공개 실거래 자료)는 D1·R2에 연결돼 있다. 단계 2 업무 도구(손님·매출장부·할 일·휴지통)는 처리방침 개정을 공개한 뒤 2026-11-22 Worker Secret `WORK_TOOLS_ENABLED`를 등록해 켜졌고, 사진은 처리방침에 사진 문장을 공개한 뒤 같은 날 `WORK_FILES_ENABLED`를 등록해 켜졌다. 단계 P는 자기 켜기 값을 따른다. FAQ 상담 작성 화면과 매물 문의 문장 도우미는 입력값을 서버로 보내거나 영구 저장하지 않고, 이용자가 직접 복사해 문자·카카오톡 앱에서 전송한다.
- 운영자는 Access 보호 관리자 화면 또는 승인된 JSON·사진 파일에서 공개 콘텐츠를 수정하고 GitHub에 반영한다.
- 전화·문자·공식 외부 채널로 상담을 연결한다.

사용자 또는 운영자의 최신 명시적 지시가 이 문서보다 우선한다. 미확정 정보는 추정해서 공개하지 않는다.

## 먼저 읽을 파일

작업 전 다음 순서로 실제 코드를 확인한다.

1. `CLAUDE.md`
2. `docs/01_천동_리더스시티_행복한부동산_서비스기획서.md`
3. `docs/02_천동_리더스시티_행복한부동산_시스템설계서.md`
4. `docs/03_천동_리더스시티_행복한부동산_개발진행체크리스트.md`
5. `README.md`
6. 변경 대상과 연결된 `src/`, `scripts/`, `tests/`, `docs/operations/` 파일

관리자 시스템 관련 작업은 `docs/리더스시티 행복한부동산 관리자시스템 설계서.md`와 `docs/리더스시티 행복한부동산 관리자시스템 개발 진행 체크리스트.md`를 추가로 확인한다.

중개업무 도구 작업은 `docs/work-tools/`의 문서 4개(기획서·설계서·개발 진행 체크리스트·테스트 체크리스트)와 `docs/adr/ADR-011-private-work-data-d1-r2-openai.md`를 추가로 확인한다.

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
| 인스타그램 | https://www.instagram.com/readers.45_real.estate/ (머리 메뉴·홈 '블로그·유튜브 새 글' 칸 아래 바로가기, 홈 `sameAs`. 2026-11-19 사용자 제공. 관리자가 직접 등록한 공개 게시물은 같은 칸에 정사각 카드 최신 6개, 0건이면 바로가기만 — 2026-11-19 사용자 결정 "관리자에서 직접 등록") |
| 네이버 등록 매물 | `src/data/naver-listings.json`의 개별 공개 매물 카드와 `src/data/office.json`의 중개사 매물 지도 링크 |
| 실제 도메인 | https://leaderscityhappy.com |
| 전문 지역 | 대전광역시 동구 전역(천동·신흥동과 리더스시티 포함) |
| 주요 상담 단지 | 리더스시티 4·5블록, 신흥 SK뷰(상세 단지정보 공개) |
| 운영 현황 | 허위매물 0건·중개사고 0건. 2026-11-18 사용자 결정으로 홈·사무소 소개·`llms.txt`에 표시하지 않음(`office.json`의 `publicClaims` 값만 보존) |
| 상담 방식 | 대표 직접 상담(2026-11-17 운영자 확인) |

대표 소개 문안, 대표 사진, 공식 로고, 이메일과 `etc/`에 제공된 4·5블록 단지 사진은 2026-08-25 운영자 제공 자료를 기준으로 공개한다. 신흥 SK뷰 대표 사진은 2026-09-01 운영자가 직접 촬영하고 공개를 승인한 사진을 사용하며, 현재 홈·사무소·상세 상담 문구도 같은 날 승인했다. 공식 로고 원본은 `public/images/brand/leaders-city-happy-logo.png`, 화면용 최적화본은 같은 폴더의 WebP를 사용한다. 단지 수치는 공식 공개자료와 확인일을 함께 기록한다. 상세 경력·약력, 매물과 후기는 운영자 승인 전 확정하지 않는다.

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
├─ docs/work-tools/    관리자 중개업무 도구 기획·설계·개발 진행·테스트 문서
├─ .github/workflows/  GitHub CI·예약/수동 외부 콘텐츠 동기화
├─ astro.config.mjs
└─ wrangler.jsonc
```

`dist/`, `.astro/`, `.wrangler/`, `node_modules/`, `.env`는 생성물 또는 로컬 정보이므로 커밋하지 않는다.

## 빌드·실행 방법

요구 환경은 Node.js 22.13 이상과 npm이다(업무 도구 마이그레이션 시험이 Node 내장 `node:sqlite`를 플래그 없이 쓰기 때문, CI는 24).

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
- `npm run audit:lighthouse`: 먼저 생성된 `dist/`의 홈·매물·단지 목록·신흥 SK뷰 상세·신흥 SK뷰 필터 결과를 모바일 Lighthouse 90점, LCP·TBT·CLS 내부 기준으로 검사
- `npm run deploy`: 검사·빌드 후 Wrangler로 Cloudflare 배포
- `npm run sync:bank:dry-run`: 허용된 부동산뱅크 공개 사무소 목록을 조회하고 예상 매물 변경을 파일 수정 없이 검증
- `npm run sync:external:dry-run`: `YOUTUBE_CHANNEL_ID`로 공식 Naver RSS·YouTube Atom을 조회하고 예상 변경을 파일 수정 없이 검증
- `node scripts/work-tools-progress.mjs --write`: 중개업무 도구 진행 체크리스트·테스트 체크리스트의 체크 표시나 결과 칸을 바꾼 뒤 진행표·점수표를 다시 쓴다. 표가 실제와 다르면 `npm test`가 실패하며, `--check`는 고치지 않고 확인만 한다.
- 실제 검색 공개 빌드: `PUBLIC_SITE_URL`과 `PUBLIC_ALLOW_INDEXING=true`를 함께 설정

`PUBLIC_ALLOW_INDEXING=true`인데 `PUBLIC_SITE_URL`이 없으면 빌드를 실패시킨다. 로컬 기본값은 `noindex`다. 현재 Cloudflare Workers Builds의 Production 이외 브랜치 빌드는 비활성화되어 있고, 롤백용 Cloudflare Pages 프로젝트도 2026-11-16부터 미리보기(Preview) 브랜치 배포를 끄고 `master` 배포만 유지한다. 별도 Preview URL이 아니라 로컬 화면과 PR CI를 공개 전 승인 근거로 사용한다.

## 핵심 모듈과 화면 흐름

- `src/data/home-content.json` → `src/lib/content.ts` → 홈 대표·사무소·리더스시티·신흥 SK뷰 상담 범위 설명과 사진
- `src/data/office.json` → `src/lib/site.ts` → 헤더(인스타그램 바로가기 포함)·푸터·사무소·오시는 길·네이버 등록 매물 링크·구조화 데이터
- `src/data/listings.json` → `src/lib/listings.ts` → 매물 목록 필터와 공개 상세 정적 생성
- `src/data/naver-listings.json` → `src/lib/naver-listings.ts` → 사진 없는 네이버 공개 매물 카드·홈 6건 단위 페이징·거래/유형/단지/가격/면적 필터·최근 등록/가격 낮은·높은/면적 작은·큰 정렬·관심 매물·최대 3개 비교·비저장 문의 문장·외부 상세 링크. 부동산뱅크 `등록기간` 시작일은 `registeredAt`으로 저장하고 최근 등록순을 기본값으로 사용한다.
- 부동산뱅크 공개 사무소 목록 → `scripts/sync-bank-listings.mjs` → EUC-KR 공개 HTML의 현재 페이지 전체 파싱·네이버 ID 기준 갱신·직전 부동산뱅크 기준선에서 사라진 항목 삭제·다른 공급처 항목 보존 → `naver-listings.json`. 정상 수집 뒤 `.github/listing-review-state.json`의 Bank `lastSeenAt`만 함께 갱신하며 경고 기준은 `.github/listing-review-policy.json`의 승인된 값만 사용한다. 기준이 `null`이면 경고 기능을 정상 비활성화하고 날짜 경과만으로 매물을 자동 종료·숨김 처리하지 않는다. 2026-08-26 1:1 문의의 본인 매물·하루 1회 허용 범위만 사용하며 로그인·상세·네이버 페이지는 조회하지 않는다.
- `src/data/complexes-overview.json` → 홈·목록의 `featuredComplexSlugs` 순서와 리더스시티 비교표의 `comparisonComplexSlugs` 범위를 분리하고, 리더스시티 4·5블록 숫자 카드·비교표·공통 현장 확인사항·관련 콘텐츠와 출처 제공
- `src/data/complexes.json` → 대전 동구 주요 단지의 alias·SEO·단위 자료 안내·사진·기본 사실·면적별 세대 구성·공급 구성·생활환경·시설 확인 상태·FAQ·관련 콘텐츠·복수 출처와 목록·상세 정적 생성. 신흥 SK뷰는 공식 합계·운영자 직접 촬영 사진·공개 문구 승인을 반영해 `published`로 공개하며 상세·사이트맵·매물 단지 필터에 포함
- `src/lib/complexes.ts`, `src/lib/complex-matching.mjs` → 공개 단지 순서 파생, NFKC·공백·구분기호 정규화와 긴 접두어 우선 매물 제목 매칭. 매칭되지 않은 매물은 숨기지 않음
- 공식 Naver RSS·YouTube Atom → `scripts/sync-external-content.mjs` → `src/data/external-links.json` 신규 `published` 항목과 자체 WebP 썸네일. YouTube alternate URL의 `/shorts/`는 `youtubeFormat: short`, 그 밖의 개별 영상은 `video`로 분류하며 기존 항목은 append-only로 보존. 한 출처의 일시 장애는 3회 이내 재시도 후 경고와 함께 건너뛰고 정상 출처만 반영하며, 두 출처 모두 장애이거나 출처·채널·XML·ID 신뢰 검증이 실패하면 전체 실행을 중단
- `src/data/external-links.json` → 자동화 전 공식 블로그 128건·일반 영상 40건과 2026-08-26 확인한 공식 Shorts 32건을 기준으로 누적되는 원문 링크·자체 썸네일·최신순 카드. 관리자가 직접 등록하는 인스타그램 게시물(`type: instagram`, `/p/`·`/reel/` 주소, 썸네일 필수)도 같은 파일에 두며 홈 인스타그램 묶음에만 정사각 카드 최신 6개로 표시하고, 동기화는 이 항목을 건너뛰고 보존한다
- `src/layouts/BaseLayout.astro` → 페이지별 title, description, canonical, robots, JSON-LD와 공개 하위 페이지 `BreadcrumbList`. 홈은 `WebSite`와 `RealEstateAgent`·`LocalBusiness`를 고정 `@id`로 연결한 단일 `@graph`를 제공
- `src/pages/robots.txt.ts`, `llms.txt.ts`, sitemap integration → 검색 로봇 안내
- `scripts/indexnow.mjs`, `.github/workflows/notify-indexnow.yml` → 성공한 `master` CI의 변경 URL 계획 → 운영 `/deployment-marker.json`의 `source.commit`이 그 커밋이거나 후속 커밋인지·공개키 확인 → 네이버 IndexNow 알림
- `.github/workflows/verify-production-deploy.yml` → `scripts/verify-production-commit.mjs` → `master` push 커밋이 운영 `/deployment-marker.json`의 `source.commit`과 같거나 그 조상이 될 때까지 확인 → 시간 초과 시 Action 실패(GitHub 실패 알림)
- `/admin/` → 관리자 대시보드와 관리 API 연결 상태
- 관리자 공용 틀(`src/layouts/AdminLayout.astro`, 전체 메뉴 창의 목록 `src/components/admin/AdminMenu.astro`, 알약 그림 22개 `src/components/admin/AdminPillIcon.astro`. 2026-11-23 새 겉모양, 사용자 승인 11:34:13 "이대로 구현") → 왼쪽 고정 목록 없이 화면 위 한 줄이다. 980px 이상은 로고 · 알약 줄 · '전체 메뉴' 단추가 한 줄이고, 979px 이하는 제목 줄 + 알약 줄 + 아래 탭 4개다. 알약 줄은 업무 도구(아래 단계 11개)·네이버 매물(2개) 화면에서는 그 아래 단계, 그 밖의 화면에서는 980px 이상에서만 구역 9개를 보인다. 아래 단계 줄 화면은 980px 이상에서 줄 맨 앞(미는 줄 밖)에 '대시보드' 알약을 고정한다(2026-11-23 사용자 선택 16:36:32). '전체 메뉴' 창(`dialog.admin-sheet`)은 PC·휴대폰이 같이 쓰고, 위 줄은 고정하지 않는다. 색은 `src/styles/admin.css`의 `.admin-body`에 둔 관리자만의 값이다(`--ds-*` 8개는 공개 화면과 이름만 같고 값이 다름, `--ad-*` 11개는 관리자 전용). 관리자 화면만 바꾸는 작업은 공개 `global.css`를 건드리지 않고, 빌드한 공개 화면 산출물이 그 전과 같은지 대조한다. 상세는 `DESIGN.md` '관리자 틀'·'관리 화면 모양'과 `docs/work-tools/` 설계서 7.1절.
- `/admin/deployment/` → 마지막 관리자 저장 commit·resource digest와 Production marker v2를 비교한 배포 중·공개 완료·최신 배포 포함·지연·확인 불가 상태
- `/admin/history/` → 허용 공개 JSON별 현재 `master` 변경 이력, 과거 JSON과 현재 JSON의 안전한 diff, 현재 스키마 재검증, 정확한 2차 문구와 최신 blob SHA를 요구하는 새 커밋 복원
- `/admin/help/` → 관리 화면 24곳 제목 아래 처음에는 접힌 '이 화면 사용법' 상자와 같은 글을 사진 없이 모은 사용 안내(메뉴 '확인' 묶음 끝, 휴대폰 아래 탭 제외). 문구는 `src/lib/admin-help.mjs` 한 곳에 두고, 작은따옴표로 적은 단추·칸 이름과 숫자를 `tests/admin-help.test.mjs`가 화면 원본·코드와 대조한다. 관리 화면의 단추 이름·시각·개수를 바꾸면 이 문구도 함께 고친다.
- `/admin/listings/`, `/admin/listings/editor/` → 네이버 공개 매물 현황·검색·유형·재확인 출처 필터와 확인일 정렬, 부동산뱅크 EUC-KR HTML-table `.xls` 브라우저 가져오기, 그 밖의 네이버 매물 직접 등록·수정·등록 종료. 원본 XLS는 서버로 보내지 않고 정제된 공개 목록과 재확인 상태를 한 Git 커밋으로 저장한다. 직접 등록 매물의 단건 `확인 완료`는 공통 변경 미리보기·최신 SHA 검증 뒤 `lastReviewedAt`만 새 커밋으로 갱신하며 변경 이력에서 복원할 수 있다. 재확인 정책이 미설정이면 관리자 화면도 `기준 미설정`으로 표시한다.
- `/properties/` → 공개 매물을 거래·유형·단지·가격·면적으로 좁히고, 공개 ID만 브라우저 `localStorage`에 최대 30개 관심 매물로 저장하며 최대 3개를 비교 선택한다. `/properties/compare/?ids=...`는 공개 ID만 복원하고 `noindex,follow`, canonical `/properties/`를 사용한다. 문의 조건과 자유 메모는 현재 페이지 메모리에서만 문장으로 만든다.
- `/blog/`, `/youtube/` → 지역 콘텐츠를 원문 종류별로 분리하고, 유튜브는 일반 영상을 기본으로 `일반 영상·Shorts 보기`를 전환하며 독립 페이지에서 6개 단위로 탐색
- `/faq/` → 승인된 공개 FAQ 38개를 8개 카테고리 바로가기·구역별 아코디언으로 표시하고 서버에 저장하지 않는 문자 상담 작성 화면
- `/admin/content/` → 홈 대표·사무소·리더스시티 설명과 대표 사진
- `/admin/external-links/` → 네이버 블로그·유튜브·인스타그램을 분리한 관리 카테고리(인스타그램은 정보 불러오기 없이 사진 직접 등록, 공유 주소의 물음표 뒤 꼬리 제거), 유튜브 일반 영상·Shorts 형식 선택, 카테고리별 건수·검색·링크 미리보기·썸네일
- `/admin/complexes/` → 리더스시티 전체 비교 콘텐츠와 대전 동구 지역·단지 소개·사진·면적·공급·생활환경·시설 상태·FAQ·관련 콘텐츠·복수 출처·확인일
- `/admin/work/`·`fee/`·`messages/`·`schedule/` → 관리자 전용 중개업무 도구 단계 0. `src/data/work/legal-rules.json`(공개 법령 요율·기한·판정 기준과 출처) → `src/lib/work/*.mjs` 순수 함수 → 중개보수 계산·안내 문자·계약 일정·`.ics`. 입력값은 저장·서버 전송·URL·브라우저 저장소에 넣지 않고, 법령 데이터는 `validateLegalRules()`로 빌드 전 검증한다. 상세는 `docs/work-tools/`.
- `/admin/work/realprice/`·`realprice/settings/`·`realprice/promo/` → 관리자 전용 실거래가 화면(단계 P, 업무 도구 아래 단계 "실거래가", 설정·홍보물 화면은 "실거래가"를 지금 구역으로 표시). 서버 요청은 `src/lib/work-realprice-client.ts` 한 곳 → 업무 API `realprice/status`·`trades`·`complexes`·`watch`·`refresh` → 화면 문장·금액은 `src/lib/work/realprice-view.mjs` 순수 함수. 휴대폰·PC가 같은 순서(상태 한 줄 → 보기 3칸(새 거래·주요 거래·관심 단지) → 찾기칸 → 거르기 단추 6개 → 'n건 보는 중' 줄)이고(D안, P1-f), 목록은 1220px 이하 세 줄 카드·1221px 이상 표다. 탭 미리 그리기는 prefetch만. 업무 API `trades`는 `q`(단지·동 이름, 1 ~ 30자, 결합값만)와 `view=major`(최근 30일 매매에서 해제·직거래를 뺀 신고가 전부 + 금액 상위 10건)를 받고, 둘이 없으면 응답은 이전과 같다. 거래마다 '담기'로 최대 6건(해제 거래 제외)을 화면 메모리에만 담아 `promo/?ids=`로 넘기고, 홍보물 화면은 `trades?ids=`로 다시 읽어 해제·찾지 못한 거래를 빼고 알린 뒤 '어디에 올릴까요?' → 그림 저장·글 복사·붙여 넣기 순서로 안내하며 순수 함수 `src/lib/work/realprice-promo.mjs`로 글 4가지(스레드·인스타그램·블로그·카카오톡)를, `src/lib/work-realprice-card.ts`로 1080×1350 카드 PNG(data 주소, 3건씩 최대 2장)를 만들고 A4는 인쇄 CSS로 한 장에 맞춘다. 출처·받은 시각·계약일 기준 안내·사무소 명시사항 5항목이 자동으로 붙고 동 번호는 넣지 않으며, 명시사항이 비거나 받은 시각을 모르면 만들지 않는다(P1-e). 매매 거래마다 업무 API `realprice/insights?ids=`(1 ~ 30개, `worker/realprice-insights.mjs`)로 같은 단지·같은 전용면적의 12개월 흐름선·직전 거래·최고가 대비(앞선 최고 = 22.8 신고가 기준)·최근 3개월 거래 수를 받아, 표는 칸 3개, 휴대폰 카드는 접힌 '흐름·직전 거래' 줄, 홍보물 카드는 흐름선·회색 칸으로 보인다(화면 문장은 `src/lib/work/realprice-insight-view.mjs`). 자료가 없으면 카드 줄을 두지 않고 까닭은 목록 위 한 줄로 알린다. 상세는 `docs/work-tools/` 설계서 22.10·22.17절.
- `/admin/work/customers/`·`customers/detail/?id=`·`/admin/work/notes/` → 관리자 전용 손님·손님 카드·메모 창고(단계 2). 서버 요청은 `src/lib/work-customers-client.ts` 한 곳 → 업무 API `session`·`customers`·`customers/:id`(거래마다 일정 `events`·계약서 사본 `files` 포함)·`notes` → 화면 문장은 `src/lib/work/customers-view.mjs` 순수 함수. 메뉴에는 '손님'만 두고 메모 창고는 손님 화면 위 링크로 연다. 업무 세션이 꺼져 있으면 손님 자료를 부르지 않고, 손님 카드 주소에는 무작위 UUID만 넣으며 이름·전화는 주소·브라우저 저장소·제목에 넣지 않는다. 서버를 부르므로 prerender 목록에 넣지 않는다. 찾기 말(`q`)은 업무 API 요청 주소에만 들어가고 화면 주소에는 남기지 않는다.
- `/admin/work/ledger/`(매출장부 화면, `src/lib/work-ledger-client.ts` 한 곳 → 화면 문장·CSV는 `src/lib/work/ledger-view.mjs` 순수 함수)과 업무 API `deals`(GET 목록)·`ledger`·`ledger/:id`·`ledger/summary`·`ledger/export`(CSV 내려받기 전 감사만 남김, 그 응답 뒤에만 CSV를 만들고 `=`·`+`·`-`·`@`로 시작하는 칸은 수식 막기) → `worker/work-ledger.mjs` → D1 `ledger_entries`(구조 5, `migrations/work/0005_ledger.sql`) 매출장부(단계 2). 업무 도구 아래 메뉴는 묶음 3개(손님·돈 / 상담 도구 / 홍보 만들기, 묶음마다 `role="group"` + `aria-labelledby`, 화면 위 알약 줄은 sr-only 제목)이고, 손님 카드 거래 칸 안에 장부 칸이 있다. 한 거래에 보수 줄 여러 개, 거래·손님을 지우면 장부 줄은 남기고 거래 연결만 끊는다(`snap_*`에 날짜, 빈 `label`에 거래 제목). 1221px 이상(마우스·손가락 모두)은 11칸 표에서 칸을 눌러 바로 고치고(표 조각 `src/lib/work-ledger-grid.ts`, 순수 함수 `src/lib/work/ledger-grid.mjs`, 칸마다 `PATCH ledger/:id`, 공급가액을 고치면 부가세가 10%였던 줄만 함께 바꿈, 되돌리기 20단계는 화면 메모리에만, 2026-11-23 D-2a), 합계 칸·달별 표 대신 표 안에 합계 줄·달 줄(받을 금액은 합계 응답의 `receivableWon`·입금액·미입금, 서로 빼서 맞추지 않음)을 둔다. 1221px 이상 + 마우스에서는 연도·기준일·거르기·되돌리기·CSV·'장부 줄 만들기'를 표 위 한 줄로 옮긴다(스크립트가 옮기고 좁히거나 목록이 숨으면 되돌림, 2026-11-23 D-2a2). 1220px 이하는 카드와 입력 화면이다. 합계 기준일은 잔금일·계약일·입금일이고 기준일이 없는 줄은 'n건'으로 따로 센다. 부가세 다름(보수만)·법정 상한 초과는 저장하고 `warnings[]`로만 알린다. 상세는 `docs/work-tools/` 설계서 6.12절.
- `/admin/work/tasks/`(할 일 화면, `src/lib/work-tasks-client.ts` 한 곳 → 화면 문장은 `src/lib/work/tasks-view.mjs`, 줄 그리기는 `src/lib/work-tasks-dom.ts`)과 업무 API `tasks`·`tasks/:id` → `worker/work-tasks.mjs` → D1 `tasks`(구조 6, `migrations/work/0006_tasks.sql`) 할 일(단계 2). 업무 도구 아래 메뉴 '도구 모음'(2026-11-23 전 '업무 도구 처음') 바로 뒤(묶음 제목 없음)에 '할 일'이 있고, 도구 모음의 '오늘 할 일' 칸은 오늘까지 열린 할 일을 5개까지 읽기만 한다(미리 그리기 중에는 부르지 않음). 반복은 매주·매월만이고 끝내면 다음 하나를 만든다(다음 날짜는 서버·화면이 같이 쓰는 순수 함수 `src/lib/work/task-repeat.mjs`의 `nextTaskDueOn`, 31일이 없는 달은 그 달 마지막 날). 거래·손님을 지우면 그 거래의 할 일도 지운다(`deleted.tasks`). 할 일 제목은 감사 `reason`·주소·브라우저 저장소에 넣지 않는다. 상세는 `docs/work-tools/` 설계서 6.13절.
- 업무 API `trash`(목록)·`trash/:id/restore`(되살리기)·`trash/:id`(영구 삭제, 확인 글자 "영구 삭제") → `worker/work-trash.mjs` → D1 `trash_batches`·`trash_rows`(구조 7, `migrations/work/0007_trash.sql`). 손님·거래·메모·일정·장부 줄·할 일을 지우면 지운 행과 끊은 연결(메모의 손님·거래 연결, 장부 줄의 거래 연결)을 한 묶음으로 옮겨 적은 뒤 원래 표에서 지우고, 7일 지나면 03:00 Cron이 영구 삭제한다. 되살리기는 구조 번호가 지울 때와 같을 때만 되고, 거래·손님이 없어 못 넣은 줄은 휴지통에 남긴다(2026-11-21 사용자 결정 "지운 자료를 따로 옮겨 둠").
- `/admin/work/trash/`(휴지통 화면, 서버 요청은 `src/lib/work-trash-client.ts` 한 곳 → 화면 문장은 `src/lib/work/trash-view.mjs`, 지운 뒤 알림의 '되살리기'·'휴지통 보기'는 `src/lib/work-trash-dom.ts`). 메뉴에는 넣지 않고 손님 목록 위 '휴지통' 고리와 도구 모음 바로가기(개수를 싣지 않아 서버를 부르지 않음)로 들어간다(2026-11-22 사용자 선택 "손님 화면 고리 + 처음 화면 바로가기"). 서버를 부르므로 prerender 목록에 넣지 않는다. 종류 거르기는 받은 목록에서만 하고, 영구 삭제는 칸 안에 "영구 삭제"를 넣어야 단추가 켜진다(확인 창 없음). 손님 카드·메모 창고·매출장부·할 일 지우기 확인 글은 "휴지통으로 옮깁니다. 7일 안에 되살릴 수 있고, 그 뒤 자동으로 영구 삭제됩니다."이고, 백업 안내는 숫자 없이 처리방침을 가리킨다("영구 삭제한 뒤에도 백업에는 개인정보 처리방침에 적힌 기간 동안 남았다가 지워집니다."). 묶음 이름(손님 이름·메모 첫머리)은 글자로만 그리고 주소·브라우저 저장소에 넣지 않는다. 상세는 `docs/work-tools/` 설계서 7.1·8.7절.
- 업무 API `files`(올리기)·`files/:id/content`(원본, 감사 `file.download`)·`files/:id/thumb`(미리보기 WebP·JPEG, R2 키 `<원본 키>.thumb`, 올리기 감사 `file.thumb`·읽기 감사 없음)·`files/:id`(설명 고치기·지우기) → `worker/work-files.mjs` → R2 `WORK_FILES` + D1 `files`(구조 번호 그대로 7). 켜기 값 `WORK_FILES_ENABLED`(Secret)이 없으면 503 `FILES_DISABLED`이고, 처리방침에 사진 문장을 공개한 뒤 2026-11-22에 켰다. 현장·기타 사진은 손님에게만(`customer:{uuid}`), 계약서 사본(`contract_copy`, 2026-11-23 K-a)은 거래에만(`deal:{uuid}`) 붙이고 둘 다 JPEG·WebP 10MB까지 받는다. 계약서 사본은 `X-Work-Masked: rrn=1`(주민등록번호를 가렸다는 확인. 서버는 실제로 가렸는지 확인하지 못함)이 없으면 400 `MASK_CONFIRMATION_REQUIRED`, 한 거래 10장이 차면 409 `FILE_LIMIT_REACHED`이고 미리보기는 만들지 않는다(400 `FILE_THUMB_NOT_ALLOWED`). 계약서 사본은 손님 카드 거래 칸의 '계약서 사본' 칸에서 올린다(2026-11-23 K-b, 아래 줄). 화면이 보내는 `rrn=1`의 뜻은 "가렸거나 번호가 없음"이다. 10MB 이하를 통째로 받아 매직 넘버와 부가 정보(JPEG은 APP0 JFIF·APP2 ICC·APP14 Adobe 밖의 APP 조각·COM·EOI 뒤 자료, WebP는 허용 밖 RIFF 조각·EXIF·XMP 깃발)를 검사한 뒤에만 R2에 넣는다. R2 키에는 이름·동·호수·원래 파일 이름을 넣지 않는다. 지우면 D1 행은 휴지통으로 옮기고 R2 객체는 영구 삭제 때 먼저 지운다(0001의 `files` 외래 키가 `ON DELETE SET NULL`이라 손님·거래 삭제 batch가 파일 행을 먼저 지워야 한다). 상세는 `docs/work-tools/` 설계서 9장.
- 손님 카드 '사진' 칸(바로 찍기 화면, 2026-11-22 사용자 선택 "이 시안대로") → 서버 요청은 `src/lib/work-files-client.ts` 한 곳, 다시 저장은 `src/lib/work-photo-dom.ts`(`createImageBitmap` `imageOrientation: "from-image"` → canvas, 원본은 늘 JPEG 0.9 → 10MB 넘으면 0.8, 미리보기는 긴 변 480px WebP 0.8 → 0.6 또는 JPEG·256KB 넘으면 미리보기 없이), 칸 화면은 `src/lib/work-photo-section.ts`, 크기·문장은 `src/lib/work/photo-view.mjs`. '바로 찍기'(`capture="environment"`)·'사진첩에서 고르기'(한 번 10장)·휴대폰 아래 막대 '사진 찍기', 올리기 단추 이름은 '신분증·주민번호 없음 확인, 올리기'. 진행 막대 없이 글로만 알리고, 못 올린 사진은 화면 메모리에만 두어 '다시 올리기'(같은 SHA-256)와 떠날 때 경고로 지킨다(로그인 만료도 다시 올리기를 남김). 설명·손님 이름은 주소·브라우저 저장소에 넣지 않고, 그림은 `blob:` 주소 없이 그린다. '사진 크게 보기'의 '얼굴 가려서 내보내기'(2026-11-23 사용자 선택 "나안: 화면 전체")는 화면 전체 창에서 이미 받아 둔 원본 그림에 네모를 그려 모자이크한 사본을 '가려서 내려받기'·'가려서 공유'로만 내보낸다(서버로 올리지 않고 원본을 다시 받지 않으며, 원본 내려받기 단추가 없고, 키보드로는 그릴 수 없다). 블록은 max(16px, 네모 짧은 변 ÷ 5) 올림이고, 네모 그리기 부품은 `src/lib/work-mask-canvas.ts`의 `openMaskEditor`(가리는 방식은 `paint`로 바꿔 끼움. 올리는 동안 칠한 곳을 못 바꾸게 하는 `setLocked`, 준비 중 그만둔 사진이 canvas를 건드리지 않게 하는 `cancelled`가 있음), 순수 함수는 `src/lib/work/mosaic.mjs`다. 켜기 값이 없으면 칸은 "파일 저장소가 아직 켜지지 않았습니다"만 보인다. 상세는 `docs/work-tools/` 설계서 경로 표 손님 카드 줄·13.1절·13.4절.
- 손님 카드 거래 칸 '계약서 사본' 칸(2026-11-23 K-b, 사용자 승인 "이대로 구현해 올림"·"두 곳 모두 이대로 올림") → 화면은 `src/lib/work-contract-copy-section.ts`, 글·크기 계산은 `src/lib/work/contract-copy-view.mjs`, 서버 요청은 `src/lib/work-files-client.ts`의 `uploadContractCopy` 한 곳. 거래마다 접어 둔 '계약서 사본 n장' 단추를 펼치면 글자 줄 목록·'계약서 찍기'·'사진첩에서 고르기'가 보이고(한 번에 한 장, 한 거래 10장), 고른 사진은 화면 전체 창에서 주민등록번호를 검게 칠한 뒤(`openMaskEditor`에 `paintBlack`) '다 가렸음, 확대해서 확인'(사진 자리 폭의 4배 또는 실제 크기, 끌어서 봄) → '주민번호 가림 확인, 올리기' 순서로 올린다. 올리기를 누르면 편집기를 잠가 끌던 네모를 버리고 끝날 때까지 칠한 곳을 못 바꾼다(화면의 가린 곳 = 올라가는 사본). 가린 곳이 0개면 한 번 더 물은 뒤 '주민번호 없음 확인, 올리기'로 올리며 이 길은 확대 확인을 거치지 않는다. 서버로 가는 것은 칠한 뒤 다시 저장한 JPEG 하나뿐이고(가리기 전 사진·파일 이름·미리보기 없음), 그림은 `blob:` 주소·브라우저 저장소·화면 주소를 쓰지 않는다. 못 올린 사본은 화면 메모리에만 두어 '다시 올리기'(같은 SHA-256)·닫기 전 확인·떠날 때 경고로 지킨다. 올린 사본 '보기'는 누를 때마다 원본을 받는다(감사 `file.download`). 자르기·기울기 보정은 없고 키보드로는 칠할 수 없다. 휴지통 화면은 파일 묶음을 '사진'·'계약서 사본'으로 가려 쓰고 거르기 이름은 '사진·계약서 사본'이다. 처리방침 6항 사진 줄에 '(주민등록번호를 가린 계약서 사본 포함)' 구절이 있다. 실기기 확인 전이다. 상세는 `docs/work-tools/` 설계서 13.2절.
- `/admin/work/paper/` → 관리자 전용 홍보 종이(보드 45번 C, 운영자 결정 2026-11-20 18:09). 서버 요청·저장 없이 화면에서만 만든다. 거래 완료 알림은 `src/lib/work/promo-paper.mjs` 순수 함수가 단지 이름·거래 종류·전용면적만 받아(가격·동·층·계약 날짜 없음, 면적은 정수로 내려 '전용 84㎡대') 글 묶음을 만들고 `src/lib/work-done-card.ts`가 1080×1350 PNG(data 주소)로 그린다. 단지 이름에 동 번호·호수·층·휴대폰 번호가 있으면 만들지 않는다. 명함(A안 흰 종이, 이메일 넣음·직함 없음)은 빌드 때 `office.json`으로 채우고 인쇄 CSS로 인쇄소용 96×56mm 2쪽(재단 3mm)·A4 10장 판 2쪽을 낸다. 사무소 명시사항 5항목의 칸 목록·빈 칸 검사·3줄은 `src/lib/work/ad-disclosure.mjs` 한 곳이고(`realprice-promo.mjs`는 다시 내보내기), 카드 공통 그리기(색·글꼴·로고·줄바꿈)는 `src/lib/work-card-draw.ts` 한 곳이다.
- `/admin/work/listing-paper/` → 관리자 전용 매물 안내지·비교표(보드 45번 D). 빌드 때 `naver-listings.json` 공개 매물만 목록으로 그리고(분양권은 까닭과 함께 잠금, 같은 분류·거래 형태끼리 최대 3건), 담은 매물마다 글 초안과 같은 명시사항 칸(`src/lib/work-disclosure-fields.ts`, 글 초안 화면도 이 파일을 씀)을 채우면 `src/lib/work/listing-paper.mjs`가 `buildDisclosure()` 값을 그대로 써 글 묶음을 만들고 `src/lib/work-listing-card.ts`가 1080×1350 PNG(1건 안내지·2 ~ 3건 비교표)를 그린다. 공동주택 필수 13항목과 사무소 5항목은 1:1로 보내는 그림에도 늘 넣고 빈 칸이 있으면 만들지 않으며, 넣은 값은 저장·서버 전송·URL·브라우저 저장소에 넣지 않는다. 최저가 표시는 없고 파일 이름에는 날짜만 넣는다.
- `/admin/work/blog/` → 관리자 전용 글 초안(단계 P3, 업무 도구 아래 단계 "글 초안", 켜기 값 `WORK_BLOG_ENABLED`). 서버 요청은 `src/lib/work-blog-client.ts` → 업무 API `blog/sources`·`limits`·`drafts` → `worker/work-blog.mjs`(OpenAI Responses 백그라운드 요청, `store: false`, 시험은 가짜 fetcher로만) → D1 `blog_drafts`·`ai_usage_daily`(마이그레이션 `0004`). 화면 문장은 `src/lib/work/blog-view.mjs`, 글 검사(입력과 다른 금액·면적·층·날짜는 해시태그까지 복사 막기)는 `src/lib/work/blog-checks.mjs`, 명시사항은 AI가 아니라 `src/lib/work/ad-disclosure.mjs`가 `src/data/work/ad-disclosure-rules.json`(빌드 전 `validateAdDisclosureRules()` 검사)으로 붙인다. 단계 3개(자료 → 명시사항 → 글 성격·만들기), 명시사항 빈 칸이면 AI를 부르지 않는다. 소재지는 D1·OpenAI·브라우저 어디에도 저장하지 않아 초안을 다시 열면 다시 넣어야 복사가 풀린다. 'AI 사용 한도'(하루 편수·월 비용 상한, 처음 값 하루 10편·월 10달러)를 저장해야 만들 수 있다. 상세는 `docs/work-tools/` 설계서 22장.
- Worker Cron(`*/10 * * * *`) → `worker/work-scheduled.mjs` → 공공데이터포털 아파트 실거래가 API 4개에서 대전 동구 자료를 10분마다 1개월 1종류씩 받아 `worker/realprice-store.mjs`가 D1 `rt_*` 표에 차이만 반영한다(단계 P, 켜기 값 `WORK_REALPRICE_ENABLED`가 없으면 D1·외부 요청 없이 끝남. 다만 한국 시각 03:00 차례에는 켜기 값과 상관없이 D1 구조 번호를 읽고, 4 이상이면 오래된 글 초안 보관 정리(P3)를 먼저 하고, 7 이상이면 7일 지난 휴지통 묶음을 100개씩 최대 10번 영구 삭제하고, 구조 번호를 읽을 수 있으면 3년 지난 감사 기록을 500줄씩 최대 4번 지운다. 차례는 Cron이 정한 `scheduledTime`으로 판정한다). 자료는 `src/data/`·`dist/`에 넣지 않는다. 상세는 `docs/work-tools/` 설계서 22장.
- Worker Cron(`* * * * *`, 2026-11-23 단계 4 첫 PR) → `worker/work-scheduled.mjs`가 `controller.cron` 글자로 나눠 `worker/work-ai-cron.mjs`만 부른다(실거래가 받기·03:00 정리는 `*/10` 예약에서만 돈다). `WORK_AI_ENABLED`가 없으면 D1·외부 요청·로그 없이 첫 줄에서 끝나고, 켜져 있으면 열린 AI 작업을 10행까지 읽어 OpenAI 상태를 조회해 결과를 D1에 옮긴다. `wrangler.jsonc`의 예약 글자와 코드 상수(`AI_POLL_CRON`)는 글자까지 같아야 한다(시험이 봄).
- 업무 API `ai/jobs`(만들기)·`ai/jobs/:groupId`(조회)·`ai/jobs/:groupId/cancel`(취소)·`ai/jobs?dealId=`(거래별 최근 묶음 5개) → `worker/work-ai-jobs.mjs` → D1 `ai_jobs`·`ai_usage_daily`(구조 번호 그대로 7) + R2 `WORK_FILES` + OpenAI Responses 백그라운드 요청(`store: false`, 시험은 가짜 fetcher로만). 단계 4 첫 PR(계약서 → 일정의 서버, 2026-11-23)이고 켜기 값 `WORK_AI_ENABLED`가 없어 꺼져 있다(503 `AI_DISABLED`, D1 쓰기·R2·OpenAI 0번). 거래에 붙은 계약서 사본(`contract_copy`, `rrn_masked` 1, JPEG·WebP) 1 ~ 5장·합계 12MB까지를 두 번 읽고(B 모델이 비면 같은 모델로 두 번), 예산은 글 초안과 같은 한도 행에서 2회 몫을 한 문장으로 예약한다. 결과는 스키마 재검사(`src/lib/work/contract-extract.mjs`)·주민등록번호 꼴 가림 뒤 `result_json`에 넣고 묶음이 끝난 뒤에만 준다(감사 `ai.view`). 확정(`/confirm`)·비교표·화면은 아직 없다. 켜기 전 할 일은 `docs/work-tools/` 진행 체크리스트 7.7절 '켜기 전' 줄, 상세는 설계서 14장.
- 휴대폰 캘린더 → `GET`·`HEAD /api/calendar/{token}.ics`(Access 밖, `run_worker_first`. HEAD는 본문 없이 같은 상태·헤더이고 `last_used_at`을 쓰지 않음) → `worker/work-calendar-feeds.mjs` → 토큰의 HMAC 해시로 D1 `calendar_feeds`를 찾아 끝나지 않은 거래 일정·날짜 있는 할 일과 날짜가 지난 30일 안인 것을 `.ics`로 준다(단계 3). 취소한 거래의 일정은 넣지 않고 그 거래에 걸린 할 일은 넣는다(2026-11-23 사용자 결정 "뺌"). 업무 도구가 꺼졌거나 `WORK_FEED_TOKEN_PEPPER`가 없거나 주소가 없으면 모두 같은 404다. 주소 만들기·목록·취소는 `/api/admin/v1/work/calendar-feeds`이고, 화면은 '계약 일정'(`/admin/work/schedule/`) 맨 아래 '휴대폰 캘린더 구독' 칸이다(서버 요청은 `src/lib/work-calendar-feeds-client.ts` 한 곳 → 문장·주소 바꾸기는 `src/lib/work/calendar-feed-view.mjs`). 이 화면은 prerender 목록에 있으므로 칸은 화면이 실제로 보인 뒤에만 서버를 부르고, 위 계산기 입력값은 여전히 서버로 보내지 않는다. 구독 주소는 만들 때 한 번만 보이고 화면 주소·브라우저 저장소에 넣지 않는다('Google 캘린더에 넣기'만 주소를 Google 사이트 주소에 실어 새 탭으로 엶). 주소를 막 만든 상태에서만 '다른 휴대폰에 넘기기'의 'iPhone용 QR 보기'(`webcal://` 주소)·'Android용 QR 보기'(Google 캘린더 주소)가 보이고, 눌러야 canvas에만 그리며(`img`·`data:`·`blob:` 없음, 요청 없음) 숨기거나 화면을 떠나면 지운다. QR은 외부 서비스·라이브러리 없이 순수 함수 `src/lib/work/qr.mjs` → `src/lib/work-qr-canvas.ts`로 만든다(실제 휴대폰 카메라 확인 전). `/api/calendar/`에는 Cloudflare 속도 제한 규칙(같은 IP 10초 5회 초과 → 10초 차단)이 걸려 있고, 요청 주소에 토큰이 있으므로 Workers 로그·추적·Logpush는 켜지 않는다. 상세는 `docs/work-tools/` 설계서 12.3절.
- 관리자 저장 화면 → `src/lib/admin-content-diff.mjs` 공개 필드 diff·민감 문자열 가림 → `src/lib/admin-content-review.ts` 변경 전후·영향 화면 확인과 dirty 이탈 경고 → 서버 사전 검증 → 최종 저장
- 관리자 저장 성공 → commit SHA·정규화 JSON SHA-256 digest·저장 시각을 브라우저에 안전하게 기억 → `/api/admin/v1/deployment-status`가 같은 Worker의 Production `deployment-marker.json`과 비교 → 공개 반영 상태 표시
- 관리자 복원 → `/api/admin/v1/content-history/:resource`에서 현재 branch 이력·과거 blob 확인 → 현재 전체 허용 JSON과 교차 검증 → `/api/admin/v1/content/restore`가 `force: false` 새 commit 생성 → 일반 배포 상태 추적. Cloudflare 전체 롤백과 혼합하지 않는다.
- `/api/admin/*` → `worker/index.mjs` → Access JWT·허용 이메일·Origin·CSRF 검증 → `POST /api/admin/v1/content/validate`는 쓰기 없이 같은 branch-tip snapshot과 전체 후보를 교차 검증 → 실제 저장은 요청된 JSON blob을 같은 base tree의 단일 commit으로 저장하고 non-force ref CAS로 갱신. WebP는 별도 허용 경로의 Contents API로 저장

공개 화면의 DB·TR 흐름은 없다. 관리자 중개업무 도구만 D1·R2를 쓰며(단계 P는 공개 실거래 자료만), 단계 2는 2026-11-22 켜졌다(사진도 같은 날 `WORK_FILES_ENABLED`로 켬, `docs/work-tools/`). 공공데이터포털은 Worker만 부르고 브라우저는 부르지 않는다. 관리 API의 콘텐츠 쓰기는 `ADMIN_WRITE_ENABLED=true`와 CSRF·GitHub Secret이 모두 있을 때만 활성화되며, 기본 로컬·Preview 설정은 fail closed다. 브라우저 JavaScript는 공개 화면의 모바일 메뉴·매물 페이징·필터·정렬·관심 ID·비교·비저장 문의 문장과 관리자 폼·WebP 변환에 사용한다. 고객 관심 상태는 공개 매물 ID만 같은 브라우저에 저장하며, 상담 입력은 `localStorage`·URL·서버 요청에 넣지 않는다.

## 공개·비공개 데이터 경계

저장소에는 공개가 승인된 정보만 둔다. 다음 정보는 소스, JSON, HTML, URL, 로그, 사이트맵에 넣지 않는다.

- 고객 연락처와 상담 내용
- 네이버 등 공개 광고 화면에 표시되지 않은 정확한 호수와 비공개 동·층 정보
- 소유자·임대인·임차인 정보
- 중개의뢰 내부 근거와 내부 메모
- 비밀번호, 토큰, API 키, 인증서, 운영 `.env`
- 신분증·등록증 원본과 사진 원본 메타데이터

`scripts/content-validation.mjs`의 금지 필드 검사를 약화하지 않는다. 단지 콘텐츠는 리더스시티 4·5블록 세대수 합계와 `external-links.json`의 공개 콘텐츠 연결도 빌드 전에 검증한다. 공개 단지의 표시 범위와 비교 범위는 혼합하지 않으며 `featuredComplexSlugs`의 준비 중 단지는 공개 파생 목록에서 제외하고 `comparisonComplexSlugs`에는 공개 단지만 둔다. 비공개 데이터가 필요해지면 JSON 필드를 추가하지 말고 DB·권한·암호화·보유기간을 별도로 설계하고 승인받는다.

## 콘텐츠 규칙

- 호수 검사는 `미분양 물량 [YYYY년 M월] 1,866호`처럼 명시적인 미분양 물량 문맥의 천 단위 쉼표 수량만 통계로 구분한다. 단독 호수·동 번호와 결합한 호수·호실·다른 민감정보는 계속 차단하며, RSS 동기화도 파일 저장 전에 공통 공개 스키마·금지 필드·민감 문자열 검사를 적용한다. 공개 연락처 예외는 같은 저장소의 `office.json`을 기준으로 한다.
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
- 외부 콘텐츠는 고유 ID·`draft|published`·게시일·자체 저장 썸네일을 사용하고, 네이버 블로그·유튜브 허용 도메인과 인스타그램 게시물 주소(`www.instagram.com`·`instagram.com`의 `/p/`·`/reel/`, 물음표·`#` 꼬리 없이)만 등록한다. 인스타그램 항목은 썸네일이 필수다. YouTube 항목은 `youtubeFormat: video|short`를 반드시 기록한다.
- 공식 RSS 동기화는 네이버 블로그 ID `p5468300`과 Repository Variable `YOUTUBE_CHANNEL_ID`의 고정 채널만 허용하고 신규 항목만 `published`로 추가한다. 기존 수동 수정값과 피드에 없는 항목, 관리자가 등록한 인스타그램 항목은 덮어쓰거나 삭제하지 않는다.
- 홈과 지역 콘텐츠는 최신순으로 정렬하고 블로그는 페이지당 9개를 표시한다. 홈의 유튜브는 일반 영상 최신 6개만 표시한다. `/youtube/`는 전체 혼합 필터 없이 일반 영상을 기본으로 `일반 영상·Shorts 보기`를 제공하고 선택 형식을 페이지당 6개씩 데스크톱 3열·태블릿 2열·모바일 1열로 표시한다. 필터를 바꾸면 1페이지로 돌아간다.
- 홈의 대표·사무소·리더스시티·신흥 SK뷰 상담 범위 설명은 `home-content.json`에서 관리한다.
- 홈 문구 칸별 최대 글자 수, 확정 공개 정보 9가지(법적 상호·브랜드명·대표·연락처·이메일·주소·등록번호·사업자등록번호·카카오톡 상담 주소) 고정, 매물 단지 표기 6가지 연결은 콘텐츠 검사(`scripts/content-validation.mjs`)가 관리자 저장 전·빌드·동기화 검증에서 같이 막는다. 확정 공개 정보를 바꿀 때는 개발 PR로 그 값과 '확정 공개 정보' 표를 함께 고친다.

## 디자인·모바일·접근성

- 360px부터 가로 넘침이 없는 모바일 우선 레이아웃을 유지한다.
- 본문은 16px 이상, 주요 터치 대상은 44×44px 이상을 기본으로 한다. 관리자 화면에만 예외가 하나 있다: 1221px 이상이고 마우스를 쓰는 PC(`@media (min-width: 1221px) and (hover: hover) and (pointer: fine)`)에서는 표 글자 13px·표 안 보조 글 12px·누르는 곳 36px까지 줄인다(사용자 승인 2026-11-23 11:12:45 "어 그렇게 해"·11:34:13 "이대로 구현"). 입력칸·주 단추·본문 글, 1220px 이하, 손가락으로 쓰는 넓은 화면은 16px·44px 그대로이고 공개 화면에는 이 예외가 없다.
- 모바일 하단 전화·문자 CTA가 콘텐츠와 safe-area를 가리지 않게 한다.
- 카카오톡 URL이 승인되기 전에는 버튼을 렌더링하지 않는다.
- 키보드 탐색, 포커스 표시, 건너뛰기 링크, 의미 있는 대체 텍스트를 보존한다.
- 색상만으로 상태를 전달하지 않고 페이지 진입 직후 자동재생과 과도한 애니메이션을 사용하지 않는다. 유튜브 카드 미리보기는 hover 가능한 정밀 포인터가 카드 전체에 0.3초 머물 때만 음소거로 한 개를 지연 로드하며, 포인터가 카드에서 벗어나면 제거한다. 모바일과 `prefers-reduced-motion` 환경에서는 실행하지 않는다.
- 홈 움직임은 `DESIGN.md` '움직임'을 따른다. 진입 때 움직이는 것은 첫 화면 매물 종이·도장 한 번(0.3초 이하, transform만)뿐이고, 아래 칸은 스크롤로 화면에 들어올 때 한 번 나타난다(스크립트가 붙은 뒤 화면 아래 칸만 숨기고, 키보드 포커스가 들어오면 즉시 보임). 단추 누름·포인터 떠오름도 transform만 쓰며, `prefers-reduced-motion`에서는 모두 끈다.
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
- 성공한 `master` push의 공개 페이지 변경은 운영 배포가 그 커밋을 포함했는지(`source.commit`이 같거나 후속 커밋) 확인한 뒤 네이버 IndexNow에 알린다. 공개키는 비밀정보가 아니며, sitemap·수집 요청을 대체하거나 색인을 보장한다고 표현하지 않는다.

## Cloudflare 배포

- `wrangler.jsonc`는 `dist/` 정적 자산과 `worker/index.mjs`를 한 Worker로 배포한다.
- `assets.run_worker_first`는 `/api/admin`, `/api/admin/*`와 캘린더 구독 `/api/calendar/*`(2026-11-22 단계 3 구독 서버)에만 적용한다. `/api/calendar/*`는 Access 애플리케이션 경로에 넣지 않는다(캘린더 앱은 로그인할 수 없음).
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
- `npm run build`는 공개 `deployment-marker.json` v2에 Workers Builds·GitHub Actions source commit/branch, 허용 관리자 JSON별 정규화 SHA-256 digest와 검색 대상·Bank·외부 콘텐츠·scheduler scope hash를 생성한다. 기존 v1 scope reader는 2026-09-30까지 호환한다. 동기화 워크플로는 push 후 해당 scope가 운영 URL과 일치할 때까지 확인하며 불일치·시간 초과를 실패로 표시한다. IndexNow 워크플로는 2026-11-19부터 scope 대신 `source.commit`이 같거나 후속 커밋인지로 확인한다(뒤 커밋이 먼저 배포돼 `search` 값이 바뀌면 앞 커밋 알림이 실패하던 문제).
- `wrangler.jsonc`의 `CF_VERSION_METADATA` binding은 인증된 관리자에게 현재 Worker version ID·생성 시각만 제공하며 Secret·태그·관리자 이메일은 반환하지 않는다.
- `wrangler.jsonc`의 `WORK_DB` D1 binding(`leaderscity-work`)과 `WORK_FILES` R2 binding(`leaderscity-work-files`)은 운영 Worker를 중개업무 도구의 업무 자료 저장소와 파일 저장소에 연결한다. 켜기 값(`WORK_TOOLS_ENABLED`·`WORK_AI_ENABLED`·`WORK_REALPRICE_ENABLED`·`WORK_BLOG_ENABLED`·`WORK_FILES_ENABLED`), 공공데이터포털 인증키 `MOLIT_RT_SERVICE_KEY`, 캘린더 구독 토큰 해시 키 `WORK_FEED_TOKEN_PEPPER`(32자 이상, 등록한 뒤 바꾸면 모든 구독 주소가 무효), OpenAI 설정은 Worker Secret으로만 등록한다. `WORK_BLOG_ENABLED`는 OpenAI 설정을 먼저 넣은 뒤 켠다(켜기 값만 있고 설정이 빠지면 업무 세션이 503 `BLOG_CONFIG_MISSING`이라 실거래가 화면도 함께 막힌다). 계약서 AI 작업용 `WORK_AI_ENABLED`는 아직 등록하지 않았고, 진행 체크리스트 7.7절 '켜기 전' 줄을 모두 끝낸 뒤 사용자 승인을 받아 마지막에 등록한다.
- `wrangler.jsonc`의 `triggers.crons`는 2개다(2026-11-23부터). `* * * * *`는 단계 4 AI 작업 조회이며 `WORK_AI_ENABLED`가 없으면 D1·외부 요청 없이 끝난다(Worker가 한 달에 약 43,200번 더 깨어남). `*/10 * * * *`는 단계 P 실거래가 받기이며, 켜기 값이 없으면 D1·외부 요청 없이 끝난다. `*/10` 예약의 한국 시각 03:00 차례만은 켜기 값과 상관없이 글 초안 보관 정리(P3), 7일 지난 휴지통 영구 삭제, 3년 지난 감사 기록 삭제를 위해 D1을 읽고 쓴다(구조 번호가 4보다 낮으면 글 초안은 읽기만, 휴지통은 7 이상일 때, 감사 기록은 구조 번호를 읽을 수 있을 때).
- 계정은 2026-11-23부터 Workers Paid(월 5달러)다. D1 하루 한도로 멈추지는 않지만 월 포함량(쓰기 5,000만 행·읽기 250억 행)을 넘으면 쓴 만큼 요금이 붙고, Wrangler·대시보드에서 친 쿼리도 센다. 무료였던 2026-11-22에는 복원 훈련의 원격 넣기 109,682행으로 계정 하루 쓰기 10만 행을 넘겨 다음 09:00 KST까지 운영 D1 쓰기가 막혔다(읽기는 됨, `docs/work-tools/` 설계서 8.10절). 그래서 큰 백업 넣기 같은 대량 쓰기는 `--local` D1에서 하고, 원격 대량 쓰기는 먼저 `wrangler d1 info <이름>`의 `rows_written_24h`로 양을 보고 사용자에게 묻는다.
- `.github/workflows/verify-production-deploy.yml`은 `master` push마다 `contents: read` 권한과 비밀값 없이 실행한다. 운영 `/deployment-marker.json`의 `source.commit`이 push 커밋과 같거나, push 커밋을 포함한 `master`의 후속 커밋이 될 때까지 10초 간격으로 최대 30분 확인하고, 시간이 지나면 실패로 끝나 GitHub 실패 알림을 남긴다. Cloudflare 알림(Platform Notifications)에는 Workers Builds 실패 항목이 없어 이 방식으로 빌드 실패·미실행을 감지한다. Workers Builds의 빌드 감시 경로는 포함 `*`, 제외 `node_modules/**`·`.git/`이고 프리뷰 브랜치 빌드는 꺼져 있다(2026-11-16 대시보드 확인). 따라서 `master`에 커밋되는 변경은 모두 Production 빌드를 시작해야 하며, 감시 경로를 바꾸면 이 워크플로가 거짓 실패를 낼 수 있으므로 함께 검토한다. 배포·롤백·재실행은 하지 않는다. `GITHUB_TOKEN`으로 push하는 동기화 커밋에서는 GitHub 정책상 실행되지 않으며, 동기화 워크플로는 자체 scope marker를 확인한다. 후속 커밋 판정의 `git fetch`는 자격 증명 없이 하므로 저장소를 비공개로 바꾸면 이 워크플로를 다시 설계한다.
- 기존 Cloudflare Pages 프로젝트 `real-estate-website`는 운영 도메인 연결 없이 롤백용으로 유지한다. Production 분기 `master`만 `https://real-estate-website-dnv.pages.dev`에 자동 배포하고, 2026-11-16부터 미리보기 브랜치 배포는 "없음"으로 꺼 두었다(이미 만들어진 미리보기 배포는 남아 있음). 이 사본을 운영 경로나 관리자 화면 접속에 쓰지 않는다. 2026-11-16부터 사본 주소 전체(`real-estate-website-dnv.pages.dev`와 미리보기 주소 `*.real-estate-website-dnv.pages.dev`)는 Cloudflare Access 앱 2개로 막아, 운영 관리자와 같은 재사용 정책(허용 이메일 2개, One-time PIN)으로 로그인해야만 열린다. 되돌리려면 두 앱을 지우고 Pages "프리뷰 제한"을 끈다.
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
- 관리 API 환경은 `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_WRITE_ENABLED`, `ADMIN_ALLOWED_ORIGINS`, `ADMIN_CSRF_SECRET`, `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`를 사용한다. `ADMIN_ALLOWED_ORIGINS` 미설정 시 운영 원점 `https://leaderscityhappy.com`만 관리자 쓰기를 허용한다. 업무 도구는 여기에 `WORK_TOOLS_ENABLED`·`WORK_AI_ENABLED`·`WORK_REALPRICE_ENABLED`·`WORK_BLOG_ENABLED`·`WORK_FILES_ENABLED`·`MOLIT_RT_SERVICE_KEY`(Secret), 캘린더 구독 `WORK_FEED_TOKEN_PEPPER`(Secret)와 글 초안·계약서 AI 작업용 `OPENAI_API_KEY`(Secret)·`OPENAI_MODEL`·`OPENAI_MODEL_BLOG`·`OPENAI_REASONING_EFFORT`·`OPENAI_MAX_OUTPUT_TOKENS`·`OPENAI_PRICES_JSON`과 계약서 AI 작업용 `OPENAI_MODEL_CONTRACT_A`·`OPENAI_MODEL_CONTRACT_B`·`OPENAI_IMAGE_DETAIL`(`high`·`original`만, 기본값 없음)을 더 쓴다(모두 Worker Secret으로 등록).
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
