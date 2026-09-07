import { defineConfig } from "drizzle-kit";

// SQLite用Drizzleスキーマとマイグレーション出力先を定義する
export default defineConfig({
  out: "./drizzle",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
