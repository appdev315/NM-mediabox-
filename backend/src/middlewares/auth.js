import crypto from 'crypto';

export function verifyTelegramWebAppData(initData) {
    const BOT_TOKEN_MAIN = process.env.BOT_TOKEN_MAIN || process.env.BOT_TOKEN;
    const BOT_TOKEN_ADULT = process.env.BOT_TOKEN_ADULT;

    if (!BOT_TOKEN_MAIN && !BOT_TOKEN_ADULT) {
        throw new Error('Missing BOT_TOKENs');
    }

    const q = new URLSearchParams(initData);
    const hash = q.get('hash');
    q.delete('hash');

    const keys = Array.from(q.keys());
    keys.sort();
    const dataCheckString = keys.map(k => `${k}=${q.get(k)}`).join('\n');

    const validateToken = (token) => {
        if (!token) return false;
        const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
        const hmac = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
        return hmac === hash;
    };

    let matchedToken = null;
    let isAdultBot = false;

    if (validateToken(BOT_TOKEN_MAIN)) {
        matchedToken = BOT_TOKEN_MAIN;
    } else if (validateToken(BOT_TOKEN_ADULT)) {
        matchedToken = BOT_TOKEN_ADULT;
        isAdultBot = true;
    }

    if (!matchedToken) {
        return null; // Invalid signature
    }

    const userJson = q.get('user');
    if (!userJson) return null;

    return {
        user: JSON.parse(userJson),
        botToken: matchedToken,
        isAdultBot
    };
}

export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('tma ')) {
        return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
    }

    const initData = authHeader.substring(4);
    if (!initData) {
        return res.status(401).json({ error: 'Unauthorized: Empty token data' });
    }

    try {
        const authData = verifyTelegramWebAppData(initData);
        if (!authData) {
            return res.status(401).json({ error: 'Unauthorized: Invalid signature' });
        }

        req.user = authData.user;
        req.botToken = authData.botToken;
        req.isAdultBot = authData.isAdultBot;
        next();
    } catch (e) {
        if (e.message === 'Missing BOT_TOKENs') {
            return res.status(500).json({ error: 'Server configuration error' });
        }
        return res.status(401).json({ error: 'Unauthorized: Token parsing failed' });
    }
}

export async function checkAdultAccess(req, res, next) {
    // App is now completely free, no VIP check required
    return next();
}
