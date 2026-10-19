// Local writes (books, profile) notify the running sync engine, which schedules a push.
let localWriteListener: (() => void) | null = null;

export function setLocalWriteListener(listener: (() => void) | null): void {
  localWriteListener = listener;
}

export function notifyLocalWrite(): void {
  localWriteListener?.();
}
