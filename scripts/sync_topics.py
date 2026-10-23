#!/usr/bin/env python3
"""키워드설정.md(공용 KB) → AI 동향 모니터 rules.js 주제 사전 자동 동기화.

- KB의 활성 그룹(disabled 제외, no-collect 포함)마다 주제 1개를 만든다.
- 그룹의 `- name:` `- en:` `- ko:` `- exclude:` 항목이 주제 사전이 된다 (쉼표 구분).
- en:/ko:가 아직 없는 새 그룹은 수집 검색어를 토큰화(일반어 제거)해 임시 사전을
  만들어 끊기지 않게 하고, 요약에 '임시'로 표시한다.
- rules.js의 topics 블록(`  topics: {` ~ `  // ── W3` 직전)을 통째로 교체한다.
  이 블록은 자동 생성이므로 직접 고치지 말고 KB에서 고친다.

사용: python3 sync_monitor_topics.py <rules.js 경로> [키워드설정.md 경로]
"""
import datetime
import json
import os
import re
import sys

KB_DEFAULT = os.path.expanduser("~/한양대학교/Hermes/키워드설정.md")
GENERIC = set("""ai artificial intelligence generative llm llms large language model models
machine learning deep data digital framework frameworks management enterprise organizational
technology analysis approach based system systems quality""".split())


def parse_kb(text):
    groups, cur = [], None
    for line in text.splitlines():
        h = re.match(r"^##\s+(.*)$", line)
        if h:
            raw = h.group(1).strip()
            m = re.search(r"<!--\s*id:\s*([a-z0-9_]+)\s*(?:,\s*(disabled|no-collect)\s*)?-->", raw)
            if not m:
                cur = None
                continue
            if m.group(2) == "disabled":
                cur = None
                continue
            name = re.sub(r"<!--.*?-->", "", raw).strip()
            name = re.sub(r"^[①-⑳\s]+", "", name)          # 머리 번호 제거
            name = re.sub(r"\s*\([^)]*\)\s*$", "", name)      # 꼬리 괄호 제거
            name = re.sub(r"\s+/\s+[A-Za-z].*$", "", name)    # ' / English 별칭' 제거
            cur = {"id": m.group(1), "name": name, "en": [], "ko": [], "exclude": [], "queries": []}
            groups.append(cur)
            continue
        if cur is None:
            continue
        item = re.match(r"^\s*[-*]\s+(.+?)\s*$", line)
        if not item:
            continue
        q = item.group(1).strip()
        kv = re.match(r"^(name|en|ko|exclude)\s*:\s*(.*)$", q)
        if kv:
            key, val = kv.group(1), kv.group(2).strip()
            if key == "name":
                if val:
                    cur["name"] = val
            else:
                cur[key] += [w.strip() for w in val.split(",") if w.strip()]
        elif not q.startswith("<!--"):
            cur["queries"].append(q)
    return groups


def fallback_dict(queries):
    """en:/ko:가 없는 그룹용 — 수집 검색어를 토큰화해 임시 제목 키워드를 만든다."""
    toks = []
    for q in queries:
        for w in re.findall(r"[a-z0-9][a-z0-9.-]{2,}", q.lower()):
            if w not in GENERIC and w not in toks:
                toks.append(w)
    return toks


def js_arr(items):
    return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in items) + "]"


def build_topics_block(groups, stamp):
    lines = ["  topics: {",
             f"    // ★ 자동 생성 블록 — 키워드설정.md(공용 KB)에서 sync_monitor_topics.py가 재생성 ({stamp})",
             "    // 직접 고치지 말 것: 키워드는 KB의 그룹별 en:/ko:/exclude: 항목에서 고친다."]
    summary = []
    for i, g in enumerate(groups):
        en, ko, note = g["en"], g["ko"], ""
        if not en and not ko:
            en, note = fallback_dict(g["queries"]), " · 임시(수집 검색어 토큰화 — KB에 en:/ko:를 채우면 교체됨)"
        comma = "," if i < len(groups) - 1 else ""
        lines.append(f'    {json.dumps(g["name"], ensure_ascii=False)}: {{')
        lines.append(f'      // KB 그룹 {g["id"]}{note}')
        lines.append(f'      en: {js_arr(en)},')
        lines.append(f'      ko: {js_arr(ko)},')
        lines.append(f'      exclude: {js_arr(g["exclude"])}')
        lines.append(f'    }}{comma}')
        summary.append(f'{g["name"]}(en {len(en)}·ko {len(ko)}{"·임시" if note else ""})')
    lines.append("  },")
    return "\n".join(lines), summary


def main():
    rules_path = sys.argv[1]
    kb_path = sys.argv[2] if len(sys.argv) > 2 else KB_DEFAULT
    groups = parse_kb(open(kb_path, encoding="utf-8").read())
    if not groups:
        sys.exit("KB에서 활성 그룹을 못 찾음 — rules.js를 건드리지 않음")
    stamp = datetime.date.today().isoformat()
    block, summary = build_topics_block(groups, stamp)
    src = open(rules_path, encoding="utf-8").read().split("\n")
    t_start = next(i for i, l in enumerate(src) if l.startswith("  topics: {"))
    t_end = next(i for i, l in enumerate(src) if l.startswith("  // ── W3"))
    out = src[:t_start] + block.split("\n") + [""] + src[t_end:]
    open(rules_path, "w", encoding="utf-8").write("\n".join(out))
    print(f"동기화 완료 → {os.path.basename(rules_path)} · 주제 {len(groups)}개")
    for s in summary:
        print("  -", s)


if __name__ == "__main__":
    main()
