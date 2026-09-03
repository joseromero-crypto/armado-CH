# Manual de uso — App Armado CH

**Calii · Armado de pedidos entre hubs**
Versión 2 · Septiembre 2026

---

## Índice

1. [Qué es esta app y para qué sirve](#1-qué-es-esta-app-y-para-qué-sirve)
2. [Antes de empezar](#2-antes-de-empezar)
3. [Guía del armador](#3-guía-del-armador)
4. [El semáforo de inventario](#4-el-semáforo-de-inventario)
5. [Guía del coordinador](#5-guía-del-coordinador)
6. [Inventario y segunda ronda](#6-inventario-y-segunda-ronda)
7. [Registro de salidas](#7-registro-de-salidas)
8. [Métricas](#8-métricas)
9. [Cuando no hay internet](#9-cuando-no-hay-internet)
10. [Problemas comunes](#10-problemas-comunes)
11. [Glosario](#11-glosario)

---

## 1. Qué es esta app y para qué sirve

La app sirve para **armar los pedidos que un hub le pide al CH**, producto por producto, verificando cada
código de barras y cada cantidad.

Antes esto se hacía con una hoja impresa. El problema de la hoja no es la velocidad: es que nadie puede saber
después si un producto se verificó de verdad, quién lo armó, a qué hora, ni por qué faltó. La app captura todo
eso sola, sin que el armador tenga que anotar nada.

**El armador solo hace dos cosas: escanear el código y escribir la cantidad.** Todo lo demás lo calcula y lo
guarda la app.

### Quién usa qué

| Rol | Qué hace en la app |
|---|---|
| **Coordinador** | Sube los pedidos del día, administra la lista de armadores, descarga reportes, revisa métricas e inventario |
| **Armador** | Selecciona su hub y su nombre, arma el pedido, lo termina |
| **Responsable de inventario** | Recibe el reporte de faltantes del día para confirmarlos |

### Dónde vive la información

Nada se guarda solo en el teléfono. Todo sube a la nube (Supabase) apenas pasa. Eso significa que:

- Un armado empezado en un teléfono se puede continuar en otro.
- Si un teléfono se pierde o se apaga, no se pierde el trabajo.
- El coordinador ve los reportes desde cualquier dispositivo.

---

## 2. Antes de empezar

### Abrir la app

La app se abre en el navegador del teléfono, con la liga que te compartieron. No se descarga de ninguna tienda.

**Recomendación:** agrégala a la pantalla de inicio del teléfono. En el navegador, menú → *Agregar a pantalla
de inicio*. Así se abre como cualquier otra app y a pantalla completa.

### La pantalla de inicio

Al abrir verás dos botones:

- **Coordinador** — pide un PIN de 4 dígitos.
- **Armar Pedido** — entra directo, sin contraseña.

Abajo, una línea gris te dice si la base de imágenes cargó bien. Si dice `⚠ Sin imágenes`, la app **funciona
igual**: solo no vas a ver la foto de los productos.

Si hay reportes que no se han podido enviar, aparece una pastilla: `⏳ 1 pendiente de enviar`. Tócala para
reintentar. Ver [sección 9](#9-cuando-no-hay-internet).

---

## 3. Guía del armador

### Paso 1 — Elegir hub y nombre

Toca **Armar Pedido**. Verás la lista de hubs. Toca el tuyo.

La app busca sola el pedido más reciente de ese hub y te dice:

> `✓ Cargado el 2026-09-02 — 112 productos`

**Si la lista no es de hoy**, la franja se pone ámbar y sale una ventana: *"Esta lista NO es de hoy"*. El
coordinador no subió un pedido nuevo para este hub. **No puedes iniciar el armado hasta cerrar esa ventana**
con *Entendido*. Antes de cerrarla, avísale al coordinador si debería haber una lista de hoy. Si tocas la
franja ámbar, la ventana vuelve a salir.

Después elige **tu nombre** de la lista. Es obligatorio: es lo que hace que el reporte diga quién armó cada
producto. Si tu nombre no aparece, pídele al coordinador que te agregue.

Toca **Iniciar Armado**.

### Si aparece un aviso amarillo

Significa que **ya hay un armado a medias** para ese hub — tuyo o de un compañero. Tienes dos opciones:

- **↩ Continuar pedido** — retoma donde se quedó, con todo lo ya armado. Puedes continuar el pedido de otra
  persona sin problema; la app guarda quién armó cada renglón.
- **Nuevo armado** — descarta lo anterior y empieza de cero.

Mientras el aviso esté ahí, *Iniciar Armado* está bloqueado. Es a propósito: para que nadie borre por accidente
el trabajo de alguien más.

### Paso 2 — La lista

Los productos vienen ordenados por **posición de armado**, para que camines el CH una sola vez. Puedes moverte
libremente, pero seguir el orden es lo más rápido.

Arriba verás:

- El nombre del hub.
- El contador `23 / 122` — cuántos llevas de cuántos.
- La barra de progreso verde.
- `❓` la leyenda de iconos · `💾` guardar y salir · **Finalizar pedido**.

En cada renglón: la foto, el nombre completo, la posición, la cantidad pedida, y las etiquetas que apliquen
(fecha mínima, semáforo de inventario).

### Paso 3 — Armar un producto

Toca el renglón. Se abre un panel debajo, sin salir de la lista.

**a. Escanear el código de barras**

El cursor ya está en el campo. Dispara la pistola y listo. La app compara con el código del sistema:

| Resultado | Qué significa |
|---|---|
| ✅ verde | Coincide. Sigue. |
| ❌ rojo | No coincide. **No confirmes.** Verifica que sea el producto correcto. |

Si el código del sistema trae un cero al inicio y la pistola no, o al revés, la app lo acepta igual. Eso ya
está resuelto y no tienes que hacer nada.

Dos salidas cuando el código no se puede leer:

- **No puedo escanear** — la etiqueta está rota, borrada o no la hay.
- **Código equivocado en sistema** — el producto físico tiene un código distinto al que trae el sistema. La app
  guarda el código físico que escaneaste; con eso se corrige el catálogo después. **Úsala cuando aplique**, es
  la única forma de que ese error llegue a quien lo puede arreglar.

Si el producto no tiene código en el sistema, la app no te pide escanear.

**b. Revisar la fecha mínima**

Arriba del campo de cantidad hay una franja ámbar:

> 📅 **Vencimiento mínimo: 15/09/2026**
> No armar producto con fecha anterior

**Solo se lee, no se captura.** Compara con la caja. Si el producto no cumple, no lo mandes: márcalo como
faltante con el motivo *Fecha no cumple* (ver abajo).

Si el pedido no trae datos de vida de anaquel, la franja no aparece.

**c. Escribir la cantidad**

Escribe **las piezas o kilos que realmente pusiste en la caja**. No lo que pedían — lo que armaste.

El campo empieza vacío a propósito. Es la única forma de estar seguros de que alguien contó.

Toca **Confirmar**. La app abre sola el siguiente producto pendiente.

### Los cuatro resultados de cantidad

| Estado | Cuándo | Icono |
|---|---|---|
| **Completo** | Armaste exactamente lo pedido | ✅ |
| **Sobrante** | Armaste de más | ⬆️ |
| **Parcial** | Armaste algo, pero menos de lo pedido | ⬇️ |
| **Faltante** | No armaste nada | ❌ |

El icono `⚠` junto al estado quiere decir que hay algo que revisar con el código de barras de esa fila (código
ilegible o distinto al del sistema). El estado siempre habla de la cantidad; el código se registra aparte.

### Ver un pedido ya armado

En la pantalla de inicio del armado, **📋 Pedidos armados** lista los armados terminados de los pedidos que
siguen cargados (no es un historial). Tócalos para volver a ver el resumen, solo de lectura. Sirve para revisar
tu trabajo o el de un compañero sin pedirle nada al coordinador.

### Paso 4 — Cuando un producto no se arma

Toca **⚑ Faltante**. La app pregunta por qué:

- **📭 No se encontró** — no había, o no lo hallaste.
- **📅 Fecha no cumple** — sí había, pero con fecha más corta que la mínima.

**Los dos motivos importan y no son lo mismo.** *Fecha no cumple* no es culpa de nadie en el CH: es una señal
de lo que estamos recibiendo del proveedor, y se mide aparte.

Marcar faltante salta el código y la fecha. Son dos toques, siempre, para cualquier producto. No hay atajos ni
botones para marcar varios de golpe — a propósito.

### Paso 5 — Guardar y salir a medias

Toca **💾**. La app guarda todo y te regresa al inicio. Cualquier armador puede retomar ese pedido después,
desde cualquier teléfono.

Úsalo para la comida, un cambio de turno, o si te toca dejar el pedido para el día siguiente. **No pierdes
nada.**

El botón **←** de arriba a la izquierda: si no has confirmado nada, sale limpio; si ya hay trabajo, te manda a
*Guardar y salir*.

### Paso 6 — Terminar

Toca **Finalizar pedido**. Verás el resumen: total, completos, parciales, faltantes, y el detalle producto por
producto. En cada fila, el número grande de la derecha es **lo armado** (lo que se teclea al registrar), abajo
del nombre van el código de barras y, si falta cantidad, cuánto falta.

Aquí hay dos botones:

- **← Seguir armando** — regresa a la lista. El resumen **todavía no guarda nada**; es un paso de revisión.
- **Terminar armado** — ahora sí sube el reporte.

Después de tocar *Terminar armado* verás uno de tres mensajes:

| Mensaje | Qué hacer |
|---|---|
| ✅ Reporte guardado correctamente | Listo. Toca *Listo →* |
| 📶 Sin conexión — el reporte se enviará solo | Toca *Listo →*. Se envía solo al reconectar. **No lo vuelvas a armar.** |
| ❌ Error al guardar | Toca *Reintentar*. Si sigue fallando, *Salir (reporte pendiente)* y avisa al coordinador |

---

## 4. El semáforo de inventario

### El problema que resuelve

El número de inventario del pedido es una **foto del CH tomada en la mañana**, y es la misma para todos los
hubs. Si hay 15 piezas y cinco hubs piden 29 entre todos, los cinco ven "15" y cuatro salen a buscar algo que
ya se llevaron. Cada búsqueda perdida son unos cinco minutos.

### Cómo funciona

La app registra **cada confirmación de cada armador, de todos los hubs, en el momento en que pasa**. Con eso
calcula:

```
disponible  =  inventario  −  lo que ya armaron los otros hubs hoy
```

Lo que arma **tu propio hub** no cuenta en tu semáforo: eso eres tú.

### Los tres colores

| Color | Qué significa | Qué haces |
|---|---|---|
| **Verde** (no se muestra nada) | Nadie ha tomado lo suficiente para afectarte | Busca normal |
| 🟡 **Amarillo** | Puede que ya no alcance | **Búscalo, y si no está a la vista, marca faltante y sigue** |
| 🔴 **Rojo** | Ya se armó todo el inventario | **No lo busques.** Marca faltante y sigue |

El panel siempre te enseña la cuenta:

> 🔴 **Ya no hay — no lo busques**
> Inventario CH 15 · otros hubs ya armaron 15 hoy · 10:04

**Se te enseña la cuenta a propósito.** Un punto de color sin explicación se ignora la primera vez que alguien
encuentra el producto de todos modos.

### Reglas importantes

- **El semáforo nunca bloquea nada.** Un producto en rojo se puede armar igual si lo encuentras. El color te
  dice cuánto tiempo vale la pena invertir, no qué hacer.
- **Nunca cambia el orden de la lista.** La ruta de caminado no se altera.
- **Todo empieza en verde cada mañana**, sin importar en qué orden se subieron los pedidos. Ningún hub tiene
  prioridad sobre otro. Quien llegue primero al anaquel se lo lleva, igual que siempre.
- **El rojo es solo aritmética.** Solo se pone rojo cuando las piezas que existían fueron escaneadas y
  confirmadas por personas. Que alguien diga "no lo encontré" **nunca** pone algo en rojo.
- **Tres armadores** reportando que no encontraron un producto lo ponen en 🟡, nunca en 🔴.
- El panel abierto **no se actualiza solo** mientras lo tienes en la mano. Los colores cambian en la lista y la
  próxima vez que lo abras. Un color cambiando bajo tu dedo a medio escaneo es cómo se arma mal un producto.
- Si el servidor de inventario no responde, **no hay colores y ya**. La app sigue funcionando exactamente
  igual, sin errores.

### 🔁 Por revisar

Si marcaste un producto como *no se encontró* y **otro armador después sí lo encontró**, tu renglón recibe un
🔁 y baja a una sección al final de la lista.

Arriba aparece `🔁 2`. Tócalo y te lleva a esa sección.

Los renglones te dicen **quién lo encontró y a qué hora**, para que le puedas preguntar dónde estaba. No es un
regaño: la mayoría de las veces llegó mercancía a media mañana. Si ya terminaste el pedido, no pasa nada.

Los productos pendientes nunca se mueven de lugar. Solo se agrupan los ya resueltos.

---

## 5. Guía del coordinador

Toca **Coordinador** e ingresa el PIN de 4 dígitos. Se pide una vez por sesión.

### Cargar pedidos

Una fila por hub. Cada una muestra la última carga o `Sin pedido`.

1. Toca el hub, elige el archivo CSV.
2. La app revisa el archivo y sube.
3. La etiqueta cambia a `✓ 2026-09-02 (112 prod.)`.
4. El `🗑` borra el pedido de ese hub, con confirmación.

**Sube el archivo completo, sin filtrar.** La app separa sola:

- **Activos** — con inventario en el CH. Son los que ve el armador.
- **Reserva** — con inventario en cero. **El armador no los ve**, ni tachados ni al final. No existen para él.

La fila te muestra `112 activos · 175 reserva`.

#### Dos avisos que pueden salir al subir

**Códigos de barras sospechosos.** Google Sheets a veces daña los códigos largos al exportar
(`7501039122716` → `7501039000000`). La app los detecta y te enseña la lista.

> **La solución de raíz:** antes de exportar, formatea la columna del código como **Texto sin formato**.

**Armado en progreso.** Si alguien está armando ese hub, subir un pedido nuevo dejaría ese trabajo huérfano. La
app te avisa y te deja decidir.

### Armadores

Escribe el nombre y toca `+` o Enter. El `✕` lo quita.

Esta lista es la que ve el armador al elegir su nombre, y es lo que hace que las métricas sean atribuibles.
**Sin nombres configurados, no hay métricas por persona.**

### Reportes

- **Activos** — los generados desde la última carga de ese hub.
- **📁 Ver historial** — todos los anteriores, en gris.

Cada uno: `10:42 — Diego` con `⬇` descargar, `📋` copiloto de registro, `🗑` borrar.

**Nunca se borran solos.** Al subir un pedido nuevo, los anteriores pasan al historial.

Si un pedido se armó en dos rondas, el reporte de la segunda aparece indentado bajo el de la primera.

### 📄 No surtido

Por hub, descarga los renglones de **reserva** — lo que se pidió y nunca se le mostró a nadie porque no había
inventario. Sirve para resurtido.

### ⚠️ Conflictos y faltantes de hoy

Dos secciones:

**Conflictos de inventario** — productos donde la suma de lo que piden todos los hubs supera el inventario:

> `Leche Lala 1L · Inv 15 · pedido 29 en 5 hubs · faltan 14`

Esto **se ve antes de que nadie camine el CH**. Avisarle al armador ahorra cinco minutos; corregir la solicitud
ahorra el viaje completo.

**Faltantes de hoy** — todo lo que no se armó, agrupado, con el motivo. Los marcados *desmentido* son los que
otro armador sí encontró: revísalos primero.

El botón **📭 Faltantes del día (CSV)** descarga la lista para el responsable de inventario: un archivo por día,
ordenado por posición para caminar el CH una sola vez. Ya trae la columna **Reportes** (cuántos armadores
distintos reportaron ese producto — un 2 o más quiere decir que de verdad no está) y **deja fuera los
desmentidos**.

---

## 6. Inventario y segunda ronda

### Por qué existe

Seis de cada diez productos solicitados llegan con inventario en cero y nunca se le muestran a un armador. Pero
durante el día **llega mercancía**. Como el armado va un día adelantado (lo que se arma hoy sale mañana), hay
toda una tarde para armar un complemento.

### Subir el inventario de cierre

En **🔄 Inventario de cierre**, sube la exportación de Retool (*Registro de inventario*). La app la procesa en
la computadora del coordinador — nunca se manda a un teléfono.

### Revisar

**Revisar inventario nuevo vs pendientes** compara lo que quedó pendiente en cada hub contra el inventario
actual:

```
MH Contry ........... 13 SKUs con inventario nuevo   [ Ver ]  [ Generar complemento ]
MH Cumbres ..........  2 SKUs con inventario nuevo   [ Ver ]  [ Generar complemento ]
```

Un producto entra al complemento cuando **le falta cantidad** y **hay inventario nuevo**. La cantidad que se
pide es **el saldo pendiente**, no la cantidad original: si se pidieron 10 y se armaron 5, el complemento pide
5. Nunca 10 — se armarían dos veces.

#### Por qué no basta con mirar el inventario

Al momento de revisar, **las piezas ya armadas todavía no se han descontado del sistema**. Si solo miráramos el
nivel de inventario, mandaríamos a alguien a buscar producto que ya está en una caja a tres metros.

Por eso hay dos casos y solo uno mira el nivel:

- **Clase A — reserva revivida.** Estaba en cero en la mañana y ahora tiene inventario. Seguro, porque ese
  renglón nunca se le mostró a nadie: nada armado puede estar inflando el número.
- **Clase B — resurtido.** Se armó de menos y hay una **recepción registrada después** de que se subió el
  pedido. Aquí se exige el evento de recepción, no el nivel.

Los que no coinciden con nada se listan aparte. Nunca se asume que no hay.

### Generar el complemento

Siempre es manual: revisas y después presionas. Si la ronda 1 de un hub no ha terminado, el botón está
bloqueado.

El complemento le aparece al armador como **🔄 Complemento del {fecha}** y se arma igual que cualquier pedido.

---

## 7. Registro de salidas

El registro en el sistema **se sigue tecleando a mano**. La app no tiene conexión con Retool ni permiso de
escritura. Lo que sí hace es que teclear sea más rápido y más difícil de perder.

### El copiloto de registro (`📋`)

En cualquier reporte, el `📋` abre una vista pensada para teclear:

- **Ordenada alfabéticamente por producto** — ordena Retool igual con un clic en el encabezado y los dos van
  parejos.
- **Solo lo que se teclea**: producto, `Salida (kg/pz)`, `Faltante`. Nada más.
- **Dos bloques**: `⚠️ Revisar` primero (parciales, sobrantes, faltantes, y cualquier fila con el código por
  revisar — donde se cometen los errores) y `✅ Completos` después.
- **Una casilla por renglón** y un contador `48 / 112`. Se guarda aunque cierres la pantalla.
- Los renglones `Pendiente` no aparecen: no se armó nada, no hay nada que teclear.
- `⬇` descarga la misma lista en CSV.

### Segunda ronda

El campo `Salida` del sistema es un **total acumulado**. Si en la mañana tecleaste 3 y el complemento suma 4,
**tecleas 7, no 4**.

Por eso el reporte de la segunda ronda trae tres columnas: `Armado en la mañana`, `Armado complemento` y
**`Salida (kg/pz)`** — la suma, que es el número que va al sistema. Solo aparecen los productos que se tocaron
en la segunda ronda.

---

## 8. Métricas

El `📊` del coordinador abre la tabla de métricas. Un renglón por armado.

`⚑ · Fecha · Hub · Armador · SKUs · Min reloj · Min activos · SKUs/hr · Faltantes · Fecha corta · % completo · % parcial · % sobrante · % faltante · % surtido · Seg/SKU`

### Los dos tiempos

| | Qué es |
|---|---|
| **Minutos reloj** | De principio a fin, con pausas incluidas |
| **Minutos activos** | Lo mismo, restando cada hueco de más de 5 minutos entre productos |

**Los dos se reportan siempre y nunca se mezclan.** Para comparar contra la medición manual se usa
**minutos reloj**, porque el dato manual también era de reloj. Los minutos activos sirven para saber cuánto de
un armado fue trabajo y cuánto fue espera.

Si un armado se guardó y se retomó al día siguiente, **el hueco de la noche nunca se cuenta**.

### Los porcentajes

- **% completo** — cuántos productos se armaron exactos.
- **% surtido** — cuántos se armaron con al menos una pieza (completos + parciales + sobrantes). Solo se
  excluyen los faltantes.
- **% parcial · % sobrante · % faltante** — el desglose por estado. Sumados con % completo (y la fecha corta y
  lo pendiente) dan 100. Cada uno apunta a una causa distinta: faltante → inventario o acomodo; sobrante → se
  manda la caja completa en vez de la cantidad pedida; parcial → inventario en vivo o mal contado.

Juntos separan dos cosas distintas: qué tan exacto se armó, y qué tanto alcanzó el inventario.

### Las banderas ⚑

Marcan armados que no se pueden comparar contra un promedio normal. **Nunca se esconde ni se excluye nada** —
se marca para que se sepa por qué un número se ve raro.

| | Significa |
|---|---|
| 🌙 | Empezó un día y terminó otro |
| ⏸ | Se guardó y se retomó |
| 🕐 | Hubo una pausa de más de 15 minutos |
| 👥 | Más de un armador |
| 🔹 | Pedido chico (menos de 10 SKUs) — la velocidad no es confiable |
| ⏳ | Se terminó con productos sin armar |
| 📶 | El reporte se envió después, sin conexión |
| ⛔ | Sin dato de tiempo — las columnas de velocidad no significan nada |

### Filtros y descarga

Filtra por armador, hub y periodo. `Solo irregulares` acota a los marcados. Toca cualquier encabezado para
ordenar.

`⬇ CSV` descarga **exactamente lo que ves en pantalla**, con las banderas incluidas.

El total de abajo usa **SKUs totales ÷ horas totales**, no el promedio de las velocidades. Los renglones ⛔
quedan fuera del total y el pie lo dice.

---

## 9. Cuando no hay internet

La app está hecha para el CH, no para una oficina. Nada se pierde por una zona muerta.

**Lo que pasa solo:**

- Cada confirmación se guarda en el teléfono al instante.
- Si no hay señal, se forma en una cola y se manda sola al reconectar.
- El reporte final igual: `📶 Sin conexión — el reporte se enviará solo`. **Toca *Listo →* y ya.** No lo
  vuelvas a armar.
- Si recargas la app sin señal, se abre con el último pedido guardado y te avisa:
  `⚠ Sin conexión — usando el pedido guardado del {fecha}`.
- La pastilla `⏳ N pendiente(s) de enviar` en el inicio te dice si algo sigue en cola. Tócala para forzar el
  envío.

**Regla de oro:** cualquier armado con al menos un producto confirmado deja **siempre** o un reporte o un
armado a medias recuperable. Nunca las dos cosas en cero.

**Lo único que sí necesitas:** internet para *abrir* la app la primera vez del día y para *cargar* el pedido.

---

## 10. Problemas comunes

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `⚠ No hay pedido cargado para este hub` | El coordinador no ha subido el archivo | Avísale |
| Sale una ventana "Esta lista NO es de hoy" | El coordinador no subió el pedido del día para ese hub | Avísale. Para armar esa lista de todos modos, cierra la ventana con *Entendido* |
| No aparece mi nombre | No está en la lista de armadores | El coordinador lo agrega en su pantalla |
| El código no coincide y el producto es el correcto | El catálogo trae otro código | *Código equivocado en sistema* — así se corrige |
| `⚠ Sin imágenes` | No cargó la base de imágenes | La app funciona igual, solo sin fotos |
| Un producto en 🔴 sí estaba | Llegó mercancía, o hubo un ajuste | Ármalo normal. El semáforo nunca bloquea |
| No hay colores en ningún producto | No se alcanza la tabla de inventario | Arma normal. El semáforo es opcional |
| Aviso amarillo al elegir el hub | Hay un armado a medias | *Continuar* o *Nuevo armado* |
| `❌ Error al guardar` | Error del servidor, no de red | *Reintentar*. Si sigue, *Salir (reporte pendiente)* y avisa |
| El coordinador no ve un reporte | Sigue en la cola del teléfono | Abre la app en ese teléfono con señal |
| PIN incorrecto | — | Lo cambia el coordinador en Supabase |

---

## 11. Glosario

| Término | Qué es |
|---|---|
| **CH** | Centro de distribución de donde sale todo. Los siete hubs se arman del mismo CH |
| **Hub** | Cada una de las tiendas que recibe el pedido |
| **SKU** | Un producto distinto del catálogo |
| **Activo** | Producto solicitado que sí tiene inventario. Es lo que ve el armador |
| **Reserva** | Producto solicitado con inventario en cero. No se le muestra a nadie |
| **Complemento / Ronda 2** | Pedido extra generado en la tarde con lo pendiente que ya tiene inventario |
| **Faltante** | No se armó nada de ese producto |
| **Parcial** | Se armó menos de lo pedido |
| **Sobrante** | Se armó más de lo pedido |
| **Fecha corta** | Sí había producto, pero con vencimiento anterior al mínimo |
| **Desmentido** | Un faltante que otro armador sí encontró el mismo día |
| **Semáforo** | Los colores de disponibilidad de inventario entre hubs |
| **Armado a medias / Parcial guardado** | Un pedido empezado y no terminado, que se puede retomar |
| **Salida** | El campo del sistema donde se registra lo que salió. Es acumulado |
| **Minutos reloj** | Tiempo total, con pausas |
| **Minutos activos** | Tiempo total menos las pausas de más de 5 minutos |

---

*Manual de la app Armado CH · Calii · Septiembre 2026*
*Dudas o errores en este documento: coordinación de operaciones.*
