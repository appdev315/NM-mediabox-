// @ts-ignore
export const WebApp = window.Telegram?.WebApp || {
  ready: () => {},
  expand: () => {},
  enableClosingConfirmation: () => {},
  disableClosingConfirmation: () => {},
  initData: '',
  BackButton: { show: () => {}, hide: () => {}, onClick: (_fn: any) => {}, offClick: (_fn: any) => {} },
  HapticFeedback: { notificationOccurred: () => {}, impactOccurred: () => {} },
  initDataUnsafe: { user: { first_name: 'Тест', last_name: 'Браузер' } },
  platform: 'unknown'
};
