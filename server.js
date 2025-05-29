require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

const OFICINES = {
    barcelona: 11,
    girona: 3
};

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://user:password@localhost:5432/reserves'
});

// Crea la taula si no existeix
(async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reserves (
            id SERIAL PRIMARY KEY,
            oficina VARCHAR(32) NOT NULL,
            dia DATE NOT NULL,
            nom VARCHAR(128) NOT NULL
        );
    `);
})();

// Llista de reserves per oficina i dia
app.get('/api/llocs/:oficina/:dia', async (req, res) => {
    const { oficina, dia } = req.params;
    if (!OFICINES[oficina]) return res.status(400).json({ error: 'Oficina no vàlida' });
    const result = await pool.query(
        'SELECT nom FROM reserves WHERE oficina=$1 AND dia=$2 ORDER BY nom ASC',
        [oficina, dia]
    );
    res.json({
        lliures: OFICINES[oficina] - result.rows.length,
        ocupats: result.rows.map(r => r.nom)
    });
});

// Fer una reserva (amb transacció per evitar sobre-reserva)
app.post('/api/reserva', async (req, res) => {
    const { oficina, dia, nom } = req.body;
    if (!oficina || !dia || !nom) return res.status(400).json({ error: 'Falten dades' });
    if (!OFICINES[oficina]) return res.status(400).json({ error: 'Oficina no vàlida' });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Comprova si ja existeix la reserva
        const existeix = await client.query(
            'SELECT 1 FROM reserves WHERE oficina=$1 AND dia=$2 AND nom=$3',
            [oficina, dia, nom]
        );
        if (existeix.rowCount > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Ja tens reserva per aquest dia' });
        }
        // Comprova l'aforament
        const count = await client.query(
            'SELECT COUNT(*) FROM reserves WHERE oficina=$1 AND dia=$2',
            [oficina, dia]
        );
        if (parseInt(count.rows[0].count) >= OFICINES[oficina]) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'No queden llocs lliures' });
        }
        // Insereix la reserva
        await client.query(
            'INSERT INTO reserves (oficina, dia, nom) VALUES ($1, $2, $3)',
            [oficina, dia, nom]
        );
        await client.query('COMMIT');
        res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: 'Error de servidor' });
    } finally {
        client.release();
    }
});

// Cancel·lació de reserva
app.delete('/api/reserva', async (req, res) => {
    const { oficina, dia, nom } = req.body;
    if (!oficina || !dia || !nom) return res.status(400).json({ error: 'Falten dades' });
    await pool.query(
        'DELETE FROM reserves WHERE oficina=$1 AND dia=$2 AND nom=$3',
        [oficina, dia, nom]
    );
    res.json({ ok: true });
});

// Llista de persones amb alguna reserva per oficina
app.get('/api/usuaris/:oficina', async (req, res) => {
    const { oficina } = req.params;
    if (!OFICINES[oficina]) return res.status(400).json({ error: 'Oficina no vàlida' });
    const result = await pool.query(
        'SELECT DISTINCT nom FROM reserves WHERE oficina=$1 ORDER BY nom ASC',
        [oficina]
    );
    res.json(result.rows.map(r => r.nom));
});

app.listen(PORT, () => {
    console.log(`Servidor escoltant a http://localhost:${PORT}`);
});
