# Deployment

Current public deployment:

- **Frontend:** <https://hk-housing.monitus.org>
- **Snapshot host:** <https://hk-housing-datahub.monitus.org>

The frontend is a static Vite build. The snapshot is a separate R2 public host.
The two are connected by the build-time `VITE_DASHBOARD_BASE_URL` value.

> **Current status:** R2 public read and CORS for
> `https://hk-housing.monitus.org` are verified. The first Pages production
> bundle was built before `VITE_DASHBOARD_BASE_URL` was set, so it currently
> shows the “Could not load the snapshot” error card. Confirm the variable is
> set for Production and Preview, then redeploy.

## Before redeploying

1. **R2 public read** — verified: the manifest and versioned data files are
   publicly readable from `https://hk-housing-datahub.monitus.org`.
2. **R2 CORS** — verified: `https://hk-housing.monitus.org` is allowed for
   `GET`/`HEAD`, with the response headers exposed.
3. **Pages environment variable** — set
   `VITE_DASHBOARD_BASE_URL=https://hk-housing-datahub.monitus.org` for both
   Production and Preview.
4. **Redeploy** — Vite bakes the variable at build time; changing it does not
   update an existing bundle.

## Cloudflare Pages settings

| Setting | Value |
|---|---|
| Git repository | `monitus2022/HK_Housing_Datahub` |
| Production branch | `main` |
| Framework preset | **React (Vite)** |
| Root directory | `frontend` |
| Build command | `npm ci && npm run build` |
| Build output directory | `dist` |
| Node version | `22` (`NODE_VERSION=22`) |
| Environment variable | `VITE_DASHBOARD_BASE_URL=https://hk-housing-datahub.monitus.org` |

A trailing slash is tolerated.

The live custom domain is `hk-housing.monitus.org`; add it under Pages →
Custom domains. If the domain is in Cloudflare, the CNAME is created
automatically.

## R2 snapshot host and CORS

The bucket must allow public reads for the snapshot path. A custom domain is
recommended over the rate-limited `r2.dev` URL.

CORS policy example:

```json
[
  {
    "AllowedOrigins": [
      "https://hk-housing.monitus.org"
    ],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": [
      "Content-Type",
      "Content-Length",
      "Content-Encoding",
      "Cache-Control",
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

If preview deployments must work, either add every preview origin or use
`"AllowedOrigins": ["*"]`. The snapshot is public data, so a wildcard origin is
acceptable; never put write credentials in the frontend.

The frontend requests:

```text
https://hk-housing-datahub.monitus.org/dashboard/manifest.json
https://hk-housing-datahub.monitus.org/dashboard/{build_id}/{file from manifest.files}
```

## Verify the snapshot host

```bash
# Public manifest
curl -I https://hk-housing-datahub.monitus.org/dashboard/manifest.json

# CORS for the Pages origin
curl -I -H "Origin: https://hk-housing.monitus.org" \
  https://hk-housing-datahub.monitus.org/dashboard/manifest.json

# Gzip data file
curl -I -H "Accept-Encoding: gzip" \
  https://hk-housing-datahub.monitus.org/dashboard/20261109T164834Z-ea1321/estate_summary.json.gz
```

Expected: `200`, `cache-control` matching the snapshot contract,
`access-control-allow-origin: https://hk-housing.monitus.org`, and
`content-encoding: gzip` on the `.json.gz` request.

## Rebuild and release

A merge or push to `main` triggers a new Pages production deployment. You can
also use **Retry deployment** / **Create deployment** in the Pages dashboard.

Important: setting `VITE_DASHBOARD_BASE_URL` after a deployment does not update
the existing bundle. Redeploy after changing it.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Site loads but shows “Could not load the snapshot” | `VITE_DASHBOARD_BASE_URL` was empty at build time | Confirm it is set for Production and Preview, then redeploy |
| Error card with a JSON parse error / “Unexpected token '<'” | Empty base URL; Pages returned `index.html` for `/dashboard/manifest.json` | Set `VITE_DASHBOARD_BASE_URL` and redeploy |
| Only the error card with `Request failed (404)` | Wrong snapshot host or manifest path | Check `https://hk-housing-datahub.monitus.org/dashboard/manifest.json` |
| Browser blocks the request (CORS) | R2 CORS lacks the Pages origin | Add `https://hk-housing.monitus.org` to `AllowedOrigins` |
| Gzip data fails to parse | Snapshot host is not serving `Content-Encoding: gzip` / CORS exposes it incorrectly | Prefer the R2 custom domain; ensure the publisher uploaded the `.json.gz` files |
| New snapshot not visible | Manifest pointer is cached or was not updated | Confirm `dashboard/manifest.json` was uploaded last; wait for the 60s cache |

## Security

- Only public read credentials/URLs belong in the frontend.
- R2 write credentials stay in `.env` and the backend publisher.
- Do not commit `.env`, `node_modules/`, or `dist/`.
