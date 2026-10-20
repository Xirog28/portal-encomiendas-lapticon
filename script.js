"use strict";

// =====================================================
// CONFIGURACIÓN
// =====================================================

const BASE_URL = "https://lapticon-backend.onrender.com";

const FIREBASE_API_KEY =
    "AIzaSyAuh64b_I2OtC7KYuubCVx9plEe2pojp2M";

// Rutas candidatas. Cuando confirmes en /api-docs cuál es la correcta,
// deja solo esa en cada lista.
const RUTAS_CIUDADES = [
    "/api/ciudades/ciudades",
    "/api/ciudades",
    "/api/ciudad",
    "/ciudades"
];

const RUTAS_PAISES = [
    "/api/ciudades/paises",
    "/api/paises",
    "/api/pais",
    "/paises"
];

// Render (plan gratuito) puede tardar en despertar: damos hasta 60 s.
const TIMEOUT_MS = 60000;

let idToken = null;
let uid = null;

// =====================================================
// UTILIDADES
// =====================================================

function obtenerElemento(id) {
    const elemento = document.getElementById(id);

    if (!elemento) {
        console.error(`No se encontró el elemento HTML con id="${id}".`);
    }

    return elemento;
}

function esperar(ms) {
    return new Promise((resolver) => setTimeout(resolver, ms));
}

async function leerRespuesta(respuesta) {
    const texto = await respuesta.text();

    if (!texto) {
        return {};
    }

    try {
        return JSON.parse(texto);
    } catch {
        return { message: texto };
    }
}

function obtenerMensajeError(datos, mensajePredeterminado) {
    if (typeof datos === "string" && datos.trim()) {
        return datos;
    }

    const mensaje =
        datos?.message ||
        datos?.mensaje ||
        datos?.error?.message ||
        datos?.error;

    if (typeof mensaje === "string" && mensaje.trim()) {
        return mensaje;
    }

    return mensajePredeterminado;
}

/**
 * Realiza solicitudes al backend.
 *
 * Las rutas públicas se consultan sin Authorization.
 * Las rutas privadas se llaman con requiereToken: true.
 */
async function peticionAPI(ruta, opciones = {}) {
    const {
        requiereToken = false,
        ...configuracion
    } = opciones;

    const headers = {
        Accept: "application/json",
        ...(configuracion.headers || {})
    };

    if (requiereToken) {
        if (!idToken) {
            throw new Error(
                "Tu sesión no está activa. Inicia sesión nuevamente."
            );
        }

        headers.Authorization = `Bearer ${idToken}`;
    }

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIMEOUT_MS);

    let respuesta;

    try {
        respuesta = await fetch(`${BASE_URL}${ruta}`, {
            ...configuracion,
            headers,
            signal: controlador.signal
        });
    } catch (error) {
        console.error(`No se pudo conectar con ${ruta}:`, error);

        if (error.name === "AbortError") {
            throw new Error(
                `El servidor tardó más de ${TIMEOUT_MS / 1000} segundos en responder.`
            );
        }

        throw new Error(
            "No se pudo conectar con el servidor. " +
            "Comprueba tu conexión y revisa si el backend está disponible. " +
            "Si aparece un error CORS en la consola, debe revisarse " +
            "la configuración del backend."
        );
    } finally {
        clearTimeout(temporizador);
    }

    const datos = await leerRespuesta(respuesta);

    console.log(
        `[API] ${configuracion.method || "GET"} ${ruta}`,
        "HTTP:",
        respuesta.status,
        "Respuesta:",
        datos
    );

    if (!respuesta.ok) {
        throw new Error(
            `HTTP ${respuesta.status}: ` +
            obtenerMensajeError(
                datos,
                "El servidor respondió con un error."
            )
        );
    }

    return datos;
}

/**
 * Busca una lista en respuestas que pueden venir
 * directamente como arreglos o dentro de propiedades.
 */
function extraerLista(datos, claves = []) {
    if (Array.isArray(datos)) {
        return datos;
    }

    if (!datos || typeof datos !== "object") {
        return null;
    }

    for (const clave of claves) {
        if (Array.isArray(datos[clave])) {
            return datos[clave];
        }
    }

    for (const contenedor of ["data", "result", "response"]) {
        if (datos[contenedor] && typeof datos[contenedor] === "object") {
            const resultado = extraerLista(datos[contenedor], claves);

            if (resultado !== null) {
                return resultado;
            }
        }
    }

    // Último recurso: la primera propiedad que sea un arreglo.
    for (const valor of Object.values(datos)) {
        if (Array.isArray(valor)) {
            return valor;
        }
    }

    return null;
}

function obtenerNombreCiudad(ciudad) {
    if (typeof ciudad === "string" || typeof ciudad === "number") {
        return String(ciudad);
    }

    if (!ciudad || typeof ciudad !== "object") {
        return null;
    }

    return ciudad.nombre ??
        ciudad.nombreCiudad ??
        ciudad.nombre_ciudad ??
        ciudad.ciudad ??
        ciudad.name ??
        ciudad.city ??
        ciudad.descripcion ??
        ciudad.label ??
        null;
}

function obtenerIdCiudad(ciudad) {
    if (typeof ciudad === "string" || typeof ciudad === "number") {
        return String(ciudad);
    }

    if (!ciudad || typeof ciudad !== "object") {
        return null;
    }

    return ciudad._id ??
        ciudad.id ??
        ciudad.idCiudad ??
        ciudad.id_ciudad ??
        ciudad.codigo ??
        ciudad.codigoCiudad ??
        ciudad.code ??
        ciudad.value ??
        // Si el backend no manda id, se usa el nombre como identificador.
        obtenerNombreCiudad(ciudad);
}

function mostrarMensajeTabla(mensaje) {
    const tbody = obtenerElemento("encomiendas-body");

    if (!tbody) return;

    tbody.innerHTML = "";

    const fila = document.createElement("tr");
    const celda = document.createElement("td");

    celda.colSpan = 5;
    celda.textContent = mensaje;

    fila.appendChild(celda);
    tbody.appendChild(fila);
}

/**
 * Prueba cada ruta de la lista hasta encontrar una que
 * devuelva una lista con elementos.
 */
async function pedirPrimeraRutaValida(rutas, claves, opciones = {}) {
    const fallos = [];

    for (const ruta of rutas) {
        try {
            const datos = await peticionAPI(ruta, opciones);
            const lista = extraerLista(datos, claves);

            if (lista && lista.length > 0) {
                console.log(`Ruta válida: ${ruta}. Ejemplo:`, lista[0]);
                return { ruta, lista };
            }

            fallos.push(`${ruta}: respuesta sin lista utilizable`);
        } catch (error) {
            fallos.push(`${ruta}: ${error.message}`);
        }
    }

    throw new Error("Ninguna ruta funcionó → " + fallos.join(" | "));
}

// =====================================================
// BLOQUE 1: INICIAR SESIÓN CON FIREBASE
// =====================================================

const loginForm = obtenerElemento("login-form");

if (loginForm) {
    loginForm.addEventListener("submit", async (evento) => {
        evento.preventDefault();

        const email = obtenerElemento("login-email")?.value.trim();
        const password = obtenerElemento("login-password")?.value;
        const status = obtenerElemento("login-status");
        const boton = loginForm.querySelector('button[type="submit"]');

        if (!email || !password) {
            if (status) {
                status.textContent =
                    "Escribe tu correo y contraseña.";
            }

            return;
        }

        if (boton) boton.disabled = true;

        if (status) status.textContent = "Iniciando sesión...";

        try {
            const respuesta = await fetch(
                "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword" +
                `?key=${FIREBASE_API_KEY}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        email,
                        password,
                        returnSecureToken: true
                    })
                }
            );

            const datos = await leerRespuesta(respuesta);

            if (!respuesta.ok) {
                const codigo = datos.error?.message;

                const erroresFirebase = {
                    EMAIL_NOT_FOUND: "El correo no está registrado.",
                    INVALID_PASSWORD: "La contraseña es incorrecta.",
                    INVALID_LOGIN_CREDENTIALS:
                        "El correo o la contraseña son incorrectos.",
                    USER_DISABLED: "Esta cuenta está deshabilitada.",
                    TOO_MANY_ATTEMPTS_TRY_LATER:
                        "Demasiados intentos. Intenta más tarde."
                };

                throw new Error(
                    erroresFirebase[codigo] ||
                    codigo ||
                    `Error de inicio de sesión: HTTP ${respuesta.status}`
                );
            }

            if (!datos.idToken || !datos.localId) {
                throw new Error(
                    "Firebase no devolvió los datos de sesión esperados."
                );
            }

            idToken = datos.idToken;
            uid = datos.localId;

            const mensajeBienvenida = obtenerElemento("welcome-message");
            const loginSection = obtenerElemento("login-section");
            const appSection = obtenerElemento("app-section");

            if (mensajeBienvenida) {
                mensajeBienvenida.textContent =
                    `¡Bienvenido al portal! Usuario: ${uid}`;
            }

            if (loginSection) loginSection.hidden = true;
            if (appSection) appSection.hidden = false;

            if (status) {
                status.textContent = "Sesión iniciada correctamente.";
            }

            console.log("Inicio de sesión exitoso.");
            console.log("UID recibido:", uid);

            // Se lanzan en paralelo: si las ciudades tardan (servidor
            // dormido), las encomiendas no se quedan esperando.
            // Cada función gestiona sus propios errores.
            await Promise.all([
                cargarCiudades(),
                cargarEncomiendas()
            ]);

        } catch (error) {
            console.error("Error al iniciar sesión:", error);

            if (status) {
                status.textContent =
                    "No se pudo iniciar sesión: " + error.message;
            }
        } finally {
            if (boton) boton.disabled = false;
        }
    });
}

// =====================================================
// BLOQUE 2: CARGAR PAÍSES Y CIUDADES
// =====================================================

async function cargarPaises() {
    // Los países son informativos: si fallan, no se bloquea nada.
    try {
        const { lista } = await pedirPrimeraRutaValida(
            RUTAS_PAISES,
            ["paises", "países", "data", "results", "resultados", "items"]
        );

        console.log(`Países cargados: ${lista.length}`);
        return lista;
    } catch (error) {
        console.warn("No se pudieron cargar los países:", error.message);
        return [];
    }
}

async function obtenerCiudades() {
    const claves = ["ciudades", "data", "results", "resultados", "items"];

    try {
        return await pedirPrimeraRutaValida(RUTAS_CIUDADES, claves);
    } catch (primerError) {
        // Reintento único: Render puede estar despertando.
        console.warn("Reintentando en 5 s...", primerError.message);
        await esperar(5000);
        return await pedirPrimeraRutaValida(RUTAS_CIUDADES, claves);
    }
}

async function cargarCiudades() {
    const origenSelect = obtenerElemento("origen-select");
    const destinoSelect = obtenerElemento("destino-select");
    const status = obtenerElemento("encomienda-status");

    if (!origenSelect || !destinoSelect) return;

    const textoCargando = '<option value="">Cargando ciudades...</option>';
    origenSelect.innerHTML = textoCargando;
    destinoSelect.innerHTML = textoCargando;

    if (status) {
        status.textContent =
            "Cargando ciudades (si el servidor estaba dormido puede tardar hasta 1 minuto)...";
    }

    try {
        const [paises, resultado] = await Promise.all([
            cargarPaises(),
            obtenerCiudades()
        ]);

        const ciudades = resultado.lista;

        const ciudadesValidas = ciudades
            .map((ciudad) => ({
                id: obtenerIdCiudad(ciudad),
                nombre: obtenerNombreCiudad(ciudad)
            }))
            .filter((ciudad) =>
                ciudad.id !== null &&
                ciudad.id !== undefined &&
                ciudad.nombre !== null &&
                ciudad.nombre !== undefined
            );

        if (ciudadesValidas.length === 0) {
            console.error(
                "No se reconocieron los campos de las ciudades:",
                ciudades[0]
            );

            throw new Error(
                "Se recibieron ciudades, pero no se reconocen sus campos. " +
                "Revisa en la consola el objeto de ejemplo."
            );
        }

        origenSelect.innerHTML =
            '<option value="">Selecciona la ciudad de origen</option>';

        destinoSelect.innerHTML =
            '<option value="">Selecciona la ciudad de destino</option>';

        ciudadesValidas.forEach((ciudad) => {
            for (const select of [origenSelect, destinoSelect]) {
                const opcion = document.createElement("option");
                opcion.value = String(ciudad.id);
                opcion.textContent = String(ciudad.nombre);
                select.appendChild(opcion);
            }
        });

        console.log(`Países cargados: ${paises.length}`);
        console.log(`Ciudades cargadas: ${ciudadesValidas.length}`);

        if (status) {
            status.textContent =
                `Se cargaron ${ciudadesValidas.length} ciudades.`;
        }

    } catch (error) {
        console.error("Error al cargar ciudades:", error);

        const textoError =
            '<option value="">No se pudieron cargar las ciudades</option>';

        origenSelect.innerHTML = textoError;
        destinoSelect.innerHTML = textoError;

        if (status) {
            status.textContent =
                "Error al cargar las ciudades: " + error.message;
        }
    }
}

// =====================================================
// BLOQUE 3: REGISTRAR UNA ENCOMIENDA
// =====================================================

const encomiendaForm = obtenerElemento("encomienda-form");

if (encomiendaForm) {
    encomiendaForm.addEventListener("submit", async (evento) => {
        evento.preventDefault();

        const status = obtenerElemento("encomienda-status");
        const boton = encomiendaForm.querySelector('button[type="submit"]');

        const ciudadOrigen =
            obtenerElemento("origen-select")?.value;

        const ciudadDestino =
            obtenerElemento("destino-select")?.value;

        const valorTexto =
            obtenerElemento("valor-input")?.value.trim();

        const moneda =
            obtenerElemento("moneda-select")?.value;

        const observaciones =
            obtenerElemento("observaciones-input")?.value.trim();

        if (!idToken) {
            if (status) {
                status.textContent =
                    "Debes iniciar sesión antes de registrar una encomienda.";
            }

            return;
        }

        if (!ciudadOrigen || !ciudadDestino) {
            if (status) {
                status.textContent =
                    "Selecciona las ciudades de origen y destino.";
            }

            return;
        }

        if (ciudadOrigen === ciudadDestino) {
            if (status) {
                status.textContent =
                    "El origen y el destino deben ser diferentes.";
            }

            return;
        }

        if (!valorTexto) {
            if (status) {
                status.textContent = "Ingresa el valor de la encomienda.";
            }

            return;
        }

        const valor = Number(valorTexto);

        if (!Number.isFinite(valor) || valor <= 0) {
            if (status) {
                status.textContent =
                    "El valor debe ser un número mayor que cero.";
            }

            return;
        }

        if (!moneda) {
            if (status) status.textContent = "Selecciona una moneda.";
            return;
        }

        // El campo de observaciones puede ser opcional.
        const encomienda = {
            ciudadOrigen,
            ciudadDestino,
            valor,
            moneda,
            observaciones: observaciones || ""
        };

        if (boton) boton.disabled = true;

        if (status) status.textContent = "Registrando encomienda...";

        try {
            const datos = await peticionAPI("/api/encomiendas", {
                requiereToken: true,
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(encomienda)
            });

            console.log("Encomienda registrada:", datos);

            if (status) {
                status.textContent =
                    obtenerMensajeError(
                        datos,
                        "Encomienda registrada correctamente."
                    );
            }

            encomiendaForm.reset();

            // Actualiza la tabla sin recargar la página.
            await cargarEncomiendas();

        } catch (error) {
            console.error("Error al registrar encomienda:", error);

            if (status) {
                status.textContent =
                    "No se pudo registrar la encomienda: " + error.message;
            }
        } finally {
            if (boton) boton.disabled = false;
        }
    });
}

// =====================================================
// BLOQUE 4: CONSULTAR Y MOSTRAR MIS ENCOMIENDAS
// =====================================================

async function cargarEncomiendas() {
    if (!idToken) {
        mostrarMensajeTabla(
            "Inicia sesión para consultar tus encomiendas."
        );

        return;
    }

    mostrarMensajeTabla("Cargando encomiendas...");

    try {
        const datos = await peticionAPI("/api/encomiendas", {
            requiereToken: true
        });

        console.log("Mis encomiendas:", datos);

        const lista = extraerLista(
            datos,
            ["encomiendas", "data", "results", "resultados"]
        );

        if (!lista) {
            throw new Error(
                "La respuesta no contiene una lista reconocible de encomiendas."
            );
        }

        const tbody = obtenerElemento("encomiendas-body");

        if (!tbody) return;

        tbody.innerHTML = "";

        if (lista.length === 0) {
            mostrarMensajeTabla(
                "Todavía no tienes encomiendas registradas."
            );

            return;
        }

        lista.forEach((encomienda) => {
            const fila = document.createElement("tr");

            const origen =
                obtenerNombreCiudad(encomienda.ciudadOrigen) ??
                encomienda.origen ??
                "No disponible";

            const destino =
                obtenerNombreCiudad(encomienda.ciudadDestino) ??
                encomienda.destino ??
                "No disponible";

            const estado = String(
                encomienda.estado ?? "Sin estado"
            );

            const valor = encomienda.valor ?? "No disponible";
            const moneda = encomienda.moneda ?? "";

            // Crear las celdas de la tabla de forma segura.
            [origen, destino, estado, `${valor} ${moneda}`.trim()].forEach((dato) => {
                const celda = document.createElement("td");

                celda.textContent =
                    typeof dato === "object"
                        ? JSON.stringify(dato)
                        : String(dato);

                fila.appendChild(celda);
            });

            const celdaAcciones = document.createElement("td");

            const idEncomienda =
                encomienda._id ??
                encomienda.id ??
                encomienda.idEncomienda;

            if (
                idEncomienda &&
                estado.toLowerCase() !== "cancelada"
            ) {
                const botonCancelar = document.createElement("button");

                botonCancelar.type = "button";
                botonCancelar.textContent = "Cancelar";

                botonCancelar.addEventListener("click", () => {
                    cancelarEncomienda(idEncomienda);
                });

                celdaAcciones.appendChild(botonCancelar);
            } else {
                celdaAcciones.textContent = "—";
            }

            fila.appendChild(celdaAcciones);
            tbody.appendChild(fila);
        });

        console.log(`Encomiendas mostradas: ${lista.length}`);

    } catch (error) {
        console.error("Error al cargar encomiendas:", error);

        mostrarMensajeTabla(
            "No se pudieron cargar las encomiendas: " + error.message
        );
    }
}

// =====================================================
// BLOQUE 5: CANCELAR UNA ENCOMIENDA
// =====================================================

async function cancelarEncomienda(encomiendaId) {
    if (!idToken) {
        alert("Debes iniciar sesión primero.");
        return;
    }

    const confirmar = confirm(
        "¿Deseas cancelar esta encomienda?"
    );

    if (!confirmar) return;

    try {
        const datos = await peticionAPI(
            `/api/encomiendas/${encodeURIComponent(encomiendaId)}/estado`,
            {
                requiereToken: true,
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    estado: "cancelada"
                })
            }
        );

        console.log("Respuesta al cancelar:", datos);

        alert(
            obtenerMensajeError(
                datos,
                "Encomienda cancelada correctamente."
            )
        );

        await cargarEncomiendas();

    } catch (error) {
        console.error("Error al cancelar encomienda:", error);

        alert(
            "No se pudo cancelar la encomienda: " + error.message
        );
    }
}

console.log("script.js cargado correctamente.");