#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const envConfigPath = path.join(root, "env.config.js");

const required = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "LICENSE_API_BASE",
];

function readConfigText() {
  if (!fs.existsSync(envConfigPath)) {
    throw new Error("env.config.js not found. Run `npm run build` first.");
  }
  return fs.readFileSync(envConfigPath, "utf8");
}

function getValue(text, key) {
  const pattern = new RegExp(`${key}:\\s*(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*')`);
  const m = text.match(pattern);
  if (!m) return "";
  try {
    return JSON.parse(m[1].replace(/^'/, "\"").replace(/'$/, "\""));
  } catch {
    return m[1].slice(1, -1);
  }
}

const text = readConfigText();
let failed = false;

for (const key of required) {
  const value = String(getValue(text, key) || "").trim();
  const isPlaceholder =
    value === "" ||
    /your-project-id|your_supabase_anon_key|your-api\.example\.com|YOUR_/i.test(value);
  if (isPlaceholder) {
    failed = true;
    console.error(`✗ ${key} is missing or still placeholder in env.config.js`);
  } else {
    console.log(`✓ ${key} is set`);
  }
}

if (failed) {
  console.error("\nFix .env / deploy env, then run `npm run build`.");
  process.exit(1);
}

console.log("\nEnvironment config looks good.");
