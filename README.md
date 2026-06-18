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
sudo npx playwright@latest install-deps firefox
sudo apt-get install -y xvfb
```

Hardening notes (the repo is public):

- **Register the runner at the repository level** and label it `vo-films-runner`.
  Org-level runners from another organisation cannot be shared to this
  personal-account repo.
- This workflow only triggers on `schedule` / `workflow_dispatch` (never
  `pull_request`), so fork PRs cannot execute code on the runner. Keep it that
  way — protect `main` so trigger changes are reviewed, and enable "Require
  approval for all external contributors" under Settings → Actions.
