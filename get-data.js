const cheerio = require("cheerio");
// Camoufox is a hardened Firefox build with deep anti-fingerprinting. Using a
// non-Chromium engine sidesteps the Cloudflare automation detection that none
// of our Chromium-based attempts (stealth plugin, patchright) could clear -
// that detection is what made the Turnstile checkbox loop endlessly.
// (camoufox-js is ESM-only; requires Node >=22.12 / 24 to require() it - see
// .node-version.)
const { Camoufox } = require("camoufox-js");
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

// The day bar at the top of the page is the only place each day's ISO date
// appears; the per-movie panes below carry just the weekday name. Build the
// name -> date map once per page. The window is seven days, so weekday names
// are unambiguous. (Other elements reuse the .dayselector class without a
// date - the "prochaine seance le Samedi" buttons - hence the attribute
// selector and the .jours-bar scope.)
function getDatesByDay($, url) {
  const datesByDay = new Map();
  $(".jours-bar .dayselector[data-day][data-date]").each(function () {
    datesByDay.set(
      $(this).attr("data-day").toLowerCase(),
      $(this).attr("data-date"),
    );
  });

  if (datesByDay.size === 0) {
    throw new Error(
      `No day/date bar found on ${url} - the page may be blocked or the HTML ` +
        `structure may have changed`,
    );
  }

  return datesByDay;
}

// A seance element we can find but can't read is always a bug, never a real
// state of the page - so treat any missing field as a structural change and
// throw. Without this, an unreadable field just yields an unparseable date, the
// showing silently fails the "is it in the future" filter, and we publish a page
// claiming there are no VO films at all.
function getShowingFor($showingEl, $movieEl, datesByDay, url) {
  // Each day's showings sit in a tab pane tagged only with the French weekday
  // name, e.g. "tab-pane lesseances Mardi" - the ISO date lives solely in the
  // day bar, hence the lookup. Matching on the name beats counting the pane's
  // position among its siblings, which silently skews if a day is ever omitted.
  const paneClasses = (
    $showingEl.closest(".tab-pane").attr("class") ?? ""
  ).split(/\s+/);
  const date = paneClasses
    .map((className) => datesByDay.get(className.toLowerCase()))
    .find(Boolean);
  // The showing is a single <li> holding both the time and the language.
  const time = $showingEl.closest("li").find(".seance-time").text().trim();
  const title = $movieEl.find('meta[itemprop="name"]').attr("content");
  const id = $movieEl.children("span").attr("id");
  const language = $showingEl.text().trim().toLowerCase();

  const showing = { id, title, date, time, language };
  const missing = Object.keys(showing).filter((key) => !showing[key]);
  const startsAt = new Date(`${date}T${time}`);
  if (missing.length > 0 || Number.isNaN(startsAt.getTime())) {
    throw new Error(
      `Could not read ${missing.length > 0 ? missing.join(", ") : "a valid date/time"} ` +
        `from a seance on ${url} - the HTML structure has likely changed.\n` +
        `Parsed: ${JSON.stringify(showing)}\n` +
        `Seance HTML: ${$showingEl.closest("li").toString()}`,
    );
  }

  return { ...showing, startsAt };
}

async function getShowings({ url }) {
  const $ = await getPage(url);
  const datesByDay = getDatesByDay($, url);
  const $seances = $(".seance-langue");
  // Parse every seance, not just the VO ones, so the checks in getShowingFor
  // still run on a day when nothing happens to be showing in VO.
  const seances = $seances
    .map((index, el) =>
      getShowingFor(
        $(el),
        $(el).closest("li[data-movie-slug]"),
        datesByDay,
        url,
      ),
    )
    .get();

  const showings = seances
    .filter(
      ({ language, startsAt }) => language === "vo" && Date.now() < startsAt,
    )
    .sort((a, b) => a.startsAt - b.startsAt)
    .map(({ id, title, date, time }) => ({ id, title, date, time }));

  return {
    // Total seance elements (any language) tells us the page loaded real
    // programmation data, distinguishing a genuine "no VO" day from a blocked
    // or structurally-changed page that yields nothing at all.
    seanceCount: $seances.length,
    showings,
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
