import express from "express";
import puppeteer from "puppeteer";
import { GoogleSpreadsheet } from "google-spreadsheet";
import 'dotenv/config';

const SHEET_ID = "1nxeatmU5hC-M_ZSqywbyareer0DOvnn2uz5FZzhVxUs";
const doc = new GoogleSpreadsheet(SHEET_ID);

const SEARCH_URL = "https://www.iaai.com/Search?url=DYW%2f9Bj2biHogN82zpUh5rlh2eolx5NM9M9PdD1aMOw%3d";

const INTERESTING_MODELS = [
  "Mazda CX‑30",
  "Kia Seltos",
  "Toyota C‑HR",
  "Kia Sportage",
  "Mazda CX‑5",
  "Nissan Rogue",
  "Hyundai Creta",
  "Hyundai ix25",
  "Toyota Venza",
  "Kia Forte"
];

function isInterestingModel(model) {
  return INTERESTING_MODELS.some(m =>
    model.replace(/\s+/g, '').toLowerCase().includes(m.replace(/\s+/g, '').toLowerCase())
  );
}

async function getExistingCarIDsWithRow(sheet) {
  await sheet.loadCells('A2:A');
  const ids = {};
  for (let row = 1; row < sheet.rowCount; row++) {
    const cell = sheet.getCell(row, 0);
    if (cell.value) ids[String(cell.value)] = row;
  }
  return ids;
}

async function parseCars() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();
  await page.goto(SEARCH_URL, { waitUntil: "networkidle2" });

  try {
    await page.waitForSelector(".search-lot-box", { timeout: 15000 });
  } catch (e) {
    await browser.close();
    throw new Error("Нет результатов на странице поиска");
  }

  const cars = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".search-lot-box")).map((el) => {
      const link = el.querySelector("a")?.href || "";
      const id = link.match(/\/VehicleDetails\/(\d+)/)?.[1] || "";
      const year = el.querySelector(".title-year")?.innerText || "";
      const model = el.querySelector(".title-make-model")?.innerText || "";
      const mileageText = el.querySelector(".lot-mileage")?.innerText || "";
      const mileage = parseInt(mileageText.replace(/[^\d]/g, ""), 10) || 0;
      const damage = el.querySelector(".lot-damage-type")?.innerText || "";
      const keys = el.innerText.includes("Keys: Yes") ? "Yes" : "No";
      const airbags = el.innerText.includes("Airbags: Intact") ? "Yes" : "No";
      const buyNow = el.innerText.includes("Buy Now") ? "Yes" : "No";
      const buyNowPrice = el.querySelector(".buy-now-price")?.innerText || "N/A";
      const auction = el.querySelector(".lot-auction")?.innerText || "";
      const bodyStyle = el.querySelector(".lot-body-style")?.innerText || "";
      const driveLineType = el.querySelector(".lot-drive-line-type")?.innerText || "";
      const fuelType = el.querySelector(".lot-fuel-type")?.innerText || "";
      const exteriorColor = el.querySelector(".lot-color")?.innerText || "";
      const interiorColor = el.querySelector(".lot-interior-color")?.innerText || "";

      return {
        id, year, model, mileage, damage, keys, airbags, buyNow, buyNowPrice, auction, link,
        bodyStyle, driveLineType, fuelType, exteriorColor, interiorColor
      };
    });
  });

  await browser.close();

  // Фильтрация по интересующим моделям
  const filtered = cars.filter(car => car.id && isInterestingModel(car.model));

  await doc.useServiceAccountAuth({
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });

  await doc.loadInfo();
  const sheet = doc.sheetsByIndex[0];
  const existingIDs = await getExistingCarIDsWithRow(sheet);

  let added = 0, updated = 0;
  for (const car of filtered) {
    if (existingIDs[car.id]) {
      // Обновляем существующую строку
      const rowIdx = existingIDs[car.id];
      const rows = await sheet.getRows({ offset: rowIdx - 1, limit: 1 });
      if (rows && rows[0]) {
        rows[0].Year = car.year;
        rows[0].Model = car.model;
        rows[0].Mileage = car.mileage;
        rows[0].Damage = car.damage;
        rows[0].Keys = car.keys;
        rows[0].Airbags = car.airbags;
        rows[0]["Buy Now"] = car.buyNow;
        rows[0]["Buy Now Price"] = car.buyNowPrice;
        rows[0].Auction = car.auction;
        rows[0].Link = car.link;
        rows[0]["Body Style"] = car.bodyStyle;
        rows[0]["Drive Line Type"] = car.driveLineType;
        rows[0]["Fuel Type"] = car.fuelType;
        rows[0]["Exterior Color"] = car.exteriorColor;
        rows[0]["Interior Color"] = car.interiorColor;
        await rows[0].save();
        updated++;
      }
    } else {
      // Добавляем новую строку
      await sheet.addRow({
        ID: car.id,
        Year: car.year,
        Model: car.model,
        Mileage: car.mileage,
        Damage: car.damage,
        Keys: car.keys,
        Airbags: car.airbags,
        "Buy Now": car.buyNow,
        "Buy Now Price": car.buyNowPrice,
        Auction: car.auction,
        Link: car.link,
        "Body Style": car.bodyStyle,
        "Drive Line Type": car.driveLineType,
        "Fuel Type": car.fuelType,
        "Exterior Color": car.exteriorColor,
        "Interior Color": car.interiorColor
      });
      added++;
    }
  }

  return { added, updated, total: filtered.length };
}

// Express сервер для Render
const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("Парсер IAAI работает! Для запуска парсинга перейдите на /parse");
});

app.get("/parse", async (req, res) => {
  try {
    const result = await parseCars();
    res.send(`✅ Добавлено ${result.added} новых строк, обновлено ${result.updated} из ${result.total} подходящих.`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Ошибка при парсинге: " + e.message);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
