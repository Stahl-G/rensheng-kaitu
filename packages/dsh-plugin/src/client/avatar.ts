export async function avatarBase64(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("请选择 JPG、PNG 或 WebP 图片");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法处理头像，请重试");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, 256, 256);
    ctx.drawImage(
      img,
      (img.naturalWidth - size) / 2,
      (img.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] as string;
  } finally {
    URL.revokeObjectURL(url);
  }
}
