import type { Context } from 'hono';

export type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  BOT_TOKEN_MAIN?: string;
  BOT_TOKEN?: string;
  BOT_TOKEN_ADULT?: string;
  ALLOWED_ORIGIN?: string;
  TMDB_API_KEY?: string;
  HF_BACKEND_URL?: string;
  ADMIN_API_KEY?: string;
  SAAVN_API_BASES?: string;
};

export type Variables = {
  tgUser?: { id: number; first_name: string; username?: string };
  country: string;
  sessionId: string;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};

export type AppContext = Context<AppEnv>;

export interface AnalyticsEvent {
  event_type: string;
  country?: string;
  user_id?: number | null;
  session_id?: string;
  item_type?: string;
  item_title?: string;
  item_id?: string;
  meta?: string;
}
