import { AppleMusic } from '../components/AppleMusic';

export function Music() {
  return (
    <div 
      className="p-4 flex flex-col gap-4 max-w-7xl mx-auto w-full min-h-screen"
      style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top, 1rem))' }}
    >
      <AppleMusic />
    </div>
  );
}
