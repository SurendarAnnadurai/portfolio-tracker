export default async function handler(req, res) {
  const { symbol, period } = req.query;
  if (!symbol) return res.status(400).json({ error: 'No symbol' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  // Map period to Yahoo Finance range/interval
  const rangeMap = {
    'ytd': { range: 'ytd',  interval: '1wk' },
    '1y':  { range: '1y',   interval: '1wk' },
    '2y':  { range: '2y',   interval: '1wk' },
    '3y':  { range: '3y',   interval: '1mo' },
    '5y':  { range: '5y',   interval: '1mo' },
  };
  const { range, interval } = rangeMap[period] || rangeMap['1y'];

  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`,
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

      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];

      // Build clean array of {date, close} pairs, filter nulls
      const points = timestamps
        .map((ts, i) => ({
          date: new Date(ts * 1000).toISOString().slice(0, 10),
          close: closes[i]
        }))
        .filter(p => p.close !== null && p.close !== undefined);

      if (!points.length) continue;

      // Rebase to % return from first point
      const base = points[0].close;
      const rebased = points.map(p => ({
        date: p.date,
        close: p.close,
        pct: ((p.close - base) / base) * 100
      }));

      return res.status(200).json({
        symbol,
        period,
        points: rebased,
        totalReturn: rebased[rebased.length - 1]?.pct ?? 0
      });
    } catch(e) { continue; }
  }

  return res.status(502).json({ error: `Failed to fetch history for ${symbol}` });
}
