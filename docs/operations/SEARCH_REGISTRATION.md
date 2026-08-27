# Google·네이버 검색 등록

실제 도메인 연결과 법정 정보·공개 콘텐츠 검수를 마친 뒤 진행합니다. 보조 `workers.dev` 주소는 검색엔진에 등록하지 않습니다.

## 현재 상태 (2026-08-27)

- Production-mode CI가 robots, sitemap, canonical과 공개 색인 설정을 자동 검사합니다.
- 저장소에는 Google·네이버 HTML 소유 확인 파일이 없습니다. DNS 인증을 사용했다면 파일이 없어도 정상일 수 있습니다.
- Google Search Console의 소유 확인·사이트맵 제출·핵심 URL 검사 완료 증거는 저장소에서 확인할 수 없어 외부 확인 대기입니다.
- 네이버 서치어드바이저의 소유 확인·사이트맵 제출·수집 요청 완료 증거도 저장소에서 확인할 수 없어 외부 확인 대기입니다.

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

## AI 검색

`robots.txt`에서 전체 검색로봇을 허용하면 OAI-SearchBot도 차단되지 않습니다. `/llms.txt`는 사이트의 공식 정보를 요약하는 보조 파일이며 검색 노출이나 AI 인용을 보장하는 수단으로 취급하지 않습니다.
