// --- 1. ESTADO GLOBAL DE LA APLICACIÓN ---
let transacciones = []; // Se cargará del servidor
let gastoEnCuotas = []; // Se cargará del servidor
let tarjetasConfig = {}; // Se cargará del servidor

// --- 2. REFERENCIAS AL DOM Y GRÁFICAS ---
const formTransaccion = document.getElementById('formulario-transaccion');
const formTarjeta = document.getElementById('formulario-tarjeta');
const listaTransacciones = document.getElementById('lista-transacciones');
const listaCuotas = document.getElementById('lista-cuotas');
const totalIngresosEl = document.getElementById('total-ingresos');
const totalGastoCuotasEl = document.getElementById('total-gasto-cuotas'); 
const tarjetasResumenEl = document.getElementById('tarjetas-resumen');
const btnMostrarConfig = document.getElementById('btn-mostrar-config');
const configArea = document.getElementById('config-area');
const tarjetasExistentesConfigEl = document.getElementById('tarjetas-existentes-config');
const cuentaTipoSelect = document.getElementById('cuenta-tipo');
const graficosDonaContenedor = document.getElementById('graficos-dona-contenedor');

const btnMostrarRegistro = document.getElementById('btn-mostrar-registro');
const registroArea = document.getElementById('registro-area');

const graficoPagosMensualesEl = document.getElementById('graficoPagosMensuales'); 

let miGraficoPagos; 
let graficosDona = {}; 


// --- 3. FUNCIONES DE COMUNICACIÓN CON LA API (FETCH) ---

async function fetchAPI(url, method = 'GET', data = null) {
    try {
        const options = {
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };
        if (data) {
            options.body = JSON.stringify(data);
        }
        
        const response = await fetch(url, options);

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Error HTTP: ${response.status}`);
        }
        
        // Manejar el caso de respuesta vacía (ej. DELETE exitoso)
        if (response.status === 204 || response.headers.get('content-length') === '0') {
            return { message: 'Operación exitosa (sin contenido de respuesta).' };
        }
        
        return response.json();

    } catch (error) {
        console.error('Error en fetchAPI:', error.message);
        throw error; 
    }
}

// --- 4. FUNCIONES DE CARGA Y RENDERIZADO ---

// Se actualizan las tarjetasConfig y se carga el select del formulario
function renderizarOpcionesTarjeta() {
    cuentaTipoSelect.innerHTML = '<option value="debito">Efectivo / Débito</option>';

    Object.keys(tarjetasConfig).forEach(tarjetaId => {
        const config = tarjetasConfig[tarjetaId];
        const option = document.createElement('option');
        option.value = `credito-${tarjetaId}`;
        option.textContent = config.nombre;
        cuentaTipoSelect.appendChild(option);
    });
}

function renderizarTarjetasConfig() {
    tarjetasExistentesConfigEl.innerHTML = '';

    Object.keys(tarjetasConfig).forEach(tarjetaId => {
        const config = tarjetasConfig[tarjetaId];
        
        const item = document.createElement('div');
        item.classList.add('tarjeta-config-item');
        item.style.backgroundColor = `${config.color}30`;
        item.style.borderLeft = `5px solid ${config.color}`;
        item.innerHTML = `
            <span>${config.nombre} (${tarjetaId})</span>
            <button class="eliminar-tarjeta" data-id="${tarjetaId}">&times;</button>
        `;
        tarjetasExistentesConfigEl.appendChild(item);
    });
    
    document.querySelectorAll('.eliminar-tarjeta').forEach(button => {
        button.addEventListener('click', eliminarTarjeta);
    });
}

async function eliminarTarjeta(e) {
    const tarjetaId = e.target.dataset.id;
    
    if (confirm(`¿Seguro de que quieres eliminar la tarjeta ${tarjetaId}? Se eliminarán TODAS las cuotas pendientes asociadas a ella.`)) {
        try {
            await fetchAPI(`/api/tarjetas/${tarjetaId}`, 'DELETE');
            alert(`Tarjeta ${tarjetaId} eliminada.`);
            await actualizarTodo(); // Recarga todos los datos
            configurarVisibilidadInicial(); // Vuelve a verificar la visibilidad después de la eliminación
        } catch (error) {
            alert(`Error al eliminar la tarjeta: ${error.message}`);
        }
    }
}

function actualizarDashboard() {
    const ingresos = transacciones
        .filter(t => t.tipo === 'ingreso')
        .reduce((sum, t) => sum + t.valor, 0);
    totalIngresosEl.textContent = `$${ingresos.toFixed(2)}`;
    
    const totalGastoPendienteGeneral = gastoEnCuotas.reduce((sum, item) => sum + item.valorPendiente, 0);
    totalGastoCuotasEl.textContent = `$${totalGastoPendienteGeneral.toFixed(2)}`;
}

function actualizarDashboardTarjeta() {
    tarjetasResumenEl.innerHTML = '';
    graficosDonaContenedor.innerHTML = '';
    
    Object.keys(tarjetasConfig).forEach(tarjetaId => {
        const config = tarjetasConfig[tarjetaId];
        
        const gastoPendiente = gastoEnCuotas
            .filter(c => c.tarjetaId === tarjetaId)
            .reduce((sum, item) => sum + item.valorPendiente, 0);

        const limite = config.limite;
        const saldoDisponibleLimite = limite - gastoPendiente;

        // A. Resumen
        const divResumen = document.createElement('div');
        divResumen.classList.add('indicador-tarjeta-resumen');
        divResumen.style.borderLeft = `5px solid ${config.color}`; 
        divResumen.style.backgroundColor = `${config.color}30`; 
        
        const colorClase = saldoDisponibleLimite >= 0 ? 'positivo-limite' : 'negativo-limite';

        divResumen.innerHTML = `
            <h4>${config.nombre} (${tarjetaId})</h4>
            <p>Límite Usado: <strong>$${gastoPendiente.toFixed(2)}</strong> de $${limite.toFixed(2)}</p>
            <p>Disponible: <strong class="${colorClase}">$${saldoDisponibleLimite.toFixed(2)}</strong></p>
            <p>Corte: Día ${config.corte} | Pago: Día ${config.pago}</p>
        `;
        tarjetasResumenEl.appendChild(divResumen);

        // B. Contenedor de Gráfico de Dona
        const divGrafico = document.createElement('div');
        divGrafico.classList.add('grafica-contenedor');
        divGrafico.innerHTML = `<h4 style="color: ${config.color}; margin-top:0;">${config.nombre} (${tarjetaId})</h4><canvas id="graficoDona-${tarjetaId}"></canvas>`;
        graficosDonaContenedor.appendChild(divGrafico);
        
        // C. Dibujar el gráfico de dona
        const canvasEl = document.getElementById(`graficoDona-${tarjetaId}`);
        dibujarGraficoDona(tarjetaId, canvasEl);
    });
    
    dibujarGraficoPagosMensuales();
    renderizarOpcionesTarjeta(); 
    renderizarTarjetasConfig();  
}

function mostrarTransacciones() {
    listaTransacciones.innerHTML = '';
    listaCuotas.innerHTML = ''; 

    // Muestra Transacciones (Débito/Ingreso)
    transacciones.forEach(t => { 
        const li = document.createElement('li');
        li.classList.add(`transaccion-${t.tipo}`);
        const signo = t.tipo === 'ingreso' ? '+' : '-';
        
        li.innerHTML = `
            <span class="descripcion">${t.descripcion} (${t.categoria})</span>
            <span class="valor">${signo}$${t.valor.toFixed(2)}</span>
            <button class="eliminar" data-id="${t.id}" data-type="transaccion">&times;</button>
        `;
        listaTransacciones.appendChild(li);
    });

    // Muestra Cuotas Pendientes de Tarjeta
    gastoEnCuotas.forEach(t => {
        const li = document.createElement('li');
        li.classList.add('cuota-item');
        
        const nombreTarjeta = tarjetasConfig[t.tarjetaId] ? tarjetasConfig[t.tarjetaId].nombre : t.tarjetaId;

        li.innerHTML = `
            <span class="descripcion">💳 ${nombreTarjeta} | ${t.descripcion}</span>
            <span class="cuota-info">Cuota ${t.cuotaActual}/${t.cuotasTotales} | Pago: ${t.fechaPagoProgramada}</span>
            <span class="valor-cuota">Valor: $${t.valorCuota.toFixed(2)}</span>
            <button class="eliminar" data-id="${t.id}" data-type="cuota">&times;</button>
        `;
        listaCuotas.appendChild(li);
    });
    
    document.querySelectorAll('.eliminar').forEach(button => {
        button.addEventListener('click', manejarEliminacion);
    });
}

async function manejarEliminacion(e) {
    const idAEliminar = parseInt(e.target.dataset.id);
    const tipoItem = e.target.dataset.type;
    let url = '';

    if (tipoItem === 'transaccion') {
        url = `/api/transaccion/${idAEliminar}`;
    } else if (tipoItem === 'cuota') {
        url = `/api/cuota/${idAEliminar}`;
    }

    try {
        await fetchAPI(url, 'DELETE');
        await actualizarTodo();
    } catch (error) {
        alert(`Error al eliminar: ${error.message}`);
    }
}

// --- 5. LÓGICA DE GRÁFICOS ---
function dibujarGraficoDona(tarjetaId, canvasEl) {
    const config = tarjetasConfig[tarjetaId];
    
    const gastoPendiente = gastoEnCuotas
        .filter(c => c.tarjetaId === tarjetaId)
        .reduce((sum, item) => sum + item.valorPendiente, 0);

    const limite = config.limite || 1;
    const usado = gastoPendiente;
    const disponible = Math.max(0, limite - usado);

    const datosGrafico = {
        labels: ['Límite Usado', 'Límite Disponible'],
        datasets: [{
            data: [usado.toFixed(2), disponible.toFixed(2)],
            backgroundColor: [
                config.color,           
                config.color + '40'     
            ],
            hoverOffset: 4
        }]
    };
    
    if (graficosDona[tarjetaId]) {
        graficosDona[tarjetaId].destroy();
    }
    
    graficosDona[tarjetaId] = new Chart(canvasEl, {
        type: 'doughnut',
        data: datosGrafico,
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom', labels: { color: '#343a40' } },
                title: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            const valor = context.parsed;
                            return `${label}: $${valor.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Dibuja el gráfico de línea de Pagos Mensuales. 
 * Se modificó para eliminar las líneas de cuadrícula (grid: { display: false }).
 */
function dibujarGraficoPagosMensuales() {
    const pagosPorMesYTarjeta = gastoEnCuotas.reduce((acc, cuota) => {
        const mes = cuota.fechaPagoProgramada;
        const tarjeta = cuota.tarjetaId;

        if (!acc[mes]) acc[mes] = {};
        acc[mes][tarjeta] = (acc[mes][tarjeta] || 0) + cuota.valorCuota;
        return acc;
    }, {});

    const todosLosMeses = Object.keys(pagosPorMesYTarjeta).sort();
    
    const datasets = Object.keys(tarjetasConfig).map(tarjetaId => {
        const config = tarjetasConfig[tarjetaId];
        
        const data = todosLosMeses.map(mes => pagosPorMesYTarjeta[mes][tarjetaId] || 0);

        return {
            label: `${config.nombre} `, // nombre de la tarjeta de pago mensual 
            data: data,
            borderColor: config.color,
            backgroundColor: config.color + '40', 
            borderWidth: 2,
            fill: 'origin', 
            tension: 0.3
        };
    }).filter(ds => ds.data.some(val => val > 0));

    const labels = todosLosMeses.map(mes => {
        const [year, month] = mes.split('-');
        const date = new Date(year, month - 1); 
        return date.toLocaleString('es-ES', { month: 'short', year: 'numeric' });
    });
    
    if (miGraficoPagos) {
        miGraficoPagos.destroy();
    }

    miGraficoPagos = new Chart(graficoPagosMensualesEl, {
        type: 'line', 
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { 
                    beginAtZero: true, 
                    title: { display: true, text: 'Monto ($)', color: '#c6cfd8ff' },
                    // DESACTIVA LA CUADRÍCULA VERTICAL
                    grid: { display: false } 
                },
                x: { 
                    // DESACTIVA LA CUADRÍCULA HORIZONTAL
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { labels: { color: '#eceef0ff' } }
            }
        }
    });
}

// --- 6. MANEJO DE EVENTOS ---

// Evento para MOSTRAR/OCULTAR Configuración de Tarjetas
btnMostrarConfig.addEventListener('click', () => {
    configArea.classList.toggle('visible');
    btnMostrarConfig.textContent = configArea.classList.contains('visible') ? 'Ocultar Configuración' : '➕ Agregar / Configurar Tarjeta';
});

// Evento para MOSTRAR/OCULTAR Formulario de Registro
btnMostrarRegistro.addEventListener('click', () => {
    registroArea.classList.toggle('visible');
    btnMostrarRegistro.textContent = registroArea.classList.contains('visible') ? '❌ Cerrar Formulario' : '➕ Abrir Formulario';
});


// Evento para AGREGAR/EDITAR Tarjeta
formTarjeta.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const tarjetaId = document.getElementById('tarjeta-id-config').value.toUpperCase();
    const nombre = document.getElementById('nombre-tarjeta').value;
    const color = document.getElementById('color-tarjeta').value;
    const limite = parseFloat(document.getElementById('limite-tarjeta').value);
    const corte = parseInt(document.getElementById('fecha-corte').value);
    const pago = parseInt(document.getElementById('fecha-pago').value);
    
    if (!tarjetaId || !nombre || !limite || !corte || !pago) {
        alert('Por favor, completa todos los campos de configuración de tarjeta.');
        return;
    }
    if (corte < 1 || corte > 31 || pago < 1 || pago > 31) {
         alert('Por favor, ingresa un día válido (1-31) para corte y pago.');
         return;
    }

    const data = { tarjetaId, nombre, color, limite, corte, pago };
    
    try {
        await fetchAPI('/api/tarjetas', 'POST', data);
        alert(`Configuración de ${nombre} (${tarjetaId}) guardada/creada.`);
        formTarjeta.reset();
        await actualizarTodo(); // Recargar datos para actualizar el dashboard
        configurarVisibilidadInicial(); // Vuelve a verificar la visibilidad
    } catch (error) {
        alert(`Error al guardar la tarjeta en el servidor: ${error.message}`);
    }
});

// Función auxiliar para calcular las fechas de pago de las cuotas
function calcularCuotas(valor, numCuotas, config) {
    const cuotas = [];
    const valorCuota = valor / numCuotas;
    const today = new Date();
    const diaCompra = today.getDate();
    const diaCorte = config.corte;

    let primerPagoMes = today.getMonth(); 
    let primerPagoAnio = today.getFullYear();
    
    // Determinar el mes del primer pago
    // Si la compra es antes o en el día de corte, el primer pago es el próximo mes
    if (diaCompra <= diaCorte) { 
        primerPagoMes += 1;
    } else {
        // Si la compra es después del día de corte, el primer pago es dentro de dos meses
        primerPagoMes += 2; 
    }

    for (let i = 1; i <= numCuotas; i++) {
        let pagoMes = primerPagoMes + (i - 1);
        let pagoAnio = primerPagoAnio;
        
        while (pagoMes > 11) {
            pagoMes -= 12;
            pagoAnio += 1;
        }
        
        // Crear la fecha de pago en formato 'YYYY-MM'
        // pagoMes es 0-11, sumamos 1 para el formato MM.
        const fechaPagoProgramada = `${pagoAnio}-${String(pagoMes + 1).padStart(2, '0')}`;
        
        cuotas.push({
            valorCuota: valorCuota,
            cuotaActual: i,
            fechaPagoProgramada: fechaPagoProgramada,
        });
    }
    return cuotas;
}

// Evento para Registrar Transacción
formTransaccion.addEventListener('submit', async (e) => {
    e.preventDefault(); 

    const tipo = document.getElementById('tipo').value;
    const valor = parseFloat(document.getElementById('valor').value);
    const descripcion = document.getElementById('descripcion').value;
    const categoria = document.getElementById('categoria').value;
    const cuentaTipo = document.getElementById('cuenta-tipo').value;
    const numCuotas = parseInt(document.getElementById('cuotas').value);

    const esCredito = cuentaTipo.startsWith('credito-');
    const tarjetaId = esCredito ? cuentaTipo.split('-')[1] : null;

    if (!valor || !descripcion || !categoria || !numCuotas) {
        alert('Por favor, completa todos los campos.');
        return;
    }

    try {
        if (!esCredito || tipo === 'ingreso') {
            // Transacción de Débito/Ingreso simple
            const nuevaTransaccion = { tipo, valor, descripcion, categoria };
            await fetchAPI('/api/transaccion', 'POST', nuevaTransaccion);
            
        } else if (esCredito && tipo === 'gasto') {
            // Gasto a Crédito (Cuotas)
            const config = tarjetasConfig[tarjetaId];
            
            if (!config || config.limite === 0) {
                alert(`Por favor, configura el límite de la ${config ? config.nombre : tarjetaId} primero.`);
                return;
            }
            
            const cuotas = calcularCuotas(valor, numCuotas, config);
            
            const dataCuotas = {
                tarjetaId,
                descripcion,
                valorTotal: valor,
                numCuotas,
                cuotas // Lista de objetos cuota
            };
            
            await fetchAPI('/api/cuotas', 'POST', dataCuotas);
        }

        formTransaccion.reset();
        await actualizarTodo();
        alert('Movimiento registrado con éxito.');

    } catch (error) {
        alert(`Error al registrar el movimiento: ${error.message}`);
    }
});


// --- 8. INICIALIZACIÓN ---

async function cargarDatos() {
    try {
        const [tarjetasData, cuotasData, transaccionesData] = await Promise.all([
            fetchAPI('/api/tarjetas'),
            fetchAPI('/api/cuotas'),
            fetchAPI('/api/transacciones')
        ]);

        // Mapear tarjetas a un objeto para fácil acceso por ID
        tarjetasConfig = tarjetasData.reduce((acc, config) => {
            acc[config.tarjetaId] = config;
            return acc;
        }, {});
        
        gastoEnCuotas = cuotasData;
        transacciones = transaccionesData;
        
    } catch (error) {
        console.error("Fallo al cargar datos iniciales:", error);
        alert("¡Alerta! No se pudieron cargar los datos desde el servidor. Asegúrate de que el backend está corriendo y de que no hay errores de conexión.");
    }
}

async function actualizarTodo() {
    await cargarDatos(); // Siempre cargamos los últimos datos del servidor
    actualizarDashboard(); 
    actualizarDashboardTarjeta(); 
    mostrarTransacciones(); 
}


/**
 * Verifica si hay tarjetas configuradas y ajusta la visibilidad inicial de la configuración.
 */
function configurarVisibilidadInicial() {
    // Si hay tarjetas configuradas, OCULTAMOS la sección de gestión al inicio.
    if (Object.keys(tarjetasConfig).length > 0) {
        configArea.classList.remove('visible');
        btnMostrarConfig.textContent = '➕ Agregar / Configurar Tarjeta';
    } else {
        // Si no hay tarjetas, la mostramos para que el usuario pueda empezar.
        configArea.classList.add('visible');
        btnMostrarConfig.textContent = 'Ocultar Configuración';
    }
    
    // El formulario de registro siempre inicia oculto
    registroArea.classList.remove('visible');
    btnMostrarRegistro.textContent = '➕ Abrir Formulario';
}


// Iniciar la aplicación
async function iniciarApp() {
    await actualizarTodo();
    configurarVisibilidadInicial();
}

iniciarApp();