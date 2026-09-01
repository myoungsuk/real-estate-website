import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_PIXELS = 20_000_000;
const defaultPublicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../public");

function collectImageReferences(value, path = "root", references = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectImageReferences(item, `${path}[${index}]`, references));
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, child]) => collectImageReferences(child, `${path}.${key}`, references));
  } else if (typeof value === "string" && /^\/images\/.+\.(?:avif|jpe?g|png|webp)$/iu.test(value)) {
    references.push({ path, src: value });
  }
  return references;
}

function collectPublishedComplexResponsiveReferences(content) {
  if (!Array.isArray(content?.complexes)) return [];
  return content.complexes.flatMap((complex, index) => {
    const match = /^\/images\/area\/(.+)\.webp$/u.exec(complex?.status === "published" ? complex?.image?.src ?? "" : "");
    if (!match) return [];
    return [640, 1200].map((width) => ({
      path: `root.complexes[${index}].image.src (${width}px 파생본)`,
      src: `/images/area/${match[1]}-${width}.webp`,
    }));
  });
}

function isWithinRoot(path, root) {
  return path === root || path.startsWith(`${root}${sep}`);
}

export async function validateReferencedPublicImages(content, {
  publicRoot = defaultPublicRoot,
  maxBytes = DEFAULT_MAX_BYTES,
  maxPixels = DEFAULT_MAX_PIXELS,
} = {}) {
  const errors = [];
  const root = resolve(publicRoot);
  const references = [
    ...collectImageReferences(content),
    ...collectPublishedComplexResponsiveReferences(content),
  ];
  const unique = new Map(references.map((reference) => [reference.src, reference]));

  for (const { path, src } of unique.values()) {
    const candidate = resolve(root, src.slice(1));
    if (!isWithinRoot(candidate, root)) {
      errors.push(`${path}: public/images 밖의 이미지 경로입니다.`);
      continue;
    }
    try {
      const [resolvedPath, file] = await Promise.all([realpath(candidate), stat(candidate)]);
      if (!isWithinRoot(resolvedPath, root) || !file.isFile()) {
        errors.push(`${path}: 공개 이미지 파일 경로가 올바르지 않습니다.`);
        continue;
      }
      if (file.size <= 0 || file.size > maxBytes) {
        errors.push(`${path}: 공개 이미지는 2MB 이하여야 합니다.`);
        continue;
      }
      const buffer = await readFile(resolvedPath);
      const metadata = await sharp(buffer, { animated: true, limitInputPixels: maxPixels }).metadata();
      const pixels = (metadata.width ?? 0) * (metadata.height ?? 0);
      if (!metadata.width || !metadata.height || pixels > maxPixels) {
        errors.push(`${path}: 공개 이미지 픽셀 수가 허용 범위를 벗어났습니다.`);
      }
      if ((metadata.pages ?? 1) > 1) errors.push(`${path}: 애니메이션 이미지는 허용하지 않습니다.`);
      if (metadata.exif || metadata.xmp || metadata.iptc || metadata.icc) {
        errors.push(`${path}: EXIF, XMP, IPTC, ICC 메타데이터를 제거해야 합니다.`);
      }
    } catch {
      errors.push(`${path}: 참조한 공개 이미지 파일을 읽을 수 없습니다: ${src}`);
    }
  }
  return errors;
}
