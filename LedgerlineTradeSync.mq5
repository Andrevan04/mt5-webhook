//+------------------------------------------------------------------+
//|                                       LedgerlineTradeSync.mq5     |
//|  Pushes every closed trade from this MT5 account to your         |
//|  Ledgerline journal webhook, in real time, as it happens.        |
//|                                                                    |
//|  SETUP (do this before attaching the EA):                        |
//|  1. Tools > Options > Expert Advisors > check "Allow WebRequest  |
//|     for listed URL" and add your webhook's domain to the list.   |
//|     (MT5 will silently reject requests to un-whitelisted URLs.)  |
//|  2. Set WebhookURL and WebhookSecret below to match your server. |
//|  3. Attach this EA to any one chart (it syncs the whole account, |
//|     not just that symbol) and leave "Algo Trading" enabled.      |
//+------------------------------------------------------------------+
#property copyright "Ledgerline"
#property version   "1.00"
#property strict

input string WebhookURL    = "https://your-server.com/api/trades/mt5"; // Your webhook endpoint
input string WebhookSecret = "change-me";                              // Shared secret, must match server
input string AccountLabel  = "MT5 Live";                               // Label shown in Ledgerline

//+------------------------------------------------------------------+
int OnInit()
  {
   Print("Ledgerline Trade Sync EA initialized. Sending closed trades to: ", WebhookURL);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Fires on every deal/order/position change on this account        |
//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction &trans,
                         const MqlTradeRequest &request,
                         const MqlTradeResult &result)
  {
   if(trans.type != TRADE_TRANSACTION_DEAL_ADD)
      return;

   ulong dealTicket = trans.deal;
   if(!HistoryDealSelect(dealTicket))
      return;

   // Only fire when a position is being CLOSED (fully or partially),
   // not when it's being opened.
   long entryType = HistoryDealGetInteger(dealTicket, DEAL_ENTRY);
   if(entryType != DEAL_ENTRY_OUT && entryType != DEAL_ENTRY_OUT_BY)
      return;

   SendClosedDeal(dealTicket);
  }

//+------------------------------------------------------------------+
//| Build the trade payload and POST it                              |
//+------------------------------------------------------------------+
void SendClosedDeal(ulong dealTicket)
  {
   string   symbol     = HistoryDealGetString(dealTicket, DEAL_SYMBOL);
   long     dealType   = HistoryDealGetInteger(dealTicket, DEAL_TYPE); // closing deal type
   double   volume     = HistoryDealGetDouble(dealTicket, DEAL_VOLUME);
   double   priceClose = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
   double   profit     = HistoryDealGetDouble(dealTicket, DEAL_PROFIT);
   double   commission = HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);
   double   swap       = HistoryDealGetDouble(dealTicket, DEAL_SWAP);
   datetime closeTime  = (datetime)HistoryDealGetInteger(dealTicket, DEAL_TIME);
   long     positionId = HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
   string   comment    = HistoryDealGetString(dealTicket, DEAL_COMMENT);
   int      digits     = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

   // A SELL deal closes a Long position; a BUY deal closes a Short position.
   string side = (dealType == DEAL_TYPE_SELL) ? "Long" : "Short";

   double priceOpen = 0;
   datetime openTime = closeTime;
   FindOpeningDeal(positionId, priceOpen, openTime);

   string json = "{";
   json += "\"secret\":\""      + WebhookSecret + "\",";
   json += "\"account\":\""     + AccountLabel + "\",";
   json += "\"ticket\":"        + IntegerToString(positionId) + ",";
   json += "\"symbol\":\""      + symbol + "\",";
   json += "\"side\":\""        + side + "\",";
   json += "\"volume\":"        + DoubleToString(volume, 2) + ",";
   json += "\"entry\":"         + DoubleToString(priceOpen, digits) + ",";
   json += "\"exit\":"          + DoubleToString(priceClose, digits) + ",";
   json += "\"pnl\":"           + DoubleToString(profit, 2) + ",";
   json += "\"commission\":"    + DoubleToString(MathAbs(commission), 2) + ",";
   json += "\"swap\":"          + DoubleToString(swap, 2) + ",";
   json += "\"openTime\":\""    + TimeToString(openTime, TIME_DATE | TIME_SECONDS) + "\",";
   json += "\"closeTime\":\""   + TimeToString(closeTime, TIME_DATE | TIME_SECONDS) + "\",";
   json += "\"comment\":\""     + comment + "\"";
   json += "}";

   PostJSON(json);
  }

//+------------------------------------------------------------------+
//| Walk this position's deal history to find its opening price/time |
//+------------------------------------------------------------------+
void FindOpeningDeal(long positionId, double &priceOpen, datetime &openTime)
  {
   HistorySelectByPosition(positionId);
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong ticket = HistoryDealGetTicket(i);
      if(HistoryDealGetInteger(ticket, DEAL_ENTRY) == DEAL_ENTRY_IN)
        {
         priceOpen = HistoryDealGetDouble(ticket, DEAL_PRICE);
         openTime  = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
         return;
        }
     }
  }

//+------------------------------------------------------------------+
//| Send the JSON payload to the webhook                             |
//+------------------------------------------------------------------+
void PostJSON(string json)
  {
   char   post[];
   char   result[];
   string headers = "Content-Type: application/json\r\n";
   string resultHeaders;

   StringToCharArray(json, post, 0, StringLen(json));

   ResetLastError();
   // Timeout is generous (55s) because free-tier hosting (e.g. Render's free
   // plan) spins the server down after inactivity and can take 30-50s to
   // wake back up on the next request. A short timeout here would silently
   // drop trades that arrive while the server is asleep.
   int status = WebRequest("POST", WebhookURL, headers, 55000, post, result, resultHeaders);

   if(status == -1)
     {
      int err = GetLastError();
      Print("Ledgerline sync FAILED. Error ", err,
            ". Check Tools > Options > Expert Advisors > Allow WebRequest for: ", WebhookURL);
     }
   else
     {
      Print("Ledgerline sync OK (HTTP ", status, ") — ticket #", json);
     }
  }
//+------------------------------------------------------------------+
