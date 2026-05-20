# 🏪 PDV Sistema

Sistema de Ponto de Venda (PDV) desktop para pequenos e médios comércios — supermercados, distribuidoras, mercearias e similares.

Desenvolvido com **Electron + Node.js**, banco de dados local **SQLite** e interface Apple-inspired.

---

## ✨ Funcionalidades

| Módulo | Descrição |
|---|---|
| **Frente de Caixa** | Adicionar produtos por busca ou nome manual, carrinho com edição inline, 3 formas de pagamento, troco automático |
| **Gestão de Produtos** | Cadastro completo (nome, preço, unidade, código de barras, estoque), busca em tempo real |
| **Relatórios** | Relatório diário com KPIs, breakdown por forma de pagamento, lista de vendas |
| **Fechamento de Caixa** | Consolida o dia, envia relatório HTML por e-mail via Nodemailer |
| **Backup Automático** | Backup SQLite diário + ao fechar o caixa + ao sair do app; histórico de backups |
| **Configurações** | Dados da loja, SMTP, agendamento de backup — tudo persistido no banco |

---

## 🖥️ Stack Técnica

- **Runtime**: Node.js + Electron 30
- **Frontend**: Vanilla JS + CSS moderno (sem frameworks — roda direto)
- **Banco de dados**: `better-sqlite3` (SQLite embutido, WAL mode)
- **E-mail**: `nodemailer` (SMTP genérico — Gmail, Outlook, etc.)
- **Planilhas**: `exceljs` como fallback + `XlsxWriter` opcional para relatórios Excel com gráficos nativos
- **Variáveis de ambiente**: `dotenv`
- **Build/distribuição**: `electron-builder` (gera `.exe`, `.dmg`, `.AppImage`)

---

## 📂 Estrutura de Pastas

```
pdv-system/
├── .env.example          ← Copie para .env e configure
├── .gitignore
├── package.json
├── main.js               ← Processo principal Electron
├── preload.js            ← Bridge segura (contextBridge)
├── README.md
└── src/
    ├── database/
    │   └── db.js         ← Inicialização e schema SQLite
    ├── services/
    │   ├── emailService.js           ← Nodemailer + template HTML do relatório
    │   ├── excelService.js           ← Exportação Excel/CSV e fallback
    │   ├── reportWorkbookBuilder.py  ← XLSX com gráficos nativos via XlsxWriter
    │   └── backupService.js          ← Cópia de segurança do .sqlite
    ├── ipc/
    │   └── handlers.js   ← Todos os handlers IPC (main ↔ renderer)
    └── renderer/
        ├── index.html    ← SPA com todas as views
        ├── css/
        │   └── styles.css
        └── js/
            ├── app.js        ← Boot, navegação, toasts
            ├── pdv.js        ← Lógica do caixa e carrinho
            ├── products.js   ← CRUD de produtos
            └── reports.js    ← Relatórios e fechamento
```

---

## 🚀 Instalação e Execução

### Pré-requisitos

- **Node.js** ≥ 18.x — [nodejs.org](https://nodejs.org)
- **npm** ≥ 9.x (já vem com o Node)

> **Windows**: pode ser necessário instalar as ferramentas de build do Visual Studio para compilar o `better-sqlite3`:
> ```
> npm install --global windows-build-tools
> ```
> Ou instale o **"Desktop development with C++"** pelo Visual Studio Installer.

---

### 1. Clonar / copiar os arquivos

```bash
cd pdv-system
npm install
```

Para gerar os relatórios Excel com gráficos nativos, instale também a dependência Python opcional:

```bash
npm run install:report-charts
```

Esse comando cria um ambiente virtual local em `.venv-report-charts/`, então não altera o Python do macOS/Homebrew e evita o erro `externally-managed-environment`.

Se essa dependência não estiver instalada, o sistema continua exportando Excel e CSV pelo gerador JavaScript de fallback, apenas sem os gráficos nativos do Excel.

---

### 2. Configurar o arquivo `.env`

```bash
cp .env.example .env
```

Edite o `.env` com seus dados:

```env
# Informações da loja
STORE_NAME="Meu Mercado"
STORE_CNPJ="00.000.000/0000-00"

# E-mail (Gmail como exemplo)
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=seuemail@gmail.com
EMAIL_PASS=xxxx xxxx xxxx xxxx   ← Senha de App do Google
EMAIL_TO=gerente@gmail.com
EMAIL_FROM_NAME="PDV Meu Mercado"
```

> ⚠️ **Sobre a senha do Gmail**: nunca use sua senha normal.
> Gere uma **Senha de App** em:
> [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
> (requer verificação em 2 etapas ativa)

---

### 3. Rodar o projeto

```bash
npm start
```

Para modo de desenvolvimento (com DevTools):
```bash
npm run dev
```

---

## 📦 Gerar Instalador para Distribuição

```bash
# Windows (.exe instalador NSIS)
npm run build:win

# macOS (.dmg)
npm run build:mac

# Linux (.AppImage)
npm run build:linux

# Todos os sistemas
npm run build
```

O instalador gerado estará na pasta `dist/`.

---

## 🔐 Licenciamento Offline

O app bloqueia o acesso até receber uma licença assinada para o computador do cliente.

Fluxo:

```bash
# o cliente abre o app e envia o "Código da máquina" exibido na tela de ativação

# você gera a licença na sua máquina, mantendo license-private.pem em segredo
npm run license:generate -- --device CODIGO-DA-MAQUINA --customer "Nome do Cliente" --output cliente.license.txt
```

Envie o conteúdo do arquivo `cliente.license.txt` para o cliente colar na tela de ativação.

Importante: `license-private.pem` gera licenças e não deve ser enviado ao cliente. O app distribuído leva apenas `src/config/license-public.pem`, que valida licenças mas não consegue criar novas.

---

## 📋 Fluxo de Uso Básico

```
1. Abrir o sistema
   └── Tela PDV → informe troco inicial e nome do operador → "Abrir Caixa"

2. Realizar vendas
   ├── Busque o produto pelo nome (autocomplete do cadastro)
   ├── OU digite manualmente: nome + quantidade + valor
   ├── Adicione ao carrinho
   ├── Aplique desconto se necessário
   ├── Selecione forma de pagamento (Dinheiro / Cartão / PIX)
   └── "Finalizar Venda"

3. Fechar o caixa (fim do dia)
   ├── Menu "Relatórios" → botão "Fechar Caixa"
   ├── Revise o resumo do dia
   ├── Marque "Enviar relatório por e-mail" (ativo por padrão)
   └── "Confirmar Fechamento"
       ├── ✅ Relatório HTML enviado por e-mail
       └── ✅ Backup automático criado
```

---

## 🗄️ Banco de Dados

O SQLite é criado automaticamente na primeira execução em:

| Sistema | Caminho |
|---|---|
| **Windows** | `%APPDATA%\pdv-system\pdv_database.sqlite` |
| **macOS** | `~/Library/Application Support/pdv-system/pdv_database.sqlite` |
| **Linux** | `~/.config/pdv-system/pdv_database.sqlite` |

### Schema resumido

```sql
products        -- Cadastro de produtos
cash_registers  -- Sessões de caixa (abertura/fechamento)
sales           -- Vendas realizadas
sale_items      -- Itens de cada venda
settings        -- Configurações (key-value)
backup_log      -- Histórico de backups
```

---

## 💾 Backup

O sistema faz backup automático do arquivo SQLite em 3 momentos:

| Trigger | Quando |
|---|---|
| `schedule` | Verificação horária + horário configurado (padrão 23:50) |
| `cash_close` | Ao fechar o caixa |
| `app_close` | Ao fechar a janela do aplicativo |
| `manual` | Botão "Fazer Backup Agora" nas Configurações |

Os backups ficam em `<userData>/backups/` por padrão.
A pasta pode ser aberta pelo botão "Abrir Pasta de Backups" nas Configurações.

---

## 📧 Configuração de E-mail

### Gmail
```env
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=seu@gmail.com
EMAIL_PASS=<senha de app com 16 caracteres>
```

### Outlook / Hotmail
```env
EMAIL_HOST=smtp-mail.outlook.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=seu@outlook.com
EMAIL_PASS=<sua senha>
```

### SMTP Personalizado
```env
EMAIL_HOST=mail.seudominio.com.br
EMAIL_PORT=465
EMAIL_SECURE=true
EMAIL_USER=pdv@seudominio.com.br
EMAIL_PASS=<sua senha>
```

Use o botão **"Testar Conexão de E-mail"** em Configurações para validar antes de fechar o caixa.

---

## 🔒 Segurança

- A senha do e-mail (`EMAIL_PASS`) é lida **apenas** via variável de ambiente — nunca é salva no banco de dados ou exibida na interface.
- O Electron roda com `contextIsolation: true` e `nodeIntegration: false` — o renderer não tem acesso direto ao Node.js; toda comunicação passa pelo `preload.js` via `contextBridge`.
- Adicione o `.env` ao `.gitignore` (já incluído) para não vazar credenciais.

---

## 🛠️ Solução de Problemas

| Problema | Solução |
|---|---|
| `Error: Cannot find module 'better-sqlite3'` | Execute `npm install` novamente; no Windows, instale as build tools |
| E-mail não enviado | Verifique `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_TO` no `.env`; use "Testar Conexão" |
| Banco de dados corrompido | Restaure um backup de `<userData>/backups/` |
| Janela não abre | Verifique a versão do Node.js (`node -v` deve ser ≥ 18) |

---

## 📄 Licença

MIT — livre para uso e modificação em comércios.
