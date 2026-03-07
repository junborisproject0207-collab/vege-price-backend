import fs from "fs/promises";
import path from "path";

const MASTER_URL =
  "https://data.moa.gov.tw/Service/OpenData/TransService.aspx?UnitId=LC7YWlenhLuP";

const MAPPING_URL =
  "https://data.moa.gov.tw/Service/OpenData/TransService.aspx?UnitId=xVOXUErUYXJK";

const rootDir = path.resolve(process.cwd());
const dataDir = path.join(rootDir, "data");

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function fetchJson(url, name) {
  console.log(`開始抓取 ${name}...`);
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`${name} 抓取失敗：HTTP ${res.status}`);
  }

  const json = await res.json();
  console.log(`${name} 抓取成功，筆數：${Array.isArray(json) ? json.length : "非陣列"}`);
  return json;
}

async function main() {
  try {
    await ensureDir(dataDir);

    const masterData = await fetchJson(MASTER_URL, "統一主檔 API");
    const mappingData = await fetchJson(MAPPING_URL, "代碼對應 API");

    const masterPath = path.join(dataDir, "raw-master.json");
    const mappingPath = path.join(dataDir, "raw-mapping.json");

    await fs.writeFile(masterPath, JSON.stringify(masterData, null, 2), "utf-8");
    await fs.writeFile(mappingPath, JSON.stringify(mappingData, null, 2), "utf-8");

    console.log("已儲存完成：");
    console.log(masterPath);
    console.log(mappingPath);
  } catch (err) {
    console.error("執行失敗：", err);
  }
}

main();