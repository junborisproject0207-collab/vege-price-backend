import fs from "fs/promises";
import path from "path";

const rootDir = path.resolve(process.cwd());
const dataDir = path.join(rootDir, "data");
const publicDir = path.join(rootDir, "public");

const rawMasterPath = path.join(dataDir, "raw-master.json");
const rawMappingPath = path.join(dataDir, "raw-mapping.json");
const manualAliasPatchesPath = path.join(dataDir, "manual-alias-patches.json");

const vegetablesMasterPath = path.join(publicDir, "vegetables_master.json");
const vegetableSourceMappingPath = path.join(publicDir, "vegetable_source_mapping.json");
const vegetableAliasPath = path.join(publicDir, "vegetable_alias.json");

function normalize(v) {
  return v ? String(v).trim() : "";
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf-8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function readManualAliasPatches() {
  const json = await readJson(manualAliasPatchesPath, []);
  return Array.isArray(json) ? json : [];
}

function splitAliasText(value) {
  const raw = normalize(value);
  if (!raw) return [];
  return raw
    .split(/[、,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildVegetablesMaster(rawMaster) {
  const vegetables = [];
  const seen = new Set();
  let seq = 1;

  for (const row of rawMaster) {
    const officialCode = normalize(row.CROP_UID);
    const name = normalize(row.CNAME);

    if (!officialCode || !name) continue;
    if (seen.has(officialCode)) continue;
    seen.add(officialCode);

    vegetables.push({
      id: `V${String(seq).padStart(6, "0")}`,
      official_code: officialCode,
      name_zh: name,
      category_lv1: normalize(row.PLV1_NAME),
      category_lv2: normalize(row.PLV2_NAME),
      category_lv3: normalize(row.PLV3_NAME),
      status: "active",
    });

    seq++;
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: vegetables.length,
    records: vegetables,
  };
}

function buildVegetableAlias(rawMaster) {
  const aliases = [];
  const seen = new Set();

  for (const row of rawMaster) {
    const officialCode = normalize(row.CROP_UID);
    const mainName = normalize(row.CNAME);
    const aliasName = normalize(row.ALIAS_CNAME);

    if (!officialCode) continue;

    const candidates = new Set();

    if (mainName) candidates.add(mainName);
    for (const a of splitAliasText(aliasName)) {
      candidates.add(a);
    }

    for (const alias of candidates) {
      const clean = normalize(alias);
      if (!clean) continue;

      const key = `${officialCode}__${clean}`;
      if (seen.has(key)) continue;
      seen.add(key);

      aliases.push({
        official_code: officialCode,
        alias_name: clean,
      });
    }
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: aliases.length,
    records: aliases,
  };
}

function buildVegetableSourceMapping(rawMapping) {
  const mappings = [];
  const seen = new Set();

  for (const row of rawMapping) {
    const officialCode = normalize(row.CROP_UID);
    const sourceSystemId = normalize(row.SRC_SYS_ID);
    const sourceName = normalize(row.SRC_NAME);
    const sourceCropCode = normalize(row.SRC_ID);
    const sourceCropName = normalize(row.SRC_CNAME);

    // 只保留批發市場交易行情相關來源
    const isMAM =
      sourceSystemId === "MAM" ||
      sourceName.includes("批發市場") ||
      sourceName.includes("交易行情");

    if (!officialCode || !isMAM) continue;

    const key = `${officialCode}__MAM__${sourceCropCode}__${sourceCropName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    mappings.push({
      official_code: officialCode,
      source_system: "MAM",
      source_crop_code: sourceCropCode || null,
      source_crop_name: sourceCropName || null,
    });
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    total: mappings.length,
    records: mappings,
  };
}

function applyManualAliasPatches(vegetablesMaster, vegetableAlias, manualAliasPatches) {
  const nameToOfficialCode = new Map();
  for (const row of vegetablesMaster.records) {
    const name = normalize(row.name_zh);
    const officialCode = normalize(row.official_code);
    if (name && officialCode) {
      nameToOfficialCode.set(name, officialCode);
    }
  }

  const aliasSeen = new Set(
    vegetableAlias.records.map((r) => `${normalize(r.official_code)}__${normalize(r.alias_name)}`)
  );

  let added = 0;
  let skippedNoTarget = 0;

  for (const patch of manualAliasPatches) {
    const matchName = normalize(patch.match_name);
    const targetName = normalize(patch.target_name);

    if (!matchName || !targetName) continue;

    const officialCode = nameToOfficialCode.get(targetName);
    if (!officialCode) {
      skippedNoTarget++;
      continue;
    }

    const key = `${officialCode}__${matchName}`;
    if (aliasSeen.has(key)) continue;

    vegetableAlias.records.push({
      official_code: officialCode,
      alias_name: matchName,
    });
    aliasSeen.add(key);
    added++;
  }

  vegetableAlias.total = vegetableAlias.records.length;
  vegetableAlias.updatedAt = new Date().toISOString();

  return { added, skippedNoTarget };
}

async function main() {
  try {
    const rawMaster = await readJson(rawMasterPath, []);
    const rawMapping = await readJson(rawMappingPath, []);
    const manualAliasPatches = await readManualAliasPatches();

    if (!Array.isArray(rawMaster) || rawMaster.length === 0) {
      throw new Error("raw-master.json 沒有資料，請先執行 fetch-master.mjs");
    }

    if (!Array.isArray(rawMapping)) {
      throw new Error("raw-mapping.json 格式錯誤");
    }

    await fs.mkdir(publicDir, { recursive: true });

    const vegetablesMaster = buildVegetablesMaster(rawMaster);
    const vegetableAlias = buildVegetableAlias(rawMaster);
    const vegetableSourceMapping = buildVegetableSourceMapping(rawMapping);

    const patchResult = applyManualAliasPatches(
      vegetablesMaster,
      vegetableAlias,
      manualAliasPatches
    );

    // 更新時間
    vegetablesMaster.updatedAt = new Date().toISOString();
    vegetableSourceMapping.updatedAt = new Date().toISOString();

    await fs.writeFile(
      vegetablesMasterPath,
      JSON.stringify(vegetablesMaster, null, 2),
      "utf-8"
    );

    await fs.writeFile(
      vegetableAliasPath,
      JSON.stringify(vegetableAlias, null, 2),
      "utf-8"
    );

    await fs.writeFile(
      vegetableSourceMappingPath,
      JSON.stringify(vegetableSourceMapping, null, 2),
      "utf-8"
    );

    console.log("✅ build-master 完成");
    console.log(`vegetables_master: ${vegetablesMaster.total}`);
    console.log(`vegetable_alias: ${vegetableAlias.total}`);
    console.log(`vegetable_source_mapping: ${vegetableSourceMapping.total}`);
    console.log(`manual alias patches added: ${patchResult.added}`);
    console.log(`manual alias patches skipped(no target): ${patchResult.skippedNoTarget}`);
    console.log("");
    console.log("已產出：");
    console.log(vegetablesMasterPath);
    console.log(vegetableAliasPath);
    console.log(vegetableSourceMappingPath);
  } catch (err) {
    console.error("build-master 執行失敗：", err);
  }
}

main();