import * as THREE from './lib/three.module.js';
import { GLTFLoader } from './lib/GLTFLoader.js';
import { CELL } from './gra.js';

/* Modele wstawiane do labiryntu. Każdy wczytywany raz i powielany przez
   klonowanie, bo kopia dzieli geometrię i teksturę z oryginałem i nie
   kosztuje pamięci.                                                      */

const wczytywacz = new GLTFLoader();
const pamiec = new Map();

export async function model(sciezka) {
  if (!pamiec.has(sciezka)) {
    pamiec.set(sciezka, new Promise((res, rej) =>
      wczytywacz.load(sciezka, g => res(g), undefined, rej)));
  }
  return (await pamiec.get(sciezka)).scene;
}

/* Skalowanie do zadanej wysokości i postawienie podstawą na zerze. */
export function dopasuj(obiekt, wysokosc) {
  const box = new THREE.Box3().setFromObject(obiekt);
  const r = box.getSize(new THREE.Vector3());
  const s = wysokosc / (r.y || 1);
  obiekt.scale.setScalar(s);
  const box2 = new THREE.Box3().setFromObject(obiekt);
  obiekt.position.y -= box2.min.y;
  return obiekt;
}

/* Płomień jako tania, świecąca plamka zwrócona do kamery. Nie oświetla
   niczego, ale sprawia, że odległe pochodnie nadal widać jako punkty. */
function teksturaPlomienia() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,244,214,1)');
  grad.addColorStop(0.25, 'rgba(255,176,70,0.92)');
  grad.addColorStop(0.6, 'rgba(226,96,24,0.35)');
  grad.addColorStop(1, 'rgba(180,60,10,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const LICZBA_SWIATEL = 4;     // ile pochodni naraz naprawdę świeci

export class Rekwizyty {
  constructor(gra) {
    this.gra = gra;
    this.grupa = new THREE.Group();
    gra.scena.add(this.grupa);
    this.pochodnie = [];

    // Pula świateł wędrujących do najbliższych pochodni. Każde światło
    // kosztuje w każdym pikselu, więc trzymamy ich kilka, nie kilkanaście.
    this.pulaSwiatel = [];
    for (let i = 0; i < LICZBA_SWIATEL; i++) {
      const l = new THREE.PointLight(0xff9a3c, 0, 11, 1.5);
      this.grupa.add(l);
      this.pulaSwiatel.push(l);
    }
    this.materialPlomienia = new THREE.SpriteMaterial({
      map: teksturaPlomienia(), color: 0xffffff,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true
    });
  }

  /* Pochodnie na ścianach: wybieramy komórki oddalone od siebie, w każdej
     ścianę, która faktycznie istnieje, i odsuwamy model od muru.         */
  async pochodnieNaScianach(ile = 14) {
    const lab = this.gra.lab;
    const wzor = await model('modele/pochodnia.glb');
    const uzyte = [];

    let proby = 0;
    while (this.pochodnie.length < ile && proby < ile * 30) {
      proby++;
      const x = Math.floor(lab.rnd() * lab.w);
      const y = Math.floor(lab.rnd() * lab.h);
      if (uzyte.some(([ux, uy]) => Math.abs(ux - x) + Math.abs(uy - y) < 4)) continue;

      const strony = [[1, 0, -1], [2, 1, 0], [4, 0, 1], [8, -1, 0]]
        .filter(([k]) => lab.ma(x, y, k));
      if (!strony.length) continue;
      const [, dx, dz] = strony[Math.floor(lab.rnd() * strony.length)];

      const egz = wzor.clone(true);
      dopasuj(egz, 0.86);
      const sx = x * CELL + CELL / 2 + dx * (CELL / 2 - 0.42);
      const sz = y * CELL + CELL / 2 + dz * (CELL / 2 - 0.42);
      egz.position.set(sx, 1.55, sz);
      egz.rotation.y = Math.atan2(-dx, -dz);
      this.grupa.add(egz);

      // płomień siada na wierzchołku modelu, a nie w miejscu zgadniętym z ręki
      const bryla = new THREE.Box3().setFromObject(egz);
      const szczyt = new THREE.Vector3(
        (bryla.min.x + bryla.max.x) / 2, bryla.max.y - 0.06, (bryla.min.z + bryla.max.z) / 2);

      const plomien = new THREE.Sprite(this.materialPlomienia);
      plomien.position.copy(szczyt);
      plomien.scale.set(0.42, 0.56, 1);
      this.grupa.add(plomien);

      this.pochodnie.push({ obiekt: egz, plomien, pozycja: szczyt.clone(),
                            faza: Math.random() * 9 });
      uzyte.push([x, y]);
    }
    return this.pochodnie.length;
  }

  /* Migotanie płomieni oraz przypisanie puli świateł najbliższym pochodniom. */
  tik(czas) {
    const oko = this.gra.pozycja;
    for (const p of this.pochodnie) {
      const t = czas + p.faza;
      const puls = 1 + Math.sin(t * 9.1) * 0.13 + Math.sin(t * 3.3) * 0.08;
      p.plomien.scale.set(0.40 * puls, 0.54 * puls, 1);
      p.dystans = p.pozycja.distanceToSquared(oko);
    }
    // sortowanie kilkunastu elementów co klatkę jest tańsze niż jedno
    // dodatkowe światło w każdym pikselu ekranu
    const najblizsze = this.pochodnie
      .filter(p => p.dystans < 26 * 26)
      .sort((a, b) => a.dystans - b.dystans)
      .slice(0, LICZBA_SWIATEL);

    this.pulaSwiatel.forEach((l, i) => {
      const p = najblizsze[i];
      if (!p) { l.intensity = 0; return; }
      l.position.copy(p.pozycja);
      const t = czas + p.faza;
      l.intensity = 11 * (1 + Math.sin(t * 9.1) * 0.15 + Math.sin(t * 3.3) * 0.09);
    });
  }

  usun() {
    this.gra.scena.remove(this.grupa);
    this.grupa.traverse(o => {
      if (o.isMesh && !o.userData.wspolny) o.geometry?.dispose();
    });
    this.pochodnie = [];
    this.grupa = new THREE.Group();
    this.gra.scena.add(this.grupa);
  }
}
