# 공개 콘텐츠 수정 안내

관리자는 먼저 `/admin/`에 접속해 Cloudflare Access 이메일 OTP 인증을 거친 뒤 아래 관리 화면을 사용합니다.

- 네이버 매물 확인·관리 링크: `/admin/listings/`
- 첫 화면·사무소·리더스시티 설명: `/admin/content/`
- 네이버 블로그·유튜브: `/admin/external-links/`
- 대전 동구 지역·단지 설명: `/admin/complexes/`

저장하면 GitHub에 커밋됩니다. Cloudflare Git 자동 배포 연결을 완료한 환경에서만 이어서 공개 화면에 반영됩니다. 저장 연결이 비활성화된 환경에서는 아래와 같이 파일을 직접 수정할 수 있습니다.

1. `src/data/`에서 수정할 JSON 파일을 연다.
2. 승인된 공개 정보만 수정한다.
3. 사진은 개인정보와 권리를 검수하고 최적화한 뒤 `public/images/content/<분류>/` 또는 승인된 기존 이미지 경로에 둔다.
4. `npm run check`와 `npm run build`를 실행한다.
5. GitHub에 반영하고 Preview에서 휴대폰 화면과 전화·문자 링크를 확인한다.
6. Production 반영 후 다시 확인한다.

매물 등록·수정·종료는 네이버 부동산에서 처리합니다. 관리자 화면은 현재 사이트에 반영된 네이버 공개 매물을 확인하고 네이버 매물 관리 화면으로 이동하는 용도입니다. 공개 전에 현행 중개대상물 표시·광고 기준을 운영자가 별도로 확인해야 합니다.

네이버 등 공개 광고 화면에 없는 정확한 호수, 고객·소유자·임대인 연락처, 내부 메모, 계약서·신분증·등록증 원본은 이 저장소에 넣지 않습니다. 네이버에 공개된 동 번호와 광고 층수는 아래 외부 매물 카드에 그대로 표시할 수 있습니다.

## 공식 로고

- 승인된 원본: `public/images/brand/leaders-city-happy-logo.png`
- 화면용 최적화본: `public/images/brand/leaders-city-happy-logo.webp`
- 헤더와 푸터는 WebP를 사용하고, SNS 공유 메타정보는 고해상도 PNG를 사용합니다.
- 원본을 교체하면 `node scripts/optimize-brand-logo.mjs`를 실행한 뒤 `npm run check`와 모바일 화면을 확인합니다.
- 로고의 글자·색상·비율을 임의로 바꾸지 않습니다.

## 자체 매물 작성 틀(레거시·관리자 화면 미사용)

아래 객체를 `src/data/listings.json` 배열 안에 복사한 뒤 `change-me`와 `0`을 실제 승인 정보로 모두 바꿉니다. 처음에는 반드시 `draft`로 저장하고, 검수 완료 후에만 `published`로 바꿉니다.

```json
{
  "id": "change-me",
  "slug": "change-me",
  "title": "change-me",
  "status": "draft",
  "propertyType": "apartment",
  "tradeType": "sale",
  "district": "대전 동구",
  "neighborhoodSlug": "cheon-dong",
  "neighborhoodName": "천동",
  "complexName": "리더스시티 4블록",
  "salePriceKrw": 0,
  "depositKrw": null,
  "monthlyRentKrw": null,
  "exclusiveAreaM2": 0,
  "floorLabel": null,
  "direction": null,
  "moveIn": null,
  "summary": "change-me",
  "features": [],
  "thumbnail": null,
  "images": [],
  "source": "change-me",
  "confirmedAt": "YYYY-MM-DD",
  "publishedAt": null
}
```

- `id`와 `slug`: 영문 소문자·숫자·하이픈만 사용하고 기존 매물과 겹치지 않게 작성
- `tradeType`: 매매 `sale`, 전세 `jeonse`, 월세 `monthly-rent`
- `district`: 현재 `대전 동구`만 입력
- `neighborhoodSlug`: 동네 이름을 영문 kebab-case로 입력(예: `cheon-dong`, `yongun-dong`)
- `neighborhoodName`: 공개할 동네 이름 입력(예: `천동`, `용운동`)
- `complexName`: 단지 매물이면 실제 단지명을 입력하고 비단지 매물이면 `null`
- 매매: `salePriceKrw`만 원 단위 양의 정수, 나머지 가격은 `null`
- 전세: `depositKrw`만 원 단위 양의 정수, 나머지 가격은 `null`
- 월세: `depositKrw`, `monthlyRentKrw`를 원 단위 양의 정수로 작성하고 매매가는 `null`
- `thumbnail`: 목록 카드의 대표 이미지 `{ "src": "/images/...webp", "alt": "사진 설명" }` 또는 `null`
- `images`: 상세 화면용 승인 이미지 배열. 각 항목에 자체 이미지 경로와 대체 텍스트를 입력

## 블로그·유튜브 카드

`src/data/external-links.json`의 각 항목은 `id`, `type`, `status`, `title`, `summary`, `url`, `publishedAt`, `thumbnail`을 사용합니다.

- `status`가 `published`인 카드만 공개합니다.
- 블로그는 `blog.naver.com`, 유튜브는 `youtube.com` 또는 `youtu.be`의 HTTPS 주소만 허용합니다.
- 관리자 화면의 `정보 불러오기`는 제목과 썸네일을 보조로 가져옵니다. 결과를 사람이 확인한 뒤 저장해야 합니다.
- 썸네일을 불러오지 못하면 직접 올리고 의미 있는 사진 설명을 입력합니다.
- 원문 전체를 복제하거나 권한 없는 이미지를 사용하지 않습니다.
- 공개 카드는 게시일 최신순으로 정렬되며 블로그는 9개, 유튜브는 6개 단위로 페이지가 나뉩니다.
- 현재 초기 데이터는 공식 네이버 블로그의 2024~2026년 공개 게시글 128건(2024년 41건, 2025년 34건, 2026년 53건)과 공식 유튜브 채널의 실제 영상 40건입니다. 새 글·영상은 관리자 화면의 분리된 카테고리에서 추가하면 게시일 기준 위치에 표시됩니다.

## 첫 화면과 지역·단지 설명

- `src/data/home-content.json`: 맨 위 대표 소개, 리더스시티 현장 사진 영역, 리더스시티 알아보기 문구
- `src/data/complexes.json`: 대전 동구의 지역·단지별 소개 제목, 문단, 사진, 기본 사실, 생활 특징, 복수 출처, 확인일
- 단지를 `published`로 공개하려면 사진 대체 텍스트, 기본 사실, 생활 특징, 하나 이상의 HTTPS 출처와 확인일이 필요합니다.
- 현재 초기 항목이 리더스시티 4·5블록이어도 시스템의 전체 범위를 두 블록으로 제한하지 않습니다.

단지 사실은 `항목명 | 값`, 생활 특징은 `제목 | 설명`, 출처는 `출처명 | HTTPS 주소` 형식으로 관리자 화면에 한 줄씩 입력합니다. 현장 사진은 원본 비율을 유지한 WebP로 저장합니다.

## 네이버 등록 매물 카드

- `src/data/naver-listings.json`에는 네이버페이 부동산에 공개된 개별 매물번호, 매물유형, 거래유형, 가격, 면적, 동 번호, 광고 층수, 방향, 설명, 확인일과 상세 URL을 기록합니다.
- 홈은 전체 매물을 사진 없는 카드로 6건씩 페이지 처리하고 `/properties/`는 전체 카드를 표시합니다. 홈과 전체 목록은 가격순·최신순·면적순 정렬을 제공하며, 각 카드는 `https://fin.land.naver.com/articles/<매물번호>`로 바로 이동합니다.
- 현재 초기 데이터는 2026-08-25에 확인한 매매 50건입니다. 네이버에서 매물이 추가·수정·종료되면 전체 목록을 다시 확인해 `checkedAt`과 각 항목을 함께 갱신합니다.
- 네이버 카드에 공개된 동 번호와 광고 층수는 그대로 쓸 수 있지만, 네이버에 없는 정확한 호수나 고객·소유자 정보는 추정해서 추가하지 않습니다.
- 중개사 매물 지도 주소는 `src/data/office.json`의 `naverListingsUrl`에서 별도로 관리하며, 블로그·유튜브 게시글 카드가 아니므로 `external-links.json`에 등록하지 않습니다.
- 갱신할 때는 중개사 상세 제목이 `리더스시티행복한공인중개사사무소`인지 확인하고, 각 URL의 매물번호가 항목의 `id`와 같은지 `npm run check`로 검증합니다.

## FAQ·문자 상담

- `/faq/`의 상담 작성 화면은 이름·회신 연락처·제목·내용을 서버나 저장소로 전송하지 않습니다.
- 제출하면 이용자의 문자 앱으로 내용을 전달하며, 문자 앱에서 실제 전송을 눌러야 상담이 접수됩니다.
- 서버 저장형 게시글 목록·비밀번호·삭제 기능은 D1 같은 별도 DB와 개인정보 보유·삭제 정책을 승인한 뒤 도입합니다.

`npm run check`가 실패하면 공개하지 말고 출력된 필드부터 수정합니다.
