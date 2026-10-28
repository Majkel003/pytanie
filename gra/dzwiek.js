/* Cała warstwa dźwiękowa jest syntezowana w Web Audio: zero plików,
   zero czekania na pobranie, gra brzmi tak samo przy słabym zasięgu.

   Safari i iOS: kontekst wolno utworzyć dopiero w geście użytkownika,
   dlatego odblokuj() jest wołane z przycisku startu. Dodatkowo puszczamy
   cichy element <audio>, bo na iPhonie przestawia to sesję dźwiękową na
   „odtwarzanie" i dźwięk idzie z głośnika mimo przełącznika ciszy.      */

const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQQAAAAAAAAA';

export class Dzwiek {
  constructor() {
    this.ctx = null;
    this.wlaczony = true;
    this.gotowy = false;
    this.napiecieCel = 0;
    this.napiecieTeraz = 0;
  }

  /* ─────────── odblokowanie w geście użytkownika ─────────── */
  async odblokuj() {
    if (this.gotowy) { await this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    this.ctx = new AC();

    // pusty bufor: klasyczne odblokowanie iOS
    const b = this.ctx.createBuffer(1, 1, 22050);
    const s = this.ctx.createBufferSource();
    s.buffer = b; s.connect(this.ctx.destination); s.start(0);

    // Cichy, zapętlony element przestawia sesję iOS na „odtwarzanie".
    // Nie czekamy na niego: na iPhonie play() potrafi nigdy nie oddać
    // obietnicy, a wtedy cała gra stoi i nic się nie dzieje.
    try {
      this.cichy = new Audio(SILENT_WAV);
      this.cichy.loop = true;
      this.cichy.volume = 0.001;
      this.cichy.playsInline = true;
      this.cichy.setAttribute('playsinline', '');
      const obietnica = this.cichy.play();
      if (obietnica && obietnica.catch) obietnica.catch(() => {});
    } catch (e) { /* nie szkodzi, to tylko próba */ }

    // resume() też bywa, że nie wraca: dajemy mu sekundę i idziemy dalej
    await Promise.race([
      this.ctx.resume().catch(() => {}),
      new Promise(r => setTimeout(r, 1000))
    ]);
    this.#zbuduj();
    this.gotowy = true;
    return this.ctx.state === 'running';
  }

  /* ─────────── stały szkielet: mistrz, pogłos, warstwy ─────────── */
  #zbuduj() {
    const c = this.ctx;

    this.mistrz = c.createGain();
    this.mistrz.gain.value = this.wlaczony ? 1 : 0;
    this.mistrz.connect(c.destination);

    // pogłos kamiennego korytarza: odpowiedź impulsowa z gasnącego szumu
    this.poglos = c.createConvolver();
    this.poglos.buffer = this.#impuls(2.1, 2.6);
    const mokry = c.createGain(); mokry.gain.value = 0.34;
    this.poglos.connect(mokry); mokry.connect(this.mistrz);

    this.sucho = c.createGain(); this.sucho.gain.value = 0.9;
    this.sucho.connect(this.mistrz);

    this.wyjscie = c.createGain();            // wspólne wejście efektów
    this.wyjscie.connect(this.sucho);
    this.wyjscie.connect(this.poglos);

    this.#tlo();
    this.#napiecieWarstwa();
    this.#kapanie();
  }

  /* gasnący szum = prosty, przekonujący pogłos pomieszczenia */
  #impuls(sekundy, zanik) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sekundy);
    const buf = c.createBuffer(2, n, c.sampleRate);
    for (let k = 0; k < 2; k++) {
      const d = buf.getChannelData(k);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, zanik);
      }
    }
    return buf;
  }

  /* ─────────── tło: dudnienie + powolny akord ─────────── */
  #tlo() {
    const c = this.ctx;
    this.tlo = c.createGain(); this.tlo.gain.value = 0;
    this.tlo.connect(this.sucho);
    this.tlo.connect(this.poglos);

    // dudnienie: dwa rozstrojone piły przez filtr dolnoprzepustowy
    const filtr = c.createBiquadFilter();
    filtr.type = 'lowpass'; filtr.frequency.value = 190; filtr.Q.value = 2.2;
    filtr.connect(this.tlo);

    for (const f of [55, 55.37, 82.5]) {
      const o = c.createOscillator();
      o.type = f > 80 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = c.createGain(); g.gain.value = f > 80 ? 0.1 : 0.16;
      o.connect(g); g.connect(filtr); o.start();
    }

    // powolne przesuwanie filtra, żeby nie stało w miejscu
    const lfo = c.createOscillator(); lfo.frequency.value = 0.063;
    const lfoG = c.createGain(); lfoG.gain.value = 55;
    lfo.connect(lfoG); lfoG.connect(filtr.frequency); lfo.start();

    // akord molowy, bardzo cicho, oddychający własnym tempem
    const pad = c.createBiquadFilter();
    pad.type = 'lowpass'; pad.frequency.value = 760;
    const padG = c.createGain(); padG.gain.value = 0.0;
    pad.connect(padG); padG.connect(this.tlo);
    for (const f of [110, 130.81, 164.81, 196]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 9;
      const g = c.createGain(); g.gain.value = 0.055;
      o.connect(g); g.connect(pad); o.start();
    }
    const oddech = c.createOscillator(); oddech.frequency.value = 0.041;
    const oddechG = c.createGain(); oddechG.gain.value = 0.5;
    const przesun = c.createConstantSource(); przesun.offset.value = 0.5;
    oddech.connect(oddechG); oddechG.connect(padG.gain);
    przesun.connect(padG.gain);
    oddech.start(); przesun.start();
  }

  /* ─────────── warstwa napięcia: rośnie, gdy ktoś jest blisko ─────────── */
  #napiecieWarstwa() {
    const c = this.ctx;
    this.napG = c.createGain(); this.napG.gain.value = 0;
    this.napG.connect(this.sucho);
    this.napG.connect(this.poglos);

    // wysoki, drżący ton: nie straszy, ale podnosi puls
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1750; f.Q.value = 7;
    f.connect(this.napG);
    for (const h of [740, 988, 1480]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = h;
      o.detune.value = (Math.random() - 0.5) * 16;
      const g = c.createGain(); g.gain.value = 0.03;
      o.connect(g); g.connect(f); o.start();
    }
    const drzenie = c.createOscillator(); drzenie.frequency.value = 5.6;
    const drzenieG = c.createGain(); drzenieG.gain.value = 240;
    drzenie.connect(drzenieG); drzenieG.connect(f.frequency); drzenie.start();

    // powolne, niskie pulsowanie jak bicie serca
    this.puls = c.createGain(); this.puls.gain.value = 0;
    this.puls.connect(this.sucho);
    const po = c.createOscillator(); po.type = 'sine'; po.frequency.value = 48;
    po.connect(this.puls); po.start();
  }

  /* ─────────── pojedyncze kapnięcia w nieregularnych odstępach ─────────── */
  #kapanie() {
    const nastepne = () => {
      if (!this.gotowy) return;
      this.kropla();
      this.timerKropli = setTimeout(nastepne, 7000 + Math.random() * 17000);
    };
    this.timerKropli = setTimeout(nastepne, 5000 + Math.random() * 8000);
  }

  /* ─────────── sterowanie ─────────── */
  start() {
    if (!this.gotowy) return;
    const t = this.ctx.currentTime;
    this.tlo.gain.cancelScheduledValues(t);
    this.tlo.gain.setValueAtTime(this.tlo.gain.value, t);
    this.tlo.gain.linearRampToValueAtTime(0.5, t + 3.5);
    this.tloPoziom = 0.5;              // poziom odniesienia dla przyciszania
  }

  cisza(ms = 1200) {
    if (!this.gotowy) return;
    this.tloPoziom = undefined;
    const t = this.ctx.currentTime;
    this.tlo.gain.linearRampToValueAtTime(0, t + ms / 1000);
  }

  przelacz() {
    this.wlaczony = !this.wlaczony;
    if (this.gotowy) {
      const t = this.ctx.currentTime;
      this.mistrz.gain.cancelScheduledValues(t);
      this.mistrz.gain.setValueAtTime(this.mistrz.gain.value, t);
      this.mistrz.gain.linearRampToValueAtTime(this.wlaczony ? 1 : 0, t + 0.25);
    }
    return this.wlaczony;
  }

  /* 0 = spokój, 1 = ktoś tuż za plecami */
  napiecie(v) { this.napiecieCel = Math.max(0, Math.min(1, v)); }

  /* wołane co klatkę: płynne dojście do zadanego napięcia.
     Spokojne tło jest przy tym przyciszane, bo sama zmiana głośności
     jest słabo słyszalna, a podmiana warstwy natychmiast zwraca uwagę. */
  tik(dt) {
    if (!this.gotowy) return;
    const k = 1 - Math.exp(-2.4 * dt);
    this.napiecieTeraz += (this.napiecieCel - this.napiecieTeraz) * k;
    const n = this.napiecieTeraz, t = this.ctx.currentTime;
    this.napG.gain.setTargetAtTime(n * 0.85, t, 0.12);
    this.puls.gain.setTargetAtTime(n * 0.14, t, 0.12);
    if (this.tloPoziom !== undefined) {
      this.tlo.gain.setTargetAtTime(this.tloPoziom * (1 - 0.5 * n), t, 0.2);
    }
  }

  /* ─────────── efekty ─────────── */
  #szum(czas = 0.2) {
    const c = this.ctx, n = Math.floor(c.sampleRate * czas);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    return src;
  }

  #obwiednia(szczyt, atak, zanik) {
    const c = this.ctx, t = c.currentTime;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(szczyt, t + atak);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atak + zanik);
    return g;
  }

  krok() {
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    // chrzęst podeszwy
    const s = this.#szum(0.17);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 900 + Math.random() * 700;
    f.Q.value = 1.1;
    const g = this.#obwiednia(0.055 + Math.random() * 0.02, 0.004, 0.13);
    s.connect(f); f.connect(g); g.connect(this.wyjscie);
    s.start(t); s.stop(t + 0.18);
    // głuche uderzenie buta
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(96 + Math.random() * 18, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.1);
    const og = this.#obwiednia(0.07, 0.003, 0.1);
    o.connect(og); og.connect(this.sucho);
    o.start(t); o.stop(t + 0.14);
  }

  stuk() {                       // obicie się o ścianę
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(58, t + 0.14);
    const g = this.#obwiednia(0.1, 0.003, 0.16);
    o.connect(g); g.connect(this.wyjscie);
    o.start(t); o.stop(t + 0.2);
  }

  kropla() {
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sine';
    const f0 = 900 + Math.random() * 700;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.42, t + 0.09);
    const g = this.#obwiednia(0.05, 0.002, 0.14);
    o.connect(g); g.connect(this.poglos);
    o.start(t); o.stop(t + 0.2);
  }

  zdobycz() {                    // podniesiony przedmiot
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    [784, 1175.7].forEach((f, i) => {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.11, t + i * 0.09 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.55);
      o.connect(g); g.connect(this.wyjscie);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.6);
    });
  }

  zamek() {                      // zamknięte przejście: metaliczny szczęk
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.#szum(0.3);
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 11;
    const g = this.#obwiednia(0.16, 0.002, 0.32);
    s.connect(f); f.connect(g); g.connect(this.wyjscie);
    s.start(t); s.stop(t + 0.35);
  }

  otwarcie() {                   // przejście ustępuje: kamień na kamieniu
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const s = this.#szum(1.1);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(220, t);
    f.frequency.linearRampToValueAtTime(620, t + 0.9);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    s.connect(f); f.connect(g); g.connect(this.wyjscie);
    s.start(t); s.stop(t + 1.15);
  }

  zlapanie() {
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.55);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    const g = this.#obwiednia(0.26, 0.006, 0.7);
    o.connect(f); f.connect(g); g.connect(this.wyjscie);
    o.start(t); o.stop(t + 0.8);
  }

  klik() {
    if (!this.gotowy || !this.wlaczony) return;
    const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator();
    o.type = 'square'; o.frequency.value = 1320;
    const g = this.#obwiednia(0.035, 0.002, 0.05);
    o.connect(g); g.connect(this.sucho);
    o.start(t); o.stop(t + 0.07);
  }
}
