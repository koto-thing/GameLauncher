import assert from "node:assert/strict";
import test from "node:test";
import { usageReport } from "../d1-usage-report.mjs";

// Use synthetic account metrics; these are not measured production values
function fixture() {
  return { data: { viewer: { accounts: [{ d1AnalyticsAdaptiveGroups: ["analytics", "control-plane", "docs"].map((databaseId, index) => ({
    dimensions: { databaseId, date: "2026-10-15" }, sum: { rowsRead: 100 * (index + 1), rowsWritten: 10, readQueries: 5, writeQueries: 2 }, quantiles: { queryBatchTimeMsP90: 12 },
  })) }] } } };
}

test("account report combines all DBs and keeps observed errors separate from quota usage", () => {
  const text = usageReport(fixture(), "2026-10-15", [{ event: "analytics_report", database: "analytics-production", outcome: "error", elapsedMs: 5000 }]);
  assert.match(text, /600 rows read; 30 rows written/);
  assert.match(text, /analytics-production\/analytics_report \| 1 \| 1 \| 5000/);
  assert.match(text, /not account-wide error totals/);
});

test("missing metrics and API errors fail closed instead of appearing as zero load", () => {
  for (const value of [{}, { errors: [{ message: "private server information" }] }, { data: { viewer: { accounts: [] } } }]) assert.throws(() => usageReport(value, "2026-10-15"));
  const value = fixture();
  value.data.viewer.accounts[0].d1AnalyticsAdaptiveGroups[0].sum.rowsRead = null;
  assert.throws(() => usageReport(value, "2026-10-15"), /missing/);
  assert.throws(() => usageReport(fixture(), "2026-02-30"), /real UTC date/);
  assert.throws(() => usageReport(fixture(), "2026-10-14"), /Mixed dates/);
});
