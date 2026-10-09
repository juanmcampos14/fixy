import Link from "next/link";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL, legalContact } from "@/lib/legal";

export const metadata = { title: "Condiciones para profesionales" };

export default function ProviderTerms() {
  const L = LEGAL;
  return (
    <LegalDocument title="Condiciones para profesionales">
      <p>
        Estas Condiciones complementan los <Link href="/terminos">Términos y condiciones</Link> de {L.brand} ({L.company}, CUIT {L.cuit}) y se aplican a quienes ofrecen servicios en la Plataforma
        (los <strong>“Profesionales”</strong>). Si hay diferencias, para la actividad como Profesional prevalecen estas Condiciones.
      </p>

      <h2>1. Alta y verificación</h2>
      <ul>
        <li>El alta es gratuita. Podés registrarte como trabajador independiente o como empresa con un equipo de técnicos.</li>
        <li>Para recibir pedidos tenés que completar tu perfil, indicar rubros, zonas y disponibilidad, presentar tu documento de identidad y, en los rubros que lo exigen (por ejemplo, gas), la matrícula o habilitación vigente.</li>
        <li>El equipo de {L.brand} revisa la documentación antes de habilitarte. La aprobación no es automática y podemos pedir información adicional o rechazar un alta.</li>
        <li>Tenés que mantener actualizada tu información y avisar si una matrícula o habilitación vence o es suspendida. Las credenciales vencidas impiden recibir pedidos del rubro.</li>
        <li>Si usás la carga asistida por inteligencia artificial, revisá el borrador antes de guardarlo: sos responsable de lo que publicás en tu perfil.</li>
      </ul>

      <h2>2. Independencia</h2>
      <p>
        Prestás tus servicios de manera independiente, con tus propias herramientas, organización y criterio técnico. Decidís qué pedidos aceptar, tus precios, tu disponibilidad y tus zonas.
        No existe relación laboral ni de dependencia con {L.company}. Sos responsable de tus obligaciones fiscales (inscripción, facturación) y previsionales y, si tenés empleados o técnicos, de las obligaciones respecto de ellos.
      </p>

      <h2>3. Cómo te eligen</h2>
      <ul>
        <li>Los Clientes ven a los Profesionales disponibles para su rubro y zona. El orden de la lista considera, entre otros factores, la disponibilidad compatible, la reputación (reseñas), la carga de trabajo, la cercanía y la <strong>fuerza del perfil</strong> (descripción, fotos, verificaciones, precios de referencia y otros datos completos).</li>
        <li>{L.brand} no vende posiciones en la lista.</li>
        <li>Cuando un Cliente te elige, tenés un plazo para aceptar y proponer día y franja. Si no respondés, el Cliente puede elegir a otro Profesional.</li>
      </ul>

      <h2>4. Visitas, presupuestos y adicionales</h2>
      <ul>
        <li>Definís el precio de tu Visita (puede ser sin cargo) y si se descuenta del arreglo cuando el Cliente te contrata.</li>
        <li>Los precios de referencia “desde” que publiques tienen que ser reales y estar actualizados.</li>
        <li>El Presupuesto tiene que detallar alcance, exclusiones, materiales y precio. Una vez aceptado, no podés cambiarlo sin conformidad del Cliente. Todo trabajo extra se propone como adicional en la Plataforma y solo se cobra si el Cliente lo aprueba.</li>
        <li>Al llegar, pedí al Cliente el código de visita y registralo en la Plataforma.</li>
      </ul>

      <h2>5. Direcciones, barrios cerrados y datos de Clientes</h2>
      <ul>
        <li>La dirección y los datos de acceso se te comparten solo cuando la Visita o el Trabajo están confirmados. Usalos exclusivamente para prestar ese servicio y no los guardes ni compartas con terceros.</li>
        <li>Si la propiedad está en un barrio cerrado, vas a ver antes de aceptar los requisitos de ingreso (seguros, cláusula de no repetición, documentación de la persona y del vehículo, horarios). Al aceptar, declarás que los cumplís. Si no podés cumplirlos, no aceptes el pedido.</li>
      </ul>

      <h2>6. Comunicación dentro de la Plataforma</h2>
      <p>
        La coordinación, los mensajes y los pagos de los Trabajos originados en {L.brand} tienen que hacerse dentro de la Plataforma. No pidas ni compartas teléfonos, correos, redes ni datos bancarios
        para contratar o cobrar por fuera. Desviar un Trabajo es un incumplimiento grave (sección 11).
      </p>

      <h2>7. Calidad y conducta</h2>
      <ul>
        <li>Trabajá con idoneidad, respetando las normas técnicas y de seguridad aplicables y las reglas del lugar.</li>
        <li>Cumplí los horarios acordados y avisá por la Plataforma cualquier demora o cambio.</li>
        <li>Tratá con respeto al Cliente y a quienes estén en la propiedad.</li>
        <li>Respondés por los daños que causes al prestar el servicio. Te recomendamos contar con seguro de responsabilidad civil y de accidentes personales; algunos barrios lo exigen.</li>
      </ul>

      <h2>8. Sin comisión</h2>
      <p>
        <strong>{L.brand} no te cobra comisión</strong> por los Trabajos realizados a través de la Plataforma, ni cargo de alta ni abono. {L.brand} se sostiene con un cargo de servicio que paga el Cliente
        en forma separada. Si en el futuro {L.brand} quisiera cobrarte algún cargo, te lo informará con al menos treinta (30) días de anticipación y no se aplicará a Trabajos ya contratados.
      </p>

      <h2>9. Cobros, saldo y retiros</h2>
      <ul>
        <li>Los Clientes pagan dentro de la Plataforma. {L.brand} recibe esos pagos por tu cuenta y orden y los acredita en tu saldo según estas reglas.</li>
        <li>El importe de cada Trabajo (tu Visita, tu Presupuesto y los adicionales aprobados, menos los reintegros que correspondan) pasa a tu <strong>saldo disponible</strong> cuando el Trabajo está completado, el Cliente dejó su reseña y no hay reclamos abiertos.</li>
        <li>Podés pedir <strong>un retiro por mes calendario</strong> de todo tu saldo disponible. {L.brand} lo transfiere dentro de los <strong>{L.withdrawalDays} días corridos</strong> desde el pedido, a la cuenta bancaria o virtual que indiques.</li>
        <li>La cuenta de destino tiene que estar a tu nombre o al de tu empresa. Podemos rechazar un retiro si los datos son incorrectos o no coinciden con el titular; en ese caso el saldo vuelve a estar disponible y podés volver a pedirlo ese mismo mes.</li>
        <li>Si se abre un reclamo, el importe del Trabajo queda retenido hasta su resolución. {L.brand} puede descontar de tu saldo los reintegros que correspondan por reclamos resueltos, contracargos o cobros indebidos vinculados a tus Trabajos.</li>
        <li>Tenés que emitir al Cliente el comprobante fiscal que corresponda por tu servicio.</li>
        <li>Mientras la Plataforma indique “Modo de prueba”, los cobros y retiros son simulados y no se mueve dinero real.</li>
      </ul>

      <h2>10. Reseñas y Espíritu Fixy</h2>
      <ul>
        <li>Las reseñas se publican de forma anónima y con demora variable para que los Clientes opinen con libertad. No podés pedir, ofrecer beneficios ni presionar para obtener reseñas, ni intentar identificar a quién escribió cada una.</li>
        <li>Podés responder públicamente a una reseña y, si la considerás injusta, impugnarla. {L.brand} puede contactar al Cliente, con ayuda de inteligencia artificial, y si no se resuelve, la revisa una persona del equipo.</li>
        <li>Ante un reclamo procedente, te vamos a pedir que corrijas el trabajo sin costo adicional. Si {L.brand} reintegra al Cliente por el <Link href="/terminos#espiritu-fixy">Espíritu Fixy</Link> por un incumplimiento tuyo, puede recuperar ese monto de tu saldo.</li>
      </ul>

      <h2>11. Suspensión y baja</h2>
      <ul>
        <li>{L.brand} puede pausar, suspender o dar de baja tu perfil ante datos falsos, documentación vencida, reclamos reiterados, mala conducta, desvío de Trabajos fuera de la Plataforma o incumplimientos de estas Condiciones. Te informaremos el motivo y podrás dar tu descargo.</li>
        <li>Podés pausar la recepción de pedidos o pedir la baja en cualquier momento. Los Trabajos en curso tienen que terminarse o cancelarse según lo previsto, y el saldo pendiente se transfiere según la sección 9.</li>
      </ul>

      <h2>12. Contacto</h2>
      <p>Para consultas sobre estas Condiciones, tu perfil o tus cobros, escribinos por {legalContact()}.</p>
    </LegalDocument>
  );
}
