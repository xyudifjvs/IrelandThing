export type WorkspaceLink = { href: string; label: string };
export type WorkspaceNavigationGroup = {
  label?: string;
  links: readonly WorkspaceLink[];
};

// Replace these entries alongside the corresponding route changes.
export const workspaceNavigation: readonly WorkspaceNavigationGroup[] = [
  {
    links: [
      { href: "/workspace", label: "Overview" },
      { href: "/workspace/transactions", label: "Transactions" },
      { href: "/workspace/intakes", label: "Submitted intakes" },
      { href: "/workspace/onboarding", label: "Onboarding" },
      { href: "/workspace/calendar", label: "Calendar" },
      { href: "/workspace/inbox", label: "Inbox" },
      { href: "/workspace/contacts", label: "Contacts" },
      { href: "/workspace/payments", label: "Payments" },
      { href: "/workspace/review", label: "AI review" },
      { href: "/workspace/new", label: "Start manually" },
    ],
  },
];

export const workspaceAccountLinks = [
  { href: "/workspace/settings", label: "Settings" },
  { href: "/portal", label: "Agent & client portal" },
  { href: "/contact", label: "Contact & support" },
] as const;
