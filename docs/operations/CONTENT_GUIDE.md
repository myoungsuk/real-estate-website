# 공개 콘텐츠 수정 안내

관리자는 먼저 `/admin/`에 접속해 Cloudflare Access 이메일 OTP 인증을 거친 뒤 아래 관리 화면을 사용합니다.

- 네이버 매물 확인: `/admin/listings/`
- 부동산뱅크 가져오기·직접 등록: `/admin/listings/editor/`
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

부동산뱅크 매물은 부동산뱅크 매물관리에서 내려받은 `.xls`를 `/admin/listings/editor/`에서 분석해 신규·변경·동일·사이트 전용 항목을 확인한 뒤 반영합니다. 그 밖의 네이버 매물은 같은 화면에서 네이버 매물번호·공개 제목·유형·거래·가격·면적·층·방향·설명·확인일을 직접 등록합니다. 광고가 끝난 매물은 해당 항목의 `등록 종료`로 한 건씩 제거합니다. 공개 전에 현행 중개대상물 표시·광고 기준을 운영자가 별도로 확인해야 합니다.

원본 엑셀은 서버나 GitHub로 전송되지 않습니다. 소유자·매도자·전화번호·정확한 호수·상세설명·메모를 결과에 넣지 않으며, 한방광고 엑셀과 네이버·부동산뱅크 크롤링은 지원하지 않습니다. 부동산뱅크 파일에 없는 기존·수동 매물은 자동 삭제되지 않습니다.

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

`src/data/external-links.json`의 각 항목은 `id`, `type`, `status`, `title`, `summary`, `url`, `publishedAt`, `thumbnail`을 사용합니다. YouTube 항목은 `youtubeFormat`에 일반 영상은 `video`, Shorts는 `short`를 반드시 입력합니다. 블로그 항목에는 이 필드를 넣지 않습니다.

- `status`가 `published`인 카드만 공개합니다.
- 블로그는 `blog.naver.com`, 유튜브는 `youtube.com` 또는 `youtu.be`의 HTTPS 주소만 허용합니다.
- 관리자 화면의 `정보 불러오기`는 제목과 썸네일을 보조로 가져옵니다. 결과를 사람이 확인한 뒤 저장해야 합니다.
- 썸네일을 불러오지 못하면 직접 올리고 의미 있는 사진 설명을 입력합니다.
- 원문 전체를 복제하거나 권한 없는 이미지를 사용하지 않습니다.
- 공개 카드는 게시일 최신순으로 정렬됩니다. 블로그는 9개 단위로 페이지가 나뉩니다. 유튜브는 전체·일반 영상·Shorts 필터를 한 목록에서 전환하며 홈은 선택 형식의 최신 6개만, `/youtube/`는 선택 형식을 6개 단위로 나눕니다. 필터를 바꾸면 1페이지로 돌아갑니다.
- 유튜브 카드는 hover 가능한 마우스·트랙패드가 카드 전체에 0.3초 머물 때 `youtube-nocookie.com`의 음소거 미리보기 한 개만 지연 로드합니다. 모바일과 움직임 최소화 환경에서는 자동 미리보기를 실행하지 않으며, 클릭하면 원문으로 이동합니다.
- 현재 초기 데이터는 공식 네이버 블로그의 2024~2026년 공개 게시글 128건(2024년 41건, 2025년 34건, 2026년 53건)과 `youtubeFormat: video`로 분류한 공식 유튜브 영상 40건입니다. 새 글·영상은 관리자 화면에서 직접 추가하거나 아래 수동 동기화 워크플로로 추가할 수 있습니다.

### 공식 RSS 수동 동기화

1차 운영 단계에서는 예약 실행 없이 GitHub Actions에서 사람이 시작합니다.

1. GitHub 저장소의 `Settings` → `Secrets and variables` → `Actions` → `Variables`에서 Repository Variable을 추가합니다.
   - Name: `YOUTUBE_CHANNEL_ID`
   - Value: `UCuOZDnM5vxOZELDgu-y-hNg`
   - 이 값은 공개 channelId이므로 Secret이나 `YOUTUBE_API_KEY`를 만들지 않습니다.
2. `Actions` → `Sync external content` → `Run workflow`에서 `master` 브랜치를 선택해 실행합니다.
3. 실행 로그의 신규 블로그·YouTube 건수, 생성 썸네일 수, 테스트·검사·빌드 결과와 커밋 SHA를 확인합니다.
4. 콘텐츠 커밋 뒤 Cloudflare의 새 Production 배포와 `https://leaderscityhappy.com/blog/`, `https://leaderscityhappy.com/youtube/` 반영을 확인합니다.

동기화는 공식 네이버 블로그 ID `p5468300`의 RSS와 위 YouTube 채널의 공식 Atom에서 보이는 신규 항목만 `published`로 추가합니다. YouTube alternate URL이 `/shorts/`이면 `youtubeFormat: short`, 나머지 허용 영상 URL은 `video`로 저장하고 공개 화면에서 두 목록을 분리합니다. 기존 항목의 요약·상태·썸네일을 덮어쓰거나 피드에서 사라진 항목을 삭제하지 않으며, 저장 URL은 공식 watch URL로 정규화합니다. RSS는 최근 항목 감지용이므로 전체 과거 글·영상 복원을 보장하지 않습니다. 장애가 복구되면 다음 피드 응답에 아직 포함된 누락 항목을 기존 ID와 비교해 추가합니다.

네트워크·408·425·429·5xx 같은 일시 장애는 최대 3회 재시도합니다. 공식 YouTube Atom 주소가 404를 반환하는 경우도 3회 재시도하고, 계속 실패하면 YouTube만 `skipped`로 표시해 Warning을 남긴 뒤 네이버의 정상 결과를 처리합니다. 반대로 네이버의 일시 장애 때는 YouTube만 처리합니다. 두 출처를 모두 조회하지 못하면 Action을 실패시킵니다. 재시도 대상이 아닌 HTTP 오류와 출처·채널·원본 ID·Content-Type·UTF-8·XML·최종 콘텐츠 검증 실패도 전체 실패하며 JSON과 이미지를 커밋하지 않습니다.

썸네일만 받지 못하면 해당 항목을 `thumbnail: null`로 추가하고 기존 화면의 대체 표시를 사용합니다. 콘텐츠 변경이 없으면 정상 종료하고, 45일 이상 자동화 활동이 없을 때만 `.github/automation-health.json`을 별도 커밋으로 갱신합니다. Actions summary의 `Blog source`, `YouTube source`, Warning에서 부분 성공 여부를 확인합니다.

로컬에서는 다음처럼 작업트리를 바꾸지 않는 실제 피드 검사를 할 수 있습니다.

```powershell
$env:YOUTUBE_CHANNEL_ID = "UCuOZDnM5vxOZELDgu-y-hNg"
npm run sync:external:dry-run
```

첫 수동 실행의 실제 신규 항목 커밋과 Cloudflare Production 반영, branch protection/ruleset 호환이 확인되기 전에는 schedule을 추가하지 않습니다.

## 첫 화면과 지역·단지 설명

- `src/data/home-content.json`: 맨 위 대표 소개, 리더스시티 현장 사진 영역, 리더스시티 알아보기 문구
- `src/data/complexes-overview.json`: 리더스시티 4·5블록 전체 소개, 숫자 카드, 비교표, 공통 생활권·현장 확인사항, 관련 공개 콘텐츠 ID, 출처와 확인일
- `src/data/complexes.json`: 대전 동구의 지역·단지별 소개, 사진, 기본 사실, 면적별 세대 구성, 공급 요약, 생활환경, 커뮤니티 확인 상태, 현장 확인사항, FAQ, 관련 공개 콘텐츠 ID, 복수 출처와 확인일
- 단지를 `published`로 공개하려면 사진 대체 텍스트, 기본 사실, 면적·공급·생활환경·시설 확인 상태, FAQ, 하나 이상의 HTTPS 출처와 확인일이 필요합니다.
- 현재 초기 항목이 리더스시티 4·5블록이어도 시스템의 전체 범위를 두 블록으로 제한하지 않습니다.

관리자 화면에서는 단순 항목은 `|` 구분 형식으로 입력합니다. 출처는 `ID | 발행처 | 표시 이름 | 종류 | 확인일 | HTTPS 주소 | 참고`, 관련 콘텐츠는 `external-links.json`의 공개 ID를 한 줄에 하나씩 입력합니다. 현재 시설 운영 여부를 확인하지 못했으면 `historical-plan` 또는 `check-required` 상태와 안내 문구를 유지합니다. 현장 사진은 원본 비율을 유지한 WebP로 저장합니다.

`npm run check`는 4블록 1,328세대, 5블록 공공임대 712세대·분양 1,423세대, 5블록 전체 2,135세대와 4·5블록 전체 3,463세대 합계를 확인합니다. 연결 콘텐츠 ID가 없거나 `draft`이면 검증이 실패합니다. 주차대수·정확한 사용승인일·4블록 난방방식처럼 조사 자료가 충돌하거나 운영자 확인이 남은 값은 임의로 입력하지 않습니다.

## 네이버 등록 매물 카드

- `src/data/naver-listings.json`에는 네이버페이 부동산에 공개된 개별 매물번호, 매물유형, 거래유형, 가격, 면적, 동 번호, 광고 층수, 방향, 설명, 확인일과 상세 URL을 기록합니다.
- 홈은 전체 매물을 사진 없는 카드로 6건씩 페이지 처리하고 `/properties/`는 전체 카드를 표시합니다. 홈과 전체 목록은 기본순, 가격 낮은·높은순, 최근 확인순, 면적 작은·큰순 정렬을 제공합니다. 최근 확인순은 `confirmedAt` 확인일 기준이며, 면적은 카드의 첫 번째 표시면적 기준이므로 서로 다른 유형을 비교할 때는 매물유형 필터를 먼저 선택합니다. 각 카드는 `https://fin.land.naver.com/articles/<매물번호>`로 바로 이동합니다.
- 현재 초기 데이터는 2026-08-25에 확인한 매매 50건입니다. 부동산뱅크 엑셀을 반영하거나 수동 등록·수정·등록 종료하면 `checkedAt`과 공개 항목을 함께 갱신하며, GitHub 커밋과 Cloudflare 자동 배포 후 공개 화면에 표시됩니다.
- 네이버 카드에 공개된 동 번호와 광고 층수는 그대로 쓸 수 있지만, 네이버에 없는 정확한 호수나 고객·소유자 정보는 추정해서 추가하지 않습니다.
- 중개사 매물 지도 주소는 `src/data/office.json`의 `naverListingsUrl`에서 별도로 관리하며, 블로그·유튜브 게시글 카드가 아니므로 `external-links.json`에 등록하지 않습니다.
- 갱신할 때는 중개사 상세 제목이 `리더스시티행복한공인중개사사무소`인지 확인하고, 각 URL의 매물번호가 항목의 `id`와 같은지 `npm run check`로 검증합니다.

## FAQ·문자 상담

- `/faq/`의 상담 작성 화면은 이름·회신 연락처·제목·내용을 서버나 저장소로 전송하지 않습니다.
- 제출하면 이용자의 문자 앱으로 내용을 전달하며, 문자 앱에서 실제 전송을 눌러야 상담이 접수됩니다.
- 서버 저장형 게시글 목록·비밀번호·삭제 기능은 D1 같은 별도 DB와 개인정보 보유·삭제 정책을 승인한 뒤 도입합니다.

`npm run check`가 실패하면 공개하지 말고 출력된 필드부터 수정합니다.
