/*
 * Prueba el tempo (BPM) y los pulsos con canciones sintéticas de 72 a 188 BPM:
 *  - deriva 0: grabadas con metrónomo → el tempo debe salir entero y exacto, con pulsos parejos
 *  - deriva 0,004 y 0,012: tempo que se mueve un poco (como en vivo) → se siguen los golpes
 * Columnas: tempo detectado, error (contra el tempo real o su doble/mitad), % de pulsos a ±70 ms,
 * desfase promedio en el último 10 % de la canción y si se usó una rejilla pareja.
 * Ejecutar:  node pruebas-analizador/probar-tempo.js
 */
const path = require('path');
const A = require(path.join(__dirname, '../src/main/resources/static/js/analizador.js'));
const { sintetizar } = require('./sintetizar-realista.js');
const progs = [['G','D','Em','C'], ['C','Am','F','G'], ['A','D','E','D'], ['Am','F','C','G'], ['Eb','Ab','Bb','Cm']];
const filas = [];
let sem = 300;
for (const deriva of [0, 0.004, 0.012]) for (const bpm of [72, 88, 94, 100, 117, 123, 140, 156, 172, 188]) {
  const prog = progs[bpm % progs.length];
  const progresion = []; for (let k = 0; k < 40; k++) progresion.push(prog[k % 4]);
  const s = sintetizar({ bpm, progresion, semilla: sem++, deriva, voz: 0.4, introSinBateria: 1 });
  const r = A.analizar(s.muestras, s.sr, {});
  const v = s.verdad.pulsos;
  // ¿Pulsos al tempo detectado (o al doble/mitad)? Se compara contra la verdad en su propia escala.
  const tol = 0.07;
  let bien = 0, j = 0;
  const p = r.pulsos;
  const escala = r.bpm / bpm;
  const verdad = Math.abs(escala - 2) < 0.2 ? v.flatMap((t, i) => i + 1 < v.length ? [t, (t + v[i + 1]) / 2] : [t])
    : Math.abs(escala - 0.5) < 0.1 ? v.filter((_, i) => i % 2 === 0) : v;
  const real = Math.abs(escala - 2) < 0.2 ? bpm * 2 : Math.abs(escala - 0.5) < 0.1 ? bpm / 2 : bpm;
  for (const t of verdad) { while (j + 1 < p.length && Math.abs(p[j + 1] - t) <= Math.abs(p[j] - t)) j++; if (Math.abs(p[j] - t) <= tol) bien++; }
  // error al final: desfase medio del último 10 %
  const ult = verdad.slice(Math.floor(verdad.length * 0.9));
  let err = 0; j = 0; for (const t of ult) { while (j + 1 < p.length && Math.abs(p[j + 1] - t) <= Math.abs(p[j] - t)) j++; err += Math.abs(p[j] - t); }
  filas.push({ deriva, bpm, detectado: r.bpm, error: +(r.bpm - real).toFixed(2), aciertoPulsos: Math.round(100 * bien / verdad.length), finMs: Math.round(1000 * err / ult.length), pareja: r.tempoParejo });
}
console.table(filas);
const ok = filas.filter(f => Math.abs(f.error) < 0.5).length;
console.log(`tempo exacto (±0,5): ${ok}/${filas.length}   pulsos promedio ${Math.round(filas.reduce((s, f) => s + f.aciertoPulsos, 0) / filas.length)} %`);
