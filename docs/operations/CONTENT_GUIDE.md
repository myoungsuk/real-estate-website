# 공개 콘텐츠 수정 안내

1. `src/data/`에서 수정할 JSON 파일을 연다.
2. 승인된 공개 정보만 수정한다.
3. 매물 사진은 개인정보와 권리를 검수하고 최적화한 뒤 `public/images/listings/<매물-id>/`에 둔다.
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
  "complex": "leaders-city-4",
  "salePriceKrw": 0,
  "depositKrw": null,
  "monthlyRentKrw": null,
  "exclusiveAreaM2": 0,
  "floorLabel": null,
  "direction": null,
  "moveIn": null,
  "summary": "change-me",
  "features": [],
  "source": "change-me",
  "confirmedAt": "YYYY-MM-DD",
  "publishedAt": null
}
```

- `id`와 `slug`: 영문 소문자·숫자·하이픈만 사용하고 기존 매물과 겹치지 않게 작성
- `tradeType`: 매매 `sale`, 전세 `jeonse`, 월세 `monthly-rent`
- `complex`: `leaders-city-4` 또는 `leaders-city-5`
- 매매: `salePriceKrw`만 원 단위 양의 정수, 나머지 가격은 `null`
- 전세: `depositKrw`만 원 단위 양의 정수, 나머지 가격은 `null`
- 월세: `depositKrw`, `monthlyRentKrw`를 원 단위 양의 정수로 작성하고 매매가는 `null`

`npm run check`가 실패하면 공개하지 말고 출력된 필드부터 수정합니다.
