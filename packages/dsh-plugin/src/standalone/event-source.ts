/** One connection per page; native EventSource keeps its reconnect behavior. */
export function createEventSubscription(url: string) {
  let source: EventSource | null = null;
  let subscribers = 0;
  return (refresh: () => void) => {
    if (!source) source = new EventSource(url);
    const current = source;
    const listener = () => refresh();
    current.addEventListener("message", listener);
    subscribers++;
    return () => {
      current.removeEventListener("message", listener);
      if (--subscribers === 0) {
        current.close();
        source = null;
      }
    };
  };
}
