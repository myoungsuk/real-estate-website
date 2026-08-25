# ADR-004: Workers Static Assets와 관리 API를 같은 Worker로 운영

| 항목 | 내용 |
|---|---|
| 상태 | 승인 |
| 결정일 | 2026-08-25 |
| 범위 | 공개 정적 사이트와 관리자 API 배포 구조 |

## 배경

현재 공개 사이트는 Astro가 만든 `dist/`를 Cloudflare Workers Static Assets로 배포한다. 관리자시스템 설계 초안은 Pages Functions 전환을 권장했지만, 실제 저장소와 운영 문서는 Wrangler 기반 Worker 배포를 사용한다.

Cloudflare Workers Static Assets는 정적 자산과 Worker script를 한 배포 단위로 구성하고 `assets.run_worker_first`를 특정 API 경로에만 적용할 수 있다. 따라서 Pages로 제품을 전환하지 않고도 현재 배포 구조에 관리 API를 추가할 수 있다.

## 결정

1. 공개 정적 사이트와 관리 API를 `leaders-city-happy-realty` Worker 하나로 배포한다.
2. 정적 페이지는 기존 `ASSETS` 바인딩으로 제공한다.
3. `/api/admin`과 `/api/admin/*`만 Worker script를 먼저 실행한다.
4. `/admin` 화면과 `/api/admin` 경로를 하나의 Cloudflare Access 애플리케이션으로 보호한다.
5. 인증은 허용 이메일 정확히 2개와 Cloudflare Access Email OTP를 사용한다.
6. Static Assets 라우터는 `ctx.access`를 전달하지 않으므로 Worker가 `Cf-Access-Jwt-Assertion`의 서명, issuer, audience와 이메일을 다시 검증한다.
7. 허용 이메일, Access Audience와 향후 GitHub 토큰은 저장소에 기록하지 않고 Worker Secret으로 관리한다.
8. 초기 API는 인증·상태 조회만 제공하고 모든 쓰기 요청은 차단한다.

## 이유

- 현재 Wrangler 배포 방식과 프로젝트명을 유지한다.
- Pages 전환과 도메인 재연결 위험을 피한다.
- 공개 정적 자산 요청은 Worker를 거치지 않아 기존 비용·성능 특성을 유지한다.
- API 경로만 Worker 실행 비용과 보안 검증을 적용한다.
- 향후 GitHub Contents API, R2와 배포 이력 기능을 같은 Worker에 단계적으로 추가할 수 있다.

## 보안 영향

- Access 정책과 Worker JWT 재검증을 모두 통과해야 한다.
- 서로 다른 허용 이메일 2개의 정확한 비교는 서명 검증된 JWT claim에만 수행한다.
- 인증 설정이 없거나 잘못되면 API는 fail closed한다.
- Email OTP는 관리자 이메일 계정 보안에 의존하므로 해당 이메일 계정 자체 MFA를 유지한다.
- API 응답은 `no-store`, `noindex`이며 Secret과 원문 이메일을 반환하지 않는다.

## 포기한 대안

### Cloudflare Pages + Pages Functions 전환

기능 구현은 가능하지만 현재 Workers Static Assets 설정, 배포 문서와 운영 리소스를 전환해야 하므로 초기 변경 위험이 더 크다.

### 별도 관리 API Worker

권한과 장애 경계를 더 강하게 분리할 수 있지만 프로젝트, 도메인, Secret과 배포 관리가 늘어난다. 관리자 1명 규모의 초기 단계에는 적용하지 않는다.

## 검증

- `/api/admin/*`만 Worker-first로 라우팅되는지 확인
- 공개 정적 페이지가 `ASSETS` 바인딩으로 그대로 제공되는지 확인
- Access 설정 누락, JWT 누락·위조·만료·Audience 불일치·이메일 불일치 차단
- Worker dry-run 번들에 Secret이 포함되지 않는지 확인
- 실제 Cloudflare Access Email OTP 로그인은 Production 설정 후 별도 검수

## 롤백

1. `wrangler.jsonc`에서 `main`, `assets.binding`, `assets.run_worker_first`를 제거한다.
2. `worker/` 코드와 관리 API 설정을 제거한다.
3. 관리자 Access 애플리케이션을 비활성화한다.
4. 기존 정적 자산 전용 Worker 버전을 재배포한다.
