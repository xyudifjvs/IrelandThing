import type { Metadata } from "next";

export const publicPages = {
  "/": {
    title: "Real estate transaction coordination",
    description:
      "Work with Ireland at Weatherly Transaction Co. for contract-to-close and seller pre-listing coordination, document organization and deadline tracking.",
  },
  "/services": {
    title: "Services and pricing",
    description:
      "Compare Weatherly's Essentials ($375), Complete ($475) and seller-only Full Listing ($625) transaction coordination services. Prices are in USD.",
  },
  "/process": {
    title: "How transaction coordination works",
    description:
      "See how Weatherly handles agent onboarding, transaction intake, document review, deadlines and closing coordination with Ireland.",
  },
  "/onboarding": {
    title: "Work with Ireland",
    description:
      "Request an introductory meeting with Ireland to discuss your transactions, brokerage requirements and Weatherly service options.",
  },
  "/faq": {
    title: "Transaction coordination questions",
    description:
      "Answers about Weatherly's services, transaction intake, documents, payments, closing gifts and working with Ireland.",
  },
  "/agent-portal": {
    title: "Agent portal access",
    description:
      "Access your Weatherly transaction workspace to submit a transaction, review shared documents and check updates from Ireland.",
  },
  "/contact": {
    title: "Contact Ireland",
    description:
      "Contact Ireland at Weatherly Transaction Co. with questions about real estate transaction coordination and your next transaction.",
  },
} as const;

/** Indexing is an explicit business launch setting, independent of secure runtime mode. */
export function sitePolicy(env: Partial<NodeJS.ProcessEnv> = process.env) {
  let origin: string | null = null;
  if (env.PUBLIC_SITE_URL) {
    try {
      const url = new URL(env.PUBLIC_SITE_URL);
      if (
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash &&
        /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(url.hostname) &&
        !/(^|\.)(localhost|local|internal|test|example)$/.test(url.hostname) &&
        !url.hostname.endsWith(".up.railway.app")
      )
        origin = url.origin;
    } catch {
      /* No unverified canonical origin is emitted. */
    }
  }
  return {
    origin,
    indexable: Boolean(
      origin &&
      env.DEPLOYMENT_ENV === "production" &&
      env.SITE_INDEXING_ENABLED === "true",
    ),
  };
}

export function publicMetadata(path: keyof typeof publicPages): Metadata {
  const page = publicPages[path];
  const { origin, indexable } = sitePolicy();
  const url = origin ? new URL(path, origin).href : undefined;
  return {
    ...page,
    robots: { index: indexable, follow: true },
    alternates: url ? { canonical: url } : undefined,
    openGraph: {
      title: page.title,
      description: page.description,
      type: "website",
      siteName: "Weatherly Transaction Co.",
      locale: "en_US",
      ...(url ? { url } : {}),
      images: origin
        ? [
            {
              url: `${origin}/opengraph-image`,
              width: 1200,
              height: 630,
              alt: "Weatherly Transaction Co. | Real estate transaction coordination",
            },
          ]
        : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: origin ? [`${origin}/opengraph-image`] : undefined,
    },
  };
}

export function organizationData() {
  const { origin, indexable } = sitePolicy();
  if (!origin || !indexable) return null;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "Weatherly Transaction Co.",
    url: origin,
    description: "Real estate transaction coordination with Ireland.",
    logo: `${origin}/brand/icon.jpeg`,
  };
}
