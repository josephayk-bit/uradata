// /api/ura.js
// Vercel serverless function — proxies URA Data Service API.
// Handles daily token refresh so the caller never deals with auth.
//
// Deploy this on Vercel, set URA_ACCESS_KEY as an environment variable
// (Project Settings > Environment Variables), and call:
//
//   https://<your-project>.vercel.app/api/ura?service=PMI_Resi_Transaction
//   https://<your-project>.vercel.app/api/ura?service=PMI_Resi_Rental_Median
//
// Optional: &street=li po avenue  -> filters results server-side so you
// get back only rows matching that street name (case-insensitive, partial match).

export const config = { runtime: 'edge' };

// Simple in-memory token cache. Note: on Vercel Edge this may not persist
// across every invocation (cold starts happen), but it avoids refetching
// a token on every single request within the same warm instance.
let cachedToken = null;
let cachedTokenDate = null; // YYYY-MM-DD string, SGT

function todaySGT() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' });
}

async function getToken(accessKey) {
  const today = todaySGT();
  if (cachedToken && cachedTokenDate === today) {
    return cachedToken;
  }

  const res = await fetch('https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1', {
    headers: { AccessKey: accessKey },
  });

  if (!res.ok) {
    throw new Error(`Token request failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  // URA returns { Status: "Success", Result: "<token>" }
  const token = data.Result;
  if (!token) {
    throw new Error(`No token in response: ${JSON.stringify(data)}`);
  }

  cachedToken = token;
  cachedTokenDate = today;
  return token;
}

export default async function handler(req) {
  const accessKey = process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    return new Response(
      JSON.stringify({ error: 'URA_ACCESS_KEY environment variable not set' }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }

  const { searchParams } = new URL(req.url);
  const service = searchParams.get('service') || 'PMI_Resi_Transaction';
  const street = searchParams.get('street'); // optional filter
  const batch = searchParams.get('batch'); // optional, needed for PMI_Resi_Transaction (1,2,3,4)

  try {
    const token = await getToken(accessKey);

    let uraUrl = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=${encodeURIComponent(service)}`;
    if (batch) uraUrl += `&batch=${encodeURIComponent(batch)}`;

    const dataRes = await fetch(uraUrl, {
      headers: {
        AccessKey: accessKey,
        Token: token,
      },
    });

    if (!dataRes.ok) {
      const text = await dataRes.text();
      return new Response(
        JSON.stringify({ error: `URA request failed: ${dataRes.status}`, detail: text }),
        { status: dataRes.status, headers: { 'content-type': 'application/json' } }
      );
    }

    let json = await dataRes.json();

    // Optional server-side street filter.
    // PMI_Resi_Transaction results nest transactions under each project;
    // each project itself doesn't always carry a clean "street" field for
    // landed housing, so we filter loosely on the project/street name where present.
    if (street && json?.Result) {
      const needle = street.toLowerCase();
      json = {
        ...json,
        Result: json.Result.filter((item) => {
          const haystack = JSON.stringify(item).toLowerCase();
          return haystack.includes(needle);
        }),
      };
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
