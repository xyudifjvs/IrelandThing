import { publicMetadata } from "../../_lib/seo";
import ReferenceSitePage from "../_components/ReferenceSitePage";
export const metadata = {
  ...publicMetadata("/services"),
  title: { absolute: "Services · Weatherly Transaction Co." },
};
export default function Page() {
  return <ReferenceSitePage page="services" />;
}
