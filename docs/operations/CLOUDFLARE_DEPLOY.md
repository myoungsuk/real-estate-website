# Cloudflare Workers Static Assets 배포

## GitHub 자동 배포

1. Cloudflare 대시보드에서 Workers & Pages의 새 애플리케이션을 만든다.
2. GitHub 저장소 `myoungsuk/real-estate-website`를 연결한다.
3. 빌드 명령은 `npm run build`, 배포 명령은 `npx wrangler deploy`로 설정한다.
4. Production 브랜치는 실제 기본 브랜치와 일치시킨다.
5. Production 환경에 `PUBLIC_SITE_URL`과 `PUBLIC_ALLOW_INDEXING=true`를 설정한다.
6. Preview 환경은 `PUBLIC_ALLOW_INDEXING=false`를 유지한다.

`wrangler.jsonc`는 Worker 스크립트 없이 `./dist` 정적 자산만 배포합니다. 프로젝트 이름과 실제 `workers.dev` 주소가 다르면 `PUBLIC_SITE_URL`을 실제 주소로 수정합니다.

## 출시 전 확인

- 홈·매물·단지·소개·오시는 길·404가 정상 응답하는지 확인
- 전화·문자·네이버지도·블로그·유튜브 링크 확인
- `/robots.txt`, `/sitemap-index.xml`, `/llms.txt` 확인
- 실제 도메인과 canonical 일치 확인
- 문제 발생 시 직전 정상 배포로 롤백하거나 Git revert 후 재배포
