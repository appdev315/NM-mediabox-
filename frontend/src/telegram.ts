// @ts-ignore
const tgWindow = typeof window !== 'undefined' ? (window as any).Telegram?.WebApp : undefined;
export const WebApp = tgWindow || {
  ready: () => {},
  expand: () => {},
  enableClosingConfirmation: () => {},
  disableClosingConfirmation: () => {},
  disableVerticalSwipes: () => {},
  enableVerticalSwipes: () => {},
  initData: '',
  BackButton: { show: () => {}, hide: () => {}, onClick: (_fn: any) => {}, offClick: (_fn: any) => {} },
  HapticFeedback: { notificationOccurred: () => {}, impactOccurred: () => {}, selectionChanged: () => {} },
  initDataUnsafe: { user: { first_name: 'Тест', last_name: 'Браузер' } },
  platform: 'unknown'
};
