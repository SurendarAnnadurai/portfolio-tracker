export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'No symbol provided' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
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
      const currentPrice = meta.regularMarketPrice;
      if (!currentPrice) continue;

      const marketState = meta.marketState; // REGULAR, PRE, POST, CLOSED

      // Yahoo's own daily change fields
      const yahooChangeAbs = meta.regularMarketChange ?? 0;
      const yahooChangePct = meta.regularMarketChangePercent ?? 0;

      // Get clean closes array for fallback
      const closes     = result.indicators?.quote?.[0]?.close || [];
      const timestamps = result.timestamp || [];
      const bars = timestamps
        .map((ts, i) => ({ ts, close: closes[i] }))
        .filter(b => b.close != null)
        .sort((a, b) => a.ts - b.ts);

      let dailyChangeAbs, dailyChangePct, prevClose;

      // Yahoo's regularMarketChange is ONLY non-zero during REGULAR and POST market hours
      // During PRE market and CLOSED it resets to 0 — we need the closes array instead
      if (marketState === 'REGULAR' || marketState === 'POST') {
        // Market open or just closed — Yahoo's own fields are reliable
        if (Math.abs(yahooChangePct) > 0.001) {
          dailyChangeAbs = yahooChangeAbs;
          dailyChangePct = yahooChangePct;
          prevClose      = currentPrice - yahooChangeAbs;
        } else {
          // Yahoo fields are zero — use closes array
          prevClose      = bars.length >= 2 ? bars[bars.length - 2].close : currentPrice;
          dailyChangeAbs = currentPrice - prevClose;
          dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
        }
      } else {
        // PRE market or CLOSED — regularMarketPrice = last official close
        // Use last two bars: last = today's close, second-to-last = yesterday's close
        if (bars.length >= 2) {
          const todayClose     = bars[bars.length - 1].close;
          const yesterdayClose = bars[bars.length - 2].close;
          prevClose      = yesterdayClose;
          dailyChangeAbs = todayClose - yesterdayClose;
          dailyChangePct = yesterdayClose > 0 ? (dailyChangeAbs / yesterdayClose) * 100 : 0;
        } else {
          prevClose      = meta.chartPreviousClose || currentPrice;
          dailyChangeAbs = currentPrice - prevClose;
          dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
        }
      }

      return res.status(200).json({
        chart: {
          result: [{
            ...result,
            meta: {
              ...meta,
              regularMarketPrice:         currentPrice,
              chartPreviousClose:         prevClose,
              previousClose:              prevClose,
              regularMarketPreviousClose: prevClose,
              regularMarketChange:        dailyChangeAbs,
              regularMarketChangePercent: dailyChangePct,
            }
          }]
        }
      });
    } catch(e) { continue; }
  }

  return res.status(502).json({ error: `Failed to fetch from Yahoo Finance` });
}
