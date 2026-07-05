# Connecting MT5 to Ledgerline — Setup Guide

This gets your MT5 closed trades flowing automatically into a journal, the same
approach TradeZella-style tools use under the hood: an Expert Advisor (EA)
inside MT5 pushes each closed trade to a webhook the moment it closes.

## What you're setting up

```
MT5 Terminal  --(WebRequest POST on trade close)-->  Your webhook server  -->  trades.json / database
     |                                                        |
LedgerlineTradeSync.mq5                              mt5-webhook-server.js
```

MT5 has no public API of its own — this EA + webhook pattern (or a hosted
bridge like MetaApi.cloud) is how real integrations work.

## 1. Deploy the webhook server

The server needs a real public HTTPS URL — MT5's `WebRequest` will not call
`localhost`.

**Quickest path (testing):**
```bash
npm init -y
npm install express
node mt5-webhook-server.js
npx ngrok http 3000        # in a second terminal — gives you a public https:// URL
```

**For anything you'll rely on day to day**, deploy it properly instead of
leaving ngrok running: Render, Railway, Fly.io, or a small VPS all work fine
for a service this light. Set the `WEBHOOK_SECRET` environment variable to a
random string you control.

## 2. Whitelist the URL inside MT5

MT5 blocks all outbound web requests by default.

1. Open MT5 → **Tools → Options → Expert Advisors**
2. Check **"Allow WebRequest for listed URL"**
3. Add your webhook's exact URL, e.g. `https://your-domain.com`
4. Click OK

If you skip this step, the EA will print `Ledgerline sync FAILED. Error 4060`
(or similar) to the Experts log instead of syncing.

## 3. Install and configure the EA

1. Copy `LedgerlineTradeSync.mq5` into your MT5 data folder's
   `MQL5/Experts/` directory (**File → Open Data Folder** from MT5 to find it)
2. In MetaEditor, open the file and click **Compile**
3. Back in MT5, drag the compiled EA onto any one chart (it syncs your whole
   account, not just that symbol)
4. In the EA's input tab, set:
   - `WebhookURL` → `https://your-domain.com/api/trades/mt5`
   - `WebhookSecret` → the same value as `WEBHOOK_SECRET` on your server
   - `AccountLabel` → whatever you want shown as the account name
5. Make sure **Algo Trading** is enabled (top toolbar) and the EA shows a
   smiley face icon in the chart's top-right corner

From here, every time a position closes on this account, the EA fires a POST
request with the trade details.

## 4. What gets synced automatically vs. what you fill in yourself

MT5's deal history doesn't retain stop-loss/take-profit or your intended risk
amount once a trade is closed, so those come through as blank:

| Field | Synced from MT5? |
|---|---|
| Symbol, side, entry, exit, volume, P&L, commission, swap, open/close time | ✅ Automatic |
| Stop loss, take profit | ❌ Not available post-close — add manually if you want it recorded |
| Risk amount, R-multiple | ❌ Depends on your risk sizing — fill in once per trade to unlock R-based analytics |
| Strategy, setup, session, timeframe, confidence, quality, emotions, notes, screenshots | ❌ This is the actual journaling — MT5 has no concept of any of it |

The sync gets your trade *data* in for free. The reflection — which is the
point of a journal — still has to come from you after each session.

## 5. Getting synced trades into the actual Ledgerline app

`GET /api/trades` on your webhook server returns everything synced so far as
JSON. Two ways to use that:

- **Manual**: periodically fetch it and paste/import into Ledgerline's
  Journal tab (an "Import JSON" button can be added there — say the word)
- **Automatic**: if/when Ledgerline becomes a real backend-connected website
  (see the earlier conversation about that), its server polls this same
  endpoint on a schedule and inserts new trades directly — no manual step

## Notes on scope

- This syncs **your own MT5 account only** — it's not a multi-user product
- The webhook secret is your only auth; keep the URL and secret private
- If you trade on multiple MT5 accounts, run one EA instance per account,
  each with a distinct `AccountLabel`
