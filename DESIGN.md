---
name: 리더스시티 행복한부동산
description: 상가 유리창 매물판 — 사무소 유리창에 붙인 매물 종이처럼, 최근 공개 매물과 확인일을 그대로 보여 주는 공개 홈페이지
colors:
  paper: "#FBFAF6"
  paper-edge: "#E4E1D8"
  ink: "#141414"
  heading-navy: "#132A3E"
  ink-soft: "#4A4844"
  glass: "#C9D3D6"
  glass-deep: "#9FB0B5"
  stamp-red: "#B3261E"
  focus-teal: "#0B5C73"
  kakao-yellow: "#FEE500"
typography:
  display:
    fontFamily: "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "clamp(2rem, 9vw, 3.25rem)"
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: "-0.04em"
  section-heading:
    fontFamily: "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "clamp(1.625rem, 7.5vw, 2.25rem)"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  price:
    fontFamily: "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "clamp(2rem, 9vw, 2.75rem)"
    fontWeight: 900
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Pretendard, Noto Sans KR, Apple SD Gothic Neo, Malgun Gothic, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 800
    lineHeight: 1.4
rounded:
  sheet: "2px"
  stamp: "4px"
spacing:
  gutter: "16px"
  sheet-gap: "12px"
  section: "40px"
components:
  listing-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    padding: "18px 18px 8px"
  date-stamp:
    textColor: "{colors.stamp-red}"
    typography: "{typography.label}"
    rounded: "{rounded.stamp}"
    padding: "3px 8px"
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    height: "52px"
  button-kakao:
    backgroundColor: "{colors.kakao-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sheet}"
    height: "52px"
---

# Design System: 리더스시티 행복한부동산

> 상태: **확정(2026-11-17)**. 사용자가 방향 결정 화면에서 "상가 유리창 매물판"을 골랐고(16:35), 홈 시안 v5를 확정했다(17:49:10). 운영 화면(`src/`) 적용은 홈 첫 화면부터 PR을 나눠 진행한다. 적용이 끝나기 전까지 지금 운영 화면의 모양은 `src/styles/global.css`가 기준이다.

## Overview

홈은 리더스시티5블록 상가 105호 사무소의 **유리창**이다. 실제 간판·출입구 사진이 바탕(유리)이 되고, 그 위에 최근 등록된 공개 매물이 **종이 한 장씩** 붙는다. 종이에는 가격이 가장 크게, 단지·면적·층·방향이 그다음, 등록일이 **도장**으로 찍힌다. 창 안쪽에는 대표 사진과 전화가 있다.

- "흐름에 빠르게 반응한다"는 강점은 글이 아니라 자동으로 바뀌는 것으로 보여 준다: 최근 등록순 종이, 목록 확인일, 블로그·유튜브 최신 글이 자동으로 붙는 "창 옆 게시판".
- 말투는 정중한 안내. 광고처럼 보이지 않게 한다.
- 다른 단지(동구 전역) 매물이 공개 매물의 다수(2026-11-17 기준 45건 중 29건)라, 단지 바로가기에 "동구 전체 매물"을 함께 둔다.

### 첫 화면 구성(시안 v3, 2026-11-17)

1. 간판 사진을 화면 위쪽 약 40 ~ 50%에 또렷하게 보여 준다(흐림 없음, 글자 뒤 아래쪽만 어둡게).
2. 사진 위: "대표 직접 상담" 표식 + `home-content.broker.eyebrow` 태그 + `home-content.broker.headline`(h1).
3. 사진 아래 끝에 매물 종이가 테이프로 붙은 것처럼 걸친다. 휴대폰은 한 장이 크게 보이고 나머지는 옆으로 밀어 본다(자동으로 넘어가지 않음). 1024px 이상은 세 장 한 줄.
4. 종이 아래: `home-content.broker.lead`, 대표 칸(대표 사진·"대표 직접 상담"·이름·상담 시간·전화), 사실 줄(대표·전문 지역·등록번호·운영 현황).

## Colors

- **paper `#FBFAF6`**: 종이와 간판 띠, 공통 구역 바탕.
- **ink `#141414`**: 글자, 주 버튼(전화·모두 보기) 바탕.
- **heading-navy `#132A3E`**: 제목(h1·구역 제목·대표 이름) 색. 종이 위 대비 약 14:1.
- **ink-soft `#4A4844`**: 보조 글자(면적·층·날짜). 대비는 종이 위 8.74:1, 유리 바탕 위 5.98:1(계산값). 도장 빨강은 종이 위 6.26:1.
- **glass `#C9D3D6`**: 유리창 덧칠, 게시판 구역 바탕.
- **stamp-red `#B3261E`**: **등록일 도장에만** 쓴다.
- **kakao-yellow `#FEE500`**: 카카오톡 버튼에만.
- **focus-teal `#0B5C73`**: 키보드 포커스 외곽선 3px.

### Named Rules

- **빨강은 도장뿐**: 가격·제목·버튼·배지에 빨강을 쓰지 않는다. 빨강이 늘면 "급매" 전단처럼 보인다.
- **색만으로 상태를 알리지 않는다**: 도장은 "11.13 등록"처럼 글자로 읽힌다.

## Typography

- 웹 글꼴 파일을 새로 넣지 않는다(속도·보안 헤더 영향, 넣으려면 별도 승인). 기기 기본 한글 고딕으로 그린다.
- 웹 글꼴은 넣지 않는다(사용자 결정 2026-11-17 17:42 "기본 글꼴"). 시안에서 Pretendard·SUIT·나눔스퀘어 네오를 비교했지만 기기 기본 고딕으로 확정.
- 가격은 굵기 900, `font-variant-numeric: tabular-nums`로 숫자 폭을 맞춘다.
- 본문·조작 글자 16px 이상, 이름표 14px 이상(2026-11-17 운영자 승인 기준). 머리 브랜드 보조 문구만 12px, 하단 연락 막대의 작은 이름표는 지금 크기 유지.
- 단어 중간에서 줄을 바꾸지 않는다: `word-break: keep-all`은 반드시 `overflow-wrap: anywhere`와 함께.

### Hierarchy

웹 글꼴 없이 크기·굵기·색·자간으로 위계를 세운다(2026-11-17 사용자 피드백 "글씨가 임팩트가 없다" 반영).

1. 첫 화면 제목(display): 휴대폰 약 32px, 굵기 900, heading-navy, 자간 -0.04em
2. 종이 가격(price): 휴대폰 약 32px, 굵기 900, 숫자 폭 고정
3. 구역 제목(section-heading): 휴대폰 26px 이상(360px에서 27px), 굵기 800, heading-navy, 자간 -0.035em
4. 종이 단지명·대표 이름·작은 묶음 제목 1.25rem 굵기 800
5. 본문 1rem, 이름표·날짜 0.875rem

- 제목 아래 회색 설명줄은 두지 않는다. 제목만으로 말한다. 첫 화면 제목 아래 "네이버 공개 매물 45건 · 11월 17일 확인" 한 줄만 예외(숫자와 확인일이 정보이므로 회색이 아닌 본문색 굵기 700).

## Layout

- 360px부터 가로 넘침 없음, 좌우 여백 16px.
- 휴대폰: 종이 한 줄에 한 장. 700px 이상: 첫 장은 넓게, 나머지는 두 장씩. 1024px 이상: 세 장 한 줄.
- 가로 머리 메뉴는 1280px부터. 그 아래는 메뉴 단추.
- 하단 전화·문자·카톡 막대(문자 0.75 : 카톡 0.85 : 전화 1.4, safe-area 반영)는 1024px 미만에서 유지한다.

## Elevation & Depth

- 종이: 아래로 2px·흐림 3px의 짧은 그림자와 아래로 10px·흐림 22px의 넓은 그림자를 겹친다(유리에 붙은 종이). 테두리 1px `paper-edge`.
- 그 밖의 면은 그림자 없이 평평하게.

## Shapes

- 종이·버튼 모서리 2px(종이 느낌). 둥근 알약 모양 버튼은 쓰지 않는다.
- 도장만 4px 모서리, -5도 기울임.

## Components

### 관리자 편집 값 연결(필수)

새 홈도 `src/data/home-content.json`(관리자 `/admin/content/`에서 고치는 값)을 그대로 읽는다. 빠지면 관리자 편집 기능이 쓸모없어진다.

| 값 | 새 홈 자리 |
|---|---|
| `broker.headline` | 첫 화면 h1 |
| `broker.eyebrow` | 첫 화면 태그(작은 머리표가 아니라 위치 태그로) |
| `broker.lead` | 매물 종이 아래 소개 문단 |
| `broker.portrait` | 대표 칸 사진 |
| `office.title`·`description`·`image`·`eyebrow`·`badges` | 사무소 구역 제목·설명·사진·사진 설명·체크 목록 |
| `areaGuide.eyebrow`·`title`·`description`·`cards` | 단지 구역 태그·제목·설명·카드 3장 |

- 관리자 값의 문장이 길면 운영자가 관리자 화면에서 줄인다. 디자인에서 자르거나 바꾸지 않는다.

### 매물 종이 넘기기·정렬(사용자 결정 2026-11-17 17:42 "넘기기·정렬 유지")

- 지금 운영 홈처럼 **6건씩 넘기기와 정렬 5가지(최근 등록순·가격 낮은순·가격 높은순·면적 작은순·면적 큰순)를 유지**한다. 넘기면 다음 6장이 같은 종이 모양으로 바뀐다. 정렬 기준은 `src/lib/naver-listing-sort.mjs` 그대로.
- 정렬은 "최근 등록 매물" 제목 줄 오른쪽의 선택 상자, 넘기기는 종이 아래 "‹ 이전 · 1 / 8 · 다음 ›"(누름 영역 48px). 화면 읽기 프로그램용 상태 문장("최근 등록순 45건 중 1~6번째…")을 둔다.
- 휴대폰: 한 페이지의 6장을 옆으로 밀어 보고(자동 넘김 없음), 다음 6장은 "다음" 단추로. 1024px 이상: 6장을 3장씩 두 줄.
- 매물 0건이면 정렬·넘기기를 숨긴다.

### 단지 기본정보 비교표(사용자 결정 2026-11-17 17:42 "둔다")

- 단지 구역의 사진 카드 바로 아래. 지금 홈과 같은 열(단지·규모·입주·전용면적·상세)과 값(`complexes.json` 공식 자료), 같은 표 이름표("천동·신흥 주요 단지 기본정보 표")와 아래 주의 문장. 모양만 새 방향(종이 바탕, 남색 머리 줄, 단어 단위 줄바꿈, "자세히 보기" 누름 영역 44px).

### 매물 종이(listing-sheet)

- 위쪽 띠: 그 단지의 승인된 사진(리더스시티 4·5블록, 신흥 SK뷰). 사진이 없는 단지는 무늬만 있는 빈 띠.
- 위쪽 가운데 테이프 조각 하나.

- 담는 값은 **네이버 공개 카드에 있는 값만**: 거래유형·가격·단지명·면적·광고 층·방향·등록일. 호수·고객 정보는 쓰지 않는다.
- 제목과 "네이버에서 이 매물 보기" 링크는 지금처럼 네이버 상세로 연결(카드 주 동작을 바꾸는 일은 지시서 4단계, 사용자 결정 전).

### 등록일 도장(date-stamp)

- 오른쪽 위, 빨강 테두리 2px, 글자 "M.DD 등록".

### 유리창 상태

- **매물 0건**: 종이 대신 점선 테두리 종이 한 장 — "지금 공개된 매물이 없습니다" / "찾는 조건을 전화나 문자로 남겨 주세요." / 전화·문자 링크. 제목 아래 줄은 "네이버 공개 매물 0건 · 11월 17일 확인". "모두 보기" 단추는 숨긴다.
- **최근 등록이 오래됨**: 종이의 등록일 도장을 그대로 보여 주고, 제목 아래 줄을 "네이버 공개 매물 45건 · 마지막 등록 9월 30일 · 11월 17일 확인"처럼 쓴다(날짜를 숨기거나 꾸미지 않고, 따로 안내 문장을 붙이지 않는다). 기준 일수는 운영 정책(`.github/listing-review-policy.json`)이 정해지면 따른다.

### 대표 칸(desk)

- 대표 사진(필수 유지) + "대표 직접 상담" 표식(운영자 확인 2026-11-17) + "백진옥 공인중개사" + 평일 상담 시간 + 전화. 다른 문장은 붙이지 않는다.

### 블로그·유튜브 새 글(notes)

- 제목 "블로그·유튜브 새 글", 설명 문장 없음. 유튜브(일반 영상 최신 6개)·블로그(최신 9개)를 각각 **썸네일 격자**로: 자체 저장 썸네일 16:9, 제목 2줄까지, 날짜. 날짜가 새 글임을 보여 준다.
- 폭별: 휴대폰 2열 격자(사용자 결정 2026-11-17 17:37 "(가)로 해"), 700px 이상(태블릿·데스크톱) 3열. 15장 모두 한 번에 보인다(360px 홈 문서 높이 약 6,980px).
- 유튜브 미리보기는 지금 운영 규칙 그대로(정밀 포인터가 카드에 0.3초 머물 때만 음소거로 하나, 벗어나면 제거, 휴대폰·움직임 줄이기 환경 제외). 첫 화면 자동재생 없음. 실제 적용 때 기존 `ExternalContentList` 미리보기 스크립트를 그대로 쓴다.

### 움직임(motion)

- 페이지에 들어오면 첫 화면 매물 종이만 0.28초 안에 한 번 아주 작게(8px) 올라온다. 자동재생·자동 슬라이드·숫자 올라가기·시차 스크롤은 쓰지 않는다.
- 버튼은 누르면 0.1초 살짝 눌리고(97%), 마우스를 올리면 색·그림자가 바뀐다.
- 매물 종이·단지 사진·카드는 마우스를 올리면 3 ~ 4px 떠오른다(정밀 포인터에서만).
- 첫 화면 아래 칸은 화면에 들어올 때 한 번만 16px 아래에서 올라오며 나타난다(0.45초). 처음 보이는 화면의 내용은 숨기지 않는다.
- 도장은 처음 보일 때 한 번 "찍히는" 움직임(0.26초).
- 움직임은 위치(transform)와 투명도만 쓴다 → 레이아웃 이동(CLS) 0. `prefers-reduced-motion`이면 모두 끈다.
- 개수는 지금 운영 규칙 그대로(홈 유튜브 일반 영상 6개 등). 줄이는 일은 지시서 4단계 결정.

### 버튼

- 주 버튼: ink 바탕, paper 글자, 높이 52px. 보조 링크: 밑줄, 높이 44px 이상.
- 카카오톡: kakao-yellow 바탕.

## Do's and Don'ts

- Do: 실제 사무소·대표·단지 사진만 쓴다.
- Do: 숫자 옆에 언제나 날짜(등록일·확인일)를 둔다.
- Do: 관리자 화면을 바꾸지 않는다. 관리자는 `global.css`에서 `skip-link`·`sr-only` 클래스, 요소 규칙(`html`, `body`, `a`, `img`, `h1 ~ h3`, `:focus-visible` 등), `--focus-ring` 변수를 받는다. 새 방향의 규칙은 공개 화면 범위 안에 두고 이 목록은 그대로 둔다.
- Do: 문구는 손님에게 바로 말한다("최근 등록 매물", "조건으로 찾기", "블로그·유튜브 새 글", "단지 정보", "사무소 안내").
- Don't: 그림의 비유를 글로 설명하지 않는다("유리창에 붙여 둔", "창 안에서", "창 옆 게시판" 같은 말을 쓰지 않음). 그림이 유리창이면 충분하다.
- Don't: 시스템 설명 문장("자동으로 붙습니다" 등)을 쓰지 않는다. 날짜가 새로움을 보여 준다.
- Don't: 머리표(제목 위 작은 영문·한글 띠)를 쓰지 않는다.
- Don't: 빨강을 도장 밖에 쓰지 않는다.
- Don't: "가장·최고·해박" 같은 확인할 수 없는 자랑을 쓰지 않는다.
- Don't: 페이지에 들어오자마자 움직이거나 자동재생하지 않는다.
