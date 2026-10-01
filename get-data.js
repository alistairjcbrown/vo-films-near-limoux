const fs = require("fs");
const path = require("path");
// Camoufox is a hardened Firefox build with deep anti-fingerprinting. Using a
// non-Chromium engine sidesteps the Cloudflare automation detection that none
// of our Chromium-based attempts (stealth plugin, patchright) could clear -
// that detection is what made the Turnstile checkbox loop endlessly.
// (camoufox-js is ESM-only; requires Node >=22.12 / 24 to require() it - see
// .node-version.)
const { Camoufox } = require("camoufox-js");
const staticData = require("./data.json");
const {
  VENUES_SELECTOR,
  DAY_BAR_SELECTOR,
  parseVenues,
  parseSeances,
  upcomingVoShowings,
} = require("./parse");

const CLOUDFLARE_TIMEOUT_MS = 30000;
const CONTENT_TIMEOUT_MS = 30000;

// Every page we load is saved here (and uploaded as a CI artifact) so the real
// markup is on hand to debug and test against - the site sits behind
// Cloudflare, so it can't simply be fetched from elsewhere after the fact.
const SNAPSHOT_DIR = path.join(__dirname, "page-snapshots");

// Cloudflare's interstitial ("Just a moment...") and Turnstile widget render
// before the real page. Detect them so we can wait for the challenge to clear
// rather than scraping an empty challenge page.
async function isCloudflareChallenge(page) {
  return page.evaluate(() => {
    // window._cf_chl_opt is defined inline on every Cloudflare challenge page
    // and is locale-independent, unlike the "Just a moment..." title which is
    // translated (e.g. to French) and so can't be matched on reliably.
    if (window._cf_chl_opt) return true;
    return Boolean(
      document.querySelector(
        "#challenge-running, #challenge-stage, #challenge-error-text, " +
          ".cf-turnstile, " +
          'script[src*="/cdn-cgi/challenge-platform/"], ' +
          'iframe[src*="challenges.cloudflare.com"]',
      ),
    );
  });
}

async function waitForCloudflare(page) {
  if (!(await isCloudflareChallenge(page))) return;
  console.error("Cloudflare challenge detected, waiting for it to clear...");
  const deadline = Date.now() + CLOUDFLARE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    if (!(await isCloudflareChallenge(page))) {
      console.error("Cloudflare challenge cleared.");
      return;
    }
  }
  throw new Error(
    `Cloudflare challenge did not clear within ${CLOUDFLARE_TIMEOUT_MS}ms for ${page.url()}`,
  );
}

// A single Camoufox browser/context is shared across all page fetches so a
// cleared Cloudflare challenge (and its cookies) carries over between venues
// instead of being re-solved for each one.
let contextPromise;

function getContext() {
  if (!contextPromise) {
    contextPromise = (async () => {
      const browser = await Camoufox({
        // Locally show the real window; in CI (no display) use Camoufox's
        // built-in virtual display (Xvfb) - a real headed Firefox inside a
        // virtual framebuffer, which is far less detectable than true headless.
        headless: process.env.CI ? "virtual" : false,
        // Derive a self-consistent locale, timezone and geolocation from the
        // real outbound IP rather than forcing values that might mismatch it.
        geoip: true,
        // Human-like cursor movement helps clear interactive Turnstile widgets.
        humanize: true,
      });
      // viewport: null uses Camoufox's real window size; a pinned viewport both
      // leaks automation and is rejected by Camoufox's patched Firefox build.
      return browser.newContext({ viewport: null });
    })();
  }
  return contextPromise;
}

async function closeBrowser() {
  if (!contextPromise) return;
  const context = await contextPromise;
  contextPromise = undefined;
  await context.browser().close();
}

// Best-effort: a snapshot failing must never mask the scrape's own outcome.
async function savePageSnapshot(page, url) {
  try {
    const name = new URL(url).pathname
      .replace(/^\/|\/$/g, "")
      .replace(/\//g, "_");
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(SNAPSHOT_DIR, `${name || "index"}.html`),
      await page.content(),
    );
  } catch (error) {
    console.error(`Could not save a snapshot of ${url}: ${error.message}`);
  }
}

// Clearing the challenge navigates to the real page, which then streams in - so
// the instant the challenge markers vanish the document is typically still
// parsing (readyState "interactive", roughly half its final size). Snapshotting
// there yields a truncated page whose later sections simply aren't there yet,
// which reads exactly like the site having changed shape. Wait for a selector
// the caller actually needs - that also pins us to the right document, since a
// load state alone can be satisfied by the challenge page we're navigating away
// from - and only then for parsing to finish.
async function getPageWithPlaywright(url, readySelector) {
  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForLoadState();
    await waitForCloudflare(page);
    await page.waitForSelector(readySelector, {
      state: "attached",
      timeout: CONTENT_TIMEOUT_MS,
    });
    await page.waitForLoadState();
    return await page.content();
  } finally {
    // Runs on failure too, so a timed-out page (e.g. after a markup change, or
    // a Cloudflare challenge that never cleared) is captured as it was left.
    await savePageSnapshot(page, url);
    await page.close();
  }
}

async function getVenues(url) {
  return parseVenues(await getPageWithPlaywright(url, VENUES_SELECTOR), url);
}

async function getShowings({ url }) {
  const seances = parseSeances(
    await getPageWithPlaywright(url, DAY_BAR_SELECTOR),
    url,
  );
  return {
    // Total seances (any language) tells us the page loaded real programmation
    // data, distinguishing a genuine "no VO" day from a blocked or
    // structurally-changed page that yields nothing at all.
    seanceCount: seances.length,
    showings: upcomingVoShowings(seances),
  };
}

async function main(url) {
  // Start clean so the snapshots only ever reflect this run.
  fs.rmSync(SNAPSHOT_DIR, { recursive: true, force: true });
  try {
    const venues = await getVenues(url);
    const venueShowings = [];
    let totalSeances = 0;
    for (const venue of venues) {
      if (!staticData[venue.id]) {
        console.warn(
          `Venue "${venue.id}" (${venue.name}, ${venue.location}) has no entry ` +
            `in data.json, so it will have no distance or homepage - add one.`,
        );
      }
      const { showings, seanceCount } = await getShowings(venue);
      totalSeances += seanceCount;
      venueShowings.push({ ...venue, ...staticData[venue.id], showings });
    }
    if (totalSeances === 0) {
      throw new Error(
        `No showings of any language found across all ${venues.length} venue(s) - ` +
          `the pages may be blocked or the HTML structure may have changed`,
      );
    }
    return venueShowings.sort(
      (a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity),
    );
  } finally {
    await closeBrowser();
  }
}

module.exports = main;
