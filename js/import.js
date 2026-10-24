// A · CSV 읽기·점검 (W6 · 유경). 약속은 js/README.md
window.ATM = window.ATM || {};

(function () {

// text → { rows: [{ line, date, title, url, source }], skipped: [{ line, reason }], notes: [문자열] }
// - 첫 줄은 머리글(date,title,url,source)로 보고 건너뛴다. line은 그 줄이 시작하는 원본 줄 번호(머리글 = 1)
// - 머리글의 열 이름으로 칸을 찾는다. 네 이름이 다 있으면 순서가 달라도 된다 (인접 팀 피드백)
// - 선택 열 note: 머리글에 note가 있으면 그 칸을 항목의 note(큐레이터 요약·이유)로 읽는다. 없으면 빈 문자열 (v0.5)
// - 첫 줄 첫 칸이 날짜면 머리글이 없는 파일로 보고 첫 줄도 기사로 읽는다. 어느 쪽이든 notes에 알린다
// - 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈은 칸 구분으로 보지 않는다. 칸 안의 ""는 " 하나 (RFC 4180)
// - 빈 줄, 날짜 칸이 빈 줄, 날짜가 YYYY-MM-DD(실제 있는 날짜)가 아닌 줄은 rows에 넣지 않고 skipped에 줄 번호와 이유를 남긴다
//   (형식이 다른 날짜가 한 줄이라도 섞이면 기준일과 모든 점수가 깨지기 때문 · #21 리뷰)
ATM.parseCSV = function (text) {
  var records = readRecords(String(text || "").replace(/^\uFEFF/, ""));
  var rows = [], skipped = [], notes = [];
  var head = readHeader(records[0]);
  var col = head.col;
  if (head.note) notes.push(head.note);

  records.slice(head.hasHeader ? 1 : 0).forEach(function (rec) {
    var f = COLUMNS.map(function (name) { return rec.fields[col[name]] || ""; });
    var empty = f.every(function (c) { return c.trim() === ""; });
    if (empty) { skipped.push({ line: rec.line, reason: "빈 줄" }); return; }
    var date = (f[0] || "").trim();
    if (!date) { skipped.push({ line: rec.line, reason: "날짜 없음" }); return; }
    if (!isDate(date)) { skipped.push({ line: rec.line, reason: "날짜 형식 오류 (YYYY-MM-DD 아님: " + date + ")" }); return; }
    rows.push({
      line: rec.line,
      date: date,
      title: (f[1] || "").trim(),
      url: (f[2] || "").trim(),
      source: (f[3] || "").trim(),
      note: col.note != null ? (rec.fields[col.note] || "").trim() : ""
    });
  });

  return { rows: rows, skipped: skipped, notes: notes };
};

var COLUMNS = ["date", "title", "url", "source"];

// 첫 레코드 → { hasHeader, col: { date: 칸 번호, … }, note }
function readHeader(rec) {
  var fixed = { date: 0, title: 1, url: 2, source: 3 };
  if (!rec) return { hasHeader: true, col: fixed };
  var names = rec.fields.map(function (c) { return c.trim().toLowerCase(); });
  if (isDate(names[0])) {
    return { hasHeader: false, col: fixed, note: "머리글이 없어 1번 줄부터 date,title,url,source 순서로 읽었습니다" };
  }
  var col = {}, missing = [];
  COLUMNS.forEach(function (name) {
    var i = names.indexOf(name);
    if (i < 0) missing.push(name); else col[name] = i;
  });
  if (missing.length) {
    return { hasHeader: true, col: fixed, note: "머리글에 " + missing.join(", ") + " 열이 없어 date,title,url,source 순서로 읽었습니다" };
  }
  var ni = names.indexOf("note");
  if (ni >= 0) col.note = ni;
  var same = COLUMNS.every(function (name) { return col[name] === fixed[name]; });
  return { hasHeader: true, col: col, note: same ? "" : "머리글의 열 이름으로 칸을 찾았습니다 (" + rec.fields.join(",") + ")" };
}

// "YYYY-MM-DD"이고 실제 있는 날짜인가 (2026-02-30 같은 날짜는 거름)
function isDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var t = Date.parse(s + "T00:00:00Z");
  return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

// 문자열 → [{ line, fields }]. 따옴표 안이 아닌 줄바꿈에서 레코드를 끊는다
function readRecords(s) {
  var out = [], fields = [], cell = "";
  var line = 1, start = 1, quoted = false;
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; }
    else if (ch === ",") { fields.push(cell); cell = ""; }
    else if (ch === "\r") { /* CRLF의 CR은 버림 */ }
    else if (ch === "\n") {
      fields.push(cell);
      out.push({ line: start, fields: fields });
      fields = []; cell = ""; line++; start = line;
    }
    else { cell += ch; }
  }
  // 마지막 줄 (파일 끝에 줄바꿈이 없을 때)
  if (cell !== "" || fields.length) { fields.push(cell); out.push({ line: start, fields: fields }); }
  return out;
}
})();
