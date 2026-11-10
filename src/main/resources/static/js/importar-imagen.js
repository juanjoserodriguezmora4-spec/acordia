/*
 * Acordia — importar acordes desde una imagen de una parrilla (por ejemplo, una captura de Chordify)
 * o desde texto escrito por pulsos.
 *
 * Pasos con una imagen:
 *   1. detectarCeldas: encuentra las casillas blancas de la parrilla (regiones blancas conectadas),
 *      las ordena en filas y columnas, y completa las que faltan (la casilla resaltada o tapada).
 *   2. contenidoCelda: mira si la casilla tiene texto, una raya ("sigue") o nada, y recorta el texto
 *      ampliado en blanco y negro para el reconocimiento de texto (OCR).
 *   3. El OCR (Tesseract.js) lee cada recorte y leerAcorde lo convierte en un acorde.
 *   4. aTexto arma el texto por pulsos para que el usuario lo revise antes de aplicarlo.
 *
 * Formato de texto (un elemento por pulso, separados por espacios):
 *   Mib . . . | Lab . . .      el punto = sigue el acorde anterior; "|" separa compases (opcional)
 *   N  o  x                    = sin acorde (silencio)
 *   _                          = casilla gris antes del inicio (o después del final) de la canción
 *
 * No depende del navegador, así que se puede probar en Node.
 */
(function (global) {
  'use strict';

  const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  // ================================================================ 1. Casillas
  /**
   * @param img {width, height, data} (como ImageData: RGBA)
   * @returns {{filas:number, columnas:number, celdas:Array, ancho:number, alto:number}}
   */
  function detectarCeldas(img) {
    const { width: W, height: H, data } = img;
    const blanco = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const mx = Math.max(data[i], data[i + 1], data[i + 2]), mn = Math.min(data[i], data[i + 1], data[i + 2]);
      blanco[p] = lum(data, i) >= 236 && mx - mn < 30 ? 1 : 0;
    }
    // Regiones blancas conectadas (cada casilla es una región; las rayas grises las separan).
    const visto = new Uint8Array(W * H);
    const pila = new Int32Array(W * H);
    const regiones = [];
    for (let s = 0; s < W * H; s++) {
      if (!blanco[s] || visto[s]) continue;
      let tope = 0, cuenta = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
      pila[tope++] = s; visto[s] = 1;
      while (tope) {
        const p = pila[--tope];
        const x = p % W, y = (p - x) / W;
        cuenta++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && blanco[p - 1] && !visto[p - 1]) { visto[p - 1] = 1; pila[tope++] = p - 1; }
        if (x < W - 1 && blanco[p + 1] && !visto[p + 1]) { visto[p + 1] = 1; pila[tope++] = p + 1; }
        if (y > 0 && blanco[p - W] && !visto[p - W]) { visto[p - W] = 1; pila[tope++] = p - W; }
        if (y < H - 1 && blanco[p + W] && !visto[p + W]) { visto[p + W] = 1; pila[tope++] = p + W; }
      }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      if (w >= 14 && h >= 14 && cuenta / (w * h) > 0.55) regiones.push({ x: x0, y: y0, w, h, cuenta });
    }
    if (regiones.length < 4) throw new Error('No encontré una parrilla de acordes en la imagen. Recorta la captura para que se vean las casillas.');

    // Tamaño típico de casilla: la mediana de las regiones con forma de casilla.
    const mediana = (v) => { const o = v.slice().sort((a, b) => a - b); return o[o.length >> 1]; };
    const formaCasilla = regiones.filter(r => r.w < W * 0.3 && r.h < H * 0.5 && r.w / r.h > 0.4 && r.w / r.h < 3);
    if (formaCasilla.length < 4) throw new Error('No encontré casillas en la imagen.');
    const aw = mediana(formaCasilla.map(r => r.w)), ah = mediana(formaCasilla.map(r => r.h));
    // Se aceptan casillas cortadas por el borde de la imagen (más angostas), pero no regiones gigantes.
    const tocaBorde = (r) => r.x <= 1 || r.y <= 1 || r.x + r.w >= W - 1 || r.y + r.h >= H - 1;
    const celdas = regiones.filter(r => r.w <= aw * 1.35 && r.h <= ah * 1.35 &&
      r.h >= ah * (tocaBorde(r) ? 0.45 : 0.7) && r.w >= aw * (tocaBorde(r) ? 0.45 : 0.7));

    // Columnas y filas: se agrupan los centros. Para casillas cortadas por el borde se usa el borde
    // que sí se ve, para que su centro no quede corrido.
    const cx = (r) => (r.w >= aw * 0.95 ? r.x + r.w / 2 : r.x <= 1 ? r.x + r.w - aw / 2 : r.x + aw / 2);
    const cy = (r) => (r.h >= ah * 0.95 ? r.y + r.h / 2 : r.y <= 1 ? r.y + r.h - ah / 2 : r.y + ah / 2);
    const agrupar = (valores, separacion) => {
      const o = valores.slice().sort((a, b) => a - b);
      const grupos = [];
      for (const v of o) {
        const g = grupos[grupos.length - 1];
        if (g && v - g[g.length - 1] < separacion) g.push(v); else grupos.push([v]);
      }
      return grupos.map(mediana);
    };
    // Si falta una columna o fila entera (porque ninguna de sus casillas se reconoció), se deduce
    // del paso regular de la parrilla.
    const completar = (centros, tam) => {
      if (centros.length < 2) return centros;
      const pasos = [];
      for (let i = 1; i < centros.length; i++) if (centros[i] - centros[i - 1] < tam * 1.5) pasos.push(centros[i] - centros[i - 1]);
      const paso = pasos.length ? mediana(pasos) : tam;
      const out = [centros[0]];
      for (let i = 1; i < centros.length; i++) {
        const salto = centros[i] - centros[i - 1];
        const faltan = Math.round(salto / paso) - 1;
        for (let k = 1; k <= faltan; k++) out.push(centros[i - 1] + salto * k / (faltan + 1));
        out.push(centros[i]);
      }
      return out;
    };
    const xs = completar(agrupar(celdas.map(cx), aw * 0.5), aw);
    const ys = completar(agrupar(celdas.map(cy), ah * 0.5), ah);
    const cercano = (lista, v) => { let k = 0; lista.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(lista[k] - v)) k = i; }); return k; };

    const malla = [];
    for (let f = 0; f < ys.length; f++) for (let c = 0; c < xs.length; c++) malla.push(null);
    for (const r of celdas) {
      const f = cercano(ys, cy(r)), c = cercano(xs, cx(r));
      const k = f * xs.length + c;
      if (!malla[k] || r.cuenta > malla[k].cuenta) malla[k] = r;
    }
    const resultado = [];
    for (let f = 0; f < ys.length; f++) {
      for (let c = 0; c < xs.length; c++) {
        const r = malla[f * xs.length + c];
        if (r) resultado.push({ fila: f, col: c, x: r.x, y: r.y, w: r.w, h: r.h, existe: true });
        else {
          // Casilla sin región blanca: la resaltada (oscura) o una tapada. Se usa su lugar en la malla.
          const x = Math.round(xs[c] - aw / 2), y = Math.round(ys[f] - ah / 2);
          resultado.push({ fila: f, col: c, x: Math.max(0, x), y: Math.max(0, y),
            w: Math.min(aw, W - Math.max(0, x)), h: Math.min(ah, H - Math.max(0, y)), existe: false });
        }
      }
    }
    return { filas: ys.length, columnas: xs.length, celdas: resultado, ancho: aw, alto: ah };
  }

  // ================================================================ 2. Contenido de cada casilla
  /**
   * @returns {{tipo:'vacio'|'raya'|'silencio'|'texto', partes?, alteracion?, superindice?, tinta?: {w,h}}}
   */
  function contenidoCelda(img, celda, opciones = {}) {
    const umbralTinta = opciones.umbralTinta ?? 55;   // cuánto más oscuro que el fondo cuenta como tinta
    const gris = opciones.gris ?? false;              // false = blanco y negro (dio mejores resultados)
    const { width: W, data } = img;
    // La región blanca ya excluye las rayas de la parrilla: basta 1 pixel (el texto empieza pegado al borde).
    const borde = celda.existe === false ? Math.max(2, Math.round(Math.min(celda.w, celda.h) * 0.08)) : 1;
    const x0 = celda.x + borde, y0 = celda.y + borde;
    const w = celda.w - 2 * borde, h = celda.h - 2 * borde;
    if (w < 4 || h < 4) return { tipo: 'vacio' };
    // ¿Casilla oscura (la resaltada)? Entonces el texto es claro: se invierte.
    let suma = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) suma += lum(data, ((y0 + y) * W + x0 + x) * 4);
    const invertir = suma / (w * h) < 110;
    // Fondo de la casilla: el valor más común (el texto ocupa poco).
    const hist = new Uint32Array(256);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const l = lum(data, ((y0 + y) * W + x0 + x) * 4); hist[Math.round(invertir ? l : 255 - l)]++;
    }
    let fondo = 0; for (let v = 1; v < 256; v++) if (hist[v] > hist[fondo]) fondo = v;
    const oscuridad = (x, y) => { const l = lum(data, ((y0 + y) * W + x0 + x) * 4); return Math.max(0, (invertir ? l : 255 - l) - fondo); };
    // Tinta: bastante más oscura que el fondo (el texto de color también cuenta).
    let tx0 = w, ty0 = h, tx1 = -1, ty1 = -1, cuenta = 0; // tx1 puede achicarse si hay superíndice
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (oscuridad(x, y) > umbralTinta) { cuenta++; if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
    }
    if (cuenta < 6) return { tipo: 'vacio' };
    const tw = tx1 - tx0 + 1, th = ty1 - ty0 + 1;
    // Una raya horizontal delgada (como "——") significa que sigue el acorde anterior.
    if (th <= Math.max(3, h * 0.15) && tw >= w * 0.25) return { tipo: 'raya' };
    if (th < 4 && tw < 4) return { tipo: 'vacio' };
    // Un solo trazo alto y angosto: el símbolo de silencio de Chordify (𝄽). Ningún acorde es tan angosto.
    if (tw <= th * 0.5 && th >= h * 0.25) return { tipo: 'silencio' };

    // Superíndice (el 7 de "Sol⁷", "maj7", "sus4"…): grupos de columnas a la derecha cuya tinta queda
    // toda en la parte de arriba. Chordify los dibuja más pequeños y claros, así que se buscan con un
    // umbral más bajo y se leen aparte.
    const umbralSup = umbralTinta * 0.6;
    const xFin = Math.min(w - 1, tx1 + 4);
    const fondoCol = [];
    for (let x = tx0; x <= xFin; x++) {
      let b = -1, t = -1;
      for (let y = 0; y < h; y++) if (oscuridad(x, y) > umbralSup) { if (t < 0) t = y; b = y; }
      fondoCol.push({ x, arriba: t, abajo: b });
    }
    const grupos = [];
    for (let k = 0; k < fondoCol.length;) {
      if (fondoCol[k].abajo < 0) { k++; continue; }
      let fin = k, abajo = -1;
      while (fin < fondoCol.length && fondoCol[fin].abajo >= 0) { abajo = Math.max(abajo, fondoCol[fin].abajo); fin++; }
      grupos.push({ x0: fondoCol[k].x, x1: fondoCol[fin - 1].x, abajo });
      k = fin;
    }
    let sup = null;
    const lineaSup = ty0 + th * 0.62;
    if (grupos.length >= 2 && grupos[0].abajo >= ty0 + th * 0.85) {
      let g = grupos.length - 1;
      while (g >= 1 && grupos[g].abajo <= lineaSup) g--;
      if (g < grupos.length - 1) {
        const sx0 = grupos[g + 1].x0, sx1 = grupos[grupos.length - 1].x1;
        if (sx1 - sx0 + 1 >= 2 && sx0 > tx0 + 3) {
          sup = { x0: sx0, x1: sx1 };
          tx1 = grupos[g].x1;
        }
      }
    }
    const tw2 = tx1 - tx0 + 1;

    // Máxima oscuridad de cada columna: las letras llegan a ~200; el ♭ / ♯ que dibuja Chordify
    // es más pequeño y claro (~80-130). Así se encuentra aunque el OCR no lo vea.
    const colMax = [];
    let maxTotal = 1;
    for (let x = tx0; x <= tx1; x++) {
      let m = 0;
      for (let y = ty0; y <= ty1; y++) m = Math.max(m, oscuridad(x, y));
      colMax.push(m); maxTotal = Math.max(maxTotal, m);
    }
    const alteracion = buscarAlteracion(colMax, maxTotal, th, (x, y) => oscuridad(tx0 + x, y), ty0, ty1, umbralTinta);

    // Recorte ampliado de las columnas [xa, xb] (relativas a la tinta), texto negro sobre fondo blanco.
    const recortar = (xa, xb, u = umbralTinta, ref = th) => {
      const umbralTinta = u;
      let a0 = h, a1 = -1;
      for (let y = 0; y < h; y++) for (let x = tx0 + xa; x <= tx0 + xb; x++) if (oscuridad(x, y) > umbralTinta) { if (y < a0) a0 = y; if (y > a1) a1 = y; }
      if (a1 < 0) return null;
      const alto = a1 - a0 + 1;
      const escala = Math.max(1.5, Math.min(8, (opciones.altoLetra ?? 24) / ref));
      const margen = 16;
      // Aire alrededor de la tinta para no cortar trazos tenues.
      const padX = 2, padY = Math.max(2, Math.round(ref * 0.35));
      const rx0 = Math.max(0, tx0 + xa - padX), ry0 = Math.max(0, a0 - padY);
      const rw0 = Math.min(w - rx0, xb - xa + 1 + 2 * padX), rh0 = Math.min(h - ry0, alto + 2 * padY);
      let max = 1;
      for (let y = ry0; y < ry0 + rh0; y++) for (let x = rx0; x < rx0 + rw0; x++) max = Math.max(max, oscuridad(x, y));
      const rw = Math.round(rw0 * escala) + 2 * margen, rh = Math.round(rh0 * escala) + 2 * margen;
      const salida = new Uint8ClampedArray(rw * rh * 4).fill(255);
      for (let y = 0; y < rh - 2 * margen; y++) {
        for (let x = 0; x < rw - 2 * margen; x++) {
          // Interpolación bilineal: bordes más suaves que agrandar pixel por pixel.
          const sx = rx0 + x / escala, sy = ry0 + y / escala;
          const ix = Math.min(w - 2, Math.max(0, Math.floor(sx))), iy = Math.min(h - 2, Math.max(0, Math.floor(sy)));
          const fx = sx - ix, fy = sy - iy;
          const v = oscuridad(ix, iy) * (1 - fx) * (1 - fy) + oscuridad(ix + 1, iy) * fx * (1 - fy)
            + oscuridad(ix, iy + 1) * (1 - fx) * fy + oscuridad(ix + 1, iy + 1) * fx * fy;
          const k = ((y + margen) * rw + x + margen) * 4;
          const tono = gris ? 255 - Math.min(255, Math.round(255 * Math.min(1, v / (max * 0.8)))) : (v > umbralTinta ? 0 : 255);
          salida[k] = salida[k + 1] = salida[k + 2] = tono;
          salida[k + 3] = 255;
        }
      }
      return { width: rw, height: rh, data: salida };
    };

    const partes = alteracion
      ? [recortar(0, alteracion.x0 - 1), alteracion.x1 + 1 <= tx1 - tx0 ? recortar(alteracion.x1 + 1, tx1 - tx0) : null]
      : [recortar(0, tx1 - tx0), null];
    // El superíndice se agranda según su propia altura.
    let superindice = null;
    if (sup) {
      let s0 = h, s1 = -1;
      for (let y = 0; y < h; y++) for (let x = sup.x0; x <= sup.x1; x++) if (oscuridad(x, y) > umbralSup) { if (y < s0) s0 = y; if (y > s1) s1 = y; }
      superindice = recortar(sup.x0 - tx0, sup.x1 - tx0, umbralSup, Math.max(6, (s1 - s0 + 1) * 1.15));
    }
    return { tipo: 'texto', partes, alteracion: alteracion ? alteracion.tipo : null, superindice, recorte: partes[0], tinta: { w: tw2, h: th, cuenta } };
  }

  /**
   * Busca un ♭ o ♯ pequeño y claro: una racha de 2 a 7 columnas de oscuridad media que termina en
   * un espacio en blanco (o en el final), después de alguna letra oscura. La "m" de color de
   * "Dom" también tiene columnas claras, pero entre trazos oscuros, así que no se confunde.
   */
  function buscarAlteracion(colMax, maxTotal, th, oscuridad, ty0, ty1, umbralTinta) {
    const oscura = maxTotal * 0.75, clara = maxTotal * 0.28, hueco = maxTotal * 0.27;
    let vioLetra = false;
    for (let x = 0; x < colMax.length; x++) {
      if (colMax[x] >= oscura) { vioLetra = true; continue; }
      if (!vioLetra || colMax[x] < clara) continue;
      let fin = x;
      while (fin + 1 < colMax.length && colMax[fin + 1] >= clara && colMax[fin + 1] < oscura) fin++;
      const ancho = fin - x + 1;
      const izquierda = x === 0 ? 0 : colMax[x - 1];
      const derecha = fin + 1 < colMax.length ? colMax[fin + 1] : 0;
      const pico = Math.max(...colMax.slice(x, fin + 1));
      if (ancho >= 2 && ancho <= Math.max(7, th * 0.65) && derecha <= hueco && (izquierda <= hueco || izquierda >= oscura) && pico >= maxTotal * 0.4) {
        // ♯ tiene dos palitos verticales; ♭ uno solo (y la pancita abajo).
        let palitos = 0, anterior = false;
        for (let c = x; c <= fin; c++) {
          let a = -1, b = -1;
          for (let y = ty0; y <= ty1; y++) if (oscuridad(c, y) > umbralTinta * 0.6) { if (a < 0) a = y; b = y; }
          const largo = a < 0 ? 0 : b - a + 1;
          const esPalito = largo >= th * 0.6;
          if (esPalito && !anterior) palitos++;
          anterior = esPalito;
        }
        return { tipo: palitos >= 2 ? '#' : 'b', x0: x, x1: fin };
      }
      x = fin;
    }
    return null;
  }

  // ================================================================ 3. Del texto leído a un acorde
  const LISTA_BLANCA = 'ABCDEFGLMRSabdefgijlmnorsu#0123456789/+';

  /** Arregla confusiones típicas del OCR y devuelve el acorde en texto, 'N', o null si no se entiende. */
  function leerAcorde(texto, leer) {
    let t = String(texto || '').replace(/\s+/g, '').replace(/[♭]/g, 'b').replace(/[♯]/g, '#');
    if (!t) return null;
    const intentos = [t,
      t.replace(/rn/g, 'm'),
      t.replace(/^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])6/, '$1b'),     // ♭ leído como 6
      t.replace(/^([A-G])0/, '$1o').replace(/^D0/, 'Do'),
      t.replace(/^5ol/, 'Sol').replace(/^S0l/, 'Sol').replace(/^5i/, 'Si'),
      t.replace(/^(Do|Re|Mi|Fa|Sol|La|Si)[bp]p/, '$1b'),
      t.replace(/^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])[a-z:]([b#])/, '$1$2'),  // "Misb" → "Mib" (basura antes del ♭)
      // Bajo en notación latina cortado o mal leído (el texto se sale de la casilla): "Sib/Ri" → "Sib/Re".
      t.replace(/\/(R[a-z]?|D[a-z]?|M[a-z]?|F[a-z]?|L[a-z]?|So[a-z]?)([b#]?)$/, (m, n, alt) => '/' + ({ R: 'Re', D: 'Do', M: 'Mi', F: 'Fa', L: 'La', S: 'Sol' }[n[0]]) + alt),
      t.replace(/\/.*$/, '')];  // último recurso: sin el bajo
    // Con "/" el bajo también tiene que entenderse (si no, "Sib/Ri" pasaría como "Sib" sin avisar).
    const valido = (x) => { const a = leer(x); return a && (!x.includes('/') || String(a).includes('/')); };
    for (const x of intentos) if (valido(x)) return x;
    for (const x of intentos) if (leer(x) && !x.includes('/')) return x;
    return null;
  }

  /** Une lo que leyó el OCR antes y después del ♭/♯ detectado: "La" + "b" + "m" = "Labm". */
  function unirLectura(antes, alteracion, despues) {
    let t = String(antes || '').replace(/\s+/g, '');
    if (alteracion && !/[b#]$/.test(t)) t += alteracion;
    return t + String(despues || '').replace(/\s+/g, '');
  }

  // ================================================================ 4. Texto por pulsos
  /** Arma el texto (una línea por fila de la imagen, "|" cada 4 pulsos). */
  function aTexto(columnas, filas) {
    const lineas = filas.map(fila => {
      const partes = [];
      fila.forEach((tok, c) => {
        if (c > 0 && columnas % 4 === 0 && c % 4 === 0) partes.push('|');
        partes.push(tok);
      });
      return partes.join(' ');
    });
    return lineas.join('\n');
  }

  /**
   * Lee el texto por pulsos.
   * @param leer función que devuelve el acorde normalizado o null
   * @returns {{pulsos: Array<{tipo:'acorde',acorde:string}|{tipo:'sigue'}|{tipo:'N'}>, errores: string[]}}
   */
  function parsearTexto(texto, leer) {
    const pulsos = [], errores = [];
    for (const crudo of String(texto || '').split(/\s+/)) {
      const tok = crudo.trim();
      if (!tok || /^\|+$/.test(tok)) continue;
      if (/^_+$/.test(tok)) { pulsos.push({ tipo: 'fuera' }); continue; }   // casilla gris antes/después de la canción
      if (/^[.\-–—·•]+$/.test(tok)) { pulsos.push({ tipo: 'sigue' }); continue; }
      if (/^(n|nc|n\.c\.?|x|%|𝄽)$/i.test(tok)) { pulsos.push({ tipo: 'N' }); continue; }
      if (tok === '?') { pulsos.push({ tipo: 'sigue' }); errores.push('?'); continue; }
      const limpio = tok.replace(/[♭]/g, 'b').replace(/[♯]/g, '#');
      const a = leer(limpio);
      if (a) pulsos.push({ tipo: 'acorde', acorde: a });
      else { pulsos.push({ tipo: 'sigue' }); errores.push(tok); }
    }
    return { pulsos, errores };
  }

  /** Convierte la lista de pulsos en el acorde que suena en cada uno (null = no se sabe, al inicio). */
  function resolver(pulsos) {
    const out = [];
    let actual = null;
    for (const p of pulsos) {
      if (p.tipo === 'acorde') actual = p.acorde;
      else if (p.tipo === 'N') actual = 'N';
      out.push(actual);
    }
    return out;
  }

  /**
   * Busca dónde encaja la secuencia importada dentro de los acordes que ya tiene la canción.
   * @param secuencia  acorde por pulso (de resolver)
   * @param actuales   acorde por pulso de la canción
   * @param igual      función (a, b) => boolean (compara mayor/menor sin importar la escritura)
   * @param esTiempoUno función (i) => boolean, para preferir empezar en un tiempo 1 en caso de empate
   */
  function ubicar(secuencia, actuales, igual, esTiempoUno) {
    const L = secuencia.length, n = actuales.length;
    if (L === 0) return null;
    let mejor = { inicio: 0, aciertos: -1, comparables: 0 };
    for (let s = 0; s + L <= n; s++) {
      let aciertos = 0, comparables = 0;
      for (let k = 0; k < L; k++) {
        const a = secuencia[k], b = actuales[s + k];
        if (!a || a === 'N' || !b || b === 'N') continue;
        comparables++;
        if (igual(a, b)) aciertos++;
      }
      const puntaje = aciertos + (esTiempoUno && esTiempoUno(s) ? 0.5 : 0);
      const puntajeMejor = mejor.aciertos + (esTiempoUno && esTiempoUno(mejor.inicio) ? 0.5 : 0);
      if (puntaje > puntajeMejor) mejor = { inicio: s, aciertos, comparables };
    }
    return { inicio: mejor.inicio, coincidencia: mejor.comparables ? mejor.aciertos / mejor.comparables : 0 };
  }

  /**
   * ¿Casilla gris lisa, sin región blanca? Así marca Chordify los pulsos antes del inicio y después
   * del final de la canción.
   */
  function esGrisLisa(img, celda) {
    if (celda.existe !== false) return false;
    const { width: W, data } = img;
    const b = Math.max(2, Math.round(Math.min(celda.w, celda.h) * 0.12));
    let suma = 0, suma2 = 0, n = 0;
    for (let y = celda.y + b; y < celda.y + celda.h - b; y++) for (let x = celda.x + b; x < celda.x + celda.w - b; x++) {
      const l = lum(data, (y * W + x) * 4); suma += l; suma2 += l * l; n++;
    }
    if (!n) return false;
    const media = suma / n, desv = Math.sqrt(Math.max(0, suma2 / n - media * media));
    return media >= 150 && media < 236 && desv < 8;
  }

  /**
   * Lee una imagen completa: casillas, OCR de cada una y el texto por pulsos.
   * @param img     {width, height, data} RGBA
   * @param ocr     async (recorte) => texto leído (Tesseract en el navegador o en Node)
   * @param leer    función que devuelve el acorde normalizado o null
   * @param progreso (hechas, total) => void, opcional
   * @returns {{red, filas: string[][], texto: string, dudas: number}}
   */
  async function leerParrilla(img, ocr, leer, progreso) {
    const red = detectarCeldas(img);
    const filas = Array.from({ length: red.filas }, () => new Array(red.columnas).fill('.'));
    const pendientes = [];
    const vacias = [];
    for (const c of red.celdas) {
      const k = contenidoCelda(img, c);
      if (k.tipo === 'silencio') filas[c.fila][c.col] = 'N';
      else if (k.tipo === 'texto') pendientes.push({ c, k });
      else if (k.tipo === 'vacio') vacias.push(c);
    }
    let hechas = 0;
    const leerPartes = async (k) => {
      let crudo = unirLectura(k.partes[0] ? await ocr(k.partes[0]) : '', k.alteracion, k.partes[1] ? await ocr(k.partes[1]) : '');
      let acorde = leerAcorde(crudo, leer);
      if (acorde && k.superindice) {
        const extra = String(await ocr(k.superindice)).replace(/\s+/g, '').replace(/[oO]/g, '0').replace(/[lI|]/g, '1');
        const m = /^(maj7|maj9|maj|m7|m9|m6|sus2|sus4|sus|add9|add|dim7|dim|aug|\d{1,2})/.exec(extra);
        if (m) {
          const base = acorde.replace(/\/.*/, ''), bajo = acorde.includes('/') ? acorde.slice(acorde.indexOf('/')) : '';
          const con = leerAcorde(base + m[1] + bajo, leer) || leerAcorde(base + m[1], leer);
          if (con) acorde = con;
        }
      }
      return { crudo, acorde };
    };
    for (const { c, k } of pendientes) {
      if (progreso) progreso(++hechas, pendientes.length);
      let r = await leerPartes(k);
      if (!r.acorde) { // segundo intento con el texto más grande
        const r2 = await leerPartes(contenidoCelda(img, c, { altoLetra: 40 }));
        if (r2.acorde) r = r2;
      }
      filas[c.fila][c.col] = r.acorde ? r.acorde.replace(/\s+/g, '')
        // Algo muy corto que no es acorde: el símbolo de silencio.
        : (r.crudo.replace(/[^A-Za-z0-9#]/g, '').length <= 2 ? 'N' : '?');
    }
    // Casillas grises al principio y al final: fuera de la canción ("_").
    const orden = red.celdas.slice().sort((a, b) => a.fila - b.fila || a.col - b.col);
    const fuera = new Set(vacias.filter(c => esGrisLisa(img, c)));
    for (const c of orden) { if (!fuera.has(c)) break; filas[c.fila][c.col] = '_'; }
    for (let i = orden.length - 1; i >= 0; i--) { const c = orden[i]; if (!fuera.has(c)) break; filas[c.fila][c.col] = '_'; }
    const dudas = filas.flat().filter(t => t === '?').length;
    return { red, filas, texto: aTexto(red.columnas, filas), dudas };
  }

  const ImportarImagen = { detectarCeldas, contenidoCelda, leerAcorde, unirLectura, aTexto, parsearTexto, resolver, ubicar, leerParrilla, esGrisLisa, LISTA_BLANCA };
  if (typeof module !== 'undefined' && module.exports) module.exports = ImportarImagen;
  else global.ImportarImagen = ImportarImagen;
})(typeof self !== 'undefined' ? self : this);
