import { publicMetadata } from "../../_lib/seo";
export const metadata = publicMetadata("/services");
import { Services } from "../_components/Marketing";
export default function Page() {
  return <Services />;
}
