// server.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import openDb from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3200;

// ===== MIDDLEWARES =====
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Servir arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Pasta de uploads
const uploadsDir = path.join(__dirname, 'uploads', 'garantia');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// ================================================================
// 🏠 ROTAS DE PÁGINAS
// ================================================================

// Admin
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Garantia (vendedor)
app.get('/garantia', (req, res) => {
    res.sendFile(path.join(__dirname, 'garantia.html'));
});

// Técnico
// Técnico
app.get('/tecnico', (req, res) => {
    res.sendFile(path.join(__dirname, 'tecnico.html'));
});
app.get('/angelo', (req, res) => {
    res.sendFile(path.join(__dirname, 'tecnico.html'));
});

// Healthcheck
app.get('/api/teste', (req, res) => {
    res.json({ success: true, mensagem: 'Servidor funcionando!', timestamp: new Date().toISOString() });
});

// ================================================================
// 📥 ADMIN - IMPORTAÇÃO DE PLANILHAS
// ================================================================

app.post('/api/admin/importar-clientes', async (req, res) => {
    try {
        const { dados } = req.body;

        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Envie um array "dados" com os clientes.'
            });
        }

        const db = await openDb();
        let inseridos = 0;
        let atualizados = 0;
        let ignorados = 0;

        //await db.run('BEGIN TRANSACTION');

        const stmt = await db.prepare(`
            INSERT INTO clientes_cj (codigo_cli, nome_cli, vendedor)
            VALUES (?, ?, ?)
            ON CONFLICT(codigo_cli) DO UPDATE SET
                nome_cli = excluded.nome_cli,
                vendedor = excluded.vendedor
        `);

        for (const item of dados) {
            const codigo = String(item['Código_cli'] || item.codigo_cli || '').trim();
            const nome = String(item['nome_cli'] || item.nome_cli || '').trim();
            const vendedor = String(item['vendedor'] || item.vendedor || '').trim();

            if (!codigo || !nome || codigo === 'undefined' || codigo === 'null') {
                ignorados++;
                continue;
            }

            const existe = await db.get('SELECT id FROM clientes_cj WHERE codigo_cli = ?', [codigo]);

            await stmt.run([codigo, nome, vendedor]);

            if (existe) atualizados++;
            else inseridos++;
        }

        await stmt.finalize();
       // await db.run('COMMIT');

        res.json({
            success: true,
            mensagem: 'Clientes importados com sucesso!',
            inseridos,
            atualizados,
            ignorados,
            total: dados.length
        });

    } catch (error) {
        console.error('❌ Erro ao importar clientes:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/admin/importar-produtos', async (req, res) => {
    try {
        const { dados } = req.body;

        if (!Array.isArray(dados) || dados.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Envie um array "dados" com os produtos.'
            });
        }

        const db = await openDb();
        let inseridos = 0;
        let atualizados = 0;
        let ignorados = 0;

        //await db.run('BEGIN TRANSACTION');

        const stmt = await db.prepare(`
            INSERT INTO produtos_cj (codigo, codigo_cj, descricao)
            VALUES (?, ?, ?)
            ON CONFLICT(codigo_cj) DO UPDATE SET
                codigo = excluded.codigo,
                descricao = excluded.descricao
        `);

        for (const item of dados) {
            const codigo = String(item['Código'] || item.codigo || '').trim();
            const codigoCj = String(item['Código_CJ'] || item.codigo_cj || '').trim();
            const descricao = String(item['Descrição - Casa Japon'] || item.descricao || '').trim();

            if (!codigoCj || !descricao || codigoCj === 'undefined' || codigoCj === 'null' || codigoCj === 'NOVO') {
                ignorados++;
                continue;
            }

            const existe = await db.get('SELECT id FROM produtos_cj WHERE codigo_cj = ?', [codigoCj]);

            await stmt.run([codigo, codigoCj, descricao]);

            if (existe) atualizados++;
            else inseridos++;
        }

        await stmt.finalize();
        //await db.run('COMMIT');

        res.json({
            success: true,
            mensagem: 'Produtos importados com sucesso!',
            inseridos,
            atualizados,
            ignorados,
            total: dados.length
        });

    } catch (error) {
        console.error('❌ Erro ao importar produtos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📊 ADMIN - ESTATÍSTICAS
// ================================================================

app.get('/api/admin/stats', async (req, res) => {
    try {
        const db = await openDb();

        const totalClientes = await db.get('SELECT COUNT(*) as total FROM clientes_cj');
        const totalProdutos = await db.get('SELECT COUNT(*) as total FROM produtos_cj');
        const totalChamados = await db.get('SELECT COUNT(*) as total FROM chamados_cj');

        res.json({
            success: true,
            clientes: totalClientes.total,
            produtos: totalProdutos.total,
            garantias: totalChamados.total
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Limpar tabela
app.delete('/api/admin/limpar/:tabela', async (req, res) => {
    try {
        const { tabela } = req.params;
        const permitidas = ['clientes_cj', 'produtos_cj'];

        if (!permitidas.includes(tabela)) {
            return res.status(400).json({ success: false, error: 'Tabela não permitida' });
        }

        const db = await openDb();
        await db.run(`DELETE FROM ${tabela}`);

        res.json({ success: true, mensagem: `Tabela ${tabela} limpa com sucesso!` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 🔍 BUSCA DE CLIENTES E PRODUTOS
// ================================================================

// Buscar cliente por código
app.get('/api/garantia/buscar-cliente-exato/:id', async (req, res) => {
    try {
        const db = await openDb();
        const id = req.params.id.trim();

        if (!/^\d+$/.test(id)) {
            return res.json({ success: false, error: 'Digite apenas números para o ID' });
        }

        const clientes = await db.all(`
            SELECT 
                codigo_cli as id_cliente,
                nome_cli as cliente_nome,
                vendedor
            FROM clientes_cj
            WHERE codigo_cli = ?
        `, [id]);

        res.json({ success: true, clientes });
    } catch (error) {
        console.error('❌ Erro ao buscar cliente:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buscar cliente por termo (nome ou código)
app.get('/api/garantia/buscar-cliente/:termo', async (req, res) => {
    try {
        const db = await openDb();
        const termo = req.params.termo.trim();

        const clientes = await db.all(`
            SELECT 
                codigo_cli as id_cliente,
                nome_cli as cliente_nome,
                vendedor
            FROM clientes_cj
            WHERE codigo_cli LIKE ? OR nome_cli LIKE ?
            LIMIT 30
        `, [`%${termo}%`, `%${termo}%`]);

        res.json({ success: true, clientes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buscar cliente unificado
app.get('/api/garantia/buscar-cliente-unificado/:termo', async (req, res) => {
    try {
        const db = await openDb();
        const termo = req.params.termo.trim();

        const clientes = await db.all(`
            SELECT 
                codigo_cli as id_cliente,
                nome_cli as cliente_nome,
                vendedor
            FROM clientes_cj
            WHERE codigo_cli = ? OR nome_cli LIKE ?
            LIMIT 30
        `, [termo, `%${termo}%`]);

        res.json({ success: true, clientes, total: clientes.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buscar produto
app.get('/api/garantia/buscar-produto/:codigo', async (req, res) => {
    try {
        const db = await openDb();
        const codigo = req.params.codigo.trim();

        const produtos = await db.all(`
            SELECT 
                codigo,
                codigo_cj,
                descricao
            FROM produtos_cj
            WHERE codigo = ? OR codigo_cj = ? OR descricao LIKE ?
            LIMIT 20
        `, [codigo, codigo, `%${codigo}%`]);

        res.json({ success: true, produtos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Verificar produto
app.get('/api/garantia/verificar-produto/:codigo', async (req, res) => {
    try {
        const db = await openDb();
        const codigo = req.params.codigo.trim();

        const produto = await db.get(`
            SELECT codigo, codigo_cj, descricao
            FROM produtos_cj
            WHERE codigo_cj = ? OR codigo = ?
        `, [codigo, codigo]);

        res.json({
            success: true,
            existe: !!produto,
            produto: produto || null
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📋 CHAMADOS
// ================================================================

// Criar novo chamado
app.post('/api/garantia/novo', async (req, res) => {
    try {
        const db = await openDb();
        const dados = req.body;

        // Gera protocolo único
        const hoje = new Date();
        const data = hoje.getFullYear() +
                     String(hoje.getMonth() + 1).padStart(2, '0') +
                     String(hoje.getDate()).padStart(2, '0');
        const random = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
        const protocolo = 'GAR-' + data + '-' + random;

        const result = await db.run(`
            INSERT INTO chamados_cj (
                protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, descricao_produto, nota_marine,
                teste_receber, teste_venda, tempo_uso,
                descricao_defeito, capacidade_loja, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente')
        `, [
            protocolo,
            dados.vendedor,
            dados.cliente?.id_cliente || '',
            dados.cliente?.cliente_nome || '',
            dados.cliente?.vendedor || '',
            dados.produto || '',
            dados.codigo_produto || '',
            dados.descricao_produto || '',
            dados.notaMarine || '',
            dados.testeReceber || '',
            dados.testeVenda || '',
            dados.tempoUso || '',
            dados.descricaoDefeito || '',
            dados.capacidadeLoja || ''
        ]);

        res.json({
            success: true,
            protocolo,
            id: result.lastID,
            mensagem: 'Chamado criado com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao criar chamado:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Listar chamados de um vendedor
app.get('/api/garantia/vendedor/:vendedor', async (req, res) => {
    try {
        const db = await openDb();
        const vendedor = req.params.vendedor;

        const chamados = await db.all(`
            SELECT 
                id, protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, descricao_produto, nota_marine,
                status,
                data_criacao,
                decisao_tecnico
            FROM chamados_cj
            WHERE vendedor = ?
            ORDER BY data_criacao DESC
        `, [vendedor]);

        res.json({ success: true, chamados });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Listar todos os chamados (técnico)
app.get('/api/garantia/todos', async (req, res) => {
    try {
        const db = await openDb();

        const chamados = await db.all(`
            SELECT 
                id, protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, nota_marine, status,
                data_criacao,
                decisao_tecnico, conversa,
                reaberto, reaberto_em, motivo_reabertura
            FROM chamados_cj
            ORDER BY data_criacao DESC
        `);

        res.json({ success: true, chamados });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Buscar detalhes de um chamado
app.get('/api/garantia/detalhe/:protocolo', async (req, res) => {
    try {
        const db = await openDb();
        const protocolo = req.params.protocolo;

        const chamado = await db.get(`
            SELECT * FROM chamados_cj WHERE protocolo = ?
        `, [protocolo]);

        if (!chamado) {
            return res.status(404).json({ success: false, error: 'Chamado não encontrado' });
        }

        const arquivos = await db.all(`
            SELECT id, tipo, nome_original, nome_arquivo, caminho, tamanho, data_upload
            FROM chamados_cj_arquivos
            WHERE chamado_id = ?
        `, [chamado.id]);

        res.json({ success: true, garantia: chamado, arquivos: arquivos || [] });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Atualizar status
app.put('/api/garantia/status/:protocolo', async (req, res) => {
    try {
        const db = await openDb();
        const { status } = req.body;

        const validos = ['Pendente', 'Em Análise', 'Aprovado', 'Recusado'];
        if (!validos.includes(status)) {
            return res.status(400).json({ success: false, error: 'Status inválido' });
        }

        const result = await db.run(`
            UPDATE chamados_cj SET status = ?, data_atualizacao = CURRENT_TIMESTAMP
            WHERE protocolo = ?
        `, [status, req.params.protocolo]);

        if (result.changes === 0) {
            return res.status(404).json({ success: false, error: 'Chamado não encontrado' });
        }

        res.json({ success: true, mensagem: 'Status atualizado!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Salvar decisão do técnico
app.put('/api/garantia/decisao/:protocolo', async (req, res) => {
    try {
        const db = await openDb();
        const { decisao } = req.body;

        if (!decisao) {
            return res.status(400).json({ success: false, error: 'Decisão vazia' });
        }

        await db.run(`
            UPDATE chamados_cj SET decisao_tecnico = ?, data_atualizacao = CURRENT_TIMESTAMP
            WHERE protocolo = ?
        `, [decisao, req.params.protocolo]);

        res.json({ success: true, mensagem: 'Decisão salva!' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Reabrir chamado
app.put('/api/garantia/reabrir', async (req, res) => {
    try {
        const db = await openDb();
        const { protocolo, produto, codigo_produto, descricao_produto, nota_marine,
                teste_receber, teste_venda, tempo_uso, descricao_defeito, capacidade_loja,
                motivo_reabertura } = req.body;

        const chamado = await db.get('SELECT * FROM chamados_cj WHERE protocolo = ?', [protocolo]);
        if (!chamado) {
            return res.status(404).json({ success: false, error: 'Chamado não encontrado' });
        }

        await db.run(`
            UPDATE chamados_cj SET 
                produto = COALESCE(?, produto),
                codigo_produto = COALESCE(?, codigo_produto),
                descricao_produto = COALESCE(?, descricao_produto),
                nota_marine = COALESCE(?, nota_marine),
                teste_receber = COALESCE(?, teste_receber),
                teste_venda = COALESCE(?, teste_venda),
                tempo_uso = COALESCE(?, tempo_uso),
                descricao_defeito = COALESCE(?, descricao_defeito),
                capacidade_loja = COALESCE(?, capacidade_loja),
                status = 'Pendente',
                reaberto = COALESCE(reaberto, 0) + 1,
                reaberto_em = CURRENT_TIMESTAMP,
                motivo_reabertura = COALESCE(?, motivo_reabertura),
                data_atualizacao = CURRENT_TIMESTAMP
            WHERE protocolo = ?
        `, [produto, codigo_produto, descricao_produto, nota_marine,
            teste_receber, teste_venda, tempo_uso, descricao_defeito, capacidade_loja,
            motivo_reabertura || 'Cliente reabriu o chamado',
            protocolo]);

        res.json({
            success: true,
            message: 'Chamado reaberto com sucesso',
            protocolo,
            reaberto: (chamado.reaberto || 0) + 1
        });

    } catch (error) {
        console.error('❌ Erro ao reabrir:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 💬 CHAT
// ================================================================

app.post('/api/garantia/mensagem/:protocolo', async (req, res) => {
    try {
        const db = await openDb();
        const { mensagem, remetente, tipo } = req.body;

        if (!mensagem?.trim()) {
            return res.status(400).json({ success: false, error: 'Mensagem vazia' });
        }

        const result = await db.get('SELECT conversa FROM chamados_cj WHERE protocolo = ?', [req.params.protocolo]);
        if (!result) {
            return res.status(404).json({ success: false, error: 'Chamado não encontrado' });
        }

        let conversa = [];
        try {
            conversa = JSON.parse(result.conversa || '[]');
        } catch (e) { conversa = []; }

        const novaMensagem = {
            id: 'msg_' + Date.now(),
            remetente,
            tipo: tipo || (remetente === 'Técnico' ? 'tecnico' : 'vendedor'),
            mensagem: mensagem.trim(),
            data: new Date().toLocaleString('pt-BR'),
            timestamp: Date.now(),
            lida: false
        };

        conversa.push(novaMensagem);

        await db.run(`
            UPDATE chamados_cj SET conversa = ?, data_atualizacao = CURRENT_TIMESTAMP
            WHERE protocolo = ?
        `, [JSON.stringify(conversa), req.params.protocolo]);

        res.json({ success: true, novaMensagem });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/garantia/mensagens-lidas/:protocolo', async (req, res) => {
    try {
        const db = await openDb();
        const { tipoUsuario } = req.body;

        const result = await db.get('SELECT conversa FROM chamados_cj WHERE protocolo = ?', [req.params.protocolo]);
        if (!result) return res.status(404).json({ success: false, error: 'Chamado não encontrado' });

        let conversa = [];
        try { conversa = JSON.parse(result.conversa || '[]'); } catch (e) { conversa = []; }

        const tipoOp = tipoUsuario === 'vendedor' ? 'tecnico' : 'vendedor';
        conversa = conversa.map(msg => {
            if (msg.tipo === tipoOp && !msg.lida) return { ...msg, lida: true };
            return msg;
        });

        await db.run('UPDATE chamados_cj SET conversa = ? WHERE protocolo = ?', [JSON.stringify(conversa), req.params.protocolo]);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/garantia/notificacoes/:vendedor', async (req, res) => {
    try {
        const db = await openDb();
        const chamados = await db.all(`
            SELECT protocolo, produto, cliente_nome, conversa
            FROM chamados_cj WHERE vendedor = ?
            ORDER BY data_atualizacao DESC
        `, [req.params.vendedor]);

        const comNaoLidas = chamados.map(c => {
            let conversa = [];
            try { conversa = JSON.parse(c.conversa || '[]'); } catch (e) {}
            const naoLidas = conversa.filter(m => m.tipo === 'tecnico' && !m.lida).length;
            return { ...c, nao_lidas: naoLidas };
        }).filter(c => c.nao_lidas > 0);

        res.json({ success: true, chamados: comNaoLidas });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📊 ADMIN - RELATÓRIO DE CHAMADOS (para tela admin)
// ================================================================
app.get('/api/admin/relatorio-chamados', async (req, res) => {
    try {
        const db = await openDb();

        // Filtros dinâmicos via query string
        const {
            vendedor,        // vendedor que abriu
            status,          // Pendente / Em Análise / Aprovado / Recusado
            data_inicio,     // YYYY-MM-DD
            data_fim,        // YYYY-MM-DD
            busca,           // busca livre (protocolo, cliente, produto, código)
            produto,         // filtro por produto específico
            cliente,         // filtro por ID cliente
        } = req.query;

        // 1. Busca todos os chamados
        const chamados = await db.all(`
            SELECT 
                id,
                protocolo,
                vendedor,
                id_cliente,
                cliente_nome,
                vendedor_cliente,
                produto,
                codigo_produto,
                descricao_produto,
                nota_marine,
                teste_receber,
                teste_venda,
                tempo_uso,
                descricao_defeito,
                capacidade_loja,
                status,
                decisao_tecnico,
                reaberto,
                reaberto_em,
                motivo_reabertura,
                data_criacao,
                data_atualizacao
            FROM chamados_cj
            ORDER BY data_criacao DESC
        `);

        // 2. Aplica filtros em memória (mais flexível que SQL dinâmico)
        let filtrados = chamados;

        if (vendedor) {
            filtrados = filtrados.filter(c => c.vendedor === vendedor);
        }
        if (status) {
            filtrados = filtrados.filter(c => c.status === status);
        }
        if (produto) {
            const p = produto.toLowerCase();
            filtrados = filtrados.filter(c =>
                (c.produto || '').toLowerCase().includes(p) ||
                (c.descricao_produto || '').toLowerCase().includes(p)
            );
        }
        if (cliente) {
            filtrados = filtrados.filter(c => String(c.id_cliente) === String(cliente));
        }
        if (data_inicio) {
            filtrados = filtrados.filter(c => c.data_criacao && c.data_criacao.slice(0, 10) >= data_inicio);
        }
        if (data_fim) {
            filtrados = filtrados.filter(c => c.data_criacao && c.data_criacao.slice(0, 10) <= data_fim);
        }
        if (busca) {
            const b = busca.toLowerCase();
            filtrados = filtrados.filter(c =>
                (c.protocolo || '').toLowerCase().includes(b) ||
                (c.cliente_nome || '').toLowerCase().includes(b) ||
                (c.produto || '').toLowerCase().includes(b) ||
                (c.codigo_produto || '').toLowerCase().includes(b) ||
                (c.id_cliente || '').toLowerCase().includes(b) ||
                (c.nota_marine || '').toLowerCase().includes(b)
            );
        }

        res.json({
            success: true,
            total: filtrados.length,
            chamados: filtrados
        });

    } catch (error) {
        console.error('❌ Erro no relatório:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 🗑️ ADMIN - LIMPAR TABELAS
// ================================================================
app.delete('/api/admin/limpar/:tabela', async (req, res) => {
    try {
        const { tabela } = req.params;
        const permitidas = ['clientes_cj', 'produtos_cj'];
        if (!permitidas.includes(tabela)) {
            return res.status(400).json({ success: false, error: 'Tabela não permitida' });
        }
        const db = await openDb();
        await db.run(`DELETE FROM ${tabela}`);
        res.json({ success: true, mensagem: `Tabela ${tabela} limpa` });
    } catch (error) {
        console.error('❌ Erro ao limpar:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 🔄 SYNC - RECEBER CHAMADOS DO PC LOCAL
// ================================================================
app.post('/api/admin/sync-chamados', async (req, res) => {
    try {
        const chave = req.headers['x-sync-key'];
        if (chave !== process.env.SYNC_KEY) {
            return res.status(401).json({ success: false, error: 'Chave inválida' });
        }

        const { chamados } = req.body;
        if (!Array.isArray(chamados) || chamados.length === 0) {
            return res.status(400).json({ success: false, error: 'Nenhum chamado enviado' });
        }

        const db = await openDb();
        let inseridos = 0;
        let atualizados = 0;
        let erros = 0;

        for (const c of chamados) {
            try {
                const existe = await db.get(
                    'SELECT id FROM chamados_cj WHERE protocolo = ?',
                    [c.protocolo]
                );

                if (existe) {
                    await db.run(`
                        UPDATE chamados_cj SET
                            vendedor = ?, id_cliente = ?, cliente_nome = ?,
                            cidade_uf = ?, produto = ?, codigo_produto = ?,
                            descricao_produto = ?, nota_marine = ?,
                            teste_receber = ?, teste_venda = ?, tempo_uso = ?,
                            descricao_defeito = ?, capacidade_loja = ?,
                            status = ?, decisao_tecnico = ?,
                            arquivos_json = ?, conversa = ?,
                            reaberto = ?, reaberto_em = ?, motivo_reabertura = ?,
                            data_atualizacao = ?
                        WHERE protocolo = ?
                    `, [
                        c.vendedor, c.id_cliente, c.cliente_nome,
                        c.cidade_uf, c.produto, c.codigo_produto,
                        c.descricao_produto, c.nota_marine,
                        c.teste_receber, c.teste_venda, c.tempo_uso,
                        c.descricao_defeito, c.capacidade_loja,
                        c.status, c.decisao_tecnico,
                        c.arquivos_json, c.conversa,
                        c.reaberto, c.reaberto_em, c.motivo_reabertura,
                        c.data_atualizacao || new Date().toISOString(),
                        c.protocolo
                    ]);
                    atualizados++;
                } else {
                    await db.run(`
                        INSERT INTO chamados_cj (
                            protocolo, vendedor, id_cliente, cliente_nome,
                            cidade_uf, produto, codigo_produto, descricao_produto,
                            nota_marine, teste_receber, teste_venda, tempo_uso,
                            descricao_defeito, capacidade_loja, status,
                            decisao_tecnico, arquivos_json, conversa,
                            reaberto, reaberto_em, motivo_reabertura,
                            data_criacao, data_atualizacao
                        ) VALUES (
                            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                            ?, ?, ?, ?, ?, ?, ?
                        )
                    `, [
                        c.protocolo, c.vendedor, c.id_cliente, c.cliente_nome,
                        c.cidade_uf, c.produto, c.codigo_produto, c.descricao_produto,
                        c.nota_marine, c.teste_receber, c.teste_venda, c.tempo_uso,
                        c.descricao_defeito, c.capacidade_loja, c.status,
                        c.decisao_tecnico, c.arquivos_json, c.conversa,
                        c.reaberto, c.reaberto_em, c.motivo_reabertura,
                        c.data_criacao || new Date().toISOString(),
                        c.data_atualizacao || new Date().toISOString()
                    ]);
                    inseridos++;
                }
            } catch (err) {
                console.error('❌ Erro ao sincronizar protocolo', c.protocolo, ':', err.message);
                erros++;
            }
        }

        console.log(`🔄 Sync: ${inseridos} inseridos, ${atualizados} atualizados, ${erros} erros`);

        res.json({
            success: true,
            inseridos,
            atualizados,
            erros,
            total: chamados.length
        });

    } catch (error) {
        console.error('❌ Erro no sync:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 🚀 INICIALIZAÇÃO
// ================================================================

(async () => {
    try {
        await openDb();
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
            console.log(`📄 Admin: http://localhost:${PORT}/`);
            console.log(`📄 Garantia (vendedor): http://localhost:${PORT}/garantia`);
            console.log(`📄 Técnico: http://localhost:${PORT}/angelo`);
        });
    } catch (error) {
        console.error('❌ Erro ao iniciar:', error);
        process.exit(1);
    }
})();