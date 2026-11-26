// 홍보 그림 '카톡·문자로 보내기'·'그림 복사'(2026-11-25, 중개날개 대조표 16절 4위)의 글과 data 주소 풀기, 단추 모듈이 지키는 규칙.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  CARD_COPY_LABEL,
  CARD_SHARE_LABEL,
  cardCopyLabel,
  cardDoneLabel,
  cardImageBytes,
  cardShareLabel,
  cardShareText,
} from "../src/lib/work/card-share.mjs";

// 1×1 투명 PNG.
const PNG_1X1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

test("단추 이름: 한 장은 '카톡·문자로 보내기'·'그림 복사', 여러 장은 보내기에 장수·복사는 장마다", () => {
  assert.equal(CARD_SHARE_LABEL, "카톡·문자로 보내기");
  assert.equal(CARD_COPY_LABEL, "그림 복사");
  assert.equal(cardShareLabel(1), "카톡·문자로 보내기");
  assert.equal(cardShareLabel(), "카톡·문자로 보내기");
  assert.equal(cardShareLabel(3), "카톡·문자로 보내기(3장)");
  assert.equal(cardCopyLabel(0, 1), "그림 복사");
  assert.equal(cardCopyLabel(1, 2), "2장 복사");
  assert.equal(cardDoneLabel("share"), "✓ 보냄");
  assert.equal(cardDoneLabel("copy"), "✓ 복사함");
  assert.equal(cardDoneLabel("copy", { index: 2, count: 3 }), "✓ 3장 복사함");
});

test("알림 글: 공유 창을 닫은 것은 알리지 않고, 실패는 저장해서 보내라고 알린다", () => {
  assert.deepEqual(cardShareText("shared"), { text: "✓ 그림을 공유 창으로 보냈습니다.", state: "success" });
  assert.deepEqual(cardShareText("shared", { count: 2 }), { text: "✓ 그림 2장을 공유 창으로 보냈습니다.", state: "success" });
  assert.deepEqual(cardShareText("share-blocked"), { text: "공유 창을 열지 못했습니다. '카톡·문자로 보내기'를 한 번 더 눌러 주세요.", state: "error" });
  assert.deepEqual(cardShareText("share-blocked", { count: 3 }), { text: "공유 창을 열지 못했습니다. '카톡·문자로 보내기(3장)'를 한 번 더 눌러 주세요.", state: "error" });
  assert.equal(cardShareText("share-failed").state, "error");
  assert.match(cardShareText("share-failed").text, /그림을 저장한 뒤/u);
  assert.deepEqual(cardShareText("copied"), { text: "✓ 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.", state: "success" });
  assert.deepEqual(cardShareText("copied", { index: 1, count: 2 }), { text: "✓ 2번째 그림을 복사했습니다. 카카오톡·문자 입력칸에 붙여 넣으세요.", state: "success" });
  assert.deepEqual(cardShareText("copy-failed"), { text: "그림을 복사하지 못했습니다. 그림을 저장한 뒤 보내 주세요.", state: "error" });
  assert.equal(cardShareText("cancelled"), null);
  assert.equal(cardShareText("anything"), null);
});

test("data 주소 풀기: PNG base64만 바이트로 풀고 나머지는 null", () => {
  const decoded = cardImageBytes(PNG_1X1);
  assert.equal(decoded.type, "image/png");
  assert.ok(decoded.bytes instanceof Uint8Array);
  assert.deepEqual([...decoded.bytes.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(decoded.bytes.length, Buffer.from(PNG_1X1.split(",")[1], "base64").length);
  for (const bad of ["", null, undefined, "data:image/jpeg;base64,AAAA", "data:image/png,plain", "https://example.com/card.png", "blob:https://example.com/x", `${PNG_1X1}\n`]) {
    assert.equal(cardImageBytes(bad), null, String(bad));
  }
});

test("단추 모듈은 서버·브라우저 저장소·blob 주소를 쓰지 않고, 되는지 먼저 본 뒤에만 단추를 둔다", async () => {
  for (const file of ["../src/lib/work-card-share.ts", "../src/lib/work/card-share.mjs"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\bfetch\(|localStorage|sessionStorage|indexedDB|XMLHttpRequest|navigator\.sendBeacon|createObjectURL|history\.(?:push|replace)State/u, file);
  }
  const dom = await readFile(new URL("../src/lib/work-card-share.ts", import.meta.url), "utf8");
  assert.match(dom, /navigator\.canShare\(\{ files:/u, "공유는 canShare({ files })로 먼저 본다");
  assert.match(dom, /new ClipboardItem\(/u, "복사는 ClipboardItem으로 한다");
  assert.match(dom, /error\.name === "AbortError"\) return false;/u, "공유 창을 닫은 것은 알리지 않는다");
});
