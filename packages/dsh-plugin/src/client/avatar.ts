import type { Area } from "react-easy-crop";

export async function avatarBase64(source: string, area: Area): Promise<string> {
  const img = new Image();
  img.src = source;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法处理头像，请重试");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 256, 256);
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, 256, 256);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1] as string;
}
