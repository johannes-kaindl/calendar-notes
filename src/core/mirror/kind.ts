/**
 * Erzwingt eine erschoepfende Fallunterscheidung ueber `ProfileKind`. Wird der Union-Typ
 * erweitert, meldet der Compiler JEDE Stelle, die den neuen Fall nicht behandelt — statt sie
 * still in den letzten else-Zweig laufen zu lassen (Lesson _docs/LESSONS.md 2026-08-08).
 *
 * Der Laufzeit-Wurf ist die zweite Haelfte: Profile kommen aus `data.json` und koennen einen
 * Wert tragen, den der Typ ausschliesst. Dann ist ein lauter Fehler richtig — eine Notiz nach
 * dem falschen Schema zu schreiben waere der teurere Ausgang.
 */
export function assertNever(x: never, hinweis: string): never {
  throw new Error(`${hinweis}: unbehandelte Profilsorte ${String(x)}`);
}

/**
 * Fuer Stellen, die eine Profilsorte KENNEN, aber (noch) nicht bedienen. Nimmt bewusst
 * `ProfileKind` statt `never`: `assertNever` verlangt, dass der Typ an der Aufrufstelle
 * erschoepft IST — sobald der Union-Typ waechst, ist er das dort nicht mehr, und der Aufruf
 * waere selbst ein Typfehler.
 *
 * Ein Wurf ist hier richtig: die Alternative waere, still in den Nachbarzweig zu laufen und
 * eine Notiz nach dem falschen Schema zu schreiben.
 */
export function nichtUnterstuetzt(kind: string, hinweis: string): never {
  throw new Error(`${hinweis}: Profilsorte ${kind} wird hier noch nicht unterstuetzt`);
}
