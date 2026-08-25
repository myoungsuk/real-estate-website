import type { APIRoute } from "astro";
import office from "../data/office.json";

export const GET: APIRoute = ({ site }) => {
  const absolute = (path: string) => new URL(path, site).toString();
  const hours = office.hours
    .map((hour) => `${hour.label} ${hour.opens && hour.closes ? `${hour.opens}~${hour.closes}` : hour.note}`)
    .join(", ");
  const claims = office.publicClaims.items.map((item) => `${item.label} ${item.value}`).join(", ");
  const body = `# ${office.brandName}\n\n> 대전 동구의 매매·전세·월세 정보를 직접 확인해 안내하며, 천동 리더스시티5블록 단지 내 상가에 있는 공인중개사사무소입니다.\n\n## 공식 정보\n\n- 법적 상호: ${office.legalName}\n- 대표자: ${office.representative}\n- 전문 지역: ${office.serviceArea}\n- 연락처: ${office.mobile}\n- 이메일: ${office.email}\n- 주소: ${office.address}\n- 중개사무소 등록번호: ${office.registrationNumber}\n- 사업자등록번호: ${office.businessNumber}\n- 영업시간: ${hours}\n- 주차: ${office.parking}\n- 카카오톡 상담: ${office.kakaoUrl}\n- 운영 현황 (${office.publicClaims.basis}): ${claims}\n\n## 주요 페이지\n\n- [홈](${absolute("/")})\n- [확인 매물](${absolute("/properties/")})\n- [대전 동구 주요 단지정보](${absolute("/complexes/")})\n- [사무소 소개](${absolute("/office/")})\n- [오시는 길](${absolute("/location/")})\n\n이 파일은 사이트 내용을 간단히 안내하는 보조 자료이며, 매물 조건과 운영 현황은 각 페이지의 최근 확인일과 전화 상담을 통해 다시 확인해야 합니다.\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
