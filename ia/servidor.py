"""
Acordia IA - servicio web pequeño que analiza un audio con redes neuronales (ver motor.py).

Lo usa el backend de Spring Boot (AnalisisIaService), no el navegador directamente.
Escucha solo en este computador (127.0.0.1), puerto 5000.

  GET  /estado     -> qué modelos hay instalados
  POST /analizar   -> archivo (multipart), bpm y estabilidad opcionales -> pulsos y acordes en JSON

Ejecutar:  python servidor.py      (o iniciar-ia.bat en Windows)
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.concurrency import run_in_threadpool  # noqa: E402

import motor  # noqa: E402

MAXIMO_BYTES = 60 * 1024 * 1024
app = FastAPI(title='Acordia IA', version='1.0')


@app.get('/estado')
def estado():
    return motor.estado()


@app.post('/analizar')
async def analizar(archivo: UploadFile = File(...), bpm: float | None = Form(None), estabilidad: float = Form(0.82)):
    datos = await archivo.read()
    if not datos:
        raise HTTPException(400, 'No llegó ningún audio.')
    if len(datos) > MAXIMO_BYTES:
        raise HTTPException(413, 'El audio es muy grande (máximo 60 MB).')
    if bpm is not None and not (40 <= bpm <= 240):
        bpm = None
    estabilidad = min(0.98, max(0.5, estabilidad))
    inicio = time.time()
    try:
        # El análisis tarda varios segundos: se hace en otro hilo para no bloquear /estado.
        resultado = await run_in_threadpool(motor.analizar, datos, archivo.filename or '', bpm, estabilidad)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:  # un error inesperado: se muestra en esta ventana y se avisa a Acordia
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f'El análisis con IA falló: {type(e).__name__}: {e}')
    resultado['segundos'] = round(time.time() - inicio, 1)
    print(f'[Acordia IA] {archivo.filename}: {len(resultado["pulsos"])} pulsos, {len(resultado["eventos"])} cambios, '
          f'{resultado["bpm"]} BPM, {resultado["tonalidad"]}, pulsos con {resultado["motorPulsos"]}, {resultado["segundos"]} s', flush=True)
    return resultado


if __name__ == '__main__':
    import uvicorn
    puerto = int(os.environ.get('ACORDIA_IA_PUERTO', '5000'))
    print(f'Acordia IA escuchando en http://127.0.0.1:{puerto}  (Ctrl+C para cerrar)', flush=True)
    uvicorn.run(app, host='127.0.0.1', port=puerto, log_level='warning')
