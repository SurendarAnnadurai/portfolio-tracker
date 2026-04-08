export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'No symbol provided' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=10d`,
  ];

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com',
        }
      });
      if (!r.ok) continue;
      const data = await r.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const meta       = result.meta;
      const closes     = result.indicators?.quote?.[0]?.close  || [];
      const timestamps = result.timestamp || [];

      // Current live price — always regularMarketPrice
      const currentPrice = meta.regularMarketPrice;
      if (!currentPrice) continue;

      // Build list of valid (date, close) pairs, sorted by date ascending
      const bars = timestamps
        .map((ts, i) => ({ ts, close: closes[i] }))
        .filter(b => b.close !== null && b.close !== undefined && b.ts);
      bars.sort((a, b) => a.ts - b.ts);

      let prevClose;

      // Strategy: use meta.regularMarketPreviousClose if available — 
      // Yahoo sets this explicitly to the previous trading day official close.
      // This is the most reliable field across all market states and timezones.
      if (meta.regularMarketPreviousClose && meta.regularMarketPreviousClose > 0) {
        prevClose = meta.regularMarketPreviousClose;
      } else if (meta.chartPreviousClose && meta.chartPreviousClose > 0) {
        prevClose = meta.chartPreviousClose;
      } else if (bars.length >= 2) {
        // Fallback: determine today's bar by comparing with current date in exchange timezone
        const nowUtc = Date.now() / 1000;
        const marketState = meta.marketState;

        if (marketState === 'REGULAR') {
          // Market open: last complete bar = yesterday. Second to last = day before.
          // regularMarketPrice is live. prevClose = last bar's close = yesterday.
          prevClose = bars[bars.length - 1].close;
        } else {
          // Market closed/pre/post: last bar may include today's close.
          // Check if last bar timestamp is today (within 24h)
          const lastBarAge = nowUtc - bars[bars.length - 1].ts;
          if (lastBarAge < 86400) {
            // Last bar is today — use second to last as prevClose
            prevClose = bars.length >= 2 ? bars[bars.length - 2].close : bars[bars.length - 1].close;
          } else {
            // Last bar is yesterday or older — regularMarketPrice moved since
            prevClose = bars[bars.length - 1].close;
          }
        }
      } else {
        prevClose = currentPrice;
      }

      // Sanity check: if daily change > 25%, something is wrong — use chartPreviousClose
      const impliedChange = Math.abs((currentPrice - prevClose) / prevClose) * 100;
      if (impliedChange > 25 && meta.chartPreviousClose > 0) {
        prevClose = meta.chartPreviousClose;
      }

      // Debug info returned for troubleshooting
      const debug = {
        symbol,
        currentPrice,
        prevClose,
        impliedChangePct: ((currentPrice - prevClose) / prevClose * 100).toFixed(2),
        marketState: meta.marketState,
        regularMarketPreviousClose: meta.regularMarketPreviousClose,
        chartPreviousClose: meta.chartPreviousClose,
        barCount: bars.length,
      };

      return res.status(200).json({
        chart: {
          result: [{
            ...result,
            meta: {
              ...meta,
              regularMarketPrice: currentPrice,
              chartPreviousClose: prevClose,
              previousClose: prevClose,
              regularMarketPreviousClose: prevClose,
            }
          }]
        },
        _debug: debug
      });
    } catch(e) { continue; }
  }

  return res.status(502).json({ error: `Failed to fetch from Yahoo Finance` });
}
