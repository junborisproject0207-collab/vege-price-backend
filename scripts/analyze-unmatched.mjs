import fs from "fs/promises";
import path from "path";

const rootDir = path.resolve(process.cwd());
const outputDir = path.join(rootDir, "output");
const publicDir = path.join(rootDir, "public");

const unmatchedCsvPath = path.join(outputDir, "unmatched_price_items.csv");
const aliasPath = path.join(publicDir, "vegetable_alias.json");
const masterPath = path.join(publicDir, "vegetables_master.json");

const summaryPath = path.join(outputDir, "unmatched_summary.json");
const topNamesCsvPath = path.join(outputDir, "unmatched_top_names.csv");
const topCodesCsvPath = path.join(outputDir, "unmatched_top_codes.csv");

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

// 簡易 CSV parser：夠用版（因前一步是我們自己產的）
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];

  const headers = splitCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  result.push(current);
  return result;
}

function groupCount(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

async function main() {
  try {
    const csvText = await fs.readFile(unmatchedCsvPath, "utf-8");
    const aliasJson = JSON.parse(await fs.readFile(aliasPath, "utf-8"));
    const masterJson = JSON.parse(await fs.readFile(masterPath, "utf-8"));

    const unmatchedRows = parseCsv(csvText);
    const aliasRecords = Array.isArray(aliasJson?.records) ? aliasJson.records : [];
    const masterRecords = Array.isArray(masterJson?.records) ? masterJson.records : [];

    // 建 alias 正規化索引
    const aliasNormMap = new Map();
    for (const row of aliasRecords) {
      const alias = normalize(row.alias_name);
      const officialCode = normalize(row.official_code);
      if (!alias || !officialCode) continue;

      aliasNormMap.set(normalizeName(alias), officialCode);
    }

    // 建主檔名稱正規化索引
    const masterNormMap = new Map();
    const masterCodeToName = new Map();
    for (const row of masterRecords) {
      const officialCode = normalize(row.official_code);
      const name = normalize(row.name_zh);
      if (!officialCode || !name) continue;

      masterNormMap.set(normalizeName(name), officialCode);
      masterCodeToName.set(officialCode, name);
    }

    // 1) 未對上名稱排行
    const topNames = groupCount(unmatchedRows, (r) => normalize(r.source_crop_name));

    // 2) 未對上代碼排行
    const topCodes = groupCount(unmatchedRows, (r) => normalize(r.source_crop_code));

    // 3) 用正規化名稱試著給建議
    const suggestions = topNames.slice(0, 200).map((item) => {
      const rawName = item.key;
      const norm = normalizeName(rawName);

      let suggestedOfficialCode = "";
      let suggestedName = "";
      let suggestionType = "unknown";

      if (aliasNormMap.has(norm)) {
        suggestedOfficialCode = aliasNormMap.get(norm);
        suggestedName = masterCodeToName.get(suggestedOfficialCode) || "";
        suggestionType = "alias_normalized_match";
      } else if (masterNormMap.has(norm)) {
        suggestedOfficialCode = masterNormMap.get(norm);
        suggestedName = masterCodeToName.get(suggestedOfficialCode) || "";
        suggestionType = "master_name_normalized_match";
      }

      return {
        source_crop_name: rawName,
        count: item.count,
        normalized_name: norm,
        suggestion_type: suggestionType,
        suggested_official_code: suggestedOfficialCode || null,
        suggested_name_zh: suggestedName || null,
      };
    });

    const summary = {
      generatedAt: new Date().toISOString(),
      unmatched_total_rows: unmatchedRows.length,
      distinct_unmatched_names: topNames.length,
      distinct_unmatched_codes: topCodes.length,
      top_20_names: topNames.slice(0, 20),
      top_20_codes: topCodes.slice(0, 20),
      suggestions_top_200: suggestions,
    };

    // 輸出 JSON
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");

    // 輸出 top names csv
    const topNamesLines = [
      [
        "source_crop_name",
        "count",
        "normalized_name",
        "suggestion_type",
        "suggested_official_code",
        "suggested_name_zh",
      ].join(","),
      ...suggestions.map((s) =>
        [
          s.source_crop_name,
          s.count,
          s.normalized_name,
          s.suggestion_type,
          s.suggested_official_code,
          s.suggested_name_zh,
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];

    await fs.writeFile(topNamesCsvPath, topNamesLines.join("\n"), "utf-8");

    // 輸出 top codes csv
    const topCodesLines = [
      ["source_crop_code", "count"].join(","),
      ...topCodes.slice(0, 500).map((r) => [r.key, r.count].map(csvEscape).join(",")),
    ];

    await fs.writeFile(topCodesCsvPath, topCodesLines.join("\n"), "utf-8");

    console.log("✅ 第 5 步完成");
    console.log(`未對上總筆數：${unmatchedRows.length}`);
    console.log(`未對上名稱種類數：${topNames.length}`);
    console.log(`未對上代碼種類數：${topCodes.length}`);
    console.log("");
    console.log("已產出：");
    console.log(summaryPath);
    console.log(topNamesCsvPath);
    console.log(topCodesCsvPath);
  } catch (err) {
    console.error("analyze-unmatched 執行失敗：", err);
  }
}

main();