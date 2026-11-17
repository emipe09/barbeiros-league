# 🚀 Colocar a Barbeiros League no ar (grátis)

Como funciona:

```
Seu PC (npm start)                     GitHub                         Galera
lança resultados no Admin  ──push──▶  guarda data/f1.db  ──Actions──▶  https://SEU-USUARIO.github.io/barbeiros-league/
       "Publicar no site"              gera o site (1–2 min)           (só leitura, abre no celular)
```

- O site público é estático: nunca "dorme", não tem limite de visitas e não perde dados.
- Ninguém consegue editar pelo site público. Edição só no seu PC.
- O banco `data/f1.db` fica salvo no GitHub, então ele também vira um backup com histórico de cada publicação.

> Por que não hospedar o servidor Node direto (Render, Railway etc.)? Os planos grátis apagam o disco a cada reinício, e o banco SQLite sumiria. Do jeito acima isso não acontece.

---

## Passo 1 — Testar no seu computador

```bash
cd ~/Área\ de\ trabalho/Barbeiros
node -v          # precisa ser v22.13 ou mais novo
npm start        # ou: ./iniciar.sh
```

Abra http://localhost:3000. O **Admin** abre direto no seu computador.

## Passo 2 — Criar o repositório no GitHub (uma vez só)

A pasta já é um repositório Git com o primeiro commit feito. Falta enviar para o GitHub.

1. Crie uma conta em https://github.com (se ainda não tiver).
2. Instale e entre no GitHub CLI (o jeito mais simples de autenticar):
   ```bash
   sudo apt install gh
   gh auth login        # escolha GitHub.com → HTTPS → Login with a web browser
   ```
3. Crie o repositório e envie tudo, de dentro da pasta Barbeiros:
   ```bash
   gh repo create barbeiros-league --public --source=. --push
   ```
   O repositório precisa ser **público** para o GitHub Pages ser grátis. Só vão nele os nomes e resultados da liga; o arquivo `.env` (senha) e os backups ficam de fora.

<details><summary>Sem o GitHub CLI</summary>

Crie um repositório vazio chamado `barbeiros-league` em https://github.com/new (público, sem README) e rode:

```bash
git remote add origin https://github.com/SEU-USUARIO/barbeiros-league.git
git push -u origin main
```

Quando pedir senha, use um *Personal access token* (GitHub → Settings → Developer settings → Tokens), não a senha da conta.
</details>

## Passo 3 — Ligar o GitHub Pages (uma vez só)

1. No repositório: **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Vá em **Actions → Publicar site → Run workflow** (ou faça qualquer publicação).

Em 1–2 minutos o site está em **https://SEU-USUARIO.github.io/barbeiros-league/**. Mande esse link para a galera.

---

## Dia de corrida

1. `npm start` (ou `./iniciar.sh`) e abra http://localhost:3000/#/admin
2. **Lançar resultados** → escolha a etapa → chegada, sprint, pole e volta rápida → **Salvar resultado**
   - Posição repetida fica em vermelho e não deixa salvar.
   - Piloto sem posição = não correu.
3. **Publicar e backup → Publicar no site**. Pronto.

Também dá para publicar pelo terminal: `npm run publicar -- "GP do Japão"`.

## Outras tarefas

| Quero… | Onde |
|---|---|
| Trocar piloto de equipe no meio da temporada | Admin → Pilotos e equipes → Transferir ou inscrever piloto |
| Colocar alguém como reserva | Transferir para a equipe "Reservas" |
| Criar a próxima temporada | Admin → Temporadas e corridas → Nova temporada (escolhe pistas, grid e já registra o campeão da atual) |
| Mudar pontuação / sprint / volta rápida | Admin → Temporadas e corridas → Pontuação |
| Reordenar, adicionar ou remover corridas | Admin → Temporadas e corridas → Calendário |
| Ver o site exatamente como a galera vê | `npm run preview` → http://localhost:4173 |
| Mudar o nome da liga | Admin → Publicar e backup → Nome da liga |

## Backup e recuperação

- Antes de cada operação arriscada (nova temporada, finalizar, excluir, restaurar, publicar) uma cópia vai para `data/backups/` (ficam as 30 últimas).
- Para voltar uma cópia: pare o servidor e copie o arquivo por cima de `data/f1.db`.
- Cada publicação também fica no histórico do GitHub (aba Commits) — dá para recuperar qualquer versão de `data/f1.db` de lá.
- Admin → Publicar e backup → **Baixar backup (.json)** gera um arquivo para guardar onde quiser.

## Editar pelo celular (opcional)

Crie um arquivo `.env` (copie do `.env.example`) com `ADMIN_PASSWORD=uma-senha-forte` e rode `npm start`. O servidor passa a aceitar conexões da rede de casa: no celular, abra `http://IP-DO-PC:3000/#/admin` e entre com a senha. Descubra o IP com `hostname -I`.

## Alternativas ao GitHub Pages

O mesmo repositório funciona em outros serviços gratuitos de site estático. Configuração: **comando de build** `npm run build`, **pasta** `dist`, variável `NODE_VERSION=22`.

- **Cloudflare Pages** → endereço `barbeiros-league.pages.dev`
- **Netlify** → endereço `barbeiros-league.netlify.app`

Em qualquer um deles dá para apontar um domínio próprio depois (Settings → Custom domain).

## Problemas comuns

- **`node:sqlite` não encontrado / erro ao iniciar**: atualize o Node para 22.13+ (https://nodejs.org ou `nvm install 22`).
- **"Esta pasta ainda não é um repositório Git"** ao publicar: faça o passo 2.
- **"O envio para o GitHub falhou"**: rode `gh auth login` de novo (ou confira o token) e tente `npm run publicar`.
- **Site não atualizou**: veja a aba **Actions** do repositório; se o build falhou, o erro aparece lá.
- **Porta 3000 ocupada**: `PORT=4000 npm start`.
