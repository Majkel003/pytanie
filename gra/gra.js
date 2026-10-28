import * as THREE from './lib/three.module.js';
import { Labirynt, N, E, S, W } from './labirynt.js';

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

    this.#wejscie();
    addEventListener('resize', () => this.rozmiar());
    addEventListener('orientationchange', () => setTimeout(() => this.rozmiar(), 240));
  }

  /* ─────────── budowa piętra ─────────── */
  zbuduj(szer, wys, ziarno) {
    if (this.grupa) {
      this.scena.remove(this.grupa);
      this.grupa.traverse(o => {
        o.geometry?.dispose();
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
      });
    }
    this.grupa = new THREE.Group();
    this.scena.add(this.grupa);

    this.lab = new Labirynt(szer, wys, ziarno);
    this.lab.rozplec(0.42);
    this.odwiedzone = new Uint8Array(szer * wys);

    const sciany = this.lab.sciany(CELL, GRUBOSC);
    this.#geometriaScian(sciany);
    this.#kubelkiKolizji(sciany);
    this.#podlogaISufit(szer, wys);

    this.pozycja.set(CELL / 2, WZROST, CELL / 2);
    this.obrot.x = 0;
    this.obrot.y = this.#zwrotNaWyjscie(0, 0);
    this.#oznaczOdwiedzone();
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

    this.grupa.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: teksturaSciany() })));
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
        patrzenie = { id: e.pointerId, px: e.clientX, py: e.clientY };
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
      } else if (rola === 'patrzenie') patrzenie = null;
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
      this.rozsun(this.pozycja);
      this.#oznaczOdwiedzone();
      this.bujanie += dt * 10.5 * Math.min(dlug, 1);
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

    this.naTik?.(dt);
    this.mapka?.();
  }
}
