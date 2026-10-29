import * as THREE from './lib/three.module.js?v=1793278806';

/* Pająk budowany z brył, nie wczytywany z pliku: osiem nóg po trzy człony,
   korpus z dwóch brzuchów, czerwony znak na odwłoku.

   Chód jest proceduralny. Nogi dzielą się na dwie czwórki, które stąpają
   na przemian (tak chodzą prawdziwe pająki). Każda stopa dostaje punkt
   docelowy na podłodze, a staw kolanowy liczony jest odwrotną kinematyką
   dwóch kości, dzięki czemu noga zawsze dosięga ziemi niezależnie od
   tempa i kierunku.                                                      */

const UDO = 0.62;          // długość uda
const GOLEN = 0.78;        // długość goleni
const ZASIEG = UDO + GOLEN;

function materialPancerza(kolor, polysk) {
  return new THREE.MeshPhongMaterial({ color: kolor, shininess: polysk, specular: 0x555566 });
}

/* Rozwiązanie dwóch kości: zwraca kąty w radianach.
   d to odległość od biodra do stopy.                        */
function dwieKosci(d) {
  const dd = Math.min(Math.max(d, Math.abs(UDO - GOLEN) + 1e-4), ZASIEG - 1e-4);
  const kolano = Math.acos((UDO * UDO + GOLEN * GOLEN - dd * dd) / (2 * UDO * GOLEN));
  const biodro = Math.acos((UDO * UDO + dd * dd - GOLEN * GOLEN) / (2 * UDO * dd));
  return { biodro, kolano, d: dd };
}

class Noga {
  /* bok: -1 lewa, +1 prawa; indeks 0..3 od przodu */
  constructor(rodzic, bok, indeks, mat) {
    this.bok = bok;
    this.indeks = indeks;

    // rozstaw barków wzdłuż korpusu i na boki
    const z = 0.30 - indeks * 0.22;
    this.bark = new THREE.Object3D();
    this.bark.position.set(bok * 0.26, 0.04, z);
    rodzic.add(this.bark);

    this.udo = new THREE.Object3D();
    this.bark.add(this.udo);
    const geoU = new THREE.CylinderGeometry(0.052, 0.042, UDO, 6);
    geoU.translate(0, UDO / 2, 0);
    geoU.rotateZ(-Math.PI / 2);                 // kość wzdłuż +X
    const mU = new THREE.Mesh(geoU, mat);
    this.udo.add(mU);

    this.kolano = new THREE.Object3D();
    this.kolano.position.x = UDO;
    this.udo.add(this.kolano);

    const geoG = new THREE.CylinderGeometry(0.038, 0.016, GOLEN, 6);
    geoG.translate(0, GOLEN / 2, 0);
    geoG.rotateZ(-Math.PI / 2);
    this.kolano.add(new THREE.Mesh(geoG, mat));

    // stopa: mały stożek, żeby końcówka nie była ucięta
    const stopa = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.09, 5), mat);
    stopa.position.x = GOLEN;
    stopa.rotation.z = Math.PI / 2;
    this.kolano.add(stopa);

    // spoczynkowy punkt podparcia w układzie korpusu
    const rozstaw = 1.02 - indeks * 0.06;
    this.spoczynek = new THREE.Vector3(bok * rozstaw, 0, z + (indeks < 2 ? 0.42 : -0.30));
    this.cel = this.spoczynek.clone();
    this.poprzedniCel = this.spoczynek.clone();
    this.faza = 0;
  }

  /* celStopy podawany w układzie korpusu, wysokość korpusu nad podłogą = h */
  ustawDoCelu(cel, h) {
    const dx = cel.x - this.bark.position.x;
    const dy = cel.y - h - this.bark.position.y;
    const dz = cel.z - this.bark.position.z;

    const poziom = Math.hypot(dx, dz);
    const d = Math.hypot(poziom, dy);
    const { biodro, kolano } = dwieKosci(d);

    this.bark.rotation.y = Math.atan2(-dz, dx);
    const wzniesienie = Math.atan2(dy, poziom);
    this.udo.rotation.z = wzniesienie + biodro;
    this.kolano.rotation.z = -(Math.PI - kolano);
  }

  /* koniec goleni w układzie korpusu: do sprawdzenia, czy stopa trafia w cel */
  koniec(pajak) {
    const v = new THREE.Vector3(GOLEN, 0, 0);
    this.kolano.updateWorldMatrix(true, false);
    return pajak.korpus.worldToLocal(this.kolano.localToWorld(v));
  }
}

export class Pajak {
  constructor(scena, { skala = 1, kolor = 0x14121a, znak = 0xb3221c } = {}) {
    this.skala = skala;
    this.korzen = new THREE.Group();
    this.korpus = new THREE.Group();
    this.korzen.add(this.korpus);
    this.korzen.scale.setScalar(skala);

    this.wysokoscKorpusu = 0.52;
    this.korpus.position.y = this.wysokoscKorpusu;

    const mat = materialPancerza(kolor, 85);

    // głowotułów
    const glowa = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), mat);
    glowa.scale.set(1, 0.74, 1.18);
    glowa.position.z = 0.26;
    this.korpus.add(glowa);

    // odwłok, wyraźnie większy i błyszczący
    const odwlok = new THREE.Mesh(new THREE.SphereGeometry(0.46, 16, 12),
      materialPancerza(kolor, 150));
    odwlok.scale.set(0.94, 0.92, 1.1);
    odwlok.position.set(0, 0.06, -0.46);
    this.korpus.add(odwlok);

    // czerwony znak na odwłoku
    const matZnak = new THREE.MeshPhongMaterial({ color: znak, shininess: 60 });
    const pas = new THREE.Mesh(new THREE.SphereGeometry(0.465, 14, 10,
      Math.PI * 0.42, Math.PI * 0.16, Math.PI * 0.18, Math.PI * 0.6), matZnak);
    pas.scale.copy(odwlok.scale);
    pas.position.copy(odwlok.position);
    this.korpus.add(pas);

    // oczy
    const matOko = new THREE.MeshPhongMaterial({ color: 0x090910, shininess: 220 });
    for (const [ox, oy, oz, r] of [[-0.1, 0.1, 0.5, 0.045], [0.1, 0.1, 0.5, 0.045],
                                   [-0.17, 0.06, 0.46, 0.03], [0.17, 0.06, 0.46, 0.03]]) {
      const o = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), matOko);
      o.position.set(ox, oy, oz);
      this.korpus.add(o);
    }

    // szczękoczułki
    for (const s of [-1, 1]) {
      const sz = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 6), mat);
      sz.position.set(s * 0.09, -0.06, 0.48);
      sz.rotation.x = Math.PI * 0.62;
      this.korpus.add(sz);
    }

    this.nogi = [];
    for (const bok of [-1, 1]) for (let i = 0; i < 4; i++) {
      this.nogi.push(new Noga(this.korpus, bok, i, mat));
    }
    // dwie czwórki stąpające na przemian
    this.nogi.forEach(n => {
      const parzysta = (n.indeks % 2 === 0);
      n.grupa = (n.bok < 0) === parzysta ? 0 : 1;
    });

    scena.add(this.korzen);
    this.scena = scena;

    this.czasChodu = 0;
    this.predkoscChodu = 0;
    this.poprzedniaPozycja = new THREE.Vector3();
    this.nogi.forEach(n => n.ustawDoCelu(n.spoczynek, this.wysokoscKorpusu));
  }

  get pozycja() { return this.korzen.position; }

  ustaw(x, z) {
    this.korzen.position.set(x, 0, z);
    this.poprzedniaPozycja.set(x, 0, z);
  }

  zwrot(kat) { this.korzen.rotation.y = kat; }

  /* dt w sekundach; predkosc w jednostkach na sekundę */
  animuj(dt, predkosc) {
    this.predkoscChodu += (predkosc - this.predkoscChodu) * (1 - Math.exp(-8 * dt));
    // częstotliwość kroku rośnie z tempem, ale nie liniowo
    const tempo = 1.6 + this.predkoscChodu * 1.5;
    this.czasChodu += dt * tempo;

    const dlugoscKroku = Math.min(0.26 + this.predkoscChodu * 0.16, 0.62);
    const wysokoscKroku = 0.14 + this.predkoscChodu * 0.05;

    for (const n of this.nogi) {
      // faza w [0,1): pierwsza połowa to podparcie, druga to przenoszenie
      let f = (this.czasChodu / (2 * Math.PI) + (n.grupa ? 0.5 : 0)) % 1;
      const cel = n.spoczynek.clone();

      if (f < 0.5) {
        // stopa stoi: przesuwa się do tyłu względem korpusu
        const t = f / 0.5;
        cel.z += dlugoscKroku * (0.5 - t);
        cel.y = 0;
      } else {
        // stopa w powietrzu: łuk do przodu
        const t = (f - 0.5) / 0.5;
        cel.z += dlugoscKroku * (-0.5 + t);
        cel.y = Math.sin(t * Math.PI) * wysokoscKroku;
      }
      n.ustawDoCelu(cel, this.wysokoscKorpusu);
    }

    // korpus kołysze się i lekko unosi przy szybszym chodzie
    this.korpus.position.y = this.wysokoscKorpusu + Math.sin(this.czasChodu * 2) * 0.022;
    this.korpus.rotation.z = Math.sin(this.czasChodu) * 0.035;
    this.korpus.rotation.x = Math.sin(this.czasChodu * 2 + 1) * 0.02;
  }

  widoczny(v) { this.korzen.visible = v; }

  usun() {
    this.scena.remove(this.korzen);
    this.korzen.traverse(o => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}
