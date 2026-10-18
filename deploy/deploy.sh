#!/usr/bin/env bash
# Installs, tests, builds and (re)starts MFEC IceBreaker Arena under pm2, behind nginx at /icebreaker.
#
#   bash deploy/deploy.sh          the first install, and every update (it runs `git pull` itself)
#   FORCE=1 bash deploy/deploy.sh  even while rooms are open: every live game ends
#
# The site is down while an update builds the web app (a minute or two), so update between events.
# If the build fails, the previous build goes back and the site runs as it did before.
# Another server can override NEXT_PUBLIC_BASE_PATH, BIND_HOST, WEB_PORT and GAME_PORT.
# Everything sits in main, so a `git pull` that rewrites this file cannot change it mid-run.
set -euo pipefail

main() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.."
  local root
  root=$(pwd -P)

  export NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH-/icebreaker}
  export BIND_HOST=${BIND_HOST:-127.0.0.1}
  export WEB_PORT=${WEB_PORT:-4231}
  export GAME_PORT=${GAME_PORT:-4232}
  export NEXT_TELEMETRY_DISABLED=1

  # the same rule as apps/web/next.config.ts, which would otherwise rewrite 'x' or '/x/' to '/x'
  # behind our back and leave the health check below polling a URL that does not exist
  [[ -z $NEXT_PUBLIC_BASE_PATH || $NEXT_PUBLIC_BASE_PATH =~ ^(/[A-Za-z0-9_.~-]+)+$ ]] ||
    die "NEXT_PUBLIC_BASE_PATH should look like /icebreaker, got \"$NEXT_PUBLIC_BASE_PATH\""
  for port in "$WEB_PORT" "$GAME_PORT"; do
    # no leading zero, which bash arithmetic would read as octal
    [[ $port =~ ^[1-9][0-9]{0,4}$ ]] && ((port <= 65535)) || die "\"$port\" is not a port number"
  done
  [ "$WEB_PORT" != "$GAME_PORT" ] || die "WEB_PORT and GAME_PORT are both $WEB_PORT"

  step "Checking ports $WEB_PORT and $GAME_PORT"
  for port in "$WEB_PORT" "$GAME_PORT"; do
    port_is_ours "$port" "$root" || die "port $port is already used by another program; pick another with WEB_PORT/GAME_PORT"
  done

  # rooms live only in the game server's memory, so a restart ends every game in progress
  step "Checking for open rooms"
  local health rooms
  health=$(curl -fsS --max-time 3 "http://127.0.0.1:$GAME_PORT/health" 2>/dev/null || true)
  rooms=$(node -p 'try { JSON.parse(process.argv[1]).rooms ?? 0 } catch { 0 }' "$health")
  echo "${health:-game server not running}"
  if [ "$rooms" != 0 ] && [ "${FORCE:-}" != 1 ]; then
    die "$rooms room(s) still open, and a restart would end them. Wait until they expire, or run again with FORCE=1"
  fi

  local from=
  if git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
    step "Updating the code"
    from=$(git rev-parse --short HEAD)
    git pull --ff-only
  fi
  # a failure from here on puts the previous build back, and says how to deploy the previous version
  trap "finish \$? $from" EXIT
  trap 'exit 1' INT TERM HUP

  step "Installing packages"
  npm ci --include=dev --no-audit --no-fund

  step "Running tests"
  npm test

  step "Building the web app for ${NEXT_PUBLIC_BASE_PATH:-/}"
  set_aside_build
  npm run build
  rm -rf apps/web/.next.prev

  step "Starting under pm2"
  pm2 startOrReload ecosystem.config.js --update-env

  step "Waiting for both processes to answer"
  wait_for "http://127.0.0.1:$GAME_PORT/health"
  wait_for "http://127.0.0.1:$WEB_PORT${NEXT_PUBLIC_BASE_PATH:-/}"

  # only a deploy that answers becomes the one pm2 brings back after a reboot
  step "Saving the pm2 app list"
  if save_pm2_list; then
    step "Done: web 127.0.0.1:$WEB_PORT${NEXT_PUBLIC_BASE_PATH}, game server 127.0.0.1:$GAME_PORT"
  else
    step "Running, but not saved for a reboot: web 127.0.0.1:$WEB_PORT${NEXT_PUBLIC_BASE_PATH}, game server 127.0.0.1:$GAME_PORT"
  fi
}

step() { printf '\n==> %s\n' "$*"; }
warn() { printf 'deploy: %s\n' "$*" >&2; }
die() {
  warn "$*"
  exit 1
}

# true when nothing listens on the port, or only processes running from this checkout (our own pm2 apps)
port_is_ours() {
  local port=$1 root=$2 listeners pid cwd
  listeners=$(ss -Hltnp "sport = :$port")
  [ -z "$listeners" ] && return 0
  # a listener without a pid belongs to another user, whose processes we cannot see
  grep -q 'pid=' <<<"$listeners" || return 1
  for pid in $(grep -o 'pid=[0-9]*' <<<"$listeners" | cut -d= -f2 | sort -u); do
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null || true)
    case "$cwd" in
      "$root" | "$root"/*) ;;
      *) return 1 ;;
    esac
  done
}

wait_for() {
  for _ in $(seq 1 30); do
    curl -fsS -o /dev/null --max-time 2 "$1" && return 0
    sleep 1
  done
  die "$1 did not answer; see: pm2 logs icebreaker-server icebreaker-web --lines 50"
}

# The running site serves its build from apps/web/.next, and next build starts by emptying it (all but
# cache, dev, diagnostics, lock and trace). The build waits in .next.prev until the new one is done, to go
# back if it fails. Without a finished build in .next there is nothing to keep: this is the first one, or
# a run that was killed while building left the last build that worked in .next.prev.
set_aside_build() {
  [ -f apps/web/.next/BUILD_ID ] || return 0
  rm -rf apps/web/.next.prev
  mkdir apps/web/.next.prev
  build_files -exec mv -t apps/web/.next.prev {} +
}

put_back_build() {
  mkdir -p apps/web/.next
  build_files -exec rm -rf {} +
  find apps/web/.next.prev -mindepth 1 -maxdepth 1 -exec mv -t apps/web/.next {} +
  rmdir apps/web/.next.prev
}

build_files() {
  find apps/web/.next -mindepth 1 -maxdepth 1 ! -name cache ! -name dev ! -name diagnostics ! -name lock ! -name trace "$@"
}

# the EXIT trap once the code may have changed: a failure puts the previous build back, so the running
# site works as before, and prints how to deploy the previous version (deploy.sh does not pull on a
# detached HEAD). A function's locals are gone here, so the commit comes in as an argument.
finish() {
  local status=$1 from=${2:-} branch
  [ "$status" -ne 0 ] || return 0
  if [ -d apps/web/.next.prev ] && put_back_build; then
    warn "the previous build is back in apps/web/.next, so the running site works as before"
  fi
  if [ -n "$from" ] && [ "$(git rev-parse --short HEAD)" != "$from" ]; then
    branch=$(git rev-parse --abbrev-ref HEAD)
    warn "the code is already the new version. To deploy $from, the one before it: git checkout $from && bash deploy/deploy.sh"
    warn "and once the new version is fixed: git checkout $branch && bash deploy/deploy.sh"
  fi
}

# pm2 save rewrites the list of apps that pm2 brings back after a reboot from the ones it runs now. On a
# pm2 started afresh without the other apps on this server (pm2 kill, or a reboot before pm2 resurrect),
# saving would drop them from that list, so it is left to whoever brings them back.
save_pm2_list() {
  local missing
  if ! missing=$(pm2 jlist | node -e '
    const fs = require("fs"), os = require("os"), path = require("path");
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      try {
        // pm2 can print a notice before the JSON
        const running = new Set(JSON.parse(s.slice(s.search(/^\[(\{|\])/m))).map((p) => p.name));
        let saved = [];
        try {
          saved = JSON.parse(fs.readFileSync(path.join(process.env.PM2_HOME || path.join(os.homedir(), ".pm2"), "dump.pm2"), "utf8"));
        } catch (e) {
          if (e.code !== "ENOENT") throw e; // ENOENT: nothing saved yet
        }
        console.log([...new Set(saved.map((p) => p.name))].filter((name) => !running.has(name)).join(", "));
      } catch (e) {
        // not the message of a JSON error, which quotes the JSON: every app'"'"'s environment is in it
        console.error(e instanceof SyntaxError ? "pm2 jlist or dump.pm2 is not valid JSON" : e.message);
        process.exit(1);
      }
    });'); then
    warn "pm2 save skipped: could not compare the apps pm2 runs with the ones it has saved. Check pm2 list, then run pm2 save"
    return 1
  fi
  if [ -n "$missing" ]; then
    warn "pm2 save skipped: saving now would drop $missing from the apps pm2 brings back after a reboot. Bring them back (pm2 resurrect), check pm2 list, then run pm2 save"
    return 1
  fi
  pm2 save
}

# on one line, so bash never reads past it after `git pull` has rewritten the file
main "$@"; exit
