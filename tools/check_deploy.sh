#!/bin/sh
# Deploy check for hadiabid.com. Run before every push: sh tools/check_deploy.sh
# Fails if the Cloudflare build would fail or would publish something it shouldn't.
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
for f in .assetsignore wrangler.jsonc package.json; do [ -f "$f" ] || { echo "MISSING $f"; fail=1; }; done
grep -qx '\.git' .assetsignore || { echo ".assetsignore must list .git"; fail=1; }
# Cloudflare Workers assets: 25 MiB per file
big=$(git ls-files | while IFS= read -r f; do [ -f "$f" ] && s=$(wc -c < "$f") && [ "$s" -gt 26214400 ] && echo "$f $s"; done)
[ -n "$big" ] && { echo "FILES OVER 25 MiB:"; echo "$big"; fail=1; }
# CSP rule: no inline <script> blocks or on*= handlers in tracked HTML
bad=$(git ls-files '*.html' | xargs grep -lE '<script>|\son[a-z]+="' 2>/dev/null)
[ -n "$bad" ] && { echo "INLINE SCRIPT/HANDLER in: $bad"; fail=1; }
# Private files must never be tracked
for p in ai.html css/sera-graph.css js/sera-graph.js; do
  git ls-files --error-unmatch "$p" >/dev/null 2>&1 && { echo "PRIVATE FILE TRACKED: $p"; fail=1; }
done
# Real build check on a clean copy of the committed tree
tmp=$(mktemp -d); git archive HEAD | tar -x -C "$tmp"
(cd "$tmp" && npx -y wrangler@4.154.0 deploy --dry-run > "$tmp/../wrangler_check.log" 2>&1) \
  || { echo "WRANGLER DRY-RUN FAILED:"; tail -15 "$tmp/../wrangler_check.log"; fail=1; }
rm -rf "$tmp"
[ $fail -eq 0 ] && echo "deploy check OK" || echo "deploy check FAILED: do not push"
exit $fail
