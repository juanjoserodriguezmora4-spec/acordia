/*
 * Web Worker: corre el analizador en un hilo aparte para que la página no se congele
 * mientras se escucha la canción (puede tardar unos segundos).
 */
importScripts('analizador.js');

self.onmessage = (evento) => {
  const { muestras, sr, opciones } = evento.data;
  try {
    const resultado = Analizador.analizar(muestras, sr, opciones, (fraccion, mensaje) => {
      self.postMessage({ tipo: 'progreso', fraccion, mensaje });
    });
    self.postMessage({ tipo: 'resultado', resultado });
  } catch (e) {
    self.postMessage({ tipo: 'error', mensaje: e.message || String(e) });
  }
};
