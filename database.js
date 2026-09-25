// database.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

let dbWrapper = null;

// Converte "SELECT * FROM t WHERE a = ? AND b = ?"
// em      "SELECT * FROM t WHERE a = $1 AND b = $2"
function converterPlaceholders(sql) {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
}

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

    const client = await pool.connect();
    try {
        await client.query('SELECT NOW()');
        console.log('✅ Conectado ao Supabase (PostgreSQL)');
    } finally {
        client.release();
    }

    dbWrapper = {
        all: async (sql, params = []) => {
            const result = await pool.query(converterPlaceholders(sql), params);
            return result.rows;
        },

        get: async (sql, params = []) => {
            const result = await pool.query(converterPlaceholders(sql), params);
            return result.rows[0];
        },

        run: async (sql, params = []) => {
            const result = await pool.query(converterPlaceholders(sql), params);
            return {
                changes: result.rowCount,
                lastID: result.rows[0]?.id
            };
        },

        exec: async (sql) => {
            return await pool.query(sql);
        },

        query: async (sql, params = []) => {
            const result = await pool.query(converterPlaceholders(sql), params);
            return result.rows;
        },

        prepare: async (sql) => {
            const pgSql = converterPlaceholders(sql);
            return {
                run: async (params = []) => {
                    const result = await pool.query(pgSql, params);
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