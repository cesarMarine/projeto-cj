// server.js
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import openDb from './database.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3200;

// ===== SUPABASE (para storage) =====
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
let supabase = null;

if (SUPABASE_URL && SUPABASE_KEY) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client configurado');
} else {
    console.warn('⚠️ SUPABASE_URL ou SUPABASE_KEY não configurados — uploads vão falhar');
}

// ===== MULTER (upload em memória) =====
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 } // 100MB
});
// ===== RESEND (envio de e-mail) =====
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const RESEND_FROM = process.env.RESEND_FROM || 'Marine Assistência <onboarding@resend.dev>';

if (resend) {
    console.log('✅ Resend configurado');
} else {
    console.warn('⚠️ RESEND_API_KEY não configurada — e-mails não serão enviados');
}

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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/garantia', (req, res) => {
    res.sendFile(path.join(__dirname, 'garantia.html'));
});

app.get('/tecnico', (req, res) => {
    res.sendFile(path.join(__dirname, 'tecnico.html'));
});

app.get('/angelo', (req, res) => {
    res.sendFile(path.join(__dirname, 'tecnico.html'));
});

app.get('/api/teste', (req, res) => {
    res.json({ success: true, mensagem: 'Servidor funcionando!', timestamp: new Date().toISOString() });
});

// ================================================================
// 📤 UPLOAD PARA SUPABASE STORAGE
// ================================================================
async function uploadArquivoSupabase(buffer, nomeOriginal, mimetype, prefixo = 'arq') {
    if (!supabase) throw new Error('Supabase não configurado');

    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const nomeLimpo = nomeOriginal.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const fileName = `${prefixo}/${timestamp}_${random}_${nomeLimpo}`;

    const { error } = await supabase.storage
        .from('anexos-chamados-cj')
        .upload(fileName, buffer, {
            contentType: mimetype,
            upsert: true
        });

    if (error) throw new Error(`Erro upload: ${error.message}`);

    const { data } = supabase.storage
        .from('anexos-chamados-cj')
        .getPublicUrl(fileName);

    return data.publicUrl;
}

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
// 📋 CRIAR NOVO CHAMADO (COM UPLOAD DE ARQUIVOS)
// ================================================================
app.post('/api/garantia/novo',
    upload.fields([
        { name: 'arquivos', maxCount: 5 },
        { name: 'notasCliente', maxCount: 10 }
    ]),
    async (req, res) => {
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

        // Processa uploads
        const arquivosUrls = [];
        const notasUrls = [];

        if (req.files && req.files['arquivos']) {
            for (const file of req.files['arquivos']) {
                try {
                    const url = await uploadArquivoSupabase(
                        file.buffer,
                        file.originalname,
                        file.mimetype,
                        `cj/${protocolo}/fotos`
                    );
                    arquivosUrls.push({
                        nome: file.originalname,
                        url: url,
                        tipo: file.mimetype,
                        tamanho: file.size,
                        categoria: 'foto_video'
                    });
                } catch (err) {
                    console.error('❌ Erro upload foto/vídeo:', err.message);
                }
            }
        }

        if (req.files && req.files['notasCliente']) {
            for (const file of req.files['notasCliente']) {
                try {
                    const url = await uploadArquivoSupabase(
                        file.buffer,
                        file.originalname,
                        file.mimetype,
                        `cj/${protocolo}/notas`
                    );
                    notasUrls.push({
                        nome: file.originalname,
                        url: url,
                        tipo: file.mimetype,
                        tamanho: file.size,
                        categoria: 'nota_cliente'
                    });
                } catch (err) {
                    console.error('❌ Erro upload nota:', err.message);
                }
            }
        }

        const todosArquivos = [...arquivosUrls, ...notasUrls];
        const conversaInicial = [{
            id: 'msg_' + Date.now(),
            remetente: 'Sistema',
            tipo: 'tecnico',
            mensagem: `Chamado criado com ${todosArquivos.length} arquivo(s) anexado(s).`,
            data: new Date().toLocaleString('pt-BR'),
            timestamp: Date.now(),
            lida: false
        }];

        // Busca o vendedor do cliente
        const clienteInfo = await db.get(
            'SELECT vendedor FROM clientes_cj WHERE codigo_cli = ?',
            [dados.cliente_id || '']
        );

        await db.run(`
            INSERT INTO chamados_cj (
                protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, descricao_produto, nota_marine,
                teste_receber, teste_venda, tempo_uso,
                descricao_defeito, capacidade_loja, status, origem,
                arquivos_json, conversa
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pendente', 'CJ', ?, ?)
        `, [
            protocolo,
            dados.vendedor,
            dados.cliente_id || '',
            dados.cliente_nome || '',
            clienteInfo?.vendedor || '',
            dados.produto || '',
            dados.codigo_produto || '',
            dados.descricao_produto || '',
            dados.nota_marine || '',
            dados.teste_receber || '',
            dados.teste_venda || '',
            dados.tempo_uso || '',
            dados.descricao_defeito || '',
            dados.capacidade_loja || '',
            todosArquivos,
            conversaInicial
        ]);

        const novoId = await db.get('SELECT id FROM chamados_cj WHERE protocolo = ?', [protocolo]);

        res.json({
            success: true,
            protocolo,
            id: novoId?.id,
            arquivos: todosArquivos.length,
            mensagem: 'Chamado criado com sucesso!'
        });

    } catch (error) {
        console.error('❌ Erro ao criar chamado:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📋 LISTAR CHAMADOS DE UM VENDEDOR
// ================================================================
app.get('/api/garantia/vendedor/:vendedor', async (req, res) => {
    try {
        const db = await openDb();
        const vendedor = req.params.vendedor;

        const chamados = await db.all(`
            SELECT 
                id, protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, descricao_produto, nota_marine,
                status, data_criacao, decisao_tecnico,
                conversa, arquivos_json
            FROM chamados_cj
            WHERE vendedor = ?
            ORDER BY data_criacao DESC
        `, [vendedor]);

        const chamadosComNaoLidas = chamados.map(c => {
            let naoLidas = 0;
            try {
                const conversa = Array.isArray(c.conversa) ? c.conversa : JSON.parse(c.conversa || '[]');
                naoLidas = conversa.filter(m => m.tipo === 'tecnico' && !m.lida).length;
            } catch(e) {}
            return { ...c, msg_nao_lidas: naoLidas };
        });

        res.json({ success: true, chamados: chamadosComNaoLidas });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📋 LISTAR TODOS OS CHAMADOS (TÉCNICO) - aceita filtro por origem
// ================================================================
app.get('/api/garantia/todos', async (req, res) => {
    try {
        const db = await openDb();
        const { origem } = req.query;

        let sql = `
            SELECT 
                id, protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                produto, codigo_produto, descricao_produto, nota_marine, status,
                data_criacao, decisao_tecnico, conversa, arquivos_json,
                reaberto, reaberto_em, motivo_reabertura, origem
            FROM chamados_cj
        `;

        if (origem === 'CJ') {
            sql += ` WHERE origem = 'CJ'`;
        } else if (origem === 'MARINE') {
            sql += ` WHERE (origem IS NULL OR origem != 'CJ')`;
        }

        sql += ` ORDER BY data_criacao DESC`;

        const chamados = await db.all(sql);
        res.json({ success: true, chamados });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📋 BUSCAR DETALHES DE UM CHAMADO (COM ARQUIVOS)
// ================================================================
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

        // Arquivos vêm do campo arquivos_json (array de objetos com URL)
        let arquivos = [];
        try {
            arquivos = Array.isArray(chamado.arquivos_json)
                ? chamado.arquivos_json
                : JSON.parse(chamado.arquivos_json || '[]');
        } catch(e) { arquivos = []; }

        res.json({ success: true, garantia: chamado, arquivos: arquivos });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📋 ATUALIZAR STATUS
// ================================================================
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
            conversa = Array.isArray(result.conversa) ? result.conversa : JSON.parse(result.conversa || '[]');
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
        `, [conversa, req.params.protocolo]);

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
        try {
            conversa = Array.isArray(result.conversa) ? result.conversa : JSON.parse(result.conversa || '[]');
        } catch (e) { conversa = []; }

        const tipoOp = tipoUsuario === 'vendedor' ? 'tecnico' : 'vendedor';
        conversa = conversa.map(msg => {
            if (msg.tipo === tipoOp && !msg.lida) return { ...msg, lida: true };
            return msg;
        });

        await db.run('UPDATE chamados_cj SET conversa = ? WHERE protocolo = ?', [conversa, req.params.protocolo]);
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
            try {
                conversa = Array.isArray(c.conversa) ? c.conversa : JSON.parse(c.conversa || '[]');
            } catch (e) {}
            const naoLidas = conversa.filter(m => m.tipo === 'tecnico' && !m.lida).length;
            return { ...c, nao_lidas: naoLidas };
        }).filter(c => c.nao_lidas > 0);

        res.json({ success: true, chamados: comNaoLidas });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📊 ADMIN - RELATÓRIO DE CHAMADOS
// ================================================================
app.get('/api/admin/relatorio-chamados', async (req, res) => {
    try {
        const db = await openDb();

        const {
            vendedor, status, data_inicio, data_fim, busca, produto, cliente,
            origem
        } = req.query;

        let sql = `
            SELECT 
                id, protocolo, vendedor, id_cliente, cliente_nome, vendedor_cliente,
                cidade_uf, produto, codigo_produto, descricao_produto, nota_marine,
                teste_receber, teste_venda, tempo_uso, descricao_defeito,
                capacidade_loja, status, decisao_tecnico,
                reaberto, reaberto_em, motivo_reabertura,
                data_criacao, data_atualizacao, origem
            FROM chamados_cj
        `;

        const wheres = [];

        if (origem === 'CJ') {
            wheres.push(`origem = 'CJ'`);
        } else if (origem === 'MARINE') {
            wheres.push(`(origem IS NULL OR origem != 'CJ')`);
        }

        if (wheres.length) {
            sql += ' WHERE ' + wheres.join(' AND ');
        }

        sql += ` ORDER BY data_criacao DESC`;

        const chamados = await db.all(sql);

        let filtrados = chamados;

        if (vendedor) filtrados = filtrados.filter(c => c.vendedor === vendedor);
        if (status) filtrados = filtrados.filter(c => c.status === status);
        if (produto) {
            const p = produto.toLowerCase();
            filtrados = filtrados.filter(c =>
                (c.produto || '').toLowerCase().includes(p) ||
                (c.descricao_produto || '').toLowerCase().includes(p)
            );
        }
        if (cliente) filtrados = filtrados.filter(c => String(c.id_cliente) === String(cliente));
        if (data_inicio) {
            filtrados = filtrados.filter(c => {
                const d = c.data_criacao instanceof Date
                    ? c.data_criacao.toISOString().slice(0, 10)
                    : (c.data_criacao || '').slice(0, 10);
                return d >= data_inicio;
            });
        }
        if (data_fim) {
            filtrados = filtrados.filter(c => {
                const d = c.data_criacao instanceof Date
                    ? c.data_criacao.toISOString().slice(0, 10)
                    : (c.data_criacao || '').slice(0, 10);
                return d <= data_fim;
            });
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

        res.json({ success: true, total: filtrados.length, chamados: filtrados });

    } catch (error) {
        console.error('❌ Erro no relatório:', error);
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
// 👥 ADMIN - PESSOAS (VENDEDORES E CONTATOS)
// ================================================================

// ----- VENDEDORES -----

// Listar vendedores
app.get('/api/admin/vendedores', async (req, res) => {
    try {
        const db = await openDb();
        const vendedores = await db.all(`
            SELECT id, nome, senha, ativo, data_criacao, data_atualizacao
            FROM pessoas_cj
            WHERE tipo = 'vendedor'
            ORDER BY nome ASC
        `);
        res.json({ success: true, vendedores });
    } catch (error) {
        console.error('❌ Erro ao listar vendedores:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cadastrar vendedor
app.post('/api/admin/vendedores', async (req, res) => {
    try {
        const { nome, senha } = req.body;

        if (!nome || !senha) {
            return res.status(400).json({ success: false, error: 'Nome e senha são obrigatórios' });
        }

        const db = await openDb();

        // Verifica se já existe
        const existe = await db.get(
            'SELECT id FROM pessoas_cj WHERE tipo = ? AND LOWER(nome) = LOWER(?)',
            ['vendedor', nome.trim()]
        );

        if (existe) {
            return res.status(400).json({ success: false, error: 'Já existe um vendedor com esse nome' });
        }

        const result = await db.run(`
            INSERT INTO pessoas_cj (tipo, nome, senha, ativo)
            VALUES ('vendedor', ?, ?, TRUE)
        `, [nome.trim(), senha.trim()]);

        res.json({ success: true, mensagem: 'Vendedor cadastrado com sucesso!' });
    } catch (error) {
        console.error('❌ Erro ao cadastrar vendedor:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Editar vendedor (só o nome)
app.put('/api/admin/vendedores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, ativo } = req.body;

        const db = await openDb();

        const campos = [];
        const valores = [];

        if (nome !== undefined) { campos.push('nome = ?'); valores.push(nome.trim()); }
        if (ativo !== undefined) { campos.push('ativo = ?'); valores.push(ativo); }

        if (campos.length === 0) {
            return res.status(400).json({ success: false, error: 'Nada para atualizar' });
        }

        campos.push('data_atualizacao = CURRENT_TIMESTAMP');
        valores.push(id);

        await db.run(`
            UPDATE pessoas_cj
            SET ${campos.join(', ')}
            WHERE id = ? AND tipo = 'vendedor'
        `, valores);

        res.json({ success: true, mensagem: 'Vendedor atualizado!' });
    } catch (error) {
        console.error('❌ Erro ao editar vendedor:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Resetar senha do vendedor
app.put('/api/admin/vendedores/:id/senha', async (req, res) => {
    try {
        const { id } = req.params;
        const { senha } = req.body;

        if (!senha) {
            return res.status(400).json({ success: false, error: 'Senha obrigatória' });
        }

        const db = await openDb();
        await db.run(`
            UPDATE pessoas_cj
            SET senha = ?, data_atualizacao = CURRENT_TIMESTAMP
            WHERE id = ? AND tipo = 'vendedor'
        `, [senha.trim(), id]);

        res.json({ success: true, mensagem: 'Senha alterada!' });
    } catch (error) {
        console.error('❌ Erro ao resetar senha:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deletar vendedor
app.delete('/api/admin/vendedores/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = await openDb();
        await db.run(`DELETE FROM pessoas_cj WHERE id = ? AND tipo = 'vendedor'`, [id]);
        res.json({ success: true, mensagem: 'Vendedor deletado!' });
    } catch (error) {
        console.error('❌ Erro ao deletar vendedor:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ----- CONTATOS -----

// Listar contatos
app.get('/api/admin/contatos', async (req, res) => {
    try {
        const db = await openDb();
        const contatos = await db.all(`
            SELECT id, nome, email, ativo, data_criacao, data_atualizacao
            FROM pessoas_cj
            WHERE tipo = 'contato'
            ORDER BY nome ASC
        `);
        res.json({ success: true, contatos });
    } catch (error) {
        console.error('❌ Erro ao listar contatos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Cadastrar contato
app.post('/api/admin/contatos', async (req, res) => {
    try {
        const { nome, email } = req.body;

        if (!nome || !email) {
            return res.status(400).json({ success: false, error: 'Nome e e-mail são obrigatórios' });
        }

        // Valida e-mail básico
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, error: 'E-mail inválido' });
        }

        const db = await openDb();

        const existe = await db.get(
            'SELECT id FROM pessoas_cj WHERE tipo = ? AND LOWER(email) = LOWER(?)',
            ['contato', email.trim()]
        );

        if (existe) {
            return res.status(400).json({ success: false, error: 'Já existe um contato com esse e-mail' });
        }

        await db.run(`
            INSERT INTO pessoas_cj (tipo, nome, email, ativo)
            VALUES ('contato', ?, ?, TRUE)
        `, [nome.trim(), email.trim().toLowerCase()]);

        res.json({ success: true, mensagem: 'Contato cadastrado com sucesso!' });
    } catch (error) {
        console.error('❌ Erro ao cadastrar contato:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Editar contato
app.put('/api/admin/contatos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { nome, email, ativo } = req.body;

        const db = await openDb();

        const campos = [];
        const valores = [];

        if (nome !== undefined) { campos.push('nome = ?'); valores.push(nome.trim()); }
        if (email !== undefined) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return res.status(400).json({ success: false, error: 'E-mail inválido' });
            }
            campos.push('email = ?');
            valores.push(email.trim().toLowerCase());
        }
        if (ativo !== undefined) { campos.push('ativo = ?'); valores.push(ativo); }

        if (campos.length === 0) {
            return res.status(400).json({ success: false, error: 'Nada para atualizar' });
        }

        campos.push('data_atualizacao = CURRENT_TIMESTAMP');
        valores.push(id);

        await db.run(`
            UPDATE pessoas_cj
            SET ${campos.join(', ')}
            WHERE id = ? AND tipo = 'contato'
        `, valores);

        res.json({ success: true, mensagem: 'Contato atualizado!' });
    } catch (error) {
        console.error('❌ Erro ao editar contato:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Deletar contato
app.delete('/api/admin/contatos/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const db = await openDb();
        await db.run(`DELETE FROM pessoas_cj WHERE id = ? AND tipo = 'contato'`, [id]);
        res.json({ success: true, mensagem: 'Contato deletado!' });
    } catch (error) {
        console.error('❌ Erro ao deletar contato:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 📤 CHAMAR CONTATO NO CASO (técnico → contato via e-mail)
// ================================================================
// ================================================================
// 📤 CHAMAR CONTATO(S) NO CASO (técnico → contatos via e-mail)
// ================================================================
app.post('/api/garantia/chamar-contato/:protocolo', async (req, res) => {
    try {
        const { protocolo } = req.params;
        const { contatos_ids, mensagem } = req.body;

        // Validação — aceita array
        if (!Array.isArray(contatos_ids) || contatos_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'Selecione pelo menos um contato' });
        }

        const db = await openDb();

        // Busca o chamado
        const chamado = await db.get('SELECT * FROM chamados_cj WHERE protocolo = ?', [protocolo]);
        if (!chamado) {
            return res.status(404).json({ success: false, error: 'Chamado não encontrado' });
        }

        // Parse da lista de envolvidos
        let envolvidos = [];
        try {
            envolvidos = Array.isArray(chamado.envolvidos)
                ? chamado.envolvidos
                : JSON.parse(chamado.envolvidos || '[]');
        } catch(e) { envolvidos = []; }

        const mensagemFinal = mensagem?.trim() || 'Você foi chamado para dar sua opinião neste caso.';
        const baseUrl = process.env.BASE_URL || 'https://projeto-cj.onrender.com';

        const enviados = [];
        const erros = [];

        // Loop — envia pra cada contato
        for (const contatoId of contatos_ids) {
            try {
                // Busca o contato
                const contato = await db.get(
                    "SELECT id, nome, email FROM pessoas_cj WHERE id = ? AND tipo = 'contato' AND ativo = TRUE",
                    [contatoId]
                );

                if (!contato) {
                    erros.push({ contato_id: contatoId, erro: 'Contato não encontrado ou inativo' });
                    continue;
                }

                // Verifica se já foi chamado e está aguardando
                const jaAguardando = envolvidos.find(e => 
                    e.contato_id === contato.id && e.status === 'aguardando'
                );
                if (jaAguardando) {
                    erros.push({ contato_id: contatoId, nome: contato.nome, erro: 'Já convidado e aguardando resposta' });
                    continue;
                }

                // Gera token único
                const token = crypto.randomBytes(16).toString('hex');

                // Adiciona na lista
                const novoEnvolvido = {
                    contato_id: contato.id,
                    nome: contato.nome,
                    email: contato.email,
                    token,
                    mensagem: mensagemFinal,
                    resposta: null,
                    status: 'aguardando',
                    data_envio: new Date().toISOString(),
                    data_resposta: null
                };

                envolvidos.push(novoEnvolvido);

                // Link único
                const link = `${baseUrl}/contato?chamado=${encodeURIComponent(protocolo)}&token=${token}`;

                // Envia e-mail
                if (resend) {
                    try {
                        const { data: emailData, error: emailError } = await resend.emails.send({
                            from: RESEND_FROM,
                            to: [contato.email],
                            subject: `[${protocolo}] ${chamado.cliente_nome || ''} - ${chamado.produto || ''}`.trim(),
                            html: `
                                <div style="font-family: Arial, sans-serif; color: #1a2a3a; max-width: 600px; margin: 0 auto; border: 1px solid #e8edf3; border-radius: 12px; padding: 24px;">
                                    <div style="background: linear-gradient(135deg, #0a2a4a 0%, #0d3b66 100%); padding: 16px 24px; border-radius: 8px; color: white; text-align: center; margin-bottom: 20px;">
                                        <h2 style="margin: 0; font-size: 1.2rem;">📋 Você foi chamado em um caso</h2>
                                    </div>
                                    
                                    <p>Olá, <strong>${contato.nome}</strong>!</p>
                                    
                                    <p>O técnico solicitou sua participação neste chamado:</p>
                                    
                                    <div style="background: #f8fafc; border-left: 4px solid #0d3b66; padding: 16px; border-radius: 6px; margin: 20px 0;">
                                        <p style="margin: 0 0 8px 0;"><strong>📋 Protocolo:</strong> ${protocolo}</p>
                                        <p style="margin: 0 0 8px 0;"><strong>👤 Cliente:</strong> ${chamado.cliente_nome || 'N/A'}</p>
                                        <p style="margin: 0 0 8px 0;"><strong>🎣 Produto:</strong> ${chamado.produto || 'N/A'}</p>
                                        <p style="margin: 0;"><strong>📝 Defeito:</strong> ${chamado.descricao_defeito || 'Não informado'}</p>
                                    </div>
                                    
                                    <div style="background: #fffdf5; border: 2px dashed #f8b81f; border-radius: 8px; padding: 16px; margin: 20px 0;">
                                        <p style="margin: 0; font-weight: bold; color: #0d3b66;">💬 Mensagem do Técnico:</p>
                                        <p style="margin: 8px 0 0 0; color: #2d3f4f;">"${mensagemFinal}"</p>
                                    </div>
                                    
                                    <div style="text-align: center; margin: 30px 0;">
                                        <a href="${link}" style="background: #0d3b66; color: white; text-decoration: none; padding: 14px 32px; border-radius: 30px; font-weight: bold; display: inline-block;">
                                            🔍 Ver Chamado e Responder
                                        </a>
                                    </div>
                                    
                                    <p style="font-size: 0.8rem; color: #6b7a8a;">Ou copie este link no navegador:</p>
                                    <p style="font-size: 0.75rem; color: #2563eb; word-break: break-all;">${link}</p>
                                    
                                    <hr style="border: 0; border-top: 1px solid #e8edf3; margin-top: 24px;">
                                    <p style="font-size: 0.8rem; color: #6b7a8a; text-align: center;">Marine Fishing — Assistência Técnica</p>
                                </div>
                            `
                        });

                        if (emailError) {
                            console.error('❌ Resend REJEITOU para', contato.email, ':', JSON.stringify(emailError));
                            // Remove da lista pra não ficar inconsistente
                            envolvidos = envolvidos.filter(e => e.token !== token);
                            erros.push({ contato_id: contatoId, nome: contato.nome, erro: 'Erro no envio: ' + (emailError.message || 'desconhecido') });
                        } else {
                            console.log(`📧 E-mail enviado para ${contato.email} — ID: ${emailData?.id}`);
                            enviados.push({ id: contato.id, nome: contato.nome, email: contato.email });
                        }
                    } catch (emailErr) {
                        console.error('❌ Erro ao enviar e-mail:', emailErr.message);
                        envolvidos = envolvidos.filter(e => e.token !== token);
                        erros.push({ contato_id: contatoId, nome: contato.nome, erro: emailErr.message });
                    }
                } else {
                    // Sem Resend configurado, adiciona mesmo assim
                    enviados.push({ id: contato.id, nome: contato.nome, email: contato.email });
                }
            } catch (errContato) {
                console.error('❌ Erro ao processar contato', contatoId, ':', errContato.message);
                erros.push({ contato_id: contatoId, erro: errContato.message });
            }
        }

        // Salva no banco
        await db.run(
            'UPDATE chamados_cj SET envolvidos = ?, data_atualizacao = CURRENT_TIMESTAMP WHERE protocolo = ?',
            [envolvidos, protocolo]
        );

        // Monta resposta
        let msg = '';
        if (enviados.length > 0) {
            msg += `✅ ${enviados.length} e-mail(s) enviado(s): ${enviados.map(e => e.nome).join(', ')}`;
        }
        if (erros.length > 0) {
            if (msg) msg += '\n';
            msg += `⚠️ ${erros.length} erro(s): ${erros.map(e => `${e.nome || e.contato_id} (${e.erro})`).join(', ')}`;
        }

        res.json({
            success: enviados.length > 0,
            mensagem: msg,
            enviados,
            erros
        });

    } catch (error) {
        console.error('❌ Erro ao chamar contatos:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 🔍 CONTATO — VER CHAMADO (via token do e-mail)
// ================================================================
app.get('/api/contato/ver/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const db = await openDb();

        // Busca em TODOS os chamados (o token é único)
        const chamados = await db.all('SELECT * FROM chamados_cj WHERE envolvidos IS NOT NULL');

        let chamadoEncontrado = null;
        let envolvidoEncontrado = null;

        for (const c of chamados) {
            let envolvidos = [];
            try {
                envolvidos = Array.isArray(c.envolvidos) ? c.envolvidos : JSON.parse(c.envolvidos || '[]');
            } catch(e) { envolvidos = []; }

            const env = envolvidos.find(e => e.token === token);
            if (env) {
                chamadoEncontrado = c;
                envolvidoEncontrado = env;
                break;
            }
        }

        if (!chamadoEncontrado) {
            return res.status(404).json({ success: false, error: 'Link inválido ou expirado' });
        }

        // Retorna dados do chamado (SEM o chat técnico↔vendedor)
        res.json({
            success: true,
            chamado: {
                protocolo: chamadoEncontrado.protocolo,
                cliente_nome: chamadoEncontrado.cliente_nome,
                id_cliente: chamadoEncontrado.id_cliente,
                cidade_uf: chamadoEncontrado.cidade_uf,
                produto: chamadoEncontrado.produto,
                codigo_produto: chamadoEncontrado.codigo_produto,
                descricao_produto: chamadoEncontrado.descricao_produto,
                nota_marine: chamadoEncontrado.nota_marine,
                descricao_defeito: chamadoEncontrado.descricao_defeito,
                data_criacao: chamadoEncontrado.data_criacao,
                status: chamadoEncontrado.status,
                arquivos_json: chamadoEncontrado.arquivos_json
            },
            envolvido: envolvidoEncontrado
        });

    } catch (error) {
        console.error('❌ Erro ao buscar chamado pelo token:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ================================================================
// 💬 CONTATO — RESPONDER (via token)
// ================================================================
// ================================================================
// 💬 CONTATO — RESPONDER (via token)
// ================================================================
app.post('/api/contato/responder/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const { resposta } = req.body;

        if (!resposta?.trim()) {
            return res.status(400).json({ success: false, error: 'Digite uma resposta' });
        }

        const db = await openDb();
        const chamados = await db.all('SELECT * FROM chamados_cj WHERE envolvidos IS NOT NULL');

        let chamadoEncontrado = null;
        let envolvidosAtualizado = null;
        let envolvidoAtual = null;

        for (const c of chamados) {
            let envolvidos = [];
            try {
                envolvidos = Array.isArray(c.envolvidos) ? c.envolvidos : JSON.parse(c.envolvidos || '[]');
            } catch(e) { envolvidos = []; }

            const index = envolvidos.findIndex(e => e.token === token);
            if (index > -1) {
                envolvidos[index].resposta = resposta.trim();
                envolvidos[index].status = 'respondeu';
                envolvidos[index].data_resposta = new Date().toISOString();
                chamadoEncontrado = c;
                envolvidosAtualizado = envolvidos;
                envolvidoAtual = envolvidos[index];
                break;
            }
        }

        if (!chamadoEncontrado) {
            return res.status(404).json({ success: false, error: 'Link inválido' });
        }

        // Verifica se está encerrado
        if (chamadoEncontrado.status === 'Aprovado' || chamadoEncontrado.status === 'Recusado') {
            return res.status(400).json({ success: false, error: 'Este chamado já foi encerrado pela equipe técnica' });
        }

        // Adiciona a resposta no histórico (conversa)
        let conversa = [];
        try {
            conversa = Array.isArray(chamadoEncontrado.conversa)
                ? [...chamadoEncontrado.conversa]
                : JSON.parse(chamadoEncontrado.conversa || '[]');
        } catch(e) { conversa = []; }

        conversa.push({
            id: 'msg_' + Date.now(),
            remetente: envolvidoAtual.nome,
            tipo: 'contato',
            mensagem: resposta.trim(),
            data: new Date().toLocaleString('pt-BR'),
            timestamp: Date.now(),
            lida: false
        });

        // Salva os dois: envolvidos + conversa
        await db.run(
            'UPDATE chamados_cj SET envolvidos = ?, conversa = ?, data_atualizacao = CURRENT_TIMESTAMP WHERE protocolo = ?',
            [envolvidosAtualizado, conversa, chamadoEncontrado.protocolo]
        );

        res.json({ success: true, mensagem: 'Resposta enviada com sucesso!' });

    } catch (error) {
        console.error('❌ Erro ao responder como contato:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/contato', (req, res) => {
    res.sendFile(path.join(__dirname, 'contato.html'));
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