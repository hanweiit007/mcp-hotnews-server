#!/usr/bin/env node
/**
 * MCP热点新闻服务器
 * 
 * 注意：webview-only模式下，以下功能不会被使用：
 * - get_hot_news: 热点列表获取（小程序使用静态列表）
 * - get_article_content: 文章内容抓取（小程序直接使用webview）
 * - get_article_html: HTML代理（小程序直接使用webview）
 * 
 * webview-only编译模式可以完全不部署此MCP服务器
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import * as cheerio from "cheerio";

import {
  BASE_API_URL,
  HOT_NEWS_SOURCES,
  generateSourcesDescription,
  getMaxSourceId,
  CONTENT_SELECTORS,
  cleanHtmlForRichText,
} from "./config.js";

// Define interfaces for type safety
interface HotNewsItem {
  index: number;
  title: string;
  url: string;
  hot?: string | number;
}

interface HotNewsResponse {
  success: boolean;
  message?: string;
  name: string;
  subtitle: string;
  update_time: string;
  data: HotNewsItem[];
}

// 简化缓存机制
class SimpleCache {
  private cache = new Map<string, { data: any; expires: number }>();
  
  set(key: string, data: any, ttlMinutes: number = 5) {
    this.cache.set(key, {
      data,
      expires: Date.now() + ttlMinutes * 60 * 1000
    });
  }
  
  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item || Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }
  
  clear() {
    this.cache.clear();
  }
}

class HotNewsServer {
  private server: Server;
  private cache = new SimpleCache();

  constructor() {
    this.server = new Server(
      {
        name: "mcp-server/hotnewslist",
        version: "0.2.0",
      },
      {
        capabilities: {
          resources: {},
          tools: {},
        },
      },
    );

    this.setupToolHandlers();
  }

  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "get_hot_news",
          description: "Get hot trending lists from various platforms. 【webview-only模式不使用】",
          inputSchema: {
            type: "object",
            properties: {
              sources: {
                type: "array",
                description: generateSourcesDescription(),
                items: {
                  type: "number",
                  minimum: 1,
                  maximum: getMaxSourceId(),
                },
              },
            },
            required: ["sources"],
          },
        },
        {
          name: "get_article_content",
          description: "Get article content for rich-text display. 【webview-only模式不使用】",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Article URL to fetch content from",
              },
            },
            required: ["url"],
          },
        },
        {
          name: "get_article_html",
          description: "Get full HTML page for webview display with proxy support. 【webview-only模式不使用】",
          inputSchema: {
            type: "object",
            properties: {
              url: {
                type: "string",
                description: "Article URL to proxy and enhance for webview",
              },
            },
            required: ["url"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "get_hot_news") {
        return this.handleGetHotNews(request);
      } else if (request.params.name === "get_article_content") {
        return this.handleGetArticleContent(request);
      } else if (request.params.name === "get_article_html") {
        return this.handleGetArticleHtml(request);
      } else {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`,
        );
      }
    });
  }

  private async handleGetHotNews(request: any) {
    try {
      const sources = request.params.arguments?.sources as number[];
      if (!Array.isArray(sources) || sources.length === 0) {
        throw new Error("Please provide valid source IDs");
      }

      const results = await this.getHotNews(sources);
      
      // 格式化输出为MCP协议要求的格式
      const formattedResults = results.map((result: any) => {
        if (typeof result === 'string') {
          return result; // 错误信息直接返回
        }
        
        const newsList = result.data.map(
          (item: HotNewsItem) =>
            `${item.index}. [${item.title}](${item.url}) ${
              item.hot ? `<small>Heat: ${item.hot}</small>` : ""
            }`,
        );

        return `
### ${result.name}:${result.subtitle}
> Last updated: ${result.update_time}
${newsList.join("\n")}
`;
      });

      return {
        content: [
          {
            type: "text",
            text: formattedResults.join("\n\n"),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  // 新增：处理获取文章内容的请求
  private async handleGetArticleContent(request: any) {
    try {
      const url = request.params.arguments?.url as string;
      if (!url) {
        throw new Error("Please provide a valid URL");
      }

      const content = await this.fetchArticleContent(url);
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(content),
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  // 新增：处理获取文章HTML的请求（用于webview代理）
  private async handleGetArticleHtml(request: any) {
    try {
      const url = request.params.arguments?.url as string;
      if (!url) {
        throw new Error("Please provide a valid URL");
      }

      const htmlContent = await this.fetchArticleHtml(url);
      
      return {
        content: [
          {
            type: "text",
            text: htmlContent,
          },
        ],
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  }

  // 新增：抓取文章内容
  private async fetchArticleContent(url: string): Promise<{
    title: string;
    content: string;
    summary: string;
  }> {
    try {
      console.log(`正在获取文章内容: ${url}`);
      
      // 首先尝试从URL中提取基本信息
      const urlInfo = this.extractInfoFromUrl(url);
      
      // 更完善的请求头，模拟真实浏览器
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        'Referer': 'https://www.google.com/'  // 添加Referer
      };

      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 400; // 接受重定向
        }
      });

      const $ = cheerio.load(response.data);
      
      // 获取站点类型
      const hostname = new URL(url).hostname;
      const siteType = this.getSiteType(hostname);
      
      console.log(`识别站点类型: ${siteType}`);
      
      // 新增：根据站点类型选择内容选择器
      const selectorConfig = (CONTENT_SELECTORS as Record<string, { selector: string; removeSelectors?: string[] } | undefined>)[siteType] || {
      selector: 'article, .content, .post-content, .article-content, .main-content, .RichContent',
      removeSelectors: ['.ad', '.advertisement', '.share', '.related', '.AuthorInfo', '.ContentItem-actions']
      };

      // 移除不需要的元素
      selectorConfig.removeSelectors?.forEach((selector: string) => {
        $(selector).remove();
      });

      // 提取标题 - 优先级顺序
      const title = $('title').text() || 
                   $('h1').first().text() || 
                   $('.QuestionHeader-title').text() ||  // 知乎问题标题
                   $('.ContentItem-title').text() ||    // 知乎内容标题
                   $('meta[property="og:title"]').attr('content') || 
                   urlInfo.title ||
                   '';

      // 提取主要内容
      let content = $(selectorConfig.selector).html() || '';
      
      // 如果没有找到内容，尝试更通用的选择器
      if (!content || content.trim().length < 50) {
        console.log('使用备用内容选择器');
        content = $('.RichContent-inner').html() ||     // 知乎回答内容
                 $('.Post-RichTextContainer').html() ||  // 知乎文章内容
                 $('.QuestionAnswer-content').html() ||  // 知乎问题回答
                 $('main').html() ||
                 $('.main').html() ||
                 $('body').html() || 
                 '';
      }

      // 提取摘要
      const summary = $('meta[name="description"]').attr('content') || 
                     $('meta[property="og:description"]').attr('content') || 
                     $('.QuestionHeader-detail').text() ||  // 知乎问题详情
                     $('p').first().text().substring(0, 200) || 
                     urlInfo.summary ||
                     '';

      console.log(`提取结果 - 标题长度: ${title.length}, 内容长度: ${content.length}, 摘要长度: ${summary.length}`);

      // 如果内容太少，可能是反爬虫阻止了访问
      if (content.trim().length < 10) {
        console.warn('内容长度过短，可能遇到反爬虫限制');
        // 提供一个基于URL信息的降级内容
        return this.generateFallbackContent(url, title || urlInfo.title, summary || urlInfo.summary);
      }

      // 清理HTML内容，适配rich-text
      const cleanedContent = cleanHtmlForRichText(content);

      return {
        title: title.trim() || urlInfo.title || '无标题',
        content: cleanedContent,
        summary: summary.trim() || urlInfo.summary || ''
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`获取文章内容失败: ${message}`);
      
      // 提取URL中的基本信息作为降级方案
      const urlInfo = this.extractInfoFromUrl(url);
      
      // 如果是403错误或其他访问限制，提供智能降级内容
      if (message.includes('403') || message.includes('Forbidden') || message.includes('blocked')) {
        return this.generateFallbackContent(url, urlInfo.title, urlInfo.summary);
      }
      
      throw new Error(`Failed to fetch article content: ${message}`);
    }
  }

  // 新增：从URL中提取基本信息
  private extractInfoFromUrl(url: string): { title: string; summary: string } {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      
      let title = '';
      let summary = '';
      
      if (hostname.includes('zhihu.com')) {
        // 知乎问题ID提取
        const questionMatch = pathname.match(/question\/(\d+)/);
        if (questionMatch) {
          title = '知乎问题讨论';
          summary = '这是一个知乎平台上的热门问题，包含多个回答和讨论。由于访问限制，请点击下方链接查看完整内容。';
        }
      } else if (hostname.includes('36kr.com')) {
        title = '36氪科技资讯';
        summary = '36氪平台的科技创业资讯内容。';
      } else if (hostname.includes('bilibili.com')) {
        title = 'B站内容';
        summary = 'B站平台的视频或文章内容。';
      } else if (hostname.includes('b23.tv')) {
        // B站短链接处理
        const bvMatch = pathname.match(/(BV[a-zA-Z0-9]+)/);
        if (bvMatch) {
          title = `B站视频 - ${bvMatch[1]}`;
          summary = '这是一个B站热门视频内容。B站作为中国最大的弹幕视频网站，汇聚了大量优质的原创内容。由于技术限制，建议直接访问观看完整视频。';
        } else {
          title = 'B站短链接内容';
          summary = 'B站平台的热门内容，请点击链接查看详情。';
        }
      } else if (hostname.includes('weibo.com')) {
        title = '微博热门内容';
        summary = '新浪微博平台的热门话题或内容。';
      } else if (hostname.includes('douyin.com')) {
        title = '抖音热门内容';
        summary = '抖音平台的热门视频或话题。';
      }
      
      return {
        title: title || '热门内容',
        summary: summary || '由于网站访问限制，暂时无法获取详细内容。'
      };
    } catch (error) {
      return {
        title: '热门内容',
        summary: '由于网站访问限制，暂时无法获取详细内容。'
      };
    }
  }

  // 新增：生成降级内容
  private generateFallbackContent(url: string, title: string, summary: string): {
    title: string;
    content: string;
    summary: string;
  } {
    const hostname = new URL(url).hostname;
    const siteName = this.getSiteName(hostname);
    
    // B站视频的特殊处理
    if (hostname.includes('b23.tv') || hostname.includes('bilibili.com')) {
      const fallbackContent = `
        <div class="fallback-content">
          <div class="content-notice">
            <h3>🎬 视频内容预览</h3>
            <p><strong>来源：</strong>${siteName}</p>
            <p><strong>说明：</strong>这是一个B站视频链接，无法直接在此页面播放。</p>
          </div>
          
          <div class="content-summary">
            <h4>📋 内容简介</h4>
            <p>${summary}</p>
          </div>
          
          <div class="access-options">
            <h4>🎥 观看方式</h4>
            <ul>
              <li><strong>直接观看：</strong><a href="${url}" target="_blank">点击这里打开B站观看</a></li>
              <li><strong>推荐设备：</strong>建议在手机或电脑上观看，获得更好的体验</li>
              <li><strong>互动功能：</strong>B站支持弹幕、评论、点赞等丰富的互动功能</li>
              <li><strong>相关推荐：</strong>观看后可以发现更多相似的优质内容</li>
            </ul>
          </div>
          
          <div class="platform-info">
            <h4>💡 关于B站</h4>
            <p>${this.getPlatformDescription(hostname)}</p>
            <p><strong>特色：</strong>弹幕文化、UP主创作、二次元内容、学习视频、生活记录等。</p>
          </div>
        </div>
      `;
      
      return {
        title: title || 'B站热门视频',
        content: fallbackContent,
        summary: summary || '点击链接观看B站视频内容。'
      };
    }
    
    // 其他网站的通用处理
    const fallbackContent = `
      <div class="fallback-content">
        <div class="content-notice">
          <h3>📚 内容预览</h3>
          <p><strong>来源：</strong>${siteName}</p>
          <p><strong>说明：</strong>由于网站的访问保护机制，我们无法直接获取完整内容。</p>
        </div>
        
        <div class="content-summary">
          <h4>📋 内容摘要</h4>
          <p>${summary || '这是一个热门话题，吸引了众多用户的关注和讨论。'}</p>
        </div>
        
        <div class="access-options">
          <h4>🔗 查看方式</h4>
          <ul>
            <li><strong>直接访问：</strong><a href="${url}" target="_blank">点击这里查看原文</a></li>
            <li><strong>建议：</strong>在浏览器中打开链接以获得最佳阅读体验</li>
            <li><strong>提示：</strong>原文可能包含更丰富的内容、图片和互动功能</li>
          </ul>
        </div>
        
        <div class="platform-info">
          <h4>💡 平台特色</h4>
          <p>${this.getPlatformDescription(hostname)}</p>
        </div>
      </div>
    `;
    
    return {
      title: title || '热门内容',
      content: fallbackContent,
      summary: summary || '由于访问限制，请点击链接查看原文内容。'
    };
  }

  // 新增：获取站点名称
  private getSiteName(hostname: string): string {
    if (hostname.includes('zhihu.com')) return '知乎';
    if (hostname.includes('36kr.com')) return '36氪';
    if (hostname.includes('bilibili.com') || hostname.includes('b23.tv')) return 'B站';
    if (hostname.includes('weibo.com')) return '微博';
    if (hostname.includes('douyin.com')) return '抖音';
    if (hostname.includes('hupu.com')) return '虎扑';
    if (hostname.includes('douban.com')) return '豆瓣';
    if (hostname.includes('baidu.com')) return '百度';
    return '未知网站';
  }

  // 新增：获取平台描述
  private getPlatformDescription(hostname: string): string {
    if (hostname.includes('zhihu.com')) {
      return '知乎是中文互联网高质量的问答社区，汇聚了各行各业的专业人士分享知识、经验和见解。';
    }
    if (hostname.includes('36kr.com')) {
      return '36氪是中国领先的科技创业媒体，专注报道创业公司、投资机构和科技趋势。';
    }
    if (hostname.includes('bilibili.com')) {
      return 'B站是中国年轻人聚集的文化社区，涵盖动画、游戏、科技、生活等多元化内容。';
    }
    return '这是一个热门的中文网站，提供丰富的资讯和内容。';
  }

  // 新增：根据域名判断站点类型
  private getSiteType(hostname: string): string {
    if (hostname.includes('zhihu.com')) return 'zhihu';
    if (hostname.includes('36kr.com')) return '36kr';
    if (hostname.includes('bilibili.com') || hostname.includes('b23.tv')) return 'bilibili';
    if (hostname.includes('weibo.com')) return 'weibo';
    if (hostname.includes('douyin.com')) return 'douyin';
    if (hostname.includes('hupu.com')) return 'hupu';
    if (hostname.includes('douban.com')) return 'douban';
    if (hostname.includes('baidu.com')) return 'baidu';
    // 添加更多站点识别...
    return 'general';
  }

  // 并行请求的核心方法
  async getHotNews(sources: number[], timeoutSeconds: number = 8) {
    // 检查缓存
    const cacheKey = `hotnews_${sources.join('_')}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      console.log('返回缓存数据:', cacheKey);
      return cached;
    }

    console.log(`开始并行获取${sources.length}个站点数据，超时设置: ${timeoutSeconds}秒`);
    
    // 创建所有请求的Promise数组
    const requestPromises = sources.map(sourceId => this.fetchSingleSource(sourceId));
    
    try {
      // 使用Promise.allSettled + 超时控制
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutSeconds * 1000);
      });
      
      // 竞速：要么所有请求完成，要么超时
      const raceResult = await Promise.race([
        Promise.allSettled(requestPromises),
        timeoutPromise
      ]);
      
      // 处理结果
      const results = [];
      for (let i = 0; i < sources.length; i++) {
        const result = (raceResult as PromiseSettledResult<any>[])[i];
        
        if (result && result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          // 失败或未完成的请求，使用降级数据
          console.warn(`站点${sources[i]}请求失败或超时，使用降级数据`);
          results.push(this.getFallbackSiteData(sources[i]));
        }
      }
      
      // 缓存成功结果
      this.cache.set(cacheKey, results, 5);
      console.log(`成功获取${results.length}个站点数据`);
      
      return results;
      
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMEOUT') {
        console.log(`请求超时(${timeoutSeconds}秒)，返回部分完成的结果...`);
        
        // 超时处理：使用 Promise.allSettled 获取已完成的结果
        const partialResults = await Promise.allSettled(requestPromises);
        const finalResults = [];
        
        for (let i = 0; i < sources.length; i++) {
          const result = partialResults[i];
          if (result.status === 'fulfilled') {
            finalResults.push(result.value);
          } else {
            // 未完成或失败的请求使用降级数据
            console.warn(`站点${sources[i]}超时或失败，使用降级数据`);
            finalResults.push(this.getFallbackSiteData(sources[i]));
          }
        }
        
        // 缓存部分结果，TTL设置为更短时间
        this.cache.set(cacheKey, finalResults, 2);
        console.log(`超时处理完成，返回${finalResults.length}个结果（包含${finalResults.filter(r => r?.data?.[0]?.title !== '数据加载中，请稍候...').length}个有效结果）`);
        return finalResults;
      }
      
      // 其他错误，全部使用降级数据
      console.error('获取热点数据失败:', error);
      const fallbackResults = sources.map(sourceId => this.getFallbackSiteData(sourceId));
      return fallbackResults;
    }
  }

  // 单个数据源的请求方法
  private async fetchSingleSource(sourceId: number): Promise<any> {
    const source = HOT_NEWS_SOURCES[sourceId];
    if (!source) {
      throw new Error(`Source ID ${sourceId} does not exist`);
    }

    try {
      const response = await axios.get<HotNewsResponse>(
        `${BASE_API_URL}/${source.name}`,
        {
          timeout: 6000, // 单个请求6秒超时
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cache-Control': 'no-cache'
          }
        }
      );
      
      const news = response.data;
      if (!news.success) {
        throw new Error(`API returned error: ${news.message}`);
      }

      return {
        name: news.name,
        subtitle: news.subtitle,
        update_time: news.update_time,
        data: news.data
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`获取${source.description}失败: ${message}`);
      throw error;
    }
  }

  // 降级数据生成
  private getFallbackSiteData(sourceId: number) {
    const source = HOT_NEWS_SOURCES[sourceId];
    if (!source) return null;
    
    const siteName = source.description.split('(')[1]?.replace(')', '') || source.description;
    
    return {
      name: siteName,
      subtitle: '热榜',
      update_time: new Date().toLocaleString('zh-CN'),
      data: [
        {
          index: 1,
          title: '数据加载中，请稍候...',
          url: '#',
          hot: 0
        },
        {
          index: 2, 
          title: '网络连接缓慢，正在重试',
          url: '#',
          hot: 0
        }
      ]
    };
  }

  // 新增：获取文章内容的公共方法
  async getArticleContent(url: string) {
    return this.fetchArticleContent(url);
  }

  // 新增：获取文章HTML的公共方法（用于webview代理）
  async getArticleHtml(url: string) {
    return this.fetchArticleHtml(url);
  }

  // 新增：抓取完整HTML页面（用于webview代理）
  private async fetchArticleHtml(url: string): Promise<string> {
    try {
      console.log(`正在代理获取HTML页面: ${url}`);
      
      // 使用与fetchArticleContent相同的请求头
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Connection': 'keep-alive',
        'Referer': 'https://www.google.com/'
      };

      const response = await axios.get(url, {
        headers,
        timeout: 15000,
        maxRedirects: 5,
        validateStatus: function (status) {
          return status >= 200 && status < 400;
        }
      });

      let html = response.data;
      
      // 处理HTML以适配webview
      html = this.processHtmlForWebview(html, url);
      
      console.log(`HTML代理成功，内容长度: ${html.length}`);
      
      return html;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`HTML代理失败: ${message}`);
      
      // 如果代理失败，返回错误页面
      return this.generateErrorHtml(url, message);
    }
  }

  // 新增：处理HTML以适配webview
  private processHtmlForWebview(html: string, originalUrl: string): string {
    try {
      const $ = cheerio.load(html);
      const baseUrl = new URL(originalUrl);
      
      // 移除一些可能影响显示的元素
      $('script').remove(); // 移除JavaScript，避免安全问题
      $('iframe').remove(); // 移除内嵌框架
      $('.ad, .advertisement, [class*="ad-"], [id*="ad-"]').remove(); // 移除广告
      
      // 处理相对链接转为绝对链接
      $('img').each(function() {
        const src = $(this).attr('src');
        if (src && !src.startsWith('http') && !src.startsWith('data:')) {
          try {
            const absoluteUrl = new URL(src, baseUrl).toString();
            $(this).attr('src', absoluteUrl);
          } catch (e) {
            console.warn('处理图片链接失败:', src);
          }
        }
      });
      
      $('link[rel="stylesheet"]').each(function() {
        const href = $(this).attr('href');
        if (href && !href.startsWith('http')) {
          try {
            const absoluteUrl = new URL(href, baseUrl).toString();
            $(this).attr('href', absoluteUrl);
          } catch (e) {
            console.warn('处理CSS链接失败:', href);
          }
        }
      });
      
      // 添加移动端优化样式
      $('head').append(`
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <style>
          body { 
            font-size: 16px !important; 
            line-height: 1.6 !important;
            padding: 10px !important;
            margin: 0 !important;
            word-wrap: break-word !important;
          }
          img { 
            max-width: 100% !important; 
            height: auto !important; 
            display: block !important;
            margin: 10px 0 !important;
          }
          .sidebar, .ads, .advertisement, [class*="sidebar"], [class*="nav"] {
            display: none !important;
          }
          p, div, article { 
            max-width: 100% !important;
            overflow-wrap: break-word !important;
          }
        </style>
      `);
      
      return $.html();
    } catch (error) {
      console.error('处理HTML失败:', error);
      return html; // 如果处理失败，返回原始HTML
    }
  }

  // 新增：生成错误页面
  private generateErrorHtml(url: string, errorMessage: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>页面加载失败</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            padding: 20px;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
          }
          .error-container {
            background: white;
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
          }
          .error-title {
            font-size: 24px;
            font-weight: bold;
            margin-bottom: 10px;
            color: #d73a49;
          }
          .error-message {
            color: #666;
            margin-bottom: 20px;
          }
          .error-url {
            background: #f6f8fa;
            padding: 10px;
            border-radius: 4px;
            word-break: break-all;
            font-family: monospace;
            font-size: 14px;
            margin-bottom: 20px;
          }
          .retry-btn {
            background: #0366d6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <div class="error-icon">⚠️</div>
          <div class="error-title">页面加载失败</div>
          <div class="error-message">无法加载页面内容，可能是网络连接问题或网站访问限制。</div>
          <div class="error-url">${url}</div>
          <div class="error-message">错误详情：${errorMessage}</div>
          <button class="retry-btn" onclick="location.reload()">重试</button>
        </div>
      </body>
      </html>
    `;
  }

  // 清理缓存的公共方法
  clearCache() {
    this.cache.clear();
    console.log('缓存已清理');
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Hot news MCP server running on stdio");
  }
}

export { HotNewsServer };

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new HotNewsServer();
  server.run().catch(console.error);
}
