import { describe, expect, it } from "vitest";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import * as icons from "lucide-react";
import {
  calendarDate,
  monthDays,
  shortPropertyAddress,
  type CalendarItem,
} from "../../apps/web/app/_components/calendar-model";

let pathname = "/portal/calendar",
  role = "agent",
  reads = 0;
let state: { data: unknown; loading: boolean; error: string };
const item: CalendarItem = {
  id: "step",
  matterId: "file",
  label: "Inspection appointment",
  propertyAddress: "930 Sample Rd, Lancaster, OH 43130",
  side: "buyer",
  clientNames: ["Synthetic Client"],
  kind: "appointment",
  day: "2026-11-25",
  at: "2026-11-25T16:00:00Z",
  status: "pending",
  location: "Synthetic office",
};
const Link = ({ href, children, ...props }: any) =>
  React.createElement("a", { ...props, href }, children);
function loadView(path: string): Record<string, any> {
  const compiled = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const exports = {};
  new Function("require", "exports", compiled.outputText)((name: string) => {
    if (name === "react") return React;
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { __esModule: true, default: Link };
    if (name === "next/image")
      return {
        __esModule: true,
        default: ({ priority, ...props }: any) =>
          React.createElement("img", props),
      };
    if (name === "next/navigation") return { usePathname: () => pathname };
    if (name === "@weatherly/ui")
      return {
        api: () => {
          throw Error("No send/action in calendar rendering");
        },
      };
    if (name === "lucide-react") return icons;
    if (name.endsWith("/useLiveData"))
      return {
        useLiveData: () => {
          reads++;
          return { ...state, refresh: () => {} };
        },
      };
    if (name === "./portal-session")
      return { usePortalSession: () => ({ role }) };
    if (name.endsWith(".module.css"))
      return {
        __esModule: true,
        default: new Proxy({}, { get: (_, key) => String(key) }),
      };
    if (name.startsWith(".")) {
      const source = resolve(dirname(path), name);
      const target = [source + ".tsx", source + ".ts"].find(existsSync);
      if (target) return loadView(target);
    }
    throw Error(`Unexpected calendar view dependency ${name}`);
  }, exports);
  return exports;
}
const views = loadView(
  resolve("apps/web/app/(portal)/portal/_views/AgentCalendar.tsx"),
);
const Header = loadView(
  resolve("apps/web/app/(portal)/portal/_views/AgentPortalHeader.tsx"),
).AgentPortalHeader;
const Month = loadView(
  resolve("apps/web/app/_components/CalendarMonth.tsx"),
).CalendarMonth;
const render = (component: React.ComponentType<any>, props = {}) =>
  renderToStaticMarkup(React.createElement(component, props));

describe("actual agent calendar views", () => {
  it.each([
    ["/portal", "Files"],
    ["/portal/transactions/file", "Files"],
    ["/portal/calendar", "Calendar"],
    ["/account", "Account"],
  ])("marks only %s's current header link", (path, label) => {
    pathname = path;
    const html = render(Header);
    expect(html).toMatch(
      new RegExp(`<a[^>]*aria-current="page"[^>]*>${label}</a>`),
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/portal/calendar"');
    expect(html).toContain('href="/portal"');
    expect(html).toContain("navDivider");
    expect(html).toContain("Sign out");
  });
  it("shows each calendar card's time then street, and the initial details prompt", () => {
    state = {
      data: { today: "2026-11-23", items: [item], next7: [item] },
      loading: false,
      error: "",
    };
    role = "agent";
    const html = render(views.AgentCalendar);
    expect(html).toContain("Your calendar");
    expect(html).toContain(
      "Contract deadlines and scheduled appointments for all your active files.",
    );
    expect(html).toContain("11:00 AM · 930 Sample Rd");
    expect(html).toContain(
      "Click any item on the calendar to see its details and open the file.",
    );
    expect(html).toContain("Next 7 days");
    expect(html).not.toContain("Save");
  });
  it("shows appointment/deadline/done details, location and the actual file link", () => {
    const appointment = render(views.CalendarDetails, { item });
    expect(appointment).toContain("Scheduled appointment");
    expect(appointment).toContain("Wed, Nov 25 at 11:00 AM");
    expect(appointment).toContain("Synthetic office");
    expect(appointment).toContain("Buyer side · Synthetic Client");
    expect(appointment).toContain('href="/portal/transactions/file"');
    const deadline = render(views.CalendarDetails, {
      item: {
        ...item,
        side: "seller",
        label: "Remedies",
        kind: "task",
        at: undefined,
        location: undefined,
      },
    });
    expect(deadline).toContain("Contract deadline");
    expect(deadline).toContain("By Wed, Nov 25");
    expect(deadline).toContain("Seller side · Synthetic Client");
    expect(
      render(views.CalendarDetails, { item: { ...item, status: "completed" } }),
    ).toContain(">Done</p>");
  });
  it("uses the shared 42-day month grid, today marker, done styles and keyboard buttons", () => {
    const html = render(Month, {
      current: new Date("2026-11-01T12:00:00Z"),
      items: [item],
      today: "2026-11-23",
      mobileGrid: true,
      onMonthChange() {},
      renderItem: () =>
        React.createElement("button", { key: "step" }, "Example"),
    });
    expect(html.match(/<time /g)).toHaveLength(42);
    expect(html).toContain('aria-current="date"');
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toContain('aria-label="Next month"');
    state = {
      data: { items: [{ ...item, status: "completed" }], next7: [] },
      loading: false,
      error: "",
    };
    expect(render(views.CalendarWorkspace)).toContain("event appointment done");
    expect(shortPropertyAddress(item.propertyAddress)).toBe("930 Sample Rd");
    expect(
      monthDays(new Date("2027-01-01T12:00:00Z"))[0].toISOString().slice(0, 10),
    ).toBe("2026-12-27");
    expect(calendarDate({ ...item, kind: "task" })).toBe("By Wed, Nov 25");
  });
  it("does not fetch an agent calendar for clients, and conceals events when the read fails", () => {
    reads = 0;
    role = "client";
    state = {
      data: { items: [item], next7: [item] },
      loading: false,
      error: "",
    };
    expect(render(views.AgentCalendar)).not.toContain(item.propertyAddress);
    expect(reads).toBe(0);
    role = "agent";
    state = { data: null, loading: false, error: "Access revoked" };
    const html = render(views.AgentCalendar);
    expect(html).toContain("Could not load your calendar.");
    expect(html).not.toContain(item.propertyAddress);
    expect(html).not.toContain("Calendar item details");
  });
});
