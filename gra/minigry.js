/* Minigierki jako nakładki w HTML, nie w 3D: na telefonie stukanie
   w elementy strony jest pewniejsze niż trafianie w obiekty w scenie,
   a Safari nie gubi zdarzeń dotyku.                                   */

const $ = id => document.getElementById(id);

/* ─────────── Ratuj Fenka przed pająkami ───────────
   Pająki schodzą się ze wszystkich stron do Fenka w środku areny.
   Stuknięcie strąca pająka. Trzy, które dojdą, kończą próbę.        */
export function ratujFenka(dzwiek, { doZlapania = 12, zycia = 4, czasFali = 950 } = {}) {
  return new Promise(resolve => {
    const nakladka = $('minigra');
    nakladka.innerHTML =
      '<div class="mgpasek">' +
        '<span class="mgcel">Strąć pająki z Fenka</span>' +
        '<span class="mgzycia" id="mgzycia"></span>' +
      '</div>' +
      '<div class="mgarena" id="mgarena">' +
        '<img class="mgfenek" src="postacie/fenek.png" alt="">' +
        '<div class="mglicznik" id="mglicznik">0 / ' + doZlapania + '</div>' +
      '</div>';
    nakladka.classList.add('wlaczona');

    const arena = $('mgarena');
    let stracone = 0, zostalo = zycia, koniec = false;
    const zyjace = new Set();
    const czasomierze = [];

    const rysujZycia = () => {
      const z = Math.max(0, Math.min(zycia, zostalo));
      $('mgzycia').textContent = '●'.repeat(z) + '○'.repeat(zycia - z);
    };
    rysujZycia();

    const sprzataj = () => {
      czasomierze.forEach(t => clearTimeout(t));
      zyjace.forEach(p => p.el.remove());
      zyjace.clear();
    };

    const zakoncz = (wygrana) => {
      if (koniec) return;
      koniec = true;
      sprzataj();
      nakladka.classList.remove('wlaczona');
      resolve(wygrana);
    };

    function nowyPajak() {
      if (koniec) return;
      const r = arena.getBoundingClientRect();
      const el = document.createElement('div');
      el.className = 'mgpajak';
      el.textContent = '🕷';

      // start przy losowej krawędzi, cel w środku
      const bok = Math.floor(Math.random() * 4);
      const start = [
        [Math.random() * r.width, -34],
        [r.width + 34, Math.random() * r.height],
        [Math.random() * r.width, r.height + 34],
        [-34, Math.random() * r.height]
      ][bok];

      const p = { el, x: start[0], y: start[1],
                  cx: r.width / 2, cy: r.height / 2,
                  predkosc: 24 + Math.random() * 18 };
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.addEventListener('pointerdown', ev => {
        ev.preventDefault();
        if (koniec || !zyjace.has(p)) return;
        zyjace.delete(p);
        el.classList.add('zgnieciony');
        czasomierze.push(setTimeout(() => el.remove(), 260));
        stracone++;
        dzwiek?.stuk();
        $('mglicznik').textContent = stracone + ' / ' + doZlapania;
        if (stracone >= doZlapania) { dzwiek?.zdobycz(); zakoncz(true); }
      });
      arena.appendChild(el);
      zyjace.add(p);
    }

    // fale pająków, coraz gęstsze
    let fala = 0;
    const kolejnaFala = () => {
      if (koniec) return;
      fala++;
      const ile = 1 + Math.floor(fala / 6);
      for (let i = 0; i < ile; i++) czasomierze.push(setTimeout(nowyPajak, i * 180));
      czasomierze.push(setTimeout(kolejnaFala, Math.max(520, czasFali - fala * 18)));
    };
    czasomierze.push(setTimeout(kolejnaFala, 420));

    let ostatni = performance.now();
    (function klatka(teraz) {
      if (koniec) return;
      requestAnimationFrame(klatka);
      const dt = Math.min((teraz - ostatni) / 1000, 0.05);
      ostatni = teraz;

      for (const p of [...zyjace]) {
        const dx = p.cx - p.x, dy = p.cy - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.x += dx / d * p.predkosc * dt;
        p.y += dy / d * p.predkosc * dt;
        const kat = Math.atan2(dy, dx) + Math.PI / 2;
        p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${kat}rad)`;

        if (d < 34) {
          zyjace.delete(p);
          p.el.remove();
          if (koniec) continue;
          zostalo--;
          rysujZycia();
          dzwiek?.zlapanie();
          document.getElementById('mgarena').classList.add('trafiony');
          setTimeout(() => document.getElementById('mgarena')?.classList.remove('trafiony'), 320);
          if (zostalo <= 0) zakoncz(false);
        }
      }
    })(ostatni);
  });
}

/* ─────────── Jumpscare pająka ───────────
   Prawdziwy model wstawiony tuż przed kamerę zamiast obrazka: ta sama
   bryła, którą widać w korytarzu, więc nie ma wrażenia podmiany.      */
export function jumpscare(gra, pajak, dzwiek, ms = 900) {
  return new Promise(resolve => {
    const kam = gra.kamera;
    const zapamietane = {
      poz: pajak.korzen.position.clone(),
      obrot: pajak.korzen.rotation.y,
      skala: pajak.korzen.scale.x
    };

    const przod = { x: -Math.sin(gra.obrot.y), z: -Math.cos(gra.obrot.y) };
    pajak.korzen.position.set(kam.position.x + przod.x * 1.15, 0.2,
                              kam.position.z + przod.z * 1.15);
    pajak.korzen.rotation.y = gra.obrot.y + Math.PI;
    pajak.korzen.scale.setScalar(zapamietane.skala * 2.3);

    gra.zamrozony = true;
    dzwiek?.zlapanie();
    document.body.classList.add('potrzasniety');
    const b = document.getElementById('blysk');
    b.classList.remove('gra'); void b.offsetWidth; b.classList.add('gra');

    setTimeout(() => {
      pajak.korzen.position.copy(zapamietane.poz);
      pajak.korzen.rotation.y = zapamietane.obrot;
      pajak.korzen.scale.setScalar(zapamietane.skala);
      document.body.classList.remove('potrzasniety');
      gra.zamrozony = false;
      resolve();
    }, ms);
  });
}
