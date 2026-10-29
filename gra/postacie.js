import * as THREE from './lib/three.module.js?v=1793278806';

/* Postacie są wycinankami zwróconymi do kamery, ale nie płaskimi naklejkami:
   każda dostaje ciemny obrys z tyłu (jak tekturowy standee), miękki cień na
   podłodze i własne kołysanie. Dzięki temu twarz zostaje dokładnie twarzą,
   a figura ma miejsce w przestrzeni.                                        */

/* Wczytanie z wygaszeniem dołu: zdjęcia bywają ucięte w pasie albo udzie,
   a ostra krawędź wyglądałaby jak wbity w podłogę kartonik. */
export function wczytajSprite(url, { wygaszenie = 0.16 } = {}) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);

      const h = Math.floor(img.height * wygaszenie);
      if (h > 1) {
        const d = g.getImageData(0, img.height - h, img.width, h);
        for (let y = 0; y < h; y++) {
          const k = 1 - y / h;                 // 1 na górze pasa, 0 na samym dole
          const krzywa = k * k;
          for (let x = 0; x < img.width; x++) {
            const i = (y * img.width + x) * 4 + 3;
            d.data[i] = d.data[i] * krzywa;
          }
        }
        g.putImageData(d, img.height - h >= 0 ? 0 : 0, img.height - h);
      }

      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true;
      t.needsUpdate = true;
      res({ tekstura: t, proporcja: img.width / img.height });
    };
    img.onerror = () => rej(new Error('nie wczytano ' + url));
    img.src = url;
  });
}

/* miękka plama cienia pod postacią */
function teksturaCienia() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0,   'rgba(0,0,0,.72)');
  grad.addColorStop(0.5, 'rgba(0,0,0,.34)');
  grad.addColorStop(1,   'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}

let CIEN = null;

export class Postac {
  /* opcje: wysokosc (jednostki świata), obrys (grubość ciemnej krawędzi),
            kolysanie (amplituda), nazwa                                  */
  constructor(scena, { tekstura, proporcja }, opcje = {}) {
    const {
      wysokosc = 1.78, obrys = 0.032, kolysanie = 1, nazwa = ''
    } = opcje;

    this.nazwa = nazwa;
    this.wysokosc = wysokosc;
    this.kolysanie = kolysanie;
    this.faza = Math.random() * 7;
    this.grupa = new THREE.Group();

    const szer = wysokosc * proporcja;
    const geo = new THREE.PlaneGeometry(szer, wysokosc);

    // ciemny obrys z tyłu: ta sama maska, przesunięta i przyciemniona
    this.tyl = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tekstura, color: 0x0a0910,
      transparent: true, alphaTest: 0.22, depthWrite: false,
      side: THREE.DoubleSide, fog: true
    }));
    this.tyl.scale.set(1 + obrys, 1 + obrys, 1);
    this.tyl.position.z = -0.012;
    this.grupa.add(this.tyl);

    // właściwa wycinanka, oświetlana latarką
    this.przod = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      map: tekstura,
      transparent: true, alphaTest: 0.12, depthWrite: true,
      side: THREE.DoubleSide
    }));
    this.grupa.add(this.przod);

    this.grupa.position.y = wysokosc / 2;

    // cień: osobno, bo nie może się obracać razem z figurą
    if (!CIEN) CIEN = teksturaCienia();
    this.cien = new THREE.Mesh(
      new THREE.PlaneGeometry(szer * 1.15, szer * 0.62),
      new THREE.MeshBasicMaterial({ map: CIEN, transparent: true,
                                    depthWrite: false, fog: true, opacity: 0.85 })
    );
    this.cien.rotation.x = -Math.PI / 2;
    this.cien.position.y = 0.025;

    this.korzen = new THREE.Group();
    this.korzen.add(this.grupa);
    this.korzen.add(this.cien);
    scena.add(this.korzen);
    this.scena = scena;
  }

  ustaw(x, z) { this.korzen.position.x = x; this.korzen.position.z = z; }

  get pozycja() { return this.korzen.position; }

  /* zwrócenie do kamery tylko wokół pionu: inaczej figura kładłaby się
     na boki, kiedy gracz patrzy w górę albo w dół */
  patrzNa(kamera, czas, dt) {
    const dx = kamera.position.x - this.korzen.position.x;
    const dz = kamera.position.z - this.korzen.position.z;
    this.grupa.rotation.y = Math.atan2(dx, dz);

    const t = czas + this.faza;
    this.grupa.position.y = this.wysokosc / 2 + Math.sin(t * 1.35) * 0.018 * this.kolysanie;
    this.grupa.rotation.z = Math.sin(t * 0.9) * 0.015 * this.kolysanie;
    const s = 1 + Math.sin(t * 1.35) * 0.03 * this.kolysanie;
    this.cien.scale.set(1 / s, 1 / s, 1);
  }

  widoczna(v) { this.korzen.visible = v; }

  usun() {
    this.scena.remove(this.korzen);
    this.korzen.traverse(o => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}
