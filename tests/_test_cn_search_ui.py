"""自测：检索页中文关键词提示与一键英文替换（AppTest，无浏览器、全部离线）。

复现的真实问题：用户输入「胸痛」「心脏」，PubMed 请求成功但命中 0 条，界面只说
「没有检索到文献，试试更宽泛的关键词」。这里断言提示、英文建议、一键替换后的
输入框状态，以及英文输入时完全不受影响。

翻译接口被桩替换，测试不发任何网络请求、不消耗翻译额度。
"""
import os
import sys
import tempfile

_TMP = tempfile.mkdtemp(prefix="medlit_cnui_")
os.environ["MEDLIT_DATA_DIR"] = _TMP
os.environ["MEDLIT_SCOPE"] = "local"

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import core.pubmed as pubmed  # noqa: E402
import core.translate as translate  # noqa: E402
from streamlit.testing.v1 import AppTest  # noqa: E402

_TRANSLATE_CALLS = []
_SEARCH_QUERIES = []


def _stub_translate(term, langpair="en|zh-CN"):
    _TRANSLATE_CALLS.append((term, langpair))
    return term, "none"


def _stub_search(query, retmax=20, sort="relevance"):
    """模拟 PubMed 对中文词返回 0 条，不发网络请求。"""
    _SEARCH_QUERIES.append(query)
    return []


# 保证离线：翻译与检索都走桩
translate.translate_keyword = _stub_translate
pubmed.search_and_fetch = _stub_search
pubmed.last_total = lambda: 0
pubmed.spelling_suggest = lambda term: []      # 英文空结果时的拼写建议也别发请求

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    print(("  [OK]   " if cond else "  [FAIL] ") + name + (f" · {detail}" if detail else ""))


def run(at):
    """pending_page 每轮都会被消费，每次 run 前重新注入才能留在检索页。"""
    at.session_state["pending_page"] = "文献检索"
    at.run()


def labels(at):
    return [(b.label or "") for b in at.button]


def has_cn_warning(at):
    return any("只索引英文" in (w.value or "") for w in at.warning)


def new_app():
    at = AppTest.from_file(
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app.py"),
        default_timeout=120,
    )
    at.session_state["privacy_ack"] = True
    run(at)
    return at


def set_keyword(at, value):
    kw = next((t for t in at.text_input if t.label and "主关键词" in t.label), None)
    if kw is None:
        return False
    kw.set_value(value)
    run(at)
    return True


print("\n【1】进入检索页")
at = new_app()
check("脚本执行无异常", len(at.exception) == 0, str([str(e) for e in at.exception])[:120])
check("主关键词输入框存在", set_keyword(at, ""))
check("英文输入时不出现中文提示", not has_cn_warning(at))

print("\n【2】中文关键词「胸痛」")
check("输入框可写入中文", set_keyword(at, "胸痛"))
check("执行无异常", len(at.exception) == 0)
check("出现「PubMed 只索引英文」提示", has_cn_warning(at))
check("给出 chest pain 建议", any("chest pain" in (c.value or "") for c in at.caption))
check("出现一键替换按钮", any("改用「chest pain」检索" in x for x in labels(at)))
check("词表命中时未调用翻译接口", len(_TRANSLATE_CALLS) == 0, f"调用 {len(_TRANSLATE_CALLS)} 次")

print("\n【3】一键替换")
use = next((b for b in at.button if "改用" in (b.label or "")), None)
check("找到替换按钮", use is not None)
if use:
    use.click()
    run(at)
    check("替换后主关键词变为英文", at.session_state["kw"] == "chest pain", str(at.session_state["kw"]))
    check("替换后中文提示消失", not has_cn_warning(at))
    check("替换后执行无异常", len(at.exception) == 0)

print("\n【4】多概念组合与未收录词")
at2 = new_app()
set_keyword(at2, "肺癌 化疗")
check("多概念给出组合英文建议", any("lung cancer chemotherapy" in (c.value or "") for c in at2.caption))
check("未误触发翻译接口", len(_TRANSLATE_CALLS) == 0)

at3 = new_app()
set_keyword(at3, "急性胸痛")
check("词表未命中时提供按需翻译按钮", any("帮我译成英文" in x for x in labels(at3)))
check("首屏不自动发翻译请求", len(_TRANSLATE_CALLS) == 0, f"调用 {len(_TRANSLATE_CALLS)} 次")
check("未收录词仍有中文提示", has_cn_warning(at3))

print("\n【5】中文检索 0 条后一键改用英文重搜")
at4 = new_app()
set_keyword(at4, "胸痛")
start = next((b for b in at4.button if "开始检索" in (b.label or "")), None)
check("找到开始检索按钮", start is not None)
if start:
    start.click()
    run(at4)
    check("0 结果时给出针对性说明", any("命中 0 条" in (i.value or "") for i in at4.info))
    retry = next((b for b in at4.button if "并重新检索" in (b.label or "")), None)
    check("出现一键改用英文重搜按钮", retry is not None)
    if retry:
        before = len(_SEARCH_QUERIES)
        retry.click()
        run(at4)
        check("关键词已改为英文", at4.session_state["kw"] == "chest pain", str(at4.session_state["kw"]))
        check("自动发起了一次新检索", len(_SEARCH_QUERIES) == before + 1,
              f"{before} → {len(_SEARCH_QUERIES)}")
        check("新检索式是英文", "chest pain" in (_SEARCH_QUERIES[-1] if _SEARCH_QUERIES else ""))
        check("中译英一步完成后执行无异常", len(at4.exception) == 0)

print(f"\n通过 {len(PASS)} / {len(PASS) + len(FAIL)}")
if FAIL:
    print("失败项：" + "、".join(FAIL))
    sys.exit(1)
print("全部通过\n")
