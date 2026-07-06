# vo-films-near-limoux

Scrapes [Cinefil](https://www.cinefil.com/seances-cinema/limoux-11) for
_version originale_ film showings near Limoux and publishes them as a static
site via GitHub Pages. Built nightly by [`.github/workflows/build-site.yml`](.github/workflows/build-site.yml).

## Scraping & Cloudflare

The Cinefil pages are behind a Cloudflare managed challenge (Turnstile). The
scrape uses [Camoufox](https://camoufox.com/) (a hardened, anti-fingerprint
Firefox build) via `camoufox-js`, which clears the challenge where Chromium-based
automation could not. `get-data.js` detects the challenge and waits for it to
clear, and fails loudly (rather than publishing a blank page) if it can't or if
no showings are found.

Cloudflare also flags GitHub-hosted (datacenter) IPs, so the **build job runs on
a self-hosted runner** on a residential IP. Deployment stays on a GitHub-hosted
runner so the Pages credentials never touch the self-hosted machine.

## Local development

```bash
npm ci
npx camoufox-js fetch   # one-time: downloads the Camoufox browser (~311MB)
npm run build           # writes ./site/index.html (opens a visible browser)
```

## Self-hosted runner setup

The build job targets a runner labelled `self-hosted` + `vo-films-runner`. The
workflow intentionally does **not** install system packages at runtime (so the
nightly run never mutates the host with `sudo`), so pre-install these once when
provisioning the runner (Debian/Ubuntu):

```bash
# Firefox system libraries (Camoufox is Firefox-based) + Xvfb for the
# headless: "virtual" display the scrape uses in CI.
npx playwright@latest install-deps firefox
sudo apt-get install -y xvfb
```

### Pinning the Camoufox browser

`camoufox-js fetch` auto-installs the newest Camoufox GitHub release **including
prereleases**, and broken alpha builds have shipped (e.g. an arm64 package that
extracts to fonts/config with no browser binary), which silently breaks the
nightly run. So the browser is **pinned**: provision a known-good build by hand.

`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` makes camoufox-js skip *all* downloads
(browser, GeoIP db, and addons), so we can't use `fetch` to top up the data
files — we provision what a launch needs directly. A launch needs exactly three
things in `~/.cache/camoufox`: the browser binary (`camoufox-bin`), `version.json`
(metadata camoufox-js reads at launch), and `GeoLite2-City.mmdb` (required
because we launch with `geoip: true`). Addons are optional and skipped by the flag.

```bash
# Pick a known-good, non-prerelease release + matching arch asset from
# https://github.com/daijro/camoufox/releases (avoid alpha/prerelease builds).
CFDIR=~/.cache/camoufox
cd /tmp
curl -L -o camoufox.zip \
  https://github.com/daijro/camoufox/releases/download/v150.0.2-beta.25/camoufox-150.0.2-alpha.25-lin.arm64.zip
rm -rf "$CFDIR" && mkdir -p "$CFDIR"
unzip -q camoufox.zip -d "$CFDIR"
# version.json = the "<version>-<release>" parsed from the asset name, i.e.
# camoufox-<version>-<release>-lin.arm64.zip -> here version=150.0.2 release=alpha.25
printf '{"version":"150.0.2","release":"alpha.25"}' > "$CFDIR/version.json"
curl -L -o "$CFDIR/GeoLite2-City.mmdb" \
  https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb
test -f "$CFDIR/camoufox-bin" && test -f "$CFDIR/version.json" \
  && test -f "$CFDIR/GeoLite2-City.mmdb" && echo COMPLETE || echo INCOMPLETE
```

Persist the pin so nightly runs never auto-upgrade: add
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` to the runner's environment
(`~/actions-runner/.env`) — the workflow also sets it at the job level. To move
to a newer browser later, re-run the steps above with a newer known-good release
URL (update the `version.json` values to match the new asset name).

Hardening notes (the repo is public):

- **Register the runner at the repository level** and label it `vo-films-runner`.
  Org-level runners from another organisation cannot be shared to this
  personal-account repo.
- This workflow only triggers on `schedule` / `workflow_dispatch` (never
  `pull_request`), so fork PRs cannot execute code on the runner. Keep it that
  way — protect `main` so trigger changes are reviewed, and enable "Require
  approval for all external contributors" under Settings → Actions.
