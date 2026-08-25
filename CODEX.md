# CODEX.md

## 프로젝트 개요

이 저장소는 대전 동구 천동·신흥동, 리더스시티 4블록·5블록을 중심으로 운영하는 `리더스시티행복한공인중개사사무소`의 공개 홈페이지다.

- Astro가 정적 HTML을 생성한다.
- GitHub를 코드·공개 콘텐츠 저장소로 사용한다.
- Cloudflare Workers Static Assets로 배포한다.
- 초기 버전에는 DB, 서버 API, 관리자 로그인, 자체 상담 폼을 두지 않는다.
- 운영자는 승인된 JSON·사진 파일을 직접 수정하고 GitHub에 반영한다.
- 전화·문자·공식 외부 채널로 상담을 연결한다.

사용자 또는 운영자의 최신 명시적 지시가 이 문서보다 우선한다. 미확정 정보는 추정해서 공개하지 않는다.

## 먼저 읽을 파일

작업 전 다음 순서로 실제 코드를 확인한다.

1. `CODEX.md`
2. `01_천동_리더스시티_행복한부동산_서비스기획서.md`
3. `02_천동_리더스시티_행복한부동산_시스템설계서.md`
4. `03_천동_리더스시티_행복한부동산_개발진행체크리스트.md`
5. `README.md`
6. 변경 대상과 연결된 `src/`, `scripts/`, `tests/`, `docs/operations/` 파일

작업 시작 전 관련 파일, 호출 흐름, 영향 범위를 확인하고 실제 코드 기준으로 판단한다.

## 확정 공개 정보

| 항목 | 값 |
|---|---|
| 법적 상호 | 리더스시티행복한공인중개사사무소 |
| 대표 | 백진옥 |
| 연락처 | 010-2790-8675 |
| 주소 | 대전광역시 동구 안샘로14번길 7, 리더스시티5블록 근린생활시설 105호 |
| 중개사무소 등록번호 | 30110-2023-00028 |
| 핵심 권역 | 천동·신흥동, 리더스시티 4블록·5블록 |

브랜드명 최종 문구, 대표 약력, 사업자등록번호, 이메일, 영업시간, 휴무일, 주차, 카카오톡, 로고, 사진, 실제 도메인, 단지 수치, 매물과 후기는 운영자 승인 전 확정하지 않는다.

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
├─ docs/operations/    콘텐츠·배포·검색 등록 절차
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

- `src/data/office.json` → `src/lib/site.ts` → 헤더·푸터·사무소·오시는 길·구조화 데이터
- `src/data/listings.json` → `src/lib/listings.ts` → 매물 목록 필터와 공개 상세 정적 생성
- `src/data/complexes.json` → 단지 목록과 4블록·5블록 상세 정적 생성
- `src/data/external-links.json` → 공식 블로그·유튜브 콘텐츠 허브
- `src/layouts/BaseLayout.astro` → 페이지별 title, description, canonical, robots, JSON-LD
- `src/pages/robots.txt.ts`, `llms.txt.ts`, sitemap integration → 검색 로봇 안내

서버 통신, TR, DB, 인증 흐름은 없다. 브라우저에서 실행되는 JavaScript는 모바일 메뉴와 매물 필터 같은 점진적 기능에만 사용한다.

## 공개·비공개 데이터 경계

저장소에는 공개가 승인된 정보만 둔다. 다음 정보는 소스, JSON, HTML, URL, 로그, 사이트맵에 넣지 않는다.

- 고객 연락처와 상담 내용
- 정확한 동·호수
- 소유자·임대인·임차인 정보
- 중개의뢰 내부 근거와 내부 메모
- 비밀번호, 토큰, API 키, 인증서, 운영 `.env`
- 신분증·등록증 원본과 사진 원본 메타데이터

`scripts/content-validation.mjs`의 금지 필드 검사를 약화하지 않는다. 비공개 데이터가 필요해지면 JSON 필드를 추가하지 말고 DB·권한·암호화·보유기간을 별도로 설계하고 승인받는다.

## 콘텐츠 규칙

- `published` 매물만 공개 목록·상세·사이트맵에 생성한다.
- 공개 매물에는 고유 ID·slug, 거래유형, 가격, 전용면적, 출처, 확인일을 입력한다.
- 매매는 매매가만, 전세는 보증금만, 월세는 보증금과 월 임대료만 입력한다.
- 금액은 원 단위 정수, 면적은 ㎡로 저장한다.
- 사진·후기·대표 약력·단지 수치는 출처와 공개 승인을 확인한다.
- 승인 콘텐츠가 없으면 가짜 샘플을 만들지 않고 빈 상태 또는 준비 중으로 표시한다.
- 외부 글·영상의 원문이나 권한 없는 이미지를 복제하지 않고 짧은 설명과 원문 링크를 쓴다.

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
- `llms.txt`는 보조 안내 파일이며 검색·AI 인용을 보장한다고 표현하지 않는다.
- Google Search Console과 네이버 Search Advisor의 소유 확인 파일은 원본 이름과 내용을 유지해 `public/`에 둔다.
- 실제 검색 등록과 색인 요청은 배포·도메인·운영자 공개 검수 후 수행한다.

## Cloudflare 배포

- `wrangler.jsonc`는 `dist/`를 정적 자산으로 배포하며 Worker 서버 코드를 사용하지 않는다.
- GitHub CI는 `npm ci`, `npm test`, `npm run build`를 실행한다.
- GitHub와 Cloudflare 계정 연결, Production/Preview 환경변수, 사용자 도메인 DNS는 외부 운영 작업이다.
- 실제 배포 전 `npx wrangler deploy --dry-run`과 Production 환경변수 빌드를 확인한다.
- 잘못된 배포는 직전 정상 Cloudflare 배포로 롤백하거나 Git revert 후 재배포한다.

## 조건부 컴파일·인코딩·리소스

- C/C++식 조건부 컴파일 매크로는 없다.
- 환경 분기는 `PUBLIC_SITE_URL`, `PUBLIC_ALLOW_INDEXING`만 사용하고 새 분기는 문서화한다.
- 소스와 콘텐츠는 UTF-8, LF, 2칸 들여쓰기를 따른다.
- 공개 사진은 권한과 개인정보를 확인하고 EXIF·GPS를 제거한 WebP/AVIF 최적화본을 우선한다.
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
