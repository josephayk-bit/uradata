# URA Data Connector

A tiny Vercel serverless function that proxies the free URA Data Service API
so it can be called with a plain public URL — no AccessKey/Token handling
required by the caller (including me, in a Claude chat).

## Setup

1. **Create a new folder** (or add to an existing Vercel project) with this
   structure:
   ```
   your-project/
     api/
       ura.js
   ```
   Just the `api/ura.js` file from this delivery — no other config needed
   for a minimal deploy.

2. **Push to GitHub** (or drag-and-drop the folder into Vercel's dashboard
   if you're not using git).

3. **Import into Vercel** (vercel.com/new) and deploy.

4. **Set the environment variable**:
   - Go to your Vercel project → Settings → Environment Variables
   - Add `URA_ACCESS_KEY` = `66904ff4-1022-4570-8329-666202fafbaa`
     (the key from your registration email)
   - Redeploy after adding it (Vercel doesn't hot-reload env vars).

5. **Test it** — visit in your browser or curl:
   ```
   https://your-project.vercel.app/api/ura?service=PMI_Resi_Transaction&batch=1
   ```
   You should get back JSON transaction data, no auth needed on your end.

## Usage

- **All private residential transactions (batch 1–4, required for this service)**:
  `?service=PMI_Resi_Transaction&batch=1`
  (URA splits this dataset into 4 batches — you may need to call all 4 and
  merge if you want the full dataset)

- **Rental contracts**: `?service=PMI_Resi_Rental`
- **Median rentals**: `?service=PMI_Resi_Rental_Median`

- **Optional street filter** (loose match across the JSON):
  `?service=PMI_Resi_Transaction&batch=1&street=li po avenue`

## Give Claude the URL

Once deployed, just tell Claude the base URL, e.g.:

> "My URA connector is at https://your-project.vercel.app/api/ura — use it
> for property comps from now on."

Claude can then fetch it directly (it's a public, unauthenticated GET
endpoint) whenever you ask for transaction data — no more manual pasting
from websites.

## Notes / limitations

- URA's terms require calling the data service from a server, not directly
  from a client-facing product — this function satisfies that.
- The daily token is cached in memory per warm instance; cold starts will
  fetch a new one, which is fine and expected.
- Landed properties don't always have a clean "street" field in the raw
  URA response — the street filter does a loose substring match across the
  whole record. For precise radius-based results (e.g. "within 1km of an
  address"), you'd want to add OneMap geocoding on top of this — happy to
  add that as a second step once this is working.
- Rate limits: URA doesn't publish a strict public number, but avoid
  hammering it — this is meant for occasional lookups, not high-frequency
  polling.
