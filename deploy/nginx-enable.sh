#!/usr/bin/env bash
# Adds deploy/nginx-icebreaker.conf to a shared nginx site, then reloads nginx. Needs root:
#
#   sudo bash deploy/nginx-enable.sh [locations-snippet]
#
# The snippet is the file of location blocks that the site's server { } block includes
# (default /etc/nginx/snippets/apps-locations.conf). The include goes after the last other
# `include .../deploy/nginx-*.conf;` line, or at the end. Running it again changes nothing.
# If `nginx -t` fails, the snippet is put back as it was and nginx is not reloaded.
set -euo pipefail

main() {
  local snippet=${1:-/etc/nginx/snippets/apps-locations.conf}
  local conf line backup n tmp
  conf="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/nginx-icebreaker.conf"
  # quoted, for a checkout under a path with spaces; nginx would still read * ? [ as a wildcard
  case $conf in
    *[\"\\*?[]* | *$'\n'*) die "$conf: move the checkout to a path without \" \\ * ? [ or a line break" ;;
  esac
  line="include \"$conf\";"

  [ "$(id -u)" -eq 0 ] || die "run it with sudo"
  [ -f "$snippet" ] || die "$snippet not found"
  [ -f "$conf" ] || die "$conf not found"

  # an uncommented include of this file, quoted or not, also in a CRLF file or before a comment
  if conf=$conf awk '
    { sub(/\r$/, ""); sub(/;[ \t]*#.*$/, ";"); sub(/^[ \t]+/, ""); sub(/[ \t]+$/, "") }
    /^include[ \t].*;$/ {
      arg = substr($0, 8); sub(/;$/, "", arg); gsub(/^[ \t]+|[ \t]+$/, "", arg)
      if (arg ~ /^".*"$/) arg = substr(arg, 2, length(arg) - 2)
      if (arg == ENVIRON["conf"]) found = 1
    }
    END { exit !found }' "$snippet"; then
    echo "$snippet already includes $conf"
  else
    backup="$snippet.bak-icebreaker-$(date +%Y%m%d-%H%M%S)"
    cp -p "$snippet" "$backup"
    echo "backup: $backup"

    n=$(grep -n -E '^[[:space:]]*include[[:space:]]+[^;]*/deploy/nginx-[^;]*;' "$snippet" | tail -n 1 | cut -d: -f1 || true)
    tmp=$(mktemp)
    # awk ends every line it prints with a newline, so the include never joins a last line that has
    # none, and it gets the CR of the line before it in a CRLF file
    n=${n:-0} add=$line awk '
      function eol(s) { return s ~ /\r$/ ? "\r" : "" }
      BEGIN { n = ENVIRON["n"] + 0; add = ENVIRON["add"] }
      { print; last = $0 }
      NR == n { indent = $0; sub(/[^ \t].*$/, "", indent); print indent add eol($0) }
      END { if (!n) print add eol(last) }' "$snippet" >"$tmp"
    # write in place, so the snippet keeps its owner, mode and inode
    cat "$tmp" >"$snippet"
    rm -f "$tmp"
    echo "added to $snippet:"
    grep -n -F "$line" "$snippet"
  fi

  if ! nginx -t; then
    [ -n "${backup:-}" ] && cat "$backup" >"$snippet" && echo "nginx -t failed: $snippet restored from $backup" >&2
    exit 1
  fi
  systemctl reload nginx
  echo "nginx reloaded: /icebreaker is live"
}

die() {
  printf 'nginx-enable: %s\n' "$*" >&2
  exit 1
}

main "$@"; exit
