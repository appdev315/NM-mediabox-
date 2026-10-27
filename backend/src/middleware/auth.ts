import { Context, Next } from 'hono';

const MAX_AUTH_AGE_MS = 24 * 60 * 60 * 1000;

async function validateTelegramWebAppData(telegramInitData: string, botToken: string): Promise<boolean> {
  const initData = new URLSearchParams(telegramInitData);
  const hash = initData.get('hash');
  
  if (!hash) return false;

  const authDateStr = initData.get('auth_date');
  if (authDateStr) {
    const authDate = parseInt(authDateStr, 10);
    if (!isNaN(authDate)) {
      const authTimestamp = authDate * 1000;
      const age = Date.now() - authTimestamp;
      if (age > MAX_AUTH_AGE_MS || age < -60_000) return false;
    }
  }
  
  initData.delete('hash');
  
  const keys: string[] = [];
  initData.forEach((_, key) => {
    if (!keys.includes(key)) keys.push(key);
  });
  keys.sort();
  const dataCheckString = keys.map(key => `${key}=${initData.get(key) || ''}`).join('\n');
  
  const encoder = new TextEncoder();
  const secretKeyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const secretKey = await crypto.subtle.sign('HMAC', secretKeyMaterial, encoder.encode(botToken));
  
  const signatureKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', signatureKey, encoder.encode(dataCheckString));
  
  const hexSignature = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  const expectedHash = hash;
  if (hexSignature.length !== expectedHash.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < hexSignature.length; i++) {
    result |= hexSignature.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  }
  return result === 0;
}

export const tgAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const initData = authHeader.split(' ')[1];
  const botTokenMain = (c.env as any).TELEGRAM_BOT_TOKEN || (c.env as any).BOT_TOKEN_MAIN || (c.env as any).BOT_TOKEN || '';
  const botTokenAdult = (c.env as any).BOT_TOKEN_ADULT || '';

  if (!botTokenMain && !botTokenAdult) {
    return c.json({ error: 'Server misconfigured: BOT_TOKEN not set' }, 500);
  }

  let isValid = false;
  if (botTokenMain && (await validateTelegramWebAppData(initData, botTokenMain))) {
    isValid = true;
  } else if (botTokenAdult && (await validateTelegramWebAppData(initData, botTokenAdult))) {
    isValid = true;
  }

  if (!isValid) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  
  if (userString) {
    try {
      c.set('tgUser', JSON.parse(userString));
    } catch (e) {
      console.error('Failed to parse user data:', e);
    }
  }
  
  await next();
}
