(function (global) {
  const { DateTime } = luxon;

  let config = {
    locationId: "",
    eventPortalToken: "",
    waitlistFormId: "",
    soldOutFormId: "",
    nearYouThreshold: 100,
    textColor: "#605858",
    bottomBorderColor: "#000",
  };

  let globalEvents = [];
  let locationProcessed = false;

  let userLocationGlobal = { lat: null, lon: null };

  function esc(str = "") {
    return String(str).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  global.initEvents = function (userConfig = {}) {
    config = { ...config, ...userConfig };

    if (config.textColor) {
      document.documentElement.style.setProperty(
        "--events-text-color",
        config.textColor
      );
    }

    if (config.bottomBorderColor) {
      document.documentElement.style.setProperty(
        "--events-border-color",
        config.bottomBorderColor
      );
    }

    getData();
    attachBottomSheetDragHandlers();
  };

  async function getData() {
    const res = await fetchData();
    const events = res?.data?.events || [];
    globalEvents = events;
    await formatData(events, null);
    getUserLocationAsync();
  }

  async function fetchData() {
    const url = `https://events-portal-sage.vercel.app/api/events/${config.locationId}`;
    try {
      const r = await fetch(url, {
        headers: {
          Authorization: `Bearer ${config.eventPortalToken}`,
          Accept: "application/json",
        },
      });
      return await r.json();
    } catch {
      return { data: { events: [] } };
    }
  }

  async function getUserLocationAsync() {
    if (locationProcessed) return;
    locationProcessed = true;

    let userLoc = null;
    let eventsWithDist = globalEvents;

    try {
      userLoc = await getUserLocation();

      if (userLoc && !userLoc.permissionDenied) {
        userLocationGlobal = userLoc;

        eventsWithDist = globalEvents.map((ev) => {
          const lat = parseFloat(ev.latitude);
          const lon = parseFloat(ev.longitude);
          if (isFinite(lat) && isFinite(lon)) {
            return {
              ...ev,
              distance: calcDistance(
                userLoc.lat,
                userLoc.lon,
                lat,
                lon
              ),
            };
          }
          return { ...ev, distance: Infinity };
        });

        const nearby = eventsWithDist.filter(
          (e) => e.distance <= config.nearYouThreshold
        );
        const far = eventsWithDist.filter(
          (e) => e.distance > config.nearYouThreshold
        );

        nearby.sort((a, b) => getDateTime(a) - getDateTime(b));
        far.sort((a, b) => getDateTime(a) - getDateTime(b));

        await formatData([...nearby, ...far], userLoc);
      }
    } finally {
      document.dispatchEvent(
        new CustomEvent("eventsDataReady", {
          detail: { userLocation: userLoc, events: eventsWithDist },
        })
      );
    }
  }

  function getUserLocation() {
    if (!navigator.geolocation)
      return Promise.resolve({ permissionDenied: true });

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            permissionDenied: false,
          }),
        () => resolve({ permissionDenied: true }),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    });
  }

  /* ===================== TIME FILTER (UTC SAFE) ===================== */
  async function formatData(events, userLoc) {
    const now = DateTime.utc();
    const buffer = 6;

    const filtered = events.filter((e) => {
      if (!e.status || e.status.toLowerCase() !== "live") return false;

      const ts =
        e.utcTimestamp ||
        e.showtimes?.[0]?.utcTimestamp ||
        null;

      if (!ts && !e.startDate) return false;

      const start = ts
        ? DateTime.fromISO(ts, { zone: "utc" })
        : DateTime.fromISO(
            `${e.startDate}T${e.startTime || "00:00"}`,
            { zone: "utc" }
          );

      const end = e.endDate
        ? DateTime.fromISO(`${e.endDate}T23:59:59`, { zone: "utc" })
        : start;

      return end.plus({ hours: buffer }) >= now;
    });

    if (!userLoc) filtered.sort((a, b) => getDateTime(a) - getDateTime(b));
    displayEvents(filtered, userLoc);
  }

  function getDateTime(e) {
    const ts =
      e.utcTimestamp ||
      e.showtimes?.[0]?.utcTimestamp ||
      `${e.startDate}T${e.startTime || "00:00"}Z`;
    return new Date(ts);
  }

  function displayEvents(events, userLoc) {
    const container = document.getElementById("all-events");
    if (!container) return;

    let html = "";

    events.forEach((ev) => {
      const nearBadge =
        userLoc && ev.distance <= config.nearYouThreshold
          ? `<span class="badge-near-you">NEAR YOU</span>`
          : "";

      const venue = ev.displayVenue || "";
      const city = ev.displayCity || "";
      const title = ev.additionalInfo || "";
      const start = ev.startDate || "";
      const end = ev.endDate || "";

      let ticketsHTML = "";
      const groupedIds = new Set();

      (ev.ticketLinkGroups || []).forEach((g) => {
        g.showtimeIds.forEach((id) => groupedIds.add(id));
        ticketsHTML += `<div class="TicketP">${buildTicketButton({
          ticketLink: g.ticketLink,
          venue,
          labelDate: formatRange(g.showtimeDates),
        })}</div>`;
      });

      (ev.showtimes || [])
        .filter((s) => !groupedIds.has(s.id))
        .forEach((s) => {
          (s.ticketLinks || []).forEach((t) => {
            ticketsHTML += `<div class="TicketP">${buildTicketButton({
              ticketLink: t,
              venue,
              labelDate: fmtShort(s.date),
            })}</div>`;
          });
        });

      html += `
        <div class="event-card">
          <div class="event-info-column">
            <div class="date"><p>${
              end ? `${fmtShort(start)} - ${fmtLong(end)}` : fmtLong(start)
            } ${nearBadge}</p></div>
            <div class="details"><h3>${city}</h3></div>
            <div class="details">
              <p>${venue}</p>
              ${title ? `<p class="event-title">${title}</p>` : ""}
            </div>
          </div>
          <div class="tickets-list">${ticketsHTML}</div>
        </div>`;
    });

    container.innerHTML = html;
  }

  function buildTicketButton({ ticketLink: t, venue, labelDate }) {
    const color = t.buttonColor || "#000";
    const text = t.buttonText || "";

    if (t.linkType === "Join Waitlist" && t.ticketLink === "popup") {
      return `<a href="javascript:void(0)" class="tickets-info"
        style="background-color:${color}"
        onclick="joinWaitlistForm('${esc(venue)}','${esc(labelDate)}')">${text}</a>`;
    }

    if (t.linkType === "Sold Out" && t.ticketLink === "popup") {
      return `<a href="javascript:void(0)" class="tickets-info tickets-info-soldout"
        style="background-color:${color}"
        onclick="openSoldOutForm('${esc(venue)}','${esc(labelDate)}')">${text}</a>`;
    }

    return `<a href="${t.ticketLink}" class="tickets-info"
      style="background-color:${color}"
      target="_blank" rel="noopener noreferrer">${text}</a>`;
  }

  global.joinWaitlistForm = function (venue = "", date = "") {
    const overlay = document.getElementById("waitlistOverlay");
    const sheet = document.getElementById("waitlistBottomSheet");
    const iframe = sheet?.querySelector(".waitlist-form-container");
    if (!overlay || !sheet || !iframe || !config.waitlistFormId) return;

    const url = new URL(
      `https://api.leadconnectorhq.com/widget/form/${config.waitlistFormId}`
    );

    if (venue || date) url.searchParams.set("waitlist", `${venue} ${date}`.trim());

    if (
      typeof userLocationGlobal.lat === "number" &&
      typeof userLocationGlobal.lon === "number"
    ) {
      url.searchParams.set("latitude", userLocationGlobal.lat.toFixed(6));
      url.searchParams.set("longitude", userLocationGlobal.lon.toFixed(6));
    }

    iframe.src = url.toString();
    overlay.classList.add("active");
    sheet.classList.add("active");
    document.body.style.overflow = "hidden";

    const close = () => {
      overlay.classList.remove("active");
      sheet.classList.remove("active");
      document.body.style.overflow = "";
    };

    overlay.onclick = close;
    sheet.querySelector(".waitlist-close-btn").onclick = close;
  };

  global.openSoldOutForm = function (venue = "", date = "") {
    const overlay = document.getElementById("waitlistOverlay");
    const sheet = document.getElementById("waitlistBottomSheet");
    const iframe = sheet?.querySelector(".waitlist-form-container");
    if (!overlay || !sheet || !iframe || !config.soldOutFormId) return;

    const url = new URL(
      `https://api.leadconnectorhq.com/widget/form/${config.soldOutFormId}`
    );

    if (venue || date) url.searchParams.set("waitlist", `${venue} ${date}`.trim());

    if (
      typeof userLocationGlobal.lat === "number" &&
      typeof userLocationGlobal.lon === "number"
    ) {
      url.searchParams.set("latitude", userLocationGlobal.lat.toFixed(6));
      url.searchParams.set("longitude", userLocationGlobal.lon.toFixed(6));
    }

    iframe.src = url.toString();
    overlay.classList.add("active");
    sheet.classList.add("active");
    document.body.style.overflow = "hidden";

    const close = () => {
      overlay.classList.remove("active");
      sheet.classList.remove("active");
      document.body.style.overflow = "";
    };

    overlay.onclick = close;
    sheet.querySelector(".waitlist-close-btn").onclick = close;
  };

  function formatRange(dates) {
    if (!dates?.length) return "";
    const u = [...new Set(dates)].sort();
    return u.length === 1
      ? fmtLong(u[0])
      : `${fmtShort(u[0])} - ${fmtLong(u[u.length - 1])}`;
  }

  function fmtLong(d) {
    const [y, m, day] = d.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${parseInt(day,10)}, ${y}`;
  }

  function fmtShort(d) {
    const [, m, day] = d.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${parseInt(day,10)}`;
  }

  function calcDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }

  /* ===================== BOTTOM SHEET DRAG ===================== */
  function attachBottomSheetDragHandlers() {
    const init = () => {
      const sheet = document.getElementById("waitlistBottomSheet");
      const overlay = document.getElementById("waitlistOverlay");
      const header = sheet?.querySelector(".waitlist-bottom-sheet-header");
      if (!sheet || !overlay || !header) return;

      let dragging = false, startY = 0, currentY = 0;

      const move = (y) => {
        const delta = Math.max(0, y - startY);
        sheet.style.transform =
          window.innerWidth > 768
            ? `translateX(-50%) translateY(${delta}px)`
            : `translateY(${delta}px)`;
        overlay.style.opacity = Math.max(0.25, 1 - delta / window.innerHeight);
      };

      const end = () => {
        if (!dragging) return;
        dragging = false;
        const delta = Math.max(0, currentY - startY);
        const threshold = Math.min(150, sheet.offsetHeight * 0.33);

        if (delta > threshold) {
          overlay.classList.remove("active");
          sheet.classList.remove("active");
          document.body.style.overflow = "";
        } else {
          sheet.style.transform =
            window.innerWidth > 768
              ? "translateX(-50%) translateY(0)"
              : "translateY(0)";
          overlay.style.opacity = "1";
        }
      };

      header.addEventListener("mousedown", (e) => {
        dragging = true;
        startY = e.clientY;
        document.addEventListener("mousemove", (e) => {
          currentY = e.clientY;
          move(currentY);
        });
        document.addEventListener("mouseup", end, { once: true });
      });

      header.addEventListener("touchstart", (e) => {
        dragging = true;
        startY = e.touches[0].clientY;
      });

      header.addEventListener("touchmove", (e) => {
        currentY = e.touches[0].clientY;
        move(currentY);
      });

      header.addEventListener("touchend", end);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})(window);
