// Minimal render helper -- @testing-library/react is not installed (and fork-prep froze the
// lockfile), so component tests drive react-dom/client directly under jsdom. React 19 exports
// `act` from "react".

import { act } from "react";
import { type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

/* eslint-disable @typescript-eslint/no-explicit-any */

// react-dom's act() checks this flag.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  container: HTMLElement;
  root: Root;
  unmount(): void;
  /** run a mutation and flush effects */
  act(fn: () => void): void;
  /** flush pending promise jobs + effects (for async handlers) */
  flush(): Promise<void>;
}

export function mount(el: ReactElement): Mounted {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    root,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
    act(fn: () => void) {
      act(fn);
    },
    async flush() {
      // two rounds covers promise -> setState -> effect chains
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    },
  };
}

/** Fire a native input event after setting `.value` (React listens on the bubbled event). */
export function setInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

export function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
