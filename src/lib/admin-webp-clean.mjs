// 관리자 사진 올리기: 브라우저가 만든 WebP에서 메타데이터 조각을 빼고 올린다.
// 크롬의 canvas.toDataURL("image/webp")는 원본 사진에 색 정보가 없어도 ICCP(색 정보) 조각을 넣고 VP8X에 ICC 표시(0x20)를 켠다.
// 서버 검사(worker/github-content.mjs validateWebpBytes)는 ICCP·EXIF·XMP가 있으면 거부하므로, 저장 전에 그 조각만 빼고
// VP8X의 해당 표시(ICC 0x20·EXIF 0x08·XMP 0x04)를 끄고 RIFF 크기를 다시 적는다. 그림 조각(VP8·VP8L·ALPH)은 그대로 둔다.
// 구조를 읽을 수 없는 바이트나 애니메이션 조각은 고치지 않고 그대로 돌려준다(서버 검사가 거부한다).
const METADATA_CHUNKS = new Set(["ICCP", "EXIF", "XMP "]);
const METADATA_FLAGS = 0x20 | 0x08 | 0x04;
const DATA_URL_PREFIX = "data:image/webp;base64,";

const fourCc = (bytes, offset) => String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
const uint32Le = (bytes, offset) => (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;

export function stripWebpMetadata(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20) return bytes;
  if (fourCc(bytes, 0) !== "RIFF" || fourCc(bytes, 8) !== "WEBP" || uint32Le(bytes, 4) + 8 !== bytes.length) return bytes;

  const kept = [];
  let changed = false;
  let offset = 12;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) return bytes;
    const type = fourCc(bytes, offset);
    const size = uint32Le(bytes, offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (end > bytes.length) return bytes;
    if (METADATA_CHUNKS.has(type)) {
      changed = true;
    } else {
      const chunk = bytes.slice(offset, end);
      if (type === "VP8X" && size >= 1 && (chunk[8] & METADATA_FLAGS) !== 0) {
        chunk[8] &= ~METADATA_FLAGS;
        changed = true;
      }
      kept.push(chunk);
    }
    offset = end;
  }
  if (!changed) return bytes;

  const length = 12 + kept.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(length);
  result.set(bytes.subarray(0, 12));
  new DataView(result.buffer).setUint32(4, length - 8, true);
  let position = 12;
  for (const chunk of kept) {
    result.set(chunk, position);
    position += chunk.length;
  }
  return result;
}

// toDataURL 결과(data:image/webp;base64,…)를 받아 같은 모양의 data URL로 돌려준다. WebP가 아니면 그대로 둔다.
export function stripWebpMetadataFromDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(DATA_URL_PREFIX)) return dataUrl;
  const binary = atob(dataUrl.slice(DATA_URL_PREFIX.length));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const cleaned = stripWebpMetadata(bytes);
  if (cleaned === bytes) return dataUrl;
  let text = "";
  for (let index = 0; index < cleaned.length; index += 0x8000) text += String.fromCharCode(...cleaned.subarray(index, index + 0x8000));
  return DATA_URL_PREFIX + btoa(text);
}
