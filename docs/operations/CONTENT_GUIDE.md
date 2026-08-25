# 공개 콘텐츠 수정 안내

관리자는 먼저 `/admin/`에 접속해 Cloudflare Access 이메일 OTP 인증을 거친 뒤 아래 관리 화면을 사용합니다.

- 매물: `/admin/listings/`
- 첫 화면·사무소·리더스시티 설명: `/admin/content/`
- 네이버 블로그·유튜브: `/admin/external-links/`
- 대전 동구 지역·단지 설명: `/admin/complexes/`

저장하면 GitHub에 커밋되고 Cloudflare 자동 배포 후 공개 화면에 반영됩니다. 저장 연결이 비활성화된 환경에서는 아래와 같이 파일을 직접 수정할 수 있습니다.

1. `src/data/`에서 수정할 JSON 파일을 연다.
2. 승인된 공개 정보만 수정한다.
3. 사진은 개인정보와 권리를 검수하고 최적화한 뒤 `public/images/content/<분류>/` 또는 승인된 기존 이미지 경로에 둔다.
4. `npm run check`와 `npm run build`를 실행한다.
5. GitHub에 반영하고 Preview에서 휴대폰 화면과 전화·문자 링크를 확인한다.
6. Production 반영 후 다시 확인한다.

매물에는 `id`, `slug`, 거래유형에 맞는 원 단위 가격, 전용면적, 최근 확인일, 출처가 필요합니다. 공개 전에 현행 중개대상물 표시·광고 기준을 운영자가 별도로 확인해야 합니다.

정확한 동·호수, 고객·소유자·임대인 연락처, 내부 메모, 계약서·신분증·등록증 원본은 이 저장소에 넣지 않습니다.

## 매물 작성 틀

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

## 첫 화면과 지역·단지 설명

- `src/data/home-content.json`: 맨 위 대표 소개, 사무소 사진 영역, 리더스시티 알아보기 문구
- `src/data/complexes.json`: 대전 동구의 지역·단지별 소개 제목, 문단, 출처, 확인일
- 단지를 `published`로 공개하려면 HTTPS 출처와 확인일이 필요합니다.
- 현재 초기 항목이 리더스시티 4·5블록이어도 시스템의 전체 범위를 두 블록으로 제한하지 않습니다.

`npm run check`가 실패하면 공개하지 말고 출력된 필드부터 수정합니다.
