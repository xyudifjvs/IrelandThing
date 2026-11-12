import type { HtoAddress } from "./contracts";

export function formatHtoAddress(address: HtoAddress) {
  return [
    address.street,
    address.city,
    [address.state, address.zip].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
}

export function exactAddressKey(address: string) {
  // Preserve punctuation that can distinguish a unit, range or fractional address.
  return address
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ",");
}

const streetSuffixes: Readonly<Record<string, string>> = {
  street: "st",
  road: "rd",
  drive: "dr",
  avenue: "ave",
  court: "ct",
  boulevard: "blvd",
  lane: "ln",
  place: "pl",
  circle: "cir",
  terrace: "ter",
  way: "way",
  parkway: "pkwy",
  trail: "trl",
  highway: "hwy",
};

export function nearAddressKey(address: string) {
  return exactAddressKey(address)
    .replace(
      /\b(apt|apartment|unit|suite|ste)\.?\s+(?=\w)|#\s*(?=\w)/g,
      "unit ",
    )
    .replace(/\b[a-z]+\.?/g, (word) => {
      const bare = word.replace(/\.$/, "");
      return streetSuffixes[bare] ?? bare;
    })
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasLocality(address: string, structured: HtoAddress | null) {
  if (structured)
    return Boolean(structured.city && (structured.state || structured.zip));
  return /(?:,\s*[^,]+,\s*[a-z]{2}\b|\b[a-z]{2}\s+\d{5}(?:-\d{4})?$)/i.test(
    address,
  );
}
