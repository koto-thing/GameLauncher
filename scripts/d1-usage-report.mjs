import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Reject incomplete metrics rather than displaying missing usage as zero
function number(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error("Invalid or missing D1 metric");
  return value;
}

// Summarize a saved GraphQL response without contacting Cloudflare or querying application databases
export function usageReport(document, date, events = []) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Use a real UTC date");
  if (document.errors?.length) throw new Error("Cloudflare returned errors; usage is unknown");
  const accounts = document.data?.viewer?.accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Expected exactly one account");
  const groups = accounts[0].d1AnalyticsAdaptiveGroups;
  if (!Array.isArray(groups) || groups.length === 0 || groups.length >= 10000) throw new Error("Missing or potentially truncated D1 metrics");
  const seen = new Set();
  let reads = 0, writes = 0;
  const lines = [`D1 usage — ${date} UTC (saved snapshot)`, "", "| Database ID | Rows read | Rows written | Read queries | Write queries | D1 p90 ms |", "| --- | ---: | ---: | ---: | ---: | ---: |"];
  for (const group of groups) {
    const id = group.dimensions?.databaseId;
    if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id) || group.dimensions.date !== date || seen.has(id)) throw new Error("Mixed dates or invalid/duplicate database group");
    seen.add(id);
    const values = [group.sum?.rowsRead, group.sum?.rowsWritten, group.sum?.readQueries, group.sum?.writeQueries, group.quantiles?.queryBatchTimeMsP90].map(number);
    reads += values[0]; writes += values[1];
    lines.push(`| ${id} | ${values.join(" | ")} |`);
  }
  lines.push("", `Returned account groups: ${reads} rows read; ${writes} rows written.`,
    "A saved snapshot can be delayed or incomplete; it is not a reservation or a quota guarantee.",
    "D1 p90 measures database time; analytics_report measures complete report time. Errors are not inferred from missing usage.");

  if (events.length) {
    const samples = new Map();
    for (const event of events) {
      if (!["d1_operation", "analytics_report"].includes(event.event)) continue;
      if (typeof event.database !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(event.database) || !["ok", "error"].includes(event.outcome)) throw new Error("Invalid diagnostic event");
      if (event.event === "analytics_report" && !["database", "cache", "coalesced", "rejected"].includes(event.source)) throw new Error("Invalid analytics source");
      const key = `${event.database}/${event.event}${event.event === "analytics_report" ? `/${event.source}` : ""}`;
      const sample = samples.get(key) ?? { count: 0, errors: 0, times: [] };
      sample.count++; sample.errors += Number(event.outcome === "error"); sample.times.push(number(event.elapsedMs));
      samples.set(key, sample);
    }
    lines.push("", "| Database / local log event | Observed calls | Errors | Observed p95 ms |", "| --- | ---: | ---: | ---: |");
    for (const [key, sample] of samples) {
      sample.times.sort((a, b) => a - b);
      lines.push(`| ${key} | ${sample.count} | ${sample.errors} | ${sample.times[Math.ceil(sample.times.length * .95) - 1]} |`);
    }
    lines.push("", "Log samples cover only the supplied observation window; they are not account-wide error totals.");
  }
  return lines.join("\n") + "\n";
}

// Accept only local input paths; never read tokens or transmit diagnostics
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [path, date, logPath, extra] = process.argv.slice(2);
    if (!path || !date || extra) throw new Error("Usage: node scripts/d1-usage-report.mjs metrics.json YYYY-MM-DD [events.jsonl]");
    const document = JSON.parse(await readFile(path, "utf8"));
    const events = logPath ? (await readFile(logPath, "utf8")).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line)) : [];
    process.stdout.write(usageReport(document, date, events));
  } catch (error) {
    console.error(error instanceof SyntaxError ? "Invalid metrics JSON" : error.message);
    process.exitCode = 1;
  }
}
