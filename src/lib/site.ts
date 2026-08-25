import officeData from "../data/office.json";

export const office = officeData;

export const phoneHref = `tel:${office.mobile.replaceAll("-", "")}`;
export const smsHref = `sms:${office.mobile.replaceAll("-", "")}`;

export const navigation = [
  { href: "/properties/", label: "매물" },
  { href: "/complexes/", label: "단지정보" },
  { href: "/office/", label: "사무소 소개" },
  { href: "/contents/", label: "지역 콘텐츠" },
  { href: "/faq/", label: "자주 묻는 질문" },
  { href: "/location/", label: "오시는 길" },
];

export function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
