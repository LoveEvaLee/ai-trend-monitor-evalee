// rules.js — AI 동향 모니터의 판단 기준 (기획안 v3)
// 분류 · 등급 · 중요도 · 키워드 기준은 모두 이 파일에만 둔다. js 코드는 이 파일을 읽어 적용만 한다.
// 기준을 바꿀 때는 이 파일만 고치고 PR로 검토한다.
//
// 적용 방식 (classify.js · keywords.js가 따르는 약속)
// 1. 주제 분류
//    - 찾기 전에 제목과 키워드를 모두 소문자로 바꾸고, 특수 하이픈(‐ ‑ ‒ – —)을 '-'로 바꾼다.
//    - en: 낱말 단위로 일치해야 센다. 구는 구 전체가 일치해야 함.
//      · 앞 경계: 바로 앞 글자가 영문자·숫자·점(.)이 아니어야 함 (예: 'eu'는 "statichost.eu"에 안 걸림 — 강의 64쪽 사례)
//      · 뒤 경계: 바로 뒤 글자가 영문자가 아니어야 함 → 숫자·점이 붙은 모델 이름("Qwen3.8", "GPT-5")도 걸림
//    - ko: 제목 안에 그 글자가 들어 있으면 센다 (조사가 붙어도 걸림).
//    - exclude에 걸리면 그 주제는 붙이지 않는다.
//    - 한 기사에 여러 주제가 붙을 수 있다. 아무 주제도 안 붙으면 '미분류'.
//    - 주제별 개수는 주제마다 센다 (여러 주제가 붙은 기사는 각 주제에 한 번씩 → 합계가 총 건수보다 클 수 있음).
// 2. 출처 등급
//    - url의 호스트에서 'www.'를 떼고, sources의 domain과 같거나 그 하위 도메인이면 일치.
//    - 여러 줄이 맞으면 domain이 가장 긴 줄, 그다음 pathPrefix가 있는 줄이 이긴다.
//    - 어느 줄에도 안 맞으면 unknownGrade를 쓰고 '미등록 도메인' 목록에 띄운다.
// 3. 중요도 = 등급 가중치 × (1 + 비슷한 기사 수) × 최신성
//    - 비슷한 기사: 날짜가 같고, 주제가 하나 이상 같고, 추출 키워드가 score.overlap개 이상 겹치는 다른 기사
//    - 최신성: 0.5 ^ (기준일과의 날짜 차 ÷ score.recencyHalfLifeDays). 기준일 = 입력 데이터의 마지막 날짜
//    - 순위: 점수 높은 순 → 동점이면 날짜 최신 → 등급 높은 순(A>B>C>D) → CSV 줄 번호 작은 순
//      (순위는 반올림 전 점수로 정하고, 화면에는 소수 둘째 자리까지 표시)
// 4. 키워드
//    - 제목을 1번과 같이 소문자·하이픈 정리한 뒤, phrases에 있는 구를 긴 것부터 찾아 한 덩어리로 세고 제목에서 지운다.
//      (영문 구는 1번의 en 경계 규칙, 한글 구는 포함 여부) 표시는 phrases에 적힌 모양 그대로.
//    - 나머지 낱말: 영문·숫자·한글이 이어진 덩어리(가운데의 '-' '.'은 붙여서 한 낱말)를 하나씩 본다.
//      · 한글이 들어 있으면: keywords.particles의 조사를 긴 것부터 하나만 뗀다(뗀 뒤 남은 글자가 숫자·영문 포함 minKo자 이상일 때만).
//        예: '4일부터' → '부터'를 떼면 '4일'(2자)이 남으므로 뗀다 → 한글 음절이 1개라 아래 규칙으로 빠진다.
//        한글 음절이 minKo보다 적거나, stopwords.ko에 있거나, dropKoEndings로 끝나면(서술어 '갖춘다' 등) 뺀다.
//      · 한글이 없으면: 영문자가 하나도 없거나, minEn자보다 짧거나, stopwords.en에 있거나,
//        dropEnPattern에 맞으면('120b' 같은 크기 표기) 뺀다.
//    - 한 기사 안에서 같은 키워드는 한 번만 센다 (문서 빈도).
//    - 기간: 기준일을 포함해 거꾸로 days일. 직전 기간 = 그 바로 앞 같은 길이.
//    - 순위: 건수 많은 순 → 동점이면 직전 기간 건수 많은 순 → 글자 코드 순서(JS의 a < b와 같은 비교)
//    - 한계: 형태소 분석기가 없어서 '요청하면' '찾고' 같은 활용형은 남는다.

window.RULES = {
  version: "0.5 (KB 자동 동기화 주제 · 출처 보강 · 특이 키워드 · 2026-10-23)",

  // ── W2 · 주제 분류 사전 ────────────────────────────────────────────
  // 주제 이름 → { en, ko, exclude }. 적힌 순서 = 화면 표시 순서 (app.js가 Object.keys로 읽음). 경계는 기획안 v3 「주제 5개」 표를 따른다.
  topics: {
    // ★ 자동 생성 블록 — 키워드설정.md(공용 KB)에서 sync_monitor_topics.py가 재생성 (2026-10-23)
    // 직접 고치지 말 것: 키워드는 KB의 그룹별 en:/ko:/exclude: 항목에서 고친다.
    "LLM 분류·오류 예측": {
      // KB 그룹 llm_classification
      en: ["classification", "classifier", "classify", "hallucination", "hallucinations", "misclassification", "error detection", "error prediction", "uncertainty", "confidence", "calibration", "annotation", "labeling", "evaluating", "evaluation", "llm-as-a-judge"],
      ko: ["분류", "환각", "오류 예측", "불확실성", "라벨링"],
      exclude: []
    },
    "조직 AI 수용": {
      // KB 그룹 ai_adoption
      en: ["adoption", "acceptance", "utaut", "technology acceptance", "intention", "intentions", "continuance intention", "behavioral intention", "perceived usefulness", "perceived ease of use", "willingness", "resistance", "structural equation", "predictors", "predicting", "determinants", "drivers"],
      ko: ["수용", "기술수용", "사용의도", "수용의도", "지속사용", "저항"],
      exclude: []
    },
    "데이터·AI 거버넌스": {
      // KB 그룹 governance
      en: ["governance", "data quality", "data management", "master data", "metadata", "data catalog", "stewardship", "lineage", "compliance", "responsible ai", "responsible", "accountability", "transparency", "regulation", "regulatory", "ai act", "risk management", "ethics", "ethical", "data spaces"],
      ko: ["거버넌스", "데이터 품질", "마스터데이터", "메타데이터", "컴플라이언스", "규제", "윤리"],
      exclude: []
    },
    "AI 역량·AX": {
      // KB 그룹 capability
      en: ["capability", "capabilities", "maturity", "readiness", "digital transformation", "dynamic capabilities", "absorptive capacity", "firm performance", "organizational performance", "competitive advantage", "innovation performance", "ai-driven", "upskilling", "reskilling", "digital competence"],
      ko: ["역량", "성숙도", "디지털 전환", "디지털전환", "준비도"],
      exclude: []
    },
    "데이터·AI 보안": {
      // KB 그룹 security
      en: ["security", "cybersecurity", "privacy", "data protection", "access control", "anonymization", "forensic", "federated", "phishing", "sensitive data"],
      ko: ["보안", "개인정보", "프라이버시"],
      exclude: []
    },
    "응용·확장": {
      // KB 그룹 extended
      en: ["sentiment analysis", "sentiment", "multimodal", "ecosystem", "complementor", "self-evolving", "digital business"],
      ko: ["감성분석", "생태계"],
      exclude: []
    },
    "AI 에이전트·엔지니어링": {
      // KB 그룹 agents_engineering
      en: ["ai agent", "ai agents", "agentic", "agent", "agents", "multi-agent", "coding agent", "computer use", "browser agent", "mcp", "model context protocol", "a2a", "tool calling", "tool use", "rag", "retrieval augmented generation", "retrieval-augmented", "prompt", "prompt engineering", "context engineering", "fine-tuning", "finetuning", "orchestration", "workflow", "llmops"],
      ko: ["에이전트", "에이전틱", "멀티에이전트", "도구 호출", "프롬프트", "파인튜닝", "오케스트레이션", "하네스"],
      exclude: ["travel agent", "real estate agent", "secret agent", "free agent", "fbi agent", "insurance agent"]
    },
    "모델·서비스 동향": {
      // KB 그룹 model_service_trends
      en: ["foundation model", "foundation models", "open-weight", "open-weights", "open weights", "gpt", "chatgpt", "claude", "gemini", "gemma", "llama", "qwen", "deepseek", "mistral", "grok", "kimi", "glm", "nemotron", "benchmark", "benchmarks", "openai", "anthropic", "nvidia", "hugging face", "startup", "launch", "launches", "release", "releases", "frontier", "tts", "text-to-speech"],
      ko: ["출시", "공개", "오픈소스", "오픈 웨이트", "오픈웨이트", "스타트업", "챗gpt", "클로드", "제미나이", "딥시크", "큐원", "네모트론", "프런티어", "벤치마크"],
      exclude: []
    }
  },

  // ── W3 · 출처 등급표 ──────────────────────────────────────────────
  // 기준: 기획안 v3 「출처 등급과 근거」 (AI부문_후보.md 부록의 A~D 루브릭)
  // oa: 원문을 무료로 볼 수 있으면 true. 유료 논문은 중요도 상위에 오르기 전에 사람이 확인한다.
  gradeWeight: { A: 3, B: 2, C: 1, D: 0.5 },
  unknownGrade: "C",

  // 출처 유형 그룹: 등급표 줄의 type을 '먼저 읽을 것' 구분용 6가지로 묶는다. 어디에도 없으면 "기타".
  sourceKinds: {
    "논문": ["학술지", "학회 논문", "학술지·학회", "프리프린트", "정부 학술 DB", "학술 단행본", "학위논문", "학생 학술지", "연구 저장소", "학술 행사 공고"],
    "공공·기관": ["정부", "국제기구", "정부 연구기관", "기관 분석", "대학 홍보", "법률 출판 플랫폼"],
    "언론": ["주요 언론", "전문 언론", "인터넷 언론", "지역 인터넷 언론", "작은 인터넷 매체", "포털 재전송"],
    "코드·모델": ["코드 저장소", "모델 저장소", "기업 발표·모델 저장소", "벤치마크 발표", "상업 벤치마크"],
    "기업": ["기업 발표", "기업 블로그", "기업 서비스", "기업 기술문서"],
    "전문가·커뮤니티": ["전문가 블로그", "전문가 글", "전문가 뉴스레터", "커뮤니티"]
  },
  // '먼저 읽을 것'에서 빼는 유형 — 언론 기사는 흐름 파악용이지 정독 대상이 아님 (2026-10-23 유경)
  readExcludeKinds: ["언론"],

  // ── 특이 키워드 ('특이 키워드' 표와 '키워드 연결망'의 기준) ──
  // 순위 = 기간 내 기사 수 × log(1 + 전체 건수 ÷ 전체 기간 문서빈도) — 어디에나 나오는 말은 가라앉는다.
  // stopEn/stopKo: 학술 상투어·기능어. 집계 전에 거른다 (키워드 추출 자체는 keywords 절의 규칙).
  distinct: {
    stopEn: ["ai", "artificial", "intelligence", "generative", "llm", "llms", "large", "language", "model", "models",
      "machine", "learning", "deep", "data", "digital", "analysis", "approach", "approaches", "based", "beyond",
      "case", "comparative", "comprehensive", "design", "development", "driven", "dynamic", "effect", "effects",
      "empirical", "enhancing", "era", "evidence", "exploring", "factors", "framework", "frameworks", "future",
      "impact", "impacts", "implications", "improving", "influence", "insights", "integration", "integrating",
      "intelligent", "leveraging", "management", "method", "methods", "new", "novel", "performance", "perspective",
      "perspectives", "research", "review", "role", "study", "studies", "survey", "system", "systems", "systematic",
      "technology", "technologies", "through", "toward", "towards", "understanding", "using", "via",
      "ability", "across", "affect", "among", "between", "during", "human", "under", "over", "into", "within",
      "without", "versus", "how", "what", "when", "why", "does", "can", "could", "will", "would", "their", "there",
      "these", "those", "this", "that", "from", "with", "more", "most"],
    stopKo: ["연구", "분석", "활용", "기반", "방안", "영향", "사례", "전략", "기술", "산업", "시대", "도입", "개발",
      "구축", "확대", "강화", "지원", "추진", "성료", "변화"],
    graphTop: 18,      // 연결망에 올리는 특이 키워드 수
    graphMinCo: 2      // 선을 긋는 최소 동시 등장 기사 수 (연결이 너무 적으면 1로 완화)
  },

  // ── 취향 보정 ('먼저 읽을 것' 추천에만 적용 — 중요도 순위표는 공식 그대로) ──
  // 별표(★)한 글의 키워드를 브라우저에 누적해 취향 프로필을 만들고,
  // 추천 정렬 점수 = 중요도 × (1 + 겹친 키워드 수 × starKeywordBoost), 상한 maxBoost.
  // 보정된 카드에는 "★ 취향 +N%" 배지가 붙어 왜 올라왔는지 보인다. 별표가 없으면 보정 없음.
  personal: {
    starKeywordBoost: 0.15,   // 프로필과 겹친 키워드 1개당 +15%
    maxBoost: 1.6,            // 보정 상한 ×1.6 (취향이 공식을 삼키지 않게)
    profileTopKw: 30          // 프로필에 유지하는 키워드 수 (별표 누적에서 가중치 상위)
  },

  sources: [
    // A · 동료심사 학술지·학회 (오픈 액세스)
    { domain: "aclanthology.org", type: "학회 논문", grade: "A", oa: true, reason: "ACL 계열 동료심사 학회 논문집 · 원문 무료" },
    { domain: "proceedings.mlr.press", type: "학회 논문", grade: "A", oa: true, reason: "PMLR(ICML 등) 동료심사 논문집 · 원문 무료" },
    { domain: "proceedings.neurips.cc", type: "학회 논문", grade: "A", oa: true, reason: "NeurIPS 동료심사 논문집 · 원문 무료" },
    { domain: "jmlr.org", type: "학술지", grade: "A", oa: true, reason: "JMLR 동료심사 학술지 · 원문 무료" },
    { domain: "openreview.net", type: "학회 논문", grade: "A", oa: true, reason: "ICLR 등 공개 심사 기록이 남는 학회 · 원문 무료 (심사 전 제출본도 있어 채택 여부 확인)" },
    { domain: "frontiersin.org", type: "학술지", grade: "A", oa: true, reason: "동료심사 오픈 액세스 학술지" },
    { domain: "mdpi.com", type: "학술지", grade: "A", oa: true, reason: "동료심사 오픈 액세스 학술지 · 학술지별 심사 수준 편차가 있어 확인 필요" },
    { domain: "plos.org", type: "학술지", grade: "A", oa: true, reason: "동료심사 오픈 액세스 학술지" },
    // A · 동료심사 학술지·학회 (원문 유료일 수 있음)
    { domain: "nature.com", type: "학술지", grade: "A", oa: false, reason: "동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "science.org", type: "학술지", grade: "A", oa: false, reason: "동료심사 학술지 · 원문 유료" },
    { domain: "sciencedirect.com", type: "학술지", grade: "A", oa: false, reason: "Elsevier 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "link.springer.com", type: "학술지", grade: "A", oa: false, reason: "Springer 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "onlinelibrary.wiley.com", type: "학술지", grade: "A", oa: false, reason: "Wiley 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "ieeexplore.ieee.org", type: "학술지·학회", grade: "A", oa: false, reason: "IEEE 동료심사 논문 · 원문 유료인 경우 많음" },
    { domain: "dl.acm.org", type: "학술지·학회", grade: "A", oa: false, reason: "ACM 동료심사 논문 · 원문 유료인 경우 많음" },
    { domain: "eric.ed.gov", type: "정부 학술 DB", grade: "A", oa: false, reason: "미국 교육부 운영 교육 연구 DB · 원문 공개 여부는 문헌마다 다름" },
    // A·B·C · DOI 링크 (doi.org · dx.doi.org) — 호스트가 다 같아서 경로의 DOI 접두(발행처 코드)로 가른다.
    //   논문 목록을 DOI 주소 그대로 넣는 경우(서지 관리 도구·문헌 매트릭스에서 내보낸 CSV)를 위한 줄.
    //   등급은 같은 발행처의 도메인 줄과 맞췄고, 접두가 아래에 없는 DOI는 그대로 '미등록 C'로 남아 보강 후보에 뜬다.
    { domain: "doi.org", pathPrefix: "/10.1016/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1016 = Elsevier(sciencedirect.com) 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1002/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1002 = Wiley 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1111/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1111 = Wiley-Blackwell 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1007/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1007 = Springer(link.springer.com) 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1145/", type: "학술지·학회", grade: "A", oa: false, reason: "DOI 10.1145 = ACM(dl.acm.org) 동료심사 논문 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1109/", type: "학술지·학회", grade: "A", oa: false, reason: "DOI 10.1109 = IEEE(ieeexplore.ieee.org) 동료심사 논문 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1177/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1177 = SAGE 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1080/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1080 = Taylor & Francis 동료심사 학술지(단행본 taylorfrancis.com과 구분) · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1093/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1093 = Oxford University Press 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1108/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1108 = Emerald 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1287/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1287 = INFORMS(Information Systems Research · Management Science 등) 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1038/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1038 = Nature(nature.com) 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.1126/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1126 = Science(science.org) 동료심사 학술지 · 원문 유료" },
    { domain: "doi.org", pathPrefix: "/10.3152/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.3152 = Science and Public Policy 등(Oxford) 동료심사 학술지 · 원문 유료" },
    { domain: "doi.org", pathPrefix: "/10.1525/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1525 = University of California Press 동료심사 학술지 · 일부 오픈 액세스" },
    { domain: "doi.org", pathPrefix: "/10.3389/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.3389 = Frontiers(frontiersin.org) 동료심사 오픈 액세스 학술지" },
    { domain: "doi.org", pathPrefix: "/10.3390/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.3390 = MDPI(mdpi.com) 동료심사 오픈 액세스 학술지 · 학술지별 심사 수준 편차 있어 확인 필요" },
    { domain: "doi.org", pathPrefix: "/10.1371/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.1371 = PLOS(plos.org) 동료심사 오픈 액세스 학술지" },
    { domain: "doi.org", pathPrefix: "/10.1186/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.1186 = BioMed Central(Springer Nature) 동료심사 오픈 액세스 학술지" },
    { domain: "doi.org", pathPrefix: "/10.14763/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.14763 = Internet Policy Review 동료심사 오픈 액세스 학술지" },
    { domain: "doi.org", pathPrefix: "/10.16997/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.16997 = Journal of Deliberative Democracy 등(Westminster UP) 동료심사 오픈 액세스 학술지" },
    { domain: "doi.org", pathPrefix: "/10.1787/", type: "국제기구", grade: "A", oa: true, reason: "DOI 10.1787 = OECD(oecd.org) 공식 문서 · 1차 자료" },
    { domain: "doi.org", pathPrefix: "/10.48550/", type: "프리프린트", grade: "B", oa: true, reason: "DOI 10.48550 = arXiv(arxiv.org) 심사 전 논문 · 원문 무료" },
    { domain: "doi.org", pathPrefix: "/10.2139/", type: "프리프린트", grade: "B", oa: true, reason: "DOI 10.2139 = SSRN 심사 전 논문 · 원문 무료" },
    { domain: "doi.org", pathPrefix: "/10.21203/", type: "프리프린트", grade: "B", oa: true, reason: "DOI 10.21203 = Research Square 심사 전 논문 · 원문 무료" },
    { domain: "doi.org", pathPrefix: "/10.5281/", type: "연구 저장소", grade: "C", oa: true, reason: "DOI 10.5281 = Zenodo(zenodo.org) 누구나 올리는 저장소 · 심사 없음" },
    // A · 정부·국제기구 1차 문서
    { domain: "europa.eu", type: "국제기구", grade: "A", oa: true, reason: "EU 기관 공식 문서 · 1차 자료" },
    { domain: "oecd.org", type: "국제기구", grade: "A", oa: true, reason: "OECD 공식 문서 · 1차 자료" },
    { domain: "oecd.ai", type: "국제기구", grade: "A", oa: true, reason: "OECD AI 정책 관측소 · 1차 자료" },
    { domain: "unesco.org", type: "국제기구", grade: "A", oa: true, reason: "UNESCO 공식 문서 · 1차 자료" },
    { domain: "nist.gov", type: "정부", grade: "A", oa: true, reason: "미국 표준기술연구소 공식 발표 · 1차 자료" },
    { domain: "federalregister.gov", type: "정부", grade: "A", oa: true, reason: "미국 관보 원문 · 1차 자료" },
    { domain: "whitehouse.gov", type: "정부", grade: "A", oa: true, reason: "미국 백악관 공식 발표 · 1차 자료" },
    { domain: "gov.uk", type: "정부", grade: "A", oa: true, reason: "영국 정부 공식 발표(AI Security Institute 포함) · 1차 자료" },
    { domain: "msit.go.kr", type: "정부", grade: "A", oa: true, reason: "과학기술정보통신부 보도자료 · 1차 자료" },
    { domain: "moe.go.kr", type: "정부", grade: "A", oa: true, reason: "교육부 보도자료 · 1차 자료" },
    { domain: "korea.kr", type: "정부", grade: "A", oa: true, reason: "대한민국 정책브리핑 · 정부 1차 자료" },
    { domain: "law.go.kr", type: "정부", grade: "A", oa: true, reason: "국가법령정보센터 법령 원문 · 1차 자료" },

    // B · 프리프린트
    { domain: "arxiv.org", type: "프리프린트", grade: "B", oa: true, reason: "심사 전 논문 · 원문 무료" },
    { domain: "huggingface.co", pathPrefix: "/papers", type: "프리프린트", grade: "B", oa: true, reason: "arXiv 논문 소개 페이지 · 원 논문은 심사 전" },
    { domain: "ssrn.com", type: "프리프린트", grade: "B", oa: true, reason: "심사 전 논문 · 사회과학 중심" },
    // B · 주요 언론 (해외)
    { domain: "reuters.com", type: "주요 언론", grade: "B", oa: true, reason: "통신사 · 편집 검증 있음" },
    { domain: "apnews.com", type: "주요 언론", grade: "B", oa: true, reason: "통신사 · 편집 검증 있음" },
    { domain: "bloomberg.com", type: "주요 언론", grade: "B", oa: false, reason: "경제 전문 언론 · 편집 검증 있음 · 유료 기사 있음" },
    { domain: "ft.com", type: "주요 언론", grade: "B", oa: false, reason: "경제 전문 언론 · 편집 검증 있음 · 유료" },
    { domain: "wsj.com", type: "주요 언론", grade: "B", oa: false, reason: "일간지 · 편집 검증 있음 · 유료" },
    { domain: "nytimes.com", type: "주요 언론", grade: "B", oa: false, reason: "일간지 · 편집 검증 있음 · 유료 기사 있음" },
    { domain: "washingtonpost.com", type: "주요 언론", grade: "B", oa: false, reason: "일간지 · 편집 검증 있음 · 유료 기사 있음" },
    { domain: "theguardian.com", type: "주요 언론", grade: "B", oa: true, reason: "일간지 · 편집 검증 있음" },
    { domain: "bbc.com", type: "주요 언론", grade: "B", oa: true, reason: "공영 방송 · 편집 검증 있음" },
    { domain: "bbc.co.uk", type: "주요 언론", grade: "B", oa: true, reason: "공영 방송 · 편집 검증 있음" },
    // B · 기술 전문 언론 (해외)
    { domain: "technologyreview.com", type: "전문 언론", grade: "B", oa: false, reason: "MIT 기술 전문지 · 편집 검증 있음 · 일부 유료" },
    { domain: "spectrum.ieee.org", type: "전문 언론", grade: "B", oa: true, reason: "IEEE 학회 매체 · 편집 검증 있음" },
    { domain: "theverge.com", type: "전문 언론", grade: "B", oa: true, reason: "기술 전문 언론 · 편집 검증 있음" },
    { domain: "arstechnica.com", type: "전문 언론", grade: "B", oa: true, reason: "기술 전문 언론 · 편집 검증 있음" },
    { domain: "wired.com", type: "전문 언론", grade: "B", oa: false, reason: "기술 전문 언론 · 편집 검증 있음 · 일부 유료" },
    { domain: "techcrunch.com", type: "전문 언론", grade: "B", oa: true, reason: "기술 산업 전문 언론 · 편집 검증 있음" },
    { domain: "thenewstack.io", type: "전문 언론", grade: "B", oa: true, reason: "개발·인프라 전문 언론 · 편집 검증 있음" },
    { domain: "therobotreport.com", type: "전문 언론", grade: "B", oa: true, reason: "로봇 산업 전문 언론 · 편집 검증 있음" },
    { domain: "edsurge.com", type: "전문 언론", grade: "B", oa: true, reason: "에듀테크 전문 언론 · 편집 검증 있음" },
    // B · 국내 언론
    { domain: "yna.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "국가기간 통신사 · 편집 검증 있음" },
    { domain: "chosun.com", type: "주요 언론", grade: "B", oa: true, reason: "일간지(조선비즈 포함) · 편집 검증 있음" },
    { domain: "joongang.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "일간지 · 편집 검증 있음" },
    { domain: "donga.com", type: "주요 언론", grade: "B", oa: true, reason: "일간지 · 편집 검증 있음" },
    { domain: "hani.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "일간지 · 편집 검증 있음" },
    { domain: "khan.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "일간지 · 편집 검증 있음" },
    { domain: "mk.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "경제지 · 편집 검증 있음" },
    { domain: "hankyung.com", type: "주요 언론", grade: "B", oa: true, reason: "경제지 · 편집 검증 있음" },
    { domain: "etnews.com", type: "전문 언론", grade: "B", oa: true, reason: "IT 산업 전문지 · 편집 검증 있음" },
    { domain: "zdnet.co.kr", type: "전문 언론", grade: "B", oa: true, reason: "IT 전문 언론 · 편집 검증 있음" },
    { domain: "ddaily.co.kr", type: "전문 언론", grade: "B", oa: true, reason: "IT 전문 언론 · 편집 검증 있음" },
    { domain: "aitimes.com", type: "전문 언론", grade: "B", oa: true, reason: "AI 전문 언론 · 편집 검증 있음 · 보도자료 기반 기사 비중이 높음" },
    { domain: "irobotnews.com", type: "전문 언론", grade: "B", oa: true, reason: "로봇 전문 언론(로봇신문) · 편집 검증 있음" },
    { domain: "byline.network", type: "전문 언론", grade: "B", oa: true, reason: "IT 전문 언론 · 기획 기사 위주" },
    { domain: "bloter.net", type: "전문 언론", grade: "C", oa: true, reason: "IT 전문 매체 · 편집 검증 수준을 확인하지 못해 C로 둠 〔팀원 확인〕" },
    { domain: "techm.kr", type: "전문 언론", grade: "C", oa: true, reason: "IT 전문 매체 · 편집 검증 수준을 확인하지 못해 C로 둠 〔팀원 확인〕" },
    { domain: "edupress.kr", type: "전문 언론", grade: "C", oa: true, reason: "교육 전문 매체 · 규모가 작고 편집 검증 수준을 확인하지 못함" },

    // C · 기업 공식 블로그·발표 (자사 이해관계 있음)
    // 기획안은 모델 카드·기술 보고서를 B로 두지만, 같은 도메인에 블로그 글이 섞여 있어 도메인 기본값은 C.
    // 모델 카드·기술 보고서 경로가 확인되면 pathPrefix 줄을 B로 추가한다 〔팀원 확인〕
    { domain: "openai.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품·연구 1차 발표 · 자사 이해관계" },
    { domain: "anthropic.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품·연구 1차 발표 · 자사 이해관계" },
    { domain: "deepmind.google", type: "기업 발표", grade: "C", oa: true, reason: "자사 연구 1차 발표 · 자사 이해관계" },
    { domain: "blog.google", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 발표 · 자사 이해관계" },
    { domain: "ai.meta.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 연구 1차 발표 · 자사 이해관계" },
    { domain: "huggingface.co", type: "기업 발표·모델 저장소", grade: "C", oa: true, reason: "블로그·모델 카드 · 자사·작성자 이해관계" },
    { domain: "github.blog", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 발표 · 자사 이해관계" },
    { domain: "nvidia.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 발표 · 자사 이해관계" },
    // C · 전문가 뉴스레터 · 코드 저장소
    { domain: "latent.space", type: "전문가 뉴스레터", grade: "C", oa: true, reason: "실무 전문가 뉴스레터 · 검증 절차 없음" },
    { domain: "substack.com", type: "전문가 뉴스레터", grade: "C", oa: true, reason: "개인 뉴스레터 · 저자 전문성은 글마다 확인" },
    { domain: "github.com", type: "코드 저장소", grade: "C", oa: true, reason: "1차 산출물이지만 설명은 작성자 자기신고" },

    // D · 커뮤니티 원글 (관심도 신호로만 씀)
    { domain: "news.ycombinator.com", type: "커뮤니티", grade: "D", oa: true, reason: "누구나 쓸 수 있고 사실 확인이 없음" },
    { domain: "reddit.com", type: "커뮤니티", grade: "D", oa: true, reason: "누구나 쓸 수 있고 사실 확인이 없음" },
    { domain: "producthunt.com", type: "커뮤니티", grade: "D", oa: true, reason: "제품 등록·홍보 플랫폼 · 사실 확인 없음" },
    { domain: "news.hada.io", type: "커뮤니티", grade: "D", oa: true, reason: "국내 개발자 커뮤니티(GeekNews) · 사실 확인 없음" },
    { domain: "x.com", type: "커뮤니티", grade: "D", oa: true, reason: "개인 게시물 · 사실 확인 없음" },
    { domain: "twitter.com", type: "커뮤니티", grade: "D", oa: true, reason: "개인 게시물 · 사실 확인 없음" },
    { domain: "medium.com", type: "커뮤니티", grade: "D", oa: true, reason: "누구나 쓸 수 있는 블로그 플랫폼 · 저자 전문성 확인 어려움" },

    // ── 예시 데이터(#6)에서 나와 추가한 도메인 (#5 두 번째 PR) ──
    // 작은 인터넷 매체·학술지의 등급은 사이트 소개와 운영 주체만 보고 매긴 기본값이다 〔팀원 확인〕
    // A · 동료심사 · 정부 연구기관
    { domain: "ebooks.iospress.nl", type: "학회 논문", grade: "A", oa: true, reason: "IOS Press 학회 논문집(FAIA) · 동료심사" },
    { domain: "elsevier.com", type: "학술지", grade: "A", oa: false, reason: "Elsevier 학술지(linkinghub 경유 주소 포함) · 원문 공개는 학술지마다 다름" },
    { domain: "revue-mediations.teluq.ca", type: "학술지", grade: "A", oa: true, reason: "TÉLUQ 대학 동료심사 오픈 액세스 학술지" },
    { domain: "nso.edu", type: "정부 연구기관", grade: "A", oa: true, reason: "미국 국립태양관측소(NSF) 공식 발표 · 1차 자료" },
    // B · 학술 단행본 · 학위논문 · 언론
    { domain: "taylorfrancis.com", type: "학술 단행본", grade: "B", oa: false, reason: "학술 출판사 단행본 · 편집 검토는 있으나 학술지 동료심사와 다름 · 원문 유료" },
    { domain: "dias.library.tuc.gr", type: "학위논문", grade: "B", oa: true, reason: "크레타 공대 기관 저장소 · 학위논문(지도교수 심사)" },
    { domain: "afr.com", type: "주요 언론", grade: "B", oa: false, reason: "호주 경제 일간지 · 편집 검증 있음 · 유료" },
    { domain: "techspot.com", type: "전문 언론", grade: "B", oa: true, reason: "기술 전문 언론 · 편집 검증 있음" },
    { domain: "xda-developers.com", type: "전문 언론", grade: "B", oa: true, reason: "기술 전문 언론 · 편집 검증 있음 · 직접 써 본 후기 기사 많음" },
    { domain: "yonhapnewstv.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "연합뉴스TV · 편집 검증 있음" },
    { domain: "science.ytn.co.kr", type: "주요 언론", grade: "B", oa: true, reason: "YTN 사이언스(방송) · 편집 검증 있음" },
    { domain: "newspim.com", type: "주요 언론", grade: "B", oa: true, reason: "통신사(뉴스핌) · 편집 검증 있음" },
    { domain: "kyeonggi.com", type: "주요 언론", grade: "B", oa: true, reason: "지역 일간지(경기일보) · 편집 검증 있음" },
    { domain: "lawtimes.co.kr", type: "전문 언론", grade: "B", oa: true, reason: "법률 전문지(법률신문) · 편집 검증 있음" },
    { domain: "epnc.co.kr", type: "전문 언론", grade: "B", oa: true, reason: "전자·반도체 산업 전문지 · 편집 검증 있음" },
    // C · 작은 인터넷 매체 · 포털 재전송 (편집 검증 수준을 확인하지 못함)
    { domain: "v.daum.net", type: "포털 재전송", grade: "C", oa: true, reason: "포털이 언론사 기사를 다시 실은 주소 · 원 언론사로 다시 매겨야 함" },
    { domain: "wikitree.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "인터넷 언론 · 편집 검증 수준 확인 못 함" },
    { domain: "devtimes.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "IT 인터넷 언론 · 편집 검증 수준 확인 못 함" },
    { domain: "aipostkorea.com", type: "인터넷 언론", grade: "C", oa: true, reason: "AI 인터넷 매체 · 편집 검증 수준 확인 못 함" },
    { domain: "fetv.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "경제 인터넷 방송 매체 · 편집 검증 수준 확인 못 함" },
    { domain: "energykorea.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "에너지 산업 인터넷 매체 · 편집 검증 수준 확인 못 함" },
    { domain: "newsworker.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "인터넷 언론 · 편집 검증 수준 확인 못 함" },
    { domain: "theguru.co.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "산업 인터넷 매체 · 편집 검증 수준 확인 못 함" },
    { domain: "kyobit.com", type: "인터넷 언론", grade: "C", oa: true, reason: "교육 인터넷 매체 · 편집 검증 수준 확인 못 함" },
    { domain: "eduyonhap.com", type: "인터넷 언론", grade: "C", oa: true, reason: "교육 인터넷 매체 · 칼럼 위주" },
    { domain: "gokorea.kr", type: "인터넷 언론", grade: "C", oa: true, reason: "인터넷 언론 · 편집 검증 수준 확인 못 함" },
    { domain: "headlinejeju.co.kr", type: "지역 인터넷 언론", grade: "C", oa: true, reason: "제주 지역 인터넷 언론" },
    { domain: "mediajeju.com", type: "지역 인터넷 언론", grade: "C", oa: true, reason: "제주 지역 인터넷 언론 · 기고" },
    // C · 연구 저장소 · 학술 행사 · 심사 수준 확인이 어려운 학술지
    { domain: "zenodo.org", type: "연구 저장소", grade: "C", oa: true, reason: "누구나 올리는 연구 저장소(CERN 운영) · 심사 없음 · 원문 무료" },
    { domain: "calenda.org", type: "학술 행사 공고", grade: "C", oa: true, reason: "학술 행사·원고 모집 공고 플랫폼(OpenEdition) · 1차 공고" },
    { domain: "student-journals.ucl.ac.uk", type: "학생 학술지", grade: "C", oa: true, reason: "UCL 학생 학술지 · 심사 수준 확인 어려움" },
    { domain: "cspub-ijcisim.org", type: "학술지", grade: "C", oa: true, reason: "국제 학술지(IJCISIM) · 심사 수준 확인 못 함" },
    { domain: "vidhiaagaz.com", type: "법률 출판 플랫폼", grade: "C", oa: true, reason: "법률 해설·출판 플랫폼 · 심사 여부 확인 못 함" },
    { domain: "terminal-bench-science.ai", type: "벤치마크 발표", grade: "C", oa: true, reason: "벤치마크 프로젝트 공식 사이트 · 자체 발표" },
    // C · 기업 발표 (자사 이해관계)
    { domain: "mistral.ai", type: "기업 발표", grade: "C", oa: true, reason: "자사 모델 1차 발표 · 자사 이해관계" },
    { domain: "research.meta.ai", type: "기업 발표", grade: "C", oa: true, reason: "자사 연구·모델 1차 발표 · 자사 이해관계" },
    { domain: "deepseek.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 1차 발표 · 자사 이해관계" },
    { domain: "bfl.ai", type: "기업 발표", grade: "C", oa: true, reason: "Black Forest Labs 자사 모델 발표 · 자사 이해관계" },
    { domain: "modelscope.cn", type: "모델 저장소", grade: "C", oa: true, reason: "알리바바 모델 저장소 · 작성자 자기신고" },
    { domain: "inference-docs.cerebras.ai", type: "기업 기술문서", grade: "C", oa: true, reason: "자사 서비스 문서 · 자사 이해관계" },
    { domain: "artificialanalysis.ai", type: "상업 벤치마크", grade: "C", oa: true, reason: "모델 성능·가격 비교 서비스 · 방법은 공개돼 있으나 상업 서비스" },
    { domain: "fireworks.ai", type: "기업 발표", grade: "C", oa: true, reason: "추론 서비스 기업 블로그 · 자사 이해관계" },
    { domain: "telnyx.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 서비스 출시 공지 · 자사 이해관계" },
    { domain: "blog.jetbrains.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 발표 · 자사 이해관계" },
    { domain: "docker.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 페이지 · 자사 이해관계" },
    { domain: "capitalone.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 오픈소스 공개 글 · 자사 이해관계" },
    { domain: "go.dev", type: "기업 발표", grade: "C", oa: true, reason: "Go 언어 공식 블로그 · 1차 기술 글" },
    { domain: "cactuscompute.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 모델 소개 · 자사 이해관계" },
    { domain: "ploy.ai", type: "기업 발표", grade: "C", oa: true, reason: "자사 사례 글 · 자사 이해관계" },
    { domain: "marbleos.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 데모 · 자사 이해관계" },
    { domain: "alphamatch.ai", type: "기업 발표", grade: "C", oa: true, reason: "자사 블로그 비교 글 · 자사 이해관계" },
    { domain: "ello.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 제품 개발기 · 자사 이해관계" },
    { domain: "tryai.dev", type: "기업 발표", grade: "C", oa: true, reason: "자사 블로그 비교 글 · 자사 이해관계" },
    { domain: "tokenstead.ai", type: "기업 발표", grade: "C", oa: true, reason: "자사 가이드 글 · 자사 이해관계 · 규제 내용은 원문(EU) 확인 필요" },
    { domain: "studyarena.com", type: "기업 발표", grade: "C", oa: true, reason: "자사 이용 데이터 분석 글 · 자사 이해관계" },
    { domain: "regen.co.uk", type: "기관 분석", grade: "C", oa: true, reason: "영국 에너지 분야 기관 분석 글" },
    // C · 전문가 개인 블로그 (저자 전문성 확인됨)
    { domain: "simonwillison.net", type: "전문가 블로그", grade: "C", oa: true, reason: "Django 공동 개발자의 개인 블로그 · 검증 절차 없음" },
    { domain: "yoshuabengio.org", type: "전문가 블로그", grade: "C", oa: true, reason: "요슈아 벤지오 개인 사이트 · 검증 절차 없음" },
    { domain: "jvns.ca", type: "전문가 블로그", grade: "C", oa: true, reason: "개발자 개인 블로그 · 검증 절차 없음" },
    { domain: "matklad.github.io", type: "전문가 블로그", grade: "C", oa: true, reason: "개발자 개인 블로그 · 검증 절차 없음" },
    // D · 심사 신뢰가 어려운 출판사
    { domain: "globaljournals.org", type: "학술지", grade: "D", oa: true, reason: "약탈적 출판사 의심 목록에 자주 오르는 곳 · 심사를 신뢰하기 어려움 〔팀원 확인〕" },
    // ── v0.5 초안 · 유경 수집물(헤르메스·아르고스 210건)의 미등록 출처 보강 (발행처를 확인한 것만 — 무명 학술지는 미등록 C로 남겨 보강 후보에 둔다)
    { domain: "doi.org", pathPrefix: "/10.1609/", type: "학회 논문", grade: "A", oa: true, reason: "DOI 10.1609 = AAAI 동료심사 학회 논문집" },
    { domain: "doi.org", pathPrefix: "/10.1057/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.1057 = Palgrave Macmillan(Springer Nature) 동료심사 학술지 · 원문 유료인 경우 많음" },
    { domain: "doi.org", pathPrefix: "/10.24425/", type: "학술지", grade: "A", oa: true, reason: "DOI 10.24425 = 폴란드 과학아카데미(PAS) 동료심사 학술지" },
    { domain: "doi.org", pathPrefix: "/10.4018/", type: "학술지", grade: "A", oa: false, reason: "DOI 10.4018 = IGI Global 동료심사 학술지 · 학술지별 심사 수준 편차 있어 확인 필요" },
    { domain: "doi.org", pathPrefix: "/10.31234/", type: "프리프린트", grade: "B", oa: true, reason: "DOI 10.31234 = PsyArXiv(OSF) 심사 전 논문 · 원문 무료" },
    { domain: "doi.org", pathPrefix: "/10.38124/", type: "학술지", grade: "C", oa: true, reason: "DOI 10.38124 = IJISRT · 심사 기준을 확인하기 어려운 오픈 액세스 저널" },
    { domain: "doi.org", pathPrefix: "/10.5539/", type: "학술지", grade: "C", oa: true, reason: "DOI 10.5539 = CCSE · 심사 수준 논란이 있는 출판사" },
    { domain: "economist.com", type: "주요 언론", grade: "B", oa: false, reason: "국제 시사 주간지 · 편집 검증 있음 · 원문 유료" },
    { domain: "404media.co", type: "작은 인터넷 매체", grade: "C", oa: false, reason: "기자들이 만든 독립 기술 매체 · 편집 규모 작음" },
    { domain: "langchain.com", type: "기업 블로그", grade: "C", oa: true, reason: "LangChain 자사 제품 블로그 · 이해관계 있음" },
    { domain: "claude.com", type: "기업 발표", grade: "C", oa: true, reason: "Anthropic 제품 페이지 · 이해관계 있음" },
    { domain: "learnvector.ai", type: "기업 서비스", grade: "C", oa: true, reason: "교육 서비스 자사 소개 · 이해관계 있음" },
    { domain: "danluu.com", type: "전문가 글", grade: "C", oa: true, reason: "소프트웨어 엔지니어 개인 블로그 · 저자 전문성 알려짐" },
    { domain: "vcresearch.berkeley.edu", type: "대학 홍보", grade: "C", oa: true, reason: "UC Berkeley 연구 홍보 페이지 · 기관 발표 성격" },
  ],

  // ── 중요도 ─────────────────────────────────────────────────────────
  // 〔사람이 정할 것〕 아래 값은 초안. 바꾸면 기대값(data/expected.md)도 다시 계산한다.
  score: {
    overlap: 2,               // 같은 사건으로 볼 최소 겹침 키워드 수
    recencyHalfLifeDays: 14,  // 14일 지나면 최신성이 절반
    topN: 5                   // 주제 카드마다 보여 줄 건수
  },

  // ── 키워드 ─────────────────────────────────────────────────────────
  keywords: {
    windows: [
      { id: "90d", label: "90일", days: 90 },
      { id: "30d", label: "30일", days: 30 },
      { id: "7d", label: "7일", days: 7 },
      { id: "1d", label: "전날", days: 1 }
    ],
    topN: 10,
    minKo: 2,
    minEn: 3,
    dropKoEndings: ["다"],                    // '다'로 끝나는 한글 낱말(서술어) 제외
    dropEnPattern: "^\\d+(\\.\\d+)?[a-z]$",     // '120b' '3b' '1.5t' 같은 크기 표기 제외
    // 한 덩어리로 셀 구 (긴 구부터 찾음)
    phrases: [
      "EU AI Act", "AI Act", "AI 기본법", "AI agent", "AI agents", "AI 에이전트", "agentic AI",
      "physical AI", "피지컬 AI", "embodied AI", "humanoid robot", "휴머노이드 로봇", "large language model",
      "거대언어모델", "foundation model", "open-weight", "AI safety", "AI literacy", "AI 리터러시",
      "AI 교육", "디지털교과서", "model context protocol", "computer use", "self-driving", "자율주행"
    ],
    // 떼어 낼 한글 조사 (긴 것부터)
    particles: ["으로서", "으로써", "에서는", "에게서", "이라고", "으로", "에서", "에게", "까지", "부터", "보다",
                "처럼", "이다", "라고", "은", "는", "이", "가", "을", "를", "의", "에", "와", "과", "도", "로", "만"],
    stopwords: {
      en: ["show", "launch", "ask", "the", "and", "for", "with", "from", "that", "this", "are", "was", "were", "has", "have", "how",
           "what", "why", "who", "when", "will", "can", "its", "into", "about", "after", "over", "new", "says",
           "said", "more", "than", "you", "your", "our", "their", "not", "now", "just", "use", "using", "via",
           "ai", "artificial", "intelligence"],
      ko: ["인공지능", "AI", "기자", "발표", "공개", "출시", "관련", "위한", "대한", "통해", "있는", "하는", "했다",
           "한다", "된다", "이번", "올해", "지난", "오늘", "국내", "세계", "글로벌", "기업", "업계", "시장"]
    }
  }
};
