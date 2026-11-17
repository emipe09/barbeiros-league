# 🏁 Barbeiros League

Site e painel do nosso campeonato de F1 virtual.

- **Site público** (só leitura, para a galera): classificação de pilotos com a grade de resultados corrida a corrida, construtores, gráfico de evolução, página de cada corrida e de cada piloto, Hall da fama com campeões e recordes de todas as temporadas.
- **Painel de admin** (só no seu computador): lançar resultados, transferências, pilotos e equipes, criar/finalizar temporadas, pontuação, calendário, backup e botão **Publicar no site**.

Hospedagem: **GitHub Pages, de graça**. O banco (`data/f1.db`) fica no repositório; a cada publicação o GitHub gera o site sozinho. O passo a passo está em **[DEPLOY.md](DEPLOY.md)**.

## Uso rápido

Precisa do **Node.js 22.13 ou mais novo** (`node -v`). Não há dependências obrigatórias.

```bash
npm start            # abre em http://localhost:3000  (ou rode ./iniciar.sh)
```

Dia de corrida: **Admin → Lançar resultados → Salvar resultado → Publicar e backup → Publicar no site.**

| Comando | O que faz |
|---|---|
| `npm start` | Servidor local com site + admin |
| `npm run publicar` | Envia o banco para o GitHub (o site atualiza em 1–2 min) |
| `npm run build` | Gera o site público em `dist/` |
| `npm run preview` | Gera e mostra exatamente o site público em http://localhost:4173 |
| `npm run backup` | Cópia do banco em `data/backups/` |
| `npm test` | Confere os cálculos de pontuação (inclui os campeões reais) |
| `npm run importar-planilha` | Importa a planilha F1LM (precisa de `npm install` antes) |

## Estrutura

```
Barbeiros/
├── data/
│   ├── f1.db                 ← banco oficial da liga (SQLite)
│   ├── planilhas/            ← planilha F1LM original
│   └── backups/              ← cópias automáticas (não vão para o GitHub)
├── src/                      ← servidor
│   ├── server.js             ← HTTP, arquivos do site e API
│   ├── db.js                 ← conexão, tabelas e migrações
│   ├── standings.js          ← cálculo de pontos e classificação
│   ├── league.js             ← monta os dados públicos + Hall da fama
│   ├── routes/admin.js       ← rotas de edição
│   ├── auth.js               ← proteção do admin
│   ├── maintenance.js        ← backup e publicação (git)
│   └── calendar.js           ← calendário de pistas da F1
├── web/                      ← site (HTML, CSS e JS sem build)
│   ├── js/views/             ← páginas públicas
│   └── js/admin/             ← painel de admin
├── scripts/                  ← build do site, publicar, importar planilha
├── test/                     ← testes
└── .github/workflows/        ← publica no GitHub Pages
```

## Regras de pontuação

Padrão: 25-18-15-12-10-8-6-4-2-1, sprint 8-7-6-5-4-3-2-1, volta rápida configurável (na League 2 está em 0). Desempate: pontos, vitórias, pódios, poles, voltas rápidas, melhor resultado. Pilotos de equipes cujo nome começa com "Reserv" pontuam para pilotos, mas não para construtores. Transferências valem a partir da etapa escolhida.
