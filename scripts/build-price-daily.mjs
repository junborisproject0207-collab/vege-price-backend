import fs from "fs/promises";
import path from "path";

const PRICE_URL =
  "https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx";

const rootDir = path.resolve(process.cwd());
const publicDir = path.join(rootDir, "public");
const outputDir = path.join(rootDir, "output");

const mappingPath = path.join(publicDir, "vegetable_source_mapping.json");
const aliasPath = path.join(publicDir, "vegetable_alias.json");
const ignoreRulesPath = path.join(rootDir, "data", "ignore-rules.json");

const latestPricePath = path.join(publicDir, "prices", "latest.json");
const pendingAliasesPath = path.join(outputDir, "pending_aliases.json");
const unmatchedCsvPath = path.join(outputDir, "unmatched_price_items.csv");
const summaryPath = path.join(outputDir, "summary.json");

function normalize(v) {
  return v ? String(v).trim() : "";
}

function normalizeName(name) {
  return normalize(name)
    .replace(/（.*?）/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/\s+/g, "")
    .replace(/-/g, "")
    .replace(/－/g, "");
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchPriceData() {
  const res = await fetch(PRICE_URL);
  if (!res.ok) {
    throw new Error(`交易行情 API 抓取失敗：HTTP ${res.status}`);
  }
  const json = await res.json();
  if (!Array.isArray(json)) {
    throw new Error("交易行情 API 回傳不是陣列");
  }
  return json;
}

function buildMappingIndex(mappingJson) {
  const records = Array.isArray(mappingJson?.records) ? mappingJson.records : [];

  const byCode = new Map();
  const byName = new Map();

  for (const row of records) {
    const sourceSystem = normalize(row.source_system);
    const sourceCropCode = normalize(row.source_crop_code);
    const sourceCropName = normalize(row.source_crop_name);
    const officialCode = normalize(row.official_code);

    if (!officialCode) continue;

    if (sourceSystem && sourceCropCode) {
      byCode.set(`${sourceSystem}__${sourceCropCode}`, officialCode);
    }

    if (sourceSystem && sourceCropName) {
      byName.set(`${sourceSystem}__${normalizeName(sourceCropName)}`, officialCode);
    }
  }

  return { byCode, byName };
}

function buildAliasIndex(aliasJson) {
  const records = Array.isArray(aliasJson?.records) ? aliasJson.records : [];
  const aliasMap = new Map();

  for (const row of records) {
    const aliasName = normalize(row.alias_name);
    const officialCode = normalize(row.official_code);
    if (!aliasName || !officialCode) continue;

    aliasMap.set(aliasName, officialCode);
    aliasMap.set(normalizeName(aliasName), officialCode);
  }

  return aliasMap;
}

function getField(row, keys) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return "";
}

function shouldIgnoreItem(cropName, cropCode, ignoreRules) {
  const name = normalize(cropName);
  const code = normalize(cropCode);

  const exactNames = ignoreRules?.exact_names || [];
  const exactCodes = ignoreRules?.exact_codes || [];
  const nameContains = ignoreRules?.name_contains || [];

  if (exactNames.includes(name)) return true;
  if (exactCodes.includes(code)) return true;

  for (const keyword of nameContains) {
    if (name.includes(keyword)) return true;
  }

  return false;
}

async function main() {
  try {
    await ensureDir(outputDir);
    await ensureDir(path.join(publicDir, "prices"));

    const mappingJson = JSON.parse(await fs.readFile(mappingPath, "utf-8"));
    const aliasJson = JSON.parse(await fs.readFile(aliasPath, "utf-8"));
    const ignoreRules = JSON.parse(await fs.readFile(ignoreRulesPath, "utf-8"));

    const { byCode, byName } = buildMappingIndex(mappingJson);
    const aliasMap = buildAliasIndex(aliasJson);

    const priceRows = await fetchPriceData();

    const matchedItems = [];
    const pendingItems = [];
    const unmatchedRows = [];

    let matchByCode = 0;
    let matchBySourceName = 0;
    let matchByAlias = 0;
    let unmatched = 0;
    let ignored = 0;

    for (const row of priceRows) {
      const tradeDate = normalize(
        getField(row, ["交易日期", "TransDate", "交易日", "日期", "交易日期日曆"])
      );

      const cropTypeCode = normalize(
        getField(row, ["種類代碼", "種類碼", "種類", "CropTypeCode"])
      );

      const cropCode = normalize(
        getField(row, ["作物代號", "作物代碼", "CropCode", "作物碼"])
      );

      const cropName = normalize(
        getField(row, ["作物名稱", "CropName", "品名", "名稱"])
      );

      const marketCode = normalize(
        getField(row, ["市場代號", "MarketCode", "市場碼"])
      );

      const marketName = normalize(
        getField(row, ["市場名稱", "MarketName", "市場"])
      );

      const upperPrice = Number(
        getField(row, ["上價", "Upper_Price", "最高價"]) || 0
      );

      const middlePrice = Number(
        getField(row, ["中價", "Middle_Price", "中間價"]) || 0
      );

      const lowerPrice = Number(
        getField(row, ["下價", "Lower_Price", "最低價"]) || 0
      );

      const avgPrice = Number(
        getField(row, ["平均價", "Avg_Price", "平均"]) || 0
      );

      const volume = Number(
        getField(row, ["交易量", "TradingVolume", "Volume", "交易量公斤"]) || 0
      );

      if (shouldIgnoreItem(cropName, cropCode, ignoreRules)) {
        ignored++;
        continue;
      }

      let officialCode = "";
      let matchedBy = "";

      // 1) 優先：MAM + 作物代號
      if (cropCode) {
        const key = `MAM__${cropCode}`;
        const found = byCode.get(key);
        if (found) {
          officialCode = found;
          matchedBy = "source_crop_code";
          matchByCode++;
        }
      }

      // 2) 次優先：MAM + 來源名稱
      if (!officialCode && cropName) {
        const key = `MAM__${normalizeName(cropName)}`;
        const found = byName.get(key);
        if (found) {
          officialCode = found;
          matchedBy = "source_crop_name";
          matchBySourceName++;
        }
      }

      // 3) 再用 alias
      if (!officialCode && cropName) {
        const found = aliasMap.get(cropName) || aliasMap.get(normalizeName(cropName));
        if (found) {
          officialCode = found;
          matchedBy = "alias_name";
          matchByAlias++;
        }
      }

      const item = {
        trade_date: tradeDate || null,
        source_system: "MAM",
        crop_type_code: cropTypeCode || null,
        source_crop_code: cropCode || null,
        source_crop_name: cropName || null,
        market_code: marketCode || null,
        market_name: marketName || null,
        upper_price: upperPrice,
        middle_price: middlePrice,
        lower_price: lowerPrice,
        avg_price: avgPrice,
        volume,
        official_code: officialCode || null,
        matched_by: matchedBy || null,
      };

      if (officialCode) {
        matchedItems.push(item);
      } else {
        unmatched++;
        pendingItems.push({
          source_system: "MAM",
          crop_type_code: cropTypeCode || null,
          source_crop_code: cropCode || null,
          source_crop_name: cropName || null,
          market_code: marketCode || null,
          market_name: marketName || null,
          suggested_alias: normalizeName(cropName),
          decision: "pending",
        });

        unmatchedRows.push(item);
      }
    }

    const latestJson = {
      version: 1,
      updatedAt: new Date().toISOString(),
      total: matchedItems.length,
      records: matchedItems,
    };

    const pendingJson = {
      generatedAt: new Date().toISOString(),
      total: pendingItems.length,
      items: pendingItems,
    };

    const summaryJson = {
      generatedAt: new Date().toISOString(),
      total_price_rows: priceRows.length,
      ignored_total: ignored,
      processed_total: matchedItems.length + unmatched,
      matched_total: matchedItems.length,
      unmatched_total: unmatched,
      matched_by_source_crop_code: matchByCode,
      matched_by_source_crop_name: matchBySourceName,
      matched_by_alias: matchByAlias,
    };

    await fs.writeFile(latestPricePath, JSON.stringify(latestJson, null, 2), "utf-8");
    await fs.writeFile(pendingAliasesPath, JSON.stringify(pendingJson, null, 2), "utf-8");
    await fs.writeFile(summaryPath, JSON.stringify(summaryJson, null, 2), "utf-8");

    const csvHeader = [
      "trade_date",
      "source_system",
      "crop_type_code",
      "source_crop_code",
      "source_crop_name",
      "market_code",
      "market_name",
      "avg_price",
      "volume",
      "official_code",
      "matched_by",
    ];

    const csvLines = [
      csvHeader.join(","),
      ...unmatchedRows.map((row) =>
        [
          row.trade_date,
          row.source_system,
          row.crop_type_code,
          row.source_crop_code,
          row.source_crop_name,
          row.market_code,
          row.market_name,
          row.avg_price,
          row.volume,
          row.official_code,
          row.matched_by,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];

    await fs.writeFile(unmatchedCsvPath, csvLines.join("\n"), "utf-8");

    console.log("✅ 第 4 / 6 步完成");
    console.log(`交易行情總筆數：${priceRows.length}`);
    console.log(`已忽略：${ignored}`);
    console.log(`實際處理：${matchedItems.length + unmatched}`);
    console.log(`成功對上：${matchedItems.length}`);
    console.log(`對不到：${unmatched}`);
    console.log(`用代碼對上：${matchByCode}`);
    console.log(`用來源名稱對上：${matchBySourceName}`);
    console.log(`用 alias 對上：${matchByAlias}`);
    console.log("");
    console.log("已產出：");
    console.log(latestPricePath);
    console.log(pendingAliasesPath);
    console.log(unmatchedCsvPath);
    console.log(summaryPath);
  } catch (err) {
    console.error("build-price-daily 執行失敗：", err);
  }
}

main();