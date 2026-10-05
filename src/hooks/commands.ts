import { useEffect, useRef } from "react";

/** Commands that the app shell (keyboard shortcuts, command palette) sends to whichever view is open. */
export type Cmd = "scan" | "select-all" | "escape" | "delete" | "storage-map" | "focus-search";

let pending: Cmd | null = null;

export function emitCmd(cmd: Cmd) {
  pending = cmd;
  window.dispatchEvent(new CustomEvent<Cmd>("dc:cmd", { detail: cmd }));
}

/** Handle commands while mounted. A command sent just before this view mounted is delivered on mount. */
export function useCmd(handler: (cmd: Cmd) => boolean | void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: Event) => {
      const handled = ref.current((e as CustomEvent<Cmd>).detail);
      if (handled !== false && pending === (e as CustomEvent<Cmd>).detail) pending = null;
    };
    window.addEventListener("dc:cmd", on);
    if (pending) { const c = pending; pending = null; setTimeout(() => ref.current(c), 0); }
    return () => window.removeEventListener("dc:cmd", on);
  }, []);
}
