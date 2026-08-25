import { access } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = join(root, "public", "images", "brand", "leaders-city-happy-logo.png");
const output = join(root, "public", "images", "brand", "leaders-city-happy-logo.webp");

await access(source);
await sharp(source)
  .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 92, smartSubsample: true })
  .toFile(output);

console.log("브랜드 로고 WebP 최적화를 완료했습니다.");
