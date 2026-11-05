import { publicMetadata } from "../../_lib/seo";
import ReferenceSitePage from "../_components/ReferenceSitePage";
export const metadata = {
  ...publicMetadata("/agent-portal"),
  title: { absolute: "Agent Portal · Weatherly Transaction Co." },
};
export default function Page() {
  return <ReferenceSitePage page="agentPortal" />;
}
