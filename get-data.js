const cheerio = require("cheerio");
// Camoufox is a hardened Firefox build with deep anti-fingerprinting. Using a
// non-Chromium engine sidesteps the Cloudflare automation detection that none
// of our Chromium-based attempts (stealth plugin, patchright) could clear -
// that detection is what made the Turnstile checkbox loop endlessly.
const { Camoufox } = require("camoufox-js");
const { addDays, format } = require("date-fns");
const staticData = require("./data.json");

const CLOUDFLARE_TIMEOUT_MS = 30000;

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

async function getPageWithPlaywright(url) {
  const context = await getContext();
  const page = await context.newPage();
  try {
    await page.goto(url);
    await page.waitForLoadState();
    await waitForCloudflare(page);
    return await page.content();
  } finally {
    await page.close();
  }
}

async function getPage(url) {
  const data = await getPageWithPlaywright(url);
  return cheerio.load(data);
}

async function getVenues(url) {
  const $ = await getPage(url);

  const venues = [];
  $(".list_cities a").each(function () {
    const url = $(this).attr("href");
    const [, id] = url.match(
      /https:\/\/www.cinefil.com\/cinema\/([^/]+)\/programmation/,
    );
    const value = $(this).text().trim();
    const match = value.match(/^([^(]+)\s+\(([^)]+)\)$/);
    let name = value;
    let location = "Limoux";
    if (match) [, name, location] = match;
    venues.push({ id, name, location, url });
  });

  if (venues.length === 0) {
    throw new Error(
      `No venues found at ${url} - the page may be blocked or its structure may have changed`,
    );
  }

  return venues;
}

function getShowingFor($showingEl, $movieEl) {
  const $tabPane = $showingEl.parents(".tab-pane");
  const index = $tabPane.parent().find(".tab-pane").index($tabPane);
  const date = format(addDays(new Date(), index), "yyyy-MM-dd");
  const time = $showingEl.parents("button").find(".seance-time").text().trim();
  const title = $movieEl.find('meta[itemprop="name"]').attr("content");
  const id = $movieEl.children("span").attr("id");
  return { id, title, date, time };
}

async function getShowings({ url }) {
  const $ = await getPage(url);
  const $seances = $(".seance-langue");
  const showings = [];
  $seances.each(function (index) {
    if ($(this).text().trim().toLowerCase() === "vo") {
      const showing = getShowingFor($(this), $(this).parents("li"), index);
      if (Date.now() < new Date(`${showing.date}T${showing.time}`)) {
        showings.push(showing);
      }
    }
  });
  return {
    // Total seance elements (any language) tells us the page loaded real
    // programmation data, distinguishing a genuine "no VO" day from a blocked
    // or structurally-changed page that yields nothing at all.
    seanceCount: $seances.length,
    showings: showings.sort(
      (a, b) => new Date(`${a.date}T${a.time}`) - new Date(`${b.date}T${b.time}`),
    ),
  };
}

async function main(url) {
  try {
    const venues = await getVenues(url);
    const venueShowings = [];
    let totalSeances = 0;
    for (venue of venues) {
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
