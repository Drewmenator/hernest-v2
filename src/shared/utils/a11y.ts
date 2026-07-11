// ─── Accessibility helpers ───────────────────────────────────────────
// Many tappable elements are styled <div onClick> (converting them to <button>
// would fight their custom layout). This retrofits keyboard + screen-reader
// support without touching styles: add role="button", tabIndex={0}, and this
// onKeyDown so Enter/Space activate them. It fires the element's own onClick via
// .click(), so inline handlers work unchanged.
import type { KeyboardEvent } from "react";

export function onEnterSpace(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    (e.currentTarget as HTMLElement).click();
  }
}
