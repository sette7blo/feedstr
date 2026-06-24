# Feedstr — Calm Multi-Column Feed Reader

A self-hosted Nostr feed reader and publisher in the `*str` stack, in the style of
a multi-column deck — without trending, engagement bait, or opaque ranking. Feedstr
reads from your relays and sends your posts to **Idenstr** to be signed; Feedstr
never signs anything and your keys never touch it.

Part of the `*str` ecosystem alongside Idenstr (identity/signing) and Workstr.

## Quick start (Docker Compose)

Requires a running [Idenstr](../idenstr) for signing and publishing.

```bash
cp .env.example .env   # set your Idenstr URL + token and the private relay URL
docker compose up -d --build
```

Open `http://<host>:3002`. Feedstr has no login of its own — keep it on a trusted
LAN/tailnet or behind an HTTPS reverse proxy.

### Idenstr token scopes

Generate a token in Idenstr (API tokens), name it `feedstr`, and grant:

```text
profile:read
following:read
relays:read
sign:kind:1     # notes
sign:kind:6     # reposts
sign:kind:7     # reactions
```

## Configuration

| Variable | Required | Description |
|---|---|---|
| `FEEDSTR_IDENSTR_URL` | Yes | Idenstr base URL (e.g. `http://host.docker.internal:3000`) |
| `FEEDSTR_IDENSTR_TOKEN` | Yes | Scoped Idenstr API token |
| `FEEDSTR_PRIVATE_RELAY_URL` | Yes | Idenstr's private relay (Strfry vault), read directly alongside public relays |
| `FEEDSTR_HOST_BIND` | No | Host/IP to expose on, default `127.0.0.1` |
| `FEEDSTR_HOST_PORT` | No | Host port, default `3002` |

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

## License

MIT
