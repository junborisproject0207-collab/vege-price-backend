import fs from "fs/promises";
import path from "path";

const rootDir = path.resolve(process.cwd());
const publicDir = path.join(rootDir, "public");

const versionPath = path.join(publicDir, "vegetables_version.json");
const summaryPath = path.join(publicDir, "meta_summary.json");
const latestPricePath = path.join(publicDir, "prices", "latest.json");
const masterPath = path.join(publicDir, "vegetables_master.json");
const aliasPath = path.join(publicDir, "vegetable_alias.json");
const mappingPath = path.join(publicDir, "vegetable_source_mapping.json");
const unmatchedSummaryPath = path.join(rootDir, "output", "unmatched_summary.json");

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function main() {
  const now = new Date().toISOString();

  const versionJson = (await readJson(versionPath, {
    version: 0,
    updatedAt: now,
  })) || { version: 0, updatedAt: now };

  const masterJson = await readJson(masterPath, { total: 0 });
  const aliasJson = await readJson(aliasPath, { total: 0 });
  const mappingJson = await readJson(mappingPath, { total: 0 });
  const latestPriceJson = await readJson(latestPricePath, { total: 0 });
  const unmatchedSummaryJson = await readJson(unmatchedSummaryPath, {
    unmatched_total_rows: 0,
  });

  const nextVersion = Number(versionJson.version || 0) + 1;

  const nextVersionJson = {
    version: nextVersion,
    updatedAt: now,
  };

  const metaSummary = {
    updatedAt: now,
    vegetables_version: nextVersion,
    vegetables_master_total: Number(masterJson?.total || 0),
    vegetable_alias_total: Number(aliasJson?.total || 0),
    vegetable_source_mapping_total: Number(mappingJson?.total || 0),
    latest_price_total: Number(latestPriceJson?.total || 0),
    latest_unmatched_total: Number(unmatchedSummaryJson?.unmatched_total_rows || 0),
  };

  await fs.writeFile(versionPath, JSON.stringify(nextVersionJson, null, 2), "utf-8");
  await fs.writeFile(summaryPath, JSON.stringify(metaSummary, null, 2), "utf-8");

  console.log("updated vegetables_version.json and meta_summary.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});