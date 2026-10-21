import { socialImage } from "../_lib/social-image";
// Only publicMetadata adds this card to a page once a real origin is configured.
// A metadata-file convention would otherwise invent localhost social links in staging.
export const dynamic = "force-static";
export function GET() {
  return socialImage();
}
