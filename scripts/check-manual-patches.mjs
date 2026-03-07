import fs from "fs/promises";
import path from "path";

const rootDir = path.resolve(process.cwd());
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");

const patchesPath = path.join(dataDir, "manual-alias-patches.json");
const masterPath = path.join(publicDir, "vegetables_master.json");

function normalize(v) {
  return v ? String(v).trim() : "";
}

async function main() {
  const patches = JSON.parse(await fs.readFile(patchesPath, "utf-8"));
  const master = JSON.parse(await fs.readFile(masterPath, "utf-8"));

  const masterRecords = Array.isArray(master?.records) ? master.records : [];
  const nameSet = new Set(masterRecords.map((r) => normalize(r.name_zh)));

  let ok = 0;
  let missing = 0;

  console.log("=== Patch 檢查結果 ===\n");

  for (const patch of patches) {
    const matchName = normalize(patch.match_name);
    const targetName = normalize(patch.target_name);

    if (nameSet.has(targetName)) {
      console.log(`✅ OK | ${matchName} -> ${targetName}`);
      ok++;
    } else {
      console.log(`❌ 找不到 target_name | ${matchName} -> ${targetName}`);
      missing++;
    }
  }

  console.log("\n======================");
  console.log(`成功對到主檔名稱：${ok}`);
  console.log(`找不到主檔名稱：${missing}`);
}

main().catch(console.error);