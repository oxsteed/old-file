"use strict";
const aliases = {};
for (const item of "Alabama:AL|Alaska:AK|Arizona:AZ|Arkansas:AR|California:CA|Colorado:CO|Connecticut:CT|Delaware:DE|Florida:FL|Georgia:GA|Hawaii:HI|Idaho:ID|Illinois:IL|Indiana:IN|Iowa:IA|Kansas:KS|Kentucky:KY|Louisiana:LA|Maine:ME|Maryland:MD|Massachusetts:MA|Michigan:MI|Minnesota:MN|Mississippi:MS|Missouri:MO|Montana:MT|Nebraska:NE|Nevada:NV|New Hampshire:NH|New Jersey:NJ|New Mexico:NM|New York:NY|North Carolina:NC|North Dakota:ND|Ohio:OH|Oklahoma:OK|Oregon:OR|Pennsylvania:PA|Rhode Island:RI|South Carolina:SC|South Dakota:SD|Tennessee:TN|Texas:TX|Utah:UT|Vermont:VT|Virginia:VA|Washington:WA|West Virginia:WV|Wisconsin:WI|Wyoming:WY|District of Columbia:DC".split(
  "|",
)) {
  const [name, code] = item.split(":");
  aliases[`US:${name.toUpperCase()}`] = code;
}
for (const item of "Alberta:AB|British Columbia:BC|Manitoba:MB|New Brunswick:NB|Newfoundland and Labrador:NL|Northwest Territories:NT|Nova Scotia:NS|Nunavut:NU|Ontario:ON|Prince Edward Island:PE|Quebec:QC|Saskatchewan:SK|Yukon:YT".split(
  "|",
)) {
  const [name, code] = item.split(":");
  aliases[`CA:${name.toUpperCase()}`] = code;
}
function subdivision(country, value) {
  const raw = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
  return (
    aliases[`${country}:${raw}`] || (/^[A-Z0-9]{1,8}$/.test(raw) ? raw : null)
  );
}
function signalsFor(user, { req, trustedSignals = [] } = {}) {
  const signals = [...trustedSignals];
  if (req) {
    const country = String(req.headers?.["cf-ipcountry"] || "").toUpperCase(),
      region = subdivision(country, req.headers?.["cf-region-code"]);
    if (
      process.env.GROWTH_TRUST_CLOUDFLARE === "true" &&
      /^[A-Z]{2}$/.test(country) &&
      !["XX", "T1"].includes(country)
    )
      signals.push(region ? `${country}-${region}` : country);
    else signals.push("unknown");
  }
  if (user?.country_confirmed) {
    const country = String(user.country || "").toUpperCase(),
      region = subdivision(country, user.state);
    signals.push(region ? `${country}-${region}` : country);
  }
  return [...new Set(signals)];
}
module.exports = { subdivision, signalsFor };
