// 연결 (v0.5 · 유경): 입력 → 엔진(import·classify·keywords) → 화면(view). 약속은 js/README.md
// 파이프라인 공급 파일(있으면 쓰고 없어도 동작):
//   data/latest.csv      — 매일 수집분. 배포 주소에서 자동으로 읽는다
//   data/weekly_note.md  — 큐레이터 메모(첫 문단 = 전체, "## 주제명" = 주제별). latest.csv로 열었을 때만 보여 준다
//   data/popularity.json — url → { pop, metric } (깃허브 ★ · HF 좋아요). '깔아볼 것' 정렬에 쓴다
(function () {
  var $ = function (sel) { return document.querySelector(sel); };
  var state = { items: [], stats: null, baseDate: null, fromLatest: false };
  var supplied = { weeklyNote: null, topicNotes: {}, popMap: {} };

  function status(msg) { $("#input-status").textContent = msg; }

  function run() {
    if (!window.RULES) { status("rules.js가 아직 없습니다."); return; }
    var text = $("#csv-input").value;
    if (!text.trim()) { status("CSV를 붙여 넣거나 파일을 고르세요."); return; }

    var parsed = ATM.parseCSV(text);
    var items = ATM.classify(parsed.rows, RULES);
    var baseDate = items.reduce(function (max, it) { return it.date > max ? it.date : max; }, "");
    var unclassified = items.filter(function (it) { return !it.topics || it.topics.length === 0; });

    state.items = items;
    state.baseDate = baseDate;
    state.stats = {
      total: items.length,
      classified: items.length - unclassified.length,
      unclassified: unclassified.length,
      skipped: parsed.skipped
    };

    ATM.renderAll(items, state.stats, {
      weeklyNote: state.fromLatest ? supplied.weeklyNote : null,
      topicNotes: state.fromLatest ? supplied.topicNotes : {},
      popMap: supplied.popMap
    });

    $("#export-csv").disabled = $("#export-md").disabled = items.length === 0;
    var notes = (parsed.notes || []).join(" · ");
    status((items.length ? "기준일 " + baseDate + " · " + items.length + "건" : "읽은 기사가 없습니다. 건너뛴 줄의 이유를 확인하세요.") + (notes ? " · " + notes : ""));
  }

  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  $("#run").addEventListener("click", function () { state.fromLatest = false; run(); });

  $("#load-example").addEventListener("click", function () {
    if (!window.EXAMPLE_CSV) { status("예시 입력이 아직 없습니다."); return; }
    state.fromLatest = false;
    $("#csv-input").value = EXAMPLE_CSV;
    run();
  });

  $("#csv-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { state.fromLatest = false; $("#csv-input").value = reader.result; run(); };
    reader.readAsText(file, "utf-8");
  });

  $("#export-csv").addEventListener("click", function () {
    download("ai-trend-" + state.baseDate + ".csv", ATM.toCSV(state.items), "text/csv;charset=utf-8");
  });
  $("#export-md").addEventListener("click", function () {
    // 마크다운의 키워드 표가 화면(특이 키워드)과 같은 순위를 쓰도록 view의 순위를 넘긴다
    download("ai-trend-" + state.baseDate + ".md", ATM.toMarkdown(state.items, ATM.distinctRanks(), state.stats), "text/markdown;charset=utf-8");
  });

  // 파이프라인 공급 파일 읽기 (배포 주소에서만 · 실패해도 조용히 계속)
  function fetchText(path) {
    return fetch(path, { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); });
  }
  function loadSupplied() {
    if (!/^https?:$/.test(location.protocol) || !window.fetch) return Promise.resolve();
    var p1 = fetchText("data/weekly_note.md").then(function (raw) {
      var parts = raw.trim().split(/^## /m);
      supplied.weeklyNote = parts[0].trim() || null;
      parts.slice(1).forEach(function (p) { var nl = p.indexOf("\n"); supplied.topicNotes[p.slice(0, nl).trim()] = p.slice(nl + 1).trim(); });
    }).catch(function () {});
    var p2 = fetchText("data/popularity.json").then(function (raw) {
      var d = JSON.parse(raw);
      Object.keys(d).forEach(function (k) { if (k.indexOf("http") === 0) supplied.popMap[k] = d[k]; });
    }).catch(function () {});
    return Promise.all([p1, p2]);
  }

  // 열자마자 자동 불러오기 (입력 칸이 비어 있을 때만)
  // ① 배포 주소에서는 data/latest.csv — 매일 수집이 이 파일을 갱신하면 열 때마다 '이번 주 화면'이 된다
  // ② 그 파일이 없거나 file://로 열면 예시(data/example.js)로 대신한다
  function autoload() {
    if ($("#csv-input").value.trim()) return;
    function useExample(why) {
      if (!window.EXAMPLE_CSV) return;
      state.fromLatest = false;
      $("#csv-input").value = EXAMPLE_CSV;
      run();
      status($("#input-status").textContent + " · 예시 자동 불러옴" + (why ? " (" + why + ")" : ""));
    }
    if (!/^https?:$/.test(location.protocol) || !window.fetch) { useExample(); return; }
    fetchText("data/latest.csv")
      .then(function (text) {
        if (!text.trim() || $("#csv-input").value.trim()) { if (!text.trim()) useExample("latest.csv 비어 있음"); return; }
        state.fromLatest = true;
        $("#csv-input").value = text;
        run();
        status($("#input-status").textContent + " · data/latest.csv 자동 불러옴");
      })
      .catch(function () { useExample("latest.csv 없음"); });
  }

  loadSupplied().then(autoload);
})();
