(function () {
  const form = document.getElementById('availability-form');
  const result = document.getElementById('result');
  const map = document.getElementById('map');
  const areaCount = document.getElementById('area-count');
  const themeToggle = document.getElementById('theme-toggle');
  const year = document.getElementById('copyright-year');
  const TILE_SIZE = 256;
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const defaultCopy = {
    loadingAreas: 'Loading areas...',
    activeArea: '{{count}} active area',
    activeAreas: '{{count}} active areas',
    miles: 'miles',
    availableHere: 'OxSteed Direct is available here',
    outsideCoverage: 'Outside current Direct coverage',
    checking: 'Checking coverage...',
    checkingBody: 'This usually takes just a moment.',
    requiredTitle: 'Enter a ZIP code or address',
    requiredBody: 'A location is required before we can check coverage.',
    unavailableTitle: 'Coverage map unavailable',
    unavailableBody: 'Please try again later.',
    checkFailed: 'Could not check that location',
    checkFailedBody: 'Please try a ZIP code.',
    distanceFrom: '{{location}} is about {{distance}} miles from {{area}}.',
    noAreas: 'No active Direct service areas are configured right now.',
  };
  let pageCopy = {};
  try {
    pageCopy = JSON.parse(document.querySelector('.page')?.dataset?.serviceAreaCopy || '{}');
  } catch (_) {
    pageCopy = {};
  }
  const copy = { ...defaultCopy, ...pageCopy };

  function format(value, replacements) {
    return String(value).replace(/{{(\w+)}}/g, (_, key) => replacements[key] ?? '');
  }

  function setResult(state, title, body) {
    result.className = `result ${state || ''}`.trim();
    result.replaceChildren();
    const titleEl = document.createElement('strong');
    const bodyEl = document.createElement('span');
    titleEl.textContent = title;
    bodyEl.textContent = body;
    result.append(titleEl, bodyEl);
  }

  function project(lat, lng, zoom) {
    const scale = TILE_SIZE * (2 ** zoom);
    const safeLat = Math.max(-85.0511, Math.min(85.0511, Number(lat)));
    const sin = Math.sin(safeLat * Math.PI / 180);
    return {
      x: ((Number(lng) + 180) / 360) * scale,
      y: (0.5 - (Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))) * scale,
    };
  }

  function getMapZoom(serviceAreas, width, height) {
    if (!serviceAreas.length) return 7;
    const points = serviceAreas.flatMap((area) => {
      const radius = Number(area.radiusMiles) || 0;
      const lat = Number(area.lat);
      const lng = Number(area.lng);
      const latDelta = radius / 69;
      const lngDelta = radius / (69 * Math.max(0.25, Math.cos(lat * Math.PI / 180)));
      return [[lat - latDelta, lng - lngDelta], [lat + latDelta, lng + lngDelta]];
    });
    for (let zoom = 12; zoom >= 3; zoom -= 1) {
      const projected = points.map(([lat, lng]) => project(lat, lng, zoom));
      const xRange = Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x));
      const yRange = Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y));
      if (xRange <= width * 0.78 && yRange <= height * 0.72) return zoom;
    }
    return 3;
  }

  function renderMap(serviceAreas) {
    map.innerHTML = '';
    areaCount.textContent = format(
      serviceAreas.length === 1 ? copy.activeArea : copy.activeAreas,
      { count: serviceAreas.length },
    );

    const width = map.clientWidth || 760;
    const height = map.clientHeight || 420;
    const fallback = { label: 'Springfield, OH', anchorZip: '45503', lat: 39.9528, lng: -83.7804, radiusMiles: 60 };
    const areas = serviceAreas.length ? serviceAreas : [fallback];
    const zoom = getMapZoom(areas, width, height);
    const projected = areas.map((area) => project(area.lat, area.lng, zoom));
    const center = projected.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    center.x /= projected.length;
    center.y /= projected.length;
    const origin = { x: center.x - width / 2, y: center.y - height / 2 };
    const tiles = document.createElement('div');
    tiles.className = 'map-tiles';
    const tileXStart = Math.floor(origin.x / TILE_SIZE) - 1;
    const tileXEnd = Math.ceil((origin.x + width) / TILE_SIZE) + 1;
    const tileYStart = Math.floor(origin.y / TILE_SIZE) - 1;
    const tileYEnd = Math.ceil((origin.y + height) / TILE_SIZE) + 1;
    const tileCount = 2 ** zoom;
    for (let tileX = tileXStart; tileX <= tileXEnd; tileX += 1) {
      for (let tileY = tileYStart; tileY <= tileYEnd; tileY += 1) {
        const image = document.createElement('img');
        image.className = 'map-tile';
        image.alt = '';
        image.loading = 'lazy';
        image.src = TILE_URL
          .replace('{z}', zoom)
          .replace('{x}', ((tileX % tileCount) + tileCount) % tileCount)
          .replace('{y}', tileY);
        image.style.left = `${tileX * TILE_SIZE - origin.x}px`;
        image.style.top = `${tileY * TILE_SIZE - origin.y}px`;
        tiles.append(image);
      }
    }
    map.append(tiles);

    const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    overlay.classList.add('map-overlay');
    overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    overlay.setAttribute('aria-hidden', 'true');
    map.append(overlay);

    areas.forEach((area) => {
      const point = project(area.lat, area.lng, zoom);
      const x = point.x - origin.x;
      const y = point.y - origin.y;
      const milesPerPixel = (156543.03392 * Math.cos(Number(area.lat) * Math.PI / 180) / (2 ** zoom)) / 1609.344;
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', x);
      circle.setAttribute('cy', y);
      circle.setAttribute('r', Math.max(20, Number(area.radiusMiles) / Math.max(0.01, milesPerPixel)));
      overlay.append(circle);

      const label = document.createElement('div');
      label.className = 'map-label';
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
      label.textContent = area.label;
      const meta = document.createElement('small');
      meta.textContent = `${area.anchorZip} - ${area.radiusMiles} ${copy.miles}`;
      label.append(meta);
      map.append(label);
    });
  }

  function applyTheme(isDark) {
    document.body.classList.toggle('dark', isDark);
    if (!themeToggle) return;
    themeToggle.textContent = isDark ? 'Light mode' : 'Dark mode';
    themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    themeToggle.setAttribute('aria-pressed', String(isDark));
  }

  let savedTheme = null;
  try {
    savedTheme = window.localStorage.getItem('oxsteed:service-area-theme');
  } catch (_) {
    savedTheme = null;
  }
  applyTheme(savedTheme === 'dark');
  themeToggle?.addEventListener('click', () => {
    const isDark = !document.body.classList.contains('dark');
    applyTheme(isDark);
    try {
      window.localStorage.setItem('oxsteed:service-area-theme', isDark ? 'dark' : 'light');
    } catch (_) {
      /* Storage can be disabled in private browsing. */
    }
  });
  if (year) year.textContent = String(new Date().getFullYear());

  async function loadAreas() {
    const response = await fetch('/api/direct/service-areas', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Could not load service areas');
    const payload = await response.json();
    renderMap(payload.serviceAreas || []);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const zipCode = String(data.get('zipCode') || '').trim();
    const address = String(data.get('address') || '').trim();

    if (!zipCode && !address) {
      setResult('bad', copy.requiredTitle, copy.requiredBody);
      return;
    }

    setResult('', copy.checking, copy.checkingBody);

    try {
      const response = await fetch('/api/direct/service-availability', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ zipCode, address }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Availability check failed');

      if (payload.available) {
        setResult(
          'good',
          copy.availableHere,
          format(copy.distanceFrom, {
            location: payload.location.label || 'This location',
            distance: payload.matchedServiceArea.distanceMiles,
            area: payload.matchedServiceArea.label,
          }),
        );
      } else {
        const nearest = payload.nearestServiceArea;
        setResult(
          'bad',
          copy.outsideCoverage,
          nearest
            ? format(copy.distanceFrom, {
              location: payload.location.label || 'This location',
              distance: nearest.distanceMiles,
              area: nearest.label,
            })
            : copy.noAreas,
        );
      }
    } catch (err) {
      setResult('bad', copy.checkFailed, err.message || copy.checkFailedBody);
    }
  });

  loadAreas().catch((err) => {
    areaCount.textContent = copy.unavailableTitle;
    setResult('bad', copy.unavailableTitle, err.message || copy.unavailableBody);
  });
}());
