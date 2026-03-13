import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import type { FastifyInstance } from "fastify";

const GROUPS_PATH =
  process.env.GROUPS_PATH || "/home/ubuntu/wp-bridge-api/data/site-groups.json";

type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

function normalizeGroups(input: unknown): SiteGroup[] {
  if (Array.isArray(input)) {
    return input as SiteGroup[];
  }

  if (
    input &&
    typeof input === "object" &&
    Array.isArray((input as { groups?: unknown[] }).groups)
  ) {
    return (input as { groups: SiteGroup[] }).groups;
  }

  return [];
}

function readGroups(): SiteGroup[] {
  try {
    if (!existsSync(GROUPS_PATH)) return [];
    return normalizeGroups(JSON.parse(readFileSync(GROUPS_PATH, "utf-8")));
  } catch {
    return [];
  }
}

function writeGroups(groups: SiteGroup[]) {
  const dir = dirname(GROUPS_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(GROUPS_PATH, JSON.stringify(groups, null, 2));
}

export async function groupsRoutes(app: FastifyInstance) {
  app.get("/groups", async () => {
    return { groups: readGroups() };
  });

  app.post("/groups", async (req) => {
    const { action, group } = req.body as {
      action: "create" | "update" | "delete";
      group: Partial<SiteGroup> & { id?: string };
    };

    const groups = readGroups();

    if (action === "create") {
      const newGroup: SiteGroup = {
        id: `group-${Date.now()}`,
        name: group.name || "Untitled",
        slugs: group.slugs || [],
        createdAt: new Date().toISOString(),
      };
      groups.push(newGroup);
      writeGroups(groups);
      return { success: true, group: newGroup };
    }

    if (action === "update" && group.id) {
      const idx = groups.findIndex((g) => g.id === group.id);
      if (idx === -1) return { success: false, error: "Group not found" };
      groups[idx] = { ...groups[idx], ...group } as SiteGroup;
      writeGroups(groups);
      return { success: true, group: groups[idx] };
    }

    if (action === "delete" && group.id) {
      const filtered = groups.filter((g) => g.id !== group.id);
      writeGroups(filtered);
      return { success: true };
    }

    return { success: false, error: "Invalid action" };
  });
}
