#!/usr/bin/env bash
# Build Dino World locally and ship it to the VPS over SSH (no registry, no git on the server).
#
#   deploy/deploy.sh                  build, upload and start the new version
#   deploy/deploy.sh password [user]  set the site's login (asks for the password) and apply it
#   deploy/deploy.sh list             list the versions kept on the VPS
#   deploy/deploy.sh rollback <tag>   switch the VPS back to an earlier version
#
# Settings come from deploy/.env (see .env.example): DEPLOY_HOST (user@host or
# an ssh alias), DEPLOY_DIR (folder on the VPS, default "dinoworld"), DOMAIN and
# BASIC_AUTH_USERS. DEPLOY_HOST can also be given in the environment. The
# server must already run the shared Traefik (see deploy/README.md).
# Real host names, domains and logins belong only in deploy/.env (git-ignored).
set -euo pipefail

IMAGE=dinoworld
KEEP=5 # versions kept on the VPS and locally

here=$(cd "$(dirname "$0")" && pwd)
root=$(dirname "$here")
env_file="$here/.env"

die() { echo "error: $*" >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[ -f "$env_file" ] || die "missing deploy/.env (copy deploy/.env.example and fill it in)"

# Read a KEY=value line from .env without sourcing the file.
env_get() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$env_file" | tail -n1 | sed 's/^["'\'']//; s/["'\'']$//'; }

HOST=${DEPLOY_HOST:-$(env_get DEPLOY_HOST)}
DIR=$(env_get DEPLOY_DIR); DIR=${DIR:-dinoworld}
DOMAIN=$(env_get DOMAIN)
cmd=${1:-deploy}
[ -n "$HOST" ] || die "set DEPLOY_HOST=user@host in deploy/.env"
case $DIR in *[!A-Za-z0-9._/~-]*) die "DEPLOY_DIR may only contain letters, digits and . _ / ~ -" ;; esac

# Share one SSH connection between all the steps (one login / passphrase prompt).
ctl=$(mktemp -d)
ssh_opts=(-o ControlMaster=auto -o ControlPath="$ctl/%C" -o ControlPersist=120)
cleanup() { ssh "${ssh_opts[@]}" -O exit "$HOST" 2>/dev/null || true; rm -rf "$ctl"; }
trap cleanup EXIT
remote() { ssh "${ssh_opts[@]}" "$HOST" "$@"; }

# Delete all but the newest $KEEP dated tags (dated tags sort by time).
prune_cmd="docker image ls $IMAGE --format '{{.Tag}}' | grep -E '^[0-9]{8}-[0-9]{6}\$' | sort -r | tail -n +$((KEEP + 1)) | xargs -r -I{} docker image rm $IMAGE:{} >/dev/null || true"

# Traefik routes to the container only once its healthcheck passes.
wait_healthy() {
  step "Waiting for the container to be healthy"
  remote "cd $DIR && id=\$(docker compose ps -q web) && for i in \$(seq 1 30); do
            s=\$(docker inspect -f '{{.State.Health.Status}}' \$id)
            [ \"\$s\" = healthy ] && { echo healthy; exit 0; }
            [ \"\$s\" = unhealthy ] && { echo unhealthy >&2; docker compose logs --tail 20 web >&2; exit 1; }
            sleep 2
          done; echo \"still \$s after 60 s\" >&2; exit 1" || die "the container isn't healthy"
}

# The manifest is public, so it shows the container answers; / must ask for the login.
check_site() {
  [ -n "$DOMAIN" ] || return 0
  step "Checking https://$DOMAIN"
  local ok= code
  for _ in 1 2 3 4 5 6; do
    if curl -fs -o /dev/null --max-time 10 "https://$DOMAIN/manifest.webmanifest"; then ok=1; break; fi
    sleep 5
  done
  if [ -z "$ok" ]; then
    echo "warning: https://$DOMAIN isn't answering yet. On a first deploy the certificate can take a minute;" >&2
    echo "         check with: ssh $HOST 'cd traefik && docker compose logs --tail 50'" >&2
    return 0
  fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/")
  if [ "$code" = 401 ]; then echo "Live: https://$DOMAIN ($1, password protected)"
  else echo "warning: https://$DOMAIN/ answered $code without a password, expected 401" >&2
  fi
}

# Ask for a password (twice, hidden), store its bcrypt hash in .env and apply it on the VPS.
# Without a terminal the password is read from the first line of stdin.
set_password() {
  local user=${1:-} pw pw2 line tmp
  [ -n "$user" ] || user=$(env_get BASIC_AUTH_USERS | sed -n 's/^\([^:]*\):.*/\1/p')
  [ -n "$user" ] || die "usage: deploy/deploy.sh password <user>   (the user name is needed the first time)"
  case $user in *[!A-Za-z0-9._-]*|'') die "user name may only contain letters, digits and . _ -" ;; esac

  if [ -t 0 ]; then
    read -rsp "New password for '$user': " pw; echo
    read -rsp "Repeat it: " pw2; echo
    [ "$pw" = "$pw2" ] || die "the passwords don't match"
  else
    IFS= read -r pw || true
  fi
  [ ${#pw} -ge 8 ] || die "use at least 8 characters"

  # Hashed in a throwaway container; the password goes in on stdin, never on a command line.
  line=$(printf '%s\n' "$pw" | docker run --rm -i httpd:2.4-alpine htpasswd -niB "$user" 2>/dev/null | head -n1)
  unset pw pw2
  case $line in "$user":\$2*) ;; *) die "hashing the password failed (is Docker running?)" ;; esac

  tmp=$(mktemp "$here/.env.XXXXXX")
  grep -v -e '^BASIC_AUTH_USERS=' -e '^# Login for the site' "$env_file" > "$tmp" || true
  printf "# Login for the site: set with deploy/deploy.sh password\nBASIC_AUTH_USERS='%s'\n" "$line" >> "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$env_file"
  echo "Saved the login for '$user' in deploy/.env"

  if ! remote "test -f $DIR/compose.yaml"; then
    echo "Dino World isn't on $HOST yet: run deploy/deploy.sh to put it there with this login."
    return 0
  fi
  step "Applying the new login on $HOST"
  scp -q "${ssh_opts[@]}" "$env_file" "$HOST:$DIR/.env"
  remote "chmod 600 $DIR/.env && cd $DIR && docker compose up -d"
  wait_healthy
  check_site "new login for '$user'"
}

case $cmd in
  password)
    set_password "${2:-}"
    exit 0
    ;;
  list)
    remote "docker image ls $IMAGE --format 'table {{.Tag}}\t{{.ID}}\t{{.CreatedSince}}'"
    exit 0
    ;;
  rollback)
    tag=${2:-}
    [ -n "$tag" ] || die "usage: deploy/deploy.sh rollback <tag>   (see: deploy/deploy.sh list)"
    step "Rolling back $HOST to $IMAGE:$tag"
    remote "docker image inspect $IMAGE:$tag >/dev/null 2>&1 || { echo 'no such version: $tag' >&2; exit 1; }
            docker tag $IMAGE:$tag $IMAGE:latest && cd $DIR && docker compose up -d"
    wait_healthy
    check_site "version $tag"
    exit 0
    ;;
  deploy) ;;
  *) die "unknown command '$cmd' (use: deploy, password [user], list or rollback <tag>)" ;;
esac

grep -q "^BASIC_AUTH_USERS='[^:']\+:" "$env_file" ||
  die "no login set yet: run deploy/deploy.sh password"

tag=$(date +%Y%m%d-%H%M%S)

step "Building $IMAGE:$tag"
docker build --pull --target prod -t "$IMAGE:$tag" -t "$IMAGE:latest" "$root"

step "Uploading image to $HOST"
remote "docker network inspect proxy >/dev/null 2>&1" ||
  die "no 'proxy' network on $HOST: start the shared Traefik there first (see deploy/README.md)"
remote "mkdir -p $DIR && docker version --format 'Docker {{.Server.Version}} on the VPS'"
docker save "$IMAGE:$tag" "$IMAGE:latest" | gzip | remote "gunzip | docker load"

step "Copying compose.yaml and .env to $HOST:$DIR"
scp -q "${ssh_opts[@]}" "$here/compose.yaml" "$env_file" "$HOST:$DIR/"
remote "chmod 600 $DIR/.env"

step "Starting"
remote "cd $DIR && docker compose up -d --remove-orphans && $prune_cmd"
eval "$prune_cmd" # same clean-up locally

wait_healthy
check_site "version $tag"
