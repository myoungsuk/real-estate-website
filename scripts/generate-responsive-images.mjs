import { access } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const sourcePaths = [
  "public/images/area/leaders-city-4-landscape.webp",
  "public/images/area/leaders-city-5-entrance.webp",
  "public/images/area/leaders-city-5-landscape.webp",
];
const widths = [640, 1200];

for (const relativeSource of sourcePaths) {
  const source = join(root, relativeSource);
  await access(source);
  const extension = extname(source);
  const stem = basename(source, extension);

  for (const width of widths) {
    const output = join(dirname(source), `${stem}-${width}${extension}`);
    await sharp(source)
      .resize({ width, height: width, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 84, smartSubsample: true, effort: 6 })
      .toFile(output);
  }
}

console.log("반응형 지역 이미지 생성을 완료했습니다.");
