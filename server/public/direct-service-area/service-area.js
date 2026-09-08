(function () {
  const form = document.getElementById('availability-form');
  const result = document.getElementById('result');
  const map = document.getElementById('map');
  const areaCount = document.getElementById('area-count');
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

  function positionFor(area) {
    const lat = Number(area.lat);
    const lng = Number(area.lng);
    const x = Math.max(12, Math.min(88, ((lng + 85.5) / 5.1) * 100));
    const y = Math.max(12, Math.min(88, ((41.6 - lat) / 3.2) * 100));
    return { x, y };
  }

  function renderMap(serviceAreas) {
    map.innerHTML = '';
    areaCount.textContent = format(
      serviceAreas.length === 1 ? copy.activeArea : copy.activeAreas,
      { count: serviceAreas.length },
    );

    serviceAreas.forEach((area) => {
      const { x, y } = positionFor(area);
      const size = Math.max(120, Math.min(360, Number(area.radiusMiles) * 5));

      const radius = document.createElement('div');
      radius.className = 'area-radius';
      radius.style.left = `${x}%`;
      radius.style.top = `${y}%`;
      radius.style.setProperty('--size', `${size}px`);

      const pin = document.createElement('div');
      pin.className = 'area-pin';
      pin.style.left = `${x}%`;
      pin.style.top = `${y}%`;
      pin.textContent = area.label;
      const meta = document.createElement('small');
      meta.textContent = `${area.anchorZip} - ${area.radiusMiles} ${copy.miles}`;
      pin.append(meta);

      map.append(radius, pin);
    });
  }

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
