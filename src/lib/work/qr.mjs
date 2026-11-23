// QR 코드 그림을 만드는 순수 함수(단계 3 구독 주소를 둘째 휴대폰에 넘기는 칸, 사용자 결정 2026-11-23 09:41:26 "지금대로, QR은 다음 PR (Recommended)").
// 구독 주소를 밖으로 보내지 않으려고 외부 QR 서비스·라이브러리 없이 브라우저 안에서 만든다. 서버 요청·브라우저 저장·주소 변경을 하지 않는다.
// 규격은 ISO/IEC 18004(QR 코드 모델 2)이고, 여기서는 구독 주소에 필요한 만큼만 한다: 바이트 모드, 오류 정정 M, 버전 1 ~ 10(가장 작은 버전을 고름).

export const QR_MAX_VERSION = 10;

// 오류 정정 M: 버전마다 블록 하나의 오류 정정 코드워드 수와 블록 수(규격 표 9).
const EC_CODEWORDS_PER_BLOCK = [10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCK_COUNT = [1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
// 정렬 무늬 가운데 자리(규격 부속서 E). 버전 1에는 없다.
const ALIGNMENT_CENTERS = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
// 형식 정보에 넣는 오류 정정 수준 2비트. M은 00이다.
const FORMAT_LEVEL_M = 0;

const assertVersion = (version) => {
  if (!Number.isInteger(version) || version < 1 || version > QR_MAX_VERSION) throw new RangeError("QR 버전은 1 ~ 10만 됩니다.");
};

/** 한 변의 칸 수 @param {number} version */
export function qrSize(version) {
  assertVersion(version);
  return version * 4 + 17;
}

/** 자료와 오류 정정을 합친 코드워드 수(기능 무늬를 뺀 칸 ÷ 8) @param {number} version */
export function qrTotalCodewords(version) {
  assertVersion(version);
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    bits -= (25 * align - 10) * align - 55;
  }
  if (version >= 7) bits -= 36;
  return Math.floor(bits / 8);
}

/** 자료 코드워드 수 @param {number} version */
export function qrDataCodewordCount(version) {
  return qrTotalCodewords(version) - EC_CODEWORDS_PER_BLOCK[version - 1] * BLOCK_COUNT[version - 1];
}

const countBits = (version) => (version <= 9 ? 8 : 16);

/** 바이트 수에 맞는 가장 작은 버전. 버전 10에도 안 들어가면 null @param {number} byteLength */
export function qrVersionFor(byteLength) {
  for (let version = 1; version <= QR_MAX_VERSION; version += 1) {
    if (4 + countBits(version) + byteLength * 8 <= qrDataCodewordCount(version) * 8) return version;
  }
  return null;
}

/**
 * 바이트 모드 자료 코드워드: 모드 0100 + 글자 수 + 자료 + 끝 표시(0 최대 4개) + 바이트 맞춤 + 채움 바이트(EC, 11 번갈아).
 * @param {Uint8Array | number[]} bytes
 * @param {number} version
 * @returns {number[]}
 */
export function qrDataCodewords(bytes, version) {
  const capacity = qrDataCodewordCount(version) * 8;
  if (4 + countBits(version) + bytes.length * 8 > capacity) throw new RangeError("이 버전에 담기에는 글이 깁니다.");
  /** @type {number[]} */
  const bits = [];
  /** @param {number} value @param {number} length */
  const push = (value, length) => {
    for (let index = length - 1; index >= 0; index -= 1) bits.push((value >>> index) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const codewords = [];
  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let offset = 0; offset < 8; offset += 1) value = (value << 1) | bits[index + offset];
    codewords.push(value);
  }
  return codewords;
}

// GF(2^8) 곱셈. 기약 다항식 x^8 + x^4 + x^3 + x^2 + 1(0x11D).
/** @param {number} left @param {number} right */
function fieldMultiply(left, right) {
  let product = 0;
  for (let index = 7; index >= 0; index -= 1) {
    product = (product << 1) ^ ((product >>> 7) * 0x11d);
    product ^= ((right >>> index) & 1) * left;
  }
  return product;
}

// 생성 다항식 (x - 2^0)(x - 2^1)…(x - 2^(degree-1))의 계수. 맨 앞 1은 뺀다.
/** @param {number} degree @returns {number[]} */
function generatorPolynomial(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let step = 0; step < degree; step += 1) {
    for (let index = 0; index < degree; index += 1) {
      result[index] = fieldMultiply(result[index], root);
      if (index + 1 < degree) result[index] ^= result[index + 1];
    }
    root = fieldMultiply(root, 2);
  }
  return result;
}

/**
 * 리드-솔로몬 나머지(오류 정정 코드워드).
 * @param {number[]} data
 * @param {number} degree 오류 정정 코드워드 수
 * @returns {number[]}
 */
export function reedSolomonRemainder(data, degree) {
  if (!Number.isInteger(degree) || degree < 1 || degree > 255) throw new RangeError("오류 정정 코드워드 수는 1 ~ 255입니다.");
  const divisor = generatorPolynomial(degree);
  /** @type {number[]} */
  const remainder = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let index = 0; index < degree; index += 1) remainder[index] ^= fieldMultiply(divisor[index], factor);
  }
  return remainder;
}

/**
 * 자료 코드워드를 블록으로 나눠 오류 정정을 붙이고 규격 순서로 섞은 전체 코드워드.
 * @param {number[]} dataCodewords
 * @param {number} version
 * @returns {number[]}
 */
export function qrCodewords(dataCodewords, version) {
  if (dataCodewords.length !== qrDataCodewordCount(version)) throw new RangeError("자료 코드워드 수가 버전과 맞지 않습니다.");
  const blockCount = BLOCK_COUNT[version - 1];
  const ecLength = EC_CODEWORDS_PER_BLOCK[version - 1];
  const total = qrTotalCodewords(version);
  const shortBlocks = blockCount - (total % blockCount);
  const shortDataLength = Math.floor(total / blockCount) - ecLength;
  const blocks = [];
  for (let index = 0, offset = 0; index < blockCount; index += 1) {
    const data = dataCodewords.slice(offset, offset + shortDataLength + (index < shortBlocks ? 0 : 1));
    offset += data.length;
    blocks.push({ data, ec: reedSolomonRemainder(data, ecLength) });
  }
  const result = [];
  for (let index = 0; index <= shortDataLength; index += 1) {
    for (const block of blocks) if (index < block.data.length) result.push(block.data[index]);
  }
  for (let index = 0; index < ecLength; index += 1) {
    for (const block of blocks) result.push(block.ec[index]);
  }
  return result;
}

/** 형식 정보 15비트(오류 정정 M + 마스크 번호, BCH(15,5), 0x5412와 XOR) @param {number} mask 0 ~ 7 */
export function qrFormatBits(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new RangeError("마스크 번호는 0 ~ 7입니다.");
  const data = (FORMAT_LEVEL_M << 3) | mask;
  let remainder = data;
  for (let step = 0; step < 10; step += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

/** 버전 정보 18비트(버전 7 이상에만 넣음, BCH(18,6)) @param {number} version */
export function qrVersionBits(version) {
  assertVersion(version);
  let remainder = version;
  for (let step = 0; step < 12; step += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  return (version << 12) | remainder;
}

/** @type {Array<(x: number, y: number) => boolean>} */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

// 기능 무늬(위치 찾기·구분 띠·타이밍·정렬·어두운 칸)와 형식·버전 정보 자리를 그린다. reserved가 true인 칸에는 자료를 넣지 않는다.
/** @param {number} version */
function functionPatterns(version) {
  const size = qrSize(version);
  /** @type {boolean[][]} */
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  /** @type {boolean[][]} */
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  /** @param {number} x @param {number} y @param {boolean} dark */
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    reserved[y][x] = true;
  };
  for (let index = 0; index < size; index += 1) {
    set(6, index, index % 2 === 0);
    set(index, 6, index % 2 === 0);
  }
  for (const [centerX, centerY] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(centerX + dx, centerY + dy, distance !== 2 && distance !== 4);
      }
    }
  }
  const centers = ALIGNMENT_CENTERS[version - 1];
  const last = centers.length - 1;
  centers.forEach((centerY, row) => {
    centers.forEach((centerX, column) => {
      // 위치 찾기 무늬와 겹치는 세 모서리에는 두지 않는다.
      if ((row === 0 && column === 0) || (row === 0 && column === last) || (row === last && column === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) set(centerX + dx, centerY + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });
  // 형식 정보 자리(값은 마스크를 고른 뒤 넣음)와 늘 어두운 칸.
  for (let index = 0; index < 9; index += 1) {
    if (!reserved[index][8]) set(8, index, false);
    if (!reserved[8][index]) set(index, 8, false);
  }
  for (let index = 0; index < 8; index += 1) {
    set(size - 1 - index, 8, false);
    set(8, size - 1 - index, false);
  }
  set(8, size - 8, true);
  if (version >= 7) {
    const bits = qrVersionBits(version);
    for (let index = 0; index < 18; index += 1) {
      const dark = ((bits >>> index) & 1) === 1;
      const long = size - 11 + (index % 3);
      const short = Math.floor(index / 3);
      set(long, short, dark);
      set(short, long, dark);
    }
  }
  return { size, modules, reserved };
}

/** @param {boolean[][]} modules @param {number} size @param {number} mask */
function writeFormatBits(modules, size, mask) {
  const bits = qrFormatBits(mask);
  /** @param {number} index */
  const bit = (index) => ((bits >>> index) & 1) === 1;
  for (let index = 0; index <= 5; index += 1) modules[index][8] = bit(index);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let index = 9; index < 15; index += 1) modules[8][14 - index] = bit(index);
  for (let index = 0; index < 8; index += 1) modules[8][size - 1 - index] = bit(index);
  for (let index = 8; index < 15; index += 1) modules[size - 15 + index][8] = bit(index);
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/**
 * 마스크 벌점 네 가지(규격 7.8.3): [같은 색이 5칸 이상 이어짐(3 + 넘는 칸 수), 2×2 같은 색(3), 위치 찾기 무늬와 닮은 1:1:3:1:1에 밝은 4칸이 붙음(40), 어두운 칸 비율(50%에서 5%마다 10)].
 * 어느 마스크를 골라도 읽히는 그림이고, 벌점은 읽기 쉬운 쪽을 고르는 데만 쓴다. 닮은 무늬를 세는 법은 구현마다 조금씩 달라 다른 구현과 고른 마스크가 다를 수 있다.
 * @param {boolean[][]} modules
 * @returns {[number, number, number, number]}
 */
export function qrPenaltyParts(modules) {
  const size = modules.length;
  let runs = 0;
  let squares = 0;
  let finders = 0;
  let dark = 0;
  const lines = [];
  for (let index = 0; index < size; index += 1) {
    lines.push(modules[index]);
    lines.push(modules.map((row) => row[index]));
  }
  for (const line of lines) {
    for (let start = 0; start < size; ) {
      let end = start + 1;
      while (end < size && line[end] === line[start]) end += 1;
      if (end - start >= 5) runs += 3 + (end - start - 5);
      start = end;
    }
    // 그림 밖(조용한 띠)은 밝은 칸으로 본다: 밝은 4칸은 그림 밖에 걸쳐도 되고, 어두운 칸으로 시작·끝나는 7칸은 그림 안에 있어야 한다.
    for (let start = -4; start + 11 <= size + 4; start += 1) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((value, offset) => (line[start + offset] ?? false) === value)) finders += 40;
      }
    }
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) dark += 1;
      if (x + 1 < size && y + 1 < size && modules[y][x] === modules[y][x + 1] && modules[y][x] === modules[y + 1][x] && modules[y][x] === modules[y + 1][x + 1]) squares += 3;
    }
  }
  const balance = Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
  return [runs, squares, finders, balance];
}

/** 마스크 벌점 합계 @param {boolean[][]} modules */
export function qrPenalty(modules) {
  return qrPenaltyParts(modules).reduce((sum, part) => sum + part, 0);
}

/**
 * 전체 코드워드를 칸에 놓고 마스크·형식 정보를 넣은 그림. mask를 주지 않으면 벌점이 가장 낮은 마스크를 고른다(같으면 번호가 작은 쪽).
 * @param {number[]} codewords qrCodewords()의 결과
 * @param {number} version
 * @param {number} [mask]
 * @returns {{ version: number, mask: number, size: number, modules: boolean[][] }}
 */
export function qrMatrix(codewords, version, mask) {
  if (codewords.length !== qrTotalCodewords(version)) throw new RangeError("코드워드 수가 버전과 맞지 않습니다.");
  if (mask !== undefined && (!Number.isInteger(mask) || mask < 0 || mask > 7)) throw new RangeError("마스크 번호는 0 ~ 7입니다.");
  const { size, modules: base, reserved } = functionPatterns(version);
  // 오른쪽 아래에서 두 칸 폭으로 지그재그. 세로 타이밍 줄(x = 6)은 건너뛴다. 남는 칸(나머지 비트)은 밝게 둔다.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step += 1) {
      for (let side = 0; side < 2; side += 1) {
        const x = right - side;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - step : step;
        if (reserved[y][x]) continue;
        if (bitIndex < codewords.length * 8) base[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) === 1;
        bitIndex += 1;
      }
    }
  }
  /** @param {number} number */
  const build = (number) => {
    const modules = base.map((row) => [...row]);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) if (!reserved[y][x] && MASKS[number](x, y)) modules[y][x] = !modules[y][x];
    }
    writeFormatBits(modules, size, number);
    return modules;
  };
  if (mask !== undefined) return { version, mask, size, modules: build(mask) };
  let best = { mask: 0, modules: build(0) };
  let bestPenalty = qrPenalty(best.modules);
  for (let number = 1; number < 8; number += 1) {
    const modules = build(number);
    const penalty = qrPenalty(modules);
    if (penalty < bestPenalty) {
      best = { mask: number, modules };
      bestPenalty = penalty;
    }
  }
  return { version, mask: best.mask, size, modules: best.modules };
}

/**
 * 글을 QR 그림으로. modules[y][x]가 true면 어두운 칸이다. 그릴 때는 둘레에 밝은 칸 4줄(조용한 띠)을 둬야 읽힌다.
 * @param {string} text UTF-8로 넣는다
 * @param {{ mask?: number }} [options] mask는 시험에서 다른 구현과 대조할 때만 쓴다
 * @returns {{ version: number, mask: number, size: number, modules: boolean[][] }}
 */
export function encodeQr(text, options = {}) {
  const bytes = new TextEncoder().encode(String(text));
  const version = qrVersionFor(bytes.length);
  if (version === null) throw new RangeError("QR에 담기에는 글이 깁니다.");
  return qrMatrix(qrCodewords(qrDataCodewords(bytes, version), version), version, options.mask);
}
