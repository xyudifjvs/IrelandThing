export const socialImagePath = "/brand/og-1-cream.png";

/** Keep previously shared image URLs pointing to Ireland's supplied artwork. */
export function socialImage() {
  return new Response(null, {
    status: 307,
    headers: { Location: socialImagePath },
  });
}
