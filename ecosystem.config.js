module.exports = {
  apps: [{
    name: 'dayizi-panel',
    cwd: '/root/panel',
    script: 'src/app.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    max_memory_restart: '1024M',
    env: {
      NODE_ENV: 'production',
      TZ: 'Asia/Shanghai',
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'data/logs/error.log',
    out_file: 'data/logs/out.log',
    merge_logs: true
  }]
};
