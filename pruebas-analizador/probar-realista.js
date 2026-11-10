/*
 * Prueba el analizador con canciones sintetizadas realistas (progresiones inventadas).
 * Mide:
 *   - Pulsos: % de pulsos detectados a menos de 70 ms del real (F-measure) y desfase promedio.
 *   - Compases: % de inicios de compás bien ubicados (si el analizador los entrega).
 *   - Acordes: % del tiempo con el acorde correcto (mayor/menor).
 * Ejecutar:  node pruebas-analizador/probar-realista.js
 */
const path = require('path');
const A = require(path.join(__dirname, '../src/main/resources/static/js/analizador.js'));
const { sintetizar } = require('./sintetizar-realista.js');

function fMedida(detectados, reales, tol = 0.07) {
  const usados = new Set();
  let aciertos = 0; const desfases = [];
  for (const r of reales) {
    let mejor = -1, dist = Infinity;
    detectados.forEach((d, i) => { const e = Math.abs(d - r); if (e < dist && !usados.has(i)) { dist = e; mejor = i; } });
    if (mejor >= 0 && dist <= tol) { usados.add(mejor); aciertos++; desfases.push(detectados[mejor] - r); }
  }
  const p = aciertos / Math.max(1, detectados.length), c = aciertos / Math.max(1, reales.length);
  const f = p + c ? 2 * p * c / (p + c) : 0;
  const desfase = desfases.length ? desfases.reduce((a, b) => a + b, 0) / desfases.length : NaN;
  return { f, desfase };
}

const Acordes = require(path.join(__dirname, '../src/main/resources/static/js/acordes.js'));

function aciertoAcordes(segmentos, eventos, desde, hasta) {
  let ok = 0, total = 0;
  // Se normaliza para que "G#" y "Ab" cuenten como el mismo acorde.
  const en = (lista, t) => { const e = lista.find(e => t >= e.inicio && t < e.fin); return e ? Acordes.normalizar(e.acorde) : 'N'; };
  for (let t = desde; t < hasta; t += 0.05) { total++; if (en(eventos, t) === en(segmentos, t)) ok++; }
  return ok / total;
}

const casos = [
  { nombre: 'Pop en Mi♭ (vi-IV-I-V), 100 BPM', bpm: 100, tonalidad: 'Eb',
    progresion: ['Cm', 'Ab', 'Eb', 'Bb', 'Cm', 'Ab', 'Eb', 'Bb', 'Ab', 'Bb', 'Cm', 'Cm', 'Ab', 'Bb', 'Eb', 'Eb', 'Cm', 'Ab', 'Eb', 'Bb'], semilla: 3 },
  { nombre: 'Balada en G, 72 BPM', bpm: 72, tonalidad: 'G', patron: ['A', '-', '-', 'R', 'A', '-', 'A', 'R'],
    progresion: ['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C', 'Am', 'Em', 'C', 'D', 'G', 'D', 'Em', 'C'], semilla: 5 },
  { nombre: 'Rock en E, 128 BPM, 2 acordes por compás', bpm: 128, tonalidad: 'E', voz: 0.5,
    progresion: ['E', 'A', 'B', 'A', 'E', 'C#m', 'A', 'B', 'E', 'A', 'B', 'A', 'C#m', 'A', 'E', 'B', 'E', 'E'].flatMap(a => [{ acorde: a, compases: 1 }]), semilla: 9 },
  { nombre: 'Menor en Am, 90 BPM, voz fuerte', bpm: 90, tonalidad: 'Am', menor: true, voz: 0.8,
    progresion: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E', 'Am', 'Dm', 'G', 'C', 'F', 'Dm', 'E', 'E'], semilla: 11 },
  { nombre: 'Pop en F#, 115 BPM, mucha anticipación', bpm: 115, tonalidad: 'F#', anticipar: 0.8,
    progresion: ['F#', 'C#', 'D#m', 'B', 'F#', 'C#', 'B', 'B', 'D#m', 'B', 'F#', 'C#', 'F#', 'C#', 'D#m', 'B'], semilla: 13 }
];

let sumaP = 0, sumaC = 0, sumaA = 0;
console.log('Caso'.padEnd(46), 'BPM real→det.', ' Pulsos', ' Desfase', ' Compás', ' Acordes', ' Tono');
for (const caso of casos) {
  const s = sintetizar(caso);
  const t0 = Date.now();
  const r = A.analizar(s.muestras, s.sr, caso.opciones || {});
  const ms = Date.now() - t0;
  const pul = fMedida(r.pulsos, s.verdad.pulsos);
  const compasesDet = r.compases ? r.compases.map(i => r.pulsos[i]) : [];
  const com = r.compases ? fMedida(compasesDet, s.verdad.compases) : { f: NaN };
  const acc = aciertoAcordes(s.verdad.segmentos, r.eventos, s.verdad.pulsos[0] + 0.1, s.verdad.pulsos[s.verdad.pulsos.length - 1]);
  sumaP += pul.f; sumaC += isNaN(com.f) ? 0 : com.f; sumaA += acc;
  console.log(caso.nombre.padEnd(46), `${caso.bpm}→${r.bpm}`.padEnd(13),
    `${(100 * pul.f).toFixed(0).padStart(5)} %`, `${isNaN(pul.desfase) ? '   —' : (1000 * pul.desfase).toFixed(0).padStart(5) + ' ms'}`,
    `${isNaN(com.f) ? '    —' : (100 * com.f).toFixed(0).padStart(5) + ' %'}`, `${(100 * acc).toFixed(1).padStart(6)} %`, ` ${r.tonalidad}`, ` (${ms} ms)`);
  if (process.argv.includes('-v')) console.log('    ', r.eventos.map(e => e.acorde).join(' '));
}
const n = casos.length;
console.log(`\nPROMEDIO  pulsos ${(100 * sumaP / n).toFixed(1)} %   compás ${(100 * sumaC / n).toFixed(1)} %   acordes ${(100 * sumaA / n).toFixed(1)} %`);
