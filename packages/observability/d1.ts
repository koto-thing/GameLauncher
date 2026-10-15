type Metadata = { rows_read?: number; rows_written?: number; duration?: number };
type Result = { success?: boolean; meta?: Metadata };
const originals = new WeakMap<object, object>();

// Observe existing operations without issuing extra queries or recording SQL, values or errors
export function observeD1<T extends object>(db: T, database: string, enabled: boolean): T {
  if (!enabled) return db;

  // Preserve unknown metadata as null rather than claiming that unmeasured reads cost zero
  async function measure(operation: string, execute: () => Promise<unknown>): Promise<unknown> {
    const started = performance.now();
    let results: Result[] = [];
    let outcome = "error";

    try {
      const value = await execute();
      results = (Array.isArray(value) ? value : [value]).filter((item): item is Result => Boolean(item && typeof item === "object"));
      outcome = results.some((item) => item.success === false) ? "error" : "ok";
      return value;
    } finally {
      const total = (field: keyof Metadata): number | null => results.length && results.every((item) => typeof item.meta?.[field] === "number")
        ? results.reduce((sum, item) => sum + item.meta![field]!, 0) : null;

      // Logging failure must never fail a database operation
      try {
        console.info(JSON.stringify({ event: "d1_operation", database, operation, outcome,
          rowsRead: total("rows_read"), rowsWritten: total("rows_written"), databaseMs: total("duration"),
          elapsedMs: Math.round(performance.now() - started) }));
      } catch { /* Best effort diagnostics */ }
    }
  }

  // Keep native statements for batch execution and preserve native method receivers
  function statement(target: object): object {
    const proxy = new Proxy(target, {
      get(object, property) {
        const value = Reflect.get(object, property);
        if (typeof value !== "function") return value;
        if (property === "bind") return (...args: unknown[]) => statement(value.apply(object, args));
        if (["all", "run", "first", "raw"].includes(String(property))) {
          return (...args: unknown[]) => measure(String(property), () => value.apply(object, args));
        }
        return value.bind(object);
      },
    });
    originals.set(proxy, target);
    return proxy;
  }

  return new Proxy(db, {
    get(object, property) {
      const value = Reflect.get(object, property);
      if (typeof value !== "function") return value;
      if (property === "prepare") return (...args: unknown[]) => statement(value.apply(object, args));
      if (property === "batch") return (items: object[]) => measure("batch", () => value.call(object, items.map((item) => originals.get(item) ?? item)));
      return value.bind(object);
    },
  });
}
