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
      { href: "/workspace/calendar", label: "Calendar" },
      { href: "/workspace/notes", label: "Notes" },
      { href: "/workspace/inbox", label: "Inbox" },
      { href: "/workspace/contacts", label: "Contacts" },
      { href: "/workspace/payments", label: "Payments" },
      { href: "/workspace/roster", label: "Agent roster" },
      { href: "/workspace/hto-operations", label: "HTO Operations" },
    ],
  },
];

export const workspaceAccountLinks = [
  { href: "/workspace/settings", label: "Settings" },
  { href: "/portal", label: "Agent & client portal" },
  { href: "/contact", label: "Contact & support" },
] as const;
