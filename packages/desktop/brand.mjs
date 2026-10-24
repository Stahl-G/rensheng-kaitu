// Product display attribution follows the repository LICENSE; upstream notices stay separate.
export const productCopyright = "Copyright © 2026 Guo Yihong";

export function withProductCopyright(main) {
  const field = 'copyright: ""';
  if (main.split(field).length !== 2) throw new Error("DSH 关于面板版权字段已变化");
  return main.replace(field, `copyright: ${JSON.stringify(productCopyright)}`);
}
