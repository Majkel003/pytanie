/* Warstwa interfejsu: nakładki, przejścia, komunikaty.
   Logika gry woła te funkcje i nie dotyka DOM-u bezpośrednio. */

const $ = id => document.getElementById(id);
const czekaj = ms => new Promise(r => setTimeout(r, ms));

export const UI = {
  /* ─────── kurtyna: płynne ściemnienie między scenami ─────── */
  async zaslon(ms = 550) {
    $('kurtyna').classList.add('zaslona');
    await czekaj(ms);
  },
  async odsloń(ms = 550) {
    $('kurtyna').classList.remove('zaslona');
    await czekaj(ms);
  },

  /* ─────── czerwony przebłysk + trzęsienie: złapanie ─────── */
  uderzenie() {
    const b = $('blysk');
    b.classList.remove('gra');
    void b.offsetWidth;            // wymuszenie restartu animacji
    b.classList.add('gra');
    document.body.classList.add('potrzasniety');
    setTimeout(() => document.body.classList.remove('potrzasniety'), 450);
  },

  /* ─────── cel bieżącego etapu ─────── */
  cel(tekst) {
    const el = $('cel');
    el.querySelector('.tresc').textContent = tekst;
    el.style.display = tekst ? 'block' : 'none';
  },

  /* ─────── podpowiedź przy obiekcie („stuknij, żeby…") ─────── */
  podpowiedz(tekst) {
    const el = $('podpowiedz');
    if (!tekst) { el.classList.remove('widoczna'); return; }
    el.textContent = tekst;
    el.classList.add('widoczna');
  },

  /* ─────── zdanie na środku ekranu, samo znika ─────── */
  async szept(tekst, ms = 2600) {
    const el = $('szept');
    el.textContent = tekst;
    el.classList.add('widoczny');
    await czekaj(ms);
    el.classList.remove('widoczny');
    await czekaj(520);
  },

  /* ─────── nakładki pełnoekranowe ─────── */
  pokazNakladke(id, { znacznik, tytul, akapity = [], przycisk, wskazowka } = {}) {
    const el = $(id);
    el.innerHTML =
      (znacznik ? `<div class="znacznik">${znacznik}</div>` : '') +
      (tytul ? `<h1>${tytul}</h1>` : '') +
      akapity.map(a => `<p>${a}</p>`).join('') +
      (przycisk ? `<button class="przycisk" id="${id}Akcja">${przycisk}</button>` : '') +
      (wskazowka ? `<div class="wskazowka">${wskazowka}</div>` : '');
    el.classList.add('wlaczona');
    return przycisk ? $(id + 'Akcja') : null;
  },

  ukryjNakladke(id) { $(id).classList.remove('wlaczona'); },

  /* ─────── czy HUD widoczny ─────── */
  hud(wlaczony) {
    for (const id of ['mapkaRamka', 'cel']) {
      $(id).style.display = wlaczony ? '' : 'none';
    }
  }
};
