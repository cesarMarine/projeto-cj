// database.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let pool = null;

export async function openDb() {
    if (pool) return pool;

    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    // Testa a conexão
    const client = await pool.connect();
    try {
        await client.query('SELECT NOW()');
        console.log('✅ Conectado ao Supabase (PostgreSQL)');
    } finally {
        client.release();
    }

    // Wrapper pra manter compatibilidade com o código existente (db.run, db.get, db.all)
    return {
        // Executa uma query e retorna todas as linhas
        all: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows;
        },

        // Executa uma query e retorna uma linha
        get: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows[0];
        },

        // Executa uma query (INSERT/UPDATE/DELETE) e retorna info
        run: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return {
                changes: result.rowCount,
                lastID: result.rows[0]?.id
            };
        },

        // Executa múltiplas queries (transações, etc)
        exec: async (sql) => {
            return await pool.query(sql);
        },

        // Acesso ao pool bruto (caso precise)
        query: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows;
        },

        // Fecha o pool
        close: async () => {
            await pool.end();
            pool = null;
        }
    };
}

export default openDb;