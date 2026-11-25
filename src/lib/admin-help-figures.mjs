// 관리자 '사용 안내' 화면(/admin/help/)에만 넣는 단계 그림. 사용자 결정 2026-11-24 10:46:13 "B 단계 그림 줄 (추천)":
// 화면이 바뀔 때마다 그림 한 칸, 한 화면 안의 동작은 그 칸에 번호 여러 개. 사용 안내 화면에만 넣고 먼저 3곳. 그림이 화면과 달라지면 시험이 떨어져 다시 찍게 한다.
// (2026-11-19 14:03:46 "글만 넣기"를 이 세 곳에서 바꿈. '이 화면 사용법' 상자에는 그림을 넣지 않는다.)
//
// 그림은 손으로 찍지 않는다. `npm run build` 뒤 `npm run help:shots`가 e2e와 같은 가짜 업무 API로 화면을 열어 찍고,
// public/admin/help/img/*.webp와 src/lib/admin-help-images.json(번호 자리·크기·찍을 때의 화면 원본 지문)을 쓴다.
// sources는 그 지문을 셀 파일이다: 화면 .astro, 그림에 찍힌 칸을 그리는 스크립트, 그 칸의 글을 만드는 순수 함수만 둔다.
// 그림에 안 보이는 서버 요청·공용 서식·법령 자료·다른 칸 파일은 넣지 않는다(그림과 상관없는 PR이 시험에 걸려 다시 찍지 않게).
// 그 칸을 그리는 코드를 새 파일로 나누면 여기에 더한다. 화면이 불러오지 않는 파일은 tests/admin-help-images.test.mjs가 막는다.
// 칸(shot) 이름과 번호(pins) 개수는 e2e/help-shots/help-shots.shot.mjs가 찍는 것과 같아야 한다(tests/admin-help-images.test.mjs가 봄).
// pins의 작은따옴표 이름은 다른 사용 안내 문구처럼 화면 원본과 대조한다(tests/admin-help.test.mjs). 번호는 그림 줄 전체에서 이어진다.
// phone은 979px 이하(휴대폰 390px로 찍음), wide는 980px 이상(PC 1280px로 찍음)에서 보이고, 숨은 쪽 그림은 받지 않는다.
//
// 2026-11-24 14:13:32 사용자 "AI 관련 기능이나 어려워 보이는거만 해 그럼": 계약서 AI·글 초안·홍보물·매물 안내지·매물 등록·변경 이력에 더함.
// 두 화면에 걸친 일(계약서 AI 상자 → 결과 고르기, 실거래가 담기 → 홍보물 화면)은 화면마다 그림 하나씩 둔다(그림마다 route 하나).
// staleness: "warn"인 그림은 sources가 바뀌어도 시험을 떨어뜨리지 않고 '다시 찍을 그림' 경고만 남긴다
// (2026-11-24 사용자 결정 "AI 칸만 경고": 가장 자주 고치는 계약서 AI 두 화면만). 그 밖의 그림은 낡으면 시험이 떨어진다.

// 그림 한 장 크기 상한(WebP). 넘으면 scripts/help-shots.mjs와 tests/admin-help-images.test.mjs가 실패한다.
export const ADMIN_HELP_IMAGE_MAX_BYTES = 70 * 1024;

/**
 * @typedef {{ shot: string, alt: string, pins: string[] }} AdminHelpFrame
 * @typedef {{ section: string, route: string, sources: string[], title: string, note?: string, staleness?: "warn", phone: AdminHelpFrame[], wide: AdminHelpFrame[] }} AdminHelpFigure
 * note: 그림과 실제 화면이 켜기 값에 따라 다를 때 그림 제목 아래 한 줄로 알린다.
 * staleness: "warn"이면 낡아도 경고만(위 설명). 없으면 낡을 때 시험 실패.
 */

/** @type {Readonly<Record<string, AdminHelpFigure>>} */
export const ADMIN_HELP_FIGURES = Object.freeze({
  "contract-copy": {
    section: "work-customers-detail",
    route: "/admin/work/customers/detail/",
    sources: [
      "src/pages/admin/work/customers/detail.astro",
      "src/lib/work-contract-copy-section.ts",
      "src/lib/work-mask-canvas.ts",
      "src/lib/work/contract-copy-view.mjs",
    ],
    title: "계약서 사본 올리기(주민등록번호 칠하기)",
    // 그림은 계약서 AI를 끈 가짜 세션으로 찍는다(AI 상자 파일이 sources에 들지 않게). 운영은 2026-11-24부터 AI가 켜져 있다.
    note: "계약서 AI가 켜져 있으면 펼친 칸 맨 아래에 'AI로 일정 뽑기' 상자가 더 보입니다. 그림에는 넣지 않았고, 쓰는 법은 아래 '계약서 AI 일정 뽑기'에 있습니다.",
    phone: [
      {
        shot: "contract-phone-1-panel",
        alt: "손님 카드 거래 칸에서 계약서 사본 단추를 펼친 모습. 올려 둔 사본 한 줄 아래에 '계약서 찍기'·'사진첩에서 고르기' 단추가 있다.",
        pins: ["거래 칸의 계약서 사본 단추를 눌러 펼칩니다.", "'계약서 찍기'로 찍거나, 찍어 둔 사진은 '사진첩에서 고르기'로 한 장 고릅니다."],
      },
      {
        shot: "contract-phone-2-mask",
        alt: "화면 전체에 열린 주민등록번호 가리기 창. 가상 계약서 사진의 주민등록번호 두 곳이 검게 칠해져 있고, 아래에 가린 곳 수와 '다 가렸음, 확대해서 확인' 단추가 있다.",
        pins: ["주민등록번호를 손가락으로 끌어 검게 칠합니다. 틀리면 '되돌리기'를 누릅니다.", "가린 곳 수가 주민등록번호 수와 같은지 봅니다.", "'다 가렸음, 확대해서 확인'을 누릅니다."],
      },
      {
        shot: "contract-phone-3-zoom",
        alt: "가린 자리 확인 창. 크게 키운 사진에서 주민등록번호 자리가 검은 네모로 덮여 있고, 아래에 '주민번호 가림 확인, 올리기' 단추가 있다.",
        pins: ["사진을 끌어 옮기며 주민등록번호가 한 글자도 안 보이는지 봅니다.", "'주민번호 가림 확인, 올리기'를 누릅니다."],
      },
      {
        shot: "contract-phone-4-done",
        alt: "계약서 사본 칸 목록 맨 위에 방금 올린 사본 줄이 생긴 모습.",
        pins: ["올린 사본이 목록 맨 위에 생깁니다. '보기'로 열어 볼 수 있습니다."],
      },
    ],
    wide: [
      {
        shot: "contract-wide-1-panel",
        alt: "손님 카드 거래 칸에서 계약서 사본 단추를 펼친 모습. 올려 둔 사본 한 줄 아래에 '계약서 찍기'·'사진첩에서 고르기' 단추가 있다.",
        pins: ["거래 칸의 계약서 사본 단추를 눌러 펼칩니다.", "찍어 둔 계약서 사진을 '사진첩에서 고르기'로 한 장 고릅니다."],
      },
      {
        shot: "contract-wide-2-mask",
        alt: "화면 전체에 열린 주민등록번호 가리기 창. 가상 계약서 사진의 주민등록번호 두 곳이 검게 칠해져 있고, 아래에 가린 곳 수와 '다 가렸음, 확대해서 확인' 단추가 있다.",
        pins: ["주민등록번호를 마우스로 끌어 검게 칠합니다. 틀리면 '되돌리기'를 누릅니다.", "가린 곳 수가 주민등록번호 수와 같은지 봅니다.", "'다 가렸음, 확대해서 확인'을 누릅니다."],
      },
      {
        shot: "contract-wide-3-zoom",
        alt: "가린 자리 확인 창. 크게 키운 사진에서 주민등록번호 자리가 검은 네모로 덮여 있고, 아래에 '주민번호 가림 확인, 올리기' 단추가 있다.",
        pins: ["사진을 끌어 옮기며 주민등록번호가 한 글자도 안 보이는지 봅니다.", "'주민번호 가림 확인, 올리기'를 누릅니다."],
      },
      {
        shot: "contract-wide-4-done",
        alt: "계약서 사본 칸 목록 맨 위에 방금 올린 사본 줄이 생긴 모습.",
        pins: ["올린 사본이 목록 맨 위에 생깁니다. '보기'로 열어 볼 수 있습니다."],
      },
    ],
  },
  "ledger-edit": {
    section: "work-ledger",
    route: "/admin/work/ledger/",
    sources: [
      "src/pages/admin/work/ledger.astro",
      "src/lib/work-ledger-dom.ts",
      "src/lib/work-ledger-grid.ts",
      "src/lib/work/ledger-grid.mjs",
      "src/lib/work/ledger-view.mjs",
    ],
    title: "장부 줄 고치기",
    phone: [
      {
        shot: "ledger-phone-1-card",
        alt: "휴대폰 매출장부의 장부 줄 카드 한 장. 카드 아래쪽에 '고치기' 단추가 있다.",
        pins: ["휴대폰에서는 고칠 장부 줄의 '고치기'를 누릅니다."],
      },
      {
        shot: "ledger-phone-2-form",
        alt: "장부 줄 고치기 화면의 '입금액(원)'·'입금일' 칸과 그 아래 '장부 줄 저장' 단추.",
        pins: ["바꿀 칸(예: '입금액(원)'·'입금일')을 고칩니다.", "'장부 줄 저장'을 누릅니다."],
      },
    ],
    wide: [
      {
        shot: "ledger-wide-1-saved",
        alt: "넓은 화면 매출장부 표. 고친 공급가액 칸, 그 줄 끝의 '저장함', 줄 아래의 부가세 안내, 표 위의 되돌리기 단추가 표시돼 있다.",
        pins: ["고칠 칸을 누르고 새 값을 넣은 뒤 Enter를 누릅니다(그만두려면 Esc).", "줄 끝에 '저장함'이 나옵니다. 부가세가 10%였던 줄은 부가세도 함께 바뀌었다고 줄 아래에 알립니다.", "잘못 고쳤으면 '되돌리기'를 누릅니다."],
      },
    ],
  },
  "calendar-feed": {
    section: "work-schedule",
    route: "/admin/work/schedule/",
    sources: ["src/pages/admin/work/schedule.astro", "src/lib/work-qr-canvas.ts", "src/lib/work/calendar-feed-view.mjs"],
    title: "휴대폰 캘린더 구독",
    phone: [
      {
        shot: "calendar-phone-1-empty",
        alt: "계약 일정 화면 맨 아래 휴대폰 캘린더 구독 칸. '구독 주소 만들기' 단추가 있다.",
        pins: ["'구독 주소 만들기'를 누릅니다."],
      },
      {
        shot: "calendar-phone-2-made",
        alt: "구독 주소를 만든 뒤의 칸. 주소 글자는 흐리게 가려져 있고, 그 아래 '주소 복사'·'iPhone 캘린더에 넣기'·'Google 캘린더에 넣기'와 QR 보기 단추가 있다.",
        pins: ["이 휴대폰이 iPhone이면 'iPhone 캘린더에 넣기'를 누릅니다.", "Android면 'Google 캘린더에 넣기'를 누릅니다.", "다른 휴대폰에 넣으려면 'iPhone용 QR 보기'나 'Android용 QR 보기'를 누릅니다."],
      },
      {
        shot: "calendar-phone-3-qr",
        alt: "구독 칸에 QR 그림이 떠 있는 모습.",
        pins: ["그 휴대폰 카메라로 QR을 비춥니다. 다 넣었으면 'QR 숨기기'를 누릅니다."],
      },
    ],
    wide: [
      {
        shot: "calendar-wide-1-empty",
        alt: "계약 일정 화면 맨 아래 휴대폰 캘린더 구독 칸. '구독 주소 만들기' 단추가 있다.",
        pins: ["'구독 주소 만들기'를 누릅니다."],
      },
      {
        shot: "calendar-wide-2-made",
        alt: "구독 주소를 만든 뒤의 칸. 주소 글자는 흐리게 가려져 있고, 그 아래 넣기 단추들과 QR 보기 단추가 있다.",
        pins: ["컴퓨터에서 만들었으면 휴대폰에 넣을 차례입니다. 그 휴대폰이 iPhone이면 'iPhone용 QR 보기', Android면 'Android용 QR 보기'를 누릅니다."],
      },
      {
        shot: "calendar-wide-3-qr",
        alt: "구독 칸에 QR 그림이 떠 있는 모습.",
        pins: ["휴대폰 카메라로 QR을 비춥니다. 다 넣었으면 'QR 숨기기'를 누릅니다."],
      },
    ],
  },
  "contract-ai-box": {
    section: "work-customers-ai",
    route: "/admin/work/customers/detail/",
    sources: ["src/pages/admin/work/customers/detail.astro", "src/lib/work-ai-section.ts", "src/lib/work/contract-ai-view.mjs"],
    staleness: "warn",
    title: "AI로 일정 뽑기 시작하기",
    note: "그림 속 금액·남은 한도는 예시입니다. 실제 값은 그때 화면에 나옵니다.",
    phone: [
      {
        shot: "aibox-phone-1-start",
        alt: "계약서 사본 칸을 펼친 맨 아래 'AI로 일정 뽑기' 상자. 사본 두 장이 체크돼 있고, 읽는 방법·비용·남은 한도·걸리는 시간 표와 고른 장수가 적힌 일정 뽑기 단추(예: 사본 2장으로 일정 뽑기)가 있다.",
        pins: ["AI가 읽을 사본을 체크합니다(한 번에 5장까지).", "먼저 잡아 둘 비용과 남은 한도를 봅니다.", "아래 단추(예: 사본 2장으로 일정 뽑기)를 누르면 읽기 시작합니다. 몇 분 걸리고, 화면을 닫아도 됩니다."],
      },
      {
        shot: "aibox-phone-2-ready",
        alt: "읽기가 끝난 'AI로 뽑은 값' 상자. '결과 나옴' 꼬리표, 읽은 칸 수, '결과 보고 고르기'·'결과 버리기' 단추가 있다.",
        pins: ["'결과 나옴'이 뜨면 '결과 보고 고르기'를 누릅니다."],
      },
    ],
    wide: [
      {
        shot: "aibox-wide-1-start",
        alt: "계약서 사본 칸을 펼친 맨 아래 'AI로 일정 뽑기' 상자. 사본 두 장이 체크돼 있고, 읽는 방법·비용·남은 한도·걸리는 시간 표와 고른 장수가 적힌 일정 뽑기 단추(예: 사본 2장으로 일정 뽑기)가 있다.",
        pins: ["AI가 읽을 사본을 체크합니다(한 번에 5장까지).", "먼저 잡아 둘 비용과 남은 한도를 봅니다.", "아래 단추(예: 사본 2장으로 일정 뽑기)를 누르면 읽기 시작합니다. 몇 분 걸리고, 화면을 닫아도 됩니다."],
      },
      {
        shot: "aibox-wide-2-ready",
        alt: "읽기가 끝난 'AI로 뽑은 값' 상자. '결과 나옴' 꼬리표, 읽은 칸 수, '결과 보고 고르기'·'결과 버리기' 단추가 있다.",
        pins: ["'결과 나옴'이 뜨면 '결과 보고 고르기'를 누릅니다."],
      },
    ],
  },
  "contract-ai-review": {
    section: "work-customers-ai",
    route: "/admin/work/ai/review/",
    sources: ["src/pages/admin/work/ai/review.astro", "src/lib/work-ai-review.ts", "src/lib/work/contract-ai-view.mjs", "src/lib/work/contract-compare.mjs"],
    staleness: "warn",
    title: "AI 결과 골라 거래에 넣기",
    phone: [
      {
        shot: "aireview-phone-1-pick",
        alt: "결과 고르기 화면 위쪽. 노란 '금액 확인' 경고 줄, 확인할 칸 수, '모두 AI 값으로' 단추, 계약일 카드의 AI 값·'지금 값 그대로'·'직접 넣기' 단추가 있다.",
        pins: ["노란 '금액 확인' 줄이 보이면 계약서 사진에서 금액을 다시 봅니다.", "사진과 맞으면 '모두 AI 값으로'를 누릅니다.", "다른 칸만 '지금 값 그대로'나 '직접 넣기'로 고칩니다. 다 고르면 아래 '확인으로 넘어가기'를 누릅니다."],
      },
      {
        shot: "aireview-phone-2-confirm",
        alt: "'거래에 넣기 전 확인' 화면. 지금 값에서 넣을 값으로 바뀌는 칸, 다시 계산한 일정 목록, '거래에 넣기' 단추가 있다.",
        pins: ["바뀌는 칸(지금 값 → 넣을 값)과 다시 계산한 일정을 봅니다.", "맞으면 '거래에 넣기'를 누릅니다. 고칠 것이 있으면 '값 고르기로 돌아가기'."],
      },
    ],
    wide: [
      {
        shot: "aireview-wide-1-pick",
        alt: "넓은 화면 결과 고르기. 왼쪽에 계약서 사진과 계약일 근거 상자, 오른쪽에 노란 '금액 확인' 줄, '모두 AI 값으로' 단추, 칸마다 고르는 표가 있다.",
        pins: ["왼쪽 사진에서 근거 자리를 봅니다. 칸의 '사진에서 보기'를 누르면 그 자리로 옮겨 갑니다.", "노란 '금액 확인' 줄이 보이면 사진에서 금액을 다시 봅니다.", "사진과 맞으면 '모두 AI 값으로'를 누르고, 다른 칸만 '지금 값 그대로'나 '직접 넣기'로 고친 뒤 '확인으로 넘어가기'를 누릅니다."],
      },
      {
        shot: "aireview-wide-2-confirm",
        alt: "'거래에 넣기 전 확인' 화면. 지금 값에서 넣을 값으로 바뀌는 칸, 다시 계산한 일정 목록, '거래에 넣기' 단추가 있다.",
        pins: ["바뀌는 칸(지금 값 → 넣을 값)과 다시 계산한 일정을 봅니다.", "맞으면 '거래에 넣기'를 누릅니다. 고칠 것이 있으면 '값 고르기로 돌아가기'."],
      },
    ],
  },
  "blog-draft": {
    section: "work-blog",
    route: "/admin/work/blog/",
    sources: ["src/pages/admin/work/blog.astro", "src/lib/work-blog-card.ts", "src/lib/work/blog-view.mjs", "src/lib/work/blog-checks.mjs", "src/lib/work/blog-cards.mjs", "src/lib/work/blog-places.mjs", "src/lib/work/blog-style-view.mjs", "src/lib/work/blog-set-view.mjs", "src/lib/work-blog-backgrounds.ts", "src/lib/work/blog-backgrounds-view.mjs"],
    title: "단지 소개 글 초안 만들기",
    note: "그림 속 글은 예시입니다. 매물 글은 2단계에서 명시사항 빈 칸을 다 채워야 만들 수 있습니다.",
    phone: [
      {
        shot: "blog-phone-1-source",
        alt: "글 초안 1단계 자료 고르기. '단지 소개'가 골라져 있고 단지 목록에 '고르기' 단추가 있다.",
        pins: ["무엇을 쓸지('매물'·'단지 소개') 고릅니다.", "쓸 자료의 '고르기'를 누릅니다."],
      },
      {
        shot: "blog-phone-2-style",
        alt: "글 초안 3단계 윗부분. 묶음 넷으로 나뉜 글 성격 단추들(자료에 맞지 않는 것은 줄이 그어져 잠김)과 메모 칸 위 '빠르게 넣기' 단추 줄이 있다.",
        pins: ["글 성격을 하나 고릅니다. 줄이 그어진 것은 이 자료에 맞지 않아 잠긴 것입니다.", "글에 넣을 사실을 메모 칸에 적습니다. '빠르게 넣기' 단추를 누르면 머리말이 들어갑니다."],
      },
      {
        shot: "blog-phone-2-make",
        alt: "글 초안 3단계 아랫부분. '몇 편' 단추 둘('3편 같이 만들기'가 골라져 있음, '1편만'), 쓸 한도·오늘 남은 편수·예상 비용을 적은 한 줄, '글 초안 만들기' 단추가 있다.",
        pins: ["몇 편 만들지 고릅니다. 처음은 '3편 같이 만들기'(첫 문장·짜임만 다른 3편, 한도 3편 몫)이고, 한 편만 필요하면 '1편만'을 고릅니다.", "단추 위 한 줄에서 쓸 한도와 예상 비용을 확인하고 '글 초안 만들기'를 누릅니다. 1 ~ 3분 걸립니다."],
      },
      {
        shot: "blog-phone-3-result",
        alt: "만든 글 초안의 윗부분. 올릴 곳 단추 넷(블로그·인스타그램·스레드·카카오톡) 아래에 고칠 곳 수를 알리는 빨간 상자(복사 전에 고칠 곳 1곳)이 있고, 가격이 들어간 소제목 칸이 빨갛게 표시돼 '복사 막힘'이라고 적혀 있다.",
        pins: ["올릴 곳(블로그·인스타그램·스레드·카카오톡)을 고릅니다. 고른 곳에 맞는 글 칸과 복사 단추가 나옵니다.", "'고칠 곳'이 있으면 무엇이 문제인지 읽습니다.", "빨갛게 표시된 칸을 고칩니다. 고칠 곳이 없어지면 맨 아래 '블로그 글 복사'가 켜집니다. 명시사항까지 함께 복사됩니다."],
      },
      {
        shot: "blog-phone-4-cards",
        alt: "결과 아래 '카드 그림' 칸. 표지·단지 정보·확인할 점 카드 그림과 한 번에 내려받는 단추(카드 3장 저장)가 있다.",
        pins: ["단지 소개 초안이면 공개 단지 자료로 만든 카드 그림이 생깁니다.", "맨 아래 단추(예: 카드 3장 저장)로 한 번에 내려받습니다."],
      },
    ],
    wide: [
      {
        shot: "blog-wide-1-source",
        alt: "글 초안 1단계 자료 고르기. '단지 소개'가 골라져 있고 단지 목록에 '고르기' 단추가 있다.",
        pins: ["무엇을 쓸지('매물'·'단지 소개') 고릅니다.", "쓸 자료의 '고르기'를 누릅니다."],
      },
      {
        shot: "blog-wide-2-style",
        alt: "글 초안 3단계 윗부분. 묶음 넷으로 나뉜 글 성격 단추들(자료에 맞지 않는 것은 줄이 그어져 잠김)과 메모 칸 위 '빠르게 넣기' 단추 줄이 있다.",
        pins: ["글 성격을 하나 고릅니다. 줄이 그어진 것은 이 자료에 맞지 않아 잠긴 것입니다.", "글에 넣을 사실을 메모 칸에 적습니다. '빠르게 넣기' 단추를 누르면 머리말이 들어갑니다."],
      },
      {
        shot: "blog-wide-2-make",
        alt: "글 초안 3단계 아랫부분. '몇 편' 단추 둘('3편 같이 만들기'가 골라져 있음, '1편만'), 쓸 한도·오늘 남은 편수·예상 비용을 적은 한 줄, '글 초안 만들기' 단추가 있다.",
        pins: ["몇 편 만들지 고릅니다. 처음은 '3편 같이 만들기'(첫 문장·짜임만 다른 3편, 한도 3편 몫)이고, 한 편만 필요하면 '1편만'을 고릅니다.", "단추 위 한 줄에서 쓸 한도와 예상 비용을 확인하고 '글 초안 만들기'를 누릅니다. 1 ~ 3분 걸립니다."],
      },
      {
        shot: "blog-wide-3-result",
        alt: "만든 글 초안. 위에 올릴 곳 단추 넷(블로그·인스타그램·스레드·카카오톡)과 고칠 곳 수를 알리는 빨간 상자(복사 전에 고칠 곳 1곳)이 있고, 가격이 들어간 소제목 칸이 빨갛게 표시돼 있으며, 오른쪽 '블로그 글 복사' 단추는 아직 꺼져 있다.",
        pins: ["올릴 곳(블로그·인스타그램·스레드·카카오톡)을 고릅니다. 고른 곳에 맞는 글 칸과 복사 단추가 나옵니다.", "'고칠 곳'이 있으면 무엇이 문제인지 읽고, 아래에서 빨갛게 표시된 칸을 고칩니다.", "고칠 곳이 없어지면 '블로그 글 복사'가 켜집니다. 명시사항까지 함께 복사됩니다."],
      },
      {
        shot: "blog-wide-4-cards",
        alt: "결과 아래 '카드 그림' 칸. 표지·단지 정보·확인할 점 카드 그림과 한 번에 내려받는 단추(카드 3장 저장)가 있다.",
        pins: ["단지 소개 초안이면 공개 단지 자료로 만든 카드 그림이 생깁니다.", "맨 아래 단추(예: 카드 3장 저장)로 한 번에 내려받습니다."],
      },
    ],
  },
  "promo-pick": {
    section: "work-realprice-promo",
    route: "/admin/work/realprice/",
    sources: ["src/pages/admin/work/realprice/index.astro", "src/lib/work/realprice-view.mjs", "src/lib/work-realprice-card.ts"],
    title: "실거래가 목록에서 거래 담기",
    phone: [
      {
        shot: "promo-phone-1-pick",
        alt: "휴대폰 실거래가 목록. 거래 카드 두 장의 담기 칸에 체크가 되어 있고, 아래 막대에 담은 거래 수(담은 거래 2건)와 '홍보물 만들기'가 있다.",
        pins: ["넣을 거래 카드의 오른쪽 아래 담기 칸을 누릅니다(최대 6건).", "'홍보물 만들기'를 누릅니다."],
      },
    ],
    wide: [
      {
        shot: "promo-wide-1-pick",
        alt: "넓은 화면 실거래가 표. 두 줄의 맨 앞 담기 칸에 체크가 되어 있고, 오른쪽 '미리보기' 칸에 카드 모양 단추, 카드 그림과 '그림 저장' 단추가 있다.",
        pins: ["넣을 거래 줄 맨 앞의 담기 칸을 누릅니다(최대 6건).", "1221px 이상 화면은 오른쪽 '미리보기' 칸에 카드 그림이 바로 생깁니다.", "칸에서 바로 '그림 저장'을 누르고, 그 아래 올릴 곳 단추로 글을 복사합니다. 좁은 화면은 아래 막대의 '홍보물 만들기'를 누릅니다."],
      },
    ],
  },
  "promo-make": {
    section: "work-realprice-promo",
    route: "/admin/work/realprice/promo/",
    sources: ["src/pages/admin/work/realprice/promo.astro", "src/lib/work-realprice-card.ts", "src/lib/work/realprice-promo.mjs"],
    title: "홍보물 화면에서 그림 저장·글 복사",
    phone: [
      {
        shot: "promo-phone-2-card",
        alt: "홍보물 화면. '카드 모양' 단추 4개(기본·깔끔 카드·잡지·다크), 카드 그림, '그림 저장' 단추가 있다.",
        pins: ["'카드 모양'을 고릅니다. 바꾸면 그림만 다시 그립니다.", "'그림 저장'을 누릅니다."],
      },
      {
        shot: "promo-phone-3-post",
        alt: "올릴 곳 단추 4개. 인스타그램 단추에 '✓ 복사됨' 표시가 있고 아래에 글자 수와 할 일 안내가 있다.",
        pins: ["올릴 곳 단추를 누르면 그곳에 맞춘 글이 복사됩니다. 그 앱에서 그림을 넣고 글을 붙여 넣습니다."],
      },
    ],
    wide: [
      {
        shot: "promo-wide-2-card",
        alt: "홍보물 화면. '카드 모양' 단추 4개(기본·깔끔 카드·잡지·다크), 카드 그림, '그림 저장' 단추가 있다.",
        pins: ["'카드 모양'을 고릅니다. 바꾸면 그림만 다시 그립니다.", "'그림 저장'을 누릅니다."],
      },
      {
        shot: "promo-wide-3-post",
        alt: "올릴 곳 단추 4개. 인스타그램 단추에 '✓ 복사됨' 표시가 있고 아래에 글자 수와 할 일 안내가 있다.",
        pins: ["올릴 곳 단추를 누르면 그곳에 맞춘 글이 복사됩니다. 그 앱에서 그림을 넣고 글을 붙여 넣습니다."],
      },
    ],
  },
  "listing-paper": {
    section: "work-listing-paper",
    route: "/admin/work/listing-paper/",
    sources: ["src/pages/admin/work/listing-paper.astro", "src/lib/work-listing-card.ts", "src/lib/work-disclosure-fields.ts", "src/lib/work/listing-paper.mjs"],
    title: "매물 안내지 만들기",
    note: "그림 속 매물은 그날 공개 매물이고, 소재지·관리비 같은 넣은 값은 예시입니다.",
    phone: [
      {
        shot: "listing-phone-1-pick",
        alt: "매물 안내지 화면의 공개 매물 목록. 찾기 칸 아래 매물 한 건의 '담기' 단추가 눌려 있고 담은 매물 수(담은 매물 1 / 3)가 보인다.",
        pins: ["찾기 칸에 단지 이름 등을 넣어 좁힙니다.", "넣을 매물의 단추를 눌러 담습니다(같은 종류·거래 형태끼리 3건까지)."],
      },
      {
        shot: "listing-phone-2-fill",
        alt: "담은 매물의 명시사항 칸 윗부분. 매물 이름 아래 '✓ 명시사항을 다 채웠습니다.' 줄이 있고 소재지·건물 종류·위반건축물 칸이 채워져 있다. 그 아래로 층·관리비 등 칸이 더 있다.",
        pins: ["명시사항 칸을 모두 채웁니다. 빈 칸이 있으면 그림을 만들지 않습니다.", "'✓ 명시사항을 다 채웠습니다.'가 나오면 다 된 것입니다."],
      },
      {
        shot: "listing-phone-3-image",
        alt: "만든 안내지 그림과 '그림 저장' 단추.",
        pins: ["'안내지 그림 만들기'를 눌러 만든 그림을 봅니다.", "'그림 저장'으로 내려받습니다."],
      },
    ],
    wide: [
      {
        shot: "listing-wide-1-pick",
        alt: "매물 안내지 화면의 공개 매물 목록. 찾기 칸 아래 매물 한 건의 '담기' 단추가 눌려 있고 담은 매물 수(담은 매물 1 / 3)가 보인다.",
        pins: ["찾기 칸에 단지 이름 등을 넣어 좁힙니다.", "넣을 매물의 단추를 눌러 담습니다(같은 종류·거래 형태끼리 3건까지)."],
      },
      {
        shot: "listing-wide-2-fill",
        alt: "담은 매물의 명시사항 칸 윗부분. 매물 이름 아래 '✓ 명시사항을 다 채웠습니다.' 줄이 있고 소재지·건물 종류·위반건축물 칸이 채워져 있다. 그 아래로 층·관리비 등 칸이 더 있다.",
        pins: ["명시사항 칸을 모두 채웁니다. 빈 칸이 있으면 그림을 만들지 않습니다.", "'✓ 명시사항을 다 채웠습니다.'가 나오면 다 된 것입니다."],
      },
      {
        shot: "listing-wide-3-image",
        alt: "만든 안내지 그림과 '그림 저장' 단추.",
        pins: ["'안내지 그림 만들기'를 눌러 만든 그림을 봅니다.", "'그림 저장'으로 내려받습니다."],
      },
    ],
  },
  "bank-import": {
    section: "listings-editor",
    route: "/admin/listings/editor/",
    sources: ["src/pages/admin/listings/editor.astro", "src/lib/admin/bank-listing-import.mjs"],
    title: "부동산뱅크 엑셀 가져오기",
    note: "그림 속 엑셀은 지어낸 시험 파일이고, 목록의 매물은 그날 공개 매물입니다.",
    phone: [
      {
        shot: "bank-phone-1-file",
        alt: "'엑셀 매물 가져오기' 칸. 파일 고르기 칸과 '파일 분석' 단추가 있다.",
        pins: ["부동산뱅크에서 엑셀출력한 .xls 파일을 고릅니다.", "'파일 분석'을 누릅니다. 파일은 서버로 가지 않습니다."],
      },
      {
        shot: "bank-phone-2-preview",
        alt: "분석 결과. 전체·신규·변경·동일·사이트만·확인 필요 숫자 칸과 변경 미리보기 목록(신규·변경·유지), '변경사항 반영' 단추가 있다.",
        pins: ["숫자 칸에서 신규·변경 수와 '확인 필요'가 0인지 봅니다.", "변경 미리보기에서 바뀌는 매물을 봅니다. '유지'는 이번 엑셀에 없어도 지우지 않는 매물입니다. 다 봤으면 목록 맨 아래 '변경사항 반영'을 누릅니다."],
      },
      {
        shot: "bank-phone-3-review",
        alt: "'저장 전 변경 내용 확인' 창. 영향 화면과 바뀌는 칸 목록이 있고, 창 아래에 '검증 후 최종 저장' 단추가 붙어 있다.",
        pins: ["영향 화면과 바뀌는 내용을 봅니다.", "창을 끝까지 내려 '사전 검증 완료' 줄을 본 뒤 '검증 후 최종 저장'을 누릅니다. 그 뒤 '배포 상태'에서 공개 반영을 확인합니다."],
      },
    ],
    wide: [
      {
        shot: "bank-wide-1-file",
        alt: "'엑셀 매물 가져오기' 칸. 파일 고르기 칸과 '파일 분석' 단추가 있다.",
        pins: ["부동산뱅크에서 엑셀출력한 .xls 파일을 고릅니다.", "'파일 분석'을 누릅니다. 파일은 서버로 가지 않습니다."],
      },
      {
        shot: "bank-wide-2-preview",
        alt: "분석 결과. 전체·신규·변경·동일·사이트만·확인 필요 숫자 칸과 변경 미리보기 목록(신규·변경·유지), '변경사항 반영' 단추가 있다.",
        pins: ["숫자 칸에서 신규·변경 수와 '확인 필요'가 0인지 봅니다.", "변경 미리보기에서 바뀌는 매물을 봅니다. '유지'는 이번 엑셀에 없어도 지우지 않는 매물입니다. 다 봤으면 목록 맨 아래 '변경사항 반영'을 누릅니다."],
      },
      {
        shot: "bank-wide-3-review",
        alt: "'저장 전 변경 내용 확인' 창. 영향 화면과 바뀌는 칸 목록이 있고, 창 아래에 '검증 후 최종 저장' 단추가 붙어 있다.",
        pins: ["영향 화면과 바뀌는 내용을 봅니다.", "창을 끝까지 내려 '사전 검증 완료' 줄을 본 뒤 '검증 후 최종 저장'을 누릅니다. 그 뒤 '배포 상태'에서 공개 반영을 확인합니다."],
      },
    ],
  },
  "content-restore": {
    section: "history",
    route: "/admin/history/",
    sources: ["src/pages/admin/history/index.astro", "src/components/admin/AdminContentHistory.astro"],
    title: "예전 내용으로 되돌리기",
    note: "그림 속 이력·문구는 예시입니다.",
    phone: [
      {
        shot: "history-phone-1-list",
        alt: "변경 이력 화면. '콘텐츠 종류'에 '첫 화면 콘텐츠'가 골라져 있고, 아래 변경 목록마다 '변경 확인' 단추가 있다.",
        pins: ["'콘텐츠 종류'를 고르고 '변경 이력 불러오기'를 누릅니다.", "되돌릴 시점의 '변경 확인'을 누릅니다."],
      },
      {
        shot: "history-phone-2-restore",
        alt: "복원 전 변경 내용 확인. 현재와 복원 후 글이 나란히 있고, 아래 굵은 확인 문구와 입력칸, '새 커밋으로 복원' 단추가 있다.",
        pins: ["'현재'와 '복원 후'를 견줘 봅니다.", "굵은 확인 문구를 띄어쓰기까지 똑같이 넣습니다.", "'새 커밋으로 복원'을 누릅니다."],
      },
    ],
    wide: [
      {
        shot: "history-wide-1-list",
        alt: "변경 이력 화면. '콘텐츠 종류'에 '첫 화면 콘텐츠'가 골라져 있고, 아래 변경 목록마다 '변경 확인' 단추가 있다.",
        pins: ["'콘텐츠 종류'를 고르고 '변경 이력 불러오기'를 누릅니다.", "되돌릴 시점의 '변경 확인'을 누릅니다."],
      },
      {
        shot: "history-wide-2-restore",
        alt: "복원 전 변경 내용 확인. 현재와 복원 후 글이 나란히 있고, 아래 굵은 확인 문구와 입력칸, '새 커밋으로 복원' 단추가 있다.",
        pins: ["'현재'와 '복원 후'를 견줘 봅니다.", "굵은 확인 문구를 띄어쓰기까지 똑같이 넣습니다.", "'새 커밋으로 복원'을 누릅니다."],
      },
    ],
  },
});

/** 그림 줄 전체에서 이어지는 번호. 칸마다 첫 번호를 돌려준다. */
export function figureFrameStarts(frames) {
  let next = 1;
  return frames.map((frame) => {
    const start = next;
    next += frame.pins.length;
    return start;
  });
}
