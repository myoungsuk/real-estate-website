# 천동 리더스시티 행복한부동산 홈페이지

Astro가 정적 HTML을 만들고 GitHub 변경을 Cloudflare Workers Static Assets에 자동 배포하는 공개 홈페이지입니다. 데이터베이스·서버 API·관리자 로그인 없이 공개용 JSON과 사진 파일을 직접 수정해 운영합니다.

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
| `src/data/office.json` | 법적 상호·대표·연락처·주소·외부 채널 |
| `src/data/listings.json` | 공개 승인 매물 |
| `src/data/complexes.json` | 4블록·5블록 단지 정보 |
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
