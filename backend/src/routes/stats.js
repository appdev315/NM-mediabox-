import express from 'express';

export const statsRouter = express.Router();

export const serverMetrics = {
    startTime: Date.now(),
    totalRequests: 0,
    successfulRequests: 0,
    errors: {
        total: 0,
        rateLimits: 0,
        notFounds: 0,
        internal: 0,
        donorBans: 0
    }
};

statsRouter.get('/api/stats', (req, res) => {
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.BOT_TOKEN_MAIN || process.env.BOT_TOKEN;
    if (authHeader !== `Bearer ${expectedToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const uptimeSec = Math.floor((Date.now() - serverMetrics.startTime) / 1000);
    const stats = {
        uptime_seconds: uptimeSec,
        metrics: serverMetrics
    };

    if (req.query.reset === 'true') {
        serverMetrics.totalRequests = 0;
        serverMetrics.successfulRequests = 0;
        serverMetrics.errors = {
            total: 0,
            rateLimits: 0,
            notFounds: 0,
            internal: 0,
            donorBans: 0
        };
    }

    res.json(stats);
});

statsRouter.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});
