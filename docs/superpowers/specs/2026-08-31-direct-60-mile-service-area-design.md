# OxSteed Direct 60-Mile Service Area

## Goal

Tell prospective OxSteed Direct customers that they may request help anywhere within 60 miles of Springfield, Ohio, without implying that every request is guaranteed acceptance.

## Scope

- Update only OxSteed Direct customer-facing pages.
- Use the approved message: “Need help within 60 miles of Springfield, Ohio? Request a quote.”
- Replace the current city-list framing with one radius-based service-area message.
- Keep Springfield, Ohio as the operating base.
- Leave the general OxSteed homepage and unrelated services unchanged.

## Presentation

The Direct landing page and Direct quote-request page will display the approved message prominently near their existing location and availability information. The Direct landing page’s “Travel cities” section will become a service-area section instead of naming selected cities.

## Data and Compatibility

The backend Direct profile will expose the same 60-mile message as its default service-area copy so the customer pages remain consistent when no customized profile is available. Existing profile fields and stored travel-city data remain compatible; this change does not alter request eligibility, scheduling, pricing, or database schema.

## Verification

- Add a focused automated assertion for the approved Direct service-area copy before changing production code.
- Confirm the assertion fails against the current city-based copy.
- Update the Direct defaults and customer-facing rendering.
- Run the focused test and the client production build.
- Manually verify the Direct landing and quote-request pages at desktop width and capture walkthrough evidence.
