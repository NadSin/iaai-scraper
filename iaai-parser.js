import puppeteer from "puppeteer";
import { GoogleSpreadsheet } from "google-spreadsheet";
import 'dotenv/config';

const SHEET_ID = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(SHEET_ID);

const MODELS = [
  "Mazda CX‑30",
  "Kia Seltos",
  "Toyota C‑HR",
  "Kia Sportage",
  "Mazda CX‑5",
  "Nissan Rogue",
  "Hyundai Creta",
  "Toyota Venza",
];

// Причины повреждений, которые нужно исключить
const EXCLUDED_DAMAGE = [
  "hail",
  "rollover",
  "biohazard/chemical",
  "burn",
  "burn engine",
  "burn interior",
  "flood",
  "water",
  "drowning"
];

// Подходящие типы повреждений
const VALID_DAMAGE_LOCATIONS = [
  "front end",
  "rear end",
  "side",
];

function matchesDamage(damage) {
  const d = damage.toLowerCase();
  return (
    !EXCLUDED_DAMAGE.some(term => d.includes(term)) &&
    VALID_DAMAGE_LOCATIONS.some(term => d.includes(term))
  );
}

function isColorValid(text) {
  return !text.toLowerCase().includes("white");
}

function parseMileage(mileageText) {
  const mileage = mileageText.replace(/[^\d]/g, "");
  return parseInt(mileage, 10);
}

async function main() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  const allResults = [];

  for (const model of MODELS) {
    const searchUrl = `https://www.iaai.com/Search?Keyword=${encodeURIComponent(model)}`;
    console.log(`🔍 Поиск: ${model}`);
    
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    try {
      await page.waitForSelector(".search-lot-box", { timeout: 15000 });
    } catch (e) {
      console.warn(`⚠️ Нет результатов для ${model}`);
      continue;
    }

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".search-lot-box"));
      return items.map((el) => {
        const link = el.querySelector("a")?.href;
        const year = el.querySelector(".title-year")?.innerText;
        const model = el.querySelector(".title-make-model")?.innerText;
        const mileage = el.querySelector(".lot-mileage")?.innerText;
        const damage = el.querySelector(".lot-damage-type")?.innerText || "";
        const color = el.innerText.match(/Color:\s(.+)/i)?.[1] || "";
        const keys = el.innerText.includes("Keys: Yes") ? "Yes" : "No";
        const airbags = el.innerText.includes("Airbags: Intact") ? "Yes" : "No";
        return { year, model, mileage, damage, keys, airbags, link, color };
      });
    });

    const filtered = results.filter(item => {
      const yearOk = parseInt(item.year) >= 2021 && parseInt(item.year) <= 2023;
      const mileageOk = parseMileage(item.mileage) <= 80000;
      const keysOk = item.keys === "Yes";
      const airbagsOk = item.airbags === "Yes";
      const damageOk = item.damage && matchesDamage(item.damage);
      const colorOk = isColorValid(item.color || "");

      return yearOk && mileageOk && keysOk && airbagsOk && damageOk && colorOk;
    });

    allResults.push(...filtered);
  }

  await browser.close();

  // Google Sheets
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  await sheet.clear();
  await sheet.setHeaderRow([
    "Year",
    "Model",
    "Mileage",
    "Damage",
    "Keys",
    "Airbags",
    "Color",
    "Link",
  ]);

  for (const row of allResults) {
    await sheet.addRow(row);
  }

  console.log(`✅ Записано ${allResults.length} строк`);
}

main().catch(console.error);
