# 🏷️ Upway Drop-off System – Google Sheets Migration Guide

Este repositório contém a migração completa do sistema de Check-in / Drop-off do Upway (anteriormente em Streamlit) para uma solução nativa no **Google Sheets** usando **Google Apps Script** e uma **interface HTML completa (SPA)**.

---

## 📋 Como Instalar na sua Planilha Google Sheets

### Link da Planilha
Planilha de Destino: [Google Sheets - Upway Drop-off](https://docs.google.com/spreadsheets/d/1tu-RdvCRTwWR2bbsHiWTDByEfb3i_qgdYDjCZFSUgp4/edit?usp=sharing)  
Script ID: `1nJaciJwXvHgo2lt-CQCYeb6chC6w2D2Bt8iHn6NKn0vDYw5L545RnhmT`

---

### Passo 1: Abrir o Editor do Apps Script
1. Abra a sua Planilha no Google Sheets.
2. No menu superior, clique em **Extensões (Extensions) > Apps Script**.

---

### Passo 2: Copiar os Arquivos do Projeto
No editor do Apps Script:

1. **Arquivo `Code.gs`**:
   - Abra ou crie o arquivo `Code.gs`.
   - Copie o conteúdo completo do arquivo [`Code.gs`](file:///c:/Users/works/Documents/Dropoff/Code.gs) deste repositório e cole no editor.

2. **Arquivo `CheckinPortal.html`**:
   - No menu lateral do Apps Script, clique no ícone **`+`** ao lado de *Arquivos* e escolha **HTML**.
   - Nomeie o arquivo como **`CheckinPortal`** (sem a extensão `.html`).
   - Copie o conteúdo completo do arquivo [`CheckinPortal.html`](file:///c:/Users/works/Documents/Dropoff/CheckinPortal.html) deste repositório e cole no editor.

3. Clique no ícone de **Disquete 💾 (Salvar)** no topo do editor.

---

### Passo 3: Testar e Utilizar o Portal
1. Recarregue a sua página do Google Sheets (F5).
2. Um novo menu chamado **`🏷️ Upway Drop-off`** aparecerá na barra superior da planilha.
3. Clique em **`🏷️ Upway Drop-off` > `🚀 Abrir Portal Check-in`**.
4. Uma janela modal em HTML será aberta com o portal completo:
   - **Seleção de Armazém (Warehouse)**: `berlin`, `amsterdam`, `antwerp`, `dusseldorf`, `gennevilliers`, `losangeles`, `newyork`, `paris`.
   - **Seleção de Período**: `Hoje (Today)`, `Últimos 10 Dias (Past 10 days)`, `Próximos 10 Dias (Next 10 days)`.
   - **Busca em Tempo Real**: Filtre por Bike ID, Nome do Cliente ou Modelo.
   - **Double-check & Form**: Clique em qualquer card para conferir os dados, selecionar acessórios (Akku, Ladegerät, Schlüssel 2x, Display) e ver a pré-visualização ao vivo do documento.
   - **Remoção da Bateria**: O campo *Batteriekapazität / Wh* foi totalmente removido conforme solicitado.
   - **Envio Automático**: Clique em `📄 Gerar Beleg & Salvar no Google Drive`. O PDF será gerado, enviado para a pasta estruturada do Google Drive (`Ano > DD.MM`) e registrado na aba **Drop-offs** com um link direto `📄 Abrir Beleg (PDF)`.

---

## 🔒 Whitelist do Gateway (Importante)

Lembre-se de adicionar o Card ID **`10495`** na allow-list do seu gateway Metabase, caso haja restrições de IP / Card no seu ambiente!

- **URL da API Metabase**: `https://metabase.upway.app/api/card/10495/query`
- **Card ID**: `10495`
