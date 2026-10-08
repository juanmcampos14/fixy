# Referencias de UX: Clickie e IguanaFix

> Revisado el **2026-10-08**. Solo describimos los patrones con nuestras palabras, sin copiar textos. No creamos cuentas ni enviamos formularios.

## Clickie (https://clickie.com.ar/)

- **Cómo se describe el problema:** la entrada principal es un **chat**. El usuario cuenta qué le pasa y tiene a mano **chips con problemas frecuentes** (desagüe tapado, térmica que salta, canilla que gotea). Después un asistente hace **unas pocas preguntas** para precisar el problema. También se puede entrar por **rubro** (plomería, gas, electricidad, etc.) o desde páginas de **lista de precios**.
- **Claridad de precio antes de contratar:** hay dos modalidades.
  - **Precio cerrado** para trabajos comunes. Se calcula con datos de trabajos anteriores, se muestra antes de confirmar y es lo que se paga.
  - **Presupuestos de varios profesionales** para trabajos a medida, que el usuario compara.
  - Las páginas públicas muestran precios "desde", que son **solo de mano de obra** (los materiales van aparte). No vimos mención de un costo de visita.
- **Cómo se contrata:** con precio cerrado, el trabajo se asigna al **primer profesional verificado disponible** ese día. Con presupuestos, **elige el usuario**. Hay seguimiento del pedido con estados (confirmado, en camino, finalizado) en la app o en la web.
- **Pago y confianza:** se **paga al terminar el trabajo** y la plataforma cobra una comisión de servicio. Hay una **garantía propia** que cubre reembolso si el trabajo no se hace o queda mal, y daños durante la visita, siempre que el pedido y el pago pasen por la plataforma. Los profesionales tienen **verificación** (identidad, antecedentes y matrícula cuando corresponde) y reseñas.
- **Alta de profesionales:** el link "Soy profesional" lleva a la descarga de la app (Play Store). El registro se hace **dentro de la app**, y la web no detalla los pasos.

## IguanaFix

- **Argentina:** `iguanafix.com.ar` **no resolvió** (error de DNS o conexión rechazada). `iguanafix.com` muestra un selector de país con **solo Brasil**. 💭 Todo indica que ya no opera en Argentina; notas de prensa viejas (infonegocios.info) lo sugieren, pero no lo confirmamos oficialmente.
- **Sitio de Brasil (portal.iguanafix.com):** hoy está orientado sobre todo a **reclutar profesionales**. Del lado del cliente, el servicio aparece sobre todo como **servicio agregado al comprar muebles** en retailers aliados (por ejemplo, armado), no como un buscador abierto de problemas.
- **Cómo se asignan los trabajos:** los profesionales **eligen los trabajos** de una lista dentro de la app de partners, después de ver los detalles. No hay asignación automática.
- **Alta de profesionales:**
  1. Contacto por WhatsApp.
  2. Registro con especialidad y zona.
  3. Validación y aprobación del perfil por el equipo.
  4. Descarga de la app.
  5. Toma de trabajos.
  6. Ejecución.
  7. **Facturación** y cobro.

  Requisitos: experiencia mínima de un año, inscripción fiscal para facturar y un celular Android.

## Patrones útiles para Fixy

1. **Describir el problema con un chat o texto libre, sumado a chips de problemas frecuentes y 2 o 3 preguntas guiadas.** Reduce la fricción para quien no sabe el nombre técnico del problema.
2. **Dos caminos de precio:**
   - "Precio cerrado" para trabajos estándar, aclarando que es mano de obra y que los materiales van aparte.
   - "Pedí presupuestos" para trabajos a medida, comparando varios profesionales.
3. **Cobro al finalizar el trabajo:** encaja con Split 1:1 de Mercado Pago, que no tiene escrow (ver `mercadopago.md`).
4. **Garantía de la plataforma** condicionada a que el pago pase por la plataforma. Es un incentivo para no cobrar por fuera.
5. **Verificación visible** del profesional (identidad, matrícula, reseñas) y **estados del pedido** visibles.
6. **Onboarding de proveedores con validación manual** (especialidad, zona, documentación) antes de habilitarlos. En nuestro caso, también la conexión con Mercado Pago por OAuth.

## Fuentes

- https://clickie.com.ar/
- https://clickie.com.ar/descargar
- https://www.iguanafix.com
- https://portal.iguanafix.com/ (redirigido desde iguanafix.com.br)
- https://iguanafix.com.ar → no accesible (conexión rechazada) · https://www.iguanafix.com.ar → el dominio no resuelve
- Contexto secundario, no oficial: https://infonegocios.info/y-ademas/tenias-a-iguanafix-reparaciones-para-tu-hogar-u-oficina-tambien-en-cordoba
