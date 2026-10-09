import Link from "next/link";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL, legalContact } from "@/lib/legal";

export const metadata = { title: "Términos y condiciones" };

export default function Terms() {
  const L = LEGAL;
  return (
    <LegalDocument title="Términos y condiciones">
      <p>
        Estos Términos y condiciones (los <strong>“Términos”</strong>) regulan el uso del sitio {L.site}, sus aplicaciones y servicios (la <strong>“Plataforma”</strong> o <strong>“{L.brand}”</strong>),
        cuyo titular es <strong>{L.company}</strong>, CUIT {L.cuit}{L.address ? `, con domicilio en ${L.address}` : ""} (<strong>“{L.brand}”</strong>, <strong>“nosotros”</strong>).
        Al registrarte o usar la Plataforma aceptás estos Términos, la <Link href="/privacidad">Política de privacidad</Link> y, si ofrecés servicios, las <Link href="/terminos/profesionales">Condiciones para profesionales</Link>.
        Si no estás de acuerdo, no uses la Plataforma.
      </p>

      <h2>1. Definiciones</h2>
      <ul>
        <li><strong>Cliente:</strong> persona humana o jurídica que usa la Plataforma para pedir un servicio para un hogar, oficina u otra propiedad.</li>
        <li><strong>Profesional:</strong> persona humana (trabajador independiente) o empresa que ofrece servicios de reparación, instalación, mantenimiento u oficios a través de la Plataforma.</li>
        <li><strong>Usuario:</strong> toda persona registrada, sea Cliente, Profesional o ambos. Una misma cuenta puede usarse en los dos modos.</li>
        <li><strong>Pedido:</strong> la descripción de un problema o necesidad que publica un Cliente.</li>
        <li><strong>Visita:</strong> el encuentro en el lugar para ver el problema, que puede tener un precio fijado por el Profesional o ser sin cargo.</li>
        <li><strong>Presupuesto:</strong> la propuesta de precio y alcance que envía un Profesional dentro de la Plataforma.</li>
        <li><strong>Trabajo:</strong> el servicio contratado una vez que el Cliente acepta una Visita o un Presupuesto.</li>
      </ul>

      <h2>2. Qué es {L.brand} y qué no es</h2>
      <p>
        {L.brand} es una plataforma tecnológica que conecta Clientes con Profesionales y ofrece herramientas para describir el problema, elegir un Profesional, coordinar la Visita,
        recibir y aceptar Presupuestos, comunicarse, pagar, seguir el Trabajo, calificar y resolver reclamos.
      </p>
      <p>
        {L.brand} <strong>no presta los servicios de reparación ni de oficios</strong>. El contrato de servicio se celebra directamente entre el Cliente y el Profesional, que es responsable
        de su ejecución, de su idoneidad técnica, de las matrículas y habilitaciones que correspondan y de sus obligaciones fiscales y previsionales. Los Profesionales son independientes:
        no son empleados, agentes ni representantes de {L.brand}, y no existe entre ellos y {L.brand} relación laboral, societaria ni de dependencia.
      </p>
      <p>
        Lo anterior no limita los deberes que la ley pone a cargo de {L.brand} como proveedor de la Plataforma, ni el compromiso voluntario descripto en la sección “Espíritu Fixy”.
      </p>

      <h2>3. Capacidad y registro</h2>
      <ul>
        <li>Para registrarte tenés que ser mayor de 18 años y tener capacidad legal para contratar. Las personas jurídicas se registran a través de un representante con facultades suficientes.</li>
        <li>El registro es gratuito. Tenés que brindar datos verdaderos, completos y actualizados, y sos responsable por ellos.</li>
        <li>La cuenta es personal e intransferible. Sos responsable de mantener tu contraseña en reserva y de toda actividad que se realice con tu cuenta. Si detectás un uso no autorizado, avisanos de inmediato.</li>
        <li>No podés tener más de una cuenta como Profesional ni registrarte si tu cuenta fue suspendida o cancelada por incumplimiento.</li>
        <li>Podemos pedir información o documentación adicional para verificar tu identidad y rechazar o suspender registros cuando haya indicios de datos falsos, fraude o riesgo para otros Usuarios.</li>
      </ul>

      <h2>4. Cómo funciona un pedido</h2>
      <h3>4.1. Describir el problema</h3>
      <p>
        El Cliente describe el problema, puede adjuntar fotos y elige la propiedad. Un asistente (que puede usar inteligencia artificial) sugiere el tipo de profesional adecuado.
        Esa sugerencia es orientativa: el Cliente puede cambiarla y, si el caso no es claro, lo revisa una persona del equipo.
      </p>
      <h3>4.2. Elegir Profesional y coordinar la Visita</h3>
      <ul>
        <li>El Cliente ve los Profesionales disponibles para su zona y rubro, con su información pública: reseñas, verificaciones, precio de la Visita y precios de referencia.</li>
        <li>Los <strong>precios de referencia “desde”</strong> son orientativos y los publica cada Profesional. El precio final del arreglo se define en el Presupuesto que el Profesional arma después de ver el problema.</li>
        <li>El Profesional elegido tiene un plazo para aceptar y proponer día y franja horaria. Si no responde o rechaza, el Cliente puede elegir a otro.</li>
        <li>La Visita queda confirmada cuando el Cliente la acepta y, si tiene precio, cuando el pago está aprobado. Si el Profesional ofrece descontar la Visita del arreglo, el descuento se aplica una sola vez en el Presupuesto del mismo Trabajo.</li>
        <li>Al llegar, el Profesional pide al Cliente un <strong>código de visita</strong> que figura en la Plataforma, para registrar que la Visita se realizó.</li>
      </ul>
      <h3>4.3. Presupuestos</h3>
      <ul>
        <li>Como alternativa, el Cliente puede pedir varios Presupuestos y compararlos.</li>
        <li>Antes de aceptar, el Cliente ve el detalle completo: mano de obra, materiales, Visita, cargo de servicio, impuestos que correspondan y el total. El alcance y el precio aceptados quedan registrados y no pueden modificarse sin su conformidad.</li>
        <li>Cualquier tarea adicional que surja en el lugar se propone como <strong>adicional</strong> dentro de la Plataforma y solo se realiza y cobra si el Cliente la aprueba expresamente.</li>
      </ul>
      <h3>4.4. Ejecución y conformidad</h3>
      <p>
        El Profesional informa en la Plataforma el avance y la finalización del Trabajo, con evidencias cuando corresponda. El Cliente da su conformidad o, si algo no está bien,
        abre un reclamo (ver sección 10).
      </p>

      <h2>5. Direcciones y privacidad de la propiedad</h2>
      <ul>
        <li>La dirección exacta, los datos de acceso y los datos de contacto en el lugar <strong>los ve y los protege solo {L.brand}</strong>. Ningún Profesional los ve al postularse ni al presupuestar: antes solo ve la zona.</li>
        <li>Se comparten únicamente con el Profesional elegido cuando la Visita o el Trabajo quedan confirmados, y solo para prestar el servicio.</li>
        <li><strong>Barrios cerrados, countries y edificios con control de acceso:</strong> el Cliente puede cargar el reglamento o las condiciones de ingreso (archivo, enlace o texto). {L.brand} puede interpretarlas con inteligencia artificial para armar una lista de requisitos (por ejemplo, seguros, cláusula de no repetición, documentación de la persona y del vehículo, horarios). Esa lista se muestra a los Profesionales invitados <strong>sin el nombre del barrio ni la dirección</strong>, para que sepan antes de aceptar qué necesitan. La interpretación es orientativa: ante cualquier diferencia vale lo que disponga el barrio, y el Cliente es responsable de que la información cargada sea correcta y de autorizar el ingreso.</li>
      </ul>

      <h2>6. Comunicación y pagos dentro de la Plataforma</h2>
      <ul>
        <li>Toda la comunicación, coordinación, aprobación y pago de un Trabajo iniciado en {L.brand} debe hacerse dentro de la Plataforma. Así podemos registrar lo acordado, ayudar ante un problema y aplicar el Espíritu Fixy.</li>
        <li>Para cuidar a ambas partes, la Plataforma puede ocultar automáticamente teléfonos, correos, enlaces y datos bancarios que se compartan en el chat.</li>
        <li>Está prohibido acordar o cobrar por fuera de la Plataforma un Trabajo originado en ella. Los Trabajos contratados por fuera quedan excluidos de toda intervención de {L.brand}, del Espíritu Fixy y de las reseñas, y pueden dar lugar a las sanciones de la sección 13.</li>
        <li>{L.brand} puede revisar las comunicaciones de un Trabajo cuando sea necesario para resolver un reclamo, prevenir fraudes o cumplir una obligación legal.</li>
      </ul>

      <h2>7. Precios, cargos y pagos</h2>
      <ul>
        <li>El precio de cada Visita, Presupuesto y adicional lo fija el Profesional.</li>
        <li><strong>{L.brand} cobra al Cliente un cargo de servicio</strong>, que se informa en forma clara y separada antes de confirmar cada pago, junto con los impuestos que correspondan.</li>
        <li><strong>{L.brand} no cobra comisión a los Profesionales</strong> por los Trabajos realizados a través de la Plataforma. El registro es gratuito y no tiene abono.</li>
        <li>Los pagos se procesan a través de proveedores de servicios de pago. {L.brand} no almacena los datos completos de tarjetas. {L.brand} recibe los pagos de los Clientes por cuenta y orden de los Profesionales y los transfiere según la sección 9 de las <Link href="/terminos/profesionales">Condiciones para profesionales</Link>.</li>
        <li>Pago aprobado no significa que el Trabajo esté terminado: el dinero correspondiente al Profesional se libera recién con la conformidad del Cliente, su reseña y sin reclamos abiertos.</li>
        <li>El Profesional es responsable de emitir al Cliente el comprobante fiscal que corresponda por su servicio. {L.brand} emite el comprobante por su cargo de servicio.</li>
        <li>Mientras la Plataforma indique <strong>“Modo de prueba”</strong>, los pagos y transferencias son simulados y no se mueve dinero real.</li>
      </ul>

      <h2>8. Cancelaciones y arrepentimiento</h2>
      <ul>
        <li>El Cliente puede cancelar sin costo antes de que el Profesional confirme la Visita o el Trabajo.</li>
        <li>Una vez confirmada, la cancelación y el eventual reintegro se resuelven según el caso, considerando si la Visita o el Trabajo ya empezaron, los materiales comprados y el tiempo reservado. Si el Profesional no se presenta o cancela, el Cliente recibe el reintegro de lo pagado por esa Visita o Trabajo.</li>
        <li>Si sos consumidor, tenés derecho a revocar la contratación realizada a distancia dentro de los diez (10) días corridos desde la contratación, conforme al artículo 34 de la Ley 24.240 y al artículo 1110 del Código Civil y Comercial, sin costo ni responsabilidad. Este derecho no aplica si, a tu pedido, el servicio ya se prestó. Podés ejercerlo desde la Plataforma o por {legalContact()}.</li>
      </ul>

      <h2>9. Reseñas</h2>
      <ul>
        <li>Solo puede calificar el Cliente de un Trabajo completado dentro de la Plataforma. Las reseñas tienen que ser veraces, referirse al Trabajo y respetar a las personas.</li>
        <li>Para proteger a quien opina, las reseñas se publican de forma anónima y con una demora variable (por ejemplo, 48 horas, 72 horas o una semana; la regla puede cambiar), de modo que no se pueda identificar qué Cliente escribió cada una.</li>
        <li>La reseña es parte del cierre del Trabajo: es condición para liberar el pago al Profesional, salvo excepciones justificadas que decide {L.brand}.</li>
        <li>Un Profesional puede impugnar una reseña que considere injusta. {L.brand} puede contactar al Cliente, con ayuda de inteligencia artificial, para pedir más información; si no se resuelve, el caso lo revisa una persona del equipo, que puede mantener, editar con acuerdo del autor u ocultar la reseña.</li>
        <li>{L.brand} puede moderar o quitar contenido que viole estos Términos (insultos, datos personales, contenido falso o ajeno al Trabajo). {L.brand} no altera el sentido de una reseña ni la vende ni la cambia a pedido de un Profesional.</li>
      </ul>

      <h2>10. Reclamos</h2>
      <ul>
        <li>Si un Trabajo no se realizó, se hizo de forma distinta a lo acordado o presenta defectos, el Cliente puede abrir un reclamo desde el Trabajo dentro de los quince (15) días corridos desde que se completó.</li>
        <li>Mientras el reclamo está abierto, el pago al Profesional queda retenido.</li>
        <li>{L.brand} revisa el caso con la información registrada en la Plataforma (lo acordado, mensajes, fotos y evidencias), pide información a las partes y propone una solución: que el Profesional corrija el trabajo, un reintegro total o parcial, u otra que corresponda.</li>
      </ul>

      <h2 id="espiritu-fixy" className="scroll-mt-24">11. Espíritu Fixy</h2>
      <p>
        El <strong>Espíritu Fixy</strong> es nuestro compromiso voluntario de que, si contratás y pagás dentro de {L.brand}, no quedes a la deriva. Se suma a los derechos que te da la ley y no los reemplaza.
      </p>
      <h3>11.1. Qué cubre</h3>
      <ul>
        <li><strong>Profesional que no se presenta:</strong> si la Visita o el Trabajo confirmado no se realiza por causa del Profesional, te reintegramos lo pagado por ese concepto, o te ayudamos a coordinar con otro Profesional, según prefieras.</li>
        <li><strong>Trabajo mal hecho o incompleto:</strong> si el reclamo es procedente, primero le pedimos al Profesional que lo corrija sin costo adicional. Si no lo hace en un plazo razonable, te reintegramos total o parcialmente lo pagado por ese Trabajo según lo que no se cumplió.</li>
        <li><strong>Cobros indebidos:</strong> si se te cobró algo que no aprobaste en la Plataforma, te lo reintegramos.</li>
      </ul>
      <h3>11.2. Requisitos</h3>
      <ul>
        <li>Que el Trabajo se haya contratado, coordinado y pagado íntegramente dentro de la Plataforma, sin acuerdos por fuera.</li>
        <li>Que el reclamo se abra en el plazo de la sección 10, con la información y evidencias razonables que se pidan.</li>
        <li>Que permitas al Profesional, cuando corresponda, revisar y corregir el trabajo.</li>
      </ul>
      <h3>11.3. Límites y exclusiones</h3>
      <ul>
        <li>El reintegro tiene como tope el monto efectivamente pagado a través de {L.brand} por el Trabajo reclamado (incluidos sus adicionales aprobados).</li>
        <li>No cubre: trabajos, pagos o materiales acordados por fuera de la Plataforma; materiales o equipos provistos por el Cliente; desgaste normal, mal uso posterior o intervención de terceros; daños indirectos o lucro cesante; diferencias de gusto o estética no acordadas por escrito en el Presupuesto; ni casos en los que el Cliente haya impedido la corrección.</li>
        <li>No es un seguro. Para daños a personas o bienes, el Profesional responde según la ley y, si cuenta con seguros, según sus pólizas; {L.brand} colabora aportando la información registrada.</li>
        <li>Cuando {L.brand} reintegra un monto, puede recuperarlo del Profesional responsable (por ejemplo, de su saldo), en los términos de las Condiciones para profesionales.</li>
      </ul>

      <h2>12. Inteligencia artificial</h2>
      <p>
        {L.brand} usa herramientas de inteligencia artificial para sugerir el tipo de profesional, interpretar reglamentos de ingreso, ayudar a armar perfiles de Profesionales y mediar en impugnaciones de reseñas.
        Sus resultados son orientativos, pueden contener errores y no son un diagnóstico técnico, un presupuesto ni una promesa de disponibilidad. Las decisiones importantes las revisa una persona.
        Antes de enviar texto a estas herramientas, eliminamos los datos de contacto cuando es posible.
      </p>

      <h2>13. Conductas prohibidas y sanciones</h2>
      <p>No está permitido:</p>
      <ul>
        <li>Brindar datos falsos, suplantar a otra persona o usar cuentas ajenas.</li>
        <li>Desviar pagos o contrataciones fuera de la Plataforma, o pedir u ofrecer datos de contacto para hacerlo.</li>
        <li>Publicar reseñas falsas, ofrecer beneficios a cambio de reseñas o presionar a quien opina.</li>
        <li>Acosar, discriminar, amenazar o faltar el respeto a otros Usuarios o al equipo.</li>
        <li>Usar la Plataforma para actividades ilícitas o servicios que requieren habilitación sin tenerla.</li>
        <li>Intentar acceder sin autorización a sistemas o datos, extraer información en forma automatizada o afectar el funcionamiento de la Plataforma.</li>
      </ul>
      <p>
        Ante un incumplimiento, {L.brand} puede advertir, limitar funciones, retener pagos vinculados a la conducta investigada, suspender o cancelar la cuenta, sin perjuicio de las acciones legales que correspondan.
        Te vamos a informar el motivo y vas a poder dar tu descargo.
      </p>

      <h2>14. Contenidos de los Usuarios</h2>
      <p>
        Sos responsable de lo que publicás (descripciones, fotos, mensajes, reseñas y perfiles) y declarás tener derecho a hacerlo. Nos otorgás una licencia gratuita, no exclusiva y
        por el tiempo necesario para alojar, mostrar y usar ese contenido para prestar y mejorar la Plataforma y para promocionar los perfiles de Profesionales dentro de ella.
        Las fotos de pedidos y trabajos pueden contener información de tu propiedad: no subas imágenes de personas ni datos que no quieras compartir.
      </p>

      <h2>15. Propiedad intelectual</h2>
      <p>
        La marca {L.brand}, su personaje, logos, diseños, textos, software y bases de datos pertenecen a {L.company} o a sus licenciantes. No podés copiarlos, modificarlos ni usarlos sin autorización escrita.
      </p>

      <h2>16. Responsabilidad</h2>
      <ul>
        <li>{L.brand} pone a disposición la Plataforma con diligencia razonable, pero no garantiza que funcione sin interrupciones ni errores. Podemos suspenderla temporalmente por mantenimiento o seguridad.</li>
        <li>{L.brand} verifica la identidad y las credenciales que se le presentan, pero no garantiza el resultado de cada servicio, que es responsabilidad del Profesional.</li>
        <li>En la medida permitida por la ley, {L.brand} no responde por daños indirectos ni por hechos de terceros ajenos a su control. Nada de lo establecido en estos Términos limita los derechos que te reconoce la Ley 24.240 de Defensa del Consumidor.</li>
      </ul>

      <h2>17. Protección de datos personales</h2>
      <p>
        Tratamos tus datos conforme a la Ley 25.326 y a nuestra <Link href="/privacidad">Política de privacidad</Link>, donde explicamos qué datos usamos, para qué, con quién los compartimos y cómo ejercer tus derechos.
      </p>

      <h2>18. Defensa del consumidor</h2>
      <p>
        Si sos consumidor, te asisten los derechos de la Ley 24.240 y normas complementarias. Podés hacernos llegar consultas o reclamos por {legalContact()}. También podés acudir a la autoridad de
        defensa del consumidor de tu jurisdicción y, a nivel nacional, a la Ventanilla Única Federal de Defensa del Consumidor (argentina.gob.ar/produccion/defensadelconsumidor).
      </p>

      <h2>19. Cambios en los Términos</h2>
      <p>
        Podemos modificar estos Términos. Te avisaremos por la Plataforma o por correo con al menos diez (10) días de anticipación a su entrada en vigencia, salvo cambios exigidos por la ley
        o necesarios por seguridad. Los Trabajos ya contratados se rigen por los Términos vigentes al momento de contratarlos. Si no estás de acuerdo con los cambios, podés dar de baja tu cuenta;
        si seguís usando la Plataforma, se entiende que los aceptás.
      </p>

      <h2>20. Baja de la cuenta</h2>
      <p>
        Podés pedir la baja de tu cuenta en cualquier momento, siempre que no tengas Trabajos, pagos o reclamos en curso. Conservaremos la información que la ley nos obligue a guardar y la necesaria
        para resolver reclamos pendientes.
      </p>

      <h2>21. Fuerza mayor</h2>
      <p>{L.brand} no será responsable por incumplimientos causados por hechos imprevisibles o inevitables ajenos a su control, como fallas generales de servicios de terceros, desastres naturales o disposiciones de autoridad.</p>

      <h2>22. Notificaciones</h2>
      <p>Te comunicamos novedades por la Plataforma y al correo de tu cuenta, que se tienen por válidas. Mantené tu correo actualizado.</p>

      <h2>23. Disposiciones generales</h2>
      <ul>
        <li>No podés ceder tu cuenta ni los derechos de estos Términos sin nuestro consentimiento. {L.company} puede cederlos en caso de reorganización o transferencia del negocio, con aviso previo.</li>
        <li>Si no ejercemos un derecho, eso no significa que renunciemos a él.</li>
        <li>Si una cláusula fuera inválida, las demás siguen vigentes.</li>
        <li>Estos Términos, las Condiciones para profesionales y la Política de privacidad forman el acuerdo completo entre vos y {L.brand} sobre el uso de la Plataforma.</li>
      </ul>

      <h2>24. Ley aplicable y jurisdicción</h2>
      <p>
        Estos Términos se rigen por las leyes de la República Argentina. Si sos consumidor, es competente el tribunal de tu domicilio. En los demás casos, las partes se someten a los tribunales
        ordinarios de la Ciudad Autónoma de Buenos Aires.
      </p>

      <h2>25. Contacto</h2>
      <p>
        {L.company} · CUIT {L.cuit}{L.address ? ` · ${L.address}` : ""}. Consultas, reclamos y ejercicio de derechos: {legalContact()}.
      </p>
    </LegalDocument>
  );
}
