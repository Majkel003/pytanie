import * as THREE from './lib/three.module.js?v=1793185281';
import { Postac, wczytajSprite } from './postacie.js?v=1793185281';
import { CELL } from './gra.js?v=1793185281';

/* Logika świata: kto gdzie stoi, kto za kim chodzi, kiedy otwiera się wyjście.
   Silnik (gra.js) nie wie nic o fabule, a to tutaj nie dotyka renderowania. */

const ZAPIS = 'labirynt-postep-v1';

/* ───────── poruszanie się po siatce ─────────
   Postać celuje w środek kolejnej komórki na najkrótszej drodze.
   Pole odległości liczone jest raz na cel, nie co klatkę.        */
class Ruch {
  constructor(lab, x, z) {
    this.lab = lab;
    this.poz = new THREE.Vector2(x, z);
    this.cel = null;
    this.pole = null;
    this.nastepna = null;
  }

  get komorka() {
    return [Math.floor(this.poz.x / CELL), Math.floor(this.poz.y / CELL)];
  }

  ustawCel(cx, cy) {
    if (this.cel && this.cel[0] === cx && this.cel[1] === cy) return;
    this.cel = [cx, cy];
    this.pole = this.lab.odleglosci(cx, cy);
    this.nastepna = null;
  }

  /* zwraca true, gdy doszła do celu */
  krok(dt, predkosc) {
    if (!this.pole) return true;
    const [cx, cy] = this.komorka;
    if (this.cel && cx === this.cel[0] && cy === this.cel[1]) return true;

    if (!this.nastepna) {
      const n = this.lab.krok_do(cx, cy, this.pole);
      if (!n) return true;
      this.nastepna = n;
    }
    const tx = this.nastepna[0] * CELL + CELL / 2;
    const tz = this.nastepna[1] * CELL + CELL / 2;
    const dx = tx - this.poz.x, dz = tz - this.poz.y;
    const d = Math.hypot(dx, dz);
    const krok = predkosc * dt;
    if (d <= krok) {
      this.poz.set(tx, tz);
      this.nastepna = null;
    } else {
      this.poz.x += dx / d * krok;
      this.poz.y += dz / d * krok;
    }
    this.kierunek = Math.atan2(dx, dz);
    return false;
  }
}

export class Swiat {
  constructor(gra, dzwiek, ui) {
    this.gra = gra;
    this.dzwiek = dzwiek;
    this.ui = ui;
    this.postacie = [];
    this.stan = 'szukanie';        // szukanie -> zFenkiem -> wyszli
    this.fenekZabrany = false;
    this.czas = 0;
    this.zgony = 0;
    this.naZdarzenie = null;        // podpinane przez index.html
  }

  /* ───────── wczytanie wycinanek ───────── */
  async zaladuj() {
    const [wika, fenek, remcioszek, programista] = await Promise.all([
      wczytajSprite('postacie/wika.png'),
      wczytajSprite('postacie/fenek.png'),
      wczytajSprite('postacie/remcioszek.png'),
      wczytajSprite('postacie/programista.png')
    ]);
    this.sprite = { wika, fenek, remcioszek, programista };
  }

  /* ───────── rozstawienie na nowo ─────────
     Labirynt zostaje ten sam, losuje się tylko to, co w nim stoi i chodzi. */
  rozpocznij() {
    const { gra } = this;
    const lab = gra.lab;
    this.usunPostacie();

    const [sx, sy] = [0, 0];
    const doWyjscia = gra.wyjscie
      ? lab.odleglosci(gra.wyjscie.x, gra.wyjscie.y)
      : lab.odleglosci(lab.w - 1, lab.h - 1);
    const odStartu = lab.odleglosci(sx, sy);

    // Fenek: daleko od startu i nie tuż przy drzwiach, żeby droga powrotna
    // też była kawałkiem gry. Losujemy spośród kilku najlepszych miejsc,
    // żeby kolejne podejście nie było przepisaniem poprzedniego.
    const kandydaci = [];
    for (let y = 0; y < lab.h; y++) for (let x = 0; x < lab.w; x++) {
      const i = y * lab.w + x;
      if (odStartu[i] < 10 || doWyjscia[i] < 8) continue;
      kandydaci.push({ x, y, wynik: Math.min(odStartu[i], doWyjscia[i]) });
    }
    kandydaci.sort((a, b) => b.wynik - a.wynik);
    const pula = kandydaci.slice(0, Math.max(1, Math.min(8, kandydaci.length)));
    const wybor = pula.length ? pula[Math.floor(Math.random() * pula.length)] : null;
    const [fx, fy] = wybor ? [wybor.x, wybor.y] : [lab.w - 2, lab.h - 2];

    this.fenek = new Postac(gra.scena, this.sprite.fenek, { wysokosc: 1.8, nazwa: 'Fenek' });
    this.fenek.ustaw(fx * CELL + CELL / 2, fy * CELL + CELL / 2);
    this.fenekRuch = new Ruch(lab, fx * CELL + CELL / 2, fy * CELL + CELL / 2);
    this.postacie.push(this.fenek);
    this.fenekZabrany = false;

    // programista: gdzieś po drodze, nieruchomy, od gadania
    const pr = lab.losoweDaleko(sx, sy, 6);
    this.programista = new Postac(gra.scena, this.sprite.programista,
      { wysokosc: 1.74, nazwa: 'Programista' });
    this.programista.ustaw(pr.x * CELL + CELL / 2, pr.y * CELL + CELL / 2);
    this.postacie.push(this.programista);

    // Remcioszek: start daleko od gracza, trasa losowana za każdym razem
    const rm = lab.losoweDaleko(sx, sy, 14) || { x: lab.w - 1, y: lab.h - 1 };
    this.remcioszek = new Postac(gra.scena, this.sprite.remcioszek,
      { wysokosc: 1.95, nazwa: 'Remcioszek', kolysanie: 1.8 });
    this.remcioszek.ustaw(rm.x * CELL + CELL / 2, rm.y * CELL + CELL / 2);
    this.remRuch = new Ruch(lab, rm.x * CELL + CELL / 2, rm.y * CELL + CELL / 2);
    this.remStan = 'blada';
    this.remBezTropu = 0;
    this.postacie.push(this.remcioszek);

    // tęczowe światło: nie rzucamy cieni, więc łuna sama wychodzi zza rogu
    this.tecza = new THREE.PointLight(0xff00ff, 16, 26, 1.5);
    this.tecza.position.set(this.remRuch.poz.x, 1.7, this.remRuch.poz.y);
    gra.scena.add(this.tecza);

    this.znacznikiNaMapie();
    this.stan = 'szukanie';
    this.ui.cel('Znajdź Fenka');
  }

  znacznikiNaMapie() {
    const g = this.gra;
    g.znaczniki = [];
    if (g.wyjscie) g.znaczniki.push({ x: g.wyjscie.x, y: g.wyjscie.y, kolor: '#e4c47a' });
  }

  usunPostacie() {
    for (const p of this.postacie) p.usun();
    this.postacie = [];
    if (this.tecza) { this.gra.scena.remove(this.tecza); this.tecza = null; }
  }

  /* ───────── odległość gracza do punktu w świecie ───────── */
  #odleglosc(p) {
    return Math.hypot(this.gra.pozycja.x - p.x, this.gra.pozycja.z - p.z);
  }

  /* ───────── klatka ───────── */
  tik(dt) {
    this.czas += dt;
    const g = this.gra;
    if (g.zamrozony) return;

    for (const p of this.postacie) p.patrzNa(g.kamera, this.czas, dt);

    this.#remcioszek(dt);
    this.#fenek(dt);
    this.#podpowiedzi();
  }

  /* ───────── Remcioszek ───────── */
  #remcioszek(dt) {
    if (this.pauzaRemcioszka) return;
    const g = this.gra, lab = g.lab;
    const [gx, gy] = g.komorka();
    const [rx, ry] = this.remRuch.komorka;
    const odl = this.#odleglosc(this.remcioszek.pozycja);

    const widzi = lab.widacSie(rx, ry, gx, gy, 6);
    const slyszy = odl < CELL * 2.2;

    if (this.remStan === 'blada') {
      if (widzi || slyszy) {
        this.remStan = 'goni';
        this.remBezTropu = 0;
        this.dzwiek?.zamek();
        this.naZdarzenie?.('zauwazyl');
      } else if (this.remRuch.krok(dt, 2.2)) {
        const cel = lab.losoweDaleko(rx, ry, 6);
        if (cel) this.remRuch.ustawCel(cel.x, cel.y);
      }
    }

    if (this.remStan === 'goni') {
      this.remRuch.ustawCel(gx, gy);
      this.remRuch.krok(dt, 3.5);
      if (!widzi && odl > CELL * 3) {
        this.remBezTropu += dt;
        if (this.remBezTropu > 6) {
          this.remStan = 'blada';
          const cel = lab.losoweDaleko(rx, ry, 6);
          if (cel) this.remRuch.ustawCel(cel.x, cel.y);
        }
      } else this.remBezTropu = 0;

      if (odl < 1.1) { this.naZdarzenie?.('zlapana'); return; }
    }

    this.remcioszek.ustaw(this.remRuch.poz.x, this.remRuch.poz.y);

    // światło: barwa przewija się w kółko, jasność rośnie przy zbliżaniu
    const odcien = (this.czas * 0.22) % 1;
    this.tecza.color.setHSL(odcien, 0.95, 0.56);
    const blisko = Math.max(0, 1 - odl / (CELL * 7));
    this.tecza.intensity = 9 + blisko * 34 + (this.remStan === 'goni' ? 14 : 0);
    this.tecza.position.set(this.remRuch.poz.x, 1.7, this.remRuch.poz.y);

    this.dzwiek?.napiecie(this.remStan === 'goni'
      ? Math.min(1, 0.45 + blisko) : blisko * 0.5);
  }

  /* ───────── Fenek ───────── */
  #fenek(dt) {
    if (!this.fenekZabrany) return;
    const g = this.gra;
    const [gx, gy] = g.komorka();
    const odl = this.#odleglosc(this.fenek.pozycja);

    // Zgubiony towarzysz psuje całą scenę końcową, więc im dalej zostaje,
    // tym szybciej biegnie, a przy całkiem utraconym kontakcie dochodzi
    // zza rogu: wraca do komórki tuż za graczem, poza jego polem widzenia.
    if (odl > CELL * 9) {
      const lab = g.lab;
      const pole = lab.odleglosci(gx, gy);
      let najlepsza = null, najlepszy = 99;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = gx + dx, ny = gy + dy;
        if (!lab.w_srodku(nx, ny)) continue;
        const d = pole[ny * lab.w + nx];
        if (d === 1 && d < najlepszy) { najlepszy = d; najlepsza = [nx, ny]; }
      }
      const [tx, ty] = najlepsza || [gx, gy];
      this.fenekRuch.poz.set(tx * CELL + CELL / 2, ty * CELL + CELL / 2);
      this.fenekRuch.cel = null; this.fenekRuch.nastepna = null;
      this.fenek.ustaw(this.fenekRuch.poz.x, this.fenekRuch.poz.y);
      return;
    }

    if (odl > CELL * 1.3) {
      const predkosc = odl > CELL * 4 ? 6.4 : odl > CELL * 2.2 ? 4.8 : 3.4;
      this.fenekRuch.ustawCel(gx, gy);
      this.fenekRuch.krok(dt, predkosc);
      this.fenek.ustaw(this.fenekRuch.poz.x, this.fenekRuch.poz.y);
    }
  }

  /* ───────── podpowiedzi przy obiektach ───────── */
  #podpowiedzi() {
    const g = this.gra;
    if (!this.fenekZabrany && this.#odleglosc(this.fenek.pozycja) < 2.6) {
      this.ui.podpowiedz('Uprowadź go ze sobą');
      this.przyFenku = true;
      return;
    }
    this.przyFenku = false;

    if (this.#odleglosc(this.programista.pozycja) < 2.6) {
      this.ui.podpowiedz('Zagadaj');
      this.przyProgramiscie = true;
      return;
    }
    this.przyProgramiscie = false;

    if (this.fenekZabrany && !g.wyjscieOtwarte && g.przyWyjsciu(2.6)) {
      this.ui.podpowiedz('Otwórz drzwi');
      this.przyDrzwiach = true;
      return;
    }
    this.przyDrzwiach = false;
    this.ui.podpowiedz('');
  }

  /* ───────── reakcja na stuknięcie w ekran ───────── */
  uzyj() {
    if (this.przyFenku) {
      this.fenekZabrany = true;
      this.dzwiek?.zdobycz();
      this.ui.cel('Wyprowadźcie się na zewnątrz');
      this.gra.znaczniki = [{ x: this.gra.wyjscie.x, y: this.gra.wyjscie.y, kolor: '#e4c47a' }];
      this.naZdarzenie?.('fenek');
      return true;
    }
    if (this.przyProgramiscie) { this.naZdarzenie?.('programista'); return true; }
    if (this.przyDrzwiach) {
      this.gra.otworzWyjscie();
      this.naZdarzenie?.('drzwi');
      return true;
    }
    return false;
  }

  /* ───────── zapis postępu w pamięci telefonu ───────── */
  zapisz() {
    try {
      localStorage.setItem(ZAPIS, JSON.stringify({
        zgony: this.zgony,
        fenek: this.fenekZabrany,
        stan: this.stan,
        kiedy: Date.now()
      }));
    } catch (e) { /* tryb prywatny: trudno, gra działa bez zapisu */ }
  }

  wczytaj() {
    try {
      const s = localStorage.getItem(ZAPIS);
      return s ? JSON.parse(s) : null;
    } catch (e) { return null; }
  }
}
