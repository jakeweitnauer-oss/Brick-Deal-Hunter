/**
 * Firebase Cloud Functions for Brick Deal Hunter
 *
 * These functions run on Firebase servers and:
 * 1. Fetch LEGO sets from Rebrickable API (reliable, free)
 * 2. Store price data in Firestore
 * 3. Calculate deals and discounts
 */

import { setGlobalOptions } from "firebase-functions";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// Limit concurrent executions for cost control
setGlobalOptions({ maxInstances: 10 });

// ============================================
// TYPES
// ============================================

interface LegoSet {
  setNumber: string;
  name: string;
  price: number;
  imageUrl: string;
  url: string;
  theme?: string;
  themeId?: number;
  pieces?: number;
  year?: number;
  availability: "available" | "coming_soon" | "sold_out" | "retiring_soon";
}

interface PriceData {
  setNumber: string;
  setName: string;
  retailer: string;
  currentPrice: number;
  originalPrice: number;
  url: string;
  inStock: boolean;
  lastUpdated: admin.firestore.Timestamp;
  theme?: string;
  imageUrl?: string;
  pieces?: number;
}

interface DealData extends PriceData {
  percentOff: number;
  savings: number;
}

// ============================================
// REBRICKABLE API - Primary Source
// ============================================

// Get API key from Firebase Functions config or environment variable
// Set with: firebase functions:config:set rebrickable.api_key="your_key"
// Or set REBRICKABLE_API_KEY environment variable in .env.local
const REBRICKABLE_API_KEY = process.env.REBRICKABLE_API_KEY || "";

// Theme ID to name mapping for Rebrickable
const THEME_NAMES: Record<number, string> = {
  158: "Star Wars",
  1: "Technic",
  252: "Ideas",
  435: "Architecture",
  52: "City",
  577: "Marvel Super Heroes",
  494: "Friends",
  246: "Creator",
  576: "DC Super Heroes",
  504: "Harry Potter",
  592: "Ninjago",
  610: "Speed Champions",
  209: "Disney",
  720: "Icons",
  667: "Botanical Collection",
  608: "Super Mario",
  573: "Minecraft",
  697: "Art",
  503: "Duplo",
};

/**
 * Fetch sets from Rebrickable API - this is the most reliable method
 */
async function fetchFromRebrickable(): Promise<LegoSet[]> {
  logger.info("Fetching sets from Rebrickable API...");

  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 3; // Last 3 years of sets

  const sets: LegoSet[] = [];
  let page = 1;
  const maxPages = 10; // Get up to 1000 sets

  while (page <= maxPages) {
    try {
      logger.info(`Fetching Rebrickable page ${page}...`);

      const response = await fetch(
        `https://rebrickable.com/api/v3/lego/sets/?min_year=${minYear}&max_year=${currentYear + 1}&page=${page}&page_size=100&ordering=-year`,
        {
          headers: {
            "Authorization": `key ${REBRICKABLE_API_KEY}`,
            "Accept": "application/json",
          },
        }
      );

      if (!response.ok) {
        logger.error(`Rebrickable API error: ${response.status}`);
        break;
      }

      const data = await response.json();
      const results = data.results || [];

      if (results.length === 0) {
        logger.info("No more results from Rebrickable");
        break;
      }

      for (const set of results) {
        // Skip sets without images or very small sets
        if (!set.set_img_url || set.num_parts < 20) continue;

        // Skip gear, books, minifigures (usually have -1 pattern but very few parts)
        if (set.num_parts < 50 && set.name.toLowerCase().includes("minifig")) continue;

        // Calculate estimated price (LEGO averages ~$0.11 per piece)
        const estimatedPrice = Math.round(set.num_parts * 0.11);

        sets.push({
          setNumber: set.set_num,
          name: set.name,
          price: estimatedPrice > 0 ? estimatedPrice : 20, // Minimum $20
          imageUrl: set.set_img_url,
          url: `https://www.lego.com/en-us/product/${set.set_num.replace("-1", "")}`,
          theme: THEME_NAMES[set.theme_id] || "LEGO",
          themeId: set.theme_id,
          pieces: set.num_parts,
          year: set.year,
          availability: "available",
        });
      }

      logger.info(`Page ${page}: fetched ${results.length} sets, total so far: ${sets.length}`);

      if (!data.next) {
        logger.info("Reached last page of Rebrickable results");
        break;
      }

      page++;

      // Small delay to be nice to the API
      await new Promise(resolve => setTimeout(resolve, 300));

    } catch (error) {
      logger.error(`Rebrickable page ${page} failed:`, error);
      break;
    }
  }

  logger.info(`Total sets fetched from Rebrickable: ${sets.length}`);
  return sets;
}

/**
 * Fetch theme information from Rebrickable
 */
async function fetchThemes(): Promise<void> {
  try {
    const response = await fetch(
      "https://rebrickable.com/api/v3/lego/themes/?page_size=500",
      {
        headers: {
          "Authorization": `key ${REBRICKABLE_API_KEY}`,
          "Accept": "application/json",
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      logger.info(`Fetched ${data.results?.length || 0} themes from Rebrickable`);
    }
  } catch (error) {
    logger.warn("Could not fetch themes:", error);
  }
}

// ============================================
// FIRESTORE OPERATIONS
// ============================================

async function saveLegoSetsCatalog(sets: LegoSet[]): Promise<void> {
  const batchSize = 450;

  for (let i = 0; i < sets.length; i += batchSize) {
    const batch = db.batch();
    const chunk = sets.slice(i, i + batchSize);

    for (const set of chunk) {
      const docRef = db.collection("lego_catalog").doc(set.setNumber);
      batch.set(docRef, {
        ...set,
        lastUpdated: admin.firestore.Timestamp.now(),
      }, { merge: true });
    }

    await batch.commit();
    logger.info(`Saved batch ${Math.floor(i / batchSize) + 1} (${chunk.length} sets)`);
  }

  logger.info(`Saved ${sets.length} sets to catalog`);
}

async function getLegoSetsCatalog(): Promise<LegoSet[]> {
  const snapshot = await db.collection("lego_catalog")
    .where("availability", "in", ["available", "retiring_soon"])
    .limit(500)
    .get();

  return snapshot.docs.map((doc) => doc.data() as LegoSet);
}

// ============================================
// PRICE DATA FUNCTIONS
// ============================================

function getRetailerUrl(retailer: string, setNumber: string): string {
  const cleanSetNum = setNumber.replace("-1", "");

  switch (retailer) {
    case "lego":
      return `https://www.lego.com/en-us/product/${cleanSetNum}`;
    case "amazon":
      return `https://www.amazon.com/s?k=LEGO+${cleanSetNum}`;
    case "walmart":
      return `https://www.walmart.com/search?q=LEGO+${cleanSetNum}`;
    case "target":
      return `https://www.target.com/s?searchTerm=LEGO+${cleanSetNum}`;
    case "best_buy":
      return `https://www.bestbuy.com/site/searchpage.jsp?st=LEGO+${cleanSetNum}`;
    case "kohls":
      return `https://www.kohls.com/search.jsp?search=LEGO+${cleanSetNum}`;
    case "meijer":
      return `https://www.meijer.com/search.html?searchTerm=LEGO+${cleanSetNum}`;
    case "fred_meyer":
      return `https://www.fredmeyer.com/search?query=LEGO+${cleanSetNum}`;
    case "gamestop":
      return `https://www.gamestop.com/search/?q=LEGO+${cleanSetNum}`;
    case "entertainment_earth":
      return `https://www.entertainmentearth.com/s/?query1=LEGO+${cleanSetNum}`;
    case "shop_disney":
      return `https://www.shopdisney.com/search?q=LEGO+${cleanSetNum}`;
    case "toys_r_us":
      return `https://www.toysrus.com/search?q=LEGO+${cleanSetNum}`;
    case "barnes_noble":
      return `https://www.barnesandnoble.com/s/LEGO+${cleanSetNum}`;
    case "sams_club":
      return `https://www.samsclub.com/s/LEGO+${cleanSetNum}`;
    case "costco":
      return `https://www.costco.com/CatalogSearch?dept=All&keyword=LEGO+${cleanSetNum}`;
    case "walgreens":
      return `https://www.walgreens.com/search/results.jsp?Ntt=LEGO+${cleanSetNum}`;
    default:
      return "";
  }
}

function generateSimulatedPrice(set: LegoSet, retailer: string): PriceData {
  const originalPrice = set.price;

  // LEGO.com is always MSRP, other retailers have random discounts
  let discountPercent = 0;
  if (retailer !== "lego") {
    // 70% chance of some discount (10-40%)
    if (Math.random() < 0.7) {
      discountPercent = Math.floor(Math.random() * 31) + 10;
    }

    // 10% chance of big discount (40-60%)
    if (Math.random() < 0.1) {
      discountPercent = Math.floor(Math.random() * 21) + 40;
    }
  }

  const currentPrice = Math.round(originalPrice * (1 - discountPercent / 100) * 100) / 100;
  const inStock = set.availability === "available" && Math.random() > 0.15;

  return {
    setNumber: set.setNumber,
    setName: set.name,
    retailer,
    currentPrice,
    originalPrice,
    url: getRetailerUrl(retailer, set.setNumber),
    inStock,
    lastUpdated: admin.firestore.Timestamp.now(),
    imageUrl: set.imageUrl,
    theme: set.theme,
    pieces: set.pieces,
  };
}

async function savePriceToFirestore(price: PriceData): Promise<void> {
  const docId = `${price.setNumber}_${price.retailer}`;
  await db.collection("prices").doc(docId).set(price, { merge: true });
}

async function saveDealToFirestore(deal: DealData): Promise<void> {
  const docId = `${deal.setNumber}_${deal.retailer}`;
  await db.collection("deals").doc(docId).set(deal, { merge: true });
}

async function cleanOldDeals(): Promise<void> {
  const cutoff = admin.firestore.Timestamp.fromDate(
    new Date(Date.now() - 24 * 60 * 60 * 1000)
  );

  const oldDeals = await db
    .collection("deals")
    .where("lastUpdated", "<", cutoff)
    .get();

  if (oldDeals.empty) {
    logger.info("No old deals to clean");
    return;
  }

  const batchSize = 450;
  for (let i = 0; i < oldDeals.docs.length; i += batchSize) {
    const batch = db.batch();
    const chunk = oldDeals.docs.slice(i, i + batchSize);
    chunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  logger.info(`Cleaned ${oldDeals.size} old deals`);
}

// ============================================
// SCHEDULED FUNCTIONS
// ============================================

export const updateLegoCatalog = onSchedule(
  {
    schedule: "every 24 hours",
    timeZone: "America/New_York",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    logger.info("Starting LEGO catalog update...");

    try {
      await fetchThemes();
      const sets = await fetchFromRebrickable();
      await saveLegoSetsCatalog(sets);
      logger.info(`Catalog update complete. ${sets.length} sets saved.`);
    } catch (error) {
      logger.error("Catalog update failed:", error);
      throw error;
    }
  }
);

export const updatePrices = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "America/New_York",
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async () => {
    logger.info("Starting price update...");

    try {
      let sets = await getLegoSetsCatalog();
      logger.info(`Found ${sets.length} sets in catalog`);

      if (sets.length === 0) {
        logger.info("Catalog empty, fetching from Rebrickable...");
        sets = await fetchFromRebrickable();
        await saveLegoSetsCatalog(sets);
      }

      const retailers = [
        "lego", "amazon", "walmart", "target", "best_buy",
        "kohls", "meijer", "fred_meyer", "gamestop",
        "entertainment_earth", "shop_disney", "toys_r_us",
        "barnes_noble", "sams_club", "costco", "walgreens"
      ];

      let dealsFound = 0;

      for (const set of sets.slice(0, 100)) {
        for (const retailer of retailers) {
          const priceData = generateSimulatedPrice(set, retailer);
          await savePriceToFirestore(priceData);

          const percentOff = Math.round(
            ((priceData.originalPrice - priceData.currentPrice) /
              priceData.originalPrice) * 100
          );

          if (percentOff >= 10 && priceData.inStock) {
            const deal: DealData = {
              ...priceData,
              percentOff,
              savings: Math.round((priceData.originalPrice - priceData.currentPrice) * 100) / 100,
            };
            await saveDealToFirestore(deal);
            dealsFound++;
          }

          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      await cleanOldDeals();
      logger.info(`Price update complete. Found ${dealsFound} deals.`);
    } catch (error) {
      logger.error("Price update failed:", error);
      throw error;
    }
  }
);

// ============================================
// HTTP ENDPOINTS
// ============================================

export const manualCatalogUpdate = onRequest(
  { memory: "512MiB", timeoutSeconds: 540 },
  async (req, res) => {
    logger.info("Manual catalog update triggered");

    try {
      const sets = await fetchFromRebrickable();

      if (sets.length === 0) {
        res.status(500).json({
          success: false,
          error: "No sets fetched from Rebrickable API",
        });
        return;
      }

      await saveLegoSetsCatalog(sets);

      // Count themes
      const themeCount: Record<string, number> = {};
      for (const set of sets) {
        const theme = set.theme || "Other";
        themeCount[theme] = (themeCount[theme] || 0) + 1;
      }

      const topThemes = Object.entries(themeCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);

      res.json({
        success: true,
        message: `Catalog updated with ${sets.length} sets from Rebrickable`,
        totalSets: sets.length,
        topThemes: topThemes.map(([name, count]) => ({ name, count })),
        sampleSets: sets.slice(0, 10).map(s => ({
          setNumber: s.setNumber,
          name: s.name,
          price: s.price,
          theme: s.theme,
          pieces: s.pieces,
          year: s.year,
          imageUrl: s.imageUrl,
        })),
      });
    } catch (error) {
      logger.error("Manual catalog update failed:", error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }
);

export const manualPriceUpdate = onRequest(
  { memory: "512MiB", timeoutSeconds: 300 },
  async (req, res) => {
    logger.info("Manual price update triggered");

    try {
      let sets = await getLegoSetsCatalog();

      if (sets.length === 0) {
        logger.info("Catalog empty, fetching from Rebrickable...");
        const fetchedSets = await fetchFromRebrickable();
        await saveLegoSetsCatalog(fetchedSets);
        sets = fetchedSets;
      }

      logger.info(`Processing ${sets.length} sets`);

      const retailers = [
        "lego", "amazon", "walmart", "target", "best_buy",
        "kohls", "meijer", "fred_meyer", "gamestop",
        "entertainment_earth", "shop_disney", "toys_r_us",
        "barnes_noble", "sams_club", "costco", "walgreens"
      ];
      let dealsFound = 0;
      const sampleDeals: DealData[] = [];

      for (const set of sets.slice(0, 50)) {
        for (const retailer of retailers) {
          const priceData = generateSimulatedPrice(set, retailer);
          await savePriceToFirestore(priceData);

          const percentOff = Math.round(
            ((priceData.originalPrice - priceData.currentPrice) /
              priceData.originalPrice) * 100
          );

          if (percentOff >= 10 && priceData.inStock) {
            const deal: DealData = {
              ...priceData,
              percentOff,
              savings: Math.round((priceData.originalPrice - priceData.currentPrice) * 100) / 100,
            };
            await saveDealToFirestore(deal);
            dealsFound++;

            // Keep some sample deals for the response
            if (sampleDeals.length < 5) {
              sampleDeals.push(deal);
            }
          }
        }
      }

      await cleanOldDeals();

      res.json({
        success: true,
        message: `Updated prices for ${Math.min(sets.length, 50)} sets. Found ${dealsFound} deals.`,
        catalogSize: sets.length,
        dealsFound,
        sampleDeals: sampleDeals.map(d => ({
          setNumber: d.setNumber,
          setName: d.setName,
          retailer: d.retailer,
          originalPrice: d.originalPrice,
          currentPrice: d.currentPrice,
          percentOff: d.percentOff,
          savings: d.savings,
        })),
      });
    } catch (error) {
      logger.error("Manual update failed:", error);
      res.status(500).json({ success: false, error: String(error) });
    }
  }
);

export const healthCheck = onRequest(async (req, res) => {
  try {
    const catalogSnapshot = await db.collection("lego_catalog").count().get();
    const catalogSize = catalogSnapshot.data().count;

    const dealsSnapshot = await db.collection("deals").count().get();
    const dealsCount = dealsSnapshot.data().count;

    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "5.0.0",
      catalog: {
        size: catalogSize,
        source: "Rebrickable API"
      },
      deals: {
        count: dealsCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: "error",
      error: String(error),
    });
  }
});
