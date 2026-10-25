import { useLayoutEffect, useState } from "react";
import type { SettingsSection } from "./PersonalPages.js";

export type View = "overview" | "explore" | "records" | "ask" | "profile" | "connections" | "settings";

/** Navigation ids held by one DSH plugin instance; never written to user preferences. */
export interface PanelNavigation {
  view: View;
  record: string;
  explore: string;
  healthTab: string;
  connectionSection: SettingsSection;
}

export function createPanelNavigation(): PanelNavigation {
  return {
    view: "overview",
    record: "",
    explore: "footprints",
    healthTab: "训练",
    connectionSection: "overview",
  };
}

/** Restore committed navigation when DSH remounts its main-panel slot. */
export function usePanelNavigation(retained?: PanelNavigation, initialAsk = false) {
  const [view, setView] = useState<View>(retained?.view ?? (initialAsk ? "ask" : "overview"));
  const [record, setRecord] = useState(retained?.record ?? "");
  const [explore, setExplore] = useState(retained?.explore ?? "footprints");
  const [healthTab, setHealthTab] = useState(retained?.healthTab ?? "训练");
  const [connectionSection, setConnectionSection] = useState<SettingsSection>(
    retained?.connectionSection ?? "overview",
  );
  useLayoutEffect(() => {
    if (retained) Object.assign(retained, { view, record, explore, healthTab, connectionSection });
  }, [retained, view, record, explore, healthTab, connectionSection]);
  return {
    view,
    setView,
    record,
    setRecord,
    explore,
    setExplore,
    healthTab,
    setHealthTab,
    connectionSection,
    setConnectionSection,
  };
}
