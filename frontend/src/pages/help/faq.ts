/**
 * Preguntas frecuentes del Centro de ayuda. Solo texto: para cambiar una respuesta no hace falta
 * tocar la pantalla. Los nombres de botones y pantallas son los reales de la aplicación.
 */

export type FaqBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; items: string[] }
  | { kind: "list"; items: string[] };

export interface FaqItem {
  id: string;
  question: string;
  answer: FaqBlock[];
}

export interface FaqCategory {
  id: string;
  title: string;
  description: string;
  items: FaqItem[];
}

const text = (value: string): FaqBlock => ({ kind: "text", text: value });
const steps = (...items: string[]): FaqBlock => ({ kind: "steps", items });
const list = (...items: string[]): FaqBlock => ({ kind: "list", items });

export const FAQ: FaqCategory[] = [
  {
    id: "cuenta-y-acceso",
    title: "Cuenta y acceso",
    description: "Crear tu cuenta, entrar con tu token y cuidarlo.",
    items: [
      {
        id: "crear-cuenta",
        question: "¿Cómo creo una cuenta en HabiCapital?",
        answer: [
          steps(
            "En la pantalla de acceso, elige la pestaña «Crear cuenta».",
            "Escribe el nombre completo del titular y pulsa «Crear mi cuenta».",
            "Guarda el token de acceso que aparece (puedes usar el botón «Copiar»).",
            "Marca «Ya guardé mi token en un lugar seguro.» y pulsa «Continuar a mi panel».",
          ),
          list(
            "La cuenta empieza con $0 COP.",
            "Recibe un UUID único que la identifica.",
            "El token solo se muestra una vez, al crear la cuenta: HabiCapital no lo guarda en claro y no puede volver a enseñártelo.",
            "No podrás continuar hasta confirmar que lo guardaste.",
          ),
        ],
      },
      {
        id: "que-es-token",
        question: "¿Qué es un token de acceso y para qué sirve?",
        answer: [
          text(
            "El token es tu credencial secreta: funciona como una contraseña larga generada por HabiCapital. Quien lo tenga puede entrar a tu cuenta y mover su dinero simulado.",
          ),
          list(
            "No lo compartas con nadie.",
            "Guárdalo en un lugar seguro, por ejemplo un gestor de contraseñas.",
            "No es lo mismo que el UUID: el UUID identifica tu cuenta (como un número de cuenta) y el token permite entrar en ella.",
          ),
        ],
      },
      {
        id: "iniciar-sesion",
        question: "¿Cómo inicio sesión?",
        answer: [
          steps(
            "En la pantalla de acceso, elige la pestaña «Ya tengo cuenta».",
            "Pega tu token en el campo «Bearer token de acceso».",
            "Pulsa «Acceder a mi cuenta».",
            "Espera a que HabiCapital valide el token con el servidor: si es correcto, se abre Inicio.",
          ),
          text("Si el token no es válido, verás un aviso y no se guardará nada en el navegador."),
        ],
      },
      {
        id: "perdi-token",
        question: "¿Qué ocurre si pierdo mi token?",
        answer: [
          text("HabiCapital no tiene recuperación automática de acceso."),
          text("Si todavía tienes una sesión abierta en alguna pestaña, puedes generar uno nuevo:"),
          steps(
            "Entra en «Mi cuenta».",
            "Pulsa «Regenerar token» y confirma.",
            "Copia y guarda el nuevo token de inmediato: se muestra una sola vez.",
          ),
          list(
            "El token anterior deja de funcionar en ese momento.",
            "Si no conservas ni el token ni una sesión abierta, no es posible recuperar el acceso con las funciones actuales.",
          ),
        ],
      },
      {
        id: "cerrar-sesion",
        question: "¿Cómo cierro sesión de manera segura?",
        answer: [
          text(
            "Pulsa «Cerrar sesión»: en escritorio está en la parte inferior del menú lateral, junto a tu nombre; en el móvil, abre «Menú».",
          ),
          text(
            "Cerrar sesión borra el token de esta pestaña del navegador, junto con la información local de operaciones pendientes de esa cuenta. Cerrar la pestaña también lo borra.",
          ),
          text("Si usas un computador compartido, cierra sesión siempre al terminar."),
        ],
      },
    ],
  },
  {
    id: "saldo-y-transferencias",
    title: "Saldo y transferencias",
    description: "Recargar saldo simulado, enviar dinero y revisar tu historial.",
    items: [
      {
        id: "recargar",
        question: "¿Cómo recargo saldo simulado?",
        answer: [
          steps(
            "Entra en «Recargar saldo».",
            "Escribe el monto o elige uno de los montos sugeridos.",
            "Pulsa «Continuar».",
            "Revisa el monto, tu saldo actual y el saldo estimado después de la recarga.",
            "Pulsa «Confirmar recarga».",
            "Consulta tu nuevo saldo en Inicio.",
          ),
          list(
            "El monto debe ser un número entero de pesos colombianos entre $1 y $10.000.000.",
            "No se usa dinero real: la recarga es simulada.",
          ),
        ],
      },
      {
        id: "enviar",
        question: "¿Cómo envío dinero a otra cuenta?",
        answer: [
          steps(
            "Pide a la otra persona el UUID de su cuenta.",
            "Entra en «Enviar dinero».",
            "Pega el UUID (puedes usar el botón «Pegar»).",
            "Escribe el monto.",
            "Si quieres, agrega una descripción.",
            "Pulsa «Revisar transferencia» y comprueba los datos.",
            "Pulsa «Confirmar transferencia».",
            "Consulta el resultado en «Movimientos».",
          ),
          list(
            "Necesitas saldo suficiente; si no alcanza, la transferencia se rechaza y no se mueve dinero.",
            "No puedes transferirte dinero a tu propia cuenta.",
          ),
        ],
      },
      {
        id: "uuid",
        question: "¿Qué es el UUID y dónde puedo encontrarlo?",
        answer: [
          text(
            "El UUID es el identificador único de tu cuenta, un código de 36 caracteres. Lo encuentras en «Mi cuenta», donde puedes copiarlo con su botón.",
          ),
          list(
            "Compartir tu UUID permite que otras personas te envíen dinero o te pidan dinero.",
            "Nunca compartas tu token de acceso.",
          ),
        ],
      },
      {
        id: "movimientos",
        question: "¿Cómo consulto mis movimientos?",
        answer: [
          text("En «Movimientos» ves el historial de tu cuenta:"),
          list(
            "Recargas.",
            "Transferencias enviadas y recibidas.",
            "Fecha y hora, monto y contraparte de cada una.",
            "El detalle de cada movimiento, incluido el saldo después de la operación.",
          ),
          text(
            "Puedes ordenar por más recientes o más antiguos, elegir cuántos movimientos ver por página, cambiar de página y pulsar «Actualizar historial» para ver lo último.",
          ),
        ],
      },
    ],
  },
  {
    id: "solicitudes",
    title: "Solicitudes de dinero",
    description: "Pedir dinero a otra cuenta y responder las solicitudes que recibes.",
    items: [
      {
        id: "que-son-solicitudes",
        question: "¿Qué son las solicitudes de dinero?",
        answer: [
          text(
            "Te permiten pedir dinero simulado a otra cuenta de HabiCapital sin hacer una transferencia en ese momento. Por ejemplo: pagaste una cena compartida y le pides $20.000 a un amigo.",
          ),
          text(
            "Crear una solicitud no descuenta ni acredita dinero. El dinero solo se mueve si la otra persona la acepta.",
          ),
        ],
      },
      {
        id: "crear-solicitud",
        question: "¿Cómo creo una solicitud de dinero?",
        answer: [
          steps(
            "Entra en «Solicitudes» desde el menú.",
            "Pulsa «Nueva solicitud».",
            "Escribe o pega el UUID de quien debe pagar.",
            "Escribe el monto.",
            "Si quieres, agrega un concepto.",
            "Pulsa «Revisar solicitud» y comprueba los datos.",
            "Pulsa «Confirmar solicitud».",
          ),
          text(
            "La solicitud queda pendiente hasta que el pagador la acepte o la rechace, o hasta que tú la canceles. La encuentras en la pestaña «Enviadas».",
          ),
        ],
      },
      {
        id: "aceptar-rechazar",
        question: "¿Cómo acepto o rechazo una solicitud?",
        answer: [
          text(
            "Las solicitudes pendientes que recibes aparecen en la pestaña «Recibidas» (y el menú muestra cuántas tienes).",
          ),
          text("Para aceptarla, pulsa «Aceptar y transferir»:"),
          list(
            "Verás tu saldo actual y el saldo estimado después de pagar.",
            "Al pulsar «Confirmar pago», el servidor comprueba tu saldo y transfiere el dinero simulado a quien la pidió.",
            "La solicitud pasa a «Aceptada». Si no tienes saldo suficiente, no se mueve dinero y sigue pendiente.",
          ),
          text("Para rechazarla, pulsa «Rechazar» y confirma con «Sí, rechazar»:"),
          list("No se transfiere dinero.", "La solicitud pasa a «Rechazada»."),
        ],
      },
      {
        id: "cancelar-solicitud",
        question: "¿Cómo cancelo una solicitud?",
        answer: [
          text(
            "Quien creó la solicitud puede cancelarla mientras siga pendiente: en la pestaña «Enviadas», pulsa «Cancelar solicitud» y confirma con «Sí, cancelar solicitud». No se mueve dinero.",
          ),
          text("Una solicitud aceptada, rechazada o cancelada ya no puede modificarse."),
        ],
      },
    ],
  },
  {
    id: "seguridad",
    title: "Seguridad y preguntas generales",
    description: "Operaciones sin confirmar, dinero simulado y por qué usamos tokens.",
    items: [
      {
        id: "operacion-pendiente",
        question: "¿Qué hago si una transferencia o recarga queda pendiente?",
        answer: [
          text(
            "Si falla la conexión justo después de confirmar, la operación pudo haberse realizado aunque tu navegador no recibiera la respuesta. HabiCapital te lo indica con un aviso del tipo «No sabemos si … se realizó».",
          ),
          text(
            "Mientras la información siga guardada en esta pestaña, puedes pulsar «Reintentar con la misma clave»: se reenvía exactamente la misma operación con su clave de idempotencia y, si ya se había hecho, el servidor lo confirma sin cobrarla dos veces.",
          ),
          list(
            "No inicies otra operación igual con una clave nueva sin comprobar antes qué pasó (por ejemplo, en «Movimientos»).",
            "«Dejar de intentar recuperar» solo borra la información de este navegador: no cancela ni revierte nada en el servidor.",
            "Si cierras la pestaña o cierras sesión, esa información local se pierde.",
          ),
        ],
      },
      {
        id: "dinero-real",
        question: "¿HabiCapital utiliza dinero real?",
        answer: [
          text(
            "No. HabiCapital es un proyecto de demostración que usa dinero simulado en pesos colombianos. Las recargas, transferencias y solicitudes funcionan dentro del sistema, sin conectar bancos ni pasarelas de pago reales.",
          ),
        ],
      },
      {
        id: "tokens-contrasenas",
        question: "¿Por qué HabiCapital utiliza tokens en lugar de contraseñas?",
        answer: [
          text(
            "Para el alcance del reto se eligió un mecanismo de acceso mediante tokens: cada cuenta recibe un token aleatorio y el servidor solo guarda una huella (hash) de él, nunca el token en claro.",
          ),
          text(
            "Es una solución simplificada para la demostración. No equivale a un sistema completo de autenticación bancaria: no hay contraseñas, verificación de identidad ni recuperación de cuenta.",
          ),
        ],
      },
    ],
  },
];
