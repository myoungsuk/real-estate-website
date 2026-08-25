# 대전 동구 행복한부동산 홈페이지

Astro가 정적 HTML을 만들고 GitHub 변경을 Cloudflare Workers Static Assets에 자동 배포하는 공개 홈페이지입니다. 같은 Worker의 `/api/admin/*`에는 Cloudflare Access로 보호되는 관리 API 기반이 있으며, 현재는 인증·상태 조회만 제공하고 콘텐츠 쓰기는 차단합니다.

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

## 운영자가 수정하는 파일

| 파일 | 용도 |
|---|---|
| `src/data/home-content.json` | 홈 대표·사무소·리더스시티 설명 문구와 사진 |
| `src/data/office.json` | 법적 상호·대표·연락처·주소·외부 채널 |
| `src/data/listings.json` | 공개 승인 매물 |
| `src/data/complexes.json` | 대전 동구 주요 단지 정보 |
| `src/data/external-links.json` | 공식 블로그·유튜브 링크 |
| `src/data/faq.json` | 승인된 FAQ |
| `src/data/reviews.json` | 실제 여부와 공개 동의가 확인된 후기 |

고객 연락처·상담 내용·정확한 동·호수·내부 메모·비밀키는 저장하지 않습니다. 사진은 공개 권한과 개인정보를 확인하고 EXIF·GPS를 제거한 최적화본만 `public/images/`에 둡니다.

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
