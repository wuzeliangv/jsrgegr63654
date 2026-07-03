const axios = require('axios');
const { execSync } = require('child_process');
const logger = require('../src/services/logger');

async function check() {
    logger.info('Starting health check...');
    try {
        const res = await axios.get('http://127.0.0.1:3000/healthz', { timeout: 5000 });
        if (res.status === 200 && res.data.status === 'ok') {
            logger.info('Panel health check passed.');
        } else {
            throw new Error(`Panel health check failed: ${res.status}`);
        }

        let processes;
        try {
            const pm2Status = execSync('pm2 jlist').toString();
            processes = JSON.parse(pm2Status);
        } catch (parseErr) {
            logger.error({ err: parseErr }, 'Failed to parse pm2 jlist output');
            return;
        }
        const panel = processes.find(p => p.name === 'vless-panel');
        if (!panel || panel.pm2_env.status !== 'online') {
            logger.warn('Panel process not online, restarting...');
            execSync('pm2 restart vless-panel');
        } else {
            logger.info('Panel process is online.');
        }
    } catch (err) {
        logger.error({ err }, 'Health check failed');
        try {
            execSync('pm2 restart vless-panel');
            logger.warn('Emergency restart executed.');
        } catch (restartErr) {
            logger.error({ err: restartErr }, 'Emergency restart failed');
        }
    }
}

check();
