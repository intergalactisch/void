// The capture window is a thin UI surface that does NOT bootstrap the full
// app — it talks to the main window via Tauri events. Prerender so Tauri
// loads `build/capture/index.html` directly. Trailing slash is required so
// the static adapter emits the route as a directory + index.html (otherwise
// it would emit `build/capture.html`, which Tauri's asset URL `/capture`
// can't resolve in production).
export const prerender = true;
export const ssr = false;
export const trailingSlash = 'always';
