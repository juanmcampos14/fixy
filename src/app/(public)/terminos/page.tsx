import { LegalDraft } from "@/components/legal-draft";

export const metadata = { title: "Términos y condiciones (borrador)" };

export default function Terms() {
  return (
    <LegalDraft title="Términos y condiciones">
      <p>Versión 0.1-borrador. Fixy es una plataforma que conecta a personas y organizaciones que necesitan servicios de reparación, instalación y mantenimiento con profesionales independientes y empresas de servicios.</p>
      <h2>1. Rol de Fixy</h2>
      <p>Fixy facilita la publicación de pedidos, el envío y la comparación de presupuestos, la contratación, la coordinación, el pago a través de una pasarela, el seguimiento y la gestión de reclamos. Los trabajos los realizan los proveedores. [Pendiente: definir alcance de responsabilidad.]</p>
      <h2>2. Cuentas</h2>
      <ul><li>Una cuenta puede usarse para pedir y para ofrecer servicios.</li><li>Sos responsable de la veracidad de tus datos y de la seguridad de tu contraseña.</li></ul>
      <h2>3. Presupuestos y contratación</h2>
      <ul><li>Pedir presupuestos es gratis.</li><li>Antes de contratar ves el desglose completo y el total. El alcance y el precio aceptados quedan registrados y no se modifican unilateralmente.</li><li>Los adicionales requieren tu aceptación explícita.</li></ul>
      <h2>4. Pagos y cargos</h2>
      <ul><li>Los pagos se procesan mediante una pasarela de pagos. Fixy no almacena datos de tarjetas.</li><li>Fixy cobra un cargo de servicio al cliente y una comisión al proveedor, informados antes de confirmar.</li><li>Fixy no ofrece custodia de fondos. [Pendiente: condiciones definitivas según la pasarela.]</li></ul>
      <h2>5. Cancelaciones y reembolsos</h2>
      <p>Podés cancelar sin cargo antes de la confirmación del profesional. Después, la cancelación y cualquier reembolso se gestionan según el caso. [Pendiente: política definitiva.]</p>
      <h2>6. Reclamos</h2>
      <p>Podés abrir un reclamo desde el trabajo. El equipo revisa el caso con la información registrada en la plataforma. No hay devoluciones automáticas ni garantías adicionales a las que se indiquen expresamente.</p>
      <h2>7. Proveedores</h2>
      <p>Los proveedores deben brindar información verdadera, mantener vigentes las credenciales requeridas y coordinar y cobrar dentro de la plataforma. [Pendiente: condiciones específicas para proveedores.]</p>
      <h2>8. Contacto</h2>
      <p>[Pendiente: datos de la entidad responsable y canal de contacto.]</p>
    </LegalDraft>
  );
}
