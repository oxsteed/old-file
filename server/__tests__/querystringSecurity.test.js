'use strict';

const qs = require('qs');
const express = require('express');
const request = require('supertest');

describe('query serialization with untrusted comma-array elements', () => {
  const sources = [
    ['JSON input', () => JSON.parse('{"a":[{"toString":"x"}]}')],
    ['extended parsed input', () => qs.parse('a[0][toString]=x', { allowPrototypes: true })],
    ['null-prototype parsed input', () => qs.parse('a[][b]=c', { plainObjects: true })],
    ['nested arrays', () => JSON.parse('{"a":[[{"toString":"x"}]]}')],
  ];

  for (const [name, input] of sources) {
    test.each([false, true])(`${name} cannot crash serialization (encodeValuesOnly=%s)`, (encodeValuesOnly) => {
      expect(() => qs.stringify(input(), { arrayFormat: 'comma', encodeValuesOnly })).not.toThrow();
    });
  }

  test('ordinary comma-array and nested-object serialization remains usable', () => {
    expect(qs.stringify({ a: ['x', 'y'] }, { arrayFormat: 'comma' })).toBe('a=x%2Cy');
    expect(qs.parse(qs.stringify({ filters: { city: 'Springfield' }, page: 2 })))
      .toEqual({ filters: { city: 'Springfield' }, page: '2' });
  });
});

test('Express extended query and form parsers keep nested fields and repeated values', async () => {
  const app = express();
  app.set('query parser', 'extended');
  app.use(express.urlencoded({ extended: true }));
  app.get('/query', (req, res) => res.json(req.query));
  app.post('/form', (req, res) => res.json(req.body));
  const encoded = 'filters[city]=Springfield&tags[]=food&tags[]=local';
  const expected = { filters: { city: 'Springfield' }, tags: ['food', 'local'] };
  const query = await request(app).get(`/query?${encoded}`).expect(200);
  const form = await request(app).post('/form').type('form').send(encoded).expect(200);
  expect(query.body).toEqual(expected);
  expect(form.body).toEqual(expected);
});
