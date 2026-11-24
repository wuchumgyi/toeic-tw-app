(function () {
  "use strict";

  const DATA = window.TOEIC_DATA;
  if (!DATA) {
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;">找不到教材資料檔 <code>assets/toeic_bundle.js</code>，請確認資料夾結構完整。</div>';
    return;
  }

  const LETTERS = ["A", "B", "C", "D"];
  const STORAGE_KEY = "toeic_tw_study_state_v1";

  // 預設學習進度狀態
  const defaultState = {
    accent: "en-US",
    rate: 1,
    dark: false,
    largeText: false,
    coreSrs: {},         // { wordLower: "hard" | "medium" | "easy" }
    bookmarks: {},       // { wordLower: { word, zh, ipa, pos, example } }
    typingDone: {},      // { wordLower: count }
    grammarRead: {},     // { slug: true }
    quizHistory: {},     // { qId: { selected, correct, grammarSlug, grammarCategory, ts } }
    wrongBook: {},       // { qId: true }
    mockRecords: [],     // [{ date, mode, correct, total, estScore, elapsedSec }]
  };

  let state = loadState();

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(defaultState);
      return Object.assign(structuredClone(defaultState), JSON.parse(raw));
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn("無法儲存進度至 localStorage:", e);
    }
  }

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ===== 語音朗讀引擎（支援美／英／澳多國多益考場口音，相容 iOS Safari）=====
  let cachedVoices = [];
  function refreshVoices() {
    if ("speechSynthesis" in window) {
      cachedVoices = window.speechSynthesis.getVoices() || [];
    }
  }
  if ("speechSynthesis" in window) {
    refreshVoices();
    if ("onvoiceschanged" in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = refreshVoices;
    }
  }

  function speak(text) {
    if (!text || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = state.accent || "en-US";
      utter.rate = Number(state.rate) || 1;
      const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => v.lang === utter.lang && /Natural|Samantha|Daniel|Karen|Google|Microsoft/i.test(v.name)) ||
        voices.find((v) => v.lang === utter.lang) ||
        voices.find((v) => v.lang.startsWith("en"));
      if (preferred) utter.voice = preferred;
      window.speechSynthesis.speak(utter);
    } catch (e) {
      console.warn("語音朗讀暫時不可用:", e);
    }
  }

  // ===== 輔助計算 =====
  function getAllQuestionsFlat() {
    const list = [];
    DATA.part5.forEach((q) => list.push({ ...q, part: 5 }));
    DATA.part6.forEach((p) => {
      p.questions.forEach((q) =>
        list.push({ ...q, part: 6, passageId: p.passageId, passage: p })
      );
    });
    DATA.part7.forEach((p) => {
      p.questions.forEach((q) =>
        list.push({ ...q, part: 7, passageId: p.passageId, passage: p })
      );
    });
    return list;
  }

  const ALL_QUESTIONS = getAllQuestionsFlat();
  const QUESTION_MAP = Object.fromEntries(ALL_QUESTIONS.map((q) => [q.id, q]));

  function estimateToeicReadingScore(correct, total) {
    if (!total) return 5;
    const ratio = correct / total;
    // 依據常見新制多益閱讀量尺換算（5–495 分，每 5 分一級）
    let raw;
    if (ratio <= 0.15) raw = 5 + ratio * 200;
    else if (ratio <= 0.5) raw = 35 + ((ratio - 0.15) / 0.35) * 185;
    else if (ratio <= 0.85) raw = 220 + ((ratio - 0.5) / 0.35) * 205;
    else raw = 425 + ((ratio - 0.85) / 0.15) * 70;
    const rounded = Math.round(raw / 5) * 5;
    return Math.max(5, Math.min(495, rounded));
  }

  function toggleBookmark(item) {
    const key = item.word.toLowerCase();
    if (state.bookmarks[key]) {
      delete state.bookmarks[key];
    } else {
      state.bookmarks[key] = {
        word: item.word,
        zh: item.zh || item.summary_zh || "",
        ipa: item.ipa || (item.usphone ? `/${item.usphone}/` : ""),
        pos: item.pos || "",
        example: item.example_en || "",
      };
    }
    saveState();
  }

  // ===== 導覽與全域設定 =====
  let activeView = "dashboard";

  function syncThemeColor() {
    const meta = document.getElementById("themeColorMeta");
    if (meta) meta.setAttribute("content", state.dark ? "#13171d" : "#1e3a5f");
  }

  function switchView(viewId) {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
    document.body.classList.remove("keyboard-open");
    activeView = viewId;
    document.querySelectorAll(".nav-tab, .mb-tab").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === viewId);
    });
    document.querySelectorAll(".view").forEach((s) => {
      s.classList.toggle("active", s.id === `view-${viewId}`);
    });
    if (viewId === "dashboard") renderDashboard();
    if (viewId === "core600") renderCore600();
    if (viewId === "typing") renderTyping();
    if (viewId === "grammar") renderGrammar();
    if (viewId === "practice") renderPractice();
    if (viewId === "mock") renderMock();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function initHeaderControls() {
    const accentSel = document.getElementById("accentSelect");
    const rateSel = document.getElementById("rateSelect");
    const themeBtn = document.getElementById("themeToggleBtn");
    const fontBtn = document.getElementById("fontToggleBtn");

    accentSel.value = state.accent;
    rateSel.value = String(state.rate);
    document.body.classList.toggle("dark", !!state.dark);
    document.body.classList.toggle("large-text", !!state.largeText);
    themeBtn.textContent = state.dark ? "淺色" : "深色";
    syncThemeColor();

    accentSel.addEventListener("change", () => {
      state.accent = accentSel.value;
      saveState();
      speak("Welcome to your TOEIC practice session.");
    });
    rateSel.addEventListener("change", () => {
      state.rate = Number(rateSel.value);
      saveState();
    });
    themeBtn.addEventListener("click", () => {
      state.dark = !state.dark;
      document.body.classList.toggle("dark", state.dark);
      themeBtn.textContent = state.dark ? "淺色" : "深色";
      syncThemeColor();
      saveState();
    });
    fontBtn.addEventListener("click", () => {
      state.largeText = !state.largeText;
      document.body.classList.toggle("large-text", state.largeText);
      saveState();
    });

    document.getElementById("navTabs").addEventListener("click", (e) => {
      const btn = e.target.closest(".nav-tab");
      if (btn && btn.dataset.view) switchView(btn.dataset.view);
    });

    const mobileNav = document.getElementById("mobileBottomNav");
    if (mobileNav) {
      mobileNav.addEventListener("click", (e) => {
        const btn = e.target.closest(".mb-tab");
        if (btn && btn.dataset.view) switchView(btn.dataset.view);
      });
    }

    // 匯入備份檔事件
    document.getElementById("importFileInput").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          state = Object.assign(structuredClone(defaultState), parsed);
          saveState();
          alert("已成功匯入學習進度備份！");
          renderDashboard();
        } catch {
          alert("備份檔格式不正確，請確認選擇的是本系統匯出的 JSON 檔。");
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });
  }

  // =========================================================================
  // 1. 總覽儀表板
  // =========================================================================
  function renderDashboard() {
    const el = document.getElementById("view-dashboard");
    const c = DATA.meta.counts;

    const coreEasy = Object.values(state.coreSrs).filter((v) => v === "easy").length;
    const coreReviewed = Object.keys(state.coreSrs).length;
    const typingUnique = Object.keys(state.typingDone).length;
    const grammarReadCount = Object.keys(state.grammarRead).length;
    const quizEntries = Object.values(state.quizHistory);
    const quizRight = quizEntries.filter((x) => x.correct).length;
    const quizPct = quizEntries.length ? Math.round((quizRight / quizEntries.length) * 100) : 0;
    const wrongCount = Object.keys(state.wrongBook).length;
    const bookmarkList = Object.values(state.bookmarks);

    // 依 12 大文法計算答題弱點統計
    const grammarStats = DATA.grammar.map((g) => {
      const qs = ALL_QUESTIONS.filter((q) => q.grammarSlug === g.slug);
      let done = 0;
      let right = 0;
      qs.forEach((q) => {
        const h = state.quizHistory[q.id];
        if (h) {
          done++;
          if (h.correct) right++;
        }
      });
      return {
        slug: g.slug,
        title: g.category,
        done,
        right,
        total: qs.length,
        pct: done ? Math.round((right / done) * 100) : null,
      };
    });

    const corePct = Math.round((coreEasy / c.core600) * 100);
    const typingPct = Math.round((typingUnique / c.toeic1656) * 100);
    const gramPct = Math.round((grammarReadCount / c.grammar) * 100);

    el.innerHTML = `
      <div class="card" style="background: linear-gradient(135deg, var(--surface) 0%, var(--surface-alt) 100%);">
        <div class="card-title">
          <span>歡迎回來！今天準備攻克哪一塊多益分數？</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="btnExportData">匯出學習進度</button>
            <button class="btn btn-sm" id="btnImportData">匯入備份</button>
            <button class="btn btn-sm btn-red" id="btnResetData">重置進度</button>
          </div>
        </div>
        <p class="muted" style="margin:0 0 14px;">
          本系統完全離線運行，所有進度自動儲存在本機瀏覽器中。上方可隨時切換<strong>美式／英式／澳式</strong>考場口音朗讀單字與例句。
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <button class="btn btn-primary" data-jump="core600">開始背 600 核心主題單字</button>
          <button class="btn btn-accent" data-jump="typing">鍵盤打字背 1,656 詞庫</button>
          <button class="btn" data-jump="grammar">精讀 12 大必考文法</button>
          <button class="btn" data-jump="practice">刷 Part 5–7 閱讀題庫</button>
          <button class="btn btn-amber" data-jump="mock">挑戰 75 分鐘計時模考</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">600 核心主題單字（熟記／已複習）</div>
          <div class="stat-value">${coreEasy} <span style="font-size:1rem;color:var(--text-muted)">/ ${c.core600}</span></div>
          <div class="stat-sub">已複習 ${coreReviewed} 字・涵蓋 ${c.topics} 大職場主題</div>
          <div class="progress-track"><div class="progress-fill green" style="width:${corePct}%"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">鍵盤打字拼寫已練字數</div>
          <div class="stat-value">${typingUnique} <span style="font-size:1rem;color:var(--text-muted)">/ ${c.toeic1656}</span></div>
          <div class="stat-sub">多益進階高頻詞庫共 ${c.chapters} 章</div>
          <div class="progress-track"><div class="progress-fill" style="width:${typingPct}%"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">12 大必考文法進度</div>
          <div class="stat-value">${grammarReadCount} <span style="font-size:1rem;color:var(--text-muted)">/ ${c.grammar}</span></div>
          <div class="stat-sub">全台灣文法專有名詞與句構拆解</div>
          <div class="progress-track"><div class="progress-fill amber" style="width:${gramPct}%"></div></div>
        </div>
        <div class="stat-card">
          <div class="stat-label">閱讀 100 題實戰正確率</div>
          <div class="stat-value">${quizPct}% <span style="font-size:1rem;color:var(--text-muted)">(${quizRight}/${quizEntries.length})</span></div>
          <div class="stat-sub">待複習錯題：${wrongCount} 題・生字本：${bookmarkList.length} 字</div>
          <div class="progress-track"><div class="progress-fill ${quizPct >= 80 ? "green" : quizPct >= 60 ? "amber" : "red"}" style="width:${quizPct}%"></div></div>
        </div>
      </div>

      <div class="split-layout" style="grid-template-columns: 1.2fr 1fr;">
        <div class="card">
          <div class="card-title">
            <span>文法與考點弱點分析</span>
            ${wrongCount > 0 ? `<button class="btn btn-sm btn-red" id="btnJumpWrong">複習 ${wrongCount} 題錯題本</button>` : ""}
          </div>
          <div>
            ${grammarStats
              .map((g) => {
                const barCls = g.pct === null ? "" : g.pct >= 80 ? "green" : g.pct >= 60 ? "amber" : "red";
                return `
                  <div class="weakness-row">
                    <div class="weakness-name">${esc(g.title)}</div>
                    <div style="flex:1;">
                      <div class="progress-track" style="margin-top:0;">
                        <div class="progress-fill ${barCls}" style="width:${g.pct ?? 0}%"></div>
                      </div>
                    </div>
                    <div style="min-width:92px;text-align:right;font-size:0.84rem;" class="muted">
                      ${g.done ? `${g.pct}% (${g.right}/${g.done})` : "尚未作答"}
                    </div>
                    <button class="btn btn-sm" data-drill-grammar="${g.slug}">刷題</button>
                  </div>
                `;
              })
              .join("")}
          </div>
        </div>

        <div class="card">
          <div class="card-title">
            <span>我的生字本（${bookmarkList.length}）</span>
            ${bookmarkList.length ? `<button class="btn btn-sm btn-accent" id="btnTypeBookmarks">用打字複習生字本</button>` : ""}
          </div>
          ${
            bookmarkList.length === 0
              ? `<div class="empty-state">尚未收藏單字。在單字卡或打字練習中點擊「★ 收藏」就會自動收錄到這裡。</div>`
              : `<div style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;">
                  ${bookmarkList
                    .map(
                      (b) => `
                    <div class="vocab-item" style="padding:10px 12px;">
                      <div class="vocab-head">
                        <div>
                          <span class="vocab-word">${esc(b.word)}</span>
                          <span class="muted" style="font-size:0.82rem;margin-left:6px;">${esc(b.ipa)}</span>
                        </div>
                        <div style="display:flex;gap:6px;">
                          <button class="btn btn-sm" data-speak="${esc(b.word)}">發音</button>
                          <button class="btn btn-sm btn-red" data-unbm="${esc(b.word.toLowerCase())}">移除</button>
                        </div>
                      </div>
                      <div style="font-size:0.88rem;">${esc(b.zh)}</div>
                    </div>
                  `
                    )
                    .join("")}
                </div>`
          }

          ${
            state.mockRecords.length
              ? `<hr style="border:none;border-top:1px solid var(--border);margin:16px 0;" />
                 <div style="font-weight:800;margin-bottom:8px;">最近模擬考紀錄</div>
                 ${state.mockRecords
                   .slice(-5)
                   .reverse()
                   .map(
                     (r) => `
                   <div style="display:flex;justify-content:space-between;font-size:0.85rem;padding:4px 0;border-bottom:1px dashed var(--border);">
                     <span>${esc(r.date)}・${esc(r.mode)}</span>
                     <span><strong>預估 ${r.estScore} 分</strong>（${r.correct}/${r.total}）</span>
                   </div>
                 `
                   )
                   .join("")}`
              : ""
          }
        </div>
      </div>
    `;

    el.querySelectorAll("[data-jump]").forEach((b) =>
      b.addEventListener("click", () => switchView(b.dataset.jump))
    );
    el.querySelectorAll("[data-drill-grammar]").forEach((b) =>
      b.addEventListener("click", () => {
        practiceState.mode = "part5";
        practiceState.grammarFilter = b.dataset.drillGrammar;
        switchView("practice");
      })
    );
    el.querySelectorAll("[data-speak]").forEach((b) =>
      b.addEventListener("click", () => speak(b.dataset.speak))
    );
    el.querySelectorAll("[data-unbm]").forEach((b) =>
      b.addEventListener("click", () => {
        delete state.bookmarks[b.dataset.unbm];
        saveState();
        renderDashboard();
      })
    );

    const btnWrong = document.getElementById("btnJumpWrong");
    if (btnWrong) {
      btnWrong.addEventListener("click", () => {
        practiceState.mode = "wrong";
        switchView("practice");
      });
    }
    const btnTypeBm = document.getElementById("btnTypeBookmarks");
    if (btnTypeBm) {
      btnTypeBm.addEventListener("click", () => {
        typingState.source = "bookmarks";
        typingState.index = 0;
        typingState.typed = "";
        switchView("typing");
      });
    }

    document.getElementById("btnExportData").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `toeic-tw-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
    document.getElementById("btnImportData").addEventListener("click", () => {
      document.getElementById("importFileInput").click();
    });
    document.getElementById("btnResetData").addEventListener("click", () => {
      if (confirm("確定要清空所有單字熟練度、刷題與模擬考紀錄嗎？建議先點「匯出學習進度」備份。")) {
        state = structuredClone(defaultState);
        saveState();
        renderDashboard();
      }
    });
  }

  // =========================================================================
  // 2. 600 核心主題單字館（50 主題 × 615 字｜記憶卡 + 清單）
  // =========================================================================
  const coreState = {
    topic: "ALL",
    srsFilter: "ALL",
    search: "",
    viewMode: "card", // "card" | "list"
    cardIndex: 0,
    flipped: false,
  };

  function getFilteredCore600() {
    const q = coreState.search.trim().toLowerCase();
    return DATA.core600.filter((item) => {
      if (coreState.topic !== "ALL" && item.topic_zh !== coreState.topic) return false;
      const lvl = state.coreSrs[item.word.toLowerCase()] || "new";
      if (coreState.srsFilter !== "ALL" && lvl !== coreState.srsFilter) return false;
      if (
        q &&
        !item.word.toLowerCase().includes(q) &&
        !item.zh.toLowerCase().includes(q) &&
        !item.topic_zh.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }

  function renderCore600() {
    const el = document.getElementById("view-core600");
    const items = getFilteredCore600();
    if (coreState.cardIndex >= items.length) coreState.cardIndex = 0;

    const topicOptions = DATA.topics
      .map(
        (t) =>
          `<option value="${esc(t.zh)}" ${coreState.topic === t.zh ? "selected" : ""}>${esc(t.zh)} (${esc(t.en)}) [${t.count}]</option>`
      )
      .join("");

    let bodyHtml = "";
    if (items.length === 0) {
      bodyHtml = `<div class="card empty-state">找不到符合條件的單字，請調整主題或搜尋關鍵字。</div>`;
    } else if (coreState.viewMode === "card") {
      const cur = items[coreState.cardIndex];
      const key = cur.word.toLowerCase();
      const srs = state.coreSrs[key];
      const isBm = !!state.bookmarks[key];
      const srsBadge =
        srs === "easy"
          ? '<span class="pill green">已熟記</span>'
          : srs === "medium"
          ? '<span class="pill amber">略模糊</span>'
          : srs === "hard"
          ? '<span class="pill red">需加強</span>'
          : '<span class="pill">尚未複習</span>';

      bodyHtml = `
        <div class="flashcard-stage">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;font-size:0.88rem;" class="muted">
            <span>第 ${coreState.cardIndex + 1} / ${items.length} 張卡片・主題：<strong>${esc(cur.topic_zh)}</strong>（${esc(cur.topic_en)}）</span>
            <span>快捷鍵：空白鍵翻面・← / → 切換</span>
          </div>

          <div class="flashcard" id="flashcardBox">
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
                <div style="display:flex;gap:6px;align-items:center;">
                  <span class="pill blue">${esc(cur.pos)}</span>
                  ${srsBadge}
                  ${cur.in_1694 ? '<span class="pill purple">雙庫必考字</span>' : ""}
                </div>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-sm" id="fcSpeakWord" type="button">單字發音</button>
                  <button class="btn btn-sm ${isBm ? "btn-amber" : ""}" id="fcToggleBm" type="button">${isBm ? "★ 已收藏" : "☆ 收藏生字"}</button>
                </div>
              </div>

              <div style="margin:14px 0;">
                <span class="fc-word">${esc(cur.word)}</span>
                <span class="fc-ipa">${esc(cur.ipa)}</span>
              </div>

              ${
                coreState.flipped
                  ? `<div class="fc-back">
                      <div class="fc-zh">${esc(cur.zh)}</div>
                      <div class="fc-en-def"><strong>英文釋義：</strong>${esc(cur.explain_en)}</div>
                      <div class="fc-example">
                        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                          <strong>職場實戰例句：</strong>
                          <button class="btn btn-sm" id="fcSpeakExample" type="button">朗讀例句</button>
                        </div>
                        <div style="margin-top:4px;">${esc(cur.example_en)}</div>
                      </div>
                    </div>`
                  : `<div style="margin-top:34px;text-align:center;color:var(--text-muted);padding:24px;border:1px dashed var(--border);border-radius:12px;">
                      點擊卡片任意處或按 <strong>空白鍵（Space）</strong> 查看台灣繁中釋義與職場例句
                    </div>`
              }
            </div>
          </div>

          <div class="srs-actions">
            <button class="btn" id="fcPrev">← 上一張</button>
            <button class="btn btn-red" data-srs="hard">不熟（需加強）</button>
            <button class="btn btn-amber" data-srs="medium">模糊（再複習）</button>
            <button class="btn btn-green" data-srs="easy">已熟記 ✓</button>
            <button class="btn" id="fcNext">下一張 →</button>
          </div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div class="vocab-grid">
          ${items
            .map((cur) => {
              const key = cur.word.toLowerCase();
              const isBm = !!state.bookmarks[key];
              const srs = state.coreSrs[key];
              return `
              <div class="vocab-item">
                <div class="vocab-head">
                  <div>
                    <span class="vocab-word">${esc(cur.word)}</span>
                    <span class="pill blue" style="margin-left:4px;">${esc(cur.pos)}</span>
                    ${srs === "easy" ? '<span class="pill green">✓</span>' : ""}
                  </div>
                  <div style="display:flex;gap:5px;">
                    <button class="btn btn-sm" data-speak="${esc(cur.word)}">發音</button>
                    <button class="btn btn-sm ${isBm ? "btn-amber" : ""}" data-bm-word="${esc(cur.word)}">${isBm ? "★" : "☆"}</button>
                  </div>
                </div>
                <div class="muted" style="font-size:0.82rem;">${esc(cur.ipa)}・${esc(cur.topic_zh)}</div>
                <div style="font-weight:700;">${esc(cur.zh)}</div>
                <div style="font-size:0.86rem;color:var(--text-muted);background:var(--surface-alt);padding:8px 10px;border-radius:8px;">
                  ${esc(cur.example_en)}
                  <button class="btn btn-sm" style="margin-left:6px;padding:2px 7px;font-size:0.75rem;" data-speak="${esc(cur.example_en)}">聽例句</button>
                </div>
              </div>
            `;
            })
            .join("")}
        </div>
      `;
    }

    el.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>600 核心主題單字館（50 大多益職場主題 × 615 字）</span>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-sm ${coreState.viewMode === "card" ? "btn-primary" : ""}" id="btnCoreCardMode">記憶卡模式</button>
            <button class="btn btn-sm ${coreState.viewMode === "list" ? "btn-primary" : ""}" id="btnCoreListMode">清單一覽</button>
          </div>
        </div>
        <div class="toolbar">
          <select id="coreTopicSel" class="select-input" style="max-width:340px;">
            <option value="ALL" ${coreState.topic === "ALL" ? "selected" : ""}>全部 50 大主題（615 字）</option>
            ${topicOptions}
          </select>
          <select id="coreSrsSel" class="select-input">
            <option value="ALL" ${coreState.srsFilter === "ALL" ? "selected" : ""}>全部熟練度</option>
            <option value="new" ${coreState.srsFilter === "new" ? "selected" : ""}>尚未複習</option>
            <option value="hard" ${coreState.srsFilter === "hard" ? "selected" : ""}>不熟（需加強）</option>
            <option value="medium" ${coreState.srsFilter === "medium" ? "selected" : ""}>模糊</option>
            <option value="easy" ${coreState.srsFilter === "easy" ? "selected" : ""}>已熟記</option>
          </select>
          <input id="coreSearchInput" class="search-input" type="search" placeholder="搜尋英文單字、台灣繁中詞義或主題..." value="${esc(coreState.search)}" />
        </div>
      </div>
      ${bodyHtml}
    `;

    document.getElementById("coreTopicSel").addEventListener("change", (e) => {
      coreState.topic = e.target.value;
      coreState.cardIndex = 0;
      coreState.flipped = false;
      renderCore600();
    });
    document.getElementById("coreSrsSel").addEventListener("change", (e) => {
      coreState.srsFilter = e.target.value;
      coreState.cardIndex = 0;
      coreState.flipped = false;
      renderCore600();
    });
    document.getElementById("coreSearchInput").addEventListener("input", (e) => {
      coreState.search = e.target.value;
      coreState.cardIndex = 0;
      coreState.flipped = false;
      renderCore600();
    });
    document.getElementById("btnCoreCardMode").addEventListener("click", () => {
      coreState.viewMode = "card";
      renderCore600();
    });
    document.getElementById("btnCoreListMode").addEventListener("click", () => {
      coreState.viewMode = "list";
      renderCore600();
    });

    if (items.length > 0 && coreState.viewMode === "card") {
      const cur = items[coreState.cardIndex];
      const fcBox = document.getElementById("flashcardBox");
      fcBox.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        coreState.flipped = !coreState.flipped;
        renderCore600();
      });

      // 手機觸控左右滑動切卡手勢
      let touchStartX = 0;
      let touchStartY = 0;
      fcBox.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
          }
        },
        { passive: true }
      );
      fcBox.addEventListener(
        "touchend",
        (e) => {
          if (!e.changedTouches.length) return;
          const dx = e.changedTouches[0].clientX - touchStartX;
          const dy = e.changedTouches[0].clientY - touchStartY;
          if (Math.abs(dx) > 52 && Math.abs(dx) > Math.abs(dy) * 1.4) {
            coreState.cardIndex =
              dx < 0
                ? (coreState.cardIndex + 1) % items.length
                : (coreState.cardIndex - 1 + items.length) % items.length;
            coreState.flipped = false;
            renderCore600();
          }
        },
        { passive: true }
      );
      document.getElementById("fcSpeakWord").addEventListener("click", () => speak(cur.word));
      const exBtn = document.getElementById("fcSpeakExample");
      if (exBtn) exBtn.addEventListener("click", () => speak(cur.example_en));
      document.getElementById("fcToggleBm").addEventListener("click", () => {
        toggleBookmark(cur);
        renderCore600();
      });
      document.getElementById("fcPrev").addEventListener("click", () => {
        coreState.cardIndex = (coreState.cardIndex - 1 + items.length) % items.length;
        coreState.flipped = false;
        renderCore600();
      });
      document.getElementById("fcNext").addEventListener("click", () => {
        coreState.cardIndex = (coreState.cardIndex + 1) % items.length;
        coreState.flipped = false;
        renderCore600();
      });
      el.querySelectorAll("[data-srs]").forEach((btn) =>
        btn.addEventListener("click", () => {
          state.coreSrs[cur.word.toLowerCase()] = btn.dataset.srs;
          saveState();
          coreState.cardIndex = (coreState.cardIndex + 1) % items.length;
          coreState.flipped = false;
          renderCore600();
        })
      );
    } else {
      el.querySelectorAll("[data-speak]").forEach((b) =>
        b.addEventListener("click", () => speak(b.dataset.speak))
      );
      el.querySelectorAll("[data-bm-word]").forEach((b) =>
        b.addEventListener("click", () => {
          const found = DATA.core600.find((x) => x.word === b.dataset.bmWord);
          if (found) {
            toggleBookmark(found);
            renderCore600();
          }
        })
      );
    }
  }

  // =========================================================================
  // 3. 鍵盤打字背單字（致敬 Qwerty Learner｜手機不自動彈鍵盤、局部更新防跳動）
  // =========================================================================
  const typingState = {
    source: "toeic1656", // "toeic1656" | "core600" | "bookmarks"
    chapter: 1,
    coreTopic: "會計與帳務",
    dictation: false,
    autoSpeak: true,
    index: 0,
    typed: "",
    errFlag: false,
    sessionCorrectKeys: 0,
    sessionTotalKeys: 0,
    sessionCompletedWords: 0,
  };

  function isTouchDevice() {
    return window.matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
  }

  function getTypingWords() {
    if (typingState.source === "toeic1656") {
      return DATA.toeic1656
        .filter((x) => x.chapter === Number(typingState.chapter))
        .map((x) => ({
          word: x.word,
          ipa: x.usphone ? `/${x.usphone}/` : "",
          zh: x.summary_zh,
          example: "",
        }));
    }
    if (typingState.source === "core600") {
      return DATA.core600
        .filter((x) => x.topic_zh === typingState.coreTopic)
        .map((x) => ({
          word: x.word,
          ipa: x.ipa,
          zh: x.zh,
          example: x.example_en,
        }));
    }
    return Object.values(state.bookmarks).map((b) => ({
      word: b.word,
      ipa: b.ipa,
      zh: b.zh,
      example: b.example || "",
    }));
  }

  function buildTypingLettersHtml(target) {
    return target
      .split("")
      .map((ch, i) => {
        if (ch === " ") {
          return `<span class="ch-space">${i < typingState.typed.length ? "·" : " "}</span>`;
        }
        if (i < typingState.typed.length) {
          return `<span class="ch-done">${esc(ch)}</span>`;
        }
        if (i === typingState.typed.length && typingState.errFlag) {
          return `<span class="ch-err">${typingState.dictation ? "_" : esc(ch)}</span>`;
        }
        if (typingState.dictation) {
          return `<span class="ch-hidden">_</span>`;
        }
        return `<span class="ch-todo">${esc(ch)}</span>`;
      })
      .join("");
  }

  // 局部更新打字卡片內容（不重建 <input> DOM，避免手機跳動或強制彈出鍵盤）
  function updateTypingCard() {
    const words = getTypingWords();
    if (!words.length) {
      renderTyping();
      return;
    }
    if (typingState.index >= words.length) typingState.index = 0;
    const cur = words[typingState.index];
    const isBm = !!state.bookmarks[cur.word.toLowerCase()];
    const acc = typingState.sessionTotalKeys
      ? Math.round((typingState.sessionCorrectKeys / typingState.sessionTotalKeys) * 100)
      : 100;

    const progEl = document.getElementById("typingProgress");
    const statsEl = document.getElementById("typingStats");
    const bmBtn = document.getElementById("btnTypeBm");
    const lettersEl = document.getElementById("typingLetters");
    const ipaEl = document.getElementById("typingIpa");
    const zhEl = document.getElementById("typingZh");
    const exEl = document.getElementById("typingExample");
    const input = document.getElementById("typingInput");

    if (progEl) progEl.textContent = `本輪進度：${typingState.index + 1} / ${words.length}`;
    if (statsEl) statsEl.textContent = `本次完成：${typingState.sessionCompletedWords} 字・正確率：${acc}%`;
    if (bmBtn) {
      bmBtn.textContent = isBm ? "★ 已收藏" : "☆ 收藏生字";
      bmBtn.classList.toggle("btn-amber", isBm);
    }
    if (lettersEl) {
      lettersEl.innerHTML = buildTypingLettersHtml(cur.word);
      lettersEl.classList.remove("shake");
      if (typingState.errFlag) {
        void lettersEl.offsetWidth;
        lettersEl.classList.add("shake");
      }
    }
    if (ipaEl) ipaEl.textContent = cur.ipa || "";
    if (zhEl) zhEl.textContent = cur.zh || "";
    if (exEl) {
      if (cur.example) {
        exEl.style.display = "block";
        exEl.textContent = `例句：${cur.example}`;
      } else {
        exEl.style.display = "none";
        exEl.textContent = "";
      }
    }
    if (input && input.value !== typingState.typed) {
      input.value = typingState.typed;
    }
  }

  function renderTyping() {
    const el = document.getElementById("view-typing");
    const words = getTypingWords();
    if (typingState.index >= words.length) typingState.index = 0;

    const totalChapters = DATA.meta.counts.chapters;
    const chapterOptions = Array.from({ length: totalChapters }, (_, i) => i + 1)
      .map(
        (ch) =>
          `<option value="${ch}" ${Number(typingState.chapter) === ch ? "selected" : ""}>第 ${ch} 章（第 ${(ch - 1) * 20 + 1}–${Math.min(ch * 20, DATA.toeic1656.length)} 字）</option>`
      )
      .join("");

    const topicOptions = DATA.topics
      .map(
        (t) =>
          `<option value="${esc(t.zh)}" ${typingState.coreTopic === t.zh ? "selected" : ""}>${esc(t.zh)} (${t.count} 字)</option>`
      )
      .join("");

    let stageHtml = "";
    if (!words.length) {
      stageHtml = `<div class="card empty-state">目前清單為空（若選「我的生字本」，請先去單字館或打字時收藏幾個生字）。</div>`;
    } else {
      stageHtml = `
        <div class="card typing-box" id="typingCard">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
            <span class="pill blue" id="typingProgress"></span>
            <span class="pill green" id="typingStats"></span>
            <div style="display:flex;gap:6px;">
              <button class="btn btn-sm" id="btnTypeSpeak" type="button">發音</button>
              <button class="btn btn-sm" id="btnTypeBm" type="button">☆ 收藏生字</button>
              <button class="btn btn-sm typing-blur-btn" id="btnHideKb" type="button">收起鍵盤</button>
            </div>
          </div>

          <div class="typing-letters" id="typingLetters"></div>
          <div class="muted" id="typingIpa" style="margin-bottom:8px;"></div>
          <div id="typingZh" style="font-size:1.15rem;font-weight:800;margin-bottom:8px;"></div>
          <div class="muted" id="typingExample" style="display:none;font-size:0.88rem;max-width:600px;margin:0 auto 10px;"></div>

          <div>
            <input id="typingInput" class="typing-input-proxy" type="text" inputmode="latin" enterkeyhint="next"
              autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false"
              placeholder="點此拼寫英文單字（未點擊前不彈出鍵盤）" />
          </div>

          <div style="display:flex;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap;">
            <button class="btn btn-sm" id="btnTypePrev" type="button">← 上一字</button>
            <button class="btn btn-sm" id="btnTypeHint" type="button">提示字母</button>
            <button class="btn btn-sm" id="btnTypeNext" type="button">下一字 →</button>
          </div>
        </div>
      `;
    }

    el.innerHTML = `
      <div class="card typing-settings-card">
        <div class="card-title">
          <span>鍵盤打字背單字（拼寫＋發音訓練）</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-sm ${typingState.dictation ? "btn-amber" : ""}" id="btnDictationToggle" type="button">
              ${typingState.dictation ? "默寫模式：開" : "默寫模式：關"}
            </button>
            <button class="btn btn-sm ${typingState.autoSpeak ? "btn-green" : ""}" id="btnAutoSpeakToggle" type="button">
              自動發音：${typingState.autoSpeak ? "開" : "關"}
            </button>
          </div>
        </div>
        <div class="toolbar" style="margin-bottom:0;">
          <select id="typingSourceSel" class="select-input">
            <option value="toeic1656" ${typingState.source === "toeic1656" ? "selected" : ""}>多益 1,656 高頻詞庫（83 章）</option>
            <option value="core600" ${typingState.source === "core600" ? "selected" : ""}>600 核心主題單字（50 主題）</option>
            <option value="bookmarks" ${typingState.source === "bookmarks" ? "selected" : ""}>我的生字本（${Object.keys(state.bookmarks).length} 字）</option>
          </select>
          ${
            typingState.source === "toeic1656"
              ? `<select id="typingChapterSel" class="select-input">${chapterOptions}</select>`
              : typingState.source === "core600"
              ? `<select id="typingTopicSel" class="select-input">${topicOptions}</select>`
              : ""
          }
        </div>
      </div>
      ${stageHtml}
    `;

    document.getElementById("typingSourceSel").addEventListener("change", (e) => {
      typingState.source = e.target.value;
      typingState.index = 0;
      typingState.typed = "";
      typingState.errFlag = false;
      renderTyping();
    });
    const chSel = document.getElementById("typingChapterSel");
    if (chSel) {
      chSel.addEventListener("change", (e) => {
        typingState.chapter = Number(e.target.value);
        typingState.index = 0;
        typingState.typed = "";
        typingState.errFlag = false;
        updateTypingCard();
      });
    }
    const tpSel = document.getElementById("typingTopicSel");
    if (tpSel) {
      tpSel.addEventListener("change", (e) => {
        typingState.coreTopic = e.target.value;
        typingState.index = 0;
        typingState.typed = "";
        typingState.errFlag = false;
        updateTypingCard();
      });
    }
    document.getElementById("btnDictationToggle").addEventListener("click", (e) => {
      typingState.dictation = !typingState.dictation;
      e.currentTarget.textContent = typingState.dictation ? "默寫模式：開" : "默寫模式：關";
      e.currentTarget.classList.toggle("btn-amber", typingState.dictation);
      updateTypingCard();
    });
    document.getElementById("btnAutoSpeakToggle").addEventListener("click", (e) => {
      typingState.autoSpeak = !typingState.autoSpeak;
      e.currentTarget.textContent = `自動發音：${typingState.autoSpeak ? "開" : "關"}`;
      e.currentTarget.classList.toggle("btn-green", typingState.autoSpeak);
    });

    if (words.length) {
      updateTypingCard();
      const input = document.getElementById("typingInput");
      const card = document.getElementById("typingCard");

      // 僅在桌機自動聚焦；手機版不搶焦點，避免切換頁面或切字時自動彈出鍵盤遮擋上方
      if (!isTouchDevice()) {
        input.focus();
      }

      input.addEventListener("focus", () => {
        if (isTouchDevice() && card) {
          setTimeout(() => {
            window.scrollTo({ top: 0, behavior: "smooth" });
          }, 120);
        }
      });

      document.getElementById("btnHideKb").addEventListener("click", () => {
        input.blur();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      document.getElementById("btnTypeSpeak").addEventListener("click", () => {
        const list = getTypingWords();
        if (list[typingState.index]) speak(list[typingState.index].word);
      });

      document.getElementById("btnTypeBm").addEventListener("click", () => {
        const list = getTypingWords();
        if (list[typingState.index]) {
          toggleBookmark(list[typingState.index]);
          updateTypingCard();
        }
      });

      document.getElementById("btnTypePrev").addEventListener("click", () => {
        const list = getTypingWords();
        if (!list.length) return;
        typingState.index = (typingState.index - 1 + list.length) % list.length;
        typingState.typed = "";
        typingState.errFlag = false;
        updateTypingCard();
        if (typingState.autoSpeak) speak(list[typingState.index].word);
      });

      document.getElementById("btnTypeNext").addEventListener("click", () => {
        const list = getTypingWords();
        if (!list.length) return;
        typingState.index = (typingState.index + 1) % list.length;
        typingState.typed = "";
        typingState.errFlag = false;
        updateTypingCard();
        if (typingState.autoSpeak) speak(list[typingState.index].word);
      });

      document.getElementById("btnTypeHint").addEventListener("click", () => {
        const list = getTypingWords();
        const cur = list[typingState.index];
        if (!cur) return;
        if (typingState.typed.length < cur.word.length) {
          typingState.typed += cur.word[typingState.typed.length];
          typingState.errFlag = false;
          if (typingState.typed.toLowerCase() === cur.word.toLowerCase()) {
            finishTypedWord(list, cur);
          } else {
            updateTypingCard();
          }
        }
      });

      input.addEventListener("input", () => {
        const list = getTypingWords();
        const cur = list[typingState.index];
        if (!cur) return;
        const val = input.value;
        // 允許 résumé 也能用 resume 鍵入
        const normTarget = cur.word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const normVal = val.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

        if (normTarget.startsWith(normVal)) {
          typingState.sessionTotalKeys++;
          typingState.sessionCorrectKeys++;
          typingState.typed = cur.word.slice(0, val.length);
          typingState.errFlag = false;
          if (normVal.length === normTarget.length) {
            finishTypedWord(list, cur);
          } else {
            updateTypingCard();
          }
        } else {
          typingState.sessionTotalKeys++;
          typingState.errFlag = true;
          // 保留目前正確前綴，讓手機打錯字不需要一直按退格
          input.value = typingState.typed;
          updateTypingCard();
        }
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const list = getTypingWords();
          if (!list.length) return;
          typingState.index = (typingState.index + 1) % list.length;
          typingState.typed = "";
          typingState.errFlag = false;
          updateTypingCard();
          if (typingState.autoSpeak) speak(list[typingState.index].word);
        }
      });
    }
  }

  function finishTypedWord(words, cur) {
    const k = cur.word.toLowerCase();
    state.typingDone[k] = (state.typingDone[k] || 0) + 1;
    typingState.sessionCompletedWords++;
    saveState();
    typingState.index = (typingState.index + 1) % words.length;
    typingState.typed = "";
    typingState.errFlag = false;
    updateTypingCard();
    if (typingState.autoSpeak && words[typingState.index]) {
      speak(words[typingState.index].word);
    }
  }

  // =========================================================================
  // 4. 12 大必考文法總整理
  // =========================================================================
  let selectedGrammarSlug = DATA.grammar[0].slug;

  function renderGrammar() {
    const el = document.getElementById("view-grammar");
    const g = DATA.grammar.find((x) => x.slug === selectedGrammarSlug) || DATA.grammar[0];
    const isRead = !!state.grammarRead[g.slug];
    const relatedCount = DATA.part5.filter((q) => q.grammarSlug === g.slug).length;

    const stars = "★".repeat(g.importance) + "☆".repeat(5 - g.importance);

    el.innerHTML = `
      <div class="split-layout">
        <aside class="card" style="padding:14px;">
          <div style="font-weight:800;margin-bottom:10px;font-size:0.95rem;">多益必考 12 大文法目錄</div>
          <div class="sidebar-list">
            ${DATA.grammar
              .map(
                (item) => `
              <button class="sidebar-btn ${item.slug === g.slug ? "active" : ""}" data-gslug="${item.slug}">
                <span>${esc(item.title)}</span>
                <span>${state.grammarRead[item.slug] ? "✓" : ""}</span>
              </button>
            `
              )
              .join("")}
          </div>
        </aside>

        <article class="card">
          <div class="card-title">
            <span>${esc(g.title)}</span>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <span class="pill amber">出題頻率 ${stars}</span>
              <button class="btn btn-sm ${isRead ? "btn-green" : ""}" id="btnMarkGrammarRead">
                ${isRead ? "✓ 已精讀" : "標記為已精讀"}
              </button>
            </div>
          </div>

          <p style="font-size:1.02rem;margin-top:0;">${esc(g.summary)}</p>

          <div class="formula-box">
            黃金必背公式：${esc(g.coreFormula)}
          </div>

          <h3 style="margin:18px 0 8px;">句構拆解示範（台灣文法術語）</h3>
          <div class="breakdown-wrap">
            ${g.sentenceBreakdown.parts
              .map(
                (p) => `
              <div class="bd-chip bd-${esc(p.role)}">
                <span class="bd-role">${esc(p.role)}・${esc(p.label)}</span>
                <strong>${esc(p.text)}</strong>
              </div>
            `
              )
              .join("")}
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
            <span class="muted">中文翻譯：${esc(g.sentenceBreakdown.zh)}</span>
            <button class="btn btn-sm" data-speak="${esc(g.sentenceBreakdown.parts.map((p) => p.text).join(" "))}">朗讀示範句</button>
          </div>

          <h3 style="margin:18px 0 8px;">高頻考點對照表</h3>
          <div style="overflow-x:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>句型／關鍵線索</th>
                  <th>考點規則／詞類</th>
                  <th>多益解題提醒</th>
                </tr>
              </thead>
              <tbody>
                ${g.rulesTable
                  .map(
                    (r) => `
                  <tr>
                    <td><strong>${esc(r.pattern)}</strong></td>
                    <td>${esc(r.pos)}</td>
                    <td>${esc(r.tip)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>

          <h3 style="margin:18px 0 8px;">台灣考生常見陷阱</h3>
          <ul style="padding-left:20px;margin:8px 0 16px;">
            ${g.commonTraps.map((t) => `<li style="margin-bottom:6px;">${esc(t)}</li>`).join("")}
          </ul>

          <h3 style="margin:18px 0 8px;">商務實戰例句</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px;">
            ${g.quickExamples
              .map(
                (ex) => `
              <div class="fc-example">
                <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;">
                  <strong>${esc(ex.en)}</strong>
                  <button class="btn btn-sm" data-speak="${esc(ex.en)}">發音</button>
                </div>
                <div class="muted" style="font-size:0.88rem;margin-top:3px;">${esc(ex.zh)}</div>
              </div>
            `
              )
              .join("")}
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;border-top:1px solid var(--border);padding-top:14px;">
            <button class="btn btn-primary" id="btnGrammarDrill">
              馬上練習本單元 Part 5 精選題（${relatedCount} 題）→
            </button>
          </div>
        </article>
      </div>
    `;

    el.querySelectorAll("[data-gslug]").forEach((b) =>
      b.addEventListener("click", () => {
        selectedGrammarSlug = b.dataset.gslug;
        renderGrammar();
      })
    );
    el.querySelectorAll("[data-speak]").forEach((b) =>
      b.addEventListener("click", () => speak(b.dataset.speak))
    );
    document.getElementById("btnMarkGrammarRead").addEventListener("click", () => {
      if (state.grammarRead[g.slug]) delete state.grammarRead[g.slug];
      else state.grammarRead[g.slug] = true;
      saveState();
      renderGrammar();
    });
    document.getElementById("btnGrammarDrill").addEventListener("click", () => {
      state.grammarRead[g.slug] = true;
      saveState();
      practiceState.mode = "part5";
      practiceState.grammarFilter = g.slug;
      switchView("practice");
    });
  }

  // =========================================================================
  // 5. 閱讀實戰刷題（Part 5 / Part 6 / Part 7 / 錯題本）
  // =========================================================================
  const practiceState = {
    mode: "part5", // "part5" | "part6" | "part7" | "wrong"
    grammarFilter: "ALL",
    passageIndex: 0,
    answers: {}, // 當前練習頁已選答案 { qId: optIdx }
  };

  function recordPracticeAnswer(q, optIdx) {
    practiceState.answers[q.id] = optIdx;
    const isRight = optIdx === q.answer;
    state.quizHistory[q.id] = {
      selected: optIdx,
      correct: isRight,
      grammarSlug: q.grammarSlug || "",
      grammarCategory: q.grammarCategory || `Part ${q.part || 7}`,
      ts: Date.now(),
    };
    if (!isRight) {
      state.wrongBook[q.id] = true;
    } else {
      delete state.wrongBook[q.id];
    }
    saveState();
  }

  function renderQuestionCard(q, indexLabel) {
    const picked = practiceState.answers[q.id];
    const hasAnswered = picked !== undefined;
    const stem = q.sentence || q.question || `請選出最適合填入空格 [${q.blank}] 的選項：`;

    return `
      <div class="q-block" data-qid="${esc(q.id)}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <span class="pill blue">${esc(indexLabel)}・${esc(q.id)}</span>
          ${q.grammarCategory ? `<span class="pill purple">${esc(q.grammarCategory)}</span>` : ""}
        </div>
        <div class="q-stem">${esc(stem)}</div>
        <div class="options-list">
          ${q.options
            .map((opt, idx) => {
              let cls = "";
              if (hasAnswered) {
                if (idx === q.answer) cls = "correct";
                else if (idx === picked) cls = "wrong";
              }
              return `
              <button class="opt-btn ${cls}" data-ans-qid="${esc(q.id)}" data-opt="${idx}" ${hasAnswered ? "disabled" : ""}>
                <span class="opt-letter">(${LETTERS[idx]})</span>
                <span>${esc(opt)}</span>
              </button>
            `;
            })
            .join("")}
        </div>
        ${
          hasAnswered
            ? `<div class="explanation-box">
                <div style="font-weight:800;margin-bottom:6px;color:${picked === q.answer ? "var(--green)" : "var(--red)"};">
                  ${picked === q.answer ? "✓ 答對了！" : `✗ 答錯了，正確答案為 (${LETTERS[q.answer]}) ${esc(q.options[q.answer])}`}
                </div>
                ${q.translation ? `<div style="margin-bottom:6px;"><strong>整句翻譯：</strong>${esc(q.translation)}</div>` : ""}
                <div><strong>詳解：</strong>${esc(q.explanation)}</div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  function formatBlankBody(text) {
    return esc(text).replace(/\[(\d+)\]/g, '<span class="blank-badge">[$1]</span>');
  }

  function renderPractice() {
    const el = document.getElementById("view-practice");
    const wrongIds = Object.keys(state.wrongBook).filter((id) => QUESTION_MAP[id]);

    let contentHtml = "";

    if (practiceState.mode === "part5") {
      const qs =
        practiceState.grammarFilter === "ALL"
          ? DATA.part5
          : DATA.part5.filter((q) => q.grammarSlug === practiceState.grammarFilter);

      const gramOpts = DATA.grammar
        .map(
          (g) =>
            `<option value="${g.slug}" ${practiceState.grammarFilter === g.slug ? "selected" : ""}>${esc(g.title)}</option>`
        )
        .join("");

      contentHtml = `
        <div class="toolbar">
          <select id="p5GrammarFilter" class="select-input">
            <option value="ALL" ${practiceState.grammarFilter === "ALL" ? "selected" : ""}>全部 Part 5 題庫（60 題）</option>
            ${gramOpts}
          </select>
          <button class="btn btn-sm" id="btnClearCurrentAns">清除本頁作答重練</button>
        </div>
        ${qs.map((q, i) => renderQuestionCard({ ...q, part: 5 }, `Part 5 #${i + 1}`)).join("")}
      `;
    } else if (practiceState.mode === "part6") {
      if (practiceState.passageIndex >= DATA.part6.length) practiceState.passageIndex = 0;
      const p = DATA.part6[practiceState.passageIndex];
      contentHtml = `
        <div class="toolbar">
          ${DATA.part6
            .map(
              (item, idx) =>
                `<button class="btn btn-sm ${idx === practiceState.passageIndex ? "btn-primary" : ""}" data-pidx="${idx}">第 ${idx + 1} 篇：${esc(item.title)}</button>`
            )
            .join("")}
          <button class="btn btn-sm" id="btnClearCurrentAns">重練本篇</button>
        </div>
        <div class="passage-box">
          <div style="margin-bottom:8px;"><span class="pill amber">${esc(p.docType)}</span> <strong>${esc(p.title)}</strong></div>
          <div class="passage-header">${esc(p.header)}</div>
          <div class="passage-body">${formatBlankBody(p.body)}</div>
        </div>
        ${p.questions.map((q) => renderQuestionCard({ ...q, part: 6 }, `空格 [${q.blank}]`)).join("")}
      `;
    } else if (practiceState.mode === "part7") {
      if (practiceState.passageIndex >= DATA.part7.length) practiceState.passageIndex = 0;
      const p = DATA.part7[practiceState.passageIndex];
      contentHtml = `
        <div class="toolbar">
          ${DATA.part7
            .map(
              (item, idx) =>
                `<button class="btn btn-sm ${idx === practiceState.passageIndex ? "btn-primary" : ""}" data-pidx="${idx}">第 ${idx + 1} 組${item.isDouble ? "（雙篇）" : ""}：${esc(item.title)}</button>`
            )
            .join("")}
          <button class="btn btn-sm" id="btnClearCurrentAns">重練本組</button>
        </div>
        ${p.documents
          .map(
            (doc) => `
          <div class="passage-box">
            <div style="margin-bottom:8px;"><span class="pill blue">${esc(doc.label)}</span></div>
            <div class="passage-header">${esc(doc.header)}</div>
            <div class="passage-body">${esc(doc.content)}</div>
          </div>
        `
          )
          .join("")}
        ${p.questions.map((q, i) => renderQuestionCard({ ...q, part: 7 }, `閱讀題 #${i + 1}`)).join("")}
      `;
    } else {
      // 錯題本模式
      if (!wrongIds.length) {
        contentHtml = `<div class="card empty-state">目前錯題本是空的！代表你答對了所有做過的題目，或尚未開始刷題。</div>`;
      } else {
        contentHtml = `
          <div class="toolbar">
            <span class="muted">只要在這裡答對，系統就會自動把該題從錯題本移除！</span>
            <button class="btn btn-sm" id="btnClearCurrentAns">重刷錯題本</button>
          </div>
          ${wrongIds
            .map((id, i) => {
              const q = QUESTION_MAP[id];
              let extra = "";
              if (q.part === 6 && q.passage) {
                extra = `<div class="passage-box" style="margin-bottom:8px;"><div class="passage-body">${formatBlankBody(q.passage.body)}</div></div>`;
              } else if (q.part === 7 && q.passage) {
                extra = q.passage.documents
                  .map(
                    (d) =>
                      `<div class="passage-box" style="margin-bottom:8px;"><strong>${esc(d.label)}</strong><div class="passage-body">${esc(d.content)}</div></div>`
                  )
                  .join("");
              }
              return extra + renderQuestionCard(q, `錯題 #${i + 1} (Part ${q.part})`);
            })
            .join("")}
        `;
      }
    }

    el.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span>新制多益閱讀實戰刷題（共 100 題・即時繁中詳解）</span>
        </div>
        <div class="toolbar" style="margin-bottom:0;">
          <button class="btn ${practiceState.mode === "part5" ? "btn-primary" : ""}" data-pmode="part5">Part 5 句子填空 (60)</button>
          <button class="btn ${practiceState.mode === "part6" ? "btn-primary" : ""}" data-pmode="part6">Part 6 段落填空 (20)</button>
          <button class="btn ${practiceState.mode === "part7" ? "btn-primary" : ""}" data-pmode="part7">Part 7 單／雙篇閱讀 (20)</button>
          <button class="btn ${practiceState.mode === "wrong" ? "btn-red" : ""}" data-pmode="wrong">我的錯題本 (${wrongIds.length})</button>
        </div>
      </div>
      ${contentHtml}
    `;

    el.querySelectorAll("[data-pmode]").forEach((b) =>
      b.addEventListener("click", () => {
        practiceState.mode = b.dataset.pmode;
        practiceState.passageIndex = 0;
        renderPractice();
      })
    );
    el.querySelectorAll("[data-pidx]").forEach((b) =>
      b.addEventListener("click", () => {
        practiceState.passageIndex = Number(b.dataset.pidx);
        renderPractice();
      })
    );
    const filterSel = document.getElementById("p5GrammarFilter");
    if (filterSel) {
      filterSel.addEventListener("change", () => {
        practiceState.grammarFilter = filterSel.value;
        renderPractice();
      });
    }
    const clearBtn = document.getElementById("btnClearCurrentAns");
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        practiceState.answers = {};
        renderPractice();
      });
    }

    el.querySelectorAll("[data-ans-qid]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const qid = btn.dataset.ansQid;
        const opt = Number(btn.dataset.opt);
        const q = QUESTION_MAP[qid];
        if (!q) return;
        recordPracticeAnswer(q, opt);
        renderPractice();
      })
    );
  }

  // =========================================================================
  // 6. 計時模擬測驗（30 分鐘精簡 40 題 / 75 分鐘全真 100 題）
  // =========================================================================
  const mockState = {
    status: "idle", // "idle" | "running" | "finished"
    modeName: "",
    questions: [],
    answers: {},
    totalSeconds: 0,
    remainSeconds: 0,
    timerId: null,
  };

  function startMockExam(type) {
    stopMockTimer();
    let qs = [];
    if (type === "quick40") {
      mockState.modeName = "30 分鐘精簡模考（40 題）";
      mockState.totalSeconds = 30 * 60;
      // 抽 Part 5 前 20 題 + Part 6 前 2 篇 (8題) + Part 7 前 3 組 (12題) = 40 題
      qs = [
        ...DATA.part5.slice(0, 20).map((q) => ({ ...q, part: 5 })),
        ...DATA.part6.slice(0, 2).flatMap((p) => p.questions.map((q) => ({ ...q, part: 6, passage: p }))),
        ...DATA.part7.slice(0, 3).flatMap((p) => p.questions.map((q) => ({ ...q, part: 7, passage: p }))),
      ];
    } else {
      mockState.modeName = "75 分鐘全真閱讀模考（100 題）";
      mockState.totalSeconds = 75 * 60;
      qs = ALL_QUESTIONS;
    }

    mockState.questions = qs;
    mockState.answers = {};
    mockState.remainSeconds = mockState.totalSeconds;
    mockState.status = "running";

    mockState.timerId = setInterval(() => {
      mockState.remainSeconds--;
      const timerEl = document.getElementById("mockTimerDisplay");
      if (timerEl) {
        timerEl.textContent = formatTime(mockState.remainSeconds);
        timerEl.classList.toggle("urgent", mockState.remainSeconds <= 300);
      }
      if (mockState.remainSeconds <= 0) {
        submitMockExam(true);
      }
    }, 1000);

    renderMock();
  }

  function stopMockTimer() {
    if (mockState.timerId) {
      clearInterval(mockState.timerId);
      mockState.timerId = null;
    }
  }

  function formatTime(sec) {
    const s = Math.max(0, sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function submitMockExam(autoTimeout) {
    stopMockTimer();
    mockState.status = "finished";

    let right = 0;
    mockState.questions.forEach((q) => {
      const sel = mockState.answers[q.id];
      const ok = sel === q.answer;
      if (ok) right++;
      if (sel !== undefined) {
        state.quizHistory[q.id] = {
          selected: sel,
          correct: ok,
          grammarSlug: q.grammarSlug || "",
          grammarCategory: q.grammarCategory || `Part ${q.part}`,
          ts: Date.now(),
        };
      }
      if (!ok) state.wrongBook[q.id] = true;
    });

    const est = estimateToeicReadingScore(right, mockState.questions.length);
    state.mockRecords.push({
      date: new Date().toLocaleDateString("zh-TW"),
      mode: mockState.modeName,
      correct: right,
      total: mockState.questions.length,
      estScore: est,
      elapsedSec: mockState.totalSeconds - mockState.remainSeconds,
    });
    saveState();

    if (autoTimeout) alert("測驗時間到！系統已自動交卷並為您批改。");
    renderMock();
  }

  function renderMock() {
    const el = document.getElementById("view-mock");

    if (mockState.status === "idle") {
      el.innerHTML = `
        <div class="card">
          <div class="card-title"><span>新制多益閱讀計時模擬測驗</span></div>
          <p class="muted">
            正式多益閱讀測驗共 100 題、限時 75 分鐘（Part 5 句子填空、Part 6 段落填空、Part 7 單／雙篇閱讀）。請選擇下方測驗規格，系統將嚴格倒數計時，交卷後自動估算你的閱讀量尺分數（5–495 分）並將錯題收錄至錯題本。
          </p>
          <div class="stats-grid" style="margin-top:18px;">
            <div class="stat-card">
              <div class="pill blue" style="margin-bottom:8px;">平日快速驗收</div>
              <div style="font-size:1.2rem;font-weight:800;margin-bottom:6px;">30 分鐘精簡模考（40 題）</div>
              <p class="muted" style="font-size:0.88rem;">包含 Part 5（20 題）＋Part 6（2 篇 8 題）＋Part 7（3 篇 12 題），適合下班或課餘快速檢視實力。</p>
              <button class="btn btn-accent" id="btnStartQuick40" style="width:100%;">開始 30 分鐘模考</button>
            </div>
            <div class="stat-card">
              <div class="pill amber" style="margin-bottom:8px;">考前全真模擬</div>
              <div style="font-size:1.2rem;font-weight:800;margin-bottom:6px;">75 分鐘全真閱讀模考（100 題）</div>
              <p class="muted" style="font-size:0.88rem;">完整 100 題閱讀題量，涵蓋單篇與雙篇商務文件，徹底訓練時間分配與長篇閱讀耐力。</p>
              <button class="btn btn-primary" id="btnStartFull100" style="width:100%;">開始 75 分鐘全真模考</button>
            </div>
          </div>
        </div>
      `;
      document.getElementById("btnStartQuick40").addEventListener("click", () => startMockExam("quick40"));
      document.getElementById("btnStartFull100").addEventListener("click", () => startMockExam("full100"));
      return;
    }

    const total = mockState.questions.length;
    const answeredCount = Object.keys(mockState.answers).length;
    const isFinished = mockState.status === "finished";

    let summaryHtml = "";
    if (isFinished) {
      let right = 0;
      const partStats = { 5: { r: 0, t: 0 }, 6: { r: 0, t: 0 }, 7: { r: 0, t: 0 } };
      mockState.questions.forEach((q) => {
        partStats[q.part].t++;
        if (mockState.answers[q.id] === q.answer) {
          right++;
          partStats[q.part].r++;
        }
      });
      const est = estimateToeicReadingScore(right, total);
      const elapsed = mockState.totalSeconds - mockState.remainSeconds;
      summaryHtml = `
        <div class="card" style="border:2px solid var(--primary);">
          <div class="card-title">
            <span>模擬考成績單：${esc(mockState.modeName)}</span>
            <button class="btn btn-primary" id="btnMockBackIdle">返回模考選單</button>
          </div>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">預估多益閱讀分數</div>
              <div class="stat-value">${est} <span style="font-size:1rem;">/ 495</span></div>
              <div class="stat-sub">對照實際總分約為閱讀×2 區間參考</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">總答對題數</div>
              <div class="stat-value">${right} / ${total}</div>
              <div class="stat-sub">總正確率 ${Math.round((right / total) * 100)}%・作答用時 ${formatTime(elapsed)}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">各 Part 表現</div>
              <div style="font-size:0.9rem;margin-top:6px;">
                <div>Part 5：<strong>${partStats[5].r}/${partStats[5].t}</strong></div>
                <div>Part 6：<strong>${partStats[6].r}/${partStats[6].t}</strong></div>
                <div>Part 7：<strong>${partStats[7].r}/${partStats[7].t}</strong></div>
              </div>
            </div>
          </div>
          <p class="muted" style="margin:0;">所有未答對的題目已自動加入「我的錯題本」，往下捲動即可逐題檢討繁中解析。</p>
        </div>
      `;
    }

    // 渲染所有題目（Part 6/7 自動在該組第一題前顯示文章框）
    let lastPassageId = null;
    const questionsHtml = mockState.questions
      .map((q, idx) => {
        let passageHtml = "";
        if ((q.part === 6 || q.part === 7) && q.passage && q.passage.passageId !== lastPassageId) {
          lastPassageId = q.passage.passageId;
          if (q.part === 6) {
            passageHtml = `
              <div class="passage-box" style="margin-top:20px;">
                <div style="margin-bottom:8px;"><span class="pill amber">Part 6・${esc(q.passage.docType)}</span> <strong>${esc(q.passage.title)}</strong></div>
                <div class="passage-header">${esc(q.passage.header)}</div>
                <div class="passage-body">${formatBlankBody(q.passage.body)}</div>
              </div>
            `;
          } else {
            passageHtml = q.passage.documents
              .map(
                (doc) => `
              <div class="passage-box" style="margin-top:16px;">
                <div style="margin-bottom:8px;"><span class="pill blue">Part 7・${esc(doc.label)}</span></div>
                <div class="passage-header">${esc(doc.header)}</div>
                <div class="passage-body">${esc(doc.content)}</div>
              </div>
            `
              )
              .join("");
          }
        }

        const picked = mockState.answers[q.id];
        const stem = q.sentence || q.question || `請選出最適合填入空格 [${q.blank}] 的選項：`;

        return `
          ${passageHtml}
          <div class="q-block" id="mock-q-${idx}">
            <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
              <span class="pill blue">第 ${idx + 1} 題・Part ${q.part}</span>
              ${isFinished && q.grammarCategory ? `<span class="pill purple">${esc(q.grammarCategory)}</span>` : ""}
            </div>
            <div class="q-stem">${esc(stem)}</div>
            <div class="options-list">
              ${q.options
                .map((opt, oidx) => {
                  let cls = "";
                  if (!isFinished && picked === oidx) cls = "selected";
                  if (isFinished) {
                    if (oidx === q.answer) cls = "correct";
                    else if (picked === oidx) cls = "wrong";
                  }
                  return `
                  <button class="opt-btn ${cls}" data-mqid="${esc(q.id)}" data-mopt="${oidx}" ${isFinished ? "disabled" : ""}>
                    <span class="opt-letter">(${LETTERS[oidx]})</span>
                    <span>${esc(opt)}</span>
                  </button>
                `;
                })
                .join("")}
            </div>
            ${
              isFinished
                ? `<div class="explanation-box">
                    <div style="font-weight:800;margin-bottom:4px;color:${picked === q.answer ? "var(--green)" : "var(--red)"};">
                      ${picked === q.answer ? "✓ 答對" : `✗ ${picked === undefined ? "未作答" : "答錯"}｜正確答案：(${LETTERS[q.answer]}) ${esc(q.options[q.answer])}`}
                    </div>
                    ${q.translation ? `<div style="margin-bottom:4px;"><strong>翻譯：</strong>${esc(q.translation)}</div>` : ""}
                    <div><strong>解析：</strong>${esc(q.explanation)}</div>
                  </div>`
                : ""
            }
          </div>
        `;
      })
      .join("");

    el.innerHTML = `
      ${
        !isFinished
          ? `<div class="exam-header-sticky">
              <div>
                <strong>${esc(mockState.modeName)}</strong>
                <div class="muted" style="font-size:0.84rem;">已作答：${answeredCount} / ${total} 題</div>
              </div>
              <div class="timer-display ${mockState.remainSeconds <= 300 ? "urgent" : ""}" id="mockTimerDisplay">${formatTime(mockState.remainSeconds)}</div>
              <div style="display:flex;gap:6px;flex-wrap:wrap;">
                <button class="btn btn-sm mock-nav-toggle" id="btnToggleMockGrid" type="button">題號卡</button>
                <button class="btn btn-sm" id="btnCancelMock">放棄</button>
                <button class="btn btn-primary btn-sm" id="btnSubmitMock">交卷批改</button>
              </div>
              <div class="q-nav-grid collapsed-mobile" id="mockNavGrid" style="width:100%;">
                ${mockState.questions
                  .map(
                    (q, i) =>
                      `<button class="q-dot ${mockState.answers[q.id] !== undefined ? "answered" : ""}" data-scroll-q="${i}">${i + 1}</button>`
                  )
                  .join("")}
              </div>
            </div>`
          : summaryHtml
      }
      ${questionsHtml}
    `;

    if (!isFinished) {
      const gridToggle = document.getElementById("btnToggleMockGrid");
      const navGrid = document.getElementById("mockNavGrid");
      if (gridToggle && navGrid) {
        gridToggle.addEventListener("click", () => {
          navGrid.classList.toggle("collapsed-mobile");
        });
      }
      el.querySelectorAll("[data-mqid]").forEach((b) =>
        b.addEventListener("click", () => {
          mockState.answers[b.dataset.mqid] = Number(b.dataset.mopt);
          // 僅更新按鈕樣式與計數，避免整頁重繪捲動跳動
          const parent = b.closest(".q-block");
          parent.querySelectorAll(".opt-btn").forEach((ob) => ob.classList.remove("selected"));
          b.classList.add("selected");
          const qIdx = Number(parent.id.replace("mock-q-", ""));
          const dot = el.querySelector(`[data-scroll-q="${qIdx}"]`);
          if (dot) dot.classList.add("answered");
          const cntEl = el.querySelector(".exam-header-sticky .muted");
          if (cntEl) cntEl.textContent = `已作答：${Object.keys(mockState.answers).length} / ${total} 題`;
        })
      );
      el.querySelectorAll("[data-scroll-q]").forEach((dot) =>
        dot.addEventListener("click", () => {
          if (navGrid) navGrid.classList.add("collapsed-mobile");
          const target = document.getElementById(`mock-q-${dot.dataset.scrollQ}`);
          if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
        })
      );
      document.getElementById("btnCancelMock").addEventListener("click", () => {
        if (confirm("確定要放棄本次模擬測驗？")) {
          stopMockTimer();
          mockState.status = "idle";
          renderMock();
        }
      });
      document.getElementById("btnSubmitMock").addEventListener("click", () => {
        const unans = total - Object.keys(mockState.answers).length;
        const msg = unans > 0 ? `還有 ${unans} 題尚未作答，確定要交卷嗎？` : "全部題目皆已作答，確定交卷批改？";
        if (confirm(msg)) submitMockExam(false);
      });
    } else {
      const backBtn = document.getElementById("btnMockBackIdle");
      if (backBtn) {
        backBtn.addEventListener("click", () => {
          mockState.status = "idle";
          renderMock();
        });
      }
    }
  }

  // ===== PWA 離線快取註冊與手機安裝引導 =====
  function initPWA() {
    const badge = document.getElementById("offlineBadge");
    const installBtn = document.getElementById("pwaInstallBtn");
    const iosBanner = document.getElementById("iosInstallBanner");
    const closeIos = document.getElementById("closeIosBanner");

    function updateNetworkBadge(swReady) {
      if (!badge) return;
      if (!navigator.onLine) {
        badge.textContent = "離線模式中";
        badge.classList.add("is-offline");
      } else if (swReady) {
        badge.textContent = "✓ 可離線";
        badge.classList.remove("is-offline");
      } else {
        badge.textContent = "";
      }
    }

    let swRegistered = false;
    const isHttp = location.protocol === "http:" || location.protocol === "https:";
    if (isHttp && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("./sw.js")
          .then(() => {
            swRegistered = true;
            updateNetworkBadge(true);
          })
          .catch((err) => console.warn("Service Worker 註冊失敗:", err));
      });
    }

    window.addEventListener("online", () => updateNetworkBadge(swRegistered));
    window.addEventListener("offline", () => updateNetworkBadge(swRegistered));
    updateNetworkBadge(false);

    // Android / Chrome / Edge PWA 原生安裝提示
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (installBtn) installBtn.style.display = "inline-flex";
    });

    if (installBtn) {
      installBtn.addEventListener("click", async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        installBtn.style.display = "none";
      });
    }

    window.addEventListener("appinstalled", () => {
      if (installBtn) installBtn.style.display = "none";
    });

    // iOS Safari 偵測提示（僅在非主畫面獨立模式且為 http/https 時顯示）
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    const iosDismissed = localStorage.getItem("toeic_tw_ios_hint_closed") === "1";

    if (isHttp && isIos && !isStandalone && !iosDismissed && iosBanner) {
      iosBanner.style.display = "block";
    }
    if (closeIos && iosBanner) {
      closeIos.addEventListener("click", () => {
        iosBanner.style.display = "none";
        localStorage.setItem("toeic_tw_ios_hint_closed", "1");
      });
    }
  }

  // ===== 全域鍵盤快捷鍵（記憶卡操作）=====
  document.addEventListener("keydown", (e) => {
    if (activeView !== "core600" || coreState.viewMode !== "card") return;
    if (document.activeElement && ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
    const items = getFilteredCore600();
    if (!items.length) return;
    if (e.code === "Space") {
      e.preventDefault();
      coreState.flipped = !coreState.flipped;
      renderCore600();
    } else if (e.key === "ArrowRight") {
      coreState.cardIndex = (coreState.cardIndex + 1) % items.length;
      coreState.flipped = false;
      renderCore600();
    } else if (e.key === "ArrowLeft") {
      coreState.cardIndex = (coreState.cardIndex - 1 + items.length) % items.length;
      coreState.flipped = false;
      renderCore600();
    }
  });

  // ===== 手機虛擬鍵盤狀態偵測（開啟鍵盤時自動隱藏底部列與收合頂部設定卡，防止上方單字被遮住）=====
  function initMobileKeyboardGuard() {
    document.addEventListener("focusin", (e) => {
      if (!isTouchDevice()) return;
      const tag = e.target && e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        document.body.classList.add("keyboard-open");
      }
    });
    document.addEventListener("focusout", () => {
      setTimeout(() => {
        const active = document.activeElement;
        const tag = active && active.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          document.body.classList.remove("keyboard-open");
        }
      }, 100);
    });
  }

  // ===== 啟動初始化 =====
  initHeaderControls();
  initMobileKeyboardGuard();
  initPWA();
  renderDashboard();
})();
