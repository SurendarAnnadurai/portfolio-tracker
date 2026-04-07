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
      const timestamps = result.timestamp || [];

      // Filter out null closes and pair with timestamps
      const validPoints = closes
        .map((c, i) => ({ close: c, ts: timestamps[i] }))
        .filter(p => p.close !== null && p.close !== undefined);

      const currentPrice = meta.regularMarketPrice || (validPoints.length > 0 ? validPoints[validPoints.length - 1].close : null);

      // prevClose = the actual previous trading day close from the data array
      // NOT chartPreviousClose which can be stale across weekends
      let prevClose;
      if (validPoints.length >= 2) {
        // If market is currently open, last point in array = today's intraday
        // second-to-last = yesterday's close
        // If market is closed, last point = today's close, second-to-last = yesterday
        const isMarketOpen = meta.marketState === 'REGULAR';
        if (isMarketOpen) {
          // Use second-to-last as previous close
          prevClose = validPoints[validPoints.length - 2].close;
        } else {
          // Market closed - last two points are today and yesterday closes
          prevClose = validPoints[validPoints.length - 2].close;
        }
      } else if (validPoints.length === 1) {
        prevClose = meta.chartPreviousClose || meta.previousClose || validPoints[0].close;
      } else {
        prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;
      }

      if (!currentPrice) continue;

      // Return enriched response with cleaner price data
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

  return res.status(502).json({ error: 'Failed to fetch from Yahoo Finance' });
}
