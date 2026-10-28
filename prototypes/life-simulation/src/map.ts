import type { Locale } from "./card.js";
import type { Run } from "./simulation.js";
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
export function mapSvg(run: Run | null, count: number, locale: Locale, exported = false): string {
  const en = locale === "en";
  const current = run?.config.card.age ?? 28;
  const baseline = run?.baseline ?? [];
  const changed = run?.changed ?? [];
  const point = (i: number, side: number) => {
    const stage =
      (side < 0 ? baseline : changed)[i - 1]?.state.props.STAGE ??
      (side < 0 ? Math.floor(i / 3) : Math.floor(i / 2));
    return [400 + side * (105 + stage * 22 + Math.sin(i * 1.7) * 20), 135 + i * 37];
  };
  const path = (side: number) => {
    let d = "M400,120";
    let last = [400, 120];
    for (let i = 1; i <= 10; i++) {
      const p = point(i, side);
      d += ` C${last[0]},${last[1] + 22} ${p[0]},${p[1] - 22} ${p[0]},${p[1]}`;
      last = p;
    }
    return d;
  };
  const terrain = Array.from(
    { length: 7 },
    (_, n) =>
      `<path d="M${-80 + n * 26},620 C${110 + n * 24},480 ${-80 + n * 40},250 ${100 + n * 45},170 S${520 + n * 30},90 850,${-50 + n * 26}"/>`,
  ).join("");
  const nodes = [-1, 1]
    .map((side) =>
      Array.from({ length: 10 }, (_, n) => {
        const i = n + 1;
        const p = point(i, side);
        const active = i <= count;
        const color = side < 0 ? "#999285" : "#a64c36";
        return `<circle cx="${p[0]}" cy="${p[1]}" r="${i === count ? 7 : 4}" fill="${active ? color : "#f5f0e6"}" stroke="${color}" stroke-width="1.6"/>${i % 5 === 0 ? `<text x="${p[0] + side * 17}" y="${p[1] + 4}" text-anchor="${side < 0 ? "end" : "start"}" font-size="13" fill="#716a60">${exported ? `+${i}` : current + i}${en ? (exported ? " yrs" : "") : exported ? " 年" : " 岁"}</text>` : ""}`;
      }).join(""),
    )
    .join("");
  const start = exported
    ? en
      ? "A beginning"
      : "此刻，出发"
    : escapeHtml(run?.config.card.name || (en ? "A beginning" : "此刻，出发"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 680" role="img" aria-label="${en ? "Two possible paths through ten years" : "十年人生的两条分叉路径"}"><rect width="800" height="680" rx="10" fill="#f5f0e6"/><defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#d7cdbb" stroke-width=".5" opacity=".42"/></pattern></defs><rect width="800" height="680" fill="url(#grid)"/><g fill="none" stroke="#d0c7b5" opacity=".42" stroke-width="1">${terrain}</g><g font-family="Georgia, PingFang SC, serif"><text x="44" y="48" font-size="15" letter-spacing="3" fill="#6a6255">KAITU / ${en ? "THE NEXT CHAPTER" : "人生往后推"}</text><text x="754" y="48" text-anchor="end" font-size="12" fill="#8b7a62">${en ? "SIMULATION" : "推演"}</text><text x="400" y="90" text-anchor="middle" font-size="19" fill="#332e28">${start}</text><circle cx="400" cy="120" r="7" fill="#332e28"/><path d="${path(-1)}" fill="none" stroke="#a49b8b" stroke-width="2" stroke-dasharray="5 6"/><path d="${path(1)}" fill="none" stroke="#a64c36" stroke-width="2.5"/>${nodes}<text x="185" y="574" text-anchor="middle" font-size="21" fill="#625b50">${en ? "As things are" : "照现在过"}</text><text x="610" y="574" text-anchor="middle" font-size="21" fill="#a64c36">${en ? "One small change" : "改变一件事"}</text><path d="M44 609H756" stroke="#d2c8b6"/><text x="44" y="641" font-size="13" fill="#716a60">${en ? "One world · Two choices · Ten years" : "同一个世界 · 两种选择 · 十年"}</text><text x="756" y="641" text-anchor="end" font-size="12" fill="#716a60">${run?.config.world === "orbital" ? (en ? "SCI-FI SCENARIO" : "科幻推演") : en ? "A game, not a prediction" : "这是推演，不是预测"}</text></g></svg>`;
}
export async function exportPng(svg: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1600;
    canvas.height = 1360;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("Image export failed"))),
        "image/png",
      ),
    );
    const download = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = download;
    link.download = "kaitu-two-paths.png";
    link.click();
    setTimeout(() => URL.revokeObjectURL(download), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
