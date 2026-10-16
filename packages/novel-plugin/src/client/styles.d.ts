declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
declare module "maplibre-gl/dist/maplibre-gl-worker.mjs" {
  const source: string;
  export default source;
}
