// Isolated, synthetic API + production client fixture. No real server or provider.
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path');
const client = path.resolve(__dirname, '..');
const demoUser = {
  id: '30000000-0000-4000-8000-000000000003',
  name: 'Demo customer',
  first_name: 'Demo',
  email: 'demo@example.invalid',
  role: 'customer',
  email_verified: true,
  didit_status: 'verified',
  country: 'US',
  preferred_language: 'en',
  preferred_currency: 'USD',
  onboarding_completed: true,
};
exports.startPwaFixture = async () => {
  const state = {
    user: demoUser,
    release: 1,
    draft: null,
    requests: [],
    writes: [],
    readResponses: {},
    failures: {},
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    state.requests.push({ method: req.method, path: url.pathname });
    res.setHeader('Cache-Control', 'no-store');
    const json = (data, status = 200) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(data));
    };
    if (url.pathname.startsWith('/api/')) {
      if (state.failures[url.pathname]) return json({ error: 'Synthetic API unavailable' }, state.failures[url.pathname]);
      if (req.method === 'GET' && Object.hasOwn(state.readResponses, url.pathname))
        return json(state.readResponses[url.pathname]);
      if (!['GET', 'HEAD'].includes(req.method)) {
        let body = '';
        for await (const part of req) body += part;
        state.writes.push(url.pathname);
        if (url.pathname === '/api/jobs/draft' && req.method === 'PUT') {
          state.draft = JSON.parse(body);
          return json({ id: 'draft-demo' });
        }
        if (url.pathname === '/api/jobs/draft' && req.method === 'DELETE') {
          state.draft = null;
          return json({});
        }
        if (url.pathname === '/api/auth/refresh')
          return json(
            state.user ? { user: state.user } : { error: 'expired' },
            state.user ? 200 : 401,
          );
        return json({});
      }
      if (url.pathname === '/api/auth/me')
        return json(
          state.user ? { user: state.user } : { error: 'expired' },
          state.user ? 200 : 401,
        );
      if (url.pathname === '/api/jobs/draft') return json(state.draft);
      if (url.pathname === '/api/config/capabilities')
        return json({ capabilities: { aiSupport: { available: false } } });
      if (url.pathname === '/api/notifications')
        return json({ notifications: [], unread_count: 0 });
      if (url.pathname === '/api/messages/conversations')
        return json({ conversations: [], hasMore: false });
      if (url.pathname === '/api/helpers')
        return json({
          helpers: [],
          businesses: [],
          restaurants: [],
          total: 0,
          page: 1,
        });
      if (url.pathname === '/api/jobs')
        return json({
          jobs: [],
          total: 0,
          page: Number(url.searchParams.get('page') || 1),
          limit: 12,
        });
      if (url.pathname === '/api/food/restaurants/42')
        return json({
          restaurant: {
            id: 42,
            name: 'Demo Kitchen',
            display_name: 'Demo Kitchen',
            status: 'active',
            currency: 'USD',
            cuisine_tags: ['caribbean'],
            accepting_orders: true,
            is_open: true,
          },
          menu: [
            {
              id: 1,
              name: 'Meals',
              items: [
                {
                  id: 12,
                  name: 'Roast chicken',
                  description: 'Freshly prepared with rice',
                  price_cents: 1650,
                  is_available: true,
                },
              ],
            },
          ],
          uncategorizedItems: [],
          locations: [],
        });
      if (url.pathname === '/api/food/restaurants')
        return json({ restaurants: [], pagination: { hasMore: false } });
      if (url.pathname === '/api/food/my/orders') return json({ orders: [] });
      if (url.pathname.includes('favorites'))
        return json({ restaurants: [], favoriteItemIds: [] });
      if (url.pathname.includes('promotions')) return json({ promotions: [] });
      if (url.pathname.includes('wallets')) return json({ wallets: [] });
      if (url.pathname === '/api/oxsteed-credit/accounts')
        return json({ accounts: [] });
      if (url.pathname === '/api/oxsteed-credit/account')
        return json({ account: null });
      return json({});
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, ''),
      file = path.resolve(client, 'dist', relative || 'index.html');
    if (!file.startsWith(path.join(client, 'dist') + path.sep))
      return json({}, 404);
    let target = file;
    if (!fs.existsSync(target) || !fs.statSync(target).isFile())
      target = url.pathname.startsWith('/assets/')
        ? null
        : path.join(client, 'dist/index.html');
    if (!target) return json({}, 404);
    const ext = path.extname(target),
      mime = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.woff2': 'font/woff2',
      };
    res.setHeader('Content-Type', mime[ext] || 'application/octet-stream');
    if (url.pathname.startsWith('/assets/'))
      res.setHeader('Cache-Control', 'public,max-age=0');
    if (url.pathname === '/sw.js')
      return res.end(
        fs.readFileSync(target, 'utf8') +
          '\n// isolated test release ' +
          state.release,
      );
    fs.createReadStream(target).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    state,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};
