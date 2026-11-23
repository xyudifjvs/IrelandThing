import Image from "next/image";
import Link from "next/link";
import s from "../_components/portal.module.css";

export function PortalBrand({
  children,
  portalHome = false,
  variant = "agent",
}: {
  children?: React.ReactNode;
  portalHome?: boolean;
  variant?: "agent" | "client";
}) {
  const wordmark = (
    <span
      className={`weatherly-brand-tile ${s.wordmark} ${variant === "client" ? s.clientWordmark : ""}`}
    >
      <Image
        src="/brand/handoffs/weatherly-wordmark.png"
        alt="Weatherly Transaction Co."
        width={260}
        height={61}
        priority
      />
    </span>
  );
  return (
    <div className={s.brand}>
      {portalHome ? (
        <Link href="/portal" aria-label="Your files">
          {wordmark}
        </Link>
      ) : (
        wordmark
      )}
      {children}
    </div>
  );
}

export function ClientFooter() {
  return (
    <footer className={s.clientFooter}>
      <span className={`weatherly-brand-tile ${s.brandMark}`}>
        <Image
          src="/brand/handoffs/weatherly-mark.png"
          width={44}
          height={28}
          alt=""
        />
      </span>
      <span>Weatherly Transaction Co.</span>
    </footer>
  );
}
