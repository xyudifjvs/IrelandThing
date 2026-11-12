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

export function normalizeEvidenceText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

// Match the value against the complete source text first. The model's excerpt
// must span that full match, including any continuation of a date or amount.
function quoteCoversMatch(page: string, quote: string, match: RegExpExecArray) {
  const start = match.index;
  const end = start + match[0].length;
  const quoteStart = page.indexOf(quote, Math.max(0, end - quote.length));
  return quoteStart !== -1 && quoteStart <= start;
}

export function quoteSupportsCivilDate(
  page: string,
  quote: string,
  date: string,
) {
  const [year, month, day] = date.split("-").map(Number);
  const name = months[month - 1];
  if (!name) return false;
  const documentedYear =
    year >= 2000 && year < 2100
      ? `(?:${year}|${String(year).slice(-2)})`
      : String(year);
  const monthNumber = month < 10 ? `0?${month}` : String(month);
  const dayNumber = day < 10 ? `0?${day}` : String(day);
  const forms = [
    date,
    `${monthNumber}([/-])${dayNumber}\\1${documentedYear}`,
    `(?:${name}|${name.slice(0, 3)})\\.?\\s+${dayNumber}(?:st|nd|rd|th)?,?\\s+${year}`,
  ];
  const matches = page.matchAll(
    new RegExp(
      `(?<!\\d[/-])\\b(?:${forms.join("|")})(?=T\\d|\\b)(?![/-]\\d)`,
      "gi",
    ),
  );
  return Array.from(matches).some((match) =>
    quoteCoversMatch(page, quote, match),
  );
}

const easternClock = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h12",
  timeZoneName: "short",
});

export function quoteSupportsInstant(
  page: string,
  quote: string,
  value: { date: string; instant: string | null },
) {
  if (!value.instant) return false;
  const instant = new Date(value.instant);
  if (!Number.isFinite(instant.getTime())) return false;
  const isoTimes = page.matchAll(
    /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})(?![\w:]|\.\d)/g,
  );
  for (const match of isoTimes) {
    if (
      match[0].startsWith(value.date + "T") &&
      Date.parse(match[0]) === instant.getTime() &&
      quoteCoversMatch(page, quote, match)
    )
      return true;
  }

  const parts = Object.fromEntries(
    easternClock.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  if (
    `${parts.year}-${parts.month}-${parts.day}` !== value.date ||
    parts.second !== "00" ||
    instant.getUTCMilliseconds() !== 0
  )
    return false;
  const times = page.matchAll(
    /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?\s*m\.?\s*(?:\(\s*)?(EDT|EST|ET|Eastern Daylight Time|Eastern Standard Time|Eastern Time)\b/gi,
  );
  for (const match of times) {
    const [, hour, minute = "00", period, zone] = match;
    const namedZone = zone.toUpperCase();
    const requiredZone =
      namedZone === "EASTERN DAYLIGHT TIME"
        ? "EDT"
        : namedZone === "EASTERN STANDARD TIME"
          ? "EST"
          : namedZone;
    if (
      Number(hour) === Number(parts.hour) &&
      minute === parts.minute &&
      period.toUpperCase() + "M" === parts.dayPeriod &&
      ["ET", "EASTERN TIME", parts.timeZoneName].includes(requiredZone) &&
      quoteCoversMatch(page, quote, match)
    )
      return true;
  }
  return false;
}

export function quoteSupportsCents(page: string, quote: string, cents: number) {
  const amounts = page.matchAll(
    /(?<![-−\w])\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(?![\d,]|\.\d)/g,
  );
  for (const match of amounts) {
    if (!quoteCoversMatch(page, quote, match)) continue;
    const [, dollars, fractional = ""] = match;
    const amount =
      BigInt(dollars.replaceAll(",", "")) * 100n +
      BigInt(fractional.padEnd(2, "0"));
    if (amount === BigInt(cents)) return true;
  }
  return false;
}
