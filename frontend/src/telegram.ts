// @ts-ignore
export const WebApp = window.Telegram?.WebApp || {
  ready: () => {},
  expand: () => {},
  enableClosingConfirmation: () => {},
  disableClosingConfirmation: () => {},
  initData: '',
  BackButton: { show: () => {}, hide: () => {}, onClick: () => {} },
  HapticFeedback: { notificationOccurred: () => {} },
  initDataUnsafe: { user: { first_name: 'Тест', last_name: 'Браузер' } }
};
