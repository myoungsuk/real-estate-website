// 단계 P 실거래가: 받은 항목을 rt_trades 행으로 바꾸고 거래 ID(trade_key)를 붙인다(설계서 22.4절 칸 변환, 22.6절 1·2).
// - 정해진 칸만 남기고 나머지 응답 칸(도로명·매도/매수자 구분·중개사 소재지 등)은 버린다.
// - 저장할 수 없는 항목(달력에 없는 날·요청한 달이 아닌 날·빈 면적·빈 단지명·금액 오류·필수 칸 길이 초과)은 버리고
//   이유별 수를 돌려준다(2026-11-19 D-5). totalCount 대조는 버리기 전 건수로, 보류 판정은 버린 뒤 건수로 한다(P1-b).
// - 길이 제한은 0003 CHECK와 같은 값을 아래 상수 한 곳에 둔다. 화면용 apt_dong·extra_json이 넘으면 행은 두고 값만 비운다.
// - cmp_seq·is_backfill·first_seen_at·updated_at은 D1 반영 때(P1-b) 채운다.

// 0003_public_realprice.sql CHECK와 같은 길이(코드 포인트 수, SQLite length()와 같음). umd_nm은 명세 크기 30(전월세)에 맞춤.
export const REALPRICE_ROW_LIMITS = Object.freeze({
  aptNm: 80,
  umdNm: 30,
  jibun: 20,
  aptSeq: 20,
  aptDong: 20,
  extraJson: 1000,
});

export const REALPRICE_ROW_KINDS = Object.freeze(["sale", "rent", "presale"]);

// extra_json에 넣는 칸(이 이름만, 이 순서로).
const EXTRA_FIELDS = Object.freeze({
  sale: Object.freeze([]),
  rent: Object.freeze(["contractTerm", "contractType", "useRRRight", "preDeposit", "preMonthlyRent"]),
  presale: Object.freeze(["ownershipGbn"]),
});

const DROP_REASONS = Object.freeze(["invalidDate", "outOfMonth", "missingArea", "missingAptNm", "invalidPrice", "tooLong"]);

const textLength = (value) => [...value].length;

function text(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function isCalendarDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

const pad2 = (value) => String(value).padStart(2, "0");

// dealYear·dealMonth·dealDay → "YYYY-MM-DD" 또는 null(달력에 없는 날·형식 틀림).
export function toDealDate(yearText, monthText, dayText) {
  const year = text(yearText);
  const month = text(monthText);
  const day = text(dayText);
  if (!year || !month || !day || !/^\d{4}$/u.test(year) || !/^\d{1,2}$/u.test(month) || !/^\d{1,2}$/u.test(day)) return null;
  if (!isCalendarDate(Number(year), Number(month), Number(day))) return null;
  return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
}

// "YY.MM.DD" → "20YY-MM-DD", 형식이 다르거나 달력에 없으면 null.
export function toShortDate(value) {
  const match = /^(\d{2})\.(\d{2})\.(\d{2})$/u.exec(text(value) ?? "");
  if (!match) return null;
  const [year, month, day] = [2000 + Number(match[1]), Number(match[2]), Number(match[3])];
  return isCalendarDate(year, month, day) ? `${year}-${pad2(month)}-${pad2(day)}` : null;
}

// 만 원 단위 문자열("42,500", "  8,000") → 원 단위 정수. 형식이 틀리면 null.
export function toWon(value) {
  const digits = (text(value) ?? "").replace(/[,\s]/gu, "");
  if (!/^\d{1,9}$/u.test(digits)) return null;
  return Number(digits) * 10_000;
}

// 전용면적(㎡) 문자열 → ㎡ × 100 반올림 정수. 부동소수 오차를 피하려고 문자열 자릿수로 계산한다(셋째 소수 자리가 5 이상이면 올림).
// 84.97 → 8497, 59.9876 → 5999, 39.6 → 3960. 형식이 틀리거나 0이면 null.
export function toAreaX100(value) {
  const match = /^(\d{1,6})(?:\.(\d{1,10}))?$/u.exec(text(value) ?? "");
  if (!match) return null;
  const fraction = (match[2] ?? "").padEnd(3, "0");
  let result = Number(match[1]) * 100 + Number(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) result += 1;
  return result > 0 ? result : null;
}

function toInteger(value, pattern) {
  const raw = text(value);
  return raw && pattern.test(raw) ? Number(raw) : null;
}

function toDealingGbn(value) {
  const raw = text(value);
  if (raw === "중개거래") return "broker";
  if (raw === "직거래") return "direct";
  return null;
}

function emptyDropped() {
  return Object.fromEntries(DROP_REASONS.map((reason) => [reason, 0]));
}

// 항목 하나 → { row } 또는 { drop: 이유 }. row에는 trade_key가 아직 없다.
function convertItem(kind, dealYmd, item, cleared) {
  const dealDate = toDealDate(item.dealYear, item.dealMonth, item.dealDay);
  if (!dealDate) return { drop: "invalidDate" };
  // 조회 API의 달 창(realprice-query.mjs tradeMonthWindows)이 "거래 ID의 달 = 계약일의 달"인 이 규칙에 기댄다. 바꾸면 달 창 조회도 함께 고친다.
  if (dealDate.slice(0, 4) + dealDate.slice(5, 7) !== dealYmd) return { drop: "outOfMonth" };
  const areaX100 = toAreaX100(item.excluUseAr);
  if (areaX100 === null) return { drop: "missingArea" };
  const aptNm = text(item.aptNm);
  if (!aptNm) return { drop: "missingAptNm" };

  let priceWon = null;
  let depositWon = null;
  let monthlyRentWon = null;
  if (kind === "rent") {
    depositWon = toWon(item.deposit);
    monthlyRentWon = toWon(item.monthlyRent);
    if (depositWon === null || monthlyRentWon === null) return { drop: "invalidPrice" };
  } else {
    priceWon = toWon(item.dealAmount);
    if (priceWon === null) return { drop: "invalidPrice" };
  }

  const umdNm = text(item.umdNm) ?? "";
  const jibun = text(item.jibun) ?? "";
  const aptSeq = text(item.aptSeq);
  if (textLength(aptNm) > REALPRICE_ROW_LIMITS.aptNm
    || textLength(umdNm) > REALPRICE_ROW_LIMITS.umdNm
    || textLength(jibun) > REALPRICE_ROW_LIMITS.jibun
    || (aptSeq !== null && textLength(aptSeq) > REALPRICE_ROW_LIMITS.aptSeq)) {
    return { drop: "tooLong" };
  }

  let aptDong = kind === "sale" ? text(item.aptDong) : null;
  if (aptDong !== null && textLength(aptDong) > REALPRICE_ROW_LIMITS.aptDong) {
    aptDong = null;
    cleared.aptDong += 1;
  }

  const extra = {};
  for (const name of EXTRA_FIELDS[kind]) {
    const value = text(item[name]);
    if (value !== null) extra[name] = value;
  }
  let extraJson = JSON.stringify(extra);
  if (textLength(extraJson) > REALPRICE_ROW_LIMITS.extraJson) {
    extraJson = "{}";
    cleared.extraJson += 1;
  }

  const hasCancelFields = kind !== "rent"; // 전월세 응답에는 해제·중개 구분 칸이 없다(지시서 4.2절)
  return {
    row: {
      kind,
      deal_ymd: dealYmd,
      deal_date: dealDate,
      umd_nm: umdNm,
      jibun,
      apt_seq: aptSeq,
      apt_nm: aptNm,
      area_x100: areaX100,
      floor: toInteger(item.floor, /^-?\d{1,3}$/u),
      build_year: toInteger(item.buildYear, /^\d{4}$/u),
      price_won: priceWon,
      deposit_won: depositWon,
      monthly_rent_won: monthlyRentWon,
      dealing_gbn: hasCancelFields ? toDealingGbn(item.dealingGbn) : null,
      cancelled: hasCancelFields && text(item.cdealType) === "O" ? 1 : 0,
      cancelled_on: hasCancelFields ? toShortDate(item.cdealDay) : null,
      registered_on: toShortDate(item.rgstDate),
      apt_dong: aptDong,
      extra_json: extraJson,
    },
  };
}

const normalizePart = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();

// 서명 원문(설계서 22.6절 1): 종류|계약일|단지 고유번호(없으면 법정동+지번+단지명)|area_x100|floor|금액
// 금액은 매매·분양권 price_won, 전월세 deposit_won|monthly_rent_won. 나중에 바뀔 수 있는 칸(해제·등기·동·중개 구분·extra_json)은 넣지 않는다.
export function tradeSignatureSource(row) {
  const complex = row.apt_seq ?? `${normalizePart(row.umd_nm)}+${normalizePart(row.jibun)}+${normalizePart(row.apt_nm)}`;
  const amount = row.kind === "rent" ? [row.deposit_won, row.monthly_rent_won] : [row.price_won];
  return [row.kind, row.deal_date, complex, row.area_x100, row.floor, ...amount].map(normalizePart).join("|");
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// 같은 서명 안에서 순번을 정하는 정렬 기준: 서명에 넣지 않은 칸 전부. 지역 설정과 상관없이 코드 단위로 비교한다.
// 바뀌지 않는 칸(동·건축연도·이름 칸·중개 구분·덧붙임)을 먼저, 나중에 붙는 칸(해제·해제일·등기일)을 뒤에 둔다.
// 서명이 같고 동만 다른 두 건 가운데 하나에 해제가 붙어도 순번이 서로 바뀌지 않게 하기 위해서다(2026-11-19 B-3).
// 동이 비어 있다가 등기 뒤에 붙는 경우는 여전히 바뀔 수 있다(화면 결과는 같음, 설계서 22.6절 2).
function variableFieldsKey(row) {
  return JSON.stringify([
    row.apt_dong ?? "",
    row.build_year ?? "",
    row.apt_nm,
    row.umd_nm,
    row.jibun,
    row.dealing_gbn ?? "",
    row.extra_json,
    row.cancelled,
    row.cancelled_on ?? "",
    row.registered_on ?? "",
  ]);
}

// 받은 항목 목록 → { rows, droppedCount, dropped: { 이유: 수 }, cleared: { aptDong, extraJson } }.
// rows는 trade_key 순서로 정렬해 돌려준다. kind: "sale" | "rent" | "presale"(매매 일반은 저장하지 않음).
export async function buildTradeRows({ kind, dealYmd, items }) {
  if (!REALPRICE_ROW_KINDS.includes(kind)) throw new TypeError("realprice: 저장하는 종류는 sale·rent·presale뿐입니다.");
  if (typeof dealYmd !== "string" || !/^\d{4}(?:0[1-9]|1[0-2])$/u.test(dealYmd)) throw new TypeError("realprice: 계약 연월은 YYYYMM 형식이어야 합니다.");
  if (!Array.isArray(items)) throw new TypeError("realprice: 항목 목록이 필요합니다.");
  const dropped = emptyDropped();
  const cleared = { aptDong: 0, extraJson: 0 };
  const groups = new Map();
  for (const item of items) {
    const converted = convertItem(kind, dealYmd, item ?? {}, cleared);
    if (converted.drop) {
      dropped[converted.drop] += 1;
      continue;
    }
    const signature = (await sha256Hex(tradeSignatureSource(converted.row))).slice(0, 20);
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push(converted.row);
  }
  const rows = [];
  for (const [signature, group] of groups) {
    const ordered = group
      .map((row) => ({ row, key: variableFieldsKey(row) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    ordered.forEach(({ row }, index) => {
      rows.push({ trade_key: `${kind}:${dealYmd}:${signature}:${index}`, ...row });
    });
  }
  rows.sort((a, b) => (a.trade_key < b.trade_key ? -1 : a.trade_key > b.trade_key ? 1 : 0));
  const droppedCount = Object.values(dropped).reduce((sum, count) => sum + count, 0);
  return { rows, droppedCount, dropped, cleared };
}
