// database.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let dbInstance = null;

export async function openDb() {
    if (dbInstance) return dbInstance;

    dbInstance = await open({
        filename: path.join(__dirname, 'database.db'),
        driver: sqlite3.Database
    });

    // Tabela CLIENTES
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS clientes_cj (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo_cli TEXT UNIQUE NOT NULL,
            nome_cli TEXT NOT NULL,
            vendedor TEXT,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_codigo ON clientes_cj(codigo_cli);
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes_cj(nome_cli);
    `);

    // Tabela PRODUTOS
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS produtos_cj (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT,
            codigo_cj TEXT UNIQUE NOT NULL,
            descricao TEXT NOT NULL,
            data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo ON produtos_cj(codigo);
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo_cj ON produtos_cj(codigo_cj);
        CREATE INDEX IF NOT EXISTS idx_produtos_descricao ON produtos_cj(descricao);
    `);

    // Tabela CHAMADOS (chamados_cj)
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS chamados_cj (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            protocolo TEXT UNIQUE NOT NULL,
            vendedor TEXT,
            id_cliente TEXT,
            cliente_nome TEXT,
            vendedor_cliente TEXT,
            produto TEXT,
            codigo_produto TEXT,
            descricao_produto TEXT,
            nota_marine TEXT,
            teste_receber TEXT,
            teste_venda TEXT,
            tempo_uso TEXT,
            descricao_defeito TEXT,
            capacidade_loja TEXT,
            status TEXT DEFAULT 'Pendente',
            decisao_tecnico TEXT,
            conversa TEXT DEFAULT '[]',
            arquivos_json TEXT DEFAULT '{}',
            reaberto INTEGER DEFAULT 0,
            reaberto_em DATETIME,
            motivo_reabertura TEXT,
            data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
            data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_chamados_protocolo ON chamados_cj(protocolo);
        CREATE INDEX IF NOT EXISTS idx_chamados_vendedor ON chamados_cj(vendedor);
        CREATE INDEX IF NOT EXISTS idx_chamados_status ON chamados_cj(status);
    `);

    // Tabela ARQUIVOS (chamados_cj_arquivos)
    await dbInstance.exec(`
        CREATE TABLE IF NOT EXISTS chamados_cj_arquivos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chamado_id INTEGER,
            tipo TEXT,
            nome_original TEXT,
            nome_arquivo TEXT,
            caminho TEXT,
            tamanho INTEGER,
            data_upload DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chamado_id) REFERENCES chamados_cj(id)
        );
    `);

    console.log('✅ Banco de dados criado/verificado com sucesso');
    console.log('   📋 Tabelas: clientes_cj, produtos_cj, chamados_cj, chamados_cj_arquivos');
    return dbInstance;
}

export default openDb;