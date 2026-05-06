/* ============================================================
   public/core/events.js — cross-feature messaging (ES module).

   Thin wrappers around CustomEvent + window.addEventListener. Keeps
   event-name conventions in one place once feature modules land.

   Established names already in use:
     kt:lang-change      — fired by lang-switch.js after seamless swap.
                            detail: { lang: 'en'|'uk'|'ru' }
     kt:theme-change     — (planned) fired when ◐ button toggles.
                            detail: { theme: 'light'|'dark' }
     kt:registry-mount   — fired by registry after a module successfully
                            mounts. detail: { id }
     kt:registry-unmount — fired by registry after a module unmounts.
                            detail: { id }
     kt:inspector-ready  — fired by inspector module's mount() after the
                            locale template has been injected into
                            #app-root and legacy mountInspector() has
                            wired its handlers. Allows classic <script>
                            files (share.js, embed.js, shortcuts.js,
                            export.js) that bind to inspector-owned DOM
                            (#bidReq, #bidRes, #modalRoot…) to wait for
                            DOM availability without coupling to the
                            now-async mount() lifecycle. detail: { lang }

   Future names (Phase B+):
     kt:specimen-share   — module A → module B; payload: { specimen, source }
     kt:focus-mode       — module asks shell to hide chrome
     kt:registry-ready   — registry has registered all modules

   This file intentionally avoids inventing a new pub/sub layer; it
   keeps using the platform's CustomEvent + window event bus so any
   non-module code (inline IIFEs in <head>, third-party widgets) can
   subscribe with the same vanilla API.
   ============================================================ */

/* Dispatch a custom event on window. Default detail = undefined. */
export function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

/* Subscribe to a window-level custom event. Returns an unsubscribe
   function for ergonomic cleanup (use inside module unmount). */
export function on(name, handler) {
  window.addEventListener(name, handler);
  return () => window.removeEventListener(name, handler);
}

/* Explicit unsubscribe — for callers that prefer matching pairs over
   the on() return value. Same as removeEventListener. */
export function off(name, handler) {
  window.removeEventListener(name, handler);
}
