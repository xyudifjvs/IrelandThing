import Link from "next/link";
import type { ReactNode } from "react";
import s from "./auth.module.css";

export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className={s.page}>
      <aside className={s.story} aria-label="Weatherly Transaction Co.">
        <Link href="/" className={s.brand}>
          <img
            src="/brand/handoffs/weatherly-wordmark.png"
            width={1500}
            height={350}
            alt="Weatherly Transaction Co. home"
          />
        </Link>
        <p className={s.statement}>
          A higher standard of transaction coordination
        </p>
        <div className={s.signature}>
          <img
            src="/brand/handoffs/weatherly-mark.png"
            width={1500}
            height={625}
            alt=""
          />
          <span>WEATHERLYTC.COM</span>
        </div>
      </aside>
      <div className={s.formSide}>
        <div className={s.form}>{children}</div>
      </div>
    </div>
  );
}
