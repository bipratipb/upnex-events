/* =========================================================================
   LOCATION-AWARE BANNER — Time-Safe & Distance-Aware (FINAL)
   ========================================================================= */

(function (global) {
  const { DateTime } = luxon;

  let config = {
    size: "md",
    color: "#fff",
    linkColor: "#fff",
    bg: "transparent",
    fontFamily: "Inter, sans-serif",
    nearYouThreshold: 100,
    bufferHours: 6, // matches events.js buffer
  };

  let banner;

  global.initLocationBanner = function (userConfig = {}) {
    config = { ...config, ...userConfig };
    banner =
      document.getElementById("location-banner-container") || createBanner();

    applyStyles();
    init();
  };

  function createBanner() {
    const el = document.createElement("div");
    el.id = "location-banner-container";
    el.className = "location-banner-container";
    document.body.prepend(el);
    return el;
  }

  function applyStyles() {
    banner.style.background = config.bg;
    banner.style.color = config.color;
    banner.style.fontFamily = config.fontFamily;

    const sizeMap = { sm: "13px", md: "16px", lg: "18px" };
    banner.style.fontSize = sizeMap[config.size] || sizeMap.md;

    banner.querySelectorAll("a").forEach((a) => {
      a.style.color = config.linkColor;
    });
  }

  function setBanner(html) {
    banner.innerHTML = html;
    banner.querySelectorAll("a").forEach((a) => {
      a.style.color = config.linkColor;
    });
  }

  function init() {
    setBanner(
      `<a href=".optin">BE THE FIRST</a> TO KNOW WHEN A SHOW IS COMING TO YOUR CITY & OTHER ANNOUNCEMENTS!`
    );

    if (!navigator.geolocation) return noNearby();

    navigator.geolocation.getCurrentPosition(
      () => {
        setBanner("Checking for nearby shows...");
        document.addEventListener("eventsDataReady", handleEvents, {
          once: true,
        });
      },
      () => noNearby()
    );

    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" }).then((st) => {
        st.onchange = () => window.location.reload();
      });
    }

    document.addEventListener("click", (e) => {
      const a = e.target.closest("a");
      if (a?.getAttribute("href")?.startsWith(".")) {
        e.preventDefault();
        document
          .querySelector(a.getAttribute("href"))
          ?.scrollIntoView({ behavior: "smooth" });
      }
    });
  }

  /* ===================== CORE LOGIC ===================== */

  function handleEvents(e) {
    const events = e.detail?.events || [];
    const now = DateTime.utc();

    // 1. Filter ONLY valid upcoming / ongoing events
    const upcoming = events.filter((ev) => {
      if (!ev.status || ev.status.toLowerCase() !== "live") return false;

      const ts =
        ev.utcTimestamp ||
        ev.showtimes?.[0]?.utcTimestamp ||
        null;

      if (!ts && !ev.startDate) return false;

      const start = ts
        ? DateTime.fromISO(ts, { zone: "utc" })
        : DateTime.fromISO(
            `${ev.startDate}T${ev.startTime || "00:00"}`,
            { zone: "utc" }
          );

      const end = ev.endDate
        ? DateTime.fromISO(`${ev.endDate}T23:59:59`, { zone: "utc" })
        : start;

      return end.plus({ hours: config.bufferHours }) >= now;
    });

    // 2. Filter by distance
    const nearby = upcoming.filter(
      (x) =>
        typeof x.distance === "number" &&
        x.distance <= config.nearYouThreshold
    );

    if (!nearby.length) return noNearby();

    // 3. Sort by soonest event
    nearby.sort((a, b) => {
      const aTime =
        a.utcTimestamp ||
        a.showtimes?.[0]?.utcTimestamp ||
        `${a.startDate}T${a.startTime || "00:00"}Z`;
      const bTime =
        b.utcTimestamp ||
        b.showtimes?.[0]?.utcTimestamp ||
        `${b.startDate}T${b.startTime || "00:00"}Z`;
      return new Date(aTime) - new Date(bTime);
    });

    const { displayCity = "", displayState = "" } = nearby[0];
    const loc = displayState ? `${displayCity}, ${displayState}` : displayCity;

    setBanner(`UPCOMING SHOW ${loc} <a href=".tour">GET TICKETS</a>`);
  }

  function noNearby() {
    setBanner(
      `NO SHOWS NEARBY. <a href=".optin">REQUEST</a> A SHOW & BE THE FIRST TO KNOW`
    );
  }
})(window);
