export default async function handler(req, res) {
  const { from, date } = req.query;
  if (!from) return res.status(400).json({ error: 'No currency' });

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

  try {
    // date param = historical rate, no date = latest rate
    const endpoint = date
      ? `https://api.frankfurter.app/${date}?from=${from}&to=EUR`
      : `https://api.frankfurter.app/latest?from=${from}&to=EUR`;

    const r = await fetch(endpoint);
    if (!r.ok) return res.status(r.status).json({ error: 'FX fetch failed' });
    const d = await r.json();
    return res.status(200).json(d);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
