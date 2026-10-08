import { LegalDraft } from "@/components/legal-draft";

export const metadata = { title: "Política de privacidad (borrador)" };

export default function Privacy() {
  return (
    <LegalDraft title="Política de privacidad">
      <p>Versión 0.1-borrador. Describe qué datos trata Fixy y para qué. [Pendiente: revisión según la Ley 25.326 de Protección de Datos Personales y normativa aplicable; identificación del responsable del tratamiento.]</p>
      <h2>Datos que tratamos</h2>
      <ul><li>Cuenta: nombre, email, teléfono, contraseña (guardada de forma irreversible).</li><li>Pedidos: descripción, fotos, propiedad, dirección e indicaciones de acceso.</li><li>Proveedores: perfil, documentación de identidad y credenciales (privada), datos de facturación.</li><li>Pagos: referencias de la pasarela y montos. No almacenamos datos de tarjetas.</li><li>Mensajes, evidencias, reclamos y reseñas.</li></ul>
      <h2>Minimización y acceso</h2>
      <ul><li>Antes de contratar, el profesional solo ve la zona y la información necesaria para cotizar.</li><li>La dirección exacta y los datos de acceso se comparten con el profesional contratado cuando el pago está aprobado.</li><li>Los documentos de proveedores son privados: solo los ve el proveedor y el equipo de revisión.</li><li>El acceso a los datos está limitado por permisos en el servidor y en la base de datos, y las acciones sensibles quedan auditadas.</li></ul>
      <h2>Proveedores de servicios</h2>
      <p>Usamos proveedores de infraestructura (base de datos y almacenamiento), de envío de emails y una pasarela de pagos. Opcionalmente, un servicio de IA para clasificar pedidos, al que enviamos el texto del problema sin emails ni teléfonos. [Pendiente: listado definitivo y transferencias internacionales.]</p>
      <h2>Tus derechos</h2>
      <p>Podés solicitar acceso, rectificación y supresión de tus datos. [Pendiente: canal y plazos.]</p>
    </LegalDraft>
  );
}
