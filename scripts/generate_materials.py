import json
import os
import random
import re
from collections import Counter, defaultdict

BASE_DIR = r"d:\AI tools\英文學習"
DATA_DIR = os.path.join(BASE_DIR, "data")
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
DOCS_DIR = os.path.join(BASE_DIR, "教材講義")
ANKI_DIR = os.path.join(BASE_DIR, "Anki牌組")

os.makedirs(ASSETS_DIR, exist_ok=True)
os.makedirs(DOCS_DIR, exist_ok=True)
os.makedirs(ANKI_DIR, exist_ok=True)

LETTERS = ["A", "B", "C", "D"]


def remap_explanation_letters(text: str, old_to_new: dict) -> str:
    """安全將解析中的 (A)(B)(C)(D) 依據新舊索引對應同步替換，避免二次替換錯亂"""
    if not text:
        return text

    def repl(m):
        ch = m.group(1)
        old_idx = LETTERS.index(ch)
        new_idx = old_to_new[old_idx]
        return f"({LETTERS[new_idx]})"

    return re.sub(r"\(([ABCD])\)", repl, text)


def rebalance_question_list(questions, seed: int):
    """使每題的 A/B/C/D 正解完全均勻分布，並同步更新解析中的選項代號"""
    rng = random.Random(seed)
    n = len(questions)
    targets = ([0, 1, 2, 3] * ((n // 4) + 1))[:n]
    rng.shuffle(targets)

    for q, new_ans in zip(questions, targets):
        old_ans = q["answer"]
        old_opts = q["options"]
        other_old_indices = [i for i in range(4) if i != old_ans]
        rng.shuffle(other_old_indices)

        new_to_old = {}
        new_to_old[new_ans] = old_ans
        other_new_slots = [i for i in range(4) if i != new_ans]
        for slot, oidx in zip(other_new_slots, other_old_indices):
            new_to_old[slot] = oidx

        old_to_new = {v: k for k, v in new_to_old.items()}
        q["options"] = [old_opts[new_to_old[i]] for i in range(4)]
        q["answer"] = new_ans
        q["explanation"] = remap_explanation_letters(q["explanation"], old_to_new)


def main():
    with open(os.path.join(DATA_DIR, "vocab_core600.json"), encoding="utf-8") as f:
        core600 = json.load(f)
    with open(os.path.join(DATA_DIR, "vocab_toeic1694.json"), encoding="utf-8") as f:
        toeic1656 = json.load(f)
    with open(os.path.join(DATA_DIR, "grammar.json"), encoding="utf-8") as f:
        grammar = json.load(f)
    with open(os.path.join(DATA_DIR, "questions_part5.json"), encoding="utf-8") as f:
        part5 = json.load(f)
    with open(os.path.join(DATA_DIR, "questions_part67.json"), encoding="utf-8") as f:
        p67 = json.load(f)

    part6 = p67["part6"]
    part7 = p67["part7"]

    # 均勻化三部分的答案分布（A/B/C/D 各占 25%）
    rebalance_question_list(part5, seed=202605)
    p6_flat = [q for s in part6 for q in s["questions"]]
    rebalance_question_list(p6_flat, seed=202606)
    p7_flat = [q for s in part7 for q in s["questions"]]
    rebalance_question_list(p7_flat, seed=202607)

    # 儲存平衡後版本
    with open(os.path.join(DATA_DIR, "questions_part5.json"), "w", encoding="utf-8") as f:
        json.dump(part5, f, ensure_ascii=False, indent=2)
    with open(os.path.join(DATA_DIR, "questions_part67.json"), "w", encoding="utf-8") as f:
        json.dump({"part6": part6, "part7": part7}, f, ensure_ascii=False, indent=2)

    p5_ans = Counter(q["answer"] for q in part5)
    p6_ans = Counter(q["answer"] for q in p6_flat)
    p7_ans = Counter(q["answer"] for q in p7_flat)
    print("Balanced Answer distributions:")
    print("  Part 5 (60):", dict(sorted(p5_ans.items())))
    print("  Part 6 (20):", dict(sorted(p6_ans.items())))
    print("  Part 7 (20):", dict(sorted(p7_ans.items())))

    # 抽驗解析與答案一致性
    for q in part5[:3] + p7_flat[:3]:
        print(f"  Check {q['id']}: ans=({LETTERS[q['answer']]}) {q['options'][q['answer']]} | exp={q['explanation'][:70]}")

    topics = []
    by_topic = defaultdict(list)
    for item in core600:
        by_topic[(item["topic_zh"], item["topic_en"])].append(item)
    for (tzh, ten), items in sorted(by_topic.items(), key=lambda kv: kv[0][1]):
        topics.append({"zh": tzh, "en": ten, "count": len(items)})

    bundle = {
        "meta": {
            "title": "台灣考生專屬・新制多益（TOEIC）全方位互動教材",
            "version": "1.0.0",
            "builtAt": "2026-11-24",
            "counts": {
                "core600": len(core600),
                "topics": len(topics),
                "toeic1656": len(toeic1656),
                "chapters": toeic1656[-1]["chapter"],
                "grammar": len(grammar),
                "part5": len(part5),
                "part6": len(p6_flat),
                "part7": len(p7_flat),
            },
        },
        "topics": topics,
        "core600": core600,
        "toeic1656": toeic1656,
        "grammar": grammar,
        "part5": part5,
        "part6": part6,
        "part7": part7,
    }

    with open(os.path.join(ASSETS_DIR, "toeic_bundle.js"), "w", encoding="utf-8") as f:
        f.write("// 自動生成之多益整合教材資料檔（繁體中文・台灣專有名詞版）\n")
        f.write("window.TOEIC_DATA = ")
        json.dump(bundle, f, ensure_ascii=False)
        f.write(";\n")

    with open(os.path.join(ANKI_DIR, "TOEIC_600核心主題單字_台灣繁中.tsv"), "w", encoding="utf-8-sig") as f:
        f.write("#separator:tab\n#html:false\n#tags column:7\n")
        for x in core600:
            tag = f"TOEIC_Core600::{x['topic_zh'].replace(' ', '_')}"
            cols = [
                x["word"],
                x["pos"],
                x["ipa"],
                x["zh"],
                x["explain_en"],
                x["example_en"],
                tag,
            ]
            f.write("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cols) + "\n")

    with open(os.path.join(ANKI_DIR, "TOEIC_1656高頻字彙_台灣繁中.tsv"), "w", encoding="utf-8-sig") as f:
        f.write("#separator:tab\n#html:false\n#tags column:5\n")
        for x in toeic1656:
            tag = f"TOEIC_1656::Ch{x['chapter']:02d}"
            cols = [
                x["word"],
                f"/{x['usphone']}/" if x["usphone"] else "",
                f"/{x['ukphone']}/" if x["ukphone"] else "",
                x["summary_zh"],
                tag,
            ]
            f.write("\t".join(c.replace("\t", " ").replace("\n", " ") for c in cols) + "\n")

    write_markdown_docs(bundle, by_topic)
    print("All bundle, Anki TSV, and Markdown files updated successfully!")


def write_markdown_docs(bundle, by_topic):
    c = bundle["meta"]["counts"]

    guide = f"""# 台灣考生專屬・新制多益（TOEIC）全方位學習指南

歡迎使用本套專為台灣考生整理的離線多益（TOEIC）教材！本教材整合了 GitHub 開源多益詞庫、50 大職場主題單字集，並依台灣英語教學慣用的文法專有名詞與商務用語，全新編寫 12 大必考文法講義與 100 題新制多益閱讀實戰題庫。

---

## 一、本資料夾內容一覽

| 檔案／資料夾 | 內容說明 | 建議使用方式 |
| --- | --- | --- |
| `index.html` | **互動式多益學習網頁系統**（雙擊直接離線開啟） | 每日刷單字卡、鍵盤打字背單字、讀文法、計時模考 |
| `教材講義/01_多益600核心主題單字表.md` | {c['topics']} 大商務主題 × {c['core600']} 個必考核心單字（含音標、台灣繁中詞義、職場例句） | 依職場情境單元精讀，打穩多益 600–750 核心基礎 |
| `教材講義/02_多益1656高頻進階字彙表.md` | {c['toeic1656']} 個多益高頻商務字彙（分 {c['chapters']} 章，每章 20 字） | 衝刺 750–900+ 金色證書，搭配網頁打字模式記憶 |
| `教材講義/03_多益必考12大文法總整理.md` | 12 大高頻考點、黃金公式、S/V/O 句構拆解與陷阱解析 | 專攻 Part 5（句子填空）與 Part 6（段落填空） |
| `教材講義/04_多益閱讀實戰100題與詳解.md` | Part 5（{c['part5']} 題）＋Part 6（{c['part6']} 題）＋Part 7（{c['part7']} 題）完整題本與繁中詳解 | 適合列印手寫或搭配網頁 75 分鐘計時模擬考 |
| `Anki牌組/*.tsv` | 可直接匯入 Anki／Quizlet 的繁體中文單字記憶卡檔 | 用手機利用通勤碎片時間搭配間隔重複（SRS）複習 |

---

## 二、建議 30 天高效衝刺節奏

### 第 1–10 天：建立商務詞彙底氣 + 鎖定高頻文法
* **每日單字**：在 `index.html` 的「600 核心主題單字」完成 **5 個職場主題（約 60 字）**，聽美音／英音／澳音並標記不熟的字進入生字本。
* **每日文法**：每天精讀 **1–2 篇文法專題**（先從出題率 5 顆星的「詞性判別、動詞時態、主詞動詞一致、連接詞與轉折詞」開始），讀完立刻寫該單元對應的 5 題 Part 5。

### 第 11–20 天：打字強化拼寫 + 段落／閱讀測驗實戰
* **每日單字**：開啟「鍵盤打字背單字」，每天練 **3–4 章（60–80 字）** 1,656 高頻詞庫，並開啟「默寫模式」複習生字本。
* **每日刷題**：練習 Part 6 段落填空（特別留意新制「句子插入題」的上下句邏輯）與 Part 7 單篇／雙篇閱讀（練習先看題幹關鍵字再回文章定位）。

### 第 21–30 天：計時模擬考 + 錯題本總檢討
* **計時訓練**：使用網頁的「計時模擬測驗模式」，訓練 **75 分鐘寫完閱讀 100 題**的節奏（建議分配：Part 5 每題 25 秒內、Part 6 每篇 2 分鐘、Part 7 保留至少 50 分鐘）。
* **弱點修補**：檢視儀表板的「各文法弱點分析」，針對正確率低於 70% 的文法單元重讀講義並清空錯題本。
* **聽力補強建議**：因多益官方四國口音（美、加、英、澳）聽力全真題庫受版權保護，建議考前兩週額外搭配一本正版實體題庫（如國際學村《新制多益聽力題庫解析》或 ETS 官方全真試題指南）練習完整 45 分鐘聽力 Part 1–4。

---

## 三、開源資料來源與授權說明

本教材嚴格遵循開源授權規範，所有資料來源清楚標示如下：
1. **高頻字彙庫（1,656 字）**：改編自開源專案 [RealKai42/qwerty-learner](https://github.com/RealKai42/qwerty-learner)（GNU GPL-3.0 授權）中之 `TOEIC.json`，經由 OpenCC (`s2twp`) 繁簡轉換、修復原始拼字錯誤與 URL 編碼片語、清除無關爬蟲雜訊，並依台灣商務習慣校對專有名詞（如合約、履歷、品質、電腦、帳戶、核銷等）。
2. **核心 600 主題單字（615 字 × 50 主題）**：結構、英文例句與主題分類參考自 [tranngocminhhieu/toeic-600-words-dataset](https://github.com/tranngocminhhieu/toeic-600-words-dataset)，徹底移除原越南文欄位、修正原資料詞性與拼字筆誤，並全面重寫為道地台灣繁體中文商務詞義與 50 大主題譯名。
3. **12 大多益文法講義與 100 題閱讀實戰題庫**：因 `seikaikyo/toeic-practice` 倉庫之程式碼與自創題庫採專有授權（All Rights Reserved），**本教材絕未複製其任何專有程式碼或題目**；僅借鏡其「紙本護眼排版、文法句構視覺化拆解、閱讀 75 分鐘計時模考」的優秀教學設計理念，所有文法講義、例句、Part 5–7 題目與詳解皆為**100% 全新原創編寫**。
4. **商標聲明**：TOEIC® 為美國教育測驗服務社（ETS）之註冊商標，本自學教材與 ETS 無任何官方隸屬或背書關係。
"""
    with open(os.path.join(DOCS_DIR, "00_學習指南與多益備考攻略.md"), "w", encoding="utf-8") as f:
        f.write(guide)

    lines = [
        "# 多益 600 核心主題單字表（50 大職場情境 × 615 字｜台灣繁體中文版）\n",
        "> 涵蓋多益最常考的 50 大商務與生活職場主題，每字均附詞性、IPA 音標、台灣商務常用詞義與實戰例句。\n",
    ]
    for idx, ((tzh, ten), items) in enumerate(sorted(by_topic.items(), key=lambda kv: kv[0][1]), 1):
        lines.append(f"\n## 主題 {idx:02d}：{tzh}（{ten}）\n")
        lines.append("| 單字／片語 | 詞性 | 音標 | 台灣繁中詞義 | 職場例句 |")
        lines.append("| --- | --- | --- | --- | --- |")
        for x in items:
            w = x["word"].replace("|", "\\|")
            pos = x["pos"].replace("|", "\\|")
            ipa = x["ipa"].replace("|", "\\|")
            zh = x["zh"].replace("|", "\\|")
            ex = x["example_en"].replace("|", "\\|")
            lines.append(f"| **{w}** | `{pos}` | {ipa} | {zh} | {ex} |")
    with open(os.path.join(DOCS_DIR, "01_多益600核心主題單字表.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    lines = [
        "# 多益 1,656 高頻進階字彙表（台灣繁體中文精校版）\n",
        "> 整理自開源 Qwerty Learner 多益詞庫，已剔除原始拼字錯誤與雜訊、修復所有片語，並全面轉為台灣商務專有名詞（共 83 章，每章 20 字）。\n",
    ]
    by_ch = defaultdict(list)
    for x in bundle["toeic1656"]:
        by_ch[x["chapter"]].append(x)
    for ch in sorted(by_ch.keys()):
        lines.append(f"\n## 第 {ch:02d} 章（共 {len(by_ch[ch])} 字）\n")
        lines.append("| 編號 | 單字／片語 | 美式音標 | 台灣繁中釋義 |")
        lines.append("| --- | --- | --- | --- |")
        for x in by_ch[ch]:
            ph = f"`/{x['usphone']}/`" if x["usphone"] else ""
            zh = x["summary_zh"].replace("|", "\\|")
            lines.append(f"| {x['id']} | **{x['word']}** | {ph} | {zh} |")
    with open(os.path.join(DOCS_DIR, "02_多益1656高頻進階字彙表.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    lines = [
        "# 多益必考 12 大文法總整理（台灣文法專有名詞版）\n",
        "> 全篇統一採用台灣英語教學慣用術語（主詞、受詞、補語、子句、關係子句、動名詞、不定詞、分詞構句、假設語氣、介系詞、連接詞等），專攻多益 Part 5 與 Part 6 高頻考點。\n",
    ]
    for g in bundle["grammar"]:
        stars = "★" * g["importance"] + "☆" * (5 - g["importance"])
        lines.append(f"\n---\n\n## {g['title']}　（出題頻率：{stars}）\n")
        lines.append(f"**核心觀念**：{g['summary']}\n")
        lines.append(f"> **黃金必背公式**：`{g['coreFormula']}`\n")
        sent = " ".join(p["text"] for p in g["sentenceBreakdown"]["parts"])
        bd = " ｜ ".join(f"`[{p['role']} {p['label']}]` {p['text']}" for p in g["sentenceBreakdown"]["parts"])
        lines.append(f"### 句構拆解示範\n* **原句**：{sent}\n* **拆解**：{bd}\n* **翻譯**：{g['sentenceBreakdown']['zh']}\n")
        lines.append("### 高頻考點對照表\n")
        lines.append("| 句型／線索 | 考點規則／詞類 | 多益解題提醒 |")
        lines.append("| --- | --- | --- |")
        for r in g["rulesTable"]:
            lines.append(f"| {r['pattern']} | {r['pos']} | {r['tip']} |")
        lines.append("\n### 台灣考生常見陷阱")
        for trap in g["commonTraps"]:
            lines.append(f"- {trap}")
        lines.append("\n### 商務實戰例句")
        for ex in g["quickExamples"]:
            lines.append(f"- **{ex['en']}**  \n  {ex['zh']}")
    with open(os.path.join(DOCS_DIR, "03_多益必考12大文法總整理.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    letters = ["(A)", "(B)", "(C)", "(D)"]
    lines = [
        "# 新制多益（TOEIC）閱讀實戰 100 題與繁中詳解\n",
        "> 包含 Part 5 句子填空（60 題）、Part 6 段落填空（20 題）、Part 7 單篇與雙篇閱讀測驗（20 題），共計 100 題（完整單回閱讀測驗題數，建議計時 75 分鐘）。\n",
        "\n---\n\n## Part 5：句子填空（共 60 題）\n",
    ]
    for i, q in enumerate(bundle["part5"], 1):
        lines.append(f"### {i}. `[{q['id']}]`（{q['grammarCategory']}）")
        lines.append(f"{q['sentence']}\n")
        for idx, opt in enumerate(q["options"]):
            lines.append(f"- {letters[idx]} {opt}")
        lines.append(f"\n<details><summary>查看答案與解析</summary>\n\n- **正確答案**：**{letters[q['answer']]} {q['options'][q['answer']]}**\n- **整句翻譯**：{q['translation']}\n- **詳細解析**：{q['explanation']}\n\n</details>\n")

    lines.append("\n---\n\n## Part 6：段落填空（共 5 篇，20 題）\n")
    for pset in bundle["part6"]:
        lines.append(f"### {pset['passageId']}｜{pset['docType']}：{pset['title']}\n")
        lines.append("```text")
        lines.append(pset["header"])
        lines.append("---")
        lines.append(pset["body"])
        lines.append("```\n")
        for q in pset["questions"]:
            lines.append(f"**題號 {q['id']}（空格 [{q['blank']}]｜{q['grammarCategory']}）**")
            for idx, opt in enumerate(q["options"]):
                lines.append(f"- {letters[idx]} {opt}")
            lines.append(f"\n<details><summary>查看答案與解析</summary>\n\n- **正確答案**：**{letters[q['answer']]} {q['options'][q['answer']]}**\n- **詳細解析**：{q['explanation']}\n\n</details>\n")

    lines.append("\n---\n\n## Part 7：閱讀測驗（共 5 組，含單篇與雙篇閱讀，20 題）\n")
    for pset in bundle["part7"]:
        lines.append(f"### {pset['passageId']}｜{pset['docType']}：{pset['title']}\n")
        for doc in pset["documents"]:
            lines.append(f"**{doc['label']}**")
            lines.append("```text")
            lines.append(doc["header"])
            lines.append("---")
            lines.append(doc["content"])
            lines.append("```\n")
        for q in pset["questions"]:
            lines.append(f"**題號 {q['id']}**：{q['question']}")
            for idx, opt in enumerate(q["options"]):
                lines.append(f"- {letters[idx]} {opt}")
            lines.append(f"\n<details><summary>查看答案與解析</summary>\n\n- **正確答案**：**{letters[q['answer']]} {q['options'][q['answer']]}**\n- **詳細解析**：{q['explanation']}\n\n</details>\n")

    with open(os.path.join(DOCS_DIR, "04_多益閱讀實戰100題與詳解.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
