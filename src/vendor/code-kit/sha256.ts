// vendored from code-kit@0.1.0, src/ts/pure/sha256.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** FIPS-180-4-SHA-256, synchron und chunk-fähig — obsidian-frei, ohne jeden Import.
 *
 *  Warum überhaupt eine eigene Implementierung: `crypto.subtle.digest` ist asynchron
 *  (zöge sich durch jede Funktion, die einen Hash braucht — bei mehreren tausend Buchungen
 *  pro Importlauf) und braucht den Puffer am Stück (bei 1,7-GB-Modelldateien unbenutzbar).
 *  Nodes `crypto` scheidet aus: der pure-Layer muss mobile-tauglich bleiben, und
 *  `import/no-nodejs-modules` verbietet es zu Recht.
 *
 *  Kanonische Quelle: `local-image-generator/src/core/sha256.ts` (2026-08-19, Commit
 *  `6076716`). Zusammengeführt mit `finance-ledger-plugin/26-011-finanzplan-plugin/
 *  src/core/hash/sha256.ts` (2026-08-03, Commit `e16b387`), aus dem der String-Wrapper
 *  (`sha256HexUtf8`) und die Begründung oben stammen.
 *
 *  ⚠️ Die beiden Quellfassungen waren **keine Kopier-Kette**, sondern zwei unabhängig
 *  geschriebene Implementierungen (16 Tage auseinander, je ein Commit, kein Herkunftsstempel
 *  auf keiner Seite). Beim Heben ins Kit gemessen: 325 Differentialfälle (16 Längen
 *  0/1/54/55/56/57/63/64/65/119/120/127/128/129/1000/65537 × 20 Zufallseingaben + 5
 *  UTF-8-Strings), diese Fassung gegen beide Quellen gegen `node:crypto` — **0 Abweichungen**.
 *  Zwei unabhängige Implementierungen, die an 325/325 Punkten mit der Referenz übereinstimmen,
 *  sind der Uniformitäts-Beleg dieses Moduls; er wäre sonst beim nächsten Audit verloren.
 *  Übernommen wurde die LIG-Fassung, weil sie streamt (64 Byte Zustand statt einer
 *  vollständigen gepolsterten Kopie der Eingabe) und dabei 5,1× schneller ist (213 vs.
 *  42 MB/s auf 64 MB; auf dem Dedupe-Profil von finance-ledger — 20 000 kleine Payloads —
 *  63 statt 98 ms). Die finance-ledger-Fassung konnte strukturell nicht streamen.
 *
 *  ⚠️ Load-bearing beim Übernehmen:
 *  - **Die Datei hat null Imports und muss sie behalten.** Vendoriert wird sie einzeln
 *    (`src/vendor/kit/sha256.ts`); ein Import auf ein Nachbarmodul macht das kaputt.
 *  - **Hex ist 64 Zeichen, Kleinschreibung**, exakt wie Pythons `hexdigest()`. finance-ledger
 *    schneidet daraus die ersten 16 Zeichen als Buchungs-Identität beim Dedupe ab: weicht
 *    das Format ab, gilt beim ersten Import nach der Umstellung **jede** bestehende Buchung
 *    als neu. Das ist keine Sicherheitsfunktion, aber eine Kompatibilitätszusage.
 *  - **`arr[i] ?? 0` statt `arr[i]!`** ist Absicht, keine Schludrigkeit: das Kit lintet mit
 *    `no-unnecessary-type-assertion` (ohne `noUncheckedIndexedAccess` ist `arr[i]` bereits
 *    `number`, das `!` also ein Fehler), die Vendoring-Ziele fahren umgekehrt
 *    `noUncheckedIndexedAccess` (dort ist `arr[i]` `number | undefined`, ein nackter Zugriff
 *    also ein Typfehler). `?? 0` ist die einzige Form, die in **beiden** Welten sauber ist
 *    (`as number` fällt unter dieselbe eslint-Regel, ein `as const`-Tupel bricht unter
 *    `noUncheckedIndexedAccess`). Der Fallback wird nie erreicht — alle Indizes sind
 *    konstruktionsbedingt im Bereich. Er kostet auch nichts: 213 MB/s mit `?? 0` gegen
 *    212 MB/s mit `!` auf 64 MB, der Unterschied liegt im Rauschen.
 *  - **Kein ES2022-only-Syntax** (keine `#`-Felder, kein `.at()`, kein `??=`): finance-ledger
 *    baut mit `target: ES2020`. */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Inkrementeller SHA-256. Hält 64 Byte Zustand und komprimiert direkt aus dem übergebenen
 *  Chunk — die Eingabe wird nie ganz im Speicher gehalten und nie kopiert (bis auf den
 *  angebrochenen Restblock < 64 Byte).
 *
 *  Lebenszyklus: beliebig oft `update()`, danach **genau einmal** `digestHex()`. Beide
 *  Verletzungen werfen (`update` nach `digest`, zweites `digest`) statt still einen falschen
 *  Wert zu liefern — ein wiederverwendetes Objekt wäre sonst eine unsichtbare Fehlerquelle.
 *  Für einen einzelnen Puffer ist `sha256Hex()` der bequemere Weg.
 *
 *  @example
 *  const h = new Sha256();
 *  for await (const chunk of stream) h.update(chunk);
 *  if (h.digestHex() !== erwartet) throw new IntegrityError(); */
export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockLen = 0;
  /** Gesamtlänge in Bytes; als zwei 32-Bit-Hälften geführt, damit Eingaben > 4 GB korrekt
   *  gepaddet werden. (Die finance-ledger-Fassung rechnete mit einem Number — korrekt bis
   *  2^53 Bit, aber nie an dieser Stelle getestet.) */
  private lenLo = 0;
  private lenHi = 0;
  private done = false;

  /** Rechnet den nächsten Abschnitt ein. Der Chunk darf beliebig lang sein, auch 0 Byte,
   *  und darf ein `subarray`-Ausschnitt mit Versatz sein — es wird relativ zum View gelesen.
   *  Der Puffer wird nur gelesen, nicht festgehalten: er darf nach der Rückkehr
   *  wiederverwendet werden.
   *
   *  @throws wenn `digestHex()` bereits abgerufen wurde. */
  update(chunk: Uint8Array): void {
    if (this.done) throw new Error("Sha256: update after digest");
    let off = 0;
    const n = chunk.length;
    // Längenzähler (Bytes) mit Übertrag ins obere Wort.
    const lo = this.lenLo + n;
    this.lenHi += Math.floor(lo / 0x100000000);
    this.lenLo = lo >>> 0;
    if (this.blockLen > 0) {
      const take = Math.min(64 - this.blockLen, n);
      this.block.set(chunk.subarray(0, take), this.blockLen);
      this.blockLen += take;
      off = take;
      if (this.blockLen === 64) {
        this.compress(this.block, 0);
        this.blockLen = 0;
      }
    }
    while (off + 64 <= n) {
      this.compress(chunk, off);
      off += 64;
    }
    if (off < n) {
      this.block.set(chunk.subarray(off), 0);
      this.blockLen = n - off;
    }
  }

  /** Schließt den Hash ab und liefert 64 Hex-Zeichen in Kleinschreibung (wie Pythons
   *  `hexdigest()`). Genau **einmal** aufrufbar.
   *
   *  @throws beim zweiten Aufruf. */
  digestHex(): string {
    if (this.done) throw new Error("Sha256: digest already taken");
    this.done = true;
    const bitLo = (this.lenLo << 3) >>> 0;
    const bitHi = ((this.lenHi << 3) | (this.lenLo >>> 29)) >>> 0;
    // Padding: 0x80, Nullen bis 56 mod 64, dann 64-Bit-Länge big-endian.
    const pad = new Uint8Array(this.blockLen < 56 ? 64 - this.blockLen : 128 - this.blockLen);
    pad[0] = 0x80;
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, bitHi);
    view.setUint32(pad.length - 4, bitLo);
    // update() würde den Längenzähler weiterzählen — deshalb hier direkt komprimieren.
    const tail = new Uint8Array(this.blockLen + pad.length);
    tail.set(this.block.subarray(0, this.blockLen), 0);
    tail.set(pad, this.blockLen);
    for (let off = 0; off < tail.length; off += 64) this.compress(tail, off);
    let hex = "";
    for (const word of this.h) hex += word.toString(16).padStart(8, "0");
    return hex;
  }

  private compress(buf: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      w[i] =
        (((buf[j] ?? 0) << 24) |
          ((buf[j + 1] ?? 0) << 16) |
          ((buf[j + 2] ?? 0) << 8) |
          (buf[j + 3] ?? 0)) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15] ?? 0;
      const y = w[i - 2] ?? 0;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    const st = this.h;
    const a0 = st[0] ?? 0, b0 = st[1] ?? 0, c0 = st[2] ?? 0, d0 = st[3] ?? 0;
    const e0 = st[4] ?? 0, f0 = st[5] ?? 0, g0 = st[6] ?? 0, h0 = st[7] ?? 0;
    let a = a0, b = b0, c = c0, d = d0;
    let e = e0, f = f0, g = g0, hh = h0;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    st[0] = (a0 + a) >>> 0; st[1] = (b0 + b) >>> 0;
    st[2] = (c0 + c) >>> 0; st[3] = (d0 + d) >>> 0;
    st[4] = (e0 + e) >>> 0; st[5] = (f0 + f) >>> 0;
    st[6] = (g0 + g) >>> 0; st[7] = (h0 + hh) >>> 0;
  }
}

/** SHA-256 über einen Puffer am Stück → 64 Hex-Zeichen (Kleinschreibung).
 *  Dünner Wrapper um {@link Sha256}; für Ströme oder sehr große Eingaben stattdessen die
 *  Klasse benutzen, damit die Daten nie ganz im Speicher liegen müssen. */
export function sha256Hex(bytes: Uint8Array): string {
  const h = new Sha256();
  h.update(bytes);
  return h.digestHex();
}

/** SHA-256 über einen String, **UTF-8**-kodiert → 64 Hex-Zeichen (Kleinschreibung).
 *  Die Kodierung ist Teil des Vertrags, nicht ein Implementierungsdetail: Umlaute zählen als
 *  zwei Byte, und das Ergebnis stimmt byte-genau mit Pythons
 *  `hashlib.sha256(s.encode()).hexdigest()` überein. */
export function sha256HexUtf8(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}
