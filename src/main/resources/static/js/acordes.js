/*
 * ACORDIA - Teoría de acordes y diagramas de guitarra
 * ===================================================
 *  - leer / escribir nombres de acordes (americano: C, D, E... o latino: Do, Re, Mi...)
 *  - transponer
 *  - encontrar una digitación en la guitarra y dibujarla en SVG
 */
(function (global) {
  'use strict';

  const mod = (a, n) => ((a % n) + n) % n;

  /** Cómo se escribe cada nota. Se usan los nombres más comunes entre guitarristas. */
  const NOMBRES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  const LATINOS = ['Do', 'Do#', 'Re', 'Mib', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'Sib', 'Si'];
  /** Escritura según la tonalidad: en Mi♭ se escribe La♭ (no Sol♯); en Mi se escribe Sol♯. */
  const NOMBRES_B = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  const NOMBRES_S = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const LATINOS_B = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
  const LATINOS_S = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const LETRA = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const SILABA = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11 };

  /** Calidades que se pueden escribir. Las demás se reducen a mayor o menor. */
  const CALIDADES = ['', 'm', '7', 'm7', 'maj7', 'sus2', 'sus4', '5', 'dim', 'aug', 'add9', '6', 'm6', '9'];

  /**
   * Lee un nombre de acorde. Devuelve { raiz, calidad, bajo } o null.
   * "N" (sin acorde) devuelve { sinAcorde: true }.
   */
  function leer(texto) {
    if (!texto) return null;
    const t = String(texto).trim();
    if (t === 'N' || t === 'N.C.' || t === '-') return { sinAcorde: true };
    // Primero se intenta en notación latina y luego en americana.
    // Ejemplo: "Fadd9" parece "Fa" + "dd9", que no es válido, así que se lee como F add9.
    const latino = /^(do|re|mi|fa|sol|la|si)/i.exec(t);
    if (latino && t[0] === t[0].toUpperCase()) {
      const r = leerDesde(SILABA[latino[1].toLowerCase()], t.slice(latino[1].length));
      if (r) return r;
    }
    if (LETRA[t[0]?.toUpperCase()] !== undefined && t[0] === t[0].toUpperCase()) {
      return leerDesde(LETRA[t[0].toUpperCase()], t.slice(1));
    }
    return null;
  }

  function leerDesde(raiz, resto) {
    if (resto.startsWith('#')) { raiz = mod(raiz + 1, 12); resto = resto.slice(1); }
    else if (resto.startsWith('b')) { raiz = mod(raiz - 1, 12); resto = resto.slice(1); }

    let bajo = null;
    const barra = resto.indexOf('/');
    if (barra >= 0) {
      const b = leer(resto.slice(barra + 1));
      bajo = b && !b.sinAcorde ? b.raiz : null;
      resto = resto.slice(0, barra);
    }
    let calidad = resto.replace(/^min/, 'm').replace(/^M7/, 'maj7').replace(/^-/, 'm').replace(/^\+$/, 'aug');
    if (calidad === 'maj') calidad = '';
    if (!/^(maj|m(?:maj)?|dim|aug)?\d{0,2}((sus|add)\d{0,2})*([#b]\d{1,2})*$/.test(calidad)) return null;
    return { raiz, calidad, bajo };
  }

  /** ¿Suena menor? (para simplificar a mayor/menor) */
  function esMenor(calidad) {
    return (calidad.startsWith('m') && !calidad.startsWith('maj')) || calidad.startsWith('dim');
  }

  /** Escribe el acorde. notacion = 'americana' | 'latina' */
  /**
   * @param alteracion 'b' (bemoles), '#' (sostenidos) o nada (la escritura más común de cada nota)
   */
  function escribir(a, notacion = 'americana', alteracion) {
    if (!a) return '?';
    if (a.sinAcorde) return 'N.C.';
    const latina = notacion === 'latina';
    const nombres = alteracion === 'b' ? (latina ? LATINOS_B : NOMBRES_B)
      : alteracion === '#' ? (latina ? LATINOS_S : NOMBRES_S) : (latina ? LATINOS : NOMBRES);
    let s = nombres[a.raiz] + a.calidad;
    if (a.bajo !== null && a.bajo !== undefined && a.bajo !== a.raiz) s += '/' + (deletrearBajo(nombres[a.raiz], a.raiz, a.bajo, latina) || nombres[a.bajo]);
    return s;
  }

  /**
   * Escribe la nota del bajo según la letra de la raíz cuando es nota del acorde:
   * en D/F# la tercera de Re se llama Fa♯ (no Sol♭); en Fm/Ab la tercera de Fa se llama La♭.
   */
  function deletrearBajo(nombreRaiz, raiz, bajo, latina) {
    const pasos = { 3: 2, 4: 2, 7: 4, 10: 6, 11: 6, 2: 1, 5: 3, 9: 5 }[mod(bajo - raiz, 12)];
    if (pasos === undefined) return null;
    const LETRAS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'], PC = [0, 2, 4, 5, 7, 9, 11];
    const SILABAS = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
    const base = latina ? SILABAS.findIndex(x => nombreRaiz.startsWith(x)) : LETRAS.indexOf(nombreRaiz[0]);
    if (base < 0) return null;
    const k = (base + pasos) % 7;
    const dif = mod(bajo - PC[k] + 6, 12) - 6; // -6..5
    if (Math.abs(dif) > 1) return null;
    return (latina ? SILABAS[k] : LETRAS[k]) + (dif === 1 ? '#' : dif === -1 ? 'b' : '');
  }

  /** Nombre normalizado (siempre americano), útil para guardar en la base de datos. */
  function normalizar(texto) {
    const a = leer(texto);
    if (!a) return null;
    if (a.sinAcorde) return 'N';
    return escribir(a, 'americana');
  }

  function transponer(texto, semitonos) {
    const a = leer(texto);
    if (!a || a.sinAcorde || !semitonos) return a && a.sinAcorde ? 'N' : (a ? escribir(a) : texto);
    return escribir({
      raiz: mod(a.raiz + semitonos, 12),
      calidad: a.calidad,
      bajo: a.bajo === null ? null : mod(a.bajo + semitonos, 12)
    });
  }

  /** Muestra un acorde ya transpuesto y en la notación elegida. */
  function mostrar(texto, semitonos = 0, notacion = 'americana', alteracion) {
    const a = leer(transponer(texto, semitonos));
    return escribir(a, notacion, alteracion);
  }

  /**
   * ¿Con bemoles o sostenidos se escribe esta tonalidad? Devuelve 'b', '#' o undefined (Do mayor / La menor).
   * Ej.: "Eb" o "Cm" → 'b'; "E" o "C#m" → '#'.
   */
  function alteracionDe(tonalidad) {
    const a = leer(tonalidad);
    if (!a || a.sinAcorde) return undefined;
    const mayor = esMenor(a.calidad) ? mod(a.raiz + 3, 12) : a.raiz; // se mira la mayor relativa
    if ([5, 10, 3, 8, 1].includes(mayor)) return 'b';      // F, Bb, Eb, Ab, Db
    if ([7, 2, 9, 4, 11, 6].includes(mayor)) return '#';   // G, D, A, E, B, F#
    return undefined;
  }

  // ---------------------------------------------------------------- Digitaciones
  // Cada digitación son 6 números, de la 6ª cuerda (Mi grave) a la 1ª (Mi aguda).
  // -1 = no se toca, 0 = al aire, n = traste.

  /** Posiciones abiertas clásicas (las que aparecen en cualquier cancionero). */
  const ABIERTOS = {
    'C': [-1, 3, 2, 0, 1, 0], 'C7': [-1, 3, 2, 3, 1, 0], 'Cmaj7': [-1, 3, 2, 0, 0, 0],
    'Cadd9': [-1, 3, 2, 0, 3, 0], 'Csus4': [-1, 3, 3, 0, 1, 1],
    'D': [-1, -1, 0, 2, 3, 2], 'Dm': [-1, -1, 0, 2, 3, 1], 'D7': [-1, -1, 0, 2, 1, 2],
    'Dm7': [-1, -1, 0, 2, 1, 1], 'Dmaj7': [-1, -1, 0, 2, 2, 2], 'Dsus2': [-1, -1, 0, 2, 3, 0],
    'Dsus4': [-1, -1, 0, 2, 3, 3], 'D5': [-1, -1, 0, 2, 3, -1],
    'G': [3, 2, 0, 0, 0, 3], 'G7': [3, 2, 0, 0, 0, 1], 'Gmaj7': [3, -1, 0, 0, 0, 2],
    'B7': [-1, 2, 1, 2, 0, 2], 'Fmaj7': [-1, -1, 3, 2, 1, 0]
  };

  /** Formas móviles (con cejilla). Los números son relativos al traste de la raíz. */
  const FORMA_E = { // raíz en la 6ª cuerda
    '': [0, 2, 2, 1, 0, 0], 'm': [0, 2, 2, 0, 0, 0], '7': [0, 2, 0, 1, 0, 0], 'm7': [0, 2, 0, 0, 0, 0],
    'maj7': [0, -1, 1, 1, 0, -1], 'sus4': [0, 2, 2, 2, 0, 0], '5': [0, 2, 2, -1, -1, -1],
    'dim': [0, 1, 2, 0, -1, -1], 'aug': [0, 3, 2, 1, 1, 0], '6': [0, 2, 2, 1, 2, 0], 'm6': [0, 2, 2, 0, 2, 0],
    'add9': [0, 2, 4, 1, 0, 0]
  };
  const FORMA_A = { // raíz en la 5ª cuerda
    '': [-1, 0, 2, 2, 2, 0], 'm': [-1, 0, 2, 2, 1, 0], '7': [-1, 0, 2, 0, 2, 0], 'm7': [-1, 0, 2, 0, 1, 0],
    'maj7': [-1, 0, 2, 1, 2, 0], 'sus4': [-1, 0, 2, 2, 3, 0], 'sus2': [-1, 0, 2, 2, 0, 0],
    '5': [-1, 0, 2, 2, -1, -1], 'dim': [-1, 0, 1, 2, 1, -1], 'aug': [-1, 0, 3, 2, 2, 1],
    'add9': [-1, 0, 2, 4, 2, 0], '6': [-1, 0, 2, 2, 2, 2], 'm6': [-1, 0, 2, 2, 1, 2], '9': [-1, 0, 2, 4, 2, 3]
  };

  /**
   * Busca cómo tocar el acorde. Devuelve { trastes:[6], cejilla: traste|null, calidadUsada } o null.
   * Si la calidad no tiene forma conocida (por ejemplo 13), se usa el acorde mayor o menor.
   */
  function digitacion(texto) {
    const a = leer(texto);
    if (!a || a.sinAcorde) return null;
    let calidad = a.calidad;
    if (!(calidad in FORMA_E) && !(calidad in FORMA_A)) calidad = esMenor(calidad) ? 'm' : '';

    const clave = NOMBRES[a.raiz] + calidad;
    if (ABIERTOS[clave]) return { trastes: ABIERTOS[clave], cejilla: null, calidadUsada: calidad };

    const opciones = [];
    if (calidad in FORMA_E) opciones.push({ forma: FORMA_E[calidad], traste: mod(a.raiz - 4, 12) });
    if (calidad in FORMA_A) opciones.push({ forma: FORMA_A[calidad], traste: mod(a.raiz - 9, 12) });
    opciones.sort((x, y) => x.traste - y.traste);
    const { forma, traste } = opciones[0];
    const trastes = forma.map(v => (v < 0 ? -1 : v + traste));
    // Cejilla: el dedo índice pisa todas las cuerdas que en la forma están "al aire".
    const cuerdasCejilla = forma.map((v, i) => (v === 0 ? i : -1)).filter(i => i >= 0);
    const cejilla = traste > 0 && cuerdasCejilla.length >= 2
      ? { traste, desde: cuerdasCejilla[0], hasta: cuerdasCejilla[cuerdasCejilla.length - 1] }
      : null;
    return { trastes, cejilla, calidadUsada: calidad };
  }

  // ---------------------------------------------------------------- Ukelele (G C E A)
  /** Intervalos (en semitonos desde la raíz) de cada calidad que se sabe dibujar. */
  const INTERVALOS = {
    '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'm7': [0, 3, 7, 10], 'maj7': [0, 4, 7, 11],
    'sus2': [0, 2, 7], 'sus4': [0, 5, 7], '5': [0, 7], 'dim': [0, 3, 6], 'aug': [0, 4, 8],
    'add9': [0, 2, 4, 7], '6': [0, 4, 7, 9], 'm6': [0, 3, 7, 9], '9': [0, 2, 4, 7, 10]
  };
  const AFINACION_UKELELE = [7, 0, 4, 9]; // G C E A (de la 4ª a la 1ª cuerda)
  const cacheUkelele = new Map();

  /**
   * Busca la digitación de ukelele más cómoda: todas las notas del acorde (la quinta se puede omitir
   * en acordes de 4 notas), máximo 4 trastes de abertura, prefiriendo posiciones bajas y cuerdas al aire.
   */
  function digitacionUkelele(texto) {
    const a = leer(texto);
    if (!a || a.sinAcorde) return null;
    let calidad = a.calidad in INTERVALOS ? a.calidad : (esMenor(a.calidad) ? 'm' : '');
    const clave = a.raiz + '|' + calidad;
    if (cacheUkelele.has(clave)) return cacheUkelele.get(clave);
    const tonos = INTERVALOS[calidad].map(i => mod(a.raiz + i, 12));
    const obligatorios = tonos.length >= 4 ? tonos.filter((_, k) => INTERVALOS[calidad][k] !== 7) : tonos;
    let mejor = null, mejorCosto = Infinity;
    for (let base = 1; base <= 10; base++) {
      const opciones = AFINACION_UKELELE.map(aire => {
        const o = [-1]; // -1 = cuerda sin tocar (se usa solo si no hay otra opción, cuesta más)
        for (const f of [0, base, base + 1, base + 2, base + 3]) {
          if (o.includes(f)) continue;
          if (tonos.includes(mod(aire + f, 12))) o.push(f);
        }
        return o;
      });

      const combinar = (i, actual) => {
        if (i === 4) {
          const mudas = actual.filter(f => f < 0).length;
          if (mudas > 1) return;
          const suenan = new Set(actual.map((f, c) => (f < 0 ? -1 : mod(AFINACION_UKELELE[c] + f, 12))).filter(v => v >= 0));
          if (!obligatorios.every(t => suenan.has(t))) return;
          const pisados = actual.filter(f => f > 0);
          const max = pisados.length ? Math.max(...pisados) : 0;
          const costo = max * 2 + pisados.reduce((x, y) => x + y, 0) * 0.5 + new Set(pisados).size + mudas * 40;
          if (costo < mejorCosto) { mejorCosto = costo; mejor = actual.slice(); }
          return;
        }
        for (const f of opciones[i]) { actual.push(f); combinar(i + 1, actual); actual.pop(); }
      };
      combinar(0, []);
    }
    const r = mejor ? { trastes: mejor, cejilla: detectarCejilla(mejor), calidadUsada: calidad } : null;
    cacheUkelele.set(clave, r);
    return r;
  }

  /** Si el traste más bajo se repite en varias cuerdas (y las de en medio no están más abajo), es cejilla. */
  function detectarCejilla(trastes) {
    const pisados = trastes.filter(f => f > 0);
    if (pisados.length < 3) return null;
    const min = Math.min(...pisados);
    const con = trastes.map((f, c) => (f === min ? c : -1)).filter(c => c >= 0);
    if (con.length < 2) return null;
    const desde = con[0], hasta = con[con.length - 1];
    for (let c = desde; c <= hasta; c++) if (trastes[c] < min) return null;
    return { traste: min, desde, hasta };
  }

  // ---------------------------------------------------------------- Dibujo
  /**
   * Dibuja el diagrama del acorde en SVG.
   * opciones: { instrumento: 'guitarra' | 'ukelele' | 'piano', notacion, titulo }
   */
  function diagramaSVG(texto, opciones = {}) {
    const instrumento = opciones.instrumento || 'guitarra';
    const titulo = opciones.titulo ?? escribir(leer(texto), opciones.notacion);
    if (instrumento === 'piano') return pianoSVG(texto, titulo);
    const d = instrumento === 'ukelele' ? digitacionUkelele(texto) : digitacion(texto);
    const cuerdas = instrumento === 'ukelele' ? 4 : 6;
    const ancho = 120, alto = 150;
    const sepX = cuerdas === 6 ? 16 : 22, sepY = 20, nTrastes = 5;
    const x0 = (ancho - sepX * (cuerdas - 1)) / 2 + 2, y0 = 40;
    if (!d) {
      return `<svg class="diagrama" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Sin acorde">
        <text x="${ancho / 2}" y="22" class="diagrama-nombre" text-anchor="middle">${escaparXML(titulo)}</text>
        <text x="${ancho / 2}" y="95" class="diagrama-vacio" text-anchor="middle">sin acorde</text></svg>`;
    }
    const pisados = d.trastes.filter(v => v > 0);
    const maxT = pisados.length ? Math.max(...pisados) : 0;
    const minT = pisados.length ? Math.min(...pisados) : 0;
    const base = maxT <= nTrastes ? 1 : minT;
    const anchoMastil = sepX * (cuerdas - 1);
    let s = `<svg class="diagrama" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Diagrama de ${escaparXML(titulo)}">`;
    s += `<text x="${x0 + anchoMastil / 2}" y="18" class="diagrama-nombre" text-anchor="middle">${escaparXML(titulo)}</text>`;
    for (let i = 0; i <= nTrastes; i++) {
      const y = y0 + i * sepY;
      s += `<line x1="${x0}" y1="${y}" x2="${x0 + anchoMastil}" y2="${y}" class="${i === 0 && base === 1 ? 'diagrama-cejuela' : 'diagrama-traste'}"/>`;
    }
    for (let c = 0; c < cuerdas; c++) {
      const x = x0 + c * sepX;
      s += `<line x1="${x}" y1="${y0}" x2="${x}" y2="${y0 + sepY * nTrastes}" class="diagrama-cuerda"/>`;
    }
    if (base > 1) s += `<text x="${x0 - 7}" y="${y0 + sepY * 0.5 + 4}" class="diagrama-base" text-anchor="end">${base}</text>`;
    if (d.cejilla) {
      const y = y0 + (d.cejilla.traste - base + 0.5) * sepY;
      const xa = x0 + d.cejilla.desde * sepX, xb = x0 + d.cejilla.hasta * sepX;
      s += `<rect x="${xa - 6}" y="${y - 6}" width="${xb - xa + 12}" height="12" rx="6" class="diagrama-cejilla"/>`;
    }
    d.trastes.forEach((t, c) => {
      const x = x0 + c * sepX;
      if (t < 0) {
        const y = y0 - 11;
        s += `<path d="M${x - 3.5} ${y - 3.5}L${x + 3.5} ${y + 3.5}M${x + 3.5} ${y - 3.5}L${x - 3.5} ${y + 3.5}" class="diagrama-apagada"/>`;
      } else if (t === 0) {
        s += `<circle cx="${x}" cy="${y0 - 11}" r="4" class="diagrama-aire"/>`;
      } else if (!(d.cejilla && t === d.cejilla.traste && c >= d.cejilla.desde && c <= d.cejilla.hasta)) {
        s += `<circle cx="${x}" cy="${y0 + (t - base + 0.5) * sepY}" r="6" class="diagrama-punto"/>`;
      }
    });
    if (d.calidadUsada !== (leer(texto) || {}).calidad) {
      s += `<text x="${ancho / 2}" y="${alto - 4}" class="diagrama-nota" text-anchor="middle">forma simplificada</text>`;
    }
    return s + '</svg>';
  }

  /** Teclado de dos octavas con las notas del acorde marcadas (en posición fundamental). */
  function pianoSVG(texto, titulo) {
    const a = leer(texto);
    const ancho = 120, alto = 150;
    if (!a || a.sinAcorde) {
      return `<svg class="diagrama" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Sin acorde">
        <text x="${ancho / 2}" y="22" class="diagrama-nombre" text-anchor="middle">${escaparXML(titulo)}</text>
        <text x="${ancho / 2}" y="95" class="diagrama-vacio" text-anchor="middle">sin acorde</text></svg>`;
    }
    const calidad = a.calidad in INTERVALOS ? a.calidad : (esMenor(a.calidad) ? 'm' : '');
    const notas = new Set(INTERVALOS[calidad].map(i => a.raiz + i)); // 0-23 desde el Do
    const blancas = [0, 2, 4, 5, 7, 9, 11];
    const anchoTecla = 112 / 14, x0 = 4, y0 = 52, altoB = 74, altoN = 46;
    let s = `<svg class="diagrama" viewBox="0 0 ${ancho} ${alto}" role="img" aria-label="Piano: ${escaparXML(titulo)}">`;
    s += `<text x="${ancho / 2}" y="18" class="diagrama-nombre" text-anchor="middle">${escaparXML(titulo)}</text>`;
    for (let i = 0; i < 14; i++) {
      const nota = Math.floor(i / 7) * 12 + blancas[i % 7];
      s += `<rect x="${x0 + i * anchoTecla}" y="${y0}" width="${anchoTecla}" height="${altoB}" rx="1.5" class="${notas.has(nota) ? 'piano-marcada' : 'piano-blanca'}"/>`;
    }
    for (let oct = 0; oct < 2; oct++) {
      [[1, 1], [3, 2], [6, 4], [8, 5], [10, 6]].forEach(([nota, despues]) => {
        const x = x0 + (oct * 7 + despues) * anchoTecla - anchoTecla * 0.32;
        s += `<rect x="${x}" y="${y0}" width="${anchoTecla * 0.64}" height="${altoN}" rx="1.2" class="${notas.has(oct * 12 + nota) ? 'piano-marcada' : 'piano-negra'}"/>`;
      });
    }
    return s + '</svg>';
  }

  function escaparXML(t) {
    return String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const Acordes = {
    NOMBRES, LATINOS, CALIDADES, INTERVALOS, leer, escribir, normalizar, transponer, mostrar, esMenor, alteracionDe,
    digitacion, digitacionUkelele, diagramaSVG, escaparXML
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Acordes;
  else global.Acordes = Acordes;
})(typeof self !== 'undefined' ? self : this);
