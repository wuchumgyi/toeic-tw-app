import glob
import json
import os
import re

base = r"d:\AI tools\英文學習"

with open(os.path.join(base, "assets", "toeic_bundle.js"), encoding="utf-8") as f:
    raw = f.read()
jstr = raw[raw.index("{") : raw.rindex("}") + 1]
b = json.loads(jstr)

print("Bundle counts:", b["meta"]["counts"])
assert len(b["core600"]) == 615
assert len(b["topics"]) == 50
assert len(b["toeic1656"]) == 1656
assert len(b["grammar"]) == 12
assert len(b["part5"]) == 60
p6_qs = [q for s in b["part6"] for q in s["questions"]]
p7_qs = [q for s in b["part7"] for q in s["questions"]]
assert len(p6_qs) == 20
assert len(p7_qs) == 20

all_qs = b["part5"] + p6_qs + p7_qs
ids = [q["id"] for q in all_qs]
assert len(ids) == len(set(ids)) == 100, "Duplicate question IDs!"
for q in all_qs:
    qid = q["id"]
    assert len(q["options"]) == 4, f"Bad options in {qid}"
    assert q["answer"] in (0, 1, 2, 3), f"Bad answer in {qid}"
    assert len(q["explanation"].strip()) >= 15, f"Short explanation in {qid}"
print("PASS: All 100 questions passed structural assertions!")

banned = [
    "主語", "賓語", "從句", "定語", "狀語", "謂語", "虛擬語氣", "非謂語", "單詞", "語法", "托業",
    "軟件", "硬件", "信息", "數據", "網絡", "服務器", "打印", "視頻", "音頻", "簡歷", "合同", "質量",
    "反饋", "賬戶", "賬單", "報銷", "按揭", "增值稅", "出租車", "公交車", "酒店", "養老金", "工資",
    "招聘", "擴充套件", "因特網", "客戶機", "軟盤", "硬盤", "鼠標", "顯示器", "內存", "默認", "激活",
    "兼容", "優化", "營銷", "運營", "項目", "保修", "登機牌", "航站樓", "寫字樓", "短信", "郵箱", "博客",
    "鏈接", "界面", "菜單",
]
# 專抓越南文獨有字母（避免誤抓英語法語借字 é / IPA 音標）
viet_re = re.compile(r"[ăâđêôơưĂÂĐÊÔƠƯảãạẻẽẹỉĩịỏõọủũụỷỹỵ]")

files_to_scan = (
    [
        os.path.join(base, "index.html"),
        os.path.join(base, "assets", "app.js"),
        os.path.join(base, "assets", "toeic_bundle.js"),
    ]
    + glob.glob(os.path.join(base, "教材講義", "*.md"))
    + glob.glob(os.path.join(base, "Anki牌組", "*.tsv"))
)

issues = []
for fp in files_to_scan:
    with open(fp, encoding="utf-8") as f:
        txt = f.read()
    # 移除常見法語借字與 IPA 中的符號，檢查真正越南文殘留
    clean = re.sub(r"\b(résumé|cafés?|naïve|protégé|attaché|cliché|fiancé|décor|entrées?|a la carte|à la carte|fête|crèche|rôle|château|tête)\b", "", txt, flags=re.I)
    for m in viet_re.finditer(clean):
        ctx = clean[max(0, m.start() - 15) : m.end() + 15].replace("\n", " ")
        issues.append((os.path.basename(fp), "VIET", m.group(0), ctx))
    for term in banned:
        if term in txt:
            idx = txt.index(term)
            ctx = txt[max(0, idx - 12) : idx + 20].replace("\n", " ")
            issues.append((os.path.basename(fp), "TERM", term, ctx))

print(f"Scan complete across {len(files_to_scan)} files. Issues found: {len(issues)}")
for iss in issues[:40]:
    print("  ISSUE:", iss)
