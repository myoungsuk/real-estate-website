const responsivePublicImageWidths: Readonly<Record<string, number>> = {
  "/images/area/leaders-city-4-landscape.webp": 2000,
  "/images/area/leaders-city-5-entrance.webp": 2000,
  "/images/area/leaders-city-5-landscape.webp": 2000,
  "/images/area/sinheung-sk-view.webp": 2000,
};

export function getResponsivePublicImageSrcSet(src: string) {
  const originalWidth = responsivePublicImageWidths[src];
  if (!originalWidth) return undefined;
  const stem = src.replace(/\.webp$/u, "");
  return [`${stem}-640.webp 640w`, `${stem}-1200.webp 1200w`, `${src} ${originalWidth}w`].join(", ");
}
