'use strict';

const express = require('express');
const path = require('path');
const request = require('supertest');
const { sendDirectServiceAreaPage } = require('../routes/directServiceAreaPage');

function buildApp() {
  const app = express();
  app.use('/direct/service-area-assets', express.static(path.join(__dirname, '../public/direct-service-area')));
  app.get('/direct/service-area', sendDirectServiceAreaPage);
  return app;
}

describe('localized Direct service-area page', () => {
  test('renders localized metadata, content, links, and schemas', async () => {
    const res = await request(buildApp()).get('/direct/service-area?lang=es');

    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('es');
    expect(res.text).toContain('<html lang="es" dir="ltr">');
    expect(res.text).toContain('<title>\u00c1rea de servicio de OxSteed Direct</title>');
    expect(res.text).toContain('<h1 id="service-area-title" data-seo-slot="heading">Comprueba la cobertura del servicio</h1>');
    expect(res.text).toContain('href="https://oxsteed.com/direct/request-quote?lang=es"');
    expect(res.text).toContain('aria-label="Mapa aproximado de la cobertura de servicio activa"');
    expect(res.text).toContain('hreflang="es" href="https://oxsteed.com/direct/service-area?lang=es"');
    expect(res.text).toContain('data-service-area-copy=');
    expect(res.text).toContain('<header class="site-header">');
    expect(res.text).toContain('<footer class="site-footer">');
    expect(res.text).toContain('class="map-attribution"');
    expect(res.text).toMatch(/href="\/direct\/service-area-assets\/service-area\.css\?v=[0-9]+-[0-9]+"/);
    expect(res.text).toMatch(/src="\/direct\/service-area-assets\/service-area\.js\?v=[0-9]+-[0-9]+"/);
    expect(res.text).not.toContain('__SERVICE_AREA_CSS_VERSION__');
    expect(res.text).not.toContain('window.OXSTEED_SERVICE_AREA_COPY');

    const schemas = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => JSON.parse(match[1]));
    expect(schemas.map((schema) => schema['@type'])).toEqual(['Service', 'BreadcrumbList']);
    expect(schemas.every((schema) => schema.inLanguage === 'es')).toBe(true);
    expect(schemas[0].areaServed.geoRadius).toBe(96560.64);
    expect(schemas[0].areaServed.name).toBe('A menos de 60 millas de Springfield, Ohio');
  });

  test('falls back to the default language for unsupported values', async () => {
    const res = await request(buildApp()).get('/direct/service-area?lang=de');

    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('en');
    expect(res.text).toContain('<title>OxSteed Direct Service Area</title>');
  });

  test('serves the versioned stylesheet referenced by the page', async () => {
    const page = await request(buildApp()).get('/direct/service-area');
    const stylesheetPath = page.text.match(/href="([^\"]+service-area\.css\?v=[^\"]+)"/)[1];
    const stylesheet = await request(buildApp()).get(stylesheetPath);

    expect(stylesheet.status).toBe(200);
    expect(stylesheet.headers['content-type']).toMatch(/^text\/css/);
    expect(stylesheet.text).toContain('.site-header');
    expect(stylesheet.text).toContain('.nav-links');
    expect(stylesheet.text).toContain('.site-footer');
  });

  test('serves the versioned script with theme toggle behavior', async () => {
    const page = await request(buildApp()).get('/direct/service-area');
    const scriptPath = page.text.match(/src="([^\"]+service-area\.js\?v=[^\"]+)"/)[1];
    const script = await request(buildApp()).get(scriptPath);

    expect(script.status).toBe(200);
    expect(script.headers['content-type']).toMatch(/^application\/javascript/);
    expect(script.text).toContain("themeToggle?.addEventListener('click'");
    expect(script.text).toContain("themeToggle.setAttribute('aria-pressed'");
  });

  test('keeps the service-area page standalone instead of adding a React root', async () => {
    const res = await request(buildApp()).get('/direct/service-area');

    expect(res.text).toContain('<header class="site-header">');
    expect(res.text).toContain('<footer class="site-footer">');
    expect(res.text).not.toContain('<div id="root">');
  });
});
