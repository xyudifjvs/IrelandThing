import { publicMetadata } from "../../_lib/seo";
import ReferenceSitePage from "../_components/ReferenceSitePage";
export const metadata = {
  ...publicMetadata("/onboarding"),
  title: { absolute: "New Agent Onboarding · Weatherly Transaction Co." },
};
export default function Page() {
  return <ReferenceSitePage page="onboarding" />;
}
