#!/usr/bin/env python3
"""주간 호(issue) 보관: data/latest.csv(+weekly_note.md)를 data/archive/{기준일}.csv(.md)로
스냅샷하고 archive/index.json을 갱신한다. 기준일 = latest.csv의 가장 늦은 날짜.

수집 파이프라인이 latest.csv를 새로 쓰기 '전에' 이 스크립트를 돌려 지난 호를 보관한다.
손으로도 돌릴 수 있다: python3 scripts/archive_issue.py
같은 기준일을 다시 돌리면 그 호를 덮어쓴다(재보관).
"""
import csv
import json
import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "data")
ARC = os.path.join(DATA, "archive")

latest = os.path.join(DATA, "latest.csv")
if not os.path.exists(latest):
    raise SystemExit("data/latest.csv 없음 — 보관할 호가 없다")

with open(latest, encoding="utf-8") as f:
    rows = list(csv.reader(f))
dates = [r[0] for r in rows[1:] if r and len(r) >= 1 and len(r[0]) == 10]
base = max(dates)

os.makedirs(ARC, exist_ok=True)
shutil.copyfile(latest, os.path.join(ARC, base + ".csv"))
note = os.path.join(DATA, "weekly_note.md")
if os.path.exists(note):
    shutil.copyfile(note, os.path.join(ARC, base + ".md"))

idx_path = os.path.join(ARC, "index.json")
issues = []
if os.path.exists(idx_path):
    issues = json.load(open(idx_path, encoding="utf-8")).get("issues", [])
if base not in issues:
    issues.append(base)
issues.sort(reverse=True)
json.dump({"issues": issues}, open(idx_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"보관 완료: {base}호 (총 {len(issues)}개 호)")
