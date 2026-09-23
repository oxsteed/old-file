# AWS Location Service Plan

OxSteed already has a normalized location contract used by job posting,
helper profiles, restaurant discovery, and browser "near me" flows. The
server endpoints are:

- `GET /api/geo/suggest?q=...`
- `GET /api/geo/reverse?lat=...&lng=...`

## Current integration

Amazon Location Places v2 is available behind `AWS_GEO_PLACES_ENABLED=true`.
The server uses the AWS SDK default credential chain and `AWS_REGION`, so no
Google Maps key is required. When the flag is off, the existing Google Maps
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
3. **Route estimates:** add `CalculateRoutes` for delivery ETA, helper travel
   estimates, and restaurant runner dispatch. Keep final pricing and service
   eligibility in OxSteed's own policies.
4. **Map rendering:** consider Amazon Location Maps only when we need a
   consistent branded map or higher-volume map tiles. The current Leaflet
   surfaces do not need to change for the geocoding rollout.

## Guardrails

- Keep the provider flag off until an AWS IAM role or task role is scoped to
  `geo-places:SearchText` and `geo-places:ReverseGeocode`. IAM is the right
  authentication strategy for this server-side integration; do not put AWS
  credentials in the browser.
- Do not expose AWS credentials or API keys in the browser bundle.
- Do not replace PostGIS radius filtering with an external map provider;
  PostGIS remains the source of truth for OxSteed-owned records.
- Track AWS pricing buckets and request counts before enabling autocomplete on
  every keystroke; debounce and cache requests at the API boundary.
