import type { BundleInfo, ChangeResult } from "@deepseek-ai/dsh-api-remotes/client";
import index from "../../../../docs/site/plugins/index.json";
import type { PluginItem, PluginRequest } from "./Plugins.js";

interface PluginManager {
  listBundles(): Promise<BundleInfo[]>;
  installBundle(spec: string): Promise<ChangeResult>;
  removeBundle(name: string): Promise<ChangeResult>;
  open(): void;
}

/** The bundled Kaitu directory stays available offline; DSH owns every package operation. */
export function createHostPluginRequest(manager: PluginManager): PluginRequest {
  const catalog: PluginItem[] = index.plugins
    .filter((entry) => entry.name !== "kaitu-dsh")
    .map((entry) => {
      const latest = entry.versions[0];
      const source = latest?.source;
      return {
        name: entry.name,
        title: entry.title,
        description: entry.description,
        version: latest?.version ?? "",
        license: entry.license,
        homepage: entry.homepage,
        dshVersion: latest?.engines.dsh,
        spec:
          source && "url" in source
            ? `git+${source.url}#${source.commit}`
            : latest
              ? `${entry.name}@${latest.version}`
              : "",
        installed: false,
      };
    });
  const changed = async (operation: Promise<ChangeResult>) => {
    const result = await operation;
    if (result.application !== "applied" && result.application !== "restart-required")
      throw new Error(result.error?.diagnostic || result.error?.code || result.application);
    return result;
  };
  return async (action, input) => {
    if (action === "list") {
      const installed = new Map((await manager.listBundles()).map((bundle) => [bundle.name, bundle]));
      return catalog.map((entry) => {
        const bundle = installed.get(entry.name);
        return {
          ...entry,
          installed: bundle?.installed ?? false,
          installedVersion: bundle?.version,
          // Only offer a known older catalog version an update; never downgrade an unlisted version.
          updateAvailable:
            bundle?.installed === true &&
            (index.plugins
              .find((plugin) => plugin.name === entry.name)
              ?.versions.findIndex((version) => version.version === bundle.version) ?? -1) > 0,
          removable: bundle?.removable,
        };
      });
    }
    if (action === "install") {
      const entry = catalog.find((entry) => entry.spec && entry.spec === input);
      if (!entry) throw new Error("Please choose an available Kaitu plugin.");
      return changed(manager.installBundle(entry.spec));
    }
    if (action === "remove") {
      if (!catalog.some((entry) => entry.name === input))
        throw new Error("Please choose an installed Kaitu plugin.");
      return changed(manager.removeBundle(input as string));
    }
    if (action === "open") return manager.open();
    if (action === "explore") return [];
    throw new Error("Open installed plugin pages from the DSH sidebar.");
  };
}
