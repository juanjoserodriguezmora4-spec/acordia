/* Verifica que cada digitación de ukelele suene exactamente las notas del acorde (12 tonos × 14 tipos).
   Ejecutar: node pruebas-analizador/probar-ukelele.js */
const A = require(require('path').join(__dirname, '../src/main/resources/static/js/acordes.js'));
const AIRE = [7, 0, 4, 9];
let fallos = 0, total = 0;
for (let raiz = 0; raiz < 12; raiz++) for (const q of Object.keys(A.INTERVALOS)) {
  const nombre = A.NOMBRES[raiz] + q; total++;
  const d = A.digitacionUkelele(nombre);
  if (!d) { fallos++; console.log('sin digitación', nombre); continue; }
  const suenan = new Set(d.trastes.map((f, c) => (f < 0 ? -1 : (AIRE[c] + f) % 12)).filter(v => v >= 0));
  const tonos = A.INTERVALOS[q].map(i => (raiz + i) % 12);
  const extra = [...suenan].filter(n => !tonos.includes(n));
  const faltan = tonos.filter((n, k) => !suenan.has(n) && !(tonos.length >= 4 && A.INTERVALOS[q][k] === 7));
  const p = d.trastes.filter(f => f > 0), abre = p.length ? Math.max(...p) - Math.min(...p) : 0;
  if (extra.length || faltan.length || abre > 3) { fallos++; console.log('MAL', nombre, d.trastes.join(''), extra, faltan); }
}
console.log(`${total - fallos}/${total} digitaciones de ukelele correctas`);
console.log('Comunes:', ['C', 'G', 'Am', 'F', 'D', 'Em', 'A', 'E7', 'Bb'].map(n => n + '=' + A.digitacionUkelele(n).trastes.join('')).join('  '));
