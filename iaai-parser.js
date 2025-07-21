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

const EXCLUDED_DAMAGE = [
  "hail", "rollover", "biohazard", "burn", "flood", "drowning", "fire", "water"
];

const VALID_DAMAGE_LOCATIONS = ["front end", "rear end", "side"];

function matchesDamage(damage) {
  const d = damage.toLowerCase();
  return (
    !EXCLUDED_DAMAGE.some(term => d.includes(term)) &&
    VALID_DAMAGE_LOCATIONS.some(term => d.includes(term))
  );
}

function isColorValid(color = "") {
  return !color.toLowerCase().includes("white");
}

function parseMileage(text) {
  const n = text.replace(/[^\d]/g, "");
  return parseInt(n || "0", 10);
}

async function main() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const allResults = [];

  // Авторизация в Google Sheets
  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  await sheet.loadCells(); // для чтения уже добавленных строк

  const existingLinks = new Set();
  const rows = await sheet.getRows();
  rows.forEach(row => {
    if (row.Link) existingLinks.add(row.Link.trim());
  });

  for (const model of MODELS) {
    const searchUrl = `https://www.iaai.com/Search?Keyword=${encodeURIComponent(model)}`;
    console.log(`🔍 Модель: ${model}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    try {
      await page.waitForSelector(".search-lot-box", { timeout: 10000 });
    } catch {
      console.warn(`⚠️ Нет результатов по ${model}`);
      continue;
    }

    const results = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".search-lot-box")).map(el => {
        const link = el.querySelector("a")?.href;
        const year = el.querySelector(".title-year")?.innerText || "";
        const model = el.querySelector(".title-make-model")?.innerText || "";
        const mileage = el.querySelector(".lot-mileage")?.innerText || "";
        const damage = el.querySelector(".lot-damage-type")?.innerText || "";
        const color = el.innerText.match(/Color:\s(.+)/i)?.[1] || "";
        const keys = el.innerText.includes("Keys: Yes") ? "Yes" : "No";
        const airbags = el.innerText.includes("Airbags: Intact") ? "Yes" : "No";
        const buyNow = el.querySelector(".buy-now-price")?.innerText || "";
        return {
          year,
          model,
          mileage,
          damage,
          keys,
          airbags,
          color,
          buyNow,
          link,
        };
      });
    });

    const filtered = results.filter(item => {
      if (!item.link || existingLinks.has(item.link)) return false;

      const yearOk = parseInt(item.year) >= 2021 && parseInt(item.year) <= 2023;
      const mileageOk = parseMileage(item.mileage) <= 80000;
      const keysOk = item.keys === "Yes";
      const airbagsOk = item.airbags === "Yes";
      const damageOk = matchesDamage(item.damage);
      const colorOk = isColorValid(item.color);

      return yearOk && mileageOk && keysOk && airbagsOk && damageOk && colorOk;
    });

    for (const row of filtered) {
      allResults.push({
        Year: row.year,
        Model: row.model,
        Mileage: row.mileage,
        Damage: row.damage,
        Keys: row.keys,
        Airbags: row.airbags,
        Color: row.color,
        BuyNow: row.buyNow,
        Auction: "IAAI",
        Link: row.link,
      });
    }
  }

  await browser.close();

  if (allResults.length === 0) {
    console.log("🟡 Новых машин не найдено.");
    return;
  }

  // Добавим новые строки в таблицу
  for (const item of allResults) {
    await sheet.addRow(item);
  }

  console.log(`✅ Добавлено новых машин: ${allResults.length}`);
}

main().catch(console.error);
