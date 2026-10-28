import { type Locale, dimensions, labels, roleLabels } from "./card.js";
import { netWorth } from "./finance.js";
import { decisionLabels } from "./model.js";
import type { Run } from "./simulation.js";
export function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char,
  );
}
export function mapSvg(run: Run | null, count: number, locale: Locale, exported = false): string {
  const en = locale === "en";
  const idx = en ? 1 : 0;
  const end = Math.min(count, run?.changed.length ?? 0);
  const a = run?.baseline[end - 1]?.state ?? run?.initial;
  const b = run?.changed[end - 1]?.state ?? run?.initial;
  const money = (n: number) => `¥${Math.round(n / 100).toLocaleString("en")}`;
  const cards = [a, b]
    .map(
      (s, i) =>
        `<rect x="${40 + i * 450}" y="118" width="410" height="244" rx="10" fill="${i ? "#efe3d2" : "#eeece4"}"/><text x="${66 + i * 450}" y="154" font-size="20" fill="${i ? "#a64c36" : "#69685f"}">${i ? (en ? "YOUR CHOICES" : "你的选择") : en ? "AS THINGS ARE" : "照现在过"}</text><text x="${66 + i * 450}" y="197" font-size="28">${s ? money(netWorth(s.assets)) : "—"}</text><text x="${66 + i * 450}" y="223" font-size="13" fill="#83796c">${en ? "SIMULATED NET ASSETS" : "模拟净资产"} · ${s ? roleLabels[s.role][idx] : ""}</text>${dimensions.map((k, j) => `<text x="${66 + i * 450}" y="${253 + j * 25}" font-size="14">${labels[k][idx]} <tspan x="${408 + i * 450}" text-anchor="end">${s?.props[k] ?? "—"}</tspan></text>`).join("")}`,
    )
    .join("");
  const forks = run?.changed.slice(0, end).filter((row) => row.decision) ?? [];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 940 620" role="img" aria-label="${en ? "Life choices and two paths" : "人生抉择与双线回顾"}"><rect width="940" height="620" rx="12" fill="#f8f3e8"/><g font-family="Georgia, PingFang SC, serif" fill="#352f27"><text x="40" y="48" font-size="15" letter-spacing="3">KAITU / ${en ? "THE NEXT CHAPTER" : "人生的下一页"}</text><text x="40" y="87" font-size="25">${exported ? (en ? "Twelve years. More than one path." : "十二年，不止一种走法。") : `${escapeHtml(run?.config.card.name || "")} · ${en ? "TWO PATHS" : "两条人生"}`}</text>${cards}<text x="40" y="403" font-size="16">${en ? "CHOICES ALONG THE WAY" : "一路上的抉择"}</text><path d="M60 452H880" stroke="#aaa494" stroke-width="2" stroke-dasharray="5 5"/><path d="M60 508H880" stroke="#a64c36" stroke-width="3"/>${forks
    .map((r, i) => {
      const x = 85 + i * 220;
      return `<path d="M${x} 452v56" stroke="#a64c36" stroke-width="1"/><circle cx="${x}" cy="508" r="6" fill="#a64c36"/><text x="${x}" y="435" font-size="12">+${r.offset + 1} ${en ? "YEARS" : "年"}</text><text x="${x}" y="540" font-size="16">${decisionLabels[r.decision?.kind ?? "stay"][idx]}</text>`;
    })
    .join(
      "",
    )}<path d="M40 568H900" stroke="#d8d0c1"/><text x="40" y="596" font-size="12" fill="#83796c">${en ? "Shared world · Different choices · Simulated RMB" : "同一个世界 · 不同的选择 · 模拟人民币"}</text><text x="900" y="596" text-anchor="end" font-size="12" fill="#83796c">${en ? "A game, not a prediction" : "这是推演，不是预测"}</text></g></svg>`;
}
export async function exportPng(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 1880;
    canvas.height = 1240;
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
    const a = document.createElement("a");
    a.href = download;
    a.download = "kaitu-two-paths.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(download), 1000);
  } finally {
    URL.revokeObjectURL(url);
  }
}
