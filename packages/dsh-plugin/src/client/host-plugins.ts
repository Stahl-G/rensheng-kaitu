import type { BundleInfo, ChangeResult } from "@deepseek-ai/dsh-api-remotes/client";
import gt from "semver/functions/gt.js";
import satisfies from "semver/functions/satisfies.js";
import index from "../../../../docs/site/plugins/index.json";
import manifest from "../../package.json";
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
      const latest = entry.versions.find(
        (version) =>
          !version.engines.dsh ||
          satisfies(manifest.engines.dsh, version.engines.dsh, { includePrerelease: true }),
      );
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
          source && "url" in source && "commit" in source
            ? `git+${source.url}#${source.commit}`
            : latest
              ? `${entry.name}@${latest.version}`
              : "",
        installed: false,
      };
    });
  if (!catalog.some((entry) => entry.name === "kaitu-auday"))
    catalog.push({
      name: "kaitu-auday",
      title: "Auday",
      description: { zh: "开发中", en: "In development" },
      version: "",
      spec: "",
      installed: false,
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
            !!entry.spec &&
            !!index.plugins
              .find((plugin) => plugin.name === entry.name)
              ?.versions.some((version) => version.version === bundle.version) &&
            gt(entry.version, bundle.version),
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
