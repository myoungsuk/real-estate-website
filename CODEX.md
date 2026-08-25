# CODEX.md

## 프로젝트 개요

이 저장소는 대전 동구 전역을 전문 지역으로 운영하며, 천동 리더스시티5블록 단지 내 상가에 있는 `리더스시티행복한공인중개사사무소`의 공개 홈페이지다.

- Astro가 정적 HTML을 생성한다.
- GitHub를 코드·공개 콘텐츠 저장소로 사용한다.
- Cloudflare Workers Static Assets와 관리 API를 같은 Worker로 배포한다.
- `/api/admin/*`만 Worker 코드가 먼저 처리하고 나머지 공개 요청은 정적 자산으로 제공한다.
- 관리 API는 Cloudflare Access, 허용 이메일 2개, Email OTP와 JWT 재검증으로 보호한다.
- 초기 버전에는 DB, 자체 비밀번호, 서버 저장형 상담 게시판을 두지 않는다. FAQ 상담 작성 화면은 입력값을 저장하지 않고 이용자의 문자 앱으로만 전달한다.
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
├─ scripts/            빌드 전 콘텐츠 검증
├─ tests/              Node 단위 테스트
├─ worker/             동일 Worker의 Access 검증·관리 API
├─ docs/operations/    콘텐츠·배포·검색 등록 절차
├─ docs/adr/           승인된 아키텍처 결정
├─ .github/workflows/  GitHub CI
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
```

- `npm run check`: 공개 콘텐츠 검증 후 Astro·TypeScript 검사
- `npm run build`: 검사 후 `dist/` 정적 산출물 생성
- `npm run deploy`: 검사·빌드 후 Wrangler로 Cloudflare 배포
- 실제 검색 공개 빌드: `PUBLIC_SITE_URL`과 `PUBLIC_ALLOW_INDEXING=true`를 함께 설정

`PUBLIC_ALLOW_INDEXING=true`인데 `PUBLIC_SITE_URL`이 없으면 빌드를 실패시킨다. Preview와 로컬 기본값은 `noindex`다.

## 핵심 모듈과 화면 흐름

- `src/data/home-content.json` → `src/lib/content.ts` → 홈 대표·사무소·리더스시티 설명과 사진
- `src/data/office.json` → `src/lib/site.ts` → 헤더·푸터·사무소·오시는 길·네이버 등록 매물 링크·구조화 데이터
- `src/data/listings.json` → `src/lib/listings.ts` → 매물 목록 필터와 공개 상세 정적 생성
- `src/data/naver-listings.json` → `src/lib/naver-listings.ts` → 사진 없는 네이버 공개 매물 카드·홈 6건 단위 페이징·거래/유형 필터·가격/최신/면적 정렬·외부 상세 링크
- `src/data/complexes.json` → 대전 동구 주요 단지의 사진·기본 사실·생활 특징·복수 출처와 목록·상세 정적 생성
- `src/data/external-links.json` → 2024~2026년 공식 블로그 128건과 공식 유튜브 영상 40건의 원문 링크·자체 썸네일·최신순 카드
- `src/layouts/BaseLayout.astro` → 페이지별 title, description, canonical, robots, JSON-LD
- `src/pages/robots.txt.ts`, `llms.txt.ts`, sitemap integration → 검색 로봇 안내
- `/admin/` → 관리자 대시보드와 관리 API 연결 상태
- `/admin/listings/`, `/admin/listings/editor/` → 네이버 공개 매물 현황·검색·유형 필터와 네이버 매물 관리 화면 연결. 자체 매물 등록·수정 폼은 제공하지 않는다.
- `/blog/`, `/youtube/` → 지역 콘텐츠를 원문 종류별로 분리한 공개 목록과 페이지 탐색
- `/faq/` → 승인된 FAQ와 서버에 저장하지 않는 문자 상담 작성 화면
- `/admin/content/` → 홈 대표·사무소·리더스시티 설명과 대표 사진
- `/admin/external-links/` → 네이버 블로그·유튜브를 분리한 관리 카테고리, 카테고리별 건수·검색·링크 미리보기·썸네일
- `/admin/complexes/` → 대전 동구 지역·단지 소개·사진·사실·생활 특징·복수 출처·확인일
- `/api/admin/*` → `worker/index.mjs` → Access JWT·허용 이메일·Origin·CSRF·콘텐츠·SHA 검증 → 허용 GitHub JSON·WebP 저장

DB와 TR 흐름은 없다. 관리 API의 콘텐츠 쓰기는 `ADMIN_WRITE_ENABLED=true`와 CSRF·GitHub Secret이 모두 있을 때만 활성화되며, 기본 로컬·Preview 설정은 fail closed다. 브라우저 JavaScript는 공개 화면의 모바일 메뉴·매물 페이징·필터·정렬·문자 앱 연결과 관리자 폼·WebP 변환에 사용한다.

## 공개·비공개 데이터 경계

저장소에는 공개가 승인된 정보만 둔다. 다음 정보는 소스, JSON, HTML, URL, 로그, 사이트맵에 넣지 않는다.

- 고객 연락처와 상담 내용
- 네이버 등 공개 광고 화면에 표시되지 않은 정확한 호수와 비공개 동·층 정보
- 소유자·임대인·임차인 정보
- 중개의뢰 내부 근거와 내부 메모
- 비밀번호, 토큰, API 키, 인증서, 운영 `.env`
- 신분증·등록증 원본과 사진 원본 메타데이터

`scripts/content-validation.mjs`의 금지 필드 검사를 약화하지 않는다. 비공개 데이터가 필요해지면 JSON 필드를 추가하지 말고 DB·권한·암호화·보유기간을 별도로 설계하고 승인받는다.

## 콘텐츠 규칙

- `published` 매물만 공개 목록·상세·사이트맵에 생성한다.
- 공개 매물에는 고유 ID·slug, 동구 내 동네, 거래유형, 가격, 전용면적, 출처, 확인일을 입력한다.
- 네이버 외부 매물 카드는 네이버에 공개된 매물번호·동 번호·광고 층수·가격·면적·방향·확인일만 `naver-listings.json`에 기록하고, 각 카드가 같은 매물번호의 `fin.land.naver.com/articles/` 주소로 연결되어야 한다.
- 네이버 공개 카드에 없는 정확한 호수나 고객·소유자 정보는 추가하지 않는다. 공개 동 번호와 광고 층수는 그대로 표시할 수 있다.
- 매물 대표 이미지는 `thumbnail`, 상세 이미지는 `images`에 자체 `/images/` 경로와 대체 텍스트로 저장한다.
- 매매는 매매가만, 전세는 보증금만, 월세는 보증금과 월 임대료만 입력한다.
- 금액은 원 단위 정수, 면적은 ㎡로 저장한다.
- 사진·후기·대표 약력·단지 수치는 출처와 공개 승인을 확인한다.
- 승인 콘텐츠가 없으면 가짜 샘플을 만들지 않고 빈 상태 또는 준비 중으로 표시한다.
- 외부 글·영상의 원문이나 권한 없는 이미지를 복제하지 않고 짧은 설명과 원문 링크를 쓴다.
- 외부 콘텐츠는 고유 ID·`draft|published`·게시일·자체 저장 썸네일을 사용하고, 네이버 블로그·유튜브 허용 도메인만 등록한다.
- 홈과 지역 콘텐츠는 최신순으로 정렬하고 블로그는 페이지당 9개, 유튜브는 페이지당 6개를 데스크톱 3열·태블릿 2열·모바일 1열로 표시한다.
- 홈의 대표·사무소·리더스시티 설명은 `home-content.json`에서 관리한다.

## 디자인·모바일·접근성

- 360px부터 가로 넘침이 없는 모바일 우선 레이아웃을 유지한다.
- 본문은 16px 이상, 주요 터치 대상은 44×44px 이상을 기본으로 한다.
- 모바일 하단 전화·문자 CTA가 콘텐츠와 safe-area를 가리지 않게 한다.
- 카카오톡 URL이 승인되기 전에는 버튼을 렌더링하지 않는다.
- 키보드 탐색, 포커스 표시, 건너뛰기 링크, 의미 있는 대체 텍스트를 보존한다.
- 색상만으로 상태를 전달하지 않고 자동재생과 과도한 애니메이션을 사용하지 않는다.
- UI 변경 후 360·390·430·768·1280px과 실제 Android Chrome·iPhone Safari를 구분해 검증 결과를 보고한다.

## SEO·검색 노출

- 각 공개 페이지에 고유 title, description, canonical을 둔다.
- 승인된 실제 정보만 구조화 데이터에 넣는다.
- sitemap과 robots.txt를 제공한다.
- 필터 쿼리, 초안, 종료 매물, Preview는 색인 대상에서 제외한다.
- 관리자 화면은 sitemap과 `llms.txt`에서 제외하고 `noindex`, `no-store`를 적용한다.
- `llms.txt`는 보조 안내 파일이며 검색·AI 인용을 보장한다고 표현하지 않는다.
- Google Search Console과 네이버 Search Advisor의 소유 확인 파일은 원본 이름과 내용을 유지해 `public/`에 둔다.
- 실제 검색 등록과 색인 요청은 배포·도메인·운영자 공개 검수 후 수행한다.

## Cloudflare 배포

- `wrangler.jsonc`는 `dist/` 정적 자산과 `worker/index.mjs`를 한 Worker로 배포한다.
- `assets.run_worker_first`는 `/api/admin`과 `/api/admin/*`에만 적용한다.
- Static Assets 라우터는 `ctx.access`를 전달하지 않으므로 관리 API가 `Cf-Access-Jwt-Assertion`을 `jose`로 다시 검증한다.
- Access 정책은 정확한 허용 이메일 2개와 Email OTP를 사용한다.
- `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`는 Production 환경에 등록하고 실제 값을 저장소에 넣지 않는다.
- GitHub CI는 `npm ci`, `npm test`, `npm run build`를 실행한다.
- GitHub와 Cloudflare 계정 연결, Production/Preview 환경변수, 사용자 도메인 DNS는 외부 운영 작업이다.
- 실제 배포 전 `npx wrangler deploy --dry-run`과 Production 환경변수 빌드를 확인한다.
- 잘못된 배포는 직전 정상 Cloudflare 배포로 롤백하거나 Git revert 후 재배포한다.

## 조건부 컴파일·인코딩·리소스

- C/C++식 조건부 컴파일 매크로는 없다.
- 공개 빌드 환경 분기는 `PUBLIC_SITE_URL`, `PUBLIC_ALLOW_INDEXING`을 사용한다.
- 관리 API 환경은 `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_WRITE_ENABLED`, `ADMIN_CSRF_SECRET`, `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`를 사용한다.
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
