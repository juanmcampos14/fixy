import Link from "next/link";
import { LegalDocument } from "@/components/legal-document";
import { LEGAL, legalContact } from "@/lib/legal";

export const metadata = { title: "Política de privacidad" };

export default function Privacy() {
  const L = LEGAL;
  return (
    <LegalDocument title="Política de privacidad">
      <p>
        Esta Política explica cómo {L.company} (CUIT {L.cuit}{L.address ? `, domicilio ${L.address}` : ""}), titular de {L.brand}, trata los datos personales de quienes usan la Plataforma,
        conforme a la Ley 25.326 de Protección de Datos Personales y sus normas complementarias. {L.company} es la responsable del tratamiento.
      </p>

      <h2>1. Qué datos tratamos</h2>
      <ul>
        <li><strong>Cuenta:</strong> nombre, correo, teléfono y contraseña (guardada de forma irreversible, nunca en texto legible).</li>
        <li><strong>Propiedades:</strong> dirección, piso o departamento, coordenadas y dirección normalizada (si usás el autocompletado o “Usar mi ubicación”), datos de contacto en el lugar, indicaciones de acceso y, si es un barrio cerrado, su nombre y reglamento de ingreso.</li>
        <li><strong>Pedidos y trabajos:</strong> descripción del problema, fotos, mensajes, presupuestos, evidencias, reclamos y reseñas.</li>
        <li><strong>Profesionales:</strong> datos del perfil, documento de identidad, matrículas y habilitaciones, CUIT, datos de facturación y datos bancarios para los retiros (titular, CUIT/CUIL, CBU/CVU o alias).</li>
        <li><strong>Pagos:</strong> montos, estados y referencias del proveedor de pagos. No guardamos los datos completos de tarjetas.</li>
        <li><strong>Uso técnico:</strong> registros de actividad y seguridad (por ejemplo, dirección IP y acciones relevantes) y cookies estrictamente necesarias para mantener tu sesión.</li>
        <li><strong>Ubicación del dispositivo:</strong> solo si tocás “Usar mi ubicación” y lo autorizás en tu navegador; se usa en ese momento para completar la dirección.</li>
      </ul>

      <h2>2. Para qué los usamos</h2>
      <ul>
        <li>Crear y administrar tu cuenta y verificar la identidad y credenciales de los Profesionales.</li>
        <li>Mostrarte Profesionales de tu zona, coordinar Visitas y Trabajos, procesar pagos y retiros.</li>
        <li>Gestionar reclamos, reseñas, el Espíritu Fixy y prevenir fraudes y usos indebidos.</li>
        <li>Enviarte avisos sobre tus pedidos y trabajos.</li>
        <li>Mejorar la Plataforma con información agregada.</li>
        <li>Cumplir obligaciones legales, contables y fiscales.</li>
      </ul>
      <p>La base legal es tu consentimiento al registrarte, la ejecución del servicio que solicitás y el cumplimiento de obligaciones legales.</p>

      <h2>3. Tu dirección está protegida</h2>
      <p>
        Tu dirección y tus datos de acceso <strong>los ve y los protege solo {L.brand}</strong>. Los Profesionales no los ven al postularse ni al presupuestar: solo ven la zona. Se los compartimos únicamente
        al Profesional elegido cuando se confirma la Visita o el Trabajo, y solo para prestar ese servicio. En barrios cerrados, los Profesionales invitados ven los requisitos de ingreso, pero no el nombre del barrio ni la dirección.
      </p>

      <h2>4. Con quién compartimos datos</h2>
      <ul>
        <li><strong>Entre Usuarios:</strong> el Cliente ve el perfil público del Profesional; el Profesional elegido recibe los datos necesarios del Trabajo. Las reseñas se publican sin identificar a quien las escribió.</li>
        <li><strong>Proveedores que nos prestan servicios</strong>, bajo obligaciones de confidencialidad y solo para estos fines:
          <ul>
            <li>Alojamiento del sitio (Vercel Inc.) y base de datos y almacenamiento de archivos (Supabase Inc.), con servidores en Estados Unidos.</li>
            <li>Google: Google Maps Platform, para autocompletar direcciones y convertir tu ubicación en una dirección; e inicio de sesión con Google, si lo elegís (recibimos tu nombre, tu email y un identificador de tu cuenta de Google, nunca tu contraseña).</li>
            <li>Anthropic PBC (inteligencia artificial), para sugerir el tipo de profesional, interpretar reglamentos de barrios, ayudar a armar perfiles y mediar en impugnaciones de reseñas. Antes de enviar texto eliminamos correos y teléfonos cuando es posible. Estos datos no se usan para entrenar sus modelos según sus condiciones comerciales.</li>
            <li>Proveedores de pagos y de envío de correos.</li>
          </ul>
        </li>
        <li><strong>Autoridades</strong>, cuando una ley o una orden judicial lo exija.</li>
      </ul>
      <p>No vendemos tus datos personales.</p>

      <h2>5. Transferencias internacionales</h2>
      <p>
        Algunos de los proveedores mencionados procesan datos fuera de la Argentina, principalmente en Estados Unidos. Al usar la Plataforma prestás tu consentimiento para esas transferencias, que realizamos
        con proveedores que aplican medidas de seguridad y confidencialidad adecuadas.
      </p>

      <h2>6. Cuánto tiempo los guardamos</h2>
      <p>
        Mientras tu cuenta esté activa y, después, por el tiempo necesario para resolver reclamos y cumplir obligaciones legales (por ejemplo, los registros contables y de pagos se conservan por los plazos que fija la ley).
        Los registros financieros y de auditoría no se borran: se corrigen con nuevos asientos.
      </p>

      <h2>7. Seguridad</h2>
      <ul>
        <li>Conexiones cifradas, contraseñas guardadas de forma irreversible y archivos privados con enlaces temporales.</li>
        <li>Permisos de acceso controlados en el servidor y en la base de datos: cada persona ve solo lo que necesita.</li>
        <li>Las acciones sensibles quedan registradas. Los datos bancarios no se incluyen en esos registros.</li>
      </ul>

      <h2>8. Tus derechos</h2>
      <p>
        Podés solicitar el acceso, la rectificación, la actualización o la supresión de tus datos, y retirar tu consentimiento, por {legalContact()}. El derecho de acceso puede ejercerse en forma gratuita
        a intervalos no inferiores a seis meses, salvo interés legítimo (art. 14, inc. 3, Ley 25.326). Responderemos en los plazos legales: diez (10) días corridos para el acceso y cinco (5) días hábiles
        para la rectificación, actualización o supresión. Algunos datos pueden conservarse si una ley lo exige o si son necesarios para un Trabajo o reclamo en curso.
      </p>
      <p>
        La AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA, en su carácter de Órgano de Control de la Ley N° 25.326, tiene la atribución de atender las denuncias y reclamos que interpongan quienes resulten
        afectados en sus derechos por incumplimiento de las normas vigentes en materia de protección de datos personales.
      </p>

      <h2>9. Menores</h2>
      <p>La Plataforma no está dirigida a menores de 18 años y no recopilamos sus datos de manera intencional.</p>

      <h2>10. Cambios</h2>
      <p>Si modificamos esta Política, te avisaremos por la Plataforma o por correo antes de que los cambios entren en vigencia.</p>

      <h2>11. Contacto</h2>
      <p>{L.company} · CUIT {L.cuit}. Consultas sobre privacidad: {legalContact()}. Ver también los <Link href="/terminos">Términos y condiciones</Link>.</p>
    </LegalDocument>
  );
}
