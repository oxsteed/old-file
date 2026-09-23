# AWS Location Service Plan

OxSteed already has a normalized location contract used by job posting,
helper profiles, restaurant discovery, and browser "near me" flows. The
server endpoints are:

- `GET /api/geo/suggest?q=...`
- `GET /api/geo/reverse?lat=...&lng=...`
- `GET /api/geo/nearby?lat=...&lng=...&radius=...`
- `POST /api/geo/route` (authenticated)
- `POST /api/geo/route-matrix` (authenticated)

## Current integration

Amazon Location Places v2 is available behind `AWS_GEO_PLACES_ENABLED=true`.
Routes v2 is available behind `AWS_GEO_ROUTES_ENABLED=true`.
The server uses `AWS_REGION` and, when configured, dedicated
`AWS_LOCATION_ACCESS_KEY_ID` / `AWS_LOCATION_SECRET_ACCESS_KEY` credentials.
This keeps Amazon Location permissions separate from storage credentials, and
no Google Maps key is required. When the flag is off, the existing Google Maps
integration remains optional and the manual `City, State` parser still keeps
the endpoints usable without either provider.

Text search uses `IntendedUse=Storage` because selected coordinates can be
stored on jobs or profiles. Browser-coordinate reverse geocoding uses
`IntendedUse=SingleUse`. AWS failures are logged without secrets and fall back
to the existing provider/manual behavior.

## Best AWS uses for OxSteed

1. **Geocoding and reverse geocoding:** replace the current Google-only path
   for job, helper, business, and restaurant location normalization.
2. **Nearby restaurant discovery:** use `SearchNearby` for external place
   discovery only if OxSteed wants to supplement its own enrolled restaurant
   directory. Enrolled restaurants should remain database-backed so agreement,
   menu, ordering, and visibility rules stay authoritative.
3. **Route estimates:** `CalculateRoutes` powers authenticated delivery ETA,
   helper travel estimates, and runner dispatch. `CalculateRouteMatrix` is
   bounded to 15 origins, 100 destinations, and 100 total cells per request.
   Haversine estimates remain available when AWS is disabled or unavailable.
4. **Map rendering:** restaurant discovery uses MapLibre with Amazon Location
   Maps v2. The browser receives only `VITE_AWS_LOCATION_API_KEY`, a domain-
   restricted public key. The server AWS access keys are never bundled.

## Guardrails

- Keep the provider flags off until the existing Coolify AWS identity has the
  following server-side actions: `geo-places:SearchText`,
  `geo-places:ReverseGeocode`, `geo-places:SearchNearby`,
  `geo-places:GetPlace`, `geo-routes:CalculateRoutes`, and
  `geo-routes:CalculateRouteMatrix`. IAM is the right authentication strategy
  for this server-side integration; do not put AWS credentials in the browser.
- Prefer a dedicated least-privilege IAM identity for these actions. Do not
  reuse the storage/root credentials in `AWS_ACCESS_KEY_ID` and
  `AWS_SECRET_ACCESS_KEY`.
- Create a separate Amazon Location Maps API key restricted to the production
  domain and the `geo-maps` default provider. Pass it to the client build as
  `VITE_AWS_LOCATION_API_KEY`; it is not a replacement for server credentials.
- External Places results are marked `source=aws_external`,
  `orderable=false`, and `creditEligible=false`. Only OxSteed database
  records can open menus, accept orders, or participate in Credit.
- Do not expose AWS credentials or API keys in the browser bundle.
- Do not replace PostGIS radius filtering with an external map provider;
  PostGIS remains the source of truth for OxSteed-owned records.
- Track AWS pricing buckets and request counts before enabling autocomplete on
  every keystroke; debounce and cache requests at the API boundary.

## Coolify configuration

Set these variables only after the AWS permissions and browser key restrictions
are verified:

```text
AWS_REGION=us-east-2
AWS_LOCATION_ACCESS_KEY_ID=<dedicated-location-access-key-id>
AWS_LOCATION_SECRET_ACCESS_KEY=<dedicated-location-secret-access-key>
AWS_GEO_PLACES_ENABLED=true
AWS_GEO_ROUTES_ENABLED=true
AWS_GEO_PLACES_LANGUAGE=en
VITE_AWS_LOCATION_REGION=us-east-2
VITE_AWS_LOCATION_API_KEY=<domain-restricted-location-api-key>
```

The server flags default to `false`, so a missing or invalid AWS setup falls
back without disabling the rest of the application.
