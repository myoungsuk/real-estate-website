import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { validateReferencedPublicImages } from "../scripts/public-image-validation.mjs";

test("참조 공개 이미지는 존재 여부, 크기, 픽셀과 메타데이터를 검증한다", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "public-image-validation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const imageDirectory = join(root, "images");
  await mkdir(imageDirectory, { recursive: true });

  const clean = await sharp({
    create: { width: 2, height: 3, channels: 3, background: "#ffffff" },
  }).webp().toBuffer();
  const withMetadata = await sharp(clean).withMetadata({ orientation: 1 }).toBuffer();
  await Promise.all([
    writeFile(join(imageDirectory, "clean.webp"), clean),
    writeFile(join(imageDirectory, "metadata.webp"), withMetadata),
  ]);

  assert.deepEqual(
    await validateReferencedPublicImages({ image: { src: "/images/clean.webp" } }, { publicRoot: root }),
    [],
  );
  assert.match(
    (await validateReferencedPublicImages({ image: { src: "/images/missing.webp" } }, { publicRoot: root })).join("\n"),
    /읽을 수 없습니다/,
  );
  assert.match(
    (await validateReferencedPublicImages({ image: { src: "/images/clean.webp" } }, { publicRoot: root, maxPixels: 5 })).join("\n"),
    /픽셀|읽을 수 없습니다/,
  );
  assert.match(
    (await validateReferencedPublicImages({ image: { src: "/images/metadata.webp" } }, { publicRoot: root })).join("\n"),
    /메타데이터/,
  );
});
