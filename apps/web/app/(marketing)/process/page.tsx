import { publicMetadata } from "../../_lib/seo";
import { processMarkup } from "../_components/process-reference";
import chrome from "../_components/reference-marketing.module.css";
export const metadata = {
  ...publicMetadata("/process"),
  title: { absolute: "Process · Weatherly Transaction Co." },
};
export default function Page() {
  return (
    <div
      className={chrome.process}
      dangerouslySetInnerHTML={{ __html: processMarkup }}
    />
  );
}
