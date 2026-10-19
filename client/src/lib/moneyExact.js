import { getCreditMinorUnits } from "./creditCurrency.js";

export function moneyMinor(value, currency, locale = "en") {
  if (value == null) return "—";
  if (!currency) return String(value);
  if (typeof value === "number" && !Number.isSafeInteger(value)) return "—";
  try {
    const amount = BigInt(String(value)),
      units = getCreditMinorUnits(currency),
      scale = 10n ** BigInt(units);
    const absolute = amount < 0n ? -amount : amount,
      whole = absolute / scale,
      remainder = absolute % scale;
    const language = locale === "ht" ? "fr-HT" : locale;
    const formatter = new Intl.NumberFormat(language, {
      style: "currency",
      currency,
      minimumFractionDigits: units,
      maximumFractionDigits: units,
    });
    const signed = amount < 0n ? (whole === 0n ? -0 : -whole) : whole;
    const fraction = units
      ? new Intl.NumberFormat(language, {
          useGrouping: false,
          minimumIntegerDigits: units,
          maximumFractionDigits: 0,
        }).format(Number(remainder))
      : "";
    return formatter
      .formatToParts(signed)
      .map((part) => (part.type === "fraction" ? fraction : part.value))
      .join("");
  } catch {
    return "—";
  }
}
export function moneyMajor(value, currency, locale = "en") {
  if (value == null) return "—";
  if (!currency) return String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(value));
  if (!match) return "—";
  const units = getCreditMinorUnits(currency),
    fraction = match[3] || "";
  let minor =
    BigInt(match[2]) * 10n ** BigInt(units) +
    BigInt(fraction.slice(0, units).padEnd(units, "0") || "0");
  if (fraction.length > units && Number(fraction[units]) >= 5) minor += 1n;
  return moneyMinor(String(match[1] ? -minor : minor), currency, locale);
}
