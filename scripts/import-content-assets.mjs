import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const areaDirectory = join(root, "public", "images", "area");
const blogDirectory = join(root, "public", "images", "blog");
const youtubeDirectory = join(root, "public", "images", "youtube");

await Promise.all([
  mkdir(areaDirectory, { recursive: true }),
  mkdir(blogDirectory, { recursive: true }),
  mkdir(youtubeDirectory, { recursive: true }),
]);

const suppliedPhotos = [
  ["KakaoTalk_20260825_141144516.jpg", "leaders-city-5-landscape.webp"],
  ["KakaoTalk_20260825_140920130.jpg", "leaders-city-5-entrance.webp"],
  ["KakaoTalk_20260825_140837284.jpg", "leaders-city-5-courtyard.webp"],
  ["KakaoTalk_20260825_140820390.jpg", "leaders-city-4-landscape.webp"],
];

for (const [inputName, outputName] of suppliedPhotos) {
  await sharp(join(root, "etc", inputName))
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84 })
    .toFile(join(areaDirectory, outputName));
}

const blogThumbnails = [
  {
    "id": "224382351730",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MThfMTIg/MDAxNzg3MDM1OTIzMzMz.moSs8LIU3F3eE_BfBG9DJvOFUgC68tregWc9VerHr98g.WOswQ9Isv9IlycLEmnuGTY7RSCXzmbdFp1Bf5r4hCI4g.PNG/image.png?type=w2",
    "fileName": "224382351730.webp"
  },
  {
    "id": "224379338084",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MTVfMjQy/MDAxNzg2NzU5NzYwNzY2.Kxx9CmLN3et-mJDuVE9jkCYp6Kfb_L6f-TwgatjNneMg.C4LSjeS1V0VuiG25a_6__u8Mf_OJdfz_Zm2dDpS0KeYg.JPEG/8.13%BA%CE%B5%BF%BB%EA_%C1%A4%C3%A5%BF%E4%BE%E0.jpg?type=w2",
    "fileName": "224379338084.webp"
  },
  {
    "id": "224378379746",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MTRfMTU0/MDAxNzg2Njc3MjkwOTYz.LLAov8bP12-8HKdZPti23S0nlbBZJPl9L7vWlLloCrog.XOg6lYi7Ausi-7UnC8u-bwnV8608B3L2OAnedNINMfcg.PNG/s2.png?type=w2",
    "fileName": "224378379746.webp"
  },
  {
    "id": "224376152428",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MTJfMTIz/MDAxNzg2NTA1NTc2NzAw.ybevsiiIrN60Lb6mzd6RVDaDjYTda2uL59g0SthUotgg.aOmXtAka9ulfuq9q-_c8RiucruslFfd_cld9PRN1t9Mg.PNG/ChatGPT_Image_2026%B3%E2_8%BF%F9_12%C0%CF_%BF%C0%C8%C4_12_32_48.png?type=w2",
    "fileName": "224376152428.webp"
  },
  {
    "id": "224370924077",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MDdfNTQg/MDAxNzg2MDcwMTgyNTg1.ezClvfnj8e7MTw_5MVq7vo8igAtxMePJQ_baf6W2pGYg.1RdeYONjtOVZ9MPWMt8seXoIdLQlVgnPuBcL3CQhDLsg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2844%29.png?type=w2",
    "fileName": "224370924077.webp"
  },
  {
    "id": "224369851867",
    "url": "https://blogthumb.pstatic.net/MjAyNjA4MDZfMTgw/MDAxNzg1OTgzODUzNjc0.GcJf8hmRZ7NRmU0odR_7REgEF1Pc7TCdznBsYfnwYDAg.-dN9brw6F8ZVLAYhDhzUymx3cpRaEoWKqoe_jxJKFnIg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2843%29.png?type=w2",
    "fileName": "224369851867.webp"
  },
  {
    "id": "224363658745",
    "url": "https://blogthumb.pstatic.net/MjAyNjA3MzFfMzIg/MDAxNzg1NDYzMDg0Njcy.lHMkP5o4MBdxtSZ-Oi9nDe4chHIj8VHZrQr9NhQGIWQg.bOe-Ce4Z_xexoBPPxhT0yGgcgiJiBXxVvAHN9SirStgg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2843%29.png?type=w2",
    "fileName": "224363658745.webp"
  },
  {
    "id": "224354370463",
    "url": "https://blogthumb.pstatic.net/MjAyNjA3MjJfMjQx/MDAxNzg0Njk5ODQ5MzM0.8lwC1NEMG3LpNh0wKM8rz7P0QglI_DGuh34Xxtcjyqgg.nnAZxMlw53vILqUtgm8NvektUx2HlPDEf-OX-vsRxpog.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2841%29.png?type=w2",
    "fileName": "224354370463.webp"
  },
  {
    "id": "224347446074",
    "url": "https://blogthumb.pstatic.net/MjAyNjA3MTVfMjk2/MDAxNzg0MDk0MzA2NTg0.eMjXgSLVHWRPuOajkwf-xwt5nSh97YjMuaNbdUyKQzkg.oepwpjUd5OIB2sq--dsknpLToqj1ZLcJr6YDUSjEyDog.JPEG/%C1%DF%B0%B3%B4%EB%BB%F3%B9%B0%C8%AE%C0%CE%BC%B3%B8%ED%BC%AD.jpg?type=w2",
    "fileName": "224347446074.webp"
  },
  {
    "id": "224341677916",
    "url": "https://blogthumb.pstatic.net/MjAyNjA3MDlfMTY4/MDAxNzgzNTg2NDgyNzkz.ljw3ufFQ28-HVAEyBguqY4T4d0fuM_PFJwtQwcfrFUYg.7qkFymx55CBK2CVjRIWGqzOQG11FvvdjuYWkKVp_7kIg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2836%29.png?type=w2",
    "fileName": "224341677916.webp"
  },
  {
    "id": "224335467548",
    "url": "https://blogthumb.pstatic.net/MjAyNjA3MDNfMjc1/MDAxNzgzMDYzMjQzNjcx.hOOtJNfBYSbzv5ePAuJFlsecIVIEFdbitav6IVjg64cg.Om-x5HxDtKcTkUdok6mWmU0zJIqRbdQDFTwHZq2y9G8g.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2834%29.png?type=w2",
    "fileName": "224335467548.webp"
  },
  {
    "id": "224328828636",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MjdfMTEy/MDAxNzgyNTMzMjExMzQ3.AlZtVwxXOIjqz7zOnUuw3pS7g5VsxsFi9-8m1iDKqmUg.Hr-NEDfEscGj2QAj2eF4Njuog9QUKVh6uCrtCH1Fus4g.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2831%29.png?type=w2",
    "fileName": "224328828636.webp"
  },
  {
    "id": "224326766768",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MjVfMTIg/MDAxNzgyMzU1NTEwODU4.1n6vW3DFK4piCrXx-H3-ds-coaXoi4H6avdgvvR8R6Ig.4B42vSWj7YsfoXNFaRbm_94H8k4HOovlL6UO-zxi2oAg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2830%29.png?type=w2",
    "fileName": "224326766768.webp"
  },
  {
    "id": "224321578531",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MjBfNzAg/MDAxNzgxOTE3MDk2MDE2.4Tn8WHYb9C7HxKm4mM3qlzi9AllOhKcdrmwg-IdX3F4g.qLvbdWdc8F5ce094Aow8k8pQbkiQ3pHRE8jQw0yyRqwg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2827%29.png?type=w2",
    "fileName": "224321578531.webp"
  },
  {
    "id": "224319835850",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MThfMTc5/MDAxNzgxNzYwNDYwNjEw.RdN4ulOIAuUWTz0SQhLO6uWcjJoaDmw3m10qNsbFnu0g.WzUHKt6B8L6-NAtbTIhnV2PvrDLESjdVaFP1Yd-s28Ug.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2823%29.png?type=w2",
    "fileName": "224319835850.webp"
  },
  {
    "id": "224314616915",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MTNfMTkx/MDAxNzgxMzEyMTc4NTQ1.BpYOmhbsI3zOhMuuxTNU93CwWKbG6eo6y-ewFIv0Xogg.SU5pf5qUH2SiDn9u316uXqgtOLnBpDlkzSBGBBTjxWEg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2821%29.png?type=w2",
    "fileName": "224314616915.webp"
  },
  {
    "id": "224312663653",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MTFfNTcg/MDAxNzgxMTQ2NjMyMjg3.7-5czrRnGeLGETK6ZFrucKVFZByRsn9T7cr4x_GTpKgg.B7-RmOpGe73PMKYM5ypiNEBGiDXlSUS1zA_fNC4TeAAg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2820%29.png?type=w2",
    "fileName": "224312663653.webp"
  },
  {
    "id": "224307605290",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MDZfMTA1/MDAxNzgwNzA5NTY5NTIz.u72PGHshgwkASSv5WgkHAC19hXOBNahqAMaEtuGOmlsg.U9RljgwHAuAqTJY8G8nocjwhf0TnlnDG_60Jr__Vzzcg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2817%29.png?type=w2",
    "fileName": "224307605290.webp"
  },
  {
    "id": "224305512206",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MDRfMTk5/MDAxNzgwNTM3NTI2NzY4.XWI-Fuu_cQ2HdPHipTlcIf7eDF2u0XdYy-SLOivEjYkg.3sl4kTo5vNAAxeO5lBYTe9zSlbh7Ncqvk1wJo5ahV1Mg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2815%29.png?type=w2",
    "fileName": "224305512206.webp"
  },
  {
    "id": "224300760590",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MzBfMjI0/MDAxNzgwMTA1NDI1MTY2.p47FwdiadT_rULxcWDWNwY0RG82awv7OV5wYQsmeGMsg.kmojze_SHDXWj2y434eotHDw-L6B6u29B1-rrju-V0cg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2810%29.png?type=w2",
    "fileName": "224300760590.webp"
  },
  {
    "id": "224297704476",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MjdfMTgx/MDAxNzc5ODQ2NjMyNzAy.e87ZsEZzQWFG3UVlTeA47Tl7AL3cdp8LldnoVVdDrt4g.T-Xmkh-9kVJ_nnbIZn-5XCgk1ywB0mwH0DdsPG3tpHgg.GIF/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%286%29.gif?type=w2",
    "fileName": "224297704476.webp"
  },
  {
    "id": "224293278469",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MjJfMTg1/MDAxNzc5NDE2Mjk3NzY2.-KdJI6FtbQ7y3FbbynHdcPL1p8zugqH0RT-lvthOBk8g.Xf_5R3WIVPiifVMZOMHdc1XAemqaUcPAyg3xrjjktIsg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%288%29.png?type=w2",
    "fileName": "224293278469.webp"
  },
  {
    "id": "224292453548",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MjFfOTAg/MDAxNzc5MzQ0ODQzNDgy.M5E3J89YVIBcaAFpJ58W56qagKXtjoe-rRZBGjRRSH4g.AKa2V7fYaUPxO976rYKZu8tKff22iae-1GmQU7J5A94g.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%286%29.png?type=w2",
    "fileName": "224292453548.webp"
  },
  {
    "id": "224285524138",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MTRfMjEy/MDAxNzc4NzQ1MTUxNTQ1.hZNiEVH80mUveod1w2BHOOUlWqv1eoGmm_F-cM2qaCsg.AG6dzmS5xwNoyRqrZw3hLCBEtHMtep-1RHd2snN3AKIg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%2813%29.png?type=w2",
    "fileName": "224285524138.webp"
  },
  {
    "id": "224284088198",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MTNfMTY0/MDAxNzc4NjQ3NzYwODI3.xNJSmZYck8yWgGxwUcDgJ_Ph14P75GgzWA9OwRn_BHog.EHk3Pqw1s6nsID5h4MYDRA7lFx0F7agYwMPLU0-2GU8g.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%2812%29.png?type=w2",
    "fileName": "224284088198.webp"
  },
  {
    "id": "224275404236",
    "url": "https://blogthumb.pstatic.net/MjAyNjA1MDVfMjYx/MDAxNzc3OTU4NzEwMjA1.4_5mvPmib7Lj0n-aelQAkxvWhAJmh5Y-f2HhuJ4y2Icg.pZ9AjoVg-2LzLJ58jbkArguGGPon5bHee-U6umR-yewg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%2811%29.png?type=w2",
    "fileName": "224275404236.webp"
  },
  {
    "id": "224269328954",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MjlfNDkg/MDAxNzc3NDQ2MDE1NTY3.r6rQsxBy7sb-9iT87u0loxZH2C6kebi4SQRXac3qYjMg.ezy_AKtpYNtbCn9NVGJWswJr9XkEX4onhybFipffpOkg.GIF/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%283%29.gif?type=w2",
    "fileName": "224269328954.webp"
  },
  {
    "id": "224263361924",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MjRfMTY5/MDAxNzc2OTkyMDA1ODA1.nafScBS4LxPdkTVq_s0ZV13i8l5z_rVFq86-P4Z1aysg.sG4WF8vD5rd6r246D4sulX1woP2p-PbTo3LHOEnTVjgg.GIF/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4..gif?type=w2",
    "fileName": "224263361924.webp"
  },
  {
    "id": "224256563083",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MThfMjUx/MDAxNzc2NDc1MDYwNTA5.iHWYhLTgAnVpopIlyRuABbcUTQ73qiMu16yAepuA08Ag.jpRxUWaDxwchJz_k5PA7nXK8sDexb_1nkD7L6mVBWSYg.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%288%29.png?type=w2",
    "fileName": "224256563083.webp"
  },
  {
    "id": "224251731403",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MTRfMTgy/MDAxNzc2MTMxNzc3NTI4.htndBN8isYfzYmNdoEIt5TZHbmczsDP6zb-CqdT_blsg.Df0shOXO0RwGzMjuuFSYRU791SC_AJv0QLxGPScSTsQg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%2810%29.png?type=w2",
    "fileName": "224251731403.webp"
  },
  {
    "id": "224246193805",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MDlfMTM2/MDAxNzc1Njk3OTA4MzE3.F-nuvtOr7KTvDzBuGd4Vfb6klY7fmaIH-gBOXeQ_bFMg.8Hf-WLmmcp4UOZGpL4quzS57GSBcAY2L4t4LyXBEkbgg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%289%29.png?type=w2",
    "fileName": "224246193805.webp"
  },
  {
    "id": "224245204335",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MDhfMTMz/MDAxNzc1NjI2MTI3NTc4.NhUFJOnU8CKFGPeK3L-eUpCR-1fv7Ajp9oZKpabKeQwg.-z2G3WzmaVvFmc3yG9OUyrkmrmhYHoz43HMa6lAX_MMg.GIF/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%282%29.gif?type=w2",
    "fileName": "224245204335.webp"
  },
  {
    "id": "224240447091",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MDRfMjIw/MDAxNzc1MjY4NTU1NTQy.zI2FVZoW0YJUYERa2QY1APCSjZx6Dr1syHiJj_9SmX8g.VMW2KWiCCXZu1NxQLsMPWhLGXfhIsaK2OBQrMiK7v-0g.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%288%29.png?type=w2",
    "fileName": "224240447091.webp"
  },
  {
    "id": "224238518554",
    "url": "https://blogthumb.pstatic.net/MjAyNjA0MDJfMjM4/MDAxNzc1MTE4MzI2NjU5.qYxeW6uYGWqXsKK6619wN5Kjfw9UFTN4IWGxJS0e1bUg.cRbJYduM6T6rNERuZVpTthCvNd1PJZw1qZml9_k-uUEg.GIF/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4__%281%29.gif?type=w2",
    "fileName": "224238518554.webp"
  },
  {
    "id": "224230457536",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMjZfMTQ5/MDAxNzc0NTA4NzQ0MDQw.ZF_Fy33oxWlB38BBExRwViGxFTFOYtkowh9Bw3su8FEg.noYrOQM3On7aFziEMvMhhbhzsbfVs6B4w1vXCKv8Dz0g.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%285%29.png?type=w2",
    "fileName": "224230457536.webp"
  },
  {
    "id": "224228906770",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMjVfMjYw/MDAxNzc0NDA4Mjc3MjIx.XACWCu7RQVBiPNqoyOZvI_v5z-Wco79-uwKCxDDSj5Qg.dkjE5kKa30WEfBgcm4k_5gBMTwwVWxSL6Y5vstu8lCQg.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%284%29.png?type=w2",
    "fileName": "224228906770.webp"
  },
  {
    "id": "224226296215",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMjNfMjYz/MDAxNzc0MjQ0MzIyMjY0.Ok-KnGDPWilD0Dhd2XkHkB5cf0rJBIWnHF3ng51PFGAg.RF6X2DQAyNoY2ZWeY8g4N4SXBTwluX10r7aOyWHeXOkg.JPEG/KakaoTalk_20250112_114830331.jpg?type=w2",
    "fileName": "224226296215.webp"
  },
  {
    "id": "224219599161",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMTdfMjYx/MDAxNzczNzIyMDk4NjYx.NChryzx3E011D6G-f4T5v5rNl4uBqvAy4BaJAM87oKIg.thJiQkZmr5_zL3gMrk7eiDtaUSMDEelquude5vw3P7Qg.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%283%29.png?type=w2",
    "fileName": "224219599161.webp"
  },
  {
    "id": "224218400489",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMTZfNzQg/MDAxNzczNjM5NTk5MDYy.HVMRT4v5ayKerbtMurEihDfjgrTvWxSmWh3zC-LB8L0g.T2P2M6FRKTH5p4lvKhoDIaW_X7tK6p1yoZlOQWLfMFAg.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%282%29.png?type=w2",
    "fileName": "224218400489.webp"
  },
  {
    "id": "224214953344",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMTNfMjYx/MDAxNzczMzcwMjY4MDc1.0AWu48RcGcHP2IwzZ9yJw2td3rb6sPkiRg_VzDnjUi8g.Fu5uyfa2rJj9vVCRMt3lPmmYmLJK8H_rcoVrTl1MQqMg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%284%29.png?type=w2",
    "fileName": "224214953344.webp"
  },
  {
    "id": "224214086081",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMTJfNDcg/MDAxNzczMzAzODY2NjQz.-e0KNvt3DrS3mKoN5VE7KU8pM0QnLKEucy2rkJiDc6gg.9f_Qb0s4dImSDruVhrt-i2P1gSbyEJUaT_ZVB-i6KYIg.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%281%29.png?type=w2",
    "fileName": "224214086081.webp"
  },
  {
    "id": "224201344851",
    "url": "https://blogthumb.pstatic.net/MjAyNjAzMDJfMTk5/MDAxNzcyNDMwMDQ0NTY5.af1J3xJPMyN0ruF6CL2XN-wsD1LSHo0etUnv_oYzR7kg.q2q7v4GuTgPfIlD0XXqok0qEt0ScGTSjhXYGtZ6NjHEg.GIF/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%281%29.gif?type=w2",
    "fileName": "224201344851.webp"
  },
  {
    "id": "224199179963",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjhfMTUy/MDAxNzcyMjU0NzMyNjQ0.UOW90bTbDol4DOChCVISMbcLfo4li5bgrAMjsR_piNog.XDpsA9HHuBvxU3vFYPhvEQD_2djBNNEbGFr_1Js0iUMg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%281%29.png?type=w2",
    "fileName": "224199179963.webp"
  },
  {
    "id": "224196540048",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjZfNzQg/MDAxNzcyMDc0MTgxNTYy.ax3AyXnHf_npl5h4fKsHBcrvCC5YrAOooGzog6AFuRMg.455IF-ll8Q_x4PdMfKhVUq2vlzp58ndxrPmh8uZqticg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4..png?type=w2",
    "fileName": "224196540048.webp"
  },
  {
    "id": "224196469055",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjZfMTEy/MDAxNzcyMDcwOTM2MTM5.HKAtVxbBBA-pjYhSxRsEwJ3NgKbagVF7TzpEUFOZzgwg.lI-iRuVrVuASJG53u_nJv_RcVqmlEf2bycRCwsswVaMg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%283%29.png?type=w2",
    "fileName": "224196469055.webp"
  },
  {
    "id": "224195334532",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjVfMjMg/MDAxNzcxOTkzNDE2MzUz.PrqFx06lw-fCOx-m-sNHj-__uRGPHWnRNlYxIvcfZ2Eg.pB0rl-WgU-azhGSi0ObzJfBawjXQekrnHB3_497yFgQg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%282%29.png?type=w2",
    "fileName": "224195334532.webp"
  },
  {
    "id": "224195239338",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjVfNTQg/MDAxNzcxOTgzNzU0Njg4.5eVTiodkO3heUPpI5hOlObhceS2FXUQoC53Q1zaMyrsg.EIq1Ye453c7-9hegiaSwFo42uKz0eJzP-ktL64oydKMg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%281%29.png?type=w2",
    "fileName": "224195239338.webp"
  },
  {
    "id": "224194134242",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMjRfMTQx/MDAxNzcxOTE1MjUyMjgy.kUod60l96e2L3iLVjClUoFVXY_wJMvgvM-8LZhHYIfMg.RQJilTw6cOvoG7tDA7ruRnIw1Ky-pHXLHB81MeFqH9Qg.PNG/%C0%AF%C0%D4%C4%DC%C5%D9%C3%F7.png?type=w2",
    "fileName": "224194134242.webp"
  },
  {
    "id": "224173805023",
    "url": "https://blogthumb.pstatic.net/MjAyNjAyMDVfMTIg/MDAxNzcwMjc4MDMyMDAw.0N43mC17t5ErqhESH-NFgZOdw72AFOvWsmio1hrW9kUg.X-mSlef0dnywTKnJ7hsVSrKKTWc-gjE3Gbl8lLQv-VEg.PNG/%B8%C5%B9%B0%BC%D2%B0%B3%BB%E7%C1%F8.png?type=w2",
    "fileName": "224173805023.webp"
  },
  {
    "id": "224158005612",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224158005612.webp"
  },
  {
    "id": "224141400831",
    "url": "https://blogthumb.pstatic.net/MjAyNjAxMDdfMzEg/MDAxNzY3NzUzMjQ4NTcy.1QsE0aasWXpFGaLo8AlhU2gdybR-AACnesbB2IF24JUg.UTr6ol_4BR4vtGJIj_0yn_YzwV6mXv6sVWOKQjFM--sg.JPEG/KakaoTalk_20260107_113216763.jpg?type=w2",
    "fileName": "224141400831.webp"
  },
  {
    "id": "224135072923",
    "url": "https://blogthumb.pstatic.net/MjAyNjAxMDVfMjUw/MDAxNzY3NTkyNTEyNjU4.Xijm6azT6TF5DAW4xZTWUNSdtTHdN8WZ6psiE77T73og.1jIVfmMXaAl-ofWC99Xp90QwMmT93f6Wj8VJlCm3Wvog.PNG/%C1%A6%B8%F1%C0%BB-%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001.png?type=w2",
    "fileName": "224135072923.webp"
  },
  {
    "id": "224131833923",
    "url": "https://blogthumb.pstatic.net/MjAyNjAxMDJfMjAg/MDAxNzY3MzQyMDY1Nzk0.aIBNC2R5sw6DEiLQ9sNFel3Pmbc2Xdv1VYNHxZ660qUg.aUFs7mMugOBoCoqOCyusSS2vUwb38xPPv7QYZQWjKx8g.JPEG/%BA%ED%B7%CE%B1%D7_%B0%A3%C6%C7%BB%E7%C1%F8.jpg?type=w2",
    "fileName": "224131833923.webp"
  },
  {
    "id": "224124511713",
    "url": "https://blogthumb.pstatic.net/MjAyNTEyMjdfMjky/MDAxNzY2ODIwMjY3Mjky.y_Otu90K42wA3INEMZYyhMutNYoAUaSRyXvBD1dITtcg.n3TTSteYN4eqDNqakstcSRYBHCvVq8CcaRS1oxGmdvkg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001.png?type=w2",
    "fileName": "224124511713.webp"
  },
  {
    "id": "224124446256",
    "url": "https://blogthumb.pstatic.net/MjAyNTEyMjVfMjU3/MDAxNzY2NjA3OTEyNTc0.X5tvO33JUXolbBeL5PpHkrELLmdAA583f27FNsRqR2Ag.dwgd8SK3w97044UZJWJDuNqBXQam7eXBiI2Ju_qVGYQg.JPEG/KakaoTalk_20251224_165544958.jpg?type=w2",
    "fileName": "224124446256.webp"
  },
  {
    "id": "224101916442",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224101916442.webp"
  },
  {
    "id": "224091355426",
    "url": "https://blogthumb.pstatic.net/MjAyNTExMDdfMjUx/MDAxNzYyNDkwMjYxMTM5.K_wpDg2nycJK5LnIm9cm9BbrfddnAN60VZAPcod5Cywg.nznGvkqBdIe46s-ocqzvbKvKw6qVKmfLQdcuHhfXFy0g.PNG/image.png?type=w2",
    "fileName": "224091355426.webp"
  },
  {
    "id": "224086467661",
    "url": "https://blogthumb.pstatic.net/MjAyNTExMjBfMjM3/MDAxNzYzNjI4MzA3MDc3.l3yBubdTBDH1socS1rdToYwWiV0-tkYmIKm3RFVdlF8g.VO0DZkNc5HNCutDs08z7ymHWPLojOX62ZuLpEywTu6Qg.JPEG/KakaoTalk_20251120_174346957.jpg?type=w2",
    "fileName": "224086467661.webp"
  },
  {
    "id": "224070025795",
    "url": "https://blogthumb.pstatic.net/MjAyNTExMDhfMjg2/MDAxNzYyNTc4MzM3NjEz.JFjEu68qD6FYCP6D2VqSusDhqQX9MglasC0HqcAs2IYg.qs2-9Ls-L5y-w32RI0KVRYbCwAZN8vvin3UqbZPWCgsg.PNG/image.png?type=w2",
    "fileName": "224070025795.webp"
  },
  {
    "id": "224055714010",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224055714010.webp"
  },
  {
    "id": "224035684232",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224035684232.webp"
  },
  {
    "id": "224029820556",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224029820556.webp"
  },
  {
    "id": "224028409377",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224028409377.webp"
  },
  {
    "id": "224014400509",
    "url": "https://blogthumb.pstatic.net/MjAyNTA5MTlfMjg3/MDAxNzU4MjYyODkwMjkw.DezsrZqIuvj9-fibwGM4IN8awYnlN8aRmj8hJJmq3bog.xjP1GybCrdZRhZgH7hTdILyv13XX98w9WRRv71Igi5Eg.JPEG/%BA%ED%B7%CE%B1%D7_%C7%A5%C1%A6.jpg?type=w2",
    "fileName": "224014400509.webp"
  },
  {
    "id": "224012847544",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "224012847544.webp"
  },
  {
    "id": "224012631385",
    "url": "https://blogthumb.pstatic.net/MjAyNTA5MTZfMjA2/MDAxNzU4MDA5OTk3NTE1.qmP47thUv5yFhsCE4bG9aIF3vKNSzwltzq1oJ1rT8R8g.a5dPPJkf7xDe2Lqc_Obs1C4jB7otu6ZTOHjg_XgG_hog.PNG/image.png?type=w2",
    "fileName": "224012631385.webp"
  },
  {
    "id": "224005252885",
    "url": "https://blogthumb.pstatic.net/MjAyNTA5MTJfNzgg/MDAxNzU3NjQ0MTM4OTU5.ysmy6EcgEA6Do2D_RMbmdOM1-uDZKikb0ql0Tu_z0b0g.CDyIxMjeyIcMSXEot9FDAD23bb_FjJO2H3VRNhumYfIg.PNG/image.png?type=w2",
    "fileName": "224005252885.webp"
  },
  {
    "id": "223999622123",
    "url": "https://blogthumb.pstatic.net/MjAyNTA5MDZfMTkw/MDAxNzU3MTM1NDMzNDQ5.gCo-VhcSBUWBkkCWGg4nUzXaYQf9IC_t-6XyvclUgCEg.KvjYosoiqCrpleyNX3IRgta84dFCvkXA9xd9w5Y6OC0g.JPEG/KakaoTalk_20250906_140944544.jpg?type=w2",
    "fileName": "223999622123.webp"
  },
  {
    "id": "223984128962",
    "url": "https://blogthumb.pstatic.net/MjAyNTA4MjZfNzkg/MDAxNzU2MTkwMDkxMDIy.VnQYRAQY8S5xkGjAjlad8WGmDQYP0w2QP7jQXI8L9qMg.Kn3F5q79IIl4K3TB-RLX-VW5InNi2yKYDNPP7ZGPGsMg.JPEG/KakaoTalk_20250826_153356931.jpg?type=w2",
    "fileName": "223984128962.webp"
  },
  {
    "id": "223973145223",
    "url": "https://blogthumb.pstatic.net/MjAyNTA4MTdfMTEw/MDAxNzU1Mzk4NTc4MjA5.lQAQGNLqoJS7Cy_vwtT1veKZyCTRMrjkd51VMfrVGmAg.xEbKTfvjUoPM-yALExbkzh4XdjpglP7uWjlYl8-JkmYg.PNG/image.png?type=w2",
    "fileName": "223973145223.webp"
  },
  {
    "id": "223968399344",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223968399344.webp"
  },
  {
    "id": "223953974226",
    "url": "https://blogthumb.pstatic.net/MjAyNTA3MzFfMjEw/MDAxNzUzOTQ1NTI2MTgz.z8NZS7Q8GA8ieMZOJvqQRlxW1chcSbDyPgNKLTUrV4Qg.Xg6FclOmEG117FCdvQNRyHOWLts9mLAlGALOiphJYg0g.PNG/image.png?type=w2",
    "fileName": "223953974226.webp"
  },
  {
    "id": "223950003880",
    "url": "https://blogthumb.pstatic.net/MjAyNTA3MjhfMTM3/MDAxNzUzNjc4NTk2ODAy.fRXYBcCd_u5A5-MtaAVq2E62gl8t12fqQ4La-0fmdjIg.hqM6tmdqPoWBOWKXT31BLUrOGjrsxxkynen78Cc7ltMg.JPEG/KakaoTalk_20250725_103622109.jpg?type=w2",
    "fileName": "223950003880.webp"
  },
  {
    "id": "223878467943",
    "url": "https://blogthumb.pstatic.net/MjAyNTA1MjZfMjYx/MDAxNzQ4MjQ2MTkwNjY4.dC1qnecIrY4896XSD3xtiuft8iAO2e1inniw6CzoUFog.eSpHhr7TyUhvGPjNptvGq_tnKuKIG6pB5HKqebaTvV0g.JPEG/KakaoTalk_20241218_174955058_11.jpg?type=w2",
    "fileName": "223878467943.webp"
  },
  {
    "id": "223862041792",
    "url": "https://blogthumb.pstatic.net/MjAyNTA1MTFfMTk5/MDAxNzQ2OTQ2MzEwNjkz.ja0R3Fxcd9MCek-_GA6Mlpph_n0vaau_AqQiyowBirEg.vYp-IOZykGAYU0RslHHCRX8X8NhiFeYobb-YALTiLwEg.JPEG/900%A3%DF20250511%A3%DF095621.jpg?type=w2",
    "fileName": "223862041792.webp"
  },
  {
    "id": "223852173189",
    "url": "https://blogthumb.pstatic.net/MjAyNTA1MDFfMTQw/MDAxNzQ2MDczMjQ0Mzk0.b1GUIZ3dG-ttATgLd0cP8OIE1GLDMIlleWObCObeCvcg.20uNhGXZ6J1bg96LXWYpkG7moe3q1br2IdYjHTNAYlUg.JPEG/%BA%ED%B7%CE%B1%D7%C7%A5%C1%A6%BA%CE_%281%29.jpg?type=w2",
    "fileName": "223852173189.webp"
  },
  {
    "id": "223847881996",
    "url": "https://blogthumb.pstatic.net/MjAyNTA0MjdfNTQg/MDAxNzQ1NzQzMTgyOTE0.oVe6vSu8Dai9_jG1aaeECb87pJ25gMwNqHFoFnmgpX0g.ojxxK8AkrSzU_StMRtBw1vf9EQevS8bkmuVM-fk5akIg.JPEG/900%A3%DF20250427%A3%DF100349.jpg?type=w2",
    "fileName": "223847881996.webp"
  },
  {
    "id": "223845889092",
    "url": "https://blogthumb.pstatic.net/MjAyNTA0MjVfNDgg/MDAxNzQ1NTQ1NjM1NTc5.5yiY1cBJiif4SL8m2Pp0z8NON0Jjcomuoa_v8UnMwFQg.iP_GKYZEIuzISarcOW0QY26Z2rqdbWjhCmUOZ5hRx28g.JPEG/%BA%ED%B7%CE%B1%D7%C7%A5%C1%A6%BA%CE-001.jpg?type=w2",
    "fileName": "223845889092.webp"
  },
  {
    "id": "223843873326",
    "url": "https://blogthumb.pstatic.net/MjAyNTA0MjNfMjIw/MDAxNzQ1Mzg4NzEwMDc5.ljttEUJMX9PwET6zjSy0N0_84cDv3R6JaU9dCnv8nNEg.TxAQ8SgMnr-rntub9oDCHLaxUi0Mr02OaIQD-NWvenIg.PNG/image.png?type=w2",
    "fileName": "223843873326.webp"
  },
  {
    "id": "223832770051",
    "url": "https://blogthumb.pstatic.net/MjAyNTA0MTRfMTg4/MDAxNzQ0NjE0NDc1MzEz.JRbYO9pb-IztgFbHVpNApoQyOUbE7K5vILM0S6m9tbIg.jQj0HWi5GoFngMCsMqghbCSXGWSiakk3na0dxLXkYI0g.JPEG/%BD%E6%B3%D7%C0%CF.jpg?type=w2",
    "fileName": "223832770051.webp"
  },
  {
    "id": "223830728330",
    "url": "https://blogthumb.pstatic.net/MjAyNTA0MTJfMTkg/MDAxNzQ0NDQxNzYyMTc2.1L_cdJUaUtbL9hs5jkv7JjhKY5o0Y4NW2z1E8ZKlbpYg.6Pn3PUhAlf_9WlDbSNRZzQZhkyAZklmxaOuIZwfUOpcg.GIF/%C7%C1%B7%CE%C7%CA.gif?type=w2",
    "fileName": "223830728330.webp"
  },
  {
    "id": "223767560517",
    "url": "https://blogthumb.pstatic.net/MjAyNTAyMjBfNSAg/MDAxNzQwMDQzMjIxMTU2.VtmEc8POV_8vtu0CuHzrwLVWzPSAmoVqg3PDkb6yu2Qg.pNQtZ14bTbcaJN4cAnEleP52di4cs1BwfNm-CqJJF60g.PNG/image.png?type=w2",
    "fileName": "223767560517.webp"
  },
  {
    "id": "223753905872",
    "url": "https://blogthumb.pstatic.net/MjAyNTAyMDlfNzMg/MDAxNzM5MDY1MTExNDE3.VWpbDfXplLhA57CiJTOS-H27M5er8zvoIU25AoLUXf0g.REbW8mBNPpbAOcUI0uPcTsCUiJUVRUwAsXzngISHEm0g.PNG/image.png?type=w2",
    "fileName": "223753905872.webp"
  },
  {
    "id": "223737191705",
    "url": "https://blogthumb.pstatic.net/MjAyNTAxMjRfMjI4/MDAxNzM3NzA1OTc0OTQ2.qjMlnF3hIJPrG2OIq_TRClLhy77dtkT9KbQt6_3z6xkg.Nb-ExRAUvKq1lghtUEkMkoB-Yixe5pWQUdksr4onvfgg.JPEG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001.jpg?type=w2",
    "fileName": "223737191705.webp"
  },
  {
    "id": "223732955293",
    "url": "https://blogthumb.pstatic.net/MjAyNTAxMjFfMTg4/MDAxNzM3NDQ4MzQxODUz.j4OGt-zO3d6oRQW7CcUIPjPgW0TuCfUEJfsfKRO1QKog.dktzc8I7_AwXHEYSggv8i0530Ce8PbC7OdbocSH9sJQg.JPEG/KakaoTalk_20241115_161921649_18.jpg?type=w2",
    "fileName": "223732955293.webp"
  },
  {
    "id": "223724622289",
    "url": "https://blogthumb.pstatic.net/MjAyNTAxMTNfMjg0/MDAxNzM2NzUyMjUxNTcz.lWJhh2J_gRIjLBr8zF8JCWZJgHs22BQalJFGHIIOgigg.hyFBgywkzUditRJGD8yt89Cc22AVASNLry3VZu8pPkAg.PNG/5%BA%ED%B7%B0_%BA%ED%B7%CE%B1%D7%C7%A5%C1%A6%BA%CE.png?type=w2",
    "fileName": "223724622289.webp"
  },
  {
    "id": "223723444596",
    "url": "https://blogthumb.pstatic.net/MjAyNTAxMTJfMjY0/MDAxNzM2NjYwODE0MTQ0.VPW5okKAbRQem8M_bX357bj34frKTZRTblCOWJGnx0Ig.zZRBnfENYREGN7jvauqP9yBJkLORwY8KySjIyKdwZVEg.JPEG/KakaoTalk_20250112_114830331.jpg?type=w2",
    "fileName": "223723444596.webp"
  },
  {
    "id": "223676690799",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMjlfNDgg/MDAxNzMyODQwNzE1NDY0.Cn0TVF4NJf-KOI0dw0uZKRpiJEBOOWA16WNgNUgdCCEg.y96MJsv5aaHUSC1D2wHndCIjRVa1P7ocGsA7Nx6R0K4g.PNG/image.png?type=w2",
    "fileName": "223676690799.webp"
  },
  {
    "id": "223673654580",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMjZfMTY3/MDAxNzMyNjA4MzYzMTkz.KXygmSlVJoiriOvO8mw4oEt8vJvTnTrR27jsmG86lC4g.zYu3dYQTsCIiSqwq-i6U0q3c_ltr7-9ER81_fq9EGC0g.PNG/image.png?type=w2",
    "fileName": "223673654580.webp"
  },
  {
    "id": "223661915990",
    "url": "https://phinf.pstatic.net/image.nmv/blog_2024_11_15_763/qVaIQVdnXo_01.jpg?type=w2",
    "fileName": "223661915990.webp"
  },
  {
    "id": "223657501626",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMTJfMTUx/MDAxNzMxMzk1OTg3MTcy.VtdYlCRXyL6bH_0hE6K22Qdl4D_gmlU2NXKJUxaUSWYg.GqNuR-YmPwRivw-UHVZOJLKZf2ZyNDfWTXau5Rk0I2Mg.JPEG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%282%29.jpg?type=w2",
    "fileName": "223657501626.webp"
  },
  {
    "id": "223655540662",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMTFfMTA4/MDAxNzMxMjkxNzQwNjEz.EvdVyiWr4SaMIA6FzWjBIM6tLhgNW1Iv6MVli-_Hu3sg.AwdP_L3XNWCfB-AXuTOekK0tTlbbpmM1MhlzW3qkjm8g.PNG/image.png?type=w2",
    "fileName": "223655540662.webp"
  },
  {
    "id": "223652192911",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMDhfMTYx/MDAxNzMxMDQzNDk1NjY0.2AxHapHxfUsoHsQQVHf2ElmizdoAkL4o_kfWKXh2l4Eg.B8xxNhJUnT8XrY9ArghNTQKKcX7TI-buQ2KKWNGDIMog.JPEG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4_-001_%281%29.jpg?type=w2",
    "fileName": "223652192911.webp"
  },
  {
    "id": "223650445315",
    "url": "https://blogthumb.pstatic.net/MjAyNDExMDdfMTA1/MDAxNzMwOTQxNjcyNTMx.kWxbNXqMNAj_jOaR2vdlFD4jid4N6itOdyhvjcsXEjAg.y_b3zjKqTeuC8r4qYsBj-WuW3zBUA32X10ETBwsiUjgg.PNG/image.png?type=w2",
    "fileName": "223650445315.webp"
  },
  {
    "id": "223649458959",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223649458959.webp"
  },
  {
    "id": "223641435840",
    "url": "https://blogthumb.pstatic.net/MjAyNDEwMzFfMzgg/MDAxNzMwMzYzNTI2MTYy.FVCdGzG2RpA3fLFsvZpbf7YqD3ZSElDRcE_idxW57bsg.FH0vmFMLDufaaJsFByZQQYKLYNm06dtRf3FE5X9pMgMg.PNG/image.png?type=w2",
    "fileName": "223641435840.webp"
  },
  {
    "id": "223639771289",
    "url": "https://blogthumb.pstatic.net/MjAyNDEwMzBfMTYw/MDAxNzMwMjY2ODY2MDY4.GCy4GkSc5ejl1chLNcx4aq5zfLLd6nehQaXCxiCNvIIg.9f_F10nxWWx7jI1T6Z_LfaE9x-4TmmFgjljy5FKhRYog.PNG/image.png?type=w2",
    "fileName": "223639771289.webp"
  },
  {
    "id": "223631773051",
    "url": "https://blogthumb.pstatic.net/MjAyNDEwMjRfMTAx/MDAxNzI5NzQ5MjI3OTkz.Y1oEo_58j4XrcXnpJRqYksPqCINs0I60D71sg3Lqb-Ug.CUSl8LXbEsgu_3qOw7vmEkYaqExqSkkNFTomkvJ0It8g.PNG/image.png?type=w2",
    "fileName": "223631773051.webp"
  },
  {
    "id": "223629052464",
    "url": "https://blogthumb.pstatic.net/MjAyNDEwMjJfMjMg/MDAxNzI5NTgwNTI0NDc0.HpY8IemGFibe4PIYCdGABvoWPjRKewXCxjjGl7QZ9Hkg.6LQ9zkcjKmDf1KQOMruPZyDgxeKBeh2kPH6QRJy5h8Yg.JPEG/%C0%D3%B4%EB%C2%F7%B0%E8%BE%E0%BD%C3_%C0%AF%C0%C7%BB%E7%C7%D7_%BE%CB%BE%C6%BA%B8%B1%E2.jpg?type=w2",
    "fileName": "223629052464.webp"
  },
  {
    "id": "223626512655",
    "url": "https://blogthumb.pstatic.net/MjAyNDEwMjBfMTI5/MDAxNzI5NDI0MjcyMTAz.S3pXJHSKmfFkEYV0aPscMfuZkcTmP8letflt97Pdh4cg.YbMHoQSc49qCf_FVgirbAXJMBQMRk4iLczC6y83xJ9Eg.JPEG/KakaoTalk_20241020_203157859.jpg?type=w2",
    "fileName": "223626512655.webp"
  },
  {
    "id": "223503267208",
    "url": "https://blogthumb.pstatic.net/MjAyNDA3MDZfMTg4/MDAxNzIwMjM2MDc5NzU1.j_79Joct_f6d68Yxt19WM3z8A0UZipGJTW3_JsbK-ccg.sAU1XxyG2MKBf7vthT2eiYq_tyZE-QcKYLNqFpyqGaAg.PNG/image.png?type=w2",
    "fileName": "223503267208.webp"
  },
  {
    "id": "223492996541",
    "url": "https://blogthumb.pstatic.net/MjAyNDA2MjdfMTIw/MDAxNzE5NDU4ODI5NTI0.q7QXVv73UupuRFaYYVXk7bZsH8skjgHF2fMSlUJOFEUg.NAmYdAFVE7Jo_howCVmQYWMKQfkfm1hpKn_ybpU2AHgg.PNG/image.png?type=w2",
    "fileName": "223492996541.webp"
  },
  {
    "id": "223455004930",
    "url": "https://blogthumb.pstatic.net/MjAyNDA1MjJfMTYx/MDAxNzE2MzY0ODA5OTcy.el3tV-ie-oZIZZhFr8_p7kot5zBLvHnDg4fMuLVPLvUg.mw_-gIYV-6EUVkWF0w0lqMe31qcuSbWk5HsMa_oXC_sg.PNG/image.png?type=w2",
    "fileName": "223455004930.webp"
  },
  {
    "id": "223445409176",
    "url": "https://blogthumb.pstatic.net/MjAyNDA1MTNfMTQ0/MDAxNzE1NTg2NDU0NTA3.TmlHo8JS5h0Jy2aHcfJPBJyKrGKp17DOB1PPYipnyKwg.9x906G0rLegZS3k5-iLFsGtLW74WIOj-iJ9uMPBPd1gg.JPEG/KakaoTalk_20240513_164521508_01.jpg?type=w2",
    "fileName": "223445409176.webp"
  },
  {
    "id": "223442326588",
    "url": "https://blogthumb.pstatic.net/MjAyNDA1MTBfMTUg/MDAxNzE1MzA4ODkzNjI4.N6PlFX5AaqufIGSm0yOPeWt2RcD_Bc762UKyJfr8Jkwg.yMb3pV09tRIl6-tePOiOxuSxbC_dE_XH0w91R0VjAr0g.JPEG/KakaoTalk_20240510_101045467_04.jpg?type=w2",
    "fileName": "223442326588.webp"
  },
  {
    "id": "223418182335",
    "url": "https://blogthumb.pstatic.net/MjAyNDA0MTdfMTE4/MDAxNzEzMzI0NjY0OTY1.Av7NQqhV9T-GxozGjyGa19T9ZRtLZXBJD8srmpZECaMg.GWhK5-k4W8NGOIlLR9GZg5LYOQq0D_PKYyxMMNH9bsMg.JPEG/KakaoTalk_20240306_151546349_04.jpg?type=w2",
    "fileName": "223418182335.webp"
  },
  {
    "id": "223417351981",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223417351981.webp"
  },
  {
    "id": "223416271327",
    "url": "https://blogthumb.pstatic.net/MjAyNDA0MTVfMjc4/MDAxNzEzMTY3MjIxNTQ4.SZGWOLG3uQDRQ827lWJN_Cja3jxzSGfEEhQ6YK0n6Egg.ptmdBxPh1XBcX3tFY2vA46MMtVJ1T_NaliK8xG0DrxAg.PNG/image.png?type=w2",
    "fileName": "223416271327.webp"
  },
  {
    "id": "223414260656",
    "url": "https://blogthumb.pstatic.net/MjAyNDA0MTJfNDEg/MDAxNzEyOTAxODIzNjE3.RGOZKfR9IO7ZmXQgFVLf3GC7XZXmgpm381G2WHuApQcg.2knz2rBrUWOnkSdbuorBs2R3Ka2Pw7nN6kFPsKglDXIg.PNG/image.png?type=w2",
    "fileName": "223414260656.webp"
  },
  {
    "id": "223387155798",
    "url": "https://blogthumb.pstatic.net/MjAyNDAzMThfMjY0/MDAxNzEwNzQxNDI5Nzc0.9p8IGvPdRK6qRvxHFoTZ1IO_pl4zmooDtSw50yPMCpsg.erpWx3S3d8dcb0bhJVBJZSeyF0MrQfK7fpObBmaeaoEg.PNG/image.png?type=w2",
    "fileName": "223387155798.webp"
  },
  {
    "id": "223385307413",
    "url": "https://blogthumb.pstatic.net/MjAyNDAzMTZfMTQ2/MDAxNzEwNTcwMTE5NDI4.aylj4V3zJtIN-NuePclMO9qPlUi_oHVQ1OVq23gLggUg.feuSbxiXBLH2L2NNmJH7iOQ6awKu8HkDDl_metwam8Yg.PNG/image.png?type=w2",
    "fileName": "223385307413.webp"
  },
  {
    "id": "223384197240",
    "url": "https://blogthumb.pstatic.net/MjAyNDAzMTVfMjMy/MDAxNzEwNDcyNjU1OTc4.nEkCaj_ldIETWBkJhTF9R4DGfDftsFgqCZsTZRxlZMsg.1FMvf9v6L7A25QmERKMWxX8Adpxwlaje9pH5zInBrywg.PNG/image.png?type=w2",
    "fileName": "223384197240.webp"
  },
  {
    "id": "223382313828",
    "url": "https://blogthumb.pstatic.net/MjAyNDAzMTNfMTU0/MDAxNzEwMzE4ODc0MzUz.K3Exnar02NvmuigBOQ8uMM0qr1LxXoXwbZlKgyIe0mog.qAmSNdWZabKVGhio5obKHzSqetyVFXoMBMaxzrBh-_Mg.JPEG/KakaoTalk_20240312_155323755.jpg?type=w2",
    "fileName": "223382313828.webp"
  },
  {
    "id": "223361958879",
    "url": "https://blogthumb.pstatic.net/MjAyNDAyMjJfMjgy/MDAxNzA4NTg1OTgyNjI0.SU0yrRGAHIal4KWJZ2m_ZXwdLBSxqM9z4hiA3q9h_Mog.0Iv-CtWEJAX5s4SzVunG-cRBTT8E5Cpjci-fGxGhznsg.PNG/image.png?type=w2",
    "fileName": "223361958879.webp"
  },
  {
    "id": "223352270428",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223352270428.webp"
  },
  {
    "id": "223342159057",
    "url": "https://blogthumb.pstatic.net/MjAyNDAyMDJfMjYw/MDAxNzA2ODYwMzI4NzY5.H-UoysiBOsJdQ5TIZbbN5ovoEWSL30uOx0GTQfcs7Osg.4zVzbhNCfp3BejLrjt4x62cy4XHFBoqGCQJqr7JKh9Mg.PNG.p5468300/image.png?type=w2",
    "fileName": "223342159057.webp"
  },
  {
    "id": "223339705157",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMzFfOTcg/MDAxNzA2Njg0NzkyNzk1.DIdb-nq18mO1VA6NoOchHtWQnBKuxMx-OV14h4cMeiYg.LqZHIWOpFrCw60way_g-cmjztztirhoE9WxPUcCSjIQg.PNG.p5468300/image.png?type=w2",
    "fileName": "223339705157.webp"
  },
  {
    "id": "223328363198",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMjBfMTI2/MDAxNzA1NzI5NTI5OTE4.IgAabWtw84zGZ4DZIl_KKdp6R0hT5zL6buLnsQGObNcg.gBvwM1mHkM-1oiGgaY5wZnHr8ExOwqIMyb4CksvjB2Yg.JPEG.p5468300/%B8%C5%B9%B0%C1%A2%BC%F6.jpg?type=w2",
    "fileName": "223328363198.webp"
  },
  {
    "id": "223324306902",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMTZfMzUg/MDAxNzA1MzkxOTEyOTgx.VCUxR0ljRHdfZ0p1hEUIG6KognmJBGTAPVeqByKYrhQg.l0yuFeuerGeYfBwWfxIzfCzOICXZctx5T_cd-8tL8k8g.PNG.p5468300/image.png?type=w2",
    "fileName": "223324306902.webp"
  },
  {
    "id": "223321206784",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMTNfMjgw/MDAxNzA1MTE1MjkzNzY2.LUCrbzVqVGgPLsaLqY-7IamE_XzmnYLUuMrljg9Slrcg.UHPW13_OAFlvB1V8Iy1H_5kRyfFt0lR01tSAtRzoOikg.JPEG.p5468300/photo-1560518883-ce09059eeffa.jpg?type=w2",
    "fileName": "223321206784.webp"
  },
  {
    "id": "223320357797",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMTJfMTk5/MDAxNzA1MDM2ODI1ODk4.GNddTidVLzqBk_-cysSuL-uQBX1lr6U-Sojxlgwa6LYg.PAtcYzQHFxNVWRpDwlkiQwJxieLQ4jN5s4uyS3FMsV0g.JPEG.p5468300/photo-1521791055366-0d553872125f.jpg?type=w2",
    "fileName": "223320357797.webp"
  },
  {
    "id": "223319215177",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMTFfMjAg/MDAxNzA0OTQ5MDA1NTI5.eRJ270sJup5lAQV6pnlFmKQ9SbUXE3wpL3YILrDaQhwg._soHzRz361gISdQpt2sqvmRyBx_Q35m_newPq5MB1aog.PNG.p5468300/image.png?type=w2",
    "fileName": "223319215177.webp"
  },
  {
    "id": "223319078400",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223319078400.webp"
  },
  {
    "id": "223318236852",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMTBfMTIg/MDAxNzA0ODY2Njk4NTQx.DM_kYNNfnVrx0PMGQQ3f7nIh8bGP111U6ho8PS50hswg.TW0NpcZMscvpov_mFTssURwensgCBzELObNQlY8ugsgg.PNG.p5468300/image.png?type=w2",
    "fileName": "223318236852.webp"
  },
  {
    "id": "223314115149",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223314115149.webp"
  },
  {
    "id": "223313176412",
    "url": "https://ssl.pstatic.net/static/blog/icon/og_270x270.png",
    "fileName": "223313176412.webp"
  },
  {
    "id": "223311318023",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMDNfNTcg/MDAxNzA0MjY3MzUxNzYy.nRV8KRU-Ty-kMp6J9U5ct1Rt4r81GHPgW7cEjPX6lrIg.bqFcBtGj6ip7xp_sER0kX_Ca3-U1H2ekTtA0spFNLWYg.JPEG.p5468300/photo-1515263487990-61b07816b324.jpg?type=w2",
    "fileName": "223311318023.webp"
  },
  {
    "id": "223309140196",
    "url": "https://blogthumb.pstatic.net/MjAyNDAxMDFfMjE3/MDAxNzA0MDg4MDUxMTI5.U9uh3uzmN6I60Fr2JKOYtci3gxZDSKGZaO9a5_LHBFkg.kurEag9ZXp-imz3pIqeh83mqNopNn7jp_9xjoPSVenIg.PNG.p5468300/image.png?type=w2",
    "fileName": "223309140196.webp"
  }
];

const youtubeThumbnails = [
  {
    "id": "PiobIEuJysA",
    "url": "https://i.ytimg.com/vi/PiobIEuJysA/maxresdefault.jpg",
    "fileName": "PiobIEuJysA.webp"
  },
  {
    "id": "9Bq2FGQMWHU",
    "url": "https://i.ytimg.com/vi/9Bq2FGQMWHU/maxresdefault.jpg",
    "fileName": "9Bq2FGQMWHU.webp"
  },
  {
    "id": "hbtfA5OFFUE",
    "url": "https://i.ytimg.com/vi/hbtfA5OFFUE/maxresdefault.jpg",
    "fileName": "hbtfA5OFFUE.webp"
  },
  {
    "id": "UMCBjRYcT3c",
    "url": "https://i.ytimg.com/vi/UMCBjRYcT3c/maxresdefault.jpg",
    "fileName": "UMCBjRYcT3c.webp"
  },
  {
    "id": "HHmQrk5Ih60",
    "url": "https://i.ytimg.com/vi/HHmQrk5Ih60/maxresdefault.jpg",
    "fileName": "HHmQrk5Ih60.webp"
  },
  {
    "id": "2KeFUIZW3b0",
    "url": "https://i.ytimg.com/vi/2KeFUIZW3b0/maxresdefault.jpg",
    "fileName": "2KeFUIZW3b0.webp"
  },
  {
    "id": "mVxr8ZIp9kQ",
    "url": "https://i.ytimg.com/vi/mVxr8ZIp9kQ/maxresdefault.jpg",
    "fileName": "mVxr8ZIp9kQ.webp"
  },
  {
    "id": "dV9zSP8qdWw",
    "url": "https://i.ytimg.com/vi/dV9zSP8qdWw/maxresdefault.jpg",
    "fileName": "dV9zSP8qdWw.webp"
  },
  {
    "id": "hxw7F371nfM",
    "url": "https://i.ytimg.com/vi/hxw7F371nfM/maxresdefault.jpg",
    "fileName": "hxw7F371nfM.webp"
  },
  {
    "id": "lj5VYUiJnvs",
    "url": "https://i.ytimg.com/vi/lj5VYUiJnvs/maxresdefault.jpg",
    "fileName": "lj5VYUiJnvs.webp"
  },
  {
    "id": "MNt_bCTGqrM",
    "url": "https://i.ytimg.com/vi/MNt_bCTGqrM/maxresdefault.jpg",
    "fileName": "MNt_bCTGqrM.webp"
  },
  {
    "id": "mW4BR0_Anoc",
    "url": "https://i.ytimg.com/vi/mW4BR0_Anoc/maxresdefault.jpg",
    "fileName": "mW4BR0_Anoc.webp"
  },
  {
    "id": "zIhdMRC_KwY",
    "url": "https://i.ytimg.com/vi/zIhdMRC_KwY/maxresdefault.jpg",
    "fileName": "zIhdMRC_KwY.webp"
  },
  {
    "id": "fJraihw5Wr4",
    "url": "https://i.ytimg.com/vi/fJraihw5Wr4/maxresdefault.jpg",
    "fileName": "fJraihw5Wr4.webp"
  },
  {
    "id": "ZJT4mS-iUnE",
    "url": "https://i.ytimg.com/vi/ZJT4mS-iUnE/maxresdefault.jpg",
    "fileName": "ZJT4mS-iUnE.webp"
  },
  {
    "id": "g7yVkM5Pung",
    "url": "https://i.ytimg.com/vi/g7yVkM5Pung/maxresdefault.jpg",
    "fileName": "g7yVkM5Pung.webp"
  },
  {
    "id": "_UNCuQE5E94",
    "url": "https://i.ytimg.com/vi/_UNCuQE5E94/hqdefault.jpg",
    "fileName": "_UNCuQE5E94.webp"
  },
  {
    "id": "RPGiuca1LBE",
    "url": "https://i.ytimg.com/vi/RPGiuca1LBE/hqdefault.jpg",
    "fileName": "RPGiuca1LBE.webp"
  },
  {
    "id": "GZI03LpIgQc",
    "url": "https://i.ytimg.com/vi/GZI03LpIgQc/hqdefault.jpg",
    "fileName": "GZI03LpIgQc.webp"
  },
  {
    "id": "kM6TLLOrNQU",
    "url": "https://i.ytimg.com/vi/kM6TLLOrNQU/hqdefault.jpg",
    "fileName": "kM6TLLOrNQU.webp"
  },
  {
    "id": "NyholwyOk2A",
    "url": "https://i.ytimg.com/vi/NyholwyOk2A/hqdefault.jpg",
    "fileName": "NyholwyOk2A.webp"
  },
  {
    "id": "KkyM8yGZ86Q",
    "url": "https://i.ytimg.com/vi/KkyM8yGZ86Q/hqdefault.jpg",
    "fileName": "KkyM8yGZ86Q.webp"
  },
  {
    "id": "kdQpvmTCcgw",
    "url": "https://i.ytimg.com/vi/kdQpvmTCcgw/maxresdefault.jpg",
    "fileName": "kdQpvmTCcgw.webp"
  },
  {
    "id": "ghf6NdrNcFM",
    "url": "https://i.ytimg.com/vi/ghf6NdrNcFM/hqdefault.jpg",
    "fileName": "ghf6NdrNcFM.webp"
  },
  {
    "id": "CdniDzI5b5g",
    "url": "https://i.ytimg.com/vi/CdniDzI5b5g/hqdefault.jpg",
    "fileName": "CdniDzI5b5g.webp"
  },
  {
    "id": "0Houw56O5qk",
    "url": "https://i.ytimg.com/vi/0Houw56O5qk/hqdefault.jpg",
    "fileName": "0Houw56O5qk.webp"
  },
  {
    "id": "3Vl70TT_jr4",
    "url": "https://i.ytimg.com/vi/3Vl70TT_jr4/hqdefault.jpg?sqp=-oaymwEmCOADEOgC8quKqQMa8AEB-AHCBoAC4AOKAgwIABABGDwgVihyMA8=&rs=AOn4CLDO89DBK9KQT_N_sd0d-yFp75noSw",
    "fileName": "3Vl70TT_jr4.webp"
  },
  {
    "id": "SlQtYsxZ8G4",
    "url": "https://i.ytimg.com/vi/SlQtYsxZ8G4/hqdefault.jpg",
    "fileName": "SlQtYsxZ8G4.webp"
  },
  {
    "id": "JDgD1FOzuXs",
    "url": "https://i.ytimg.com/vi/JDgD1FOzuXs/hqdefault.jpg",
    "fileName": "JDgD1FOzuXs.webp"
  },
  {
    "id": "3PccpQ6yA0U",
    "url": "https://i.ytimg.com/vi/3PccpQ6yA0U/hqdefault.jpg",
    "fileName": "3PccpQ6yA0U.webp"
  },
  {
    "id": "KRyufkePSsw",
    "url": "https://i.ytimg.com/vi/KRyufkePSsw/hqdefault.jpg",
    "fileName": "KRyufkePSsw.webp"
  },
  {
    "id": "SMDBniBQoEI",
    "url": "https://i.ytimg.com/vi/SMDBniBQoEI/hqdefault.jpg",
    "fileName": "SMDBniBQoEI.webp"
  },
  {
    "id": "gV34kGkTw-M",
    "url": "https://i.ytimg.com/vi/gV34kGkTw-M/hqdefault.jpg",
    "fileName": "gV34kGkTw-M.webp"
  },
  {
    "id": "ziUVjUmYp3Q",
    "url": "https://i.ytimg.com/vi/ziUVjUmYp3Q/maxresdefault.jpg",
    "fileName": "ziUVjUmYp3Q.webp"
  },
  {
    "id": "bhjnp3_w1M8",
    "url": "https://i.ytimg.com/vi/bhjnp3_w1M8/maxresdefault.jpg",
    "fileName": "bhjnp3_w1M8.webp"
  },
  {
    "id": "mCzflFM-4C8",
    "url": "https://i.ytimg.com/vi/mCzflFM-4C8/maxresdefault.jpg",
    "fileName": "mCzflFM-4C8.webp"
  },
  {
    "id": "6jq8O99smgE",
    "url": "https://i.ytimg.com/vi/6jq8O99smgE/maxresdefault.jpg",
    "fileName": "6jq8O99smgE.webp"
  },
  {
    "id": "tDXW9GQSI2A",
    "url": "https://i.ytimg.com/vi/tDXW9GQSI2A/maxresdefault.jpg",
    "fileName": "tDXW9GQSI2A.webp"
  },
  {
    "id": "do1Et_ELJA0",
    "url": "https://i.ytimg.com/vi/do1Et_ELJA0/maxresdefault.jpg",
    "fileName": "do1Et_ELJA0.webp"
  },
  {
    "id": "V5x9YvozZiw",
    "url": "https://i.ytimg.com/vi/V5x9YvozZiw/maxresdefault.jpg",
    "fileName": "V5x9YvozZiw.webp"
  }
];

const thumbnailGroups = [
  {
    label: "블로그",
    directory: blogDirectory,
    headers: {
      Referer: "https://blog.naver.com/p5468300",
      "User-Agent": "Mozilla/5.0",
    },
    items: blogThumbnails,
  },
  {
    label: "유튜브",
    directory: youtubeDirectory,
    headers: { "User-Agent": "Mozilla/5.0" },
    items: youtubeThumbnails,
  },
];

for (const group of thumbnailGroups) {
  for (const item of group.items) {
    const outputPath = join(group.directory, item.fileName);
    try {
      await access(outputPath);
      continue;
    } catch {
      // 새 썸네일만 내려받습니다.
    }
    const response = await fetch(item.url, { headers: group.headers });
    if (!response.ok) throw new Error(`${group.label} 썸네일을 받지 못했습니다: ${item.id} (${response.status})`);
    const input = Buffer.from(await response.arrayBuffer());
    await sharp(input)
      .rotate()
      .resize({ width: 960, height: 540, fit: "cover" })
      .webp({ quality: 82 })
      .toFile(outputPath);
  }
}

console.log(`단지 사진 ${suppliedPhotos.length}장, 블로그 썸네일 ${blogThumbnails.length}장, 유튜브 썸네일 ${youtubeThumbnails.length}장을 준비했습니다.`);
