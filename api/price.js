export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ error: 'No symbol provided' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json',
    'Referer': 'https://finance.yahoo.com',
  };

  // Strategy: fetch TWO separate calls
  // Call 1: range=1d interval=1m — gives live price + today's official change fields
  // Call 2: range=5d interval=1d — gives daily bars to find yesterday's close reliably
  // This is exactly how Yahoo Finance's own frontend works

  const urls1d = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1m&range=1d`,
  ];

  const urls5d = [
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
  ];

  let meta1d = null, closes5d = [], timestamps5d = [];

  // Fetch 1d chart (intraday) for live price and Yahoo's own change fields
  for (const url of urls1d) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (result?.meta?.regularMarketPrice) {
        meta1d = result.meta;
        break;
      }
    } catch(e) { continue; }
  }

  // Fetch 5d daily bars for reliable prevClose
  for (const url of urls5d) {
    try {
      const r = await fetch(url, { headers });
      if (!r.ok) continue;
      const d = await r.json();
      const result = d?.chart?.result?.[0];
      if (result) {
        closes5d    = result.indicators?.quote?.[0]?.close    || [];
        timestamps5d = result.timestamp || [];
        if (!meta1d) meta1d = result.meta; // fallback
        break;
      }
    } catch(e) { continue; }
  }

  if (!meta1d?.regularMarketPrice) {
    return res.status(502).json({ error: `Failed to fetch ${symbol}` });
  }

  const currentPrice = meta1d.regularMarketPrice;
  const marketState  = meta1d.marketState;

  // Build sorted daily bars, filter nulls
  const bars = timestamps5d
    .map((ts, i) => ({ ts, close: closes5d[i] }))
    .filter(b => b.close != null)
    .sort((a, b) => a.ts - b.ts);

  // Find prevClose using timestamps to identify today vs yesterday
  // Get today's date in the exchange's local timezone from the timestamp
  const nowSec = Date.now() / 1000;

  let prevClose, dailyChangeAbs, dailyChangePct;

  if (marketState === 'REGULAR' || marketState === 'POST') {
    // Market open or just closed:
    // Yahoo's regularMarketChange is live and correct RIGHT NOW
    const yahooChange    = meta1d.regularMarketChange    ?? 0;
    const yahooChangePct = meta1d.regularMarketChangePercent ?? 0;

    if (Math.abs(yahooChangePct) > 0.0001 || yahooChange !== 0) {
      // Yahoo's own fields are populated and non-zero — trust them completely
      dailyChangeAbs = yahooChange;
      dailyChangePct = yahooChangePct;
      prevClose      = currentPrice - yahooChange;
    } else {
      // Yahoo fields are zero — calculate from bars
      // Last bar = yesterday (today's bar isn't complete yet in daily data)
      prevClose      = bars.length >= 1 ? bars[bars.length - 1].close : currentPrice;
      dailyChangeAbs = currentPrice - prevClose;
      dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
    }
  } else {
    // CLOSED or PRE: regularMarketPrice = today's official close
    // Find yesterday's bar: the last bar whose date is NOT today
    const todayDateStr = new Date().toISOString().slice(0, 10);

    // Find the last two distinct trading days in bars
    const dayGroups = {};
    bars.forEach(b => {
      const d = new Date(b.ts * 1000).toISOString().slice(0, 10);
      dayGroups[d] = b.close; // last close for each day
    });
    const sortedDays = Object.keys(dayGroups).sort();

    if (sortedDays.length >= 2) {
      const lastDay       = sortedDays[sortedDays.length - 1];
      const prevDay       = sortedDays[sortedDays.length - 2];
      const lastDayClose  = dayGroups[lastDay];
      const prevDayClose  = dayGroups[prevDay];

      // If last day in bars is today, use it as current and prev day as prevClose
      // If last day is yesterday (market closed since), current price IS today's close
      if (lastDay === todayDateStr) {
        prevClose      = prevDayClose;
        dailyChangeAbs = currentPrice - prevClose;
        dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
      } else {
        // Last bar is yesterday — current price moved since last bar
        prevClose      = lastDayClose;
        dailyChangeAbs = currentPrice - prevClose;
        dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
      }
    } else if (sortedDays.length === 1) {
      prevClose      = meta1d.chartPreviousClose || currentPrice;
      dailyChangeAbs = currentPrice - prevClose;
      dailyChangePct = prevClose > 0 ? (dailyChangeAbs / prevClose) * 100 : 0;
    } else {
      prevClose      = meta1d.chartPreviousClose || currentPrice;
      dailyChangeAbs = 0;
      dailyChangePct = 0;
    }
  }

  return res.status(200).json({
    chart: {
      result: [{
        meta: {
          ...meta1d,
          regularMarketPrice:         currentPrice,
          chartPreviousClose:         prevClose,
          previousClose:              prevClose,
          regularMarketPreviousClose: prevClose,
          regularMarketChange:        dailyChangeAbs,
          regularMarketChangePercent: dailyChangePct,
        },
        timestamp:  timestamps5d,
        indicators: { quote: [{ close: closes5d }] }
      }]
    }
  });
}
