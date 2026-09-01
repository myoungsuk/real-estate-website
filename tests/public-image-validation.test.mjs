import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { prepareComplexImage } from "../scripts/prepare-complex-image.mjs";
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

  const areaDirectory = join(imageDirectory, "area");
  await mkdir(areaDirectory, { recursive: true });
  await writeFile(join(areaDirectory, "published-complex.webp"), clean);
  const publishedComplexContent = {
    complexes: [{ status: "published", image: { src: "/images/area/published-complex.webp", alt: "검증용" } }],
  };
  assert.match(
    (await validateReferencedPublicImages(publishedComplexContent, { publicRoot: root })).join("\n"),
    /640px 파생본[\s\S]*1200px 파생본/,
  );
  await Promise.all([
    writeFile(join(areaDirectory, "published-complex-640.webp"), clean),
    writeFile(join(areaDirectory, "published-complex-1200.webp"), clean),
  ]);
  assert.deepEqual(await validateReferencedPublicImages(publishedComplexContent, { publicRoot: root }), []);
});

test("단지 대표 사진 준비 도구는 메타데이터 없는 2000·640·1200px WebP만 새로 만든다", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "complex-image-preparation-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.jpg");
  const publicRoot = join(root, "public");
  await sharp({
    create: { width: 2100, height: 2000, channels: 3, background: "#567c8d" },
  }).jpeg({ quality: 90 }).withMetadata({ orientation: 1 }).toFile(source);

  const outputs = await prepareComplexImage({ inputPath: source, slug: "sample-complex", publicRoot });
  assert.equal(outputs.length, 3);
  const expectedSizes = new Map([
    ["sample-complex.webp", 2000],
    ["sample-complex-640.webp", 640],
    ["sample-complex-1200.webp", 1200],
  ]);
  for (const output of outputs) {
    const metadata = await sharp(await readFile(output)).metadata();
    assert.equal(metadata.width, expectedSizes.get(output.split(/[\\/]/u).at(-1)));
    assert.equal(metadata.height, metadata.width);
    assert.equal(metadata.format, "webp");
    assert.equal(Boolean(metadata.exif || metadata.xmp || metadata.iptc || metadata.icc), false);
  }

  assert.deepEqual(await validateReferencedPublicImages({
    complexes: [{ status: "published", image: { src: "/images/area/sample-complex.webp", alt: "검증용" } }],
  }, { publicRoot }), []);
  await assert.rejects(
    prepareComplexImage({ inputPath: source, slug: "sample-complex", publicRoot }),
    /기존 파일을 덮어쓰지 않습니다/,
  );
});
