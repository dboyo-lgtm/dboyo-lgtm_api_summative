// Cities we compare

const CITIES = [
    ["Kigali", "Rwanda", -1.9441, 30.0619], ["Nairobi", "Kenya", -1.2921, 36.8219],
    ["Lagos", "Nigeria", 6.5244, 3.3792], ["Cairo", "Egypt", 30.044, 31.2357],
    ["Cape Town", "South Africa", -33.9249, 18.4241], ["Paris", "France", 48.8566, 2.3522],
    ["London", "UK", 51.5074, -0.1278], ["Oslo", "Norway", 59.9139, 10.7522],
    ["Tromso", "Norway", 69.6492, 18.9553], ["Reykjavik", "Iceland", 64.1466, -21.9426],
    ["Moscow", "Russia", 55.7558, 37.6173], ["Dubai", "UAE", 25.2048, 55.2708],
    ["Singapore", "Singapore", 1.3521, 103.8198], ["Tokyo", "Japan", 35.6762, 139.6503],
    ["Sydney", "Australia", -33.8688, 151.2093], ["New York", "USA", 40.7128, -74.006],
    ["Rio de Janeiro", "Brazil", -22.9068, -43.1729], ["Buenos Aires", "Argentina", -34.6037, -58.3816],
    ["Ushuaia", "Argentina", -54.8019, -68.303]
].map(([name, country, lat, lng,]) => ({ name, country, lat, lng, hemisphere: lat >= 0 ? "north" : "south"}));

const API_URL = "https://api.sunrise-sunset.org/v2";
const ERRORS = {
    network: "Could not reach the Sunrise-Sunset API. Check your internet connection.",
    timeout: "The Sunrise-Sunset API is too slow right now. Please try again.",
    busy: "The Sunrise-Sunset API is busy. Wait a minute, then click Retry",
    invalid: "Sunrise-Sunset API sent data we could not read",
    server: "The Sunrise-Sunset API is having problems. Please try again later."
};

let cityResults = [];
const cache = {};

const $ = (id) => document.getElementById(id);
const [dateInput, searchInput, hemisphereSelect, sortSelect, message, summary, cityGrid, retryButton] = 
["date-input","search-input", "hemisphere-select", "sort-select", "message", "summary", "city-grid", "retry-button"].map($);

//Helpers
const formatDuration = (s) => (s == null ? "Unknown" : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`);
// "2026-11-24T05:39:51+2:00" -> "05:39" (city's local time)
const formatTime = (iso) => (iso ? iso.slice(11, 16) : "-");
// Seconds between two times, e.g. first light -> last light
const secondsBetween = (a, b) => (a && b ? (Date.parse(b) - Date.parse(a)) / 1000 : null);
// Makes text safe to put in HTML (protects against XSS)
const escapeHTML = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
// Seconds between two times, e.g. first light -> last light

function showMessage(text = "", isError = false) {
  message.textContent = text;
  message.className = isError ? "message error" : "message";
}

// Call the API for one city (10-seconds timeout)
async function fetchCity(city, date) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    let response, data;

    try {
        response = await fetch (`${API_URL}?lat=${city.lat}&lng=${city.lng}&date=${date}`, { signal:
   controller.signal 
        });
    } catch (error) {
        throw error.name === "AbortError" ? "timeout" : "network";
    }finally {
        clearTimeout(timer);
    }

    if (response.status === 429) throw "busy";
    if (!response.ok) throw "server";

    try { data = await response.json(); } catch { throw "invalid"; }
    const info = data.results || data;
    if (!info || !("day_length" in info)) throw "invalid";
    return info;
}

//load all cities for the chosen date
async function loadData() {
    const date = dateInput.value;
    if (!date) return showMessage("Please choose a date.", true);
    if (cache[date]) { cityResults = cache[date]; showMessage(); return render();}

    dateInput.disabled = true;
    retryButton.hidden = true;
    let lastError = null;
    const results = [];

    //One city at a time don't overload the API
    for (const [i, city] of CITIES.entries()) {
        if (lastError === "busy") { results.push({ ...city, ok: false }); continue;}

        showMessage(`Loading ${i + 1} of ${CITIES.length}: ${city.name}...`);
        try {
            const info = await fetchCity(city, date);
            results.push({
                ...city, ok: true,
                sunrise: info.sunrise, sunset: info.sunset, dayLength: info.day_length, status:
        info.sun_status,
                firstLight: info.first_light, lastLight: info.last_light,
                usableLight: secondsBetween(info.first_light, info.last_light)
            });
        } catch (error) {
            lastError = typeof error === "string" ? error : "invalid";
            results.push({ ...city, ok: false });
        }
    }

    dateInput.disabled = false;
    const failed = results.filter((c) => !c.ok).length;

    if (failed === 0) { cache[date] = results; showMessage(); }
    else if (failed === CITIES.length) showMessage(ERRORS[lastError], true);
    else showMessage(`${failed} of ${CITIES.length} cities could not be loaded. ${ERRORS[lastError]}`, true);

    retryButton.hidden = failed === 0;
    cityResults = failed === CITIES.length ? [] : results;
    render();

}

// Sorting 
const SORTS = {
    longest: (a,b) => (b.dayLength ?? -1) - (a.dayLength ?? -1),
    shortest: (a, b) => (a.dayLength ?? -1) - (b.dayLength ?? -1),
    usable: (a, b) => (b.usableLight ?? -1) - (a.usableLight ?? -1),
    sunrise: (a, b) => formatTime(a.sunrise).localeCompare(formatTime(b.sunrise)),
    name: (a,b) => a.name.localeCompare(b.name)
};
const compareCities = (a, b) => (a.ok !== b.ok ? (a.ok ? -1 : 1) : SORTS[sortSelect.value](a, b));

//One city card
function cardHTML(c) {
    const title = `<h2>${escapeHTML(c.name)}</h2>`;
    if (!c.ok) return `<article class="card unavailable">${title}<p class="country">${escapeHTML(c.country)}</p><p class="status">Data unavailable right now.</p></article>`;

    const percent = Math.round(((c.dayLength || 0) /86400) * 100);
    const status = {midnight_sun: "☀️ the sun never sets today.", polar_night: " 🌑Polar night: the sun never rises today"}[c.status];
    
    return `<article class="card">${title}
      <p class="country">${escapeHTML(c.country)} · ${c.hemisphere === "north" ? "Northern" : "Southern"} hemisphere</p>
      <p class="day-length">${formatDuration(c.dayLength)}</p>
      <div class="bar"><div class="bar-fill" style="width:${percent}%"></div></div>
      <div class="times"><span>🌅 Sunrise ${escapeHTML(formatTime(c.sunrise))}</span><span>
      🌇 Sunset ${escapeHTML(formatTime(c.sunset))}</span></div></div>
      <p class="usable">🔆 Usable light: <strong>${formatDuration(c.usableLight)}</strong><br>
      <small>First light ${escapeHTML(formatTime(c.firstLight))} · Last light
      ${escapeHTML(formatTime(c.lastLight))}</small></p>
      ${status ? `<p class="status">${status}</p>` : ""}
      </article>`;
}

// Show cities after search, filter and sort
function render() {
    const search = searchInput.value.trim().toLowerCase();
    const visible = cityResults
     .filter((c) =>  `${c.name} ${c.country}`.toLowerCase().includes(search))
     .filter((c) => hemisphereSelect.value === "all" || c.hemisphere === hemisphereSelect.value)
     .sort(compareCities);

    // Summary: longest vs shortest
    const withData = visible.filter((c) => c.ok && c.dayLength != null).sort(SORTS.longest);
    const [longest, shortest] = [withData[0], withData[withData.length - 1]];
    summary.textContent = withData.length < 2 ? "":

       `Longest day: ${longest.name} (${formatDuration(longest.dayLength)}) · Shortest day: 
       ${shortest.name} (${formatDuration(shortest.dayLength)}) · Difference:
       ${formatDuration(longest.dayLength - shortest.dayLength)}`;

    cityGrid.innerHTML = visible.length === 0 && cityResults.length > 0
      ? '<p class="empty">No city matches your search.</p>'
      : visible.map(cardHTML).join("");
     
}

// Connect the controls
dateInput.addEventListener("change", loadData);
retryButton.addEventListener("click", loadData);
[searchInput, hemisphereSelect, sortSelect].forEach((el) => el.addEventListener("input", render));

dateInput.value = new Date().toISOString().slice(0, 10);
loadData()