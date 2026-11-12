import Image from "next/image";
import Link from "next/link";
import s from "../_components/portal.module.css";

export function PortalBrand({
  children,
  portalHome = false,
}: {
  children?: React.ReactNode;
  portalHome?: boolean;
}) {
  const wordmark = (
    <span className={`weatherly-brand-tile ${s.wordmark}`}>
      <Image
        src="/brand/handoffs/weatherly-wordmark.png"
        alt="Weatherly Transaction Co."
        width={135}
        height={32}
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
