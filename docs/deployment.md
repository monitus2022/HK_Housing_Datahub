# Deployment

Current public deployment:

- **Frontend:** <https://hk-housing.monitus.org>
- **Snapshot host:** configured in Cloudflare Pages as `VITE_DASHBOARD_BASE_URL`
  (for example `https://data.yourdomain.com`); it is not stored in this repo.

The frontend is a static Vite build. The snapshot is a separate R2 public host.
The two are connected only by the build-time `VITE_DASHBOARD_BASE_URL` value.

> If the live site shows the “Could not load the snapshot” error card, the
> deployed bundle was built before `VITE_DASHBOARD_BASE_URL` was set. Add the
> variable in Pages for Production and Preview, then redeploy.

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
| Environment variable | `VITE_DASHBOARD_BASE_URL=https://<r2-public-host>` |

Set `VITE_DASHBOARD_BASE_URL` for **Production** and **Preview**. Vite bakes it
into the bundle at build time, so changing it requires a new deployment. A
trailing slash is tolerated.

The live custom domain is `hk-housing.monitus.org`; add it under Pages →
Custom domains. If the domain is in Cloudflare, the CNAME is created
automatically.

## R2 snapshot host and CORS

The bucket must allow public reads for the snapshot path. A custom domain such
as `data.monitus.org` is recommended over the rate-limited `r2.dev` URL.

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
https://<r2-public-host>/dashboard/manifest.json
https://<r2-public-host>/dashboard/{build_id}/{file from manifest.files}
```

## Rebuild and release

A merge or push to `main` triggers a new Pages production deployment. You can
also use **Retry deployment** / **Create deployment** in the Pages dashboard.

Important: setting `VITE_DASHBOARD_BASE_URL` after a deployment does not update
the existing bundle. Redeploy after changing it.

## Troubleshooting

| Symptom | Likely cause | Action |
|---|---|---|
| Site loads but shows “Could not load the snapshot” | `VITE_DASHBOARD_BASE_URL` was empty at build time | Set it in Pages for Production and Preview, then redeploy |
| Only the error card with `Request failed (404)` | Wrong snapshot host or manifest path | Check `https://<r2-public-host>/dashboard/manifest.json` |
| Browser blocks the request (CORS) | R2 CORS lacks the Pages origin | Add `https://hk-housing.monitus.org` to `AllowedOrigins` |
| Gzip data fails to parse | Snapshot host is not serving `Content-Encoding: gzip` / CORS exposes it incorrectly | Prefer the R2 custom domain; ensure the publisher uploaded the `.json.gz` files |
| New snapshot not visible | Manifest pointer is cached or was not updated | Confirm `dashboard/manifest.json` was uploaded last; wait for the 60s cache |

## Security

- Only public read credentials/URLs belong in the frontend.
- R2 write credentials stay in `.env` and the backend publisher.
- Do not commit `.env`, `node_modules/`, or `dist/`.
