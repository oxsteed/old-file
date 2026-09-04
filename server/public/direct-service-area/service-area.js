(function () {
  const form = document.getElementById('availability-form');
  const result = document.getElementById('result');
  const map = document.getElementById('map');
  const areaCount = document.getElementById('area-count');

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
    areaCount.textContent = `${serviceAreas.length} active area${serviceAreas.length === 1 ? '' : 's'}`;

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
      meta.textContent = `${area.anchorZip} - ${area.radiusMiles} miles`;
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
      setResult('bad', 'Enter a ZIP code or address', 'A location is required before we can check coverage.');
      return;
    }

    setResult('', 'Checking coverage...', 'This usually takes just a moment.');

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
          'OxSteed Direct is available here',
          `${payload.location.label || 'This location'} is about ${payload.matchedServiceArea.distanceMiles} miles from ${payload.matchedServiceArea.label}.`
        );
      } else {
        const nearest = payload.nearestServiceArea;
        setResult(
          'bad',
          'Outside current Direct coverage',
          nearest
            ? `${payload.location.label || 'This location'} is about ${nearest.distanceMiles} miles from ${nearest.label}.`
            : 'No active Direct service areas are configured right now.'
        );
      }
    } catch (err) {
      setResult('bad', 'Could not check that location', err.message || 'Please try a ZIP code.');
    }
  });

  loadAreas().catch((err) => {
    areaCount.textContent = 'Areas unavailable';
    setResult('bad', 'Coverage map unavailable', err.message || 'Please try again later.');
  });
}());
