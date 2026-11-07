#!/usr/bin/env bash
# Puts the handful of lines that say what went wrong into the run itself: the red box at the top of the Actions
# tab, and the job's summary page.
#
# Why: the log of a browser check is tens of thousands of lines long and takes a login to read, so a failure at
# two in the morning is a red tick and nothing else. These notes are the first thing anyone sees, and they can
# be read without signing in at all.
#
#   bash .github/say-what-failed.sh "$RUNNER_TEMP"/e2e-*.log
set -u

found=0
for f in "$@"; do
  [ -f "$f" ] || continue
  found=1
  name=$(basename "$f" .log)
  # the harnesses' own words: a failed check, a batch that never finished, a scene that never came
  body=$(grep -E 'FAIL|did not finish|timed out|^[0-9]+ passed|dropped' "$f" | head -n 40)
  [ -z "$body" ] && body=$(tail -n 30 "$f")

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo "### $name"
      echo '```'
      echo "$body"
      echo '```'
    } >> "$GITHUB_STEP_SUMMARY"
  fi

  # an annotation is one line: % first, so the escapes that follow are not escaped again
  note=$(printf '%s' "$body" | head -c 4000 | sed 's/%/%25/g' | awk '{ printf "%s%%0A", $0 }')
  printf '::error title=%s::%s\n' "$name" "$note"
done

[ "$found" = 1 ] || echo 'no log to report on'
