'use strict';

const express = require('express');
const request = require('supertest');
const { sendDirectServiceAreaPage } = require('../routes/directServiceAreaPage');

function buildApp() {
  const app = express();
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
    expect(res.text).not.toContain('window.OXSTEED_SERVICE_AREA_COPY');

    const schemas = [...res.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((match) => JSON.parse(match[1]));
    expect(schemas.map((schema) => schema['@type'])).toEqual(['Service', 'BreadcrumbList']);
    expect(schemas.every((schema) => schema.inLanguage === 'es')).toBe(true);
    expect(schemas[0].areaServed.geoRadius).toBe(96560.64);
  });

  test('falls back to the default language for unsupported values', async () => {
    const res = await request(buildApp()).get('/direct/service-area?lang=de');

    expect(res.status).toBe(200);
    expect(res.headers['content-language']).toBe('en');
    expect(res.text).toContain('<title>OxSteed Direct Service Area</title>');
  });
});
