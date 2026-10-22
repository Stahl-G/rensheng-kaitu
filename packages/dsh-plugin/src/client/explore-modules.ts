/** Only entries with implemented Explore pages are available to add.
 * Workspace module discovery supplies data, not executable page components.
 */
export const exploreModules = [
  {
    id: "footprints",
    title: ["足迹", "Footprints"],
    description: ["看看来路，探索下一站", "Trace your journey, explore what is next"],
    icon: "M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3Zm0-15v15m6-12v15",
  },
  {
    id: "health",
    title: ["健康", "Health"],
    description: ["照顾身体，记录每天的变化", "Care for your body, notice daily changes"],
    icon: "M3 12h4l3-8 4 16 3-8h4",
  },
  {
    id: "news",
    title: ["资讯", "News"],
    description: ["阅读关心的事，保留真实来源", "Read what matters, keep its sources"],
    icon: "M4 4h16v16H4V4Zm4 4h8m-8 4h8m-8 4h4",
  },
  {
    id: "directions",
    title: ["方向", "Directions"],
    description: ["把想法变成可以尝试的一步", "Turn an idea into a step you can try"],
    icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4 6-2 6-6 2 2-6 6-2Z",
  },
] as const;
export const defaultExploreEntries = exploreModules.map(({ id }) => id);
export interface ExploreModule {
  id: string;
  title: readonly [string, string];
  description: readonly [string, string];
  icon: string;
  page?: string;
}
