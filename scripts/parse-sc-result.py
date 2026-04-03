import json
with open("/tmp/sc-result.txt") as f:
    lines = f.readlines()
for line in lines:
    line = line.strip()
    if line.startswith("data: "):
        line = line[6:]
    try:
        d = json.loads(line)
        t = d.get("type","")
        if t == "step-done" and d.get("step") == 1:
            print("=== DISCOVERY (Step 1) ===")
            disc = d.get("discovery", {})
            for k,v in disc.items():
                print(f"  {k}: {v}")
        elif t == "category-done":
            print(f"  [{d.get('step')}] {d.get('label','')}: {d.get('score')}/{d.get('maxScore')}")
        elif t == "done":
            print("\n=== FINAL ===")
            print(f"  Score: {d.get('totalScore')}/100")
            print(f"  Grade: {d.get('grade')}")
            print(f"  Website: {d.get('websiteUrl')}")
            print(f"  CrawlFailed: {d.get('crawlFailed')}")
            print(f"  CrawlError: {d.get('crawlError','')}")
            print(f"  Sources: {d.get('discoveredSources')}")
            for c in d.get("categories",[]):
                print(f"    {c['label']}: {c['score']}/{c['maxScore']}")
                for it in c.get("items",[]):
                    st = "✅" if it["status"]=="pass" else ("⚠️" if it["status"]=="partial" else "❌")
                    print(f"      {st} {it['name']}: {it['actualScore']}/{it['maxScore']}")
    except:
        pass
