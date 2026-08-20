type RefreshHandler = () => void;

const handlers = new Map<string, Set<RefreshHandler>>();

export function subscribeTabRefresh(tab: string, handler: RefreshHandler): () => void {
  let set = handlers.get(tab);
  if (!set) {
    set = new Set();
    handlers.set(tab, set);
  }
  set.add(handler);
  return () => {
    set?.delete(handler);
  };
}

export function emitTabRefresh(tab: string): void {
  const set = handlers.get(tab);
  if (!set) return;
  set.forEach((handler) => handler());
}
