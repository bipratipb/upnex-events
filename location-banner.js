/* =========================================================================
   LOCATION-AWARE BANNER — Configurable Widget (Final)
   ========================================================================= */

(function (global) {
  let config = {
    size: "md",
    color: "#fff",
    linkColor: "#fff",
    bg: "transparent",
    fontFamily: "Inter, sans-serif",
    nearYouThreshold: 100,
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

  function handleEvents(e) {
    const events = e.detail?.events || [];
    const nearby = events.filter(
      (x) =>
        typeof x.distance === "number" && x.distance <= config.nearYouThreshold
    );

    if (!nearby.length) return noNearby();

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
