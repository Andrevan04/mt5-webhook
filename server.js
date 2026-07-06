/**
 * Ledgerline MT5 Webhook Receiver
 * --------------------------------
 * Minimal Express server that receives closed-trade payloads pushed by
 * LedgerlineTradeSync.mq5, maps them into the Ledgerline trade schema,
 * and appends them to a JSON file acting as simple storage.
 *
 * Run locally:
 *   npm init -y
 *   npm install express
 *   node mt5-webhook-server.js
 *
 * Then expose it publicly (MT5's WebRequest needs a real HTTPS URL, not
 * localhost) via one of:
 *   - Deploy this as a tiny always-on server (Render, Railway, a VPS)
 *   - During local testing, tunnel it: `npx ngrok http 3000`
 *
 * Point the EA's WebhookURL input at:  https://<your-domain>/api/trades/mt5
 * Point the EA's WebhookSecret input at the same value as WEBHOOK_SECRET below.
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

// CORS: the journal app (running in the browser, on a different origin than
// this server) needs to be able to fetch /api/trades. Lock this down to your
// actual app's origin once you know it, instead of "*".
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "change-me";
const DB_FILE = path.join(__dirname, "trades.json");

function loadTrades() {
  if (!fs.existsSync(DB_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return []; }
}
function saveTrades(trades) {
  fs.writeFileSync(DB_FILE, JSON.stringify(trades, null, 2));
}

// Rough position-size -> price-per-point mapping so lots/contracts read
// sensibly across FX pairs, gold, and indices without needing full
// per-symbol contract specs. Good enough for journaling; not for accounting.
function guessDecimals(symbol) {
  if (/JPY/i.test(symbol)) return 2;
  if (/XAU|GOLD/i.test(symbol)) return 2;
  if (/^(NAS100|US30|SPX500|GER40|US100|SP500|GER30)/i.test(symbol)) return 1;
  return 4; // most FX majors
}

/**
 * Maps an incoming MT5 EA payload into a Ledgerline trade object.
 * See LedgerlineTradeSync.mq5 for the exact payload shape it sends.
 */
function sanitizeAccountLabel(label) {
  return String(label || "MT5").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "MT5";
}

function mapToLedgerline(payload) {
  const open = new Date(payload.openTime.replace(".", "-").replace(".", "-"));
  const close = new Date(payload.closeTime.replace(".", "-").replace(".", "-"));
  const durationMinutes = Math.max(0, Math.round((close - open) / 60000));
  // Namespaced by account label: two different MT5 accounts can each have a
  // ticket #12345 — without this, the second account's trade would look like
  // a duplicate of the first and get silently dropped.
  const accountTag = sanitizeAccountLabel(payload.account);

  return {
    id: "MT5-" + accountTag + "-" + payload.ticket,
    date: (isNaN(open.getTime()) ? new Date() : open).toISOString(),
    symbol: payload.symbol,
    market: /XAU|JPY|USD|EUR|GBP|CHF|CAD|AUD|NZD/i.test(payload.symbol) && payload.symbol.length <= 7 ? "Forex" : "Indices",
    side: payload.side, // "Long" | "Short", already resolved by the EA
    entry: Number(payload.entry),
    exit: Number(payload.exit),
    stopLoss: 0,   // MT5 deal history doesn't retain SL/TP after close — edit manually if needed
    takeProfit: 0,
    positionSize: Number(payload.volume),
    sizeLabel: "lots",
    riskAmount: 0, // unknown from MT5 alone; fill in per-trade or compute from your risk rules
    commission: Math.abs(Number(payload.commission) || 0),
    fees: Math.abs(Number(payload.swap) || 0),
    pnl: Number(payload.pnl),
    rMultiple: 0,  // needs riskAmount to compute — set once you fill that in
    strategy: "Unassigned",
    setup: "Unassigned",
    session: "New York",
    timeframe: "1H",
    durationMinutes,
    confidence: 3,
    quality: 3,
    tags: ["MT5 Import"],
    emotionBefore: "Calm",
    emotionAfter: "Calm",
    notes: payload.comment || "",
    lessons: "",
    mistakes: "",
    hasScreenshot: false,
    account: payload.account || "MT5",
  };
}

app.post("/api/trades/mt5", (req, res) => {
  const payload = req.body;

  if (!payload || payload.secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: "Invalid or missing secret" });
  }
  if (!payload.symbol || payload.entry === undefined || payload.exit === undefined) {
    return res.status(400).json({ error: "Missing required trade fields" });
  }

  const trade = mapToLedgerline(payload);
  const trades = loadTrades();

  // De-dupe: MT5 can occasionally re-fire the same deal transaction.
  const exists = trades.some((t) => t.id === trade.id);
  if (!exists) {
    trades.push(trade);
    saveTrades(trades);
    console.log(`Synced trade ${trade.id} — ${trade.symbol} ${trade.side} ${trade.pnl}`);
  }

  res.status(200).json({ ok: true, tradeId: trade.id, duplicate: exists });
});

// Fetch everything synced so far — pull this into Ledgerline via
// Journal > Import, or wire it into a real backend's sync job.
app.get("/api/trades", (req, res) => {
  res.json(loadTrades());
});

// TEMPORARY — remove this route once MT5 sync is confirmed working.
// Lets you check from a browser exactly what secret the server is actually
// using at runtime, instead of guessing whether Render's env var took effect.
app.get("/api/debug", (req, res) => {
  const secret = WEBHOOK_SECRET || "";
  res.json({
    secretIsSet: secret !== "" && secret !== "change-me",
    secretLength: secret.length,
    secretFirst3Chars: secret.slice(0, 3),
    secretLast3Chars: secret.slice(-3),
    usingDefault: secret === "change-me",
  });
});

app.get("/", (req, res) => {
  res.send("Ledgerline MT5 webhook receiver is running.");
});

app.listen(PORT, () => {
  console.log(`Ledgerline MT5 webhook listening on port ${PORT}`);
  console.log(`POST closed trades to: http://localhost:${PORT}/api/trades/mt5`);
});
