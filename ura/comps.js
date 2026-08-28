// /api/comps.js
// Vercel serverless function — "comps within X meters of an address".
//
// Combines two free government APIs:
//   1. OneMap (SLA) — geocodes an address/postal code to SVY21 coordinates.
//      This endpoint is public, no registration or token needed.
//   2. URA Data Service — private residential transactions (reuses the
//      same URA_ACCESS_KEY env var as /api/ura.js).
//
// Both APIs return/accept SVY21 (Singapore's local projected coordinate
// system, in metres) as X/Y — which is why distance can be computed with
// plain Euclidean math instead of needing haversine/lat-long math.
//
// Usage:
//   /api/comps?address=23 Li Po Avenue&radius=1000
//   /api/comps?address=788717&radius=500        (postal code works too)
//
// Returns transactions sorted nearest-first, each with a computed
// distance_m field.

export const config = { runtime: 'edge' };

let cachedToken = null;
let cachedTokenDate = null;

function todaySGT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

async function getUraToken(accessKey) {
  const today = todaySGT();
  if (cachedToken && cachedTokenDate === today) return cachedToken;

  const res = await fetch('https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1', {
    headers: { AccessKey: accessKey },
  });
  if (!res.ok) throw new Error(`URA token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.Result) throw new Error(`No token in URA response: ${JSON.stringify(data)}`);

  cachedToken = data.Result;
  cachedTokenDate = today;
  return cachedToken;
}

async function geocode(address) {
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(
    address
  )}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`OneMap search failed: ${res.status}`);
  const data = await res.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`No geocoding match found for "${address}"`);
  }

  const top = data.results[0];
  return {
    matched_address: top.ADDRESS,
    x: parseFloat(top.X),
    y: parseFloat(top.Y),
    latitude: parseFloat(top.LATITUDE),
    longitude: parseFloat(top.LONGITUDE),
  };
}

async function fetchUraBatch(accessKey, token, batch) {
  const url = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`;
  const res = await fetch(url, { headers: { AccessKey: accessKey, Token: token } });
  if (!res.ok) return []; // skip a failed batch rather than failing the whole request
  const data = await res.json();
  return data.Result || [];
}

function distanceMetres(x1, y1, x2, y2) {
  // SVY21 coordinates are already in metres, so plain Euclidean distance
  // is accurate for distances at this scale (a few km).
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
}

export default async function handler(req) {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    return new Response(JSON.stringify({ error: 'URA_ACCESS_KEY not set' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address');
  const radius = parseFloat(searchParams.get('radius') || '1000'); // metres, default 1km
  const propertyTypeFilter = searchParams.get('propertyType'); // optional: Terrace, Semi-detached, Detached, Apartment, Condominium

  if (!address) {
    return new Response(JSON.stringify({ error: 'Missing required ?address= param' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const [center, token] = await Promise.all([
      geocode(address),
      getUraToken(accessKey),
    ]);

    // URA splits this dataset into 4 batches — pull all of them in parallel.
    const batches = await Promise.all([1, 2, 3, 4].map((b) => fetchUraBatch(accessKey, token, b)));
    const allProjects = batches.flat();

    const results = [];
    for (const project of allProjects) {
      const px = parseFloat(project.x);
      const py = parseFloat(project.y);
      if (isNaN(px) || isNaN(py)) continue;

      const dist = distanceMetres(center.x, center.y, px, py);
      if (dist > radius) continue;

      for (const txn of project.transaction || []) {
        if (propertyTypeFilter && txn.propertyType !== propertyTypeFilter) continue;
        results.push({
          distance_m: Math.round(dist),
          project: project.project,
          street: project.street,
          marketSegment: project.marketSegment,
          ...txn,
        });
      }
    }

    results.sort((a, b) => a.distance_m - b.distance_m);

    return new Response(
      JSON.stringify({
        query: { address, radius_m: radius, propertyType: propertyTypeFilter || 'all' },
        center,
        count: results.length,
        results,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
