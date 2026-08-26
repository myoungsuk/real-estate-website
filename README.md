# 대전 동구 행복한부동산 홈페이지

Astro가 정적 HTML을 만들고 Cloudflare Workers Static Assets로 제공하는 공개 홈페이지입니다. 같은 Worker의 `/api/admin/*`에는 Cloudflare Access로 보호되는 관리 API 기반이 있으며, GitHub 저장 연결은 구현되어 있지만 평상시 콘텐츠 쓰기는 차단합니다. GitHub 변경의 자동 배포는 Cloudflare Git 연결을 완료한 뒤 동작합니다.

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

빌드 결과는 `dist/`에 생성됩니다. `npm run check`는 Astro·TypeScript 검사와 공개 콘텐츠 검증을 함께 실행합니다.

공식 네이버 블로그 RSS와 YouTube Atom의 신규 항목은 별도 수동 워크플로로 동기화합니다. YouTube는 Atom alternate URL을 기준으로 일반 영상과 Shorts를 구분하며, 로컬 dry-run은 공개 YouTube channelId를 설정한 뒤 실행하고 파일을 바꾸지 않습니다.

한 출처의 네트워크·429·5xx 같은 일시 장애는 최대 3회 재시도 후 경고와 함께 건너뛰고 정상 출처만 동기화합니다. 현재 공식 YouTube Atom 주소의 404도 같은 방식으로 처리하지만, 승인 channelId 불일치·XML 파싱·ID 충돌·재시도 대상이 아닌 HTTP 오류는 전체 실행을 실패시킵니다. 두 출처를 모두 조회하지 못한 경우에도 실패합니다.

```powershell
$env:YOUTUBE_CHANNEL_ID = "UCuOZDnM5vxOZELDgu-y-hNg"
npm run sync:external:dry-run
```

GitHub Actions의 `Sync external content`는 1차 운영 검증 단계에서 `workflow_dispatch`만 지원합니다. Repository Variable `YOUTUBE_CHANNEL_ID`를 등록한 뒤 `master`에서 수동 실행하며, 실제 신규 콘텐츠 커밋과 Cloudflare Production 반영이 확인되기 전에는 예약 실행을 추가하지 않습니다. 자세한 절차는 `docs/operations/CONTENT_GUIDE.md`를 확인합니다.

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

## Cloudflare 배포

```bash
npm run deploy
```

GitHub 자동 배포 연결과 Production 설정은 `docs/operations/CLOUDFLARE_DEPLOY.md`에 정리되어 있습니다.

## 관리자 콘텐츠 관리

- 공개 정적 페이지와 관리 API를 Worker 하나로 배포합니다.
- `/api/admin`과 `/api/admin/*`만 Worker 코드를 먼저 실행합니다.
- 인증은 Cloudflare Access, 정확한 허용 이메일 2개와 Email OTP를 사용합니다.
- Worker가 `Cf-Access-Jwt-Assertion`의 서명, issuer, audience와 이메일을 다시 검증합니다.
- `/admin/listings/editor/`에서 매물을 등록·수정하고 대표 이미지를 올릴 수 있습니다.
- `/admin/content/`에서 첫 화면 대표·사무소·리더스시티 설명을 수정할 수 있습니다.
- `/admin/external-links/`에서 블로그·유튜브 링크, 요약, 공개 상태와 썸네일을 관리합니다. 링크 썸네일을 못 불러오면 직접 사진을 올릴 수 있습니다.
- `/admin/complexes/`에서 대전 동구 지역·단지 설명과 출처·확인일을 관리합니다.
- 저장 기능은 `ADMIN_WRITE_ENABLED=true`, 32자 이상의 `ADMIN_CSRF_SECRET`, 저장소 한 개로 제한된 `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH`가 모두 있어야 활성화됩니다.
- Worker는 Origin·JSON Content-Type·만료되는 CSRF 토큰·콘텐츠 스키마·최신 GitHub SHA를 검증합니다.
- 이미지 파일은 브라우저에서 WebP·최대 1600px로 변환해 EXIF를 제거하고 `public/images/content/`의 허용 경로에만 저장합니다.

로컬 Worker 변수 예시는 `.dev.vars.example`을 참고합니다. 실제 이메일, Audience와 Access 팀 정보는 `.dev.vars` 또는 Cloudflare Secret에만 입력하고 커밋하지 않습니다.
