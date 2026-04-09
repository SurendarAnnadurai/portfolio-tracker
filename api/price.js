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

      const meta = result.meta;
      const currentPrice = meta.regularMarketPrice;
      if (!currentPrice) continue;

      // Use Yahoo's own daily change fields directly — no calculation needed
      // regularMarketChange = absolute price change today (e.g. -5.05)
      // regularMarketChangePercent = % change today (e.g. -2.08)
      // These match exactly what Yahoo Finance displays on the quote page
      const dailyChangeAbs  = meta.regularMarketChange ?? 0;
      const dailyChangePct  = meta.regularMarketChangePercent ?? 0;

      // prevClose derived from Yahoo's own values — 100% consistent
      const prevClose = currentPrice - dailyChangeAbs;

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
              // Pass Yahoo's own daily change through directly
              regularMarketChange: dailyChangeAbs,
              regularMarketChangePercent: dailyChangePct,
            }
          }]
        }
      });
    } catch(e) { continue; }
  }

  return res.status(502).json({ error: `Failed to fetch from Yahoo Finance` });
}
