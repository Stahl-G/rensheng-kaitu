import type { StyleSpecification } from "maplibre-gl";
export { cityKey, journeyRoutes } from "@kaitu/core/journey-routes";

/** 保留现有 OpenFreeMap source、字体与署名，只调整兼容的样式图层。 */
export function atlasStyle(
  style: StyleSpecification,
  colors: { water: string; land: string; border: string; muted: string; green: string },
) {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      const source = "source-layer" in layer ? layer["source-layer"] : "";
      if (layer.type === "background")
        return { ...layer, paint: { ...layer.paint, "background-color": colors.land } };
      if (layer.type === "fill") {
        const color =
          source === "water" || /^water(?:$|[-_])/.test(layer.id)
            ? colors.water
            : source === "landcover" || /park|wood/.test(layer.id)
              ? colors.green
              : colors.land;
        return { ...layer, paint: { ...layer.paint, "fill-color": color } };
      }
      if (layer.type === "line" && /boundary|waterway/.test(source ?? "")) {
        return { ...layer, paint: { ...layer.paint, "line-color": colors.border } };
      }
      if (layer.type === "symbol") {
        const important = source === "place" && /country|state/.test(layer.id);
        return {
          ...layer,
          minzoom: important ? layer.minzoom : Math.max(layer.minzoom ?? 0, 6),
          paint: { ...layer.paint, "text-color": colors.muted, "text-halo-color": colors.land },
        };
      }
      return layer;
    }),
  } satisfies StyleSpecification;
}
