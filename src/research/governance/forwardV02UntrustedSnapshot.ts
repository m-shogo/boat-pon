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
    if (isArray) {
      // Arrays have a known dense-index domain. Pin its descriptors before
      // caller-controlled getPrototypeOf/ownKeys Proxy traps can repair an
      // initially invalid element. This is NOT atomic across malicious inputs.
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 250_000) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      // Pin every immediate index descriptor before traversing a child.
      // A nested child Proxy may replace a later sibling during recursion.
      // This pins sibling references, not mutable fields within those objects.
      const pinned: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("INVALID_SNAPSHOT");
        }
        Object.defineProperty(pinned, String(i), {
          value: descriptor.value,
          enumerable: true, writable: true, configurable: true,
        });
      }
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) {
        // Own indices also bypass ambient Array.prototype numeric setters.
        Object.defineProperty(out, String(i), {
          value: copy(pinned[i], depth + 1),
          enumerable: true, writable: true, configurable: true,
        });
      }
      if (Object.getPrototypeOf(value) !== Array.prototype ||
          Reflect.ownKeys(value).length !== length + 1) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      return out;
    }
    // Generic objects have no schema-known key domain; ownKeys still marks
    // a non-atomic caller-controlled boundary. Do not claim Proxy-proof reads.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    const keys = Reflect.ownKeys(value);
    // Once keys are enumerated, pin their immediate descriptors before
    // recursively visiting any child. ownKeys/prototype traps remain an
    // unavoidable non-atomic boundary for schema-unknown generic objects.
    const pinned: unknown[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (typeof key !== "string") throw new TypeError("INVALID_SNAPSHOT");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
        throw new TypeError("INVALID_SNAPSHOT");
      }
      Object.defineProperty(pinned, String(i), {
        value: descriptor.value,
        enumerable: true, writable: true, configurable: true,
      });
    }
    const out: Record<string, unknown> = Object.create(proto);
    for (let i = 0; i < keys.length; i++) {
      Object.defineProperty(out, keys[i] as string, {
        value: copy(pinned[i], depth + 1),
        enumerable: true, writable: true, configurable: true,
      });
    }
    return out;
  }
  return copy(input, 0);
}

