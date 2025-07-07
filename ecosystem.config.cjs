module.exports = {
  apps: [
    {
      name: 'hotnews-server',
      script: 'build/http-server.js',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'production',
        PORT: 3001 // 腾讯云默认HTTP端口
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      autorestart: true
    }
  ]
};