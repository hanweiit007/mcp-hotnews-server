/**
 * MCP热点新闻HTTP服务器
 * 
 * 提供HTTP API接口，供小程序调用
 * 
 * 注意：webview-only模式下，以下端点不会被使用：
 * - POST /api/hotnews - 热点列表获取（小程序使用静态列表）
 * - POST /api/article-content - 文章内容抓取（小程序直接使用webview）
 * - POST /api/article-html - HTML代理（小程序直接使用webview）
 * - GET /api/article-html - HTML代理GET方式（小程序直接使用webview）
 * 
 * webview-only编译模式可以完全不部署此HTTP服务器
 */

import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import { HotNewsServer } from './index.js';
import { HOT_NEWS_SOURCES, getMaxSourceId } from './config.js';

const app = express();

// 启用 CORS
app.use(cors());
app.use(express.json());

// 创建 MCP 服务器实例
const server = new HotNewsServer();

// 处理热点新闻请求
const handleHotNews: RequestHandler = async (req, res) => {
  try {
    // 兼容sources和siteIds
    const siteIds = req.body.siteIds || req.body.sources;
    
    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      res.status(400).json({ error: '请提供有效的站点ID列表' });
      return;
    }

    // 验证站点ID
    for (const siteId of siteIds) {
      if (typeof siteId !== 'number' || siteId < 1 || siteId > getMaxSourceId()) {
        res.status(400).json({ 
          error: `无效的站点ID: ${siteId}。有效范围: 1-${getMaxSourceId()}` 
        });
        return;
      }
    }

    // 获取超时参数，默认8秒
    const timeout = typeof req.body.timeout === 'number' ? req.body.timeout : 8;
    
    // 调用 MCP 服务的 get_hot_news 方法
    const result = await server.getHotNews(siteIds, timeout);
    res.json(result);
  } catch (error) {
    console.error('处理请求时出错:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : '未知错误' 
    });
  }
};

// 新增：处理文章HTML代理请求（GET方式，用于webview）
const handleArticleHtmlGet: RequestHandler = async (req, res) => {
  try {
    const { url, mode } = req.query;
    
    if (!url || typeof url !== 'string') {
      console.error('无效的URL参数:', url);
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>参数错误</title></head>
        <body><h1>错误：请提供有效的URL参数</h1></body>
        </html>
      `);
      return;
    }

    // 检查显示模式，只有proxy-webview模式才进行HTML代理
    if (mode && mode !== 'proxy-webview') {
      console.log(`跳过HTML代理，当前模式: ${mode}`);
      res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>模式限制</title></head>
        <body>
          <h1>访问受限</h1>
          <p>仅proxy-webview模式支持HTML代理</p>
          <p>当前模式: ${mode}</p>
        </body>
        </html>
      `);
      return;
    }

    console.log('开始GET代理HTML页面:', url, '模式:', mode || 'proxy-webview');
    
    // 调用 MCP 服务的 getArticleHtml 方法
    const htmlContent = await server.getArticleHtml(url);
    
    console.log('GET HTML代理成功，内容长度:', htmlContent.length);
    
    // 设置正确的Content-Type
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
  } catch (error) {
    console.error('GET HTML代理时出错:', error);
    
    let errorMessage = '获取HTML页面失败';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    
    // 返回HTML格式的错误页面
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>代理错误</title>
        <style>
          body { 
            font-family: Arial, sans-serif; 
            padding: 20px; 
            text-align: center;
            background: #f5f5f5;
          }
          .error-container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            max-width: 500px;
            margin: 50px auto;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .error { color: #d73a49; margin: 20px 0; }
          .retry-btn {
            background: #0366d6;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1>⚠️ 代理服务器错误</h1>
          <p class="error">${errorMessage}</p>
          <p>无法加载请求的页面内容</p>
          <button class="retry-btn" onclick="location.reload()">重试</button>
        </div>
      </body>
      </html>
    `;
    
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8').send(errorHtml);
  }
};

// 新增：处理文章HTML代理请求
const handleArticleHtml: RequestHandler = async (req, res) => {
  try {
    console.log('接收到HTML代理请求:', req.body);
    
    const { url, mode } = req.body;
    
    if (!url || typeof url !== 'string') {
      console.error('无效的URL参数:', url);
      res.status(400).json({ error: '请提供有效的文章URL' });
      return;
    }

    // 检查显示模式，只有proxy-webview模式才进行HTML代理
    if (mode !== 'proxy-webview') {
      console.log(`跳过HTML代理，当前模式: ${mode}`);
      res.status(400).json({ 
        error: '仅proxy-webview模式支持HTML代理',
        mode: mode 
      });
      return;
    }

    console.log('开始获取HTML页面:', url, '模式:', mode);
    
    // 调用 MCP 服务的 getArticleHtml 方法
    const htmlContent = await server.getArticleHtml(url);
    
    console.log('HTML代理成功，内容长度:', htmlContent.length);
    
    // 设置正确的Content-Type
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
  } catch (error) {
    console.error('HTML代理时出错:', error);
    
    let errorMessage = '获取HTML页面失败';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (error.message.includes('timeout')) {
        errorMessage = '请求超时，请稍后重试';
      } else if (error.message.includes('Network Error')) {
        errorMessage = '网络连接失败，请检查网络设置';
      } else if (error.message.includes('404')) {
        errorMessage = '页面不存在或已被删除';
      }
    }
    
    // 返回HTML格式的错误页面
    const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>代理错误</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; text-align: center; }
          .error { color: red; }
        </style>
      </head>
      <body>
        <h1>代理服务器错误</h1>
        <p class="error">${errorMessage}</p>
        <button onclick="history.back()">返回</button>
      </body>
      </html>
    `;
    
    res.status(500).setHeader('Content-Type', 'text/html; charset=utf-8').send(errorHtml);
  }
};

// 新增：处理文章内容请求
const handleArticleContent: RequestHandler = async (req, res) => {
  try {
    console.log('接收到文章内容请求:', req.body);
    
    const { url, mode } = req.body;
    
    if (!url || typeof url !== 'string') {
      console.error('无效的URL参数:', url);
      res.status(400).json({ error: '请提供有效的文章URL' });
      return;
    }

    // 检查显示模式，只有rich-text模式才进行内容抓取
    if (mode !== 'rich-text') {
      console.log(`跳过内容抓取，当前模式: ${mode}`);
      res.status(400).json({ 
        error: '仅rich-text模式支持内容抓取',
        mode: mode 
      });
      return;
    }

    console.log('开始获取文章内容:', url, '模式:', mode);
    
    // 调用 MCP 服务的 getArticleContent 方法
    const result = await server.getArticleContent(url);
    
    console.log('文章内容获取成功:', {
      title: result.title,
      contentLength: result.content?.length || 0,
      summaryLength: result.summary?.length || 0
    });
    
    res.json(result);
  } catch (error) {
    console.error('获取文章内容时出错:', error);
    
    // 提供更详细的错误信息
    let errorMessage = '获取文章内容失败';
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // 根据不同错误类型提供不同提示
      if (error.message.includes('timeout')) {
        errorMessage = '请求超时，请稍后重试';
      } else if (error.message.includes('Network Error')) {
        errorMessage = '网络连接失败，请检查网络设置';
      } else if (error.message.includes('404')) {
        errorMessage = '文章不存在或已被删除';
      }
    }
    
    res.status(500).json({ 
      error: errorMessage,
      details: error instanceof Error ? error.message : '未知错误'
    });
  }
};

// 获取所有可用的站点列表
const handleSources: RequestHandler = (req, res) => {
  const sources = Object.entries(HOT_NEWS_SOURCES).map(([id, source]) => ({
    id: parseInt(id),
    name: source.name,
    description: source.description
  }));
  res.json(sources);
};

// 提供 MCP 客户端注入页面
const handleMcpClient: RequestHandler = (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>MCP Client</title>
    </head>
    <body>
      <script>
        // 创建MCP客户端
        window.mcp = {
          get_hot_news: async (sources) => {
            try {
              const response = await fetch('/api/hotnews', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({ sources }),
              });
              
              if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
              }
              
              const data = await response.json();
              return data;
            } catch (error) {
              console.error('MCP客户端错误:', error);
              throw error;
            }
          },
          
          get_article_content: async (url) => {
            try {
              const response = await fetch('/api/article-content', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                  'Accept': 'application/json'
                },
                body: JSON.stringify({ url }),
              });
              
              if (!response.ok) {
                throw new Error(\`HTTP error! status: \${response.status}\`);
              }
              
              const data = await response.json();
              return data;
            } catch (error) {
              console.error('获取文章内容错误:', error);
              throw error;
            }
          }
        };

        // 通知父窗口MCP客户端已就绪
        window.parent.postMessage({ type: 'MCP_READY' }, '*');
      </script>
    </body>
    </html>
  `);
};

// 健康检查端点
const handleHealth: RequestHandler = (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
};

// 清理缓存端点（调试用）
const handleClearCache: RequestHandler = (req, res) => {
  server.clearCache();
  res.json({ message: '缓存已清理', timestamp: new Date().toISOString() });
};

// 注册路由
app.post('/api/hotnews', handleHotNews);
app.post('/api/article-content', handleArticleContent); // 文章内容（rich-text）
app.post('/api/article-html', handleArticleHtml); // HTML代理（webview POST）
app.get('/api/article-html', handleArticleHtmlGet); // 新增：HTML代理（webview GET）
app.get('/api/sources', handleSources);
app.get('/mcp-client', handleMcpClient);
app.get('/health', handleHealth); // 健康检查
app.post('/admin/clear-cache', handleClearCache); // 清理缓存（管理用）

// 启动服务器
const port = process.env.PORT || 9000;
app.listen(port, () => {
  console.log(`MCP 服务运行在 http://localhost:${port}`);
  console.log('可用的端点:');
  console.log('- POST /api/hotnews - 获取热点新闻（并行请求+超时控制+缓存优化）');
  console.log('- POST /api/article-content - 获取文章内容（rich-text模式）');
  console.log('- POST /api/article-html - 获取文章HTML页面（webview代理模式）');
  console.log('- GET /api/article-html - 获取文章HTML页面（webview GET代理模式）');
  console.log('- GET /api/sources - 获取所有可用的站点列表');
  console.log('- GET /mcp-client - MCP 客户端注入页面');
  console.log('- GET /health - 健康检查');
  console.log('- POST /admin/clear-cache - 清理缓存（管理用）');
  console.log('');
  console.log('优化特性:');
  console.log('- 并行请求: 9个站点同时请求，提升响应速度');
  console.log('- 超时控制: 默认8秒超时，返回已完成的数据');
  console.log('- 智能缓存: 5分钟TTL，减少API调用频率');
  console.log('- 降级处理: 请求失败时提供占位内容');
});