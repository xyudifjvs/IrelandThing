import { publicMetadata } from "../_lib/seo";
export const metadata = publicMetadata("/");
import { About } from "./_components/Marketing";
export default function Page() {
  return <About />;
}
