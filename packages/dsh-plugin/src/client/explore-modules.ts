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
export type ExploreModule = (typeof exploreModules)[number];
