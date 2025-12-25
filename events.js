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

  // ✅ Store user location globally for form usage
  let userLocationGlobal = {
    lat: null,
    lon: null,
  };

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

  /* ---------- FETCH EVENTS ---------- */
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
    } catch (err) {
      console.error("Event fetch failed:", err);
      return { data: { events: [] } };
    }
  }

  /* ---------- GEOLOCATION ---------- */
  async function getUserLocationAsync() {
    if (locationProcessed) return;
    locationProcessed = true;

    let userLoc = null;
    let eventsWithDist = globalEvents;

    try {
      userLoc = await getUserLocation();

      if (userLoc && !userLoc.permissionDenied) {
        // ✅ Persist location globally
        userLocationGlobal.lat = userLoc.lat;
        userLocationGlobal.lon = userLoc.lon;

        eventsWithDist = globalEvents.map((ev) => {
          const lat = parseFloat(ev.latitude);
          const lon = parseFloat(ev.longitude);
          if (isFinite(lat) && isFinite(lon)) {
            const d = calcDistance(userLoc.lat, userLoc.lon, lat, lon);
            return { ...ev, distance: d };
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

        const ordered = [...nearby, ...far];
        await formatData(ordered, userLoc);
        eventsWithDist = ordered;
      }
    } catch (e) {
      console.warn("Location failed:", e);
    } finally {
      const detail = { userLocation: userLoc, events: eventsWithDist };
      document.dispatchEvent(new CustomEvent("eventsDataReady", { detail }));
    }
  }

  function getUserLocation() {
    if (!("geolocation" in navigator))
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
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    });
  }

  /* ---------- FORMAT + DISPLAY ---------- */
  async function formatData(events, userLoc) {
    const now = DateTime.utc();
    const buffer = 6;

    const filtered = events.filter((e) => {
      if (e.status !== "live" || !e.startDate) return false;
      const start = DateTime.fromISO(
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
        const range = formatRange(g.showtimeDates);
        const t = g.ticketLink;

        ticketsHTML += `<div class="TicketP">${buildTicketButton({
          ticketLink: t,
          venue,
          labelDate: range,
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
        onclick="joinWaitlistForm('${venue}','${labelDate}')">${text}</a>`;
    }

    if (t.linkType === "Sold Out" && t.ticketLink === "popup") {
      return `<a href="javascript:void(0)" class="tickets-info tickets-info-soldout"
        style="background-color:${color}"
        onclick="openSoldOutForm('${venue}','${labelDate}')">${text}</a>`;
    }

    return `<a href="${t.ticketLink}" class="tickets-info"
      style="background-color:${color}"
      target="_blank" rel="noopener noreferrer">${text}</a>`;
  }

  /* ---------- FORMS (UPDATED) ---------- */
  global.joinWaitlistForm = function (venue = "", date = "") {
    const overlay = document.getElementById("waitlistOverlay");
    const sheet = document.getElementById("waitlistBottomSheet");
    const iframe = sheet?.querySelector(".waitlist-form-container");
    if (!overlay || !sheet || !iframe || !config.waitlistFormId) return;

    const url = new URL(
      `https://api.leadconnectorhq.com/widget/form/${config.waitlistFormId}`
    );

    if (venue || date)
      url.searchParams.set("waitlist", `${venue} ${date}`.trim());

    if (userLocationGlobal.lat && userLocationGlobal.lon) {
      url.searchParams.set("latitude", userLocationGlobal.lat);
      url.searchParams.set("longitude", userLocationGlobal.lon);
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

    if (venue || date)
      url.searchParams.set("soldout", `${venue} ${date}`.trim());

    if (userLocationGlobal.lat && userLocationGlobal.lon) {
      url.searchParams.set("latitude", userLocationGlobal.lat);
      url.searchParams.set("longitude", userLocationGlobal.lon);
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

  /* ---------- HELPERS ---------- */
  function formatRange(dates) {
    if (!dates?.length) return "";
    const unique = Array.from(new Set(dates)).sort();
    if (unique.length === 1) return fmtLong(unique[0]);
    return `${fmtShort(unique[0])} - ${fmtLong(unique[unique.length - 1])}`;
  }

  function fmtLong(d) {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${parseInt(day,10)}, ${y}`;
  }

  function fmtShort(d) {
    if (!d) return "";
    const [, m, day] = d.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${parseInt(day,10)}`;
  }

  function getDateTime(e) {
    return new Date(`${e.startDate}T${e.startTime || "00:00"}`);
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

  /* ---------- BOTTOM SHEET DRAG (UNCHANGED) ---------- */
  function attachBottomSheetDragHandlers() {
    document.addEventListener("DOMContentLoaded", () => {
      const sheet = document.getElementById("waitlistBottomSheet");
      const overlay = document.getElementById("waitlistOverlay");
      const header = sheet?.querySelector(".waitlist-bottom-sheet-header");
      if (!sheet || !overlay || !header) return;

      let dragging = false,
        startY = 0,
        currentY = 0;

      const move = (y) => {
        const delta = Math.max(0, y - startY);
        sheet.style.transform =
          window.innerWidth > 768
            ? `translateX(-50%) translateY(${delta}px)`
            : `translateY(${delta}px)`;
        overlay.style.opacity = String(
          Math.max(0.25, 1 - delta / window.innerHeight)
        );
      };

      const end = () => {
        if (!dragging) return;
        dragging = false;
        const delta = Math.max(0, currentY - startY);
        const threshold = Math.min(150, sheet.offsetHeight * 0.33);

        sheet.style.transition = "transform .3s ease";
        overlay.style.transition = "opacity .25s ease";

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

        setTimeout(() => {
          sheet.style.transition = "";
          overlay.style.transition = "";
        }, 300);
      };

      header.addEventListener("mousedown", (e) => {
        dragging = true;
        startY = e.clientY;
        sheet.style.transition = "none";
        overlay.style.transition = "none";
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      });

      const onMouseMove = (e) => {
        currentY = e.clientY;
        if (dragging) move(currentY);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        end();
      };

      header.addEventListener("touchstart", (e) => {
        dragging = true;
        startY = e.touches[0].clientY;
        sheet.style.transition = "none";
        overlay.style.transition = "none";
      });

      header.addEventListener("touchmove", (e) => {
        currentY = e.touches[0].clientY;
        if (dragging) move(currentY);
      });

      header.addEventListener("touchend", end);
      header.addEventListener("touchcancel", end);
    });
  }
})(window);
