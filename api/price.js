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

      const meta   = result.meta;
      const closes = result.indicators?.quote?.[0]?.close || [];

      // Valid historical closes (daily bars — each is a day's close)
      const validCloses = closes.filter(c => c !== null && c !== undefined);

      // Current live price — always use regularMarketPrice when available
      // This is the actual current price whether market is open or closed
      const currentPrice = meta.regularMarketPrice;
      if (!currentPrice) continue;

      let prevClose;
      const marketState = meta.marketState; // 'REGULAR', 'PRE', 'POST', 'CLOSED'

      if (marketState === 'REGULAR') {
        // Market currently open — today's bar is incomplete/not in closes array yet
        // chartPreviousClose = yesterday's official close = correct prevClose
        prevClose = meta.chartPreviousClose || meta.previousClose || validCloses[validCloses.length - 1];
      } else {
        // Market closed/pre/post — regularMarketPrice = today's official close
        // The last complete daily bar in closes[] = today's close
        // Second to last = yesterday's close = correct prevClose
        if (validCloses.length >= 2) {
          prevClose = validCloses[validCloses.length - 2];
        } else {
          prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;
        }
      }

      return res.status(200).json({
        chart: {
          result: [{
            ...result,
            meta: {
              ...meta,
              regularMarketPrice: currentPrice,
              chartPreviousClose: prevClose,
              previousClose: prevClose,
            }
          }]
        }
      });
    } catch(e) { continue; }
  }

  return res.status(502).json({ error: `Failed to fetch from Yahoo Finance` });
}
