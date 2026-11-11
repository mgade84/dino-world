# Deploying Dino World to a server

`deploy.sh` builds the game's image on your machine, streams it to the server
over SSH (`docker save | ssh docker load`) and starts it there. The server needs
no source code, no git and no registry: only Docker, plus the `compose.yaml`
and `.env` that the script copies to `~/dinoworld/`.

The server, its domain names and logins are kept out of this repo: they live
only in `deploy/.env`, which git ignores. Keep it that way (the repo is public).

HTTPS comes from a shared Traefik on the server, set up separately (not in this
repo). It owns ports 80/443, gets certificates from Let's Encrypt and routes
your domain to this container by its labels. It must provide:

- a Docker network named `proxy`,
- an entrypoint `websecure` (443, with HTTP redirected to it),
- a certificate resolver `le`,
- a middleware `secure-headers@file`.

HTTPS also turns on the service worker, so the game works offline after the
first visit and installs to the iPad home screen.

## One-time setup

1. **Server:** Docker with the compose plugin, SSH key login, your user in the
   `docker` group, and the shared Traefik running.
2. **DNS:** your domain pointing at the server (a CNAME or A/AAAA record).
3. **Settings:**
   ```bash
   cp deploy/.env.example deploy/.env   # DOMAIN, DEPLOY_HOST (ssh alias or user@host)
   deploy/deploy.sh password <user>     # the site's login
   ```

## Deploying

```bash
deploy/deploy.sh
```

It builds `dinoworld:<date-time>` (also tagged `latest`), uploads it (about
30 MB), copies `compose.yaml` and `.env`, runs `docker compose up -d` on the
server and checks that the site answers and asks for the login. Only the game
container is restarted; Traefik and other services stay put. The newest 5
versions are kept, on the server and locally.

Players get the new version on their next visit (`index.html` and `sw.js` are
served with `no-cache`).

The first deploy can take a minute before HTTPS works while the certificate is
issued; Traefik's logs show it.

## Password

The site is private: Traefik asks for a login (basic auth) before serving
anything. Only the web app manifest and icons are public, because browsers fetch
the manifest without credentials and Add to Home Screen needs them.

To set or change the login:

```bash
deploy/deploy.sh password          # keeps the current user name
deploy/deploy.sh password <user>   # or pick one (needed the first time)
```

It asks for the new password twice (hidden, at least 8 characters), saves its
bcrypt hash as `BASIC_AUTH_USERS` in `deploy/.env` and applies it on the server
right away, without rebuilding. The plain password is never stored. It replaces
any earlier login.

The browser remembers the login. A game added to the iPad home screen runs
separately from Safari, so it asks once more.

## Rolling back

```bash
deploy/deploy.sh list                       # versions on the server
deploy/deploy.sh rollback 20261111-153000   # switch back to one
```
