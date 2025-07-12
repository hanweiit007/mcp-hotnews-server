export const BASE_API_URL = "https://api.vvhan.com/api/hotlist";

export interface HotNewsSource {
  name: string;
  description: string;
}

export const HOT_NEWS_SOURCES: Record<number, HotNewsSource> = {
  1: { name: "zhihuHot", description: "Zhihu Hot List (知乎热榜)" },
  2: { name: "36Ke", description: "36Kr Hot List (36氪热榜)" },
  3: { name: "baiduRD", description: "Baidu Hot Discussion (百度热点)" },
  4: { name: "bili", description: "Bilibili Hot List (B站热榜)" },
  5: { name: "wbHot", description: "Weibo Hot Search (微博热搜)" },
  6: { name: "douyinHot", description: "Douyin Hot List (抖音热点)" },
  7: { name: "huPu", description: "Hupu Hot List (虎扑热榜)" },
  8: { name: "douban", description: "Douban Hot List (豆瓣热榜)" },
  9: { name: "itNews", description: "IT News (IT新闻)" },
};

export const SITE_DOMAINS = ["zhihu", "36kr", "baidu", "bilibili", "weibo", "douyin", "hupu", "douban", "itnews"];

// 新增：rich-text支持的HTML标签 - begin
export const RICH_TEXT_SUPPORTED_TAGS = [
  'div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 
  'strong', 'b', 'em', 'i', 'u', 'del', 'ins', 'sub', 'sup',
  'br', 'img', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
];

// 新增：不同站点的内容选择器配置
export const CONTENT_SELECTORS = {
  zhihu: {
    selector: '.RichContent-inner, .Post-RichTextContainer, .QuestionAnswer-content, article',
    removeSelectors: ['.AuthorInfo', '.ContentItem-actions', '.Sticky', '.FollowButton', '.VoteButton']
  },
  '36kr': {
    selector: '.article-content, .common-width',
    removeSelectors: ['.author-info', '.share-button']
  },
  bilibili: {
    selector: '.article-content, .article-holder',
    removeSelectors: ['.up-info', '.video-page-game-card-small']
  },
  general: {
    selector: 'article, .content, .post-content, .article-content, .main-content',
    removeSelectors: ['.ad', '.advertisement', '.share', '.related', '.sidebar']
  }
  // 其他站点的选择器配置...
};

// 新增：HTML清理函数
export function cleanHtmlForRichText(html: string): string {
  if (!html) return '<p>暂无内容</p>';
  
  // 移除不支持的标签，但保留内容
  const unsupportedTags = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'nav', 'header', 'footer', 'aside', 'canvas', 'svg'];
  let cleanHtml = html;
  
  unsupportedTags.forEach(tag => {
    const regex = new RegExp(`<${tag}[^>]*>.*?</${tag}>`, 'gis');
    cleanHtml = cleanHtml.replace(regex, '');
  });
  
  // 移除空白的div和span
  cleanHtml = cleanHtml.replace(/<(div|span)\s*[^>]*>\s*<\/(div|span)>/g, '');
  
  // 处理图片标签，添加样式使其自适应
  cleanHtml = cleanHtml.replace(
    /<img([^>]*)>/g, 
    '<img$1 style="max-width:100%;height:auto;display:block;margin:10px 0;">'
  );
  
  // 移除不支持的属性，但保留基本样式
  cleanHtml = cleanHtml.replace(/\s(id|class|data-[^=]*|onclick|onload|onerror)="[^"]*"/g, '');
  
  // 简化标签结构，保留基本格式
  cleanHtml = cleanHtml.replace(/<(div|section|article)([^>]*)>/g, '<p$2>');
  cleanHtml = cleanHtml.replace(/<\/(div|section|article)>/g, '</p>');
  
  // 移除嵌套的p标签
  cleanHtml = cleanHtml.replace(/<p[^>]*>\s*<p[^>]*>/g, '<p>');
  cleanHtml = cleanHtml.replace(/<\/p>\s*<\/p>/g, '</p>');
  
  // 移除空的p标签
  cleanHtml = cleanHtml.replace(/<p[^>]*>\s*<\/p>/g, '');
  
  // 确保有基本内容
  const textContent = cleanHtml.replace(/<[^>]*>/g, '').trim();
  if (textContent.length < 10) {
    return '<p>内容正在加载中，请稍后...</p>';
  }
  
  // 限制长度，避免内容过长
  if (cleanHtml.length > 50000) {
    cleanHtml = cleanHtml.substring(0, 50000) + '...</p>';
  }
  
  return cleanHtml;
}

// 新增生成描述的函数
export function generateSourcesDescription(): string {
  const sourcesList = Object.entries(HOT_NEWS_SOURCES)
    .map(([id, source]) => `{ID: ${id}, Platform: "${source.description}"}`)
    .join(",\n");

  return `Available HotNews sources (ID: Platform):\n
${sourcesList}\n
Example usage:
- [3]: Get Baidu Hot Discussion only
- [1,3,7]: Get hot lists from zhihuHot, Baidu, and huPu
- [1,2,3,4]: Get hot lists from zhihuHot, 36Kr, Baidu, and Bilibili`;
}

// 新增获取最大源 ID 的函数
export function getMaxSourceId(): number {
  return Math.max(...Object.keys(HOT_NEWS_SOURCES).map(Number));
}

// 新增完整域名配置，用于更精确的验证
export const FULL_DOMAINS = {
  zhihu: ['zhihu.com', 'www.zhihu.com'],
  weibo: ['weibo.com', 'www.weibo.com'],
  bilibili: ['bilibili.com', 'www.bilibili.com'],
  hupu: ['hupu.com', 'www.hupu.com'],
  douyin: ['douyin.com', 'www.douyin.com'],
  douban: ['douban.com', 'www.douban.com'],
  itnews: ['itnews.com', 'www.itnews.com'],
  baidu: ['baidu.com', 'www.baidu.com'],
  '36kr': ['36kr.com', 'www.36kr.com'],
};