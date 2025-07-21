import puppeteer from "puppeteer";
import { GoogleSpreadsheet } from "google-spreadsheet";
import 'dotenv/config';

const SHEET_ID = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(SHEET_ID);

// Модели, которые нужно искать
const CAR_MODELS = [
  "Mazda CX‑30",
  "Kia Seltos",
  "Toyota C‑HR",
  "Kia Sportage",
  "Mazda CX‑5",
  "Nissan Rogue",
  "Hyundai Creta",
  "Hyundai ix25",
  "Toyota Venza"
];

// Нежелательные типы повреждений
const EXCLUDED_DAMAGE_TYPES = [
  "hail",
  "rollover",
  "biohazard",
  "chemical",
  "burn",
  "flood",
  "water",
  "drowning"
];

// Проверка на допустимый цвет
function isWhiteColor(text) {
  return /white/i.test(text);
}

// Проверка типа повреждений (одна сторона)
function isOneSideDamage(desc) {
  return /(front|rear|side)/i.test(desc);
}

// Извлечение ID из URL
function extractCarId(link) {
  const match = link.match(/\/VehicleDetails\/(\d+)/);
  return match ? match[1] : null;
}

// Получить список уже добавленных ID
async function getExistingCarIDs(sheet) {
  await sheet.loadCells('A2:A');
  const ids = [];
  for (let row = 1; row < sheet.rowCount; row++) {
    const cell = sheet.getCell(row, 0);
    if (cell.value) ids.push(String(cell.value));
  }
  return ids;
}

async function main() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  const results = [];

  for (const model of CAR_MODELS) {
    const url = `https://www.iaai.com/Search?Keyword=${encodeURIComponent(model)}`;
    await page.goto(url, { waitUntil: "networkidle2" });

    try {
      await page.waitForSelector(".search-lot-box", { timeout: 15000 });
    } catch (e) {
      console.warn(`⚠️ No results found for ${model}`);
      continue;
    }

    const modelResults = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".search-lot-box")).map((el) => {
        const link = el.querySelector("a")?.href || "";
        const year = el.querySelector(".title-year")?.innerText || "";
        const model = el.querySelector(".title-make-model")?.innerText || "";
        const mileageText = el.querySelector(".lot-mileage")?.innerText || "";
        const damage = el.querySelector(".lot-damage-type")?.innerText || "";
        const color = el.querySelector(".lot-color")?.innerText || "";
        const keys = el.innerText.includes("Keys: Yes") ? "Yes" : "No";
        const airbags = el.innerText.includes("Airbags: Intact") ? "Yes" : "No";
        const price = el.querySelector(".buy-now-price")?.innerText || "N/A";

        const mileage = parseInt(mileageText.replace(/[^\d]/g, ""), 10) || 0;
        const id = link.match(/\/VehicleDetails\/(\d+)/)?.[1] || "";

        return { id, year, model, mileage, damage, color, keys, airbags, price, link };
      });
    });

    const filtered = modelResults.filter((item) => {
      return (
        item.id &&
        parseInt(item.year) >= 2021 &&
        parseInt(item.year) <= 2023 &&
        item.mileage >= 1 &&
        item.mileage <= 80000 &&
        item.keys === "Yes" &&
        item.airbags === "Yes" &&
        !EXCLUDED_DAMAGE_TYPES.some((d) => item.damage.toLowerCase().includes(d)) &&
        isOneSideDamage(item.damage) &&
        !isWhiteColor(item.color)
      );
    });

    results.push(...filtered);
  }

  await browser.close();

  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];

  const existingIDs = await getExistingCarIDs(sheet);

  const newRows = results.filter((car) => !existingIDs.includes(car.id));

  for (const row of newRows) {
    await sheet.addRow({
      ID: row.id,
      Year: row.year,
      Model: row.model,
      Mileage: row.mileage,
      Damage: row.damage,
      Keys: row.keys,
      Airbags: row.airbags,
      Link: row.link,
      "Buy Now Price": row.price,
    });
  }

  console.log(`✅ Добавлено ${newRows.length} новых строк из ${results.length} подходящих.`);
}

main().catch(console.error);
