// 화면 전체 (v0.5 전면 개편 · 유경). 판단 기준은 전부 rules.js — 여기는 계산해 그리기만 한다.
// 구성: 요약 문단 → 주제 카드(관제판·크로스필터) → 먼저 읽을 것(유형 필터) → 깔아볼 것 →
//       주별 추이 → 특이 키워드 → 키워드 연결망 → 주제별 중요도 상위 3 → 미분류(접힘)
// 크로스필터: 주제 카드를 누르면 아래 전체가 그 주제 기준으로 바뀐다. 다시 누르면 해제.
window.ATM = window.ATM || {};

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var COLORS = ["--t1", "--t2", "--t3", "--t4", "--t5", "--t6", "--t7", "--t8"];
  var GRADE_RANK = { A: 0, B: 1, C: 2, D: 3 };
  var WIN = [{ k: "90d", label: "90일", days: 90 }, { k: "30d", label: "30일", days: 30 }, { k: "7d", label: "7일", days: 7 }, { k: "1d", label: "전날", days: 1 }];

  // 상태: S = 이번 입력의 계산 결과, SEL/CUR/KIND/IMODE = 화면 선택
  var S = null, TOPIC_COLOR = {}, SEL = null, CUR = "30d", KIND = null, IMODE = "pop";

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function gradeChip(it) { return '<span class="grade g' + it.grade + '" title="' + esc(it.gradeReason) + '">' + it.grade + '</span>'; }
  function topicChips(ts) { return ts.map(function (t) { return '<span class="chip"><span class="dot" style="background:' + (TOPIC_COLOR[t] || "var(--tu)") + '"></span> ' + esc(t) + '</span>'; }).join(""); }
  // ── 트리아지: 읽음 ✓ · 별표 ★ — URL 기준, 이 브라우저의 localStorage에만 저장 (서버 없음) ──
  var TRI = { read: {}, star: {} }, STARF = false;
  (function () { try { var t = JSON.parse(localStorage.getItem("atm-triage")); if (t) TRI = t; } catch (e) {} if (!TRI.read) TRI.read = {}; if (!TRI.star) TRI.star = {}; })();
  function triSave() { try { localStorage.setItem("atm-triage", JSON.stringify(TRI)); } catch (e) {} }
  function isRead(it) { return !!TRI.read[it.url]; }
  function isStar(it) { return !!TRI.star[it.url]; }
  function triBtns(it) {
    return '<span class="tri">' +
      '<button type="button" class="tbtn' + (isRead(it) ? " on" : "") + '" data-act="read" data-url="' + esc(it.url) + '" aria-pressed="' + isRead(it) + '" title="읽음 표시 — 먼저 읽을 것에서 빠지고 다음 후보가 올라옵니다">✓</button>' +
      '<button type="button" class="tbtn star' + (isStar(it) ? " on" : "") + '" data-act="star" data-url="' + esc(it.url) + '" aria-pressed="' + isStar(it) + '" title="별표 — 별표 필터로 모아 봅니다">' + (isStar(it) ? "★" : "☆") + '</button></span>';
  }
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest ? ev.target.closest(".tbtn") : null;
    if (!b || !S) return;
    ev.preventDefault(); ev.stopPropagation();
    var map = b.dataset.act === "read" ? TRI.read : TRI.star, url = b.dataset.url;
    if (map[url]) delete map[url]; else map[url] = new Date().toISOString().slice(0, 10);
    triSave();
    renderReads(); renderInstalls(); renderGrid();
  });

  // 제목 마우스오버: 이 글이 나에게 왜 도움이 되는지 — 파이프라인 note(큐레이터 요약·이유) 우선, 없으면 규칙 기반
  function whyText(it) {
    if (it.note) return it.note;
    return (it.topics.length ? "내 축 '" + it.topics.join(" · ") + "'에 걸림" : "어느 축에도 안 걸림(사전 보강 후보)") +
      " · " + (it.kind || "기타") + " · " + it.grade + "등급 · 중요도 " + it.score.toFixed(2);
  }
  function titleLink(it) {
    return '<a class="t" href="' + esc(it.url) + '" data-why="' + esc(whyText(it)) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>';
  }
  function byImp(a, b) { return b.score - a.score || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || a.line - b.line; }
  function day(s) { return Date.parse(s + "T00:00:00Z") / 864e5; }
  function inWin(it, a, b) { var age = day(S.base) - day(it.date); return age >= a && age < b; }
  function winOf(k) { for (var i = 0; i < WIN.length; i++) if (WIN[i].k === k) return WIN[i]; }
  function pool() { return SEL ? S.items.filter(function (i) { return i.topics.indexOf(SEL) >= 0; }) : S.items; }

  // ── 특이 키워드: rules.distinct의 불용어 + 희소성 가중 ──
  function keep(k) {
    var d = RULES.distinct || {}, lo = k.toLowerCase();
    return (d.stopEn || []).indexOf(lo) < 0 && (d.stopKo || []).indexOf(k) < 0;
  }
  function kwCount(items, a, b) {
    var c = {};
    items.forEach(function (it) {
      if (!inWin(it, a, b)) return;
      var seen = {};
      it.keywords.forEach(function (k) { if (!keep(k)) return; var lo = k.toLowerCase(); if (seen[lo]) return; seen[lo] = 1; c[lo] = (c[lo] || 0) + 1; });
    });
    return c;
  }
  function kwRank(k) {
    var w = winOf(k), P = pool();
    var cur = kwCount(P, 0, w.days), prev = kwCount(P, w.days, w.days * 2);
    return Object.keys(cur).map(function (lo) { return { lo: lo, kw: S.show[lo], count: cur[lo], prev: prev[lo] || 0, score: cur[lo] * Math.log(1 + S.items.length / S.df[lo]) }; })
      .sort(function (a, b) { return b.score - a.score || b.count - a.count || (a.lo < b.lo ? -1 : 1); });
  }

  // 설치형(깔아볼 것): 깃허브 리포 또는 HF 모델/데이터셋 — 블로그·논문 소개·이슈 링크는 아님
  function installable(u) {
    return /^https?:\/\/github\.com\/[^\/]+\/[^\/]+\/?$/.test(u) ||
      (/^https?:\/\/huggingface\.co\/(datasets\/)?[^\/]+\/[^\/]+\/?$/.test(u) && u.indexOf("/blog") < 0 && u.indexOf("/papers/") < 0);
  }

  // ── 입력이 바뀔 때: 계산 결과를 만들어 전체를 다시 그린다 ──
  // extras: { weeklyNote, topicNotes, popMap } — 수집 파이프라인이 공급(없어도 동작)
  ATM.renderAll = function (items, stats, extras) {
    extras = extras || {};
    var topics = Object.keys(RULES.topics);
    TOPIC_COLOR = {};
    topics.forEach(function (t, i) { TOPIC_COLOR[t] = "var(" + COLORS[i % COLORS.length] + ")"; });
    TOPIC_COLOR["미분류"] = "var(--tu)";

    // 출처 유형: 등급표 type → sourceKinds 그룹. 미등록 DOI 링크는 논문으로 본다.
    var kindOf = {};
    Object.keys(RULES.sourceKinds || {}).forEach(function (k) { (RULES.sourceKinds[k] || []).forEach(function (t) { kindOf[t] = k; }); });
    var popMap = extras.popMap || {};
    items.forEach(function (i) {
      i.kind = kindOf[i.gradeType] || (i.source === "doi.org" || i.source === "dx.doi.org" ? "논문" : "기타");
      var p = popMap[i.url] || {};
      i.pop = p.pop || 0; i.metric = p.metric || null;
    });

    var base = items.reduce(function (m, i) { return i.date > m ? i.date : m; }, "");
    var df = {}, show = {};
    items.forEach(function (it) {
      var seen = {};
      it.keywords.forEach(function (k) { if (!keep(k)) return; var lo = k.toLowerCase(); if (seen[lo]) return; seen[lo] = 1; df[lo] = (df[lo] || 0) + 1; if (!show[lo]) show[lo] = k; });
    });
    S = { items: items, stats: stats, base: base, topics: topics, df: df, show: show,
          weeklyNote: extras.weeklyNote || null, topicNotes: extras.topicNotes || {} };

    // 주별 추이 (월요일 시작)
    function monday(s) { var d = new Date(s + "T00:00:00Z"); var w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); }
    var weeks = []; items.forEach(function (i) { var w = monday(i.date); if (weeks.indexOf(w) < 0) weeks.push(w); }); weeks.sort();
    S.trend = weeks.map(function (w) {
      var W = items.filter(function (i) { return monday(i.date) === w; });
      var o = { week: w, partial: false };
      topics.forEach(function (t) { o[t] = W.filter(function (i) { return i.topics.indexOf(t) >= 0; }).length; });
      o["미분류"] = W.filter(function (i) { return !i.topics.length; }).length;
      return o;
    });
    if (S.trend.length) { var last = S.trend[S.trend.length - 1]; last.partial = (day(base) - day(last.week)) < 6; }

    S.topicStats = topics.map(function (t) {
      var T = items.filter(function (i) { return i.topics.indexOf(t) >= 0; });
      function n(a, b) { return T.filter(function (i) { return inWin(i, a, b); }).length; }
      return { topic: t, total: T.length, week: n(0, 7), prevWeek: n(7, 14), d30: n(0, 30) };
    });

    S.sorted = items.slice().sort(byImp);   // 먼저 읽을 것은 렌더 시점에 고른다 (읽음 표시를 반영하려고)

    SEL = null; KIND = null; STARF = false; // 새 입력이면 선택 초기화 (기간 탭·트리아지는 유지)
    buildTabs();
    refresh();
    renderUnclassified();
    renderMeta();
  };

  // 내보내기(마크다운)가 화면과 같은 순위를 쓰도록 특이 키워드 순위를 내준다
  ATM.distinctRanks = function () {
    var out = {};
    WIN.forEach(function (w) {
      var save = SEL; SEL = null;   // 내보내기는 전체 기준
      out[w.k] = { window: w.k, label: w.label + " (특이도순)", days: w.days,
        rank: kwRank(w.k).slice(0, 10).map(function (r) { return { keyword: r.kw, count: r.count, prev: r.prev }; }) };
      SEL = save;
    });
    return out;
  };

  function renderMeta() {
    var st = S.stats;
    $("meta").innerHTML = [
      '<span class="pill">기준일 <b class="num">' + S.base + '</b></span>',
      '<span class="pill">총 <b class="num">' + st.total + '</b>건 · 분류 <b class="num">' + st.classified + '</b></span>',
      '<span class="pill warn">미분류 <b class="num">' + st.unclassified + '</b>건</span>',
      '<span class="pill' + (st.skipped.length ? " warn" : "") + '">건너뜀 <b class="num">' + st.skipped.length + '</b>' +
        (st.skipped.length ? " · " + esc(st.skipped.map(function (s) { return s.line + "번(" + s.reason + ")"; }).join(", ")) : "") + '</span>',
      '<span class="pill">rules.js ' + esc(RULES.version.split(" ")[0]) + '</span>'
    ].join("");
  }

  // ── 요약 문단: 전체는 큐레이터 메모, 주제를 고르면 그 주제의 메모, 없으면 규칙 기반 문장 ──
  function noteTag(label) { return '<span class="muted" style="display:block;margin-top:6px;font-size:.74rem">' + label + ' · 기준일 ' + S.base + '</span>'; }
  function composeTopic(t) {
    var T = S.items.filter(function (i) { return i.topics.indexOf(t) >= 0; });
    var wk = T.filter(function (i) { return inWin(i, 0, 7); });
    var best = T.slice().sort(byImp)[0];
    var out = esc(t) + "은(는) 이번 주 " + wk.length + "건, 전체 " + T.length + "건입니다.";
    if (best) out += ' 지금 가장 위에 있는 글은 "' + esc(best.title) + '"(' + best.date + " · " + esc(best.source) + ")입니다.";
    return out;
  }
  function composeAll() {
    var wk = S.items.filter(function (i) { return inWin(i, 0, 7); });
    var top = S.topicStats.slice().sort(function (a, b) { return b.week - a.week; })[0];
    var best = wk.filter(function (i) { return i.topics.length; }).sort(byImp)[0];
    var kws = kwRank("7d").slice(0, 2).map(function (k) { return k.kw; });
    var out = top ? "이번 주에는 " + esc(top.topic) + " 글이 " + top.week + "건으로 가장 많았습니다." : "";
    if (best) out += ' 그중 눈에 띄는 것은 "' + esc(best.title) + '"(' + esc(best.source) + ")입니다.";
    if (kws.length) out += " 키워드로는 " + esc(kws.join("과 ")) + "이(가) 새로 올라왔습니다.";
    out += " 분류되지 않은 글이 " + S.stats.unclassified + "건 있어 사전 보강 후보로 남겨 두었습니다.";
    return out;
  }
  function renderDigest() {
    if (SEL) $("digest").innerHTML = (S.topicNotes[SEL] ? esc(S.topicNotes[SEL]).replace(/\n+/g, "<br>") + noteTag("큐레이터 메모 — " + esc(SEL)) : composeTopic(SEL) + noteTag("자동 요약 — " + esc(SEL)));
    else if (S.weeklyNote) $("digest").innerHTML = esc(S.weeklyNote).replace(/\n+/g, "<br>") + noteTag("큐레이터 메모 · 이번 주 수집 " + S.items.filter(function (i) { return inWin(i, 0, 7); }).length + "건");
    else $("digest").innerHTML = composeAll() + noteTag("자동 요약");
  }

  function badges() {
    ["b-topic", "b-read", "b-inst", "b-trend", "b-kw", "b-net", "b-grid"].forEach(function (id) {
      var b = $(id); if (!b) return;
      if (SEL) { b.style.display = "inline-flex"; b.innerHTML = '<span class="dot" style="background:' + TOPIC_COLOR[SEL] + '"></span>' + esc(SEL); }
      else b.style.display = "none";
    });
  }

  function renderTopics() {
    $("topics").innerHTML = "";
    S.topicStats.forEach(function (s) {
      var c = el("article", "topic" + (s.total ? "" : " empty") + (SEL === s.topic ? " sel" : SEL ? " dim" : ""));
      c.style.setProperty("--tc", TOPIC_COLOR[s.topic]);
      if (S.topicNotes[s.topic]) c.title = S.topicNotes[s.topic];
      var d = s.week - s.prevWeek, cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
      var sign = d > 0 ? "▲ " + d : d < 0 ? "▼ " + (-d) : "–";
      var series = S.trend.map(function (w) { return w[s.topic]; });
      var max = Math.max(1, Math.max.apply(null, series.concat([0])));
      var pts = series.length < 2 ? "" : series.map(function (v, i) { return (i / (series.length - 1) * 100).toFixed(1) + "," + (30 - v / max * 26).toFixed(1); }).join(" ");
      c.innerHTML = '<span class="name"><span class="dot" style="background:var(--tc)"></span>' + esc(s.topic) + '</span>' +
        '<div class="row" style="align-items:baseline"><span class="big">' + s.week + '</span><span class="muted" style="font-size:.75rem">이번 주</span>' +
        '<span class="delta ' + cls + '" style="margin-left:auto">' + sign + '</span></div>' +
        '<span class="muted" style="font-size:.74rem">지난주 <span class="num">' + s.prevWeek + '</span> · 30일 <span class="num">' + s.d30 + '</span> · 전체 <span class="num">' + s.total + '</span></span>' +
        '<svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="var(--tc)" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>' +
        (s.total ? "" : '<span class="muted" style="font-size:.72rem">이 입력에는 해당 건이 없음</span>');
      c.addEventListener("click", function () { SEL = (SEL === s.topic ? null : s.topic); refresh(); });
      $("topics").appendChild(c);
    });
  }

  function readCard(it) {
    var c = el("article", "read");
    c.innerHTML = '<div class="row"><span class="num muted" style="font-size:.75rem">' + it.date + '</span>' + gradeChip(it) +
      '<span class="lab">' + esc(it.kind || "기타") + '</span>' + (it.recent === false ? '<span class="lab">이번 주 없음</span>' : '') +
      '<span class="num" style="margin-left:auto;font-size:.8rem;color:var(--ink)">' + it.score.toFixed(2) + '</span>' + triBtns(it) + '</div>' +
      titleLink(it) +
      '<div class="row">' + topicChips(it.topics) + '</div>' +
      '<span class="muted" style="font-size:.74rem">' + esc(it.source) + '</span>';
    return c;
  }
  function readPoolK() {
    var EXK = RULES.readExcludeKinds || [];
    return pool().filter(function (i) { return EXK.indexOf(i.kind) < 0 && (!KIND || i.kind === KIND) && !isRead(i); });
  }
  // 축마다 1건: 읽음·제외 유형을 뺀 뒤 최근 7일 우선 — 읽음을 누르면 다음 후보가 올라온다
  function pickReadNext() {
    var EXK = RULES.readExcludeKinds || [];
    return S.topics.map(function (t) {
      var T = S.sorted.filter(function (i) { return i.topics.indexOf(t) >= 0 && EXK.indexOf(i.kind) < 0 && !isRead(i); });
      if (!T.length) return null;
      var w = null; for (var j = 0; j < T.length; j++) { if (inWin(T[j], 0, 7)) { w = T[j]; break; } }
      var it = w || T[0];
      var c = Object.create(it); c.recent = !!w;
      return c;
    }).filter(Boolean);
  }
  function renderReads() {
    $("reads").innerHTML = "";
    var list;
    if (STARF) {
      list = pool().filter(isStar).sort(byImp).slice(0, 12);
      $("reads-q").textContent = (SEL ? SEL + " · " : "") + "별표한 글 " + list.length + "건 (읽음 포함)";
    }
    else if (KIND) { list = readPoolK().slice().sort(byImp).slice(0, 8); $("reads-q").textContent = (SEL ? SEL + " · " : "") + KIND + " 중요도 상위 " + list.length + "건 · 읽음 제외"; }
    else if (SEL) { list = readPoolK().slice().sort(byImp).slice(0, 4); $("reads-q").textContent = "선택한 주제의 중요도 상위 4건 (언론·읽음 제외)"; }
    else { list = pickReadNext(); $("reads-q").textContent = "축(주제)마다 중요도 1위 1건 — 최근 7일 우선, 없으면 전체 1위 · 언론·읽음 제외"; }
    list.forEach(function (it) { $("reads").appendChild(readCard(it)); });
    if (!list.length) $("reads").innerHTML = '<p class="muted" style="margin:0;font-size:.84rem">' + (STARF ? "별표한 글이 없음 — 카드의 ☆을 눌러 모아 두세요" : "해당하는 글이 없음") + '</p>';
    var sc = document.getElementById("star-chip");
    if (sc) { var n = S.items.filter(isStar).length; sc.innerHTML = (STARF ? "★" : "☆") + " 별표 " + n; sc.setAttribute("aria-selected", String(STARF)); }
    Array.prototype.forEach.call($("kind-tabs").children, function (b) {
      if (b.id === "star-chip") return;
      b.setAttribute("aria-selected", String(!STARF && (b.dataset.k || null) === KIND));
    });
  }

  function renderInstalls() {
    $("installs").innerHTML = "";
    var cand = pool().filter(function (i) { return i.topics.length && installable(i.url); });
    if (IMODE === "pop") cand.sort(function (a, b) { return GRADE_RANK[a.grade] - GRADE_RANK[b.grade] || b.pop - a.pop || b.score - a.score; });
    else cand.sort(function (a, b) { return (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || b.pop - a.pop || b.score - a.score; });
    $("inst-q").textContent = IMODE === "pop" ? "등급 높은 순 → ★/♥ 순 상위 3 (코드 저장소는 루브릭상 C가 상한)" : "수집일 최신 우선 → ★/♥ 순 상위 3";
    if (!cand.length) $("installs").innerHTML = '<p class="muted" style="margin:0;font-size:.84rem">' + (SEL ? "이 주제에 걸린 설치형 항목이 없음" : "설치형 항목이 없음") + '</p>';
    cand.slice(0, 3).forEach(function (it) {
      var c = el("article", "read inst");
      c.innerHTML = '<div class="row"><span class="num muted" style="font-size:.75rem">' + it.date + '</span>' + gradeChip(it) +
        (it.metric ? '<span class="pop" style="margin-left:auto">' + esc(it.metric) + '</span>' : '') + triBtns(it) + '</div>' +
        titleLink(it) +
        '<div class="row">' + topicChips(it.topics) + '</div>' +
        '<span class="muted" style="font-size:.74rem">' + esc(it.source) + '</span>';
      $("installs").appendChild(c);
    });
    Array.prototype.forEach.call($("inst-tabs").children, function (b) { b.setAttribute("aria-selected", String(b.dataset.m === IMODE)); });
  }

  var trendOn = {};
  function renderLegend() {
    var series = S.topics.concat(["미분류"]);
    $("legend").innerHTML = "";
    series.forEach(function (s) {
      var b = el("button", null, '<span class="dot" style="background:' + TOPIC_COLOR[s] + '"></span>' + esc(s));
      b.setAttribute("aria-pressed", String(!!trendOn[s]));
      b.addEventListener("click", function () { trendOn[s] = !trendOn[s]; b.setAttribute("aria-pressed", String(trendOn[s])); drawTrend(); });
      $("legend").appendChild(b);
    });
  }
  function drawTrend() {
    var n = S.trend.length;
    if (n < 2) { $("trend").innerHTML = '<text x="20" y="30">주가 2개 이상일 때 그립니다</text>'; return; }
    var series = S.topics.concat(["미분류"]).filter(function (s) { return trendOn[s]; });
    var W = 640, H = 260, L = 34, R = 10, T = 12, Bm = 28;
    var max = 1; S.trend.forEach(function (w) { series.forEach(function (s) { max = Math.max(max, w[s]); }); });
    var x = function (i) { return L + i * (W - L - R) / (n - 1); };
    var y = function (v) { return T + (1 - v / max) * (H - T - Bm); };
    var h = "";
    for (var g = 0; g <= 4; g++) { var gv = max * g / 4, gy = y(gv); h += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '" stroke="var(--line)" stroke-width="1"/><text x="' + (L - 6) + '" y="' + (gy + 3) + '" text-anchor="end">' + Math.round(gv) + '</text>'; }
    S.trend.forEach(function (w, i) { if (i % 2 === 0 || i === n - 1) h += '<text x="' + x(i) + '" y="' + (H - 14) + '" text-anchor="' + (i === n - 1 ? "end" : i === 0 ? "start" : "middle") + '">' + w.week.slice(5).replace("-", "/") + '</text>'; });
    series.forEach(function (s) {
      var last = S.trend[n - 1].partial;
      var full = S.trend.slice(0, last ? n - 1 : n).map(function (w, i) { return x(i) + "," + y(w[s]); }).join(" ");
      h += '<polyline points="' + full + '" fill="none" stroke="' + TOPIC_COLOR[s] + '" stroke-width="2"/>';
      if (last) { h += '<polyline points="' + [x(n - 2) + "," + y(S.trend[n - 2][s]), x(n - 1) + "," + y(S.trend[n - 1][s])].join(" ") + '" fill="none" stroke="' + TOPIC_COLOR[s] + '" stroke-width="2" stroke-dasharray="3 4"/><circle cx="' + x(n - 1) + '" cy="' + y(S.trend[n - 1][s]) + '" r="3.5" fill="var(--card)" stroke="' + TOPIC_COLOR[s] + '" stroke-width="2"/>'; }
    });
    $("trend").innerHTML = h;
  }

  function renderKw() {
    var w = winOf(CUR), r = kwRank(CUR).slice(0, 10);
    $("kw").innerHTML = r.map(function (k, i) {
      var d = k.count - k.prev;
      var dd = k.prev === 0 ? '<span style="color:var(--up)">새로</span>' : d > 0 ? '<span style="color:var(--up)">▲' + d + '</span>' : d < 0 ? '<span style="color:var(--down)">▼' + (-d) + '</span>' : '–';
      return '<tr><td class="n">' + (i + 1) + '</td><td title="특이도 ' + k.score.toFixed(1) + ' · 전체 기간 ' + S.df[k.lo] + '건">' + esc(k.kw) + '</td><td class="n">' + k.count + '</td><td class="n">' + dd + '</td></tr>';
    }).join("") || '<tr><td colspan="4" class="muted">이 기간·주제에는 키워드가 없음</td></tr>';
    Array.prototype.forEach.call($("kw-tabs").children, function (b) { b.setAttribute("aria-selected", String(b.dataset.w === CUR)); });
    $("h-kw").textContent = "특이 키워드 — " + w.label;
  }

  function renderNet() {
    var d = RULES.distinct || {}, TOPN = d.graphTop || 18, MINCO = d.graphMinCo || 2;
    var w = winOf(CUR), P = pool().filter(function (it) { return inWin(it, 0, w.days); });
    var top = kwRank(CUR).slice(0, TOPN), idx = {}, nodes = [];
    top.forEach(function (k, i) { idx[k.lo] = i; nodes.push({ lo: k.lo, kw: k.kw, count: k.count, tc: {} }); });
    var eMap = {};
    P.forEach(function (it) {
      var ks = [], seen = {};
      it.keywords.forEach(function (k) { var lo = k.toLowerCase(); if (idx[lo] == null || seen[lo]) return; seen[lo] = 1; ks.push(lo); });
      ks.forEach(function (lo) { (it.topics.length ? it.topics : ["미분류"]).forEach(function (t) { nodes[idx[lo]].tc[t] = (nodes[idx[lo]].tc[t] || 0) + 1; }); });
      for (var i = 0; i < ks.length; i++) for (var j = i + 1; j < ks.length; j++) { var key = idx[ks[i]] < idx[ks[j]] ? idx[ks[i]] + "|" + idx[ks[j]] : idx[ks[j]] + "|" + idx[ks[i]]; eMap[key] = (eMap[key] || 0) + 1; }
    });
    var edges = Object.keys(eMap).filter(function (k) { return eMap[k] >= MINCO; }).map(function (k) { var p = k.split("|"); return { a: +p[0], b: +p[1], w: eMap[k] }; });
    if (edges.length < 4) edges = Object.keys(eMap).map(function (k) { var p = k.split("|"); return { a: +p[0], b: +p[1], w: eMap[k] }; });
    var deg = {}; edges.forEach(function (e) { deg[e.a] = 1; deg[e.b] = 1; });
    var remap = {}, kept = [];
    nodes.forEach(function (nd, i) { if (deg[i]) { remap[i] = kept.length; kept.push(nd); } });
    edges = edges.map(function (e) { return { a: remap[e.a], b: remap[e.b], w: e.w }; });
    nodes = kept;
    nodes.forEach(function (nd) { var best = null; Object.keys(nd.tc).forEach(function (t) { if (!best || nd.tc[t] > nd.tc[best]) best = t; }); nd.topic = best || "미분류"; });
    var Wd = 960, Hd = 420, cx = Wd / 2, cy = Hd / 2;
    nodes.forEach(function (nd, i) { var a = i / Math.max(1, nodes.length) * Math.PI * 2; nd.x = cx + Math.cos(a) * 150; nd.y = cy + Math.sin(a) * 120; });
    for (var it2 = 0; it2 < 220; it2++) {
      var k = 0.02;
      for (var i = 0; i < nodes.length; i++) for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y, d2 = dx * dx + dy * dy + 0.01, f = Math.min(1700 / d2, 4);
        var fx = dx * f, fy = dy * f; nodes[i].x -= fx; nodes[i].y -= fy; nodes[j].x += fx; nodes[j].y += fy;
      }
      edges.forEach(function (e) {
        var a = nodes[e.a], b = nodes[e.b], dx = b.x - a.x, dy = b.y - a.y, dd = Math.sqrt(dx * dx + dy * dy) || 1;
        var f = (dd - 95) * k * Math.min(e.w, 3); var fx = dx / dd * f, fy = dy / dd * f;
        a.x += fx; a.y += fy; b.x -= fx; b.y -= fy;
      });
      nodes.forEach(function (nd) { nd.x += (cx - nd.x) * 0.03; nd.y += (cy - nd.y) * 0.035; nd.x = Math.max(60, Math.min(Wd - 60, nd.x)); nd.y = Math.max(30, Math.min(Hd - 24, nd.y)); });
    }
    var svg = $("net"); svg.classList.remove("focus");
    var h = edges.map(function (e, i) {
      return '<line class="edge" data-i="' + i + '" x1="' + nodes[e.a].x.toFixed(1) + '" y1="' + nodes[e.a].y.toFixed(1) + '" x2="' + nodes[e.b].x.toFixed(1) + '" y2="' + nodes[e.b].y.toFixed(1) + '" stroke-width="' + Math.min(1 + e.w * 0.7, 3.5) + '"/>';
    }).join("");
    h += nodes.map(function (nd, i) {
      var r = Math.min(6 + Math.sqrt(nd.count) * 2.4, 15);
      return '<g class="node" data-i="' + i + '"><circle cx="' + nd.x.toFixed(1) + '" cy="' + nd.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + (TOPIC_COLOR[nd.topic] || "var(--tu)") + '"><title>' + esc(nd.kw) + ' · ' + nd.count + '건 · 주제: ' + esc(nd.topic) + '</title></circle>' +
        '<text x="' + nd.x.toFixed(1) + '" y="' + (nd.y - r - 5).toFixed(1) + '" text-anchor="middle">' + esc(nd.kw) + '</text></g>';
    }).join("");
    svg.innerHTML = h;
    $("net-note").textContent = nodes.length ? winOf(CUR).label + " 기준 특이 키워드 중 동시 등장 연결이 있는 " + nodes.length + "개 · 선 = 같은 기사 동시 등장(굵을수록 잦음) · 점 색 = 가장 많이 붙은 주제" : "이 기간·주제에는 연결할 키워드가 없음";
    var gs = svg.querySelectorAll("g.node"), ls = svg.querySelectorAll("line.edge");
    gs.forEach(function (g) {
      g.addEventListener("click", function (ev) {
        ev.stopPropagation();
        var i = +g.dataset.i, keepN = {}; keepN[i] = 1;
        ls.forEach(function (l, li) { var e = edges[li]; var hit = e.a === i || e.b === i; l.classList.toggle("hl", hit); if (hit) { keepN[e.a] = 1; keepN[e.b] = 1; } });
        gs.forEach(function (g2) { g2.classList.toggle("hl", !!keepN[+g2.dataset.i]); });
        svg.classList.add("focus");
      });
    });
    svg.addEventListener("click", function () { svg.classList.remove("focus"); gs.forEach(function (g2) { g2.classList.remove("hl"); }); ls.forEach(function (l) { l.classList.remove("hl"); }); });
  }

  function renderGrid() {
    $("grid").innerHTML = "";
    var show = SEL ? [SEL] : S.topics;
    show.forEach(function (t) {
      var list = S.items.filter(function (i) { return i.topics.indexOf(t) >= 0; }).sort(byImp).slice(0, 3);
      var c = el("article", "gcard");
      if (SEL) c.style.gridColumn = "1 / -1";
      if (S.topicNotes[t]) c.title = S.topicNotes[t];
      c.innerHTML = '<h3><span class="dot" style="background:' + TOPIC_COLOR[t] + ';margin-right:6px"></span>' + esc(t) + '</h3>' +
        (list.length ? '<ol>' + list.map(function (it) {
          return '<li' + (isRead(it) ? ' class="readed"' : '') + '><a href="' + esc(it.url) + '" data-why="' + esc(whyText(it)) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a>' +
            '<div class="row" style="margin-top:3px">' + gradeChip(it) + '<span class="s">' + it.date.slice(5) + ' · ' + it.score.toFixed(2) + '</span>' + triBtns(it) + '</div></li>';
        }).join("") + '</ol>' : '<p class="muted" style="margin:0;font-size:.8rem">이 입력에는 해당 기사가 없음</p>');
      $("grid").appendChild(c);
    });
  }

  function renderUnclassified() {
    var un = S.items.filter(function (i) { return !i.topics.length; }).sort(function (a, b) { return b.date < a.date ? -1 : 1; }).slice(0, 12);
    $("unc").innerHTML = "";
    un.forEach(function (it) {
      var r = el("div", "it");
      r.innerHTML = '<span class="num muted">' + it.date + '</span><a href="' + esc(it.url) + '" data-why="' + esc(whyText(it)) + '" target="_blank" rel="noopener">' + esc(it.title) + '</a><span class="lab">' + esc(it.kind) + ' · ' + esc(it.source) + '</span>';
      $("unc").appendChild(r);
    });
    $("unc-sum").textContent = "최근 " + un.length + "건 펼쳐 보기 — 전체 미분류 " + S.stats.unclassified + "건";
  }

  function buildTabs() {
    $("kw-tabs").innerHTML = "";
    WIN.forEach(function (w) {
      var b = el("button", null, w.label); b.dataset.w = w.k; b.setAttribute("role", "tab");
      b.addEventListener("click", function () { CUR = w.k; renderKw(); renderNet(); });
      $("kw-tabs").appendChild(b);
    });
    $("inst-tabs").innerHTML = "";
    [{ m: "pop", label: "인기 상위" }, { m: "recent", label: "최근 급상승" }].forEach(function (t) {
      var b = el("button", null, t.label); b.dataset.m = t.m; b.setAttribute("role", "tab");
      b.addEventListener("click", function () { IMODE = t.m; renderInstalls(); });
      $("inst-tabs").appendChild(b);
    });
    $("kind-tabs").innerHTML = "";
    var EXK = RULES.readExcludeKinds || [];
    var order = Object.keys(RULES.sourceKinds || {}).concat(["기타"]).filter(function (k) { return EXK.indexOf(k) < 0; });
    var have = {}; S.items.forEach(function (i) { if (EXK.indexOf(i.kind) < 0) have[i.kind] = (have[i.kind] || 0) + 1; });
    [{ k: null, label: "전체" }].concat(order.filter(function (k) { return have[k]; }).map(function (k) { return { k: k, label: k + " " + have[k] }; }))
      .forEach(function (t) {
        var b = el("button", null, t.label); if (t.k) b.dataset.k = t.k; b.setAttribute("role", "tab");
        b.addEventListener("click", function () { STARF = false; KIND = (KIND === t.k ? null : t.k); renderReads(); });
        $("kind-tabs").appendChild(b);
      });
    var sb = el("button", null, "☆ 별표 0"); sb.id = "star-chip"; sb.setAttribute("role", "tab");
    sb.addEventListener("click", function () { STARF = !STARF; renderReads(); });
    $("kind-tabs").appendChild(sb);
  }

  function refresh() {
    var series = S.topics.concat(["미분류"]);
    if (SEL) series.forEach(function (s) { trendOn[s] = (s === SEL); });
    else series.forEach(function (s) { trendOn[s] = true; });
    badges(); renderDigest(); renderTopics(); renderReads(); renderInstalls();
    renderLegend(); drawTrend(); renderKw(); renderNet(); renderGrid();
  }
})();
