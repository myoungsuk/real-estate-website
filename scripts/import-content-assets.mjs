import { mkdir } from "node:fs/promises";
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
    "id": "224312663653",
    "url": "https://blogthumb.pstatic.net/MjAyNjA2MTFfNTcg/MDAxNzgxMTQ2NjMyMjg3.7-5czrRnGeLGETK6ZFrucKVFZByRsn9T7cr4x_GTpKgg.B7-RmOpGe73PMKYM5ypiNEBGiDXlSUS1zA_fNC4TeAAg.PNG/%C1%A6%B8%F1%C0%BB_%C0%D4%B7%C2%C7%D8%C1%D6%BC%BC%BF%E4._%2820%29.png?type=w2",
    "fileName": "224312663653.webp"
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
    "id": "224131833923",
    "url": "https://blogthumb.pstatic.net/MjAyNjAxMDJfMjAg/MDAxNzY3MzQyMDY1Nzk0.aIBNC2R5sw6DEiLQ9sNFel3Pmbc2Xdv1VYNHxZ660qUg.aUFs7mMugOBoCoqOCyusSS2vUwb38xPPv7QYZQWjKx8g.JPEG/%BA%ED%B7%CE%B1%D7_%B0%A3%C6%C7%BB%E7%C1%F8.jpg?type=w2",
    "fileName": "224131833923.webp"
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
    const response = await fetch(item.url, { headers: group.headers });
    if (!response.ok) throw new Error(`${group.label} 썸네일을 받지 못했습니다: ${item.id} (${response.status})`);
    const input = Buffer.from(await response.arrayBuffer());
    await sharp(input)
      .rotate()
      .resize({ width: 960, height: 540, fit: "cover" })
      .webp({ quality: 82 })
      .toFile(join(group.directory, item.fileName));
  }
}

console.log(`단지 사진 ${suppliedPhotos.length}장, 블로그 썸네일 ${blogThumbnails.length}장, 유튜브 썸네일 ${youtubeThumbnails.length}장을 준비했습니다.`);
