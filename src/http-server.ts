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

    // 调用 MCP 服务的 get_hot_news 方法
    const result = await server.getHotNews(siteIds);
    res.json(result);
  } catch (error) {
    console.error('处理请求时出错:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : '未知错误' 
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
          }
        };
        
        // 通知父窗口MCP客户端已就绪
        window.parent.postMessage({ type: 'MCP_READY' }, '*');
      </script>
    </body>
    </html>
  `);
};

// 注册路由
app.post('/api/hotnews', handleHotNews);
app.get('/api/sources', handleSources);
app.get('/mcp-client', handleMcpClient);

// 启动服务器
const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`MCP 服务运行在 http://localhost:${port}`);
  console.log('可用的端点:');
  console.log('- POST /api/hotnews - 获取热点新闻');
  console.log('- GET /api/sources - 获取所有可用的站点列表');
  console.log('- GET /mcp-client - MCP 客户端注入页面');
}); 