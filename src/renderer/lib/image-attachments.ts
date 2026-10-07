/**
 * Preparing picked images for a prompt.
 *
 * pi bills by pixels and providers cap image size, so a 12 MP phone photo should not travel as-is.
 * The policy matches the Feishu H5: downscale to a 1600px longest edge and re-encode as JPEG, while
 * leaving already-small images byte-identical. The result keeps the shape `AttachedImage` already
 * has, so paste, drag & drop, drafts and the attach button all share one path.
 */
export interface ShrunkImage {
  /** base64 without the `data:` prefix, as pi expects. */
  data: string;
  mimeType: string;
  /** Object URL for the preview; revoke it when the attachment is removed. */
  previewUrl: string;
}

/** More than a handful of images per message is rarely useful and costs a lot of context. */
export const MAX_ATTACHED_IMAGES = 6;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
/** Files at or below this size and within the edge limit are sent untouched. */
const PASSTHROUGH_BYTES = 1_500_000;

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("无法读取图片"));
    reader.readAsDataURL(blob);
  });
}

async function shrinkOne(file: File): Promise<ShrunkImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  try {
    if (scale >= 1 && file.size <= PASSTHROUGH_BYTES) {
      return {
        data: await blobToBase64(file),
        mimeType: file.type || "image/png",
        previewUrl: URL.createObjectURL(file),
      };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("无法编码图片");
    return { data: await blobToBase64(blob), mimeType: "image/jpeg", previewUrl: URL.createObjectURL(blob) };
  } finally {
    bitmap.close();
  }
}

/** Shrink the picked images, dropping anything that is not an image and enforcing the cap. */
export async function shrinkImageFiles(files: File[], limit = MAX_ATTACHED_IMAGES): Promise<ShrunkImage[]> {
  const images: ShrunkImage[] = [];
  for (const file of files) {
    if (images.length >= limit) break;
    if (!file.type.startsWith("image/")) continue;
    images.push(await shrinkOne(file));
  }
  return images;
}
