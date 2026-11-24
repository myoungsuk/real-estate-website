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

// 그림 한 장 크기 상한(WebP). 넘으면 scripts/help-shots.mjs와 tests/admin-help-images.test.mjs가 실패한다.
export const ADMIN_HELP_IMAGE_MAX_BYTES = 70 * 1024;

/**
 * @typedef {{ shot: string, alt: string, pins: string[] }} AdminHelpFrame
 * @typedef {{ section: string, route: string, sources: string[], title: string, note?: string, phone: AdminHelpFrame[], wide: AdminHelpFrame[] }} AdminHelpFigure
 * note: 그림과 실제 화면이 켜기 값에 따라 다를 때 그림 제목 아래 한 줄로 알린다.
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
