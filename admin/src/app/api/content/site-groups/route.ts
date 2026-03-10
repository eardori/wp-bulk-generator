import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const CACHE_DIR = join(process.cwd(), ".cache");
const GROUPS_CACHE = join(CACHE_DIR, "site-groups.json");

export type SiteGroup = {
  id: string;
  name: string;
  slugs: string[];
  createdAt: string;
};

function readGroups(): SiteGroup[] {
  if (!existsSync(GROUPS_CACHE)) return [];
  try {
    return JSON.parse(readFileSync(GROUPS_CACHE, "utf-8"));
  } catch {
    return [];
  }
}

function writeGroups(groups: SiteGroup[]) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(GROUPS_CACHE, JSON.stringify(groups, null, 2), "utf-8");
}

export async function GET() {
  try {
    const groups = readGroups();
    return Response.json({ groups });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "그룹 목록 조회 실패", groups: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, group } = body as { action: string; group: Partial<SiteGroup> & { id?: string } };
    const groups = readGroups();

    if (action === "create") {
      if (!group.name || !Array.isArray(group.slugs) || group.slugs.length === 0) {
        return Response.json({ error: "그룹 이름과 사이트를 입력하세요." }, { status: 400 });
      }
      const newGroup: SiteGroup = {
        id: `grp-${Date.now()}`,
        name: group.name.trim(),
        slugs: group.slugs,
        createdAt: new Date().toISOString(),
      };
      groups.push(newGroup);
      writeGroups(groups);
      return Response.json({ group: newGroup });
    }

    if (action === "update") {
      if (!group.id) return Response.json({ error: "그룹 ID가 없습니다." }, { status: 400 });
      const idx = groups.findIndex((g) => g.id === group.id);
      if (idx === -1) return Response.json({ error: "그룹을 찾을 수 없습니다." }, { status: 404 });
      if (group.name !== undefined) groups[idx].name = group.name.trim();
      if (Array.isArray(group.slugs)) groups[idx].slugs = group.slugs;
      writeGroups(groups);
      return Response.json({ group: groups[idx] });
    }

    if (action === "delete") {
      if (!group.id) return Response.json({ error: "그룹 ID가 없습니다." }, { status: 400 });
      const filtered = groups.filter((g) => g.id !== group.id);
      writeGroups(filtered);
      return Response.json({ ok: true });
    }

    return Response.json({ error: "알 수 없는 액션입니다." }, { status: 400 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "그룹 저장 실패" },
      { status: 500 }
    );
  }
}
