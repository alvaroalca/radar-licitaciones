# STATUS — Radar de licitaciones

Actualizado: 2026-09-25

## Lector intercambiable: ahora lee Claude (25/09/2026)

- [x] **El lector es el LLM que prefiera cada cual.** Además de Ollama en directo, el motor funciona en dos pasos: `npm run extraer -- --preparar` deja las instrucciones y las páginas en `data/lectura/<id>.txt`; el lector escribe `<id>.json` y `--importar` lo pasa por los mismos validadores. En este proyecto lee Claude, con subagentes en lotes de 10, para no cargar la GPU.
- [x] Se relee lo que leyó otro modelo: la consulta de pendientes incluye las lecturas con `modelo` distinto.
- [x] **Leídas por Claude las 266 abiertas con pliego legible** (hay 272 abiertas). Se aceptan 1.115 de 1.134 requisitos propuestos (98 %); con qwen eran 177 de 210.
- [x] **Validadores que solo servían para qwen y tiraban datos buenos de Claude**, ya corregidos:
  - el ENS se descartaba cuando la cita era la frase que lo exige ("en posesión de") y no decía "certificación";
  - no se reconocían las certificaciones de fabricante ni las habilitaciones: partner Gold o Silver, distribuidor autorizado, autorización del fabricante, CCN, HSEM y HSES, PCI-DSS;
  - varias certificaciones que cuelgan de la misma frase se tomaban por repetidas;
  - un paréntesis aclaratorio en el nombre lo convertía en "lista";
  - el grupo de clasificación en la línea siguiente a la cita hacía descartarlo;
  - "E.N.S." escrito con puntos no contaba como ENS.
- [x] **Encaje con los tres perfiles, 266 abiertas:**

  | Perfil | Encajas | Revisar | No llegas |
  |---|---|---|---|
  | Estudio web | 103 | 64 | 99 |
  | Consultora de ciberseguridad | 200 | 49 | 17 |
  | Integrador grande | 230 | 36 | 0 |
- [x] **Reglas del segundo lote a ciegas aplicadas:**
  - la clasificación solo da "no llegas" si la cita dice "exigible" u "obligatoria";
  - se descartan los grupos sacados de rótulos ("apartado F", "F1 CLASIFICACIÓN");
  - las certificaciones de personal (ITIL, PMP…) pasan a adscripción de medios.
  - Con qwen, el veredicto en ese lote pasa de 7/8/8 a 9/11/11 (ya no es ciego).
- [x] **Encaje:** el volumen de negocios se decide por el medio. Un "Patrimonio neto" cuya descripción dice "no se pide volumen" se tomaba por volumen.
- **Lo que ven los lectores y no se arregla leyendo mejor:**
  - pliegos tipo sin rellenar (Generalitat Valenciana, Valladolid);
  - remisiones al cuadro resumen, que no está entre las páginas enviadas;
  - páginas clave que el selector deja fuera (perfiles, solvencia técnica);
  - un PDF con las fuentes ilegibles;
  - un DEUC en blanco descargado en lugar del PCAP (20496792);
  - CPV de TI en contratos que no lo son (climatización, puntos de recarga).

  Unos 15 pliegos salen vacíos o casi vacíos por estas causas.

  El tope de 10 k tokens del selector venía de qwen. Con Claude se puede subir.
- ⚠️ **Los bancos de evals ya no miden a ciegas:** las referencias las anotó Claude y ahora también lee Claude.
  - Veredictos iguales: 23-25/25, 11/12 y 11/12.
  - Los desacuerdos son requisitos reales que la referencia no anotó y Claude sí (distribuidor Fortinet, HSEM, que dan "revisar"), o los casos ambiguos de la referencia ("exime de acreditar").
  - Para una cifra publicable hace falta anotar a mano, fuera de Claude.
- ⚠️ **Coste:** los subagentes en lotes de 10 reenviaban cada pliego en todos los turnos siguientes. Salieron unos 100 M de tokens procesados para 3 M útiles, y se agotaron dos ventanas de 5 horas. El lector nuevo es `scripts/lector/claude.ts`: una llamada `claude -p` sin herramientas por pliego (~13 k de entrada). **Sin probar**, porque el login OAuth de la CLI había caducado: hay que ejecutar `claude` y `/login` en una terminal.
- **Pendiente:**
  - probar `node scripts/lector/claude.ts --id=20481053` y mirar el consumo real;
  - releer con la instrucción nueva (cita = la frase que la exige) las primeras 155 lecturas que traen certificaciones: algunas obligatorias se quedan en "revisar";
  - decidir si se sube el tope de páginas (10 k tokens venía de qwen);
  - averiguar por qué llegan un DEUC y plantillas sin rellenar como si fueran el PCAP.

## Fase actual: 1, ingesta y listado

- [x] Esquema `licitaciones` y rol `radar_motor` aplicados en alcaten-dev (`db/001`, `db/002`). RLS y permisos comprobados: `anon` solo lee; el motor lee, inserta y actualiza, pero no borra.
- [x] Motor (`src/motor/ingestar.ts`): ZIP del mes con descarga condicional por ETag, se queda solo con TI y hace upsert por lotes en el que una entrada vieja nunca pisa a una nueva. Cada ejecución queda en `ingestas`.
- [x] Web (`web/`): panel ordenado por cierre, filtros (texto, plazo, comunidad y presupuesto) y ficha con criterios, solvencia y pliegos. Compila.
- [x] Contraseña del rol y `licitaciones` expuesto en la Data API (los hizo Álvaro en el panel).
- [x] **Primera ingesta (24/09/2026):**
  - agosto: 51.819 entradas, 2.375 de TI;
  - septiembre: 2.361 de TI, de ellas 1.181 nuevas y 1.180 actualizadas;
  - datos hasta el 21/09 a las 16:16;
  - en la base: **3.556 licitaciones, 301 abiertas y 53 que cierran en 3 días o menos**. El 91% trae criterios del feed.
- [x] **Controles:**
  - una segunda ejecución responde "sin cambios" (ETag);
  - la clave pública lee;
  - y un `PATCH` con la clave pública da `permission denied` (control negativo de la RLS).
- [x] Prueba de la web en el navegador (Álvaro): "se ve genial". El reloj analógico se cambió por uno digital de panel.
- **Decidido: la web vive en localhost.** Es para demos y para el vídeo promocional; no se publica.

## Extracción en el producto (24/09/2026)

- [x] Código compartido en `src/pliegos/`:
  - `descargar.ts`: caché, pausa de 3 s y PDF dentro de un ZIP;
  - `extraer.ts`: Ollama y bloques de esquema;
  - `validar.ts`: citas con coincidencia tolerante, más la forma de cada campo (grupo de la A a la V, patrón de certificación, un seguro va a solvencia económica).
- [x] Tabla `extracciones` (`db/003`) y comando `npm run extraer`: abiertas sin leer, primero las que cierran antes. Reintenta errores y libera la VRAM al terminar.
- [x] **Banco de 8 pliegos con validadores:** 41 aceptados de 79. Quitaron todo el ruido de clasificación ("N/A", "No", "Servicios TI"), el ROLECE, seguros y certificados genéricos, y 21 repeticiones de un pliego en bucle.
- [x] **Primera tanda real:** 28 de 30 pliegos leídos, a unos 13 s de modelo cada uno, con 177 requisitos aceptados de 210. Los 2 restantes dieron un error 500 de PLACSP al descargar.
  - A ojo, bien: umbrales de volumen de negocio, ISO 20000 y 27001, ENS medio y alto, ITIL, o "partner de ESRI con categoría Silver" (un requisito que el anuncio no dice).
  - A ojo, flojo: a veces lista como solvencia los documentos que la acreditan, repite requisitos con distinta redacción, y un seguro de responsabilidad civil acabó en solvencia técnica.
- [x] Web: marca "Pliego leído" en el panel y, en la ficha, "Lo que pide el pliego" con la página (enlaza al PDF en `#page=N`) y la cita desplegable.
- [ ] Leer el resto de abiertas (~270, cerca de una hora de GPU).
- [ ] Afinar: validador para "documentos de acreditación", el seguro de responsabilidad civil a económica también desde técnica, y fusionar requisitos casi iguales.

## Fase 3: perfil de empresa y encaje (24/09/2026)

- [x] **Perfil en el navegador** (`web/src/lib/perfil.ts`), sin login porque la web es para demos en local. Datos: facturación, familias de CPV, certificaciones y clasificación. Tres ejemplos ficticios y marcados como tales, más uno propio editable.
- [x] **Encaje con reglas deterministas** (`web/src/lib/encaje.ts`). El veredicto es *Encajas*, *Revisar* o *No llegas*, cada comprobación con su cita del pliego.
  - **Volumen de negocio:** el umbral del pliego contra la facturación. Si el pliego no lo fija, **referencia legal aproximada de la LCSP, art. 87.3 a)**: 1,5 veces el valor estimado si dura hasta un año, 1,5 veces el valor anual medio si dura más. Es aproximada porque el feed da la duración inicial sin prórrogas. Nunca da "no llegas", solo "revisar".
  - **Certificaciones:** un ENS alto cubre al medio y al básico. Si falta una, **decide la cita**: si habla de puntos o mejora, es informativa; si dice deberá, exige o acreditar, "no llegas"; si no queda claro, "revisar". Motivo: el modelo trae a veces ISO que solo puntúan.
  - **Clasificación:** grupo, subgrupo y categoría; las categorías antiguas A a F equivalen a 1 a 6.
  - **Actividad (CPV) y solvencia técnica:** informativas, no deciden el veredicto.
- [x] **Web:** selector de empresa en la cabecera con editor, filtro de encaje (de tu actividad, posibles, solo las que encajas), marca por fila y, en la ficha, "¿Puedes presentarte?".
- [x] **Comprobado con datos reales**, 45 licitaciones con pliego leído:

  | Perfil | Encajas | Revisar | No llegas |
  |---|---|---|---|
  | Estudio web (180.000 €, sin certificaciones) | 19 | 11 | 15 |
  | Consultora de ciberseguridad (1,2 M€, ISO 27001, ENS alto) | 38 | 6 | 1 |
  | Integrador grande (12 M€, todo) | 40 | 5 | 0 |

  Los umbrales de volumen revisados a mano son reales: por ejemplo, 243.900 € de presupuesto dan 364.500 € exigidos, que es 1,5 veces, la regla de la LCSP.

## Banco de referencia: precisión medida de la extracción (24/09/2026)

Claude anota a mano lo que exige cada pliego **sobre las mismas páginas que vio el modelo** (`evals/referencia/*.json`, versionado). `npx tsx scripts/referencia/comparar.ts` compara campo por campo y **el veredicto de los tres perfiles de ejemplo**. `scripts/referencia/preparar.ts` elige los pliegos y vuelca sus páginas a `data/referencia/`.

**Límite:** mide al modelo con las páginas que eligió el selector. Si el selector se dejó fuera la página clave (le pasó a un pliego de Ineco, cuyo cuadro no se envió), el banco no lo ve.

**Primera ronda, 25 pliegos de 12 a 241 páginas:**

| Campo | Antes de afinar | Después |
|---|---|---|
| Volumen de negocio | 12 exactos y 11 sin cifra en ninguno de los dos (**23/25**), 1 omitido, 1 erróneo, 0 inventados | igual |
| "No exige solvencia" | 21/25 | igual |
| Seguro RC | detecta 1 de 5 | igual |
| Certificaciones | 8 aciertos, 12 que sobran, 6 que faltan | 8 / **6** / 6 |
| Clasificación | 1 acierto, 1 que sobra | 1 / **0** |
| Veredicto estudio / ciberseguridad / integrador | 19 / 22 / 23 de 25 | **24 / 23 / 24** de 25 |

- **Arreglos en `validar.ts`:**
  - el subgrupo tiene que ser una cifra (el modelo leyó el CNAE "J-62" como grupo J);
  - el ENS solo cuenta si la cita habla de certificación o conformidad (lo anotaba cada vez que el pliego mencionaba el RD 311/2022);
  - una "certificación" que es una lista de tres o más cosas se descarta (copió la lista de ejemplo de sus propias instrucciones).
- ⚠️ **Cifras optimistas:** los validadores se afinaron mirando estos mismos 25. **Pendiente: 10 a 15 pliegos nuevos como conjunto de validación**, que es la cifra que se puede publicar.
- **Trampa superada:** en Aena, los "3.000 M€" son el tamaño exigido a quien emite los certificados, no al licitador. El modelo no lo tomó como umbral.
- **Límite de la referencia legal:** cuando el pliego pide "1,5 veces el valor anual medio" y el valor estimado incluye prórrogas, la duración inicial del feed hace que se pase (20415924: 210.000 € calculados frente a 105.000 € reales).

**Validación a ciegas, 12 pliegos nuevos (`evals/validacion/`, `comparar.ts --validacion`):**

| | Estudio | Ciberseguridad | Integrador |
|---|---|---|---|
| Banco de ajuste (25), tras afinar | 25/25 | 23/25 | 24/25 |
| **Validación a ciegas (12), reglas congeladas** | **8/12** | **9/12** | **10/12** |
| Validación (12) tras arreglar reglas: ya no es ciega | 12/12 | 11/12 | 11/12 |

- **La cifra que se puede publicar es la de reglas congeladas: acierta el veredicto en 2 de cada 3 a 5 de cada 6 pliegos nuevos.** La de abajo solo dice que los arreglos corrigen lo que se vio; hace falta otro lote a ciegas para medirlos.
- **Volumen de negocio a ciegas:** 11/12 (9 exactos, 2 sin cifra en ninguno de los dos, 1 omitido, 0 inventados). El dato más importante aguanta.
- **Dos errores del anotador**, vistos al revisar las citas del modelo: certificaciones omitidas en 20276223 (partner de CEGID, ENS medio) y 20415746 (ENS medio). Se corrigieron con nota. El modelo tenía razón.
- **Hallazgo:** en 20480424 el modelo **inventó "ISO 9001"** y la colgó de una cita real que hablaba de solvencia económica: el 9001 no aparece en todo el pliego. La comprobación de citas prueba que el texto existe, no que el dato salga de él.
- **Arreglos tras la validación:**
  - el nombre de la certificación tiene que aparecer en su cita o en la página citada (el modelo a veces cita el arranque del párrafo y el dato va en la frase siguiente);
  - se aceptan certificaciones de fabricante ("certificación para dar mantenimiento…", "acreditación como partner");
  - en el encaje, la obligación se mira antes que la puntuación, con más formas de decirla ("habrá de", "es necesario", "en posesión", "condición especial de ejecución").

**Segundo lote a ciegas, 12 pliegos (`evals/validacion-2/`), con las reglas arregladas y congeladas:** veredicto **7/12, 8/12 y 8/12**. Los arreglos corrigieron lo visto, pero no generalizan.

**Cifra publicable: 24 pliegos que nunca se miraron al afinar:**

| | Resultado |
|---|---|
| **Umbral de volumen de negocio** | **23/24 coinciden** con la lectura de referencia; **0 cifras inventadas** |
| "No exige solvencia" | 19/24 |
| Veredicto estudio / ciberseguridad / integrador | **15/24 (63%) · 17/24 (71%) · 18/24 (75%)** |

**Por qué falla el veredicto (lote 2), sin corregir todavía:**
- **Clasificación, la que más pesa, porque tumba a los tres perfiles a la vez.** El modelo leyó el rótulo "APARTADO F / F1 CLASIFICACIÓN" como grupo F, subgrupo 1 (forma válida, así que pasa el validador). Y marcó como "exigida" una clasificación que solo era alternativa a la solvencia (J-2).
- **Certificaciones de otra cosa:** ITIL de los técnicos (personal, no la empresa) y ENS de otro lote.
- **Casos ambiguos del propio anotador:** "el 159.6.b exime de acreditar, pero hay que disponer de la solvencia del cuadro". Anotado como las dos cosas, y el encaje lo trata como "no exige".

**Siguiente, si se sigue afinando** (y luego un tercer lote a ciegas para medirlo):
- que la clasificación nunca dé "no llegas" salvo que la cita diga "exigible" u "obligatoria" (en servicios casi nunca lo es);
- descartar grupos que vengan de rótulos ("F1", "apartado F");
- separar las certificaciones de personal (ITIL, PMP) de las de empresa.

**Incidente:** Ollama murió a las 17:53 sin mensaje en su registro, y el motor marcó 150 pliegos seguidos como error. Ahora el motor para tras 3 fallos seguidos del modelo. Los errores se reintentan en la siguiente ejecución.

## Fase 0 cerrada y prueba de extracción local hecha

- [x] Feed de PLACSP verificado: trae CPV, presupuesto, plazo, criterios y enlaces a PCAP y PPT. Un PCAP de prueba se descargó como PDF con texto.
- [x] Parser de entradas CODICE (`src/placsp/entrada.ts`).
- [x] Script de medición (`scripts/fase0/medir-mes.ts`). Banco de extracción: `scripts/fase2/probar-extraccion.ts`, que usa los mismos módulos que el motor.
- [x] Resultados de agosto 2026 → ver abajo.

## Prueba de extracción con LLM local (24/09/2026)

Sin API de Claude: el LLM es **Ollama en local** (RTX 3070 Ti de 8 GB, de los que otras aplicaciones ocupan ~1,9 GB). Script: `scripts/fase2/probar-extraccion.ts`. Selector de páginas: `src/pliegos/paginas.ts`, que deja cada pliego en 10 a 15 páginas (~10 k tokens).

| Modelo | En GPU | Velocidad | Por pliego |
|---|---|---|---|
| qwen3:8b | 5,8 de 7,8 GB (el resto va a CPU) | 9 tok/s | 240 a 400 s, uno pasó de 300 s |
| **qwen3:4b** | entero (5,4 GB) | **97 tok/s** | **20 a 27 s** |

Leer el pliego cuesta ~5 s y Ollama reutiliza la caché del prefijo entre llamadas. **Lo lento es generar**, y se arregla con que el modelo quepa entero en la GPU.

**Calidad de qwen3:4b en 4 pliegos, revisados a ojo:**
- ✅ Hosting de la Autoridad Portuaria (43 págs): seguro de responsabilidad civil de 100.000 €, servicios similares en 3 años, ISO 27001, 22301 y 27017 y ENS. Criterios 40/60, igual que el feed.
- ✅ Microsoft 365 (25 págs): correcto, incluido "no se exige solvencia" (art. 159.6.b).
- ⚠️ Navegación aérea (124 págs): volumen de negocio de 60.000 € por lote correcto. Confunde criterios de puntuación con solvencia técnica, y sin presupuesto ni duración.
- ❌ Soporte de una aplicación (80 págs): **rellena con texto de relleno** ("Grupo de empresas", o la propia frase de las instrucciones como certificación).

**Trampas de Ollama 0.23:**
- Con `format`, rechaza esquemas de más de ~2.000 caracteres con el error engañoso `failed to load model vocabulary required for format`. Se piden en 3 bloques.
- Sin tope, un modelo pequeño puede entrar en bucle rellenando una lista: se acota con `maxItems` y `num_predict`.
- `fetch` de Node corta a los 300 s sin cabeceras.

### Segunda ronda, con los tres arreglos (8 pliegos de 21 a 172 páginas)

1. **El LLM solo pide lo que el feed no trae.** El feed da el valor estimado en el 100%, la duración en el 96% y la garantía definitiva en el 54%. Los criterios con peso solo se piden si faltan en el feed.
2. **Sin cita comprobada, el dato no se muestra.**
   - La cita vale si el 85% de sus fragmentos de 8 caracteres están en la página. Eso tolera erratas de copia ("Critero" por "Criterio", visto en un pliego real) y rechaza lo inventado.
   - **Control negativo:** las citas de cada pliego contra las páginas de otro dan 1 aceptada de 79.
   - Se descartan también las citas de menos de 15 caracteres y las repetidas.
3. **Selector nuevo.** Descarta los índices, castiga las remisiones ("…del Anexo I") y premia las cifras y el bloque del cuadro de características. Tiene palabras clave en inglés y rellena con páginas en orden si encuentra poco.
   - Los dos pliegos que fallaban ya reciben las páginas con los datos: 2 de 2 y 5 de 5, localizadas a mano.

**Resultado:** los 8 terminan, en 10 a 46 s cada uno (135 s en total), con **49 requisitos aceptados de 79 propuestos**.

**Calidad a ojo, por campo:**
- ✅ **Solvencia económica**, el dato que decide si una PYME puede presentarse: umbrales reales con su cita (121.000 €, 100.000 €, 65.461,90 €, patrimonio neto de 420.310,89 €).
- ✅ **Solvencia técnica**: perfiles con su dedicación y experiencia en servicios similares.
- ❌ **Clasificación**: ruido ("N/A", "No", "Servicios TI", "A"). La cita existe, pero el valor no es un grupo.
- ⚠️ **Certificaciones**: el ENS está bien, pero se cuelan seguros de responsabilidad civil y el ROLECE, y listas de ISO que parecen mejoras que puntúan.
- **Límite de la comprobación de citas:** prueba que el texto existe, no que esté en el campo correcto. Un pliego archivó su solvencia como certificación.

**Siguiente para la extracción:**
- ~~Validadores deterministas por campo~~: hechos en `src/pliegos/validar.ts`. Ver "Extracción en el producto" más arriba.
- **Anotar a mano 20 o 30 pliegos** como referencia, para medir la precisión por campo y comparar modelos (`gemma4:12b-it-qat`, que irá en parte a la CPU).

## Fases

0. **Medir** un mes: volumen TI al día, cobertura de pliegos y de campos estructurados, porcentaje de PDF escaneados y tamaño de los pliegos.
1. **Ingesta y listado** con filtros, sin LLM.
2. **Extracción con LLM**, pliegos anotados a mano y evals en CI.
3. **Encaje con el perfil**, avisos y chat con citas.

## Resultados fase 0

Agosto 2026 (`npm run fase0 -- 202608 40`, 24/09/2026). Informe completo en `data/fase0/informe-202608.json`.

**Feed.** 51.819 entradas, 34.819 licitaciones distintas y 9.015 abiertas en el mes (291 al día). **TI (CPV 72 o 48): 559 abiertas, 18 al día.**

| Medida (TI abiertas) | Valor |
|---|---|
| Con PCAP / con PPT | 99,5% / 99,5% |
| Con lotes | 10,6% |
| Criterios de adjudicación ya en el feed | 88,0% |
| Solvencia económica / técnica ya en el feed | 72,1% / 73,7% |
| Presupuesto sin IVA, mediana / p90 | 82.404 € / 1.590.879 € |
| Días de plazo, p10 / mediana | 13 / 18 |

**Muestra de 40 PCAP.**
- 39 PDF y 1 ZIP: el pliego venía empaquetado.
- Escaneados: 5,1% (2 de 39).
- Páginas, mediana / p90: 50 / 136.
- Caracteres sin espacios, mediana / p90: 122 k / 323 k, del orden de 30 k / 80 k tokens.

**Conclusiones.**
- **Volumen:** 18 TI al día son unos 550 pliegos al mes. Se pueden analizar todos los de TI sin salir de un ritmo prudente.
- **Motor apagado:** con p10 = 13 días de plazo, basta encenderlo **una vez por semana** para no perder casi ninguna.
- **OCR:** no entra en la v1. Los escaneados se marcan como "no legible". Los ZIP se abren y se busca el PDF dentro.
- **El listado de la fase 1 ya aporta sin LLM:** criterios y tipo de solvencia vienen en el feed en 3 de cada 4 casos o más.
- **Pliegos largos (p90 de 136 páginas):** en la fase 2 hay que decidir si se manda entero o se localizan antes las secciones de solvencia y criterios. Se decide midiendo coste y precisión.
- ⚠️ **El filtro "cualquier CPV 72/48" mete ruido.** Revisando a ojo los títulos de la muestra salen gestión de redes sociales, webinars, un monitor cardíaco o una lectora de exámenes: unas 6 de 40. Llevan un CPV TI secundario. Hay que afinarlo en la fase 1: CPV principal, o peso del CPV TI frente al resto.
