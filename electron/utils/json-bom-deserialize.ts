/**
 * Deserialize JSON tolerating a leading UTF-8 BOM (U+FEFF).
 *
 * electron-store delegates to `JSON.parse`, which rejects a BOM prefix. The
 * startup repair in `json-bom-recovery.ts` fixes existing files once, but
 * external Windows tooling can rewrite store files with a BOM again at any
 * time. Each electron-store passes this as its `deserialize` option so reads
 * stay resilient at runtime, not only immediately after launch.
 */
export function bomTolerantDeserialize<T = unknown>(value: string): T {
  return JSON.parse(value.replace(/^\uFEFF/, '')) as T;
}
