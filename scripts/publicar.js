'use strict';

/* Envia o banco atualizado para o GitHub. O GitHub Actions gera e publica o site.
   Uso: npm run publicar  [-- "mensagem do commit"] */

const { backup, publish } = require('../src/maintenance');

try {
  backup('antes-publicar');
  const r = publish(process.argv[2]);
  console.log(r.committed ? '✔ Alterações salvas no Git.' : 'ℹ Nenhuma alteração nova no banco.');
  console.log('✔ Enviado para o GitHub. O site atualiza em 1–2 minutos.');
} catch (e) {
  console.error('❌ ' + e.message);
  process.exit(1);
}
