"""自测：中文关键词识别与中英对照（core/cn_terms.py）。

**全部离线**：不发任何网络请求、不加载 Streamlit、不消耗翻译额度。
覆盖：CJK 判定、归一化、词表精确命中、多概念组合、未命中不猜测、
词表自身质量，以及与 pubmed.build_query 组合后检索式语法不被破坏。
"""
import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="medlit_cnterms_")
os.environ["MEDLIT_DATA_DIR"] = _TMP
os.environ.pop("MEDLIT_SCOPE", None)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import cn_terms, pubmed  # noqa: E402

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (f" · {detail}" if detail else ""))


print("\n【1】CJK 判定")
check("纯中文判定为真", cn_terms.has_cjk("胸痛") is True)
check("中英混合判定为真", cn_terms.has_cjk("肺癌 immunotherapy") is True)
check("纯英文判定为假", cn_terms.has_cjk("lung cancer") is False)
check("手写检索式判定为假", cn_terms.has_cjk('"Lung Neoplasms"[MeSH Terms] OR aspirin[tiab]') is False)
check("空值 / None 判定为假", cn_terms.has_cjk("") is False and cn_terms.has_cjk(None) is False)
check("数字与符号判定为假", cn_terms.has_cjk("95% CI 0.55-0.89") is False)

print("\n【2】归一化")
check("去掉中文句号", cn_terms.normalize("胸痛。") == "胸痛")
check("全角空格与多余空白", cn_terms.normalize("　肺癌   化疗 ") == "肺癌 化疗")
check("逗号顿号统一为空格", cn_terms.normalize("肺癌，化疗、预后") == "肺癌 化疗 预后")
check("空输入归一为空串", cn_terms.normalize(None) == "" and cn_terms.normalize("   ") == "")

print("\n【3】词表命中（用户实际输入过的两个词）")
check("胸痛 → chest pain", cn_terms.lookup("胸痛") == "chest pain", str(cn_terms.lookup("胸痛")))
check("心脏 → heart", cn_terms.lookup("心脏") == "heart", str(cn_terms.lookup("心脏")))
check("带标点也能命中", cn_terms.lookup("「胸痛」") == "chest pain")
check("肺癌 → lung cancer", cn_terms.lookup("肺癌") == "lung cancer")
check("随机对照试验 → randomized controlled trial",
      cn_terms.lookup("随机对照试验") == "randomized controlled trial")
check("同义词分别收录", cn_terms.lookup("中风") == "stroke" and cn_terms.lookup("脑卒中") == "stroke")

print("\n【4】多概念组合与「不猜测」边界")
check("两段都命中才拼接", cn_terms.lookup("肺癌 化疗") == "lung cancer chemotherapy",
      str(cn_terms.lookup("肺癌 化疗")))
check("逗号分隔的多概念", cn_terms.lookup("糖尿病，二甲双胍") == "diabetes mellitus metformin")
check("有一段未命中则整体返回 None", cn_terms.lookup("肺癌 未知术语") is None)
check("未收录的复合词返回 None", cn_terms.lookup("急性胸痛") is None)
check("纯英文返回 None（交给原检索流程）", cn_terms.lookup("chest pain") is None)
check("空输入返回 None", cn_terms.lookup("") is None and cn_terms.lookup(None) is None)

print("\n【5】词表质量")
check("词表规模足够", len(cn_terms.TERMS) >= 80, f"{len(cn_terms.TERMS)} 条")
check("键都含汉字、值都不含汉字",
      all(cn_terms.has_cjk(k) and not cn_terms.has_cjk(v) for k, v in cn_terms.TERMS.items()))
check("值无首尾空白、非空", all(v and v == v.strip() for v in cn_terms.TERMS.values()))

print("\n【6】与检索式构造组合")
q = pubmed.build_query(cn_terms.lookup("胸痛") or "胸痛", "", "AND", "", "", "", "", "")
check("英文建议可正常构造检索式", "chest pain" in q, q)
check("构造结果不含汉字", not cn_terms.has_cjk(q))

print(f"\n通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
if FAIL:
    print("失败项：" + "、".join(FAIL))
    sys.exit(1)
print("全部通过\n")
