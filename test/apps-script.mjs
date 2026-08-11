/**
 * Carrega os arquivos .gs do projeto como o Apps Script carrega: concatenados num
 * escopo global unico.
 *
 * Isso e o que valida a divisao em src/*.gs. Se algum arquivo passar a depender de
 * outro no NIVEL DE TOPO (usar uma var antes de ela ser inicializada, por exemplo),
 * os testes quebram aqui — que e o unico sintoma que o Apps Script daria, e so em
 * producao.
 */
import fs from 'fs';
import path from 'path';

export const SRC_DIR = path.join(import.meta.dirname, '..', 'src');

export function gsFiles() {
  return fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.gs')).sort();
}

export function gsSource() {
  return gsFiles()
    .map((f) => '// ---- ' + f + ' ----\n' + fs.readFileSync(path.join(SRC_DIR, f), 'utf8'))
    .join('\n');
}

export function srcPath(file) {
  return path.join(SRC_DIR, file);
}
