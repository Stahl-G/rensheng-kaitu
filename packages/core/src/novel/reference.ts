export const moonGravity = {
  id: "nasa-moon-surface-gravity",
  value: 1.62,
  unit: "m/s^2",
  version: "1.0.0",
  title: "NASA NSSDCA Moon Fact Sheet",
  url: "https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html",
  sourceUpdated: "2024-01-11",
  checked: "2026-10-16",
  kind: "scientific_reference",
  scope: "现实月球表面常用近似值；人工重力设施与飞行器内有效重力单独判断",
};
export function novelScienceReference(topic: string) {
  return topic === "moon_gravity"
    ? {
        type: "reference",
        reference: moonGravity,
        guidance: "可直接用于现实月面的常识基准，无需作者重新批准。作品明确例外时，以该例外的范围另作判断。",
      }
    : { type: "information_missing", error: "本地资料表暂未收录此项" };
}
