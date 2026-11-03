import { types as nodeTypes } from "node:util";

/**
 * Research-only, bounded, getter-free snapshot of caller-controlled metadata.
 * Structural isolation is NOT independent evidence authentication.
 */
function snapshotForwardV02UntrustedGraphInternal(input: unknown, rejectProxies: boolean): unknown {
  let visited = 0;
  function copy(value: unknown, depth: number): unknown {
    if (value === null || typeof value === "string" ||
        typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value !== "object" || depth > 16 || ++visited > 250_000) {
      throw new TypeError("INVALID_SNAPSHOT");
    }
    // Node-only trust-boundary option: reject even revoked Proxies before
    // consulting any caller-controlled descriptor/prototype/ownKeys trap.
    // Legacy descriptor-only callers retain their existing behavior.
    if (rejectProxies && nodeTypes.isProxy(value)) {
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
      const out: unknown[] = [];
      for (let i = 0; i < length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
          throw new TypeError("INVALID_SNAPSHOT");
        }
        // Own indices also bypass ambient Array.prototype numeric setters.
        Object.defineProperty(out, String(i), {
          value: copy(descriptor.value, depth + 1),
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


/**
 * Legacy bounded metadata copy. It is NOT atomic across malicious Proxies.
 * Keep existing callers and regression expectations unchanged during review.
 */
export function snapshotForwardV02UntrustedGraph(input: unknown): unknown {
  return snapshotForwardV02UntrustedGraphInternal(input, false);
}

/**
 * Opt-in Node.js ingress boundary for a caller-owned metadata graph.
 * Rejects every encountered Proxy (including revoked/nested Proxies) BEFORE
 * running its traps. This avoids contradictory shallow-first/deep-first
 * Proxy mutation orders without claiming to authenticate any input.
 *
 * Requires the trusted Node runtime's util.types.isProxy intrinsic; it is
 * not a portable browser/JS-only guarantee and grants no scoring authority.
 */
export function snapshotForwardV02UntrustedGraphRejectingProxies(input: unknown): unknown {
  return snapshotForwardV02UntrustedGraphInternal(input, true);
}
