# Feedstr — Calm Multi-Column Feed Reader

A self-hosted Nostr feed reader and publisher in the `*str` stack, in the style of
a multi-column deck — without trending, engagement bait, or opaque ranking. Feedstr
reads from your relays and sends your posts to **Idenstr** to be signed; Feedstr
never signs anything and your keys never touch it.

Part of the `*str` ecosystem alongside Idenstr (identity/signing) and Workstr.

## Install

Requires a running [Idenstr](https://github.com/sette7blo/idenstr) — it holds your keys
and does all signing and publishing. Feedstr talks to it over HTTP with a scoped token.

### Docker (recommended)

The published image is multi-arch (`linux/amd64`, `linux/arm64`):

```text
dockersette/feedstr:latest
```

Create a directory for Feedstr and add two files. No checkout is needed — the
deployment folder only ever holds `compose.yaml` and `.env`.

**compose.yaml**
```yaml
services:
  feedstr:
    image: dockersette/feedstr:latest
    container_name: feedstr
    restart: unless-stopped
    # Run as your host user so the bind-mounted .env stays writable when the
    # dashboard saves the Idenstr connection. If your user is not 1000:1000,
    # set UID/GID in .env to match.
    user: "${UID:-1000}:${GID:-1000}"
    env_file: .env
    ports:
      - "${FEEDSTR_HOST_BIND:-127.0.0.1}:${FEEDSTR_HOST_PORT:-3002}:3002"
    volumes:
      - feedstr-data:/data
      # Writable so saving the Idenstr connection in the dashboard persists.
      - ./.env:/app/.env
    extra_hosts:
      - "host.docker.internal:host-gateway"

volumes:
  feedstr-data:
```

**.env**
```bash
FEEDSTR_IDENSTR_URL=http://host.docker.internal:3000
FEEDSTR_IDENSTR_TOKEN=idstr_paste_token_here

# Idenstr's private relay (its embedded Strfry vault). Use the LAN or Tailscale
# address of the host running Idenstr — the browser connects to it directly.
FEEDSTR_PRIVATE_RELAY_URL=ws://192.168.1.10:7777

FEEDSTR_HOST_BIND=127.0.0.1
FEEDSTR_HOST_PORT=3002
```

Create `.env` before the first start (Docker would otherwise create it as a
directory) and make sure the container's user can write it:

```bash
touch .env && chmod 660 .env    # after filling in the values above
docker compose pull
docker compose up -d
```

Open `http://<host>:3002`. Feedstr has no login of its own — keep it on a trusted
LAN/tailnet or behind an HTTPS reverse proxy.

To upgrade, pull the new image and recreate:

```bash
docker compose pull && docker compose up -d
```

Pin a version instead of tracking `latest` by using a release tag —
`dockersette/feedstr:0.6.0` or `dockersette/feedstr:0.6`. Releases are listed on the
[releases page](https://github.com/sette7blo/feedstr/releases).

### Idenstr token scopes

Generate a token in Idenstr (API tokens), name it `feedstr`, and grant:

```text
profile:read
following:read
following:write     # follow/unfollow (Idenstr owns kind:3)
mutes:read
mutes:write
relays:read
sign:kind:1         # notes
sign:kind:5         # deletions
sign:kind:6         # reposts
sign:kind:7         # reactions
sign:kind:27235     # media upload auth (NIP-98)
zaps:write
schedule:read       # scheduled post queue
schedule:write      # create/cancel/publish scheduled posts
```

Feedstr checks this list on startup and reports any missing scope in the dashboard's
Idenstr connection panel.

### From source (development)

```bash
git clone https://github.com/sette7blo/feedstr.git
cd feedstr
cp .env.example .env   # set your Idenstr URL + token and the private relay URL
docker compose up -d --build
```

The repository's `compose.yaml` builds from the checkout rather than pulling the
image. Tests run with `npm test`.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `FEEDSTR_IDENSTR_URL` | Yes | Idenstr base URL (e.g. `http://host.docker.internal:3000`) |
| `FEEDSTR_IDENSTR_TOKEN` | Yes | Scoped Idenstr API token |
| `FEEDSTR_PRIVATE_RELAY_URL` | Yes | Idenstr's private relay (Strfry vault), read directly alongside public relays |
| `FEEDSTR_HOST_BIND` | No | Host/IP to expose on, default `127.0.0.1` |
| `FEEDSTR_HOST_PORT` | No | Host port, default `3002` |
| `FEEDSTR_ENV_FILE` | No | Path the dashboard writes saved settings back to, default `/app/.env` in the image |

All three required values are also editable in the dashboard (Idenstr connection),
which writes them back to `.env` — that is why the file is bind-mounted and must be
writable by the container's user. Feedstr's own data (columns, feed rules, mutes,
read-position, cached notes) lives in SQLite at `/data/feedstr.db` in the
`feedstr-data` volume.

## DB vs vault

Feedstr follows the stack rule: **signed Nostr events go in the vault; everything
else goes in the DB.** Feedstr never signs or writes events itself — it **reads**
observed and canonical events (from your private vault and public read relays) to
build calm feeds, and when you post, repost, or react it builds that one item as
an unsigned `kind:1` / `kind:6` / `kind:7` event and **sends it to Idenstr to be
signed** and published; Idenstr holds your keys, Feedstr never does. Everything
Feedstr owns — feed rules, keyword mutes, column config,
read-position, and cached notes — lives in its own DB and is never published. See
the stack `docs/architecture.md` → Storage Boundary.

## Roadmap and code map

Direction and current state live in [`ROADMAP.md`](ROADMAP.md), the code layout in
[`MODULES.md`](MODULES.md), and the work queue is
[GitHub Issues](https://github.com/sette7blo/feedstr/issues).

## License

MIT
