// 알림 (오른쪽 아래 · 잠깐). 틀(App)이 ToastProvider 를 한 번 깔고, 기능 hooks 는 useToast() 로 한 줄을 올린다
import { createContext, useContext, type ReactNode } from 'react';
import { ToastRegion, useToastQueue, type ToastItem } from '@brewai/ui';
import { COMMON_COPY } from './copy';

type Push = (t: Omit<ToastItem, 'id'>) => void;
const ToastContext = createContext<Push>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, push, dismiss } = useToastQueue();
  return (
    <ToastContext.Provider value={push}>
      {children}
      <ToastRegion toasts={toasts} onDismiss={dismiss} label={COMMON_COPY.toasts} />
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
