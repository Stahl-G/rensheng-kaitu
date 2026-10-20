import { useState } from "react";
import { createRoot } from "react-dom/client";
import css from "../client/MapPage.module.css";
import { PaperMap } from "../client/PaperMap.js";
import appCss from "../client/Prototype.module.css";
import type { Experience } from "../types.js";

const input = (await fetch("fixtures.json").then((r) => r.json())) as {
  sample: Experience[];
  large: Experience[];
  current: Experience["place"];
};
function Preview() {
  const [theme, setTheme] = useState("light");
  const [large, setLarge] = useState(
    Boolean((window as Window & { __largeFixture?: boolean }).__largeFixture),
  );
  const [empty, setEmpty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const records = empty ? [] : large ? input.large : input.sample;
  const grouped = new Map<string, { id: string; place: Experience["place"]; experiences: Experience[] }>();
  for (const e of records) {
    const id = String(e.place.geonameid);
    const group = grouped.get(id) ?? { id, place: e.place, experiences: [] };
    group.experiences.push(e);
    grouped.set(id, group);
  }
  return (
    <div className={appCss.app} data-theme={theme}>
      <div style={{ display: "flex", gap: 12, padding: 12 }}>
        <strong>合成验收 · 不读取个人资料</strong>
        <button type="button" onClick={() => setTheme((v) => (v === "light" ? "dark" : "light"))}>
          浅 / 深
        </button>
        <button type="button" onClick={() => setLarge((v) => !v)}>
          {large ? "6住 / 20旅 / 3计划 / 2建议" : "300城市 / 2000经历"}
        </button>
        <button type="button" onClick={() => setEmpty((v) => !v)}>
          切换无数据
        </button>
        <span>{selected ? `选中 ${selected}` : "未选城市"}</span>
      </div>
      <div className={css.page}>
        <PaperMap
          cities={[...grouped.values()]}
          selected={selected}
          onSelect={setSelected}
          onShowList={() => setSelected("列表动作已触发")}
          showRoutes
          asOf="2026-10-20"
          current={empty ? undefined : input.current}
          onAdd={(state) => setSelected(`添加动作 ${state}`)}
        />
      </div>
    </div>
  );
}
createRoot(document.getElementById("root") as HTMLElement).render(<Preview />);
