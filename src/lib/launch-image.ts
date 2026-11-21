// Re-encoding publishes only the rendered pixels, without source image metadata.
export async function composeLaunchImage(
  file: File,
  zoom: number,
  caption: string,
) {
  const bitmap = await createImageBitmap(file);
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 8192 ||
      bitmap.height > 8192
    )
      throw Error("INVALID_IMAGE_CONTENT");
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 768;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("INVALID_IMAGE_CONTENT");
    const crop =
      Math.min(bitmap.width, bitmap.height) / Math.max(1, Math.min(3, zoom));
    ctx.drawImage(
      bitmap,
      (bitmap.width - crop) / 2,
      (bitmap.height - crop) / 2,
      crop,
      crop,
      0,
      0,
      768,
      768,
    );
    if (caption.trim()) {
      ctx.font = "bold 46px Arial, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.lineJoin = "round";
      ctx.lineWidth = 9;
      const lines: string[] = [];
      let line = "";
      for (const character of caption.trim().slice(0, 80)) {
        if (ctx.measureText(line + character).width > 688) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
      if (line) lines.push(line);
      lines.forEach((text, index) => {
        const y = 738 - (lines.length - 1 - index) * 56;
        ctx.strokeStyle = "#111";
        ctx.fillStyle = "#fff";
        ctx.strokeText(text, 384, y);
        ctx.fillText(text, 384, y);
      });
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(Error("INVALID_IMAGE_CONTENT")),
        "image/png",
      ),
    );
    if (blob.size > 2_500_000) throw Error("IMAGE_SIZE_OR_FORMAT");
    return new File([blob], "token.png", { type: "image/png" });
  } finally {
    bitmap.close();
  }
}
