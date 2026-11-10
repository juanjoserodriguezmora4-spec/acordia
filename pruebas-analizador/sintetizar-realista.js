/*
 * Genera canciones de prueba más parecidas a una grabación real:
 *  - guitarra rasgueada (con las digitaciones reales de acordes.js y patrón abajo/arriba)
 *  - bajo en tiempos 1 y 3 con notas de paso
 *  - batería: bombo en 1 y 3, caja fuerte en 2 y 4, platillo en corcheas
 *  - voz: melodía de la escala con notas que no son del acorde, vibrato y deslizamientos
 *  - cambios de acorde anticipados (media corchea antes del compás)
 *  - intro sin batería, pequeñas variaciones de tempo y reverberación
 * Todas las progresiones son inventadas para las pruebas.
 * Devuelve el audio y la "verdad": pulsos, inicios de compás y acordes por tiempo.
 */
const path = require('path');
const Acordes = require(path.join(__dirname, '../src/main/resources/static/js/acordes.js'));

const AIRE = [40, 45, 50, 55, 59, 64]; // E2 A2 D3 G3 B3 E4

function crearAzar(semilla) {
  let s = semilla >>> 0 || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const hz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** Nota con armónicos que decaen (más rápido los agudos). */
function nota(x, sr, inicio, dur, midi, amp, { armonicos = 6, decaimiento = 2.5, brillo = 1, vibrato = 0, deslizarDesde = null, ataque = 0.004 } = {}) {
  const f0 = hz(midi);
  const i0 = Math.max(0, Math.floor(inicio * sr));
  const n = Math.min(x.length - i0, Math.floor((dur + 0.6) * sr));
  let fase = new Float64Array(armonicos + 1);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f = f0;
    if (deslizarDesde !== null && t < 0.06) f = hz(deslizarDesde + (midi - deslizarDesde) * (t / 0.06));
    if (vibrato) f *= 1 + vibrato * Math.sin(2 * Math.PI * 5.3 * t) * Math.min(1, t * 4);
    const soltar = t > dur ? Math.exp(-(t - dur) * 18) : 1;
    let y = 0;
    for (let h = 1; h <= armonicos; h++) {
      const fh = f * h;
      if (fh > sr * 0.45) break;
      fase[h] += 2 * Math.PI * fh / sr;
      y += Math.sin(fase[h]) * Math.exp(-decaimiento * t * (1 + 0.35 * (h - 1))) / Math.pow(h, 1.3 / brillo);
    }
    x[i0 + i] += amp * y * Math.min(1, t / ataque) * soltar;
  }
}

function ruido(x, sr, inicio, dur, amp, azar, { decaer = 30, filtro = 0 } = {}) {
  const i0 = Math.floor(inicio * sr), n = Math.min(x.length - i0, Math.floor(dur * sr));
  let anterior = 0;
  for (let i = 0; i < n; i++) {
    let r = azar() * 2 - 1;
    if (filtro) { const v = r - anterior; anterior = r; r = v * 0.5; } // pasa-altos sencillo
    x[i0 + i] += amp * r * Math.exp(-decaer * i / sr);
  }
}

function bombo(x, sr, t, amp) {
  const i0 = Math.floor(t * sr), n = Math.floor(0.25 * sr);
  let fase = 0;
  for (let i = 0; i < n && i0 + i < x.length; i++) {
    const tt = i / sr;
    fase += 2 * Math.PI * (50 + 90 * Math.exp(-35 * tt)) / sr;
    x[i0 + i] += amp * Math.sin(fase) * Math.exp(-14 * tt);
  }
}

function caja(x, sr, t, amp, azar) {
  ruido(x, sr, t, 0.2, amp * 0.8, azar, { decaer: 22 });
  const i0 = Math.floor(t * sr);
  for (let i = 0; i < 0.12 * sr && i0 + i < x.length; i++) x[i0 + i] += amp * 0.5 * Math.sin(2 * Math.PI * 185 * i / sr) * Math.exp(-30 * i / sr);
}

/** Reverberación sencilla (Schroeder: peines en paralelo). */
function reverberar(x, sr, cantidad) {
  const retardos = [0.0297, 0.0371, 0.0411, 0.0437].map(d => Math.round(d * sr));
  const salida = new Float32Array(x.length);
  for (const d of retardos) {
    const buf = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) buf[i] = x[i] + (i >= d ? 0.78 * buf[i - d] : 0);
    for (let i = 0; i < x.length; i++) salida[i] += buf[i] / retardos.length;
  }
  for (let i = 0; i < x.length; i++) x[i] = x[i] * (1 - cantidad) + salida[i] * cantidad;
}

/** Notas MIDI que suenan con la digitación de guitarra del acorde. */
function voicing(nombre) {
  const d = Acordes.digitacion(nombre);
  return d.trastes.map((f, c) => (f < 0 ? null : AIRE[c] + f)).filter(v => v !== null);
}

function raizMidi(nombre) {
  return 36 + Acordes.leer(nombre).raiz; // C2..B2
}

function triada(nombre) {
  const a = Acordes.leer(nombre);
  return Acordes.NOMBRES[a.raiz] + (Acordes.esMenor(a.calidad) ? 'm' : '');
}

/**
 * @param o.progresion  lista de { acorde, compases } (o string = 1 compás)
 * @param o.bpm, o.semilla, o.anticipar (prob. de adelantar el cambio 1/2 tiempo),
 * @param o.voz (volumen 0..1), o.deriva (variación de tempo, ej. 0.02), o.introSinBateria (compases)
 */
function sintetizar(o) {
  const sr = o.sr || 11025;
  const azar = crearAzar(o.semilla || 7);
  const progresion = o.progresion.map(p => (typeof p === 'string' ? { acorde: p, compases: 1 } : p));
  const totalCompases = progresion.reduce((s, p) => s + p.compases, 0);
  const totalPulsos = totalCompases * 4;
  const inicio = o.silencioInicial ?? 1.3;

  // Pulsos con deriva de tempo (paseo aleatorio suave)
  const pulsos = [];
  let t = inicio, periodo = 60 / o.bpm, desv = 0;
  for (let k = 0; k <= totalPulsos; k++) {
    pulsos.push(t);
    desv = 0.92 * desv + (azar() * 2 - 1) * (o.deriva ?? 0.012);
    t += periodo * (1 + desv);
  }
  const duracion = pulsos[totalPulsos] + 2.0;
  const x = new Float32Array(Math.ceil(duracion * sr));
  const tPulso = (b) => { // tiempo de un pulso fraccionario
    const k = Math.min(Math.floor(b), totalPulsos - 1);
    return pulsos[k] + (b - k) * (pulsos[k + 1] - pulsos[k]);
  };

  // Línea de acordes por pulso (con anticipaciones)
  const cambios = []; // { pulso (fraccionario), acorde }
  let b = 0;
  for (const p of progresion) {
    const ant = b > 0 && azar() < (o.anticipar ?? 0.35) ? 0.5 : 0;
    cambios.push({ pulso: b - ant, acorde: p.acorde });
    b += p.compases * 4;
  }
  const acordeEn = (pb) => { let a = cambios[0].acorde; for (const c of cambios) if (c.pulso <= pb + 1e-9) a = c.acorde; return a; };

  const introSinBateria = o.introSinBateria ?? 2;
  const vozVol = o.voz ?? 0.45;
  const escalaRaiz = Acordes.leer(o.tonalidad || progresion[0].acorde).raiz;
  const escala = (o.menor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11]).map(i => (i + escalaRaiz) % 12);

  // Patrón de rasgueo por corcheas: A=abajo, R=arriba, - = nada
  const patron = o.patron || ['A', '-', 'A', 'R', '-', 'R', 'A', 'R'];
  for (let compas = 0; compas < totalCompases; compas++) {
    const dinamica = 0.75 + 0.25 * Math.sin(compas / 3) + (azar() - 0.5) * 0.1;
    for (let e = 0; e < 8; e++) {
      const pb = compas * 4 + e / 2;
      const tt = tPulso(pb) + (azar() - 0.5) * 0.012; // humano: ±6 ms
      const acorde = acordeEn(pb);
      const notas = voicing(acorde);
      // --- guitarra
      const golpe = patron[e];
      if (golpe !== '-') {
        const orden = golpe === 'A' ? notas : notas.slice().reverse();
        const cuerdas = golpe === 'R' ? orden.slice(0, 4) : orden; // arriba: solo cuerdas agudas
        cuerdas.forEach((m, i) => nota(x, sr, tt + i * 0.011, 0.45, m, 0.10 * dinamica * (golpe === 'R' ? 0.7 : 1),
          { armonicos: 7, decaimiento: 3.2, brillo: 1.2 }));
      }
      // --- bajo
      if (e === 0 || e === 4) nota(x, sr, tt, 0.42, raizMidi(acorde), 0.32, { armonicos: 4, decaimiento: 3 });
      if (e === 6 && azar() < 0.4) nota(x, sr, tt, 0.2, raizMidi(acorde) + 7, 0.2, { armonicos: 4, decaimiento: 4 });
      // --- batería (después del intro)
      if (compas >= introSinBateria && compas < totalCompases - 1) {
        if (e === 0 || e === 4 || (e === 5 && azar() < 0.3)) bombo(x, sr, tt, 0.7);
        if (e === 2 || e === 6) caja(x, sr, tt, 0.55, azar);
        ruido(x, sr, tt, 0.05, e % 2 ? 0.05 : 0.08, azar, { decaer: 90, filtro: 1 });
      }
    }
  }
  // Acorde final sostenido
  voicing(cambios[cambios.length - 1].acorde).forEach((m, i) => nota(x, sr, pulsos[totalPulsos] + i * 0.015, 1.5, m, 0.1, { decaimiento: 1.2 }));

  // --- voz: frases de 2 compases con descanso
  if (vozVol > 0) {
    let midiAnterior = 67;
    for (let compas = introSinBateria; compas < totalCompases - 1; compas++) {
      if (compas % 4 === 3) continue; // respira
      for (let e = 0; e < 8; e++) {
        if (azar() < 0.3) continue;
        const pb = compas * 4 + e / 2;
        const acorde = Acordes.leer(acordeEn(pb));
        const tonos = [0, Acordes.esMenor(acorde.calidad) ? 3 : 4, 7].map(i => (i + acorde.raiz) % 12);
        // 60 % notas del acorde, 40 % otras notas de la escala
        const pc = azar() < 0.6 ? tonos[Math.floor(azar() * 3)] : escala[Math.floor(azar() * 7)];
        let midi = 60 + pc; if (midi < 62) midi += 12;
        const dur = (tPulso(pb + 0.5) - tPulso(pb)) * (azar() < 0.4 ? 2 : 1);
        nota(x, sr, tPulso(pb) + 0.02, dur, midi, vozVol * 0.22,
          { armonicos: 6, decaimiento: 0.4, brillo: 1.6, vibrato: 0.012, deslizarDesde: azar() < 0.3 ? midiAnterior : null, ataque: 0.04 });
        midiAnterior = midi;
      }
    }
  }

  reverberar(x, sr, o.reverb ?? 0.25);
  for (let i = 0; i < x.length; i++) x[i] += (azar() * 2 - 1) * 0.004;
  let max = 0; for (const v of x) max = Math.max(max, Math.abs(v));
  for (let i = 0; i < x.length; i++) x[i] = x[i] / max * 0.9;

  // La verdad
  const verdadPulsos = pulsos.slice(0, totalPulsos);
  const verdadCompases = verdadPulsos.filter((_, k) => k % 4 === 0);
  const segmentos = cambios.map((c, i) => ({
    inicio: tPulso(Math.max(0, c.pulso)),
    fin: i + 1 < cambios.length ? tPulso(cambios[i + 1].pulso) : pulsos[totalPulsos] + 1.5,
    acorde: triada(c.acorde)
  }));
  return { muestras: x, sr, duracion, verdad: { pulsos: verdadPulsos, compases: verdadCompases, segmentos, bpm: o.bpm } };
}

module.exports = { sintetizar };
