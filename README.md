# 대전 동구 행복한부동산 홈페이지

Astro가 정적 HTML을 만들고 Cloudflare Workers Static Assets로 제공하는 공개 홈페이지입니다. 같은 Worker의 `/api/admin/*`에는 Cloudflare Access로 보호되는 관리 API가 있으며, Production은 승인된 관리자만 GitHub `master`에 공개 콘텐츠를 저장할 수 있도록 운영 쓰기가 활성화되어 있습니다. `master` 변경은 Cloudflare Git 연결을 통해 자동 배포됩니다.

## 시작하기

요구 환경: Node.js 22.12 이상, npm

```bash
npm install
npm run dev
```

기본 개발 주소는 `http://localhost:4321`입니다.

## 검사와 빌드

```bash
npm test
npm run check
npm run build
```

빌드 결과는 `dist/`에 생성됩니다. `npm run check`는 Astro·TypeScript 검사와 공개 콘텐츠 검증을 함께 실행합니다. 빌드는 검색 대상·자동 동기화 결과의 Production 반영 여부를 확인하기 위한 `dist/deployment-marker.json`도 생성합니다. CI는 기본 `noindex` 빌드와 별도로 실제 Production 환경변수 빌드를 만들고 robots·canonical·sitemap·JSON-LD·IndexNow 공개키를 검사합니다.

공식 네이버 블로그 RSS와 YouTube Atom의 신규 항목은 매시간 17분 예약 실행과 필요 시 수동 실행이 가능한 별도 워크플로로 동기화합니다. YouTube는 Atom alternate URL을 기준으로 일반 영상과 Shorts를 구분하며, 로컬 dry-run은 공개 YouTube channelId를 설정한 뒤 실행하고 파일을 바꾸지 않습니다.

한 출처의 네트워크·429·5xx 같은 일시 장애는 최대 3회 재시도 후 경고와 함께 건너뛰고 정상 출처만 동기화합니다. 현재 공식 YouTube Atom 주소의 404도 같은 방식으로 처리하지만, 승인 channelId 불일치·XML 파싱·ID 충돌·재시도 대상이 아닌 HTTP 오류는 전체 실행을 실패시킵니다. 두 출처를 모두 조회하지 못한 경우에도 실패합니다.

```powershell
$env:YOUTUBE_CHANNEL_ID = "UCuOZDnM5vxOZELDgu-y-hNg"
npm run sync:external:dry-run
```

GitHub Actions의 `Sync external content`는 Repository Variable `YOUTUBE_CHANNEL_ID`를 사용해 매시간 17분에 실행되며, `master`에서 `workflow_dispatch` 수동 실행도 지원합니다. 수집·의존성 실행·검사는 읽기 권한 job에서 수행하고, 검증 산출물을 적용하는 별도 job만 push 단계에서 쓰기 권한을 사용합니다. push 후 공개 deployment marker가 일치할 때까지 확인하며 시간 안에 반영되지 않으면 Action을 실패로 표시합니다. 자세한 운영·장애 확인 절차는 `docs/operations/CONTENT_GUIDE.md`를 확인합니다.

부동산뱅크 공개 사무소 매물은 2026-08-26 1:1 문의로 허용된 본인 매물·하루 1회 범위에서 매일 00:10 KST 자동 동기화합니다. 부동산뱅크 목록의 신규·변경 매물은 반영하고, 직전 부동산뱅크 기준선에서 사라진 매물은 삭제하지만 다른 공급처에서 등록한 네이버 매물은 유지합니다. 네이버 페이지나 로그인 영역은 조회하지 않습니다.

```bash
npm run sync:bank:dry-run
```

실행 범위와 장애 시 중단 조건은 `docs/operations/BANK_LISTING_SYNC.md`에 정리되어 있습니다.

## 운영자가 수정하는 파일

| 파일 | 용도 |
|---|---|
| `src/data/home-content.json` | 홈 대표·리더스시티 현장 사진·지역 설명 문구 |
| `src/data/office.json` | 법적 상호·대표·연락처·주소·네이버 등록 매물 등 외부 채널 |
| `src/data/listings.json` | 공개 승인 매물 |
| `src/data/naver-listings.json` | 네이버에 공개된 개별 매물번호·동·광고 층수·가격·면적과 상세 링크 |
| `src/data/complexes-overview.json` | 리더스시티 4·5블록 전체 소개·숫자 카드·비교표·공통 확인사항·관련 콘텐츠 |
| `src/data/complexes.json` | 대전 동구 주요 단지 사진·기본 사실·생활 특징·출처 |
| `src/data/external-links.json` | 공식 블로그·유튜브 전체 링크와 RSS에서 검증된 신규 항목, 자체 저장 썸네일(최신순·블로그 9개·유튜브 6개 단위 페이지) |
| `src/data/faq.json` | 승인된 FAQ |
| `src/data/reviews.json` | 실제 여부와 공개 동의가 확인된 후기 |

공식 로고 원본은 `public/images/brand/leaders-city-happy-logo.png`, 화면용 최적화본은 `public/images/brand/leaders-city-happy-logo.webp`에 있습니다. 원본을 교체한 뒤 `node scripts/optimize-brand-logo.mjs`를 실행하면 화면용 WebP를 다시 만들 수 있습니다.

고객 연락처·상담 내용·네이버 등 공개 광고에 없는 정확한 호수·내부 메모·비밀키는 저장하지 않습니다. 네이버 공개 카드의 동 번호와 광고 층수는 같은 매물번호의 외부 링크와 함께 표시합니다. 사진은 공개 권한과 개인정보를 확인하고 EXIF·GPS를 제거한 최적화본만 `public/images/`에 둡니다.

단지 전체 안내와 블록별 면적·공급·생활환경·시설 상태·FAQ는 분리해 관리합니다. `npm run check`는 4블록 1,328세대, 5블록 분양 1,423세대·공공임대 712세대와 전체 3,463세대 합계, 출처 메타데이터, 연결된 공개 콘텐츠 ID를 검증합니다. 주차대수·정확한 사용승인일·현재 시설 운영처럼 확인이 남은 값은 확정값으로 입력하지 않습니다.

## 검색 노출 설정

기본값은 안전하게 `noindex`입니다. 실제 도메인과 공개 정보 검수가 끝난 Production 환경에서만 다음 환경변수를 설정합니다.

```text
PUBLIC_SITE_URL=https://실제도메인
PUBLIC_ALLOW_INDEXING=true
```

Google·네이버 소유 확인 파일은 제공받은 파일명과 내용을 바꾸지 않고 `public/` 루트에 추가합니다. 자세한 절차는 `docs/operations/SEARCH_REGISTRATION.md`를 확인합니다.

홈을 제외한 공개 HTML에는 경로 계층을 나타내는 `BreadcrumbList` JSON-LD를 제공합니다. `master`의 CI가 성공하면 `.github/workflows/notify-indexnow.yml`이 변경 파일과 Production sitemap을 기준으로 관련 URL만 고르고, Cloudflare의 `search` 배포 marker와 공개 검증키가 확인된 뒤 네이버 IndexNow에 알립니다. 공개키는 인증 비밀값이 아니며 저장소에 포함합니다. IndexNow는 sitemap·수집 요청을 대체하거나 실제 색인을 보장하지 않습니다.

홈은 `WebSite`와 승인된 `RealEstateAgent`·`LocalBusiness` 정보를 고정 ID로 연결하고 네이버 플레이스·공식 블로그·공식 YouTube 채널을 동일 사업자 채널로 제공합니다. 관례적인 `/sitemap.xml` 요청은 공식 `/sitemap-index.xml`로만 301 이동하며, 그 밖의 존재하지 않는 경로는 정상 404를 유지합니다.

## Cloudflare 배포

```bash
npm run deploy
```

GitHub 자동 배포 연결과 Production 설정은 `docs/operations/CLOUDFLARE_DEPLOY.md`에 정리되어 있습니다. 현재 Production 이외 브랜치 빌드는 비활성화되어 있으므로 공개 전 승인은 로컬 화면과 PR CI 결과로 수행하고, Production 반영 뒤 공개 화면을 다시 확인합니다.

## 관리자 콘텐츠 관리

- 공개 정적 페이지와 관리 API를 Worker 하나로 배포합니다.
- `/api/admin`과 `/api/admin/*`만 Worker 코드를 먼저 실행합니다.
- 인증은 Cloudflare Access, 정확한 허용 이메일 2개와 Email OTP를 사용합니다.
- Worker가 `Cf-Access-Jwt-Assertion`의 서명, issuer, audience와 이메일을 다시 검증합니다.
- 부동산뱅크 공개 매물은 하루 1회 자동 동기화하고 `/admin/listings/editor/`의 `.xls` 가져오기는 장애·형식 변경 시 수동 보완 경로로 유지합니다. 그 밖의 네이버 매물은 직접 등록·수정·등록 종료할 수 있으며 원본 엑셀은 서버로 전송하지 않습니다.
- `/admin/content/`에서 첫 화면 대표·사무소·리더스시티 설명을 수정할 수 있습니다.
- `/admin/external-links/`에서 블로그·유튜브 링크, 요약, 공개 상태와 썸네일을 관리합니다. 링크 썸네일을 못 불러오면 직접 사진을 올릴 수 있습니다.
- `/admin/complexes/`에서 대전 동구 지역·단지 설명과 출처·확인일을 관리합니다.
- 저장 기능은 `ADMIN_WRITE_ENABLED=true`, 32자 이상의 `ADMIN_CSRF_SECRET`, 저장소 한 개로 제한된 `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`가 모두 있어야 활성화됩니다.
- Worker는 `ADMIN_ALLOWED_ORIGINS`의 정확한 HTTPS origin, 요청 URL origin, JSON Content-Type·만료되는 CSRF 토큰·콘텐츠 스키마를 검증합니다. JSON 저장 시 허용된 전체 리소스를 하나의 Git branch-tip commit/tree에서 읽고, 단일 변경은 기존 `/api/admin/v1/content/:resource`, 복수 변경은 `/api/admin/v1/content`에서 모든 후보를 함께 교차 검증합니다. 요청된 모든 blob SHA가 일치할 때만 같은 base tree에 하나 이상의 blob을 넣은 단일 commit을 만든 뒤 `force: false`로 branch ref를 갱신합니다. 미설정 기본값은 `https://leaderscityhappy.com`이며, 추가 origin은 쉼표로 구분하되 wildcard·경로·쿼리·userinfo·HTTP는 허용하지 않습니다.
- 이미지 파일은 브라우저에서 WebP·최대 1600px로 변환해 EXIF를 제거하고 `public/images/content/`의 허용 경로에만 저장합니다.

로컬 Worker 변수 예시는 `.dev.vars.example`을 참고합니다. 실제 이메일, Audience와 Access 팀 정보는 `.dev.vars` 또는 Cloudflare Secret에만 입력하고 커밋하지 않습니다.
