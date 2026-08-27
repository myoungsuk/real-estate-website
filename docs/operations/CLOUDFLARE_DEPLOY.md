# Cloudflare Workers Static Assets + 관리 API 배포

## 현재 연결 상태 (2026-08-27)

- 운영 도메인 `https://leaderscityhappy.com`은 Worker `leaders-city-happy-realty`의 Custom Domain이다.
- 같은 Worker의 보조 확인 주소는 `https://leaders-city-happy-realty.k4858678.workers.dev`이다. 공개 안내와 검색 등록에는 운영 도메인만 사용한다.
- 운영 쓰기 활성 상태로 확인한 Worker 버전은 `1e5f54e2-85cc-4123-b451-6e3f51e8465d`이다.
- Access 애플리케이션 `리더스시티 행복한부동산 관리자`가 운영 도메인과 보조 Worker 주소의 `/admin*`, `/api/admin*`만 보호한다.
- One-time PIN ID 공급자를 추가하고 애플리케이션 로그인 방법을 One-time PIN 하나로 제한했다. Allow 정책은 Include에 정확한 관리자 이메일 2개, Require에 Login method `One-time PIN`을 사용하며 Bypass 정책은 없다.
- Worker Secret `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `ADMIN_ALLOWED_EMAILS`, `ADMIN_CSRF_SECRET`, `ADMIN_WRITE_ENABLED`, `GITHUB_CONTENTS_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_BRANCH` 등록을 확인했다. Secret 값은 저장소와 문서에 기록하지 않는다.
- 운영 도메인의 비로그인 확인 결과 공개 홈은 `200`, `/admin/`과 `/api/admin/v1/health`는 Access 로그인으로 `302` 리디렉션된다. 로그인된 브라우저에서는 관리자 화면과 same-worker 관리 API 정상 상태를 확인했다.
- GitHub Fine-grained token은 `myoungsuk/real-estate-website` 저장소 한 개와 Contents Read/Write만 허용하고, 운영자 요청에 따라 만료 없음으로 발급했다. 최초 확인 과정의 토큰은 폐기하고 교체 토큰만 Worker Secret에 등록했다.
- `GITHUB_BRANCH=admin-storage-test`에서 관리자 읽기·저장·복원 시험을 완료했다. 시험 커밋 `631cc22` 뒤 복원 커밋 `44afe18`을 만들었고, 복원 결과가 기준 커밋 `89e0f35`의 `home-content.json`과 동일함을 확인했다.
- 검증된 브랜치를 `master`에 fast-forward 병합하고 자동 배포 트리거 커밋 `0f07589`를 추가했다. 현재 관리자 저장 대상은 `GITHUB_BRANCH=master`, 운영 쓰기는 `ADMIN_WRITE_ENABLED=true`다.
- Email 입력과 `Send login code` 화면 노출을 확인했고, 운영자가 허용 이메일 1개의 실제 OTP 수신과 관리자 진입 성공을 확인했다. 다른 허용 이메일과 비허용 이메일의 실제 로그인 시험은 운영자 결정으로 추후 확인한다.
- 기존 Pages 프로젝트 `real-estate-website`는 운영 도메인 연결만 해제했으며 `https://real-estate-website-dnv.pages.dev`는 롤백 확인용으로 유지한다.

## GitHub 자동 배포

Worker는 GitHub `myoungsuk/real-estate-website`의 `master`에 연결되어 있다. 빌드 명령은 `npm run build`, 배포 명령은 `npx wrangler deploy`, 루트 디렉터리는 `/`다. Production에는 `PUBLIC_SITE_URL=https://leaderscityhappy.com`, `PUBLIC_ALLOW_INDEXING=true`를 등록했고 Production 이외 브랜치 빌드는 비활성화했다. 공개 전 승인은 로컬 화면 확인과 pull request CI로 수행한다.

최초 Git 빌드 `91d02fd6`과 Worker 버전 `5e3350e4-276a-46a6-a696-ff0dc9ad0927`의 100% 운영 배포를 확인했다. GitHub Actions `CI #3`도 성공했다.

1. GitHub `master`에 운영 승인 커밋을 푸시한다.
2. GitHub Actions의 기본 `noindex` 빌드와 별도 Production-mode SEO 빌드 검사가 모두 성공했는지 확인한다.
3. Cloudflare 배포가 새 버전 100%로 전환됐는지 확인한다.
4. 공개 홈, robots, sitemap, canonical과 Access 보호 경로를 회귀 확인한다.
5. Production 이외 브랜치 빌드는 비활성화 상태를 유지한다. 나중에 Preview를 켜더라도 Production Secret을 복사하지 않고 `noindex`를 유지한다.

부동산뱅크 동기화는 매일 00:10 KST, 공식 RSS 동기화는 매시간 17분에 예약 실행한다. 두 워크플로 모두 네트워크 조회·의존성 설치·테스트·빌드는 `contents: read` 검증 job에서 수행하고, 허용 파일만 담은 artifact를 별도 `contents: write` 배포 job이 적용한다. 모든 공식 GitHub Action은 검증한 commit SHA로 고정하고 checkout 자격 증명은 저장하지 않는다. 쓰기 토큰은 검증 스크립트가 아니라 최종 `git push` 단계에만 전달한다. 배포 job은 push 직전 `master`가 검증한 기준 SHA와 같은지 다시 확인해 동시 변경을 덮어쓰지 않는다.

`GITHUB_TOKEN` push는 GitHub의 기존 push 기반 CI를 다시 실행하지 않으므로 동기화 워크플로 자체의 테스트·검사·Production-mode 빌드 성공 로그를 확인한다. push 뒤에는 새 빌드의 `/deployment-marker.json`에서 해당 콘텐츠 범위의 SHA-256 값이 검증 job의 예상값과 일치할 때까지 약 10분간 확인하며, 배포가 시작되지 않거나 잘못된 버전이 계속 제공되면 Action을 실패로 표시한다. 이 표시는 자동 롤백은 아니므로 실패 알림을 확인한 운영자가 Cloudflare 빌드 로그와 공개 화면을 점검한다.

`wrangler.jsonc`는 `./dist` 정적 자산과 `worker/index.mjs` 관리 API를 같은 Worker로 배포합니다. `leaderscityhappy.com`은 Worker Custom Domain으로 선언하며 `/api/admin`과 `/api/admin/*`만 Worker를 먼저 실행하므로 공개 경로는 정적 자산으로 제공합니다. Production 빌드는 `PUBLIC_SITE_URL=https://leaderscityhappy.com`과 `PUBLIC_ALLOW_INDEXING=true`를 반드시 함께 설정합니다.

Custom Domain 전환 롤백은 `wrangler.jsonc`의 Custom Domain 설정을 제거하고 기존 Pages 프로젝트에 `leaderscityhappy.com`을 다시 연결하는 순서로 수행한다. Pages 프로젝트나 `pages.dev` 주소는 전환 확인 전 삭제하지 않는다.

## HTTP에서 HTTPS로 강제 이동

Workers Static Assets의 `_redirects`는 경로 기반 규칙이며 domain-level 리디렉션을 지원하지 않는다. 프로토콜 조건도 없으므로 `/* https://leaderscityhappy.com/:splat 301` 같은 규칙은 HTTPS 요청까지 다시 리디렉션할 수 있어 사용하지 않는다.

Cloudflare 대시보드의 해당 zone에서 `SSL/TLS` → `Edge Certificates` → `Always Use HTTPS`를 활성화한다. 대안으로 Redirect Rules의 Single Redirect에 `http://*`를 `https://${1}`로 보내는 301 규칙을 만들 수 있다. 설정 뒤 다음을 수동 확인한다.

- `http://leaderscityhappy.com/<경로>?<쿼리>`가 한 번의 301로 같은 경로·쿼리의 HTTPS 주소로 이동
- 최종 HTTPS 응답이 `200`
- `www.leaderscityhappy.com`이 기존처럼 apex HTTPS 주소로 이동

이 설정은 저장소 코드만으로 확정할 수 없는 Cloudflare zone 작업이다. 활성화와 실제 HTTP 응답 검증 전에는 완료로 표시하지 않는다.

2026-08-27 Cloudflare `Always Use HTTPS`를 활성화했다. 실제 응답에서 `http://leaderscityhappy.com/properties/?sort=latest&trade=sale`는 같은 경로·쿼리의 apex HTTPS 주소로 한 번의 `301` 이동했고, 최종 HTTPS는 `200`을 반환했다. `https://www.leaderscityhappy.com/properties/?sort=latest&trade=sale`도 같은 apex HTTPS 주소로 `301` 이동했다. HSTS는 별도 승인 전까지 활성화하지 않는다.

## Cloudflare Access

1. Self-hosted Access 애플리케이션 하나에 `/admin`, `/admin/*`, `/api/admin`, `/api/admin/*`를 등록한다.
2. Allow 정책의 Include에는 정확한 관리자 이메일 2개만 등록한다.
3. Require에는 Login method `One-time PIN`을 설정한다.
4. Bypass 정책은 사용하지 않는다.
5. 두 관리자 이메일 계정 자체에는 MFA를 활성화한다.
6. 다음 값을 Production Worker 변수 또는 Secret으로 등록한다.
   - `CF_ACCESS_TEAM_DOMAIN`
   - `CF_ACCESS_AUD`
   - `ADMIN_ALLOWED_EMAILS`: 쉼표로 구분한 서로 다른 이메일 2개
   - `ADMIN_ALLOWED_ORIGINS`: 미설정 기본값은 `https://leaderscityhappy.com`. 설정할 때는 쉼표로 구분한 정확한 HTTPS origin만 사용하며 wildcard·경로·쿼리·userinfo·HTTP는 거부된다.
   - `ADMIN_WRITE_ENABLED=false`로 먼저 배포
   - `ADMIN_CSRF_SECRET`: 32자 이상의 무작위 Secret
   - `GITHUB_CONTENTS_TOKEN`: `myoungsuk/real-estate-website` 한 저장소의 Contents Read/Write만 가진 Fine-grained token
   - `GITHUB_REPOSITORY=myoungsuk/real-estate-website`
   - 시험 중에는 `GITHUB_BRANCH=admin-storage-test`
   - 운영 전환 시 검증·병합을 마친 뒤 `GITHUB_BRANCH=master`
7. 허용 관리자 로그인, GitHub 파일 조회와 테스트 저장을 확인한 뒤에만 `ADMIN_WRITE_ENABLED=true`로 변경한다.
8. 현재 Production 이외 브랜치 빌드는 비활성화되어 있다. 나중에 Preview를 활성화하더라도 실제 Production 이메일과 쓰기 Secret을 복사하지 않는다.

관리 API는 `Origin` 헤더가 `ADMIN_ALLOWED_ORIGINS`에 포함되고 요청 URL의 origin과도 정확히 같은 경우에만 쓰기를 허용한다. 나중에 Preview나 `workers.dev`에서 쓰기가 꼭 필요할 때만 해당 HTTPS origin을 명시적으로 추가하고 Access 보호·쓰기 범위를 다시 시험한다.

토큰은 만료 없음으로 발급했으므로 자동 만료에 기대지 않는다. 유출 의심, 담당자 변경, 저장 기능 폐기 시 GitHub Settings에서 즉시 폐기하고 새 토큰으로 교체한다. 사용하지 않는 동안에는 `ADMIN_WRITE_ENABLED=false`를 유지한다.

Static Assets 내부 라우터에서는 `ctx.access`를 사용할 수 없으므로 Worker가 `Cf-Access-Jwt-Assertion`을 직접 검증한다. 설정 누락, JWT 오류, Audience 불일치 또는 허용 이메일 불일치 시 API는 차단된다.

콘텐츠 PUT·미디어 POST의 성공과 실패는 `event`, `requestId`, HMAC 가명 `actorId`, `operation`, `resource`, `result`, `errorCode` 또는 `commitSha`만 구조화 로그로 남긴다. JWT·CSRF·GitHub token·요청 본문·raw 이메일은 기록하지 않는다. `actorId`는 `ADMIN_CSRF_SECRET`을 키로 만들기 때문에 Secret을 회전하면 같은 관리자의 값도 달라진다.

## 관리 API 확인

```bash
npm run build
npx wrangler dev
```

Access가 적용된 배포 환경에서 다음을 확인한다.

- 허용 이메일 2개는 각각 Email OTP 로그인 성공
- 다른 이메일은 OTP 발급 또는 애플리케이션 접근 실패
- 비로그인 `/api/admin/v1/session` 접근 차단
- 로그인 후 `/api/admin/v1/health`, `/session`, `/system` 정상 응답
- 쓰기 비활성 상태에서 콘텐츠 저장 API가 fail closed로 차단
- 쓰기 활성 상태에서 다른 Origin, CSRF 누락·만료, JSON이 아닌 요청이 차단
- `/api/admin/v1/content/listings` 조회 후 최신 SHA로만 저장되고 오래된 SHA는 `409`
- WebP 2MB 초과, 허용되지 않은 이미지 분류와 JSON 경로가 차단
- 네이버 블로그·유튜브 링크 미리보기가 허용 도메인 밖으로 이동하지 않음
- 응답에 토큰, Audience, 허용 이메일 원문이 없음

## 출시 전 확인

- 홈·매물·단지·소개·오시는 길·404가 정상 응답하는지 확인
- 전화·문자·네이버지도·블로그·유튜브 링크 확인
- `/robots.txt`, `/sitemap-index.xml`, `/llms.txt` 확인
- `/deployment-marker.json`이 유효하며 최신 자동 동기화 Action의 예상 marker와 일치하는지 확인
- 실제 도메인과 canonical 일치 확인
- apex HTTP가 경로·쿼리를 보존해 HTTPS로 301 이동하는지 확인
- 공개 정적 페이지가 기존과 동일하게 제공되는지 확인
- `/api/admin/*`만 Worker 호출로 집계되는지 확인
- 문제 발생 시 먼저 Cloudflare에서 직전 정상 배포로 롤백하고 공개 페이지와 marker를 확인한다. 이어서 `master`의 잘못된 커밋을 `git revert`로 되돌려 새 Production 배포를 만든 뒤 Git SHA·marker·공개 화면이 다시 일치하는지 확인한다. `master` 이력은 강제로 다시 쓰지 않는다.

2026-08-27 운영 롤백 훈련에서는 활성 버전 `8bf6c623`에서 직전 정상 버전 `2b5a84ca`로 트래픽 100%를 롤백했다. 롤백 상태에서 홈 `200`과 구 버전에 없던 `/deployment-marker.json`의 `404`를 확인해 실제 트래픽 전환을 검증했다. 이어서 `8bf6c623`을 다시 100%로 승격하고 홈 `200`과 `automation` marker 일치를 확인했다. 이번 훈련은 정상 버전 간 트래픽 전환이므로 `master` 변경이나 `git revert`는 수행하지 않았다.
