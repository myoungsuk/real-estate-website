import officeData from "../data/office.json";

export const office = officeData;

export const phoneHref = `tel:${office.mobile.replaceAll("-", "")}`;
export const smsHref = `sms:${office.mobile.replaceAll("-", "")}`;
export const emailHref = `mailto:${office.email}`;
export const kakaoHref = office.kakaoUrl;

export function formatOfficeHours(hour: (typeof office.hours)[number]) {
  if (hour.opens && hour.closes) return `${hour.opens}~${hour.closes}`;
  return hour.note ?? "휴무";
}

export const navigation = [
  { href: "/properties/", label: "매물" },
  { href: "/complexes/", label: "단지정보" },
  { href: "/office/", label: "사무소 소개" },
  { href: "/blog/", label: "블로그" },
  { href: "/youtube/", label: "유튜브" },
  { href: "/faq/", label: "FAQ·상담" },
  { href: "/location/", label: "오시는 길" },
];

export function isCurrentPath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}
