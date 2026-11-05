import { publicMetadata } from "../../_lib/seo";
import ReferenceSitePage from "../_components/ReferenceSitePage";
export const metadata = {
  ...publicMetadata("/process"),
  title: { absolute: "Process · Weatherly Transaction Co." },
};
export default function Page() {
  return <ReferenceSitePage page="process" />;
}
