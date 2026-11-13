export const GOOGLE_TAG_ID = "G-DFMC9Y1MG2";

const TAG_ID_PATTERN = /^G-[A-Z0-9]{6,}$/;
const HOST_PATTERN = /^[a-z0-9.-]+$/;

// 운영 도메인에서만 gtag.js를 불러오는 인라인 스크립트를 만든다.
// 로컬·CI·미리보기 주소에서는 아무것도 불러오지 않아 방문 통계가 오염되지 않는다.
export function createGoogleTagLoader(tagId, productionHost) {
  if (!TAG_ID_PATTERN.test(tagId)) {
    throw new Error("Google 태그 ID 형식이 올바르지 않습니다.");
  }
  if (!HOST_PATTERN.test(productionHost)) {
    throw new Error("Google 태그를 실행할 운영 도메인 형식이 올바르지 않습니다.");
  }

  const id = JSON.stringify(tagId);
  const host = JSON.stringify(productionHost);
  return [
    "(function(){",
    `if(location.hostname!==${host})return;`,
    "window.dataLayer=window.dataLayer||[];",
    "window.gtag=function(){window.dataLayer.push(arguments);};",
    "window.gtag(\"js\",new Date());",
    `window.gtag("config",${id});`,
    "var s=document.createElement(\"script\");",
    "s.async=true;",
    `s.src="https://www.googletagmanager.com/gtag/js?id="+encodeURIComponent(${id});`,
    "document.head.appendChild(s);",
    "})();",
  ].join("");
}
