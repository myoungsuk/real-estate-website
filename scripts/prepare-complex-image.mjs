import { constants } from "node:fs";
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const outputSizes = [2000, 640, 1200];
const maxOutputBytes = 2 * 1024 * 1024;

function parseArguments(args) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("--input <사진 경로>와 --slug <단지 slug>가 필요합니다.");
    values.set(key, value);
  }
  return { inputPath: values.get("--input"), slug: values.get("--slug") };
}

function getOrientedDimensions(metadata) {
  const swapsAxes = Number.isInteger(metadata.orientation) && metadata.orientation >= 5 && metadata.orientation <= 8;
  return swapsAxes
    ? { width: metadata.height ?? 0, height: metadata.width ?? 0 }
    : { width: metadata.width ?? 0, height: metadata.height ?? 0 };
}

function assertOutput(path, size, data, info) {
  if (data.byteLength <= 0 || data.byteLength > maxOutputBytes) throw new Error(`${basename(path)} 파일은 2MB 이하여야 합니다.`);
  if (info.width !== size || info.height !== size || info.format !== "webp") {
    throw new Error(`${basename(path)} 파일은 ${size}x${size} WebP여야 합니다.`);
  }
}

export async function prepareComplexImage({ inputPath, slug, publicRoot = resolve("public") }) {
  if (!inputPath || !slug) throw new Error("--input <사진 경로>와 --slug <단지 slug>가 필요합니다.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) throw new Error("slug는 영문 kebab-case여야 합니다.");

  const source = resolve(inputPath);
  await access(source);
  const metadata = await sharp(source, { limitInputPixels: 40_000_000 }).metadata();
  const dimensions = getOrientedDimensions(metadata);
  if (Math.min(dimensions.width, dimensions.height) < 2000) {
    throw new Error("대표 사진은 정사각형 자르기 기준 가로·세로가 각각 2,000px 이상이어야 합니다.");
  }

  const areaDirectory = join(resolve(publicRoot), "images", "area");
  await mkdir(areaDirectory, { recursive: true });
  const targets = outputSizes.map((size) => ({
    size,
    path: join(areaDirectory, size === 2000 ? `${slug}.webp` : `${slug}-${size}.webp`),
  }));
  for (const target of targets) {
    try {
      await access(target.path);
      throw new Error(`기존 파일을 덮어쓰지 않습니다: ${target.path}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  const temporaryDirectory = await mkdtemp(join(tmpdir(), "complex-image-"));
  const writtenTargets = [];
  try {
    for (const target of targets) {
      const temporaryPath = join(temporaryDirectory, basename(target.path));
      const { data, info } = await sharp(source, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: target.size, height: target.size, fit: "cover", position: "centre", withoutEnlargement: true })
        .webp({ quality: target.size === 2000 ? 80 : 60, smartSubsample: true, effort: 6 })
        .toBuffer({ resolveWithObject: true });
      assertOutput(temporaryPath, target.size, data, info);
      await writeFile(temporaryPath, data, { flag: "wx" });
    }

    for (const target of targets) {
      await copyFile(join(temporaryDirectory, basename(target.path)), target.path, constants.COPYFILE_EXCL);
      writtenTargets.push(target.path);
    }
    return targets.map((target) => target.path);
  } catch (error) {
    await Promise.all(writtenTargets.map((path) => rm(path, { force: true })));
    throw error;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    const outputs = await prepareComplexImage(parseArguments(process.argv.slice(2)));
    console.log(`단지 대표 사진 3종을 생성했습니다:\n${outputs.join("\n")}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
