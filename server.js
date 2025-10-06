const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs'); // Necesario para crear el directorio
const app = express();
const PORT = 3000;

// Middleware para parsear JSON
app.use(express.json());

// --- 1. CONFIGURACIÓN DE LA BASE DE DATOS (Ruta corregida) ---

// La base de datos se crea dentro del directorio 'data'.
// Esto es CRUCIAL para que el Docker Volume funcione y persista los datos.
const DB_PATH = './data/presupuesto.db';

// Crear el directorio 'data' si no existe
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Inicializar la base de datos
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error al abrir la base de datos:', err.message);
    } else {
        console.log('Conectado a la base de datos SQLite.');
        inicializarTablas();
    }
});

// Función para inicializar las tablas si no existen
function inicializarTablas() {
    // Tabla para configuración de tarjetas de crédito
    db.run(`CREATE TABLE IF NOT EXISTS tarjetas_config (
        tarjetaId TEXT PRIMARY KEY,
        nombre TEXT NOT NULL,
        color TEXT,
        limite REAL NOT NULL,
        corte INTEGER NOT NULL,
        pago INTEGER NOT NULL
    )`);

    // Tabla para transacciones de débito/ingreso
    db.run(`CREATE TABLE IF NOT EXISTS transacciones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tipo TEXT NOT NULL, -- 'ingreso' o 'gasto' (debito)
        valor REAL NOT NULL,
        descripcion TEXT,
        categoria TEXT
    )`);

    // Tabla para cuotas pendientes de tarjeta de crédito
    db.run(`CREATE TABLE IF NOT EXISTS cuotas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tarjetaId TEXT NOT NULL,
        descripcion TEXT,
        valorTotalCompra REAL NOT NULL,
        valorCuota REAL NOT NULL,
        cuotaActual INTEGER NOT NULL,
        cuotasTotales INTEGER NOT NULL,
        valorPendiente REAL NOT NULL,
        fechaPagoProgramada TEXT NOT NULL,
        FOREIGN KEY (tarjetaId) REFERENCES tarjetas_config(tarjetaId) ON DELETE CASCADE
    )`);
}

// --- 2. SERVIR ARCHIVOS ESTÁTICOS (Frontend) ---
// Sirve los archivos de la carpeta 'public' (index.html, script.js, style.css)
app.use(express.static(path.join(__dirname, 'public')));

// Ruta principal que devuelve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


// --- 3. RUTAS DE LA API (Backend) ---

// --- A. TARJETAS DE CRÉDITO ---

// GET /api/tarjetas: Obtiene todas las configuraciones de tarjetas
app.get('/api/tarjetas', (req, res) => {
    db.all('SELECT * FROM tarjetas_config', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/tarjetas: Crea o Actualiza una tarjeta
app.post('/api/tarjetas', (req, res) => {
    const { tarjetaId, nombre, color, limite, corte, pago } = req.body;
    const sql = `INSERT OR REPLACE INTO tarjetas_config 
                 (tarjetaId, nombre, color, limite, corte, pago)
                 VALUES (?, ?, ?, ?, ?, ?)`;
                 
    db.run(sql, [tarjetaId, nombre, color, limite, corte, pago], function(err) {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: 'Error al guardar tarjeta en DB.' });
        }
        res.json({ message: 'Tarjeta guardada/actualizada', id: this.lastID || tarjetaId });
    });
});

// DELETE /api/tarjetas/:id: Elimina una tarjeta y sus cuotas asociadas
app.delete('/api/tarjetas/:id', (req, res) => {
    const tarjetaId = req.params.id;
    // La eliminación de las cuotas asociadas está garantizada por ON DELETE CASCADE en la tabla 'cuotas'
    db.run('DELETE FROM tarjetas_config WHERE tarjetaId = ?', tarjetaId, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: 'Tarjeta no encontrada.' });
        res.json({ message: 'Tarjeta y cuotas asociadas eliminadas' });
    });
});


// --- B. CUOTAS (GASTOS A CRÉDITO) ---

// GET /api/cuotas: Obtiene todas las cuotas pendientes
app.get('/api/cuotas', (req, res) => {
    // Usamos valorPendiente > 0 para simular que son cuotas no pagadas
    db.all('SELECT * FROM cuotas WHERE valorPendiente > 0 ORDER BY fechaPagoProgramada ASC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/cuotas: Registra un nuevo gasto en cuotas
app.post('/api/cuotas', (req, res) => {
    const { tarjetaId, descripcion, valorTotal, numCuotas, cuotas } = req.body;
    
    const insertSql = `INSERT INTO cuotas 
                       (tarjetaId, descripcion, valorTotalCompra, valorCuota, cuotaActual, cuotasTotales, valorPendiente, fechaPagoProgramada)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');
        
        cuotas.forEach(cuota => {
            db.run(insertSql, 
                [
                    tarjetaId, 
                    descripcion, 
                    valorTotal, 
                    cuota.valorCuota, 
                    cuota.cuotaActual, // La cuota ya debe venir con su número (1, 2, 3...)
                    numCuotas, 
                    cuota.valorCuota, // valorPendiente es igual a valorCuota al inicio
                    cuota.fechaPagoProgramada
                ], 
                (err) => {
                    if (err) {
                        db.run('ROLLBACK;', () => {
                            console.error('Rollback por error en cuota:', err.message);
                            return res.status(500).json({ error: 'Error al registrar cuotas.' });
                        });
                    }
                }
            );
        });

        db.run('COMMIT;', (commitErr) => {
            if (commitErr) return res.status(500).json({ error: commitErr.message });
            res.json({ message: `Gasto en ${numCuotas} cuotas registrado.` });
        });
    });
});

// DELETE /api/cuota/:id: Elimina una cuota específica
app.delete('/api/cuota/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM cuotas WHERE id = ?', id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: 'Cuota no encontrada.' });
        res.json({ message: 'Cuota eliminada.' });
    });
});


// --- C. TRANSACCIONES (DÉBITO / INGRESO) ---

// GET /api/transacciones: Obtiene todas las transacciones (débito/ingreso)
app.get('/api/transacciones', (req, res) => {
    db.all('SELECT * FROM transacciones ORDER BY id DESC', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST /api/transaccion: Registra una nueva transacción
app.post('/api/transaccion', (req, res) => {
    const { tipo, valor, descripcion, categoria } = req.body;
    const sql = 'INSERT INTO transacciones (tipo, valor, descripcion, categoria) VALUES (?, ?, ?, ?)';
    db.run(sql, [tipo, valor, descripcion, categoria], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Transacción registrada', id: this.lastID });
    });
});

// DELETE /api/transaccion/:id: Elimina una transacción
app.delete('/api/transaccion/:id', (req, res) => {
    const id = req.params.id;
    db.run('DELETE FROM transacciones WHERE id = ?', id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: 'Transacción no encontrada.' });
        res.json({ message: 'Transacción eliminada.' });
    });
});


// --- 4. INICIO DEL SERVIDOR ---

app.listen(PORT, () => {
    console.log(`Servidor Express corriendo en el puerto ${PORT}`);
    console.log(`Frontend accesible en http://localhost:${PORT}`);
});