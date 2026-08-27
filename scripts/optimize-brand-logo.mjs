import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const root = process.cwd();
const source = join(root, "public", "images", "brand", "leaders-city-happy-logo.png");
const output = join(root, "public", "images", "brand", "leaders-city-happy-logo.webp");
const faviconOutput = join(root, "public", "favicon.ico");
const faviconSizes = [16, 32, 48, 64];

function createIco(images) {
  const headerSize = 6;
  const entrySize = 16;
  const directory = Buffer.alloc(headerSize + entrySize * images.length);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  let imageOffset = directory.length;
  images.forEach(({ size, buffer }, index) => {
    const entryOffset = headerSize + entrySize * index;
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset);
    directory.writeUInt8(size === 256 ? 0 : size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(buffer.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += buffer.length;
  });

  return Buffer.concat([directory, ...images.map(({ buffer }) => buffer)]);
}

await access(source);
await sharp(source)
  .resize({ width: 1000, height: 1000, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 92, smartSubsample: true })
  .toFile(output);

const sourceMetadata = await sharp(source).metadata();
if (sourceMetadata.width !== 1402 || sourceMetadata.height !== 1122) {
  throw new Error("공식 로고 크기가 변경되어 favicon 자르기 영역을 다시 확인해야 합니다.");
}

const faviconImages = await Promise.all(faviconSizes.map(async (size) => ({
  size,
  buffer: await sharp(source)
    .extract({ left: 420, top: 90, width: 560, height: 560 })
    .resize(size, size, { fit: "contain" })
    .png()
    .toBuffer(),
})));
await writeFile(faviconOutput, createIco(faviconImages));

console.log("브랜드 로고 WebP와 favicon.ico 생성을 완료했습니다.");
