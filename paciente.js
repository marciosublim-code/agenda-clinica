// =========================================================
// PACIENTE.JS — Dossiê Clínico & Financeiro
// Lê dados via ipcRenderer (SQLite/Electron) com fallback
// para localStorage (modo navegador / workerWindow PDF).
// =========================================================

let _ipc = null;

function getIPC() {
    if (_ipc) return _ipc;
    try {
        _ipc = require('electron').ipcRenderer;
    } catch (e) {
        _ipc = null;
    }
    return _ipc;
}

// Verifica se está rodando dentro do Electron
function isElectron() {
    return getIPC() !== null;
}

// Busca todos os pacientes (SQLite ou localStorage)
async function buscarPacientes() {
    if (isElectron()) {
        try {
            return await getIPC().invoke('db-listar-pacientes') || [];
        } catch (e) {
            console.warn('Falha ao buscar pacientes via IPC, usando localStorage:', e);
        }
    }
    return JSON.parse(localStorage.getItem('pacientes')) || [];
}

// Busca pagamentos (SQLite ou localStorage)
async function buscarPagamentos() {
    if (isElectron()) {
        try {
            return await getIPC().invoke('db-todos-pagamentos') || [];
        } catch (e) {
            console.warn('Falha ao buscar pagamentos via IPC:', e);
        }
    }
    return JSON.parse(localStorage.getItem('pagamentos')) || [];
}

// Busca consultas (SQLite ou localStorage)
async function buscarConsultas() {
    if (isElectron()) {
        try {
            return await getIPC().invoke('db-todas-consultas') || [];
        } catch (e) {
            console.warn('Falha ao buscar consultas via IPC:', e);
        }
    }
    return JSON.parse(localStorage.getItem('consultas')) || [];
}

// =========================================================
// INICIALIZAÇÃO
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
    popularSelectPacientes();
});

async function popularSelectPacientes() {
    const select = document.getElementById('select-paciente-completo');
    if (!select) return;

    select.innerHTML = '<option value="">-- Carregando pacientes... --</option>';

    const pacientes = await buscarPacientes();

    select.innerHTML = '<option value="">-- Selecione um Paciente Cadastrado --</option>';

    if (!pacientes || pacientes.length === 0) {
        select.innerHTML = '<option value="">-- Nenhum paciente cadastrado --</option>';
        return;
    }

    const ordenados = [...pacientes].sort((a, b) => a.nome.localeCompare(b.nome));

    ordenados.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.nome} (CPF: ${p.cpf || 'N/I'})`;
        select.appendChild(opt);
    });
}

function calcularIdade(dataNascimento) {
    if (!dataNascimento) return 'Não informada';
    const hoje = new Date();
    const nasc = new Date(dataNascimento);
    let idade = hoje.getFullYear() - nasc.getFullYear();
    const m = hoje.getMonth() - nasc.getMonth();
    if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
    return `${idade} anos`;
}

// =========================================================
// CARREGAR DOSSIÊ
// =========================================================

async function carregarDossiePaciente() {
    const pacienteId = document.getElementById('select-paciente-completo').value;

    const blocoAcoes = document.getElementById('bloco-acoes-topo');
    const areaDossie = document.getElementById('dossie-paciente');
    const avisoVazio = document.getElementById('aviso-vazio');

    if (!pacienteId) {
        blocoAcoes.style.display = 'none';
        areaDossie.style.display = 'none';
        avisoVazio.style.display = 'block';
        return;
    }

    // Busca todos os dados
    const [pacientes, pagamentos, consultas] = await Promise.all([
        buscarPacientes(),
        buscarPagamentos(),
        buscarConsultas()
    ]);

    const paciente = pacientes.find(p => String(p.id) === String(pacienteId));
    if (!paciente) {
        alert('Erro ao localizar cadastro do paciente.');
        return;
    }

    // Exibe blocos
    blocoAcoes.style.display = 'flex';
    areaDossie.style.display = 'block';
    avisoVazio.style.display = 'none';

    document.getElementById('doc-data-emissao').innerText = new Date().toLocaleString('pt-BR');

    // --- 1. Dados Cadastrais ---
    document.getElementById('dados-cadastro').innerHTML = `
        <div class="dado-item"><strong>Nome Completo:</strong> ${paciente.nome}</div>
        <div class="dado-item"><strong>CPF:</strong> ${paciente.cpf || 'N/I'}</div>
        <div class="dado-item"><strong>Data de Nasc.:</strong> ${paciente.nascimento ? paciente.nascimento.split('-').reverse().join('/') : 'N/I'} (${calcularIdade(paciente.nascimento)})</div>
        <div class="dado-item"><strong>Gênero:</strong> ${paciente.sexo || 'Não informado'}</div>
        <div class="dado-item"><strong>Plano / Convênio:</strong> ${paciente.convenio || 'Particular'}</div>
        <div class="dado-item"><strong>Telefone de Contato:</strong> ${paciente.telefone || 'N/I'}</div>
        <div class="dado-item"><strong>E-mail:</strong> ${paciente.email || 'Não cadastrado'}</div>
        <div class="dado-item"><strong>CEP:</strong> ${paciente.cep || 'N/I'}</div>
        <div class="dado-item" style="grid-column: span 2;"><strong>Endereço:</strong> ${paciente.logradouro || 'Não informado'}, Nº ${paciente.numero || 'S/N'}</div>
        <div class="dado-item"><strong>Cidade / Estado:</strong> ${paciente.cidade || 'N/I'} - ${paciente.estado || 'N/I'}</div>
    `;

    // --- 2. Anamnese Psicológica ---
    const anamneseBox = document.getElementById('anamnese-dossie');
    if (anamneseBox) {
        const anamnese = JSON.parse(localStorage.getItem(`anamnese_${pacienteId}`) || 'null');
        if (!anamnese) {
            anamneseBox.innerHTML = `<p style="color:#94a3b8;font-style:italic;grid-column:span 2;">Anamnese não preenchida para este paciente.</p>`;
        } else {
            const label = (txt) => `<div class="dado-item"><strong>${txt}</strong></div>`;
            const campo = (titulo, valor) => valor
                ? `<div class="dado-item" style="grid-column:span 2;"><strong>${titulo}:</strong><br><span style="color:#475569;">${valor.replace(/\n/g,'<br>')}</span></div>`
                : '';
            const campoInline = (titulo, valor) => valor
                ? `<div class="dado-item"><strong>${titulo}:</strong> ${valor}</div>`
                : '';

            anamneseBox.innerHTML = `
                ${campoInline('Escolaridade', anamnese['escolaridade'])}
                ${campoInline('Profissão', anamnese['profissao'])}
                ${campoInline('Estado Civil', anamnese['estado-civil'])}
                ${campoInline('Sono', anamnese['sono'])}
                ${campoInline('Alimentação', anamnese['alimentacao'])}
                ${campoInline('Doenças / Condições', anamnese['doencas'])}
                ${campoInline('Medicamentos em uso', anamnese['medicamentos'])}
                ${campoInline('Ideação suicida (histórico)', anamnese['ideacao'])}
                ${campoInline('Abordagem terapêutica', anamnese['abordagem'])}
                ${campoInline('Hipótese diagnóstica', anamnese['hipotese'])}
                ${campo('Queixa principal', anamnese['queixa'])}
                ${campo('História do problema', anamnese['historia'])}
                ${campo('História familiar', anamnese['historia-familiar'])}
                ${campo('Relacionamentos', anamnese['relacionamentos'])}
                ${campo('Tratamentos anteriores', anamnese['tratamentos-anteriores'])}
                ${campo('Internações psiquiátricas', anamnese['hospitalizacoes'])}
                ${campo('Objetivos com a terapia', anamnese['objetivos'])}
                ${campo('Observações', anamnese['obs'])}
                <div class="dado-item" style="grid-column:span 2;font-size:.75rem;color:#94a3b8;margin-top:.5rem;">
                    Preenchida em: ${anamnese.atualizadoEm ? new Date(anamnese.atualizadoEm).toLocaleString('pt-BR') : 'N/I'}
                </div>
            `.replace(/<div[^>]*>\s*<\/div>/g, ''); // remove campos vazios
        }
    }

    // --- 3. Financeiro ---
    // Normaliza campo pacienteId (SQLite pode retornar paciente_id)
    const lancamentos = pagamentos.filter(p =>
        String(p.pacienteId || p.paciente_id) === String(pacienteId)
    );

    const totalPago    = lancamentos.filter(p => p.status === 'Pago').reduce((s, p) => s + parseFloat(p.valor || 0), 0);
    const totalDevedor = lancamentos.filter(p => p.status === 'Pendente').reduce((s, p) => s + parseFloat(p.valor || 0), 0);

    document.getElementById('fin-total-pago').innerText    = `R$ ${totalPago.toFixed(2).replace('.', ',')}`;
    document.getElementById('fin-total-devedor').innerText = `R$ ${totalDevedor.toFixed(2).replace('.', ',')}`;

    const tbodyFin = document.getElementById('financeiro-lista');
    tbodyFin.innerHTML = '';

    if (lancamentos.length === 0) {
        tbodyFin.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;font-style:italic;">Nenhum histórico financeiro vinculado a este paciente.</td></tr>`;
    } else {
        lancamentos.sort((a, b) => new Date(b.data) - new Date(a.data));
        lancamentos.forEach(p => {
            const classBadge  = p.status === 'Pago' ? 'status-doc-pago' : 'status-doc-pendente';
            const textoStatus = p.status === 'Pago' ? 'Quitado' : 'Em Débito';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${p.data ? p.data.split('-').reverse().join('/') : 'N/I'}</td>
                <td>${p.forma || 'Não informada'}</td>
                <td><strong>R$ ${parseFloat(p.valor || 0).toFixed(2).replace('.', ',')}</strong></td>
                <td><span class="badge-doc-status ${classBadge}">${textoStatus}</span></td>
            `;
            tbodyFin.appendChild(tr);
        });
    }

    // --- 4. Histórico Clínico ---
    const historico = consultas.filter(c =>
        String(c.pacienteId || c.paciente_id) === String(pacienteId)
    );

    const boxClinico = document.getElementById('clinico-historico-lista');
    boxClinico.innerHTML = '';

    if (historico.length === 0) {
        boxClinico.innerHTML = `<p style="color:#94a3b8;font-style:italic;text-align:center;padding:1.5rem 0;">Nenhum prontuário ou registro localizado para este paciente.</p>`;
    } else {
        historico.sort((a, b) => new Date(b.data) - new Date(a.data));
        historico.forEach(c => {
            const isAtestado  = (c.texto || '').includes('[ATESTADO EMITIDO GOV.BR]');
            const icone       = isAtestado ? 'fa-file-prescription' : 'fa-notes-medical';
            const titulo      = isAtestado ? 'Atestado Emitido Assinado Digitalmente' : 'Evolução Clínica / Registro de Atendimento';
            const classeCard  = isAtestado ? 'card-atendimento-atestado' : 'card-atendimento-normal';

            const div = document.createElement('div');
            div.className = 'bloco-atendimento-item';
            div.innerHTML = `
                <div class="atendimento-item-header ${classeCard}">
                    <span><i class="fa-solid ${icone}"></i> <strong>${titulo}</strong></span>
                    <span><i class="fa-solid fa-calendar-day"></i> Data: <strong>${c.data ? c.data.split('-').reverse().join('/') : 'N/I'}</strong></span>
                </div>
                <div class="atendimento-item-corpo">
                    ${(c.texto || '').replace(/\n/g, '<br>')}
                </div>
            `;
            boxClinico.appendChild(div);
        });
    }
}

// =========================================================
// GERAR PDF
// =========================================================

async function salvarDossiePDF() {
    const pacienteId = document.getElementById('select-paciente-completo').value;
    if (!pacienteId) {
        alert('Selecione um paciente antes de gerar o PDF.');
        return;
    }

    const pacientes = await buscarPacientes();
    const paciente  = pacientes.find(p => String(p.id) === String(pacienteId));
    if (!paciente) {
        alert('Paciente não encontrado.');
        return;
    }

    try {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('gerar-pdf-automatico', { id: paciente.id, nome: paciente.nome });
        alert(`PDF de "${paciente.nome}" sendo gerado na pasta "Dossies_Clinica" na Área de Trabalho.`);
    } catch (e) {
        window.print();
    }
}
