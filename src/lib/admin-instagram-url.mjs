// 관리자 '인스타그램' 카테고리에서 저장 전에 게시물 주소를 정리한다.
// - 공유 주소 뒤의 ?igsh=… 같은 꼬리(공유한 계정을 알려 줌)와 # 뒤는 지운다.
// - 계정 이름이 들어간 게시물 주소(https://www.instagram.com/<계정이름>/p/<코드>/, /<계정이름>/reel/<코드>/)는
//   /p/<코드>/·/reel/<코드>/로 바꾼다. 콘텐츠 검사(scripts/content-validation.mjs)는 /p/·/reel/ 주소만 받으며 그대로 둔다.
// - m.instagram.com·다른 도메인·그 밖의 모양은 바꾸지 않는다(콘텐츠 검사가 저장을 막는다).
export function normalizeInstagramUrl(value) {
  return value
    .replace(/[?#].*$/u, "")
    .replace(/^(https:\/\/(?:www\.)?instagram\.com)\/[A-Za-z0-9._]{1,30}\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/u, "$1/$2/$3/");
}
