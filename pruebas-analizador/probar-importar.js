/*
 * Prueba la importación de acordes (static/js/importar-imagen.js) sin OCR:
 *  - detectar la parrilla en una imagen dibujada (casillas blancas, rayas grises, barras de compás,
 *    una casilla resaltada oscura y una columna entera que no se reconoce),
 *  - detectar una raya de "sigue", y
 *  - leer el texto por pulsos y ubicarlo dentro de una canción.
 * Ejecutar:  node pruebas-analizador/probar-importar.js
 */
const path = require('path');
const I = require(path.join(__dirname, '../src/main/resources/static/js/importar-imagen.js'));
const Ac = require(path.join(__dirname, '../src/main/resources/static/js/acordes.js'));
let fallas = 0;
const revisar = (nombre, ok, detalle = '') => { console.log(`${ok ? 'OK ' : 'MAL'} ${nombre}${detalle ? ' — ' + detalle : ''}`); if (!ok) fallas++; };

// ---------- imagen dibujada: 3 filas x 16 casillas de 40 px, raya de 2 px, barra gruesa cada 4
const W = 720, H = 150, data = new Uint8ClampedArray(W * H * 4);
const pintar = (x0, y0, w, h, v) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { if (x < 0 || y < 0 || x >= W || y >= H) continue; const k = (y * W + x) * 4; data[k] = data[k + 1] = data[k + 2] = v; data[k + 3] = 255; } };
pintar(0, 0, W, H, 221);                 // fondo gris (rayas)
const xs = []; let x = 4;
for (let c = 0; c < 16; c++) { if (c > 0 && c % 4 === 0) x += 6; xs.push(x); x += 42; }
for (let f = 0; f < 3; f++) for (let c = 0; c < 16; c++) {
  const y = 4 + f * 46;
  if (f === 1 && c === 5) { pintar(xs[c], y, 40, 42, 40); continue; }      // casilla resaltada (oscura)
  if (c === 3) { pintar(xs[c], y, 40, 42, 236 - 20); continue; }            // columna que no se ve blanca
  pintar(xs[c], y, 40, 42, 248);
  if (f === 2 && c === 9) pintar(xs[c] + 8, y + 20, 24, 2, 150);            // raya de "sigue"
  if (f === 2 && c === 12) pintar(xs[c] + 17, y + 10, 5, 20, 40);           // símbolo de silencio (trazo angosto)
  if (f === 2 && c === 13) { pintar(xs[c] + 8, y + 12, 16, 18, 40); pintar(xs[c] + 28, y + 8, 6, 9, 120); } // letra + superíndice
}
const red = I.detectarCeldas({ width: W, height: H, data });
revisar('parrilla de 3 x 16', red.filas === 3 && red.columnas === 16, `${red.filas} x ${red.columnas}`);
revisar('casilla resaltada ubicada', red.celdas.some(c => c.fila === 1 && c.col === 5 && !c.existe));
const raya = I.contenidoCelda({ width: W, height: H, data }, red.celdas.find(c => c.fila === 2 && c.col === 9));
revisar('raya = sigue el acorde', raya.tipo === 'raya', raya.tipo);
const vacia = I.contenidoCelda({ width: W, height: H, data }, red.celdas.find(c => c.fila === 0 && c.col === 0));
revisar('casilla vacía', vacia.tipo === 'vacio', vacia.tipo);

const sil = I.contenidoCelda({ width: W, height: H, data }, red.celdas.find(c => c.fila === 2 && c.col === 12));
revisar('trazo alto y angosto = silencio', sil.tipo === 'silencio', sil.tipo);
const sup = I.contenidoCelda({ width: W, height: H, data }, red.celdas.find(c => c.fila === 2 && c.col === 13));
revisar('superíndice separado (el 7 de Sol⁷)', sup.tipo === 'texto' && !!sup.superindice, sup.tipo);

// ---------- texto por pulsos
const leer = (t) => { const a = Ac.leer(t); return a && !a.sinAcorde ? Ac.normalizar(t) : null; };
const { pulsos, errores } = I.parsearTexto('Mib . . . | La♭ . N . | Dom . . . | Xyz . . .', leer);
revisar('16 pulsos leídos', pulsos.length === 16, String(pulsos.length));
revisar('notación latina y ♭', pulsos[0].acorde === 'Eb' && pulsos[4].acorde === 'G#' && pulsos[8].acorde === 'Cm');
revisar('N = silencio', pulsos[6].tipo === 'N');
revisar('lo que no se entiende se avisa', errores.length === 1 && errores[0] === 'Xyz', errores.join(','));
const sec = I.resolver(pulsos);
revisar('los puntos siguen el acorde anterior', sec[1] === 'Eb' && sec[7] === 'N' && sec[11] === 'Cm');

// ---------- ubicar dentro de la canción
const triada = (a) => { const x = Ac.leer(a); return x && !x.sinAcorde ? Ac.NOMBRES[x.raiz] + (Ac.esMenor(x.calidad) ? 'm' : '') : null; };
const cancion = [];
const prog = ['Eb', 'Ab', 'Bb', 'Cm', 'Ab', 'Bb', 'Eb', 'Eb', 'Cm', 'Gm', 'Ab', 'Bb'];
for (const a of prog) for (let k = 0; k < 4; k++) cancion.push(Ac.normalizar(a));
const trozo = I.resolver(I.parsearTexto('Dom . . . | . . . . | Solm . . . | Lab . . . | Sib . . .', leer).pulsos);
const u = I.ubicar(trozo, cancion, (a, b) => triada(a) === triada(b), (i) => i % 4 === 0);
revisar('ubicado en el compás correcto', u.inicio === 28, `inicio ${u.inicio}, coincidencia ${Math.round(u.coincidencia * 100)} %`);

// ---------- lectura del OCR
revisar('"La" + ♭ + "m" = Labm', I.unirLectura('La', 'b', 'm') === 'Labm');
revisar('basura antes del ♭ se limpia', I.leerAcorde('Misb', leer) === 'Mib');
revisar('Dorn → Dom', I.leerAcorde('Dorn', leer) === 'Dom');
revisar('bajo cortado: Sib/Ri → Sib/Re', I.leerAcorde('Sib/Ri', leer) === 'Sib/Re', I.leerAcorde('Sib/Ri', leer));
const conGris = I.parsearTexto('_ _ N . | Mib . . .', leer).pulsos;
revisar('"_" = casilla fuera de la canción', conGris[0].tipo === 'fuera' && conGris[1].tipo === 'fuera' && conGris[2].tipo === 'N');

console.log(fallas ? `\n${fallas} prueba(s) fallaron` : '\nTodas las pruebas pasaron');
process.exit(fallas ? 1 : 0);
