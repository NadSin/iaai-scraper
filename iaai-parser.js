<details> <summary>
import puppeteer from "puppeteer";
import { GoogleSpreadsheet } from "google-spreadsheet";
import 'dotenv/config';

const SHEET_ID = process.env.SHEET_ID;
const doc = new GoogleSpreadsheet(SHEET_ID);

async function main() {
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  await page.goto("https://www.iaai.com/Search?Keyword=mazda%20cx-30", {
    waitUntil: "networkidle2",
  });

  await page.waitForSelector(".search-lot-box", { timeout: 15000 });

  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".search-lot-box"));
    return items.map((el) => {
      const link = el.querySelector("a")?.href;
      const year = el.querySelector(".title-year")?.innerText;
      const model = el.querySelector(".title-make-model")?.innerText;
      const mileage = el.querySelector(".lot-mileage")?.innerText;
      const damage = el.querySelector(".lot-damage-type")?.innerText;
      const keys = el.innerText.includes("Keys: Yes") ? "Yes" : "No";
      const airbags = el.innerText.includes("Airbags: Intact") ? "Yes" : "No";
      return { year, model, mileage, damage, keys, airbags, link };
    });
  });

  await browser.close();

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
    "Link",
  ]);

  for (const row of results) {
    await sheet.addRow(row);
  }

  console.log(`✅ Записано ${results.length} строк`);
}

main().catch(console.error);
</summary>
</details>