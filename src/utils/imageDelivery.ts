type ImageDeliveryOptions = {
  width: number;
  height?: number;
  fit?: "fill" | "limit";
};

const CLOUDINARY_UPLOAD_MARKER = "/image/upload/";

function clampDimension(value: number) {
  return Math.max(32, Math.min(2400, Math.round(value)));
}

export function getDeliveredImageUrl(source: string, options: ImageDeliveryOptions) {
  if (!source) return source;

  try {
    const url = new URL(source);
    if (url.hostname !== "res.cloudinary.com") return source;

    const markerIndex = url.pathname.indexOf(CLOUDINARY_UPLOAD_MARKER);
    if (markerIndex < 0) return source;

    const width = clampDimension(options.width);
    const height = options.height ? clampDimension(options.height) : null;
    const fit = options.fit ?? (height ? "fill" : "limit");
    const transformation = [
      "f_auto",
      width >= 900 ? "q_auto:good" : "q_auto:eco",
      `c_${fit}`,
      fit === "fill" ? "g_auto" : null,
      `w_${width}`,
      height ? `h_${height}` : null,
    ].filter(Boolean).join(",");

    const prefix = url.pathname.slice(0, markerIndex + CLOUDINARY_UPLOAD_MARKER.length);
    const assetPath = url.pathname.slice(markerIndex + CLOUDINARY_UPLOAD_MARKER.length);
    url.pathname = `${prefix}${transformation}/${assetPath}`;
    return url.toString();
  } catch {
    return source;
  }
}
