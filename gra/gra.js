import * as THREE from './lib/three.module.js?v=1793185890';
import { Labirynt, N, E, S, W } from './labirynt.js?v=1793185890';

/* ───────────────── wymiary świata ───────────────── */
export const CELL = 4;        // bok komórki labiryntu
const GRUBOSC  = 0.4;         // grubość ściany
const WYSOKOSC = 3.2;         // wysokość ściany
const WZROST   = 1.62;        // wysokość oczu
const PROMIEN  = 0.62;        // promień gracza przy kolizjach
const PREDKOSC = 4.0;         // jednostek na sekundę
const ROZPED   = 11;          // jak szybko gracz nabiera i traci prędkość
const SKALA_TEX = 2.0;        // jednostek świata na jedno powtórzenie tekstury

const $ = id => document.getElementById(id);
const zacisk = (v, a, b) => Math.max(a, Math.min(b, v));

/* ───────────────── proceduralne tekstury ─────────────────
   Rysowane w canvasie, zero plików do pobrania, gra rusza
   nawet przy kiepskim zasięgu.                              */
function teksturaSciany() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#3b352c';
  g.fillRect(0, 0, 256, 256);
  const wys = 32;
  for (let r = 0; r < 256 / wys; r++) {
    const przesun = (r % 2) * 32;
    for (let k = -1; k < 5; k++) {
      const x = k * 64 + przesun, y = r * wys;
      const j = 84 + Math.random() * 30;
      g.fillStyle = `rgb(${j + 16},${j + 9},${j - 4})`;
      g.fillRect(x + 2, y + 2, 60, wys - 4);
      // wytarcie górnej krawędzi cegły
      g.fillStyle = `rgba(255,240,215,${0.05 + Math.random() * 0.06})`;
      g.fillRect(x + 2, y + 2, 60, 2);
    }
  }
  const d = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < d.data.length; i += 4) {
    const s = (Math.random() - 0.5) * 26;
    d.data[i] += s; d.data[i + 1] += s; d.data[i + 2] += s;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function teksturaPodlogi() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#2e2922';
  g.fillRect(0, 0, 256, 256);
  // nieregularne płyty
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const j = 52 + Math.random() * 26;
    g.fillStyle = `rgb(${j + 10},${j + 5},${j - 3})`;
    g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
  }
  for (let i = 0; i < 7000; i++) {
    const j = 40 + Math.random() * 50;
    g.fillStyle = `rgba(${j + 10},${j + 5},${j},${0.25 + Math.random() * 0.45})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ───────────────── gra ───────────────── */
export class Gra {
  constructor(plotno) {
    this.plotno = plotno;
    this.renderer = new THREE.WebGLRenderer({ canvas: plotno, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

    this.scena = new THREE.Scene();
    const mgla = 0x0b0a10;
    this.scena.background = new THREE.Color(mgla);
    this.scena.fog = new THREE.FogExp2(mgla, 0.046);

    this.kamera = new THREE.PerspectiveCamera(74, 1, 0.08, 90);
    this.kamera.rotation.order = 'YXZ';

    this.otoczenie = new THREE.AmbientLight(0x5c6680, 1.45);
    this.scena.add(this.otoczenie);
    this.latarka = new THREE.PointLight(0xffd3a0, 14, 24, 1.3);
    this.mocLatarki = 14;
    this.scena.add(this.latarka);

    this.zegar   = new THREE.Clock();
    this.obrot   = { y: 0, x: 0 };
    this.pozycja = new THREE.Vector3();
    this.predkosc = { przod: 0, bok: 0 };      // wygładzone, nie skokowe
    this.sterowanie = { przod: 0, bok: 0 };
    this.bujanie = 0;
    this.czas = 0;
    this.dziala = false;
    this.naTik = null;                          // podpinana logika gry
    this.mapka  = null;
    this.dzwiek = null;                         // ustawiane z zewnątrz
    this.ekwipunek = [];                        // zebrane przedmioty
    this.fazaKroku = 0;
    this.ostatniStuk = 0;

    this.#wejscie();
    addEventListener('resize', () => this.rozmiar());
    addEventListener('orientationchange', () => setTimeout(() => this.rozmiar(), 240));
  }

  /* ─────────── budowa piętra ─────────── */
  zbuduj(szer, wys, ziarno, opcje = {}) {
    if (this.grupa) {
      this.scena.remove(this.grupa);
      this.grupa.traverse(o => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    this.grupa = new THREE.Group();
    this.scena.add(this.grupa);

    const { rozplot = 0.5, komnaty = 6 } = opcje;
    this.lab = new Labirynt(szer, wys, ziarno);
    this.lab.rozplec(rozplot);          // pętle: więcej niż jedna droga
    this.lab.wykujKomnaty(komnaty, 3);  // otwarte sale, żeby nie była to sama krata
    // sala startowa: gracz budzi się w pomieszczeniu, nie w korytarzu
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      if (x < 1) this.lab.usun(x, y, E);
      if (y < 1) this.lab.usun(x, y, S);
    }
    this.odwiedzone = new Uint8Array(szer * wys);

    this.wyjscie = this.lab.najdalszeNaObrzezu(0, 0);
    this.wyjscieOtwarte = false;

    const sciany = this.lab.sciany(CELL, GRUBOSC, [this.wyjscie]);
    const bryly = this.#zbudujWyjscie(this.wyjscie);
    this.#geometriaScian(sciany.concat(bryly.mur));
    this.#kubelkiKolizji(sciany.concat(bryly.mur, bryly.blokada));
    this.blokadaWyjscia = bryly.blokada;
    this.#podlogaISufit(szer, wys);

    // start na środku sali, twarzą w jej głąb
    this.pozycja.set(CELL, WZROST, CELL * 0.6);
    this.obrot.x = 0;
    this.obrot.y = Math.PI;
    this.#oznaczOdwiedzone();
  }

  /* Biały pokój za drzwiami: ta sama maszyneria, ale bez mgły, bez pochodni
     i bez zagrożenia. Po ciemnym labiryncie ma uderzyć kontrastem. */
  zbudujBialyPokoj(bok = 5) {
    if (this.grupa) {
      this.scena.remove(this.grupa);
      this.grupa.traverse(o => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    this.grupa = new THREE.Group();
    this.scena.add(this.grupa);

    this.lab = new Labirynt(bok, bok, 1);
    for (let y = 0; y < bok; y++) for (let x = 0; x < bok; x++) {
      if (x < bok - 1) this.lab.usun(x, y, E);
      if (y < bok - 1) this.lab.usun(x, y, S);
    }
    this.odwiedzone = new Uint8Array(bok * bok).fill(1);
    this.wyjscie = null; this.punktWyjscia = null; this.blokadaWyjscia = [];

    const sciany = this.lab.sciany(CELL, GRUBOSC);
    const bialy = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
    const n = sciany.length;
    const poz = new Float32Array(n * 24 * 3), nor = new Float32Array(n * 24 * 3);
    const ind = new Uint32Array(n * 36);
    sciany.forEach((s, i) => {
      const g = new THREE.BoxGeometry(s.x1 - s.x0, WYSOKOSC + 1.4, s.z1 - s.z0);
      g.translate((s.x0 + s.x1) / 2, (WYSOKOSC + 1.4) / 2, (s.z0 + s.z1) / 2);
      poz.set(g.attributes.position.array, i * 72);
      nor.set(g.attributes.normal.array, i * 72);
      for (let k = 0; k < 36; k++) ind[i * 36 + k] = g.index.array[k] + i * 24;
      g.dispose();
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(poz, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    geo.computeBoundingSphere();
    this.grupa.add(new THREE.Mesh(geo, bialy));
    this.#kubelkiKolizji(sciany);

    const W = bok * CELL;
    const podloga = new THREE.Mesh(new THREE.PlaneGeometry(W, W),
      new THREE.MeshLambertMaterial({ color: 0xeae6dc }));
    podloga.rotation.x = -Math.PI / 2;
    podloga.position.set(W / 2, 0, W / 2);
    this.grupa.add(podloga);

    const sufit = new THREE.Mesh(new THREE.PlaneGeometry(W, W),
      new THREE.MeshLambertMaterial({ color: 0xffffff }));
    sufit.rotation.x = Math.PI / 2;
    sufit.position.set(W / 2, WYSOKOSC + 1.4, W / 2);
    this.grupa.add(sufit);

    // światło rozproszone zamiast pochodni
    this.scena.fog = null;
    this.scena.background = new THREE.Color(0xf4f1ea);
    this.otoczenie.color.set(0xffffff);
    this.otoczenie.intensity = 2.6;
    this.latarka.intensity = 0;
    this.mocLatarki = 0;
    const gora = new THREE.PointLight(0xfff6e6, 60, 44, 1.1);
    gora.position.set(W / 2, WYSOKOSC + 0.6, W / 2);
    this.grupa.add(gora);

    this.pozycja.set(W / 2, WZROST, W - CELL * 0.8);
    this.obrot.set ? null : null;
    this.obrot.x = 0; this.obrot.y = Math.PI;
    return { bok: W };
  }

  /* Yaw w pierwszą stronę, w którą z tej komórki da się wyjść:
     bez tego gracz budzi się nosem w murze. */
  #zwrotNaWyjscie(cx, cz) {
    for (const [kier, yaw] of [[N, 0], [E, -Math.PI / 2], [S, Math.PI], [W, Math.PI / 2]])
      if (!this.lab.ma(cx, cz, kier)) return yaw;
    return 0;
  }

  /* Jedna scalona geometria ze wszystkich ścian. UV skalowane rozmiarem
     ściany w świecie, żeby cegły były wszędzie tej samej wielkości;
     przy InstancedMesh rozciągały się razem z blokiem. */
  #geometriaScian(sciany) {
    const n = sciany.length;
    const poz = new Float32Array(n * 24 * 3);
    const nor = new Float32Array(n * 24 * 3);
    const uv  = new Float32Array(n * 24 * 2);
    const ind = new Uint32Array(n * 36);

    sciany.forEach((s, i) => {
      const sx = s.x1 - s.x0, sz = s.z1 - s.z0;
      const g = new THREE.BoxGeometry(sx, WYSOKOSC, sz);
      // kolejność ścianek w BoxGeometry: +X, -X, +Y, -Y, +Z, -Z (po 4 wierzchołki)
      const a = g.attributes.uv.array;
      const skaluj = (od, ile, us, vs) => {
        for (let k = od; k < od + ile; k++) { a[k * 2] *= us; a[k * 2 + 1] *= vs; }
      };
      skaluj(0,  8, sz / SKALA_TEX, WYSOKOSC / SKALA_TEX);   // boki wzdłuż Z
      skaluj(8,  8, sx / SKALA_TEX, sz / SKALA_TEX);         // góra i dół
      skaluj(16, 8, sx / SKALA_TEX, WYSOKOSC / SKALA_TEX);   // boki wzdłuż X
      g.translate((s.x0 + s.x1) / 2, WYSOKOSC / 2, (s.z0 + s.z1) / 2);

      poz.set(g.attributes.position.array, i * 72);
      nor.set(g.attributes.normal.array,   i * 72);
      uv.set(a,                            i * 48);
      const gi = g.index.array;
      for (let k = 0; k < 36; k++) ind[i * 36 + k] = gi[k] + i * 24;
      g.dispose();
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(poz, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(ind, 1));
    geo.computeBoundingSphere();

    this.siatkaScian = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: teksturaSciany() }));
    this.grupa.add(this.siatkaScian);
  }

  /* Drzwi: otwór w murze zewnętrznym, zamknięty płytą do czasu odblokowania.
     Zwraca bryły muru (boki) i prostokąt blokujący przejście.             */
  #zbudujWyjscie(w) {
    const t = GRUBOSC / 2, SZER_OTW = 2.6, WYS_OTW = 2.75;
    const X = w.x * CELL, Z = w.y * CELL;
    const pion = (w.kier === N || w.kier === S);

    // pas muru, w którym robimy dziurę
    let x0, z0, x1, z1;
    if (w.kier === N)      { x0 = X - t;        z0 = Z - t;            x1 = X + CELL + t; z1 = Z + t; }
    else if (w.kier === S) { x0 = X - t;        z0 = Z + CELL - t;     x1 = X + CELL + t; z1 = Z + CELL + t; }
    else if (w.kier === W) { x0 = X - t;        z0 = Z - t;            x1 = X + t;        z1 = Z + CELL + t; }
    else                   { x0 = X + CELL - t; z0 = Z - t;            x1 = X + CELL + t; z1 = Z + CELL + t; }

    const srodek = pion ? (x0 + x1) / 2 : (z0 + z1) / 2;
    const a = srodek - SZER_OTW / 2, b = srodek + SZER_OTW / 2;

    const mur = pion
      ? [{ x0, z0, x1: a, z1 }, { x0: b, z0, x1, z1 }]
      : [{ x0, z0, x1, z1: a }, { x0, z0: b, x1, z1 }];

    const otwor = pion ? { x0: a, z0, x1: b, z1 } : { x0, z0: a, x1, z1: b };

    // nadproże nad otworem (nie bierze udziału w kolizji)
    const geoN = new THREE.BoxGeometry(otwor.x1 - otwor.x0, WYSOKOSC - WYS_OTW, otwor.z1 - otwor.z0);
    const nadproze = new THREE.Mesh(geoN, new THREE.MeshLambertMaterial({ color: 0x7a6a4c }));
    nadproze.position.set((otwor.x0 + otwor.x1) / 2, (WYSOKOSC + WYS_OTW) / 2, (otwor.z0 + otwor.z1) / 2);
    this.grupa.add(nadproze);

    // framuga: dwa jaśniejsze słupki, żeby drzwi rzucały się w oczy z daleka
    const matOscieznica = new THREE.MeshLambertMaterial({ color: 0x8d7a56 });
    for (const bok of mur) {
      const sx = pion ? 0.22 : bok.x1 - bok.x0;
      const sz = pion ? bok.z1 - bok.z0 : 0.22;
      const px = pion ? (bok.x1 === a ? a - 0.11 : b + 0.11) : (bok.x0 + bok.x1) / 2;
      const pz = pion ? (bok.z0 + bok.z1) / 2 : (bok.z1 === a ? a - 0.11 : b + 0.11);
      const sl = new THREE.Mesh(new THREE.BoxGeometry(sx, WYS_OTW, sz), matOscieznica);
      sl.position.set(px, WYS_OTW / 2, pz);
      this.grupa.add(sl);
    }

    // świetlisty prostokąt w otworze: zamknięty jest chłodny, otwarty ciepły
    const szerPl = pion ? SZER_OTW : (otwor.z1 - otwor.z0);
    this.plytaWyjscia = new THREE.Mesh(
      new THREE.PlaneGeometry(szerPl, WYS_OTW),
      new THREE.MeshBasicMaterial({ color: 0x2b4a6b, transparent: true, opacity: 0.88,
                                    side: THREE.DoubleSide, fog: true })
    );
    this.plytaWyjscia.position.set((otwor.x0 + otwor.x1) / 2, WYS_OTW / 2, (otwor.z0 + otwor.z1) / 2);
    if (!pion) this.plytaWyjscia.rotation.y = Math.PI / 2;
    this.grupa.add(this.plytaWyjscia);

    this.swiatloWyjscia = new THREE.PointLight(0x5b8fc9, 7, 15, 1.4);
    this.swiatloWyjscia.position.set(
      (otwor.x0 + otwor.x1) / 2 + (w.kier === N ? 0 : w.kier === S ? 0 : (w.kier === W ? 1 : -1)),
      WYS_OTW * 0.6,
      (otwor.z0 + otwor.z1) / 2 + (w.kier === N ? 1 : w.kier === S ? -1 : 0)
    );
    this.grupa.add(this.swiatloWyjscia);

    // punkt, do którego trzeba podejść, i kierunek wyjścia na zewnątrz
    this.punktWyjscia = new THREE.Vector3(
      X + CELL / 2 + (w.kier === W ? -0.6 : w.kier === E ? 0.6 : 0),
      WZROST,
      Z + CELL / 2 + (w.kier === N ? -0.6 : w.kier === S ? 0.6 : 0)
    );

    return { mur, blokada: [otwor] };
  }

  /* Odblokowanie wyjścia: płyta robi się ciepła, przejście przestaje blokować. */
  otworzWyjscie() {
    if (this.wyjscieOtwarte) return;
    this.wyjscieOtwarte = true;
    for (const s of this.blokadaWyjscia) {
      for (const [, lista] of this.kubelki) {
        const i = lista.indexOf(s);
        if (i >= 0) lista.splice(i, 1);
      }
    }
    this.plytaWyjscia.material.color.set(0xfff4de);
    this.plytaWyjscia.material.opacity = 0.93;
    this.plytaWyjscia.material.blending = 2;
    this.swiatloWyjscia.color.set(0xffd9a0);
    this.swiatloWyjscia.intensity = 22;
    this.swiatloWyjscia.distance = 24;
    this.dzwiek?.otwarcie();
  }

  /* Czy gracz stoi w progu? */
  przyWyjsciu(promien = 2.2) {
    if (!this.punktWyjscia) return false;
    return Math.hypot(this.pozycja.x - this.punktWyjscia.x,
                      this.pozycja.z - this.punktWyjscia.z) < promien;
  }

  /* Ściany w kubełkach po komórkach: kolizja sprawdza tylko sąsiedztwo. */
  #kubelkiKolizji(sciany) {
    this.kubelki = new Map();
    for (const s of sciany) {
      const cx0 = Math.floor(s.x0 / CELL), cx1 = Math.floor(s.x1 / CELL);
      const cz0 = Math.floor(s.z0 / CELL), cz1 = Math.floor(s.z1 / CELL);
      for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cz * this.lab.w + cx;
        if (!this.kubelki.has(k)) this.kubelki.set(k, []);
        const l = this.kubelki.get(k);
        if (!l.includes(s)) l.push(s);
      }
    }
  }

  #podlogaISufit(szer, wys) {
    const Wd = szer * CELL, Hd = wys * CELL;
    const tp = teksturaPodlogi(); tp.repeat.set(Wd / SKALA_TEX, Hd / SKALA_TEX);
    const podloga = new THREE.Mesh(new THREE.PlaneGeometry(Wd, Hd),
      new THREE.MeshLambertMaterial({ map: tp }));
    podloga.rotation.x = -Math.PI / 2;
    podloga.position.set(Wd / 2, 0, Hd / 2);
    this.grupa.add(podloga);

    const ts = teksturaSciany(); ts.repeat.set(Wd / 3, Hd / 3);
    const sufit = new THREE.Mesh(new THREE.PlaneGeometry(Wd, Hd),
      new THREE.MeshLambertMaterial({ map: ts, color: 0x6b6478 }));
    sufit.rotation.x = Math.PI / 2;
    sufit.position.set(Wd / 2, WYSOKOSC, Hd / 2);
    this.grupa.add(sufit);
  }

  /* ─────────── kolizje: okrąg kontra prostokąt ─────────── */
  rozsun(poz, promien = PROMIEN) {
    const cx = Math.floor(poz.x / CELL), cz = Math.floor(poz.z / CELL);
    let dotyk = false;
    for (let powtorka = 0; powtorka < 2; powtorka++) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const lista = this.kubelki.get((cz + dz) * this.lab.w + (cx + dx));
        if (!lista) continue;
        for (const s of lista) {
          const bx = zacisk(poz.x, s.x0, s.x1), bz = zacisk(poz.z, s.z0, s.z1);
          const ox = poz.x - bx, oz = poz.z - bz, d2 = ox * ox + oz * oz;
          if (d2 >= promien * promien) continue;
          dotyk = true;
          if (d2 > 1e-8) {
            const d = Math.sqrt(d2), p = (promien - d) / d;
            poz.x += ox * p; poz.z += oz * p;
          } else {
            const lewo = poz.x - s.x0, prawo = s.x1 - poz.x;
            const gora = poz.z - s.z0, dol = s.z1 - poz.z;
            const naj = Math.min(lewo, prawo, gora, dol);
            if (naj === lewo)       poz.x = s.x0 - promien;
            else if (naj === prawo) poz.x = s.x1 + promien;
            else if (naj === gora)  poz.z = s.z0 - promien;
            else                    poz.z = s.z1 + promien;
          }
        }
      }
    }
    return dotyk;
  }

  komorka(v = this.pozycja) {
    return [Math.floor(v.x / CELL), Math.floor(v.z / CELL)];
  }

  #oznaczOdwiedzone() {
    const [cx, cz] = this.komorka();
    if (this.lab.w_srodku(cx, cz)) this.odwiedzone[cz * this.lab.w + cx] = 1;
  }

  /* ─────────── sterowanie ─────────── */
  #wejscie() {
    const role = new Map();
    let drazek = null, patrzenie = null;
    const polowa = () => innerWidth * 0.46;

    this.plotno.addEventListener('pointerdown', e => {
      if (this.zablokowaneWejscie) return;
      this.plotno.setPointerCapture(e.pointerId);
      if (e.clientX < polowa() && !drazek) {
        drazek = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
        role.set(e.pointerId, 'drazek');
        const d = $('drazek');
        d.style.left = e.clientX + 'px';
        d.style.top  = e.clientY + 'px';
        d.classList.add('widoczny');
        $('galka').style.transform = 'translate(-50%,-50%)';
      } else if (!patrzenie) {
        patrzenie = { id: e.pointerId, px: e.clientX, py: e.clientY,
                      startX: e.clientX, startY: e.clientY, kiedy: performance.now(),
                      przesuniecie: 0 };
        role.set(e.pointerId, 'patrzenie');
      }
      e.preventDefault();
    });

    this.plotno.addEventListener('pointermove', e => {
      const rola = role.get(e.pointerId);
      if (rola === 'drazek' && drazek) {
        let dx = e.clientX - drazek.ox, dy = e.clientY - drazek.oy;
        const max = 54, d = Math.hypot(dx, dy);
        if (d > max) { dx = dx / d * max; dy = dy / d * max; }
        this.sterowanie.bok   = dx / max;
        this.sterowanie.przod = -dy / max;
        $('galka').style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (rola === 'patrzenie' && patrzenie) {
        const dx = e.clientX - patrzenie.px, dy = e.clientY - patrzenie.py;
        patrzenie.px = e.clientX; patrzenie.py = e.clientY;
        patrzenie.przesuniecie += Math.hypot(dx, dy);
        this.obrot.y -= dx * 0.0042;
        this.obrot.x = zacisk(this.obrot.x - dy * 0.0036, -0.85, 0.85);
      }
      e.preventDefault();
    });

    const koniec = e => {
      const rola = role.get(e.pointerId);
      if (rola === 'drazek') {
        drazek = null;
        this.sterowanie.przod = this.sterowanie.bok = 0;
        $('drazek').classList.remove('widoczny');
      } else if (rola === 'patrzenie') {
        // stuknięcie, a nie rozglądanie: krótkie i bez przesunięcia
        if (patrzenie && patrzenie.przesuniecie < 12 &&
            performance.now() - patrzenie.kiedy < 400) {
          this.naStukniecie?.();
        }
        patrzenie = null;
      }
      role.delete(e.pointerId);
    };
    this.plotno.addEventListener('pointerup', koniec);
    this.plotno.addEventListener('pointercancel', koniec);

    const kl = {};
    addEventListener('keydown', e => { kl[e.code] = 1; });
    addEventListener('keyup',   e => { kl[e.code] = 0; });
    this.klawisze = kl;
  }

  #zKlawiatury() {
    const k = this.klawisze;
    return {
      przod: (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0),
      bok:   (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0)
    };
  }

  /* ─────────── pętla ─────────── */
  rozmiar() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.kamera.aspect = w / h;
    this.kamera.updateProjectionMatrix();
    document.documentElement.style.setProperty('--appH', h + 'px');
  }

  start() {
    if (this.dziala) return;
    this.dziala = true;
    this.rozmiar();
    this.zegar.getDelta();
    const klatka = () => {
      if (!this.dziala) return;
      requestAnimationFrame(klatka);
      this.krok(Math.min(this.zegar.getDelta(), 0.05));
      this.renderer.render(this.scena, this.kamera);
    };
    requestAnimationFrame(klatka);
  }

  stop() { this.dziala = false; }

  krok(dt) {
    this.czas += dt;
    const kl = this.#zKlawiatury();
    const celPrzod = zacisk(this.sterowanie.przod + kl.przod, -1, 1);
    const celBok   = zacisk(this.sterowanie.bok   + kl.bok,   -1, 1);

    // rozpęd zamiast skoku, bo chodzenie nie jest cyfrowe
    const k = 1 - Math.exp(-ROZPED * dt);
    this.predkosc.przod += (celPrzod - this.predkosc.przod) * k;
    this.predkosc.bok   += (celBok   - this.predkosc.bok)   * k;

    const przod = this.predkosc.przod, bok = this.predkosc.bok;
    const dlug = Math.hypot(przod, bok);
    if (dlug > 0.01 && !this.zamrozony) {
      const sk = Math.min(dlug, 1) / dlug * PREDKOSC * dt;
      const sin = Math.sin(this.obrot.y), cos = Math.cos(this.obrot.y);
      this.pozycja.x += (-sin * przod + cos * bok) * sk;
      this.pozycja.z += (-cos * przod - sin * bok) * sk;
      const otarcie = this.rozsun(this.pozycja);
      this.#oznaczOdwiedzone();
      this.bujanie += dt * 10.5 * Math.min(dlug, 1);

      // stąpnięcie w dolnym punkcie kołysania, nie co stałą liczbę klatek
      const faza = Math.floor(this.bujanie / Math.PI);
      if (faza !== this.fazaKroku) { this.fazaKroku = faza; this.dzwiek?.krok(); }

      // obicie o mur, ale nie przy samym ślizganiu się wzdłuż ściany
      if (otarcie && dlug > 0.55 && this.czas - this.ostatniStuk > 0.45) {
        this.ostatniStuk = this.czas;
        this.dzwiek?.stuk();
      }
    }

    // kołysanie głowy i mikro-przechył przy skręcie w bok
    const gora = Math.sin(this.bujanie) * 0.038 * Math.min(dlug, 1);
    const przechyl = -bok * 0.025;
    this.kamera.position.set(this.pozycja.x, this.pozycja.y + gora, this.pozycja.z);
    this.kamera.rotation.set(this.obrot.x, this.obrot.y, przechyl);

    // migotanie pochodni: dwie fale o różnym okresie, żeby nie było rytmiczne
    const migot = 1 + Math.sin(this.czas * 11.3) * 0.045 + Math.sin(this.czas * 4.1) * 0.03;
    this.latarka.intensity = this.mocLatarki * migot;
    this.latarka.position.set(this.kamera.position.x, this.kamera.position.y + 0.12, this.kamera.position.z);

    this.dzwiek?.tik(dt);
    this.naTik?.(dt);
    this.mapka?.();
  }
}
