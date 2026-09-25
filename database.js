// database.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let dbWrapper = null;  // ← Agora é o WRAPPER que fica em cache, não o pool

export async function openDb() {
    if (dbWrapper) return dbWrapper;

    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL não definida no .env');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    // Testa a conexão uma vez
    const client = await pool.connect();
    try {
        await client.query('SELECT NOW()');
        console.log('✅ Conectado ao Supabase (PostgreSQL)');
    } finally {
        client.release();
    }

    // Cria o wrapper e ARMAZENA ELE em cache
        dbWrapper = {
        all: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows;
        },

        get: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows[0];
        },

        run: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return {
                changes: result.rowCount,
                lastID: result.rows[0]?.id
            };
        },

        exec: async (sql) => {
            return await pool.query(sql);
        },

        query: async (sql, params = []) => {
            const result = await pool.query(sql, params);
            return result.rows;
        },

        prepare: async (sql) => {
            return {
                run: async (params = []) => {
                    const result = await pool.query(sql, params);
                    return {
                        changes: result.rowCount,
                        lastID: result.rows[0]?.id
                    };
                },
                finalize: async () => {}
            };
        },

        close: async () => {
            await pool.end();
            dbWrapper = null;
        }
    };

    return dbWrapper;
}

export default openDb;