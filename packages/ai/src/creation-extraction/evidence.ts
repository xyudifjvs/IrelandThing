const months = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

export function quoteSupportsCivilDate(quote: string, date: string) {
  const [year, month, day] = date.split("-").map(Number);
  const name = months[month - 1];
  if (!name) return false;
  const documentedYear =
    year >= 2000 && year < 2100
      ? `(?:${year}|${String(year).slice(-2)})`
      : String(year);
  const monthNumber = month < 10 ? `0?${month}` : String(month);
  const dayNumber = day < 10 ? `0?${day}` : String(day);
  return (
    new RegExp(`\\b${date}(?!\\d)`).test(quote) ||
    new RegExp(
      `\\b${monthNumber}([/-])${dayNumber}\\1${documentedYear}\\b`,
    ).test(quote) ||
    new RegExp(
      `\\b(?:${name}|${name.slice(0, 3)})\\.?\\s+${dayNumber}(?:st|nd|rd|th)?,?\\s+${year}\\b`,
      "i",
    ).test(quote)
  );
}

export function quoteSupportsCents(quote: string, cents: number) {
  const amounts = quote.matchAll(
    /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,]|\.\d)/g,
  );
  for (const [, dollars, fractional = ""] of amounts) {
    const amount =
      BigInt(dollars.replaceAll(",", "")) * 100n +
      BigInt(fractional.padEnd(2, "0"));
    if (amount === BigInt(cents)) return true;
  }
  return false;
}
