// Persona 视角过滤增强脚本
// 将此脚本添加到 visualize.html 中以支持按 Persona 过滤可视化内容

// Persona 相关的数据类型映射
const personaDataMapping = {
  pm: {
    keywords: [
      'feature', 'function', 'user experience', 'ux', 'ui', 'design',
      'user feedback', 'rating', 'review', 'dau', 'mau', 'retention',
      '功能', '用户体验', '交互', '评分', '评论', '留存', '活跃',
      '機能', 'ユーザー体験', 'レビュー', '評価'
    ],
    sections: ['产品功能', 'Product Features', '製品機能', '用户反馈', 'User Feedback', 'ユーザーフィードバック']
  },
  vc: {
    keywords: [
      'market size', 'tam', 'sam', 'som', 'funding', 'valuation', 'investor',
      'revenue', 'arr', 'mrr', 'cac', 'ltv', 'burn rate', 'ipo', 'm&a',
      '市场规模', '融资', '估值', '投资', '收入', '财务', '盈利',
      '市場規模', '資金調達', '評価額', '投資家', '収益'
    ],
    sections: ['市场分析', 'Market Analysis', '市場分析', '融资情况', 'Funding', '資金調達', '商业模式', 'Business Model', 'ビジネスモデル']
  },
  growth: {
    keywords: [
      'acquisition', 'conversion', 'funnel', 'seo', 'sem', 'marketing',
      'growth', 'viral', 'referral', 'activation', 'churn', 'campaign',
      '获客', '转化', '营销', '增长', '推广', '留存', '流失',
      '獲得', 'コンバージョン', 'マーケティング', '成長', 'キャンペーン'
    ],
    sections: ['增长策略', 'Growth Strategy', '成長戦略', '营销渠道', 'Marketing Channels', 'マーケティングチャネル', '转化漏斗', 'Conversion Funnel', 'コンバージョンファネル']
  },
  tech: {
    keywords: [
      'architecture', 'tech stack', 'api', 'algorithm', 'performance',
      'security', 'scalability', 'infrastructure', 'cloud', 'database',
      '架构', '技术栈', '算法', '性能', '安全', '可扩展', '数据库',
      'アーキテクチャ', '技術スタック', 'アルゴリズム', 'パフォーマンス', 'セキュリティ'
    ],
    sections: ['技术架构', 'Technical Architecture', '技術アーキテクチャ', '技术实现', 'Implementation', '実装', '性能指标', 'Performance', 'パフォーマンス']
  }
};

// 应用 Persona 过滤
function applyPersonaFilter() {
  const selectedPersona = document.getElementById('personaFilter')?.value || 'all';
  
  if (selectedPersona === 'all') {
    // 显示所有内容
    showAllContent();
    return;
  }
  
  // 获取当前 Persona 的关键词和章节
  const mapping = personaDataMapping[selectedPersona];
  if (!mapping) {
    showAllContent();
    return;
  }
  
  console.log(`🎯 Filtering visualization for Persona: ${selectedPersona}`);
  
  // 过滤图表
  filterCharts(mapping);
  
  // 过滤文本内容
  filterTextContent(mapping);
  
  // 显示过滤提示
  showFilterNotice(selectedPersona);
}

// 过滤图表
function filterCharts(mapping) {
  // 查找所有图表容器
  const chartContainers = document.querySelectorAll('[id^="chart-"], .chart-container, .visualization-chart');
  
  chartContainers.forEach(container => {
    const chartTitle = container.querySelector('h3, h2, .chart-title')?.textContent?.toLowerCase() || '';
    const chartContent = container.textContent.toLowerCase();
    
    // 检查是否包含相关关键词
    const isRelevant = mapping.keywords.some(keyword => 
      chartTitle.includes(keyword.toLowerCase()) || 
      chartContent.includes(keyword.toLowerCase())
    );
    
    if (isRelevant) {
      container.style.display = '';
      container.classList.add('persona-visible');
    } else {
      container.style.display = 'none';
      container.classList.remove('persona-visible');
    }
  });
}

// 过滤文本内容
function filterTextContent(mapping) {
  // 查找所有章节
  const sections = document.querySelectorAll('section, .section, .content-section, [class*="section"]');
  
  sections.forEach(section => {
    const sectionTitle = section.querySelector('h1, h2, h3, .section-title')?.textContent || '';
    const sectionContent = section.textContent.toLowerCase();
    
    // 检查章节标题是否匹配
    const titleMatch = mapping.sections.some(s => sectionTitle.includes(s));
    
    // 检查内容是否包含相关关键词
    const contentMatch = mapping.keywords.some(keyword => 
      sectionContent.includes(keyword.toLowerCase())
    );
    
    if (titleMatch || contentMatch) {
      section.style.display = '';
      section.classList.add('persona-visible');
    } else {
      section.style.display = 'none';
      section.classList.remove('persona-visible');
    }
  });
}

// 显示所有内容
function showAllContent() {
  console.log('📊 Showing all visualization content');
  
  // 移除所有隐藏样式
  document.querySelectorAll('[style*="display: none"]').forEach(el => {
    if (el.classList.contains('persona-visible') || el.id?.startsWith('chart-')) {
      el.style.display = '';
    }
  });
  
  // 隐藏过滤提示
  const notice = document.getElementById('personaFilterNotice');
  if (notice) {
    notice.remove();
  }
}

// 显示过滤提示
function showFilterNotice(persona) {
  const personaNames = {
    pm: { zh: '产品经理', en: 'Product Manager', ja: 'プロダクトマネージャー' },
    vc: { zh: '投资人', en: 'Investor', ja: '投資家' },
    growth: { zh: '增长/运营', en: 'Growth/Operations', ja: 'グロース/オペレーション' },
    tech: { zh: '技术负责人', en: 'Tech Lead', ja: '技術責任者' }
  };
  
  // 检测当前语言
  const lang = localStorage.getItem('preferredLanguage') || 'zh';
  const personaName = personaNames[persona]?.[lang] || persona;
  
  // 移除旧提示
  const oldNotice = document.getElementById('personaFilterNotice');
  if (oldNotice) oldNotice.remove();
  
  // 创建新提示
  const notice = document.createElement('div');
  notice.id = 'personaFilterNotice';
  notice.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    padding: 12px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    z-index: 9999;
    font-size: 14px;
    animation: slideInRight 0.3s ease-out;
  `;
  
  const texts = {
    zh: `🎯 仅显示【${personaName}】相关内容`,
    en: `🎯 Showing only [${personaName}] related content`,
    ja: `🎯 【${personaName}】関連コンテンツのみ表示`
  };
  
  notice.textContent = texts[lang] || texts.zh;
  
  // 添加动画
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(notice);
  
  // 5秒后自动隐藏
  setTimeout(() => {
    notice.style.opacity = '0';
    notice.style.transition = 'opacity 0.3s';
    setTimeout(() => notice.remove(), 300);
  }, 5000);
}

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
  // 如果URL中包含 persona 参数，自动应用过滤
  const urlParams = new URLSearchParams(window.location.search);
  const personaParam = urlParams.get('persona');
  
  if (personaParam && document.getElementById('personaFilter')) {
    document.getElementById('personaFilter').value = personaParam;
    applyPersonaFilter();
  }
  
  // 从 localStorage 读取原始报告中的 persona
  try {
    const visualData = sessionStorage.getItem('visualizationData');
    if (visualData) {
      const data = JSON.parse(visualData);
      if (data.persona && document.getElementById('personaFilter')) {
        document.getElementById('personaFilter').value = data.persona;
        applyPersonaFilter();
      }
    }
  } catch (e) {
    console.warn('Failed to read persona from visualization data:', e);
  }
});

// 导出函数供其他脚本使用
if (typeof window !== 'undefined') {
  window.applyPersonaFilter = applyPersonaFilter;
  window.personaDataMapping = personaDataMapping;
}
