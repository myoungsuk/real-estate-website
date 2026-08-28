# Google·네이버 검색 등록

실제 도메인 연결과 법정 정보·공개 콘텐츠 검수를 마친 뒤 진행합니다. 보조 `workers.dev` 주소는 검색엔진에 등록하지 않습니다.

## 현재 상태 (2026-08-28)

- Production-mode CI가 robots, sitemap, canonical, JSON-LD·BreadcrumbList, IndexNow 공개키와 공개 색인 설정을 자동 검사합니다.
- Google Search Console Domain 속성의 DNS 소유 확인과 `sitemap-index.xml` 제출을 완료했습니다. sitemap은 성공 상태이며 홈·사무소·단지·매물·블로그 등 일부 핵심 URL의 Google 색인을 확인했습니다.
- 네이버 서치어드바이저 사이트 소유 확인, `sitemap-index.xml` 제출, 홈·매물 목록·단지 목록 수집 요청을 완료했습니다. 사이트 간단 진단의 접속·robots·로봇 메타·제목·설명·Open Graph 항목은 정상입니다.
- 네이버 일반 검색의 실제 색인은 아직 확인되지 않았습니다. 제출 완료와 실제 색인은 별개이므로 며칠 간격으로 다시 확인합니다.
- 향후 `master`의 공개 URL 변경은 성공한 CI와 Cloudflare Production `search` marker 확인 뒤 네이버 IndexNow로 자동 알립니다. 2026-08-28 첫 운영 실행은 커밋 `c625c76`의 관련 URL 14개를 골라 Production marker `5dad9d34…`와 공개키를 확인한 뒤 네이버 `HTTP 200` 응답으로 완료했습니다.

## 사전 확인

- Production `PUBLIC_SITE_URL`이 실제 도메인과 일치
- Production `PUBLIC_ALLOW_INDEXING=true`
- `/robots.txt`가 `Allow: /`와 실제 사이트맵 주소를 반환
- `/sitemap-index.xml`이 공개 페이지만 포함
- 페이지별 title·description·canonical 정상

## Google Search Console

Cloudflare에서 DNS를 관리한다면 Domain 속성의 DNS TXT 인증을 우선합니다. URL-prefix 속성의 HTML 파일 방식을 사용하면 Google이 내려준 파일을 수정하지 않고 `public/`에 넣어 배포합니다. 인증 파일은 인증 유지 기간 동안 삭제하지 않습니다.

인증 후 사이트맵을 제출하고 핵심 페이지는 URL 검사를 통해 색인을 요청합니다. 제출과 요청은 노출이나 순위를 보장하지 않습니다.

## 네이버 서치어드바이저

네이버가 내려준 HTML 확인 파일을 수정하지 않고 `public/`에 넣어 배포합니다. 소유 확인 후 사이트맵을 제출하고 주요 페이지 수집을 요청합니다.

### IndexNow 자동 알림

- 공개키: `public/4e63ed9293cf0b859764be32c769f7b26336ebb71489cd6d9ff3f58a811e27a3.txt`
- URL 계획·검증·제출: `scripts/indexnow.mjs`
- 자동 실행: `.github/workflows/notify-indexnow.yml`
- 실행 조건: `master` push의 CI 성공 → 변경 URL 계획 → Cloudflare Production `search` marker 일치 → 공개키 확인 → 네이버 IndexNow 제출
- 권한: GitHub `contents: read`만 사용하며 Secret이나 쓰기 토큰을 사용하지 않음
- 공개키가 사이트 루트의 기본 위치에 있으므로 제출 본문에는 선택 항목인 `keyLocation`을 넣지 않습니다. 공개키 확인 단계는 실제 루트 URL을 직접 검사합니다.

IndexNow는 새로 추가·수정·삭제된 URL을 검색엔진에 알리는 보조 수단입니다. 기존 URL 전체를 반복 제출하지 않으며, sitemap·수집 요청을 대체하거나 색인을 보장하지 않습니다.

## AI 검색

`robots.txt`에서 공개 경로를 허용하고 관리자 경로만 차단합니다. OAI-SearchBot 같은 AI 검색봇도 별도 차단하지 않되, 실제 Cloudflare 응답이 200인지 배포 후 User-Agent별로 확인합니다. 공개 하위 HTML에는 사이트 계층을 설명하는 `BreadcrumbList`가 있고, 홈은 `WebSite`와 `RealEstateAgent`·`LocalBusiness`를 고정 ID로 연결한 구조화 데이터, FAQ는 `FAQPage`를 기존 승인 정보만으로 제공합니다.

2026-08-28 Cloudflare AI Crawl Control에서 OAI-SearchBot·ChatGPT-User·GPTBot·Googlebot·BingBot·PerplexityBot·ClaudeBot의 크롤러 차단 스위치가 모두 꺼진 상태를 확인했습니다. 지난 24시간 AI 크롤러 요청 233개 중 117개가 허용됐고 실패 116개 중 111개는 404였습니다. 경로별 확인 결과 대부분 `/.env`, `/.git/config`, `wp-config.php`, `credentials.json` 같은 비밀파일 탐색 요청이므로 404를 유지합니다. 정상적인 관례 경로인 `/sitemap.xml`만 공식 `/sitemap-index.xml`로 301 이동합니다. 같은 User-Agent로 운영 홈을 직접 요청한 검사도 모두 HTTP 200이었습니다.

`/llms.txt`는 사이트의 공식 정보를 요약하는 보조 파일입니다. Google은 별도의 AI 전용 최적화나 `llms.txt`가 기존 SEO를 대신한다고 안내하지 않으므로, 검색 노출이나 AI 인용을 보장하는 수단으로 취급하지 않습니다. AI 검색에도 고유한 실제 정보, 읽을 수 있는 HTML, 내부 링크, sitemap, 정상적인 검색봇 접근이 기본입니다.
