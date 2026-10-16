/** 缓存里的解析结果会被之后的请求共用：冻结后误改会直接报错，而不是悄悄改掉缓存。 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
