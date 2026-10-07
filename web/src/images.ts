/**
 * Turning picked photos into something a prompt can carry.
 *
 * The relay caps a single frame at 16 MB and a model bills by pixels, so images are downscaled and
 * re-encoded before they leave the phone. The wire format is pi's: base64 data without the `data:`
 * prefix plus a mime type.
 */
export interface PreparedImage {
  /** For the local echo in the transcript. */
  dataUrl: string;
  /** For the wire: bare base64, no `data:` prefix. */
  data: string;
  mimeType: string;
}

export const MAX_IMAGES_PER_MESSAGE = 4;
/** Longest edge after downscaling; enough for screenshots and photos of documents. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("无法读取这张图片"));
    };
    image.src = url;
  });
}

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("无法读取文件"));
    reader.readAsDataURL(file);
  });
}

/** Downscale when needed, otherwise pass the original bytes through. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  if (scale >= 1 && file.size <= 1_500_000) {
    const dataUrl = await toDataUrl(file);
    const comma = dataUrl.indexOf(",");
    return {
      dataUrl,
      data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
      mimeType: file.type || "image/png",
    };
  }
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器不支持图片处理");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  const comma = dataUrl.indexOf(",");
  return {
    dataUrl,
    data: comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl,
    mimeType: "image/jpeg",
  };
}

/** Prepare a picked set, enforcing the per-message cap. */
export async function prepareImages(files: File[]): Promise<PreparedImage[]> {
  const images: PreparedImage[] = [];
  for (const file of files.slice(0, MAX_IMAGES_PER_MESSAGE)) {
    if (!file.type.startsWith("image/")) continue;
    images.push(await prepareImage(file));
  }
  return images;
}
