import { publicMetadata } from "../../_lib/seo";
import ReferenceSitePage from "../_components/ReferenceSitePage";
export const metadata = {
  ...publicMetadata("/contact"),
  title: { absolute: "FAQ & Contact · Weatherly Transaction Co." },
};
export default function Page() {
  return <ReferenceSitePage page="contact" />;
}
