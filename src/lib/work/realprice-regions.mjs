// 실거래가 받는 지역: 대전광역시 5개 구(2026-11-25 사용자 결정 "대전만 하면 될 것 같아", 설계서 22.4절).
// worker(받기·조회)와 화면(거르기·구 이름)이 이 한 곳을 같이 쓴다. 서버 요청·브라우저 저장은 하지 않는다(src/lib/work 공통 규칙).
// - code: 공공데이터포털 LAWD_CD(법정동 코드 앞 5자리). 받은 항목의 sggCd가 다르면 그 항목을 버린다(worker/realprice-rows.mjs).
// - umdNames: 그 구의 법정동(가나다순). 국토교통부 자료의 법정동 이름과 정확히 같아야 거를 수 있다.
//   다른 구와 이름이 같은 법정동(대동·오동·용계동·삼정동·장동·평촌동)이 있어 법정동 거르기는 늘 구와 함께 건다.
// - 동구(30110)는 처음부터 받던 구라 거래 ID 서명에 구 코드를 넣지 않는다(기존 ID 유지, 설계서 22.6절 1). 나머지 4개 구는 넣는다.
export const REALPRICE_BASE_LAWD = "30110";

export const REALPRICE_REGIONS = Object.freeze([
  Object.freeze({
    code: "30110",
    name: "동구",
    umdNames: Object.freeze([
      "가양동", "가오동", "구도동", "낭월동", "내탑동", "대동", "대별동", "대성동", "마산동", "비룡동",
      "사성동", "삼괴동", "삼성동", "삼정동", "상소동", "성남동", "세천동", "소제동", "소호동", "신상동",
      "신안동", "신촌동", "신하동", "신흥동", "오동", "용계동", "용운동", "용전동", "원동", "이사동",
      "인동", "자양동", "장척동", "정동", "주산동", "주촌동", "중동", "직동", "천동", "추동",
      "판암동", "하소동", "홍도동", "효동", "효평동",
    ]),
  }),
  Object.freeze({
    code: "30140",
    name: "중구",
    umdNames: Object.freeze([
      "구완동", "금동", "대사동", "대흥동", "목달동", "목동", "무수동", "문창동", "문화동", "부사동",
      "사정동", "산성동", "석교동", "선화동", "안영동", "어남동", "오류동", "옥계동", "용두동", "유천동",
      "은행동", "정생동", "중촌동", "침산동", "태평동", "호동",
    ]),
  }),
  Object.freeze({
    code: "30170",
    name: "서구",
    umdNames: Object.freeze([
      "가수원동", "가장동", "갈마동", "관저동", "괴곡동", "괴정동", "내동", "도마동", "도안동", "둔산동",
      "만년동", "매노동", "변동", "복수동", "봉곡동", "산직동", "오동", "용문동", "용촌동", "우명동",
      "원정동", "월평동", "장안동", "정림동", "탄방동", "평촌동", "흑석동",
    ]),
  }),
  Object.freeze({
    code: "30200",
    name: "유성구",
    umdNames: Object.freeze([
      "가정동", "갑동", "계산동", "관평동", "교촌동", "구룡동", "구성동", "구암동", "궁동", "금고동",
      "금탄동", "노은동", "대동", "대정동", "덕명동", "덕진동", "도룡동", "둔곡동", "문지동", "반석동",
      "방동", "방현동", "복용동", "봉명동", "봉산동", "상대동", "성북동", "세동", "송강동", "송정동",
      "수남동", "신동", "신봉동", "신성동", "안산동", "어은동", "외삼동", "용계동", "용산동", "원내동",
      "원신흥동", "원촌동", "자운동", "장대동", "장동", "전민동", "죽동", "지족동", "추목동", "탑립동",
      "하기동", "학하동", "화암동",
    ]),
  }),
  Object.freeze({
    code: "30230",
    name: "대덕구",
    umdNames: Object.freeze([
      "갈전동", "대화동", "덕암동", "목상동", "문평동", "미호동", "법동", "부수동", "비래동", "삼정동",
      "상서동", "석봉동", "송촌동", "신대동", "신일동", "신탄진동", "연축동", "오정동", "와동", "용호동",
      "읍내동", "이현동", "장동", "중리동", "평촌동", "황호동",
    ]),
  }),
]);

export const REALPRICE_LAWD_CODES = Object.freeze(REALPRICE_REGIONS.map((region) => region.code));
export const isRealpriceLawd = (value) => typeof value === "string" && REALPRICE_LAWD_CODES.includes(value);
export const realpriceRegion = (code) => REALPRICE_REGIONS.find((region) => region.code === code) ?? null;

// 구 이름("서구"). 모르는 코드는 빈 글자.
export const regionName = (code) => realpriceRegion(code)?.name ?? "";
// 시·구 이름("대전 서구"). 모르는 코드는 "대전".
export const regionFullName = (code) => (realpriceRegion(code) ? `대전 ${realpriceRegion(code).name}` : "대전");

// 단지 고유번호(aptSeq "30170-1234")의 앞 5자리로 구를 찾는다(관심 단지 목록처럼 거래 행이 없을 때). 모르면 null.
export function lawdOfAptSeq(aptSeq) {
  const head = String(aptSeq ?? "").split("-")[0];
  return isRealpriceLawd(head) ? head : null;
}
