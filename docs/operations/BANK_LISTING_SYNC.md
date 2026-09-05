# 부동산뱅크 공개 매물 자동 동기화

## 허용 근거와 범위

2026-08-26 부동산뱅크 1:1 문의에서 개발팀 확인 결과, 중개사 본인의 공개 매물을 하루 1회 정도 크롤링해 자체 홈페이지에 활용하는 범위가 허용된다는 답변을 받았다.

자동 동기화는 이 범위를 넘지 않는다.

- 대상: `https://land.neonet.co.kr/r/info/503143`의 공개 매물 목록
- 빈도: 매일 00:10 KST 한 번
- 요청: 공개 목록의 현재 페이지들만 순서대로 조회
- 수집: 매물명, 유형, 거래, 가격, 면적, 층, 방향, 설명, 등록기간 시작일, 부동산뱅크 매물번호, 네이버 매물번호
- 제외: 로그인, 관리자 화면, 부동산뱅크 상세 페이지, 네이버 페이지, 사진, 비공개 API

## 동기화 규칙

`src/data/naver-listings.json`은 부동산뱅크 매물과 다른 공급처의 네이버 매물을 함께 보관한다. `.github/bank-listing-sync-state.json`에는 직전 성공 실행에서 확인된 부동산뱅크 매물번호 관계만 기록한다.

1. 첫 실행은 공개 목록을 부동산뱅크 기준선으로 저장한다.
2. 같은 네이버 매물번호는 가격·층·방향·설명·등록일 등 공개 정보를 갱신한다. 등록일은 부동산뱅크 등록기간 시작일이며 다시 확인한 날짜로 바꾸지 않는다.
3. 신규 부동산뱅크 매물은 현재 목록 끝에 추가한다.
4. 직전 기준선에는 있었지만 이번 공개 목록에서 빠진 부동산뱅크 매물은 `naver-listings.json`에서도 삭제한다.
5. 기준선에 없던 다른 공급처 매물은 부동산뱅크 목록에 없더라도 유지한다.
6. 페이지 누락, 전체 건수 불일치, 중복 ID, 형식 변경, 개인정보 패턴, 콘텐츠 검증 실패가 있으면 어떤 파일도 커밋하지 않는다.

공개 카드의 더 자세한 기존 제목과 면적 표시는 유지한다. 신규 매물은 공개 목록에서 확인되는 단지·매물명과 면적으로 카드를 만든다. 네이버 URL은 공개 HTML의 네이버 매물번호로 `https://fin.land.naver.com/articles/{id}` 형식을 생성하며 네이버 페이지를 크롤링하지 않는다.

## 실행

파일을 바꾸지 않는 실제 공개 페이지 점검:

```bash
npm run sync:bank:dry-run
```

실제 파일 반영:

```bash
npm run sync:bank
```

정기 실행은 `.github/workflows/sync-bank-listings.yml`이 담당한다. `validate` job은 `contents: read` 권한으로 공개 목록 조회, 동기화, 테스트, 검사, Production-mode 빌드를 수행한다. 변경이 있을 때만 검증된 아래 두 파일을 artifact로 넘기며, 별도 `publish` job만 `contents: write` 권한으로 `master`에 커밋해 Cloudflare Git 연결이 Production을 다시 배포한다.

- `.github/bank-listing-sync-state.json`
- `src/data/naver-listings.json`

워크플로는 동기화 후 `npm test`, `npm run check`, 기본 빌드와 Production-mode SEO 빌드 검사를 모두 통과해야 커밋한다. checkout 자격 증명을 저장하지 않고 공식 Action은 검증한 commit SHA로 고정한다. 배포 직전 `master`가 검증 기준 SHA와 다르면 덮어쓰지 않고 실패한다. push 뒤에는 약 10분 동안 `https://leaderscityhappy.com/deployment-marker.json`의 `bank` marker가 예상값과 같은지 확인하며, 배포가 시작되지 않거나 다른 버전이 제공되면 Action을 실패로 표시한다.

단지별 운영 매물 건수는 동기화 때 증가·감소하거나 0건이 될 수 있으므로 테스트의 고정 기대값으로 사용하지 않는다. 단지 연결은 고정 fixture의 ID·추가·삭제·빈 목록으로 검증하고, 실제 운영 목록은 알려진 단지명의 매칭 누락을 검사한다. 화면 검증은 현재 목록의 단지별 ID와 상세 건수·최대 3건 미리보기·필터 결과를 대조한다.

첫 Production 실행은 2026-08-27에 완료했으며, 50건 부동산뱅크 기준선과 다른 공급처 매물 보존, 자동 커밋 `2c885955`, 공개 목록 반영을 확인했다. 이후에는 Actions summary의 신규·변경·삭제 수, Production marker 결과, 공개 카드와 네이버 링크를 함께 확인한다.
