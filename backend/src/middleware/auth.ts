import { Context, Next } from 'hono';

async function validateTelegramWebAppData(telegramInitData: string, botToken: string): Promise<boolean> {
  const initData = new URLSearchParams(telegramInitData);
  const hash = initData.get('hash');
  
  if (!hash) return false;
  
  initData.delete('hash');
  
  const keys = Array.from(initData.keys()).sort();
  const dataCheckString = keys.map(key => `${key}=${initData.get(key)}`).join('\n');
  
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
    
  return hexSignature === hash;
}

export const tgAuthMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  
  const initData = authHeader.split(' ')[1];
  const botToken = c.env.TELEGRAM_BOT_TOKEN; 
  
  // В режиме разработки локально мы можем пропускать валидацию, если нет токена (для тестов)
  if (botToken) {
    const isValid = await validateTelegramWebAppData(initData, botToken);
    if (!isValid) {
      return c.json({ error: 'Forbidden' }, 403);
    }
  }
  
  const urlParams = new URLSearchParams(initData);
  const userString = urlParams.get('user');
  
  if (userString) {
    c.set('tgUser', JSON.parse(decodeURIComponent(userString)));
  }
  
  await next();
}
