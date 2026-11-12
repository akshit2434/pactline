# Public judge demo: operations

Public URL: **https://pactline.neyven.com** (PayPal **sandbox** only; no real money). Keep it running until 16 Dec 2026, when judging ends.

## What runs

| Piece | systemd user unit | What it does |
|---|---|---|
| App | `pactline-demo.service` | `node src/server.js` on `127.0.0.1:3400` with `PACTLINE_PUBLIC=1`, `PUBLIC_BASE_URL=https://pactline.neyven.com`, its own data dir `../pactline-public-data/`, keys read by name from the host keys file (`KEYS_FILE`). `Restart=always`, `MemoryMax=400M`. |
| Tunnel | `pactline-tunnel.service` | `cloudflared tunnel run --token-file <host config>/cloudflare-tunnel-pactline/token`, the named tunnel **`pactline-demo`** (remotely managed). Its ingress is `pactline.neyven.com -> http://127.0.0.1:3400`, everything else 404. DNS: proxied CNAME `pactline.neyven.com -> <tunnel id>.cfargotunnel.com`. |

Unit files: `~/.config/systemd/user/pactline-demo.service` and `pactline-tunnel.service`. Both are enabled (`WantedBy=default.target`) and the host user has lingering on, so they come back after a reboot. The video/dev instance on `127.0.0.1:3100` and its quick tunnel are separate and untouched.

## Restart, logs, status

```bash
systemctl --user restart pactline-demo.service      # after a code change (git pull) or env change
systemctl --user restart pactline-tunnel.service
systemctl --user status pactline-demo pactline-tunnel --no-pager
journalctl --user -u pactline-demo -n 50 --no-pager
curl -s https://pactline.neyven.com/api/status
```

After editing a unit file: `systemctl --user daemon-reload` first.

## Public demo mode (`PACTLINE_PUBLIC=1`)

Code: `src/public/` (`mode.js`, `limiter.js`, `evidence.js`, `assets/`). Defaults, all overridable by env in the unit:

| Limit | Default | Env |
|---|---|---|
| New deals (real or seeded) per IP per hour | 5 | `PACTLINE_DEALS_PER_HOUR` |
| Claude calls per IP per hour | 20 | `PACTLINE_CLAUDE_PER_HOUR` |
| Claude calls per day, all visitors (UTC day, survives restarts) | 300 | `PACTLINE_CLAUDE_PER_DAY` |
| API requests per IP per 10 min | 600 | `PACTLINE_REQUESTS_PER_10MIN` |
| POST actions per IP per 10 min | 120 | `PACTLINE_WRITES_PER_10MIN` |
| Proof upload size (PNG, JPEG, WebP, GIF, PDF; bytes checked) | 2 MB | `PACTLINE_MAX_UPLOAD_BYTES` |
| JSON body size (non-upload routes) / deal text | 64 KB / 2000 chars | |

When a Claude limit is hit, the request still works on the deterministic offline fallback and the page shows a note (`X-Pactline-Notice` header). Over a limit returns `429` with `Retry-After`.

Also on: CSP (self plus the hashed inline theme script; `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, HSTS, Referrer and Permissions policies; cross-origin POSTs refused (403); no stack traces or internal messages in errors; each visitor (an HttpOnly cookie) sees and acts only on their own deals; `/api/demo/reset`, `/api/webhooks/simulate` and `/mock/approve` are off; `/api/status` has no key names or emails; `/webhooks/paypal` needs a valid PayPal signature (`PAYPAL_WEBHOOK_ID`); the URL oracle refuses private addresses at every redirect hop and at connect time. Rate-limit IPs come from Cloudflare's `CF-Connecting-IP` (trusted only from the local connector).

A banner on every page reads "PayPal Sandbox: no real money", with a link to the simulated demo (`/?demo=1`, no PayPal login, the in-browser engine, labelled "Demo mode · simulated").

## Sandbox test buyer on the hold screen

The hold step shows a box with the US sandbox **personal** (buyer) account so a judge can approve the real sandbox hold. It shows only `PAYPAL_US_SANDBOX_BUYER_EMAIL` / `PAYPAL_US_SANDBOX_BUYER_PASSWORD` (served by `/api/public/config`); merchant client IDs and secrets never leave the server.

It is switched **off** (`PACTLINE_SHOW_SANDBOX_BUYER=0` in the unit) until the buyer's password has been rotated to a throwaway. To switch it on:

1. In developer.paypal.com/dashboard/accounts, open the US sandbox personal account, change its password to a fresh throwaway.
2. Put the new value on the existing `PAYPAL_US_SANDBOX_BUYER_PASSWORD=` line of the host keys file.
3. In `~/.config/systemd/user/pactline-demo.service` set `Environment=PACTLINE_SHOW_SANDBOX_BUYER=1`, then:

```bash
systemctl --user daemon-reload && systemctl --user restart pactline-demo.service
curl -s https://pactline.neyven.com/api/public/config
```

The video recorder (`video/work/record.mjs`) and `scripts/approve.mjs` read the same key at start, so they pick up the new password on their next run.

## Data

`../pactline-public-data/` holds `pactline-state.json` (live deals), `owners.json` (deal to visitor-cookie hash) and `claude-budget.json` (today's count). To wipe the public demo: stop the app, delete those three files, start it.

## Teardown after 16 Dec 2026

```bash
systemctl --user disable --now pactline-tunnel.service pactline-demo.service
```

Then delete the `pactline.neyven.com` CNAME and the `pactline-demo` tunnel in the Cloudflare dashboard (Zero Trust > Networks > Tunnels), and remove the token file.
