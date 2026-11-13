"""中文关键词 → 英文检索词（离线、确定性）。

PubMed 只索引英文文献，NLM 的 MeSH 词表也只有英文主题词 / 入口词。把「胸痛」
「心脏」这类中文词直接提交给 E-utilities，请求会正常返回但命中数恒为 0，
界面上表现为「一篇也搜不到」，而且旧提示让人以为是自己关键词不够宽泛。

本模块只做两件事：

1. ``has_cjk`` —— 判断输入里是否含汉字，供上层给出针对性提示；
2. ``lookup``   —— 常见医学术语的中英对照，命中即用。零网络请求、不消耗
   翻译额度，术语写法也比通用机器翻译更贴近 PubMed / MeSH 的习惯。

词表未命中时的机器翻译兜底由 UI 层按需调用 ``core.translate.translate_keyword``
触发；本模块刻意不 import 它，保证全部逻辑可离线断言、也不拖慢页面首屏。
"""
from __future__ import annotations

import re

# CJK 统一表意文字（基本区 + 扩展 A）+ 兼容表意文字
_CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
# 中文/全角标点、括号、引号统一视为分隔符
_PUNCT = re.compile(r"[\s\u3000,，、;；:：!！?？。.（）()\[\]【】「」《》\"'／/]+")
_WS = re.compile(r"\s+")

# 症状 / 体征
_SYMPTOMS = {
    "胸痛": "chest pain",
    "心脏": "heart",
    "头痛": "headache",
    "发热": "fever",
    "咳嗽": "cough",
    "呼吸困难": "dyspnea",
    "腹痛": "abdominal pain",
    "恶心": "nausea",
    "呕吐": "vomiting",
    "头晕": "dizziness",
    "乏力": "fatigue",
    "心悸": "palpitations",
    "水肿": "edema",
    "咯血": "hemoptysis",
    "腹泻": "diarrhea",
    "便秘": "constipation",
    "皮疹": "rash",
    "瘙痒": "pruritus",
    "晕厥": "syncope",
    "失眠": "insomnia",
    "疼痛": "pain",
}

# 疾病
_DISEASES = {
    "肺癌": "lung cancer",
    "乳腺癌": "breast cancer",
    "胃癌": "gastric cancer",
    "肝癌": "liver cancer",
    "结直肠癌": "colorectal cancer",
    "胰腺癌": "pancreatic cancer",
    "白血病": "leukemia",
    "淋巴瘤": "lymphoma",
    "糖尿病": "diabetes mellitus",
    "高血压": "hypertension",
    "冠心病": "coronary heart disease",
    "心肌梗死": "myocardial infarction",
    "急性心肌梗死": "acute myocardial infarction",
    "心力衰竭": "heart failure",
    "房颤": "atrial fibrillation",
    "心房颤动": "atrial fibrillation",
    "脑卒中": "stroke",
    "中风": "stroke",
    "哮喘": "asthma",
    "慢阻肺": "COPD",
    "慢性阻塞性肺疾病": "chronic obstructive pulmonary disease",
    "肺炎": "pneumonia",
    "肺结核": "tuberculosis",
    "新冠": "COVID-19",
    "新冠肺炎": "COVID-19",
    "流感": "influenza",
    "艾滋病": "HIV",
    "阿尔茨海默病": "Alzheimer disease",
    "帕金森": "Parkinson disease",
    "抑郁症": "depression",
    "焦虑症": "anxiety",
    "肥胖": "obesity",
    "慢性肾病": "chronic kidney disease",
    "肝硬化": "cirrhosis",
    "缺血性心脏病": "ischemic heart disease",
    "动脉粥样硬化": "atherosclerosis",
    "骨质疏松": "osteoporosis",
    "败血症": "sepsis",
    "脓毒症": "sepsis",
}

# 治疗 / 药物
_TREATMENTS = {
    "化疗": "chemotherapy",
    "放疗": "radiotherapy",
    "免疫治疗": "immunotherapy",
    "靶向治疗": "targeted therapy",
    "手术": "surgery",
    "抗生素": "antibiotics",
    "阿司匹林": "aspirin",
    "二甲双胍": "metformin",
    "他汀": "statin",
    "胰岛素": "insulin",
    "疫苗": "vaccine",
    "干细胞": "stem cell",
    "基因治疗": "gene therapy",
    "康复": "rehabilitation",
    "中医药": "traditional Chinese medicine",
}

# 研究设计 / 方法 / 指标
_METHODS = {
    "随机对照试验": "randomized controlled trial",
    "荟萃分析": "meta-analysis",
    "系统评价": "systematic review",
    "队列研究": "cohort study",
    "病例对照": "case-control study",
    "横断面研究": "cross-sectional study",
    "诊断": "diagnosis",
    "预后": "prognosis",
    "生存率": "survival",
    "死亡率": "mortality",
    "生物标志物": "biomarker",
    "影像学": "imaging",
    "超声": "ultrasound",
    "磁共振": "MRI",
    "人工智能": "artificial intelligence",
    "机器学习": "machine learning",
    "深度学习": "deep learning",
    "危险因素": "risk factors",
    "不良反应": "adverse events",
}

# 人群
_POPULATIONS = {
    "儿童": "children",
    "老年人": "elderly",
    "孕妇": "pregnant women",
    "新生儿": "neonate",
    "青少年": "adolescent",
}

TERMS: dict[str, str] = {}
for _group in (_SYMPTOMS, _DISEASES, _TREATMENTS, _METHODS, _POPULATIONS):
    TERMS.update(_group)


def has_cjk(text: str | None) -> bool:
    """输入里是否含汉字。纯英文 / 检索式返回 False。"""
    return bool(_CJK.search(text or ""))


def normalize(text: str | None) -> str:
    """去掉首尾空白与常见中文标点，多余空白压成一个。"""
    s = _PUNCT.sub(" ", (text or "").strip())
    return _WS.sub(" ", s).strip()


def lookup(text: str | None) -> str | None:
    """查中英对照表；命中返回英文检索词，否则返回 None（绝不猜测）。

    支持「肺癌 化疗」这类空格 / 逗号分隔的多个概念：只在**每一段都命中**时
    才拼成英文短语，避免把半懂不懂的混合输入悄悄改写后送去检索。
    """
    n = normalize(text)
    if not n:
        return None
    if n in TERMS:
        return TERMS[n]
    parts = [p for p in _WS.split(n) if p]
    if len(parts) > 1 and all(p in TERMS for p in parts):
        return " ".join(TERMS[p] for p in parts)
    return None
