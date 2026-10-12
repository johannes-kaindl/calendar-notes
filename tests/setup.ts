// Globaler vitest-Setup.
//
// `environment: "node"` (vitest.config.ts) kennt kein `window`. In Obsidian gibt es eines, und
// `obsidianmd/prefer-window-timers` verlangt ausdruecklich, Timer darueber zu setzen. Der Shim kommt aus dem Kit.
import { installWindowTimers } from "./vendor/kit/window-timers";

installWindowTimers();
