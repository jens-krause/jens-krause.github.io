(() => {
  const LANG = document.documentElement.lang === 'en' ? 'en' : 'de';
  const T = {
    de: {
      empty: 'Noch keine Touren hochgeladen.',
      mapEmpty: 'Noch keine Kartenausschnitte verfügbar.',
      km: 'km',
      hm: 'Hm',
      zoomIn: 'Reinzoomen',
      zoomOut: 'Rauszoomen',
      reset: 'Ansicht zurücksetzen',
      gpx: 'GPX',
    },
    en: {
      empty: 'No tours uploaded yet.',
      mapEmpty: 'No map tiles available yet.',
      km: 'km',
      hm: 'm gain',
      zoomIn: 'Zoom in',
      zoomOut: 'Zoom out',
      reset: 'Reset view',
      gpx: 'GPX',
    },
  }[LANG];

  const STAR_PATH = 'm12 3 2.7 5.5 6 .9-4.35 4.25 1.03 6-5.38-2.83L6.62 19.65l1.03-6L3.3 9.4l6-.9L12 3Z';

  function formatInt(n) {
    return n.toLocaleString(LANG === 'de' ? 'de-DE' : 'en-US');
  }

  function starSvg(filled) {
    return `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="${filled ? 'is-filled' : ''}"><path d="${STAR_PATH}" /></svg>`;
  }

  function renderStars(rating) {
    let out = '';
    for (let i = 0; i < 3; i++) out += starSvg(i < rating);
    return `<div class="tour-card-stars" role="img" aria-label="${rating}/3">${out}</div>`;
  }

  let map = null;
  let trackLayer = null;
  let startMarker = null;
  let endMarker = null;
  // Tiles only exist for 3 specific zoom levels per tour (see
  // scripts/build_tiles.py). Free scroll/pinch/double-click zoom would let
  // the map drift to a level with no tiles in the pool, so those gestures
  // are disabled and the +/- buttons step through this array instead.
  let zoomLevels = [];
  let zoomIndex = 0;

  function initMap() {
    map = L.map('tour-map', {
      zoomControl: false,
      minZoom: 6,
      maxZoom: 14,
      zoomSnap: 0,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
    });
    L.tileLayer('tiles/{z}/{x}/{y}.png', {
      minZoom: 6,
      maxZoom: 14,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(map);

    document.getElementById('tour-zoom-in').addEventListener('click', () => {
      if (zoomIndex < zoomLevels.length - 1) {
        zoomIndex++;
        map.setZoom(zoomLevels[zoomIndex]);
      }
    });
    document.getElementById('tour-zoom-out').addEventListener('click', () => {
      if (zoomIndex > 0) {
        zoomIndex--;
        map.setZoom(zoomLevels[zoomIndex]);
      }
    });
    document.getElementById('tour-zoom-reset').addEventListener('click', () => {
      if (trackLayer) focusTrack(trackLayer);
    });
  }

  function focusTrack(layer) {
    // Deliberately not fitBounds(): its continuous "ideal" zoom would then
    // need snapping to the nearest of our 3 fixed levels, and that snap
    // point can land right on a boundary - re-focusing the same, already
    // stable track could round to a different neighbour on each call.
    // zoomLevels is sorted ascending and the overview level (see
    // build_tiles.py) is always its lowest entry, so index 0 is always
    // "the whole track, zoomed out" - just go there directly.
    const bounds = layer.getBounds();
    zoomIndex = 0;
    map.setView(bounds.getCenter(), zoomLevels[zoomIndex]);
    map.setMaxBounds(bounds.pad(0.5));
  }

  async function selectTour(tour, cardEl) {
    document.querySelectorAll('.tour-card').forEach((c) => c.classList.remove('is-active'));
    if (cardEl) cardEl.classList.add('is-active');

    const dl = document.getElementById('tour-download');
    dl.href = tour.gpx;
    dl.setAttribute('download', '');
    dl.removeAttribute('aria-disabled');

    const res = await fetch(tour.geo);
    const points = await res.json();
    const latlngs = points.map((p) => [p[0], p[1]]);
    if (!latlngs.length) return;

    if (trackLayer) map.removeLayer(trackLayer);
    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);

    zoomLevels = tour.zoom_levels && tour.zoom_levels.length ? tour.zoom_levels : [12, 14];
    map.setMaxBounds(null);

    trackLayer = L.polyline(latlngs, { color: '#52109e', weight: 4, opacity: 0.92 }).addTo(map);
    startMarker = L.circleMarker(latlngs[0], { radius: 6, color: '#fff', weight: 2, fillColor: '#2ce086', fillOpacity: 1 }).addTo(map);
    endMarker = L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#3838e6', fillOpacity: 1 }).addTo(map);

    focusTrack(trackLayer);
  }

  function renderList(tours) {
    const list = document.getElementById('tour-list');
    if (!tours.length) {
      list.innerHTML = `<div class="tour-empty">${T.empty}</div>`;
      return;
    }
    list.innerHTML = '';
    tours.forEach((tour, i) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tour-card';
      card.innerHTML = `
        <h3 class="tour-card-title">${tour.title}</h3>
        <div class="tour-card-row">
          <div class="tour-card-stats">
            <span>${tour.distance_km} ${T.km}</span>
            <span>${formatInt(tour.elevation_gain_m)} ${T.hm}</span>
          </div>
          ${renderStars(tour.stars)}
        </div>
      `;
      card.addEventListener('click', () => selectTour(tour, card));
      list.appendChild(card);
      if (i === 0) requestAnimationFrame(() => selectTour(tour, card));
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const zoomInBtn = document.getElementById('tour-zoom-in');
    const zoomOutBtn = document.getElementById('tour-zoom-out');
    const resetBtn = document.getElementById('tour-zoom-reset');
    if (zoomInBtn) zoomInBtn.setAttribute('aria-label', T.zoomIn);
    if (zoomOutBtn) zoomOutBtn.setAttribute('aria-label', T.zoomOut);
    if (resetBtn) resetBtn.setAttribute('aria-label', T.reset);

    const mapEmptyEl = document.getElementById('tour-map-empty');
    if (mapEmptyEl) mapEmptyEl.textContent = T.mapEmpty;

    let tours = [];
    try {
      const res = await fetch('data/tours.json');
      const data = await res.json();
      tours = data.tours || [];
    } catch (err) {
      tours = [];
    }

    renderList(tours);

    const wrap = document.getElementById('tour-map-wrap');
    if (tours.length) {
      initMap();
    } else if (wrap) {
      wrap.classList.add('is-empty');
    }
  });
})();
