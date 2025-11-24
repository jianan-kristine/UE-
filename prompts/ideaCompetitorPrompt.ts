// prompts/ideaCompetitorPrompt.ts

type Mode = "quick" | "deep";
type Persona = "pm" | "vc" | "growth" | "tech" | undefined;

// 不同 persona 的说明文案
function getPersonaInstruction(persona: Persona, targetLang: string): string {
  if (!persona) {
    switch (targetLang) {
      case "Chinese (Simplified)":
        return "默认从通用竞争情报分析师的视角进行分析。";
      case "Japanese":
        return "特定の役割を指定しない一般的な競合分析アナリストの視点で分析してください。";
      default:
        return "Analyze from the perspective of a general competitive intelligence analyst.";
    }
  }

  if (targetLang === "Chinese (Simplified)") {
    switch (persona) {
      case "pm":
        return [
          "从「资深产品经理」的视角进行分析：",
          "- 强调功能差异、用户需求满足度、产品定位与路线图启发；",
          "- 特别关注：核心功能矩阵、MVP 范围、可复制/可差异化的点；",
          "- 在建议部分多给出『下一版应该做什么』和『放弃什么』的判断。"
        ].join("\n");
      case "vc":
        return [
          "从「VC / 投资人」的视角进行分析：",
          "- 强调市场空间（TAM/SAM/SOM）、商业模式、单位经济与护城河；",
          "- 特别关注：头部玩家格局、是否已经红海、是否还有足够上升空间；",
          "- 在建议部分要给出『是否值得投』『需要看到哪些 traction』的观点。"
        ].join("\n");
      case "growth":
        return [
          "从「增长 / 运营负责人」的视角进行分析：",
          "- 强调获客渠道、留存/活跃、付费转化与增长飞轮；",
          "- 特别关注：各竞品的拉新手段、裂变机制、价格与转化路径；",
          "- 在建议部分给出可落地的增长实验思路（如 A/B 测试方向、首单优惠等）。"
        ].join("\n");
      case "tech":
        return [
          "从「技术负责人 / Tech Lead」的视角进行分析：",
          "- 强调技术栈、架构复杂度、AI 能力、集成难度与扩展性；",
          "- 特别关注：哪些能力需要自研，哪些可以集成第三方 / SaaS；",
          "- 在建议部分给出技术路线、技术风险和大致实现复杂度的评估。"
        ].join("\n");
      default:
        return "默认从通用竞争情报分析师的视角进行分析。";
    }
  }

  if (targetLang === "Japanese") {
    switch (persona) {
      case "pm":
        return [
          "「シニアプロダクトマネージャー」の視点から分析してください：",
          "- 機能差別化、ユーザー課題の解像度、プロダクトポジショニングに注目すること；",
          "- MVP 範囲とロードマップ上の優先順位を意識すること；",
          "- 推薦セクションでは『次に何を作るべきか』を明確に述べてください。"
        ].join("\n");
      case "vc":
        return [
          "「VC / 投資家」の視点から分析してください：",
          "- 市場規模、成長ポテンシャル、ビジネスモデルとユニットエコノミクスを重視；",
          "- 既存プレイヤーの寡占状況と新規参入余地を評価；",
          "- 最後に『投資観点でどう評価するか』を簡潔にまとめてください。"
        ].join("\n");
      case "growth":
        return [
          "「グロース / オペレーション責任者」の視点から分析してください：",
          "- 獲得チャネル、オンボーディング、リテンション、課金率に注目；",
          "- 各社のグロース施策やキャンペーンの違いを比較；",
          "- 実行可能なグロース実験案をいくつか提案してください。"
        ].join("\n");
      case "tech":
        return [
          "「テックリード / 技術責任者」の視点から分析してください：",
          "- 使用している技術スタック、アーキテクチャ、AI 活用状況を推定し；",
          "- 開発難易度・スケーラビリティ・依存サービスのリスクを評価；",
          "- 実装戦略と技術的なボトルネックについてコメントしてください。"
        ].join("\n");
      default:
        return "一般的な競合分析アナリストの視点で分析してください。";
    }
  }

  // English
  switch (persona) {
    case "pm":
      return [
        "Adopt the perspective of a **Senior Product Manager**:",
        "- Emphasize feature differentiation, how well competitors solve user problems, and product positioning.",
        "- Pay special attention to: feature matrix, MVP scope, and what can be copied vs. what is defensible.",
        "- In the recommendations, clearly state what to build next and what NOT to build."
      ].join("\n");
    case "vc":
      return [
        "Adopt the perspective of a **VC / Investor**:",
        "- Emphasize market size (TAM/SAM/SOM), business model, unit economics, and defensibility.",
        "- Focus on market structure: is this already a red ocean, or is there still room for new entrants?",
        "- In the recommendations, state whether this looks investable and what traction you would want to see."
      ].join("\n");
    case "growth":
      return [
        "Adopt the perspective of a **Head of Growth / Operations**:",
        "- Emphasize acquisition channels, activation, retention, monetization, and growth loops.",
        "- Compare how each competitor acquires users, designs funnels, and prices their product.",
        "- In the recommendations, propose concrete growth experiments (A/B tests, referral ideas, pricing tests, etc.)."
      ].join("\n");
    case "tech":
      return [
        "Adopt the perspective of a **Tech Lead / Engineering Manager**:",
        "- Emphasize tech stack, architecture complexity, AI capabilities, integration difficulty, and scalability.",
        "- Identify which capabilities likely require custom development vs. third-party services.",
        "- In the recommendations, outline a plausible technical approach and key technical risks."
      ].join("\n");
    default:
      return "Analyze from the perspective of a general competitive intelligence analyst.";
  }
}

export function buildCompetitorResearchTask(
  ideaText: string,
  language: string,
  mode: Mode,
  persona?: Persona
): string {
  // Persona-specific analysis focus
  const personaGuides: Record<string, { zh: string; en: string; ja: string }> = {
    pm: {
      zh: `**【产品经理视角】分析重点：**
• 产品功能对比：核心功能、用户体验、交互设计
• 用户需求满足：目标用户画像、痛点解决方案
• 产品路线图：版本迭代、功能优先级
• 竞品差异化：独特价值主张、产品定位
• 用户反馈：App Store/Google Play 评分、用户评论
• 产品指标：DAU/MAU、留存率、用户增长趋势`,
      en: `**[Product Manager Perspective] Analysis Focus:**
• Product Feature Comparison: Core features, UX, interaction design
• User Needs: Target personas, pain point solutions
• Product Roadmap: Version iterations, feature prioritization
• Competitive Differentiation: Unique value propositions, positioning
• User Feedback: App Store/Google Play ratings, reviews
• Product Metrics: DAU/MAU, retention, user growth trends`,
      ja: `**【プロダクトマネージャー視点】分析重点：**
• 製品機能比較：コア機能、UX、インタラクションデザイン
• ユーザーニーズ：ターゲットペルソナ、ペインポイント解決
• 製品ロードマップ：バージョン反復、機能優先順位
• 競合差別化：独自価値提案、ポジショニング
• ユーザーフィードバック：App Store/Google Play評価、レビュー
• 製品指標：DAU/MAU、リテンション、ユーザー成長トレンド`,
    },
    vc: {
      zh: `**【投资人视角】分析重点：**
• 市场规模与增长：TAM/SAM/SOM、市场增长率、行业趋势
• 商业模式：收入来源、定价策略、盈利能力、单位经济
• 融资情况：融资轮次、估值、投资方、资金使用效率
• 团队背景：创始人履历、核心团队实力、执行能力
• 竞争格局：市场份额、竞争壁垒、先发优势
• 财务指标：ARR/MRR、CAC/LTV、Burn Rate、增长速度
• 退出机会：IPO 可能性、并购潜力、投资回报预期`,
      en: `**[Investor Perspective] Analysis Focus:**
• Market Size & Growth: TAM/SAM/SOM, market growth rate, industry trends
• Business Model: Revenue streams, pricing, profitability, unit economics
• Funding: Funding rounds, valuation, investors, capital efficiency
• Team Background: Founder track record, core team strength, execution
• Competitive Landscape: Market share, moats, first-mover advantage
• Financial Metrics: ARR/MRR, CAC/LTV, Burn Rate, growth velocity
• Exit Opportunities: IPO potential, M&A prospects, return expectations`,
      ja: `**【投資家視点】分析重点：**
• 市場規模と成長：TAM/SAM/SOM、市場成長率、業界トレンド
• ビジネスモデル：収益源、価格戦略、収益性、ユニットエコノミクス
• 資金調達：ラウンド、評価額、投資家、資本効率
• チーム背景：創業者実績、コアチーム強度、実行力
• 競争環境：市場シェア、参入障壁、先行者優位
• 財務指標：ARR/MRR、CAC/LTV、Burn Rate、成長速度
• 出口機会：IPO可能性、M&A見込み、リターン期待`,
    },
    growth: {
      zh: `**【增长/运营视角】分析重点：**
• 获客渠道：付费广告、SEO/SEM、社交媒体、内容营销、KOL合作
• 转化漏斗：注册转化率、付费转化率、各环节优化机会
• 用户增长策略：增长黑客、病毒传播、推荐机制、PLG策略
• 留存与激活：新用户激活率、留存曲线、流失原因分析
• 营销活动：促销策略、活动 ROI、季节性营销、用户生命周期管理
• 数据分析：关键指标监控、A/B 测试、增长实验、归因分析`,
      en: `**[Growth/Operations Perspective] Analysis Focus:**
• Acquisition Channels: Paid ads, SEO/SEM, social media, content marketing, KOL partnerships
• Conversion Funnel: Sign-up rate, paid conversion, optimization opportunities
• Growth Strategies: Growth hacking, viral loops, referral mechanics, PLG strategies
• Retention & Activation: New user activation, retention curves, churn analysis
• Marketing Campaigns: Promo strategies, campaign ROI, seasonal marketing, lifecycle management
• Data Analytics: KPI tracking, A/B testing, growth experiments, attribution analysis`,
      ja: `**【グロース/オペレーション視点】分析重点：**
• 獲得チャネル：有料広告、SEO/SEM、SNS、コンテンツマーケティング、KOL提携
• コンバージョンファネル：登録率、有料転換率、各段階最適化機会
• 成長戦略：グロースハッキング、バイラルループ、紹介メカニズム、PLG戦略
• リテンションと活性化：新規ユーザー活性化率、リテンションカーブ、解約分析
• マーケティングキャンペーン：プロモ戦略、キャンペーンROI、季節マーケティング、ライフサイクル管理
• データ分析：KPI追跡、A/Bテスト、成長実験、アトリビューション分析`,
    },
    tech: {
      zh: `**【技术负责人视角】分析重点：**
• 技术架构：系统架构、技术栈、微服务设计、可扩展性
• 技术实现：核心算法、API 设计、数据处理、AI/ML 应用
• 性能与稳定性：响应时间、可用性、容灾备份、负载均衡
• 安全与合规：数据安全、隐私保护、合规认证（SOC 2、GDPR等）
• 开发效率：开发流程、CI/CD、技术债务、代码质量
• 技术壁垒：专利技术、独特算法、技术护城河、研发投入
• 第三方集成：API 生态、合作伙伴技术、开源组件使用`,
      en: `**[Tech Lead Perspective] Analysis Focus:**
• Technical Architecture: System design, tech stack, microservices, scalability
• Implementation: Core algorithms, API design, data processing, AI/ML applications
• Performance & Stability: Response time, availability, disaster recovery, load balancing
• Security & Compliance: Data security, privacy, certifications (SOC 2, GDPR, etc.)
• Dev Efficiency: Development process, CI/CD, technical debt, code quality
• Technical Moats: Patents, unique algorithms, technical barriers, R&D investment
• Third-party Integration: API ecosystem, partner technologies, open-source usage`,
      ja: `**【技術責任者視点】分析重点：**
• 技術アーキテクチャ：システム設計、技術スタック、マイクロサービス、スケーラビリティ
• 実装：コアアルゴリズム、API設計、データ処理、AI/MLアプリケーション
• パフォーマンスと安定性：応答時間、可用性、災害復旧、負荷分散
• セキュリティとコンプライアンス：データセキュリティ、プライバシー、認証（SOC 2、GDPRなど）
• 開発効率：開発プロセス、CI/CD、技術的負債、コード品質
• 技術的障壁：特許技術、独自アルゴリズム、技術的堀、R&D投資
• サードパーティ統合：APIエコシステム、パートナー技術、オープンソース利用`,
    },
  };

  // 标准化语言代码
  const normalizedLang = language.toLowerCase();
  const langMap: Record<string, string> = {
    zh: "zh",
    "zh-cn": "zh",
    chinese: "zh",
    en: "en",
    english: "en",
    ja: "ja",
    japanese: "ja",
  };

  const langKey = (langMap[normalizedLang] || "en") as "zh" | "en" | "ja";

  const personaGuide =
    persona && personaGuides[persona]
      ? personaGuides[persona][langKey]
      : "";

  // sections 定义
  const sections = {
    zh: {
      instruction1: "你是一位竞争情报分析师。请分析以下产品创意，并提供全面的竞品分析报告。",
      langReq: "**关键语言要求**",
      langReq1: "- 请用中文（简体）提供您的整个回复（JSON 字段和详细分析）。",
      langReq2: "- 所有文本字段必须使用中文（简体）。",
      langReq3: "- 不要混合语言 - 保持一致性。",
      langReq4: "- 章节标题和分析部分也应使用中文（简体）。",
      productIdea: "产品创意",
      critical: "**关键**：您必须以结构化 JSON 输出开始您的回复，然后提供详细分析。",
      firstOutput: "首先，在这些确切的标记之间输出 JSON 数据：",
      afterJson: "JSON 之后，请提供：",
      sec1: "1. **市场概览**",
      sec1a: "   - 确定目标市场和行业",
      sec1b: "   - 市场规模和增长趋势",
      sec1c: "   - 主要市场细分",
      sec2: "2. **直接竞争对手**",
      sec2a: "   - 列出 3-5 个主要直接竞争对手",
      sec2b: "   - 针对每个竞争对手，分析：",
      sec2c: "     * 公司背景和历史",
      sec2d: "     * 主要产品/服务",
      sec2e: "     * 定价策略",
      sec2f: "     * 目标客户",
      sec2g: "     * 优势和劣势",
      sec2h: "     * 市场份额（如有）",
      sec3: "3. **间接竞争对手**",
      sec3a: "   - 客户可能使用的替代解决方案",
      sec3b: "   - 它们与提议的创意有何不同",
      sec4: "4. **竞争优势**",
      sec4a: "   - 这个创意可以提供什么独特的价值主张？",
      sec4b: "   - 潜在的差异化策略",
      sec5: "5. **市场空白与机会**",
      sec5a: "   - 未满足的客户需求",
      sec5b: "   - 竞争对手薄弱的领域",
      sec5c: "   - 潜在的创新机会",
      sec6: "6. **威胁与挑战**",
      sec6a: "   - 进入壁垒",
      sec6b: "   - 潜在的竞争对手反应",
      sec6c: "   - 市场风险",
      sec7: "7. **战略建议**",
      sec7a: "   - 上市策略建议",
      sec7b: "   - 定位建议",
      sec7c: "   - 关键成功因素",
      final: "请使用网络搜索和可用工具收集有关竞争对手和市场的最新准确信息。"
    },
    ja: {
      instruction1: "あなたは競争情報アナリストです。以下の製品アイデアを分析し、包括的な競合分析レポートを提供してください。",
      langReq: "**重要な言語要件**",
      langReq1: "- JSON フィールドと詳細分析の両方を含む全体の回答を日本語で提供してください。",
      langReq2: "- すべてのテキストフィールドは日本語でなければなりません。",
      langReq3: "- 言語を混在させないでください - 一貫性を保ってください。",
      langReq4: "- セクション見出しと分析セクションも日本語で記述してください。",
      productIdea: "製品アイデア",
      critical: "**重要**：構造化された JSON 出力で応答を開始し、その後詳細な分析を提供する必要があります。",
      firstOutput: "まず、これらの正確なマーカー間に JSON データを出力します：",
      afterJson: "JSON の後、以下を提供してください：",
      sec1: "1. **市場概要**",
      sec1a: "   - ターゲット市場と業界を特定",
      sec1b: "   - 市場規模と成長トレンド",
      sec1c: "   - 主要市場セグメント",
      sec2: "2. **直接競合**",
      sec2a: "   - 3～5 の主要な直接競合をリストアップ",
      sec2b: "   - 各競合について分析：",
      sec2c: "     * 企業の背景と歴史",
      sec2d: "     * 主要製品/サービス",
      sec2e: "     * 価格戦略",
      sec2f: "     * ターゲット顧客",
      sec2g: "     * 強みと弱み",
      sec2h: "     * 市場シェア（利用可能な場合）",
      sec3: "3. **間接競合**",
      sec3a: "   - 顧客が使用する可能性のある代替ソリューション",
      sec3b: "   - 提案されたアイデアとの違い",
      sec4: "4. **競争優位性**",
      sec4a: "   - このアイデアはどのようなユニークな価値提案を提供できますか？",
      sec4b: "   - 潜在的な差別化戦略",
      sec5: "5. **市場ギャップと機会**",
      sec5a: "   - 満たされていない顧客ニーズ",
      sec5b: "   - 競合が弱い領域",
      sec5c: "   - 潜在的なイノベーション機会",
      sec6: "6. **脅威と課題**",
      sec6a: "   - 参入障壁",
      sec6b: "   - 潜在的な競合の反応",
      sec6c: "   - 市場リスク",
      sec7: "7. **戦略的提言**",
      sec7a: "   - 市場投入戦略の提案",
      sec7b: "   - ポジショニングの推奨事項",
      sec7c: "   - 主要成功要因",
      final: "ウェブ検索と利用可能なツールを使用して、競合他社と市場に関する最新の正確な情報を収集してください。"
    },
    en: {
      instruction1: "You are a competitive intelligence analyst. Analyze the following product idea and provide a comprehensive competitor analysis report.",
      langReq: "**CRITICAL LANGUAGE REQUIREMENT**",
      langReq1: "- Provide your ENTIRE response (both JSON fields and detailed analysis) in English.",
      langReq2: "- ALL text fields MUST be in English.",
      langReq3: "- Do NOT mix languages - maintain consistency throughout.",
      langReq4: "- The section headings and analysis sections should also be in English.",
      productIdea: "Product Idea",
      critical: "**CRITICAL**: You MUST start your response with a structured JSON output for visualization, then provide the detailed analysis.",
      firstOutput: "First, output the JSON data between these exact markers:",
      afterJson: "After the JSON, please provide:",
      sec1: "1. **Market Overview**",
      sec1a: "   - Identify the target market and industry",
      sec1b: "   - Market size and growth trends",
      sec1c: "   - Key market segments",
      sec2: "2. **Direct Competitors**",
      sec2a: "   - List 3-5 main direct competitors",
      sec2b: "   - For each competitor, analyze:",
      sec2c: "     * Company background and history",
      sec2d: "     * Key products/services",
      sec2e: "     * Pricing strategy",
      sec2f: "     * Target customers",
      sec2g: "     * Strengths and weaknesses",
      sec2h: "     * Market share (if available)",
      sec3: "3. **Indirect Competitors**",
      sec3a: "   - Alternative solutions customers might use",
      sec3b: "   - How they differ from the proposed idea",
      sec4: "4. **Competitive Advantages**",
      sec4a: "   - What unique value proposition could this idea offer?",
      sec4b: "   - Potential differentiation strategies",
      sec5: "5. **Market Gaps & Opportunities**",
      sec5a: "   - Unmet customer needs",
      sec5b: "   - Areas where competitors are weak",
      sec5c: "   - Potential innovation opportunities",
      sec6: "6. **Threats & Challenges**",
      sec6a: "   - Barriers to entry",
      sec6b: "   - Potential competitive responses",
      sec6c: "   - Market risks",
      sec7: "7. **Strategic Recommendations**",
      sec7a: "   - Go-to-market strategy suggestions",
      sec7b: "   - Positioning recommendations",
      sec7c: "   - Key success factors",
      final: "Please use web search and available tools to gather current, accurate information about competitors and the market."
    }
  } as const;

  const s = sections[langKey] || sections.en;

  const personaInstruction = getPersonaInstruction(
    persona,
    langKey === "zh" ? "Chinese (Simplified)" : langKey === "ja" ? "Japanese" : "English"
  );

  // 根据 quick / deep 给一点风格提示
  let modeInstruction = "";
  if (langKey === "zh") {
    modeInstruction =
      mode === "quick"
        ? "当前为【快速反馈】模式：请更偏向于概览式总结，减少冗长叙述，每个竞品用 3–4 个要点概括。"
        : "当前为【深度查找】模式：可以适当写长一点，多给表格、要点和具体案例，让分析更有『做过功课』的感觉。";
  } else if (langKey === "ja") {
    modeInstruction =
      mode === "quick"
        ? "現在は【クイック】モードです：概要中心で簡潔にまとめ、各社 3～4 点程度に絞ってください。"
        : "現在は【詳細】モードです：必要に応じて詳しく書き、表や箇条書きを多用して『調べ尽くした』印象のある分析にしてください。";
  } else {
    modeInstruction =
      mode === "quick"
        ? "You are in **QUICK** mode: favor concise, high-level summaries and 3–4 bullet points per competitor."
        : "You are in **DEEP** mode: you may write longer, include tables and concrete examples, and aim for a \"thorough desk research\" feel.";
  }

  // Firecrawl tool usage instruction（改成“推荐使用”，不再绝对强制）
  const firecrawlInstruction = langKey === "zh"
    ? `
**工具使用建议：优先使用 Firecrawl 等网络抓取工具（如果当前环境可用）**

在分析前，如运行环境允许，请优先使用 firecrawl_search 工具搜索相关竞品和市场信息。若工具不可用，则改为基于已有知识和常识进行合理推断。

**Firecrawl 参数格式（重要）**：
- sources 参数必须是对象数组，而不是字符串数组
- 正确格式：sources: [{ type: "web" }]
- 错误格式：sources: ["web"]  ❌
示例：
{
  "query": "针对该产品创意的竞品分析",
  "sources": [{ "type": "web" }],
  "limit": 5
}`
    : langKey === "ja"
    ? `
**ツール利用の推奨：環境が許せば Firecrawl などの Web クローラーツールを優先的に使用してください**

分析を開始する前に、実行環境が許可している場合は firecrawl_search ツールを優先して利用し、競合や市場情報を検索してください。ツールが利用できない場合は、既存知識と合理的な推論に基づいて分析してください。

**Firecrawl パラメータ形式（重要）**：
- sources パラメータは文字列配列ではなく、オブジェクト配列でなければなりません
- 正しい形式：sources: [{ type: "web" }]
- 誤った形式：sources: ["web"]  ❌
例：
{
  "query": "この製品アイデアに関する競合分析",
  "sources": [{ "type": "web" }],
  "limit": 5
}`
    : `
**Tool Usage Recommendation: Prefer Firecrawl-style web tools when available**

Before starting your analysis, if your environment allows tool calls, you should use the firecrawl_search tool to gather up-to-date competitor and market information. If tools are not available, fall back to reasonable inference based on existing knowledge.

**Firecrawl Parameter Format (IMPORTANT)**:
- The sources parameter MUST be an array of objects, NOT an array of strings
- Correct format: sources: [{ type: "web" }]
- Wrong format: sources: ["web"]  ❌
Example:
{
  "query": "competitor analysis for this product idea",
  "sources": [{ "type": "web" }],
  "limit": 5
}`;

  return `
${s.instruction1}

${personaInstruction}

${personaGuide ? `\n${personaGuide}\n` : ""}

${modeInstruction}

${firecrawlInstruction}

${s.langReq}:
${s.langReq1}
${s.langReq2}
${s.langReq3}
${s.langReq4}

${s.productIdea}: ${ideaText}

${s.critical}

${s.firstOutput}
JSON_OUTPUT_START
{
  "persona_perspective": "${persona || "general"}",
  "analysis_mode": "${mode}",
  "idea_summary": "Brief one-sentence summary of the product idea from this persona's perspective",
  "target_users": ["user segment 1", "user segment 2", "user segment 3"],
  "problem": ["key problem 1", "key problem 2", "key problem 3"],
  "opportunities": ["opportunity 1", "opportunity 2", "opportunity 3"],
  "market_data": {
    "market_size_current": "Current market size with units (e.g., $61.5 billion)",
    "market_size_projected": "Projected market size with units and year (e.g., $43.2 billion by 2032)",
    "cagr": "Compound annual growth rate (e.g., 15.63%)",
    "growth_timeline": [
      {"year": 2024, "value": 18.82},
      {"year": 2028, "value": 28.5},
      {"year": 2032, "value": 43.2}
    ]
  },
  "direct_competitors": [
    {
      "name": "Competitor Name",
      "url": "https://competitor-website.com",
      "target_users": "Target user segment",
      "key_features": ["feature 1", "feature 2", "feature 3"],
      "pricing_summary": "Brief pricing description",
      "differentiation": "How our idea differs from this competitor, from this persona's perspective"
    }
  ],
  "adjacent_competitors": [
    {
      "name": "Alternative Solution Name",
      "url": "https://alternative-website.com",
      "notes": "Brief description of how this alternative works"
    }
  ]
}
JSON_OUTPUT_END

${s.afterJson}

${s.sec1}
${s.sec1a}
${s.sec1b}
${s.sec1c}

${s.sec2}
${s.sec2a}
${s.sec2b}
${s.sec2c}
${s.sec2d}
${s.sec2e}
${s.sec2f}
${s.sec2g}
${s.sec2h}

${s.sec3}
${s.sec3a}
${s.sec3b}

${s.sec4}
${s.sec4a}
${s.sec4b}

${s.sec5}
${s.sec5a}
${s.sec5b}
${s.sec5c}

${s.sec6}
${s.sec6a}
${s.sec6b}
${s.sec6c}

${s.sec7}
${s.sec7a}
${s.sec7b}
${s.sec7c}

${s.final}
`.trim();
}