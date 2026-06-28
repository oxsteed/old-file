'use strict';

const express = require('express');
const request = require('supertest');
const { mockQuery, resetMocks } = require('./setup');
const usersRoutes = require('../routes/users');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', usersRoutes);
  return app;
}

beforeEach(() => resetMocks());

describe('GET /api/users/helpers/search', () => {
  test('returns helper search results in the shape expected by OxSteed Main', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: '00000000-0000-4000-8000-000000000111',
          first_name: 'Maya',
          last_name: 'Chen',
          bio: 'Detailed cleaning and staging support',
          city: 'Columbus',
          rating: '4.9',
          is_verified: true,
          primary_skill: 'Cleaning',
        },
        {
          id: '00000000-0000-4000-8000-000000000222',
          first_name: 'Diego',
          last_name: 'Ramos',
          bio: 'Repairs, installs, and maintenance',
          city: 'Columbus',
          rating: '4.8',
          is_verified: false,
          primary_skill: 'Handyman',
        },
      ],
    });

    const res = await request(buildApp())
      .get('/api/users/helpers/search')
      .query({ q: 'clean', limit: 5 });

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(res.body.helpers).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000111',
        firstName: 'Maya',
        lastName: 'Chen',
        bio: 'Detailed cleaning and staging support',
        city: 'Columbus',
        rating: 4.9,
        primarySkill: 'Cleaning',
        isVerified: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000222',
        firstName: 'Diego',
        lastName: 'Ramos',
        bio: 'Repairs, installs, and maintenance',
        city: 'Columbus',
        rating: 4.8,
        primarySkill: 'Handyman',
        isVerified: false,
      },
    ]);
  });

  test('returns an empty list without querying when q is blank', async () => {
    const res = await request(buildApp())
      .get('/api/users/helpers/search')
      .query({ q: '   ' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ helpers: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
