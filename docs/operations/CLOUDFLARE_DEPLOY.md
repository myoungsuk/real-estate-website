# Cloudflare Workers Static Assets + 관리 API 배포

## 현재 연결 상태 (2026-08-27)

- 운영 도메인 `https://leaderscityhappy.com`은 Worker `leaders-city-happy-realty`의 Custom Domain이다.
- 같은 Worker의 보조 확인 주소는 `https://leaders-city-happy-realty.<계정>.workers.dev`이다. 공개 안내와 검색 등록에는 운영 도메인만 사용한다.
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
- 2026-11-16 Pages 프로젝트의 분기 제어에서 "분기 미리 보기"를 "프로덕션이 아닌 모든 분기"에서 "없음(자동 분기 배포 사용 중지)"으로 바꿨다. Production 분기 `master`와 자동 프로덕션 배포는 그대로 두어 롤백용 사본은 계속 갱신된다. 이미 만들어진 미리보기 배포는 삭제하지 않았다.
- 2026-11-16 운영자 승인으로 Pages 사본 전체(본 주소 `real-estate-website-dnv.pages.dev`와 미리보기 주소 `*.real-estate-website-dnv.pages.dev`)를 Cloudflare Access 로그인 뒤에만 열리게 했다. Pages 설정의 프리뷰 액세스 제한은 미리보기 주소만 막으므로, Cloudflare Pages 공식 문서(Known issues의 `*.pages.dev` Access 절차)대로 처리했다. 먼저 프리뷰 액세스 제한을 켜서 자동 생성된 Access 애플리케이션의 하위 도메인 `*`를 지워 본 주소용 애플리케이션 `Pages 롤백 사본`으로 바꿨다. 그다음 프리뷰 액세스 제한을 다시 켜 미리보기용 애플리케이션 `real-estate-website - Cloudflare Pages`를 다시 만들었다. 두 애플리케이션 모두 운영 관리자 애플리케이션과 같은 재사용 정책 `관리자 이메일 2명 허용`(허용 이메일 2개 + Login method `One-time PIN`)만 쓰고, 로그인 방법은 One-time PIN 하나와 즉시 인증이다. 자동으로 붙던 Cloudflare 계정 구성원 허용 정책은 뺐다. 비로그인 확인 결과 사본의 `/`·`/admin/`·`/properties/`와 미리보기 별칭은 Access 로그인으로 `302` 이동하고, 운영 도메인과 보조 Worker 주소의 응답은 바뀌지 않았다. Access는 방문 요청만 막으므로 Pages 빌드·배포는 계속된다.
- Pages 사본 차단 되돌리기: Zero Trust의 Access 애플리케이션 목록에서 `Pages 롤백 사본`과 `real-estate-website - Cloudflare Pages` 두 개를 지우고 Pages 설정의 프리뷰 액세스 제한을 끄면 사본이 다시 공개된다. 운영 관리자 애플리케이션과 재사용 정책은 지우지 않는다. 이 정책은 운영 애플리케이션도 쓰므로, 정책을 고치면 운영과 사본에 함께 적용된다.

## GitHub 자동 배포

Worker는 GitHub `myoungsuk/real-estate-website`의 `master`에 연결되어 있다. 빌드 명령은 `npm run build`, 배포 명령은 `npx wrangler deploy`, 루트 디렉터리는 `/`다. Production에는 `PUBLIC_SITE_URL=https://leaderscityhappy.com`, `PUBLIC_ALLOW_INDEXING=true`를 등록했고 Production 이외 브랜치 빌드는 비활성화했다. 빌드 감시 경로는 포함 `*`, 제외 `node_modules/**`·`.git/`이다(2026-11-16 대시보드 확인). 공개 전 승인은 로컬 화면 확인과 pull request CI로 수행한다.

최초 Git 빌드 `91d02fd6`과 Worker 버전 `5e3350e4-276a-46a6-a696-ff0dc9ad0927`의 100% 운영 배포를 확인했다. GitHub Actions `CI #3`도 성공했다.

1. GitHub `master`에 운영 승인 커밋을 푸시한다.
2. GitHub Actions의 기본 `noindex` 빌드와 별도 Production-mode SEO 빌드 검사가 모두 성공했는지 확인한다.
3. Cloudflare 배포가 새 버전 100%로 전환됐는지 확인한다.
4. 공개 홈, robots, sitemap, canonical과 Access 보호 경로를 회귀 확인한다.
5. Production 이외 브랜치 빌드는 비활성화 상태를 유지한다. 나중에 Preview를 켜더라도 Production Secret을 복사하지 않고 `noindex`를 유지한다.

부동산뱅크 동기화는 매일 00:10 KST, 공식 RSS 동기화는 매시간 17분에 예약 실행한다. 두 워크플로 모두 네트워크 조회·의존성 설치·테스트·빌드는 `contents: read` 검증 job에서 수행하고, 허용 파일만 담은 artifact를 별도 `contents: write` 배포 job이 적용한다. 모든 공식 GitHub Action은 검증한 commit SHA로 고정하고 checkout 자격 증명은 저장하지 않는다. 쓰기 토큰은 검증 스크립트가 아니라 최종 `git push` 단계에만 전달한다. 배포 job은 push 직전 `master`가 검증한 기준 SHA와 같은지 다시 확인해 동시 변경을 덮어쓰지 않는다.

`GITHUB_TOKEN` push는 GitHub의 기존 push 기반 CI를 다시 실행하지 않으므로 동기화 워크플로 자체의 테스트·검사·Production-mode 빌드 성공 로그를 확인한다. push 뒤에는 새 빌드의 `/deployment-marker.json`에서 해당 콘텐츠 범위의 SHA-256 값이 검증 job의 예상값과 일치할 때까지 10초 간격으로 최대 30분간 확인하며, 배포가 시작되지 않거나 잘못된 버전이 계속 제공되면 Action을 실패로 표시한다. 이 표시는 자동 롤백은 아니므로 실패 알림을 확인한 운영자가 Cloudflare 빌드 로그와 공개 화면을 점검한다.

사람이 올린 `master` push(pull request 병합, 관리자 화면 저장)는 `.github/workflows/verify-production-deploy.yml`이 확인한다. 이 워크플로는 `contents: read` 권한과 비밀값 없이 push 커밋을 받아 `scripts/verify-production-commit.mjs`를 실행하고, 운영 `/deployment-marker.json`의 `source.commit`이 push 커밋과 같거나 push 커밋을 포함한 `master`의 후속 커밋이 될 때까지 동기화 워크플로와 같은 10초 간격으로, 조회 시간을 포함해 시작 시각 기준 최대 30분 확인한다(job 제한 45분보다 먼저 끝나 마지막 관찰값을 로그에 남김). 연달아 push되어 앞 커밋의 빌드가 취소되거나 뒤 커밋이 먼저 반영돼도 후속 커밋 판정(`git merge-base --is-ancestor`)으로 성공 처리한다. 시간 안에 반영되지 않으면 Action이 실패하고 GitHub가 push한 사람에게 실패 알림을 보낸다(수신 여부는 GitHub 알림 설정에 따름. 2026-11-20 운영자가 GitHub 알림 설정의 Actions가 'Email'·'Failed workflows only'인 화면을 보내 확인). Cloudflare 알림(Platform Notifications)에는 Workers Builds 실패 항목이 없고, Workers Builds 이벤트는 Queue 기반 Event subscriptions로만 받을 수 있어 이 방식을 택했다(2026-11-16). `GITHUB_TOKEN`으로 push한 동기화 커밋은 GitHub 정책상 이 워크플로를 실행하지 않으므로 확인이 겹치지 않는다. 후속 커밋 판정의 `git fetch`는 자격 증명 없이 실행하므로 저장소를 비공개로 바꾸면 다시 설계한다. 2026-11-13 Bank 동기화 커밋 `4ae45ef`처럼 Workers Builds가 실패하면 다음 push가 있을 때까지 운영이 옛 버전으로 남으므로, 실패 알림을 받으면 Cloudflare 빌드 로그로 원인을 확인하고, 자동 배포 실패가 확인된 경우에만 `CLAUDE.md`의 수동 배포 절차(Production 환경변수 빌드와 `npx wrangler deploy --dry-run` 재검증 뒤 `npx wrangler deploy`)를 따른다.

`wrangler.jsonc`는 `./dist` 정적 자산과 `worker/index.mjs` 관리 API를 같은 Worker로 배포합니다. `leaderscityhappy.com`은 Worker Custom Domain으로 선언하며 `/api/admin`·`/api/admin/*`와 업무 도구 캘린더 구독 `/api/calendar/*`(단계 3, Access 애플리케이션 경로에 넣지 않고 토큰으로만 열림)만 Worker를 먼저 실행하므로 공개 경로는 정적 자산으로 제공합니다. `CF_VERSION_METADATA` binding은 인증된 관리자에게 현재 Worker version ID·생성 시각만 제공합니다. `WORK_DB` D1 binding(`leaderscity-work`, `migrations_dir` `migrations/work`)과 `WORK_FILES` R2 binding(`leaderscity-work-files`)은 관리자 전용 중개업무 도구의 자료 저장소입니다. 업무 도구 켜기 값(`WORK_TOOLS_ENABLED`·`WORK_FILES_ENABLED`·`WORK_REALPRICE_ENABLED`·`WORK_BLOG_ENABLED`·`WORK_AI_ENABLED`)과 캘린더 구독 토큰 해시 키 `WORK_FEED_TOKEN_PEPPER`는 Worker Secret으로만 등록하고 `wrangler.jsonc`에 `vars`를 두지 않습니다(일반 변수는 다음 배포 때 덮어써짐). 켜기 Secret이 없으면 업무 도구는 꺼져 있습니다(2026-11-22 `WORK_TOOLS_ENABLED`·`WORK_FILES_ENABLED`를 등록해 켬, 아래 '중개업무 도구 손님 자료' 절). 원격 D1에는 2026-11-17 `0001_init.sql`과 `0002_deal_schedule_inputs.sql`(18:19, 구조 번호 2), 2026-11-19 `0003_public_realprice.sql`(구조 번호 3), 2026-11-20 `0004_blog_drafts.sql`(17:41, 구조 번호 4), 2026-11-21 `0005_ledger.sql`(10:16:33, 구조 번호 5), 2026-11-22 `0006_tasks.sql`(13:53:52, 구조 번호 6)과 `0007_trash.sql`(15:11:18, 구조 번호 7)이 적용됐으므로 적용한 파일은 고치지 않고 구조 변경은 `0008_*.sql`부터 만듭니다(업무 도구 설계서 8.4절·16장). Production 빌드는 `PUBLIC_SITE_URL=https://leaderscityhappy.com`과 `PUBLIC_ALLOW_INDEXING=true`를 반드시 함께 설정합니다.

`deployment-marker.json` v2는 기존 `search`, `bank`, `external`, `automation` scope hash를 그대로 유지하면서 Workers Builds의 `WORKERS_CI_COMMIT_SHA`·`WORKERS_CI_BRANCH`, GitHub Actions의 `GITHUB_SHA`·`GITHUB_REF_NAME`, 허용 관리자 JSON 10종의 정규화 SHA-256 digest를 추가한다. `bank` scope에는 공개 목록·Bank 기준선·재확인 상태·재확인 정책이 함께 포함된다. v1 scope reader는 2026-09-30까지 유지한다. 관리자 `/admin/deployment/`는 마지막 저장 commit·digest와 Production marker를 비교하며, marker 조회 실패는 GitHub 저장 실패가 아니라 `확인 불가`로 표시한다.

Custom Domain 전환 롤백은 `wrangler.jsonc`의 Custom Domain 설정을 제거하고 기존 Pages 프로젝트에 `leaderscityhappy.com`을 다시 연결하는 순서로 수행한다. Pages 프로젝트나 `pages.dev` 주소는 전환 확인 전 삭제하지 않는다.

주의: Cloudflare Pages 공식 문서(Known issues, 2026-11-06판, 2026-11-20 확인)상 Access 정책이나 Worker가 이미 붙은 도메인은 Pages 맞춤 도메인으로 추가하지 못할 수 있다. 운영 도메인에는 관리자 Access 앱(`/admin*`)과 Worker가 붙어 있으므로(경로형 Access 앱도 이 제한에 걸리는지는 시험하지 않음), 실제 롤백은 Workers 이전 버전 되돌리기 또는 `git revert` 뒤 재배포를 먼저 쓴다.

## HTTP에서 HTTPS로 강제 이동

Workers Static Assets의 `_redirects`는 경로 기반 규칙이며 domain-level 리디렉션을 지원하지 않는다. 프로토콜 조건도 없으므로 `/* https://leaderscityhappy.com/:splat 301` 같은 규칙은 HTTPS 요청까지 다시 리디렉션할 수 있어 사용하지 않는다.

현재 `_redirects`는 관례적인 `/sitemap.xml` 요청을 `/sitemap-index.xml`로 보내는 정확한 301 규칙 한 개만 둔다. 없는 경로 전체를 홈으로 보내면 검색엔진이 soft 404로 판단할 수 있으므로 catch-all 리디렉션을 추가하지 않는다.

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

## 중개업무 도구 손님 자료(단계 2, D1·R2)

관리자 업무 도구의 손님·거래·일정·매출장부·할 일·휴지통·감사 기록은 D1 `leaderscity-work`(binding `WORK_DB`, 위치 힌트 `apac`)에, 손님 사진은 R2 `leaderscity-work-files`(binding `WORK_FILES`, APAC·Standard, `r2.dev` 꺼짐·사용자 도메인·CORS 없음)에 둔다. 공개 홈페이지는 둘 다 쓰지 않는다. 상세는 `docs/work-tools/` 설계서 8 ~ 9장·16장이다.

- 로컬 개발: 운영 D1·R2를 개발·시험에 쓰지 않는다. `npm test`의 업무 도구 시험은 진짜 SQLite(Node 내장 `node:sqlite`)에 `migrations/work/*.sql`을 차례로 적용하고 가짜 R2·가짜 외부 요청으로 API를 시험한다. D1을 직접 보려면 `npx wrangler d1 migrations apply leaderscity-work --local`로 내 컴퓨터의 시험용 D1(`.wrangler/`, 커밋하지 않음)에 적용하고 `npx wrangler d1 execute leaderscity-work --local --command "<SQL>"`로 본다. 로컬 Secret은 `.dev.vars`(커밋하지 않음)에만 두고 운영 값을 넣지 않는다.
- Secret: 켜기 값 `WORK_TOOLS_ENABLED`(손님 자료, 2026-11-22 17:26:29 등록)·`WORK_FILES_ENABLED`(사진, 2026-11-22 18:18:52 등록)와 캘린더 구독 토큰 해시 키 `WORK_FEED_TOKEN_PEPPER`(32자 이상, 등록한 뒤 바꾸면 모든 구독 주소가 무효)는 Worker Secret으로만 등록한다. 일반 변수로 넣으면 다음 배포 때 지워진다. 정확히 `true`일 때만 켜지고, 없으면 업무 API는 503 `WORK_DISABLED`·`FILES_DISABLED`다. 실거래가·글 초안의 Secret은 아래 두 절이다.
- 캘린더 구독 주소(단계 3, `GET`·`HEAD /api/calendar/{token}.ics`, Access 밖): 해시 키 `WORK_FEED_TOKEN_PEPPER`는 2026-11-23 08:55:41 등록했다. Cloudflare 대시보드의 속도 제한 규칙 1개(무료 1칸)를 이 경로에 쓴다: 주소가 `/api/calendar/`로 시작하는 요청을 같은 IP가 10초에 5회 넘게 부르면 10초 동안 막는다(사용자 승인 2026-11-23 09:32:17 질문 도구 답("대장이 만듦 (Recommended)")). 2026-11-23 09:34:59 운영 확인: 6번째 요청부터 429, 10초 뒤 다시 404(배포 담당(날개대장) 실측). 요청 주소에 토큰이 들어 있으므로 Workers 로그·추적(traces)·Logpush는 꺼 둔다(2026-11-23 배포 담당(날개대장)이 대시보드에서 Workers 로그·추적(traces)·Logpush가 모두 꺼져 있음을 확인했다). 켜야 하면 먼저 토큰이 로그에 남지 않게 할 방법을 정한다. 구독 주소는 '계약 일정' 화면 맨 아래 '휴대폰 캘린더 구독' 칸에서 만들고 취소한다(업무 도구 설계서 12.3절).
- 구조 변경(마이그레이션) 순서(설계서 8.4절): ① 켜진 도구 확인 ② 휴지통 묶음 수 확인(구조 번호가 바뀌면 그 전 묶음은 되살릴 수 없음) ③ 원격 백업 `npx wrangler d1 export leaderscity-work --remote --output <저장소 밖 경로>`, 파일 이름·크기 확인 ④ 사용자 승인 ⑤ `npx wrangler d1 migrations apply leaderscity-work --remote`(바인딩 이름이 아니라 DB 이름으로) ⑥ `settings.schema_version` 확인 ⑦ 병합·자동 배포·marker 확인. 원격 적용부터 새 배포까지 앞 판 Worker는 업무 API를 503 `WORK_SCHEMA_AHEAD`로 막는다(2 ~ 3분, 추정). 실거래가 하루 확인 차례인 03:00 ~ 03:10 KST는 피한다. 적용한 `0001` ~ `0007`은 고치지 않고 다음은 `0008_*.sql`이다.
- 백업: 1차는 D1 Time Travel(시점 복원)이다. 매월 첫 평일에 배포 담당(날개대장)이 `wrangler d1 export`로 받아 운영자 PC 안에만 두고 최근 3개만 남긴다. 구조 변경 전에 받은 백업은 적용과 운영 반영을 확인한 날부터 7일 뒤 지운다. 저장소·Git·인터넷 저장소·공유 드라이브에는 두지 않는다(설계서 8.10절, 처리방침의 백업 잔존 기간과 같음). R2는 따로 복제하지 않는다.
- 복원: `wrangler d1 time-travel restore`는 DB **전체**를 그 시점으로 되돌리고, `CI=true` 같은 비대화 실행에서는 확인 질문을 자동으로 yes로 넘긴다(2026-11-22 훈련 실측). 운영 복원은 사람이 확인 질문에 직접 답하고, DB 이름을 두 번 확인하고(`leaderscity-work-drill`과 헷갈리지 않게), 직전 `export` 백업과 되돌리기 표시(undo bookmark) 기록을 남긴 뒤 사용자 승인으로만 한다. 훈련은 운영 D1이 아니라 훈련용 D1(`leaderscity-work-drill`)에 수십 행짜리 가상 자료만 넣고 한다.
- D1 한도와 요금: 무료였던 2026-11-22 17:30 복원 훈련에서 훈련용 D1에 원격으로 백업을 넣은 것(`rows_written` 109,682행, 17:30:52 ~ 17:31:02)과 운영 D1의 지난 24시간 쓰기(33,567행: `wrangler d1 info leaderscity-work`의 `rows_written_24h`, Cloudflare 집계, 18:18:15에 잼)가 더해져 계정 하루 쓰기 한도 10만 행을 넘었다. 같은 때쯤 앱 기록(`rt_fetch_runs.rows_written` 합)으로 실거래가 Cron은 최근 24시간 124번 33,913행을 썼다(18:3x에 잼. 잰 시각과 세는 방식이 달라 Cloudflare 값과 다름). 18:15쯤부터 11-23 09:00 KST까지 **쓰기가 막혔고, 읽기는 막히지 않았다**(18:3x 배포 담당이 읽기 질의 성공으로 한 번 확인). 그래도 업무 화면은 보기 전에 감사 기록을 써야 해서 손님 보기까지 막혔다. 2026-11-23 09:10:55 사용자 결정(질문 도구 답 "지금 유료로 바꿈 (Recommended)")으로 Workers Paid로 바꿨다(결제는 운영자, 배포 담당(날개대장)이 09:15 요금제 화면에서 확인). 유료에는 D1 하루 한도가 없고, 월 포함량(읽기 250억 행·쓰기 5,000만 행·저장 5GB)을 넘으면 읽기 100만 행당 0.001달러·쓰기 100만 행당 1달러·저장 GB-월 0.75달러가 붙는다(2026-11-23 Cloudflare D1 요금 문서 확인. 월 포함량은 구독을 시작한 날을 기준으로 매달 다시 찬다). Wrangler·대시보드에서 친 쿼리도 같이 센다. 그래서 큰 백업 넣기 같은 대량 쓰기는 계속 `--local` D1에서 하고, 원격 대량 쓰기는 먼저 `wrangler d1 info <이름>`의 `rows_written_24h`로 양을 보고 사용자에게 묻는다. Workers는 계정 단위 지출 한도(Workers spending limit)를 걸 수 있다(공식 문서, 걸지는 사용자 결정).
- 매일 03:00(한국 시각) Cron 차례: 켜기 값과 상관없이 7일 지난 휴지통 묶음 영구 삭제(구조 번호 7 이상, R2 객체를 먼저 지움), 3년 지난 감사 기록 삭제, 글 초안 보관 정리를 한다(설계서 8.9절).
- 롤백(먼저 쓰는 것부터)
  - 사진만 이상함: Secret `WORK_FILES_ENABLED`를 지우거나 `false`로 바꾼다. 파일 API는 503이고 R2 객체·D1 행은 그대로다.
  - 업무 도구 전체가 이상함: Secret `WORK_TOOLS_ENABLED`를 지우거나 `false`로 바꾼다. 업무 API는 곧바로 503이고 자료는 그대로다.
  - 구조 변경 뒤 코드를 되돌려야 함: 통째로 되돌리면 코드 구조 번호가 원격 D1보다 낮아 업무 경로 전체가 `WORK_SCHEMA_AHEAD`가 된다. 켜기 값으로 먼저 막고, 되돌리는 SQL을 새 번호로 더하거나 구조 번호는 그대로 두는 되돌리기 커밋을 쓴다. D1 Time Travel은 그 뒤에 들어온 손님 자료까지 지우므로 마지막 수단이다.
  - 바인딩을 빼야 함: `wrangler.jsonc`에서 바인딩을 빼고 다시 배포한다. D1·R2 자료는 남고, 자료 삭제는 백업 확인과 사용자 승인 뒤 따로 한다.
## 중개업무 도구 실거래가 받기(단계 P, Cron)

`wrangler.jsonc`의 `triggers.crons` `*/10 * * * *`는 관리자 업무 도구 실거래가 탭(단계 P)의 자료 받기다. 같은 Worker의 `scheduled`가 10분마다 공공데이터포털 아파트 실거래가 API 4개에서 대전 동구 자료를 1개월 1종류씩 받아 D1 `WORK_DB`의 `rt_*` 표에 차이만 반영한다. 켜기 값이 없으면 D1·외부 요청 없이 끝나고 로그도 남기지 않는다(예외: 한국 시각 03:00 차례에는 원격 D1 구조 번호가 4 이상이면 글 초안 보관 정리를 먼저 한다, 아래 '중개업무 도구 글 초안' 절). 상세는 `docs/work-tools/` 설계서 22장이다.

2026-11-23부터 `triggers.crons`에 `* * * * *`가 하나 더 있다(단계 4 AI 작업 조회, `worker/work-ai-cron.mjs`). `WORK_AI_ENABLED`가 없으면 D1·외부 요청·로그 없이 끝나므로, 대시보드 Triggers에 예약 2개가 보이고 1분마다 실행 기록이 남는 것이 정상이다. 이 예약에 문제가 있으면 `wrangler.jsonc`에서 `* * * * *`만 빼고 다시 배포한다(예약 글자를 보는 시험 `tests/work-ai-cron.test.mjs`도 함께 고친다). `WORK_AI_ENABLED`는 `docs/work-tools/` 진행 체크리스트 7.7절 '켜기 전' 줄을 모두 끝낸 뒤 사용자 승인을 받아 마지막에 등록한다.

- Secret: 켜기 값 `WORK_REALPRICE_ENABLED`(정확히 `true`일 때만 켜짐)와 공공데이터포털 인증키 `MOLIT_RT_SERVICE_KEY`는 Worker Secret으로만 등록한다. 일반 변수로 넣으면 다음 배포 때 지워진다. 인증키는 운영자가 대시보드 또는 자기 터미널의 `npx wrangler secret put`으로 직접 입력하고, 대화·문서·저장소에 붙이지 않는다. 켜기 값만 있고 인증키·`ADMIN_CSRF_SECRET`(32자 이상)·허용 출처·D1 binding 가운데 하나가 빠졌으면 API는 503 `REALPRICE_CONFIG_MISSING`이고 Cron은 고정 코드 경고 로그만 남긴다.
- 인증키 교체: 공공데이터포털에서 재발급한 뒤 운영자가 같은 이름의 Secret을 덮어쓴다. 키가 거부되면 받기를 모든 종류 1시간씩 미루므로, 교체 뒤 실거래가 화면의 다시 받기(`POST /api/admin/v1/work/realprice/refresh`)로 미룸을 지우고 최근 4개월(3종류 12건, 약 2시간)을 다시 받는다.
- 처음 켜는 순서: ① 사전 확인 3가지(Secret 목록에 `WORK_TOOLS_ENABLED`·`WORK_REALPRICE_ENABLED`가 없음, 같은 계정 다른 Worker의 Cron 수(한도 5개), Workers 관측 설정의 자동 추적(traces)이 꺼져 있음) ② 병합·자동 배포 뒤 marker와 대시보드 Triggers의 `*/10 * * * *` 확인 ③ 원격 D1 백업 `npx wrangler d1 export leaderscity-work --remote --output <저장소 밖 경로>` ④ `npx wrangler d1 migrations apply leaderscity-work --remote` 뒤 `settings.schema_version`이 `3`이고 `rt_` 표가 5개인지 확인 ⑤ 인증키 Secret 입력 ⑥ `WORK_REALPRICE_ENABLED=true` Secret 등록 ⑦ 10분 안 첫 실행 뒤 `/api/admin/v1/work/realprice/status`의 오늘 호출·쓰기·읽기량, Workers 로그의 Cron CPU 시간, 로그에 인증키 0건 확인. 원격 D1 적용과 켜기 값 등록은 각각 운영자 승인 뒤에 한다.
- 배포 ~ 원격 적용 사이: 코드의 구조 번호(3)가 원격 D1(2)보다 앞서 단계 2 업무 도구 경로도 `WORK_SCHEMA_OUTDATED`가 된다. 단계 2 켜기 값 `WORK_TOOLS_ENABLED`가 없으면 그 전에 `WORK_DISABLED`라 보이지 않는다.
- 롤백(먼저 쓰는 것부터)
  - 실거래가만 이상함: Secret `WORK_REALPRICE_ENABLED`를 지우거나 `false`로 바꾼다. API는 503, Cron은 아무것도 하지 않고 자료는 그대로다.
  - `0003` 적용 전 배포에 문제: 아직 켜기 전이므로 `git revert` 또는 직전 Cloudflare 배포로 되돌린다. 원격 D1은 구조 번호 2 그대로라 맞는다.
  - `0003` 적용 뒤 코드를 되돌려야 함: 통째로 되돌리면 코드 2 < D1 3이라 단계 2 경로까지 `WORK_SCHEMA_AHEAD`가 된다. 켜기 값으로 먼저 막고, 꼭 되돌려야 하면 단계 P 경로·Cron만 빼고 구조 번호는 3으로 두는 되돌리기 커밋을 쓴다.
  - Cron 자체 문제: `wrangler.jsonc`에서 `*/10 * * * *`를 빼고 다시 배포한다(배포 설정 시험도 함께 고친다).
  - 자료가 틀림: 그 달의 `rt_fetch_months.next_due_at`을 지금으로 바꿔 다시 받는다. D1 Time Travel은 손님 자료까지 되돌리므로 쓰지 않는다.
  - 하루 쓰기·읽기가 계정 한도에 가까움: 켜기 값을 끈다. 예산(쓰기 4만 행, 읽기 첫 상한 150만·끝 상한 250만 행)은 코드 상수라 바꾸려면 PR이 필요하다.

## 중개업무 도구 글 초안(단계 P P3, OpenAI)

관리자 업무 도구 '글 초안'(`/admin/work/blog/`)은 공개 매물·단지 1건으로 Worker가 OpenAI Responses API(background, `store:false`)에 블로그 글 초안을 요청한다. 초안은 D1 `WORK_DB`의 `blog_drafts`(마이그레이션 `0004`, 구조 번호 4)에만 두고 공개 산출물에 넣지 않는다. 새 Cron은 없다(결과는 브라우저가 받아 감). 상세는 `docs/work-tools/` 설계서 22.11·22.15절이다.

- Secret: 켜기 값 `WORK_BLOG_ENABLED`(정확히 `true`일 때만 켜짐), OpenAI 키 `OPENAI_API_KEY`(운영자가 직접 입력, 2026-11-19 입력함), 설정 `OPENAI_MODEL`·`OPENAI_REASONING_EFFORT`·`OPENAI_MAX_OUTPUT_TOKENS`(1,000 ~ 200,000)·`OPENAI_PRICES_JSON`(모델별 100만 토큰당 마이크로달러 `input`·`output`), 선택 `OPENAI_MODEL_BLOG`(비우면 `OPENAI_MODEL`). 모두 Worker Secret으로 등록한다(일반 변수는 다음 배포 때 지워짐). 켜기 값만 있고 설정 하나가 빠지거나 틀리면 글 초안 API와 업무 세션이 503 `BLOG_CONFIG_MISSING`이다. 키는 대화·문서·저장소에 붙이지 않는다.
- AI 사용 한도: 하루 편수·월 예상 비용 상한은 Secret이 아니라 D1 `settings` 행이고, 마이그레이션이 넣지 않는다. 켜기 값을 켠 뒤 글 초안 화면 한도 칸에서 저장한다(처음 값 하루 10편·월 10달러, 운영자 결정 2026-11-20 15:36:44). 저장 전 만들기는 409 `AI_LIMITS_MISSING`으로 OpenAI를 부르지 않는다. OpenAI 프로젝트 예산 상한(월 20달러)이 그 뒤의 보호선이다.
- 처음 켜는 순서: ① 실거래가가 켜져 있으면 Secret `WORK_REALPRICE_ENABLED`를 잠시 `false`로 ② 병합·자동 배포 뒤 marker 확인 ③ 원격 D1 백업(`npx wrangler d1 export leaderscity-work --remote --output <저장소 밖 경로>`). 만들어진 파일 이름·크기를 확인한 뒤에만 ④로 간다(2026-11-20 `0004` 적용 때 이 단계를 빠뜨렸다. 표를 더하기만 해서 영향은 없었다) ④ `npx wrangler d1 migrations apply leaderscity-work --remote` 뒤 `settings.schema_version`이 `4`이고 `blog_drafts` 표와 `settings`의 `ai_limits_version`이 있는지 확인 ⑤ `WORK_REALPRICE_ENABLED`를 다시 `true`로 ⑥ OpenAI 설정 Secret이 모두 있는지 확인 ⑦ `WORK_BLOG_ENABLED=true` Secret 등록 ⑧ 글 초안 화면 한도 칸에서 한도 저장 ⑨ 가상 공개 매물 1건으로 만들고 OpenAI 사용량 화면과 앱 예상 비용을 비교, Workers 로그에 키·글 본문 0건 확인. 원격 D1 적용과 켜기 값 등록은 각각 운영자 승인 뒤에 한다. 한도 칸 API도 켜기 전에는 503이므로 ⑧은 ⑦ 뒤에만 된다.
- 배포 ~ 원격 적용 사이: 코드의 구조 번호(4)가 원격 D1(3)보다 앞서 실거래가·업무 도구 경로가 `WORK_SCHEMA_OUTDATED`가 되므로 ①로 실거래가 경고가 쌓이지 않게 한다.
- 매일 03:00(한국 시각) Cron 차례: 실거래가 Cron(`*/10 * * * *`)이 켜기 값을 보기 전에 글 초안 보관 정리(다 씀·취소 30일 뒤 삭제, 30일 닫지 않으면 자동으로 닫고 다시 30일 뒤 삭제)를 한다. 원격 D1 구조 번호가 4 이상이면 글 초안·실거래가 켜기 값과 상관없이 돌고, 로그는 `blog_cleanup`(지운 수·닫은 수)만 남는다.
- 롤백(먼저 쓰는 것부터)
  - 글 초안만 이상함: Secret `WORK_BLOG_ENABLED`를 지우거나 `false`로 바꾼다. API는 503이고, 남은 초안은 03:00 보관 정리로 계속 지워진다. 키 유출이 의심되면 OpenAI에서 키를 폐기하고 새 키로 Secret을 덮어쓴다.
  - `0004` 적용 뒤 코드를 되돌려야 함: 통째로 되돌리면 코드 3 < D1 4라 업무 도구 경로가 `WORK_SCHEMA_AHEAD`가 된다. 켜기 값으로 먼저 막고, 꼭 되돌려야 하면 글 초안 경로만 빼고 구조 번호는 4로 두는 되돌리기 커밋을 쓴다.

## 출시 전 확인

- 홈·매물·단지·소개·오시는 길·404가 정상 응답하는지 확인
- 전화·문자·네이버지도·블로그·유튜브 링크 확인
- `/robots.txt`, `/sitemap-index.xml`, `/llms.txt`와 `/sitemap.xml`의 정확한 301 이동 확인
- `/deployment-marker.json` v2의 source commit·branch, 허용 JSON resource digest와 최신 자동 동기화 Action의 예상 scope marker가 일치하는지 확인
- 관리자 저장 시험에서는 `/admin/deployment/`가 같은 commit이면 `공개 완료`, 더 최신 commit의 같은 digest면 `최신 배포 포함`으로 표시하는지 확인
- 실제 도메인과 canonical 일치 확인
- apex HTTP가 경로·쿼리를 보존해 HTTPS로 301 이동하는지 확인
- 공개 정적 페이지가 기존과 동일하게 제공되는지 확인
- `/api/admin/*`와 `/api/calendar/*`만 Worker 호출로 집계되는지 확인
- `/api/calendar/` 속도 제한 규칙(같은 IP 10초 5회 초과 → 10초 차단)이 켜져 있고, Workers 로그·추적·Logpush가 꺼져 있는지 확인
- 업무 도구를 바꾼 배포라면 원격 D1 `settings.schema_version`이 코드의 기대값과 같은지, R2 버킷의 공개 접근(`r2.dev`·사용자 도메인)이 꺼져 있는지 확인
- 문제 발생 시 먼저 Cloudflare에서 직전 정상 배포로 롤백하고 공개 페이지와 marker를 확인한다. 이어서 `master`의 잘못된 커밋을 `git revert`로 되돌려 새 Production 배포를 만든 뒤 Git SHA·marker·공개 화면이 다시 일치하는지 확인한다. `master` 이력은 강제로 다시 쓰지 않는다.
- 공개 JSON 한 종류만 이전 내용으로 되돌릴 때는 `/admin/history/`에서 현재 `master`에 포함된 과거 commit을 선택하고 diff·현재 schema 검증·정확한 2차 확인 문구를 거쳐 새 복원 commit을 만든다. 복원 성공 뒤 `/admin/deployment/`에서 해당 resource digest의 Production 일치를 확인한다. 이 콘텐츠 복원은 사이트 전체 장애 대응용 Cloudflare 버전 롤백과 한 버튼으로 혼합하지 않는다.

2026-08-27 운영 롤백 훈련에서는 활성 버전 `8bf6c623`에서 직전 정상 버전 `2b5a84ca`로 트래픽 100%를 롤백했다. 롤백 상태에서 홈 `200`과 구 버전에 없던 `/deployment-marker.json`의 `404`를 확인해 실제 트래픽 전환을 검증했다. 이어서 `8bf6c623`을 다시 100%로 승격하고 홈 `200`과 `automation` marker 일치를 확인했다. 이번 훈련은 정상 버전 간 트래픽 전환이므로 `master` 변경이나 `git revert`는 수행하지 않았다.
