/* Verifica que cada digitación de guitarra suene exactamente las notas del acorde (12 tonos × 14 tipos).
   Ejecutar: node pruebas-analizador/probar-digitaciones.js */
const A = require(require('path').join(__dirname, '../src/main/resources/static/js/acordes.js'));
const AIRE = [4, 9, 2, 7, 11, 4]; // E A D G B E
const INTERVALOS = { '':[0,4,7], m:[0,3,7], '7':[0,4,7,10], m7:[0,3,7,10], maj7:[0,4,7,11], sus2:[0,2,7], sus4:[0,5,7],
  '5':[0,7], dim:[0,3,6], aug:[0,4,8], add9:[0,2,4,7], '6':[0,4,7,9], m6:[0,3,7,9], '9':[0,2,4,7,10] };
// Notas que pueden faltar sin que el acorde deje de serlo (la quinta se omite a menudo)
const OPCIONAL = { maj7:[7], '7':[7], m7:[], '9':[7] };
let fallos = 0, total = 0;
for (let raiz = 0; raiz < 12; raiz++) for (const q of Object.keys(INTERVALOS)) {
  const nombre = A.NOMBRES[raiz] + q; total++;
  const d = A.digitacion(nombre);
  if (!d) { fallos++; console.log('sin digitación', nombre); continue; }
  const suenan = new Set(d.trastes.map((t, c) => t < 0 ? -1 : (AIRE[c] + t) % 12).filter(v => v >= 0));
  const esperadas = new Set(INTERVALOS[q].map(i => (raiz + i) % 12));
  const extra = [...suenan].filter(n => !esperadas.has(n));
  const faltan = [...esperadas].filter(n => !suenan.has(n) && !(OPCIONAL[q] || []).includes((n - raiz + 12) % 12));
  const maxT = Math.max(...d.trastes.filter(t => t > 0), 0), minT = Math.min(...d.trastes.filter(t => t > 0), 99);
  if (extra.length || faltan.length || (maxT - minT > 4)) {
    fallos++; console.log('MAL', nombre, d.trastes.join(','), 'extra', extra, 'faltan', faltan);
  }
}
console.log(`${total - fallos}/${total} digitaciones correctas`);
// lectura de nombres
const casos = { 'Bad': null, 'Am7': 'Am7', 'Lam': 'Am', 'Sol7': 'G7', 'Fa#m': 'F#m', 'Bbmaj7': 'Bbmaj7', 'D/F#': 'D/F#', 'Csus4': 'Csus4',
  'N': 'N', 'E7sus4': 'E7sus4', 'Amin': 'Am', 'A#': 'Bb', 'hola': null };
for (const [e, s] of Object.entries(casos)) { const r = A.normalizar(e); if (r !== s) { fallos++; console.log('lectura', e, '→', r, 'esperaba', s); } }
console.log('transponer G +2 =', A.transponer('G', 2), '| D/F# -2 =', A.transponer('D/F#', -2), '| latino Bbm7:', A.mostrar('Bbm7', 0, 'latina'));
console.log(fallos ? 'HAY FALLOS' : 'TODO BIEN');
