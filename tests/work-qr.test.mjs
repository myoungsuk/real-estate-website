// QR 순수 함수(src/lib/work/qr.mjs) 시험. 구독 주소 꼴은 가짜 토큰만 쓴다.
// 표본 4개(SAMPLES)는 2026-11-23에 저장소 밖 독립 구현 둘과 견준 뒤 박은 값이다: 생성기 qrcode-generator 1.4.4와 같은 마스크에서 모든 칸이 같았고,
// 판독기 jsQR 1.4.0이 글을 그대로 읽었다. 그 두 구현은 저장소에 넣지 않는다. 실제 휴대폰 카메라로 읽는 확인은 따로 한다(테스트 체크리스트).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  QR_MAX_VERSION,
  encodeQr,
  qrCodewords,
  qrDataCodewordCount,
  qrDataCodewords,
  qrFormatBits,
  qrMatrix,
  qrPenalty,
  qrPenaltyParts,
  qrSize,
  qrTotalCodewords,
  qrVersionBits,
  qrVersionFor,
  reedSolomonRemainder,
} from "../src/lib/work/qr.mjs";
import { googleCalendarUrl, webcalUrl } from "../src/lib/work/calendar-feed-view.mjs";

const FAKE_TOKEN = "FAKE-TOKEN-FOR-TEST-ONLY".padEnd(43, "0");
const HTTPS_URL = `https://leaderscityhappy.com/api/calendar/${FAKE_TOKEN}.ics`;
// 규격서(ISO/IEC 18004 부속서 I) 본보기: "01234567", 버전 1-M, 숫자 모드의 자료 코드워드 16개와 오류 정정 코드워드 10개.
const ISO_DATA = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
const ISO_EC = [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55];

// 줄마다 왼쪽 칸이 높은 자리인 16진수(어두운 칸 = 1).
const SAMPLES = {
  iso: { version: 1, mask: 2, rows: [
    "1fcb7f", "104f41", "17505d", "17585d", "17575d", "105141",
    "1fd57f", "001300", "17c97c", "02b52c", "046a9f", "01083c",
    "03f290", "0017cc", "1fcd60", "1057c5", "17512c", "175920",
    "175694", "104036", "1fde94",
  ] },
  hello: { version: 1, mask: 3, rows: [
    "1fd17f", "105141", "17405d", "17555d", "174e5d", "104741",
    "1fd57f", "001f00", "16eb4b", "0c2fec", "00faa3", "15b22a",
    "116d85", "001665", "1fd7f0", "105caf", "174948", "175c4e",
    "175924", "104ef1", "1fdaa0",
  ] },
  https: { version: 6, mask: 3, rows: [
    "1fdb0afc57f", "1053a528041", "1742ba0175d", "1750c09765d", "174fc0f725d", "104d0350741",
    "1fd5555557f", "001aff44900", "16ee99b4e4b", "0b0057a5fb5", "0af01d6dc24", "01158618161",
    "0b56c11bb8e", "1c844934248", "06cbd368f43", "0015d4a2253", "08d8109dd12", "171fc4af8a4",
    "104ec4538dc", "0e0d3da00af", "15f7e20b672", "150389057d3", "156f643cca6", "1f85114c4cb",
    "17e1db4e83f", "0112529fb8f", "155f4e157a9", "043634d73ea", "0748b150798", "0016d308925",
    "1349e6809fc", "04121a2796e", "0c6319d25fe", "00101aff713", "1fdf9528952", "10503a0051a",
    "174ac0945f6", "175db877e16", "17572a4122b", "104295e5152", "1fdff4ea7ca",
  ] },
  google: { version: 8, mask: 3, rows: [
    "1fd9cd3b4917f", "105d0d435ef41", "17497207e5b5d", "175cb4ac6fa5d", "174e867e0085d", "104a03c662c41",
    "1fd555555557f", "0014aec501400", "16e6c87f8024b", "0b186249c3ad4", "04780f50e00ac", "1b30e948bb97f",
    "007932fe2f52e", "0a10090e28c81", "095808ee00b4a", "000d408b7a0f1", "1bc608849257b", "1a1ee2a124b8e",
    "015135c285d3b", "058c2db12f8a8", "0ae2bb21a28aa", "0b091c98618f8", "11ff937ef53fc", "1518fbc63d71f",
    "0b59c1d4ed35d", "1d1245c50051d", "0ffff7fd40ffc", "090fc867d0888", "0fe08566f0056", "08312d069c10d",
    "124771e97f6fb", "15bfcaa3a1620", "096e2c8d248e0", "02355e3a492a1", "01d3be5c5ea80", "0885c555fd26c",
    "03e9cbec07af7", "03b4eb0b08e17", "08c5268060dae", "0e304cb1c1920", "1c49627eb8df5", "001b6847b7b1f",
    "1fd282d405d53", "105db54583711", "17445cff8e7fb", "175d9841f0977", "17560f88ad0bb", "104aa22217bac",
    "1fd8281e4930b",
  ] },
};
const hexRows = (modules) => modules.map((row) => BigInt(`0b${row.map((dark) => (dark ? 1 : 0)).join("")}`).toString(16).padStart(Math.ceil(row.length / 4), "0"));
const bytesOf = (text) => new TextEncoder().encode(text);
const blank = (size, dark = false) => Array.from({ length: size }, () => new Array(size).fill(dark));

test("용량: 버전 1 ~ 10의 전체·자료 코드워드 수가 규격 표(오류 정정 M)와 같다", () => {
  const versions = Array.from({ length: QR_MAX_VERSION }, (_, index) => index + 1);
  assert.deepEqual(versions.map(qrTotalCodewords), [26, 44, 70, 100, 134, 172, 196, 242, 292, 346]);
  assert.deepEqual(versions.map(qrDataCodewordCount), [16, 28, 44, 64, 86, 108, 124, 154, 182, 216]);
  assert.deepEqual(versions.map(qrSize), [21, 25, 29, 33, 37, 41, 45, 49, 53, 57]);
  assert.throws(() => qrSize(0), RangeError);
  assert.throws(() => qrTotalCodewords(11), RangeError);
});

test("버전 고르기: 바이트 수가 들어가는 가장 작은 버전, 213바이트를 넘으면 null이고 encodeQr는 던진다", () => {
  // [바이트 수, 버전] — 버전마다 담을 수 있는 가장 큰 수와 그 바로 다음
  for (const [length, version] of [[0, 1], [14, 1], [15, 2], [26, 2], [27, 3], [42, 3], [43, 4], [62, 4], [63, 5], [84, 5], [85, 6], [106, 6], [107, 7], [122, 7], [123, 8], [152, 8], [153, 9], [180, 9], [181, 10], [213, 10]]) {
    assert.equal(qrVersionFor(length), version, `${length}바이트`);
  }
  assert.equal(qrVersionFor(214), null);
  assert.throws(() => encodeQr("가".repeat(72)), RangeError); // 216바이트
  assert.equal(encodeQr("가".repeat(71)).version, 10); // 213바이트(한글은 UTF-8 3바이트)
});

test("자료 코드워드: 모드 0100 + 글자 수 + 자료 + 끝 표시 + 채움 바이트(EC·11 번갈아)", () => {
  assert.deepEqual(qrDataCodewords([0x41], 1), [0x40, 0x14, 0x10, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
  // 꽉 찬 버전 1(14바이트): 4 + 8 + 112 + 끝 표시 4 = 128비트라 채움 바이트가 없다.
  const full = qrDataCodewords(bytesOf("abcdefghijklmn"), 1);
  assert.equal(full.length, 16);
  assert.deepEqual([full[0], full[1], full[15]], [0x40, 0xe6, 0xe0]);
  // 버전 10부터 글자 수는 16비트
  assert.deepEqual(qrDataCodewords([0x41], 10).slice(0, 4), [0x40, 0x00, 0x14, 0x10]);
  assert.throws(() => qrDataCodewords(new Array(15).fill(0x41), 1), RangeError);
});

test("리드-솔로몬 나머지: 규격서 본보기와 널리 알려진 'HELLO WORLD' 1-M 값", () => {
  assert.deepEqual(reedSolomonRemainder(ISO_DATA, 10), ISO_EC);
  assert.deepEqual(reedSolomonRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.deepEqual(reedSolomonRemainder(new Array(16).fill(0), 10), new Array(10).fill(0));
  assert.throws(() => reedSolomonRemainder([1], 0), RangeError);
});

test("블록 나누기: 한 블록이면 자료 뒤에 오류 정정, 여러 블록이면 번갈아 섞고 긴 블록의 남는 자료가 뒤에 온다", () => {
  assert.deepEqual(qrCodewords(ISO_DATA, 1), [...ISO_DATA, ...ISO_EC]);
  // 버전 8-M: 자료 38·38·39·39 + 오류 정정 22 × 4
  const data = Array.from({ length: 154 }, (_, index) => index);
  const mixed = qrCodewords(data, 8);
  assert.equal(mixed.length, 242);
  assert.deepEqual(mixed.slice(0, 8), [0, 38, 76, 115, 1, 39, 77, 116]);
  assert.deepEqual(mixed.slice(148, 154), [37, 75, 113, 152, 114, 153]);
  const blocks = [data.slice(0, 38), data.slice(38, 76), data.slice(76, 115), data.slice(115, 154)].map((block) => reedSolomonRemainder(block, 22));
  assert.deepEqual(mixed.slice(154, 158), blocks.map((ec) => ec[0]));
  assert.deepEqual(mixed.slice(-4), blocks.map((ec) => ec[21]));
  assert.throws(() => qrCodewords(data.slice(1), 8), RangeError);
});

test("형식 정보 15비트(오류 정정 M, 마스크 0 ~ 7)와 버전 정보 18비트(버전 7 ~ 10)가 규격 표와 같다", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => qrFormatBits(mask).toString(2).padStart(15, "0")),
    ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"],
  );
  assert.deepEqual([7, 8, 9, 10].map(qrVersionBits), [0x07c94, 0x085bc, 0x09a99, 0x0a4d3]);
  assert.throws(() => qrFormatBits(8), RangeError);
});

test("마스크 벌점: 네 가지를 손으로 셀 수 있는 그림에서 값이 맞다", () => {
  // 21×21 모두 밝음: 줄 42개 × (3 + 16) = 798, 2×2는 20 × 20 × 3 = 1200, 닮은 무늬 없음, 어두운 칸 0%라 100
  assert.deepEqual(qrPenaltyParts(blank(21)), [798, 1200, 0, 100]);
  assert.equal(qrPenalty(blank(21)), 2098);
  // 바둑판: 이어진 칸·2×2·닮은 무늬가 없고 어두운 칸 221/441(50.1%)
  const checker = blank(21).map((row, y) => row.map((_, x) => (x + y) % 2 === 0));
  assert.deepEqual(qrPenaltyParts(checker), [0, 0, 0, 0]);
  // 가운데 줄에 1011101 하나: 앞 밝은 4칸 + 무늬, 무늬 + 뒤 밝은 4칸 → 40 × 2
  const finder = blank(21);
  [7, 9, 10, 11, 13].forEach((x) => { finder[10][x] = true; });
  assert.equal(qrPenaltyParts(finder)[2], 80);
  // 줄 끝에 붙은 무늬: 그림 밖(조용한 띠)을 밝은 칸으로 보아 앞쪽도 센다. 뒤는 밝은 칸이 4개(7 ~ 10)라 센다.
  const edge = blank(21);
  [0, 2, 3, 4, 6].forEach((x) => { edge[10][x] = true; });
  assert.equal(qrPenaltyParts(edge)[2], 80);
  // 무늬 뒤 밝은 칸이 3개뿐이면 뒤쪽은 세지 않는다.
  edge[10][10] = true;
  assert.equal(qrPenaltyParts(edge)[2], 40);
  // 이어진 칸: 바둑판 첫 줄의 앞 7칸을 어둡게 하면 그 줄만 7칸이 이어져 3 + 2 = 5, 앞 5칸만이면 3
  const runs = (length) => {
    const grid = blank(21).map((row, y) => row.map((_, x) => (x + y) % 2 === 0));
    for (let x = 0; x < length; x += 1) grid[0][x] = true;
    return qrPenaltyParts(grid);
  };
  assert.deepEqual(runs(7), [5, 0, 0, 0]);
  assert.deepEqual(runs(5), [3, 0, 0, 0]);
  assert.deepEqual(runs(3), [0, 0, 0, 0]);
});

test("마스크 고르기: mask를 주지 않으면 여덟 가지 중 벌점이 가장 낮은 것을 고른다(같으면 번호가 작은 쪽)", () => {
  for (const text of ["HELLO WORLD", HTTPS_URL, googleCalendarUrl(HTTPS_URL)]) {
    const penalties = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => qrPenalty(encodeQr(text, { mask }).modules));
    const auto = encodeQr(text);
    assert.equal(auto.mask, penalties.indexOf(Math.min(...penalties)), text.slice(0, 20));
    assert.deepEqual(auto.modules, encodeQr(text, { mask: auto.mask }).modules);
  }
  assert.throws(() => encodeQr("A", { mask: 8 }), RangeError);
});

test("마스크 고르기: 벌점이 가장 낮은 마스크가 둘이면 번호가 작은 쪽을 고른다(가상 주소 2개, 큰 쪽을 고르면 실패)", () => {
  for (const [text, tied] of [["https://example.test/36", [1, 6]], ["https://example.test/203", [4, 6]]]) {
    const penalties = [0, 1, 2, 3, 4, 5, 6, 7].map((mask) => qrPenalty(encodeQr(text, { mask }).modules));
    const lowest = Math.min(...penalties);
    assert.deepEqual(penalties.flatMap((penalty, mask) => (penalty === lowest ? [mask] : [])), tied, `${text}: 벌점이 같은 마스크 둘`);
    assert.equal(encodeQr(text).mask, tied[0], text);
  }
});

test("표본 대조 ①: 규격서 본보기('01234567', 버전 1-M, 마스크 010)의 모든 칸", () => {
  const symbol = qrMatrix(qrCodewords(ISO_DATA, 1), 1, 2);
  assert.deepEqual(hexRows(symbol.modules), SAMPLES.iso.rows);
});

test("표본 대조 ②: 바이트 모드 'HELLO WORLD'(버전 1), 구독 주소 꼴(버전 6), Google 캘린더 주소 꼴(버전 8)의 모든 칸", () => {
  for (const [name, text] of [["hello", "HELLO WORLD"], ["https", HTTPS_URL], ["google", googleCalendarUrl(HTTPS_URL)]]) {
    const sample = SAMPLES[name];
    const symbol = encodeQr(text, { mask: sample.mask });
    assert.equal(symbol.version, sample.version, name);
    assert.equal(symbol.size, sample.rows.length, name);
    assert.deepEqual(hexRows(symbol.modules), sample.rows, name);
  }
});

test("구독 주소 꼴의 버전: https·webcal 주소는 버전 6(41칸), Google 캘린더 주소는 버전 8(49칸)", () => {
  assert.equal(HTTPS_URL.length, 89);
  assert.deepEqual([encodeQr(HTTPS_URL).version, encodeQr(webcalUrl(HTTPS_URL)).version, encodeQr(googleCalendarUrl(HTTPS_URL)).version], [6, 6, 8]);
  assert.deepEqual([encodeQr(HTTPS_URL).size, encodeQr(googleCalendarUrl(HTTPS_URL)).size], [41, 49]);
});

test("기능 무늬: 세 모서리 위치 찾기 무늬·타이밍 줄·늘 어두운 칸·정렬 무늬가 어느 마스크에서도 그대로다", () => {
  const FINDER = ["1111111", "1000001", "1011101", "1011101", "1011101", "1000001", "1111111"];
  for (let mask = 0; mask < 8; mask += 1) {
    const { size, modules } = encodeQr(googleCalendarUrl(HTTPS_URL), { mask });
    const cut = (left, top, width, height) => modules.slice(top, top + height).map((row) => row.slice(left, left + width).map((dark) => (dark ? 1 : 0)).join(""));
    for (const [left, top] of [[0, 0], [size - 7, 0], [0, size - 7]]) assert.deepEqual(cut(left, top, 7, 7), FINDER, `마스크 ${mask}`);
    // 위치 찾기 무늬 둘레 한 줄은 밝다.
    assert.equal(cut(0, 7, 8, 1)[0], "00000000");
    assert.equal(cut(size - 8, 7, 8, 1)[0], "00000000");
    assert.deepEqual(cut(7, 0, 1, 8), new Array(8).fill("0"));
    for (let index = 8; index < size - 8; index += 1) {
      assert.equal(modules[6][index], index % 2 === 0);
      assert.equal(modules[index][6], index % 2 === 0);
    }
    assert.equal(modules[size - 8][8], true);
    // 버전 8 정렬 무늬 가운데(6·24·42 가운데 위치 찾기 무늬와 겹치지 않는 여섯 곳)
    for (const [x, y] of [[24, 6], [6, 24], [24, 24], [42, 24], [24, 42], [42, 42]]) {
      assert.deepEqual(cut(x - 2, y - 2, 5, 5), ["11111", "10001", "10101", "10001", "11111"], `마스크 ${mask} (${x},${y})`);
    }
  }
});

test("순수 함수: 서버 요청·브라우저 저장·화면·무작위·시계를 쓰지 않고, 같은 글이면 늘 같은 그림이다", async () => {
  const source = await readFile(new URL("../src/lib/work/qr.mjs", import.meta.url), "utf8");
  for (const word of ["fetch(", "XMLHttpRequest", "localStorage", "sessionStorage", "document.", "window.", "location", "navigator.", "Math.random", "Date", "import "]) {
    assert.equal(source.includes(word), false, word);
  }
  assert.deepEqual(encodeQr(HTTPS_URL), encodeQr(HTTPS_URL));
});
