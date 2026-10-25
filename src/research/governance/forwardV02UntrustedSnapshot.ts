/**
 * Research-only, bounded, getter-free snapshot of caller-controlled metadata.
 * Structural isolation is NOT independent evidence authentication.
 */
export function snapshotForwardV02UntrustedGraph(input: unknown): unknown {
  let visited = 0;
  function copy(value: unknown, depth: number): unknown {
    if (value === null || typeof value === "string" ||
        typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || depth > 16 || ++visited > 250_000) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    const isArray = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (isArray ? proto !== Array.prototype
      : (proto !== Object.prototype && proto !== null)) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    const keys = Reflect.ownKeys(value);
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 ||
          length > 250_000 || keys.length !== length + 1) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("INVALID_SNAPSHOT");
        }
        out[i] = copy(descriptor.value, depth + 1);
      }
      return out;
    }
    const out: Record<string, unknown> = Object.create(proto);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof key !== "string") throw new TypeError("INVALID_SNAPSHOT");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      Object.defineProperty(out, key, {
        value: copy(descriptor.value, depth + 1),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return out;
  }
  return copy(input, 0);
}

