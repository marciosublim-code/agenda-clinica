// ====== TOAST GLOBAL ======
// Pequena notificação no canto da tela. Usada em várias partes do sistema
// (ex: copiarLinkPortal, exclusão de paciente, etc).
function showToast(msg, tipo) {
    const cores = {
        sucesso: '#065f46',
        erro:    '#991b1b',
        aviso:   '#92400e'
    };
    const cor = cores[tipo] || cores.sucesso;
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;bottom:2rem;right:2rem;background:${cor};color:#fff;padding:.75rem 1.25rem;border-radius:.5rem;font-size:.85rem;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.2);max-width:320px;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
}

// ====== ELECTRON IPC ======
let ipcRenderer = null;
try {
    if (window.require) {
        ipcRenderer = window.require('electron').ipcRenderer;

    }
} catch (e) {
    console.log("Electron não detectado.", e);
}

// ====== HELPER: chamar main process via IPC ======
async function ipc(canal, dados) {
    if (!ipcRenderer) return null;
    return await ipcRenderer.invoke(canal, dados);
}

// ====== VARIÁVEIS GLOBAIS EM MEMÓRIA ======
let pacientes  = [];
let pagamentos = [];
let consultas  = [];
let usuarios   = [];

let statusFiltroFinanceiroAtual = 'Todos';
let dadosAtestadoTemporario = null;
let indexPagamentoEdicao = -1;
let usuarioLogado = JSON.parse(sessionStorage.getItem('usuarioLogado')) || null;

// Ordena pacientes por nome, tratando acentos e maiúsculas/minúsculas
// corretamente (SQLite por padrão ordena por byte, então "Álvaro" ou "ana"
// acabavam fora de ordem mesmo com ORDER BY nome ASC no banco).
function ordenarPacientesAlfabetico(lista) {
    return (lista || []).sort((a, b) =>
        (a.nome || '').localeCompare(b.nome || '', 'pt-BR', { sensitivity: 'base' })
    );
}

// ====== CARREGAR DADOS DO BANCO ======
async function carregarDadosDoBanco() {
    pacientes  = ordenarPacientesAlfabetico(await ipc('db-listar-pacientes'));
    pagamentos = await ipc('db-todos-pagamentos')  || [];
    consultas  = await ipc('db-todas-consultas')   || [];
    usuarios   = await ipc('db-listar-usuarios')   || [];
    // Atualiza nome da clínica em todos os pontos do HTML
    try {
        const cfg = await ipc('db-get-config') || {};
        const nome = cfg.nome_clinica || 'InnerCare';
        ['login-nome-clinica', 'topbar-nome-clinica'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = nome;
        });
    } catch(e) {}
}

// ====== MIGRAÇÃO AUTOMÁTICA DO localStorage → SQLite ======
async function migrarLocalStorageSeNecessario() {
    if (!ipcRenderer) return;
    // Verifica se já tem dados no banco (inclui inativos!)
    const todosP = await ipc('db-listar-pacientes');
    if (todosP && todosP.length > 0) return; // Já migrado

    // Verifica se tem dados no localStorage para migrar
    const lsPacientes = localStorage.getItem('pacientes');
    if (!lsPacientes) return;

    try {
        const banco = {
            pacientes:           JSON.parse(localStorage.getItem('pacientes'))           || [],
            pagamentos:          JSON.parse(localStorage.getItem('pagamentos'))          || [],
            consultas:           JSON.parse(localStorage.getItem('consultas'))           || [],
            agenda_agendamentos: JSON.parse(localStorage.getItem('agenda_agendamentos')) || [],
            agenda_tokens:       JSON.parse(localStorage.getItem('agenda_tokens'))       || {},
            usuarios:            JSON.parse(localStorage.getItem('usuarios'))            || []
        };

        if (banco.pacientes.length === 0) return;

        const resultado = await ipc('db-migrar', JSON.stringify(banco));
        if (resultado && resultado.ok) {
            console.log('Migração do localStorage concluída!');
            // Limpa localStorage após migração
            ['pacientes','pagamentos','consultas','agenda_agendamentos','agenda_tokens','usuarios']
                .forEach(k => localStorage.removeItem(k));
        }
    } catch(e) {
        console.error('Erro na migração:', e);
    }
}

// ====== LISTENERS DRIVE ======
if (ipcRenderer) {
    ipcRenderer.on('drive-backup-baixado', async (event, data) => {
        if (!data.ok) { esconderTelaRestauracao(); return; }
        try {
            const banco = JSON.parse(data.conteudo);
            if (!banco.pacientes) { esconderTelaRestauracao(); return; }
            await ipc('db-migrar', JSON.stringify(banco));
            await carregarDadosDoBanco();
            esconderTelaRestauracao();
            mostrarToastRestauracao(data.modificado);
            verificarSessao();
            if (usuarioLogado && usuarioLogado.email) verificarLicencaAposLogin(usuarioLogado.email);
        } catch(e) {
            console.error('Erro ao aplicar backup do Drive:', e);
            esconderTelaRestauracao();
        }
    });

    ipcRenderer.on('restaurar-backup-local-resposta', async (event, data) => {
        if (!data.ok) { esconderTelaRestauracao(); return; }
        try {
            const banco = JSON.parse(data.conteudo);
            if (!banco.pacientes) { esconderTelaRestauracao(); return; }
            await ipc('db-migrar', JSON.stringify(banco));
            await carregarDadosDoBanco();
            esconderTelaRestauracao();
            mostrarToastRestauracao(data.modificado, 'local');
            verificarSessao();
            if (usuarioLogado && usuarioLogado.email) verificarLicencaAposLogin(usuarioLogado.email);
        } catch(e) {
            console.error('Erro ao aplicar backup local:', e);
            esconderTelaRestauracao();
        }
    });
}

function esconderTelaRestauracao() {
    const overlay = document.getElementById('overlay-restauracao-drive');
    if (overlay) overlay.style.display = 'none';
}

function mostrarToastRestauracao(dataModificado, origem) {
    const data = dataModificado ? new Date(dataModificado).toLocaleString('pt-BR') : '';
    const isDrive = origem !== 'local';
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed;bottom:2rem;right:2rem;background:#065f46;color:#fff;padding:1rem 1.5rem;border-radius:0.5rem;font-size:0.9rem;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    const icone = isDrive ? 'fa-brands fa-google-drive' : 'fa-solid fa-folder-open';
    const origemLabel = isDrive ? 'Google Drive' : 'backup local';
    toast.innerHTML = `<i class="${icone}"></i> Dados restaurados do ${origemLabel}${data ? ' (' + data + ')' : ''}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 5000);
}

function dispararAtualizacaoPdf(pacienteId, nomePaciente) {
    if (ipcRenderer) {
        ipcRenderer.send('gerar-pdf-automatico', { id: pacienteId, nome: nomePaciente });
    }
}

function sincronizarBackupDrive() {
    if (!ipcRenderer) return;
    setTimeout(async () => {
        const banco = await ipc('db-exportar');
        if (!banco) return;
        const dadosJson = JSON.stringify(banco);
        ipcRenderer.send('salvar-backup-local', { dadosJson });
        ipcRenderer.send('drive-verificar');
        ipcRenderer.once('drive-status-verificado', (event, { conectado }) => {
            if (conectado) ipcRenderer.send('drive-upload-backup-json', { dadosJson });
        });
    }, 1500);
}

// ====== SISTEMA DE LICENÇA ======
// URL raw do GitHub — repositório PÚBLICO (sem token). Privacidade é garantida
// pelo hash SHA-256 do e-mail: o JSON não guarda e-mail em texto puro.
const LICENCA_GITHUB_RAW = 'https://raw.githubusercontent.com/marciosublim-code/clientes.json/main/clientes.json';

// Chaves usadas na tabela configuracoes do banco local
const LICENCA_CHAVE_VENCIMENTO  = 'licenca_vencimento';   // ex: "2025-12-31"
const LICENCA_CHAVE_STATUS      = 'licenca_status';        // "ativo" | "inativo"
const LICENCA_CHAVE_ATUALIZADO  = 'licenca_atualizado_em'; // ISO timestamp da última sync

/* ── Lê o vencimento salvo localmente no banco ─────────── */
async function licencaLerLocal() {
    try {
        const cfg = await ipc('db-get-config');
        if (!cfg) return null;
        const vencimento = cfg[LICENCA_CHAVE_VENCIMENTO];
        const status     = cfg[LICENCA_CHAVE_STATUS];
        if (!vencimento || !status) return null;
        return { vencimento, status };
    } catch (e) {
        return null;
    }
}

/* ── Salva o vencimento no banco local ─────────────────── */
async function licencaSalvarLocal(vencimento, status) {
    try {
        await ipc('db-salvar-config', {
            [LICENCA_CHAVE_VENCIMENTO]: vencimento,
            [LICENCA_CHAVE_STATUS]:     status,
            [LICENCA_CHAVE_ATUALIZADO]: new Date().toISOString()
        });
    } catch (e) {
        console.warn('Licença: erro ao salvar no banco:', e);
    }
}

/* ── Gera o hash SHA-256 (hex) do e-mail, normalizado ──── */
async function licencaHashEmail(email) {
    const normalizado = String(email || '').trim().toLowerCase();
    const encoder = new TextEncoder();
    const dados = encoder.encode(normalizado);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dados);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ── Calcula resultado a partir de uma data de vencimento ─ */
function licencaCalcularResultado(vencimento) {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dataVenc = new Date(vencimento + 'T00:00:00');
    const diffMs = dataVenc - hoje;
    const diasRestantes = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diasRestantes > 7)  return { status: 'ok',       diasRestantes, dataVencimento: vencimento };
    if (diasRestantes >= 0) return { status: 'aviso',    diasRestantes, dataVencimento: vencimento };
    return                         { status: 'bloqueado', diasRestantes: 0, dataVencimento: vencimento };
}

/* ── Verificação principal ─────────────────────────────── */
async function verificarLicenca(emailUsuario) {
    // 1. Tenta buscar no GitHub (repositório público, sem token)
    try {
        const headers = { 'Cache-Control': 'no-cache' };

        const resp = await fetch(LICENCA_GITHUB_RAW + '?nocache=' + Date.now(), { headers });

        if (resp.ok) {
            const texto = await resp.text();
            let clientes;
            try { clientes = JSON.parse(texto); } catch (e) { clientes = null; }

            if (Array.isArray(clientes)) {
                const hashUsuario = await licencaHashEmail(emailUsuario);
                const cliente = clientes.find(c => c.email_hash === hashUsuario);

                if (cliente) {
                    const vencimento = cliente.dados_vencimento || cliente.vencimento || '';
                    const status     = cliente.status || 'ativo';

                    // Salva no banco local — fonte da verdade offline
                    if (vencimento) await licencaSalvarLocal(vencimento, status);

                    // Cliente inativo independente do vencimento
                    if (status !== 'ativo') {
                        return { status: 'bloqueado', diasRestantes: 0, dataVencimento: vencimento };
                    }

                    if (vencimento) return licencaCalcularResultado(vencimento);

                    // Sem campo de vencimento no JSON = licença permanente
                    return { status: 'ok', diasRestantes: 999 };
                }

                // Email não encontrado no JSON = não é cliente cadastrado
                // Usa o que está salvo no banco (pode ter sido removido por engano)
                console.warn('Licença: email não encontrado no GitHub, usando banco local.');
            }
        }
    } catch (e) {
        console.warn('Licença: GitHub inacessível, usando banco local.', e.message);
    }

    // 2. Fallback: usa o vencimento salvo no banco local
    const local = await licencaLerLocal();
    if (!local) {
        // Nunca sincronizou e não tem internet — libera com aviso
        console.warn('Licença: sem dados locais e sem internet. Liberando provisoriamente.');
        return { status: 'ok', diasRestantes: 999 };
    }

    if (local.status !== 'ativo') {
        return { status: 'bloqueado', diasRestantes: 0, dataVencimento: local.vencimento };
    }

    return licencaCalcularResultado(local.vencimento);
}

function removerTarjaLicenca() {
    const t = document.getElementById('tarja-licenca');
    if (t) t.remove();
    const ob = document.getElementById('overlay-licenca-bloqueada');
    if (ob) ob.remove();
    const sistema = document.getElementById('sistema-principal');
    if (sistema && sistema.classList.contains('hidden')) sistema.classList.remove('hidden');
}

function abrirRenovacao() {
    const msg = encodeURIComponent('Olá! Gostaria de renovar minha licença do sistema de atendimentos.');
    const url = 'https://wa.me/5551985818185?text=' + msg;
    if (ipcRenderer) {
        ipcRenderer.send('abrir-url-externa', url);
    } else {
        window.open(url, '_blank');
    }
}

function mostrarTarjaAviso(diasRestantes) {
    removerTarjaLicenca();
    // Remove overlay de bloqueio caso tenha ficado de verificação anterior
    const overlayBloqueio = document.getElementById('overlay-licenca-bloqueada');
    if (overlayBloqueio) overlayBloqueio.remove();
    // Garante que o sistema principal está visível
    const sistema = document.getElementById('sistema-principal');
    if (sistema && sistema.classList.contains('hidden')) sistema.classList.remove('hidden');
    const tarja = document.createElement('div');
    tarja.id = 'tarja-licenca';
    tarja.style.cssText = [
        'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:99999',
        'background:#dc2626', 'color:#fff',
        'padding:10px 20px',
        'display:flex', 'align-items:center', 'justify-content:space-between',
        'font-size:14px', 'font-weight:600',
        'box-shadow:0 2px 8px rgba(0,0,0,0.4)',
        'animation:tarja-pulse 2s infinite'
    ].join(';');

    const msg = diasRestantes === 0
        ? '⚠️ Sua licença vence HOJE! Renove para não perder o acesso.'
        : diasRestantes === 1
            ? '⚠️ Sua licença vence em 1 dia! Renove agora.'
            : `⚠️ Sua licença vence em ${diasRestantes} dias! Renove agora.`;

    tarja.innerHTML = `
        <span>${msg}</span>
        <button onclick="abrirRenovacao()" style="display:inline-flex;align-items:center;gap:6px;background:#25d366;color:#fff;border:none;border-radius:4px;padding:6px 16px;font-weight:700;cursor:pointer;margin-left:20px;white-space:nowrap;font-size:13px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            WhatsApp
        </button>
    `;

    // Adiciona animação de pulse via style tag (uma única vez)
    if (!document.getElementById('tarja-licenca-style')) {
        const style = document.createElement('style');
        style.id = 'tarja-licenca-style';
        style.textContent = `
            @keyframes tarja-pulse {
                0%,100% { background:#dc2626; }
                50% { background:#b91c1c; }
            }
            #sistema-principal { padding-top: 44px !important; }
        `;
        document.head.appendChild(style);
    }

    document.body.prepend(tarja);
}

function mostrarTelaBloqueio() {
    removerTarjaLicenca();

    // Esconde o sistema inteiro
    const sistema = document.getElementById('sistema-principal');
    if (sistema) sistema.classList.add('hidden');

    let overlay = document.getElementById('overlay-licenca-bloqueada');
    if (overlay) { overlay.style.display = 'flex'; return; }

    overlay = document.createElement('div');
    overlay.id = 'overlay-licenca-bloqueada';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:999999',
        'background:rgba(0,0,0,0.92)',
        'display:flex', 'flex-direction:column',
        'align-items:center', 'justify-content:center',
        'text-align:center', 'padding:2rem'
    ].join(';');

    overlay.innerHTML = `
        <div style="background:#1e1e2e;border:2px solid #dc2626;border-radius:1rem;padding:3rem 2.5rem;max-width:480px;width:100%;">
            <div style="font-size:4rem;margin-bottom:1rem;">🔒</div>
            <h2 style="color:#dc2626;font-size:1.6rem;margin-bottom:0.5rem;">Sistema Bloqueado</h2>
            <p style="color:#ccc;font-size:1rem;margin-bottom:1.5rem;line-height:1.6;">
                Sua licença de uso expirou.<br>
                Entre em contato para renovar o acesso.
            </p>
            <button onclick="abrirRenovacao()"
               style="display:inline-flex;align-items:center;gap:0.6rem;background:#25d366;color:#fff;padding:0.8rem 2rem;border-radius:0.5rem;font-weight:700;border:none;cursor:pointer;font-size:1rem;width:100%;justify-content:center;margin-bottom:0.75rem;">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                Chamar no WhatsApp
            </button>
            <p style="color:#666;font-size:0.8rem;margin-top:1rem;">
                Após o pagamento, o acesso é liberado automaticamente.
            </p>
        </div>
    `;
    document.body.appendChild(overlay);
}

async function verificarLicencaAposLogin(emailUsuario) {
    const resultado = await verificarLicenca(emailUsuario);
    if (resultado.status === 'bloqueado') {
        mostrarTelaBloqueio(resultado.dataVencimento);
    } else if (resultado.status === 'aviso') {
        mostrarTarjaAviso(resultado.diasRestantes, resultado.dataVencimento);
    } else {
        removerTarjaLicenca();
    }
}

// ====== USUÁRIOS — LOGIN ======
function inicializarUsuarios() {
    // Usuário admin é criado no main.js via db.inicializarUsuarioAdmin()
}

function verificarSessao() {
    if (usuarioLogado && usuarioLogado.status === 'ativo') {
        document.getElementById('tela-login').style.display = 'none';
        document.getElementById('sistema-principal').classList.remove('hidden');
        atualizarInfoUsuario();
        navegar('home');
        requestAnimationFrame(ajustarAlturaLayoutPrincipal);
        setTimeout(ajustarAlturaLayoutPrincipal, 300);
    } else {
        document.getElementById('tela-login').style.display = 'flex';
        document.getElementById('sistema-principal').classList.add('hidden');
    }
}

function atualizarInfoUsuario() {
    if (!usuarioLogado) return;
    const nomeEl = document.getElementById('user-display-name');
    if (nomeEl) nomeEl.innerText = usuarioLogado.nome;
    const perfilMap = { admin: 'Admin', medico: 'Médico', secretaria: 'Secretária' };
    const perfilLabel = document.getElementById('user-display-profile');
    if (perfilLabel) perfilLabel.innerText = perfilMap[usuarioLogado.perfil] || usuarioLogado.perfil;
    const btnUsuarios = document.getElementById('aba-usuarios');
    if (btnUsuarios) {
        // Define explicitamente os dois estados (antes só o "esconder" era setado;
        // o "mostrar" dependia do CSS padrão, que às vezes não repintava sozinho).
        btnUsuarios.style.display = (usuarioLogado.perfil === 'admin') ? 'flex' : 'none';
        if (usuarioLogado.perfil === 'admin') {
            requestAnimationFrame(() => forcarRepaint(document.querySelector('.sidebar-icones') || btnUsuarios));
        }
    }
}

// ── TEMA ──────────────────────────────────────────────────
function aplicarTema(tema) {
    document.documentElement.setAttribute('data-tema', tema);
    document.body.setAttribute('data-tema', tema);
    localStorage.setItem('tema_sistema', tema);
    sincronizarTemaDossie(tema);
    // Atualiza botão
    const btn = document.getElementById('btn-alternar-tema');
    if (btn) {
        if (tema === 'azul') {
            btn.innerHTML = '<i class="fa-solid fa-palette"></i>';
            btn.title = 'Mudar para tema Verde';
            btn.style.color = '#2563ab';
        } else if (tema === 'verde') {
            btn.innerHTML = '<i class="fa-solid fa-palette"></i>';
            btn.title = 'Mudar para tema Rosa';
            btn.style.color = '#22a05a';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-palette"></i>';
            btn.title = 'Mudar para tema Azul';
            btn.style.color = '#d63384';
        }
    }
}

// Reaplica o tema atual dentro do iframe do Dossiê, se estiver aberto
function sincronizarTemaDossie(tema) {
    const iframe = document.getElementById('dossie-iframe');
    if (!iframe) return;
    try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        if (tema) {
            doc.documentElement.setAttribute('data-tema', tema);
            doc.body && doc.body.setAttribute('data-tema', tema);
        } else {
            doc.documentElement.removeAttribute('data-tema');
            doc.body && doc.body.removeAttribute('data-tema');
        }
    } catch (e) { /* iframe fechado ou sem documento */ }
}

function alternarTema() {
    const atual = localStorage.getItem('tema_sistema') || 'rosa';
    const proximo = atual === 'rosa' ? 'azul' : atual === 'azul' ? 'verde' : 'rosa';
    aplicarTema(proximo);
}

// Aplica tema salvo ao carregar
(function() {
    const temaSalvo = localStorage.getItem('tema_sistema') || 'rosa';
    aplicarTema(temaSalvo);
})();

function switchLoginTab(tab) {
    const tabs = document.querySelectorAll('.login-tab');
    const forms = document.querySelectorAll('.login-form');
    tabs.forEach(t => t.classList.remove('active'));
    forms.forEach(f => f.classList.remove('active'));
    if (tab === 'entrar') {
        tabs[0]?.classList.add('active');
        document.getElementById('form-login')?.classList.add('active');
    } else {
        tabs[1]?.classList.add('active');
        document.getElementById('form-cadastro')?.classList.add('active');
    }
}

let _loginBloqueado = false;

// Codifica senha em base64 de forma segura para UTF-8 (acentos, ç, etc.).
// btoa() puro só aceita Latin1/ASCII e lança erro com acentuação —
// isso travava login/cadastro silenciosamente sem mostrar nada na tela.
function codificarSenha(senha) {
    return btoa(encodeURIComponent(senha).replace(/%([0-9A-F]{2})/g,
        (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

async function fazerLogin() {
    if (_loginBloqueado) return;

    const emailEl = document.getElementById('login-email');
    const senhaEl = document.getElementById('login-senha');
    const erroEl  = document.getElementById('login-erro-msg');
    const btnEl   = document.querySelector('#form-login .btn-login') ||
                    document.querySelector('button[onclick="fazerLogin()"]');

    const email = emailEl.value.trim().toLowerCase();
    const senha = senhaEl.value;

    if (!email || !senha) {
        mostrarErroLogin(erroEl, senhaEl, 'Preencha e-mail e senha.');
        return;
    }

    let senhaCripto;
    try {
        senhaCripto = codificarSenha(senha);
    } catch (e) {
        mostrarErroLogin(erroEl, senhaEl, 'Senha contém caracteres inválidos.');
        return;
    }

    _loginBloqueado = true;
    if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '.7'; btnEl.textContent = 'Verificando...'; }
    if (erroEl) erroEl.style.display = 'none';

    try {
        const usuario = await ipc('db-buscar-usuario-email', email);
        if (usuario && usuario.senha === senhaCripto && usuario.status === 'ativo') {
            usuarioLogado = { ...usuario };
            delete usuarioLogado.senha;
            sessionStorage.setItem('usuarioLogado', JSON.stringify(usuarioLogado));
            emailEl.value = '';
            senhaEl.value = '';
            _loginBloqueado = false;
            if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; btnEl.textContent = 'Entrar'; }
            await carregarDadosDoBanco();
            verificarSessao();
            verificarLicencaAposLogin(email);
            // Aplica preferências de seções do prontuário com o usuário correto
            aplicarVisibilidadeSecoes();
        } else {
            mostrarErroLogin(erroEl, senhaEl, 'E-mail ou senha incorretos.');
            _loginBloqueado = false;
            if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; btnEl.textContent = 'Entrar'; }
        }
    } catch(e) {
        mostrarErroLogin(erroEl, senhaEl, 'Erro ao conectar ao banco de dados.');
        _loginBloqueado = false;
        if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; btnEl.textContent = 'Entrar'; }
    }
}

function mostrarErroLogin(erroEl, senhaEl, msg) {
    senhaEl.value = '';
    if (erroEl) {
        erroEl.textContent = msg;
        erroEl.style.display = 'block';
    }
    setTimeout(() => {
        senhaEl.focus();
        if (erroEl) setTimeout(() => erroEl.style.display = 'none', 4000);
    }, 50);
}

async function cadastrarUsuario() {
    const nome      = document.getElementById('cad-nome').value.trim();
    const email     = document.getElementById('cad-email').value.trim().toLowerCase();
    const senha     = document.getElementById('cad-senha').value;
    const confirmar = document.getElementById('cad-confirmar-senha').value;
    const perfil    = document.getElementById('cad-perfil').value;

    if (!nome || !email || !senha) { alert('Preencha todos os campos!'); return; }
    if (senha !== confirmar) { alert('As senhas não coincidem!'); return; }

    const btnEl = document.querySelector('#form-cadastro .btn-login') ||
                  document.querySelector('button[onclick="cadastrarUsuario()"]');

    try {
        if (btnEl) { btnEl.disabled = true; btnEl.style.opacity = '.7'; btnEl.textContent = 'Cadastrando...'; }

        const existente = await ipc('db-buscar-usuario-email', email);
        if (existente) {
            alert('Este e-mail já está cadastrado!');
            return;
        }

        const senhaCripto = codificarSenha(senha);
        await ipc('db-salvar-usuario', { id: Date.now(), nome, email, senha: senhaCripto, perfil, status: 'ativo' });
        usuarios = await ipc('db-listar-usuarios') || [];

        alert('Usuário cadastrado! Faça login.');
        ['cad-nome','cad-email','cad-senha','cad-confirmar-senha'].forEach(id => document.getElementById(id).value = '');
        switchLoginTab('entrar');
    } catch (e) {
        alert('Erro ao cadastrar usuário: ' + (e?.message || e));
    } finally {
        if (btnEl) { btnEl.disabled = false; btnEl.style.opacity = '1'; btnEl.textContent = 'Cadastrar Usuário'; }
    }
}

// ══════════════════════════════════════════════════════════
// ESQUECI MINHA SENHA — fluxo em duas etapas:
//   1) Informa e-mail → pede ao main process pra gerar e enviar
//      um código de verificação por e-mail (Gmail, conta do Drive)
//   2) Informa código + nova senha → valida e redefine
// ══════════════════════════════════════════════════════════

let _esqueciSenhaEmail = '';

function abrirEsqueciSenha() {
    const modal = document.getElementById('modal-esqueci-senha');
    if (!modal) return;
    // Reseta para a etapa 1 sempre que abre
    _esqueciSenhaEmail = '';
    const etapa1 = document.getElementById('esqueci-etapa-1');
    const etapa2 = document.getElementById('esqueci-etapa-2');
    if (etapa1) etapa1.style.display = 'block';
    if (etapa2) etapa2.style.display = 'none';
    const campoEmail = document.getElementById('esqueci-email');
    if (campoEmail) campoEmail.value = '';
    const campoCodigo = document.getElementById('esqueci-codigo');
    if (campoCodigo) campoCodigo.value = '';
    const campoNovaSenha = document.getElementById('esqueci-nova-senha');
    if (campoNovaSenha) campoNovaSenha.value = '';
    const campoConfirmar = document.getElementById('esqueci-confirmar-senha');
    if (campoConfirmar) campoConfirmar.value = '';
    esconderMsgEsqueciSenha();
    modal.style.display = 'flex';
}

function fecharEsqueciSenha() {
    const modal = document.getElementById('modal-esqueci-senha');
    if (modal) modal.style.display = 'none';
}

function mostrarMsgEsqueciSenha(msg, tipo) {
    const el = document.getElementById('esqueci-msg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    el.style.color = tipo === 'erro' ? '#dc2626' : '#16a34a';
}

function esconderMsgEsqueciSenha() {
    const el = document.getElementById('esqueci-msg');
    if (el) el.style.display = 'none';
}

// Etapa 1 → solicita o envio do código por e-mail
async function esqueciSenhaEnviarCodigo() {
    const campoEmail = document.getElementById('esqueci-email');
    const email = campoEmail.value.trim().toLowerCase();
    const btn   = document.getElementById('btn-esqueci-enviar');

    if (!email) {
        mostrarMsgEsqueciSenha('Digite seu e-mail cadastrado.', 'erro');
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Enviando...'; }
        esconderMsgEsqueciSenha();

        const usuario = await ipc('db-buscar-usuario-email', email);
        if (!usuario) {
            mostrarMsgEsqueciSenha('Não encontramos esse e-mail cadastrado no sistema.', 'erro');
            return;
        }

        const resultado = await ipc('senha-enviar-codigo-recuperacao', { email });
        if (resultado && resultado.ok) {
            _esqueciSenhaEmail = email;
            document.getElementById('esqueci-etapa-1').style.display = 'none';
            document.getElementById('esqueci-etapa-2').style.display = 'block';
            mostrarMsgEsqueciSenha('Código enviado! Confira seu e-mail (e a caixa de spam).', 'sucesso');
        } else {
            mostrarMsgEsqueciSenha((resultado && resultado.msg) || 'Não foi possível enviar o código. Tente novamente.', 'erro');
        }
    } catch (e) {
        mostrarMsgEsqueciSenha('Erro ao enviar código: ' + (e?.message || e), 'erro');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Enviar código'; }
    }
}

// Etapa 2 → valida código e redefine a senha
async function esqueciSenhaRedefinir() {
    const codigo    = document.getElementById('esqueci-codigo').value.trim();
    const novaSenha = document.getElementById('esqueci-nova-senha').value;
    const confirmar = document.getElementById('esqueci-confirmar-senha').value;
    const btn       = document.getElementById('btn-esqueci-redefinir');

    if (!codigo) {
        mostrarMsgEsqueciSenha('Digite o código recebido por e-mail.', 'erro');
        return;
    }
    if (!novaSenha || novaSenha.length < 6) {
        mostrarMsgEsqueciSenha('A nova senha deve ter pelo menos 6 caracteres.', 'erro');
        return;
    }
    if (novaSenha !== confirmar) {
        mostrarMsgEsqueciSenha('As senhas não coincidem.', 'erro');
        return;
    }

    try {
        if (btn) { btn.disabled = true; btn.textContent = 'Redefinindo...'; }
        esconderMsgEsqueciSenha();

        const senhaCripto = codificarSenha(novaSenha);
        const resultado = await ipc('senha-redefinir-com-codigo', {
            email: _esqueciSenhaEmail,
            codigo,
            novaSenha: senhaCripto
        });

        if (resultado && resultado.ok) {
            mostrarMsgEsqueciSenha('Senha redefinida com sucesso! Você já pode fazer login.', 'sucesso');
            setTimeout(() => {
                fecharEsqueciSenha();
                switchLoginTab('entrar');
            }, 1800);
        } else {
            mostrarMsgEsqueciSenha((resultado && resultado.msg) || 'Código inválido ou expirado.', 'erro');
        }
    } catch (e) {
        mostrarMsgEsqueciSenha('Erro ao redefinir senha: ' + (e?.message || e), 'erro');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Redefinir senha'; }
    }
}

function toggleSenha(inputId) {
    const input = document.getElementById(inputId);
    const btn = input.nextElementSibling;
    const icon = btn.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        icon.classList.replace('fa-eye', 'fa-eye-slash');
    } else {
        input.type = 'password';
        icon.classList.replace('fa-eye-slash', 'fa-eye');
    }
}


// ====== ABRIR DOSSIÊ EM JANELA SEPARADA ======
// Usa IPC para pedir ao main.js abrir paciente.html numa nova janela,
// evitando que window.location.href destrua a sessão e apague os dados.

// ====== ABRIR AGENDA EM JANELA SEPARADA ======
// Pede ao main.js abrir a Agenda PWA numa segunda janela,
// apontando para http://127.0.0.1:3131 (servidor embutido).
// Não navega na janela principal — sessão e dados ficam intactos.
function abrirAgendaJanela() {
    if (ipcRenderer) {
        ipcRenderer.send('abrir-agenda');
    } else {
        // Fallback fora do Electron (dev/browser)
        window.open('http://127.0.0.1:3131/index.html', '_blank');
    }
}

function abrirDossieJanela() {
    const modal  = document.getElementById('modal-dossie');
    const iframe = document.getElementById('dossie-iframe');
    if (!modal || !iframe) return;
    iframe.src = 'paciente.html';
    modal.style.display = 'flex';
    iframe.onload = function() {
        sincronizarTemaDossie(document.documentElement.getAttribute('data-tema'));
    };
}

function fecharDossieModal() {
    const modal  = document.getElementById('modal-dossie');
    const iframe = document.getElementById('dossie-iframe');
    if (modal) modal.style.display = 'none';
    if (iframe) iframe.src = 'about:blank'; // libera memória/estado ao fechar
}

function fazerLogout() {
    sessionStorage.removeItem('usuarioLogado');
    usuarioLogado = null;
    pacientes = []; pagamentos = []; consultas = []; usuarios = [];
    verificarSessao();
}

// ====== GERENCIAMENTO DE USUÁRIOS (CRUD) ======
function atualizarTelaUsuarios() {
    const tbody = document.getElementById('lista-usuarios');
    if (!tbody) return;
    document.getElementById('total-usuarios').innerText = usuarios.length;
    tbody.innerHTML = '';
    usuarios.forEach(user => {
        const perfilMap = { admin: 'Administrador', medico: 'Médico/Psicólogo', secretaria: 'Secretária' };
        const statusClass = user.status === 'ativo' ? 'pago' : 'pendente';
        const isSelf = usuarioLogado && usuarioLogado.id === user.id;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${user.nome}</strong></td>
            <td>${user.email}</td>
            <td><span class="badge-status" style="background:#e0e7ff;color:#3730a3;">${perfilMap[user.perfil]}</span></td>
            <td><span class="badge-status ${statusClass}">${user.status === 'ativo' ? 'Ativo' : 'Inativo'}</span></td>
            <td style="display:flex;gap:4px;">
                <button class="btn-blue-action" onclick="editarUsuario(${user.id})" ${isSelf ? 'disabled style="opacity:0.5;"' : ''}>
                    <i class="fa-solid fa-pen"></i> Editar
                </button>
                ${!isSelf ? `<button class="btn-action" onclick="excluirUsuario(${user.id})" ><i class="fa-solid fa-trash"></i></button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function abrirModalUsuario() {
    document.getElementById('modal-usuario-titulo').innerText = 'Novo Usuário';
    document.getElementById('usuario-edit-id').value = '';
    document.getElementById('form-usuario').reset();
    document.getElementById('modal-usuario').style.display = 'flex';
}

function fecharModalUsuario() {
    document.getElementById('modal-usuario').style.display = 'none';
    document.getElementById('form-usuario').reset();
}

function editarUsuario(id) {
    const user = usuarios.find(u => u.id === id);
    if (!user) return;
    document.getElementById('modal-usuario-titulo').innerText = 'Editar Usuário';
    document.getElementById('usuario-edit-id').value = user.id;
    document.getElementById('usuario-nome-field').value = user.nome;
    document.getElementById('usuario-email').value = user.email;
    document.getElementById('usuario-senha').value = '';
    document.getElementById('usuario-perfil-field').value = user.perfil;
    document.getElementById('usuario-status').value = user.status;
    document.getElementById('modal-usuario').style.display = 'flex';
}

async function excluirUsuario(id) {
    if (!confirm('Excluir este usuário?')) return;
    await ipc('db-excluir-usuario', id);
    usuarios = await ipc('db-listar-usuarios') || [];
    atualizarTelaUsuarios();
}

document.getElementById('form-usuario')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const id    = document.getElementById('usuario-edit-id').value;
    const nome  = document.getElementById('usuario-nome-field').value.trim();
    const email = document.getElementById('usuario-email').value.trim().toLowerCase();
    const senha = document.getElementById('usuario-senha').value;
    const perfil = document.getElementById('usuario-perfil-field').value;
    const status = document.getElementById('usuario-status').value;
    if (!nome || !email) { alert('Nome e e-mail são obrigatórios!'); return; }
    const dados = { nome, email, perfil, status };
    if (id) { dados.id = parseInt(id); }
    else { if (!senha) { alert('Senha obrigatória!'); return; } dados.id = Date.now(); }
    if (senha) {
        try {
            dados.senha = codificarSenha(senha);
        } catch (err) {
            alert('Senha contém caracteres inválidos: ' + (err?.message || err));
            return;
        }
    }
    try {
        await ipc('db-salvar-usuario', dados);
        usuarios = await ipc('db-listar-usuarios') || [];
        fecharModalUsuario();
        atualizarTelaUsuarios();
        alert('Usuário salvo!');
    } catch (err) {
        alert('Erro ao salvar usuário: ' + (err?.message || err));
    }
});

// ====== NAVEGAÇÃO ======
window.addEventListener('DOMContentLoaded', async () => {
    await migrarLocalStorageSeNecessario();

    // Carrega TODOS os dados ANTES de renderizar qualquer tela,
    // evitando listas vazias ao voltar da teleconsulta (que recarrega a página)
    if (ipcRenderer) {
        await carregarDadosDoBanco();
        // Aplica preferências de seções com usuário já logado (sessão ativa)
        if (usuarioLogado) aplicarVisibilidadeSecoes();

        const pacs = pacientes.filter(p => p.status !== 'inativo');
        const bancoPareceVazio = pacs.length === 0;
        if (bancoPareceVazio) {
            ipcRenderer.send('drive-verificar');
            ipcRenderer.once('drive-status-verificado', (event, { conectado }) => {
                if (conectado) {
                    mostrarTelaRestauracao('drive');
                    ipcRenderer.send('drive-baixar-backup');
                } else {
                    ipcRenderer.send('restaurar-backup-local');
                }
            });
        }
    }

    // Só renderiza a sessão após os dados estarem prontos
    verificarSessao();
    // Verifica licença do usuário que já estava logado (sessão restaurada)
    if (usuarioLogado && usuarioLogado.email) {
        verificarLicencaAposLogin(usuarioLogado.email);
    }
    if (typeof verificarAniversariantes === 'function') verificarAniversariantes();

    // Fechar modal de agendamento ao clicar no overlay
    const modalCal = document.getElementById('modal-cal-agend');
    if (modalCal) {
        modalCal.addEventListener('click', (e) => {
            if (e.target === modalCal) homeFecharModalAgend();
        });
    }
});

function mostrarTelaRestauracao(origem) {
    if (document.getElementById('overlay-restauracao-drive')) return;
    const isDrive = origem === 'drive';
    const overlay = document.createElement('div');
    overlay.id = 'overlay-restauracao-drive';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.75);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:99999;color:#fff;gap:1rem;font-family:Inter,sans-serif;';
    overlay.innerHTML = `
        <i class="${isDrive ? 'fa-brands fa-google-drive' : 'fa-solid fa-folder-open'}" style="font-size:3rem;color:#4ade80;"></i>
        <h2 style="font-size:1.4rem;margin:0;">${isDrive ? 'Restaurando dados do Google Drive...' : 'Restaurando backup local...'}</h2>
        <p style="color:#94a3b8;margin:0;font-size:0.9rem;">Aguarde...</p>
        <div style="width:2.5rem;height:2.5rem;border:4px solid #4ade80;border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;"></div>
        <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(overlay);
}

// ── Corrige um bug de repintura do Electron nesta máquina/GPU: depois de
// trocar de aba (display:none -> block) ou de mudar a visibilidade de um
// elemento via JS, o Chromium às vezes só repinta o conteúdo depois que
// alguma coisa força um reflow — abrir o DevTools é o que "conserta" na
// hora, mas ninguém vai abrir o DevTools toda vez. Esse helper faz o mesmo
// tipo de repintura forçada que já existia pra janela principal (main.js),
// só que aqui dentro do próprio conteúdo da página.
function forcarRepaint(el) {
    const alvo = el || document.body;
    // "nudge" de zoom: imperceptível visualmente, mas obriga o compositor
    // a recalcular o layout inteiro daquele elemento.
    const zoomOriginal = alvo.style.zoom;
    alvo.style.zoom = '0.99999';
    requestAnimationFrame(() => {
        alvo.style.zoom = zoomOriginal || '1';
    });
}

// ── Corrige de vez o corte de conteúdo no painel esquerdo da Teleconsulta/
// Usuários: em vez de confiar em height:100%/vh/flex-stretch (que nesta
// máquina não está propagando altura por algum motivo — nem o CSS nem a
// barra de rolagem estavam se aplicando), medimos a altura REAL disponível
// na janela via JS e aplicamos direto em pixels no .app-two-col. Como
// .col-left e .col-right são filhos flex desse elemento com altura em
// pixels definida, eles ficam garantidamente limitados a essa altura,
// e o overflow-y:auto/scroll de .col-left passa a ter o que rolar de verdade.
function ajustarAlturaLayoutPrincipal() {
    const topBar = document.querySelector('#sistema-principal > .top-bar');
    const appTwoCol = document.querySelector('.app-two-col');
    if (!appTwoCol) return;

    const alturaTopo = topBar ? topBar.getBoundingClientRect().height : 0;
    const alturaDisponivel = Math.max(200, window.innerHeight - alturaTopo);

    appTwoCol.style.height = alturaDisponivel + 'px';
    appTwoCol.style.maxHeight = alturaDisponivel + 'px';
}

window.addEventListener('resize', ajustarAlturaLayoutPrincipal);
document.addEventListener('DOMContentLoaded', () => {
    ajustarAlturaLayoutPrincipal();
    // Reforça depois do primeiro layout completo (imagens/fontes ainda podem
    // alterar a altura do top-bar um instante depois do DOMContentLoaded).
    requestAnimationFrame(ajustarAlturaLayoutPrincipal);
    setTimeout(ajustarAlturaLayoutPrincipal, 300);
});

function navegar(tela) {
    ['home','dashboard','pacientes','pagamentos','relatorios','documentos','teleconsulta'].forEach(t => {
        const el = document.getElementById('tela-' + t);
        if (el) el.style.display = 'none';
    });
    const telaUsuarios = document.getElementById('tela-usuarios');
    if (telaUsuarios) telaUsuarios.style.display = 'none';

    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    // logo-botão home também perde destaque
    const logoBtn = document.getElementById('aba-home');
    if (logoBtn) { logoBtn.style.background = '#d63384'; logoBtn.style.opacity = '1'; }

    // Reseta o scroll do painel de conteúdo — sem isso, se a aba anterior (ex: Home)
    // estava rolada pra baixo, a nova aba abre "no meio do ar" parecendo tela em branco.
    const colEsquerda = document.querySelector('.col-left');
    if (colEsquerda) colEsquerda.scrollTop = 0;

    const mapa = {
        home:       () => { const th = document.getElementById('tela-home'); if (th) { th.style.display = 'block'; if (logoBtn) { logoBtn.style.background = '#9d174d'; } iniciarTelaHome(); } else { navegar('pacientes'); } },
        dashboard:  () => { document.getElementById('tela-dashboard').style.display = 'block';  document.getElementById('aba-dashboard').classList.add('active');  atualizarDashboard(); },
        pacientes:  () => { document.getElementById('tela-pacientes').style.display = 'block';  document.getElementById('aba-pacientes').classList.add('active');  atualizarTelaPacientes(); },
        pagamentos: () => { document.getElementById('tela-pagamentos').style.display = 'block'; document.getElementById('aba-pagamentos').classList.add('active'); atualizarTelaPagamentos(); },
        relatorios: () => { document.getElementById('tela-relatorios').style.display = 'block'; document.getElementById('aba-relatorios').classList.add('active'); aplicarFiltrosRelatorio(); },
        usuarios:   () => { if (telaUsuarios) telaUsuarios.style.display = 'block'; document.getElementById('aba-usuarios')?.classList.add('active'); atualizarTelaUsuarios(); },
        documentos: () => { document.getElementById('tela-documentos').style.display = 'block'; document.getElementById('aba-documentos').classList.add('active'); docPopularSelect(); },
        teleconsulta: () => { document.getElementById('tela-teleconsulta').style.display = 'block'; document.getElementById('aba-teleconsulta').classList.add('active'); if (typeof tcInicializar === 'function') tcInicializar(); },
    };
    if (mapa[tela]) mapa[tela]();

    // Garante que a aba recém-aberta seja realmente pintada na tela
    // (ver comentário na definição de forcarRepaint acima).
    const telaAberta = document.getElementById('tela-' + tela) || document.getElementById('tela-usuarios');
    requestAnimationFrame(() => forcarRepaint(telaAberta || document.querySelector('.col-left')));
    ajustarAlturaLayoutPrincipal();
}

function calcularIdade(dataNascimento) {
    if (!dataNascimento) return 'N/I';
    const hoje = new Date(), nasc = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return `${idade} anos`;
}

// ====== DASHBOARD ======
function popularSelectDashboard() {
    const sel = document.getElementById('dash-select-paciente');
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="">Todos os pacientes</option>';
    pacientes.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.nome;
        if (String(p.id) === String(valorAtual)) opt.selected = true;
        sel.appendChild(opt);
    });
}

function limparFiltrosDash() {
    document.getElementById('dash-select-paciente').value = '';
    document.getElementById('dash-data-ini').value = '';
    document.getElementById('dash-data-fim').value = '';
    atualizarDashboard();
}

function atualizarDashboard() {
    popularSelectDashboard();
    const filtroId = document.getElementById('dash-select-paciente').value;
    const dataIni  = document.getElementById('dash-data-ini').value;
    const dataFim  = document.getElementById('dash-data-fim').value;

    let pagsFiltrados = filtroId ? pagamentos.filter(p => String(p.pacienteId || p.paciente_id) === String(filtroId)) : pagamentos;
    if (dataIni) pagsFiltrados = pagsFiltrados.filter(p => p.data >= dataIni);
    if (dataFim) pagsFiltrados = pagsFiltrados.filter(p => p.data <= dataFim);

    const faturamentoTotal = pagsFiltrados.filter(p => p.status === 'Pago').reduce((s, p) => s + parseFloat(p.valor), 0);
    const pagsPageCount = pagsFiltrados.filter(p => p.status === 'Pago').length;
    const ticketMedio = pagsPageCount > 0 ? faturamentoTotal / pagsPageCount : 0;

    document.getElementById('dash-total-pacientes').innerText = filtroId ? '1' : pacientes.length;
    document.getElementById('dash-faturamento-total').innerText = 'R$ ' + faturamentoTotal.toFixed(2).replace('.', ',');
    document.getElementById('dash-ticket-medio').innerText = 'R$ ' + ticketMedio.toFixed(2).replace('.', ',');

    const chartContainer = document.getElementById('chart-container');
    chartContainer.innerHTML = '';
    const lancamentosPagos = pagsFiltrados.filter(p => p.status === 'Pago');
    if (lancamentosPagos.length === 0) {
        chartContainer.innerHTML = '<p style="text-align:center;color:#9ca3af;font-style:italic;font-size:0.85rem;padding:1rem 0;">Nenhum fluxo financeiro concluído para exibir.</p>';
    } else {
        const ultimos = lancamentosPagos.slice(-6).reverse();
        const maiorValor = Math.max(...ultimos.map(p => parseFloat(p.valor)));
        ultimos.forEach(pag => {
            const valorNum = parseFloat(pag.valor);
            const pct = maiorValor > 0 ? (valorNum / maiorValor) * 100 : 0;
            const label = filtroId ? pag.data.split('-').reverse().join('/') : (pag.pacienteNome || pag.paciente_nome || 'Paciente');
            const row = document.createElement('div');
            row.className = 'chart-row';
            row.innerHTML = `<div class="chart-name" title="${label}">${label}</div><div class="chart-track"><div class="chart-fill" style="width:${pct}%"></div></div><div class="chart-val-label">R$ ${valorNum.toFixed(2).replace('.', ',')}</div>`;
            chartContainer.appendChild(row);
        });
    }

    const chartFormas = document.getElementById('chart-formas');
    chartFormas.innerHTML = '';
    const pagsPagos = pagsFiltrados.filter(p => p.status === 'Pago');
    if (pagsPagos.length === 0) {
        chartFormas.innerHTML = '<p style="text-align:center;color:#9ca3af;font-style:italic;font-size:0.85rem;padding:1rem 0;">Sem dados.</p>';
        return;
    }
    const contagem = {};
    pagsPagos.forEach(p => { const f = p.forma || 'Não informado'; contagem[f] = (contagem[f] || 0) + 1; });
    const cores = ['#2563eb','#10b981','#f59e0b','#8b5cf6','#ef4444','#0891b2','#64748b'];
    const total = pagsPagos.length;
    Object.entries(contagem).sort((a,b) => b[1]-a[1]).forEach(([forma, qtd], i) => {
        const pct = Math.round((qtd / total) * 100);
        const cor = cores[i % cores.length];
        const row = document.createElement('div');
        row.className = 'chart-row';
        row.innerHTML = `<div class="chart-name">${forma}</div><div class="chart-track"><div class="chart-fill" style="width:${pct}%;background:${cor};"></div></div><div class="chart-val-label">${qtd}x · ${pct}%</div>`;
        chartFormas.appendChild(row);
    });
}

// ====== PACIENTES ======
function atualizarTelaPacientes(dadosExibidos = null) {
    if (!dadosExibidos) {
        // Sem argumento: aplica filtro de aba atual
        dadosExibidos = _filtroAba === 'ativos'   ? pacientes.filter(p => p.status !== 'inativo') :
                        _filtroAba === 'inativos' ? pacientes.filter(p => p.status === 'inativo') :
                        pacientes;
    }
    const tbody = document.getElementById('lista-pacientes');
    document.getElementById('total-pacientes').innerText = pacientes.length;
    tbody.innerHTML = '';
    if (dadosExibidos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:#9ca3af;font-style:italic;padding:2rem 0;">Nenhum paciente encontrado.</td></tr>`;
        return;
    }
    dadosExibidos.forEach(p => {
        const ativo    = p.status !== 'inativo';
        const badgeCor = ativo ? 'background:#d1fae5;color:#065f46;' : 'background:#fee2e2;color:#991b1b;';
        const badgeTxt = ativo ? 'Ativo' : 'Inativo';
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        if (!ativo) tr.style.opacity = '0.6';
        tr.innerHTML = `
            <td>
                <strong>${p.nome}</strong>
                <span class="td-subtext">${calcularIdade(p.nascimento)} (${p.sexo || 'N/I'})</span>
                <span style="margin-left:6px;padding:2px 8px;border-radius:99px;font-size:.7rem;font-weight:700;${badgeCor}">${badgeTxt}</span>
            </td>
            <td>${p.cpf}</td>
            <td>${p.telefone}<span class="td-subtext">${p.email || 'Sem e-mail'}</span></td>
            <td><span class="btn-action" style="background:#f1f5f9;color:#334155;border:none;cursor:default;">${p.convenio || 'Particular'}</span></td>
            <td style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                <button class="btn-blue-action" style="background:#f0fdfa;color:#0f766e;" title="Anamnese — Histórico + Evolução Clínica"
                    onclick="event.stopPropagation();abrirDocumentoUnico(${p.id})">
                    <i class="fa-solid fa-file-shield"></i> Anamnese
                </button>
                <button class="btn-action" style="background:#f3e8ff;color:#7c3aed;" title="Ficha de Evolução"
                    onclick="event.stopPropagation();abrirFichaEvolucao(${p.id})">
                    <i class="fa-solid fa-file-waveform"></i> Ficha de Evolução
                </button>
                <button class="btn-action" title="${ativo ? 'Inativar' : 'Ativar'} paciente"
                    style="${ativo ? 'background:#fef9c3;color:#854d0e;' : 'background:#d1fae5;color:#065f46;'}"
                    onclick="event.stopPropagation();toggleStatusPaciente(${p.id},'${ativo ? 'inativo' : 'ativo'}')">
                    <i class="fa-solid ${ativo ? 'fa-user-slash' : 'fa-user-check'}"></i>
                    ${ativo ? 'Inativar' : 'Ativar'}
                </button>
                <button class="btn-action" title="Excluir paciente"
                    style="background:#fee2e2;color:#991b1b;"
                    onclick="event.stopPropagation();excluirPaciente(${p.id},'${p.nome.replace(/'/g,"\'").replace(/"/g,'\"')}')">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </td>
        `;
        tr.addEventListener('click', () => abrirModalEditarPaciente(p.id));
        tbody.appendChild(tr);
    });
}

async function excluirPaciente(id, nome) {
    if (!confirm(`Excluir "${nome}" permanentemente?\nTodos os prontuários e pagamentos vinculados serão removidos.\n\nEsta ação não pode ser desfeita!`)) return;
    await ipc('db-excluir-paciente', id);
    pacientes = ordenarPacientesAlfabetico(await ipc('db-listar-pacientes'));
    atualizarTelaPacientes();
    sincronizarBackupDrive();
    showToast(`Paciente excluído com sucesso.`);
}

async function toggleStatusPaciente(id, novoStatus) {
    const p = pacientes.find(pac => pac.id === id);
    if (!p) return;
    const acao = novoStatus === 'inativo' ? 'inativar' : 'ativar';
    if (!confirm(`Deseja ${acao} o paciente "${p.nome}"?`)) return;
    await ipc('db-salvar-paciente', { ...p, status: novoStatus });
    pacientes = ordenarPacientesAlfabetico(await ipc('db-listar-pacientes'));
    atualizarTelaPacientes();
    sincronizarBackupDrive();
    showToast(`Paciente ${novoStatus === 'ativo' ? 'ativado' : 'inativado'} com sucesso.`);
}

function abrirModalPaciente() {
    document.getElementById('modal-cadastro').dataset.editId = '';
    document.querySelector('#modal-cadastro .modal-title').innerText = 'Ficha Cadastral do Paciente';
    document.getElementById('modal-cadastro').style.display = 'flex';
}

function abrirModalEditarPaciente(id) {
    const p = pacientes.find(pac => pac.id === id);
    if (!p) return;
    ['nome','nascimento','cpf','sexo','convenio','telefone','email','etnia','religiao','cep','logradouro','cidade','estado'].forEach(campo => {
        const el = document.getElementById(campo);
        if (el) el.value = p[campo] || '';
    });
    document.getElementById('endereco-num').value = p.numero || '';
    document.getElementById('pais').value = p.pais || 'Brasil';
    const fcn = document.getElementById('familiar-contato-nome'); if (fcn) fcn.value = p.familiar_contato_nome || '';
    const fcf = document.getElementById('familiar-contato-fone'); if (fcf) fcf.value = p.familiar_contato_fone || '';
    preencherResidentes(p.pessoas_casa || '[]');
    document.getElementById('modal-cadastro').dataset.editId = id;
    document.querySelector('#modal-cadastro .modal-title').innerText = 'Editar Cadastro do Paciente';
    document.getElementById('modal-cadastro').style.display = 'flex';
}

function fecharModalPaciente() {
    document.getElementById('modal-cadastro').style.display = 'none';
    document.getElementById('modal-cadastro').dataset.editId = '';
    document.querySelector('#modal-cadastro .modal-title').innerText = 'Ficha Cadastral do Paciente';
    document.getElementById('form-paciente').reset();
    resetarResidentes();
}

function adicionarResidente() {
    const tbody = document.getElementById('residentes-tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.className = 'residente-row';
    tr.innerHTML = `
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;"><input type="text" class="res-nome" style="width:100%;border:none;background:transparent;font-size:.85rem;padding:.1rem .2rem;" placeholder="Nome"></td>
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;"><input type="number" class="res-idade" min="0" max="120" style="width:100%;border:none;background:transparent;font-size:.85rem;padding:.1rem .2rem;" placeholder="0"></td>
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;"><input type="text" class="res-parentesco" style="width:100%;border:none;background:transparent;font-size:.85rem;padding:.1rem .2rem;" placeholder="Ex: Cônjuge"></td>
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;">
            <select class="res-estcivil" style="width:100%;border:none;background:transparent;font-size:.85rem;">
                <option value=""></option>
                <option>Solteiro(a)</option><option>Casado(a)</option><option>Divorciado(a)</option><option>Viúvo(a)</option>
            </select>
        </td>
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;"><input type="text" class="res-ocupacao" style="width:100%;border:none;background:transparent;font-size:.85rem;padding:.1rem .2rem;" placeholder="Ex: Estudante"></td>
        <td style="border:1px solid var(--border,#e2e8f0);padding:.25rem .3rem;text-align:center;"><button type="button" onclick="removerResidente(this)" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:1rem;padding:0;">×</button></td>`;
    tbody.appendChild(tr);
}

function removerResidente(btn) {
    const tr = btn.closest('tr');
    const tbody = document.getElementById('residentes-tbody');
    if (tbody && tbody.querySelectorAll('tr').length > 1) tr.remove();
    else { tr.querySelectorAll('input,select').forEach(el => el.value = ''); }
}

function coletarResidentes() {
    const rows = document.querySelectorAll('#residentes-tbody .residente-row');
    const lista = [];
    rows.forEach(row => {
        const nome = row.querySelector('.res-nome')?.value?.trim();
        if (!nome) return;
        lista.push({
            nome,
            idade: row.querySelector('.res-idade')?.value || '',
            parentesco: row.querySelector('.res-parentesco')?.value || '',
            est_civil: row.querySelector('.res-estcivil')?.value || '',
            ocupacao: row.querySelector('.res-ocupacao')?.value || ''
        });
    });
    return JSON.stringify(lista);
}

function resetarResidentes() {
    const tbody = document.getElementById('residentes-tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr, i) => { if (i > 0) tr.remove(); else tr.querySelectorAll('input,select').forEach(el => el.value = ''); });
}

function preencherResidentes(jsonStr) {
    resetarResidentes();
    let lista = [];
    try { lista = JSON.parse(jsonStr || '[]'); } catch(e) { return; }
    lista.forEach((item, i) => {
        if (i > 0) adicionarResidente();
        const rows = document.querySelectorAll('#residentes-tbody .residente-row');
        const row = rows[i];
        if (!row) return;
        const n = row.querySelector('.res-nome'); if (n) n.value = item.nome || '';
        const id = row.querySelector('.res-idade'); if (id) id.value = item.idade || '';
        const par = row.querySelector('.res-parentesco'); if (par) par.value = item.parentesco || '';
        const ec = row.querySelector('.res-estcivil'); if (ec) ec.value = item.est_civil || '';
        const oc = row.querySelector('.res-ocupacao'); if (oc) oc.value = item.ocupacao || '';
    });
}

document.getElementById('form-paciente').addEventListener('submit', async function(e) {
    e.preventDefault();
    const editId = document.getElementById('modal-cadastro').dataset.editId;
    const dados = {
        nome: document.getElementById('nome').value,
        nascimento: document.getElementById('nascimento').value,
        cpf: document.getElementById('cpf').value,
        sexo: document.getElementById('sexo').value,
        convenio: document.getElementById('convenio').value || 'Particular',
        telefone: document.getElementById('telefone').value,
        email: document.getElementById('email').value,
        etnia: document.getElementById('etnia')?.value || '',
        religiao: document.getElementById('religiao')?.value || '',
        familiar_contato_nome: document.getElementById('familiar-contato-nome')?.value || '',
        familiar_contato_fone: document.getElementById('familiar-contato-fone')?.value || '',
        cep: document.getElementById('cep').value,
        logradouro: document.getElementById('logradouro').value,
        numero: document.getElementById('endereco-num').value,
        cidade: document.getElementById('cidade').value,
        estado: document.getElementById('estado').value.toUpperCase(),
        pais: document.getElementById('pais').value || 'Brasil',
        pessoas_casa: coletarResidentes()
    };
    if (editId) dados.id = parseInt(editId);
    await ipc('db-salvar-paciente', dados);
    pacientes = ordenarPacientesAlfabetico(await ipc('db-listar-pacientes'));
    atualizarTelaPacientes();
    sincronizarBackupDrive();
    fecharModalPaciente();
    // Atualiza dossiê PDF sempre que o cadastro for salvo/editado
    const pacSalvo = pacientes.find(p => p.nome === dados.nome && (dados.id ? String(p.id) === String(dados.id) : true));
    if (pacSalvo) dispararAtualizacaoPdf(pacSalvo.id, pacSalvo.nome);
});

// ── Filtro por aba (Ativos / Inativos / Todos) ───────────
let _filtroAba = 'ativos'; // padrão: mostra só ativos

function filtrarAba(aba) {
    _filtroAba = aba;

    // Atualizar classe ativo nos botões
    ['ativos', 'inativos', 'todos'].forEach(a => {
        const btn = document.getElementById(`aba-pac-${a}`);
        if (!btn) return;
        btn.classList.toggle('ativo', a === aba);
        // Limpar inline styles legados
        btn.style.background = '';
        btn.style.color = '';
        btn.style.borderColor = '';
    });

    // Aplica filtro junto com busca atual
    const termo = (document.getElementById('campo-busca')?.value || '').toLowerCase().trim();
    aplicarFiltrosPacientes(termo);
}

function aplicarFiltrosPacientes(termo) {
    let lista = [...pacientes];

    // Filtro de aba
    if (_filtroAba === 'ativos')   lista = lista.filter(p => p.status !== 'inativo');
    if (_filtroAba === 'inativos') lista = lista.filter(p => p.status === 'inativo');

    // Filtro de busca
    if (termo) {
        const partes = termo.split(/\s+/);
        lista = lista.filter(p => {
            const partesNome = (p.nome || '').toLowerCase().split(/\s+/);
            const bateNome   = partes.every(parte => partesNome.some(pn => pn.startsWith(parte)));
            return bateNome || (p.cpf || '').includes(termo) || (p.convenio || '').toLowerCase().includes(termo);
        });
    }

    atualizarTelaPacientes(lista);
}

document.getElementById('campo-busca').addEventListener('input', function() {    const termo = this.value.toLowerCase().trim();
    aplicarFiltrosPacientes(termo);
});


// ====== CONSULTAS ======
// Carrega o documento único de prontuário do paciente nos campos do formulário.
// Se ainda não existir nenhum prontuário salvo, deixa os campos em branco (documento novo).
// pfx = 'du-' — único formulário existente hoje (Documento Único).
async function carregarProntuarioDoPaciente(pacienteId, pfx='') {
    // Limpa antes de preencher, para não misturar dados de outro paciente
    limparProntuarioExtra(pfx);
    const elData = document.getElementById(pfx+'data-consulta');
    if (elData) elData.value = new Date().toISOString().split('T')[0];
    document.getElementById(pfx+'texto-consulta').value = '';
    document.getElementById(pfx+'cid-codigo').value = '';
    document.getElementById(pfx+'cid-descricao').value = '';

    let prontuario = null;
    try {
        prontuario = await ipc('db-get-prontuario', pacienteId);
    } catch(err) {
        console.warn('Falha ao buscar prontuário do banco:', err);
    }
    if (!prontuario) return;

    const elNumero = document.getElementById(pfx+'sessao-numero');
    const elDuracao = document.getElementById(pfx+'sessao-duracao');
    if (elNumero) elNumero.value = prontuario.numeroSessao || '';
    if (elDuracao) elDuracao.value = prontuario.duracao || '50';
    document.getElementById(pfx+'sessao-tarefa').value = prontuario.tarefa || '';

    if (prontuario.cidCodigo) {
        document.getElementById(pfx+'cid-codigo').value = prontuario.cidCodigo;
        document.getElementById(pfx+'cid-descricao').value = prontuario.cidDescricao || '';
        cidSelecionarItem(prontuario.cidCodigo, '', prontuario.cidDescricao || prontuario.cidCodigo, pfx);
    }

    if (prontuario.humor) selecionarHumor(parseInt(prontuario.humor), pfx);

    if (prontuario.tecnicas) {
        prontuario.tecnicas.split('|').filter(Boolean).forEach(t => ativarTecnica(t, pfx));
    }

    const modo = prontuario.modoRegistro || 'livre';
    alternarModoRegistro(modo, pfx);
    if (modo === 'estruturado') {
        document.getElementById(pfx+'soap-s').value = prontuario.soapS || '';
        document.getElementById(pfx+'soap-o').value = prontuario.soapO || '';
        document.getElementById(pfx+'soap-a').value = prontuario.soapA || '';
        document.getElementById(pfx+'soap-p').value = prontuario.soapP || '';
    } else {
        document.getElementById(pfx+'texto-consulta').value = prontuario.texto || '';
    }

    try {
        const ema = typeof prontuario.ema === 'string' ? JSON.parse(prontuario.ema || '{}') : (prontuario.ema || {});
        const emaMap = {
            'ema-consciencia': ema.consciencia, 'ema-atencao': ema.atencao,
            'ema-memoria': ema.memoria, 'ema-afeto': ema.afeto,
            'ema-pensamento-forma': ema.pensamentoForma, 'ema-pensamento-conteudo': ema.pensamentoConteudo,
            'ema-percepcao': ema.percepcao, 'ema-insight': ema.insight, 'ema-obs': ema.obs,
        };
        Object.entries(emaMap).forEach(([id, val]) => { const el = document.getElementById(pfx+id); if (el && val) el.value = val; });
    } catch(e) {}

    try {
        const risco = typeof prontuario.risco === 'string' ? JSON.parse(prontuario.risco || '{}') : (prontuario.risco || {});
        const riscoMap = {
            'risco-ideacao': risco.ideacao, 'risco-autolesao': risco.autolesao,
            'risco-hetero': risco.hetero, 'risco-substancias': risco.substancias, 'risco-plano': risco.plano,
        };
        Object.entries(riscoMap).forEach(([id, val]) => { const el = document.getElementById(pfx+id); if (el && val) el.value = val; });
        atualizarAlertaRisco(pfx);
    } catch(e) {}

    try {
        _objetivosLista = JSON.parse(prontuario.objetivos || '[]');
        renderizarObjetivos(pfx);
    } catch(e) { _objetivosLista = []; }

    try {
        const f = typeof prontuario.formulacao === 'string' ? JSON.parse(prontuario.formulacao || '{}') : (prontuario.formulacao || {});
        const fMap = {
            'form-predisponentes': f.predisponentes, 'form-precipitantes': f.precipitantes,
            'form-manutencao': f.manutencao, 'form-protecao': f.protecao, 'form-hipotese': f.hipotese,
        };
        Object.entries(fMap).forEach(([id, val]) => { const el = document.getElementById(pfx+id); if (el && val) el.value = val; });
    } catch(e) {}

    const aviso = document.getElementById(pfx+'prontuario-ultima-atualizacao');
    if (aviso) {
        aviso.textContent = prontuario.atualizadoEm
            ? `Última atualização: ${new Date(prontuario.atualizadoEm).toLocaleString('pt-BR')}`
            : '';
    }
    return prontuario;
}

// Monta o objeto "dados" do prontuário a partir dos campos na tela.
// pfx = 'du-' — único formulário existente hoje (Documento Único).
// Retorna null (e mostra alerta) se a evolução estiver vazia.
function coletarDadosProntuario(pfx='') {
    const modalidadeCons = document.getElementById(pfx+'modalidade-consulta');
    const modoAtual = window._modoRegistroAtual || 'livre';

    let textoFinal = '';
    if (modoAtual === 'estruturado') {
        const s = document.getElementById(pfx+'soap-s').value.trim();
        const o = document.getElementById(pfx+'soap-o').value.trim();
        const a = document.getElementById(pfx+'soap-a').value.trim();
        const p = document.getElementById(pfx+'soap-p').value.trim();
        textoFinal = [
            s ? `[S - Subjetivo]\n${s}` : '',
            o ? `[O - Objetivo]\n${o}` : '',
            a ? `[A - Avaliação]\n${a}` : '',
            p ? `[P - Plano]\n${p}` : '',
        ].filter(Boolean).join('\n\n');
    } else {
        textoFinal = document.getElementById(pfx+'texto-consulta').value.trim();
    }

    if (!textoFinal) { alert('Preencha a evolução da sessão.'); return null; }

    const emaData = {
        consciencia:       document.getElementById(pfx+'ema-consciencia')?.value || '',
        atencao:           document.getElementById(pfx+'ema-atencao')?.value || '',
        memoria:           document.getElementById(pfx+'ema-memoria')?.value || '',
        afeto:             document.getElementById(pfx+'ema-afeto')?.value || '',
        pensamentoForma:   document.getElementById(pfx+'ema-pensamento-forma')?.value || '',
        pensamentoConteudo:document.getElementById(pfx+'ema-pensamento-conteudo')?.value || '',
        percepcao:         document.getElementById(pfx+'ema-percepcao')?.value || '',
        insight:           document.getElementById(pfx+'ema-insight')?.value || '',
        obs:               document.getElementById(pfx+'ema-obs')?.value || '',
    };
    const riscoData = {
        ideacao:     document.getElementById(pfx+'risco-ideacao')?.value || '',
        autolesao:   document.getElementById(pfx+'risco-autolesao')?.value || '',
        hetero:      document.getElementById(pfx+'risco-hetero')?.value || '',
        substancias: document.getElementById(pfx+'risco-substancias')?.value || '',
        plano:       document.getElementById(pfx+'risco-plano')?.value || '',
    };
    const formulacaoData = {
        predisponentes: document.getElementById(pfx+'form-predisponentes')?.value || '',
        precipitantes:  document.getElementById(pfx+'form-precipitantes')?.value || '',
        manutencao:     document.getElementById(pfx+'form-manutencao')?.value || '',
        protecao:       document.getElementById(pfx+'form-protecao')?.value || '',
        hipotese:       document.getElementById(pfx+'form-hipotese')?.value || '',
    };

    return {
        data:         document.getElementById(pfx+'data-consulta').value,
        texto:        textoFinal,
        modalidade:   modalidadeCons ? modalidadeCons.value : 'presencial',
        cidCodigo:    document.getElementById(pfx+'cid-codigo').value || '',
        cidDescricao: document.getElementById(pfx+'cid-descricao').value || '',
        humor:        document.getElementById(pfx+'sessao-humor').value || '',
        tecnicas:     document.getElementById(pfx+'sessao-tecnicas').value || '',
        tarefa:       document.getElementById(pfx+'sessao-tarefa').value || '',
        numeroSessao: document.getElementById(pfx+'sessao-numero').value || '',
        duracao:      document.getElementById(pfx+'sessao-duracao').value || '50',
        modoRegistro: modoAtual,
        soapS: modoAtual === 'estruturado' ? document.getElementById(pfx+'soap-s').value : '',
        soapO: modoAtual === 'estruturado' ? document.getElementById(pfx+'soap-o').value : '',
        soapA: modoAtual === 'estruturado' ? document.getElementById(pfx+'soap-a').value : '',
        soapP: modoAtual === 'estruturado' ? document.getElementById(pfx+'soap-p').value : '',
        ema:        JSON.stringify(emaData),
        risco:      JSON.stringify(riscoData),
        objetivos:  document.getElementById(pfx+'sessao-objetivos')?.value || '[]',
        formulacao: JSON.stringify(formulacaoData),
        templateUsado: window._templateUsadoNaSessao ? JSON.stringify(window._templateUsadoNaSessao) : '',
    };
}

// ====== FUNÇÕES ABRIR DOCUMENTOS ======
// ══════════════════════════════════════════════════════════════
// DOCUMENTO ÚNICO (agora o único documento — Anamnese + Prontuário)

// ══════════════════════════════════════════════════════════════

// Mesma lista de campos usada na Anamnese normal, só que lidos com o prefixo "du-an-"
const CAMPOS_ANAMNESE_DOC_UNICO = [
    'encaminhado-por','motivo-encaminhamento',
    'queixa','historia',
    'sint-outros',
    'escolaridade','profissao','estado-civil','historia-familiar','historia-passada',
    'relacionamentos','doencas','medicamentos','sono-padrao','alimentacao',
    'trat-psico-realizado','trat-psico-periodo','trat-psico-tipo','trat-psico-local','trat-psico-profissional',
    'trat-psiq-realizado','trat-psiq-periodo','trat-psiq-tipo','trat-psiq-local','trat-psiq-profissional','trat-psiq-medicacao',
    'hospitalizacoes','ideacao',
    'hist-atual-familiar','hist-atual-social','hist-atual-profissional',
    'impressoes','hipotese','agf','abordagem','objetivos','obs'
];

function toggleModoFocoDU() {
    if (document.body.classList.contains('modo-foco-ativo-du')) {
        _focoDesativarDU();
    } else {
        _focoAtivarDU();
    }
}

function _focoAtivarDU() {
    document.body.classList.add('modo-foco-ativo-du');
    const modal = document.getElementById('modal-documento-unico');
    const content = modal?.querySelector('.modal-content');
    if (content) {
        content._styleOrig = content.getAttribute('style');
        content.setAttribute('style', 'max-width:900px;width:95vw;max-height:95vh;overflow-y:auto;');
    }
    const btn = document.getElementById('du-btn-modo-foco');
    if (btn) { btn.style.background='#fce7f3'; btn.style.color='#c4506d'; btn.style.borderColor='#f3c6d8'; }
    setTimeout(() => {
        const ta = document.getElementById('du-texto-consulta');
        if (ta && ta.offsetParent) ta.focus();
    }, 150);
}

function _focoDesativarDU() {
    document.body.classList.remove('modo-foco-ativo-du');
    const modal = document.getElementById('modal-documento-unico');
    const content = modal?.querySelector('.modal-content');
    if (content?._styleOrig !== undefined) content.setAttribute('style', content._styleOrig);
    const btn = document.getElementById('du-btn-modo-foco');
    if (btn) { btn.style.background=''; btn.style.color=''; btn.style.borderColor=''; }
}

function docAbrirAnamnese() {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    abrirDocumentoUnico(_docPacienteSelecionado.id);
}

async function abrirDocumentoUnico(pacienteId) {
    const paciente = pacientes.find(p => String(p.id) === String(pacienteId));
    if (!paciente) return;
    document.getElementById('du-paciente-id').value = pacienteId;
    document.getElementById('du-nome-paciente').innerText = paciente.nome;

    // Cabeçalho + todas as seções do Prontuário (CID, humor, técnicas, evolução,
    // EMA, risco, objetivos, formulação, tarefa) — reaproveita a mesma função
    // usada pelo Prontuário normal, só que apontando para os campos "du-...".
    const prontuario = await carregarProntuarioDoPaciente(pacienteId, 'du-');
    document.getElementById('du-data-consulta').value       = prontuario?.data || new Date().toISOString().split('T')[0];
    document.getElementById('du-modalidade-consulta').value = prontuario?.modalidade || 'presencial';

    // Limpa campos de anamnese do documento único
    CAMPOS_ANAMNESE_DOC_UNICO.forEach(c => { const el = document.getElementById('du-an-' + c); if (el) el.value = ''; });
    document.querySelectorAll('.du-an-checkbox').forEach(cb => cb.checked = false);

    // Carrega a anamnese já salva do paciente (mesmo registro usado no botão "Anamnese")
    let anamnese = null;
    try {
        anamnese = await ipc('db-get-anamnese', pacienteId);
    } catch(err) {
        console.warn('Falha ao buscar anamnese do banco, tentando localStorage:', err);
    }
    if (!anamnese) {
        try { anamnese = JSON.parse(localStorage.getItem('anamnese_' + pacienteId) || 'null'); } catch(e) {}
    }
    if (anamnese) {
        Object.entries(anamnese).forEach(([k, v]) => {
            const campo = document.getElementById('du-an-' + k);
            if (campo) {
                if (campo.type === 'checkbox') campo.checked = !!v;
                else campo.value = v;
            }
        });
    }

    // TODO: quando a ordem dos campos do prontuário for definida, carregar aqui
    // via ipc('db-get-prontuario', pacienteId), do mesmo jeito que a anamnese acima.

    document.getElementById('modal-documento-unico').style.display = 'flex';
}

function fecharDocumentoUnico() {
    if (document.body.classList.contains('modo-foco-ativo-du')) _focoDesativarDU();
    document.getElementById('modal-documento-unico').style.display = 'none';
}

document.getElementById('form-documento-unico').addEventListener('submit', async function(e) {
    e.preventDefault();
    const pacienteId = document.getElementById('du-paciente-id').value;
    if (!pacienteId) return;

    // --- Bloco Anamnese ---
    const dadosAnamnese = { atualizadoEm: new Date().toISOString() };
    CAMPOS_ANAMNESE_DOC_UNICO.forEach(c => {
        const el = document.getElementById('du-an-' + c);
        if (el) dadosAnamnese[c] = el.value;
    });
    document.querySelectorAll('.du-an-checkbox').forEach(cb => {
        const key = cb.id.replace('du-an-', '');
        dadosAnamnese[key] = cb.checked;
    });

    try {
        await ipc('db-salvar-anamnese', { pacienteId, dados: dadosAnamnese });
    } catch(err) {
        console.warn('Falha ao salvar anamnese (documento único) no banco:', err);
    }
    localStorage.setItem(`anamnese_${pacienteId}`, JSON.stringify(dadosAnamnese));

    // --- Bloco Prontuário (documento completo: CID, humor, técnicas, evolução, EMA, risco, objetivos, formulação, tarefa) ---
    const dadosProntuario = coletarDadosProntuario('du-');
    if (!dadosProntuario) return; // evolução vazia — o alerta já foi mostrado

    try {
        await ipc('db-salvar-prontuario', { pacienteId, dados: dadosProntuario });
    } catch(err) {
        console.warn('Falha ao salvar prontuário (documento único) no banco:', err);
    }

    fecharDocumentoUnico();
    showToast('Anamnese salva com sucesso!', 'sucesso');
    sincronizarBackupDrive();

    const pac = pacientes.find(p => String(p.id) === String(pacienteId));
    if (pac) dispararAtualizacaoPdf(pac.id, pac.nome);
});

// ═══════════════════════════════════════════════════════════
// FICHA DE EVOLUÇÃO — registro manual de atendimentos por data,
// separado do Prontuário (documento único) e da Anamnese.
// A lista sempre mostra tudo que já foi lançado para o
// paciente, com edição e exclusão individuais.
// ═══════════════════════════════════════════════════════════

function fichaevoEsc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function fichaevoFormatarData(str) {
    if (!str) return '—';
    try { return new Date(str + 'T12:00:00').toLocaleDateString('pt-BR'); }
    catch (e) { return str; }
}

// Chamada a partir do painel "Ficha de Evolução" na tela Documentos,
// usando o paciente selecionado ali (_docPacienteSelecionado).
function docAbrirFichaEvolucao() {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    abrirFichaEvolucao(_docPacienteSelecionado.id);
}

// Chamada tanto pelo botão da tela Documentos quanto pelo atalho
// rápido na lista de pacientes.
async function abrirFichaEvolucao(pacienteId) {
    const pac = pacientes.find(p => String(p.id) === String(pacienteId));
    document.getElementById('fichaevo-paciente-id').value = pacienteId;
    document.getElementById('fichaevo-nome-paciente').innerText = pac ? pac.nome : '';
    document.getElementById('fichaevo-nova-data').value = new Date().toISOString().slice(0, 10);
    document.getElementById('fichaevo-novo-texto').value = '';
    fichaevoFecharFormNovo(); // sempre abre recolhido, só com o botão "Adicionar Registro"
    document.getElementById('modal-ficha-evolucao').style.display = 'flex';
    await carregarListaFichaEvolucao(pacienteId);
}

function fecharFichaEvolucao() {
    document.getElementById('modal-ficha-evolucao').style.display = 'none';
    // Sai do modo foco ao fechar
    if (document.body.classList.contains('modo-foco-fichaevo-ativo')) {
        _focoFichaEvoDesativar();
    }
}

// Mostra/esconde o formulário de novo registro, escondido por padrão
// atrás do botão "Adicionar Registro".
function fichaevoAbrirFormNovo() {
    document.getElementById('fichaevo-btn-novo-wrap').style.display = 'none';
    document.getElementById('fichaevo-form-novo').style.display = 'block';
    if (!document.getElementById('fichaevo-nova-data').value) {
        document.getElementById('fichaevo-nova-data').value = new Date().toISOString().slice(0, 10);
    }
    setTimeout(() => document.getElementById('fichaevo-novo-texto')?.focus(), 50);
}

function fichaevoFecharFormNovo() {
    document.getElementById('fichaevo-form-novo').style.display = 'none';
    document.getElementById('fichaevo-btn-novo-wrap').style.display = 'block';
}

// ══════════════════════════════════════════════════════════════
// MODO FOCO — tela cheia limpa para escrever a Ficha de Evolução
// ══════════════════════════════════════════════════════════════
function toggleModoFocoFichaEvolucao() {
    if (document.body.classList.contains('modo-foco-fichaevo-ativo')) {
        _focoFichaEvoDesativar();
    } else {
        _focoFichaEvoAtivar();
    }
}

function _focoFichaEvoAtivar() {
    fichaevoAbrirFormNovo(); // garante que o campo de texto esteja visível
    document.body.classList.add('modo-foco-fichaevo-ativo');
    setTimeout(() => {
        const ta = document.getElementById('fichaevo-novo-texto');
        if (ta && ta.offsetParent) ta.focus();
    }, 150);
}

function _focoFichaEvoDesativar() {
    document.body.classList.remove('modo-foco-fichaevo-ativo');
}

async function carregarListaFichaEvolucao(pacienteId) {
    const lista = document.getElementById('fichaevo-lista');
    lista.innerHTML = '<p style="color:#94a3b8;font-style:italic;">Carregando...</p>';
    let registros = [];
    try {
        registros = await ipc('db-listar-fichas-evolucao', pacienteId) || [];
    } catch (err) {
        console.warn('Falha ao carregar ficha de evolução:', err);
    }
    if (!registros.length) {
        lista.innerHTML = '<p style="color:#94a3b8;font-style:italic;">Nenhum registro ainda.</p>';
        return;
    }
    lista.innerHTML = registros.map(r => fichaevoRenderItem(r)).join('');
}

function fichaevoRenderItem(r) {
    return `
    <div class="fichaevo-item" id="fichaevo-item-${r.id}" style="border:1.5px solid #e2e8f0;border-radius:10px;padding:.7rem .85rem;background:#fff;max-width:100%;overflow:hidden;box-sizing:border-box;">
        <div class="fichaevo-view-${r.id}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.35rem;">
                <strong style="font-size:.82rem;color:#7c3aed;"><i class="fa-solid fa-calendar-day"></i> ${fichaevoFormatarData(r.data)}</strong>
                <div style="display:flex;gap:6px;">
                    <button type="button" title="Editar" onclick="fichaevoEntrarEdicao(${r.id})" style="background:none;border:none;cursor:pointer;color:#64748b;font-size:.85rem;">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button type="button" title="Excluir" onclick="excluirRegistroEvolucao(${r.id})" style="background:none;border:none;cursor:pointer;color:#dc2626;font-size:.85rem;">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
            <p style="font-size:.85rem;color:#334155;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere;margin:0;">${fichaevoEsc(r.texto)}</p>
        </div>
        <div class="fichaevo-edit-${r.id}" style="display:none;">
            <div class="form-row" style="margin-bottom:.4rem;">
                <div class="form-group flex-1">
                    <label>Data</label>
                    <input type="date" id="fichaevo-edit-data-${r.id}" value="${r.data ? r.data.slice(0, 10) : ''}">
                </div>
            </div>
            <div class="form-group" style="margin-bottom:.5rem;">
                <label>Registro</label>
                <textarea id="fichaevo-edit-texto-${r.id}" rows="4">${fichaevoEsc(r.texto)}</textarea>
            </div>
            <div style="display:flex;gap:6px;justify-content:flex-end;">
                <button type="button" class="btn-cancel" onclick="fichaevoCancelarEdicao(${r.id})">Cancelar</button>
                <button type="button" class="btn-primary" onclick="salvarEdicaoRegistroEvolucao(${r.id})">
                    <i class="fa-solid fa-floppy-disk"></i> Salvar
                </button>
            </div>
        </div>
    </div>`;
}

function fichaevoEntrarEdicao(id) {
    document.querySelector(`.fichaevo-view-${id}`).style.display = 'none';
    document.querySelector(`.fichaevo-edit-${id}`).style.display = 'block';
}

function fichaevoCancelarEdicao(id) {
    document.querySelector(`.fichaevo-view-${id}`).style.display = 'block';
    document.querySelector(`.fichaevo-edit-${id}`).style.display = 'none';
}

async function adicionarRegistroEvolucao() {
    const pacienteId = document.getElementById('fichaevo-paciente-id').value;
    const data  = document.getElementById('fichaevo-nova-data').value;
    const texto = document.getElementById('fichaevo-novo-texto').value.trim();
    if (!data) { showToast('Informe a data do atendimento.'); return; }
    if (!texto) { showToast('Escreva o registro antes de salvar.'); return; }
    try {
        await ipc('db-salvar-ficha-evolucao', { pacienteId, data, texto });
    } catch (err) {
        console.warn('Falha ao salvar ficha de evolução:', err);
        showToast('Erro ao salvar registro.');
        return;
    }
    document.getElementById('fichaevo-novo-texto').value = '';
    document.getElementById('fichaevo-nova-data').value = new Date().toISOString().slice(0, 10);
    // Sai do modo foco (se ativo) e recolhe o formulário de volta ao botão
    if (document.body.classList.contains('modo-foco-fichaevo-ativo')) {
        _focoFichaEvoDesativar();
    }
    fichaevoFecharFormNovo();
    showToast('Registro adicionado à Ficha de Evolução!');
    sincronizarBackupDrive();
    const pacFichaEvo = pacientes.find(p => String(p.id) === String(pacienteId));
    if (pacFichaEvo) dispararAtualizacaoPdf(pacFichaEvo.id, pacFichaEvo.nome);
    await carregarListaFichaEvolucao(pacienteId);
}

async function salvarEdicaoRegistroEvolucao(id) {
    const pacienteId = document.getElementById('fichaevo-paciente-id').value;
    const data  = document.getElementById(`fichaevo-edit-data-${id}`).value;
    const texto = document.getElementById(`fichaevo-edit-texto-${id}`).value.trim();
    if (!data || !texto) { showToast('Preencha data e registro.'); return; }
    try {
        await ipc('db-atualizar-ficha-evolucao', { id, data, texto });
    } catch (err) {
        console.warn('Falha ao atualizar ficha de evolução:', err);
        showToast('Erro ao atualizar registro.');
        return;
    }
    showToast('Registro atualizado!');
    sincronizarBackupDrive();
    const pacFichaEvoEdit = pacientes.find(p => String(p.id) === String(pacienteId));
    if (pacFichaEvoEdit) dispararAtualizacaoPdf(pacFichaEvoEdit.id, pacFichaEvoEdit.nome);
    await carregarListaFichaEvolucao(pacienteId);
}

async function excluirRegistroEvolucao(id) {
    if (!confirm('Excluir este registro da Ficha de Evolução? Esta ação não pode ser desfeita.')) return;
    const pacienteId = document.getElementById('fichaevo-paciente-id').value;
    try {
        await ipc('db-excluir-ficha-evolucao', id);
    } catch (err) {
        console.warn('Falha ao excluir ficha de evolução:', err);
        showToast('Erro ao excluir registro.');
        return;
    }
    showToast('Registro excluído.');
    sincronizarBackupDrive();
    const pacFichaEvoDel = pacientes.find(p => String(p.id) === String(pacienteId));
    if (pacFichaEvoDel) dispararAtualizacaoPdf(pacFichaEvoDel.id, pacFichaEvoDel.nome);
    await carregarListaFichaEvolucao(pacienteId);
}

// ══════════════════════════════════════════════════════════════
// Página consolidada com todos os registros da Ficha de Evolução,
// pronta pra impressão / "Salvar como PDF" (mesmo padrão usado nos
// outros documentos do sistema — abre janela de impressão e também
// grava uma cópia automática na pasta do paciente).
// ══════════════════════════════════════════════════════════════
async function abrirFichaEvolucaoPDF() {
    const pacienteId = document.getElementById('fichaevo-paciente-id').value;
    const nomePaciente = document.getElementById('fichaevo-nome-paciente').innerText || '';
    if (!pacienteId) { showToast('Selecione um paciente primeiro.'); return; }

    let registros = [];
    try {
        registros = await ipc('db-listar-fichas-evolucao', pacienteId) || [];
    } catch (err) {
        console.warn('Falha ao carregar ficha de evolução para PDF:', err);
        showToast('Erro ao carregar registros.');
        return;
    }
    if (!registros.length) { showToast('Não há registros para exportar ainda.'); return; }

    // Ordem cronológica (mais antigo primeiro) para leitura de evolução
    const ordenados = [...registros].sort((a, b) => (a.data || '').localeCompare(b.data || '') || a.id - b.id);

    const profNome = usuarioLogado?.nome || 'Profissional Responsável';
    const profCRP  = usuarioLogado?.crp  || '';
    let clinica = 'Consultório';
    try {
        const cfg = (typeof ipcRenderer !== 'undefined') ? await ipc('db-get-config') : {};
        if (cfg && cfg.nome_clinica) clinica = cfg.nome_clinica;
    } catch (e) {}

    const corpoRegistros = ordenados.map(r => `
        <div class="registro-item">
            <p class="registro-data">${fichaevoFormatarData(r.data)}</p>
            <p class="registro-texto">${fichaevoEsc(r.texto).replace(/\n/g, '<br>')}</p>
        </div>`).join('<hr>');

    const montarHtml = (comEstilosDeImpressao) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
        <title>Ficha de Evolução — ${fichaevoEsc(nomePaciente)}</title>
        <style>
            *{box-sizing:border-box;margin:0;padding:0;}
            body{font-family:'Georgia',serif;color:#1e293b;padding:3cm 2.5cm;font-size:11pt;}
            h2{font-size:14pt;color:#1e293b;margin-bottom:.25rem;}
            .doc-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1e293b;padding-bottom:.75rem;margin-bottom:2rem;}
            .doc-header h1{font-size:13pt;}
            .doc-header p{font-size:9pt;color:#64748b;}
            .registro-data{font-weight:700;color:#7c3aed;font-size:10.5pt;margin-bottom:.25rem;}
            .registro-texto{line-height:1.7;white-space:pre-wrap;}
            hr{border:none;border-top:1px solid #cbd5e1;margin:1.1rem 0;}
            .doc-footer{border-top:1px solid #cbd5e1;margin-top:3rem;padding-top:.75rem;text-align:center;font-size:9pt;color:#94a3b8;}
            ${comEstilosDeImpressao ? '@media print{body{padding:2cm;}}' : ''}
        </style></head><body>
        <div class="doc-header">
            <div><h1>${clinica || profNome}</h1><p>${clinica ? (profNome + (profCRP ? ' — CRP ' + profCRP : '')) : (profCRP ? 'CRP ' + profCRP : 'Psicólogo(a)')}</p></div>
            <div style="text-align:right;"><p>${new Date().toLocaleDateString('pt-BR')}</p></div>
        </div>
        <h2>Ficha de Evolução</h2>
        <p style="color:#64748b;font-size:9.5pt;margin-bottom:1.5rem;">Paciente: <strong>${fichaevoEsc(nomePaciente)}</strong> — ${ordenados.length} registro(s)</p>
        ${corpoRegistros}
        <div class="doc-footer">
            <p>Documento emitido pelo sistema de gestão — ${clinica}</p>
            <p>As informações são de caráter confidencial e protegidas pelo sigilo profissional.</p>
        </div>
        ${comEstilosDeImpressao ? '<script>window.onload=()=>{window.print();}<\/script>' : ''}
    </body></html>`;

    // Abre página pronta para visualizar/imprimir/"Salvar como PDF" pelo navegador
    const win = window.open('', '_blank', 'width=860,height=700');
    win.document.write(montarHtml(true));
    win.document.close();

    // Também salva automaticamente uma cópia em PDF na pasta do paciente
    try {
        await ipc('salvar-pdf-documento', {
            htmlConteudo: montarHtml(false),
            nomePaciente: nomePaciente,
            nomeArquivo: 'Ficha_de_Evolucao'
        });
        showToast('PDF salvo na pasta do paciente!');
    } catch (e) {
        console.warn('Erro ao salvar PDF da Ficha de Evolução:', e);
    }
}

function docAbrirFaltas() {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    const p = _docPacienteSelecionado;
    const nomeEl = document.getElementById('faltas-nome-paciente');
    if (nomeEl) nomeEl.textContent = p.nome;
    const idEl = document.getElementById('faltas-paciente-id');
    if (idEl) idEl.value = p.id;

    // Calcula faltas do paciente a partir das consultas
    const faltasPac = consultas.filter(c =>
        String(c.pacienteId || c.paciente_id) === String(p.id) &&
        (c.status === 'falta' || c.status === 'ausente' || c.falta)
    );
    const semAviso  = faltasPac.filter(c => c.status === 'falta' || !c.avisou).length;
    const cobradas  = faltasPac.filter(c => c.falta_cobrada).length;

    const totalEl   = document.getElementById('faltas-total');
    const savEl     = document.getElementById('faltas-sem-aviso');
    const cobEl     = document.getElementById('faltas-cobradas');
    if (totalEl) totalEl.textContent  = faltasPac.length;
    if (savEl)   savEl.textContent    = semAviso;
    if (cobEl)   cobEl.textContent    = cobradas;

    const listaEl = document.getElementById('faltas-lista');
    if (listaEl) {
        if (!faltasPac.length) {
            listaEl.innerHTML = '<p style="font-size:.85rem;color:#64748b;text-align:center;padding:1rem;">Nenhuma falta registrada.</p>';
        } else {
            listaEl.innerHTML = faltasPac
                .sort((a, b) => (b.data || '').localeCompare(a.data || ''))
                .map(c => {
                    const dataBr = c.data ? c.data.split('-').reverse().join('/') : '—';
                    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;border:1px solid #fee2e2;border-radius:.4rem;margin-bottom:.4rem;background:#fff5f5;">
                        <span style="font-size:.85rem;"><strong>${dataBr}</strong>${c.hora ? ' — ' + c.hora + 'h' : ''}</span>
                        <span style="font-size:.75rem;color:#dc2626;">${c.falta_cobrada ? '💰 Cobrada' : 'Não cobrada'}</span>
                    </div>`;
                }).join('');
        }
    }
    document.getElementById('modal-faltas').style.display = 'flex';
}

function fecharModalFaltas() {
    document.getElementById('modal-faltas').style.display = 'none';
}

function docAbrirProgresso() {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    const p    = _docPacienteSelecionado;
    const hoje = new Date().toISOString().slice(0, 10);
    const profNome = usuarioLogado?.nome || '';
    const profCRP  = usuarioLogado?.crp  || '';

    const progPac = document.getElementById('prog-paciente');
    if (progPac) progPac.value = p.nome;
    const progPsi = document.getElementById('prog-psicologo');
    if (progPsi) progPsi.value = profNome + (profCRP ? ' — CRP ' + profCRP : '');
    const progData = document.getElementById('prog-data-relatorio');
    if (progData) progData.value = hoje;
    const progDFim = document.getElementById('prog-data-fim');
    if (progDFim) progDFim.value = hoje;

    // Limpa campos de texto
    ['prog-queixa-inicial','prog-objetivos','prog-evolucao','prog-dificuldades','prog-tecnicas','prog-num-sessoes','prog-recomendacoes','prog-data-ini'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    document.getElementById('modal-relatorio-progresso').style.display = 'flex';
}

// ====== ATESTADO ======
function docAbrirAtestado() {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    abrirFormAtestado();
}
function abrirFormAtestado() {
    const hoje = new Date().toISOString().split('T')[0];
    document.getElementById('atestado-data').value     = hoje;
    document.getElementById('atestado-data-fim').value = hoje;
    // Pré-preenche com dados do usuário logado
    const profNomePre = usuarioLogado?.nome || '';
    const profCRPPre  = usuarioLogado?.crp  || '';
    const campoNome   = document.getElementById('atestado-psicologo');
    const campoCRP    = document.getElementById('atestado-crp');
    if (campoNome && !campoNome.value) campoNome.value = profNomePre;
    if (campoCRP  && !campoCRP.value)  campoCRP.value  = profCRPPre;
    document.getElementById('modal-atestado-form').style.display = 'flex';
}
function fecharFormAtestado() { document.getElementById('modal-atestado-form').style.display = 'none'; document.getElementById('form-gerar-atestado').reset(); }

document.getElementById('form-gerar-atestado').addEventListener('submit', async function(e) {
    e.preventDefault();
    dadosAtestadoTemporario = {
        pacienteId: _docPacienteSelecionado?.id,
        psicologo:  document.getElementById('atestado-psicologo').value,
        crp:        document.getElementById('atestado-crp').value,
        condicao:   document.getElementById('atestado-condicao').value,
        dias:       document.getElementById('atestado-dias').value,
        dataInicio: document.getElementById('atestado-data').value,
        dataFim:    document.getElementById('atestado-data-fim').value
    };
    document.getElementById('modal-atestado-form').style.display = 'none';
    document.getElementById('form-gerar-atestado').reset();
    await gerarAtestadoPDF();
});

function fecharPortalGovbr() { dadosAtestadoTemporario = null; }

async function gerarAtestadoPDF() {
    if (!dadosAtestadoTemporario) { alert("Erro ao recuperar parâmetros."); return; }
    const paciente = pacientes.find(p => String(p.id) === String(dadosAtestadoTemporario.pacienteId));
    if (!paciente) { alert("Paciente não localizado."); return; }

    const dataInicioBr = dadosAtestadoTemporario.dataInicio.split('-').reverse().join('/');
    const dataFimBr    = dadosAtestadoTemporario.dataFim.split('-').reverse().join('/');
    const hojeObj      = new Date();
    const meses        = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
    const dataExtenso  = `${hojeObj.getDate()} de ${meses[hojeObj.getMonth()]} de ${hojeObj.getFullYear()}`;

    // Puxa nome da clínica do banco (se não configurado ainda, deixa vazio)
    let nomeClinica = '';
    try {
        const cfg = (typeof ipcRenderer !== 'undefined') ? await ipc('db-get-config') : {};
        if (cfg && cfg.nome_clinica) nomeClinica = cfg.nome_clinica;
    } catch(e) {}

    const psic = dadosAtestadoTemporario.psicologo;
    const crp  = dadosAtestadoTemporario.crp;

    const win = window.open('', '_blank', 'width=860,height=700');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
        <title>Atestado Psicológico — ${paciente.nome}</title>
        <style>
            *{box-sizing:border-box;margin:0;padding:0;}
            body{font-family:'Georgia',serif;color:#1e293b;padding:3cm 2.5cm;font-size:11pt;}
            h2{font-size:14pt;color:#1e293b;margin-bottom:.5rem;}
            p{margin-bottom:.75rem;line-height:1.9;}
            .doc-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1e293b;padding-bottom:.75rem;margin-bottom:2.5rem;}
            .doc-header h1{font-size:13pt;}
            .doc-header p{font-size:9pt;color:#64748b;}
            .titulo{text-align:center;margin-bottom:2rem;}
            .assinatura{margin-top:4rem;text-align:center;}
            .assinatura .linha{display:inline-block;border-top:1px solid #334155;padding-top:.5rem;min-width:300px;}
            .doc-footer{border-top:1px solid #cbd5e1;margin-top:3rem;padding-top:.75rem;text-align:center;font-size:9pt;color:#94a3b8;}
            @media print{body{padding:2cm;}}
        </style></head><body>
        <div class="doc-header">
            <div><h1>${nomeClinica || psic}</h1><p>${nomeClinica ? (psic + (crp ? ' — CRP ' + crp : '')) : (crp ? 'CRP ' + crp : 'Psicólogo(a)')}</p></div>
            <div style="text-align:right;"><p>${hojeObj.toLocaleDateString('pt-BR')}</p></div>
        </div>
        <div class="titulo">
            <h2>ATESTADO PSICOLÓGICO</h2>
            <p style="color:#64748b;font-size:.9em;margin-top:.3rem;">Documento de caráter sigiloso</p>
        </div>
        <p>Eu, <strong>${psic}</strong>${crp ? `, inscrito(a) no CRP sob o número <strong>${crp}</strong>,` : ','} declaro que o(a) paciente <strong>${paciente.nome}</strong>${paciente.cpf ? `, portador(a) do CPF nº <strong>${paciente.cpf}</strong>,` : ','} encontra-se sob acompanhamento psicológico neste consultório.</p>
        <p>Atesto que o(a) paciente apresenta <strong>${dadosAtestadoTemporario.condicao}</strong>, sendo recomendado o afastamento de suas atividades pelo período de <strong>${dadosAtestadoTemporario.dias} ${Number(dadosAtestadoTemporario.dias) === 1 ? 'dia' : 'dias'}</strong>, compreendido entre <strong>${dataInicioBr}</strong> e <strong>${dataFimBr}</strong>.</p>
        <p>Por ser expressão da verdade, firmo o presente atestado.</p>
        <p style="margin-top:1.5rem;">${dataExtenso}.</p>
        <div class="assinatura">
            <div class="linha">
                <p style="font-weight:700;font-size:1em;">${psic}</p>
                <p style="font-size:.85em;color:#64748b;">${crp ? `CRP ${crp}` : 'Psicólogo(a)'} — Psicólogo(a)</p>
            </div>
        </div>
        <div class="doc-footer">
            <p>Documento emitido pelo sistema de gestão — ${nomeClinica}</p>
            <p>As informações são de caráter confidencial e protegidas pelo sigilo profissional.</p>
        </div>
        <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
    win.document.close();

    const logTexto = `[ATESTADO EMITIDO]\nProfissional: ${psic}\nCondição: ${dadosAtestadoTemporario.condicao}\nPeríodo: ${dadosAtestadoTemporario.dias} dias (${dataInicioBr} a ${dataFimBr}).`;
    await ipc('db-salvar-consulta', { pacienteId: dadosAtestadoTemporario.pacienteId, data: dadosAtestadoTemporario.dataInicio, texto: logTexto });
    consultas = await ipc('db-todas-consultas') || [];
    sincronizarBackupDrive();
    dadosAtestadoTemporario = null;
}

// Mantido por compatibilidade (botão antigo do govbr)
async function simularAssinaturaFinal() { await gerarAtestadoPDF(); }

function fecharViewAtestado() { document.getElementById('modal-atestado-view').style.display = 'none'; }

// ====== FINANCEIRO ======
// ── Paginação de pagamentos ────────────────────────────────
let _pagAtual       = 0;
let _pagTamanho     = 50;
let _pagFiltrados   = [];

// Estado dos acordeões abertos e filtro interno por paciente
let _pacAcordeoAberto = {};   // { pacienteId: true/false }
let _pacFiltroStatus  = {};   // { pacienteId: '' | 'Pago' | 'Pendente' }

// Cache de nomes para não buscar toda vez
let _nomesPacCache  = {};
function _nomePac(id) {
    if (!id) return '—';
    if (_nomesPacCache[id]) return _nomesPacCache[id];
    const p = pacientes.find(p => String(p.id) === String(id));
    _nomesPacCache[id] = p ? p.nome : '—';
    return _nomesPacCache[id];
}

function filtrarPagamentos() {
    const busca  = (document.getElementById('busca-pagamentos')?.value || '').toLowerCase().trim();
    const status = document.getElementById('filtro-status-pag')?.value  || '';
    const forma  = document.getElementById('filtro-forma-pag')?.value   || '';
    const dataDE = document.getElementById('filtro-data-de')?.value     || '';
    const dataATE= document.getElementById('filtro-data-ate')?.value    || '';

    _pagFiltrados = pagamentos
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => {
            const id   = p.paciente_id || p.pacienteId || p.paciente;
            const nome = _nomePac(id).toLowerCase();
            if (busca  && !nome.includes(busca))      return false;
            if (status && p.status !== status)         return false;
            if (forma  && p.forma  !== forma)          return false;
            if (dataDE && p.data   <  dataDE)          return false;
            if (dataATE && p.data  >  dataATE)         return false;
            return true;
        })
        .map(({ i }) => i);

    _pagAtual = 0;
    renderizarPaginaPagamentos();
}

function renderizarPaginaPagamentos() {
    const container = document.getElementById('lista-pagamentos-agrupada');
    if (!container) return;

    const elTotal = document.getElementById('total-pagamentos-count');
    const elFilt  = document.getElementById('pag-count-filtrado');
    if (elTotal) elTotal.innerText = pagamentos.length;
    if (elFilt)  elFilt.innerText  = _pagFiltrados.length;

    if (_pagFiltrados.length === 0) {
        container.innerHTML = '<div style="text-align:center;color:#9ca3af;font-style:italic;padding:2.5rem 0;">Nenhum lançamento encontrado.</div>';
        return;
    }

    // Agrupar por paciente
    const grupos = {};
    _pagFiltrados.forEach(index => {
        const pag = pagamentos[index];
        const id  = String(pag.paciente_id || pag.pacienteId || pag.paciente || '—');
        if (!grupos[id]) grupos[id] = { nome: _nomePac(id), itens: [] };
        grupos[id].itens.push({ pag, index });
    });

    // Ordenar grupos por nome
    const gruposOrdenados = Object.entries(grupos).sort((a,b) => a[1].nome.localeCompare(b[1].nome));

    container.innerHTML = gruposOrdenados.map(([pacId, grupo]) => {
        const totalQuitado  = grupo.itens.filter(({pag}) => pag.status === 'Pago').reduce((s,{pag}) => s + parseFloat(pag.valor||0), 0);
        const totalAberto   = grupo.itens.filter(({pag}) => pag.status !== 'Pago').reduce((s,{pag}) => s + parseFloat(pag.valor||0), 0);
        const qtdQuitado    = grupo.itens.filter(({pag}) => pag.status === 'Pago').length;
        const qtdAberto     = grupo.itens.filter(({pag}) => pag.status !== 'Pago').length;
        const inicial       = grupo.nome.charAt(0).toUpperCase();
        const estaAberto    = _pacAcordeoAberto[pacId] || false;
        const filtroAtual   = _pacFiltroStatus[pacId] || '';
        const abertoCls     = estaAberto ? ' aberto' : '';

        // Linhas filtradas pelo toggle interno
        const itensFiltrados = filtroAtual
            ? grupo.itens.filter(({pag}) => pag.status === filtroAtual)
            : grupo.itens;

        const linhas = itensFiltrados.sort((a,b) => (b.pag.data||'').localeCompare(a.pag.data||'')).map(({pag, index}) => {
            const dataFmt = pag.data ? pag.data.split('-').reverse().join('/') : 'S/D';
            const forma   = pag.forma || 'N/I';
            const isPago  = pag.status === 'Pago';
            const acao    = isPago
                ? `<button class="btn-action" onclick="gerarRecibo(${index})"><i class="fa-solid fa-print"></i> Recibo</button>`
                : `<button class="btn-blue-action" onclick="darBaixaPagamento(${index})"><i class="fa-solid fa-check"></i> Receber</button>`;
            return `<tr>
                <td>R$ ${parseFloat(pag.valor||0).toFixed(2).replace('.',',')}</td>
                <td>${dataFmt}</td>
                <td><span class="forma-tag">${formaIcone(forma)} ${forma}</span></td>
                <td><span class="badge-status ${isPago?'pago':'pendente'}">${isPago?'Quitado':'Em Aberto'}</span></td>
                <td style="display:flex;gap:4px;">
                    ${acao}
                    <button class="btn-action" onclick="abrirModalEditarPagamento(${index})"><i class="fa-solid fa-pen"></i></button>
                </td>
            </tr>`;
        }).join('');

        return `<div class="pac-pag-card${abertoCls}" id="card-pac-${pacId}">
            <div class="pac-pag-header" onclick="togglePacPag('${pacId}')">
                <div class="pac-pag-avatar">${inicial}</div>
                <span class="pac-pag-nome">${grupo.nome}</span>
                <div class="pac-pag-chips">
                    ${qtdQuitado > 0 ? `<span class="pac-pag-chip quitado"><i class="fa-solid fa-check"></i> ${qtdQuitado} quitado${qtdQuitado>1?'s':''} · R$ ${totalQuitado.toFixed(2).replace('.',',')}</span>` : ''}
                    ${qtdAberto  > 0 ? `<span class="pac-pag-chip aberto"><i class="fa-solid fa-clock"></i> ${qtdAberto} em aberto · R$ ${totalAberto.toFixed(2).replace('.',',')}</span>` : ''}
                </div>
                <i class="fa-solid fa-chevron-down pac-pag-chevron"></i>
            </div>
            <div class="pac-pag-body">
                <div class="pac-pag-filtro">
                    <button class="pac-pag-filtro-btn${filtroAtual===''?' ativo':''}" onclick="filtrarStatusPac('${pacId}','')">Todos</button>
                    ${qtdQuitado > 0 ? `<button class="pac-pag-filtro-btn quitado${filtroAtual==='Pago'?' ativo quitado':''}" onclick="filtrarStatusPac('${pacId}','Pago')">Quitados</button>` : ''}
                    ${qtdAberto  > 0 ? `<button class="pac-pag-filtro-btn aberto${filtroAtual==='Pendente'?' ativo aberto':''}" onclick="filtrarStatusPac('${pacId}','Pendente')">Em Aberto</button>` : ''}
                </div>
                <table class="pac-pag-table">
                    <thead><tr><th>Valor</th><th>Data</th><th>Forma</th><th>Status</th><th>Ações</th></tr></thead>
                    <tbody>${linhas || '<tr><td colspan="5" style="text-align:center;color:#9ca3af;padding:1rem;">Nenhum lançamento para este filtro.</td></tr>'}</tbody>
                </table>
            </div>
        </div>`;
    }).join('');
}

function togglePacPag(pacId) {
    _pacAcordeoAberto[pacId] = !_pacAcordeoAberto[pacId];
    renderizarPaginaPagamentos();
}

function filtrarStatusPac(pacId, status) {
    event.stopPropagation();
    _pacFiltroStatus[pacId] = status;
    renderizarPaginaPagamentos();
}

function pagAnterior() { if (_pagAtual > 0) { _pagAtual--; renderizarPaginaPagamentos(); } }
function pagProxima()  { const max = Math.ceil(_pagFiltrados.length / _pagTamanho) - 1; if (_pagAtual < max) { _pagAtual++; renderizarPaginaPagamentos(); } }
function mudarTamanhoPagina() {
    const sel = document.getElementById('pag-tamanho');
    _pagTamanho = parseInt(sel?.value || '50');
    _pagAtual = 0;
    renderizarPaginaPagamentos();
}

function atualizarTelaPagamentos() {
    _nomesPacCache = {}; // limpa cache ao recarregar
    _pagAtual = 0;
    _pagFiltrados = pagamentos.map((_, i) => i);
    renderizarPaginaPagamentos();
}

function limparFiltrosPagamentos() {
    const busca = document.getElementById('busca-pagamentos');
    const status = document.getElementById('filtro-status-pag');
    const forma  = document.getElementById('filtro-forma-pag');
    const dataDE = document.getElementById('filtro-data-de');
    const dataATE= document.getElementById('filtro-data-ate');
    if (busca)  busca.value  = '';
    if (status) status.value = '';
    if (forma)  forma.value  = '';
    if (dataDE) dataDE.value = '';
    if (dataATE)dataATE.value= '';
    filtrarPagamentos();
}

function formaIcone(forma) {
    const mapa = { 'PIX': '<i class="fa-brands fa-pix" style="color:#00bdae;"></i>', 'Dinheiro': '<i class="fa-solid fa-money-bill-wave" style="color:#16a34a;"></i>', 'Cartão de Débito': '<i class="fa-solid fa-credit-card" style="color:#2563eb;"></i>', 'Cartão de Crédito': '<i class="fa-solid fa-credit-card" style="color:#7c3aed;"></i>', 'Transferência': '<i class="fa-solid fa-right-left" style="color:#0891b2;"></i>', 'Convênio': '<i class="fa-solid fa-shield-halved" style="color:#d97706;"></i>' };
    return mapa[forma] || '<i class="fa-solid fa-circle-question" style="color:#94a3b8;"></i>';
}

function abrirModalPagamento() {
    indexPagamentoEdicao = -1;
    const select = document.getElementById('select-paciente');
    select.innerHTML = '<option value="">-- Clique e Escolha o Paciente --</option>';
    pacientes.forEach(p => { select.innerHTML += `<option value="${p.id}" data-nome="${p.nome}" data-cpf="${p.cpf}">${p.nome}</option>`; });
    document.getElementById('bloco-historico-financeiro-paciente').style.display = 'none';
    document.getElementById('data-pago').value = new Date().toISOString().split('T')[0];
    document.getElementById('modal-pagamento').style.display = 'flex';
}

function fecharModalPagamento() { document.getElementById('modal-pagamento').style.display = 'none'; document.getElementById('form-pagamento').reset(); indexPagamentoEdicao = -1; }

function selecionarPacienteParaPainelFinanceiro() {
    const select = document.getElementById('select-paciente');
    if (!select.value) { document.getElementById('bloco-historico-financeiro-paciente').style.display = 'none'; return; }
    statusFiltroFinanceiroAtual = 'Todos';
    renderizarPainelFinanceiroPaciente();
}

function filtrarStatusFinanceiroPaciente(status) { statusFiltroFinanceiroAtual = status; renderizarPainelFinanceiroPaciente(); }

function toggleHistoricoFinanceiro() {
    const conteudo = document.getElementById('conteudo-historico-fin');
    const icone = document.getElementById('icone-toggle-historico');
    const aberto = conteudo.style.display !== 'none';
    conteudo.style.display = aberto ? 'none' : 'block';
    icone.style.transform = aberto ? 'rotate(0deg)' : 'rotate(180deg)';
}

function renderizarPainelFinanceiroPaciente() {
    const pId = document.getElementById('select-paciente').value;
    const containerLista = document.getElementById('lista-financeira-interna-paciente');
    document.querySelectorAll('.btn-filtro-fin').forEach(b => b.classList.remove('active'));
    const btnFiltro = document.getElementById('filtro-fin-' + statusFiltroFinanceiroAtual.toLowerCase());
    if (btnFiltro) btnFiltro.classList.add('active');
    const getPid = p => String(p.pacienteId || p.paciente_id);
    let totalPago = pagamentos.filter(p => getPid(p) === pId && p.status === 'Pago').reduce((s,p) => s + parseFloat(p.valor), 0);
    let totalPendente = pagamentos.filter(p => getPid(p) === pId && p.status === 'Pendente').reduce((s,p) => s + parseFloat(p.valor), 0);
    document.getElementById('pnl-total-pago').innerText = `R$ ${totalPago.toFixed(2).replace('.', ',')}`;
    document.getElementById('pnl-total-pendente').innerText = `R$ ${totalPendente.toFixed(2).replace('.', ',')}`;

    // Atualiza o resumo inline no header (visível mesmo colapsado)
    const resumoEl = document.getElementById('resumo-inline-historico');
    if (resumoEl) {
        const partes = [];
        if (totalPago > 0) partes.push(`✓ R$ ${totalPago.toFixed(2).replace('.', ',')}`);
        if (totalPendente > 0) partes.push(`⚠ R$ ${totalPendente.toFixed(2).replace('.', ',')} pendente`);
        resumoEl.textContent = partes.length ? `— ${partes.join('  ')}` : '';
    }

    let lancamentos = pagamentos.map((p, idx) => ({ ...p, idGlobal: idx })).filter(p => getPid(p) === pId);
    if (statusFiltroFinanceiroAtual !== 'Todos') lancamentos = lancamentos.filter(p => p.status === statusFiltroFinanceiroAtual);
    containerLista.innerHTML = '';
    document.getElementById('bloco-historico-financeiro-paciente').style.display = 'block';
    if (lancamentos.length === 0) { containerLista.innerHTML = `<p style="color:#94a3b8;font-style:italic;font-size:0.8rem;text-align:center;padding:1rem 0;">Nenhum lançamento encontrado.</p>`; return; }
    lancamentos.sort((a,b) => new Date(b.data) - new Date(a.data));
    lancamentos.forEach(p => {
        const dataBr = p.data.split('-').reverse().join('/');
        const badgeCor = p.status === 'Pago' ? 'background:#d1fae5;color:#065f46;' : 'background:#fee2e2;color:#991b1b;';
        const acaoInterna = p.status === 'Pendente' ? `<button type="button" class="btn-blue-action" style="font-size:0.7rem;padding:2px 6px;" onclick="abrirBaixaPagamentoManual(${p.idGlobal})"><i class="fa-solid fa-edit"></i> Lançar</button>` : '';
        const div = document.createElement('div');
        div.className = 'fin-item-interna';
        div.innerHTML = `<div><span style="font-weight:700;color:#1e293b;">R$ ${parseFloat(p.valor).toFixed(2).replace('.', ',')}</span><span style="color:#64748b;font-size:0.75rem;margin-left:0.5rem;">(${dataBr})</span></div><div style="display:flex;gap:5px;align-items:center;"><span class="badge-status" style="${badgeCor}font-size:0.7rem;padding:0.15rem 0.4rem;">${p.status === 'Pago' ? 'Quitado' : 'Aberto'}</span>${acaoInterna}</div>`;
        containerLista.appendChild(div);
    });
}

function abrirBaixaPagamentoManual(indexGlobal) {
    indexPagamentoEdicao = indexGlobal;
    const pag = pagamentos[indexGlobal];
    document.getElementById('valor-pago').value = pag.valor;
    document.getElementById('data-pago').value = pag.data;
    document.getElementById('status-pago').value = 'Pago';
    const campoForma = document.getElementById('forma-pagamento');
    if (campoForma && pag.forma) campoForma.value = pag.forma;
    document.getElementById('status-pago').focus();
}

// Preenche valor padrão ao mudar modalidade
document.addEventListener('DOMContentLoaded', () => {
    const selMod = document.getElementById('modalidade-pagamento');
    if (selMod) {
        selMod.addEventListener('change', async () => {
            const cfg = await ipc('db-get-config') || {};
            const campoValor = document.getElementById('valor-pago');
            if (!campoValor || campoValor.value > 0) return;
            if (selMod.value === 'online' && cfg.valor_online > 0) {
                campoValor.value = parseFloat(cfg.valor_online).toFixed(2);
            } else if (selMod.value === 'presencial' && cfg.valor_presencial > 0) {
                campoValor.value = parseFloat(cfg.valor_presencial).toFixed(2);
            }
        });
    }
});

document.getElementById('form-pagamento').addEventListener('submit', async function(e) {
    e.preventDefault();
    const select = document.getElementById('select-paciente');
    const opcao = select.options[select.selectedIndex];
    if (!select.value) { alert('Selecione um paciente.'); return; }
    const statusSelecionado = document.getElementById('status-pago').value;
    const valorInserido = document.getElementById('valor-pago').value;
    const dataInserida = document.getElementById('data-pago').value;
    let indexDestino = indexPagamentoEdicao;
    if (indexPagamentoEdicao === -1) {
        const modalidadePag = document.getElementById('modalidade-pagamento');
        const novoPagamento = {
            pacienteId:  select.value,
            pacienteNome: opcao.getAttribute('data-nome'),
            pacienteCpf:  opcao.getAttribute('data-cpf'),
            valor:        valorInserido,
            status:       statusSelecionado,
            data:         dataInserida,
            forma:        document.getElementById('forma-pagamento').value || 'Não informado',
            modalidade:   modalidadePag ? modalidadePag.value : 'presencial'
        };
        const resultado = await ipc('db-salvar-pagamento', novoPagamento);
        if (resultado && resultado.ok === false) {
            alert('Não foi possível salvar o pagamento:\n' + resultado.erro);
            return;
        }
    } else {
        const pag = pagamentos[indexPagamentoEdicao];
        const resultadoEdicao = await ipc('db-salvar-pagamento', { id: pag.id, pacienteId: pag.pacienteId || pag.paciente_id, pacienteNome: pag.pacienteNome, pacienteCpf: pag.pacienteCpf, valor: valorInserido, status: statusSelecionado, data: dataInserida, forma: document.getElementById('forma-pagamento').value || pag.forma || 'Não informado' });
        if (resultadoEdicao && resultadoEdicao.ok === false) {
            alert('Não foi possível salvar o pagamento:\n' + resultadoEdicao.erro);
            return;
        }
    }
    pagamentos = await ipc('db-todos-pagamentos') || [];
    indexPagamentoEdicao = -1;
    document.getElementById('valor-pago').value = '';
    atualizarTelaPagamentos();
    renderizarPainelFinanceiroPaciente();
    sincronizarBackupDrive();
    const pacienteFin = pacientes.find(p => String(p.id) === String(select.value));
    if (pacienteFin) dispararAtualizacaoPdf(pacienteFin.id, pacienteFin.nome);
    if (statusSelecionado === 'Pago') {
        const indice = pagamentos.length - 1;
        gerarReciboEImprimir(indice);
    }
});

async function darBaixaPagamento(index) {
    const pag = pagamentos[index];
    await ipc('db-salvar-pagamento', { ...pag, id: pag.id, pacienteId: pag.pacienteId || pag.paciente_id, status: 'Pago' });
    pagamentos = await ipc('db-todos-pagamentos') || [];
    atualizarTelaPagamentos();
    sincronizarBackupDrive();
    gerarReciboEImprimir(index);
}

function abrirModalEditarPagamento(index) {
    const pag = pagamentos[index];
    if (!pag) return;
    document.getElementById('edit-pag-index').value = index;
    document.getElementById('edit-pag-paciente').value = pag.pacienteNome || '';
    document.getElementById('edit-pag-valor').value = pag.valor;
    document.getElementById('edit-pag-status').value = pag.status;
    document.getElementById('edit-pag-data').value = pag.data;
    document.getElementById('edit-pag-forma').value = pag.forma || 'Não informado';
    document.getElementById('modal-editar-pagamento').style.display = 'flex';
}

function fecharModalEditarPagamento() { document.getElementById('modal-editar-pagamento').style.display = 'none'; document.getElementById('form-editar-pagamento').reset(); }

document.getElementById('form-editar-pagamento').addEventListener('submit', async function(e) {
    e.preventDefault();
    const idx = parseInt(document.getElementById('edit-pag-index').value);
    if (isNaN(idx) || idx < 0 || idx >= pagamentos.length) return;
    const pag = pagamentos[idx];
    await ipc('db-salvar-pagamento', { id: pag.id, pacienteId: pag.pacienteId || pag.paciente_id, pacienteNome: pag.pacienteNome, pacienteCpf: pag.pacienteCpf, valor: document.getElementById('edit-pag-valor').value, status: document.getElementById('edit-pag-status').value, data: document.getElementById('edit-pag-data').value, forma: document.getElementById('edit-pag-forma').value });
    pagamentos = await ipc('db-todos-pagamentos') || [];
    atualizarTelaPagamentos();
    atualizarDashboard();
    fecharModalEditarPagamento();
});

function gerarRecibo(index) {
    const pag = pagamentos[index];
    if (!pag || pag.status !== 'Pago') return;
    document.getElementById('conteudo-recibo').innerHTML = `
        <div class="recibo-render">
            <div class="recibo-header"><h2>RECIBO DE PAGAMENTO</h2></div>
            <p style="margin-top:1rem;"><strong>Recebemos de:</strong> ${pag.pacienteNome}</p>
            <p><strong>Inscrito no CPF:</strong> ${pag.pacienteCpf}</p>
            <p><strong>A importância de:</strong> R$ ${parseFloat(pag.valor).toFixed(2).replace('.', ',')}</p>
            <p><strong>Referente a:</strong> Serviços de Atendimento Clínico / Consulta.</p>
            <div style="text-align:right;margin-top:2rem;"><p>Data de Liquidação: ${pag.data.split('-').reverse().join('/')}</p><br><br><p>__________________________________________</p><p>Assinatura do Emitente / Clínica</p></div>
        </div>`;
    document.getElementById('modal-recibo').style.display = 'flex';
}

function gerarReciboEImprimir(index) { gerarRecibo(index); setTimeout(() => window.print(), 200); }
function fecharModalRecibo() { document.getElementById('modal-recibo').style.display = 'none'; }

// ====== RELATÓRIOS ======
function obterNomePacientePagamento(p) {
    if (p.pacienteNome) return p.pacienteNome;
    if (p.paciente_nome) return p.paciente_nome;
    const pid = p.pacienteId || p.paciente_id || p.paciente;
    if (pid) {
        const pac = pacientes.find(x => String(x.id) === String(pid));
        if (pac && pac.nome) return pac.nome;
    }
    return 'Paciente não identificado';
}

function popularDatalistPacientesRelatorio() {
    const dl = document.getElementById('rel-pacientes-datalist');
    if (!dl) return;
    const nomesUnicos = [...new Set((pacientes || []).map(p => p.nome).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    dl.innerHTML = nomesUnicos.map(nome => `<option value="${nome.replace(/"/g, '&quot;')}"></option>`).join('');
}

function aplicarFiltrosRelatorio() {
    popularDatalistPacientesRelatorio();
    const nomeTermo = (document.getElementById('rel-busca-nome').value || '').toLowerCase().trim();
    const status = document.getElementById('rel-status').value;
    const dataIni = document.getElementById('rel-data-ini').value;
    const dataFim = document.getElementById('rel-data-fim').value;
    const partesBusca = nomeTermo ? nomeTermo.split(/\s+/) : [];
    let filtrados = pagamentos.filter(p => {
        const nomePag = obterNomePacientePagamento(p);
        if (partesBusca.length > 0) { const partesNome = nomePag.toLowerCase().split(/\s+/); if (!partesBusca.every(parte => partesNome.some(pn => pn.startsWith(parte)))) return false; }
        if (status !== 'Todos' && p.status !== status) return false;
        if (dataIni && p.data < dataIni) return false;
        if (dataFim && p.data > dataFim) return false;
        return true;
    }).sort((a,b) => new Date(b.data) - new Date(a.data));

    // Inclui pacientes já cadastrados que ainda não possuem nenhum pagamento lançado,
    // para que a busca por nome também os encontre (somente quando não há filtro de status/data ativo).
    let semPagamento = [];
    if (status === 'Todos' && !dataIni && !dataFim) {
        const nomesComPagamento = new Set(pagamentos.map(p => obterNomePacientePagamento(p).toLowerCase().trim()));
        semPagamento = pacientes.filter(pac => {
            if (nomesComPagamento.has((pac.nome || '').toLowerCase().trim())) return false;
            if (partesBusca.length > 0) { const partesNome = (pac.nome || '').toLowerCase().split(/\s+/); if (!partesBusca.every(parte => partesNome.some(pn => pn.startsWith(parte)))) return false; }
            return true;
        });
    }

    const totalPago = filtrados.filter(p => p.status === 'Pago').reduce((s,p) => s + parseFloat(p.valor), 0);
    const totalPendente = filtrados.filter(p => p.status === 'Pendente').reduce((s,p) => s + parseFloat(p.valor), 0);
    document.getElementById('rel-count').innerText = filtrados.length + semPagamento.length;
    document.getElementById('rel-total-geral').innerText = `R$ ${(totalPago + totalPendente).toFixed(2).replace('.', ',')}`;
    document.getElementById('rel-total-pago').innerText = `R$ ${totalPago.toFixed(2).replace('.', ',')}`;
    document.getElementById('rel-total-pendente').innerText = `R$ ${totalPendente.toFixed(2).replace('.', ',')}`;
    const tbody = document.getElementById('rel-lista');
    tbody.innerHTML = '';
    if (filtrados.length === 0 && semPagamento.length === 0) { tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#9ca3af;font-style:italic;padding:2rem 0;">Nenhum lançamento encontrado.</td></tr>`; return; }
    filtrados.forEach(p => {
        const tr = document.createElement('tr');
        const nomePag = obterNomePacientePagamento(p);
        tr.innerHTML = `<td><strong>${nomePag}</strong></td><td>R$ ${parseFloat(p.valor).toFixed(2).replace('.', ',')}</td><td>${p.data.split('-').reverse().join('/')}</td><td><span class="badge-status ${p.status === 'Pago' ? 'pago' : 'pendente'}">${p.status === 'Pago' ? 'Quitado' : 'Em Aberto'}</span></td>`;
        tbody.appendChild(tr);
    });
    semPagamento.forEach(pac => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><strong>${pac.nome}</strong></td><td style="color:#9ca3af;font-style:italic;" colspan="2">Nenhum pagamento lançado</td><td><span class="badge-status pendente">Sem registro</span></td>`;
        tbody.appendChild(tr);
    });
}

function limparFiltrosRelatorio() {
    ['rel-busca-nome','rel-data-ini','rel-data-fim'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('rel-status').value = 'Todos';
    aplicarFiltrosRelatorio();
}

function exportarRelatorioCSV() {
    const nomeTermo = (document.getElementById('rel-busca-nome').value || '').toLowerCase().trim();
    const status = document.getElementById('rel-status').value;
    const dataIni = document.getElementById('rel-data-ini').value;
    const dataFim = document.getElementById('rel-data-fim').value;
    const partesBusca = nomeTermo ? nomeTermo.split(/\s+/) : [];
    let filtrados = pagamentos.filter(p => {
        if (partesBusca.length > 0) { const partesNome = obterNomePacientePagamento(p).toLowerCase().split(/\s+/); if (!partesBusca.every(parte => partesNome.some(pn => pn.startsWith(parte)))) return false; }
        if (status !== 'Todos' && p.status !== status) return false;
        if (dataIni && p.data < dataIni) return false;
        if (dataFim && p.data > dataFim) return false;
        return true;
    }).sort((a,b) => new Date(b.data) - new Date(a.data));
    const linhas = [['Paciente','Valor (R$)','Data','Status']];
    filtrados.forEach(p => linhas.push([obterNomePacientePagamento(p), parseFloat(p.valor).toFixed(2).replace('.', ','), p.data.split('-').reverse().join('/'), p.status === 'Pago' ? 'Quitado' : 'Em Aberto']));
    const csv = linhas.map(l => l.map(c => '"' + c + '"').join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `relatorio_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
}

// ====== ANIVERSARIANTES ======
function verificarAniversariantes() {
    const hoje = new Date();
    const aniversariantes = pacientes.filter(p => {
        if (!p.nascimento) return false;
        const partes = p.nascimento.split('-');
        return parseInt(partes[2]) === hoje.getDate() && parseInt(partes[1]) === hoje.getMonth() + 1;
    });
    const container = document.getElementById('toast-aniversario');
    if (!container) return;
    if (aniversariantes.length === 0) { container.style.display = 'none'; return; }
    const nomes = aniversariantes.map(p => {
        const idade = calcularIdadeNumero(p.nascimento);
        return `<div class="aniv-item"><i class="fa-solid fa-cake-candles"></i> <strong>${p.nome.split(' ')[0]}</strong>${idade ? ' · ' + idade + ' anos' : ''}</div>`;
    }).join('');
    container.innerHTML = `<div class="aniv-header"><span>🎂 ${aniversariantes.length === 1 ? 'Aniversariante de hoje!' : aniversariantes.length + ' aniversariantes hoje!'}</span><button onclick="document.getElementById('toast-aniversario').style.display='none'" class="aniv-fechar"><i class="fa-solid fa-xmark"></i></button></div><div class="aniv-lista">${nomes}</div>`;
    container.style.display = 'block';
}

function calcularIdadeNumero(dataNascimento) {
    if (!dataNascimento) return null;
    const hoje = new Date(), nasc = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return idade >= 0 ? idade : null;
}

// ====== CEP ======
function mascaraCep(input) {
    let v = input.value.replace(/\D/g, '');
    if (v.length > 5) v = v.slice(0, 5) + '-' + v.slice(5);
    input.value = v;
}

async function buscarCep(cep) {
    const numeros = cep.replace(/\D/g, '');
    if (numeros.length !== 8) return;
    const loading = document.getElementById('cep-loading');
    if (loading) loading.style.display = 'inline';
    try {
        const res = await fetch(`https://viacep.com.br/ws/${numeros}/json/`);
        const data = await res.json();
        if (!data.erro) {
            document.getElementById('logradouro').value = data.logradouro || '';
            document.getElementById('cidade').value = data.localidade || '';
            document.getElementById('estado').value = data.uf || '';
            document.getElementById('pais').value = 'Brasil';
        }
    } catch(e) {}
    if (loading) loading.style.display = 'none';
}

// =========================================================
// MÓDULO: DOCUMENTOS CLÍNICOS
// =========================================================

let _docPacienteSelecionado = null;

function docPopularSelect() {
    const sel = document.getElementById('doc-select-paciente');
    if (!sel) return;
    const valorAtual = sel.value;
    sel.innerHTML = '<option value="">-- Selecione um paciente --</option>';
    [...pacientes]
        .filter(p => p.status !== 'inativo')
        .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
        .forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.nome;
            sel.appendChild(opt);
        });
    if (valorAtual) sel.value = valorAtual;
}

function docMostrarPainel(id) {
    // Remove active de todos os painéis e itens do subnav
    document.querySelectorAll('.doc-painel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.doc-subnav-item').forEach(b => b.classList.remove('active'));
    // Ativa o painel e o item correspondente
    const painel = document.getElementById('dpanel-' + id);
    const navBtn = document.getElementById('dnav-' + id);
    if (painel) painel.classList.add('active');
    if (navBtn) navBtn.classList.add('active');
}

function docAtualizarPaciente() {
    const sel = document.getElementById('doc-select-paciente');
    _docPacienteSelecionado = pacientes.find(p => String(p.id) === String(sel.value)) || null;
    const bar    = document.getElementById('doc-paciente-bar');
    const nome   = document.getElementById('doc-pac-nome');
    const sub    = document.getElementById('doc-pac-sub');
    const avatar = document.getElementById('doc-pac-avatar');
    if (_docPacienteSelecionado) {
        const p = _docPacienteSelecionado;
        const iniciais = p.nome.split(' ').slice(0,2).map(n => n[0]).join('').toUpperCase();
        if (avatar) avatar.textContent = iniciais;
        if (nome)   nome.textContent   = p.nome;
        if (sub)    sub.textContent    = p.convenio ? p.convenio + ' · ' + (p.telefone || '') : (p.telefone || '');
        if (bar)    bar.style.display  = 'flex';
    } else {
        if (bar) bar.style.display = 'none';
    }
}

function abrirModalDoc(tipo) {
    if (!_docPacienteSelecionado) { showToast('Selecione um paciente primeiro.'); return; }
    const p    = _docPacienteSelecionado;
    const hoje = new Date().toISOString().slice(0, 10);

    if (tipo === 'declaracao') {
        document.getElementById('decl-paciente').value = p.nome;
        document.getElementById('decl-data').value     = hoje;
        document.getElementById('decl-hora-ini').value = '';
        document.getElementById('decl-hora-fim').value = '';
        document.getElementById('decl-destino').value  = '';
        document.getElementById('decl-obs').value      = '';
    }
    if (tipo === 'relatorio') {
        document.getElementById('rel-doc-paciente').value      = p.nome;
        document.getElementById('rel-doc-data').value          = hoje;
        document.getElementById('rel-doc-identificacao').value = '';
        document.getElementById('rel-doc-evolucao').value      = '';
        document.getElementById('rel-doc-conclusao').value     = '';
    }
    if (tipo === 'termo') {
        document.getElementById('termo-paciente').value = p.nome;
        document.getElementById('termo-data').value     = hoje;
        document.getElementById('termo-obs').value      = '';
    }
    if (tipo === 'encaminhamento') {
        document.getElementById('enc-paciente').value     = p.nome;
        document.getElementById('enc-data').value         = hoje;
        document.getElementById('enc-profissional').value = '';
        document.getElementById('enc-motivo').value       = '';
        document.getElementById('enc-complemento').value  = '';
    }
    if (tipo === 'laudo') {
        const profNome = usuarioLogado?.nome || '';
        const profCRP  = usuarioLogado?.crp  || '';
        document.getElementById('laudo-paciente').value      = p.nome;
        document.getElementById('laudo-data').value          = hoje;
        document.getElementById('laudo-psicologo').value     = profNome;
        document.getElementById('laudo-crp').value           = profCRP;
        document.getElementById('laudo-identificacao').value = '';
        document.getElementById('laudo-demanda').value       = '';
        document.getElementById('laudo-procedimentos').value = '';
        document.getElementById('laudo-analise').value       = '';
        document.getElementById('laudo-conclusao').value     = '';
        document.getElementById('laudo-recomendacoes').value = '';
    }
    document.getElementById(`modal-doc-${tipo}`).style.display = 'flex';
}

function fecharModalDoc(tipo) {
    document.getElementById(`modal-doc-${tipo}`).style.display = 'none';
}

function _docFormatarData(iso) {
    if (!iso) return '___/___/______';
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
}

async function imprimirDocumento(tipo) {
    const p        = _docPacienteSelecionado;
    const profNome = usuarioLogado?.nome || 'Profissional Responsável';
    const profCRP  = usuarioLogado?.crp  || '';
    // Puxa nome da clínica do banco; fallback para nome do psicólogo
    let clinica = 'Consultório';
    try {
        const cfg = (typeof ipcRenderer !== 'undefined') ? await ipc('db-get-config') : {};
        if (cfg && cfg.nome_clinica) clinica = cfg.nome_clinica;
        // se não configurado ainda, deixa em branco — não monta "Consultório de Administrador"
    } catch(e) {}
    let html = '';

    if (tipo === 'declaracao') {
        const data    = _docFormatarData(document.getElementById('decl-data').value);
        const hIni    = document.getElementById('decl-hora-ini').value;
        const hFim    = document.getElementById('decl-hora-fim').value;
        const destino = document.getElementById('decl-destino').value || 'A quem possa interessar';
        const obs     = document.getElementById('decl-obs').value;
        const horario = hIni && hFim ? `das ${hIni} às ${hFim}` : hIni ? `às ${hIni}` : '';
        html = `
            <h2 style="text-align:center;margin-bottom:.25rem;">DECLARAÇÃO DE COMPARECIMENTO</h2>
            <p style="text-align:center;color:#64748b;margin-bottom:2rem;">À: <strong>${destino}</strong></p>
            <p style="line-height:2;font-size:1rem;">
                Declaro para os devidos fins que o(a) paciente <strong>${p.nome}</strong>${p.cpf ? `, portador(a) do CPF nº <strong>${p.cpf}</strong>,` : ''}
                compareceu a esta clínica no dia <strong>${data}</strong>${horario ? ` ${horario}` : ''}, para realização de consulta psicológica.
            </p>
            ${obs ? `<p style="margin-top:1rem;line-height:1.8;">${obs}</p>` : ''}
            <p style="margin-top:1rem;">Por ser verdade, firmo a presente declaração.</p>`;
    }

    if (tipo === 'relatorio') {
        const data       = _docFormatarData(document.getElementById('rel-doc-data').value);
        const finalidade = document.getElementById('rel-doc-finalidade').value;
        const identif    = document.getElementById('rel-doc-identificacao').value;
        const evolucao   = document.getElementById('rel-doc-evolucao').value;
        const conclusao  = document.getElementById('rel-doc-conclusao').value;
        html = `
            <h2 style="text-align:center;margin-bottom:.25rem;">RELATÓRIO PSICOLÓGICO</h2>
            <p style="text-align:center;color:#64748b;margin-bottom:2rem;">Finalidade: ${finalidade}</p>
            <p><strong>Paciente:</strong> ${p.nome}${p.cpf ? ` — CPF: ${p.cpf}` : ''}</p>
            <p><strong>Data:</strong> ${data}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>1. Identificação e Contexto Clínico</h4>
            <p style="line-height:1.8;">${identif.replace(/\n/g,'<br>')}</p>
            <h4 style="margin-top:1.25rem;">2. Observações Clínicas / Evolução</h4>
            <p style="line-height:1.8;">${evolucao.replace(/\n/g,'<br>')}</p>
            <h4 style="margin-top:1.25rem;">3. Conclusão / Parecer</h4>
            <p style="line-height:1.8;">${conclusao.replace(/\n/g,'<br>')}</p>`;
    }

    if (tipo === 'termo') {
        const data      = _docFormatarData(document.getElementById('termo-data').value);
        const modEl     = document.getElementById('termo-modalidade');
        const modalTxt  = modEl.options[modEl.selectedIndex].text;
        const obs       = document.getElementById('termo-obs').value;
        html = `
            <h2 style="text-align:center;margin-bottom:.25rem;">TERMO DE CONSENTIMENTO INFORMADO</h2>
            <p style="text-align:center;color:#64748b;margin-bottom:2rem;">Atendimento Psicológico — ${modalTxt}</p>
            <p style="line-height:1.9;">Eu, <strong>${p.nome}</strong>${p.cpf ? `, CPF nº <strong>${p.cpf}</strong>` : ''},
            declaro que fui devidamente informado(a) sobre os objetivos, procedimentos e sigilo do atendimento
            psicológico a ser realizado na modalidade <strong>${modalTxt.toLowerCase()}</strong> na <strong>${clinica}</strong>,
            sob responsabilidade do(a) profissional <strong>${profNome}</strong>${profCRP ? ` (CRP: ${profCRP})` : ''}.</p>
            <p style="line-height:1.9;margin-top:.75rem;">Declaro ciência de que as informações compartilhadas durante as sessões são protegidas pelo sigilo
            profissional, conforme o Código de Ética do Psicólogo (Resolução CFP nº 10/2005).</p>
            <p style="line-height:1.9;margin-top:.75rem;">Concordo com o início do acompanhamento nas condições apresentadas.</p>
            ${obs ? `<p style="margin-top:.75rem;line-height:1.8;">${obs}</p>` : ''}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;margin-top:3rem;">
                <div style="text-align:center;border-top:1px solid #334155;padding-top:.5rem;">
                    <p style="margin:0;font-size:.85rem;">${p.nome}</p>
                    <p style="margin:0;font-size:.75rem;color:#64748b;">Paciente</p>
                </div>
                <div style="text-align:center;border-top:1px solid #334155;padding-top:.5rem;">
                    <p style="margin:0;font-size:.85rem;">${profNome}${profCRP ? ` — CRP ${profCRP}` : ''}</p>
                    <p style="margin:0;font-size:.75rem;color:#64748b;">Psicólogo(a) Responsável</p>
                </div>
            </div>
            <p style="text-align:center;margin-top:1.5rem;font-size:.85rem;color:#64748b;">${clinica} — ${data}</p>`;
    }

    if (tipo === 'encaminhamento') {
        const data        = _docFormatarData(document.getElementById('enc-data').value);
        const esp         = document.getElementById('enc-especialidade').value;
        const profEnc     = document.getElementById('enc-profissional').value;
        const motivo      = document.getElementById('enc-motivo').value;
        const complemento = document.getElementById('enc-complemento').value;
        html = `
            <h2 style="text-align:center;margin-bottom:.25rem;">ENCAMINHAMENTO</h2>
            <p style="text-align:center;color:#64748b;margin-bottom:2rem;">Para: <strong>${esp}</strong>${profEnc ? ` — ${profEnc}` : ''}</p>
            <p><strong>Paciente:</strong> ${p.nome}${p.cpf ? ` — CPF: ${p.cpf}` : ''}</p>
            <p><strong>Data:</strong> ${data}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <p style="line-height:1.9;">Encaminho o(a) paciente acima identificado(a) para avaliação e acompanhamento em
            <strong>${esp}</strong>${profEnc ? ` junto ao(à) <strong>${profEnc}</strong>` : ''}.</p>
            <h4 style="margin-top:1rem;">Motivo do Encaminhamento</h4>
            <p style="line-height:1.8;">${motivo.replace(/\n/g,'<br>')}</p>
            ${complemento ? `<h4 style="margin-top:1rem;">Informações Complementares</h4><p style="line-height:1.8;">${complemento.replace(/\n/g,'<br>')}</p>` : ''}`;
    }

    if (tipo === 'laudo') {
        const data          = _docFormatarData(document.getElementById('laudo-data').value);
        const finalidadeEl  = document.getElementById('laudo-finalidade');
        const finalidade    = finalidadeEl.options[finalidadeEl.selectedIndex].text;
        const laudoPsi      = document.getElementById('laudo-psicologo').value || profNome;
        const laudoCRP      = document.getElementById('laudo-crp').value       || profCRP;
        const identificacao = document.getElementById('laudo-identificacao').value;
        const demanda       = document.getElementById('laudo-demanda').value;
        const procedimentos = document.getElementById('laudo-procedimentos').value;
        const analise       = document.getElementById('laudo-analise').value;
        const conclusao     = document.getElementById('laudo-conclusao').value;
        const recomendacoes = document.getElementById('laudo-recomendacoes').value;

        const idadeTxt = p.nascimento
            ? (() => {
                const nasc  = new Date(p.nascimento);
                const hoje2 = new Date();
                let idade   = hoje2.getFullYear() - nasc.getFullYear();
                const m     = hoje2.getMonth() - nasc.getMonth();
                if (m < 0 || (m === 0 && hoje2.getDate() < nasc.getDate())) idade--;
                return `${idade} anos`;
              })()
            : '';

        html = `
            <h2 style="text-align:center;letter-spacing:.04em;margin-bottom:.2rem;">LAUDO PSICOLÓGICO</h2>
            <p style="text-align:center;color:#64748b;font-size:.92em;margin-bottom:.5rem;">Finalidade: <strong>${finalidade}</strong></p>
            <p style="text-align:center;font-size:.85em;color:#94a3b8;margin-bottom:2rem;">
                Documento de caráter sigiloso — Art. 9º, Resolução CFP nº 06/2019
            </p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>1. Dados de Identificação</h4>
            <table style="width:100%;border-collapse:collapse;font-size:.95em;margin:.5rem 0 1rem;">
                <tr>
                    <td style="padding:.3rem .5rem .3rem 0;width:50%;"><strong>Nome:</strong> ${p.nome}</td>
                    <td style="padding:.3rem 0;"><strong>Data de nascimento:</strong> ${p.nascimento ? _docFormatarData(p.nascimento) : '___/___/______'}${idadeTxt ? ` (${idadeTxt})` : ''}</td>
                </tr>
                <tr>
                    <td style="padding:.3rem .5rem .3rem 0;"><strong>CPF:</strong> ${p.cpf || '___.___.___-__'}</td>
                    <td style="padding:.3rem 0;"><strong>Convênio/Plano:</strong> ${p.convenio || 'Particular'}</td>
                </tr>
            </table>
            ${identificacao ? `<p style="line-height:1.8;">${identificacao.replace(/\n/g,'<br>')}</p>` : ''}
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>2. Demanda e Objetivo da Avaliação</h4>
            <p style="line-height:1.8;">${demanda.replace(/\n/g,'<br>')}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>3. Procedimentos Utilizados</h4>
            <p style="line-height:1.8;">${procedimentos.replace(/\n/g,'<br>')}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>4. Análise e Discussão dos Resultados</h4>
            <p style="line-height:1.8;">${analise.replace(/\n/g,'<br>')}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>5. Conclusão / Parecer Técnico</h4>
            <p style="line-height:1.8;">${conclusao.replace(/\n/g,'<br>')}</p>
            ${recomendacoes ? `
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            <h4>6. Recomendações</h4>
            <p style="line-height:1.8;">${recomendacoes.replace(/\n/g,'<br>')}</p>` : ''}
            <div style="margin-top:4rem;text-align:center;">
                <div style="display:inline-block;border-top:1px solid #334155;padding-top:.5rem;min-width:320px;">
                    <p style="margin:0;font-size:.9em;font-weight:700;">${laudoPsi}</p>
                    <p style="margin:0;font-size:.82em;color:#64748b;">${laudoCRP ? `CRP ${laudoCRP}` : 'Psicólogo(a)'}</p>
                    <p style="margin:.25rem 0 0;font-size:.78em;color:#94a3b8;">${clinica} — ${data}</p>
                </div>
            </div>`;
    }

    if (tipo === 'relatorio-progresso') {
        const dataRel       = _docFormatarData(document.getElementById('prog-data-relatorio').value);
        const dataIni       = _docFormatarData(document.getElementById('prog-data-ini').value);
        const dataFimP      = _docFormatarData(document.getElementById('prog-data-fim').value);
        const progPsiVal    = document.getElementById('prog-psicologo').value || (profNome + (profCRP ? ' — CRP ' + profCRP : ''));
        const queixa        = document.getElementById('prog-queixa-inicial').value;
        const objetivos     = document.getElementById('prog-objetivos').value;
        const evolucao      = document.getElementById('prog-evolucao').value;
        const dificuldades  = document.getElementById('prog-dificuldades').value;
        const tecnicas      = document.getElementById('prog-tecnicas').value;
        const numSessoes    = document.getElementById('prog-num-sessoes').value;
        const recomendacoes = document.getElementById('prog-recomendacoes').value;
        html = `
            <h2 style="text-align:center;margin-bottom:.2rem;">RELATÓRIO DE PROGRESSO TERAPÊUTICO</h2>
            <p style="text-align:center;color:#64748b;font-size:.9em;margin-bottom:2rem;">Período: ${dataIni} a ${dataFimP}${numSessoes ? ' — ' + numSessoes + ' sessões' : ''}</p>
            <p><strong>Paciente:</strong> ${p.nome}${p.cpf ? ' — CPF: ' + p.cpf : ''}</p>
            <hr style="margin:1.25rem 0;border-color:#e2e8f0;">
            ${queixa ? '<h4>1. Queixa Inicial / Demanda Original</h4><p style="line-height:1.8;">' + queixa.replace(/\n/g,'<br>') + '</p><hr style="margin:1.25rem 0;border-color:#e2e8f0;">' : ''}
            ${objetivos ? '<h4>2. Objetivos Terapêuticos</h4><p style="line-height:1.8;">' + objetivos.replace(/\n/g,'<br>') + '</p><hr style="margin:1.25rem 0;border-color:#e2e8f0;">' : ''}
            ${evolucao ? '<h4>3. Evolução e Conquistas</h4><p style="line-height:1.8;">' + evolucao.replace(/\n/g,'<br>') + '</p><hr style="margin:1.25rem 0;border-color:#e2e8f0;">' : ''}
            ${dificuldades ? '<h4>4. Dificuldades / Pontos de Atenção</h4><p style="line-height:1.8;">' + dificuldades.replace(/\n/g,'<br>') + '</p><hr style="margin:1.25rem 0;border-color:#e2e8f0;">' : ''}
            ${tecnicas ? '<h4>5. Técnicas / Abordagem Utilizada</h4><p>' + tecnicas + '</p><hr style="margin:1.25rem 0;border-color:#e2e8f0;">' : ''}
            ${recomendacoes ? '<h4>6. Recomendações e Próximos Passos</h4><p style="line-height:1.8;">' + recomendacoes.replace(/\n/g,'<br>') + '</p>' : ''}
            <div style="margin-top:4rem;text-align:center;">
                <div style="display:inline-block;border-top:1px solid #334155;padding-top:.5rem;min-width:320px;">
                    <p style="margin:0;font-weight:700;">${progPsiVal}</p>
                    <p style="margin:0;font-size:.85em;color:#64748b;">Psicólogo(a) Responsável</p>
                    <p style="margin:.25rem 0 0;font-size:.78em;color:#94a3b8;">${clinica} — ${dataRel}</p>
                </div>
            </div>`;
    }

    const win = window.open('', '_blank', 'width=860,height=700');
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
        <title>Documento — ${clinica}</title>
        <style>
            *{box-sizing:border-box;margin:0;padding:0;}
            body{font-family:'Georgia',serif;color:#1e293b;padding:3cm 2.5cm;font-size:11pt;}
            h2{font-size:14pt;color:#1e293b;margin-bottom:.5rem;}
            h4{font-size:11pt;color:#1e293b;margin-top:1rem;margin-bottom:.3rem;}
            p{margin-bottom:.5rem;}
            hr{border:none;border-top:1px solid #cbd5e1;margin:1rem 0;}
            .doc-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1e293b;padding-bottom:.75rem;margin-bottom:2rem;}
            .doc-header h1{font-size:13pt;}
            .doc-header p{font-size:9pt;color:#64748b;}
            .doc-footer{border-top:1px solid #cbd5e1;margin-top:3rem;padding-top:.75rem;text-align:center;font-size:9pt;color:#94a3b8;}
            @media print{body{padding:2cm;}}
        </style></head><body>
        <div class="doc-header">
            <div><h1>${clinica || profNome}</h1><p>${clinica ? (profNome + (profCRP ? ' — CRP ' + profCRP : '')) : (profCRP ? 'CRP ' + profCRP : 'Psicólogo(a)')}</p></div>
            <div style="text-align:right;"><p>${new Date().toLocaleDateString('pt-BR')}</p></div>
        </div>
        ${html}
        <div class="doc-footer">
            <p>Documento emitido pelo sistema de gestão — ${clinica}</p>
            <p>As informações são de caráter confidencial e protegidas pelo sigilo profissional.</p>
        </div>
        <script>window.onload=()=>{window.print();}<\/script>
    </body></html>`);
    win.document.close();

    // Salva cópia em PDF na pasta do paciente
    if (_docPacienteSelecionado) {
        const htmlCompleto = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
            <title>Documento — ${clinica}</title>
            <style>
                *{box-sizing:border-box;margin:0;padding:0;}
                body{font-family:'Georgia',serif;color:#1e293b;padding:3cm 2.5cm;font-size:11pt;}
                h2{font-size:14pt;color:#1e293b;margin-bottom:.5rem;}
                h4{font-size:11pt;color:#1e293b;margin-top:1rem;margin-bottom:.3rem;}
                p{margin-bottom:.5rem;}
                hr{border:none;border-top:1px solid #cbd5e1;margin:1rem 0;}
                .doc-header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #1e293b;padding-bottom:.75rem;margin-bottom:2rem;}
                .doc-header h1{font-size:13pt;}
                .doc-header p{font-size:9pt;color:#64748b;}
                .doc-footer{border-top:1px solid #cbd5e1;margin-top:3rem;padding-top:.75rem;text-align:center;font-size:9pt;color:#94a3b8;}
            </style></head><body>
            <div class="doc-header">
                <div><h1>${clinica || profNome}</h1><p>${clinica ? (profNome + (profCRP ? ' — CRP ' + profCRP : '')) : (profCRP ? 'CRP ' + profCRP : 'Psicólogo(a)')}</p></div>
                <div style="text-align:right;"><p>${new Date().toLocaleDateString('pt-BR')}</p></div>
            </div>
            ${html}
            <div class="doc-footer">
                <p>Documento emitido pelo sistema de gestão — ${clinica}</p>
                <p>As informações são de caráter confidencial e protegidas pelo sigilo profissional.</p>
            </div>
        </body></html>`;
        try {
            const tipoLabel = {
                declaracao:           'Declaracao_de_Comparecimento',
                relatorio:            'Relatorio_Psicologico',
                termo:                'Termo_de_Consentimento',
                encaminhamento:       'Encaminhamento',
                laudo:                'Laudo_Psicologico',
                'relatorio-progresso':'Relatorio_de_Progresso',
            };
            const nomeArquivo = tipoLabel[tipo] || tipo;
            await ipc('salvar-pdf-documento', {
                htmlConteudo: htmlCompleto,
                nomePaciente: _docPacienteSelecionado.nome,
                nomeArquivo
            });
        } catch(e) { console.warn('Erro ao salvar PDF do documento:', e); }
    }

    // Registra o documento emitido no prontuário do paciente
    const tipoLabel = {
        declaracao:           'Declaração de Comparecimento',
        relatorio:            'Relatório Psicológico',
        termo:                'Termo de Consentimento Informado',
        encaminhamento:       'Encaminhamento',
        laudo:                'Laudo Psicológico',
        'relatorio-progresso':'Relatório de Progresso Terapêutico',
    };
    const nomeDoc = tipoLabel[tipo] || tipo;
    const dataHoje = new Date().toISOString().slice(0, 10);
    const logTexto = `[DOCUMENTO EMITIDO — ${nomeDoc.toUpperCase()}]\nEmitido por: ${profNome}${profCRP ? ' — CRP ' + profCRP : ''}\nData: ${new Date().toLocaleDateString('pt-BR')}`;

    if (_docPacienteSelecionado) {
        try {
            await ipc('db-salvar-consulta', {
                pacienteId: _docPacienteSelecionado.id,
                data: dataHoje,
                texto: logTexto
            });
            consultas = await ipc('db-todas-consultas') || [];
            dispararAtualizacaoPdf(_docPacienteSelecionado.id, _docPacienteSelecionado.nome);
        } catch(e) { console.warn('Erro ao registrar documento no prontuário:', e); }
    }

    fecharModalDoc(tipo);
}

// ============================================================
//  CID-10 / CID-11 — SELEÇÃO SIMPLIFICADA
// ============================================================

const CID_DB = [
  // Transtornos de Humor
  { c10: 'F32.0', c11: '6A70.0', nome: 'Episódio depressivo leve' },
  { c10: 'F32.1', c11: '6A70.1', nome: 'Episódio depressivo moderado' },
  { c10: 'F32.2', c11: '6A70.2', nome: 'Episódio depressivo grave sem sintomas psicóticos' },
  { c10: 'F32.3', c11: '6A70.3', nome: 'Episódio depressivo grave com sintomas psicóticos' },
  { c10: 'F33',   c11: '6A71',   nome: 'Transtorno depressivo recorrente' },
  { c10: 'F33.0', c11: '6A71.0', nome: 'Transtorno depressivo recorrente, episódio atual leve' },
  { c10: 'F33.1', c11: '6A71.1', nome: 'Transtorno depressivo recorrente, episódio atual moderado' },
  { c10: 'F33.2', c11: '6A71.2', nome: 'Transtorno depressivo recorrente, episódio atual grave' },
  { c10: 'F34.1', c11: '6A72',   nome: 'Distimia' },
  { c10: 'F30',   c11: '6A60',   nome: 'Episódio maníaco' },
  { c10: 'F31',   c11: '6A60',   nome: 'Transtorno afetivo bipolar' },
  { c10: 'F31.0', c11: '6A60.0', nome: 'Transtorno bipolar, episódio atual hipomaníaco' },
  { c10: 'F31.1', c11: '6A60.1', nome: 'Transtorno bipolar, episódio atual maníaco sem psicose' },
  { c10: 'F31.3', c11: '6A60.3', nome: 'Transtorno bipolar, episódio atual depressivo moderado' },
  // Transtornos de Ansiedade
  { c10: 'F40.0', c11: '6B00',   nome: 'Agorafobia' },
  { c10: 'F40.1', c11: '6B01',   nome: 'Fobias sociais (ansiedade social)' },
  { c10: 'F40.2', c11: '6B03',   nome: 'Fobias específicas (isoladas)' },
  { c10: 'F41.0', c11: '6B01',   nome: 'Transtorno de pânico' },
  { c10: 'F41.1', c11: '6B00',   nome: 'Transtorno de ansiedade generalizada' },
  { c10: 'F41.2', c11: '6B00',   nome: 'Transtorno misto ansioso e depressivo' },
  { c10: 'F42',   c11: '6B20',   nome: 'Transtorno obsessivo-compulsivo (TOC)' },
  { c10: 'F43.0', c11: '6B40',   nome: 'Reação aguda ao estresse' },
  { c10: 'F43.1', c11: '6B40',   nome: 'Transtorno de estresse pós-traumático (TEPT)' },
  { c10: 'F43.2', c11: '6B43',   nome: 'Transtornos de adaptação' },
  // Transtornos de Personalidade
  { c10: 'F60.0', c11: '6D10.0', nome: 'Transtorno de personalidade paranoide' },
  { c10: 'F60.1', c11: '6D10.1', nome: 'Transtorno de personalidade esquizoide' },
  { c10: 'F60.2', c11: '6D10.4', nome: 'Transtorno de personalidade dissocial' },
  { c10: 'F60.3', c11: '6D11.5', nome: 'Transtorno de personalidade emocionalmente instável' },
  { c10: 'F60.4', c11: '6D10.6', nome: 'Transtorno de personalidade histriônico' },
  { c10: 'F60.5', c11: '6D10.3', nome: 'Transtorno de personalidade anancástico' },
  { c10: 'F60.6', c11: '6D10.7', nome: 'Transtorno de personalidade ansioso (evitativo)' },
  { c10: 'F60.7', c11: '6D10.8', nome: 'Transtorno de personalidade dependente' },
  // Psicóticos e Esquizofrenia
  { c10: 'F20',   c11: '6A20',   nome: 'Esquizofrenia' },
  { c10: 'F20.0', c11: '6A20.0', nome: 'Esquizofrenia paranoide' },
  { c10: 'F21',   c11: '6A21',   nome: 'Transtorno esquizotípico' },
  { c10: 'F22',   c11: '6A24',   nome: 'Transtorno delirante persistente' },
  { c10: 'F25',   c11: '6A23',   nome: 'Transtorno esquizoafetivo' },
  // TDAH e Neurodesenvolvimento
  { c10: 'F90.0', c11: '6A05.0', nome: 'Transtorno de déficit de atenção com hiperatividade (TDAH) — predominantemente desatento' },
  { c10: 'F90.1', c11: '6A05.1', nome: 'TDAH — predominantemente hiperativo-impulsivo' },
  { c10: 'F90.2', c11: '6A05.2', nome: 'TDAH — combinado' },
  { c10: 'F84.0', c11: '6A02',   nome: 'Autismo infantil (TEA)' },
  { c10: 'F84.5', c11: '6A02',   nome: 'Síndrome de Asperger' },
  { c10: 'F70',   c11: '6A00',   nome: 'Deficiência intelectual leve' },
  { c10: 'F71',   c11: '6A01',   nome: 'Deficiência intelectual moderada' },
  // Alimentação
  { c10: 'F50.0', c11: '6B80',   nome: 'Anorexia nervosa' },
  { c10: 'F50.2', c11: '6B81',   nome: 'Bulimia nervosa' },
  { c10: 'F50.8', c11: '6B82',   nome: 'Transtorno de compulsão alimentar' },
  // Sono
  { c10: 'F51.0', c11: '7A00',   nome: 'Insônia não orgânica' },
  { c10: 'F51.5', c11: '7B01',   nome: 'Pesadelos (transtorno de pesadelo)' },
  // Substâncias
  { c10: 'F10.1', c11: '6C40.1', nome: 'Uso nocivo de álcool' },
  { c10: 'F10.2', c11: '6C40.2', nome: 'Síndrome de dependência de álcool' },
  { c10: 'F11.1', c11: '6C43.1', nome: 'Uso nocivo de opioides' },
  { c10: 'F12.1', c11: '6C41.1', nome: 'Uso nocivo de canabinoides' },
  { c10: 'F14.1', c11: '6C44.1', nome: 'Uso nocivo de cocaína' },
  // Somáticos / Dissocia​tivos
  { c10: 'F44.0', c11: '6B60',   nome: 'Amnésia dissociativa' },
  { c10: 'F44.1', c11: '6B61',   nome: 'Fuga dissociativa' },
  { c10: 'F44.81',c11: '6B64',   nome: 'Transtorno dissociativo de identidade' },
  { c10: 'F45.0', c11: '6C20',   nome: 'Transtorno de somatização' },
  { c10: 'F45.2', c11: '6C21',   nome: 'Transtorno hipocondríaco' },
  // Infância / Adolescência
  { c10: 'F91',   c11: '6C90',   nome: 'Transtornos de conduta' },
  { c10: 'F93.0', c11: '6B05',   nome: 'Transtorno de ansiedade de separação' },
  { c10: 'F94.0', c11: '6B06',   nome: 'Mutismo seletivo' },
  { c10: 'F98.0', c11: '6C01',   nome: 'Enurese não orgânica' },
  { c10: 'F98.1', c11: '6C02',   nome: 'Encoprese não orgânica' },
  // Sexuais
  { c10: 'F52.0', c11: 'HA00',   nome: 'Ausência ou perda de desejo sexual' },
  { c10: 'F64.0', c11: 'HA60',   nome: 'Transexualismo / disforia de gênero' },
  // Outros
  { c10: 'F99',   c11: '6E8Z',   nome: 'Transtorno mental não especificado' },
];

function cidSelecionarItem(codigo10, codigo11, nome, pfx='') {
  document.getElementById(pfx+'cid-busca').value = nome ? `${codigo10} — ${nome}` : codigo10;
  document.getElementById(pfx+'cid-codigo').value = codigo10;
  document.getElementById(pfx+'cid-descricao').value = nome;
  document.getElementById(pfx+'cid-dropdown').style.display = 'none';

  const tag = document.getElementById(pfx+'cid-selecionado-tag');
  tag.style.display = 'flex';
  tag.style.alignItems = 'center';
  tag.style.gap = '8px';
  tag.style.flexWrap = 'wrap';
  tag.innerHTML = `
    <span style="
      display:inline-flex;align-items:center;gap:6px;
      background:#eef2ff;color:#3730a3;
      border:1.5px solid #c7d2fe;
      border-radius:8px;padding:5px 10px;
      font-size:.82rem;font-weight:600;line-height:1.3;
    ">
      <i class="fa-solid fa-tag" style="font-size:.75rem;opacity:.7;"></i>
      <span style="opacity:.75">CID-10: <b>${codigo10}</b></span>
      <span style="opacity:.5;margin:0 2px;">|</span>
      <span style="opacity:.75">CID-11: <b>${codigo11}</b></span>
      <span style="opacity:.5;margin:0 2px;">·</span>
      <span>${nome}</span>
    </span>`;
}

function limparCid(pfx='') {
  document.getElementById(pfx+'cid-busca').value = '';
  document.getElementById(pfx+'cid-codigo').value = '';
  document.getElementById(pfx+'cid-descricao').value = '';
  const tag = document.getElementById(pfx+'cid-selecionado-tag');
  tag.style.display = 'none';
  tag.innerHTML = '';
  document.getElementById(pfx+'cid-dropdown').style.display = 'none';
}

function initCidAutocomplete(pfx='') {
  const input = document.getElementById(pfx+'cid-busca');
  const dropdown = document.getElementById(pfx+'cid-dropdown');
  if (!input || !dropdown) return;

  function normalizar(t) {
    return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, '');
  }

  function renderizar(query) {
    const q = normalizar(query.trim());
    if (q.length < 2) { dropdown.style.display = 'none'; return; }
    const termos = q.split(/\s+/);
    const resultados = CID_DB.filter(r => {
      const campo = normalizar(r.nome + ' ' + r.c10 + ' ' + r.c11);
      return termos.every(t => campo.includes(t));
    }).slice(0, 12);

    if (!resultados.length) {
      dropdown.innerHTML = '<div style="padding:10px 14px;color:#94a3b8;font-size:.83rem;font-style:italic;">Nenhum resultado encontrado.</div>';
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = '';
    resultados.forEach(r => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:9px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9;display:flex;flex-direction:column;gap:2px;';
      div.innerHTML = `
        <span style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:.72rem;font-weight:700;background:#e0e7ff;color:#4338ca;padding:2px 6px;border-radius:5px;">CID-10: ${r.c10}</span>
          <span style="font-size:.72rem;font-weight:700;background:#f0fdf4;color:#15803d;padding:2px 6px;border-radius:5px;">CID-11: ${r.c11}</span>
        </span>
        <span style="font-size:.87rem;color:#1e293b;font-weight:500;">${r.nome}</span>`;
      div.addEventListener('mouseenter', () => div.style.background = '#f0f4ff');
      div.addEventListener('mouseleave', () => div.style.background = '');
      div.addEventListener('mousedown', (e) => {
        e.preventDefault();
        cidSelecionarItem(r.c10, r.c11, r.nome, pfx);
        input.value = '';
      });
      dropdown.appendChild(div);
    });
    dropdown.style.display = 'block';
  }

  input.addEventListener('input', function() {
    renderizar(this.value);
  });

  input.addEventListener('keydown', function(e) {
    const items = dropdown.querySelectorAll('div');
    if (!items.length) return;
    const ativo = dropdown.querySelector('[data-ativo]');
    let idx = ativo ? parseInt(ativo.dataset.ativo) : -1;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (ativo) delete ativo.dataset.ativo, ativo.style.background = '';
      idx = (idx + 1) % items.length;
      items[idx].dataset.ativo = idx;
      items[idx].style.background = '#e0e7ff';
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (ativo) delete ativo.dataset.ativo, ativo.style.background = '';
      idx = (idx - 1 + items.length) % items.length;
      items[idx].dataset.ativo = idx;
      items[idx].style.background = '#e0e7ff';
      items[idx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && ativo) {
      e.preventDefault();
      ativo.dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      if (dropdown.style.display !== 'none') {
        dropdown.style.display = 'none';
        e.stopPropagation();
      }
    }
  });

  document.addEventListener('mousedown', function(e) {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
}
initCidAutocomplete('du-');

// ============================================================
//  PRONTUÁRIO COMPLETO — HUMOR, TÉCNICAS, SOAP, EMA, RISCO,
//  OBJETIVOS, FORMULAÇÃO + CONFIGURAÇÃO DE SEÇÕES POR USUÁRIO
// ============================================================

const TECNICAS_LISTA = [
  'TCC', 'ACT', 'DBT', 'EMDR', 'Psicanálise', 'Psicodinâmica',
  'Gestalt', 'Humanista', 'Cognitivo', 'Comportamental',
  'Mindfulness', 'Exposição', 'Reestruturação Cognitiva',
  'Resolução de Problemas', 'Treino de Habilidades Sociais',
  'Relaxamento / Respiração', 'Role-play', 'Psicoeducação',
  'Narrativa', 'Sistêmica / Familiar',
];

// Definição de todas as seções configuráveis
const PRONT_SECOES = [
  { id: 'cid',        label: 'CID-10 / CID-11',           icone: '🩺', defaultOn: true  },
  { id: 'humor',      label: 'Humor do Paciente',          icone: '😊', defaultOn: true  },
  { id: 'tecnicas',   label: 'Técnicas / Abordagens',      icone: '🧰', defaultOn: true  },
  { id: 'evolucao',   label: 'Evolução (Texto / SOAP)',     icone: '✏️', defaultOn: true  },
  { id: 'ema',        label: 'Estado Mental (EMA)',         icone: '🧠', defaultOn: false },
  { id: 'risco',      label: 'Avaliação de Risco',         icone: '⚠️', defaultOn: false },
  { id: 'objetivos',  label: 'Objetivos Terapêuticos',     icone: '🎯', defaultOn: false },
  { id: 'formulacao', label: 'Formulação de Caso',         icone: '📐', defaultOn: false },
  { id: 'tarefa',     label: 'Tarefa / Combinado',         icone: '🏠', defaultOn: true  },
];

let _tecnicasAtivas = new Set();
window._modoRegistroAtual = 'livre';
let _objetivosLista = []; // [{id, texto, concluido}]

// ── Chave de preferências por usuário ────────────────────────
function _prontPrefsKey() {
  const uid = usuarioLogado ? (usuarioLogado.id || usuarioLogado.email || 'default') : 'default';
  return `pront_secoes_${uid}`;
}

function _carregarPrefsSecoes() {
  try {
    const raw = localStorage.getItem(_prontPrefsKey());
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  // padrão
  const def = {};
  PRONT_SECOES.forEach(s => def[s.id] = s.defaultOn);
  return def;
}

function _salvarPrefsSecoes(prefs) {
  localStorage.setItem(_prontPrefsKey(), JSON.stringify(prefs));
}

// ── Aplicar visibilidade das seções ──────────────────────────
function aplicarVisibilidadeSecoes() {
  const prefs = _carregarPrefsSecoes();
  document.querySelectorAll('.pront-secao[data-secao]').forEach(el => {
    const id = el.dataset.secao;
    if (id === 'basico') return; // sempre visível
    el.style.display = prefs[id] !== false ? '' : 'none';
  });
}

// ── Painel de configuração ────────────────────────────────────
function abrirConfigurarSecoes() {
  const painel = document.getElementById('painel-configurar-secoes');
  painel.style.display = painel.style.display === 'none' ? 'block' : 'none';
  if (painel.style.display === 'block') {
    renderizarToglesSecoes();
    fecharTemplatesEvolucao();
  }
}

function fecharConfigurarSecoes() {
  document.getElementById('painel-configurar-secoes').style.display = 'none';
}

function renderizarToglesSecoes() {
  const grid = document.getElementById('secoes-toggles-grid');
  if (!grid) return;
  const prefs = _carregarPrefsSecoes();
  grid.innerHTML = '';
  PRONT_SECOES.forEach(s => {
    const ativo = prefs[s.id] !== false;
    const item = document.createElement('label');
    item.style.cssText = `display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer;
      border:1.5px solid ${ativo ? 'var(--primary)' : '#e2e8f0'};
      background:${ativo ? 'var(--pink-soft,#fdf0f5)' : '#f8fafc'};
      transition:all .15s;font-size:.8rem;font-weight:600;color:${ativo ? 'var(--primary)' : '#64748b'};`;
    item.innerHTML = `
      <input type="checkbox" data-secao="${s.id}" ${ativo ? 'checked' : ''}
        style="width:15px;height:15px;accent-color:var(--primary);cursor:pointer;"
        onchange="toggleSecao('${s.id}', this.checked, this.closest('label'))">
      <span>${s.icone} ${s.label}</span>`;
    grid.appendChild(item);
  });
}

function toggleSecao(id, ativo, labelEl) {
  const prefs = _carregarPrefsSecoes();
  prefs[id] = ativo;
  _salvarPrefsSecoes(prefs);
  if (labelEl) {
    labelEl.style.borderColor = ativo ? 'var(--primary)' : '#e2e8f0';
    labelEl.style.background  = ativo ? 'var(--pink-soft,#fdf0f5)' : '#f8fafc';
    labelEl.style.color       = ativo ? 'var(--primary)' : '#64748b';
  }
  aplicarVisibilidadeSecoes();
}

function resetarSecoesDefault() {
  const def = {};
  PRONT_SECOES.forEach(s => def[s.id] = s.defaultOn);
  _salvarPrefsSecoes(def);
  renderizarToglesSecoes();
  aplicarVisibilidadeSecoes();
}

// ══════════════════════════════════════════════════════════════
// TEMPLATES DE EVOLUÇÃO CLÍNICA
// ══════════════════════════════════════════════════════════════

const TEMPLATES_STORAGE_KEY = 'innercare_templates_evolucao';

const TEMPLATES_PADRAO = [
  // ── Gerais ─────────────────────────────────────────────────
  {
    id: 'tpl_sessao_inicial', categoria: 'Geral', titulo: 'Sessão inicial', modo: 'livre',
    texto: 'Primeira sessão de atendimento. Foram coletados dados de identificação e apresentado o enquadre terapêutico (sigilo, frequência, duração e honorários).\n\nQueixa principal: [descrever]\nHistória do problema: [descrever]\nExpectativas do paciente em relação à terapia: [descrever]\n\nImpressão clínica inicial: [descrever]\nPróximos passos: [definir foco da próxima sessão]'
  },
  {
    id: 'tpl_retorno_falta', categoria: 'Geral', titulo: 'Retorno após falta', modo: 'livre',
    texto: 'Paciente retornou após ausência na sessão anterior ([data da falta]). Foram explorados os motivos da falta e o impacto no processo terapêutico.\n\nMotivo relatado: [descrever]\nReação ao retorno: [descrever]\nRevisão da sessão anterior e continuidade dos temas: [descrever]'
  },
  {
    id: 'tpl_encerramento', categoria: 'Geral', titulo: 'Encerramento', modo: 'livre',
    texto: 'Sessão de encerramento do processo terapêutico. Foram revisados os avanços obtidos, objetivos alcançados e pontos de atenção para o futuro.\n\nResumo do processo: [descrever]\nPrincipais ganhos terapêuticos: [descrever]\nOrientações para manutenção: [descrever]\nPaciente demonstrou: [descrever estado emocional ao encerramento]\nAcordado retorno em caso de necessidade.'
  },
  {
    id: 'tpl_crise', categoria: 'Geral', titulo: 'Sessão de crise', modo: 'livre',
    texto: 'Sessão motivada por situação de crise. O paciente apresentou [descrever sintomas/situação].\n\nDescrição da crise: [descrever]\nFatores desencadeantes identificados: [descrever]\nRisco avaliado: [ ] Sem risco imediato  [ ] Risco moderado  [ ] Risco elevado\nIntervenção realizada: [descrever]\nRede de apoio acionada: [descrever se aplicável]\nPlano de segurança: [descrever]\nPróxima sessão agendada para: [data]'
  },
  // ── TCC ─────────────────────────────────────────────────────
  {
    id: 'tpl_tcc_padrao', categoria: 'TCC', titulo: 'Sessão padrão TCC', modo: 'estruturado',
    soapS: 'Paciente relatou humor [descrever] durante a semana. Queixa principal da sessão: [descrever]. Tarefa de casa da sessão anterior: [foi realizada / não foi realizada / parcialmente realizada].',
    soapO: 'Paciente apresentou-se [aparência, comportamento, afeto]. Nível de engajamento: [alto/médio/baixo]. Pensamentos automáticos identificados: [descrever].',
    soapA: 'Crenças intermediárias/centrais ativadas: [descrever]. Distorções cognitivas observadas: [descrever]. Nível de sofrimento (0–10): [descrever].',
    soapP: 'Técnica utilizada: [descrever]. Tarefa de casa para próxima sessão: [descrever]. Próxima sessão foco em: [descrever].'
  },
  {
    id: 'tpl_reestruturacao', categoria: 'TCC', titulo: 'Reestruturação cognitiva', modo: 'livre',
    texto: 'Trabalho de reestruturação cognitiva realizado na sessão.\n\nPensamento automático identificado: "[descrever]"\nEmoção associada (0–10): [descrever]\nEvidências a favor do pensamento: [descrever]\nEvidências contra o pensamento: [descrever]\nPensamento alternativo equilibrado: "[descrever]"\nEmoção após reestruturação (0–10): [descrever]\n\nObservações: [descrever]'
  },
  // ── Outras abordagens ────────────────────────────────────────
  {
    id: 'tpl_psicodinamica', categoria: 'Psicodinâmica', titulo: 'Sessão psicodinâmica', modo: 'livre',
    texto: 'Material trazido pelo paciente: [descrever associações livres, sonhos, lembranças]\n\nDinâmica transferencial observada: [descrever]\nResistências identificadas: [descrever]\nConteúdos inconscientes acessados: [descrever]\nInterpretações realizadas: [descrever]\nReação do paciente às intervenções: [descrever]\n\nHipóteses psicodinâmicas: [descrever]'
  },
  {
    id: 'tpl_act', categoria: 'ACT', titulo: 'Sessão ACT', modo: 'livre',
    texto: 'Sessão baseada na Terapia de Aceitação e Compromisso.\n\nProcesso trabalhado: [ ] Desfusão  [ ] Aceitação  [ ] Contato com o momento presente  [ ] Eu como contexto  [ ] Valores  [ ] Ação comprometida\n\nExercício/metáfora utilizado(a): [descrever]\nRelação com valores identificada: [descrever]\nBarreiras de flexibilidade psicológica observadas: [descrever]\nCompromisso de ação definido: [descrever]'
  },
  {
    id: 'tpl_emdr', categoria: 'EMDR', titulo: 'Sessão EMDR', modo: 'livre',
    texto: 'Protocolo EMDR — Fase: [identificação / dessensibilização / instalação / exame corporal / encerramento]\n\nMemória-alvo: [descrever]\nImagem representativa: [descrever]\nCognição negativa: "[descrever]"\nCognição positiva: "[descrever]"\nVOC inicial: [1–7] / VoC final: [1–7]\nEmoção: [descrever] / SUD inicial: [0–10] / SUD final: [0–10]\nLocalização corporal: [descrever]\nSéries de estimulação bilateral realizadas: [quantidade]\nMaterial emergente: [descrever]\nEncerramento: [paciente estabilizado / técnica de container utilizada]'
  },
  // ── Por público ──────────────────────────────────────────────
  {
    id: 'tpl_infantil', categoria: 'Infantil', titulo: 'Sessão infantil', modo: 'livre',
    texto: 'Atendimento infantil. Paciente com [idade] anos.\n\nComportamento na sessão: [descrever]\nRecurso utilizado: [ ] Desenho  [ ] Jogo  [ ] Brinquedo livre  [ ] Conto  [ ] Outro: [descrever]\nTema emergente no brincar: [descrever]\nAspectos emocionais observados: [descrever]\nComunicação com responsável: [informações relevantes repassadas / sem novidades]\nOrientação aos pais/responsáveis: [descrever]'
  },
  {
    id: 'tpl_adolescente', categoria: 'Adolescente', titulo: 'Sessão adolescente', modo: 'livre',
    texto: 'Atendimento com adolescente. Paciente com [idade] anos.\n\nEstado geral: [descrever humor, comportamento, aparência]\nTemas trazidos: [descrever]\nRelação com pares/família: [descrever]\nUso de redes sociais/tecnologia (se relevante): [descrever]\nRisco (automutilação, uso de substâncias): [ ] Sem indícios  [ ] A investigar  [ ] Presente — [descrever]\nAlianção terapêutica: [forte/em construção/frágil]\nContato com responsáveis: [houve / não houve — motivo]'
  },
  {
    id: 'tpl_casal', categoria: 'Casal', titulo: 'Sessão de casal', modo: 'livre',
    texto: 'Atendimento de casal. Participantes: [Parceiro A] e [Parceiro B].\n\nTema central da sessão: [descrever]\nDinâmica de comunicação observada: [descrever padrões, ciclos]\nPosição de cada parceiro: [descrever]\nEscalada de conflito presente: [ ] Sim  [ ] Não\nIntervenção realizada: [descrever]\nTarefa acordada: [descrever]\nAlianças terapêuticas: [equilibradas / a ajustar]'
  },
  // ── Situações específicas ────────────────────────────────────
  {
    id: 'tpl_risco', categoria: 'Específico', titulo: 'Avaliação de risco', modo: 'livre',
    texto: 'Avaliação de risco realizada em sessão.\n\nIdeação suicida: [ ] Ausente  [ ] Passiva  [ ] Ativa sem plano  [ ] Ativa com plano\nAutolesão: [ ] Ausente  [ ] Histórico  [ ] Atual\nRisco a terceiros: [ ] Ausente  [ ] Presente\n\nFatores de risco identificados: [descrever]\nFatores de proteção identificados: [descrever]\nPlano de segurança elaborado: [ ] Sim  [ ] Não\nRede de apoio acionada: [descrever]\nResponsável familiar informado: [ ] Sim  [ ] Não — motivo: [descrever]\nConclusão: [ ] Risco baixo  [ ] Risco moderado  [ ] Risco elevado\nConduta adotada: [descrever]'
  },
  {
    id: 'tpl_intercorrencia', categoria: 'Específico', titulo: 'Intercorrência', modo: 'livre',
    texto: 'Registro de intercorrência clínica.\n\nData da intercorrência: [descrever]\nDescrição: [descrever o que ocorreu]\nImpacto no processo terapêutico: [descrever]\nConduta adotada: [descrever]\nPessoas envolvidas/notificadas: [descrever]\nPróximos passos: [descrever]'
  }
];

// Antes os templates viviam só no localStorage (TEMPLATES_STORAGE_KEY) e por
// isso nunca entravam em nenhum backup (local, Drive ou criptografado).
// Agora ficam no SQLite (tabela templates_evolucao), via IPC. Na primeira
// chamada, se a tabela ainda estiver vazia, migra automaticamente o que já
// estiver salvo no localStorage deste navegador — sem perder nada que o
// usuário já tenha criado — e só usa os padrões de fábrica se não houver nada.
async function _getTemplates() {
  try {
    const doBanco = await ipc('db-listar-templates');
    if (doBanco && doBanco.length > 0) return doBanco;

    // Tabela vazia: tenta migrar do localStorage antes de cair nos padrões
    let inicial = null;
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      if (raw) inicial = JSON.parse(raw);
    } catch(e) {}
    if (!inicial || inicial.length === 0) inicial = JSON.parse(JSON.stringify(TEMPLATES_PADRAO));

    await ipc('db-substituir-templates', inicial);
    return inicial;
  } catch(e) {
    // IPC indisponível (ex: fora do Electron) — usa o fallback antigo
    console.warn('Falha ao buscar templates do banco, usando localStorage:', e);
    try {
      const raw = localStorage.getItem(TEMPLATES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(TEMPLATES_PADRAO));
    } catch(e2) { return JSON.parse(JSON.stringify(TEMPLATES_PADRAO)); }
  }
}

async function _saveTemplates(tpls) {
  try {
    await ipc('db-substituir-templates', tpls);
  } catch(e) {
    console.warn('Falha ao salvar templates no banco, usando apenas localStorage:', e);
  }
  // Mantém uma cópia local como fallback de segurança (mesmo padrão usado na anamnese)
  try { localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(tpls)); } catch(e) {}
}

function abrirTemplatesEvolucao() {
  const painel = document.getElementById('painel-templates-evolucao');
  const isOpen = painel.style.display !== 'none';
  if (isOpen) { fecharTemplatesEvolucao(); return; }
  // Fechar outros painéis
  document.getElementById('painel-configurar-secoes').style.display = 'none';
  painel.style.display = 'block';
  renderizarTemplatesPanel();
  // Highlight botão
  const btn = document.getElementById('btn-templates-evolucao');
  if (btn) { btn.style.background = '#ede9fe'; btn.style.color = '#7c3aed'; btn.style.borderColor = '#c4b5fd'; }
}

function fecharTemplatesEvolucao() {
  document.getElementById('painel-templates-evolucao').style.display = 'none';
  const btn = document.getElementById('btn-templates-evolucao');
  if (btn) { btn.style.background = '#f8fafc'; btn.style.color = '#64748b'; btn.style.borderColor = '#e2e8f0'; }
}

let _templateCatAtiva = 'Todas';

async function renderizarTemplatesPanel() {
  const templates = await _getTemplates();
  const categorias = ['Todas', ...new Set(templates.map(t => t.categoria))];
  // Render categorias
  const catDiv = document.getElementById('templates-categorias');
  catDiv.innerHTML = categorias.map(c => {
    const ativo = c === _templateCatAtiva;
    return `<button type="button" onclick="filtrarTemplatesCat('${c}')"
      style="padding:4px 11px;border-radius:20px;border:1.5px solid ${ativo ? 'var(--primary)' : '#e2e8f0'};
      background:${ativo ? 'var(--primary)' : '#f8fafc'};color:${ativo ? '#fff' : '#64748b'};
      font-size:.75rem;font-weight:600;cursor:pointer;transition:all .15s;">${c}</button>`;
  }).join('');
  // Render lista
  renderizarListaTemplates(templates);
}

function filtrarTemplatesCat(cat) {
  _templateCatAtiva = cat;
  renderizarTemplatesPanel();
}

function renderizarListaTemplates(templates) {
  const lista = document.getElementById('templates-lista');
  const filtrados = _templateCatAtiva === 'Todas' ? templates : templates.filter(t => t.categoria === _templateCatAtiva);
  if (filtrados.length === 0) {
    lista.innerHTML = '<p style="color:#94a3b8;font-size:.82rem;grid-column:1/-1;text-align:center;padding:.5rem 0;">Nenhum template nesta categoria.</p>';
    return;
  }
  const corCat = { 'Geral': '#0369a1', 'TCC': '#7c3aed', 'Psicodinâmica': '#9333ea', 'ACT': '#059669', 'EMDR': '#d97706', 'Infantil': '#ec4899', 'Adolescente': '#f97316', 'Casal': '#e11d48', 'Específico': '#64748b' };
  lista.innerHTML = filtrados.map(t => {
    const cor = corCat[t.categoria] || 'var(--primary)';
    const icone = t.modo === 'estruturado' ? '⬡' : '☰';
    return `<button type="button" onclick="inserirTemplate('${t.id}')"
      style="text-align:left;padding:.65rem .85rem;border-radius:10px;border:1.5px solid #e2e8f0;
      background:#f8fafc;cursor:pointer;transition:all .15s;position:relative;overflow:hidden;"
      onmouseover="this.style.borderColor='${cor}';this.style.background='#fafafa';"
      onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc';">
      <div style="font-size:.82rem;font-weight:700;color:#1e293b;margin-bottom:3px;">${icone} ${t.titulo}</div>
      <div style="font-size:.72rem;color:${cor};font-weight:600;">${t.categoria}</div>
    </button>`;
  }).join('');
}

async function inserirTemplate(id) {
  const templates = await _getTemplates();
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;
  const modoAtual = window._modoRegistroAtual || 'livre';
  if (tpl.modo === 'estruturado' && modoAtual !== 'estruturado') {
    if (!confirm('Este template é para modo SOAP, mas você está no modo texto livre.\n\nDeseja alternar para o modo SOAP e inserir o template?')) return;
    alternarModoRegistro('estruturado', 'du-');
  }
  if (tpl.modo === 'estruturado') {
    _inserirEmCampo('du-soap-s', tpl.soapS || '');
    _inserirEmCampo('du-soap-o', tpl.soapO || '');
    _inserirEmCampo('du-soap-a', tpl.soapA || '');
    _inserirEmCampo('du-soap-p', tpl.soapP || '');
  } else {
    _inserirEmCampo('du-texto-consulta', tpl.texto || '');
  }
  // Rastreia o template usado para gravar no registro
  window._templateUsadoNaSessao = { id: tpl.id, titulo: tpl.titulo, categoria: tpl.categoria };
  fecharTemplatesEvolucao();
}

function _inserirEmCampo(fieldId, texto) {
  const el = document.getElementById(fieldId);
  if (!el) return;
  if (el.value.trim()) {
    const rotulo = fieldId === 'du-texto-consulta' ? 'evolução' : fieldId.replace('du-soap-', 'SOAP ').toUpperCase();
    const acao = confirm(`O campo "${rotulo}" já contém texto.\n\nClique OK para substituir ou Cancelar para adicionar ao final.`);
    if (acao) {
      el.value = texto;
    } else {
      el.value = el.value.trim() + '\n\n' + texto;
    }
  } else {
    el.value = texto;
  }
  el.dispatchEvent(new Event('input'));
}

// ── Gerenciar templates ──────────────────────────────────────

async function abrirEditorTemplates() {
  fecharTemplatesEvolucao();
  document.getElementById('modal-gerenciar-templates').style.display = 'flex';
  document.getElementById('form-edicao-template').style.display = 'none';
  await renderizarListaGerenciar();
}

function fecharEditorTemplates() {
  document.getElementById('modal-gerenciar-templates').style.display = 'none';
}

async function renderizarListaGerenciar() {
  const templates = await _getTemplates();
  const lista = document.getElementById('lista-gerenciar-templates');
  if (templates.length === 0) {
    lista.innerHTML = '<p style="color:#94a3b8;font-size:.82rem;">Nenhum template cadastrado.</p>';
    return;
  }
  lista.innerHTML = templates.map((t, i) =>
    `<div style="display:flex;align-items:center;gap:.5rem;padding:.55rem .75rem;border:1.5px solid #e2e8f0;border-radius:9px;background:#f8fafc;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:.83rem;font-weight:700;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.titulo}</div>
        <div style="font-size:.72rem;color:#64748b;">${t.categoria} · ${t.modo === 'estruturado' ? 'SOAP' : 'Texto livre'}</div>
      </div>
      <button type="button" onclick="editarTemplate('${t.id}')" title="Editar" style="padding:4px 9px;border-radius:7px;border:1.5px solid #e2e8f0;background:#fff;color:#64748b;font-size:.8rem;cursor:pointer;"><i class="fa-solid fa-pen"></i></button>
      <button type="button" onclick="excluirTemplate('${t.id}')" title="Excluir" style="padding:4px 9px;border-radius:7px;border:1.5px solid #fee2e2;background:#fff;color:#ef4444;font-size:.8rem;cursor:pointer;"><i class="fa-solid fa-trash"></i></button>
    </div>`
  ).join('');
  // Atualizar datalist de categorias
  const cats = [...new Set(templates.map(t => t.categoria))];
  const dl = document.getElementById('tpl-categorias-datalist');
  if (dl) dl.innerHTML = cats.map(c => `<option value="${c}">`).join('');
}

function novoTemplate() {
  document.getElementById('tpl-id-edicao').value = '';
  document.getElementById('tpl-titulo').value = '';
  document.getElementById('tpl-categoria').value = '';
  document.getElementById('tpl-texto').value = '';
  document.getElementById('tpl-soap-s').value = '';
  document.getElementById('tpl-soap-o').value = '';
  document.getElementById('tpl-soap-a').value = '';
  document.getElementById('tpl-soap-p').value = '';
  document.querySelector('input[name="tpl-modo"][value="livre"]').checked = true;
  _atualizarAreaTplModo('livre');
  document.getElementById('form-edicao-template').style.display = 'block';
  document.getElementById('form-edicao-template').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function editarTemplate(id) {
  const templates = await _getTemplates();
  const tpl = templates.find(t => t.id === id);
  if (!tpl) return;
  document.getElementById('tpl-id-edicao').value = id;
  document.getElementById('tpl-titulo').value = tpl.titulo;
  document.getElementById('tpl-categoria').value = tpl.categoria;
  document.getElementById('tpl-texto').value = tpl.texto || '';
  document.getElementById('tpl-soap-s').value = tpl.soapS || '';
  document.getElementById('tpl-soap-o').value = tpl.soapO || '';
  document.getElementById('tpl-soap-a').value = tpl.soapA || '';
  document.getElementById('tpl-soap-p').value = tpl.soapP || '';
  const modoEl = document.querySelector(`input[name="tpl-modo"][value="${tpl.modo || 'livre'}"]`);
  if (modoEl) modoEl.checked = true;
  _atualizarAreaTplModo(tpl.modo || 'livre');
  document.getElementById('form-edicao-template').style.display = 'block';
  document.getElementById('form-edicao-template').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _atualizarAreaTplModo(modo) {
  document.getElementById('tpl-area-livre').style.display = modo === 'livre' ? 'block' : 'none';
  document.getElementById('tpl-area-soap').style.display = modo === 'estruturado' ? 'block' : 'none';
}

// Listener para troca de modo no editor de template
document.addEventListener('change', function(e) {
  if (e.target && e.target.name === 'tpl-modo') {
    _atualizarAreaTplModo(e.target.value);
  }
});

async function salvarTemplate() {
  const titulo = document.getElementById('tpl-titulo').value.trim();
  const categoria = document.getElementById('tpl-categoria').value.trim();
  if (!titulo) { alert('Informe o título do template.'); return; }
  if (!categoria) { alert('Informe a categoria.'); return; }
  const modo = document.querySelector('input[name="tpl-modo"]:checked')?.value || 'livre';
  const templates = await _getTemplates();
  const idEdicao = document.getElementById('tpl-id-edicao').value;
  const tpl = {
    id: idEdicao || ('tpl_custom_' + Date.now()),
    titulo, categoria, modo,
    texto: modo === 'livre' ? document.getElementById('tpl-texto').value : '',
    soapS: modo === 'estruturado' ? document.getElementById('tpl-soap-s').value : '',
    soapO: modo === 'estruturado' ? document.getElementById('tpl-soap-o').value : '',
    soapA: modo === 'estruturado' ? document.getElementById('tpl-soap-a').value : '',
    soapP: modo === 'estruturado' ? document.getElementById('tpl-soap-p').value : '',
  };
  if (idEdicao) {
    const idx = templates.findIndex(t => t.id === idEdicao);
    if (idx >= 0) templates[idx] = tpl; else templates.push(tpl);
  } else {
    templates.push(tpl);
  }
  await _saveTemplates(templates);
  document.getElementById('form-edicao-template').style.display = 'none';
  await renderizarListaGerenciar();
}

function cancelarEdicaoTemplate() {
  document.getElementById('form-edicao-template').style.display = 'none';
}

async function excluirTemplate(id) {
  if (!confirm('Excluir este template?')) return;
  const templates = (await _getTemplates()).filter(t => t.id !== id);
  await _saveTemplates(templates);
  await renderizarListaGerenciar();
}

async function restaurarTemplatesPadrao() {
  if (!confirm('Restaurar todos os templates padrão?\n\nSeus templates personalizados serão removidos.')) return;
  await _saveTemplates(JSON.parse(JSON.stringify(TEMPLATES_PADRAO)));
  await renderizarListaGerenciar();
}



// ── Humor ─────────────────────────────────────────────────────
function initHumorBtns(pfx='') {
  const container = document.getElementById(pfx+'humor-btns');
  if (!container) return;
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = `${pfx}humor-btn-${i}`;
    btn.dataset.valor = i;
    btn.textContent = i;
    btn.style.cssText = `width:32px;height:32px;border-radius:50%;border:2px solid #e2e8f0;
      background:#f8fafc;font-size:.82rem;font-weight:700;cursor:pointer;
      transition:all .15s;color:#64748b;flex-shrink:0;`;
    btn.onclick = () => selecionarHumor(i, pfx);
    container.appendChild(btn);
  }
}

function selecionarHumor(valor, pfx='') {
  document.getElementById(pfx+'sessao-humor').value = valor;
  for (let i = 1; i <= 10; i++) {
    const btn = document.getElementById(`${pfx}humor-btn-${i}`);
    if (!btn) continue;
    const ativo = i === valor;
    const cor = i <= 3 ? '#ef4444' : i <= 5 ? '#f97316' : i <= 7 ? '#eab308' : '#22c55e';
    btn.style.background  = ativo ? cor : '#f8fafc';
    btn.style.borderColor = ativo ? cor : '#e2e8f0';
    btn.style.color       = ativo ? '#fff' : '#64748b';
    btn.style.transform   = ativo ? 'scale(1.18)' : 'scale(1)';
  }
}

// ── Técnicas ──────────────────────────────────────────────────
function initTecnicasChips(pfx='') {
  const container = document.getElementById(pfx+'tecnicas-chips');
  if (!container) return;
  container.innerHTML = '';
  TECNICAS_LISTA.forEach(t => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.dataset.tecnica = t;
    chip.textContent = t;
    chip.style.cssText = `padding:4px 10px;border-radius:20px;border:1.5px solid #e2e8f0;
      background:#f8fafc;font-size:.78rem;font-weight:600;color:#64748b;cursor:pointer;transition:all .15s;`;
    chip.onclick = () => toggleTecnica(t, chip, pfx);
    container.appendChild(chip);
  });
  const inp = document.getElementById(pfx+'tecnica-custom');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); const v = this.value.trim(); if (v) { adicionarTecnicaCustom(v, pfx); this.value=''; } }
    });
  }
}

function toggleTecnica(nome, btn, pfx='') {
  if (_tecnicasAtivas.has(nome)) {
    _tecnicasAtivas.delete(nome);
    btn.style.background = '#f8fafc'; btn.style.borderColor = '#e2e8f0'; btn.style.color = '#64748b';
  } else {
    _tecnicasAtivas.add(nome);
    btn.style.background = '#ede9fe'; btn.style.borderColor = '#a78bfa'; btn.style.color = '#5b21b6';
  }
  atualizarHiddenTecnicas(pfx);
}

function ativarTecnica(nome, pfx='') {
  _tecnicasAtivas.add(nome);
  document.querySelectorAll('#'+pfx+'tecnicas-chips button[data-tecnica]').forEach(chip => {
    if (chip.dataset.tecnica === nome) {
      chip.style.background = '#ede9fe'; chip.style.borderColor = '#a78bfa'; chip.style.color = '#5b21b6';
    }
  });
  atualizarHiddenTecnicas(pfx);
}

function adicionarTecnicaCustom(nome, pfx='') {
  const container = document.getElementById(pfx+'tecnicas-chips');
  const chip = document.createElement('button');
  chip.type = 'button'; chip.dataset.tecnica = nome; chip.textContent = nome + ' ✕';
  chip.style.cssText = `padding:4px 10px;border-radius:20px;border:1.5px solid #a78bfa;
    background:#ede9fe;font-size:.78rem;font-weight:600;color:#5b21b6;cursor:pointer;transition:all .15s;`;
  chip.onclick = () => { _tecnicasAtivas.delete(nome); chip.remove(); atualizarHiddenTecnicas(pfx); };
  container.appendChild(chip);
  _tecnicasAtivas.add(nome);
  atualizarHiddenTecnicas(pfx);
}

function atualizarHiddenTecnicas(pfx='') {
  document.getElementById(pfx+'sessao-tecnicas').value = [..._tecnicasAtivas].join('|');
}

// ── SOAP ──────────────────────────────────────────────────────
function alternarModoRegistro(modo, pfx='') {
  window._modoRegistroAtual = modo;
  const livre = document.getElementById(pfx+'modo-livre');
  const estruturado = document.getElementById(pfx+'modo-estruturado');
  const btnLivre = document.getElementById(pfx+'btn-modo-livre');
  const btnEstruturado = document.getElementById(pfx+'btn-modo-estruturado');
  const textoCA = document.getElementById(pfx+'texto-consulta');
  if (modo === 'estruturado') {
    livre.style.display = 'none'; estruturado.style.display = 'block';
    textoCA.required = false;
    btnEstruturado.style.cssText += ';background:white;color:#7c3aed;box-shadow:0 1px 3px rgba(0,0,0,.08);';
    btnLivre.style.background = 'transparent'; btnLivre.style.color = '#64748b'; btnLivre.style.boxShadow = 'none';
  } else {
    livre.style.display = 'block'; estruturado.style.display = 'none';
    textoCA.required = true;
    btnLivre.style.cssText += ';background:white;color:#d63384;box-shadow:0 1px 3px rgba(0,0,0,.08);';
    btnEstruturado.style.background = 'transparent'; btnEstruturado.style.color = '#64748b'; btnEstruturado.style.boxShadow = 'none';
  }
}

// ── Risco — alerta visual ─────────────────────────────────────
function atualizarAlertaRisco(pfx='') {
  const ideacao = document.getElementById(pfx+'risco-ideacao')?.value || '';
  const autolesao = document.getElementById(pfx+'risco-autolesao')?.value || '';
  const hetero = document.getElementById(pfx+'risco-hetero')?.value || '';
  const alerta = document.getElementById(pfx+'alerta-risco-elevado');
  if (!alerta) return;
  const alto = ['ativa-sem-plano','ativa-com-plano','tentativa-recente'].includes(ideacao)
    || autolesao === 'atual'
    || hetero === 'ameaca';
  alerta.style.display = alto ? 'block' : 'none';
}

// ── Objetivos Terapêuticos ────────────────────────────────────
function adicionarObjetivo(pfx='') {
  const inp = document.getElementById(pfx+'objetivo-novo-texto');
  const texto = inp ? inp.value.trim() : '';
  if (!texto) return;
  const id = Date.now();
  _objetivosLista.push({ id, texto, concluido: false });
  inp.value = '';
  renderizarObjetivos(pfx);
}

function renderizarObjetivos(pfx='') {
  const lista = document.getElementById(pfx+'objetivos-lista');
  if (!lista) return;
  lista.innerHTML = '';
  _objetivosLista.forEach(obj => {
    const item = document.createElement('div');
    item.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;
      border:1.5px solid ${obj.concluido ? '#bbf7d0' : '#e2e8f0'};
      background:${obj.concluido ? '#f0fdf4' : '#f8fafc'};`;
    item.innerHTML = `
      <input type="checkbox" ${obj.concluido ? 'checked' : ''} style="width:15px;height:15px;accent-color:#059669;cursor:pointer;"
        onchange="toggleObjetivo(${obj.id}, this.checked, '${pfx}')">
      <span style="flex:1;font-size:.83rem;font-weight:500;color:${obj.concluido ? '#059669' : '#334155'};
        text-decoration:${obj.concluido ? 'line-through' : 'none'};">${obj.texto}</span>
      <button type="button" onclick="removerObjetivo(${obj.id}, '${pfx}')"
        style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:.85rem;padding:2px 4px;"
        title="Remover">✕</button>`;
    lista.appendChild(item);
  });
  // Atualiza hidden
  document.getElementById(pfx+'sessao-objetivos').value = JSON.stringify(_objetivosLista);
}

function toggleObjetivo(id, concluido, pfx='') {
  const obj = _objetivosLista.find(o => o.id === id);
  if (obj) { obj.concluido = concluido; renderizarObjetivos(pfx); }
}

function removerObjetivo(id, pfx='') {
  _objetivosLista = _objetivosLista.filter(o => o.id !== id);
  renderizarObjetivos(pfx);
}

// ── Limpar prontuário completo ────────────────────────────────
function limparProntuarioExtra(pfx='') {
  // Humor
  document.getElementById(pfx+'sessao-humor').value = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.getElementById(`${pfx}humor-btn-${i}`);
    if (btn) { btn.style.background='#f8fafc'; btn.style.borderColor='#e2e8f0'; btn.style.color='#64748b'; btn.style.transform='scale(1)'; }
  }
  // Técnicas
  _tecnicasAtivas.clear();
  document.querySelectorAll('#'+pfx+'tecnicas-chips button').forEach(chip => {
    if (TECNICAS_LISTA.includes(chip.dataset.tecnica)) {
      chip.style.background='#f8fafc'; chip.style.borderColor='#e2e8f0'; chip.style.color='#64748b';
    } else { chip.remove(); }
  });
  atualizarHiddenTecnicas(pfx);
  // SOAP
  ['soap-s','soap-o','soap-a','soap-p'].forEach(id => { const el=document.getElementById(pfx+id); if(el) el.value=''; });
  // EMA
  ['ema-consciencia','ema-atencao','ema-memoria','ema-afeto','ema-pensamento-forma',
   'ema-pensamento-conteudo','ema-percepcao','ema-insight','ema-obs'].forEach(id => {
    const el = document.getElementById(pfx+id); if (el) el.value = '';
  });
  // Risco
  ['risco-ideacao','risco-autolesao','risco-hetero','risco-substancias','risco-plano'].forEach(id => {
    const el = document.getElementById(pfx+id); if (el) el.value = '';
  });
  const alerta = document.getElementById(pfx+'alerta-risco-elevado');
  if (alerta) alerta.style.display = 'none';
  // Objetivos
  _objetivosLista = [];
  renderizarObjetivos(pfx);
  // Formulação
  ['form-predisponentes','form-precipitantes','form-manutencao','form-protecao','form-hipotese'].forEach(id => {
    const el = document.getElementById(pfx+id); if (el) el.value = '';
  });
  // Extra
  const elNum = document.getElementById(pfx+'sessao-numero'); if (elNum) elNum.value = '';
  const elTarefa = document.getElementById(pfx+'sessao-tarefa'); if (elTarefa) elTarefa.value = '';
  alternarModoRegistro('livre', pfx);
}

// Inicializar ao carregar
document.addEventListener('DOMContentLoaded', function() {
  initHumorBtns('du-');
  initTecnicasChips('du-');
  aplicarVisibilidadeSecoes();
});
if (document.readyState !== 'loading') {
  initHumorBtns('du-');
  initTecnicasChips('du-');
  aplicarVisibilidadeSecoes();
}

// ============================================================
//  DITADO POR VOZ — Win + H (nativo do Windows)
// ============================================================
(function initTranscricao() {

    function atualizarUI(ativo) {
        const btn    = document.getElementById('btn-microfone');
        const status = document.getElementById('mic-status');
        const info   = document.getElementById('mic-info');
        if (!btn) return;
        if (ativo) {
            btn.innerHTML = '<i class="fa-solid fa-microphone-lines"></i> Ouvindo...';
            btn.classList.add('gravando');
            if (status) status.style.display = 'flex';
            if (info)   info.style.display   = 'flex';
        } else {
            btn.innerHTML = '<i class="fa-solid fa-microphone"></i> Ditado por voz';
            btn.classList.remove('gravando');
            if (status) status.style.display = 'none';
            if (info)   info.style.display   = 'none';
        }
    }

    window.toggleTranscricao = function() {
        // Foca o textarea para que o Win+H insira o texto no campo correto
        const textarea = document.getElementById('texto-consulta');
        if (textarea) textarea.focus();

        // Dispara Win + H via Electron (ipcRenderer) ou via robot.js
        if (ipcRenderer) {
            ipcRenderer.invoke('voz-winhkey');
        }

        atualizarUI(true);

        // Após 30s sem interação, volta o botão ao estado normal
        setTimeout(() => atualizarUI(false), 30000);
    };

})();

// ====== AUTO-UPDATE — Interface Visual ======
// Escuta os eventos enviados pelo main.js via autoUpdater
// e exibe notificações discretas para o usuário.

(function iniciarUpdateUI() {
    if (!ipcRenderer) return;

    // Exibe a versão atual instalada no rodapé (ex: "v2.0.1")
    async function exibirVersaoAtual() {
        try {
            const versao = await ipcRenderer.invoke('update-versao-atual');
            const el = document.getElementById('rodape-versao');
            if (el && versao) el.textContent = `v${versao}`;
        } catch (e) {
            // silencioso — não é crítico pro funcionamento do sistema
        }
    }
    exibirVersaoAtual();

    function criarNotificacaoUpdate() {
        if (document.getElementById('update-notificacao')) return;
        const el = document.createElement('div');
        el.id = 'update-notificacao';
        el.style.cssText = [
            'position:fixed', 'bottom:1.5rem', 'right:1.5rem',
            'background:#1e293b', 'color:#f1f5f9',
            'border-radius:.75rem', 'padding:1rem 1.25rem',
            'box-shadow:0 8px 24px rgba(0,0,0,0.3)',
            'z-index:999998', 'max-width:320px', 'width:100%',
            'display:none', 'flex-direction:column', 'gap:.6rem',
            'font-size:.85rem', 'border:1px solid #334155'
        ].join(';');
        el.innerHTML = `
            <div style="display:flex;align-items:center;gap:.6rem;">
                <span id="update-icone" style="font-size:1.3rem;">🔄</span>
                <span id="update-msg" style="flex:1;font-weight:600;line-height:1.3;"></span>
                <button id="update-fechar" onclick="document.getElementById('update-notificacao').style.display='none'"
                    style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1rem;padding:.2rem;line-height:1;">✕</button>
            </div>
            <div id="update-barra-wrap" style="display:none;background:#334155;border-radius:99px;height:6px;overflow:hidden;">
                <div id="update-barra" style="height:100%;background:#3b82f6;width:0%;transition:width .3s;border-radius:99px;"></div>
            </div>
            <button id="update-btn-reiniciar" onclick="reiniciarParaAtualizar()"
                style="display:none;background:#3b82f6;color:#fff;border:none;border-radius:.5rem;
                       padding:.55rem 1rem;font-weight:700;cursor:pointer;font-size:.85rem;">
                🔁 Reiniciar e atualizar agora
            </button>
        `;
        document.body.appendChild(el);
    }

    function mostrarUpdate(icone, msg, mostrarBarra, mostrarBotao) {
        criarNotificacaoUpdate();
        const el    = document.getElementById('update-notificacao');
        const ic    = document.getElementById('update-icone');
        const msgEl = document.getElementById('update-msg');
        const barra = document.getElementById('update-barra-wrap');
        const btn   = document.getElementById('update-btn-reiniciar');
        ic.textContent      = icone;
        msgEl.textContent   = msg;
        barra.style.display = mostrarBarra ? 'block' : 'none';
        btn.style.display   = mostrarBotao  ? 'block' : 'none';
        el.style.display    = 'flex';
    }

    function atualizarBarra(pct) {
        const barra = document.getElementById('update-barra');
        if (barra) barra.style.width = pct + '%';
    }

    // Nova versão encontrada — começa a baixar silenciosamente
    ipcRenderer.on('update-disponivel', (e, { versao }) => {
        mostrarUpdate('📦', `Nova versão ${versao} encontrada. Baixando...`, true, false);
    });

    // Progresso do download
    ipcRenderer.on('update-progresso', (e, { pct }) => {
        criarNotificacaoUpdate();
        atualizarBarra(pct);
        const msgEl = document.getElementById('update-msg');
        if (msgEl) msgEl.textContent = `Baixando atualização... ${pct}%`;
    });

    // Download concluído — pede pra reiniciar
    ipcRenderer.on('update-pronto', (e, { versao }) => {
        mostrarUpdate('✅', `Versão ${versao} pronta! Reinicie para aplicar.`, false, true);
        // Esconde o X pra garantir que o usuário veja
        const btnFechar = document.getElementById('update-fechar');
        if (btnFechar) btnFechar.style.display = 'none';
    });

    // Já na versão mais recente — silencioso
    ipcRenderer.on('update-nao-disponivel', () => {
        const el = document.getElementById('update-notificacao');
        if (el) el.style.display = 'none';
    });

})();

function reiniciarParaAtualizar() {
    if (ipcRenderer) ipcRenderer.send('update-instalar-agora');
}

// ══════════════════════════════════════════════════════════
// TELA HOME — Painel de bem-estar do psicólogo
// ══════════════════════════════════════════════════════════

const CITACOES = [
    { texto: "O cuidado de si mesmo é a base de todo cuidado com o outro.", autor: "Carl Rogers" },
    { texto: "A cura começa quando alguém se sente verdadeiramente ouvido.", autor: "Carl Rogers" },
    { texto: "Conhece-te a ti mesmo.", autor: "Sócrates" },
    { texto: "Não é o mais forte que sobrevive, mas o mais adaptável.", autor: "Charles Darwin" },
    { texto: "A saúde mental é tão importante quanto a saúde física.", autor: "OMS" },
    { texto: "Tudo que somos é resultado do que pensamos.", autor: "Buda" },
    { texto: "A vida não é medida pelo número de respirações que tomamos, mas pelos momentos que nos tiram o fôlego.", autor: "Maya Angelou" },
    { texto: "O inconsciente é o verdadeiro psíquico.", autor: "Sigmund Freud" },
    { texto: "Onde há amor e sabedoria, não há medo.", autor: "São Francisco de Assis" },
    { texto: "A gratidão transforma o que temos em suficiente.", autor: "Anonimo" },
];

const NOTICIAS_FIXAS = [
    { tag: "psico",  texto: "CFP debate regulamentação do atendimento psicológico por inteligência artificial", fonte: "CFP · jun 2026",            url: "https://cfp.org.br/noticias/" },
    { tag: "mental", texto: "Burnout cresce 34% entre profissionais de saúde no Brasil, aponta estudo da USP",   fonte: "USP · jun 2026",            url: "https://www.usp.br/saude/" },
    { tag: "neuro",  texto: "Nova pesquisa associa qualidade do sono à prevenção de Alzheimer em adultos jovens", fonte: "Nature Medicine · jun 2026", url: "https://www.nature.com/nm/" },
    { tag: "saude",  texto: "OMS recomenda 150 min/semana de exercício aeróbico para saúde mental e física",     fonte: "OMS · jun 2026",            url: "https://www.who.int/pt" },
    { tag: "psico",  texto: "Terapia cognitivo-comportamental online tem eficácia equivalente ao presencial, confirma meta-análise", fonte: "Lancet Psychiatry · mai 2026", url: "https://www.thelancet.com/journals/lanpsy/home" },
];

const ICONES_TEMPO = {
    0: '☀️', 1: '🌤️', 2: '⛅', 3: '🌥️',
    45: '🌫️', 48: '🌫️',
    51: '🌦️', 53: '🌦️', 55: '🌧️',
    61: '🌧️', 63: '🌧️', 65: '🌧️',
    71: '🌨️', 73: '🌨️', 75: '❄️',
    80: '🌦️', 81: '🌧️', 82: '⛈️',
    95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const DESC_TEMPO = {
    0: 'Céu limpo', 1: 'Principalmente limpo', 2: 'Parcialmente nublado', 3: 'Nublado',
    45: 'Neblina', 48: 'Neblina com geada',
    51: 'Garoa leve', 53: 'Garoa moderada', 55: 'Garoa intensa',
    61: 'Chuva leve', 63: 'Chuva moderada', 65: 'Chuva forte',
    71: 'Neve leve', 73: 'Neve moderada', 75: 'Neve forte',
    80: 'Pancadas leves', 81: 'Pancadas moderadas', 82: 'Pancadas fortes',
    95: 'Trovoada', 96: 'Trovoada com granizo', 99: 'Trovoada forte',
};

let homeJaCarregou = false;

async function iniciarTelaHome() {
    // Saudação e data
    const agora = new Date();
    const hora = agora.getHours();
    const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
    const usuarioLogado = JSON.parse(sessionStorage.getItem('usuarioLogado') || '{}');
    const nome = usuarioLogado?.nome ? `, ${usuarioLogado.nome.split(' ')[0]}` : '';
    document.getElementById('home-saudacao-txt').textContent = `${saudacao}${nome}! 👋`;

    const opts = { weekday:'long', day:'numeric', month:'long', year:'numeric' };
    // Cidade: tenta pegar do config da clínica, senão usa geolocalização por IP
    let cidadeLabel = '';
    try {
        if (ipcRenderer) {
            const cfg = await ipc('db-get-config') || {};
            if (cfg.cidade_clinica) {
                cidadeLabel = ' · ' + cfg.cidade_clinica;
            }
        }
        if (!cidadeLabel) {
            const geoData = await ipc('geo-localizar');
            if (geoData && geoData.city) {
                cidadeLabel = ` · ${geoData.city}, ${geoData.region || ''}`.trimEnd().replace(/,\s*$/, '');
            }
        }
    } catch(e) { /* sem conexão — omite cidade */ }

    document.getElementById('home-data-txt').textContent =
        agora.toLocaleDateString('pt-BR', opts) + cidadeLabel;

    // Métricas do sistema
    homeCarregarMetricas();
    if (typeof renderFinanceiro === 'function') renderFinanceiro();

    // Citação rotativa por dia
    // (obs: a tela atual usa #painel-frase via fraseHoje() no clinica.html;
    // mantemos isto com checagem de null pois #home-citacao-txt/-autor não existem mais no HTML)
    const idx = agora.getDate() % CITACOES.length;
    const cit = CITACOES[idx];
    const elCitacaoTxt = document.getElementById('home-citacao-txt');
    const elCitacaoAutor = document.getElementById('home-citacao-autor');
    if (elCitacaoTxt) elCitacaoTxt.textContent = `"${cit.texto}"`;
    if (elCitacaoAutor) elCitacaoAutor.textContent = `— ${cit.autor}`;

    // Notícias (estáticas rotativas — pode evoluir para RSS depois)
    homeCarregarNoticias();

    // Rotativos fixos (saúde mental, física, atividades)
    homeRotInit('mental');
    homeRotInit('fisica');
    homeRotInit('ativ');

    // Mural de Intenções
    muralRenderizar();


}

async function homeCarregarMetricas() {
    try {
        const hoje = new Date().toISOString().slice(0, 10);
        const agora = new Date().toTimeString().slice(0, 5);

        // ── Consultas de hoje: prontuário (db-todas-consultas) + agenda (db-listar-agendamentos) ──
        let consultasHoje = 0;
        let proximaHora   = null;
        try {
            const horaAgoraMin = parseInt(agora.split(':')[0]) * 60 + parseInt(agora.split(':')[1]);
            const candidatas = [];

            // 1) Prontuário clínica via SQLite
            try {
                const todasC = (ipcRenderer ? await ipc('db-todas-consultas') : null) || [];
                const deHoje = todasC.filter(c =>
                    c.data === hoje || (c.dataHora && c.dataHora.startsWith(hoje))
                );
                consultasHoje += deHoje.length;
                deHoje.forEach(c => {
                    const h = c.hora || c.dataHora?.split('T')[1]?.slice(0,5) || '';
                    if (h) candidatas.push(h);
                });
            } catch(e) {}

            // 2) Agenda rápida via db-listar-agendamentos
            // campos: { data: 'YYYY-MM-DD', hora: '10', status: 'confirmado' }
            try {
                const ags = (ipcRenderer ? await ipc('db-listar-agendamentos') : null) || [];
                const deHoje = ags.filter(a => a.data === hoje && a.status !== 'cancelado');
                consultasHoje += deHoje.length;
                deHoje.forEach(a => {
                    const hNum = parseFloat(a.hora);
                    const hh   = Math.floor(hNum);
                    const mm   = Math.round((hNum - hh) * 60);
                    const h    = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                    candidatas.push(h);
                });
            } catch(e) {}

            // Próxima: a hora mais cedo ainda no futuro
            proximaHora = candidatas
                .filter(h => {
                    const [hh, mm] = h.split(':').map(Number);
                    return (hh * 60 + (mm || 0)) > horaAgoraMin;
                })
                .sort()[0] || null;

        } catch(e) { console.warn('métricas consultas:', e); }

        const elConsultas = document.getElementById('hm-consultas');
        if (elConsultas) elConsultas.textContent = consultasHoje;
        const elProxima = document.getElementById('hm-proxima');
        if (elProxima) {
            elProxima.textContent = proximaHora ? `Próxima: ${proximaHora}` : 'Nenhuma pendente';
        }

        // ── Pacientes ativos via SQLite ───────────────────────
        let ativos = 0, aniversarios = 0;
        try {
            const pacs = (ipcRenderer ? await ipc('db-listar-pacientes') : null)
                         || JSON.parse(localStorage.getItem('pacientes') || '[]');
            ativos = pacs.filter(p => p.status !== 'inativo').length;

            const em7dias = new Date();
            em7dias.setDate(em7dias.getDate() + 7);
            const hoje0 = new Date(); hoje0.setHours(0,0,0,0);
            pacs.forEach(p => {
                if (!p.dataNascimento) return;
                const nasc    = new Date(p.dataNascimento);
                const esteAno = new Date(new Date().getFullYear(), nasc.getMonth(), nasc.getDate());
                if (esteAno >= hoje0 && esteAno <= em7dias) aniversarios++;
            });
        } catch(e) { console.warn('métricas pacientes:', e); }

        const elPacientes = document.getElementById('hm-pacientes');
        if (elPacientes) elPacientes.textContent = ativos;
        const elAniversarios = document.getElementById('hm-aniversarios');
        if (elAniversarios) elAniversarios.textContent = aniversarios;

        // ── A receber via SQLite ──────────────────────────────
        let pendente = 0;
        try {
            const pags = (ipcRenderer ? await ipc('db-todos-pagamentos') : null)
                         || JSON.parse(localStorage.getItem('pagamentos') || '[]');
            pendente = pags
                .filter(p => (p.status || '') !== 'Pago')
                .reduce((acc, p) => acc + (parseFloat(p.valor) || 0), 0);
        } catch(e) { console.warn('métricas pagamentos:', e); }

        const elReceber = document.getElementById('hm-receber');
        if (elReceber) {
            elReceber.textContent = pendente > 0
                ? `R$ ${pendente.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`
                : 'R$ 0';
        }

    } catch(e) {
        console.warn('Home métricas erro geral:', e);
    }
}

// Abre URL no navegador padrão (Electron ou browser)
function homeAbrirUrl(url) {
    if (!url) return;
    if (ipcRenderer) {
        ipcRenderer.send('abrir-url-externa', url);
    } else {
        window.open(url, '_blank');
    }
}

function homeCarregarNoticias() {
    const wrap = document.getElementById('rot-noticias');
    if (!wrap) return;
    const tagLabel = { psico: 'Psicologia', mental: 'Saúde mental', neuro: 'Neurociência', saude: 'Saúde física' };
    const tagClass = { psico: 'tag-psico', mental: 'tag-mental', neuro: 'tag-neuro', saude: 'tag-saude' };

    wrap.innerHTML = NOTICIAS_FIXAS.map((n, i) => `
        <div class="rot-item${i === 0 ? ' rot-ativo' : ''}">
          <div class="home-news-item home-clicavel" onclick="homeAbrirUrl('${n.url}')" title="Abrir no navegador" style="width:100%;">
            <span class="home-news-tag ${tagClass[n.tag]}">${tagLabel[n.tag]}</span>
            <p class="home-news-titulo">${n.texto} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:.6rem;opacity:.5;margin-left:4px;"></i></p>
            <p class="home-news-fonte">${n.fonte}</p>
          </div>
        </div>
    `).join('');

    homeRotInit('noticias');
}

// ══════════════════════════════════════════════════════════
//  CARROSSEL HOME — controle genérico
// ══════════════════════════════════════════════════════════
const _carState = {};
const _carAutoplay = {};
const CAR_AUTOPLAY_INTERVAL = 7000; // ms entre slides

function homeCarInit(id) {
    // para autoplay anterior antes de reiniciar
    homeCarStopAutoplay(id);
    const track  = document.getElementById(`car-${id}-track`);
    const dotsEl = document.getElementById(`car-${id}-dots`);
    if (!track) return;
    const slides = track.querySelectorAll('.home-carousel-slide');
    const total  = slides.length;
    _carState[id] = { idx: 0, total };

    // monta dots
    if (dotsEl) {
        dotsEl.innerHTML = '';
        for (let i = 0; i < total; i++) {
            const d = document.createElement('div');
            d.className = 'home-carousel-dot' + (i === 0 ? ' ativo' : '');
            d.onclick = () => { homeCarGoTo(id, i); homeCarResetAutoplay(id); };
            dotsEl.appendChild(d);
        }
    }

    homeCarRender(id);
    homeCarStartAutoplay(id);

    // pausar autoplay ao hover no card pai
    const wrap = document.getElementById(`car-${id}`);
    if (wrap) {
        wrap.addEventListener('mouseenter', () => homeCarStopAutoplay(id));
        wrap.addEventListener('mouseleave', () => homeCarStartAutoplay(id));
    }
}

function homeCarRender(id) {
    const { idx } = _carState[id];
    const track  = document.getElementById(`car-${id}-track`);
    const dotsEl = document.getElementById(`car-${id}-dots`);
    const prev   = document.getElementById(`car-${id}-prev`);
    const next   = document.getElementById(`car-${id}-next`);
    if (track) {
        const slides = track.querySelectorAll('.home-carousel-slide');
        slides.forEach((s, i) => {
            s.classList.toggle('car-ativo', i === idx);
        });
    }
    if (dotsEl) dotsEl.querySelectorAll('.home-carousel-dot').forEach((d,i) => d.classList.toggle('ativo', i === idx));
    if (prev) prev.disabled = false;
    if (next) next.disabled = false;
}

function homeCarNav(id, dir) {
    if (!_carState[id]) return;
    const s = _carState[id];
    s.idx = (s.idx + dir + s.total) % s.total;
    homeCarRender(id);
    homeCarResetAutoplay(id);
}

function homeCarGoTo(id, i) {
    if (!_carState[id]) return;
    _carState[id].idx = i;
    homeCarRender(id);
}

function homeCarStartAutoplay(id) {
    homeCarStopAutoplay(id); // garante que não empilha
    _carAutoplay[id] = setInterval(() => {
        if (!_carState[id]) return;
        const s = _carState[id];
        s.idx = (s.idx + 1) % s.total;
        homeCarRender(id);
    }, CAR_AUTOPLAY_INTERVAL);
}

function homeCarStopAutoplay(id) {
    if (_carAutoplay[id]) {
        clearInterval(_carAutoplay[id]);
        _carAutoplay[id] = null;
    }
}

function homeCarResetAutoplay(id) {
    homeCarStopAutoplay(id);
    homeCarStartAutoplay(id);
}

// ══════════════════════════════════════════════════════════
//  CALENDÁRIO HOME — AGENDAMENTOS + NOTIFICAÇÕES
// ══════════════════════════════════════════════════════════

// --- Storage dos agendamentos do calendário home ---
const CAL_KEY = 'home_agendamentos_cal';

function calGetAgendamentos() {
    try { return JSON.parse(localStorage.getItem(CAL_KEY) || '[]'); } catch(e) { return []; }
}
function calSaveAgendamentos(lista) {
    localStorage.setItem(CAL_KEY, JSON.stringify(lista));
}

// --- Estado do calendário ---
let calAnoAtual  = new Date().getFullYear();
let calMesAtual  = new Date().getMonth(); // 0-11
let calDiaSel    = null; // 'YYYY-MM-DD'
let calNotifAtivo = false;
let calNotifTimer = null;
const CAL_NOTIF_KEY = 'home_cal_notif';

// Inicializar calendário (chamado dentro de iniciarTelaHome)
function homeIniciarCalendario() {
    calNotifAtivo = localStorage.getItem(CAL_NOTIF_KEY) === '1';
    homeAtualizarBtnNotif();
    homeRenderCal();
    // Inicia monitoramento de notificações
    if (calNotifAtivo) homeIniciarMonitorNotif();
}

// Navegar mês (-1 = anterior, +1 = próximo)
function homeCal(delta) {
    calMesAtual += delta;
    if (calMesAtual < 0)  { calMesAtual = 11; calAnoAtual--; }
    if (calMesAtual > 11) { calMesAtual = 0;  calAnoAtual++; }
    calDiaSel = null;
    homeRenderCal();
    const evDiv = document.getElementById('cal-eventos-dia');
    if (evDiv) evDiv.style.display = 'none';
}

// Renderizar grade do calendário
function homeRenderCal() {
    const label = document.getElementById('cal-mes-label');
    const grid  = document.getElementById('cal-days');
    if (!label || !grid) return;

    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    label.textContent = `${meses[calMesAtual]} ${calAnoAtual}`;

    const hoje     = new Date();
    const hojeStr  = hoje.toISOString().slice(0,10);
    const primeiroDia = new Date(calAnoAtual, calMesAtual, 1).getDay(); // 0=Dom
    const totalDias   = new Date(calAnoAtual, calMesAtual + 1, 0).getDate();

    const agendamentos = calGetAgendamentos();

    // Mapear dias com eventos
    const diasComEvento = {};
    agendamentos.forEach(a => {
        if (!diasComEvento[a.data]) diasComEvento[a.data] = 0;
        diasComEvento[a.data]++;
    });

    let html = '';
    // Vazios iniciais
    for (let i = 0; i < primeiroDia; i++) {
        html += '<div class="cal-day cal-vazio"></div>';
    }
    // Dias do mês
    for (let d = 1; d <= totalDias; d++) {
        const mm   = String(calMesAtual + 1).padStart(2, '0');
        const dd   = String(d).padStart(2, '0');
        const data = `${calAnoAtual}-${mm}-${dd}`;
        const ehHoje = data === hojeStr;
        const ehSel  = data === calDiaSel;
        const qtd    = diasComEvento[data] || 0;

        let cls = 'cal-day';
        if (ehHoje) cls += ' cal-hoje';
        if (ehSel)  cls += ' cal-selecionado';

        const dotClass = ehHoje ? 'cal-dot cal-dot-hoje' : 'cal-dot';
        const dots = qtd > 0
            ? `<div class="cal-dots">${Array(Math.min(qtd,3)).fill(`<span class="${dotClass}"></span>`).join('')}</div>`
            : '';

        html += `<div class="${cls}" onclick="homeClicarDia('${data}')" title="${data}">${d}${dots}</div>`;
    }
    grid.innerHTML = html;
}

// Clicar em um dia → mostrar eventos + botão adicionar
function homeClicarDia(data) {
    calDiaSel = data;
    homeRenderCal();
    homeRenderEventosDia(data);
}

function homeRenderEventosDia(data) {
    const div = document.getElementById('cal-eventos-dia');
    if (!div) return;

    const agendamentos = calGetAgendamentos().filter(a => a.data === data);
    agendamentos.sort((a,b) => (a.hora||'').localeCompare(b.hora||''));

    const [ano, mes, dia] = data.split('-');
    const label = `${dia}/${mes}/${ano}`;

    let html = `<div style="font-size:.72rem;font-weight:700;color:#9d174d;margin-bottom:4px;">📅 ${label}</div>`;

    if (agendamentos.length === 0) {
        html += `<div style="font-size:.75rem;color:#94a3b8;text-align:center;padding:4px 0;">Nenhum agendamento neste dia.</div>`;
    } else {
        agendamentos.forEach(a => {
            html += `
            <div class="cal-evento-item">
              <span class="cal-evento-hora">${a.hora || '--:--'}</span>
              <span class="cal-evento-nome">${a.titulo || a.paciente || 'Anotação'}</span>
              <span style="font-size:.7rem;color:#94a3b8;">${a.tipo || ''}</span>
              <button onclick="calExcluirAgendamento('${a.id}')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:.8rem;padding:0 2px;" title="Remover"><i class="fa-solid fa-xmark"></i></button>
            </div>`;
        });
    }

    html += `<button class="cal-btn-add" onclick="homeAbrirModalAgend('${data}')">
               <i class="fa-solid fa-plus"></i> Adicionar agendamento em ${label}
             </button>`;

    div.innerHTML = html;
    div.style.display = 'flex';
}

function calExcluirAgendamento(id) {
    const lista = calGetAgendamentos().filter(a => a.id !== id);
    calSaveAgendamentos(lista);
    showToast('Agendamento removido.', 'aviso');
    homeRenderCal();
    if (calDiaSel) homeRenderEventosDia(calDiaSel);
}

// ── Modal de agendamento ──
function homeAbrirModalAgend(data) {
    const modal = document.getElementById('modal-cal-agend');
    if (!modal) return;

    // Label da data
    const [ano, mes, dia] = data.split('-');
    document.getElementById('cal-modal-data-label').textContent = `· ${dia}/${mes}/${ano}`;

    // Armazenar data corrente no modal
    modal.dataset.dataAlvo = data;

    modal.classList.add('aberto');
}

function homeFecharModalAgend() {
    const modal = document.getElementById('modal-cal-agend');
    if (modal) modal.classList.remove('aberto');
}

function homeSalvarAgendamento() {
    const modal  = document.getElementById('modal-cal-agend');
    const data   = modal?.dataset.dataAlvo;
    const titulo = (document.getElementById('cal-modal-titulo')?.value || '').trim();
    const hora   = document.getElementById('cal-modal-hora')?.value;
    const obs    = (document.getElementById('cal-modal-obs')?.value || '').trim();

    if (!data || !hora) {
        showToast('Informe o horário.', 'aviso');
        return;
    }

    const lista = calGetAgendamentos();
    lista.push({ id: Date.now().toString(), data, hora, titulo: titulo || 'Anotação', obs });
    calSaveAgendamentos(lista);

    homeFecharModalAgend();
    showToast(`"${titulo || 'Anotação'}" salvo para ${hora}.`, 'sucesso');
    homeRenderCal();
    if (calDiaSel === data) homeRenderEventosDia(data);

    document.getElementById('cal-modal-titulo').value = '';
    const obsEl = document.getElementById('cal-modal-obs');
    if (obsEl) obsEl.value = '';
}

// ── Notificações de sessão ──
function homeToggleNotificacoes() {
    calNotifAtivo = !calNotifAtivo;
    localStorage.setItem(CAL_NOTIF_KEY, calNotifAtivo ? '1' : '0');
    homeAtualizarBtnNotif();

    if (calNotifAtivo) {
        solicitarPermissaoNotif();
        homeIniciarMonitorNotif();
        showToast('Notificações ativadas! Você será avisado 10 min antes.', 'sucesso');
    } else {
        if (calNotifTimer) clearInterval(calNotifTimer);
        showToast('Notificações desativadas.', 'aviso');
    }
}

function homeAtualizarBtnNotif() {
    const btn   = document.getElementById('cal-notif-btn');
    const icon  = document.getElementById('cal-notif-icon');
    const label = document.getElementById('cal-notif-label');
    if (!btn) return;
    if (calNotifAtivo) {
        btn.classList.add('cal-notif-ativo');
        if (icon)  icon.className  = 'fa-solid fa-bell-ring';
        if (label) label.textContent = 'Ativas';
    } else {
        btn.classList.remove('cal-notif-ativo');
        if (icon)  icon.className  = 'fa-solid fa-bell';
        if (label) label.textContent = 'Notif.';
    }
}

async function solicitarPermissaoNotif() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

// IDs já notificados (evitar repetição)
const calNotifJaAvisados = new Set();

function homeIniciarMonitorNotif() {
    if (calNotifTimer) clearInterval(calNotifTimer);
    calNotifTimer = setInterval(homeVerificarNotif, 30000); // checa a cada 30s
    homeVerificarNotif(); // verificação imediata
}

function homeVerificarNotif() {
    if (!calNotifAtivo) return;
    const agora   = new Date();
    const hojeStr = agora.toISOString().slice(0,10);
    const agoraMin = agora.getHours() * 60 + agora.getMinutes();

    const agendamentos = calGetAgendamentos().filter(a => a.data === hojeStr);

    agendamentos.forEach(a => {
        if (!a.hora) return;
        const [h, m] = a.hora.split(':').map(Number);
        const sessaoMin = h * 60 + m;
        const diff = sessaoMin - agoraMin;

        // Avisar com 10 minutos de antecedência (janela de ±1 min)
        if (diff >= 9 && diff <= 11) {
            const key = `${a.id}_10`;
            if (!calNotifJaAvisados.has(key)) {
                calNotifJaAvisados.add(key);
                homeDispararNotif(a, 10);
            }
        }
        // Avisar na hora exata (janela de ±1 min)
        if (diff >= -1 && diff <= 1) {
            const key = `${a.id}_0`;
            if (!calNotifJaAvisados.has(key)) {
                calNotifJaAvisados.add(key);
                homeDispararNotif(a, 0);
            }
        }
    });
}

function homeDispararNotif(agend, minutosAntes) {
    const msg = minutosAntes > 0
        ? `Em ${minutosAntes} min: ${agend.paciente} às ${agend.hora}`
        : `Agora: sessão com ${agend.paciente}`;

    // Toast visual interno
    homeMostrarToastNotif(msg, minutosAntes === 0);

    // Notificação nativa do OS (se permitida)
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('InnerCare — Lembrete de sessão', {
            body: msg,
            icon: 'icon.png'
        });
    }

    // Som de alerta suave
    homeTocarSomAlerta(minutosAntes === 0);
}

function homeMostrarToastNotif(msg, urgente) {
    const toast = document.createElement('div');
    toast.className = 'notif-toast';
    if (urgente) toast.style.borderLeftColor = '#ef4444';
    toast.innerHTML = `
        <span class="notif-toast-icon">${urgente ? '🔴' : '🔔'}</span>
        <div>
            <div style="font-weight:700;font-size:.82rem;margin-bottom:2px;">Lembrete de sessão</div>
            <div style="font-size:.78rem;color:#cbd5e1;">${msg}</div>
        </div>
        <button class="notif-toast-fechar" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>`;
    document.body.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 12000);
}

function homeTocarSomAlerta(urgente) {
    try {
        const ctx  = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);

        const notas = urgente ? [880, 660, 880] : [660, 880];
        notas.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;
            osc.connect(gain);
            osc.start(ctx.currentTime + i * 0.22);
            osc.stop(ctx.currentTime + i * 0.22 + 0.18);
        });
        setTimeout(() => ctx.close(), 1500);
    } catch(e) { /* silencioso se AudioContext não disponível */ }
}

// ──────────────────────────────────────────────────────────
async function homeCarregarTempo() {
    const el = document.getElementById('home-tempo-conteudo');
    try {
        let lat = -29.9178, lon = -51.1794, cidadeNome = '';

        // ── 1. Geolocation nativa do sistema (mais precisa) ──
        const coordsNativas = await new Promise((resolve) => {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
                pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
                ()  => resolve(null),
                { timeout: 5000, maximumAge: 300000 }
            );
        });

        if (coordsNativas) {
            lat = coordsNativas.lat;
            lon = coordsNativas.lon;
            // Reverse geocoding via Nominatim para obter nome real da cidade
            try {
                const rev = await fetch(
                    `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=pt-BR`,
                    { headers: { 'User-Agent': 'PsicoGestao/1.0' } }
                );
                const rd   = await rev.json();
                const addr = rd.address || {};
                const cidade = addr.city || addr.town || addr.village || addr.county || '';
                const estado = addr.state_code || addr.state || '';
                cidadeNome = cidade ? `${cidade}, ${estado}`.replace(/, $/, '') : '';
            } catch(e) { /* mantém cidadeNome vazio, será tratado abaixo */ }
        } else {
            // ── 2. Fallback: geolocalização por IP ──
            try {
                const gd = await ipc('geo-localizar');
                if (gd && gd.lat) {
                    lat = gd.lat;
                    lon = gd.lon;
                    cidadeNome = gd.city
                        ? `${gd.city}, ${gd.region || ''}`.trimEnd().replace(/,\s*$/, '')
                        : '';
                }
            } catch(e) { cidadeNome = 'Gravataí, RS'; }
        }

        // ── 3. Busca previsão do tempo ──
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min&timezone=America/Sao_Paulo&forecast_days=1`;

        const resp = await fetch(url);
        const data = await resp.json();
        const cur  = data.current;
        const dai  = data.daily;

        const codigo = cur.weather_code;
        const icone  = ICONES_TEMPO[codigo] || '🌡️';
        const desc   = DESC_TEMPO[codigo]   || 'Condição variável';
        const temp   = Math.round(cur.temperature_2m);
        const umid   = cur.relative_humidity_2m;
        const vento  = Math.round(cur.wind_speed_10m);
        const tmax   = Math.round(dai.temperature_2m_max[0]);
        const tmin   = Math.round(dai.temperature_2m_min[0]);

        const urlTempo = `https://www.tempo.com/${encodeURIComponent((cidadeNome || 'Brasil').split(',')[0].trim().toLowerCase())}.htm`;
        el.innerHTML = `
            <div class="tempo-hero home-clicavel" onclick="homeAbrirUrl('${urlTempo}')" title="Ver previsão completa">
                <span class="tempo-icon-home">${icone}</span>
                <div>
                    <div class="tempo-num">${temp}°C <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:.7rem;opacity:.4;"></i></div>
                    <div class="tempo-desc">${desc}</div>
                    <div class="tempo-cidade">${cidadeNome || 'Localização atual'}</div>
                </div>
            </div>
            <div class="tempo-det-grid">
                <div class="tempo-det"><i class="fa-solid fa-droplet"></i> Umidade: ${umid}%</div>
                <div class="tempo-det"><i class="fa-solid fa-wind"></i> Vento: ${vento} km/h</div>
                <div class="tempo-det"><i class="fa-solid fa-temperature-arrow-down"></i> Mín: ${tmin}°C</div>
                <div class="tempo-det"><i class="fa-solid fa-temperature-arrow-up"></i> Máx: ${tmax}°C</div>
            </div>`;
    } catch(e) {
        el.innerHTML = `<p class="home-news-loading"><i class="fa-solid fa-triangle-exclamation"></i> Sem conexão para previsão do tempo.</p>`;
    }
}

// ══════════════════════════════════════════════════════════
//  ROTATIVO HOME — texto que troca com cascata
// ══════════════════════════════════════════════════════════
const _rotState = {};
const ROT_INTERVAL = 12000;
const _rotTimer = {};

function homeRotInit(id) {
    const wrap = document.getElementById(`rot-${id}`);
    if (!wrap) return;
    const items = wrap.querySelectorAll('.rot-item');
    if (!items.length) return;

    // limpa timer anterior para evitar empilhamento de intervalos
    if (_rotTimer[id]) { clearInterval(_rotTimer[id]); _rotTimer[id] = null; }

    _rotState[id] = { idx: 0, total: items.length };
    homeRotRender(id);
    homeRotStartProgress(id);
    _rotTimer[id] = setInterval(() => {
        homeRotNext(id);
        homeRotStartProgress(id);
    }, ROT_INTERVAL);

    // remove listeners antigos clonando o seção pai
    const section = wrap.closest('.home-card') || wrap.closest('.home-left-section') || wrap;
    const fresh = section.cloneNode(true);
    section.parentNode.replaceChild(fresh, section);
    const freshWrap = document.getElementById(`rot-${id}`);
    if (!freshWrap) return;
    const freshSection = freshWrap.closest('.home-left-section') || freshWrap;
    freshSection.addEventListener('mouseenter', () => {
        if (_rotTimer[id]) clearInterval(_rotTimer[id]);
        homeRotPauseProgress(id);
    });
    freshSection.addEventListener('mouseleave', () => {
        if (_rotTimer[id]) clearInterval(_rotTimer[id]);
        homeRotStartProgress(id);
        _rotTimer[id] = setInterval(() => {
            homeRotNext(id);
            homeRotStartProgress(id);
        }, ROT_INTERVAL);
    });
}

function homeRotStartProgress(id) {
    const bar = document.getElementById(`prog-${id}`);
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            bar.style.transition = `width ${ROT_INTERVAL}ms linear`;
            bar.style.width = '100%';
        });
    });
}

function homeRotPauseProgress(id) {
    const bar = document.getElementById(`prog-${id}`);
    if (!bar) return;
    const computed = getComputedStyle(bar).width;
    const parent = bar.parentElement;
    const pct = parent ? (parseFloat(computed) / parent.offsetWidth * 100).toFixed(1) + '%' : '0%';
    bar.style.transition = 'none';
    bar.style.width = pct;
}

function homeRotNext(id) {
    const s = _rotState[id];
    s.idx = (s.idx + 1) % s.total;
    homeRotRender(id);
}

function homeRotRender(id) {
    const wrap = document.getElementById(`rot-${id}`);
    if (!wrap) return;
    const { idx } = _rotState[id];
    wrap.querySelectorAll('.rot-item').forEach((el, i) => {
        el.classList.toggle('rot-ativo', i === idx);
    });
}

// ═══════════════════════════════════════════════════════════════
//  RODAPÉ FIXO — Clima hora a hora + Agenda do dia
// ═══════════════════════════════════════════════════════════════

let _rodapeClimaAberto = false;
let _rodapeCalAberto   = false;
let _rodapeClimaCache  = null; // { temp, icone, hourly: [...] }
let _rodapeHoraInt     = null;

// ── Inicializar rodapé ──────────────────────────────────────
function rodapeIniciar() {
    rodapeAtualizarHora();
    if (_rodapeHoraInt) clearInterval(_rodapeHoraInt);
    _rodapeHoraInt = setInterval(rodapeAtualizarHora, 10000);
    rodapeCarregarClima();
    // Fechar popups ao clicar fora
    document.addEventListener('click', (e) => {
        if (_rodapeClimaAberto && !e.target.closest('#rodape-btn-clima') && !e.target.closest('#rodape-popup-clima')) {
            rodapeFecharClima();
        }
        if (_rodapeCalAberto && !e.target.closest('#rodape-btn-cal') && !e.target.closest('#rodape-popup-cal')) {
            rodapeFecharCal();
        }
    });
}

function rodapeAtualizarHora() {
    const el = document.getElementById('rodape-hora');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ── Clima ───────────────────────────────────────────────────
async function rodapeCarregarClima() {
    try {
        let lat = -29.9178, lon = -51.1794;
        const coords = await new Promise(res => {
            if (!navigator.geolocation) { res(null); return; }
            navigator.geolocation.getCurrentPosition(
                p => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
                () => res(null), { timeout: 5000, maximumAge: 300000 }
            );
        });
        if (coords) { lat = coords.lat; lon = coords.lon; }
        else {
            try {
                const gd = await ipc('geo-localizar');
                if (gd?.lat) { lat = gd.lat; lon = gd.lon; }
            } catch(e) {}
        }

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&timezone=America/Sao_Paulo&forecast_days=1`;
        const resp = await fetch(url);
        const data = await resp.json();
        const cur  = data.current;
        const temp = Math.round(cur.temperature_2m);
        const icone = ICONES_TEMPO[cur.weather_code] || '🌡️';

        // Montar previsão hora a hora (só horas de hoje)
        const hojeStr = new Date().toISOString().slice(0,10);
        const hourly = data.hourly;
        const horas = [];
        hourly.time.forEach((t, i) => {
            if (!t.startsWith(hojeStr)) return;
            horas.push({
                hora: t.slice(11,16),
                temp: Math.round(hourly.temperature_2m[i]),
                icone: ICONES_TEMPO[hourly.weather_code[i]] || '🌡️'
            });
        });

        _rodapeClimaCache = { temp, icone, horas, codigo: cur.weather_code };

        // Atualizar ícone no rodapé
        const btnIcon = document.getElementById('rodape-clima-icone');
        const btnTemp = document.getElementById('rodape-clima-temp');
        if (btnIcon) btnIcon.textContent = icone;
        if (btnTemp) btnTemp.textContent = temp + '°';
    } catch(e) {
        const btnTemp = document.getElementById('rodape-clima-temp');
        if (btnTemp) btnTemp.textContent = '--°';
    }
}

function rodapeToggleClima() {
    if (_rodapeClimaAberto) { rodapeFecharClima(); return; }
    // Fecha o outro popup
    if (_rodapeCalAberto) rodapeFecharCal();
    _rodapeClimaAberto = true;
    document.getElementById('rodape-btn-clima')?.classList.add('ativo');
    const popup = document.getElementById('rodape-popup-clima');
    if (popup) popup.style.display = 'block';
    rodapeRenderizarClima();
}

function rodapeFecharClima() {
    _rodapeClimaAberto = false;
    document.getElementById('rodape-btn-clima')?.classList.remove('ativo');
    const popup = document.getElementById('rodape-popup-clima');
    if (popup) popup.style.display = 'none';
}

function rodapeRenderizarClima() {
    const el = document.getElementById('rodape-clima-conteudo');
    if (!el) return;
    if (!_rodapeClimaCache) {
        el.innerHTML = '<p class="rodape-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando clima...</p>';
        rodapeCarregarClima().then(rodapeRenderizarClima);
        return;
    }
    const { temp, icone, horas, codigo } = _rodapeClimaCache;
    const desc = DESC_TEMPO[codigo] || 'Condição variável';
    const agoraH = new Date().getHours();

    // Card atual
    let html = `<div class="rodape-clima-atual">
        <div class="rodape-clima-atual-icon">${icone}</div>
        <div>
            <div class="rodape-clima-atual-temp">${temp}°C</div>
            <div class="rodape-clima-atual-desc">${desc}</div>
        </div>
    </div>`;

    // Scroll hora a hora
    html += `<div class="rodape-horas-scroll">`;
    horas.forEach(h => {
        const horaNum = parseInt(h.hora);
        const eAtual = horaNum === agoraH;
        html += `<div class="rodape-hora-item${eAtual ? ' atual' : ''}">
            <span class="rodape-hi-hora">${h.hora}</span>
            <span class="rodape-hi-icon">${h.icone}</span>
            <span class="rodape-hi-temp">${h.temp}°</span>
        </div>`;
    });
    html += `</div>`;
    el.innerHTML = html;

    // Rolar para hora atual
    setTimeout(() => {
        const scroll = el.querySelector('.rodape-horas-scroll');
        const atual  = el.querySelector('.rodape-hora-item.atual');
        if (scroll && atual) scroll.scrollLeft = atual.offsetLeft - 60;
    }, 50);
}

// ── Agenda ──────────────────────────────────────────────────
let _rodapeCalMes  = new Date().getMonth();
let _rodapeCalAno  = new Date().getFullYear();
let _rodapeCalDiaSel = null;

function rodapeToggleCal() {
    if (_rodapeCalAberto) { rodapeFecharCal(); return; }
    if (_rodapeClimaAberto) rodapeFecharClima();
    _rodapeCalAberto = true;
    document.getElementById('rodape-btn-cal')?.classList.add('ativo');
    const popup = document.getElementById('rodape-popup-cal');
    if (popup) popup.style.display = 'block';
    rodapeRenderizarCal();
}

function rodapeFecharCal() {
    _rodapeCalAberto = false;
    _rodapeCalDiaSel = null;
    document.getElementById('rodape-btn-cal')?.classList.remove('ativo');
    const popup = document.getElementById('rodape-popup-cal');
    if (popup) popup.style.display = 'none';
}

function rodapeNavCal(delta) {
    _rodapeCalMes += delta;
    if (_rodapeCalMes < 0)  { _rodapeCalMes = 11; _rodapeCalAno--; }
    if (_rodapeCalMes > 11) { _rodapeCalMes = 0;  _rodapeCalAno++; }
    _rodapeCalDiaSel = null;
    rodapeRenderizarCal();
}

async function rodapeRenderizarCal() {
    const el = document.getElementById('rodape-cal-lista');
    if (!el) return;

    const agendamentos = await ipc('db-listar-agendamentos') || [];
    const hoje    = new Date();
    const hojeStr = hoje.toISOString().slice(0,10);

    // Badge — total de hoje
    const deHoje = agendamentos.filter(a => a.data === hojeStr && a.status !== 'cancelado');
    const badge  = document.getElementById('rodape-cal-badge');
    if (badge) { badge.textContent = deHoje.length; badge.style.display = deHoje.length > 0 ? 'block' : 'none'; }

    // Mapear dias com eventos
    const diasComEvento = {};
    agendamentos.forEach(a => {
        if (a.status === 'cancelado') return;
        diasComEvento[a.data] = (diasComEvento[a.data] || 0) + 1;
    });

    const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const primeiroDia = new Date(_rodapeCalAno, _rodapeCalMes, 1).getDay();
    const totalDias   = new Date(_rodapeCalAno, _rodapeCalMes + 1, 0).getDate();

    let diasHtml = '';
    for (let i = 0; i < primeiroDia; i++) diasHtml += '<div class="rdc-day rdc-vazio"></div>';
    for (let d = 1; d <= totalDias; d++) {
        const mm   = String(_rodapeCalMes + 1).padStart(2,'0');
        const dd   = String(d).padStart(2,'0');
        const data = `${_rodapeCalAno}-${mm}-${dd}`;
        const ehHoje = data === hojeStr;
        const ehSel  = data === _rodapeCalDiaSel;
        const qtd    = diasComEvento[data] || 0;
        let cls = 'rdc-day';
        if (ehHoje) cls += ' rdc-hoje';
        if (ehSel)  cls += ' rdc-sel';
        const dots = qtd > 0 ? `<div class="rdc-dots">${Array(Math.min(qtd,3)).fill(`<span class="rdc-dot${ehHoje?' rdc-dot-hoje':''}"></span>`).join('')}</div>` : '';
        diasHtml += `<div class="${cls}" onclick="rodapeClicarDia('${data}')">${d}${dots}</div>`;
    }

    let eventosHtml = '';
    if (_rodapeCalDiaSel) {
        const evs = agendamentos.filter(a => a.data === _rodapeCalDiaSel && a.status !== 'cancelado')
                                .sort((a,b) => parseInt(a.hora)-parseInt(b.hora));
        const dataFmt = new Date(_rodapeCalDiaSel+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long'});
        eventosHtml = `<div class="rdc-eventos">
            <div class="rdc-ev-titulo"><i class="fa-solid fa-calendar-check"></i> ${dataFmt}</div>
            ${evs.length === 0
                ? '<p class="rodape-ag-vazio" style="padding:8px 0;">Nenhum atendimento.</p>'
                : evs.map(a => `<div class="rodape-ag-item">
                    <span class="rodape-ag-hora">${(() => { const hn = parseFloat(a.hora), hh = Math.floor(hn), mm = Math.round((hn - hh) * 60); return `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`; })()}</span>
                    <span class="rodape-ag-nome">${a.paciente||'—'}</span>
                    <span class="rodape-ag-status${a.status==='pendente'?' pendente':''}">${a.status==='pendente'?'Pendente':'Confirmado'}</span>
                  </div>`).join('')
            }
        </div>`;
    }

    el.innerHTML = `
        <div class="rdc-nav">
            <button onclick="rodapeNavCal(-1)" class="rdc-nav-btn"><i class="fa-solid fa-chevron-left"></i></button>
            <span class="rdc-mes-label">${meses[_rodapeCalMes]} ${_rodapeCalAno}</span>
            <button onclick="rodapeNavCal(+1)" class="rdc-nav-btn"><i class="fa-solid fa-chevron-right"></i></button>
        </div>
        <div class="rdc-dow">
            <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
        </div>
        <div class="rdc-grid">${diasHtml}</div>
        ${eventosHtml}
    `;
}

function rodapeClicarDia(data) {
    _rodapeCalDiaSel = _rodapeCalDiaSel === data ? null : data;
    rodapeRenderizarCal();
}

// ── Inicializar quando sistema carrega ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
    rodapeIniciar();
    // Atualizar badge da agenda a cada 5 min
    setInterval(async () => {
        if (!_rodapeCalAberto) {
            const hoje = new Date().toISOString().slice(0,10);
            const ags = await ipc('db-listar-agendamentos') || [];
            const count = ags.filter(a => a.data === hoje && a.status !== 'cancelado').length;
            const badge = document.getElementById('rodape-cal-badge');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'block' : 'none';
            }
        }
    }, 300000);

    // Quando celular agenda algo → atualiza agenda rápida, atendimentos e rodapé
    if (typeof ipcRenderer !== 'undefined') {
        ipcRenderer.on('drive-sync-celular', async () => {
            // Atualiza lista de atendimentos da home (se a função existir nesta versão da tela)
            if (typeof hmCarregarAtendimentos === 'function') {
                await hmCarregarAtendimentos(_hmFiltroAtend || 'hoje');
            }

            // Atualiza métricas (card "Consultas hoje")
            homeCarregarMetricas();

            // Atualiza badge e calendário do rodapé
            if (_rodapeCalAberto) rodapeRenderizarCal();
            else {
                const hoje = new Date().toISOString().slice(0,10);
                const ags = await ipc('db-listar-agendamentos') || [];
                const count = ags.filter(a => a.data === hoje && a.status !== 'cancelado').length;
                const badge = document.getElementById('rodape-cal-badge');
                if (badge) { badge.textContent = count; badge.style.display = count > 0 ? 'block' : 'none'; }
            }
        });
    }
});

// ═══════════════════════════════════════════════════════════════
//  HOME — HELPERS (espelhados do Painel para uso no script.js)
// ═══════════════════════════════════════════════════════════════

function hojeStr() { return new Date().toISOString().slice(0, 10); }

function semanaStr() {
    const hoje = new Date();
    const dias = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(hoje);
        d.setDate(hoje.getDate() + i);
        dias.push(d.toISOString().slice(0, 10));
    }
    return dias;
}

function mesAtual() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatarDataBR(str) {
    if (!str) return '—';
    return new Date(str + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function getPacientes() {
    try { return (typeof pacientes !== 'undefined' && Array.isArray(pacientes)) ? pacientes : []; }
    catch(e) { return []; }
}

function getConsultas() {
    try { return (typeof consultas !== 'undefined' && Array.isArray(consultas)) ? consultas : []; }
    catch(e) { return []; }
}

function getPagamentos() {
    try { return (typeof pagamentos !== 'undefined' && Array.isArray(pagamentos)) ? pagamentos : []; }
    catch(e) { return []; }
}

let _agendamentosCache = [];
async function getAgendamentos() {
    try {
        if (typeof ipcRenderer !== 'undefined') {
            _agendamentosCache = await ipcRenderer.invoke('db-listar-agendamentos') || [];
        }
    } catch(e) {}
    return _agendamentosCache;
}

function renderAniversariosEl(el, pacs, dias) {
    if (!el) return;
    const hoje = new Date();
    const anivs = pacs.filter(p => {
        const campo = p.nascimento || p.data_nascimento;
        if (!campo) return false;
        const nasc = new Date(campo + 'T12:00:00');
        for (let i = 0; i < dias; i++) {
            const d = new Date(hoje);
            d.setDate(hoje.getDate() + i);
            if (nasc.getDate() === d.getDate() && nasc.getMonth() === d.getMonth()) return true;
        }
        return false;
    });
    if (!anivs.length) {
        el.innerHTML = `<div style="font-size:.72rem;color:#9b7a8a;text-align:center;padding:.3rem;">Nenhum aniversário nos próximos ${dias} dias</div>`;
    } else {
        el.innerHTML = anivs.map(p => {
            const campo = p.nascimento || p.data_nascimento;
            const nasc  = new Date(campo + 'T12:00:00');
            const idade = new Date().getFullYear() - nasc.getFullYear();
            return `<div class="alerta-item info">
                <i class="fa-solid fa-cake-candles" style="color:#6366f1;"></i>
                <div class="alerta-txt"><b>${p.nome.split(' ')[0]}</b><span>${nasc.getDate()}/${nasc.getMonth()+1} — ${idade} anos</span></div>
            </div>`;
        }).join('');
    }
}
// ══════════════════════════════════════════════════════════════
// TECLA ESC — fecha a tela/modal aberta em qualquer parte do sistema
// ══════════════════════════════════════════════════════════════
// Alguns modais precisam de uma limpeza extra ao fechar (ex: sair do
// modo foco), então usam sua própria função. Os demais são fechados
// de forma genérica (display:none).
const MODAIS_FECHAMENTO_ESPECIAL = {
    'modal-documento-unico': 'fecharDocumentoUnico',
    'modal-testes': 'fecharModalTestes',
};

document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;

    // Painéis internos (não são modal-overlay) fecham primeiro, se abertos
    const painelTemplates = document.getElementById('painel-templates-evolucao');
    const painelSecoes = document.getElementById('painel-configurar-secoes');
    if (painelTemplates && painelTemplates.style.display === 'block') { fecharTemplatesEvolucao(); return; }
    if (painelSecoes && painelSecoes.style.display === 'block') { fecharConfigurarSecoes(); return; }

    // Encontra os modais visíveis (padrão .modal-overlay + display, ou o
    // padrão de classe "aberto" usado pelo modal de Testes Psicológicos)
    // e fecha o que estiver "por cima" (maior z-index).
    const abertos = Array.from(document.querySelectorAll('.modal-overlay, #modal-testes.aberto'))
        .filter(m => window.getComputedStyle(m).display !== 'none');
    if (!abertos.length) {
        // Nenhum modal aberto — se estiver na tela de Teleconsulta, ESC volta para a Home
        const telaTeleconsulta = document.getElementById('tela-teleconsulta');
        if (telaTeleconsulta && telaTeleconsulta.style.display !== 'none') {
            navegar('home');
        }
        return;
    }

    let topo = abertos[0];
    let maiorZ = -Infinity;
    abertos.forEach(m => {
        const z = parseInt(window.getComputedStyle(m).zIndex) || 0;
        if (z >= maiorZ) { maiorZ = z; topo = m; }
    });

    const fnEspecial = MODAIS_FECHAMENTO_ESPECIAL[topo.id];
    if (fnEspecial && typeof window[fnEspecial] === 'function') {
        window[fnEspecial]();
    } else {
        topo.style.display = 'none';
    }
});
