/* Labirynt na siatce. Ściany trzymane jako bity w komórce:
   1 = północ (z-), 2 = wschód (x+), 4 = południe (z+), 8 = zachód (x-)  */

export const N = 1, E = 2, S = 4, W = 8;
const PRZECIWNA = { 1: 4, 2: 8, 4: 1, 8: 2 };
const KROK = { 1: [0, -1], 2: [1, 0], 4: [0, 1], 8: [-1, 0] };

/* Deterministyczny generator losowy: ten sam numer daje ten sam labirynt,
   dzięki czemu da się odtworzyć poziom przy testach i po powrocie na piętro. */
export function losowanie(ziarno) {
  let s = ziarno >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

export class Labirynt {
  constructor(w, h, ziarno = 1) {
    this.w = w; this.h = h;
    this.kom = new Uint8Array(w * h).fill(N | E | S | W);
    this.rnd = losowanie(ziarno);
    this.#drazenie();
  }

  idx(x, y) { return y * this.w + x; }
  w_srodku(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  ma(x, y, kier) { return (this.kom[this.idx(x, y)] & kier) !== 0; }

  usun(x, y, kier) {
    const [dx, dy] = KROK[kier], nx = x + dx, ny = y + dy;
    if (!this.w_srodku(nx, ny)) return;
    this.kom[this.idx(x, y)] &= ~kier;
    this.kom[this.idx(nx, ny)] &= ~PRZECIWNA[kier];
  }

  /* rekurencyjny backtracker na jawnym stosie */
  #drazenie() {
    const odw = new Uint8Array(this.w * this.h);
    const stos = [[0, 0]];
    odw[0] = 1;
    while (stos.length) {
      const [x, y] = stos[stos.length - 1];
      const chetne = [];
      for (const k of [N, E, S, W]) {
        const [dx, dy] = KROK[k], nx = x + dx, ny = y + dy;
        if (this.w_srodku(nx, ny) && !odw[this.idx(nx, ny)]) chetne.push(k);
      }
      if (!chetne.length) { stos.pop(); continue; }
      const k = chetne[Math.floor(this.rnd() * chetne.length)];
      const [dx, dy] = KROK[k];
      this.usun(x, y, k);
      odw[this.idx(x + dx, y + dy)] = 1;
      stos.push([x + dx, y + dy]);
    }
  }

  /* Idealny labirynt ma jedną drogę między każdą parą pól, przez co jest nudny w chodzeniu
     i trywialny dla pościgu. Rozplatamy część ślepych uliczek. */
  rozplec(udzial = 0.4) {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.kom[this.idx(x, y)];
        const ile = [N, E, S, W].filter(k => c & k).length;
        if (ile < 3 || this.rnd() > udzial) continue;
        const mozliwe = [N, E, S, W].filter(k => {
          if (!(c & k)) return false;
          const [dx, dy] = KROK[k];
          return this.w_srodku(x + dx, y + dy);
        });
        if (mozliwe.length) this.usun(x, y, mozliwe[Math.floor(this.rnd() * mozliwe.length)]);
      }
    }
  }

  /* Odległości (w krokach) od zadanego pola, z uwzględnieniem ścian.
     Służy do stawiania celów daleko od startu i do pościgu. */
  odleglosci(sx, sy) {
    const d = new Int32Array(this.w * this.h).fill(-1);
    d[this.idx(sx, sy)] = 0;
    const kolejka = [[sx, sy]];
    for (let i = 0; i < kolejka.length; i++) {
      const [x, y] = kolejka[i], tu = d[this.idx(x, y)];
      for (const k of [N, E, S, W]) {
        if (this.ma(x, y, k)) continue;
        const [dx, dy] = KROK[k], nx = x + dx, ny = y + dy;
        if (!this.w_srodku(nx, ny) || d[this.idx(nx, ny)] >= 0) continue;
        d[this.idx(nx, ny)] = tu + 1;
        kolejka.push([nx, ny]);
      }
    }
    return d;
  }

  /* Pierwszy krok najkrótszej drogi z (x,y) do celu; pościg używa tego
     zamiast pełnego szukania ścieżki w każdej klatce. */
  krok_do(x, y, polaOdleglosci) {
    let naj = null, najd = polaOdleglosci[this.idx(x, y)];
    for (const k of [N, E, S, W]) {
      if (this.ma(x, y, k)) continue;
      const [dx, dy] = KROK[k], nx = x + dx, ny = y + dy;
      if (!this.w_srodku(nx, ny)) continue;
      const d = polaOdleglosci[this.idx(nx, ny)];
      if (d >= 0 && d < najd) { najd = d; naj = [nx, ny]; }
    }
    return naj;
  }

  /* Lista ścian jako prostokąty w płaszczyźnie XZ: budulec geometrii i kolizji.
     `pomin` wyjmuje pojedyncze segmenty, w których ma stanąć przejście. */
  sciany(cell, grubosc, pomin = []) {
    const t = grubosc / 2, out = [];
    const klucz = (x, y, k) => x + ':' + y + ':' + k;
    const pominiete = new Set(pomin.map(p => klucz(p.x, p.y, p.kier)));
    const dodaj = (x0, z0, x1, z1) => out.push({ x0, z0, x1, z1 });
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const X = x * cell, Z = y * cell;
        if (this.ma(x, y, N) && !pominiete.has(klucz(x, y, N))) dodaj(X - t, Z - t, X + cell + t, Z + t);
        if (this.ma(x, y, W) && !pominiete.has(klucz(x, y, W))) dodaj(X - t, Z - t, X + t, Z + cell + t);
        if (y === this.h - 1 && this.ma(x, y, S) && !pominiete.has(klucz(x, y, S)))
          dodaj(X - t, Z + cell - t, X + cell + t, Z + cell + t);
        if (x === this.w - 1 && this.ma(x, y, E) && !pominiete.has(klucz(x, y, E)))
          dodaj(X + cell - t, Z - t, X + cell + t, Z + cell + t);
      }
    }
    return out;
  }

  /* Czy z pola A widać pole B. Celowo tylko wzdłuż korytarza: w tę samą
     kolumnę albo ten sam rząd i bez ściany po drodze. Dzięki temu zasada
     jest dla gracza czytelna, a nie zależy od ułamka stopnia obrotu. */
  widacSie(ax, ay, bx, by, zasieg = 6) {
    if (ax === bx) {
      if (Math.abs(by - ay) > zasieg) return false;
      const krok = by > ay ? 1 : -1, kier = krok > 0 ? S : N;
      for (let y = ay; y !== by; y += krok) if (this.ma(ax, y, kier)) return false;
      return true;
    }
    if (ay === by) {
      if (Math.abs(bx - ax) > zasieg) return false;
      const krok = bx > ax ? 1 : -1, kier = krok > 0 ? E : W;
      for (let x = ax; x !== bx; x += krok) if (this.ma(x, ay, kier)) return false;
      return true;
    }
    return false;
  }

  /* Losowe osiągalne pole oddalone o co najmniej `min` kroków od podanego. */
  losoweDaleko(sx, sy, min = 8) {
    const d = this.odleglosci(sx, sy);
    const chetne = [];
    for (let i = 0; i < d.length; i++) if (d[i] >= min) chetne.push(i);
    if (!chetne.length) return null;
    const i = chetne[Math.floor(this.rnd() * chetne.length)];
    return { x: i % this.w, y: Math.floor(i / this.w) };
  }

  /* Otwarte komnaty: wybite bloki bez ścian wewnętrznych. Bez nich całość
     jest równą siatką jednokomórkowych korytarzy i czyta się jak krata,
     a nie jak budynek z salami i zaułkami. */
  wykujKomnaty(ile = 4, maxBok = 3) {
    const komnaty = [];
    for (let proba = 0, zrobione = 0; proba < ile * 14 && zrobione < ile; proba++) {
      const kw = 2 + Math.floor(this.rnd() * (maxBok - 1));
      const kh = 2 + Math.floor(this.rnd() * (maxBok - 1));
      const x0 = 1 + Math.floor(this.rnd() * (this.w - kw - 2));
      const y0 = 1 + Math.floor(this.rnd() * (this.h - kh - 2));
      // komnaty nie mogą na siebie nachodzić ani się stykać
      if (komnaty.some(k => x0 < k.x1 + 1 && x0 + kw > k.x0 - 1 &&
                            y0 < k.y1 + 1 && y0 + kh > k.y0 - 1)) continue;
      for (let y = y0; y < y0 + kh; y++) {
        for (let x = x0; x < x0 + kw; x++) {
          if (x < x0 + kw - 1) this.usun(x, y, E);
          if (y < y0 + kh - 1) this.usun(x, y, S);
        }
      }
      komnaty.push({ x0, y0, x1: x0 + kw - 1, y1: y0 + kh - 1 });
      zrobione++;
    }
    this.komnaty = komnaty;
    return komnaty;
  }

  /* Ile pól jest ślepych uliczkami (do kontroli, czy zaułki w ogóle zostały). */
  ileSlepych() {
    let n = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.kom[this.idx(x, y)];
      if ([N, E, S, W].filter(k => c & k).length === 3) n++;
    }
    return n;
  }

  /* Ile par sąsiadów ma przejście (miara gęstości połączeń). */
  ilePrzejsc() {
    let n = 0;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (!this.ma(x, y, E) && x < this.w - 1) n++;
      if (!this.ma(x, y, S) && y < this.h - 1) n++;
    }
    return n;
  }

  /* Najdalsze od startu pole, które ma ścianę na zewnętrznym murze:
     tam stawiamy wyjście, żeby droga do niego była najdłuższa z możliwych. */
  najdalszeNaObrzezu(sx = 0, sy = 0) {
    const d = this.odleglosci(sx, sy);
    let naj = null, najd = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const dist = d[this.idx(x, y)];
        if (dist <= najd) continue;
        const strony = [];
        if (y === 0)          strony.push(N);
        if (y === this.h - 1) strony.push(S);
        if (x === 0)          strony.push(W);
        if (x === this.w - 1) strony.push(E);
        if (!strony.length) continue;
        najd = dist;
        naj = { x, y, kier: strony[0], dystans: dist };
      }
    }
    return naj;
  }
}
