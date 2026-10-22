// Screens that aren't tabs, and the tab they belong to.
const PARENT: Record<string, string> = {
  briefing: "home", trips: "home", profile: "home", family: "home", connections: "home",
  settings: "home", privacy: "home", memory: "home", upgrade: "home", circle: "home",
  calendar: "plan",
  thrive: "me", style: "me",
};

export function tabFor(id: string): string {
  return PARENT[id] || id;
}

// True for screens reached from a tab (they get a back link).
export function isSubScreen(id: string): boolean {
  return id in PARENT && id !== "thrive" && id !== "style";
}

export const TAB_LABEL: Record<string, string> = { home: "Today", plan: "Plan", cleo: "Cleo", budget: "Bills", me: "Me" };
