/*
 * Pruebas del analizador de acordes con canciones SINTETIZADAS (se generan aquí mismo, con
 * progresiones inventadas). Como se sabe exactamente qué acorde suena en cada momento, se puede
 * medir el porcentaje de acierto.
 *
 * Ejecutar:  node pruebas-analizador/probar-analizador.js
 */
const path = require('path');
const A = require(path.join(__dirname, '../src/main/resources/static/js/analizador.js'));
const { sintetizar } = require('./sintetizar.js');

function acierto(s, r) {
  let ok = 0, total = 0;
  const en = (x) => { const e = r.eventos.find(e => x >= e.inicio && x < e.fin); return e ? e.acorde : '?'; };
  for (let x = s.verdad[0].t + 0.15; x < s.verdad[s.verdad.length - 1].t; x += 0.1) {
    let v; for (const p of s.verdad) if (p.t <= x) v = p.acorde;
    total++; if (en(x) === v) ok++;
  }
  return 100 * ok / total;
}

/** Agrega una "voz": una melodía fuerte con notas que no siempre son del acorde. */
function agregarMelodia(s, bpm, volumen) {
  const escala = [7, 9, 11, 0, 2, 4, 6];
  let semilla = 42; const azar = () => { semilla = (semilla * 16807) % 2147483647; return semilla / 2147483647; };
  const dur = 60 / bpm / 2;
  for (let t = 0.7; t < s.duracion - 0.5; t += dur) {
    const f = 440 * Math.pow(2, (72 + escala[Math.floor(azar() * 7)] - 69) / 12);
    const i0 = Math.floor(t * s.sr);
    for (let i = 0; i < Math.floor(dur * s.sr) && i0 + i < s.muestras.length; i++) {
      const tt = i / s.sr, vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * tt);
      s.muestras[i0 + i] += volumen * (Math.sin(2 * Math.PI * f * vib * tt) + 0.4 * Math.sin(4 * Math.PI * f * vib * tt)) * Math.min(1, tt * 20);
    }
  }
  return s;
}

const prog = ['G', 'Em', 'C', 'D', 'G', 'Em', 'Am', 'D', 'C', 'D', 'G', 'G', 'Am', 'F', 'C', 'G'];
const refG = { acordesSimplificados: ['G', 'Em', 'C', 'D', 'Am', 'F'], secuencia: prog };
const casos = [
  ['Limpia, 100 BPM', { progresion: prog, bpm: 100, pulsosPorAcorde: 4 }],
  ['Rápida, 128 BPM, 2 pulsos por acorde', { progresion: prog, bpm: 128, pulsosPorAcorde: 2, semilla: 7 }],
  ['Lenta, 76 BPM', { progresion: prog, bpm: 76, pulsosPorAcorde: 4, semilla: 3 }],
  ['Desafinada +30 cents', { progresion: prog, bpm: 100, pulsosPorAcorde: 4, desafinacionCents: 30, semilla: 5 }],
  ['Mucho ruido', { progresion: prog, bpm: 100, pulsosPorAcorde: 4, ruido: 0.6, semilla: 9 }],
  ['Con referencia, audio 2 semitonos arriba', { progresion: prog, bpm: 100, pulsosPorAcorde: 4, transponer: 2, ruido: 0.4, semilla: 11 }, { referencia: refG }],
  ['Con referencia equivocada (debe ignorarla)', { progresion: prog, bpm: 100, pulsosPorAcorde: 4, semilla: 13 }, { referencia: { acordesSimplificados: ['C#m', 'F#m'], secuencia: ['C#m', 'F#m'] } }],
  ['Melodía fuerte, sin referencia', { progresion: prog, bpm: 96, pulsosPorAcorde: 4, ruido: 0.5, semilla: 21 }, {}, 0.5],
  ['Melodía fuerte, con referencia', { progresion: prog, bpm: 96, pulsosPorAcorde: 4, ruido: 0.5, semilla: 21 }, { referencia: refG }, 0.5]
];

console.log('Caso'.padEnd(46), 'BPM real→detectado', ' Acierto', ' Notas');
for (const [nombre, conf, opciones = {}, melodia = 0] of casos) {
  const s = sintetizar(conf);
  if (melodia) agregarMelodia(s, conf.bpm, melodia);
  const r = A.analizar(s.muestras, s.sr, opciones);
  const notas = [];
  if (r.afinacionCents) notas.push(`afinación ${r.afinacionCents > 0 ? '+' : ''}${r.afinacionCents} cents`);
  if (r.transposicionReferencia) notas.push(`referencia transpuesta +${r.transposicionReferencia}`);
  if (r.referenciaConfiable === false) notas.push('referencia descartada');
  console.log(nombre.padEnd(46), `${conf.bpm} → ${r.bpm}`.padEnd(18), `${acierto(s, r).toFixed(1).padStart(6)} %`, ' ', notas.join(', '));
}
