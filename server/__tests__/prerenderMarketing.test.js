'use strict';

const express = require('express');
const request = require('supertest');
const prerenderPublicPages = require('../middleware/prerenderHelperProfile');

function buildApp() {
  const app = express();
  app.use(prerenderPublicPages);
  return app;
}

describe('localized marketing SEO shell', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  test('localizes crawlable navigation links and labels', async () => {
    const res = await request(buildApp()).get('/direct/services?lang=es');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('Explora OxSteed');
    expect(res.text).toContain('Consulta el \u00e1rea de servicio');
    expect(res.text).toContain('href="https://oxsteed.com/direct/service-area?lang=es"');
    expect(res.text).toContain('href="https://oxsteed.com/direct/request-quote?lang=es"');
    expect(res.text).not.toContain('>Explore OxSteed<');
  });
});
