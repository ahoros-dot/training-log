/* トレーニング記録・分析アプリ
 * データはすべて localStorage に保存（この端末内で完結）。
 * 日付・曜日は日本時間（JST）基準。未入力の項目は「記録なし」とし、推測しない。
 */
(() => {
"use strict";

const STORAGE_KEY = "trainingLog.v1";
const DEFAULT_GOALS = [
  "ボクシングで3分間動き続けられる持久力をつける",
  "連打のスピードと持続力を上げる",
  "筋力を維持しながら体脂肪率17％前後を目指す",
  "下腹部の脂肪を減らす",
  "マッスルアップを完成させる",
  "膝・肘・腰の痛みを悪化させない"
];
const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const TYPE_LABEL = { strength: "筋トレ", cardio: "有酸素", boxing: "ボクシング", reps: "回数系", other: "その他" };

/* ============ JST 日付ユーティリティ ============ */
// 端末のタイムゾーンに関わらず JST の日付を返す
function jstTodayStr() {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function dowOf(dateStr) {
  return DOW[new Date(dateStr + "T00:00:00Z").getUTCDay()];
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// その週の月曜日（週は月曜〜日曜）
function mondayOf(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const shift = (d.getUTCDay() + 6) % 7;
  return addDays(dateStr, -shift);
}
function dateRange(startStr, endStr) {
  const out = [];
  let d = startStr;
  while (d <= endStr) { out.push(d); d = addDays(d, 1); }
  return out;
}
function monthDays(ym) { // "2026-07" -> 日付配列
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return dateRange(`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`);
}
function fmtDateJa(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${y}年${m}月${d}日（${dowOf(dateStr)}）`;
}
function fmtMD(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}
function fmtMinutes(min) {
  if (min == null) return "記録なし";
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return h > 0 ? `${h}時間${m}分` : `${m}分`;
}

/* ============ 保存・読込 ============ */
function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.records === "object") {
        if (!Array.isArray(parsed.goals)) parsed.goals = [...DEFAULT_GOALS];
        parsed.goals = parsed.goals.filter(g => typeof g === "string" && g.trim());
        if (typeof parsed.heightCm !== "number") parsed.heightCm = null;
        if (parsed.gender !== "male" && parsed.gender !== "female") parsed.gender = null;
        if (typeof parsed.birthDate !== "string") parsed.birthDate = null;
        if (typeof parsed.targetWeight !== "number") parsed.targetWeight = null;
        if (typeof parsed.targetBodyFat !== "number") parsed.targetBodyFat = null;
        return parsed;
      }
    }
  } catch (e) { console.error("データ読込エラー", e); }
  return { records: {}, goals: [...DEFAULT_GOALS], heightCm: null, gender: null, birthDate: null, targetWeight: null, targetBodyFat: null };
}

// 年齢（JST基準。生年月日未設定なら null）
function ageOf() {
  if (!data.birthDate) return null;
  const today = jstTodayStr();
  const [by, bm, bd] = data.birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age >= 0 && age < 130 ? age : null;
}

// 直近の記録値（体重・体脂肪率）
function latestValue(key) {
  const dates = Object.keys(data.records).sort().reverse();
  for (const d of dates) {
    const v = data.records[d][key];
    if (v != null) return { date: d, value: v };
  }
  return null;
}

// 基礎代謝（Mifflin-St Jeor式。身長・性別・年齢・体重が揃わないと null）
function bmrOf(weightKg) {
  const age = ageOf();
  if (weightKg == null || !data.heightCm || !data.gender || age == null) return null;
  const base = 10 * weightKg + 6.25 * data.heightCm - 5 * age;
  return Math.round(data.gender === "male" ? base + 5 : base - 161);
}

// BMI（身長未設定・体重未記録なら null）
function bmiOf(weightKg) {
  if (weightKg == null || !data.heightCm) return null;
  const h = data.heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  flashSaved();
}

function emptyRecord() {
  return {
    dayType: null,           // "training" | "rest" | null
    exercises: [],
    totalMinutes: null,
    fatigue: null,           // 1-10
    sleepHours: null,
    sleepNote: "",
    pain: "",
    weightKg: null,
    bodyFat: null,
    steps: null,
    activity: "",
    comment: ""
  };
}
function getRecord(dateStr) { return data.records[dateStr] || null; }
function ensureRecord(dateStr) {
  if (!data.records[dateStr]) data.records[dateStr] = emptyRecord();
  return data.records[dateStr];
}
function isRecordEmpty(r) {
  return !r.dayType && r.exercises.length === 0 && r.totalMinutes == null &&
    r.fatigue == null && r.sleepHours == null && !r.sleepNote && !r.pain &&
    r.weightKg == null && r.bodyFat == null && r.steps == null &&
    !r.activity && !r.comment;
}
function pruneIfEmpty(dateStr) {
  const r = data.records[dateStr];
  if (r && isRecordEmpty(r)) delete data.records[dateStr];
}

/* ============ 状態 ============ */
let data = loadData();
const state = {
  view: "record",
  date: jstTodayStr(),
  histMonth: jstTodayStr().slice(0, 7),
  anaMode: "week",
  anaAnchor: jstTodayStr()   // 週間: この日を含む週 / 月間: この日の月
};

const $ = (id) => document.getElementById(id);

/* ============ トースト・保存表示 ============ */
let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 1800);
}
let hintTimer = null;
function flashSaved() {
  const el = $("saveHint");
  el.textContent = "✓ 保存しました（自動保存）";
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => { el.textContent = ""; }, 2000);
}

/* ============ ビュー切替 ============ */
function switchView(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach(v => v.classList.add("hidden"));
  $("view-" + view).classList.remove("hidden");
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.view === view));
  if (view === "record") renderRecordView();
  if (view === "history") renderHistory();
  if (view === "analysis") renderAnalysis();
  if (view === "data") renderDataStats();
}

/* ============ 記録ビュー ============ */
function renderRecordView() {
  const r = getRecord(state.date) || emptyRecord();
  $("recordDate").value = state.date;
  $("headerDate").textContent = fmtDateJa(state.date);

  document.querySelectorAll(".daytype-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.daytype === r.dayType));

  renderExerciseList(r);

  $("condTotalMin").value = r.totalMinutes ?? "";
  $("condFatigue").value = r.fatigue ?? "";
  $("condSleepH").value = r.sleepHours ?? "";
  $("condSleepNote").value = r.sleepNote || "";
  $("condPain").value = r.pain || "";
  $("condWeight").value = r.weightKg ?? "";
  $("condBodyFat").value = r.bodyFat ?? "";
  $("condSteps").value = r.steps ?? "";
  $("condActivity").value = r.activity || "";
  $("condComment").value = r.comment || "";

  updateNameDatalist();
}

function exerciseDetailText(ex) {
  const parts = [];
  if (ex.type === "strength") {
    if (ex.weight != null) parts.push(`${ex.weight}kg`);
    if (ex.reps != null) parts.push(`${ex.reps}回`);
    if (ex.sets != null) parts.push(`${ex.sets}セット`);
  } else if (ex.type === "cardio") {
    if (ex.distance != null) parts.push(`${ex.distance}km`);
    if (ex.minutes != null) parts.push(`${ex.minutes}分`);
  } else if (ex.type === "boxing") {
    if (ex.roundMin != null && ex.rounds != null) parts.push(`${ex.roundMin}分×${ex.rounds}R`);
    else if (ex.rounds != null) parts.push(`${ex.rounds}R`);
    if (ex.restMin != null) parts.push(`休憩${ex.restMin}分`);
  } else if (ex.type === "reps") {
    if (ex.count != null) parts.push(`${ex.count.toLocaleString()}回`);
    if (ex.minutes != null) parts.push(`${ex.minutes}分`);
  } else {
    if (ex.minutes != null) parts.push(`${ex.minutes}分`);
    if (ex.memo) parts.push(ex.memo);
  }
  return parts.length ? parts.join(" × ").replace(/ × 休憩/, "、休憩").replace(/kg × /, "kg×").replace(/回 × /, "回×") : "詳細なし";
}
// 表示用（× のつなぎ方を種別ごとに整える）
function exerciseLabel(ex) {
  if (ex.type === "strength") {
    const p = [];
    if (ex.weight != null) p.push(`${ex.weight}kg`);
    if (ex.reps != null) p.push(`${ex.reps}回`);
    if (ex.sets != null) p.push(`${ex.sets}セット`);
    return p.join("×") || "詳細なし";
  }
  if (ex.type === "cardio") {
    const p = [];
    if (ex.distance != null) p.push(`${ex.distance}km`);
    if (ex.minutes != null) p.push(`${ex.minutes}分`);
    return p.join("、") || "詳細なし";
  }
  if (ex.type === "boxing") {
    const p = [];
    if (ex.roundMin != null && ex.rounds != null) p.push(`${ex.roundMin}分×${ex.rounds}R`);
    else if (ex.rounds != null) p.push(`${ex.rounds}R`);
    if (ex.restMin != null) p.push(`休憩${ex.restMin}分`);
    return p.join("、") || "詳細なし";
  }
  if (ex.type === "reps") {
    const p = [];
    if (ex.count != null) p.push(`${ex.count.toLocaleString()}回`);
    if (ex.minutes != null) p.push(`${ex.minutes}分`);
    return p.join("、") || "詳細なし";
  }
  const p = [];
  if (ex.minutes != null) p.push(`${ex.minutes}分`);
  if (ex.memo) p.push(ex.memo);
  return p.join("、") || "詳細なし";
}

function renderExerciseList(r) {
  const ul = $("exerciseList");
  ul.innerHTML = "";
  r.exercises.forEach((ex, i) => {
    const li = document.createElement("li");
    li.className = "exercise-item";
    const slot = ex.timeSlot ? `〔${ex.timeSlot}〕` : "";
    li.innerHTML =
      `<span class="ex-badge ${ex.type}">${TYPE_LABEL[ex.type] || "他"}</span>
       <div class="ex-main">
         <div class="ex-name" data-index="${i}" title="タップして調べる">${escapeHtml(ex.name)} ${slot} <span class="ex-lookup">🔍</span></div>
         <div class="ex-detail">${escapeHtml(exerciseLabel(ex))}</div>
       </div>
       <button class="ex-del" data-index="${i}" aria-label="削除">🗑</button>`;
    ul.appendChild(li);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function updateNameDatalist() {
  const names = new Set();
  Object.values(data.records).forEach(r =>
    r.exercises.forEach(ex => names.add(ex.name)));
  const dl = $("exNameList");
  dl.innerHTML = "";
  [...names].sort().forEach(n => {
    const o = document.createElement("option");
    o.value = n;
    dl.appendChild(o);
  });
}

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// コンディション入力 → 保存
function bindCondInput(id, key, isNum) {
  $(id).addEventListener("change", (e) => {
    const r = ensureRecord(state.date);
    r[key] = isNum ? numOrNull(e.target.value) : e.target.value.trim();
    pruneIfEmpty(state.date);
    saveData();
  });
}

/* ============ 種目フォーム ============ */
function showExerciseForm(show) {
  $("exerciseForm").classList.toggle("hidden", !show);
  $("btnAddExercise").classList.toggle("hidden", show);
  if (show) $("exName").focus();
}
function updateTypeFields() {
  const t = $("exType").value;
  document.querySelectorAll(".type-fields").forEach(el =>
    el.classList.toggle("hidden", el.dataset.for !== t));
}
function readExerciseForm() {
  const type = $("exType").value;
  const name = $("exName").value.trim();
  if (!name) return null;
  const ex = { type, name, timeSlot: $("exTimeSlot").value };
  if (type === "strength") {
    ex.weight = numOrNull($("exWeight").value);
    ex.reps = numOrNull($("exReps").value);
    ex.sets = numOrNull($("exSets").value);
  } else if (type === "cardio") {
    ex.distance = numOrNull($("exDistance").value);
    ex.minutes = numOrNull($("exCardioMin").value);
  } else if (type === "boxing") {
    ex.roundMin = numOrNull($("exRoundMin").value);
    ex.rounds = numOrNull($("exRounds").value);
    ex.restMin = numOrNull($("exRest").value);
  } else if (type === "reps") {
    ex.count = numOrNull($("exCount").value);
    ex.minutes = numOrNull($("exRepsMin").value);
  } else {
    ex.minutes = numOrNull($("exOtherMin").value);
    ex.memo = $("exMemo").value.trim();
  }
  return ex;
}
function clearExerciseForm() {
  ["exName", "exWeight", "exReps", "exSets", "exDistance", "exCardioMin",
   "exRoundMin", "exRounds", "exRest", "exCount", "exRepsMin", "exOtherMin", "exMemo"]
    .forEach(id => { $(id).value = ""; });
}

/* ============ 1日のまとめ（仕様の回答形式） ============ */
function buildDaySummary(dateStr) {
  const r = getRecord(dateStr);
  const lines = [];
  lines.push(`【${fmtDateJa(dateStr)}】`);
  lines.push("");

  if (!r) {
    lines.push("この日の記録はありません。");
    return lines.join("\n");
  }

  lines.push(r.dayType === "rest" ? "＜休養日＞" : r.dayType === "training" ? "＜トレーニング日＞" : "＜区分：記録なし＞");
  lines.push("");
  lines.push("■トレーニング");
  if (r.exercises.length === 0) {
    lines.push(r.dayType === "rest" ? "・休養日" : "・記録なし");
  } else {
    // 時間帯ごとにグループ化
    const groups = groupBySlot(r.exercises);
    const multi = groups.length > 1 || (groups.length === 1 && groups[0].slot);
    groups.forEach(g => {
      if (multi && g.slot) lines.push(`・${g.slot}`);
      g.items.forEach(ex => {
        const prefix = multi && g.slot ? "　・" : "・";
        lines.push(`${prefix}${ex.name}：${exerciseLabel(ex)}`);
      });
    });
  }
  lines.push("");
  lines.push("■合計運動時間");
  lines.push(`・${fmtMinutes(dayMinutes(r))}`);
  lines.push("");
  lines.push("■疲労・睡眠");
  if (r.fatigue == null && r.sleepHours == null && !r.sleepNote) {
    lines.push("・記録なし");
  } else {
    lines.push(`・疲労度：${r.fatigue != null ? r.fatigue + "／10" : "記録なし"}`);
    const sleep = r.sleepHours != null ? `${r.sleepHours}時間` : "記録なし";
    lines.push(`・睡眠：${sleep}${r.sleepNote ? "、" + r.sleepNote : ""}`);
  }
  lines.push("");
  lines.push("■痛み・違和感");
  lines.push(`・${r.pain ? r.pain : "記録なし"}`);
  lines.push("");
  lines.push("■体重・体脂肪率");
  if (r.weightKg == null && r.bodyFat == null) {
    lines.push("・記録なし");
  } else {
    lines.push(`・体重：${r.weightKg != null ? r.weightKg + "kg" : "記録なし"}`);
    lines.push(`・体脂肪率：${r.bodyFat != null ? r.bodyFat + "％" : "記録なし"}`);
    const bmi = bmiOf(r.weightKg);
    if (bmi != null) lines.push(`・BMI：${bmi}（身長${data.heightCm}cm）`);
    if (data.targetWeight != null && r.weightKg != null) {
      const d = Math.round((r.weightKg - data.targetWeight) * 10) / 10;
      lines.push(`・目標体重${data.targetWeight}kgまで：${d > 0 ? "あと−" + d + "kg" : d < 0 ? "目標より" + (-d) + "kg軽い" : "達成"}`);
    }
    if (data.targetBodyFat != null && r.bodyFat != null) {
      const d = Math.round((r.bodyFat - data.targetBodyFat) * 10) / 10;
      lines.push(`・目標体脂肪率${data.targetBodyFat}％まで：${d > 0 ? "あと−" + d + "％" : d < 0 ? "目標より" + (-d) + "％低い" : "達成"}`);
    }
  }
  lines.push("");
  lines.push("■歩数・活動量");
  if (r.steps == null && !r.activity) {
    lines.push("・記録なし");
  } else {
    if (r.steps != null) lines.push(`・${r.steps.toLocaleString()}歩`);
    if (r.activity) lines.push(`・${r.activity}`);
  }
  lines.push("");
  lines.push("■本人の感想");
  lines.push(`・${r.comment ? r.comment : "記録なし"}`);
  lines.push("");
  lines.push("■現在の主な目標");
  if (data.goals.length) {
    data.goals.forEach(g => lines.push(`・${g}`));
  } else {
    lines.push("・設定なし");
  }

  return lines.join("\n");
}

// AI評価用プロンプト（記録＋目標＋評価の指示）
function buildEvalPrompt(dateStr) {
  return [
    "あなたはトレーニング記録の分析コーチです。以下の1日のトレーニング記録を評価してください。",
    "",
    "【評価の方針】",
    "・結論から簡潔に。過度な称賛や精神論は避ける",
    "・当日の負荷についての短い評価をする",
    "・回復面の注意点を伝える（疲労度7以上、睡眠不足、痛みがある場合は特に）",
    "・末尾の「現在の主な目標」を踏まえ、次回トレーニングへの具体的で測定可能な提案を2〜3個する",
    "・「記録なし」の項目は推測せず、評価に必要なら記録を勧める",
    "・痛みが悪化している場合は該当部位の負荷を下げる提案をし、強い痛み・腫れ・しびれがある場合は医療機関への相談を勧める",
    "",
    "【記録】",
    buildDaySummary(dateStr)
  ].join("\n");
}

function groupBySlot(exercises) {
  const order = ["朝", "昼", "夕方", "夜", ""];
  const map = new Map();
  exercises.forEach(ex => {
    const key = ex.timeSlot || "";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(ex);
  });
  return order.filter(s => map.has(s)).map(s => ({ slot: s, items: map.get(s) }));
}

// その日の運動時間（合計が入力されていればそれを優先。なければ種目の時間の合計。どちらも無ければ null）
function dayMinutes(r) {
  if (r.totalMinutes != null) return r.totalMinutes;
  const mins = r.exercises
    .map(ex => {
      if (ex.minutes != null) return ex.minutes;
      if (ex.type === "boxing" && ex.roundMin != null && ex.rounds != null) {
        const rest = ex.restMin != null ? ex.restMin * Math.max(0, ex.rounds - 1) : 0;
        return ex.roundMin * ex.rounds + rest;
      }
      return null;
    })
    .filter(v => v != null);
  return mins.length ? mins.reduce((a, b) => a + b, 0) : null;
}

// セッション数（時間帯グループの数。時間帯未指定の種目はまとめて1セッション）
function sessionCount(r) {
  if (r.exercises.length === 0) return 0;
  return groupBySlot(r.exercises).length;
}

/* ============ 集計 ============ */
function aggregate(dates) {
  const agg = {
    dates,
    trainingDays: 0, restDays: 0, noRecordDays: 0, partialDays: 0,
    sessions: 0,
    totalMinutes: 0, minutesKnownDays: 0, minutesUnknownTrainingDays: 0,
    byExercise: new Map(),   // name -> {type, count, sets, reps, maxWeight, distance, minutes, rounds, totalCount}
    weights: [], bodyFats: [],   // {date, value}
    fatigues: [], sleeps: [],
    painDays: [],            // {date, text}
    dailyMinutes: []         // {date, min|null, dayType}
  };
  dates.forEach(d => {
    const r = getRecord(d);
    if (!r) {
      agg.noRecordDays++;
      agg.dailyMinutes.push({ date: d, min: null, dayType: null });
      return;
    }
    if (r.dayType === "training" || (r.dayType == null && r.exercises.length > 0)) agg.trainingDays++;
    else if (r.dayType === "rest") agg.restDays++;
    else agg.partialDays++; // 区分未指定・種目なし（体重のみ等）

    agg.sessions += sessionCount(r);

    const min = dayMinutes(r);
    agg.dailyMinutes.push({ date: d, min, dayType: r.dayType });
    if (min != null) { agg.totalMinutes += min; agg.minutesKnownDays++; }
    else if (r.dayType === "training" || r.exercises.length > 0) agg.minutesUnknownTrainingDays++;

    r.exercises.forEach(ex => {
      const key = ex.name;
      if (!agg.byExercise.has(key)) {
        agg.byExercise.set(key, { type: ex.type, times: 0, sets: 0, reps: 0, maxWeight: null, distance: 0, minutes: 0, rounds: 0, totalCount: 0 });
      }
      const s = agg.byExercise.get(key);
      s.times++;
      if (ex.sets != null) s.sets += ex.sets;
      if (ex.reps != null && ex.sets != null) s.reps += ex.reps * ex.sets;
      if (ex.weight != null) s.maxWeight = s.maxWeight == null ? ex.weight : Math.max(s.maxWeight, ex.weight);
      if (ex.distance != null) s.distance += ex.distance;
      if (ex.minutes != null) s.minutes += ex.minutes;
      if (ex.rounds != null) s.rounds += ex.rounds;
      if (ex.count != null) s.totalCount += ex.count;
    });

    if (r.weightKg != null) agg.weights.push({ date: d, value: r.weightKg });
    if (r.bodyFat != null) agg.bodyFats.push({ date: d, value: r.bodyFat });
    if (r.fatigue != null) agg.fatigues.push({ date: d, value: r.fatigue });
    if (r.sleepHours != null) agg.sleeps.push({ date: d, value: r.sleepHours });
    if (r.pain) agg.painDays.push({ date: d, text: r.pain });
  });
  return agg;
}

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b.value, 0) / arr.length;
}
function firstLast(arr) {
  if (!arr.length) return null;
  return { first: arr[0], last: arr[arr.length - 1] };
}
function hasAnyRecord(dates) {
  return dates.some(d => getRecord(d));
}

/* ============ 分析ビュー ============ */
function anaWeekDates() {
  const mon = mondayOf(state.anaAnchor);
  return dateRange(mon, addDays(mon, 6));
}
function anaMonthDates() {
  return monthDays(state.anaAnchor.slice(0, 7));
}

function renderAnalysis() {
  const isWeek = state.anaMode === "week";
  $("segWeek").classList.toggle("active", isWeek);
  $("segMonth").classList.toggle("active", !isWeek);

  const dates = isWeek ? anaWeekDates() : anaMonthDates();
  const today = jstTodayStr();
  // 未来日は集計対象から除外（途中経過として分析）
  const effective = dates.filter(d => d <= today);
  const inProgress = effective.length < dates.length;

  if (isWeek) {
    $("anaPeriod").textContent = `${fmtMD(dates[0])}（月）〜 ${fmtMD(dates[6])}（日）`;
  } else {
    const [y, m] = state.anaAnchor.slice(0, 7).split("-").map(Number);
    $("anaPeriod").textContent = `${y}年${m}月`;
  }

  const agg = aggregate(effective);

  // 前期間
  let prevDates;
  if (isWeek) {
    const prevMon = addDays(mondayOf(state.anaAnchor), -7);
    prevDates = dateRange(prevMon, addDays(prevMon, 6));
  } else {
    const [y, m] = state.anaAnchor.slice(0, 7).split("-").map(Number);
    const pm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    prevDates = monthDays(pm);
  }
  const prevAgg = hasAnyRecord(prevDates) ? aggregate(prevDates.filter(d => d <= today)) : null;

  $("analysisBody").innerHTML = buildAnalysisHtml(agg, prevAgg, isWeek, inProgress, effective);
  drawCharts(agg, effective);
}

function diffBadge(cur, prev, unit, lowerIsBetter = false) {
  if (prev == null || cur == null) return "";
  const d = cur - prev;
  if (Math.abs(d) < 0.05) return ` <span class="diff-flat">（前${unit}比 ±0）</span>`;
  const sign = d > 0 ? "+" : "";
  const cls = (d > 0) !== lowerIsBetter ? "diff-up" : "diff-down";
  const val = Number.isInteger(d) ? d : d.toFixed(1);
  return ` <span class="${cls}">（${sign}${val}）</span>`;
}

function buildAnalysisHtml(agg, prevAgg, isWeek, inProgress, effective) {
  const label = isWeek ? "週" : "月";
  const parts = [];

  if (inProgress) {
    parts.push(`<div class="card"><p class="note">※ 期間の途中です。${effective.length}日分の途中経過として集計しています。</p></div>`);
  }

  // --- 概況 ---
  const minutesNote = agg.minutesUnknownTrainingDays > 0
    ? `<p class="note">※ 運動時間が未記録のトレーニング日が${agg.minutesUnknownTrainingDays}日あります（合計には含まれません）。</p>` : "";
  parts.push(`<div class="card"><h2>概況</h2>
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-label">トレーニング日</div>
        <div class="stat-value">${agg.trainingDays}<small>日</small>${prevAgg ? diffBadge(agg.trainingDays, prevAgg.trainingDays, label) : ""}</div></div>
      <div class="stat-box"><div class="stat-label">休養日</div>
        <div class="stat-value">${agg.restDays}<small>日</small></div></div>
      <div class="stat-box"><div class="stat-label">記録なしの日</div>
        <div class="stat-value">${agg.noRecordDays}<small>日</small></div></div>
      <div class="stat-box"><div class="stat-label">セッション数</div>
        <div class="stat-value">${agg.sessions}<small>回</small>${prevAgg ? diffBadge(agg.sessions, prevAgg.sessions, label) : ""}</div></div>
      <div class="stat-box" style="grid-column:1/-1"><div class="stat-label">総運動時間（記録がある日の合計）</div>
        <div class="stat-value">${agg.minutesKnownDays ? fmtMinutes(agg.totalMinutes) : "集計不可（記録なし）"}${prevAgg && prevAgg.minutesKnownDays && agg.minutesKnownDays ? diffBadge(agg.totalMinutes, prevAgg.totalMinutes, label + "・分") : ""}</div></div>
    </div>${minutesNote}
    ${prevAgg ? "" : `<p class="note">前${label}のデータがないため、前${label}比較なし。</p>`}
  </div>`);

  // --- 種目別 ---
  if (agg.byExercise.size > 0) {
    const rows = [...agg.byExercise.entries()].map(([name, s]) => {
      const detail = [];
      if (s.type === "strength") {
        if (s.maxWeight != null) detail.push(`最大${s.maxWeight}kg`);
        if (s.sets) detail.push(`計${s.sets}セット`);
        if (s.reps) detail.push(`総回数${s.reps.toLocaleString()}回`);
      } else if (s.type === "cardio") {
        if (s.distance) detail.push(`計${round1(s.distance)}km`);
        if (s.minutes) detail.push(`計${fmtMinutes(s.minutes)}`);
      } else if (s.type === "boxing") {
        if (s.rounds) detail.push(`計${s.rounds}R`);
        if (s.minutes) detail.push(`計${fmtMinutes(s.minutes)}`);
      } else if (s.type === "reps") {
        if (s.totalCount) detail.push(`計${s.totalCount.toLocaleString()}回`);
      } else {
        if (s.minutes) detail.push(`計${fmtMinutes(s.minutes)}`);
      }
      // 前期間の同種目と比較
      let cmp = "";
      if (prevAgg && prevAgg.byExercise.has(name)) {
        const p = prevAgg.byExercise.get(name);
        if (s.type === "strength" && s.maxWeight != null && p.maxWeight != null)
          cmp = diffBadge(s.maxWeight, p.maxWeight, label + "・kg");
        else if (s.type === "cardio" && s.distance && p.distance)
          cmp = diffBadge(round1(s.distance), round1(p.distance), label + "・km");
        else if (s.type === "boxing" && s.rounds && p.rounds)
          cmp = diffBadge(s.rounds, p.rounds, label + "・R");
        else if (s.type === "reps" && s.totalCount && p.totalCount)
          cmp = diffBadge(s.totalCount, p.totalCount, label + "・回");
      }
      return `<tr><th>${escapeHtml(name)}</th>
        <td>${detail.join("／") || "数値記録なし"}${cmp}</td>
        <td class="num">${s.times}回実施</td></tr>`;
    }).join("");
    parts.push(`<div class="card"><h2>種目別集計</h2>
      <table class="ana-table"><tbody>${rows}</tbody></table></div>`);
  }

  // --- 体重・体脂肪率 ---
  const w = firstLast(agg.weights), f = firstLast(agg.bodyFats);
  let bodyHtml = "";
  if (w) {
    const d = w.last.value - w.first.value;
    bodyHtml += `<tr><th>体重</th><td>${w.first.value}kg（${fmtMD(w.first.date)}）→ ${w.last.value}kg（${fmtMD(w.last.date)}）${w.first.date !== w.last.date ? diffBadge(w.last.value, w.first.value, "回", true) : ""}</td></tr>`;
  } else bodyHtml += `<tr><th>体重</th><td>記録なし</td></tr>`;
  if (f) {
    bodyHtml += `<tr><th>体脂肪率</th><td>${f.first.value}％（${fmtMD(f.first.date)}）→ ${f.last.value}％（${fmtMD(f.last.date)}）${f.first.date !== f.last.date ? diffBadge(f.last.value, f.first.value, "回", true) : ""}</td></tr>`;
  } else bodyHtml += `<tr><th>体脂肪率</th><td>記録なし</td></tr>`;
  if (w && data.heightCm) {
    const b1 = bmiOf(w.first.value), b2 = bmiOf(w.last.value);
    bodyHtml += `<tr><th>BMI</th><td>${b1}（${fmtMD(w.first.date)}）→ ${b2}（${fmtMD(w.last.date)}）<span class="diff-flat">（身長${data.heightCm}cm）</span></td></tr>`;
  }
  if (data.targetWeight != null && w) {
    const d = round1(w.last.value - data.targetWeight);
    bodyHtml += `<tr><th>目標体重 ${data.targetWeight}kg</th><td>${d > 0 ? `あと−${d}kg` : d < 0 ? `目標より${-d}kg軽い` : "達成！"}</td></tr>`;
  }
  if (data.targetBodyFat != null && f) {
    const d = round1(f.last.value - data.targetBodyFat);
    bodyHtml += `<tr><th>目標体脂肪率 ${data.targetBodyFat}％</th><td>${d > 0 ? `あと−${d}％` : d < 0 ? `目標より${-d}％低い` : "達成！"}</td></tr>`;
  }
  parts.push(`<div class="card"><h2>体重・体脂肪率</h2>
    <table class="ana-table"><tbody>${bodyHtml}</tbody></table>
    <div class="chart-wrap"><canvas id="chartWeight" width="600" height="260"></canvas></div>
  </div>`);

  // --- 疲労・睡眠・痛み ---
  const fa = avg(agg.fatigues), sl = avg(agg.sleeps);
  const highFatigue = agg.fatigues.filter(x => x.value >= 7);
  let condHtml = `<table class="ana-table"><tbody>
    <tr><th>平均疲労度</th><td>${fa != null ? round1(fa) + "／10（" + agg.fatigues.length + "日分）" : "記録なし"}</td></tr>
    <tr><th>平均睡眠時間</th><td>${sl != null ? round1(sl) + "時間（" + agg.sleeps.length + "日分）" : "記録なし"}</td></tr>
  </tbody></table>`;
  if (highFatigue.length) {
    condHtml += `<p class="note">⚠ 疲労度7以上の日が${highFatigue.length}日（${highFatigue.map(x => fmtMD(x.date)).join("、")}）。高強度・長時間のトレーニングは控えめに。</p>`;
  }
  if (agg.painDays.length) {
    condHtml += `<div style="margin-top:8px">` + agg.painDays.map(p =>
      `<div class="pain-item"><span class="pain-date">${fmtMD(p.date)}</span>${escapeHtml(p.text)}</div>`).join("") + `</div>`;
    condHtml += `<p class="note">⚠ 痛み・違和感の記録がある期間です。悪化する場合は該当部位に負担のかかる種目の強度を下げてください。強い痛み・腫れ・しびれ等がある場合は医療機関に相談を。</p>`;
  } else {
    condHtml += `<p class="note">痛み・違和感の記録：なし</p>`;
  }
  parts.push(`<div class="card"><h2>疲労・睡眠・痛み</h2>${condHtml}</div>`);

  // --- 運動時間の推移 ---
  parts.push(`<div class="card"><h2>運動時間の推移</h2>
    <div class="chart-wrap"><canvas id="chartMinutes" width="600" height="240"></canvas></div>
    <p class="note">グレー＝記録なし／緑＝休養日</p>
  </div>`);

  return parts.join("");
}

function round1(n) { return Math.round(n * 10) / 10; }

/* ============ チャート描画 ============ */
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement.clientWidth || 600;
  const cssH = Number(canvas.getAttribute("height")) / 2;
  canvas.style.height = cssH + "px";
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w: cssW, h: cssH };
}

function drawCharts(agg, dates) {
  drawWeightChart(agg, dates);
  drawMinutesChart(agg);
}

function drawWeightChart(agg, dates) {
  const canvas = $("chartWeight");
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const series = [
    { data: agg.weights, color: "#4F46E5", label: "体重(kg)" },
    { data: agg.bodyFats, color: "#EC4899", label: "体脂肪率(%)" }
  ].filter(s => s.data.length > 0);

  if (!series.length) {
    ctx.fillStyle = "#9CA3AF";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("体重・体脂肪率の記録がありません", w / 2, h / 2);
    return;
  }

  const padL = 34, padR = 34, padT = 20, padB = 24;
  const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
  const idx = (d) => dates.indexOf(d);
  const xOf = (d) => dates.length > 1 ? x0 + (idx(d) / (dates.length - 1)) * (x1 - x0) : (x0 + x1) / 2;

  // 軸線
  ctx.strokeStyle = "#E5E7EB";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.stroke();

  // x ラベル（最初・中央・最後）
  ctx.fillStyle = "#9CA3AF";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  [0, Math.floor((dates.length - 1) / 2), dates.length - 1]
    .filter((v, i, a) => a.indexOf(v) === i)
    .forEach(i => ctx.fillText(fmtMD(dates[i]), xOf(dates[i]), y1 + 14));

  series.forEach((s, si) => {
    const vals = s.data.map(p => p.value);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (max - min < 1) { min -= 1; max += 1; }
    const pad = (max - min) * 0.15;
    min -= pad; max += pad;
    const yOf = (v) => y1 - ((v - min) / (max - min)) * (y1 - y0);

    ctx.strokeStyle = s.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    s.data.forEach((p, i) => {
      const x = xOf(p.date), y = yOf(p.value);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = s.color;
    s.data.forEach(p => {
      ctx.beginPath();
      ctx.arc(xOf(p.date), yOf(p.value), 3, 0, Math.PI * 2);
      ctx.fill();
    });
    // 端の値ラベル
    ctx.font = "10px sans-serif";
    ctx.textAlign = si === 0 ? "right" : "left";
    const lastP = s.data[s.data.length - 1];
    ctx.fillText(String(lastP.value), si === 0 ? x0 - 4 : x1 + 4, yOf(lastP.value) + 3);
    // 凡例
    ctx.textAlign = "left";
    ctx.font = "11px sans-serif";
    ctx.fillText(`● ${s.label}`, x0 + si * 110, y0 - 8 + 0);
  });
}

function drawMinutesChart(agg) {
  const canvas = $("chartMinutes");
  if (!canvas) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const items = agg.dailyMinutes;
  if (!items.length) return;
  const padL = 8, padR = 8, padT = 14, padB = 22;
  const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
  const bw = Math.min(26, (x1 - x0) / items.length * 0.7);
  const step = (x1 - x0) / items.length;
  const maxMin = Math.max(30, ...items.map(i => i.min || 0));

  items.forEach((it, i) => {
    const cx = x0 + step * i + step / 2;
    if (it.min != null && it.min > 0) {
      const bh = ((it.min / maxMin) * (y1 - y0));
      ctx.fillStyle = "#4F46E5";
      ctx.beginPath();
      ctx.roundRect(cx - bw / 2, y1 - bh, bw, bh, 3);
      ctx.fill();
      if (items.length <= 10) {
        ctx.fillStyle = "#4B5563";
        ctx.font = "10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(it.min), cx, y1 - bh - 4);
      }
    } else if (it.dayType === "rest") {
      ctx.fillStyle = "#10B981";
      ctx.beginPath();
      ctx.arc(cx, y1 - 6, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#D1D5DB";
      ctx.beginPath();
      ctx.arc(cx, y1 - 6, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // x ラベル（週=毎日／月=5日ごと）
    if (items.length <= 7 || i % 5 === 0 || i === items.length - 1) {
      ctx.fillStyle = "#9CA3AF";
      ctx.font = "9.5px sans-serif";
      ctx.textAlign = "center";
      const d = it.date.slice(8).replace(/^0/, "");
      ctx.fillText(items.length <= 7 ? `${fmtMD(it.date)}(${dowOf(it.date)})` : d, cx, y1 + 13);
    }
  });
  ctx.strokeStyle = "#E5E7EB";
  ctx.beginPath();
  ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
  ctx.stroke();
}

/* ============ 履歴ビュー ============ */
function renderHistory() {
  $("histMonth").value = state.histMonth;
  const days = monthDays(state.histMonth);
  const today = jstTodayStr();
  const list = $("historyList");
  list.innerHTML = "";

  const shown = days.filter(d => d <= today).reverse();
  let any = false;
  shown.forEach(d => {
    const r = getRecord(d);
    const div = document.createElement("div");
    div.className = "history-day";
    let badge, summary;
    if (!r) {
      badge = `<span class="hd-badge none">記録なし</span>`;
      summary = "";
    } else {
      any = true;
      if (r.dayType === "rest") badge = `<span class="hd-badge rest">休養日</span>`;
      else if (r.dayType === "training" || r.exercises.length) badge = `<span class="hd-badge training">トレ日</span>`;
      else badge = `<span class="hd-badge none">記録あり</span>`;
      const bits = [];
      if (r.exercises.length) bits.push(r.exercises.map(e => e.name).join("、"));
      const min = dayMinutes(r);
      if (min != null) bits.push(fmtMinutes(min));
      if (r.weightKg != null) bits.push(`${r.weightKg}kg`);
      if (r.pain) bits.push("⚠痛み");
      summary = bits.join("／");
    }
    div.innerHTML = `
      <div class="hd-date">${fmtMD(d)}<span class="dow">（${dowOf(d)}）</span></div>
      ${badge}
      <div class="hd-summary">${escapeHtml(summary)}</div>
      <span class="hd-arrow">›</span>`;
    div.addEventListener("click", () => {
      if (r) {
        showSummaryModal(fmtDateJa(d), buildDaySummary(d), d);
      } else {
        state.date = d;
        switchView("record");
      }
    });
    list.appendChild(div);
  });
  if (!shown.length) {
    list.innerHTML = `<div class="history-empty">この月の日付はまだありません</div>`;
  } else if (!any) {
    const info = document.createElement("div");
    info.className = "history-empty";
    info.textContent = "この月の記録はまだありません。タップして記録を始められます。";
    list.prepend(info);
  }
}

/* ============ モーダル ============ */
let modalDate = null;
function showSummaryModal(title, text, dateStr) {
  modalDate = dateStr || null;
  $("modalTitle").textContent = title;
  $("summaryText").textContent = text;
  $("aiEvalPanel").classList.add("hidden");
  // 記録がある日だけAI評価ボタンを表示。編集ボタンは日付があれば表示（記録なしの日は新規作成として開く）
  $("btnAiEval").classList.toggle("hidden", !(modalDate && getRecord(modalDate)));
  $("btnEditDay").classList.toggle("hidden", !modalDate);
  $("modalOverlay").classList.remove("hidden");
}
function closeModal() {
  $("modalOverlay").classList.add("hidden");
}

/* ============ 部位から種目を選ぶ ============ */
// EXERCISE_CATS から分類ツリーを構築: L1 -> L2 -> L3 -> [種目名]
function buildCatTree() {
  const tree = new Map();
  Object.entries(EXERCISE_CATS).forEach(([name, info]) => {
    info.cats.forEach(([l1, l2, l3]) => {
      if (!tree.has(l1)) tree.set(l1, new Map());
      const m2 = tree.get(l1);
      if (!m2.has(l2)) m2.set(l2, new Map());
      const m3 = m2.get(l2);
      if (!m3.has(l3)) m3.set(l3, []);
      if (!m3.get(l3).includes(name)) m3.get(l3).push(name);
    });
  });
  return tree;
}
const CAT_TREE = buildCatTree();

function sortByOrder(keys, order) {
  return [...keys].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function fillSelect(sel, values, placeholder) {
  sel.innerHTML = `<option value="">${placeholder}</option>` +
    values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  sel.disabled = values.length === 0;
}

function onCatL1Change() {
  const l1 = $("catL1").value;
  const l2s = l1 ? sortByOrder(CAT_TREE.get(l1).keys(), CAT_L2_ORDER[l1] || []) : [];
  fillSelect($("catL2"), l2s, l1 ? "すべて" : "--");
  fillSelect($("catL3"), [], "--");
  renderCatResults();
}
function onCatL2Change() {
  const l1 = $("catL1").value, l2 = $("catL2").value;
  const l3s = (l1 && l2) ? [...CAT_TREE.get(l1).get(l2).keys()] : [];
  fillSelect($("catL3"), l3s, l2 ? "すべて" : "--");
  renderCatResults();
}

// 現在の選択（大→中→小）に該当する種目一覧を表示
function catMatches() {
  const l1 = $("catL1").value, l2 = $("catL2").value, l3 = $("catL3").value;
  if (!l1) return [];
  const names = [];
  const push = (arr) => arr.forEach(n => { if (!names.includes(n)) names.push(n); });
  const m2 = CAT_TREE.get(l1);
  for (const [k2, m3] of m2) {
    if (l2 && k2 !== l2) continue;
    for (const [k3, arr] of m3) {
      if (l3 && k3 !== l3) continue;
      push(arr);
    }
  }
  return names;
}

function renderCatResults() {
  const box = $("catResults");
  const l1 = $("catL1").value;
  if (!l1) { box.innerHTML = `<p class="note">大分類を選ぶと種目が表示されます。</p>`; return; }
  const names = catMatches();
  if (!names.length) { box.innerHTML = `<p class="note">該当する種目がありません。</p>`; return; }
  box.innerHTML = names.map(n => {
    const e = EXERCISE_DB.find(x => x.name === n);
    const target = e ? `<span class="chip-target">${escapeHtml(e.target)}</span>` : "";
    return `<button type="button" class="cat-chip" data-name="${escapeHtml(n)}">
      <span class="chip-name">${escapeHtml(n)}</span>${target}</button>`;
  }).join("");
}

// 種目チップをタップ → 種目名と種別をフォームに反映
function pickExercise(name) {
  $("exName").value = name;
  const info = EXERCISE_CATS[name];
  if (info?.type) {
    $("exType").value = info.type;
    updateTypeFields();
  }
  $("partPicker").classList.add("hidden");
  toast(`「${name}」を選択しました`);
}

/* ============ 種目のWeb検索 ============ */
function openLookup(name) {
  $("lookupTitle").textContent = name;
  const entry = findExerciseEntry(name);
  const localHtml = entry ? localEntryHtml(entry) : "";
  $("lookupBody").innerHTML =
    localHtml +
    `<div id="wikiExtra"><p class="note">参考情報を確認中…</p></div>` +
    lookupLinksHtml(name);
  $("lookupOverlay").classList.remove("hidden");
  fetchWikiExact(name, !!entry);
}

// 内蔵DBから完全一致（別名含む）で検索。近い種目の代替表示はしない。
function normalizeName(s) {
  return s.replace(/[\s　・･]/g, "").toLowerCase()
    .replace(/[ぁ-ん]/g, ch => String.fromCharCode(ch.charCodeAt(0) + 0x60)); // ひらがな→カタカナ
}
function findExerciseEntry(name) {
  const n = normalizeName(name);
  if (!n) return null;
  for (const e of EXERCISE_DB) {
    const cands = [e.name, ...(e.aliases || [])].map(normalizeName);
    if (cands.includes(n)) return e;
  }
  return null;
}

function localEntryHtml(e) {
  const steps = e.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("");
  return `
    <div class="db-target">主に鍛えられる部位：${escapeHtml(e.target)}</div>
    <p class="lookup-extract">${escapeHtml(e.summary)}</p>
    ${motionImagesHtml(e.name)}
    <h3 class="lookup-heading">やり方</h3>
    <ol class="howto">${steps}</ol>
    <p class="db-tips">💡 ${escapeHtml(e.tips)}</p>`;
}

// 動作イメージ（開始姿勢 → 動作後の姿勢の2枚組）。オフライン等で読み込めない場合はブロックごと非表示。
function motionImagesHtml(name) {
  const info = EXERCISE_IMAGES[name];
  if (!info) return "";
  const url = (n) => EXERCISE_IMG_BASE + encodeURIComponent(info.id) + "/" + n + ".jpg";
  const note = info.note ? `（${escapeHtml(info.note)}）` : "";
  return `
    <div class="motion-block">
      <div class="motion-imgs">
        <figure>
          <img src="${url(0)}" alt="${escapeHtml(name)} 開始姿勢" loading="lazy"
               onerror="this.closest('.motion-block').style.display='none'">
          <figcaption>① 開始</figcaption>
        </figure>
        <figure>
          <img src="${url(1)}" alt="${escapeHtml(name)} 動作後の姿勢" loading="lazy"
               onerror="this.closest('.motion-block').style.display='none'">
          <figcaption>② 動作</figcaption>
        </figure>
      </div>
      <p class="note">動作イメージ${note}：①から②へ動きます（画像出典：free-exercise-db）</p>
    </div>`;
}
function closeLookup() {
  $("lookupOverlay").classList.add("hidden");
}

// 外部検索へのリンク（新しいタブで開く）
function lookupLinksHtml(name) {
  const q = encodeURIComponent(name);
  const qHow = encodeURIComponent(name + " やり方 フォーム");
  return `<div class="link-grid">
    <a class="link-btn" href="https://www.youtube.com/results?search_query=${qHow}" target="_blank" rel="noopener">▶ やり方を動画で見る（YouTube）</a>
    <a class="link-btn" href="https://www.google.com/search?tbm=isch&q=${qHow}" target="_blank" rel="noopener">🖼 フォームの画像を見る（Google画像）</a>
    <a class="link-btn" href="https://www.google.com/search?q=${qHow}" target="_blank" rel="noopener">🔍 Webで詳しく検索（Google）</a>
  </div>`;
}

// Wikipediaは「その種目名の記事が存在する場合」だけ参考として表示する。
// 記事がない場合に近い記事で代替することはしない（別種目の画像・説明が出てしまうため）。
async function fetchWikiExact(name, hasLocalEntry) {
  const extra = $("wikiExtra");
  const done = (html) => { if (extra) extra.innerHTML = html; };
  try {
    const summary = await fetchWikiSummary(name);
    if (!summary || !summary.extract) {
      if (hasLocalEntry) { done(""); return; }
      done(`<p class="note">「${escapeHtml(name)}」の解説データはまだ登録されていません。種目名を確認するか、下のリンクから検索してください。</p>`);
      return;
    }
    const img = summary.thumbnail?.source
      ? `<img class="lookup-img" src="${escapeHtml(summary.thumbnail.source)}" alt="${escapeHtml(summary.title)}">` : "";
    const pageUrl = summary.content_urls?.desktop?.page || `https://ja.wikipedia.org/wiki/${encodeURIComponent(summary.title)}`;
    if (hasLocalEntry) {
      // 内蔵解説がある場合は参考画像とリンクだけ添える
      done(`${img}<p class="note"><a href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener">Wikipediaで「${escapeHtml(summary.title)}」を読む →</a>（出典：Wikipedia）</p>`);
    } else {
      done(`${img}
        <h3 class="lookup-heading">${escapeHtml(summary.title)}</h3>
        <p class="lookup-extract">${escapeHtml(summary.extract)}</p>
        <p class="note"><a href="${escapeHtml(pageUrl)}" target="_blank" rel="noopener">Wikipediaで全文を読む →</a>（出典：Wikipedia）</p>`);
    }
  } catch (e) {
    done(hasLocalEntry ? "" : `<p class="note">⚠ 参考情報を取得できませんでした（オフラインの可能性）。下のリンクから検索できます。</p>`);
  }
}

async function fetchWikiSummary(title) {
  const res = await fetch(`https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`);
  if (!res.ok) return null;
  const json = await res.json();
  // 曖昧さ回避ページは概要として不適切なので検索に回す
  if (json.type === "disambiguation") return null;
  return json;
}

/* ============ 目標の編集 ============ */
let editingGoalIndex = null;   // null = 追加モード / 数値 = 編集対象のindex

function renderGoals() {
  const ul = $("goalList");
  ul.innerHTML = "";
  if (!data.goals.length) {
    const li = document.createElement("li");
    li.className = "goal-empty";
    li.textContent = "目標はまだ設定されていません。";
    ul.appendChild(li);
  }
  data.goals.forEach((g, i) => {
    const li = document.createElement("li");
    li.innerHTML =
      `<span class="goal-text" data-index="${i}">${escapeHtml(g)}</span>
       <button class="goal-del" data-index="${i}" aria-label="削除">🗑</button>`;
    ul.appendChild(li);
  });
}

function showGoalForm(index) {
  editingGoalIndex = index;
  $("goalFormLabel").textContent = index == null ? "新しい目標" : "目標を編集";
  $("goalInput").value = index == null ? "" : data.goals[index];
  $("goalForm").classList.remove("hidden");
  $("btnAddGoal").classList.add("hidden");
  $("goalInput").focus();
}
function hideGoalForm() {
  editingGoalIndex = null;
  $("goalInput").value = "";
  $("goalForm").classList.add("hidden");
  $("btnAddGoal").classList.remove("hidden");
}

/* ============ データビュー ============ */
// プロフィールから計算できる指標を表示
function renderProfileStats() {
  const box = $("profileStats");
  const rows = [];
  const age = ageOf();
  if (age != null) rows.push(["年齢", `${age}歳`]);
  const lw = latestValue("weightKg");
  if (lw) rows.push(["最新の体重", `${lw.value}kg（${fmtMD(lw.date)}）`]);
  const lf = latestValue("bodyFat");
  if (lf) rows.push(["最新の体脂肪率", `${lf.value}％（${fmtMD(lf.date)}）`]);
  const bmi = lw ? bmiOf(lw.value) : null;
  if (bmi != null) rows.push(["BMI", `${bmi}`]);
  const bmr = lw ? bmrOf(lw.value) : null;
  if (bmr != null) rows.push(["基礎代謝の目安", `約${bmr.toLocaleString()}kcal／日`]);
  if (age != null) rows.push(["最大心拍数の目安", `約${220 - age}拍／分（220−年齢）`]);
  if (data.targetWeight != null && lw) {
    const d = Math.round((lw.value - data.targetWeight) * 10) / 10;
    rows.push(["目標体重まで", d > 0 ? `あと−${d}kg` : d < 0 ? `目標より${-d}kg軽い` : "達成！"]);
  }
  if (data.targetBodyFat != null && lf) {
    const d = Math.round((lf.value - data.targetBodyFat) * 10) / 10;
    rows.push(["目標体脂肪率まで", d > 0 ? `あと−${d}％` : d < 0 ? `目標より${-d}％低い` : "達成！"]);
  }
  box.innerHTML = rows.length
    ? `<table class="ana-table"><tbody>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`
    : "";
}

function renderDataStats() {
  renderGoals();
  $("profileHeight").value = data.heightCm ?? "";
  $("profileGender").value = data.gender ?? "";
  if (data.birthDate) {
    const [y, m, d] = data.birthDate.split("-").map(Number);
    $("profileBirthY").value = y;
    $("profileBirthM").value = m;
    $("profileBirthD").value = d;
  } else {
    $("profileBirthY").value = "";
    $("profileBirthM").value = "";
    $("profileBirthD").value = "";
  }
  $("profileTargetWeight").value = data.targetWeight ?? "";
  $("profileTargetFat").value = data.targetBodyFat ?? "";
  renderProfileStats();
  const n = Object.keys(data.records).length;
  const dates = Object.keys(data.records).sort();
  $("dataStats").textContent = n
    ? `保存済み：${n}日分（${dates[0]} 〜 ${dates[dates.length - 1]}）`
    : "保存されている記録はまだありません。";
}

function exportData() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `training-log-${jstTodayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast("エクスポートしました");
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed.records !== "object") throw new Error("形式が違います");
      const incoming = Object.keys(parsed.records).length;
      if (!confirm(`${incoming}日分の記録を読み込みます。同じ日付の既存データは上書きされます。よろしいですか？`)) return;
      Object.assign(data.records, parsed.records);
      if (Array.isArray(parsed.goals)) {
        data.goals = parsed.goals.filter(g => typeof g === "string" && g.trim());
      }
      if (typeof parsed.heightCm === "number") data.heightCm = parsed.heightCm;
      if (parsed.gender === "male" || parsed.gender === "female") data.gender = parsed.gender;
      if (typeof parsed.birthDate === "string") data.birthDate = parsed.birthDate;
      if (typeof parsed.targetWeight === "number") data.targetWeight = parsed.targetWeight;
      if (typeof parsed.targetBodyFat === "number") data.targetBodyFat = parsed.targetBodyFat;
      saveData();
      renderDataStats();
      toast("インポートしました");
    } catch (e) {
      alert("読み込みに失敗しました：JSONファイルの形式を確認してください。");
    }
  };
  reader.readAsText(file);
}

/* ============ イベント登録 ============ */
function init() {
  // タブ
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => switchView(t.dataset.view)));

  // 日付移動
  $("recordDate").addEventListener("change", e => {
    if (e.target.value) { state.date = e.target.value; renderRecordView(); }
  });
  $("datePrev").addEventListener("click", () => { state.date = addDays(state.date, -1); renderRecordView(); });
  $("dateNext").addEventListener("click", () => { state.date = addDays(state.date, 1); renderRecordView(); });
  $("dateToday").addEventListener("click", () => { state.date = jstTodayStr(); renderRecordView(); });

  // トレ日/休養日
  document.querySelectorAll(".daytype-btn").forEach(b =>
    b.addEventListener("click", () => {
      const r = ensureRecord(state.date);
      r.dayType = r.dayType === b.dataset.daytype ? null : b.dataset.daytype;
      pruneIfEmpty(state.date);
      saveData();
      renderRecordView();
    }));

  // 種目フォーム
  $("btnAddExercise").addEventListener("click", () => showExerciseForm(true));
  $("btnCancelExercise").addEventListener("click", () => { clearExerciseForm(); showExerciseForm(false); });
  $("exType").addEventListener("change", updateTypeFields);
  $("exerciseForm").addEventListener("submit", e => {
    e.preventDefault();
    const ex = readExerciseForm();
    if (!ex) { toast("種目名を入力してください"); return; }
    const r = ensureRecord(state.date);
    r.exercises.push(ex);
    if (r.dayType == null) r.dayType = "training";
    saveData();
    clearExerciseForm();
    showExerciseForm(false);
    renderRecordView();
    toast(`${ex.name} を追加しました`);
  });

  // 部位から種目を選ぶ
  fillSelect($("catL1"), sortByOrder(CAT_TREE.keys(), CAT_L1_ORDER), "選択");
  $("btnPickByPart").addEventListener("click", () => {
    const picker = $("partPicker");
    const opening = picker.classList.contains("hidden");
    picker.classList.toggle("hidden");
    if (opening) renderCatResults();
  });
  $("catL1").addEventListener("change", onCatL1Change);
  $("catL2").addEventListener("change", onCatL2Change);
  $("catL3").addEventListener("change", renderCatResults);
  $("catResults").addEventListener("click", e => {
    const chip = e.target.closest(".cat-chip");
    if (chip) pickExercise(chip.dataset.name);
  });

  // 種目のWeb検索
  $("btnLookup").addEventListener("click", () => {
    const name = $("exName").value.trim();
    if (!name) { toast("種目名を入力してください"); return; }
    openLookup(name);
  });
  $("lookupClose").addEventListener("click", closeLookup);
  $("lookupOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) closeLookup(); });

  // 種目削除・種目名タップで検索
  $("exerciseList").addEventListener("click", e => {
    const nameEl = e.target.closest(".ex-name");
    if (nameEl) {
      const r = getRecord(state.date);
      const ex = r?.exercises[Number(nameEl.dataset.index)];
      if (ex) openLookup(ex.name);
      return;
    }
    const btn = e.target.closest(".ex-del");
    if (!btn) return;
    const i = Number(btn.dataset.index);
    const r = getRecord(state.date);
    if (!r) return;
    const name = r.exercises[i]?.name || "";
    if (!confirm(`「${name}」を削除しますか？`)) return;
    r.exercises.splice(i, 1);
    pruneIfEmpty(state.date);
    saveData();
    renderRecordView();
  });

  // コンディション
  bindCondInput("condTotalMin", "totalMinutes", true);
  bindCondInput("condFatigue", "fatigue", true);
  bindCondInput("condSleepH", "sleepHours", true);
  bindCondInput("condSleepNote", "sleepNote", false);
  bindCondInput("condPain", "pain", false);
  bindCondInput("condWeight", "weightKg", true);
  bindCondInput("condBodyFat", "bodyFat", true);
  bindCondInput("condSteps", "steps", true);
  bindCondInput("condActivity", "activity", false);
  bindCondInput("condComment", "comment", false);

  // まとめ・削除
  $("btnSummary").addEventListener("click", () =>
    showSummaryModal("記録のまとめ", buildDaySummary(state.date), state.date));
  $("btnDeleteDay").addEventListener("click", () => {
    if (!getRecord(state.date)) { toast("この日の記録はありません"); return; }
    if (!confirm(`${fmtDateJa(state.date)} の記録をすべて削除しますか？`)) return;
    delete data.records[state.date];
    saveData();
    renderRecordView();
    toast("削除しました");
  });

  // モーダル
  $("modalClose").addEventListener("click", closeModal);
  $("btnCloseSummary").addEventListener("click", closeModal);
  $("modalOverlay").addEventListener("click", e => { if (e.target === e.currentTarget) closeModal(); });
  $("btnCopySummary").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("summaryText").textContent);
      toast("コピーしました");
    } catch {
      toast("コピーできませんでした");
    }
  });
  $("btnEditDay").addEventListener("click", () => {
    if (!modalDate) return;
    const d = modalDate;
    closeModal();
    state.date = d;
    switchView("record");
    toast(`${fmtDateJa(d)} の編集画面を開きました`);
  });
  $("btnAiEval").addEventListener("click", async () => {
    if (!modalDate || !getRecord(modalDate)) { toast("この日の記録がありません"); return; }
    const prompt = buildEvalPrompt(modalDate);
    // モーダル本文を評価用プロンプトに切り替えて表示（コピー失敗時も手動コピーできる）
    $("modalTitle").textContent = "AI評価用プロンプト";
    $("summaryText").textContent = prompt;
    $("aiEvalPanel").classList.remove("hidden");
    try {
      await navigator.clipboard.writeText(prompt);
      toast("評価用プロンプトをコピーしました");
    } catch {
      toast("「コピー」ボタンでコピーしてください");
    }
  });

  // 履歴
  $("histMonth").addEventListener("change", e => {
    if (e.target.value) { state.histMonth = e.target.value; renderHistory(); }
  });
  $("histPrev").addEventListener("click", () => { state.histMonth = shiftMonth(state.histMonth, -1); renderHistory(); });
  $("histNext").addEventListener("click", () => { state.histMonth = shiftMonth(state.histMonth, 1); renderHistory(); });

  // 分析
  $("segWeek").addEventListener("click", () => { state.anaMode = "week"; renderAnalysis(); });
  $("segMonth").addEventListener("click", () => { state.anaMode = "month"; renderAnalysis(); });
  $("anaPrev").addEventListener("click", () => {
    state.anaAnchor = state.anaMode === "week"
      ? addDays(mondayOf(state.anaAnchor), -7)
      : shiftMonth(state.anaAnchor.slice(0, 7), -1) + "-01";
    renderAnalysis();
  });
  $("anaNext").addEventListener("click", () => {
    state.anaAnchor = state.anaMode === "week"
      ? addDays(mondayOf(state.anaAnchor), 7)
      : shiftMonth(state.anaAnchor.slice(0, 7), 1) + "-01";
    renderAnalysis();
  });

  // 目標の追加・編集・削除
  $("btnAddGoal").addEventListener("click", () => showGoalForm(null));
  $("btnCancelGoal").addEventListener("click", hideGoalForm);
  $("goalForm").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("goalInput").value.trim();
    if (!text) return;
    if (editingGoalIndex == null) data.goals.push(text);
    else data.goals[editingGoalIndex] = text;
    saveData();
    hideGoalForm();
    renderGoals();
    toast("目標を保存しました");
  });
  $("goalList").addEventListener("click", e => {
    const del = e.target.closest(".goal-del");
    if (del) {
      const i = Number(del.dataset.index);
      if (!confirm(`「${data.goals[i]}」を削除しますか？`)) return;
      data.goals.splice(i, 1);
      saveData();
      hideGoalForm();
      renderGoals();
      return;
    }
    const txt = e.target.closest(".goal-text");
    if (txt) showGoalForm(Number(txt.dataset.index));
  });

  // プロフィール
  const bindProfile = (id, key, isNum) => {
    $(id).addEventListener("change", e => {
      const v = isNum ? numOrNull(e.target.value) : (e.target.value || null);
      data[key] = v;
      saveData();
      renderProfileStats();
      toast("プロフィールを保存しました");
    });
  };
  bindProfile("profileHeight", "heightCm", true);
  bindProfile("profileGender", "gender", false);
  bindProfile("profileTargetWeight", "targetWeight", true);
  bindProfile("profileTargetFat", "targetBodyFat", true);

  // 生年月日（年・月・日の手入力）: 3つ揃ったら検証して保存
  const onBirthChange = () => {
    const y = numOrNull($("profileBirthY").value);
    const m = numOrNull($("profileBirthM").value);
    const d = numOrNull($("profileBirthD").value);
    if (y == null && m == null && d == null) {
      if (data.birthDate != null) {
        data.birthDate = null;
        saveData();
        renderProfileStats();
        toast("生年月日の設定を削除しました");
      }
      return;
    }
    if (y == null || m == null || d == null) return; // 入力途中は保存しない
    const dt = new Date(Date.UTC(y, m - 1, d));
    const valid = y >= 1900 && y <= 2100 &&
      dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    if (!valid) {
      toast("正しい日付を入力してください");
      return;
    }
    data.birthDate = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    saveData();
    renderProfileStats();
    toast("生年月日を保存しました");
  };
  ["profileBirthY", "profileBirthM", "profileBirthD"].forEach(id =>
    $(id).addEventListener("change", onBirthChange));

  // データ管理
  $("btnExport").addEventListener("click", () => {
    const n = Object.keys(data.records).length;
    if (!confirm(`記録データ（${n}日分）をJSONファイルとして保存（エクスポート）します。よろしいですか？`)) return;
    exportData();
  });
  $("importLabel").addEventListener("click", e => {
    if (!confirm("バックアップのJSONファイルをインポート（読み込み）します。同じ日付の既存データは上書きされます。ファイルを選択しますか？")) {
      e.preventDefault();
    }
  });
  $("importFile").addEventListener("change", e => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });
  $("btnWipe").addEventListener("click", () => {
    if (!confirm("すべての記録を削除します。元に戻せません。よろしいですか？")) return;
    if (!confirm("本当に削除しますか？（エクスポートしていない場合、データは失われます）")) return;
    data = { records: {}, goals: [...DEFAULT_GOALS], heightCm: null, gender: null, birthDate: null, targetWeight: null, targetBodyFat: null };
    saveData();
    renderDataStats();
    toast("全データを削除しました");
  });

  // Service Worker（httpsまたはlocalhostでのみ有効）
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  updateTypeFields();
  switchView("record");
}

function shiftMonth(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

document.addEventListener("DOMContentLoaded", init);
})();
