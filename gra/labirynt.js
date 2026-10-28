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

  /* Lista ścian jako prostokąty w płaszczyźnie XZ: budulec geometrii i kolizji. */
  sciany(cell, grubosc) {
    const t = grubosc / 2, out = [];
    const dodaj = (x0, z0, x1, z1) => out.push({ x0, z0, x1, z1 });
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const X = x * cell, Z = y * cell;
        if (this.ma(x, y, N)) dodaj(X - t, Z - t, X + cell + t, Z + t);
        if (this.ma(x, y, W)) dodaj(X - t, Z - t, X + t, Z + cell + t);
        if (y === this.h - 1 && this.ma(x, y, S)) dodaj(X - t, Z + cell - t, X + cell + t, Z + cell + t);
        if (x === this.w - 1 && this.ma(x, y, E)) dodaj(X + cell - t, Z - t, X + cell + t, Z + cell + t);
      }
    }
    return out;
  }
}
