/** Only entries with implemented Explore pages are available to add.
 * Workspace module discovery supplies data, not executable page components.
 */
export const exploreModules = [
  {
    id: "footprints",
    default: true,
    title: ["足迹", "Footprints"],
    description: ["看看来路，探索下一站", "Trace your journey, explore what is next"],
    icon: "M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15",
  },
  {
    id: "health",
    default: true,
    title: ["健康", "Health"],
    description: ["照顾身体，记录每天的变化", "Care for your body, notice daily changes"],
    icon: "M3 12h4l3-8 4 16 3-8h4",
  },
  {
    id: "news",
    default: true,
    title: ["资讯", "News"],
    description: ["阅读关心的事，保留真实来源", "Read what matters, keep its sources"],
    icon: "M4 4h16v16H4V4Zm4 4h8m-8 4h8m-8 4h4",
  },
  {
    id: "directions",
    default: true,
    title: ["方向", "Directions"],
    description: ["把想法变成可以尝试的一步", "Turn an idea into a step you can try"],
    icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6-2 6-6 2 2-6 6-2Z",
  },
  {
    id: "jobs",
    default: false,
    title: ["求职", "Job search"],
    description: ["查看已有岗位和原始来源", "Browse existing positions and their sources"],
    icon: "M8 6V3h8v3M3 6h18v15H3V6Zm0 6h18m-11-2v4h4v-4",
  },
] as const;
export const defaultExploreEntries = exploreModules.filter((entry) => entry.default).map(({ id }) => id);
export interface ExploreModule {
  id: string;
  title: readonly [string, string];
  description: readonly [string, string];
  icon: string;
  page?: string;
}

// 插件在 package.json 里写 SVG 路径就用它；已发布的插件写的是单个字，开图给常用插件配图标。
const pluginIcons: Record<string, string> = {
  // 命理与星象：弯月和一颗星
  "plugin:kaitu-fortune":
    "M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5ZM17 3l.7 1.8 1.8.7-1.8.7L17 8l-.7-1.8-1.8-.7 1.8-.7Z",
  // 写作：笔
  "plugin:kaitu-novel-workspace": "M4 20h4L19 9l-4-4L4 16v4Zm9.5-13.5 4 4M4 20l4-4",
  // Auday：声波
  "plugin:kaitu-auday": "M3 12h1M7 9v6M11 5v14M15 8v8M19 10v4M21 12h0",
};
const pluginDefault = "M12 3 20.5 7.5v9L12 21l-8.5-4.5v-9L12 3Z";
export function moduleIcon(entry: Pick<ExploreModule, "id" | "icon">): string {
  return /^[Mm]\s*-?\d/.test(entry.icon) ? entry.icon : (pluginIcons[entry.id] ?? pluginDefault);
}

/** Counts come from the existing in-memory page projections, never a directory scan. */
export interface ExploreContent {
  hometown: boolean;
  experiences: number;
  healthRecords: number;
  newsTopics: number;
  goals: number;
  directions: number;
}
export function exploreDestination(
  entries: readonly string[],
  content: ExploreContent,
  available: readonly string[] = exploreModules.map(({ id }) => id),
): string {
  if (
    !content.hometown &&
    !content.experiences &&
    !content.healthRecords &&
    !content.newsTopics &&
    !content.goals &&
    !content.directions
  )
    return "modules";
  return entries.find((id) => available.includes(id)) ?? "modules";
}
