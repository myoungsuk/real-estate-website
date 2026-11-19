// 단계 P 실거래가: 공공데이터포털(국토교통부 아파트 실거래가 API 4개) 응답 읽기(설계서 22.4절).
// Worker에는 DOMParser가 없어 평면 <item> 목록만 읽는 작은 읽기 함수를 둔다.
// - 태그와 글자만 읽는다. 속성·CDATA·주석·처리 지시·DOCTYPE·<item> 안의 중첩 칸이 나오면 그 응답 전체를 RT_RESPONSE_INVALID로 버린다.
// - 맨 앞 XML 선언(<?xml …?>) 하나만 허용한다(실제 응답에 붙는지는 확인하지 못함, 지시서 4.3절).
// - 문자 참조는 기본 5개(&amp; &lt; &gt; &quot; &apos;)와 숫자 참조만 푼다.
// - 값은 앞뒤 공백을 지우고, 비면 null(명세 예제의 빈 칸은 공백 한 칸이다).
// 이 파일은 응답 본문·요청 주소를 어디에도 남기지 않는다. 오류에는 고정 코드만 담는다.

export const REALPRICE_MAX_BODY_BYTES = 5 * 1024 * 1024;
export const RT_RESPONSE_INVALID = "RT_RESPONSE_INVALID";

export class RealpriceResponseError extends Error {
  constructor() {
    // 메시지에 본문 조각을 넣지 않는다(로그에 남을 수 있음).
    super(RT_RESPONSE_INVALID);
    this.name = "RealpriceResponseError";
    this.code = RT_RESPONSE_INVALID;
  }
}

const invalid = () => new RealpriceResponseError();

function declaredLengthExceeds(response, maxBytes) {
  const value = response.headers.get("Content-Length");
  if (!value) return false;
  const length = Number(value);
  return Number.isFinite(length) && length > maxBytes;
}

// 본문을 상한까지만 읽어 UTF-8로 푼다. Content-Length와 실제로 읽은 길이를 둘 다 본다(link-preview.mjs와 같은 방식).
export async function readRealpriceBody(response, maxBytes = REALPRICE_MAX_BODY_BYTES) {
  if (declaredLengthExceeds(response, maxBytes)) throw invalid();
  let bytes;
  if (!response.body) {
    bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw invalid();
  } else {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw invalid();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid();
  }
}

const NAMED_ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" });

function decodeText(raw) {
  // 글자 안의 "<"는 태그로 읽히지 않은 구조다. ">"는 XML 규칙상 글자에 그대로 올 수 있어 받아 준다.
  if (raw.includes("<")) throw invalid();
  return raw.replace(/&([^;&\s]{0,10});|&/gu, (match, name) => {
    if (match === "&") throw invalid();
    if (Object.hasOwn(NAMED_ENTITIES, name)) return NAMED_ENTITIES[name];
    const numeric = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/u.exec(name);
    if (!numeric) throw invalid();
    const codePoint = numeric[1] !== undefined ? Number.parseInt(numeric[1], 16) : Number(numeric[2]);
    const allowed = codePoint === 0x9 || codePoint === 0xa || codePoint === 0xd
      || (codePoint >= 0x20 && codePoint <= 0xd7ff) || (codePoint >= 0xe000 && codePoint <= 0xfffd) || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    if (!allowed) throw invalid();
    return String.fromCodePoint(codePoint);
  });
}

const XML_DECLARATION = /^<\?xml\s[^?<>]*\?>/u;
// 여는·닫는·스스로 닫는 태그. 이름 뒤에 공백만 올 수 있다(속성이 있으면 아래 검사에서 버림).
const TAG = /<(\/?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*)(\/?)>/gu;

// 문서를 { name, children, text } 나무로 읽는다. 잘 짜이지 않았거나 허용하지 않는 구조면 RealpriceResponseError.
export function readXmlTree(text) {
  let source = typeof text === "string" ? text : "";
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  source = source.trimStart();
  const declaration = XML_DECLARATION.exec(source);
  if (declaration) source = source.slice(declaration[0].length);
  // CDATA·주석·처리 지시·DOCTYPE과 속성은 모두 "<" 뒤에 이름이 아닌 글자가 오거나 태그 패턴에 맞지 않아 아래에서 걸린다.
  const root = { name: "#document", children: [], text: "" };
  const stack = [root];
  let cursor = 0;
  TAG.lastIndex = 0;
  for (let match = TAG.exec(source); match; match = TAG.exec(source)) {
    const between = source.slice(cursor, match.index);
    appendText(stack.at(-1), between);
    cursor = match.index + match[0].length;
    const [, closing, name, , selfClosing] = match;
    if (closing && selfClosing) throw invalid();
    if (closing) {
      const open = stack.pop();
      if (stack.length === 0 || open.name !== name) throw invalid();
      continue;
    }
    const element = { name, children: [], text: "" };
    stack.at(-1).children.push(element);
    if (!selfClosing) stack.push(element);
  }
  appendText(stack.at(-1), source.slice(cursor));
  if (stack.length !== 1) throw invalid();
  if (root.children.length !== 1 || root.text.trim() !== "") throw invalid();
  for (const element of walk(root.children[0])) {
    // 글자와 자식 칸이 섞인 칸은 허용하지 않는다(공백만 있는 글자는 괜찮다).
    if (element.children.length > 0 && element.text.trim() !== "") throw invalid();
  }
  return root.children[0];
}

function appendText(element, raw) {
  if (raw === "") return;
  // 태그 패턴에 맞지 않은 "<"(속성, CDATA, 주석, 처리 지시, DOCTYPE, 깨진 태그)가 여기로 온다.
  element.text += decodeText(raw);
}

function* walk(element) {
  yield element;
  for (const child of element.children) yield* walk(child);
}

function leafValue(element) {
  if (element.children.length > 0) throw invalid();
  const value = element.text.trim();
  return value === "" ? null : value;
}

// 자식 가운데 이름이 같은 잎 칸 하나의 값. 없으면 undefined, 두 개 이상이면 버림.
function childLeaf(element, name) {
  const found = element.children.filter((child) => child.name === name);
  if (found.length > 1) throw invalid();
  return found.length === 0 ? undefined : leafValue(found[0]);
}

function childElement(element, name) {
  const found = element.children.filter((child) => child.name === name);
  if (found.length > 1) throw invalid();
  return found[0];
}

function countValue(element, name) {
  const value = childLeaf(element, name);
  if (value === undefined || value === null) return null;
  if (!/^\d{1,9}$/u.test(value)) throw invalid();
  return Number(value);
}

// <item> 하나를 { 칸 이름: 값|null }로. 칸 안에 다시 칸이 있으면(중첩) 버린다. 같은 칸이 두 번 나와도 버린다.
function readItem(item) {
  if (item.children.length === 0 && item.text.trim() !== "") throw invalid();
  const fields = {};
  for (const child of item.children) {
    if (Object.hasOwn(fields, child.name)) throw invalid();
    fields[child.name] = leafValue(child);
  }
  return fields;
}

// 응답 본문(문자열)을 읽는다.
// - 정상 틀(<response><header>…</header><body>…</body></response>):
//   { envelope: "response", resultCode, resultMsg, totalCount, pageNo, numOfRows, items: [{…}] | null }
//   body가 없으면 items·숫자 칸은 null이다(결과 코드가 오류일 때 대비).
// - 오류 봉투(<OpenAPI_ServiceResponse><cmmMsgHeader>…, 설계서 22.4절의 **추정** 모양):
//   { envelope: "service-error", reasonCode }
// 그 밖의 모양은 RealpriceResponseError.
export function parseRealpriceXml(text) {
  const root = readXmlTree(text);
  if (root.name === "OpenAPI_ServiceResponse") {
    const header = childElement(root, "cmmMsgHeader");
    if (!header) throw invalid();
    const reasonCode = childLeaf(header, "returnReasonCode");
    if (!reasonCode) throw invalid();
    return { envelope: "service-error", reasonCode };
  }
  if (root.name !== "response") throw invalid();
  const header = childElement(root, "header");
  if (!header) throw invalid();
  const resultCode = childLeaf(header, "resultCode");
  if (!resultCode) throw invalid();
  const resultMsg = childLeaf(header, "resultMsg") ?? null;
  const body = childElement(root, "body");
  if (!body) return { envelope: "response", resultCode, resultMsg, totalCount: null, pageNo: null, numOfRows: null, items: null };
  const itemsElement = childElement(body, "items");
  let items = [];
  if (itemsElement) {
    if (itemsElement.children.some((child) => child.name !== "item")) throw invalid();
    if (itemsElement.children.length === 0 && itemsElement.text.trim() !== "") throw invalid();
    items = itemsElement.children.map(readItem);
  }
  return {
    envelope: "response",
    resultCode,
    resultMsg,
    totalCount: countValue(body, "totalCount"),
    pageNo: countValue(body, "pageNo"),
    numOfRows: countValue(body, "numOfRows"),
    items,
  };
}
