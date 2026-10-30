#!/usr/bin/env python3
"""헤르메스·아르고스 digest → 이 저장소의 공급 파일 갱신.

만드는 것:
  data/latest.csv       — 최근 90일 수집분 (date,title,url,source,note) · note = 큐레이터 요약·이유
  data/weekly_note.md   — 최신 하이라이트([논문]=헤르메스, [트렌드]=아르고스) = 요약 문단의 큐레이터 메모
  data/popularity.json  — 아르고스 랭킹(깃허브 ★·HF ♥)을 URL별 최신값으로
그다음 scripts/archive_issue.py를 불러 이번 기준일 호를 보관한다.

날짜 규칙은 팀 예시(W4)와 같다: 항목 날짜 = digest 날짜(소식으로 들어온 날).
경로는 환경변수 HERMES_VAULT / ARGUS_VAULT로 바꿀 수 있다(기본은 맥 경로 — VM에서는 env로 지정).
사용: python3 scripts/export_monitor.py [--no-archive]
  --no-archive: 공급 파일만 갱신하고 호 보관은 건너뛴다(데일리 크론용 — 호는 주 1회만 쌓는다).
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
from datetime import date, timedelta
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
HERMES = os.environ.get("HERMES_VAULT", os.path.expanduser("~/한양대학교/Hermes"))
ARGUS = os.environ.get("ARGUS_VAULT", os.path.expanduser("~/한양대학교/Argus"))
WINDOW_DAYS = 90

def digest_date(path):
    m = re.search(r"(\d{4}-\d{2}-\d{2})\.json$", path)
    return m.group(1) if m else None

def host(url):
    try:
        return (urlparse(url).hostname or "").removeprefix("www.")
    except ValueError:
        return ""

def load_items():
    """url 기준 중복 제거(첫 등장 날짜 유지)로 두 볼트의 digest를 합친다."""
    rows = {}
    def add(d8, title, url, note):
        title, url = (title or "").strip(), (url or "").strip()
        if not title or not url.startswith("http"):
            return
        if url not in rows:
            rows[url] = {"date": d8, "title": title, "url": url, "source": host(url), "note": note}
    for p in sorted(glob.glob(os.path.join(HERMES, "_data", "digests", "*.json"))):
        d8 = digest_date(p)
        if not d8 or d8 < CUTOFF:
            continue
        d = json.load(open(p, encoding="utf-8"))
        for g in d.get("groups", []):
            for it in g.get("papers", []):
                note = (it.get("summary_ko") or "").strip()
                if it.get("relevance") == "높음":
                    note += " — 내 논문 계획과 직결(관련도 높음)"
                elif it.get("relevance"):
                    note += " — 관련도 " + it["relevance"]
                add(d8, it.get("title"), it.get("url"), note)
    for p in sorted(glob.glob(os.path.join(ARGUS, "_data", "digests", "*.json"))):
        d8 = digest_date(p)
        if not d8 or d8 < CUTOFF:
            continue
        d = json.load(open(p, encoding="utf-8"))
        for g in d.get("groups") or d.get("channels") or []:
            for it in g.get("items") or g.get("papers") or []:
                note = (it.get("summary_ko") or "").strip()
                if it.get("why_ko"):
                    note += (" — " if note else "") + "왜 뜨나: " + it["why_ko"].strip()
                add(d8, it.get("title"), it.get("url"), note)
    return sorted(rows.values(), key=lambda r: (r["date"], r["title"]))

def latest_highlight(vault):
    best = None
    for p in sorted(glob.glob(os.path.join(vault, "_data", "digests", "*.json"))):
        d8 = digest_date(p)
        if not d8:
            continue
        hl = (json.load(open(p, encoding="utf-8")).get("highlight_ko") or "").strip()
        if hl:
            best = (d8, hl)
    return best

def build_popularity():
    pop = {}
    for p in sorted(glob.glob(os.path.join(ARGUS, "_data", "rankings", "*.json"))):
        d8 = digest_date(p)
        if not d8 or d8 < CUTOFF:
            continue
        d = json.load(open(p, encoding="utf-8"))
        for it in d.get("github", []) or []:
            m = re.sub(r"[^\d]", "", it.get("metric") or "")
            if it.get("url") and m:
                pop[it["url"]] = {"pop": int(m), "metric": "★ " + format(int(m), ",")}
        for it in d.get("huggingface", []) or []:
            m = re.sub(r"[^\d]", "", it.get("metric") or "")
            if it.get("url") and m:
                v = {"pop": int(m), "metric": "♥ " + format(int(m), ",")}
                if it.get("downloads"):
                    v["metric"] += " · " + it["downloads"]
                pop[it["url"]] = v
    return pop

today = date.today().isoformat()
CUTOFF = (date.today() - timedelta(days=WINDOW_DAYS)).isoformat()

items = load_items()
if len(items) < 30:
    sys.exit(f"수집분이 {len(items)}건뿐이라 중단 — digest 경로를 확인할 것 (HERMES_VAULT/ARGUS_VAULT)")

with open(os.path.join(REPO, "data", "latest.csv"), "w", encoding="utf-8", newline="") as f:
    w = csv.writer(f)
    w.writerow(["date", "title", "url", "source", "note"])
    for r in items:
        w.writerow([r["date"], r["title"], r["url"], r["source"], r["note"]])

h, a = latest_highlight(HERMES), latest_highlight(ARGUS)
parts = []
if h:
    parts.append(f"[논문 · {h[0]}] {h[1]}")
if a:
    parts.append(f"[트렌드 · {a[0]}] {a[1]}")
with open(os.path.join(REPO, "data", "weekly_note.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(parts) + "\n")

pop = build_popularity()
pop_out = {"_comment": f"아르고스 랭킹(_data/rankings)에서 자동 생성 · {today} · URL별 최신값"}
pop_out.update(pop)
with open(os.path.join(REPO, "data", "popularity.json"), "w", encoding="utf-8") as f:
    json.dump(pop_out, f, ensure_ascii=False, indent=1)

base = max(r["date"] for r in items)
print(f"latest.csv {len(items)}건 (기준일 {base} · 창 {CUTOFF}~) · note 있음 {sum(1 for r in items if r['note'])}건")
print(f"weekly_note {len(parts)}단락 · popularity {len(pop)}건")
if "--no-archive" in sys.argv[1:]:
    print("호 보관 생략 (--no-archive)")
else:
    subprocess.run([sys.executable, os.path.join(HERE, "archive_issue.py")], check=True)
